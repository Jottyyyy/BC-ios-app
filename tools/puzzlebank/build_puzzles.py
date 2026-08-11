#!/usr/bin/env python3
"""Build the bundled, curated puzzles.sqlite from the Lichess-format byahero_puzzle.csv.

    python tools/puzzlebank/build_puzzles.py [--csv IN] [--db OUT] [--slice OUT.js] [--no-slice]

Implements Part 3.2 of the Puzzle Hub spec: 550,000 raw rows -> ~95,000 curated ones, in a schema
whose thematic query is an index seek rather than the 550k sequential scan the old JSON-blob column
forced (spec fix #15).

WHY THIS REPLACED THE OLD SCRIPT
--------------------------------
The previous version imported all 550,000 rows keeping only FEN/Moves/Rating/Themes/OpeningTags.
That is unusable for this feature on three counts: it dropped `Popularity` and `NbPlays`, which are
the only signal available for picking the *good* 100k out of 550k; it stored themes as one
space-separated string with no index; and at 84 MB it was most of the app download. It also had
hardcoded macOS paths (flagged in CLAUDE.md). All four are fixed here.

DETERMINISM
-----------
Same CSV in, byte-identical SQLite out. Three things buy that:
  * the quality score is quantised to an integer before it is ever used as a sort key, so the
    ordering cannot depend on a platform libm's last-ULP behaviour in log10();
  * every sort has an explicit final tie-break on `lichess_id`, because Python's sort is stable but
    the *input* order is only stable if you never rely on it;
  * `daily_pool` is shuffled with a splitmix64 Fisher-Yates written out below rather than with
    `random.shuffle`, so the layout does not depend on the CPython version.
A SQLite file carries no timestamp, so a fixed page size plus a fixed insert order plus VACUUM
gives a reproducible byte stream.

THE DB IS COMMITTED ON PURPOSE
------------------------------
`codemagic.yaml` builds the iOS app from a clone of THIS repo alone; the source CSV lives in the
sibling Laravel repo, which CI never sees. So the generated .sqlite has to be tracked, unlike
`Goldens/`. Keeping it small is the whole point of curating it.
"""

import argparse
import csv
import math
import os
import sqlite3
import sys
import time
from collections import Counter, defaultdict

# --- Selection constants (Part 3.2). Invented values are recorded in PORTING_NOTES.md. --------

MIN_NB_PLAYS = 50            # below this the Lichess rating has not settled
RATING_FLOOR = 400           # 457 rows below; unusable for a coaching app
RATING_CEIL = 2800           # 131 rows above 3000
BAND_LO = 400                # 22 bands of 100 points: [400,500) .. [2500,2600)
BAND_SIZE = 100
BAND_COUNT = 22
PER_BAND = 4000              # 22 x 4000 = 88,000 before the top-ups
THEME_QUOTA = 3000           # minimum survivors per UI theme
WARMUP_QUOTA = 2000          # mateIn1 @ 500..700 — Streak and Turbo both open here
WARMUP_THEME = "mateIn1"
WARMUP_LO, WARMUP_HI = 500, 700
RARE_THRESHOLD = 1000        # a theme rarer than this in the RAW corpus is taken entire

# Part 12.1 — the 12 themes the Thematic grid offers. Ids only; labels/colors live in the UI.
UI_THEMES = ["hangingPiece", "crushing", "fork", "pin", "skewer", "discoveredAttack",
             "advantage", "endgame", "backRankMate", "mateIn1", "mateIn2", "middlegame"]

# The spec lists these twelve as the rare themes. They are NOT the rule — the rule is
# "corpus count < RARE_THRESHOLD" and it is computed below. The list is kept only so the build
# can shout when the computed set and the documented set disagree, which is how `anastasiaMate`
# (636 rows, absent from the spec's list) was found.
SPEC_RARE_THEMES = ["enPassant", "arabianMate", "hookMate", "killBoxMate", "bodenMate",
                    "vukovicMate", "dovetailMate", "doubleBishopMate", "castling",
                    "underPromotion", "mateIn5", "superGM"]

# Part 11.1 — the deterministic daily pool.
DAILY_RATING_LO, DAILY_RATING_HI = 1200, 1900
DAILY_MIN_NB_PLAYS = 500
DAILY_MIN_POPULARITY = 90
DAILY_MAX_PLIES = 6
DAILY_TARGET = 3000
DAILY_SHUFFLE_SEED = 0x8172_3F5A_0C21_9E4D   # fixed forever: changing it reshuffles every date

# web-demo slice (Windows browser preview — a 30 MB SQLite cannot load in a page).
SLICE_PER_BAND = 60
SLICE_PER_THEME = 80
SLICE_WARMUP = 120
SLICE_DAILY = 400          # >= 365 so the demo's Daily mode covers a year without wrapping

SCHEMA_VERSION = 2           # -> PRAGMA user_version; bump when the schema below changes

# CSV column indices — header:
# PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
C_ID, C_FEN, C_MOVES, C_RATING, C_POPULARITY, C_NBPLAYS, C_THEMES, C_OPENING = 0, 1, 2, 3, 5, 6, 7, 9

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_CSV = os.path.join(REPO, "..", "BYAHERONG-COACH-LARAVEL",
                           "database", "seeders", "data", "byahero_puzzle.csv")
DEFAULT_DB = os.path.join(REPO, "DemoApp", "Sources", "BiyaherongUI", "puzzles.sqlite")
DEFAULT_SLICE = os.path.join(REPO, "web-demo", "js", "puzzle-data.js")

SCHEMA = """
CREATE TABLE puzzles (
    id           INTEGER PRIMARY KEY,   -- dense 1..N, assigned at build time
    lichess_id   TEXT    NOT NULL,      -- e.g. "0aFb4"
    fen          TEXT    NOT NULL,      -- 6-field FEN, position BEFORE the opponent's setup move
    moves        TEXT    NOT NULL,      -- space-separated UCI, e.g. "d7b6 d5f7"
    rating       INTEGER NOT NULL,
    popularity   INTEGER NOT NULL,
    nb_plays     INTEGER NOT NULL,
    opening_tags TEXT                   -- space-separated, NULL when empty
);
-- WITHOUT ROWID on both theme tables. This is a STORAGE class, not a schema change: the columns,
-- the constraints and every query in Part 7 are identical, SQLite just keys the table B-tree on the
-- declared PK instead of on a hidden rowid, so the row is stored once rather than twice. Spelled
-- out because the saving is not marginal — the spec's literal schema builds to 50 MB against a
-- stated 25-35 MB target, and these two clauses are the entire difference:
--     puzzles + idx_puzzles_rating       11.2 MB
--     puzzle_themes  rowid 21.2 MB  ->   13.5 MB
--     theme_rating_index rowid 17.4 MB -> 8.0 MB
-- Both composite keys are genuinely unique in the corpus (432,507 rows, 432,507 distinct), so the
-- PK also becomes a real duplicate-theme guard the rowid version could not give.
CREATE TABLE puzzle_themes (
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    theme     TEXT    NOT NULL,
    PRIMARY KEY (puzzle_id, theme)
) WITHOUT ROWID;
-- Denormalized so the hot thematic query never joins.
CREATE TABLE theme_rating_index (
    theme     TEXT    NOT NULL,
    rating    INTEGER NOT NULL,
    puzzle_id INTEGER NOT NULL,
    PRIMARY KEY (theme, rating, puzzle_id)
) WITHOUT ROWID;
CREATE TABLE daily_pool (
    day_index INTEGER PRIMARY KEY,      -- 0..N-1, stable forever
    puzzle_id INTEGER NOT NULL
);
"""

# Two of the spec's four indexes are now the tables' own primary keys and are not restated:
#   idx_themes_puzzle  -> puzzle_themes PK (puzzle_id, theme) leading column
#   idx_tri            -> theme_rating_index PK (theme, rating, ...) leading columns
# Declaring them again would build a second B-tree over columns SQLite already has in order.
INDEXES = """
CREATE INDEX idx_puzzles_rating      ON puzzles(rating);
CREATE INDEX idx_themes_theme_rating ON puzzle_themes(theme, puzzle_id);
"""


# --- Deterministic shuffle ---------------------------------------------------------------------

def splitmix64(state):
    """A 64-bit PRNG with no library dependency, so the daily pool's order is pinned to this file
    rather than to whichever CPython built it."""
    mask = (1 << 64) - 1
    while True:
        state = (state + 0x9E3779B97F4A7C15) & mask
        z = state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & mask
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & mask
        yield z ^ (z >> 31)


def deterministic_shuffle(items, seed):
    rng = splitmix64(seed)
    for i in range(len(items) - 1, 0, -1):
        j = next(rng) % (i + 1)
        items[i], items[j] = items[j], items[i]
    return items


# --- Row model ----------------------------------------------------------------------------------

class Row:
    """One eligible puzzle. `__slots__` matters: 476k of these live in memory at once."""
    __slots__ = ("lid", "fen", "moves", "rating", "pop", "nb", "themes", "opening", "quality", "band")

    def __init__(self, lid, fen, moves, rating, pop, nb, themes, opening):
        self.lid, self.fen, self.moves = lid, fen, moves
        self.rating, self.pop, self.nb = rating, pop, nb
        self.themes, self.opening = themes, opening
        # Quantised to an integer BEFORE it is ever compared: log10 is the one place a platform's
        # libm could differ in the last ULP and silently reorder two rows across machines.
        self.quality = int(round(pop * math.log10(max(nb, 10)) * 1_000_000))
        b = (rating - BAND_LO) // BAND_SIZE
        self.band = b if 0 <= b < BAND_COUNT else BAND_COUNT   # BAND_COUNT == the 2600..2800 tail


def sort_key(r):
    """Best first. The `lid` tie-break is what makes the whole build reproducible."""
    return (-r.quality, r.lid)


# --- Load ----------------------------------------------------------------------------------------

def load(csv_path):
    csv.field_size_limit(10 ** 7)
    rows, raw_theme_counts, skipped = [], Counter(), 0
    intern = sys.intern
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        if header[C_ID] != "PuzzleId" or header[C_THEMES] != "Themes":
            raise SystemExit(f"unexpected CSV header: {header}")
        for rec in reader:
            if len(rec) <= C_OPENING:
                skipped += 1
                continue
            try:
                rating = int(rec[C_RATING]); pop = int(rec[C_POPULARITY]); nb = int(rec[C_NBPLAYS])
            except ValueError:
                skipped += 1
                continue
            themes = tuple(intern(t) for t in rec[C_THEMES].split())
            for t in themes:
                raw_theme_counts[t] += 1
            if nb < MIN_NB_PLAYS or rating < RATING_FLOOR or rating > RATING_CEIL:
                continue
            if not rec[C_FEN] or not rec[C_MOVES]:
                skipped += 1
                continue
            rows.append(Row(rec[C_ID], rec[C_FEN], rec[C_MOVES], rating, pop, nb,
                            themes, intern(rec[C_OPENING])))
    return rows, raw_theme_counts, skipped


# --- Selection (Part 3.2, steps 2-5) --------------------------------------------------------------

def select(rows, raw_theme_counts, log):
    chosen = {}                       # lid -> Row, insertion order is irrelevant (renumbered later)
    by_band = defaultdict(list)
    for r in rows:
        by_band[r.band].append(r)
    for b in by_band:
        by_band[b].sort(key=sort_key)

    # Step 2 — top PER_BAND of each of the 22 bands by quality.
    # The 2600..2800 tail (band index BAND_COUNT) is deliberately NOT a band: the spec fixes both
    # "22 bands" and a 2800 ceiling, which only reconcile if the tail enters via the top-ups below.
    for b in range(BAND_COUNT):
        take = by_band[b][:PER_BAND]
        for r in take:
            chosen[r.lid] = r
        log(f"  band {BAND_LO + b * BAND_SIZE:>4}-{BAND_LO + b * BAND_SIZE + BAND_SIZE - 1:<4} "
            f"eligible {len(by_band[b]):>6}  took {len(take):>5}")
    log(f"  step 2 total: {len(chosen)}")

    # Step 3 — theme quotas, topped up round-robin across bands so a quota cannot be filled
    # entirely out of whichever band happens to be densest in that theme.
    for theme in UI_THEMES:
        have = sum(1 for r in chosen.values() if theme in r.themes)
        need = THEME_QUOTA - have
        if need <= 0:
            log(f"  theme {theme:<18} have {have:>6}  (quota met)")
            continue
        pools = defaultdict(list)
        for r in rows:
            if theme in r.themes and r.lid not in chosen:
                pools[r.band].append(r)
        for b in pools:
            pools[b].sort(key=sort_key)
        cursors = {b: 0 for b in pools}
        added = 0
        while added < need:
            progressed = False
            for b in sorted(pools):                       # ascending band, one at a time
                if added >= need:
                    break
                i = cursors[b]
                if i < len(pools[b]):
                    r = pools[b][i]
                    cursors[b] = i + 1
                    chosen[r.lid] = r
                    added += 1
                    progressed = True
            if not progressed:
                break
        log(f"  theme {theme:<18} have {have:>6}  topped up +{added} -> {have + added}")

    # Step 4 — the warmup pool. Streak and Turbo both open at mate-in-1 around 600, and that
    # intersection is thin enough that leaving it to chance would strand both modes' first puzzle.
    have = sum(1 for r in chosen.values()
               if WARMUP_THEME in r.themes and WARMUP_LO <= r.rating <= WARMUP_HI)
    need = WARMUP_QUOTA - have
    added = 0
    if need > 0:
        pool = sorted((r for r in rows
                       if WARMUP_THEME in r.themes and WARMUP_LO <= r.rating <= WARMUP_HI
                       and r.lid not in chosen), key=sort_key)
        for r in pool[:need]:
            chosen[r.lid] = r
            added += 1
    log(f"  warmup {WARMUP_THEME}@{WARMUP_LO}-{WARMUP_HI}: have {have}, topped up +{added} "
        f"-> {have + added} (quota {WARMUP_QUOTA})")

    # Step 5 — rare-theme sweep. Computed from the RAW corpus counts, not from the spec's list;
    # the two are compared so a drift in either is loud rather than silent.
    rare = sorted(t for t, c in raw_theme_counts.items() if c < RARE_THRESHOLD)
    undocumented = [t for t in rare if t not in SPEC_RARE_THEMES]
    not_rare = [t for t in SPEC_RARE_THEMES if t not in rare]
    if undocumented:
        log(f"  NOTE: rare by the rule but absent from the spec's list: "
            f"{', '.join(f'{t} ({raw_theme_counts[t]})' for t in undocumented)}")
    if not_rare:
        log(f"  NOTE: listed in the spec but NOT rare by the rule: {', '.join(not_rare)}")
    rare_set = set(rare)
    swept = 0
    for r in rows:
        if r.lid not in chosen and rare_set.intersection(r.themes):
            chosen[r.lid] = r
            swept += 1
    log(f"  rare sweep: {len(rare)} themes, +{swept} puzzles")

    # Step 6 — dense renumber. Sorted by (rating, lichess_id): the id order then tracks rating, so
    # a `rating BETWEEN` scan touches contiguous pages, and PuzzleServing's documented
    # "ties broken by ascending id" becomes a stable, meaningful ordering rather than an accident.
    final = sorted(chosen.values(), key=lambda r: (r.rating, r.lid))
    return final, rare


def build_daily_pool(final, ids, log):
    cands = [r for r in final
             if DAILY_RATING_LO <= r.rating <= DAILY_RATING_HI
             and r.nb >= DAILY_MIN_NB_PLAYS
             and r.pop >= DAILY_MIN_POPULARITY
             and len(r.moves.split()) <= DAILY_MAX_PLIES]
    cands.sort(key=lambda r: r.lid)          # a stable base order before the seeded shuffle
    deterministic_shuffle(cands, DAILY_SHUFFLE_SEED)
    log(f"  daily_pool: {len(cands)} (target >= {DAILY_TARGET})")
    if len(cands) < DAILY_TARGET:
        log(f"  WARNING: daily pool is under target — it repeats after "
            f"{len(cands) / 365.0:.1f} years")
    return [ids[r.lid] for r in cands]


# --- Write ------------------------------------------------------------------------------------

def write_db(path, final, ids, daily, log):
    tmp = path + ".building"
    for p in (tmp, path):
        if os.path.exists(p):
            os.remove(p)
    db = sqlite3.connect(tmp)
    db.execute("PRAGMA page_size=4096")      # pinned: the default has changed between SQLite versions
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.executescript(SCHEMA)
    db.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    db.execute("BEGIN")
    db.executemany(
        "INSERT INTO puzzles(id,lichess_id,fen,moves,rating,popularity,nb_plays,opening_tags)"
        " VALUES(?,?,?,?,?,?,?,?)",
        ((ids[r.lid], r.lid, r.fen, r.moves, r.rating, r.pop, r.nb, r.opening or None)
         for r in final))
    db.executemany("INSERT INTO puzzle_themes(puzzle_id,theme) VALUES(?,?)",
                   ((ids[r.lid], t) for r in final for t in r.themes))
    db.executemany("INSERT INTO theme_rating_index(theme,rating,puzzle_id) VALUES(?,?,?)",
                   ((t, r.rating, ids[r.lid]) for r in final for t in r.themes))
    db.executemany("INSERT INTO daily_pool(day_index,puzzle_id) VALUES(?,?)",
                   enumerate(daily))
    db.execute("COMMIT")
    db.executescript(INDEXES)
    db.execute("ANALYZE")
    db.commit()
    db.execute("VACUUM")                     # deterministic layout; also reclaims the build slack
    db.close()
    os.replace(tmp, path)
    log(f"  wrote {path}  ({os.path.getsize(path) / (1024 * 1024):.1f} MB)")


def write_slice(path, final, ids, daily, log):
    """A representative slice for web-demo/, which cannot load a 30 MB SQLite in a page.

    Same generated-data pattern as `eco-data.js`. This exists so the browser twin exercises the
    selectors and the session against REAL puzzles rather than the ten hand-written samples that
    `puzzles.js` shipped with; it is not, and does not pretend to be, the shipping corpus."""
    by_band = defaultdict(list)
    for r in final:
        by_band[r.band].append(r)
    picked = {}

    def take(rs, n):
        got = 0
        for r in rs:
            if got >= n:
                break
            if r.lid not in picked:
                picked[r.lid] = r
                got += 1
        return got

    for b in range(BAND_COUNT + 1):
        take(sorted(by_band[b], key=sort_key), SLICE_PER_BAND)
    for theme in UI_THEMES:
        have = sum(1 for r in picked.values() if theme in r.themes)
        if have < SLICE_PER_THEME:
            take(sorted((r for r in final if theme in r.themes), key=sort_key),
                 SLICE_PER_THEME - have)
    have = sum(1 for r in picked.values()
               if WARMUP_THEME in r.themes and WARMUP_LO <= r.rating <= WARMUP_HI)
    if have < SLICE_WARMUP:
        take(sorted((r for r in final if WARMUP_THEME in r.themes
                     and WARMUP_LO <= r.rating <= WARMUP_HI), key=sort_key), SLICE_WARMUP - have)

    # The demo's Daily mode has to resolve SOME day index to a real puzzle, so carry a prefix of
    # the real pool and keep its order — the browser then reproduces the device's arithmetic
    # against a shorter pool, which is the honest version of the limitation.
    daily_slice = []
    by_id = {ids[r.lid]: r for r in final}
    for pid in daily[:SLICE_DAILY]:
        r = by_id[pid]
        picked[r.lid] = r
        daily_slice.append(r.lid)

    rows = sorted(picked.values(), key=lambda r: (r.rating, r.lid))
    slice_ids = {r.lid: i + 1 for i, r in enumerate(rows)}
    out = [
        "/* puzzle-data.js — GENERATED by tools/puzzlebank/build_puzzles.py. Do not hand-edit.",
        " *",
        " * A representative slice of the bundled corpus for the browser demo: every rating band,",
        " * every UI theme, the mate-in-1 warmup range, and a prefix of the daily pool. The device",
        f" * ships all {len(final):,} puzzles in puzzles.sqlite; a page cannot load a 30 MB binary,",
        " * so the twin proves the LOGIC on real puzzles and is explicitly not the shipping corpus.",
        " *",
        " * Row: [id, lichessId, fen, moves, rating, popularity, nbPlays, themes, openingTags]",
        " */",
        "'use strict';",
        "var BiyaPuzzleData = (function () {",
        f"  var CORPUS_TOTAL = {len(final)};",
        f"  var DAILY_POOL_TOTAL = {len(daily)};",
        "  var ROWS = [",
    ]
    for r in rows:
        out.append("    [%d,%s,%s,%s,%d,%d,%d,%s,%s]," % (
            slice_ids[r.lid], js_str(r.lid), js_str(r.fen), js_str(r.moves),
            r.rating, r.pop, r.nb, js_str(" ".join(r.themes)), js_str(r.opening or "")))
    out.append("  ];")
    out.append("  var DAILY = [" + ",".join(str(slice_ids[l]) for l in daily_slice) + "];")
    out.append("""
  var puzzles = ROWS.map(function (r) {
    return { id: r[0], lichessId: r[1], fen: r[2], moves: r[3].split(' '), rating: r[4],
             popularity: r[5], nbPlays: r[6],
             themes: r[7] ? r[7].split(' ') : [], openingTags: r[8] ? r[8].split(' ') : [] };
  });
  var byId = Object.create(null);
  puzzles.forEach(function (p) { byId[p.id] = p; });
  return {
    puzzles: puzzles, byId: byId, dailyPool: DAILY,
    // What the device has that the browser does not — surfaced so a demo-only shortfall can
    // never be mistaken for a corpus bug.
    corpusTotal: CORPUS_TOTAL, dailyPoolTotal: DAILY_POOL_TOTAL, isSlice: true,
  };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleData; }
""")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    log(f"  wrote {path}  ({len(rows)} puzzles, {os.path.getsize(path) / 1024:.0f} KB)")


def js_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


# --- main ---------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=DEFAULT_CSV, help="source byahero_puzzle.csv")
    ap.add_argument("--db", default=DEFAULT_DB, help="output puzzles.sqlite")
    ap.add_argument("--slice", default=DEFAULT_SLICE, help="output web-demo JS slice")
    ap.add_argument("--no-slice", action="store_true", help="skip the web-demo slice")
    # Positional forms kept so the old `build_puzzles.py <in.csv> <out.sqlite>` call still works.
    ap.add_argument("pos", nargs="*", help=argparse.SUPPRESS)
    a = ap.parse_args()
    if len(a.pos) >= 1:
        a.csv = a.pos[0]
    if len(a.pos) >= 2:
        a.db = a.pos[1]
    if not os.path.exists(a.csv):
        raise SystemExit(f"source CSV not found: {a.csv}\n"
                         f"It lives in the sibling Laravel repo; pass --csv to override.")

    t0 = time.time()
    def log(m): print(m, flush=True)

    log(f"reading {a.csv} ...")
    rows, raw_theme_counts, skipped = load(a.csv)
    log(f"  {len(rows):,} eligible of the raw corpus "
        f"(nb_plays >= {MIN_NB_PLAYS}, rating {RATING_FLOOR}..{RATING_CEIL}); "
        f"{skipped} malformed rows skipped")

    log("selecting ...")
    final, rare = select(rows, raw_theme_counts, log)
    ids = {r.lid: i + 1 for i, r in enumerate(final)}
    daily = build_daily_pool(final, ids, log)

    log("writing ...")
    write_db(a.db, final, ids, daily, log)
    if not a.no_slice:
        write_slice(a.slice, final, ids, daily, log)

    # The report the spec asks for, so a regression in any quota is visible at a glance.
    # `tools/qa/puzzle_corpus_check.js` turns these same numbers into assertions.
    counts = Counter(t for r in final for t in r.themes)
    band_counts = Counter(r.band for r in final)
    log("")
    log(f"FINAL: {len(final):,} puzzles  ({os.path.getsize(a.db) / (1024 * 1024):.1f} MB, "
        f"{time.time() - t0:.0f}s)")
    log("  per band:")
    for b in range(BAND_COUNT):
        log(f"    {BAND_LO + b * BAND_SIZE:>4}-{BAND_LO + b * BAND_SIZE + BAND_SIZE - 1:<4} "
            f"{band_counts[b]:>6}")
    log(f"    2600-{RATING_CEIL:<4} {band_counts[BAND_COUNT]:>6}   (tail: top-ups only, "
        f"never a band)")
    log("  per theme (all 62, UI themes marked *):")
    for t, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        mark = "*" if t in UI_THEMES else (" r" if t in rare else " ")
        log(f"    {mark} {t:<22} {c:>7}")
    log(f"  daily_pool: {len(daily)}")


if __name__ == "__main__":
    main()
