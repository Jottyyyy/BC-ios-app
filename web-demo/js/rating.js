/* =============================================================================
 * rating.js — Puzzle ELO rating + tiers + eval→win% helpers
 * Faithful port of:
 *   Sources/BiyaherongCoachCore/Rating.swift     (PuzzleRatingEngine, RatingTier)
 *   Sources/BiyaherongCoachCore/GameReview.swift  (evalToWinPct)
 *
 * Load-bearing constants (do NOT change): K = 32, divisor = 400, floor = 400.
 * Exposes window.Rating. Classic <script>, no modules.
 * ========================================================================== */
(function (global) {
  'use strict';

  var K_FACTOR = 32.0;
  var DIVISOR = 400.0;
  var FLOOR = 400;

  // PHP round() is half-away-from-zero; JS Math.round is half-up. Match PHP.
  function roundHalfAwayFromZero(x) {
    return (x < 0 ? -1 : 1) * Math.round(Math.abs(x));
  }

  // One puzzle attempt → { expectedScore, ratingChange, newRating }.
  function evaluate(userRating, puzzleRating, isCorrect) {
    var expected = 1.0 / (1.0 + Math.pow(10.0, (puzzleRating - userRating) / DIVISOR));
    var actual = isCorrect ? 1.0 : 0.0;
    var ratingChange = roundHalfAwayFromZero(K_FACTOR * (actual - expected));
    var newRating = Math.max(FLOOR, userRating + ratingChange);
    return { expectedScore: expected, ratingChange: ratingChange, newRating: newRating };
  }

  // Fallback correctness rule: only the FIRST move is compared.
  function compareMoves(correct, user) {
    if (!user.length || !correct.length) return false;
    return user[0] === correct[0];
  }

  // Rating → tier label (descending ladder; boundary lands in the higher tier).
  var TIERS = [
    { name: 'Expert', floor: 2000 },
    { name: 'Advanced', floor: 1600 },
    { name: 'Intermediate', floor: 1200 },
    { name: 'Beginner', floor: 800 },
    { name: 'Novice', floor: 0 }
  ];
  function classify(rating) {
    for (var i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].floor) return TIERS[i].name;
    return 'Novice';
  }

  // Eval (centipawns, WHITE's perspective) → `color`'s win probability [0..100].
  // Faithful port of GameReview.evalToWinPct (GameReview.swift:84-87).
  //
  // `color` defaults to 'w' because the eval bar in app.js flips the sign itself and passes an
  // already-white-relative number. The game review needs the flip done here, per side — without it
  // Black's accuracy is wrong on every move.
  function evalToWinPct(evalCp, color) {
    var e = (color === 'b') ? -evalCp : evalCp;
    return 50 + 50 * (2 / (1 + Math.pow(10, -e / 400)) - 1);
  }

  global.Rating = {
    K_FACTOR: K_FACTOR, DIVISOR: DIVISOR, FLOOR: FLOOR, TIERS: TIERS,
    evaluate: evaluate, compareMoves: compareMoves,
    classify: classify, evalToWinPct: evalToWinPct,
    roundHalfAwayFromZero: roundHalfAwayFromZero
  };

  /* Makes the rating math requireable headlessly under Node without changing browser behaviour.
     Like engine.js and ai.js, this file has no named binding, so the branch lives inside the IIFE. */
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.Rating; }
})(typeof window !== 'undefined' ? window : globalThis);
