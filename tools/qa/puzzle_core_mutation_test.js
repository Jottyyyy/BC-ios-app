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
// Core Swift lives somewhere else again. Resolving every `.swift` to the UI directory would write a
// Core mutant into the wrong folder as a stray file while the real one kept its original text — the
// exact failure this harness already suffered once, when the RESTORE line did the same thing and
// four unrelated mutants "died" of one leaked edit.
const CORE_DIR = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');
const dirFor = (f) => {
  if (!f.endsWith('.swift')) return JS;
  return fs.existsSync(path.join(SWIFT_DIR, f)) ? SWIFT_DIR : CORE_DIR;
};

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
/**
 * A SECOND provably-equivalent mutant, removed for the same reason.
 *
 * `chooseBye` restricting its search to the bottom score bracket vs scanning the whole ordered
 * list cannot be told apart. `pairingOrder` sorts score-descending, so the bottom bracket is
 * always the TAIL of the list: the last bye-less player in the bracket is therefore also the last
 * bye-less player overall, and when the bracket has none, the real code falls through to exactly
 * the whole-list scan the mutant performs. Brute-forced over all 287,712 combinations of score
 * shape and bye history for 5- and 7-player fields: zero differ.
 *
 * The bracket filter stays in the source — it states the intent and it stops being a no-op the
 * moment the ordering changes — but a mutant that cannot fail would only pad the score.
 */
const MUTANTS = [
  // ---- Game Review (spec 2.10) ---------------------------------------------------------------------
  //
  // The orientation fix and the hand-off are both invisible when wrong: the modal still renders,
  // and the Analysis Board still opens. These are what make the difference detectable.
  ['review: the columns lose their orientation', 'coach-review.js',
   "      accuracy: user === WHITE ? summary.whiteAccuracy : summary.blackAccuracy,",
   "      accuracy: summary.whiteAccuracy,",
   'playing Black would put the coach accuracy over your own counts again'],
  ['review: the rows are ordered separately', 'coach-review.js',
   '    var cols = columns(summary, userColor);',
   '    var cols = columns(summary, WHITE);',
   'the 2.10 fix undone — the rows would disagree with the accuracy above them'],
  ['review: a zero row is drawn anyway', 'coach-review.js',
   '      if (left === 0 && right === 0) continue;', '      if (false) continue;',
   'ten rows of mostly zeros, which is what 2.10 says to skip'],
  ['review: the graph stops clamping', 'coach-review.js',
   '      if (cp > GRAPH_CLAMP_CP) cp = GRAPH_CLAMP_CP;', '      if (false) cp = GRAPH_CLAMP_CP;',
   'a mate score would run the curve off the top of the box'],
  ['review: the hand-off can be empty again', 'coach-review.js',
   '    if (!summary || !summary.moveEvaluations) return null;', '    if (false) return null;',
   'spec 7 #28 — the Analysis Board would receive nothing, silently'],
  ['review: the hand-off shares its array', 'coach-review.js',
   '      classifications: summary.moveEvaluations.slice(),',
   '      classifications: summary.moveEvaluations,',
   'a later mutation of the summary would reach a hand-off already made'],
  ['review: a corrupt record is not truncated', 'coach-review.js',
   '      if (!pos) break;                       // a corrupt record truncates rather than throws',
   '      if (!pos) { positions.push(null); continue; }',
   'the plan would carry a null position into the engine'],
  ['review: the plan drops its placeholder', 'coach-review.js',
   '    var positions = [], keys = [], moves = [{ san: null, color: null }];',
   '    var positions = [], keys = [], moves = [];',
   'every move would be attributed to the move before it'],
  ['review swift: the columns lose their orientation', 'CoachReview.swift',
   'accuracy: userColor == .white ? s.whiteAccuracy : s.blackAccuracy,',
   'accuracy: s.whiteAccuracy,',
   'the same 2.10 fix, undone on the Swift side'],
  ['review swift: an empty hand-off is allowed', 'CoachReview.swift',
   'guard let s = summary, !s.moveEvaluations.isEmpty else { return nil }',
   'guard let s = summary else { return nil }',
   'spec 7 #28 would be expressible again'],
  ['review swift: a short review is reported', 'CoachStore.swift',
   'guard walker.isComplete else {', 'guard walker.isFinished else {',
   'a cancelled review would report an accuracy computed over half a game'],
  ['review swift: the depth drifts from the spec', 'CoachReview.swift',
   'public static let reviewDepth = 12', 'public static let reviewDepth = 8',
   'a shallower batch classifies differently, and nothing on screen would say so'],

  // ---- Play vs Coach, Swift side -----------------------------------------------------------------
  //
  // `swift build` runs on a Mac, not here, so `replay_coach.js` is the only thing standing between
  // a wrong Swift constant and a shipped one. These prove it is not decorative.
  ['coach swift: a level depth drifts', 'CoachEngine.swift',
   '3: Config(depth: 7, numMoves: 2),', '3: Config(depth: 6, numMoves: 2),',
   'L3 would search a ply shallower than the JS twin'],
  ['coach swift: L3 picks the best more often', 'CoachEngine.swift',
   'return rng() < 0.7 ? 0 : Swift.min(1, count - 1)',
   'return rng() < 0.8 ? 0 : Swift.min(1, count - 1)',
   'a strength change that no compiler would object to'],
  ['coach swift: the movetime cap is lifted', 'CoachEngine.swift',
   'public static let movetimeCapMs = 1000', 'public static let movetimeCapMs = 2000',
   'every coach silently becomes stronger than the one people have played'],
  ['coach swift: repetition includes the ep square', 'CoachGame.swift',
   'omittingEmptySubsequences: false).prefix(3)',
   'omittingEmptySubsequences: false).prefix(4)',
   'spec 7 #30 undone — real threefolds go unnoticed again'],
  ['coach swift: a draw line drifts from the JS', 'CoachGame.swift',
   'public static let fiftyMove = "Draw by the fifty-move rule."',
   'public static let fiftyMove = "Draw by the 50-move rule."',
   'the two languages would show different words for the same ending'],
  ['coach swift: the draft outlives its week', 'CoachGame.swift',
   'public static let draftTTLms = 7 * 24 * 60 * 60 * 1000',
   'public static let draftTTLms = 30 * 24 * 60 * 60 * 1000',
   'a month-old game would offer to resume'],
  ['coach swift: two knights called a draw', 'CoachGame.swift',
   'if knights + bishopColors.count == 1 { return true }',
   'if knights + bishopColors.count <= 2 { return true }',
   'K+N+N vs K is not a dead position and FIDE does not call it one'],
  ['coach swift: the two back buttons disagree', 'CoachTurn.swift',
   'canFirst: hasEarlier,', 'canFirst: at > 1,',
   'spec 7 #37 reintroduced by hand'],
  ['coach swift: invalidating does not invalidate', 'CoachTurn.swift',
   'c.generation += 1', 'c.generation += 0',
   'the one counter stops counting, so every cancelled reply lands after all'],
  ['coach swift: a book row is mistyped', 'CoachBookData.swift',
   'Row(history: ["e4"], move: "c7c5"),', 'Row(history: ["e4"], move: "c7c6"),',
   'the Sicilian silently becomes the Caro-Kann'],
  ['coach swift: the book plays on past its gate', 'CoachBook.swift',
   'if sanHistory.count >= bookPlies { return nil }',
   'if sanHistory.count >= bookPlies * 2 { return nil }',
   'the book would own fourteen moves a side instead of seven'],
  ['coach swift: an unplayable book move raises', 'CoachBook.swift',
   'if let isLegal = isLegal, !isLegal(candidate) { return nil }',
   'if let isLegal = isLegal, !isLegal(candidate) { return candidate }',
   'spec 2.3 is explicit that it must fall through silently'],
  ['coach swift: resign stops asking', 'CoachScreens.swift',
   'Button { store.confirmingResign = true } label: {',
   'Button { store.resignConfirmed() } label: {',
   'spec 7 #24 — one tap would end the game again'],
  ['coach swift: review does not pause the coach', 'CoachStore.swift',
   'if !CoachGame.isLive(g) { cancelInFlight(); return }',
   'if !CoachGame.isLive(g) { return }',
   'spec 7 #27 — the engine plays on underneath a review'],
  ['coach swift: the reply is delayed, not paced', 'CoachStore.swift',
   'let remaining = Double(think) / 1000 - spent',
   'let remaining = Double(think) / 1000',
   'the think time would be ADDED to the search instead of covering it'],
  ['coach swift: Continue ignores the tapped colour', 'CoachScreens.swift',
   'let resume = draft.flatMap { d in d.userColor == colour ? d : nil }',
   'let resume = draft',
   'spec 7 #33 — picking Black and continuing puts you back as White'],

  // ---- Play vs Coach ---------------------------------------------------------------------------
  //
  // The first five are not hypotheticals: the game screen shipped with all of them at once, and
  // every existing suite stayed green, because a fake DOM node accepts anything you do to it. They
  // are here so that the contract mock in `coach_screen_test.js` can never quietly stop enforcing
  // the real component's contract.
  ['coach play: the move detail is added, not read', 'coach-play.js',
   'if (cb.onMove) cb.onMove(d.uci);', 'if (cb.onMove) cb.onMove(d.from + d.to);',
   'from and to are numeric indexes, so this is arithmetic — the shipped bug'],
  ['coach play: flipped set as an attribute', 'coach-play.js',
   'b.flipped = GAME.isFlipped(game);',
   "b.setAttribute('flipped', GAME.isFlipped(game) ? '1' : '0');",
   'the component is attribute-truthy, so flipped="0" is upside down for White'],
  ['coach play: no rules adapter', 'coach-play.js',
   'b.rules = rulesAdapter();', 'b.rules = null;',
   'without rules no square is selectable and no move can be made at all'],
  ['coach play: last move highlighted in algebraic', 'coach-play.js',
   'b.highlightLastMove(E.sqIndex(shown.from), E.sqIndex(shown.to));',
   'b.highlightLastMove(shown.from, shown.to);',
   'the cell map is keyed by index, so strings highlight nothing'],
  ['coach play: premove queued from raw detail', 'coach-play.js',
   'TURN.setPremove(ctl, game, d.uci.slice(0, 2), d.uci.slice(2, 4), d.uci.slice(4) || null);',
   'TURN.setPremove(ctl, game, d.from, d.to, d.promotion);',
   'consumePremove concatenates from + to, so numbers make a nonsense UCI'],
  ['coach play: Review offered for a game with no moves', 'coach-play.js',
   "if (typeof cb.onReview === 'function' && RV.isReviewable(game)) {",
   "if (typeof cb.onReview === 'function') {",
   'a review of one position is a mean over nothing'],
  ['coach select: the roster is not the source roster', 'coach-select.js',
   'level: c.level, name: c.name, title: c.role, rating: c.rating,',
   'level: c.level, name: c.role, title: c.name, rating: c.rating,',
   'the hand-typed roster got four of five names wrong and nothing caught it'],
  ['coach app: the game route is dead', 'app.js',
   "else if (current === 'coach-game') renderCoachGame();",
   "else if (false) renderCoachGame();",
   'the trailing else silently renders another screen for an unrouted id'],
  ['coach app: leaving does not cancel the reply', 'app.js',
   "if (current === 'coach-game') coachLeave();", 'if (false) coachLeave();',
   'a ghost move lands on a screen the user already left (7 #25/#26)'],

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
  // --- The bug that made every puzzle mode unplayable. The board speaks square INDICES; this
  // adapter once treated them as names, so every square reported zero legal targets and no piece
  // could be picked up or tapped. Two green suites missed it for five phases because neither drove
  // a move through the real component. `board_component_test.js` does now, and must kill this.
  ['board: the puzzle adapter speaks names again', 'puzzle-board.js',
   'return E.legalMovesFrom(pos, sq).map(function (m) {',
   'return E.legalMoves(pos).filter(function (m) { return m.from === E.sqIndex(sq); }).map(function (m) {',
   'E.sqIndex() on an index returns null, so nothing is ever selectable'],
  ['board: the move event is not converted', 'puzzle-board.js',
   'var m = moveFromEvent(ev.detail);', 'var m = ev.detail;',
   'submit() builds a UCI by concatenation, so indices become arithmetic'],
  // ---- Pairing engine ------------------------------------------------------------------------
  //
  // The first four are the SHIPPING SERVER'S BUGS, reintroduced verbatim. Book Two 1.7 calls the
  // pairing work "a rewrite, not a port" precisely because of these; a suite that does not kill
  // them has not earned that claim.
  ['pairing: the silent repeat pairing', 'pairing-engine.js',
   "        warnings.push({ kind: 'repeatPairing', a: a.name, b: b.name, aId: a.id, bId: b.id });",
   "        void a;",
   'TournamentController.php:558 — re-pairs two players and tells nobody'],
  ['pairing: a repeat costs no more than a score point', 'pairing-engine.js',
   '  var COST_REPEAT = 1e7;', '  var COST_REPEAT = 1e2;',
   'the matcher would trade a rematch for a tidier bracket'],
  ['pairing: round-robin colours ignore balance', 'pairing-engine.js',
   '        var aWhite;\n        if (costA !== costB) aWhite = costA < costB;',
   '        var aWhite = true;\n        if (false) aWhite = costA < costB;',
   'line 658 — alternating board 1 only, which gave one player six Whites in six games'],
  ['pairing: rated path when ANY player is rated', 'pairing-engine.js',
   '    var useRatings = rated * 2 >= players.length;', '    var useRatings = rated > 0;',
   'line 422 — `->count() > 0` split a 20-player unrated field as if it were rated'],
  ['pairing: floater chosen with no float history', 'pairing-engine.js',
   "    var c = reversed.filter(function (p) { return last(p) !== 'down' && prev(p) !== 'down'; });",
   '    var c = [];',
   'the same player floats down every round'],
  ['pairing: re-floating is cheaper than a score point', 'pairing-engine.js',
   '  var COST_REFLOAT = 1.2e4;', '  var COST_REFLOAT = 9e3;',
   'the ordering that actually produced double downfloats before it was raised'],
  ['pairing: the absolute colour rules are not absolute', 'pairing-engine.js',
   '  var COST_COLOR_ABSOLUTE = 5e4;', '  var COST_COLOR_ABSOLUTE = 5e1;',
   'a third White in a row becomes affordable'],
  ['pairing: Buchholz counts undecided games', 'pairing-engine.js',
   "      if (g.result !== 'w' && g.result !== 'b' && g.result !== 'd') return;",
   '      if (false) return;',
   'round 1 of a round robin would inflate every Buchholz with unplayed rounds'],
  ['pairing: Buchholz Cut-1 drops nothing', 'pairing-engine.js',
   '      var cut1 = oppScores.length ? buchholz - Math.min.apply(null, oppScores) : 0;',
   '      var cut1 = buchholz;',
   'Cut-1 is Buchholz minus the WORST opponent; identical values are not a tie-break'],
  // ---- Pairing store ---------------------------------------------------------------------------
  ['store: seeds are not renumbered on removal', 'pairing-store.js',
   '    t.players.forEach(function (p, i) { p.seed = i + 1; });',
   '    void 0;',
   'spec 7 #1 — the round-robin circle sorts by seed, so duplicates degrade the schedule'],
  ['store: seeds count instead of counting up', 'pairing-store.js',
   '    t.nextSeed = t.players.length + 1;',
   '    t.nextSeed = t.players.length;',
   'the server bug: seed = currentCount + 1 collides after any removal'],
  ['store: the bye goes on the first board', 'pairing-store.js',
   '      if (res.bye != null) boards.push({ white: res.bye, black: null, bye: true });',
   '      if (res.bye != null) boards.unshift({ white: res.bye, black: null, bye: true });',
   'spec 7 #7 — the server put it on board 1 from round 2 onward'],
  ['store: a bye is not scored at generation', 'pairing-store.js',
   '        result: b.bye ? BYE : PENDING,', '        result: PENDING,',
   'spec 7 #12 — bye points awarded after the tie-break pass, so standings were stale'],
  ['store: a bye is worth a win', 'pairing-store.js',
   '            w.score += 1; w.byes += 1; w.hadBye = true;',
   '            w.score += 1; w.byes += 1; w.wins += 1; w.hadBye = true;',
   'a bye is a point, not a victory'],
  ['store: the bye leaves no gap in colour history', 'pairing-store.js',
   '            w.colors.push(null); seen[w.id] = true;', '            seen[w.id] = true;',
   'Dutch reads the colour of the LAST game; a missing slot shifts every later round'],
  ['store: finished results can be swapped', 'pairing-store.js',
   '    if (result !== PENDING && status(t) === FINISHED) return false;', '    void 0;',
   'spec 7 #17 — the server let results be edited after the tournament ended'],
  ['store: players stay editable after round 1', 'pairing-store.js',
   '    if (!t || status(t) !== SETUP) return null;', '    if (!t) return null;',
   'adding a player mid-event silently invalidates every pairing already made'],
  ['store: bulk parse skips the round-trip test', 'pairing-store.js',
   "      if (isFinite(n) && n >= 0 && n <= 3000 && String(n) === last) {",
   '      if (isFinite(n) && n >= 0 && n <= 3000) {',
   'without it, 007 becomes a rating of 7 and the name loses its last word'],
  // ---- Pairing screens -------------------------------------------------------------------------
  ['screen: the standings table shows the row index as the seed', 'pairing-detail.js',
   "row.appendChild(el('div', 'pgd-seed', String(p.seed)));",
   "row.appendChild(el('div', 'pgd-seed', String(rows.indexOf(p) + 1)));",
   'spec 7 #15 — the RN app printed the position in a score-sorted list, never the real seed'],
  ['screen: the result badge falls through to a draw', 'pairing-detail.js',
   'if (result === ST.PENDING) return T.vs;',
   'if (result === ST.PENDING) return T.vs; if (result) return T.resultDraw;',
   'spec 7 #20 - a corrupt result rendered as a plausible half point'],
  ['screen: rank 1 gets no gold on screen', 'pairing-detail.js',
   "'pgd-st-col pgd-st-rank' + (first ? ' gold' : '')",
   "'pgd-st-col pgd-st-rank'",
   'spec 7 #14 — the RN styles existed and only ever reached the share image'],
  // 'the players tab sorts state in place' was REMOVED as provably equivalent. Spec 7 #16 is a
  // React bug: `.sort()` on a state array mutates the object the renderer is holding. This screen
  // calls `ST.load()` on every paint, so the array it sorts is a fresh parse that nothing else
  // references — mutating it changes nothing observable. The `.slice()` stays in the source because
  // it stops being a no-op the moment a caller passes a live document in.
  ['screen: the share text carries a URL again', 'pairing-detail.js',
   "                 T.textClipboard + T.shareSubtitle(round.number, ST.totalRoundsOf(t),",
   "                 'https://example.ngrok.io',\n"
   + "                 T.textClipboard + T.shareSubtitle(round.number, ST.totalRoundsOf(t),",
   'spec 7 #22 - the RN version pasted its ngrok tunnel into every shared message'],
  ['screen: the bye is drawn on the first board', 'pairing-store.js',
   '      if (res.bye != null) boards.push({ white: res.bye, black: null, bye: true });',
   '      if (res.bye != null) boards.splice(0, 0, { white: res.bye, black: null, bye: true });',
   'spec 7 #7, seen from the screen rather than the document'],
  ['screen: deleting a tournament skips the confirmation', 'pairing-list.js',
   "c._longPress = function () { confirmDelete(root, t, cb.onChanged); };",
   "c._longPress = function () { var d = ST.load(); ST.remove(d, t.id); ST.save(d);"
   + " if (cb.onChanged) cb.onChanged(); };",
   'spec 7 #18 — the RN app dropped the row without ever checking the response'],
  // 'screen: Create accepts a blank name' was REMOVED as unfalsifiable by a single edit. The screen
  // checks the name AND `ST.create` refuses an empty one, independently, so deleting either guard
  // changes nothing observable — the modal still appears and nothing is created. Defence in depth
  // is the right design, but it means no one-line mutant can express the bug. The store's guard is
  // mutated instead, below: it is the one that actually protects the document, and it was untested
  // until this survivor pointed at it.
  ['store: create accepts a blank name', 'pairing-store.js',
   "    if (!name) return null;\n    var type = fields.type === ROUND_ROBIN ? ROUND_ROBIN : SWISS;",
   "    if (!name) name = '?';\n    var type = fields.type === ROUND_ROBIN ? ROUND_ROBIN : SWISS;",
   'a nameless tournament is unopenable and unidentifiable in the list'],
  ['screen: a missing tournament renders nothing', 'pairing-detail.js',
   "      gone.appendChild(el('div', 'pgd-empty-title', T.deletedTitle));",
   "      gone.appendChild(el('div', 'pgd-empty-title', ''));",
   'spec 7 #19 — a failed fetch left a permanent spinner; an empty box is the same bug'],
  ['screen: the badge tint rounds to a percentage', 'pairing-list.js',
   'badge.style.backgroundColor = MET.tint(typeColor, MET.TINT_BYTE);',
   "badge.style.backgroundColor = typeColor + '20';",
   'the spec rounds 0x22 to "13% alpha"; the byte is what the source writes'],
  // ---- Pairing document (Core) -------------------------------------------------------------
  //
  // These mutate SWIFT and are caught by `replay_pairing.js` reading the source text, which is the
  // only check that can reach a Core file on a checkout with no compiler.
  ['document: round.floats is Int-keyed', 'PairingDocument.swift',
   'public var floats: [String: PairingEngine.Float3]',
   'public var floats: [Int: PairingEngine.Float3]',
   'JSONEncoder writes an Int-keyed map as a flat ARRAY, so the JS twin could not read it'],
  ['document: the bye is inserted first', 'PairingDocument.swift',
   'rows.append((white: Optional(bye), black: nil, bye: true))',
   'rows.insert((white: Optional(bye), black: nil, bye: true), at: 0)',
   'spec 7 #7 - the server put the bye on board 1 from round 2 onward'],
  ['document: a bye is left pending', 'PairingDocument.swift',
   'result: b.bye ? .bye : .pending', 'result: .pending',
   'spec 7 #12 - bye points awarded after the tie-break pass, so standings were stale'],
  ['document: a finished result can be swapped', 'PairingDocument.swift',
   'if result != .pending && status(doc.tournaments[ti]) == .finished { return false }',
   'if false { return false }',
   'spec 7 #17 - the server let results be edited after the tournament ended'],
  ['document: a JSON key drifts from the JS', 'PairingDocument.swift',
   'case colors, floats, opponentIDs = "opponentIds", hadBye',
   'case colors, floats, opponentIDs, hadBye',
   'a mismatched key decodes to a plausible, wrong document rather than failing'],
  // ---- Pairing screens (Swift) ----------------------------------------------------------------
  //
  // Caught by the branch-structure section of `replay_pairing.js`, which is the only check that can
  // reach a SwiftUI body on a checkout with no compiler.
  ['swift screen: the seed chip shows a row index', 'PairingDetailScreens.swift',
   'Text(String(p.seed))', 'Text(String(rows.firstIndex(of: p) ?? 0))',
   'spec 7 #15 - the RN app printed the position in a score-sorted list'],
  ['swift screen: the result badge defaults to a draw', 'PairingDetailScreens.swift',
   'case .pending, .bye: return PairingStrings.vs',
   'default: return PairingStrings.resultDraw',
   'spec 7 #20 - a corrupt result rendered as a plausible half point'],
  ['swift screen: rank 1 loses its gold', 'PairingDetailScreens.swift',
   'first ? PairingDetail.rankColFirstBackgroundColor', 'false ? PairingDetail.rankColBackgroundColor',
   'spec 7 #14 - the RN styles existed and only ever reached the share image'],
  ['swift screen: long press deletes outright', 'PairingScreens.swift',
   '.onLongPressGesture { pendingDelete = t }', '.onLongPressGesture { store.remove(t.id) }',
   'spec 7 #18 - the RN app dropped the row without checking the response'],
  ['swift screen: the share text regains a URL', 'PairingDetailScreens.swift',
   'lines.append(PairingStrings.textBoard(b.board) + w + PairingStrings.textBye)',
   'lines.append("https://example.ngrok.io")',
   'spec 7 #22 - the RN version pasted its ngrok tunnel into every message'],
  ['swift screen: a layout literal creeps back in', 'PairingScreens.swift',
   '.padding(.bottom, PairingList.cardMarginBottom)', '.padding(.bottom, 10)',
   'a number no metrics check can see'],
  ['swift store: a mutation skips persistence', 'PairingStore.swift',
   'PairingLibraryFile.save(s)', 'let _ = s',
   'the document would live only until the app closed'],
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
  " require('./tools/qa/replay_puzzle_vm.js').run(),",
  " require('./tools/qa/pairing_test.js').run(),",
  " require('./web-demo/js/pairing-store.js').selfTest(),",
  " require('./tools/qa/pairing_screen_test.js').run(),",
  " require('./tools/qa/replay_pairing.js').run(),",
  " require('./web-demo/js/coach-engine.js').selfTest(),",
  " require('./web-demo/js/coach-book.js').selfTest(),",
  " require('./web-demo/js/coach-game.js').selfTest(),",
  " require('./web-demo/js/coach-turn.js').selfTest(),",
  " require('./web-demo/js/coach-select.js').selfTest(),",
  " require('./web-demo/js/coach-color.js').selfTest(),",
  " require('./web-demo/js/coach-play.js').selfTest(),",
  " require('./web-demo/js/coach-metrics.js')",
  "   .selfTestSource(require('./tools/metrics/coach_styles.json')),",
  " require('./web-demo/js/coach-review.js').selfTest(),",
  " require('./tools/qa/coach_screen_test.js').run(),",
  " require('./tools/qa/replay_coach.js').run()];",
  "const bad=s.filter(x=>!x.ok);",
  "if(bad.length){bad.forEach(b=>console.log(b.summary));process.exit(1);}",
].join('');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'puzmut-'));
const FILES = ['puzzle-session.js', 'puzzle-store.js', 'puzzle-serving.js',
               'puzzle-progress.js', 'streak-engine.js', 'puzzle-metrics.js',
               'turbo-run.js', 'puzzle-streak.js', 'puzzle-turbo.js',
               'puzzle-solver.js', 'chess-board.js', 'puzzle-board.js',
               'pairing-engine.js', 'pairing-store.js', 'pairing-list.js',
               'pairing-create.js', 'pairing-detail.js', 'PairingDocument.swift',
               'PairingScreens.swift', 'PairingDetailScreens.swift',
               'PairingStore.swift',
               'PuzzleStreakScreens.swift', 'PuzzleTurboScreens.swift',
               'PuzzleThematicScreens.swift', 'PuzzleHubStore.swift',
               'coach-play.js', 'coach-select.js', 'coach-turn.js', 'coach-game.js',
               'app.js', 'coach-review.js',
               'CoachEngine.swift', 'CoachGame.swift', 'CoachTurn.swift',
               'CoachBook.swift', 'CoachBookData.swift', 'CoachReview.swift',
               'CoachScreens.swift', 'CoachStore.swift',
               'CoachLayout.swift'];
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
