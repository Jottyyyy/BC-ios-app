/* puzzle-stats.js — the Play Puzzles Home statistics, as pure functions.
 *
 * Twin of `Sources/BiyaherongCoachCore/PuzzleStats.swift`.
 *
 * These live here rather than in a view body for the usual reason: a chart drawn inside a render
 * function is untestable, and every one of these has an edge case that only shows up on day one or
 * after exactly one solve. A sparkline with a single point, a bar chart where every count is zero,
 * an accuracy of 0/0.
 *
 * Part 10.1 replaces the original's leaderboard with these — offline there are no other players,
 * and the user's own history is strictly more useful.
 */
'use strict';

var BiyaPuzzleStats = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var PROG = isNode ? require('./puzzle-progress.js') : BiyaPuzzleProgress;
  var MET = isNode ? require('./puzzle-metrics.js') : BiyaPuzzleMetrics;

  var DAY_MS = 86400000;

  /** True when there is nothing to chart yet — the day-one state. */
  function isEmpty(state) { return state.attempts.length === 0; }

  /**
   * Rating change over the last 7 days: current rating minus the `ratingBefore` of the oldest
   * attempt inside the window. `null` when there is no history in the window, which renders as
   * an em dash rather than a misleading `+0`.
   */
  function weekDelta(state, nowMs) {
    var cutoff = nowMs - 7 * DAY_MS;
    var inWindow = state.attempts.filter(function (a) { return a.solvedAt >= cutoff; });
    if (!inWindow.length) return null;
    var oldest = inWindow.reduce(function (a, b) {
      return a.solvedAt !== b.solvedAt ? (a.solvedAt < b.solvedAt ? a : b)
                                       : (a.puzzleId < b.puzzleId ? a : b);
    });
    return state.profile.rating - oldest.ratingBefore;
  }

  /**
   * The sparkline: the NEWEST 30 attempts' `ratingAfter`, oldest-first for drawing.
   *
   * Spec fix #9 lives upstream in `ratingHistory`, which takes the newest rows where the server
   * took the oldest. Y-range is `[min - 25, max + 25]` of the window, and fewer than two points
   * renders nothing at all — a one-point polyline is an invisible dot that reads as a bug.
   */
  function sparkline(state, width, height) {
    var S = MET.STATS;
    var rows = PROG.ratingHistory(state, S.sparkWindow).slice().reverse();
    if (rows.length < S.sparkMinPoints) return null;
    var values = rows.map(function (r) { return r.ratingAfter; });
    var lo = Math.min.apply(null, values) - S.sparkYMargin;
    var hi = Math.max.apply(null, values) + S.sparkYMargin;
    var span = hi - lo;
    var points = values.map(function (v, i) {
      return {
        x: rows.length === 1 ? 0 : (i / (rows.length - 1)) * width,
        // SVG y grows downward, so a HIGHER rating is a SMALLER y.
        y: height - ((v - lo) / span) * height,
      };
    });
    return { points: points, min: lo, max: hi, count: rows.length };
  }

  /** `solved / attempted` as a percentage, one decimal. `null` when nothing was attempted. */
  function accuracy(state) {
    var attempted = state.attempts.length;
    if (!attempted) return null;
    var solved = state.attempts.filter(function (a) { return a.isCorrect; }).length;
    var pct = Math.round((solved / attempted) * 1000) / 10;
    return { solved: solved, attempted: attempted, pct: pct, color: MET.accuracyColor(pct) };
  }

  /**
   * The last seven local days of COUNTING solves, oldest-first, as the bar chart draws them.
   *
   * `barHeight = max(count / maxVal * 80, 4)` — the source's own formula, ported exactly,
   * including the floor that keeps a zero-count bar visible as a stub.
   */
  function activity(state, nowMs) {
    var S = MET.STATS;
    var today = PROG.dayNumber(PROG.dayKey(nowMs));
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var key = PROG.keyOfDayNumber(today - i);
      days.push({ key: key, count: state.dailySolves[key] || 0 });
    }
    var maxVal = Math.max(days.reduce(function (m, d) { return Math.max(m, d.count); }, 0), 1);
    return days.map(function (d) {
      return {
        key: d.key,
        count: d.count,
        height: Math.max((d.count / maxVal) * S.barMaxHeight, S.barMinHeight),
        filled: d.count > 0,
      };
    });
  }

  /**
   * Up to six themes by attempts, descending.
   *
   * The tie-break on the theme name is not cosmetic: Swift's sort is not stable, so two themes with
   * equal attempts would otherwise swap places between launches. Every ported sort in this repo
   * carries an explicit tie-break for the same reason.
   */
  function themePerformance(state) {
    var S = MET.STATS;
    return Object.keys(state.themeStats)
      .map(function (k) { return state.themeStats[k]; })
      .filter(function (t) { return t.attempted > 0; })
      .sort(function (a, b) {
        return a.attempted !== b.attempted ? b.attempted - a.attempted
                                           : (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : 0);
      })
      .slice(0, S.themeRows)
      .map(function (t) {
        var pct = Math.round((t.solved / t.attempted) * 100);
        return { theme: t.theme, attempted: t.attempted, solved: t.solved, pct: pct };
      });
  }

  /** Everything the Home screen needs, in one call, so the view derives nothing itself. */
  function summary(state, nowMs, sparkWidth, sparkHeight) {
    return {
      empty: isEmpty(state),
      rating: state.profile.rating,
      best: state.profile.highestRating,
      weekDelta: weekDelta(state, nowMs),
      spark: sparkline(state, sparkWidth, sparkHeight),
      accuracy: accuracy(state),
      activity: activity(state, nowMs),
      themes: themePerformance(state),
      goal: PROG.dailyGoalStatus(state, nowMs),
    };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function e(c, w) { c ? passed++ : failures.push(w); }
    var t0 = new Date(2026, 7, 11, 12).getTime();
    var DAY = DAY_MS;

    // ---- day one -------------------------------------------------------------
    var fresh = PROG.seed(t0);
    e(isEmpty(fresh), 'a fresh profile is empty');
    e(weekDelta(fresh, t0) === null, 'no history, no delta — not a misleading +0');
    e(sparkline(fresh, 100, 52) === null, 'no sparkline with no attempts');
    e(accuracy(fresh) === null, 'no accuracy from 0/0');
    e(themePerformance(fresh).length === 0, 'no theme rows');
    var a0 = activity(fresh, t0);
    e(a0.length === 7, 'seven days of bars even on day one');
    e(a0.every(function (d) { return d.count === 0 && !d.filled; }), 'all empty');
    e(a0.every(function (d) { return d.height === MET.STATS.barMinHeight; }),
      'and each is the 4pt stub, not zero height');
    var s0 = summary(fresh, t0, 100, 52);
    e(s0.empty && s0.rating === 1200 && s0.best === 1200,
      'the summary still reports the rating on day one');

    // ---- one attempt ---------------------------------------------------------
    var one = PROG.seed(t0);
    PROG.recordRatedAttempt(one, { puzzleId: 1, isCorrect: true, puzzleRating: 1200,
                                   themes: ['fork'] }, t0);
    e(!isEmpty(one), 'one attempt is not empty');
    e(sparkline(one, 100, 52) === null, 'one point still draws no sparkline');
    e(accuracy(one).pct === 100, 'one solve is 100%');
    e(accuracy(one).color === MET.PALETTE.correct, 'and green');
    e(weekDelta(one, t0) === one.profile.rating - 1200, 'the week delta is measured from before');

    // ---- a real history ------------------------------------------------------
    var st = PROG.seed(t0 - 40 * DAY);
    for (var i = 0; i < 40; i++) {
      PROG.recordRatedAttempt(st, { puzzleId: i, isCorrect: i % 3 !== 0, puzzleRating: 1200,
                                    themes: i % 2 ? ['fork'] : ['pin', 'endgame'] },
                              t0 - (39 - i) * 1000);
    }
    var sp = sparkline(st, 200, 52);
    e(sp !== null, 'forty attempts draw a sparkline');
    e(sp.count === 30, 'capped at the newest 30');
    e(sp.points.length === 30, 'one point each');
    e(sp.points[0].x === 0, 'the first point is at x = 0');
    e(Math.abs(sp.points[29].x - 200) < 1e-9, 'the last point reaches the full width');
    e(sp.points.every(function (p) { return p.y >= 0 && p.y <= 52; }),
      'every point is inside the box');
    // The +-25 margin is what stops a flat line from clipping to the edge.
    e(sp.max - sp.min >= 50, 'the y-range always spans at least the two 25pt margins');
    var flat = PROG.seed(t0);
    for (var j = 0; j < 5; j++) {
      flat.attempts.push({ puzzleId: j, isCorrect: true, ratingChange: 0, ratingBefore: 1200,
                           ratingAfter: 1200, solveTimeSeconds: null, solvedAt: t0 + j });
    }
    var fsp = sparkline(flat, 100, 52);
    e(fsp !== null, 'a flat history still draws');
    e(fsp.points.every(function (p) { return Math.abs(p.y - 26) < 1e-9; }),
      'and sits in the middle rather than clipping');
    // Higher rating = smaller y, because SVG y grows downward.
    var rising = PROG.seed(t0);
    rising.attempts = [
      { puzzleId: 1, isCorrect: true, ratingChange: 0, ratingBefore: 1200, ratingAfter: 1200,
        solveTimeSeconds: null, solvedAt: t0 },
      { puzzleId: 2, isCorrect: true, ratingChange: 0, ratingBefore: 1200, ratingAfter: 1300,
        solveTimeSeconds: null, solvedAt: t0 + 1 },
    ];
    var rsp = sparkline(rising, 100, 52);
    e(rsp.points[1].y < rsp.points[0].y, 'a rating RISE moves the line up, not down');

    var acc = accuracy(st);
    e(acc.attempted === 40, 'forty attempts');
    e(acc.solved === 40 - Math.ceil(40 / 3), 'the right number solved');
    e(String(acc.pct).indexOf('.') >= 0 || Number.isInteger(acc.pct), 'one decimal at most');
    e(acc.pct === Math.round(acc.pct * 10) / 10, 'rounded to one decimal');

    var th = themePerformance(st);
    e(th.length > 0 && th.length <= 6, 'at most six theme rows');
    e(th.every(function (r, i) { return i === 0 || th[i - 1].attempted >= r.attempted; }),
      'sorted by attempts, descending');
    // The tie-break, which Swift's unstable sort needs.
    var tied = PROG.seed(t0);
    tied.themeStats = { zebra: { theme: 'zebra', attempted: 5, solved: 1 },
                        alpha: { theme: 'alpha', attempted: 5, solved: 4 } };
    e(themePerformance(tied)[0].theme === 'alpha', 'an attempts tie breaks on the name');
    var many = PROG.seed(t0);
    many.themeStats = {};
    for (var k = 0; k < 12; k++) {
      many.themeStats['t' + k] = { theme: 't' + k, attempted: 12 - k, solved: 1 };
    }
    e(themePerformance(many).length === 6, 'twelve themes are cut to six');
    e(themePerformance(many)[0].theme === 't0', 'keeping the busiest');

    // ---- the bar chart -------------------------------------------------------
    var act = PROG.seed(t0);
    PROG.recordSolve(act, 'play', t0);
    PROG.recordSolve(act, 'play', t0);
    PROG.recordSolve(act, 'play', t0 - 2 * DAY);
    var bars = activity(act, t0);
    e(bars.length === 7, 'seven bars');
    e(bars[6].count === 2, "today is the LAST bar, not the first");
    e(bars[4].count === 1, 'two days ago is the fifth');
    e(bars[6].height === MET.STATS.barMaxHeight, 'the busiest day is full height');
    e(Math.abs(bars[4].height - MET.STATS.barMaxHeight / 2) < 1e-9, 'half the count, half the bar');
    e(bars[0].height === MET.STATS.barMinHeight, 'an empty day keeps its 4pt stub');
    e(bars.filter(function (b) { return b.filled; }).length === 2, 'two filled days');
    // Turbo is excluded upstream, so it must not appear here either.
    var beforeTurbo = activity(act, t0)[6].count;
    PROG.recordSolve(act, 'turbo', t0);
    e(activity(act, t0)[6].count === beforeTurbo, 'a Turbo solve does not move the bar chart');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'PuzzleStats: ' + passed + ' assertions passed'
        : 'PuzzleStats: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n'),
    };
  }

  return {
    isEmpty: isEmpty, weekDelta: weekDelta, sparkline: sparkline, accuracy: accuracy,
    activity: activity, themePerformance: themePerformance, summary: summary,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleStats; }
