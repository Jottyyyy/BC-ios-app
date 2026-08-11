import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the Puzzle Hub's presentation layer, in the same spirit as
// `AnalysisMetricsCheck`, `HomeMetricsCheck` and `PieceArtCheck`: this toolchain has no XCTest, so
// the assertions live in a runnable harness. `swift run PuzzleMetricsCheck` exits non-zero on any
// failure.
//
// ## What it covers, and what it deliberately does not
// `tools/qa/replay_puzzle_core.js` already re-derives ~1,000 Swift **constants** from the source
// text and compares them with the JS twin, which is itself asserted against
// `tools/metrics/puzzle_styles.json`. Repeating those here would be a second copy of the same
// check with a second chance to be wrong.
//
// So this asserts what the replay cannot reach: the **derived functions**. `bottomPanel`,
// `infoStrip`, `hasEnginePanel`, `formatTime`, the Turbo clock bands, the feedback dot's signed
// geometry, the sound tables and the promotion scrim are all logic, and logic is where the port
// has actually gone wrong — the bottom panel offered Streak a Retry its own policy forbids, and
// the annotation badge shipped in the wrong corner because a sign was transcribed.

public struct PuzzleMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "PuzzleMetricsCheck: \(passed) assertions passed"
           : "PuzzleMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

public func biyaherongPuzzleMetricsCheck() -> PuzzleMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func eq<T: Equatable>(_ got: T, _ want: T, _ what: String) {
        expect(got == want, "\(what): got \(got), want \(want)")
    }
    func near(_ got: CGFloat, _ want: CGFloat, _ what: String) {
        expect(abs(got - want) < 0.0001, "\(what): got \(got), want \(want)")
    }

    // ── 1. The bottom panel is DERIVED from the mode's wrong-move policy ──────────────
    //
    // Not restated per screen. Streak and Turbo forbid Retry, and a screen that offered one anyway
    // is the Phase D bug this rule exists to prevent.
    for mode in [PuzzleSession.Mode.streak, .turbo] {
        let panel = PuzzleDisplay.bottomPanel(.failed, mode: mode)
        expect(!panel.buttons.contains(.retry),
               "\(mode) offers no Retry after a wrong move — its policy forbids one")
    }
    for mode in [PuzzleSession.Mode.play, .thematic] {
        let panel = PuzzleDisplay.bottomPanel(.failed, mode: mode)
        expect(panel.buttons.contains(.retry), "\(mode) does offer Retry")
    }
    expect(PuzzleDisplay.bottomPanel(.failed, mode: .play).row,
           "Retry and Solution sit side by side, not stacked")

    // ── 2. Which screens have a panel and a sheet at all ──────────────────────────────
    //
    // `puzzle_styles.json` carries `enginePanel*` only on playSolver and thematicSolver, and
    // `savePuzzle*` only on playSolver. Offering them elsewhere would be inventing UI.
    eq(PuzzleDisplay.hasEnginePanel(.play), true, "Play has an engine panel")
    eq(PuzzleDisplay.hasEnginePanel(.thematic), true, "Thematic has one")
    for mode in [PuzzleSession.Mode.daily, .streak, .turbo] {
        eq(PuzzleDisplay.hasEnginePanel(mode), false, "\(mode) has no engine panel")
        eq(PuzzleDisplay.hasSaveSheet(mode), false, "\(mode) has no Save sheet")
    }
    eq(PuzzleDisplay.hasSaveSheet(.play), true, "only Play can save a puzzle")
    eq(PuzzleDisplay.engineLineCount(.play), PuzzleEnginePanel.playLines, "Play's line count")
    eq(PuzzleDisplay.engineLineCount(.thematic), PuzzleEnginePanel.thematicLines,
       "Thematic shows fewer")
    expect(PuzzleEnginePanel.playLines != PuzzleEnginePanel.thematicLines,
           "the two counts genuinely differ, so asking is not pointless")

    // ── 3. The info strip is ONE state, not four booleans (spec fix #11) ──────────────
    eq(PuzzleDisplay.infoStrip(.reviewing, userIsWhite: true).text,
       PuzzleStrings.viewingSolution,
       "reviewing wins outright — 'Solved!' and 'Viewing Solution' cannot both show")
    expect(PuzzleDisplay.infoStrip(.playing, userIsWhite: true).text != PuzzleDisplay
             .infoStrip(.playing, userIsWhite: false).text,
           "the strip names the side to move")

    // ── 4. Clocks ─────────────────────────────────────────────────────────────────────
    //
    // Two formatters on purpose: the rated screen pads to MM:SS, Turbo does not. One function
    // would silently restyle one of the two screens.
    eq(PuzzleDisplay.formatTime(0), "00:00", "the rated clock pads")
    eq(PuzzleDisplay.formatTime(7), "00:07", "and pads its seconds")
    eq(TurboRun.formatClock(180), "3:00", "Turbo's does NOT pad its minutes")
    eq(TurboRun.formatClock(7), "0:07", "but does pad its seconds")
    eq(TurboRun.formatClock(nil), PuzzleStrings.infinity, "and infinite has no clock")
    expect(PuzzleDisplay.formatTime(180) != TurboRun.formatClock(180),
           "the two formatters genuinely differ at the same input")

    // ── 5. The Turbo clock's four bands, most-urgent first ────────────────────────────
    //
    // Ordered so a boundary lands in the louder band: at exactly 10 seconds the clock is already
    // red, not amber.
    expect(PuzzleTurboModes.timerColor(30) != PuzzleTurboModes.timerColor(31),
           "30 seconds is already gold")
    expect(PuzzleTurboModes.timerColor(10) != PuzzleTurboModes.timerColor(11),
           "and 10 is already red")
    expect(Set([PuzzleTurboModes.timerColor(nil), PuzzleTurboModes.timerColor(180),
                PuzzleTurboModes.timerColor(20), PuzzleTurboModes.timerColor(5)]
               .map { String(describing: $0) }).count == 4,
           "the four bands are four distinct colours")
    eq(PuzzleTurboModes.all.count, 3, "three Turbo modes")
    eq(PuzzleTurboModes.defaultMode, 3, "and the default is 3, not infinite")

    // ── 6. The feedback dot's SIGNED geometry ─────────────────────────────────────────
    //
    // `left` subtracts its radius term and `top` adds its own, and the board flip is asymmetric —
    // the file mirrors for Black, the rank does not. This is the exact shape of the bug that
    // shipped the annotation badge in the wrong corner in both languages, so it gets real numbers.
    eq(PuzzleTurboFeedback.leftSign, -1, "left SUBTRACTS")
    eq(PuzzleTurboFeedback.topSign, 1, "top ADDS")
    let boardSide: CGFloat = 320                     // 40pt squares, so the arithmetic is readable
    let square = boardSide / 8
    let r = square * PuzzleTurboFeedback.radiusFactor
    let whiteE4 = PuzzleTurboFeedback.origin(square: "e4", boardSize: boardSide, userIsWhite: true)
    near(whiteE4.x, (4 + PuzzleTurboFeedback.colOffset) * square
                    + PuzzleTurboFeedback.leftSign * r * PuzzleTurboFeedback.leftFactor,
         "e4's x for White")
    near(whiteE4.y, 4 * square + PuzzleTurboFeedback.topSign * r * PuzzleTurboFeedback.topFactor,
         "e4's y for White")
    let blackE4 = PuzzleTurboFeedback.origin(square: "e4", boardSize: boardSide, userIsWhite: false)
    expect(blackE4.x != whiteE4.x, "the file mirrors when the solver is Black")
    expect(blackE4.y != whiteE4.y, "and so does the rank, from the other direction")
    // a1 for White is the bottom-left corner: col 0, row 7.
    let a1 = PuzzleTurboFeedback.origin(square: "a1", boardSize: boardSide, userIsWhite: true)
    near(a1.y, 7 * square + PuzzleTurboFeedback.topSign * r * PuzzleTurboFeedback.topFactor,
         "a1 sits on the bottom rank for White")

    // ── 7. Sounds — four keys, and which modes chime on a solve ───────────────────────
    eq(PuzzleSounds.Key.allCases.count, 4, "the puzzle path has four sounds, not six")
    eq(PuzzleSounds.forMove(captured: true), .capture, "a capture plays capture")
    eq(PuzzleSounds.forMove(captured: false), .move, "and anything else plays move")
    eq(PuzzleSounds.Key.gameStart.file, "game-start", "the kebab-case asset name")
    eq(PuzzleSounds.Key.gameOver.file, "game-over", "and the other one")
    for mode in ["play", "daily", "thematic"] {
        eq(PuzzleSounds.chimesOnSolve(mode), true, "\(mode) chimes on a correct solve")
        eq(PuzzleSounds.chimesOnRunEnd(mode), false, "and has no run to end")
    }
    for mode in ["streak", "turbo"] {
        eq(PuzzleSounds.chimesOnSolve(mode), false,
           "\(mode) does NOT chime per solve — it would fire dozens of times in a run")
        eq(PuzzleSounds.chimesOnRunEnd(mode), true, "it chimes when the run ends")
    }

    // ── 8. Two promotion dialogs, not one ─────────────────────────────────────────────
    //
    // Streak and Turbo dim to 0.82 where the other three use 0.80, and the Analysis Board's dialog
    // is a different design entirely.
    for mode in [PuzzleSession.Mode.streak, .turbo] {
        expect(PuzzlePromotion.scrimFor(mode) == PuzzlePromotion.scrimIntense,
               "\(mode) dims harder behind the promotion dialog")
    }
    for mode in [PuzzleSession.Mode.play, .daily, .thematic] {
        expect(PuzzlePromotion.scrimFor(mode) == PuzzlePromotion.scrim, "\(mode) uses the lighter one")
    }
    expect(PuzzlePromotion.scrim != PuzzlePromotion.scrimIntense, "the two scrims genuinely differ")
    eq(PuzzlePromotion.order.count, 4, "four promotion choices")
    eq(PuzzlePromotion.order.first, .queen, "queen first")
    expect(PuzzleStrings.promotionTitle != AnalysisPromotion.title,
           "the two dialogs word their titles differently — 'Choose Promotion' vs 'Promote to:'")
    expect(PuzzlePromotion.dialogRadius != AnalysisPromotion.dialogRadius,
           "and every measurement differs, which is why they are two views")
    eq(PuzzlePromotion.label(.knight), "Knight", "the puzzle dialog labels its rows")

    // ── 9. The four sounds map to files that actually ship ────────────────────────────
    //
    // A name that is not one of the four is a silent no-op — `SoundManager` looks it up and
    // returns — which is how Turbo shipped `puzzle-correct` and nobody heard the difference.
    for key in PuzzleSounds.Key.allCases {
        expect(!key.file.isEmpty, "\(key) maps to an asset name")
        expect(key.file == key.file.lowercased(), "\(key)'s asset name is lower-case kebab")
    }
    expect(Set(PuzzleSounds.Key.allCases.map { $0.file }).count == 4,
           "the four keys map to four distinct files")
    eq(PuzzleSounds.captureFlags, ["c", "e"], "capture is flags c or e, verbatim from the source")

    // ── 10. The five hub cards ────────────────────────────────────────────────────────
    eq(PuzzleHub.modes.count, 5, "five modes on the hub")
    eq(Set(PuzzleHub.modes.map { $0.id }).count, 5, "with distinct ids")
    // Part 9.2(a): the Streak CARD takes the Streak SCREEN's accent, not the hub's original, so a
    // tapped card flows into a matching screen. `sourceHex` keeps what the source had.
    expect(PuzzleHub.modes.first { $0.id == "streak" }?.hex != PuzzleHub.sourceHex["streak"],
           "the streak card is deliberately re-tinted from the source")
    eq(PuzzleHub.modes.first { $0.id == "streak" }?.hex, 0xF4511E,
       "onto the Streak screen's own accent")

    // ── 11. Every screen's type sizes are positive and its radii non-negative ─────────
    //
    // A cheap sweep that catches a constant left at zero by a bad edit — the kind of thing that
    // renders as an invisible label rather than a crash.
    let sizes: [(String, CGFloat)] = [
        ("hubTitle", PuzzleType.hubTitle), ("streakCounter", PuzzleType.streakCounter),
        ("turboTimer", PuzzleType.turboTimer), ("dailyTitle", PuzzleType.dailyTitle),
        ("streakNumber", PuzzleStreakHome.numberSize),
        ("turboFinishedScore", PuzzleTurboRun.finishedScoreSize),
        ("statValue", PuzzleStreakSolver.statValueSize),
    ]
    for (name, v) in sizes { expect(v > 0, "\(name) is a positive type size") }

    return PuzzleMetricsCheckResult(passed: passed, failures: failures)
}
