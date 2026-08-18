/* coach-engine.js — how strong each coach plays, and how long it appears to think (spec 2.2).
 *
 *     node -e "console.log(require('./web-demo/js/coach-engine.js').selfTest().summary)"
 *
 * ## This is NOT `ai.js`
 *
 * `ai.js` / `ChessAI.swift` already hold five coach personas driven by `blunderChance` and
 * `randomness` over a negamax search. Spec 2.2 says that is not how the real app works:
 *
 *   "Strength comes from three things only: search depth, MultiPV width, and a client-side
 *    randomiser. There is no Skill Level, no UCI_LimitStrength, no Elo cap, and no explicit
 *    blunder chance."
 *
 * So this layer sits BESIDE that one, exactly as `pairing-engine.js` sits beside the PHP port of the
 * tournament engine. Levels 1-3 get their weakness from picking a worse line out of a MultiPV list,
 * not from a dice roll against the best move — which is a different distribution, and the reason
 * level 1 blunders in a *plausible* way rather than a random one.
 *
 * ## Pure, and the randomness is injected
 *
 * `pickMove` takes an `rng` returning [0,1), the same shape `PuzzleServing`'s picker uses. That is
 * what lets the distribution be asserted rather than sampled and hoped over — Phase 8's criterion 8
 * is a distribution over 200 games, so it has to be measurable.
 */
'use strict';

var BiyaCoachEngine = (function () {

  // ---- Level configuration (spec 2.2, verbatim) ----------------------------------------------
  //
  // `numMoves` is the MultiPV width the engine is asked for. It is what makes the weak levels weak:
  // level 1 chooses uniformly among three lines at depth 2, so its mistakes are real moves a weak
  // player might find, not noise.

  // `movetimeMs` is per level, and it is what actually sets strength: `depth` is only a ceiling,
  // and at ~60k nodes/sec a one-second search reaches depth 5-6 in a middlegame. With one flat cap
  // for all five, levels 4 and 5 never approached their 10 and 15 and played identically. L3 keeps
  // exactly the old 1000 ms, so the middle of the ladder is unchanged. See CoachEngine.swift.
  var LEVEL_CONFIG = {
    1: { depth: 2,  numMoves: 3, movetimeMs: 300 },
    2: { depth: 4,  numMoves: 3, movetimeMs: 600 },
    3: { depth: 7,  numMoves: 2, movetimeMs: 1000 },
    4: { depth: 10, numMoves: 1, movetimeMs: 2000 },
    5: { depth: 15, numMoves: 1, movetimeMs: 4000 },
  };

  var MIN_LEVEL = 1, MAX_LEVEL = 5;

  /** The longest any coach may think. Level 5 is the one that reaches it. */
  var MOVETIME_MAX_MS = 4000;

  function config(level) {
    return LEVEL_CONFIG[clampLevel(level)];
  }

  function clampLevel(level) {
    var n = parseInt(level, 10);
    if (!isFinite(n)) return MIN_LEVEL;
    return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));
  }

  // ---- Move choice ---------------------------------------------------------------------------

  /**
   * Which of the engine's lines the coach actually plays.
   *
   * `top` is the MultiPV list, best first. `rng` returns [0,1).
   *
   *   L1  uniform over all lines            — this IS the blunder injection
   *   L2  best 40 % of the time, else uniform over all lines (so best ends up ~60 %)
   *   L3  best 70 %, otherwise the second line
   *   L4  always best
   *   L5  always best
   *
   * Returns the INDEX, not the line: the caller has the line, and an index is what a distribution
   * test can count.
   */
  function pickIndex(top, level, rng) {
    var n = top.length;
    if (n <= 1) return 0;
    switch (clampLevel(level)) {
      case 1:
        return Math.floor(rng() * n) % n;
      case 2:
        return rng() < 0.4 ? 0 : Math.floor(rng() * n) % n;
      case 3:
        return rng() < 0.7 ? 0 : Math.min(1, n - 1);
      default:
        return 0;
    }
  }

  function pickMove(top, level, rng) {
    if (!top || !top.length) return null;
    return top[pickIndex(top, level, rng)];
  }

  // ---- Think time ----------------------------------------------------------------------------
  //
  // New, and required. On-device the engine answers in milliseconds, where the RN bots were paced by
  // network latency. Without a delay the coach replies instantly and the game feels broken.

  var THINK_MS = {
    1: { min: 300,  max: 700 },
    2: { min: 400,  max: 900 },
    3: { min: 600,  max: 1300 },
    4: { min: 800,  max: 1700 },
    5: { min: 1000, max: 2200 },
  };

  /** Below this many pieces the upper bound is scaled down, so endgames do not drag. */
  var ENDGAME_PIECES = 8;
  var ENDGAME_SCALE = 0.6;          // "scale the upper bound down by 40 %"

  /**
   * How long the coach should appear to think, in ms.
   *
   * Awaited in PARALLEL with the search, not after it — the point is a floor on the reply, not an
   * added delay. Spec 2.13's "no coach ever replies in under 300 ms" is the same statement.
   */
  function thinkTimeMs(level, pieceCount, rng) {
    var band = THINK_MS[clampLevel(level)];
    var max = band.max;
    if (typeof pieceCount === 'number' && pieceCount < ENDGAME_PIECES) {
      max = Math.round(max * ENDGAME_SCALE);
    }
    // The floor is never scaled: a fast reply is the thing being prevented.
    if (max < band.min) max = band.min;
    return band.min + Math.floor(rng() * (max - band.min + 1));
  }

  /** The limits to hand the engine for one reply. */
  function searchLimits(level) {
    var c = config(level);
    return { depth: c.depth, multiPV: c.numMoves, movetimeMs: c.movetimeMs };
  }

  // ---- Self-test -------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    // --- the table, verbatim from the spec ---
    eq(config(1).depth, 2, 'L1 searches to depth 2');
    eq(config(1).numMoves, 3, 'and asks for three lines');
    eq(config(3).depth, 7, 'L3 depth');
    eq(config(3).numMoves, 2, 'L3 width');
    eq(config(5).depth, 15, 'L5 depth');
    eq(config(5).numMoves, 1, 'L5 takes one line only');
    eq(config(3).movetimeMs, 1000,
       'L3 still gets exactly the 1 s the Python service gave every level');
    eq(searchLimits(5).movetimeMs, MOVETIME_MAX_MS, 'L5 thinks the longest');
    for (var lv = 1; lv < 5; lv++) {
      expect(config(lv).movetimeMs < config(lv + 1).movetimeMs,
             'the ladder is monotonic in TIME too, not only in depth (L' + lv + ')');
    }
    // An out-of-range level must still return a playable config rather than undefined — a deep link
    // with a bad level is spec 7 #35, where `COACH_DATA[NaN]` produced a white screen.
    eq(config(0).depth, config(1).depth, 'level 0 clamps to 1');
    eq(config(99).depth, config(5).depth, 'level 99 clamps to 5');
    eq(config('nonsense').depth, config(1).depth, 'a non-numeric level clamps to 1');

    // --- the distribution, which IS the strength ---
    var lines = ['a', 'b', 'c'];
    function distribution(level, n) {
      // A deterministic cycling rng: no sampling noise, so the assertion is exact.
      var i = 0;
      var rng = function () { i += 1; return ((i * 0.137) % 1); };
      var counts = [0, 0, 0];
      for (var k = 0; k < n; k++) counts[pickIndex(lines, level, rng)]++;
      return counts;
    }

    // L1 is uniform: every line must be reachable, and none may dominate.
    var d1 = distribution(1, 3000);
    expect(d1[0] > 0 && d1[1] > 0 && d1[2] > 0, 'L1 can play any of the three lines');
    expect(Math.max.apply(null, d1) - Math.min.apply(null, d1) < 3000 * 0.1,
           'L1 is roughly uniform, got ' + d1.join('/'));

    // L4 and L5 never deviate.
    [4, 5].forEach(function (lv) {
      var d = distribution(lv, 500);
      eq(d[0], 500, 'L' + lv + ' always plays the best line');
    });

    // L3 plays the best line most of the time and the SECOND otherwise — never the third.
    var d3 = distribution(3, 3000);
    eq(d3[2], 0, 'L3 never reaches the third line');
    expect(d3[0] > d3[1], 'L3 prefers the best line, got ' + d3.join('/'));

    // L2 prefers the best line, and can still reach the worst.
    var d2 = distribution(2, 3000);
    expect(d2[0] > d2[1] && d2[0] > d2[2], 'L2 prefers the best line, got ' + d2.join('/'));
    expect(d2[2] > 0, 'but L2 can still play the third');

    // A single line is played whatever the level — this is the L4/L5 case and the endgame case.
    [1, 2, 3, 4, 5].forEach(function (lv) {
      eq(pickMove(['only'], lv, function () { return 0.99; }), 'only',
         'L' + lv + ' plays the only line it is given');
    });
    eq(pickMove([], 1, Math.random), null, 'an empty line list yields no move');

    // The index never escapes the list, for any rng value including the boundaries.
    [0, 0.4, 0.7, 0.999999, 1].forEach(function (v) {
      [1, 2, 3, 4, 5].forEach(function (lv) {
        var idx = pickIndex(lines, lv, function () { return v; });
        expect(idx >= 0 && idx < lines.length,
               'L' + lv + ' with rng=' + v + ' stays in range, got ' + idx);
      });
    });

    // --- think time ---
    var lo = function () { return 0; }, hi = function () { return 0.999999; };
    eq(thinkTimeMs(1, 32, lo), 300, 'L1 floor');
    eq(thinkTimeMs(1, 32, hi), 700, 'L1 ceiling');
    eq(thinkTimeMs(5, 32, lo), 1000, 'L5 floor');
    eq(thinkTimeMs(5, 32, hi), 2200, 'L5 ceiling');
    // Nobody replies faster than 300 ms — spec 2.13, and Phase 8 criterion 8.
    [1, 2, 3, 4, 5].forEach(function (lv) {
      expect(thinkTimeMs(lv, 32, lo) >= 300, 'L' + lv + ' never replies under 300 ms');
      expect(thinkTimeMs(lv, 3, lo) >= 300, 'nor in an endgame');
    });
    // The endgame scales the CEILING only, by 40 %.
    eq(thinkTimeMs(5, 4, hi), 1320, 'an endgame ceiling is 60 % of the full one');
    eq(thinkTimeMs(5, 4, lo), 1000, 'while the floor is untouched');
    expect(thinkTimeMs(5, ENDGAME_PIECES, hi) === 2200,
           'the endgame rule starts BELOW 8 pieces, not at it');
    // The floor can exceed a scaled ceiling in principle; it must never invert.
    [1, 2, 3, 4, 5].forEach(function (lv) {
      expect(thinkTimeMs(lv, 2, hi) >= thinkTimeMs(lv, 2, lo),
             'L' + lv + ' endgame band never inverts');
    });

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-engine: ' + passed + ' assertions passed'
        : 'coach-engine: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    LEVEL_CONFIG: LEVEL_CONFIG, THINK_MS: THINK_MS,
    MIN_LEVEL: MIN_LEVEL, MAX_LEVEL: MAX_LEVEL,
    MOVETIME_MAX_MS: MOVETIME_MAX_MS,
    ENDGAME_PIECES: ENDGAME_PIECES, ENDGAME_SCALE: ENDGAME_SCALE,
    config: config, clampLevel: clampLevel, searchLimits: searchLimits,
    pickIndex: pickIndex, pickMove: pickMove, thinkTimeMs: thinkTimeMs,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachEngine; }
