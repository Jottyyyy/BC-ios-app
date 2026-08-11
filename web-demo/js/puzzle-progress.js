/* puzzle-progress.js — everything the user DOES in the Puzzle Hub.
 *
 * Browser mirror of `Sources/BiyaherongCoachCore/PuzzleProgress.swift`.
 *
 *     node -e "console.log(require('./web-demo/js/puzzle-progress.js').selfTest().summary)"
 *
 * Two halves, as everywhere else in this rebuild:
 *
 *   PURE LAYER — the Part 4 record shapes and every rule over them: the rated ledger, the seen
 *                set, the streak and rush state, drafts with a 24-hour TTL, the daily-goal
 *                counter. No storage and no clock: `now` (epoch ms) is an INJECTED parameter, the
 *                same convention `AnalysisStore` uses, which is what makes the day boundary and
 *                the TTL assertable.
 *   STORAGE    — a thin localStorage layer under `biya.puzzles.v1`.
 *
 * ── Part 4 says SwiftData; this is Codable + JSON ────────────────────────────
 * The record SHAPES below are the spec's, field for field. The mechanism is not: this app already
 * persists the Analysis Board's library as Codable + JSON and there is no reason for the Puzzle
 * Hub to introduce a second persistence stack. Recorded in PORTING_NOTES.md.
 *
 * ── What the arithmetic is NOT allowed to reinvent ───────────────────────────
 * The Elo, the streak ramp, the rush best-score rule and the goal-streak walk are all already
 * ported and pinned to the PHP oracle. This file calls them; it does not restate them.
 */
'use strict';

var BiyaPuzzleProgress = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var RATING = isNode ? require('./rating.js') : Rating;
  var SESSION = isNode ? require('./puzzle-session.js') : BiyaPuzzleSession;
  var STREAK = isNode ? require('./streak-engine.js') : BiyaStreakEngine;

  var STORAGE_KEY = 'biya.puzzles.v1';
  var STATE_VERSION = 1;

  var DEFAULT_RATING = 1200;          // Part 4, PuzzleProfile.rating
  var STREAK_INITIAL_RATING = 600;    // Part 4 / StreakEngine.initialRating
  var RUSH_MODES = [0, 3, 5];         // infinite, 3 min, 5 min
  var DAILY_TARGET = 10;              // Part 15.1 — the server's hardcoded literal
  var GOAL_LOOKBACK_DAYS = 365;       // matches the server's SQL LIMIT 365
  var DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

  /**
   * Why a Turbo run ended (spec fix #6 — the original always said "Time's Up!").
   *
   * Enumerated rather than left as a free string: the Swift side is a `RushEndReason` enum, so a
   * typo there is a compile error, while `'timesUp'` for `'timeUp'` would pass silently here and
   * the results screen would fall through to the wrong title.
   */
  var RUSH_END_REASONS = ['timeUp', 'threeMistakes', 'quit', 'backgrounded', 'finished'];

  // ---- day keys (spec fix #1: LOCAL calendar, never UTC) ---------------------------------
  /** `yyyy-MM-dd` in the device-local calendar — the same key `DailyLimits.dayKey` produces. */
  function dayKey(nowMs) {
    var d = new Date(nowMs);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /**
   * A day key as an integer day number, for gap arithmetic.
   *
   * Via `Date.UTC` on the parsed Y/M/D rather than by differencing two local midnights: a DST
   * transition makes a local day 23 or 25 hours long, which silently adds or drops a day from a
   * streak. Same reasoning as `puzzle-store.js`.
   */
  function dayNumber(key) {
    var p = key.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }

  // ---- seed (Part 4: "on first launch create …, and nothing else") -------------------------
  function seed(nowMs) {
    var rush = {};
    for (var i = 0; i < RUSH_MODES.length; i++) rush[String(RUSH_MODES[i])] = 0;
    return {
      version: STATE_VERSION,
      profile: { rating: DEFAULT_RATING, highestRating: DEFAULT_RATING, createdAt: nowMs },
      attempts: [],                 // PuzzleAttempt — rated mode only, unique on puzzleId
      seen: [],                     // SeenPuzzle — all modes
      streak: { currentStreak: 0, bestStreak: 0, puzzleRating: STREAK_INITIAL_RATING,
                pendingPuzzleId: null },
      streakRuns: [],               // StreakRun — replaces the online leaderboard
      rushBest: rush,               // RushBest, one entry per mode
      rushRuns: [],                 // RushRun
      rushDraft: null,              // RushDraft — infinite-mode resume
      daily: { streak: 0, totalSolved: 0, lastSolvedDay: null },   // DailyPuzzleState
      playDraft: null,              // PlayPuzzleDraft — rated-mode resume
      themeStats: {},               // ThemeStat, keyed by theme
      dailySolves: {},              // DailySolveCount, keyed by local day key (Part 15)
    };
  }

  // ---- the rated ledger (Part 8) ------------------------------------------------------------
  function attemptFor(state, puzzleId) {
    for (var i = 0; i < state.attempts.length; i++) {
      if (state.attempts[i].puzzleId === puzzleId) return state.attempts[i];
    }
    return null;
  }

  /**
   * Part 8 — the ONE place `profile.rating` changes. Rated mode only; Daily, Thematic, Streak and
   * Turbo never call this.
   *
   * First rated attempt per puzzle decides everything. A replay is allowed and is a no-op: no
   * rating move, no second ledger row, no ThemeStat bump, and no daily-goal credit. The spec
   * bundles all four under "On the first `finish()` for a puzzle", and the alternative would let
   * a user farm the daily goal by replaying one puzzle.
   */
  function recordRatedAttempt(state, p, nowMs) {
    var existing = attemptFor(state, p.puzzleId);
    if (existing) {
      return { state: state, firstAttempt: false, ratingChange: 0,
               ratingBefore: state.profile.rating, ratingAfter: state.profile.rating,
               countedTowardGoal: false };
    }
    var before = state.profile.rating;
    var out = RATING.evaluate(before, p.puzzleRating, p.isCorrect);
    state.profile.rating = out.newRating;
    if (out.newRating > state.profile.highestRating) state.profile.highestRating = out.newRating;
    state.attempts.push({
      puzzleId: p.puzzleId, isCorrect: !!p.isCorrect, ratingChange: out.ratingChange,
      ratingBefore: before, ratingAfter: out.newRating,
      solveTimeSeconds: (p.solveTimeSeconds == null ? null : p.solveTimeSeconds),
      solvedAt: nowMs,
    });
    bumpThemeStats(state, p.themes || [], p.isCorrect);
    var counted = false;
    if (p.isCorrect) counted = recordSolve(state, 'play', nowMs).counted;
    return { state: state, firstAttempt: true, ratingChange: out.ratingChange,
             ratingBefore: before, ratingAfter: out.newRating, countedTowardGoal: counted };
  }

  /** attempted +1 always, solved +1 when correct — for every theme on the puzzle (Part 8). */
  function bumpThemeStats(state, themes, isCorrect) {
    for (var i = 0; i < themes.length; i++) {
      var t = themes[i];
      var s = state.themeStats[t] || (state.themeStats[t] = { theme: t, attempted: 0, solved: 0 });
      s.attempted += 1;
      if (isCorrect) s.solved += 1;
    }
  }

  /** The newest N rating-ledger rows. Spec fix #9: the server took the OLDEST 30. */
  function ratingHistory(state, limit) {
    var rows = state.attempts.slice().sort(function (a, b) {
      return a.solvedAt !== b.solvedAt ? b.solvedAt - a.solvedAt : b.puzzleId - a.puzzleId;
    });
    return rows.slice(0, limit == null ? 30 : limit);
  }

  // ---- the daily goal (Part 15) ---------------------------------------------------------------
  /**
   * Credit one counting solve. The mode predicate lives in `puzzle-session.js` and is called from
   * here and nowhere else, so "does Turbo count?" is a one-line change.
   */
  function recordSolve(state, mode, nowMs) {
    if (!SESSION.countsTowardDailyGoal(mode)) return { state: state, counted: false };
    var k = dayKey(nowMs);
    state.dailySolves[k] = (state.dailySolves[k] || 0) + 1;
    return { state: state, counted: true, dayKey: k, solvedToday: state.dailySolves[k] };
  }

  /**
   * Consecutive local days with at least one counting solve, anchored to today OR yesterday, with
   * a 365-day lookback. The same walk as `DailyGoal.calculateStreakDays`, over day numbers instead
   * of Dates: anchoring to yesterday is what lets a streak survive until the end of the following
   * day rather than dying at midnight.
   */
  function goalStreakDays(state, nowMs) {
    var days = Object.keys(state.dailySolves)
      .filter(function (k) { return state.dailySolves[k] > 0; })
      .map(dayNumber)
      .sort(function (a, b) { return b - a; })
      .slice(0, GOAL_LOOKBACK_DAYS);
    if (!days.length) return 0;
    var today = dayNumber(dayKey(nowMs));
    var check = (days.indexOf(today) >= 0) ? today : today - 1;
    var streak = 0;
    for (var i = 0; i < days.length; i++) {
      if (days[i] === check) { streak++; check--; }
      else if (days[i] < check) break;      // gap → broken
      // days[i] > check → a future-dated entry, skipped (matches the PHP's implicit else)
    }
    return streak;
  }

  function dailyGoalStatus(state, nowMs) {
    var solved = state.dailySolves[dayKey(nowMs)] || 0;
    return {
      solvedToday: solved, target: DAILY_TARGET,
      complete: solved >= DAILY_TARGET,
      progress: Math.min(solved / DAILY_TARGET, 1),
      goalStreak: goalStreakDays(state, nowMs),
    };
  }

  // ---- Daily Puzzle state (Part 11) -----------------------------------------------------------
  /**
   * One solve per calendar day counts. Solving twice on the same day must not double the streak,
   * which is why this compares against `lastSolvedDay` rather than just incrementing.
   */
  function recordDailyPuzzleSolve(state, nowMs) {
    var today = dayKey(nowMs);
    if (state.daily.lastSolvedDay === today) {
      return { state: state, alreadySolvedToday: true, streak: state.daily.streak };
    }
    var yesterday = keyOfDayNumber(dayNumber(today) - 1);
    state.daily.streak = (state.daily.lastSolvedDay === yesterday) ? state.daily.streak + 1 : 1;
    state.daily.totalSolved += 1;
    state.daily.lastSolvedDay = today;
    recordSolve(state, 'daily', nowMs);
    return { state: state, alreadySolvedToday: false, streak: state.daily.streak };
  }

  function keyOfDayNumber(n) {
    var d = new Date(n * 86400000);
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  // ---- Streak: the mid-run half (Part 13.2) -----------------------------------------------------
  //
  // Everything below was missing. `endStreakRun` existed and `StreakEngine.increment` existed, but
  // nothing joined them: `currentStreak` was only ever written back to 0, `puzzleRating` never
  // ramped, and `pendingPuzzleId` had neither a writer nor a reader — so the anti-reroll lock that
  // Part 22.6 makes an acceptance criterion did not exist at all.

  /**
   * A correct Streak solve: advance the ramp, take the lock on the next puzzle, credit the goal.
   *
   * `nextPuzzleId` is the puzzle about to be served. Assigning it here IS the lock — leaving the
   * screen and coming back reads it straight back, so a hard puzzle cannot be rerolled.
   */
  function recordStreakSolve(state, nextPuzzleId, nowMs) {
    state.streak = STREAK.increment(state.streak, nextPuzzleId);
    recordSolve(state, 'streak', nowMs);
    return { state: state, streak: state.streak.currentStreak,
             target: STREAK.target(state.streak.currentStreak, state.streak.puzzleRating) };
  }

  /** The next puzzle's target rating and theme filter, straight from the pinned engine. */
  function streakTarget(state) {
    return STREAK.target(state.streak.currentStreak, state.streak.puzzleRating);
  }

  /** The locked puzzle, if a run is mid-flight. */
  function pendingStreakPuzzle(state) { return state.streak.pendingPuzzleId; }

  /** Take the lock without advancing the streak — used when a run serves its FIRST puzzle. */
  function lockStreakPuzzle(state, puzzleId) {
    state.streak.pendingPuzzleId = puzzleId;
    return state;
  }

  // ---- Thematic (Part 12.3) -----------------------------------------------------------------

  /**
   * A correct Thematic solve.
   *
   * Thematic **never touches Elo** — no `recordRatedAttempt`, no ledger row, no rating move. It
   * does update `ThemeStat`, so thematic practice still shows on the stats screen, and it does
   * credit the daily goal. Both were previously unreachable: `recordSolve` was only ever called
   * from the rated and daily paths, so a Streak or Thematic solve moved no counter at all.
   */
  function recordThematicAttempt(state, themes, isCorrect, nowMs) {
    bumpThemeStats(state, themes || [], isCorrect);
    var counted = false;
    if (isCorrect) counted = recordSolve(state, 'thematic', nowMs).counted;
    return { state: state, countedTowardGoal: counted };
  }

  // ---- Run history (Parts 13.1, 14.1) --------------------------------------------------------
  //
  // Both home screens replace a leaderboard with the user's own last ten runs. Sorted newest
  // first with an explicit tie-break, because Swift's sort is not stable and two runs can share a
  // millisecond.

  function recentStreakRuns(state, limit) {
    return state.streakRuns.slice()
      .sort(function (a, b) { return b.endedAt - a.endedAt || b.length - a.length; })
      .slice(0, limit == null ? 10 : limit);
  }

  function recentRushRuns(state, mode, limit) {
    return state.rushRuns.filter(function (r) { return r.mode === mode; })
      .sort(function (a, b) { return b.endedAt - a.endedAt || b.score - a.score; })
      .slice(0, limit == null ? 10 : limit);
  }

  function rushBestFor(state, mode) { return state.rushBest[String(mode)] || 0; }

  // ---- Streak and Turbo runs -------------------------------------------------------------------
  /**
   * Every Streak run ends here, so history and the best score cannot be skipped (fix #8).
   *
   * `bestBefore` is the best as it stood when the run STARTED, and it is required, not optional.
   * Without it `isNewBest` is unreachable-false: `StreakEngine.increment` raises `bestStreak` on
   * every solve, so by the time a record run ends `bestStreak` already equals `length` and
   * `length > bestStreak` is never true. The 🏆 NEW BEST badge could not appear at all.
   *
   * The comparison is `>=`, not `>`, and that is deliberate parity: the RN screen ends a run with
   * `currentStreak >= bestStreak`, so **equalling** your record shows 🏆 NEW BEST. Its `>=` was
   * compensating for the server having already bumped the row mid-run; taking `bestBefore` removes
   * the need for that compensation, but the user-visible rule — matching your best is celebrated —
   * is the app's behaviour and is kept. Recorded in PORTING_NOTES.md.
   */
  function endStreakRun(state, length, bestBefore, nowMs) {
    if (bestBefore == null) throw new Error('endStreakRun needs the best as it stood at run start');
    var isNewBest = length > 0 && length >= bestBefore;
    if (length > state.streak.bestStreak) state.streak.bestStreak = length;
    if (length > 0) state.streakRuns.push({ length: length, endedAt: nowMs });
    // Through the pinned engine rather than restated here — `reset` also preserves bestStreak,
    // which is the one thing a wrong move must not touch.
    state.streak = STREAK.reset(state.streak);
    // One source of truth: the badge reads THIS, never a separate inline expression.
    return { state: state, length: length, isNewBest: isNewBest, best: state.streak.bestStreak };
  }

  /**
   * Every Turbo run ends here — a finished clock, three mistakes, a manual quit, and
   * backgrounding all route through one function.
   *
   * Spec fixes #5, #6 and #13 are the same bug three times: the original ended timed runs on
   * background without saving the best score or writing history, always reported "Time's Up!"
   * whatever actually happened, and threw the score away entirely on quit. A single exit taking
   * the real reason fixes all three by construction.
   */
  function endRushRun(state, mode, score, mistakes, reason, nowMs) {
    if (RUSH_END_REASONS.indexOf(reason) < 0) {
      throw new Error('unknown rush end reason: ' + reason);
    }
    // Keyed by STRING, matching the Swift `[String: Int]` — JSON object keys are strings anyway,
    // so a numeric key here round-trips to a string and the two languages silently disagreed
    // about whether `rushBest[3]` and `rushBest["3"]` were the same slot.
    var key = String(mode);
    var prev = state.rushBest[key] || 0;
    var isNewBest = score > prev;
    if (isNewBest) state.rushBest[key] = score;
    // A scoreless run is not a run, the same rule `endStreakRun` applies to a zero-length streak.
    // Without it an instant quit pollutes the last-ten list on the mode-select screen.
    if (score > 0) {
      state.rushRuns.push({ mode: mode, score: score, mistakes: mistakes, endedAt: nowMs,
                            reason: reason });
    }
    if (mode === 0) state.rushDraft = null;
    return { state: state, score: score, mistakes: mistakes, reason: reason,
             isNewBest: isNewBest, best: state.rushBest[key] };
  }

  // ---- drafts (24-hour TTL) ----------------------------------------------------------------------
  function savePlayDraft(state, puzzleId, nowMs) {
    state.playDraft = { puzzleId: puzzleId, savedAt: nowMs };
    return state;
  }
  function loadPlayDraft(state, nowMs) {
    var d = state.playDraft;
    if (!d) return null;
    if (nowMs - d.savedAt > DRAFT_TTL_MS) { state.playDraft = null; return null; }
    return d;
  }
  function saveRushDraft(state, draft, nowMs) {
    state.rushDraft = { score: draft.score, mistakes: draft.mistakes,
                        targetRating: draft.targetRating, puzzlesServed: draft.puzzlesServed,
                        savedAt: nowMs };
    return state;
  }
  /**
   * Drop a saved draft.
   *
   * `endRushRun` already clears it for infinite mode, but "New Session" in the resume prompt needs
   * it too: without this, choosing a fresh run leaves the old draft in state, and a reload before
   * the new run ends would offer the stale one back.
   */
  function clearRushDraft(state) { state.rushDraft = null; }

  function loadRushDraft(state, nowMs) {
    var d = state.rushDraft;
    if (!d) return null;
    if (nowMs - d.savedAt > DRAFT_TTL_MS) { state.rushDraft = null; return null; }
    return d;
  }

  // ---- the seen set -------------------------------------------------------------------------------
  function seenSet(state) { return new Set(state.seen); }
  function commitSeen(state, set) { state.seen = Array.from(set).sort(function (a, b) { return a - b; }); }

  // ---- storage --------------------------------------------------------------------------------------
  function load(nowMs, storage) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return seed(nowMs);
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return seed(nowMs);
      var s = JSON.parse(raw);
      return (s && s.version === STATE_VERSION) ? s : seed(nowMs);
    } catch (e) { return seed(nowMs); }
  }
  function save(state, storage) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!storage) return false;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }

  return {
    STORAGE_KEY: STORAGE_KEY, STATE_VERSION: STATE_VERSION, DAILY_TARGET: DAILY_TARGET,
    RUSH_MODES: RUSH_MODES, RUSH_END_REASONS: RUSH_END_REASONS,
    DRAFT_TTL_MS: DRAFT_TTL_MS, DEFAULT_RATING: DEFAULT_RATING,
    dayKey: dayKey, dayNumber: dayNumber, keyOfDayNumber: keyOfDayNumber,
    seed: seed, attemptFor: attemptFor, recordRatedAttempt: recordRatedAttempt,
    bumpThemeStats: bumpThemeStats, ratingHistory: ratingHistory,
    recordSolve: recordSolve, goalStreakDays: goalStreakDays, dailyGoalStatus: dailyGoalStatus,
    recordDailyPuzzleSolve: recordDailyPuzzleSolve,
    recordStreakSolve: recordStreakSolve, streakTarget: streakTarget,
    pendingStreakPuzzle: pendingStreakPuzzle, lockStreakPuzzle: lockStreakPuzzle,
    recordThematicAttempt: recordThematicAttempt,
    recentStreakRuns: recentStreakRuns, recentRushRuns: recentRushRuns,
    rushBestFor: rushBestFor,
    endStreakRun: endStreakRun, endRushRun: endRushRun,
    savePlayDraft: savePlayDraft, loadPlayDraft: loadPlayDraft,
    saveRushDraft: saveRushDraft, loadRushDraft: loadRushDraft,
    clearRushDraft: clearRushDraft,
    seenSet: seenSet, commitSeen: commitSeen, load: load, save: save,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BiyaPuzzleProgress;
