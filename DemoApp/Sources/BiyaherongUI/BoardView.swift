import SwiftUI
import BiyaherongCoachCore

// The chessboard, and the ONE way to size it.
//
// `BoardView` used to live at the bottom of `PlayView.swift`, which made the retired desktop Play
// screen load-bearing: `PhoneView.swift` said in a comment that the Play tab "cannot be retired
// until `BoardView` is lifted out of `PlayView.swift`". This file is that lift. The type and its
// memberwise initializer are unchanged, so every existing call site still compiles.
//
// ── The sizing rule ──────────────────────────────────────────────────────────
// A board is a FIXED square derived from the WIDTH it is given. Never `min(width, height)`.
//
// That is not a style preference, it is the bug this file was split out to kill. Four screens
// wrapped `BoardView` in a `GeometryReader` and asked for `min(geo.size.width, geo.size.height)`.
// A `GeometryReader` accepts whatever size it is proposed, so inside a `VStack` its height is
// "whatever is left over" — and the board's WIDTH then tracked that leftover HEIGHT. On the phone
// that meant the board never filled the screen, and it changed size whenever anything above or
// below it grew. The web twin has always had this right:
//
//     .pz-board            { flex: none; }                        /* app.css:1269 */
//     .pz-board chess-board{ width: 100%; --board-radius: 0; }
//
// i.e. the board is rigid and the band BELOW it is the flexible one. `ChessBoardBand` is that rule
// expressed once. `tools/qa/swift_layout_check.js` fails the build if anyone reintroduces the
// `min(w,h)` form or calls `BoardView` from a file that does not go through the band.

/// The one board wrapper: a fixed `edge × edge` square, and nothing else.
///
/// `edge` comes from the screen's single top-level `GeometryReader` (`geo.size.width`), or from a
/// pinned formula where one exists — the Analysis Board keeps `AnalysisBoard.size(screenWidth:
/// pixelRatio:)`, which snaps the edge down to a whole multiple of 8 physical pixels so squares
/// land on pixel boundaries.
///
/// The content closure receives the edge and builds the `BoardView` itself, rather than this band
/// forwarding all ten of `BoardView`'s parameters. That keeps per-screen overlays — the Analysis
/// Board's arrows and annotation badge, Play vs Coach's premove chip, the promotion dialogs —
/// where they belong, next to the board they decorate.
///
/// Deliberately NOT `.frame(maxWidth: .infinity)`: callers attach `.overlay(alignment: .topLeading)`
/// (arrows, the annotation badge) and `.clipShape(RoundedRectangle(…))` to this band, and both
/// anchor to its frame. Padding the band out to the full screen width would silently move every
/// arrow and round the wrong corners. Horizontal centring is the parent stack's job — a `VStack`
/// centres a narrower child already — and no caller wants it to be anything else.
struct ChessBoardBand<Content: View>: View {
    let edge: CGFloat
    @ViewBuilder var content: (CGFloat) -> Content

    var body: some View {
        content(edge).frame(width: edge, height: edge)
    }
}

struct BoardView: View {
    let pieces: [BoardPiece]
    let selected: Int?
    let legalTargets: Set<Int>
    let lastMove: Move?
    let flipped: Bool
    let checkSquare: Int?
    let boardSize: CGFloat
    let onTap: (Int) -> Void

    // Everything below is defaulted and declared AFTER `onTap`, so the existing call sites —
    // which pass every argument by label, never as a trailing closure — keep compiling untouched.
    // They must also stay non-`private`: a `private var` stored property is included in the
    // memberwise initializer and would downgrade it to private, breaking the cross-file call sites
    // in PhoneView.swift and PuzzleView.swift. (`private let x = …`, with an initialiser, is omitted
    // from the init entirely, which is why the two colour constants could be private before.)

    /// Colours and indicator geometry. The default reproduces exactly what this board rendered
    /// before the Analysis Board existed, so Play and Puzzles are unchanged.
    var style: BoardStyle = BoardStyle()
    /// Per-square fills for the engine-line preview. Only honoured when `style.replacesFill`.
    var customHighlights: [Int: Color] = [:]
    /// Supplied only by the Analysis Board. When nil, no drag gesture is installed at all and the
    /// tap path is byte-identical to before.
    var onDragMove: ((Int, Int) -> Void)?
    /// a–h / 1–8 labels inside the edge squares. On by default, matching `<chess-board>`, whose
    /// `coordinates` attribute also defaults to true (chess-board.js:168). The two macOS demo
    /// screens pass `false` because they draw their own strips outside the board.
    var coordinates: Bool = true

    private var square: CGFloat { boardSize / 8 }
    private var occupied: Set<Int> { Set(pieces.map { $0.square }) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            squares
            pieceLayer.allowsHitTesting(false)
        }
        .frame(width: boardSize, height: boardSize)
        // One board-level gesture rather than per-piece: `pieceLayer` is `allowsHitTesting(false)`,
        // so a gesture attached to a piece would never fire. `minimumDistance` keeps a stationary
        // press flowing through to the per-cell tap.
        //
        // The mask is what makes "no drag when `onDragMove` is nil" true rather than aspirational:
        // `.subviews` disables this gesture and leaves the cells' `.onTapGesture` recognisers alone,
        // so Play and Puzzles behave exactly as they did. A plain `if` here would change the body's
        // return type, which `some View` cannot express without an `AnyView` box.
        .gesture(dragGesture, including: onDragMove == nil ? .subviews : .all)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .onEnded { value in
                guard let onDragMove else { return }
                guard let from = squareAt(value.startLocation), let to = squareAt(value.location) else { return }
                if from != to { onDragMove(from, to) }
            }
    }

    /// Board-local point → logical square, honouring the flip. Nil outside the board.
    private func squareAt(_ p: CGPoint) -> Int? {
        guard p.x >= 0, p.y >= 0, p.x < boardSize, p.y < boardSize, square > 0 else { return nil }
        let col = min(7, max(0, Int(p.x / square)))
        let row = min(7, max(0, Int(p.y / square)))
        let file = flipped ? 7 - col : col
        let rank = flipped ? row : 7 - row
        return Square.make(file: file, rank: rank)
    }

    private var squares: some View {
        VStack(spacing: 0) {
            ForEach(rowRanks(), id: \.self) { rank in
                HStack(spacing: 0) {
                    ForEach(colFiles(), id: \.self) { file in
                        cell(Square.make(file: file, rank: rank))
                    }
                }
            }
        }
    }

    private func cell(_ sq: Int) -> some View {
        let file = Square.file(sq), rank = Square.rank(sq)
        let isLight = (file + rank) % 2 == 1
        let isSelected = selected == sq
        let isLast = lastMove.map { $0.from == sq || $0.to == sq } ?? false
        let isTarget = legalTargets.contains(sq)
        let hasPiece = occupied.contains(sq)
        let isCheck = checkSquare == sq
        // The same visual row/column `center(_:)` computes, so a label and its piece agree about
        // where the square is after a flip.
        let visualCol = flipped ? 7 - file : file
        let visualRow = flipped ? rank : 7 - rank
        // Two fill models. The original board TINTS translucent layers over the square colour; the
        // Analysis Board REPLACES it outright (spec 3.3), with a strict precedence. `style` picks.
        let base: Color = {
            guard style.replacesFill else { return isLight ? style.light : style.dark }
            if isSelected { return style.selected }
            if let custom = customHighlights[sq] { return custom }
            if isLast { return style.lastMove }
            return isLight ? style.light : style.dark
        }()
        return ZStack {
            Rectangle().fill(base)
            if !style.replacesFill {
                if isLast { Rectangle().fill(style.lastMove) }
                if isSelected { Rectangle().fill(style.selected) }
            }
            if isCheck { Rectangle().fill(style.check) }
            if isTarget {
                if hasPiece {
                    if style.replacesFill {
                        // Spec 3.7: diameter 0.85 of a square, stroke 0.08 — sized explicitly,
                        // because an unframed Circle would fill the whole cell.
                        Circle()
                            .stroke(style.targetRing,
                                    lineWidth: AnalysisIndicator.ringStrokeWidth(square: square))
                            .frame(width: AnalysisIndicator.ringSize(square: square),
                                   height: AnalysisIndicator.ringSize(square: square))
                    } else {
                        Circle().stroke(style.targetRing, lineWidth: style.ringLineWidth)
                            .padding(style.ringInset)
                    }
                } else {
                    Circle().fill(style.targetDot)
                        .frame(width: style.dotSize(square: square),
                               height: style.dotSize(square: square))
                }
            }
        }
        .frame(width: square, height: square)
        .overlay(alignment: .bottomTrailing) { fileLabel(file, visualRow: visualRow) }
        .overlay(alignment: .topLeading) { rankLabel(rank, visualCol: visualCol) }
        .contentShape(Rectangle())
        .onTapGesture { onTap(sq) }
    }

    /// The file letter, on the bottom visual row only (chess-board.js:291).
    @ViewBuilder
    private func fileLabel(_ file: Int, visualRow: Int) -> some View {
        if coordinates && visualRow == 7 {
            coordText(BoardCoords.fileLabel(file))
                .padding(.trailing, BoardCoords.fileInsetTrailing(square: square))
                .padding(.bottom, BoardCoords.fileInsetBottom(square: square))
        }
    }

    /// The rank digit, on the left visual column only (chess-board.js:292).
    @ViewBuilder
    private func rankLabel(_ rank: Int, visualCol: Int) -> some View {
        if coordinates && visualCol == 0 {
            coordText(BoardCoords.rankLabel(rank))
                .padding(.leading, BoardCoords.rankInsetLeading(square: square))
                .padding(.top, BoardCoords.rankInsetTop(square: square))
        }
    }

    private func coordText(_ s: String) -> some View {
        Text(s)
            .font(Theme.nunito(BoardCoords.fontSize(boardEdge: boardSize), BoardCoords.weight))
            .foregroundStyle(BoardCoords.color)
            .opacity(BoardCoords.opacity)
            // `pointer-events: none` in the stylesheet. Without this the label would swallow taps
            // on sixteen of the sixty-four squares.
            .allowsHitTesting(false)
    }

    private var pieceLayer: some View {
        ZStack(alignment: .topLeading) {
            ForEach(pieces) { bp in
                PieceImage(piece: bp.piece, size: square)
                    .position(center(bp.square))
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
                    .zIndex(lastMove?.to == bp.square ? 1 : 0)
            }
        }
        .frame(width: boardSize, height: boardSize, alignment: .topLeading)
    }

    private func center(_ sq: Int) -> CGPoint {
        let f = Square.file(sq), r = Square.rank(sq)
        let col = flipped ? 7 - f : f
        let row = flipped ? r : 7 - r
        return CGPoint(x: (CGFloat(col) + 0.5) * square, y: (CGFloat(row) + 0.5) * square)
    }

    private func rowRanks() -> [Int] { flipped ? Array(0...7) : Array(0...7).reversed() }
    private func colFiles() -> [Int] { flipped ? Array(0...7).reversed() : Array(0...7) }
}
