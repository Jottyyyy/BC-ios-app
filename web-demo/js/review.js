/* review.js — game review: move classification, accuracy, and the book tier
 *
 * The browser mirror of Sources/BiyaherongCoachCore/GameReview.swift (untouched, PHP-parity) plus
 * Sources/BiyaherongCoachCore/ReviewAnnotator.swift (the `book` tier on top).
 *
 *     node -e "console.log(require('./web-demo/js/review.js').selfTest().summary)"
 *
 * The review math itself is a **faithful port of the Laravel `GameReviewController`**, verified
 * against the same 303 golden cases the Swift `game_review` / `game_review_random` parity groups
 * consume. It is deliberately NOT "improved":
 *
 *  - Accuracy divides by the pre-move win percentage, which grades a lost player leniently and a
 *    winning one harshly. That is what the server does, and behavioural parity was the explicit
 *    decision (see PORTING_NOTES).
 *  - `isBrilliant` is any capture that swings 150cp, not a sacrifice test.
 *  - `great` outranks `best`, inverted from chess.com.
 *
 * Three traps this port has to reproduce exactly, each of which would otherwise pass almost every
 * random case and fail only a hand-written one:
 *
 *  1. **PHP falsiness.** `""` and `"0"` are both falsy in PHP. In JS `Boolean("0") === true`.
 *     Golden case 2 of game_review.json plays SAN "0" precisely to catch this.
 *  2. **Rounding.** PHP `round($x, 1)` is half-away-from-zero; `Math.round(-2.5)` is -2 while PHP
 *     gives -3. Uses `Rating.roundHalfAwayFromZero`.
 *  3. **Win-percentage sign.** `evalToWinPct` must flip for Black. `Rating.evalToWinPct` now takes
 *     the colour for exactly this reason.
 *
 * The `book` tier is a POST-LAYER. `GameReview`'s nine classification keys are never touched; the
 * annotator relabels in-book plies and recomputes the counts with a tenth key. Accuracy is never
 * recomputed — book moves still count toward it, which follows from the parity decision (chess.com
 * excludes them; we do not).
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaReview = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var R = isNode ? require('./rating.js') : Rating;
  // The runner half needs these; both load before this file in index.html. Deliberately NOT
  // opening-book.js — that loads AFTER us, and `annotate` takes bookPlies as a parameter anyway,
  // exactly as ReviewAnnotator.annotate does.
  var E = isNode ? require('./engine.js') : Engine;
  var T = isNode ? require('./movetree.js') : BiyaMoveTree;
  var A = isNode ? require('./analysis-engine.js') : BiyaAnalysis;

  /** The nine keys GameReview produces, in the literal order the PHP oracle emits. */
  var BASE_KEYS = ['brilliant', 'great', 'best', 'excellent', 'good',
                   'inaccuracy', 'mistake', 'miss', 'blunder'];

  /**
   * Display order for the summary table — the nine plus `book` inserted after `great`.
   * The React Native original's CLASSIFICATION_ORDER omitted `book` entirely, so book moves were
   * counted and then never shown. This is the corrected order.
   */
  var DISPLAY_ORDER = ['brilliant', 'great', 'book', 'best', 'excellent', 'good',
                       'inaccuracy', 'mistake', 'miss', 'blunder'];

  function emptyClassifications() {
    var o = {};
    for (var i = 0; i < BASE_KEYS.length; i++) o[BASE_KEYS[i]] = 0;
    return o;
  }

  /** PHP string truthiness: falsy ONLY for "" and "0". */
  function phpStringIsTruthy(s) { return !(s === '' || s === '0'); }

  /** PHP round($x, 1) — half away from zero, one decimal. */
  function round1(x) { return R.roundHalfAwayFromZero(x * 10) / 10; }

  /** Fold a mate score into centipawns. White: 10000 - mate*10; Black: -10000 - mate*10. */
  function normalizeEval(e) {
    if (e && e.eval_mate !== null && e.eval_mate !== undefined) {
      var mate = e.eval_mate | 0;
      return mate > 0 ? (10000 - mate * 10) : (-10000 - mate * 10);
    }
    return (e && e.eval_cp !== null && e.eval_cp !== undefined) ? e.eval_cp : 0;
  }

  /** The threshold ladder, top to bottom, first match wins. */
  function classifyMove(cpLoss, isBestMove, isBrilliant) {
    if (isBrilliant) return 'brilliant';
    if (isBestMove && cpLoss <= 5) return 'great';
    if (isBestMove || cpLoss <= 0) return 'best';
    if (cpLoss <= 15) return 'excellent';
    if (cpLoss <= 30) return 'good';
    if (cpLoss <= 60) return 'inaccuracy';
    if (cpLoss <= 120) return 'mistake';
    if (cpLoss <= 200) return 'miss';
    return 'blunder';
  }

  /** Capture (SAN contains 'x') AND the mover's eval improved by >= 150cp. Matches the code. */
  function isBrilliantMove(san, color, evalBefore, evalAfter) {
    var improvement = color === 'w' ? (evalAfter - evalBefore) : (evalBefore - evalAfter);
    if (improvement < 100) return false;
    return san.indexOf('x') >= 0 && improvement >= 150;
  }

  function evalToWinPct(evalCp, color) { return R.evalToWinPct(evalCp, color); }

  /**
   * The full review over parallel `evaluations` / `moves` arrays (index 0 = the start position).
   * Mirrors GameReviewController::review's per-move loop exactly.
   */
  function review(evaluations, moves) {
    var whiteClass = emptyClassifications(), blackClass = emptyClassifications();
    var whiteAcc = [], blackAcc = [];
    var moveEvals = [], graph = [];

    if (!evaluations || evaluations.length === 0) {
      return {
        whiteAccuracy: 0, blackAccuracy: 0,
        whiteClassifications: whiteClass, blackClassifications: blackClass,
        moveEvaluations: [], evalGraph: []
      };
    }

    graph.push({ move_index: 0, eval_cp: normalizeEval(evaluations[0]),
                 eval_mate: evaluations[0] ? nullish(evaluations[0].eval_mate) : null });

    for (var i = 1; i < evaluations.length; i++) {
      // `moves` may be shorter than `evaluations`, and an element may be null outright.
      var mv = (i < moves.length) ? moves[i] : null;
      var color = mv ? nullish(mv.color) : null;
      var san = mv ? nullish(mv.san) : null;

      var evalBefore = normalizeEval(evaluations[i - 1]);
      var evalAfter = normalizeEval(evaluations[i]);

      // Every ply gets a graph point, including the ones skipped below.
      graph.push({ move_index: i, eval_cp: evalAfter, eval_mate: nullish(evaluations[i].eval_mate) });

      // PHP `if (! $color || ! $san) continue;` — a string is falsy only when "" or "0".
      if (color === null || san === null || !phpStringIsTruthy(color) || !phpStringIsTruthy(san)) continue;

      var cpLoss = color === 'w' ? (evalBefore - evalAfter) : (evalAfter - evalBefore);
      if (cpLoss < 0) cpLoss = 0;

      var bestMoveSan = nullish(evaluations[i - 1].best_move_san);
      // PHP `$bestMoveSan && $san === $bestMoveSan` — bestMoveSan must be truthy too.
      var isBest = bestMoveSan !== null && phpStringIsTruthy(bestMoveSan) && san === bestMoveSan;
      var brilliant = isBrilliantMove(san, color, evalBefore, evalAfter);
      var classification = classifyMove(cpLoss, isBest, brilliant);

      moveEvals.push({ move_index: i, classification: classification,
                       cp_loss: cpLoss, best_move_san: bestMoveSan });

      if (color === 'w') whiteClass[classification]++; else blackClass[classification]++;

      var wpBefore = evalToWinPct(evalBefore, color);
      var wpAfter = evalToWinPct(evalAfter, color);
      var acc = wpBefore > 0
        ? Math.min(100, Math.max(0, (wpAfter / wpBefore) * 100))
        : (wpAfter >= wpBefore ? 100 : 0);
      if (color === 'w') whiteAcc.push(acc); else blackAcc.push(acc);
    }

    return {
      whiteAccuracy: whiteAcc.length ? round1(sum(whiteAcc) / whiteAcc.length) : 0,
      blackAccuracy: blackAcc.length ? round1(sum(blackAcc) / blackAcc.length) : 0,
      whiteClassifications: whiteClass, blackClassifications: blackClass,
      moveEvaluations: moveEvals, evalGraph: graph
    };
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function nullish(v) { return (v === undefined || v === null) ? null : v; }

  // ---- The book tier (post-layer) -------------------------------------------

  /**
   * Relabel plies that are still in the opening book, without touching `base`.
   *
   * `bookPlies` is a list of move indices (the same indices `moveEvaluations[].move_index` uses).
   * Returns { base, moveEvaluations, whiteClassifications, blackClassifications, displayOrder }.
   * Accuracy is NOT recomputed — read it from `base`.
   */
  function annotate(base, moves, bookPlies) {
    var inBook = {};
    (bookPlies || []).forEach(function (p) { inBook[p] = true; });

    var white = emptyClassifications(), black = emptyClassifications();
    white.book = 0; black.book = 0;

    var out = base.moveEvaluations.map(function (me) {
      var cls = inBook[me.move_index] ? 'book' : me.classification;
      var mv = (me.move_index < moves.length) ? moves[me.move_index] : null;
      var color = mv ? nullish(mv.color) : null;
      if (color === 'w') white[cls]++; else if (color === 'b') black[cls]++;
      return { move_index: me.move_index, classification: cls,
               cp_loss: me.cp_loss, best_move_san: me.best_move_san };
    });

    return {
      base: base, moveEvaluations: out,
      whiteClassifications: white, blackClassifications: black,
      displayOrder: DISPLAY_ORDER.slice()
    };
  }

  // ---- The runner (mirrors ReviewAnnotator.plan / .Evaluator) -----------------

  /**
   * Walk a tree's main line into the review's input shape.
   *
   * `positions[0]` is the starting position and `moves[0]` is a placeholder, matching the server's
   * contract (and `extractGamePositions` in the RN source, board.tsx:2223-2224).
   *
   * SAN comes from the node, which MoveTree always produced via the generator. That matters:
   * GameReview matches `bestMoveSan` by **string equality**, so feeding it an imported PGN's
   * spelling (`Nbd2` where we generate `N1d2`) would silently mis-classify.
   */
  function plan(tree) {
    var nodes = T.mainline(tree);
    var start = E.fromFEN(tree.initialFen);
    if (!start) return { positions: [], moves: [], nodes: [], keys: [] };

    var positions = [start];
    var keys = [E.positionKey(start)];
    var moves = [{ san: null, color: null }];

    for (var i = 0; i < nodes.length; i++) {
      var pos = E.fromFEN(nodes[i].fenAfter);
      if (!pos) break;
      positions.push(pos);
      keys.push(nodes[i].key);
      moves.push({ san: nodes[i].san, color: nodes[i].color === E.WHITE ? 'w' : 'b' });
    }
    return { positions: positions, moves: moves, nodes: nodes, keys: keys };
  }

  /**
   * Evaluate a plan ONE POSITION PER CALL — the synchronous core behind `reviewProgressive`.
   *
   * A whole review is far too slow to run in one go: measured, a 40-move game costs 28s at a fixed
   * depth 3. Two things fix that. Each position gets a wall-clock budget (`budgetMs`) enforced
   * inside the engine's own `shouldCancel`, so a sharp position stops at depth 2 instead of grinding
   * to depth 3; and stepping lets the caller yield between positions so the page keeps painting and
   * Cancel lands immediately.
   *
   * `next()` returns `{ finished, completed, total, cancelled }`. A cancelled run leaves
   * `evaluations()` SHORT — treat that as "cancelled", never as a truncated game.
   */
  function reviewSteps(gamePlan, opts) {
    opts = opts || {};
    var total = gamePlan.positions.length;
    var maxDepth = opts.maxDepth || 6;
    var budgetMs = opts.budgetMs || 200;
    var shouldCancel = opts.shouldCancel || function () { return false; };
    var i = 0, out = [], cancelled = false;

    function state() {
      return { finished: cancelled || i >= total, completed: i, total: total, cancelled: cancelled };
    }
    return {
      total: total,
      next: function () {
        if (cancelled || i >= total) return state();
        if (shouldCancel()) { cancelled = true; return state(); }
        var deadline = Date.now() + budgetMs;
        var snap = A.analyze(gamePlan.positions[i], {
          maxDepth: maxDepth,
          multiPV: 1,
          shouldCancel: function () { return shouldCancel() || Date.now() > deadline; }
        });
        var best = snap.lines.length ? snap.lines[0].pvSAN[0] : null;
        out.push(A.asReviewEvaluation(snap.score, best));
        i += 1;
        return state();
      },
      evaluations: function () { return out; },
      /** True only when every position was evaluated — the guard against a truncated review. */
      isComplete: function () { return !cancelled && out.length === total; }
    };
  }

  /** `reviewSteps` driven by the event loop: one position per macrotask. */
  function reviewProgressive(gamePlan, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () { };
    var steps = reviewSteps(gamePlan, opts);
    return new Promise(function (resolve) {
      (function pump() {
        setTimeout(function () {
          var r = steps.next();
          onProgress(r.completed, r.total);
          if (r.finished) {
            resolve({ evaluations: steps.evaluations(), complete: steps.isComplete(),
                      cancelled: r.cancelled });
          } else { pump(); }
        }, 0);
      })();
    });
  }

  /**
   * The whole pipeline, once the evaluations are in: review → book tier.
   * `bookPlies` comes from the caller (BiyaOpeningBook), keeping this file free of that dependency.
   */
  function finish(gamePlan, evaluations, bookPlies) {
    var base = review(evaluations, gamePlan.moves);
    return annotate(base, gamePlan.moves, bookPlies || []);
  }

  // ---- Self-test ------------------------------------------------------------
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }

    // 1. The traps.
    expect(phpStringIsTruthy('') === false, 'PHP falsiness: "" is falsy');
    expect(phpStringIsTruthy('0') === false, 'PHP falsiness: "0" is falsy (JS Boolean("0") is true)');
    expect(phpStringIsTruthy('e4') === true, 'PHP falsiness: "e4" is truthy');
    expect(round1(-0.05) === -0.1, 'round1 is half AWAY from zero, not Math.round');
    expect(round1(0.05) === 0.1, 'round1 rounds .5 up for positives');
    expect(Math.abs(evalToWinPct(0, 'w') - 50) < 1e-9, 'an equal position is 50% for White');
    expect(Math.abs(evalToWinPct(0, 'b') - 50) < 1e-9, 'an equal position is 50% for Black');
    expect(evalToWinPct(400, 'w') > 90, 'White up 4 pawns is winning for White');
    expect(evalToWinPct(400, 'b') < 10, 'the SAME eval is losing for Black — the sign flip');

    // 2. normalizeEval mate folding.
    expect(normalizeEval({ eval_cp: null, eval_mate: 1 }) === 9990, 'M1 folds to 9990');
    expect(normalizeEval({ eval_cp: null, eval_mate: 5 }) === 9950, 'M5 folds to 9950');
    expect(normalizeEval({ eval_cp: null, eval_mate: -1 }) === -9990, 'M-1 folds to -9990');
    expect(normalizeEval({ eval_cp: null, eval_mate: -5 }) === -9950, 'M-5 folds to -9950');
    expect(normalizeEval({ eval_cp: 42, eval_mate: null }) === 42, 'a cp score passes through');
    expect(normalizeEval({ eval_cp: null, eval_mate: null }) === 0, 'a null eval is 0');

    // 3. The classification ladder, at every boundary.
    expect(classifyMove(0, true, true) === 'brilliant', 'brilliant wins');
    expect(classifyMove(5, true, false) === 'great', 'best move at 5cp is great');
    expect(classifyMove(6, true, false) === 'best', 'best move past 5cp is best');
    expect(classifyMove(0, false, false) === 'best', 'zero loss is best');
    expect(classifyMove(15, false, false) === 'excellent', 'excellent boundary');
    expect(classifyMove(16, false, false) === 'good', 'good boundary');
    expect(classifyMove(30, false, false) === 'good', 'good upper boundary');
    expect(classifyMove(31, false, false) === 'inaccuracy', 'inaccuracy boundary');
    expect(classifyMove(60, false, false) === 'inaccuracy', 'inaccuracy upper boundary');
    expect(classifyMove(61, false, false) === 'mistake', 'mistake boundary');
    expect(classifyMove(120, false, false) === 'mistake', 'mistake upper boundary');
    expect(classifyMove(121, false, false) === 'miss', 'miss boundary');
    expect(classifyMove(200, false, false) === 'miss', 'miss upper boundary');
    expect(classifyMove(201, false, false) === 'blunder', 'blunder boundary');

    // 4. Brilliancy — a capture that swings 150cp. Not a sacrifice test; that is the server's rule.
    expect(isBrilliantMove('Qxf7', 'w', 0, 200) === true, 'a capture swinging 200 is brilliant');
    expect(isBrilliantMove('Qf7', 'w', 0, 200) === false, 'a quiet move is never brilliant');
    expect(isBrilliantMove('Qxf7', 'w', 0, 140) === false, 'a capture swinging 140 is not brilliant');
    expect(isBrilliantMove('Qxf7', 'b', 0, -200) === true, 'the swing is measured for the mover');

    // 5. A tiny end-to-end review.
    var evals = [
      { eval_cp: 0, eval_mate: null, best_move_san: 'e4' },
      { eval_cp: -300, eval_mate: null, best_move_san: 'e5' }
    ];
    var mvs = [null, { san: 'a3', color: 'w' }];
    var r = review(evals, mvs);
    expect(r.moveEvaluations.length === 1, 'one move is classified');
    expect(r.moveEvaluations[0].cp_loss === 300, 'cpLoss is 300 for White');
    expect(r.moveEvaluations[0].classification === 'blunder', 'a 300cp drop is a blunder');
    expect(r.evalGraph.length === 2, 'the graph has a point per ply plus the start');
    expect(r.whiteClassifications.blunder === 1, 'the blunder is counted for White');
    expect(Object.keys(r.whiteClassifications).length === 9, 'GameReview keeps exactly 9 keys');

    // A skipped ply still produces a graph point but no classification.
    var skipped = review(
      [{ eval_cp: 0, eval_mate: null, best_move_san: null },
       { eval_cp: 10, eval_mate: null, best_move_san: null }],
      [null, { san: null, color: null }]);
    expect(skipped.moveEvaluations.length === 0, 'a null move is skipped');
    expect(skipped.evalGraph.length === 2, 'but it still gets a graph point');
    // The "0" trap in anger.
    var zero = review(
      [{ eval_cp: 0, eval_mate: null, best_move_san: '0' },
       { eval_cp: 10, eval_mate: null, best_move_san: null }],
      [null, { san: '0', color: 'w' }]);
    expect(zero.moveEvaluations.length === 0, 'SAN "0" is falsy in PHP, so the ply is skipped');

    // 6. The book tier changes nothing when the book is empty.
    var withBook = annotate(r, mvs, []);
    expect(JSON.stringify(withBook.moveEvaluations) === JSON.stringify(r.moveEvaluations),
      'an empty book leaves moveEvaluations untouched');
    expect(withBook.whiteClassifications.book === 0, 'an empty book adds book:0');
    expect(Object.keys(withBook.whiteClassifications).length === 10, 'the display map has 10 keys');
    BASE_KEYS.forEach(function (k) {
      expect(withBook.whiteClassifications[k] === r.whiteClassifications[k],
        'an empty book preserves the "' + k + '" count');
    });
    expect(withBook.base === r, 'the base result is carried through untouched');
    expect(withBook.displayOrder.join(',') === 'brilliant,great,book,best,excellent,good,inaccuracy,mistake,miss,blunder',
      'display order inserts book after great');

    // A book ply moves exactly one count out of its tier and into `book`.
    var booked = annotate(r, mvs, [1]);
    expect(booked.moveEvaluations[0].classification === 'book', 'the in-book ply is relabelled');
    expect(booked.whiteClassifications.book === 1, 'book is 1');
    expect(booked.whiteClassifications.blunder === 0, 'and the blunder count dropped to 0');
    expect(booked.base.whiteClassifications.blunder === 1, 'the BASE result is still untouched');
    expect(booked.base.whiteAccuracy === r.whiteAccuracy, 'accuracy is never recomputed');

    // ---- The runner ------------------------------------------------------------
    var tree = T.create();
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'].forEach(function (s) { T.addSan(tree, s); });
    var p = plan(tree);
    expect(p.positions.length === 7, 'six plies give seven positions, got ' + p.positions.length);
    expect(p.nodes.length === 6, 'and six nodes');
    expect(p.moves.length === 7, 'moves is parallel to positions');
    expect(p.moves[0].san === null && p.moves[0].color === null, 'moves[0] is the placeholder');
    expect(p.moves[1].san === 'e4' && p.moves[1].color === 'w', 'moves[1] is White\'s first move');
    expect(p.moves[2].color === 'b', 'and moves[2] is Black\'s');
    expect(p.keys.length === 7, 'keys is parallel too');
    expect(p.keys[0] === E.positionKey(E.start()), 'keys[0] is the start position');
    expect(p.keys[6] === p.nodes[5].key, 'the last key is the last node\'s');
    // A variation must not enter the plan — review is main-line only.
    T.goBack(tree); T.addSan(tree, 'b5');
    expect(plan(tree).nodes.length === 6, 'a variation does not lengthen the plan');
    expect(plan(tree).nodes[5].san === 'a6', 'the main line is unchanged');
    expect(plan(T.create()).positions.length === 1, 'an empty tree is just the start position');

    // Stepping: one position per call, ending exactly on the total.
    var st = reviewSteps(p, { maxDepth: 1, budgetMs: 50 });
    expect(st.total === 7, 'the stepper knows the total');
    var seen = [], guard = 0, s;
    do { s = st.next(); seen.push(s.completed); } while (!s.finished && ++guard < 20);
    expect(seen.join(',') === '1,2,3,4,5,6,7', 'one position per step, got ' + seen.join(','));
    expect(st.isComplete(), 'a full walk is complete');
    expect(st.evaluations().length === 7, 'and produced one evaluation per position');
    expect(st.next().finished === true, 'a finished stepper stays finished');

    // Cancelling leaves a SHORT array, which must read as cancelled, not as a truncated game.
    var stop = false;
    var cst = reviewSteps(p, { maxDepth: 1, budgetMs: 50, shouldCancel: function () { return stop; } });
    cst.next(); cst.next();
    stop = true;
    var after = cst.next();
    expect(after.cancelled === true, 'cancelling is reported');
    expect(after.finished === true, 'and ends the walk');
    expect(cst.evaluations().length === 2, 'with only the completed positions');
    expect(cst.isComplete() === false, 'and isComplete() says so — the guard against a short review');

    // The evaluations feed the pinned pipeline unchanged.
    var full = reviewSteps(p, { maxDepth: 1, budgetMs: 50 });
    while (!full.next().finished) { /* run it out */ }
    var ann = finish(p, full.evaluations(), []);
    expect(ann.base.whiteAccuracy >= 0 && ann.base.whiteAccuracy <= 100, 'accuracy is a percentage');
    expect(ann.moveEvaluations.length === 6, 'one classification per ply, got ' + ann.moveEvaluations.length);
    expect(ann.moveEvaluations[0].move_index === 1, 'move_index is 1-based — 0 is the start position');
    var viaBook = finish(p, full.evaluations(), [1, 2]);
    expect(viaBook.moveEvaluations[0].classification === 'book', 'bookPlies reach the annotator');
    expect(viaBook.moveEvaluations[1].classification === 'book', 'for every listed ply');
    expect(viaBook.base.whiteAccuracy === ann.base.whiteAccuracy, 'and never touch accuracy');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'ReviewSelfTest: ' + passed + ' assertions passed'
        : 'ReviewSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  /**
   * Replay Goldens/game_review*.json — the PHP oracle's own vectors, the same ones the Swift
   * `game_review` / `game_review_random` parity groups consume. `tol` mirrors ParityRunner:
   * 1e-4 for the curated file, 1e-3 for the randomized batch.
   */
  function selfTestGoldens(cases, label, tol) {
    var passed = 0, failures = [], extra = 0;
    function expect(cond, what) {
      if (cond) { passed++; return; }
      if (failures.length < 25) failures.push(what); else extra++;
    }
    function near(a, b) { return Math.abs(a - b) <= tol; }

    for (var ci = 0; ci < cases.length; ci++) {
      var c = cases[ci], r = review(c.evaluations, c.moves);
      expect(near(r.whiteAccuracy, c.result.whiteAccuracy),
        label + ci + ' whiteAcc ' + r.whiteAccuracy + ' != ' + c.result.whiteAccuracy);
      expect(near(r.blackAccuracy, c.result.blackAccuracy),
        label + ci + ' blackAcc ' + r.blackAccuracy + ' != ' + c.result.blackAccuracy);
      expect(JSON.stringify(r.whiteClassifications) === JSON.stringify(c.result.whiteClassifications),
        label + ci + ' whiteClass ' + JSON.stringify(r.whiteClassifications));
      expect(JSON.stringify(r.blackClassifications) === JSON.stringify(c.result.blackClassifications),
        label + ci + ' blackClass ' + JSON.stringify(r.blackClassifications));
      expect(r.moveEvaluations.length === c.result.moveEvaluations.length,
        label + ci + ' moveEval count ' + r.moveEvaluations.length + ' != ' + c.result.moveEvaluations.length);
      var n = Math.min(r.moveEvaluations.length, c.result.moveEvaluations.length);
      for (var i = 0; i < n; i++) {
        var a = r.moveEvaluations[i], b = c.result.moveEvaluations[i];
        expect(a.move_index === b.move_index && a.classification === b.classification
               && a.cp_loss === b.cp_loss && a.best_move_san === b.best_move_san,
          label + ci + ' me idx' + b.move_index + ': (' + a.classification + ',' + a.cp_loss + ') != ('
            + b.classification + ',' + b.cp_loss + ')');
      }
      expect(r.evalGraph.length === c.result.evalGraph.length, label + ci + ' graph count');
      var gn = Math.min(r.evalGraph.length, c.result.evalGraph.length);
      for (var j = 0; j < gn; j++) {
        var ga = r.evalGraph[j], gb = c.result.evalGraph[j];
        expect(ga.move_index === gb.move_index && ga.eval_cp === gb.eval_cp && ga.eval_mate === gb.eval_mate,
          label + ci + ' graph idx' + gb.move_index + ': cp' + ga.eval_cp + ' != ' + gb.eval_cp);
      }
    }
    if (extra > 0) failures.push('… and ' + extra + ' more failures');
    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'ReviewGoldens[' + label + ']: ' + passed + ' assertions passed over ' + cases.length + ' cases'
        : 'ReviewGoldens[' + label + ']: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    BASE_KEYS: BASE_KEYS, DISPLAY_ORDER: DISPLAY_ORDER,
    emptyClassifications: emptyClassifications, phpStringIsTruthy: phpStringIsTruthy, round1: round1,
    normalizeEval: normalizeEval, classifyMove: classifyMove, isBrilliantMove: isBrilliantMove,
    evalToWinPct: evalToWinPct, review: review, annotate: annotate,
    plan: plan, reviewSteps: reviewSteps, reviewProgressive: reviewProgressive, finish: finish,
    selfTest: selfTest, selfTestGoldens: selfTestGoldens
  };
})();

/* Makes the review runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaReview; }
