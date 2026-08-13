/* engine-host.js — where the chess engine runs.
 *
 *     node -e "console.log(require('./web-demo/js/engine-host.js').selfTest().summary)"
 *
 * One decision, in one place: put the search on a Worker thread when the page can have one, and run
 * it in-thread in small slices when it cannot. Callers get the same two functions either way.
 *
 *     BiyaEngineHost.analyzeProgressive(pos, opts)  // same shape as BiyaAnalysis.analyzeProgressive
 *     BiyaEngineHost.bestMove(pos, persona, opts)   // same shape as CoachAI.bestMoveAsync
 *     BiyaEngineHost.mode                           // 'worker' | 'inline' | 'unknown' (before use)
 *
 * ── The problem it solves ─────────────────────────────────────────────────────
 * The search ran on the main thread, one whole depth per uninterrupted block. Measured on a midgame
 * position: depth 3 = 624ms, depth 4 = 2885ms. Nothing on the page can move for that long — not a
 * sliding piece, not a dragged one, not a click. That was the reported "delay".
 *
 * ── Why not just always use a Worker ─────────────────────────────────────────
 * Phase 4 decided against Workers because on `file://` a document has an opaque origin and
 * `new Worker` throws — and the blob-URL and `data:` workarounds inherit that origin and fail the
 * same way. That reason is still true; what was wrong was treating it as a blanket rule. Double-
 * clicking `index.html` is a documented, supported path, so it keeps the in-thread engine; a served
 * page (VS Code Live Server, which the README already recommends first) gets a free main thread.
 *
 * ── What makes the in-thread path bearable ───────────────────────────────────
 * Each DEPTH gets its own slice deadline, passed to the search's `shouldCancel`, which the engine
 * polls every 2048 nodes. The block is cut from the INSIDE, so it cannot overrun no matter how sharp
 * the position is. Measured with an 80ms slice: worst block 94ms, still reaching depth 2 in a sharp
 * midgame and depth 5 in a quiet endgame. `tools/qa/engine_budget_check.js` holds that line.
 *
 * Classic script, no ES modules, so it still works from file://.
 */
var BiyaEngineHost = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var A = isNode ? require('./analysis-engine.js') : BiyaAnalysis;
  var MET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;
  var CA = isNode ? require('./ai.js') : (typeof CoachAI !== 'undefined' ? CoachAI : null);

  var worker = null;
  var mode = 'unknown';
  var nextId = 1;
  var pending = Object.create(null);      // id -> { onDepth, resolve }

  /** Where the worker file lives, relative to the page. */
  var WORKER_URL = 'js/analysis-worker.js';

  /**
   * Try once, remember the answer. Anything at all going wrong — an opaque origin on file://, a
   * missing file, a CSP — means in-thread, because a working board matters more than a fast one.
   */
  function ensureWorker() {
    if (mode !== 'unknown') return worker;
    if (typeof Worker === 'undefined' || isNode) { mode = 'inline'; return null; }
    try {
      var w = new Worker(WORKER_URL);
      w.onmessage = onWorkerMessage;
      // A worker that dies later (import failure surfaces asynchronously) must not strand callers.
      w.onerror = function () { degrade(); };
      worker = w;
      mode = 'worker';
    } catch (err) {
      mode = 'inline';
      worker = null;
    }
    return worker;
  }

  /** The worker failed after we started trusting it. Resolve everyone and never use it again. */
  function degrade() {
    var stranded = pending;
    pending = Object.create(null);
    if (worker) { try { worker.terminate(); } catch (e) { /* already gone */ } }
    worker = null;
    mode = 'inline';
    for (var id in stranded) {
      if (Object.prototype.hasOwnProperty.call(stranded, id)) stranded[id].resolve(null);
    }
  }

  function onWorkerMessage(e) {
    var msg = e.data || {};
    var job = pending[msg.id];
    if (!job) return;                                  // cancelled; its results are stale
    if (msg.type === 'depth') { job.onDepth(msg.snapshot); return; }
    if (msg.type === 'move') { delete pending[msg.id]; job.resolve(msg.move); return; }
    if (msg.type === 'done') { delete pending[msg.id]; job.resolve(msg.snapshot); return; }
    if (msg.type === 'error') { delete pending[msg.id]; job.resolve(null); return; }
  }

  /* ============================== analysis ============================== */

  /**
   * Drop-in for `BiyaAnalysis.analyzeProgressive`: same options, same `onDepth`, same resolved
   * snapshot. `shouldCancel` is a closure, which cannot cross a thread boundary — on the worker path
   * it is polled here and turned into a `cancel` message.
   */
  function analyzeProgressive(pos, opts) {
    opts = opts || {};
    var onDepth = opts.onDepth || function () { };
    var shouldCancel = opts.shouldCancel || function () { return false; };
    var w = ensureWorker();
    return w ? viaWorker(w, pos, opts, onDepth, shouldCancel)
             : inline(pos, opts, onDepth, shouldCancel);
  }

  function viaWorker(w, pos, opts, onDepth, shouldCancel) {
    var id = nextId++;
    return new Promise(function (resolve) {
      var poll = null;
      function finish(v) {
        if (poll) { clearInterval(poll); poll = null; }
        resolve(v);
      }
      pending[id] = {
        onDepth: function (snap) { if (!shouldCancel()) onDepth(snap); },
        resolve: finish
      };
      w.postMessage({
        type: 'analyze', id: id,
        fen: E.toFEN(pos),
        maxDepth: opts.maxDepth || 4,
        multiPV: opts.multiPV || 1,
        historyKeys: opts.historyKeys || [],
        // `0` is Infinite and must survive the fallback — `||` would silently turn it into the
        // default deadline, which is the whole feature quietly not working on a served page.
        deadlineMs: opts.deadlineMs === 0 ? 0 : (opts.deadlineMs || MET.TIMINGS.engineDeadline)
      });
      // The caller's cancel is a closure on this thread, so it has to be watched rather than
      // handed over. Cheap: one predicate per frame-ish, against a search that runs for ~a second.
      poll = setInterval(function () {
        if (!shouldCancel()) return;
        if (pending[id]) { delete pending[id]; w.postMessage({ type: 'cancel', id: id }); }
        finish(null);
      }, MET.TIMINGS.uiCoalesce);
    });
  }

  /**
   * The in-thread search, one bounded chunk per `next()`.
   *
   * This is the fix, and it is one line of it: the slice deadline is RESET before every depth. The
   * engine polls `shouldCancel` every 2048 nodes, so each chunk is cut from the INSIDE and cannot
   * overrun — the difference between a 94ms block and a 2885ms one. `analyzeSteps` is driven
   * directly rather than through `analyzeProgressive`, because that one builds its cancel closure
   * once and there would be nowhere to reset.
   *
   * Exposed so `tools/qa/engine_budget_check.js` can time the real chunks synchronously instead of
   * keeping a second copy of this loop.
   */
  function slicedSteps(pos, opts, shouldCancel) {
    var slice = 0;
    var steps = A.analyzeSteps(pos, {
      maxDepth: opts.maxDepth || 4,
      multiPV: opts.multiPV || 1,
      historyKeys: opts.historyKeys || [],
      shouldCancel: function () { return shouldCancel() || Date.now() > slice; }
    });
    return {
      next: function () {
        slice = Date.now() + MET.TIMINGS.inlineSearchBudget;
        return steps.next();
      }
    };
  }

  /** In-thread: pump `slicedSteps`, yielding to the browser between chunks. */
  function inline(pos, opts, onDepth, shouldCancel) {
    var steps = slicedSteps(pos, opts, shouldCancel);
    var reported = null;
    return new Promise(function (resolve) {
      (function pump() {
        setTimeout(function () {
          if (shouldCancel()) { resolve(reported); return; }
          var r = steps.next();
          if (r.snapshot && r.snapshot !== reported) { reported = r.snapshot; onDepth(r.snapshot); }
          if (r.done) resolve(r.snapshot); else pump();
        }, 0);
      })();
    });
  }

  /* ============================== the coach ============================== */

  /**
   * Drop-in for `CoachAI.bestMoveAsync`. That one was `setTimeout(0)` followed by a fully
   * synchronous `bestMove`, so the "async" bought nothing — the board froze for the whole search
   * while the coach thought. On the worker path it genuinely does not.
   */
  function bestMove(pos, persona, opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed
      : ((Date.now() >>> 0) ^ ((Math.random() * 0xFFFFFFFF) >>> 0));
    var w = ensureWorker();
    if (!w) {
      if (!CA) return Promise.resolve(null);
      return CA.bestMoveAsync(pos, persona, { seed: seed });
    }
    var id = nextId++;
    return new Promise(function (resolve) {
      pending[id] = { onDepth: function () { }, resolve: resolve };
      w.postMessage({ type: 'bestMove', id: id, fen: E.toFEN(pos), persona: persona, seed: seed });
    });
  }

  /* ============================== self-check ============================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }

    // Under Node there is no Worker, so this exercises the path `file://` takes.
    expect(typeof analyzeProgressive === 'function', 'analyzeProgressive is exposed');
    expect(typeof bestMove === 'function', 'bestMove is exposed');
    expect(mode === 'unknown' || mode === 'inline' || mode === 'worker', 'mode is a known value');

    // The contract that matters: the host is a DROP-IN. Every option the old call site passed must
    // still be accepted, or a screen silently loses its cancel or its depth limit.
    var src = analyzeProgressive.toString() + inline.toString() + viaWorker.toString();
    ['maxDepth', 'multiPV', 'historyKeys', 'shouldCancel', 'onDepth'].forEach(function (k) {
      expect(src.indexOf(k) >= 0, 'analyzeProgressive still honours `' + k + '`');
    });

    // And the slice is reset per depth, not once for the whole search — the actual fix.
    expect(/slice = Date\.now\(\) \+ MET\.TIMINGS\.inlineSearchBudget/.test(slicedSteps.toString()),
      'the in-thread path resets its slice deadline before every depth');
    expect(slicedSteps.toString().indexOf('analyzeSteps') >= 0,
      'and drives analyzeSteps directly, so it can');
    expect(inline.toString().indexOf('slicedSteps') >= 0,
      'and the pump goes through it, so the browser and the budget check time the same code');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'EngineHostSelfTest: ' + passed + ' assertions passed'
        : 'EngineHostSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    get mode() { return mode; },
    analyzeProgressive: analyzeProgressive,
    bestMove: bestMove,
    selfTest: selfTest,
    // For the budget check: the real sliced stepper, so it can time genuine chunks synchronously
    // rather than keeping its own copy of the loop.
    slicedSteps: function (pos, opts, shouldCancel) {
      return slicedSteps(pos, opts || {}, shouldCancel || function () { return false; });
    }
  };
})();

/* Makes the host requireable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaEngineHost; }
