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
    expect(missed !== null && /showFeedback\(w\.played, correct: false\)/.test(missed),
      'the screen shows a ✕ dot, through the one function that owns the dot');
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

  // ── 9. No puzzle screen declares a share button, and none declares a DEAD button ────────
  //
  // The five share buttons were `Button { } label:` and `overlayButton(…, fill) { }` — real
  // chrome wired to an empty closure. They rendered, they pressed, and they did nothing,
  // through three phases and 35,000 assertions, because nothing anywhere asserts what a button
  // DOES. The client found them; they are removed rather than implemented.
  //
  // This lives here and NOT in `replay_puzzle_core.js` for one concrete reason: the mutation
  // harness's RUN_ALL does not include that file, so a Swift mutant re-adding a share button
  // would report SURVIVED and the rule would be a gate on trust. This file is in RUN_ALL.
  //
  // The second rule is the GENERAL one, and it is the one that would have caught all five in
  // the first place.
  {
    const FILES = {
      'PuzzleStreakScreens.swift': streak,
      'PuzzleTurboScreens.swift': turbo,
      'PuzzleDailyScreens.swift': daily,
      'PuzzleThematicScreens.swift': thematic,
      'PuzzlePlayScreens.swift': play,
      'PuzzleSolverParts.swift': parts,
    };
    for (const [name, raw] of Object.entries(FILES)) {
      const src = code(raw);

      // Scoped to REFERENCES, never to the word. `SoundManager.shared.play(…)` is in
      // PuzzleTurboScreens, and four of these files use "share"/"shares" in prose — a rule
      // spelled `/[Ss]hare/` fails on all of them on the day it is written.
      expect(!/PuzzleStrings\.\w*[Ss]hare/.test(src),
        `${name} draws no share copy — the hub's five share buttons are gone, and Play Home `
        + 'never had one in Swift');
      expect(!/\.share(Fill|Radius|PaddingV|PaddingH|Size|MarginBottom)\b/.test(src),
        `${name} reads no share metric either — those blocks went with the buttons`);

      // A trailing closure that is EMPTY is dead UI: it renders and presses and does nothing.
      //
      // Two shapes, and the anchoring is the whole difference. `Button { } label:` is followed
      // by ` {` and the label body, so it must match ANYWHERE in the line; `overlayButton(…,
      // fill) { }` ends the line, so that one anchors at `$`. The first draft of this rule put
      // `$` after both and therefore matched nothing at all — it read as a clean sweep on a
      // file that still had the buttons in it, and the mutation harness is what said so.
      const dead = [...src.matchAll(/^.*(?:Button\s*\{\s*\}\s*label:|\)\s*\{\s*\}\s*$)/gm)]
        .map(m => m[0].trim());
      eq(dead.join(' | '), '',
        `${name} declares no button wired to an empty closure — that is exactly what the five `
        + 'share buttons were, and it is invisible on screen');
    }
    expect(Object.keys(FILES).length >= 6, 'and six screen files were swept');
  }

  // ── 14. Turbo: nothing stalls between a solve and the next board ─────────────────
  //
  // The client: "hindi smooth, parang may lag or loading time para sa next puzzle". The delays
  // are the source's own (500 ms advance, 300 ms setup) and stay; what was wrong was everything
  // around them, and each line below is one of the four ways it went wrong.
  {
    // (a) A ✓ on every correct move — rush-game.tsx:449-457 calls showMoveFeedback(…, true) in
    //     both correct branches. Without it a solve was half a second of nothing.
    // The RUN screen's start() — the lobby above it in the same file has one of its own.
    const runScreen = turbo.slice(turbo.indexOf('struct PuzzleTurboRunScreen'));
    const start = funcBody(runScreen, 'start');
    expect(start !== null
           && /engine\.onCorrect = \{ c in showFeedback\(c\.played, correct: true\) \}/.test(start),
      'a correct Turbo move shows a ✓ dot, as the source does');
    const show = funcBody(turbo, 'showFeedback');
    expect(show !== null && /feedbackSeq \+= 1/.test(show) && /feedback = \(/.test(show),
      'showing a dot bumps the sequence');
    expect(show !== null && /engine\.schedule\(PuzzleSession\.Timing\.turboFeedbackMs\)/.test(show)
           && /if feedbackSeq == seq \{ feedback = nil \}/.test(show),
      'and its clear fires only if no newer dot replaced it — the source\'s clearTimeout');
    const missed = funcBody(turbo, 'missed') || '';
    expect(!/feedback = /.test(missed), 'the ✕ no longer sets the dot behind showFeedback\'s back');

    // (b) Cleared on mount — the source's mountPuzzle does, and `mount` cancels the clear task.
    const next = funcBody(turbo, 'next') || '';
    const cleared = next.indexOf('feedback = nil');
    expect(cleared >= 0 && cleared < next.indexOf('engine.mount('),
      'next() clears the dot BEFORE the new board mounts, so a ✕ never rides onto it');

    // (c) A clock publisher held in @State. As a `let` it was rebuilt with the struct on every
    //     serve, `onReceive` re-subscribed, and the clock skipped a second per puzzle.
    for (const [name, src] of [['turbo', turbo], ['play', play]]) {
      expect(/@State private var tick = Timer\.publish\(/.test(src),
        `the ${name} solver keeps its tick publisher in @State`);
    }
    const anyLetTimer = fs.readdirSync(UI).filter(f => f.endsWith('.swift'))
      .filter(f => /\blet\s+\w+\s*=\s*Timer\.publish\(/.test(read(UI, f)));
    eq(anyLetTimer.join(', '), '',
      'no view in the package holds a Timer publisher in a `let` (it restarts on every rebuild)');

    // (d) The board keeps its piece views. A fresh UUID per piece per call made SwiftUI discard
    //     and rebuild every piece on every render.
    const helpers = read(UI, 'BoardHelpers.swift');
    const pf = funcBody(helpers, 'piecesFrom');
    expect(pf !== null && !/UUID\(\)/.test(pf) && /squareID\(sq\)/.test(pf),
      'piecesFrom identifies a piece by its square, never by a fresh UUID');
    const sid = funcBody(helpers, 'squareID');
    expect(sid !== null && /UInt8\(sq\)/.test(sid) && !/UUID\(\)/.test(sid),
      'and squareID is a pure function of the square');
    for (const f of ['PuzzleSolverParts.swift', 'CoachScreens.swift', 'OpeningTreeScreens.swift']) {
      expect(!/BoardPiece\(id: UUID\(\)/.test(read(UI, f)),
        `${f} builds no render-time pieces with a fresh UUID`);
    }

    // (e) One statement per sample, not 1 + 256.
    const pstore = read(UI, 'PuzzleStore.swift');
    const pool = pstore.slice(pstore.indexOf('struct SQLitePuzzlePool'));
    for (const fn of ['windowUnseen', 'anyUnseen']) {
      const body = funcBody(pool, fn) || '';
      expect(/store\.candidates\(/.test(body) && !/store\.candidate\(/.test(body),
        `the pool's ${fn} reads ratings in its sampling query, not one statement per id`);
    }
    const cands = funcBody(pstore, 'candidates') || '';
    expect(/SELECT puzzle_id, rating FROM theme_rating_index/.test(cands)
           && /SELECT id, rating FROM puzzles/.test(cands)
           && /sqlite3_column_int\(stmt, 1\)/.test(cands),
      'and that query selects the rating beside the id in both of its tables');

    // (f) The progress file is encoded and written off the main thread, in order.
    const persist = funcBody(store, 'persist') || '';
    const hop = persist.indexOf('writer.async {');
    expect(hop >= 0 && persist.indexOf('encode(snapshot)') > hop
           && persist.indexOf('.write(to: file') > hop && !/encode\(state\)/.test(persist),
      'persist() encodes a snapshot and writes it on the writer queue, not the main thread');
    expect(/static let writer = DispatchQueue\(label:/.test(store) && !/\.concurrent/.test(store),
      'and that queue is serial, so writes land in the order they were made');
    const reset = funcBody(store, 'reset') || '';
    expect(reset.indexOf('writer.sync {}') > reset.indexOf('persist()') && /persist\(\)/.test(reset),
      'reset() drains the queue, so deleting an account cannot have a late write restore the file');
  }

  // ── 15. Rated Play: the five round-3 reports against 1.0.10 ──────────────────────
  //
  // Every one was a Swift-only defect the web twin never had, and none of them was asserted — the
  // rated solver was the one screen this file barely read. Each block below pins one report.
  {
    const hub = read(UI, 'PuzzleHubScreen.swift');
    const APP = require(path.join(JS, 'puzzle-app.js'));
    const PROG = APP.PROG;

    // (a) "Kapag nag back ka nagpapalit ng puzzle." The Core's PlayPuzzleDraft was never called.
    const resumable = funcBody(store, 'resumablePlay') || '';
    expect(/var s = state/.test(resumable)
           && /PuzzleProgress\.loadPlayDraft\(&s, now:/.test(resumable)
           && /puzzle\(id: d\.puzzleId\)/.test(resumable),
      'resumablePlay() reads the 24 h draft on a COPY of the state and loads its puzzle');
    const start = funcBody(play, 'startIfNeeded') || '';
    const restoreAt = start.indexOf('store.resumablePlay()');
    const mountAt = start.indexOf('engine.mount(restored)');
    const serveAt = start.indexOf('next()');
    expect(restoreAt >= 0 && mountAt > restoreAt && serveAt > mountAt
           && /return\s*\}\s*next\(\)/.test(start),
      'entering the rated solver resumes the draft BEFORE it would serve a new puzzle');
    // The order alone is not enough: `if false, let restored = …` keeps every call in place and
    // never resumes. The condition must be the draft and nothing else.
    expect(/\bif let restored = store\.resumablePlay\(\) \{/.test(start),
      'and the resume is conditioned on the draft alone');
    const nextFn = funcBody(play, 'next') || '';
    expect(nextFn.indexOf('PuzzleProgress.savePlayDraft(') > nextFn.indexOf('store.serveRated()')
           && nextFn.indexOf('PuzzleProgress.savePlayDraft(') < nextFn.indexOf('engine.mount(p)'),
      'every serve writes the draft before mounting, so leaving by ANY route finds it');
    const finishFn = funcBody(play, 'finish') || '';
    expect(/if correct \{ s\.playDraft = nil \}/.test(finishFn),
      'a solve clears the draft — and only a solve (a miss keeps it, as RN and the web do)');
    expect(/if res\.firstAttempt \{ ratingDelta = res\.ratingChange \}/.test(finishFn),
      'a resumed, already-attempted puzzle shows no delta: the repeat is not rated');
    const leaveFn = funcBody(play, 'leaveScreen') || '';
    expect(/phase != \.solved/.test(leaveFn) && /savePlayDraft\(/.test(leaveFn)
           && /engine\.leave\(\)/.test(leaveFn),
      'leaving refreshes the draft of an unsolved puzzle, then leaves the engine');
    expect(/onBack: \{ leaveScreen\(\); onExit\(\) \}/.test(play)
           && /\.onDisappear\(perform: leaveScreen\)/.test(play),
      'both exits — the chevron and the pop — go through leaveScreen');
    // The hub must not charge for a resume, and must check BEFORE the gate.
    const playHome = hub.slice(hub.indexOf('case .playHome:'), hub.indexOf('case .playSolver:'));
    const resumeAt = playHome.indexOf('store.resumablePlay() != nil');
    const gateAt = playHome.indexOf('gate(Entitlement.Mode.regular');
    expect(resumeAt >= 0 && gateAt > resumeAt,
      'the hub lets a resume through BEFORE spending a rated allowance');
    // …and the JS twin settles what the draft does.
    {
      const st = PROG.seed(1000);
      PROG.savePlayDraft(st, 42, 1000);
      eq(PROG.loadPlayDraft(st, 1000 + 1000).puzzleId, 42, 'JS: a fresh draft restores');
      eq(PROG.loadPlayDraft(st, 1000 + 24 * 3600 * 1000 + 1), null, 'JS: past 24 h it does not');
    }
    const jsApp = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
    expect(/if \(BiyaPuzzleApp\.resumablePlay\(\)\) \{ puzzleGo\('puzzle-solve'\); return; \}\s*gate\(BiyaPremium\.MODE\.regular/.test(jsApp),
      'the web hub skips the allowance for a resume too');

    // (b) "Solution → Next Puzzle → may engine suggestion pa." mount() never reset the panel.
    const mount = funcBody(parts, 'mount') || '';
    expect(mount.indexOf('cancel()') >= 0 && /engineLines = \[\]/.test(mount)
           && mount.indexOf('engineLines = []') < mount.indexOf('session = PuzzleSession.create'),
      'mount() clears the engine lines with the board, before the new session exists');
    const cancelFn = funcBody(parts, 'cancel') || '';
    expect(/engineToken \+= 1/.test(cancelFn) && /engineSearch\?\.cancel\(\)/.test(cancelFn)
           && /engineBusy = false/.test(cancelFn),
      'cancel() abandons the search in flight — its results AND its CPU');
    const runEngineFn = funcBody(parts, 'runEngine') || '';
    expect(/shouldCancel: \{ search\.isCancelled \|\| Date\(\) > deadline \}/.test(runEngineFn),
      'the search itself stops when cancelled, not only at its 3 s deadline');
    const panel = parts.slice(parts.indexOf('struct PuzzleEnginePanelView'));
    expect(/if !lines\.isEmpty, engine\.session\?\.phase == \.reviewing \{/.test(panel),
      'the panel draws only while reviewing — the one phase the web builds it in');
    const thematicJs = fs.readFileSync(path.join(JS, 'puzzle-thematic.js'), 'utf8');
    const tNext = thematicJs.slice(thematicJs.indexOf('function next()'));
    expect(tNext.indexOf("ui.engine.innerHTML = ''") >= 0
           && tNext.indexOf("ui.engine.innerHTML = ''") < tNext.indexOf('solver.mount(puzzle)'),
      'the web Thematic screen empties its engine rows before the next puzzle mounts');

    // (c) "+12" alone — the stats row (spec Band 4) was never built.
    expect(/statsRow\s*\n\s*PuzzleBottomPanel/.test(play) && !/deltaRow/.test(play),
      'the rated solver draws the stats row between the board and the buttons');
    const stats = play.slice(play.indexOf('private var statsRow'), play.indexOf('private func stat<'));
    for (const [what, re] of [
      ['the live rating from the store', /Text\("\\\(store\.state\.profile\.rating\)"\)/],
      ['the delta under it', /PuzzleDisplay\.deltaStyle\(ratingDelta\)/],
      ['the clock', /PuzzleDisplay\.formatTime\(elapsed\)/],
      ["the puzzle's rating", /engine\.puzzle\.map/],
      ['the three extracted labels', /PuzzleStrings\.yourRating[\s\S]*PuzzleStrings\.clock[\s\S]*PuzzleStrings\.puzzle\)/],
    ]) expect(re.test(stats), 'the stats row shows ' + what);
    const header = play.slice(play.indexOf('PuzzleScreenHeader(title: PuzzleStrings.puzzle'),
                              play.indexOf('infoStrip\n'));
    expect(!/formatTime/.test(header), 'and the clock left the header for it, as in the web twin');

    // (d) "Accuracy 91.700000" — a Double interpolated into a Text literal is `%lf`.
    expect(/Text\(AnalysisTables\.accuracyText\(acc\.percent\)\)/.test(play)
           && !/Text\("\\\(acc\.percent\)"\)/.test(play),
      'accuracy is formatted by the shared one-decimal formatter, with its "%"');
    const allUI = fs.readdirSync(UI).filter(f => f.endsWith('.swift'))
      .filter(f => /Text\("\\\(\w+(\.\w+)*\.(percent|pct|accuracy)\)"\)/.test(read(UI, f)));
    eq(allUI.join(', '), '', 'no screen interpolates a percentage straight into a Text literal');
    expect(/Text\(String\(row\.percent\) \+ "%"\)/.test(play), 'theme rows carry their "%"');
    expect(/Text\(bar\.count > 0 \? String\(bar\.count\) : ""\)/.test(play),
      'an empty activity day shows no "0"');

    // (e) The empty "Your Rating" card — a 32 pt inset on every side of a 52 pt box.
    const spark = play.slice(play.indexOf('struct PuzzleSparkline'), play.indexOf('struct PuzzlePlaySolverScreen'));
    expect(!/\.padding\(PuzzleStatsStyle\.sparkPadding\)/.test(spark),
      'the sparkline is not inset by sparkPadding — that is a width, and the card already applies it');
    expect(/\.background\(PuzzlePalette\.screenBg/.test(spark), 'on the spec\'s #0F1A2E box');
    expect(/if hasSparkline \{ sparklineCard \}/.test(play),
      'and the card is dropped, not drawn empty, under two attempts — as the web drops it');
    eq(MET.STATS.sparkPadding, 32, 'JS: sparkPadding is the card\'s 16 + 16');
    expect(/width - S\.sparkPadding/.test(fs.readFileSync(path.join(JS, 'puzzle-home.js'), 'utf8')),
      'JS: and the web subtracts it from the width, never insets the box');
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
