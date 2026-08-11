#!/usr/bin/env node
/*
 * puzzle_core_mutation_test.js — does `puzzle_core_test.js` actually catch anything?
 *
 *     node tools/qa/puzzle_core_mutation_test.js
 *
 * A suite of 338 assertions that passes tells you nothing on its own. Each mutant below is a
 * plausible way one of the three pure modules could be wrong — several are the ORIGINAL server
 * bugs the spec's Part 20 asks us to fix, reintroduced verbatim. Every one must be killed.
 *
 * Text substitution on a copy of the source, then the suite runs against the copy. Crude, but it
 * needs no build step and it mutates the real file rather than a model of it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
// Swift screens live elsewhere. A mutant naming a `.swift` file resolves against this instead, so
// one MUTANTS table covers both languages.
const SWIFT_DIR = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const dirFor = (f) => (f.endsWith('.swift') ? SWIFT_DIR : JS);

// [name, file, find, replace, why]
/**
 * One mutant was REMOVED rather than left surviving, and the reason is worth keeping.
 *
 * `isNewBest = length >= bestBefore` vs `length >= state.streak.bestStreak` are **provably
 * equivalent**. After a run, `bestStreak === max(bestBefore, length)`, and
 * `length >= max(b, length)` is true exactly when `length >= b`. Under the old `>` comparison the
 * two differed — that difference was the dead-badge bug — but `>=` collapses them.
 *
 * `bestBefore` is kept anyway: it does not depend on `increment` raising `bestStreak` to exactly
 * that maximum, so it survives a change to the ramp that the live read would not. A mutant that
 * cannot fail is noise in a suite whose value is that every entry means something.
 */
const MUTANTS = [
  ['session: moves[0] is the solver\'s', 'puzzle-session.js',
   'moveIndex: 1,                       // 5.1', 'moveIndex: 0,                       // 5.1',
   'the Part 5.1 convention off by one'],
  ['session: userColor is the side to move', 'puzzle-session.js',
   'userColor: E.opponent(pos.sideToMove),', 'userColor: pos.sideToMove,',
   'the solver would sit at the wrong end of a flipped board'],
  ['session: no checkmate short-circuit', 'puzzle-session.js',
   "if (E.status(next) === 'checkmate') {", 'if (false) {',
   'the "I mated him but the app said wrong" bug'],
  ['session: solved-when off by one', 'puzzle-session.js',
   'if (s.moveIndex >= s.puzzle.moves.length - 1) {', 'if (s.moveIndex >= s.puzzle.moves.length) {',
   'the last move would never finish the puzzle'],
  ['session: Turbo undoes the wrong move', 'puzzle-session.js',
   'turbo:    { undo: false,', 'turbo:    { undo: true, ',
   'Part 5.5 — Turbo deliberately leaves the piece on the wrong square'],
  ['session: Daily needs an explicit retry', 'puzzle-session.js',
   'daily:    { undo: true,  staysPlayable: true,', 'daily:    { undo: true,  staysPlayable: false,',
   'Daily has unlimited retries with no Retry button'],
  ['session: Streak does not end the run', 'puzzle-session.js',
   'streak:   { undo: true,  staysPlayable: false, endsRun: true,',
   'streak:   { undo: true,  staysPlayable: false, endsRun: false,',
   'a Streak wrong move ends the run immediately'],
  ['session: Turbo counts toward the daily goal', 'puzzle-session.js',
   "return mode !== 'turbo';", 'return true;',
   'Part 15.1 — a 3-minute run would make a 10-a-day goal meaningless'],
  ['session: Daily opponent delay is 500', 'puzzle-session.js',
   'daily: 400,', 'daily: 500,',
   'Part 17 gives Daily 400 ms where Part 5.3 says 500'],
  ['session: retry does not restart the clock', 'puzzle-session.js',
   'return { restartClock: true,', 'return { restartClock: false,',
   'fix (a): a post-retry solve reported time since the FIRST attempt'],
  ['session: retry skips the game-start sound', 'puzzle-session.js',
   "sound: 'game-start',\n             setupAfterMs", "sound: null,\n             setupAfterMs",
   'fix (b): the original skipped it on retry'],
  ['session: promotion ignores the rank', 'puzzle-session.js',
   'return (p.color === E.WHITE && rank === 7) || (p.color === E.BLACK && rank === 0);',
   'return false;',
   'the promotion dialog would never open'],
  ['session: PGN has no terminator', 'puzzle-session.js',
   "return out.join(' ') + ' *';", "return out.join(' ');",
   'Part 10.3 requires the ` *` terminator'],

  ['store: Tier-3 wipes everything', 'puzzle-store.js',
   "if (theme != null) return { kind: 'theme', theme: theme };", '',
   'spec fix #7 — the server wiped the ENTIRE seen set when one query ran dry'],
  ['store: no double modulo', 'puzzle-store.js',
   'return ((n % poolCount) + poolCount) % poolCount;', 'return n % poolCount;',
   'a date before the epoch would index negatively'],
  ['store: the day number is UTC', 'puzzle-store.js',
   'Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())',
   'Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())',
   'spec fix #1 — in Manila the day rolled over at 8 a.m.'],
  ['store: rated window is +-50', 'puzzle-store.js',
   'return serve(SERVE.serveRandom, userRating, SERVE.REGULAR_WINDOW, null);',
   'return serve(SERVE.serveRandom, userRating, SERVE.STREAK_WINDOW, null);',
   'Part 7.2 — rated is +-100'],
  ['store: serving does not mark seen', 'puzzle-store.js',
   'if (sel.candidate) seen.add(sel.candidate.id);', '',
   'the same puzzle would be served twice in a row'],
  ['store: the daily puzzle is marked seen', 'puzzle-store.js',
   'var idx = dailyIndex(date, daily.length);',
   'var idx = dailyIndex(date, daily.length); seen.add(daily[idx]);',
   "today's puzzle would vanish from every other mode"],

  ['serving: streak tier 2 is random', 'puzzle-serving.js',
   'var near = closestByAbs(s2, center, theme);', 'var near = pick(s2);',
   'the three ladders genuinely differ; this is the pinned one'],
  ['serving: ABS ties break on the higher id', 'puzzle-serving.js',
   '(d === bd && c.id < best.id)', '(d === bd && c.id > best.id)',
   'the tie-break is what makes the ladder deterministic'],
  ['serving: window is exclusive', 'puzzle-serving.js',
   'return c.rating >= lo && c.rating <= hi', 'return c.rating > lo && c.rating < hi',
   'whereBetween is inclusive at both ends'],

  ['progress: a replay re-rates', 'puzzle-progress.js',
   'if (existing) {', 'if (false) {',
   'Part 8 — the first rated attempt decides, forever'],
  ['progress: highestRating tracks every change', 'puzzle-progress.js',
   'if (out.newRating > state.profile.highestRating)', 'if (true)',
   'a fall must not lower the high-water mark'],
  ['progress: history takes the oldest', 'puzzle-progress.js',
   'return a.solvedAt !== b.solvedAt ? b.solvedAt - a.solvedAt : b.puzzleId - a.puzzleId;',
   'return a.solvedAt !== b.solvedAt ? a.solvedAt - b.solvedAt : a.puzzleId - b.puzzleId;',
   'spec fix #9 — the server took `orderBy asc, take 30`'],
  ['progress: goal streak anchors only to today', 'puzzle-progress.js',
   'var check = (days.indexOf(today) >= 0) ? today : today - 1;', 'var check = today;',
   'the streak must survive until the end of the following day'],
  ['progress: a gap does not break the streak', 'puzzle-progress.js',
   'else if (days[i] < check) break;', 'else if (days[i] < check) check = days[i] - 1;',
   'a missed day breaks it'],
  ['progress: wrong answers earn goal credit', 'puzzle-progress.js',
   "if (p.isCorrect) counted = recordSolve(state, 'play', nowMs).counted;",
   "counted = recordSolve(state, 'play', nowMs).counted;",
   'Part 15.1 counts CORRECT solves'],
  ['progress: ThemeStat solved always increments', 'puzzle-progress.js',
   'if (isCorrect) s.solved += 1;', 's.solved += 1;',
   'attempted +1 always, solved +1 only when correct'],
  ['progress: the rating floor is gone', 'puzzle-progress.js',
   'state.profile.rating = out.newRating;', 'state.profile.rating = before + out.ratingChange;',
   'Part 8 floors at 400 (the floor lives inside the pinned engine)'],
  ['progress: drafts never expire', 'puzzle-progress.js',
   'if (nowMs - d.savedAt > DRAFT_TTL_MS) { state.playDraft = null; return null; }', '',
   'a 24-hour TTL, per Part 17'],
  ['progress: the daily puzzle double-counts', 'puzzle-progress.js',
   "if (state.daily.lastSolvedDay === today) {", 'if (false) {',
   'solving twice in one day must not double the streak'],
  ['progress: a worse rush run lowers the best', 'puzzle-progress.js',
   'var isNewBest = score > prev;', 'var isNewBest = true;',
   'PuzzleRush.bestScore keeps the maximum'],
  ['progress: a zero-length streak is history', 'puzzle-progress.js',
   'if (length > 0) state.streakRuns.push', 'if (true) state.streakRuns.push',
   'an immediate loss is not a run'],
  // --- the gaps Phase D closed -------------------------------------------------------
  ['streak: the ramp waits for the warmup to end', 'streak-engine.js',
   'puzzleRating: Math.min(RATING_MAX, state.puzzleRating + RATING_STEP),',
   'puzzleRating: state.currentStreak < WARMUP_COUNT ? state.puzzleRating : Math.min(RATING_MAX, state.puzzleRating + RATING_STEP),',
   'Part 13.2 — the ramp runs from puzzle #1, so puzzle 11 lands at 1100. That cliff is the mode'],
  ['streak: the ramp has no ceiling', 'streak-engine.js',
   'Math.min(RATING_MAX, state.puzzleRating + RATING_STEP)',
   'state.puzzleRating + RATING_STEP',
   'capped at 2500'],
  ['streak: a loss wipes the best', 'streak-engine.js',
   'return { currentStreak: 0, bestStreak: state.bestStreak,',
   'return { currentStreak: 0, bestStreak: 0,',
   'bestStreak is the one thing a wrong move must not touch'],
  ['streak: the warmup is 5 not 10', 'streak-engine.js',
   'var WARMUP_COUNT = 10;', 'var WARMUP_COUNT = 5;',
   'Streak warms up over 10; Turbo is the one that uses 5'],
  ['progress: a Streak solve never takes the lock', 'puzzle-progress.js',
   'state.streak = STREAK.increment(state.streak, nextPuzzleId);',
   'state.streak = STREAK.increment(state.streak, null);',
   'Part 22.6 — leaving and re-entering must return the identical puzzle'],
  ['progress: Thematic moves the rating', 'puzzle-progress.js',
   'function recordThematicAttempt(state, themes, isCorrect, nowMs) {',
   'function recordThematicAttempt(state, themes, isCorrect, nowMs) { state.profile.rating += 1;',
   'Thematic never touches Elo'],
  ['progress: Streak solves do not credit the goal', 'puzzle-progress.js',
   "recordSolve(state, 'streak', nowMs);", '',
   'Part 15.1 counts Play, Daily, Thematic and Streak'],
  ['progress: run history is unfiltered by mode', 'puzzle-progress.js',
   'return state.rushRuns.filter(function (r) { return r.mode === mode; })',
   'return state.rushRuns.slice()',
   'each Turbo mode has its own Recent Runs list'],
  ['metrics: the bottom panel ignores the mode', 'puzzle-metrics.js',
   'if (!policy.offersRetry) return { buttons: [], row: false };',
   '',
   'Streak and Turbo forbid a Retry — this is the bug the mode argument exists to prevent'],
  ['metrics: one promotion scrim for every mode', 'puzzle-metrics.js',
   "return (mode === 'streak' || mode === 'turbo') ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.8)';",
   "return 'rgba(0,0,0,0.8)';",
   'Streak and Turbo dim harder, per Part 2'],
  ['metrics: Daily gets an engine panel', 'puzzle-metrics.js',
   "function hasEnginePanel(mode) { return mode === 'play' || mode === 'thematic' || mode == null; }",
   'function hasEnginePanel(mode) { return true; }',
   'only playSolver and thematicSolver have enginePanel keys in the source'],
  ['metrics: Thematic shows two engine lines', 'puzzle-metrics.js',
   "return mode === 'thematic' ? ENGINE.thematicLines : ENGINE.playLines;",
   'return ENGINE.playLines;',
   'Part 18 — Play shows 2, Thematic 3'],

  ['progress: the seen set serialises unsorted', 'puzzle-progress.js',
   'state.seen = Array.from(set).sort(function (a, b) { return a - b; });',
   'state.seen = Array.from(set);',
   'an unstable order churns the saved file on every write'],
  // --- Puzzle Turbo, Part 14.2. Every one of these targets a rule that reads WRONG at a glance.
  ['turbo: a miss lowers the target', 'turbo-run.js',
   's.targetRating = Math.min(DIFFICULTY_MAX, s.targetRating + STEP_WRONG);',
   's.targetRating = Math.max(0, s.targetRating - STEP_WRONG);',
   'Part 14.2 — a rush gets harder whatever you do, just more slowly when you miss'],
  ['turbo: warmup borrowed from Streak', 'turbo-run.js',
   'var WARMUP_COUNT = 5;', 'var WARMUP_COUNT = 10;',
   'Turbo warms up over 5 puzzles where StreakEngine takes 10'],
  ['turbo: no difficulty ceiling', 'turbo-run.js',
   's.targetRating = Math.min(DIFFICULTY_MAX, s.targetRating + STEP_CORRECT);',
   's.targetRating = s.targetRating + STEP_CORRECT;',
   'a long run would ask for puzzles harder than the corpus holds'],
  ['turbo: four lives', 'turbo-run.js', 'var MAX_MISTAKES = 3;', 'var MAX_MISTAKES = 4;',
   'three mistakes end a run'],
  ['turbo: the clock beats the lives', 'turbo-run.js',
   'if (outOfLives(state)) return REASON.threeMistakes;',
   'if (timeUp(state, nowMs)) return REASON.timeUp;',
   'losing your last life is what happened, even if the clock expired in the same instant'],
  ['turbo: end() is not idempotent', 'turbo-run.js',
   'if (state.reason != null) return state;', 'if (false) return state;',
   'a clock expiry plus a navigation would write two history rows and relabel the run'],
  ['turbo: the clock counts from now', 'turbo-run.js',
   'var gone = Math.floor((nowMs - state.startedAt) / 1000);',
   'var gone = Math.ceil((nowMs - state.startedAt) / 1000);',
   'flooring the elapsed is what makes the remaining ceiling — 0:01 must not read 0:00'],
  ['turbo: the clock restarts every puzzle', 'turbo-run.js',
   'if (s.startedAt == null) s.startedAt = nowMs;', 's.startedAt = nowMs;',
   'a 3-minute run would never end — the clock would reset on every mount'],
  ['turbo: padded minutes', 'turbo-run.js',
   "return m + ':' + (sec < 10 ? '0' + sec : String(sec));",
   "return (m < 10 ? '0' + m : String(m)) + ':' + (sec < 10 ? '0' + sec : String(sec));",
   'Turbo shows 3:00 where the rated timer shows 03:00 — one function would break one screen'],
  ['turbo: results always blame the clock', 'turbo-run.js',
   "if (reason === REASON.threeMistakes) return 'Out of Lives!';",
   "if (false) return 'Out of Lives!';",
   'spec fix #6 — the original said "Time`s Up!" however the run actually ended'],
  ['turbo: the feedback dot`s left sign', 'puzzle-metrics.js',
   'leftSign: -1, leftFactor: 1.4,', 'leftSign: 1, leftFactor: 1.4,',
   'the sign bug that once shipped the annotation badge in the wrong corner'],
  ['turbo: the feedback dot`s top sign', 'puzzle-metrics.js',
   'topSign: 1, topFactor: 0.4,', 'topSign: -1, topFactor: 0.4,',
   'ditto, in the other axis'],
  ['turbo: the clock`s red band', 'puzzle-metrics.js',
   "if (secondsLeft <= 10) return '#FF4444';", "if (secondsLeft < 10) return '#FF4444';",
   'at exactly 10 seconds the clock is already red'],
  ['turbo: infinite is not the default', 'puzzle-metrics.js',
   'var TURBO_DEFAULT_MODE = 3;', 'var TURBO_DEFAULT_MODE = 0;',
   'Part 14.1 opens on the 3-minute tab'],

  // --- Streak
  ['streak: matching your best is not celebrated', 'puzzle-progress.js',
   'var isNewBest = length > 0 && length >= bestBefore;',
   'var isNewBest = length > 0 && length > bestBefore;',
   'the RN screen shows the badge on a TIE — equalling your record counts'],
  ['streak: the reveal is one colour', 'puzzle-metrics.js',
   "solutionFromTint: 'rgba(253,176,34,0.65)', solutionToTint: 'rgba(253,176,34,0.95)',",
   "solutionFromTint: 'rgba(253,176,34,0.95)', solutionToTint: 'rgba(253,176,34,0.95)',",
   'the revealed move has to read as a direction, not a pair'],
  // --- Phase F: the sound layer. The FIRST of these is the one that matters most in this file.
  // For four phases every sound in the hub was a no-op because the screens reached for a global
  // that does not exist, and 22,000 assertions did not notice. If reverting that reads as
  // SURVIVED, the new tests are checking that sound code runs rather than that sound resolves —
  // which is the original bug wearing a test suite.
  ['sound: the screens reach for a global that does not exist', 'puzzle-streak.js',
   "var SND    = (typeof SoundManager !== 'undefined') ? SoundManager : null;",
   "var SND    = (typeof Sound !== 'undefined') ? Sound : null;",
   'the four-phase silent bug — SND degrades to null and nothing ever plays'],
  ['sound: Turbo chimes on every solve', 'puzzle-turbo.js',
   '  function onSolved() {', "  function onSolved() {\n    play('game-over');",
   'Turbo`s only gameOver is in endGame() — chiming per puzzle would fire it dozens of times'],
  ['sound: the rated solver stops chiming on a solve', 'puzzle-solver.js',
   "if (correct) play('game-over');", "if (false) play('game-over');",
   'play-puzzle/index.tsx:778 chimes on a correct solve'],
  ['sound: capture and move swap', 'puzzle-metrics.js',
   'function soundForMove(captured) { return captured ? SOUNDS.file.capture : SOUNDS.file.move; }',
   'function soundForMove(captured) { return captured ? SOUNDS.file.move : SOUNDS.file.capture; }',
   'playMoveSound is capture-when-captured, and nothing else'],
  ['sound: a fifth key appears', 'puzzle-metrics.js',
   "keys: ['gameStart', 'move', 'capture', 'gameOver'],",
   "keys: ['gameStart', 'move', 'capture', 'gameOver', 'check'],",
   'the puzzle path has four sounds; check and castling belong to the Play screen'],
  ['sound: Streak chimes on a solve after all', 'puzzle-metrics.js',
   'chimeOnSolve: { play: true, daily: true, thematic: true, streak: false, turbo: false },',
   'chimeOnSolve: { play: true, daily: true, thematic: true, streak: true, turbo: true },',
   'the two RUN modes chime when the run ends, not per puzzle'],

  // --- Phase F: the timings, now that they are checked against the extraction rather than typed.
  ['timing: Daily borrows Play`s opponent delay', 'puzzle-session.js',
   "daily: 400,", "daily: 500,",
   'Daily replies in 400ms where the other three take 500 — it is the quick one'],
  ['timing: Turbo borrows the common opponent delay', 'puzzle-session.js',
   "turbo: 300", "turbo: 500",
   'Turbo replies in 300ms; a rush that paused as long as Play would feel slow'],
  ['timing: the daily banner outstays the source', 'puzzle-session.js',
   'dailyWrongBannerMs: 1300,', 'dailyWrongBannerMs: 1500,',
   'the wrong-move banner lives exactly 1300ms'],
  ['timing: the run clock ticks twice a second', 'puzzle-session.js',
   'tickMs: 1000,', 'tickMs: 500,',
   'the source ticks once a second, and the clock is derived from a timestamp anyway'],

  // --- Phase F: the haptic
  ['haptic: buzzing on drop as well as pickup', 'chess-board.js',
   '      this._haptic();\n      this._drag = {', '      this._drag = {',
   'the source fires one light impact on PICKUP and none on drop'],
  // --- Phase G: the Swift SCREENS. These mutate Swift, and the thing that must kill them is
  // `replay_puzzle_vm.js` — the only check that reads a screen's branches. If one survives, the
  // replay is asserting that the code exists rather than what it decides.
  ['swift: Streak chimes on a correct solve', 'PuzzleStreakScreens.swift',
   '    private func solved() {',
   '    private func solved() {\n        SoundManager.shared.play(PuzzleSounds.Key.gameOver.file)',
   'in a streak the reward is the next puzzle; game-over belongs to the run ending'],
  ['swift: Streak serves before reading its lock', 'PuzzleStreakScreens.swift',
   'if entering, let locked = PuzzleProgress.pendingStreakPuzzle(store.state),',
   'if false, let locked = PuzzleProgress.pendingStreakPuzzle(store.state),',
   'Part 22.6 — re-entering must hand back the identical puzzle, not reroll it'],
  ['swift: Streak reads the live best at the end', 'PuzzleStreakScreens.swift',
   'bestBefore: bestBefore,', 'bestBefore: store.state.streak.bestStreak,',
   'increment() has already raised it, which is what made the badge unreachable'],
  ['swift: Turbo counts its clock down', 'PuzzleTurboScreens.swift',
   'secondsLeft = TurboRun.secondsLeft(run, now: PuzzleHubStore.nowMs())',
   'secondsLeft = (secondsLeft ?? 0) - 1',
   'the clock is derived from startedAt so a dropped tick cannot drift it'],
  ['swift: Turbo invents its own advance delay', 'PuzzleTurboScreens.swift',
   'engine.schedule(w.policy.advanceMs ?? PuzzleSession.Timing.turboAdvanceMs) { next() }',
   'engine.schedule(PuzzleSession.Timing.turboAdvanceMs) { next() }',
   'the delay travels with the outcome; restating it is how the two came to disagree'],
  ['swift: Thematic moves Elo', 'PuzzleThematicScreens.swift',
   'PuzzleProgress.recordThematicAttempt(&s, themes: p.themes, isCorrect: correct,',
   'PuzzleProgress.recordRatedAttempt(&s, puzzleId: p.id, isCorrect: correct,',
   'Thematic is practice — it must not touch the rating'],
  ['swift: the store serves without remembering', 'PuzzleHubStore.swift',
   '        PuzzleProgress.commitSeen(&s, seen)\n', '',
   'a serve that does not commit `seen` forks the saved file from the live one'],
];

/** Runs every pure suite in one child process and exits non-zero if any of them fails. */
const RUN_ALL = [
  "const s=[require('./tools/qa/puzzle_core_test.js').run(),",
  " require('./web-demo/js/puzzle-metrics.js').selfTest(),",
  " require('./web-demo/js/puzzle-metrics.js')",
  "   .selfTestSource(require('./tools/metrics/puzzle_styles.json')),",
  " require('./web-demo/js/streak-engine.js').selfTest(),",
  " require('./web-demo/js/puzzle-stats.js').selfTest(),",
  " require('./web-demo/js/turbo-run.js').selfTest(),",
  " require('./tools/qa/puzzle_screen_test.js').run(),",
  " require('./tools/qa/board_component_test.js').selfTest(),",
  " require('./tools/qa/replay_puzzle_vm.js').run()];",
  "const bad=s.filter(x=>!x.ok);",
  "if(bad.length){bad.forEach(b=>console.log(b.summary));process.exit(1);}",
].join('');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'puzmut-'));
const FILES = ['puzzle-session.js', 'puzzle-store.js', 'puzzle-serving.js',
               'puzzle-progress.js', 'streak-engine.js', 'puzzle-metrics.js',
               'turbo-run.js', 'puzzle-streak.js', 'puzzle-turbo.js',
               'puzzle-solver.js', 'chess-board.js',
               'PuzzleStreakScreens.swift', 'PuzzleTurboScreens.swift',
               'PuzzleThematicScreens.swift', 'PuzzleHubStore.swift'];
const originals = {};
for (const f of FILES) originals[f] = fs.readFileSync(path.join(dirFor(f), f), 'utf8');

const killed = [], survived = [], broken = [];
try {
  for (const [name, file, find, repl, why] of MUTANTS) {
    const src = originals[file];
    if (src.indexOf(find) < 0) { broken.push(`${name}: pattern not found in ${file}`); continue; }
    if (src.split(find).length - 1 !== 1) {
      broken.push(`${name}: pattern is not unique in ${file}`); continue;
    }
    fs.writeFileSync(path.join(dirFor(file), file), src.replace(find, repl));
    let died = false, note = '';
    try {
      // All three pure suites, not just the core one. Six mutants survived the first run of this
      // file purely because their assertions live in `puzzle-metrics.js` and `streak-engine.js`,
      // which the harness was not executing — the tests were there, the harness was the gap.
      execFileSync('node', ['-e', RUN_ALL], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      died = true;
      const out = String(e.stdout || '') + String(e.stderr || '');
      const line = out.split('\n').find(l => l.trim().startsWith('x')) || out.split('\n')[0];
      note = line.trim().slice(0, 92);
    }
    // dirFor, NOT JS. This line said `JS` and quietly wrote every Swift mutant into
    // web-demo/js/ as a stray file while the real one kept its mutation — so four unrelated
    // mutants all "died" of the same leaked edit. A restore that restores the wrong file is worse
    // than no restore: it reports kills that never happened.
    fs.writeFileSync(path.join(dirFor(file), file), src);
    (died ? killed : survived).push([name, died ? note : why]);
  }
} finally {
  for (const f of FILES) fs.writeFileSync(path.join(dirFor(f), f), originals[f]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const [n, note] of killed) console.log(`  KILLED   ${n.padEnd(42)} -> ${note}`);
for (const [n, why] of survived) console.log(`  SURVIVED ${n.padEnd(42)} (${why})`);
for (const b of broken) console.log(`  BROKEN   ${b}`);
console.log(`\n${killed.length}/${MUTANTS.length} killed`);
process.exit(survived.length || broken.length ? 1 : 0);
