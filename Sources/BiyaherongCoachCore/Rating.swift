import Foundation

/// Puzzle ELO rating engine.
///
/// Faithful port of `PuzzleController::submitAnswer` (Appendix C §2), verified against
/// the real Laravel source:
///   expectedScore = 1 / (1 + 10^((puzzleRating - userRating) / 400))
///   ratingChange  = (int) round(32 * (actual - expected))
///   newRating     = max(400, userRating + ratingChange)
public enum PuzzleRatingEngine {

    /// K-factor (Elo). Load-bearing constant — do not change.
    public static let kFactor = 32.0
    /// Divisor in the expected-score exponent.
    public static let divisor = 400.0
    /// Rating floor. There is no upper cap.
    public static let floor = 400

    public struct Outcome: Equatable, Codable {
        public let expectedScore: Double
        public let ratingChange: Int
        public let newRating: Int
        public init(expectedScore: Double, ratingChange: Int, newRating: Int) {
            self.expectedScore = expectedScore
            self.ratingChange = ratingChange
            self.newRating = newRating
        }
    }

    /// Compute the ELO outcome for one attempt.
    public static func evaluate(userRating: Int, puzzleRating: Int, isCorrect: Bool) -> Outcome {
        let expected = 1.0 / (1.0 + pow(10.0, Double(puzzleRating - userRating) / divisor))
        let actual = isCorrect ? 1.0 : 0.0
        // PHP round() is half-away-from-zero, then (int) cast.
        let ratingChange = Int((kFactor * (actual - expected)).rounded(.toNearestOrAwayFromZero))
        let newRating = max(floor, userRating + ratingChange)
        return Outcome(expectedScore: expected, ratingChange: ratingChange, newRating: newRating)
    }

    /// Fallback correctness rule (`PuzzleController::compareMoves`):
    /// only the FIRST move is compared for string equality.
    /// If either move list is empty, returns false (matches PHP `isset()` guard).
    public static func compareMoves(correct: [String], user: [String]) -> Bool {
        guard let u = user.first, let c = correct.first else { return false }
        return u == c
    }
}

/// Rating → tier label. Faithful port of `ShareController::rating` / `OgImageController`
/// (identical thresholds): descending ladder so boundary values land in the higher tier.
public enum RatingTier {
    public static func classify(_ rating: Int) -> String {
        if rating >= 2000 { return "Expert" }
        if rating >= 1600 { return "Advanced" }
        if rating >= 1200 { return "Intermediate" }
        if rating >= 800 { return "Beginner" }
        return "Novice"
    }
}
