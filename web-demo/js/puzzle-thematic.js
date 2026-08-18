/* puzzle-thematic.js — the theme grid and the thematic solver (spec Part 12).
 *
 * Premium-gated in the original — a lock overlay, a dimmed grid, a `👑 PREMIUM` badge, a disabled
 * start button and an upgrade modal. The offline app is a one-time purchase, so all of it is
 * deleted. `puzzle-metrics.js` asserts the lock overlay WAS in the source, so the removal stays a
 * recorded decision rather than something nobody noticed.
 *
 * The one rule worth stating twice: **Thematic never touches Elo.** No rating, no ledger row, no
 * rating display. It does update `ThemeStat`, so thematic practice still shows on the stats
 * screen. `PuzzleProgress.recordThematicAttempt` is the only sink, and it is asserted.
 */
'use strict';

var BiyaPuzzleThematic = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
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

  var selected = null;      // the grid's selection, kept across a return from the solver
  var solved = 0;           // a session-only counter, per Part 12.3

  function applyMetrics(node) {
    var P = MET.PALETTE, G = MET.THEMATIC_GRID, V = MET.THEMATIC_SOLVER, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card); set('--pz-card-alt', P.cardAlt);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold); set('--pz-on-gold', P.onGold); set('--pz-eval', P.engineEval);
    set('--pzt-pad-h', G.headerPaddingH + 'px'); set('--pzt-pad-t', G.headerPaddingTop + 'px');
    set('--pzt-pad-b', G.headerPaddingBottom + 'px'); set('--pzt-title-fs', T.thematicTitle + 'px');
    set('--pzt-badge-fill', G.badgeFill); set('--pzt-badge-ph', G.badgePaddingH + 'px');
    set('--pzt-badge-pv', G.badgePaddingV + 'px'); set('--pzt-badge-r', G.badgeRadius + 'px');
    set('--pzt-badge-fs', T.thematicBadge + 'px'); set('--pzt-badge-ls', G.badgeLetterSpacing + 'px');
    set('--pzt-badge-mb', G.badgeRowMarginBottom + 'px');
    set('--pzt-section-fs', T.thematicSection + 'px');
    set('--pzt-section-mb', G.sectionLabelMarginBottom + 'px');
    set('--pzt-section-ph', G.sectionLabelPaddingH + 'px');
    set('--pzt-grid-ph', G.gridPaddingH + 'px'); set('--pzt-grid-pb', G.gridPaddingBottom + 'px');
    set('--pzt-grid-gap', G.gridGap + 'px'); set('--pzt-cols', String(G.cols));
    set('--pzt-card-r', G.cardRadius + 'px'); set('--pzt-card-bw', G.cardBorder + 'px');
    set('--pzt-card-pad', G.cardPadding + 'px'); set('--pzt-card-fs', T.thematicCard + 'px');
    set('--pzt-start-fill', G.startFill); set('--pzt-start-r', G.startRadius + 'px');
    set('--pzt-start-pv', G.startPaddingV + 'px'); set('--pzt-start-mh', G.startMarginH + 'px');
    set('--pzt-start-mb', G.startMarginBottom + 'px');
    set('--pzt-start-fs', T.thematicStart + 'px');
    set('--pzt-start-off', G.startDisabledFill);
    set('--pzt-start-off-op', String(G.startDisabledOpacity));
    // solver
    set('--pzts-pad-h', V.headerPaddingH + 'px'); set('--pzts-pad-v', V.headerPaddingV + 'px');
    set('--pzts-title-fs', T.thematicSolverTitle + 'px');
    set('--pzts-sub-fs', T.thematicSolverSub + 'px'); set('--pzts-sub-mt', V.headerSubMarginTop + 'px');
    set('--pzts-stats-r', V.statsRadius + 'px'); set('--pzts-stats-pad', V.statsPadding + 'px');
    set('--pzts-stats-mh', V.statsMarginH + 'px'); set('--pzts-stats-mt', V.statsMarginTop + 'px');
    set('--pzts-stats-mb', V.statsMarginBottom + 'px');
    set('--pzts-stats-shadow', '0 ' + V.statsShadowY + 'px ' + V.statsShadowRadius
      + 'px rgba(0,0,0,' + V.statsShadowOpacity + ')');
    set('--pzts-stat-label', V.statLabelSize + 'px');
    set('--pzts-stat-label-mb', V.statLabelMarginBottom + 'px');
    set('--pzts-stat-ls', V.statLabelLetterSpacing + 'px');
    set('--pzts-stat-value', V.statValueSize + 'px');
    set('--pzts-fb-mh', V.feedbackMarginH + 'px'); set('--pzts-fb-r', V.feedbackRadius + 'px');
    set('--pzts-fb-pad', V.feedbackPadding + 'px'); set('--pzts-fb-mb', V.feedbackMarginBottom + 'px');
    // No `--pzts-fb-gap`: the feedback row is one line, so a gap between children never
    // applies. The source's value stays asserted in the metrics layer.
    set('--pzts-fb-fs', V.feedbackTextSize + 'px');
    set('--pzts-fb-ok-fill', V.feedbackCorrectFill);
    set('--pzts-fb-ok-border', V.feedbackCorrectBorder);
    set('--pzts-fb-bad-fill', V.feedbackWrongFill);
    set('--pzts-fb-bad-border', V.feedbackWrongBorder);
    set('--pzts-row-gap', V.wrongRowGap + 'px');
    set('--pzts-retry-fill', V.retryFill); set('--pzts-btn-r', V.retryRadius + 'px');
    set('--pzts-btn-pv', V.retryPaddingV + 'px'); set('--pzts-btn-fs', V.buttonTextSize + 'px');
    set('--pzts-retry-border', V.retryBorderColor);
    set('--pzts-next-ph', V.nextPaddingH + 'px'); set('--pzts-next-pv', V.nextPaddingV + 'px');
    set('--pzts-next-mt', V.nextMarginTop + 'px');
    set('--pzts-eng-pad', V.enginePadding + 'px'); set('--pzts-eng-mh', V.engineMarginH + 'px');
    set('--pzts-eng-mt', V.engineMarginTop + 'px');
    set('--pzts-eng-head-mb', V.engineHeaderMarginBottom + 'px');
    set('--pzts-eng-row-pv', V.engineRowPaddingV + 'px');
    set('--pzts-hint-mh', V.hintMarginH + 'px'); set('--pzts-hint-pv', V.hintPaddingV + 'px');
    set('--pzts-hint-fs', V.hintSize + 'px');
    // The engine panel's own type sizes are shared with Play.
    var EN = MET.ENGINE;
    set('--pz-eng-title-fs', EN.titleSize + 'px'); set('--pz-eng-refresh-fs', EN.refreshSize + 'px');
    set('--pz-eng-row-gap', EN.rowGap + 'px'); set('--pz-eng-row-border', EN.rowBorderColor);
    set('--pz-eng-dot-fs', EN.dotSize + 'px'); set('--pz-eng-dot-w', EN.dotWidth + 'px');
    set('--pz-eng-san-fs', EN.sanSize + 'px'); set('--pz-eng-san-w', EN.sanWidth + 'px');
    set('--pz-eng-eval-fs', EN.evalSize + 'px'); set('--pz-eng-eval-w', EN.evalWidth + 'px');
    set('--pz-eng-pv-fs', EN.pvSize + 'px'); set('--pz-eng-border', EN.borderColor);
    set('--pz-eng-r', EN.radius + 'px');
      // The promotion dialog lives in <chess-board>'s shadow tree and reads these by
    // inheritance. `mode` picks the scrim and the accent; nothing else varies.
    MET.applyPromotion(node, 'thematic');
}

  // ---- The grid (Part 12.2) --------------------------------------------------------------
  function renderGrid(view, onStart, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR, G = MET.THEMATIC_GRID;

    var root = el('div', 'pzt-view');
    applyMetrics(root);

    var header = el('div', 'pzt-header');
    var back = el('button', 'pzd-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzt-title', T.thematicTitle));
    header.appendChild(BiyaIcons.brandLogoEl('pzd-logo'));
    root.appendChild(header);

    var badgeRow = el('div', 'pzt-badge-row');
    badgeRow.appendChild(el('div', 'pzt-badge', T.thematicBadge));
    root.appendChild(badgeRow);

    root.appendChild(el('div', 'pzt-section', T.thematicChoose));

    // 3 columns x 4 rows, filled left to right, no scroll view — the grid fills the height.
    var grid = el('div', 'pzt-grid');
    var start;
    MET.THEMES.forEach(function (t) {
      var card = el('button', 'pzt-card', t.label);
      card.style.borderColor = t.color;
      if (selected === t.id) card.style.background = t.color;
      card.onclick = function () {
        // Tapping the selected card deselects it (Part 12.2).
        selected = (selected === t.id) ? null : t.id;
        renderGrid(view, onStart, onExit);
      };
      grid.appendChild(card);
    });
    root.appendChild(grid);

    var meta = MET.THEMES.find(function (t) { return t.id === selected; });
    start = el('button', 'pzt-start' + (meta ? '' : ' pzt-start-off'),
      meta ? T.thematicStart(meta.label) : T.thematicSelectPrompt);
    start.disabled = !meta;
    start.onclick = function () { if (meta && onStart) { solved = 0; onStart(selected); } };
    root.appendChild(start);

    view.appendChild(root);
  }

  // ---- The solver (Part 12.3) -------------------------------------------------------------
  var solver = null;
  var ui = null;
  var puzzle = null;
  var theme = null;

  function renderSolver(view, themeId, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var T = MET.STR;
    leave();
    theme = themeId || selected;

    var root = el('div', 'pzt-view');
    applyMetrics(root);
    ui = {};

    var meta = MET.THEMES.find(function (t) { return t.id === theme; });
    var header = el('div', 'pzts-header');
    var back = el('button', 'pzd-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { leave(); if (onExit) onExit(); };
    header.appendChild(back);
    var centre = el('div', 'pzts-centre');
    centre.appendChild(el('div', 'pzts-title', meta ? meta.label : ''));
    ui.solved = el('div', 'pzts-sub', T.thematicSolved(solved));
    centre.appendChild(ui.solved);
    header.appendChild(centre);
    header.appendChild(BiyaIcons.brandLogoEl('pzd-logo'));
    root.appendChild(header);

    var boardBand = el('div', 'pz-board');
    solver = BOARD.create({
      mode: 'thematic',
      sound: play,
      onPhase: paint,
      onEngine: paintEngine,
      onWrong: function () { record(false); paint(); },
      onSolved: function () { solved += 1; record(true); play('game-over'); paint(); },
    });
    solver.attach(boardBand);
    root.appendChild(boardBand);

    // One stat only: the puzzle's rating. Thematic shows no player rating because it never
    // moves one.
    var stats = el('div', 'pzts-stats');
    var col = el('div', 'pzts-stat');
    col.appendChild(el('div', 'pzts-stat-label', T.thematicRating));
    ui.rating = el('div', 'pzts-stat-value', '—');
    col.appendChild(ui.rating);
    stats.appendChild(col);
    root.appendChild(stats);

    ui.hint = el('div', 'pzts-hint');
    root.appendChild(ui.hint);
    ui.feedback = el('div', 'pzts-feedback pzts-hidden');
    root.appendChild(ui.feedback);
    ui.buttons = el('div', 'pzts-buttons');
    root.appendChild(ui.buttons);
    ui.engine = el('div', 'pzts-engine pzts-hidden');
    root.appendChild(ui.engine);

    view.appendChild(root);
    next();
  }

  function next() {
    var r = APP.serveThematic(theme);
    if (!r.puzzle) {
      // With the Part 7.1 scoped-wipe fix this should be unreachable; if it ever happens, say so
      // rather than showing an empty board.
      ui.feedback.className = 'pzts-feedback pzts-bad';
      ui.feedback.textContent = MET.STR.thematicDry;
      return;
    }
    puzzle = r.puzzle;
    ui.rating.textContent = String(puzzle.rating);
    solver.mount(puzzle);
  }

  /**
   * The only sink. `recordThematicAttempt` updates `ThemeStat` and credits the daily goal, and
   * pointedly does NOT touch the rating — no `recordRatedAttempt`, no ledger row.
   */
  function record(correct) {
    PROG.recordThematicAttempt(APP.state(), puzzle.themes, correct, Date.now());
    APP.persist();
  }

  function paint() {
    if (!ui || !solver || !solver.session) return;
    var T = MET.STR;
    var s = solver.session;
    ui.solved.textContent = T.thematicSolved(solved);
    ui.hint.textContent = solver.userIsWhite() ? T.thematicHintWhite : T.thematicHintBlack;
    ui.hint.classList.toggle('pzts-hidden', s.phase !== 'playing');

    if (s.phase === 'solved' || s.phase === 'reviewing') {
      ui.feedback.className = 'pzts-feedback pzts-ok';
      ui.feedback.textContent = T.thematicWin;
    } else if (s.phase === 'failed') {
      ui.feedback.className = 'pzts-feedback pzts-bad';
      ui.feedback.textContent = T.thematicMiss;
    } else {
      ui.feedback.className = 'pzts-feedback pzts-hidden';
    }
    paintButtons(s.phase);
    ui.engine.classList.toggle('pzts-hidden',
      !(s.phase === 'reviewing' || s.phase === 'solved'));
  }

  function paintButtons(phase) {
    var T = MET.STR;
    ui.buttons.innerHTML = '';
    var plan = MET.bottomPanel(phase, 'thematic');
    if (!plan.buttons.length) return;
    function btn(cls, label, fn) { var b = el('button', cls, label); b.onclick = fn; return b; }
    if (plan.row) {
      var row = el('div', 'pzts-row');
      row.appendChild(btn('pzts-btn pzts-btn-alt', T.retry, function () { solver.retry(); }));
      row.appendChild(btn('pzts-btn pzts-btn-gold', T.solutionBtn, function () { solver.reveal(); }));
      ui.buttons.appendChild(row);
    } else if (plan.buttons.indexOf('solution') >= 0) {
      ui.buttons.appendChild(btn('pzts-btn pzts-btn-gold', T.solution,
                                 function () { solver.reveal(); }));
    }
    ui.buttons.appendChild(btn('pzts-btn pzts-btn-gold pzts-next', T.nextPuzzle, next));
  }

  /** Thematic shows three engine lines where Play shows two (Part 18). */
  function paintEngine(lines) {
    if (!ui || !ui.engine) return;
    var T = MET.STR, AM = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;
    ui.engine.innerHTML = '';
    var head = el('div', 'pz-eng-head');
    head.appendChild(el('span', 'pz-eng-title',
      (lines && lines.length) ? T.engineSuggestions : T.analyzing));
    var refresh = el('button', 'pz-eng-refresh', T.refresh);
    refresh.onclick = function () { solver.runEngine(); };   // genuinely re-runs (fix #4)
    head.appendChild(refresh);
    ui.engine.appendChild(head);
    (lines || []).slice(0, MET.engineLineCount('thematic')).forEach(function (l, i) {
      var row = el('div', 'pz-eng-row');
      var dot = el('span', 'pz-eng-dot', '●');
      dot.style.color = AM.arrowColor(i);
      row.appendChild(dot);
      row.appendChild(el('span', 'pz-eng-san', l.san));
      row.appendChild(el('span', 'pz-eng-eval', l.evalText || ''));
      row.appendChild(el('span', 'pz-eng-pv', l.continuation));
      ui.engine.appendChild(row);
    });
  }

  function leave() { if (solver) { solver.destroy(); solver = null; } }

  return {
    renderGrid: renderGrid, renderSolver: renderSolver, leave: leave,
    applyMetrics: applyMetrics,
    selectedTheme: function () { return selected; },
    setSelected: function (id) { selected = id; },
    solvedCount: function () { return solved; },
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleThematic; }
