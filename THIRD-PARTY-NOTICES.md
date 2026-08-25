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

## Stockfish — GPLv3

- **Authors:** The Stockfish developers. The full list ships with the source, at
  `Engine/Sources/CStockfish/sf/AUTHORS`.
- **Version:** Stockfish 17.1.
- **Licence:** GNU General Public License, version 3. The licence text ships at
  `Engine/Sources/CStockfish/sf/Copying.txt`, and is byte-identical to the copy at
  <https://www.gnu.org/licenses/gpl-3.0.txt> and to [`LICENSE`](LICENSE)'s own copy.
- **Source:** <https://github.com/official-stockfish/Stockfish>, tag `sf_17.1`. Vendored complete and
  unmodified apart from a single documented line in `sf/types.h`, which pulls in `../sfconfig.h` to
  supply the build switches Stockfish's own Makefile would have set. That patch is labelled in place
  and asserted by `tools/qa/stockfish_vendor_check.js`.
- **Bundled with the app:** the two neural networks it evaluates with,
  `Engine/Sources/StockfishEngine/Nets/nn-1c0000000000.nnue` (71.4 MiB) and `nn-37f18f62d772.nnue`
  (3.4 MiB). They are part of Stockfish and carry its licence.

**This is why the application is GPLv3.** Unlike every other entry in this file, Stockfish's licence
is not merely preserved alongside the app's own — GPLv3 section 5 requires the *combined* work to be
licensed under the GPL as a whole. [`LICENSE`](LICENSE) is that licence, the corresponding source is
published, and the grant cannot be withdrawn. See `docs/stockfish.md`.

---

## Not bundled, and deliberately so

**No tablebases.** Syzygy probing code is present because it is part of Stockfish, but no `.rtbw` or
`.rtbz` file is shipped and `SyzygyPath` is never set. Endgame play is search and evaluation only.
