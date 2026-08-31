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
  // The login gate. `BiyaLogin` owns the session; a missing or unrecognised stored value means the
  // login screen, so a half-written key fails closed rather than letting someone straight into the
  // app. Signing in persists, so this is the first screen once and not on every launch —
  // Profile > Sign out is the way back to it.
  var current = BiyaLogin.shared().isSignedIn() ? 'home' : 'login';

  /* ---- the trial gate ----------------------------------------------------- *
   * Client decision, round 4: nothing is usable until the 7-day free trial is started, and every
   * tap a locked user makes lands on the offer. This REVERSES what docs/subscription.md was
   * written around, where the free tier was genuinely playable.
   *
   * The twin of `PhoneApp.locked` / `openTabs` / `gatedTab` in PhoneView.swift, and it lives at
   * the same place: the router, not the screens. `gate()` and the per-mode caps below are
   * untouched — they still describe what a LAPSED subscriber's counters mean.
   *
   * Home stays reachable so the offer has something to sell against, and Profile because it owns
   * Sign out: walling it strands a user who signed in with the wrong account, and Restore lives on
   * the paywall they would then be unable to leave.                                              */
  var OPEN_ROUTES = { login: 1, paywall: 1, home: 1, profile: 1 };
  function locked() {
    return BiyaLogin.shared().isSignedIn() && !BiyaPremium.shared().isPremium();
  }
  function isOpenRoute(id) { return !!OPEN_ROUTES[id]; }

  function render() {
    view.scrollTop = 0; view.innerHTML = '';
    // Home is the one screen that owns the whole box with no gutter or scroll; every other screen
    // wants .view's default padding back. Cleared here because this is the only place the route
    // changes — the leaf renderers reached directly (renderGame, renderCoachSelect) are all
    // non-home and always follow a render().
    view.classList.remove('flush');
    // The trial gate's backstop. Every transition is intercepted at its source — the Home tiles in
    // renderHome, which is now the only source there is — but an entitlement can lapse BETWEEN
    // taps (the demo
    // picker below does exactly that), so the router re-checks on every paint rather than trusting
    // that no route can outlive its permission. `paywallReturn` is forced to Home: returning to
    // the screen that was just walled would bounce straight back here.
    if (locked() && !isOpenRoute(current)) {
      paywallReturn = 'home';
      current = 'paywall';
    }
    if (current === 'login') renderLogin();
    else if (current === 'paywall') renderPaywall();
    else if (current === 'home') renderHome();
    else if (current === 'play') renderPlay();
    else if (current === 'profile') renderProfile();
    else if (current === 'analysis') renderAnalysis();
    else if (current === 'coach-color') renderCoachColor();
    else if (current === 'coach-game') renderCoachGame();
    else if (current === 'pairing') renderPairingList();
    else if (current === 'pairing-create') renderPairingCreate();
    else if (current === 'pairing-detail') renderPairingDetail();
    else if (current === 'openings') renderOpenings();
    else if (current === 'videos') renderVideos();
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
   *  LOGIN — see js/login.js
   * ======================================================================== */

  // The gate owns the whole box, the way every pushed route does.
  // `.flush` because it draws to the edges. It used to also set `an-mode` — a login screen with a
  // tab bar under it is not a gate — but there is no tab bar left to hide.
  function renderLogin() {
    view.classList.add('flush');
    BiyaLogin.render(view, finishSignIn);
  }

  // The screen raises the event, the shell owns the transition — the same split PhoneApp uses,
  // where `LoginScreen(onSignedIn:)` fires and the host runs the `withAnimation` cross-fade.
  function finishSignIn() {
    var card = appCard();
    var secs = BiyaLogin.TIMING.signInFadeSeconds;
    current = 'home';
    render();
    card.style.setProperty('--lg-fade-secs', secs + 's');
    card.classList.add('lg-signing-in');
    setTimeout(function () { card.classList.remove('lg-signing-in'); }, secs * 1000);
  }

  function signOut() {
    BiyaLogin.shared().signOut();
    current = 'login';
    render();
  }

  /* The browser twin of AccountDeletion.erase. Reads the SAME two lists out of
   * BiyaLogin.ACCOUNT_DATA, so neither language can quietly start keeping something the other
   * erases. The four JSON documents are an iOS-side mechanism (Application Support has no browser
   * equivalent), which is why only the keys are removed here. */
  function eraseAccountData() {
    var A = BiyaLogin.ACCOUNT_DATA;
    function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
    A.erasedKeys.forEach(drop);
    Object.keys(localStorage).forEach(function (k) {
      A.erasedKeyPrefixes.forEach(function (p) { if (k.indexOf(p) === 0) drop(k); });
    });
  }

  /* Guideline 5.1.1(v)'s deletion, confirmed first. A MODAL rather than a route, deliberately:
   * OPEN_ROUTES is asserted to be exactly home/login/paywall/profile, and a `delete-account` route
   * would fail that gate — rightly, because a destructive confirm is not somewhere you navigate
   * to and then press Back out of. Mirrors the Swift `.alert`. */
  function confirmDeleteAccount() {
    var S = BiyaLogin.STRINGS;
    var sheet = el('div', 'lg-confirm');
    sheet.innerHTML = '<div class="lg-confirm-box">'
      + '<div class="lg-confirm-title">' + S.deleteTitle + '</div>'
      + '<div class="lg-confirm-body">' + S.deleteBody.replace(/\n\n/g, '<br><br>') + '</div>'
      + '<div class="lg-confirm-actions">'
      + '<button class="lg-confirm-no" type="button">' + S.deleteCancel + '</button>'
      + '<button class="lg-confirm-yes" type="button">' + S.deleteConfirm + '</button>'
      + '</div></div>';
    function close() { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); }
    sheet.querySelector('.lg-confirm-no').onclick = close;
    sheet.querySelector('.lg-confirm-yes').onclick = function () {
      close();
      eraseAccountData();
      signOut();
    };
    document.querySelector('.app-card').appendChild(sheet);
  }

  /* ======================================================================== *
   *  SUBSCRIPTION — see js/premium.js
   * ======================================================================== */

  // A pushed route, like the login gate: it owns the box and hides the tab bar.
  function renderPaywall() {
    view.classList.add('flush');
    BiyaPremium.render(view, function () { goPaywallBack(); });
  }

  // Where the paywall returns to. Remembered rather than assumed, so a cap hit inside the Puzzle
  // Hub does not dump the user back on Home.
  var paywallReturn = 'home';
  function goPaywall() {
    paywallReturn = (current === 'paywall') ? paywallReturn : current;
    current = 'paywall';
    render();
  }
  function goPaywallBack() {
    current = paywallReturn;
    render();
  }

  /**
   * The free tier's allowances, at the one place every route transition funnels through — the same
   * split the Swift uses, where `PuzzleHubScreen` owns every gate and the solvers know nothing.
   *
   * Spends one use and runs `go`, or raises the lock card and does nothing.
   */
  function gate(mode, message, go) {
    var p = BiyaPremium.shared();
    if (!p.canUse(mode)) { raiseCap(message, true); return; }
    p.recordUse(mode);
    go();
  }

  function raiseCap(message, resets) {
    appCard().appendChild(BiyaPremium.lockCard(message, {
      resets: resets,
      onSeePlans: goPaywall
    }));
  }

  /** `You've solved 5/5 free puzzles today…` — the count substituted, never re-typed. */
  function ratedCapMessage() {
    var P = BiyaPremium;
    return P.fill(P.STRINGS.puzzleCap, {
      used: P.shared().used(P.MODE.regular),
      limit: P.maxUses(P.MODE.regular)
    });
  }

  /* ======================================================================== *
   *  ANALYSIS BOARD — see js/analysis.js
   * ======================================================================== */
  function renderAnalysis() {
    BiyaAnalysisBoard.render(view, function () {
      current = 'home'; render();
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
  function puzzleGo(id) { leaveCurrentPuzzle(); current = id; render(); }

  function renderPuzzleHub() {
    BiyaPuzzleHub.render(view, function (mode) {
      // Only Thematic is gated here: it is the one hard premium gate. The others are daily
      // allowances, spent when a run actually starts — browsing a home screen and backing out
      // must not cost the user their run.
      if (mode === 'play') puzzleGo('puzzle-play');
      else if (mode === 'daily') puzzleGo('puzzle-daily');
      else if (mode === 'thematic') {
        if (BiyaPremium.isThematicLocked(BiyaPremium.shared().isPremium())) {
          raiseCap(BiyaPremium.STRINGS.thematicLock, false);
        } else { puzzleGo('puzzle-thematic'); }
      } else if (mode === 'streak') puzzleGo('puzzle-streak');
      else if (mode === 'turbo') puzzleGo('puzzle-turbo');
    }, function () { puzzleGo('home'); });
  }

  function renderPuzzlePlayHome() {
    // The allowance is spent HERE, on the way into the solver — a failed attempt still costs a
    // use, exactly as the original counted them.
    BiyaPuzzleHome.render(view, function () {
      gate(BiyaPremium.MODE.regular, ratedCapMessage(), function () { puzzleGo('puzzle-solve'); });
    }, function () { puzzleGo('puzzles'); });
  }

  function renderPuzzleSolver() {
    BiyaPuzzleSolver.render(view, function () { puzzleGo('puzzle-play'); });
  }

  function renderDailyHome() {
    BiyaPuzzleDaily.renderHome(view, function () { puzzleGo('puzzle-daily-solve'); },
                               function () { puzzleGo('puzzles'); });
  }
  function renderDailySolver() {
    BiyaPuzzleDaily.renderSolver(view, function () { puzzleGo('puzzle-daily'); });
  }
  function renderThematicGrid() {
    BiyaPuzzleThematic.renderGrid(view, function () { puzzleGo('puzzle-thematic-solve'); },
                                  function () { puzzleGo('puzzles'); });
  }
  function renderThematicSolver() {
    BiyaPuzzleThematic.renderSolver(view, BiyaPuzzleThematic.selectedTheme(),
                                    function () { puzzleGo('puzzle-thematic'); });
  }

  function renderStreakHome() {
    BiyaPuzzleStreak.renderHome(view, function () {
      gate(BiyaPremium.MODE.streak, BiyaPremium.STRINGS.streakCap,
           function () { puzzleGo('puzzle-streak-solve'); });
    }, function () { puzzleGo('puzzles'); });
  }
  function renderStreakSolver() {
    BiyaPuzzleStreak.renderSolver(view, function () { puzzleGo('puzzle-streak'); });
  }

  // Turbo's run needs two arguments the router has to carry across the transition: which mode was
  // picked, and the draft being resumed (or null). Held here rather than inside the screen so a
  // re-render of the same route — a tab-bar repaint, say — does not silently restart the run.
  var turboLaunch = null;
  function renderTurboHome() {
    BiyaPuzzleTurbo.renderHome(view, function (mode, draft) {
      // PER MODE — rush_0, rush_3 and rush_5 carry their own allowance. Resuming a draft is the
      // SAME run continued and already cost its use when it started.
      function launch() { turboLaunch = { mode: mode, draft: draft }; puzzleGo('puzzle-turbo-run'); }
      if (draft) { launch(); return; }
      gate(BiyaPremium.MODE.rush(mode), BiyaPremium.STRINGS.rushCap, launch);
    }, function () { puzzleGo('puzzles'); });
  }
  function renderTurboRun() {
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

  function pairingGo(id) { current = id; render(); }

  /** The document, loaded fresh each paint and saved by whoever mutates it. */
  function pairingDoc() { return BiyaPairingStore.load(); }

  function renderPairingList() {
    BiyaPairingList.render(view, pairingDoc(), {
      onOpen: function (id) { pairingOpenId = id; pairingGo('pairing-detail'); },
      onCreate: function () { pairingGo('pairing-create'); },
      onExit: function () { current = 'home'; render(); },
      onChanged: render,
    });
  }

  function renderPairingCreate() {
    BiyaPairingCreate.render(view, {
      onCreated: function (id) { pairingOpenId = id; pairingGo('pairing-detail'); },
      onExit: function () { pairingGo('pairing'); },
    });
  }

  function renderPairingDetail() {
    // A tournament deleted from under the screen shows the empty state rather than a blank box or
    // a permanent spinner (spec 7 #19).
    BiyaPairingDetail.render(view, pairingOpenId, {
      onExit: function () { pairingGo('pairing'); },
      onChanged: render,
    });
  }

  /* ======================================================================== *
   *  OPENING TREE — see js/opening-tree.js, opening-store.js, openings.js
   *
   *  A pushed route, like Pairing: reached from a Home tile, not a tab, and its
   *  three screens of its own leave no room for the app's.
   *
   *  `openingForm` is router-scoped for the reason every other pushed route's
   *  state is: `render()` runs again on every repaint, so a half-typed PGN held
   *  inside the screen would be lost on the first one.
   * ======================================================================== */

  var openingForm = null;
  var openingMode = 'list';

  function openingsGo(mode) { openingMode = mode; current = 'openings'; render(); }

  /* ---- the explorer's engine ------------------------------------------------ *
   *
   * The loop lives here rather than in `openings.js` for the same reason the download's does:
   * `openings.js` is `require`d headlessly by `js_goldens.js`, where there is no Worker and no DOM.
   * The router runs the search and owns the token; the screen draws the answer.
   *
   * OFF by default — the client's own answer. `engineToken` is a monotonic integer, the same cancel
   * primitive `analysis.js` uses: every callback re-checks it, so an abandoned search cannot paint. */
  var engineOn = false;
  var engineToken = 0;
  var engineRows = [];
  var engineSnapshot = null;
  var engineBusy = false;
  var engineDebounce = null;
  var engineFen = null;

  function openingsEngineReset() {
    engineOn = false;
    engineToken += 1;
    engineRows = [];
    engineSnapshot = null;
    engineBusy = false;
    engineFen = null;
    if (engineDebounce) { clearTimeout(engineDebounce); engineDebounce = null; }
  }

  function openingsEngineToggle() {
    engineOn = !engineOn;
    // Dropping the rows is what makes the rail LEAVE the layout rather than sit at a dead 50/50
    // with no number on it — the bug the Analysis Board's own toggle was fixed for.
    if (!engineOn) {
      engineToken += 1; engineRows = []; engineSnapshot = null;
      engineBusy = false; engineFen = null;
    }
    openingsEngineSchedule();
    render();
  }

  /**
   * Cancel whatever is running, then start the debounce again.
   *
   * Walking the tree fast therefore searches nothing: each step bumps the token — every callback
   * re-checks it, and the engine polls `shouldCancel` every 2048 nodes — and restarts the wait.
   * Only a pause actually costs a search.
   */
  function openingsEngineSchedule() {
    if (engineDebounce) { clearTimeout(engineDebounce); engineDebounce = null; }
    engineToken += 1;
    if (!engineOn) return;
    var store = BiyaOpeningStore.shared();
    if (!store.open()) return;
    var token = engineToken;
    engineDebounce = setTimeout(function () {
      engineDebounce = null;
      openingsEngineRun(token);
    }, BiyaAnalysisMetrics.TIMINGS.analysisDebounce);
  }

  function openingsEngineRun(token) {
    if (token !== engineToken) return;
    var store = BiyaOpeningStore.shared();
    var fen = store.fen();
    var pos = Engine.fromFEN(fen);
    if (!pos) return;
    engineFen = fen;
    engineBusy = true;
    engineRows = [];
    engineSnapshot = null;
    renderIfOpenings();
    // The SAME contract the Analysis Board and the puzzle hint panel use, so all three share one
    // worker and one budget. The limits are ENGINE_LIMITS, not the Analysis Board's preset — that
    // screen's setting is not this one's.
    BiyaEngineHost.analyzeProgressive(pos, {
      maxDepth: BiyaAnalysisMetrics.ENGINE_LIMITS.maxDepth,
      multiPV: BiyaAnalysisMetrics.ENGINE_LIMITS.multiPV,
      deadlineMs: BiyaAnalysisMetrics.TIMINGS.engineDeadline,
      shouldCancel: function () { return token !== engineToken; },
      onDepth: function (snap) {
        if (token !== engineToken) return;
        engineRows = BiyaAnalysis.engineRows(snap);
        engineSnapshot = snap;
        renderIfOpenings();
      }
    }).then(function (snap) {
      if (token !== engineToken) return;
      engineBusy = false;
      if (snap) { engineRows = BiyaAnalysis.engineRows(snap); engineSnapshot = snap; }
      renderIfOpenings();
    });
  }

  /** A depth hop must not repaint a screen the user has left. */
  function renderIfOpenings() {
    if (current === 'openings' && openingMode !== 'form') render();
  }

  /** Save a freshly built tree, open it, and drop the form. Both sources end here. */
  function openingsSave(store, tree) {
    store.add(tree);
    store.openTree(tree.id);
    openingForm = null;
    openingsGo('list');
  }

  /**
   * Run a download plan and build from what comes back.
   *
   * The games are accumulated and the tree is built ONCE at the end, which is deliberately less
   * than the RN screen does. That one jumps to the explorer with an empty tree and grows it live,
   * and pays for the effect with a half-built tree left saved whenever a download fails —
   * indistinguishable from a real one after the banner is gone. Here nothing is saved until the
   * download finishes, so a failure leaves the form open with the reason on it. The counter still
   * moves, because that is what the banner is for.
   *
   * The `form` captured here is compared by identity on the way out: tapping Back replaces
   * `openingForm`, so an in-flight download that resolves afterwards must not write its tree into
   * a screen the user has left. It is the browser's answer to the Swift `.onDisappear` cancel —
   * `fetch` cannot be un-sent without an AbortController, but its ANSWER can be dropped.
   */
  function runOpeningDownload(store, plan) {
    var form = openingForm;
    form.downloading = true;
    form.fetched = 0;
    form.error = null;
    render();

    BiyaOpeningDownload.run(plan.site, {
      username: plan.username,
      colour: plan.colour,
      limit: plan.limit,
      cancelled: function () { return openingForm !== form; },
      onGames: function (games, total) {
        if (openingForm !== form) return;
        form.games = (form.games || []).concat(games);
        form.fetched = total;
        render();
      }
    }).then(function () {
      if (openingForm !== form) return;
      form.downloading = false;
      var r = BiyaOpenings.submitGames(form, form.games || [], Date.now());
      if (r.error) { form.error = r.error; form.games = []; render(); return; }
      openingsSave(store, r.tree);
    }, function (e) {
      if (openingForm !== form) return;
      form.downloading = false;
      form.games = [];
      form.error = e && e.openingFailure === BiyaOpeningDownload.FAILURES.unknownUser
        ? BiyaOpeningMetrics.STRINGS.errUnknownUser
        : BiyaOpeningMetrics.STRINGS.errNetwork;
      render();
    });
  }

  /* ======================================================================== *
   *  TUTORIAL VIDEOS — see js/videos.js, js/content-client.js, js/video-library.js
   *
   *  The ONE online-only screen in the app. State lives here rather than in the
   *  screen for the same reason `openingForm` does: the router owns when to
   *  fetch, the module owns what to draw.
   * ======================================================================== */

  var videoState = null;

  function videosGo() {
    if (!videoState) videoState = BiyaVideos.emptyState();
    current = 'videos';
    render();
    videosLoad();
  }

  /* Fetch once per visit. The catalogue changes when somebody publishes a new manifest, not while
     the user is looking at it. */
  function videosLoad() {
    if (!videoState || videoState.loaded || videoState.loading) return;
    if (!BiyaContentClient.isConfigured()) return;
    videoState.loading = true;
    render();
    BiyaContentClient.videos().then(function (r) {
      // Dropped if the user has left, the same guard `openingForm !== form` gives the download.
      if (current !== 'videos') return;
      videoState.loading = false;
      videoState.loaded = true;
      videoState.error = r.error || null;
      videoState.videos = r.videos || [];
      render();
    });
  }

  function renderVideos() {
    if (!videoState) videoState = BiyaVideos.emptyState();
    videoState.isPremium = !locked();
    BiyaVideos.render(view, videoState, {
      onExit: function () { videoState.playing = null; current = 'home'; render(); },
      onPaywall: function () { goPaywall(); },
      onRetry: function () { videoState.loaded = false; videoState.error = null; videosLoad(); },
      // Plays IN the screen, which is what the app does too — the browser has <video> and the phone
      // has AVPlayerViewController, and neither needs a transport rebuilt for it.
      //
      // This line used to read `global.open(video.videoURL, _blank)` and carried TWO faults: there
      // is no `global` in this file (everything else says `window`), and `_blank` had lost its
      // quotes and was a bare identifier. A ReferenceError inside a click handler goes to the
      // console and nowhere else, so the card simply did nothing.
      onPlay: function (video) {
        if (video && video.videoURL) { videoState.playing = video; render(); }
      },
      onClosePlayer: function () { videoState.playing = null; render(); },
      // Demo only. The catalogue is a live Laravel route now, so this is no longer the only way
      // to see the screen — but it is still the way to see it with no network, or before the
      // backend change has been deployed. Loads js/video-sample.js THROUGH the real parser, so
      // what appears is the actual screen rather than a mock of it.
      onLoadSample: function () {
        videoState.videos = BiyaVideoLibrary.parse(BiyaVideoSample.manifestText());
        videoState.error = null;
        videoState.loaded = true;
        render();
      }
    });
  }

  function renderOpenings() {
    var store = BiyaOpeningStore.shared();
    if (!openingForm) openingForm = BiyaOpenings.emptyForm();
    // Pushed in rather than owned by the screen — the way `BiyaHome.setPremium` does it.
    BiyaOpenings.setEngine({ on: engineOn, rows: engineRows, analyzing: engineBusy,
                             snapshot: engineSnapshot });
    BiyaOpenings.render(view, store, openingForm, openingMode, {
      onEngineToggle: openingsEngineToggle,
      onBackToTree: function () { store.backToTree(); openingsEngineSchedule(); render(); },
      onExit: function () { current = 'home'; render(); },
      onBuild: function () { openingForm = BiyaOpenings.emptyForm(); openingsGo('form'); },
      onCancel: function () { openingsGo('list'); },
      onChanged: render,
      onSubmit: function () {
        if (openingForm.downloading) return;
        // The clock is injected rather than read inside the builder, so the same call is
        // reproducible in a test — the rule `pairing-store.js` follows for `createdAtMs`.
        var r = BiyaOpenings.submit(openingForm, Date.now(), BiyaPremium.shared().isPremium());
        if (r.error) { openingForm.error = r.error; render(); return; }
        if (r.download) { runOpeningDownload(store, r.download); return; }
        openingsSave(store, r.tree);
      },
      // Opening a tree starts the engine OFF, the way closing the Swift explorer destroys its
      // @StateObject. Every other one MOVES the board, so each re-schedules: the token bump
      // cancels whatever was running before the debounce even starts.
      onOpen: function (id) { store.openTree(id); openingsEngineReset(); openingsGo('list'); },
      onDelete: function (id) { store.remove(id); render(); },
      onClose: function () { store.closeTree(); openingsEngineReset(); render(); },
      onPlay: function (san) { store.play(san); openingsEngineSchedule(); render(); },
      onBack: function () { store.stepBack(); openingsEngineSchedule(); render(); },
      onForward: function () { store.stepForward(); openingsEngineSchedule(); render(); },
      onReset: function () { store.reset(); openingsEngineSchedule(); render(); }
    });
  }

  /* ======================================================================== *
   *  HOME TAB — see js/home.js
   * ======================================================================== */
  function renderHome() {
    // The header avatar's initial comes from the signed-in user, the way `PhoneApp` passes
    // `userName: loginStore.displayName` to `HomeScreen`. Without this it draws its "?" fallback.
    BiyaHome.setUserName(BiyaLogin.shared().displayName());
    // The banner's gold skin, the avatar's badge and the expiry line all come from the live
    // entitlement, the way `PhoneApp` passes `isPremium:` / `subscriptionEndsAt:` to `HomeScreen`.
    var sub = BiyaPremium.shared();
    BiyaHome.setPremium(sub.isPremium(), sub.expiresAt() ? new Date(sub.expiresAt()) : null);
    BiyaHome.render(view, function (action) {
      // Only the actions with a real destination in this demo are wired; the rest are the empty
      // callbacks the screen is designed around (§12).
      //
      // The trial gate, twin of `PhoneApp.gated` in PhoneView.swift. `avatar` and `membership` are
      // deliberately outside it: one leads to Sign out, the other IS the offer.
      if (locked() && action !== 'avatar' && action !== 'membership') { goPaywall(); return; }
      if (action === 'puzzles') { current = 'puzzles'; render(); }
      else if (action === 'playCoach') { current = 'play'; render(); }
      else if (action === 'analysis') { current = 'analysis'; render(); }
      else if (action === 'avatar') { current = 'profile'; render(); }
      // home.js has emitted 'pairing' since the tile was drawn; there was simply nothing here to
      // catch it.
      else if (action === 'pairing') pairingGo('pairing');
      // home.js has emitted 'openingTrainer' since the tile was drawn and nothing caught it —
      // the tile did nothing at all, which is the bug the client reported. This is where it goes.
      else if (action === 'openingTrainer') openingsGo('list');
      // home.js has emitted 'videos' since the tile was drawn and nothing caught it. This is where
      // it goes. It sits BELOW the `locked()` line above deliberately -- the gate still applies,
      // the same way it does in PhoneView, because a trial user seeing the subscribe screen is the
      // point rather than an accident.
      else if (action === 'videos') videosGo();
      // home.js has emitted 'membership' since the banner was drawn; this is where it goes.
      else if (action === 'membership') goPaywall();
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

  function coachGo(id) { current = id; render(); }

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
      onExit: function () { current = 'home'; render(); },
    });
  }

  function renderCoachColor() {
    BiyaCoachColor.render(view, coachTab.level, coachProfile(coachTab.level).name, {
      onStart: coachStart,
      onExit: function () { coachGo('play'); },
    });
  }

  function renderCoachGame() {
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
    // Profile is reached from the Home header's avatar. Until the tab bar was removed it was the
    // ONE screen in either language with no way out at all — the bar was its only exit.
    var head = el('div', 'screen-head with-back');
    var back = el('button', 'screen-back nav-icon');
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { current = 'home'; render(); };
    head.appendChild(back);
    head.appendChild(el('h1', 'screen-title', 'Profile'));
    view.appendChild(head);
    var wrap = el('div', 'wrap-x stack');
    var tier = R.classify(store.puzzleRating);
    // The name comes from the session now, not a literal, so the badge and the header agree with
    // whatever the signed-in user is called.
    var who = BiyaLogin.shared().displayName();
    wrap.appendChild(el('div', 'profile-card',
      '<div class="mono-badge">' + who.charAt(0) + '</div><div><div class="pname">' + who + '</div><div class="ptier">' + tier + '</div></div>' +
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

    // Subscription — its state and the route to the paywall.
    var PW = BiyaPremium, sub = PW.shared(), acc = sub.access();
    var line = acc.kind === 'premium'
      ? (sub.expiresAt() ? 'Renews ' + PW.dateText(sub.expiresAt()) : 'Active subscription')
      : acc.kind === 'grace'
        ? PW.STRINGS.graceTitle + ' · ' + PW.daysPillText(acc.daysLeft)
        : 'Unlock everything';
    var pc = el('div', 'card');
    pc.innerHTML = '<div class="card-label">' + PW.STRINGS.premium + '</div>'
      + '<div class="lg-account-row">' + (sub.isPremium() ? PW.GLYPH.crown : '⭐') + ' ' + line
      + '</div><button class="pw-profile-cta" type="button">'
      + (sub.isPremium() ? PW.STRINGS.manageRow : PW.STRINGS.lockCta) + '</button>';
    pc.querySelector('.pw-profile-cta').onclick = goPaywall;
    wrap.appendChild(pc);

    // Account — the only way back to the login screen once the session has been persisted.
    var S = BiyaLogin.STRINGS;
    var ac = el('div', 'card');
    ac.innerHTML = '<div class="card-label">' + S.accountCard + '</div>'
      + '<div class="lg-account-row">' + S.signedInWith + ' ' + BiyaLogin.shared().providerLabel()
      + '</div><button class="lg-signout" type="button">' + S.signOut + '</button>'
      + '<button class="lg-delete" type="button">' + S.deleteAccount + '</button>';
    ac.querySelector('.lg-signout').onclick = signOut;
    ac.querySelector('.lg-delete').onclick = confirmDeleteAccount;
    wrap.appendChild(ac);

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
    // The login gate's pure layer — the band budget, the drift field's keep-out zones, the two
    // colours of Apple's button that must never be retinted, and the session state machine
    // including the branch that decides whether a bad stored value lets someone past the gate.
    var login = BiyaLogin.selfTest();
    ck('login pure layer (' + login.passed + ' assertions)', login.failures.length, 0);
    login.failures.forEach(function (f) { console.log('FAIL login: ' + f); });
    // The free tier's PHP-pinned caps, then the subscription state machine on top of them.
    var caps = BiyaDailyLimits.selfTest();
    ck('daily limits (' + caps.passed + ' assertions)', caps.failures.length, 0);
    caps.failures.forEach(function (f) { console.log('FAIL limits: ' + f); });
    var prem = BiyaPremium.selfTest();
    ck('subscription pure layer (' + prem.passed + ' assertions)', prem.failures.length, 0);
    prem.failures.forEach(function (f) { console.log('FAIL premium: ' + f); });
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
  // Demo chrome, deliberately OUTSIDE the phone: it drives the SIMULATED store so the whole
  // lifecycle — trial, active, the grace window, expiry — is walkable without a device or a month
  // of waiting. The app itself only ever reads `BiyaPremium.shared()`.
  var premiumSel = document.getElementById('home-premium-select');
  if (premiumSel) premiumSel.onchange = function () {
    var sub = BiyaPremium.shared(), DAY = BiyaPremium.CONST.msPerDay, now = Date.now();
    var v = premiumSel.value;
    if (v === 'free') { sub.clear(); }
    else if (v === 'trial') { sub.startTrial(); }
    else if (v === 'active') { sub.subscribe(); }
    else if (v === 'grace') {
      // Expired yesterday, auto-renew still on, no way to reach Apple — the renewal-day
      // subscriber, which is the exact case the grace window exists for.
      sub.apply({ isSubscribed: true, willAutoRenew: true, expiresAtMs: now - DAY }, now);
    } else if (v === 'expired') {
      sub.apply({ isSubscribed: true, willAutoRenew: false, expiresAtMs: now - DAY }, now);
    }
    render();
  };
  render();
  if (/(\?|&)selftest\b/.test(location.search)) runSelfTest();
})();
