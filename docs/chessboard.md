# The chessboard

One board renderer per language, one rule for sizing it, and a gate that fails when either is
reinvented.

| Language | Renderer | Sizing wrapper |
|---|---|---|
| Swift | `BoardView` — `DemoApp/Sources/BiyaherongUI/BoardView.swift` | `ChessBoardBand`, same file |
| Browser | `<chess-board>` — `web-demo/js/chess-board.js` | `.pz-board chess-board { width: 100% }` etc. |

Both draw the squares, the pieces, the highlights, the legal-move dots and rings, and the a–h / 1–8
coordinates. Neither owns any screen chrome — headers, stat bars, promotion dialogs and result
overlays belong to the screens.

---

## The sizing rule

**A board is a fixed square derived from the WIDTH it is given. Never `min(width, height)`.**

This is the rule the whole file exists for. It has now been broken twice, once per language, in the
same shape:

```css
/* the browser, before board_layout_check.js */
.an-board            { flex: 1 1 auto; container-type: size; }
.an-board chess-board{ width: min(100cqw, calc(100cqh - var(--an-eval-h) - 4px)); }
```

```swift
// SwiftUI, before swift_layout_check.js
GeometryReader { geo in
    let side = min(geo.size.width, geo.size.height)   // ← the bug
    BoardView(…, boardSize: side).frame(maxWidth: .infinity, maxHeight: .infinity)
}
.aspectRatio(1, contentMode: .fit)
```

A `GeometryReader` — like a CSS container query on a flexible band — reports the space *left over*
after everything else in the stack. Taking `min(w, h)` therefore makes the board's **width** track
the leftover **height**. Two symptoms follow, and both were reported from a real device:

- the board never fills the screen, and
- it resizes whenever anything above or below it grows (a banner, an extra engine line, a move row).

The correct shape is the browser's: the board is rigid and the band **below** it flexes.

```css
.pz-board            { flex: none; }
.pz-board chess-board{ width: 100%; --board-radius: 0; }
.pz-bottom           { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
```

```swift
GeometryReader { geo in                       // ONE reader, at the screen root
    VStack(spacing: 0) {
        header
        PuzzleBoardBand(engine: engine, edge: geo.size.width)
        bottom
        Spacer(minLength: 0)                  // the bottom is the flexible band
    }
    .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
}
```

Two consequences worth stating outright:

- **One `GeometryReader` per screen, at the top.** The edge travels down as a `CGFloat`. A reader
  nested inside a `VStack` is greedy, which is what starts the whole problem.
- **`alignment: .top` on the screen root.** `.frame(maxWidth: .infinity, maxHeight: .infinity)`
  defaults to `.center`, so the moment the content stops filling the frame it drifts into the middle
  of the phone with a blank block above it.

`ChessBoardBand` is deliberately *only* `content(edge).frame(width: edge, height: edge)` — no
`maxWidth: .infinity`. Callers hang `.overlay(alignment: .topLeading)` (arrows, the annotation badge,
Turbo's feedback dot) and `.clipShape(RoundedRectangle(…))` on it, and both anchor to its frame;
padding the band out to the screen width would move every arrow and round the wrong corners.
Horizontal centring is the parent stack's job, which a `VStack` already does.

### Who supplies the edge

| Screen | Edge |
|---|---|
| The five puzzle solvers | `geo.size.width` (full bleed, like `.pz-board`) |
| Play vs Coach | `geo.size.width` |
| Analysis Board | `AnalysisBoard.sizeBesideRail(screenWidth:pixelRatio:)` — the screen width **less the 32pt eval rail and its 5pt gap**, then snapped down to a whole multiple of 8 physical pixels so squares land on pixel boundaries. `size(screenWidth:pixelRatio:)` does the snapping and is pinned to the RN source; `sizeBesideRail` only narrows its INPUT. Subtract *then* snap — the other order lands the board on a fractional physical pixel and puts a seam between the squares. Do not replace either with the plain width. |
| The two macOS demo panels | a constant (480 / 460); they are fixed-size desktop panels |

---

## Square colours

**Classic Brown, `#F0D9B5` / `#B58863`, on every board in the app.** One pair, two languages, one
source: `tools/metrics/puzzle_styles.json` → `shared.board.lightSquare` / `darkSquare`, extracted by
`tools/metrics/extract_puzzle_styles.js` from the real RN board (`components/DragDropChessBoard.tsx`).

| Writer | Where |
|---|---|
| Swift, every board | `BoardStyle`'s defaults — `AnalysisMetrics.swift`, `var light = BoardTheme.classic.light` |
| Browser, every board | `--board-light` / `--board-dark` on `:root` — `web-demo/css/theme.css` |
| Browser, no-stylesheet fallback | the `var(--board-light, …)` defaults in `chess-board.js`'s `:host` block |
| Analysis Board only | `BoardTheme` / `BOARD_THEMES` — a per-screen override, `classic` by default |

Nothing else may write one. A screen that wants a different board does it by passing
`style:` (Swift) or setting the two custom properties on its own root (browser), the way the
Analysis Board's theme picker does — never by restating a hex.

**This was wrong for the whole life of the port, in both languages at once.** The extraction had
carried the brown pair since the puzzle screens landed and *nothing read it*: `BoardStyle` and
`theme.css` each hardcoded an invented `#5BA3F5` / `#2C4A73` blue, so the five puzzle solvers, Play
vs Coach and the two macOS panels all drew a colour the source app never had. The Analysis Board
was the only screen that happened to be right, because its theme picker defaults to `classic`.
No suite could see it — not one asserted a square colour literal — and the two languages agreed
with *each other*, which is the "two hand-typed copies agreeing is not verification" trap in
`CLAUDE.md`.

`tools/qa/board_layout_check.js` §8 closes it: all five writers above are pinned to the JSON, in
Swift as well as JS, and the old blue is banned from any of them. Change the RN source, re-run the
extractor, and the gate tells you which copies are stale.

**Highlights stay gold and translucent.** `lastMove` and `selected` are `Theme.accent` at 0.32 /
0.55 laid *over* the square (`replacesFill == false`), not the RN board's solid `#F6F669` /
`#CDD26A`. That is deliberate: gold-on-brown is what the Analysis Board has always rendered, and it
is the reading the client approved from a screenshot of that screen.

---

## Coordinates

On by default in both languages, matching `<chess-board>`'s `coordinates` attribute. Geometry is
extracted from the stylesheet that already drew them (`chess-board.js`), into `BoardCoords` in
`AnalysisMetrics.swift`:

- file letter `a`–`h` on the **bottom visual row only**, inset `right 3%` / `bottom 1%` of a square
- rank digit `1`–`8` on the **left visual column only**, inset `left 4%` / `top 1%`
- weight 600, size `clamp(7px, 2.1cqw, 12px)`, colour `#8BA3C7` at 0.9 opacity

The two units are different on purpose and the difference is load-bearing: `cqw` is 1% of the
**board** width (`.board` sets `container-type: inline-size`), while the `%` insets are relative to
the **square**. Hence `BoardCoords.fontSize(boardEdge:)` against one and the inset helpers against
the other.

Labels carry the *logical* file/rank, so they follow a flip. The two macOS demo panels pass
`coordinates: false` because they draw their own strips outside the board.

---

## Screen chrome that is NOT the board's

`BoardView` stays free of anything screen-specific; each one is an overlay at the call site.

- `BoardArrows` and `AnalysisAnnotationOverlay` — Analysis Board
- `PromotionOverlay` / `PuzzlePromotionOverlay` — two genuinely different dialogs, see
  `AnalysisPromotion`'s doc comment
- the premove chip — Play vs Coach
- the ✓/✕ feedback dot — Turbo

---

## There is no tab bar

This section used to describe how the bar was hidden on a pushed puzzle route: the browser set
`an-mode`, `PuzzleHubScreen` reported its depth through `onPushedChange`, and `PhoneApp` held the
flag. **Home is the app root now**, so every screen covers the whole phone and none of that
machinery exists. `swift_layout_check.js` §6 asserts the inverse, so it cannot come back unnoticed.

The board therefore always has the full height it computes from the WIDTH — the sizing rule above
never had to account for a bar, and now nothing does.

---

## Key files

| File | What |
|---|---|
| `DemoApp/Sources/BiyaherongUI/BoardView.swift` | `BoardView` + `ChessBoardBand` |
| `DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift` | `BoardStyle`, `BoardTheme`, `AnalysisIndicator`, `BoardCoords` |
| `DemoApp/Sources/BiyaherongUI/PuzzleSolverParts.swift` | `PuzzleBoardBand` — the five solvers' call site |
| `web-demo/js/chess-board.js` | the Web Component |
| `web-demo/js/puzzle-board.js` | the solver plumbing four puzzle modes share |
| `tools/qa/swift_layout_check.js` | the SwiftUI layout gate |
| `tools/qa/swift_layout_mutation_test.js` | proof that gate can still fail |
| `tools/qa/board_layout_check.js` | the CSS half of the same rule, plus §8 — the square-colour extraction pin |
| `tools/metrics/puzzle_styles.json` | `shared.board` — the extracted square palette, the one source |

---

## How to test

```bash
node tools/qa/js_goldens.js            # includes both layout gates and the mutation test
node tools/qa/swift_layout_check.js    # the gate alone
node tools/qa/swift_layout_mutation_test.js
node tools/qa/swift_lint.js            # no arguments
node tools/qa/swift_symbol_check.js    # no arguments
```

Visually, in `web-demo/index.html` at an iPhone size: **Puzzles → 🔥 Streak → Start Streak**. The
tab bar is gone, the board is edge-to-edge with coordinates, and the empty space is *below* the
hint. Then the same for Daily, Thematic, Turbo and Play vs Coach.

The squares are **brown** on all of them — `#F0D9B5` / `#B58863`. If any board is blue, something
is writing a square colour that is not `BoardStyle` or `--board-light`/`--board-dark`, and
`board_layout_check.js` §8 will name it.

On a Mac, `swift build && swift run ParityRunner` must still exit 0 — none of this touches a domain
engine — and `DemoApp/run-demo.sh` shows the same screens natively.
