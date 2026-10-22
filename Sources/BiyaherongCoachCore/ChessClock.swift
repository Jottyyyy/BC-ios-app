import Foundation

// MARK: - Chess Clock (client round 3, 2026-10-22)
//
// A two-player clock for over-the-board games: each player taps their own half after moving.
//
// There is no source for this in the RN app or the Laravel backend — it is the one feature in the
// port with no original, added at the client's request — so there is no PHP oracle. Its
// differential partner is `web-demo/js/chess-clock.js`: `tools/qa/chess_clock_check.js` replays
// the `chess_clock` group's scripts (Sources/ParityRunner/main.swift) through that file, so every
// expectation written there has been EXECUTED, not just typed. Every constant is recorded as
// invented in PORTING_NOTES.md.
//
// Pure and deterministic: no timers, no `Date()`. Every operation takes `now` in milliseconds from
// a monotonic source the caller owns, so the whole state machine is replayable from a script.

/// The two physical halves of the phone. Not colours: whoever's clock runs first is White, and that
/// is only known once somebody presses.
public enum ClockSide: String, CaseIterable, Codable, Sendable {
    case top, bottom
    public var other: ClockSide { self == .top ? .bottom : .top }
}

/// What a game is played at: a base time per player and an optional per-move bonus.
public struct TimeControl: Equatable, Hashable, Codable, Sendable {

    public enum Bonus: String, CaseIterable, Codable, Sendable {
        /// Sudden death.
        case none
        /// Fischer: added to the mover's clock after every completed move.
        case increment
        /// Simple (US) delay: each turn's first N seconds are not charged. Unused delay is lost.
        case delay
    }

    /// Lichess's speed bands, by estimated game length — the names players already use.
    public enum Category: String, CaseIterable, Codable, Sendable {
        case bullet, blitz, rapid, classical
        public var label: String {
            switch self {
            case .bullet: return "Bullet"
            case .blitz: return "Blitz"
            case .rapid: return "Rapid"
            case .classical: return "Classical"
            }
        }
    }

    /// Per half, so a coach can give odds ("you 5 minutes, me 1").
    public var topSeconds: Int
    public var bottomSeconds: Int
    public var bonus: Bonus
    public var bonusSeconds: Int

    public init(topSeconds: Int, bottomSeconds: Int, bonus: Bonus = .none, bonusSeconds: Int = 0) {
        self.topSeconds = topSeconds
        self.bottomSeconds = bottomSeconds
        self.bonus = bonus
        self.bonusSeconds = bonusSeconds
    }

    /// The same time for both players, Fischer increment — how every preset is written.
    public init(minutes: Int, increment: Int) {
        self.init(topSeconds: minutes * 60, bottomSeconds: minutes * 60,
                  bonus: increment > 0 ? .increment : .none, bonusSeconds: increment)
    }

    // ---- limits (INVENTED; PORTING_NOTES.md) ----
    public static let minSeconds = 1
    public static let maxSeconds = 9 * 3600 + 59 * 60 + 59        // 9:59:59
    public static let maxBonusSeconds = 60
    /// Lichess's estimate: base + 40 x bonus, in seconds.
    public static let estimateMoves = 40
    public static let blitzFromSeconds = 180
    public static let rapidFromSeconds = 480
    public static let classicalFromSeconds = 1500

    public static let `default` = TimeControl(minutes: 5, increment: 3)

    /// Bullet 1|0 … Classical 90|30, in display order. Each one's `category` is its own section —
    /// `chess_clock_check.js` asserts it, so a preset can never sit under the wrong heading.
    public static let presets: [TimeControl] = [
        TimeControl(minutes: 1, increment: 0), TimeControl(minutes: 1, increment: 1),
        TimeControl(minutes: 2, increment: 1),
        TimeControl(minutes: 3, increment: 0), TimeControl(minutes: 3, increment: 2),
        TimeControl(minutes: 5, increment: 0), TimeControl(minutes: 5, increment: 3),
        TimeControl(minutes: 10, increment: 0), TimeControl(minutes: 10, increment: 5),
        TimeControl(minutes: 15, increment: 10), TimeControl(minutes: 20, increment: 0),
        TimeControl(minutes: 30, increment: 0), TimeControl(minutes: 30, increment: 20),
        TimeControl(minutes: 60, increment: 30), TimeControl(minutes: 90, increment: 30),
    ]

    public func seconds(_ side: ClockSide) -> Int { side == .top ? topSeconds : bottomSeconds }

    /// Different base times — the handicap toggle's state.
    public var isOdds: Bool { topSeconds != bottomSeconds }

    /// The bonus that actually applies: `.none` carries no seconds, and zero seconds is no bonus.
    public var effectiveBonusSeconds: Int { bonus == .none ? 0 : bonusSeconds }

    /// Every field inside its limit. A bonus of zero seconds is stored as `.none`, so two controls
    /// that play identically also compare equal.
    public func clamped() -> TimeControl {
        let clamp = { (s: Int) in min(max(s, TimeControl.minSeconds), TimeControl.maxSeconds) }
        let b = min(max(bonusSeconds, 0), TimeControl.maxBonusSeconds)
        return TimeControl(topSeconds: clamp(topSeconds), bottomSeconds: clamp(bottomSeconds),
                           bonus: b == 0 ? .none : bonus, bonusSeconds: b == 0 ? 0 : b)
    }

    public var category: Category {
        let estimate = max(topSeconds, bottomSeconds)
            + TimeControl.estimateMoves * effectiveBonusSeconds
        if estimate < TimeControl.blitzFromSeconds { return .bullet }
        if estimate < TimeControl.rapidFromSeconds { return .blitz }
        if estimate < TimeControl.classicalFromSeconds { return .rapid }
        return .classical
    }

    /// `5 | 3`, `1:30 | 0`, `5 | d3` for a delay, `5 / 1 | 3` for odds (top first).
    public var label: String {
        let base = isOdds ? TimeControl.baseText(topSeconds) + " / " + TimeControl.baseText(bottomSeconds)
                          : TimeControl.baseText(topSeconds)
        let bonusText: String
        switch bonus {
        case .none: bonusText = "0"
        case .increment: bonusText = String(bonusSeconds)
        case .delay: bonusText = "d" + String(bonusSeconds)
        }
        return base + " | " + (effectiveBonusSeconds == 0 ? "0" : bonusText)
    }

    /// Whole minutes as a bare number (`5`), anything else as `m:ss` or `h:mm:ss`.
    public static func baseText(_ seconds: Int) -> String {
        seconds % 60 == 0 ? String(seconds / 60) : ClockFormat.wholeSeconds(seconds)
    }
}

/// The clock itself. A value type: the screen holds one and replaces it on every event.
public struct ChessClock: Equatable, Sendable {

    public enum Status: String, Equatable, Sendable {
        /// Set up and waiting for the first press.
        case ready
        case running
        case paused
        /// A flag fell. Terminal until `reset`.
        case flagged
    }

    public private(set) var control: TimeControl
    public private(set) var status: Status = .ready
    /// Whose clock is running — or was, while paused. `nil` only while `ready`.
    public private(set) var active: ClockSide?
    /// The side playing White: the one whose clock the first press started.
    public private(set) var white: ClockSide?
    /// The side whose flag fell.
    public private(set) var flagged: ClockSide?
    public private(set) var topMoves = 0
    public private(set) var bottomMoves = 0
    /// The side that just completed a move and was paid an increment for it, so the screen can
    /// show "+3s" beside it. Cleared by the next press, a reset or a flag.
    public private(set) var lastBonused: ClockSide?

    /// Each side's time at the start of its current turn (the inactive side's is simply its time).
    private var topBank: Int
    private var bottomBank: Int
    /// Time the active side spent in this turn before the current running stretch — what carries a
    /// delay across a pause instead of handing out a fresh one on resume.
    private var turnUsedMs = 0
    /// When the current running stretch began; `nil` unless running.
    private var segmentStart: Int?

    public init(control: TimeControl = .default) {
        let c = control.clamped()
        self.control = c
        topBank = c.topSeconds * 1000
        bottomBank = c.bottomSeconds * 1000
    }

    public func moves(_ side: ClockSide) -> Int { side == .top ? topMoves : bottomMoves }

    /// Milliseconds left on `side` at `now`. Never negative.
    public func remainingMs(_ side: ClockSide, at now: Int) -> Int {
        let bank = side == .top ? topBank : bottomBank
        guard side == active, status == .running || status == .paused else { return max(0, bank) }
        return max(0, bank - chargedMs(at: now))
    }

    /// While a delay is still being used up, the time that remains of it — the screen shows it.
    public func delayLeftMs(at now: Int) -> Int {
        guard control.bonus == .delay, status == .running || status == .paused else { return 0 }
        return max(0, control.effectiveBonusSeconds * 1000 - turnElapsedMs(at: now))
    }

    // MARK: Events

    /// A player taps their half: they have moved.
    ///
    /// From `ready`, either half starts the OTHER half's clock, and that side is White. While
    /// running, only the side whose clock is running can end its turn — a tap on the waiting half
    /// does nothing, which is what makes a double-tap or the opponent's stray hand harmless.
    /// Returns whether anything happened.
    @discardableResult
    public mutating func press(_ side: ClockSide, at now: Int) -> Bool {
        switch status {
        case .ready:
            active = side.other
            white = side.other
            status = .running
            turnUsedMs = 0
            segmentStart = now
            lastBonused = nil
            return true
        case .running:
            guard side == active else { return false }
            if tick(at: now) { return false }
            let left = remainingMs(side, at: now)
            let bonus = control.bonus == .increment ? control.effectiveBonusSeconds * 1000 : 0
            setBank(side, left + bonus)
            if side == .top { topMoves += 1 } else { bottomMoves += 1 }
            lastBonused = bonus > 0 ? side : nil
            active = side.other
            turnUsedMs = 0
            segmentStart = now
            return true
        case .paused, .flagged:
            return false
        }
    }

    /// Checks the running clock for a fallen flag. Returns true exactly when this call raised it.
    @discardableResult
    public mutating func tick(at now: Int) -> Bool {
        guard status == .running, let side = active, remainingMs(side, at: now) <= 0 else { return false }
        setBank(side, 0)
        status = .flagged
        flagged = side
        segmentStart = nil
        lastBonused = nil
        return true
    }

    public mutating func pause(at now: Int) {
        guard status == .running, !tick(at: now), let start = segmentStart else { return }
        turnUsedMs += max(0, now - start)
        segmentStart = nil
        status = .paused
    }

    public mutating func resume(at now: Int) {
        guard status == .paused else { return }
        segmentStart = now
        status = .running
    }

    /// Back to the start of the same control.
    public mutating func reset() { self = ChessClock(control: control) }

    /// A new control always starts a new game: changing time mid-game is not a feature, it is a bug.
    public mutating func setControl(_ c: TimeControl) { self = ChessClock(control: c) }

    // MARK: Internals

    private func turnElapsedMs(at now: Int) -> Int {
        turnUsedMs + (segmentStart.map { max(0, now - $0) } ?? 0)
    }

    /// What this turn has cost so far: all of it, or all but the delay.
    private func chargedMs(at now: Int) -> Int {
        let used = turnElapsedMs(at: now)
        guard control.bonus == .delay else { return used }
        return max(0, used - control.effectiveBonusSeconds * 1000)
    }

    private mutating func setBank(_ side: ClockSide, _ ms: Int) {
        if side == .top { topBank = ms } else { bottomBank = ms }
    }
}

/// How a clock reads. Both rules a player relies on are here: it never shows `0:00` with time
/// left, and the last ten seconds show tenths.
public enum ClockFormat {
    /// Below this the display shows tenths (`0:09.8`). INVENTED.
    public static let tenthsBelowMs = 10_000
    /// Amber at or below this — the same 30 s Puzzle Turbo turns its clock amber at
    /// (RN `rush-game.tsx`), so the app has one idea of "running low".
    public static let lowAtMs = 30_000
    /// Red at or below this — Turbo's 10 s.
    public static let criticalAtMs = 10_000

    public enum Level: String, Equatable, Sendable { case normal, low, critical }

    /// Rounded UP, so the display reaches `0:00.0` only when the flag falls.
    public static func display(_ ms: Int) -> String {
        let t = max(0, ms)
        let tenths = (t + 99) / 100
        if tenths < tenthsBelowMs / 100 {
            return "0:" + pad2(tenths / 10) + "." + String(tenths % 10)
        }
        return wholeSeconds((t + 999) / 1000)
    }

    /// `m:ss`, or `h:mm:ss` from an hour up.
    public static func wholeSeconds(_ seconds: Int) -> String {
        let s = max(0, seconds)
        if s >= 3600 { return String(s / 3600) + ":" + pad2(s % 3600 / 60) + ":" + pad2(s % 60) }
        return String(s / 60) + ":" + pad2(s % 60)
    }

    public static func level(_ ms: Int) -> Level {
        if ms <= criticalAtMs { return .critical }
        if ms <= lowAtMs { return .low }
        return .normal
    }

    private static func pad2(_ n: Int) -> String { n < 10 ? "0" + String(n) : String(n) }
}
