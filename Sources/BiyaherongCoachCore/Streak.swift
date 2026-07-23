import Foundation

/// Puzzle Streak mode engine (Appendix C §5 — `StreakController`, verified against source).
///
/// The streak's server-side difficulty tracker (`puzzle_rating`) ramps +50 per solve,
/// capped at 2500, and resets to 600 when the streak ends. The first 10 puzzles are a
/// forced mate-in-1 warmup at rating 600.
public enum StreakEngine {

    public static let initialRating = 600
    public static let ratingStep = 50
    public static let ratingMax = 2500
    public static let warmupCount = 10
    public static let warmupTheme = "mateIn1"
    // The ±50 streak serving window lives in `PuzzleServing.streakWindow` (single source of truth).

    /// Immutable snapshot of a user's streak row.
    public struct State: Equatable, Codable {
        public var currentStreak: Int
        public var bestStreak: Int
        public var puzzleRating: Int
        public var pendingPuzzleId: Int?
        public init(currentStreak: Int = 0, bestStreak: Int = 0,
                    puzzleRating: Int = StreakEngine.initialRating, pendingPuzzleId: Int? = nil) {
            self.currentStreak = currentStreak
            self.bestStreak = bestStreak
            self.puzzleRating = puzzleRating
            self.pendingPuzzleId = pendingPuzzleId
        }
    }

    /// Target rating + theme filter for the next puzzle, given the current state
    /// (`StreakController::assignPuzzle`, first lines).
    public static func target(currentStreak: Int, puzzleRating: Int) -> (rating: Int, theme: String?) {
        let isWarmup = currentStreak < warmupCount
        return (isWarmup ? initialRating : puzzleRating, isWarmup ? warmupTheme : nil)
    }

    /// Apply a correct solve (`StreakController::increment`).
    /// `pendingPuzzleId` becomes the freshly-assigned next puzzle (caller supplies it).
    public static func increment(_ state: State, nextPuzzleId: Int?) -> State {
        var s = state
        s.currentStreak += 1
        if s.currentStreak > s.bestStreak { s.bestStreak = s.currentStreak }
        s.puzzleRating = min(ratingMax, s.puzzleRating + ratingStep)
        s.pendingPuzzleId = nextPuzzleId
        return s
    }

    /// Apply a wrong move (`StreakController::reset`). `bestStreak` is left untouched.
    public static func reset(_ state: State) -> State {
        var s = state
        s.currentStreak = 0
        s.puzzleRating = initialRating
        s.pendingPuzzleId = nil
        return s
    }
}
