#!/usr/bin/env node
/*
 * engine_budget_check.js — no single synchronous chunk of search may freeze the UI.
 *
 *     node tools/qa/engine_budget_check.js
 *
 * The direct regression test for a reported bug: "may delay, hindi smooth ang paggalaw ng pyesa".
 * The cause was not the animation. The search ran on the main thread one whole DEPTH per
 * uninterrupted block, and a block is time during which nothing on the page can move — not a sliding
 * piece, not a dragged one, not a click. Measured on a midgame position before the fix:
 *
 *     depth 1    58 ms      depth 3   624 ms   (37 dropped frames)
 *     depth 2   112 ms      depth 4  2885 ms   (173 dropped frames)
 *
 * A served page now runs the engine in a Worker, so none of this touches the UI thread. But
 * `file://` cannot construct one, and that path is supported — it is only bearable because each
 * depth gets its own slice deadline, which the engine polls every 2048 nodes and so cuts the block
 * from the INSIDE.
 *
 * This times `BiyaEngineHost.slicedSteps` — the very stepper the browser pumps, not a copy of it —
 * over positions of genuinely different character. It fails loudly if anyone removes the per-depth
 * slice reset, raises the budget, or routes the in-thread path back through `analyzeProgressive`.
 *
 * Timing is machine-dependent, so the ceiling carries generous headroom over the measured worst
 * block (94 ms at an 80 ms slice). The point is to catch a 600 ms regression, not to police 20 ms.
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'web-demo', 'js', 'engine.js'));
const HOST = require(path.join(ROOT, 'web-demo', 'js', 'engine-host.js'));
const MET = require(path.join(ROOT, 'web-demo', 'js', 'analysis-metrics.js'));

const SLICE = MET.TIMINGS.inlineSearchBudget;
/** The slice, plus the 2048-node poll granularity, plus room for a slow or loaded machine. */
const CEILING = SLICE * 4;

// Deliberately spread: a quiet endgame searches deep and cheap, a sharp middlegame explodes. The
// midgame line is the exact position the 624 ms / 2885 ms numbers above came from.
const POSITIONS = [
  ['start position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['open midgame', 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 7'],
  ['sharp tactical', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6'],
  ['quiet endgame', '8/5k2/8/8/3P4/8/5K2/8 w - - 0 1'],
  ['rook endgame', '8/8/4k3/8/8/4K3/8/R7 w - - 0 1'],
  ['queens on', 'r2q1rk1/pp2ppbp/2n2np1/2Q5/3PP3/2N2N2/PP3PPP/R1B1KB1R w KQ - 0 10'],
];

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };
const report = [];

for (const [name, fen] of POSITIONS) {
  const pos = E.fromFEN(fen);
  if (!pos) { failures.push(`bad FEN for ${name}`); continue; }

  // One `next()` is one synchronous chunk — exactly the span during which the browser cannot paint.
  const steps = HOST.slicedSteps(pos, {
    maxDepth: MET.ENGINE_LIMITS.maxDepth,
    multiPV: MET.ENGINE_LIMITS.multiPV,
  });
  let worst = 0, chunks = 0, deepest = 0, snap = null, guard = 0;
  for (;;) {
    const t = Date.now();
    const r = steps.next();
    worst = Math.max(worst, Date.now() - t);
    chunks += 1;
    if (r.snapshot) { snap = r.snapshot; deepest = Math.max(deepest, r.snapshot.depth); }
    if (r.done) break;
    if (++guard > 32) { failures.push(`${name}: the stepper never finished`); break; }
  }

  report.push({ name, worst, chunks, deepest });
  expect(worst <= CEILING,
    `${name}: worst synchronous chunk ${worst}ms exceeds the ${CEILING}ms ceiling `
    + `(slice is ${SLICE}ms) — the UI would freeze for ${Math.round(worst / 16.7)} frames`);
  // A search that returns nothing would be "fast" for entirely the wrong reason.
  expect(deepest >= 1, `${name}: still reaches at least depth 1 inside its slices`);
  expect(snap != null, `${name}: still produces a snapshot`);
  expect(chunks >= 2, `${name}: yields at least once, so the browser gets a frame in between`);
}

// The slice has to be binding somewhere, or the budget is so loose it constrains nothing and this
// whole check proves only that the engine is fast on this machine.
expect(report.some(r => r.deepest < MET.ENGINE_LIMITS.maxDepth),
  'at least one position is depth-limited by the slice — otherwise the budget is not binding');

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `EngineBudget: ${passed} assertions passed — worst chunk `
      + `${Math.max.apply(null, report.map(r => r.worst))}ms over ${POSITIONS.length} positions `
      + `(ceiling ${CEILING}ms)`
    : `EngineBudget: ${passed} passed, ${failures.length} FAILED\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  for (const r of report) {
    console.log('  ' + r.name.padEnd(16)
      + 'worst chunk ' + String(r.worst).padStart(4) + 'ms'
      + '   depth ' + r.deepest
      + '   (' + r.chunks + ' chunks)');
  }
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
