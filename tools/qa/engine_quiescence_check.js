#!/usr/bin/env node
/*
 * engine_quiescence_check.js — the engine may not report a number it could improve with one capture
 *
 *     node tools/qa/engine_quiescence_check.js
 *
 * ## Why this file exists
 *
 * For three phases the search had NO quiescence at any depth the app ships. `negamax` called
 * `quiesce(pos, alpha, beta, ply)`, and `quiesce`'s fourth parameter was doing two incompatible
 * jobs — mate-distance scoring wants the distance from the ROOT, the `MAX_QDEPTH` budget wants a
 * counter that restarts at each leaf. `MAX_QDEPTH` is 6 and every shipped preset searches to depth
 * 8, 12, 18, 22 or 30, so `qdepth >= MAX_QDEPTH` was already true on entry: quiescence returned its
 * stand-pat having examined not one capture. The engine evaluated positions in the middle of trades.
 *
 * A client found it, from a screenshot: at the start position the four displayed lines were
 * `Nc3 -0.0`, `Nf3 -0.0`, `e3 -0.1`, `d4 -0.3`, with `e4` absent entirely. The third of those
 * genuinely stood at +8.4 — `Rxh2` wins the queen — and the engine could not see it because it
 * never looked past the last searched move.
 *
 * ## Why the existing suites could not catch it
 *
 * `analysis-engine.js`'s one quiescence assertion ran at `maxDepth: 2`. That is the ONLY band where
 * quiescence still worked (2 < 6), so it passed throughout. `engine_strength_check.js` scored
 * 115/120 the whole time, because its node budget caps most corpus positions at depth 5-6 — again
 * below `MAX_QDEPTH`. Two green gates, both structurally blind.
 *
 * So this one runs deliberately ABOVE `MAX_QDEPTH`, and asserts the property directly rather than
 * any number that could be re-baselined:
 *
 *   > No displayed line may report a score EQUAL TO THE STATIC EVALUATION OF ITS OWN SEARCHED LEAF
 *   > while a capture worth at least `HANGING_CP` is standing on the board at that leaf.
 *
 * When quiescence is dead every line satisfies the first half by construction — there is nothing
 * between the last searched move and the number on screen — so the invariant collapses to "is a
 * piece hanging at the horizon", which is exactly the bug. Measured at the time of writing: 6 of 18
 * lines violated it before the fix, 0 after.
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const E = require(path.join(JS, 'engine.js'));
const AI = require(path.join(JS, 'ai.js'));
const EV = require(path.join(JS, 'analysis-eval.js'));
const A = require(path.join(JS, 'analysis-engine.js'));

/** Above `MAX_QDEPTH`, and at the shallowest depth any shipped preset uses. */
const DEPTH = 8;
const LINES = 3;
/** One exchange. Below this a "hanging" piece is often a real sacrifice or a recapture. */
const HANGING_CP = 200;

const POSITIONS = [
  ['start position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['open midgame', 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 7'],
  ['sharp tactical', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6'],
  ['queens on', 'r2q1rk1/pp2ppbp/2n2np1/2Q5/3PP3/2N2N2/PP3PPP/R1B1KB1R w KQ - 0 10'],
  ['kings indian', 'r1bq1rk1/ppp1ppbp/2np1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQK2R w KQ - 0 8'],
  ['open sicilian', 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'],
];

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/**
 * The best capture available, by a one-exchange approximation: what it wins, minus what it loses if
 * the destination is defended afterwards. Not a full SEE — this only has to answer "is something
 * plainly hanging here", and a full swap-off evaluation would be a second engine.
 */
function bestHangingCapture(pos) {
  let best = 0, bestSan = '';
  for (const m of E.legalMoves(pos)) {
    const victim = pos.squares[m.to];
    if (!victim) continue;
    const mover = pos.squares[m.from];
    const after = E.makeMove(pos, m);
    const recapture = E.isAttacked(after, m.to, after.sideToMove)
      ? AI.material(mover.kind) : 0;
    const gain = AI.material(victim.kind) - recapture;
    if (gain > best) { best = gain; bestSan = E.san(pos, m); }
  }
  return { cp: best, san: bestSan };
}

let checked = 0, violations = 0;
for (const [name, fen] of POSITIONS) {
  const pos = E.fromFEN(fen);
  if (!pos) { failures.push(`bad FEN for ${name}`); continue; }
  const snap = A.analyze(pos, { maxDepth: DEPTH, multiPV: LINES });

  for (const line of snap.lines) {
    // Walk only the SEARCHED prefix. `extendPV` appends plies past the horizon that the search
    // never scored, and comparing against one of those would be comparing against a different
    // position than the number describes.
    let leaf = E.clone(pos);
    const searched = Math.min(snap.depth, (line.pv || []).length);
    for (let i = 0; i < searched; i++) leaf = E.makeMove(leaf, line.pv[i]);

    const raw = EV.evaluate(leaf);
    const white = leaf.sideToMove === E.WHITE ? raw : -raw;
    checked += 1;

    // A score that is NOT its leaf's stand-pat came from somewhere past the horizon — which is
    // quiescence doing its job, and there is nothing to check.
    if (line.score.kind !== 'cp' || line.score.cp !== white) { passed += 1; continue; }

    const hang = bestHangingCapture(leaf);
    if (hang.cp >= HANGING_CP) violations += 1;
    expect(hang.cp < HANGING_CP,
      `${name}: line ${line.rank + 1} reports ${A.formatScore(line.score)} — exactly its own leaf's `
      + `stand-pat — with ${hang.san} available for ${hang.cp}cp. Quiescence did not run at depth `
      + `${snap.depth}. PV: ${(line.pvSAN || []).slice(0, searched).join(' ')}`);
  }
}

// The premise, asserted rather than trusted. Below MAX_QDEPTH the bug this file exists for is
// invisible — which is exactly how a `maxDepth: 2` assertion guarded quiescence for three phases.
expect(DEPTH > A.MAX_QDEPTH,
  `this battery runs at depth ${DEPTH} and MAX_QDEPTH is ${A.MAX_QDEPTH} — it MUST run above it, or `
  + 'it is testing the one band in which the bug cannot appear');
expect(checked >= 12, `${checked} lines examined — the sweep is not vacuous`);

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `EngineQuiescence: ${checked} lines at depth ${DEPTH}, none reporting a stand-pat with a `
      + `${HANGING_CP}cp capture on the board`
    : `EngineQuiescence: ${violations} horizon violation(s) over ${checked} lines\n`
      + failures.map((f) => '  x ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { run: () => result, selfTest: () => result };
