import Foundation

/// The subscription entitlement and the free tier's daily usage — the pure layer.
///
/// **Foundation only, and deliberately StoreKit-free.** The parity contract keeps this module
/// engine-agnostic; `PremiumStore` in the UI layer is the one file that imports StoreKit, and it
/// hands the result down here as a plain `Snapshot`. That is what makes the whole state machine —
/// trial, expiry, grace, the clock floor, every cap — assertable without a device, a network or a
/// sandbox account.
///
/// Twin of `web-demo/js/premium.js`; `tools/qa/replay_premium.js` asserts the two agree.
///
/// ## The model, in one paragraph
///
/// Apple is the server. `Transaction.currentEntitlements` is served from the device's own
/// transaction cache and every transaction in it is a JWS Apple already signed, so the check works
/// with the radio off. What an offline device *cannot* see is a **renewal** — Apple charges the card
/// server-side and issues a new transaction the phone never receives. So a cached entitlement can
/// only ever expire, never renew, and a naive check locks out the paying customer while barely
/// inconveniencing anyone else. `graceDays` is the answer: after the cached expiry the user keeps
/// access for a bounded window, and when they next reach the App Store the real state replaces it.
///
/// Two holes are open on purpose, because closing them needs a server this app does not have:
/// a **refund** is invisible until the device syncs, and a **clock rollback** extends access.
/// `trustedNow` raises the bar on the second without closing it. See PORTING_NOTES.md.
public enum Entitlement {

    // MARK: - Constants

    /// How long access survives past a cached expiry we have not been able to refresh.
    ///
    /// Seven, not the spec's fourteen: the product is **monthly**, and fourteen days is half a
    /// billing cycle — long enough that cancelling buys you a free fortnight. Seven still covers
    /// any realistic stretch without connectivity. Deviation recorded in PORTING_NOTES.md.
    public static let graceDays = 7

    /// The introductory offer's length. Declared here so the copy and the store agree; StoreKit is
    /// the authority on whether a given Apple Account is actually eligible for it.
    public static let trialDays = 7

    /// Free Game Reviews per day. The one invented cap — see `maxUses(for:)`.
    public static let reviewsPerDay = 3

    /// Coach levels 1…2 are free; 3, 4 and 5 need the subscription. Ported from the RN original's
    /// `locked={!userIsPremium && c.id > 2}`.
    public static let freeCoachLevels = 2

    public static let msPerDay = 86_400_000

    // MARK: - Modes

    /// The keys the daily counters are bucketed by. `regular`, `streak` and `coach` are the ported
    /// `DailyLimits` modes; `review` is this feature's own.
    public enum Mode {
        public static let regular = "regular"
        public static let streak = "streak"
        public static let coach = "coach"
        public static let review = "review"

        /// Puzzle Turbo is counted **per mode** — the RN original tracked `"0"`, `"3"` and `"5"`
        /// separately, so one free run of each per day, not one run in total.
        public static func rush(_ minutes: Int) -> String { "rush_\(minutes)" }

        /// Every key a fresh install could ever write, for pruning and for the self-checks.
        public static let all: [String] = [regular, streak, coach, review,
                                           rush(0), rush(3), rush(5)]
    }

    /// Maximum uses per day for a mode.
    ///
    /// Delegates to `DailyLimits` for everything it knows — that table is pinned to the PHP oracle
    /// by 168 golden assertions and **must not** grow a mode, or the Swift map stops matching the
    /// backend it was verified against. `review` is handled here instead.
    public static func maxUses(for mode: String) -> Int {
        mode == Mode.review ? reviewsPerDay : DailyLimits.maxUses(for: mode)
    }

    // MARK: - Snapshot

    /// What the last successful look at `Transaction.currentEntitlements` saw. Persisted.
    ///
    /// `expiresAtMs` is kept even after a subscription lapses — it is what `graceDays` runs from,
    /// and clearing it would make the grace window unreachable.
    public struct Snapshot: Codable, Equatable, Sendable {
        /// The last refresh found an unexpired, verified entitlement.
        public var isSubscribed: Bool
        /// Its expiry. `nil` only when nothing has ever been seen.
        public var expiresAtMs: Int?
        /// The entitlement is an introductory (free-trial) period.
        public var isInTrial: Bool
        /// Auto-renew was ON at the last look. When it is OFF the user has deliberately ended the
        /// subscription, so the expiry is final and **no grace is given** — grace exists for the
        /// subscriber who cannot reach Apple, not for the one who cancelled.
        public var willAutoRenew: Bool
        /// When we last completed a refresh, on the trusted clock.
        public var lastVerifiedMs: Int?
        /// The highest Apple-signed timestamp ever observed. `trustedNow` never goes below it.
        public var trustedFloorMs: Int

        public init(isSubscribed: Bool = false, expiresAtMs: Int? = nil, isInTrial: Bool = false,
                    willAutoRenew: Bool = false, lastVerifiedMs: Int? = nil,
                    trustedFloorMs: Int = 0) {
            self.isSubscribed = isSubscribed
            self.expiresAtMs = expiresAtMs
            self.isInTrial = isInTrial
            self.willAutoRenew = willAutoRenew
            self.lastVerifiedMs = lastVerifiedMs
            self.trustedFloorMs = trustedFloorMs
        }

        /// A fresh install: nothing known, nothing claimed.
        public static let empty = Snapshot()
    }

    /// What the app is allowed to do right now.
    public enum Access: Equatable, Sendable {
        /// Full access. `trial` is true during the introductory period.
        case premium(trial: Bool)
        /// Full access, but the entitlement is stale and unrefreshed. Show the countdown.
        case grace(daysLeft: Int)
        /// No entitlement.
        ///
        /// The daily caps in `DailyLimits` still describe this state exactly, and the parity
        /// suite still pins them — but since the round-4 trial gate the SHELL no longer lets a
        /// `.free` user reach a screen that could consume one. They are what a LAPSED
        /// subscriber's counters mean, not a playable tier. The gate is `PhoneApp.locked` in
        /// Swift and `locked()` in `web-demo/js/app.js`; see `docs/subscription.md`.
        case free

        /// Everything premium unlocks is unlocked in `.grace` too. One predicate, so no gate has to
        /// remember to handle two cases.
        public var isPremium: Bool {
            switch self {
            case .premium, .grace: return true
            case .free: return false
            }
        }
    }

    // MARK: - The clock

    /// The clock, floored by the highest Apple-signed timestamp we have ever seen.
    ///
    /// Device time is attacker-controlled: airplane mode plus a back-dated clock would otherwise
    /// extend a lapsed subscription forever. Every StoreKit transaction carries a server-signed
    /// `signedDate`, so the newest one we have observed is a lower bound on "now" that the user
    /// cannot forge. This does not stop a clock moved *forward* — that only expires them sooner,
    /// and buys a few extra free-tier puzzles, which is not worth defending against.
    public static func trustedNow(deviceNow: Int, floor: Int) -> Int {
        max(deviceNow, floor)
    }

    // MARK: - Resolve

    /// The whole state machine. The only place these rules live.
    public static func resolve(_ s: Snapshot, now: Int) -> Access {
        let t = trustedNow(deviceNow: now, floor: s.trustedFloorMs)

        // FAIL CLOSED. An auto-renewable subscription always carries an expiry, so a snapshot
        // claiming one without a date is not something StoreKit produced — it is a fresh install,
        // a half-written file, or a hand-edited one. Trusting `isSubscribed` on its own would hand
        // out permanent premium to anyone who can write two words into a plist.
        guard let expiry = s.expiresAtMs else { return .free }

        if t < expiry {
            return s.isSubscribed ? .premium(trial: s.isInTrial) : .free
        }

        // The cached entitlement has lapsed. Auto-renew OFF means the user turned it off and knew
        // this date was coming; the expiry is final.
        guard s.willAutoRenew else { return .free }

        let graceEnd = expiry + graceDays * msPerDay
        guard t < graceEnd else { return .free }
        return .grace(daysLeft: daysRemaining(untilMs: graceEnd, nowMs: t))
    }

    /// Whole days from `now` to `until`, rounded **up**, on calendar-day boundaries.
    ///
    /// Rounded up and floored at 1 while any time remains, because the server truncated a float:
    /// 27.9 days displayed as "27 days remaining", and anything inside the last 24 hours displayed
    /// "0 days remaining" to a subscriber who still had access.
    public static func daysRemaining(untilMs: Int, nowMs: Int,
                                     calendar: Calendar = .current) -> Int {
        guard untilMs > nowMs else { return 0 }
        let from = calendar.startOfDay(for: date(nowMs))
        let to = calendar.startOfDay(for: date(untilMs))
        let whole = calendar.dateComponents([.day], from: from, to: to).day ?? 0
        return max(1, whole)
    }

    static func date(_ ms: Int) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000.0) }

    // MARK: - Feature gates that are not counted

    /// Thematic Puzzles are premium-only — a hard gate with no counter, as in the RN original.
    public static func isThematicLocked(isPremium: Bool) -> Bool { !isPremium }

    /// Coaches 3, 4 and 5 are premium.
    public static func isCoachLocked(level: Int, isPremium: Bool) -> Bool {
        !isPremium && level > freeCoachLevels
    }

    /// The Swiss round ceiling. Round-robin derives its own count from the player list, and the
    /// player count is deliberately NOT capped — `TournamentEngine.freeMaxPlayers` was enforced by
    /// the PHP controller, never by the client, and there is no server here.
    public static func maxSwissRounds(isPremium: Bool) -> Int {
        TournamentEngine.swissTotalRounds(requested: TournamentEngine.premiumMaxRounds,
                                          isPremium: isPremium)
    }

    // MARK: - Daily usage

    /// The free tier's per-day counters, bucketed by local day and mode. Persisted **separately**
    /// from `PuzzleProgressState`: that struct decodes with a bare `try?` and synthesized `Codable`,
    /// so adding a field to it would make every existing save file fail to decode and silently
    /// reset the user's rating, history and streaks.
    public struct Usage: Codable, Equatable, Sendable {
        /// `"yyyy-MM-dd|mode"` → count.
        public var counts: [String: Int]

        public init(counts: [String: Int] = [:]) { self.counts = counts }

        public static let empty = Usage()
    }

    public static func usageKey(day: String, mode: String) -> String { "\(day)|\(mode)" }

    /// The local-day key, reusing the one `DailyLimits` and `PuzzleProgress` already share.
    public static func dayKey(_ nowMs: Int, calendar: Calendar = .current) -> String {
        DailyLimits.dayKey(for: date(nowMs), calendar: calendar)
    }

    public static func used(_ u: Usage, mode: String, now: Int,
                            calendar: Calendar = .current) -> Int {
        u.counts[usageKey(day: dayKey(now, calendar: calendar), mode: mode)] ?? 0
    }

    /// Records one use and returns the new count.
    ///
    /// Called when a run **starts**, never when a puzzle is solved — the RN original bumped after
    /// the puzzle was fetched, so a failed attempt still consumes a free use. That is also why the
    /// daily-goal ring (`PuzzleProgress.dailySolves`) cannot double as this counter: it counts
    /// correct solves.
    @discardableResult
    public static func record(_ u: inout Usage, mode: String, now: Int,
                              calendar: Calendar = .current) -> Int {
        let k = usageKey(day: dayKey(now, calendar: calendar), mode: mode)
        let next = (u.counts[k] ?? 0) + 1
        u.counts[k] = next
        prune(&u, now: now, calendar: calendar)
        return next
    }

    /// Whether the free tier is exhausted for this mode today. Premium always passes.
    public static func isAtLimit(_ u: Usage, mode: String, isPremium: Bool, now: Int,
                                 calendar: Calendar = .current) -> Bool {
        if isPremium { return false }
        if mode == Mode.review {
            return used(u, mode: mode, now: now, calendar: calendar) >= reviewsPerDay
        }
        // Everything else goes through the PHP-pinned table, `>=` and all.
        return DailyLimits.isAtDailyLimit(mode: mode,
                                          usedToday: used(u, mode: mode, now: now, calendar: calendar),
                                          isPremium: false)
    }

    /// Uses left today, or `nil` when unlimited.
    public static func remaining(_ u: Usage, mode: String, isPremium: Bool, now: Int,
                                 calendar: Calendar = .current) -> Int? {
        if isPremium { return nil }
        let left = maxUses(for: mode) - used(u, mode: mode, now: now, calendar: calendar)
        return max(0, left)
    }

    /// Drops every day but today and yesterday. Without this the dictionary grows forever, the way
    /// `PuzzleProgress.dailySolves` does — and unlike that one, nothing here ever reads history.
    public static func prune(_ u: inout Usage, now: Int, calendar: Calendar = .current) {
        let today = dayKey(now, calendar: calendar)
        let yesterday = dayKey(now - msPerDay, calendar: calendar)
        u.counts = u.counts.filter { entry in
            let day = entry.key.split(separator: "|", maxSplits: 1).first.map(String.init) ?? ""
            return day == today || day == yesterday
        }
    }
}
