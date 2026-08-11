/* turbo-run.js — Puzzle Turbo's run state and difficulty ramp (spec Part 14.2).
 *
 * Twin of `Sources/BiyaherongCoachCore/TurboRun.swift`.
 *
 * ── Why this is a separate engine ────────────────────────────────────────────
 * `PuzzleSession` is a PER-PUZZLE state machine and a new one is created for every puzzle, so its
 * `mistakes` counter resets each time. Turbo's three lives, its running target rating and its
 * score all span the run, and nothing owned them. `PuzzleRush` held only `modes`, `bestScore` and
 * `modeLabel`; the whole of Part 14.2 existed nowhere in either language.
 *
 * ── The clock is deliberately NOT in here ────────────────────────────────────
 * `secondsLeft` is derived from a start timestamp, never accumulated from ticks — the same rule
 * the rated timer follows, so a dropped or delayed tick cannot make the clock drift. The engine
 * holds `startedAt` and answers the question; the view owns only the `setInterval`.
 *
 * ── The curve, and how it differs from Streak's ──────────────────────────────
 * Every constant below comes from `tools/metrics/puzzle_styles.json`
 * (`screens.turboRun.moduleConstants`), extracted from the RN source rather than typed from the
 * spec. Two of them are easy to get wrong from memory:
 *   * the warmup is **5** puzzles, where Streak's is 10;
 *   * a wrong answer still moves the target **UP**, by 10. It is a rush: the run gets harder
 *     whatever you do, just more slowly when you miss.
 */
'use strict';

var BiyaTurboRun = (function () {

  // Part 14.2, verbatim from the extraction.
  var MAX_MISTAKES = 3;
  var WARMUP_COUNT = 5;              // Streak uses 10
  var WARMUP_RATING = 600;
  var WARMUP_THEME = 'mateIn1';
  var DIFFICULTY_START_MAX = 800;
  var DIFFICULTY_START_MIN = 400;
  var DIFFICULTY_START_OFFSET = 500; // start = clamp(rating - 500, 400, 800)
  var STEP_CORRECT = 50;
  var STEP_WRONG = 10;               // still UP, not down
  var DIFFICULTY_MAX = 2500;

  /** Seconds per mode. 0 is the infinite sentinel — no clock at all. */
  var SECONDS = { 0: 0, 3: 180, 5: 300 };

  /** Why a run ended. Mirrors `PuzzleProgress.RUSH_END_REASONS` and the Swift enum. */
  var REASON = {
    timeUp: 'timeUp', threeMistakes: 'threeMistakes',
    quit: 'quit', backgrounded: 'backgrounded', finished: 'finished',
  };

  /**
   * A new run.
   *
   * `startedAt` is null until the FIRST puzzle appears — Part 14.2 is explicit that the clock does
   * not run during loading, which would otherwise silently cost a second or two of every run.
   */
  function start(profileRating, mode) {
    var t = Math.min(DIFFICULTY_START_MAX,
                     Math.max(DIFFICULTY_START_MIN, profileRating - DIFFICULTY_START_OFFSET));
    return {
      mode: mode,
      score: 0,
      mistakes: 0,
      targetRating: t,
      puzzlesServed: 0,
      startedAt: null,
      endedAt: null,
      reason: null,
    };
  }

  /** Restore an infinite-mode draft. The clock is irrelevant: mode 0 has none. */
  function resume(draft) {
    return {
      mode: 0,
      score: draft.score,
      mistakes: draft.mistakes,
      targetRating: draft.targetRating,
      puzzlesServed: draft.puzzlesServed,
      startedAt: null,
      endedAt: null,
      reason: null,
    };
  }

  /** The draft shape `PuzzleProgress.saveRushDraft` persists. */
  function draftOf(state) {
    return { score: state.score, mistakes: state.mistakes,
             targetRating: state.targetRating, puzzlesServed: state.puzzlesServed };
  }

  /**
   * What to ask the store for next.
   *
   * The first five puzzles are forced mate-in-1s at 600. Unlike Streak, the ramp does NOT run
   * underneath the warmup — `targetRating` only moves on a solve or a miss, and during warmup the
   * served rating ignores it entirely.
   */
  function target(state) {
    var isWarmup = state.puzzlesServed < WARMUP_COUNT;
    return { rating: isWarmup ? WARMUP_RATING : state.targetRating,
             theme: isWarmup ? WARMUP_THEME : null };
  }

  /**
   * Count a puzzle as served, and start the clock on the first one of this sitting.
   *
   * The guard is `startedAt == null` and nothing else. An earlier version also required
   * `puzzlesServed === 1`, which is redundant on a fresh run — and wrong on a resumed one, where
   * `puzzlesServed` picks up mid-count, so the clock would never have started at all. The mutation
   * suite caught it: the extra clause changed no observable behaviour today only because resume is
   * infinite-only, i.e. it was a trap armed for whoever extended resume to a timed mode.
   */
  function served(state, nowMs) {
    var s = clone(state);
    s.puzzlesServed += 1;
    if (s.startedAt == null) s.startedAt = nowMs;
    return s;
  }

  function solved(state) {
    var s = clone(state);
    s.score += 1;
    s.targetRating = Math.min(DIFFICULTY_MAX, s.targetRating + STEP_CORRECT);
    return s;
  }

  /** A miss costs a life — and still nudges the difficulty UP, by 10. */
  function missed(state) {
    var s = clone(state);
    s.mistakes += 1;
    s.targetRating = Math.min(DIFFICULTY_MAX, s.targetRating + STEP_WRONG);
    return s;
  }

  function livesLeft(state) { return Math.max(0, MAX_MISTAKES - state.mistakes); }
  function outOfLives(state) { return state.mistakes >= MAX_MISTAKES; }

  /** Total seconds for a mode; 0 means infinite. */
  function totalSeconds(mode) { return SECONDS[mode] || 0; }

  /**
   * Seconds remaining, from the clock rather than from a tick count.
   *
   * `null` in infinite mode and before the first puzzle appears — the caller renders `∞` or holds
   * the initial value rather than showing a running clock that has not started.
   */
  function secondsLeft(state, nowMs) {
    var total = totalSeconds(state.mode);
    if (!total) return null;
    if (state.startedAt == null) return total;
    var gone = Math.floor((nowMs - state.startedAt) / 1000);
    return Math.max(0, total - gone);
  }

  function timeUp(state, nowMs) {
    var left = secondsLeft(state, nowMs);
    return left !== null && left <= 0 && state.startedAt != null;
  }

  /**
   * Why the run should end right now, or `null` to keep going.
   *
   * One place, so the results screen cannot fall back to "Time's Up!" the way the original did
   * (spec fix #6) — it always has the real reason.
   */
  function endReason(state, nowMs) {
    if (outOfLives(state)) return REASON.threeMistakes;
    if (timeUp(state, nowMs)) return REASON.timeUp;
    return null;
  }

  /**
   * Close a run. Every ending goes through here, whatever triggered it (fixes #5, #6, #13).
   *
   * **Idempotent.** A real sequence is: the clock expires, the screen ends the run and navigates,
   * and the navigation then calls `leave()` which ends it again as a quit. Without this guard that
   * writes two history rows and relabels a timed-out run "Run Ended". The FIRST reason wins,
   * because it is the one that actually happened.
   */
  function end(state, reason, nowMs) {
    if (state.reason != null) return state;
    var s = clone(state);
    s.reason = reason;
    s.endedAt = nowMs;
    return s;
  }

  /** Has this run already been closed? The screen's guard against ending it twice. */
  function isOver(state) { return state.reason != null; }

  /**
   * The run clock as Turbo prints it: `M:SS`, minutes NOT zero-padded.
   *
   * Deliberately not `PuzzleMetrics.formatTime`, which pads to `MM:SS` for the rated timer. Turbo
   * shows `3:00` and `0:07`; the rated screen shows `03:00`. Reusing one would silently change one
   * of the two screens.
   */
  function formatClock(seconds) {
    if (seconds == null) return '∞';
    var m = Math.floor(seconds / 60), sec = seconds % 60;
    return m + ':' + (sec < 10 ? '0' + sec : String(sec));
  }

  /** Part 14.4's results title, from the REAL reason rather than a constant. */
  function resultTitle(reason, isNewBest) {
    if (isNewBest) return 'New Best Score!';
    if (reason === REASON.timeUp) return "Time's Up!";
    if (reason === REASON.threeMistakes) return 'Out of Lives!';
    return 'Run Ended';
  }

  function clone(s) {
    return { mode: s.mode, score: s.score, mistakes: s.mistakes, targetRating: s.targetRating,
             puzzlesServed: s.puzzlesServed, startedAt: s.startedAt, endedAt: s.endedAt,
             reason: s.reason };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function e(c, w) { c ? passed++ : failures.push(w); }

    // ---- the starting target ---------------------------------------------------
    e(start(1200, 3).targetRating === 700, 'a default 1200 player starts at 700');
    e(start(2000, 3).targetRating === 800, 'a strong player is capped at 800');
    e(start(800, 3).targetRating === 400, 'a weak player floors at 400');
    e(start(400, 3).targetRating === 400, 'and cannot go below it');
    e(start(1300, 0).targetRating === 800, '1300 - 500 is exactly the cap');
    e(start(1200, 3).score === 0 && start(1200, 3).mistakes === 0, 'a run starts empty');
    e(start(1200, 3).startedAt === null,
      'and the clock has not started — Part 14.2: not during loading');

    // ---- the warmup ------------------------------------------------------------
    var s = start(1200, 3);
    for (var i = 0; i < WARMUP_COUNT; i++) {
      var t = target(s);
      e(t.rating === WARMUP_RATING, 'warmup puzzle ' + i + ' is served at 600');
      e(t.theme === WARMUP_THEME, 'warmup puzzle ' + i + ' is a mate-in-1');
      s = served(s, 1000 + i);
      s = solved(s);
    }
    e(s.puzzlesServed === 5, 'the warmup is FIVE puzzles — Streak is the one that uses ten');
    var after = target(s);
    e(after.theme === null, 'after five, the theme filter drops');
    // Unlike Streak, Turbo's ramp does NOT run beneath the warmup — but solves during it still
    // count, so the target has moved by 5 x 50 from the start.
    e(after.rating === 700 + 5 * STEP_CORRECT, 'and the target is 950: ' + after.rating);

    // ---- the ramp --------------------------------------------------------------
    var r = start(1200, 0);
    e(solved(r).targetRating === 750, 'a solve adds 50');
    e(missed(r).targetRating === 710, 'a MISS adds 10 — it still goes UP');
    e(missed(r).targetRating > r.targetRating,
      'which is the counter-intuitive bit: a rush only gets harder');
    e(solved(r).score === 1 && solved(r).mistakes === 0, 'a solve scores');
    e(missed(r).score === 0 && missed(r).mistakes === 1, 'a miss costs a life, not a point');
    var high = start(1200, 0);
    high.targetRating = DIFFICULTY_MAX;
    e(solved(high).targetRating === DIFFICULTY_MAX, 'the ramp caps at 2500 on a solve');
    e(missed(high).targetRating === DIFFICULTY_MAX, 'and on a miss');
    var near = start(1200, 0);
    near.targetRating = DIFFICULTY_MAX - 5;
    e(solved(near).targetRating === DIFFICULTY_MAX, 'clamping, not overshooting');
    // Purity.
    var before = start(1200, 0);
    solved(before); missed(before); served(before, 1);
    e(before.score === 0 && before.mistakes === 0 && before.puzzlesServed === 0,
      'every transition returns a new state and mutates nothing');

    // ---- lives -----------------------------------------------------------------
    var l = start(1200, 0);
    e(livesLeft(l) === 3 && !outOfLives(l), 'three lives to start');
    l = missed(l); e(livesLeft(l) === 2 && !outOfLives(l), 'two after one miss');
    l = missed(l); e(livesLeft(l) === 1 && !outOfLives(l), 'one after two');
    l = missed(l); e(livesLeft(l) === 0 && outOfLives(l), 'and out after three');
    e(endReason(l, 0) === REASON.threeMistakes, 'which ends the run for the right reason');
    e(livesLeft(missed(l)) === 0, 'lives never go negative');

    // ---- the clock -------------------------------------------------------------
    e(totalSeconds(3) === 180 && totalSeconds(5) === 300, '3 min and 5 min');
    e(totalSeconds(0) === 0, 'infinite has no total');
    var c = start(1200, 3);
    e(secondsLeft(c, 5000) === 180, 'before the first puzzle the clock reads full');
    c = served(c, 10000);
    e(c.startedAt === 10000, 'the clock starts when the first puzzle appears');
    e(secondsLeft(c, 10000) === 180, 'at zero elapsed');
    e(secondsLeft(c, 10999) === 180,
      'the first second reads 180 for its whole duration — the RN timer decrements on the TICK, '
      + 'so flooring the remainder instead of the elapsed would show 179 after one millisecond');
    e(secondsLeft(c, 11000) === 179, 'and 179 exactly on the second');
    e(secondsLeft(c, 10000 + 179000) === 1, 'near the end');
    e(secondsLeft(c, 10000 + 180000) === 0, 'and at the end');
    e(secondsLeft(c, 10000 + 999000) === 0, 'never negative');
    // Derived from the clock, so a gap between ticks cannot lose time.
    e(secondsLeft(c, 10000 + 60000) === 120,
      'a 60s jump with no ticks still reads 120 — the clock is wall-derived, not accumulated');
    c = served(c, 99999);
    // A resumed run picks `puzzlesServed` up mid-count, so the clock must key off `startedAt`.
    var resumed = served(resume({ score: 9, mistakes: 1, targetRating: 900, puzzlesServed: 11 }),
                         4242);
    e(resumed.startedAt === 4242, 'a resumed run still starts its clock on the next puzzle');
    e(resumed.puzzlesServed === 12, 'and keeps counting from where it left off');
    e(served(resumed, 9999).startedAt === 4242, 'which then does not restart');
    e(c.startedAt === 10000, 'and the second puzzle does not restart it');
    var inf = served(start(1200, 0), 10000);
    e(secondsLeft(inf, 999999) === null, 'infinite mode has no countdown');
    e(!timeUp(inf, 999999), 'and never times out');
    e(endReason(inf, 999999) === null, 'so it only ends on lives, quit or backgrounding');
    e(timeUp(c, 10000 + 180000), 'a timed run times out');
    e(endReason(c, 10000 + 180000) === REASON.timeUp, 'for the right reason');
    var notStarted = start(1200, 3);
    e(!timeUp(notStarted, 999999999),
      'a run whose first puzzle never appeared cannot time out');

    // Three mistakes beats the clock when both are true — losing your lives is what happened.
    var both = served(start(1200, 3), 0);
    both = missed(missed(missed(both)));
    e(endReason(both, 999999) === REASON.threeMistakes,
      'out of lives takes precedence over a simultaneous timeout');

    // ---- ending ------------------------------------------------------------------
    var done = end(served(start(1200, 3), 0), REASON.quit, 5000);
    e(done.reason === REASON.quit && done.endedAt === 5000, 'end records the reason and the time');
    e(isOver(done) && !isOver(start(1200, 3)), 'isOver reports a closed run');
    // Idempotent: expire -> end -> navigate -> leave() -> end again. The first reason wins.
    var twice = end(done, REASON.quit, 9999);
    e(twice.reason === REASON.quit && twice.endedAt === 5000,
      'ending a closed run changes nothing — otherwise leave() would write a second history row');
    var expired = end(served(start(1200, 3), 0), REASON.timeUp, 1000);
    e(end(expired, REASON.quit, 2000).reason === REASON.timeUp,
      'and a later quit cannot relabel a run that timed out');

    // ---- the clock as Turbo prints it -------------------------------------------
    e(formatClock(180) === '3:00', 'three minutes, minutes NOT zero-padded');
    e(formatClock(7) === '0:07', 'seconds ARE padded');
    e(formatClock(0) === '0:00', 'zero');
    e(formatClock(300) === '5:00', 'five minutes');
    e(formatClock(59) === '0:59', 'under a minute');
    e(formatClock(null) === '∞', 'infinite mode shows the sentinel, not a clock');
    e(Object.keys(REASON).length === 5, 'five reasons, matching the Swift enum');

    // ---- the results title (spec fix #6) -------------------------------------------
    e(resultTitle(REASON.timeUp, false) === "Time's Up!", 'the clock ran out');
    e(resultTitle(REASON.threeMistakes, false) === 'Out of Lives!',
      'three mistakes is NOT "Time`s Up!" — that was the original bug');
    e(resultTitle(REASON.quit, false) === 'Run Ended', 'a quit');
    e(resultTitle(REASON.backgrounded, false) === 'Run Ended', 'and a background');
    e(resultTitle(REASON.timeUp, true) === 'New Best Score!', 'a new best overrides all of them');
    e(resultTitle(REASON.threeMistakes, true) === 'New Best Score!', 'whatever ended the run');

    // ---- the draft shape ------------------------------------------------------------
    var d = draftOf(missed(solved(served(start(1200, 0), 0))));
    e(d.score === 1 && d.mistakes === 1 && d.puzzlesServed === 1,
      'the draft carries the run counters');
    e(d.targetRating === 760, 'and the live target: 700 + 50 - then +10');
    e(d.startedAt === undefined, 'but not the clock — infinite mode has none');
    var back = resume(d);
    e(back.score === 1 && back.mistakes === 1 && back.targetRating === 760
      && back.puzzlesServed === 1, 'and resuming restores all four');
    e(back.mode === 0, 'a resumed run is always infinite — timed modes never prompt');
    // `puzzlesServed` is what decides the warmup, so a resumed run picks it up exactly where it
    // left off rather than restarting the five mate-in-1s or skipping them.
    e(target(back).theme === WARMUP_THEME,
      'a run resumed one puzzle in is still in warmup');
    var late = resume({ score: 20, mistakes: 1, targetRating: 1400, puzzlesServed: 21 });
    e(target(late).theme === null, 'and one resumed past five is not');
    e(target(late).rating === 1400, 'serving at its stored target');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'TurboRun: ' + passed + ' assertions passed'
        : 'TurboRun: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n'),
    };
  }

  return {
    MAX_MISTAKES: MAX_MISTAKES, WARMUP_COUNT: WARMUP_COUNT, WARMUP_RATING: WARMUP_RATING,
    WARMUP_THEME: WARMUP_THEME, DIFFICULTY_START_MAX: DIFFICULTY_START_MAX,
    DIFFICULTY_START_MIN: DIFFICULTY_START_MIN, DIFFICULTY_START_OFFSET: DIFFICULTY_START_OFFSET,
    STEP_CORRECT: STEP_CORRECT, STEP_WRONG: STEP_WRONG, DIFFICULTY_MAX: DIFFICULTY_MAX,
    SECONDS: SECONDS, REASON: REASON,
    start: start, resume: resume, draftOf: draftOf, target: target, served: served,
    solved: solved, missed: missed, livesLeft: livesLeft, outOfLives: outOfLives,
    totalSeconds: totalSeconds, secondsLeft: secondsLeft, timeUp: timeUp,
    endReason: endReason, end: end, isOver: isOver, formatClock: formatClock,
    resultTitle: resultTitle, selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaTurboRun; }
