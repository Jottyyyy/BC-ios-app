# Pairing engine (Book Two, spec 1.7–1.9)

Swiss pairing, round-robin schedules and tie-breaks, as one pure module with no I/O, no storage and
no UI. This is the piece of the Pairing Manager that can be *proven* on the Windows checkout, so it
was built first and the screens come after.

## What it does

| Area | Rule |
|---|---|
| Colour preference | absolute (spread ±2, or two of a colour running) · strong (±1) · mild (last game) · none |
| Pairing rank | `score ↓, rating ↓, name ↑, seed ↑` — **not** the standings order |
| Round 1 | rated fold when **≥ 50 %** of the field is rated, otherwise alphabetical |
| Byes | lowest-ranked bye-less player, last board, 1 point, no colour, not a win |
| Brackets | score groups, with downfloats chosen from float history |
| Matching | minimum-cost perfect matching; the cost *is* the priority ladder |
| Round robin | standard circle method + a colour-balancing pass (Berger) |
| Tie-breaks | Buchholz · Buchholz Cut-1 · Sonneborn-Berger · direct encounter, all `Double` |

## The priority ladder

Every FIDE rule is a term in one cost function, and their **order** is the algorithm:

```
repeat pairing  >  absolute colour  >  repeat downfloat  >  score difference  >  colour imbalance
     1e7               5e4                  1.2e4                1e4                  1e2
```

The values are arbitrary; the ordering is not, and it is asserted directly (`P.costs`) because
whole-tournament properties cannot see it — dropping the re-float penalty below a score point moved
three pairings out of hundreds, which no aggregate assertion noticed.

Nothing is ever *forbidden*, only priced. That is what makes graceful degradation possible: in a
nearly exhausted field the engine still returns a legal round, and every compromise it made comes
back as a warning (`repeatPairing`, `absoluteColorViolated`, `repeatBye`). Warnings are read off the
**result**, never guessed from what the search did, so a warning cannot disagree with its pairing.

## Key files

| Path | Role |
|---|---|
| `web-demo/js/pairing-engine.js` | the engine |
| `tools/qa/pairing_test.js` | 1,560 assertions; registered in `js_goldens.js` |
| `tools/qa/puzzle_core_mutation_test.js` | ten pairing mutants, all killed |

## How to test

```bash
node tools/qa/pairing_test.js               # the suite alone
node tools/qa/js_goldens.js                 # the full gate (37 suites)
node tools/qa/puzzle_core_mutation_test.js  # 92/92 mutants killed
```

The suite simulates **whole tournaments** — 5, 6, 7, 12 and 30 players against four deterministic
result patterns (`higherWins`, `allDraws`, `whiteWins`, `alternating`) — and asserts properties of
the finished event rather than checking one worked example.

## Two places the spec's acceptance criteria were not achievable as written

Both are recorded in `PORTING_NOTES.md`; they are stated here because a reader of the tests will
notice the assertions are not literally the spec's.

1. **`|whites − blacks| ≤ 1` is stricter than FIDE and cannot be met.** One round is enough to show
   why: after round 1 of a 12-player event where every White wins, all six players on 1 point share
   the history `[White]`, and they are each other's only same-score opponents. Whoever the engine
   pairs, three of the six take White again. FIDE C.04.1 asks for `≤ 2` and *never three in a row*
   instead, and that is what is asserted.

2. **"Nobody floats down twice running" is a preference, not a law** — FIDE relaxes it when no
   candidate satisfies it, and the spec's own 1.7.6 says the same. Asserted for fields of ten or
   more (below that, score groups are often singletons and someone must float every round), and at
   most one unavoidable case per tournament. That the engine *prefers* a fresh floater is pinned
   down directly by the `chooseFloater` unit tests and by the cost-ladder assertions.

## Status

Engine and tests only. Still to come: the Swift twin
(`Sources/BiyaherongCoachCore/PairingEngine.swift` + `tools/qa/replay_pairing.js`) and the Pairing
Manager screens in both `web-demo/` and SwiftUI.
