# Third-party notices

Assets bundled inside the Biyaherong Chess Coach application that are **not** covered by
[`LICENSE`](LICENSE). Each carries its own terms, and those terms survive distribution through the
App Store.

This file is the shippable notice. `README.md`'s "Third-party assets" section is the developer-facing
copy of the same list; if one changes, change both.

---

## Chess piece artwork — CC BY-SA

- **Author:** Uray M. János (2013–2018), derived from the Wikipedia chess set
- **Licence:** Creative Commons Attribution-ShareAlike
- **Files:** `assets/images/chess-pieces/*.svg`, and the rendered forms in
  `DemoApp/Sources/BiyaherongUI/Pieces/`

**This is a copyleft licence and it has live obligations.** Attribution must be preserved, and any
*modified* artwork must be released under the same licence. `SVGVector.swift` renders these files
faithfully or falls back to a Unicode glyph — it does not create derivative artwork — so the
obligation today is attribution, which this file and the app's in-app Terms sheet both carry.
Replacing the set with a drop-in of the same `<kind>-<w|b>.svg` names changes this entry.

## Nunito — SIL Open Font License 1.1

- **Licence:** [SIL OFL 1.1](https://scripts.sil.org/OFL)
- **Files:** `DemoApp/Sources/BiyaherongUI/Fonts/*.ttf`

The OFL permits bundling in an application without the application inheriting the licence. The two
conditions that apply here: the font is not sold on its own, and the reserved font name is not used
for a modified version. Neither is at risk — the files are shipped unmodified.

## ECO opening names — CC0 1.0

- **Source:** [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
- **Licence:** CC0 1.0 Universal (public domain dedication)
- **Inputs:** `tools/eco/data/*.tsv` (with `COPYING.txt`)
- **Built product:** `DemoApp/Sources/BiyaherongUI/ECO/eco.tsv`, via `php tools/eco/build_eco.php`

CC0 waives the attribution requirement, so this entry is courtesy rather than obligation. The dataset
is fetched at development time only; the app makes no network request for it.

## Puzzle corpus

`DemoApp/Sources/BiyaherongUI/puzzles.sqlite` is built by `tools/puzzlebank/build_puzzles.py` from a
Lichess puzzle export. The Lichess puzzle database is CC0. The build is deterministic, and the
database is committed because CI clones this repository alone.

---

## Not bundled, and deliberately so

**Stockfish is not in this application.** `CLAUDE.md` and `README.md` record it as a locked decision
for a later phase; no `.cpp`, `.xcframework`, NNUE file, submodule or package dependency exists in
this repository. Nothing here is GPL today. See the note at the end of [`LICENSE`](LICENSE) for what
changes when that lands.
