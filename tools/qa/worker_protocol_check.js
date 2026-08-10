#!/usr/bin/env node
/*
 * worker_protocol_check.js — drive `analysis-worker.js` for real, without a browser.
 *
 *     node tools/qa/worker_protocol_check.js
 *
 * Why this has to exist. The worker is the file with the least natural coverage and the worst
 * failure mode. It only runs when the page is SERVED, so a bug in it never shows up from `file://`
 * or in Node — and `engine-host.js` cannot save you: construction succeeds, so the fallback never
 * fires, and a logic error inside just means the board silently never gets a snapshot. Everything
 * else in this repo is proven; leaving the worker unproven would put the whole engine behind an
 * untested twenty-line message loop.
 *
 * Node has `worker_threads`, not Web Workers, so the script is evaluated in a `vm` context with the
 * three globals it actually uses — `importScripts`, `self.onmessage`, `self.postMessage` — exactly
 * the way `board_component_test.js` fakes the DOM. What runs is the real file, unmodified.
 *
 * What this proves: the protocol (analyze / bestMove / cancel), that snapshots come back correct and
 * structured-cloneable, that a bad FEN reports an error rather than throwing, and that a cancel is
 * actually honoured. What it cannot prove is that `new Worker` succeeds in a real browser — only
 * opening the served page shows that.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const E = require(path.join(JS, 'engine.js'));

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** A worker sandbox: the three globals `analysis-worker.js` touches, and nothing else. */
function spawn() {
  const outbox = [];
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    importScripts: function () {
      for (const f of arguments) {
        vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), sandbox, { filename: f });
      }
    },
    postMessage: (m) => outbox.push(m),
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, 'analysis-worker.js'), 'utf8'), sandbox,
                  { filename: 'analysis-worker.js' });
  return {
    outbox,
    send: (msg) => sandbox.onmessage({ data: msg }),
    // The worker yields between depths with setTimeout, so draining means letting the loop turn.
    drain: () => new Promise((resolve) => {
      let idle = 0;
      (function tick() {
        setTimeout(() => {
          const before = outbox.length;
          if (outbox.some(m => m.type === 'done' || m.type === 'move' || m.type === 'error')) {
            return resolve();
          }
          idle = outbox.length === before ? idle + 1 : 0;
          if (idle > 400) return resolve();          // never finished; the assertions will say so
          tick();
        }, 0);
      })();
    }),
  };
}

/**
 * Runs the suite. Deliberately NOT started at require time: the gate does ~19,000 synchronous
 * assertions after requiring this, blocking the event loop for seconds, and the worker's pump
 * yields with setTimeout — so its deadline would expire before it ever got a turn. Nothing blocks
 * the loop like that in a browser; starting on demand keeps the check measuring the worker rather
 * than the harness.
 */
async function run() {
  passed = 0;
  failures.length = 0;

  // ---- 1. importScripts actually wires the three engines together -------------
  // The whole design rests on the engine files needing no changes: `engine.js` closes over
  // `typeof window !== 'undefined' ? window : globalThis`, which in a worker is `self`.
  {
    const w = spawn();
    w.send({ type: 'analyze', id: 1, fen: E.START_FEN, maxDepth: 1, multiPV: 1, deadlineMs: 2000 });
    await w.drain();
    const done = w.outbox.find(m => m.type === 'done');
    expect(!!done, 'the worker loads its engines and completes an analyze');
    expect(done && done.snapshot && done.snapshot.lines.length > 0,
      'and returns real lines, so importScripts resolved Engine for analysis-engine.js');
    expect(done && done.id === 1, 'tagged with the id it was asked with');
  }

  // ---- 2. per-depth progress, in order ----------------------------------------
  {
    const w = spawn();
    w.send({ type: 'analyze', id: 7, fen: E.START_FEN, maxDepth: 3, multiPV: 2, deadlineMs: 5000 });
    await w.drain();
    const depths = w.outbox.filter(m => m.type === 'depth');
    expect(depths.length >= 1, `at least one progress message, got ${depths.length}`);
    const seq = depths.map(m => m.snapshot.depth);
    expect(seq.every((d, i) => i === 0 || d >= seq[i - 1]),
      `progress deepens monotonically, got ${seq.join(',')}`);
    expect(depths.every(m => m.id === 7), 'every progress message carries the id');
    // Snapshots cross a real thread boundary in the browser, so they must be plain data.
    let cloneable = true;
    try { structuredClone(w.outbox); } catch (e) { cloneable = false; }
    expect(cloneable, 'every message is structured-cloneable — no functions, no cycles');
  }

  // ---- 3. the worker agrees with the in-thread engine --------------------------
  // If these ever diverged, a served page and a file:// page would analyse differently, which is
  // exactly the kind of split-brain the twin discipline exists to prevent.
  {
    const A = require(path.join(JS, 'analysis-engine.js'));
    const fen = 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 7';
    const w = spawn();
    w.send({ type: 'analyze', id: 3, fen, maxDepth: 2, multiPV: 3, deadlineMs: 10000 });
    await w.drain();
    const done = w.outbox.find(m => m.type === 'done');
    const direct = A.analyze(E.fromFEN(fen), { maxDepth: 2, multiPV: 3 });
    expect(done && done.snapshot, 'the worker analysed the midgame position');
    if (done && done.snapshot) {
      expect(done.snapshot.depth === direct.depth,
        `same depth: worker ${done.snapshot.depth} vs in-thread ${direct.depth}`);
      expect(JSON.stringify(done.snapshot.lines.map(l => l.pvSAN[0]))
             === JSON.stringify(direct.lines.map(l => l.pvSAN[0])),
        'same ranked moves as the in-thread engine — the two paths cannot drift');
    }
  }

  // ---- 4. the coach ------------------------------------------------------------
  // `persona` is a coach OBJECT, not an index — and it has to cross a real thread boundary, so it
  // must be pure data. It is (id/name/rating/depth/blunderChance/randomness), asserted here because
  // adding one method to a coach would break Play on a served page and nowhere else.
  {
    require(path.join(JS, 'ai.js'));
    const coach = (global.Coaches || require(path.join(JS, 'ai.js')) && global.Coaches).all[2];
    let cloneable = true;
    try { structuredClone(coach); } catch (e) { cloneable = false; }
    expect(cloneable, 'a coach is structured-cloneable, so it can be handed to the worker');

    const w = spawn();
    w.send({ type: 'bestMove', id: 9, fen: E.START_FEN, persona: coach, seed: 12345 });
    await w.drain();
    const mv = w.outbox.find(m => m.type === 'move');
    expect(!!mv, 'the coach replies');
    expect(mv && mv.move && typeof mv.move.from === 'number' && typeof mv.move.to === 'number',
      'with a real move');
    // Seeded, so Play stays reproducible across the worker boundary.
    const w2 = spawn();
    w2.send({ type: 'bestMove', id: 9, fen: E.START_FEN, persona: coach, seed: 12345 });
    await w2.drain();
    const mv2 = w2.outbox.find(m => m.type === 'move');
    expect(mv && mv2 && mv.move.from === mv2.move.from && mv.move.to === mv2.move.to,
      'and the same seed gives the same move, so the coach is still reproducible');
  }

  // ---- 5. a bad FEN reports, it does not throw ---------------------------------
  {
    const w = spawn();
    let threw = false;
    try { w.send({ type: 'analyze', id: 4, fen: 'not a fen', maxDepth: 2 }); }
    catch (e) { threw = true; }
    expect(!threw, 'a bad FEN does not throw out of onmessage and kill the worker');
    const err = w.outbox.find(m => m.type === 'error');
    expect(!!err, 'it posts an error instead');
    expect(err && err.id === 4, 'tagged with the id, so the host can resolve that one caller');
  }

  // ---- 6. cancel is honoured ----------------------------------------------------
  {
    const w = spawn();
    w.send({ type: 'analyze', id: 5, fen: 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 7',
             maxDepth: 6, multiPV: 3, deadlineMs: 30000 });
    w.send({ type: 'cancel', id: 5 });
    await w.drain();
    expect(!w.outbox.some(m => m.type === 'done'),
      'a cancelled search never posts `done`, so a stale result cannot land on a new position');
  }

  const result = {
    passed,
    failures,
    ok: failures.length === 0,
    summary: failures.length === 0
      ? `WorkerProtocol: ${passed} assertions passed`
      : `WorkerProtocol: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map(f => '  ✗ ' + f).join('\n'),
  };

  module.exports.__result = result;
  return result;
}

module.exports = { run, selfTest: () => module.exports.__result };

if (require.main === module) {
  run().then((r) => {
    console.log(r.summary);
    process.exit(r.ok ? 0 : 1);
  });
}
