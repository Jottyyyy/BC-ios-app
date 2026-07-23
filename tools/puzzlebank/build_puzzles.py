#!/usr/bin/env python3
"""Build a bundled read-only puzzles.sqlite from the Lichess-format byahero_puzzle.csv.

Columns imported (per Appendix A §4.1): FEN, Moves, Rating, Themes, OpeningTags.
Usage: build_puzzles.py <input.csv> <output.sqlite>
"""
import csv, sqlite3, sys, os

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else \
        "/Users/joshuagencianeo/Documents/GitHub/BYAHERONG-COACH-LARAVEL/database/seeders/data/byahero_puzzle.csv"
    out = sys.argv[2] if len(sys.argv) > 2 else \
        "/Users/joshuagencianeo/Documents/GitHub/BC-ios-app/DemoApp/Sources/DemoApp/puzzles.sqlite"
    if os.path.exists(out):
        os.remove(out)

    db = sqlite3.connect(out)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    db.execute("""CREATE TABLE puzzles(
        id INTEGER PRIMARY KEY,
        fen TEXT NOT NULL,
        moves TEXT NOT NULL,
        rating INTEGER NOT NULL,
        themes TEXT,
        opening_tags TEXT)""")

    with open(src, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # header
        batch, n = [], 0
        db.execute("BEGIN")
        for row in reader:
            if len(row) < 8:
                continue
            fen, moves, rating, themes = row[1], row[2], row[3], row[7]
            opening = row[9] if len(row) > 9 else ""
            try:
                r = int(rating)
            except ValueError:
                continue
            batch.append((fen, moves, r, themes, opening))
            if len(batch) >= 50000:
                db.executemany("INSERT INTO puzzles(fen,moves,rating,themes,opening_tags) VALUES(?,?,?,?,?)", batch)
                n += len(batch); batch = []
        if batch:
            db.executemany("INSERT INTO puzzles(fen,moves,rating,themes,opening_tags) VALUES(?,?,?,?,?)", batch)
            n += len(batch)
        db.execute("COMMIT")

    db.execute("CREATE INDEX idx_rating ON puzzles(rating)")
    db.execute("ANALYZE")
    lo, hi = db.execute("SELECT MIN(rating), MAX(rating) FROM puzzles").fetchone()
    db.commit(); db.close()
    print(f"Wrote {n} puzzles to {out}  (rating {lo}..{hi}, {os.path.getsize(out)//(1024*1024)} MB)")

if __name__ == "__main__":
    main()
