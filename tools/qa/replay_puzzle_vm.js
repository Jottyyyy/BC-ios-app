#!/usr/bin/env node
/*
 * replay_puzzle_vm.js — the Swift SCREENS' decisions, replayed against the JS twin.
 *
 *     node tools/qa/replay_puzzle_vm.js
 *
 * `swift_symbol_check.js` proves every name resolves and `swift_lint.js` proves the brackets
 * match, but neither can tell whether a screen took the RIGHT branch. That gap matters here more
 * than usual: the eleven SwiftUI screens were written without a compiler, against a JS twin that
 * already works, and the interesting parts are all conditionals — which mode chimes, whether the
 * anti-reroll lock is read before serving, whether every Turbo exit goes through one door.
 *
 * So this reads the decisions out of the Swift source and asserts them against the JS that has
 * actually run. It is a source check, and says so: it cannot execute Swift. What it can do is
 * catch "the Swift does X where the JS does Y", which is the whole failure mode of porting a
 * screen by hand.
 *
 * Exit 0 = the two languages agree.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const JS = path.join(ROOT, 'web-demo', 'js');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };
const eq = (got, want, what) =>
  expect(got === want, `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** Strip comments so a documented rule is never mistaken for a live one. */
const code = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '')
     .replace(/^[ \t]*\/\/\/.*$/gm, '');

function read(dir, file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) { failures.push(`missing ${file}`); return ''; }
  return code(fs.readFileSync(p, 'utf8'));
}

/** The body of a `func name(` … `)` by brace matching, so a regex cannot wander into the next one. */
function funcBody(src, name) {
  const at = src.search(new RegExp('func\\s+' + name + '\\s*\\('));
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

function run() {
  passed = 0; failures.length = 0;

  const streak = read(UI, 'PuzzleStreakScreens.swift');
  const turbo = read(UI, 'PuzzleTurboScreens.swift');
  const daily = read(UI, 'PuzzleDailyScreens.swift');
  const thematic = read(UI, 'PuzzleThematicScreens.swift');
  const play = read(UI, 'PuzzlePlayScreens.swift');
  const parts = read(UI, 'PuzzleSolverParts.swift');
  const store = read(UI, 'PuzzleHubStore.swift');

  const MET = require(path.join(JS, 'puzzle-metrics.js'));
  const TR = require(path.join(JS, 'turbo-run.js'));
  const SESSION = require(path.join(JS, 'puzzle-session.js'));

  // ── 1. Streak: no chime on a solve, `game-over` on failure ───────────────────────
  //
  // The JS twin settles this and `PuzzleSounds.chimesOnSolve` records it; the screen has to agree.
  // "No sound" is not otherwise observable, which is exactly why it needs asserting.
  {
    const solved = funcBody(streak, 'solved');
    expect(solved !== null, 'the Streak screen has a solved() handler');
    expect(solved !== null && !/SoundManager|\.play\(/.test(solved),
      'a correct Streak solve plays NO sound — the reward is the next puzzle');
    eq(MET.SOUNDS.chimeOnSolve.streak, false, 'and the JS table says the same');

    // Its `game-over` belongs to the run ending, which `PuzzleSession` emits from the policy.
    eq(SESSION.WRONG_POLICY.streak.gameOverSound, true,
      'the streak policy is what plays game-over on failure');
    eq(SESSION.WRONG_POLICY.streak.endsRun, true, 'and the run ends there');
    eq(SESSION.WRONG_POLICY.streak.offersRetry, false, 'with no Retry offered');
  }

  // ── 2. Streak: the anti-reroll lock is read BEFORE anything is served (Part 22.6) ─
  {
    const serve = funcBody(streak, 'serve');
    expect(serve !== null, 'the Streak screen has a serve() function');
    const lockAt = serve ? serve.indexOf('pendingStreakPuzzle') : -1;
    const serveAt = serve ? serve.indexOf('serveStreak') : -1;
    expect(lockAt >= 0, 'it reads pendingStreakPuzzle');
    expect(serveAt >= 0, 'and it serves');
    expect(lockAt >= 0 && serveAt >= 0 && lockAt < serveAt,
      'the pending lock is read BEFORE serving — otherwise re-entering rerolls the puzzle');
    // Position alone is not enough: a guard mutated to `if false` keeps the same text order and
    // would read as fine. The CONDITION has to be the entry flag.
    expect(/if entering,\s*let locked = PuzzleProgress\.pendingStreakPuzzle/.test(serve || ''),
      'and the lock is read when ENTERING, on a live condition rather than a disabled one');
    expect(!/if\s+(false|true)/.test(serve || ''),
      'the serve path has no hard-coded branch');
    expect(/lockStreakPuzzle/.test(serve || ''), 'and every fresh serve takes the lock');
  }

  // ── 3. Streak: `bestBefore` is captured at run START, not read at the end ────────
  {
    expect(/bestBefore = store\.state\.streak\.bestStreak/.test(streak),
      'the run captures the best as it stood when it started');
    expect(/bestBefore: bestBefore/.test(streak),
      'and hands THAT to endStreakRun, so the badge can actually fire');
    const failed = funcBody(streak, 'failed');
    expect(failed !== null && !/bestStreak/.test(failed.replace(/bestBefore/g, '')),
      'the failure path does not re-read the live best, which increment() has already raised');
    // The JS proves the rule the Swift is following.
    const PROG = require(path.join(JS, 'puzzle-progress.js'));
    const s = PROG.seed(0);
    s.streak.bestStreak = 6;
    for (let i = 0; i < 6; i++) PROG.recordStreakSolve(s, 700 + i, i);
    eq(PROG.endStreakRun(s, 6, 6, 99).isNewBest, true,
      'and a tie IS a new best, matching the source');
  }

  // ── 4. Turbo: exactly ONE exit, and it is idempotent ─────────────────────────────
  //
  // Fixes #5, #6 and #13 together. A second exit path is how the original recorded nothing on a
  // quit and wrote two rows when the clock and the navigation both fired.
  {
    const calls = (turbo.match(/PuzzleProgress\.endRushRun\(/g) || []).length;
    eq(calls, 1, 'there is exactly ONE call to endRushRun in the whole screen');
    const finish = funcBody(turbo, 'finish');
    expect(finish !== null, 'and it lives in finish()');
    expect(finish !== null && /TurboRun\.isOver\(run\)/.test(finish),
      'which refuses to run twice');
    expect(finish !== null && /TurboRun\.end\(/.test(finish),
      'and closes the run through TurboRun.end, which keeps the FIRST reason');
    // The JS proves idempotence rather than the Swift asserting it about itself.
    let st = TR.start(1200, 3);
    st = TR.end(st, TR.REASON.timeUp, 1000);
    st = TR.end(st, TR.REASON.quit, 2000);
    eq(st.reason, TR.REASON.timeUp, 'the first reason wins');
    eq(st.endedAt, 1000, 'and so does the first timestamp');
  }

  // ── 5. Turbo: out of lives beats the clock ───────────────────────────────────────
  {
    let st = TR.start(1200, 3);
    st = TR.served(st, 0);
    st = TR.missed(TR.missed(TR.missed(st)));
    eq(TR.endReason(st, 999999), TR.REASON.threeMistakes,
      'losing your last life is what happened, even if the clock expired in the same instant');
    const checkEnd = funcBody(turbo, 'checkEnd');
    expect(checkEnd !== null && /TurboRun\.endReason\(/.test(checkEnd),
      'and the screen asks endReason rather than deciding for itself');
  }

  // ── 6. Turbo: the clock is READ, never accumulated ───────────────────────────────
  {
    const refresh = funcBody(turbo, 'refreshClock');
    expect(refresh !== null && /TurboRun\.secondsLeft\(/.test(refresh),
      'the clock is derived from startedAt, so a dropped tick cannot make it drift');
    const tick = funcBody(turbo, 'tickClock');
    expect(tick !== null && !/-=|\+=|- 1|secondsLeft = secondsLeft/.test(tick || ''),
      'the timer only repaints; it does not decrement a counter');
  }

  // ── 7. Turbo: leaving splits by mode (Part 14.5) ─────────────────────────────────
  {
    const leave = funcBody(turbo, 'leave');
    expect(leave !== null, 'the Turbo run has a leave()');
    expect(leave !== null && /saveRushDraft/.test(leave),
      'an infinite run saves a resumable draft');
    expect(leave !== null && /backgrounded/.test(leave),
      'and a timed one is recorded as backgrounded');
    expect(leave !== null && /infiniteMode/.test(leave),
      'the split is on the infinite sentinel, named rather than a bare 0');
    eq(TR.totalSeconds(0), 0, 'mode 0 has no clock at all, which is what makes it resumable');
    expect(TR.totalSeconds(3) > 0 && TR.totalSeconds(5) > 0, 'and the timed modes do');
  }

  // ── 8. Turbo: a wrong move does not undo, and the dot marks where it landed ──────
  {
    eq(SESSION.WRONG_POLICY.turbo.undo, false,
      'Turbo leaves the piece on the wrong square');
    eq(SESSION.WRONG_POLICY.turbo.offersRetry, false, 'and offers no Retry');
    const missed = funcBody(turbo, 'missed');
    expect(missed !== null && /feedback = \(/.test(missed), 'the screen shows a feedback dot');
    expect(missed !== null && /TurboRun\.missed\(/.test(missed), 'and spends a life');
    expect(missed !== null && /w\.policy\.advanceMs/.test(missed),
      'and takes the advance delay from the POLICY, not a number of its own');
  }

  // ── 9. Thematic moves no Elo ─────────────────────────────────────────────────────
  {
    expect(!/recordRatedAttempt/.test(thematic),
      'the thematic screen never calls recordRatedAttempt — Thematic is unrated');
    expect(/recordThematicAttempt/.test(thematic), 'it records a thematic attempt instead');
    expect(/recordRatedAttempt/.test(play), 'while the rated screen does call it');
    expect(!/recordRatedAttempt/.test(streak) && !/recordRatedAttempt/.test(turbo)
           && !/recordRatedAttempt/.test(daily),
      'and no other mode touches the rating');
  }

  // ── 10. Daily: one solve per calendar day, and the only self-expiring banner ─────
  {
    expect(/recordDailyPuzzleSolve/.test(daily), 'Daily records its solve');
    eq(SESSION.WRONG_POLICY.daily.staysPlayable, true,
      'Daily is the only mode that returns to playing by itself');
    for (const m of ['play', 'thematic', 'streak', 'turbo']) {
      eq(SESSION.WRONG_POLICY[m].staysPlayable, false, `${m} does not`);
    }
    expect(/wrongBannerMs/.test(daily), 'and the banner takes its lifetime from the extraction');
  }

  // ── 11. Every screen asks the shared derivations rather than restating them ──────
  {
    for (const [name, src] of [['play', play], ['thematic', thematic]]) {
      expect(/PuzzleDisplay\.hasEnginePanel/.test(src),
        `the ${name} solver ASKS whether it has an engine panel`);
    }
    expect(/PuzzleDisplay\.bottomPanel\(/.test(parts),
      'and the bottom row is derived once, in the shared panel');
    for (const [name, src] of [['streak', streak], ['turbo', turbo], ['daily', daily]]) {
      expect(!/PuzzleDisplay\.bottomPanel\(/.test(src),
        `${name} does not build its own bottom row — its chrome is genuinely different`);
    }
  }

  // ── 12. The store is the only way to serve, and it always persists ───────────────
  {
    const serveFn = funcBody(store, 'serve');
    expect(serveFn !== null && /commitSeen/.test(serveFn),
      'every serve commits the seen set');
    expect(serveFn !== null && /persist\(\)/.test(serveFn), 'and writes it');
    for (const [name, src] of [['streak', streak], ['turbo', turbo], ['thematic', thematic],
                               ['play', play], ['daily', daily]]) {
      expect(!/SQLitePuzzlePool|PuzzleSelection\.serve/.test(src),
        `the ${name} screen goes through the store, never the pool directly`);
    }
  }

  // ── 12b. The board is wired for TAP, not drag only ───────────────────────────────
  //
  // `PuzzleBoardBand` shipped with `selected: nil, legalTargets: [], onTap: { _ in }` and
  // `lastMove: nil` — so on a phone, where tap-tap is how most people move, nothing happened, no
  // legal-move dots appeared and the last move was never highlighted. The web had the mirror of
  // this bug in its rules adapter; both are the same oversight in two languages.
  {
    const band = parts.slice(parts.indexOf('struct PuzzleBoardBand'));
    expect(/selected: engine\.selected/.test(band), 'the board shows the selected square');
    expect(/legalTargets: engine\.legalTargets/.test(band), 'and the legal-move dots');
    expect(/lastMove: engine\.lastMove/.test(band), 'and the last move');
    expect(/onTap: \{ sq in/.test(band), 'and taps reach the engine');
    expect(!/onTap: \{ _ in \}/.test(band), 'rather than being swallowed');
    const tap = funcBody(parts, 'tap');
    expect(tap !== null, 'the engine has a tap handler');
    expect(tap !== null && /legalTargets\.contains\(sq\)/.test(tap),
      'which moves when the tapped square is a legal target');
    expect(tap !== null && /if sq == sel \{ deselect\(\)/.test(tap),
      'and deselects when the same square is tapped twice, like ChessGameVM.tap');
  }

  // ── 13. No prefetch buffer anywhere (Part 7.6) ───────────────────────────────────
  for (const [name, src] of [['streak', streak], ['turbo', turbo], ['store', store]]) {
    for (const banned of ['BUFFER_MAX', 'BUFFER_REFILL', 'BUFFER_PARALLEL', 'prefetch']) {
      expect(!src.includes(banned), `${name} has no ${banned} — one lookahead, not a queue`);
    }
  }

  // ── 14. No hostname reached the Swift screens either (Part 22.2) ─────────────────
  for (const [name, src] of [['streak', streak], ['turbo', turbo], ['daily', daily],
                             ['thematic', thematic], ['play', play], ['store', store],
                             ['parts', parts]]) {
    for (const re of [/URLSession/, /URLRequest/, /https?:\/\//, /lichess/i, /chess\.com/i]) {
      expect(!re.test(src), `the ${name} screen contains no ${re}`);
    }
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayPuzzleVM: ${passed} Swift screen decisions confirmed against the JS`
      : `ReplayPuzzleVM: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
