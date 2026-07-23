import Foundation

/// Puzzle serving policy (Appendix C §4 — verified against `PuzzleController` / `StreakController`).
///
/// The `inRandomOrder()` DB primitive is non-deterministic and cannot be pinned by golden
/// vectors, so it is modelled as an INJECTED picker (`Picker`). The deterministic pieces —
/// the rating-window predicate, the closest-by-ABS ordering, and the fallback-ladder stage
/// transitions — are fully testable and are what these functions expose.
public enum PuzzleServing {

    /// Minimal puzzle shape needed for serving decisions.
    public struct Candidate: Equatable, Codable {
        public let id: Int
        public let rating: Int
        public let themes: [String]
        public init(id: Int, rating: Int, themes: [String]) {
            self.id = id; self.rating = rating; self.themes = themes
        }
    }

    /// Serving windows (± rating).
    public static let regularWindow = 100
    public static let streakWindow = 50
    public static let thematicWindow = 200

    /// `whereBetween('rating', [center-window, center+window])` — inclusive both ends,
    /// optional `whereJsonContains('themes', theme)`, and unseen filter.
    public static func eligibleInWindow(_ pool: [Candidate], center: Int, window: Int,
                                        theme: String?, seen: Set<Int>) -> [Candidate] {
        let lo = center - window, hi = center + window
        return pool.filter { c in
            c.rating >= lo && c.rating <= hi
                && (theme == nil || c.themes.contains(theme!))
                && !seen.contains(c.id)
        }
    }

    /// Any unseen puzzle (optional theme filter), no window.
    public static func eligibleUnseen(_ pool: [Candidate], theme: String?, seen: Set<Int>) -> [Candidate] {
        pool.filter { c in (theme == nil || c.themes.contains(theme!)) && !seen.contains(c.id) }
    }

    /// `orderByRaw('ABS(rating - ?)')->first()` — closest by absolute rating distance,
    /// ties broken by ascending id (DB natural order). Optional theme filter, ignores `seen`.
    public static func closestByAbs(_ pool: [Candidate], center: Int, theme: String?) -> Candidate? {
        pool
            .filter { theme == nil || $0.themes.contains(theme!) }
            .min { a, b in
                let da = abs(a.rating - center), db = abs(b.rating - center)
                return da != db ? da < db : a.id < b.id
            }
    }

    /// Which stage of the fallback ladder produced the puzzle.
    public enum Stage: String, Equatable, Codable {
        case windowUnseen      // stage 1: unseen within window
        case anyUnseenRandom   // stage 2a: any unseen, random (regular/thematic branch)
        case anyUnseenClosest  // stage 2b: any unseen, closest-by-ABS (streak branch)
        case afterResetRandom  // stage 3a: reset seen, then window-random / any-random
        case afterResetClosest // stage 3b: reset seen, then closest-by-ABS
        case none              // pool exhausted
    }

    public struct Selection: Equatable, Codable {
        public let candidate: Candidate?
        public let stage: Stage
        public let didReset: Bool
    }

    /// A picker resolves `inRandomOrder()->first()` over an eligible set. Tests inject a
    /// deterministic picker (e.g. lowest id); the app injects a real random pick.
    public typealias Picker = @Sendable ([Candidate]) -> Candidate?

    /// Deterministic picker: lowest id first. Used by golden tests to make the ladder testable.
    public static let lowestIdPicker: Picker = { $0.min { $0.id < $1.id } }

    /// Streak / rush serving ladder (`assignPuzzle` / random branch with `streak_rating`):
    ///   1. unseen within ±window (random pick)
    ///   2. any unseen, CLOSEST by ABS
    ///   3. reset seen, then CLOSEST by ABS
    ///
    /// Note: the reset in stage 3 happens UNCONDITIONALLY in PHP (the seen rows are deleted
    /// before the stage-3 query), so `didReset` is true whenever stages 1 & 2 both miss —
    /// even when the pool is empty and no puzzle is returned.
    public static func serveClosest(_ pool: [Candidate], center: Int, window: Int, theme: String?,
                                    seen: Set<Int>, pick: Picker = lowestIdPicker) -> Selection {
        let s1 = eligibleInWindow(pool, center: center, window: window, theme: theme, seen: seen)
        if let hit = pick(s1) { return Selection(candidate: hit, stage: .windowUnseen, didReset: false) }
        let s2 = eligibleUnseen(pool, theme: theme, seen: seen)
        if !s2.isEmpty, let hit = closestByAbs(s2, center: center, theme: theme) {
            return Selection(candidate: hit, stage: .anyUnseenClosest, didReset: false)
        }
        // reset (unconditional): all seen becomes unseen
        if let hit = closestByAbs(pool, center: center, theme: theme) {
            return Selection(candidate: hit, stage: .afterResetClosest, didReset: true)
        }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }

    /// Regular Play-Puzzle serving ladder (`getRandomPuzzle` regular branch):
    ///   1. unseen within ±100 (random)
    ///   2. any unseen (random)
    ///   3. reset seen, then ±100 (random) ?? any (random)
    public static func serveRandom(_ pool: [Candidate], center: Int, window: Int, theme: String?,
                                   seen: Set<Int>, pick: Picker = lowestIdPicker) -> Selection {
        let s1 = eligibleInWindow(pool, center: center, window: window, theme: theme, seen: seen)
        if let hit = pick(s1) { return Selection(candidate: hit, stage: .windowUnseen, didReset: false) }
        let s2 = eligibleUnseen(pool, theme: theme, seen: seen)
        if let hit = pick(s2) { return Selection(candidate: hit, stage: .anyUnseenRandom, didReset: false) }
        // reset (unconditional)
        let s3 = eligibleInWindow(pool, center: center, window: window, theme: theme, seen: [])
        if let hit = pick(s3) { return Selection(candidate: hit, stage: .afterResetRandom, didReset: true) }
        let anyAll = eligibleUnseen(pool, theme: theme, seen: [])
        if let hit = pick(anyAll) { return Selection(candidate: hit, stage: .afterResetRandom, didReset: true) }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }

    /// Thematic serving ladder (`getThematicPuzzle`) — a HYBRID distinct from the other two:
    ///   1. unseen within ±200 (random)
    ///   2. any unseen with the theme (random)
    ///   3. reset seen, then CLOSEST by ABS (deterministic)
    public static func serveThematic(_ pool: [Candidate], center: Int, window: Int = thematicWindow,
                                     theme: String?, seen: Set<Int>, pick: Picker = lowestIdPicker) -> Selection {
        let s1 = eligibleInWindow(pool, center: center, window: window, theme: theme, seen: seen)
        if let hit = pick(s1) { return Selection(candidate: hit, stage: .windowUnseen, didReset: false) }
        let s2 = eligibleUnseen(pool, theme: theme, seen: seen)
        if let hit = pick(s2) { return Selection(candidate: hit, stage: .anyUnseenRandom, didReset: false) }
        // reset (unconditional), then closest-by-ABS
        if let hit = closestByAbs(pool, center: center, theme: theme) {
            return Selection(candidate: hit, stage: .afterResetClosest, didReset: true)
        }
        return Selection(candidate: nil, stage: .none, didReset: true)
    }
}
