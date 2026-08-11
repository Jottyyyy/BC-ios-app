#!/usr/bin/env node
/*
 * puzzle_corpus_check.js — the bundled puzzle corpus, asserted rather than eyeballed.
 *
 *     node tools/qa/puzzle_corpus_check.js
 *
 * Part 3.2 of the spec ends "Log the final per-band and per-theme counts as build output so
 * regressions are visible". A log is only visible if someone reads it, and nobody reads a
 * 60-line histogram twice. Everything the build prints is an assertion here instead.
 *
 * This gate matters more than its size suggests: every later assertion in this feature — the
 * selectors, the session, the streak ramp, the daily index — is stated against this corpus. A
 * silently truncated or mis-filtered DB would make all of them pass while the app served nothing.
 *
 * The strongest check in the file is not a count. It replays whole puzzle lines through
 * `web-demo/js/engine.js`, the same engine the app solves with, and proves that
 *   (a) every stored move is legal in the position it is played from, and
 *   (b) `moves[0]` belongs to the OPPONENT — the Part 5.1 convention the entire solver rests on.
 * Nothing else in the repo would notice if that convention broke; the board would simply refuse
 * every correct answer.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
// An alternate DB may be passed as argv[2], the same way ParityRunner takes an alternate goldens
// directory. That is how the mutation run below proves this gate is not vacuous.
const DB_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'puzzles.sqlite');
const SLICE_PATH = path.join(ROOT, 'web-demo', 'js', 'puzzle-data.js');
const E = require(path.join(ROOT, 'web-demo', 'js', 'engine.js'));

// Mirrors of the build script's constants. Deliberately re-typed rather than imported — a gate
// that reads its expectations out of the thing it is checking cannot fail.
const BAND_LO = 400, BAND_SIZE = 100, BAND_COUNT = 22, PER_BAND = 4000;
const RATING_FLOOR = 400, RATING_CEIL = 2800;
const THEME_QUOTA = 3000, WARMUP_QUOTA = 2000;
const UI_THEMES = ['hangingPiece', 'crushing', 'fork', 'pin', 'skewer', 'discoveredAttack',
                   'advantage', 'endgame', 'backRankMate', 'mateIn1', 'mateIn2', 'middlegame'];
const DAILY = { lo: 1200, hi: 1900, minPlays: 500, minPop: 90, maxPlies: 6, target: 3000 };
const SCHEMA_VERSION = 2;

// Total: the spec's prose estimates 95,000-105,000, but its own step-2 arithmetic fixes the base
// at 22 x 4,000 = 88,000 and every later step is a FLOOR, not a target — so the rules as written
// produce ~93k and the prose was an over-estimate. The bound below is what the rules actually
// yield, with headroom; it is not the prose relaxed to fit.
const TOTAL_MIN = 90_000, TOTAL_MAX = 105_000;
const SIZE_MIN_MB = 25, SIZE_MAX_MB = 35;

// Every theme rarer than 1,000 rows in the RAW 550k corpus is swept in entire, so the count in
// the DB must equal the count of ELIGIBLE rows carrying it. Measured once from the CSV; pinned
// here so a change to the corpus, the eligibility filter, or the sweep is loud.
// Regenerate with: tools/puzzlebank/build_puzzles.py (its per-theme report lists them, marked r).
// NOTE `anastasiaMate` is rare by the rule (636 raw) but is absent from the spec's hand-written
// list of twelve — the rule is implemented, the list is not.
const RARE_EXACT = {
  hookMate: 832, enPassant: 656, anastasiaMate: 616, arabianMate: 607, mateIn5: 518,
  killBoxMate: 363, dovetailMate: 336, bodenMate: 315, doubleBishopMate: 315, superGM: 302,
  castling: 219, vukovicMate: 180, underPromotion: 96,
};

const SAMPLE_LINES = 600;      // puzzles replayed move-by-move through the real engine

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want, `${what}: got ${got}, want ${want}`);

function run() {
  if (!fs.existsSync(DB_PATH)) {
    return finish([`${path.relative(ROOT, DB_PATH)} is missing — run `
      + `python tools/puzzlebank/build_puzzles.py`]);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0];
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  // ---- 1. schema -----------------------------------------------------------------
  {
    const tables = new Set(all(`SELECT name FROM sqlite_master WHERE type='table'`).map(r => r.name));
    for (const t of ['puzzles', 'puzzle_themes', 'theme_rating_index', 'daily_pool']) {
      expect(tables.has(t), `table ${t} exists`);
    }
    const cols = all(`PRAGMA table_info(puzzles)`).map(c => c.name).join(',');
    eq(cols, 'id,lichess_id,fen,moves,rating,popularity,nb_plays,opening_tags',
       'puzzles columns match Part 3.2 exactly');
    eq(one(`PRAGMA user_version`), SCHEMA_VERSION, 'user_version');

    // The two theme tables are WITHOUT ROWID. That is what brings the build from 50 MB to 33 MB,
    // and losing it silently would blow the size budget with nothing else changing.
    for (const t of ['puzzle_themes', 'theme_rating_index']) {
      const ddl = one(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, t);
      expect(/WITHOUT\s+ROWID/i.test(ddl), `${t} is WITHOUT ROWID`);
      expect(/PRIMARY\s+KEY/i.test(ddl), `${t} declares its composite primary key`);
    }
    const idx = new Set(all(`SELECT name FROM sqlite_master WHERE type='index'`)
                        .map(r => r.name).filter(n => n && !n.startsWith('sqlite_')));
    expect(idx.has('idx_puzzles_rating'), 'idx_puzzles_rating exists');
    expect(idx.has('idx_themes_theme_rating'), 'idx_themes_theme_rating exists');
  }

  // ---- 2. size and total ----------------------------------------------------------
  const total = one(`SELECT COUNT(*) FROM puzzles`);
  {
    expect(total >= TOTAL_MIN && total <= TOTAL_MAX,
      `total puzzles in [${TOTAL_MIN}, ${TOTAL_MAX}]: got ${total}`);
    const mb = fs.statSync(DB_PATH).size / (1024 * 1024);
    expect(mb >= SIZE_MIN_MB && mb <= SIZE_MAX_MB,
      `DB size in [${SIZE_MIN_MB}, ${SIZE_MAX_MB}] MB: got ${mb.toFixed(1)}`);
    // Dense 1..N. `PuzzleServing.closestByAbs` breaks ties on ascending id, so a gap is not
    // cosmetic — it changes which puzzle a tie resolves to.
    eq(one(`SELECT MIN(id) FROM puzzles`), 1, 'ids start at 1');
    eq(one(`SELECT MAX(id) FROM puzzles`), total, 'ids are dense 1..N');
    // ...and rise with rating, which is what makes a BETWEEN scan touch contiguous pages.
    eq(one(`SELECT COUNT(*) FROM puzzles a JOIN puzzles b ON b.id = a.id + 1
            WHERE b.rating < a.rating`), 0, 'ids are assigned in rating order');
  }

  // ---- 3. eligibility filter held --------------------------------------------------
  {
    eq(one(`SELECT COUNT(*) FROM puzzles WHERE rating < ? OR rating > ?`,
           RATING_FLOOR, RATING_CEIL), 0, `every rating in ${RATING_FLOOR}..${RATING_CEIL}`);
    eq(one(`SELECT COUNT(*) FROM puzzles WHERE nb_plays < 50`), 0, 'every nb_plays >= 50');
    eq(one(`SELECT COUNT(*) FROM puzzles WHERE fen IS NULL OR fen = '' OR moves IS NULL OR moves = ''`),
       0, 'no empty FEN or move list');
    eq(one(`SELECT COUNT(*) FROM puzzles WHERE opening_tags = ''`), 0,
       'empty opening_tags is stored as NULL, never as an empty string');
  }

  // ---- 4. bands ---------------------------------------------------------------------
  {
    // Bucketed in JS, not in SQL: `node:sqlite` binds a JS number as REAL, so a parameterised
    // `(rating - ?) / ?` silently becomes float division and every rating lands in its own band.
    const byBand = new Map();
    for (const r of all(`SELECT rating, COUNT(*) AS n FROM puzzles
                         WHERE rating < ${BAND_LO + BAND_COUNT * BAND_SIZE} GROUP BY rating`)) {
      const b = Math.floor((r.rating - BAND_LO) / BAND_SIZE);
      byBand.set(b, (byBand.get(b) || 0) + r.n);
    }
    for (let b = 0; b < BAND_COUNT; b++) {
      const n = byBand.get(b) || 0;
      expect(n >= PER_BAND,
        `band ${BAND_LO + b * BAND_SIZE}-${BAND_LO + b * BAND_SIZE + BAND_SIZE - 1} `
        + `has >= ${PER_BAND}: got ${n}`);
    }
    eq(byBand.size, BAND_COUNT, 'exactly 22 bands are populated below 2600');
    // The 2600-2800 tail is reachable only through the top-ups, by design; it must not be empty
    // or a 2700-rated user's +-100 window is void.
    expect(one(`SELECT COUNT(*) FROM puzzles WHERE rating >= 2600`) > 0,
      'the 2600-2800 tail is non-empty');
  }

  // ---- 5. theme quotas, warmup, rare sweep --------------------------------------------
  {
    for (const t of UI_THEMES) {
      const n = one(`SELECT COUNT(*) FROM theme_rating_index WHERE theme = ?`, t);
      expect(n >= THEME_QUOTA, `UI theme ${t} has >= ${THEME_QUOTA}: got ${n}`);
    }
    const warm = one(`SELECT COUNT(*) FROM theme_rating_index
                      WHERE theme = 'mateIn1' AND rating BETWEEN 500 AND 700`);
    expect(warm >= WARMUP_QUOTA,
      `mateIn1 @500-700 warmup pool >= ${WARMUP_QUOTA}: got ${warm}`);
    for (const [t, want] of Object.entries(RARE_EXACT)) {
      eq(one(`SELECT COUNT(*) FROM theme_rating_index WHERE theme = ?`, t), want,
         `rare theme ${t} is swept in entire`);
    }
  }

  // ---- 6. the two theme tables agree, with each other and with puzzles -----------------
  {
    eq(one(`SELECT COUNT(*) FROM puzzle_themes`), one(`SELECT COUNT(*) FROM theme_rating_index`),
       'puzzle_themes and theme_rating_index have the same row count');
    eq(one(`SELECT COUNT(*) FROM theme_rating_index t
            LEFT JOIN puzzle_themes p ON p.puzzle_id = t.puzzle_id AND p.theme = t.theme
            WHERE p.puzzle_id IS NULL`), 0, 'every tri row has its puzzle_themes twin');
    // The denormalised rating is the whole reason tri exists; a stale copy would serve puzzles
    // from outside the requested window while every count above still looked right.
    eq(one(`SELECT COUNT(*) FROM theme_rating_index t JOIN puzzles p ON p.id = t.puzzle_id
            WHERE p.rating <> t.rating`), 0, 'tri.rating always matches puzzles.rating');
    eq(one(`SELECT COUNT(*) FROM puzzle_themes p
            LEFT JOIN puzzles z ON z.id = p.puzzle_id WHERE z.id IS NULL`), 0,
       'no orphan theme rows');
    expect(one(`SELECT COUNT(DISTINCT theme) FROM theme_rating_index`) >= 55,
      'the corpus still spans essentially all 62 Lichess themes');
  }

  // ---- 7. the hot queries SEEK — this is spec fix #15, structurally -------------------
  // The bug being prevented: themes stored as an unindexed blob, so every thematic serve scanned
  // the whole table. A count assertion cannot catch that regression; only the plan can.
  {
    const plan = (sql, ...a) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...a)
                                  .map(r => r.detail).join(' | ');
    const rated = plan(`SELECT id FROM puzzles WHERE rating BETWEEN ? AND ? LIMIT 1`, 1100, 1300);
    expect(/SEARCH/.test(rated) && !/SCAN puzzles/.test(rated),
      `the rated serve seeks: ${rated}`);
    const thematic = plan(`SELECT puzzle_id FROM theme_rating_index
                           WHERE theme = ? AND rating BETWEEN ? AND ? LIMIT 1`, 'fork', 1100, 1300);
    expect(/SEARCH/.test(thematic) && !/SCAN/.test(thematic),
      `the thematic serve seeks: ${thematic}`);
    const themesOf = plan(`SELECT theme FROM puzzle_themes WHERE puzzle_id = ?`, 1);
    expect(/SEARCH/.test(themesOf) && !/SCAN/.test(themesOf),
      `puzzle -> themes seeks: ${themesOf}`);
    const daily = plan(`SELECT puzzle_id FROM daily_pool WHERE day_index = ?`, 0);
    expect(/SEARCH/.test(daily) && !/SCAN/.test(daily), `the daily lookup seeks: ${daily}`);
  }

  // ---- 8. daily_pool -------------------------------------------------------------------
  {
    const n = one(`SELECT COUNT(*) FROM daily_pool`);
    expect(n >= DAILY.target, `daily_pool >= ${DAILY.target}: got ${n}`);
    eq(one(`SELECT MIN(day_index) FROM daily_pool`), 0, 'day_index starts at 0');
    eq(one(`SELECT MAX(day_index) FROM daily_pool`), n - 1, 'day_index is dense 0..N-1');
    eq(one(`SELECT COUNT(*) FROM (SELECT puzzle_id FROM daily_pool GROUP BY puzzle_id
            HAVING COUNT(*) > 1)`), 0, 'no puzzle appears on two days');
    eq(one(`SELECT COUNT(*) FROM daily_pool d LEFT JOIN puzzles p ON p.id = d.puzzle_id
            WHERE p.id IS NULL`), 0, 'every daily entry resolves to a real puzzle');
    eq(one(`SELECT COUNT(*) FROM daily_pool d JOIN puzzles p ON p.id = d.puzzle_id
            WHERE p.rating < ? OR p.rating > ? OR p.nb_plays < ? OR p.popularity < ?`,
           DAILY.lo, DAILY.hi, DAILY.minPlays, DAILY.minPop), 0,
       'every daily puzzle satisfies the Part 11.1 filter');
    const longOnes = all(`SELECT p.moves FROM daily_pool d JOIN puzzles p ON p.id = d.puzzle_id`)
      .filter(r => r.moves.split(' ').length > DAILY.maxPlies).length;
    eq(longOnes, 0, `every daily puzzle is <= ${DAILY.maxPlies} plies`);
    // Shuffled, not sorted: consecutive days must not walk the corpus in id order, or "today's
    // puzzle" becomes a slow crawl up the rating ladder.
    const first = all(`SELECT puzzle_id FROM daily_pool ORDER BY day_index LIMIT 200`)
      .map(r => r.puzzle_id);
    const ascending = first.every((v, i) => i === 0 || v > first[i - 1]);
    expect(!ascending, 'the daily pool is shuffled, not left in id order');
  }

  // ---- 9. the move convention — EVERY row, not a sample -----------------------------------
  // Part 5.1 ("moves[0] belongs to the opponent") is the load-bearing assumption of all five
  // modes: get it wrong and the board rejects every correct answer. It was checked only inside
  // the sampled replay below until a mutation that swapped moves[0] and moves[1] on 5% of rows
  // SURVIVED — the stride sample took ids = 1 (mod 154), always odd, and the mutation hit ids
  // = 0 (mod 20), always even, so the two could not intersect by construction. A property this
  // important does not get sampled.
  {
    let odd = 0, badToken = 0, tooShort = 0, unparseable = 0, wrongOwner = 0, emptyFrom = 0;
    const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
    for (const r of all(`SELECT fen, moves FROM puzzles`)) {
      const mv = r.moves.split(' ');
      if (mv.length % 2 !== 0) odd++;
      if (mv.length < 2) { tooShort++; continue; }
      let ok = true;
      for (const m of mv) if (!uci.test(m)) { badToken++; ok = false; }
      if (!ok) continue;
      const pos = E.fromFEN(r.fen);
      if (!pos) { unparseable++; continue; }
      // Full legality needs the engine's move generator (sampled below); ownership of the
      // from-square is a board lookup, so it is affordable across the whole corpus — and it is
      // exactly the bit that pins the convention.
      const piece = pos.squares[E.sqIndex(mv[0].slice(0, 2))];
      if (!piece) emptyFrom++;
      else if (piece.color !== pos.sideToMove) wrongOwner++;
    }
    eq(odd, 0, 'every puzzle has an even move count (Part 5.1 is structural)');
    eq(tooShort, 0, 'every puzzle has at least an opponent move and one answer');
    eq(badToken, 0, 'every move is well-formed UCI');
    eq(unparseable, 0, 'every FEN in the corpus parses');
    eq(emptyFrom, 0, "moves[0] never starts from an empty square");
    eq(wrongOwner, 0, 'moves[0] belongs to the side to move — i.e. to the OPPONENT (Part 5.1)');
  }

  // ---- 10. replay whole lines through the engine the app solves with ----------------------
  // Evenly spaced by ORDINAL, not by `id % stride`: a fixed-offset modulus samples one residue
  // class and is blind to the others (see the note in section 9).
  {
    const ids = [];
    for (let i = 0; i < SAMPLE_LINES; i++) ids.push(Math.round((i + 0.5) * total / SAMPLE_LINES));
    const rows = all(`SELECT id, fen, moves, rating FROM puzzles
                      WHERE id IN (${ids.join(',')})`);
    expect(rows.length >= SAMPLE_LINES * 0.9,
      `sampled ${rows.length} lines evenly across the corpus`);
    expect(rows.some(r => r.id % 2 === 0) && rows.some(r => r.id % 2 === 1),
      'the sample spans both id parities');
    let illegal = 0, wrongMover = 0, terminalStart = 0, solverNotLast = 0;
    let mateEnd = 0;
    for (const r of rows) {
      const pos0 = E.fromFEN(r.fen);
      if (!pos0) { illegal++; continue; }
      // Part 5.1: the FEN's side to move is the OPPONENT, so the solver is the other colour.
      const solver = E.opponent(pos0.sideToMove);
      if (E.status(pos0) === 'checkmate' || E.status(pos0) === 'stalemate') { terminalStart++; }
      let pos = pos0;
      const mv = r.moves.split(' ');
      let failedAt = -1;
      for (let i = 0; i < mv.length; i++) {
        const expectMover = (i % 2 === 0) ? pos0.sideToMove : solver;
        if (pos.sideToMove !== expectMover) { wrongMover++; break; }
        const m = E.parseUci(pos, mv[i]);
        if (!m) { failedAt = i; break; }
        pos = E.makeMove(pos, m);
      }
      if (failedAt >= 0) { illegal++; continue; }
      // The last move in the list is the solver's — that is what makes
      // "solved when currentMoveIndex >= moves.count - 1" correct.
      if ((mv.length - 1) % 2 === 0) solverNotLast++;
      if (E.status(pos) === 'checkmate') mateEnd++;
    }
    eq(illegal, 0, 'every sampled move is legal in the position it is played from');
    eq(wrongMover, 0, 'moves alternate opponent/solver exactly as Part 5.1 specifies');
    eq(solverNotLast, 0, 'the last move of every line belongs to the solver');
    eq(terminalStart, 0, 'no puzzle starts from a finished position');
    expect(mateEnd > 0, `some sampled lines end in mate (got ${mateEnd}) — the sample is real`);
  }

  db.close();

  // ---- 11. the web-demo slice -------------------------------------------------------------
  {
    if (!fs.existsSync(SLICE_PATH)) {
      failures.push(`${path.relative(ROOT, SLICE_PATH)} is missing — the build script writes it`);
    } else {
      const D = require(SLICE_PATH);
      expect(D.isSlice === true, 'the slice flags itself as a slice, not the corpus');
      eq(D.corpusTotal, total, 'the slice records the real corpus size for the UI to disclose');
      expect(D.puzzles.length >= 1200 && D.puzzles.length <= 4000,
        `slice size is demo-sized: got ${D.puzzles.length}`);
      const ids = D.puzzles.map(p => p.id);
      eq(Math.min(...ids), 1, 'slice ids start at 1');
      eq(Math.max(...ids), D.puzzles.length, 'slice ids are dense');
      expect(D.puzzles.every(p => p.id === D.byId[p.id].id), 'byId resolves every puzzle');

      const bands = new Set(D.puzzles.filter(p => p.rating < BAND_LO + BAND_COUNT * BAND_SIZE)
                            .map(p => Math.floor((p.rating - BAND_LO) / BAND_SIZE)));
      eq(bands.size, BAND_COUNT, 'the slice covers all 22 rating bands');
      for (const t of UI_THEMES) {
        const n = D.puzzles.filter(p => p.themes.includes(t)).length;
        expect(n >= 40, `slice has enough ${t} to exercise the thematic selector: got ${n}`);
      }
      const warm = D.puzzles.filter(p => p.themes.includes('mateIn1')
                                    && p.rating >= 500 && p.rating <= 700).length;
      expect(warm >= 100, `slice covers the Streak/Turbo warmup: got ${warm}`);
      expect(D.dailyPool.length > 0 && D.dailyPool.every(id => !!D.byId[id]),
        'the slice daily pool resolves');
      eq(D.dailyPoolTotal > D.dailyPool.length, true,
        'the slice discloses that the device pool is larger');

      // The slice must be the real corpus, not a re-generated approximation of it.
      let bad = 0;
      for (const p of D.puzzles) {
        const pos = E.fromFEN(p.fen);
        if (!pos) { bad++; continue; }
        if (p.moves.length % 2 !== 0) { bad++; continue; }
        if (!E.parseUci(pos, p.moves[0])) bad++;
      }
      eq(bad, 0, 'every slice puzzle parses and its opponent move is legal');
    }
  }

  return finish(failures);
}

function finish(fails) {
  const ok = fails.length === 0;
  return {
    passed, failures: fails, ok,
    summary: ok
      ? `PuzzleCorpus: ${passed} assertions passed`
      : `PuzzleCorpus: ${passed} passed, ${fails.length} FAILED\n`
        + fails.map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
