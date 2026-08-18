# web-demo — browser rebuild (Windows preview)

A zero-install rebuild of the app that runs in a browser, so changes are **visible on Windows** (the real
iOS/macOS app can't run there). It is faithful to the app's look and behavior, but it is a **preview only —
the parity-tested engine remains the Swift code in `Sources/`.** When you add a user-facing feature to the
app, **mirror it here** so the user can see it.

- **End-user run steps:** [`../web-demo/README.md`](../web-demo/README.md) — double-click
  `web-demo/index.html`, or use VS Code Live Server.
- **Self-test:** open `web-demo/index.html?selftest` → perft (8902 / 197,281 / 97,862) plus the home,
  engine-notation, move-tree, PGN, analysis-search, game-review, opening-book and analysis-metrics suites,
  shown in a banner + console. It also mounts a throwaway `<chess-board>` and asks the browser, via real
  `elementFromPoint` hit-testing, whether the arrow overlay is stealing the tap target — the one thing no
  headless harness can answer. Run it after editing any of `js/engine.js`, `js/movetree.js`, `js/pgn.js`,
  `js/analysis-engine.js`, `js/review.js`, `js/opening-book.js`, `js/analysis-metrics.js`,
  `js/analysis.js`, `js/analysis-store.js`, `js/position-editor.js`, `js/chess-board.js` or
  `js/home.js`.
- **Screens:** **Home is the root**, and every other screen — Puzzles, Play vs Coach, the Analysis
  Board, Opening Tree, Pairing, Profile, the paywall — is reached from it and returns to it by its
  own back button. There is no tab bar. The Analysis Board renders into `#view` like every other
  screen (the original is a pushed route, and its seven bands
  cannot spare the height). `render()` clears both `.flush` and `an-mode`, and its trailing
  `else renderPuzzles()` means **a new screen must get its own branch** or it silently looks like
  Puzzles.
- **Persistence:** the Analysis Board's save form, library and drafts write one JSON document to
  `localStorage` under `biya.analysis.v1` (beside `biya.demo.v1` / `biya.device` / `biya.soundEnabled`).
  The rules live in `js/analysis-store.js`, which is pure — the browser layer is only `getItem`/`setItem`
  around it, exactly as `AnalysisLibraryFile.swift` is only file I/O around `AnalysisStore`. Both languages
  hardcode the **same canonical library document** and `node tools/qa/canonical_library_check.js` compares
  the two literals byte for byte, so a schema change in one language fails the gate rather than drifting.
- **Golden gate (Node):** `node tools/qa/js_goldens.js` replays the PHP oracle's vectors — 3,105 SAN cases,
  303 game reviews, the PGN tokeniser and splitter, and the ECO book — against the same JavaScript. It also
  runs three checks that exist only because `swift` is not on PATH here: `metrics_key_check.js` (every
  metrics reference resolves, in **both** languages), `swift_source_keys.js` (every StyleSheet lookup the
  Swift metrics check makes has a value to find) and `replay_position_editor.js` (the hand-authored Swift
  tables, replayed through the JS that has actually run). And `board_layout_check.js`, which reads
  `css/app.css` itself — the Analysis Board's chessboard must be `flex: none` at a width-derived size
  with no container-query unit anywhere, because sizing it from leftover height made it resize on
  every move while every other suite stayed green.
  Regenerate the goldens first (`php tools/oracle/generate_goldens.php && php tools/eco/build_eco.php`);
  `Goldens/` is gitignored. This is the gate that matters, because `swift` is not on PATH on the Windows
  checkout.
- **End-to-end demo:** `node tools/qa/review_demo.js` plays a game out of the ECO book, evaluates every
  position offline and prints the opening, the book prefix, both accuracies and all ten classification
  counts. Not a test — a way to see the whole review pipeline work.

## Page layout (site chrome)
`index.html` wraps the app in **website chrome**: a full-width top **banner** ("Biyaherong Chess App iOS"
branding, outside the app), a **hero** area, the app shown inside a **realistic phone frame**
(`.phone` bezel → `.statusbar` with a Dynamic-Island notch → `.app-card` screen → home indicator, correct
~390:844 proportions), and a **footer** with credits. Styled by the *Site chrome* section of `css/app.css`
(`.site-banner` / `.hero` / `.phone` / `.app-card` / `.statusbar` / `.site-footer`); fully responsive.
`app.js` still targets `#view`, so the app logic is independent of the surrounding page.

A **device picker** (`js/device.js`, dropdown in the hero) swaps the frame to any of several iPhones using
their **real screen dimensions** — iPhone SE (home button, short), 11/14 (notch), 15/16 (Dynamic Island).
It sets `--sar` (screen aspect) + `--pmm` (body width mm) on `.phone` and a style class; the choice persists
in `localStorage`. To add/adjust models, edit the `MODELS` array in `js/device.js`.

The **Puzzle Hub is a fixed, non-scrolling** fill-height layout (`.puzzle-view` → compact rating card +
`.puz-board`): the board flexes to fill the leftover space and is sized with container-query units
(`min(100cqw, 100cqh)`) so it's the largest square that fits — edge-to-edge on tall phones, auto-shrunk &
centered on short ones. Keep it scroll-free when editing that screen.

The **chessboard renders edge-to-edge** (flush to the screen sides): `.board-row` / `.board-solo` use
`padding-inline: 0` and the board gets `--board-radius: 0` for square, flush corners.

## File map (`web-demo/`)

| File | Role | Ported from |
|---|---|---|
| `js/engine.js` | Chess rules: FEN, legal moves, castling/en-passant/promotion, SAN, check/mate, perft — plus SAN/UCI **parsing**, the position key and the draw rules | `Sources/BiyaherongCoachCore/ChessBoard.swift`, `ChessNotation.swift`, `ChessRules.swift` |
| `js/ai.js` | Coach AI: negamax + alpha-beta + PST eval + the 5 personas | `ChessAI.swift` |
| `js/rating.js` | ELO (K=32, floor 400), tiers, eval→win% | `Rating.swift`, `GameReview.swift` |
| `js/movetree.js` | the analysis move tree: variations, promote/delete, and the pure `flatten()` render model | `MoveTree.swift` |
| `js/pgn.js` | PGN import/export with recursive variations, NAGs and comments — the persistence format | `PGN.swift` |
| `js/analysis-engine.js` | the analysis search: iterative deepening, quiescence, MultiPV, principal variation, cancellation. **Not** the coach AI in `ai.js` | `AnalysisEngine.swift`, `LocalEngine.swift` |
| `js/review.js` | game review: classification, accuracy, the `book` tier, **and the runner** (`plan`, `reviewSteps`, `reviewProgressive`). PHP-parity, validated against 303 oracle cases | `GameReview.swift`, `ReviewAnnotator.swift` |
| `js/opening-book.js` | ECO lookup over `eco-data.js`: naming, transpositions, book continuations | `OpeningBook.swift` |
| `js/eco-data.js` | the bundled offline ECO book, 7,854 position-keyed rows. **Generated** — `php tools/eco/build_eco.php` | `DemoApp/…/ECO/eco.tsv` |
| `js/analysis-metrics.js` | the Analysis Board's pure layer: board geometry, band heights, palette, typography, arrow/badge/indicator maths, the classification and eval-symbol tables, timings. Asserted against the numbers extracted from the real RN StyleSheet | `DemoApp/…/AnalysisMetrics.swift` |
| `js/engine-host.js` | decides **where the search runs**: a Web Worker when served, sliced in-thread from `file://`. Both screens call it | — (the Swift side uses `Task.detached`) |
| `js/analysis-worker.js` | the worker itself: `importScripts` the unmodified engines, then an analyze/bestMove/cancel message loop | — |
| `js/position-editor.js` | Setup Position: piece placement, silent castling normalisation, and the validation chess.js used to do for the original | `PositionEditor.swift` |
| `js/analysis-store.js` | the saved-game library: records mirroring the Laravel schema, folder rules, search, and the 24h draft TTL. Shares one canonical document with the Swift store | `AnalysisStore.swift` |
| `js/analysis.js` | ⭐ the Analysis Board: a pure session layer (status line, opening tracking, arrows, engine rows, move-strip tokens, the staleness rule) **plus** the seven-band screen | `AnalysisSession.swift`, `AnalysisVM.swift`, `AnalysisBoardScreen.swift` |
| `js/chess-board.js` | ⭐ the reusable `<chess-board>` Web Component (render + interaction + animation, plus the SVG arrow overlay and pointer-drag) | — (view layer) |
| `js/home.js` | the home dashboard; its top half is the pure metrics layer + `BiyaHome.selfTest()` | `HomeMetrics.swift`, `HomeScreen.swift` |
| `js/app.js` | the router: Home as the root, every other screen a route raised from it; wires board ↔ engine ↔ AI; localStorage stats | mirrors `DemoApp` PhoneApp |
| `js/sound.js` | event → mp3 mapping | `Sound.swift` |
| `js/puzzles.js` | the OLD Puzzles screen's ten embedded samples (every one an engine-verified mate). **Different move convention from the Puzzle Hub** — here `solution[0]` is the solver's; in the corpus `moves[0]` is the opponent's. Not interchangeable | — |
| `js/puzzle-data.js` | the Puzzle Hub's corpus slice: 1,912 real puzzles across every band and theme. **Generated** — `python tools/puzzlebank/build_puzzles.py`. A page cannot load the device's 33 MB SQLite, so the browser proves the LOGIC on real puzzles and is explicitly not the shipping corpus; it flags itself with `isSlice` and carries `corpusTotal`/`dailyPoolTotal` | `DemoApp/…/puzzles.sqlite` (92,976 rows) |
| `js/puzzle-serving.js` | the three fallback ladders, pinned by the `serving` goldens. Side-effect free: takes `seen`, reports `didReset` | `PuzzleServing.swift` |
| `js/puzzle-session.js` | ⭐ the one solver core all five modes configure: the `moves[0]` convention, the phase machine, the checkmate short-circuit, the five wrong-move policies, promotion, retry, Solution, the Save Puzzle PGN | `PuzzleSession.swift` |
| `js/puzzle-store.js` | the four selectors: the ladders over a pool, the scoped Tier-3 wipe (spec fix #7), and the deterministic local-calendar daily index | `PuzzleSelection.swift`, `DemoApp/…/PuzzleStore.swift` |
| `js/puzzle-progress.js` | everything the user does: the rated ledger, seen set, streak/rush state, drafts with a 24h TTL, the daily-goal counter | `PuzzleProgress.swift` |
| `js/device.js` | iPhone model picker — sets the frame's real screen aspect ratio + bezel style | — (page chrome) |
| `css/theme.css` | design tokens. **Linked first** — every other sheet reads them | `Theme.swift` |
| `css/app.css` | the shell, Home, the puzzle screens, the Analysis Board, the paywall, the Opening Tree | — |
| `css/pairing.css` | the Pairing Manager (`--pgl-` list · `--pgc-` create · `--pgd-` detail) | — |
| `css/coach.css` | Play vs Coach (`--cgs-` select · `--cgc-` colour · `--cgp-` game · `--cgx-` polish) | — |
| `assets/` | pieces, sounds, coach avatars, fonts (copied from the app) | — |

All scripts are classic `<script>` (no ES modules), so it works from `file://` with no build step.

**Every header's logo ring holds the brand mark**, through one helper: `BiyaIcons.brandLogoEl(cls)`
in `js/icons.js`, which owns the asset path. `components/AppLogo.tsx` — captured in the extraction
as `puzzle_styles.json` → `shared.logo` — is a gold ring with `overflow: hidden` **around an
image**; the browser ported the ring to nine headers and never the image, so all nine drew an empty
gold circle beside the title. `tools/qa/home_chrome_check.js` §8 pins all nine, and §7 bans the gold
knight from anywhere inside the app.

### Two shell rules, both of which shipped broken before they were gated

**Every stylesheet in `css/` must be linked.** `coach.css` was not, from the commit that introduced
Play vs Coach until round 4 — 507 correct lines that the page never loaded. It was invisible while
the Play route still showed the old sample screen, and the moment `app.js` routed Play to
`BiyaCoachSelect.render` the whole feature rendered as raw UA buttons, white on white. A round
earlier the problem had been *noticed* and a guard written, but that guard
(`replay_login.js`) only asserts `app.css` is linked, so it never fired.

**Every scroll container hides its own scrollbar**, with BOTH halves:

```css
.some-band { … overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
.some-band::-webkit-scrollbar { width: 0; height: 0; }
```

`app.css:9` has stated the intent since the first commit — *"Hide scrollbars everywhere for an
app-like look"* — but applies it to `html, body`, and **`scrollbar-width` does not inherit**, nor
does `::-webkit-scrollbar` cascade. Ten bands were therefore showing the bare OS scrollbar, in a
frame that is pretending to be a phone.

**And no element sets `resize`.** iOS has no resize handle, so a drag-to-resize textarea is a
control the Swift app cannot have — a cross-language divergence, not just an eyesore. `resize: none`
on all five textareas.

`tools/qa/web_shell_check.js` enforces all three, and is mutation-checked against each.

**Where the engine runs is no longer "the main thread" flatly** — `js/engine-host.js` decides:

- **served over http** (Live Server, or `python -m http.server`) → `js/analysis-worker.js`, a real
  Web Worker. The main thread never runs a search, which is what makes piece movement smooth.
- **`file://`** → in-thread, because a document with an opaque origin cannot construct a Worker (the
  blob-URL and `data:` workarounds inherit the same origin and fail identically). Each depth then
  gets its own **80 ms slice deadline**, cut from inside the search, so the worst block is ~94 ms
  instead of the 624–2,885 ms it used to be. The engine reaches a shallower depth; nothing freezes.

`BiyaEngineHost.mode` reports which one you got. Both screens go through the host — the Analysis
Board's search and Play's coach — and the worker loads the *unmodified* engine files via
`importScripts`, so what runs there is byte-identical to what the golden suite proves.

**If you edit `js/analysis-worker.js`, run `node tools/qa/worker_protocol_check.js`.** The worker only
runs on a served page, so a mistake in it is invisible from `file://` and in Node, and the host
cannot catch it: construction succeeds, the fallback never fires, and the board silently stops
getting snapshots. That check drives the real message protocol in a fake worker scope; it caught an
`importScripts` ordering bug the first time it ran.

## The reusable `<chess-board>` component

View + interaction only — it **never mutates game state**. Give it a `rules` object; it fires a `move` event,
the app applies that move to the real engine, then calls `setPosition()` back (single source of truth stays
outside the component).

> Its SwiftUI counterpart is `BoardView` + `ChessBoardBand`, and the two are kept deliberately in step —
> same square colours — now *pinned* to one extraction by `board_layout_check.js` §8, after both
> languages spent the whole port drawing an invented blue — same highlight precedence, same coordinate
> geometry, same **sizing rule** (a fixed square from the width; the band below it is the flexible one). See [`chessboard.md`](chessboard.md) before
> changing either; a divergence here is what shipped a broken Puzzle Streak screen to TestFlight while the
> browser looked correct.

- **Attributes:** `fen` · `flipped` · `interactive` · `coordinates` · `piece-path` · `draggable-pieces`
- **Properties:** `.rules = { legalMovesFrom(fen, sq) → [{to, promotion|null}] }` · `.fen` · `.flipped` ·
  `.interactive` · `.draggablePieces` · `.arrows = [{from, to, rank}]`
- **Methods:** `setPosition(fen, {animate, lastMove, check})` · `flip()` · `highlightLastMove(from,to)` ·
  `setCheck(sq|null)` · `showLegalTargets([sq])` · `clearSelection()`
- **Events:** `move` → `{from, to, promotion, uci}` · `square-select` → `{square}`
- **Theming (CSS vars, pierce the Shadow DOM):** `--board-light` `--board-dark` `--hl-last` `--hl-select`
  `--hl-check` `--board-max`

A full drop-in usage example is in [`../web-demo/README.md`](../web-demo/README.md).

### Arrows and drag (added for the Analysis Board)

Both are **off by default**, so Play and Puzzles are unchanged.

- `.arrows = [{from, to, rank}]` draws engine lines into an `<svg viewBox="0 0 8 8">` overlay — one unit per
  square, so the geometry is resolution-independent, survives resize and flip, and needs no
  `getBoundingClientRect`. `rank` 0/1/2 selects green/blue/orange; the best line is painted last so it lands
  on top. Set `[]` to clear.
- `draggable-pieces` adds pointer-drag **alongside** tap-to-move, funnelled through the same
  `_commit`/`_askPromotion` path, so the `move` event is identical either way and callers need no changes.

Three constraints hold this together, and breaking any of them silently breaks input in **Play and Puzzles**,
not just analysis:

1. The tap path is a **delegated `click` on `.squares`**. Any layer stacked above it must be
   `pointer-events:none` — the overlay is, and drag listens on `.board`, not on the pieces.
2. `.piece` has `transition:transform .33s`, so the drag ghost sets `transition:none` or it lags a third of a
   second behind the finger.
3. `attributeChangedCallback` early-returns while `!_built`, and `app.js` sets properties *before*
   `appendChild` — so any new attribute must **also** be read in `connectedCallback`.

`touch-action:none` is applied only via `.board.draggable`; boards without drag keep scrolling normally.
A drag under 4 px stays a tap, and the click a real drop generates is swallowed exactly once.

### The `tap` event (added for Setup Position)

`tap` fires for **every** square — empty ones included, and regardless of `interactive` — before any
selection logic runs. Setup Position needs "which square did you touch" with no notion of a legal move, and
`square-select` only fires when a square has targets. Purely additive: nothing else listens for it, so Play
and Puzzles cannot change behaviour. The one subtlety is that it sits *after* the `_suppressClick` check, so
the click a completed drag leaves behind produces no phantom tap — asserted in
`tools/qa/board_component_test.js`.

## Adding to the demo

- **A gameplay/UI feature** → update `js/app.js` (+ `css/app.css`); reuse `<chess-board>` for anything with a
  board. If the *rules* changed in `Sources/`, port the same change into `js/engine.js` and re-run
  `index.html?selftest`.
- **View rendering contract:** each leaf renderer (`renderCoachSelect` / `renderGame` / `renderPuzzles` /
  `renderProfile`) clears `#view` at its start. Keep that when adding a screen — some transitions (start
  game, change opponent, next puzzle) call these directly and bypass `render()`; without the clear, the new
  screen stacks on top of the old one.
- **A new puzzle** → append to `js/puzzles.js` (`fen` + `solution` UCI line + `theme`/`rating`). Every
  committed puzzle must be a real, engine-legal line; mate puzzles must actually end in checkmate.
- **New piece art** → replace the SVGs in `assets/pieces/` (keep the `<kind>-<w|b>.svg` names) or set the
  `piece-path` attribute.
- After any change: open `index.html` to smoke-test (and `?selftest` if you touched `js/engine.js`), then log
  it in [`../CHANGELOG.md`](../CHANGELOG.md).
