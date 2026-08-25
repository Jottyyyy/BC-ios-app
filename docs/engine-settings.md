# Engine settings, and the engine behind them

**☰ > Engine**, on the Analysis Board. Five presets from Battery Saver to Infinite, plus an Advanced
section with the raw controls. Strength costs time, and time costs battery and heat; which trade to
make is the user's call, so it is a setting.

This doc covers both halves of that change: the panel, and the search that got stronger under it.

---

## The presets

| Preset | Think time | Depth ceiling | Lines | Review budget / position |
|---|---|---|---|---|
| Battery Saver | 0.5 s | 8 | 2 | 120 ms |
| **Balanced** (default) | 1.2 s | 12 | 3 | 200 ms |
| Strong | 3 s | 18 | 3 | 500 ms |
| Maximum | 8 s | 22 | 4 | 1200 ms |
| Infinite | until stopped | 30 | 4 | 1200 ms |

- **Balanced is exactly what the board did before this setting existed** — same 1.2 s, same three
  lines, same 200 ms per reviewed position. Only the depth *ceiling* rose, and the ceiling is not
  what binds. An install where nobody opens this panel behaves as it always has, just stronger.
- **The review budget is derived, not listed.** `reviewBudget(thinkMs)` is `thinkMs / 6` clamped to
  120…1200, which reproduces every value in that column. One number to get right instead of two.
- **Infinite deliberately does not apply to Analyze Game.** A 41-position review cannot be
  unbounded, so its per-position budget saturates at 1200 ms. The panel says so.

**Advanced** overrides all of it: Lines 1–5, Max depth 2–30, Think time 0.2–30 s. The Think time
slider's bottom step *is* Infinite — one control rather than a slider plus a checkbox that could
disagree with it. Editing any control switches Advanced on, because a control that silently did
nothing would be the panel lying.

## Why the deadline is the knob and depth is only a ceiling

Search cost is ~6× per ply and varies ~15× by position type, so a fixed depth is either too slow
somewhere or too shallow everywhere. Measured on this engine over the six positions
`tools/qa/engine_budget_check.js` uses:

| budget | depths reached | mean |
|---|---|---|
| 500 ms | 5 4 4 8 7 3 | 5.17 |
| 1200 ms | 6 4 4 12 8 4 | 6.33 |
| 3000 ms | 7 5 5 18 10 5 | 8.33 |
| 8000 ms | 7 6 6 22 11 6 | 9.67 |

Only the quiet endgame — the fourth column — ever reaches its ceiling. Everywhere else the clock
runs out first, which is the whole design. `maxDepth` exists so a nearly-empty board terminates.

> **These depths were measured while quiescence was dead** (see the 2026-08-25 entry in
> `CHANGELOG.md`), and they barely move now that it runs — the fix costs nodes at each leaf and wins
> more back in cutoffs. **What changed is not the depth but what the number means: a depth-8 score is
> now a real score.** Before the fix the search returned the static evaluation of its own leaf, taken
> in the middle of a trade, on every line at every preset. Re-measure this table before quoting it.

## What actually got stronger

Two changes, both in the search rather than the settings.

**A real evaluation** (`analysis-eval.js` → `AnalysisEval.swift`). The old one was material plus one
piece-square table, borrowed from the coach. The new one adds game phase (tapered mid/endgame
scoring), pawn structure (doubled, isolated, passed), king safety, mobility, the bishop pair, rooks
on open files, and a tempo bonus. The single biggest fix is the taper: with one king table for the
whole game the king was rewarded for hiding in the corner in a K+P endgame, where its job is to
march.

**A real search** (`analysis-engine.js` → `LocalEngine.swift`): transposition table, killers and
history, principal-variation search, check extensions, null-move pruning, late move reductions, and
MultiPV that stops paying full price for root moves it will never display. `analyzeSteps` also
became the core rather than a wrapper that re-ran `analyze` from depth 1 on every step.

Measured, at the same 1200 ms budget:

| | before | after |
|---|---|---|
| mean depth over the six benchmark positions | 3.83 | **5.00** |
| sharpest position ("queens on") | depth 2 | **depth 4** |
| corpus tactics found at 120k nodes | 105/120 (87.5%) | **117/120 (97.5%)** |
| tactics nodes/sec | 38.1k | **60.8k** |

Battery Saver at 0.5 s now reaches a mean depth of 5.17 — deeper than the *old* engine managed in
1.2 s. The coolest preset is stronger than what shipped.

## Two rules that keep the accelerators honest

Both are single lines, and both silently degrade the search if someone "simplifies" them:

- **A PV node never takes a table cutoff and is never null-moved.** A table hit returns a score with
  no moves attached, which would truncate the principal variation the panel displays; and null-move
  pruning is a guess, fine for proving a branch is bad and not fine for the line about to be shown.
- **A reduced search that beats alpha is always re-searched at full depth.** A reduction may skip
  work; it may never decide anything.

Determinism survives all of it. The table is per-search and cleared by size, never by clock, so the
same request twice returns identical lines *and* an identical node count — asserted in both
`analysis-engine.js`'s self-test and `engine_strength_check.js`.

## What is deliberately NOT covered by the preset

- **Play vs Coach.** `CoachEngine.levelConfig` is the spec's difficulty ladder and has its **own**
  clock now — 0.3/0.6/1/2/4 s at depths 2/4/7/10/15. A preset that scaled the coach would mean a
  Level 1 "beginner" on Maximum, which is not a beginner.

  It used to be one flat 1 s cap for all five. Because depth is only a ceiling, the clock is what
  really sets strength, so a flat clock meant a flat ladder at the top: the table above shows a mean
  depth of 6.33 at 1200 ms, and levels 4 and 5 ask for 10 and 15. They got neither, and played
  identically. Level 3 still gets exactly 1000 ms, so the middle of the ladder is unchanged and the
  new table is anchored to the old behaviour at one point. A deviation, recorded in PORTING_NOTES.md.

  This bullet previously said the coach "reads the same evaluation improvements only through
  `ChessAI`". That was **wrong about the shipping app**: `CoachStore.swift` calls
  `LocalEngine().analyze(...)`, so Play vs Coach has been running this engine and `AnalysisEval` all
  along. `ChessAI` is reachable only from the macOS demo's `Panel.play` harness and the parity tests.
- **The puzzle hint panel.** It keeps the default limits and its own 3 s budget: the Analysis
  Board's preset is that screen's setting, not the Puzzle Hub's.
- **`ChessAI.evaluate`.** Parity-pinned to the five coach personas. `AnalysisEval` sits beside it,
  exactly as `CoachEngine` sits beside `ChessAI`, and only `LocalEngine` uses it.

## Key files

| File | What it holds |
|---|---|
| `Sources/BiyaherongCoachCore/EngineSettings.swift` | the preset table, clamping, resolution, the panel model, encode/decode |
| `Sources/BiyaherongCoachCore/AnalysisEval.swift` | the analysis-only evaluation and the Zobrist keys |
| `Sources/BiyaherongCoachCore/LocalEngine.swift` | the search: table, killers, PVS, extensions, null move, LMR |
| `DemoApp/…/AnalysisEngineSettings.swift` | the SwiftUI sheet + the `UserDefaults` adapter |
| `DemoApp/…/AnalysisMetrics.swift` | `AnalysisEngineStyle` (panel geometry), `AnalysisEngineLimits` (the Balanced defaults) |
| `DemoApp/…/AnalysisVM.swift` | `engineSettings`, the two read sites (`runAnalysis`, `startReview`), the ☰ row |
| `web-demo/js/engine-settings.js` | the JS twin of `EngineSettings` |
| `web-demo/js/analysis-eval.js` | the JS twin of `AnalysisEval` |
| `web-demo/js/analysis.js` | `showEngineSettings()` and the two read sites |

The panel is **data, not a view**: `EngineSettings.panelModel` decides which rows exist, what they
say, which is selected and what each control's range is. Both the SwiftUI sheet and the web one just
render it. That is the only way the two panels can be the same panel on a checkout with no Swift
compiler and no reachable browser.

## How to test

```bash
# The pure layers, in Node
node -e "console.log(require('./web-demo/js/engine-settings.js').selfTest().summary)"
node -e "console.log(require('./web-demo/js/analysis-eval.js').selfTest().summary)"
node -e "console.log(require('./web-demo/js/analysis-engine.js').selfTest().summary)"

# Did it actually get stronger, and is it still deterministic
node tools/qa/engine_strength_check.js

# Does the Swift say the same thing as the JS
node tools/qa/replay_engine_settings.js

# No preset may freeze the UI on the file:// path
node tools/qa/engine_budget_check.js

# Everything
node tools/qa/js_goldens.js
node tools/qa/swift_lint.js && node tools/qa/swift_symbol_check.js
```

In the browser: open `web-demo/index.html`, **☰ → Engine**. Switch Battery Saver → Maximum and watch
the depth chip climb; open **Advanced** and confirm the sliders commit on release, not mid-drag;
pick **Infinite** and confirm the depth keeps rising until 💡 stops it. Reload and confirm the choice
persisted (it is in `localStorage` under `biya.analysis.engine.v1`). Drag pieces at every preset —
the board must stay smooth, which is what `engine_budget_check.js` guards.

On a Mac: `swift build && swift run ParityRunner`, then `cd DemoApp && swift run DemoApp`.
