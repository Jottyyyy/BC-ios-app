# Changelog

All notable changes to this project are logged here, **newest first**. Dates are absolute (`YYYY-MM-DD`).
Loosely follows [Keep a Changelog](https://keepachangelog.com). **Every change should add an entry** — see
the **Workflow** section in [`CLAUDE.md`](CLAUDE.md).

Tags: **Added** (new feature) · **Changed** (behavior/refactor) · **Fixed** (bug) · **Docs**.
Each entry notes whether `web-demo/` was updated.

## [Unreleased]

### 2026-08-13 (added) — A stronger analysis engine, and an Engine Settings panel to spend it

The Analysis Board's engine got both halves of what was asked for: it plays better at the same
budget, and how much budget it gets is now the user's choice.

**Added — ☰ > Engine.** Five presets, weakest and coolest first, plus an Advanced section
(Lines 1–5, Max depth 2–30, Think time 0.2–30 s, whose bottom step *is* Infinite).

| Preset | Think time | Depth ceiling | Lines | Review / position |
|---|---|---|---|---|
| Battery Saver | 0.5 s | 8 | 2 | 120 ms |
| **Balanced** (default) | 1.2 s | 12 | 3 | 200 ms |
| Strong | 3 s | 18 | 3 | 500 ms |
| Maximum | 8 s | 22 | 4 | 1200 ms |
| Infinite | until stopped | 30 | 4 | 1200 ms |

Balanced is exactly what the board did before, so an install where nobody opens the panel behaves as
it always has — only stronger. The per-position review budget is **derived** (`thinkMs / 6`, clamped
120–1200) rather than listed, which reproduces every value in that column from one number. Infinite
has no deadline at all and deliberately **does not apply to Analyze Game**; 41 unbounded searches
would never finish, so that budget saturates instead. Persisted under `biya.analysis.engine.v1`.

**Added — `analysis-eval.js` / `AnalysisEval.swift`, an evaluation the analysis engine owns.** The
old one was material plus one piece-square table, borrowed from the coach. The new one adds tapered
mid/endgame scoring, pawn structure (doubled, isolated, passed), king safety, mobility, the bishop
pair, rooks on open files and tempo. **`ChessAI.evaluate` is untouched** — it is parity-pinned to the
five coach personas, so the coaches play exactly as they did; the new one sits beside it exactly as
`CoachEngine` sits beside `ChessAI`, and reuses its material values and midgame tables *by
reference* so the shared half cannot drift. Same units, same sign convention, so the eval bar,
`classifyMove` and `ReviewAnnotator` needed no change at all.

**Changed — the search (`local-negamax-v1` → `v2`).** Transposition table, killer moves and history,
principal-variation search, check extensions, null-move pruning, late move reductions, and MultiPV
that stops paying for a full-window search on root moves it will never display. `analyzeSteps`
became the core rather than a wrapper that re-ran `analyze` from depth 1 on every step, so the
table, killers, history and root ordering now survive between depths — which is what iterative
deepening is for.

**Measured**, at the same 1200 ms budget, over the six positions `engine_budget_check.js` uses:

| | before | after |
|---|---|---|
| mean depth | 3.83 | **5.00** |
| sharpest position ("queens on") | 2 | **4** |
| corpus tactics at 120k nodes | 105/120 (87.5%) | **115/120 (95.8%)** |
| tactics nodes/sec | 38.1k | **60.8k** |

Battery Saver at 0.5 s reaches mean depth 5.17 — deeper than the *old* engine managed in 1.2 s.

**Added — `tools/qa/engine_strength_check.js`**, wired into `js_goldens.js`. Null-move pruning and
LMR both decide, on a guess, not to look at a move; a guess that goes bad throws nothing and fails
no structural assertion, it just stops seeing combinations. So the gate replays 120 corpus puzzles
(sampled deterministically across the whole rating range) at a fixed **node** budget — reproducible
on any machine, unlike a clock — with a floor of 108, plus a mate-is-reported-as-mate check and a
determinism check. **Added — `tools/qa/replay_engine_settings.js`**, 142 Swift expectations checked
against the JS, in the established `replay_*` shape for Swift this checkout cannot compile.

**Changed — `board_layout_check.js`** now also checks that every `--an-eng-*` custom property the
stylesheet reads is set from `MET.ENGINE_PANEL`, and vice versa. It earned its keep on the first
run, catching `--an-eng-track-h` and `--an-eng-track-r` as dead: both platforms use the native
slider, which draws its own track, so those two numbers described nothing. Removed.

**Fixed — `PuzzleSolverParts.swift:205` called `EngineLimits(maxDepth:multiPV:)`.** There is no such
type anywhere in the repo; it is `SearchLimits`. The line has never compiled and would have failed
the next `swift build` on a Mac. The puzzle hint panel keeps the *default* limits deliberately — the
Analysis Board's preset is that screen's setting, not the Puzzle Hub's.

**Docs** — new [`docs/engine-settings.md`](docs/engine-settings.md); `docs/analysis-board.md`'s
engine-budget and review-classification sections updated; `PORTING_NOTES.md` records every invented
constant above and three deliberate deviations (Infinite excluded from Analyze Game, the separate
evaluation, and the two languages' Zobrist tables differing on purpose).

**`web-demo/` was updated** — it is where all of this was written and proven first, as `CLAUDE.md`
requires: the panel is at ☰ > Engine there too, `engine-settings.js` and `analysis-eval.js` are the
sources the Swift was transliterated from, and the panel is shared as *data*
(`EngineSettings.panelModel`) rather than reimplemented, so the two cannot drift.

**Not done:** `ChessPosition.legalMoves()` still filters by calling `applyRaw` on every pseudo-legal
move — a full board copy per candidate, at every node, and the single largest nodes-per-second win
still available. It is safe to attempt because `perft` verifies move generation exactly, but it is a
change to the parity core and belongs in its own commit, not folded into this one.

### 2026-08-12 (added) — Offline game review. Phase 2 step E complete; §2.10 shipped in both languages.

**Added**
- **`web-demo/js/coach-review.js`** + **`Sources/BiyaherongCoachCore/CoachReview.swift`** — the
  adapter, in both languages. The classification maths is NOT rewritten: `review.js` /
  `GameReview` is already the parity port of `GameReviewController`, pinned by 303 golden cases.
  What is new is `planFromGame` (records → the `{positions, moves, nodes, keys}` shape those
  already consume), the modal's derived values, and `handoff`.
- **The review modal**, in `coach-play.js` and `CoachScreens.swift`: a determinate
  `Analyzing… {done}/{total}` bar, the accuracy columns, the eval curve, the classification rows
  and the two actions.
- **`loadReviewedGame` on the Analysis Board** — the hand-off seam. Queued rather than applied,
  because the caller switches tabs and repaints in the same turn; `render` consumes it on the way
  in, so the order of those two calls cannot matter.

**Fixed — §7 #28, the empty classification array.** The RN hand-off shipped
`moveEvaluations: []` *every single time*: `handleGameReview` read `reviewData` but its memoised
dependency list named only `moveRecords`, so the callback closed over `null` forever. `handoff`
takes the summary as an ARGUMENT and returns nil rather than an empty payload — there is no
captured variable left to go stale.

**Fixed — §2.10's orientation defect.** The RN modal ordered the accuracy columns
White-left/Black-right and the classification rows user-left/opponent-right, so playing Black put
the coach's accuracy directly above your own move counts. `columns()` is now the single source of
that ordering and both halves read it; two mutants pin it in each language.

**Changed — four duplications removed rather than written.**
- The accuracy bands, the one-decimal format, the ten classification colours and their labels
  already existed in `analysis-metrics.js` / `AnalysisReview` + `AnalysisTables`, in both
  languages. The first draft of this feature reimplemented all four — including ten hex values
  hand-typed into `coach.css`. They are now delegated, and the stylesheet tints inline from the
  shared table.
- `GRAPH_CLAMP_CP` reads the component's own `CLAMP` instead of restating 500.

**Changed — the eval graph is extracted, not transcribed.** Spec §2.10 states the graph's fill,
radius, both advantage fills, the centre line and the curve in prose. Every one is a literal on an
SVG attribute in `components/EvalGraph.tsx`, which `collectSvgAttrs` now lifts — a new walk over a
third file, plus its call-site `height={60}` in `play.tsx`. Ten values, none retyped.

**The review card's border is `accentColor + '30'`** — the accent with a hex alpha BYTE appended,
which is §2.10's "accent @ 19 %". Read as a percentage it would be almost twice as strong; the
Pairing Manager shipped exactly that confusion once in a badge tint, so both languages keep the
byte and divide.

**Verification.** `coach-review` 62 assertions · `CoachScreens` 121 · `ReplayCoach` **270** ·
twelve new mutants, **159/159 killed** (was 147). Gate: **29,168 assertions across 56 suites**;
107 Swift files sound, 2,975 references and 132 types resolve.

### 2026-08-12 (added) — Play vs Coach: the Swift half. Phase 2 D4 complete.

**Added — the Core domain, which did not exist in Swift at all.**
- **`CoachEngine.swift`** — the level table, `pickIndex`/`pickMove` with an injected RNG, the
  think-time pacer and the 1 s movetime cap. Sits BESIDE `ChessAI` exactly as `PairingEngine` sits
  beside `TournamentEngine`; spec §2.2 is explicit that strength is depth + MultiPV + a client-side
  randomiser, with no Elo cap and no blunder chance.
- **`CoachGame.swift`** — the record, threefold on the first three FEN fields, the six result
  lines, insufficient material, and the per-level seven-day draft behind an injected `Storage`.
- **`CoachTurn.swift`** — the generation counter, the premove, the shared nav rule, take-back.
- **`CoachBook.swift`** + generated **`CoachBookData.swift`** — the lookup is transliterated; the
  63 repertoire rows and two junk pools are EMITTED from `coach-book.js` by the new
  `tools/metrics/gen_coach_book.js`, so the two languages hold one book rather than two readings
  of one.

**Added — the UI.**
- **`CoachStore.swift`** — the reply loop. The generation token also drives the engine's
  `shouldCancel`, so resigning mid-search stops the *search* rather than discarding its answer.
  The wait is **paced**, not added: it runs down whatever the search already spent, which is what
  makes §2.13's 300 ms floor a floor.
- **`CoachScreens.swift`** — Coach Select, Colour Select and the game, with the resign prompt.
- **`CoachLayout.swift`** — the twelve values that are NOT extracted, plus the five nav glyphs, in
  one file so they can be counted. Four of the twelve are *derived* from extracted constants and
  the replay pins the derivation.
- **`CoachMetricsCheck.swift`** + a `swift run CoachMetricsCheck` target.
- **`PhoneView`** — a `showCoach` overlay in the same shape as `showPairing`; the Home tile's
  `onPlayCoach` now presents it instead of switching to the sample Play tab.

**Fixed — a duplicate type that could never have compiled.** The generated `CoachMetrics.swift`
declares `public enum CoachSelect`, and `CoachSelect.swift` declared a `struct CoachSelect: View`.
Two top-level types of one name in one module is a redeclaration error, and it had been sitting in
the repo since the metrics were generated, because nothing on this checkout compiles Swift. The
legacy view is renamed `LegacyCoachSelect` (in `LegacyCoachSelect.swift`), and
**`swift_symbol_check.js` now reports duplicate top-level types** so the class of error cannot
recur.

**Not retired: the sample Play tab.** Its Swift twin cannot go the way the browser one did, because
`BoardView` — which every board in the app uses — lives inside `PlayView.swift` alongside it.
Extracting that first is its own change; recorded in `PORTING_NOTES.md`.

**Verification.** New **`tools/qa/replay_coach.js`**: 239 Swift expectations against the JS twin —
the level and think-time tables, `pickIndex`'s five branches, every book row matched by
(level, side, history), the draft contract, insufficient material branch for branch, and a
**branch-structure section** for the screens and the store (§7 #24/#25/#27/#33/#34, the book before
the engine, the cancellable search, the paced reply, and no numeric literal in any view body).
Sixteen new Swift mutants prove it bites — **147/147 killed** (was 131). Gate: **29,033 assertions
across 55 suites**; 106 Swift files sound, 2,829 references and 131 types resolve.

### 2026-08-12 (added) — Play vs Coach: the three browser screens, wired. Phase 2 D3 complete.

**Added**
- **`web-demo/css/coach.css`** — the stylesheet for all three screens, written against a live audit
  rather than before one. Prefixes `--cgs-` / `--cgc-` / `--cgp-`, plus a `--cgx-` polish namespace
  that touches no extracted value.
- **`auditAppWiring()` in `coach_screen_test.js`** — reads `app.js` as source and asserts the routes
  exist, that **every callback the game screen offers is supplied**, that both generation guards are
  present, and that the retired sample Play tab is gone. 82 assertions in that suite now.
- **The wiring itself** — `app.js` gained the Play vs Coach loop: Coach Select as the Play tab,
  Colour Select and the game as pushed routes, the coach's reply through `BiyaEngineHost` with the
  book consulted first, the paced reply, the premove, resign/take-back/rematch, and the draft
  written after every half-move. The **sample play screen it replaced was deleted** (245 lines,
  its own coach table, its own undo) rather than left unreachable.
- **`docs/play-vs-coach.md`**.

**Fixed — five defects in the game screen's board wiring, none of which any suite could see.**
`<chess-board>` dispatches a `'move'` CustomEvent with NUMERIC square indexes; the screen assigned
`.onmove` (never fires), built its UCI as `detail.from + detail.to` (arithmetic, not concatenation),
set `flipped="0"` (the component is attribute-truthy, so the board was upside down for White), passed
algebraic squares to `highlightLastMove` (the cell map is index-keyed, so no highlight), and never set
`.rules` (so no piece was selectable and **no move could be made at all**). The fake board node in
`coach_screen_test.js` is now a **contract mock** — it throws on algebraic squares and emits the
component's real event detail — and five mutants keep it honest.

**Fixed — the coach roster was transcribed, and was wrong.** `coach-select.js` had a hand-typed
roster with **three of five ratings** and **four of five names** wrong. The spec table (§2.14) and
the RN `COACH_DATA` agreed with each other; only the transcription disagreed. The generator now
emits the roster whole — name, role, tagline, the four in-game lines, accent colour, rating — as
`MET.COACHES` and `CoachRoster`/`CoachProfile` in Swift. `winMsg`/`loseMsg` were not decorative:
`evaluate` puts them straight into the result card, so without them it rendered `undefined`.

**Fixed — an extraction hole that made the stylesheet invent numbers.** `findNamedFunctions` only
matched `const f = () => …`, and `CoachCard` is a function *declaration*, so its
`avatarSize → ringSize = +6 → haloSize = +10` chain was never collected and `renderConstants` came
back empty. `rn_ast.js` now handles both forms; the generator **folds** the extracted signed terms
into six `cardSize` constants that ride on the SELECT sheet, so JS, Swift and the CSS audit all get
them with no new plumbing.

**Changed**
- The five coach accent colours are emitted as `MET.ACCENTS` / `CoachAccent`. `play.tsx` styles the
  primary modal button as `[styles.modalBtn, { backgroundColor: coach.accentColor }]`, which is why
  that block has no background of its own — the demo now applies it inline the same way.
- The **Review button renders only when the host passes `onReview`**. §2.10 is a screen of its own
  and is not built; the alternative was a placeholder modal with copy §2.14 does not have.

**Verification.** `js_goldens.js` **28,794 assertions across 54 suites**. The mutation harness now
runs all seven coach suites and carries nine new Play vs Coach mutants — **131/131 killed** (was
122/122). Swift: 96 files sound, 2,540 references and 124 types resolve.

**Not verified in a browser.** The automation extension could not reach a local server from this
checkout, so the wiring is covered by the source audit above rather than by a real page load. Noted
in `docs/play-vs-coach.md`.

### 2026-08-12 (added) — Pairing Manager: the SwiftUI screens. Phase 1 complete.

**Added**
- **`PairingStore.swift`** — the observable document plus its file I/O: one `mutate` funnel so no
  screen holds `inout` access and persistence cannot be forgotten, atomic writes to
  `Biyaherong/pairing.json`, and a corrupt file degrading to an empty document rather than a screen
  that will not open.
- **`PairingScreens.swift`** — the `NavigationStack` root, the tournament list (type badges, status
  dots, the stats strip, long-press delete) and the create screen (format cards, round presets, the
  live round recommendation that replaced the free-plan notice).
- **`PairingDetailScreens.swift`** — Players / Rounds / Standings, the round selector, the pairing
  boards with their result badges, the engine's warnings surfaced as ⚠ Pairing Notes, and the
  standings table with the SB column the RN app computed and never showed.
- **`PairingModals.swift`** — Add Player, Bulk Add with a live count, and Enter Result with
  **Clear Result**.
- **`PhoneView` wiring** — a `showPairing` overlay in the same shape as `showAnalysis`.
  `HomeScreen.onPairing` has existed since the tile was drawn and was never passed; it is now.
- **A branch-structure section in `replay_pairing.js`** — a SwiftUI body cannot be run or compared
  value-for-value here, but the decisions inside it can be pinned. **1,101 Swift expectations**
  (up from 1,069), and seven new mutants prove they bite. **122/122 killed.**

**Two of my own checks were wrong, and the mutants found both.**
- The layout-literal scan only looked at a modifier's FIRST argument, so `.padding(.bottom, 10)`
  walked straight past it. It now scans the whole argument list, anchored after `(`, `,` or `:` so a
  digit inside an identifier (`buchholzCut1`, `Float3`) is not mistaken for a literal.
- `funcBody`'s regex was `'func\s+'` in a JS string, where `\s` is just `s` — it matched nothing, so
  the "every mutation persists" assertion was vacuously passing.

**Two constants that had to be honest about their source.** The white piece dot is an inline style in
the RN source, not a StyleSheet entry, so the generator now reads `#FAFAFA` out of `inlineStyles` and
fails if it is absent. The bulk editor's height of 160 is **not** in the RN source at all — that
screen uses a plain multiline input — so it is recorded as invented.

**Deferred, and recorded as deferred:** the `ImageRenderer` share card from §1.6. The plain-text
share — which the spec itself defines as the fallback, and which carries no URL (§7 #22) — ships via
`ShareLink`.

Gate: **26,804 assertions across 43 suites**, **122/122 mutants**, 94 Swift files structurally
sound, 2,535 symbol references resolving.

### 2026-08-12 (added) — Pairing Manager: the Core document, and criterion 4 answered

**Acceptance criterion 4 is met.** "Feed the engine a published FIDE Dutch example and match the
official pairings" was the last open one, and I had flagged in advance that cost-based matching might
diverge from FIDE's transposition/exchange walk. It does not:

```
dutch_2025_C5   expected 1 5 | 3 2 | 6 0    got 1 5 | 3 2 | 6 0    no warnings
dutch_2025_C9   expected 2 1 | 3 5 | 4 0    got 2 1 | 3 5 | 4 0    no warnings
```

Board for board, colour for colour, and the bye to the right player both times — including the case
where the nominal Dutch pairing is blocked by a rematch, and the case where the bye must skip a
player who already had one.

**Added**
- **`tools/qa/fide_dutch_test.js`** — both cases as a committed golden, with each source TRF quoted
  verbatim so the reconstruction is auditable rather than trusted, and the `bbpPairings` Apache-2.0
  provenance recorded. The official FIDE Handbook chapter C.04.3 turns out to contain **no worked
  example at all** — it is purely normative — which is why the corpus comes from an independent
  engine instead.
- **`Sources/BiyaherongCoachCore/PairingDocument.swift`** — the pure Core store: create, players
  with dense seeds, bulk parsing, generation, results, computed status, standings, encode/decode.
  Document types are nested inside the enum, because `TournamentPlayer`/`TournamentRound`/
  `TournamentPairing` belong to the PHP port and must keep those names.
- **Document-shape verification in `replay_pairing.js`** — it builds a real document in JS and reads
  the Swift `CodingKeys` out of the source, then compares the two key sets in both directions, plus
  every enum raw value. **1,069 Swift expectations** now confirmed (up from 1,030). This matters
  because the failure mode is the quiet kind: `JSONDecoder` drops an unknown key and defaults a
  missing one, so a mismatched document decodes to something plausible and wrong.
- Five Core mutants, and a **fix to the mutation harness**: `dirFor` resolved every `.swift` to the
  UI directory, so a Core mutant would have been written into the wrong folder as a stray file while
  the real one kept its text — the same failure this harness suffered once before on its restore
  line. It now looks the file up.

**One assertion of mine was wrong, and the mutants caught it.** The check that `Round.floats` is
`[String:]` and not `[Int:]` — which matters because `JSONEncoder` writes an Int-keyed map as a flat
*array* the JS twin cannot read — was matching a **local** `var floats` inside `generate` rather than
the stored property. It passed while the mutant flipped the real declaration. Now anchored on
`public var`.

Gate: **26,772 assertions across 43 suites**, **115/115 mutants**, 90 Swift files sound, 1,951
symbol references resolve.

**Still to come:** the SwiftUI screens, `PairingStore`/`PairingLibraryFile`, and the `PhoneView`
wiring. `docs/pairing-manager.md` tracks it.

### 2026-08-12 (added) — Pairing Manager: the Swift engine, generated metrics, and the replay

**Added**
- **`tools/metrics/gen_pairing_metrics.js`** — emits `PairingMetrics.swift` (774 constants),
  `PairingStrings.swift` (110 strings, 17 interpolating) **and** the JS geometry region, all from
  `tournament_styles.json` in one pass. The puzzle layer hand-writes its Swift constants and leans on
  the replay to spot drift; here there is no transcription step between the two languages for a typo
  to live in, which is what "EXTRACT, DON'T TRANSCRIBE" asks for. The generator refuses to run if the
  list and detail screens disagree about the type colours, if an inline column width is missing from
  the source, or if the JS grows an interpolating string it cannot shape.
- **`Sources/BiyaherongCoachCore/PairingEngine.swift`** — the Foundation-only twin of the JS engine:
  colour preference, the pairing order, byes, downfloats, minimum-cost matching, Berger schedules and
  the four tie-breaks. Sits **beside** `TournamentEngine`, which stays pinned to the PHP goldens.
- **`tools/qa/replay_pairing.js`** — **1,030 Swift expectations confirmed against the JS**: the cost
  ladder and its ordering, the preference and colour raw values, all ~750 extracted constants, the
  colour maps, and the string tables in both directions with copy compared as well as keys.
- **`PairingMetricsCheck.swift`** + its target and shim — asserts the derived logic only.
- A **JS metrics-key check** in the screen suite: every `MET.X.y` and `T.key` the three screens
  reference must exist. Proven non-vacuous by injecting `T.tournamnets` and watching it fail.
- **`swift_symbol_check.js` now covers `Pairing*`** — references went from 1,910 to 1,939, so the new
  Swift is being name-checked rather than merely looking clean because nothing was looking.

**One correction to my own plan.** I had recorded that four sorts needed explicit index tie-breaks
because Swift's sort is unstable and V8's is not. Re-reading them, three already end in a unique
`seed` or rank comparison, so they are total orders and an added tie-break would be dead code. Only
one genuinely needs it: Berger's board sort keys on a bye flag, so every non-bye board ties, and
without the offset the boards would come out in an arbitrary order. That one has it, with the reason
written next to it.

**Also corrected:** the plan said to build an `AppLogo`. `HomeLogo(size:)` already exists and does
exactly what spec 1.2–1.4 describe — circular, gold `strokeBorder`, glow applied after the clip.

Gate: **26,726 assertions across 42 suites**, **110/110 mutants**, 89 Swift files structurally sound.

**Still to come:** the SwiftUI screens and `PairingDocument.swift`, and the FIDE golden. The status
table in `docs/pairing-manager.md` tracks them.

### 2026-08-11 (added) — Pairing Manager: the three browser screens, and it is reachable at last

The feature existed only in Node: `index.html` had no pairing script tag at all, so none of the
engine, metrics or store work was visible to anyone. It is now a working screen you can click from
the Home tile.

**Added**
- **`web-demo/js/pairing-{list,create,detail}.js`** — Tournament List, Create, and Detail with
  Players / Rounds / Standings, four modals (Add Player, Bulk Add, Enter Result, **Clear Result**)
  and plain-text share. Stateless about data: every mutation goes through the store and the screen
  repaints from the document.
- **`web-demo/css/pairing.css`** — its own stylesheet. Every value is a `var(--pg…)` pushed from
  the extraction; the polish layer mirrors `--pzx-*` without touching an extracted value.
- **`tools/qa/pairing_screen_test.js`** — 120 assertions rendering all three screens into a headless
  DOM, including a full click-through: create → bulk add → generate → enter → clear → share.
- **`MET.applyAll`** — a mechanical CSS-var pusher. Hand-writing one `set()` per value would be 748
  lines and 748 chances to omit one silently, so a whole block converts to
  `--<prefix>-<block>-<prop>`. Nothing can be forgotten because nothing is chosen.
- Ten screen mutants. **110/110 killed.**

**Fixed** — the screen-level §7 defects: #14 rank-1 gold on screen as well as in the share image ·
#15 the seed chip shows `player.seed` · #18 delete confirms before mutating · #19 an empty state for
a deleted tournament · #20 an exhaustive result badge · #21 local-calendar dates · #22 no URL in the
share text.

**Three things the checks caught that review had not:**
- The `--pg` audit rejected three vars I had invented. The gap between the two players on a pairing
  row is on `pairingPlayer`, not `pairingPlayers`; `standingsPts` inherits its size from
  `standingsVal`; and the **standings column widths are inline styles**, which the block walker
  cannot see — `standingsVal.width` is 42 for every column, wrong for five of the six. They are now
  extracted from `inlineStyles` and asserted there.
- The seed mutant **survived**, and it was right to. While the players list is in seed order with
  dense seeds, the row index and the seed are the same number, so fix #15 was unobservable. The list
  now sorts by score once play starts — which is what the RN screen did, and the situation the bug
  actually shipped in — and the mutant dies.
- Two more survivors were unfalsifiable rather than uncovered, and are documented as such: sorting a
  freshly-parsed array in place changes nothing, and the blank-name path is guarded twice
  independently. The second pointed at a real hole — the store's own guard had no test — so that is
  what is mutated now.

Gate: **25,695 assertions across 41 suites**, **110/110 mutants killed**.
**Still to come:** the Swift half (`PairingMetrics.swift`, `PairingEngine.swift`,
`replay_pairing.js`, the SwiftUI screens) and the FIDE published-example golden. The status table in
`docs/pairing-manager.md` tracks it.

### 2026-08-11 (added) — Pairing Manager: style extraction, metrics layer, document store

The second slice of Book Two Phase 1. The engine landed earlier today; this is everything the
screens will stand on. **No screens yet** — see the status table in `docs/pairing-manager.md`.

**Added**
- **`tools/metrics/extract_tournament_styles.js`** — third AST extractor, over the three real RN
  tournament screens. 196 style blocks / 748 properties, **zero unresolved**. Two new capabilities:
  two StyleSheets per file (`[id].tsx` has `styles` + `shareStyles`), and a colour-map walker. The
  latter closed a real hole — `getTypeColor`/`getStatusColor` are pure condition-to-literal maps
  that the style-oriented walker returns `{}` for, so the six colours behind every badge and status
  dot would have been the only hand-typed numbers in the feature.
- **`web-demo/js/pairing-metrics.js`** — 17 behavioural + 1,196 source assertions. The style blocks
  were generated from the extraction rather than retyped, and `selfTestSource()` compares every
  property back to the JSON on each run.
- **`web-demo/js/pairing-store.js`** — the document: create/delete, players with stable dense seeds,
  bulk add, generation, results, computed status, standings. 67 assertions, 9 mutants.

**Fixed** — §7 defects now answered in the store, each with a mutant that must die: #1 duplicate
seeds after removal · #7 bye on board 1 from round 2 · #12 bye points awarded after the tie-break
pass · #17 results editable after `finished` · #23 no way to clear a result.

**Also fixed, found by writing the tests rather than by review** — my own first version of the
finished-lock guard read `status === FINISHED && result === PENDING`, which is **dead code**:
finished means zero pending boards, so it could never fire. It looked like a lock and locked
nothing. Replaced with a real rule, and the deviation it forces is documented — a literal
"results are locked" cannot coexist with Clear Result, since finishing is *caused* by the last
result being entered.

**Deviations** (`PORTING_NOTES.md`): SwiftData `@Model` becomes plain `Codable` (there is no
SwiftData in this repo and a `ModelContainer` is unreachable from every harness here); the
finished-lock exception above; aggregates recomputed rather than patched.

Gate: **25,553 assertions across 40 suites**, **101/101 mutants killed**. `web-demo/` gained the two
new pure modules; no screen is wired to them yet.

### 2026-08-11 (added) — Pairing engine: FIDE Dutch Swiss, Berger round robin, tie-breaks

First piece of Book Two. `web-demo/js/pairing-engine.js` is a pure, dependency-free pairing engine
covering spec 1.7–1.9, and `tools/qa/pairing_test.js` (1,560 assertions) is its proof. Wired into
`js_goldens.js`; ten mutants added to the mutation suite.

**Added**
- **`web-demo/js/pairing-engine.js`** — colour preference (absolute/strong/mild/none), the pairing
  ranking (deliberately *not* the standings order), bye assignment, score brackets with downfloat
  bookkeeping, minimum-cost matching, Berger round-robin schedules, and the four tie-breaks
  (Buchholz, Buchholz Cut-1, Sonneborn-Berger, direct encounter) behind one exported comparator.
- **`tools/qa/pairing_test.js`** — property tests over whole simulated tournaments (5/6/7/12/30
  players × four result patterns), not one worked example.

**Fixed** — the four shipping-server bugs the spec names, each now a mutant that must die:
- **The silent repeat pairing** (`TournamentController.php:558`, `$bestMatch = $unpaired[0]`). A
  rematch is now the last resort *and* always carries a `repeatPairing` warning.
- **Round-robin colours alternating on board 1 only** (line 658) — gave one player White in all six
  games of a 7-player event. Colours are now assigned by a balancing pass over the Berger schedule.
- **`hasRatings` true when a single entrant is rated** (line 422, `->count() > 0`) — now ≥ 50 %.
- **No float bookkeeping at all** — the engine now prices a repeat downfloat above a point of score
  difference, so it pairs slightly out of bracket rather than float the same player twice running.

**Also fixed, found by the mutation suite rather than by review** — five mutants survived the first
run, and each was a real hole: the repeat-pairing warning was never exercised (six players over five
rounds is a *complete* round robin, so no repeat is ever forced — it now runs seven), the floater
filter's two-round lookback was untested, the cost ladder's ordering was untestable at tournament
granularity, and Buchholz counted undecided games. 92/92 mutants now killed.

**Not** mirrored into a UI yet — this change is engine + tests only. The Pairing Manager screens
(web-demo and SwiftUI) are the next step. Swift twin not yet written; see `docs/pairing-engine.md`.

### 2026-08-11 (fix) — no puzzle mode ever accepted a move, and UI polish

The user could not move a piece on any puzzle screen. The cause is older than it looks: **no puzzle
mode has accepted a move since Phase B.** Five modes, seven phases, 22,690 green assertions, and
the feature was unplayable.

**Fixed — the rules adapter spoke names where the board speaks indices.**
`<chess-board>` uses square indices (`e2` is `12`), and so does the engine. The puzzle adapter did
the opposite on every count:

```js
var from = E.sqIndex(sq);                 // sq is ALREADY an index; E.sqIndex(12) === null
E.legalMoves(pos).filter(m => m.from === from)   // === null, so ALWAYS []
  .map(m => ({ to: E.sqName(m.to) }));    // NAMES, where the board compares indices
```

Every square reported zero legal targets, which is exactly "you cannot pick up or tap a piece."
It now matches `analysis.js`'s adapter, which has always worked — one convention, demonstrated by a
screen known to be good, rather than a third invention.

**Fixed — the move event was handed straight to the session.** The board's `move` carries indices
and a numeric promotion kind; `PuzzleSession.submit` takes square names and a letter, because it
builds a UCI **by string concatenation** — so `12 + 28` was evaluated as arithmetic and every move
was illegal. A single `moveFromEvent` now converts at the boundary.

Both bugs existed **twice**: `puzzle-solver.js` carried its own copy of the adapter and the
listener. It now uses the shared ones, so fixing one cannot leave the other broken again.

#### Why 22,690 assertions missed it

`board_component_test.js` drove the board with its **own** correct adapter. `puzzle_screen_test.js`
rendered the screens and then called `solver.submit('e2','e4')` **directly with names**, skipping
the board entirely — its `<chess-board>` is a stub, and the file says so. Two green suites, one
dead feature, and nothing anywhere drove a move the way a person does.

**Added the missing path** to `board_component_test.js`, which is where the real component lives:
pointer → board → adapter → `move` event → conversion → `PuzzleSession`. Tap-tap and drag, plus a
wrong move (which must arrive as *wrong*, not *illegal* — otherwise a mistake would silently cost
nothing) and a run through the factory's own listener. 149 → 164 assertions.

Reverting either bug now produces nine self-explaining failures, the first being **"tapping the
piece selects it"** — the user's exact symptom. Two mutants pin them: **83/83 killed.**

**Fixed — the same gap in the Swift, in mirror image.** `PuzzleBoardBand` shipped with
`selected: nil`, `legalTargets: []`, `onTap: { _ in }` and `lastMove: nil`: drag worked, but
tap-to-move did nothing, no legal-move dots appeared and the last move was never highlighted. On a
phone that is the main way people move. `PuzzleSolverEngine` gained `selected`, `legalTargets` and
`tap(_:)`, following `ChessGameVM.tap`, and the selection clears on mount, retry and every submit
so a stale ring cannot submit from a square whose piece has moved. `replay_puzzle_vm.js` asserts
all of it — 109 → 117.

#### UI polish — nothing extracted was touched

Every colour, size, radius and spacing still comes from `puzzle_styles.json`; all ~1,000 parity
assertions stay green. What was added is what the RN StyleSheets cannot carry, in a separate
`--pzx-*` namespace so the extracted properties stay clearly extracted:

- **Press feedback on all 22 buttons and cards**, finally reading `PuzzleHub.pressOpacity` — an
  extracted value that had sat unused since Phase C. Cards take a gentler squeeze than buttons.
- **Hover** on pointer devices only, **`:focus-visible` rings** for keyboards.
- **Entrances** — screens rise, overlays fade, dialogs and result numbers pop; run-history rows
  stagger so a list reads as filling rather than repainting.
- **Depth** — modals and overlays now sit above cards instead of sharing one plane.
- **Larger touch targets** on the strip and tab buttons, raising only the hit area and never the
  painted box.
- **`prefers-reduced-motion`** honoured throughout. Not optional: all of the above is decoration.

Mirrored into Swift as `PuzzlePressStyle`, applied to all 22 buttons.

**One planned item was dropped on inspection.** The plan called for a loading state, and the
`--pz-loading-*` properties were to come back for it. Serving is synchronous from the bundled
corpus, so that state cannot occur — building it would be inventing UI for something the user can
never see, which is the same argument that removed those properties in Phase F.

Gate: **22,713 assertions across 36 suites** · 83/83 mutants · 164 board assertions · 117 screen
decisions · lint clean on 84 files · 1,909 member references resolve.

**Still unverified in a browser by me** — the Chrome I can reach runs on a different machine and
cannot see this checkout. Open `web-demo/index.html`, go to Puzzles → Play Puzzles, and move a
piece; then the other four modes.

### 2026-08-11 (feature) — Puzzle Hub, Phase G complete: the app runs the hub

The last nine SwiftUI screens, the shell rewiring, and both safety nets. All five modes are now
reachable and playable in the iOS app, and every Core engine has a consumer.

**Added — the nine remaining screens.** `PuzzlePlayScreens` (stats home with sparkline, activity
bars and theme rows; the rated solver with its clock, Elo delta, engine panel and Save sheet),
`PuzzleDailyScreens`, `PuzzleThematicScreens`, `PuzzleStreakScreens` and `PuzzleTurboScreens`.
Plus `PuzzleBottomPanel`, `PuzzleEnginePanelView` and `PuzzleModal` in the shared parts.

Every screen **asks** the shared derivations rather than restating them:
`PuzzleDisplay.bottomPanel` decides which buttons appear from the mode's own `WRONG_POLICY`,
`hasEnginePanel` and `hasSaveSheet` come from what the extraction actually carries, and the Turbo
advance delay travels with the wrong-move outcome instead of being written down a second time.
No numeric literal or arithmetic appears in any view body.

**Fixed — 61 strings existed in one language only.** Every Streak and Turbo string went into the JS
twin in Phase E and never into `PuzzleStrings`: 138 keys in JS against 86 in Swift. The screens
could not be written without them and nothing would have noticed, because no check compared the
tables. They are ported now — generated from the JS rather than retyped — and
`replay_puzzle_core.js` asserts **key parity in both directions**, plus that a Swift `func` is a JS
function and vice versa, so one language cannot hard-code what the other computes.

That check immediately earned itself twice: it found two Swift-only strings I had added
(`promotionTitle`, `hubHeroGlyph`), and the hero glyph was **wrong** — I had a puzzle piece where
the JS twin has a knight. The source draws a knight *image*, so the glyph is the stand-in and both
now agree.

**Fixed — eight colour constants existed only in JS** (`modalBorderColor`, `tabBestSelectedColor`,
`countBadgeFill` and five more). The replay checks numeric keys, which is precisely why only the
colours slipped through.

**Changed — `AnalysisSession.engineRows` is now also a static.** The puzzle suggestions panel is
the *same* panel — eval, SAN, PV preview — and duplicating six lines of formatting would have meant
two places to get `pvPreview` and `displayText` right.

**Changed — the shell.** `PhoneApp`'s Puzzles tab and `AppShell`'s sidebar entry both open
`PuzzleHubScreen`. `ProfilePhone` reads `PuzzleHubStore`, so the profile no longer shows a rating
from a screen the user cannot reach. The ten hand-made samples survive at a labelled
**Dev · Sample Puzzles** panel — they use the opposite move convention, so they were never going to
share this solver. `PuzzlesPhone` and its view model were deleted rather than left unreachable.

#### The two safety nets, and what they caught

**`PuzzleMetricsCheck`** (`swift run PuzzleMetricsCheck`) asserts the **derived** layer — the bottom
panel, the info strip, both clock formatters, the four Turbo bands, the feedback dot's signed
geometry with real numbers, the sound tables and the two promotion dialogs. It deliberately does
*not* re-check the ~1,000 raw constants: `replay_puzzle_core.js` already compares those, and a
second copy would be a second chance to be wrong.

**`tools/qa/replay_puzzle_vm.js`** — 109 assertions reading the screens' *branches* and replaying
them against the JS twin. Streak's silence on a solve, the anti-reroll lock being read **before**
anything is served, `bestBefore` captured at run start, Turbo's single idempotent exit, out-of-lives
beating the clock, the infinite/timed split on leaving, Thematic never touching Elo, and no screen
reaching past the store to the pool.

**`swift_symbol_check.js` gained a type check.** The member check cannot see
`PuzzleFooScreen(store:)` when the type does not exist at all — no namespace to look inside — which
is the dominant hazard when nine screens reference each other. It now flags undeclared `Puzzle*` and
`Analysis*` constructors, and listed exactly the eight screens still to write.

#### A harness bug that was reporting kills that never happened

Adding Swift to the mutation suite meant resolving two directories. The per-mutant restore still
said `JS`, so every Swift mutant was written into `web-demo/js/` as a stray `.swift` file while the
real file **kept its mutation**. Four unrelated mutants then "died" of the same leaked edit, all
reporting an identical failure — which is what gave it away. A restore that restores the wrong file
is worse than no restore.

Fixed, strays deleted, and one genuine survivor surfaced once the run was honest: mutating the lock
guard to `if false` kept the text order intact, so the positional check passed. The replay now
asserts the **condition**, not just the ordering.

**81/81 mutants killed**, each with its own distinct failure.

Gate: **22,690 assertions across 36 suites** · lint clean on 84 files · **1,906 member references
and 94 project types resolve** · 1,074 metrics references · 124 corpus assertions.

**Nothing here was compiled.** This checkout has no Swift toolchain. On a Mac the remaining steps
are `swift build`, `swift run ParityRunner`, `swift run PuzzleMetricsCheck`, `swift run
PieceArtCheck`, then `cd ios && xcodegen generate`.

### 2026-08-11 (feature) — Puzzle Hub, Phase G part 1: the promotion dialogs, and the Core gets a consumer

Phase G is the SwiftUI half. This entry covers the bug fixes and the foundation; the remaining
screens are listed at the end and are **not** written yet.

**Fixed — two promotion dialogs were being treated as one, in both languages.** The Analysis Board
and the puzzle hub each have their own in the RN source, and **every extracted property differs**:

| | Analysis (`board.tsx`) | Puzzle hub |
|---|---|---|
| scrim | 0.7 | 0.80 / 0.82 |
| card | `#37474F` r16 p20, no width | `#1A2942` r20 p24 w280 |
| title | 16pt `#ECEFF1` "Promote to:" | 18pt `#FFFFFF` centred "Choose Promotion" |
| options | row of 60pt unlabelled tiles `#455A64` | column of labelled accent rows |

Swift's `PromotionOverlay` was hand-typed to roughly the Analysis design — 46pt tiles where the
source has 60, radius 8 where it has 12, no title at all — while `PuzzlePromotion` sat unread in
the metrics file. The web `<chess-board>` had the same problem. Both are now extracted: a new
`AnalysisPromotion` namespace, a corrected `PromotionOverlay`, a separate `PuzzlePromotionOverlay`,
and a `promotionLayout` property on `<chess-board>` (`'row'` default, `'list'` for the hub) so the
two designs stay two designs. Collapsing them would have silently restyled whichever screen lost.

**The `KNOWN_UNREAD` allowlist is now empty.** Thirteen entries at the end of Phase E, seven after
Phase F, zero now. Every `--pz*` property the stylesheet reads is written, and every one written is
read. All nine promotion properties route through one `PuzzleMetrics.applyPromotion` instead of
five partial copies — three screens had been setting five of the nine and two all nine.

**Fixed — `PuzzleHaptics` duplicated `Haptics.Kind.pickUp`.** I added it in Phase F without noticing
`Haptics.swift` already ports the same `DragDropChessBoard.tsx:351` decision, comment and all. Two
sources of truth for one fact. Deleted; the views call `Haptics.play(.pickUp)`.

**Added — `PuzzleHubStore`, the consumer five Core engines never had.** `PuzzleProgress`,
`TurboRun`, `PuzzleStats`, `DailyGoal` and `PuzzleServing` were all written, pinned against PHP
goldens, and called by nothing — the same failure that hid the dead `StreakEngine.increment` in
Phase D, at the scale of a whole feature. The store holds `PuzzleProgressState`, owns the
`SQLitePuzzlePool`, persists to Application Support as JSON, and every `serve*` **serves, commits
`seen` and writes in one step** so no caller can forget the middle one.

**Added — `PuzzleHubScreen` and the daily-goal ring**, plus `PuzzleSolverParts`: the shared solver
engine (mount → submit → opponent reply → finish, with every continuation cancellable) and the
shared header and board band. `BoardView` needed no change — Streak's two-tone reveal goes through
its existing `customHighlights`.

#### Two tooling gaps, both found the hard way

**`swift_lint.js` gave a false green.** Run with an explicit file list it only loads those files, so
its ACCESS rule — "public signature names an internal type" — sees no other declarations and
passes everything. It reported a clean bill on `PuzzleHubStore` while eight `public func`s returned
the internal `PuzzleStore.Puzzle`, all hard compile errors; the full run found every one. The
narrowed mode now prints a DEGRADED warning.

**Added `tools/qa/swift_symbol_check.js`.** `swift` is not on PATH here, so a view reading
`PuzzleHub.cardTextGap` when the constant is `cardGap` is invisible until a Mac. Bracket matching
does not catch it and neither does the StyleSheet-key check. This resolves every
`Namespace.member` reference against the declarations. It found **19 real errors** in the first two
files written this phase — including `DailyGoal.Status` (really `PuzzleProgress.GoalStatus`) and
five session transitions I had written as static functions when they are mutating methods on
`State` taking square *names*, not indices. It builds its table from the whole tree even when
narrowed, which is exactly the trap `swift_lint.js` fell into. Across the existing codebase all
**1,151** references resolve, so it is calibrated, not noisy.

Gate: **22,574 assertions across 35 suites**, 74/74 mutants, 149 board assertions, 991 Swift
constants replayed, `swift_lint.js` clean on 77 files.

#### Not done — the rest of Phase G

Nine screens (Play home/solver, Daily home/solver, Thematic grid/solver, Streak home/solver, Turbo
select/run), the `PhoneApp`/`AppShell` rewiring, `ProfilePhone` repointing, `PuzzleMetricsCheck`
and `tools/qa/replay_puzzle_vm.js`. The Puzzles tab still shows the old ten-sample view, and
`PuzzleHubScreen` references those nine screen types — so **`DemoApp` and `ios/` will not build
until they exist.** Everything landed here is lint-clean and symbol-checked; none of it is
compiled, because this checkout has no Swift toolchain.

### 2026-08-11 (fix) — Puzzle Hub, Phase F: the sound layer was never connected

Phase F was scoped as a sweep. It turned out the sound layer had never been wired to the puzzle
hub at all, and the reason it went unnoticed for four phases is the interesting part.

**Fixed — no puzzle screen had ever made a sound.** All five did
`var SND = (typeof Sound !== 'undefined') ? Sound : null;`. The global `sound.js` exports is
**`SoundManager`**; `Sound` has never existed. `analysis.js` and `app.js` get it right; the hub
never did. So `SND` was permanently `null` and every `play()` written in phases B–E was a no-op —
through a feature with 22,000 passing assertions.

Nothing caught it because every test asserted that the sound *code runs*. It did run; it ran into
a null. The new assertions are deliberately end-to-end — patch the real player, drive a real
screen, require that a sound comes out the other side — and there is a mutant that reverts the
global's name and **must** be killed. If that one ever survives, the tests have gone back to
checking that sound code executes.

**Fixed — Turbo asked for a sound that does not exist.** `play('puzzle-correct')` is in neither
the four-key RN vocabulary nor the six bundled mp3s, and `SoundManager.play` returns silently on a
miss, so it was a no-op that *looked* deliberate. The source plays nothing extra on a Turbo solve:
its only `gameOver` is in `endGame()`. Removed.

**Two things I expected to be bugs were correct, and are now pinned so nobody "fixes" them.**
`PuzzleSession` emits only `capture`/`move` and never `check` or `castling` — `usePuzzleSound.ts`
loads exactly four sounds and `playMoveSound` is capture-or-move, so the richer chain belongs to
the Play screen's `SoundManager`, not the hub. And all three solve chimes (Play, Daily, Thematic)
were already in the right branch; an early grep of mine said otherwise and was wrong.

**Added — sounds and timings are now EXTRACTED, not typed.** This is the change that matters more
than any single fix. `TIMING` and every sound name were the last hand-written values in the port,
in a project whose central rule is *extract, don't transcribe* — and the sound names were wrong in
three places precisely because nothing compared them to anything.

`tools/metrics/rn_ast.js` gained `collectSoundCalls`, `collectDelays` and `collectSoundHook`;
`puzzle_styles.json` now carries every `playSound`/`playMoveSound` call **with the function it sits
in** (so "on solve" versus "on run end" is recoverable rather than remembered) and every
`setTimeout`/`setInterval` delay. A new `SOUNDS` namespace in both languages is asserted against
that, and all seven `TIMING` values are checked against the call site that actually schedules them
— the opponent reply against the `setTimeout` that schedules the opponent, and so on. All seven
were already correct; now they are held there.

One trap on the way: matching only *numeric* delays silently dropped Streak entirely, because it
names its constant (`COMPUTER_MOVE_DELAY`). Named delays are resolved against the file's module
constants, and one that cannot be resolved is fatal rather than skipped — a missing delay is
invisible downstream, which is the failure mode the extraction exists to end.

**Added — the pickup haptic.** `DragDropChessBoard.tsx:351` fires one
`Haptics.impactAsync(.Light)` when the user picks up a piece, after three guards: the square holds
a piece, it belongs to the side to move, and it passes the colour filter. `_targetsFrom()` is those
three conditions rolled into one, so the trigger transfers exactly. It fires on **pickup**, never
on drop and never on a right or wrong answer. `navigator.vibrate` in `web-demo/` (a genuine no-op
on desktop and iOS Safari — the call site is the point), and a `PuzzleHaptics` seam in
`BiyaherongUI` so Phase G's views have somewhere defined to call.

**Changed — matching your best now shows 🏆 NEW BEST.** `endStreakRun` compares with `>=`, not
`>`. The RN screen ends a run on `currentStreak >= bestStreak`; its `>=` was compensating for the
server bumping the row mid-run, and `bestBefore` removes the need for that compensation — but the
user-visible rule, that equalling your record is celebrated, is the app's behaviour and is kept.

A consequence worth recording: with `>=`, reading the live `bestStreak` instead of `bestBefore`
becomes **provably equivalent** (`length >= max(b, length)` is true exactly when `length >= b`), so
that mutant was removed rather than left as a false coverage hole. `bestBefore` is kept anyway,
because it does not depend on `increment` raising the best to exactly that maximum.

**Changed — six dead CSS custom properties removed.** Each was computed from the extraction and
written to a property nothing read: the goal ring already hands its track colour straight to the
SVG `stroke` attribute; the banner styles itself from per-state fills, not the bare palette pair;
no screen renders a loading state, because every mode serves synchronously from the bundled corpus;
and the thematic feedback row is one line, so its gap never applies. The extracted numbers stay
asserted in the metrics layer — only the dead wiring went. The allowlist is down from thirteen to
the seven the promotion dialog owns, which **Phase G** closes when it rebuilds that dialog.

**Fixed — a vacuous assertion in the new haptic test.** It stubbed `global.navigator`, but
`<chess-board>` runs inside a `vm` sandbox and reads the sandbox's. The negative case ("an empty
square does not buzz") was passing because nothing could buzz at all. Stubbed on the sandbox now.

**Tests.** `puzzle_screen_test.js` 426 → 455, `board_component_test.js` 142 → 149,
`PuzzleMetricsSource` 430 → 498. Eleven new mutants covering the sound wiring, the four-key
vocabulary, the per-mode chime table, each extracted delay and the haptic trigger — **74/74
killed**, including the one that reverts the global's name.

Gate: **22,574 assertions across 35 suites**, `swift_lint.js` clean on 74 files,
`board_styles.json` still regenerates byte-identical.

`web-demo/` updated — every mode is audible for the first time. The Swift **views** remain Phase G.

### 2026-08-11 (feature) — Puzzle Hub, Phase E: Puzzle Streak and Puzzle Turbo

The last two modes. All five are now live in `web-demo/`, on the same solver factory and the same
extracted-metrics layer. Two real bugs fell out along the way, both found by tests rather than by
anything visibly breaking.

**Added — `TurboRun`, the run engine** (`Sources/BiyaherongCoachCore/TurboRun.swift` +
`web-demo/js/turbo-run.js`, 82 assertions). `PuzzleRush` held `modes`, `bestScore` and `modeLabel`
and nothing else, so the whole of Part 14.2 — three lives *across* puzzles, the running target
rating, the score, the reason a run ended — existed in neither language. `PuzzleSession` could not
hold it: it is a per-puzzle machine and a new one is built for every puzzle, so its `mistakes`
counter resets each time.

Every constant comes from `puzzle_styles.json`, and two of them read wrong from memory: the warmup
is **5** puzzles where `StreakEngine`'s is 10, and a wrong answer still moves the target **up**, by
10. It is a rush — it gets harder whatever you do, just more slowly when you miss.

The clock is deliberately *not* accumulated from ticks. `secondsLeft(state, now)` derives the number
from `startedAt`, so a delayed or dropped tick cannot make it drift; the interval only repaints.
`formatClock` prints `3:00` with the minutes unpadded, and is separate from
`PuzzleDisplay.formatTime`'s padded `03:00` on purpose — one function would silently change one of
the two screens.

**Added — Puzzle Streak** (Part 13), home and solver. The 46pt display, three stat cards, and
**Recent Runs** where the leaderboard was. The resume modal only appears when a run is actually
live. On failure: the result overlay, then "💡 Show Solution", which hides the overlay entirely,
highlights the answer on the board and prints it as `E2 → E4` (with ` (=Q)` when the UCI promotes).
A correct solve plays **no sound** — in a streak the reward is the next puzzle.

**Added — Puzzle Turbo** (Part 14), mode select and run. Three tabs each carrying their own best,
Recent Runs filtered by the selected tab, and a start button in the selected mode's colour (the
source sets that inline, which is why the extraction shows no `backgroundColor` on it). The run has
the four-band clock, three life dots, and the ✓/✕ feedback dot built from the extracted **signed**
terms — `left` subtracts its radius term, `top` adds its own, and the board flip is asymmetric
(the file mirrors for Black, the rank does not).

**Fixed — the 🏆 NEW BEST badge could never appear.** `endStreakRun` compared the finished run
against `state.streak.bestStreak`, but `StreakEngine.increment` raises that value on every solve
*during* the run. By the time the run ended it had already been beaten by itself, so `isNewBest`
was unreachable-false. `endStreakRun` now **requires** a `bestBefore` argument — the best as it
stood when the run started — and throws without it, in both languages. My own earlier test had
codified the wrong behaviour; that assertion is flipped.

**Fixed — the Turbo clock would never have started on a resumed run.** `served()` guarded on
`startedAt == nil && puzzlesServed == 1`. The second clause is redundant on a fresh run and wrong on
a resumed one, where `puzzlesServed` picks up mid-count. It changed nothing today only because
resume is infinite-only — it was a trap armed for whoever extended resume to a timed mode. Found by
the mutation suite: the mutant that *removed* the clause survived, which is the suite telling you
the clause does nothing. Now `startedAt == nil` alone, in both languages.

**Changed — `<chess-board>` gained `highlightSolution(from, to)`**, additive, with
`--hl-sol-from` / `--hl-sol-to`. `highlightLastMove` puts one class on both squares from a single
custom property, and Part 13.3's reveal needs two tints so the move reads as a direction.
`board_component_test.js` is the regression check and went 133 → 142.

**Changed — `puzzle-board.js` exposes `schedule(fn, ms)`.** Turbo's 500 ms advance is returned in
the wrong-move outcome but scheduled by the screen; a screen-owned `setTimeout` would survive
`destroy()` and mount a puzzle behind the results overlay.

**Changed — a scoreless rush run no longer writes a history row**, matching the rule
`endStreakRun` already applied to a zero-length streak. An instant quit was polluting the last-ten
list on the mode-select screen.

**Changed — Turbo moved off the `pzt-` CSS prefix** to `pzr-` / `pzrr-`. Thematic already owned
`pzt-`, so `.pzt-title`, `.pzt-card` and `.pzt-start` would have been shared between two unrelated
screens.

**Added — a CSS custom-property coverage check**, in `puzzle_screen_test.js`. There is no
compiler and no browser in this gate, so a `var(--pzk-typo)` with no setter is invisible: it
resolves to nothing and the rule silently falls back to the initial value, which means a screen can
look finished and be laid out entirely by accident. It checks both directions across the `--pz*`
namespace — an unset var is a hole, an unread setter is drift left behind by a rename. It found
eighteen unread setters on its first run, none of them mine.

**Fixed — the promotion dialog ignored the extraction entirely.** `puzzle-solver.js` computed all
nine `--pz-promo-*` properties from `puzzle_styles.json` and `<chess-board>`'s shadow CSS read
none of them, hardcoding its own scrim, radius and padding. So Phase D's fix for the two scrims
(0.80 for Play/Daily/Thematic, **0.82** for Streak and Turbo) was asserted in the metrics layer and
never reached a pixel — and the two modes shipping in this phase are exactly the two it was for.
The shadow CSS now reads the five properties that map onto its structure, with the standalone look
as fallbacks so Play and the Analysis Board are unchanged. The remaining eight are listed by name in
the new check: closing them needs the dialog rebuilt to the extracted layout, which is Phase F.

**Fixed — `TurboRun`'s suite was not in the gate.** It was reachable only from the mutation
harness, so `js_goldens.js` could have gone green with the whole of Part 14.2 broken. Now
registered.

**Tests.** `puzzle_screen_test.js` 178 → 422, covering all nine web-demo screens, and it now brings
forward two Part 22 acceptance checks: **no hostname, `fetch`, `XMLHttpRequest`, `WebSocket` or
`EventSource` anywhere in the feature's seventeen files** — checked rather than assumed, because
the RN source this was ported from really does call chess.com — and **no prefetch buffer**
(`BUFFER_MAX` and friends are in `turboRun`'s constants and must not reach a screen; Turbo keeps one
lookahead). Sixteen new mutants, aimed at the parts that read wrong at a glance: the `+10` on a
miss, the 5-puzzle warmup, the 2500 ceiling, the three lives, the dot's two signs, the four clock
bands, the tie between "out of lives" and "time up", and `end()`'s idempotence. **63/63 killed.**
`replay_puzzle_core.js` 745 → 991 Swift constants checked against the JS.

Gate: **22,468 assertions across 35 suites**, `swift_lint.js` clean on 74 files.

`web-demo/` updated — Streak and Turbo are both reachable from the Hub. The Swift **views** are
still Phase G; the presentation layer they will consume is written and replay-checked.

### 2026-08-11 (feature) — Puzzle Hub, Phase D: Daily Puzzle and Thematic, and four latent bugs

Two more modes live in `web-demo/`, and the shared solver plumbing they sit on. Before any of that,
six gaps that phases B and C had left behind — found by reading the layers back rather than by
anything failing.

**Four latent bugs in what B and C shipped.**

- **Fixed** — **the bottom panel offered Streak and Turbo a Retry that their own policy forbids.**
  `bottomPanel(phase)` was written for Play and returned Retry / Solution / Next on `failed` for
  every mode, while `WRONG_POLICY.streak.offersRetry` and `.turbo.offersRetry` are both `false`.
  Two sources of truth for one fact, and the wrong one was the visible one. It now takes the mode
  and **derives** the row from the policy, so they cannot drift again — plus `hasEnginePanel` and
  `hasSaveSheet`, because the extraction shows only `playSolver` and `thematicSolver` have
  `enginePanel*` keys and only `playSolver` has `savePuzzle*`. Offering those buttons elsewhere
  would have been inventing UI.
- **Fixed** — **one promotion scrim where the source has two.** Part 2 keeps them deliberately
  distinct: Play/Daily/Thematic dim to 0.80, Streak and Turbo to 0.82. One value was encoded and
  the other survived only in a comment.
- **Fixed** — **`RushEndReason` was a free string in JS.** Swift has an enum, so a typo there is a
  compile error; `'timesUp'` for `'timeUp'` would have passed silently here and reached the results
  screen. Enumerated and gated.
- **Fixed** — **`rushBest` was keyed by number in JS and by `String` in Swift.** JSON object keys
  are strings, so a numeric key round-tripped to a string and the two languages disagreed about
  whether `rushBest[3]` and `rushBest["3"]` were the same slot.

**Two gaps where the code existed but nothing joined it.**

- **Added** — **`web-demo/js/streak-engine.js`**, the twin of `Streak.swift`, which had none. That
  is why nobody noticed that **`StreakEngine.increment` was dead code**: nothing called it, so
  `currentStreak` was only ever written back to zero and `puzzleRating` never ramped at all. Both
  halves are wired now, with `PuzzleProgress.recordStreakSolve` as the single caller. 38 assertions,
  including the deliberate difficulty cliff — the ramp runs from puzzle #1 *through* the ten-puzzle
  warmup, so the moment warmup ends the target is already 600 + 10×50 = 1100.
- **Fixed** — **the anti-reroll lock had no writer and no reader.** `pendingPuzzleId` appeared
  exactly twice in the whole JS tree: the seed, and the clear. Part 22.6 makes it an acceptance
  criterion — leaving the Streak screen and returning must hand back the *identical* puzzle, or a
  hard one can be rerolled by backing out. `lockStreakPuzzle` / `pendingStreakPuzzle` now exist in
  both languages, and the round-trip is asserted.
- **Fixed** — **Streak and Thematic solves credited nothing toward the daily goal.**
  `countsTowardDailyGoal` returned `true` for both, but `recordSolve` was only ever reached from the
  rated and daily paths. Two of the four modes Part 15.1 counts were silently not counting.
- **Added** — run-history selectors (`recentStreakRuns`, `recentRushRuns`, `rushBestFor`) in both
  languages. Both home screens replace a leaderboard with the user's own last ten runs and nothing
  could read them.

**The two new modes.**

- **Added** — **`web-demo/js/puzzle-board.js`**, the plumbing every solver shares, as a **factory**.
  `puzzle-solver.js` was an IIFE with twelve module-level variables: fine for one screen, wrong for
  five, since two solvers alive at once would share `session`, `timers` and `engineToken`. The
  factory owns the board, the rules adapter, the mount sequence, the submit pump and the engine;
  the host supplies its own chrome, which is what genuinely differs between the modes and why the
  RN source has four separate solver files.
- **Added** — **Daily Puzzle** (Part 11): home with the hero, two stat cards, the How-it-works card
  and a CTA that swaps for the solved card once today is done; solver with the theme summary, the
  feedback banner (wrong auto-hides after 1300 ms, solved does not — it is the end state), the
  instruction line and the Done button. The hero subtitle now reads **"always offline"**; the
  original said "powered by Chess.com", which stopped being true when the deterministic local pool
  replaced the API.
- **Added** — **Thematic** (Part 12): the 3×4 grid, selection toggling, `Start {label} Puzzles`, and
  a solver with one stat, a hint line, the feedback block and the engine panel at **3** lines where
  Play shows 2. The premium gate, the lock overlay and the upgrade modal are deleted — and the
  metrics suite asserts the lock overlay *was* in the source, so the removal stays a recorded
  decision rather than something nobody noticed. **Thematic never touches Elo**: the screen is
  asserted not to call `recordRatedAttempt`, and `recordThematicAttempt` is the only sink.
- **Changed** — the tab shell routes all four new screens, and leaving any of them cancels its
  timers and abandons its search through **one registry** rather than a growing `if` chain. That
  chain is how the tab bar came to cancel only the rated solver.

**Verification.** 21,842 assertions across 34 suites; **47/47 mutants killed** (up from 35), and the
metrics layer now carries **430** source assertions against the extracted StyleSheets and **737**
Swift-vs-JS expectations.

Two of those numbers moved because the tooling was wrong, not the code: six mutants survived their
first run purely because the harness ran only `puzzle_core_test.js` while their assertions lived in
`puzzle-metrics.js` and `streak-engine.js`. The tests were there; the harness was the gap. It now
runs every pure suite.

The browser-load check earned its keep again: `streak-engine.js` was not in `index.html`, and the
check named it the moment it existed.

**Still to do on the iOS side.** No SwiftUI views this phase, as planned — the presentation layer
they consume (`PuzzleMetrics.swift`, now with the four Daily/Thematic namespaces, the twelve themes
and the Part 19 strings) is written and checked against the JS. `swift` is still not on PATH here.

### 2026-08-11 (feature) — Puzzle Hub, Phases B and C: the extraction, the metrics layer, and three screens

Phase A built the corpus and the pure logic. This is the first time any of it is on screen: the
**Puzzle Hub**, **Play Puzzles Home** and the **Play Puzzles Solver**, live in `web-demo/`, with the
Swift presentation layer written alongside them.

- **Added** — **`tools/metrics/extract_puzzle_styles.js` → `puzzle_styles.json`** (committed).
  An AST walk over all **eleven** RN puzzle screens: 442 style keys, 1,694 properties, 103 inline
  overrides, 7 render functions, 66 distinct colours. Same machine as the Analysis Board's
  extractor — which was refactored onto a shared `tools/metrics/rn_ast.js` first, with
  `board_styles.json` regenerating **byte-identical** (`44631590cb95…`) as the proof that the move
  was safe.

  It exists because the spec is prose, and prose loses information. Three things it found that a
  transcriber would have shipped wrong:
  - **The "standard header" is not standard.** Part 1 describes one header at
    `paddingTop 10, paddingBottom 6`. There is no shared header component: **eight distinct shapes
    across eleven screens**, and the spec's numbers match only the Play Puzzles home. The hub is
    `paddingVertical 10`; the solver is `8`. Encoded per screen, with an assertion that they stay
    different so nobody "tidies" them into one constant.
  - **"Next Puzzle →" has two margins, not one.** The spec gives it a top margin of 8. The source
    has `marginBottom: 8` in the StyleSheet *and* an inline `marginTop: 8` at three call sites.
  - **The mode tiles are hex bytes, not percentages.** Part 9.2 says "13% alpha" and "33% alpha";
    the source writes `mode.color + '22'` and `+ '55'` — 13.33% and 33.33%.

  Unresolved values are a **gate**, not a log: a number the evaluator cannot fold is a hole the
  metrics layer will never see, so the script exits non-zero. The only expected class is
  `PIECE_COMPONENTS`, which maps piece letters to SVG components rather than to measurements.
- **Added** — **`PuzzleMetrics.swift` + `web-demo/js/puzzle-metrics.js`**, the presentation layer:
  palette, hub, goal strip, home, stats, solver, engine panel, promotion, save sheet, typography,
  and the Part 19 string catalog verbatim. Every constant is asserted against the extraction —
  **242 source assertions** — and the screens contain no numeric literal at all.
- **Added** — **`PuzzleStats.swift` + `web-demo/js/puzzle-stats.js`**: the Home screen's five
  statistics as pure functions, because every one has an edge case that only appears on day one.
  A sparkline with a single point (renders nothing — a one-point polyline is an invisible dot that
  reads as a bug), a flat history (sits centred instead of clipping, which is what the ±25 y-margin
  is for), an accuracy of 0/0, seven bars all at zero. **41 assertions.**
  `PuzzleStats` stays Foundation-only: the pixel sizes are parameters and the UI passes them, so no
  presentation constant leaks into Core. Asserted.
- **Added** — **the Puzzle Hub** (Part 9): header, hero, the daily-goal strip, and five cards
  distributed `space-evenly` so the spacing grows with the screen. Two Part 9.2 fixes: the accents
  are **unified onto the screens' own colours** (the hub's Thematic/Turbo/Streak differed from the
  screens they open), and it is **Puzzle Turbo everywhere** — the folder is named `puzzle-rush`,
  the user-facing name never was.
- **Added** — **the daily-goal strip** (Part 15.2): a 44pt SVG ring sweeping from 12 o'clock over
  400 ms, swapping to ✅ and green on completion, with the streak pill only above zero. An SVG
  `stroke-dashoffset` transition rather than a conic gradient, so the sweep is one property and
  needs no repaint loop.
- **Added** — **Play Puzzles Home** (Part 10.1). The original was a leaderboard with a Play button;
  offline there are no other players, so it is the user's own statistics instead. **Day one shows
  the rating card and one invitation**, not four blank charts — a decision, not an omission: an
  empty sparkline over 0.0% accuracy over seven flat bars reads as a broken dashboard rather than
  a new one.
- **Added** — **the Play Puzzles Solver** (Parts 10.2/10.3), the screen the other four fall out of.
  Five bands, and almost no logic of its own: `PuzzleSession` already owns validation and the five
  wrong-move policies, `PuzzleSelection` picks the puzzle, `PuzzleProgress` moves the Elo. What is
  left is DOM, timers and sound. Spec fixes carried: the info strip is **one enum** so "✅ Solved!"
  and "💡 Viewing Solution" can never render together in a 34pt strip (#11); the clock is derived
  from wall-clock and **restarts on Retry** (#2), which plays the game-start sound (#3); the rating
  delta survives a retry (#c); the `↻` engine button genuinely re-runs (#4).
- **Added** — the engine panel and arrows (Part 18), on `LocalEngine` through the existing
  `engine-host`, so the solver shares the Analysis Board's Worker and frame budget. Arrows are
  drawn inside the board component's own square-space viewBox, which is what makes fix #12
  structural: in the RN source the board sits at x = 0 while the overlay is `alignItems: 'center'`,
  and the two disagree by up to ~3.5px. Here they cannot.
- **Changed** — **the Puzzles tab now opens the Puzzle Hub**, and the ten hand-made samples are
  retired. They use the OPPOSITE move convention (`solution[0]` is the solver's; the corpus has
  `moves[0]` belonging to the opponent), so the two could never share a solver.
- **Added** — **`tools/qa/puzzle_screen_test.js`** (117 assertions): the three screens rendered
  into a fake DOM, in **index.html's own script order**. Neither the logic suite nor the metrics
  suite would notice a screen that throws on its first paint, renders no cards, or wires a button
  to nothing — and those only happen in a browser, which this checkout cannot open. It also
  asserts that every `--pz*` custom property the stylesheet reads is actually set, and that the
  solver contains no hard-coded `px` and no user-facing string of its own.

  It earned its keep twice on the first run: `analysis-engine.js` reads `CoachAI` **at load time**,
  so omitting `ai.js` tested a load order the page does not use; and the six new scripts had been
  inserted **before** their dependencies in `index.html`, which would have thrown in a browser and
  nowhere else.
- **Changed** — `replay_puzzle_core.js` grew from 187 to **530** Swift expectations, now covering
  `PuzzleMetrics.swift` and `PuzzleStats.swift` constant by constant, plus the five hub cards' copy
  and accents, the Part 19 strings, and the three fixes the metrics layer owns. It immediately
  caught a real slip: the Swift's Streak card kept the hub's own `#FF6B35` instead of the unified
  screen accent `#F4511E`, so four cards had been converted and one had not.
- **Changed** — `DemoApp/.../BoardHelpers.swift` extracted from `PuzzleView.swift`. The four
  piece-mutation helpers were always general; living in that file meant a second screen could not
  reach them without depending on a retired one. The move also cleared a real name collision the
  lint caught — `PuzzleVM.Phase` shadowed the public `PuzzleSession.Phase` at module scope, so any
  public signature naming a phase failed the access check.

**Still to do on the iOS side.** The SwiftUI **views** for these two screens
(`PuzzleHubScreen`, `PuzzlePlayHomeScreen`, `PuzzleSolverScreen` + its VM) and the `PhoneView` /
`AppShell` rewiring are **not written yet** — the Swift presentation *layer* they consume is, and
is checked against the JS. They are the first item of the next pass. `swift` is still not on PATH
here, so nothing Swift has been compiled; `swift build`, `swift run ParityRunner` and the metrics
check await a Mac.

### 2026-08-11 (feature) — Puzzle Hub, Phase A: the corpus, the solver core, the progress store

The foundation the six Puzzle Hub screens sit on. No screens yet — this is the layer that is fully
provable on this Windows checkout, and it is gated end to end.

Most of the spec's arithmetic turned out to be **already ported and golden-pinned** to the real
Laravel backend: the Elo (`PuzzleRatingEngine`), the three serving ladders (`PuzzleServing`), the
streak ramp (`StreakEngine`), the rush best-score rule (`PuzzleRush`) and the goal streak
(`DailyGoal`). None of it was rewritten. What was missing was the corpus, the solver state machine,
a pool the ladders can run over a 93,000-row database, and somewhere to keep progress.

- **Changed** — **the bundled corpus was rebuilt: 550,000 rows / 84 MB → 92,976 rows / 33.0 MB.**
  The old `build_puzzles.py` imported everything and kept only FEN/Moves/Rating/Themes/OpeningTags.
  That is unusable here on three counts: it dropped `Popularity` and `NbPlays`, which are the only
  signal for picking the *good* 100k out of 550k; it stored themes as one space-separated string
  with **no index**, so every thematic query scanned 550k rows (spec fix #15); and at 84 MB it was
  most of the app download. It also had hardcoded macOS paths, which CLAUDE.md has flagged for
  three phases. All four fixed.

  Selection is the spec's Part 3.2 verbatim — 22 rating bands × the top 4,000 by
  `popularity × log10(max(nb_plays,10))`, then theme quotas, the mate-in-1 warmup guarantee and the
  rare-theme sweep. Deterministic: two runs produce byte-identical SQLite (`99f10832…`), which
  needed the quality score quantised to an integer before it is ever used as a sort key — `log10`
  is the one place a platform libm could reorder two rows — an explicit `lichess_id` tie-break on
  every sort, and a splitmix64 Fisher–Yates instead of `random.shuffle` so the daily pool does not
  depend on the CPython build.

  Three findings worth recording:
  - **92,976, not the spec's estimated 95,000–105,000.** Its own step-2 arithmetic fixes the base at
    22 × 4,000 = 88,000 and every later step is a *floor*, not a target. The rules were implemented;
    the prose was an over-estimate.
  - **`anastasiaMate` (636 rows) is rare by the spec's rule but absent from its list of twelve.**
    The build computes the rare set instead of reading the list, and says so when they disagree.
  - **The spec's literal schema builds to 50 MB against its own 25–35 MB target.** `WITHOUT ROWID`
    on the two theme tables closes the whole gap — a storage class, not a schema change; the
    columns, constraints and every Part 7 query are identical. `puzzle_themes` 21.2 → 13.5 MB,
    `theme_rating_index` 17.4 → 8.0 MB. Both composite keys are genuinely unique (432,507 rows,
    432,507 distinct), so the PK is also a duplicate-theme guard the rowid version could not give.
    Two of the spec's four indexes are now those primary keys and are not restated.

  The generated DB stays **committed**, unlike `Goldens/`: `codemagic.yaml` builds the iOS app from
  a clone of this repo alone and never sees the source CSV in the sibling Laravel repo.
  _(web-demo: the same script now also emits a 1,912-puzzle slice — see below.)_
- **Added** — **`PuzzleSession`** (+ `web-demo/js/puzzle-session.js`), the one solver core all five
  modes configure. Pure: no timers, no sounds, no DB, no view. Every operation returns what should
  happen next — "play the capture sound", "let the opponent reply in 500 ms", "the run is over" —
  and the caller owns the clock, so the spec's `after(opponentDelay) { … }` closures become returned
  numbers and all five modes are assertable with no test doubles. Carries the `moves[0]`-is-the-
  opponent convention, the checkmate short-circuit, the five wrong-move policies as data, promotion
  detection, retry, Solution, and the Save Puzzle PGN.
- **Added** — **`PuzzleSelection`** (+ `web-demo/js/puzzle-store.js`), the same three ladders over an
  abstract five-method pool, so the device answers each tier with an index seek instead of loading
  the corpus into memory. `PuzzleServing` is untouched: `ArrayPool` implements the pool by calling
  its pinned helpers, and the parity group asserts the two agree over **420** (centre, window,
  theme, seen) combinations, which makes the reuse a proof rather than a claim.
- **Fixed** — **exhausting one narrow theme no longer wipes non-repetition for every mode**
  (spec fix #7). This landed in the *caller*, not the ladder, because the ladder never wiped
  anything — it takes `seen` as an argument and REPORTS `didReset` as a flag. So the golden-pinned
  engine stays byte-identical and `scopeForReset` decides between forgetting one theme, one rating
  band, or (only when the corpus is genuinely exhausted) everything.
- **Fixed** — **every date in this feature uses the local calendar** (spec fix #1). The original
  computed dates with `toISOString()`, so in Manila the daily puzzle and every daily counter rolled
  over at 8 a.m. while the UI said "midnight". Both languages also derive day numbers from calendar
  fields rather than by differencing two local midnights: a DST transition makes a local day 23 or
  25 hours long, which silently adds or drops a day from a streak.
- **Added** — **`PuzzleProgress`** (+ `web-demo/js/puzzle-progress.js`): every Part 4 record shape,
  field for field, as `Codable` structs with injected time. **Codable + JSON, not SwiftData** — the
  app already persists the Analysis Board's library that way and a second stack would buy nothing
  (recorded in PORTING_NOTES). Carries the rated ledger's first-attempt-only rule, `ThemeStat`,
  drafts with a 24-hour TTL, and Part 15's `DailySolveCount`. Spec fixes #5, #6, #8, #9 and #13 are
  structural here: every Streak and Turbo run exits through one function that takes the real end
  reason, and `ratingHistory` takes the newest 30 where the server took the oldest.
- **Added** — **`tools/qa/puzzle_corpus_check.js`** (124 assertions). The spec asks for the per-band
  and per-theme counts to be logged "so regressions are visible"; a 60-line histogram is only
  visible if someone reads it twice, so they are assertions instead. Its strongest check is not a
  count: it replays whole puzzle lines through the engine the app solves with, and proves every
  stored move is legal in the position it is played from. It also asserts the four hot queries
  **SEEK** — spec fix #15 stated structurally, which no count could catch.
- **Added** — `tools/qa/puzzle_core_test.js` (371), `tools/qa/replay_puzzle_core.js` (187), and the
  three new ParityRunner groups `puzzle_session` / `puzzle_selection` / `puzzle_progress`. The
  fixtures are real corpus rows emitted by `tools/qa/gen_puzzle_fixtures.js` with every expectation
  **computed** by the JS, not typed — "extract, don't transcribe", the same rule the board metrics
  follow.
- **Added** — two mutation suites, `tools/qa/corpus_mutation_test.py` (**14/14 killed**) and
  `tools/qa/puzzle_core_mutation_test.js` (**35/35 killed**). Several mutants are the original
  server bugs reintroduced verbatim. They found five real holes in the new suites and one in an
  older assumption:
  - **The single most important property was being sampled, and the sample could not reach it.** A
    mutant that made `moves[0]` the solver's on 5% of rows **survived**: the deep replay took
    ids ≡ 1 (mod 154), always odd, and the mutation hit ids ≡ 0 (mod 20), always even, so the two
    could not intersect by construction. The convention is now checked on **every** row, and the
    replay samples by ordinal rather than by a fixed modulus.
  - "the served rating is within 100" is satisfied by a ±50 window too, so a narrowed rated window
    survived it; the window is now asserted by which ladder tier fired.
  - the ladder fixtures had ids in rating order, so "lowest id" and "closest by ABS" coincided and
    the three ladders were indistinguishable; and nothing sat on the window boundary, so
    inclusive-vs-exclusive was invisible.
  - the rating floor was exercised with a 401-rated user failing a 2800 — which costs ~0 points, so
    the floor was never reached. It now fails an evenly-rated puzzle and actually lands on 400.
- **Added** — a browser-load check inside `puzzle_core_test.js`. Twice in this rebuild a module has
  referenced a global it never loaded and every Node suite stayed green while the real page threw
  inside a click handler. The five new files are now evaluated in a bare `window` sandbox, in
  index.html's order, and driven — so a `require`-only dependency cannot reach the browser.
  _(web-demo: all five modules are wired into `index.html`.)_
- **Changed** — `DemoApp/.../PuzzleStore.swift` rewritten for the new schema: read-only, the only
  place in the app that writes SQL, plus `SQLitePuzzlePool`. Its tier-1/tier-2 queries return a
  bounded random sample rather than every match — still a uniform pick once composed with a uniform
  picker, and emptiness, the only thing the ladder branches on, is preserved exactly. The old
  `themes LIKE '%theme%'` scan is gone. The existing Puzzles tab keeps working through a small
  compatibility surface.

**Three of the spec's premises were stale and are corrected in `docs/puzzle-hub.md`:** there is no
embedded Stockfish (the engine panel will use `LocalEngine`, as the Analysis Board does); the
`compareMoves` fix #10 warns about already exists in Core as a deliberate parity artifact, and
nothing in this feature calls it; and fix #7 belongs in the caller.

**Swift unverified by compilation** — `swift` is not on PATH here, so `swift build`,
`swift run ParityRunner` and the three new group floors (600 / 1100 / 70) still need a Mac. The
mitigation is `replay_puzzle_core.js`, which re-derives every fixture and constant table from the
Swift source text and confirms them against the JS that has actually run; it caught two real
defects on its first run — fixtures carrying the browser slice's renumbered ids instead of
shipping-corpus ids, and a regex that silently skipped the `.turbo` policy row.

### 2026-08-10 (fix) — piece movement, made smooth

Reported: moving a piece feels delayed and not smooth, "gusto ko kasing smooth ng chess.com at
lichess". Three independent causes, measured rather than guessed. The animation was the smallest of
them.

- **Fixed** — **the engine froze the whole page.** The search ran on the main thread, one whole DEPTH
  per uninterrupted block. Measured on `r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq`:

  | depth | block | dropped frames |
  |---|---|---|
  | 1 | 58 ms | 3 |
  | 2 | 112 ms | 7 |
  | 3 | **624 ms** | 37 |
  | 4 | **2,885 ms** | 173 |

  The 1,200 ms deadline capped a chunk but did not slice it, so up to **1.2 s of frozen UI in one
  go** — no animation, no drag, no clicks. With a 300 ms debounce against a 330 ms slide, the freeze
  routinely landed *on top of* the piece still moving. `Play` had the same bug: `bestMoveAsync` was
  `setTimeout(0)` followed by a fully synchronous search, so the "async" bought nothing.

  Now **`web-demo/js/engine-host.js`** owns the decision and both screens call it:
  - **served over http** → **`web-demo/js/analysis-worker.js`**, a real Worker. The main thread never
    runs a search at all. Both the analysis engine and the coach go through it.
  - **`file://`** → in-thread, but each depth gets **its own slice deadline**, which the engine polls
    every 2048 nodes, so the chunk is cut from the *inside* and cannot overrun. Measured: worst chunk
    **94 ms**, still reaching depth 2 in a sharp midgame and depth 5 in a quiet endgame.

  **Neither engine file needed changing.** `engine.js` closes over
  `typeof window !== 'undefined' ? window : globalThis` — the worker's `self` — and `ai.js` and
  `analysis-engine.js` declare bare globals, so `importScripts` just works and the code on the worker
  thread is byte-identical to the code the golden suite proves.
  _(web-demo: this IS the web-demo fix.)_
- **Fixed** — **the drag did layout work on every pointer event.** `_onPointerMove` called
  `getBoundingClientRect()`, `_squareAtPoint()` called it *again*, and then all **64 cells** had
  `drophover` removed: two forced layouts and 65 class mutations per event, at up to 120 Hz. The rect
  is now read once on `pointerdown` and cached for the drag, only the two cells that changed are
  touched, and pointer events are coalesced into **one transform write per frame**.
- **Fixed** — **a drop teleported.** On `pointerup` the piece was snapped back to its origin and only
  then slid to the target over 330 ms, so a drag ended with the piece jumping home and travelling
  back. It now lands where you let go: `_justDropped` tells the next render to place that one piece
  without a slide. A tap-move still animates, and a drop that needs the promotion sheet still goes
  home, because the piece cannot sit under a dialog waiting.
- **Changed** — **the slide is 170 ms ease-out, was 330 ms with an overshoot**
  (`cubic-bezier(.34,1.15,.64,1)`). Between lichess (~200) and chess.com (~150), and without the
  bounce, which was most of what read as sluggish. Exposed as `--piece-anim` so the component stays a
  themeable drop-in; the Analysis Board sets it from the metrics layer. Mirrored in Swift as
  `AnalysisTiming.pieceMove`, replacing three separate `.spring(response: 0.34)` calls in
  `AnalysisVM`, `PlayView` and `PuzzleView`.
- **Changed** — a search can no longer start while a piece is moving: the debounce is
  `max(analysisDebounce, pieceAnimation)`. Belt and braces on the worker path; load-bearing on
  `file://`.
- **Added** — **`tools/qa/engine_budget_check.js`**: no single synchronous chunk may exceed
  `inlineSearchBudget`, over six positions of different character. It times
  `BiyaEngineHost.slicedSteps` — the very stepper the browser pumps, not a copy — and reports a
  breach in dropped frames. Verified by removing the per-depth slice reset: five positions fail with
  584–1,073 ms chunks.
- **Added** — **`tools/qa/worker_protocol_check.js`**, which drives `analysis-worker.js` for real in
  a fake worker scope (`importScripts` / `self.onmessage` / `postMessage`). This was not optional:
  the worker only runs when the page is *served*, so a bug in it would never appear from `file://`
  or in Node, and `engine-host` cannot catch a logic error — construction succeeds, so the fallback
  never fires and the board silently gets no snapshots. **It found one immediately:**
  `importScripts('engine.js', 'analysis-engine.js', 'ai.js')` was the wrong order —
  `analysis-engine.js` reads `CoachAI` at load — so the worker would have thrown on startup, degraded
  silently, and the whole fix would have looked like it did nothing.
  It also pins that the worker's ranked moves match the in-thread engine's exactly, that a coach is
  structured-cloneable, that a bad FEN reports rather than throws, and that a cancel is honoured.
- **Changed** — `tools/qa/js_goldens.js` now awaits async suites, running them **after** every
  synchronous one. Started at require time, the worker check measured the harness rather than the
  worker: the gate blocks the event loop for seconds, and the worker's deadline expired before its
  pump got a turn.
- **Added** — `board_component_test.js` grew to 133 assertions covering all three drag fixes: no rect
  read on the pointermove path, one transform per frame however many events arrive, at most two cells
  touched per move, a drop that lands without a slide, and the 170 ms curve. All five regressions are
  mutation-tested.
- **Added** — `pieceAnimationMs` (170) and `inlineSearchBudgetMs` (80) to both metrics layers, as
  invented constants recorded in `PORTING_NOTES.md`.

**Swift side unverified by compilation** — `swift` is not on PATH here. Swift never had the freeze
(`Task.detached` already), so it took only the animation change. **The browser pass is outstanding**:
the Chrome connected to this session runs on a different machine from the local server, so the served
page could not be reached. The worker is proven through its real protocol and the frame budget is
proven in milliseconds, but `BiyaEngineHost.mode === 'worker'` in an actual browser still wants
confirming.

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
