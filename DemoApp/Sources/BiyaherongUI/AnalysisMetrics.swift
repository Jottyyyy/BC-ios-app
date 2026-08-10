import SwiftUI

// The Analysis Board's PURE layer: board geometry, the seven bands, the palette, the arrow and badge
// geometry, the eval bar and graph, the display tables, and the timings.
//
// Nothing here builds a view, which is the point — `AnalysisMetricsCheck` (the runnable self-check
// executable, since this toolchain has no XCTest) asserts every function without a running UI. The
// rule that keeps that true, inherited from the home screen: **no numeric literal and no arithmetic
// in any view body.** Every number on the screen is a stored property or a pure function from here.
//
// Ported from ../BYAHERONG-COACH-FRONTEND/app/(app)/user/analysis-board/board.tsx — and not by hand.
// `tools/metrics/extract_board_styles.js` walks that file's TypeScript AST and emits
// `tools/metrics/board_styles.json` (328 style keys, 1,355 properties, zero unresolved); the check
// asserts the constants below against it. That matters: the written spec says "eval bar height 3",
// but the source has TWO bars — the main one is 8, and only the per-line micro bar is 3.
//
// Deviations from the RN source are marked DEVIATION and are asserted as deliberate.
//
// Mirrored line-for-line by web-demo/js/analysis-metrics.js.

// MARK: - Board geometry

enum AnalysisBoard {
    /// Piece art is 95% of a square (spec 3.1).
    static let pieceRatio: CGFloat = 0.95

    /// Snap the **physical** pixel width down to a multiple of 8 before dividing, so squares land on
    /// whole pixels and no seam appears between them at 2x/3x. From `DragDropChessBoard.tsx`.
    ///
    /// The board therefore ends up a point or two narrower than the screen — that is the trade.
    static func size(screenWidth: CGFloat, pixelRatio: CGFloat) -> CGFloat {
        let r = pixelRatio > 0 ? pixelRatio : 1
        let physical = (screenWidth * r).rounded()
        return (( physical / 8).rounded(.down) * 8) / r
    }

    static func square(screenWidth: CGFloat, pixelRatio: CGFloat) -> CGFloat {
        size(screenWidth: screenWidth, pixelRatio: pixelRatio) / 8
    }

    static func piece(square: CGFloat) -> CGFloat { square * pieceRatio }

    /// Logical square → visual column/row, origin top-left, honouring the flip.
    /// Identical to `BoardView.center(_:)`'s mapping — the two must never diverge.
    static func visual(_ sq: Int, flipped: Bool) -> (col: Int, row: Int) {
        let file = sq & 7, rank = sq >> 3
        return (col: flipped ? 7 - file : file, row: flipped ? rank : 7 - rank)
    }

    static func center(_ sq: Int, square: CGFloat, flipped: Bool) -> CGPoint {
        let v = visual(sq, flipped: flipped)
        return CGPoint(x: (CGFloat(v.col) + 0.5) * square, y: (CGFloat(v.row) + 0.5) * square)
    }

    /// Light-square test in LOGICAL coordinates (a1 = 0), matching `BoardView.cell`.
    static func isLight(_ sq: Int) -> Bool { (((sq & 7) + (sq >> 3)) % 2) == 1 }
}

// MARK: - Palette

/// Colours this screen introduces. Screen-local by the same argument `HomePalette` makes: `Theme` is
/// the global design system, and the Analysis Board's warm blue-greys belong to one screen.
/// Everything already in `Theme` — `.gold`, `.foreground`, `.border` — is reused, not redefined.
enum AnalysisPalette {
    static let screenBg = Theme.c(0x263238)      // warmer than the app's navy; deliberate
    static let surface = Theme.c(0x1B2631)       // header, status bar, strips, panels, sheets
    static let surfaceAlt = Theme.c(0x37474F)    // buttons, chips, inputs, autoplay bar
    static let surfaceAlt2 = Theme.c(0x2D3E49)   // rows inside panels
    static let sheetChrome = Theme.c(0x263040)
    static let promoTile = Theme.c(0x455A64)
    static let divider = Theme.c(0x37474F)
    static let dividerDark = Theme.c(0x263040)

    static let gold = Theme.c(0xFDB022)
    static let onGold = Theme.c(0x0F1A2E)

    static let textPrimary = Theme.c(0xECEFF1)
    static let textSecondary = Theme.c(0x90A4AE)
    static let textSecondaryAlt = Theme.c(0x8BA3C7)
    static let textMuted = Theme.c(0x546E7A)
    static let textMutedAlt = Theme.c(0x5A6E87)

    static let success = Theme.c(0x4CAF50)
    static let danger = Theme.c(0xF44336)
    /// The engine's "analyzing" spinner is blue; every other spinner on the screen is gold.
    static let spinner = Theme.c(0x90CAF9)

    static let evalTrack = Theme.c(0x2A3540)
    static let evalFill = Theme.c(0xDEDEDE)

    /// Edit mode uses its own board colours, ignoring the user's theme, so it reads unmistakably as
    /// "you are editing".
    static let editLight = Theme.c(0xE8D5B0)
    static let editDark = Theme.c(0xA87E5A)

    static let reviewCard = Theme.c(0x151E2A)
    static let graphBg = Theme.c(0x0F1A2E)
}

// MARK: - Board themes and square fill

/// DEVIATION: the RN board had one colour pair. Three user-selectable themes are new (spec 3.2).
enum BoardTheme: String, CaseIterable, Identifiable, Sendable {
    case classic, green, blue
    var id: String { rawValue }

    var label: String {
        switch self {
        case .classic: return "Classic Brown"
        case .green: return "Tournament Green"
        case .blue: return "Blue"
        }
    }
    var light: Color {
        switch self {
        case .classic: return Theme.c(0xF0D9B5)
        case .green: return Theme.c(0xEEEED2)
        case .blue: return Theme.c(0xBFD4E0)
        }
    }
    var dark: Color {
        switch self {
        case .classic: return Theme.c(0xB58863)
        case .green: return Theme.c(0x769656)
        case .blue: return Theme.c(0x6B8FA8)
        }
    }
    static let `default`: BoardTheme = .classic
}

/// How a board draws its squares and indicators.
///
/// The defaults reproduce what `BoardView` renders today, exactly, so Play and Puzzles are unchanged
/// when no style is supplied. The Analysis Board passes `.analysis(theme:)`.
///
/// `replacesFill` is the load-bearing difference: the Analysis Board's highlights **replace** the
/// square colour, while the existing board tints translucent layers over it.
struct BoardStyle: Equatable {
    var light: Color = Theme.boardLight
    var dark: Color = Theme.boardDark
    var lastMove: Color = Theme.accent.opacity(0.32)
    var selected: Color = Theme.accent.opacity(0.55)
    var check: Color = Theme.negative.opacity(0.5)
    var targetRing: Color = Theme.foreground.opacity(0.3)
    var targetDot: Color = Theme.foreground.opacity(0.22)
    var dotRatio: CGFloat = 0.32
    var ringInset: CGFloat = 3
    var ringLineWidth: CGFloat = 4
    var replacesFill: Bool = false

    /// A method, not a stored property, so no arithmetic has to appear in a view body.
    /// (The base name must differ from `dotRatio` — Swift will not let a stored property and a
    /// method share one, which is why `HomeMetrics` uses `innerGap(rowHeight:)` rather than
    /// `cardGap(...)`.)
    func dotSize(square: CGFloat) -> CGFloat { square * dotRatio }

    static func analysis(theme: BoardTheme = .default) -> BoardStyle {
        BoardStyle(light: theme.light,
                   dark: theme.dark,
                   lastMove: AnalysisIndicator.lastMove,
                   selected: AnalysisIndicator.selected,
                   check: Theme.negative.opacity(0.5),
                   targetRing: AnalysisIndicator.ringStroke,
                   targetDot: AnalysisIndicator.dotFill,
                   dotRatio: AnalysisIndicator.dotRatio,
                   ringInset: 0,
                   ringLineWidth: 0,          // derived from the square instead — see ringStrokeWidth
                   replacesFill: true)
    }
}

/// Highlight colours and legal-move indicators (spec 3.3, 3.7).
enum AnalysisIndicator {
    static let selected = Theme.c(0xF6F669)
    static let lastMove = Theme.c(0xCDD26A)

    static let dotRatio: CGFloat = 0.3
    static let dotFill = Color.black.opacity(0.2)
    static let ringRatio: CGFloat = 0.85
    static let ringStrokeRatio: CGFloat = 0.08
    static let ringStroke = Color.black.opacity(0.25)

    static func dotSize(square: CGFloat) -> CGFloat { square * dotRatio }
    static func ringSize(square: CGFloat) -> CGFloat { square * ringRatio }
    static func ringStrokeWidth(square: CGFloat) -> CGFloat { square * ringStrokeRatio }
}

// MARK: - Arrows (spec 3.9)

enum AnalysisArrow {
    static let strokeRatio: CGFloat = 0.18
    static let headRatio: CGFloat = 0.35
    /// The shaft stops short of the tip so it does not poke through the arrowhead.
    static let shortenRatio: CGFloat = 0.7
    static let headHalfWidthRatio: CGFloat = 0.6

    static let colors: [Color] = [
        Color(.sRGB, red: 76 / 255, green: 175 / 255, blue: 80 / 255, opacity: 0.85),   // #1 best
        Color(.sRGB, red: 68 / 255, green: 138 / 255, blue: 255 / 255, opacity: 0.80),  // #2
        Color(.sRGB, red: 255 / 255, green: 152 / 255, blue: 0 / 255, opacity: 0.80),   // #3
    ]
    static func color(rank: Int) -> Color {
        colors[min(max(rank, 0), colors.count - 1)]
    }

    struct Geometry: Equatable {
        var start: CGPoint
        var end: CGPoint
        var tip: CGPoint
        var left: CGPoint
        var right: CGPoint
        var strokeWidth: CGFloat
        var headSize: CGFloat
    }

    /// Knight moves are drawn as straight diagonals, not L-shapes.
    static func geometry(from: Int, to: Int, square: CGFloat, flipped: Bool) -> Geometry {
        let a = AnalysisBoard.center(from, square: square, flipped: flipped)
        let b = AnalysisBoard.center(to, square: square, flipped: flipped)
        let dx = b.x - a.x, dy = b.y - a.y
        let len = (dx * dx + dy * dy).squareRoot()
        let ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0
        let head = square * headRatio
        let shorten = head * shortenRatio
        let half = head * headHalfWidthRatio
        return Geometry(
            start: a,
            end: CGPoint(x: b.x - ux * shorten, y: b.y - uy * shorten),
            tip: b,
            left: CGPoint(x: b.x - ux * head - (-uy) * half, y: b.y - uy * head - ux * half),
            right: CGPoint(x: b.x - ux * head + (-uy) * half, y: b.y - uy * head + ux * half),
            strokeWidth: square * strokeRatio,
            headSize: head)
    }
}

// MARK: - Annotation badge (spec 3.10)

enum AnalysisBadge {
    static let radiusRatio: CGFloat = 0.21
    static let offsetRatio: CGFloat = 0.29
    static let shadowOffset: CGFloat = 1.5
    static let ringExtra: CGFloat = 1.5
    static let fontRatioShort: CGFloat = 1.1
    static let fontRatioLong: CGFloat = 0.88
    static let baselineRatio: CGFloat = 0.37

    struct Geometry: Equatable {
        var center: CGPoint
        var radius: CGFloat
        var ringRadius: CGFloat
        var shadowCenter: CGPoint
        var fontSize: CGFloat
        var textBaseline: CGFloat
    }

    static func geometry(_ sq: Int, square: CGFloat, flipped: Bool, symbolLength: Int) -> Geometry {
        let c = AnalysisBoard.center(sq, square: square, flipped: flipped)
        let r = square * radiusRatio
        // BOTTOM-right. `squareToPixel` returns the square CENTRE and renderAnnotationOverlay adds
        // `+ SQUARE_SIZE * 0.29` to BOTH axes (board.tsx:2676-2678). This read `- offsetRatio` until
        // Phase 11 — see renderConstants in board_styles.json, which now pins the sign.
        let cx = c.x + square * offsetRatio
        let cy = c.y + square * offsetRatio
        let font = r * (symbolLength > 1 ? fontRatioLong : fontRatioShort)
        return Geometry(center: CGPoint(x: cx, y: cy),
                        radius: r,
                        ringRadius: r + ringExtra,
                        shadowCenter: CGPoint(x: cx + shadowOffset, y: cy + shadowOffset),
                        fontSize: font,
                        textBaseline: cy + font * baselineRatio)
    }
}

// MARK: - Bands (spec 1.2)

/// Unscaled band constants, straight from the RN StyleSheet.
enum AnalysisLayout {
    static let headerPaddingH: CGFloat = 8
    static let headerPaddingV: CGFloat = 6
    static let headerBtnWidth: CGFloat = 40
    static let headerBtnHeight: CGFloat = 36
    static let headerBorder: CGFloat = 1

    static let boardPaddingTop: CGFloat = 4

    static let statusMinHeight: CGFloat = 38
    /// The status text gets its OWN row here, not the left half of the toolbar row. These are the
    /// source's own numbers for exactly that: `styles.statusLine` is declared with a standalone
    /// row's metrics and then never rendered — dead, like `renderEvalBar` and `menuContainer`. Nine
    /// emoji buttons measure 346pt in a 365pt card, so the combined row leaves the status ~19pt and
    /// it vanishes; RN's icon glyphs are narrower than emoji, which is why the source got away with
    /// it. Deviation recorded in PORTING_NOTES.
    static let statusLineMinHeight: CGFloat = 36
    static let statusLinePaddingH: CGFloat = 12
    static let statusLinePaddingV: CGFloat = 6
    static let statusPaddingLeft: CGFloat = 8
    static let statusBorder: CGFloat = 1

    static let toolBtnPaddingH: CGFloat = 8
    static let toolBtnPaddingV: CGFloat = 6
    static let toolBtnRadius: CGFloat = 6
    static let toolBtnMinWidth: CGFloat = 36
    static let navBtnPaddingH: CGFloat = 5
    static let navBtnPaddingV: CGFloat = 6
    static let navBtnRadius: CGFloat = 6
    static let navBtnMinWidth: CGFloat = 30

    static let autoplayPaddingV: CGFloat = 6

    static let stripMaxHeight: CGFloat = 44
    static let stripPaddingH: CGFloat = 8
    static let stripPaddingV: CGFloat = 6
    static let stripGap: CGFloat = 2

    static let panelsMaxHeight: CGFloat = 230
    static let panelsPaddingH: CGFloat = 8

    static let enginePaddingH: CGFloat = 6
    static let enginePaddingTop: CGFloat = 3
    static let enginePaddingBottom: CGFloat = 4
    static let engineStripEstimate: CGFloat = 60

    // Move-strip tokens and branch chips — real values (`movesStripMove`, `altChip`).
    static let tokenPaddingH: CGFloat = 5
    static let tokenPaddingV: CGFloat = 2
    static let tokenRadius: CGFloat = 3
    static let chipPaddingH: CGFloat = 8
    static let chipPaddingV: CGFloat = 4
    /// The gap before a reviewed move's classification symbol (`marginLeft: 1`, board.tsx:3092).
    static let classMarkGap: CGFloat = 1

    // Engine rows — real values (`engineChipEval.width`, `engineLineRow`).
    static let engineEvalWidth: CGFloat = 36
    static let engineRowGap: CGFloat = 4
    static let engineRowPaddingV: CGFloat = 1
    static let engineRowPaddingH: CGFloat = 2

    // Chrome this port introduces (the ECO panel and the branch picker have no RN counterpart
    // worth copying — one was a network panel, the other is rebuilt as an overlay). Small, local,
    // and asserted so they cannot drift between the two languages.
    static let toolGap: CGFloat = 2
    static let statusLineLimit = 2          // RN: numberOfLines={2}
    static let singleLine = 1
    static let rowGap: CGFloat = 3
    static let rowSpacing: CGFloat = 6
    static let rowPaddingH: CGFloat = 8
    static let rowPaddingV: CGFloat = 5
    static let bookSanWidth: CGFloat = 46
    static let engineSanWidth: CGFloat = 38
    static let scrimOpacity: Double = 0.55
    static let sheetPadding: CGFloat = 10
    static let sheetRadius: CGFloat = 12
    static let sheetMaxWidth: CGFloat = 280

    struct Bands: Equatable {
        var fixed: CGFloat
        var board: CGFloat
        var panels: CGFloat
        var total: CGFloat { fixed + board + panels }
        func fits(_ viewportHeight: CGFloat) -> Bool { total <= viewportHeight }
    }

    /// DEVIATION: the spec lists seven literal band heights, which overflow a 375×667 screen. The
    /// fixed bands keep their source values; the panels band gives way first, then the board.
    static func bands(viewportHeight: CGFloat, boardEdge: CGFloat) -> Bands {
        let fixed = headerBtnHeight + statusMinHeight + stripMaxHeight + engineStripEstimate
        let board = min(boardEdge, max(0, viewportHeight - fixed))
        let panels = max(0, min(panelsMaxHeight, viewportHeight - fixed - board))
        return Bands(fixed: fixed, board: board, panels: panels)
    }
}

// MARK: - Eval bar and graph

enum AnalysisEval {
    /// The MAIN bar under the board is 8; only the per-engine-line micro bar is 3. The written spec
    /// says "height 3" without distinguishing them.
    static let mainHeight: CGFloat = 8
    static let mainRadius: CGFloat = 4
    static let microHeight: CGFloat = 3
    static let microRadius: CGFloat = 1
    static let microMarginBottom: CGFloat = 4
    static let clamp: Int = 500
    /// `AnalysisTiming.evalBarAnimationMs` as seconds, so no view body divides by 1000.
    static let animationSeconds: Double = Double(AnalysisTiming.evalBarAnimationMs) / 1000

    /// White's share of the bar, 0…1. A mate pins to 0.95 / 0.05 rather than the full end.
    static func fraction(cp: Int?, mate: Int?) -> CGFloat {
        if let m = mate { return m > 0 ? 0.95 : 0.05 }
        guard let c = cp else { return 0.5 }
        return 0.5 + CGFloat(min(max(c, -clamp), clamp)) / CGFloat(clamp * 2)
    }
}

enum AnalysisGraph {
    static let height: CGFloat = 52
    static let radius: CGFloat = 6
    static let clamp: Int = 500
    static let lineWidth: CGFloat = 1.5

    /// Top of the graph is +500 (White winning); mate saturates.
    static func point(cp: Int?, mate: Int?, index: Int, count: Int,
                      width: CGFloat, height: CGFloat) -> CGPoint {
        let raw = mate.map { $0 > 0 ? clamp : -clamp } ?? (cp ?? 0)
        let c = min(max(raw, -clamp), clamp)
        let x = count > 1 ? CGFloat(index) * (width / CGFloat(count - 1)) : 0
        let y = (CGFloat(clamp - c) / CGFloat(clamp * 2)) * height
        return CGPoint(x: x, y: y)
    }
}

// MARK: - Game review (spec 9; `accModalStyles` + components/EvalGraph.tsx)

/// The accuracy modal and the eval graph.
///
/// Every value here is a real StyleSheet number from `accModalStyles` (29 keys), except the two
/// noted below. `AnalysisMetricsCheck` and the JS twin both pin them to the extraction.
enum AnalysisReview {
    // Scrim and card
    static let scrim = Color.black.opacity(0.92)
    static let overlayPaddingH: CGFloat = 16
    static let overlayPaddingV: CGFloat = 24
    static let cardRadius: CGFloat = 18
    static let cardBorder: CGFloat = 1
    static let cardBorderColor = Theme.c(0xFDB022, 0.20)
    /// DEVICE-DERIVED: the source is `screenHeight * 0.80`, which the extractor folds to 675.2
    /// against its 390x844 reference. Encoding that literal would be wrong on every other screen,
    /// so the ratio is what lives here. `board_styles.json`'s `_deviceDerived` lists all three
    /// values of this shape.
    static let cardMaxHeightRatio: CGFloat = 0.80
    static func cardMaxHeight(viewportHeight: CGFloat) -> CGFloat {
        viewportHeight * cardMaxHeightRatio
    }

    // Header
    static let headerPaddingTop: CGFloat = 20
    static let headerPaddingBottom: CGFloat = 14
    static let headerPaddingH: CGFloat = 20
    static let hairline: CGFloat = 1
    static let hairlineColor = Theme.c(0xFFFFFF, 0.07)
    static let titleSize: CGFloat = 13
    static let titleTracking: CGFloat = 2.5

    // Loading / cancelled state
    static let loadingPaddingV: CGFloat = 36
    static let loadingPaddingH: CGFloat = 24
    static let loadingTextSize: CGFloat = 16
    static let loadingTextColor = Theme.c(0xE0E0E0)
    static let loadingGap: CGFloat = 6
    static let hintSize: CGFloat = 12
    static let hintColor = Theme.c(0xFFFFFF, 0.35)
    static let spinnerGap: CGFloat = 14
    static let skipMarginTop: CGFloat = 20
    static let skipPaddingV: CGFloat = 10
    static let skipPaddingH: CGFloat = 28
    static let skipRadius: CGFloat = 8
    static let skipBorderColor = Theme.c(0xFFFFFF, 0.18)
    static let skipTextSize: CGFloat = 13
    static let skipTextColor = Theme.c(0xFFFFFF, 0.45)

    // Results
    static let contentPaddingH: CGFloat = 20
    static let contentPaddingTop: CGFloat = 18
    static let contentPaddingBottom: CGFloat = 4
    static let sectionGap: CGFloat = 18
    static let playerNameSize: CGFloat = 12
    static let playerNameColor = Theme.c(0xFFFFFF, 0.45)
    static let playerNameGap: CGFloat = 4
    static let scoreSize: CGFloat = 36
    static let scoreLineHeight: CGFloat = 40
    static let scoreLabelSize: CGFloat = 10
    static let scoreLabelColor = Theme.c(0xFFFFFF, 0.25)
    static let scoreLabelTracking: CGFloat = 1.5
    static let scoreLabelGap: CGFloat = 2
    static let dividerWidth: CGFloat = 1
    static let dividerHeight: CGFloat = 64
    static let dividerColor = Theme.c(0xFFFFFF, 0.10)
    static let dividerMarginH: CGFloat = 12

    // Classification table
    static let tableHeaderPaddingBottom: CGFloat = 6
    static let tableHeaderGap: CGFloat = 2
    static let sideColumnWidth: CGFloat = 36
    static let sideLabelSize: CGFloat = 10
    static let sideLabelColor = Theme.c(0xFFFFFF, 0.30)
    static let rowPaddingV: CGFloat = 7
    static let rowRuleColor = Theme.c(0xFFFFFF, 0.04)
    static let countSize: CGFloat = 15
    static let centreGap: CGFloat = 7
    static let dotSize: CGFloat = 9
    static let dotRadius: CGFloat = 5
    static let nameSize: CGFloat = 13
    static let nameColor = Theme.c(0xFFFFFF, 0.75)

    // Footer
    static let footerPadding: CGFloat = 16
    static let buttonRadius: CGFloat = 12
    static let buttonPaddingV: CGFloat = 14
    static let buttonTextSize: CGFloat = 15
    static let buttonTextTracking: CGFloat = 0.3

    /// The accuracy number's colour band (`board.tsx:252-257`).
    static func accuracyColor(_ pct: Double) -> Color {
        if pct >= 80 { return Theme.c(0x4CAF50) }
        if pct >= 60 { return Theme.c(0xFFC107) }
        if pct >= 40 { return Theme.c(0xFF9800) }
        return Theme.c(0xF44336)
    }

    /// The graph is inset from the screen by this much (`width - 64` at the call site).
    static let graphInset: CGFloat = 64
}

/// The eval graph's own colours, from `components/EvalGraph.tsx` — a separate file from the modal.
///
/// Note the graph paints its OWN background (`#1A2740`) inside a wrapper that is already
/// `#0F1A2E` (`graphWrap`). Two different colours; missing that leaves the graph the wrong shade.
enum AnalysisGraphStyle {
    static let wrapRadius: CGFloat = 8
    static let wrapBackground = AnalysisPalette.graphBg     // #0F1A2E — the wrapper
    static let background = Theme.c(0x1A2740)               // the SVG's own fill
    static let backgroundRadius: CGFloat = 6
    static let whiteFill = Color.white.opacity(0.25)
    static let blackFill = Color.black.opacity(0.35)
    static let midLine = Color.white.opacity(0.15)
    static let midLineWidth: CGFloat = 1
    static let curve = Theme.c(0xFDB022)
}

// MARK: - Persistence: the save form and the library (spec 10)

/// The bottom sheets. Real values from `saveModalStyles` (13 keys), `loadModalStyles` (5), and the
/// bottom-sheet / folder-chip keys in the main `styles` block. All pinned by `AnalysisMetricsCheck`.
enum AnalysisLibraryStyle {
    // bottom sheet
    static let scrim = Color.black.opacity(0.7)
    static let sheetBg = AnalysisPalette.surface
    static let sheetRadius: CGFloat = 20
    static let sheetPadding: CGFloat = 20
    static let sheetMaxHeightRatio: CGFloat = 0.85
    static let headerGap: CGFloat = 4
    static let titleSize: CGFloat = 12
    static let closeSize: CGFloat = 14

    // form fields
    static let fieldGap: CGFloat = 8
    static let fieldBg = AnalysisPalette.surfaceAlt
    static let fieldRadius: CGFloat = 10
    static let fieldPaddingH: CGFloat = 14
    static let fieldPaddingV: CGFloat = 12
    static let fieldSize: CGFloat = 14
    static let ratingWidth: CGFloat = 80
    static let notesMinHeight: CGFloat = 56

    // result chips
    static let resultGap: CGFloat = 8
    static let resultMarginBottom: CGFloat = 10
    static let resultMarginTop: CGFloat = 2
    static let resultPaddingV: CGFloat = 10
    static let resultRadius: CGFloat = 10
    static let resultSize: CGFloat = 13
    static let resultIdle = AnalysisPalette.textSecondaryAlt

    // folder chips
    static let chipPaddingH: CGFloat = 14
    static let chipPaddingV: CGFloat = 8
    static let chipRadius: CGFloat = 16
    static let chipGap: CGFloat = 8
    static let chipSize: CGFloat = 13
    static let chipIdle = AnalysisPalette.textSecondary

    // footer buttons
    static let buttonGap: CGFloat = 10
    static let buttonMarginTop: CGFloat = 12
    static let buttonPaddingV: CGFloat = 14
    static let buttonRadius: CGFloat = 12
    static let buttonSize: CGFloat = 16
    static let cancelBg = AnalysisPalette.surfaceAlt
    static let saveBg = AnalysisPalette.success

    // library rows
    static let cardBg = AnalysisPalette.sheetChrome
    static let cardRadius: CGFloat = 12
    static let cardPadding: CGFloat = 14
    static let cardGap: CGFloat = 8
    static let primarySize: CGFloat = 14
    static let primaryGap: CGFloat = 3
    static let pgnSize: CGFloat = 12
    static let pgnColor = Theme.c(0x6B7B8D)
    static let metaSize: CGFloat = 11
    static let metaColor = AnalysisPalette.textMutedAlt
    static let metaGap: CGFloat = 4
    static let actionSize: CGFloat = 34
    static let actionRadius: CGFloat = 8
    static let actionBg = AnalysisPalette.surface

    static func sheetMaxHeight(viewportHeight: CGFloat) -> CGFloat {
        viewportHeight * sheetMaxHeightRatio
    }

    /// The four result options, in the source's order (board.tsx:3941).
    static let resultOptions = ["*", "1-0", "0-1", "1/2-1/2"]
    /// `*` renders as this in the picker (board.tsx:4003-4022).
    static func resultLabel(_ r: String) -> String { r == "*" ? "No Result (*)" : r }

    /// The row's headline: the players when there are any, else the title.
    static func primaryLine(_ rec: AnalysisSessionRecord) -> String {
        guard rec.whitePlayer != nil || rec.blackPlayer != nil else { return rec.title }
        let w = (rec.whitePlayer ?? "?") + (rec.whiteRating.map { " (\($0))" } ?? "")
        let b = (rec.blackPlayer ?? "?") + (rec.blackRating.map { " (\($0))" } ?? "")
        return "\(w) vs \(b)"
    }

    /// The movetext with headers stripped — what the row preview shows.
    static func pgnPreview(_ pgn: String, limit: Int = 55) -> String {
        var body = ""
        var inTag = false
        for ch in pgn {
            if ch == "[" { inTag = true; continue }
            if ch == "]" { inTag = false; continue }
            if !inTag { body.append(ch == "\n" ? " " : ch) }
        }
        let squashed = body.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
        return squashed.count > limit ? String(squashed.prefix(limit)) + "…" : squashed
    }
}

// MARK: - Tables

// MARK: - The ☰ sidebar (sidebarStyles, 12 keys; renderMenu:4489)

/// NOTE the trap: `styles.menuContainer` (W * 0.65) belongs to a DEAD menu. `renderMenu:4526` uses
/// `sidebarStyles.container` — W * 0.68 — and that is the one encoded here. Both are flagged in
/// board_styles.json's `_deviceDerived` for exactly this reason.
enum AnalysisMenu {
    static let scrim = Theme.c(0x000000, 0.55)
    /// NOT the literal 265.2 — that is one device's answer to `width * 0.68`.
    static let widthRatio: CGFloat = 0.68
    static let bg = AnalysisPalette.surface
    static let borderColor = AnalysisPalette.dividerDark
    static let borderWidth: CGFloat = 1

    static let headerPaddingH: CGFloat = 20
    static let headerPaddingTop: CGFloat = 56
    static let headerPaddingBottom: CGFloat = 16
    static let titleSize: CGFloat = 20
    static let titleColor = Theme.c(0xFFFFFF)
    static let titleTracking: CGFloat = 0.5

    static let closeSize: CGFloat = 32
    static let closeRadius: CGFloat = 16
    static let closeBg = AnalysisPalette.dividerDark
    static let closeGlyphSize: CGFloat = 16

    static let sectionSize: CGFloat = 11
    static let sectionColor = AnalysisPalette.textMutedAlt
    static let sectionTracking: CGFloat = 1.2
    static let sectionPaddingTop: CGFloat = 18
    static let sectionPaddingBottom: CGFloat = 6

    static let itemPaddingV: CGFloat = 13
    static let itemPaddingH: CGFloat = 20
    static let iconSize: CGFloat = 18
    static let iconWidth: CGFloat = 30
    static let labelSize: CGFloat = 15
    static let labelColor = Theme.c(0xE0E0E0)

    static let dotSize: CGFloat = 10
    static let dotIdle = Theme.c(0x455A64)
    static let dotActive = AnalysisPalette.success

    /// The sidebar's width on a given screen. A ratio, so it is right on every device.
    static func width(screenWidth: CGFloat) -> CGFloat { screenWidth * widthRatio }
}

// MARK: - Setup Position (the 28 `edit*` keys; renderEditPositionPanel:3615)

enum AnalysisEdit {
    static let panelBg = AnalysisPalette.surface
    static let panelRadius: CGFloat = 9
    static let panelPadding: CGFloat = 8

    static let titleSize: CGFloat = 13
    static let titleColor = AnalysisPalette.textPrimary
    static let hintSize: CGFloat = 10
    static let hintColor = AnalysisPalette.textMuted
    static let titleRowGap: CGFloat = 5

    static let paletteGap: CGFloat = 4
    static let paletteRowGap: CGFloat = 4
    static let pieceButton: CGFloat = 36
    static let pieceButtonRadius: CGFloat = 5
    static let piece: CGFloat = 26
    /// The palette rows' backgrounds — the same pair `renderEditSquare:2726` paints the board with,
    /// which is why they are the palette's `editLight`/`editDark` rather than a second copy.
    static let lightSquare = AnalysisPalette.editLight
    static let darkSquare = AnalysisPalette.editDark
    static let activeBorder: CGFloat = 2.5
    static let activeBorderColor = AnalysisPalette.gold
    static let activeFill = Theme.c(0xFDB022, 0.25)

    static let actionGap: CGFloat = 5
    static let actionPaddingV: CGFloat = 6
    static let actionRadius: CGFloat = 7
    static let actionBg = AnalysisPalette.surfaceAlt
    static let actionSize: CGFloat = 11
    static let actionColor = AnalysisPalette.textSecondary
    static let eraseActiveBg = Theme.c(0xC62828)
    static let eraseActiveText = Theme.c(0xFFCDD2)
    static let turnDarkBg = Theme.c(0x3A3A3A)
    static let turnDarkText = Theme.c(0xE0E0E0)
    static let turnLightText = Theme.c(0x1A1A1A)

    static let castlingLabelSize: CGFloat = 10
    static let castlingLabelColor = Theme.c(0x78909C)
    static let castlingTracking: CGFloat = 0.5
    static let castlingGap: CGFloat = 5
    static let castlingPaddingV: CGFloat = 6
    static let castlingRadius: CGFloat = 7
    static let castlingBg = AnalysisPalette.surfaceAlt
    static let castlingSize: CGFloat = 11
    static let castlingColor = AnalysisPalette.textMuted
    static let castlingOnBg = Theme.c(0x1B3A1E)
    static let castlingOnBorder = AnalysisPalette.success
    static let castlingOnColor = AnalysisPalette.success

    static let errorColor = AnalysisPalette.danger
    static let errorSize: CGFloat = 11

    static let doneBg = AnalysisPalette.gold
    static let donePaddingV: CGFloat = 8
    static let doneRadius: CGFloat = 9
    static let doneColor = AnalysisPalette.onGold
    static let doneSize: CGFloat = 13
    static let doneTracking: CGFloat = 0.3

    static let fenGap: CGFloat = 5
    static let fenBg = AnalysisPalette.surfaceAlt
    static let fenRadius: CGFloat = 7
    static let fenPaddingH: CGFloat = 10
    static let fenPaddingV: CGFloat = 5
    static let fenColor = AnalysisPalette.textPrimary
    static let fenSize: CGFloat = 12
    static let loadBorder = AnalysisPalette.gold
    static let loadColor = AnalysisPalette.gold
    static let loadPaddingH: CGFloat = 12
    static let loadSize: CGFloat = 12

    static let boardBorder: CGFloat = 1
    static let boardBorderColor = AnalysisPalette.divider
}

// MARK: - The remaining modals: PGN import, branch picker, variation card, annotation picker

enum AnalysisModals {
    // Import PGN (renderPgnModal:3757)
    static let pgnScrim = Theme.c(0x000000, 0.72)
    static let pgnBg = AnalysisPalette.surface
    static let pgnRadius: CGFloat = 20
    static let pgnPadding: CGFloat = 20
    static let pgnInputBg = AnalysisPalette.surfaceAlt
    static let pgnInputRadius: CGFloat = 10
    static let pgnInputMinHeight: CGFloat = 120
    static let pgnInputMaxHeight: CGFloat = 220
    static let pgnInputSize: CGFloat = 14
    static let pgnInputColor = AnalysisPalette.textPrimary
    static let pgnInputPadding: CGFloat = 14

    // Choose Continuation (renderBranchSelectionModal:4311)
    static let branchBg = AnalysisPalette.surface
    static let branchRadius: CGFloat = 16
    static let branchPadding: CGFloat = 20
    static let branchWidth: CGFloat = 350
    static let branchTitleSize: CGFloat = 17
    static let branchSubSize: CGFloat = 12
    static let optionBg = AnalysisPalette.surfaceAlt
    static let optionRadius: CGFloat = 10
    static let optionPaddingV: CGFloat = 12
    static let optionPaddingH: CGFloat = 14
    static let optionBorderWidth: CGFloat = 3
    static let optionBorderColor = AnalysisPalette.textMuted
    static let optionMainBorder = AnalysisPalette.gold
    static let optionMainBg = Theme.c(0xFDB022, 0.10)
    static let optionMoveSize: CGFloat = 15
    static let optionPreviewSize: CGFloat = 12

    // Variation card (renderVariationModal:4357)
    static let varSheetBg = Theme.c(0x1A2634)
    static let varSheetRadius: CGFloat = 20
    static let varHandleW: CGFloat = 36
    static let varHandleH: CGFloat = 4
    static let varMainColor = AnalysisPalette.gold
    static let varSubColor = Theme.c(0x78909C)
    static let varMainBg = Theme.c(0xFDB022, 0.12)
    static let varSubBg = Theme.c(0x78909C, 0.12)
    static let varDeleteColor = Theme.c(0xEF5350)
    static let varDeleteBg = Theme.c(0xEF5350, 0.12)
    static let varActionPaddingV: CGFloat = 12
    static let varActionRadius: CGFloat = 12
    static let varActionGap: CGFloat = 14
    static let varIconSize: CGFloat = 34
    static let varIconRadius: CGFloat = 8
    static let varTitleSize: CGFloat = 15
    static let varSubtitleSize: CGFloat = 12

    // Annotation picker (renderAnnotationPicker:3257)
    static let pickerBg = AnalysisPalette.surface
    static let pickerRadius: CGFloat = 16
    static let pickerPadding: CGFloat = 20
    static let pickerWidth: CGFloat = 350
    static let gridGap: CGFloat = 8
    static let gridMarginBottom: CGFloat = 16
    static let btnW: CGFloat = 70
    static let btnH: CGFloat = 60
    static let btnRadius: CGFloat = 10
    static let btnBg = AnalysisPalette.surfaceAlt
    static let labelColor = AnalysisPalette.textSecondaryAlt
    static let labelGap: CGFloat = 4
    static let clearBg = AnalysisPalette.surfaceAlt
    static let clearRadius: CGFloat = 10
    static let clearPaddingV: CGFloat = 10
    static let clearColor = AnalysisPalette.danger
    static let clearSize: CGFloat = 14
    static let sectionColor = AnalysisPalette.textMutedAlt
    static let sectionTracking: CGFloat = 1
    static let sectionMarginTop: CGFloat = 12
    static let sectionMarginBottom: CGFloat = 6
}

struct ClassificationStyle: Equatable {
    var label: String
    var symbol: String
    var color: Color
}

enum AnalysisTables {
    /// Ten tiers. The RN `CLASSIFICATION_ORDER` had only nine — it omitted `book`, so book moves were
    /// counted and then never displayed. Matches `ReviewAnnotator.displayOrder`.
    static let classificationOrder = ReviewAnnotator.displayOrder

    static func classification(_ key: String) -> ClassificationStyle? {
        switch key {
        case "brilliant": return ClassificationStyle(label: "Brilliant", symbol: "!!", color: Theme.c(0x00BCD4))
        case "great": return ClassificationStyle(label: "Great", symbol: "!", color: Theme.c(0x4CAF50))
        case "book": return ClassificationStyle(label: "Book", symbol: "B", color: Theme.c(0x9C27B0))
        case "best": return ClassificationStyle(label: "Best", symbol: "★", color: Theme.c(0x66BB6A))
        case "excellent": return ClassificationStyle(label: "Excellent", symbol: "✓", color: Theme.c(0x8BC34A))
        case "good": return ClassificationStyle(label: "Good", symbol: "", color: Theme.c(0xAED581))
        case "inaccuracy": return ClassificationStyle(label: "Inaccuracy", symbol: "?!", color: Theme.c(0xFFC107))
        case "mistake": return ClassificationStyle(label: "Mistake", symbol: "?", color: Theme.c(0xFF9800))
        case "miss": return ClassificationStyle(label: "Miss", symbol: "↗", color: Theme.c(0xFF5722))
        case "blunder": return ClassificationStyle(label: "Blunder", symbol: "??", color: Theme.c(0xF44336))
        default: return nil
        }
    }

    /// `"Book B"` / `"Good"` — the label with its symbol, when it has one. `good`'s symbol is empty
    /// on purpose, so the guard is on the string and not on the key (board.tsx:3896 does the same).
    static func classificationText(_ key: String) -> String {
        guard let s = classification(key) else { return key }
        return s.symbol.isEmpty ? s.label : "\(s.label) \(s.symbol)"
    }

    /// `"89.9%"` — one decimal, as `toFixed(1)` gives (board.tsx:3851).
    static func accuracyText(_ pct: Double) -> String {
        String(format: "%.1f%%", pct)
    }

    /// The source's only review guard is a MINIMUM, not a cap: fewer than three positions (the start
    /// plus two plies) and it does not bother (board.tsx:2256).
    static let minimumReviewPositions = 3

    struct Annotation: Equatable {
        var symbol: String
        var label: String
        var color: Color
    }

    static let moveAnnotations: [Annotation] = [
        Annotation(symbol: "!!", label: "Brilliant", color: Theme.c(0x00BCD4)),
        Annotation(symbol: "!", label: "Good", color: Theme.c(0x4CAF50)),
        Annotation(symbol: "!?", label: "Interesting", color: Theme.c(0x8BC34A)),
        Annotation(symbol: "?!", label: "Dubious", color: Theme.c(0xFF9800)),
        Annotation(symbol: "?", label: "Mistake", color: Theme.c(0xF44336)),
        Annotation(symbol: "??", label: "Blunder", color: Theme.c(0xD32F2F)),
    ]

    /// DEVIATION — the ⩲ / ⩱ correction. The RN source labels `⩱` "Slight advantage White" and `⩲`
    /// "Slight advantage Black". Standard notation is the exact opposite. Corrected here and in
    /// `evalSymbols`.
    static let positionAnnotations: [Annotation] = [
        Annotation(symbol: "+-", label: "White is winning", color: Theme.c(0xFFFFFF)),
        Annotation(symbol: "±", label: "White is better", color: Theme.c(0xE0E0E0)),
        Annotation(symbol: "⩲", label: "White is slightly better", color: Theme.c(0xB0BEC5)),
        Annotation(symbol: "=", label: "Equal", color: Theme.c(0x8BA3C7)),
        Annotation(symbol: "⩱", label: "Black is slightly better", color: Theme.c(0xB0BEC5)),
        Annotation(symbol: "∓", label: "Black is better", color: Theme.c(0xE0E0E0)),
        Annotation(symbol: "-+", label: "Black is winning", color: Theme.c(0xFFFFFF)),
    ]

    struct EvalSymbol: Equatable {
        var symbol: String
        var minCp: Int
        var maxCp: Int
    }

    /// Ranges are the RN source's; only the two slight-advantage symbols are swapped.
    static let evalSymbols: [EvalSymbol] = [
        EvalSymbol(symbol: "+-", minCp: 300, maxCp: 9999),
        EvalSymbol(symbol: "±", minCp: 150, maxCp: 300),
        EvalSymbol(symbol: "⩲", minCp: 50, maxCp: 150),
        EvalSymbol(symbol: "=", minCp: -50, maxCp: 50),
        EvalSymbol(symbol: "⩱", minCp: -150, maxCp: -50),
        EvalSymbol(symbol: "∓", minCp: -300, maxCp: -150),
        EvalSymbol(symbol: "-+", minCp: -9999, maxCp: -300),
    ]

    /// White-relative centipawns → the notation symbol stamped on a move.
    static func evalSymbol(cp: Int?, mate: Int?) -> String {
        if let m = mate { return m > 0 ? "+-" : "-+" }
        guard let c = cp else { return "=" }
        for e in evalSymbols where c > e.minCp && c <= e.maxCp { return e.symbol }
        return c > 0 ? "+-" : "-+"
    }

    struct AutoplaySpeed: Equatable {
        var label: String
        var value: Int
    }
    static let autoplaySpeeds: [AutoplaySpeed] = [
        AutoplaySpeed(label: "0.5s", value: 500),
        AutoplaySpeed(label: "1s", value: 1000),
        AutoplaySpeed(label: "1.5s", value: 1500),
        AutoplaySpeed(label: "2s", value: 2000),
        AutoplaySpeed(label: "3s", value: 3000),
    ]
    static let defaultAutoplaySpeed = 1500
}

// MARK: - Timings (spec 20)

enum AnalysisTiming {
    static let analysisDebounceMs = 300     // after a position change, before asking the engine
    static let draftAutosaveMs = 800
    static let evalBarAnimationMs = 400
    static let doubleTapWindowMs = 350      // edit mode: remove a piece
    static let longPressDelayMs = 400       // move token / engine row
    static let draftTTLHours = 24
    /// INVENTED (no server counterpart): at most one engine-progress UI update per interval, so a
    /// fast search does not thrash SwiftUI. Recorded in PORTING_NOTES.
    static let uiCoalesceMs = 100
    /// INVENTED: wall-clock budget for one interactive search, enforced through the engine's
    /// `shouldCancel`. A depth cap is the wrong control — measured cost is ~6x per ply and varies
    /// 15x by position type (endgame d4 = 173ms, midgame d4 = 2794ms in the JS twin), so a fixed
    /// depth is either too slow somewhere or too shallow everywhere. A deadline reaches depth 4+
    /// in quiet positions, stops at 3 in sharp ones, and bounds wall time to within ~15ms.
    static let engineDeadlineMs = 1200
    /// INVENTED: wall-clock budget for ONE position of a game review. At 200ms a 40-move game takes
    /// ~9s in Node and ~18s in the browser, which lands inside the original's own "This may take
    /// 20-30 seconds" promise (board.tsx:3831) — with a real progress bar and a working Cancel.
    /// Measured alternatives: 100ms is ~5s but mostly depth 1-2; 400ms is ~17s for depth 3.
    static let reviewDeadlineMs = 200
    /// INVENTED: how long a piece takes to slide to its square. The RN board animates with a
    /// Reanimated spring, which has no extractable duration, so there is nothing to port. 170ms with
    /// an ease-out and NO overshoot is between lichess (~200) and chess.com (~150); this rebuild
    /// used a springy 330ms, which read as sluggish.
    static let pieceAnimationMs = 170
    /// `pieceAnimationMs` as seconds, so no view body divides by 1000.
    static var pieceAnimationSeconds: Double { Double(pieceAnimationMs) / 1000 }
    /// The slide every board uses. An ease-out with NO overshoot, matching the browser's
    /// `cubic-bezier(.22,.61,.36,1)`. It was `.spring(response: 0.34, dampingFraction: 0.82)` — a
    /// springy third of a second that read as sluggish next to chess.com and lichess.
    static var pieceMove: Animation { .easeOut(duration: pieceAnimationSeconds) }
    /// INVENTED: the ceiling on ONE synchronous chunk of search when the engine cannot be moved off
    /// the UI thread. Swift always can (`Task.detached`), so this is the browser twin's constant —
    /// it is here so the two metrics layers stay identical and the value is asserted in both.
    /// Measured: one whole depth per block was 624ms at depth 3 and 2885ms at depth 4; slicing each
    /// depth at 80ms holds the worst block to 94ms.
    static let inlineSearchBudgetMs = 80
    /// INVENTED: how long the screen takes to slide up over the tab bar.
    static let screenPresentMs = 250
    /// `longPressDelayMs` as seconds, so no view body divides by 1000.
    static var longPressSeconds: Double { Double(longPressDelayMs) / 1000 }
    /// `screenPresentMs` as seconds, so no view body divides by 1000.
    static var screenPresentSeconds: Double { Double(screenPresentMs) / 1000 }
}

/// Search limits for the live board. `maxDepth` is a ceiling; the deadline is what usually binds.
enum AnalysisEngineLimits {
    static let maxDepth = 6
    static let multiPV = 3
}

// MARK: - Typography

/// The real StyleSheet sizes, not eyeballed ones. `AnalysisMetricsCheck` and the JS twin's
/// `selfTestSource` both pin these to `board_styles.json`'s **`styles`** block — which matters:
/// `sidebarStyles` declares its own `headerTitle` at 20, and taking that one would have made this
/// screen's header four points too big with nothing to catch it.
enum AnalysisType {
    static let headerTitle: CGFloat = 16
    static let headerBtn: CGFloat = 22
    static let status: CGFloat = 12
    static let toolBtn: CGFloat = 20
    static let navBtn: CGFloat = 18
    static let autoplayBar: CGFloat = 12
    static let stripNum: CGFloat = 12
    static let stripMove: CGFloat = 13
    static let altChip: CGFloat = 12
    static let engineEval: CGFloat = 9
    static let engineSan: CGFloat = 10
    static let enginePv: CGFloat = 9
    static let engineText: CGFloat = 9
    static let engineDepth: CGFloat = 8
    static let engineOpening: CGFloat = 9
    // Phase 11 — the annotation picker's own scale.
    static let annotationPickerTitle: CGFloat = 16
    static let annotationSymbol: CGFloat = 20
    static let annotationLabel: CGFloat = 10
    static let annotationSection: CGFloat = 11

    /// Menlo in the source; the closest thing that always exists is the system monospace face.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}
