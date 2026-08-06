/* =============================================================================
 * ai.js — Coach AI + persona definitions
 * Faithful port of Sources/BiyaherongCoachCore/ChessAI.swift
 *
 * negamax + alpha-beta + material/piece-square evaluation. Strength per coach
 * is shaped by 3 knobs only: search `depth`, `blunderChance` (chance to play a
 * random legal move), and `randomness` (± centipawn noise on root scores).
 *
 * Exposes window.Coaches (the 5 personas) and window.CoachAI (the engine).
 * Depends on window.Engine. Classic <script>, no modules.
 *
 * ⇢ To retune a coach, edit COACHES below (depth / blunderChance / randomness).
 * ========================================================================== */
(function (global) {
  'use strict';
  var E = global.Engine;

  var MATE = 1000000;
  var WIN = 1000000000; // search window bound; comfortably wider than MATE

  // --- The 5 coach personas (verbatim from Coaches.all, weakest → strongest) ---
  var COACHES = [
    { id: 'jaden', name: 'Jaden Pogi', blurb: 'Learning the ropes — plays fast and loose.', title: 'Beginner', favoriteOpening: 'Italian Game', rating: 650, depth: 1, blunderChance: 0.35, randomness: 90 },
    { id: 'jade', name: 'Pretty Jade', blurb: 'Tidy club player who keeps the position clean.', title: 'Casual', favoriteOpening: 'Scandinavian Defense', rating: 1150, depth: 2, blunderChance: 0.16, randomness: 55 },
    { id: 'jude', name: 'Handsome Jude', blurb: 'Sharp tactician — always hunting a combination.', title: 'Club', favoriteOpening: 'Sicilian Najdorf', rating: 1550, depth: 2, blunderChance: 0.06, randomness: 30 },
    { id: 'julie', name: 'Mommy Julie', blurb: 'Patient and positional. Squeezes you slowly.', title: 'Expert', favoriteOpening: "Queen's Gambit", rating: 1850, depth: 3, blunderChance: 0.03, randomness: 15 },
    { id: 'pogi', name: 'Coach Pogi', blurb: 'Master strength. Punishes every mistake.', title: 'Master', favoriteOpening: 'Ruy López', rating: 2250, depth: 3, blunderChance: 0.0, randomness: 0 }
  ];
  var RATING_FLOOR = 500;   // for strength-bar scaling
  var RATING_CEILING = 2400;

  // --- Material (centipawns) -------------------------------------------------
  var MATERIAL = [100, 320, 330, 500, 900, 0]; // pawn,knight,bishop,rook,queen,king
  function material(kind) { return MATERIAL[kind]; }

  // --- Piece-square tables (verbatim; white's perspective, a1 = index 0) -----
  var PST = {};
  PST[E.PAWN] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0
  ];
  PST[E.KNIGHT] = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
  ];
  PST[E.BISHOP] = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
  ];
  PST[E.ROOK] = [
    0, 0, 0, 5, 5, 0, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0
  ];
  PST[E.QUEEN] = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -10, 5, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20
  ];
  PST[E.KING] = [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30
  ];

  // Static evaluation from the side-to-move's perspective (centipawns).
  function evaluate(pos) {
    var score = 0;
    for (var s = 0; s < 64; s++) {
      var p = pos.squares[s];
      if (!p) continue;
      var idx = p.color === E.WHITE ? s : (s ^ 56); // black mirrors vertically
      var v = MATERIAL[p.kind] + PST[p.kind][idx];
      score += p.color === E.WHITE ? v : -v;
    }
    return pos.sideToMove === E.WHITE ? score : -score;
  }

  // MVV-LVA-ish capture ordering; non-captures score -1 and keep input order.
  function captureScore(pos, m) {
    var victim = pos.squares[m.to];
    if (!victim) return -1;
    var attacker = pos.squares[m.from];
    return MATERIAL[victim.kind] * 10 - MATERIAL[attacker.kind];
  }
  function ordered(moves, pos) {
    var arr = moves.map(function (m, i) { return { m: m, i: i, k: captureScore(pos, m) }; });
    arr.sort(function (a, b) { return a.k !== b.k ? b.k - a.k : a.i - b.i; }); // stable index tie-break
    return arr.map(function (x) { return x.m; });
  }

  function negamax(pos, depth, alpha, beta, ply) {
    var moves = E.legalMoves(pos);
    if (moves.length === 0) return E.isInCheck(pos, pos.sideToMove) ? -(MATE - ply) : 0; // mate / stalemate
    if (depth === 0) return evaluate(pos);
    var best = -Infinity;
    var ord = ordered(moves, pos);
    for (var i = 0; i < ord.length; i++) {
      var score = -negamax(E.makeMove(pos, ord[i]), depth - 1, -beta, -alpha, ply + 1);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // beta cutoff
    }
    return best;
  }

  // --- Seeded PRNG (mulberry32) — reproducible randomness -------------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randIntInclusive(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

  // Best move for a persona. `rng` is a function returning [0,1).
  function bestMove(pos, persona, rng) {
    var moves = E.legalMoves(pos);
    if (moves.length === 0) return null;
    // (1) blunder: with prob = blunderChance, play a uniformly random legal move
    if (persona.blunderChance > 0 && rng() < persona.blunderChance) {
      return moves[Math.floor(rng() * moves.length)];
    }
    // (2) otherwise search each root move to a fresh full window; take the max (+noise)
    var best = null, bestScore = -Infinity;
    var ord = ordered(moves, pos);
    for (var i = 0; i < ord.length; i++) {
      var m = ord[i];
      var score = -negamax(E.makeMove(pos, m), persona.depth - 1, -WIN, WIN, 1);
      if (persona.randomness > 0) score += randIntInclusive(rng, -persona.randomness, persona.randomness);
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  // Async wrapper: yields once so the "thinking…" UI paints before the (main-thread)
  // search runs. The app additionally enforces a minimum delay for natural pacing.
  function bestMoveAsync(pos, persona, opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : ((Date.now() >>> 0) ^ ((Math.random() * 0xFFFFFFFF) >>> 0));
    var rng = mulberry32(seed);
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(bestMove(pos, persona, rng)); }, 0);
    });
  }

  global.Coaches = { all: COACHES, ratingFloor: RATING_FLOOR, ratingCeiling: RATING_CEILING };
  global.CoachAI = {
    MATE: MATE,
    material: material, evaluate: evaluate, negamax: negamax,
    ordered: ordered, captureScore: captureScore,
    bestMove: bestMove, bestMoveAsync: bestMoveAsync, mulberry32: mulberry32
  };
})(typeof window !== 'undefined' ? window : globalThis);
