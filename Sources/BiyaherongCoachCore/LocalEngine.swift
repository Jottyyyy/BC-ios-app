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
/// `ordered`, `captureScore`. `ChessAI.negamax` returns only an `Int`, with no hook for a best move,
/// so the recursion itself is reimplemented — a principal variation cannot be recovered from it.
/// The **evaluation is `AnalysisEval`**, not `ChessAI.evaluate`: the coach's evaluation is pinned to
/// the five personas and stays untouched, while this one knows about game phase, pawn structure,
/// king safety and mobility. See `AnalysisEval.swift` for why they are separate.
///
/// ## What makes it strong, and what keeps it honest
///
/// A transposition table, killers and history, principal-variation search, check extensions,
/// null-move pruning and late move reductions. Two rules bound all of it:
///
/// - **A PV node never takes a table cutoff and is never null-moved.** A table hit returns a score
///   with no moves attached, which would truncate the principal variation the panel displays; and
///   null-move pruning is a guess, fine for proving a branch is bad and not fine for the line about
///   to be shown to the user.
/// - **A reduced search that beats alpha is always re-searched at full depth.** A reduction may only
///   skip work; it may never decide anything.
///
/// Determinism survives all of it: the table is per-search, cleared by size and never by clock, so
/// the same request twice returns identical lines *and* an identical node count.
public struct LocalEngine: AnalysisEngine {

    public let identifier = "local-negamax-v2"

    /// Window bound, wider than `ChessAI.mate`. `ChessAI` keeps its own private equivalent inline.
    static let win = 1_000_000_000
    /// `|score|` above this is a forced mate.
    static let mateThreshold = ChessAI.mate - 1000
    static let maxQDepth = 6
    /// Futility margin for delta pruning in quiescence.
    static let deltaMargin = 200
    static let cancelCheckInterval = 2048

    /// Bounds the recursion. Check extensions add a ply without spending one, so without this a
    /// perpetual-check line would recurse until the stack gave out.
    static let maxPly = 64

    /// Transposition table entry kinds: a true score, a fail-high bound, a fail-low bound.
    enum TTFlag: Int, Sendable { case exact, lower, upper }

    struct TTEntry {
        var depth: Int
        var score: Int
        var flag: TTFlag
        var move: Move?
    }

    /// Entry cap. Reached, the table is cleared wholesale — bounded memory, still deterministic.
    static let ttMax = 1 << 20

    /// Null-move pruning: give the opponent a free move; if the position still fails high, it was
    /// never worth searching properly. Forbidden in check, in a PV node, and — the zugzwang guard —
    /// when the side to move has nothing but pawns, where passing is not a concession.
    static let nullMinDepth = 3, nullR = 2, nullRDeep = 3, nullDeepDepth = 6

    /// Late move reductions: moves ordered this late are rarely best, so search them shallower first
    /// and only pay full price if one surprises us. Captures, promotions and checks are never
    /// reduced — those are exactly the moves that surprise.
    static let lmrMinDepth = 3, lmrMinMove = 3, lmrWideMove = 6, lmrWideDepth = 5

    /// History scores are halved rather than allowed to saturate in a long search.
    static let historyMax = 1 << 24

    // MARK: Move-ordering keys
    //
    // Ordering is the single largest lever on alpha-beta: a perfectly ordered search visits the
    // square root of the nodes a badly ordered one does.
    static let keyTTMove = 4_000_000
    static let keyPromotion = 3_000_000
    static let keyCapture = 2_000_000
    static let keyKiller0 = 1_900_000
    static let keyKiller1 = 1_890_000

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

        /// The accelerators. All three live for the whole search — across depths, which is the point
        /// of iterative deepening — and die with it, so nothing leaks between two calls.
        var tt: [UInt64: TTEntry] = [:]
        var killers: [[Move?]] = []                 // ply -> [most recent, previous] quiet cutoff
        var history = [Int](repeating: 0, count: 64 * 64)   // from*64+to -> cutoffs caused

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

        /// The table's move first, then captures by MVV-LVA, then the killers, then history.
        ///
        /// The index tie-break is not decoration: **Swift's `sort` is not stable**, so equal keys
        /// must be separated by something or MultiPV order would vary between runs. Same guard
        /// `ChessAI.ordered` carries.
        func order(_ moves: [Move], _ pos: ChessPosition, _ ply: Int, _ ttMove: Move?) -> [Move] {
            let k: [Move?] = ply < killers.count ? killers[ply] : [nil, nil]
            func key(_ m: Move) -> Int {
                if let t = ttMove, m == t { return LocalEngine.keyTTMove }
                if let promo = m.promotion { return LocalEngine.keyPromotion + ChessAI.material(promo) }
                let cap = ChessAI.captureScore(m, pos)      // -1 when the move is not a capture
                if cap >= 0 { return LocalEngine.keyCapture + cap }
                if let k0 = k[0], m == k0 { return LocalEngine.keyKiller0 }
                if let k1 = k[1], m == k1 { return LocalEngine.keyKiller1 }
                return history[m.from * 64 + m.to]
            }
            return moves.enumerated().sorted { a, b in
                let ka = key(a.element), kb = key(b.element)
                return ka != kb ? ka > kb : a.offset < b.offset
            }.map(\.element)
        }

        /// A quiet move that caused a cutoff is worth trying first next time, here and elsewhere.
        func remember(_ m: Move, _ ply: Int, _ depth: Int) {
            while killers.count <= ply { killers.append([nil, nil]) }
            if killers[ply][0] != m {
                killers[ply][1] = killers[ply][0]
                killers[ply][0] = m
            }
            let idx = m.from * 64 + m.to
            history[idx] += depth * depth
            if history[idx] > LocalEngine.historyMax {
                for i in 0..<history.count { history[i] >>= 1 }
            }
        }

        func store(_ key: UInt64, _ depth: Int, _ score: Int, _ flag: TTFlag,
                   _ move: Move?, _ ply: Int) {
            if cancelled { return }          // a cut-short score is not a fact about the position
            if let e = tt[key], e.depth > depth { return }       // never overwrite a deeper result
            if tt[key] == nil && tt.count >= LocalEngine.ttMax { tt.removeAll(keepingCapacity: true) }
            tt[key] = TTEntry(depth: depth, score: LocalEngine.toTT(score, ply), flag: flag, move: move)
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

            let standPat = AnalysisEval.evaluate(pos)
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
        func negamax(_ pos: ChessPosition, _ depth0: Int, _ alpha0: Int, _ beta0: Int,
                     _ ply: Int, _ line: inout [Move]) -> Int {
            line.removeAll(keepingCapacity: true)
            nodes += 1
            if outOfBudget() { return alpha0 }
            var alpha = alpha0
            var beta = beta0
            var depth = depth0

            let isPV = (beta - alpha) > 1
            let inCheck = pos.isInCheck(pos.sideToMove)
            // Check extension: a forcing line is cheap to search and expensive to miss. Bounded by
            // `maxPly`, because an extension spends no depth and a perpetual check would otherwise
            // never terminate.
            if inCheck, ply < LocalEngine.maxPly { depth += 1 }

            let moves = pos.legalMoves()
            if moves.isEmpty { return inCheck ? -(ChessAI.mate - ply) : 0 }
            if depth <= 0 { return quiesce(pos, alpha, beta, ply) }

            // ---- Table probe ------------------------------------------------
            let key = AnalysisEval.hash(pos)
            let alphaOrig = alpha
            var ttMove: Move?
            if let e = tt[key] {
                ttMove = e.move                          // useful for ordering at ANY depth
                if e.depth >= depth, !isPV {
                    let ts = LocalEngine.fromTT(e.score, ply)
                    switch e.flag {
                    case .exact: return ts
                    case .lower: if ts > alpha { alpha = ts }
                    case .upper: if ts < beta { beta = ts }
                    }
                    if alpha >= beta { return ts }
                }
            }

            // ---- Null move --------------------------------------------------
            if !isPV, !inCheck, depth >= LocalEngine.nullMinDepth,
               AnalysisEval.hasNonPawnMaterial(pos, pos.sideToMove) {
                let r = depth >= LocalEngine.nullDeepDepth ? LocalEngine.nullRDeep : LocalEngine.nullR
                var nullLine: [Move] = []
                let nullScore = -negamax(LocalEngine.makeNullMove(pos), depth - 1 - r,
                                         -beta, -beta + 1, ply + 1, &nullLine)
                if cancelled { return alpha }
                if nullScore >= beta {
                    // Never report a mate we have not actually found: a null-move cutoff proves "at
                    // least beta", and letting an unproven mate escape would corrupt table and panel.
                    return nullScore > LocalEngine.mateThreshold ? beta : nullScore
                }
            }

            // ---- Moves ------------------------------------------------------
            var best = -LocalEngine.win
            var bestMove: Move?
            var child: [Move] = []
            let ord = order(moves, pos, ply, ttMove)
            for (i, m) in ord.enumerated() {
                let quiet = pos.squares[m.to] == nil && m.promotion == nil && !inCheck
                let next = pos.makeMove(m)
                var score: Int
                if i == 0 {
                    // The first move gets the real window — it is the one most likely to be best.
                    score = -negamax(next, depth - 1, -beta, -alpha, ply + 1, &child)
                } else {
                    var red = 0
                    if quiet, depth >= LocalEngine.lmrMinDepth, i >= LocalEngine.lmrMinMove {
                        red = 1 + ((i >= LocalEngine.lmrWideMove && depth >= LocalEngine.lmrWideDepth) ? 1 : 0)
                        if red > depth - 1 { red = depth - 1 }
                    }
                    // Null window first: all we need is whether this move can beat alpha at all.
                    score = -negamax(next, depth - 1 - red, -alpha - 1, -alpha, ply + 1, &child)
                    if !cancelled, score > alpha, red > 0 || isPV {
                        score = -negamax(next, depth - 1, -beta, -alpha, ply + 1, &child)
                    }
                }
                if cancelled { return best > -LocalEngine.win ? best : alpha }
                if score > best {
                    best = score
                    bestMove = m
                    line.removeAll(keepingCapacity: true)
                    line.append(m)
                    line.append(contentsOf: child)
                }
                if best > alpha { alpha = best }
                if alpha >= beta {
                    if quiet { remember(m, ply, depth) }
                    break
                }
            }

            let flag: TTFlag = best <= alphaOrig ? .upper : (best >= beta ? .lower : .exact)
            store(key, depth, best, flag, bestMove, ply)
            return best
        }
    }

    // MARK: Mate scores in the table

    /// Mate scores are stored NODE-relative and used ROOT-relative.
    ///
    /// A mate score carries the distance to the mate, and the search expresses that as a distance
    /// from the ROOT (`-(mate - ply)`). Two different paths reach the same position at different
    /// plies, so a root-relative score in a shared table is wrong for whoever probes it next.
    /// Storing `score + ply` makes it a distance from the node; probing subtracts the ply back out.
    static func toTT(_ score: Int, _ ply: Int) -> Int {
        if score > mateThreshold { return score + ply }
        if score < -mateThreshold { return score - ply }
        return score
    }

    static func fromTT(_ score: Int, _ ply: Int) -> Int {
        if score > mateThreshold { return score - ply }
        if score < -mateThreshold { return score + ply }
        return score
    }

    /// The opponent gets a free move. Only ever reached where zugzwang has been ruled out.
    static func makeNullMove(_ pos: ChessPosition) -> ChessPosition {
        var p = pos
        p.sideToMove = pos.sideToMove == .white ? .black : .white
        p.enPassant = nil          // the right to capture en passant does not survive a pass
        return p
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
            // ONE search for the whole deepening — its table, killers, history and root ordering all
            // survive between iterations. That is what iterative deepening is *for*: each iteration
            // exists to order the next one. (Building a fresh search per depth, which is what the
            // stepper used to force, makes the deepening a pure tax instead of a discount.)
            let s = Search(limits: limits, shouldCancel: cancel)
            var rootMoves = ChessAI.ordered(position.legalMoves(), position)
            var last: AnalysisSnapshot?
            var line: [Move] = []

            var depth = 1
            while depth <= limits.maxDepth {
                var scored: [(move: Move, score: Int, exact: Bool, pv: [Move])] = []
                var top: [Int] = []                 // the best `multiPV` EXACT scores, descending
                var aborted = false
                for m in rootMoves {
                    let next = position.makeMove(m)
                    var sc: Int
                    var exact = true
                    if top.count < limits.multiPV {
                        sc = -s.negamax(next, depth - 1, -LocalEngine.win, LocalEngine.win, 1, &line)
                    } else {
                        // This move can only matter if it reaches the k-th best score, and a null
                        // window answers exactly that for a fraction of the cost. Anything that does
                        // reach it is re-searched with a full window, so every DISPLAYED line still
                        // carries an exact score — while the moves that cannot be displayed stop
                        // costing a full-width search each.
                        let kth = top[limits.multiPV - 1]
                        sc = -s.negamax(next, depth - 1, -kth, -kth + 1, 1, &line)
                        if s.cancelled { aborted = true; break }
                        if sc >= kth {
                            sc = -s.negamax(next, depth - 1, -LocalEngine.win, LocalEngine.win, 1, &line)
                        } else {
                            exact = false           // an upper bound, strictly below the k-th best
                        }
                    }
                    if s.cancelled { aborted = true; break }
                    scored.append((move: m, score: sc, exact: exact, pv: [m] + line))
                    if exact {
                        top.append(sc)
                        top.sort { $0 > $1 }
                        if top.count > limits.multiPV { top.removeLast(top.count - limits.multiPV) }
                    }
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
