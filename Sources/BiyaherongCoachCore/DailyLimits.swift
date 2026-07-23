import Foundation

/// Free-tier daily limits (Appendix C §7 — `ChecksDailyLimits`, verified against source).
///
/// The pure limit test takes the already-counted usage as input; the "which calendar day"
/// question is answered at the storage layer. DELIBERATE DEVIATION (brief §6 #5): the
/// server keys the day by UTC (`Carbon::today()`); the offline app keys it by the device's
/// LOCAL `startOfDay` — use `DailyLimits.dayKey(for:calendar:)`.
public enum DailyLimits {

    /// Named caps. Any `rush_*` mode is 1; unknown modes default to 1.
    public static let caps: [String: Int] = [
        "regular": 5,   // rated Play Puzzles
        "streak": 1,    // puzzle streak (start-of-session)
        "coach": 2,     // AI coach chats
    ]

    /// Maximum uses per day for a mode.
    public static func maxUses(for mode: String) -> Int {
        if mode.hasPrefix("rush_") { return 1 }
        return caps[mode] ?? 1
    }

    /// Whether a user has hit their daily cap. Premium always passes (false).
    /// Matches PHP `count >= max`.
    public static func isAtDailyLimit(mode: String, usedToday: Int, isPremium: Bool) -> Bool {
        if isPremium { return false }
        return usedToday >= maxUses(for: mode)
    }

    /// The local-day key (yyyy-MM-dd) used to bucket daily counters.
    /// Uses the device-local calendar day (documented deviation from the server's UTC).
    public static func dayKey(for date: Date, calendar: Calendar = .current) -> String {
        // Y/M/D in the calendar's own time zone (device-local day for `.current`).
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }
}
