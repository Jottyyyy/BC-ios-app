/* analysis-worker.js — the chess engine, on its own thread.
 *
 * Loaded by `engine-host.js`; never referenced directly by a screen.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * The search used to run on the main thread, one whole depth per uninterrupted block. Measured on a
 * midgame position: depth 3 = 624ms, depth 4 = 2885ms. Nothing on the page can move during that —
 * not a sliding piece, not a dragged one, not a click. That was the reported "delay".
 *
 * Phase 4 decided against Web Workers, and was right about the reason: on `file://` a document has
 * an opaque origin and `new Worker` throws, and the blob-URL and `data:` workarounds inherit the
 * same origin and fail identically. What was wrong was making that a blanket rule. `engine-host.js`
 * tries this worker and falls back in-thread when construction throws, so the double-click-the-file
 * path still works exactly as before while a served page gets a free main thread.
 *
 * ── Why no engine file needed changing ───────────────────────────────────────
 * `engine.js` closes over `typeof window !== 'undefined' ? window : globalThis`, which is the
 * worker's `self`; `analysis-engine.js` and `ai.js` declare bare top-level globals and read `Engine`
 * off the global. `importScripts` therefore just works, and the code running here is byte-identical
 * to the code the golden suite proves.
 *
 * ── Protocol ─────────────────────────────────────────────────────────────────
 *   in   { type:'analyze',  id, fen, maxDepth, multiPV, historyKeys, deadlineMs }
 *   out  { type:'depth',    id, snapshot }        … once per completed depth
 *   out  { type:'done',     id, snapshot }
 *   in   { type:'bestMove', id, fen, persona, seed }
 *   out  { type:'move',     id, move }
 *   in   { type:'cancel',   id }
 *   out  { type:'error',    id, message }
 *
 * Snapshots are plain data (`fen/depth/nodes/lines/score/terminal`), so they structured-clone with
 * no serialisation of our own.
 */
'use strict';

// ORDER MATTERS: `analysis-engine.js` reads `CoachAI` at load time (it reuses the coach's PSTs and
// move ordering), so `ai.js` has to be in the global scope before it runs — the same order
// index.html uses. Get it wrong and the worker throws on startup, `engine-host` quietly degrades to
// the in-thread path, and the whole fix looks like it did nothing.
importScripts('engine.js', 'ai.js', 'analysis-engine.js');

/** Ids the host has asked us to abandon. A search checks this between depths. */
var cancelled = Object.create(null);

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === 'cancel') { cancelled[msg.id] = true; return; }
  try {
    if (msg.type === 'analyze') runAnalyze(msg);
    else if (msg.type === 'bestMove') runBestMove(msg);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
  }
};

function runAnalyze(msg) {
  var pos = Engine.fromFEN(msg.fen);
  if (!pos) throw new Error('unparseable FEN: ' + msg.fen);

  var deadline = Date.now() + (msg.deadlineMs || 1200);
  var steps = BiyaAnalysis.analyzeSteps(pos, {
    maxDepth: msg.maxDepth || 4,
    multiPV: msg.multiPV || 1,
    historyKeys: msg.historyKeys || [],
    shouldCancel: function () { return cancelled[msg.id] === true || Date.now() > deadline; }
  });

  var reported = null;
  // Yield between depths even though we are off the main thread: a `cancel` message cannot be
  // delivered while a synchronous step is running, and abandoning a stale search promptly is the
  // whole point of having one.
  (function pump() {
    setTimeout(function () {
      if (cancelled[msg.id]) { delete cancelled[msg.id]; return; }
      var r = steps.next();
      if (r.snapshot && r.snapshot !== reported) {
        reported = r.snapshot;
        self.postMessage({ type: 'depth', id: msg.id, snapshot: r.snapshot });
      }
      if (r.done) {
        delete cancelled[msg.id];
        self.postMessage({ type: 'done', id: msg.id, snapshot: r.snapshot });
      } else {
        pump();
      }
    }, 0);
  })();
}

function runBestMove(msg) {
  var pos = Engine.fromFEN(msg.fen);
  if (!pos) throw new Error('unparseable FEN: ' + msg.fen);
  // The coach AI is one synchronous call by design — a persona at a fixed shallow depth. On this
  // thread its cost is invisible; that is the entire reason Play routes through here too.
  var rng = CoachAI.mulberry32(msg.seed >>> 0);
  var move = CoachAI.bestMove(pos, msg.persona, rng);
  self.postMessage({ type: 'move', id: msg.id, move: move });
}
