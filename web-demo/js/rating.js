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

  // Eval (centipawns, white's perspective) → white win probability [0..100].
  // From GameReview.evalToWinPct.
  function evalToWinPct(evalCp) {
    return 50 + 50 * (2 / (1 + Math.pow(10, -evalCp / 400)) - 1);
  }

  global.Rating = {
    K_FACTOR: K_FACTOR, DIVISOR: DIVISOR, FLOOR: FLOOR, TIERS: TIERS,
    evaluate: evaluate, compareMoves: compareMoves,
    classify: classify, evalToWinPct: evalToWinPct,
    roundHalfAwayFromZero: roundHalfAwayFromZero
  };
})(typeof window !== 'undefined' ? window : globalThis);
