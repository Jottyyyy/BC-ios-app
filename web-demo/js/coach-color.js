/* coach-color.js — the Colour Select phase (spec 2.6).
 *
 * Split out of the game screen rather than folded into it, even though the RN source keeps both in
 * `play.tsx`. They are different phases with different state, and the resume decision below is real
 * logic that deserves its own tests — mirroring a 3,082-line file's structure is not a goal.
 *
 * Every number is a `coach-metrics.js` constant as a `--cgc-*` custom property.
 *
 * ## The fix this screen carries
 *
 * Spec 7 #33: **Continue must honour the draft's colour, not the one you just tapped.** The RN app
 * reads the tapped colour in both branches, so resuming a game you had been playing as Black hands
 * you White and the board is backwards with your own moves in it. `resolveStart` below is the whole
 * fix, and it is a pure function precisely so it can be asserted.
 */
'use strict';

var BiyaCoachColor = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./coach-metrics.js') : BiyaCoachMetrics;
  var STR = (isNode ? require('./coach-strings.js') : BiyaCoachStrings).STR;
  var GAME = isNode ? require('./coach-game.js') : BiyaCoachGame;

  var WHITE = 'w', BLACK = 'b';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'cgc', MET.PLAY);
  }

  /** "White" / "Black", for the resume chip and prompt. */
  function colourName(c) { return c === BLACK ? STR.black : STR.white; }

  /** How many moves have actually been played — the sentinel is not one. */
  function moveCount(draft) {
    return draft && draft.moveRecords ? Math.max(0, draft.moveRecords.length - 1) : 0;
  }

  /**
   * What pressing a side button should actually start (spec 7 #33).
   *
   * `tapped` is the colour the user just chose. `draft` is the saved game for this level, or null.
   * `resume` is what the prompt returned: true for Continue, false for New Game, and `null` when
   * there was no prompt because there is no draft.
   *
   * The rule that matters: **Continue uses the DRAFT's colour.** A resumed game already has moves in
   * it, played from one side; honouring the tap instead would flip the board under a position that
   * cannot be flipped. New Game uses the tap, because that is the only signal there is.
   */
  function resolveStart(tapped, draft, resume) {
    var colour = tapped === BLACK ? BLACK : WHITE;
    if (!draft || moveCount(draft) === 0) {
      return { resume: false, userColor: colour, draft: null };
    }
    if (resume === true) {
      return { resume: true, userColor: draft.userColor === BLACK ? BLACK : WHITE, draft: draft };
    }
    return { resume: false, userColor: colour, draft: null };
  }

  // ---- Render -------------------------------------------------------------------------------------

  /**
   * `cb` is `{ onStart({resume, userColor, draft}), onExit() }`.
   *
   * `level` selects which draft to look for — drafts are one per level.
   */
  function render(view, level, coachName, cb, storage, now) {
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var draft = GAME.loadDraft(level, storage, now == null ? new Date().getTime() : now);
    if (draft && moveCount(draft) === 0) draft = null;

    var root = el('div', 'cgc-view');
    applyMetrics(root);

    var header = el('div', 'cgc-header');
    var back = el('button', 'cgc-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'cgc-title', STR.chooseSide));
    header.appendChild(BiyaIcons.brandLogoEl('cgc-logo'));
    root.appendChild(header);

    if (draft) {
      root.appendChild(el('div', 'cgc-unfinished',
        STR.unfinished(moveCount(draft), colourName(draft.userColor))));
    }

    var row = el('div', 'cgc-sides');
    row.appendChild(sideButton(WHITE, STR.white, STR.whiteSub, draft, cb, root, coachName));
    row.appendChild(sideButton(BLACK, STR.black, STR.blackSub(coachName), draft, cb, root,
                               coachName));
    root.appendChild(row);

    view.appendChild(root);
  }

  function sideButton(colour, title, sub, draft, cb, root, coachName) {
    var b = el('button', 'cgc-side cgc-side-' + colour);
    b.appendChild(el('div', 'cgc-side-chip', colour === WHITE ? STR.kingWhite : STR.kingBlack));
    b.appendChild(el('div', 'cgc-side-title', title));
    b.appendChild(el('div', 'cgc-side-sub', sub));
    b.onclick = function () {
      if (!draft) {
        if (cb.onStart) cb.onStart(resolveStart(colour, null, null));
        return;
      }
      showResumePrompt(root, draft, coachName, function (resume) {
        if (cb.onStart) cb.onStart(resolveStart(colour, draft, resume));
      });
    };
    return b;
  }

  function showResumePrompt(root, draft, coachName, done) {
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', STR.resumeTitle));
    box.appendChild(el('div', 'pz-modal-body',
      STR.resumeBody(moveCount(draft), colourName(draft.userColor)) + ' ' + STR.resumeAsk));
    var row = el('div', 'pz-modal-row');
    var fresh = el('button', 'pz-modal-btn pz-modal-danger', STR.newGame);
    fresh.onclick = function () { scrim.remove(); done(false); };
    var cont = el('button', 'pz-modal-btn pz-modal-keep', STR.continueGame);
    cont.onclick = function () { scrim.remove(); done(true); };
    row.appendChild(fresh);
    row.appendChild(cont);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
    return scrim;
  }

  // ---- Self-test ----------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    // A draft with three moves, saved as Black.
    var asBlack = GAME.newGame(3, BLACK);
    GAME.record(asBlack, 'e2e4');
    GAME.record(asBlack, 'e7e5');
    GAME.record(asBlack, 'g1f3');
    eq(moveCount(asBlack), 3, 'the sentinel is not counted as a move');
    eq(moveCount(GAME.newGame(3, WHITE)), 0, 'a fresh game has no moves');
    eq(moveCount(null), 0, 'and a missing draft has none either');

    // --- spec 7 #33: Continue honours the DRAFT's colour ---
    //
    // This is the whole bug. Tapping White on a game you were playing as Black must resume you as
    // Black; the RN app took the tap and handed you a backwards board full of your own moves.
    var r = resolveStart(WHITE, asBlack, true);
    eq(r.resume, true, 'Continue resumes');
    eq(r.userColor, BLACK, 'and keeps the colour the draft was played as, not the one tapped');
    expect(r.draft === asBlack, 'and carries the draft through');

    var r2 = resolveStart(BLACK, asBlack, true);
    eq(r2.userColor, BLACK, 'tapping the same colour agrees, obviously');

    // New Game takes the tap, because the tap is the only signal there is.
    var r3 = resolveStart(WHITE, asBlack, false);
    eq(r3.resume, false, 'New Game does not resume');
    eq(r3.userColor, WHITE, 'and uses the colour tapped');
    eq(r3.draft, null, 'and drops the draft');
    eq(resolveStart(BLACK, asBlack, false).userColor, BLACK, 'either way round');

    // No draft at all: no prompt, no resume, the tap wins.
    var r4 = resolveStart(BLACK, null, null);
    eq(r4.resume, false, 'with no draft there is nothing to resume');
    eq(r4.userColor, BLACK, 'and the tap decides');
    // A draft with zero moves is not a game worth resuming.
    var empty = GAME.newGame(3, BLACK);
    eq(resolveStart(WHITE, empty, true).resume, false, 'a move-less draft is not resumable');
    eq(resolveStart(WHITE, empty, true).userColor, WHITE, 'so the tap decides there too');

    // An unrecognised colour falls back to White rather than producing an invalid game.
    eq(resolveStart('purple', null, null).userColor, WHITE, 'an unknown colour defaults to White');
    var oddDraft = GAME.newGame(3, WHITE);
    GAME.record(oddDraft, 'e2e4');
    oddDraft.userColor = 'purple';
    eq(resolveStart(BLACK, oddDraft, true).userColor, WHITE,
       'and a corrupt draft colour does too, rather than resuming as nothing');

    // --- copy ---
    eq(colourName(WHITE), STR.white, 'White is named');
    eq(colourName(BLACK), STR.black, 'and Black');
    eq(STR.unfinished(3, STR.black), 'Unfinished game · 3 moves as Black', 'the resume chip reads');
    expect(STR.blackSub('Jade').indexOf('Jade') === 0, 'the Black sub-line names the coach');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-color: ' + passed + ' assertions passed'
        : 'coach-color: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    WHITE: WHITE, BLACK: BLACK,
    render: render, applyMetrics: applyMetrics,
    resolveStart: resolveStart, moveCount: moveCount, colourName: colourName,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachColor; }
