import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the Analysis Board's pure layer, in the same spirit as ParityRunner,
// PieceArtCheck and HomeMetricsCheck: this toolchain has no XCTest, so the assertions live in a
// runnable harness. `swift run AnalysisMetricsCheck` exits non-zero on any failure.
//
// It asserts everything about the screen establishable WITHOUT a renderer: the board geometry and
// its pixel snapping, the coordinate flip, the square-fill precedence, the arrow and badge geometry,
// the eval bar and graph, the display tables, and that the bands fit on the smallest supported
// screen.
//
// It then asserts those constants against `tools/metrics/board_styles.json` — the values extracted
// mechanically from the real React Native source by `tools/metrics/extract_board_styles.js`. That is
// what makes this layer oracle-tested rather than eyeballed: a mistyped padding fails here instead
// of shipping. The written spec is prose and prose loses information — it says "eval bar height 3",
// but the source has two bars and only the micro one is 3.
//
// This is only possible because no view body contains a numeric literal or an arithmetic operator.
// Keep it that way, or coverage silently drains out of this file.

public struct AnalysisMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "AnalysisMetricsCheck: \(passed) assertions passed"
           : "AnalysisMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

@MainActor
public func biyaherongAnalysisMetricsCheck() -> AnalysisMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func near(_ a: CGFloat, _ b: CGFloat, _ tol: CGFloat = 0.0001) -> Bool { abs(a - b) <= tol }
    func expectNear(_ a: CGFloat, _ b: CGFloat, _ what: String, _ tol: CGFloat = 0.0001) {
        expect(near(a, b, tol), "\(what): got \(a), expected \(b)")
    }

    // ── 1. Board geometry: the physical width snaps down to a multiple of 8 ──
    expectNear(AnalysisBoard.size(screenWidth: 390, pixelRatio: 3), 389.3333333333333,
               "boardSize at 390@3x", 1e-6)
    expectNear(AnalysisBoard.square(screenWidth: 390, pixelRatio: 3), 48.6666666666666,
               "squareSize at 390@3x", 1e-6)
    // 375@2x is 750 physical px; 750 is not divisible by 8, so it snaps down to 744 -> 372pt.
    expectNear(AnalysisBoard.size(screenWidth: 375, pixelRatio: 2), 372, "boardSize at 375@2x snaps down")
    expect(AnalysisBoard.size(screenWidth: 375, pixelRatio: 2) < 375,
           "snapping makes the board narrower, never wider")
    expect(AnalysisBoard.size(screenWidth: 390, pixelRatio: 3) <= 390,
           "the board never exceeds the screen width")
    expectNear(AnalysisBoard.piece(square: 48), 45.6, "piece is 95% of a square")

    // ── 2. Coordinates and the flip ──
    let s: CGFloat = 40
    expectNear(AnalysisBoard.center(0, square: s, flipped: false).x, 20, "a1 x unflipped")
    expectNear(AnalysisBoard.center(0, square: s, flipped: false).y, 300, "a1 y unflipped (bottom-left)")
    expectNear(AnalysisBoard.center(0, square: s, flipped: true).x, 300, "a1 x flipped")
    expectNear(AnalysisBoard.center(0, square: s, flipped: true).y, 20, "a1 y flipped")
    expectNear(AnalysisBoard.center(63, square: s, flipped: false).x, 300, "h8 x unflipped")
    expectNear(AnalysisBoard.center(63, square: s, flipped: false).y, 20, "h8 y unflipped (top-right)")
    expect(AnalysisBoard.isLight(0) == false, "a1 is dark")
    expect(AnalysisBoard.isLight(63) == false, "h8 is dark")
    expect(AnalysisBoard.isLight(7) == true, "h1 is light")
    // The mapping must agree with BoardView.center(_:), which uses the identical formula.
    for sq in [0, 7, 28, 35, 56, 63] {
        let v = AnalysisBoard.visual(sq, flipped: false)
        expect(v.col == (sq & 7) && v.row == 7 - (sq >> 3), "visual(\(sq)) matches BoardView's mapping")
    }

    // ── 3. Indicators ──
    expectNear(AnalysisIndicator.dotSize(square: 40), 12, "dot is 30% of a square")
    expectNear(AnalysisIndicator.ringSize(square: 40), 34, "ring is 85% of a square")
    expectNear(AnalysisIndicator.ringStrokeWidth(square: 40), 3.2, "ring stroke is 8% of a square")

    // ── 4. Arrows ──
    let g = AnalysisArrow.geometry(from: 0, to: 56, square: 40, flipped: false)   // a1 -> a8
    expectNear(g.start.x, 20, "arrow starts at the origin centre")
    expectNear(g.start.y, 300, "arrow start y")
    expectNear(g.tip.y, 20, "arrow tip y")
    expect(g.end.y > g.tip.y, "the shaft stops short of the tip")
    expectNear(abs(g.end.y - g.tip.y), 40 * 0.35 * 0.7, "shortening is head * 0.7")
    expectNear(g.strokeWidth, 7.2, "arrow stroke is 18% of a square")
    expectNear(g.headSize, 14, "arrow head is 35% of a square")
    expectNear(abs(g.left.x - g.right.x) / 2, 14 * 0.6, "head half-width is head * 0.6")
    expect(AnalysisArrow.color(rank: 0) == AnalysisArrow.colors[0], "arrow colour for rank 0")
    expect(AnalysisArrow.color(rank: 9) == AnalysisArrow.colors[2], "a rank past the end clamps")
    let knight = AnalysisArrow.geometry(from: 0, to: 17, square: 40, flipped: false)
    expect(knight.start.x != knight.tip.x && knight.start.y != knight.tip.y,
           "a knight arrow is drawn as a straight line, not an L")

    // ── 5. Annotation badge ──
    let b = AnalysisBadge.geometry(0, square: 40, flipped: false, symbolLength: 1)
    expectNear(b.radius, 8.4, "badge radius is 21% of a square")
    expectNear(b.center.x, 20 + 40 * 0.29, "badge sits right of the square centre")
    expectNear(b.center.y, 300 + 40 * 0.29, "badge sits BELOW the square centre (bottom-right)")
    expectNear(b.ringRadius, 8.4 + 1.5, "the white ring is radius + 1.5")
    expectNear(b.shadowCenter.x - b.center.x, 1.5, "the shadow is offset 1.5")
    expectNear(b.fontSize, 8.4 * 1.1, "a one-character symbol uses r * 1.1")
    expectNear(AnalysisBadge.geometry(0, square: 40, flipped: false, symbolLength: 2).fontSize,
               8.4 * 0.88, "a two-character symbol uses r * 0.88")
    expectNear(b.textBaseline - b.center.y, b.fontSize * 0.37, "the glyph baseline drops fontSize * 0.37")

    // ── 6. Eval bar ──
    expectNear(AnalysisEval.fraction(cp: 0, mate: nil), 0.5, "an equal position is half")
    expectNear(AnalysisEval.fraction(cp: 500, mate: nil), 1.0, "clamped at +500")
    expectNear(AnalysisEval.fraction(cp: -500, mate: nil), 0.0, "clamped at -500")
    expectNear(AnalysisEval.fraction(cp: 5000, mate: nil), 1.0, "beyond the clamp stays clamped")
    expectNear(AnalysisEval.fraction(cp: nil, mate: 3), 0.95, "mate for White pins to 0.95")
    expectNear(AnalysisEval.fraction(cp: nil, mate: -3), 0.05, "mate for Black pins to 0.05")
    expectNear(AnalysisEval.fraction(cp: nil, mate: nil), 0.5, "no eval is half")
    expect(AnalysisEval.mainHeight == 8 && AnalysisEval.microHeight == 3,
           "the MAIN eval bar is 8 and only the per-line micro bar is 3")

    // ── 7. Eval graph: y is flipped so +500 is at the top ──
    expectNear(AnalysisGraph.point(cp: 500, mate: nil, index: 0, count: 2, width: 100, height: 52).y,
               0, "+500 is at the top")
    expectNear(AnalysisGraph.point(cp: -500, mate: nil, index: 1, count: 2, width: 100, height: 52).y,
               52, "-500 is at the bottom")
    expectNear(AnalysisGraph.point(cp: 0, mate: nil, index: 0, count: 2, width: 100, height: 52).y,
               26, "equal is the midline")
    expectNear(AnalysisGraph.point(cp: -500, mate: nil, index: 1, count: 2, width: 100, height: 52).x,
               100, "the last point is at the right edge")
    expectNear(AnalysisGraph.point(cp: 0, mate: 5, index: 0, count: 2, width: 100, height: 52).y,
               0, "mate saturates the graph")
    expectNear(AnalysisGraph.point(cp: 0, mate: nil, index: 0, count: 1, width: 100, height: 52).x,
               0, "a single point sits at x=0 without dividing by zero")

    // ── 8. Tables ──
    expect(AnalysisTables.classificationOrder.count == 10, "ten classification tiers")
    expect(AnalysisTables.classificationOrder[2] == "book", "book sits after great")
    for key in AnalysisTables.classificationOrder {
        expect(AnalysisTables.classification(key) != nil, "classification \"\(key)\" has a row")
    }
    expect(AnalysisTables.classification("good")?.symbol == "", "good has no badge symbol")
    expect(AnalysisTables.classification("nonsense") == nil, "an unknown key has no row")
    expect(AnalysisTables.moveAnnotations.count == 6, "six move-quality annotations")
    expect(AnalysisTables.positionAnnotations.count == 7, "seven position annotations")
    // The correction, asserted in both directions.
    let slightWhite = AnalysisTables.positionAnnotations.first { $0.symbol == "⩲" }
    let slightBlack = AnalysisTables.positionAnnotations.first { $0.symbol == "⩱" }
    expect(slightWhite?.label.contains("White") == true,
           "⩲ means WHITE is slightly better (the RN source has this backwards)")
    expect(slightBlack?.label.contains("Black") == true,
           "⩱ means BLACK is slightly better (the RN source has this backwards)")
    expect(AnalysisTables.evalSymbol(cp: 100, mate: nil) == "⩲", "+100cp is ⩲")
    expect(AnalysisTables.evalSymbol(cp: -100, mate: nil) == "⩱", "-100cp is ⩱")
    expect(AnalysisTables.evalSymbol(cp: 0, mate: nil) == "=", "level is =")
    expect(AnalysisTables.evalSymbol(cp: 200, mate: nil) == "±", "+200cp is ±")
    expect(AnalysisTables.evalSymbol(cp: -200, mate: nil) == "∓", "-200cp is ∓")
    expect(AnalysisTables.evalSymbol(cp: 400, mate: nil) == "+-", "+400cp is +-")
    expect(AnalysisTables.evalSymbol(cp: -400, mate: nil) == "-+", "-400cp is -+")
    expect(AnalysisTables.evalSymbol(cp: nil, mate: 2) == "+-", "mate for White is +-")
    expect(AnalysisTables.evalSymbol(cp: nil, mate: -2) == "-+", "mate for Black is -+")
    expect(AnalysisTables.evalSymbol(cp: 50, mate: nil) == "=", "+50cp is still equal")
    expect(AnalysisTables.evalSymbol(cp: 51, mate: nil) == "⩲", "+51cp tips to ⩲")
    expect(AnalysisTables.autoplaySpeeds.count == 5, "five autoplay speeds")
    expect(AnalysisTables.autoplaySpeeds[2].value == AnalysisTables.defaultAutoplaySpeed,
           "1.5s is the default autoplay speed")

    // ── 9. Board themes and the default style ──
    expect(BoardTheme.allCases.count == 3, "three board themes")
    expect(BoardTheme.default == .classic, "classic is the default theme")
    let plain = BoardStyle()
    expect(plain.replacesFill == false,
           "the DEFAULT style overlays, so Play and Puzzles render exactly as before")
    expect(plain.light == Theme.boardLight && plain.dark == Theme.boardDark,
           "the default style keeps the existing board colours")
    expectNear(plain.dotRatio, 0.32, "the default dot ratio is today's 0.32")
    expectNear(plain.dotSize(square: 40), 12.8, "the default dot is 32% of a square")
    let analysis = BoardStyle.analysis(theme: .green)
    expect(analysis.replacesFill == true, "the analysis style REPLACES the square fill")
    expect(analysis.light == BoardTheme.green.light, "the analysis style takes the chosen theme")
    expectNear(analysis.dotRatio, 0.3, "the analysis dot ratio is the spec's 0.3")
    expectNear(analysis.dotSize(square: 40), AnalysisIndicator.dotSize(square: 40),
               "the analysis style's dot matches the indicator table it is built from")

    // ── 10. The bands fit on every supported screen ──
    for (w, h) in [(CGFloat(375), CGFloat(667)), (390, 844), (430, 932)] {
        let edge = AnalysisBoard.size(screenWidth: w, pixelRatio: 3)
        let bands = AnalysisLayout.bands(viewportHeight: h, boardEdge: edge)
        expect(bands.fits(h), "bands fit at \(Int(w))x\(Int(h)) (total \(bands.total))")
        expect(bands.board > 0, "the board band is non-zero at \(Int(w))x\(Int(h))")
        expect(bands.panels <= AnalysisLayout.panelsMaxHeight,
               "the panels band never exceeds its max at \(Int(w))")
    }

    // ── 10b. THE BOARD IS A FUNCTION OF WIDTH ALONE ──
    //
    // The regression test for a real, reported bug. The browser sized the board with
    // `min(100cqw, calc(100cqh - …))` inside a flexible band, so its WIDTH tracked the leftover
    // HEIGHT; the ECO and engine panels change height on every move, so the board grew and shrank
    // as you played, and never filled the screen. The Swift screen had the same shape of mistake —
    // the board band claimed `maxHeight: .infinity` while the ECO panel was the one capped.
    //
    // The invariant that makes it impossible: for a given width, the board edge does not depend on
    // the viewport height at all.
    for w in [CGFloat(375), 390, 430] {
        let edge = AnalysisBoard.size(screenWidth: w, pixelRatio: 3)
        for h in [CGFloat(500), 667, 844, 932, 1200] {
            expect(AnalysisBoard.size(screenWidth: w, pixelRatio: 3) == edge,
                   "boardSize(\(Int(w))) ignores a \(Int(h))pt viewport")
        }
        expect(AnalysisLayout.bands(viewportHeight: 844, boardEdge: edge).board == edge,
               "the board is not height-capped at \(Int(w))x844")
        expect(AnalysisLayout.bands(viewportHeight: 932, boardEdge: edge).board == edge,
               "nor at \(Int(w))x932")
        // And it fills the width it is given, to within one snapped pixel step.
        expect(w - edge < 8 / 3 + 0.000001, "the board is edge-to-edge at \(Int(w)) (snap only)")
    }
    // The one screen where it IS capped, and it must still be usable.
    let seEdge = AnalysisBoard.size(screenWidth: 375, pixelRatio: 3)
    let se = AnalysisLayout.bands(viewportHeight: 667, boardEdge: seEdge)
    expect(se.board > 0 && se.board <= seEdge, "a 375x667 SE caps the board but keeps it")
    expect(se.panels < AnalysisLayout.panelsMaxHeight,
           "and the PANELS band is what gave way, not the board")

    // ── 10c. The book strip costs height only when there IS a book ──
    //
    // The client's complaint, as an assertion. The old panel drew a 230pt box to hold one line of
    // "out of book" text; now that case costs exactly nothing, and the difference is the strip.
    for (w, h) in [(CGFloat(375), CGFloat(667)), (390, 844), (430, 932)] {
        let edge = AnalysisBoard.size(screenWidth: w, pixelRatio: 3)
        let withBook = AnalysisLayout.bands(viewportHeight: h, boardEdge: edge, inBook: true)
        let without = AnalysisLayout.bands(viewportHeight: h, boardEdge: edge, inBook: false)
        expect(without.fixed < withBook.fixed,
               "out of book costs less fixed height at \(Int(w))x\(Int(h))")
        expectNear(withBook.fixed - without.fixed, AnalysisLayout.bookStripHeight,
                   "and the difference is exactly the strip at \(Int(w))x\(Int(h))")
        expect(without.board == withBook.board,
               "the board does NOT grow when the book goes — it is a function of width alone")
        expect(without.fits(h) && withBook.fits(h), "both fit at \(Int(w))x\(Int(h))")
    }
    // The strip is a strip, not the panel it replaced.
    expect(AnalysisLayout.bookStripHeight < AnalysisLayout.panelsMaxHeight / 4,
           "the book strip is a fraction of the 230pt panel it replaced "
           + "(\(AnalysisLayout.bookStripHeight))")

    // ── 10d. How much engine panel actually fits, per phone ──
    //
    // The panel is the flexible band, so it can never overflow — the rows box CLIPS, and rows that
    // do not fit are simply not drawn (`rowsBox`, and `.an-rows` in the browser). These pin how many
    // survive. Mirrored assertion-for-assertion in analysis-metrics.js §10d.
    //
    // `engineRowsThatFit` is the honest number, and it differs by device: a 375×667 SE spends 56%
    // of its height on the board alone, so it gets fewer rows than a Pro Max. That is a fact about
    // the screen, not something to assert away.
    func engineRowsThatFit(_ available: CGFloat, lines: Int) -> Int {
        let lineH = AnalysisType.enginePv * HomeType.nunitoLineHeightRatio
        let chrome = AnalysisEval.microHeight + AnalysisEval.microMarginBottom
            + AnalysisType.engineDepth * HomeType.nunitoLineHeightRatio
            + AnalysisLayout.chipPaddingV * 2
            + AnalysisLayout.enginePaddingTop + AnalysisLayout.enginePaddingBottom
        let perRow = CGFloat(lines) * lineH + AnalysisLayout.rowGap
        guard perRow > 0 else { return 0 }
        return max(0, Int((available - chrome) / perRow))
    }
    for (w, h, wantSingle, wantWrapped) in [(CGFloat(375), CGFloat(667), 3, 1),
                                            (390, 844, 5, 3),
                                            (430, 932, 5, 5)] {
        let edge = AnalysisBoard.size(screenWidth: w, pixelRatio: 3)
        let fixedNoEngine = AnalysisLayout.headerBtnHeight + AnalysisLayout.statusMinHeight
            + AnalysisLayout.stripMaxHeight + AnalysisLayout.bookStripHeight
        let available = h - fixedNoEngine - edge
        expect(available > 0, "there is room for an engine panel at \(Int(w))x\(Int(h))")
        expect(engineRowsThatFit(available, lines: 1) >= wantSingle,
               "at \(Int(w))x\(Int(h)), in book, at least \(wantSingle) single-line engine rows fit "
               + "(got \(engineRowsThatFit(available, lines: 1)))")
        expect(engineRowsThatFit(available, lines: AnalysisLayout.engineLineLimit) >= wantWrapped,
               "and at least \(wantWrapped) WRAPPED rows "
               + "(got \(engineRowsThatFit(available, lines: AnalysisLayout.engineLineLimit)))")
    }
    // The default preset asks for three lines, and every supported phone must show all three.
    let seFixedNoEngine = AnalysisLayout.headerBtnHeight + AnalysisLayout.statusMinHeight
        + AnalysisLayout.stripMaxHeight + AnalysisLayout.bookStripHeight
    expect(engineRowsThatFit(667 - seFixedNoEngine - seEdge, lines: 1)
           >= AnalysisEngineLimits.multiPV,
           "even a 375x667 SE shows every line the DEFAULT preset produces")
    // Out of book buys back a whole strip's worth of rows on the smallest screen.
    expect(engineRowsThatFit(667 - seFixedNoEngine - seEdge + AnalysisLayout.bookStripHeight,
                             lines: 1)
           > engineRowsThatFit(667 - seFixedNoEngine - seEdge, lines: 1),
           "dropping the book strip buys the SE at least one more engine row")
    expect(AnalysisLayout.engineMaxRows >= AnalysisEngineLimits.multiPV,
           "and the row cap never hides a line the default preset produced")

    // ── 11. Timings ──
    expect(AnalysisTiming.analysisDebounceMs == 300, "analysis debounce is 300ms")
    expect(AnalysisTiming.draftAutosaveMs == 800, "draft autosave is 800ms")
    expect(AnalysisTiming.doubleTapWindowMs == 350, "double-tap window is 350ms")
    expect(AnalysisTiming.longPressDelayMs == 400, "long-press delay is 400ms")
    expect(AnalysisTiming.draftTTLHours == 24, "drafts expire after 24 hours")
    expect(AnalysisTiming.pieceAnimationMs == 170, "a piece slides in 170ms")
    expect(AnalysisTiming.pieceAnimationMs < AnalysisTiming.analysisDebounceMs,
           "and lands before the engine is even scheduled, so a search can never start mid-slide")
    expect(AnalysisTiming.inlineSearchBudgetMs == 80, "one in-thread search chunk is capped at 80ms")
    expect(AnalysisTiming.inlineSearchBudgetMs * 2 < AnalysisTiming.engineDeadlineMs,
           "the per-chunk slice is well under the whole-search deadline, or slicing would do nothing")
    expect(AnalysisTiming.uiCoalesceMs == 100, "engine progress coalesces to 100ms")
    expect(AnalysisTiming.engineDeadlineMs == 1200, "one interactive search gets 1200ms by default")
    expect(AnalysisEngineLimits.multiPV == 3, "the board shows three engine lines by default")
    expect(AnalysisEngineLimits.maxDepth == 12,
           "depth 12 is the default ceiling the deadline rarely reaches")

    // ── 11b. Those defaults ARE the Balanced preset ──
    // Two files carrying the same four numbers is exactly how they drift, so the agreement is
    // asserted rather than assumed. `AnalysisEngineLimits` stays as the name the views read.
    let balanced = EngineSettings.resolve(EngineSettings.defaults())
    expect(balanced.thinkMs == AnalysisTiming.engineDeadlineMs,
           "the default deadline is the Balanced preset's think time")
    expect(balanced.reviewMs == AnalysisTiming.reviewDeadlineMs,
           "the default review budget is the Balanced preset's")
    expect(balanced.maxDepth == AnalysisEngineLimits.maxDepth,
           "the default ceiling is the Balanced preset's")
    expect(balanced.multiPV == AnalysisEngineLimits.multiPV,
           "the default line count is the Balanced preset's")
    expect(AnalysisTiming.inlineSearchBudgetMs * 2 < EngineSettings.preset("saver").thinkMs,
           "even the coolest preset leaves room for more than one in-thread slice")
    expect(balanced.infinite == false, "and the default is not an unbounded search")

    // ── 11c. The Engine Settings panel ──
    expect(AnalysisEngineStyle.rowHeight > AnalysisEngineStyle.advancedRowHeight,
           "a preset row is taller than an Advanced row — it carries two lines of text")
    expect(AnalysisEngineStyle.nameSize > AnalysisEngineStyle.summarySize,
           "the preset name outranks its summary")
    expect(AnalysisEngineStyle.thumbSize <= AnalysisEngineStyle.advancedRowHeight,
           "the slider fits inside the row that holds it")
    expect(AnalysisEngineStyle.dotSize < AnalysisEngineStyle.rowHeight,
           "the radio dot fits inside its row")
    expect(EngineSettings.presets.count == 5, "five presets")
    expect(EngineSettings.panelModel(EngineSettings.defaults(), advancedOpen: false).controls.count == 3,
           "three Advanced controls")

    // ── 12. Typography, straight from the `styles` block of board_styles.json ──
    expectNear(AnalysisType.headerTitle, 16, "the header title is 16 (NOT sidebarStyles' 20)")
    expectNear(AnalysisType.headerBtn, 22, "header buttons are 22")
    expectNear(AnalysisType.status, 12, "the status line is 12")
    expectNear(AnalysisType.toolBtn, 20, "tool buttons are 20")
    expectNear(AnalysisType.navBtn, 18, "nav buttons are 18")
    expectNear(AnalysisType.autoplayBar, 12, "the autoplay bar is 12")
    expectNear(AnalysisType.stripNum, 12, "move numbers are 12")
    expectNear(AnalysisType.stripMove, 13, "move tokens are 13")
    expectNear(AnalysisType.altChip, 12, "branch chips are 12")
    // DEVIATION — the engine panel is drawn at the MOVE STRIP's size, not the source's 9/10/8.
    // The ported values are real and also unreadable on a phone. What is asserted here is the
    // relationship the client actually asked for; the source values themselves are pinned, and
    // the direction of the deviation proved, against board_styles.json in §21 below.
    for size in [AnalysisType.engineEval, AnalysisType.engineSan,
                 AnalysisType.enginePv, AnalysisType.engineText] {
        expectNear(size, AnalysisType.stripMove,
                   "every engine cell is the move strip's size (\(size) vs \(AnalysisType.stripMove))")
    }
    expectNear(AnalysisType.engineOpening, AnalysisType.altChip,
               "the opening name matches the branch chips")
    expect(AnalysisType.engineDepth < AnalysisType.enginePv,
           "the depth chip stays quieter than the moves it annotates")
    expectNear(AnalysisType.engineDepth, 11, "the depth chip is 11")

    // ── 13. Token / chip / engine-row geometry, also from the real StyleSheet ──
    expectNear(AnalysisLayout.tokenPaddingH, 5, "move tokens pad 5 horizontally")
    expectNear(AnalysisLayout.tokenPaddingV, 2, "move tokens pad 2 vertically")
    expectNear(AnalysisLayout.tokenRadius, 3, "move tokens round to 3")
    expectNear(AnalysisLayout.chipPaddingH, 8, "branch chips pad 8 horizontally")
    expectNear(AnalysisLayout.chipPaddingV, 4, "branch chips pad 4 vertically")
    expectNear(AnalysisLayout.engineEvalWidth, 44, "the engine eval column is 44 wide (source 36)")
    expect(AnalysisLayout.engineSanWidth >= AnalysisLayout.engineEvalWidth,
           "the SAN column is at least as wide as the eval one — O-O-O is five glyphs")
    expectNear(AnalysisLayout.engineRowGap, 4, "engine rows gap 4")
    expect(AnalysisLayout.statusLineLimit == 2, "the status line wraps to two lines")
    expect(AnalysisLayout.singleLine == 1, "single-line labels truncate at one")
    expectNear(AnalysisEval.animationSeconds, 0.4, "the eval bar animates for 400ms")

    // ── 14. Game review: the modal and the eval graph ──
    expect(AnalysisTiming.reviewDeadlineMs == 200, "one reviewed position gets 200ms")
    expectNear(AnalysisReview.cardMaxHeightRatio, 0.80, "the card is 80% of the viewport")
    expectNear(AnalysisReview.cardMaxHeight(viewportHeight: 844), 675.2,
               "80% of an 844pt screen — the source's folded literal")
    expectNear(AnalysisReview.cardMaxHeight(viewportHeight: 667), 533.6,
               "and 80% of a 667pt one, which is why it is a ratio and not 675.2")
    expectNear(AnalysisReview.cardRadius, 18, "the card rounds to 18")
    expectNear(AnalysisReview.scoreSize, 36, "the accuracy number is 36pt")
    expectNear(AnalysisReview.sideColumnWidth, 36, "the count columns are 36 wide")
    expectNear(AnalysisReview.dotSize, 9, "the classification dot is 9pt")
    expectNear(AnalysisReview.graphInset, 64, "the graph is inset 64 from the screen")
    expect(AnalysisReview.accuracyColor(100) == Theme.c(0x4CAF50), "a perfect game is green")
    expect(AnalysisReview.accuracyColor(80) == Theme.c(0x4CAF50), "80 is the green boundary")
    expect(AnalysisReview.accuracyColor(79.9) == Theme.c(0xFFC107), "just under 80 is amber")
    expect(AnalysisReview.accuracyColor(60) == Theme.c(0xFFC107), "60 is the amber boundary")
    expect(AnalysisReview.accuracyColor(59.9) == Theme.c(0xFF9800), "just under 60 is orange")
    expect(AnalysisReview.accuracyColor(40) == Theme.c(0xFF9800), "40 is the orange boundary")
    expect(AnalysisReview.accuracyColor(39.9) == Theme.c(0xF44336), "below 40 is red")
    // The graph paints its own background over the wrapper's — two different colours.
    expect(AnalysisGraphStyle.background != AnalysisGraphStyle.wrapBackground,
           "the graph background is NOT the wrapper's")
    expect(AnalysisGraphStyle.wrapBackground == AnalysisPalette.graphBg,
           "the wrapper reuses the palette's graphBg")
    expectNear(AnalysisGraphStyle.backgroundRadius, 6, "the graph rounds to 6 inside an 8pt wrapper")
    expectNear(AnalysisGraphStyle.midLineWidth, 1, "the centre line is 1pt")
    expect(AnalysisTables.minimumReviewPositions == 3, "fewer than three positions is not reviewed")
    expect(AnalysisTables.accuracyText(89.9) == "89.9%", "accuracy renders with one decimal")
    expect(AnalysisTables.accuracyText(100) == "100.0%", "including a whole number")
    expect(AnalysisTables.classificationText("book") == "Book B", "a tier shows label + symbol")
    expect(AnalysisTables.classificationText("good") == "Good",
           "but `good` has no symbol, so no trailing space")
    expect(AnalysisTables.classificationText("blunder") == "Blunder ??",
           "two-character symbols work too")
    expectNear(AnalysisLayout.classMarkGap, 1, "the classification mark sits 1pt after the SAN")

    // ── 15. Persistence: the save form and the library ──
    expectNear(AnalysisLibraryStyle.sheetRadius, 20, "the bottom sheet rounds to 20")
    expectNear(AnalysisLibraryStyle.sheetPadding, 20, "and pads 20")
    expectNear(AnalysisLibraryStyle.sheetMaxHeightRatio, 0.85, "capped at 85% of the screen")
    expectNear(AnalysisLibraryStyle.sheetMaxHeight(viewportHeight: 800), 680, "so 680 on an 800pt one")
    expectNear(AnalysisLibraryStyle.fieldRadius, 10, "fields round to 10")
    expectNear(AnalysisLibraryStyle.fieldPaddingH, 14, "and pad 14 horizontally")
    expectNear(AnalysisLibraryStyle.fieldSize, 14, "field text is 14")
    expectNear(AnalysisLibraryStyle.ratingWidth, 80, "the rating field is 80 wide")
    expectNear(AnalysisLibraryStyle.chipRadius, 16, "folder chips round to 16")
    expectNear(AnalysisLibraryStyle.cardRadius, 12, "library rows round to 12")
    expectNear(AnalysisLibraryStyle.actionSize, 34, "the row action button is 34 square")
    expect(AnalysisLibraryStyle.sheetBg == AnalysisPalette.surface, "the sheet reuses `surface`")
    expect(AnalysisLibraryStyle.saveBg == AnalysisPalette.success, "Save is the success green")
    expect(AnalysisLibraryStyle.cardBg == AnalysisPalette.sheetChrome, "rows use sheetChrome")
    expect(AnalysisLibraryStyle.resultOptions.joined(separator: " ") == "* 1-0 0-1 1/2-1/2",
           "the four result options, in order")
    expect(AnalysisLibraryStyle.resultLabel("*") == "No Result (*)", "the star gets a label")
    expect(AnalysisLibraryStyle.resultLabel("1-0") == "1-0", "the others render as themselves")

    // The two derived strings the library row shows. The fixture comes back from `save` because
    // AnalysisSessionRecord's memberwise init is internal to BiyaherongCoachCore; a nil record
    // (impossible here — the PGN is non-empty) simply fails both assertions.
    var library = AnalysisLibrary()
    var record = AnalysisStore.save(&library, AnalysisStore.SaveFields(
        pgn: "1. e4 c5 *", title: "T", whitePlayer: "Ana", blackPlayer: "Bo",
        whiteRating: "1850"), now: 0)
    expect(record.map(AnalysisLibraryStyle.primaryLine) == "Ana (1850) vs Bo",
           "the headline names both players and any rating")
    record?.whitePlayer = nil
    record?.blackPlayer = nil
    record?.whiteRating = nil
    expect(record.map(AnalysisLibraryStyle.primaryLine) == "T",
           "with no players it falls back to the title")
    expect(AnalysisLibraryStyle.pgnPreview("[Event \"X\"]\n[Site \"?\"]\n\n1. e4 c5 *")
           == "1. e4 c5 *", "the preview strips headers and squashes whitespace")
    expect(AnalysisLibraryStyle.pgnPreview(String(repeating: "1. e4 c5 ", count: 20)).hasSuffix("…"),
           "and truncates a long one")

    // ── 12. Against the real RN source ─────────────────────────────────────────
    // tools/metrics/board_styles.json is COMMITTED, so this runs anywhere the repo does.
    let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // BiyaherongUI
        .deletingLastPathComponent()   // Sources
        .deletingLastPathComponent()   // DemoApp
        .deletingLastPathComponent()   // repo root
    let stylesURL = repoRoot.appendingPathComponent("tools/metrics/board_styles.json")

    guard let data = try? Data(contentsOf: stylesURL),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let sheets = root["stylesheets"] as? [String: Any],
          let styles = sheets["styles"] as? [String: Any] else {
        expect(false, "could not read \(stylesURL.path) — run node tools/metrics/extract_board_styles.js")
        return AnalysisMetricsCheckResult(passed: passed, failures: failures)
    }

    func sourceNumber(_ key: String, _ prop: String) -> CGFloat? {
        guard let style = styles[key] as? [String: Any], let n = style[prop] as? NSNumber else { return nil }
        return CGFloat(truncating: n)
    }
    func sourceString(_ key: String, _ prop: String) -> String? {
        (styles[key] as? [String: Any])?[prop] as? String
    }
    func matches(_ key: String, _ prop: String, _ mine: CGFloat, _ label: String? = nil) {
        let real = sourceNumber(key, prop)
        expect(real != nil && near(real!, mine),
               "\(label ?? "\(key).\(prop)"): encoded \(mine) != source \(real.map { "\($0)" } ?? "missing")")
    }

    /// A value we DELIBERATELY do not take from the source. Both halves are asserted: the source
    /// still holds what it always held — so a change in the extraction is still caught — and ours
    /// differs in the intended direction. Same shape as the ⩲/⩱ correction further down: a
    /// deviation is declared, never smuggled by deleting the assertion.
    func deviates(_ key: String, _ prop: String, _ mine: CGFloat, _ source: CGFloat, _ why: String) {
        let real = sourceNumber(key, prop)
        expect(real != nil && near(real!, source),
               "\(key).\(prop): the RN source should still be \(source), got "
               + "\(real.map { "\($0)" } ?? "missing") — if it really changed, revisit the deviation")
        expect(real != nil && mine > real!, "\(key).\(prop): \(why) (\(mine) > \(source))")
    }

    // DEVIATION — the engine panel is drawn at the move strip's size. See PORTING_NOTES.md.
    let bigger = "deliberately drawn larger than the source, to match the move strip"
    deviates("engineChipEval", "fontSize", AnalysisType.engineEval, 9, bigger)
    deviates("engineChipSan", "fontSize", AnalysisType.engineSan, 10, bigger)
    deviates("engineLinePv", "fontSize", AnalysisType.enginePv, 9, bigger)
    deviates("engineLineText", "fontSize", AnalysisType.engineText, 9, bigger)
    deviates("engineDepthChip", "fontSize", AnalysisType.engineDepth, 8, bigger)
    deviates("engineOpeningChip", "fontSize", AnalysisType.engineOpening, 9, bigger)
    deviates("engineChipEval", "width", AnalysisLayout.engineEvalWidth, 36,
             "widened with the type, or a mate score clips")

    matches("header", "paddingHorizontal", AnalysisLayout.headerPaddingH)
    matches("header", "paddingVertical", AnalysisLayout.headerPaddingV)
    matches("headerBtn", "width", AnalysisLayout.headerBtnWidth)
    matches("headerBtn", "height", AnalysisLayout.headerBtnHeight)
    matches("boardSection", "paddingTop", AnalysisLayout.boardPaddingTop)
    matches("statusToolbarRow", "minHeight", AnalysisLayout.statusMinHeight)
    // The status line's own row uses the source's own (dead) `statusLine` block, not invented values.
    matches("statusLine", "minHeight", AnalysisLayout.statusLineMinHeight)
    matches("statusLine", "paddingHorizontal", AnalysisLayout.statusLinePaddingH)
    matches("statusLine", "paddingVertical", AnalysisLayout.statusLinePaddingV)
    expect(sourceNumber("statusLine", "minHeight") != sourceNumber("statusToolbarRow", "minHeight"),
           "the standalone status row and the combined row really are different heights in the source")
    matches("statusToolbarRow", "paddingLeft", AnalysisLayout.statusPaddingLeft)
    matches("toolBtn", "paddingHorizontal", AnalysisLayout.toolBtnPaddingH)
    matches("toolBtn", "paddingVertical", AnalysisLayout.toolBtnPaddingV)
    matches("toolBtn", "borderRadius", AnalysisLayout.toolBtnRadius)
    matches("toolBtn", "minWidth", AnalysisLayout.toolBtnMinWidth)
    matches("navBtn", "paddingHorizontal", AnalysisLayout.navBtnPaddingH)
    matches("navBtn", "minWidth", AnalysisLayout.navBtnMinWidth)
    // The two eval bars — the case the prose spec conflates.
    matches("evalBarTrack", "height", AnalysisEval.mainHeight, "MAIN eval bar height")
    matches("evalBarTrack", "borderRadius", AnalysisEval.mainRadius)
    matches("engineEvalBarTrack", "height", AnalysisEval.microHeight, "MICRO eval bar height")
    matches("engineEvalBarTrack", "borderRadius", AnalysisEval.microRadius)
    // Palette
    expect(sourceString("container", "backgroundColor") == "#263238", "screen background matches the source")
    expect(sourceString("header", "backgroundColor") == "#1B2631", "surface matches the source")
    expect(sourceString("header", "borderBottomColor") == "#37474F", "divider matches the source")

    // The geometry formula reproduces the extracted reference value.
    if let geo = root["geometry"] as? [String: Any],
       let ref = geo["referenceDevice"] as? [String: Any],
       let w = (ref["width"] as? NSNumber).map({ CGFloat(truncating: $0) }),
       let ratio = (ref["pixelRatio"] as? NSNumber).map({ CGFloat(truncating: $0) }),
       let expected = (geo["BOARD_SIZE"] as? NSNumber).map({ CGFloat(truncating: $0) }) {
        expectNear(AnalysisBoard.size(screenWidth: w, pixelRatio: ratio), expected,
                   "the board formula reproduces the source geometry", 1e-6)
    } else {
        expect(false, "board_styles.json is missing its geometry block")
    }

    // ── 13. Arrow + badge geometry, against the render functions ───────────────
    // These live INSIDE a render function, so no StyleSheet holds them and they were transcribed by
    // hand — which is how the badge ended up in the wrong corner in BOTH languages, each asserting
    // the other's mistake. The extractor now flattens the expressions into signed terms, so this
    // checks the DIRECTION of an offset and not merely its magnitude.
    if let rc = root["renderConstants"] as? [String: Any] {
        /// The signed multiple of `ref` in an extracted expression; nil when absent.
        func ratioOf(_ expr: [String: Any]?, _ ref: String) -> CGFloat? {
            guard let terms = expr?["terms"] as? [[String: Any]] else { return nil }
            for t in terms where (t["ref"] as? String) == ref {
                guard let sign = (t["sign"] as? NSNumber).map({ CGFloat(truncating: $0) }),
                      let ratio = (t["ratio"] as? NSNumber).map({ CGFloat(truncating: $0) }) else { return nil }
                return sign * ratio
            }
            return nil
        }
        func expr(_ fn: String, _ name: String) -> [String: Any]? {
            (rc[fn] as? [String: Any])?[name] as? [String: Any]
        }
        /// The literal value of the i-th additive term, or nil.
        func constTerm(_ e: [String: Any]?, _ i: Int) -> CGFloat? {
            guard let terms = e?["terms"] as? [[String: Any]], i < terms.count,
                  let sign = (terms[i]["sign"] as? NSNumber).map({ CGFloat(truncating: $0) }),
                  let v = (terms[i]["value"] as? NSNumber).map({ CGFloat(truncating: $0) }) else { return nil }
            return sign * v
        }
        func textOf(_ e: [String: Any]?) -> String { (e?["text"] as? String) ?? "" }
        func ratio(_ fn: String, _ name: String, _ ref: String, _ mine: CGFloat, _ label: String? = nil) {
            let got = ratioOf(expr(fn, name), ref)
            expect(got != nil && near(got!, mine),
                   "\(label ?? "\(fn).\(name)"): encoded \(mine) != source \(got.map { "\($0)" } ?? "missing")")
        }

        // The anchor every offset below is measured from: squareToPixel returns the square CENTRE.
        ratio("squareToPixel", "return.x", "SQUARE_SIZE", 0.5, "squareToPixel anchors at the centre (x)")
        ratio("squareToPixel", "return.y", "SQUARE_SIZE", 0.5, "squareToPixel anchors at the centre (y)")
        // Arrows
        ratio("renderArrowsOverlay", "arrowWidth", "SQUARE_SIZE", AnalysisArrow.strokeRatio)
        ratio("renderArrowsOverlay", "headSize", "SQUARE_SIZE", AnalysisArrow.headRatio)
        ratio("renderArrowsOverlay", "shortenEnd", "headSize", AnalysisArrow.shortenRatio)
        expect(textOf(expr("renderArrowsOverlay", "leftX")).contains("headSize * 0.6"),
               "the arrowhead half-width is 0.6 of the head, as encoded")
        // Badge — the sign on cy is the whole point of this block.
        ratio("renderAnnotationOverlay", "r", "SQUARE_SIZE", AnalysisBadge.radiusRatio)
        ratio("renderAnnotationOverlay", "cx", "SQUARE_SIZE", AnalysisBadge.offsetRatio, "badge x offset")
        ratio("renderAnnotationOverlay", "cy", "SQUARE_SIZE", AnalysisBadge.offsetRatio, "badge y offset")
        expect((ratioOf(expr("renderAnnotationOverlay", "cy"), "SQUARE_SIZE") ?? -1) > 0,
               "the badge sits BELOW the square centre — bottom-right, not upper-right")
        expect(ratioOf(expr("renderAnnotationOverlay", "cx"), "pos.x") == 1
                && ratioOf(expr("renderAnnotationOverlay", "cy"), "pos.y") == 1,
               "and it is offset from the centre the anchor returned, not from a corner")
        if let fontSize = expr("renderAnnotationOverlay", "fontSize") {
            expect(ratioOf(fontSize["whenTrue"] as? [String: Any], "r") == AnalysisBadge.fontRatioLong,
                   "a two-character symbol uses r * 0.88")
            expect(ratioOf(fontSize["whenFalse"] as? [String: Any], "r") == AnalysisBadge.fontRatioShort,
                   "a one-character symbol uses r * 1.1")
        } else {
            expect(false, "renderConstants is missing the badge fontSize expression")
        }
        expect(ratioOf(expr("renderAnnotationOverlay", "Circle[0].cx"), "cx") == 1
                && constTerm(expr("renderAnnotationOverlay", "Circle[0].cx"), 1) == AnalysisBadge.shadowOffset
                && constTerm(expr("renderAnnotationOverlay", "Circle[0].cy"), 1) == AnalysisBadge.shadowOffset,
               "the drop shadow is offset by +1.5 on both axes")
        expect(constTerm(expr("renderAnnotationOverlay", "Circle[1].r"), 1) == AnalysisBadge.ringExtra,
               "the white ring is r + 1.5")
        ratio("renderAnnotationOverlay", "SvgText[0].y", "fontSize", AnalysisBadge.baselineRatio,
              "the text baseline is cy + fontSize * 0.37")
        expect(ratioOf(expr("renderAnnotationOverlay", "SvgText[0].y"), "cy") == 1,
               "and it is measured from the badge centre")
    } else {
        expect(false, "board_styles.json is missing renderConstants — re-run the extractor")
    }

    // ── 14. The sidebar, Setup Position and the remaining modals ───────────────
    if let sidebar = sheets["sidebarStyles"] as? [String: Any] {
        func sb(_ key: String, _ prop: String, _ mine: CGFloat, _ label: String? = nil) {
            let real = ((sidebar[key] as? [String: Any])?[prop] as? NSNumber)
                .map { CGFloat(truncating: $0) }
            expect(real != nil && near(real!, mine),
                   "\(label ?? "sidebarStyles.\(key).\(prop)"): encoded \(mine) "
                   + "!= source \(real.map { "\($0)" } ?? "missing")")
        }
        sb("header", "paddingHorizontal", AnalysisMenu.headerPaddingH)
        sb("header", "paddingTop", AnalysisMenu.headerPaddingTop)
        sb("header", "paddingBottom", AnalysisMenu.headerPaddingBottom)
        sb("headerTitle", "fontSize", AnalysisMenu.titleSize)
        sb("headerTitle", "letterSpacing", AnalysisMenu.titleTracking)
        sb("closeBtn", "width", AnalysisMenu.closeSize)
        sb("closeBtn", "borderRadius", AnalysisMenu.closeRadius)
        sb("closeBtnText", "fontSize", AnalysisMenu.closeGlyphSize)
        sb("sectionTitle", "fontSize", AnalysisMenu.sectionSize)
        sb("sectionTitle", "letterSpacing", AnalysisMenu.sectionTracking)
        sb("sectionTitle", "paddingTop", AnalysisMenu.sectionPaddingTop)
        sb("sectionTitle", "paddingBottom", AnalysisMenu.sectionPaddingBottom)
        sb("menuItem", "paddingVertical", AnalysisMenu.itemPaddingV)
        sb("menuItem", "paddingHorizontal", AnalysisMenu.itemPaddingH)
        sb("menuIcon", "fontSize", AnalysisMenu.iconSize)
        sb("menuIcon", "width", AnalysisMenu.iconWidth)
        sb("menuLabel", "fontSize", AnalysisMenu.labelSize)
        sb("toggleDot", "width", AnalysisMenu.dotSize)
        expect((sidebar["toggleDotActive"] as? [String: Any])?["backgroundColor"] as? String == "#4CAF50",
               "the lit toggle dot is green")
        // The width is device-derived: the RATIO is encoded, and it must reproduce the literal.
        if let container = sidebar["container"] as? [String: Any],
           let real = (container["width"] as? NSNumber).map({ CGFloat(truncating: $0) }),
           let geo = root["geometry"] as? [String: Any],
           let ref = geo["referenceDevice"] as? [String: Any],
           let w = (ref["width"] as? NSNumber).map({ CGFloat(truncating: $0) }) {
            expectNear(AnalysisMenu.width(screenWidth: w), real,
                       "the sidebar width ratio reproduces the source value", 1e-6)
            // The trap: styles.menuContainer is a DEAD menu at a different ratio.
            if let dead = (styles["menuContainer"] as? [String: Any])?["width"] as? NSNumber {
                expect(CGFloat(truncating: dead) != real,
                       "the dead styles.menuContainer really is a different width")
            }
        } else {
            expect(false, "sidebarStyles.container.width is missing")
        }
    } else {
        expect(false, "board_styles.json is missing sidebarStyles")
    }

    // Setup Position
    matches("editPanelCompact", "borderRadius", AnalysisEdit.panelRadius)
    matches("editPanelCompact", "padding", AnalysisEdit.panelPadding)
    matches("editPanelTitle", "fontSize", AnalysisEdit.titleSize)
    matches("editPanelHint", "fontSize", AnalysisEdit.hintSize)
    matches("editPanelTitleRow", "marginBottom", AnalysisEdit.titleRowGap)
    matches("editPaletteRowCompact", "gap", AnalysisEdit.paletteGap)
    matches("editPieceBtnCompact", "width", AnalysisEdit.pieceButton)
    matches("editPieceBtnCompact", "borderRadius", AnalysisEdit.pieceButtonRadius)
    matches("editPieceBtnActive", "borderWidth", AnalysisEdit.activeBorder)
    matches("editActionsRow", "gap", AnalysisEdit.actionGap)
    matches("editActionBtn", "paddingVertical", AnalysisEdit.actionPaddingV)
    matches("editActionBtn", "borderRadius", AnalysisEdit.actionRadius)
    matches("editActionBtnText", "fontSize", AnalysisEdit.actionSize)
    matches("editCastlingLabel", "fontSize", AnalysisEdit.castlingLabelSize)
    matches("editCastlingLabel", "letterSpacing", AnalysisEdit.castlingTracking)
    matches("editCastlingRow", "gap", AnalysisEdit.castlingGap)
    matches("editCastlingBtn", "paddingVertical", AnalysisEdit.castlingPaddingV)
    matches("editCastlingBtn", "borderRadius", AnalysisEdit.castlingRadius)
    matches("editCastlingBtnText", "fontSize", AnalysisEdit.castlingSize)
    matches("editValidationError", "fontSize", AnalysisEdit.errorSize)
    matches("editDoneBtnCompact", "paddingVertical", AnalysisEdit.donePaddingV)
    matches("editDoneBtnCompact", "borderRadius", AnalysisEdit.doneRadius)
    matches("editDoneBtnCompactText", "fontSize", AnalysisEdit.doneSize)
    matches("editDoneBtnCompactText", "letterSpacing", AnalysisEdit.doneTracking)
    matches("editFenRow", "gap", AnalysisEdit.fenGap)
    matches("editFenInput", "borderRadius", AnalysisEdit.fenRadius)
    matches("editFenInput", "paddingHorizontal", AnalysisEdit.fenPaddingH)
    matches("editFenInput", "paddingVertical", AnalysisEdit.fenPaddingV)
    matches("editFenInput", "fontSize", AnalysisEdit.fenSize)
    matches("editFenLoadBtn", "paddingHorizontal", AnalysisEdit.loadPaddingH)
    matches("editFenLoadBtnText", "fontSize", AnalysisEdit.loadSize)
    expect(sourceString("editPieceBtnActive", "borderColor") == "#FDB022",
           "the active palette border is the gold")
    expect(sourceString("editCastlingBtnOn", "borderColor") == "#4CAF50",
           "a lit castling chip is green")

    // The remaining modals
    matches("pgnModalContent", "borderRadius", AnalysisModals.pgnRadius)
    matches("pgnModalContent", "padding", AnalysisModals.pgnPadding)
    matches("pgnTextInput", "borderRadius", AnalysisModals.pgnInputRadius)
    matches("pgnTextInput", "minHeight", AnalysisModals.pgnInputMinHeight)
    matches("pgnTextInput", "maxHeight", AnalysisModals.pgnInputMaxHeight)
    matches("pgnTextInput", "fontSize", AnalysisModals.pgnInputSize)
    matches("pgnTextInput", "padding", AnalysisModals.pgnInputPadding)
    matches("branchModal", "borderRadius", AnalysisModals.branchRadius)
    matches("branchModal", "padding", AnalysisModals.branchPadding)
    matches("branchModal", "width", AnalysisModals.branchWidth)
    matches("branchModalTitle", "fontSize", AnalysisModals.branchTitleSize)
    matches("branchModalSub", "fontSize", AnalysisModals.branchSubSize)
    matches("branchOption", "borderRadius", AnalysisModals.optionRadius)
    matches("branchOption", "borderLeftWidth", AnalysisModals.optionBorderWidth)
    matches("branchOptionMove", "fontSize", AnalysisModals.optionMoveSize)
    matches("branchOptionPreview", "fontSize", AnalysisModals.optionPreviewSize)
    matches("varModalSheet", "borderTopLeftRadius", AnalysisModals.varSheetRadius)
    matches("varModalHandle", "width", AnalysisModals.varHandleW)
    matches("varModalHandle", "height", AnalysisModals.varHandleH)
    matches("varActionRow", "paddingVertical", AnalysisModals.varActionPaddingV)
    matches("varActionRow", "borderRadius", AnalysisModals.varActionRadius)
    matches("varActionRow", "gap", AnalysisModals.varActionGap)
    matches("varActionTitle", "fontSize", AnalysisModals.varTitleSize)
    matches("varActionSub", "fontSize", AnalysisModals.varSubtitleSize)
    matches("annotationPicker", "borderRadius", AnalysisModals.pickerRadius)
    matches("annotationPicker", "padding", AnalysisModals.pickerPadding)
    matches("annotationPicker", "width", AnalysisModals.pickerWidth)
    matches("annotationPickerTitle", "fontSize", AnalysisType.annotationPickerTitle)
    matches("annotationGrid", "gap", AnalysisModals.gridGap)
    matches("annotationGrid", "marginBottom", AnalysisModals.gridMarginBottom)
    matches("annotationBtn", "width", AnalysisModals.btnW)
    matches("annotationBtn", "height", AnalysisModals.btnH)
    matches("annotationBtn", "borderRadius", AnalysisModals.btnRadius)
    matches("annotationBtnSymbol", "fontSize", AnalysisType.annotationSymbol)
    matches("annotationBtnLabel", "fontSize", AnalysisType.annotationLabel)
    matches("annotationBtnLabel", "marginTop", AnalysisModals.labelGap)
    matches("annotationClearBtn", "borderRadius", AnalysisModals.clearRadius)
    matches("annotationClearBtn", "paddingVertical", AnalysisModals.clearPaddingV)
    matches("annotationClearBtnText", "fontSize", AnalysisModals.clearSize)
    if let ap = (sheets["annotPickerStyles"] as? [String: Any])?["sectionLabel"] as? [String: Any] {
        expect((ap["fontSize"] as? NSNumber).map { CGFloat(truncating: $0) } == AnalysisType.annotationSection,
               "annotPickerStyles.sectionLabel.fontSize")
        expect((ap["letterSpacing"] as? NSNumber).map { CGFloat(truncating: $0) } == AnalysisModals.sectionTracking,
               "annotPickerStyles.sectionLabel.letterSpacing")
        expect((ap["marginTop"] as? NSNumber).map { CGFloat(truncating: $0) } == AnalysisModals.sectionMarginTop,
               "annotPickerStyles.sectionLabel.marginTop")
    } else {
        expect(false, "board_styles.json is missing annotPickerStyles")
    }
    // The palette square colours are inline JSX, but renderEditSquare paints the same pair and IS
    // extracted — so they are still checked against the source rather than eyeballed.
    if let rc2 = root["renderConstants"] as? [String: Any],
       let editSq = (rc2["renderEditSquare"] as? [String: Any])?["bgColor"] as? [String: Any],
       let text = editSq["text"] as? String {
        expect(text.contains("#E8D5B0") && text.contains("#A87E5A"),
               "the palette colours are the ones renderEditSquare paints")
    } else {
        expect(false, "renderConstants is missing renderEditSquare")
    }
    // The palette piece size is a module constant, so it is pinned too.
    if let consts2 = root["moduleConstants"] as? [String: Any],
       let size = (consts2["EDIT_PALETTE_PIECE_SIZE"] as? NSNumber).map({ CGFloat(truncating: $0) }) {
        expectNear(AnalysisEdit.piece, size, "EDIT_PALETTE_PIECE_SIZE")
    } else {
        expect(false, "moduleConstants is missing EDIT_PALETTE_PIECE_SIZE")
    }

    // The DELIBERATE deviation: assert the source really has the bug, and that we differ.
    if let consts = root["moduleConstants"] as? [String: Any],
       let positions = consts["POSITION_ANNOTATIONS"] as? [[String: Any]] {
        let srcSlight = positions.first { ($0["symbol"] as? String) == "⩱" }
        expect((srcSlight?["label"] as? String)?.contains("White") == true,
               "the RN source really does label ⩱ as White — the bug being fixed")
        expect(slightBlack?.label.contains("Black") == true, "and we deliberately differ")
    } else {
        expect(false, "board_styles.json is missing POSITION_ANNOTATIONS")
    }

    return AnalysisMetricsCheckResult(passed: passed, failures: failures)
}
