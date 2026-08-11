import Foundation

// MARK: - Records (Puzzle Hub spec, Part 4)
//
// The record SHAPES below are the spec's, field for field. The mechanism is not: Part 4 is written
// against SwiftData, and this app already persists the Analysis Board's library as Codable + JSON.
// Introducing a second persistence stack for the Puzzle Hub would buy nothing and would put the
// Parity Core one import away from a framework it is not allowed to have. Recorded in
// PORTING_NOTES.md.
//
// Everything the user DOES lives here. Everything the user SOLVES lives in the read-only bundle.

/// Exactly one row. The rated-mode Elo; floor 400, no ceiling.
public struct PuzzleProfile: Codable, Equatable, Sendable {
    public var rating: Int
    public var highestRating: Int
    public var createdAt: Int          // epoch ms, matching AnalysisStore's convention
    public init(rating: Int = PuzzleProgress.defaultRating,
                highestRating: Int = PuzzleProgress.defaultRating, createdAt: Int = 0) {
        self.rating = rating; self.highestRating = highestRating; self.createdAt = createdAt
    }
}

// NOTE on the explicit inits below: a `public struct`'s memberwise initialiser is INTERNAL, so
// `BiyaherongUI` could not construct any of these without them. Written out rather than discovered
// at compile time on a Mac.

/// The rating ledger — rated mode only, one row per puzzle, ever.
public struct PuzzleAttempt: Codable, Equatable, Sendable {
    public var puzzleId: Int
    public var isCorrect: Bool
    public var ratingChange: Int
    public var ratingBefore: Int
    public var ratingAfter: Int
    /// Kept locally although the server validated it and then threw it away — it drives the rated
    /// timer and is worth storing.
    public var solveTimeSeconds: Int?
    public var solvedAt: Int
    public init(puzzleId: Int, isCorrect: Bool, ratingChange: Int, ratingBefore: Int,
                ratingAfter: Int, solveTimeSeconds: Int?, solvedAt: Int) {
        self.puzzleId = puzzleId; self.isCorrect = isCorrect; self.ratingChange = ratingChange
        self.ratingBefore = ratingBefore; self.ratingAfter = ratingAfter
        self.solveTimeSeconds = solveTimeSeconds; self.solvedAt = solvedAt
    }
}

/// Streak state (one row) — `pendingPuzzleId` is the anti-reroll lock.
public typealias StreakState = StreakEngine.State

public struct StreakRun: Codable, Equatable, Sendable {
    public var length: Int
    public var endedAt: Int
    public init(length: Int, endedAt: Int) { self.length = length; self.endedAt = endedAt }
}

public struct RushRun: Codable, Equatable, Sendable {
    public var mode: Int
    public var score: Int
    public var mistakes: Int
    public var endedAt: Int
    /// The real reason, so the results screen cannot claim "Time's Up!" after three mistakes.
    public var reason: PuzzleProgress.RushEndReason
    public init(mode: Int, score: Int, mistakes: Int, endedAt: Int,
                reason: PuzzleProgress.RushEndReason) {
        self.mode = mode; self.score = score; self.mistakes = mistakes
        self.endedAt = endedAt; self.reason = reason
    }
}

/// Infinite-mode resume, one row.
public struct RushDraft: Codable, Equatable, Sendable {
    public var score: Int
    public var mistakes: Int
    public var targetRating: Int
    public var puzzlesServed: Int
    public var savedAt: Int
    public init(score: Int, mistakes: Int, targetRating: Int, puzzlesServed: Int, savedAt: Int) {
        self.score = score; self.mistakes = mistakes; self.targetRating = targetRating
        self.puzzlesServed = puzzlesServed; self.savedAt = savedAt
    }
}

/// Rated-mode resume, one row.
public struct PlayPuzzleDraft: Codable, Equatable, Sendable {
    public var puzzleId: Int
    public var savedAt: Int
    public init(puzzleId: Int, savedAt: Int) { self.puzzleId = puzzleId; self.savedAt = savedAt }
}

/// Daily Puzzle state (one row). `lastSolvedDay` is a LOCAL day key, never UTC.
public struct DailyPuzzleState: Codable, Equatable, Sendable {
    public var streak: Int
    public var totalSolved: Int
    public var lastSolvedDay: String?
    public init(streak: Int = 0, totalSolved: Int = 0, lastSolvedDay: String? = nil) {
        self.streak = streak; self.totalSolved = totalSolved; self.lastSolvedDay = lastSolvedDay
    }
}

/// One row per theme the user has touched. Feeds the stats screen in Part 10.1.
public struct ThemeStat: Codable, Equatable, Sendable {
    public var theme: String
    public var attempted: Int
    public var solved: Int
    public init(theme: String, attempted: Int, solved: Int) {
        self.theme = theme; self.attempted = attempted; self.solved = solved
    }
}

/// The whole persisted state. One `Codable` value, one file.
public struct PuzzleProgressState: Codable, Equatable, Sendable {
    public var version: Int
    public var profile: PuzzleProfile
    public var attempts: [PuzzleAttempt]
    /// Non-repetition set, all modes. Stored sorted so the file does not churn on every write.
    public var seen: [Int]
    public var streak: StreakState
    public var streakRuns: [StreakRun]
    /// One entry per Turbo mode (0 = infinite, 3, 5), keyed by mode as a string for JSON.
    public var rushBest: [String: Int]
    public var rushRuns: [RushRun]
    public var rushDraft: RushDraft?
    public var daily: DailyPuzzleState
    public var playDraft: PlayPuzzleDraft?
    public var themeStats: [String: ThemeStat]
    /// Part 15's tiny append-only counter, keyed by LOCAL day (`yyyy-MM-dd`).
    public var dailySolves: [String: Int]

    public init(version: Int, profile: PuzzleProfile, attempts: [PuzzleAttempt], seen: [Int],
                streak: StreakState, streakRuns: [StreakRun], rushBest: [String: Int],
                rushRuns: [RushRun], rushDraft: RushDraft?, daily: DailyPuzzleState,
                playDraft: PlayPuzzleDraft?, themeStats: [String: ThemeStat],
                dailySolves: [String: Int]) {
        self.version = version; self.profile = profile; self.attempts = attempts; self.seen = seen
        self.streak = streak; self.streakRuns = streakRuns; self.rushBest = rushBest
        self.rushRuns = rushRuns; self.rushDraft = rushDraft; self.daily = daily
        self.playDraft = playDraft; self.themeStats = themeStats; self.dailySolves = dailySolves
    }
}

// MARK: - The rules over them

/// Twin of `web-demo/js/puzzle-progress.js`.
///
/// Pure. `now` (epoch ms) is an injected parameter, the same convention `AnalysisStore` uses,
/// which is what makes the day boundary and the 24-hour TTL assertable without a clock.
///
/// The arithmetic this file does **not** restate: the Elo (`PuzzleRatingEngine`), the streak ramp
/// (`StreakEngine`), the rush best-score rule (`PuzzleRush`) and the goal-streak walk
/// (`DailyGoal`) are already ported and pinned to the PHP oracle. This file calls them.
public enum PuzzleProgress {

    public static let stateVersion = 1
    public static let defaultRating = 1200
    public static let rushModes = PuzzleRush.modes            // [0, 3, 5]
    public static let dailyTarget = DailyGoal.dailyTarget     // 10, the server's literal
    public static let goalLookbackDays = 365                  // matches the server's SQL LIMIT
    public static let draftTTLMs = PuzzleSession.Timing.draftTTLMs

    /// Why a Turbo run ended. Spec fix #6: the original always said "Time's Up!".
    public enum RushEndReason: String, Codable, Equatable, Sendable {
        case timeUp, threeMistakes, quit, backgrounded, finished
    }

    // MARK: Day keys (spec fix #1 — LOCAL calendar, never UTC)

    /// `yyyy-MM-dd` in the device-local calendar — the key `DailyLimits.dayKey` already produces.
    public static func dayKey(_ nowMs: Int, calendar: Calendar = .current) -> String {
        DailyLimits.dayKey(for: Date(timeIntervalSince1970: Double(nowMs) / 1000.0),
                           calendar: calendar)
    }

    /// A day key as an integer day number, for gap arithmetic.
    public static func dayNumber(_ key: String) -> Int {
        let p = key.split(separator: "-").map { Int($0) ?? 0 }
        guard p.count == 3 else { return 0 }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        // Through a UTC calendar rather than by differencing two local midnights: a DST transition
        // makes a local day 23 or 25 hours long, which silently adds or drops a day from a streak.
        guard let d = utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else {
            return 0
        }
        return Int((d.timeIntervalSince1970 / 86400.0).rounded(.down))
    }

    public static func key(fromDayNumber n: Int) -> String {
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let d = Date(timeIntervalSince1970: Double(n) * 86400.0)
        let c = utc.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    // MARK: Seeding

    /// Part 4: on first launch create the profile, the streak state, the daily state and three
    /// `RushBest` rows. Nothing else.
    public static func seed(now: Int) -> PuzzleProgressState {
        var best: [String: Int] = [:]
        for m in rushModes { best[String(m)] = 0 }
        return PuzzleProgressState(
            version: stateVersion,
            profile: PuzzleProfile(rating: defaultRating, highestRating: defaultRating,
                                   createdAt: now),
            attempts: [], seen: [], streak: StreakState(), streakRuns: [],
            rushBest: best, rushRuns: [], rushDraft: nil,
            daily: DailyPuzzleState(), playDraft: nil, themeStats: [:], dailySolves: [:])
    }

    // MARK: The rated ledger (Part 8)

    public struct RatedResult: Equatable, Sendable {
        public let firstAttempt: Bool
        public let ratingChange: Int
        public let ratingBefore: Int
        public let ratingAfter: Int
        public let countedTowardGoal: Bool
    }

    public static func attempt(_ s: PuzzleProgressState, puzzleId: Int) -> PuzzleAttempt? {
        s.attempts.first { $0.puzzleId == puzzleId }
    }

    /// The ONE place `profile.rating` changes. Rated mode only — Daily, Thematic, Streak and Turbo
    /// never call this.
    ///
    /// The first rated attempt per puzzle decides everything. A replay is allowed and is a no-op:
    /// no rating move, no second ledger row, no `ThemeStat` bump, and no daily-goal credit. The
    /// spec bundles all four under "On the first `finish()` for a puzzle", and the alternative
    /// would let a user farm the daily goal by replaying one puzzle.
    @discardableResult
    public static func recordRatedAttempt(_ s: inout PuzzleProgressState, puzzleId: Int,
                                          isCorrect: Bool, puzzleRating: Int, themes: [String],
                                          solveTimeSeconds: Int? = nil,
                                          now: Int, calendar: Calendar = .current) -> RatedResult {
        if attempt(s, puzzleId: puzzleId) != nil {
            return RatedResult(firstAttempt: false, ratingChange: 0,
                               ratingBefore: s.profile.rating, ratingAfter: s.profile.rating,
                               countedTowardGoal: false)
        }
        let before = s.profile.rating
        let out = PuzzleRatingEngine.evaluate(userRating: before, puzzleRating: puzzleRating,
                                              isCorrect: isCorrect)
        s.profile.rating = out.newRating
        if out.newRating > s.profile.highestRating { s.profile.highestRating = out.newRating }
        s.attempts.append(PuzzleAttempt(puzzleId: puzzleId, isCorrect: isCorrect,
                                        ratingChange: out.ratingChange, ratingBefore: before,
                                        ratingAfter: out.newRating,
                                        solveTimeSeconds: solveTimeSeconds, solvedAt: now))
        bumpThemeStats(&s, themes: themes, isCorrect: isCorrect)
        var counted = false
        if isCorrect { counted = recordSolve(&s, mode: .play, now: now, calendar: calendar) }
        return RatedResult(firstAttempt: true, ratingChange: out.ratingChange,
                           ratingBefore: before, ratingAfter: out.newRating,
                           countedTowardGoal: counted)
    }

    /// attempted +1 always, solved +1 when correct — for every theme on the puzzle (Part 8).
    public static func bumpThemeStats(_ s: inout PuzzleProgressState, themes: [String],
                                      isCorrect: Bool) {
        for t in themes {
            var stat = s.themeStats[t] ?? ThemeStat(theme: t, attempted: 0, solved: 0)
            stat.attempted += 1
            if isCorrect { stat.solved += 1 }
            s.themeStats[t] = stat
        }
    }

    /// The newest `limit` ledger rows. Spec fix #9: the server took the **oldest** 30
    /// (`orderBy asc, take 30`). Swift's sort is not stable, so the id is an explicit tie-break.
    public static func ratingHistory(_ s: PuzzleProgressState, limit: Int = 30) -> [PuzzleAttempt] {
        let sorted = s.attempts.sorted {
            $0.solvedAt != $1.solvedAt ? $0.solvedAt > $1.solvedAt : $0.puzzleId > $1.puzzleId
        }
        return Array(sorted.prefix(limit))
    }

    // MARK: The daily goal (Part 15)

    /// Credit one counting solve. The mode predicate lives in `PuzzleSession` and is called from
    /// here and nowhere else, so "does Turbo count?" is a one-line change.
    @discardableResult
    public static func recordSolve(_ s: inout PuzzleProgressState, mode: PuzzleSession.Mode,
                                   now: Int, calendar: Calendar = .current) -> Bool {
        guard PuzzleSession.countsTowardDailyGoal(mode) else { return false }
        let k = dayKey(now, calendar: calendar)
        s.dailySolves[k] = (s.dailySolves[k] ?? 0) + 1
        return true
    }

    public struct GoalStatus: Equatable, Sendable {
        public let solvedToday: Int
        public let target: Int
        public let complete: Bool
        /// `min(solvedToday / target, 1)` — the ring never overfills.
        public let progress: Double
        public let goalStreak: Int
    }

    /// Consecutive local days with at least one counting solve, anchored to today **or**
    /// yesterday, with a 365-day lookback. The same walk as `DailyGoal.calculateStreakDays`, over
    /// day numbers instead of `Date`s: anchoring to yesterday is what lets a streak survive until
    /// the end of the following day rather than dying at midnight.
    public static func goalStreakDays(_ s: PuzzleProgressState, now: Int,
                                      calendar: Calendar = .current) -> Int {
        let days = s.dailySolves.filter { $0.value > 0 }
            .map { dayNumber($0.key) }
            .sorted(by: >)
            .prefix(goalLookbackDays)
        if days.isEmpty { return 0 }
        let today = dayNumber(dayKey(now, calendar: calendar))
        var check = days.contains(today) ? today : today - 1
        var streak = 0
        for d in days {
            if d == check { streak += 1; check -= 1 }
            else if d < check { break }        // gap → broken
            // d > check → a future-dated entry, skipped (matches the PHP's implicit else)
        }
        return streak
    }

    public static func dailyGoalStatus(_ s: PuzzleProgressState, now: Int,
                                       calendar: Calendar = .current) -> GoalStatus {
        let solved = s.dailySolves[dayKey(now, calendar: calendar)] ?? 0
        return GoalStatus(solvedToday: solved, target: dailyTarget,
                          complete: solved >= dailyTarget,
                          progress: min(Double(solved) / Double(dailyTarget), 1.0),
                          goalStreak: goalStreakDays(s, now: now, calendar: calendar))
    }

    // MARK: Daily Puzzle state (Part 11)

    public struct DailySolveResult: Equatable, Sendable {
        public let alreadySolvedToday: Bool
        public let streak: Int
    }

    /// One solve per calendar day counts. Solving twice on the same day must not double the
    /// streak, which is why this compares against `lastSolvedDay` rather than just incrementing.
    @discardableResult
    public static func recordDailyPuzzleSolve(_ s: inout PuzzleProgressState, now: Int,
                                              calendar: Calendar = .current) -> DailySolveResult {
        let today = dayKey(now, calendar: calendar)
        if s.daily.lastSolvedDay == today {
            return DailySolveResult(alreadySolvedToday: true, streak: s.daily.streak)
        }
        let yesterday = key(fromDayNumber: dayNumber(today) - 1)
        s.daily.streak = (s.daily.lastSolvedDay == yesterday) ? s.daily.streak + 1 : 1
        s.daily.totalSolved += 1
        s.daily.lastSolvedDay = today
        recordSolve(&s, mode: .daily, now: now, calendar: calendar)
        return DailySolveResult(alreadySolvedToday: false, streak: s.daily.streak)
    }

    // MARK: Streak, mid-run (Part 13.2)
    //
    // Everything here was missing. `endStreakRun` existed and `StreakEngine.increment` existed, but
    // nothing joined them: `currentStreak` was only ever written back to 0, `puzzleRating` never
    // ramped, and `pendingPuzzleId` had neither a writer nor a reader — so the anti-reroll lock
    // that Part 22.6 makes an acceptance criterion did not exist at all.

    public struct StreakSolveResult: Equatable, Sendable {
        public let streak: Int
        public let targetRating: Int
        public let targetTheme: String?
    }

    /// A correct Streak solve: advance the ramp, take the lock on the next puzzle, credit the goal.
    ///
    /// `nextPuzzleId` is the puzzle about to be served. Assigning it here IS the lock — leaving the
    /// screen and returning reads it straight back, so a hard puzzle cannot be rerolled.
    @discardableResult
    public static func recordStreakSolve(_ s: inout PuzzleProgressState, nextPuzzleId: Int?,
                                         now: Int,
                                         calendar: Calendar = .current) -> StreakSolveResult {
        s.streak = StreakEngine.increment(s.streak, nextPuzzleId: nextPuzzleId)
        recordSolve(&s, mode: .streak, now: now, calendar: calendar)
        let t = StreakEngine.target(currentStreak: s.streak.currentStreak,
                                    puzzleRating: s.streak.puzzleRating)
        return StreakSolveResult(streak: s.streak.currentStreak,
                                 targetRating: t.rating, targetTheme: t.theme)
    }

    /// The next puzzle's target rating and theme filter, straight from the pinned engine.
    public static func streakTarget(_ s: PuzzleProgressState) -> (rating: Int, theme: String?) {
        StreakEngine.target(currentStreak: s.streak.currentStreak,
                            puzzleRating: s.streak.puzzleRating)
    }

    /// The locked puzzle, if a run is mid-flight.
    public static func pendingStreakPuzzle(_ s: PuzzleProgressState) -> Int? {
        s.streak.pendingPuzzleId
    }

    /// Take the lock without advancing the streak — used when a run serves its FIRST puzzle.
    public static func lockStreakPuzzle(_ s: inout PuzzleProgressState, puzzleId: Int?) {
        s.streak.pendingPuzzleId = puzzleId
    }

    // MARK: Thematic (Part 12.3)

    /// A correct Thematic attempt.
    ///
    /// Thematic **never touches Elo** — no ledger row, no rating move. It does update `ThemeStat`,
    /// so thematic practice shows on the stats screen, and a correct solve credits the daily goal.
    /// Both were previously unreachable: `recordSolve` was only called from the rated and daily
    /// paths, so a Thematic or Streak solve moved no counter at all.
    @discardableResult
    public static func recordThematicAttempt(_ s: inout PuzzleProgressState, themes: [String],
                                             isCorrect: Bool, now: Int,
                                             calendar: Calendar = .current) -> Bool {
        bumpThemeStats(&s, themes: themes, isCorrect: isCorrect)
        guard isCorrect else { return false }
        return recordSolve(&s, mode: .thematic, now: now, calendar: calendar)
    }

    // MARK: Run history (Parts 13.1, 14.1)
    //
    // Both home screens replace a leaderboard with the user's own last ten runs. Every sort has an
    // explicit tie-break: Swift's sort is not stable and two runs can share a millisecond.

    public static func recentStreakRuns(_ s: PuzzleProgressState, limit: Int = 10) -> [StreakRun] {
        let sorted = s.streakRuns.sorted {
            $0.endedAt != $1.endedAt ? $0.endedAt > $1.endedAt : $0.length > $1.length
        }
        return Array(sorted.prefix(limit))
    }

    public static func recentRushRuns(_ s: PuzzleProgressState, mode: Int,
                                      limit: Int = 10) -> [RushRun] {
        let sorted = s.rushRuns.filter { $0.mode == mode }.sorted {
            $0.endedAt != $1.endedAt ? $0.endedAt > $1.endedAt : $0.score > $1.score
        }
        return Array(sorted.prefix(limit))
    }

    public static func rushBest(_ s: PuzzleProgressState, mode: Int) -> Int {
        s.rushBest[String(mode)] ?? 0
    }

    // MARK: Runs

    public struct RunResult: Equatable, Sendable {
        public let score: Int
        public let isNewBest: Bool
        public let best: Int
    }

    /// Every Streak run ends here, so history and the best score cannot be skipped. Spec fix #8:
    /// the original computed an `isNewBest` it never read and rendered the badge from a separate
    /// inline expression. This return value is the one source of truth.
    ///
    /// `bestBefore` is the best as it stood when the run STARTED, and it is required. Without it
    /// `isNewBest` is unreachable-false: `StreakEngine.increment` raises `bestStreak` on every
    /// solve, so by the time a record run ends `bestStreak` already equals `length` and
    /// `length > bestStreak` is never true — the 🏆 NEW BEST badge could not appear at all. The RN
    /// original dodged this with `>=`, which calls a tie a new best. Recorded in PORTING_NOTES.md.
    @discardableResult
    public static func endStreakRun(_ s: inout PuzzleProgressState, length: Int,
                                    bestBefore: Int, now: Int) -> RunResult {
        let isNewBest = length > 0 && length >= bestBefore
        if length > s.streak.bestStreak { s.streak.bestStreak = length }
        // An immediate loss is not a run, so it does not clutter the history list.
        if length > 0 { s.streakRuns.append(StreakRun(length: length, endedAt: now)) }
        s.streak = StreakEngine.reset(s.streak)      // leaves bestStreak alone, by design
        return RunResult(score: length, isNewBest: isNewBest, best: s.streak.bestStreak)
    }

    public struct RushResult: Equatable, Sendable {
        public let score: Int
        public let mistakes: Int
        public let reason: RushEndReason
        public let isNewBest: Bool
        public let best: Int
    }

    /// Every Turbo run ends here — a finished clock, three mistakes, a manual quit and
    /// backgrounding all route through one function.
    ///
    /// Spec fixes #5, #6 and #13 are the same bug three times: the original ended timed runs on
    /// background without saving the best score or writing history, always reported "Time's Up!"
    /// whatever actually happened, and threw the score away entirely on quit. A single exit taking
    /// the real reason fixes all three by construction.
    @discardableResult
    public static func endRushRun(_ s: inout PuzzleProgressState, mode: Int, score: Int,
                                  mistakes: Int, reason: RushEndReason, now: Int) -> RushResult {
        let key = String(mode)
        let prev = s.rushBest[key] ?? 0
        let best = PuzzleRush.bestScore(submitted: score, stored: prev)
        let isNewBest = score > prev
        s.rushBest[key] = best
        // A scoreless run is not a run, the same rule `endStreakRun` applies to a zero-length
        // streak. Without it an instant quit pollutes the last-ten list on the mode-select screen.
        if score > 0 {
            s.rushRuns.append(RushRun(mode: mode, score: score, mistakes: mistakes, endedAt: now,
                                      reason: reason))
        }
        if mode == 0 { s.rushDraft = nil }
        return RushResult(score: score, mistakes: mistakes, reason: reason,
                          isNewBest: isNewBest, best: best)
    }

    // MARK: Drafts (24-hour TTL)

    public static func savePlayDraft(_ s: inout PuzzleProgressState, puzzleId: Int, now: Int) {
        s.playDraft = PlayPuzzleDraft(puzzleId: puzzleId, savedAt: now)
    }

    /// Restores silently when under 24 hours old, and clears itself when not.
    public static func loadPlayDraft(_ s: inout PuzzleProgressState, now: Int) -> PlayPuzzleDraft? {
        guard let d = s.playDraft else { return nil }
        if now - d.savedAt > draftTTLMs { s.playDraft = nil; return nil }
        return d
    }

    public static func saveRushDraft(_ s: inout PuzzleProgressState, score: Int, mistakes: Int,
                                     targetRating: Int, puzzlesServed: Int, now: Int) {
        s.rushDraft = RushDraft(score: score, mistakes: mistakes, targetRating: targetRating,
                                puzzlesServed: puzzlesServed, savedAt: now)
    }

    public static func loadRushDraft(_ s: inout PuzzleProgressState, now: Int) -> RushDraft? {
        guard let d = s.rushDraft else { return nil }
        if now - d.savedAt > draftTTLMs { s.rushDraft = nil; return nil }
        return d
    }

    // MARK: The seen set

    public static func seenSet(_ s: PuzzleProgressState) -> Set<Int> { Set(s.seen) }

    /// Sorted on the way out, so an unchanged set serialises to an unchanged file.
    public static func commitSeen(_ s: inout PuzzleProgressState, _ set: Set<Int>) {
        s.seen = set.sorted()
    }
}
