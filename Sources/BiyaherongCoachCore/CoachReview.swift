import Foundation

/// The offline game review (spec §2.10) — the adapter, and the modal's derived values.
///
/// Twin of `web-demo/js/coach-review.js`; `tools/qa/replay_coach.js` checks this source against it.
///
/// The classification maths is NOT rewritten here. `GameReview` is already the parity port of
/// `GameReviewController`, pinned to it by 303 golden cases, and `ReviewAnnotator` adds the `book`
/// tier on top. What this file does is turn a coach game into the shape those two already consume,
/// and answer the questions the modal asks of the result.
///
/// ## The two fixes that live here
///
///  - **§7 #28.** The RN hand-off shipped an empty `moveEvaluations` array *every time*:
///    `handleGameReview` read `reviewData` but its dependency list named only `moveRecords`, so the
///    memoised callback closed over `nil` forever. `handoff` takes the summary as an ARGUMENT, so
///    there is no captured variable that can go stale — and it returns nil rather than an empty
///    hand-off if one is missing.
///  - **§2.10's orientation fix.** The RN modal ordered the accuracy columns White-left/Black-right
///    and the classification rows user-left/opponent-right, so playing Black put the coach's
///    accuracy directly above your own move counts. `columns` is the single source of that
///    ordering and both halves read it.
public enum CoachReview {

    /// Spec §2.10: depth 12 for the batch.
    public static let reviewDepth = 12
    /// Below this many positions there is nothing to review — one position is just the start.
    public static let minPositions = 2

    // MARK: - The adapter

    /// A coach game in the shape `GameReview` consumes.
    ///
    /// Every record already carries the FEN *after* its move, so nothing has to be replayed —
    /// which is also why a draft restored from storage can be reviewed without trusting its SAN.
    /// `nodes` is empty: only the Analysis Board's stamp-back reads it, and it builds its own tree
    /// from the PGN in the hand-off.
    public static func plan(from game: CoachGame.Game) -> ReviewAnnotator.Plan {
        var positions: [ChessPosition] = []
        var keys: [String] = []
        var moves: [GameReview.Move] = [GameReview.Move(san: nil, color: nil)]

        for (i, rec) in game.moveRecords.enumerated() {
            guard let pos = ChessPosition(fen: rec.fen) else { break }  // corrupt record: truncate
            positions.append(pos)
            keys.append(pos.positionKey)
            if i > 0 { moves.append(GameReview.Move(san: rec.san, color: rec.color?.rawValue)) }
        }
        // `moves` can only outrun `positions` if a FEN failed to parse mid-list; trim so the two
        // stay aligned, because `review` walks them by index.
        if moves.count > positions.count { moves = Array(moves.prefix(positions.count)) }
        return ReviewAnnotator.Plan(positions: positions, moves: moves, nodes: [], keys: keys)
    }

    public static func isReviewable(_ game: CoachGame.Game) -> Bool {
        plan(from: game).positions.count >= minPositions
    }

    // MARK: - The modal's derived values

    /// Spec §2.10's four accuracy bands, as hex so both languages hold one set of numbers.
    public static func accuracyColorHex(_ pct: Double) -> String {
        if pct >= 80 { return "#4CAF50" }
        if pct >= 60 { return "#FFC107" }
        if pct >= 40 { return "#FF9800" }
        return "#F44336"
    }

    /// What one half of the players row shows.
    public struct Column: Equatable, Sendable {
        public let side: CoachGame.Side
        public let label: String
        public let accuracy: Double
        public let classifications: [String: Int]
    }

    /// The summary the modal is drawn from — whatever produced it.
    ///
    /// Not `Sendable`: it holds `GameReview.MoveEvaluation` and `GameReview.EvalGraphPoint`,
    /// which are public and unmarked. Everything that touches a summary is `@MainActor`
    /// anyway — the search hands back evaluations, not summaries.
    public struct Summary: Equatable {
        public var whiteAccuracy: Double
        public var blackAccuracy: Double
        public var whiteClassifications: [String: Int]
        public var blackClassifications: [String: Int]
        public var moveEvaluations: [GameReview.MoveEvaluation]
        public var evalGraph: [GameReview.EvalGraphPoint]
        public var displayOrder: [String]
        public var total: Int

        public init(whiteAccuracy: Double, blackAccuracy: Double,
                    whiteClassifications: [String: Int], blackClassifications: [String: Int],
                    moveEvaluations: [GameReview.MoveEvaluation],
                    evalGraph: [GameReview.EvalGraphPoint],
                    displayOrder: [String], total: Int) {
            self.whiteAccuracy = whiteAccuracy
            self.blackAccuracy = blackAccuracy
            self.whiteClassifications = whiteClassifications
            self.blackClassifications = blackClassifications
            self.moveEvaluations = moveEvaluations
            self.evalGraph = evalGraph
            self.displayOrder = displayOrder
            self.total = total
        }
    }

    /// The two columns, in ONE order that both halves of the modal use. **This is the §2.10 fix.**
    public static func columns(_ s: Summary, userColor: CoachGame.Side) -> [Column] {
        let mine = Column(side: userColor,
                          label: "You",
                          accuracy: userColor == .white ? s.whiteAccuracy : s.blackAccuracy,
                          classifications: userColor == .white ? s.whiteClassifications
                                                               : s.blackClassifications)
        let theirs = Column(side: userColor == .white ? .black : .white,
                            label: "Coach",
                            accuracy: userColor == .white ? s.blackAccuracy : s.whiteAccuracy,
                            classifications: userColor == .white ? s.blackClassifications
                                                                 : s.whiteClassifications)
        return [mine, theirs]
    }

    public struct Row: Equatable, Sendable, Identifiable {
        public let key: String
        public let left: Int
        public let right: Int
        public var id: String { key }
    }

    /// Display order, skipping any key that is zero on BOTH sides.
    ///
    /// `left`/`right` follow `columns`, so a row cannot end up oriented differently from the
    /// accuracy above it.
    public static func classificationRows(_ s: Summary, userColor: CoachGame.Side) -> [Row] {
        let cols = columns(s, userColor: userColor)
        let order = s.displayOrder.isEmpty ? ReviewAnnotator.displayOrder : s.displayOrder
        var out: [Row] = []
        for key in order {
            let left = cols[0].classifications[key] ?? 0
            let right = cols[1].classifications[key] ?? 0
            if left == 0 && right == 0 { continue }
            out.append(Row(key: key, left: left, right: right))
        }
        return out
    }

    public struct GraphPoint: Equatable, Sendable {
        public let x: Double
        public let y: Double
        public let cp: Double
    }

    /// The eval curve, clamped and mapped into a `width` × `height` box.
    ///
    /// `y` grows downwards, so a white advantage is a smaller `y` — the orientation §2.10's "white
    /// fill above the midline" describes. `clampCp` is the component's own `CLAMP`, passed in
    /// rather than restated so the graph and the maths behind it cannot disagree about what "off
    /// the scale" means.
    public static func graphPoints(_ graph: [GameReview.EvalGraphPoint],
                                   width: Double, height: Double,
                                   clampCp: Double) -> [GraphPoint] {
        guard graph.count >= 2 else { return [] }
        var out: [GraphPoint] = []
        for (i, pt) in graph.enumerated() {
            var cp = Double(pt.evalCp)
            cp = Swift.min(clampCp, Swift.max(-clampCp, cp))
            out.append(GraphPoint(x: (Double(i) / Double(graph.count - 1)) * width,
                                  y: height / 2 - (cp / clampCp) * (height / 2),
                                  cp: cp))
        }
        return out
    }

    /// `91.2%`, to one decimal, as §2.10 writes it.
    public static func formatAccuracy(_ pct: Double) -> String {
        String(format: "%.1f%%", (pct * 10).rounded(.toNearestOrAwayFromZero) / 10)
    }

    // MARK: - The hand-off (§7 #28)

    /// The game as movetext.
    ///
    /// No `[FEN]` tag: the hand-off carries the starting position separately, and a tag on a game
    /// that began from the initial position is noise the Analysis Board would have to strip.
    public static func pgn(_ game: CoachGame.Game) -> String {
        var parts: [String] = []
        for i in 1..<Swift.max(game.moveRecords.count, 1) {
            if i % 2 == 1 { parts.append("\((i - 1) / 2 + 1).") }
            parts.append(game.moveRecords[i].san ?? "")
        }
        return parts.joined(separator: " ")
    }

    public struct Handoff: Equatable {
        public let pgn: String
        public let startFen: String
        public let classifications: [GameReview.MoveEvaluation]
        public let userColor: CoachGame.Side
    }

    /// What the Analysis Board is handed. Nil rather than an empty hand-off when there is no
    /// summary — which is the shape §7 #28 made impossible to express.
    public static func handoff(_ game: CoachGame.Game, summary: Summary?) -> Handoff? {
        guard let s = summary, !s.moveEvaluations.isEmpty else { return nil }
        return Handoff(pgn: pgn(game),
                       startFen: game.moveRecords.first?.fen ?? ChessPosition.startFEN,
                       classifications: s.moveEvaluations,
                       userColor: game.userColor)
    }
}
