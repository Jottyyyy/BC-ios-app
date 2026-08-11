/* puzzle-turbo.js — Puzzle Turbo mode select and run (spec Part 14).
 *
 * ── Every ending goes through one door ───────────────────────────────────────
 * `finish(reason)` is the ONLY path out of a run, and it always calls `TurboRun.end` (idempotent)
 * before `PuzzleProgress.endRushRun`. That single exit is spec fixes #5, #6 and #13 at once: the
 * original recorded nothing on a quit, wrote a second history row when the clock and the navigation
 * both fired, and hardcoded "Time's Up!" on a results screen that had no idea why the run stopped.
 *
 * ── The clock is read, never counted ─────────────────────────────────────────
 * The interval only repaints. `TurboRun.secondsLeft(state, now)` derives the number from
 * `startedAt`, so a delayed or dropped tick cannot make the clock drift — the same rule the rated
 * timer follows.
 *
 * ── Wrong moves do not undo ──────────────────────────────────────────────────
 * Turbo's `WRONG_POLICY` says the piece stays where it landed. The screen does not decide that; it
 * reads `outcome.advanceMs` and schedules through the solver's own timer list so `destroy()` can
 * cancel a pending advance — otherwise a stray one mounts a puzzle behind the results screen.
 */
'use strict';

var BiyaPuzzleTurbo = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var E     = isNode ? require('./engine.js')         : Engine;
  var MET   = isNode ? require('./puzzle-metrics.js') : BiyaPuzzleMetrics;
  var BOARD = isNode ? require('./puzzle-board.js')   : BiyaPuzzleBoard;
  var APP   = isNode ? require('./puzzle-app.js')     : BiyaPuzzleApp;
  var TR    = isNode ? require('./turbo-run.js')      : BiyaTurboRun;
  var SESS  = isNode ? require('./puzzle-session.js') : BiyaPuzzleSession;
  var STRK  = isNode ? require('./puzzle-streak.js')  : BiyaPuzzleStreak;
  // `SoundManager` is the global `sound.js` actually exports. Every puzzle screen used to
  // test `typeof Sound`, which is nothing, so `SND` was permanently null and not one of the
  // five modes ever made a sound. A `typeof X !== 'undefined'` guard degrades silently by
  // design, which is why `puzzle_screen_test.js` now asserts this resolves NON-NULL rather
  // than merely that the code runs.
  var SND   = (typeof SoundManager !== 'undefined') ? SoundManager : null;
  var PROG  = APP.PROG;
  var TIMING = SESS.TIMING;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function play(name) { if (SND && name) SND.play(name); }
  function modeOf(minutes) {
    return MET.TURBO_MODES.filter(function (m) { return m.minutes === minutes; })[0];
  }

  function applyMetrics(node) {
    var P = MET.PALETTE, H = MET.TURBO_HOME, R = MET.TURBO_RUN, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card); set('--pz-card-alt', P.cardAlt);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold);
    set('--pzr-pad-h', H.headerPaddingH + 'px'); set('--pzr-pad-t', H.headerPaddingTop + 'px');
    set('--pzr-pad-b', H.headerPaddingBottom + 'px'); set('--pzr-title-fs', T.turboTitle + 'px');
    set('--pzr-badge-fill', H.badgeFill); set('--pzr-badge-ph', H.badgePaddingH + 'px');
    set('--pzr-badge-pv', H.badgePaddingV + 'px'); set('--pzr-badge-r', H.badgeRadius + 'px');
    set('--pzr-badge-fs', T.turboBadge + 'px');
    set('--pzr-top-ph', H.topPaddingH + 'px'); set('--pzr-top-gap', H.topGap + 'px');
    set('--pzr-info-r', H.infoRadius + 'px'); set('--pzr-info-ph', H.infoPaddingH + 'px');
    set('--pzr-info-pv', H.infoPaddingV + 'px'); set('--pzr-info-border', H.infoBorderColor);
    set('--pzr-info-fs', H.infoSize + 'px');
    set('--pzr-mb-fill', H.mistakeBadgeFill); set('--pzr-mb-r', H.mistakeBadgeRadius + 'px');
    set('--pzr-mb-ph', H.mistakeBadgePaddingH + 'px');
    set('--pzr-mb-pv', H.mistakeBadgePaddingV + 'px');
    set('--pzr-mb-border', H.mistakeBadgeBorder); set('--pzr-mb-color', H.mistakeBadgeColor);
    set('--pzr-mb-fs', H.mistakeBadgeSize + 'px');
    set('--pzr-card-r', H.cardRadius + 'px'); set('--pzr-card-ph', H.cardPaddingH + 'px');
    set('--pzr-card-pv', H.cardPaddingV + 'px'); set('--pzr-card-border', H.cardBorderColor);
    set('--pzr-card-label', H.cardLabelSize + 'px');
    set('--pzr-card-label-mb', H.cardLabelMarginBottom + 'px');
    set('--pzr-card-label-ls', H.cardLabelLetterSpacing + 'px');
    set('--pzr-card-label-c', H.cardLabelColor);
    set('--pzr-tab-gap', H.tabGap + 'px'); set('--pzr-tab-pv', H.tabPaddingV + 'px');
    set('--pzr-tab-ph', H.tabPaddingH + 'px'); set('--pzr-tab-r', H.tabRadius + 'px');
    set('--pzr-tab-gap-in', H.tabGapInner + 'px'); set('--pzr-tab-fill', H.tabFill);
    set('--pzr-tab-bw', H.tabBorder + 'px'); set('--pzr-tab-border', H.tabBorderColor);
    set('--pzr-tab-fs', H.tabTextSize + 'px'); set('--pzr-tab-best-fs', H.tabBestSize + 'px');
    set('--pzr-tab-best-c', H.tabBestColor); set('--pzr-tab-best-sel', H.tabBestSelectedColor);
    set('--pzr-list-title', H.listTitleSize + 'px'); set('--pzr-list-ph', H.listPaddingH + 'px');
    set('--pzr-list-pt', H.listPaddingTop + 'px'); set('--pzr-list-pb', H.listPaddingBottom + 'px');
    set('--pzr-row-r', H.rowRadius + 'px'); set('--pzr-row-ph', H.rowPaddingH + 'px');
    set('--pzr-row-pv', H.rowPaddingV + 'px'); set('--pzr-row-mb', H.rowMarginBottom + 'px');
    set('--pzr-row-gap', H.rowGap + 'px'); set('--pzr-row-score', H.rowScoreSize + 'px');
    set('--pzr-row-score-w', H.rowScoreMinWidth + 'px');
    set('--pzr-row-mistakes', H.rowMistakesSize + 'px');
    set('--pzr-row-date', H.rowDateSize + 'px'); set('--pzr-empty-fs', H.emptySize + 'px');
    set('--pzr-bot-ph', H.bottomPaddingH + 'px'); set('--pzr-bot-pb', H.bottomPaddingBottom + 'px');
    set('--pzr-bot-pt', H.bottomPaddingTop + 'px'); set('--pzr-bot-gap', H.bottomGap + 'px');
    set('--pzr-share-fill', H.shareFill); set('--pzr-share-r', H.shareRadius + 'px');
    set('--pzr-share-pv', H.sharePaddingV + 'px'); set('--pzr-share-fs', H.shareSize + 'px');
    set('--pzr-start-r', H.startRadius + 'px'); set('--pzr-start-pv', H.startPaddingV + 'px');
    set('--pzr-start-fs', H.startSize + 'px');
    set('--pzr-start-shadow', '0 ' + H.startShadowY + 'px ' + H.startShadowRadius
      + 'px rgba(0,0,0,' + H.startShadowOpacity + ')');
    // run
    set('--pzrr-pad-h', R.headerPaddingH + 'px'); set('--pzrr-pad-v', R.headerPaddingV + 'px');
    set('--pzrr-quit-w', R.quitBtnW + 'px'); set('--pzrr-quit-h', R.quitBtnH + 'px');
    set('--pzrr-quit-fs', R.quitSize + 'px'); set('--pzrr-timer-fs', R.timerSize + 'px');
    set('--pzrr-stats-r', R.statsRadius + 'px'); set('--pzrr-stats-pv', R.statsPaddingV + 'px');
    set('--pzrr-stats-ph', R.statsPaddingH + 'px'); set('--pzrr-stats-mh', R.statsMarginH + 'px');
    set('--pzrr-stats-mb', R.statsMarginBottom + 'px');
    set('--pzrr-stats-shadow', '0 ' + R.statsShadowY + 'px ' + R.statsShadowRadius
      + 'px rgba(0,0,0,' + R.statsShadowOpacity + ')');
    set('--pzrr-stat-label', R.statLabelSize + 'px');
    set('--pzrr-stat-label-mb', R.statLabelMarginBottom + 'px');
    set('--pzrr-stat-value', R.statValueSize + 'px');
    set('--pzrr-mist-gap', R.mistakesGap + 'px'); set('--pzrr-dot', R.mistakeDotSize + 'px');
    set('--pzrr-dot-used', String(R.mistakeUsedOpacity));
    set('--pzrr-dot-left', String(R.mistakeLeftOpacity));
    set('--pzrr-bot-ph', R.bottomPaddingH + 'px'); set('--pzrr-hint-fs', R.hintSize + 'px');
    set('--pzrr-scrim', R.modalScrim); set('--pzrr-modal-r', R.modalRadius + 'px');
    set('--pzrr-modal-pad', R.modalPadding + 'px'); set('--pzrr-modal-w', R.modalWidth + 'px');
    set('--pzrr-modal-border', R.modalBorderColor);
    set('--pzrr-modal-title', R.modalTitleSize + 'px');
    set('--pzrr-modal-title-mb', R.modalTitleMarginBottom + 'px');
    set('--pzrr-modal-body', R.modalBodySize + 'px');
    set('--pzrr-modal-body-mb', R.modalBodyMarginBottom + 'px');
    set('--pzrr-modal-body-lh', R.modalBodyLineHeight + 'px');
    set('--pzrr-modal-gap', R.modalButtonsGap + 'px'); set('--pzrr-modal-btn-r', R.modalBtnRadius + 'px');
    set('--pzrr-modal-btn-pv', R.modalBtnPaddingV + 'px');
    set('--pzrr-modal-btn-fs', R.modalBtnSize + 'px');
    set('--pzrr-modal-keep', R.modalKeepFill); set('--pzrr-modal-keep-border', R.modalKeepBorder);
    set('--pzrr-modal-quit', R.modalQuitFill);
    set('--pzrr-fin-pad', R.finishedPadding + 'px'); set('--pzrr-fin-icon', R.finishedIconSize + 'px');
    set('--pzrr-fin-icon-mb', R.finishedIconMarginBottom + 'px');
    set('--pzrr-fin-title', R.finishedTitleSize + 'px');
    set('--pzrr-fin-title-mb', R.finishedTitleMarginBottom + 'px');
    set('--pzrr-fin-score', R.finishedScoreSize + 'px');
    set('--pzrr-fin-label', R.finishedLabelSize + 'px');
    set('--pzrr-fin-label-mb', R.finishedLabelMarginBottom + 'px');
    set('--pzrr-fin-stats-gap', R.finishedStatsGap + 'px');
    set('--pzrr-fin-stats-mb', R.finishedStatsMarginBottom + 'px');
    set('--pzrr-fin-stat', R.finishedStatSize + 'px');
    set('--pzrr-fin-share', R.shareFill); set('--pzrr-fin-share-r', R.shareRadius + 'px');
    set('--pzrr-fin-share-pv', R.sharePaddingV + 'px');
    set('--pzrr-fin-share-ph', R.sharePaddingH + 'px');
    set('--pzrr-fin-share-mb', R.shareMarginBottom + 'px');
    set('--pzrr-fin-share-fs', R.shareSize + 'px');
    set('--pzrr-done-fill', R.doneFill); set('--pzrr-done-r', R.doneRadius + 'px');
    set('--pzrr-done-pv', R.donePaddingV + 'px'); set('--pzrr-done-ph', R.donePaddingH + 'px');
    set('--pzrr-done-fs', R.doneSize + 'px');
      // The promotion dialog lives in <chess-board>'s shadow tree and reads these by
    // inheritance. `mode` picks the scrim and the accent; nothing else varies.
    MET.applyPromotion(node, 'turbo');
}

  function shareText(text) {
    if (typeof navigator === 'undefined') return;
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
  }

  // ---- Mode select (Part 14.1) ---------------------------------------------------------
  var selectedMode = MET.TURBO_DEFAULT_MODE;   // 3, not infinite

  function renderHome(view, onStart, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR, st = APP.state();

    var root = el('div', 'pzr-view');
    applyMetrics(root);

    var header = el('div', 'pzr-header');
    var back = el('button', 'pzd-back', '←');
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzr-title', T.turboTitle));
    header.appendChild(el('div', 'pzr-badge', T.turboBadge));
    root.appendChild(header);

    var top = el('div', 'pzr-top');
    var info = el('div', 'pzr-info');
    info.appendChild(el('div', 'pzr-info-text', T.turboInfo));
    info.appendChild(el('div', 'pzr-mistake-badge', T.turboMistakes));
    top.appendChild(info);

    var card = el('div', 'pzr-card');
    card.appendChild(el('div', 'pzr-card-label', T.turboSelectMode));
    var tabs = el('div', 'pzr-tabs');
    var listHost = null;
    function paintTabs() {
      tabs.innerHTML = '';
      MET.TURBO_MODES.forEach(function (m) {
        var on = m.minutes === selectedMode;
        var tab = el('button', 'pzr-tab' + (on ? ' on' : ''));
        if (on) { tab.style.background = m.color; tab.style.borderColor = m.color; }
        tab.appendChild(el('div', 'pzr-tab-text', m.label));
        tab.appendChild(el('div', 'pzr-tab-best', T.turboBest(PROG.rushBestFor(st, m.minutes))));
        tab.onclick = function () {
          selectedMode = m.minutes;
          paintTabs();
          paintList();
          paintStart();
        };
        tabs.appendChild(tab);
      });
    }
    card.appendChild(tabs);
    top.appendChild(card);
    root.appendChild(top);

    var title = el('div', 'pzr-list-title');
    root.appendChild(title);
    listHost = el('div', 'pzr-list');
    root.appendChild(listHost);

    /** Recent Runs is filtered by the selected tab — a 3-minute best is not a 5-minute best. */
    function paintList() {
      var m = modeOf(selectedMode);
      title.textContent = T.turboRecent(m.label);
      listHost.innerHTML = '';
      var runs = PROG.recentRushRuns(st, selectedMode);
      if (!runs.length) { listHost.appendChild(el('div', 'pzr-empty', T.turboEmpty)); return; }
      runs.forEach(function (r) {
        var row = el('div', 'pzr-row');
        row.appendChild(el('div', 'pzr-row-score', '⚡ ' + r.score));
        row.appendChild(el('div', 'pzr-row-mistakes', '❌ ' + r.mistakes));
        row.appendChild(el('div', 'pzr-row-date',
          STRK.relativeDate(r.endedAt, Date.now())));
        listHost.appendChild(row);
      });
    }

    var bottom = el('div', 'pzr-bottom');
    var share = el('button', 'pzr-share', T.turboShare);
    share.onclick = function () {
      shareText(T.turboShareText(PROG.rushBestFor(st, selectedMode), modeOf(selectedMode).label));
    };
    bottom.appendChild(share);
    var start = el('button', 'pzr-start');
    function paintStart() {
      var m = modeOf(selectedMode);
      start.textContent = T.turboStart(selectedMode);
      start.style.background = m.color;
    }
    start.onclick = function () {
      // Part 14.1: the resume prompt is infinite-only. A timed run cannot be paused, so a draft of
      // one would be meaningless — `loadRushDraft` also drops drafts over 24 h and scoreless ones.
      var draft = selectedMode === 0 ? PROG.loadRushDraft(APP.state(), Date.now()) : null;
      if (draft && draft.score > 0) {
        showResumeModal(root, draft, function (fresh) {
          if (fresh) { PROG.clearRushDraft(APP.state()); APP.persist(); }
          if (onStart) onStart(selectedMode, fresh ? null : draft);
        });
        return;
      }
      if (onStart) onStart(selectedMode, null);
    };
    bottom.appendChild(start);
    root.appendChild(bottom);

    paintTabs(); paintList(); paintStart();
    view.appendChild(root);
  }

  function showResumeModal(root, draft, done) {
    var T = MET.STR;
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', T.turboResumeTitle));
    box.appendChild(el('div', 'pz-modal-body', T.turboResumeBody(draft.score, draft.mistakes)));
    var row = el('div', 'pz-modal-row');
    var fresh = el('button', 'pz-modal-btn pz-modal-danger', T.turboNewSession);
    fresh.onclick = function () { scrim.remove(); done(true); };
    var res = el('button', 'pz-modal-btn pz-modal-keep', T.turboResume);
    res.onclick = function () { scrim.remove(); done(false); };
    row.appendChild(fresh); row.appendChild(res);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
  }

  // ---- Run (Parts 14.2–14.4) -------------------------------------------------------------
  var solver = null;
  var ui = null;
  var run = null;
  var puzzle = null;
  var ticker = null;
  var result = null;

  function renderRun(view, mode, draft, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR;
    leave();
    result = null;
    run = draft ? TR.resume(draft) : TR.start(APP.state().profile.rating, mode);

    var root = el('div', 'pzr-view');
    applyMetrics(root);
    ui = { root: root, onExit: onExit };

    var header = el('div', 'pzrr-header');
    var quit = el('button', 'pzrr-quit', T.turboQuit);
    quit.onclick = showQuitModal;
    header.appendChild(quit);
    ui.timer = el('div', 'pzrr-timer');
    header.appendChild(ui.timer);
    ui.mistakes = el('div', 'pzrr-mistakes');
    header.appendChild(ui.mistakes);
    root.appendChild(header);

    var stats = el('div', 'pzrr-stats');
    function stat(label) {
      var c = el('div', 'pzrr-stat');
      c.appendChild(el('div', 'pzrr-stat-label', label));
      var v = el('div', 'pzrr-stat-value', '0');
      c.appendChild(v);
      return { col: c, value: v };
    }
    var s1 = stat(T.turboScore); ui.scoreVal = s1.value;
    var s2 = stat(T.turboMode); ui.modeVal = s2.value;
    ui.modeVal.textContent = modeOf(run.mode).label;
    stats.appendChild(s1.col);
    stats.appendChild(s2.col);
    root.appendChild(stats);

    ui.boardBand = el('div', 'pz-board pzrr-board');
    solver = BOARD.create({
      mode: 'turbo',
      sound: play,
      onPhase: paint,
      onSolved: onSolved,
      onWrong: onWrong,
    });
    solver.attach(ui.boardBand);
    root.appendChild(ui.boardBand);

    ui.hint = el('div', 'pzrr-hint');
    root.appendChild(ui.hint);

    view.appendChild(root);
    nextPuzzle();
    // Repaint only. The number itself always comes from `TurboRun.secondsLeft(run, now)`.
    ticker = setInterval(tick, TIMING.tickMs);
  }

  function nextPuzzle() {
    var t = TR.target(run);
    var r = APP.serveStreak(t.rating, t.theme);   // the shared +-50 window
    if (!r.puzzle) { finish('finished'); return; }
    puzzle = r.puzzle;
    run = TR.served(run, Date.now());   // starts the clock on the FIRST puzzle only
    solver.mount(puzzle);
    paint();
  }

  function onSolved() {
    // No chime. Turbo's only `gameOver` is in the source's `endGame()` — a run ending, not a
    // solve; the move sound has already played. This line used to ask for 'puzzle-correct', which
    // is not one of the four sounds, so it was a no-op that merely looked deliberate.
    run = TR.solved(run);
    paint();
    if (checkEnd()) return;
    solver.schedule(nextPuzzle, TIMING.turboAdvanceMs);
  }

  function onWrong(outcome) {
    run = TR.missed(run);
    showFeedbackDot(false, outcome);
    paint();
    if (checkEnd()) return;
    // Scheduled on the SOLVER's timer list, so leaving cancels it.
    solver.schedule(nextPuzzle, outcome.advanceMs || TIMING.turboAdvanceMs);
  }

  /** The clock and the lives, checked in one place. Returns true when the run has ended. */
  function checkEnd() {
    var reason = TR.endReason(run, Date.now());
    if (!reason) return false;
    finish(reason);
    return true;
  }

  function tick() {
    if (!run || TR.isOver(run)) return;
    paintClock();
    checkEnd();
  }

  function paintClock() {
    var left = TR.secondsLeft(run, Date.now());
    ui.timer.textContent = TR.formatClock(left);
    ui.timer.style.color = MET.turboTimerColor(left);
  }

  function paint() {
    if (!ui || !solver || !run) return;
    var T = MET.STR;
    paintClock();
    ui.scoreVal.textContent = String(run.score);
    ui.mistakes.innerHTML = '';
    for (var i = 0; i < TR.MAX_MISTAKES; i++) {
      var used = i < run.mistakes;
      var dot = el('div', 'pzrr-dot' + (used ? ' used' : ''), used ? '❌' : '⚪');
      ui.mistakes.appendChild(dot);
    }
    if (solver.session) {
      ui.hint.textContent = solver.userIsWhite() ? T.turboWhite : T.turboBlack;
      ui.hint.classList.toggle('pzrr-hidden', solver.session.phase !== 'playing');
    }
  }

  /**
   * The ✓/✕ dot over the square that was played (Part 14.3), from the extracted **signed** terms.
   *
   * `left` subtracts and `top` adds — that asymmetry is transcribed from
   * `turboRun.renderConstants.renderMoveFeedback`, not from memory, because it is exactly the shape
   * of the sign bug that once shipped the annotation badge in the wrong corner in both languages.
   * The board flip is asymmetric too: the file mirrors, the rank does not.
   */
  function showFeedbackDot(correct, outcome) {
    var sq = outcome && outcome.played ? outcome.played.slice(2, 4) : null;
    if (!sq || !ui.boardBand) return;
    var G = MET.TURBO_FEEDBACK;
    var box = ui.boardBand.getBoundingClientRect();
    var size = Math.min(box.width, box.height);
    if (!size) return;
    var square = size / 8;
    var file = sq.charCodeAt(0) - 97;
    var rank = sq.charCodeAt(1) - 49;
    var black = !solver.userIsWhite();
    var col = black ? 7 - file : file;
    var row = black ? rank : 7 - rank;
    var r = square * G.radiusFactor;
    var dot = el('div', 'pzrr-fb' + (correct ? ' ok' : ' bad'), correct ? '✓' : '✕');
    dot.style.left = ((col + G.colOffset) * square + G.leftSign * r * G.leftFactor) + 'px';
    dot.style.top = (row * square + G.topSign * r * G.topFactor) + 'px';
    dot.style.width = (2 * r) + 'px';
    dot.style.height = (2 * r) + 'px';
    dot.style.borderRadius = r + 'px';
    dot.style.fontSize = (r * G.glyphFactor) + 'px';
    dot.style.lineHeight = (r * G.glyphLineFactor) + 'px';
    ui.boardBand.appendChild(dot);
    solver.schedule(function () { dot.remove(); }, TIMING.turboFeedbackMs);
  }

  /**
   * The one exit. Idempotent all the way down — `TurboRun.end` keeps the first reason, and
   * `endRushRun` is only reached when this call is the one that actually closed the run.
   */
  function finish(reason) {
    if (!run || TR.isOver(run)) return;
    var now = Date.now();
    run = TR.end(run, reason, now);
    stopTicker();
    if (solver) solver.cancel();
    var st = APP.state();
    PROG.clearRushDraft(st);
    result = PROG.endRushRun(st, run.mode, run.score, run.mistakes, reason, now);
    APP.persist();
    play('game-over');
    showResults();
  }

  function showQuitModal() {
    var T = MET.STR;
    var scrim = el('div', 'pzrr-scrim');
    var box = el('div', 'pzrr-modal');
    box.appendChild(el('div', 'pzrr-modal-title', T.turboQuitTitle));
    box.appendChild(el('div', 'pzrr-modal-body', T.turboQuitBody));
    var row = el('div', 'pzrr-modal-row');
    var keep = el('button', 'pzrr-modal-btn pzrr-keep', T.turboKeepPlaying);
    keep.onclick = function () { scrim.remove(); };
    var quit = el('button', 'pzrr-modal-btn pzrr-quit-btn', T.turboQuit);
    // Fix #13: a quit still records the run.
    quit.onclick = function () { scrim.remove(); finish('quit'); };
    row.appendChild(keep); row.appendChild(quit);
    box.appendChild(row);
    scrim.appendChild(box);
    ui.root.appendChild(scrim);
  }

  /** Part 14.4. The title comes from the real reason, never a constant (fix #6). */
  function showResults() {
    var T = MET.STR;
    ui.root.innerHTML = '';
    applyMetrics(ui.root);
    var box = el('div', 'pzrr-finished');
    box.appendChild(el('div', 'pzrr-fin-icon', result.isNewBest ? '🏆' : '⚡'));
    box.appendChild(el('div', 'pzrr-fin-title',
      TR.resultTitle(run.reason, result.isNewBest)));
    box.appendChild(el('div', 'pzrr-fin-score', String(run.score)));
    box.appendChild(el('div', 'pzrr-fin-label', T.turboSolved));
    var stats = el('div', 'pzrr-fin-stats');
    stats.appendChild(el('div', 'pzrr-fin-stat', T.turboMistakeCount(run.mistakes)));
    stats.appendChild(el('div', 'pzrr-fin-stat', T.turboModeLine(run.mode)));
    stats.appendChild(el('div', 'pzrr-fin-stat', T.turboBest(result.best)));
    box.appendChild(stats);
    var share = el('button', 'pzrr-fin-share', T.turboShareResult);
    share.onclick = function () {
      shareText(T.turboShareText(run.score, modeOf(run.mode).label));
    };
    box.appendChild(share);
    var done = el('button', 'pzrr-done', T.turboBack);
    done.onclick = function () { leave(); if (ui.onExit) ui.onExit(); };
    box.appendChild(done);
    ui.root.appendChild(box);
  }

  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  /**
   * Leaving mid-run, per Part 14.5's own split: infinite saves a resumable draft; a timed run is
   * over the moment it is off screen, and is recorded as `backgrounded`.
   */
  function leave() {
    stopTicker();
    if (run && !TR.isOver(run)) {
      if (run.mode === 0 && run.score > 0) {
        PROG.saveRushDraft(APP.state(), TR.draftOf(run), Date.now());
        run = TR.end(run, 'backgrounded', Date.now());
        APP.persist();
      } else {
        finish('backgrounded');
      }
    }
    if (solver) { solver.destroy(); solver = null; }
  }

  return {
    renderHome: renderHome, renderRun: renderRun, leave: leave,
    applyMetrics: applyMetrics, modeOf: modeOf,
    selectedMode: function () { return selectedMode; },
    setSelectedMode: function (m) { selectedMode = m; },
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleTurbo; }
