/* stockfish_bridge_twin.js — the JS twin of Engine/Sources/StockfishEngine/StockfishBridge.swift.
 *
 * Stockfish itself cannot be mirrored: it is 70k lines of C++ and a 71 MB network, and the browser
 * demo is a preview that opens from `file://`. What CAN be mirrored — and what actually carries the
 * risk — is every DECISION made about what Stockfish says: the side-to-move-to-White flip, the
 * mate-distance rounding, which of two reports for a rank wins, when an iteration counts as
 * finished, where a principal variation stops.
 *
 * That split is the whole reason the Swift is shaped the way it is. `biya_stockfish.cpp` marshals
 * and does not decide; this file and `StockfishBridge.swift` decide and do not marshal. Nothing on
 * this checkout can compile the first one, and `tools/qa/replay_stockfish.js` replays the second
 * against these vectors in both languages.
 *
 * ## Why this lives in tools/qa/ and not web-demo/js/
 *
 * Every other twin in this repository is ALSO the web demo's implementation — one file that the
 * browser runs and the gate replays. This one is not: the demo runs `LocalEngine`, because a 71 MB
 * network and a WASM engine cannot be carried by a preview that opens from `file://` with no
 * install step. A twin with no demo behind it is a test fixture, and `web_shell_check.js` §2 is
 * right to refuse it in `web-demo/js/` — a module nothing loads is exactly what that rule is for.
 * It still reuses `web-demo/js/engine.js` for legality and SAN, the same way the other QA tools do.
 */
(function (global) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports)
    ? require('../../web-demo/js/engine.js')
    : global.Engine;

  /* Kept equal to LocalEngine.pvExtendLimit by tools/qa/replay_stockfish.js. The panel is entitled
     to the same line length whichever engine produced it. */
  var PV_LIMIT = 14;

  /* -- Score ---------------------------------------------------------------------------------- */

  /* The one sign flip. UCI is side-to-move relative; EngineScore is always White-relative.
   *
   * `mate 0`: Stockfish rounds mate distance as (plies + 1) / 2 when winning and plies / 2 when
   * losing, truncating toward zero — so a side mated one ply from now reports 0, and a WINNING side
   * never can, because a positive plies of 0 would mean mate is already on the board and no search
   * would have run. A zero is therefore always the side to move being mated. */
  function whiteRelative(isMate, value, sideToMove) {
    var sign = sideToMove === E.WHITE ? 1 : -1;
    if (!isMate) return { kind: 'cp', value: value * sign };
    if (value === 0) return { kind: 'mate', value: -sign };
    return { kind: 'mate', value: value * sign };
  }

  /* -- Principal variation -------------------------------------------------------------------- */

  /* Walk a UCI PV, stopping at the first token that is not legal where it lands. E.parseUci already
     resolves against legalMoves(), which is the same test the Swift makes. */
  function parsePV(pv, position, limit) {
    var cap = (limit == null) ? PV_LIMIT : limit;
    var moves = [], san = [], cur = E.clone(position);
    var tokens = String(pv || '').split(' ');

    for (var i = 0; i < tokens.length; i++) {
      if (moves.length >= cap) break;
      if (!tokens[i]) continue;
      var m = E.parseUci(cur, tokens[i]);
      if (!m) break;
      san.push(E.san(cur, m));
      moves.push(m);
      cur = E.makeMove(cur, m);
    }
    return { moves: moves, san: san };
  }

  /* -- Accumulating one iteration ------------------------------------------------------------- */

  function isBound(line) { return !!(line.isLowerBound || line.isUpperBound); }

  /* An exact score is never replaced by a bound. Stockfish emits lowerbound/upperbound while an
     aspiration window is failing, and those numbers sit whole pawns from what the same depth
     settles on moments later; letting one overwrite a finished score makes the eval bar lurch on
     every re-search. */
  function merge(line, store) {
    var existing = store[line.multiPV];
    if (!existing) { store[line.multiPV] = line; return store; }
    if (!isBound(line) || isBound(existing)) store[line.multiPV] = line;
    return store;
  }

  /* Has this depth reported every line it owed? A search stopped mid-iteration leaves rank 1 a ply
     deeper than ranks 2 and 3 — a snapshot that never existed. */
  function isComplete(store, multiPV, legalMoves) {
    return Object.keys(store).length >= Math.min(multiPV, Math.max(legalMoves, 1));
  }

  function snapshot(position, depth, nodes, store, isFinal, terminal) {
    var ranks = Object.keys(store).map(Number).sort(function (a, b) { return a - b; });
    var lines = ranks.map(function (r) {
      var raw = store[r];
      var parsed = parsePV(raw.pv, position);
      return {
        rank: raw.multiPV - 1,
        score: whiteRelative(raw.isMate, raw.value, position.sideToMove),
        pv: parsed.moves,
        pvSAN: parsed.san,
        depth: raw.depth
      };
    });
    return {
      fen: E.toFEN(position), depth: depth, nodes: nodes,
      lines: lines, isFinal: !!isFinal, terminal: terminal || null
    };
  }

  /* -- Limits ---------------------------------------------------------------------------------- */

  function resolve(limits, movetimeMs) {
    return {
      depth: Math.min(Math.max(limits.maxDepth, 1), 245),
      multiPV: Math.min(Math.max(limits.multiPV, 1), 8),
      nodes: Math.max(limits.maxNodes || 0, 0),
      movetimeMs: Math.max(movetimeMs || 0, 0)
    };
  }

  /* -- Self-test -------------------------------------------------------------------------------- */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { if (cond) passed++; else failures.push(what); }

    var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    var BLACK_TO_MOVE = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    var start = E.fromFEN(START), black = E.fromFEN(BLACK_TO_MOVE);

    /* 1. The sign flip — the single most consequential line in this file. */
    expect(whiteRelative(false, 34, E.WHITE).value === 34, 'White to move: +34 stays +34');
    expect(whiteRelative(false, 34, E.BLACK).value === -34,
      'Black to move: +34 for Black is -34 for White');
    expect(whiteRelative(false, -120, E.BLACK).value === 120,
      'Black to move: -120 for Black is +120 for White');
    expect(whiteRelative(false, 0, E.BLACK).value === 0, 'a dead-level score has no sign to flip');

    /* 2. Mate scores flip too, and keep their magnitude. */
    expect(whiteRelative(true, 3, E.WHITE).kind === 'mate', 'a mate stays a mate');
    expect(whiteRelative(true, 3, E.WHITE).value === 3, 'White mates in 3');
    expect(whiteRelative(true, 3, E.BLACK).value === -3,
      'Black mating in 3 is -3 White-relative');
    expect(whiteRelative(true, -2, E.BLACK).value === 2,
      'Black being mated in 2 is +2 White-relative');

    /* 3. `mate 0` never produces a zero, which EngineScore documents as impossible. */
    expect(whiteRelative(true, 0, E.WHITE).value === -1,
      'mate 0 with White to move is White being mated');
    expect(whiteRelative(true, 0, E.BLACK).value === 1,
      'mate 0 with Black to move is Black being mated');
    expect(whiteRelative(true, 0, E.WHITE).value !== 0, 'a mate score is never zero');

    /* 4. PV parsing. */
    var pv = parsePV('e2e4 e7e5 g1f3', start);
    expect(pv.moves.length === 3, 'three plies parsed');
    expect(pv.san.join(' ') === 'e4 e5 Nf3', 'SAN is generated in the position each move reaches');

    /* 5. A PV stops at the first token that will not play, rather than guessing. */
    var bad = parsePV('e2e4 e7e5 e2e4', start);
    expect(bad.moves.length === 2, 'an illegal continuation truncates the line');
    expect(bad.san.join(' ') === 'e4 e5', 'and takes its SAN with it');
    expect(parsePV('', start).moves.length === 0, 'an empty PV is empty, not an error');
    expect(parsePV('not-a-move', start).moves.length === 0, 'garbage yields nothing');

    /* 6. The limit is a limit. */
    var long = parsePV('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c1g5 h7h6 g5f6 d8f6 b1c3 d7d6 '
      + 'e1g1 c8g4', start, PV_LIMIT);
    expect(long.moves.length === PV_LIMIT, 'a long PV is cut to exactly pvLimit');
    expect(long.san.length === long.moves.length, 'SAN and moves stay the same length');

    /* 7. Bounds never overwrite an exact score. This is the eval-bar-lurch guard. */
    var store = {};
    merge({ multiPV: 1, depth: 10, isMate: false, value: 30, pv: 'e2e4' }, store);
    merge({ multiPV: 1, depth: 10, isMate: false, value: -400, isLowerBound: true, pv: 'e2e4' }, store);
    expect(store[1].value === 30, 'a lowerbound does not displace a settled score');
    merge({ multiPV: 1, depth: 10, isMate: false, value: 45, pv: 'd2d4' }, store);
    expect(store[1].value === 45, 'but a later exact score does');

    /* 8. ...and a bound IS taken when it is all there is. */
    var boundOnly = {};
    merge({ multiPV: 1, depth: 9, isMate: false, value: -400, isUpperBound: true, pv: '' }, boundOnly);
    expect(boundOnly[1].value === -400, 'a bound is better than reporting nothing');
    merge({ multiPV: 1, depth: 9, isMate: false, value: -380, isUpperBound: true, pv: '' }, boundOnly);
    expect(boundOnly[1].value === -380, 'and a later bound replaces an earlier bound');

    /* 9. Completeness. */
    expect(isComplete({ 1: {}, 2: {}, 3: {} }, 3, 20), 'three of three ranks is complete');
    expect(!isComplete({ 1: {} }, 3, 20), 'one of three is not');
    expect(isComplete({ 1: {} }, 3, 1),
      'one line in a position with one legal move IS complete');
    expect(isComplete({ 1: {}, 2: {} }, 2, 0),
      'legalMoves 0 must not make completeness unreachable');

    /* 10. Snapshot assembly: rank is 0-based, ordering follows multipv. */
    var s = {};
    merge({ multiPV: 2, depth: 12, isMate: false, value: 10, pv: 'd2d4' }, s);
    merge({ multiPV: 1, depth: 12, isMate: false, value: 40, pv: 'e2e4 e7e5' }, s);
    var snap = snapshot(start, 12, 999, s, true);
    expect(snap.lines.length === 2, 'both lines survive');
    expect(snap.lines[0].rank === 0, 'multipv 1 becomes rank 0');
    expect(snap.lines[1].rank === 1, 'multipv 2 becomes rank 1');
    expect(snap.lines[0].pvSAN[0] === 'e4', 'rank 0 is the multipv-1 line, not whichever arrived first');
    expect(snap.lines[0].score.value === 40, 'and carries its own score');
    expect(snap.depth === 12 && snap.nodes === 999 && snap.isFinal === true, 'snapshot header');

    /* 11. The flip is applied through the snapshot, using the position's side to move. */
    var bs = {};
    merge({ multiPV: 1, depth: 8, isMate: false, value: 55, pv: 'e5e4' }, bs);
    var bsnap = snapshot(black, 8, 1, bs, true);
    expect(bsnap.lines[0].score.value === -55,
      'a snapshot taken with Black to move reports White-relative');

    /* 12. Limits. */
    var r = resolve({ maxDepth: 300, maxNodes: 0, multiPV: 99 }, 1200);
    expect(r.depth === 245, 'depth is clamped to MAX_PLY - 1');
    expect(r.multiPV === 8, 'multiPV is clamped to the same 8 the C layer clamps to');
    expect(r.movetimeMs === 1200, 'the deadline is passed through as movetime');
    expect(resolve({ maxDepth: 0, maxNodes: -5, multiPV: 0 }, null).depth === 1,
      'a zero depth becomes 1, never an unbounded search');
    expect(resolve({ maxDepth: 4, maxNodes: -5, multiPV: 1 }, null).nodes === 0,
      'a negative node budget becomes none');
    expect(resolve({ maxDepth: 4, maxNodes: 0, multiPV: 1 }, null).movetimeMs === 0,
      'no deadline is no movetime');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'StockfishBridge: ' + passed + ' assertions OK'
        : 'StockfishBridge: ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  var API = {
    PV_LIMIT: PV_LIMIT,
    whiteRelative: whiteRelative,
    parsePV: parsePV,
    merge: merge,
    isBound: isBound,
    isComplete: isComplete,
    snapshot: snapshot,
    resolve: resolve,
    selfTest: selfTest
  };

  global.StockfishBridge = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
