import SwiftUI
import BiyaherongCoachCore

struct BoardPiece: Identifiable, Equatable {
    let id: UUID
    var square: Int
    var piece: Piece
}

@MainActor
final class ChessGameVM: ObservableObject {
    @Published var position = ChessPosition.start()
    @Published var pieces: [BoardPiece] = []
    @Published var selected: Int? = nil
    @Published var legalTargets: Set<Int> = []
    @Published var lastMove: Move? = nil
    @Published var history: [String] = []
    @Published var flipped = false
    @Published var pendingPromotion: (from: Int, to: Int)? = nil
    @Published var captured: [Piece] = []
    @Published var thinking = false

    // Opponent config
    @Published var coach: CoachPersona? = Coaches.all[2]   // default highlight: Handsome Jude
    @Published var humanColor: PieceColor = .white
    @Published var started = false                          // false → show the opponent-select screen

    /// Begin a game against `coach` (nil = pass-and-play), playing as `humanColor`.
    func start(coach: CoachPersona?, humanColor: PieceColor) {
        self.coach = coach; self.humanColor = humanColor; started = true; newGame()
    }
    /// Return to the opponent-select screen.
    func backToSelect() { started = false }

    private var undoStack: [(ChessPosition, [BoardPiece], [String], [Piece])] = []
    private var rng = SystemRandomNumberGenerator()

    init() { rebuildPieces() }

    var status: ChessPosition.Status { position.status() }
    var gameOver: Bool { status == .checkmate || status == .stalemate }
    var statusText: String {
        switch status {
        case .checkmate: return "Checkmate — \(position.sideToMove == .white ? "Black" : "White") wins"
        case .stalemate: return "Stalemate — draw"
        case .check: return "\(turnName) to move — Check!"
        case .ongoing: return "\(turnName) to move"
        }
    }
    var turnName: String { position.sideToMove == .white ? "White" : "Black" }
    var botToMove: Bool { coach != nil && position.sideToMove != humanColor && !gameOver }
    var interactionLocked: Bool { thinking || botToMove || pendingPromotion != nil }
    var checkKingSquare: Int? {
        (status == .check || status == .checkmate) ? position.kingSquare(position.sideToMove) : nil
    }
    /// Static eval from White's perspective (centipawns) and the derived White win %.
    var whiteCentipawns: Int {
        let e = ChessAI.evaluate(position)
        return position.sideToMove == .white ? e : -e
    }
    var whiteWinPct: Double { GameReview.evalToWinPct(evalCp: whiteCentipawns, color: "w") }

    func rebuildPieces() {
        pieces = (0..<64).compactMap { sq in position.squares[sq].map { BoardPiece(id: UUID(), square: sq, piece: $0) } }
    }

    func newGame() {
        position = .start(); undoStack = []; history = []; captured = []; lastMove = nil
        selected = nil; legalTargets = []; pendingPromotion = nil; thinking = false
        rebuildPieces()
        SoundManager.shared.gameStart()
        maybeBotMove()
    }

    func tap(_ sq: Int) {
        guard !interactionLocked else { return }
        if let sel = selected {
            if sq == sel { deselect(); return }
            let moves = position.legalMoves(from: sel).filter { $0.to == sq }
            if moves.count > 1 { pendingPromotion = (sel, sq); return }
            if let m = moves.first { perform(m); return }
            selectPiece(sq); return
        }
        selectPiece(sq)
    }

    private func selectPiece(_ sq: Int) {
        guard let p = position.squares[sq], p.color == position.sideToMove else { deselect(); return }
        selected = sq
        legalTargets = Set(position.legalMoves(from: sq).map { $0.to })
    }
    private func deselect() { selected = nil; legalTargets = [] }

    func choosePromotion(_ kind: PieceKind) {
        guard let pp = pendingPromotion else { return }
        pendingPromotion = nil
        perform(Move(from: pp.from, to: pp.to, promotion: kind))
    }

    private func perform(_ m: Move) {
        undoStack.append((position, pieces, history, captured))
        let moving = position.squares[m.from]!
        let isEP = moving.kind == .pawn && m.to == position.enPassant && position.squares[m.to] == nil
        let capSq = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                         : (position.squares[m.to] != nil ? m.to : nil)
        if let cs = capSq, let cp = position.squares[cs] { captured.append(cp) }
        let san = position.san(for: m)

        withAnimation(AnalysisTiming.pieceMove) {
            if let cs = capSq { pieces.removeAll { $0.square == cs } }
            if let idx = pieces.firstIndex(where: { $0.square == m.from }) {
                if let promo = m.promotion { pieces[idx].piece = Piece(moving.color, promo) }
                pieces[idx].square = m.to
            }
            if moving.kind == .king, abs(Square.file(m.to) - Square.file(m.from)) == 2 {
                let rank = Square.rank(m.from)
                let (rf, rt) = Square.file(m.to) == 6
                    ? (Square.make(file: 7, rank: rank), Square.make(file: 5, rank: rank))
                    : (Square.make(file: 0, rank: rank), Square.make(file: 3, rank: rank))
                if let ri = pieces.firstIndex(where: { $0.square == rf }) { pieces[ri].square = rt }
            }
        }

        position = position.makeMove(m)
        SoundManager.shared.playMove(
            isCastle: moving.kind == .king && abs(Square.file(m.to) - Square.file(m.from)) == 2,
            isCapture: capSq != nil, status: position.status())
        history.append(san)
        lastMove = m
        deselect()
        maybeBotMove()
    }

    private func maybeBotMove() {
        guard let coach, position.sideToMove != humanColor, !gameOver else { return }
        thinking = true
        let snapshot = position
        let persona = coach
        Task.detached(priority: .userInitiated) { [weak self] in
            var g = SystemRandomNumberGenerator()
            let move = ChessAI.bestMove(snapshot, persona: persona, using: &g)
            try? await Task.sleep(nanoseconds: 380_000_000)   // brief pause so it feels natural
            await MainActor.run {
                guard let self else { return }
                self.thinking = false
                if let move, self.position == snapshot { self.perform(move) }
            }
        }
    }

    func undo() {
        // Undo the last full ply pair back to the human's turn where possible.
        guard let (pos, pcs, hist, cap) = undoStack.popLast() else { return }
        position = pos; pieces = pcs; history = hist; captured = cap
        lastMove = nil; deselect(); thinking = false
        // if we landed on the bot's move, undo one more so it's the human's turn
        if coach != nil, position.sideToMove != humanColor, let (p2, pc2, h2, c2) = undoStack.popLast() {
            position = p2; pieces = pc2; history = h2; captured = c2
        }
    }

    var materialDiff: Int {
        func val(_ k: PieceKind) -> Int { [PieceKind.pawn: 1, .knight: 3, .bishop: 3, .rook: 5, .queen: 9, .king: 0][k]! }
        var white = 0, black = 0
        for sq in 0..<64 { if let p = position.squares[sq] { if p.color == .white { white += val(p.kind) } else { black += val(p.kind) } } }
        return white - black
    }
}

struct PlayView: View {
    @StateObject private var vm = ChessGameVM()
    private let boardSize: CGFloat = 480
    private var square: CGFloat { boardSize / 8 }

    var body: some View {
        if vm.started { gameContent }
        else { CoachSelect(vm: vm).frame(maxWidth: 560).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top) }
    }

    private var gameContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            HStack(alignment: .top, spacing: 22) {
                VStack(spacing: 10) {
                    capturedBar(for: vm.humanColor.opponent)   // pieces the human captured
                    boardWithCoords
                    capturedBar(for: vm.humanColor)
                    controls
                }
                sidePanel.frame(width: 210)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // Header: title + current opponent + status ------------------------------

    private var header: some View {
        HStack(spacing: 16) {
            Text("Play").font(Theme.nunito(28, .extraBold))
            Button { vm.backToSelect() } label: {
                Label(vm.coach.map { "\($0.name) · \($0.rating)" } ?? "Pass & play", systemImage: "arrow.left.arrow.right")
            }
            Picker("", selection: $vm.humanColor) {
                Text("Play White").tag(PieceColor.white)
                Text("Play Black").tag(PieceColor.black)
            }.pickerStyle(.segmented).frame(width: 200).disabled(vm.coach == nil)
            Spacer()
            statusPill
        }
    }

    private var statusPill: some View {
        HStack(spacing: 8) {
            if vm.thinking {
                ProgressView().controlSize(.small)
                Text("\(vm.coach?.name ?? "Coach") is thinking…").foregroundStyle(Theme.mutedForeground)
            } else {
                Circle().fill(vm.position.sideToMove == .white ? Color.white : Color.black)
                    .frame(width: 12, height: 12).overlay(Circle().stroke(.secondary))
                Text(vm.statusText)
                    .foregroundStyle(vm.status == .checkmate ? Theme.negative : (vm.status == .check ? Theme.warning : Theme.foreground))
                    .fontWeight(.medium)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(.quaternary.opacity(0.5), in: Capsule())
    }

    // Board + coordinate strips ----------------------------------------------

    private var boardWithCoords: some View {
        HStack(spacing: 4) {
            VStack(spacing: 0) {
                ForEach(ranks(), id: \.self) { r in
                    Text("\(r + 1)").font(Theme.nunito(11, .medium)).foregroundStyle(Theme.mutedForeground)
                        .frame(width: 14, height: square)
                }
            }
            VStack(spacing: 4) {
                BoardView(pieces: vm.pieces, selected: vm.selected, legalTargets: vm.legalTargets,
                          lastMove: vm.lastMove, flipped: vm.flipped, checkSquare: vm.checkKingSquare,
                          boardSize: boardSize, onTap: { vm.tap($0) })
                    .frame(width: boardSize, height: boardSize)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black.opacity(0.25), lineWidth: 1))
                    .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
                    .overlay(alignment: .center) { promotionOverlay }
                HStack(spacing: 0) {
                    ForEach(files(), id: \.self) { f in
                        Text(String(UnicodeScalar(UInt8(97 + f)))).font(Theme.nunito(11, .medium)).foregroundStyle(Theme.mutedForeground)
                            .frame(width: square)
                    }
                }
            }
        }
    }

    private func ranks() -> [Int] { vm.flipped ? Array(0...7) : Array(0...7).reversed() }
    private func files() -> [Int] { vm.flipped ? Array(0...7).reversed() : Array(0...7) }

    private var controls: some View {
        HStack {
            Button("New game") { vm.newGame() }.buttonStyle(.borderedProminent)
            Button("Undo") { vm.undo() }.disabled(vm.history.isEmpty || vm.thinking)
            Button(vm.flipped ? "White view" : "Black view") { withAnimation { vm.flipped.toggle() } }
            Spacer()
            Text("Material: \(vm.materialDiff > 0 ? "+" : "")\(vm.materialDiff)")
                .font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.mutedForeground)
        }.frame(width: boardSize)
    }

    private func capturedBar(for color: PieceColor) -> some View {
        let taken = vm.captured.filter { $0.color == color }
            .sorted { pieceWeight($0.kind) > pieceWeight($1.kind) }
        return HStack(spacing: 0) {
            if !taken.isEmpty {
                HStack(spacing: -2) {
                    ForEach(Array(taken.enumerated()), id: \.offset) { _, p in
                        PieceImage(piece: p, size: 20, shadow: false)
                    }
                }
                // A board-tinted strip: the artwork is drawn in its real colours, so the
                // black pieces need something other than the dark navy chrome behind them.
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(Theme.boardDark, in: Capsule())
            }
            Spacer()
        }
        .frame(width: boardSize, height: 22, alignment: .leading)
    }
    private func pieceWeight(_ k: PieceKind) -> Int { [PieceKind.queen: 5, .rook: 4, .bishop: 3, .knight: 2, .pawn: 1, .king: 6][k]! }

    private var sidePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let c = vm.coach {
                Card(title: "Opponent") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(c.name).font(Theme.nunito(16, .bold))
                        Text(c.blurb).font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        Text("Search depth \(c.depth)").font(Theme.nunito(11, .medium)).foregroundStyle(Theme.textMuted)
                    }
                }
            }
            Card(title: "Moves") {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        if vm.history.isEmpty {
                            Text("Legal moves enforced by the perft-verified engine.").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        }
                        ForEach(Array(stride(from: 0, to: vm.history.count, by: 2)), id: \.self) { i in
                            HStack(alignment: .top, spacing: 6) {
                                Text("\(i / 2 + 1).").foregroundStyle(Theme.mutedForeground).frame(width: 26, alignment: .trailing)
                                Text(vm.history[i]).frame(width: 58, alignment: .leading)
                                if i + 1 < vm.history.count { Text(vm.history[i + 1]).frame(width: 58, alignment: .leading) }
                            }.font(.system(.callout, design: .monospaced))
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 380)
            }
        }
    }

    @ViewBuilder private var promotionOverlay: some View {
        if vm.pendingPromotion != nil {
            let color = vm.position.sideToMove
            VStack(spacing: 8) {
                Text("Promote to").font(Theme.nunito(16, .bold))
                HStack(spacing: 10) {
                    ForEach([PieceKind.queen, .rook, .bishop, .knight], id: \.self) { k in
                        Button { vm.choosePromotion(k) } label: {
                            PieceImage(piece: Piece(color, k), size: 46, shadow: false)
                                .frame(width: 52, height: 52)
                                .background(Theme.boardLight, in: RoundedRectangle(cornerRadius: 8))
                        }.buttonStyle(.plain)
                    }
                }
            }
            .padding(18)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            .shadow(radius: 20)
        }
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

    // Everything below is defaulted and declared AFTER `onTap`, so the four existing call sites —
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
        let isLight = (Square.file(sq) + Square.rank(sq)) % 2 == 1
        let isSelected = selected == sq
        let isLast = lastMove.map { $0.from == sq || $0.to == sq } ?? false
        let isTarget = legalTargets.contains(sq)
        let hasPiece = occupied.contains(sq)
        let isCheck = checkSquare == sq
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
        .contentShape(Rectangle())
        .onTapGesture { onTap(sq) }
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
