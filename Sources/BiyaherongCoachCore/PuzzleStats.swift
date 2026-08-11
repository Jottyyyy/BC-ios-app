import Foundation

/// The Play Puzzles Home statistics (spec Part 10.1), as pure functions.
///
/// Twin of `web-demo/js/puzzle-stats.js`.
///
/// Part 10.1 replaces the original's leaderboard with these: offline there are no other players,
/// and the user's own history is strictly more useful. They live here rather than in a SwiftUI
/// body because every one of them has an edge case that only appears on day one or after exactly
/// one solve — a sparkline with a single point, a bar chart where every count is zero, an accuracy
/// of 0/0 — and a chart computed inside a view body is untestable.
///
/// ## The layering boundary
/// This file is Foundation-only, so it holds no presentation constants. The two functions that
/// produce geometry take their pixel sizes as parameters and the UI passes them from
/// `PuzzleMetrics.Stats`. What stays here are the domain numbers: how many attempts a sparkline
/// looks back over, how many theme rows the screen has room for. Same boundary `AnalysisSession`
/// draws when it publishes raw numbers for each platform's metrics table to map.
public enum PuzzleStats {

    /// The rating window the sparkline plots. Upstream, `PuzzleProgress.ratingHistory` takes the
    /// NEWEST rows — the server took the oldest (spec fix #9).
    public static let sparkWindow = 30
    /// Fewer than this renders nothing at all: a one-point polyline is an invisible dot that
    /// reads as a bug rather than as an empty chart.
    public static let sparkMinPoints = 2
    /// The daily-activity chart's span.
    public static let activityDays = 7
    /// At most this many theme rows.
    public static let themeRows = 6

    // MARK: - Shapes

    public struct Point: Equatable, Sendable {
        public let x: Double
        public let y: Double
    }

    public struct Sparkline: Equatable, Sendable {
        public let points: [Point]
        public let min: Int
        public let max: Int
        public let count: Int
    }

    public struct Accuracy: Equatable, Sendable {
        public let solved: Int
        public let attempted: Int
        /// One decimal place.
        public let percent: Double
    }

    public struct ActivityBar: Equatable, Sendable {
        public let dayKey: String
        public let count: Int
        public let height: Double
        public let filled: Bool
    }

    public struct ThemeRow: Equatable, Sendable {
        public let theme: String
        public let attempted: Int
        public let solved: Int
        public let percent: Int
    }

    // MARK: - The statistics

    /// True when there is nothing to chart yet — the day-one state, where the screen shows the
    /// rating card and one invitation instead of four blank charts.
    public static func isEmpty(_ s: PuzzleProgressState) -> Bool { s.attempts.isEmpty }

    /// Rating change over the last seven days: the current rating minus the `ratingBefore` of the
    /// oldest attempt inside the window.
    ///
    /// `nil` when there is no history in the window, which the screen renders as an em dash. A
    /// `+0` would claim the rating held steady when in fact nothing happened.
    public static func weekDelta(_ s: PuzzleProgressState, now: Int) -> Int? {
        let cutoff = now - 7 * 24 * 60 * 60 * 1000
        let inWindow = s.attempts.filter { $0.solvedAt >= cutoff }
        guard !inWindow.isEmpty else { return nil }
        // Explicit tie-break: Swift's sort/min is not stable, and two attempts can share a
        // millisecond.
        let oldest = inWindow.min {
            $0.solvedAt != $1.solvedAt ? $0.solvedAt < $1.solvedAt : $0.puzzleId < $1.puzzleId
        }!
        return s.profile.rating - oldest.ratingBefore
    }

    /// The newest `sparkWindow` attempts' `ratingAfter`, oldest-first for drawing.
    ///
    /// The y-range is `[min - yMargin, max + yMargin]`, which is what stops a flat history from
    /// clipping to the edges. `y` grows downward, so a rating RISE produces a SMALLER y.
    public static func sparkline(_ s: PuzzleProgressState, width: Double, height: Double,
                                 yMargin: Int) -> Sparkline? {
        let rows = Array(PuzzleProgress.ratingHistory(s, limit: sparkWindow).reversed())
        guard rows.count >= sparkMinPoints else { return nil }
        let values = rows.map { $0.ratingAfter }
        let lo = values.min()! - yMargin
        let hi = values.max()! + yMargin
        let span = Double(hi - lo)
        let last = Double(rows.count - 1)
        let points = values.enumerated().map { i, v in
            Point(x: (Double(i) / last) * width,
                  y: height - (Double(v - lo) / span) * height)
        }
        return Sparkline(points: points, min: lo, max: hi, count: rows.count)
    }

    /// `solved / attempted` as a percentage to one decimal. `nil` when nothing was attempted.
    public static func accuracy(_ s: PuzzleProgressState) -> Accuracy? {
        let attempted = s.attempts.count
        guard attempted > 0 else { return nil }
        let solved = s.attempts.filter { $0.isCorrect }.count
        let pct = (Double(solved) / Double(attempted) * 1000).rounded() / 10
        return Accuracy(solved: solved, attempted: attempted, percent: pct)
    }

    /// The last seven LOCAL days of counting solves, oldest-first, as the bar chart draws them.
    ///
    /// `height = max(count / maxVal * maxHeight, minHeight)` — the source's own formula, floor and
    /// all, so an empty day keeps a visible stub instead of collapsing to nothing.
    public static func activity(_ s: PuzzleProgressState, now: Int,
                                maxHeight: Double, minHeight: Double,
                                calendar: Calendar = .current) -> [ActivityBar] {
        let today = PuzzleProgress.dayNumber(PuzzleProgress.dayKey(now, calendar: calendar))
        let days: [(key: String, count: Int)] = (0..<activityDays).reversed().map { back in
            let key = PuzzleProgress.key(fromDayNumber: today - back)
            return (key, s.dailySolves[key] ?? 0)
        }
        let maxVal = Swift.max(days.map(\.count).max() ?? 0, 1)
        return days.map { d in
            ActivityBar(dayKey: d.key, count: d.count,
                        height: Swift.max(Double(d.count) / Double(maxVal) * maxHeight, minHeight),
                        filled: d.count > 0)
        }
    }

    /// Up to `themeRows` themes by attempts, descending.
    ///
    /// The tie-break on the theme name is load-bearing rather than cosmetic: Swift's sort is not
    /// stable, so two themes with equal attempts would otherwise swap places between launches.
    public static func themePerformance(_ s: PuzzleProgressState) -> [ThemeRow] {
        s.themeStats.values
            .filter { $0.attempted > 0 }
            .sorted {
                $0.attempted != $1.attempted ? $0.attempted > $1.attempted : $0.theme < $1.theme
            }
            .prefix(themeRows)
            .map {
                ThemeRow(theme: $0.theme, attempted: $0.attempted, solved: $0.solved,
                         percent: Int((Double($0.solved) / Double($0.attempted) * 100).rounded()))
            }
    }

    // MARK: - Everything at once

    public struct Summary: Equatable, Sendable {
        public let isEmpty: Bool
        public let rating: Int
        public let best: Int
        public let weekDelta: Int?
        public let sparkline: Sparkline?
        public let accuracy: Accuracy?
        public let activity: [ActivityBar]
        public let themes: [ThemeRow]
        public let goal: PuzzleProgress.GoalStatus
    }

    /// One call, so the view derives nothing itself.
    public static func summary(_ s: PuzzleProgressState, now: Int,
                               sparkWidth: Double, sparkHeight: Double, sparkYMargin: Int,
                               barMaxHeight: Double, barMinHeight: Double,
                               calendar: Calendar = .current) -> Summary {
        Summary(
            isEmpty: isEmpty(s),
            rating: s.profile.rating,
            best: s.profile.highestRating,
            weekDelta: weekDelta(s, now: now),
            sparkline: sparkline(s, width: sparkWidth, height: sparkHeight, yMargin: sparkYMargin),
            accuracy: accuracy(s),
            activity: activity(s, now: now, maxHeight: barMaxHeight, minHeight: barMinHeight,
                               calendar: calendar),
            themes: themePerformance(s),
            goal: PuzzleProgress.dailyGoalStatus(s, now: now, calendar: calendar))
    }
}
