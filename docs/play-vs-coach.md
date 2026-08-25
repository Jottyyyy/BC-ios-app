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
| `web-demo/js/coach-engine.js` | Strength: `LEVEL_CONFIG` (depth + MultiPV + **movetime** per level), `pickMove` with an injected RNG, and the think-time pacer. |

**The five levels now have five clocks — 0.3/0.6/1/2/4 s.** They used to share one flat 1 s cap
carried over from the Python service. Because depth is only a ceiling and the engine reaches a mean
depth of ~6 in a second, levels 4 and 5 never came near their 10 and 15 and played identically:
"Coach Pogi" and "Mommy Julie" were the same opponent in different art. Level 3 keeps exactly 1000 ms,
so the middle of the ladder is unchanged. Recorded as a deviation in `PORTING_NOTES.md`.

`thinkMs` is a different knob and was deliberately left alone: it is a **floor** on the reply, awaited
in parallel with the search, so the reply lands at `max(search, floor)`. Levels 4 and 5 simply stop
being paced. Raising the floors to match would make fast positions — a book move, a forced recapture —
artificially slow, which is the opposite of what a floor is for.
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

### 2. The `<chess-board>` contract fails silently, six ways

The first five were all wrong at once in the first version of the game screen, with a green test
suite, because a fake DOM node accepts anything:

| Wrong | Right | What the user sees |
|---|---|---|
| `b.onmove = fn` | `b.addEventListener('move', fn)` | The board never reports a move. |
| `detail.from + detail.to` | `detail.uci` | Two numbers are *added*, not joined. |
| `setAttribute('flipped','0')` | `b.flipped = false` | Attribute-truthy: the board is upside down. |
| `highlightLastMove('e2','e4')` | numeric square indexes | No last-move highlight, ever. |
| no `b.rules` | `b.rules = rulesAdapter()` | No piece can be picked up at all. |
| no `b.draggablePieces` | `b.draggablePieces = true` | Tap-to-move works; **every drag does nothing.** |

The mock in `tools/qa/coach_screen_test.js` now *enforces* this contract — it throws on algebraic
squares, it emits the component's real event detail, and it carries the component's real
`draggablePieces: false` default so a screen that never sets it is distinguishable from one that
does — and the `coach play:` mutants in `puzzle_core_mutation_test.js` keep it enforcing.

**The sixth outlived the other five, and the reason is worth keeping.** The client reported it from
a phone: *"hindi daw nagana yung drag and drop sa play with coach."* Drag is OFF until a screen
asks for it — `_dragEnabled = false` in the component, and in SwiftUI a `BoardView` with no
`onDragMove` installs no drag gesture at all (`including: onDragMove == nil ? .subviews : .all`).
Neither language warns, and **tap-to-move keeps working**, so the board selects, rings its legal
targets, plays the move and answers with a coach reply. Nothing looks broken until you try to drag.

And no suite in the repo drove a drag through a **screen**. `coach_screen_test.js` builds this one
against a stub board; `board_component_test.js` drove real pointer drags through the real component,
wired correctly *by the test itself*. Two green suites, one dead route. That gap is closed as well:
`board()` is exported, and `board_component_test.js` now lets it build and configure a real
`<chess-board>` in its own order and then sends real `pointerdown` / `pointermove` / `pointerup`
through it — e2→e4 must reach `onMove` once as `"e2e4"`, a black pawn must arm nothing while White
is to move, and an illegal drop must report nothing.

This is the exact mirror of the `PuzzleBoardBand` bug the CHANGELOG records, which shipped
`selected: nil`, `legalTargets: []`, `onTap: { _ in }`: there drag worked and *tap* was dead. Same
hole, opposite half — so both gates are now written as one symmetric rule, in the two places that
can see a screen rather than a component:

| Gate | Rule |
|---|---|
| `web_shell_check.js` §5 | a board given `.rules` must be given the drag; a board given neither is a display board and is exempt — **no board is, since the Opening Tree explorer became playable**, so the census is asserted `=== 0` and the arm is proved on fixtures plus a mutant |
| `swift_layout_check.js` §7 | a `BoardView` with a real `selected`/`legalTargets`/`onTap` must pass `onDragMove`; one passing `nil`/`[]`/`{ _ in }` is exempt — **nothing is any more**, same reworking |

Both are read off the call rather than a list of screen names, so the next screen is covered the day
it is written, and each has a mutant on a file *other* than the one the bug was found in.

**Both input routes end in one function, per language.** `coach-play.js` has always funnelled the
component's `move` event through a single listener that asks the controller whether this is a move
or a premove. Swift now matches: `tap` and `drag` both call `commit(from:to:in:)`, which is the only
place `promotionSuffix` is read and the only place `userMove` / `premove` is chosen between. Before
that, the tap path evaluated `promotionSuffix` three times and spelled the empty case two different
ways — harmless, and exactly the kind of duplication a second input route turns into a divergence.

One thing the drag route must do that the tap route never had to: **check legality itself.**
`BoardView.dragGesture` reports whatever two squares the gesture spanned, and knows nothing about
pieces or rules — while by the time a second *tap* arrives, `legalTargets` has already been computed
for the piece in hand. An illegal drop is dropped, and the selection ring with it; falling through
to `commit` would queue a premove that is not re-checked against the rules until the position it was
queued for arrives. The browser gets this for free: the component computes `_targetsFrom` on
`pointerdown` and sends the piece home on a drop that is not in it.

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
reports duplicate top-level types.

It was also why the **Swift** sample Play tab outlived the browser one: `BoardView` lived inside
`PlayView.swift`, so retiring the pair meant extracting it first. That extraction happened
(`BoardView.swift`), and removing the tab bar took the screen's last door — `PlayPhone` and its
board chrome are deleted. `LegacyCoachSelect` stays: the macOS demo's `Panel.play` still renders it
through `PlayView`, which is the board harness, not a phone screen.

### A generated string can be a valid Swift string and still be wrong

`CoachStrings.swift` is generated. For a long time every one of its eight interpolating functions
read `"ELO (n)"` rather than `"ELO \(n)"`, so the coach cards showed **`ELO (n)`**, the resign modal
showed `(coach) will win this game.`, and Analyze Game counted `Analyzing… (done)/(total)`.

The cause was one line in `tools/metrics/gen_coach_metrics.js`, which held the Swift as source
inside a JavaScript string: `'"ELO \(n)"'`. `\(` is not a JS escape, so the parser **silently
dropped the backslash**.

Three things made it invisible, and all three are worth remembering before trusting a green run:

- **The JS twin was correct**, so `web-demo/` rendered `ELO 2500`. The browser is where this
  checkout tests, so the only broken artifact was the one nobody here can run.
- **Swift compiles it.** `"ELO (n)"` is a perfectly valid string literal.
- **No gate reads inside a string literal.** `swift_lint.js` matches brackets and
  `swift_symbol_check.js` resolves member references; a literal's *contents* were unexamined.

Now: the generator's table holds `{name}` placeholders instead of Swift, it evaluates its own output
against the JS twin before writing, and `replay_coach.js` re-checks the **committed** file on every
gate run — because a generator only runs when someone runs it.

## How to test

```bash
node tools/qa/coach_screen_test.js        # the three screens in a headless DOM + the app.js wiring audit
node tools/qa/board_component_test.js     # a real pointer DRAG through the screen's own board element
node tools/qa/replay_coach.js             # the Swift, against the JS that has actually executed
node tools/qa/web_shell_check.js          # §5 — a board given `.rules` is given the drag
node tools/qa/swift_layout_check.js       # §7 — the same rule for `BoardView`
node tools/qa/js_goldens.js               # everything, including all eight coach suites
node tools/qa/puzzle_core_mutation_test.js   # 161/161, thirty-six of them Play vs Coach
node tools/metrics/gen_coach_book.js      # re-emit CoachBookData.swift from the JS book
node tools/metrics/extract_coach_styles.js && node tools/metrics/gen_coach_metrics.js
```

In the browser: open `web-demo/index.html` and pick **Play**, or the **Play vs Coach** tile on Home.
Choose a coach → choose a colour → play. Leaving mid-game and returning offers **Continue**; the
draft is per level and kept 7 days.

**Play at least one move by DRAGGING, not tapping** — press a piece, move it and release on a legal
square. Tap-to-move working proves nothing about the drag; that is the whole lesson of §2 above.
On a device, the same for the Swift screen.

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
