#!/usr/bin/env python3
"""Mutation-test `tools/qa/puzzle_corpus_check.js` — every mutant must be KILLED.

    python tools/qa/corpus_mutation_test.py

A gate with 124 passing assertions tells you nothing on its own. Each mutant below is a plausible
way the bundled corpus could be wrong; several are the original server bugs the spec's Part 20 asks
us to fix, reintroduced verbatim. Each is applied to a COPY of the shipping DB, the gate runs
against the copy, and the copy is deleted — the real `puzzles.sqlite` is never written to.

A surviving mutant is a coverage hole, not a curiosity: the first run of this file found that the
single most important property in the corpus (Part 5.1's move convention) was only being SAMPLED,
and that the sample could not reach the mutated rows.
"""
import os, shutil, sqlite3, subprocess, sys, tempfile

# Repo-relative, unlike the hardcoded macOS paths this repo's Python tools used to carry.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "DemoApp", "Sources", "BiyaherongUI", "puzzles.sqlite")
TMP = tempfile.mkdtemp()


def m_swap_first_two(db):
    """Break the Part 5.1 convention: make moves[0] the solver's on 5% of rows."""
    rows = db.execute("SELECT id, moves FROM puzzles WHERE id % 20 = 0").fetchall()
    for i, mv in rows:
        p = mv.split()
        p[0], p[1] = p[1], p[0]
        db.execute("UPDATE puzzles SET moves=? WHERE id=?", (" ".join(p), i))


def m_odd_moves(db):
    db.execute("UPDATE puzzles SET moves = moves || ' e2e4' WHERE id = 500")


def m_illegal_move(db):
    """Syntactically fine but illegal solver moves on 5% of rows.

    Deliberately systematic. The deep replay covers 600 of 92,976 rows, so it is a spot-check for
    corpus-wide breakage, not a guarantee about any single row — single-row corruption is what the
    full-corpus checks in section 9 are for. A one-row mutant would only measure whether the
    mutation happened to land on a sampled ordinal."""
    rows = db.execute("SELECT id, moves FROM puzzles WHERE id % 20 = 0").fetchall()
    for i, mv in rows:
        p = mv.split(); p[1] = "a1a2"
        db.execute("UPDATE puzzles SET moves=? WHERE id=?", (" ".join(p), i))


def m_corrupt_fen(db):
    db.execute("UPDATE puzzles SET fen='8/8/8/8/8/8/8/8 w - - 0 1' WHERE id % 37 = 0")


def m_truncate_corpus(db):
    db.execute("DELETE FROM puzzles WHERE id > 40000")


def m_sort_daily(db):
    ids = [r[0] for r in db.execute("SELECT puzzle_id FROM daily_pool ORDER BY puzzle_id")]
    db.execute("DELETE FROM daily_pool")
    db.executemany("INSERT INTO daily_pool VALUES(?,?)", list(enumerate(ids)))


def m_thin_theme(db):
    """Undo the skewer top-up — the exact regression a missing quota step would cause."""
    ids = [r[0] for r in db.execute(
        "SELECT puzzle_id FROM theme_rating_index WHERE theme='skewer' LIMIT 900")]
    q = ",".join(str(i) for i in ids)
    db.execute(f"DELETE FROM theme_rating_index WHERE theme='skewer' AND puzzle_id IN ({q})")
    db.execute(f"DELETE FROM puzzle_themes WHERE theme='skewer' AND puzzle_id IN ({q})")


def m_drop_rare(db):
    db.execute("DELETE FROM theme_rating_index WHERE theme='vukovicMate' AND puzzle_id % 3 = 0")


def m_stale_tri_rating(db):
    db.execute("UPDATE theme_rating_index SET rating = rating + 300 WHERE puzzle_id = 77")


def m_thin_band(db):
    ids = [r[0] for r in db.execute(
        "SELECT id FROM puzzles WHERE rating BETWEEN 1500 AND 1599 LIMIT 500")]
    q = ",".join(str(i) for i in ids)
    db.execute(f"DELETE FROM puzzles WHERE id IN ({q})")


def m_drop_index(db):
    """Spec fix #15 regressing: the thematic serve goes back to a table scan."""
    db.execute("DROP TABLE theme_rating_index")
    db.execute("CREATE TABLE theme_rating_index(theme TEXT, rating INTEGER, puzzle_id INTEGER)")
    db.execute("INSERT INTO theme_rating_index SELECT t.theme, p.rating, t.puzzle_id "
               "FROM puzzle_themes t JOIN puzzles p ON p.id = t.puzzle_id")


def m_bad_daily_filter(db):
    db.execute("UPDATE daily_pool SET puzzle_id = (SELECT id FROM puzzles WHERE rating > 2500 "
               "LIMIT 1) WHERE day_index = 3")


def m_sparse_ids(db):
    db.execute("DELETE FROM puzzles WHERE id = 12345")


def m_empty_opening(db):
    db.execute("UPDATE puzzles SET opening_tags='' WHERE id = 9")


MUTANTS = [
    ("swap_first_two_moves", m_swap_first_two),
    ("odd_move_count", m_odd_moves),
    ("illegal_move_in_line", m_illegal_move),
    ("daily_pool_unshuffled", m_sort_daily),
    ("theme_quota_not_topped_up", m_thin_theme),
    ("rare_theme_partially_swept", m_drop_rare),
    ("stale_denormalised_rating", m_stale_tri_rating),
    ("band_under_quota", m_thin_band),
    ("thematic_index_lost", m_drop_index),
    ("daily_filter_violated", m_bad_daily_filter),
    ("ids_not_dense", m_sparse_ids),
    ("empty_string_opening_tags", m_empty_opening),
    ("corrupt_fen", m_corrupt_fen),
    ("truncated_corpus", m_truncate_corpus),
]

killed, survived = [], []
for name, fn in MUTANTS:
    p = os.path.join(TMP, name + ".sqlite")
    shutil.copyfile(SRC, p)
    db = sqlite3.connect(p)
    fn(db)
    db.commit()
    db.close()
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "qa", "puzzle_corpus_check.js"), p],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        first = [l for l in r.stdout.splitlines() if l.strip().startswith("x")]
        killed.append((name, first[0].strip() if first else "?"))
    else:
        survived.append(name)
    os.remove(p)

for n, why in killed:
    print(f"  KILLED   {n:<30} -> {why[:100]}")
for n in survived:
    print(f"  SURVIVED {n}")
print(f"\n{len(killed)}/{len(MUTANTS)} killed")
sys.exit(1 if survived else 0)
