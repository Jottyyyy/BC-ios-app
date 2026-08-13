import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for Play vs Coach's derived layer, in the same spirit as
// `PairingMetricsCheck`: this toolchain has no XCTest, so the assertions live in a runnable
// harness. `swift run CoachMetricsCheck` exits non-zero on any failure.
//
// ## What it covers, and what it deliberately does not
//
// It does NOT re-check the 782 raw constants in `CoachMetrics.swift`. Those are not transcribed —
// `tools/metrics/gen_coach_metrics.js` emits that file and the JS twin from one extraction in one
// pass, so there is no step between them for a typo to live in. Re-asserting them here would be a
// second copy of the same fact with a second chance to be wrong.
//
// What it asserts is the part with a decision in it: the folded avatar geometry, the roster, the
// accent lookup's clamping, and the layout values that are NOT extracted.

public struct CoachMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "CoachMetricsCheck: \(passed) assertions passed"
           : "CoachMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

@MainActor
public func biyaherongCoachMetricsCheck() -> CoachMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func eq<T: Equatable>(_ got: T, _ want: T, _ what: String) {
        expect(got == want, "\(what): got \(got), want \(want)")
    }

    // ── 1. The folded avatar geometry ────────────────────────────────────────────────
    //
    // `CoachCard` computes `ringSize = avatarSize + 6` and `haloSize = ringSize + 10`. The
    // generator folds those from the extraction's signed terms; what is checked here is that the
    // RELATIONSHIPS survived, because a fold that silently produced two equal numbers would draw a
    // ring with no halo and look almost right.
    eq(CoachSelect.cardSizeRingRegular - CoachSelect.cardSizeAvatarRegular,
       CoachSelect.cardSizeRingFeatured - CoachSelect.cardSizeAvatarFeatured,
       "the ring's margin over the avatar is the same on both card sizes")
    eq(CoachSelect.cardSizeHaloRegular - CoachSelect.cardSizeRingRegular,
       CoachSelect.cardSizeHaloFeatured - CoachSelect.cardSizeRingFeatured,
       "and so is the halo's over the ring")
    expect(CoachSelect.cardSizeAvatarRegular < CoachSelect.cardSizeRingRegular
             && CoachSelect.cardSizeRingRegular < CoachSelect.cardSizeHaloRegular,
           "the three regular sizes nest outwards")
    expect(CoachSelect.cardSizeAvatarFeatured > CoachSelect.cardSizeAvatarRegular,
           "and the featured card is the larger of the two")

    // ── 2. The roster reached Swift whole ────────────────────────────────────────────
    eq(CoachRoster.all.count, 5, "five coaches")
    for coach in CoachRoster.all {
        expect(!coach.name.isEmpty, "coach \(coach.id) has a name")
        expect(!coach.winMsg.isEmpty, "coach \(coach.id) has a win line")
        expect(!coach.loseMsg.isEmpty, "coach \(coach.id) has a losing line")
        expect(coach.rating > 0, "coach \(coach.id) has a rating")
        eq(CoachRoster.of(level: coach.id).name, coach.name, "of(level:) finds coach \(coach.id)")
    }
    expect(zip(CoachRoster.all, CoachRoster.all.dropFirst()).allSatisfy { $0.rating < $1.rating },
           "ratings ascend by level")

    // Spec §7 #35: a level that is not a level must land somewhere real.
    eq(CoachRoster.of(level: 99).id, CoachRoster.all[0].id, "an impossible level falls back")
    eq(CoachRoster.of(level: 0).id, CoachRoster.all[0].id, "and so does zero")
    eq(CoachEngine.clamp(level: 99), 5, "the engine clamps high")
    eq(CoachEngine.clamp(level: 0), 1, "and low")
    eq(CoachEngine.clamp(levelString: "3abc"), 3, "and parses a deep-link parameter as parseInt does")
    eq(CoachEngine.clamp(levelString: "banana"), 1, "and survives one that is not a number at all")
    eq(CoachEngine.clamp(levelString: nil), 1, "and a missing one")

    // ── 3. The accent lookup ─────────────────────────────────────────────────────────
    //
    // `modalBtn` carries no background: `play.tsx` applies the coach's accent inline. So the
    // lookup IS the button's colour, and a wrong fallback is a button that is silently the wrong
    // coach's.
    for coach in CoachRoster.all {
        eq(coach.accent, CoachAccent.of(level: coach.id), "coach \(coach.id) accent matches CoachAccent")
    }
    eq(CoachAccent.of(level: 42), CoachAccent.level1, "an unknown level falls back to level 1")

    // ── 4. The values that are NOT extracted ─────────────────────────────────────────
    //
    // Every one of these is listed in PORTING_NOTES. Asserted so the list cannot quietly grow: a
    // literal that appears in a view body instead of here is invisible, and this is the only place
    // that would notice the difference.
    eq(CoachLayout.rosterColumns.count, 3, "the roster grid is three columns, as the RN rows are")
    eq(CoachLayout.oneStep, 1, "one half-move is one")
    eq(CoachLayout.lastRankWhite, 7, "White promotes on rank 8")
    eq(CoachLayout.lastRankBlack, 0, "and Black on rank 1")
    eq(CoachLayout.defaultPromotion, "q", "a promotion defaults to a queen")
    expect(CoachLayout.disabledOpacity < CoachLayout.enabledOpacity,
           "a disabled nav button is dimmer than an enabled one")
    expect(CoachLayout.scrimOpacity > 0 && CoachLayout.scrimOpacity < 1,
           "the resign scrim dims without hiding")
    // Derived from extracted values rather than chosen, so they cannot drift from the source.
    eq(CoachLayout.sectionGap, CoachSelect.titleSubMarginTop, "the section gap is the source's own")
    eq(CoachLayout.stripGap, CoachPlay.moveStripContentGap, "and the strip gap is too")
    eq(CoachLayout.disabledOpacity, CoachPlay.navBtnDisabledOpacity, "and the disabled opacity")

    // ── 5. The glyphs ────────────────────────────────────────────────────────────────
    //
    // Icons that happen to be characters. Pinned because a missing one renders as an empty button
    // rather than as an error.
    for (name, glyph) in [("back", CoachGlyph.back), ("first", CoachGlyph.first),
                          ("prev", CoachGlyph.prev), ("next", CoachGlyph.next),
                          ("last", CoachGlyph.last)] {
        expect(!glyph.isEmpty, "the \(name) glyph is not empty")
    }
    expect(Set([CoachGlyph.first, CoachGlyph.prev, CoachGlyph.next, CoachGlyph.last]).count == 4,
           "the four nav glyphs are four different characters")

    return CoachMetricsCheckResult(passed: passed, failures: failures)
}
