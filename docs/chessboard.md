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
| Analysis Board | `AnalysisBoard.edge(screenWidth:pixelRatio:engineOn:)` — the one entry point, and **both** the board band and `enginePlan` must use it. With the engine ON it is `sizeBesideRail`: the screen width **less the 20pt eval rail and its 5pt gap**, then snapped down to a whole multiple of 8 physical pixels so squares land on pixel boundaries. `size(screenWidth:pixelRatio:)` does the snapping and is pinned to the RN source; `sizeBesideRail` only narrows its INPUT. Subtract *then* snap — the other order lands the board on a fractional physical pixel and puts a seam between the squares. With the engine **off** there is no rail, so `edge` returns the plain `size` and the board is full-bleed again. Never call `size` or `sizeBesideRail` from a screen: two call sites picking the branch for themselves is how the board and the engine panel's budget drift apart. |
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

## Input routes — a playable board takes tap AND drag

**Both renderers ship with drag OFF, and neither says so at runtime.** That is the second rule this
file exists for, and it has now been broken twice as well — once per language, in mirror image:

| Renderer | Drag is installed only when | Default |
|---|---|---|
| `<chess-board>` | `.draggablePieces = true`, or the `draggable-pieces` attribute at any value but `'false'` | `_dragEnabled = false` — no pointer handler is attached at all |
| `BoardView` | `onDragMove:` is passed | `.gesture(dragGesture, including: onDragMove == nil ? .subviews : .all)` — the gesture is masked out |

Neither failure is observable from the code that gets it wrong. There is no listener to misfire, no
warning, and **tap-to-move keeps working perfectly** — the board still selects, rings its legal
targets, plays the move and animates. Both bugs therefore shipped:

- `PuzzleBoardBand` passed `selected: nil`, `legalTargets: []`, `onTap: { _ in }` and `lastMove: nil`.
  Drag worked; **tap** was dead, with no legal-move dots and no last-move highlight.
- `CoachScreens.swift` and `coach-play.js` set everything the *tap* route needs and never enabled
  drag. Tap worked; **drag** was dead. It shipped on 2026-08-12 and was reported from a phone on
  2026-08-24 — by the client, not by a suite.

So the invariant is symmetric, and it is asserted per-language off the CALL — not off a list of
screen names, so a screen written tomorrow is covered today:

| Gate | Rule | Exempt |
|---|---|---|
| `swift_layout_check.js` §7 | a `BoardView` handed a real `selected` / `legalTargets` / `onTap` must also be handed `onDragMove` | one passing `nil` / `[]` / `{ _ in }` is a **display board** — and the app now has **none**: `OpeningTreeScreens` was the last, until free play. The census is asserted `=== 0` and the exempt arm is proved on fixtures plus a mutant |
| `web_shell_check.js` §5 | a `<chess-board>` given `.rules` must be given the drag | a board given neither is a display board — and the demo now has **none**, for the same reason. Same three-part proof |

Both carry census floors, because a detector that stops matching otherwise reports a clean sweep of
nothing. §7's two name-based exemptions — `PlayView` / `PuzzleView`, the fixed-size macOS demo
panels — assert their own premise: exempt only while `AppShell` is the sole thing that constructs
them.

### What a drag does and does not do

The two renderers are deliberately **not** equal here, and the difference is the component's, not a
screen's:

- **The browser follows the pointer.** `_onPointerDown` caches the board rect once, `_onPointerMove`
  crosses a 4 px threshold before it hijacks the tap, and `_dragFrame` writes one transform per
  animation frame and repaints exactly the two squares whose hover changed. A legal drop lands where
  the finger let go (`_justDropped`); an illegal one sends the piece home. Promotion goes home first,
  because the piece cannot sit under the dialog.
- **Swift does not.** `BoardView.dragGesture` is `DragGesture(minimumDistance: 4)` with `.onEnded`
  only: no piece follows the finger, no ring appears mid-travel. Every board in the app behaves this
  way — Analysis, all five puzzle solvers, and now Play vs Coach — so a live ghost is a change to
  `BoardView` and to every screen at once, not to one screen.

**A Swift screen's drag handler must check legality itself.** `dragGesture` reports whatever two
squares the gesture spanned and knows nothing about pieces or rules, whereas the tap route already
has `legalTargets` computed for the piece in hand by the time the second tap arrives. `AnalysisVM.drag`
filters `legalMoves(from:)` by destination; `CoachGameScreen.drag` does the same and then funnels
into the same `commit` the tap route uses. The browser gets this free: `_targetsFrom` runs on
`pointerdown`, and a drop outside the set never reaches `_commit`.

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
| `tools/qa/swift_layout_check.js` | the SwiftUI layout gate, plus §7 — a playable board takes drag too |
| `tools/qa/web_shell_check.js` | the browser wiring gate, plus §5 — the same rule for `<chess-board>` |
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

**Drag on every one of them — do not only tap.** Press a piece, move it at least 4 px and release on
a legal square; the move must play. This is the check no suite can make for you: both gates read
source, and the component's own pointer tests drive their *own* correct wiring rather than a
screen's. It is how the Play vs Coach drag went missing for the whole life of that screen.

The squares are **brown** on all of them — `#F0D9B5` / `#B58863`. If any board is blue, something
is writing a square colour that is not `BoardStyle` or `--board-light`/`--board-dark`, and
`board_layout_check.js` §8 will name it.

On a Mac, `swift build && swift run ParityRunner` must still exit 0 — none of this touches a domain
engine — and `DemoApp/run-demo.sh` shows the same screens natively.
