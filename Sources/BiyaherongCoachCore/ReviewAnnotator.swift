import Foundation

/// Drives a full-game review and layers the `book` tier on top of it (Analysis Board).
///
/// `GameReview.swift` is **not modified by any of this**. It is a faithful, golden-pinned port of
/// `GameReviewController` and keeps exactly its nine classification keys. The `book` tier — which
/// the server could never produce, having no opening database — is applied here, afterwards, by
/// relabelling in-book plies and recomputing the two count dictionaries with a tenth key.
///
/// **Accuracy is never recomputed.** Book moves still count toward it, which follows from the
/// locked parity decision (chess.com excludes them; the server did not, so neither do we).
///
/// Mirrored by `web-demo/js/review.js`, whose review math is validated against the same 303 golden
/// cases the `game_review` / `game_review_random` parity groups consume.
public enum ReviewAnnotator {

    /// Summary-table order: the nine tiers with `book` inserted after `great`.
    ///
    /// The React Native original's `CLASSIFICATION_ORDER` had only nine entries — `book` was missing
    /// — so book moves were counted and then never displayed. This is the corrected order.
    public static let displayOrder = [
        "brilliant", "great", "book", "best", "excellent", "good",
        "inaccuracy", "mistake", "miss", "blunder",
    ]

    // MARK: - Building the review input

    /// The parallel arrays `GameReview.review` consumes, plus the nodes they came from so a caller
    /// can stamp results back onto the tree.
    public struct Plan {
        /// Index 0 is the starting position.
        public let positions: [ChessPosition]
        /// Index 0 is a placeholder, matching the server's contract.
        public let moves: [GameReview.Move]
        /// The main-line nodes, aligned with `positions[1...]`.
        public let nodes: [MoveNode]
        /// `positions[i].positionKey`, for the opening book and repetition.
        public let keys: [String]
    }

    /// Walk a tree's main line into the review's input shape.
    ///
    /// SAN comes from `MoveNode.san`, which `MoveTree` always produces via `ChessPosition.san(for:)`.
    /// That matters: `GameReview` matches `bestMoveSan` by **string equality**, so feeding it an
    /// imported PGN's spelling (`Nbd2` where we generate `N1d2`) would silently mis-classify.
    public static func plan(_ tree: MoveTree) -> Plan {
        var positions: [ChessPosition] = []
        var keys: [String] = []
        var moves: [GameReview.Move] = [GameReview.Move(san: nil, color: nil)]
        let nodes = tree.mainline()

        guard let start = ChessPosition(fen: tree.initialFEN) else {
            return Plan(positions: [], moves: [], nodes: [], keys: [])
        }
        positions.append(start)
        keys.append(start.positionKey)

        for node in nodes {
            guard let pos = ChessPosition(fen: node.fenAfter) else { break }
            positions.append(pos)
            keys.append(node.key)
            moves.append(GameReview.Move(san: node.san, color: node.color == .white ? "w" : "b"))
        }
        return Plan(positions: positions, moves: moves, nodes: nodes, keys: keys)
    }

    /// Progress while evaluating a game: `(done, total)`.
    public typealias Progress = (Int, Int) -> Void

    /// Evaluate every position in a plan with `engine`.
    ///
    /// Returns as many evaluations as were completed; a cancelled run returns a **short** array, and
    /// the caller should treat that as "review cancelled" rather than reviewing a truncated game.
    public static func evaluate<Engine: AnalysisEngine>(_ plan: Plan,
                                                        engine: Engine,
                                                        limits: SearchLimits,
                                                        shouldCancel: () -> Bool = { false },
                                                        onProgress: Progress = { _, _ in }) -> [GameReview.Evaluation] {
        var out: [GameReview.Evaluation] = []
        out.reserveCapacity(plan.positions.count)
        for (i, pos) in plan.positions.enumerated() {
            if shouldCancel() { break }
            let snap = engine.analyze(pos, limits: limits, historyKeys: [],
                                      shouldCancel: shouldCancel, onProgress: { _ in })
            let best = snap.lines.first?.pvSAN.first
            let score = snap.score ?? EngineScore.cp(0)
            out.append(score.asReviewEvaluation(bestMoveSan: best))
            onProgress(i + 1, plan.positions.count)
        }
        return out
    }

    // MARK: - Stepping a review

    /// Evaluate a plan **one position per call**.
    ///
    /// `evaluate(_:engine:limits:...)` above runs the whole game in one blocking loop, which is right
    /// for a headless harness and wrong for a UI: measured, a 40-move game costs 28s at a fixed
    /// depth 3. Two things fix that, and both need the caller in charge of the loop —
    ///
    ///  * each position gets its own wall-clock budget, passed in through `shouldCancel`, so a sharp
    ///    position stops at depth 2 instead of grinding to depth 3;
    ///  * the caller can yield between steps, so the screen keeps painting and Cancel lands at once.
    ///
    /// `evaluate` is deliberately left alone — `review_book` and the demo still use it.
    ///
    /// A cancelled walk leaves `evaluations` **short**; `isComplete` is the guard that stops a
    /// caller from mistaking that for a truncated game.
    /// It holds `positions` rather than the whole `Plan` deliberately: a `Plan` carries `[MoveNode]`,
    /// a reference graph that is **not `Sendable`**, which would pin the whole walk to one isolation
    /// domain. Positions and evaluations are both value types, so the walk can run off the main
    /// actor while the caller keeps the plan (and its nodes) for `annotate`.
    public struct Evaluator: Sendable {
        public let positions: [ChessPosition]
        public let limits: SearchLimits
        public private(set) var evaluations: [GameReview.Evaluation] = []
        public private(set) var cancelled = false

        public init(positions: [ChessPosition], limits: SearchLimits) {
            self.positions = positions
            self.limits = limits
        }

        /// Convenience for a caller that already has the plan. Reads `positions` and nothing else,
        /// so nothing non-`Sendable` is captured.
        public init(plan: Plan, limits: SearchLimits) {
            self.init(positions: plan.positions, limits: limits)
        }

        public var total: Int { positions.count }
        public var completed: Int { evaluations.count }
        public var isFinished: Bool { cancelled || completed >= total }
        public var isComplete: Bool { !cancelled && completed == total }

        /// Evaluate the next position. Returns false once the walk is over.
        ///
        /// `shouldCancel` is polled here **and** handed to the engine, so it can carry both the
        /// user's cancel and this position's deadline.
        @discardableResult
        public mutating func step<Engine: AnalysisEngine>(engine: Engine,
                                                          shouldCancel: () -> Bool) -> Bool {
            if isFinished { return false }
            if shouldCancel() { cancelled = true; return false }
            let snap = engine.analyze(positions[completed], limits: limits, historyKeys: [],
                                      shouldCancel: shouldCancel, onProgress: { _ in })
            let best = snap.lines.first?.pvSAN.first
            let score = snap.score ?? EngineScore.cp(0)
            evaluations.append(score.asReviewEvaluation(bestMoveSan: best))
            return true
        }
    }

    // MARK: - The book tier

    /// A review with the `book` tier applied. `base` is the untouched `GameReview.Result`; read
    /// accuracy and the eval graph from it.
    public struct Annotated {
        public let base: GameReview.Result
        /// `base.moveEvaluations` with in-book plies relabelled `"book"`.
        public let moveEvaluations: [GameReview.MoveEvaluation]
        /// Ten keys — the nine plus `book`.
        public let whiteClassifications: [String: Int]
        public let blackClassifications: [String: Int]

        public var whiteAccuracy: Double { base.whiteAccuracy }
        public var blackAccuracy: Double { base.blackAccuracy }
        public var evalGraph: [GameReview.EvalGraphPoint] { base.evalGraph }
    }

    /// Relabel the plies listed in `bookPlies` and recount, without touching `base`.
    ///
    /// With an empty `bookPlies` the displayed counts equal the base counts plus `book: 0` and the
    /// move evaluations are unchanged — the invariant the `review_book` parity group asserts.
    public static func annotate(_ base: GameReview.Result,
                                moves: [GameReview.Move],
                                bookPlies: Set<Int>) -> Annotated {
        var white = emptyDisplayCounts()
        var black = emptyDisplayCounts()
        var relabelled: [GameReview.MoveEvaluation] = []
        relabelled.reserveCapacity(base.moveEvaluations.count)

        for me in base.moveEvaluations {
            let cls = bookPlies.contains(me.moveIndex) ? "book" : me.classification
            relabelled.append(GameReview.MoveEvaluation(moveIndex: me.moveIndex,
                                                        classification: cls,
                                                        cpLoss: me.cpLoss,
                                                        bestMoveSan: me.bestMoveSan))
            let color = me.moveIndex < moves.count ? moves[me.moveIndex].color : nil
            if color == "w" { white[cls, default: 0] += 1 }
            else if color == "b" { black[cls, default: 0] += 1 }
        }

        return Annotated(base: base, moveEvaluations: relabelled,
                         whiteClassifications: white, blackClassifications: black)
    }

    /// The ten display keys, all zero.
    public static func emptyDisplayCounts() -> [String: Int] {
        var o: [String: Int] = [:]
        for k in displayOrder { o[k] = 0 }
        return o
    }
}
