/* streak-engine.js — twin of `Sources/BiyaherongCoachCore/Streak.swift`.
 *
 * Puzzle Streak's difficulty ramp and its anti-reroll lock, ported from the Laravel
 * `StreakController` and pinned by the `streak_target` / `streak_increment` / `streak_reset`
 * golden groups.
 *
 * ── Why this file appears only now ───────────────────────────────────────────
 * `Streak.swift` has existed since the parity core was built, and its `increment` was **dead
 * code** — nothing called it, so `currentStreak` was only ever written back to zero and
 * `puzzleRating` never ramped at all. There was no JS twin either, which is why nothing noticed.
 * Both halves are wired up here, and `PuzzleProgress.recordStreakSolve` is now the single caller.
 *
 * ── The curve (Part 13.2), and why the cliff is deliberate ───────────────────
 * The ramp runs from puzzle #1, INCLUDING during the ten-puzzle warmup. So the warmup serves
 * mate-in-1s at 600 while `puzzleRating` climbs invisibly behind it, and the moment warmup ends
 * the target is already 600 + 10x50 = 1100. That difficulty cliff at puzzle 11 is the mode's
 * signature, not a bug to smooth out.
 */
'use strict';

var BiyaStreakEngine = (function () {

  var INITIAL_RATING = 600;
  var RATING_STEP = 50;
  var RATING_MAX = 2500;
  var WARMUP_COUNT = 10;          // Turbo uses 5 — the two curves are deliberately different
  var WARMUP_THEME = 'mateIn1';
  // The +-50 serving window lives in `puzzle-serving.js` (`STREAK_WINDOW`), single source of truth.

  /** A fresh streak row. */
  function seed() {
    return { currentStreak: 0, bestStreak: 0, puzzleRating: INITIAL_RATING, pendingPuzzleId: null };
  }

  /**
   * Target rating and theme filter for the next puzzle
   * (`StreakController::assignPuzzle`, first lines).
   */
  function target(currentStreak, puzzleRating) {
    var isWarmup = currentStreak < WARMUP_COUNT;
    return { rating: isWarmup ? INITIAL_RATING : puzzleRating,
             theme: isWarmup ? WARMUP_THEME : null };
  }

  /**
   * Apply a correct solve (`StreakController::increment`).
   *
   * `pendingPuzzleId` becomes the freshly-assigned next puzzle, which the caller supplies — that
   * assignment IS the anti-reroll lock, and it is why the field exists.
   */
  function increment(state, nextPuzzleId) {
    var s = {
      currentStreak: state.currentStreak + 1,
      bestStreak: state.bestStreak,
      puzzleRating: Math.min(RATING_MAX, state.puzzleRating + RATING_STEP),
      pendingPuzzleId: (nextPuzzleId === undefined ? null : nextPuzzleId),
    };
    if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;
    return s;
  }

  /** Apply a wrong move (`StreakController::reset`). `bestStreak` is deliberately preserved. */
  function reset(state) {
    return { currentStreak: 0, bestStreak: state.bestStreak,
             puzzleRating: INITIAL_RATING, pendingPuzzleId: null };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function e(c, w) { c ? passed++ : failures.push(w); }

    // ---- the warmup ----------------------------------------------------------
    for (var i = 0; i < WARMUP_COUNT; i++) {
      var t = target(i, 600 + i * RATING_STEP);
      e(t.rating === INITIAL_RATING, 'warmup puzzle ' + i + ' is served at 600');
      e(t.theme === WARMUP_THEME, 'warmup puzzle ' + i + ' is a mate-in-1');
    }
    // ...and the moment it ends, the ramp that ran underneath it takes over.
    var after = target(WARMUP_COUNT, 600 + WARMUP_COUNT * RATING_STEP);
    e(after.rating === 1100, 'puzzle 11 jumps straight to 1100 — the cliff is the point');
    e(after.theme === null, 'and drops the theme filter');

    // ---- the ramp ------------------------------------------------------------
    var s = seed();
    e(s.puzzleRating === 600 && s.currentStreak === 0 && s.pendingPuzzleId === null,
      'a fresh streak starts at 600 with nothing pending');
    for (var j = 0; j < 10; j++) s = increment(s, 100 + j);
    e(s.currentStreak === 10, 'ten solves');
    e(s.puzzleRating === 600 + 10 * RATING_STEP,
      'and the rating ramped through the warmup, not after it: ' + s.puzzleRating);
    e(s.bestStreak === 10, 'best tracks current on the way up');
    e(s.pendingPuzzleId === 109, 'the last assigned puzzle is pending');
    // The ceiling.
    var high = { currentStreak: 50, bestStreak: 50, puzzleRating: RATING_MAX, pendingPuzzleId: 1 };
    e(increment(high, 2).puzzleRating === RATING_MAX, 'the ramp caps at 2500');
    var near = { currentStreak: 1, bestStreak: 1, puzzleRating: RATING_MAX - 10,
                 pendingPuzzleId: null };
    e(increment(near, null).puzzleRating === RATING_MAX, 'and clamps rather than overshooting');

    // ---- failure -------------------------------------------------------------
    var lost = reset(s);
    e(lost.currentStreak === 0, 'a wrong move zeroes the streak');
    e(lost.puzzleRating === INITIAL_RATING, 'and the difficulty ramp');
    e(lost.pendingPuzzleId === null, 'and releases the lock');
    e(lost.bestStreak === 10, 'but bestStreak is preserved — that is the whole record');
    // A reset from a losing run must not lower a best set earlier.
    var wasBetter = { currentStreak: 3, bestStreak: 22, puzzleRating: 800, pendingPuzzleId: 5 };
    e(reset(wasBetter).bestStreak === 22, 'a short run never lowers the best');
    e(increment(wasBetter, 6).bestStreak === 22, 'nor does a solve that does not beat it');
    e(increment({ currentStreak: 22, bestStreak: 22, puzzleRating: 800, pendingPuzzleId: null }, 1)
        .bestStreak === 23, 'but beating it does');

    // ---- the ramp is a pure function of the state ----------------------------
    var a = increment(seed(), 1), b = increment(seed(), 1);
    e(JSON.stringify(a) === JSON.stringify(b), 'increment is deterministic');
    var before = seed();
    increment(before, 9);
    e(before.currentStreak === 0, 'and does not mutate its input');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'StreakEngine: ' + passed + ' assertions passed'
        : 'StreakEngine: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n'),
    };
  }

  return {
    INITIAL_RATING: INITIAL_RATING, RATING_STEP: RATING_STEP, RATING_MAX: RATING_MAX,
    WARMUP_COUNT: WARMUP_COUNT, WARMUP_THEME: WARMUP_THEME,
    seed: seed, target: target, increment: increment, reset: reset, selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaStreakEngine; }
