import Foundation

// Legal chess move generation (Chess primitives, brief §11). 8×8 mailbox board.
// Square index = rank*8 + file, with a1 = 0, h1 = 7, a8 = 56, h8 = 63.
// Verified by perft against known node counts (see ParityRunner "perft" group).

public enum PieceColor: Int, Sendable, Equatable {
    case white, black
    public var opponent: PieceColor { self == .white ? .black : .white }
}

public enum PieceKind: Int, Sendable, Equatable {
    case pawn, knight, bishop, rook, queen, king
    public var sanLetter: String {
        switch self { case .pawn: return ""; case .knight: return "N"; case .bishop: return "B"
        case .rook: return "R"; case .queen: return "Q"; case .king: return "K" }
    }
}

public struct Piece: Equatable, Sendable {
    public let color: PieceColor
    public let kind: PieceKind
    public init(_ color: PieceColor, _ kind: PieceKind) { self.color = color; self.kind = kind }
}

public struct Move: Equatable, Sendable, Hashable {
    public let from: Int
    public let to: Int
    public let promotion: PieceKind?
    public init(from: Int, to: Int, promotion: PieceKind? = nil) {
        self.from = from; self.to = to; self.promotion = promotion
    }
    /// UCI form, e.g. "e2e4", "e7e8q".
    public var uci: String {
        Square.name(from) + Square.name(to) + (promotion?.sanLetter.lowercased() ?? "")
    }
}

public enum Square {
    public static func make(file: Int, rank: Int) -> Int { rank * 8 + file }
    public static func file(_ sq: Int) -> Int { sq & 7 }
    public static func rank(_ sq: Int) -> Int { sq >> 3 }

    /// Rank 1 or rank 8 — where a pawn promotes, whichever side it belongs to.
    ///
    /// Here rather than as a pair of screen constants. `CoachLayout` carried `lastRankWhite = 7`
    /// and `lastRankBlack = 0` because Play vs Coach was the only board you could push a pawn on;
    /// the Opening Tree explorer is the second, and a back rank is a fact about chess rather than
    /// about either screen's layout. The alternative was a second copy, which is the failure this
    /// codebase keeps writing gates against.
    public static func isBackRank(_ sq: Int) -> Bool {
        let r = rank(sq)
        return r == 0 || r == 7
    }
    public static func name(_ sq: Int) -> String {
        let f = Character(UnicodeScalar(UInt8(97 + file(sq))))
        return "\(f)\(rank(sq) + 1)"
    }
    public static func index(_ name: String) -> Int? {
        let cs = Array(name); guard cs.count == 2 else { return nil }
        guard let f = cs[0].asciiValue, let r = cs[1].asciiValue, f >= 97, f <= 104, r >= 49, r <= 56 else { return nil }
        return make(file: Int(f - 97), rank: Int(r - 49))
    }
}

public struct ChessPosition: Equatable, Sendable {
    public var squares: [Piece?]          // 64
    public var sideToMove: PieceColor
    public var castleWK: Bool, castleWQ: Bool, castleBK: Bool, castleBQ: Bool
    public var enPassant: Int?
    public var halfmove: Int
    public var fullmove: Int

    public static let startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    public init(squares: [Piece?], sideToMove: PieceColor, castleWK: Bool, castleWQ: Bool,
                castleBK: Bool, castleBQ: Bool, enPassant: Int?, halfmove: Int, fullmove: Int) {
        self.squares = squares; self.sideToMove = sideToMove
        self.castleWK = castleWK; self.castleWQ = castleWQ; self.castleBK = castleBK; self.castleBQ = castleBQ
        self.enPassant = enPassant; self.halfmove = halfmove; self.fullmove = fullmove
    }

    public static func start() -> ChessPosition { ChessPosition(fen: startFEN)! }

    // MARK: FEN

    public init?(fen: String) {
        let parts = fen.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard parts.count >= 4 else { return nil }
        var board = [Piece?](repeating: nil, count: 64)
        let ranks = parts[0].split(separator: "/").map(String.init)
        guard ranks.count == 8 else { return nil }
        for (i, rankStr) in ranks.enumerated() {
            let rank = 7 - i   // FEN lists rank 8 first
            var file = 0
            for ch in rankStr {
                if let d = ch.wholeNumberValue, d >= 1, d <= 8 { file += d; continue }
                guard file < 8, let p = ChessPosition.piece(from: ch) else { return nil }
                board[Square.make(file: file, rank: rank)] = p
                file += 1
            }
            guard file == 8 else { return nil }
        }
        self.squares = board
        self.sideToMove = parts[1] == "w" ? .white : .black
        let cr = parts[2]
        self.castleWK = cr.contains("K"); self.castleWQ = cr.contains("Q")
        self.castleBK = cr.contains("k"); self.castleBQ = cr.contains("q")
        self.enPassant = parts[3] == "-" ? nil : Square.index(parts[3])
        self.halfmove = parts.count > 4 ? Int(parts[4]) ?? 0 : 0
        self.fullmove = parts.count > 5 ? Int(parts[5]) ?? 1 : 1
    }

    public var fen: String {
        var rows: [String] = []
        for rank in stride(from: 7, through: 0, by: -1) {
            var row = "", empty = 0
            for file in 0..<8 {
                if let p = squares[Square.make(file: file, rank: rank)] {
                    if empty > 0 { row += "\(empty)"; empty = 0 }
                    row += ChessPosition.symbol(p)
                } else { empty += 1 }
            }
            if empty > 0 { row += "\(empty)" }
            rows.append(row)
        }
        var cr = ""
        if castleWK { cr += "K" }; if castleWQ { cr += "Q" }; if castleBK { cr += "k" }; if castleBQ { cr += "q" }
        if cr.isEmpty { cr = "-" }
        let ep = enPassant.map(Square.name) ?? "-"
        return "\(rows.joined(separator: "/")) \(sideToMove == .white ? "w" : "b") \(cr) \(ep) \(halfmove) \(fullmove)"
    }

    static func piece(from ch: Character) -> Piece? {
        let color: PieceColor = ch.isUppercase ? .white : .black
        switch Character(ch.lowercased()) {
        case "p": return Piece(color, .pawn); case "n": return Piece(color, .knight)
        case "b": return Piece(color, .bishop); case "r": return Piece(color, .rook)
        case "q": return Piece(color, .queen); case "k": return Piece(color, .king)
        default: return nil
        }
    }
    static func symbol(_ p: Piece) -> String {
        let base: String
        switch p.kind {
        case .pawn: base = "p"; case .knight: base = "n"; case .bishop: base = "b"
        case .rook: base = "r"; case .queen: base = "q"; case .king: base = "k"
        }
        return p.color == .white ? base.uppercased() : base
    }

    // MARK: Queries

    public func kingSquare(_ color: PieceColor) -> Int? {
        squares.firstIndex { $0 == Piece(color, .king) }
    }
    public func isInCheck(_ color: PieceColor) -> Bool {
        guard let k = kingSquare(color) else { return false }
        return isAttacked(k, by: color.opponent)
    }

    private static let knightOffsets = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
    private static let kingOffsets = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    private static let bishopDirs = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    private static let rookDirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]

    /// Is `sq` attacked by any piece of `color`?
    public func isAttacked(_ sq: Int, by color: PieceColor) -> Bool {
        let f = Square.file(sq), r = Square.rank(sq)
        // pawns: an enemy pawn attacks sq if it sits one rank toward its own side on an adjacent file.
        let pawnRankDir = color == .white ? -1 : 1  // where the attacking pawn would be relative to sq
        for df in [-1, 1] {
            let pf = f + df, pr = r + pawnRankDir
            if pf >= 0, pf < 8, pr >= 0, pr < 8, squares[Square.make(file: pf, rank: pr)] == Piece(color, .pawn) { return true }
        }
        // knights
        for (df, dr) in ChessPosition.knightOffsets {
            let nf = f + df, nr = r + dr
            if nf >= 0, nf < 8, nr >= 0, nr < 8, squares[Square.make(file: nf, rank: nr)] == Piece(color, .knight) { return true }
        }
        // king
        for (df, dr) in ChessPosition.kingOffsets {
            let kf = f + df, kr = r + dr
            if kf >= 0, kf < 8, kr >= 0, kr < 8, squares[Square.make(file: kf, rank: kr)] == Piece(color, .king) { return true }
        }
        // sliding: bishops/queens
        if slideHits(f, r, ChessPosition.bishopDirs, [.bishop, .queen], color) { return true }
        // sliding: rooks/queens
        if slideHits(f, r, ChessPosition.rookDirs, [.rook, .queen], color) { return true }
        return false
    }

    private func slideHits(_ f: Int, _ r: Int, _ dirs: [(Int, Int)], _ kinds: [PieceKind], _ color: PieceColor) -> Bool {
        for (df, dr) in dirs {
            var nf = f + df, nr = r + dr
            while nf >= 0, nf < 8, nr >= 0, nr < 8 {
                if let p = squares[Square.make(file: nf, rank: nr)] {
                    if p.color == color, kinds.contains(p.kind) { return true }
                    break
                }
                nf += df; nr += dr
            }
        }
        return false
    }

    // MARK: Move generation

    public func legalMoves() -> [Move] {
        pseudoLegalMoves().filter { m in
            let next = applyRaw(m)
            return !next.isAttacked(next.kingSquare(sideToMove) ?? -1, by: sideToMove.opponent)
        }
    }

    public func legalMoves(from sq: Int) -> [Move] { legalMoves().filter { $0.from == sq } }

    public func pseudoLegalMoves() -> [Move] {
        var moves: [Move] = []
        for sq in 0..<64 {
            guard let p = squares[sq], p.color == sideToMove else { continue }
            let f = Square.file(sq), r = Square.rank(sq)
            switch p.kind {
            case .pawn: pawnMoves(sq, f, r, p.color, &moves)
            case .knight: for (df, dr) in ChessPosition.knightOffsets { addLeap(sq, f + df, r + dr, p.color, &moves) }
            case .king:
                for (df, dr) in ChessPosition.kingOffsets { addLeap(sq, f + df, r + dr, p.color, &moves) }
                castlingMoves(sq, p.color, &moves)
            case .bishop: slide(sq, f, r, ChessPosition.bishopDirs, p.color, &moves)
            case .rook: slide(sq, f, r, ChessPosition.rookDirs, p.color, &moves)
            case .queen: slide(sq, f, r, ChessPosition.bishopDirs + ChessPosition.rookDirs, p.color, &moves)
            }
        }
        return moves
    }

    private func addLeap(_ from: Int, _ nf: Int, _ nr: Int, _ color: PieceColor, _ moves: inout [Move]) {
        guard nf >= 0, nf < 8, nr >= 0, nr < 8 else { return }
        let to = Square.make(file: nf, rank: nr)
        if let p = squares[to], p.color == color { return }
        moves.append(Move(from: from, to: to))
    }

    private func slide(_ from: Int, _ f: Int, _ r: Int, _ dirs: [(Int, Int)], _ color: PieceColor, _ moves: inout [Move]) {
        for (df, dr) in dirs {
            var nf = f + df, nr = r + dr
            while nf >= 0, nf < 8, nr >= 0, nr < 8 {
                let to = Square.make(file: nf, rank: nr)
                if let p = squares[to] { if p.color != color { moves.append(Move(from: from, to: to)) }; break }
                moves.append(Move(from: from, to: to))
                nf += df; nr += dr
            }
        }
    }

    private func pawnMoves(_ sq: Int, _ f: Int, _ r: Int, _ color: PieceColor, _ moves: inout [Move]) {
        let dir = color == .white ? 1 : -1
        let startRank = color == .white ? 1 : 6
        let promoRank = color == .white ? 7 : 0
        // single push
        let oneR = r + dir
        if oneR >= 0, oneR < 8, squares[Square.make(file: f, rank: oneR)] == nil {
            addPawn(sq, Square.make(file: f, rank: oneR), oneR == promoRank, &moves)
            // double push
            if r == startRank, squares[Square.make(file: f, rank: r + 2 * dir)] == nil {
                moves.append(Move(from: sq, to: Square.make(file: f, rank: r + 2 * dir)))
            }
        }
        // captures
        for df in [-1, 1] {
            let cf = f + df, cr = r + dir
            guard cf >= 0, cf < 8, cr >= 0, cr < 8 else { continue }
            let to = Square.make(file: cf, rank: cr)
            if let p = squares[to], p.color != color {
                addPawn(sq, to, cr == promoRank, &moves)
            } else if to == enPassant {
                moves.append(Move(from: sq, to: to))
            }
        }
    }

    private func addPawn(_ from: Int, _ to: Int, _ promo: Bool, _ moves: inout [Move]) {
        if promo {
            for k in [PieceKind.queen, .rook, .bishop, .knight] { moves.append(Move(from: from, to: to, promotion: k)) }
        } else { moves.append(Move(from: from, to: to)) }
    }

    private func castlingMoves(_ sq: Int, _ color: PieceColor, _ moves: inout [Move]) {
        let rank = color == .white ? 0 : 7
        guard sq == Square.make(file: 4, rank: rank) else { return }   // king on e-file
        if isAttacked(sq, by: color.opponent) { return }               // can't castle out of check
        let kingSide = color == .white ? castleWK : castleBK
        let queenSide = color == .white ? castleWQ : castleBQ
        if kingSide {
            let f5 = Square.make(file: 5, rank: rank), g6 = Square.make(file: 6, rank: rank)
            if squares[f5] == nil, squares[g6] == nil,
               !isAttacked(f5, by: color.opponent), !isAttacked(g6, by: color.opponent) {
                moves.append(Move(from: sq, to: g6))
            }
        }
        if queenSide {
            let d3 = Square.make(file: 3, rank: rank), c2 = Square.make(file: 2, rank: rank), b1 = Square.make(file: 1, rank: rank)
            if squares[d3] == nil, squares[c2] == nil, squares[b1] == nil,
               !isAttacked(d3, by: color.opponent), !isAttacked(c2, by: color.opponent) {
                moves.append(Move(from: sq, to: c2))
            }
        }
    }

    // MARK: Make move

    /// Apply a move, returning the resulting position. Handles captures, en passant, castling,
    /// promotion, castling-right updates, the en-passant target, clocks, and side to move.
    public func makeMove(_ m: Move) -> ChessPosition { applyRaw(m) }

    private func applyRaw(_ m: Move) -> ChessPosition {
        var p = self
        let piece = squares[m.from]!
        let isPawn = piece.kind == .pawn
        let isCapture = squares[m.to] != nil || (isPawn && m.to == enPassant)

        p.squares[m.from] = nil
        // en passant capture: remove the pawn behind the target
        if isPawn, m.to == enPassant, squares[m.to] == nil {
            let capRank = Square.rank(m.from)
            p.squares[Square.make(file: Square.file(m.to), rank: capRank)] = nil
        }
        // place piece (with promotion)
        p.squares[m.to] = Piece(piece.color, m.promotion ?? piece.kind)

        // castling: move the rook
        if piece.kind == .king, abs(Square.file(m.to) - Square.file(m.from)) == 2 {
            let rank = Square.rank(m.from)
            if Square.file(m.to) == 6 { // king side
                p.squares[Square.make(file: 5, rank: rank)] = p.squares[Square.make(file: 7, rank: rank)]
                p.squares[Square.make(file: 7, rank: rank)] = nil
            } else { // queen side
                p.squares[Square.make(file: 3, rank: rank)] = p.squares[Square.make(file: 0, rank: rank)]
                p.squares[Square.make(file: 0, rank: rank)] = nil
            }
        }

        // castling rights
        if piece.kind == .king { if piece.color == .white { p.castleWK = false; p.castleWQ = false } else { p.castleBK = false; p.castleBQ = false } }
        func clearRookRight(_ sq: Int) {
            switch sq {
            case Square.make(file: 0, rank: 0): p.castleWQ = false
            case Square.make(file: 7, rank: 0): p.castleWK = false
            case Square.make(file: 0, rank: 7): p.castleBQ = false
            case Square.make(file: 7, rank: 7): p.castleBK = false
            default: break
            }
        }
        clearRookRight(m.from) // rook moved
        clearRookRight(m.to)   // rook captured on its home square

        // en passant target (only on a double pawn push)
        if isPawn, abs(Square.rank(m.to) - Square.rank(m.from)) == 2 {
            p.enPassant = Square.make(file: Square.file(m.from), rank: (Square.rank(m.from) + Square.rank(m.to)) / 2)
        } else {
            p.enPassant = nil
        }

        p.halfmove = (isPawn || isCapture) ? 0 : p.halfmove + 1
        if sideToMove == .black { p.fullmove += 1 }
        p.sideToMove = sideToMove.opponent
        return p
    }

    // MARK: Status

    public enum Status: Equatable { case ongoing, check, checkmate, stalemate }
    public func status() -> Status {
        let inCheck = isInCheck(sideToMove)
        if legalMoves().isEmpty { return inCheck ? .checkmate : .stalemate }
        return inCheck ? .check : .ongoing
    }

    // MARK: SAN (for move-history display)

    public func san(for m: Move) -> String {
        let piece = squares[m.from]!
        // castling
        if piece.kind == .king, abs(Square.file(m.to) - Square.file(m.from)) == 2 {
            let base = Square.file(m.to) == 6 ? "O-O" : "O-O-O"
            return base + checkSuffix(after: applyRaw(m))
        }
        let isCapture = squares[m.to] != nil || (piece.kind == .pawn && m.to == enPassant)
        var s = ""
        if piece.kind == .pawn {
            if isCapture { s += "\(Character(UnicodeScalar(UInt8(97 + Square.file(m.from)))))x" }
            s += Square.name(m.to)
            if let promo = m.promotion { s += "=\(promo.sanLetter)" }
        } else {
            s += piece.kind.sanLetter
            s += disambiguation(for: m, piece: piece)
            if isCapture { s += "x" }
            s += Square.name(m.to)
        }
        return s + checkSuffix(after: applyRaw(m))
    }

    private func disambiguation(for m: Move, piece: Piece) -> String {
        let others = legalMoves().filter { $0.to == m.to && $0.from != m.from && squares[$0.from] == piece }
        if others.isEmpty { return "" }
        let sameFile = others.contains { Square.file($0.from) == Square.file(m.from) }
        let sameRank = others.contains { Square.rank($0.from) == Square.rank(m.from) }
        if !sameFile { return "\(Character(UnicodeScalar(UInt8(97 + Square.file(m.from)))))" }
        if !sameRank { return "\(Square.rank(m.from) + 1)" }
        return Square.name(m.from)
    }

    private func checkSuffix(after next: ChessPosition) -> String {
        let st = next.status()
        if st == .checkmate { return "#" }
        if st == .check { return "+" }
        return ""
    }
}

/// Perft (move-generation correctness test): count leaf nodes at `depth`.
public func perft(_ pos: ChessPosition, _ depth: Int) -> Int {
    if depth == 0 { return 1 }
    let moves = pos.legalMoves()
    if depth == 1 { return moves.count }
    var nodes = 0
    for m in moves { nodes += perft(pos.makeMove(m), depth - 1) }
    return nodes
}
