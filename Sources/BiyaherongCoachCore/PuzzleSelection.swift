import Foundation

/// The four offline puzzle selectors (Puzzle Hub spec, Part 7).
///
/// Twin of `web-demo/js/puzzle-store.js`.
///
/// ## Division of labour
/// `PuzzleServing` owns the **ladder** — which tier runs in what order and with which predicate.
/// It is pinned by the `serving` golden group against the real Laravel controllers and must not
/// change. It is also array-based, which the 93,000-row bundle cannot be. This file expresses the
/// same three ladders over an abstract `PuzzlePool`, so the device can answer each tier with an
/// index seek instead of loading the corpus into memory; `ArrayPool` below implements that
/// protocol by calling `PuzzleServing`'s own helpers, which is what makes the differential check
/// in the parity suite meaningful rather than circular.
///
/// ## Spec fix #7, and why it belongs here
/// The Laravel version wiped the user's *entire* `user_seen_puzzles` table whenever any single
/// query ran dry, so exhausting one narrow theme reset non-repetition for every mode at once. The
/// fix is to scope the wipe, and it lands here rather than in the ladder because the ladder never
/// wiped anything: it takes `seen` as an argument and *reports* `didReset` as a flag. The pinned
/// engine therefore stays byte-identical and only the caller changes.
///
/// ## Prefetching (7.6)
/// There is none. The original kept a 20-deep buffer in rated mode and a 12-deep buffer with six
/// parallel HTTP fetches in Turbo, purely to hide network latency; a local read is sub-
/// millisecond. Turbo's single lookahead needs no API — it calls `nextStreak` while the current
/// puzzle is on screen and holds the one result. A queue would reintroduce the double-serve the
/// seen set exists to prevent.
public enum PuzzleSelection {

    public typealias Candidate = PuzzleServing.Candidate
    public typealias Stage = PuzzleServing.Stage
    public typealias Selection = PuzzleServing.Selection
    public typealias Picker = PuzzleServing.Picker

    // MARK: - The pool

    /// The three queries a ladder needs, plus the two the scoped wipe needs.
    ///
    /// Deliberately tiny. Everything above it is shared between the SQLite bundle and the
    /// in-memory array, and the only thing that differs is where the candidates come from.
    public protocol PuzzlePool {
        /// Total puzzles, used to decide whether the corpus is genuinely exhausted.
        var count: Int { get }
        /// Tier 1: unseen, inside `center ± window`, matching the theme filter. Inclusive ends.
        func windowUnseen(center: Int, window: Int, theme: String?, seen: Set<Int>) -> [Candidate]
        /// Tier 2: unseen, matching the theme filter, no rating window.
        func anyUnseen(theme: String?, seen: Set<Int>) -> [Candidate]
        /// Tier 3: nearest by |rating − center| over everything, ties broken by ascending id.
        func closest(center: Int, theme: String?) -> Candidate?
        /// Every id carrying a theme — the scope of a themed Tier-3 wipe.
        func ids(theme: String) -> [Int]
        /// Every id in a rating band — the scope of an unthemed Tier-3 wipe.
        func ids(from lo: Int, to hi: Int) -> [Int]
    }

    /// A pool over an in-memory array, implemented by delegating to `PuzzleServing`'s pinned
    /// helpers. Used by the demo, by the drafts path, and by the parity suite.
    public struct ArrayPool: PuzzlePool {
        public let candidates: [Candidate]
        public init(_ candidates: [Candidate]) { self.candidates = candidates }

        public var count: Int { candidates.count }

        public func windowUnseen(center: Int, window: Int, theme: String?,
                                 seen: Set<Int>) -> [Candidate] {
            PuzzleServing.eligibleInWindow(candidates, center: center, window: window,
                                           theme: theme, seen: seen)
        }
        public func anyUnseen(theme: String?, seen: Set<Int>) -> [Candidate] {
            PuzzleServing.eligibleUnseen(candidates, theme: theme, seen: seen)
        }
        public func closest(center: Int, theme: String?) -> Candidate? {
            PuzzleServing.closestByAbs(candidates, center: center, theme: theme)
        }
        public func ids(theme: String) -> [Int] {
            candidates.filter { $0.themes.contains(theme) }.map { $0.id }
        }
        public func ids(from lo: Int, to hi: Int) -> [Int] {
            candidates.filter { $0.rating >= lo && $0.rating <= hi }.map { $0.id }
        }
    }

    // MARK: - The ladders, over a pool

    /// Play Puzzles (7.2): unseen ±100 random → any unseen random → reset, ±100 ?? any random.
    public static func serveRandom(_ pool: some PuzzlePool, center: Int, window: Int,
                                   theme: String?, seen: Set<Int>,
                                   pick: Picker = PuzzleServing.lowestIdPicker) -> Selection {
        if let hit = pick(pool.windowUnseen(center: center, window: window, theme: theme, seen: seen)) {
            return Selection(candidate: hit, stage: .windowUnseen, didReset: false)
        }
        if let hit = pick(pool.anyUnseen(theme: theme, seen: seen)) {
            return Selection(candidate: hit, stage: .anyUnseenRandom, didReset: false)
        }
        // The reset is UNCONDITIONAL in PHP — the seen rows are deleted before the stage-3 query.
        if let hit = pick(pool.windowUnseen(center: center, window: window, theme: theme, seen: [])) {
            return Selection(candidate: hit, stage: .afterResetRandom, didReset: true)
        }
        if let hit = pick(pool.anyUnseen(theme: theme, seen: [])) {
            return Selection(candidate: hit, stage: .afterResetRandom, didReset: true)
        }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }

    /// Streak / Turbo (7.3): unseen ±50 random → any unseen CLOSEST → reset, CLOSEST.
    public static func serveClosest(_ pool: some PuzzlePool, center: Int, window: Int,
                                    theme: String?, seen: Set<Int>,
                                    pick: Picker = PuzzleServing.lowestIdPicker) -> Selection {
        if let hit = pick(pool.windowUnseen(center: center, window: window, theme: theme, seen: seen)) {
            return Selection(candidate: hit, stage: .windowUnseen, didReset: false)
        }
        let s2 = pool.anyUnseen(theme: theme, seen: seen)
        if !s2.isEmpty,
           let near = PuzzleServing.closestByAbs(s2, center: center, theme: theme) {
            return Selection(candidate: near, stage: .anyUnseenClosest, didReset: false)
        }
        if let after = pool.closest(center: center, theme: theme) {
            return Selection(candidate: after, stage: .afterResetClosest, didReset: true)
        }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }

    /// Thematic (7.4) — the hybrid: unseen ±200 random → any unseen random → reset, CLOSEST.
    public static func serveThematic(_ pool: some PuzzlePool, center: Int,
                                     window: Int = PuzzleServing.thematicWindow,
                                     theme: String, seen: Set<Int>,
                                     pick: Picker = PuzzleServing.lowestIdPicker) -> Selection {
        if let hit = pick(pool.windowUnseen(center: center, window: window, theme: theme, seen: seen)) {
            return Selection(candidate: hit, stage: .windowUnseen, didReset: false)
        }
        if let hit = pick(pool.anyUnseen(theme: theme, seen: seen)) {
            return Selection(candidate: hit, stage: .anyUnseenRandom, didReset: false)
        }
        if let after = pool.closest(center: center, theme: theme) {
            return Selection(candidate: after, stage: .afterResetClosest, didReset: true)
        }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }

    // MARK: - The Tier-3 scope (spec fix #7)

    /// What the caller may forget when the ladder reports `didReset`.
    public enum Scope: Equatable, Sendable {
        /// A theme filter was in play — forget only that theme.
        case theme(String)
        /// No theme — forget only this rating band.
        case window(lo: Int, hi: Int)
        /// The unscoped pool is genuinely exhausted.
        case all
    }

    /// Pure, so the decision is assertable on its own rather than only through its side effect.
    public static func scopeForReset(theme: String?, center: Int, window: Int,
                                     seenCount: Int, corpusCount: Int) -> Scope {
        if corpusCount > 0 && seenCount >= corpusCount { return .all }
        if let t = theme { return .theme(t) }
        return .window(lo: center - window, hi: center + window)
    }

    /// Applies a scope to a seen set. Returns how many ids it removed.
    @discardableResult
    public static func forget(_ scope: Scope, from seen: inout Set<Int>,
                              in pool: some PuzzlePool) -> Int {
        switch scope {
        case .all:
            let n = seen.count
            seen.removeAll()
            return n
        case .theme(let t):
            return remove(pool.ids(theme: t), from: &seen)
        case .window(let lo, let hi):
            return remove(pool.ids(from: lo, to: hi), from: &seen)
        }
    }

    private static func remove(_ ids: [Int], from seen: inout Set<Int>) -> Int {
        var removed = 0
        for id in ids where seen.remove(id) != nil { removed += 1 }
        return removed
    }

    // MARK: - The daily puzzle (7.5 / 11.1)

    /// The daily epoch. Fixed forever: moving it shifts every past and future date.
    public static let dailyEpoch = DateComponents(year: 2026, month: 1, day: 1)

    /// Days since the epoch on the **local** calendar (spec fix #1).
    ///
    /// The original computed dates with `new Date().toISOString().split('T')[0]`, i.e. UTC, so in
    /// Manila (UTC+8) the daily puzzle and every daily counter rolled over at 8 a.m. local while
    /// the UI said "resets at midnight". `Calendar.startOfDay` also makes this DST-correct, which
    /// naive millisecond arithmetic is not.
    public static func daysSinceEpoch(_ date: Date, calendar: Calendar = .current) -> Int {
        guard let epoch = calendar.date(from: dailyEpoch) else { return 0 }
        let a = calendar.startOfDay(for: epoch)
        let b = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: a, to: b).day ?? 0
    }

    /// `((n % count) + count) % count` — the double modulo keeps dates before the epoch in range.
    public static func dailyIndex(_ date: Date, poolCount: Int,
                                  calendar: Calendar = .current) -> Int {
        guard poolCount > 0 else { return 0 }
        let n = daysSinceEpoch(date, calendar: calendar)
        return ((n % poolCount) + poolCount) % poolCount
    }

    // MARK: - The 12 UI themes (Part 12.1)

    /// Ids only, in grid order. The labels and tile colours are view data and live with the screen.
    public static let uiThemes = ["hangingPiece", "crushing", "fork", "pin", "skewer",
                                  "discoveredAttack", "advantage", "endgame", "backRankMate",
                                  "mateIn1", "mateIn2", "middlegame"]
}
