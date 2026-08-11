/* puzzle-solver.js — the Play Puzzles solver (spec Part 10.2 / 10.3).
 *
 * Browser mirror of `PuzzleSolverScreen.swift` + `PuzzleSolverVM.swift`.
 *
 * Five bands: header · info strip · board · stats row · bottom panel. All five modes will use this
 * shell; this file configures it for RATED play, which is the only mode that touches Elo.
 *
 * ── What this file does NOT contain ──────────────────────────────────────────
 * No validation, no wrong-move policy, no promotion rule, no Elo, no selection ladder, and not a
 * single layout number. Those live in `puzzle-session.js`, `puzzle-store.js`, `puzzle-progress.js`
 * and `puzzle-metrics.js`, all of which are asserted without a renderer. What is left here is DOM,
 * timers and sound — the parts a headless suite genuinely cannot check.
 *
 * That split is load-bearing: the moment a number or a rule appears in this file, it stops being
 * covered, and nothing tells you.
 */
'use strict';

var BiyaPuzzleSolver = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  // Declared explicitly, every one, so a missing <script> tag fails at load. Twice in this rebuild
  // a module reached for a global it never loaded and the failure surfaced inside a click handler
  // where nothing reported it.
  var E    = isNode ? require('./engine.js')          : Engine;
  var S    = isNode ? require('./puzzle-session.js')  : BiyaPuzzleSession;
  var MET  = isNode ? require('./puzzle-metrics.js')  : BiyaPuzzleMetrics;
  var AMET = isNode ? require('./analysis-metrics.js'): BiyaAnalysisMetrics;
  var APP  = isNode ? require('./puzzle-app.js')      : BiyaPuzzleApp;
  var HOST = isNode ? require('./engine-host.js')     : BiyaEngineHost;
  var ST   = isNode ? require('./analysis-store.js')  : BiyaAnalysisStore;
  var AN   = isNode ? require('./analysis-engine.js') : BiyaAnalysis;
  // `SoundManager` is the global `sound.js` actually exports. Every puzzle screen used to
  // test `typeof Sound`, which is nothing, so `SND` was permanently null and not one of the
  // five modes ever made a sound. A `typeof X !== 'undefined'` guard degrades silently by
  // design, which is why `puzzle_screen_test.js` now asserts this resolves NON-NULL rather
  // than merely that the code runs.
  var SND  = (typeof SoundManager !== 'undefined') ? SoundManager : null;

  var PROG = APP.PROG;

  // ---- module state --------------------------------------------------------------------
  var session = null;        // BiyaPuzzleSession state
  var puzzle = null;         // the row from the corpus slice
  var ui = null;             // element refs, captured once so repaints never rebuild the DOM
  var root = null;
  var onExitCb = null;
  var engineToken = 0;       // bumped to abandon a search in flight
  var timers = [];           // every setTimeout, so leaving the screen cancels all of them
  var clock = { startedAt: null, stoppedAt: null, tick: null };
  var ratingDelta = null;    // the last rated result, kept so Retry cannot clear it (fix (c))
  var engineLines = null;
  var engineBusy = false;
  var saved = false;

  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function cancelTimers() { timers.forEach(clearTimeout); timers = []; }
  function play(sound) { if (SND && sound) SND.play(sound); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- metrics → CSS custom properties -----------------------------------------------------
  // The stylesheet carries no layout constant of its own; every number arrives here, from the
  // layer that is asserted against the real RN StyleSheet.
  function applyMetrics(node) {
    var P = MET.PALETTE, V = MET.SOLVER, EN = MET.ENGINE, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card); set('--pz-card-alt', P.cardAlt);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold); set('--pz-on-gold', P.onGold);
    // `--pz-correct` / `--pz-wrong` are gone: the feedback banner styles itself from the
    // per-state fills (`--pzs-fb-ok-fill` and friends), so the bare palette pair was never
    // read. The palette entries themselves are still asserted in the metrics layer.
    set('--pz-eval', P.engineEval);
    set('--pz-header-pad-h', V.headerPaddingH + 'px');
    set('--pz-header-pad-v', V.headerPaddingV + 'px');
    set('--pz-back-w', V.backBtnW + 'px'); set('--pz-back-h', V.backBtnH + 'px');
    set('--pz-back-fs', V.backIconSize + 'px'); set('--pz-logo', V.logoSize + 'px');
    set('--pz-strip-h', V.infoStripHeight + 'px');
    set('--pz-strip-pad-h', V.infoStripPaddingH + 'px');
    set('--pz-strip-fs', T.solverInfoStrip + 'px');
    set('--pz-stats-pad-v', V.statsPaddingV + 'px');
    set('--pz-stats-pad-h', V.statsPaddingH + 'px');
    set('--pz-stat-label-fs', T.solverStatLabel + 'px');
    set('--pz-stat-label-mb', V.statLabelMarginBottom + 'px');
    set('--pz-stat-value-fs', T.solverStatValue + 'px');
    set('--pz-delta-fs', T.solverRatingDelta + 'px');
    set('--pz-delta-mt', V.ratingDeltaMarginTop + 'px');
    set('--pz-bottom-pad-h', V.bottomPaddingH + 'px');
    set('--pz-bottom-pad-t', V.bottomPaddingTop + 'px');
    set('--pz-row-gap', V.wrongRowGap + 'px');
    set('--pz-btn-fs', T.solverButton + 'px');
    set('--pz-retry-fill', V.retryFill); set('--pz-retry-r', V.retryRadius + 'px');
    set('--pz-retry-pad-v', V.retryPaddingV + 'px'); set('--pz-retry-border', V.retryBorderColor);
    set('--pz-next-pad-h', V.nextPaddingH + 'px'); set('--pz-next-pad-v', V.nextPaddingV + 'px');
    set('--pz-next-mt', V.nextMarginTop + 'px'); set('--pz-next-mb', V.nextMarginBottom + 'px');
    set('--pz-eng-r', EN.radius + 'px'); set('--pz-eng-pad', EN.padding + 'px');
    set('--pz-eng-border', EN.borderColor);
    set('--pz-eng-head-mb', EN.headerMarginBottom + 'px');
    set('--pz-eng-title-fs', EN.titleSize + 'px'); set('--pz-eng-refresh-fs', EN.refreshSize + 'px');
    set('--pz-eng-row-pad-v', EN.rowPaddingV + 'px'); set('--pz-eng-row-gap', EN.rowGap + 'px');
    set('--pz-eng-row-border', EN.rowBorderColor);
    set('--pz-eng-dot-fs', EN.dotSize + 'px'); set('--pz-eng-dot-w', EN.dotWidth + 'px');
    set('--pz-eng-san-fs', EN.sanSize + 'px'); set('--pz-eng-san-w', EN.sanWidth + 'px');
    set('--pz-eng-eval-fs', EN.evalSize + 'px'); set('--pz-eng-eval-w', EN.evalWidth + 'px');
    set('--pz-eng-pv-fs', EN.pvSize + 'px');
    var SV = MET.SAVE_SHEET;
    set('--pz-save-fill', SV.buttonFill); set('--pz-save-r', SV.buttonRadius + 'px');
    set('--pz-save-pad-v', SV.buttonPaddingV + 'px'); set('--pz-save-mt', SV.buttonMarginTop + 'px');
    set('--pz-save-border', SV.buttonBorderColor); set('--pz-saved-border', SV.savedBorderColor);
    set('--pz-save-fs', SV.buttonTextSize + 'px');
    set('--pz-sheet-scrim', SV.scrim); set('--pz-sheet-r', SV.cardRadiusTop + 'px');
    set('--pz-sheet-pad', SV.cardPadding + 'px'); set('--pz-sheet-pad-b', SV.cardPaddingBottom + 'px');
    set('--pz-sheet-title-fs', SV.titleSize + 'px');
    set('--pz-sheet-title-mb', SV.titleMarginBottom + 'px');
    set('--pz-sheet-label-fs', SV.labelSize + 'px');
    set('--pz-sheet-label-mb', SV.labelMarginBottom + 'px');
    set('--pz-sheet-input-r', SV.inputRadius + 'px'); set('--pz-sheet-input-fs', SV.inputSize + 'px');
    set('--pz-sheet-input-pad-h', SV.inputPaddingH + 'px');
    set('--pz-sheet-input-pad-v', SV.inputPaddingV + 'px');
    set('--pz-sheet-input-mb', SV.inputMarginBottom + 'px');
    set('--pz-sheet-input-border', SV.inputBorderColor);
    set('--pz-sheet-notes-h', SV.notesMinHeight + 'px');
    set('--pz-sheet-row-gap', SV.rowGap + 'px'); set('--pz-sheet-row-mt', SV.rowMarginTop + 'px');
    set('--pz-sheet-btn-fs', SV.buttonRowTextSize + 'px');
    // No loading-state properties. Every mode serves synchronously from the bundled corpus,
    // so no screen renders the source's spinner — styling a state that cannot appear is
    // inventing UI. If offline serving ever becomes async, the extracted values are still in
    // the metrics layer waiting.
    set('--piece-anim', AMET.TIMINGS.pieceAnimation + 'ms');
      // The promotion dialog lives in <chess-board>'s shadow tree and reads these by
    // inheritance. `mode` picks the scrim and the accent; nothing else varies.
    MET.applyPromotion(node, 'play');
}

  // ---- the clock -----------------------------------------------------------------------
  // Derived from wall-clock, never accumulated from ticks, so a dropped tick cannot drift.
  function startClock() {
    clock.startedAt = Date.now();
    clock.stoppedAt = null;
    clearInterval(clock.tick);
    clock.tick = setInterval(paintStats, S.TIMING.tickMs);
  }
  function stopClock() {
    if (clock.startedAt && !clock.stoppedAt) clock.stoppedAt = Date.now();
    clearInterval(clock.tick);
    clock.tick = null;
  }
  function elapsedSeconds() {
    if (!clock.startedAt) return null;
    return Math.floor(((clock.stoppedAt || Date.now()) - clock.startedAt) / 1000);
  }

  // ---- mounting a puzzle (Part 5.3) --------------------------------------------------------
  function mount(next) {
    cancelTimers();
    stopClock();
    clock.startedAt = null; clock.stoppedAt = null;
    engineToken += 1;
    engineLines = null; engineBusy = false; saved = false;

    puzzle = next;
    session = S.create(puzzle, 'play');
    play('game-start');
    paintAll();

    later(function () {
      var r = S.applySetupMove(session);
      play(r.sound);
      // The rated clock starts after the opponent's setup move, not before it.
      startClock();
      paintAll();
    }, S.TIMING.opponentDelayMs.play);
  }

  function nextPuzzle() {
    var r = APP.serveRated();
    if (!r.puzzle) { paintAll(); return; }
    ratingDelta = null;
    PROG.savePlayDraft(APP.state(), r.puzzle.id, Date.now());
    APP.persist();
    mount(r.puzzle);
  }

  // ---- submitting -------------------------------------------------------------------------
  function onBoardMove(ev) {
    if (!session) return;
    var d = ev.detail;
    submit(d.from, d.to, d.promotion);
  }

  function submit(from, to, promotion) {
    var out = S.submit(session, from, to, promotion);
    if (out.kind === 'illegal') { paintBoard(); return; }
    if (out.kind === 'freePlay') { play(out.sound); paintAll(); return; }

    if (out.kind === 'correct') {
      play(out.sound);
      if (out.solved) { finish(true); return; }
      paintAll();
      later(function () {
        var r = S.applyOpponentReply(session);
        play(r.sound);
        paintAll();
        if (r.solved) later(function () { finish(true); }, r.solvedAfterMs);
      }, out.opponentReplyAfterMs);
      return;
    }

    // wrong — the policy comes from the session, not from here
    finish(false);
  }

  function finish(correct) {
    stopClock();
    if (correct) play('game-over');
    // Rated submission, exactly once per puzzle. `recordRatedAttempt` enforces that itself; the
    // delta is kept in module state so a Retry cannot blank it (the third retry bug).
    var res = PROG.recordRatedAttempt(APP.state(), {
      puzzleId: puzzle.id, isCorrect: correct, puzzleRating: puzzle.rating,
      themes: puzzle.themes, solveTimeSeconds: elapsedSeconds(),
    }, Date.now());
    if (res.firstAttempt) ratingDelta = res.ratingChange;
    if (correct) { APP.state().playDraft = null; }
    APP.persist();
    paintAll();
  }

  function retry() {
    var r = S.retry(session);
    cancelTimers();
    stopClock();
    clock.startedAt = null; clock.stoppedAt = null;
    play(r.sound);                      // fix (b) — the original skipped this
    paintAll();
    later(function () {
      var s = S.applySetupMove(session);
      play(s.sound);
      if (r.restartClock) startClock();  // fix (a) — the original never reset startTime
      paintAll();
    }, r.setupAfterMs);
  }

  function revealSolution() {
    S.revealSolution(session);
    stopClock();
    paintAll();
    runEngine();
  }

  // ---- the engine panel (Part 18) -------------------------------------------------------
  function runEngine() {
    if (!session) return;
    var token = ++engineToken;
    engineBusy = true;
    engineLines = null;
    paintEngine();
    // `analyzeProgressive` takes a POSITION, not a FEN, and reports through `onDepth` — the same
    // contract the Analysis Board uses, so both screens share one worker and one budget.
    HOST.analyzeProgressive(session.position, {
      maxDepth: AMET.ENGINE_LIMITS.maxDepth,
      multiPV: AMET.ENGINE_LIMITS.multiPV,
      deadlineMs: AMET.TIMINGS.engineDeadline,
      shouldCancel: function () { return token !== engineToken; },
      onDepth: function (snap) {
        if (token !== engineToken) return;
        engineLines = engineRowsOf(snap);
        paintEngine();
      },
    }).then(function (snap) {
      if (token !== engineToken) return;
      engineBusy = false;
      if (snap) engineLines = engineRowsOf(snap);
      paintEngine();
      paintBoard();
    });
  }

  /** A snapshot's lines, flattened to what the panel and the arrows both need. */
  function engineRowsOf(snap) {
    if (!snap || !snap.lines) return [];
    return snap.lines.map(function (ln, i) {
      var first = ln.pv && ln.pv.length ? ln.pv[0] : null;
      return {
        rank: i,
        san: (ln.pvSAN && ln.pvSAN[0]) || '',
        evalText: AN.formatScore(ln.score),
        continuation: (ln.pvSAN || []).slice(MET.ENGINE.pvFrom, MET.ENGINE.pvTo).join(' '),
        from: first ? E.sqName(first.from) : null,
        to: first ? E.sqName(first.to) : null,
      };
    });
  }

  // ---- painting ---------------------------------------------------------------------------
  function paintAll() { paintStrip(); paintBoard(); paintStats(); paintBottom(); }

  function paintStrip() {
    if (!ui) return;
    var st = MET.infoStrip(session ? session.phase : 'loading', {
      userIsWhite: session ? session.userColor === E.WHITE : true,
      solveTimeSeconds: session && session.phase === 'solved' ? elapsedSeconds() : null,
    });
    ui.strip.textContent = st.text;
    ui.strip.style.color = st.color;
  }

  function paintBoard() {
    if (!ui || !session) return;
    var b = ui.board;
    b.flipped = session.flipped;
    b.setPosition(E.toFEN(session.position), {
      animate: true,
      lastMove: session.lastMove || null,
    });
    // Locked to the solver's own colour while playing; unlocked for two-sided play once the
    // solution is out (Part 6.5).
    b.interactive = session.phase === 'playing' || session.phase === 'reviewing';
    // Part 18: the top lines drawn over the board, and only once the answer is out.
    var showArrows = session.phase === 'reviewing' || session.phase === 'solved';
    b.arrows = (showArrows && engineLines)
      ? engineLines.slice(0, MET.ENGINE.playLines)
          .filter(function (l) { return l.from && l.to; })
          .map(function (l, i) { return { from: l.from, to: l.to, rank: i }; })
      : [];
  }

  function paintStats() {
    if (!ui) return;
    var st = APP.state();
    ui.rating.textContent = String(st.profile.rating);
    var d = MET.deltaStyle(ratingDelta);
    ui.delta.textContent = d ? d.text : '';
    ui.delta.style.color = d ? d.color : 'transparent';
    ui.timer.textContent = MET.formatTime(elapsedSeconds());
    ui.puzzleRating.textContent = puzzle ? String(puzzle.rating) : '—';
  }

  function paintEngine() {
    if (!ui || !ui.engine) return;
    var T = MET.STR;
    ui.engineTitle.textContent = engineBusy && !engineLines ? T.analyzing : T.engineSuggestions;
    ui.engineRows.innerHTML = '';
    (engineLines || []).slice(0, MET.ENGINE.playLines).forEach(function (line, i) {
      var row = el('div', 'pz-eng-row');
      var dot = el('span', 'pz-eng-dot', '●');
      dot.style.color = AMET.arrowColor(i);
      row.appendChild(dot);
      row.appendChild(el('span', 'pz-eng-san', line.san));
      row.appendChild(el('span', 'pz-eng-eval', line.evalText || ''));
      // `pv[1..<6]` — the first move is already the SAN column.
      row.appendChild(el('span', 'pz-eng-pv', line.continuation));
      ui.engineRows.appendChild(row);
    });
  }

  function paintBottom() {
    if (!ui) return;
    var panel = ui.bottom;
    panel.innerHTML = '';
    var phase = session ? session.phase : 'loading';
    var plan = MET.bottomPanel(phase, 'play');
    if (!plan.buttons.length) return;      // playing: no buttons at all. Deliberate.

    var T = MET.STR;
    function button(cls, label, fn) {
      var b = el('button', cls, label);
      b.onclick = fn;
      return b;
    }
    if (phase === 'solved') {
      panel.appendChild(button('pz-btn pz-btn-gold', T.solution, revealSolution));
      panel.appendChild(button('pz-btn pz-btn-gold pz-next', T.nextPuzzle, nextPuzzle));
    } else if (phase === 'failed') {
      var row = el('div', 'pz-wrong-row');
      row.appendChild(button('pz-btn pz-btn-alt', T.retry, retry));
      row.appendChild(button('pz-btn pz-btn-gold', T.solutionBtn, revealSolution));
      panel.appendChild(row);
      panel.appendChild(button('pz-btn pz-btn-gold pz-next', T.nextPuzzle, nextPuzzle));
    } else if (phase === 'reviewing') {
      panel.appendChild(enginePanel());
      panel.appendChild(button('pz-save' + (saved ? ' pz-saved' : ''),
        saved ? T.savedToBoard : T.savePuzzle, saved ? function () {} : openSaveSheet));
      panel.appendChild(button('pz-btn pz-btn-gold pz-next', T.nextPuzzle, nextPuzzle));
    }
  }

  function enginePanel() {
    var wrap = el('div', 'pz-engine');
    var head = el('div', 'pz-eng-head');
    ui.engineTitle = el('span', 'pz-eng-title', MET.STR.analyzing);
    var refresh = el('button', 'pz-eng-refresh', MET.STR.refresh);
    // Spec fix #4: in the original this cleared the panel and the stale-FEN guard then cancelled
    // the re-request, so it emptied and never refilled. Here it genuinely re-runs.
    refresh.onclick = runEngine;
    head.appendChild(ui.engineTitle);
    head.appendChild(refresh);
    wrap.appendChild(head);
    ui.engineRows = el('div', 'pz-eng-rows');
    wrap.appendChild(ui.engineRows);
    ui.engine = wrap;
    paintEngine();
    return wrap;
  }

  // ---- Save Puzzle (Part 10.3) --------------------------------------------------------------
  function openSaveSheet() {
    var SV = MET.SAVE_SHEET, T = MET.STR;
    var scrim = el('div', 'pz-sheet-scrim');
    var card = el('div', 'pz-sheet-card');
    card.appendChild(el('div', 'pz-sheet-title', '💾 ' + T.savePuzzle.replace('💾 ', '')));
    card.appendChild(el('div', 'pz-sheet-label', T.saveName));
    var name = el('input', 'pz-sheet-input');
    name.value = S.savePuzzleName(puzzle);
    name.placeholder = T.saveNamePlaceholder;
    name.maxLength = SV.nameMax;
    card.appendChild(name);
    card.appendChild(el('div', 'pz-sheet-label', T.saveNotes));
    var notes = el('textarea', 'pz-sheet-input pz-sheet-notes');
    notes.value = S.savePuzzleNotes(puzzle);
    notes.placeholder = T.saveNotesPlaceholder;
    card.appendChild(notes);
    var row = el('div', 'pz-sheet-row');
    var cancel = el('button', 'pz-btn pz-btn-alt', T.cancel);
    cancel.onclick = function () { scrim.remove(); };
    var save = el('button', 'pz-btn pz-btn-gold', T.save);
    save.onclick = function () {
      // Writes an AnalysisSession through the existing library — the puzzle lands in the Analysis
      // Board's saved list, which is exactly what the server version did over HTTP.
      var lib = ST.load(Date.now());
      ST.saveSession(lib, {
        title: name.value.slice(0, SV.nameMax),
        notes: notes.value,
        initialFen: puzzle.fen,
        pgn: S.solutionPGN(puzzle),
      }, Date.now());
      ST.save(lib);
      saved = true;
      scrim.remove();
      paintBottom();
    };
    row.appendChild(cancel); row.appendChild(save);
    card.appendChild(row);
    scrim.appendChild(card);
    scrim.onclick = function (e) { if (e.target === scrim) scrim.remove(); };
    root.appendChild(scrim);
    name.focus();
  }

  // ---- render ---------------------------------------------------------------------------
  function render(view, onExit) {
    onExitCb = onExit;
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    cancelTimers();
    engineToken += 1;

    root = el('div', 'pz-view');
    applyMetrics(root);
    ui = {};

    // 1 — header
    var header = el('div', 'pz-header');
    var back = el('button', 'pz-back', '←');
    back.onclick = function () {
      // Leaving with an unsolved puzzle keeps a draft; the 24h TTL decides whether it restores.
      if (session && session.phase !== 'solved' && puzzle) {
        PROG.savePlayDraft(APP.state(), puzzle.id, Date.now());
        APP.persist();
      }
      cancelTimers(); stopClock(); engineToken += 1;
      if (onExitCb) onExitCb();
    };
    header.appendChild(back);
    header.appendChild(el('div', 'pz-logo'));
    header.appendChild(el('div', 'pz-spacer'));
    root.appendChild(header);

    // 2 — info strip
    ui.strip = el('div', 'pz-strip', MET.STR.loading);
    root.appendChild(ui.strip);

    // 3 — board, left-aligned at x = 0 with the arrow overlay on top of it, not centred over it
    // (spec fix #12: in the source the board sits at x = 0 while the overlay is `alignItems:
    // 'center'`, so they disagree by up to ~3.5px).
    var boardBand = el('div', 'pz-board');
    ui.board = document.createElement('chess-board');
    ui.board.setAttribute('draggable-pieces', '');
    ui.board.rules = {
      legalMovesFrom: function (fen, sq) {
        var pos = E.fromFEN(fen);
        if (!pos) return [];
        var from = E.sqIndex(sq);
        return E.legalMoves(pos).filter(function (m) { return m.from === from; })
          .map(function (m) {
            return { to: E.sqName(m.to),
                     promotion: m.promotion == null ? null : E.SAN_LETTER[m.promotion].toLowerCase() };
          });
      },
    };
    ui.board.addEventListener('move', onBoardMove);
    boardBand.appendChild(ui.board);
    root.appendChild(boardBand);

    // 4 — stats row
    var stats = el('div', 'pz-stats');
    function stat(label, valueCls) {
      var col = el('div', 'pz-stat');
      col.appendChild(el('div', 'pz-stat-label', label));
      var v = el('div', 'pz-stat-value ' + valueCls);
      col.appendChild(v);
      return { col: col, value: v };
    }
    var s1 = stat(MET.STR.yourRating, 'pz-rating');
    ui.rating = s1.value;
    ui.delta = el('div', 'pz-delta');
    s1.col.appendChild(ui.delta);
    var s2 = stat(MET.STR.clock, 'pz-timer');
    ui.timer = s2.value;
    var s3 = stat(MET.STR.puzzle, 'pz-prating');
    ui.puzzleRating = s3.value;
    stats.appendChild(s1.col); stats.appendChild(s2.col); stats.appendChild(s3.col);
    root.appendChild(stats);

    // 5 — bottom panel
    ui.bottom = el('div', 'pz-bottom');
    root.appendChild(ui.bottom);

    view.appendChild(root);

    // Restore a draft under 24h silently, else serve a fresh puzzle.
    var draft = PROG.loadPlayDraft(APP.state(), Date.now());
    var restored = draft ? APP.DATA.byId[draft.puzzleId] : null;
    if (restored) { ratingDelta = null; mount(restored); } else { nextPuzzle(); }
  }

  function leave() { cancelTimers(); stopClock(); engineToken += 1; }

  return { render: render, leave: leave };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleSolver; }
