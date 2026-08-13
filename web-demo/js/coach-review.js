/* coach-review.js — the offline game review (spec 2.10).
 *
 *     node -e "console.log(require('./web-demo/js/coach-review.js').selfTest().summary)"
 *
 * The RN screen posted every position to `/api/games/review` — rate-limited to 5 per hour, capped
 * at 201 positions. Offline it runs on the embedded engine, and the classification maths is not
 * rewritten: `review.js` is already the parity port of `GameReviewController`, verified against the
 * same 303 golden cases the Swift `game_review` group consumes.
 *
 * So this file is an ADAPTER plus the modal's derived values, and nothing else:
 *
 *   planFromGame   coach-game.js's `moveRecords` -> the `{positions, moves, nodes, keys}` shape
 *                  `review.js` already consumes. No MoveTree is built; `nodes` is empty because
 *                  only the Analysis Board's stamp-back uses it.
 *   handoff        the PGN, the starting FEN, and — the point of spec 7 #28 — the per-move
 *                  classifications, which the RN hand-off never once carried.
 *
 * ## The two fixes that live here
 *
 *  - **7 #28.** `handleGameReview` read `reviewData` but its dependency list contained only
 *    `moveRecords`, so the memoised callback closed over `reviewData === null` forever and the
 *    Analysis Board received an empty `moveEvaluations` array EVERY time. `handoff` cannot express
 *    that: it takes the summary as an argument and fails loudly if it is missing.
 *  - **2.10's orientation fix.** The RN modal ordered the accuracy columns White-left/Black-right
 *    but the classification rows user-left/opponent-right, so playing Black put the coach's
 *    accuracy above your own move counts. `columns()` is the single source of that ordering, and
 *    both halves read it.
 */
'use strict';

var BiyaCoachReview = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var REV = isNode ? require('./review.js') : BiyaReview;
  var GAME = isNode ? require('./coach-game.js') : BiyaCoachGame;
  var MET = isNode ? require('./coach-metrics.js') : BiyaCoachMetrics;
  // The Analysis Board's review UI already owns the accuracy bands, the ten classification
  // colours and the one-decimal accuracy format, in BOTH languages. Delegating is the point:
  // a second copy of the bands is a second thing to keep in step with board.tsx.
  var AMET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;

  var WHITE = 'w', BLACK = 'b';

  /** Spec 2.10: depth 12 for the batch. */
  var REVIEW_DEPTH = 12;
  /** Below this many positions there is nothing to review — one position is just the start. */
  var MIN_POSITIONS = 2;

  // ---- The adapter --------------------------------------------------------------------------------

  /**
   * `coach-game.js`'s records in the shape `review.js` consumes.
   *
   * `positions[0]` is the start and `moves[0]` is a placeholder, matching the server's contract and
   * `extractGamePositions` in the RN source. Every record already carries the FEN *after* its move,
   * so no move has to be replayed to rebuild the game — which is also why a draft restored from
   * storage can be reviewed without trusting its SAN.
   */
  function planFromGame(game) {
    var positions = [], keys = [], moves = [{ san: null, color: null }];
    var recs = (game && game.moveRecords) || [];
    for (var i = 0; i < recs.length; i++) {
      var pos = E.fromFEN(recs[i].fen);
      if (!pos) break;                       // a corrupt record truncates rather than throws
      positions.push(pos);
      keys.push(E.positionKey(pos));
      if (i > 0) moves.push({ san: recs[i].san, color: recs[i].color || null });
    }
    // `moves` can only outrun `positions` if a FEN failed to parse mid-list; trim so the two stay
    // aligned, because `review()` walks them by index.
    moves = moves.slice(0, positions.length);
    return { positions: positions, moves: moves, nodes: [], keys: keys };
  }

  function isReviewable(game) {
    return planFromGame(game).positions.length >= MIN_POSITIONS;
  }

  // ---- The modal's derived values ------------------------------------------------------------------

  /** Spec 2.10's four accuracy bands — the Analysis Board's, which are the same four. */
  function accuracyColor(pct) { return AMET.accuracyColor(pct); }

  /** `91.2%`. `toFixed(1)` is what board.tsx:3851 does, so the two screens round alike. */
  function accuracyText(pct) { return AMET.accuracyText(pct || 0); }

  /** The colour of a classification row, from the ten-tier table both screens share. */
  function classColor(key) {
    var s = AMET.CLASSIFICATIONS[key];
    return s ? s.color : null;
  }

  /** `"Book B"` / `"Good"` — the label with its symbol, as spec 2.10's rows are written. */
  function classLabel(key) { return AMET.classificationText(key); }

  /**
   * The two columns, in ONE order that both halves of the modal use.
   *
   * This is spec 2.10's fix. The RN modal built the accuracy row White-left/Black-right and the
   * classification rows user-left/opponent-right; playing Black therefore put the coach's accuracy
   * directly above your own move counts, with nothing saying so.
   */
  function columns(summary, userColor) {
    var user = userColor === BLACK ? BLACK : WHITE;
    var mine = {
      side: user,
      label: 'You',
      accuracy: user === WHITE ? summary.whiteAccuracy : summary.blackAccuracy,
      classifications: user === WHITE ? summary.whiteClassifications
                                      : summary.blackClassifications,
    };
    var theirs = {
      side: user === WHITE ? BLACK : WHITE,
      label: 'Coach',
      accuracy: user === WHITE ? summary.blackAccuracy : summary.whiteAccuracy,
      classifications: user === WHITE ? summary.blackClassifications
                                      : summary.whiteClassifications,
    };
    return [mine, theirs];
  }

  /**
   * The classification rows to draw: display order, skipping any key that is zero on BOTH sides.
   *
   * `left`/`right` follow `columns`, so a row cannot be oriented differently from the accuracy
   * above it.
   */
  function classificationRows(summary, userColor) {
    var cols = columns(summary, userColor);
    var order = summary.displayOrder || REV.DISPLAY_ORDER;
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      var left = cols[0].classifications[key] || 0;
      var right = cols[1].classifications[key] || 0;
      if (left === 0 && right === 0) continue;
      out.push({ key: key, left: left, right: right });
    }
    return out;
  }

  /**
   * The eval graph's points, clamped to ±500 cp and mapped into a `width` × `height` box.
   *
   * `y` is measured from the top, so a white advantage is a smaller `y` — the same orientation the
   * spec's "white fill above the midline" describes.
   */
  // The component's own `CLAMP`, lifted by the extractor. Restating it here is how the graph and
  // the maths behind it would eventually disagree about what "off the scale" means.
  var GRAPH_CLAMP_CP = MET.PLAY.graph.clampCp;

  function graphPoints(evalGraph, width, height) {
    var pts = evalGraph || [];
    if (pts.length < 2) return [];
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var cp = pts[i].eval_cp;
      if (cp == null) cp = 0;
      if (cp > GRAPH_CLAMP_CP) cp = GRAPH_CLAMP_CP;
      if (cp < -GRAPH_CLAMP_CP) cp = -GRAPH_CLAMP_CP;
      out.push({
        x: (i / (pts.length - 1)) * width,
        y: height / 2 - (cp / GRAPH_CLAMP_CP) * (height / 2),
        cp: cp,
      });
    }
    return out;
  }

  // ---- The hand-off (spec 7 #28) -------------------------------------------------------------------

  /**
   * The game as PGN, from the record list.
   *
   * Movetext only: the review hand-off carries the starting FEN separately, and a `[FEN]` tag on a
   * game that started from the initial position is noise the Analysis Board would have to strip.
   */
  function pgn(game) {
    var recs = (game && game.moveRecords) || [];
    var parts = [];
    for (var i = 1; i < recs.length; i++) {
      if (i % 2 === 1) parts.push(((i - 1) / 2 + 1) + '.');
      parts.push(recs[i].san);
    }
    return parts.join(' ');
  }

  /**
   * What the Analysis Board is handed.
   *
   * The RN version always shipped `moveEvaluations: []` — not sometimes, always — because the
   * memoised callback's dependency list omitted `reviewData`. Making the summary a required
   * ARGUMENT is what stops that being expressible: there is no captured variable to go stale.
   */
  function handoff(game, summary) {
    if (!summary || !summary.moveEvaluations) return null;
    return {
      pgn: pgn(game),
      startFen: (game.moveRecords[0] || {}).fen || E.START_FEN,
      classifications: summary.moveEvaluations.slice(),
      userColor: game.userColor,
    };
  }

  // ---- Running one -------------------------------------------------------------------------------

  /**
   * Analyse the whole game, then classify. `opts` is `{ onProgress, shouldCancel, maxDepth }`.
   *
   * A cancelled run resolves `null` rather than a short summary: `reviewSteps` leaves its
   * evaluations SHORT when cancelled, and a truncated review that looked complete would report an
   * accuracy computed over half a game.
   */
  function run(game, opts) {
    opts = opts || {};
    var gamePlan = planFromGame(game);
    if (gamePlan.positions.length < MIN_POSITIONS) return Promise.resolve(null);
    var book = (typeof BiyaOpeningBook !== 'undefined') ? BiyaOpeningBook
             : (isNode ? tryRequire('./opening-book.js') : null);
    return REV.reviewProgressive(gamePlan, {
      maxDepth: opts.maxDepth || REVIEW_DEPTH,
      budgetMs: opts.budgetMs,
      onProgress: opts.onProgress,
      shouldCancel: opts.shouldCancel,
    }).then(function (res) {
      if (res.cancelled || !res.complete) return null;
      var plies = book && book.bookPlies ? book.bookPlies(gamePlan.keys) : [];
      var annotated = REV.finish(gamePlan, res.evaluations, plies);
      return {
        whiteAccuracy: annotated.base.whiteAccuracy,
        blackAccuracy: annotated.base.blackAccuracy,
        whiteClassifications: annotated.whiteClassifications,
        blackClassifications: annotated.blackClassifications,
        moveEvaluations: annotated.moveEvaluations,
        evalGraph: annotated.base.evalGraph,
        displayOrder: annotated.displayOrder,
        total: gamePlan.positions.length,
      };
    });
  }

  function tryRequire(m) { try { return require(m); } catch (e) { return null; } }

  // ---- Self-test ----------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    // --- the adapter ---
    var g = GAME.newGame(3, WHITE);
    eq(planFromGame(g).positions.length, 1, 'a fresh game plans one position — the start');
    eq(isReviewable(g), false, 'and is not reviewable');
    GAME.record(g, 'e2e4');
    GAME.record(g, 'e7e5');
    GAME.record(g, 'g1f3');
    var p = planFromGame(g);
    eq(p.positions.length, 4, 'three moves make four positions');
    eq(p.moves.length, 4, 'and four move slots');
    eq(p.moves[0].san, null, 'slot 0 is the placeholder the server contract wants');
    eq(p.moves[1].san, 'e4', 'then the moves in order');
    eq(p.moves[1].color, 'w', 'with the colour that played them');
    eq(p.moves[2].color, 'b', 'alternating');
    eq(p.keys.length, p.positions.length, 'one key per position');
    eq(p.keys[0], E.positionKey(E.fromFEN(E.START_FEN)), 'keyed the way the opening book expects');
    eq(p.nodes.length, 0, 'no tree nodes — nothing downstream of the coach uses them');
    eq(isReviewable(g), true, 'and now it is reviewable');

    // A corrupt record truncates rather than throwing: a draft that survived a bad write must not
    // take the review screen down with it.
    var bad = GAME.newGame(3, WHITE);
    GAME.record(bad, 'e2e4');
    bad.moveRecords[1].fen = 'not a fen';
    var bp = planFromGame(bad);
    eq(bp.positions.length, 1, 'an unreadable FEN stops the plan there');
    eq(bp.moves.length, 1, 'and the two arrays stay aligned');

    // --- accuracy colours (2.10's four bands, delegated to the Analysis Board's) ---
    eq(accuracyColor(100), AMET.accuracyColor(100), 'the bands are the board\'s, not a second set');
    eq(accuracyText(91.24), '91.2%', 'and the format is one decimal');
    eq(classColor('blunder'), AMET.CLASSIFICATIONS.blunder.color, 'as are the class colours');
    eq(classLabel('book'), 'Book B', 'and the labels carry their symbols');
    eq(accuracyColor(100), '#4CAF50', 'perfect is green');
    eq(accuracyColor(80), '#4CAF50', 'and 80 is the boundary');
    eq(accuracyColor(79.9), '#FFC107', 'just under is amber');
    eq(accuracyColor(60), '#FFC107', '60 is amber');
    eq(accuracyColor(59.9), '#FF9800', 'just under is orange');
    eq(accuracyColor(40), '#FF9800', '40 is orange');
    eq(accuracyColor(39.9), '#F44336', 'and below that is red');
    eq(accuracyColor(0), '#F44336', 'as is zero');

    // --- the orientation fix ---
    var summary = {
      whiteAccuracy: 91.2, blackAccuracy: 44.5,
      whiteClassifications: { best: 3, blunder: 0, good: 1 },
      blackClassifications: { best: 1, blunder: 2, good: 0 },
      displayOrder: ['best', 'good', 'blunder'],
    };
    var asWhite = columns(summary, WHITE);
    eq(asWhite[0].accuracy, 91.2, 'as White, the first column is your own accuracy');
    eq(asWhite[1].accuracy, 44.5, 'and the second is the coach');
    var asBlack = columns(summary, BLACK);
    eq(asBlack[0].accuracy, 44.5, 'as Black, the FIRST column is still your own');
    eq(asBlack[1].accuracy, 91.2, 'and the coach is second');
    eq(asBlack[0].side, BLACK, 'the column knows which side it is');

    var rowsW = classificationRows(summary, WHITE);
    eq(rowsW.length, 3, 'three rows have a non-zero count somewhere');
    eq(rowsW[0].key, 'best', 'in display order');
    eq(rowsW[0].left, 3, 'left is your own count');
    eq(rowsW[0].right, 1, 'right is the coach');
    var rowsB = classificationRows(summary, BLACK);
    eq(rowsB[0].left, 1, 'as Black, left is STILL your own count');
    eq(rowsB[0].right, 3, 'and right the coach — the same orientation as the accuracy above it');
    // The row order and the column order are the same object, which is the actual fix.
    eq(rowsB[0].left, columns(summary, BLACK)[0].classifications.best,
       'the rows and the columns read one ordering');

    var zeroed = classificationRows({
      whiteClassifications: { best: 0, blunder: 0 },
      blackClassifications: { best: 0, blunder: 0 },
      whiteAccuracy: 0, blackAccuracy: 0,
      displayOrder: ['best', 'blunder'],
    }, WHITE);
    eq(zeroed.length, 0, 'a class that is zero on both sides is not drawn');

    // --- the eval graph ---
    eq(graphPoints([], 100, 60).length, 0, 'no graph for an empty game');
    eq(graphPoints([{ eval_cp: 0 }], 100, 60).length, 0, 'nor for a single point');
    var pts = graphPoints([{ eval_cp: 0 }, { eval_cp: 500 }, { eval_cp: -500 }], 100, 60);
    eq(pts.length, 3, 'three points');
    eq(pts[0].x, 0, 'the first sits at x 0');
    eq(pts[2].x, 100, 'and the last at the full width');
    eq(pts[0].y, 30, 'an even position is the midline');
    eq(pts[1].y, 0, 'a +500 white advantage is the top');
    eq(pts[2].y, 60, 'and -500 the bottom');
    var clamped = graphPoints([{ eval_cp: 9000 }, { eval_cp: -9000 }], 100, 60);
    eq(clamped[0].cp, 500, 'a mate score clamps to +500');
    eq(clamped[1].cp, -500, 'and to -500');
    eq(graphPoints([{ eval_cp: null }, { eval_cp: 0 }], 100, 60)[0].cp, 0,
       'a missing eval reads as level rather than as NaN');

    // --- the hand-off (7 #28) ---
    eq(pgn(g), '1. e4 e5 2. Nf3', 'the PGN is movetext, numbered from 1');
    eq(handoff(g, null), null, 'no summary means no hand-off, rather than an empty one');
    eq(handoff(g, { moveEvaluations: null }), null, 'and neither does a summary without evaluations');
    var h = handoff(g, { moveEvaluations: [{ move_index: 1, classification: 'best' }] });
    expect(h !== null, 'a real summary hands off');
    eq(h.classifications.length, 1, 'carrying the classifications — the whole of 7 #28');
    eq(h.classifications[0].classification, 'best', 'with their values intact');
    eq(h.startFen, E.START_FEN, 'and the starting FEN');
    eq(h.pgn, '1. e4 e5 2. Nf3', 'and the movetext');
    eq(h.userColor, WHITE, 'and which side the user was');
    // The array is copied, so a later mutation of the summary cannot reach a hand-off already made.
    var src = [{ move_index: 1, classification: 'best' }];
    var h2 = handoff(g, { moveEvaluations: src });
    src.push({ move_index: 2, classification: 'blunder' });
    eq(h2.classifications.length, 1, 'the hand-off holds a copy, not a live reference');

    eq(REVIEW_DEPTH, 12, "spec 2.10's batch depth");
    eq(GRAPH_CLAMP_CP, MET.PLAY.graph.clampCp,
       'the clamp is the extracted CLAMP, not a second copy of 500');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-review: ' + passed + ' assertions passed'
        : 'coach-review: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    REVIEW_DEPTH: REVIEW_DEPTH, MIN_POSITIONS: MIN_POSITIONS, GRAPH_CLAMP_CP: GRAPH_CLAMP_CP,
    planFromGame: planFromGame, isReviewable: isReviewable,
    accuracyColor: accuracyColor, accuracyText: accuracyText,
    classColor: classColor, classLabel: classLabel,
    columns: columns, classificationRows: classificationRows,
    graphPoints: graphPoints, pgn: pgn, handoff: handoff, run: run,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachReview; }
