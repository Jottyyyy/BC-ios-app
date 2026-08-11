#!/usr/bin/env node
/*
 * puzzle_core_test.js — the Puzzle Hub's pure layer: session, selection, progress.
 *
 *     node tools/qa/puzzle_core_test.js
 *
 * These three modules are written in JavaScript FIRST and proven here, then transliterated to
 * Swift, because `swift` is not on PATH on this checkout — the Swift half cannot be compiled until
 * it reaches a Mac. So this file is not a mirror of a Swift test; it is the only place the logic
 * has actually executed, and `replay_puzzle_core.js` then checks the hand-written Swift tables
 * against what ran here.
 *
 * Real puzzles throughout, out of `web-demo/js/puzzle-data.js` — the slice the build script cuts
 * from the shipping corpus. Hand-written FENs are how the last two rounds of this rebuild
 * introduced bugs into the tests rather than into the code.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');

const E = require(path.join(JS, 'engine.js'));
const S = require(path.join(JS, 'puzzle-session.js'));
const SERVE = require(path.join(JS, 'puzzle-serving.js'));
const STORE = require(path.join(JS, 'puzzle-store.js'));
const PROG = require(path.join(JS, 'puzzle-progress.js'));
const RATING = require(path.join(JS, 'rating.js'));
const DATA = require(path.join(JS, 'puzzle-data.js'));
const STREAK = require(path.join(JS, 'streak-engine.js'));

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** Solve a session by playing its stored line; returns the outcomes in order. */
function playLine(s, upTo) {
  const out = [];
  const limit = upTo == null ? s.puzzle.moves.length : upTo;
  while (s.moveIndex < limit && s.phase === 'playing') {
    const uci = s.puzzle.moves[s.moveIndex];
    const r = S.submit(s, uci.slice(0, 2), uci.slice(2, 4), uci[4]);
    out.push(r);
    if (r.kind !== 'correct') break;
    if (!r.solved) { out.push(S.applyOpponentReply(s)); }
  }
  return out;
}

function run() {
  // =====================================================================================
  // 1. The move convention (Part 5.1) — on real corpus rows
  // =====================================================================================
  {
    const p = DATA.puzzles.find(x => x.moves.length >= 4);
    const s = S.create(p, 'play');
    eq(s.phase, 'loading', 'a new session starts in `loading`');
    eq(s.moveIndex, 1, 'moveIndex starts at 1 — index 0 is the opponent`s');
    const pos = E.fromFEN(p.fen);
    eq(s.userColor, E.opponent(pos.sideToMove),
       'the solver is the OPPOSITE of the FEN`s side to move');
    eq(s.flipped, s.userColor === E.BLACK, 'the board flips when the solver plays Black');

    const setup = S.applySetupMove(s);
    eq(setup.applied, true, 'the setup move applies');
    eq(s.phase, 'playing', 'and the session becomes playable');
    eq(s.position.sideToMove, s.userColor, 'after moves[0] it is the solver`s turn');
    eq(s.lastMove.from, E.sqName(E.parseUci(E.fromFEN(p.fen), p.moves[0]).from),
       'lastMove points at the setup move');
    expect(setup.sound === 'move' || setup.sound === 'capture', 'the setup move names a sound');
    eq(S.applySetupMove(s).applied, false, 'applying the setup twice is a no-op');
  }

  // Every mode derives the same colour and flip from the same puzzle.
  {
    const p = DATA.puzzles[7];
    const colours = S.MODES.map(m => S.create(p, m).userColor);
    eq(new Set(colours).size, 1, 'userColor does not depend on the mode');
    let threw = false;
    try { S.create(p, 'nonsense'); } catch (e) { threw = true; }
    expect(threw, 'an unknown mode is rejected rather than silently mishandled');
  }

  // =====================================================================================
  // 2. Solving a whole line, in every mode
  // =====================================================================================
  for (const mode of S.MODES) {
    const p = DATA.puzzles.find(x => x.moves.length === 4);
    const s = S.create(p, mode);
    S.applySetupMove(s);
    const first = S.submit(s, p.moves[1].slice(0, 2), p.moves[1].slice(2, 4), p.moves[1][4]);
    eq(first.kind, 'correct', `[${mode}] the expected move is correct`);
    if (!first.solved) {
      eq(first.opponentReplyAfterMs, S.TIMING.opponentDelayMs[mode],
         `[${mode}] the reply delay comes from the Master Timing Table`);
      const reply = S.applyOpponentReply(s);
      eq(reply.applied, true, `[${mode}] the opponent replies`);
      eq(s.moveIndex, 3, `[${mode}] moveIndex advances by 2`);
      const last = S.submit(s, p.moves[3].slice(0, 2), p.moves[3].slice(2, 4), p.moves[3][4]);
      eq(last.kind, 'correct', `[${mode}] the final move is correct`);
      eq(last.solved, true, `[${mode}] and finishes the puzzle`);
    }
    eq(s.phase, 'solved', `[${mode}] the session ends in \`solved\``);
    eq(S.applyOpponentReply(s).applied, false,
       `[${mode}] there is no reply pending after a solve`);
  }

  // A long line, solved end to end.
  {
    const p = DATA.puzzles.find(x => x.moves.length >= 8);
    const s = S.create(p, 'play');
    S.applySetupMove(s);
    const outs = playLine(s);
    expect(outs.every(o => o.kind === 'correct' || o.applied), 'a long line solves cleanly');
    eq(s.phase, 'solved', `an ${p.moves.length}-ply line finishes solved`);
    eq(s.moveIndex, p.moves.length - 1, 'moveIndex lands on the last solver move');
  }

  // =====================================================================================
  // 3. The checkmate short-circuit (Part 5.4 rule 1)
  // =====================================================================================
  {
    // A real mate-in-1: the stored answer IS mate, so the two paths agree.
    const p = DATA.puzzles.find(x => x.themes.includes('mateIn1') && x.moves.length === 2);
    const s = S.create(p, 'play');
    S.applySetupMove(s);
    const r = S.submit(s, p.moves[1].slice(0, 2), p.moves[1].slice(2, 4), p.moves[1][4]);
    eq(r.kind, 'correct', 'a mate-in-1 is correct');
    eq(r.byCheckmate, true, 'and is reported as won by checkmate');
    eq(E.status(s.position), 'checkmate', 'the board really is mate');
  }
  {
    // The case the rule exists for: a DIFFERENT mating move than the stored line. Found by
    // searching the slice for a position with two distinct mates — asserting the rule against a
    // hand-built position would only prove the position.
    let found = null;
    for (const p of DATA.puzzles) {
      if (!p.themes.includes('mateIn1') || p.moves.length !== 2) continue;
      const pos = E.makeMove(E.fromFEN(p.fen), E.parseUci(E.fromFEN(p.fen), p.moves[0]));
      const mates = E.legalMoves(pos).filter(m => E.status(E.makeMove(pos, m)) === 'checkmate');
      if (mates.length > 1) {
        const alt = mates.map(E.moveUci).find(u => u !== p.moves[1]);
        if (alt) { found = { p, alt }; break; }
      }
    }
    expect(!!found, 'the slice contains a puzzle with more than one mating move');
    if (found) {
      const s = S.create(found.p, 'play');
      S.applySetupMove(s);
      const r = S.submit(s, found.alt.slice(0, 2), found.alt.slice(2, 4), found.alt[4]);
      eq(r.kind, 'correct', 'an OFF-BOOK mate is still correct (the short-circuit)');
      eq(r.byCheckmate, true, 'and is flagged as such');
      eq(s.phase, 'solved', 'the puzzle ends');
      expect(r.played !== found.p.moves[1], 'the accepted move is not the stored one');
      // Without the short-circuit this is precisely the "I mated him but the app said wrong" bug.
      expect(RATING.compareMoves([found.p.moves[1]], [found.alt]) === false,
        'the server`s compareMoves would have called this wrong — fix #10');
    }
  }

  // =====================================================================================
  // 4. Wrong moves — the five policies (Part 5.5)
  // =====================================================================================
  {
    const p = DATA.puzzles.find(x => x.moves.length >= 4);
    // A legal, non-mating, non-expected move.
    function wrongMoveFor(fen, setupUci, expectedUci) {
      const pos = E.makeMove(E.fromFEN(fen), E.parseUci(E.fromFEN(fen), setupUci));
      return E.legalMoves(pos)
        .filter(m => E.moveUci(m) !== expectedUci && E.status(E.makeMove(pos, m)) !== 'checkmate')
        .map(E.moveUci)[0];
    }
    const bad = wrongMoveFor(p.fen, p.moves[0], p.moves[1]);
    expect(!!bad, 'a legal non-answer exists to test with');

    const table = {
      play:     { undone: true,  phase: 'failed',  endsRun: false, bannerMs: null, advanceMs: null,  offersRetry: true,  costsALife: false },
      daily:    { undone: true,  phase: 'playing', endsRun: false, bannerMs: 1300, advanceMs: null,  offersRetry: true,  costsALife: false },
      thematic: { undone: true,  phase: 'failed',  endsRun: false, bannerMs: null, advanceMs: null,  offersRetry: true,  costsALife: false },
      streak:   { undone: true,  phase: 'failed',  endsRun: true,  bannerMs: null, advanceMs: null,  offersRetry: false, costsALife: false },
      turbo:    { undone: false, phase: 'failed',  endsRun: false, bannerMs: null, advanceMs: 500,   offersRetry: false, costsALife: true  },
    };
    for (const mode of S.MODES) {
      const want = table[mode];
      const s = S.create(p, mode);
      S.applySetupMove(s);
      const before = E.toFEN(s.position);
      const r = S.submit(s, bad.slice(0, 2), bad.slice(2, 4), bad[4]);
      eq(r.kind, 'wrong', `[${mode}] an off-book non-mate is wrong`);
      eq(r.undone, want.undone, `[${mode}] undo`);
      eq(r.endsRun, want.endsRun, `[${mode}] endsRun`);
      eq(r.bannerMs, want.bannerMs, `[${mode}] bannerMs`);
      eq(r.advanceMs, want.advanceMs, `[${mode}] advanceMs`);
      eq(r.offersRetry, want.offersRetry, `[${mode}] offersRetry`);
      eq(r.costsALife, want.costsALife, `[${mode}] costsALife`);
      eq(s.phase, want.phase, `[${mode}] phase after a wrong move`);
      eq(r.expected, p.moves[1], `[${mode}] the expected move is reported`);
      eq(r.mistakes, 1, `[${mode}] the mistake is counted`);
      // The board itself: Turbo leaves the piece on the wrong square, everyone else snaps back.
      eq(E.toFEN(s.position) === before, want.undone,
         `[${mode}] the position ${want.undone ? 'snaps back' : 'keeps the wrong move'}`);
      eq(r.sound, mode === 'streak' ? 'game-over' : null, `[${mode}] wrong-move sound`);
    }
    // Daily's unlimited retries: after the banner it is playable again and the answer still works.
    const s = S.create(p, 'daily');
    S.applySetupMove(s);
    S.submit(s, bad.slice(0, 2), bad.slice(2, 4), bad[4]);
    S.submit(s, bad.slice(0, 2), bad.slice(2, 4), bad[4]);
    eq(s.mistakes, 2, 'Daily allows a second wrong try');
    const ok = S.submit(s, p.moves[1].slice(0, 2), p.moves[1].slice(2, 4), p.moves[1][4]);
    eq(ok.kind, 'correct', 'and the right answer is still accepted afterwards');
  }

  // An illegal move is a silent no-op everywhere: no sound, no penalty, no state change.
  {
    for (const mode of S.MODES) {
      const p = DATA.puzzles[3];
      const s = S.create(p, mode);
      S.applySetupMove(s);
      const before = E.toFEN(s.position);
      const r = S.submit(s, 'a1', 'a8');
      eq(r.kind, 'illegal', `[${mode}] an illegal move reports \`illegal\``);
      eq(s.mistakes, 0, `[${mode}] and is not a mistake`);
      eq(s.phase, 'playing', `[${mode}] and does not end anything`);
      eq(E.toFEN(s.position), before, `[${mode}] and does not move a piece`);
      eq(r.sound, undefined, `[${mode}] and makes no sound`);
    }
  }

  // =====================================================================================
  // 5. Promotion (Part 5.6)
  // =====================================================================================
  {
    // Unconditionally: a puzzle whose FIRST solver move is a promotion, so the assertion runs
    // right after setup and cannot be skipped by a walk that ended early. A mutant that made
    // `needsPromotion` always return false survived the walk-based version of this test.
    const promo = DATA.puzzles.find(p => p.moves[1] && p.moves[1].length === 5);
    expect(!!promo, 'the slice contains a puzzle whose first answer is a promotion');
    if (promo) {
      const s = S.create(promo, 'play');
      S.applySetupMove(s);
      const u = promo.moves[1];
      eq(S.needsPromotion(s, u.slice(0, 2), u.slice(2, 4)), true,
         'a pawn reaching the last rank needs the promotion dialog');
      // ...and the very same pawn moving one square short of the last rank does NOT.
      const f = E.sqIndex(u.slice(0, 2));
      const nonPromo = E.legalMoves(s.position)
        .filter(m => m.from !== f || m.promotion == null).map(E.moveUci)[0];
      if (nonPromo) {
        eq(S.needsPromotion(s, nonPromo.slice(0, 2), nonPromo.slice(2, 4)), false,
           'a move that is not a pawn reaching the last rank does not');
      }
      const r = S.submit(s, u.slice(0, 2), u.slice(2, 4), u[4]);
      expect(r.kind === 'correct', 'the promotion move is accepted with its piece');
    }
    // ...and no ordinary midboard position asks for one.
    const p = DATA.puzzles[5];
    const s2 = S.create(p, 'play');
    S.applySetupMove(s2);
    const asks = E.legalMoves(s2.position).filter(m => {
      const pc = s2.position.squares[m.from], rk = E.sqRank(m.to);
      return pc.kind === E.PAWN && ((pc.color === E.WHITE && rk === 7) || (pc.color === E.BLACK && rk === 0));
    }).length;
    const reported = E.legalMoves(s2.position)
      .filter(m => S.needsPromotion(s2, E.sqName(m.from), E.sqName(m.to))).length;
    eq(reported, asks, 'needsPromotion agrees with the engine on every legal move');
    eq(S.needsPromotion(s2, 'z9', 'a1'), false, 'a nonsense square is not a promotion');
  }

  // A promotion submitted with no piece defaults to queen (5.1's `promotion = uci[4] ?? 'q'`).
  {
    const promo = DATA.puzzles.find(p => p.moves.length === 2 && p.moves[1].length === 5
                                    && p.moves[1][4] === 'q');
    if (promo) {
      const s = S.create(promo, 'play');
      S.applySetupMove(s);
      const u = promo.moves[1];
      const r = S.submit(s, u.slice(0, 2), u.slice(2, 4));    // no promotion argument
      eq(r.kind, 'correct', 'an omitted promotion defaults to queen');
    }
  }

  // =====================================================================================
  // 6. Retry, Solution, and the derived strings (Part 10.3)
  // =====================================================================================
  {
    const p = DATA.puzzles.find(x => x.moves.length >= 4);
    const s = S.create(p, 'play');
    S.applySetupMove(s);
    const u = p.moves[1];
    S.submit(s, u.slice(0, 2), u.slice(2, 4), u[4]);
    S.applyOpponentReply(s);
    eq(s.moveIndex, 3, 'two plies in');
    const r = S.retry(s);
    eq(s.moveIndex, 1, 'retry resets the move index');
    eq(s.phase, 'loading', 'retry returns to the pre-setup state');
    eq(E.toFEN(s.position), E.toFEN(E.fromFEN(p.fen)), 'retry rebuilds from the puzzle FEN');
    eq(s.lastMove, null, 'retry clears the last move');
    eq(r.restartClock, true, 'retry restarts the clock — fix (a)');
    eq(r.sound, 'game-start', 'retry plays the game-start sound — fix (b)');
    eq(r.submitsRating, false, 'retry never re-submits the rating');
    eq(r.setupAfterMs, 500, 'retry replays the setup move after 500 ms');
  }
  {
    const p = DATA.puzzles.find(x => x.moves.length >= 4);
    const s = S.create(p, 'play');
    S.applySetupMove(s);
    const rev = S.revealSolution(s);
    eq(s.phase, 'reviewing', 'Solution moves the session to `reviewing`');
    eq(rev.runEngine, true, 'and asks for the engine');
    eq(rev.maxArrows, 3, 'with up to 3 arrows');
    eq(rev.remaining.length, p.moves.length - 1, 'the remaining line is reported');
    eq(rev.remaining[0], p.moves[1], 'starting at the solver`s next move');
    // The board is unlocked for two-sided play and nothing is judged.
    const free = E.moveUci(E.legalMoves(s.position)[0]);
    const fr = S.submit(s, free.slice(0, 2), free.slice(2, 4), free[4]);
    eq(fr.kind, 'freePlay', 'a move while reviewing is free play');
    eq(s.mistakes, 0, 'and is never scored');
    // ...including for the other side, which is what "two-sided" means.
    const back = E.moveUci(E.legalMoves(s.position)[0]);
    eq(S.submit(s, back.slice(0, 2), back.slice(2, 4), back[4]).kind, 'freePlay',
       'the opponent`s pieces move too');
  }
  {
    const p = DATA.puzzles[11];
    const pgn = S.solutionPGN(p);
    expect(pgn.endsWith(' *'), 'the Save Puzzle PGN is terminated by ` *`');
    expect(pgn.indexOf('[FEN') < 0, 'and carries no FEN header — it goes in initialFen');
    const pos = E.fromFEN(p.fen);
    const opener = pos.sideToMove === E.BLACK ? pos.fullmove + '...' : pos.fullmove + '.';
    expect(pgn.startsWith(opener),
      `the PGN numbers from the FEN's own counter (${opener}): ${pgn.slice(0, 24)}`);
    // Replaying the emitted SAN must reproduce the stored UCI exactly.
    let p2 = E.fromFEN(p.fen), i = 0, sanOk = true;
    for (const tok of pgn.split(' ')) {
      if (/^\d+\.?\.?\.?$/.test(tok) || tok === '*') continue;
      const m = E.parseSan(p2, tok);
      if (!m || E.moveUci(m) !== p.moves[i]) { sanOk = false; break; }
      p2 = E.makeMove(p2, m); i++;
    }
    expect(sanOk && i === p.moves.length, 'every SAN token round-trips back to the stored UCI');

    const notes = S.savePuzzleNotes(p);
    expect(notes.startsWith('Rating: ' + p.rating), 'the notes open with the rating');
    eq(notes.split('\n').some(l => l === ''), false, 'only non-empty lines are included');
    eq(S.savePuzzleNotes({ id: 1 }), '', 'a puzzle with nothing to say produces no notes');
    eq(S.savePuzzleName({ id: 42 }), 'Puzzle #42', 'the prefilled name');
  }

  // =====================================================================================
  // 7. Timings (Part 17) and the daily-goal predicate (Part 15.1)
  // =====================================================================================
  {
    eq(S.TIMING.opponentDelayMs.play, 500, 'Play opponent delay');
    eq(S.TIMING.opponentDelayMs.thematic, 500, 'Thematic opponent delay');
    eq(S.TIMING.opponentDelayMs.streak, 500, 'Streak opponent delay');
    // Part 5.3 says "500 everywhere except Turbo"; Part 17 gives Daily 400. Part 17 wins.
    eq(S.TIMING.opponentDelayMs.daily, 400, 'Daily opponent delay is 400, per the master table');
    eq(S.TIMING.opponentDelayMs.turbo, 300, 'Turbo opponent delay');
    eq(S.TIMING.turboAdvanceMs, 500, 'Turbo advances after 500 ms');
    eq(S.TIMING.turboFeedbackMs, 500, 'the Turbo feedback dot lives 500 ms');
    eq(S.TIMING.dailyWrongBannerMs, 1300, 'the Daily wrong banner lives 1300 ms');
    eq(S.TIMING.tickMs, 1000, 'clocks tick every 1000 ms');
    eq(S.TIMING.goalRingMs, 400, 'the goal ring animates over 400 ms');
    eq(S.TIMING.draftTtlMs, 24 * 60 * 60 * 1000, 'drafts live 24 hours');
    eq(S.TIMING.turboSeconds[3], 180, '3-minute Turbo');
    eq(S.TIMING.turboSeconds[5], 300, '5-minute Turbo');

    for (const m of ['play', 'daily', 'thematic', 'streak']) {
      eq(S.countsTowardDailyGoal(m), true, `${m} counts toward the daily goal`);
    }
    eq(S.countsTowardDailyGoal('turbo'), false,
       'Turbo is excluded — a 3-minute run would make a 10-a-day goal meaningless');
  }

  // =====================================================================================
  // 8. Selection: the ladder, and the scoped Tier-3 wipe (Part 7, fix #7)
  // =====================================================================================
  {
    // Ids are deliberately NOT in rating order, and one candidate sits exactly on the window
    // boundary. Both matter: with the ids sorted, "lowest id" and "closest by ABS" coincide and a
    // mutant swapping one ladder's tier 2 for the other's survives; with nothing on the boundary,
    // an inclusive-vs-exclusive `whereBetween` is invisible.
    const pool = [
      { id: 1, rating: 1000, themes: ['fork'] },
      { id: 2, rating: 1050, themes: ['pin'] },
      { id: 3, rating: 1400, themes: ['fork'] },
      { id: 4, rating: 1800, themes: ['skewer'] },
      { id: 5, rating: 1100, themes: ['pin'] },     // exactly 1000 + 100 — the inclusive edge
      { id: 6, rating: 900,  themes: ['pin'] },     // exactly 1000 - 100 — the other edge
      { id: 7, rating: 1610, themes: ['fork'] },    // nearest to 1500 but NOT the lowest id
    ];
    eq(SERVE.eligibleInWindow(pool, 1000, 100, null, new Set()).length, 4,
       'whereBetween is inclusive at BOTH ends');
    eq(SERVE.eligibleInWindow(pool, 1000, 99, null, new Set()).length, 2,
       'and one point narrower excludes both edges');
    const pick = SERVE.lowestIdPicker;
    // Tier 1.
    let r = SERVE.serveRandom(pool, 1000, 100, null, new Set(), pick);
    eq(r.stage, 'windowUnseen', 'tier 1: unseen inside the window');
    eq(r.candidate.id, 1, 'and the picker chooses');
    eq(r.didReset, false, 'no reset');
    // Tier 2: window exhausted, anything unseen.
    r = SERVE.serveRandom(pool, 1000, 100, null, new Set([1, 2, 5, 6]), pick);
    eq(r.stage, 'anyUnseenRandom', 'tier 2: any unseen, random');
    eq(r.candidate.id, 3, 'lowest id of what is left');
    // Tier 3: everything seen.
    r = SERVE.serveRandom(pool, 1000, 100, null, new Set([1, 2, 3, 4, 5, 6, 7]), pick);
    eq(r.stage, 'afterResetRandom', 'tier 3: after the reset');
    eq(r.didReset, true, 'and it reports the reset');
    // Streak's tier 2 is CLOSEST-by-abs where Play's is random — the ladders genuinely differ.
    // The unseen set is {4 @1800, 7 @1610}: the closest to 1500 is 7, the lowest id is 4, so a
    // mutant that swapped one ladder for the other cannot hide behind a coincidence.
    r = SERVE.serveClosest(pool, 1500, 50, null, new Set([1, 2, 3, 5, 6]), pick);
    eq(r.stage, 'anyUnseenClosest', 'streak tier 2 is closest-by-abs');
    eq(r.candidate.id, 7, 'nearest to 1500, not lowest-id');
    eq(SERVE.serveRandom(pool, 1500, 50, null, new Set([1, 2, 3, 5, 6]), pick).candidate.id, 4,
       'where Play`s tier 2 takes the picker`s answer instead');
    // Thematic is the hybrid: random at tier 2, closest at tier 3.
    r = SERVE.serveThematic(pool, 1000, 200, 'fork', new Set([1]), pick);
    eq(r.stage, 'anyUnseenRandom', 'thematic tier 2 is random');
    eq(r.candidate.id, 3, 'and takes the picker`s answer, not the nearest (7 is nearer to 1000? no — 3 is)');
    r = SERVE.serveThematic(pool, 1000, 200, 'fork', new Set([1, 3, 7]), pick);
    eq(r.stage, 'afterResetClosest', 'thematic tier 3 is closest-by-abs');
    eq(r.candidate.id, 1, 'and picks the nearest fork');
    // Ties break on ascending id, which is why the corpus renumbers in rating order.
    const tied = [{ id: 9, rating: 1200, themes: [] }, { id: 4, rating: 1200, themes: [] }];
    eq(SERVE.closestByAbs(tied, 1200, null).id, 4, 'an ABS tie breaks on the lower id');
    // An empty pool reports `none` and still claims the reset, exactly as the PHP does.
    r = SERVE.serveClosest([], 1200, 50, null, new Set(), pick);
    eq(r.stage, 'none', 'an empty pool yields nothing');
    eq(r.didReset, true, 'and PHP still deleted the seen rows first');
  }

  // The scope decision, on its own.
  {
    let sc = STORE.scopeForReset('fork', 1200, 100, 5, 1000);
    eq(sc.kind, 'theme', 'a themed query scopes the wipe to its theme');
    eq(sc.theme, 'fork', 'the right theme');
    sc = STORE.scopeForReset(null, 1200, 100, 5, 1000);
    eq(sc.kind, 'window', 'an unthemed query scopes to its rating band');
    eq(sc.lo, 1100, 'band low');
    eq(sc.hi, 1300, 'band high');
    sc = STORE.scopeForReset('fork', 1200, 100, 1000, 1000);
    eq(sc.kind, 'all', 'only a genuinely exhausted corpus wipes everything');
  }

  // The store, over real slice data — this is the bug fix that matters.
  {
    const src = STORE.arraySource(DATA.puzzles);
    const seen = new Set();
    const store = STORE.create(src, { seen: seen, pick: SERVE.lowestIdPicker,
                                      daily: DATA.dailyPool });
    // Exhaust one narrow theme, then confirm every OTHER mode kept its history.
    const skewers = src.idsWithTheme('skewer');
    const others = DATA.puzzles.filter(p => !p.themes.includes('skewer')).map(p => p.id);
    for (const id of others) seen.add(id);
    for (const id of skewers) seen.add(id);
    const before = seen.size;
    eq(before, DATA.puzzles.length, 'everything is marked seen');
    // Reduce it: forget nothing but skewers.
    seen.clear();
    for (const id of others.slice(0, 300)) seen.add(id);
    for (const id of skewers) seen.add(id);
    const otherSeenBefore = others.slice(0, 300).filter(id => seen.has(id)).length;
    const r = store.nextThematic(1200, 'skewer');
    eq(r.didReset, true, 'the exhausted theme triggers a Tier-3 reset');
    eq(r.forgot.scope.kind, 'theme', 'and the wipe is scoped to that theme');
    const otherSeenAfter = others.slice(0, 300).filter(id => seen.has(id)).length;
    eq(otherSeenAfter, otherSeenBefore - (r.puzzle && !r.puzzle.themes.includes('skewer') ? 1 : 0),
       'no OTHER mode lost its history — this is spec fix #7');
    expect(r.forgot.removed >= skewers.length - 1,
      `the skewer history was cleared (${r.forgot.removed} of ${skewers.length})`);
    expect(!!r.puzzle, 'and a puzzle still came back');
  }

  // The store marks what it serves, so the same puzzle is not served twice in a row.
  {
    const store = STORE.create(STORE.arraySource(DATA.puzzles),
                               { seen: new Set(), pick: SERVE.lowestIdPicker });
    const a = store.nextRated(1200), b = store.nextRated(1200);
    expect(a.puzzle && b.puzzle, 'two rated serves both return puzzles');
    expect(a.puzzle.id !== b.puzzle.id, 'and they differ — the serve marks seen');
    eq(store.hasSeen(a.puzzle.id), true, 'the first is remembered');
    // Rated mode uses +-100, streak +-50, thematic +-200 (Part 7.2/7.3/7.4). Asserted by the
    // STAGE, against a source holding candidates only at exactly +-75 and +-150 from the centre:
    // "the served rating is within 100" is satisfied by a +-50 window too, so a narrowed window
    // survives it. Whether tier 1 fired does distinguish them.
    function ratingsOnly(list) {
      return STORE.arraySource(list.map((r, i) =>
        ({ id: i + 1, rating: r, themes: ['fork'], fen: '', moves: [] })));
    }
    const edge = STORE.create(ratingsOnly([1125, 1275, 1050, 1350]),
                              { seen: new Set(), pick: SERVE.lowestIdPicker });
    eq(edge.nextRated(1200).stage, 'windowUnseen',
       'rated reaches +-100: a candidate 75 points away is inside tier 1');
    const edge2 = STORE.create(ratingsOnly([1125, 1275]),
                               { seen: new Set(), pick: SERVE.lowestIdPicker });
    eq(edge2.nextStreak(1200).stage, 'anyUnseenClosest',
       'streak stops at +-50: the same 75-point candidate falls through to tier 2');
    const edge3 = STORE.create(ratingsOnly([1050, 1350]),
                               { seen: new Set(), pick: SERVE.lowestIdPicker });
    eq(edge3.nextThematic(1200, 'fork').stage, 'windowUnseen',
       'thematic reaches +-200: a candidate 150 points away is inside tier 1');
    eq(STORE.create(ratingsOnly([1050, 1350]), { seen: new Set(), pick: SERVE.lowestIdPicker })
         .nextRated(1200).stage, 'anyUnseenRandom',
       'and rated does not: 150 points is outside its +-100');

    const st = store.nextStreak(1500);
    expect(Math.abs(st.puzzle.rating - 1500) <= 50, 'streak serves inside +-50');
    const th = store.nextThematic(1500, 'fork');
    expect(Math.abs(th.puzzle.rating - 1500) <= 200, 'thematic serves inside +-200');
    expect(th.puzzle.themes.includes('fork'), 'and honours the theme');
    let threw = false;
    try { store.nextThematic(1200, null); } catch (e) { threw = true; }
    expect(threw, 'thematic without a theme is a programming error, not a silent full-corpus serve');
    // The warmup filter Streak and Turbo open with.
    const warm = store.nextStreak(600, 'mateIn1');
    expect(warm.puzzle.themes.includes('mateIn1'), 'the streak warmup filters to mateIn1');
    expect(Math.abs(warm.puzzle.rating - 600) <= 50, 'at 600 +- 50');
  }

  // =====================================================================================
  // 9. The daily puzzle (Part 11.1) — deterministic, LOCAL calendar
  // =====================================================================================
  {
    const store = STORE.create(STORE.arraySource(DATA.puzzles),
                               { seen: new Set(), daily: DATA.dailyPool });
    const d1 = store.daily(new Date(2026, 7, 11, 9, 0));
    const d2 = store.daily(new Date(2026, 7, 11, 23, 59));
    eq(d1.puzzle.id, d2.puzzle.id, 'the same calendar day gives the same puzzle');
    const d3 = store.daily(new Date(2026, 7, 12, 0, 1));
    expect(d3.dayIndex !== d1.dayIndex, 'the next day gives a different index');
    eq(store.daily(new Date(2026, 0, 1)).dayIndex, 0, 'the epoch is day 0');
    eq(store.daily(new Date(2026, 0, 2)).dayIndex, 1, 'the day after is 1');
    // Dates BEFORE the epoch must not produce a negative index — the double modulo.
    const past = store.daily(new Date(2025, 5, 15));
    expect(past.dayIndex >= 0 && past.dayIndex < DATA.dailyPool.length,
      `a pre-epoch date stays in range: ${past.dayIndex}`);
    expect(!!past.puzzle, 'and still resolves to a puzzle');
    // It must not consume the seen set: today's puzzle staying available elsewhere is the point.
    eq(store.hasSeen(d1.puzzle.id), false, 'the daily puzzle is not marked seen');
    // Local, not UTC: 23:00 local on the 11th is the 11th, whatever UTC thinks.
    eq(STORE.localDayNumber(new Date(2026, 7, 11, 23, 0)),
       STORE.localDayNumber(new Date(2026, 7, 11, 0, 30)),
       'the day number is local — fix #1');
    expect(STORE.localDayNumber(new Date(2026, 7, 12, 0, 30))
           === STORE.localDayNumber(new Date(2026, 7, 11, 23, 0)) + 1,
      'and rolls over at local midnight');
    // Consecutive dates must walk the pool without repeating until it genuinely wraps. Stated
    // against the pool's own size: the device pool is 26,966 (the corpus gate pins it >= 3,000,
    // i.e. 8+ years), while the browser slice is deliberately shorter.
    const seenIdx = new Set();
    for (let i = 0; i < 365; i++) {
      seenIdx.add(store.daily(new Date(2026, 0, 1 + i)).dayIndex);
    }
    eq(seenIdx.size, Math.min(365, DATA.dailyPool.length),
       'consecutive dates give distinct puzzles until the pool wraps');
    expect(DATA.dailyPool.length >= 365,
      `the demo pool covers a year without wrapping: ${DATA.dailyPool.length}`);
    eq(store.daily(new Date(2026, 0, 1 + DATA.dailyPool.length)).dayIndex, 0,
       'and wraps back to index 0 exactly at the pool length');
  }

  // =====================================================================================
  // 10. Progress: the rated ledger (Part 8)
  // =====================================================================================
  {
    const t0 = Date.UTC(2026, 7, 11, 10, 0);
    let st = PROG.seed(t0);
    eq(st.profile.rating, 1200, 'a new profile starts at 1200');
    eq(st.profile.highestRating, 1200, 'and its high-water mark matches');
    eq(Object.keys(st.rushBest).length, 3, 'three RushBest rows are seeded');
    eq(st.streak.puzzleRating, 600, 'the streak ramp starts at 600');
    eq(st.attempts.length, 0, 'nothing else is seeded');

    const r1 = PROG.recordRatedAttempt(st, { puzzleId: 10, isCorrect: true, puzzleRating: 1300,
                                             themes: ['fork', 'pin'], solveTimeSeconds: 12 }, t0);
    const want = RATING.evaluate(1200, 1300, true);
    eq(r1.ratingChange, want.ratingChange, 'the Elo delta comes from the pinned engine');
    eq(st.profile.rating, want.newRating, 'and is applied');
    eq(st.profile.highestRating, want.newRating, 'highestRating follows a rise');
    eq(st.attempts.length, 1, 'one ledger row');
    eq(st.attempts[0].solveTimeSeconds, 12, 'solve time is kept locally (it was thrown away server-side)');
    eq(st.themeStats.fork.attempted, 1, 'ThemeStat attempted');
    eq(st.themeStats.fork.solved, 1, 'ThemeStat solved');
    eq(st.themeStats.pin.attempted, 1, 'every theme on the puzzle is counted');
    eq(r1.countedTowardGoal, true, 'a correct rated solve counts toward the goal');

    // A replay changes nothing at all.
    const highBefore = st.profile.highestRating, ratingBefore = st.profile.rating;
    const r2 = PROG.recordRatedAttempt(st, { puzzleId: 10, isCorrect: true, puzzleRating: 1300,
                                             themes: ['fork', 'pin'] }, t0 + 1000);
    eq(r2.firstAttempt, false, 'a replay is not a first attempt');
    eq(r2.ratingChange, 0, 'and moves nothing');
    eq(st.profile.rating, ratingBefore, 'the rating is unchanged');
    eq(st.attempts.length, 1, 'no second ledger row');
    eq(st.themeStats.fork.attempted, 1, 'no second ThemeStat bump');
    eq(r2.countedTowardGoal, false, 'and no second daily-goal credit');

    // Wrong answers move the rating too — that is the point of a rating.
    const before = st.profile.rating;
    const r3 = PROG.recordRatedAttempt(st, { puzzleId: 11, isCorrect: false, puzzleRating: 1000,
                                             themes: ['endgame'] }, t0);
    expect(r3.ratingChange < 0, 'a wrong answer costs rating');
    eq(st.profile.rating, before + r3.ratingChange, 'applied');
    eq(st.profile.highestRating, highBefore, 'a fall does not lower highestRating');
    eq(st.themeStats.endgame.attempted, 1, 'a failed attempt still counts as attempted');
    eq(st.themeStats.endgame.solved, 0, 'but not as solved');
    eq(r3.countedTowardGoal, false, 'and a wrong answer earns no goal credit');

    // The floor. Against an EQUALLY rated puzzle, not a 2800: a 401-rated user who fails a 2800
    // loses ~0 points (expected score is ~0.000001), so the floor is never reached and a mutant
    // that dropped it survives. Failing a 400 costs 16 and would land on 385.
    let low = PROG.seed(t0);
    low.profile.rating = 401;
    const lr = PROG.recordRatedAttempt(low, { puzzleId: 1, isCorrect: false, puzzleRating: 400,
                                              themes: [] }, t0);
    expect(lr.ratingChange <= -10,
      `an even-money loss is a real drop, so the floor is actually exercised: ${lr.ratingChange}`);
    eq(low.profile.rating, 400, 'the rating floor holds at exactly 400');
    eq(low.attempts[0].ratingAfter, 400, 'and the ledger records the floored value');

    // Fix #9: history is the NEWEST rows.
    let h = PROG.seed(t0);
    for (let i = 0; i < 40; i++) {
      PROG.recordRatedAttempt(h, { puzzleId: i, isCorrect: true, puzzleRating: 1200, themes: [] },
                              t0 + i * 1000);
    }
    const hist = PROG.ratingHistory(h, 30);
    eq(hist.length, 30, 'history is capped at 30');
    eq(hist[0].puzzleId, 39, 'and starts with the NEWEST — the server took the oldest (fix #9)');
    eq(hist[29].puzzleId, 10, 'walking back 30');
  }

  // =====================================================================================
  // 11. Progress: the daily goal (Part 15)
  // =====================================================================================
  {
    const day = (y, m, d, h) => new Date(y, m - 1, d, h == null ? 12 : h).getTime();
    let st = PROG.seed(day(2026, 8, 11));
    let g = PROG.dailyGoalStatus(st, day(2026, 8, 11));
    eq(g.solvedToday, 0, 'nothing solved yet');
    eq(g.target, 10, 'the target is the server`s literal 10');
    eq(g.goalStreak, 0, 'no streak');
    eq(g.complete, false, 'not complete');

    for (let i = 0; i < 10; i++) PROG.recordSolve(st, 'thematic', day(2026, 8, 11));
    g = PROG.dailyGoalStatus(st, day(2026, 8, 11));
    eq(g.solvedToday, 10, 'ten solves');
    eq(g.complete, true, 'the goal completes at 10');
    eq(g.progress, 1, 'and the ring is full');
    PROG.recordSolve(st, 'thematic', day(2026, 8, 11));
    eq(PROG.dailyGoalStatus(st, day(2026, 8, 11)).progress, 1, 'the ring does not overfill');

    // Turbo is excluded, in one place.
    const beforeTurbo = st.dailySolves[PROG.dayKey(day(2026, 8, 11))];
    const tr = PROG.recordSolve(st, 'turbo', day(2026, 8, 11));
    eq(tr.counted, false, 'a Turbo solve does not count');
    eq(st.dailySolves[PROG.dayKey(day(2026, 8, 11))], beforeTurbo, 'and does not move the counter');

    // The streak, anchored to today or yesterday.
    let s2 = PROG.seed(day(2026, 8, 1));
    for (const d of [7, 8, 9, 10, 11]) PROG.recordSolve(s2, 'play', day(2026, 8, d));
    eq(PROG.goalStreakDays(s2, day(2026, 8, 11)), 5, 'five consecutive days');
    eq(PROG.goalStreakDays(s2, day(2026, 8, 12)), 5,
       'the streak survives the whole of the following day');
    eq(PROG.goalStreakDays(s2, day(2026, 8, 13)), 0, 'and dies the day after that');
    let s3 = PROG.seed(day(2026, 8, 1));
    for (const d of [5, 6, 9, 10, 11]) PROG.recordSolve(s3, 'play', day(2026, 8, d));
    eq(PROG.goalStreakDays(s3, day(2026, 8, 11)), 3, 'a gap breaks the streak');
    eq(PROG.goalStreakDays(PROG.seed(day(2026, 8, 11)), day(2026, 8, 11)), 0, 'no solves, no streak');

    // Day keys are local, and roll at local midnight.
    eq(PROG.dayKey(new Date(2026, 7, 11, 23, 59).getTime()), '2026-08-11', 'late evening is today');
    eq(PROG.dayKey(new Date(2026, 7, 12, 0, 1).getTime()), '2026-08-12', 'past midnight is tomorrow');
    eq(PROG.dayNumber('2026-08-12') - PROG.dayNumber('2026-08-11'), 1, 'day numbers are contiguous');
    eq(PROG.keyOfDayNumber(PROG.dayNumber('2026-03-15')), '2026-03-15', 'day keys round-trip');
    // Across a DST boundary, where subtracting local midnights would be off by one.
    eq(PROG.dayNumber('2026-03-30') - PROG.dayNumber('2026-03-29'), 1, 'DST spring forward');
    eq(PROG.dayNumber('2026-10-26') - PROG.dayNumber('2026-10-25'), 1, 'DST fall back');
  }

  // =====================================================================================
  // 12. Progress: Daily Puzzle state, runs, drafts
  // =====================================================================================
  {
    const day = (m, d) => new Date(2026, m - 1, d, 12).getTime();
    let st = PROG.seed(day(8, 1));
    let r = PROG.recordDailyPuzzleSolve(st, day(8, 9));
    eq(r.streak, 1, 'the first daily solve starts a streak');
    eq(st.daily.totalSolved, 1, 'and counts');
    r = PROG.recordDailyPuzzleSolve(st, day(8, 9));
    eq(r.alreadySolvedToday, true, 'solving twice on one day is caught');
    eq(st.daily.streak, 1, 'and does not double the streak');
    eq(st.daily.totalSolved, 1, 'nor the total');
    r = PROG.recordDailyPuzzleSolve(st, day(8, 10));
    eq(r.streak, 2, 'the next day continues it');
    r = PROG.recordDailyPuzzleSolve(st, day(8, 13));
    eq(r.streak, 1, 'a missed day restarts it');
    eq(st.dailySolves[PROG.dayKey(day(8, 13))], 1, 'a daily solve also feeds the goal counter');
  }
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);
    let r = PROG.endStreakRun(st, 7, 0, t);
    eq(r.isNewBest, true, 'a first run is a best');
    eq(st.streak.bestStreak, 7, 'recorded');
    eq(st.streakRuns.length, 1, 'and written to history');
    eq(st.streak.currentStreak, 0, 'the run resets');
    eq(st.streak.puzzleRating, 600, 'and so does the difficulty ramp');
    r = PROG.endStreakRun(st, 3, 7, t + 1);
    eq(r.isNewBest, false, 'a shorter run is not a best');
    eq(st.streak.bestStreak, 7, 'and does not lower it — one source of truth (fix #8)');
    r = PROG.endStreakRun(st, 0, 7, t + 2);
    eq(st.streakRuns.length, 2, 'a zero-length run is not written to history');
  }
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);
    // Every ending goes through one function with the real reason (fixes #5, #6, #13).
    let r = PROG.endRushRun(st, 3, 24, 1, 'timeUp', t);
    eq(r.isNewBest, true, 'first timed run is a best');
    eq(st.rushBest[3], 24, 'best score saved');
    eq(st.rushRuns[0].reason, 'timeUp', 'the real reason is stored');
    r = PROG.endRushRun(st, 3, 12, 3, 'threeMistakes', t + 1);
    eq(st.rushRuns[1].reason, 'threeMistakes', 'three mistakes is not "Time`s Up!" (fix #6)');
    eq(st.rushBest[3], 24, 'a worse run does not lower the best');
    r = PROG.endRushRun(st, 0, 40, 0, 'quit', t + 2);
    eq(st.rushRuns[2].reason, 'quit', 'quitting still writes history (fix #13)');
    eq(st.rushBest[0], 40, 'and still saves the best');
    const rowsBefore = st.rushRuns.length;
    PROG.endRushRun(st, 3, 0, 1, 'quit', t + 5);
    eq(st.rushRuns.length, rowsBefore,
       'but a SCORELESS run writes none — an instant quit must not pollute Recent Runs');
    eq(PROG.rushBestFor(st, 3), 24, 'and cannot lower the best');
    eq(st.rushBest[3], 24, 'per-mode bests are independent');
    PROG.saveRushDraft(st, { score: 5, mistakes: 1, targetRating: 900, puzzlesServed: 6 }, t);
    PROG.endRushRun(st, 0, 5, 1, 'backgrounded', t + 3);
    eq(st.rushDraft, null, 'ending an infinite run clears its draft');
    // The reason is enumerated, not a free string: Swift's is an enum, so a typo there is a
    // compile error while here it would have silently reached the results screen.
    eq(PROG.RUSH_END_REASONS.join(','), 'timeUp,threeMistakes,quit,backgrounded,finished',
       'the five end reasons, matching the Swift enum');
    let badReason = false;
    try { PROG.endRushRun(st, 0, 1, 0, 'timesUp', t + 4); } catch (e) { badReason = true; }
    expect(badReason, 'a misspelled end reason throws rather than reaching the results screen');
    // Keyed by STRING in both languages — JSON object keys are strings, so a numeric key here
    // round-tripped to a string and the two sides disagreed about which slot `3` was.
    expect(Object.keys(PROG.seed(t).rushBest).every(k => typeof k === 'string'),
      'rushBest is keyed by string, matching Swift`s [String: Int]');
    eq(JSON.stringify(Object.keys(PROG.seed(t).rushBest)), '["0","3","5"]',
       'and the three modes are seeded under those keys');
    const roundTrip = JSON.parse(JSON.stringify(st));
    eq(roundTrip.rushBest['3'], st.rushBest['3'], 'so a JSON round-trip finds the same slot');
  }
  {
    const t = Date.UTC(2026, 7, 11, 10);
    const DAY = 24 * 60 * 60 * 1000;
    let st = PROG.seed(t);
    PROG.savePlayDraft(st, 77, t);
    eq(PROG.loadPlayDraft(st, t + DAY - 1000).puzzleId, 77, 'a draft under 24h restores');
    eq(PROG.loadPlayDraft(st, t + DAY + 1000), null, 'a draft over 24h does not');
    eq(st.playDraft, null, 'and the stale draft is cleared');
    PROG.saveRushDraft(st, { score: 9, mistakes: 2, targetRating: 1100, puzzlesServed: 11 }, t);
    eq(PROG.loadRushDraft(st, t + 1000).score, 9, 'a rush draft under 24h restores');
    eq(PROG.loadRushDraft(st, t + DAY + 1), null, 'and expires the same way');
    eq(st.rushDraft, null, 'clearing itself as it goes');
  }

  // The whole state must survive a JSON round-trip — that is the persistence mechanism.
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);
    PROG.recordRatedAttempt(st, { puzzleId: 3, isCorrect: true, puzzleRating: 1250,
                                  themes: ['fork'], solveTimeSeconds: 8 }, t);
    PROG.recordSolve(st, 'streak', t);
    PROG.endStreakRun(st, 4, 0, t);
    PROG.savePlayDraft(st, 3, t);
    const seen = PROG.seenSet(st);
    seen.add(5); seen.add(1);
    PROG.commitSeen(st, seen);
    eq(JSON.stringify(st.seen), '[1,5]', 'the seen set serialises sorted, so the file is stable');
    const round = JSON.parse(JSON.stringify(st));
    eq(JSON.stringify(round), JSON.stringify(st), 'the whole state round-trips through JSON');
    eq(round.version, PROG.STATE_VERSION, 'and carries its version');
    // A stored state from another version is discarded rather than half-read.
    const fake = { getItem: () => JSON.stringify({ version: 99 }), setItem: () => {} };
    eq(PROG.load(t, fake).version, PROG.STATE_VERSION, 'a foreign version reseeds');
    const broken = { getItem: () => '{not json', setItem: () => {} };
    eq(PROG.load(t, broken).profile.rating, 1200, 'corrupt storage reseeds rather than throwing');
  }

  // =====================================================================================
  // 12b. Streak mid-run: the ramp, the lock, and the goal credit
  // =====================================================================================
  // All three were unreachable before: `StreakEngine.increment` had no caller, `pendingPuzzleId`
  // had no writer or reader, and `recordSolve` was only ever reached from the rated and daily
  // paths — so a Streak solve moved no counter at all.
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);

    // The target the store should be asked for, straight from the pinned engine.
    let tgt = PROG.streakTarget(st);
    eq(tgt.rating, 600, 'the first streak puzzle is served at 600');
    eq(tgt.theme, 'mateIn1', 'and is a mate-in-1');

    PROG.lockStreakPuzzle(st, 4242);
    eq(PROG.pendingStreakPuzzle(st), 4242,
       'serving the first puzzle takes the anti-reroll lock');

    // Ten solves: the streak climbs, the ramp climbs underneath the warmup, the lock follows.
    for (let i = 0; i < 10; i++) PROG.recordStreakSolve(st, 5000 + i, t + i);
    eq(st.streak.currentStreak, 10, 'ten solves');
    eq(st.streak.bestStreak, 10, 'and a new best');
    eq(st.streak.puzzleRating, 1100, 'the ramp ran through the warmup, reaching 1100');
    eq(PROG.pendingStreakPuzzle(st), 5009, 'the lock points at the puzzle about to be served');
    tgt = PROG.streakTarget(st);
    eq(tgt.rating, 1100, 'so puzzle 11 is served at 1100 — the difficulty cliff');
    eq(tgt.theme, null, 'with no theme filter');

    // The goal credit that was previously unreachable.
    eq(PROG.dailyGoalStatus(st, t).solvedToday, 10, 'ten Streak solves credit the daily goal');

    // Part 22.6: leaving and re-entering must return the IDENTICAL puzzle.
    const locked = PROG.pendingStreakPuzzle(st);
    const roundTripped = JSON.parse(JSON.stringify(st));
    eq(PROG.pendingStreakPuzzle(roundTripped), locked,
       'the lock survives a save/load round trip — a hard puzzle cannot be rerolled by leaving');

    // Failure releases it, and preserves the best.
    // `bestBefore` is captured when the run STARTS, before `increment` has raised it. Passing the
    // live value instead is what made this badge unreachable — see the note on `endStreakRun`.
    const run = PROG.endStreakRun(st, st.streak.currentStreak, 0, t + 100);
    eq(run.length, 10, 'the run is recorded at its full length');
    eq(run.isNewBest, true,
       'and it IS a new best. Previously unreachable: increment had already raised bestStreak to '
       + 'the run length before endStreakRun compared them, so the badge could never appear');
    eq(st.streak.currentStreak, 0, 'the streak resets');
    eq(st.streak.puzzleRating, 600, 'so does the ramp');
    eq(PROG.pendingStreakPuzzle(st), null, 'and the lock is released');
    eq(st.streak.bestStreak, 10, 'but the best survives');

    // A TIE **is** celebrated — deliberate parity with the RN screen, which ends a run on
    // `currentStreak >= bestStreak`. Its `>=` was compensating for a mid-run server bump;
    // `bestBefore` removes the need for that, but matching your record still shows the badge,
    // because that is what the app users know does.
    let tie = PROG.seed(t);
    tie.streak.bestStreak = 6;
    for (let i = 0; i < 6; i++) PROG.recordStreakSolve(tie, 700 + i, t + i);
    eq(PROG.endStreakRun(tie, 6, 6, t + 50).isNewBest, true,
       'equalling your best is celebrated, exactly as the source does');
    // But falling short is not, and neither is a run of zero.
    let short = PROG.seed(t);
    short.streak.bestStreak = 6;
    eq(PROG.endStreakRun(short, 5, 6, t + 50).isNewBest, false,
       'one short of the record is not a new best');
    let none = PROG.seed(t);
    eq(PROG.endStreakRun(none, 0, 0, t + 50).isNewBest, false,
       'and a streak of zero never is, even against a best of zero');
    let beat = PROG.seed(t);
    beat.streak.bestStreak = 6;
    for (let j = 0; j < 7; j++) PROG.recordStreakSolve(beat, 800 + j, t + j);
    eq(PROG.endStreakRun(beat, 7, 6, t + 50).isNewBest, true, 'but one more is');
  }

  // =====================================================================================
  // 12c. Thematic: ThemeStat yes, Elo never
  // =====================================================================================
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);
    const ratingBefore = st.profile.rating;
    const r = PROG.recordThematicAttempt(st, ['fork', 'pin'], true, t);
    eq(st.profile.rating, ratingBefore, 'a Thematic solve never moves the rating');
    eq(st.attempts.length, 0, 'and writes no ledger row');
    eq(st.themeStats.fork.attempted, 1, 'but it does count the theme');
    eq(st.themeStats.fork.solved, 1, 'as solved');
    eq(st.themeStats.pin.attempted, 1, 'for every theme on the puzzle');
    eq(r.countedTowardGoal, true, 'and it credits the daily goal');
    PROG.recordThematicAttempt(st, ['fork'], false, t);
    eq(st.themeStats.fork.attempted, 2, 'a wrong try still counts as attempted');
    eq(st.themeStats.fork.solved, 1, 'but not as solved');
    eq(st.profile.rating, ratingBefore, 'and still does not touch the rating');
    eq(PROG.dailyGoalStatus(st, t).solvedToday, 1, 'only the correct one credited the goal');
  }

  // =====================================================================================
  // 12d. Run history — what replaced the two leaderboards
  // =====================================================================================
  {
    const t = Date.UTC(2026, 7, 11, 10);
    let st = PROG.seed(t);
    for (let i = 0; i < 14; i++) PROG.endStreakRun(st, i + 1, i, t + i * 1000);
    const runs = PROG.recentStreakRuns(st);
    eq(runs.length, 10, 'the last ten streak runs');
    eq(runs[0].length, 14, 'newest first');
    eq(runs[9].length, 5, 'walking back ten');
    eq(PROG.recentStreakRuns(st, 3).length, 3, 'the limit is honoured');
    // Ties break on length, so two runs finishing in the same millisecond keep a stable order.
    let tied = PROG.seed(t);
    PROG.endStreakRun(tied, 3, 0, t);
    PROG.endStreakRun(tied, 9, 3, t);
    eq(PROG.recentStreakRuns(tied)[0].length, 9, 'an endedAt tie breaks on the longer run');

    let rush = PROG.seed(t);
    PROG.endRushRun(rush, 3, 20, 1, 'timeUp', t);
    PROG.endRushRun(rush, 5, 30, 0, 'timeUp', t + 1);
    PROG.endRushRun(rush, 3, 25, 2, 'threeMistakes', t + 2);
    eq(PROG.recentRushRuns(rush, 3).length, 2, 'rush history filters by mode');
    eq(PROG.recentRushRuns(rush, 3)[0].score, 25, 'newest first');
    eq(PROG.recentRushRuns(rush, 5).length, 1, 'the other mode has its own list');
    eq(PROG.recentRushRuns(rush, 0).length, 0, 'and an unplayed mode has none');
    eq(PROG.rushBestFor(rush, 3), 25, 'the per-mode best');
    eq(PROG.rushBestFor(rush, 0), 0, 'zero when unplayed');
  }

  // =====================================================================================
  // 13. The comparator that must never be called (fix #10)
  // =====================================================================================
  {
    const src = require('fs').readFileSync(path.join(JS, 'puzzle-session.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.indexOf('compareMoves') < 0,
      'the session never calls compareMoves — it compares against moves[0], the OPPONENT`s move');
    // It still exists, and is still pinned, because the goldens cover it.
    eq(RATING.compareMoves(['a2a4', 'b7b5'], ['a2a4']), true,
       'compareMoves survives as a parity artifact');
    eq(RATING.compareMoves(['a2a4', 'b7b5'], ['b7b5']), false,
       'and demonstrably compares only the first move');
  }

  // =====================================================================================
  // 14. The BROWSER load path — classic scripts, in index.html's order
  // =====================================================================================
  // Node resolves these with `require`; a browser does not. Twice in this rebuild a module has
  // referenced a global it never loaded (`MET.TIMINGS.doubleTap`, then `PE.*` without
  // `position-editor.js`) and every Node suite stayed green while the real page threw inside a
  // click handler where nothing surfaced it. So: evaluate the real files in a bare sandbox with a
  // `window`, in the exact order the page lists them, and prove the globals resolve.
  {
    const vm = require('vm');
    const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
    const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
    const ours = ['puzzle-data.js', 'puzzle-serving.js', 'puzzle-session.js', 'puzzle-store.js',
                  'streak-engine.js', 'puzzle-progress.js'];
    for (const f of ours) expect(order.includes(f), `index.html loads js/${f}`);
    // Order matters: each of these reads the previous ones' globals at load time.
    const at = (f) => order.indexOf(f);
    expect(at('engine.js') < at('puzzle-session.js'), 'engine.js loads before puzzle-session.js');
    expect(at('rating.js') < at('puzzle-progress.js'), 'rating.js loads before puzzle-progress.js');
    expect(at('puzzle-serving.js') < at('puzzle-store.js'),
      'puzzle-serving.js loads before puzzle-store.js');
    expect(at('puzzle-session.js') < at('puzzle-progress.js'),
      'puzzle-session.js loads before puzzle-progress.js');
    expect(at('streak-engine.js') < at('puzzle-progress.js'),
      'streak-engine.js loads before puzzle-progress.js');

    const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, Set, Map, Array, Object,
                      String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    let loadError = null;
    for (const f of ['engine.js', 'rating.js', ...ours]) {
      try {
        vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), sandbox, { filename: f });
      } catch (e) { loadError = `${f}: ${e.message}`; break; }
    }
    eq(loadError, null, 'every puzzle script loads in a browser-shaped scope');
    for (const g of ['BiyaPuzzleData', 'BiyaPuzzleServing', 'BiyaPuzzleSession', 'BiyaPuzzleStore',
                     'BiyaStreakEngine', 'BiyaPuzzleProgress']) {
      expect(typeof sandbox[g] === 'object' && sandbox[g] !== null,
        `${g} is exposed as a browser global`);
    }
    // ...and the browser copies are the same code, not a stale duplicate.
    if (!loadError) {
      eq(sandbox.BiyaPuzzleSession.TIMING.opponentDelayMs.daily, S.TIMING.opponentDelayMs.daily,
         'the browser-loaded session carries the same timings');
      eq(sandbox.BiyaPuzzleProgress.DAILY_TARGET, PROG.DAILY_TARGET,
         'and the browser-loaded progress store the same target');
      eq(sandbox.BiyaPuzzleData.puzzles.length, DATA.puzzles.length, 'and the same corpus slice');
      // The one that only bites in a browser: `require` is absent there, so a module that reaches
      // for a dependency through it rather than through the global would throw on first use.
      const s = sandbox.BiyaPuzzleSession.create(DATA.puzzles[0], 'play');
      eq(sandbox.BiyaPuzzleSession.applySetupMove(s).applied, true,
         'and the session actually runs with no `require` available');
      const st = sandbox.BiyaPuzzleStore.create(
        sandbox.BiyaPuzzleStore.arraySource(sandbox.BiyaPuzzleData.puzzles),
        { seen: new Set(), daily: sandbox.BiyaPuzzleData.dailyPool });
      expect(!!st.nextRated(1200).puzzle, 'the store serves with no `require` available');
      expect(!!st.daily(new Date(2026, 7, 11)).puzzle, 'and resolves a daily puzzle');
    }
  }

  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `PuzzleCore: ${passed} assertions passed`
      : `PuzzleCore: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
