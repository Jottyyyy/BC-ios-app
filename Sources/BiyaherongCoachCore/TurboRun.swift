import Foundation

/// Puzzle Turbo's run state and difficulty ramp (Puzzle Hub spec, Part 14.2).
///
/// Twin of `web-demo/js/turbo-run.js`.
///
/// ## Why this is a separate engine
/// `PuzzleSession` is a **per-puzzle** state machine and a new one is created for every puzzle, so
/// its `mistakes` counter resets each time. Turbo's three lives, its running target rating and its
/// score all span the run, and nothing owned them: `PuzzleRush` held only `modes`, `bestScore` and
/// `modeLabel`, so the whole of Part 14.2 existed nowhere in either language.
///
/// ## The clock is deliberately not in here
/// `secondsLeft` is derived from a start timestamp, never accumulated from ticks — the same rule
/// the rated timer follows, so a dropped or delayed tick cannot make the clock drift. The state
/// holds `startedAt` and this type answers the question; the view owns only the timer.
///
/// ## The curve, and how it differs from Streak's
/// Every constant is from `tools/metrics/puzzle_styles.json`
/// (`screens.turboRun.moduleConstants`), extracted from the RN source rather than typed from the
/// spec. Two are easy to get wrong from memory:
/// * the warmup is **5** puzzles, where `StreakEngine.warmupCount` is 10;
/// * a wrong answer still moves the target **up**, by 10. It is a rush: the run gets harder
///   whatever you do, just more slowly when you miss.
public enum TurboRun {

    // MARK: - Part 14.2, verbatim

    public static let maxMistakes = 3
    /// Streak uses 10.
    public static let warmupCount = 5
    public static let warmupRating = 600
    public static let warmupTheme = "mateIn1"
    public static let difficultyStartMax = 800
    public static let difficultyStartMin = 400
    public static let difficultyStartOffset = 500
    public static let stepCorrect = 50
    /// Still **up**, not down.
    public static let stepWrong = 10
    public static let difficultyMax = 2500

    /// Seconds per mode. `0` is the infinite sentinel — no clock at all.
    public static func totalSeconds(_ mode: Int) -> Int {
        switch mode {
        case 3: return 180
        case 5: return 300
        default: return 0
        }
    }

    /// Why a run ended. The same five cases `PuzzleProgress.RushEndReason` carries.
    public typealias Reason = PuzzleProgress.RushEndReason

    // MARK: - State

    public struct State: Equatable, Codable, Sendable {
        public var mode: Int
        public var score: Int
        public var mistakes: Int
        public var targetRating: Int
        public var puzzlesServed: Int
        /// `nil` until the FIRST puzzle appears — Part 14.2 is explicit that the clock does not run
        /// during loading, which would otherwise cost a second or two of every run.
        public var startedAt: Int?
        public var endedAt: Int?
        public var reason: Reason?
    }

    // MARK: - Transitions

    public static func start(profileRating: Int, mode: Int) -> State {
        let t = min(difficultyStartMax,
                    max(difficultyStartMin, profileRating - difficultyStartOffset))
        return State(mode: mode, score: 0, mistakes: 0, targetRating: t, puzzlesServed: 0,
                     startedAt: nil, endedAt: nil, reason: nil)
    }

    /// Restore an infinite-mode draft. The clock is irrelevant: mode 0 has none.
    public static func resume(_ draft: RushDraft) -> State {
        State(mode: 0, score: draft.score, mistakes: draft.mistakes,
              targetRating: draft.targetRating, puzzlesServed: draft.puzzlesServed,
              startedAt: nil, endedAt: nil, reason: nil)
    }

    /// The shape `PuzzleProgress.saveRushDraft` persists.
    public static func draft(_ s: State, now: Int) -> RushDraft {
        RushDraft(score: s.score, mistakes: s.mistakes, targetRating: s.targetRating,
                  puzzlesServed: s.puzzlesServed, savedAt: now)
    }

    /// What to ask the store for next.
    ///
    /// The first five puzzles are forced mate-in-1s at 600. Unlike Streak, the ramp does not run
    /// *underneath* the warmup — `targetRating` moves only on a solve or a miss, and during warmup
    /// the served rating ignores it entirely.
    public static func target(_ s: State) -> (rating: Int, theme: String?) {
        let isWarmup = s.puzzlesServed < warmupCount
        return (isWarmup ? warmupRating : s.targetRating, isWarmup ? warmupTheme : nil)
    }

    /// Count a puzzle as served, and start the clock on the first one of this sitting.
    ///
    /// The guard is `startedAt == nil` and nothing else. An earlier version also required
    /// `puzzlesServed == 1`, which is redundant on a fresh run and wrong on a resumed one — there
    /// `puzzlesServed` picks up mid-count, so the clock would never have started. Caught by the
    /// mutation suite; harmless today only because resume is infinite-only.
    public static func served(_ s: State, now: Int) -> State {
        var out = s
        out.puzzlesServed += 1
        if out.startedAt == nil { out.startedAt = now }
        return out
    }

    public static func solved(_ s: State) -> State {
        var out = s
        out.score += 1
        out.targetRating = min(difficultyMax, out.targetRating + stepCorrect)
        return out
    }

    /// A miss costs a life — and still nudges the difficulty up, by 10.
    public static func missed(_ s: State) -> State {
        var out = s
        out.mistakes += 1
        out.targetRating = min(difficultyMax, out.targetRating + stepWrong)
        return out
    }

    public static func livesLeft(_ s: State) -> Int { max(0, maxMistakes - s.mistakes) }
    public static func outOfLives(_ s: State) -> Bool { s.mistakes >= maxMistakes }

    // MARK: - The clock

    /// Seconds remaining, from the clock rather than from a tick count.
    ///
    /// `nil` in infinite mode. Before the first puzzle appears it reads the full total rather than
    /// a running value, because the run has not begun.
    public static func secondsLeft(_ s: State, now: Int) -> Int? {
        let total = totalSeconds(s.mode)
        guard total > 0 else { return nil }
        guard let started = s.startedAt else { return total }
        return max(0, total - Int((now - started) / 1000))
    }

    public static func timeUp(_ s: State, now: Int) -> Bool {
        guard s.startedAt != nil, let left = secondsLeft(s, now: now) else { return false }
        return left <= 0
    }

    /// Why the run should end right now, or `nil` to keep going.
    ///
    /// One place, so the results screen always has the real reason and cannot fall back to
    /// "Time's Up!" the way the original did (spec fix #6). Out of lives wins a tie: losing your
    /// lives is what happened, even if the clock expired in the same instant.
    public static func endReason(_ s: State, now: Int) -> Reason? {
        if outOfLives(s) { return .threeMistakes }
        if timeUp(s, now: now) { return .timeUp }
        return nil
    }

    /// Close a run. Every ending goes through here, whatever triggered it (fixes #5, #6, #13).
    ///
    /// **Idempotent.** A real sequence is: the clock expires, the screen ends the run and
    /// navigates, and the navigation then ends it again as a quit. Without this guard that writes
    /// two history rows and relabels a timed-out run "Run Ended". The first reason wins, because
    /// it is the one that actually happened.
    public static func end(_ s: State, reason: Reason, now: Int) -> State {
        guard s.reason == nil else { return s }
        var out = s
        out.reason = reason
        out.endedAt = now
        return out
    }

    /// Has this run already been closed? The screen's guard against ending it twice.
    public static func isOver(_ s: State) -> Bool { s.reason != nil }

    /// The run clock as Turbo prints it: `M:SS`, minutes **not** zero-padded.
    ///
    /// Deliberately not `PuzzleDisplay.formatTime`, which pads to `MM:SS` for the rated timer.
    /// Turbo shows `3:00` and `0:07`; the rated screen shows `03:00`. One function would silently
    /// change one of the two screens.
    public static func formatClock(_ seconds: Int?) -> String {
        guard let s = seconds else { return "∞" }
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /// Part 14.4's results title, from the real reason rather than a constant.
    public static func resultTitle(_ reason: Reason?, isNewBest: Bool) -> String {
        if isNewBest { return "New Best Score!" }
        switch reason {
        case .timeUp: return "Time's Up!"
        case .threeMistakes: return "Out of Lives!"
        default: return "Run Ended"
        }
    }
}
