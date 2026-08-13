/* coach-turn.js — whose turn it is, what the nav buttons allow, and the premove (spec 2.7, 2.8).
 *
 *     node -e "console.log(require('./web-demo/js/coach-turn.js').selfTest().summary)"
 *
 * The controller half of the game screen, split from the rendering half for the same reason
 * `coach-color.js` was split out: this is where the bugs are, and a DOM harness is a poor place to
 * test a race. Spec 2.12 names four of them explicitly, and every one is a question about whether a
 * reply that is already in flight should still be allowed to land.
 *
 * Pure: no DOM, no timers, no engine. The screen owns the `setTimeout` and the search; this owns the
 * decision about whether their results are still wanted.
 *
 * ## The generation counter is the whole design
 *
 * Every asynchronous coach reply is stamped with the generation it was started in. Resigning,
 * starting a new game, taking a move back or beginning a review all bump the generation, and a reply
 * stamped with an older one is **dropped on arrival**. That single mechanism covers:
 *
 *   #25  a ghost move landing on a resigned or restarted board
 *   #26  four `setTimeout`s that were never cleared and fired after navigation
 *   #27  the engine moving underneath a review you are reading
 *   #29  resign or New Game while the coach is thinking
 *
 * The RN app tried to solve these with four separate flags and missed all four. One counter is both
 * smaller and harder to get wrong: there is no state to forget to clear, because the check is always
 * "is this still the current generation".
 */
'use strict';

var BiyaCoachTurn = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var GAME = isNode ? require('./coach-game.js') : BiyaCoachGame;

  // ---- The controller ----------------------------------------------------------------------------

  function create() {
    return {
      generation: 0,
      /** The move queued while the coach is thinking, or null. `{ from, to, promotion }`. */
      premove: null,
      /** True between asking for a reply and it landing, purely so the UI can show a spinner. */
      thinking: false,
    };
  }

  /**
   * Invalidate everything in flight.
   *
   * Called by resign, New Game, take-back and entering review. Returns the new generation so the
   * caller can hold it if it wants to start something immediately afterwards.
   */
  function invalidate(ctl) {
    ctl.generation += 1;
    ctl.thinking = false;
    // A premove belongs to the position it was made in. Surviving a take-back or a new game is how
    // it would end up applied to a board it was never meant for.
    ctl.premove = null;
    return ctl.generation;
  }

  /** Stamp a reply that is about to be started. */
  function begin(ctl) {
    ctl.thinking = true;
    return ctl.generation;
  }

  /**
   * May a reply stamped `token` still be applied?
   *
   * The one question the whole file exists to answer. Anything else — a flag that was supposed to be
   * cleared, a timer that was supposed to be cancelled — is a second source of truth.
   */
  function accepts(ctl, token) {
    return token === ctl.generation;
  }

  function settle(ctl, token) {
    if (!accepts(ctl, token)) return false;
    ctl.thinking = false;
    return true;
  }

  // ---- Whose turn ----------------------------------------------------------------------------------

  /**
   * Should the coach be asked to move right now?
   *
   * Reviewing counts as "no" (#27). The RN app kept playing underneath a review, so you would look
   * up from move 6 to find the game three moves further on and the board no longer the one you were
   * reading.
   */
  function shouldCoachMove(game, ctl) {
    if (GAME.isOver(game)) return false;
    if (!GAME.isLive(game)) return false;
    if (ctl && ctl.thinking) return false;
    return !GAME.isUserTurn(game);
  }

  /** May the user move a piece right now? */
  function canUserMove(game, ctl) {
    if (GAME.isOver(game)) return false;
    if (!GAME.isLive(game)) return false;
    // While the coach is thinking the user may still PREMOVE, but not move.
    if (ctl && ctl.thinking) return false;
    return GAME.isUserTurn(game);
  }

  // ---- Premove (2.8) -------------------------------------------------------------------------------

  /**
   * Queue a premove. Only while the coach is thinking, and only one at a time — a second replaces
   * the first rather than stacking.
   *
   * `promotion` is explicit and may be null. The RN premove always auto-queened (#32), which loses
   * every underpromotion; passing it through means the caller can ask.
   */
  function setPremove(ctl, game, from, to, promotion) {
    if (GAME.isOver(game)) return false;
    if (!ctl.thinking) return false;
    ctl.premove = { from: from, to: to, promotion: promotion == null ? null : promotion };
    return true;
  }

  function clearPremove(ctl) {
    var had = ctl.premove !== null;
    ctl.premove = null;
    return had;
  }

  /**
   * Take the queued premove, if it is still legal in the position that has arrived.
   *
   * Returns the UCI string or null. Always CONSUMES the premove either way: a premove that turned
   * out to be illegal has been spent, and leaving it queued would fire it at the next position
   * instead — which is the same class of bug as the ghost move.
   */
  function consumePremove(ctl, game, isLegal) {
    var p = ctl.premove;
    ctl.premove = null;
    if (!p) return null;
    if (GAME.isOver(game)) return null;
    var uci = p.from + p.to + (p.promotion || '');
    if (isLegal && !isLegal(uci)) return null;
    return uci;
  }

  // ---- Review navigation (2.7) ----------------------------------------------------------------------

  /**
   * What the four nav buttons and the Live button allow.
   *
   * `⏮` and `◀` share ONE rule (#37): both mean "there is something earlier than what I am looking
   * at". The RN app disabled them on different conditions, so at move 1 one was live and the other
   * dead, which reads as a bug even when it is only an inconsistency.
   */
  function navState(game) {
    var last = game.moveRecords.length - 1;
    var at = GAME.isLive(game) ? last : game.reviewIndex;
    var hasEarlier = at > 0;
    return {
      index: at,
      last: last,
      canFirst: hasEarlier,
      canPrev: hasEarlier,
      canNext: at < last,
      canLast: at < last,
      // The Live button is only meaningful when you are not already live.
      canLive: !GAME.isLive(game),
    };
  }

  /** Take-back removes the last full move pair, and invalidates anything in flight. */
  function takeBack(game, ctl, allowed) {
    if (!allowed) return false;
    if (GAME.isOver(game)) return false;
    // Both halves, so the user is on move again rather than staring at the coach's reply.
    var removed = 0;
    while (game.moveRecords.length > 1 && removed < 2) {
      game.moveRecords.pop();
      removed += 1;
      if (GAME.isUserTurn(game)) break;
    }
    if (removed === 0) return false;
    game.reviewIndex = null;
    invalidate(ctl);
    return true;
  }

  // ---- Self-test ------------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }
    var coach = { name: 'Jade', winMsg: 'I win', loseMsg: 'You win' };
    var legal = function () { return true; };

    // --- the generation counter (#25, #26, #27, #29) ---
    var ctl = create();
    var g = GAME.newGame(3, 'w');
    eq(ctl.generation, 0, 'a fresh controller starts at generation 0');

    var token = begin(ctl);
    eq(ctl.thinking, true, 'beginning a reply marks it thinking');
    expect(accepts(ctl, token), 'and the reply it started is accepted');

    // #29 — resigning while the coach is thinking must drop the reply.
    GAME.resign(g, coach);
    invalidate(ctl);
    expect(!accepts(ctl, token), 'a reply started before a resign is REFUSED');
    eq(ctl.thinking, false, 'and the screen stops thinking');

    // #25 — the same, for a new game.
    var ctl2 = create();
    var t2 = begin(ctl2);
    invalidate(ctl2);
    expect(!accepts(ctl2, t2), 'a reply started before a New Game is refused');
    var t3 = begin(ctl2);
    expect(accepts(ctl2, t3), 'but the reply started after it is accepted');
    expect(settle(ctl2, t3), 'and settles');
    eq(ctl2.thinking, false, 'clearing the thinking flag');
    expect(!settle(ctl2, t2), 'a stale token cannot settle');

    // Generations never repeat, so a token can never be accidentally revalidated.
    var seen = {}, c3 = create();
    for (var i = 0; i < 50; i++) {
      var t = invalidate(c3);
      expect(!seen[t], 'generation ' + t + ' is issued once');
      seen[t] = true;
    }

    // --- whose turn ---
    var g2 = GAME.newGame(3, 'w');
    var c4 = create();
    eq(canUserMove(g2, c4), true, 'White to move, user is White');
    eq(shouldCoachMove(g2, c4), false, 'so the coach waits');
    GAME.record(g2, 'e2e4');
    eq(shouldCoachMove(g2, c4), true, 'after the user moves it is the coach');
    eq(canUserMove(g2, c4), false, 'and the user cannot move again');

    // #27 — reviewing pauses the coach.
    GAME.setReviewIndex(g2, 0);
    eq(shouldCoachMove(g2, c4), false, 'reviewing stops the coach moving underneath you');
    eq(canUserMove(g2, c4), false, 'and the user cannot move from a review either');
    GAME.setReviewIndex(g2, null);
    eq(shouldCoachMove(g2, c4), true, 'returning to live resumes it');

    // A game already over asks nobody to move.
    var over = GAME.newGame(3, 'w');
    over.resigned = true;
    GAME.applyEvaluation(over, coach);
    eq(shouldCoachMove(over, create()), false, 'a finished game does not ask the coach');
    eq(canUserMove(over, create()), false, 'nor the user');

    // Thinking blocks a second request, or two searches race for one reply.
    var c5 = create();
    begin(c5);
    eq(shouldCoachMove(g2, c5), false, 'the coach is not asked twice while already thinking');

    // --- premove (#32) ---
    var c6 = create();
    var g3 = GAME.newGame(3, 'w');
    GAME.record(g3, 'e2e4');
    eq(setPremove(c6, g3, 'e7', 'e5', null), false, 'no premove unless the coach is thinking');
    begin(c6);
    eq(setPremove(c6, g3, 'e7', 'e5', null), true, 'a premove queues while thinking');
    eq(c6.premove.to, 'e5', 'and remembers the target');
    // One at a time: a second replaces rather than stacks.
    setPremove(c6, g3, 'd7', 'd5', null);
    eq(c6.premove.from, 'd7', 'a second premove replaces the first');
    eq(clearPremove(c6), true, 'it can be cancelled');
    eq(clearPremove(c6), false, 'and cancelling twice reports nothing to cancel');

    // Promotion is explicit, not always a queen.
    begin(c6);
    setPremove(c6, g3, 'e7', 'e8', 'n');
    eq(consumePremove(c6, g3, legal), 'e7e8n', 'an underpromotion survives the round trip');
    begin(c6);
    setPremove(c6, g3, 'e7', 'e5', null);
    eq(consumePremove(c6, g3, legal), 'e7e5', 'and a normal move carries no suffix');

    // Consuming ALWAYS spends it, legal or not — a premove that could not be played must not fire
    // at the next position instead.
    begin(c6);
    setPremove(c6, g3, 'a7', 'a1', null);
    eq(consumePremove(c6, g3, function () { return false; }), null, 'an illegal premove is refused');
    eq(c6.premove, null, 'and is spent rather than left queued');

    // A premove does not survive a game ending, or an invalidation.
    begin(c6);
    setPremove(c6, g3, 'e7', 'e5', null);
    invalidate(c6);
    eq(c6.premove, null, 'invalidating drops the premove');
    var g4 = GAME.newGame(3, 'w');
    GAME.record(g4, 'e2e4');
    var c7 = create();
    begin(c7);
    setPremove(c7, g4, 'e7', 'e5', null);
    g4.resigned = true;
    GAME.applyEvaluation(g4, coach);
    eq(consumePremove(c7, g4, legal), null, 'and a finished game refuses to play one');

    // --- nav (#37) ---
    var g5 = GAME.newGame(3, 'w');
    var n0 = navState(g5);
    eq(n0.canFirst, false, 'at the start there is nothing earlier');
    eq(n0.canPrev, false, 'and the two buttons agree');
    eq(n0.canNext, false, 'nor anything later');
    eq(n0.canLive, false, 'and the start of a fresh game IS live');

    ['e2e4', 'e7e5', 'g1f3'].forEach(function (m) { GAME.record(g5, m); });
    var n1 = navState(g5);
    eq(n1.canFirst, n1.canPrev, '⏮ and ◀ always share one rule');
    eq(n1.canFirst, true, 'and both are live once moves exist');
    eq(n1.canNext, false, 'at the newest position there is nothing later');
    eq(n1.canLive, false, 'and it is already live');

    GAME.setReviewIndex(g5, 1);
    var n2 = navState(g5);
    eq(n2.index, 1, 'reviewing reports the reviewed index');
    eq(n2.canFirst, n2.canPrev, 'the two still agree');
    eq(n2.canNext, true, 'there is something later');
    eq(n2.canLive, true, 'and Live is now meaningful');

    GAME.setReviewIndex(g5, 0);
    var n3 = navState(g5);
    eq(n3.canFirst, false, 'at index 0 there is nothing earlier');
    eq(n3.canPrev, false, 'and again the two agree');

    // --- take back ---
    var g6 = GAME.newGame(3, 'w');
    ['e2e4', 'e7e5'].forEach(function (m) { GAME.record(g6, m); });
    var c8 = create();
    eq(takeBack(g6, c8, false), false, 'take-back refuses when the setting is off');
    eq(g6.moveRecords.length, 3, 'and changes nothing');
    var genBefore = c8.generation;
    eq(takeBack(g6, c8, true), true, 'with the setting on it works');
    eq(g6.moveRecords.length, 1, 'and removes both halves so the user is on move');
    eq(GAME.isUserTurn(g6), true, 'which is the point of removing both');
    expect(c8.generation > genBefore, 'and invalidates anything in flight');
    eq(takeBack(GAME.newGame(3, 'w'), create(), true), false,
       'there is nothing to take back at the start');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-turn: ' + passed + ' assertions passed'
        : 'coach-turn: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    create: create, invalidate: invalidate, begin: begin, accepts: accepts, settle: settle,
    shouldCoachMove: shouldCoachMove, canUserMove: canUserMove,
    setPremove: setPremove, clearPremove: clearPremove, consumePremove: consumePremove,
    navState: navState, takeBack: takeBack,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachTurn; }
