import Foundation
import BiyaherongCoachCore

/// The translation between what UCI says and what `AnalysisEngine` promises.
///
/// Every judgement call in the Stockfish integration lives here, and **nothing here touches C**.
/// That is the whole design: `biya_stockfish.cpp` cannot be compiled on this checkout, so it was
/// kept to marshalling, and each decision that could be wrong in a way a reader would not notice —
/// the score sign, the mate rounding, which of two reports for the same line wins, where a PV stops
/// — was pushed up into Swift, where `tools/qa/stockfish_bridge_twin.js` mirrors it and
/// `tools/qa/replay_stockfish.js` asserts both against the same vectors.
///
/// See `docs/stockfish.md`.
public enum StockfishBridge {

    /// How many plies of a principal variation are kept.
    ///
    /// Pinned to `LocalEngine.pvExtendLimit` by `tools/qa/replay_stockfish.js` rather than read from
    /// it: the two engines arrive at a PV by completely different means, and the panel is entitled
    /// to the same line length from both. Stockfish routinely reports thirty-ply PVs and parsing
    /// every one of them costs SAN generation on the search thread, so this is also the cost bound.
    public static let pvLimit = 14

    // MARK: - One report, as the C layer delivered it

    /// A single `info` line: one multi-PV rank at one depth, still side-to-move relative and with
    /// its principal variation unparsed.
    public struct RawLine: Equatable, Sendable {
        public var depth: Int
        public var selDepth: Int
        /// 1-based, as UCI numbers it.
        public var multiPV: Int
        public var isMate: Bool
        /// Centipawns, or signed moves-to-mate. **Side-to-move relative.**
        public var value: Int
        public var isLowerBound: Bool
        public var isUpperBound: Bool
        public var nodes: Int
        public var timeMs: Int
        /// Space-separated UCI moves.
        public var pv: String

        public init(depth: Int, selDepth: Int = 0, multiPV: Int, isMate: Bool, value: Int,
                    isLowerBound: Bool = false, isUpperBound: Bool = false,
                    nodes: Int = 0, timeMs: Int = 0, pv: String = "") {
            self.depth = depth; self.selDepth = selDepth; self.multiPV = multiPV
            self.isMate = isMate; self.value = value
            self.isLowerBound = isLowerBound; self.isUpperBound = isUpperBound
            self.nodes = nodes; self.timeMs = timeMs; self.pv = pv
        }

        /// A score Stockfish reported as a window bound rather than a value it stands behind.
        public var isBound: Bool { isLowerBound || isUpperBound }
    }

    // MARK: - Score

    /// Convert one UCI score into an `EngineScore`.
    ///
    /// **This is the sign flip, and it happens exactly once.** UCI scores are side-to-move relative;
    /// `EngineScore` is documented in `AnalysisEngine.swift` as always White-relative, because the
    /// eval bar, the eval graph and `GameReview` all are. Every other layer may assume it is done.
    ///
    /// `mate 0` needs a word. Stockfish's mate distance is `(plies + 1) / 2` when winning and
    /// `plies / 2` when losing, with C's truncation toward zero — so a side that is mated one ply
    /// from now reports `mate 0`, and a *winning* side never can, because a positive `plies` of 0
    /// would mean the mate is already on the board and the search would not have run. A zero is
    /// therefore always the side to move being mated, and is reported as a mate of magnitude 1
    /// against them. That keeps `EngineScore.mate`'s documented "never zero" invariant true for this
    /// engine as well as for `LocalEngine`.
    public static func whiteRelative(isMate: Bool, value: Int, sideToMove: PieceColor) -> EngineScore {
        let sign = sideToMove == .white ? 1 : -1
        guard isMate else { return .cp(value * sign) }
        if value == 0 { return .mate(-sign) }
        return .mate(value * sign)
    }

    // MARK: - Principal variation

    /// Walk a UCI principal variation, producing the moves and their SAN.
    ///
    /// Stops at the first token that is not legal in the position it reaches, rather than guessing.
    /// Nothing should ever hit that — Stockfish only reports moves it played — but the alternative
    /// to stopping is applying a move our own rules reject, and the two disagreeing is exactly the
    /// kind of thing worth surfacing as a short line rather than a wrong board.
    public static func parsePV(_ pv: String, from position: ChessPosition,
                               limit: Int = pvLimit) -> (moves: [Move], san: [String]) {
        var moves: [Move] = []
        var san: [String] = []
        var current = position

        for token in pv.split(separator: " ") {
            if moves.count >= limit { break }
            let text = String(token)
            guard let move = current.legalMoves().first(where: { $0.uci == text }) else { break }
            san.append(current.san(for: move))
            moves.append(move)
            current = current.makeMove(move)
        }
        return (moves, san)
    }

    // MARK: - Accumulating one iteration

    /// Fold one report into the set being built for its depth, keyed by multi-PV rank.
    ///
    /// The rule that matters: **an exact score is never replaced by a bound.** Stockfish reports
    /// `lowerbound`/`upperbound` while an aspiration window is failing, and those numbers can sit
    /// whole pawns away from what the same depth settles on a moment later. Letting one overwrite a
    /// finished score makes the eval bar lurch on every re-search — visible, wrong, and very hard to
    /// attribute to anything once it ships.
    public static func merge(_ line: RawLine, into store: inout [Int: RawLine]) {
        guard let existing = store[line.multiPV] else {
            store[line.multiPV] = line
            return
        }
        if !line.isBound || existing.isBound { store[line.multiPV] = line }
    }

    /// Assemble one completed iteration into the snapshot the panel consumes.
    ///
    /// Ranks are renumbered from the multi-PV order Stockfish reported. `EngineLine.rank` is
    /// 0-based — UCI's `multipv` is 1-based — and getting that wrong shows the second-best move as
    /// the best one, which reads as an engine bug rather than an off-by-one.
    public static func snapshot(position: ChessPosition,
                                depth: Int,
                                nodes: Int,
                                store: [Int: RawLine],
                                isFinal: Bool,
                                terminal: TerminalOutcome? = nil) -> AnalysisSnapshot {
        let lines = store.values
            .sorted { $0.multiPV < $1.multiPV }
            .map { raw -> EngineLine in
                let parsed = parsePV(raw.pv, from: position)
                return EngineLine(
                    rank: raw.multiPV - 1,
                    score: whiteRelative(isMate: raw.isMate, value: raw.value,
                                         sideToMove: position.sideToMove),
                    pv: parsed.moves,
                    pvSAN: parsed.san,
                    depth: raw.depth)
            }
        return AnalysisSnapshot(fen: position.fen, depth: depth, nodes: nodes,
                                lines: lines, isFinal: isFinal, terminal: terminal)
    }

    /// Has this depth reported every line it was going to?
    ///
    /// A search that is stopped mid-iteration leaves rank 1 updated and ranks 2 and 3 still holding
    /// the previous depth's numbers, which is a snapshot that never existed — the top line a ply
    /// deeper than the ones under it, and orderable into a sequence Stockfish never believed. When
    /// that happens the last COMPLETE iteration is returned instead, which is what
    /// `AnalysisSnapshot` documents itself to be.
    ///
    /// `legalMoves` bounds it: asking for four lines in a position with two legal moves would
    /// otherwise never be complete.
    public static func isComplete(store: [Int: RawLine], multiPV: Int, legalMoves: Int) -> Bool {
        store.count >= min(multiPV, max(legalMoves, 1))
    }

    // MARK: - What the panel calls the engine

    /// The engine's name for the Engine panel.
    ///
    /// This exists because the fallback is **silent**. If the NNUE resources fail to load,
    /// `AnalysisVM` quietly uses `LocalEngine` and every screen still works — which is right for the
    /// user and terrible for anyone trying to find out whether a TestFlight build is actually
    /// running Stockfish. Without a name on screen the only symptom is a depth chip that stops
    /// climbing, which nobody would recognise as a resource failure.
    ///
    /// Deliberately not routed through `EngineSettings.panelModel`: that lives in the Parity Core,
    /// which `CLAUDE.md` requires to stay engine-agnostic. The panel is handed these strings.
    public static func engineLabel(available: Bool) -> String {
        available ? "Stockfish 17.1" : "Built-in engine"
    }

    /// The line under the name when Stockfish is NOT the engine, or `nil` when it is.
    ///
    /// Phrased as a statement of fact rather than an apology: the app is not broken, it is weaker,
    /// and the person who needs to act on it is a developer reading a build.
    public static func engineNote(available: Bool) -> String? {
        available ? nil : "Stockfish could not load — analysis is using the built-in engine."
    }

    // MARK: - Limits

    /// What `SearchLimits` means to a UCI engine.
    ///
    /// `SearchLimits` carries depth, nodes and multiPV and deliberately no clock —
    /// `AnalysisEngine.swift` puts a deadline in `shouldCancel` so a result stays reproducible in a
    /// test. Stockfish, though, is a clock-driven engine, and cancelling it only between `info`
    /// reports means a deep iteration overruns the budget by however long that iteration takes. So
    /// the deadline is handed to it as `movetime` **as well as** being polled: `movetime` keeps the
    /// board responsive, `shouldCancel` keeps a user-initiated stop immediate.
    ///
    /// `multiPV` is clamped to the same 1…8 the C layer clamps to, so the two cannot disagree about
    /// how many lines were asked for.
    public static func resolve(_ limits: SearchLimits,
                               movetimeMs: Int?) -> (depth: Int, multiPV: Int, nodes: Int, movetimeMs: Int) {
        (depth: min(max(limits.maxDepth, 1), 245),
         multiPV: min(max(limits.multiPV, 1), 8),
         nodes: max(limits.maxNodes, 0),
         movetimeMs: max(movetimeMs ?? 0, 0))
    }
}
