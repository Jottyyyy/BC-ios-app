#!/usr/bin/env node
/*
 * engine_strength_check.js — the analysis engine must actually find tactics.
 *
 *     node tools/qa/engine_strength_check.js
 *
 * ## Why this exists
 *
 * The search grew a transposition table, killers, history, principal-variation search, check
 * extensions, null-move pruning and late move reductions. Every one of those makes it *faster*, and
 * the last two can make it *wrong*: null-move pruning and LMR both decide, on a guess, not to look
 * at a move. A guess that goes bad does not throw, does not fail an assertion about PV legality or
 * MultiPV ordering, and does not change a single number in `analysis-engine.js`'s own self-test. It
 * just quietly stops seeing a combination.
 *
 * Nothing else in this repo would notice. `analysis-engine.js` proves the search is well-formed;
 * `engine_budget_check.js` proves it does not freeze the UI; neither asks whether it plays well.
 * So: hand it positions with a known best move and count.
 *
 * ## Where the positions come from
 *
 * The bundled puzzle corpus, which `tools/qa/puzzle_corpus_check.js` already replays through the
 * engine move by move — so the FENs are valid and the solutions are real. `moves[0]` belongs to the
 * OPPONENT (puzzle-session.js:13), so it is played first; the engine must then find `moves[1]`.
 * They are sampled deterministically across the whole rating range, so this is not a set of
 * positions chosen because the engine passes them.
 *
 * ## Why a NODE budget and not a clock
 *
 * A wall-clock budget would make this machine-dependent, and a gate that fails on a slow laptop is
 * a gate people turn off. Nodes are exactly reproducible, which is the same reason `SearchLimits`
 * has `maxNodes` at all.
 *
 * ## The floor
 *
 * Measured before this work: 105/120. After: 115/120. The floor is set at 108 — comfortably above
 * the old engine, comfortably below what it now does, so it catches a real regression without
 * failing on a one-puzzle wobble. Raise it if the engine gets better; do NOT lower it to make a run
 * pass, for the same reason `requireMinCounts` floors are never lowered.
 */
'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const E = require(path.join(JS, 'engine.js'));
const A = require(path.join(JS, 'analysis-engine.js'));
const PD = require(path.join(JS, 'puzzle-data.js'));

/** Reproducible on any machine, unlike a deadline. */
const NODE_BUDGET = 120000;
const SAMPLE = 120;
const SOLVED_FLOOR = 108;
/** Below this rating the engine should be near-perfect; a miss here is a real bug, not a wobble. */
const EASY_RATING = 1200;
const EASY_FLOOR = 1.0;

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };

/** A deterministic spread across the rating range: sort, then take every k-th. */
function sample(n) {
  const all = PD.puzzles.slice().sort((a, b) => a.rating - b.rating || a.id - b.id);
  const step = Math.max(1, Math.floor(all.length / n));
  const out = [];
  for (let i = 0; i < all.length && out.length < n; i += step) out.push(all[i]);
  return out;
}

function run() {
  passed = 0; failures.length = 0;

  const puzzles = sample(SAMPLE);
  expect(puzzles.length === SAMPLE,
    `the corpus yielded ${puzzles.length} sample puzzles, wanted ${SAMPLE}`);

  let solved = 0, tried = 0;
  let easySolved = 0, easyTried = 0;
  const missed = [];

  for (const p of puzzles) {
    let pos = E.fromFEN(p.fen);
    if (!pos) { failures.push(`puzzle ${p.id} has an unparseable FEN`); continue; }
    const setup = E.parseUci(pos, p.moves[0]);
    if (!setup) { failures.push(`puzzle ${p.id}'s opponent move ${p.moves[0]} is not legal`); continue; }
    pos = E.makeMove(pos, setup);

    const snap = A.analyze(pos, { maxDepth: 64, maxNodes: NODE_BUDGET, multiPV: 1 });
    if (!snap.lines.length) { failures.push(`puzzle ${p.id} produced no lines at all`); continue; }

    const got = E.moveUci(snap.lines[0].pv[0]);
    const ok = got === p.moves[1];
    tried++;
    if (ok) solved++; else missed.push(`${p.id}@${p.rating} wanted ${p.moves[1]}, played ${got}`);
    if (p.rating < EASY_RATING) { easyTried++; if (ok) easySolved++; }
  }

  expect(tried === SAMPLE, `every sampled puzzle was searched (${tried}/${SAMPLE})`);
  expect(solved >= SOLVED_FLOOR,
    `solved ${solved}/${tried} at ${NODE_BUDGET} nodes, floor is ${SOLVED_FLOOR}`
    + (missed.length ? `\n      missed: ${missed.slice(0, 8).join('; ')}` : ''));
  expect(easyTried > 0 && easySolved >= Math.ceil(easyTried * EASY_FLOOR),
    `every puzzle under ${EASY_RATING} must be found: ${easySolved}/${easyTried}`);

  // A mate the engine can see must be REPORTED as a mate, not as a large centipawn score. Null-move
  // pruning is the thing most likely to break this: its cutoff proves "at least beta" and nothing
  // more, so an unguarded one leaks a mate score it never actually found.
  const mateIn2 = E.fromFEN('7k/6R1/8/8/8/8/8/6RK w - - 0 1');
  const m2 = A.analyze(mateIn2, { maxDepth: 6, multiPV: 1 });
  expect(m2.lines.length > 0 && m2.lines[0].score.kind === 'mate',
    'a forced mate is reported as a mate, not as a centipawn score');
  expect(m2.lines[0] && m2.lines[0].score.mate === 2,
    `and at the right distance, got ${m2.lines[0] && m2.lines[0].score.mate}`);

  // Determinism, at a size big enough for the table to fill and be consulted. If an accelerator ever
  // reads uninitialised or time-dependent state, this is where it shows.
  const midgame = E.fromFEN('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6');
  const d1 = A.analyze(midgame, { maxDepth: 6, maxNodes: 60000, multiPV: 3 });
  const d2 = A.analyze(midgame, { maxDepth: 6, maxNodes: 60000, multiPV: 3 });
  expect(d1.nodes === d2.nodes, `the node count is reproducible: ${d1.nodes} vs ${d2.nodes}`);
  expect(JSON.stringify(d1.lines) === JSON.stringify(d2.lines),
    'and so are the lines, table and all');

  return {
    passed, failures, ok: failures.length === 0, solved, tried,
    summary: failures.length === 0
      ? `EngineStrength: ${solved}/${tried} tactics found at ${(NODE_BUDGET / 1000)}k nodes `
        + `(floor ${SOLVED_FLOOR}), ${passed} assertions passed`
      : `EngineStrength: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
