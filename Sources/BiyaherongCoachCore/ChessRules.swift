import Foundation

/// Draw detection and the canonical position key (Analysis Board; Chess primitives, brief §11).
///
/// `ChessPosition.Status` deliberately stays a four-case enum (`ongoing / check / checkmate /
/// stalemate`) — it is switched on exhaustively by the UI layer, and widening it would be a
/// source-breaking change to code this package cannot see. Draws therefore live here, in a parallel
/// API, exactly as they do in the JavaScript twin (`web-demo/js/engine.js`).
///
/// Mirrored by `Engine.positionKey` / `drawReason` / `terminalOutcome` in the twin; the key itself
/// is additionally pinned byte-for-byte against the PHP oracle by all 3,105 `san_parse` goldens.

// MARK: - Terminal state

/// Why a game is over. Raw values match the JavaScript twin's strings exactly.
public enum TerminalReason: String, Sendable, Equatable {
    case checkmate, stalemate, insufficient, fifty, repetition
}

/// What kind of ending it is.
public enum TerminalKind: String, Sendable, Equatable {
    case ongoing, checkmate, draw
}

/// The single verdict the engine and the game review both short-circuit on, so neither has to
/// re-derive "is this position over?" for itself.
public struct TerminalOutcome: Equatable, Sendable {
    public let kind: TerminalKind
    public let reason: TerminalReason?
    /// The side that delivered mate; `nil` for a draw or an ongoing game.
    public let winner: PieceColor?

    public init(kind: TerminalKind, reason: TerminalReason?, winner: PieceColor?) {
        self.kind = kind
        self.reason = reason
        self.winner = winner
    }
}

// MARK: - Repetition

/// Repetition helpers over a list of `positionKey`s.
public enum ChessRules {

    /// How many times `key` appears in the history.
    public static func repetitionCount(_ historyKeys: [String], of key: String) -> Int {
        var n = 0
        for k in historyKeys where k == key { n += 1 }
        return n
    }

    /// True once the same position has occurred three times. `historyKeys` must **include the
    /// current position**, not just its predecessors.
    public static func isThreefold(_ historyKeys: [String], of key: String) -> Bool {
        repetitionCount(historyKeys, of: key) >= 3
    }
}

// MARK: - Position key and draw rules

extension ChessPosition {

    // MARK: Position key

    /// The canonical position identity: the four-field FEN with the en-passant square cleared
    /// unless a capture can actually use it.
    ///
    /// Clearing a *dead* en-passant square is load-bearing, not tidying. `fen` records the target
    /// after any double pawn push, so `1. e4 e5 2. Nf3` and `1. Nf3 e5 2. e4` would otherwise hash
    /// differently despite being the same position — which breaks the commonest transpositions in
    /// chess and makes threefold repetition miss by one occurrence. This was measured, not
    /// theorised: the first ECO book build collapsed zero transpositions until it was fixed.
    /// Clearing it is the standard EPD/X-FEN convention.
    ///
    /// The availability test is the *presence of a capturing pawn* (pseudo-legal): a pawn pinned
    /// against its own king still counts. That keeps the rule trivially identical in PHP, Swift and
    /// JavaScript, and a pin cannot change an opening name.
    ///
    /// Derived from `fen` rather than from the stored properties so it cannot drift from FEN
    /// serialization. Byte-identical to `oracle_position_key()` in `tools/oracle/chess_oracle.php`.
    public var positionKey: String {
        let parts = fen.split(separator: " ")
        guard parts.count >= 4 else { return fen }
        let ep = (parts[3] == "-" || hasAvailableEnPassantCapture) ? String(parts[3]) : "-"
        return "\(parts[0]) \(parts[1]) \(parts[2]) \(ep)"
    }

    /// Is there a pawn of the side to move standing next to the en-passant target?
    private var hasAvailableEnPassantCapture: Bool {
        guard let ep = enPassant else { return false }
        let epFile = Square.file(ep)
        // White captures upward, so its pawn sits a rank below the target; Black's sits above.
        let fromRank = sideToMove == .white ? Square.rank(ep) - 1 : Square.rank(ep) + 1
        guard fromRank >= 0, fromRank <= 7 else { return false }
        let pawn = Piece(sideToMove, .pawn)
        if epFile > 0, squares[Square.make(file: epFile - 1, rank: fromRank)] == pawn { return true }
        if epFile < 7, squares[Square.make(file: epFile + 1, rank: fromRank)] == pawn { return true }
        return false
    }

    // MARK: Draw rules

    /// Positions where mate is impossible with any sequence of legal moves: K/K, K+B/K, K+N/K, and
    /// any position where every remaining bishop shares one colour complex.
    ///
    /// K+N+N/K is deliberately **not** insufficient — mate there is unforceable but not impossible,
    /// and FIDE treats it as a live game.
    public var hasInsufficientMaterial: Bool {
        var bishops: [Int] = []
        var knights = 0
        var others = 0
        for sq in 0 ..< 64 {
            guard let p = squares[sq], p.kind != .king else { continue }
            switch p.kind {
            case .bishop: bishops.append(sq)
            case .knight: knights += 1
            default: others += 1
            }
        }
        if others > 0 { return false }                  // a pawn, rook or queen can always mate
        if bishops.isEmpty { return knights <= 1 }      // K/K and K+N/K
        if knights > 0 { return false }                 // bishop + knight can mate
        if bishops.count == 1 { return true }           // K+B/K
        let colour = (Square.file(bishops[0]) + Square.rank(bishops[0])) & 1
        for i in 1 ..< bishops.count {
            if ((Square.file(bishops[i]) + Square.rank(bishops[i])) & 1) != colour { return false }
        }
        return true
    }

    /// The fifty-move rule: 100 half-moves without a pawn move or a capture.
    public var isFiftyMoveDraw: Bool { halfmove >= 100 }

    /// Why this position is a draw, if it is. Stalemate is **not** reported here — it belongs to
    /// `status()` — so this covers only the three claimable draws.
    ///
    /// `historyKeys` must include the current position's key.
    public func drawReason(historyKeys: [String] = []) -> TerminalReason? {
        if hasInsufficientMaterial { return .insufficient }
        if isFiftyMoveDraw { return .fifty }
        if ChessRules.isThreefold(historyKeys, of: positionKey) { return .repetition }
        return nil
    }

    /// The complete verdict for this position. Checkmate outranks everything; stalemate outranks
    /// the claimable draws.
    ///
    /// `historyKeys` must include the current position's key. Omit it when repetition is not being
    /// tracked — the other rules still apply.
    public func terminalOutcome(historyKeys: [String] = []) -> TerminalOutcome {
        switch status() {
        case .checkmate:
            return TerminalOutcome(kind: .checkmate, reason: .checkmate, winner: sideToMove.opponent)
        case .stalemate:
            return TerminalOutcome(kind: .draw, reason: .stalemate, winner: nil)
        case .ongoing, .check:
            if let reason = drawReason(historyKeys: historyKeys) {
                return TerminalOutcome(kind: .draw, reason: reason, winner: nil)
            }
            return TerminalOutcome(kind: .ongoing, reason: nil, winner: nil)
        }
    }
}
