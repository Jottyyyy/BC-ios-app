/* analysis-store.js — the Analysis Board's saved-game library
 *
 * The browser mirror of Sources/BiyaherongCoachCore/AnalysisStore.swift.
 *
 *     node -e "console.log(require('./web-demo/js/analysis-store.js').selfTest().summary)"
 *
 * Two halves, as everywhere else in this rebuild:
 *
 *   PURE LAYER  — records, and every rule that operates on them: id allocation, folder CRUD with
 *                 nullify-on-delete, filtering and search, draft expiry, field clamping. No storage,
 *                 no clock. Time is an INJECTED parameter, exactly as `PuzzleServing` injects its
 *                 picker, which is what makes the 24-hour TTL testable.
 *   STORAGE     — a thin localStorage layer under `biya.analysis.v1`.
 *
 * ── The record shapes are the server's, deliberately ──────────────────────────
 * The app is 100% offline and there is no sync today, but the columns mirror
 * `../BYAHERONG-COACH-LARAVEL`'s `analysis_sessions` / `analysis_folders` so one stays possible.
 * The field limits below are the CONTROLLER's `validate()` rules, which are tighter than the DB
 * columns (e.g. `white_player` is varchar(255) but validated `max:100`).
 *
 * Deliberate deviations from the server, all recorded in PORTING_NOTES:
 *   - no free-session cap (the server allows 3 for non-premium; offline there are no accounts);
 *   - no `share_token` / `is_shared` (nothing to share through);
 *   - no `move_annotations` — the server needs it because its client serialises movetext only,
 *     while ours emits NAG suffixes inline, so the column would be a second copy of what the PGN
 *     already carries.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysisStore = (function () {
  'use strict';

  /* ===================== pure layer (mirrors AnalysisStore.swift) ===================== */

  var STORAGE_KEY = 'biya.analysis.v1';
  var LIBRARY_VERSION = 1;

  /** Draft slots, keyed by how the board was entered (board.tsx:819-821). */
  var DRAFT_NEW = 'new';
  var DRAFT_SETUP = 'setup';
  var DRAFT_OPENFILE = 'openfile';

  /** 24 hours, the source's own staleness window (board.tsx:726, :791). */
  var DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
  /** The source debounces every draft write by 800ms (board.tsx:824, :853). */
  var DRAFT_DEBOUNCE_MS = 800;

  /** The controller's `validate()` maxima — tighter than the columns, so these are the contract. */
  var LIMITS = {
    title: 255, notes: 5000, initialFen: 200, eventName: 200, location: 200,
    whitePlayer: 100, blackPlayer: 100, timeControl: 50, roundInfo: 50,
    result: 10, eco: 10, folderName: 100, folderColor: 20
  };

  var DEFAULT_TITLE = 'Untitled Analysis';       // the controller's own fallback
  var DEFAULT_FOLDER_COLOR = '#FDB022';
  var STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  /**
   * The three folders the server seeds lazily on a user's first folder list
   * (AnalysisSessionController::folders, :319-332). Names, colours and order are its exact values.
   */
  var DEFAULT_FOLDERS = [
    { name: 'Opening Repertoire', color: '#4CAF50', sortOrder: 1 },
    { name: 'Setup Position', color: '#2196F3', sortOrder: 2 },
    { name: 'My Games', color: '#FDB022', sortOrder: 3 }
  ];

  function clamp(s, max) {
    if (s === null || s === undefined) return null;
    var t = String(s).trim();
    return t.length ? t.slice(0, max) : null;
  }
  function clampRequired(s, max, fallback) {
    var t = clamp(s, max);
    return t === null ? fallback : t;
  }
  function intOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  /** An empty library. `nextSessionId`/`nextFolderId` stand in for the server's autoincrement. */
  function emptyLibrary() {
    return {
      version: LIBRARY_VERSION,
      nextSessionId: 1,
      nextFolderId: 1,
      folders: [],
      sessions: [],
      drafts: {}
    };
  }

  /**
   * Coerce anything read back from storage into a well-formed library.
   * A corrupt or older document degrades to empty rather than throwing — losing a library is bad,
   * but a screen that will not open at all is worse.
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return emptyLibrary();
    var lib = emptyLibrary();
    if (Array.isArray(raw.folders)) lib.folders = raw.folders.slice();
    if (Array.isArray(raw.sessions)) lib.sessions = raw.sessions.slice();
    if (raw.drafts && typeof raw.drafts === 'object') lib.drafts = Object.assign({}, raw.drafts);
    var maxS = 0, maxF = 0;
    lib.sessions.forEach(function (s) { if (s && s.id > maxS) maxS = s.id; });
    lib.folders.forEach(function (f) { if (f && f.id > maxF) maxF = f.id; });
    lib.nextSessionId = Math.max(raw.nextSessionId || 1, maxS + 1);
    lib.nextFolderId = Math.max(raw.nextFolderId || 1, maxF + 1);
    return lib;
  }

  // ---- folders ----------------------------------------------------------------

  /** Seed the three defaults if none exist yet. Idempotent, like the server's lazy seed. */
  function seedDefaultFolders(lib, now) {
    if (lib.folders.some(function (f) { return f.isDefault; })) return lib;
    DEFAULT_FOLDERS.forEach(function (d) {
      lib.folders.push({
        id: lib.nextFolderId++, name: d.name, color: d.color,
        sortOrder: d.sortOrder, isDefault: true, createdAt: now
      });
    });
    return lib;
  }

  function folder(lib, id) {
    for (var i = 0; i < lib.folders.length; i++) if (lib.folders[i].id === id) return lib.folders[i];
    return null;
  }

  /** Ordered as the server orders them: `sort_order` then `name`. */
  function folders(lib) {
    return lib.folders.slice().sort(function (a, b) {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
  }

  /** `sessions_count` for the chips. */
  function sessionCount(lib, folderId) {
    return lib.sessions.filter(function (s) { return s.folderId === folderId; }).length;
  }

  /** Returns the new folder, or null when the name is blank. `sortOrder` = max + 1. */
  function createFolder(lib, name, color, now) {
    var n = clamp(name, LIMITS.folderName);
    if (!n) return null;
    var maxOrder = 0;
    lib.folders.forEach(function (f) { if (f.sortOrder > maxOrder) maxOrder = f.sortOrder; });
    var f = {
      id: lib.nextFolderId++, name: n,
      color: clamp(color, LIMITS.folderColor) || DEFAULT_FOLDER_COLOR,
      sortOrder: maxOrder + 1, isDefault: false, createdAt: now
    };
    lib.folders.push(f);
    return f;
  }

  /** False for a default folder — the server answers 403 (`updateFolder`, :380). */
  function renameFolder(lib, id, name) {
    var f = folder(lib, id);
    if (!f || f.isDefault) return false;
    var n = clamp(name, LIMITS.folderName);
    if (!n) return false;
    f.name = n;
    return true;
  }

  /**
   * Delete a folder. Its sessions are **unfiled, not deleted** — the FK is `nullOnDelete` and the
   * controller nulls them explicitly first (:417). Default folders refuse (403).
   */
  function deleteFolder(lib, id) {
    var f = folder(lib, id);
    if (!f || f.isDefault) return false;
    lib.sessions.forEach(function (s) { if (s.folderId === id) s.folderId = null; });
    lib.folders = lib.folders.filter(function (x) { return x.id !== id; });
    return true;
  }

  // ---- sessions ---------------------------------------------------------------

  /**
   * Insert or update. `fields.id` null inserts and allocates; otherwise it updates in place,
   * preserving `createdAt` and bumping `updatedAt`. Returns the stored record, or null when there
   * is no PGN (the server validates `pgn` as required).
   */
  function saveSession(lib, fields, now) {
    var pgn = fields.pgn ? String(fields.pgn) : '';
    if (!pgn.trim()) return null;

    var rec = {
      id: fields.id || 0,
      folderId: (fields.folderId === undefined) ? null : fields.folderId,
      title: clampRequired(fields.title, LIMITS.title, DEFAULT_TITLE),
      notes: clamp(fields.notes, LIMITS.notes),
      pgn: pgn,
      // DEVIATION: the source never sends initial_fen, so a custom-setup game does not survive a
      // save/load round trip there. Ours persists it.
      initialFen: clamp(fields.initialFen, LIMITS.initialFen) || STANDARD_FEN,
      result: clamp(fields.result, LIMITS.result),
      whitePlayer: clamp(fields.whitePlayer, LIMITS.whitePlayer),
      blackPlayer: clamp(fields.blackPlayer, LIMITS.blackPlayer),
      whiteRating: intOrNull(fields.whiteRating),
      blackRating: intOrNull(fields.blackRating),
      eventName: clamp(fields.eventName, LIMITS.eventName),
      gameDate: clamp(fields.gameDate, 10),
      timeControl: clamp(fields.timeControl, LIMITS.timeControl),
      location: clamp(fields.location, LIMITS.location),
      roundInfo: clamp(fields.roundInfo, LIMITS.roundInfo),
      eco: clamp(fields.eco, LIMITS.eco),
      createdAt: now,
      updatedAt: now
    };
    // The server stores '*' as null (handleSave :1036); keep that so a round trip is stable.
    if (rec.result === '*') rec.result = null;
    if (rec.folderId != null && !folder(lib, rec.folderId)) rec.folderId = null;

    if (rec.id) {
      for (var i = 0; i < lib.sessions.length; i++) {
        if (lib.sessions[i].id === rec.id) {
          rec.createdAt = lib.sessions[i].createdAt;
          lib.sessions[i] = rec;
          return rec;
        }
      }
      // An id that is not here any more (deleted elsewhere) becomes an insert.
    }
    rec.id = lib.nextSessionId++;
    lib.sessions.push(rec);
    return rec;
  }

  function session(lib, id) {
    for (var i = 0; i < lib.sessions.length; i++) if (lib.sessions[i].id === id) return lib.sessions[i];
    return null;
  }

  function deleteSession(lib, id) {
    var before = lib.sessions.length;
    lib.sessions = lib.sessions.filter(function (s) { return s.id !== id; });
    return lib.sessions.length !== before;
  }

  /**
   * The library list. `filter` is `'all'`, `'unfiled'`, or a folder id. `search` is
   * case-insensitive across title, notes and both player names — the server's `ilike` set. Ordered
   * `updated_at` descending, ties broken by id descending so the order is total and stable.
   */
  function sessions(lib, filter, search) {
    var q = (search || '').trim().toLowerCase();
    var out = lib.sessions.filter(function (s) {
      if (filter === 'unfiled') { if (s.folderId !== null) return false; }
      else if (filter !== 'all' && filter !== undefined && filter !== null) {
        if (s.folderId !== filter) return false;
      }
      if (!q) return true;
      return [s.title, s.notes, s.whitePlayer, s.blackPlayer].some(function (v) {
        return v && String(v).toLowerCase().indexOf(q) >= 0;
      });
    });
    out.sort(function (a, b) {
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return b.id - a.id;
    });
    return out;
  }

  // ---- drafts -----------------------------------------------------------------

  function putDraft(lib, mode, draft, now) {
    lib.drafts[mode] = {
      pgn: draft.pgn || '',
      initialFen: draft.initialFen || STANDARD_FEN,
      timestamp: now,
      sessionId: draft.sessionId == null ? null : draft.sessionId,
      title: draft.title || null,
      notes: draft.notes || null,
      folderId: draft.folderId == null ? null : draft.folderId
    };
    return lib.drafts[mode];
  }

  /**
   * Read a draft, or null when there is none or it has expired.
   *
   * Expiry **prunes**: a stale draft is removed, matching the source, which deletes the key rather
   * than leaving it to be re-checked (board.tsx:727, :792). A missing timestamp counts as stale.
   */
  function draft(lib, mode, now, ttlMs) {
    var d = lib.drafts[mode];
    if (!d) return null;
    var ttl = (ttlMs === undefined) ? DRAFT_TTL_MS : ttlMs;
    if (!d.timestamp || (now - d.timestamp) > ttl) {
      delete lib.drafts[mode];
      return null;
    }
    return d;
  }

  function clearDraft(lib, mode) {
    if (!Object.prototype.hasOwnProperty.call(lib.drafts, mode)) return false;
    delete lib.drafts[mode];
    return true;
  }

  /** Is this draft worth writing? The source skips an empty board at the standard start (:828). */
  function draftWorthKeeping(pgn, initialFen) {
    if (pgn && pgn.trim()) return true;
    return !!initialFen && initialFen !== STANDARD_FEN;
  }

  /* ============================== self-check ============================== */

  /**
   * A canonical document, hardcoded IDENTICALLY here and in ParityRunner's `analysis_store` group.
   * Each language must decode it to the same records — a real cross-language contract rather than
   * two implementations agreeing with themselves. Keep the two copies byte-identical.
   *
   * What is deliberately NOT claimed is byte-identical re-encoding ACROSS languages: Swift's
   * `JSONEncoder(.sortedKeys)` orders keys alphabetically while `JSON.stringify` uses insertion
   * order, so the two differ by key order alone. Each side asserts its own round trip is a fixpoint;
   * the shared claim is the decoded values, which is the part a future sync depends on.
   */
  var CANONICAL = '{"version":1,"nextSessionId":3,"nextFolderId":5,'
    + '"folders":['
    + '{"id":1,"name":"Opening Repertoire","color":"#4CAF50","sortOrder":1,"isDefault":true,"createdAt":1000},'
    + '{"id":4,"name":"Endgames","color":"#FDB022","sortOrder":4,"isDefault":false,"createdAt":2000}],'
    + '"sessions":['
    + '{"id":1,"folderId":1,"title":"Najdorf line","notes":null,"pgn":"1. e4 c5 *",'
    + '"initialFen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",'
    + '"result":null,"whitePlayer":"Ana","blackPlayer":"Bo","whiteRating":1850,"blackRating":1720,'
    + '"eventName":"Club night","gameDate":"2026-02-14","timeControl":"15+10","location":"Cebu",'
    + '"roundInfo":"3","eco":"B90","createdAt":1000,"updatedAt":3000},'
    + '{"id":2,"folderId":null,"title":"Untitled Analysis","notes":"scratch","pgn":"1. d4 *",'
    + '"initialFen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",'
    + '"result":"1-0","whitePlayer":null,"blackPlayer":null,"whiteRating":null,"blackRating":null,'
    + '"eventName":null,"gameDate":null,"timeControl":null,"location":null,'
    + '"roundInfo":null,"eco":null,"createdAt":2000,"updatedAt":2000}],'
    + '"drafts":{}}';

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function eq(a, b, what) {
      expect(a === b, what + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
    }

    // 1. an empty library
    var lib = emptyLibrary();
    eq(lib.version, LIBRARY_VERSION, 'a fresh library carries its version');
    eq(lib.sessions.length, 0, 'no sessions');
    eq(lib.folders.length, 0, 'no folders');
    eq(sessions(lib, 'all').length, 0, 'the list is empty');
    eq(draft(lib, DRAFT_NEW, 0), null, 'and there is no draft');

    // 2. seeding is idempotent and matches the server's own three
    seedDefaultFolders(lib, 1000);
    eq(lib.folders.length, 3, 'three defaults are seeded');
    eq(folders(lib).map(function (f) { return f.name; }).join(', '),
       'Opening Repertoire, Setup Position, My Games', 'in the server\'s order');
    eq(folders(lib)[0].color, '#4CAF50', 'with its colour');
    expect(folders(lib).every(function (f) { return f.isDefault; }), 'all marked default');
    seedDefaultFolders(lib, 2000);
    eq(lib.folders.length, 3, 'seeding twice adds nothing');

    // 3. folder CRUD
    var custom = createFolder(lib, '  Endgames  ', null, 2000);
    eq(custom.name, 'Endgames', 'a new folder is trimmed');
    eq(custom.color, DEFAULT_FOLDER_COLOR, 'and gets the default colour');
    eq(custom.sortOrder, 4, 'sortOrder is max + 1');
    eq(custom.isDefault, false, 'and it is not a default');
    eq(createFolder(lib, '   ', null, 2000), null, 'a blank name is rejected');
    eq(createFolder(lib, 'x'.repeat(200), null, 2000).name.length, LIMITS.folderName,
       'a long name is clamped to the controller\'s limit');
    deleteFolder(lib, lib.folders[lib.folders.length - 1].id);       // drop the clamped one
    eq(renameFolder(lib, custom.id, 'Rook endings'), true, 'a custom folder renames');
    eq(folder(lib, custom.id).name, 'Rook endings', 'and keeps the new name');
    eq(renameFolder(lib, folders(lib)[0].id, 'Nope'), false, 'a DEFAULT folder refuses to rename');
    eq(deleteFolder(lib, folders(lib)[0].id), false, 'and refuses to delete');
    eq(renameFolder(lib, 9999, 'Ghost'), false, 'an unknown id refuses');

    // 4. saving
    var s1 = saveSession(lib, {
      pgn: '1. e4 c5 *', title: '  Najdorf line  ', folderId: custom.id,
      whitePlayer: 'Ana', blackPlayer: 'Bo', whiteRating: '1850', blackRating: 1720,
      eventName: 'Club night', gameDate: '2026-02-14', timeControl: '15+10',
      location: 'Cebu', roundInfo: '3', eco: 'B90'
    }, 1000);
    eq(s1.id, 1, 'the first session gets id 1');
    eq(s1.title, 'Najdorf line', 'the title is trimmed');
    eq(s1.whiteRating, 1850, 'a numeric string rating becomes a number');
    eq(s1.blackRating, 1720, 'and a number stays one');
    eq(s1.notes, null, 'an absent field is null, not ""');
    eq(s1.initialFen, STANDARD_FEN, 'initialFen defaults to the standard start');
    eq(s1.createdAt, 1000, 'createdAt is stamped');
    eq(s1.updatedAt, 1000, 'and so is updatedAt');
    eq(saveSession(lib, { pgn: '   ' }, 1000), null, 'a blank PGN is refused');
    eq(saveSession(lib, {}, 1000), null, 'and so is a missing one');

    var untitled = saveSession(lib, { pgn: '1. d4 *', notes: 'scratch', result: '1-0' }, 2000);
    eq(untitled.title, DEFAULT_TITLE, 'no title falls back to the controller\'s default');
    eq(untitled.folderId, null, 'and it is unfiled');
    eq(untitled.id, 2, 'ids keep counting');

    // '*' is stored as null, the way the source sends it
    eq(saveSession(lib, { pgn: '1. c4 *', result: '*' }, 2100).result, null,
       'a "*" result is stored as null');
    deleteSession(lib, 3);

    // 5. updating in place
    var updated = saveSession(lib, { id: s1.id, pgn: '1. e4 c5 2. Nf3 *', title: 'Najdorf line' }, 3000);
    eq(updated.id, s1.id, 'an existing id updates rather than inserting');
    eq(lib.sessions.length, 2, 'the count is unchanged');
    eq(updated.createdAt, 1000, 'createdAt is preserved');
    eq(updated.updatedAt, 3000, 'updatedAt moves');
    eq(updated.whitePlayer, null, 'fields absent from the update are cleared, as a PUT would');
    // ids are never reused: the '*'-result session above took 3 and was deleted, so this is 4.
    var ghost = saveSession(lib, { id: 9999, pgn: '1. f4 *' }, 3100);
    eq(ghost.id, 4, 'an id that no longer exists becomes an insert with a FRESH id');
    deleteSession(lib, ghost.id);

    // 6. filtering, search and order
    saveSession(lib, { id: s1.id, pgn: '1. e4 c5 2. Nf3 *', title: 'Najdorf line',
                       folderId: custom.id, whitePlayer: 'Zubov', blackPlayer: 'Bo' }, 3000);
    eq(sessions(lib, 'all').length, 2, 'all shows both');
    eq(sessions(lib, 'all')[0].id, s1.id, 'ordered by updatedAt descending');
    eq(sessions(lib, 'unfiled').length, 1, 'unfiled shows only the unfiled one');
    eq(sessions(lib, 'unfiled')[0].id, untitled.id, 'and it is the right one');
    eq(sessions(lib, custom.id).length, 1, 'a folder id filters to its own');
    eq(sessions(lib, 'all', 'najdorf').length, 1, 'search is case-insensitive on the title');
    eq(sessions(lib, 'all', 'ZUB').length, 1, 'and matches a player');
    eq(sessions(lib, 'all', 'scratch').length, 1, 'and the notes');
    // Substring, not word-prefix: "ana" matches inside "Untitled An-alysis" and nothing else here.
    // The server's `ilike '%term%'` behaves the same way, so the semantics are deliberate.
    eq(sessions(lib, 'all', 'ana').length, 1, 'it matches mid-word, as ilike %term% does');
    eq(sessions(lib, 'all', 'ana')[0].id, untitled.id, 'and it is the "Untitled Analysis" one');
    eq(sessions(lib, 'all', 'nothing here').length, 0, 'a miss returns nothing');
    eq(sessions(lib, custom.id, 'scratch').length, 0, 'filter and search combine');
    eq(sessionCount(lib, custom.id), 1, 'the chip count for a folder');
    eq(sessionCount(lib, null), 1, 'and for unfiled');

    // 7. deleting a folder UNFILES its games — it must never delete them
    eq(deleteFolder(lib, custom.id), true, 'a custom folder deletes');
    eq(lib.sessions.length, 2, 'its sessions survive');
    eq(session(lib, s1.id).folderId, null, 'and become unfiled');
    eq(sessionCount(lib, null), 2, 'so unfiled now holds both');
    eq(folder(lib, custom.id), null, 'the folder itself is gone');

    // a session pointing at a folder that does not exist lands unfiled
    eq(saveSession(lib, { pgn: '1. g3 *', folderId: 9999 }, 4000).folderId, null,
       'an unknown folderId is treated as unfiled');
    deleteSession(lib, lib.sessions[lib.sessions.length - 1].id);

    eq(deleteSession(lib, untitled.id), true, 'deleting reports success');
    eq(deleteSession(lib, untitled.id), false, 'deleting twice does not');
    eq(lib.sessions.length, 1, 'and the count drops');

    // 8. drafts — the TTL is why time is injected
    var d = emptyLibrary();
    putDraft(d, DRAFT_NEW, { pgn: '1. e4 *' }, 10000);
    expect(draft(d, DRAFT_NEW, 10000) !== null, 'a fresh draft reads back');
    eq(draft(d, DRAFT_NEW, 10000).pgn, '1. e4 *', 'with its PGN');
    eq(draft(d, DRAFT_NEW, 10000 + DRAFT_TTL_MS).pgn, '1. e4 *', 'exactly at the TTL it is still good');
    eq(draft(d, DRAFT_NEW, 10000 + DRAFT_TTL_MS + 1), null, 'one millisecond later it is stale');
    eq(d.drafts[DRAFT_NEW], undefined, 'and reading a stale draft PRUNES it');
    putDraft(d, DRAFT_NEW, { pgn: '1. e4 *' }, 10000);
    d.drafts[DRAFT_NEW].timestamp = 0;
    eq(draft(d, DRAFT_NEW, 10000), null, 'a missing timestamp counts as stale');

    putDraft(d, DRAFT_OPENFILE, { pgn: '1. d4 *', sessionId: 7, title: 'T', notes: 'N', folderId: 2 }, 5000);
    var od = draft(d, DRAFT_OPENFILE, 5000);
    eq(od.sessionId, 7, 'the openfile draft carries its session id');
    eq(od.title, 'T', 'its title');
    eq(od.folderId, 2, 'and its folder');
    // DEVIATION: the source writes this key and never reads it back (board.tsx:840 vs no getItem).
    expect(od !== null, 'and — unlike the source — it is readable');
    eq(draft(d, DRAFT_SETUP, 5000), null, 'the slots are independent');
    eq(clearDraft(d, DRAFT_OPENFILE), true, 'clearing reports success');
    eq(clearDraft(d, DRAFT_OPENFILE), false, 'clearing twice does not');

    eq(draftWorthKeeping('', STANDARD_FEN), false, 'an empty board at the start is not worth saving');
    eq(draftWorthKeeping('1. e4 *', STANDARD_FEN), true, 'moves are');
    eq(draftWorthKeeping('', '8/8/8/8/8/8/8/K6k w - - 0 1'), true, 'so is a custom start with no moves');

    // 9. normalize — a corrupt document must degrade, not throw
    eq(normalize(null).sessions.length, 0, 'null becomes an empty library');
    eq(normalize('nonsense').folders.length, 0, 'so does a string');
    eq(normalize({ sessions: 'no' }).sessions.length, 0, 'and a wrong-typed field');
    var recovered = normalize({ sessions: [{ id: 9 }], folders: [{ id: 4 }] });
    eq(recovered.nextSessionId, 10, 'next ids recover past the highest present');
    eq(recovered.nextFolderId, 5, 'for folders too');

    // 10. the canonical document — the cross-language contract
    var parsed = normalize(JSON.parse(CANONICAL));
    eq(parsed.sessions.length, 2, 'the canonical document has two sessions');
    eq(parsed.folders.length, 2, 'and two folders');
    eq(parsed.nextSessionId, 3, 'its next session id');
    eq(parsed.nextFolderId, 5, 'and next folder id');
    eq(session(parsed, 1).title, 'Najdorf line', 'session 1 is the Najdorf');
    eq(session(parsed, 1).whiteRating, 1850, 'with its rating as a number');
    eq(session(parsed, 1).eco, 'B90', 'and its ECO');
    eq(session(parsed, 2).folderId, null, 'session 2 is unfiled');
    eq(session(parsed, 2).result, '1-0', 'and decisive');
    eq(sessions(parsed, 'all')[0].id, 1, 'the newest-updated sorts first');
    eq(sessions(parsed, 'unfiled').length, 1, 'one is unfiled');
    eq(sessionCount(parsed, 1), 1, 'folder 1 holds one game');
    eq(JSON.stringify(parsed), CANONICAL,
       'and re-encoding reproduces the canonical string byte for byte');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisStoreSelfTest: ' + passed + ' assertions passed'
        : 'AnalysisStoreSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  /* ============================== storage ============================== */
  // The only impure part. Everything above is a pure function of its arguments.

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return emptyLibrary();
    }
  }
  function persist(lib) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lib)); return true; }
    catch (e) { return false; }
  }
  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  return {
    // constants
    STORAGE_KEY: STORAGE_KEY, LIBRARY_VERSION: LIBRARY_VERSION, LIMITS: LIMITS,
    DRAFT_NEW: DRAFT_NEW, DRAFT_SETUP: DRAFT_SETUP, DRAFT_OPENFILE: DRAFT_OPENFILE,
    DRAFT_TTL_MS: DRAFT_TTL_MS, DRAFT_DEBOUNCE_MS: DRAFT_DEBOUNCE_MS,
    DEFAULT_TITLE: DEFAULT_TITLE, DEFAULT_FOLDERS: DEFAULT_FOLDERS, CANONICAL: CANONICAL,
    // pure
    emptyLibrary: emptyLibrary, normalize: normalize,
    seedDefaultFolders: seedDefaultFolders, folders: folders, folder: folder,
    createFolder: createFolder, renameFolder: renameFolder, deleteFolder: deleteFolder,
    sessionCount: sessionCount,
    saveSession: saveSession, session: session, deleteSession: deleteSession, sessions: sessions,
    putDraft: putDraft, draft: draft, clearDraft: clearDraft, draftWorthKeeping: draftWorthKeeping,
    selfTest: selfTest,
    // storage
    load: load, persist: persist, reset: reset
  };
})();

/* Makes the pure layer runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaAnalysisStore; }
