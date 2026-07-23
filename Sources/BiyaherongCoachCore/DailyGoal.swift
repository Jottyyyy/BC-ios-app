import Foundation

/// Daily-goal / solving-streak stats (Appendix C §9 — `DailyGoalController`, verified).
public enum DailyGoal {

    /// The daily puzzle target (hard-coded literal in the server response).
    public static let dailyTarget = 10

    /// Consecutive calendar days (ending today, or yesterday if today is unsolved) with at
    /// least one correct solve. Faithful port of `DailyGoalController::calculateStreak`,
    /// including the 365-day lookback and the `date < checkDate → break` gap rule.
    ///
    /// - Parameters:
    ///   - solveDates: dates (any time) on which the user solved ≥1 puzzle correctly.
    ///   - today: the reference "today".
    ///   - calendar: calendar used to derive day boundaries (UTC recommended for determinism).
    public static func calculateStreakDays(solveDates: [Date], today: Date,
                                           calendar: Calendar = DailyGoal.utcCalendar) -> Int {
        // Distinct start-of-day dates, sorted descending, capped at 365 (matches SQL LIMIT 365).
        let distinctDays = Set(solveDates.map { calendar.startOfDay(for: $0) })
        let dates = distinctDays.sorted(by: >).prefix(365)
        if dates.isEmpty { return 0 }

        let todayStart = calendar.startOfDay(for: today)
        var streak = 0
        var checkDate = todayStart

        // If the user hasn't solved today, start counting from yesterday.
        if !distinctDays.contains(todayStart) {
            checkDate = calendar.date(byAdding: .day, value: -1, to: todayStart)!
        }

        for date in dates {
            if date == checkDate {
                streak += 1
                checkDate = calendar.date(byAdding: .day, value: -1, to: checkDate)!
            } else if date < checkDate {
                break // gap → streak broken
            }
            // date > checkDate → skip (no-op), matching PHP's implicit else.
        }
        return streak
    }

    /// A fixed UTC calendar for deterministic day math in tests and stats.
    public static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
}
