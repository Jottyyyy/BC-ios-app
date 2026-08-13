import Foundation

/// The per-persona opening book (spec §2.3) — the lookup. The tables are in the generated
/// `CoachBookData.swift`.
///
/// Twin of `web-demo/js/coach-book.js`; `tools/qa/replay_coach.js` checks this source against it,
/// and the JS side additionally replays all 58 lines on a real board.
///
/// ## Declarative, not a nested `if`
///
/// The RN source expresses this as a chain of nested conditionals per level. As a chain, "level 3
/// as Black against 1.e4" is a *path through the code*, so nothing can enumerate the book, count it
/// or diff it against the source. As rows it is data.
///
/// ## Two rules that carry the feature
///
///   1. The book stops once 14 plies have been played (seven per side); after that the search owns
///      the game.
///   2. **An unplayable book move falls through to the engine SILENTLY.** A hard-coded line meeting
///      a real board is not an error condition — it is Tuesday. Never crash, never pass.
public enum CoachBook {

    /// One book entry: either an exact SAN-history prefix, or a ply count.
    public struct Row: Equatable, Sendable {
        /// The exact SAN list that must have been played. `nil` means this row is gated on ply
        /// COUNT alone — the London, which plays the same setup whatever the opponent does.
        public let history: [String]?
        public let move: String
        public let atPly: Int?

        public init(history: [String], move: String) {
            self.history = history; self.move = move; self.atPly = nil
        }
        public init(atPly: Int, move: String) {
            self.history = nil; self.move = move; self.atPly = atPly
        }
    }

    /// The book's move for this position, or nil to let the engine decide.
    ///
    /// `rng` returns [0,1) and is only consulted by level 1's pool.
    public static func bookMove(level: Int,
                                sanHistory: [String],
                                isLegal: ((String) -> Bool)? = nil,
                                rng: () -> Double) -> String? {
        if sanHistory.count >= bookPlies { return nil }
        let side: CoachGame.Side = sanHistory.count % 2 == 0 ? .white : .black
        guard let candidate = candidate(level: level, side: side,
                                        history: sanHistory, rng: rng) else { return nil }
        // Not an error. The spec is explicit: fall through silently.
        if let isLegal = isLegal, !isLegal(candidate) { return nil }
        return candidate
    }

    static func candidate(level: Int, side: CoachGame.Side,
                          history: [String], rng: () -> Double) -> String? {
        if level == 1 {
            // Move 1 only. As Black that means exactly one ply has been played, whatever it was.
            if side == .white && history.isEmpty { return pool(l1White, rng) }
            if side == .black && history.count == 1 { return pool(l1Black, rng) }
            return nil
        }
        guard let rows = rules[level]?[side] else { return nil }
        for row in rows {
            guard let want = row.history else {
                if history.count == row.atPly { return row.move }
                continue
            }
            if want == history { return row.move }
        }
        return nil
    }

    static func pool(_ moves: [String], _ rng: () -> Double) -> String {
        moves[Int(rng() * Double(moves.count)) % moves.count]
    }

    /// Every move the book can ever play, for the legality sweep in the tests.
    public static func allMoves() -> [String] {
        var out = l1White + l1Black
        for level in rules.keys.sorted() {
            for side in [CoachGame.Side.white, .black] {
                out.append(contentsOf: (rules[level]?[side] ?? []).map { $0.move })
            }
        }
        return out
    }
}
