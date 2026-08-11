import Foundation
import SQLite3
import BiyaherongCoachCore

/// Read-only access to the bundled, curated puzzle database (Part 3.3).
///
/// The DB is opened read-only and never copied to Documents — it is immutable and already local.
/// This type is the ONLY place in the app that writes SQL; every screen goes through
/// `PuzzleSelection`'s ladders, which run over the `PuzzlePool` conformance below.
///
/// ## Schema note
/// The corpus was rebuilt for the Puzzle Hub (`tools/puzzlebank/build_puzzles.py`). The old
/// single-table schema stored themes as one unindexed space-separated string, so every thematic
/// query was a `LIKE '%theme%'` scan of 550,000 rows — spec fix #15. Themes now live in
/// `theme_rating_index(theme, rating, puzzle_id)`, which the thematic query seeks into.
final class PuzzleStore {

    struct Puzzle {
        let id: Int
        let lichessId: String
        /// UCI; `moves[0]` is the OPPONENT's setup move (Part 5.1).
        let moves: [String]
        let fen: String
        let rating: Int
        let themes: [String]
        let openingTags: [String]

        /// The shape the pure solver core takes.
        var session: PuzzleSession.Puzzle {
            PuzzleSession.Puzzle(id: id, fen: fen, moves: moves, rating: rating,
                                 themes: themes, openingTags: openingTags)
        }
    }

    private var db: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self) // SQLITE_TRANSIENT

    /// How many rows a tier-1/tier-2 query materialises before the picker chooses.
    ///
    /// The pure `ArrayPool` hands the picker every eligible candidate; a 93,000-row corpus cannot.
    /// `ORDER BY RANDOM() LIMIT n` returns a uniform random SUBSET, so picking uniformly from it is
    /// still a uniform pick overall — and the only thing the ladder actually branches on is whether
    /// the set is empty, which a LIMIT preserves exactly.
    fileprivate static let sampleLimit = 256

    init?() {
        guard let url = PuzzleStore.locateDatabase() else { return nil }
        if sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) != SQLITE_OK { return nil }
    }
    deinit { if db != nil { sqlite3_close(db) } }

    /// Find `puzzles.sqlite` across the layouts we ship in: the SPM module bundle (dev / iOS
    /// framework), the main app bundle (real iOS app), and any nested `*.bundle` inside a
    /// hand-assembled macOS `.app`.
    static func locateDatabase() -> URL? {
        if let u = Bundle.module.url(forResource: "puzzles", withExtension: "sqlite") { return u }
        if let u = Bundle.main.url(forResource: "puzzles", withExtension: "sqlite") { return u }
        let fm = FileManager.default
        let roots = [Bundle.main.resourceURL,
                     Bundle.main.bundleURL,
                     Bundle.main.executableURL?.deletingLastPathComponent()].compactMap { $0 }
        for root in roots {
            guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            else { continue }
            for item in items where item.pathExtension == "bundle" {
                let candidate = item.appendingPathComponent("puzzles.sqlite")
                if fm.fileExists(atPath: candidate.path) { return candidate }
            }
        }
        return nil
    }

    var count: Int { queryScalar("SELECT COUNT(*) FROM puzzles") ?? 0 }
    var dailyPoolCount: Int { queryScalar("SELECT COUNT(*) FROM daily_pool") ?? 0 }

    // MARK: - Fetching a whole puzzle

    func puzzle(id: Int) -> Puzzle? {
        var stmt: OpaquePointer?
        let sql = "SELECT id,lichess_id,fen,moves,rating,opening_tags FROM puzzles WHERE id = ?"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(id))
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return Puzzle(id: Int(sqlite3_column_int(stmt, 0)),
                      lichessId: text(stmt, 1),
                      moves: splitWords(text(stmt, 3)),
                      fen: text(stmt, 2),
                      rating: Int(sqlite3_column_int(stmt, 4)),
                      themes: themes(of: id),
                      openingTags: splitWords(text(stmt, 5)))
    }

    /// A puzzle's themes. Seeks the `puzzle_themes` primary key rather than scanning.
    func themes(of id: Int) -> [String] {
        var out: [String] = []
        var stmt: OpaquePointer?
        let sql = "SELECT theme FROM puzzle_themes WHERE puzzle_id = ? ORDER BY theme"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return out }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(id))
        while sqlite3_step(stmt) == SQLITE_ROW { out.append(text(stmt, 0)) }
        return out
    }

    // MARK: - The daily puzzle (Part 11.1)

    /// Deterministic: a pure function of the LOCAL calendar date, so every device shows the same
    /// puzzle on the same date with no communication at all.
    func dailyPuzzle(on date: Date = Date(), calendar: Calendar = .current) -> Puzzle? {
        let n = dailyPoolCount
        guard n > 0 else { return nil }
        let index = PuzzleSelection.dailyIndex(date, poolCount: n, calendar: calendar)
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT puzzle_id FROM daily_pool WHERE day_index = ?", -1,
                                 &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(index))
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return puzzle(id: Int(sqlite3_column_int(stmt, 0)))
    }

    // MARK: - Compatibility surface for the existing Puzzles tab

    /// A random puzzle within ±window of `center`, falling back to the closest by rating.
    /// Superseded by `PuzzleSelection.serveRandom` over `pool`; kept so `PuzzleView` keeps working
    /// while the Puzzle Hub screens are built.
    func randomPuzzle(nearRating center: Int, window: Int = 100) -> Puzzle? {
        if let id = candidateIds(center: center, window: window, theme: nil, seen: [],
                                 limit: 1, random: true).first { return puzzle(id: id) }
        return closestId(center: center, theme: nil).flatMap { puzzle(id: $0) }
    }

    /// A random puzzle carrying `theme`, near `center`.
    func randomThematic(theme: String, nearRating center: Int, window: Int = 300) -> Puzzle? {
        candidateIds(center: center, window: window, theme: theme, seen: [],
                     limit: 1, random: true).first.flatMap { puzzle(id: $0) }
    }

    // MARK: - SQL primitives behind the ladders

    /// Ids matching the filter. `theme == nil` seeks `idx_puzzles_rating`; a theme seeks the
    /// `theme_rating_index` primary key. Neither ever scans.
    fileprivate func candidateIds(center: Int, window: Int?, theme: String?, seen: Set<Int>,
                              limit: Int, random: Bool) -> [Int] {
        var sql: String
        if let t = theme, !t.isEmpty {
            sql = "SELECT puzzle_id FROM theme_rating_index WHERE theme = ?"
            if window != nil { sql += " AND rating BETWEEN ? AND ?" }
        } else {
            sql = "SELECT id FROM puzzles WHERE 1 = 1"
            if window != nil { sql += " AND rating BETWEEN ? AND ?" }
        }
        // Over-fetch so the seen filter, applied in Swift, still leaves a full sample. Binding a
        // large `NOT IN (…)` would rebuild the statement on every serve and defeat the plan cache.
        sql += random ? " ORDER BY RANDOM() LIMIT ?" : " LIMIT ?"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }
        var i: Int32 = 1
        if let t = theme, !t.isEmpty { sqlite3_bind_text(stmt, i, t, -1, PuzzleStore.transient); i += 1 }
        if let w = window {
            sqlite3_bind_int(stmt, i, Int32(center - w)); i += 1
            sqlite3_bind_int(stmt, i, Int32(center + w)); i += 1
        }
        sqlite3_bind_int(stmt, i, Int32(limit + min(seen.count, limit * 4)))
        var out: [Int] = []
        while sqlite3_step(stmt) == SQLITE_ROW && out.count < limit {
            let id = Int(sqlite3_column_int(stmt, 0))
            if !seen.contains(id) { out.append(id) }
        }
        return out
    }

    /// `ORDER BY ABS(rating - ?)` with the id as the documented tie-break.
    fileprivate func closestId(center: Int, theme: String?) -> Int? {
        let sql: String
        if let t = theme, !t.isEmpty {
            sql = "SELECT puzzle_id FROM theme_rating_index WHERE theme = ?"
                + " ORDER BY ABS(rating - ?), puzzle_id LIMIT 1"
        } else {
            sql = "SELECT id FROM puzzles ORDER BY ABS(rating - ?), id LIMIT 1"
        }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        var i: Int32 = 1
        if let t = theme, !t.isEmpty { sqlite3_bind_text(stmt, i, t, -1, PuzzleStore.transient); i += 1 }
        sqlite3_bind_int(stmt, i, Int32(center))
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        return Int(sqlite3_column_int(stmt, 0))
    }

    fileprivate func candidate(_ id: Int) -> PuzzleSelection.Candidate? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT rating FROM puzzles WHERE id = ?", -1, &stmt, nil)
                == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(id))
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        // Themes are loaded lazily: the ladder only filters on them through the SQL above, so a
        // candidate carries an empty list unless a caller asks for the whole puzzle.
        return PuzzleSelection.Candidate(id: id, rating: Int(sqlite3_column_int(stmt, 0)), themes: [])
    }

    fileprivate func ids(sql: String, bindText: String? = nil, bindInts: [Int] = []) -> [Int] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }
        var i: Int32 = 1
        if let t = bindText { sqlite3_bind_text(stmt, i, t, -1, PuzzleStore.transient); i += 1 }
        for n in bindInts { sqlite3_bind_int(stmt, i, Int32(n)); i += 1 }
        var out: [Int] = []
        while sqlite3_step(stmt) == SQLITE_ROW { out.append(Int(sqlite3_column_int(stmt, 0))) }
        return out
    }

    // MARK: helpers

    private func queryScalar(_ sql: String) -> Int? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : nil
    }

    private func text(_ stmt: OpaquePointer?, _ col: Int32) -> String {
        sqlite3_column_text(stmt, col).map { String(cString: $0) } ?? ""
    }

    private func splitWords(_ s: String) -> [String] {
        s.split(separator: " ").map(String.init)
    }
}

// MARK: - The pool the ladders run over

/// `PuzzleStore` answering the five primitives `PuzzleSelection` needs, in SQL.
///
/// A separate type rather than a conformance on `PuzzleStore` itself, so the SQL surface above
/// stays the only place statements are written and this is a thin, obviously-correct adapter. It
/// lives in the same file so it can reach the `fileprivate` primitives without widening them.
struct SQLitePuzzlePool: PuzzleSelection.PuzzlePool {
    let store: PuzzleStore

    var count: Int { store.count }

    func windowUnseen(center: Int, window: Int, theme: String?,
                      seen: Set<Int>) -> [PuzzleSelection.Candidate] {
        store.candidateIds(center: center, window: window, theme: theme, seen: seen,
                           limit: PuzzleStore.sampleLimit, random: true)
             .compactMap { store.candidate($0) }
    }

    /// Tier 2 drops the rating window and keeps only the theme filter.
    func anyUnseen(theme: String?, seen: Set<Int>) -> [PuzzleSelection.Candidate] {
        store.candidateIds(center: 0, window: nil, theme: theme, seen: seen,
                           limit: PuzzleStore.sampleLimit, random: true)
             .compactMap { store.candidate($0) }
    }

    func closest(center: Int, theme: String?) -> PuzzleSelection.Candidate? {
        store.closestId(center: center, theme: theme).flatMap { store.candidate($0) }
    }

    func ids(theme: String) -> [Int] {
        store.ids(sql: "SELECT puzzle_id FROM theme_rating_index WHERE theme = ?", bindText: theme)
    }

    func ids(from lo: Int, to hi: Int) -> [Int] {
        store.ids(sql: "SELECT id FROM puzzles WHERE rating BETWEEN ? AND ?", bindInts: [lo, hi])
    }
}
