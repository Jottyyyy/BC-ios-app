import SwiftUI
import Foundation

// Executable self-check for the home screen's pure layer, in the same spirit as ParityRunner and
// PieceArtCheck: this toolchain has no XCTest, so the assertions live in a runnable harness.
// `swift run HomeMetricsCheck` exits non-zero on any failure.
//
// It asserts everything about the screen that can be established WITHOUT a renderer — which is
// most of what matters: the responsive scale and every derived size, the tile identity that makes
// the six cards equal, the icon clamp that keeps the layout from clipping on a small phone, the
// hourly quote rotation, expiry formatting, and the premium-outranks-colorful precedence rule.
//
// This is only possible because no view body in HomeScreen.swift / HomeParts.swift contains a
// numeric literal or an arithmetic operator — every number is a stored property or a pure function
// from HomeMetrics.swift. Keep it that way, or coverage silently drains out of this file.

public struct HomeMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "HomeMetricsCheck: \(passed) assertions passed"
           : "HomeMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

@MainActor
public func biyaherongHomeMetricsCheck() -> HomeMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func near(_ a: CGFloat, _ b: CGFloat, _ tol: CGFloat = 0.01) -> Bool { abs(a - b) <= tol }
    func expectNear(_ a: CGFloat, _ b: CGFloat, _ what: String, _ tol: CGFloat = 0.01) {
        expect(near(a, b, tol), "\(what): got \(a), expected \(b)")
    }
    func date(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso) ?? Date(timeIntervalSince1970: 0)
    }
    let utc = TimeZone(identifier: "UTC")!

    // ── 1. The responsive scale and its clamp ────────────────────────────────
    expectNear(HomeScreenMetrics.scale(for: CGSize(width: 375, height: 812)), 1.0, "scale at the 375x812 baseline")
    // A 4.7" phone: height ratio dominates and falls through the floor.
    expectNear(HomeScreenMetrics.scale(for: CGSize(width: 375, height: 667)), 0.8214, "scale on a 375x667 window")
    expectNear(HomeScreenMetrics.scale(for: CGSize(width: 320, height: 480)), 0.75, "scale clamps up to the 0.75 floor")
    expectNear(HomeScreenMetrics.scale(for: CGSize(width: 1200, height: 1600)), 1.7, "scale clamps down to the 1.7 ceiling")
    // The ceiling is documentation, not a live constraint: the largest shipping iPad falls short.
    expectNear(HomeScreenMetrics.scale(for: CGSize(width: 1024, height: 1366)), 1.6823, "scale on a 12.9\" iPad is below the ceiling")
    // GeometryReader legitimately reports .zero on the first pass; a NaN would poison every frame.
    expectNear(HomeScreenMetrics.scale(for: .zero), 1.0, "scale falls back to baseline on a zero container")
    expect(HomeScreenMetrics.scale(for: CGSize(width: CGFloat.nan, height: CGFloat.nan)).isFinite, "scale is finite for a NaN container")

    // ── 2. Every derived metric at the three reference scales ────────────────
    // The half-point cases are the ones that earn their keep: .rounded() rounds half away from
    // zero, matching JS Math.round. Int()/floor would give 40/15/11/7 instead of 41/16/12/8.
    let table: [(CGFloat, [String: CGFloat])] = [
        (0.75, ["icon": 54, "circle": 46, "logo": 41, "title": 12, "sub": 9, "gap": 8, "pad": 9]),
        (1.00, ["icon": 72, "circle": 61, "logo": 54, "title": 16, "sub": 12, "gap": 10, "pad": 12]),
        (1.70, ["icon": 122, "circle": 104, "logo": 92, "title": 26, "sub": 20, "gap": 17, "pad": 20]),
    ]
    for (s, want) in table {
        let m = HomeScreenMetrics(scale: s)
        expectNear(m.iconSize, want["icon"]!, "iconSize at scale \(s)")
        expectNear(m.iconCircle, want["circle"]!, "iconCircle at scale \(s)")
        expectNear(m.logoSize, want["logo"]!, "logoSize at scale \(s)")
        expectNear(m.cardTitleSize, want["title"]!, "cardTitleSize at scale \(s)")
        expectNear(m.cardSubSize, want["sub"]!, "cardSubSize at scale \(s)")
        expectNear(m.cardGap, want["gap"]!, "cardGap at scale \(s)")
        expectNear(m.cardPadding, want["pad"]!, "cardPadding at scale \(s)")
    }
    // iconCircle derives from the ALREADY-ROUNDED iconSize; one-step rounding would give 105 here.
    expectNear(HomeScreenMetrics(scale: 1.7).iconCircle, 104, "iconCircle rounds the rounded iconSize")
    // …while the inner icon is deliberately left fractional.
    expectNear(HomeScreenMetrics(scale: 0.75).iconInCircle, 36.18, "iconInCircle is NOT rounded")
    expectNear(HomeScreenMetrics(scale: 1.0).iconInCircle, 48.24, "iconInCircle at scale 1")

    // ── 3. Tile geometry — the identity that makes six equal cards ───────────
    for size in [CGSize(width: 400, height: 300), CGSize(width: 347, height: 511.5), CGSize(width: 996, height: 1180)] {
        for s in [0.75, 1.0, 1.7] as [CGFloat] {
            let m = HomeScreenMetrics(scale: s)
            let t = m.tile(inGridContent: size)
            expectNear(t.height * 3 + m.cardGap * 2, size.height, "3 rows + 2 gaps == grid height (\(size), scale \(s))", 1e-6)
            expectNear(t.width * 2 + m.cardGap, size.width, "2 columns + 1 gap == grid width (\(size), scale \(s))", 1e-6)
            expect(t.width > 0 && t.height > 0, "tile is positive (\(size), scale \(s))")
        }
    }
    // Degenerate containers must clamp to zero, never go negative — a negative frame traps.
    let tiny = HomeScreenMetrics(scale: 1.7).tile(inGridContent: CGSize(width: 10, height: 10))
    expect(tiny.height == 0 && tiny.width == 0, "tile clamps to zero on a container smaller than its gaps")
    let zero = HomeScreenMetrics(scale: 1.0).tile(inGridContent: .zero)
    expect(zero.height == 0 && zero.width == 0, "tile is zero for a zero container")

    // ── 4. Band budget — the never-scroll invariant, as arithmetic ───────────
    // Measured content boxes (device minus safe areas minus the ~74pt tab bar).
    let containers = [CGSize(width: 375, height: 572.5),    // iPhone SE 3
                      CGSize(width: 393, height: 684.5),    // iPhone 15
                      CGSize(width: 430, height: 763),      // iPhone 15 Pro Max
                      CGSize(width: 834, height: 1050),     // iPad 11"
                      CGSize(width: 1024, height: 1247)]    // iPad 12.9"
    for c in containers {
        let m = HomeScreenMetrics(basis: c)
        let grid = m.gridHeight(container: c)
        expectNear(m.fixedBandsHeight + grid, c.height, "bands sum to the container (\(c))", 0.01)
        expect(grid > 0, "grid band is positive (\(c))")
        let t = m.tile(inGridContent: m.gridContent(container: c))
        expect(t.height > 0 && t.width > 0, "tiles are positive (\(c))")
        for card in HomeCard.allCases {
            expect(m.iconBox(rowHeight: t.height, card: card) >= 0, "iconBox is non-negative (\(c), \(card))")
        }
    }

    // ── 5. The icon clamp: engages only where the design does not fit ────────
    // A 4.7" phone inside the tab-bar shell is genuinely over-constrained; the artwork gives way
    // rather than the title being clipped.
    let se = CGSize(width: 375, height: 572.5)
    let seM = HomeScreenMetrics(basis: se)
    let seTile = seM.tile(inGridContent: seM.gridContent(container: se))
    expect(seM.iconBox(rowHeight: seTile.height, card: .puzzles) < seM.iconSize,
           "icon clamp engages on a 4.7\" phone")
    // With generous height it must be a no-op — the design renders at full size.
    let roomy = HomeScreenMetrics(scale: 1.0)
    expectNear(roomy.iconBox(rowHeight: 400, card: .puzzles), roomy.iconSize, "icon clamp is a no-op when there is room")
    expect(roomy.iconBox(rowHeight: 0, card: .puzzles) == 0, "iconBox is zero for a zero row")
    for card in HomeCard.allCases {
        expect(roomy.contentHeightBelowIcon(card, rowHeight: 400) > 0,
               "\(card) budgets height for its content below the icon")
    }
    // The coach card's two-line title plus a CTA pill costs more than a one-line title plus subtitle.
    expect(roomy.contentHeightBelowIcon(.playCoach, rowHeight: 400) > roomy.contentHeightBelowIcon(.puzzles, rowHeight: 400),
           "the coach card budgets more below-icon height than a standard card")
    // The gap is the second thing to give way, and only on a tile too short for the design.
    expectNear(roomy.innerGap(rowHeight: 400), roomy.cardGap, "innerGap is a no-op when there is room")
    expect(roomy.innerGap(rowHeight: 74) < roomy.cardGap, "innerGap tightens on a very short tile")
    expectNear(roomy.innerGap(rowHeight: 0), roomy.cardGap, "innerGap falls back to cardGap for a zero row")

    // ── 6. The quote of the hour ─────────────────────────────────────────────
    expect(HomeQuotes.all.count == 20, "there are exactly 20 quotes")
    expect(!HomeQuotes.all.contains(where: { $0.isEmpty }), "no quote is empty")
    expect(Set(HomeQuotes.all).count == 20, "no quote is duplicated")
    expect(HomeQuotes.all[0].contains("♟️"), "quote 1 carries the pawn emoji")
    expect(!HomeQuotes.all.contains(where: { $0.contains("...") }), "quotes use the single-character ellipsis")
    expect(HomeQuotes.index(epochSeconds: 0) == 0, "index at the epoch is 0")
    expect(HomeQuotes.index(epochSeconds: 3599) == 0, "index is stable up to the hour boundary")
    expect(HomeQuotes.index(epochSeconds: 3600) == 1, "index advances exactly on the hour")
    expect(HomeQuotes.index(epochSeconds: 20 * 3600 - 1) == 19, "index reaches 19 before wrapping")
    expect(HomeQuotes.index(epochSeconds: 20 * 3600) == 0, "index wraps after 20 hours")
    // Swift's % is a remainder and goes negative; a device clock set to 1969 must not trap.
    expect(HomeQuotes.index(epochSeconds: -1) == 19, "index floor-mods for pre-1970 instants")
    expect(HomeQuotes.index(epochSeconds: -3600 * 21) == 19, "index floor-mods well before the epoch")
    let base = Date(timeIntervalSince1970: 1_700_000_000)
    let baseIndex = HomeQuotes.index(at: base)
    var stable = true
    for offset in stride(from: 0.0, to: 3600.0, by: 137.0) {
        let t = HomeQuotes.hourStart(base).addingTimeInterval(offset)
        if HomeQuotes.index(at: t) != HomeQuotes.index(at: HomeQuotes.hourStart(base)) { stable = false }
    }
    expect(stable, "the quote is constant within its hour")
    expect(baseIndex >= 0 && baseIndex < 20, "index is always in range")
    expectNear(HomeQuotes.hourStart(Date(timeIntervalSince1970: 3659)).timeIntervalSince1970, 3600, "hourStart floors to the hour")
    expectNear(HomeQuotes.nextBoundary(after: Date(timeIntervalSince1970: 3600)).timeIntervalSince1970, 7200,
               "nextBoundary is strictly after an exact boundary")
    expectNear(HomeQuotes.nextBoundary(after: Date(timeIntervalSince1970: 3601)).timeIntervalSince1970, 7200,
               "nextBoundary finds the next hour")

    // ── 7. Expiry formatting ─────────────────────────────────────────────────
    expect(HomeMembership.expiryText(date("2026-09-12T12:00:00Z"), timeZone: utc) == "Expires Sep 12, 2026",
           "expiry renders as 'Expires Sep 12, 2026'")
    expect(HomeMembership.expiryText(date("2026-01-01T00:00:00Z"), timeZone: utc) == "Expires Jan 1, 2026",
           "expiry has no leading zero on the day")
    // A Date is an instant; which calendar day it lands on depends on the zone.
    expect(HomeMembership.expiryText(date("2026-09-13T02:00:00Z"),
                                     timeZone: TimeZone(identifier: "America/Los_Angeles")!) == "Expires Sep 12, 2026",
           "expiry respects the time zone")
    expect(HomeMembership.monthAbbreviations.count == 12, "there are 12 month abbreviations")
    expect(HomeMembership.monthAbbreviations[8] == "Sep", "September abbreviates to 'Sep', not 'Sept'")
    expect(HomeMembership.subtitle(isPremium: true, endsAt: nil) == "Active subscription",
           "premium with no expiry falls back to 'Active subscription'")
    expect(HomeMembership.subtitle(isPremium: false, endsAt: date("2026-09-12T12:00:00Z")) == "Unlock everything",
           "a free user never sees an expiry date")

    // ── 8. Premium gold outranks Colorful purple — in BOTH themes ────────────
    expect(MembershipBannerStyle.resolve(isPremium: true, isColorful: true) == .premiumGold,
           "premium wins over colorful")
    expect(MembershipBannerStyle.resolve(isPremium: true, isColorful: false) == .premiumGold,
           "premium wins in the sky theme")
    expect(MembershipBannerStyle.resolve(isPremium: false, isColorful: true) == .colorful,
           "a free user in colorful gets the purple banner")
    expect(MembershipBannerStyle.resolve(isPremium: false, isColorful: false) == .standard,
           "a free user in sky gets the standard banner")
    expect(HomeMembership.title(isPremium: true) == "Premium Active" && HomeMembership.emoji(isPremium: true) == "✈️",
           "the premium banner shows the airplane and 'Premium Active'")
    expect(HomeMembership.title(isPremium: false) == "Go Premium" && HomeMembership.emoji(isPremium: false) == "⭐",
           "the free banner shows the star and 'Go Premium'")

    // ── 9. Typography — doubles as a font-registration check ─────────────────
    expect(Theme.fontsReady, "the bundled Nunito faces registered")
    for w: NunitoWeight in [.regular, .medium, .semiBold, .bold, .extraBold] {
        // Nunito: ascent 1011, descent -353, lineGap 0 per 1000 upem -> 1.364 em.
        expectNear(HomeType.naturalLineHeight(100, w), 136.4, "Nunito natural line height for \(w)", 0.6)
    }
    expectNear(HomeType.extraLeading(target: 20, size: 13, weight: .semiBold), 2.268, "quote line spacing", 0.05)
    expect(HomeType.extraLeading(target: 10, size: 16) == 0, "extraLeading never goes negative")
    // `.italic()` is a silent no-op on a family with no italic face; the synthetic oblique must
    // actually produce a different font.
    expect(Theme.nunitoItalic(13, .semiBold) != Theme.nunito(13, .semiBold),
           "nunitoItalic produces a genuinely different font")

    // ── 10. The card matrix ──────────────────────────────────────────────────
    expect(HomeCard.allCases.count == 6, "there are exactly 6 cards")
    expect(HomeCard.grid.count == 6 && Set(HomeCard.grid) == Set(HomeCard.allCases),
           "the grid order is a permutation of all cards")
    expect(HomeCard.grid[4] == .playCoach, "Play with Coach is grid index 4, where the bespoke renderer expects it")
    expect(HomeCard.playCoach.subtitle == nil, "the coach card has no subtitle — it has the CTA pill instead")
    expect(HomeCard.playCoach.titleLines == 2 && HomeCard.pairing.titleLines == 2,
           "the two hard-broken titles are budgeted 2 lines")
    expect(HomeCard.puzzles.titleLines == 1, "single-word-pair titles are budgeted 1 line")
    for card in HomeCard.allCases where card != .playCoach {
        expect(card.subtitle?.isEmpty == false, "\(card) has a subtitle")
    }
    for card in HomeCard.allCases {
        expect(!card.title.isEmpty, "\(card) has a title")
        expect(card.fill(isColorful: false) == Theme.cardAlt, "\(card) uses the shared sky fill")
        expect(card.fill(isColorful: true) == card.colorfulFill, "\(card) uses its own colorful fill")
    }
    // §6c — the one documented icon-backdrop exception.
    expect(HomeCard.pairing.skyIconBackdrop == HomePalette.swissIconBackdrop,
           "the Pairing card's sky backdrop is teal, not the translucent blue")
    for card in HomeCard.allCases where card != .pairing {
        expect(card.skyIconBackdrop == Theme.iconChip, "\(card) uses the standard sky backdrop")
    }

    // ── 11. Bundled artwork resolves ─────────────────────────────────────────
    // `.brandLogo` is on this list because the HEADER draws it now, not only the login hero — a
    // missing file would leave the screen's most prominent element on the crown fallback.
    for asset: HomeArt.Asset in [.puzzleKnight, .analysis, .video, .swiss, .appIcon, .brandLogo] {
        expect(HomeArt.raster(asset) != nil, "\(asset.rawValue).png loads from Images/")
    }
    expect(HomeArt.vector(.openingBook) != nil,
           "opening_book.svg parses (alpha must be baked into 8-digit hex — SVGVector ignores opacity attributes)")
    for card in HomeCard.allCases where card != .playCoach {
        expect(HomeArt.asset(for: card) != nil, "\(card) has card art")
    }
    expect(HomeArt.asset(for: .playCoach) == nil, "the coach card draws the app icon, not a card asset")

    // ── 12. Header chrome, client round 4 ────────────────────────────────────
    // The mark curves like the LOGIN HERO, by reference rather than by a second guess: it is the
    // same brand collage, and a circle would crop its wordmark off.
    expectNear(HomeLayout.logoRadiusRatio, LoginLayout.logoRadius / LoginLayout.logoSize,
               "the header mark takes the login hero's corner proportion")
    expect(HomeLayout.logoRadiusRatio > 0 && HomeLayout.logoRadiusRatio < 0.5,
           "which is a squircle — neither a square nor a circle")
    // A ratio, not a constant, because logoSize spans 41-92pt across the device range.
    let radii: [(CGFloat, CGFloat)] = [(0.75, 10), (1.00, 13), (1.70, 22)]
    for (s, want) in radii {
        let m = HomeScreenMetrics(scale: s)
        expectNear((m.logoSize * HomeLayout.logoRadiusRatio).rounded(), want,
                   "header mark radius at scale \(s)")
    }

    // The banner band still budgets TWO subtitle lines although the one surviving banner has one.
    // It feeds fixedBandsHeight -> gridHeight -> tile(inGridContent:), so trimming it here would
    // resize all six cards — see the note on `HomeScreenMetrics.bannerHeight`.
    let subLine = HomeType.naturalLineHeight(HomeLayout.bannerSubSize, .semiBold)
    let oneLineBand = HomeLayout.bannerPaddingV * 2
        + HomeType.naturalLineHeight(HomeLayout.bannerEmojiSize)
        + HomeLayout.bannerStackSpacing * 2
        + HomeType.naturalLineHeight(HomeLayout.bannerTitleSize, .extraBold)
        + subLine
    expectNear(HomeScreenMetrics(scale: 1.0).bannerHeight - oneLineBand, subLine,
               "bannerHeight budgets a second subtitle line that nothing draws, on purpose")

    return HomeMetricsCheckResult(passed: passed, failures: failures)
}
