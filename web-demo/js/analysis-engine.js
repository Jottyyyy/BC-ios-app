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
 *    is what makes the two comparable. Every accelerator below is deterministic too: the
 *    transposition table is per-search and cleared by size, never by clock, so the same request
 *    twice still returns byte-identical lines AND an identical node count.
 *  - **Scores are WHITE-relative at the boundary.** `AnalysisEval.evaluate` is side-to-move relative
 *    (the same board scores +895 with White to move and -895 with Black), and so is negamax. The
 *    single flip happens at the root. Getting this wrong is the most bug-prone thing in the feature.
 *  - **The evaluation is `analysis-eval.js`, not `CoachAI.evaluate`.** The coach's evaluation is
 *    parity-pinned to the five personas and stays untouched; this one knows about game phase, pawn
 *    structure, king safety and mobility. See that file's header for why they are separate.
 *  - **The top-k lines carry EXACT scores; everything below them may carry a bound.** Root moves
 *    that cannot enter the displayed top-k are searched against a null window and only re-searched
 *    exactly if they beat the k-th best. The panel shows exact numbers, and the root gets its
 *    cutoffs back. (Before, every root move got a full window — correct, and enormously wasteful.)
 *  - **`analyzeSteps` is the core, and it keeps its state.** One depth per `next()`, over ONE
 *    `Search` whose table, killers, history and root order survive between depths. `analyze` is a
 *    thin driver over the same stepper, so the two can no longer disagree by construction.
 *  - **No Web Worker in this file.** On file:// a document has an opaque origin, so Chrome throws
 *    when a worker is constructed. `engine-host.js` owns that decision; here the search is a plain
 *    synchronous function and `analyzeAsync` merely yields once before running it.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysis = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var AI = isNode ? require('./ai.js') : CoachAI;
  var EV = isNode ? require('./analysis-eval.js') : BiyaAnalysisEval;

  var MATE = AI.MATE;              // 1000000, matching ChessAI.mate
  var WIN = 1000000000;            // window bound, wider than MATE. CoachAI keeps its own private copy.
  var MATE_THRESHOLD = MATE - 1000; // |score| above this is a forced mate
  var MAX_QDEPTH = 6;
  var DELTA_MARGIN = 200;          // futility margin for delta pruning in quiescence
  var CANCEL_CHECK_INTERVAL = 2048;

  // Bounds the recursion. Check extensions add a ply without spending one, so without this a
  // perpetual-check line would recurse until the stack gave out.
  var MAX_PLY = 64;

  // Transposition table. `EXACT` is a true score, `LOWER` a fail-high bound, `UPPER` a fail-low one.
  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
  /** Entry cap. Reached, the table is cleared wholesale — bounded memory, and still deterministic. */
  var TT_MAX = 1 << 20;

  // Null-move pruning: give the opponent a free move; if the position is still good enough to fail
  // high, it was never worth searching properly. Forbidden in check, in a PV node, and — the
  // zugzwang guard — when the side to move has nothing but pawns, where passing is not a concession.
  var NULL_MIN_DEPTH = 3, NULL_R = 2, NULL_R_DEEP = 3, NULL_DEEP_DEPTH = 6;

  // Late move reductions: moves ordered this late are rarely best, so search them shallower first
  // and only pay full price if one surprises us. Captures, promotions, killers and checks are never
  // reduced — those are exactly the moves that surprise.
  var LMR_MIN_DEPTH = 3, LMR_MIN_MOVE = 3, LMR_WIDE_MOVE = 6, LMR_WIDE_DEPTH = 5;

  /** History scores are halved rather than allowed to saturate an Int32 in a long search. */
  var HISTORY_MAX = 1 << 24;

  /** `analyze` drives the stepper; this only ever fires if the stepper stops terminating. */
  var STEP_GUARD = 512;

  var IDENTIFIER = 'local-negamax-v2';

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
    // Accelerators. All three live for the whole search — across depths, which is the point of
    // iterative deepening — and die with it, so nothing leaks between two calls.
    this.tt = new Map();                    // low 32 bits of the key -> entry (high half verifies)
    this.killers = [];                      // ply -> [most recent, previous] quiet cutoff move
    this.history = new Int32Array(64 * 64); // from*64+to -> how often it caused a cutoff
    this.keyScratch = [0, 0];               // reused by `hash`, so nothing allocates per node
  }

  Search.prototype.outOfBudget = function () {
    if (this.cancelled) return true;
    if (this.maxNodes > 0 && this.nodes >= this.maxNodes) { this.cancelled = true; return true; }
    if ((this.nodes % CANCEL_CHECK_INTERVAL) === 0 && this.shouldCancel()) { this.cancelled = true; return true; }
    return false;
  };

  /**
   * Order the moves: the table's move, then captures by MVV-LVA, then the killers, then whatever
   * history says has been causing cutoffs. Ordering is the single largest lever on alpha-beta — a
   * perfectly ordered search visits the square root of the nodes a badly ordered one does.
   *
   * The index tie-break is not decoration: `Array.prototype.sort` is not required to be stable for
   * every input, and the Swift twin's `sort` definitely is not, so equal keys must be separated by
   * something. This is the same guard `CoachAI.ordered` uses.
   */
  Search.prototype.order = function (moves, pos, ply, ttMove) {
    var self = this;
    var k = this.killers[ply];
    var arr = moves.map(function (m, i) {
      var s;
      if (ttMove && E.moveEquals(m, ttMove)) s = 4000000;
      else if (m.promotion != null) s = 3000000 + AI.material(m.promotion);
      else {
        var cap = AI.captureScore(pos, m);              // -1 when the move is not a capture
        if (cap >= 0) s = 2000000 + cap;
        else if (k && k[0] && E.moveEquals(m, k[0])) s = 1900000;
        else if (k && k[1] && E.moveEquals(m, k[1])) s = 1890000;
        else s = self.history[m.from * 64 + m.to];
      }
      return { m: m, i: i, k: s };
    });
    arr.sort(function (a, b) { return a.k !== b.k ? b.k - a.k : a.i - b.i; });
    return arr.map(function (x) { return x.m; });
  };

  /** A quiet move that caused a cutoff is worth trying first next time, here and elsewhere. */
  Search.prototype.remember = function (m, ply, depth) {
    var k = this.killers[ply];
    if (!k) { k = [null, null]; this.killers[ply] = k; }
    if (!k[0] || !E.moveEquals(k[0], m)) { k[1] = k[0]; k[0] = m; }
    var idx = m.from * 64 + m.to;
    this.history[idx] += depth * depth;
    if (this.history[idx] > HISTORY_MAX) {
      for (var i = 0; i < this.history.length; i++) this.history[i] >>= 1;
    }
  };

  /** Write this position's Zobrist key into the reusable scratch pair. */
  Search.prototype.hash = function (pos) { EV.hash(pos, this.keyScratch); };

  /**
   * Mate scores are stored NODE-relative and used ROOT-relative.
   *
   * A mate score carries the distance to the mate, and the search expresses that as a distance from
   * the ROOT (`-(MATE - ply)`). Two different paths reach the same position at different plies, so a
   * root-relative score in a shared table is wrong for whoever probes it next. Storing `score + ply`
   * makes it a distance from the node; probing subtracts the ply back out.
   */
  function toTT(score, ply) {
    if (score > MATE_THRESHOLD) return score + ply;
    if (score < -MATE_THRESHOLD) return score - ply;
    return score;
  }
  function fromTT(score, ply) {
    if (score > MATE_THRESHOLD) return score - ply;
    if (score < -MATE_THRESHOLD) return score + ply;
    return score;
  }

  Search.prototype.store = function (lo, hi, depth, score, flag, move, ply) {
    if (this.cancelled) return;                 // a cut-short score is not a fact about the position
    var e = this.tt.get(lo);
    if (e && e.hi === hi && e.depth > depth) return;        // never overwrite a deeper result
    if (!e && this.tt.size >= TT_MAX) this.tt.clear();      // bounded memory, deterministically
    this.tt.set(lo, { hi: hi, depth: depth, score: toTT(score, ply), flag: flag, move: move });
  };

  /** The opponent gets a free move. Only ever reached where zugzwang has been ruled out. */
  function makeNullMove(pos) {
    var p = E.clone(pos);
    p.sideToMove = E.opponent(pos.sideToMove);
    p.enPassant = null;                          // the right to capture en passant does not survive
    return p;
  }

  /** Quiescence: only tactical moves, so the search does not stop in the middle of a trade. */
  Search.prototype.quiesce = function (pos, alpha, beta, qdepth) {
    this.nodes++;
    if (this.outOfBudget()) return alpha;

    var inCheck = E.isInCheck(pos, pos.sideToMove);
    var moves = E.legalMoves(pos);
    // Terminal must be tested on ALL legal moves, never on the tactical subset — "no captures" is
    // not "no moves". (ai.js's negamax tests terminal before depth for the same reason.)
    if (moves.length === 0) return inCheck ? -(MATE - qdepth) : 0;

    var standPat = EV.evaluate(pos);
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
   *
   * Everything beyond plain alpha-beta lives here: the table probe, the check extension, null-move
   * pruning, principal-variation search, and late move reductions. Two rules keep them honest:
   *
   *  - **A PV node never takes a table cutoff and is never null-moved.** A table hit returns a score
   *    with no moves attached, which would truncate the principal variation the panel displays; and
   *    null-move pruning is a guess, which is fine for proving a branch is bad and not fine for the
   *    line we are about to show the user.
   *  - **A reduced search that beats alpha is always re-searched at full depth.** A reduction is
   *    only ever allowed to *skip* work, never to decide anything.
   */
  Search.prototype.negamax = function (pos, depth, alpha, beta, ply, line) {
    line.length = 0;
    this.nodes++;
    if (this.outOfBudget()) return alpha;

    var isPV = (beta - alpha) > 1;
    var inCheck = E.isInCheck(pos, pos.sideToMove);
    // Check extension: a forcing line is cheap to search and expensive to miss. Bounded by MAX_PLY,
    // because an extension spends no depth and a perpetual check would otherwise never terminate.
    if (inCheck && ply < MAX_PLY) depth += 1;

    var moves = E.legalMoves(pos);
    if (moves.length === 0) return inCheck ? -(MATE - ply) : 0;
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply);

    // ---- Table probe -------------------------------------------------------
    this.hash(pos);
    var lo = this.keyScratch[0], hi = this.keyScratch[1];
    var alphaOrig = alpha;
    var ttMove = null;
    var e = this.tt.get(lo);
    if (e && e.hi === hi) {
      ttMove = e.move;                                  // useful for ordering at ANY depth
      if (e.depth >= depth && !isPV) {
        var ts = fromTT(e.score, ply);
        if (e.flag === TT_EXACT) return ts;
        if (e.flag === TT_LOWER) { if (ts > alpha) alpha = ts; }
        else if (ts < beta) beta = ts;
        if (alpha >= beta) return ts;
      }
    }

    // ---- Null move ---------------------------------------------------------
    if (!isPV && !inCheck && depth >= NULL_MIN_DEPTH
        && EV.hasNonPawnMaterial(pos, pos.sideToMove)) {
      var R = depth >= NULL_DEEP_DEPTH ? NULL_R_DEEP : NULL_R;
      var nullLine = [];
      var nullScore = -this.negamax(makeNullMove(pos), depth - 1 - R, -beta, -beta + 1,
                                    ply + 1, nullLine);
      if (this.cancelled) return alpha;
      if (nullScore >= beta) {
        // Never report a mate we have not actually found: a null-move cutoff proves "at least
        // beta", and letting an unproven mate score escape would corrupt the table and the panel.
        return nullScore > MATE_THRESHOLD ? beta : nullScore;
      }
    }

    // ---- Moves -------------------------------------------------------------
    var ord = this.order(moves, pos, ply, ttMove);
    var best = -WIN, bestMove = null;
    var child = [];
    for (var i = 0; i < ord.length; i++) {
      var m = ord[i];
      var quiet = pos.squares[m.to] == null && m.promotion == null && !inCheck;
      var next = E.makeMove(pos, m);
      var score;
      if (i === 0) {
        // The first move gets the real window — it is the one most likely to be best.
        score = -this.negamax(next, depth - 1, -beta, -alpha, ply + 1, child);
      } else {
        var red = 0;
        if (quiet && depth >= LMR_MIN_DEPTH && i >= LMR_MIN_MOVE) {
          red = 1 + ((i >= LMR_WIDE_MOVE && depth >= LMR_WIDE_DEPTH) ? 1 : 0);
          if (red > depth - 1) red = depth - 1;
        }
        // Null window first: all we need to know is whether this move can beat alpha at all.
        score = -this.negamax(next, depth - 1 - red, -alpha - 1, -alpha, ply + 1, child);
        if (!this.cancelled && score > alpha && (red > 0 || isPV)) {
          score = -this.negamax(next, depth - 1, -beta, -alpha, ply + 1, child);
        }
      }
      if (this.cancelled) return best > -WIN ? best : alpha;
      if (score > best) {
        best = score;
        bestMove = m;
        line.length = 0;
        line.push(m);
        for (var j = 0; j < child.length; j++) line.push(child[j]);
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        if (quiet) this.remember(m, ply, depth);
        break;
      }
    }

    var flag = best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    this.store(lo, hi, depth, best, flag, bestMove, ply);
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
   *
   * A thin driver over `analyzeSteps`, which holds the actual search. The dependency used to point
   * the other way — the stepper re-ran THIS function once per depth, always from depth 1, throwing
   * away the previous iteration's table and move ordering every time. Inverting it means there is
   * exactly one search path, so a stepped search and a one-shot search cannot disagree, and the
   * shallow plies are no longer re-searched once per depth.
   */
  function analyze(pos, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var steps = analyzeSteps(pos, opts);
    var last = null, guard = 0;
    for (;;) {
      var r = steps.next();
      if (r.snapshot && r.snapshot !== last) { last = r.snapshot; onProgress(last); }
      if (r.done) break;
      if (++guard > STEP_GUARD) break;      // a stepper that never finishes is a bug, not a hang
    }
    if (!last) {
      last = { fen: E.toFEN(pos), depth: 0, nodes: 0, lines: [], isFinal: true, terminal: null, score: null };
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
   * Iterative deepening, one depth per call — the synchronous core the whole feature runs on.
   *
   * Driving one depth at a time lets the caller paint between iterations, show lines as they are
   * found, and abandon instantly. `engine-host.js` additionally resets a slice deadline before every
   * `next()`, which is what keeps the in-thread `file://` path from freezing the page.
   *
   * **The `Search` is created once and lives across every depth** — its transposition table,
   * killers, history and root ordering included. That is what iterative deepening is *for*: each
   * iteration exists to order the next one. This used to build a fresh search per depth and discard
   * all of it, which made the deepening a pure tax instead of a discount.
   *
   * Returns `{ next() -> { done, snapshot, depth } }`. `snapshot` is the deepest COMPLETED search so
   * far, never a half-finished one, and is null until the first depth completes.
   */
  function analyzeSteps(pos, opts) {
    opts = opts || {};
    var limits = {
      maxDepth: opts.maxDepth || 4,
      maxNodes: opts.maxNodes || 0,
      multiPV: opts.multiPV || 1
    };
    var shouldCancel = opts.shouldCancel || function () { return false; };
    var s = new Search(limits, shouldCancel);
    // Terminal positions never enter the search, which is what makes `mate !== 0` structural.
    var outcome = E.terminalOutcome(pos, opts.historyKeys || []);
    var rootMoves = null;
    var depth = 0, best = null, finished = false;

    /** One complete pass over the root moves at depth `d`. Returns null if it was cut short. */
    function iterate(d) {
      var scored = [];
      var top = [];                        // the best `multiPV` EXACT scores so far, descending
      var line = [];
      for (var i = 0; i < rootMoves.length; i++) {
        var m = rootMoves[i];
        var next = E.makeMove(pos, m);
        var sc, exact = true;
        if (top.length < limits.multiPV) {
          sc = -s.negamax(next, d - 1, -WIN, WIN, 1, line);
        } else {
          // This move can only matter if it reaches the k-th best score, and a null window answers
          // exactly that for a fraction of the cost. Anything that does reach it is re-searched
          // with a full window, so every DISPLAYED line still carries an exact score — while the
          // moves that cannot be displayed stop costing a full-width search each.
          var kth = top[limits.multiPV - 1];
          sc = -s.negamax(next, d - 1, -kth, -kth + 1, 1, line);
          if (s.cancelled) return null;
          if (sc >= kth) sc = -s.negamax(next, d - 1, -WIN, WIN, 1, line);
          else exact = false;              // an upper bound, and strictly below the k-th best
        }
        if (s.cancelled) return null;
        scored.push({ move: m, score: sc, exact: exact, pv: [m].concat(line) });
        if (exact) {
          top.push(sc);
          top.sort(function (a, b) { return b - a; });
          if (top.length > limits.multiPV) top.length = limits.multiPV;
        }
      }
      // Swift's `sort` is not stable, so ties break on the index the move arrived with — the same
      // guard every ported sort in this repo carries, and the reason MultiPV order is reproducible.
      var order = scored.map(function (_, i) { return i; });
      order.sort(function (a, b) { return scored[b].score - scored[a].score || a - b; });
      scored = order.map(function (i) { return scored[i]; });

      var lines = [];
      for (var k = 0; k < Math.min(limits.multiPV, scored.length); k++) {
        lines.push({
          rank: k + 1,
          score: toEngineScore(scored[k].score, pos.sideToMove),
          pv: scored[k].pv,
          pvSAN: pvToSan(pos, scored[k].pv),
          depth: d
        });
      }
      // The best root move goes first next iteration — the cheapest ordering win there is.
      rootMoves = scored.map(function (x) { return x.move; });
      return {
        fen: E.toFEN(pos), depth: d, nodes: s.nodes, lines: lines,
        isFinal: false, terminal: null, score: lines.length ? lines[0].score : null
      };
    }

    return {
      next: function () {
        if (finished) return { done: true, snapshot: best, depth: depth };
        if (outcome.kind !== 'ongoing') {
          finished = true;
          best = {
            fen: E.toFEN(pos), depth: 0, nodes: 0, lines: [],
            isFinal: true, terminal: outcome, score: terminalScore(outcome)
          };
          return { done: true, snapshot: best, depth: 0 };
        }
        if (depth >= limits.maxDepth || shouldCancel()) {
          finished = true;
          return { done: true, snapshot: best, depth: depth };
        }
        if (rootMoves === null) rootMoves = AI.ordered(E.legalMoves(pos), pos);
        depth += 1;
        var snap = iterate(depth);
        // A cut-short iteration is not a result: keep the last COMPLETE one.
        if (snap === null) {
          finished = true;
          return { done: true, snapshot: best, depth: depth };
        }
        best = snap;
        // A forced mate is the end of the story; deeper search cannot improve on it.
        if ((snap.score && snap.score.kind === 'mate') || depth >= limits.maxDepth) finished = true;
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
