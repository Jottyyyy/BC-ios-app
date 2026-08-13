/* coach-play.js — the game screen (spec 2.7), rendering only.
 *
 *     node -e "console.log(require('./web-demo/js/coach-play.js').selfTest().summary)"
 *
 * The last piece of the Play vs Coach browser UI, and deliberately the thinnest. Everything with a
 * decision in it already lives somewhere testable:
 *
 *   coach-game.js    the record, the result, the draft
 *   coach-turn.js    whose turn, the premove, the nav rules, the generation counter
 *   coach-engine.js  which line to play and how long to appear to think
 *   coach-book.js    the opening repertoire
 *
 * What is left here is the DOM, plus the one piece of presentation logic that is genuinely this
 * screen's own: pairing the move strip. `coach_screen_test.js` renders it headlessly; `movePairs`
 * below is asserted here because it is pure.
 *
 * Every number is a `coach-metrics.js` constant pushed as a `--cgp-*` custom property.
 */
'use strict';

var BiyaCoachPlay = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./coach-metrics.js') : BiyaCoachMetrics;
  var STR = (isNode ? require('./coach-strings.js') : BiyaCoachStrings).STR;
  var GAME = isNode ? require('./coach-game.js') : BiyaCoachGame;
  var TURN = isNode ? require('./coach-turn.js') : BiyaCoachTurn;
  // `Engine`, not `BiyaEngine` — engine.js predates the `Biya*` convention and hangs itself off
  // `window.Engine`. Same trap `coach-game.js` documents.
  var E = isNode ? require('./engine.js') : Engine;
  var RV = isNode ? require('./coach-review.js') : BiyaCoachReview;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * What the board needs in order to let a piece be picked up at all.
   *
   * The component is deliberately rules-free: with no adapter it finds no legal target, so no
   * square is ever selectable and the board looks alive but accepts nothing.
   */
  function rulesAdapter() {
    return {
      legalMovesFrom: function (fen, sq) {
        var pos = E.fromFEN(fen);
        if (!pos) return [];
        return E.legalMovesFrom(pos, sq).map(function (m) {
          return { to: m.to, promotion: m.promotion };
        });
      },
    };
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'cgp', MET.PLAY);
  }

  // ---- The move strip -------------------------------------------------------------------------
  //
  // `fullMoveNumber` was deliberately dropped from the record (spec 2.4): the RN struct wrote it on
  // every move and nothing read it. The strip recomputes pairs from the array index instead, which
  // is the only reason dropping it was safe — so this is the function that has to be right.

  /**
   * `[{ no, white, black, whiteIndex, blackIndex }]` from the record array.
   *
   * Index 0 is the start sentinel and is skipped. `black` is null on an unfinished pair. The
   * indexes point back into `moveRecords`, so tapping a half-move can seek to exactly it.
   */
  function movePairs(game) {
    var out = [];
    var recs = game.moveRecords;
    for (var i = 1; i < recs.length; i += 2) {
      out.push({
        no: Math.floor((i - 1) / 2) + 1,
        white: recs[i].san,
        whiteIndex: i,
        black: i + 1 < recs.length ? recs[i + 1].san : null,
        blackIndex: i + 1 < recs.length ? i + 1 : null,
      });
    }
    return out;
  }

  /** Which half-move is highlighted: the reviewed one, or the newest when live. */
  function activeIndex(game) {
    return GAME.isLive(game) ? game.moveRecords.length - 1 : game.reviewIndex;
  }

  // ---- Render ------------------------------------------------------------------------------------

  /**
   * `cb` is `{ onMove(uci), onResign(), onTakeBack(), onNewGame(), onReview(), onExit(),
   *            onSeek(index) }`.
   *
   * `ctl` is a `coach-turn.js` controller; the caller owns it so it survives repaints.
   */
  function render(view, game, ctl, coach, cb) {
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var root = el('div', 'cgp-view');
    applyMetrics(root);

    root.appendChild(header(game, coach, cb));
    root.appendChild(board(game, ctl, cb));
    root.appendChild(strip(game, cb));
    root.appendChild(navRow(game, cb));
    root.appendChild(actions(game, ctl, cb));

    if (GAME.isOver(game)) root.appendChild(resultCard(game, coach, cb));
    view.appendChild(root);
  }

  function header(game, coach, cb) {
    var h = el('div', 'cgp-header');
    var back = el('button', 'cgp-back', '←');
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    h.appendChild(back);
    var centre = el('div', 'cgp-header-center');
    centre.appendChild(el('div', 'cgp-coach-name', coach && coach.name ? coach.name : ''));
    centre.appendChild(el('div', 'cgp-status', statusLine(game)));
    h.appendChild(centre);
    h.appendChild(el('div', 'cgp-logo'));
    return h;
  }

  function statusLine(game) {
    if (GAME.isOver(game)) {
      if (game.outcome === 'win') return STR.gameOverWon;
      if (game.outcome === 'draw') return STR.gameOverDraw;
      return STR.gameOver;
    }
    return GAME.isLive(game) ? STR.live : STR.reviewing;
  }

  /**
   * The live board.
   *
   * Five things here are the component's contract rather than this screen's choice, and every one
   * of them fails SILENTLY if it is got wrong — which is how all five were wrong in the first
   * version of this function, with a green headless suite:
   *
   *   - moves arrive as a `'move'` CustomEvent, not an `onmove` property. A handler assigned to
   *     `.onmove` is simply never called.
   *   - `detail.from` / `.to` are NUMERIC square indexes. `from + to` is addition, not a UCI
   *     string; `detail.uci` is the string.
   *   - `flipped` is attribute-truthy: anything but `'false'` or absent means flipped, so
   *     `flipped="0"` turns the board upside down for White. Set the PROPERTY instead.
   *   - `highlightLastMove` looks its arguments up in a map keyed by index, so the algebraic
   *     squares the record stores highlight nothing.
   *   - without `.rules` the board can find no legal target, so no piece is ever selectable and no
   *     move can be made at all.
   */
  function board(game, ctl, cb) {
    var wrap = el('div', 'cgp-board-wrap');
    var b = document.createElement('chess-board');
    b.className = 'cgp-board';
    var shown = GAME.displayPosition(game);
    if (b.setPosition) b.setPosition(shown.fen);
    if (b.highlightLastMove) {
      if (shown.from) b.highlightLastMove(E.sqIndex(shown.from), E.sqIndex(shown.to));
      else b.highlightLastMove(null, null);
    }
    b.rules = rulesAdapter();
    b.flipped = GAME.isFlipped(game);
    // The board reports a move; whether it is a move or a premove is the controller's call, not the
    // board's.
    b.addEventListener('move', function (ev) {
      var d = ev && ev.detail;
      if (!d) return;
      if (TURN.canUserMove(game, ctl)) {
        if (cb.onMove) cb.onMove(d.uci);
        return;
      }
      // Split the component's own UCI rather than re-encoding its numeric promotion code —
      // `consumePremove` rebuilds `from + to + promotion` as a UCI string, so it wants exactly the
      // pieces the component already put in one.
      TURN.setPremove(ctl, game, d.uci.slice(0, 2), d.uci.slice(2, 4), d.uci.slice(4) || null);
    });
    wrap.appendChild(b);
    if (ctl && ctl.premove) {
      var badge = el('div', 'cgp-premove', STR.premove(ctl.premove.from, ctl.premove.to));
      badge.onclick = function () { TURN.clearPremove(ctl); badge.remove(); };
      wrap.appendChild(badge);
    }
    return wrap;
  }

  function strip(game, cb) {
    var s = el('div', 'cgp-strip');
    var active = activeIndex(game);
    movePairs(game).forEach(function (p) {
      var row = el('div', 'cgp-pair');
      row.appendChild(el('div', 'cgp-no', String(p.no)));
      row.appendChild(half(p.white, p.whiteIndex, active, cb));
      if (p.black != null) row.appendChild(half(p.black, p.blackIndex, active, cb));
      s.appendChild(row);
    });
    return s;
  }

  function half(san, index, active, cb) {
    var b = el('button', 'cgp-san' + (index === active ? ' on' : ''), san);
    b.onclick = function () { if (cb.onSeek) cb.onSeek(index); };
    return b;
  }

  function navRow(game, cb) {
    var nav = TURN.navState(game);
    var row = el('div', 'cgp-nav');
    // `⏮` and `◀` take the SAME flag — see coach-turn.js. Passing `nav.canFirst` to one and
    // `nav.canPrev` to the other would reintroduce the inconsistency by hand.
    row.appendChild(navButton('⏮', nav.canFirst, function () { cb.onSeek && cb.onSeek(0); }));
    row.appendChild(navButton('◀', nav.canPrev,
      function () { cb.onSeek && cb.onSeek(nav.index - 1); }));
    row.appendChild(navButton('▶', nav.canNext,
      function () { cb.onSeek && cb.onSeek(nav.index + 1); }));
    row.appendChild(navButton('⏭', nav.canLast, function () { cb.onSeek && cb.onSeek(nav.last); }));
    if (nav.canLive) {
      row.appendChild(navButton(STR.liveButton, true, function () { cb.onSeek && cb.onSeek(null); }));
    }
    return row;
  }

  function navButton(label, enabled, onClick) {
    var b = el('button', 'cgp-nav-btn' + (enabled ? '' : ' off'), label);
    b.disabled = !enabled;
    if (enabled) b.onclick = onClick;
    return b;
  }

  function actions(game, ctl, cb) {
    var row = el('div', 'cgp-actions');
    if (GAME.isOver(game)) return row;
    var resign = el('button', 'cgp-resign', STR.resign);
    // #24 — resign asks first. One tap ending the game is the RN behaviour and the defect.
    resign.onclick = function () { if (cb.onResign) cb.onResign(); };
    row.appendChild(resign);
    var back = el('button', 'cgp-takeback', STR.takeBack);
    back.onclick = function () { if (cb.onTakeBack) cb.onTakeBack(); };
    row.appendChild(back);
    return row;
  }

  function resultCard(game, coach, cb) {
    var card = el('div', 'cgp-result');
    card.appendChild(el('div', 'cgp-result-title', resultTitle(game)));
    card.appendChild(el('div', 'cgp-result-body', game.result || ''));
    var row = el('div', 'cgp-result-row');
    var again = el('button', 'cgp-rematch', STR.rematch);
    // `play.tsx` writes `[styles.modalBtn, { backgroundColor: coach.accentColor }]` — the primary
    // button is the coach's own colour, which is why `modalBtn` carries no background in the
    // StyleSheet. `MET.ACCENTS` is the same five values, read out of `COACH_DATA` by the generator.
    if (coach && MET.ACCENTS[coach.level]) {
      again.style.setProperty('background', MET.ACCENTS[coach.level]);
    }
    again.onclick = function () { if (cb.onNewGame) cb.onNewGame(); };
    row.appendChild(again);
    // Still conditional on the host wiring it, and additionally on there being a game to review:
    // one move is not a game, and the accuracy would be a mean over nothing.
    if (typeof cb.onReview === 'function' && RV.isReviewable(game)) {
      var review = el('button', 'cgp-review', STR.reviewGame);
      review.onclick = function () { cb.onReview(); };
      row.appendChild(review);
    }
    card.appendChild(row);
    return card;
  }

  function resultTitle(game) {
    if (game.outcome === 'win') return STR.youWon;
    if (game.outcome === 'loss') return STR.youLost;
    return STR.draw;
  }

  /** The resign confirmation (#24). Shown by the caller, appended to the screen root. */
  function resignPrompt(root, coachName, done) {
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', STR.resignTitle));
    box.appendChild(el('div', 'pz-modal-body', STR.resignBody(coachName)));
    var row = el('div', 'pz-modal-row');
    var yes = el('button', 'pz-modal-btn pz-modal-danger', STR.resign);
    yes.onclick = function () { scrim.remove(); done(true); };
    var no = el('button', 'pz-modal-btn pz-modal-keep', STR.keepPlaying);
    no.onclick = function () { scrim.remove(); done(false); };
    row.appendChild(yes);
    row.appendChild(no);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
    return scrim;
  }

  /**
   * The Game Review modal (spec 2.10).
   *
   * `state` is `{ running, done, total, summary, userColor }`. Running and finished are one
   * function because they are one modal: the progress bar is replaced in place, so a review that
   * finishes does not flash a second card.
   *
   * `Analyzing... {done}/{total}` replaces the RN spinner and its "This may take 20-30 seconds".
   * On-device the position count is known before the first search starts, so there is nothing to
   * guess at — and the old wording was wrong anyway, since it described a network round trip.
   */
  function reviewModal(root, state, cb) {
    cb = cb || {};
    var scrim = el('div', 'cgp-review-scrim');
    var card = el('div', 'cgp-review-card');
    // `play.tsx` writes `{ borderColor: coach.accentColor + '30' }` — the accent with a hex alpha
    // BYTE appended, not a percentage. The Pairing Manager already shipped that confusion once (a
    // tint built from `'20'` read as 20 %), so the byte is preserved exactly as written.
    if (state.accent) card.style.setProperty('border-color', state.accent + ACCENT_ALPHA_BYTE);
    card.appendChild(el('div', 'cgp-review-title', STR.gameReview));

    if (state.running) {
      card.appendChild(el('div', 'cgp-review-progress-text',
                          STR.analyzing(state.done || 0, state.total || 0)));
      var track = el('div', 'cgp-review-bar');
      var fill = el('div', 'cgp-review-bar-fill');
      // The one computed width in this file, because a determinate bar IS a ratio. Guarded so a
      // zero total cannot produce `NaN%`, which renders as a full bar.
      var pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
      fill.style.setProperty('width', pct + '%');
      track.appendChild(fill);
      card.appendChild(track);
      var cancel = el('button', 'cgp-review-cancel', STR.keepPlaying);
      cancel.onclick = function () { scrim.remove(); if (cb.onCancel) cb.onCancel(); };
      card.appendChild(cancel);
      scrim.appendChild(card);
      root.appendChild(scrim);
      return scrim;
    }

    var s = state.summary;
    if (!s) return null;

    // Players row - both halves read `columns`, which is the orientation fix.
    var cols = RV.columns(s, state.userColor);
    var row = el('div', 'cgp-review-players');
    cols.forEach(function (c, i) {
      if (i > 0) row.appendChild(el('div', 'cgp-review-divider'));
      var colEl = el('div', 'cgp-review-col');
      colEl.appendChild(el('div', 'cgp-review-col-label', c.label));
      var val = el('div', 'cgp-review-accuracy', RV.accuracyText(c.accuracy));
      val.style.setProperty('color', RV.accuracyColor(c.accuracy));
      colEl.appendChild(val);
      colEl.appendChild(el('div', 'cgp-review-accuracy-label', STR.accuracy));
      row.appendChild(colEl);
    });
    card.appendChild(row);

    var pts = RV.graphPoints(s.evalGraph, GRAPH_W, GRAPH_H);
    if (pts.length) card.appendChild(graph(pts));

    var block = el('div', 'cgp-review-classes');
    RV.classificationRows(s, state.userColor).forEach(function (r) {
      var line = el('div', 'cgp-review-class');
      var tint = RV.classColor(r.key);
      line.appendChild(count(r.left, tint));
      line.appendChild(dot(tint));
      line.appendChild(el('div', 'cgp-review-class-label', RV.classLabel(r.key)));
      line.appendChild(dot(tint));
      line.appendChild(count(r.right, tint));
      block.appendChild(line);
    });
    card.appendChild(block);

    var actions = el('div', 'cgp-review-actions');
    var start = el('button', 'cgp-review-start', STR.startReview);
    start.onclick = function () { scrim.remove(); if (cb.onStartReview) cb.onStartReview(); };
    var again = el('button', 'cgp-review-newgame', STR.newGame);
    again.onclick = function () { scrim.remove(); if (cb.onNewGame) cb.onNewGame(); };
    actions.appendChild(start);
    actions.appendChild(again);
    card.appendChild(actions);

    scrim.appendChild(card);
    root.appendChild(scrim);
    return scrim;
  }

  /** The hex alpha byte `play.tsx` appends to the accent for the review card's border. */
  var ACCENT_ALPHA_BYTE = '30';

  /** The graph's own viewBox. Not a rendered size: the SVG scales to whatever the card allows. */
  var GRAPH_W = 100, GRAPH_H = 60;

  function dot(tint) {
    var d = el('div', 'cgp-review-dot');
    if (tint) d.style.setProperty('background', tint);
    return d;
  }

  function count(n, tint) {
    var c = el('div', 'cgp-review-count', String(n));
    if (tint) c.style.setProperty('color', tint);
    return c;
  }

  /** The eval curve as an inline SVG polyline - no canvas, so it scales with the card. */
  function graph(pts) {
    var wrap = el('div', 'cgp-review-graph');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + GRAPH_W + ' ' + GRAPH_H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'cgp-review-svg');
    var mid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    mid.setAttribute('x1', '0');
    mid.setAttribute('x2', String(GRAPH_W));
    mid.setAttribute('y1', String(GRAPH_H / 2));
    mid.setAttribute('y2', String(GRAPH_H / 2));
    mid.setAttribute('class', 'cgp-review-mid');
    svg.appendChild(mid);
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', pts.map(function (p) { return p.x + ',' + p.y; }).join(' '));
    line.setAttribute('class', 'cgp-review-curve');
    svg.appendChild(line);
    wrap.appendChild(svg);
    return wrap;
  }

  // ---- Self-test -------------------------------------------------------------------------------
  //
  // Only the pure part. The DOM is `coach_screen_test.js`'s job.

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    var g = GAME.newGame(3, 'w');
    eq(movePairs(g).length, 0, 'a fresh game has no pairs — the sentinel is not a move');

    GAME.record(g, 'e2e4');
    var p1 = movePairs(g);
    eq(p1.length, 1, 'one half-move makes one pair');
    eq(p1[0].no, 1, 'numbered from 1');
    eq(p1[0].white, 'e4', 'with the SAN');
    eq(p1[0].whiteIndex, 1, 'pointing at record 1, not 0');
    eq(p1[0].black, null, 'and no reply yet');
    eq(p1[0].blackIndex, null, 'so no index for one');

    GAME.record(g, 'e7e5');
    var p2 = movePairs(g);
    eq(p2.length, 1, 'the reply completes the same pair');
    eq(p2[0].black, 'e5', 'with its SAN');
    eq(p2[0].blackIndex, 2, 'and its own index');

    GAME.record(g, 'g1f3');
    var p3 = movePairs(g);
    eq(p3.length, 2, 'the next move starts a new pair');
    eq(p3[1].no, 2, 'numbered 2');
    eq(p3[1].white, 'Nf3', 'the SAN is the engine\'s, not reconstructed');
    eq(p3[1].black, null, 'awaiting a reply');

    // The numbering must survive a long game — this is what replaced `fullMoveNumber`.
    var long = GAME.newGame(3, 'w');
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'].forEach(function (m) {
      GAME.record(long, m);
    });
    var lp = movePairs(long);
    eq(lp.length, 3, 'six half-moves make three pairs');
    eq(lp.map(function (x) { return x.no; }).join(','), '1,2,3', 'numbered 1,2,3');
    eq(lp[2].white, 'Bc4', 'the third pair is right');
    // Every index points back at the record it names.
    lp.forEach(function (pair) {
      eq(long.moveRecords[pair.whiteIndex].san, pair.white,
         'pair ' + pair.no + ' White index resolves to its own move');
      if (pair.black != null) {
        eq(long.moveRecords[pair.blackIndex].san, pair.black,
           'pair ' + pair.no + ' Black index resolves to its own move');
      }
    });

    // --- the highlighted half-move ---
    eq(activeIndex(long), long.moveRecords.length - 1, 'live highlights the newest move');
    GAME.setReviewIndex(long, 3);
    eq(activeIndex(long), 3, 'reviewing highlights the reviewed one');
    GAME.setReviewIndex(long, null);
    eq(activeIndex(long), long.moveRecords.length - 1, 'and returning to live highlights the newest');

    // --- the status line names the outcome ---
    var over = GAME.newGame(3, 'w');
    eq(statusLine(over), STR.live, 'a live game says LIVE');
    // A game with only the sentinel CANNOT be reviewed — index 0 is already the newest record, so
    // `setReviewIndex` correctly snaps back to live. Reviewing needs something to look back at.
    GAME.setReviewIndex(over, 0);
    eq(statusLine(over), STR.live, 'a move-less game stays live even when asked to review');
    GAME.record(over, 'e2e4');
    GAME.setReviewIndex(over, 0);
    eq(statusLine(over), STR.reviewing, 'once there is a move, reviewing says so');
    var lost = GAME.newGame(3, 'w');
    lost.resigned = true;
    GAME.applyEvaluation(lost, { name: 'Jade', winMsg: 'w', loseMsg: 'l' });
    eq(statusLine(lost), STR.gameOver, 'a lost game says game over');
    eq(resultTitle(lost), STR.youLost, 'and the card says You Lost');
    var drawn = GAME.newGame(3, 'w');
    drawn.outcome = 'draw';
    eq(statusLine(drawn), STR.gameOverDraw, 'a drawn game says so');
    eq(resultTitle(drawn), STR.draw, 'and the card agrees');
    var won = GAME.newGame(3, 'w');
    won.outcome = 'win';
    eq(statusLine(won), STR.gameOverWon, 'a won game says so');
    eq(resultTitle(won), STR.youWon, 'and the card agrees');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-play: ' + passed + ' assertions passed'
        : 'coach-play: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    render: render, applyMetrics: applyMetrics, resignPrompt: resignPrompt,
    reviewModal: reviewModal, ACCENT_ALPHA_BYTE: ACCENT_ALPHA_BYTE,
    movePairs: movePairs, activeIndex: activeIndex,
    statusLine: statusLine, resultTitle: resultTitle,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachPlay; }
