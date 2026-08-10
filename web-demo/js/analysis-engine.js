/* analysis-engine.js — the offline analysis search
 *
 * The browser mirror of Sources/BiyaherongCoachCore/{AnalysisEngine,LocalEngine}.swift (Phase 4).
 * Written here FIRST and proven in Node, then transliterated — `swift` is not on PATH on the
 * Windows checkout, so this is where the search is actually shown to work.
 *
 *     node -e "console.log(require('./web-demo/js/analysis-engine.js').selfTest().summary)"
 *
 * What this is NOT: the coach AI in ai.js. That one plays a persona at a fixed shallow depth with
 * deliberate noise. This one analyses: iterative deepening, a principal variation, several ranked
 * lines, and no randomness whatsoever.
 *
 * Design notes that are load-bearing:
 *
 *  - **Synchronous and deterministic.** Limits are depth and nodes, never wall-clock time, so a
 *    result is reproducible in a test. Cancellation and progress are callbacks; a caller that wants
 *    a deadline implements it inside `shouldCancel`. The Swift twin has the identical shape, which
 *    is what makes the two comparable.
 *  - **Scores are WHITE-relative at the boundary.** `CoachAI.evaluate` is side-to-move relative
 *    (the same board scores +895 with White to move and -895 with Black), and so is negamax. The
 *    single flip happens at the root. Getting this wrong is the most bug-prone thing in the feature.
 *  - **MultiPV is free.** Every root move is searched with a fresh full window and no alpha
 *    propagation between root moves, so each one gets an exact score rather than a bound; the top-k
 *    lines fall out of sorting. That costs root cutoffs and buys exactness and simplicity.
 *  - **No transposition table, no killers, no history.** Performance, not correctness. Leaving them
 *    out also makes determinism true by construction.
 *  - **No Web Worker.** On file:// a document has an opaque origin, so Chrome throws when a worker
 *    is constructed, and the blob-URL workaround inherits the same origin. docs/web-demo.md states
 *    the contract: the AI runs on the main thread. `analyzeAsync` yields once before searching, the
 *    same trick `bestMoveAsync` uses so the UI can paint.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysis = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var AI = isNode ? require('./ai.js') : CoachAI;

  var MATE = AI.MATE;              // 1000000, matching ChessAI.mate
  var WIN = 1000000000;            // window bound, wider than MATE. CoachAI keeps its own private copy.
  var MATE_THRESHOLD = MATE - 1000; // |score| above this is a forced mate
  var MAX_QDEPTH = 6;
  var DELTA_MARGIN = 200;          // futility margin for delta pruning in quiescence
  var CANCEL_CHECK_INTERVAL = 2048;

  var IDENTIFIER = 'local-negamax-v1';

  // ---- Tactical predicate ---------------------------------------------------
  // NOT `CoachAI.captureScore(...) >= 0`: that helper detects a capture purely by "is there a piece
  // on m.to", so it scores en-passant captures AND promotions as quiet moves. Quiescence that
  // trusted it would walk straight past both.
  function isTactical(pos, m) {
    if (pos.squares[m.to] != null) return true;
    if (m.promotion != null) return true;
    var mover = pos.squares[m.from];
    return !!mover && mover.kind === E.PAWN && m.to === pos.enPassant;
  }

  // ---- Search ---------------------------------------------------------------

  function Search(limits, shouldCancel) {
    this.maxDepth = Math.max(1, limits && limits.maxDepth ? limits.maxDepth : 4);
    this.maxNodes = (limits && limits.maxNodes) || 0;   // 0 = unlimited
    this.multiPV = Math.max(1, (limits && limits.multiPV) || 1);
    this.shouldCancel = shouldCancel || function () { return false; };
    this.nodes = 0;
    this.cancelled = false;
  }

  Search.prototype.outOfBudget = function () {
    if (this.cancelled) return true;
    if (this.maxNodes > 0 && this.nodes >= this.maxNodes) { this.cancelled = true; return true; }
    if ((this.nodes % CANCEL_CHECK_INTERVAL) === 0 && this.shouldCancel()) { this.cancelled = true; return true; }
    return false;
  };

  /** Quiescence: only tactical moves, so the search does not stop in the middle of a trade. */
  Search.prototype.quiesce = function (pos, alpha, beta, qdepth) {
    this.nodes++;
    if (this.outOfBudget()) return alpha;

    var inCheck = E.isInCheck(pos, pos.sideToMove);
    var moves = E.legalMoves(pos);
    // Terminal must be tested on ALL legal moves, never on the tactical subset — "no captures" is
    // not "no moves". (ai.js's negamax tests terminal before depth for the same reason.)
    if (moves.length === 0) return inCheck ? -(MATE - qdepth) : 0;

    var standPat = AI.evaluate(pos);
    if (!inCheck) {
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
      if (qdepth >= MAX_QDEPTH) return standPat;
    }

    // In check, every evasion must be considered; otherwise only tactical moves.
    var candidates = inCheck ? moves : moves.filter(function (m) { return isTactical(pos, m); });
    if (candidates.length === 0) return inCheck ? -(MATE - qdepth) : standPat;

    var ord = AI.ordered(candidates, pos);
    var best = inCheck ? -WIN : standPat;
    for (var i = 0; i < ord.length; i++) {
      if (!inCheck) {
        // Delta pruning: skip a capture that cannot plausibly raise alpha.
        var victim = pos.squares[ord[i].to];
        var gain = victim ? AI.material(victim.kind) : 0;
        if (ord[i].promotion != null) gain += AI.material(ord[i].promotion);
        if (standPat + gain + DELTA_MARGIN < alpha) continue;
      }
      var score = -this.quiesce(E.makeMove(pos, ord[i]), -beta, -alpha, qdepth + 1);
      if (this.cancelled) return alpha;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };

  /**
   * Alpha-beta with a triangular principal-variation table. `line` is filled with the PV from this
   * node down. Depth guard is `<= 0`, not `=== 0` — ai.js's `=== 0` recurses forever on a negative
   * depth, which is only safe there because its one caller can never pass one.
   */
  Search.prototype.negamax = function (pos, depth, alpha, beta, ply, line) {
    line.length = 0;
    this.nodes++;
    if (this.outOfBudget()) return alpha;

    var moves = E.legalMoves(pos);
    if (moves.length === 0) return E.isInCheck(pos, pos.sideToMove) ? -(MATE - ply) : 0;
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply);

    var ord = AI.ordered(moves, pos);
    var best = -WIN;
    var child = [];
    for (var i = 0; i < ord.length; i++) {
      var score = -this.negamax(E.makeMove(pos, ord[i]), depth - 1, -beta, -alpha, ply + 1, child);
      if (this.cancelled) return best > -WIN ? best : alpha;
      if (score > best) {
        best = score;
        line.length = 0;
        line.push(ord[i]);
        for (var j = 0; j < child.length; j++) line.push(child[j]);
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };

  // ---- Score conversion -----------------------------------------------------

  /** Side-to-move-relative search score -> a white-relative EngineScore. */
  function toEngineScore(score, rootSideToMove) {
    var whiteScore = rootSideToMove === E.WHITE ? score : -score;
    if (Math.abs(whiteScore) > MATE_THRESHOLD) {
      var plies = MATE - Math.abs(whiteScore);
      var moves = Math.floor((plies + 1) / 2);
      if (moves < 1) moves = 1;              // the root itself is never terminal here
      return { kind: 'mate', mate: whiteScore > 0 ? moves : -moves, cp: null, terminal: null };
    }
    return { kind: 'cp', cp: whiteScore, mate: null, terminal: null };
  }

  function terminalScore(outcome) {
    return { kind: 'terminal', cp: null, mate: null, terminal: outcome };
  }

  /**
   * The bridge to the game review. A terminal checkmate is reported as `evalCp: +/-10000` with
   * `evalMate: null` — NEVER `evalMate: 0`, which is the latent server bug: the Python service emits
   * 0 for a mated position and PHP's normalizeEval prefers eval_mate, yielding -10000 no matter who
   * delivered mate. Routing through evalCp produces the value the PHP intended.
   */
  function asReviewEvaluation(score, bestMoveSan) {
    var out = { eval_cp: null, eval_mate: null, best_move_san: bestMoveSan || null };
    if (score.kind === 'cp') { out.eval_cp = score.cp; return out; }
    if (score.kind === 'mate') { out.eval_mate = score.mate; return out; }
    var t = score.terminal;
    if (t.kind === 'checkmate') { out.eval_cp = t.winner === E.WHITE ? 10000 : -10000; return out; }
    out.eval_cp = 0;
    return out;
  }

  // ---- Public analyse -------------------------------------------------------

  function pvToSan(pos, pv) {
    var out = [], p = pos;
    for (var i = 0; i < pv.length; i++) {
      out.push(E.san(p, pv[i]));
      p = E.makeMove(p, pv[i]);
    }
    return out;
  }

  /**
   * Analyse `pos`. Returns the final snapshot; `onProgress` receives one snapshot per completed
   * iterative-deepening iteration. A cancelled search keeps the last COMPLETED iteration, never a
   * half-finished one.
   */
  function analyze(pos, opts) {
    opts = opts || {};
    var limits = {
      maxDepth: opts.maxDepth || 4,
      maxNodes: opts.maxNodes || 0,
      multiPV: opts.multiPV || 1
    };
    var onProgress = opts.onProgress || function () {};
    var s = new Search(limits, opts.shouldCancel);

    // Terminal positions never enter the search, which is what makes `mate !== 0` structural.
    var outcome = E.terminalOutcome(pos, opts.historyKeys || []);
    if (outcome.kind !== 'ongoing') {
      var snap = {
        fen: E.toFEN(pos), depth: 0, nodes: 0, lines: [],
        isFinal: true, terminal: outcome, score: terminalScore(outcome)
      };
      onProgress(snap);
      return snap;
    }

    var rootMoves = AI.ordered(E.legalMoves(pos), pos);
    var last = null;
    var line = [];

    for (var depth = 1; depth <= limits.maxDepth; depth++) {
      var scored = [];
      var aborted = false;
      for (var i = 0; i < rootMoves.length; i++) {
        // Fresh full window per root move: every root move gets an EXACT score, not a bound, so
        // MultiPV needs no re-search. This mirrors what bestMove already does.
        var sc = -s.negamax(E.makeMove(pos, rootMoves[i]), depth - 1, -WIN, WIN, 1, line);
        if (s.cancelled) { aborted = true; break; }
        scored.push({ move: rootMoves[i], score: sc, pv: [rootMoves[i]].concat(line) });
      }
      if (aborted) break;

      scored.sort(function (a, b) { return b.score - a.score; });
      var lines = [];
      for (var k = 0; k < Math.min(limits.multiPV, scored.length); k++) {
        lines.push({
          rank: k + 1,
          score: toEngineScore(scored[k].score, pos.sideToMove),
          pv: scored[k].pv,
          pvSAN: pvToSan(pos, scored[k].pv),
          depth: depth
        });
      }
      last = {
        fen: E.toFEN(pos), depth: depth, nodes: s.nodes, lines: lines,
        isFinal: false, terminal: null, score: lines.length ? lines[0].score : null
      };
      onProgress(last);
      // Search the best root move first next iteration — the cheapest ordering win available.
      rootMoves = scored.map(function (x) { return x.move; });
      // A forced mate is the end of the story; deeper search cannot improve on it.
      if (lines.length && lines[0].score.kind === 'mate') break;
    }

    if (!last) {
      last = { fen: E.toFEN(pos), depth: 0, nodes: s.nodes, lines: [], isFinal: true, terminal: null, score: null };
    }
    last.isFinal = true;
    return last;
  }

  /** Yields once so a "thinking" indicator can paint, then searches on the main thread. */
  function analyzeAsync(pos, opts) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(analyze(pos, opts)); }, 0);
    });
  }

  /**
   * Iterative deepening, one depth per call — the synchronous core behind `analyzeProgressive`.
   *
   * `analyzeAsync` yields once and then blocks for the WHOLE search, so on a live analysis board the
   * page freezes until the deepest ply is done and a cancel cannot land. Driving one depth at a time
   * lets the caller paint between iterations, show lines as they are found, and abandon instantly.
   *
   * Implemented by re-running `analyze` with an increasing depth cap rather than by restructuring
   * `analyze`'s own loop. That function is pinned by this file's golden assertions and by the Swift
   * `search` parity group; iterative deepening is exponential, so re-searching the shallow plies
   * costs a small constant factor, and a UI nicety does not justify touching a pinned search.
   *
   * Returns `{ next() -> { done, snapshot, depth } }`. `snapshot` is the deepest COMPLETED search so
   * far, never a half-finished one, and is null until the first depth completes.
   */
  function analyzeSteps(pos, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 4;
    var shouldCancel = opts.shouldCancel || function () { return false; };
    var depth = 0, best = null, finished = false;

    return {
      next: function () {
        if (finished || depth >= maxDepth || shouldCancel()) {
          finished = true;
          return { done: true, snapshot: best, depth: depth };
        }
        depth += 1;
        var snap = analyze(pos, {
          maxDepth: depth,
          maxNodes: opts.maxNodes || 0,
          multiPV: opts.multiPV || 1,
          historyKeys: opts.historyKeys || [],
          shouldCancel: shouldCancel
        });
        // A cancelled sub-search yields no lines; keep the last complete result instead.
        if (snap.lines.length || snap.terminal) best = snap;
        // Terminal positions and forced mates are the end of the story — deeper cannot improve.
        // `snap.depth < depth` means the sub-search was cut short (cancelled, or it broke on a
        // mate), so asking for more is wasted work AND would re-report the same snapshot.
        if (snap.terminal || (snap.score && snap.score.kind === 'mate')
            || snap.depth < depth || depth >= maxDepth) {
          finished = true;
        }
        return { done: finished, snapshot: best, depth: depth };
      }
    };
  }

  /** `analyzeSteps` driven by the event loop: one depth per macrotask. */
  function analyzeProgressive(pos, opts) {
    opts = opts || {};
    var onDepth = opts.onDepth || function () { };
    var steps = analyzeSteps(pos, opts);
    var reported = null;
    return new Promise(function (resolve) {
      (function pump() {
        setTimeout(function () {
          var r = steps.next();
          // Only when it actually changed: a cut-short step returns the previous snapshot, and
          // repainting the same lines twice is pure waste.
          if (r.snapshot && r.snapshot !== reported) { reported = r.snapshot; onDepth(r.snapshot); }
          if (r.done) resolve(r.snapshot); else pump();
        }, 0);
      })();
    });
  }

  /** Human-readable score, matching the spec's engine-line column. */
  function formatScore(score) {
    if (!score) return '';
    if (score.kind === 'terminal') {
      if (score.terminal.kind === 'checkmate') return score.terminal.winner === E.WHITE ? '1-0' : '0-1';
      return '½-½';
    }
    if (score.kind === 'mate') return 'M' + score.mate;
    var v = score.cp / 100;
    return (v >= 0 ? '+' : '') + v.toFixed(1);
  }

  // ---- Self-test ------------------------------------------------------------
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function P(f) { var p = E.fromFEN(f); if (!p) failures.push('bad fen ' + f); return p; }

    // 1. Forced mates. Sparse positions keep the branching factor — and the runtime — small.
    // Expectations are ground truth from a brute-force mate checker, NOT from this search — see the
    // CHANGELOG. Guessing them by eye produced four wrong entries on the first attempt.
    var mates = [
      ['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 1, 2, 'back-rank mate in 1 (Ra8#)'],
      ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 1, 2, 'back-rank mate in 1, both sides castled'],
      ['6k1/5p1p/8/8/8/8/8/R5RK w - - 0 1', 1, 2, 'back-rank mate in 1 through an open g7'],
      ['7k/R7/1R6/8/8/8/8/7K w - - 0 1', 1, 2, 'rook ladder mate in 1'],
      ['6k1/8/6K1/8/8/8/8/7Q w - - 0 1', 1, 2, 'K+Q mate in 1'],
      ['7k/8/6K1/8/8/8/8/R7 w - - 0 1', 1, 2, 'K+R corner mate in 1'],
      ['7k/6R1/8/8/8/8/8/6RK w - - 0 1', 2, 4, 'two-rook mate in 2'],
      ['6k1/8/6K1/8/8/8/8/7R w - - 0 1', 2, 4, 'K+R mate in 2'],
      ['5rk1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', null, 3, 'no mate available']
    ];
    for (var i = 0; i < mates.length; i++) {
      var f = mates[i][0], want = mates[i][1], d = mates[i][2], why = mates[i][3];
      var pos = P(f); if (!pos) continue;
      var r = analyze(pos, { maxDepth: d, multiPV: 1 });
      if (want === null) {
        expect(r.lines.length > 0 && r.lines[0].score.kind === 'cp', why + ': expected a cp score');
      } else {
        expect(r.lines.length > 0 && r.lines[0].score.kind === 'mate' && r.lines[0].score.mate === want,
          why + ': got ' + (r.lines.length ? formatScore(r.lines[0].score) : 'no lines') + ', want M' + want);
      }
    }

    // 2. PV legality — every move in every line must actually be playable.
    var mid = P('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    var multi = analyze(mid, { maxDepth: 3, multiPV: 3 });
    expect(multi.lines.length === 3, 'multiPV returns 3 lines, got ' + multi.lines.length);
    for (var li = 0; li < multi.lines.length; li++) {
      var p = mid, ok = true;
      for (var mi = 0; mi < multi.lines[li].pv.length; mi++) {
        var legal = E.legalMoves(p), found = false;
        for (var q = 0; q < legal.length; q++) if (E.moveEquals(legal[q], multi.lines[li].pv[mi])) { found = true; break; }
        if (!found) { ok = false; break; }
        p = E.makeMove(p, multi.lines[li].pv[mi]);
      }
      expect(ok, 'line ' + (li + 1) + ' PV is fully legal');
      expect(multi.lines[li].pvSAN.length === multi.lines[li].pv.length, 'line ' + (li + 1) + ' pvSAN matches pv length');
      expect(multi.lines[li].rank === li + 1, 'line ' + (li + 1) + ' rank');
    }
    for (var r2 = 1; r2 < multi.lines.length; r2++) {
      var a = multi.lines[r2 - 1].score, b = multi.lines[r2].score;
      if (a.kind === 'cp' && b.kind === 'cp') expect(a.cp >= b.cp, 'multiPV scores are non-increasing');
    }
    var roots = {};
    for (var r3 = 0; r3 < multi.lines.length; r3++) roots[E.moveUci(multi.lines[r3].pv[0])] = 1;
    expect(Object.keys(roots).length === multi.lines.length, 'multiPV root moves are distinct');

    // 3. White-relative scores. The same position must score with the same SIGN whoever is to move.
    var wUp = P('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    var bUp = P('4k3/8/8/8/8/8/8/3QK3 b - - 0 1');
    var sw = analyze(wUp, { maxDepth: 2 }).lines[0].score;
    var sb = analyze(bUp, { maxDepth: 2 }).lines[0].score;
    expect(sw.kind !== 'cp' || sw.cp > 0, 'White up a queen scores positive with White to move');
    expect(sb.kind !== 'cp' || sb.cp > 0, 'White up a queen scores positive with Black to move too');

    // 4. Terminal short-circuit — and the evalMate:0 guard.
    var mated = P('R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1');
    var tm = analyze(mated, { maxDepth: 4 });
    expect(tm.lines.length === 0, 'a finished game produces no lines');
    expect(tm.terminal && tm.terminal.kind === 'checkmate', 'checkmate is reported as terminal');
    expect(tm.nodes === 0, 'a finished game is never searched');
    var ev = asReviewEvaluation(tm.score, null);
    expect(ev.eval_mate === null, 'terminal mate NEVER sets eval_mate (the server bug)');
    expect(ev.eval_cp === 10000, 'White mating gives eval_cp +10000, got ' + ev.eval_cp);
    var stale = P('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    var ts = analyze(stale, { maxDepth: 4 });
    expect(ts.terminal && ts.terminal.reason === 'stalemate', 'stalemate is terminal');
    expect(asReviewEvaluation(ts.score, null).eval_cp === 0, 'a draw is 0 cp');
    // a real (non-terminal) mate score still uses eval_mate
    var m1 = analyze(P('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), { maxDepth: 2 });
    var ev1 = asReviewEvaluation(m1.lines[0].score, 'Ra8#');
    expect(ev1.eval_mate === 1 && ev1.eval_cp === null, 'a forced mate uses eval_mate, not eval_cp');
    expect(ev1.best_move_san === 'Ra8#', 'the best move SAN is carried through');

    // 5. Determinism — the same request twice must be identical.
    var d1 = analyze(mid, { maxDepth: 3, multiPV: 2 });
    var d2 = analyze(mid, { maxDepth: 3, multiPV: 2 });
    expect(JSON.stringify(d1.lines) === JSON.stringify(d2.lines), 'the search is deterministic');
    expect(d1.nodes === d2.nodes, 'node counts match across identical runs');

    // 6. Cancellation keeps the last COMPLETED iteration and never a partial one.
    var calls = 0;
    var cancelled = analyze(mid, {
      maxDepth: 6,
      shouldCancel: function () { calls++; return calls > 1; }
    });
    expect(cancelled.isFinal === true, 'a cancelled search still returns a final snapshot');
    expect(cancelled.lines.length === 0 || cancelled.lines[0].pv.length > 0,
      'a cancelled search never returns an empty PV');

    // 7. Quiescence: a hanging queen must be taken, not left hanging by the horizon.
    var hanging = P('4k3/8/8/8/3q4/8/3Q4/4K3 w - - 0 1');
    var hq = analyze(hanging, { maxDepth: 2, multiPV: 1 });
    expect(hq.lines[0].pvSAN[0] === 'Qxd4', 'the free queen is captured, got ' + hq.lines[0].pvSAN[0]);

    // 8. Progress callbacks arrive once per completed depth.
    var seen = [];
    analyze(mid, { maxDepth: 3, onProgress: function (s) { seen.push(s.depth); } });
    expect(seen.join(',') === '1,2,3', 'onProgress fires per depth, got ' + seen.join(','));

    // 9. Score formatting matches the spec's engine-line column.
    expect(formatScore({ kind: 'cp', cp: 130 }) === '+1.3', 'formatScore +1.3');
    expect(formatScore({ kind: 'cp', cp: -70 }) === '-0.7', 'formatScore -0.7');
    expect(formatScore({ kind: 'cp', cp: 0 }) === '+0.0', 'formatScore +0.0');
    expect(formatScore({ kind: 'mate', mate: 4 }) === 'M4', 'formatScore M4');
    expect(formatScore({ kind: 'mate', mate: -3 }) === 'M-3', 'formatScore M-3');

    // 10. analyzeSteps — the synchronous core behind analyzeProgressive. Driving it by hand is what
    //     keeps a Promise-shaped API inside this file's assertions.
    var st = analyzeSteps(mid, { maxDepth: 3, multiPV: 2 });
    var depths = [], last = null, guard = 0;
    for (;;) {
      var r = st.next();
      if (r.depth) depths.push(r.depth);
      if (r.snapshot) last = r.snapshot;
      if (r.done || ++guard > 20) break;
    }
    expect(depths.join(',') === '1,2,3', 'one step per depth, got ' + depths.join(','));
    expect(last !== null && last.depth === 3, 'the last snapshot is the deepest completed one');
    expect(last.lines.length === 2, 'multiPV carries through the steps');
    // Same answer as a single-shot search of the same depth — the split must not change the result.
    var oneShot = analyze(mid, { maxDepth: 3, multiPV: 2 });
    expect(last.lines[0].pvSAN.join(' ') === oneShot.lines[0].pvSAN.join(' '),
      'stepping reaches the same best line as analyzing in one go');
    expect(st.next().done === true, 'a finished stepper stays finished');

    // A forced mate ends the walk early rather than grinding to maxDepth.
    var mateSt = analyzeSteps(P('6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1'), { maxDepth: 6 });
    var mateDepths = 0, mr;
    do { mr = mateSt.next(); if (mr.depth) mateDepths = mr.depth; } while (!mr.done && mateDepths < 6);
    expect(mateDepths < 6 || (mr.snapshot && mr.snapshot.score.kind !== 'mate'),
      'a forced mate stops the walk before maxDepth');

    // Cancelling between steps stops immediately and keeps what was already found.
    var cancelNow = false;
    var cst = analyzeSteps(mid, { maxDepth: 5, shouldCancel: function () { return cancelNow; } });
    var first = cst.next();
    expect(first.depth === 1 && first.snapshot !== null, 'the first step completes');
    cancelNow = true;
    var after = cst.next();
    expect(after.done === true, 'cancelling ends the walk');
    expect(after.snapshot === first.snapshot, 'and keeps the last completed snapshot');

    // A terminal position resolves in one step, with no lines.
    var tst = analyzeSteps(P('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), { maxDepth: 4 });
    var tr = tst.next();
    expect(tr.done === true, 'a terminal position finishes in one step');
    expect(tr.snapshot.terminal !== null && tr.snapshot.lines.length === 0,
      'and reports the outcome with no lines');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisEngineSelfTest: ' + passed + ' assertions passed'
        : 'AnalysisEngineSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    IDENTIFIER: IDENTIFIER, MATE: MATE, WIN: WIN, MAX_QDEPTH: MAX_QDEPTH,
    isTactical: isTactical, analyze: analyze, analyzeAsync: analyzeAsync,
    analyzeSteps: analyzeSteps, analyzeProgressive: analyzeProgressive,
    toEngineScore: toEngineScore, terminalScore: terminalScore,
    asReviewEvaluation: asReviewEvaluation, formatScore: formatScore,
    selfTest: selfTest
  };
})();

/* Makes the search runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaAnalysis; }
