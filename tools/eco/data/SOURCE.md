# ECO dataset provenance

Vendored verbatim from **[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)**
(`master`, fetched 2026-08-10). 3,810 openings across `a.tsv`–`e.tsv`, columns `eco`, `name`, `pgn`.

**License: CC0 1.0 Universal** (public domain dedication) — full text in `COPYING.txt`. Upstream states:
*"As a collection of facts, this data set is in the public domain. Considerable effort was spent curating and
cleaning the data. Insofar as that qualifies for copyright, the work is released under the CC0 Public Domain
Dedication."*

These files are **inputs**, not products. `tools/eco/build_eco.php` replays each `pgn` column through the real
`../BYAHERONG-COACH-LARAVEL/app/Services/ChessEngine.php` to produce position-keyed lookups, so the book's
keys are consistent with the `san_parse` goldens by construction. Regenerate the products, never hand-edit
them:

```bash
php tools/eco/build_eco.php
```

Re-fetch the inputs with:

```bash
cd tools/eco/data
for f in a b c d e; do curl -sSO https://raw.githubusercontent.com/lichess-org/chess-openings/master/$f.tsv; done
curl -sSO https://raw.githubusercontent.com/lichess-org/chess-openings/master/COPYING.txt
```

The download happens at **development time only**. The shipped app makes no network requests.
