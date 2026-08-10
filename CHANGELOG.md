# Changelog

All notable changes to this project are logged here, **newest first**. Dates are absolute (`YYYY-MM-DD`).
Loosely follows [Keep a Changelog](https://keepachangelog.com). **Every change should add an entry** — see
the **Workflow** section in [`CLAUDE.md`](CLAUDE.md).

Tags: **Added** (new feature) · **Changed** (behavior/refactor) · **Fixed** (bug) · **Docs**.
Each entry notes whether `web-demo/` was updated.

## [Unreleased]

### 2026-08-10 (fix) — the board now fills the screen and stops moving

Reported from a screenshot: the board did not fill the phone, and it grew and shrank on every move.
**One bug, both symptoms** — and it lived entirely in CSS, where nothing in this repo was looking.

- **Fixed** — **the board was sized from leftover height instead of from the screen width.**

  ```css
  .an-board            { flex: 1 1 auto; container-type: size; }
  .an-board chess-board{ width: min(100cqw, calc(100cqh - var(--an-eval-h) - 4px)); }
  ```

  `100cqh` is the band's leftover, so the board's **width tracked the leftover height**. Two siblings
  have content-driven heights that change on literally every move: the ECO panel (one row per book
  continuation, 0 → 230 px) and the engine panel (0 rows → 3 as the search lands). So the board
  resized as you played. And because height was the binding constraint, the board was also narrower
  than the card — the gutters in the screenshot.

  The board is now `flex: none` at `var(--an-board-edge)`, published by a new `sizeBands()` from
  **`MET.bandLayout(...)`** — the pure function that already encoded the right answer and is already
  asserted at 375×667, 390×844 and 430×932 in both languages. It simply was never called: the CSS
  had its own idea and the Swift screen had a third. `.an-panels` becomes `flex: 1 1 auto` and
  absorbs every bit of slack, so nothing the engine or the book does can reach the board.
  Files: `web-demo/css/app.css`, `web-demo/js/analysis.js`.
  _(web-demo: this IS the web-demo fix.)_
- **Fixed** — the same starvation in SwiftUI, in a milder form. `boardBand` already derived its edge
  from the width, so it never had the *resizing* symptom, but it claimed `maxHeight: .infinity` while
  `AnalysisOpeningPanel` sat capped at `panelsMaxHeight` — so the board band was still the greedy one
  and the ECO panel got squeezed instead of flexing. The board band now hugs its fixed square and the
  opening panel is the flexible one. Files: `DemoApp/Sources/BiyaherongUI/AnalysisBoardScreen.swift`.
- **Changed** — **the status line gets its own row.** In the reported screenshot there was no status
  text at all: nine emoji buttons measure **346 pt in a 365 pt card**, leaving it ~19 pt. RN's icon
  glyphs are narrower than emoji, which is why the source gets away with one `statusToolbarRow`.
  The numbers are not invented — they are `styles.statusLine`'s, a block the source **declares for
  exactly this standalone row and then never renders** (dead, like `renderEvalBar` and
  `menuContainer`). Recorded as a deviation. Files: `web-demo/css/app.css`, `web-demo/js/analysis.js`,
  `AnalysisBoardScreen.swift`, `AnalysisMetrics.swift` (+ `analysis-metrics.js`).
- **Changed** — `sizeEditBoard()` and `--an-ed-board`, added in phase 11, are **deleted**. They gave
  edit mode a fixed board with a second copy of the formula; `sizeBands()` supersedes them, and the
  board is now the same fixed square in edit mode and out of it — which is all the override wanted.
- **Added** — **`tools/qa/board_layout_check.js`**, because this bug was invisible to every existing
  gate. `analysis-metrics.js` asserts the right *numbers*, but the CSS was not asking for them, and
  `metrics_key_check.js` reads JS and Swift, not stylesheets. Every suite was green while the screen
  was visibly wrong — the same failure mode as the annotation badge, one layer down.
  It asserts the structural invariants: the board band is `flex: none` with no `container-type`, the
  board and eval bar take `var(--an-board-edge)`, **no `cq` unit survives anywhere in the Analysis
  Board's CSS**, `.an-panels` is `flex: 1 1 auto; min-height: 0`, the JS publishes what the CSS
  reads and goes through `bandLayout` rather than a second copy of the formula, the resize listener
  removes itself, and the status line has its own row. Verified by reintroducing the original two
  declarations: five assertions fail, each naming the actual mistake.
- **Added** — the regression assertion the numbers side was missing, in both harnesses: **the board
  edge is a pure function of width**, identical at viewport heights 500/667/844/932/1200; and
  `bandLayout(...).board` equals the full edge at 390×844 and 430×932, is capped but non-zero at
  375×667, and it is the **panels** band that gave way there. Plus `statusLine`'s three keys pinned
  to the extracted source.

**Swift side unverified by compilation** — `swift` is not on PATH here; `swift build` and
`AnalysisMetricsCheck` remain for the Mac. **The browser pass is also outstanding**: the Chrome
connected to this session runs on a different machine from the local server, so the served page
could not be reached. The static invariants above cover the mechanism; seeing it is still worth doing.

### 2026-08-10 (phase 11) — edit mode, PGN I/O, the remaining modals, haptics

The last feature phase. What was missing until now was everything that lets you *author* rather than
only watch: build a position, import or export a PGN, annotate a move, manage a variation, or reach
the ☰ menu — which had been cycling the board theme as a Phase-8 stand-in.

- **Fixed** — **the annotation badge was drawn in the wrong corner, in both languages.**
  `squareToPixel` (board.tsx:320-329) returns the square's **centre**, and
  `renderAnnotationOverlay:2676-2678` adds `+ SQUARE_SIZE * 0.29` to **both** axes → bottom-right.
  `AnalysisBadge.geometry` subtracted on y, and the JS twin asserted the same wrong thing. Two
  hand-typed copies agreeing with each other is not verification, and no suite could catch it
  because `board_styles.json` only covered StyleSheet blocks — the badge multipliers were on the
  plan's explicit hand-transcribe list.
  Fixed structurally as well as literally: **`extract_board_styles.js` gained a `renderConstants`
  section** that walks `squareToPixel`, `renderArrowsOverlay`, `renderAnnotationOverlay` and
  `renderEditSquare`, flattening each `const NAME = <expr>` and each braced JSX attribute into
  signed additive terms. Both harnesses now assert the **direction** of an offset, not just its
  size — and the anchor function is extracted too, so "centre or corner?" is answered by data.
  That retires the last hand-transcribed set. Mutation-tested: the sign flip, both 1.5pt offsets,
  the 0.21/0.29 ratios and the 0.37 baseline are all caught. It also closed a real hole — nothing
  had ever asserted `textBaseline` at all.
  Files: `tools/metrics/extract_board_styles.js`, `DemoApp/…/AnalysisMetrics.swift`,
  `DemoApp/…/AnalysisMetricsCheck.swift`, `web-demo/js/analysis-metrics.js`.
  _(web-demo: mirrored.)_
- **Added** — **`Sources/BiyaherongCoachCore/PositionEditor.swift`** and its twin
  **`web-demo/js/position-editor.js`**: Setup Position as a pure value type. Place, erase, clear,
  reset, flip the side to move, paste a FEN, and `validate()`.
  The validation is the interesting part. The source checks only two things itself
  (`validateKingPositions:334`) and delegates everything else to chess.js — `toggleEditMode:2448`
  wraps `new Chess(fen)` in a try/catch. Offline there is no chess.js, so what that constructor
  refused had to be written down: **missing king · two kings of one colour · adjacent kings · a pawn
  on rank 1 or 8 · the side NOT to move already in check**. The first two messages are the source's,
  verbatim. Castling rights whose king or rook is not home are **dropped silently** (X-FEN), because
  refusing would be a dead end with no obvious fix.
  Files: `Sources/BiyaherongCoachCore/PositionEditor.swift`, `web-demo/js/position-editor.js`.
  _(web-demo: mirrored.)_
- **Added** — `ParityRunner` group **`position_editor`** (83 literal assertions, floor 80) and a
  97-assertion JS suite. Mutation-tested: 17/18 killed. The survivor is documented and
  **JS-equivalent, not a hole** — removing `loadFEN`'s `.trim()` changes nothing in JavaScript,
  because `engine.js` splits on `/\s+/`; it is load-bearing only in Swift, where
  `ChessPosition(fen:)` splits on the space character alone, so the assertion that kills it lives in
  the Swift group.
- **Added** — `AnalysisSession` gained the authoring layer, all pure and all asserted:
  `setNAG`/`clearNAG`, `annotationSymbol`, `annotationSquare`, `variationInfo`, `promote`,
  `deleteBranch`, `importPGN`, `exportPGN`, `applyEditedPosition`. `analysis_session` grew from 137
  to 235 literal assertions; its floor went 125 → 200.
- **Added** — the **☰ sidebar** (four sections, ten items), **Setup Position**, **Import PGN**
  (paste *and* file), **Copy / Export PGN**, the **annotation picker** on a long-press, the
  **variation card** with its delete confirmation, and the **autoplay-speed picker** — in both
  languages. Files: `DemoApp/Sources/BiyaherongUI/AnalysisMenuSidebar.swift`,
  `AnalysisEditPanel.swift`, `AnalysisPgnModals.swift`, `AnalysisAnnotationPicker.swift`,
  `AnalysisVariationModal.swift`, `Haptics.swift`; `web-demo/js/analysis.js`, `web-demo/css/app.css`.
  _(web-demo: mirrored.)_
- **Added** — **`Haptics.swift`**. `board.tsx` has none, but it renders `DragDropChessBoard`, which
  fires a Light impact on **drag pickup** (`DragDropChessBoard.tsx:351`) — so that one is a port.
  Three are additions, chosen with the user: a soft tap on move commit, a heavier one on
  capture-or-check, and a success notification when a review lands. Nothing else vibrates. macOS is
  a no-op.
- **Changed** — **the toolbar went back to the source's nine buttons.** Phases 9 and 10 added 💾 🔬
  📂 there because there was no ☰ yet. Eleven buttons did not fit: measured at 437pt inside a 365pt
  card, overflowing by 72 and squeezing the status text into three lines that collided with them.
  Save, Load and Analyze Game now live in ☰ where the source keeps them, and the toolbar's ✏️ is
  what it is in the source — the **annotation picker for the current move**
  (`board.tsx:4626`), disabled at the root — not Edit Board.
- **Changed** — edit mode **hides the status+toolbar row, the strip, the autoplay bar and the engine
  lines**, following `board.tsx:4616` ("to maximise board space"), and the board becomes the fixed
  `BOARD_SIZE` square the source's `editBoard` style is. Without a definite height the CSS
  container-query board collapsed to 4px and the panel was unreachable below the fold.
- **Changed** — `POSITION_ANNOTATIONS`' ⩲/⩱ inversion is corrected, as `EVAL_SYMBOLS`' already was.
  It matters more here: the picker writes **NAGs into the PGN**, so shipping the source's swap would
  emit `$15` where `$14` is meant and every other chess program would read the position backwards.
- **Added** — **`tap` on `<chess-board>`**: fires for every square, before any selection logic and
  regardless of `interactive`, because Setup Position needs "which square did you touch" with no
  notion of a legal move. Purely additive; the component suite grew to 111 assertions covering empty
  squares, non-interactive boards and the swallowed post-drag click.
- **Added** — three new gates, each written because a real bug got through:
  - **`tools/qa/metrics_key_check.js`** — every `MET.<BLOCK>.<key>` in JS **and** every
    `AnalysisEdit.foo` in Swift must exist. `analysis.js` read `MET.TIMINGS.doubleTap` and
    `MET.TIMINGS.longPress`; the real keys are `doubleTapWindow` and `longPressDelay`. Neither threw
    — `undefined` made the double-tap comparison false forever and `setTimeout(fn, undefined)` fire
    immediately — so double-tap-to-remove silently did nothing through a fully green suite, and only
    driving the real UI in a browser found it. 1,045 references now resolve at the gate.
  - **`tools/qa/swift_source_keys.js`** — the same question pointed the other way: every StyleSheet
    lookup `AnalysisMetricsCheck` makes must have a value to find. A key that is not in the JSON
    reads back `nil` and fails on the teammate's Mac, not here. 111 lookups.
  - **`tools/qa/replay_position_editor.js`** — the standing mitigation for blind-written Swift,
    generalised: it pulls the concrete (input, expectation) pairs out of `main.swift`'s and
    `AnalysisSession.swift`'s source text and runs them through the proven JS. 65 confirmed,
    including every entry of the 14-code NAG table.
- **Fixed** — `analysis.js` used `PE.*` without importing `position-editor.js`, so Edit Board threw
  `ReferenceError` inside a click handler where nothing surfaced it. Same class as Phase 10's
  missing `pgn.js`; the dependency now sits with the others at the top of the file so a missing
  `<script>` tag fails at load.
- **Fixed** — the status line is clamped to two lines (`numberOfLines={2}`, board.tsx:4619). It had
  been wrapping to three and overlapping the toolbar on a phone-width card.
- **Fixed** — the badge overlay cannot use the arrows' one-unit-per-square viewBox: its geometry
  mixes ratios of a square (0.21, 0.29) with **absolute point** offsets (the 1.5pt shadow and ring).
  In a unit box those became one and a half *squares* and the ring rendered eight times too large.
  It now draws in the board's real pixel space.
- **Changed** — the extractor also captures **numeric and string module constants**
  (`EDIT_PALETTE_PIECE_SIZE`, …), which are as easy to mistype as a StyleSheet value and were
  previously unpinned.

**Deviations recorded in `PORTING_NOTES.md`:** the badge-corner correction and why the twin missed
it; ⩲/⩱ in `POSITION_ANNOTATIONS`; the five validation rules standing in for chess.js; silent
castling normalisation; the three added haptics; the dropped GM-reference branch of the variation
card; first-game-only PGN import; and export-as-text-plus-download in place of the OS share sheet.

**Swift side unverified by compilation** — `swift` is not on PATH on this checkout. Likely
first-compile fixes, in order of probability: **`.fileImporter`/`.fileExporter`** (the one genuinely
new API surface in this phase, and `FileDocument` needs `UniformTypeIdentifiers`);
`UIPasteboard`/`NSPasteboard` behind `#if canImport`; `@MainActor` isolation on `Haptics.enabled`;
`PositionEditor` being a value type inside a `@Published` (mutations must go through the binding);
and `AnalysisSession.VariationInfo` needing `Equatable` for the `Sheet` enum, which it has.

### 2026-08-10 (phase 10) — persistence

- **Added** — **`Sources/BiyaherongCoachCore/AnalysisStore.swift`** and its twin
  **`web-demo/js/analysis-store.js`**: the saved-game library. Records mirror
  `../BYAHERONG-COACH-LARAVEL`'s `analysis_sessions` / `analysis_folders` so a future sync stays
  possible, and the field limits are the **controller's `validate()` rules**, which are tighter than
  the columns (`white_player` is varchar(255) but validated `max:100`). Everything is pure — no
  filesystem, no clock; **time is an injected parameter**, the same way `PuzzleServing` injects its
  picker, which is what makes the 24-hour draft TTL assertable at all.
  Files: `Sources/BiyaherongCoachCore/AnalysisStore.swift`, `web-demo/js/analysis-store.js`.
  _(web-demo: mirrored.)_
- **Added** — **`Codable` JSON, not SwiftData.** This is the app's first writable persistence, so it
  sets the idiom. Codable is already the house style across Core, carries no macro risk on a machine
  with no compiler, and — the real prize — because the browser mirror stores localStorage JSON, both
  languages assert **one canonical library document**. Swapping to SwiftData later is mechanical: the
  record shapes do not change. Files: `DemoApp/Sources/BiyaherongUI/AnalysisLibraryFile.swift`
  (atomic write to Application Support, corrupt-file fallback to empty).
- **Added** — **`tools/qa/canonical_library_check.js`**, which reads the canonical document out of
  `main.swift`'s multiline literal and compares it byte for byte with the JS constant. Without it
  the contract would evaporate silently: each side would keep asserting against its own drifting
  copy and both suites would stay green. Verified by mutation — a one-digit change is caught and
  pinpointed to the offset. Files: `tools/qa/canonical_library_check.js`, `tools/qa/js_goldens.js`.
- **Added** — `ParityRunner` group **`analysis_store`** (96 assertions, floor 80) and a
  98-assertion JS suite, both covering id allocation, folder rules, filtering, search and drafts.
  Mutation-tested: 13/13 killed, including the nullify-on-delete rule, both `isDefault` guards, the
  TTL boundary and the stale-draft prune.
- **Added** — the **save form** (all 13 metadata fields plus a Title, folder chips, result picker)
  and the **library** (folder filter with counts, search, open, delete) in both languages, plus
  800 ms debounced draft autosave with silent restore. Files:
  `DemoApp/Sources/BiyaherongUI/AnalysisLibraryModals.swift`, `AnalysisVM.swift`,
  `AnalysisBoardScreen.swift`, `web-demo/js/analysis.js`, `web-demo/css/app.css`.
- **Added** — `AnalysisSession.replaceTree(_:)` and a public `PGN.Game` initializer. Opening a saved
  game needs both: a tree built from a parsed PGN has to replace the live one, and everything derived
  from the old tree — the engine snapshot and the review's node ids — must be dropped in the same
  moment, or a stale classification reappears on an unrelated move.
- **Fixed** — `reset()` did not clear the cached library, so a stale in-memory copy could be written
  back over an external change. Caught in the browser: one save produced two rows. Files:
  `web-demo/js/analysis.js`.
- **Fixed** — the bottom sheet was 89% of the screen rather than its specified 85%, because the
  padding sat outside `max-height`. `box-sizing: border-box`. Files: `web-demo/css/app.css`.
- **DEVIATION — three source bugs not reproduced.** (1) `initial_fen` is never sent on save
  (`handleSave`, board.tsx:1026-1043) and its `generatePgn()` emits no `[FEN]` header, so a
  custom-setup game does not survive a save/load round trip there; ours persists it, and our
  `PGN.serialize` emits `[SetUp]`/`[FEN]` besides. (2) `@biyaherong_openfile_draft` is written at
  :840 and **never read anywhere**, so unsaved edits to an opened game are silently lost; ours reads
  it back. (3) The save modal has **no Title field** even though the column is NOT NULL and the
  library lists the title — ours has one.
- **DEVIATION — no free-session cap.** The server allows 3 for non-premium; offline there are no
  accounts. Also no `share_token` / `is_shared` (nothing to share through), and **no
  `move_annotations`**: the server needs that column because its client serialises movetext only,
  while ours emits NAG suffixes inline, so it would be a second copy of what the PGN already carries.
- **DEVIATION — search lives in the library sheet.** The original has it only on the sibling
  `saved.tsx` browser; this rebuild has one screen.
- **Docs** — CHANGELOG, `docs/analysis-board.md`, `PORTING_NOTES.md`, `docs/web-demo.md`,
  `web-demo/README.md`.

**Verified here:** JS gate **17,995 assertions across 18 suites**, green; 60 Swift files structurally
sound. In Chrome, end to end: save a game with players, event, ECO and a folder → it appears in the
library with the right headline, meta line and PGN preview → reopening it replaces a diverged board
with the saved 4-ply game → deleting a folder leaves its game **Unfiled rather than deleted** →
default folders refuse both rename and delete → search matches players and reports a miss → a draft
is written after the debounce, **restores silently** on re-entry, and after 24 simulated hours
restores nothing and is pruned. Play and Puzzles remain untouched, and the seven bands still sum
exactly to the viewport.

**The Swift is still uncompiled.** Most likely first-compile snags: `UnevenRoundedRectangle` in
`AnalysisBottomSheet` (iOS 16.4+/macOS 13.3+, so within the package's floor but new to this module),
the `@Binding var filter: AnalysisStore.Filter` with its associated value, and `PGN.Game`'s new
public init shadowing the synthesized memberwise one.

### 2026-08-10 (phase 9) — game review

- **Added** — **`ReviewAnnotator.Evaluator`** and its JS twins `BiyaReview.reviewSteps` /
  `reviewProgressive`: evaluate a game **one position per call**. `evaluate(_:engine:limits:)` is
  untouched — it is right for a headless harness and wrong for a UI, because a 40-move game costs
  **28 s at a fixed depth 3**. Stepping lets the caller give each position its own wall-clock budget
  and yield between them, so the screen paints and Cancel lands at once. A cancelled walk leaves the
  evaluations **short**, and `isComplete` is the guard that stops a caller mistaking that for a
  truncated game. Files: `Sources/BiyaherongCoachCore/ReviewAnnotator.swift`, `web-demo/js/review.js`.
  _(web-demo: mirrored.)_
- **Added** — **`BiyaReview.plan(tree)`**, the JS twin of `ReviewAnnotator.plan`. It existed only
  inlined inside `tools/qa/review_demo.js:52-84`; moving it makes the file the true twin of
  `ReviewAnnotator.swift`, which `docs/web-demo.md` already claimed it was. Verified by the demo
  still printing **exactly** its recorded numbers after the refactor: B90 Najdorf English Attack,
  11 book plies, White 93.1% / Black 83.4%. Files: `web-demo/js/review.js`.
- **Added** — review state in the session layer of both languages: `applyReview`,
  `classification(forNodeID:)`, `reviewSummary`, and a `classification` field on `StripToken`.
  **The index rule is the whole risk**: `moveIndex` is 1-based (0 is the starting position) while
  the plan's nodes are 0-based, so the node is `nodes[moveIndex - 1]` — the same `- 1` the RN source
  does at `applyClassificationsToTree:1827`. Asserted with a hand-built result rather than an
  engine's, so the mapping is proved independently of what any search returns. Files:
  `Sources/BiyaherongCoachCore/AnalysisSession.swift`, `web-demo/js/analysis.js`.
- **Added** — the **accuracy modal** in both languages: accuracy pair with its colour band, the eval
  graph, and the classification count table with all-zero tiers dropped. Plus the 🔬 toolbar action
  and per-move classification symbols in the move strip. Files:
  `DemoApp/Sources/BiyaherongUI/AnalysisReviewModal.swift`, `AnalysisVM.swift`,
  `AnalysisBoardScreen.swift`, `web-demo/js/analysis.js`, `web-demo/css/app.css`.
  _(web-demo: this is the visible half.)_
- **Added** — `ParityRunner`'s `analysis_session` group grew to **137 assertions** (floor 80 → 125),
  covering the review mapping, the summary's row ordering and zero-dropping, and the Evaluator's
  short-run guard. Files: `Sources/ParityRunner/main.swift`.
- **Added** — **`_deviceDerived` in the style extractor.** Anything the RN source computed from
  `Dimensions.get()` is folded against a 390×844 reference before it reaches `board_styles.json`, so
  `screenHeight * 0.80` arrives as the literal `675.2` — correct on one phone and wrong on every
  other, with nothing downstream to notice. The extractor now flags every value that is a tidy
  multiple of the reference, and found **three**: the accuracy card's `maxHeight` (H×0.8), and — for
  later phases — `menuContainer.width` (W×0.65) and `sidebarStyles.container.width` (W×0.68). The
  metrics layers encode the **ratio**, asserted by reproducing the literal. Files:
  `tools/metrics/extract_board_styles.js`, `tools/metrics/board_styles.json`.
- **Added** — the extractor now also scans **`components/EvalGraph.tsx`**. Its colours live in JSX
  attributes rather than a StyleSheet, so the AST walk never saw them — and a mutation test proved
  it: changing the graph's background to the wrapper's colour survived every assertion. The graph
  paints `#1A2740` *inside* a wrapper already painted `#0F1A2E`, and conflating them is exactly the
  silent-wrong-shade bug the extraction exists to prevent. Now re-derived and pinned.
  Files: `tools/metrics/extract_board_styles.js`, `web-demo/js/analysis-metrics.js`.
- **Changed** — the review is bounded by a **200 ms per-position deadline**, not a depth cap, for the
  same reason the live board rejected one. Measured on a 40-move game: fixed depth 3 = 28 s; with a
  deadline, 100 ms → 5.0 s (mostly d2), **200 ms → 9 s (d2–d3)**, 400 ms → 17.4 s (mostly d3). In the
  browser the stepper runs 207–232 ms per position — on budget. That puts a 40-move game at ~18 s,
  inside the original's own "This may take 20–30 seconds" promise, but now with a **real progress
  bar** instead of a static string. Recorded as an invented constant.
- **Fixed** — the header title was encoded as **20**; the board's own `styles` block says **16**.
  `sidebarStyles` declares its own `headerTitle` and a merged lookup had let it shadow. Caught by
  the source assertion, which now pins every typography key to the `styles` block specifically.
- **DEVIATION** — **one review action does both halves.** The original splits it:
  `runAccuracyAnalysis:2254` shows the modal but *discards* `move_evaluations`, so the strip stays
  blank; `handleAnalyzeGame:1854` stamps the strip but shows only an `Alert` — no modal, no graph,
  and no cancel at all. Same data, two incomplete paths. Ours shows the modal **and** stamps the
  strip, from one run.
- **DEVIATION** — **no classification badge on the board.** Reading the source corrected an earlier
  assumption in the plan: `renderAnnotationOverlay:2661` draws the *manual* PGN glyph for the
  selected move and never consults `reviewClassification`. Classifications appear only in the move
  strip. `AnalysisBadge` therefore stays unused until Phase 11 wires it to the annotation picker it
  was written for.
- **DEVIATION** — the modal's third state is **"Not enough moves"**, not the source's "Analysis
  unavailable": offline, the engine cannot be unreachable, so the 429/503/network branches have no
  counterpart. Skip simply dismisses, as the original's does.
- **Changed** — `GameReview.Evaluation` gained `Sendable`. A three-field value type of `Int?`/
  `String?`; the conformance is behaviour-free and no golden is affected, and it is what lets a
  review run off the main actor. Public structs do not get it implicitly, which is why it is spelled
  out. Files: `Sources/BiyaherongCoachCore/GameReview.swift`.

**Verified here:** JS gate **17,833 assertions across 16 suites**, green; 57 Swift files structurally
sound; `review_demo.js` prints its recorded numbers unchanged. In Chrome, end to end: 🔬 opens the
modal with a progress bar that advances position by position; **Skip cancels mid-review and stamps
nothing**; on completion the accuracies show in the right colour band, the graph draws one point per
position, the table lists only non-zero tiers **including Book** — the row the source's
`CLASSIFICATION_ORDER` omission could never display — and the strip carries per-move symbols that
survive navigation. Play and Puzzles remain untouched.

**The Swift is still uncompiled.** Most likely first-compile snags: the nested `Task { @MainActor }`
progress hop inside `Task.detached` in `AnalysisVM.startReview`, and `Evaluator`'s `Sendable`
conformance now that it holds `[ChessPosition]` rather than a `Plan` (it was changed precisely
because `Plan` carries `[MoveNode]`, which is not `Sendable`).

### 2026-08-10 (phase 8) — the Analysis Board becomes a screen

- **Fixed** — **`PGN.tokenize` could never have compiled.** It was `public` while its result type
  `PGN.Token` is internal (`PGN.swift:64` / `:171`), which Swift rejects outright — and there is no
  `.build` directory, so **the Core module had never been compiled and every phase since 2 was
  stacked behind this one error**. `tokenize` is now internal; nothing outside the module calls it
  (`ParityRunner` uses `mainlineTokens`, which returns `[String]`). Files:
  `Sources/BiyaherongCoachCore/PGN.swift`.
- **Added** — an **access-level pass in `tools/qa/swift_lint.js`**: it collects each type's declared
  access per module and flags any `public`/`open` signature naming an internal type. A bracket
  matcher cannot see this class of error, and it is precisely what a module written without a
  compiler accumulates. Verified against the real bug plus two synthetic positives and three
  negatives. Files: `tools/qa/swift_lint.js`. _(web-demo: n/a.)_
- **Added** — **`Sources/BiyaherongCoachCore/AnalysisSession.swift`**, the screen's behaviour with no
  screen attached: `statusText`, `openingEntry`, `arrows`, `engineRows`, `evalParts`, `isStale`,
  `wantsAnalysis`, `stripTokens`, and the navigation semantics. **This is the phase's main design
  decision.** The plan called phase 8 "browser only"; extracting the state machine into Core instead
  makes the behaviour assertable by ParityRunner *and* Node, leaving only SwiftUI's rendering
  unverifiable. `AnalysisVM` and `analysis.js`'s view half are thin shells over it.
  Files: `Sources/BiyaherongCoachCore/AnalysisSession.swift`. _(web-demo: mirrored in `analysis.js`.)_
- **Added** — `ParityRunner` group **`analysis_session`** (95 assertions, floor 80), hand-authored on
  both sides like `draw_rules` — there is no PHP oracle for a screen, so the expectations are derived
  from the RN source's line numbers. Files: `Sources/ParityRunner/main.swift`.
- **Added** — **`web-demo/js/analysis.js`** (global `BiyaAnalysisBoard`; `BiyaAnalysis` is the search
  engine): the pure session layer with a **91-assertion** self-test, plus the seven-band screen.
  Reachable from the Home tile, which was a **complete no-op** until now. Files:
  `web-demo/js/analysis.js`, `web-demo/js/app.js`, `web-demo/index.html`, `web-demo/css/app.css`.
  _(web-demo: this is the change.)_
- **Added** — the **SwiftUI screen**: `AnalysisBoardScreen` (seven bands + the branch picker),
  `AnalysisVM`, `CancelToken` (`NSLock`-guarded, `@unchecked Sendable` — Core has no concurrency by
  design and `AnalysisEngine.swift:9-13` says the wrapper belongs here), and `OpeningBookLoader`.
  Routed from `PhoneView` as a **`ZStack` sibling**, not `.fullScreenCover`: that API does not exist
  on macOS and this view renders inside the macOS demo, so using it would have broken the very
  `swift build` this phase is verified by. Files: `DemoApp/Sources/BiyaherongUI/AnalysisBoardScreen.swift`,
  `AnalysisVM.swift`, `CancelToken.swift`, `OpeningBookLoader.swift`, `PhoneView.swift`.
- **Added** — **`BiyaAnalysis.analyzeSteps` / `analyzeProgressive`**: iterative deepening one depth
  per macrotask, so lines appear as they are found and a cancel lands immediately instead of after
  the whole search. `analyzeAsync` yielded **once** and then blocked for the entire search. The
  synchronous `analyzeSteps` core is what keeps a Promise-shaped API inside the assertions (the
  engine suite grew 44 → 55). Implemented by re-running the pinned `analyze` at increasing depth
  caps rather than restructuring its loop. Files: `web-demo/js/analysis-engine.js`.
- **Added** — **`AnalysisType`** (typography) and token/chip/engine-row geometry in both metrics
  layers, every value asserted against `board_styles.json`. That immediately caught a real error:
  the header title is **16**, not the 20 I had transcribed — `sidebarStyles` declares its own
  `headerTitle` and my merged lookup had let it shadow the board's. Exactly the failure mode the
  extraction exists to prevent. Files: `DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift`,
  `AnalysisMetricsCheck.swift`, `web-demo/js/analysis-metrics.js`.
- **Changed** — the engine is bounded by a **wall-clock deadline (1200 ms), not a depth cap.**
  Measured: cost is ~6× per ply and varies **15× by position type** (endgame d4 = 173 ms, midgame
  d4 = 2794 ms), so any fixed depth is either too slow somewhere or too shallow everywhere. A
  deadline reaches depth 4+ in quiet positions, stops at 3 in sharp ones, and bounds total wall time
  to within ~15 ms of the budget. Recorded as an invented constant.
- **Fixed** — a cut-short sub-search returned the previous snapshot, so `analyzeProgressive` fired
  `onDepth` twice with identical content and the panel repainted for nothing. `analyzeSteps` now
  finishes when `snap.depth < depth`, and the driver only reports a snapshot that actually changed.
  Files: `web-demo/js/analysis-engine.js`.
- **DEVIATION** — a position change **during** a search now cancels and restarts. The original
  guarded with `if (isAnalyzing || fen === lastAnalyzedFen) return;` (`board.tsx:885`); because its
  fetch could not be cancelled, moving mid-request silently dropped the new position and the panel
  showed stale lines forever. Verified in Chrome: after moving mid-search the engine catches up and
  every arrow is legal in the *new* position.
- **DEVIATION** — two status-line corrections, both recorded in `PORTING_NOTES.md`: the move number
  now comes from the position's `fullmove` (the original showed the move just played, so after
  1.e4 e5 it read "1." when the next move is 2), and "(analyzing)" tracks a real in-flight search
  rather than the auto-analyse toggle.
- **Docs** — `docs/analysis-board.md` rewritten (the screen moved from *Not yet* to *Built*),
  `docs/web-demo.md` and `web-demo/README.md` updated, `PORTING_NOTES.md` gains the deviations and
  the new invented constants.

**Verified here:** JS gate **17,684 assertions across 16 suites**, green. 56 Swift files structurally
sound, including the new access-level check. In Chrome, end to end: the Home tile opens the screen
and covers the tab bar; tap **and** drag play moves; branching produces inline chips and switching
lines works; `⏮ ◀ ▶ ⏭` navigate and a two-child forward offers the picker; the engine panel fills
progressively with three ranked lines and matching arrows; the ECO panel lists continuations and the
info row names the opening (including *after* leaving the book); autoplay runs and stops; back
restores the tab bar; **Play and Puzzles are untouched** (drag off, no arrows,
`touch-action: manipulation`, tap-to-move working). Band heights sum to exactly the viewport, and
`bandLayout` predicted the board edge to within half a point of what CSS produced.

**The Swift is still uncompiled** — `swift` is not on PATH here. Most likely first-compile snags, in
order: the `Task.detached` + `MainActor.run` capture shape in `AnalysisVM.runAnalysis`; `Sendable`
inference on `CancelToken` under Swift 6 strict concurrency; and `@Published` on the
`(from: Int, to: Int)?` tuple (`ChessGameVM` already does this, so it should hold).

### 2026-08-10 (phase 7) — board upgrades: arrows and drag, in both languages

- **Added** — **`web-demo/js/chess-board.js` gains an SVG arrow overlay and pointer-drag**, both **off by
  default** so Play and Puzzles are untouched. `.arrows = [{from, to, rank}]` draws into an
  `<svg viewBox="0 0 8 8">` — one unit per square, so the geometry needs no `getBoundingClientRect`, survives
  resize and container queries, and is redrawn from `_layoutCells()` on flip. `draggable-pieces` adds drag
  **alongside** tap-to-move, funnelled through the existing `_commit` / `_askPromotion`, so the `move` event
  is identical either way and `onGameMove` / `onPuzzleMove` in `app.js` needed no changes at all.
  Files: `web-demo/js/chess-board.js`. _(web-demo: this is the change.)_
- **Added** — **`DemoApp/Sources/BiyaherongUI/BoardArrows.swift`** and three defaulted stored properties on
  `BoardView` (`style`, `customHighlights`, `onDragMove`), appended **after** `onTap` so all four existing
  call sites — which pass every argument by label — keep compiling. `BoardStyle` carries a **fill mode**, not
  just colours: the spec's highlights *replace* the square fill while today's board *overlays* translucent
  rectangles, which is a structural difference rather than a palette swap. Its defaults reproduce today's
  exact inline values, so Play and Puzzles render identically. Arrows are composed as an `.overlay` at the
  call site, matching how `PromotionOverlay` is already applied, which keeps the shared `BoardView` free of
  anything analysis-specific. Files: `DemoApp/Sources/BiyaherongUI/BoardArrows.swift`,
  `DemoApp/Sources/BiyaherongUI/PlayView.swift`, `DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift`.
  _(web-demo: mirrored — see above.)_
- **Added** — **`tools/qa/board_component_test.js`** (103 assertions), wired into `js_goldens.js`. It runs
  `chess-board.js` in a `vm` context with a purpose-built fake DOM, so requiring it never touches the host's
  globals. The assertions that earn their keep: a **full tap-to-move round trip with drag enabled** (the
  regression that would break Play and Puzzles, not just analysis), and a cross-check of every rendered arrow
  coordinate against `analysis-metrics.js` — an independently written implementation of the same geometry.
  Verified non-vacuous by mutation: 11 hand-made mutants, 11 killed. Files:
  `tools/qa/board_component_test.js`, `tools/qa/js_goldens.js`. _(web-demo: n/a — a harness over it.)_
- **Added** — a **real-browser** overlay check in `?selftest`: it mounts a throwaway `<chess-board>` and uses
  `elementFromPoint` through the Shadow DOM to ask whether the arrow overlay is stealing the tap target. That
  is the one question no headless harness can answer, and the reason the fake-DOM suite is not the whole
  story. Files: `web-demo/js/app.js`. _(web-demo: this is the change.)_
- **Added** — **`tools/qa/swift_lint.js`**, promoted into the repo from a throwaway script that had been
  re-created in scratch every phase. `node tools/qa/swift_lint.js` strips comments, strings and `\( … )`
  interpolation, then matches brackets across **all 51** `.swift` files — the specific damage that writing
  Swift blind actually produces. Files: `tools/qa/swift_lint.js`. _(web-demo: n/a.)_
- **Fixed** — `BoardView` installed its drag gesture **unconditionally**, contradicting its own doc comment
  and adding a recogniser to Play and Puzzles for no reason. Now masked with
  `.gesture(dragGesture, including: onDragMove == nil ? .subviews : .all)`, which disables the parent gesture
  while leaving the cells' `.onTapGesture` alone. A plain `if` cannot express this — it would change the
  body's return type. Files: `DemoApp/Sources/BiyaherongUI/PlayView.swift`.
- **Fixed** — the first draft of the browser overlay check mounted its probe board at `left:-9999px`, where
  `elementFromPoint` returns `null` **outside the viewport** — every assertion below it would have been
  vacuous. Caught by running it in Chrome, not by reading it. Files: `web-demo/js/app.js`.
- **Fixed** — a `_suppressClick` assertion in the board suite was vacuous for the same class of reason: the
  fake rules adapter gave the drop square no legal moves, so the trailing click was a no-op either way and the
  mutant survived. Rewritten with a movable drop square, which is what analysis mode actually looks like.
  Files: `tools/qa/board_component_test.js`.
- **Changed** — `BoardStyle` gained `dotSize(square:)` so `cell(_:)` no longer multiplies in a view body,
  matching the `AnalysisIndicator.ringSize(square:)` call two lines above it. The house rule — no numeric
  literal or arithmetic in any view body — is the only reason the layout is assertable without a renderer.
  Files: `DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift`, `.../AnalysisMetricsCheck.swift`,
  `.../PlayView.swift`.
- **Docs** — new [`docs/analysis-board.md`](docs/analysis-board.md) (with an explicit built / not-yet table,
  since the screen itself does not exist yet), a row in `docs/README.md`, and the arrow/drag API in
  `docs/web-demo.md` + `web-demo/README.md`.

**Verified here:** JS gate **17,553 assertions across 15 suites**, green. All 51 Swift files structurally
sound. In Chrome, on the live demo: tap-to-move plays `1.e4 d5`; a real pointer-drag plays `g1f3` and the AI
answers; all three arrow ranks render in the right colours with the best line on top; Puzzles still has drag
off, no arrows, `touch-action:manipulation`, and working tap-to-move. **The Swift is still uncompiled** —
`swift` is not on PATH on this checkout.

### 2026-08-10 (phase 6) — the metrics layer, extracted rather than transcribed

- **Added** — **`tools/metrics/extract_board_styles.js`** and the **committed**
  **`tools/metrics/board_styles.json`**: a TypeScript AST walk over the sibling repo's 6,865-line
  `board.tsx`, using the `typescript@5.9.3` already in its `node_modules`. It pre-seeds the six module
  constants, folds arithmetic, expands `...StyleSheet.absoluteFillObject` and resolves `Platform.OS`, so all
  7 `StyleSheet.create` blocks — **328 keys, 1,355 property values — resolve with zero unknowns**. Committed
  rather than gitignored because it derives from a repo the reader may not have, the same reasoning that
  commits `eco.tsv`. Files: `tools/metrics/extract_board_styles.js`, `tools/metrics/board_styles.json`.
  _(web-demo: n/a — a build-time tool.)_
- **Added** — **`DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift`** and its twin
  **`web-demo/js/analysis-metrics.js`**: board geometry, the seven bands, palette, board themes, indicator
  and arrow and badge geometry, the eval bar and graph, the classification / annotation / eval-symbol /
  autoplay tables, and the timings. Band heights are **(fixed, flexible) pairs, not seven literals** —
  seven fixed heights overflow a 375×667 SE, so the panels band flexes from its 230 max and the board band
  absorbs the slack; that they sum to the viewport at 375×667, 390×844 and 430×932 is an assertion.
  Files: `DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift`, `web-demo/js/analysis-metrics.js`.
  _(web-demo: mirrored — that is the point of the file.)_
- **Added** — **`AnalysisMetricsCheck`**, a fourth `.executableTarget`
  (`cd DemoApp && swift run AnalysisMetricsCheck`). **Both** it and the JS suite assert their constants
  against `board_styles.json`, so the shared oracle *is* the twin mechanism — strictly better than diffing
  two hand-typed copies, because it catches transcription errors from the source itself. Files:
  `DemoApp/Sources/BiyaherongUI/AnalysisMetricsCheck.swift`, `DemoApp/Sources/AnalysisMetricsCheck/main.swift`,
  `DemoApp/Package.swift`. _(web-demo: the JS half runs in `js_goldens.js` and in `?selftest`.)_
- **Why extract at all:** the written spec says "eval bar height 3". The source has **two** eval bars —
  `evalBarTrack.height = 8` under the board and `engineEvalBarTrack.height = 3` per engine line. Hand
  transcription would have sized the main bar wrong with nothing downstream to catch it — the same class of
  error as the four wrong mate expectations in phase 4.

### 2026-08-10 (phase 5)

- **Added** — **`web-demo/js/review.js`**, a port of `GameReview.swift`, closing the web-demo's biggest
  remaining gap: it had **no** classification or accuracy code at all, only `evalToWinPct`. Validated against
  the PHP oracle's own vectors and producing **exactly 47 and 6,114 assertions over 303 cases** — the same
  counts as the Swift `game_review` / `game_review_random` floors, which is the cheapest possible proof the
  two languages assert identically. Files: `web-demo/js/review.js`. _(web-demo: this is the change.)_
- **Added** — **`web-demo/js/opening-book.js`** and **`Sources/BiyaherongCoachCore/OpeningBook.swift`**:
  `entry`, `contains`, `named`, `nameFor`, `continuations`, `bookPlies`, `bookPrefixLength` over the bundled
  7,854-row book. A **named** row changes the displayed opening; a **pass-through** row is in book but keeps
  the previous name, so a position twenty moves into the Najdorf still reads "Najdorf". Both count as in-book,
  which is what makes the `book` tier fire across a whole opening rather than at the handful of positions an
  ECO line happens to end on. Files: `web-demo/js/opening-book.js`,
  `Sources/BiyaherongCoachCore/OpeningBook.swift`. _(web-demo: mirrored.)_
- **Added** — **`Sources/BiyaherongCoachCore/ReviewAnnotator.swift`**: `plan(_:)` turns a `MoveTree` into the
  review's parallel arrays, `evaluate(...)` drives any `AnalysisEngine` over them with progress and
  cancellation, and `annotate(...)` applies the **`book` tier as a post-layer**. `GameReview.swift` is
  untouched and still produces exactly nine keys; the annotator relabels in-book plies and recomputes the two
  count dictionaries with a tenth. **Accuracy is never recomputed** — book moves still count toward it, per
  the locked parity decision. `displayOrder` puts `book` after `great`, fixing the original's
  `CLASSIFICATION_ORDER`, which omitted it entirely so book moves were counted and then never shown. Files:
  `Sources/BiyaherongCoachCore/ReviewAnnotator.swift`. _(web-demo: `annotate` mirrored in `review.js`.)_
- **Added** — **`tools/qa/review_demo.js`**, the phase's exit criterion as a runnable artifact rather than a
  claim. `node tools/qa/review_demo.js` plays a Najdorf out to 40 moves, evaluates all 81 positions offline,
  and prints the opening, the book prefix, both accuracies and all ten classification counts. Real output:
  **B90 Sicilian Defense: Najdorf Variation, English Attack**, 11 plies in book, White 93.1% / Black 83.4%,
  81 positions in 34.6 s at depth 3. Files: `tools/qa/review_demo.js`. _(web-demo: n/a — a demo over its
  sources.)_
- **Added** — `ParityRunner` groups `eco` (floor 1200) and `review_book` (floor 1500), plus a `loadText`
  helper; `build_eco.php` now also copies the shipped book to `Goldens/eco_book.tsv` so the group exercises
  the **real** `OpeningBook(tsv:)` parser against the **real** 7,854-row file rather than a toy string. The
  `build_eco.php` docstring had claimed a ParityRunner `eco` group since phase 0; there had never been one.
  Files: `Sources/ParityRunner/main.swift`, `tools/eco/build_eco.php`. _(web-demo: n/a.)_
- **Fixed** — `Rating.evalToWinPct` took **no colour** and implemented only the `color == "w"` branch, because
  its one caller (`app.js:349`) flips the sign itself. Reusing it for the review would have got **Black's
  accuracy wrong on every case**. Widened to `evalToWinPct(evalCp, color)` with `color` defaulting to `'w'`,
  so `app.js` is unaffected. `rating.js` also gained the `module.exports` branch — the third file to need it,
  after `engine.js` (phase 1) and `ai.js` (phase 4). Files: `web-demo/js/rating.js`.
  _(web-demo: this is the change.)_

- **Note — the traps this port had to reproduce.** All three would have passed almost every random case and
  failed only a hand-written one:
  1. **PHP falsiness.** `""` *and* `"0"` are falsy in PHP; in JS `Boolean("0")` is `true`. Golden case 2 of
     `game_review.json` plays SAN `"0"` precisely to catch a naive `if (san)`.
  2. **Rounding.** PHP `round($x, 1)` is half-away-from-zero. `Math.round(-2.5)` is `-2` where PHP gives `-3`.
  3. **Win-percentage sign** — the `evalToWinPct` bug above.

- **Note — verification.** The JS is proven: **17,323 assertions across 12 suites**, up from 11,079, plus the
  browser-mode load check. The Swift remains **unverified by compilation**, with the same mitigations: all 21
  hand-authored Phase 5 expectations replayed through the JS and confirmed, and all nine Swift files pass the
  bracket/smell lint. One compile error *was* caught this way before shipping — `GameReview.emptyClassifications`
  is `internal`, so `ParityRunner` (a separate module) cannot see it; the assertions now read the base result's
  own keys instead. Hand-off instructions are unchanged; expect roughly **42,400 assertions across 39 groups**.

### 2026-08-10 (phases 3 & 4)

- **Added** — **the Swift move tree and PGN layer** (phase 3): `MoveTree.swift` (`MoveNode` with a weak
  parent and `children[0]` as the main line, `MoveTree` with add/navigate/promote/delete/paths, and the pure
  `flatten() -> [TreeRow]`) and `PGN.swift` (parse, serialize, `splitGames`, `mainlineTokens`). Direct
  transliterations of the JavaScript proven in phase 1. `flatten()` is the payoff: PGN move numbering — `1.`
  vs `1...`, including the ellipsis an interposed variation forces — lives in one pure function rather than a
  view, so it can be asserted without a renderer and compared to JS row for row. **No regex**, continuing the
  phase-2 rule; the tag pattern's greedy `.*` is reproduced by taking the value between the *first* and
  *last* quote of the bracketed line. Files: `Sources/BiyaherongCoachCore/{MoveTree,PGN}.swift`.
  _(web-demo: n/a — the JS twin shipped in phase 1.)_
- **Added** — **`web-demo/js/analysis-engine.js`** (phase 4), written and proven **before** any Swift
  existed: iterative deepening, alpha-beta with a triangular PV table, quiescence, MultiPV, White-relative
  scores, terminal short-circuit, cancellation and progress callbacks. **44 assertions, green, in 1.2 s.**
  This is not the coach AI — `ChessAI.bestMove` plays a persona at fixed shallow depth with deliberate
  blunders and noise, is parity-pinned, and is untouched. Files: `web-demo/js/analysis-engine.js`.
  _(web-demo: this is the change — it also closes a standing gap, since the AI layer had no self-test at all.)_
- **Added** — **`AnalysisEngine.swift` + `LocalEngine.swift`**, the transliteration. `EngineScore` is
  `.cp` / `.mate` / `.terminal`, always White-relative, with `asReviewEvaluation` routing a terminal mate
  through `evalCp: ±10000` so the server's `evalMate: 0` bug can never be reproduced — asserted by name.
  Files: `Sources/BiyaherongCoachCore/{AnalysisEngine,LocalEngine}.swift`. _(web-demo: mirrored above.)_
- **Added** — five `ParityRunner` groups (`movetree`, `pgn_tokens`, `pgn_split`, `pgn_roundtrip`, `search`)
  with floors 35 / 180 / 35 / 35 / 45. `pgn_tokens` and `pgn_split` consume the **oracle-derived** goldens
  generated back in phase 0, so they are real verification rather than self-agreement. Files:
  `Sources/ParityRunner/main.swift`. _(web-demo: n/a.)_
- **Changed** — the PGN serializer now hugs parentheses: `(1... c5 2. Nf3)`, not `( 1... c5 2. Nf3 )`. Found
  by deriving the expected canonical output rather than assuming it. It always round-tripped, which is
  exactly why the fixpoint test had not caught it. Files: `web-demo/js/pgn.js`,
  `Sources/BiyaherongCoachCore/PGN.swift`. _(web-demo: this is the change.)_
- **Changed** — `web-demo/js/ai.js` gained the `module.exports` branch and the
  `isNode ? require('./engine.js')` pattern its siblings already use. It captured `global.Engine` at load
  time, so under Node it silently depended on require order; it also never exported `WIN`. Files:
  `web-demo/js/ai.js`. _(web-demo: this is the change.)_

- **Note — decisions that departed from the plan, and why.** Three, all driven by reading the source rather
  than by preference:
  1. **The engine API is synchronous.** Core contains no other concurrency, the package builds in Swift 6
     language mode with *complete* strict concurrency (a stray `static var` is a compile error), and
     `ParityRunner` is synchronous top-level code — so a synchronous engine is the one that can actually be
     asserted. Cancellation and progress are closures, following `PuzzleServing.Picker`. An `actor` wrapper
     is ~30 lines and belongs in the UI phase, on a machine with a compiler.
  2. **MultiPV needs no root exclusion.** `ChessAI.bestMove` already searches every root move with a fresh
     full window and no alpha propagation, so each gets an *exact* score rather than a bound; keeping that
     shape yields all k lines from one pass. Only root-level cutoffs are forfeited.
  3. **No Web Worker.** On `file://` a document has an opaque origin, so Chrome throws at construction and
     the blob-URL workaround inherits the same origin. `docs/web-demo.md:58-59` already states the contract:
     the AI runs on the main thread.
  Also dropped: the transposition table, killers and history. Performance, not correctness — and on code
  that cannot be compiled or profiled here, the simplest correct search is the better trade.

- **Note — what was verified.** The JS is genuinely proven: **11,079 assertions across 8 suites**, plus a
  browser-mode load check that evaluates every script in `index.html` order in a `window`-only sandbox with
  no `module`. The Swift is again **unverified by compilation**, with the same two mitigations as phase 2:
  all **38 hand-authored Swift table expectations were replayed through the JS and confirmed**, and all seven
  Swift files pass the bracket/smell lint. Mate expectations specifically were derived from an *independent
  brute-force checker*, not from this search — guessing them by eye produced four wrong entries on the first
  attempt, which is precisely the failure that discipline exists to catch. Hand-off instructions are
  unchanged from the phase-2 entry below; expect roughly **40,000 assertions across 36 groups**.

### 2026-08-10 (latest)

- **Added** — **the Swift notation core**, phase 2 of the offline **Analysis Board**:
  `Sources/BiyaherongCoachCore/ChessNotation.swift` (`normalizedSAN`, `move(forSAN:)`,
  `move(forUCI:)`) and `ChessRules.swift` (`positionKey`, `hasInsufficientMaterial`,
  `isFiftyMoveDraw`, `drawReason(historyKeys:)`, `terminalOutcome(historyKeys:)`, the `ChessRules`
  repetition helpers, and the public `TerminalKind` / `TerminalReason` / `TerminalOutcome` types).
  Both are transliterations of the JavaScript proven in phase 1, not fresh designs. `ChessBoard.swift`
  is untouched. Files: `Sources/BiyaherongCoachCore/{ChessNotation,ChessRules}.swift`.
  _(web-demo: n/a — the JS twin shipped in the previous entry.)_
- **Added** — three `ParityRunner` groups after `chess_ai`, with floors `san_parse: 9000`,
  `notation_extra: 30`, `draw_rules: 30`. `san_parse` finally consumes the 3,105-case golden the
  oracle has been emitting since phase 0 — three assertions each (parsed UCI, all six FEN fields,
  and the position key), so **`ChessPosition.san(for:)` gets its first parity coverage** and the
  Swift position key is pinned to the PHP oracle. The other two are hardcoded tables following the
  `perft` / `chess_ai` precedent, because `App\Services\ChessEngine` explicitly skips
  check/stalemate/fifty-move/repetition and there is nothing on the server to oracle against.
  Files: `Sources/ParityRunner/main.swift`. _(web-demo: n/a.)_
- **Changed** — a phase-1 assertion of mine was passing for the wrong reason: `parseSan(start, 'Nd2')`
  was labelled "rejects an ambiguous move", but from the start position `Nd2` is merely **illegal**
  (d2 is occupied). It now uses a two-knight position where the move is genuinely ambiguous, and
  gains the two positive cases that prove the ambiguity is resolvable (`Nbd2` / `Nfd2`). Files:
  `web-demo/js/engine.js`. _(web-demo: this is the change — the gate is now 11,035 assertions.)_

- **Note — what was and was not verified.** The Swift is **unverified by compilation**; `swift` is
  still not on PATH here. Two things were verified, and they are not nothing:
  1. All **58 hand-authored expectations** in the new `notation_extra` and `draw_rules` tables were
     replayed through the phase-1-proven JavaScript engine and confirmed correct. A wrong FEN or a
     wrong expected value would have surfaced here rather than on the teammate's machine.
  2. All three Swift files pass a bracket-balance and smell lint (comments and string literals with
     `\( )` interpolation stripped first).
  The residual risk is Swift-specific compile errors only.

- **Note — running the parity suite elsewhere.** `Goldens/` is **gitignored**, and `ParityRunner`
  calls `fatalError` when a golden is missing, so this looks like a code bug when it is really a
  missing-data problem. Copy the folder across (6.0 MB, 30 files) or regenerate it. The Parity Core
  is Foundation-only, so macOS, Linux and WSL all work.
  ```bash
  swift build                                # BiyaherongCoachCore + ParityRunner
  swift run ParityRunner                     # exit 0 = green; expects ./Goldens
  swift run ParityRunner /path/to/Goldens    # if the folder lives elsewhere
  tools/oracle/run.sh                        # only with PHP 8.3 + the Laravel sibling repo
  ```
  Expect the existing 28 groups unchanged plus `san_parse` 9,315, `notation_extra` ~35,
  `draw_rules` ~35 — roughly **39,700 assertions across 31 groups**.
  If the first compile does fail, the three likeliest causes, in order: `Character.asciiValue`
  optional handling in `looseMove`; `Sendable` on the new public enums under Swift 6 strict
  concurrency; and `Move` resolving to `GameReview.Move` rather than the chess `Move` if any new
  code is moved inside that namespace.

### 2026-08-10 (later)

- **Added** — **the JavaScript notation core**, phase 1 of the offline **Analysis Board**. `js/engine.js`
  gains nine exports: `parseSan`, `parseUci`, `positionKey`, `insufficientMaterial`, `isFiftyMove`,
  `repetitionCount`/`isThreefold`, `drawReason`, `terminalOutcome`, and `selfTest`/`selfTestGoldens` — plus
  the `module.exports` branch it never had, so it is requireable under Node like `home.js` is. **`parseSan`
  is two-tier**: an exact match against SAN produced by `san()` itself, which makes the inverse correct by
  construction so parse and generate can never drift, then a tolerant structural pass for the spellings real
  exporters emit but we never would (`Nbd2`, `N1d2`, `Nb1d2`, `Nb1-d2`, `ed5`, `e4xd5`, `a8Q`, `a8(Q)`). The
  second tier is not speculative: tier 1 alone was measured against those forms and misses every one of
  them. Files: `web-demo/js/engine.js`. _(web-demo: this is the change.)_
- **Added** — `web-demo/js/movetree.js` and `web-demo/js/pgn.js`. The tree is a node graph where
  `children[0]` IS the main line; replaying an existing move **navigates into it** instead of forking, which
  is the rule the board depends on. Its centrepiece is the pure `flatten()` — a flat array of plain value
  rows carrying depth, PGN move numbering (`1.` vs `1...`, including the ellipsis a variation forces),
  current/on-path flags — so tree semantics are asserted without a renderer and can be compared to Swift row
  for row. `pgn.js` reads tag pairs with `\"` escapes, `{block}` and `;line` comments, `%` escape lines, `$n`
  NAGs, the `!?` suffix forms, recursive variations (depth ≤ 20, ≤ 20,000 nodes), all four result tokens,
  `SetUp`/`FEN`, and multi-game files; it writes canonical PGN with the Seven Tag Roster in order and 80-column
  wrapping. A bad move does not discard the game — parsing stops and the **partial** tree is returned with the
  failing ply, so an import can report "34 of 41 moves". Null moves are rejected deliberately. Files:
  `web-demo/js/movetree.js`, `web-demo/js/pgn.js`. _(web-demo: this is the change.)_
- **Added** — `tools/qa/js_goldens.js`, the gate for the JavaScript half. It replays the PHP oracle's vectors
  against the same code the browser runs: **11,032 assertions across 7 suites**, all green — the three module
  self-tests (81 + 59 + 66), the full 3,105-case `san_parse` replay (9,315 assertions, each case checking the
  parsed UCI, all six FEN fields **and** the position key), the PGN tokeniser and splitter against
  `pgn_tokens`/`pgn_split`, and 1,290 ECO lookups and transpositions. This exists because `swift` is not on
  PATH here, so it — not ParityRunner — is what proves the notation layer before Swift transliterates it.
  Files: `tools/qa/js_goldens.js`. _(web-demo: n/a — QA tooling over the web-demo sources.)_
- **Changed** — the browser self-test (`index.html?selftest`) now runs the engine-notation, move-tree and PGN
  suites alongside perft and home, and asserts the ECO book actually reached the page — a missing `<script>`
  tag is otherwise silent. `index.html` loads `eco-data.js`, `movetree.js` and `pgn.js` before `app.js`;
  `eco-data.js` is eager despite being ~740 KB, because `fetch()` is blocked on `file://` and the demo's whole
  point is double-clicking the file. Verified by evaluating every script in `index.html` order inside a
  `window`-only sandbox with no `module`, confirming the browser branch resolves. The toast no longer calls
  every check a "perft check". Files: `web-demo/index.html`, `web-demo/js/app.js`.
  _(web-demo: this is the change.)_
- **Docs** — `docs/web-demo.md` and `web-demo/README.md` gained the new modules, the Node golden gate, and
  fixes for drift that predates this change: both described a **3-tab** shell when `app.js` has had four tabs
  since the home screen landed, and neither listed `js/home.js` (nor `js/device.js` in the README). Files:
  `docs/web-demo.md`, `web-demo/README.md`. _(web-demo: docs only.)_

- **Note** — this phase is **fully verified on Windows**, unusually: it is JavaScript, so `node
  tools/qa/js_goldens.js` really does execute every assertion. That is the point of doing the notation layer
  in JS first — phases 2–3 transliterate logic that has already been proven against the oracle, instead of
  writing Swift blind. No Swift was touched.

### 2026-08-10

- **Added** — **the chess oracle** (`tools/oracle/chess_oracle.php`), the foundation of the offline
  **Analysis Board** work. Unlike every other section of `generate_goldens.php` — which are standalone
  *extractions* of controller method bodies — this one loads the **real** `App\Services\ChessEngine` from the
  sibling Laravel repo. That class is framework-free (verified: it loads under PHP 8.3 with no bootstrap), so
  requiring the actual source is strictly more faithful than copying it, and it guarantees the SAN goldens and
  the ECO book are produced by the *same* parser. The PGN helpers beside it (`oracle_split_pgn_games`,
  `oracle_pgn_tokens`) are extractions from `PgnImportService`, which does depend on Laravel. A missing
  sibling repo is handled asymmetrically on purpose: `generate_goldens.php` warns and still emits every
  arithmetic golden, while `build_eco.php` hard-fails (exit 1) so `run.sh` aborts. Files:
  `tools/oracle/chess_oracle.php`, `tools/oracle/generate_goldens.php`, `tools/oracle/run.sh`.
  _(web-demo: n/a — build tooling.)_
- **Added** — the **`san_parse` golden group**: 3,105 cases / 9,315 assertions pinning SAN *parsing*, the
  inverse of `ChessBoard.san(for:)` and the single biggest gap in the Parity Core. Corpus A is a deterministic
  1-in-12 sample of the vendored ECO lines (3,057 plies of real curated master openings); corpus B is 48
  hand-built FEN-anchored cases for what openings never reach — promotion and underpromotion, capture-
  promotion, en passant for both colours and from the start position, all four castlings, castling rights lost
  to a rook *capture* vs a rook *move* vs a king move, file/rank/file-and-rank disambiguation, a pin that makes
  a pseudo-legally ambiguous knight move unambiguous, `+`/`#` suffix handling, and halfmove-clock reset. Each
  case carries `fenBefore`/`san`/`uci`/`fenAfter`/`key` and is worth three Swift assertions. The third is a
  *round-trip*, not string equality, because the oracle echoes its input SAN back (`'san' => $original`) and
  therefore cannot pin SAN generation. Files: `tools/oracle/generate_goldens.php`.
  _(web-demo: n/a — goldens are gitignored build products; `js/engine.js` consumes them in the next phase.)_
- **Added** — the **`pgn_tokens` + `pgn_split` golden groups**: 872 assertions over 91 tokeniser cases and 11
  file-split cases, pinning the strip pipeline (comments, nested and empty variations, NAGs, move numbers with
  and without spaces, all four result tokens) and header parsing (CRLF, multi-game files, missing blank line,
  empty tag values, `SetUp`/`FEN`). Documented oracle limit: `tokenizeMoves` **discards** `( … )` variations, so
  these pin the mainline only — RAV structure has no oracle and is covered by the round-trip property group
  instead. Files: `tools/oracle/generate_goldens.php`. _(web-demo: n/a.)_
- **Added** — the **bundled offline ECO opening book**, replacing the original app's Lichess masters explorer
  (`explorer.lichess.ovh`), which cannot exist offline. `tools/eco/build_eco.php` replays all 3,810 vendored
  `lichess-org/chess-openings` lines through the real `ChessEngine` — **every one replays cleanly** — and emits
  7,854 position-keyed rows: 3,810 *named* (a line ends there) and 4,044 *pass-through* (a line merely
  traverses it). Both count as "in book", which is what will make the `book` classification tier meaningful for
  the first time; only named rows change the displayed opening, and a miss keeps the last known name, so
  pass-through positions read correctly. Deepest line is 36 plies. Files: `tools/eco/build_eco.php`,
  `tools/eco/data/{a,b,c,d,e}.tsv`, `tools/eco/data/{COPYING.txt,SOURCE.md}`,
  `DemoApp/Sources/BiyaherongUI/ECO/eco.tsv`, `DemoApp/Package.swift`,
  `DemoApp/Sources/BiyaherongUI/Diagnostics.swift`. _(web-demo: mirrored — new `js/eco-data.js`, the same book
  as a JS global; the Opening Explorer panel that consumes it lands in a later phase.)_
- **Fixed** — **transposition lookup, before it shipped.** The position key was going to be
  `ChessEngine::fenNormalized()` (the plain 4-field FEN), and the first run proved that wrong: `1. e4 e5 2. Nf3`
  and `1. Nf3 e5 2. e4` hashed **differently**, because a double pawn push records an en-passant square even
  when no capture can use it. All three of the most common transpositions in chess failed. The key is now
  `oracle_position_key()` — the 4-field FEN with a **dead ep square cleared** — which is the standard EPD/X-FEN
  convention. 73 positions merged, all three transpositions now resolve, and live ep squares are still
  preserved (verified: `1. e4 c5 2. e5 d5` keeps `d6` because `exd6` is available). This also makes threefold
  repetition FIDE-correct rather than off by one occurrence. Files: `tools/oracle/chess_oracle.php`,
  `tools/eco/build_eco.php`. _(web-demo: `js/eco-data.js` regenerated with the corrected keys.)_

- **Note** — as with the home screen, the **Swift side of this phase is unverified by compilation**: `swift` is
  still not on PATH on this Windows checkout. Phase 0 is deliberately PHP-only for that reason — everything it
  produces (`php tools/oracle/generate_goldens.php`, `php tools/eco/build_eco.php`) runs and was verified here,
  and all six artifacts regenerate **byte-identically**. The only Swift touched is two lines: the `.copy("ECO")`
  resource entry and an `ECO/eco.tsv` presence check in `Diagnostics.swift`.

### 2026-08-06

- **Added** — the **home screen**, the app's landing dashboard, ported from the React Native app's
  `app/(app)/user/home.tsx` (its real StyleSheet numbers, not prose). A dark-navy, never-scrolling,
  single-viewport screen: header (avatar · logo · search), a 3×2 grid of six equal cards, an
  hourly-rotating Taglish quote, and Donate / Membership banners. Presentation only — no networking, no
  persistence, no navigation; every value is a view input and every tap a caller-supplied closure. Wired
  as **tab 0** of `PhoneApp`; only the three callbacks with a real destination today (Puzzles, Play,
  Profile) are connected, the other seven stay empty. Files: `DemoApp/Sources/BiyaherongUI/{HomeMetrics,
  HomeScreen,HomeParts,HomeArt,HomeMetricsCheck}.swift`, `DemoApp/Sources/HomeMetricsCheck/main.swift`,
  `DemoApp/Sources/BiyaherongUI/Images/`, `DemoApp/Package.swift`, `PhoneView.swift`, `Theme.swift`,
  `Diagnostics.swift`, `docs/home-screen.md`. _(web-demo: mirrored — new `js/home.js`, a `---- Home ----`
  section in `css/app.css`, the Colorful fills in `css/theme.css`, and Device / Home-theme / Membership
  pickers in the hero.)_
- **Added** — `HomeMetricsCheck`, a runnable self-check executable for the home screen's pure layer
  (responsive scale and every derived size, the tile identity behind the six equal cards, the fit clamps,
  the quote rotation, expiry formatting, the premium-outranks-colorful rule, and that the bundled art
  resolves). Follows the `PieceArtCheck` precedent since this toolchain has no XCTest. Its JS twin,
  `BiyaHome.selfTest()`, runs anywhere — **92 assertions, all passing** — and is folded into
  `web-demo/index.html?selftest`. This is only possible because no view body contains a numeric literal or
  arithmetic; every number is a pure function in `HomeMetrics.swift`. _(web-demo: `js/home.js`, `js/app.js`.)_
- **Added** — the six home art assets under `DemoApp/Sources/BiyaherongUI/Images/` (`.copy`, so every
  lookup passes `subdirectory:`), mirrored into `web-demo/assets/images/`. Two of them needed work: the
  RN app's `analysis.svg` and `video_icon.svg` were **not vectors** — each was a three-line `<svg>`
  wrapping a base64 `<image>`, which `SVGVector` rejects outright (`SVGVector.swift:311`), and whose
  `fill="#FFFFFF"` prop was already a no-op in RN — so their payloads were decoded back to the PNGs they
  always were. `opening_book.svg` was ported from the RN repo with its alpha **baked into 8-digit hex**,
  because `SVGState.inheritable` never reads `opacity`/`fill-opacity`/`stroke-opacity` and a verbatim copy
  would paint a solid-black knight. `Diagnostics.swift` now counts them so a missing `Package.swift`
  resource entry fails loudly instead of rendering blank cards.
- **Added** — `Theme.nunitoItalic`. SwiftUI's `.italic()` is a **silent no-op** on a family with no italic
  face — it requests the symbolic trait, CoreText finds no match, and the text renders upright — and Nunito
  ships only Regular…ExtraBold. The quote strip is specified italic, so this shears the real face via a
  CTFont matrix. `Theme.c(_:_:)` was also de-privatised so `HomePalette` builds its colours through the
  same helper instead of duplicating the sRGB construction. _(web-demo: n/a — CSS synthesises obliques.)_
- **Changed** — the grid's tiles use an explicit `.frame(width:height:)` rather than
  `.frame(maxHeight: .infinity)`. A flexible frame lets a child return *more* than the height proposed to
  it, so one card whose content exceeded its third would overflow the stack and quietly steal height from
  the other two rows; all six tiles now come from one `HomeTileSize`, making "six pixel-identical cards" a
  property of the construction. Likewise the quote strip is pinned to its two-line height instead of
  hugging — a hugging strip would be one line tall for some quotes and two for others, resizing all six
  tiles at the top of every hour. _(web-demo: same two fixes in `css/app.css`.)_
- **Fixed** — the design is over-constrained inside a tab bar on **every** device, not just small ones: the
  original home is a full-height Stack screen with no tab bar, so hosting it as tab 0 costs ~74 pt straight
  out of the grid (a 4.7" phone gets ~74–93 pt per row against the ~115 pt the full card content wants).
  Rather than clip a label, the icon slot now shrinks first and the card's internal gap second
  (`HomeScreenMetrics.iconBox` / `.innerGap`, mirrored by `flex: 0 1` and `gap: min(var(--h-gap), 8%)` in
  CSS), so artwork renders at roughly 50–75% of its nominal size while every other metric stays exactly the
  spec. Verified with headless-Chrome measurements across **7 devices × 2 themes = 14 combos**: no title,
  subtitle or CTA clipped anywhere, six tiles identical to within 0.016 px (sub-pixel flex rounding), equal
  row pitch, and zero scroll overflow. Full-size icons would require making home the app root without a tab
  bar — a structural change, noted in `docs/home-screen.md`. _(web-demo: this is where it was measured.)_

- **Note** — the Swift side is **unverified by compilation**: there is no Swift toolchain on this Windows
  checkout (`swift` is not on PATH), so `swift build`, `swift run ParityRunner`, `PieceArtCheck`,
  `HomeMetricsCheck` and `BIYA_DIAG=1` could not be run here and must be run on a Mac before shipping.
  Nothing under `Sources/BiyaherongCoachCore/`, `Sources/ParityRunner/` or `Goldens/` was touched, so the
  parity suite is unaffected by construction. The algorithms themselves ARE verified: `web-demo/js/home.js`
  is a line-for-line port of the same pure layer and its 92 assertions pass under Node, including the exact
  derived-metric table the Swift check asserts.

### 2026-08-05

- **Changed** — `web-demo/`: the **Puzzles tab is now compact and never scrolls** (client preference). It's a
  fill-height flex layout: a compact one-row rating card (accuracy ring + rating + the puzzle's theme, merged
  from the old rating card + meta row + sparkline), and the board flexes to fill the leftover space — sized
  with container-query units (`min(100cqw, 100cqh)`) so it's the largest square that fits (edge-to-edge on
  tall phones, auto-shrunk & centered on short ones like the SE). 0px overflow on every device (iPhone 15 &
  SE screenshot-verified). Files: `web-demo/js/app.js`, `web-demo/css/app.css`. _(web-demo: this is the change.)_
- **Changed** — `web-demo/`: hid the scrollbars (the in-app `.view`, the move ribbon, and the page) for an
  app-like look — real iOS apps don't show a persistent scrollbar. Scrolling still works via
  wheel/trackpad/touch (verified: view still scrolls with the bar hidden, 0 page errors). File:
  `web-demo/css/app.css`. _(web-demo: updated — this is the change.)_
- **Fixed** — `web-demo/`: layout bugs the phone frame exposed ("text lagpas") — found & confirmed with
  **headless-Chrome screenshots**: (1) the view renderers (`renderGame` / `renderCoachSelect` /
  `renderPuzzles` / `renderProfile`) didn't clear `#view`, so starting a game / changing opponent **stacked**
  the new screen on top of the old one → overlapping text; they now clear `#view` first (some transitions
  call them directly, bypassing `render()`). (2) On short desktop windows the phone shrank to an unusably
  narrow strip (it was height-constrained); width is now driven by the real device size and the page scrolls
  instead. (3) Coach-card name/badge/rating overlapped at narrow widths → the header now wraps. (4) Profile
  "Your coaches" avatars overflowed the screen → responsive grid. Files: `web-demo/js/app.js`,
  `web-demo/css/app.css`. Added a "view cleared on game start" regression check (app boot now 20/20).
  _(web-demo: this is the fix.)_
- **Added** — `web-demo/`: an **iPhone model picker** (`js/device.js` + a dropdown in the hero). The phone
  frame now uses each model's **real screen dimensions** (verified against public iPhone viewport references)
  — iPhone SE (375×667, short, home button), iPhone 11/14 (notch), iPhone 15 / 16 Pro / Pro Max (Dynamic
  Island) — and remembers the choice in `localStorage`. This also fixes the "too tall" frame by letting you
  pick a shorter device. Files: `web-demo/index.html`, `web-demo/css/app.css`, `web-demo/js/device.js`.
  Verified: app boot 19/19 + picker 12/12 (jsdom). _(web-demo: updated — this is the change.)_
- **Changed** — `web-demo/`: the app now sits inside a **realistic phone frame** (bezel + Dynamic-Island
  notch + status bar + home indicator, correct ~390:844 proportions), and the **chessboard is edge-to-edge**
  (flush to the screen sides, square corners) in both Play and Puzzles. Files: `web-demo/index.html`,
  `web-demo/css/app.css`. jsdom smoke test green (19/19). _(web-demo: updated — this is the change.)_
- **Changed** — `web-demo/`: reworked from a centered phone column into a **website showcase** — a full-width
  top **banner** ("Biyaherong Chess App iOS", outside the app), a hero background, the app framed as a
  centered **device card**, and a footer with credits. Responsive; the in-app tabs/board are unchanged.
  Files: `web-demo/index.html`, `web-demo/css/app.css`. Verified: jsdom smoke test still green (19/19).
  _(web-demo: updated — this is the change.)_
- **Added** — `docs/` folder, this `CHANGELOG.md`, and a **Workflow** section in `CLAUDE.md` that codifies
  the process: read docs before working, log every change here, write a doc per feature under `docs/`, and
  mirror user-facing features into `web-demo/`. _(web-demo: n/a — process/docs only.)_
- **Added** — `CLAUDE.md`: first AI-assistant guide for the repo (commands, architecture, and the parity
  contract). _(web-demo: n/a.)_
- **Added** — `web-demo/`: a browser rebuild of the app that runs on **Windows with no install** — **Play**
  (5 coaches, tap-tap moves, promotion, undo/flip, sounds, animations, pass-and-play), **Puzzles** (10
  engine-verified mate puzzles + ELO rating), and **Profile** tabs; a reusable `<chess-board>` Web Component;
  and JavaScript ports of the Swift engine (`ChessBoard`), coach AI (`ChessAI`, 5 personas), and rating
  (`Rating`). Verified with perft (23 checks) + a headless jsdom integration pass. Docs:
  [`docs/web-demo.md`](docs/web-demo.md), [`web-demo/README.md`](web-demo/README.md).
  _(web-demo: this **is** the web-demo.)_
