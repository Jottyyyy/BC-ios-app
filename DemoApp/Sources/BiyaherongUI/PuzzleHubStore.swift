import Foundation
import SwiftUI
import BiyaherongCoachCore

/// The Puzzle Hub's single source of truth — the Swift twin of `web-demo/js/puzzle-app.js`.
///
/// ## Why this exists
/// Before it, five Core engines had **no caller at all**: `PuzzleProgress`, `TurboRun`,
/// `PuzzleStats`, `DailyGoal` and `PuzzleServing` were written, pinned against PHP goldens, and
/// rendered by nothing. That is the same failure that hid the dead `StreakEngine.increment` in
/// Phase D, at the scale of a whole feature — a pure function nobody calls is documentation, not
/// behaviour. This is the consumer.
///
/// ## Serve, remember, persist — in one step
/// Every `serve*` here commits the seen set and writes to disk before returning. The JS wrapper
/// does the same, for the same reason: a caller that reached for the pool directly would mutate
/// the in-memory `seen` and never write it back, so the saved file would silently fork from the
/// live one and puzzles would start repeating after a relaunch. There is deliberately no public
/// way to serve without recording.
///
/// ## No prefetch buffer
/// The original kept a 20-deep buffer in rated mode and a 12-deep one with six parallel fetches in
/// Turbo, purely to hide network latency. A local SQLite read is sub-millisecond. Turbo's single
/// lookahead calls `serveStreak` while the current puzzle is on screen and holds the one result;
/// a queue would reintroduce the double-serve the seen set exists to prevent (Part 7.6).
// Internal, like every other view and view-model in this package: only `Roots.swift` is public,
// because only the app entry points cross the module boundary. Declaring this public would also be
// a compile error — `PuzzleStore.Puzzle` is internal, and a public signature cannot name it.
@MainActor
final class PuzzleHubStore: ObservableObject {

    /// Everything persisted. `@Published` so any screen observing the store repaints when a solve,
    /// a rating change or a run ending lands — none of them have to know who else cares.
    @Published private(set) var state: PuzzleProgressState

    /// `nil` when the bundled corpus is missing. Every screen must handle it: the DemoApp can run
    /// without the database, and a crash there would be a worse answer than an empty state.
    private let pool: SQLitePuzzlePool?
    private let store: PuzzleStore?
    private let file: URL?

    // MARK: - Lifecycle

    init(now: Int = PuzzleHubStore.nowMs()) {
        let s = PuzzleStore()
        self.store = s
        self.pool = s.map { SQLitePuzzlePool(store: $0) }
        self.file = PuzzleHubStore.storeURL()
        self.state = PuzzleHubStore.load(from: file) ?? PuzzleProgress.seed(now: now)
    }

    var hasCorpus: Bool { pool != nil }
    var corpusCount: Int { pool?.count ?? 0 }

    /// Epoch milliseconds — the unit every Core function takes, matching `AnalysisStore`.
    static func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    // MARK: - Serving
    //
    // Four entry points, one per ladder. Each returns the puzzle ready for the solver, or `nil`
    // when the corpus cannot supply one — which the screens render as an empty state rather than
    // an error, because a 93,000-row bundle running dry means the user has solved everything in
    // range, not that something broke.

    /// Play Puzzles: ±100 around the player's own rating, random pick (Part 7.2).
    func serveRated() -> PuzzleStore.Puzzle? {
        guard let pool else { return nil }
        return serve(PuzzleSelection.serveRandom(
            pool, center: state.profile.rating,
            window: PuzzleServing.regularWindow, theme: nil, seen: PuzzleProgress.seenSet(state)))
    }

    /// Streak and Turbo: ±50 around an explicit target, closest-match fallback (Part 7.3).
    ///
    /// Shared by both because the ladder is the same; only the target differs, and that is the
    /// caller's business — `PuzzleProgress.streakTarget` for Streak, `TurboRun.target` for Turbo.
    func serveStreak(targetRating: Int, theme: String?) -> PuzzleStore.Puzzle? {
        guard let pool else { return nil }
        return serve(PuzzleSelection.serveClosest(
            pool, center: targetRating,
            window: PuzzleServing.streakWindow, theme: theme,
            seen: PuzzleProgress.seenSet(state)))
    }

    /// Thematic: ±200, theme mandatory, hybrid fallback (Part 7.4).
    func serveThematic(theme: String) -> PuzzleStore.Puzzle? {
        guard let pool else { return nil }
        return serve(PuzzleSelection.serveThematic(
            pool, center: state.profile.rating,
            window: PuzzleServing.thematicWindow, theme: theme,
            seen: PuzzleProgress.seenSet(state)))
    }

    /// The daily puzzle. Same for every device on a given date, and it does **not** touch `seen`:
    /// re-opening today's puzzle must hand back today's puzzle, not the next unseen one.
    func dailyPuzzle(on date: Date = Date()) -> PuzzleStore.Puzzle? {
        store?.dailyPuzzle(on: date)
    }

    /// Fetch a specific puzzle — the Streak anti-reroll lock's other half (Part 22.6).
    func puzzle(id: Int) -> PuzzleStore.Puzzle? { store?.puzzle(id: id) }

    /// The one place a served candidate becomes a puzzle, and the only place `seen` is committed.
    private func serve(_ selection: PuzzleSelection.Selection) -> PuzzleStore.Puzzle? {
        guard let store, let candidate = selection.candidate else { return nil }
        var seen = PuzzleProgress.seenSet(state)
        // A ladder that fell through to its reset stage has already decided the seen set should be
        // cleared; reproducing that here keeps the persisted set in step with what was served.
        if selection.didReset { seen.removeAll() }
        seen.insert(candidate.id)
        var s = state
        PuzzleProgress.commitSeen(&s, seen)
        state = s
        persist()
        return store.puzzle(id: candidate.id)
    }

    // MARK: - Mutations
    //
    // Thin wrappers so no screen holds `inout` access to the state, and so persistence cannot be
    // forgotten. Each mirrors a function in `puzzle-app.js` / `puzzle-progress.js` exactly.

    /// Apply a change and write it. The single mutation path.
    func mutate<T>(_ body: (inout PuzzleProgressState) -> T) -> T {
        var s = state
        let out = body(&s)
        state = s
        persist()
        return out
    }

    func reset(now: Int = PuzzleHubStore.nowMs()) {
        state = PuzzleProgress.seed(now: now)
        persist()
    }

    // MARK: - Persistence
    //
    // JSON in Application Support, following `AnalysisLibraryFile`. `PuzzleProgressState` is
    // already `Codable`, so there is no second schema to keep in step — which matters, because a
    // hand-written encoder is exactly where the JS and Swift saves would drift apart.

    private static func storeURL() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                                  in: .userDomainMask).first else { return nil }
        return base.appendingPathComponent("Biyaherong", isDirectory: true)
                   .appendingPathComponent("puzzle-progress.json")
    }

    private static func load(from url: URL?) -> PuzzleProgressState? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(PuzzleProgressState.self, from: data)
    }

    /// Best-effort and deliberately silent. Losing a write costs one puzzle's progress; throwing
    /// mid-solve would cost the session.
    func persist() {
        guard let file else { return }
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        guard let data = try? enc.encode(state) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }
}
