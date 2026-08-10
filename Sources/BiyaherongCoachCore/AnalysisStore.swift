import Foundation

// The Analysis Board's saved-game library.
//
// Two halves, as everywhere else in this rebuild: this file is entirely PURE — records, and every
// rule that operates on them. It never touches the filesystem and never reads a clock. Time is an
// INJECTED parameter, exactly as `PuzzleServing` injects its picker, which is what makes the
// 24-hour draft TTL assertable. `AnalysisLibraryFile` (BiyaherongUI) does the ten lines of I/O.
//
// ── The record shapes are the server's, deliberately ──────────────────────────
// The app is 100% offline and there is no sync today, but the fields mirror
// ../BYAHERONG-COACH-LARAVEL's `analysis_sessions` / `analysis_folders` so one stays possible. The
// limits below are the CONTROLLER's `validate()` rules, which are tighter than the DB columns
// (`white_player` is varchar(255) but validated `max:100`).
//
// Deliberate deviations from the server, all recorded in PORTING_NOTES:
//   - no free-session cap (the server allows 3 for non-premium; offline there are no accounts);
//   - no `share_token` / `is_shared` (nothing to share through);
//   - no `move_annotations` — the server needs it because its client serialises movetext only,
//     while ours emits NAG suffixes inline, so the column would be a second copy of what the PGN
//     already carries.
//
// Mirrored line-for-line by web-demo/js/analysis-store.js. The two share ONE canonical document,
// hardcoded identically in both `selfTest()`s, and each must decode it to the same records — a real
// cross-language contract rather than two implementations agreeing with themselves.
//
// What is deliberately NOT asserted is byte-identical re-encoding: `JSONEncoder(.sortedKeys)` orders
// keys alphabetically while `JSON.stringify` uses insertion order, so the two serialisers differ by
// key order alone. Each side asserts its own round trip is a fixpoint; the shared claim is the
// decoded VALUES, which is the part that matters for a future sync.

/// A folder, mirroring `analysis_folders`.
public struct AnalysisFolderRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: Int
    public var name: String
    public var color: String
    public var sortOrder: Int
    public var isDefault: Bool
    public var createdAt: Int

    public init(id: Int, name: String, color: String, sortOrder: Int,
                isDefault: Bool, createdAt: Int) {
        self.id = id; self.name = name; self.color = color
        self.sortOrder = sortOrder; self.isDefault = isDefault; self.createdAt = createdAt
    }
}

/// A saved game, mirroring `analysis_sessions`. The PGN is the source of truth; the other columns
/// are a denormalised index so the library list does not have to parse 50 PGNs to draw itself.
public struct AnalysisSessionRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: Int
    public var folderID: Int?
    public var title: String
    public var notes: String?
    public var pgn: String
    public var initialFEN: String
    public var result: String?
    public var whitePlayer: String?
    public var blackPlayer: String?
    public var whiteRating: Int?
    public var blackRating: Int?
    public var eventName: String?
    public var gameDate: String?
    public var timeControl: String?
    public var location: String?
    public var roundInfo: String?
    public var eco: String?
    public var createdAt: Int
    public var updatedAt: Int

    /// The JSON keys are the JS twin's, so one canonical document decodes in both languages.
    enum CodingKeys: String, CodingKey {
        case id, folderID = "folderId", title, notes, pgn, initialFEN = "initialFen"
        case result, whitePlayer, blackPlayer, whiteRating, blackRating
        case eventName, gameDate, timeControl, location, roundInfo, eco
        case createdAt, updatedAt
    }
}

/// An autosaved draft. Three slots, keyed by how the board was entered (board.tsx:819-821).
public struct AnalysisDraft: Codable, Equatable, Sendable {
    public var pgn: String
    public var initialFEN: String
    public var timestamp: Int
    public var sessionID: Int?
    public var title: String?
    public var notes: String?
    public var folderID: Int?

    enum CodingKeys: String, CodingKey {
        case pgn, initialFEN = "initialFen", timestamp
        case sessionID = "sessionId", title, notes, folderID = "folderId"
    }

    public init(pgn: String, initialFEN: String, timestamp: Int, sessionID: Int? = nil,
                title: String? = nil, notes: String? = nil, folderID: Int? = nil) {
        self.pgn = pgn; self.initialFEN = initialFEN; self.timestamp = timestamp
        self.sessionID = sessionID; self.title = title; self.notes = notes; self.folderID = folderID
    }
}

/// The whole document — one JSON file, one localStorage key.
public struct AnalysisLibrary: Codable, Equatable, Sendable {
    public var version: Int
    /// Stand-ins for the server's autoincrement. Ids are never reused.
    public var nextSessionID: Int
    public var nextFolderID: Int
    public var folders: [AnalysisFolderRecord]
    public var sessions: [AnalysisSessionRecord]
    public var drafts: [String: AnalysisDraft]

    enum CodingKeys: String, CodingKey {
        case version, nextSessionID = "nextSessionId", nextFolderID = "nextFolderId"
        case folders, sessions, drafts
    }

    public init(version: Int = AnalysisStore.libraryVersion,
                nextSessionID: Int = 1, nextFolderID: Int = 1,
                folders: [AnalysisFolderRecord] = [],
                sessions: [AnalysisSessionRecord] = [],
                drafts: [String: AnalysisDraft] = [:]) {
        self.version = version
        self.nextSessionID = nextSessionID; self.nextFolderID = nextFolderID
        self.folders = folders; self.sessions = sessions; self.drafts = drafts
    }
}

/// Everything a caller can ask about or do to a library. All static and pure.
public enum AnalysisStore {

    public static let libraryVersion = 1

    // Draft slots.
    public static let draftNew = "new"
    public static let draftSetup = "setup"
    public static let draftOpenFile = "openfile"

    /// 24 hours, the source's own staleness window (board.tsx:726, :791).
    public static let draftTTLMs = 24 * 60 * 60 * 1000
    /// The source debounces every draft write by 800ms (board.tsx:824, :853).
    public static let draftDebounceMs = 800

    /// The controller's `validate()` maxima — tighter than the columns, so these are the contract.
    public enum Limits {
        public static let title = 255
        public static let notes = 5000
        public static let initialFEN = 200
        public static let eventName = 200
        public static let location = 200
        public static let whitePlayer = 100
        public static let blackPlayer = 100
        public static let timeControl = 50
        public static let roundInfo = 50
        public static let result = 10
        public static let eco = 10
        public static let folderName = 100
        public static let folderColor = 20
    }

    public static let defaultTitle = "Untitled Analysis"     // the controller's own fallback
    public static let defaultFolderColor = "#FDB022"

    /// The three folders the server seeds lazily on a user's first folder list
    /// (AnalysisSessionController::folders, :319-332). Its exact names, colours and order.
    public static let defaultFolders: [(name: String, color: String, sortOrder: Int)] = [
        ("Opening Repertoire", "#4CAF50", 1),
        ("Setup Position", "#2196F3", 2),
        ("My Games", "#FDB022", 3),
    ]

    // MARK: - Clamping

    static func clamp(_ s: String?, _ max: Int) -> String? {
        guard let s else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        return t.count <= max ? t : String(t.prefix(max))
    }
    static func clampRequired(_ s: String?, _ max: Int, _ fallback: String) -> String {
        clamp(s, max) ?? fallback
    }

    // MARK: - Folders

    /// Seed the three defaults if none exist yet. Idempotent, like the server's lazy seed.
    public static func seedDefaultFolders(_ lib: inout AnalysisLibrary, now: Int) {
        if lib.folders.contains(where: { $0.isDefault }) { return }
        for d in defaultFolders {
            lib.folders.append(AnalysisFolderRecord(id: lib.nextFolderID, name: d.name,
                                                    color: d.color, sortOrder: d.sortOrder,
                                                    isDefault: true, createdAt: now))
            lib.nextFolderID += 1
        }
    }

    public static func folder(_ lib: AnalysisLibrary, id: Int) -> AnalysisFolderRecord? {
        lib.folders.first { $0.id == id }
    }

    /// Ordered as the server orders them: `sort_order` then `name`.
    public static func folders(_ lib: AnalysisLibrary) -> [AnalysisFolderRecord] {
        lib.folders.sorted {
            $0.sortOrder != $1.sortOrder ? $0.sortOrder < $1.sortOrder : $0.name < $1.name
        }
    }

    /// `sessions_count` for the chips.
    public static func sessionCount(_ lib: AnalysisLibrary, folderID: Int?) -> Int {
        lib.sessions.filter { $0.folderID == folderID }.count
    }

    /// Returns the new folder, or nil when the name is blank. `sortOrder` = max + 1.
    @discardableResult
    public static func createFolder(_ lib: inout AnalysisLibrary, name: String,
                                    color: String? = nil, now: Int) -> AnalysisFolderRecord? {
        guard let n = clamp(name, Limits.folderName) else { return nil }
        let maxOrder = lib.folders.map { $0.sortOrder }.max() ?? 0
        let f = AnalysisFolderRecord(id: lib.nextFolderID, name: n,
                                     color: clamp(color, Limits.folderColor) ?? defaultFolderColor,
                                     sortOrder: maxOrder + 1, isDefault: false, createdAt: now)
        lib.nextFolderID += 1
        lib.folders.append(f)
        return f
    }

    /// False for a default folder — the server answers 403 (`updateFolder`, :380).
    @discardableResult
    public static func renameFolder(_ lib: inout AnalysisLibrary, id: Int, name: String) -> Bool {
        guard let i = lib.folders.firstIndex(where: { $0.id == id }), !lib.folders[i].isDefault,
              let n = clamp(name, Limits.folderName) else { return false }
        lib.folders[i].name = n
        return true
    }

    /// Delete a folder. Its sessions are **unfiled, not deleted** — the FK is `nullOnDelete` and the
    /// controller nulls them explicitly first (:417). Default folders refuse (403).
    @discardableResult
    public static func deleteFolder(_ lib: inout AnalysisLibrary, id: Int) -> Bool {
        guard let f = folder(lib, id: id), !f.isDefault else { return false }
        for i in lib.sessions.indices where lib.sessions[i].folderID == id {
            lib.sessions[i].folderID = nil
        }
        lib.folders.removeAll { $0.id == id }
        return true
    }

    // MARK: - Sessions

    /// The fields a save collects. Ratings arrive as strings from a text field, so they are parsed
    /// here rather than at the call site.
    public struct SaveFields: Equatable, Sendable {
        public var id: Int?
        public var pgn: String
        public var initialFEN: String?
        public var title: String?
        public var notes: String?
        public var folderID: Int?
        public var result: String?
        public var whitePlayer: String?
        public var blackPlayer: String?
        public var whiteRating: String?
        public var blackRating: String?
        public var eventName: String?
        public var gameDate: String?
        public var timeControl: String?
        public var location: String?
        public var roundInfo: String?
        public var eco: String?

        public init(id: Int? = nil, pgn: String, initialFEN: String? = nil, title: String? = nil,
                    notes: String? = nil, folderID: Int? = nil, result: String? = nil,
                    whitePlayer: String? = nil, blackPlayer: String? = nil,
                    whiteRating: String? = nil, blackRating: String? = nil,
                    eventName: String? = nil, gameDate: String? = nil, timeControl: String? = nil,
                    location: String? = nil, roundInfo: String? = nil, eco: String? = nil) {
            self.id = id; self.pgn = pgn; self.initialFEN = initialFEN; self.title = title
            self.notes = notes; self.folderID = folderID; self.result = result
            self.whitePlayer = whitePlayer; self.blackPlayer = blackPlayer
            self.whiteRating = whiteRating; self.blackRating = blackRating
            self.eventName = eventName; self.gameDate = gameDate; self.timeControl = timeControl
            self.location = location; self.roundInfo = roundInfo; self.eco = eco
        }
    }

    static func intOrNil(_ s: String?) -> Int? {
        guard let t = clamp(s, 12) else { return nil }
        return Int(t)
    }

    /// Insert or update. A nil id inserts and allocates; otherwise it updates in place, preserving
    /// `createdAt` and bumping `updatedAt`. Returns nil when there is no PGN (the server validates
    /// `pgn` as required).
    @discardableResult
    public static func save(_ lib: inout AnalysisLibrary, _ f: SaveFields,
                            now: Int) -> AnalysisSessionRecord? {
        guard !f.pgn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }

        var rec = AnalysisSessionRecord(
            id: f.id ?? 0,
            folderID: f.folderID,
            title: clampRequired(f.title, Limits.title, defaultTitle),
            notes: clamp(f.notes, Limits.notes),
            pgn: f.pgn,
            // DEVIATION: the source never sends initial_fen, so a custom-setup game does not survive
            // a save/load round trip there. Ours persists it.
            initialFEN: clamp(f.initialFEN, Limits.initialFEN) ?? ChessPosition.startFEN,
            result: clamp(f.result, Limits.result),
            whitePlayer: clamp(f.whitePlayer, Limits.whitePlayer),
            blackPlayer: clamp(f.blackPlayer, Limits.blackPlayer),
            whiteRating: intOrNil(f.whiteRating),
            blackRating: intOrNil(f.blackRating),
            eventName: clamp(f.eventName, Limits.eventName),
            gameDate: clamp(f.gameDate, 10),
            timeControl: clamp(f.timeControl, Limits.timeControl),
            location: clamp(f.location, Limits.location),
            roundInfo: clamp(f.roundInfo, Limits.roundInfo),
            eco: clamp(f.eco, Limits.eco),
            createdAt: now,
            updatedAt: now)

        // The server stores '*' as null (handleSave :1036); keep that so a round trip is stable.
        if rec.result == "*" { rec.result = nil }
        if let fid = rec.folderID, folder(lib, id: fid) == nil { rec.folderID = nil }

        if rec.id != 0, let i = lib.sessions.firstIndex(where: { $0.id == rec.id }) {
            rec.createdAt = lib.sessions[i].createdAt
            lib.sessions[i] = rec
            return rec
        }
        // An id that is not here any more (deleted elsewhere) becomes an insert with a FRESH id.
        rec.id = lib.nextSessionID
        lib.nextSessionID += 1
        lib.sessions.append(rec)
        return rec
    }

    public static func session(_ lib: AnalysisLibrary, id: Int) -> AnalysisSessionRecord? {
        lib.sessions.first { $0.id == id }
    }

    @discardableResult
    public static func deleteSession(_ lib: inout AnalysisLibrary, id: Int) -> Bool {
        let before = lib.sessions.count
        lib.sessions.removeAll { $0.id == id }
        return lib.sessions.count != before
    }

    /// What the library list shows.
    public enum Filter: Equatable, Sendable {
        case all
        case unfiled
        case folder(Int)
    }

    /// Case-insensitive search across title, notes and both player names — the server's `ilike` set,
    /// and like `ilike '%term%'` it matches mid-word. Ordered `updatedAt` descending, ties broken by
    /// id descending so the order is total and stable (Swift's sort is not).
    public static func sessions(_ lib: AnalysisLibrary, filter: Filter = .all,
                                search: String = "") -> [AnalysisSessionRecord] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matched = lib.sessions.filter { s in
            switch filter {
            case .all: break
            case .unfiled: if s.folderID != nil { return false }
            case .folder(let id): if s.folderID != id { return false }
            }
            if q.isEmpty { return true }
            for v in [s.title, s.notes, s.whitePlayer, s.blackPlayer] {
                if let v, v.lowercased().contains(q) { return true }
            }
            return false
        }
        return matched.sorted { a, b in
            a.updatedAt != b.updatedAt ? a.updatedAt > b.updatedAt : a.id > b.id
        }
    }

    // MARK: - Drafts

    @discardableResult
    public static func putDraft(_ lib: inout AnalysisLibrary, mode: String,
                                _ draft: AnalysisDraft, now: Int) -> AnalysisDraft {
        var d = draft
        d.timestamp = now
        lib.drafts[mode] = d
        return d
    }

    /// Read a draft, or nil when there is none or it has expired.
    ///
    /// Expiry **prunes**: a stale draft is removed, matching the source, which deletes the key
    /// rather than leaving it to be re-checked (board.tsx:727, :792). A zero timestamp counts as
    /// stale, as a missing one does there.
    public static func draft(_ lib: inout AnalysisLibrary, mode: String,
                             now: Int, ttlMs: Int = draftTTLMs) -> AnalysisDraft? {
        guard let d = lib.drafts[mode] else { return nil }
        if d.timestamp == 0 || (now - d.timestamp) > ttlMs {
            lib.drafts.removeValue(forKey: mode)
            return nil
        }
        return d
    }

    @discardableResult
    public static func clearDraft(_ lib: inout AnalysisLibrary, mode: String) -> Bool {
        lib.drafts.removeValue(forKey: mode) != nil
    }

    /// Is this draft worth writing? The source skips an empty board at the standard start (:828).
    public static func draftWorthKeeping(pgn: String, initialFEN: String) -> Bool {
        if !pgn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return true }
        return !initialFEN.isEmpty && initialFEN != ChessPosition.startFEN
    }

    // MARK: - Coding

    /// Repair anything read back from storage. A corrupt or older document degrades to empty rather
    /// than throwing — losing a library is bad, but a screen that will not open at all is worse.
    public static func normalize(_ lib: AnalysisLibrary) -> AnalysisLibrary {
        var out = lib
        let maxS = out.sessions.map { $0.id }.max() ?? 0
        let maxF = out.folders.map { $0.id }.max() ?? 0
        out.nextSessionID = Swift.max(out.nextSessionID, maxS + 1)
        out.nextFolderID = Swift.max(out.nextFolderID, maxF + 1)
        return out
    }

    public static func decode(_ json: String) -> AnalysisLibrary {
        guard let data = json.data(using: .utf8),
              let lib = try? JSONDecoder().decode(AnalysisLibrary.self, from: data) else {
            return AnalysisLibrary()
        }
        return normalize(lib)
    }

    /// Keys are sorted so the output is deterministic and comparable with the JS twin's.
    public static func encode(_ lib: AnalysisLibrary) -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        guard let data = try? enc.encode(lib), let s = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return s
    }
}
