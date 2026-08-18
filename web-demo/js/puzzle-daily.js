/* puzzle-daily.js — Daily Puzzle home and solver (spec Part 11).
 *
 * The one mode that was genuinely network-dependent: the original fetched
 * `https://api.chess.com/pub/puzzle`. It is replaced by the deterministic local pool built into
 * the bundle (`daily_pool`, Part 11.1), so the same calendar date gives every device the same
 * puzzle with no communication at all — and the hero subtitle changes from
 * "powered by Chess.com" to "always offline", because the old one is now false.
 *
 * The solver is thin: `puzzle-board.js` owns the board and the pump, `puzzle-session.js` owns the
 * rules, `puzzle-progress.js` owns the streak. What is here is Daily's own chrome — the feedback
 * banner, the instruction line, the Done button — and nothing else.
 */
'use strict';

var BiyaPuzzleDaily = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var E     = isNode ? require('./engine.js')          : Engine;
  var S     = isNode ? require('./puzzle-session.js')  : BiyaPuzzleSession;
  var MET   = isNode ? require('./puzzle-metrics.js')  : BiyaPuzzleMetrics;
  var BOARD = isNode ? require('./puzzle-board.js')    : BiyaPuzzleBoard;
  var APP   = isNode ? require('./puzzle-app.js')      : BiyaPuzzleApp;
  // `SoundManager` is the global `sound.js` actually exports. Every puzzle screen used to
  // test `typeof Sound`, which is nothing, so `SND` was permanently null and not one of the
  // five modes ever made a sound. A `typeof X !== 'undefined'` guard degrades silently by
  // design, which is why `puzzle_screen_test.js` now asserts this resolves NON-NULL rather
  // than merely that the code runs.
  var SND   = (typeof SoundManager !== 'undefined') ? SoundManager : null;
  var PROG  = APP.PROG;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function play(name) { if (SND && name) SND.play(name); }

  function applyMetrics(node) {
    var P = MET.PALETTE, H = MET.DAILY_HOME, V = MET.DAILY_SOLVER, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold); set('--pz-green', P.dailyGreen);
    set('--pzd-pad-h', H.headerPaddingH + 'px'); set('--pzd-pad-t', H.headerPaddingTop + 'px');
    set('--pzd-pad-b', H.headerPaddingBottom + 'px'); set('--pzd-title-fs', T.dailyTitle + 'px');
    set('--pzd-content-ph', H.contentPaddingH + 'px');
    set('--pzd-content-pb', H.contentPaddingBottom + 'px');
    set('--pzd-hero-r', H.heroRadius + 'px'); set('--pzd-hero-pad', H.heroPadding + 'px');
    set('--pzd-hero-mb', H.heroMarginBottom + 'px'); set('--pzd-hero-border', H.heroBorderColor);
    set('--pzd-hero-icon', H.heroIconSize + 'px');
    set('--pzd-hero-icon-mb', H.heroIconMarginBottom + 'px');
    set('--pzd-hero-title-fs', T.dailyHeroTitle + 'px');
    set('--pzd-hero-title-mb', H.heroTitleMarginBottom + 'px');
    set('--pzd-hero-sub-fs', T.dailyHeroSub + 'px');
    set('--pzd-stats-gap', H.statsGap + 'px'); set('--pzd-stats-mb', H.statsMarginBottom + 'px');
    set('--pzd-stat-r', H.statCardRadius + 'px'); set('--pzd-stat-pad', H.statCardPadding + 'px');
    set('--pzd-stat-gap', H.statCardGap + 'px'); set('--pzd-stat-border', H.statCardBorderColor);
    set('--pzd-stat-emoji', H.statEmojiSize + 'px');
    set('--pzd-stat-value', H.statValueSize + 'px'); set('--pzd-stat-label', H.statLabelSize + 'px');
    set('--pzd-info-r', H.infoRadius + 'px'); set('--pzd-info-pad', H.infoPadding + 'px');
    set('--pzd-info-mb', H.infoMarginBottom + 'px'); set('--pzd-info-border', H.infoBorderColor);
    set('--pzd-info-title-fs', H.infoTitleSize + 'px');
    set('--pzd-info-title-mb', H.infoTitleMarginBottom + 'px');
    set('--pzd-info-fs', H.infoTextSize + 'px'); set('--pzd-info-lh', H.infoLineHeight + 'px');
    set('--pzd-start-r', H.startRadius + 'px'); set('--pzd-start-pv', H.startPaddingV + 'px');
    set('--pzd-start-fs', T.dailyStart + 'px');
    set('--pzd-start-shadow', '0 ' + H.startShadowY + 'px ' + H.startShadowRadius
      + 'px rgba(0,0,0,' + H.startShadowOpacity + ')');
    set('--pzd-solved-r', H.solvedRadius + 'px'); set('--pzd-solved-pad', H.solvedPadding + 'px');
    set('--pzd-solved-gap', H.solvedGap + 'px'); set('--pzd-solved-border', H.solvedBorderColor);
    set('--pzd-solved-icon', H.solvedIconSize + 'px');
    set('--pzd-solved-title', T.dailySolvedTitle + 'px');
    set('--pzd-solved-lh', H.solvedSubLineHeight + 'px');
    // solver
    set('--pzds-pad-h', V.headerPaddingH + 'px'); set('--pzds-pad-v', V.headerPaddingV + 'px');
    set('--pzds-title-fs', T.dailySolverTitle + 'px');
    set('--pzds-sub-fs', T.dailySolverSub + 'px'); set('--pzds-sub-mt', V.headerSubMarginTop + 'px');
    set('--pzds-sub-max', V.headerSubMaxWidth + 'px');
    set('--pzds-fb-mh', V.feedbackMarginH + 'px'); set('--pzds-fb-r', V.feedbackRadius + 'px');
    set('--pzds-fb-pad', V.feedbackPadding + 'px'); set('--pzds-fb-mt', V.feedbackMarginTop + 'px');
    set('--pzds-fb-gap', V.feedbackGap + 'px'); set('--pzds-fb-icon', V.feedbackIconSize + 'px');
    set('--pzds-fb-fs', T.dailyFeedback + 'px');
    set('--pzds-fb-ok-fill', V.feedbackSolvedFill); set('--pzds-fb-ok-border', V.feedbackSolvedBorder);
    set('--pzds-fb-bad-fill', V.feedbackWrongFill); set('--pzds-fb-bad-border', V.feedbackWrongBorder);
    set('--pzds-inst-pv', V.instructionPaddingV + 'px');
    set('--pzds-inst-fs', T.dailyInstruction + 'px');
    set('--pzds-done-mh', V.doneMarginH + 'px'); set('--pzds-done-r', V.doneRadius + 'px');
    set('--pzds-done-pv', V.donePaddingV + 'px'); set('--pzds-done-mt', V.doneMarginTop + 'px');
    set('--pzds-done-fs', T.dailyDone + 'px');
      // The promotion dialog lives in <chess-board>'s shadow tree and reads these by
    // inheritance. `mode` picks the scrim and the accent; nothing else varies.
    MET.applyPromotion(node, 'daily');
}

  // ---- Home (Part 11.2) -----------------------------------------------------------------
  function renderHome(view, onSolve, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR;
    var st = APP.state();
    var solvedToday = st.daily.lastSolvedDay === PROG.dayKey(Date.now());

    var root = el('div', 'pzd-view');
    applyMetrics(root);

    var header = el('div', 'pzd-header');
    var back = el('button', 'pzd-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzd-title', T.dailyTitle));
    header.appendChild(BiyaIcons.brandLogoEl('pzd-logo'));
    root.appendChild(header);

    var content = el('div', 'pzd-content');

    var hero = el('div', 'pzd-hero');
    hero.appendChild(el('div', 'pzd-hero-icon', '📅'));
    hero.appendChild(el('div', 'pzd-hero-title', T.dailyHeroTitle));
    hero.appendChild(el('div', 'pzd-hero-sub', T.dailyHeroSub));
    content.appendChild(hero);

    var stats = el('div', 'pzd-stats');
    [['🔥', st.daily.streak, T.dailyStreakLabel],
     ['📅', st.daily.totalSolved, T.dailyTotalLabel]].forEach(function (s) {
      var c = el('div', 'pzd-stat');
      c.appendChild(el('div', 'pzd-stat-emoji', s[0]));
      c.appendChild(el('div', 'pzd-stat-value', String(s[1])));
      c.appendChild(el('div', 'pzd-stat-label', s[2]));
      stats.appendChild(c);
    });
    content.appendChild(stats);

    var info = el('div', 'pzd-info');
    info.appendChild(el('div', 'pzd-info-title', T.dailyHowTitle));
    info.appendChild(el('div', 'pzd-info-body', T.dailyHowBody));
    content.appendChild(info);

    if (solvedToday) {
      var card = el('div', 'pzd-solved');
      card.appendChild(el('div', 'pzd-solved-icon', '✅'));
      card.appendChild(el('div', 'pzd-solved-title', T.dailySolvedTitle));
      card.appendChild(el('div', 'pzd-solved-sub', T.dailySolvedSub));
      content.appendChild(card);
    } else {
      var start = el('button', 'pzd-start', T.dailyStart);
      start.onclick = function () { if (onSolve) onSolve(); };
      content.appendChild(start);
    }

    root.appendChild(content);
    view.appendChild(root);
  }

  // ---- Solver (Part 11.3) ----------------------------------------------------------------
  var solver = null;
  var ui = null;
  var bannerTimer = null;

  function renderSolver(view, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR;
    leave();

    var root = el('div', 'pzd-view');
    applyMetrics(root);
    ui = {};

    var daily = APP.dailyPuzzle(new Date());
    if (!daily.puzzle) { view.appendChild(el('div', 'pzd-loading', T.dailyLoading)); return; }
    var st = APP.state();
    var alreadySolved = st.daily.lastSolvedDay === PROG.dayKey(Date.now());

    var header = el('div', 'pzds-header');
    var back = el('button', 'pzd-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { leave(); if (onExit) onExit(); };
    header.appendChild(back);
    var centre = el('div', 'pzds-centre');
    centre.appendChild(el('div', 'pzds-title', T.dailyTitle));
    // The original showed Chess.com's puzzle title here; offline, the primary theme stands in.
    centre.appendChild(el('div', 'pzds-sub', themeSummary(daily.puzzle)));
    header.appendChild(centre);
    header.appendChild(BiyaIcons.brandLogoEl('pzd-logo'));
    root.appendChild(header);

    var boardBand = el('div', 'pz-board');
    solver = BOARD.create({
      mode: 'daily',
      sound: play,
      onPhase: paint,
      onWrong: function () { showBanner(false); },
      onSolved: function () { finish(); },
    });
    solver.attach(boardBand);
    root.appendChild(boardBand);

    ui.banner = el('div', 'pzds-banner pzds-hidden');
    root.appendChild(ui.banner);
    ui.instruction = el('div', 'pzds-instruction');
    root.appendChild(ui.instruction);
    ui.done = el('button', 'pzds-done pzds-hidden', T.dailyDone);
    ui.done.onclick = function () { leave(); if (onExit) onExit(); };
    root.appendChild(ui.done);

    view.appendChild(root);
    solver.mount(daily.puzzle);
    // Re-entering after today's solve shows the board in its solved state rather than pretending
    // it is fresh — the streak has already been counted and must not count twice.
    if (alreadySolved) ui.done.classList.remove('pzds-hidden');
  }

  /** The primary theme's display name, standing in for the network puzzle title. */
  function themeSummary(puzzle) {
    var ui2 = MET.THEMES.map(function (t) { return t.id; });
    var hit = (puzzle.themes || []).find(function (t) { return ui2.indexOf(t) >= 0; });
    if (!hit) hit = (puzzle.themes || [])[0];
    if (!hit) return '';
    var meta = MET.THEMES.find(function (t) { return t.id === hit; });
    return meta ? meta.label : hit;
  }

  function showBanner(solved) {
    if (!ui || !ui.banner) return;
    var T = MET.STR;
    ui.banner.className = 'pzds-banner ' + (solved ? 'pzds-banner-ok' : 'pzds-banner-bad');
    ui.banner.innerHTML = '';
    ui.banner.appendChild(el('span', 'pzds-banner-icon', solved ? '🏆' : '✗'));
    ui.banner.appendChild(el('span', 'pzds-banner-text', solved ? T.dailyWin : T.dailyMiss));
    clearTimeout(bannerTimer);
    // Only the WRONG banner auto-hides (Part 5.5): the solved one is the end state.
    if (!solved) {
      bannerTimer = setTimeout(function () {
        if (ui && ui.banner) ui.banner.className = 'pzds-banner pzds-hidden';
      }, S.TIMING.dailyWrongBannerMs);
    }
  }

  function finish() {
    showBanner(true);
    // One solve per calendar day counts; `recordDailyPuzzleSolve` enforces that itself, so
    // re-entering and re-solving cannot double the streak.
    PROG.recordDailyPuzzleSolve(APP.state(), Date.now());
    APP.persist();
    play('game-over');
    paint();
  }

  function paint() {
    if (!ui || !solver || !solver.session) return;
    var T = MET.STR;
    var s = solver.session;
    var solved = s.phase === 'solved';
    ui.instruction.textContent = solver.userIsWhite() ? T.dailyWhite : T.dailyBlack;
    ui.instruction.classList.toggle('pzds-hidden', solved);
    ui.done.classList.toggle('pzds-hidden', !solved);
  }

  function leave() {
    clearTimeout(bannerTimer);
    if (solver) { solver.destroy(); solver = null; }
  }

  return { renderHome: renderHome, renderSolver: renderSolver, leave: leave,
           themeSummary: themeSummary, applyMetrics: applyMetrics };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleDaily; }
