/* =============================================================================
 * app.js — App shell (3-tab phone app): Puzzles · Play · Profile
 * Wires the <chess-board> component to the ported engine, AI and rating.
 * Mirrors the SwiftUI PhoneApp. Classic <script>, no modules.
 *
 * ⇢ Coach strength: js/ai.js (Coaches). Puzzles: js/puzzles.js.
 *   Colors/sizes: css/theme.css. Board component: js/chess-board.js.
 * ========================================================================== */
(function () {
  'use strict';
  var E = window.Engine, CA = window.CoachAI, C = window.Coaches, R = window.Rating,
    SND = window.SoundManager, PUZZLES = window.SAMPLE_PUZZLES,
    // Where the coach's search runs — a worker thread when the page is served, in-thread from
    // file://. Declared here with the rest so a missing <script> tag fails at load, not on a click.
    EngineHost = window.BiyaEngineHost;

  // ------------------------------------------------------------------ store --
  var KEY = 'biya.demo.v1';
  function defaults() { return { puzzleRating: 800, solved: 0, attempts: 0, gamesPlayed: 0, wins: 0, ratingHistory: [800] }; }
  var store;
  try { store = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { store = defaults(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { } }

  // ----------------------------------------------------------------- helpers --
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  var rulesAdapter = {
    legalMovesFrom: function (fen, sq) {
      var pos = E.fromFEN(fen); if (!pos) return [];
      return E.legalMovesFrom(pos, sq).map(function (m) { return { to: m.to, promotion: m.promotion }; });
    }
  };
  function findMove(pos, from, to, promotion) {
    return E.legalMoves(pos).find(function (m) {
      return m.from === from && m.to === to &&
        ((promotion == null && m.promotion == null) || m.promotion === promotion);
    });
  }
  function coachAvatarHTML(coach, sizeClass) {
    var idx = C.all.indexOf(coach) + 1;
    var init = coach.name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2);
    return '<span class="avatar"' + (sizeClass ? ' style="' + sizeClass + '"' : '') + '>'
      + '<img src="assets/characters/level-' + idx + '.webp" alt="" '
      + 'onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=&quot;mono-init&quot;>' + init + '</span>\'">'
      + '</span>';
  }

  // simple SVG icons (stroke=currentColor)
  var ICON = {
    puzzles: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M10 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V5h2a1 1 0 0 1 1 1v2h1.5c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5H17v3a1 1 0 0 1-1 1h-3v1.5c0 .8-.7 1.5-1.5 1.5S9 17.8 9 17v-1.5H6a1 1 0 0 1-1-1v-3H3.5C2.7 10.5 2 9.8 2 9s.7-1.5 1.5-1.5H5V6a1 1 0 0 1 1-1h4V3.5Z"/></svg>',
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke-width="1.2" opacity=".8"/></svg>',
    profile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
    undo: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7 4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-1"/></svg>',
    flip: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h13a3 3 0 0 1 3 3v1"/><path d="M16 21l4-4-4-4"/><path d="M20 17H7a3 3 0 0 1-3-3v-1"/></svg>'
  };

  function ringGauge(pct, label, size) {
    var r = 30, c = 2 * Math.PI * r, off = c * (1 - clamp(pct, 0, 100) / 100);
    return '<div class="ring-gauge"' + (size ? ' style="--size:' + size + 'px"' : '') + '><svg viewBox="0 0 74 74" width="100%" height="100%">'
      + '<circle cx="37" cy="37" r="' + r + '" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="7"/>'
      + '<circle cx="37" cy="37" r="' + r + '" fill="none" stroke="#FDB022" stroke-width="7" stroke-linecap="round"'
      + ' stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 37 37)"/>'
      + '</svg><div class="lbl">' + label + '</div></div>';
  }
  function sparkline(values, w, h) {
    w = w || 260; h = h || 40;
    if (!values || values.length < 2) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * (w - 4) + 2;
      var y = h - 3 - ((v - min) / span) * (h - 6);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + h + ' L' + pts[0][0].toFixed(1) + ' ' + h + ' Z';
    var end = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(253,176,34,.35)"/><stop offset="1" stop-color="rgba(253,176,34,0)"/></linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#sg)"/>'
      + '<path d="' + line + '" fill="none" stroke="#FDB022" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="2.5" fill="#FDB022"/></svg>';
  }

  // ------------------------------------------------------------------- tabs --
  var view = document.getElementById('view');
  var tabbarEl = document.getElementById('tabbar');
  var TABS = [{ id: 'home', ico: ICON.home, lbl: 'Home' }, { id: 'puzzles', ico: ICON.puzzles, lbl: 'Puzzles' }, { id: 'play', ico: ICON.play, lbl: 'Play' }, { id: 'profile', ico: ICON.profile, lbl: 'Profile' }];
  var current = 'home';
  function renderTabbar() {
    tabbarEl.innerHTML = '';
    TABS.forEach(function (t) {
      var b = el('button', 'tab' + (t.id === current ? ' active' : ''));
      b.innerHTML = '<span class="ico">' + t.ico + '</span><span class="lbl">' + t.lbl + '</span>';
      b.onclick = function () {
        // The solver owns timers and an in-flight search; leaving by the tab bar has to cancel
        // both, or a stale opponent reply lands on whatever screen comes next.
        leaveCurrentPuzzle();
        current = t.id; renderTabbar(); render();
      };
      tabbarEl.appendChild(b);
    });
  }
  function render() {
    view.scrollTop = 0; view.innerHTML = '';
    // Home is the one screen that owns the whole box with no gutter or scroll; every other screen
    // wants .view's default padding back. Cleared here because this is the only place the tab
    // changes — the leaf renderers reached directly (renderGame, renderCoachSelect) are all
    // non-home and always follow a render().
    view.classList.remove('flush');
    // The Analysis Board also hides the tab bar: it is a pushed route in the original, and its
    // seven bands cannot spare the height. Cleared here for the same reason .flush is.
    appCard().classList.remove('an-mode');
    if (current === 'home') renderHome();
    else if (current === 'play') renderPlay();
    else if (current === 'profile') renderProfile();
    else if (current === 'analysis') renderAnalysis();
    else if (current === 'coach-color') renderCoachColor();
    else if (current === 'coach-game') renderCoachGame();
    else if (current === 'pairing') renderPairingList();
    else if (current === 'pairing-create') renderPairingCreate();
    else if (current === 'pairing-detail') renderPairingDetail();
    else if (current === 'puzzles') renderPuzzleHub();
    else if (current === 'puzzle-play') renderPuzzlePlayHome();
    else if (current === 'puzzle-solve') renderPuzzleSolver();
    else if (current === 'puzzle-daily') renderDailyHome();
    else if (current === 'puzzle-daily-solve') renderDailySolver();
    else if (current === 'puzzle-thematic') renderThematicGrid();
    else if (current === 'puzzle-thematic-solve') renderThematicSolver();
    else if (current === 'puzzle-streak') renderStreakHome();
    else if (current === 'puzzle-streak-solve') renderStreakSolver();
    else if (current === 'puzzle-turbo') renderTurboHome();
    else if (current === 'puzzle-turbo-run') renderTurboRun();
    // NOTE: this trailing else silently renders the OLD sample-puzzle tab for any unknown id — a
    // new screen MUST get its own branch above, or it will look like that with no error anywhere.
    else renderPuzzles();
  }
  function appCard() { return view.closest ? view.closest('.app-card') : view.parentNode; }

  /* ======================================================================== *
   *  ANALYSIS BOARD — see js/analysis.js
   * ======================================================================== */
  function renderAnalysis() {
    appCard().classList.add('an-mode');
    BiyaAnalysisBoard.render(view, function () {
      current = 'home'; renderTabbar(); render();
    });
  }

  /* ======================================================================== *
   *  PUZZLE HUB — see js/puzzle-hub.js, js/puzzle-home.js, js/puzzle-solver.js
   *
   *  The Puzzles TAB now opens the Hub. The ten hand-made samples in js/puzzles.js and the
   *  `renderPuzzles()` screen below them are retired: they use the OPPOSITE move convention
   *  (`solution[0]` is the solver's, where the corpus has `moves[0]` belonging to the opponent),
   *  so the two cannot share a solver. They stay reachable at `?dev=samples` only, for the engine
   *  spot-check they were originally written for.
   * ======================================================================== */
  function puzzleGo(id) { leaveCurrentPuzzle(); current = id; renderTabbar(); render(); }

  function renderPuzzleHub() {
    appCard().classList.add('an-mode');           // a pushed route: no tab bar, full height
    BiyaPuzzleHub.render(view, function (mode) {
      if (mode === 'play') puzzleGo('puzzle-play');
      else if (mode === 'daily') puzzleGo('puzzle-daily');
      else if (mode === 'thematic') puzzleGo('puzzle-thematic');
      else if (mode === 'streak') puzzleGo('puzzle-streak');
      else if (mode === 'turbo') puzzleGo('puzzle-turbo');
    }, function () { puzzleGo('home'); });
  }

  function renderPuzzlePlayHome() {
    appCard().classList.add('an-mode');
    BiyaPuzzleHome.render(view, function () { puzzleGo('puzzle-solve'); },
                          function () { puzzleGo('puzzles'); });
  }

  function renderPuzzleSolver() {
    appCard().classList.add('an-mode');
    BiyaPuzzleSolver.render(view, function () { puzzleGo('puzzle-play'); });
  }

  function renderDailyHome() {
    appCard().classList.add('an-mode');
    BiyaPuzzleDaily.renderHome(view, function () { puzzleGo('puzzle-daily-solve'); },
                               function () { puzzleGo('puzzles'); });
  }
  function renderDailySolver() {
    appCard().classList.add('an-mode');
    BiyaPuzzleDaily.renderSolver(view, function () { puzzleGo('puzzle-daily'); });
  }
  function renderThematicGrid() {
    appCard().classList.add('an-mode');
    BiyaPuzzleThematic.renderGrid(view, function () { puzzleGo('puzzle-thematic-solve'); },
                                  function () { puzzleGo('puzzles'); });
  }
  function renderThematicSolver() {
    appCard().classList.add('an-mode');
    BiyaPuzzleThematic.renderSolver(view, BiyaPuzzleThematic.selectedTheme(),
                                    function () { puzzleGo('puzzle-thematic'); });
  }

  function renderStreakHome() {
    appCard().classList.add('an-mode');
    BiyaPuzzleStreak.renderHome(view, function () { puzzleGo('puzzle-streak-solve'); },
                                function () { puzzleGo('puzzles'); });
  }
  function renderStreakSolver() {
    appCard().classList.add('an-mode');
    BiyaPuzzleStreak.renderSolver(view, function () { puzzleGo('puzzle-streak'); });
  }

  // Turbo's run needs two arguments the router has to carry across the transition: which mode was
  // picked, and the draft being resumed (or null). Held here rather than inside the screen so a
  // re-render of the same route — a tab-bar repaint, say — does not silently restart the run.
  var turboLaunch = null;
  function renderTurboHome() {
    appCard().classList.add('an-mode');
    BiyaPuzzleTurbo.renderHome(view, function (mode, draft) {
      turboLaunch = { mode: mode, draft: draft };
      puzzleGo('puzzle-turbo-run');
    }, function () { puzzleGo('puzzles'); });
  }
  function renderTurboRun() {
    appCard().classList.add('an-mode');
    var L = turboLaunch || { mode: BiyaPuzzleMetrics.TURBO_DEFAULT_MODE, draft: null };
    BiyaPuzzleTurbo.renderRun(view, L.mode, L.draft, function () {
      turboLaunch = null;
      puzzleGo('puzzle-turbo');
    });
  }

  /**
   * Every solver owns timers and an in-flight engine search, so ANY departure has to cancel them
   * or a stale opponent reply lands on whatever screen comes next. One registry rather than a
   * growing `if` chain — that chain is how the tab bar came to cancel only the rated solver.
   */
  var PUZZLE_LEAVERS = {
    'puzzle-solve': function () { BiyaPuzzleSolver.leave(); },
    'puzzle-daily-solve': function () { BiyaPuzzleDaily.leave(); },
    'puzzle-thematic-solve': function () { BiyaPuzzleThematic.leave(); },
    'puzzle-streak-solve': function () { BiyaPuzzleStreak.leave(); },
    // Turbo's leave is not just a cancel: per Part 14.5 an infinite run saves a resumable draft
    // and a timed one is RECORDED as `backgrounded`. Routing through here is what makes leaving
    // mid-run count.
    'puzzle-turbo-run': function () { BiyaPuzzleTurbo.leave(); },
  };
  function leaveCurrentPuzzle() {
    var f = PUZZLE_LEAVERS[current];
    if (f) f();
    // The coach game owns an in-flight search and a pending timer; leaving by the tab bar has to
    // cancel both, or a reply lands on a screen the user has already left (spec 7 #25/#26).
    if (current === 'coach-game') coachLeave();
  }

  /* ======================================================================== *
   *  PAIRING MANAGER — see js/pairing-{list,create,detail}.js
   *
   *  Three pushed routes reached from the Home tile. No PUZZLE_LEAVERS entry: unlike the solvers
   *  these screens own no timers and no in-flight search, so there is nothing to cancel on the way
   *  out — the document is written on every mutation, not on exit.
   * ======================================================================== */

  /**
   * Which tournament the detail screen is showing.
   *
   * Router-scoped, not screen-scoped, for the same reason `turboLaunch` is: `render()` runs again
   * on every repaint, and a screen that re-read its own argument from itself would lose it.
   */
  var pairingOpenId = null;

  function pairingGo(id) { current = id; renderTabbar(); render(); }

  /** The document, loaded fresh each paint and saved by whoever mutates it. */
  function pairingDoc() { return BiyaPairingStore.load(); }

  function renderPairingList() {
    appCard().classList.add('an-mode');           // a pushed route: no tab bar, full height
    BiyaPairingList.render(view, pairingDoc(), {
      onOpen: function (id) { pairingOpenId = id; pairingGo('pairing-detail'); },
      onCreate: function () { pairingGo('pairing-create'); },
      onExit: function () { current = 'home'; renderTabbar(); render(); },
      onChanged: render,
    });
  }

  function renderPairingCreate() {
    appCard().classList.add('an-mode');
    BiyaPairingCreate.render(view, {
      onCreated: function (id) { pairingOpenId = id; pairingGo('pairing-detail'); },
      onExit: function () { pairingGo('pairing'); },
    });
  }

  function renderPairingDetail() {
    appCard().classList.add('an-mode');
    // A tournament deleted from under the screen shows the empty state rather than a blank box or
    // a permanent spinner (spec 7 #19).
    BiyaPairingDetail.render(view, pairingOpenId, {
      onExit: function () { pairingGo('pairing'); },
      onChanged: render,
    });
  }

  /* ======================================================================== *
   *  HOME TAB — see js/home.js
   * ======================================================================== */
  function renderHome() {
    BiyaHome.render(view, function (action) {
      // Only the actions with a real destination in this demo are wired; the rest are the empty
      // callbacks the screen is designed around (§12).
      if (action === 'puzzles') { current = 'puzzles'; renderTabbar(); render(); }
      else if (action === 'playCoach') { current = 'play'; renderTabbar(); render(); }
      else if (action === 'analysis') { current = 'analysis'; renderTabbar(); render(); }
      else if (action === 'avatar') { current = 'profile'; renderTabbar(); render(); }
      // home.js has emitted 'pairing' since the tile was drawn; there was simply nothing here to
      // catch it.
      else if (action === 'pairing') pairingGo('pairing');
    });
  }

  /* ======================================================================== *
   *  PLAY VS COACH — see js/coach-{engine,book,game,turn,select,color,play}.js
   *
   *  The Play tab, and the three screens behind it: Coach Select -> Colour
   *  Select -> the game. Everything with a decision in it lives in those
   *  modules and is tested there; what is here is the loop that joins them —
   *  ask the coach, wait, apply, repaint.
   *
   *  This REPLACED a sample play screen that predated the port. That screen had
   *  its own coach table (js/ai.js `Coaches`), its own undo and its own game
   *  state; keeping both would have meant two Play tabs disagreeing about who
   *  the coaches are, which is exactly what the extraction exists to prevent.
   *
   *  The generation counter is the whole concurrency story (spec 7 #25/#26/
   *  #27/#29). Every asynchronous reply carries the token it started with and
   *  is dropped unless the token still matches, so resigning, starting a new
   *  game, taking a move back or opening a review all cancel an in-flight
   *  search by construction rather than by remembering to.
   * ======================================================================== */

  /**
   * Router-scoped, for the same reason `pairingOpenId` is: `render()` runs again on every repaint,
   * so a screen cannot hold anything itself. `ctl` in particular MUST outlive a repaint — it is the
   * counter that lets a resigned game refuse a reply that is still in the air.
   */
  var coachTab = { level: 1, profile: null, game: null, ctl: null,
                   // The review's own state, router-scoped for the same reason: the modal is
                   // redrawn by `render()` on every progress tick.
                   review: null };

  function coachGo(id) { current = id; renderTabbar(); render(); }

  /** The one place the game screen is drawn, so every mutation ends the same way. */
  function coachPaint() {
    if (current !== 'coach-game') return;
    render();
  }

  function coachProfile(level) { return BiyaCoachSelect.coachAt(level); }

  // ---- The three screens --------------------------------------------------------------------------

  /**
   * The Play tab root.
   *
   * Keeps the tab bar — it is a tab here, where the original reaches it as a pushed route from
   * Home. The two screens behind it are pushed and hide the bar, as the Pairing screens do.
   */
  function renderPlay() {
    BiyaCoachSelect.render(view, {
      onPick: function (level) { coachTab.level = level; coachGo('coach-color'); },
      onExit: function () { current = 'home'; renderTabbar(); render(); },
    });
  }

  function renderCoachColor() {
    appCard().classList.add('an-mode');
    BiyaCoachColor.render(view, coachTab.level, coachProfile(coachTab.level).name, {
      onStart: coachStart,
      onExit: function () { coachGo('play'); },
    });
  }

  function renderCoachGame() {
    appCard().classList.add('an-mode');
    BiyaCoachPlay.render(view, coachTab.game, coachTab.ctl, coachTab.profile, {
      onMove: coachUserMove,
      onSeek: coachSeek,
      onResign: coachAskResign,
      onTakeBack: coachTakeBack,
      onNewGame: coachRematch,
      onReview: coachStartReview,
      onExit: function () { coachLeave(); coachGo('play'); },
    });
    if (coachTab.review) coachDrawReviewModal();
  }

  /**
   * The Game Review modal, redrawn on every progress tick.
   *
   * It is appended to the screen root rather than kept across repaints because `render()` clears
   * the view — the same reason `coachTab.review` lives on the router and not in the modal.
   */
  function coachDrawReviewModal() {
    var root = view.children[0];
    if (!root) return;
    BiyaCoachPlay.reviewModal(root, coachTab.review, {
      onCancel: coachCancelReview,
      onStartReview: coachHandOffReview,
      onNewGame: function () { coachTab.review = null; coachRematch(); },
    });
  }

  // ---- Starting, leaving --------------------------------------------------------------------------

  /**
   * `start` is `coach-color.js`'s `resolveStart` result: `{ resume, userColor, draft }`.
   *
   * Spec 7 #33 is that Continue must honour the colour you tapped, and that decision is already
   * made — it is a pure function over there, tested there. This only obeys it.
   */
  function coachStart(start) {
    var G = BiyaCoachGame;
    coachTab.profile = coachProfile(coachTab.level);
    coachTab.ctl = BiyaCoachTurn.create();
    coachTab.game = (start && start.resume && start.draft)
      ? start.draft
      : G.newGame(coachTab.level, start ? start.userColor : G.WHITE);
    // Spec 7 #34: a restored game starts as a game, sound and all. The RN path dropped straight
    // back onto the board with whatever modal state the last session had left behind.
    if (SND && SND.playGameStart) SND.playGameStart();
    if (!start || !start.resume) { store.gamesPlayed++; save(); }
    coachGo('coach-game');
    coachAskCoach();
  }

  /**
   * Leaving the game screen for any reason.
   *
   * Invalidating is not politeness: without it the reply in flight lands on a board the user is no
   * longer looking at, and — because the game object outlives the screen — actually records a move
   * (spec 7 #25/#26).
   */
  function coachLeave() {
    if (coachTab.ctl) BiyaCoachTurn.invalidate(coachTab.ctl);
  }

  // ---- The user's move ----------------------------------------------------------------------------

  function coachUserMove(uci) {
    var G = BiyaCoachGame;
    if (!BiyaCoachTurn.canUserMove(coachTab.game, coachTab.ctl)) return;
    if (!coachApply(uci)) return;
    if (G.isOver(coachTab.game)) { coachPaint(); return; }
    coachPaint();
    coachAskCoach();
  }

  /**
   * Record one half-move, sound it, evaluate the position and persist the draft.
   *
   * Returns false on an illegal move rather than throwing: the board only ever offers legal moves,
   * but a premove is by definition made in a position that has since changed.
   */
  function coachApply(uci) {
    var G = BiyaCoachGame;
    var before = E.fromFEN(G.liveFen(coachTab.game));
    var mv = before && E.parseUci(before, uci);
    if (!mv) return false;
    var rec = G.record(coachTab.game, uci);
    if (!rec) return false;
    var after = E.fromFEN(G.liveFen(coachTab.game));
    var status = E.status(after);
    if (SND && SND.playForMove) {
      // The engine's move is `{from, to, promotion}` and carries no flags, so both facts are read
      // off the position it was made in. En passant is a pawn changing file onto an empty square.
      var moved = before.squares[mv.from];
      var diagonal = ((mv.from & 7) !== (mv.to & 7));
      SND.playForMove({
        status: status,
        capture: !!before.squares[mv.to] || (moved && moved.kind === E.PAWN && diagonal),
        castle: !!(moved && moved.kind === E.KING && Math.abs((mv.to & 7) - (mv.from & 7)) === 2),
      });
    }
    G.applyEvaluation(coachTab.game, coachTab.profile);
    if (G.isOver(coachTab.game) && coachTab.game.outcome === 'win') { store.wins++; save(); }
    G.saveDraft(coachTab.game, null, Date.now());
    return true;
  }

  // ---- The coach's reply --------------------------------------------------------------------------

  /**
   * Ask the coach for a move, if it is the coach's move to make.
   *
   * The book is consulted first and falls through SILENTLY when it has nothing legal to offer
   * (spec 2.3) — a hard-coded line meeting a real board must never be able to crash or pass.
   */
  function coachAskCoach() {
    var G = BiyaCoachGame, T = BiyaCoachTurn, CE = BiyaCoachEngine;
    if (!T.shouldCoachMove(coachTab.game, coachTab.ctl)) return;

    var token = T.begin(coachTab.ctl);
    var pos = E.fromFEN(G.liveFen(coachTab.game));
    if (!pos) { T.settle(coachTab.ctl, token); return; }

    var isLegal = function (u) { return !!E.parseUci(pos, u); };
    var book = BiyaCoachBook.bookMove(coachTab.level, G.sanHistory(coachTab.game), isLegal, Math.random);
    var limits = CE.searchLimits(coachTab.level);
    var think = CE.thinkTimeMs(coachTab.level, pieceCount(pos), Math.random);
    var startedAt = Date.now();
    coachPaint();                       // the header switches to "thinking" on this repaint

    var chosen = book
      ? Promise.resolve(book)
      : EngineHost.analyzeProgressive(pos, {
          maxDepth: limits.depth,
          multiPV: limits.multiPV,
          // The cancel the generation counter buys: a resign mid-search stops the search itself,
          // not merely its result.
          shouldCancel: function () { return !T.accepts(coachTab.ctl, token); },
        }).then(function (snap) {
          if (!snap || !snap.lines || !snap.lines.length) return null;
          var line = CE.pickMove(snap.lines, coachTab.level, Math.random);
          return (line && line.pv && line.pv.length) ? E.moveUci(line.pv[0]) : null;
        });

    chosen.then(function (uci) {
      if (!T.accepts(coachTab.ctl, token)) return;         // resigned, restarted, taken back, reviewed
      // On-device the search answers in milliseconds; the pacer is what keeps the coach from
      // replying before the user's own piece has finished moving.
      var wait = Math.max(0, think - (Date.now() - startedAt));
      setTimeout(function () {
        if (!T.settle(coachTab.ctl, token)) return;
        if (uci) coachApply(uci);
        coachAfterCoachMove();
      }, wait);
    });
  }

  /** The premove, if one is queued and still legal in the position that actually arrived. */
  function coachAfterCoachMove() {
    var G = BiyaCoachGame, T = BiyaCoachTurn;
    var pos = E.fromFEN(G.liveFen(coachTab.game));
    var uci = T.consumePremove(coachTab.ctl, coachTab.game, function (u) {
      return !!(pos && E.parseUci(pos, u));
    });
    if (uci && coachApply(uci)) {
      coachPaint();
      coachAskCoach();
      return;
    }
    coachPaint();
  }

  function pieceCount(pos) {
    var n = 0;
    for (var s = 0; s < 64; s++) if (pos.squares[s]) n++;
    return n;
  }

  // ---- The buttons --------------------------------------------------------------------------------

  /** Reviewing pauses the coach (spec 7 #27) — invalidating is what pauses it. */
  function coachSeek(index) {
    BiyaCoachGame.setReviewIndex(coachTab.game, index);
    if (!BiyaCoachGame.isLive(coachTab.game)) coachLeave();
    coachPaint();
    // Back to live with the coach still to move: pick the game up where it was left.
    if (BiyaCoachGame.isLive(coachTab.game)) coachAskCoach();
  }

  /** Spec 7 #24: resign asks first. The screen raises it; the prompt is the caller's. */
  function coachAskResign() {
    var root = view.children[0];
    if (!root) return;
    BiyaCoachPlay.resignPrompt(root, coachTab.profile ? coachTab.profile.name : '', function () {
      coachLeave();
      BiyaCoachGame.resign(coachTab.game, coachTab.profile);
      BiyaCoachGame.saveDraft(coachTab.game, null, Date.now());
      coachPaint();
    });
  }

  /**
   * Spec 2.10 — analyse the whole game on the embedded engine, then classify.
   *
   * The generation counter guards this too: a review started and then abandoned by resigning or
   * starting a new game must not paint its result over whatever is on screen by then.
   */
  function coachStartReview() {
    if (!coachTab.game || !BiyaCoachReview.isReviewable(coachTab.game)) return;
    var token = BiyaCoachTurn.invalidate(coachTab.ctl);
    var total = BiyaCoachReview.planFromGame(coachTab.game).positions.length;
    coachTab.review = { running: true, done: 0, total: total, cancelled: false,
                        userColor: coachTab.game.userColor,
                        accent: BiyaCoachMetrics.ACCENTS[coachTab.level] };
    coachPaint();
    var mine = coachTab.review;
    BiyaCoachReview.run(coachTab.game, {
      onProgress: function (done) {
        if (coachTab.review !== mine || !BiyaCoachTurn.accepts(coachTab.ctl, token)) return;
        coachTab.review.done = done;
        coachPaint();
      },
      shouldCancel: function () {
        return coachTab.review !== mine || !BiyaCoachTurn.accepts(coachTab.ctl, token);
      },
    }).then(function (summary) {
      if (coachTab.review !== mine || !BiyaCoachTurn.accepts(coachTab.ctl, token)) return;
      // A cancelled run resolves null and leaves its evaluations SHORT; closing is the only honest
      // response, because a partial review would report an accuracy over half a game.
      if (!summary) { coachTab.review = null; coachPaint(); return; }
      coachTab.review = { running: false, summary: summary,
                          userColor: coachTab.game.userColor,
                          accent: BiyaCoachMetrics.ACCENTS[coachTab.level] };
      coachPaint();
    });
  }

  function coachCancelReview() {
    coachTab.review = null;
    coachPaint();
  }

  /**
   * Hand the reviewed game to the Analysis Board.
   *
   * Spec 7 #28: the RN hand-off always shipped an empty `moveEvaluations` array, because its
   * memoised callback's dependency list omitted `reviewData`. `handoff` takes the summary as an
   * argument, so there is no captured variable that can go stale — and it returns null rather than
   * an empty hand-off if one is somehow missing.
   */
  function coachHandOffReview() {
    var payload = BiyaCoachReview.handoff(coachTab.game, coachTab.review
                                                       && coachTab.review.summary);
    coachTab.review = null;
    if (!payload) { coachPaint(); return; }
    coachLeave();
    current = 'analysis';
    renderTabbar();
    render();
    if (BiyaAnalysisBoard && BiyaAnalysisBoard.loadReviewedGame) {
      BiyaAnalysisBoard.loadReviewedGame(payload);
    }
  }

  function coachTakeBack() {
    var allowed = BiyaCoachSelect.takeBackEnabled();
    if (!BiyaCoachTurn.takeBack(coachTab.game, coachTab.ctl, allowed)) return;
    BiyaCoachGame.saveDraft(coachTab.game, null, Date.now());
    coachPaint();
    coachAskCoach();
  }

  function coachRematch() {
    coachLeave();
    BiyaCoachGame.clearDraft(coachTab.level, null);
    coachStart({ resume: false, userColor: coachTab.game.userColor, draft: null });
  }


  /* ======================================================================== *
   *  PROFILE TAB
   * ======================================================================== */
  var TIER_BANDS = [
    { name: 'Expert', floor: 2000, ceil: 2800 }, { name: 'Advanced', floor: 1600, ceil: 2000 },
    { name: 'Intermediate', floor: 1200, ceil: 1600 }, { name: 'Beginner', floor: 800, ceil: 1200 },
    { name: 'Novice', floor: 0, ceil: 800 }
  ];
  function renderProfile() {
    view.scrollTop = 0; view.innerHTML = '';
    view.appendChild(el('div', 'screen-head', '<h1 class="screen-title">Profile</h1>'));
    var wrap = el('div', 'wrap-x stack');
    var tier = R.classify(store.puzzleRating);
    wrap.appendChild(el('div', 'profile-card',
      '<div class="mono-badge">B</div><div><div class="pname">Biyahero</div><div class="ptier">' + tier + '</div></div>' +
      '<div class="prating">' + store.puzzleRating + '<div style="font-size:10px;opacity:.8;font-weight:700">RATING</div></div>'));

    var acc = store.attempts ? Math.round(store.solved / store.attempts * 100) : 0;
    var tiles = el('div', 'stat-tiles');
    tiles.appendChild(el('div', 'stat-tile', '<div class="ico">✅</div><div class="v">' + store.solved + '</div><div class="l">Solved</div>'));
    tiles.appendChild(el('div', 'stat-tile', '<div class="ico">🎯</div><div class="v">' + (store.attempts ? acc + '%' : '—') + '</div><div class="l">Accuracy</div>'));
    tiles.appendChild(el('div', 'stat-tile', '<div class="ico">♟️</div><div class="v">' + store.gamesPlayed + '</div><div class="l">Games</div>'));
    wrap.appendChild(tiles);

    var rc = el('div', 'card');
    rc.innerHTML = '<div class="card-label">Rating progress</div>' + sparkline(store.ratingHistory.slice(-30));
    wrap.appendChild(rc);

    // tier card
    var band = TIER_BANDS.find(function (t) { return t.name === tier; }) || TIER_BANDS[4];
    var prog = clamp((store.puzzleRating - band.floor) / (band.ceil - band.floor) * 100, 0, 100);
    var tc = el('div', 'card tier-card');
    var rows = '';
    TIER_BANDS.forEach(function (t) {
      var cur = t.name === tier;
      rows += '<div class="tier-row' + (cur ? ' cur' : '') + '"><span class="' + (cur ? 'dot-cur' : 'dot-off') + '"></span>'
        + '<span class="tname">' + t.name + '</span><span class="tfloor">' + t.floor + '+</span></div>';
    });
    tc.innerHTML = '<div class="card-label">Tier — ' + tier + '</div>'
      + '<div class="progress"><span style="width:' + prog + '%"></span></div>' + rows;
    wrap.appendChild(tc);

    var cc = el('div', 'card');
    var avs = '<div class="coach-avatars">';
    C.all.forEach(function (coach) { avs += coachAvatarHTML(coach); });
    avs += '</div>';
    cc.innerHTML = '<div class="card-label">Your coaches</div>' + avs;
    wrap.appendChild(cc);

    view.appendChild(wrap);
  }

  /* ======================================================================== *
   *  PUZZLES TAB
   * ======================================================================== */
  var puz = { index: 0, pos: null, step: 0, done: false, failed: false, boardEl: null, ui: null };

  function renderPuzzles() {
    view.scrollTop = 0; view.innerHTML = '';
    var p = PUZZLES[puz.index % PUZZLES.length];
    // The whole puzzle screen fills the phone and does NOT scroll: fixed compact
    // header/footer, and the board flexes to fit the remaining space.
    var pv = el('div', 'puzzle-view');
    pv.appendChild(el('div', 'screen-head', '<h1 class="screen-title">Puzzles</h1>'));

    // compact rating row: accuracy ring + rating + this puzzle's theme, one line
    var acc = store.attempts ? Math.round(store.solved / store.attempts * 100) : 0;
    var rrow = el('div', 'card rating-row puz-rating');
    rrow.innerHTML = ringGauge(store.attempts ? acc : 0, (store.attempts ? acc : 0) + '%', 52)
      + '<div class="rating-card"><div class="card-label" style="margin-bottom:2px">Your rating</div>'
      + '<div class="rating-big">' + store.puzzleRating + '</div>'
      + '<div class="hint">' + R.classify(store.puzzleRating) + ' · ' + store.solved + ' solved</div></div>'
      + '<div class="puz-theme"><div class="theme">' + p.theme + '</div><span class="chip">Puzzle ' + p.rating + '</span></div>';
    pv.appendChild(rrow);

    // board — fills the remaining height, auto-sized so nothing ever scrolls
    var boardWrap = el('div', 'puz-board');
    var board = document.createElement('chess-board');
    board.setAttribute('coordinates', 'true');
    board.rules = rulesAdapter;
    boardWrap.appendChild(board);
    pv.appendChild(boardWrap);
    puz.boardEl = board;

    var status = el('div', 'status-line'); pv.appendChild(status);

    var ctrl = el('div', 'wrap-x puz-ctrl');
    var brow = el('div', 'btn-row');
    var skip = el('button', 'btn btn-muted grow', 'Skip');
    var next = el('button', 'btn btn-gold grow', 'Next puzzle');
    skip.onclick = function () { if (!puz.done && !puz.failed) registerMiss(); loadNext(); };
    next.onclick = loadNext;
    brow.appendChild(skip); brow.appendChild(next);
    ctrl.appendChild(brow);
    pv.appendChild(ctrl);

    view.appendChild(pv);
    puz.ui = { status: status, next: next, skip: skip };
    loadPuzzle(p);
  }

  function loadPuzzle(p) {
    puz.pos = E.fromFEN(p.fen); puz.step = 0; puz.done = false; puz.failed = false;
    var flipped = puz.pos.sideToMove === E.BLACK;
    puz.boardEl.flipped = flipped;
    puz.boardEl.setPosition(p.fen, { animate: false, lastMove: null, check: checkSquare(puz.pos) });
    puz.boardEl.interactive = true;
    puz.boardEl.onmove = null;
    puz.boardEl.removeEventListener('move', onPuzzleMove);
    puz.boardEl.addEventListener('move', onPuzzleMove);
    setPuzzleStatus(p.objective, '');
    puz.ui.next.disabled = true; puz.ui.skip.disabled = false;
  }

  function currentPuzzle() { return PUZZLES[puz.index % PUZZLES.length]; }

  function onPuzzleMove(e) {
    if (puz.done || puz.failed) return;
    var p = currentPuzzle();
    var m = findMove(puz.pos, e.detail.from, e.detail.to, e.detail.promotion);
    if (!m) return;
    var expected = p.solution[puz.step];
    var isLastSolverPly = (puz.step === p.solution.length - 1);
    var next = E.makeMove(puz.pos, m);
    var reachesMate = E.status(next) === 'checkmate';
    var correct = (e.detail.uci === expected) || (isLastSolverPly && reachesMate);
    if (!correct) { puzzleFailed(p); return; }
    // apply the correct move
    applyPuzzleMove(m);
    puz.step++;
    if (puz.step >= p.solution.length) { puzzleSolved(p); return; }
    // opponent's forced reply
    puz.boardEl.interactive = false;
    delay(320).then(function () {
      var reply = p.solution[puz.step];
      var rm = findMove(puz.pos, E.sqIndex(reply.slice(0, 2)), E.sqIndex(reply.slice(2, 4)), reply.length > 4 ? 'nbrq'.indexOf(reply[4]) + 1 : null);
      if (rm) { applyPuzzleMove(rm); puz.step++; }
      if (puz.step >= p.solution.length) puzzleSolved(p);
      else puz.boardEl.interactive = true;
    });
  }

  function applyPuzzleMove(m) {
    var pos = puz.pos, mover = pos.squares[m.from];
    var castle = mover.kind === E.KING && Math.abs((m.to & 7) - (m.from & 7)) === 2;
    var capture = pos.squares[m.to] != null || (mover.kind === E.PAWN && m.to === pos.enPassant);
    var next = E.makeMove(pos, m);
    puz.pos = next;
    SND.playForMove({ status: E.status(next), capture: capture, castle: castle });
    puz.boardEl.setPosition(E.toFEN(next), { lastMove: { from: m.from, to: m.to }, check: checkSquare(next) });
  }

  function puzzleSolved(p) {
    puz.done = true; puz.boardEl.interactive = false;
    var out = R.evaluate(store.puzzleRating, p.rating, true);
    store.puzzleRating = out.newRating; store.solved++; store.attempts++;
    pushRating(); save(); updatePuzzleRatingUI();
    setPuzzleStatus('Solved!  +' + out.ratingChange + ' rating', 'good');
    puz.ui.next.disabled = false; puz.ui.skip.disabled = true;
  }
  function puzzleFailed(p) {
    puz.failed = true; puz.boardEl.interactive = false;
    var out = R.evaluate(store.puzzleRating, p.rating, false);
    store.puzzleRating = out.newRating; store.attempts++;
    pushRating(); save(); updatePuzzleRatingUI();
    // show best move in SAN
    var best = p.solution[0];
    var bm = findMove(puz.pos, E.sqIndex(best.slice(0, 2)), E.sqIndex(best.slice(2, 4)), best.length > 4 ? 'nbrq'.indexOf(best[4]) + 1 : null);
    var bestSan = bm ? E.san(puz.pos, bm) : best;
    setPuzzleStatus('Not quite — best was ' + bestSan + '  (' + out.ratingChange + ')', 'bad');
    puz.ui.next.disabled = false; puz.ui.skip.disabled = true;
  }
  function registerMiss() {
    var p = currentPuzzle();
    var out = R.evaluate(store.puzzleRating, p.rating, false);
    store.puzzleRating = out.newRating; store.attempts++; pushRating(); save();
  }
  function pushRating() { store.ratingHistory.push(store.puzzleRating); if (store.ratingHistory.length > 60) store.ratingHistory.shift(); }
  function updatePuzzleRatingUI() { var rb = view.querySelector('.rating-big'); if (rb) rb.textContent = store.puzzleRating; }
  function setPuzzleStatus(txt, cls) { puz.ui.status.className = 'status-line ' + (cls || ''); puz.ui.status.textContent = txt; }
  function loadNext() { puz.index = (puz.index + 1) % PUZZLES.length; renderPuzzles(); }

  /* ======================================================================== *
   *  SELF-TEST (?selftest) — engine move-generation sanity in the browser
   * ======================================================================== */
  // Mount a real <chess-board> off-screen, draw an arrow over it, and ask the browser what is
  // actually under the middle of a square. The answer must be a `.sq` — if the overlay or the
  // piece layer ever becomes hit-testable, this is what catches it.
  function boardOverlayCheck(ck) {
    var host = el('div');
    // On-screen on purpose. `elementFromPoint` returns null outside the viewport, so the usual
    // left:-9999px trick would make every assertion below vacuous. Nearly transparent and on top
    // for the few milliseconds this runs, then removed.
    host.style.cssText = 'position:fixed;left:0;top:0;width:256px;height:256px;z-index:99999;opacity:.01';
    var b = document.createElement('chess-board');
    b.rules = { legalMovesFrom: function (fen, sq) { return sq === 12 ? [{ to: 28, promotion: null }] : []; } };
    b.draggablePieces = true;
    b.arrows = [{ from: 12, to: 28, rank: 0 }];
    host.appendChild(b);
    document.body.appendChild(host);
    b.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { animate: false });
    try {
      var sh = b.shadowRoot;
      var boardEl = sh.querySelector('.board');
      var overlay = sh.querySelector('.overlay');
      ck('board overlay drawn', !!overlay && overlay.childNodes.length === 2, true);
      var r = boardEl.getBoundingClientRect();
      ck('board laid out', r.width > 0, true);
      ck('overlay is pointer-events:none', getComputedStyle(overlay).pointerEvents, 'none');
      ck('piece layer is pointer-events:none', getComputedStyle(sh.querySelector('.pieces')).pointerEvents, 'none');
      ck('draggable board disables touch-action', getComputedStyle(boardEl).touchAction, 'none');
      // e2: file 4, rank 1 -> visual col 4, row 6, white at the bottom.
      var hit = sh.elementFromPoint(r.left + r.width / 8 * 4.5, r.top + r.width / 8 * 6.5);
      var cell = hit && hit.closest ? hit.closest('.sq') : null;
      ck('the overlay does not steal the tap target', !!cell, true);
      ck('and it is the right square', cell ? Number(cell.dataset.sq) : -1, 12);
      var moved = null;
      b.addEventListener('move', function (e) { moved = e.detail.uci; });
      if (cell) {
        cell.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        sh.querySelector('[data-sq="28"]').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      }
      ck('tap-to-move still fires with drag + arrows on', moved, 'e2e4');
    } catch (err) {
      ck('board overlay check threw: ' + err.message, false, true);
    }
    document.body.removeChild(host);
  }

  function runSelfTest() {
    var results = [];
    function ck(label, got, want) { results.push({ ok: got === want, label: label, got: got, want: want }); }
    var s = E.start();
    ck('perft(1)', E.perft(s, 1), 20);
    ck('perft(2)', E.perft(s, 2), 400);
    ck('perft(3)', E.perft(s, 3), 8902);
    ck('perft(4)', E.perft(s, 4), 197281);
    ck('kiwipete perft(3)', E.perft(E.fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 3), 97862);
    ck('en-passant perft(4)', E.perft(E.fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4), 43238);
    ck('promotion+castle perft(3)', E.perft(E.fromFEN('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), 3), 62379);
    // The home screen's pure layer — the responsive scale, the tile identity behind the six equal
    // cards, the hourly quote rotation, expiry formatting and the premium-outranks-colorful rule.
    var home = BiyaHome.selfTest();
    ck('home pure layer (' + home.passed + ' assertions)', home.failures.length, 0);
    home.failures.forEach(function (f) { console.log('FAIL home: ' + f); });
    // The analysis notation core: SAN/UCI parsing, the position key, the draw rules, the move tree
    // and PGN. The full 3,105-case replay against the PHP oracle needs the goldens on disk and so
    // lives in `node tools/qa/js_goldens.js`; these are the self-contained halves.
    var eng = E.selfTest();
    ck('engine notation (' + eng.passed + ' assertions)', eng.failures.length, 0);
    eng.failures.forEach(function (f) { console.log('FAIL engine: ' + f); });
    var tree = BiyaMoveTree.selfTest();
    ck('move tree (' + tree.passed + ' assertions)', tree.failures.length, 0);
    tree.failures.forEach(function (f) { console.log('FAIL movetree: ' + f); });
    var pgn = BiyaPGN.selfTest();
    ck('pgn (' + pgn.passed + ' assertions)', pgn.failures.length, 0);
    pgn.failures.forEach(function (f) { console.log('FAIL pgn: ' + f); });
    // The analysis search: forced mates, PV legality, MultiPV, determinism, and the terminal
    // short-circuit that keeps eval_mate:0 (the server's bug) from ever being produced.
    var srch = BiyaAnalysis.selfTest();
    ck('analysis engine (' + srch.passed + ' assertions)', srch.failures.length, 0);
    srch.failures.forEach(function (f) { console.log('FAIL analysis-engine: ' + f); });
    // Game review (classification + accuracy, PHP-parity) and the bundled ECO book. The full
    // 303-case replay against the oracle's goldens needs them on disk, so it lives in
    // `node tools/qa/js_goldens.js`; these are the self-contained halves.
    var rev = BiyaReview.selfTest();
    ck('game review (' + rev.passed + ' assertions)', rev.failures.length, 0);
    rev.failures.forEach(function (f) { console.log('FAIL review: ' + f); });
    var book = BiyaOpeningBook.selfTest();
    ck('opening book (' + book.passed + ' assertions)', book.failures.length, 0);
    book.failures.forEach(function (f) { console.log('FAIL opening-book: ' + f); });
    // The Analysis Board's pure layer. The comparison against the extracted RN StyleSheet needs
    // board_styles.json on disk, so that half lives in `node tools/qa/js_goldens.js`.
    var met = BiyaAnalysisMetrics.selfTest();
    ck('analysis metrics (' + met.passed + ' assertions)', met.failures.length, 0);
    met.failures.forEach(function (f) { console.log('FAIL analysis-metrics: ' + f); });
    // The Analysis Board's pure session layer: status line, opening tracking, arrows, engine rows,
    // the move strip's tokens, and the staleness rule that drives cancel-and-restart.
    var ab = BiyaAnalysisBoard.selfTest();
    ck('analysis board (' + ab.passed + ' assertions)', ab.failures.length, 0);
    ab.failures.forEach(function (f) { console.log('FAIL analysis-board: ' + f); });
    // Setup Position: placement, castling normalisation, and the validation chess.js used to do.
    var ped = BiyaPositionEditor.selfTest();
    ck('position editor (' + ped.passed + ' assertions)', ped.failures.length, 0);
    ped.failures.forEach(function (f) { console.log('FAIL position-editor: ' + f); });
    // The bundled ECO book must actually be on the page — a missing script tag is silent otherwise.
    ck('eco book loaded', typeof ECO_DATA === 'object' && Object.keys(ECO_DATA).length > 7000, true);
    // The <chess-board> arrow overlay, checked with REAL hit-testing. The Node suite
    // (tools/qa/board_component_test.js) covers the geometry and the drag state machine against a
    // fake DOM; what only a browser can answer is whether the overlay actually sits on top of the
    // squares and steals the click that drives tap-to-move in Play and Puzzles.
    boardOverlayCheck(ck);

    var fails = results.filter(function (r) { return !r.ok; });
    results.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + '  got=' + r.got + (r.ok ? '' : '  want=' + r.want)); });
    console.log(fails.length === 0 ? '✅ engine self-test: ALL ' + results.length + ' PASSED' : '❌ ' + fails.length + ' FAILED');
    var toast = el('div', null, (fails.length === 0 ? '✅ Self-test: all ' + results.length + ' checks passed' : '❌ ' + fails.length + ' checks FAILED — see console'));
    toast.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:999;background:' +
      (fails.length === 0 ? 'rgba(92,194,100,.95)' : 'rgba(255,107,107,.95)') +
      ';color:#06101f;font-weight:800;padding:10px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:13px';
    document.body.appendChild(toast);
    setTimeout(function () { toast.style.transition = 'opacity .5s'; toast.style.opacity = '0'; }, 5000);
  }

  // ------------------------------------------------------------------- boot --
  // Home demo chrome (lives in the hero, outside the phone — not part of the app).
  var themeSel = document.getElementById('home-theme-select');
  if (themeSel) themeSel.onchange = function () {
    BiyaHome.setColorful(themeSel.value === 'colorful');
    if (current === 'home') render();
  };
  var premiumSel = document.getElementById('home-premium-select');
  if (premiumSel) premiumSel.onchange = function () {
    // A fixed date so the expiry string is stable to look at, not a moving target.
    BiyaHome.setPremium(premiumSel.value === 'premium', new Date(2026, 8, 12));
    if (current === 'home') render();
  };

  renderTabbar();
  render();
  if (/(\?|&)selftest\b/.test(location.search)) runSelfTest();
})();
