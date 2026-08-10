import Foundation

/// Game-review move classification + accuracy (Appendix E §4 — `GameReviewController`,
/// verified against source). This is the pure post-processing over engine evaluations;
/// the engine itself (batch-analyze at depth 12) is injected/replaced separately.
public enum GameReview {

    /// One engine evaluation of a position, from White's perspective.
    /// `Sendable` so a background review can carry its results back. A three-field value type of
    /// `Int?`/`String?` — the conformance is behaviour-free and no golden is affected. (Public
    /// structs do not get it implicitly, which is why it is spelled out.)
    public struct Evaluation: Codable, Equatable, Sendable {
        public let evalCp: Int?
        public let evalMate: Int?
        public let bestMoveSan: String?
        public init(evalCp: Int?, evalMate: Int?, bestMoveSan: String?) {
            self.evalCp = evalCp; self.evalMate = evalMate; self.bestMoveSan = bestMoveSan
        }
    }

    /// One played move.
    public struct Move: Codable, Equatable {
        public let san: String?
        public let color: String? // "w" | "b"
        public init(san: String?, color: String?) { self.san = san; self.color = color }
    }

    public struct MoveEvaluation: Codable, Equatable {
        public let moveIndex: Int
        public let classification: String
        public let cpLoss: Int
        public let bestMoveSan: String?
    }

    public struct EvalGraphPoint: Codable, Equatable {
        public let moveIndex: Int
        public let evalCp: Int
        public let evalMate: Int?
    }

    public struct Result: Codable, Equatable {
        public let whiteAccuracy: Double
        public let blackAccuracy: Double
        public let whiteClassifications: [String: Int]
        public let blackClassifications: [String: Int]
        public let moveEvaluations: [MoveEvaluation]
        public let evalGraph: [EvalGraphPoint]
    }

    /// The 9 classification keys, initialised to 0.
    static let emptyClassifications: [String: Int] = [
        "brilliant": 0, "great": 0, "best": 0, "excellent": 0,
        "good": 0, "inaccuracy": 0, "mistake": 0, "miss": 0, "blunder": 0,
    ]

    /// Convert an evaluation to White's-perspective centipawns, folding mate scores.
    /// White: `10000 - mate*10`; Black: `-10000 - mate*10` (reproduced verbatim).
    public static func normalizeEval(_ e: Evaluation) -> Int {
        if let mate = e.evalMate {
            return mate > 0 ? (10000 - mate * 10) : (-10000 - mate * 10)
        }
        return e.evalCp ?? 0
    }

    /// The threshold ladder (top-to-bottom, first match wins).
    public static func classifyMove(cpLoss: Int, isBestMove: Bool, isBrilliant: Bool) -> String {
        if isBrilliant { return "brilliant" }
        if isBestMove && cpLoss <= 5 { return "great" }
        if isBestMove || cpLoss <= 0 { return "best" }
        if cpLoss <= 15 { return "excellent" }
        if cpLoss <= 30 { return "good" }
        if cpLoss <= 60 { return "inaccuracy" }
        if cpLoss <= 120 { return "mistake" }
        if cpLoss <= 200 { return "miss" }
        return "blunder"
    }

    /// Brilliant = capture (SAN contains `x`) AND mover's eval improved by ≥ 150 cp.
    /// (Matches the code, not the docstring.)
    public static func isBrilliantMove(san: String, color: String, evalBefore: Int, evalAfter: Int) -> Bool {
        let improvement = color == "w" ? (evalAfter - evalBefore) : (evalBefore - evalAfter)
        if improvement < 100 { return false }
        return san.contains("x") && improvement >= 150
    }

    /// Win-probability sigmoid (Elo-style, divisor 400), 0–100, from `color`'s perspective.
    public static func evalToWinPct(evalCp: Int, color: String) -> Double {
        let eval = color == "w" ? Double(evalCp) : -Double(evalCp)
        return 50 + 50 * (2 / (1 + pow(10, -eval / 400)) - 1)
    }

    /// Full review over parallel `evaluations` / `moves` arrays (index 0 = start position).
    /// Mirrors `GameReviewController::review`'s per-move loop exactly.
    public static func review(evaluations: [Evaluation], moves: [Move]) -> Result {
        var whiteClass = emptyClassifications
        var blackClass = emptyClassifications
        var whiteAcc: [Double] = []
        var blackAcc: [Double] = []
        var moveEvals: [MoveEvaluation] = []
        var graph: [EvalGraphPoint] = []

        guard !evaluations.isEmpty else {
            return Result(whiteAccuracy: 0, blackAccuracy: 0,
                          whiteClassifications: whiteClass, blackClassifications: blackClass,
                          moveEvaluations: [], evalGraph: [])
        }

        graph.append(EvalGraphPoint(moveIndex: 0, evalCp: normalizeEval(evaluations[0]),
                                    evalMate: evaluations[0].evalMate))

        var i = 1
        while i < evaluations.count {
            let move = i < moves.count ? moves[i] : nil
            let color = move?.color
            let san = move?.san

            let evalBefore = normalizeEval(evaluations[i - 1])
            let evalAfter = normalizeEval(evaluations[i])

            graph.append(EvalGraphPoint(moveIndex: i, evalCp: evalAfter,
                                        evalMate: evaluations[i].evalMate))

            // PHP `if (! $color || ! $san) continue;` — a string is falsy only when "" or "0".
            guard let color, let san, phpStringIsTruthy(color), phpStringIsTruthy(san) else { i += 1; continue }

            var cpLoss = color == "w" ? (evalBefore - evalAfter) : (evalAfter - evalBefore)
            cpLoss = max(0, cpLoss)

            let bestMoveSan = evaluations[i - 1].bestMoveSan
            // PHP `$bestMoveSan && $san === $bestMoveSan` — bestMoveSan must be truthy too.
            let isBestMove = (bestMoveSan.map(phpStringIsTruthy) ?? false) && san == bestMoveSan
            let isBrilliant = isBrilliantMove(san: san, color: color, evalBefore: evalBefore, evalAfter: evalAfter)
            let classification = classifyMove(cpLoss: cpLoss, isBestMove: isBestMove, isBrilliant: isBrilliant)

            moveEvals.append(MoveEvaluation(moveIndex: i, classification: classification,
                                            cpLoss: cpLoss, bestMoveSan: bestMoveSan))

            if color == "w" { whiteClass[classification, default: 0] += 1 }
            else { blackClass[classification, default: 0] += 1 }

            let wpBefore = evalToWinPct(evalCp: evalBefore, color: color)
            let wpAfter = evalToWinPct(evalCp: evalAfter, color: color)
            let moveAccuracy: Double = wpBefore > 0
                ? min(100, max(0, (wpAfter / wpBefore) * 100))
                : (wpAfter >= wpBefore ? 100 : 0)

            if color == "w" { whiteAcc.append(moveAccuracy) } else { blackAcc.append(moveAccuracy) }
            i += 1
        }

        let whiteAccuracy = whiteAcc.isEmpty ? 0 : round1(whiteAcc.reduce(0, +) / Double(whiteAcc.count))
        let blackAccuracy = blackAcc.isEmpty ? 0 : round1(blackAcc.reduce(0, +) / Double(blackAcc.count))

        return Result(whiteAccuracy: whiteAccuracy, blackAccuracy: blackAccuracy,
                      whiteClassifications: whiteClass, blackClassifications: blackClass,
                      moveEvaluations: moveEvals, evalGraph: graph)
    }

    /// PHP `round($x, 1)` — half-away-from-zero to 1 decimal place.
    static func round1(_ x: Double) -> Double {
        (x * 10).rounded(.toNearestOrAwayFromZero) / 10
    }
}
