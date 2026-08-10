import Foundation

/// The engine seam for the Analysis Board.
///
/// This protocol is what *prevents* the UCI leak `CLAUDE.md` forbids in the Parity Core: it names no
/// engine, no process and no protocol. `LocalEngine` implements it today with an in-repo negamax;
/// a Stockfish adapter conforms to the same three types later and nothing above it changes.
///
/// **The API is synchronous, deliberately.** Core contains no other concurrency, the package builds
/// in Swift 6 language mode with complete strict concurrency (a stray `static var` is a compile
/// error, not a warning), and `ParityRunner` is synchronous top-level code — so a synchronous engine
/// is the one that can actually be asserted. Cancellation and progress are closures, following the
/// `PuzzleServing.Picker` precedent. An `actor` wrapper belongs in the UI layer.
///
/// **Limits are depth and nodes, never wall-clock time.** That is what makes a result reproducible
/// in a test; a caller that wants a deadline implements it inside `shouldCancel`.
///
/// Mirrored by `web-demo/js/analysis-engine.js`, which is proven by its own 44-assertion suite.

// MARK: - Score

/// An engine evaluation. **Always White-relative** — `ChessAI.evaluate` and negamax are
/// side-to-move relative, and the single conversion happens at the search root. The eval bar, the
/// eval graph and `GameReview` are all White-relative, so this is the boundary where that ambiguity
/// is resolved once and for all.
public enum EngineScore: Equatable, Sendable {
    /// Centipawns, White-relative.
    case cp(Int)
    /// Moves to mate, White-relative and signed. **Never zero**: a position that is already over
    /// short-circuits to `.terminal` before the search runs, which makes that invariant structural
    /// rather than a convention.
    case mate(Int)
    /// The game is already over in this position.
    case terminal(TerminalOutcome)
}

/// One ranked line of analysis.
public struct EngineLine: Equatable, Sendable {
    public let rank: Int
    public let score: EngineScore
    public let pv: [Move]
    public let pvSAN: [String]
    public let depth: Int

    public init(rank: Int, score: EngineScore, pv: [Move], pvSAN: [String], depth: Int) {
        self.rank = rank; self.score = score; self.pv = pv; self.pvSAN = pvSAN; self.depth = depth
    }
}

/// One completed iterative-deepening iteration.
public struct AnalysisSnapshot: Equatable, Sendable {
    public let fen: String
    public let depth: Int
    public let nodes: Int
    public let lines: [EngineLine]
    public let isFinal: Bool
    public let terminal: TerminalOutcome?

    public init(fen: String, depth: Int, nodes: Int, lines: [EngineLine],
                isFinal: Bool, terminal: TerminalOutcome?) {
        self.fen = fen; self.depth = depth; self.nodes = nodes
        self.lines = lines; self.isFinal = isFinal; self.terminal = terminal
    }

    /// The best line's score, or the terminal verdict.
    public var score: EngineScore? {
        if let t = terminal { return .terminal(t) }
        return lines.first?.score
    }
}

public struct SearchLimits: Equatable, Sendable {
    public var maxDepth: Int
    /// `0` means unlimited.
    public var maxNodes: Int
    public var multiPV: Int

    public init(maxDepth: Int = 4, maxNodes: Int = 0, multiPV: Int = 1) {
        self.maxDepth = max(1, maxDepth)
        self.maxNodes = max(0, maxNodes)
        self.multiPV = max(1, multiPV)
    }
}

public protocol AnalysisEngine: Sendable {
    /// Identifies the engine that produced a result, so a cached review can be invalidated when the
    /// engine changes (negamax today, Stockfish later).
    var identifier: String { get }

    func analyze(_ position: ChessPosition,
                 limits: SearchLimits,
                 historyKeys: [String],
                 shouldCancel: () -> Bool,
                 onProgress: (AnalysisSnapshot) -> Void) -> AnalysisSnapshot
}

public extension AnalysisEngine {
    /// Analyse to completion with no cancellation and no progress reporting.
    ///
    /// Deliberately *not* an overload named `analyze` — a concrete type supplying default arguments
    /// for the full signature would then have two equally good candidates at the call site.
    func analyzeToCompletion(_ position: ChessPosition, limits: SearchLimits) -> AnalysisSnapshot {
        analyze(position, limits: limits, historyKeys: [], shouldCancel: { false }, onProgress: { _ in })
    }
}

// MARK: - Display and the game-review bridge

public extension EngineScore {

    /// The engine-line column's text: `"+1.3"`, `"-0.7"`, `"M4"`, `"M-3"`, or a result token.
    var displayText: String {
        switch self {
        case .cp(let c):
            let v = Double(c) / 100
            return String(format: "%+.1f", v)
        case .mate(let m):
            return "M\(m)"
        case .terminal(let t):
            if t.kind == .checkmate { return t.winner == .white ? "1-0" : "0-1" }
            return "\u{00BD}-\u{00BD}"
        }
    }

    /// Convert to the shape `GameReview` consumes.
    ///
    /// A terminal checkmate is reported as `evalCp: ±10000` with `evalMate: nil` — **never**
    /// `evalMate: 0`. That is the latent server bug: the Python service emits `eval_mate: 0` for a
    /// mated position and PHP's `normalizeEval` prefers `eval_mate`, so it returns `-10000`
    /// regardless of who delivered mate. Routing through `evalCp` produces the value the PHP
    /// *intended*. Standing rule: do not reproduce latent server bugs.
    func asReviewEvaluation(bestMoveSan: String? = nil) -> GameReview.Evaluation {
        switch self {
        case .cp(let c):
            return GameReview.Evaluation(evalCp: c, evalMate: nil, bestMoveSan: bestMoveSan)
        case .mate(let m):
            return GameReview.Evaluation(evalCp: nil, evalMate: m, bestMoveSan: bestMoveSan)
        case .terminal(let t):
            if t.kind == .checkmate {
                return GameReview.Evaluation(evalCp: t.winner == .white ? 10000 : -10000,
                                             evalMate: nil, bestMoveSan: bestMoveSan)
            }
            return GameReview.Evaluation(evalCp: 0, evalMate: nil, bestMoveSan: bestMoveSan)
        }
    }
}
