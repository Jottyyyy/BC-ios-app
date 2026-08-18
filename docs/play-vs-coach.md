# Play vs Coach (spec §2)

Five coaches, an offline engine, and a game you can leave and come back to. Three screens —
**Coach Select → Colour Select → the Game** — over a domain layer that is where all the decisions
actually live.

Ground truth is `../BYAHERONG-COACH-FRONTEND/app/(app)/user/play-coach/` — `index.tsx` (498 lines)
for Coach Select and `play.tsx` (3,082 lines) for the other two.

Status: **complete in both languages, including the offline game review (§2.10).**

---

## Key files

### The domain layer — where the decisions are

| File | What it owns |
|---|---|
| `web-demo/js/coach-engine.js` | Strength: `LEVEL_CONFIG` (depth + MultiPV per level), `pickMove` with an injected RNG, and the think-time pacer. |
| `web-demo/js/coach-book.js` | The per-persona opening book. Declarative `[history, move]` rows; an illegal book move falls through to the engine **silently**. |
| `web-demo/js/coach-game.js` | The record, threefold, the result, the per-level 7-day draft. |
| `web-demo/js/coach-turn.js` | Whose turn it is, the premove, the nav rules, and the **generation counter**. |

### The Swift half

| File | What it owns |
|---|---|
| `Sources/BiyaherongCoachCore/CoachEngine.swift` | The level table, `pickIndex`/`pickMove`, the pacer. |
| `Sources/BiyaherongCoachCore/CoachGame.swift` | Record, threefold, results, the injected-storage draft. |
| `Sources/BiyaherongCoachCore/CoachTurn.swift` | The generation counter, premove, nav, take-back. |
| `Sources/BiyaherongCoachCore/CoachBook.swift` | The lookup. Tables are generated into `CoachBookData.swift`. |
| `DemoApp/…/CoachStore.swift` | The reply loop: book → search → pace → apply → premove. |
| `DemoApp/…/CoachScreens.swift` | The three screens and the resign prompt. |
| `DemoApp/…/CoachLayout.swift` | The twelve unextracted values and the five glyphs, in one place. |
| `DemoApp/…/CoachMetricsCheck.swift` | `swift run CoachMetricsCheck`. |
| `tools/qa/replay_coach.js` | 239 Swift expectations, replayed against the JS. |

### The presentation layer

| File | What it owns |
|---|---|
| `tools/metrics/extract_coach_styles.js` | AST walk over the two RN screens → `coach_styles.json` (192 blocks, 773 props, 0 unresolved). |
| `tools/metrics/gen_coach_metrics.js` | One JSON → `coach-metrics.js` **and** `CoachMetrics.swift` / `CoachStrings.swift`. Nothing is transcribed. |
| `web-demo/js/coach-strings.js` | §2.14 copy, including the eleven deleted network strings asserted **absent**. |
| `web-demo/js/coach-select.js`, `coach-color.js`, `coach-play.js` | The three screens. |
| `web-demo/css/coach.css` | `--cgs-` select · `--cgc-` colour · `--cgp-` game · `--cgx-` polish. |
| `web-demo/js/coach-review.js` · `CoachReview.swift` | The §2.10 adapter: records → the review's own shape, the modal's derived values, the hand-off. |
| `web-demo/js/app.js` | The loop that joins them: ask the coach, wait, apply, repaint. |

---

## Three things that are easy to get wrong

### 1. The roster is read, never typed

`MET.COACHES` is the source's own `COACH_DATA` — name, role, tagline, the four in-game lines, accent
colour and rating — lifted by the extractor and emitted into both languages.

This is not tidiness. The first version of `coach-select.js` typed the roster out by hand and got
**three of the five ratings** and **four of the five names** wrong. The spec table (§2.14) and the
RN source agreed with each other; only the transcription disagreed, and nothing was comparing them.
The suite now pins the roster against the spec table *and* the generator pins it field-by-field
against the extraction.

The same rule caught the avatar geometry. `CoachCard` computes
`avatarSize → ringSize = +6 → haloSize = +10` in its body, and the extractor's render-function
walker only understood `const f = () =>`, not `function f()` — so `renderConstants` came back empty
and the stylesheet reached for hand-typed pixels. `findNamedFunctions` now handles both forms and
the generator **folds** the extracted signed terms into six constants.

### 2. The `<chess-board>` contract fails silently, five ways

Every one of these was wrong in the first version of the game screen, with a green test suite,
because a fake DOM node accepts anything:

| Wrong | Right | What the user sees |
|---|---|---|
| `b.onmove = fn` | `b.addEventListener('move', fn)` | The board never reports a move. |
| `detail.from + detail.to` | `detail.uci` | Two numbers are *added*, not joined. |
| `setAttribute('flipped','0')` | `b.flipped = false` | Attribute-truthy: the board is upside down. |
| `highlightLastMove('e2','e4')` | numeric square indexes | No last-move highlight, ever. |
| no `b.rules` | `b.rules = rulesAdapter()` | No piece can be picked up at all. |

The mock in `tools/qa/coach_screen_test.js` now *enforces* this contract — it throws on algebraic
squares and emits the component's real event detail — and five mutants keep it enforcing.

### 3. One counter is the whole concurrency story

`coach-turn.js` hands out a generation token; every async continuation is dropped unless its token
still matches. Resign, New Game, take-back and entering review all bump the counter, so §7 **#25**
(ghost move), **#26** (uncleared timers), **#27** (the engine moving underneath a review) and **#29**
(the resign/new-game race) are all the same fix rather than four.

---

## Spec §7 fixes that landed here

**#24** resign confirms · **#25/#26/#27/#29** the generation counter · **#30** threefold on the first
*three* FEN fields (the RN key included the en-passant square, so real threefolds were missed) ·
**#31** the fifty-move and insufficient-material draws get their own strings · **#32** the premove is
cancellable, dies at game over, and no longer always auto-queens · **#33** Continue honours the colour
you tapped · **#34** restore resets modal state and plays the game-start sound · **#35** a non-numeric
level clamps instead of indexing `COACH_DATA[NaN]` · **#37** `⏮` and `◀` share one disabled rule ·
**#39** Allow Take Back is persisted.

**#28** — the hand-off carries its classifications. The RN callback's dependency list omitted
`reviewData`, so the Analysis Board received an empty array every time; `handoff` takes the summary
as an argument, which makes the bug inexpressible.

Nothing from §7 #24–40 is still open.

## What is deliberately not here

- **The Review button** is rendered only when its host passes `onReview` *and* there is something
  to review — one position is a game that never started, and the accuracy would be a mean over
  nothing.
- **The browser's old sample Play tab** (its own coach table in `js/ai.js`, its own undo, its own
  game state) was **deleted**, not left unreachable. Two Play tabs disagreeing about who the coaches
  are is exactly what the extraction exists to prevent. Its Swift twin survives for now — see below.
- **The Opening Explorer and the annotate/draw layer** are not ported: both are unreachable in the
  shipping RN build, and the Analysis Board already has arrows.

---

## The game review (§2.10)

The maths is not this feature's. `review.js` / `GameReview` is the parity port of
`GameReviewController`, verified against 303 golden cases, and `ReviewAnnotator` adds the `book`
tier. `coach-review.js` is an adapter over it plus the modal's derived values — and four things it
deliberately does *not* own:

| Wanted | Where it already lived |
|---|---|
| the four accuracy bands | `analysis-metrics.js` / `AnalysisReview.accuracyColor` |
| `91.2%` | `accuracyText` |
| ten classification colours | `CLASSIFICATIONS` / `AnalysisTables.classification` |
| `Best ★`, `Book B` | `classificationText` |

The first draft reimplemented all four, including ten hex values typed into `coach.css`. They are
delegated now — the same table the Analysis Board's own review rows read.

**The orientation fix.** The RN modal ordered the accuracy columns White-left/Black-right and the
classification rows user-left/opponent-right, so playing Black put the coach's accuracy directly
above your own counts. `columns()` is the one source of that ordering and the rows are built *from*
it, so they cannot disagree.

**The hand-off (§7 #28).** `handleGameReview` read `reviewData` through a memoised callback whose
dependency list contained only `moveRecords` — so it closed over `null` and the Analysis Board got
an empty `moveEvaluations` array every single time. `handoff(game, summary)` takes the summary as an
argument: there is no captured variable that can go stale, and it returns nil rather than an empty
payload.

**The graph is extracted.** §2.10 states its fill, radius, both advantage fills, the centre line and
the curve in prose. Every one is an SVG attribute literal in `components/EvalGraph.tsx`, which the
extractor now walks — along with the `height={60}` at its call site in `play.tsx`. `CLAMP = 500` is
read too, so the curve and the maths behind it cannot disagree about what "off the scale" means.

## Two more things that are easy to get wrong

### The reply is paced, not delayed

`thinkTimeMs` runs in PARALLEL with the search and the wait is `think - alreadySpent`. Written as a
`sleep(think)` *after* the search it becomes an addition, and level 5 answers in three seconds
instead of two. Spec §2.13's "no coach ever replies in under 300 ms" is a floor, not a delay — and
a mutant pins the difference.

### Two types of one name do not compile

`CoachMetrics.swift` generates `public enum CoachSelect`; the pre-port sample screen declared
`struct CoachSelect: View`. That is a redeclaration error, and it sat in the repo unnoticed because
nothing here compiles Swift. The view is now `LegacyCoachSelect`, and `swift_symbol_check.js`
reports duplicate top-level types. It is also why the **Swift** sample Play tab is still reachable
while the browser one was deleted: `BoardView` lives inside `PlayView.swift`, so retiring the pair
means extracting it first.

## How to test

```bash
node tools/qa/coach_screen_test.js        # the three screens in a headless DOM + the app.js wiring audit
node tools/qa/replay_coach.js             # the Swift, against the JS that has actually executed
node tools/qa/js_goldens.js               # everything, including all eight coach suites
node tools/qa/puzzle_core_mutation_test.js   # 147/147, twenty-five of them Play vs Coach
node tools/metrics/gen_coach_book.js      # re-emit CoachBookData.swift from the JS book
node tools/metrics/extract_coach_styles.js && node tools/metrics/gen_coach_metrics.js
```

In the browser: open `web-demo/index.html` and pick **Play**, or the **Play vs Coach** tile on Home.
Choose a coach → choose a colour → play. Leaving mid-game and returning offers **Continue**; the
draft is per level and kept 7 days.

> **That caveat came true, exactly as written.** It used to read: *"the wiring has not been
> exercised in a real browser … `auditAppWiring()` reads `app.js` as source instead … that catches a
> control wired to nothing; it cannot catch a layout problem. First run in a browser is worth a
> look."*
>
> The first run in a browser found one: **`css/coach.css` was never linked in `index.html`.** All
> 507 lines and all 21 `.cgs-*` rules were correct and on disk; the page simply never loaded them,
> so every screen here rendered as unstyled UA buttons — white text on the default light button
> face. Only two classes resolved, and both came from `app.css`: `nav-icon` (which is why the back
> button was a grey square) and `.view.flush` (which is why the text ran edge to edge).
>
> `coach_screen_test.js` could not have caught it: it reads `coach.css` off disk at line 25, which
> validates the file in complete isolation from whether the page loads it. `tools/qa/web_shell_check.js`
> now asserts every stylesheet in `css/` is linked.
