# Puzzle Hub

Six screens, five modes (rated **Play Puzzles**, **Daily**, **Thematic**, **Puzzle Streak**,
**Puzzle Turbo**), fully offline against a curated puzzle database that ships inside the app.

**Phases A–D are done.** Phase A built the corpus, the selection layer, the shared solver
core and the progress store. Phases B and C added the style extraction, the presentation layer, and
the first three screens. Phase D added **Daily Puzzle** and **Thematic**, the shared solver
factory, and six fixes to gaps B and C had left. Five of the seven screens are live in `web-demo/`.
Everything below either exists and is asserted, or is called out as pending.

**Phases remaining: three.** E (Streak + Turbo) · F (sounds/haptics sweep, the Part 17 timing pass,
the Part 22 acceptance run) · G (all 11 SwiftUI views, in one pass).

---

## What already existed

The entire puzzle *arithmetic* was ported and golden-pinned to the real Laravel backend long
before this feature. Phase A reuses it and adds no second copy:

| Spec asks for | Already in Core | Parity group |
|---|---|---|
| Part 8 Elo (K=32, floor 400) | `PuzzleRatingEngine.evaluate` | `rating` + `rating_random` |
| Part 7 three fallback ladders | `PuzzleServing.serveRandom` / `serveClosest` / `serveThematic` | `serving` |
| Part 13.2 streak ramp | `StreakEngine.target` / `increment` / `reset` | `streak_*` |
| Part 14.2 rush best-score | `PuzzleRush.bestScore` / `modeLabel` | `rush` |
| Part 15 goal streak | `DailyGoal.calculateStreakDays` | `daily_goal` |
| Part 6 board | `<chess-board>` + `BoardView` | `Board component` |
| Part 10.3 Save Puzzle target | `AnalysisStore` + `PGN` | `analysis_store` |

## Three corrections to the spec

1. **There is no embedded Stockfish.** Parts 0 and 18 refer to "the embedded Stockfish actor
   already built for the Analysis Board". There is none — no `.cpp`, no `.xcframework`, no NNUE;
   the only matches in the tree are future-tense prose in the docs. The engine panel will use
   `LocalEngine` / `AnalysisEngine` (negamax + quiescence + MultiPV), which is what the Analysis
   Board actually runs, on a Worker thread in the browser. Its limits are the Analysis Board's
   measured ones, not Part 18's depth-20 / 1000 ms.
2. **`compareMoves` already exists, and it *is* the comparator fix #10 warns about.**
   `Rating.swift` compares only the first move — a faithful, deliberately preserved port of the
   server's `PuzzleController::compareMoves`, with golden vectors pinning it. It stays as a parity
   artifact, and nothing in this feature calls it. Enforced by an assertion in
   `replay_puzzle_core.js` and another in `puzzle_core_test.js`.
3. **Spec fix #7 (scope the Tier-3 wipe) belongs in the caller, not the ladder.** `PuzzleServing`
   never wiped anything: it takes `seen` as an argument and *reports* `didReset` as a flag. So the
   golden-pinned engine is byte-identical and the scoping lives in `PuzzleSelection` /
   `puzzle-store.js`.

---

## The corpus

`tools/puzzlebank/build_puzzles.py` turns the 550,000-row Lichess export in the sibling Laravel
repo into **92,976 curated puzzles, 33.0 MB**, deterministically (same CSV in, byte-identical
SQLite out).

```bash
python tools/puzzlebank/build_puzzles.py         # repo-relative defaults
node tools/qa/puzzle_corpus_check.js             # 124 assertions
python tools/qa/corpus_mutation_test.py          # 14/14 mutants killed
```

Selection, per spec Part 3.2: drop `nb_plays < 50` and ratings outside 400–2800 → 22 bands of 100
points × the top 4,000 by `popularity × log10(max(nb_plays, 10))` → top up each of the 12 UI themes
to 3,000 → guarantee 2,000 mate-in-1s at 500–700 for the Streak/Turbo warmup → sweep in every theme
rarer than 1,000 rows entire → renumber densely by `(rating, lichess_id)`, index, `VACUUM`.

Three things worth knowing:

- **The total is 92,976, not the spec's estimated 95,000–105,000.** The spec's own step-2 arithmetic
  fixes the base at 22 × 4,000 = 88,000 and every later step is a *floor*, not a target, so the
  rules as written produce ~93k. The rules were implemented; the prose was an over-estimate.
- **`anastasiaMate` (636 rows) is rare by the rule but missing from the spec's list of twelve.**
  The build computes the rare set from the corpus rather than reading the list, and prints a note
  whenever the two disagree.
- **Both theme tables are `WITHOUT ROWID`.** That is a storage class, not a schema change — the
  columns, constraints and every Part 7 query are identical — but it is the whole difference
  between the spec's literal schema at 50 MB and the 33 MB that fits its own 25–35 MB budget:

  | structure | with rowid | `WITHOUT ROWID` |
  |---|---|---|
  | `puzzles` + `idx_puzzles_rating` | 11.2 MB | — |
  | `puzzle_themes` | 21.2 MB | **13.5 MB** |
  | `theme_rating_index` | 17.4 MB | **8.0 MB** |

The generated DB is **committed on purpose**, unlike `Goldens/`: `codemagic.yaml` builds the iOS app
from a clone of this repo alone and never sees the source CSV.

### The browser's corpus

A page cannot load a 33 MB binary, so the same build emits `web-demo/js/puzzle-data.js` — a
**1,912-puzzle slice** covering every rating band, every UI theme, the mate-in-1 warmup range and a
400-day prefix of the daily pool. It flags itself (`isSlice: true`) and carries `corpusTotal` /
`dailyPoolTotal` so a demo-only shortfall can never be mistaken for a corpus bug. Same generated
-data pattern as `eco-data.js`.

---

## The pure layer

Three modules, all Foundation-only and all written in JavaScript first, proven in Node, then
transliterated — `swift` is not on PATH on the authoring checkout.

### `PuzzleSession` · `web-demo/js/puzzle-session.js`

The one solver core all five modes configure (Part 5). No timers, no sounds, no database, no view:
every operation is a synchronous transition that **returns** what should happen next ("play the
capture sound", "let the opponent reply in 500 ms", "the run is over"), and the caller owns the
clock. The spec's `after(opponentDelay) { … }` closures become returned numbers, which is what
makes all five modes assertable with no test doubles.

- **The move convention (5.1):** `moves[0]` is the **opponent's**, so the FEN's side-to-move names
  the opponent and the solver is the other colour; `moveIndex` starts at 1 and advances by 2.
- **The checkmate short-circuit (5.4 rule 1):** any move delivering immediate mate is correct, even
  off-book, checked before the string comparison. This is what prevents "I mated him but the app
  said wrong" when the stored line mates a different way.
- **The five wrong-move policies (5.5)** are held as *data*, so the spec's table reads off them line
  for line. Turbo is the outlier: it does **not** undo.
- Retry returns `restartClock` and `sound: .gameStart`, so the caller cannot forget either the way
  the original did (fixes (a) and (b) in Part 10.3).

One dead branch is ported deliberately: 5.4's inner "the opponent's reply was the last move" case is
unreachable for an even move count, and the corpus gate proves every count is even. It is kept so a
malformed puzzle terminates rather than hangs.

### `PuzzleSelection` · `web-demo/js/puzzle-store.js`

`PuzzleServing` owns the ladders and is array-based; a 93,000-row bundle cannot be. `PuzzleSelection`
expresses the same three ladders over a five-method `PuzzlePool`, so the device answers each tier
with an index seek. `ArrayPool` implements that protocol by calling `PuzzleServing`'s own helpers,
and the parity group asserts the two agree over 420 (centre, window, theme, seen) combinations —
which is what makes the reuse a proof rather than a claim.

`SQLitePuzzlePool` (in `DemoApp/Sources/BiyaherongUI/PuzzleStore.swift`) is the device's pool. Its
tier-1/tier-2 queries return a bounded random sample (`ORDER BY RANDOM() LIMIT 256`) rather than
every match: that is still a uniform pick once composed with a uniform picker, and emptiness — the
only thing the ladder branches on — is preserved exactly.

**No prefetching.** The original kept a 20-deep buffer in rated mode and a 12-deep buffer with six
parallel HTTP fetches in Turbo, purely to hide network latency. A local read is sub-millisecond.
Turbo's single lookahead needs no API: it calls `nextStreak` while the current puzzle is on screen
and holds the one result.

### `PuzzleProgress` · `web-demo/js/puzzle-progress.js`

Every Part 4 record shape, field for field, as `Codable` structs — but **Codable + JSON, not
SwiftData**. The app already persists the Analysis Board's library that way and a second persistence
stack would buy nothing. `now` (epoch ms) is injected, the same convention `AnalysisStore` uses,
which is what makes the day boundary and the 24-hour draft TTL assertable.

The daily-goal predicate (Part 15.1 — "Turbo is excluded") lives in exactly one function,
`PuzzleSession.countsTowardDailyGoal`, and is called from one place.

---

## How to test it

```bash
python tools/puzzlebank/build_puzzles.py      # rebuild the corpus (~9 s)
node tools/qa/puzzle_corpus_check.js          # 124  — quotas, indexes, engine replay
node tools/qa/puzzle_core_test.js             # 371  — session, selection, progress
node tools/metrics/extract_puzzle_styles.js   # regenerate puzzle_styles.json (no-op on a clean tree)
node tools/qa/puzzle_screen_test.js           # 117  — the three screens, rendered in a fake DOM
node tools/qa/replay_puzzle_core.js           # 530  — the Swift, checked against the JS
node tools/qa/js_goldens.js                   # all of the above plus everything else
node tools/qa/swift_lint.js
python tools/qa/corpus_mutation_test.py       # 14/14
node tools/qa/puzzle_core_mutation_test.js    # 35/35
```

On a Mac: `swift build && swift run ParityRunner` → exit 0, including the three new groups
(`puzzle_session`, `puzzle_selection`, `puzzle_progress`). **The Swift has not been compiled** —
see the note in `CHANGELOG.md`.

### What the gates are actually for

- **`puzzle_corpus_check.js`** — every later assertion in this feature is stated against the corpus,
  so a truncated or mis-filtered DB would make all of them pass while the app served nothing. Its
  strongest check is not a count: it replays whole puzzle lines through `web-demo/js/engine.js` and
  proves every stored move is legal and that `moves[0]` belongs to the opponent.
- **`replay_puzzle_core.js`** — the standing mitigation for Swift written blind. It pulls the
  fixtures and constant tables out of the Swift *source text* and re-derives them from the JS. It
  also confirms every fixture is a real shipping-corpus row, resolved by `lichess_id`.
- **The mutation suites** — a suite that passes proves nothing until you have seen it fail.

---

## The screens (Phases B and C)

### Where the numbers come from

`tools/metrics/extract_puzzle_styles.js` walks all **eleven** RN puzzle screens into a committed
`tools/metrics/puzzle_styles.json` — 442 style keys, 1,694 properties, 103 inline overrides, 7
render functions, 66 colours. `PuzzleMetrics.swift` and `web-demo/js/puzzle-metrics.js` encode what
the screens draw and are asserted against it (242 assertions). **No numeric literal appears in any
view body**, in either language.

The extraction is not ceremony. It proved three things the spec got wrong, each of which a
transcriber would have shipped:

1. **The "standard header" is not standard** — eight distinct shapes across eleven screens, and
   Part 1's numbers match only the Play Puzzles home.
2. **"Next Puzzle →" has two margins**, a StyleSheet `marginBottom: 8` and an inline `marginTop: 8`
   at three call sites. The spec mentions one.
3. **The mode tiles are hex bytes** (`+ '22'`, `+ '55'`), not the rounded 13% / 33% the spec quotes.

All three are recorded in `PORTING_NOTES.md`.

### The three screens

| Screen | Spec | Files |
|---|---|---|
| Puzzle Hub + daily-goal strip | Parts 9, 15.2 | `web-demo/js/puzzle-hub.js` |
| Play Puzzles Home | Part 10.1 | `web-demo/js/puzzle-home.js`, `PuzzleStats.swift` |
| Play Puzzles Solver + engine panel | Parts 10.2, 10.3, 18 | `web-demo/js/puzzle-solver.js` |
| Daily Puzzle home + solver | Part 11 | `web-demo/js/puzzle-daily.js` |
| Thematic grid + solver | Part 12 | `web-demo/js/puzzle-thematic.js` |
| *(shared by every solver)* | Part 1 | `web-demo/js/puzzle-board.js` |

The solver contains almost no logic: `PuzzleSession` owns validation and the five wrong-move
policies, `PuzzleSelection` picks the puzzle, `PuzzleProgress` moves the Elo. What is left is DOM,
timers and sound — the parts a headless suite genuinely cannot check. That split is load-bearing:
the moment a number or a rule appears in a screen file, it stops being covered and nothing says so.

Spec fixes the screens carry: the info strip is **one enum**, so "✅ Solved!" and "💡 Viewing
Solution" can never share a 34pt strip (#11) · the clock is derived from wall-clock and restarts on
Retry (#2), which plays the game-start sound (#3) · the rating delta survives a retry · the `↻`
button genuinely re-runs (#4) · the arrows are drawn inside the board's own square-space viewBox,
so the overlay cannot drift from the board the way the RN pair does (#12).

**Day one** shows the rating card and one invitation rather than four blank charts — a decision,
not an omission. An empty sparkline over 0.0% accuracy over seven flat bars reads as a broken
dashboard rather than a new one.

### The Puzzle Hub

It now opens the Hub. The ten hand-made samples in `web-demo/js/puzzles.js` are retired: they use
the **opposite** move convention (`solution[0]` is the solver's; the corpus has `moves[0]` belonging
to the opponent), so the two could never share a solver.

### The solver factory

`puzzle-board.js` owns what every mode repeats — the `<chess-board>`, the rules adapter, the mount
sequence, the submit pump and the engine — and nothing else. It is a **factory**, not a singleton:
`puzzle-solver.js` was written as an IIFE with twelve module-level variables, which is fine for one
screen and wrong for five, because two solvers alive at once would share `session`, `timers` and
`engineToken`.

Chrome stays with each mode. That is not laziness — the RN source has four separate solver files
for the same reason, and the chrome is genuinely all that differs: Daily has a banner, Thematic a
stats bar, Streak a result overlay, Turbo a clock and lives.

### What Phase D found in phases B and C

Six things, none of which had failed anything:

1. `bottomPanel(phase)` offered Streak and Turbo a Retry their own `WRONG_POLICY` forbids. It now
   takes the mode and derives the row from the policy.
2. One promotion scrim was encoded where Part 2 has two (0.80, and 0.82 for Streak and Turbo).
3. `RushEndReason` was a free string in JS where Swift has an enum.
4. `rushBest` was keyed by number in JS and by `String` in Swift — the same slot under two names.
5. **`StreakEngine.increment` was dead code** and had no JS twin, so the streak never ramped.
6. **The anti-reroll lock had no writer and no reader**, and Streak and Thematic solves credited
   nothing toward the daily goal.

Five and six are the ones worth remembering: the code existed, was correct, was golden-pinned — and
nothing called it. A pure function nobody calls is documentation, not behaviour.

### Still to do on the iOS side

The SwiftUI **views** — `PuzzleHubScreen`, `PuzzlePlayHomeScreen`, `PuzzleSolverScreen` and its VM —
and the `PhoneView` / `AppShell` rewiring are **not written yet**. The presentation layer they
consume (`PuzzleMetrics.swift`) and the statistics they draw (`PuzzleStats.swift`) are, and both are
checked against the JS by `replay_puzzle_core.js`. They are the first item of the next pass.

## Puzzle Streak (Part 13)

`web-demo/js/puzzle-streak.js`. Sudden death: one wrong move ends the run.

**Home** — the 46pt display over three stat cards (`🏆 Best`, `🔥 Current`, `♟ ∞ No Timer`), then
**Recent Runs** where the source had a leaderboard: the last ten runs, newest first, with a relative
date and a `🏆` on any run equalling the best. The start button reads "🔥 Resume / New Streak" and
raises the resume modal only when a run is actually live.

**Solver** — the live `🔥 n` counter, the stats bar, the board, the hint line. The header's
right-hand mark is the gold ring (`.pzd-logo`); it used to be a bare `Color.clear` with a width and
no height in Swift, which made the header greedy and pushed the whole screen into the middle of the
phone. See [`chessboard.md`](chessboard.md) — that bug and the board's `min(w, h)` sizing are what
the layout gate now guards. Two more things about the solver are deliberate and easy to undo by
accident:

* **A correct solve plays no sound.** In a streak the reward is the next puzzle appearing.
  `game-over` fires on failure instead. Asserted in `puzzle_screen_test.js` by reading the source
  of `onSolved`, because "no sound" is not otherwise observable.
* **The pending lock is honoured on entry.** `PuzzleProgress.pendingStreakPuzzle` is read before
  anything is served, so leaving the screen and coming back hands back the *identical* puzzle. That
  is Part 22.6 — without it, backing out is a free reroll of a hard puzzle.

On failure: the result overlay (`Game Over`, the streak, the best, and the 🏆 NEW BEST badge when
`isNewBest`), then **💡 Show Solution**, which removes the overlay entirely, highlights the answer
two-toned on the board and prints it as `E2 → E4` — with ` (=Q)` when the UCI carries a promotion.

### `bestBefore`

The run captures `state.streak.bestStreak` when it **starts** and hands that to `endStreakRun`.
`StreakEngine.increment` raises `bestStreak` on every solve, so comparing against the live value at
the end makes `isNewBest` unreachable-false and the badge dead. The argument is mandatory in both
languages; calling without it throws.

## Puzzle Turbo (Part 14)

`web-demo/js/puzzle-turbo.js`, over `turbo-run.js` / `TurboRun.swift`.

**Mode select** — the info bar, three tabs each carrying their own best, Recent Runs filtered by the
selected tab, and a start button in the selected mode's colour (set inline; the source's
`startButton` has no `backgroundColor`, which is why the extraction shows none). The resume prompt
is **infinite-only** and only for a draft under 24 h old with a score on it — a timed run cannot be
paused, so a draft of one would be meaningless.

**Run** — the four-band clock (`∞` purple · >30 s green · ≤30 gold · ≤10 red), three life dots, the
board, the hint line, and the ✓/✕ feedback dot. Wrong moves **do not undo**: the piece stays where
it landed, per `WRONG_POLICY.turbo`.

### The run engine

| | |
|---|---|
| start | `min(800, max(400, rating − 500))` — 700 for a default 1200 |
| warmup | first **5** puzzles at 600 / `mateIn1`. Streak's warmup is **10** |
| solve | score +1, target `min(2500, +50)` |
| miss | a life, and target `min(2500, +10)` — still **up** |
| over | 3 mistakes, or the clock |

The clock is derived from `startedAt`, never accumulated from ticks; the interval only repaints.
`formatClock` prints `3:00` (minutes unpadded) and is separate from `PuzzleDisplay.formatTime`'s
`03:00`.

### One exit

`finish(reason)` is the only way out of a run, and it is the only place `endRushRun` is called —
asserted by counting the calls in the source. It always goes through `TurboRun.end`, which is
**idempotent**: the first reason wins. That single door is spec fixes #5, #6 and #13 together —
the original recorded nothing on a quit, wrote a second history row when the clock and the
navigation both fired, and hardcoded "Time's Up!" on a results screen that had no idea why the run
had stopped.

Leaving mid-run follows Part 14.5's own split: **infinite** saves a resumable draft; a **timed** run
ends and is recorded as `backgrounded`.

### The feedback dot

Built from `turboRun.renderConstants.renderMoveFeedback` as **signed terms** — `left` subtracts
`r * 1.4`, `top` adds `r * 0.4` — because a transcribed sign is what once shipped the annotation
badge in the wrong corner in *both* languages. The flip is asymmetric too: `col = black ? 7 - file
: file` but `row = black ? rank : 7 - rank`. Both signs have their own mutant.

## How to test

```bash
node tools/qa/js_goldens.js               # the whole gate, including TurboRun and PuzzleScreens
node tools/qa/puzzle_screen_test.js       # all nine web-demo screens
node tools/qa/puzzle_core_mutation_test.js
node tools/qa/board_component_test.js     # the regression check on highlightSolution
node tools/qa/replay_puzzle_core.js       # the Swift, against the JS that ran
```

In the browser: **Streak** — solve a few, leave and re-enter and confirm *the same puzzle comes
back*, then fail one and check the overlay, the badge, the strip and the `E2 → E4` formatting.
**Turbo** — start a 3-minute run, watch the clock turn gold at 30 s and red at 10 s, confirm a wrong
move leaves the piece where it landed under a red ✕, spend all three lives, and confirm the results
say **"Out of Lives!"** and not "Time's Up!". Then start an infinite run, leave mid-run, and confirm
the Resume prompt offers it back.

## Sound and haptics (Part 16)

The puzzle path has **four** sounds, and that is narrower than it looks like it should be.
`hooks/usePuzzleSound.ts` loads `gameStart`, `move`, `capture` and `gameOver`; `playMoveSound` is
capture-or-move with no check and no castle case. `check.mp3` and `castling.mp3` both ship and the
hub never reaches them — that chain belongs to the Play screen's `SoundManager`. Pinned in
`PuzzleMetricsSource` so it does not get "fixed".

| Mode | on mount | per move | on a correct solve | on the run ending |
|---|---|---|---|---|
| Play | `game-start` | capture/move | **`game-over`** | — |
| Daily | `game-start` | capture/move | **`game-over`** | — |
| Thematic | `game-start` | capture/move | **`game-over`** (both branches) | — |
| Streak | `game-start` | capture/move | *nothing* | `game-over` |
| Turbo | `game-start` | capture/move | *nothing* | `game-over` |

The split is not arbitrary: the first three are one-puzzle-at-a-time, so finishing *is* the event.
Streak and Turbo are runs — chiming per solve would fire `game-over` dozens of times.

**The haptic** is one `ImpactFeedbackStyle.Light` on **pickup**, in the shared board, after three
guards: the square holds a piece, it belongs to the side to move, and it passes the colour filter.
Never on drop, never on a right or wrong answer. `web-demo` uses `navigator.vibrate` (genuinely a
no-op on desktop and iOS Safari — the call site is what is being kept correct); `ios/` reaches the
same decision through `PuzzleHaptics.onPickup`.

### The wiring bug this phase existed to find

For four phases every screen did `typeof Sound !== 'undefined' ? Sound : null`. The global is
`SoundManager`. `SND` was permanently `null` and **nothing in the hub had ever made a sound** —
under 22,000 passing assertions, because they all checked that the sound code *runs*. It ran; it
ran into a null. The tests are now end-to-end (patch the player, drive a screen, require a sound
out the other side) and a mutant reverting the global's name must stay killed.

## Timings (Part 17)

Every delay is asserted against the `setTimeout` in the RN source that actually schedules it —
the opponent reply against the call that schedules the opponent, not against a number written down
here.

| | Play | Daily | Thematic | Streak | Turbo |
|---|---|---|---|---|---|
| opponent reply | 500 | 400 | 500 | 500 | 300 |
| finish delay | 500 | 400 | — | — | — |

Plus the wrong-move banner at 1300 (Daily), the Turbo feedback dot at 500, the Turbo advance at
500, and a 1000 ms clock tick. The six `controller.abort()` network timeouts in the source are
recorded by the extractor and deliberately absent from the port.

## Part 22 acceptance checklist

Mechanical, run by `node tools/qa/js_goldens.js`:

- [x] **22.2** no hostname, `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource` in any of the
      feature's 17 files — checked, not assumed, because the RN source really does call chess.com
- [x] **22.6** leaving the Streak solver and returning hands back the *identical* puzzle
- [x] no prefetch buffer — Turbo keeps one lookahead
- [x] every sound a screen requests is one of the four real keys
- [x] every `--pz*` CSS property the stylesheet reads is written by a screen
- [x] every delay matches the source call site that schedules it

By hand in the browser, with audio on:

- [ ] every mode is audible; Play/Daily/Thematic chime on a correct solve, Streak and Turbo do not
- [ ] Streak chimes when the run ends (a wrong move), Turbo when the run ends (lives, clock or quit)
- [ ] Turbo's clock turns gold at 30 s and red at 10 s
- [ ] a wrong Turbo move leaves the piece where it landed, under a red ✕
- [ ] three lives spent → **"Out of Lives!"**, not "Time's Up!"
- [ ] an infinite run left mid-way is offered back by Resume; a timed one is not
- [ ] piece pickup buzzes on an Android device
- [ ] Play, the Analysis Board and the Play screen are untouched

## The Swift side

`PuzzleHubStore` is the single source of truth — the twin of `web-demo/js/puzzle-app.js`. It holds
`PuzzleProgressState`, owns the `SQLitePuzzlePool`, persists to Application Support as JSON, and
every `serve*` **serves, commits `seen` and writes in one step** so no caller can forget the middle
one. Before it, five Core engines (`PuzzleProgress`, `TurboRun`, `PuzzleStats`, `DailyGoal`,
`PuzzleServing`) were golden-tested and called by nothing.

| File | Screens |
|---|---|
| `PuzzleHubScreen.swift` | the hub, the goal ring, and the ten pushed routes |
| `PuzzleSolverParts.swift` | `PuzzleSolverEngine`, the header, the board band, the bottom panel, the engine panel, the modal |
| `PuzzlePlayScreens.swift` | Play home and the rated solver |
| `PuzzleDailyScreens.swift` | Daily home and solver |
| `PuzzleThematicScreens.swift` | the 12-theme grid and solver |
| `PuzzleStreakScreens.swift` | Streak home and solver |
| `PuzzleTurboScreens.swift` | Turbo mode select and run |

**The rule that keeps it checkable:** no numeric literal and no arithmetic in any view body. Every
number is a `PuzzleMetrics` constant. Coverage drains out of `PuzzleMetricsCheck` the moment that
slips.

Screens **ask** the shared derivations rather than restating them —
`PuzzleDisplay.bottomPanel(_:mode:)` decides the buttons from `WRONG_POLICY`, and the Turbo advance
delay arrives in the wrong-move outcome. Sounds go through `PuzzleSounds`, never
`SoundManager.playMove` (whose check/castle chain is the Play screen's). Haptics go through
`Haptics.play(.pickUp)`.

### Two promotion dialogs

The Analysis Board's and the hub's share a purpose and not one measurement:

| | Analysis (`board.tsx`) | Puzzle hub |
|---|---|---|
| scrim | 0.7 | 0.80 / **0.82** for Streak and Turbo |
| card | `#37474F` r16 p20 | `#1A2942` r20 p24 w280 |
| title | "Promote to:" 16pt | "Choose Promotion" 18pt centred |
| options | row of 60pt unlabelled tiles | column of labelled accent rows |

Hence `AnalysisPromotion` / `PuzzlePromotion`, `PromotionOverlay` / `PuzzlePromotionOverlay`, and
`<chess-board>`'s `promotionLayout` (`'row'` default, `'list'` for the hub).

## Checking Swift without a compiler

`swift` is not on PATH here, so four tools stand in. **Run them with no arguments** — narrowing
degrades two of them, and `swift_lint.js` says so out loud after that trap cost a false green.

```bash
node tools/qa/swift_lint.js           # brackets, and public-exposes-internal
node tools/qa/swift_symbol_check.js   # every Namespace.member and every Puzzle*/Analysis* type
node tools/qa/replay_puzzle_core.js   # ~1,000 constants + string-table parity, against the JS
node tools/qa/replay_puzzle_vm.js     # the screens' BRANCHES, against the JS
```

`replay_puzzle_vm.js` is the one that catches a wrong decision rather than a wrong name: Streak's
silence on a solve, the anti-reroll lock read before serving, `bestBefore` at run start, Turbo's
single idempotent exit, out-of-lives beating the clock, and Thematic never touching Elo.

On a Mac: `swift build` · `swift run ParityRunner` · `swift run PuzzleMetricsCheck` ·
`swift run PieceArtCheck` · `cd ios && xcodegen generate`.

## Pending

Nothing in this feature. The only outstanding step is `swift build` on a Mac — no Swift in this
repo has been compiled.
