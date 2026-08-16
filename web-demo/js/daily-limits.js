/* daily-limits.js — the browser mirror of Sources/BiyaherongCoachCore/DailyLimits.swift
 *
 * The free tier's per-mode daily caps, ported from the Laravel backend's `ChecksDailyLimits` and
 * pinned to it by 168 golden assertions on the Swift side. Until now this was the one fully-ported
 * Core engine with **no JS twin and no cross-check** — `tools/qa/replay_premium.js` closes that.
 *
 *     node -e "console.log(require('./web-demo/js/daily-limits.js').selfTest().summary)"
 *
 * DO NOT add a mode to `CAPS`. The table is what the PHP oracle verified; a mode added here or in
 * Swift makes the two diverge from the backend they were checked against. The subscription's own
 * invented cap (`review`) lives in `premium.js` / `Entitlement.swift` instead.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
'use strict';

var BiyaDailyLimits = (function () {

  /** Named caps. Any `rush_*` mode is 1; unknown modes default to 1. */
  var CAPS = {
    regular: 5,   // rated Play Puzzles
    streak: 1,    // puzzle streak (start-of-session)
    coach: 2      // AI coach chats
  };

  /** Maximum uses per day for a mode. */
  function maxUses(mode) {
    if (typeof mode === 'string' && mode.indexOf('rush_') === 0) return 1;
    return Object.prototype.hasOwnProperty.call(CAPS, mode) ? CAPS[mode] : 1;
  }

  /**
   * Whether a user has hit their daily cap. Premium always passes (false).
   * Matches PHP `count >= max` — note the `>=`, not `>`.
   */
  function isAtDailyLimit(mode, usedToday, isPremium) {
    if (isPremium) return false;
    return usedToday >= maxUses(mode);
  }

  /**
   * The local-day key (`yyyy-MM-dd`) used to bucket daily counters.
   *
   * DELIBERATE DEVIATION, already recorded for the Swift: the server keys the day by UTC
   * (`Carbon::today()`); the offline app keys it by the device's LOCAL day. Identical to
   * `BiyaPuzzleProgress.dayKey`, which the two engines share.
   */
  function dayKey(nowMs) {
    var d = new Date(nowMs);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
    }

    /* 1. the table, exactly as the oracle verified it */
    eq(maxUses('regular'), 5, 'rated play is 5/day');
    eq(maxUses('streak'), 1, 'streak is 1/day');
    eq(maxUses('coach'), 2, 'coach chats are 2/day');
    eq(Object.keys(CAPS).length, 3, 'the named table has exactly three modes');

    /* 2. rush is per-mode, and every rush_* is 1 */
    ['rush_0', 'rush_3', 'rush_5', 'rush_99'].forEach(function (m) {
      eq(maxUses(m), 1, m + ' is 1/day');
    });
    expect(maxUses('rush_3') === maxUses('rush_5'),
      'each Turbo mode carries its own allowance, not a shared one');

    /* 3. unknown modes fail SAFE — one use, not unlimited */
    eq(maxUses('nonsense'), 1, 'an unknown mode defaults to 1');
    eq(maxUses(''), 1, 'an empty mode defaults to 1');
    eq(maxUses(null), 1, 'a null mode defaults to 1');
    eq(maxUses('RUSH_3'), 1, 'the rush prefix is case-sensitive and falls through to the default');
    // `hasOwnProperty`, not `CAPS[mode]` — otherwise 'constructor' or 'toString' would inherit
    // a truthy value off Object.prototype and hand out a nonsense cap.
    eq(maxUses('constructor'), 1, 'a prototype key does not leak a cap');
    eq(maxUses('toString'), 1, 'toString does not leak a cap');

    /* 4. the boundary is `>=`, which is where an off-by-one would hide */
    expect(!isAtDailyLimit('regular', 4, false), '4 of 5 is not at the limit');
    expect(isAtDailyLimit('regular', 5, false), '5 of 5 IS at the limit');
    expect(isAtDailyLimit('regular', 6, false), 'over the limit is at the limit');
    expect(!isAtDailyLimit('streak', 0, false), 'a fresh streak day is open');
    expect(isAtDailyLimit('streak', 1, false), 'one streak run exhausts the day');

    /* 5. premium is never limited, at any count */
    [0, 1, 5, 999].forEach(function (n) {
      expect(!isAtDailyLimit('regular', n, true), 'premium passes at ' + n + ' uses');
    });
    expect(!isAtDailyLimit('nonsense', 999, true), 'premium passes even for an unknown mode');

    /* 6. day keys — zero-padded, local, and stable across a day boundary */
    var jan5 = new Date(2026, 0, 5, 0, 0, 0).getTime();
    eq(dayKey(jan5), '2026-01-05', 'midnight zero-pads month and day');
    eq(dayKey(new Date(2026, 6, 23, 13, 45, 0).getTime()), '2026-07-23', 'mid-day');
    eq(dayKey(new Date(2026, 11, 31, 23, 59, 59).getTime()), '2026-12-31', 'last second of the year');
    expect(dayKey(jan5) !== dayKey(jan5 - 1), 'one millisecond before midnight is the previous day');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'BiyaDailyLimits: ' + passed + ' assertions passed'
        : 'BiyaDailyLimits: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  return { CAPS: CAPS, maxUses: maxUses, isAtDailyLimit: isAtDailyLimit, dayKey: dayKey,
           selfTest: selfTest };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaDailyLimits; }
