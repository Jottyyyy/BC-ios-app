import Foundation
import SQLite3

/// Read-only access to the bundled 550k puzzle database (SQLite via the system SQLite3 module).
final class PuzzleStore {
    struct Puzzle {
        let id: Int
        let fen: String
        let moves: [String]   // UCI; moves[0] is the opponent's setup move (Lichess convention)
        let rating: Int
        let themes: [String]
    }

    private var db: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self) // SQLITE_TRANSIENT

    init?() {
        guard let url = PuzzleStore.locateDatabase() else { return nil }
        if sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) != SQLITE_OK { return nil }
    }
    deinit { if db != nil { sqlite3_close(db) } }

    /// Find `puzzles.sqlite` across the layouts we ship in: the SPM module bundle (dev / iOS framework),
    /// the main app bundle (real iOS app), and any nested `*.bundle` inside a hand-assembled macOS `.app`.
    static func locateDatabase() -> URL? {
        if let u = Bundle.module.url(forResource: "puzzles", withExtension: "sqlite") { return u }
        if let u = Bundle.main.url(forResource: "puzzles", withExtension: "sqlite") { return u }
        let fm = FileManager.default
        let roots = [Bundle.main.resourceURL,
                     Bundle.main.bundleURL,
                     Bundle.main.executableURL?.deletingLastPathComponent()].compactMap { $0 }
        for root in roots {
            guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { continue }
            for item in items where item.pathExtension == "bundle" {
                let candidate = item.appendingPathComponent("puzzles.sqlite")
                if fm.fileExists(atPath: candidate.path) { return candidate }
            }
        }
        return nil
    }

    /// A random puzzle whose rating is within ±window of `center`; falls back to the closest by rating.
    func randomPuzzle(nearRating center: Int, window: Int = 100) -> Puzzle? {
        if let p = queryOne(
            "SELECT id,fen,moves,rating,themes FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1",
            bindInts: [center - window, center + window]) { return p }
        return queryOne(
            "SELECT id,fen,moves,rating,themes FROM puzzles ORDER BY ABS(rating - ?) LIMIT 1",
            bindInts: [center])
    }

    /// A random puzzle carrying `theme`, near `center`.
    func randomThematic(theme: String, nearRating center: Int, window: Int = 300) -> Puzzle? {
        queryOne(
            "SELECT id,fen,moves,rating,themes FROM puzzles WHERE themes LIKE ? AND rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1",
            bindText: ["%\(theme)%"], bindInts: [center - window, center + window])
    }

    var count: Int {
        queryScalar("SELECT COUNT(*) FROM puzzles") ?? 0
    }

    // MARK: helpers

    private func queryOne(_ sql: String, bindText: [String] = [], bindInts: [Int]) -> Puzzle? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        var idx: Int32 = 1
        for t in bindText { sqlite3_bind_text(stmt, idx, t, -1, PuzzleStore.transient); idx += 1 }
        for n in bindInts { sqlite3_bind_int(stmt, idx, Int32(n)); idx += 1 }
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        let id = Int(sqlite3_column_int(stmt, 0))
        let fen = text(stmt, 1)
        let moves = text(stmt, 2).split(separator: " ").map(String.init)
        let rating = Int(sqlite3_column_int(stmt, 3))
        let themes = text(stmt, 4).split(separator: " ").map(String.init)
        return Puzzle(id: id, fen: fen, moves: moves, rating: rating, themes: themes)
    }

    private func queryScalar(_ sql: String) -> Int? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : nil
    }

    private func text(_ stmt: OpaquePointer?, _ col: Int32) -> String {
        sqlite3_column_text(stmt, col).map { String(cString: $0) } ?? ""
    }
}
