/* puzzle-store.js — the four offline puzzle selectors (Part 7).
 *
 * Twin of `Sources/BiyaherongCoachCore/PuzzleSelection.swift` + the app's `PuzzleStore`.
 *
 * ── Division of labour ────────────────────────────────────────────────────────
 * `puzzle-serving.js` / `PuzzleServing.swift` own the LADDER — which tier runs in what order and
 * with which predicate. They are pinned by the `serving` golden group and must not change. This
 * file owns everything the ladder cannot: where the candidates come from, the seen set, and what
 * happens when the ladder reports a Tier-3 reset.
 *
 * ── Spec fix #7, and why it belongs here ─────────────────────────────────────
 * The Laravel version wiped the user's ENTIRE `user_seen_puzzles` table whenever any single query
 * ran dry, so exhausting one narrow theme reset non-repetition for every mode at once. The fix is
 * to scope the wipe. It lands in this file rather than in the ladder because the ladder never
 * wiped anything in the first place — it takes `seen` as an argument and REPORTS `didReset` as a
 * flag. So the pinned engine stays byte-identical and the caller changes, which is the whole
 * reason the two are separate.
 *
 * ── Prefetching (7.6) ────────────────────────────────────────────────────────
 * The original kept a 20-deep buffer in rated mode and a 12-deep buffer with 6 parallel HTTP
 * fetches in Turbo, purely to hide network latency. A local read is sub-millisecond, so there is
 * no buffer here at all. Turbo's single lookahead needs no API: it calls `nextStreak` while the
 * current puzzle is on screen and holds the one result. Adding a queue would reintroduce the
 * double-serve bug the seen set exists to prevent.
 */
'use strict';

var BiyaPuzzleStore = (function () {
  var SERVE = (typeof module !== 'undefined' && module.exports)
    ? require('./puzzle-serving.js')
    : BiyaPuzzleServing;

  // Part 11.1 — the daily epoch. Fixed forever: moving it shifts every past and future date.
  var DAILY_EPOCH = { year: 2026, month: 1, day: 1 };

  // Part 12.1 — the 12 themes the Thematic grid offers, in grid order. Ids only; the labels and
  // tile colours are view data and live with the screen.
  var UI_THEMES = ['hangingPiece', 'crushing', 'fork', 'pin', 'skewer', 'discoveredAttack',
                   'advantage', 'endgame', 'backRankMate', 'mateIn1', 'mateIn2', 'middlegame'];

  // ---- The day number ------------------------------------------------------------------
  /**
   * Days since the epoch on the LOCAL calendar (spec fix #1).
   *
   * The original used `new Date().toISOString().split('T')[0]`, i.e. UTC, so in Manila (UTC+8)
   * the daily puzzle and every daily counter rolled over at 8 a.m. local while the UI said
   * "resets at midnight".
   *
   * Built from the local Y/M/D through `Date.UTC` rather than by subtracting two local midnights:
   * a DST transition makes a local day 23 or 25 hours long, and dividing that by 86,400,000 loses
   * or gains a day. Reading off the calendar fields sidesteps the clock entirely — which is
   * exactly what `Calendar.dateComponents([.day], …)` does on the Swift side.
   */
  function localDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function daysSinceEpoch(date) {
    var epoch = Math.floor(Date.UTC(DAILY_EPOCH.year, DAILY_EPOCH.month - 1, DAILY_EPOCH.day)
                           / 86400000);
    return localDayNumber(date) - epoch;
  }

  /** `((n % count) + count) % count` — the double modulo keeps dates before the epoch in range. */
  function dailyIndex(date, poolCount) {
    if (!poolCount) return 0;
    var n = daysSinceEpoch(date);
    return ((n % poolCount) + poolCount) % poolCount;
  }

  // ---- The Tier-3 scope ------------------------------------------------------------------
  /**
   * What the caller is allowed to forget when the ladder reports `didReset` (spec fix #7).
   *
   *   { kind:'theme',  theme }        a theme filter was in play — forget only that theme
   *   { kind:'window', lo, hi }       no theme — forget only this rating band
   *   { kind:'all' }                  the unscoped pool is genuinely exhausted
   *
   * Pure, so the decision is assertable on its own rather than only through its side effect.
   */
  function scopeForReset(theme, center, window, seenCount, corpusCount) {
    if (corpusCount > 0 && seenCount >= corpusCount) return { kind: 'all' };
    if (theme != null) return { kind: 'theme', theme: theme };
    return { kind: 'window', lo: center - window, hi: center + window };
  }

  // ---- Sources ----------------------------------------------------------------------------
  /**
   * The array-backed source the browser demo uses, over `puzzle-data.js`.
   *
   * The device implements the same three primitives in SQL against the 93k-row bundle; this one
   * runs them over the ~1.7k-row slice a page can hold. Keeping the primitives this small is what
   * lets the two agree — the ladder above them is shared, and the only thing that differs is where
   * the candidates come from.
   */
  function arraySource(puzzles) {
    var byId = Object.create(null);
    for (var i = 0; i < puzzles.length; i++) byId[puzzles[i].id] = puzzles[i];
    var candidates = puzzles.map(function (p) {
      return { id: p.id, rating: p.rating, themes: p.themes };
    });
    return {
      count: candidates.length,
      all: function () { return candidates; },
      byId: function (id) { return byId[id] || null; },
      idsWithTheme: function (theme) {
        var out = [];
        for (var j = 0; j < candidates.length; j++) {
          if (candidates[j].themes.indexOf(theme) >= 0) out.push(candidates[j].id);
        }
        return out;
      },
      idsInRange: function (lo, hi) {
        var out = [];
        for (var j = 0; j < candidates.length; j++) {
          if (candidates[j].rating >= lo && candidates[j].rating <= hi) out.push(candidates[j].id);
        }
        return out;
      },
    };
  }

  // ---- The store ---------------------------------------------------------------------------
  /**
   * `opts.seen`  — a Set of puzzle ids, owned by the caller so it can be persisted.
   * `opts.pick`  — the `inRandomOrder()` stand-in. Defaults to a real random pick; the tests
   *                inject `lowestIdPicker` so the ladder stays deterministic.
   * `opts.daily` — the daily pool as an array of puzzle ids (the `daily_pool` table).
   */
  function create(source, opts) {
    opts = opts || {};
    var seen = opts.seen || new Set();
    var daily = opts.daily || [];
    var pick = opts.pick || randomPicker;

    function randomPicker(list) {
      return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    }

    /** Runs a ladder, acts on `didReset`, marks the result seen, and returns the full puzzle. */
    function serve(ladder, center, window, theme) {
      var sel = ladder(source.all(), center, window, theme, seen, pick);
      var forgot = null;
      if (sel.didReset) forgot = forget(scopeForReset(theme, center, window, seen.size,
                                                      source.count));
      if (sel.candidate) seen.add(sel.candidate.id);
      return {
        puzzle: sel.candidate ? source.byId(sel.candidate.id) : null,
        stage: sel.stage, didReset: sel.didReset, forgot: forgot,
      };
    }

    /** Applies a scope decision to the seen set. Returns what it actually removed. */
    function forget(scope) {
      var ids;
      if (scope.kind === 'all') { ids = null; }
      else if (scope.kind === 'theme') { ids = source.idsWithTheme(scope.theme); }
      else { ids = source.idsInRange(scope.lo, scope.hi); }
      var removed = 0;
      if (ids === null) { removed = seen.size; seen.clear(); }
      else {
        for (var i = 0; i < ids.length; i++) if (seen.delete(ids[i])) removed++;
      }
      return { scope: scope, removed: removed };
    }

    return {
      seen: seen,
      source: source,
      dailyPool: daily,

      /** 7.2 — rated. Window ±100 around the profile rating, no theme. */
      nextRated: function (userRating) {
        return serve(SERVE.serveRandom, userRating, SERVE.REGULAR_WINDOW, null);
      },

      /** 7.3 — Streak / Turbo. Window ±50 around an explicit target, optional warmup theme. */
      nextStreak: function (targetRating, theme) {
        return serve(SERVE.serveClosest, targetRating, SERVE.STREAK_WINDOW, theme || null);
      },

      /** 7.4 — Thematic. Window ±200 around the profile rating, theme mandatory. */
      nextThematic: function (userRating, theme) {
        if (!theme) throw new Error('thematic serving requires a theme');
        return serve(SERVE.serveThematic, userRating, SERVE.THEMATIC_WINDOW, theme);
      },

      /**
       * 7.5 / 11.1 — the daily puzzle. Not a query: a pure function of the local calendar date,
       * so every device shows the same puzzle on the same date with zero communication. It does
       * NOT touch the seen set — the daily puzzle repeating in another mode is fine, and marking
       * it seen would make "today's puzzle" unavailable to the mode that just showed it.
       */
      daily: function (date) {
        if (!daily.length) return { puzzle: null, dayIndex: 0 };
        var idx = dailyIndex(date, daily.length);
        return { puzzle: source.byId(daily[idx]), dayIndex: idx, poolCount: daily.length };
      },

      forget: forget,
      markSeen: function (id) { seen.add(id); },
      hasSeen: function (id) { return seen.has(id); },
    };
  }

  return {
    DAILY_EPOCH: DAILY_EPOCH, UI_THEMES: UI_THEMES,
    localDayNumber: localDayNumber, daysSinceEpoch: daysSinceEpoch, dailyIndex: dailyIndex,
    scopeForReset: scopeForReset, arraySource: arraySource, create: create,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BiyaPuzzleStore;
