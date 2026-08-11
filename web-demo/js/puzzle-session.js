/* puzzle-session.js — the one solver core all five puzzle modes configure.
 *
 * Twin of `Sources/BiyaherongCoachCore/PuzzleSession.swift`. Part 5 of the Puzzle Hub spec.
 *
 * ── The shape, and why ────────────────────────────────────────────────────────
 * PURE. No timers, no sounds, no DB, no view. Every operation is a synchronous state transition
 * that RETURNS what should happen next ("play the capture sound", "let the opponent reply in
 * 500 ms", "the run is over") and lets the caller own the clock. That is what makes all five
 * modes assertable in Node and in Swift with no test doubles: the spec's `after(opponentDelay)`
 * closures become returned numbers.
 *
 * ── The move convention (5.1), which everything rests on ─────────────────────
 * `moves[0]` belongs to the OPPONENT, so the FEN's side-to-move field names the opponent and the
 * solver is the other colour. `moveIndex` starts at 1 and advances by 2. Every puzzle in the
 * bundle has an even move count — asserted corpus-wide in `tools/qa/puzzle_corpus_check.js` — so
 * the last move in the list is always the solver's.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 * `selectedSquare` (pure view state), sounds, haptics, the rated clock, and Elo. Rating lives in
 * `rating.js` / `PuzzleRatingEngine`, which is already pinned to the PHP oracle.
 *
 * NEVER call `Rating.compareMoves` from here. It exists as a faithful port of the server's
 * `compareMoves`, which compares the user's move against `moves[0]` — the OPPONENT's move — and
 * is spec fix #10. It is kept only because the golden vectors pin it. `submit` below validates
 * the real line instead.
 */
'use strict';

var BiyaPuzzleSession = (function () {
  var E = (typeof module !== 'undefined' && module.exports)
    ? require('./engine.js')
    : (typeof window !== 'undefined' ? window.Engine : Engine);

  var MODES = ['play', 'daily', 'thematic', 'streak', 'turbo'];

  // Part 17, the Master Timing Table. Note it disagrees with Part 5.3, which says "500 ms
  // everywhere except Puzzle Turbo". Part 17 gives Daily 400 ms and is the table titled "master",
  // so it wins; recorded in PORTING_NOTES.md.
  var TIMING = {
    opponentDelayMs: { play: 500, daily: 400, thematic: 500, streak: 500, turbo: 300 },
    turboAdvanceMs: 500,        // next puzzle after a solve or a mistake
    turboFeedbackMs: 500,       // the ✓/✕ dot's lifetime
    dailyWrongBannerMs: 1300,
    tickMs: 1000,               // rated timer / Turbo clock
    goalRingMs: 400,
    draftTtlMs: 24 * 60 * 60 * 1000,
    turboSeconds: { 0: 0, 3: 180, 5: 300 },
  };

  // Part 5.5 — the one place the modes genuinely differ. Kept as DATA so the spec's table can be
  // read off it line for line, rather than as five branches inside submit().
  var WRONG_POLICY = {
    // undo:         does the wrong move get taken back?
    // staysPlayable: can the user just keep trying, with no explicit Retry?
    // endsRun:      does the whole run end here?
    // costsALife:   Turbo's three-mistake budget
    // bannerMs:     lifetime of the "wrong" banner, null = no timed banner
    // advanceMs:    auto-advance to the next puzzle after this long, null = wait for the user
    // gameOverSound:play the game-over sound
    play:     { undo: true,  staysPlayable: false, endsRun: false, costsALife: false,
                bannerMs: null, advanceMs: null, gameOverSound: false, offersRetry: true },
    daily:    { undo: true,  staysPlayable: true,  endsRun: false, costsALife: false,
                bannerMs: TIMING.dailyWrongBannerMs, advanceMs: null, gameOverSound: false,
                offersRetry: true },
    thematic: { undo: true,  staysPlayable: false, endsRun: false, costsALife: false,
                bannerMs: null, advanceMs: null, gameOverSound: false, offersRetry: true },
    streak:   { undo: true,  staysPlayable: false, endsRun: true,  costsALife: false,
                bannerMs: null, advanceMs: null, gameOverSound: true,  offersRetry: false },
    // Turbo does NOT undo: the piece stays on the wrong square under a red ✕ and the next puzzle
    // mounts 500 ms later. Deliberately brutal in the original; kept.
    turbo:    { undo: false, staysPlayable: false, endsRun: false, costsALife: true,
                bannerMs: null, advanceMs: TIMING.turboAdvanceMs, gameOverSound: false,
                offersRetry: false },
  };

  // Part 15.1 — the single predicate, in a single place, so "does Turbo count?" is one edit.
  // A 3-minute Turbo run can produce 30 solves and would make a 10-a-day goal meaningless.
  function countsTowardDailyGoal(mode) { return mode !== 'turbo'; }

  function opponentDelayMs(mode) { return TIMING.opponentDelayMs[mode]; }

  /** The solver's colour: the OPPOSITE of the FEN's side to move (5.1). */
  function userColorOf(fen) {
    var pos = E.fromFEN(fen);
    return pos ? E.opponent(pos.sideToMove) : null;
  }

  /**
   * A new session, in `loading`. The caller then plays the game-start sound and calls
   * `applySetupMove` after `opponentDelayMs(mode)` — that is Part 5.3 steps 4 and 5.
   */
  function create(puzzle, mode) {
    if (MODES.indexOf(mode) < 0) throw new Error('unknown puzzle mode: ' + mode);
    var pos = E.fromFEN(puzzle.fen);
    if (!pos) throw new Error('unparseable puzzle FEN: ' + puzzle.fen);
    var moves = Array.isArray(puzzle.moves) ? puzzle.moves.slice() : String(puzzle.moves).split(' ');
    return {
      puzzle: { id: puzzle.id, fen: puzzle.fen, moves: moves, rating: puzzle.rating,
                themes: puzzle.themes || [], openingTags: puzzle.openingTags || [] },
      mode: mode,
      position: pos,
      moveIndex: 1,                       // 5.1: index 1 is the solver's first expected move
      phase: 'loading',
      lastMove: null,
      pendingOpponentIndex: null,
      userColor: E.opponent(pos.sideToMove),
      // The board is flipped when the solver plays Black, so the solver is always at the bottom.
      flipped: E.opponent(pos.sideToMove) === E.BLACK,
      mistakes: 0,
      solvedByCheckmate: false,
    };
  }

  /** Part 5.3 step 5 — apply `moves[0]`. Returns the sound the caller should play. */
  function applySetupMove(s) {
    if (s.phase !== 'loading') return { applied: false };
    var m = E.parseUci(s.position, s.puzzle.moves[0]);
    if (!m) throw new Error('illegal setup move ' + s.puzzle.moves[0] + ' in ' + s.puzzle.fen);
    var captured = isCapture(s.position, m);
    s.position = E.makeMove(s.position, m);
    s.lastMove = { from: E.sqName(m.from), to: E.sqName(m.to) };
    s.phase = 'playing';
    return { applied: true, sound: captured ? 'capture' : 'move', uci: s.puzzle.moves[0] };
  }

  function isCapture(pos, m) {
    return pos.squares[m.to] != null
      || (pos.squares[m.from].kind === E.PAWN && m.to === pos.enPassant);
  }

  /**
   * Part 5.6 — a pawn landing on the far rank. Asked BEFORE the move is applied, from both the
   * tap and the drag path, because the promotion piece is an input to the move, not a follow-up.
   */
  function needsPromotion(s, from, to) {
    var f = E.sqIndex(from), t = E.sqIndex(to);
    if (f == null || t == null) return false;
    var p = s.position.squares[f];
    if (!p || p.kind !== E.PAWN) return false;
    var rank = E.sqRank(t);
    return (p.color === E.WHITE && rank === 7) || (p.color === E.BLACK && rank === 0);
  }

  /**
   * Part 5.4 — the one validation algorithm, shared by all five modes.
   *
   * Returns one of:
   *   { kind:'illegal' }                                    silent no-op: no sound, no penalty
   *   { kind:'freePlay', sound }                            board unlocked after Solution
   *   { kind:'correct', solved:true,  byCheckmate }         finished
   *   { kind:'correct', solved:false, opponentReplyAfterMs } opponent has a reply queued
   *   { kind:'wrong', policy, ... }                         see WRONG_POLICY
   */
  function submit(s, from, to, promotion) {
    if (s.phase === 'reviewing') return freePlay(s, from, to, promotion);
    if (s.phase !== 'playing') return { kind: 'ignored', phase: s.phase };

    var uci = from + to + (promotion || '');
    var m = E.parseUci(s.position, uci);
    if (!m && promotion == null) m = E.parseUci(s.position, from + to + 'q');   // 5.1: default q
    if (!m) return { kind: 'illegal' };

    var next = E.makeMove(s.position, m);
    var captured = isCapture(s.position, m);
    var played = E.moveUci(m);

    // Rule 1 — ANY move that delivers immediate checkmate is correct, even off-book. Present in
    // all five original screens. It prevents the "I mated him but the app said wrong" bug when
    // the stored line mates a different way, and it is checked BEFORE the string comparison.
    if (E.status(next) === 'checkmate') {
      commit(s, next, m);
      s.phase = 'solved';
      s.solvedByCheckmate = true;
      return { kind: 'correct', solved: true, byCheckmate: true,
               sound: captured ? 'capture' : 'move', played: played };
    }

    if (played === s.puzzle.moves[s.moveIndex]) {
      commit(s, next, m);
      if (s.moveIndex >= s.puzzle.moves.length - 1) {
        s.phase = 'solved';
        return { kind: 'correct', solved: true, byCheckmate: false,
                 sound: captured ? 'capture' : 'move', played: played };
      }
      s.pendingOpponentIndex = s.moveIndex + 1;
      return { kind: 'correct', solved: false, byCheckmate: false,
               sound: captured ? 'capture' : 'move', played: played,
               opponentReplyAfterMs: opponentDelayMs(s.mode) };
    }

    return handleWrong(s, next, m, played, captured);
  }

  function commit(s, next, m) {
    s.position = next;
    s.lastMove = { from: E.sqName(m.from), to: E.sqName(m.to) };
  }

  function handleWrong(s, next, m, played, captured) {
    var p = WRONG_POLICY[s.mode];
    if (!p.undo) {
      // Turbo: the piece stays where it was dropped.
      commit(s, next, m);
    }
    s.mistakes += 1;
    s.pendingOpponentIndex = null;
    // Daily is the only mode that returns to `playing` by itself, once its banner expires; every
    // other mode needs an explicit Retry, a new puzzle, or has ended.
    s.phase = p.staysPlayable ? 'playing' : 'failed';
    return {
      kind: 'wrong', played: played, expected: s.puzzle.moves[s.moveIndex],
      undone: p.undo, endsRun: p.endsRun, costsALife: p.costsALife,
      bannerMs: p.bannerMs, advanceMs: p.advanceMs, offersRetry: p.offersRetry,
      sound: p.gameOverSound ? 'game-over' : null,
      mistakes: s.mistakes,
    };
  }

  /** After Solution reveal the board is unlocked for two-sided play and nothing is judged. */
  function freePlay(s, from, to, promotion) {
    var uci = from + to + (promotion || '');
    var m = E.parseUci(s.position, uci) || E.parseUci(s.position, from + to + 'q');
    if (!m) return { kind: 'illegal' };
    var captured = isCapture(s.position, m);
    commit(s, E.makeMove(s.position, m), m);
    return { kind: 'freePlay', sound: captured ? 'capture' : 'move', played: E.moveUci(m) };
  }

  /** The queued opponent reply from a `{ solved:false }` outcome. */
  function applyOpponentReply(s) {
    if (s.pendingOpponentIndex == null) return { applied: false };
    var i = s.pendingOpponentIndex;
    var m = E.parseUci(s.position, s.puzzle.moves[i]);
    if (!m) throw new Error('illegal scripted reply ' + s.puzzle.moves[i]);
    var captured = isCapture(s.position, m);
    commit(s, E.makeMove(s.position, m), m);
    s.moveIndex = i + 1;
    s.pendingOpponentIndex = null;
    var out = { applied: true, sound: captured ? 'capture' : 'move', uci: s.puzzle.moves[i] };
    // Faithful port of the inner branch in 5.4. It is UNREACHABLE for a well-formed puzzle: the
    // opponent's index is always even and `moves.length - 1` is always odd, because every puzzle
    // has an even move count (proven corpus-wide by tools/qa/puzzle_corpus_check.js). Kept so the
    // core still terminates rather than hanging if a malformed puzzle ever reaches it.
    if (i >= s.puzzle.moves.length - 1) {
      s.phase = 'solved';
      out.solved = true;
      out.solvedAfterMs = opponentDelayMs(s.mode);
    }
    return out;
  }

  /**
   * Part 10.3 Retry — back to the mounted-but-not-yet-set-up state.
   *
   * Fixes two of the three retry bugs structurally: the caller gets `restartClock` and
   * `sound:'game-start'` in the return value, so it cannot forget either the way the original did
   * (it never reset `startTime`, so a post-retry solve reported time since the FIRST attempt, and
   * it skipped the game-start sound). The third fix — that the rating delta must survive — is the
   * caller's, because rating is submitted once per puzzle and this core never touches Elo.
   */
  function retry(s) {
    s.position = E.fromFEN(s.puzzle.fen);
    s.moveIndex = 1;
    s.phase = 'loading';
    s.lastMove = null;
    s.pendingOpponentIndex = null;
    s.solvedByCheckmate = false;
    return { restartClock: true, sound: 'game-start',
             setupAfterMs: opponentDelayMs(s.mode), submitsRating: false };
  }

  /**
   * Part 10.3 Solution reveal. Sets `reviewing`, which unlocks the board and tells the caller to
   * run the engine. It does NOT auto-play the line and there is no hint feature.
   */
  function revealSolution(s) {
    s.phase = 'reviewing';
    s.pendingOpponentIndex = null;
    return { runEngine: true, maxArrows: 3, remaining: remainingSolution(s) };
  }

  /** The moves the solver has not yet found, from `moveIndex` on. */
  function remainingSolution(s) { return s.puzzle.moves.slice(s.moveIndex); }

  /**
   * Part 10.3 Save Puzzle — replay `moves` from `fen` and emit SAN as `1. e4 e5 2. Nf3 …`,
   * terminated by ` *`. No `[FEN]` header: the FEN goes in the session's `initialFen` field, which
   * is how the Analysis Board already stores a non-standard start.
   */
  function solutionPGN(puzzle) {
    var pos = E.fromFEN(puzzle.fen);
    if (!pos) return '';
    var moves = Array.isArray(puzzle.moves) ? puzzle.moves : String(puzzle.moves).split(' ');
    var out = [];
    // Numbering follows the FEN's own move counter and side, so a puzzle starting on Black's
    // move opens "23... Nf6" rather than silently renumbering from 1.
    var num = pos.fullmove;
    if (pos.sideToMove === E.BLACK) out.push(num + '...');
    else out.push(num + '.');
    for (var i = 0; i < moves.length; i++) {
      var m = E.parseUci(pos, moves[i]);
      if (!m) break;
      if (i > 0 && pos.sideToMove === E.WHITE) { num = pos.fullmove; out.push(num + '.'); }
      out.push(E.san(pos, m));
      pos = E.makeMove(pos, m);
    }
    return out.join(' ') + ' *';
  }

  /** The Save Puzzle sheet's prefilled notes: the non-empty lines only. */
  function savePuzzleNotes(puzzle) {
    var lines = [];
    if (puzzle.rating != null) lines.push('Rating: ' + puzzle.rating);
    var th = puzzle.themes || [];
    if (th.length) lines.push('Themes: ' + th.join(', '));
    var op = puzzle.openingTags || [];
    if (op.length) lines.push('Opening: ' + op.join(', '));
    return lines.join('\n');
  }

  function savePuzzleName(puzzle) { return 'Puzzle #' + puzzle.id; }

  return {
    MODES: MODES, TIMING: TIMING, WRONG_POLICY: WRONG_POLICY,
    countsTowardDailyGoal: countsTowardDailyGoal, opponentDelayMs: opponentDelayMs,
    userColorOf: userColorOf, create: create, applySetupMove: applySetupMove,
    needsPromotion: needsPromotion, submit: submit, applyOpponentReply: applyOpponentReply,
    retry: retry, revealSolution: revealSolution, remainingSolution: remainingSolution,
    solutionPGN: solutionPGN, savePuzzleNotes: savePuzzleNotes, savePuzzleName: savePuzzleName,
    isCapture: isCapture,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BiyaPuzzleSession;
