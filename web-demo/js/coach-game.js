/* coach-game.js — the Play vs Coach game state and its draft (spec 2.4, 2.9).
 *
 *     node -e "console.log(require('./web-demo/js/coach-game.js').selfTest().summary)"
 *
 * Pure: no DOM, no timers, no clock, and storage is injected. The engine and the opening book live
 * next door in `coach-engine.js` and `coach-book.js`; this owns the record of what has been played,
 * what it means, and what survives the app being closed.
 *
 * ## Two things here are fixes, not ports
 *
 * **Threefold uses the first THREE FEN fields.** The RN key used four, including the en-passant
 * target. chess.js emits an ep square after *any* double pawn push, whether or not a capture is
 * actually available — so two genuinely identical positions hashed differently and real threefolds
 * went unclaimed. Three fields (pieces, side to move, castling) is correct for practical purposes;
 * four plus an "is ep actually playable" normalisation is strictly correct if anyone ever wants it.
 * Spec 7 #30.
 *
 * **The fifty-move rule and insufficient material get their own strings.** The RN app collapsed both
 * into `Draw! A well-balanced battle.`, which now survives only as the fallback for anything else.
 * Telling a player *why* the game ended is the whole point of the line. Spec 7 #31.
 */
'use strict';

var BiyaCoachGame = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  // `Engine`, not `BiyaEngine`: engine.js is the one module that predates the `Biya*` convention and
  // hangs itself off `window.Engine`. Node never noticed — it takes the `require` branch — so this
  // read only fails in a browser, which is exactly the failure `coach_screen_test.js` exists to
  // catch and did, on its first run.
  var E = isNode ? require('./engine.js') : Engine;

  var KEY_PREFIX = 'biya.coach.draft.v1.';
  /** Seven days, not the 24 hours the puzzle drafts use: this is a full game, not an attempt. */
  var DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  var PHASE = { coachSelect: 'coachSelect', colorSelect: 'colorSelect', playing: 'playing' };

  // `'w'`/`'b'` is the PERSISTED form — it is what goes in the draft JSON and what the Swift twin's
  // `PairingEngine.Color` already uses, so one document describes both. The engine speaks numbers
  // (`E.WHITE === 0`), so every crossing goes through these two functions rather than an implicit
  // comparison. Comparing the two forms directly is silently always-false, which is exactly how the
  // first version of `evaluate` decided that a mated user had won.
  var WHITE = 'w', BLACK = 'b';
  function toEngineColor(c) { return c === BLACK ? E.BLACK : E.WHITE; }
  function fromEngineColor(c) { return c === E.BLACK ? BLACK : WHITE; }
  var OUTCOME = { win: 'win', loss: 'loss', draw: 'draw' };

  // ---- Records ---------------------------------------------------------------------------------

  /**
   * `moveRecords[0]` is always the start sentinel, with a null `san`.
   *
   * `fullMoveNumber` is deliberately absent: the RN struct writes it on every move and nothing ever
   * reads it — the move strip recomputes pairs from the array index.
   */
  function startRecord(fen) {
    return { san: null, fen: fen || E.START_FEN, from: null, to: null, color: null };
  }

  function newGame(level, userColor) {
    return {
      level: level,
      userColor: userColor === BLACK ? BLACK : WHITE,
      moveRecords: [startRecord(E.START_FEN)],
      reviewIndex: null,          // null means LIVE
      result: null,
      outcome: null,
      resigned: false,
    };
  }

  /** Fixed for the whole game — the board does not flip when the coach moves. */
  function isFlipped(game) { return game.userColor === BLACK; }

  function liveFen(game) { return game.moveRecords[game.moveRecords.length - 1].fen; }

  /**
   * What the board should show.
   *
   * LIVE is the newest record; otherwise the record at `reviewIndex`, with `lastMove` taken from
   * that record's own from/to rather than from the live game — reviewing move 4 must highlight
   * move 4, not whatever was played last.
   */
  function displayPosition(game) {
    var idx = game.reviewIndex == null ? game.moveRecords.length - 1 : game.reviewIndex;
    var rec = game.moveRecords[idx];
    return { fen: rec.fen, from: rec.from, to: rec.to, live: game.reviewIndex == null, index: idx };
  }

  /** Jumping to the newest index returns to LIVE, rather than pinning to the last record. */
  function setReviewIndex(game, index) {
    if (index == null || index >= game.moveRecords.length - 1) { game.reviewIndex = null; return; }
    game.reviewIndex = Math.max(0, index);
  }

  function isLive(game) { return game.reviewIndex == null; }

  // ---- Repetition -------------------------------------------------------------------------------

  /**
   * The first THREE FEN fields. See the header: the fourth is the en-passant square, and including
   * it is what made real threefolds invisible.
   */
  function repetitionKey(fen) {
    var parts = String(fen).split(' ');
    return parts.slice(0, 3).join(' ');
  }

  function repetitionCount(game, fen) {
    var key = repetitionKey(fen == null ? liveFen(game) : fen);
    var n = 0;
    for (var i = 0; i < game.moveRecords.length; i++) {
      if (repetitionKey(game.moveRecords[i].fen) === key) n++;
    }
    return n;
  }

  function isThreefold(game) { return repetitionCount(game, null) >= 3; }

  // ---- Game over --------------------------------------------------------------------------------

  var STR = {
    threefold: 'Draw by threefold repetition!',
    stalemate: "Stalemate — It's a draw!",
    fiftyMove: 'Draw by the fifty-move rule.',
    insufficient: 'Draw — not enough material to mate.',
    genericDraw: 'Draw! A well-balanced battle.',
    resign: function (coachName) {
      return 'You resigned. ' + coachName + ' wins this round!';
    },
  };

  /**
   * Evaluated after EVERY half-move — the user's, the book's and the engine's alike. A game that
   * only checks after the user moves is a game that lets the coach deliver mate and carry on.
   *
   * `coach` supplies `name`, `winMsg` (shown when the USER is mated) and `loseMsg`.
   */
  function evaluate(game, coach) {
    if (game.resigned) {
      return { result: STR.resign(coach && coach.name ? coach.name : ''),
               outcome: OUTCOME.loss };
    }
    var pos = E.fromFEN(liveFen(game));
    if (!pos) return null;
    var status = E.status(pos);

    if (status === 'checkmate') {
      // The side to move is mated. If that is the user, they lost.
      var userMated = fromEngineColor(pos.sideToMove) === game.userColor;
      return {
        result: userMated ? (coach && coach.winMsg) : (coach && coach.loseMsg),
        outcome: userMated ? OUTCOME.loss : OUTCOME.win,
      };
    }
    // Threefold is checked before stalemate: both are draws, but the reason shown should be the one
    // that actually happened, and a repeated position can also be stalemate.
    if (isThreefold(game)) return { result: STR.threefold, outcome: OUTCOME.draw };
    if (status === 'stalemate') return { result: STR.stalemate, outcome: OUTCOME.draw };
    if (E.isFiftyMove && E.isFiftyMove(pos)) {
      return { result: STR.fiftyMove, outcome: OUTCOME.draw };
    }
    // The engine has no insufficient-material test of its own, so it is computed here. The spec
    // wants this ending named rather than folded into the generic draw (7 #31), which means it has
    // to be detectable — `status()` only reports stalemate and checkmate.
    if (isInsufficientMaterial(pos)) {
      return { result: STR.insufficient, outcome: OUTCOME.draw };
    }
    if (status === 'draw') return { result: STR.genericDraw, outcome: OUTCOME.draw };
    return null;
  }

  /**
   * K vs K, K+minor vs K, and K+B vs K+B with both bishops on one colour. Anything with a pawn,
   * rook or queen can still mate, and two knights cannot force it but the position is not dead, so
   * FIDE does not call it a draw either.
   */
  function isInsufficientMaterial(pos) {
    // `pos.squares`, and `kind` is one of the engine's numeric constants. Written against the real
    // shape rather than a guessed one: the first attempt read `pos.board[sq]` with a letter `kind`
    // and threw on the first position it was given.
    var bishops = [], knights = 0, others = 0;
    for (var sq = 0; sq < 64; sq++) {
      var p = pos.squares[sq];
      if (!p) continue;
      if (p.kind === E.KING) continue;
      if (p.kind === E.BISHOP) {
        // Light or dark square, so two bishops on one colour can be told from a real pair.
        bishops.push((Math.floor(sq / 8) + (sq % 8)) % 2);
        continue;
      }
      if (p.kind === E.KNIGHT) { knights++; continue; }
      others++;
    }
    if (others > 0) return false;
    if (knights === 0 && bishops.length === 0) return true;               // K vs K
    if (knights + bishops.length === 1) return true;                      // K + one minor
    if (knights === 0 && bishops.length >= 2) {
      // Bishops all on one colour can never mate, however many there are.
      for (var i = 1; i < bishops.length; i++) {
        if (bishops[i] !== bishops[0]) return false;
      }
      return true;
    }
    return false;
  }

  function applyEvaluation(game, coach) {
    var over = evaluate(game, coach);
    if (!over) return null;
    game.result = over.result;
    game.outcome = over.outcome;
    return over;
  }

  function isOver(game) { return game.outcome != null; }

  // ---- Moves -------------------------------------------------------------------------------------

  /**
   * Record a move that has already been validated. Returns the new record, or null if illegal.
   *
   * Recording appends to the array and returns the board to LIVE: making a move while reviewing an
   * earlier position must not leave the player looking at history.
   */
  function record(game, uci) {
    if (isOver(game)) return null;
    var pos = E.fromFEN(liveFen(game));
    if (!pos) return null;
    var move = E.parseUci(pos, uci);
    if (!move) return null;
    var san = E.san(pos, move);
    var next = E.makeMove(pos, move);
    var rec = {
      san: san,
      fen: E.toFEN(next),
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      color: fromEngineColor(pos.sideToMove),
    };
    game.moveRecords.push(rec);
    game.reviewIndex = null;
    return rec;
  }

  function resign(game, coach) {
    game.resigned = true;
    return applyEvaluation(game, coach);
  }

  /** Whose turn it is, from the live position rather than a counter that can drift. */
  function sideToMove(game) {
    var pos = E.fromFEN(liveFen(game));
    return pos ? fromEngineColor(pos.sideToMove) : WHITE;
  }

  function isUserTurn(game) { return sideToMove(game) === game.userColor; }

  /** The SAN list the opening book matches against. The sentinel has no SAN, so it is skipped. */
  function sanHistory(game) {
    return game.moveRecords.slice(1).map(function (r) { return r.san; });
  }

  // ---- Draft (spec 2.9) ----------------------------------------------------------------------------

  function key(level) { return KEY_PREFIX + level; }

  function saveDraft(game, storage, now) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    // A finished game has nothing to resume.
    if (isOver(game)) { clearDraft(game.level, s); return false; }
    var payload = {
      level: game.level,
      userColor: game.userColor,
      moveRecords: game.moveRecords,
      savedAt: now,
    };
    try { s.setItem(key(game.level), JSON.stringify(payload)); return true; } catch (e) {
      return false;
    }
  }

  function clearDraft(level, storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return;
    try { s.removeItem(key(level)); } catch (e) { /* nothing to do */ }
  }

  /**
   * Restore, or null.
   *
   * Anything malformed DELETES the key rather than being repaired or ignored: a draft that cannot be
   * read is a draft that will fail again on the next launch, and leaving it there turns one bad save
   * into a permanently broken Resume button.
   */
  function loadDraft(level, storage, now) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return null;
    var raw;
    try { raw = s.getItem(key(level)); } catch (e) { return null; }
    if (!raw) return null;

    var d;
    try { d = JSON.parse(raw); } catch (e) { clearDraft(level, s); return null; }
    if (!d || typeof d !== 'object' || !Array.isArray(d.moveRecords)
        || d.moveRecords.length < 1 || typeof d.savedAt !== 'number') {
      clearDraft(level, s);
      return null;
    }
    if (now - d.savedAt > DRAFT_TTL_MS) { clearDraft(level, s); return null; }
    // Every record must carry a FEN the engine can actually read, or the board cannot be rebuilt.
    for (var i = 0; i < d.moveRecords.length; i++) {
      var r = d.moveRecords[i];
      if (!r || typeof r.fen !== 'string' || !E.fromFEN(r.fen)) {
        clearDraft(level, s);
        return null;
      }
    }
    var game = newGame(d.level == null ? level : d.level,
                       d.userColor === BLACK ? BLACK : WHITE);
    game.moveRecords = d.moveRecords;
    return game;
  }

  // ---- Self-test -------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }
    var coach = { name: 'Coach Pogi', winMsg: 'I win!', loseMsg: 'You got me!' };
    function mem() {
      var box = {};
      return {
        _box: box,
        getItem: function (k) { return k in box ? box[k] : null; },
        setItem: function (k, v) { box[k] = String(v); },
        removeItem: function (k) { delete box[k]; },
      };
    }

    // --- the sentinel and the shape ---
    var g = newGame(3, WHITE);
    eq(g.moveRecords.length, 1, 'a new game has exactly the sentinel');
    eq(g.moveRecords[0].san, null, 'and the sentinel has no SAN');
    eq(g.moveRecords[0].fen, E.START_FEN, 'it holds the start position');
    expect(!('fullMoveNumber' in g.moveRecords[0]),
           'the record carries no fullMoveNumber — nothing reads it');
    eq(isFlipped(g), false, 'a White player sees an unflipped board');
    eq(isFlipped(newGame(3, BLACK)), true, 'a Black player sees it flipped');
    eq(sanHistory(g).length, 0, 'the sentinel is not part of the SAN history');

    // --- moves ---
    expect(record(g, 'e2e4') !== null, 'a legal move records');
    eq(g.moveRecords.length, 2, 'and appends');
    eq(g.moveRecords[1].san, 'e4', 'with its SAN');
    eq(g.moveRecords[1].color, WHITE, 'and the side that played it');
    eq(g.moveRecords[1].from, 'e2', 'and the origin square');
    eq(sanHistory(g).join(' '), 'e4', 'the SAN history skips the sentinel');
    eq(record(g, 'e2e4'), null, 'an illegal move records nothing');
    eq(g.moveRecords.length, 2, 'and leaves the array alone');
    eq(isUserTurn(g), false, 'after White moves it is the coach’s turn');

    // --- review index ---
    record(g, 'e7e5');
    record(g, 'g1f3');
    eq(isLive(g), true, 'a fresh game is live');
    setReviewIndex(g, 1);
    eq(isLive(g), false, 'reviewing an earlier move is not live');
    eq(displayPosition(g).from, 'e2', 'and the highlight is that move’s, not the last one’s');
    eq(displayPosition(g).index, 1, 'showing the reviewed record');
    setReviewIndex(g, g.moveRecords.length - 1);
    eq(isLive(g), true, 'jumping to the newest index returns to LIVE');
    setReviewIndex(g, 99);
    eq(isLive(g), true, 'and so does jumping past the end');
    setReviewIndex(g, 0);
    eq(displayPosition(g).fen, E.START_FEN, 'index 0 is the start position');
    setReviewIndex(g, -5);
    eq(displayPosition(g).index, 0, 'a negative index clamps to the start');
    // Moving while reviewing must snap back to live.
    setReviewIndex(g, 1);
    record(g, 'b8c6');
    eq(isLive(g), true, 'making a move returns the board to live');

    // --- threefold: THREE fields, not four ---
    eq(repetitionKey('rnbq/8 w KQkq e3 0 1'), 'rnbq/8 w KQkq',
       'the key is pieces, side to move and castling');
    // Two positions differing ONLY in the en-passant square are the same position. This is the bug.
    eq(repetitionKey('X w KQ e3 0 1'), repetitionKey('X w KQ - 5 9'),
       'an en-passant square does not change the key — spec 7 #30');
    expect(repetitionKey('X w KQ - 0 1') !== repetitionKey('X b KQ - 0 1'),
           'but the side to move does');
    expect(repetitionKey('X w KQ - 0 1') !== repetitionKey('X w Kq - 0 1'),
           'and so do castling rights');

    // A real threefold, by shuffling knights back and forth.
    var t = newGame(3, WHITE);
    eq(repetitionCount(t, null), 1, 'the start position has been seen once');
    ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(function (m) { record(t, m); });
    eq(repetitionCount(t, null), 2, 'and twice after one round trip');
    expect(!isThreefold(t), 'which is not yet a threefold');
    ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(function (m) { record(t, m); });
    eq(repetitionCount(t, null), 3, 'three times after two');
    expect(isThreefold(t), 'and that IS a threefold');
    var over = applyEvaluation(t, coach);
    expect(!!over, 'which ends the game');
    eq(over.result, STR.threefold, 'with the threefold message');
    eq(over.outcome, OUTCOME.draw, 'as a draw');

    // --- game over: the two NEW strings exist and are distinct ---
    expect(STR.fiftyMove !== STR.genericDraw, 'the fifty-move rule has its own string');
    expect(STR.insufficient !== STR.genericDraw, 'so does insufficient material');
    expect(STR.fiftyMove !== STR.insufficient, 'and they differ from each other');
    eq(STR.genericDraw, 'Draw! A well-balanced battle.',
       'the RN string survives only as the fallback');

    // --- checkmate, from both sides ---
    var fools = newGame(3, WHITE);
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(function (m) { record(fools, m); });
    var mated = applyEvaluation(fools, coach);
    expect(!!mated, "Fool's mate ends the game");
    eq(mated.outcome, OUTCOME.loss, 'and the White user has lost');
    eq(mated.result, coach.winMsg, 'so the coach’s win message is shown');
    // The same position with the user as Black is a win for them.
    var asBlack = newGame(3, BLACK);
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(function (m) { record(asBlack, m); });
    var won = applyEvaluation(asBlack, coach);
    eq(won.outcome, OUTCOME.win, 'a Black user delivering the same mate has won');
    eq(won.result, coach.loseMsg, 'and sees the coach’s losing line');

    // --- resigning ---
    var r = newGame(2, WHITE);
    var res = resign(r, coach);
    eq(res.outcome, OUTCOME.loss, 'resigning is a loss');
    expect(res.result.indexOf('Coach Pogi') >= 0, 'and names the coach');
    eq(record(r, 'e2e4'), null, 'a resigned game accepts no more moves');

    // --- drafts ---
    var store = mem();
    var d = newGame(4, BLACK);
    record(d, 'e2e4');
    expect(saveDraft(d, store, 1000), 'a live game saves');
    var back = loadDraft(4, store, 1000);
    expect(!!back, 'and restores');
    eq(back.userColor, BLACK, 'with the colour');
    eq(back.moveRecords.length, 2, 'and every record');
    eq(sanHistory(back).join(' '), 'e4', 'so the book can still match');
    // The counter is rebuilt by replaying, not carried in the payload.
    eq(repetitionCount(back, null), 1, 'the repetition counter rebuilds from the records');

    eq(loadDraft(5, store, 1000), null, 'drafts are per level');
    eq(loadDraft(4, store, 1000 + DRAFT_TTL_MS + 1), null, 'and expire after seven days');
    expect(loadDraft(4, store, 1000) === null, 'expiry deletes the key rather than skipping it');

    // Malformed data deletes the key, so one bad save cannot break Resume forever.
    store.setItem(key(7), 'not json at all');
    eq(loadDraft(7, store, 1000), null, 'unparseable data yields nothing');
    eq(store.getItem(key(7)), null, 'and is deleted');
    store.setItem(key(8), JSON.stringify({ level: 8, moveRecords: [], savedAt: 1 }));
    eq(loadDraft(8, store, 1000), null, 'an empty record array is malformed');
    eq(store.getItem(key(8)), null, 'and is deleted too');
    store.setItem(key(9), JSON.stringify({
      level: 9, userColor: WHITE, savedAt: 1000,
      moveRecords: [{ san: null, fen: 'total nonsense', from: null, to: null, color: null }],
    }));
    eq(loadDraft(9, store, 1000), null, 'an unreadable FEN is malformed');
    eq(store.getItem(key(9)), null, 'and is deleted');

    // A finished game clears rather than saves — there is nothing to resume.
    var done = newGame(1, WHITE);
    saveDraft(done, store, 1000);
    expect(store.getItem(key(1)) !== null, 'a live game is stored');
    done.resigned = true;
    applyEvaluation(done, coach);
    eq(saveDraft(done, store, 2000), false, 'a finished game does not save');
    eq(store.getItem(key(1)), null, 'and its draft is cleared');

    eq(DRAFT_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'the retention really is seven days');

    // --- insufficient material, against real positions ---
    //
    // Written against the engine's actual board shape, and asserted here because the first version
    // read a field that does not exist and threw on every position it saw.
    [['8/8/4k3/8/8/4K3/8/8 w - - 0 1', true, 'K vs K'],
     ['8/8/4k3/8/8/4KB2/8/8 w - - 0 1', true, 'K+B vs K'],
     ['8/8/4k3/8/8/4KN2/8/8 w - - 0 1', true, 'K+N vs K'],
     ['8/5b2/4k3/8/8/4KB2/8/8 w - - 0 1', true, 'K+B vs K+B, both on dark squares'],
     ['8/8/4k3/8/8/4KNN1/8/8 w - - 0 1', false, 'K+2N cannot be forced, so not a dead draw'],
     ['8/8/4k3/8/8/4KR2/8/8 w - - 0 1', false, 'a rook still mates'],
     ['8/8/4k3/8/8/4KQ2/8/8 w - - 0 1', false, 'so does a queen'],
     ['8/8/4k3/8/8/4KP2/8/8 w - - 0 1', false, 'and a pawn can promote']].forEach(function (c) {
      var pos = E.fromFEN(c[0]);
      expect(!!pos, 'the test FEN parses: ' + c[2]);
      if (!pos) return;
      eq(isInsufficientMaterial(pos), c[1], c[2]);
    });
    // A dead position ends the game with its OWN string, not the generic draw.
    var dead = newGame(3, WHITE);
    dead.moveRecords = [startRecord('8/8/4k3/8/8/4KB2/8/8 w - - 0 1')];
    var d2 = applyEvaluation(dead, coach);
    expect(!!d2, 'an insufficient-material position ends the game');
    if (d2) {
      eq(d2.result, STR.insufficient, 'with its own message, not the generic draw');
      eq(d2.outcome, OUTCOME.draw, 'as a draw');
    }

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-game: ' + passed + ' assertions passed'
        : 'coach-game: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    PHASE: PHASE, WHITE: WHITE, BLACK: BLACK, OUTCOME: OUTCOME, STR: STR,
    KEY_PREFIX: KEY_PREFIX, DRAFT_TTL_MS: DRAFT_TTL_MS,
    newGame: newGame, startRecord: startRecord, isFlipped: isFlipped,
    liveFen: liveFen, displayPosition: displayPosition, setReviewIndex: setReviewIndex,
    isLive: isLive, repetitionKey: repetitionKey, repetitionCount: repetitionCount,
    isThreefold: isThreefold, evaluate: evaluate, applyEvaluation: applyEvaluation,
    isOver: isOver, record: record, resign: resign,
    isInsufficientMaterial: isInsufficientMaterial,
    toEngineColor: toEngineColor, fromEngineColor: fromEngineColor,
    sideToMove: sideToMove, isUserTurn: isUserTurn, sanHistory: sanHistory,
    saveDraft: saveDraft, loadDraft: loadDraft, clearDraft: clearDraft,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachGame; }
