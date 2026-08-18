/* puzzle-streak.js — Puzzle Streak home and solver (spec Part 13).
 *
 * Sudden death: one wrong move ends the run.
 *
 * ── The anti-reroll lock is the acceptance criterion ─────────────────────────
 * Part 22.6: leaving the screen and coming back must hand back the **identical** puzzle. Without
 * it a user rerolls a hard puzzle by backing out, which is the entire reason
 * `StreakState.pendingPuzzleId` exists. This screen reads the lock on entry and takes it on every
 * serve; `PuzzleProgress` owns both halves.
 *
 * ── `bestBefore` ─────────────────────────────────────────────────────────────
 * The run captures the best as it stood when it STARTED, and hands that to `endStreakRun`.
 * `StreakEngine.increment` raises `bestStreak` on every solve, so comparing against the live value
 * at the end makes `isNewBest` unreachable-false and the 🏆 badge can never appear.
 *
 * ── Sounds ───────────────────────────────────────────────────────────────────
 * game-start on every mount, move/capture on every move, game-over on **failure** — and
 * deliberately **nothing** on a correct solve. In a streak the reward is the next puzzle.
 */
'use strict';

var BiyaPuzzleStreak = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var E      = isNode ? require('./engine.js')          : Engine;
  var MET    = isNode ? require('./puzzle-metrics.js')  : BiyaPuzzleMetrics;
  var BOARD  = isNode ? require('./puzzle-board.js')    : BiyaPuzzleBoard;
  var APP    = isNode ? require('./puzzle-app.js')      : BiyaPuzzleApp;
  var STREAK = isNode ? require('./streak-engine.js')   : BiyaStreakEngine;
  // `SoundManager` is the global `sound.js` actually exports. Every puzzle screen used to
  // test `typeof Sound`, which is nothing, so `SND` was permanently null and not one of the
  // five modes ever made a sound. A `typeof X !== 'undefined'` guard degrades silently by
  // design, which is why `puzzle_screen_test.js` now asserts this resolves NON-NULL rather
  // than merely that the code runs.
  var SND    = (typeof SoundManager !== 'undefined') ? SoundManager : null;
  var PROG   = APP.PROG;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function play(name) { if (SND && name) SND.play(name); }

  /** "Today" / "Yesterday" / "Mar 12" — the run-history date format (Part 13.1). */
  function relativeDate(ms, nowMs) {
    var d = PROG.dayNumber(PROG.dayKey(ms));
    var today = PROG.dayNumber(PROG.dayKey(nowMs));
    if (d === today) return 'Today';
    if (d === today - 1) return 'Yesterday';
    var dt = new Date(ms);
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /** `E2 → E4`, uppercased with a spaced arrow, plus ` (=Q)` when the UCI promotes. */
  function formatSolutionMove(uci) {
    if (!uci) return '';
    var out = uci.slice(0, 2).toUpperCase() + ' → ' + uci.slice(2, 4).toUpperCase();
    if (uci.length > 4) out += ' (=' + uci[4].toUpperCase() + ')';
    return out;
  }

  function applyMetrics(node) {
    var P = MET.PALETTE, H = MET.STREAK_HOME, V = MET.STREAK_SOLVER, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card); set('--pz-card-alt', P.cardAlt);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold); set('--pz-orange', P.streakOrange);
    // `.pzks-btn-gold { color: var(--pz-on-gold) }` (app.css) had nothing to read here, so
    // "💡 Show Solution" fell back to the inherited white instead of navy-on-gold. Every other
    // puzzle screen sets it (puzzle-solver.js, puzzle-thematic.js); this one did not.
    set('--pz-on-gold', P.onGold);
    set('--pzk-pad-h', H.headerPaddingH + 'px'); set('--pzk-pad-t', H.headerPaddingTop + 'px');
    set('--pzk-pad-b', H.headerPaddingBottom + 'px'); set('--pzk-title-fs', T.streakTitle + 'px');
    set('--pzk-badge-fill', H.badgeFill); set('--pzk-badge-ph', H.badgePaddingH + 'px');
    set('--pzk-badge-pv', H.badgePaddingV + 'px'); set('--pzk-badge-r', H.badgeRadius + 'px');
    set('--pzk-badge-fs', T.streakBadge + 'px');
    set('--pzk-top-ph', H.topPaddingH + 'px'); set('--pzk-top-gap', H.topGap + 'px');
    set('--pzk-disp-r', H.displayRadius + 'px'); set('--pzk-disp-pad', H.displayPadding + 'px');
    set('--pzk-disp-min', H.displayMinHeight + 'px'); set('--pzk-disp-border', H.displayBorderColor);
    set('--pzk-num-fs', H.numberSize + 'px'); set('--pzk-num-lh', H.numberLineHeight + 'px');
    set('--pzk-label-fs', H.labelSize + 'px'); set('--pzk-label-mt', H.labelMarginTop + 'px');
    set('--pzk-sub-fs', H.subSize + 'px'); set('--pzk-sub-mt', H.subMarginTop + 'px');
    set('--pzk-stats-gap', H.statsGap + 'px'); set('--pzk-stat-r', H.statRadius + 'px');
    set('--pzk-stat-pv', H.statPaddingV + 'px'); set('--pzk-stat-gap', H.statGap + 'px');
    set('--pzk-stat-border', H.statBorderColor);
    set('--pzk-stat-emoji', H.statEmojiSize + 'px');
    set('--pzk-stat-value', H.statValueSize + 'px'); set('--pzk-stat-label', H.statLabelSize + 'px');
    set('--pzk-list-title', H.listTitleSize + 'px'); set('--pzk-list-ph', H.listPaddingH + 'px');
    set('--pzk-list-pt', H.listPaddingTop + 'px'); set('--pzk-list-pb', H.listPaddingBottom + 'px');
    set('--pzk-row-r', H.rowRadius + 'px'); set('--pzk-row-ph', H.rowPaddingH + 'px');
    set('--pzk-row-pv', H.rowPaddingV + 'px'); set('--pzk-row-mb', H.rowMarginBottom + 'px');
    set('--pzk-row-gap', H.rowGap + 'px'); set('--pzk-row-score', H.rowScoreSize + 'px');
    set('--pzk-row-score-w', H.rowScoreMinWidth + 'px'); set('--pzk-row-date', H.rowDateSize + 'px');
    set('--pzk-empty-fs', H.emptySize + 'px');
    set('--pzk-bot-ph', H.bottomPaddingH + 'px'); set('--pzk-bot-pb', H.bottomPaddingBottom + 'px');
    set('--pzk-bot-pt', H.bottomPaddingTop + 'px'); set('--pzk-bot-gap', H.bottomGap + 'px');
    set('--pzk-share-fill', H.shareFill); set('--pzk-share-r', H.shareRadius + 'px');
    set('--pzk-share-pv', H.sharePaddingV + 'px'); set('--pzk-share-fs', H.shareSize + 'px');
    set('--pzk-start-fill', H.startFill); set('--pzk-start-r', H.startRadius + 'px');
    set('--pzk-start-pv', H.startPaddingV + 'px'); set('--pzk-start-fs', H.startSize + 'px');
    // solver
    set('--pzks-pad-h', V.headerPaddingH + 'px'); set('--pzks-pad-v', V.headerPaddingV + 'px');
    set('--pzks-back-w', V.backBtnW + 'px'); set('--pzks-back-h', V.backBtnH + 'px');
    set('--pzks-back-fs', V.backSize + 'px'); set('--pzks-counter-fs', V.counterSize + 'px');
    set('--pzks-stats-r', V.statsRadius + 'px'); set('--pzks-stats-pv', V.statsPaddingV + 'px');
    set('--pzks-stats-ph', V.statsPaddingH + 'px'); set('--pzks-stats-mh', V.statsMarginH + 'px');
    set('--pzks-stats-mb', V.statsMarginBottom + 'px');
    set('--pzks-stats-shadow', '0 ' + V.statsShadowY + 'px ' + V.statsShadowRadius
      + 'px rgba(0,0,0,' + V.statsShadowOpacity + ')');
    set('--pzks-stat-label', V.statLabelSize + 'px');
    set('--pzks-stat-label-mb', V.statLabelMarginBottom + 'px');
    set('--pzks-stat-value', V.statValueSize + 'px');
    set('--pzks-divider-fs', V.statDividerSize + 'px');
    set('--pzks-bot-ph', V.bottomPaddingH + 'px'); set('--pzks-bot-gap', V.bottomGap + 'px');
    set('--pzks-hint-fs', V.hintSize + 'px');
    set('--pzks-scrim', V.overlayScrim); set('--pzks-overlay-ph', V.overlayPaddingH + 'px');
    set('--pzks-box-r', V.boxRadius + 'px'); set('--pzks-box-pad', V.boxPadding + 'px');
    set('--pzks-box-gap', V.boxGap + 'px'); set('--pzks-box-border', V.boxBorderColor);
    set('--pzks-result-h', V.resultHeaderSize + 'px');
    set('--pzks-result-num', V.resultNumberSize + 'px');
    set('--pzks-result-num-lh', V.resultNumberLineHeight + 'px');
    set('--pzks-result-best', V.resultBestSize + 'px');
    set('--pzks-nb-fill', V.newBestFill); set('--pzks-nb-r', V.newBestRadius + 'px');
    set('--pzks-nb-ph', V.newBestPaddingH + 'px'); set('--pzks-nb-pv', V.newBestPaddingV + 'px');
    set('--pzks-nb-bw', V.newBestBorder + 'px'); set('--pzks-nb-fs', V.newBestSize + 'px');
    set('--pzks-btn-r', V.btnRadius + 'px'); set('--pzks-btn-pv', V.btnPaddingV + 'px');
    set('--pzks-btn-ph', V.btnPaddingH + 'px'); set('--pzks-btn-fs', V.btnSize + 'px');
    set('--pzks-again-r', V.tryAgainRadius + 'px'); set('--pzks-again-pv', V.tryAgainPaddingV + 'px');
    set('--pzks-menu-mt', V.backToMenuMarginTop + 'px');
    set('--pzks-menu-pv', V.backToMenuPaddingV + 'px'); set('--pzks-menu-fs', V.backToMenuSize + 'px');
    set('--pzks-strip-gap', V.stripGap + 'px'); set('--pzks-strip-ph', V.stripPaddingH + 'px');
    set('--pzks-strip-pv', V.stripPaddingV + 'px'); set('--pzks-strip-r', V.stripRadius + 'px');
    set('--pzks-strip-border', V.stripBorderColor);
    set('--pzks-strip-label', V.stripLabelSize + 'px');
    set('--pzks-strip-label-c', V.stripLabelColor);
    set('--pzks-strip-label-ls', V.stripLabelLetterSpacing + 'px');
    set('--pzks-strip-move', V.stripMoveSize + 'px');
    set('--pzks-strip-move-ls', V.stripMoveLetterSpacing + 'px');
    set('--pzks-strip-btn-gap', V.stripButtonsGap + 'px');
    set('--pzks-strip-btn-r', V.stripBtnRadius + 'px');
    set('--pzks-strip-btn-pv', V.stripBtnPaddingV + 'px');
    set('--pzks-strip-btn-fs', V.stripBtnSize + 'px');
    set('--pzks-strip-menu-fill', V.stripMenuFill);
    set('--pzks-strip-menu-border', V.stripMenuBorder);
    // The two square tints the revealed move uses (Part 13.3).
    set('--hl-sol-from', V.solutionFromTint); set('--hl-sol-to', V.solutionToTint);
      // The promotion dialog lives in <chess-board>'s shadow tree and reads these by
    // inheritance. `mode` picks the scrim and the accent; nothing else varies.
    MET.applyPromotion(node, 'streak');
}

  // ---- Home (Part 13.1) ------------------------------------------------------------------
  function renderHome(view, onStart, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR, st = APP.state();
    var live = st.streak.currentStreak > 0;

    var root = el('div', 'pzk-view');
    applyMetrics(root);

    var header = el('div', 'pzk-header');
    var back = el('button', 'pzd-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzk-title', T.streakTitle));
    header.appendChild(el('div', 'pzk-badge', T.streakBadge));
    root.appendChild(header);

    var top = el('div', 'pzk-top');
    var disp = el('div', 'pzk-display');
    disp.appendChild(el('div', 'pzk-number', String(st.streak.currentStreak)));
    disp.appendChild(el('div', 'pzk-label', T.streakCurrent));
    disp.appendChild(el('div', 'pzk-sub', T.streakOneMistake));
    top.appendChild(disp);
    var stats = el('div', 'pzk-stats');
    [['🏆', String(st.streak.bestStreak), T.streakBest],
     ['🔥', String(st.streak.currentStreak), T.streakCurrentShort],
     ['♟', '∞', T.streakNoTimer]].forEach(function (s) {
      var c = el('div', 'pzk-stat');
      c.appendChild(el('div', 'pzk-stat-emoji', s[0]));
      c.appendChild(el('div', 'pzk-stat-value', s[1]));
      c.appendChild(el('div', 'pzk-stat-label', s[2]));
      stats.appendChild(c);
    });
    top.appendChild(stats);
    root.appendChild(top);

    // Recent Runs, where the leaderboard was.
    root.appendChild(el('div', 'pzk-list-title', T.streakRecent));
    var list = el('div', 'pzk-list');
    var runs = PROG.recentStreakRuns(st);
    if (!runs.length) {
      list.appendChild(el('div', 'pzk-empty', T.streakEmpty));
    } else {
      runs.forEach(function (r) {
        var row = el('div', 'pzk-row');
        row.appendChild(el('div', 'pzk-row-score', '🔥 ' + r.length));
        row.appendChild(el('div', 'pzk-row-date', relativeDate(r.endedAt, Date.now())));
        if (r.length === st.streak.bestStreak && r.length > 0) {
          row.appendChild(el('div', 'pzk-row-trophy', '🏆'));
        }
        list.appendChild(row);
      });
    }
    root.appendChild(list);

    var bottom = el('div', 'pzk-bottom');
    var share = el('button', 'pzk-share', T.streakShare);
    share.onclick = function () {
      shareText(T.streakShareText(st.streak.currentStreak, st.streak.bestStreak));
    };
    bottom.appendChild(share);
    var start = el('button', 'pzk-start', live ? T.streakResumeStart : T.streakStart);
    start.onclick = function () {
      if (!live) { if (onStart) onStart(); return; }
      // Part 13.1: only offered when a run is live. "Continue" relies on the pending lock to hand
      // back the same puzzle; "New Game" clears it.
      showResumeModal(root, st.streak.currentStreak, function (fresh) {
        if (fresh) {
          PROG.endStreakRun(APP.state(), 0, APP.state().streak.bestStreak, Date.now());
          APP.persist();
        }
        if (onStart) onStart();
      });
    };
    bottom.appendChild(start);
    root.appendChild(bottom);

    view.appendChild(root);
  }

  function showResumeModal(root, current, done) {
    var T = MET.STR;
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', T.streakResumeTitle));
    box.appendChild(el('div', 'pz-modal-body', T.streakResumeBody(current)));
    var row = el('div', 'pz-modal-row');
    var fresh = el('button', 'pz-modal-btn pz-modal-danger', T.streakNewGame);
    fresh.onclick = function () { scrim.remove(); done(true); };
    var cont = el('button', 'pz-modal-btn pz-modal-keep', T.streakContinue);
    cont.onclick = function () { scrim.remove(); done(false); };
    row.appendChild(fresh); row.appendChild(cont);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
  }

  function shareText(text) {
    if (typeof navigator === 'undefined') return;
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
  }

  // ---- Solver (Part 13.3) -----------------------------------------------------------------
  var solver = null;
  var ui = null;
  var puzzle = null;
  var bestBefore = 0;      // the best as it stood when THIS run started
  var finalStreak = 0;     // captured before the reset, so the overlay shows the right number
  var lastResult = null;

  function renderSolver(view, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR;
    leave();
    var st = APP.state();
    bestBefore = st.streak.bestStreak;
    lastResult = null;

    var root = el('div', 'pzk-view');
    applyMetrics(root);
    ui = { root: root };

    var header = el('div', 'pzks-header');
    var back = el('button', 'pzks-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { leave(); if (onExit) onExit(); };
    header.appendChild(back);
    ui.counter = el('div', 'pzks-counter', '🔥 ' + st.streak.currentStreak);
    header.appendChild(ui.counter);
    header.appendChild(el('div', 'pzd-logo'));
    root.appendChild(header);

    var stats = el('div', 'pzks-stats');
    function stat(label) {
      var c = el('div', 'pzks-stat');
      c.appendChild(el('div', 'pzks-stat-label', label));
      var v = el('div', 'pzks-stat-value', '0');
      c.appendChild(v);
      return { col: c, value: v };
    }
    var s1 = stat(T.streakStatStreak); ui.streakVal = s1.value;
    var s2 = stat(T.streakStatBest); ui.bestVal = s2.value;
    stats.appendChild(s1.col);
    stats.appendChild(el('div', 'pzks-divider', '🔥'));
    stats.appendChild(s2.col);
    root.appendChild(stats);

    var boardBand = el('div', 'pz-board');
    solver = BOARD.create({
      mode: 'streak',
      sound: play,
      onPhase: paint,
      onSolved: onSolved,
      onWrong: onWrong,
    });
    solver.attach(boardBand);
    root.appendChild(boardBand);

    ui.bottom = el('div', 'pzks-bottom');
    ui.hint = el('div', 'pzks-hint');
    ui.bottom.appendChild(ui.hint);
    root.appendChild(ui.bottom);

    ui.onExit = onExit;
    view.appendChild(root);
    serveNext(true);
  }

  /**
   * Serve the next puzzle — or, on entry, the LOCKED one.
   *
   * `pendingPuzzleId` is read before anything else. That is Part 22.6: a hard puzzle must not be
   * rerollable by leaving the screen and coming back.
   */
  function serveNext(isEntry) {
    var st = APP.state();
    if (isEntry) {
      var locked = PROG.pendingStreakPuzzle(st);
      var lockedPuzzle = locked != null ? APP.DATA.byId[locked] : null;
      if (lockedPuzzle) { puzzle = lockedPuzzle; solver.mount(puzzle); paint(); return; }
    }
    var t = PROG.streakTarget(st);
    var r = APP.serveStreak(t.rating, t.theme);
    if (!r.puzzle) { paint(); return; }
    puzzle = r.puzzle;
    PROG.lockStreakPuzzle(APP.state(), puzzle.id);
    APP.persist();
    solver.mount(puzzle);
    paint();
  }

  function onSolved() {
    // No sound: in a streak the reward is the next puzzle appearing.
    var st = APP.state();
    var t = PROG.streakTarget(st);
    // The next puzzle is served FIRST so its id can become the lock in the same step the streak
    // increments — that pairing is what `recordStreakSolve(nextPuzzleId)` exists for.
    var after = STREAK.increment(st.streak, null);
    var nextTarget = STREAK.target(after.currentStreak, after.puzzleRating);
    var r = APP.serveStreak(nextTarget.rating, nextTarget.theme);
    PROG.recordStreakSolve(st, r.puzzle ? r.puzzle.id : null, Date.now());
    APP.persist();
    if (!r.puzzle) { paint(); return; }
    puzzle = r.puzzle;
    solver.mount(puzzle);
    paint();
  }

  function onWrong() {
    play('game-over');
    var st = APP.state();
    finalStreak = st.streak.currentStreak;
    lastResult = PROG.endStreakRun(st, finalStreak, bestBefore, Date.now());
    APP.persist();
    paint();
    showResult();
  }

  function paint() {
    if (!ui || !solver) return;
    var T = MET.STR, st = APP.state();
    ui.counter.textContent = '🔥 ' + st.streak.currentStreak;
    ui.streakVal.textContent = String(st.streak.currentStreak);
    ui.bestVal.textContent = String(st.streak.bestStreak);
    if (solver.session) {
      ui.hint.textContent = T.streakHint(solver.userIsWhite());
      ui.hint.classList.toggle('pzks-hidden', solver.session.phase !== 'playing');
    }
  }

  /** The failure overlay (Part 13.3). One source of truth for the badge: `lastResult.isNewBest`. */
  function showResult() {
    var T = MET.STR;
    var scrim = el('div', 'pzks-overlay');
    ui.overlay = scrim;
    var box = el('div', 'pzks-box');
    box.appendChild(el('div', 'pzks-result-header', T.streakGameOver));
    box.appendChild(el('div', 'pzks-result-num', '🔥 ' + finalStreak));
    box.appendChild(el('div', 'pzks-result-best', T.streakBestLine(lastResult.best)));
    if (lastResult.isNewBest) {
      box.appendChild(el('div', 'pzks-newbest', T.streakNewBest));
    }
    function btn(cls, label, fn) { var b = el('button', cls, label); b.onclick = fn; return b; }
    box.appendChild(btn('pzks-btn pzks-btn-gold', T.streakShowSolution, showSolutionStrip));
    box.appendChild(btn('pzks-btn pzks-btn-share', T.streakShareResult, function () {
      shareText(T.streakShareText(finalStreak, lastResult.best));
    }));
    box.appendChild(btn('pzks-btn pzks-again', T.streakPlayAgain, function () {
      scrim.remove(); ui.overlay = null; serveNext(false); paint();
    }));
    box.appendChild(btn('pzks-menu', T.streakBackToMenu, function () {
      leave(); if (ui.onExit) ui.onExit();
    }));
    scrim.appendChild(box);
    ui.root.appendChild(scrim);
  }

  /**
   * "💡 Show Solution" hides the overlay ENTIRELY and reveals the board with the correct move
   * highlighted — two-toned, so the direction reads at a glance (Part 13.3).
   */
  function showSolutionStrip() {
    var T = MET.STR;
    if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; }
    var uci = puzzle && solver.session ? puzzle.moves[solver.session.moveIndex] : null;
    if (uci) solver.highlightSolution(uci);

    var strip = el('div', 'pzks-strip');
    var move = el('div', 'pzks-strip-move');
    move.appendChild(el('div', 'pzks-strip-label', T.streakCorrectMove));
    move.appendChild(el('div', 'pzks-strip-movetext', formatSolutionMove(uci)));
    strip.appendChild(move);
    var row = el('div', 'pzks-strip-row');
    function btn(cls, label, fn) { var b = el('button', cls, label); b.onclick = fn; return b; }
    row.appendChild(btn('pzks-strip-btn pzks-strip-menu', T.streakStripMenu, function () {
      leave(); if (ui.onExit) ui.onExit();
    }));
    row.appendChild(btn('pzks-strip-btn pzks-strip-share', T.streakStripShare, function () {
      shareText(T.streakShareText(finalStreak, lastResult.best));
    }));
    row.appendChild(btn('pzks-strip-btn pzks-strip-again', T.streakStripPlayAgain, function () {
      strip.remove();
      solver.highlightSolution(null);
      serveNext(false); paint();
    }));
    strip.appendChild(row);
    ui.bottom.appendChild(strip);
    ui.strip = strip;
  }

  function leave() { if (solver) { solver.destroy(); solver = null; } }

  return {
    renderHome: renderHome, renderSolver: renderSolver, leave: leave,
    applyMetrics: applyMetrics, relativeDate: relativeDate,
    formatSolutionMove: formatSolutionMove,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleStreak; }
