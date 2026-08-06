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
    SND = window.SoundManager, PUZZLES = window.SAMPLE_PUZZLES;

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
  var MAT_W = [1, 3, 3, 5, 9, 0];
  var COLORCLASS = { good: 'good', bad: 'bad', warn: 'warn' };

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
  function strengthPct(rating) { return clamp((rating - C.ratingFloor) / (C.ratingCeiling - C.ratingFloor) * 100, 4, 100); }

  // simple SVG icons (stroke=currentColor)
  var ICON = {
    puzzles: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M10 3.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V5h2a1 1 0 0 1 1 1v2h1.5c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5H17v3a1 1 0 0 1-1 1h-3v1.5c0 .8-.7 1.5-1.5 1.5S9 17.8 9 17v-1.5H6a1 1 0 0 1-1-1v-3H3.5C2.7 10.5 2 9.8 2 9s.7-1.5 1.5-1.5H5V6a1 1 0 0 1 1-1h4V3.5Z"/></svg>',
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke-width="1.2" opacity=".8"/></svg>',
    profile: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
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
  var TABS = [{ id: 'puzzles', ico: ICON.puzzles, lbl: 'Puzzles' }, { id: 'play', ico: ICON.play, lbl: 'Play' }, { id: 'profile', ico: ICON.profile, lbl: 'Profile' }];
  var current = 'play';
  function renderTabbar() {
    tabbarEl.innerHTML = '';
    TABS.forEach(function (t) {
      var b = el('button', 'tab' + (t.id === current ? ' active' : ''));
      b.innerHTML = '<span class="ico">' + t.ico + '</span><span class="lbl">' + t.lbl + '</span>';
      b.onclick = function () { current = t.id; renderTabbar(); render(); };
      tabbarEl.appendChild(b);
    });
  }
  function render() {
    view.scrollTop = 0; view.innerHTML = '';
    if (current === 'play') renderPlay();
    else if (current === 'profile') renderProfile();
    else renderPuzzles();
  }

  /* ======================================================================== *
   *  PLAY TAB
   * ======================================================================== */
  var play = { started: false, coach: C.all[2], humanColor: E.WHITE, passAndPlay: false, pos: null, fens: [], sans: [], flipped: false, thinking: false, over: false, boardEl: null, ui: null };

  function renderPlay() { if (!play.started) renderCoachSelect(); else renderGame(); }

  function renderCoachSelect() {
    view.scrollTop = 0; view.innerHTML = '';   // leaf renderers own their clear (direct callers bypass render())
    view.appendChild(el('div', 'screen-head', '<h1 class="screen-title">Play</h1>'));
    var intro = el('div', 'wrap-x');
    intro.appendChild(el('div', null, '<div style="font-weight:800;font-size:17px">Choose your opponent</div><div class="hint" style="margin:4px 0 14px">Every coach has a strength rating. Beat stronger ones to climb.</div>'));
    view.appendChild(intro);

    var list = el('div', 'coach-list wrap-x');
    C.all.forEach(function (coach) {
      var card = el('button', 'coach-card' + (!play.passAndPlay && play.coach === coach ? ' sel' : ''));
      card.innerHTML =
        coachAvatarHTML(coach) +
        '<div class="body">' +
        '<div class="row1"><span class="cname">' + coach.name + '</span><span class="title-badge">' + coach.title + '</span></div>' +
        '<div class="blurb">' + coach.blurb + '</div>' +
        '<div class="row"><span class="chip">♙ ' + coach.favoriteOpening + '</span></div>' +
        '<div class="strength-bar" style="margin-top:9px"><span style="width:' + strengthPct(coach.rating) + '%"></span></div>' +
        '</div>' +
        '<div class="rating-big"><b>' + coach.rating + '</b><span>rating</span></div>';
      card.onclick = function () { play.coach = coach; play.passAndPlay = false; renderPlay(); };
      list.appendChild(card);
    });
    // pass & play
    var pnp = el('button', 'coach-card' + (play.passAndPlay ? ' sel' : ''));
    pnp.innerHTML = '<span class="avatar" style="--size:66px"><span class="mono-init" style="font-size:24px">✌️</span></span>'
      + '<div class="body"><div class="row1"><span class="cname">Pass & play</span></div><div class="blurb">Two players on one device — no coach.</div></div>';
    pnp.onclick = function () { play.passAndPlay = true; renderPlay(); };
    list.appendChild(pnp);
    view.appendChild(list);

    // footer controls
    var foot = el('div', 'wrap-x stack'); foot.style.marginTop = '16px';
    var colorRow = el('div', 'row');
    colorRow.innerHTML = '<span class="muted tiny" style="margin-right:2px">Play as</span>';
    var seg = el('div', 'segmented');
    ['White', 'Black'].forEach(function (label, i) {
      var b = el('button', play.humanColor === i ? 'active' : '', label);
      b.onclick = function () { play.humanColor = i; renderPlay(); };
      seg.appendChild(b);
    });
    colorRow.appendChild(seg);
    if (!play.passAndPlay) foot.appendChild(colorRow);
    var startBtn = el('button', 'btn btn-gold', play.passAndPlay ? 'Start pass & play' : 'Play vs ' + play.coach.name);
    startBtn.style.width = '100%';
    startBtn.onclick = startGame;
    foot.appendChild(startBtn);
    view.appendChild(foot);
  }

  function startGame() {
    play.started = true; play.over = false; play.thinking = false;
    play.pos = E.start();
    play.fens = [E.toFEN(play.pos)]; play.sans = [];
    play.flipped = (play.humanColor === E.BLACK && !play.passAndPlay);
    store.gamesPlayed++; save();
    SND.playGameStart();
    renderGame();
    if (!play.passAndPlay && play.pos.sideToMove !== play.humanColor) maybeCoachMove();
  }

  function renderGame() {
    view.scrollTop = 0; view.innerHTML = '';
    // header
    var head = el('div', 'wrap-x'); head.style.paddingTop = '4px';
    var hrow = el('div', 'coach-header');
    if (play.passAndPlay) {
      hrow.innerHTML = '<span class="avatar"><span class="mono-init">✌️</span></span><div><div class="name">Pass & play</div><div class="sub"><span class="muted tiny">Two players</span></div></div>';
    } else {
      var dots = '<span class="strength-dots">';
      var lvl = C.all.indexOf(play.coach) + 1;
      for (var i = 1; i <= 5; i++) dots += '<i class="' + (i <= lvl ? 'on' : '') + '"></i>';
      dots += '</span>';
      hrow.innerHTML = coachAvatarHTML(play.coach) +
        '<div class="grow"><div class="name">' + play.coach.name + '</div><div class="sub"><span class="title-badge">' + play.coach.title + '</span>' + dots + '</div></div>' +
        '<div class="rating"><b class="mono">' + play.coach.rating + '</b><span>rating</span></div>';
    }
    head.appendChild(hrow);
    var change = el('button', 'link-btn', '← Change opponent'); change.style.marginTop = '10px';
    change.onclick = function () { play.started = false; renderPlay(); };
    head.appendChild(change);
    view.appendChild(head);

    // board + eval bar
    var row = el('div', 'board-row');
    var evalBar = el('div', 'eval-bar', '<div class="fill" style="height:50%"></div><div class="mid"></div>');
    var board = document.createElement('chess-board');
    board.setAttribute('coordinates', 'true');
    board.rules = rulesAdapter;
    board.flipped = play.flipped;
    board.addEventListener('move', onGameMove);
    row.appendChild(evalBar); row.appendChild(board);
    view.appendChild(row);
    play.boardEl = board;

    // status / material / ribbon
    var status = el('div', 'status-line');
    var material = el('div', 'material');
    var ribbon = el('div', 'move-ribbon');
    view.appendChild(status); view.appendChild(material); view.appendChild(ribbon);

    // controls
    var ctrl = el('div', 'wrap-x'); ctrl.style.marginTop = '8px';
    var brow = el('div', 'btn-row');
    var newBtn = el('button', 'btn btn-gold grow', 'New game'); newBtn.onclick = function () { startGame(); };
    var undoBtn = el('button', 'icon-btn'); undoBtn.innerHTML = ICON.undo; undoBtn.title = 'Undo'; undoBtn.onclick = undo;
    var flipBtn = el('button', 'icon-btn'); flipBtn.innerHTML = ICON.flip; flipBtn.title = 'Flip board'; flipBtn.onclick = function () { play.flipped = !play.flipped; play.boardEl.flipped = play.flipped; };
    brow.appendChild(newBtn); brow.appendChild(undoBtn); brow.appendChild(flipBtn);
    ctrl.appendChild(brow);
    // thinking pill
    var pillWrap = el('div', 'center'); pillWrap.style.marginTop = '10px';
    var pill = el('div', 'pill'); pill.style.display = 'none';
    pill.innerHTML = '<span class="spin"></span><span class="txt"></span>';
    pillWrap.appendChild(pill); ctrl.appendChild(pillWrap);
    view.appendChild(ctrl);

    play.ui = { evalFill: evalBar.querySelector('.fill'), status: status, material: material, ribbon: ribbon, undo: undoBtn, pill: pill };
    // initial paint
    play.boardEl.setPosition(E.toFEN(play.pos), { animate: false, lastMove: null, check: checkSquare(play.pos) });
    play.boardEl.interactive = canHumanMove();
    refreshGameUI();
  }

  function checkSquare(pos) {
    var st = E.status(pos);
    if (st === 'check' || st === 'checkmate') return E.kingSquare(pos, pos.sideToMove);
    return null;
  }
  function canHumanMove() { return !play.over && !play.thinking && (play.passAndPlay || play.pos.sideToMove === play.humanColor); }

  function onGameMove(e) {
    if (!canHumanMove()) return;
    var m = findMove(play.pos, e.detail.from, e.detail.to, e.detail.promotion);
    if (m) applyMove(m);
  }

  function applyMove(m) {
    var pos = play.pos, mover = pos.squares[m.from];
    var castle = mover.kind === E.KING && Math.abs((m.to & 7) - (m.from & 7)) === 2;
    var capture = pos.squares[m.to] != null || (mover.kind === E.PAWN && m.to === pos.enPassant);
    var sanStr = E.san(pos, m);
    var next = E.makeMove(pos, m);
    play.pos = next; play.fens.push(E.toFEN(next)); play.sans.push(sanStr);
    var st = E.status(next);
    SND.playForMove({ status: st, capture: capture, castle: castle });
    play.boardEl.setPosition(E.toFEN(next), { lastMove: { from: m.from, to: m.to }, check: checkSquare(next) });
    refreshGameUI();
    if (st === 'checkmate' || st === 'stalemate') { onGameOver(st); return; }
    maybeCoachMove();
  }

  function maybeCoachMove() {
    if (play.passAndPlay || play.over) { play.boardEl.interactive = canHumanMove(); return; }
    if (play.pos.sideToMove === play.humanColor) { play.boardEl.interactive = true; return; }
    play.thinking = true; play.boardEl.interactive = false;
    showThinking(true);
    var snapshot = play.pos;
    Promise.all([CA.bestMoveAsync(play.pos, play.coach), delay(380)]).then(function (res) {
      play.thinking = false; showThinking(false);
      if (play.pos !== snapshot || play.over) { play.boardEl.interactive = canHumanMove(); return; } // state changed (new game/undo)
      var m = res[0];
      if (!m) { play.boardEl.interactive = canHumanMove(); return; }
      applyMove(m);
    });
  }

  function onGameOver(st) {
    play.over = true; play.boardEl.interactive = false;
    if (st === 'checkmate') {
      var winner = play.pos.sideToMove === E.WHITE ? E.BLACK : E.WHITE;
      if (!play.passAndPlay && winner === play.humanColor) { store.wins++; save(); }
    }
    refreshGameUI();
  }

  function showThinking(on) {
    if (!play.ui) return;
    play.ui.pill.style.display = on ? 'inline-flex' : 'none';
    if (on) play.ui.pill.querySelector('.txt').textContent = play.coach.name + ' is thinking…';
  }

  function undo() {
    if (play.thinking || play.fens.length <= 1) return;
    play.fens.pop(); play.sans.pop();
    play.pos = E.fromFEN(play.fens[play.fens.length - 1]);
    // if it landed on the coach's move, pop once more so it's the human's turn
    if (!play.passAndPlay && play.fens.length > 1 && play.pos.sideToMove !== play.humanColor) {
      play.fens.pop(); play.sans.pop();
      play.pos = E.fromFEN(play.fens[play.fens.length - 1]);
    }
    play.over = false;
    var lm = null; // best-effort: no last-move highlight after undo
    play.boardEl.setPosition(E.toFEN(play.pos), { lastMove: lm, check: checkSquare(play.pos) });
    play.boardEl.interactive = canHumanMove();
    refreshGameUI();
  }

  function refreshGameUI() {
    if (!play.ui) return;
    // status
    var pos = play.pos, st = E.status(pos), side = pos.sideToMove === E.WHITE ? 'White' : 'Black';
    var txt = side + ' to move', cls = '';
    if (st === 'checkmate') { txt = 'Checkmate — ' + (pos.sideToMove === E.WHITE ? 'Black' : 'White') + ' wins'; cls = 'warn'; }
    else if (st === 'stalemate') { txt = 'Stalemate — draw'; cls = 'warn'; }
    else if (st === 'check') { txt = side + ' to move — Check!'; cls = 'bad'; }
    play.ui.status.className = 'status-line ' + cls; play.ui.status.textContent = txt;
    // material
    var w = 0, b = 0;
    for (var s = 0; s < 64; s++) { var p = pos.squares[s]; if (!p) continue; if (p.color === E.WHITE) w += MAT_W[p.kind]; else b += MAT_W[p.kind]; }
    var diff = w - b;
    play.ui.material.innerHTML = diff === 0 ? '<span>Material even</span>'
      : '<span class="adv">' + (diff > 0 ? 'White' : 'Black') + ' +' + Math.abs(diff) + '</span>';
    // eval bar
    var pct;
    if (st === 'checkmate') pct = (pos.sideToMove === E.WHITE) ? 0 : 100;
    else if (st === 'stalemate') pct = 50;
    else { var ev = CA.evaluate(pos); var whiteEv = pos.sideToMove === E.WHITE ? ev : -ev; pct = R.evalToWinPct(whiteEv); }
    play.ui.evalFill.style.height = clamp(pct, 2, 98) + '%';
    // ribbon
    var rib = play.ui.ribbon; rib.innerHTML = '';
    if (!play.sans.length) rib.appendChild(el('span', 'empty', 'No moves yet'));
    else play.sans.forEach(function (sanStr, i) {
      var chip = el('span', 'move-chip' + (i === play.sans.length - 1 ? ' latest' : ''));
      chip.innerHTML = (i % 2 === 0 ? '<span class="num">' + (i / 2 + 1) + '.</span>' : '') + sanStr;
      rib.appendChild(chip);
    });
    rib.scrollLeft = rib.scrollWidth;
    play.ui.undo.disabled = play.fens.length <= 1 || play.thinking;
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
    var fails = results.filter(function (r) { return !r.ok; });
    results.forEach(function (r) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.label + '  got=' + r.got + (r.ok ? '' : '  want=' + r.want)); });
    console.log(fails.length === 0 ? '✅ engine self-test: ALL ' + results.length + ' PASSED' : '❌ ' + fails.length + ' FAILED');
    var toast = el('div', null, (fails.length === 0 ? '✅ Engine self-test: all ' + results.length + ' perft checks passed' : '❌ ' + fails.length + ' perft checks FAILED — see console'));
    toast.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:999;background:' +
      (fails.length === 0 ? 'rgba(92,194,100,.95)' : 'rgba(255,107,107,.95)') +
      ';color:#06101f;font-weight:800;padding:10px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:13px';
    document.body.appendChild(toast);
    setTimeout(function () { toast.style.transition = 'opacity .5s'; toast.style.opacity = '0'; }, 5000);
  }

  // ------------------------------------------------------------------- boot --
  renderTabbar();
  render();
  if (/(\?|&)selftest\b/.test(location.search)) runSelfTest();
})();
