import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// The home screen's PURE layer: responsive metrics, band heights, the tile geometry, the fixed
// layout constants, the Colorful palette, the card matrix, the hourly quote rotation, expiry
// formatting, and the banner-style precedence rule.
//
// Nothing here builds a view, which is the point — `HomeMetricsCheck` (the runnable self-check
// executable, since this toolchain has no XCTest) asserts every function in this file without a
// running UI. The rule that keeps that true: **no numeric literal and no arithmetic in any view
// body.** Every number on the screen is a stored property or a pure function from this file.
//
// Ported from ../BYAHERONG-COACH-FRONTEND/app/(app)/user/home.tsx — the real StyleSheet numbers.

// MARK: - Typography metrics

enum HomeType {
    /// Nunito's natural line box, as a multiple of the point size. Used only as a fallback when the
    /// bundled font is not registered — the real value is measured from the face below.
    static let nunitoLineHeightRatio: CGFloat = 1.364

    /// The font's own line box. Measured from the real bundled face rather than assumed, so a font
    /// swap or a silent `CTFontManagerRegisterFontsForURL` failure shows up as a failing assertion
    /// instead of every line height on the screen quietly changing.
    static func naturalLineHeight(_ size: CGFloat, _ weight: NunitoWeight = .regular) -> CGFloat {
        #if canImport(UIKit)
        if Theme.fontsReady, let f = UIFont(name: weight.psName, size: size) { return f.lineHeight }
        return UIFont.systemFont(ofSize: size).lineHeight
        #elseif canImport(AppKit)
        if Theme.fontsReady, let f = NSFont(name: weight.psName, size: size) {
            return f.ascender - f.descender + f.leading
        }
        let f = NSFont.systemFont(ofSize: size)
        return f.ascender - f.descender + f.leading
        #else
        return size * nunitoLineHeightRatio
        #endif
    }

    /// SwiftUI's `lineSpacing` is EXTRA leading *between* lines, not a CSS-style total line height,
    /// so a design `lineHeight` converts by subtracting the font's own box.
    ///
    /// Returns 0 when the target is below the natural box: `lineSpacing` is additive and cannot
    /// tighten. (If a design ever needs that, the construction is one `Text` per line in a `VStack`
    /// with negative spacing — none of this screen's line heights require it.)
    static func extraLeading(target: CGFloat, size: CGFloat, weight: NunitoWeight = .regular) -> CGFloat {
        max(0, target - naturalLineHeight(size, weight))
    }
}

// MARK: - Responsive metrics

/// Every card-interior size derives from one scalar (§4).
///
/// The baseline is a 375 × 812 phone. Taking the **smaller** of the two ratios guarantees nothing
/// overflows on an unusually tall or unusually wide device; the clamp keeps tiny devices legible
/// and stops tablets rendering absurd tiles.
struct HomeScreenMetrics: Equatable {
    static let baseWidth: CGFloat = 375
    static let baseHeight: CGFloat = 812
    static let minScale: CGFloat = 0.75
    static let maxScale: CGFloat = 1.7

    let scale: CGFloat
    let iconSize: CGFloat
    let iconCircle: CGFloat
    let logoSize: CGFloat
    let cardTitleSize: CGFloat
    let cardSubSize: CGFloat
    let cardGap: CGFloat
    let cardPadding: CGFloat

    /// The icon inset inside its Sky-theme circular backdrop. Deliberately **not** rounded: the RN
    /// original leaves this one fractional (`ICON_SIZE * 0.67`) while rounding every other derived
    /// size. Kept fractional so the art lands on the same sub-pixel as the shipped app.
    var iconInCircle: CGFloat { iconSize * Self.innerIconRatio }

    /// Static only — deliberately no same-named instance property alongside it.
    static let innerIconRatio: CGFloat = 0.67

    /// The backdrop's diameter as a fraction of the icon slot. Nominally 0.85, but taken from the
    /// rounded pair so the circle stays exactly `iconCircle` when the slot is unclamped.
    var circleRatio: CGFloat { iconSize > 0 ? iconCircle / iconSize : 0.85 }

    // Play-with-Coach (§8) — the one bespoke tile.
    /// A squircle, not a circle. This single shape difference is what sets the hero card apart.
    var coachRingRadius: CGFloat { (16 * scale).rounded() }
    var ctaPaddingH: CGFloat { (10 * scale).rounded() }
    var ctaPaddingV: CGFloat { (4 * scale).rounded() }
    var ctaTextSize: CGFloat { (10 * scale).rounded() }

    static func scale(for size: CGSize) -> CGFloat {
        // A GeometryReader legitimately reports .zero on the first layout pass, and a NaN here
        // would poison every frame downstream. Fall back to the baseline rather than collapsing.
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return 1 }
        return min(max(min(size.width / baseWidth, size.height / baseHeight), minScale), maxScale)
    }

    init(basis: CGSize) { self.init(scale: Self.scale(for: basis)) }

    init(scale s: CGFloat) {
        scale = s
        // NOTE the derivation CHAIN: iconCircle rounds the ALREADY-ROUNDED iconSize, exactly as the
        // original does (`ICON_CIRCLE = Math.round(ICON_SIZE * 0.85)`). Rounding `72 * s * 0.85` in
        // one step drifts by a point at some scales. JS `Math.round` and Swift `.rounded()` agree
        // for positive values (both round half away from zero), so `.rounded()` is the right call —
        // `Int()` or `floor` would give 40/15/11/7 where the original gives 41/16/12/8.
        iconSize = (72 * s).rounded()
        iconCircle = (iconSize * 0.85).rounded()
        logoSize = (54 * s).rounded()
        cardTitleSize = (15.5 * s).rounded()
        cardSubSize = (11.5 * s).rounded()
        cardGap = (10 * s).rounded()
        cardPadding = (12 * s).rounded()
    }
}

// MARK: - Band heights and tile geometry

/// The size of one grid tile. Six identical rectangles come from ONE value used six times, which is
/// what makes "all six cards are pixel-identical" true by construction rather than by inspection.
struct HomeTileSize: Equatable {
    var width: CGFloat
    var height: CGFloat
}

extension HomeScreenMetrics {
    /// The header hugs its content but never drops below `headerMinHeight`.
    var headerHeight: CGFloat {
        max(HomeLayout.headerMinHeight,
            max(HomeLayout.avatarSize, logoSize) + HomeLayout.headerPaddingV * 2)
    }

    /// The quote strip is PINNED to two lines rather than hugging.
    ///
    /// This is load-bearing: the quote rotates hourly and the lines differ in length, so a hugging
    /// strip would be one line tall for some quotes and two for others — which changes the grid's
    /// leftover height and silently resizes all six tiles at the top of an hour. Pinning it makes
    /// the grid geometry constant for the session.
    var quoteHeight: CGFloat {
        HomeLayout.quotePaddingV * 2
            + HomeType.naturalLineHeight(HomeLayout.quoteTextSize, .semiBold) * 2
            + HomeType.extraLeading(target: HomeLayout.quoteLineHeight,
                                    size: HomeLayout.quoteTextSize, weight: .semiBold)
            + HomeLayout.quoteAttribTopMargin
            + HomeType.naturalLineHeight(HomeLayout.quoteAttribSize, .bold)
    }

    /// Both banners are pinned to the taller one's content (Donate's subtitle is two lines), so the
    /// pair always reads as a matched set.
    var bannerHeight: CGFloat {
        HomeLayout.bannerPaddingV * 2
            + HomeType.naturalLineHeight(HomeLayout.bannerEmojiSize)
            + HomeLayout.bannerStackSpacing * 2
            + HomeType.naturalLineHeight(HomeLayout.bannerTitleSize, .extraBold)
            + HomeType.naturalLineHeight(HomeLayout.bannerSubSize, .semiBold) * 2
    }

    /// Everything the three fixed bands consume, including their outer margins.
    var fixedBandsHeight: CGFloat {
        headerHeight + quoteHeight + HomeLayout.quoteMarginBottom
            + bannerHeight + HomeLayout.bannerMarginBottom
    }

    /// The grid band — all the leftover height, and the only flexible band on the screen.
    func gridHeight(container: CGSize) -> CGFloat {
        max(0, container.height - fixedBandsHeight)
    }

    /// Splits the grid's **content box** (i.e. after its own padding) into six equal tiles.
    ///
    /// `3 * height + 2 * cardGap == content.height` and `2 * width + cardGap == content.width` are
    /// exact identities — deliberately unrounded, because rounding down would leave 0–2 pt
    /// unallocated and break "the three rows are exact thirds".
    func tile(inGridContent content: CGSize) -> HomeTileSize {
        HomeTileSize(width: max(0, (content.width - cardGap) / 2),
                     height: max(0, (content.height - cardGap * 2) / 3))
    }

    /// The grid's content box for a given container — the band minus its own padding.
    func gridContent(container: CGSize) -> CGSize {
        CGSize(width: max(0, container.width - HomeLayout.screenPaddingH * 2),
               height: max(0, gridHeight(container: container)
                              - HomeLayout.gridPaddingTop - HomeLayout.gridPaddingBottom))
    }

    /// The spacing inside a card, which is the SECOND thing to give way on a tile too short for the
    /// full design — after the icon slot (below) and before any text is allowed to clip.
    ///
    /// Capped at a fraction of the tile's own height, so on every device with room this returns
    /// `cardGap` unchanged (8% of a 132pt tile comfortably exceeds the 10pt gap) and it only bites
    /// where the alternative is a cut-off label.
    ///
    /// Named `innerGap` rather than overloading `cardGap`: a stored property and a method sharing a
    /// base name is an invalid redeclaration in Swift.
    func innerGap(rowHeight: CGFloat) -> CGFloat {
        rowHeight > 0 ? min(cardGap, rowHeight * HomeLayout.gapTileFraction) : cardGap
    }

    /// Height of everything stacked below the icon inside a card, including the gaps.
    func contentHeightBelowIcon(_ card: HomeCard, rowHeight: CGFloat) -> CGFloat {
        let gap = innerGap(rowHeight: rowHeight)
        let titleH = CGFloat(card.titleLines) * HomeType.naturalLineHeight(cardTitleSize, .extraBold)
        if card == .playCoach {
            let cta = HomeType.naturalLineHeight(ctaTextSize, .extraBold) + ctaPaddingV * 2
            return gap + titleH + gap + cta
        }
        guard card.subtitle != nil else { return gap + titleH }
        return gap + titleH + gap + HomeLayout.subtitleTopMargin
            + HomeType.naturalLineHeight(cardSubSize, .semiBold)
    }

    /// The icon slot's edge length — `iconSize`, clamped to whatever vertical room is actually left.
    ///
    /// **Why a clamp exists at all.** The band budget is over-constrained inside a tab bar on EVERY
    /// device, not just small ones: the original home screen is a full-height Stack screen with no
    /// tab bar, and hosting it as tab 0 costs ~74 pt straight out of the grid. A 4.7" phone gets
    /// ~74–93 pt per row against the ~115 pt the full card content wants.
    ///
    /// Something has to give, and shrinking the artwork is strictly better than clipping a title.
    /// In practice this returns roughly 50–75% of `iconSize`; it returns `iconSize` untouched only
    /// where a row is genuinely tall enough. Everything else on the card stays exactly the spec.
    func iconBox(rowHeight: CGFloat, card: HomeCard) -> CGFloat {
        let free = rowHeight - cardPadding * 2 - contentHeightBelowIcon(card, rowHeight: rowHeight)
        return max(0, min(iconSize, free))
    }
}

/// The metrics that are deliberately **not** scaled, so the outer gutters and the small chrome stay
/// consistent across devices (§4).
enum HomeLayout {
    static let screenPaddingH: CGFloat = 14

    // Header
    static let headerPaddingH: CGFloat = 18
    static let headerPaddingV: CGFloat = 6
    static let headerMinHeight: CGFloat = 70
    static let avatarSize: CGFloat = 38
    static let premiumBadgeSize: CGFloat = 18
    static let premiumBadgeOffsetX: CGFloat = 4      // overhangs the avatar's right edge
    static let premiumBadgeOffsetY: CGFloat = 2      // …and its bottom edge
    static let premiumBadgeEmojiSize: CGFloat = 10
    static let searchSize: CGFloat = 38
    static let searchEmojiSize: CGFloat = 17
    static let avatarInitialSize: CGFloat = 18
    static let logoBorderWidth: CGFloat = 2
    static let coachRingBorderWidth: CGFloat = 2

    // Grid
    static let gridPaddingTop: CGFloat = 4
    static let gridPaddingBottom: CGFloat = 6
    static let cardRadius: CGFloat = 20
    static let cardBorderWidth: CGFloat = 1
    static let subtitleTopMargin: CGFloat = 1
    static let cardShadowRadius: CGFloat = 3.84
    static let cardShadowY: CGFloat = 2
    static let cardShadowOpacity: Double = 0.25
    static let logoGlowRadius: CGFloat = 6
    static let logoGlowOpacity: Double = 0.6
    static let coachGlowRadius: CGFloat = 10
    static let coachGlowOpacity: Double = 0.8
    /// Horizontal shrink allowances — the layout budgets vertical room exactly, so text only ever
    /// needs to give way sideways.
    static let titleMinScale: CGFloat = 0.85
    static let subtitleMinScale: CGFloat = 0.8
    /// Ceiling on a card's internal spacing, as a fraction of the tile height. See
    /// `HomeScreenMetrics.cardGap(rowHeight:)`.
    static let gapTileFraction: CGFloat = 0.08

    // Quote strip
    static let quoteMarginBottom: CGFloat = 8
    static let quotePaddingH: CGFloat = 16
    static let quotePaddingV: CGFloat = 10
    static let quoteRadius: CGFloat = 12
    static let quoteTextSize: CGFloat = 13
    static let quoteLineHeight: CGFloat = 20
    static let quoteTracking: CGFloat = 0.15
    static let quoteAttribSize: CGFloat = 10
    static let quoteAttribTracking: CGFloat = 0.4
    static let quoteAttribTopMargin: CGFloat = 5

    // Bottom banners
    static let bannerGap: CGFloat = 8
    static let bannerMarginBottom: CGFloat = 10
    static let bannerRadius: CGFloat = 12
    static let bannerPaddingV: CGFloat = 7
    static let bannerPaddingH: CGFloat = 8
    static let bannerStackSpacing: CGFloat = 2
    static let bannerEmojiSize: CGFloat = 18
    static let bannerTitleSize: CGFloat = 11
    static let bannerSubSize: CGFloat = 9

    // Type detail
    static let cardTitleTracking: CGFloat = 0.2
    static let cardSubTracking: CGFloat = 0.1
    static let bannerTitleTracking: CGFloat = 0.1
    static let ctaTracking: CGFloat = 0.5
    /// Not scaled — the original hard-codes `borderRadius: 20` on the pill while scaling its
    /// padding, so on a tall tile it is a rounded rectangle rather than a full capsule.
    static let ctaRadius: CGFloat = 20
    static let cardSubLineHeightRatio: CGFloat = 1.45

    // Press feedback (§11) — dim only; no spring, no scale transform.
    static let pressedCard: Double = 0.8
    static let pressedControl: Double = 0.7          // avatar, search
    static let pressedBanner: Double = 0.85
}

// MARK: - Palette

/// Colours this screen introduces. Everything already in `Theme` is reused from there rather than
/// redefined — `Theme.background`, `.cardAlt` (#162D4A card fill), `.card` (#1A2942 banner fill),
/// `.gold`, `.onGold`, `.mutedForeground`, `.border`, `.iconChip`, `.blueSky` and `.teal` all
/// already carry the exact values this design calls for.
///
/// These live here rather than in `Theme` on purpose: `Theme` is the global design system shared by
/// nine screens, and six home-only saturated fills do not belong in it.
enum HomePalette {
    // "Colorful" theme — per-card saturated fills.
    static let puzzles = Theme.c(0x4CAF50)           // green
    static let analysis = Theme.c(0xFF9800)          // orange
    static let videos = Theme.c(0xE91E63)            // pink
    static let openingTrainer = Theme.c(0x00BFA5)    // teal
    static let playCoach = Theme.c(0x1B1050)         // deep indigo — makes the gold ring blaze
    static let pairing = Theme.c(0x0D2137)           // very dark navy
    static let sponsor = Theme.c(0x00838F)           // deep teal
    static let membership = Theme.c(0x5E35B1)        // deep purple

    /// Sky theme, Pairing card ONLY: the swiss artwork is too low-contrast to read on the standard
    /// translucent-blue backdrop, so its icon circle is filled solid teal instead (§6c).
    static let swissIconBackdrop = Theme.c(0x00BFA5)

    /// The muted `#8BA3C7` visually disappears against green/orange/pink/teal, so every subtitle
    /// switches to near-white in the Colorful theme. Titles stay pure white in both.
    static let colorfulSubtitle = Theme.c(0xFFFFFF, 0.88)

    // Quote strip
    static let quoteFill = Theme.c(0x4A9FE8, 0.08)
    static let quoteText = Theme.c(0xFFFFFF, 0.78)
    static let quoteAttrib = Theme.c(0xFDB022, 0.60)

    // Chrome
    static let searchFill = Theme.c(0xFFFFFF, 0.06)
    static let bannerBorder = Theme.c(0x4A9FE8, 0.20)

    // Premium membership banner — a subtle gold wash.
    static let premiumBannerBorder = Theme.c(0xFDB022, 0.35)
    static let premiumBannerFill = Theme.c(0xFDB022, 0.06)
}

// MARK: - The card matrix

/// The six grid tiles, in reading order (§6b).
enum HomeCard: Int, CaseIterable, Identifiable {
    case puzzles, analysis, videos, openingTrainer, playCoach, pairing
    var id: Int { rawValue }

    /// `\n` is a hard line break inside the title so these two-word labels always break into two
    /// balanced lines instead of orphaning a word at a narrow width.
    var title: String {
        switch self {
        case .puzzles: return "Play Puzzles"
        case .analysis: return "Analysis Board"
        case .videos: return "Tutorial Videos"
        case .openingTrainer: return "Opening Trainer"
        case .playCoach: return "Play with\nCoach"
        case .pairing: return "Pairing\nManager"
        }
    }

    /// Play-with-Coach has no subtitle — it carries the screen's only CTA pill instead.
    var subtitle: String? {
        switch self {
        case .puzzles: return "Train Your Tactics"
        case .analysis: return "Analyze Games"
        case .videos: return "Learn From FM Deniel"
        case .openingTrainer: return "Master Your Repertoire"
        case .playCoach: return nil
        case .pairing: return "Tournaments"
        }
    }

    /// How many lines the title is budgeted — and limited — to. Vertical room is allocated exactly,
    /// so a title never wraps into space that isn't there.
    var titleLines: Int { title.contains("\n") ? 2 : 1 }

    var colorfulFill: Color {
        switch self {
        case .puzzles: return HomePalette.puzzles
        case .analysis: return HomePalette.analysis
        case .videos: return HomePalette.videos
        case .openingTrainer: return HomePalette.openingTrainer
        case .playCoach: return HomePalette.playCoach
        case .pairing: return HomePalette.pairing
        }
    }

    func fill(isColorful: Bool) -> Color { isColorful ? colorfulFill : Theme.cardAlt }

    /// §6c — the one card whose Sky-theme icon backdrop is not the standard translucent blue.
    var skyIconBackdrop: Color {
        self == .pairing ? HomePalette.swissIconBackdrop : Theme.iconChip
    }

    /// Row-major grid order. Card 5 (`playCoach`) is index 4, where the bespoke renderer expects it.
    static let grid: [HomeCard] = allCases
}

// MARK: - Quote of the hour

/// 20 Taglish chess pickup lines, rotated deterministically by the hour.
enum HomeQuotes {
    static let interval: TimeInterval = 3600

    static let all: [String] = [
        "Best move ko today… ikaw. ♟️",
        "Checkmate na sana… kaso ikaw iniisip ko.",
        "Kung chess tayo… ikaw yung queen ko.",
        "Hindi ko mahanap best move… kasi ikaw na yun.",
        "Opening ko today… usap tayo?",
        "Checkmate kita… pero sa puso.",
        "Focus sana sa board… pero ikaw lumalabas.",
        "Strategic move ko… kausapin ka.",
        "Kung puzzle ka… gusto kitang ma-solve.",
        "Blunder man move ko… ikaw pa rin goal ko.",
        "Knight move ako papunta sayo.",
        "Sa chess maraming queen… pero isa lang gusto ko.",
        "Checkmate na sana… pero napangiti mo ko.",
        "Hindi lang chess gusto kong ma-master… pati puso mo.",
        "Kung opening theory ka… aaralin kita buong araw.",
        "Kung ikaw puzzle… hindi ako susuko.",
        "Checkmate later… date muna.",
        "Best strategy… makilala ka.",
        "Kung move kita… di kita bibitawan.",
        "Sa chess may king… pero ikaw boss.",
    ]

    static let attribution = "— Biyaherong Coach"

    /// Whole hours since the Unix epoch, modulo 20.
    ///
    /// The quote is deliberately NOT random. Consequences, all intentional: it is identical for
    /// every user in the same hour (a curated "quote of the hour" rather than noise), it is stable
    /// across re-renders so it never re-rolls on redraw, and it advances by exactly one at the top
    /// of every hour.
    ///
    /// This keys off UTC hour boundaries, matching the original's `Date.now() / 3_600_000`. In a
    /// half-hour-offset zone like IST it therefore turns over at :30 — parity-correct, since the
    /// JavaScript expression has exactly the same property.
    static func index(at date: Date) -> Int {
        index(epochSeconds: date.timeIntervalSince1970)
    }

    static func index(epochSeconds: TimeInterval) -> Int {
        let hours = Int((epochSeconds / interval).rounded(.down))
        // Swift's % is remainder, not modulo: it goes negative for pre-1970 instants (a device
        // clock set to 1969 is enough), which would trap on the array subscript. Floor-mod instead.
        let n = all.count
        return ((hours % n) + n) % n
    }

    static func text(at date: Date) -> String { all[index(at: date)] }

    /// The instant the current hour began. Used to anchor the refresh schedule.
    static func hourStart(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 / interval).rounded(.down) * interval)
    }

    /// The next UTC hour boundary, strictly after `date`.
    ///
    /// The refresh is aligned to the boundary rather than firing an hour after the screen appeared.
    /// DELIBERATE DEVIATION from the original, which set a naive `setInterval(…, 3_600_000)` on
    /// focus: because the index is `floor(now/3600)`, it only ever changes ON a boundary, so a
    /// timer at an arbitrary phase leaves the displayed quote up to 59 minutes stale relative to
    /// its own definition. That is an inconsistency between the function and its refresh, not a
    /// design choice worth reproducing.
    static func nextBoundary(after date: Date) -> Date {
        hourStart(date).addingTimeInterval(interval)
    }
}

// MARK: - Membership banner state

/// Which skin the membership banner wears.
///
/// **Precedence rule that must not be violated:** the premium gold skin ALWAYS outranks the
/// Colorful purple. A premium user must never see the purple banner in either theme — the gold
/// state is the reward and it always wins. (The original applies its colorful override only when
/// `!userIsPremium`.)
enum MembershipBannerStyle: Equatable {
    case standard        // #1A2942 + blue hairline
    case colorful        // #5E35B1, no border
    case premiumGold     // gold wash + gold hairline

    static func resolve(isPremium: Bool, isColorful: Bool) -> MembershipBannerStyle {
        if isPremium { return .premiumGold }
        return isColorful ? .colorful : .standard
    }
}

enum HomeMembership {
    static let freeTitle = "Go Premium"
    static let freeSubtitle = "Unlock everything"
    static let freeEmoji = "⭐"
    /// Matches the avatar badge — "Biyahero" means traveler.
    static let premiumEmoji = "✈️"
    static let premiumTitle = "Premium Active"
    static let noExpirySubtitle = "Active subscription"

    /// Abbreviated month, numeric day, numeric year — `Sep 12, 2026`.
    ///
    /// Built from a frozen table rather than a formatter, for three reasons:
    ///   1. `static let f = DateFormatter()` does not compile under Swift 6 — `DateFormatter` is not
    ///      `Sendable`, and building one per call is the classic performance footgun.
    ///   2. `Date.FormatStyle(date: .abbreviated)` would compile (it IS `Sendable`), but modern CLDR
    ///      spells English abbreviated September "Sept", not "Sep". The design says "Sep".
    ///   3. It makes the output byte-stable across OS and ICU updates, and trivially assertable.
    ///
    /// Time zone follows the device, which is what the original's `toLocaleDateString` does — a
    /// `Date` is an instant, and which calendar *day* it lands on depends on the zone.
    static let monthAbbreviations = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    static func expiryText(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)   // never the device's Buddhist/Japanese one
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        guard let y = c.year, let m = c.month, let d = c.day, (1...12).contains(m) else {
            return noExpirySubtitle
        }
        return "Expires \(monthAbbreviations[m - 1]) \(d), \(y)"
    }

    static func subtitle(isPremium: Bool, endsAt: Date?, timeZone: TimeZone = .current) -> String {
        guard isPremium else { return freeSubtitle }
        guard let endsAt else { return noExpirySubtitle }
        return expiryText(endsAt, timeZone: timeZone)
    }

    static func title(isPremium: Bool) -> String { isPremium ? premiumTitle : freeTitle }
    static func emoji(isPremium: Bool) -> String { isPremium ? premiumEmoji : freeEmoji }
}

enum HomeDonate {
    static let emoji = "♟️"
    static let title = "Donate"
    /// Hard line break, middot separator, peso sign.
    static let subtitle = "Help sponsor\na student · ₱99"
}
