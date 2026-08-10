import Foundation

// Setup Position — the Analysis Board's edit mode.
//
// Ported from board.tsx: `handleEditSquarePress:2389`, `syncCastlingFromFen:2421`,
// `toggleEditMode:2429`, `handleLoadFen:2533` and `validateKingPositions:334`.
//
// ── Why validation lives here ─────────────────────────────────────────────────
// The original checks only two things itself (`validateKingPositions`): a missing king, and kings
// standing next to each other. Everything else it delegates to chess.js — `toggleEditMode:2448`
// builds the FEN, hands it to `new Chess(fen)` and catches the throw. We have no chess.js offline,
// so those rejections have to be written down rather than inherited. The set below is what that
// constructor would have refused:
//
//   missing king · two kings of one colour · adjacent kings · a pawn on rank 1 or 8 ·
//   the side NOT to move already in check (you cannot be "about to be captured")
//
// One deliberate softening, recorded in PORTING_NOTES: castling rights whose king or rook is not on
// its home square are DROPPED SILENTLY rather than reported. That is the X-FEN convention, it is
// what a user ticking `⬜K` on a board with no h1 rook actually means, and refusing would be a dead
// end with no obvious fix. Everything else is a hard stop with a message.
//
// The editor never sets an en-passant square: neither does the original, because chess.js emits `-`
// for any position it did not reach by a double pawn push.
//
// PURE — Foundation only, no clock, no I/O. Mirrored line-for-line by
// web-demo/js/position-editor.js; the ParityRunner `position_editor` group asserts the same table.

public struct PositionEditor: Equatable, Sendable {

    // MARK: - Palette

    /// board.tsx:276-277 — the palette rows, in the source's order.
    public static let whitePieceKeys = ["K", "Q", "R", "B", "N", "P"]
    public static let blackPieceKeys = ["k", "q", "r", "b", "n", "p"]

    /// `"K"` → white king. `nil` for anything unrecognised.
    /// `ChessPosition.piece(from:)` already reads the colour off the letter's case, so this is the
    /// FEN letter mapping the board itself uses — not a second copy of it.
    public static func piece(forKey key: String) -> Piece? {
        guard key.count == 1, let ch = key.first else { return nil }
        return ChessPosition.piece(from: ch)
    }

    /// The inverse, for showing which palette button matches a square.
    public static func key(for piece: Piece?) -> String? {
        guard let p = piece else { return nil }
        let base = p.kind.sanLetter.isEmpty ? "P" : p.kind.sanLetter
        return p.color == .white ? base : base.lowercased()
    }

    // MARK: - State

    public var squares: [Piece?]
    public var sideToMove: PieceColor
    public var castleWK: Bool
    public var castleWQ: Bool
    public var castleBK: Bool
    public var castleBQ: Bool

    public init(squares: [Piece?], sideToMove: PieceColor,
                castleWK: Bool, castleWQ: Bool, castleBK: Bool, castleBQ: Bool) {
        self.squares = squares
        self.sideToMove = sideToMove
        self.castleWK = castleWK
        self.castleWQ = castleWQ
        self.castleBK = castleBK
        self.castleBQ = castleBQ
    }

    /// Start from a position. A FEN that will not parse falls back to the standard array, exactly
    /// as the JS twin does, so the editor always opens on something usable.
    public init(fen: String = ChessPosition.startFEN) {
        let pos = ChessPosition(fen: fen) ?? ChessPosition.start()
        self.init(squares: pos.squares, sideToMove: pos.sideToMove,
                  castleWK: pos.castleWK, castleWQ: pos.castleWQ,
                  castleBK: pos.castleBK, castleBQ: pos.castleBQ)
    }

    public init(_ position: ChessPosition) {
        self.init(squares: position.squares, sideToMove: position.sideToMove,
                  castleWK: position.castleWK, castleWQ: position.castleWQ,
                  castleBK: position.castleBK, castleBQ: position.castleBQ)
    }

    // MARK: - Editing

    @discardableResult
    public mutating func put(_ key: String, at square: Int) -> Bool {
        guard (0...63).contains(square), let p = PositionEditor.piece(forKey: key) else { return false }
        squares[square] = p
        return true
    }

    @discardableResult
    public mutating func remove(at square: Int) -> Bool {
        guard (0...63).contains(square) else { return false }
        let had = squares[square] != nil
        squares[square] = nil
        return had
    }

    /// 🧹 Clear — board.tsx:3675. Castling rights go with the rooks.
    public mutating func clear() {
        squares = [Piece?](repeating: nil, count: 64)
        castleWK = false; castleWQ = false; castleBK = false; castleBQ = false
    }

    /// Back to the standard array, side and rights. Not in the source's UI, but the obvious inverse.
    public mutating func reset() {
        let s = ChessPosition.start()
        squares = s.squares
        sideToMove = s.sideToMove
        castleWK = true; castleWQ = true; castleBK = true; castleBQ = true
    }

    @discardableResult
    public mutating func toggleSideToMove() -> PieceColor {
        sideToMove = sideToMove.opponent
        return sideToMove
    }

    /// Paste FEN → Load (board.tsx:2533-2547). The source also syncs the turn and the castling
    /// toggles from the loaded string (`:2540-2542`), which is the only reason this is not `init`.
    ///
    /// The trim is load-bearing HERE and not in the JS twin: `ChessPosition(fen:)` splits on the
    /// SPACE character alone, so a FEN pasted from a web page with a leading tab would be refused.
    @discardableResult
    public mutating func loadFEN(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let pos = ChessPosition(fen: trimmed) else { return false }
        squares = pos.squares
        sideToMove = pos.sideToMove
        castleWK = pos.castleWK; castleWQ = pos.castleWQ
        castleBK = pos.castleBK; castleBQ = pos.castleBQ
        return true
    }

    // MARK: - Castling normalisation

    private static let e1 = 4, h1 = 7, a1 = 0, e8 = 60, h8 = 63, a8 = 56

    private func has(_ square: Int, _ color: PieceColor, _ kind: PieceKind) -> Bool {
        guard let p = squares[square] else { return false }
        return p.color == color && p.kind == kind
    }

    public struct CastlingRights: Equatable, Sendable {
        public let wk: Bool, wq: Bool, bk: Bool, bq: Bool
        public init(wk: Bool, wq: Bool, bk: Bool, bq: Bool) {
            self.wk = wk; self.wq = wq; self.bk = bk; self.bq = bq
        }
    }

    /// Drop rights the board cannot support. X-FEN convention, applied silently — see the header.
    public var normalizedCastling: CastlingRights {
        let wKingHome = has(PositionEditor.e1, .white, .king)
        let bKingHome = has(PositionEditor.e8, .black, .king)
        return CastlingRights(
            wk: castleWK && wKingHome && has(PositionEditor.h1, .white, .rook),
            wq: castleWQ && wKingHome && has(PositionEditor.a1, .white, .rook),
            bk: castleBK && bKingHome && has(PositionEditor.h8, .black, .rook),
            bq: castleBQ && bKingHome && has(PositionEditor.a8, .black, .rook))
    }

    // MARK: - FEN

    /// The position the editor currently describes. Clocks are always fresh and there is never an
    /// en-passant square, exactly as `new Chess(fen)` produces for a hand-built board.
    public var position: ChessPosition {
        let c = normalizedCastling
        return ChessPosition(squares: squares, sideToMove: sideToMove,
                             castleWK: c.wk, castleWQ: c.wq, castleBK: c.bk, castleBQ: c.bq,
                             enPassant: nil, halfmove: 0, fullmove: 1)
    }

    public var fen: String { position.fen }

    // MARK: - Validation

    public enum Issue: String, Sendable, Equatable, CaseIterable {
        case whiteKingMissing, blackKingMissing
        case tooManyWhiteKings, tooManyBlackKings
        case kingsAdjacent
        case pawnOnBackRank
        case sideNotToMoveInCheck

        /// The first two are the source's own strings, verbatim (validateKingPositions:352, :356).
        public var text: String {
            switch self {
            case .whiteKingMissing:     return "White king is missing."
            case .blackKingMissing:     return "Black king is missing."
            case .tooManyWhiteKings:    return "There can only be one white king."
            case .tooManyBlackKings:    return "There can only be one black king."
            case .kingsAdjacent:        return "Kings cannot be adjacent — illegal position."
            case .pawnOnBackRank:       return "A pawn cannot stand on rank 1 or rank 8."
            case .sideNotToMoveInCheck: return "The side not to move is already in check."
            }
        }
    }

    /// Every reason this board cannot be played from, in a fixed order so the banner is stable.
    public func validate() -> [Issue] {
        var out: [Issue] = []
        var whiteKings: [Int] = []
        var blackKings: [Int] = []
        var pawnOnBack = false

        for sq in 0..<64 {
            guard let p = squares[sq] else { continue }
            if p.kind == .king {
                if p.color == .white { whiteKings.append(sq) } else { blackKings.append(sq) }
            }
            if p.kind == .pawn {
                let rank = Square.rank(sq)
                if rank == 0 || rank == 7 { pawnOnBack = true }
            }
        }

        if whiteKings.isEmpty { out.append(.whiteKingMissing) }
        if blackKings.isEmpty { out.append(.blackKingMissing) }
        if whiteKings.count > 1 { out.append(.tooManyWhiteKings) }
        if blackKings.count > 1 { out.append(.tooManyBlackKings) }

        // Every pair, not just the first of each colour: on a board that already has a duplicate
        // king, checking only whiteKings[0] would let a genuine adjacency hide behind the count.
        var adjacent = false
        outer: for w in whiteKings {
            for b in blackKings
            where abs(Square.file(w) - Square.file(b)) <= 1 && abs(Square.rank(w) - Square.rank(b)) <= 1 {
                adjacent = true
                break outer
            }
        }
        if adjacent { out.append(.kingsAdjacent) }

        if pawnOnBack { out.append(.pawnOnBackRank) }

        // The side that just "moved" cannot still be in check — chess.js refuses this too.
        if whiteKings.count == 1, blackKings.count == 1, !adjacent {
            if position.isInCheck(sideToMove.opponent) { out.append(.sideNotToMoveInCheck) }
        }

        return out
    }

    public var isValid: Bool { validate().isEmpty }

    /// The banner text, or nil when the board is playable.
    public var firstIssueText: String? { validate().first?.text }

    /// ✓ Apply Position (board.tsx:2432-2471). nil means the board was refused, and the caller
    /// keeps the user in edit mode exactly as the source's `return` does after its Alert.
    public func apply() -> ChessPosition? {
        guard isValid else { return nil }
        return ChessPosition(fen: fen)      // round-trip so the caller gets a canonical position
    }

    /// The edited board as a brand-new game.
    public func makeTree() -> MoveTree? {
        guard apply() != nil else { return nil }
        return MoveTree(initialFEN: fen)
    }
}
