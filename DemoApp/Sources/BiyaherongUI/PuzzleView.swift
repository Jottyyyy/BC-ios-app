import SwiftUI
import BiyaherongCoachCore

// Shared piece-mutation helpers (used by the puzzle board; mirror ChessGameVM's logic).
func capturedPiece(in pos: ChessPosition, move m: Move) -> Piece? {
    let moving = pos.squares[m.from]!
    let isEP = moving.kind == .pawn && m.to == pos.enPassant && pos.squares[m.to] == nil
    let cs = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                  : (pos.squares[m.to] != nil ? m.to : nil)
    return cs.flatMap { pos.squares[$0] }
}

func mutatePieces(_ pieces: inout [BoardPiece], move m: Move, positionBefore pos: ChessPosition) {
    let moving = pos.squares[m.from]!
    let isEP = moving.kind == .pawn && m.to == pos.enPassant && pos.squares[m.to] == nil
    let capSq = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                     : (pos.squares[m.to] != nil ? m.to : nil)
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

func move(fromUci uci: String, in pos: ChessPosition) -> Move? {
    let cs = Array(uci)
    guard cs.count >= 4,
          let from = Square.index(String(cs[0...1])),
          let to = Square.index(String(cs[2...3])) else { return nil }
    var promo: PieceKind?
    if cs.count >= 5 { promo = ["q": .queen, "r": .rook, "b": .bishop, "n": .knight][Character(cs[4].lowercased())] }
    return pos.legalMoves().first { $0.from == from && $0.to == to && $0.promotion == promo }
}

func piecesFrom(_ pos: ChessPosition) -> [BoardPiece] {
    (0..<64).compactMap { sq in pos.squares[sq].map { BoardPiece(id: UUID(), square: sq, piece: $0) } }
}

@MainActor
final class PuzzleVM: ObservableObject {
    enum Phase { case solving, solved, failed, empty }

    @Published var pieces: [BoardPiece] = []
    @Published var selected: Int? = nil
    @Published var legalTargets: Set<Int> = []
    @Published var lastMove: Move? = nil
    @Published var flipped = false
    @Published var pendingPromotion: (from: Int, to: Int)? = nil

    @Published var userRating = 1200
    @Published var solved = 0
    @Published var attempted = 0
    @Published var lastDelta = 0
    @Published var phase: Phase = .empty
    @Published var message = "Loading puzzles…"
    @Published var puzzle: PuzzleStore.Puzzle?
    @Published var sideToMove: PieceColor = .white
    @Published var correctSAN: String? = nil
    @Published var sanHistory: [String] = []
    @Published var ratingHistory: [Int] = [1200]

    private var position = ChessPosition.start()
    private var solutionIndex = 0
    private let store = PuzzleStore()

    init() {
        if store == nil { phase = .empty; message = "Puzzle database not found." } else { next() }
    }

    var checkKingSquare: Int? {
        let st = position.status()
        return (st == .check || st == .checkmate) ? position.kingSquare(position.sideToMove) : nil
    }

    func next() {
        guard let store else { return }
        correctSAN = nil; lastDelta = 0; selected = nil; legalTargets = []; pendingPromotion = nil
        guard let p = store.randomPuzzle(nearRating: userRating, window: 120)
            ?? store.randomPuzzle(nearRating: userRating, window: 600), p.moves.count >= 2,
              let start = ChessPosition(fen: p.fen) else {
            phase = .empty; message = "Could not load a puzzle."; return
        }
        puzzle = p
        position = start
        sanHistory = []
        // Apply the opponent's setup move (moves[0]) — Lichess convention.
        if let setup = move(fromUci: p.moves[0], in: position) {
            sanHistory = [position.san(for: setup)]
            position = position.makeMove(setup)
            lastMove = setup
        }
        solutionIndex = 1
        sideToMove = position.sideToMove
        flipped = sideToMove == .black
        pieces = piecesFrom(position)
        phase = .solving
        message = "\(sideToMove == .white ? "White" : "Black") to move — find the winning move."
    }

    func tap(_ sq: Int) {
        guard phase == .solving, pendingPromotion == nil else { return }
        if let sel = selected {
            if sq == sel { deselect(); return }
            let moves = position.legalMoves(from: sel).filter { $0.to == sq }
            if moves.count > 1 { pendingPromotion = (sel, sq); return }
            if let m = moves.first { play(m); return }
            select(sq); return
        }
        select(sq)
    }
    private func select(_ sq: Int) {
        guard let p = position.squares[sq], p.color == sideToMove else { deselect(); return }
        selected = sq; legalTargets = Set(position.legalMoves(from: sq).map { $0.to })
    }
    private func deselect() { selected = nil; legalTargets = [] }

    func choosePromotion(_ k: PieceKind) {
        guard let pp = pendingPromotion else { return }
        pendingPromotion = nil
        play(Move(from: pp.from, to: pp.to, promotion: k))
    }

    private func apply(_ m: Move) {
        let before = position
        sanHistory.append(before.san(for: m))
        withAnimation(.spring(response: 0.33, dampingFraction: 0.82)) {
            mutatePieces(&pieces, move: m, positionBefore: before)
        }
        position = position.makeMove(m)
        SoundManager.shared.playMove(isCastle: moveIsCastle(before, m), isCapture: moveIsCapture(before, m), status: position.status())
        lastMove = m
        deselect()
    }

    private func play(_ m: Move) {
        guard let puzzle, phase == .solving else { return }
        let before = position
        let expected = solutionIndex < puzzle.moves.count ? puzzle.moves[solutionIndex] : nil
        let correct = (expected != nil) && (m.uci == expected)
        apply(m)
        solutionIndex += 1

        if !correct {
            if let e = expected, let cm = move(fromUci: e, in: before) { correctSAN = before.san(for: cm) }
            finish(didSolve: false)
            return
        }
        if solutionIndex >= puzzle.moves.count { finish(didSolve: true); return }

        // Opponent's forced reply.
        let replyUci = puzzle.moves[solutionIndex]
        let snapshot = position
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 320_000_000)
            guard let self, self.position == snapshot, self.phase == .solving else { return }
            if let rm = move(fromUci: replyUci, in: self.position) {
                self.apply(rm)
                self.solutionIndex += 1
                if self.solutionIndex >= (self.puzzle?.moves.count ?? 0) { self.finish(didSolve: true) }
                else { self.message = "Correct — keep going." }
            }
        }
    }

    private func finish(didSolve: Bool) {
        guard let puzzle else { return }
        attempted += 1
        if didSolve { solved += 1 }
        let outcome = PuzzleRatingEngine.evaluate(userRating: userRating, puzzleRating: puzzle.rating, isCorrect: didSolve)
        lastDelta = outcome.ratingChange
        userRating = outcome.newRating
        ratingHistory.append(userRating)
        phase = didSolve ? .solved : .failed
        message = didSolve ? "Solved! ✓" : "Not the best move."
    }
}

struct PuzzleView: View {
    @StateObject private var vm = PuzzleVM()
    private let boardSize: CGFloat = 460
    private var square: CGFloat { boardSize / 8 }

    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(spacing: 12) {
                header
                boardWithCoords
                statusRow
            }
            sidePanel.frame(width: 220)
        }
        .padding(22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Text("Puzzles").font(Theme.nunito(28, .extraBold))
            Spacer()
            badge("Your rating", "\(vm.userRating)", Theme.accent)
            if let p = vm.puzzle { badge("Puzzle", "\(p.rating)", .secondary) }
            badge("Solved", "\(vm.solved)/\(vm.attempted)", Theme.positive)
        }.frame(width: boardSize + 24 + 220)
    }

    private func badge(_ label: String, _ value: String, _ tint: Color) -> some View {
        VStack(spacing: 1) {
            Text(value).font(Theme.nunito(16, .bold)).foregroundStyle(tint)
            Text(label).font(Theme.nunito(11, .medium)).foregroundStyle(Theme.mutedForeground)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }

    private var boardWithCoords: some View {
        HStack(spacing: 4) {
            VStack(spacing: 0) {
                ForEach(ranks(), id: \.self) { r in
                    Text("\(r + 1)").font(Theme.nunito(11, .medium)).foregroundStyle(Theme.mutedForeground).frame(width: 14, height: square)
                }
            }
            VStack(spacing: 4) {
                BoardView(pieces: vm.pieces, selected: vm.selected, legalTargets: vm.legalTargets,
                          lastMove: vm.lastMove, flipped: vm.flipped, checkSquare: vm.checkKingSquare,
                          boardSize: boardSize, onTap: { vm.tap($0) })
                    .frame(width: boardSize, height: boardSize)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.black.opacity(0.25), lineWidth: 1))
                    .shadow(color: .black.opacity(0.22), radius: 9, y: 3)
                    .overlay(alignment: .center) { promotionOverlay }
                HStack(spacing: 0) {
                    ForEach(files(), id: \.self) { f in
                        Text(String(UnicodeScalar(UInt8(97 + f)))).font(Theme.nunito(11, .medium)).foregroundStyle(Theme.mutedForeground).frame(width: square)
                    }
                }
            }
        }
    }
    private func ranks() -> [Int] { vm.flipped ? Array(0...7) : Array(0...7).reversed() }
    private func files() -> [Int] { vm.flipped ? Array(0...7).reversed() : Array(0...7) }

    private var statusRow: some View {
        HStack(spacing: 12) {
            Group {
                switch vm.phase {
                case .solved:
                    Label("Solved  (\(vm.lastDelta >= 0 ? "+" : "")\(vm.lastDelta))", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(Theme.positive).fontWeight(.semibold)
                case .failed:
                    Label("Missed  (\(vm.lastDelta))", systemImage: "xmark.seal.fill")
                        .foregroundStyle(Theme.negative).fontWeight(.semibold)
                default:
                    Text(vm.message).foregroundStyle(Theme.mutedForeground)
                }
            }
            if vm.phase == .failed, let san = vm.correctSAN {
                Text("Best: \(san)").font(.system(size: 15, weight: .regular, design: .monospaced)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
            if vm.phase == .solving {
                Button("Skip") { vm.finishSkip() }
            } else {
                Button("Next puzzle") { vm.next() }.buttonStyle(.borderedProminent)
            }
        }
        .frame(width: boardSize)
    }

    private var sidePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Card(title: "This puzzle") {
                VStack(alignment: .leading, spacing: 8) {
                    if let p = vm.puzzle {
                        Text("\(vm.sideToMove == .white ? "White" : "Black") to move").font(Theme.nunito(16, .bold))
                        Text("Rating \(p.rating)").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        if !p.themes.isEmpty {
                            FlowChips(items: Array(p.themes.prefix(6)))
                        }
                    } else {
                        Text(vm.message).font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                    }
                }
            }
            Card(title: "How it works") {
                Text("Puzzles are served from the real 550,000-puzzle database at your rating (±120). Solve the line move by move; your rating updates with the same ELO engine the tests verify.")
                    .font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
        }
    }

    @ViewBuilder private var promotionOverlay: some View {
        if vm.pendingPromotion != nil {
            let color = vm.sideToMove
            HStack(spacing: 10) {
                ForEach([PieceKind.queen, .rook, .bishop, .knight], id: \.self) { k in
                    Button { vm.choosePromotion(k) } label: {
                        Text(BoardView.glyph(Piece(color, k))).font(Theme.nunito(34, .regular))
                            .foregroundStyle(color == .white ? .white : .black)
                            .frame(width: 48, height: 48).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain)
                }
            }
            .padding(14).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)).shadow(radius: 18)
        }
    }
}

// Skip counts as a miss (rating down), like failing. Same-file extension can reach private members.
extension PuzzleVM {
    func finishSkip() {
        guard let puzzle, phase == .solving else { return }
        if solutionIndex < puzzle.moves.count, let cm = move(fromUci: puzzle.moves[solutionIndex], in: position) {
            correctSAN = position.san(for: cm)
        }
        finish(didSolve: false)
        message = "Skipped."
    }
}

struct FlowChips: View {
    let items: [String]
    var body: some View {
        let cols = [GridItem(.adaptive(minimum: 60), spacing: 4)]
        LazyVGrid(columns: cols, alignment: .leading, spacing: 4) {
            ForEach(items, id: \.self) { t in
                Text(t).font(Theme.nunito(11, .medium)).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.quaternary.opacity(0.6), in: Capsule())
            }
        }
    }
}
