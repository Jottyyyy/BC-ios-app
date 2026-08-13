/* analysis-eval.js — the evaluation the ANALYSIS engine uses, and its Zobrist keys
 *
 *     node -e "console.log(require('./web-demo/js/analysis-eval.js').selfTest().summary)"
 *
 * Mirror of Sources/BiyaherongCoachCore/AnalysisEval.swift. Written here first and proven in Node,
 * then transliterated — `swift` is not on PATH on the Windows checkout.
 *
 * ── Why this is not `CoachAI.evaluate` ───────────────────────────────────────
 * `CoachAI.evaluate` is material + one piece-square table and nothing else, and it is **parity-
 * pinned**: the five coach personas are golden-tested against it, so changing it would change how
 * every coach plays. It stays exactly as it is. The analysis engine gets this instead, and the two
 * live side by side for the same reason `CoachEngine` sits beside `ChessAI`.
 *
 * What the old one could not see, and this one can:
 *
 *   - **Game phase.** One king table for the whole game means the king is pushed into the corner in
 *     a K+P endgame, where its job is to march up the board. Everything here is scored twice —
 *     midgame and endgame — and interpolated on the material left. This is the single biggest fix.
 *   - **Pawn structure** — doubled, isolated, and passed pawns, the last weighted far higher in the
 *     endgame, where a passed pawn is often the whole position.
 *   - **King safety** — the pawn shield in front of the king, open files beside it, and an enemy
 *     queen bearing down on it. Midgame only, by construction: the taper takes it to zero.
 *   - **Mobility** — how many squares each piece actually reaches. A knight on the rim is bad
 *     because it has four moves, not because a table says so.
 *   - **Bishop pair**, **rooks on open files**, and a **tempo** bonus.
 *
 * ── The scale is deliberately unchanged ──────────────────────────────────────
 * A pawn is still 100 centipawns and the sign is still side-to-move relative, so the eval bar, the
 * engine panel, `GameReview.classifyMove`'s thresholds and the review annotator all keep working
 * with no change at all. This file makes the number *better*, never differently-scaled.
 *
 * ── Zobrist ──────────────────────────────────────────────────────────────────
 * The transposition table needs a position key. `Engine.positionKey` is a FEN string — building one
 * per node would cost more than it saves — so a Zobrist hash lives here, beside the only other
 * whole-board walk. It is generated from a SEEDED PRNG, so the table is fixed and the search stays
 * deterministic. JavaScript bitwise operators are 32-bit, so a key is a PAIR of 32-bit halves; the
 * search uses the low half as its map key and the high half as verification.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysisEval = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var AI = isNode ? require('./ai.js') : CoachAI;

  // ---- Material -------------------------------------------------------------
  // Midgame values are `CoachAI.MATERIAL` itself, not a copy of it. The endgame set raises pawns
  // (a passed pawn wins games) and rooks, the two pieces that gain most as the board empties.
  var MAT_MG = AI.MATERIAL;
  var MAT_EG = [120, 320, 340, 530, 940, 0];

  // ---- Piece-square tables --------------------------------------------------
  // Midgame IS `CoachAI.PST`, shared by reference so the two files cannot drift.
  var PST_MG = AI.PST;

  // Endgame tables, written a1-first to match `CoachAI.PST`'s orientation (index 0 = a1, each row
  // is one rank going up). Only the king and the pawn get their own: they are the two pieces whose
  // correct square genuinely inverts between the phases. The other four reuse the midgame table,
  // and the mobility and passed-pawn terms carry the rest of the endgame knowledge.
  var KING_EG = [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -50, -40, -30, -20, -20, -30, -40, -50
  ];
  var PAWN_EG = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 5, 5, 5, 5, 5, 5, 5,
    10, 10, 10, 10, 10, 10, 10, 10,
    20, 20, 20, 20, 20, 20, 20, 20,
    35, 35, 35, 35, 35, 35, 35, 35,
    60, 60, 60, 60, 60, 60, 60, 60,
    100, 100, 100, 100, 100, 100, 100, 100,
    0, 0, 0, 0, 0, 0, 0, 0
  ];
  var PST_EG = {};
  PST_EG[E.PAWN] = PAWN_EG;
  PST_EG[E.KNIGHT] = PST_MG[E.KNIGHT];
  PST_EG[E.BISHOP] = PST_MG[E.BISHOP];
  PST_EG[E.ROOK] = PST_MG[E.ROOK];
  PST_EG[E.QUEEN] = PST_MG[E.QUEEN];
  PST_EG[E.KING] = KING_EG;

  // ---- Phase ----------------------------------------------------------------
  // The classic 24-point scale: every knight and bishop is 1, every rook 2, every queen 4. A full
  // board is 24 (pure midgame), a bare K+P endgame is 0. Capped, because promotions can exceed it.
  var PHASE_WEIGHT = [0, 1, 1, 2, 4, 0];
  var PHASE_MAX = 24;

  // ---- Term weights ---------------------------------------------------------
  var DOUBLED_MG = -12, DOUBLED_EG = -24;
  var ISOLATED_MG = -14, ISOLATED_EG = -18;
  /** Indexed by the pawn's rank RELATIVE to its own side (0 = home rank, 6 = about to promote). */
  var PASSED_MG = [0, 5, 10, 20, 35, 60, 100, 0];
  var PASSED_EG = [0, 10, 20, 35, 60, 100, 150, 0];
  var BISHOP_PAIR_MG = 30, BISHOP_PAIR_EG = 45;
  var ROOK_OPEN_MG = 20, ROOK_OPEN_EG = 10;
  var ROOK_SEMI_MG = 10, ROOK_SEMI_EG = 5;
  var MOBILITY_MG = [0, 4, 5, 2, 1, 0];
  var MOBILITY_EG = [0, 4, 5, 4, 2, 0];
  var TEMPO = 12;
  // King safety is midgame-only by construction (the taper zeroes it), but it is also the most
  // expensive term, so it is skipped outright once too little material is left for it to matter.
  var KING_SAFETY_MIN_PHASE = 6;
  var SHIELD_MISSING = -25, SHIELD_FAR = -18, SHIELD_NEAR = -10;
  var KING_OPEN_FILE = -15;
  var QUEEN_PROXIMITY = -4;

  // ---- Direction tables -----------------------------------------------------
  // Local copies, because `engine.js` does not export its own. `selfTest` proves each one against
  // `Engine.pseudoLegalMoves` for a lone piece on an empty board, so "local copy" cannot become
  // "quietly different copy".
  var KNIGHT_OFF = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var BISHOP_DIR = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ROOK_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var QUEEN_DIR = BISHOP_DIR.concat(ROOK_DIR);

  /**
   * How many squares this piece reaches — empty squares plus the first enemy piece on each ray.
   *
   * Deliberately NOT `Engine.pseudoLegalMoves(pos).filter(...)`: that allocates a `Move` object per
   * destination and this runs at every leaf of the search. Counting into an integer is the whole
   * point.
   */
  function mobilityCount(pos, sq, kind, color) {
    var f = E.sqFile(sq), r = E.sqRank(sq), n = 0, i, d, nf, nr, t, occ;
    if (kind === E.KNIGHT || kind === E.KING) {
      var offs = kind === E.KNIGHT ? KNIGHT_OFF : KING_OFF;
      for (i = 0; i < offs.length; i++) {
        nf = f + offs[i][0]; nr = r + offs[i][1];
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        occ = pos.squares[E.sqMake(nf, nr)];
        if (!occ || occ.color !== color) n++;
      }
      return n;
    }
    var dirs = kind === E.BISHOP ? BISHOP_DIR : (kind === E.ROOK ? ROOK_DIR : QUEEN_DIR);
    for (i = 0; i < dirs.length; i++) {
      d = dirs[i]; nf = f + d[0]; nr = r + d[1];
      while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
        t = E.sqMake(nf, nr);
        occ = pos.squares[t];
        if (occ) { if (occ.color !== color) n++; break; }
        n++;
        nf += d[0]; nr += d[1];
      }
    }
    return n;
  }

  /** Chebyshev (king-move) distance — the natural metric for "how close is that queen". */
  function kingDistance(a, b) {
    return Math.max(Math.abs(E.sqFile(a) - E.sqFile(b)), Math.abs(E.sqRank(a) - E.sqRank(b)));
  }

  /**
   * Static evaluation, in centipawns, **from the side to move's point of view** — the same sign
   * convention as `CoachAI.evaluate`, because negamax depends on it and the single flip to
   * White-relative happens once, at the search root.
   */
  function evaluate(pos) {
    var mg = 0, eg = 0, phase = 0;
    var sq, p, i, f, r, rel;

    // One pass to collect what the structural terms need. Two 8-entry pawn maps per colour: how
    // many pawns on each file, and the most advanced one, which is all the passed-pawn test needs.
    var pawnsOnFile = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
    var pawnList = [[], []];
    var bishops = [0, 0];
    var kingSq = [-1, -1];
    var queenSq = [-1, -1];

    for (sq = 0; sq < 64; sq++) {
      p = pos.squares[sq];
      if (!p) continue;
      var c = p.color, k = p.kind;
      var idx = c === E.WHITE ? sq : (sq ^ 56);          // black mirrors vertically
      var vMg = MAT_MG[k] + PST_MG[k][idx];
      var vEg = MAT_EG[k] + PST_EG[k][idx];
      if (c === E.WHITE) { mg += vMg; eg += vEg; } else { mg -= vMg; eg -= vEg; }
      phase += PHASE_WEIGHT[k];

      if (k === E.PAWN) { pawnsOnFile[c][E.sqFile(sq)]++; pawnList[c].push(sq); }
      else if (k === E.BISHOP) bishops[c]++;
      else if (k === E.KING) kingSq[c] = sq;
      else if (k === E.QUEEN) queenSq[c] = sq;

      // Mobility. Pawns are excluded: their value is structure, not square count.
      if (k !== E.PAWN) {
        var mob = mobilityCount(pos, sq, k, c);
        if (c === E.WHITE) { mg += mob * MOBILITY_MG[k]; eg += mob * MOBILITY_EG[k]; }
        else { mg -= mob * MOBILITY_MG[k]; eg -= mob * MOBILITY_EG[k]; }
      }

      // Rooks like files without pawns on them.
      if (k === E.ROOK) {
        f = E.sqFile(sq);
        var own = pawnsOnFileLater(pos, f, c), foe = pawnsOnFileLater(pos, f, c === E.WHITE ? E.BLACK : E.WHITE);
        var oMg = 0, oEg = 0;
        if (own === 0 && foe === 0) { oMg = ROOK_OPEN_MG; oEg = ROOK_OPEN_EG; }
        else if (own === 0) { oMg = ROOK_SEMI_MG; oEg = ROOK_SEMI_EG; }
        if (c === E.WHITE) { mg += oMg; eg += oEg; } else { mg -= oMg; eg -= oEg; }
      }
    }

    if (phase > PHASE_MAX) phase = PHASE_MAX;

    // Bishop pair.
    if (bishops[E.WHITE] >= 2) { mg += BISHOP_PAIR_MG; eg += BISHOP_PAIR_EG; }
    if (bishops[E.BLACK] >= 2) { mg -= BISHOP_PAIR_MG; eg -= BISHOP_PAIR_EG; }

    // Pawn structure, per colour.
    for (var ci = 0; ci < 2; ci++) {
      var sign = ci === E.WHITE ? 1 : -1;
      var mine = pawnsOnFile[ci], theirs = pawnsOnFile[ci === E.WHITE ? E.BLACK : E.WHITE];
      for (f = 0; f < 8; f++) {
        if (mine[f] > 1) { mg += sign * DOUBLED_MG * (mine[f] - 1); eg += sign * DOUBLED_EG * (mine[f] - 1); }
        if (mine[f] > 0 && (f === 0 || mine[f - 1] === 0) && (f === 7 || mine[f + 1] === 0)) {
          mg += sign * ISOLATED_MG * mine[f];
          eg += sign * ISOLATED_EG * mine[f];
        }
      }
      for (i = 0; i < pawnList[ci].length; i++) {
        sq = pawnList[ci][i];
        f = E.sqFile(sq); r = E.sqRank(sq);
        rel = ci === E.WHITE ? r : 7 - r;                 // rank from this pawn's own side
        if (isPassed(pos, sq, ci)) {
          mg += sign * PASSED_MG[rel];
          eg += sign * PASSED_EG[rel];
        }
      }
      // King safety — midgame only, and only while there is enough left to attack with.
      if (phase >= KING_SAFETY_MIN_PHASE && kingSq[ci] >= 0) {
        mg += sign * kingSafety(pos, kingSq[ci], ci, mine, theirs,
                                queenSq[ci === E.WHITE ? E.BLACK : E.WHITE]);
      }
    }

    // Taper: a full board is all midgame, a bare endgame all endgame.
    var score = Math.round((mg * phase + eg * (PHASE_MAX - phase)) / PHASE_MAX);
    var stm = pos.sideToMove === E.WHITE ? score : -score;
    return stm + TEMPO;
  }

  /** Pawns of `color` on file `f`. Small enough to recount; called only for rooks. */
  function pawnsOnFileLater(pos, f, color) {
    var n = 0;
    for (var r = 0; r < 8; r++) {
      var p = pos.squares[E.sqMake(f, r)];
      if (p && p.kind === E.PAWN && p.color === color) n++;
    }
    return n;
  }

  /** No enemy pawn on this file or either neighbour, anywhere ahead of it. */
  function isPassed(pos, sq, color) {
    var f = E.sqFile(sq), r = E.sqRank(sq);
    var foe = color === E.WHITE ? E.BLACK : E.WHITE;
    var lo = f > 0 ? f - 1 : 0, hi = f < 7 ? f + 1 : 7;
    for (var ff = lo; ff <= hi; ff++) {
      if (color === E.WHITE) {
        for (var r1 = r + 1; r1 <= 7; r1++) {
          var a = pos.squares[E.sqMake(ff, r1)];
          if (a && a.kind === E.PAWN && a.color === foe) return false;
        }
      } else {
        for (var r2 = r - 1; r2 >= 0; r2--) {
          var b = pos.squares[E.sqMake(ff, r2)];
          if (b && b.kind === E.PAWN && b.color === foe) return false;
        }
      }
    }
    return true;
  }

  /**
   * Midgame king safety: the pawns in front of it, the files beside it, and the enemy queen.
   *
   * Deliberately NOT an attack-map count. Asking `Engine.isAttacked` for the nine squares around
   * each king is eighteen ray-scans per leaf, which measurably outweighed what it bought; these
   * three terms are file arithmetic and one distance, and they catch the same castled-king-stripped-
   * of-its-pawns pattern that actually decides games.
   */
  function kingSafety(pos, ksq, color, myPawnFiles, foePawnFiles, foeQueenSq) {
    var f = E.sqFile(ksq), r = E.sqRank(ksq), s = 0;
    var lo = f > 0 ? f - 1 : 0, hi = f < 7 ? f + 1 : 7;
    for (var ff = lo; ff <= hi; ff++) {
      // The nearest friendly pawn ahead of the king on this file.
      var dist = -1;
      for (var step = 1; step <= 7; step++) {
        var rr = color === E.WHITE ? r + step : r - step;
        if (rr < 0 || rr > 7) break;
        var p = pos.squares[E.sqMake(ff, rr)];
        if (p && p.kind === E.PAWN && p.color === color) { dist = step; break; }
      }
      if (dist < 0) s += SHIELD_MISSING;
      else if (dist === 2) s += SHIELD_NEAR;
      else if (dist > 2) s += SHIELD_FAR;
      // A file with no pawn of either colour is a highway to the king.
      if (myPawnFiles[ff] === 0 && foePawnFiles[ff] === 0) s += KING_OPEN_FILE;
    }
    if (foeQueenSq >= 0) s += QUEEN_PROXIMITY * (7 - kingDistance(foeQueenSq, ksq));
    return s;
  }

  // ---- Zobrist --------------------------------------------------------------
  // Seeded, so the table is fixed and the search stays deterministic run to run. Two 32-bit halves
  // per entry because JavaScript bitwise operators truncate to 32 bits.
  var ZOBRIST_SEED = 0x9E3779B9;

  function buildZobrist() {
    var rng = AI.mulberry32(ZOBRIST_SEED);
    function word() { return (rng() * 0x100000000) >>> 0; }
    var n = 2 * 6 * 64;
    var z = {
      pieceLo: new Int32Array(n), pieceHi: new Int32Array(n),
      castleLo: new Int32Array(4), castleHi: new Int32Array(4),
      epLo: new Int32Array(8), epHi: new Int32Array(8),
      sideLo: 0, sideHi: 0
    };
    for (var i = 0; i < n; i++) { z.pieceLo[i] = word() | 0; z.pieceHi[i] = word() | 0; }
    for (var c = 0; c < 4; c++) { z.castleLo[c] = word() | 0; z.castleHi[c] = word() | 0; }
    for (var e = 0; e < 8; e++) { z.epLo[e] = word() | 0; z.epHi[e] = word() | 0; }
    z.sideLo = word() | 0; z.sideHi = word() | 0;
    return z;
  }
  var ZOB = buildZobrist();

  function pieceIndex(color, kind, sq) { return ((color * 6) + kind) * 64 + sq; }

  /**
   * Write the position's key into `out` as `[lo, hi]`.
   *
   * Takes a caller-owned scratch array rather than returning an object: this is called once per
   * interior node, and allocating a pair there would hand the garbage collector the search's whole
   * node count. Only interior nodes hash — never quiescence, where the leaves are.
   */
  function hash(pos, out) {
    var lo = 0, hi = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = pos.squares[sq];
      if (!p) continue;
      var i = pieceIndex(p.color, p.kind, sq);
      lo ^= ZOB.pieceLo[i]; hi ^= ZOB.pieceHi[i];
    }
    if (pos.castleWK) { lo ^= ZOB.castleLo[0]; hi ^= ZOB.castleHi[0]; }
    if (pos.castleWQ) { lo ^= ZOB.castleLo[1]; hi ^= ZOB.castleHi[1]; }
    if (pos.castleBK) { lo ^= ZOB.castleLo[2]; hi ^= ZOB.castleHi[2]; }
    if (pos.castleBQ) { lo ^= ZOB.castleLo[3]; hi ^= ZOB.castleHi[3]; }
    // Only the FILE, and only when the square is set — matching `Engine.positionKey`'s rule that a
    // dead en-passant square must not split a transposition.
    if (pos.enPassant != null) {
      var f = E.sqFile(pos.enPassant);
      lo ^= ZOB.epLo[f]; hi ^= ZOB.epHi[f];
    }
    if (pos.sideToMove === E.BLACK) { lo ^= ZOB.sideLo; hi ^= ZOB.sideHi; }
    out[0] = lo; out[1] = hi;
  }

  /** Non-zero material other than pawns — the null-move pruning zugzwang guard. */
  function hasNonPawnMaterial(pos, color) {
    for (var sq = 0; sq < 64; sq++) {
      var p = pos.squares[sq];
      if (p && p.color === color && p.kind !== E.PAWN && p.kind !== E.KING) return true;
    }
    return false;
  }

  /** 0 (bare endgame) to 24 (full board). Exposed for the search's pruning decisions. */
  function phaseOf(pos) {
    var n = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = pos.squares[sq];
      if (p) n += PHASE_WEIGHT[p.kind];
    }
    return n > PHASE_MAX ? PHASE_MAX : n;
  }

  // ---- Self-test ------------------------------------------------------------

  /** Mirror a position: flip the board vertically and swap every colour, side to move included. */
  function mirrorFEN(fen) {
    var parts = fen.split(/\s+/);
    var rows = parts[0].split('/').reverse().map(function (row) {
      return row.replace(/[a-zA-Z]/g, function (ch) {
        return ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      });
    });
    var stm = parts[1] === 'w' ? 'b' : 'w';
    var castle = (parts[2] || '-').replace(/[a-zA-Z]/g, function (ch) {
      return ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    });
    if (castle !== '-') castle = castle.split('').sort().reverse().join('');
    var ep = (parts[3] || '-');
    if (ep !== '-') ep = ep[0] + String(9 - parseInt(ep[1], 10));
    return [rows.join('/'), stm, castle, ep, parts[4] || '0', parts[5] || '1'].join(' ');
  }

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function P(f) { var p = E.fromFEN(f); if (!p) failures.push('bad fen ' + f); return p; }

    // 1. The direction tables are the engine's, not merely similar to them. A lone piece on an
    //    otherwise empty board must reach exactly the squares `mobilityCount` claims.
    var loneKinds = [[E.KNIGHT, 'N'], [E.BISHOP, 'B'], [E.ROOK, 'R'], [E.QUEEN, 'Q']];
    var loneSquares = ['a1', 'd4', 'h5', 'e8', 'b7'];
    for (var lk = 0; lk < loneKinds.length; lk++) {
      for (var ls = 0; ls < loneSquares.length; ls++) {
        var at = loneSquares[ls];
        var fen = placeLone(loneKinds[lk][1], at);
        var lp = E.fromFEN(fen);
        if (!lp) { failures.push('bad lone fen ' + fen); continue; }
        var sq = E.sqIndex(at);
        var real = E.pseudoLegalMoves(lp).filter(function (m) { return m.from === sq; }).length;
        var mine = mobilityCount(lp, sq, loneKinds[lk][0], E.WHITE);
        expect(real === mine,
          'mobility of a lone ' + loneKinds[lk][1] + ' on ' + at + ': engine says ' + real
          + ', mobilityCount says ' + mine);
      }
    }

    // 2. Symmetry. The mirrored position must evaluate to the SAME number for the side to move —
    //    the single strongest check an evaluation can have, and the one that catches a sign or an
    //    orientation flipped in exactly one term.
    var symmetric = [
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R w KQkq - 0 7',
      '8/5k2/8/8/3P4/8/5K2/8 w - - 0 1',
      'r2q1rk1/pp2ppbp/2n2np1/2Q5/3PP3/2N2N2/PP3PPP/R1B1KB1R w KQ - 0 10',
      '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
      '4k3/8/8/2Pp4/8/8/8/4K3 w - d6 0 2'
    ];
    for (var si = 0; si < symmetric.length; si++) {
      var a = P(symmetric[si]);
      var bFen = mirrorFEN(symmetric[si]);
      var b = E.fromFEN(bFen);
      if (!a || !b) { failures.push('mirror produced an unparseable FEN: ' + bFen); continue; }
      expect(evaluate(a) === evaluate(b),
        'mirror symmetry for ' + symmetric[si] + ': ' + evaluate(a) + ' vs ' + evaluate(b)
        + ' (mirror ' + bFen + ')');
    }

    // 3. The start position is level apart from the tempo bonus.
    expect(evaluate(P(E.START_FEN)) === TEMPO,
      'the start position is exactly the tempo bonus, got ' + evaluate(P(E.START_FEN)));

    // 4. Material still dominates, and the sign is still side-to-move relative.
    var upQueen = P('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    var upQueenB = P('4k3/8/8/8/8/8/8/3QK3 b - - 0 1');
    expect(evaluate(upQueen) > 500, 'White up a queen, White to move: strongly positive');
    expect(evaluate(upQueenB) < -500, 'the same board with Black to move: strongly negative');

    // 5. The endgame king. THE bug this file exists to fix: with one table for the whole game the
    //    king is rewarded for hiding in the corner even when the board is bare.
    var centralKing = P('8/8/8/3K4/8/8/8/7k w - - 0 1');
    var cornerKing = P('K7/8/8/8/8/8/8/7k w - - 0 1');
    expect(evaluate(centralKing) > evaluate(cornerKing),
      'a centralised king beats a cornered one in the endgame ('
      + evaluate(centralKing) + ' vs ' + evaluate(cornerKing) + ')');
    // …and the opposite is still true with a full board.
    var castled = P('rnbq1rk1/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1RK1 w - - 0 1');
    var exposed = P('rnbq1rk1/pppppppp/8/8/8/8/PPPPPPPP/RNBQK2R w KQ - 0 1');
    expect(evaluate(castled) > evaluate(exposed),
      'in the midgame the tucked-away king is still better ('
      + evaluate(castled) + ' vs ' + evaluate(exposed) + ')');

    // 6. Phase.
    expect(phaseOf(P(E.START_FEN)) === PHASE_MAX, 'a full board is phase 24');
    expect(phaseOf(P('8/5k2/8/8/3P4/8/5K2/8 w - - 0 1')) === 0, 'K+P vs K is phase 0');
    expect(phaseOf(P('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')) === 4, 'a lone queen is phase 4');

    // 7. Pawn structure: each term in isolation, against the same position without it.
    var doubled = P('4k3/8/8/8/8/3P4/3P4/4K3 w - - 0 1');
    var spread = P('4k3/8/8/8/8/3P4/2P5/4K3 w - - 0 1');
    expect(evaluate(doubled) < evaluate(spread), 'doubled pawns score worse than spread ones');
    var isolated = P('4k3/8/8/8/8/8/3P4/4K3 w - - 0 1');
    var supported = P('4k3/8/8/8/8/8/2PP4/4K3 w - - 0 1');
    expect(evaluate(supported) - evaluate(isolated) > MAT_EG[E.PAWN],
      'a second, connected pawn is worth more than its bare material');
    var passer = P('4k3/8/3P4/8/8/8/8/4K3 w - - 0 1');
    var blocked = P('4k3/2p1p3/3P4/8/8/8/8/4K3 w - - 0 1');
    expect(evaluate(passer) > evaluate(blocked) + MAT_EG[E.PAWN],
      'a passed pawn beats one held by two enemy pawns by more than a pawn');

    // 8. King safety: pushing the shield off a castled king must cost something.
    //
    // The position has to be a real MIDGAME — phase 24, both sides castled, identical material —
    // or the test measures the wrong thing. The first attempt used a queen-and-pawns endgame, where
    // phase is 4, the taper has already switched king safety almost entirely off, and the advanced
    // pawns are correctly scored as *good*. That was the evaluation being right and the test being
    // wrong; it is recorded here so nobody re-derives it.
    var shielded = P('r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1');
    var airy = P('r1bq1rk1/pppp1p1p/2n2n2/2b1p1p1/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1');
    expect(evaluate(shielded) < evaluate(airy),
      'pushing Black\'s g-pawn to g5 leaves its king worse off ('
      + evaluate(shielded) + ' vs ' + evaluate(airy) + ')');

    // 9. Bishop pair.
    var pair = P('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1');
    var knights = P('4k3/8/8/8/8/8/8/2N1KN2 w - - 0 1');
    expect(evaluate(pair) - evaluate(knights) > 2 * (MAT_MG[E.BISHOP] - MAT_MG[E.KNIGHT]),
      'two bishops beat two knights by more than their material difference');

    // 10. Zobrist.
    var out = [0, 0], out2 = [0, 0];
    hash(P(E.START_FEN), out);
    hash(P(E.START_FEN), out2);
    expect(out[0] === out2[0] && out[1] === out2[1], 'the same position hashes the same way');
    expect(out[0] !== 0 || out[1] !== 0, 'the start position does not hash to zero');
    hash(P('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'), out2);
    expect(out[0] !== out2[0] || out[1] !== out2[1], 'the side to move is part of the key');
    hash(P('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1'), out2);
    expect(out[0] !== out2[0] || out[1] !== out2[1], 'castling rights are part of the key');
    // Transpositions must collapse — the same reason `Engine.positionKey` clears a dead ep square.
    var t1 = P(E.START_FEN);
    t1 = E.makeMove(t1, E.parseUci(t1, 'g1f3'));
    t1 = E.makeMove(t1, E.parseUci(t1, 'g8f6'));
    t1 = E.makeMove(t1, E.parseUci(t1, 'b1c3'));
    var t2 = P(E.START_FEN);
    t2 = E.makeMove(t2, E.parseUci(t2, 'b1c3'));
    t2 = E.makeMove(t2, E.parseUci(t2, 'g8f6'));
    t2 = E.makeMove(t2, E.parseUci(t2, 'g1f3'));
    hash(t1, out); hash(t2, out2);
    expect(out[0] === out2[0] && out[1] === out2[1], 'a transposition reaches the same key');
    // Distinctness across a broad sample — a table generated wrong would collide immediately.
    var seen = {}, collisions = 0, pos = P(E.START_FEN), moves;
    for (var d = 0; d < 400; d++) {
      hash(pos, out);
      var key = out[0] + ':' + out[1];
      var fen4 = E.positionKey(pos);
      if (seen[key] !== undefined && seen[key] !== fen4) collisions++;
      seen[key] = fen4;
      moves = E.legalMoves(pos);
      if (!moves.length) break;
      pos = E.makeMove(pos, moves[d % moves.length]);
    }
    expect(collisions === 0, 'no key collided over 400 distinct positions, got ' + collisions);

    // 11. The zugzwang guard.
    expect(hasNonPawnMaterial(P(E.START_FEN), E.WHITE) === true, 'the start position has pieces');
    expect(hasNonPawnMaterial(P('8/5k2/8/8/3P4/8/5K2/8 w - - 0 1'), E.WHITE) === false,
      'K+P has no non-pawn material — null move must be forbidden there');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisEvalSelfTest: ' + passed + ' assertions passed'
        : 'AnalysisEvalSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  /** A FEN with just the two kings and one white piece of `letter` on `at`. */
  function placeLone(letter, at) {
    var board = new Array(64).fill(null);
    var sq = E.sqIndex(at);
    var kw = E.sqIndex(at) === E.sqIndex('a1') ? E.sqIndex('c1') : E.sqIndex('a1');
    var kb = E.sqIndex(at) === E.sqIndex('h8') ? E.sqIndex('f8') : E.sqIndex('h8');
    board[sq] = letter; board[kw] = 'K'; board[kb] = 'k';
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var row = '', gap = 0;
      for (var f = 0; f < 8; f++) {
        var v = board[E.sqMake(f, r)];
        if (v) { if (gap) { row += gap; gap = 0; } row += v; } else gap++;
      }
      if (gap) row += gap;
      rows.push(row);
    }
    return rows.join('/') + ' w - - 0 1';
  }

  return {
    MAT_MG: MAT_MG, MAT_EG: MAT_EG, PST_MG: PST_MG, PST_EG: PST_EG,
    PHASE_MAX: PHASE_MAX, TEMPO: TEMPO,
    evaluate: evaluate, phaseOf: phaseOf, hasNonPawnMaterial: hasNonPawnMaterial,
    mobilityCount: mobilityCount, hash: hash, mirrorFEN: mirrorFEN,
    selfTest: selfTest
  };
})();

/* Makes the evaluation requireable headlessly under Node without changing browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaAnalysisEval; }
