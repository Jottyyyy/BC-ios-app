# analysis-board — the offline analysis screen

The app's most complex screen: a board you can play moves on, a live engine with ranked lines and arrows, a
move tree with variations, game review with accuracy and an eval graph, a position editor, a bundled ECO
opening book, and PGN import/export. **It makes no network requests at all** — the original React Native
screen did HTTP analysis, HTTP game review and a Lichess masters lookup; all three are replaced by code and
data that ship inside the app.

Ported from `app/(app)/user/analysis-board/board.tsx` (6,865 lines) in the sibling
`../BYAHERONG-COACH-FRONTEND` repo — **from its real StyleSheet numbers, not from prose** (see *Extract,
don't transcribe* below).

> **Status: complete.** Every part of the screen is built. What remains is the compile — `swift` is not
> on PATH on the Windows checkout, so the Swift half is verified by the JS twin, the extracted-source
> assertions and the lint, and `swift build` runs on a Mac.
>
> Move tree · PGN · search engine · ECO book · metrics layer · board arrows + drag · the seven-band
> screen with live engine, branching and the ECO panel · game review · persistence (save form, library,
> folders, drafts) · **Setup Position · PGN import/export · the ☰ menu · the annotation picker · the
> variation card · haptics**.

## How to run the checks

```bash
node tools/qa/js_goldens.js            # the whole JS gate: metrics, session, board component, oracles
node tools/qa/board_component_test.js  # just <chess-board>: arrow geometry, drag, tap-to-move regression
node tools/qa/swift_lint.js            # brackets + public-exposes-internal, for Swift that cannot compile here
node tools/qa/metrics_key_check.js     # every MET.<BLOCK>.<key> and AnalysisEdit.foo resolves, JS + Swift
node tools/qa/swift_source_keys.js     # every StyleSheet lookup AnalysisMetricsCheck makes has a value
node tools/qa/board_layout_check.js    # the board is width-sized and does not flex — the CSS-level gate
node tools/qa/engine_budget_check.js   # no synchronous search chunk may freeze the UI
node tools/qa/worker_protocol_check.js # drives the real Worker protocol without a browser
node tools/qa/replay_position_editor.js  # the blind-written Swift tables, replayed through the proven JS
node tools/metrics/extract_board_styles.js   # regenerate board_styles.json from the RN source

# macOS, with a toolchain:
swift run ParityRunner                       # domain layer, incl. the `analysis_session` group
cd DemoApp && swift run AnalysisMetricsCheck # the metrics layer
```

Visually: open `web-demo/index.html`, then the **Analysis Board** tile on Home. `?selftest` runs every
suite, including the session layer and a real hit-test check of the board component.

## Key files

| File | Role |
|---|---|
| `Sources/BiyaherongCoachCore/AnalysisSession.swift` | **the screen's behaviour, with no screen attached** — see below |
| `…/PositionEditor.swift` | Setup Position as a pure value type: placement, castling normalisation, and the validation chess.js used to do |
| `Sources/BiyaherongCoachCore/MoveTree.swift` | the tree, navigation, promote/delete, and the pure `flatten() -> [TreeRow]` render model |
| `…/PGN.swift` | parse + serialize with recursive variations, NAGs and comments — **the persistence format** |
| `…/AnalysisEngine.swift`, `…/LocalEngine.swift` | the engine protocol and the in-repo search behind it |
| `…/OpeningBook.swift` | ECO lookup over the bundled 7,854-row book |
| `…/ReviewAnnotator.swift` | drives the engine over a game, then layers the `book` tier on top of `GameReview` |
| `DemoApp/…/AnalysisBoardScreen.swift` | the seven bands, the move strip, the ECO panel, the engine panel, the branch picker |
| `DemoApp/…/AnalysisVM.swift` | threading, sound and republishing — nothing else |
| `DemoApp/…/CancelToken.swift` | lock-guarded cancel flag the background search reads |
| `DemoApp/…/OpeningBookLoader.swift` | the `Bundle.module` read Core deliberately cannot do |
| `DemoApp/…/AnalysisMetrics.swift` | **the pure layer** — geometry, bands, palette, typography, tables, timings. No view code |
| `DemoApp/…/AnalysisMetricsCheck.swift` | its assertions, runnable as `swift run AnalysisMetricsCheck` |
| `DemoApp/…/BoardArrows.swift` | the SwiftUI arrow overlay, composed at the call site |
| `DemoApp/…/AnalysisMenuSidebar.swift` | the ☰ sidebar: four sections, ten items, width as a ratio |
| `DemoApp/…/AnalysisEditPanel.swift` | Setup Position's palette, castling chips, validation banner and FEN row |
| `DemoApp/…/AnalysisPgnModals.swift` | Import (paste + `.fileImporter`) and Export (copy + `.fileExporter`) |
| `DemoApp/…/AnalysisAnnotationPicker.swift` | the two-section picker, and the badge overlay that draws its glyph |
| `DemoApp/…/AnalysisVariationModal.swift` | the variation card, its delete confirmation, and the autoplay-speed picker |
| `DemoApp/…/Haptics.swift` | four named feedbacks; `#if canImport(UIKit)`, macOS no-op |
| `DemoApp/…/PlayView.swift` | `BoardView`, extended (not forked) with `style` / `customHighlights` / `onDragMove` |
| `tools/metrics/extract_board_styles.js` | TypeScript AST walk over `board.tsx` → `board_styles.json` |
| `tools/metrics/board_styles.json` | **committed** — 328 style keys, 1,355 property values, zero unresolved |
| `web-demo/js/analysis-metrics.js` | the JS twin of the metrics layer |
| `web-demo/js/analysis.js` | `BiyaAnalysisBoard` — the JS twin of the session layer, plus the whole screen |
| `web-demo/js/position-editor.js` | the JS twin of `PositionEditor` |
| `web-demo/js/chess-board.js` | `<chess-board>`, extended with the arrow overlay, pointer-drag and the `tap` event |
| `tools/qa/metrics_key_check.js` | every metrics reference resolves — in **both** languages |
| `tools/qa/swift_source_keys.js` | every StyleSheet lookup the Swift check makes has a value to find |
| `tools/qa/replay_position_editor.js` | the Swift tables, replayed through the JS that has actually run |
| `tools/qa/board_layout_check.js` | the layout invariants the CSS must keep: board fixed and width-sized, panels flexible |
| `web-demo/js/engine-host.js` | decides where the search runs: a Worker when served, sliced in-thread from `file://` |
| `web-demo/js/analysis-worker.js` | the worker: `importScripts` the unmodified engines, then analyze/bestMove/cancel |
| `tools/qa/engine_budget_check.js` | the frame budget — no chunk over 80ms×4, reported in dropped frames |
| `tools/qa/worker_protocol_check.js` | the worker's protocol, in a fake worker scope |

## Extract, don't transcribe

`tools/metrics/extract_board_styles.js` parses the real React Native source with the `typescript` compiler
already present in the frontend repo's `node_modules` and emits every `StyleSheet.create` value. It
pre-seeds the six module constants (`SQUARE_SIZE`, `BOARD_SIZE`, …), folds arithmetic, expands
`...StyleSheet.absoluteFillObject` and resolves `Platform.OS`, so **nothing is left unresolved**.

That is not neatness, it is coverage. The written spec says "eval bar height 3". The source has **two** eval
bars — `evalBarTrack.height = 8` (the main bar under the board) and `engineEvalBarTrack.height = 3` (the
per-line micro bar). Transcribing by hand would have sized the main bar wrong and nothing downstream would
have caught it.

Both `AnalysisMetricsCheck` (Swift) and the `analysis-metrics` suite (JS) assert their encoded constants
**against `board_styles.json`**. That shared oracle is the twin mechanism: it catches transcription errors
from the source, not merely drift between two hand-typed copies. Deliberate deviations — the flexible band
heights, the ⩲/⩱ correction, the ECO panel replacing the masters explorer — are listed in
[`../PORTING_NOTES.md`](../PORTING_NOTES.md) and excluded from that comparison.

It earns its keep. Adding the typography block, the header title was transcribed as **20** — the value a
merged lookup returns, because `sidebarStyles` declares its own `headerTitle`. The board's own `styles`
block says **16**, the check failed on exactly that, and every key is now pinned to `styles`. Nothing else
in the pipeline would have noticed a header four points too big.

### Two traps the extraction itself sets

**Folded screen dimensions.** Anything the source computed from `Dimensions.get()` is evaluated
against a 390×844 reference before it reaches the JSON, so `screenHeight * 0.80` arrives as the
literal `675.2` — right on one phone, wrong on every other, and indistinguishable from an ordinary
number. The extractor emits a **`_deviceDerived`** section listing every value that is a tidy
multiple of the reference; there are three, and the metrics layers encode the **ratio**, asserted by
reproducing the literal:

| key | literal | really |
|---|---|---|
| `accModalStyles.card.maxHeight` | 675.2 | H × 0.8 |
| `styles.menuContainer.width` | 253.5 | W × 0.65 *(Phase 11)* |
| `sidebarStyles.container.width` | 265.2 | W × 0.68 *(not this screen)* |

**Values outside a StyleSheet.** `components/EvalGraph.tsx` draws its own SVG, so its colours live in
JSX attributes and the AST walk never saw them. A mutation test proved the gap: changing the graph's
background to the wrapper's colour survived every assertion. The graph paints `#1A2740` *inside* a
wrapper the modal has already painted `#0F1A2E` — conflating them is exactly the silent
wrong-shade bug this machinery exists to prevent. The extractor now scans that file too.

`board_styles.json` is **committed** (unlike `Goldens/`) because it derives from a sibling repo the reader
may not have — the same reasoning that commits `eco.tsv`.

## The seven bands

`board.tsx:4565-4712` is the real top-level JSX, and it — not the written spec — is the band order:

| # | Band | Height |
|---|---|---|
| 1 | Header — `←` · Analysis Board · `☰` | fixed |
| 2 | The **32pt** vertical eval rail, then board + arrows beside it | **fixed — a square derived from the WIDTH, less the rail** |
| 3a | Status line — its own row here, not the source's shared one | fixed |
| 3b | Toolbar — 📂 · ✏️ · 💡 · 🔄 · ▶ · `⏮ ◀ ▶ ⏭` | fixed |
| 4 | Autoplay speed bar — only while autoplaying | fixed |
| 5 | Move strip — main line as tokens, branches inline as chips | fixed |
| 6 | Panels — **edit mode only**; Setup Position renders into it | flexible ≤230, in edit mode |
| 7 | Engine lines — **3pt** micro bar · ≤5 ranked rows at the move strip's size · depth + eval symbol + opening | **flexible — the only one** |

Band 6 was the ECO explorer, then a 44 pt strip of `san · eco` book chips, and is now neither: the
client asked for the strip's removal one round after it replaced the panel, and neither was earning
its height. **The opening NAME survives**, in the engine panel's info row, which is where the RN
source put it. What is left of band 6 is the edit-mode container.

Band 3a has a second face: while an engine line is being *previewed* the status line is replaced by
the **preview bar** (`◀ Qxd5 O-O Nf6 d4 ▶ ✕ ＋`), built from the same paddings so the row never
changes height.

Two things reading the source corrected:

- **The RN render has no eval bar at all** — `renderEvalBar:2741` is declared and never called (one
  grep hit, the declaration). The **3pt** one is real and belongs to the *engine panel*.

  Read the dead function and it says more than "dead". Its header comment is
  `RENDER EVAL BAR (vertical, DroidFish-style)` — and the style underneath is
  `evalBarContainer { flexDirection: 'row' }` with `evalBarWhite` animated on **width**. The author
  commented *vertical*, implemented *horizontal*, and shipped neither. When the client asked for the
  bar "sa gilid tulad lichess or chesscom", the answer was already in the source — so band 2 is an
  `HStack{rail; board}` now, and every rail number comes from that same abandoned `evalBar*` block.
  Full reasoning, and what is deliberately *not* taken from it, in
  [`../PORTING_NOTES.md`](../PORTING_NOTES.md).
- **The opening name lives in the engine panel's info row** (`board.tsx:2836-2841`), beside the depth
  chip — not in the status bar.

### Which band flexes, and why the board must not

**The board is a fixed square derived from the screen's WIDTH, and band 6 absorbs all the slack.**
Get this backwards and the screen visibly breaks — it did.

The browser used to size the board `min(100cqw, calc(100cqh - …))` inside a `flex: 1 1 auto` band, so
its **width tracked the leftover height**. Bands 6 and 7 both have content-driven heights that change
on *every move* — one ECO row per book continuation, and 0→3 engine rows as the search lands — so the
board grew and shrank as you played. Height being the binding constraint, it never filled the card
either. One cause, two very visible symptoms, and it was reported from a screenshot rather than caught
by a suite. The Swift screen had a milder form of the same mistake: the board band claimed
`maxHeight: .infinity` while `AnalysisOpeningPanel` was the one capped.

The right answer was already in the repo and already asserted — `bandLayout(viewportHeight, boardEdge)`
in the metrics layer, with `boardEdge = boardSize(width, pixelRatio)`:

```
board  = min(boardEdge, viewport - fixed)   // capped only by a SHORT SCREEN, never by content
panels = min(panelsMaxHeight, viewport - fixed - board)
```

`fixed` is a constant, so nothing here depends on what the panels contain. Neither renderer was
calling it; both do now. `sizeBands()` publishes `--an-board-edge` and `--an-panels-h`, and
`tools/qa/board_layout_check.js` asserts the CSS keeps its side of the bargain — `.an-board` is
`flex: none` with no `container-type`, no `cq` unit survives in the section, and `.an-panels` is
`flex: 1 1 auto; min-height: 0`.

On a 375×667 SE the board *is* capped — and the assertions pin that the **panels** band is what gave
way, not the board.

#### The flexible band moved to the engine panel

Client feedback on a TestFlight build: the opening-book box was a quarter of the screen holding one
line of grey "out of book" text, while the engine lines underneath were 9 pt.

That was the **layout**, not the styling. `AnalysisOpeningPanel` was a `ScrollView` inside
`.frame(maxHeight: 230)` inside `.frame(maxHeight: .infinity)`. A scrolling view is greedy along its
axis, so it drew all 230 pt whatever it contained — *and*, being the root `VStack`'s only flexible
child, it also claimed every spare pixel. The band people actually read was content-sized at the
bottom.

So the flex moved. The book is a 44 pt strip of chips, built only when `bookRows` is non-empty, and
**the engine panel is the flexible child now** — `.frame(maxHeight: .infinity, alignment: .bottom)`
placed *after* `.background`, so the panel claims the band without painting it and its rows stay
pinned to the bottom rather than floating in the slack. In CSS that is
`flex: 1 1 auto; min-height: 0; justify-content: flex-end`.

There must be **exactly one** flexible child, and that is now checked in both languages:

- delete it and SwiftUI's `.frame(width:height:)` centres the whole column, opening a navy gap above
  the header — `swift_layout_check.js` rule 4b;
- add a second and they fight over the slack, and a fixed band can be squeezed to nothing while its
  content paints over its neighbours — `board_layout_check.js` §3b pins `flex: none` on every other
  band of `.an-view`.

Neither check stands in for the other: the two renderers degrade *differently* when the flexible
child goes missing (flex leaves the gap at the bottom, SwiftUI centres), which is exactly why both
need pinning.

#### Then the book band went entirely

One round after the 230 pt panel became a 44 pt strip, the client asked for the strip too:
*"remove mo na ito, siguro hindi na ito kailangan."* So `bands()`, `fixedWithoutEngine` and
`engineAvailable` lost their `inBook` parameter in both languages — **no band varies with the
opening book any more**, and the engine panel keeps the 44 pt on every in-book position. §10c is now
the inverse assertion: autoplay is the only band left that appears and disappears.

Deleting the CSS orphaned three custom properties — `--an-row-spacing`, `--an-chip-pad-h` and
`--an-chip-pad-v` were read only by the book chips. They were **re-homed, not deleted**, onto
`.an-erow`'s `gap` and `.an-depth`'s `padding`, which had been carrying hardcoded copies of the same
numbers. The depth chip's copy was `3px 5px` against the metrics' 4/8, so the browser chip had been
two pixels tighter than the app's *and* than `engineChromeHeight()`'s own budget.

#### On a short screen the rows are DROPPED, not squashed — and rows beat wrapping

Making the engine panel flexible exposed the next thing. Flex shrinks a child while its *text* keeps
its own height, so on a 375-wide phone three wrapped rows (113 pt of content) were squeezed into a
61 pt band and the overflow painted straight over the move strip. Measured in the browser, not
guessed — `scrollHeight` on the panel did not show it, because the overflowing content belonged to
children that had themselves been shrunk.

Two changes, both symmetric across the languages:

1. **The rows are their own clipped box** — `.an-rows { flex: 0 1 auto; min-height: 0; overflow:
   hidden }`, and `rowsBox` with `.clipped()` in SwiftUI. Rows keep their natural height (`.an-erow
   { flex: none }`) and the box clips from the *bottom*, so the third line is lost before the first.
   The info row sits outside it, because the depth chip has to survive a short screen.
2. **`AnalysisLayout.enginePlan(available:wanted:)`** decides how many rows to draw and whether they
   may wrap. **Rows beat wrapping**: three single-line rows fit an SE where three wrapped rows do
   not, and seeing every move the engine considered — each truncated — beats seeing one and a half
   in full.

The plan is a *budget*, not a measurement, so it may be a point or two out; the clip is what makes
that safe. A wrong answer costs a hidden row, never an overdrawn strip.

The two renderers obtain the input differently and that is fine: the browser **measures** the other
bands (they are all `flex: none`, so summing their heights is exact), while SwiftUI computes it from
`engineAvailable(viewportHeight:edge:inBook:autoplaying:)` because it has no DOM. What they must
agree on is the *decision*, and that is one shared pure function, asserted in both metrics suites.

⚠ `bands()`' `fixed` predates the second status row and omits `statusLineMinHeight`;
`fixedWithoutEngine` is the honest total and is what the plan uses. Measured on an iPhone 15
Pro Max: header 36 + board 405 + status line 36 + toolbar 38 + strip 44 = 559 of 814, leaving 255 for
the engine — three wrapped rows with room to spare.

### The status line has its own row

Band 3 is split. The source puts the status text and the toolbar on one `statusToolbarRow`, which
works because RN's icon glyphs are narrow; with emoji, nine buttons measure **346 pt in a 365 pt
card** and the status gets ~19 pt — it vanishes entirely.

The values are not invented: `styles.statusLine` is a block the source **declares for exactly this
standalone row** (`minHeight: 36`, `paddingHorizontal: 12`) **and then never renders** — dead, like
`renderEvalBar` and `menuContainer`. So this is the layout the original had and abandoned, restored
with its own numbers, and pinned to the extracted source like everything else.

## The session layer — behaviour without a screen

Everything the board *does* is a pure function of state, so it lives in **Core**, not the view model:

| Member | Ported from |
|---|---|
| `statusText` | `board.tsx:2853-2871` |
| `openingEntry` / `openingText` | walks root→cursor through `nameFor(_:lastKnown:)` |
| `arrows` · `engineRows` | `board.tsx:2591-2664` · `:2807-2831` |
| `stripTokens` | `board.tsx:3049-3120` |
| `isStale` · `wantsAnalysis` | the restart policy (see below) |
| `evalParts` | the raw score; the UI maps it through the metrics tables |
| `LinePreview` · `canPreview` · `previewPosition` | new — see below |

That split is the point. `ParityRunner`'s `analysis_session` group (95 assertions) and
`analysis.js`'s self-test (91) assert the same behaviour in both languages, so the only thing left
unverifiable is SwiftUI's rendering. Without it, phase 8 would have been "browser only".

`evalParts` marks the boundary: turning a score into a bar fraction or a ⩲ symbol needs the metrics
tables, which live in the UI module and are unreachable from a Foundation-only Core. The session
publishes numbers; each platform maps them with the same table.

`AnalysisSession` is **not `Sendable`** — it owns a `MoveTree`, a reference graph. It stays
`@MainActor`, and only `ChessPosition` / `SearchLimits` / `AnalysisSnapshot` cross to the background.

### Tap a line to play it out

Tapping an engine row used to commit its **first move** to the tree and nothing else, so you could
never see the variation the engine was actually recommending. Now the whole line walks on the board
and the tree is not touched until you ask.

`LinePreview` is a pure value type: `start(_ row:)`, `stepped(_:)`, `jumped(to:)`, `tokens`,
`canStepForward`, `movesToCommit`. Two asymmetries are deliberate and asserted:

- `stepped` returning **nil means leave the preview** — that is what `◀` at ply 1 does. Stepping past
  the *end* is a no-op instead, because there is somewhere to go back to and nowhere to go forward.
- `jumped(to:)` out of range is always a no-op, never an exit.

It holds **UCI strings**, not `Move`s, because that is what `EngineRow` carries across the Core
boundary — and re-resolving each one against the position it is played from *is* the staleness check:
a snapshot can outlive its position, and such a line refuses both to start (`canPreview`) and to walk
(`previewPosition`). `sans` and `uci` are trimmed to a common length at `start`, so a ply you cannot
label is a ply you cannot step to.

Only the **board** shows the previewed position. The strip, the engine rows, the book and the eval
still describe the real cursor, because nothing has been played; the arrows are cleared, and the
board refuses drags. Any navigation ends the preview — in both languages that is one line in the
navigation funnel (`afterNavigation` / `afterMove`), not a guard scattered across ten call sites.

`＋` commits `movesToCommit` through the ordinary `perform`/`play` path, so `MoveTree` branches and
the strip draws branch chips with nothing new downstream.

## Threading and the engine budget

The engine is synchronous and never yields, so it runs in `Task.detached(priority: .userInitiated)`
with `await MainActor.run` hops — the shape `ChessGameVM.maybeBotMove` already uses
(`PlayView.swift:139-148`), including its stale guard. `CancelToken` is an `NSLock`-guarded flag
because `shouldCancel` is a plain synchronous closure called on the search thread.

**A deadline bounds the search, not a depth cap.** Measured in the browser, cost is ~6× per ply and
varies **15× by position type**. Any fixed depth is therefore too slow somewhere or too shallow
everywhere, so the budget is wall-clock, enforced inside `shouldCancel`, and
`AnalysisEngineLimits.maxDepth` is only a ceiling.

**That budget is now the user's choice** — ☰ > Engine, five presets from Battery Saver (0.5 s) to
Infinite, plus Advanced controls. `AnalysisTiming.engineDeadlineMs` and `AnalysisEngineLimits` are
the *Balanced* preset's numbers, which is what an install runs on until someone opens the panel; the
live search and Analyze Game both read `EngineSettings.resolve(...)` instead. **Infinite has no
deadline at all** (`shouldCancel` falls back to the cancel token alone, and `maxDepth` is what
guarantees termination) and does not apply to Analyze Game. See
[`engine-settings.md`](engine-settings.md).

Measured at 1200 ms, after the search grew a transposition table, PVS, extensions, null-move and
LMR, and the evaluation grew a game phase: mean depth over the six benchmark positions went from
**3.83 to 5.00**, and the sharpest of them from depth 2 to depth 4.

### In the browser: a Worker when it can, sliced when it cannot

This used to read "there are no Web Workers, so `analyzeProgressive` runs one depth per macrotask."
One depth per macrotask was not enough, and a user reported the consequence: piece movement felt
delayed. **One depth is one uninterruptible block** — measured, depth 3 = 624 ms and depth 4 =
2,885 ms, i.e. 37 and 173 frames during which nothing on the page can move.

`web-demo/js/engine-host.js` now owns the choice, and both screens (the analysis search and Play's
coach) go through it:

| page opened | engine runs | worst block |
|---|---|---|
| served over http | `analysis-worker.js`, a real Worker | none — the main thread never searches |
| `file://` | in-thread, one **80 ms slice** per depth | ~94 ms |

The `file://` case is the old constraint and it is still real: a document with an opaque origin
cannot construct a Worker, and the blob-URL and `data:` workarounds inherit that origin. What was
wrong was treating it as a blanket rule. The slice deadline is passed to the search's own
`shouldCancel`, which the engine polls every 2048 nodes, so the block is cut **from the inside** and
cannot overrun however sharp the position is. The engine simply reaches a shallower depth.

`analyzeSteps` remains the synchronous core, and it is what makes the slicing possible at all:
`engine-host` drives it directly so it can reset the deadline before each depth, which
`analyzeProgressive` cannot do because it builds its cancel closure once.

Two gates hold this: `tools/qa/engine_budget_check.js` times the real stepper and fails if any chunk
exceeds the budget (reporting the breach in dropped frames), and
`tools/qa/worker_protocol_check.js` drives the worker's real message protocol in a fake worker scope
— necessary because a worker bug is invisible from `file://`, invisible in Node, and *not* caught by
the host's fallback, which only fires when construction throws.

### Longer lines, without a longer think

*"Damihan mo pa moves."* A principal variation can never be longer than the search was deep — the
recursion stops writing to `line` at depth 0 and quiescence never writes to it at all — so at the
default 1.2 s preset every line was exactly the six plies the panel showed. Raising
`AnalysisSession.pvPreview` (6 → 12) removes the *display* cap but produces nothing on its own, and
the user's choice was explicitly "no extra battery".

Two mechanisms, in that order, both bounded:

1. **`Search.extendPV`** walks the transposition table forward from the PV's end. Free — a handful of
   lookups, no search. It is also *nearly useless on its own*, which is worth stating rather than
   discovering later: the PV's last position was reached at depth 0 and handed to quiescence, which
   stores no move, so the walk usually breaks on its first probe. Measured over four positions at
   depth 6 it lengthened **one line in twelve**. It stays because a transposition does sometimes hand
   back a free ply.
2. **`Search.extendTail`** is what actually delivers. One shallow search from the leaf produces a real
   continuation; its PV is appended and the probe repeats. Lines reach 10–14 plies where they used to
   stop at 6.

The bounds are what keep "think time unchanged" close to true. It runs on the **final** snapshot
only, never once per iteration; only for the lines that will be drawn; `extendProbeDepth = 2` plies a
probe; `extendProbeNodes = 4000` per line; `pvExtendLimit = 14` plies total. Depths 2, 3 and 4 all
reach the limit — measured total search time was +21%/+6%/+5%, +66%/+21%/+9% and +99%/+31%/+13% over
three positions, so the deeper probe buys nothing visible. Every appended move is legality-checked
(the table is keyed on 32/64 bits and a collision returns a move from a different position) and
de-duplicated against the line's own positions (a table of exact scores will walk a cycle forever).

Two details the browser forced, and the Swift kept:

- The probe runs on a **scratch `Search`** — its own table, killers and history — so it cannot reach
  the real search's state and change a score.
- The budget is in **nodes, not milliseconds**, because the engine's contract is that the same request
  twice returns byte-identical lines *and* an identical node count.

And one the browser needed alone: on the `file://` path the extension shares the UI thread, so the
stepper does **one line per `next()`**. Doing all three at once measured 324 ms of frozen UI, and
shrinking the budget until that fit simply starved lines two and three — the first line ate it. A
line per chunk gives every line the same budget and keeps the worst block at ~107 ms.
`engine_budget_check.js` is what found all of this; the first unbounded version measured **2.9
seconds** of frozen UI.

The probe's nodes are added to the reported count. Under-reporting work the engine really did would
make the node figure a lie and hide the cost from anyone measuring it.

### The stale-search bug we do not reproduce

`analyzePosition` guarded with `if (isAnalyzing || fen === lastAnalyzedFen) return;`
(`board.tsx:885`). Because its fetch could not be cancelled, a position change *during* a request was
**silently dropped** and the panel kept showing the previous position's lines forever. Our engine is
cancellable, so staleness means cancel-and-restart. This is asserted (`isStale`, `wantsAnalysis`) and
was checked by hand in Chrome: after moving mid-search, every arrow is legal in the *new* position.

## Game review

🔬 in the toolbar evaluates every position on the **main line**, classifies each move, scores both
accuracies, and shows the result in one modal — accuracy pair, eval graph, and a count table with
all-zero tiers dropped. The move strip then carries each move's tier symbol.

The classification and accuracy maths is `GameReview.swift`, untouched and pinned by 303 golden
cases; `ReviewAnnotator` layers the `book` tier on top without ever recomputing accuracy.

### The runner, and why it steps

A review is expensive: measured on a 40-move game (41 positions), a fixed depth 3 costs **28 s**. So
`ReviewAnnotator.Evaluator` (and `BiyaReview.reviewSteps`) evaluate **one position per call**, which
buys two things a single blocking loop cannot:

- each position gets its own **200 ms wall-clock budget**, passed through `shouldCancel`, so a sharp
  position stops at depth 2 instead of grinding to depth 3;
- the caller yields between steps, so the screen paints and **Cancel lands immediately**.

| budget | 41 positions | depths |
|---|---|---|
| 100 ms | 5.0 s | mostly d2 |
| **200 ms** | **~9 s** | d2–d3 |
| 400 ms | 17.4 s | mostly d3 |

In the browser the stepper measures 207–232 ms per position — on budget. A 40-move game takes ~18 s,
inside the original's own "This may take 20–30 seconds" promise (`board.tsx:3831`), but with a real
progress bar rather than a static string.

**Shallow classification is coarse.** The thresholds in `classifyMove` were written for a depth-12
Stockfish, so at the depths a 200 ms budget reaches, "mistake" versus "blunder" is not fully
trustworthy. This is better than it was — the same budget now searches deeper and evaluates with
`AnalysisEval` rather than material-plus-one-table — and a user who wants a trustworthy review can
raise the preset, since the per-position budget scales with it (Maximum gives each position 1200 ms).
It remains a property of the interim engine rather than of the port, and goes away when Stockfish
lands.

`evaluate(_:engine:limits:)` is deliberately **left in place** — it is right for a headless harness,
and `review_book` and `tools/qa/review_demo.js` still use it.

### The index rule

`moveEvaluations[].moveIndex` is **1-based** (0 is the starting position) while the plan's nodes are
0-based, so the node for an evaluation is `nodes[moveIndex - 1]` — the same `- 1` the source does at
`applyClassificationsToTree:1827`. Both parity suites assert this with a **hand-built** result rather
than an engine's, so the mapping is proved independently of what any search happens to return.

A cancelled run leaves the evaluations **short**. `isComplete` is the guard: a short array means
*cancelled*, never a truncated game, and nothing is stamped.

### Deviations

- **One action does both halves.** The original splits review across two incomplete paths:
  `runAccuracyAnalysis:2254` shows the modal but discards `move_evaluations` (so the strip stays
  blank), and `handleAnalyzeGame:1854` stamps the strip but shows only an `Alert` — no modal, no
  graph, no cancel.
- **No classification badge on the board.** `renderAnnotationOverlay:2661` draws the *manual* PGN
  glyph for the selected move and never reads `reviewClassification`. `AnalysisBadge` waits for
  Phase 11's annotation picker.
- **Book appears in the table.** The source's `CLASSIFICATION_ORDER` has 9 entries against a 10-key
  table, so a Book row could never display.
- The third modal state is **"Not enough moves"**; offline, the engine cannot be unreachable, so the
  429/503/network branches have no counterpart.

## Persistence

💾 saves the current game with its metadata; 📂 opens the library. Games live in folders, and an
autosaved draft means closing the screen mid-analysis is not destructive.

**PGN is the source of truth.** A saved record stores the full PGN — headers included, unlike the
original's movetext-only `generatePgn()` — plus a denormalised index of the fields the library list
shows, so drawing it does not mean parsing fifty PGNs. Only `title` and `notes` have no PGN tag of
their own; the other eleven round-trip through the header block.

### The store

Records mirror the Laravel schema (`analysis_sessions`, `analysis_folders`) so a future sync stays
possible, and the field limits are the **controller's `validate()` rules** — tighter than the columns,
so they are the real contract. `AnalysisStore` is pure: no filesystem, no clock. **Time is an injected
parameter**, the same way `PuzzleServing` injects its picker, which is what makes the draft TTL
testable at all. `AnalysisLibraryFile` is ten lines of atomic I/O around it.

It is plain `Codable` JSON rather than SwiftData. That is deliberate — see below.

Rules worth knowing:

- **Deleting a folder unfiles its games, never deletes them** (the FK is `nullOnDelete`, and the
  controller nulls them explicitly first). Default folders refuse both rename and delete (403).
- Three folders are seeded lazily on first use, with the server's exact names, colours and order:
  *Opening Repertoire*, *Setup Position*, *My Games*.
- Ids are never reused. Saving with an id that no longer exists **inserts with a fresh id**.
- Search is a plain substring across title, notes and both players — `ilike '%term%'`, so it matches
  mid-word.
- Drafts: **800 ms** debounce, **24-hour** TTL, silent restore, and reading a stale draft **prunes**
  it. All four are the source's own behaviour.

### One canonical document

Because both stores are JSON, the same canonical library string is hardcoded in
`web-demo/js/analysis-store.js` and in ParityRunner's `analysis_store` group, and each language
asserts it decodes to the same records. That is a genuine cross-language contract rather than two
implementations agreeing with themselves — and it is only possible because this is JSON and not a
`ModelContainer`, which no harness in this repo can reach.

`tools/qa/canonical_library_check.js` guards it: it reads the literal out of `main.swift` and
compares byte for byte. Without that, a drift would be invisible — each side would keep asserting
against its own copy and both suites would stay green while the contract quietly evaporated.

Byte-identical *re-encoding* across languages is deliberately **not** claimed: `JSONEncoder(.sortedKeys)`
orders keys alphabetically and `JSON.stringify` uses insertion order. Each side asserts its own round
trip is a fixpoint; the shared claim is the decoded values.

### Deviations

Three of them are source bugs:

- **`initial_fen` is never sent on save** (board.tsx:1026-1043), and `generatePgn()` emits no `[FEN]`
  header, so a custom-setup game does not survive a save/load round trip there. Ours persists it.
- **`@biyaherong_openfile_draft` is write-only** — written at :840, read nowhere. Unsaved edits to an
  opened game are silently lost. Ours reads it back.
- **The save modal has no Title field**, though the column is NOT NULL and the library shows the
  title. Ours has one.

And three are consequences of being offline: no free-session cap (no accounts), no
`share_token`/`is_shared` (nothing to share through), and no `move_annotations` — the server needs
that column because its client serialises movetext only, while ours emits NAG suffixes inline.

## Setup Position (edit mode)

`PositionEditor` is a plain value type holding 64 squares, a side to move and four castling flags. Place
a piece, erase one, clear the board, flip the turn, paste a FEN — and `validate()`.

**Reach it from ☰ → Edit Board.** While it is open the board becomes a fixed `BOARD_SIZE` square and the
status row, move strip, autoplay bar and engine lines all disappear. That is the source's own behaviour
(`board.tsx:4616`, "to maximise board space"), and it is also what makes the panel fit: the board band is
`flex: 1` and would otherwise push the Apply button off the bottom of a phone.

**Double-tap an occupied square to remove the piece** — the source's gesture, at its own 350 ms window.

### What the validator refuses, and why it has to

The original checks only two things itself (`validateKingPositions:334`) and hands the rest to chess.js:
`toggleEditMode:2448` builds the FEN, calls `new Chess(fen)`, and catches the throw. Offline there is no
chess.js, so what that constructor refused had to be written down:

| Issue | Message |
|---|---|
| `whiteKingMissing` / `blackKingMissing` | *"White king is missing."* — the source's own string |
| `tooManyWhiteKings` / `tooManyBlackKings` | more than one king of a colour |
| `kingsAdjacent` | *"Kings cannot be adjacent — illegal position."* — also verbatim |
| `pawnOnBackRank` | a pawn on rank 1 or rank 8 |
| `sideNotToMoveInCheck` | you cannot be about to be captured |

They come back in that fixed order so the banner does not flicker between renders, and the adjacency test
walks **every** king pair — on a board that already has a duplicate king, checking only the first of each
colour would let a genuine adjacency hide behind the count error.

One deliberate softening: **castling rights whose king or rook is not on its home square are dropped
silently** (the X-FEN convention) rather than reported. Ticking `⬜K` on a board with no h1 rook is a
statement of intent, not an error, and refusing would be a dead end with no obvious fix.

The editor never emits an en-passant square and always emits fresh clocks — neither does the original,
because chess.js produces `-` and `0 1` for any position it did not reach by playing moves.

## PGN in and out

- **Import** (☰ → Import PGN) takes pasted text or a file. Variations, NAGs and comments all survive,
  because `PGN.parse` has handled them since Phase 3; what Phase 11 added is the screen.
  The headers **pre-fill the save form**, but only where a field is still empty (`handleImportPgn:2333`),
  so an import never overwrites something you typed. A multi-game file loads the **first** game and says
  how many it found.
- **Export** (☰ → Copy PGN / Export PGN) serialises the whole tree — headers, variations, NAGs and all —
  and the round trip is exact: importing an export and exporting again is byte-identical, asserted in
  both languages. A custom start position survives it too, via `[SetUp]`/`[FEN]`, which the source's
  `generatePgn()` does not emit.

`PGN.parse` is deliberately tolerant: hand it a paragraph and it returns a zero-move game full of parse
errors rather than refusing. That is right for a parser and wrong for an import — wiping the board because
someone pasted prose is destructive — so `importPGN` counts a game only if it produced **at least one
move, or a custom start position**. A setup-only PGN is a legitimate import; a paragraph is not, and the
board is left exactly as it was.

## Annotations, and the badge that was in the wrong corner

Annotations are stored as **NAG codes** on the node, not as symbol strings. `MoveNode.nag` already existed
and `PGN` already round-trips `$n`, so a symbol string would have been a second encoding of the same fact.
`AnalysisSession.nagSymbols` is the one table, and `nag(forSymbol:)` is derived from it so the two cannot
disagree.

Long-press a move token for the picker; long-press a **branch chip** and you get the variation card
instead, because that is the useful action there. Both at 400 ms — the source's `delayLongPress`.

Two details ported exactly as they are:

- The badge draws for **move-quality annotations only**. `renderAnnotationOverlay:2670` looks the symbol
  up in `MOVE_ANNOTATIONS` alone, so `±` shows in the move strip and draws nothing on the board.
- It reads the **manual** annotation, never the review classification — those appear only as the 9pt
  symbol after the SAN in the strip.

### The corner, and why no suite caught it

`squareToPixel` (`board.tsx:320-329`) returns the square's **centre**, and `renderAnnotationOverlay`
adds `+ SQUARE_SIZE * 0.29` to **both** axes — bottom-right. This rebuild subtracted on y, in Swift *and*
in JavaScript, and each asserted the other's answer. Two hand-typed copies agreeing is not verification.

The reason it was possible: `board_styles.json` covered StyleSheet blocks and module constants, and the
badge multipliers live inside a render function, so they were on the plan's explicit hand-transcribe list.
`extract_board_styles.js` now has a **`renderConstants`** section that walks `squareToPixel`,
`renderArrowsOverlay`, `renderAnnotationOverlay` and `renderEditSquare`, flattening every
`const NAME = <expr>` and every braced JSX attribute into signed additive terms:

```json
"cy": { "text": "pos.y + SQUARE_SIZE * 0.29",
        "terms": [ { "sign": 1, "ref": "pos.y", "ratio": 1 },
                   { "sign": 1, "ref": "SQUARE_SIZE", "ratio": 0.29 } ] }
```

Both harnesses now assert the **direction** of an offset, not only its size — and the anchor function is
extracted too, so "centre or corner?" is answered by data rather than by reading. That retires the last
hand-transcribed set.

One consequence worth knowing when editing the overlay: unlike the arrows, the badge **cannot** be drawn
in a one-unit-per-square viewBox. Its geometry mixes ratios of a square (radius 0.21, offset 0.29) with
**absolute point** offsets (the 1.5pt shadow and the 1.5pt ring). In a unit box those 1.5s become one and
a half squares. It draws in the board's real pixel space instead.

## Haptics

`board.tsx` has none. But it renders `DragDropChessBoard`, and that component fires
`Haptics.impactAsync(Light)` on **drag pickup** (`DragDropChessBoard.tsx:351`), after its piece-exists and
correct-colour guards — so the analysis board does have exactly one, by inheritance.

`Haptics.swift` ports that and adds three, chosen with the user and recorded in `PORTING_NOTES.md`:

| Kind | When | Source? |
|---|---|---|
| `.pickUp` | a piece is picked up | ported |
| `.move` | a quiet move lands | added |
| `.capture` | a capture or a check | added |
| `.success` | a game review finishes | added |

Nothing else vibrates — navigation, menu items and modals are deliberately silent. macOS is a no-op, which
is why this lives in the UI layer and not in Core.

## The ☰ menu

Four sections, matching `renderMenu:4489`: **Game** (New Game · Edit Board · Import PGN · Analyze Game),
**File** (Save · Load), **Share** (Copy PGN · Export PGN), **Settings** (Engine Arrows · Autoplay Speed ·
Board Theme).

Two notes for anyone touching its metrics. The live block is **`sidebarStyles`**, width `W × 0.68`;
`styles.menuContainer` (`W × 0.65`) belongs to a **dead** earlier menu, and both are flagged in
`board_styles.json`'s `_deviceDerived` for exactly that reason — the check asserts that the two really are
different widths, so encoding the wrong one fails. Board Theme is the one row the source's menu does not
have: offline there is no Master DB item to sit there, and the theme picker had nowhere else to live once
☰ stopped being its Phase-8 stand-in.

**The toolbar is the source's nine buttons**, not eleven. Phases 9 and 10 put 💾 🔬 📂 there because there
was no ☰ yet; measured, eleven came to 437pt inside a 365pt card and squeezed the status text into three
lines that collided with them. Save, Load and Analyze Game live in ☰ where the source keeps them, and the
toolbar's ✏️ is what it is in the source — the **annotation picker for the current move**
(`board.tsx:4626`), disabled at the root — not Edit Board.

## The metrics layer

`AnalysisMetrics.swift` and `web-demo/js/analysis-metrics.js` are line-for-line mirrors holding every number
the screen uses:

- `AnalysisBoard` — `size(screenWidth:pixelRatio:)`, the original's
  `floor(width * ratio / 8) * 8 / ratio`, so a square is always a whole number of device pixels.
- `AnalysisLayout` — the seven bands. **They are (fixed, flexible) pairs, not seven literals:** seven fixed
  heights overflow a 375×667 SE, so the flexible band gives way and the board band absorbs the slack.
  "The bands sum to the viewport at 375×667, 390×844 and 430×932" is an assertion, not a hope.
  `bands(viewportHeight:boardEdge:inBook:)` takes the book into account, because a strip that is
  sometimes 44 and sometimes 0 changes the budget.
- `AnalysisPalette`, `BoardTheme`, `BoardStyle`, `AnalysisIndicator` — colours and square fills.
- `AnalysisArrow`, `AnalysisBadge` — pure geometry, returning points a renderer just draws.
- `AnalysisEval`, `AnalysisGraph`, `AnalysisTables` — the eval bar/graph and the classification,
  annotation, eval-symbol and autoplay-speed tables.
- `AnalysisTiming` — debounce 300 ms, autosave 800 ms, animation 400 ms, double-tap 350 ms. (`400` appears
  six more times in the source as `delayLongPress`; a bare grep would conflate the two.)

### Every engine line carries its rank, in its arrow's colour

The board draws up to three engine arrows, coloured by rank — green, blue, orange — and nothing on
screen said which row belonged to which arrow, or even which line was first. Each row now opens with
a one-digit badge tinted `AnalysisArrow.color(rank:)`, so the number answers "which line" and "which
arrow" at once.

- `EngineRow.rankLabel` does the `+ 1` in **Core**, mirrored in the JS `engineRows`. A view body may
  not contain arithmetic (`AnalysisBoardScreen.swift:16-18`, and `swift_layout_check` greps for it),
  and both languages have to print the same thing.
- The badge takes `AnalysisType.engineDepth` (11), not the row's 13. Every other engine cell is
  asserted equal to the move strip's size, so a new size would need its own `deviates(…)`;
  `engineDepth` is the existing chip size and already a declared deviation. A badge as large as the
  moves would also out-shout them.
- **Width is the cost, not height.** The 44 pt reclaimed from the book band pays for the badge
  vertically; horizontally it is a new column on a row that was already tight. `engineRankWidth` is
  16 — one digit, and `engineMaxRows` is 5, so a second can never be needed — and §10e pins what is
  left for the moves: at 375 the continuation still gets 239 pt, 30 characters a line, 60 across two
  lines, against the ~50 a 12-ply continuation needs.

### The engine panel is drawn larger than the source — declared, not smuggled

The source draws the engine rows at 9/10/8 pt (`board.tsx`, pinned by `board_styles.json`). On a real
phone the client could not read them: *"lakihan mo kasing laki ng chess notation"*. So they are drawn
at the **move strip's** size instead — and derived from it (`engineEval = stripMove`), not re-typed,
so "the same size as the notation" is true by construction.

| cell | source | drawn |
|---|---|---|
| eval `−2.6` (`engineEval`) | 9 | **13** = `stripMove` |
| best move `Qxd5` (`engineSan`) | 10 | **13** = `stripMove` |
| continuation (`enginePv`) | 9 | **13** = `stripMove` |
| `engineText` | 9 | **13** = `stripMove` |
| opening name (`engineOpening`) | 9 | **12** = `altChip` |
| depth chip `d:6` (`engineDepth`) | 8 | **11** — a chip as large as the moves would out-shout them |
| eval rail `+0.5` (`evalRail`) | 11 | **11** = `evalBarText.fontSize` — the source's own number, unaltered |

The source assertions are **not deleted, they are inverted** — the ⩲/⩱ precedent. `deviates(key, prop,
ours, source, why)` asserts that the RN source still holds its value *and* that ours differs in the
intended direction, so the divergence stays visible and an accidental drift is still caught. Column
widths (`engineEvalWidth` 36→44, `engineSanWidth` 38→46) grew with the type, for the same reason and
by the same mechanism: at 13 pt, `M-3` and `O-O-O` clip.

**No numeric literal or arithmetic belongs in a view body.** Every number is a stored property or a pure
function here. That rule is the only reason the layout can be asserted without a renderer — break it and
coverage drains out silently. It is why `BoardStyle` has `dotSize(square:)` rather than the view writing
`square * style.dotRatio`.

## Board upgrades

`BoardView` is **extended, not forked** — Play, Puzzles and the two `PhoneView` call sites use the same
board, and duplicating its sliding-piece identity logic would drift. Three defaulted stored properties were
appended **after** `onTap`:

| Property | Default | Effect when defaulted |
|---|---|---|
| `style: BoardStyle` | `BoardStyle()` | reproduces today's exact inline colours |
| `customHighlights: [Int: Color]` | `[:]` | nothing drawn |
| `onDragMove: ((Int, Int) -> Void)?` | `nil` | the drag gesture is masked off entirely |

Two things about that are load-bearing and easy to get wrong:

- **New stored properties are never `private`.** `private let x = <value>` is omitted from the memberwise
  initializer (SE-0242) and so does not downgrade its access — which is why the two colour constants could be
  private before. A **`private var`** *is* included, would make the init private, and would break the
  cross-file call sites in `PhoneView.swift` and `PuzzleView.swift`.
- **Drag attaches to the board-level `ZStack`, never to pieces** — `pieceLayer` is
  `allowsHitTesting(false)`, so a gesture on a piece would never fire. It is disabled with
  `.gesture(dragGesture, including: onDragMove == nil ? .subviews : .all)`; a plain `if` would change the
  body's return type.

`BoardStyle` carries a **fill mode**, not just colours: the spec's highlights *replace* the square fill,
while today's board *overlays* translucent rectangles. That is a structural difference, so `replacesFill`
picks between two models rather than pretending a palette swap is enough.

Arrows are an `.overlay` at the call site (`BoardArrows.swift`) rather than a member of `BoardView`, matching
how `PromotionOverlay` is already applied — it keeps the shared board free of anything analysis-specific.

The JavaScript half is documented in [`web-demo.md`](web-demo.md#arrows-and-drag-added-for-the-analysis-board),
including the three hazards that make drag able to silently break tap-to-move in Play and Puzzles.

## Testing notes

- `tools/qa/board_component_test.js` runs `chess-board.js` inside a `vm` context with a purpose-built fake
  DOM. It is **not** a browser: it cannot prove layout or real hit-testing, and it stubs the rules adapter.
  What it does prove is the arrow geometry (cross-checked against `analysis-metrics.js`, which is an
  independently written implementation), the drag state machine, and that tap-to-move still completes with
  drag enabled.
- Real hit-testing is checked in the browser, by `?selftest`, using `elementFromPoint` through the Shadow
  DOM. That is the assertion that catches the overlay stealing the tap target.
- The engine's mate expectations came from an independent brute-force checker, not from reading the board —
  eyeballing them produced four wrong entries.

After any change here, log it in [`../CHANGELOG.md`](../CHANGELOG.md), record deviations in
[`../PORTING_NOTES.md`](../PORTING_NOTES.md), and keep the JS twin in lockstep — a divergence between the two
pure layers is exactly what the mirror exists to catch.
