import Foundation

/// The in-repo analysis search — the interim `AnalysisEngine` until Stockfish is embedded.
///
/// Transliterated from `web-demo/js/analysis-engine.js`, which is proven by a 44-assertion suite
/// covering forced mates (expectations derived from a brute-force checker, not from this search),
/// PV legality, MultiPV invariants, White-relative signs, the terminal short-circuit, determinism,
/// cancellation, and quiescence.
///
/// This is **not** the coach AI. `ChessAI.bestMove` plays a persona at a fixed shallow depth with
/// deliberate blunders and noise; it is parity-pinned and is not touched here. This searches for
/// the truth: iterative deepening, a principal variation, ranked lines, no randomness.
///
/// What it reuses from `ChessAI` (all `internal`, all pure, none modified): `mate`, `material`,
/// `evaluate`, `ordered`. `ChessAI.negamax` returns only an `Int`, with no hook for a best move, so
/// the recursion itself is reimplemented — a principal variation cannot be recovered from it.
///
/// Deliberately absent: transposition table, killers, history, aspiration windows, null-move, LMR.
/// They are performance, not correctness, and dropping the table also makes determinism true by
/// construction instead of by a flag.
public struct LocalEngine: AnalysisEngine {

    public let identifier = "local-negamax-v1"

    /// Window bound, wider than `ChessAI.mate`. `ChessAI` keeps its own private equivalent inline.
    static let win = 1_000_000_000
    /// `|score|` above this is a forced mate.
    static let mateThreshold = ChessAI.mate - 1000
    static let maxQDepth = 6
    /// Futility margin for delta pruning in quiescence.
    static let deltaMargin = 200
    static let cancelCheckInterval = 2048

    public init() {}

    // MARK: Tactical predicate

    /// **Not** `ChessAI.captureScore(_:_:) >= 0`. That helper detects a capture purely by "is there
    /// a piece on `m.to`", so it scores en-passant captures *and* promotions as quiet moves. A
    /// quiescence search that trusted it would walk straight past both.
    static func isTactical(_ pos: ChessPosition, _ m: Move) -> Bool {
        if pos.squares[m.to] != nil { return true }
        if m.promotion != nil { return true }
        guard let mover = pos.squares[m.from] else { return false }
        return mover.kind == .pawn && m.to == pos.enPassant
    }

    // MARK: Search

    /// Per-call state. A `final class` so the recursion can mutate counters without `inout`
    /// plumbing, and created fresh per `analyze` — module-level mutable state would not even
    /// compile under Swift 6 strict concurrency.
    final class Search {
        let limits: SearchLimits
        let shouldCancel: () -> Bool
        var nodes = 0
        var cancelled = false

        init(limits: SearchLimits, shouldCancel: @escaping () -> Bool) {
            self.limits = limits
            self.shouldCancel = shouldCancel
        }

        func outOfBudget() -> Bool {
            if cancelled { return true }
            if limits.maxNodes > 0 && nodes >= limits.maxNodes { cancelled = true; return true }
            if nodes % LocalEngine.cancelCheckInterval == 0 && shouldCancel() { cancelled = true; return true }
            return false
        }

        /// Quiescence: only tactical moves, so the search never stops in the middle of a trade.
        func quiesce(_ pos: ChessPosition, _ alpha0: Int, _ beta: Int, _ qdepth: Int) -> Int {
            nodes += 1
            if outOfBudget() { return alpha0 }
            var alpha = alpha0

            let inCheck = pos.isInCheck(pos.sideToMove)
            let moves = pos.legalMoves()
            // Terminal must be tested against ALL legal moves, never the tactical subset — "no
            // captures" is not "no moves".
            if moves.isEmpty { return inCheck ? -(ChessAI.mate - qdepth) : 0 }

            let standPat = ChessAI.evaluate(pos)
            if !inCheck {
                if standPat >= beta { return standPat }
                if standPat > alpha { alpha = standPat }
                if qdepth >= LocalEngine.maxQDepth { return standPat }
            }

            // In check every evasion must be considered; otherwise only tactical moves.
            let candidates = inCheck ? moves : moves.filter { LocalEngine.isTactical(pos, $0) }
            if candidates.isEmpty { return inCheck ? -(ChessAI.mate - qdepth) : standPat }

            var best = inCheck ? -LocalEngine.win : standPat
            for m in ChessAI.ordered(candidates, pos) {
                if !inCheck {
                    // Delta pruning: skip a capture that cannot plausibly raise alpha.
                    var gain = pos.squares[m.to].map { ChessAI.material($0.kind) } ?? 0
                    if let promo = m.promotion { gain += ChessAI.material(promo) }
                    if standPat + gain + LocalEngine.deltaMargin < alpha { continue }
                }
                let score = -quiesce(pos.makeMove(m), -beta, -alpha, qdepth + 1)
                if cancelled { return alpha }
                if score > best { best = score }
                if best > alpha { alpha = best }
                if alpha >= beta { break }
            }
            return best
        }

        /// Alpha-beta with a triangular principal-variation table; `line` receives the PV from this
        /// node down.
        ///
        /// The depth guard is `<= 0`, not `== 0`: `ChessAI.negamax` uses `== 0` and would recurse
        /// forever on a negative depth, which is only safe there because its single caller can never
        /// pass one.
        func negamax(_ pos: ChessPosition, _ depth: Int, _ alpha0: Int, _ beta: Int,
                     _ ply: Int, _ line: inout [Move]) -> Int {
            line.removeAll(keepingCapacity: true)
            nodes += 1
            if outOfBudget() { return alpha0 }
            var alpha = alpha0

            let moves = pos.legalMoves()
            if moves.isEmpty { return pos.isInCheck(pos.sideToMove) ? -(ChessAI.mate - ply) : 0 }
            if depth <= 0 { return quiesce(pos, alpha, beta, ply) }

            var best = -LocalEngine.win
            var child: [Move] = []
            for m in ChessAI.ordered(moves, pos) {
                let score = -negamax(pos.makeMove(m), depth - 1, -beta, -alpha, ply + 1, &child)
                if cancelled { return best > -LocalEngine.win ? best : alpha }
                if score > best {
                    best = score
                    line.removeAll(keepingCapacity: true)
                    line.append(m)
                    line.append(contentsOf: child)
                }
                if best > alpha { alpha = best }
                if alpha >= beta { break }
            }
            return best
        }
    }

    // MARK: Score conversion

    /// Side-to-move-relative search score → a White-relative `EngineScore`.
    static func engineScore(_ score: Int, rootSideToMove: PieceColor) -> EngineScore {
        let whiteScore = rootSideToMove == .white ? score : -score
        if abs(whiteScore) > mateThreshold {
            let plies = ChessAI.mate - abs(whiteScore)
            let moves = max(1, (plies + 1) / 2)
            return .mate(whiteScore > 0 ? moves : -moves)
        }
        return .cp(whiteScore)
    }

    static func pvSAN(_ pos: ChessPosition, _ pv: [Move]) -> [String] {
        var out: [String] = []
        var p = pos
        for m in pv {
            out.append(p.san(for: m))
            p = p.makeMove(m)
        }
        return out
    }

    // MARK: Analyse

    public func analyze(_ position: ChessPosition,
                        limits: SearchLimits,
                        historyKeys: [String] = [],
                        shouldCancel: () -> Bool = { false },
                        onProgress: (AnalysisSnapshot) -> Void = { _ in }) -> AnalysisSnapshot {

        // A finished game never enters the search. That is what makes `EngineScore.mate(n)` with
        // `n != 0` structural rather than a convention.
        let outcome = position.terminalOutcome(historyKeys: historyKeys)
        if outcome.kind != .ongoing {
            let snap = AnalysisSnapshot(fen: position.fen, depth: 0, nodes: 0, lines: [],
                                        isFinal: true, terminal: outcome)
            onProgress(snap)
            return snap
        }

        // `Search` stores the closure, so it must be escaping; withoutActuallyEscaping keeps the
        // caller's non-escaping closure usable without forcing @escaping onto the protocol.
        return withoutActuallyEscaping(shouldCancel) { cancel -> AnalysisSnapshot in
            let s = Search(limits: limits, shouldCancel: cancel)
            var rootMoves = ChessAI.ordered(position.legalMoves(), position)
            var last: AnalysisSnapshot?
            var line: [Move] = []

            var depth = 1
            while depth <= limits.maxDepth {
                var scored: [(move: Move, score: Int, pv: [Move])] = []
                var aborted = false
                for m in rootMoves {
                    // A fresh full window per root move: every root move gets an EXACT score rather
                    // than a bound, so MultiPV needs no re-search. This mirrors what
                    // `ChessAI.bestMove` already does, and costs only root-level cutoffs.
                    let sc = -s.negamax(position.makeMove(m), depth - 1,
                                        -LocalEngine.win, LocalEngine.win, 1, &line)
                    if s.cancelled { aborted = true; break }
                    scored.append((move: m, score: sc, pv: [m] + line))
                }
                if aborted { break }

                // Descending by score, ties broken by the incoming order so the result is stable
                // (Swift's sort is not stable, so the index tie-break is what pins it — the same
                // discipline ChessAI.ordered uses). Explicit closures rather than key paths: key
                // paths into tuple labels are the sort of thing best avoided in code that cannot be
                // compiled here.
                let ranked = scored.enumerated().sorted { a, b in
                    a.element.score != b.element.score
                        ? a.element.score > b.element.score
                        : a.offset < b.offset
                }.map { $0.element }

                var lines: [EngineLine] = []
                for k in 0 ..< min(limits.multiPV, ranked.count) {
                    lines.append(EngineLine(
                        rank: k + 1,
                        score: LocalEngine.engineScore(ranked[k].score, rootSideToMove: position.sideToMove),
                        pv: ranked[k].pv,
                        pvSAN: LocalEngine.pvSAN(position, ranked[k].pv),
                        depth: depth))
                }
                let snap = AnalysisSnapshot(fen: position.fen, depth: depth, nodes: s.nodes,
                                            lines: lines, isFinal: false, terminal: nil)
                last = snap
                onProgress(snap)

                // Best root move first next iteration — the cheapest ordering win available.
                rootMoves = ranked.map { $0.move }
                // A forced mate ends the story; deeper search cannot improve on it.
                if let first = lines.first {
                    if case .mate = first.score { break }
                }
                depth += 1
            }

            guard let result = last else {
                return AnalysisSnapshot(fen: position.fen, depth: 0, nodes: s.nodes, lines: [],
                                        isFinal: true, terminal: nil)
            }
            return AnalysisSnapshot(fen: result.fen, depth: result.depth, nodes: result.nodes,
                                    lines: result.lines, isFinal: true, terminal: nil)
        }
    }
}
