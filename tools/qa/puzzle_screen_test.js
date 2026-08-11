#!/usr/bin/env node
/*
 * puzzle_screen_test.js — the Puzzle Hub screens, rendered for real without a browser.
 *
 *     node tools/qa/puzzle_screen_test.js
 *
 * `puzzle_core_test.js` proves the logic and `puzzle-metrics` proves the numbers. Neither would
 * notice a screen that throws on its first paint, renders no cards, or wires a button to nothing —
 * and those only happen in a browser, which this checkout cannot open (the Chrome available to
 * this session runs on a different machine from the local server).
 *
 * So: a fake DOM just large enough for these three screens, then render each one and walk the tree
 * it produced. Same tactic `board_component_test.js` uses for `<chess-board>`. It cannot prove the
 * CSS lays out correctly; it can prove the structure exists, the copy is the spec's, the routing
 * closures fire, and every `--pz*` custom property the stylesheet reads is actually set.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- a fake DOM, only as much as these screens touch ---------------------------------
function makeNode(tag, ns) {
  const n = {
    _on: {},
    tagName: String(tag).toUpperCase(), ns: ns || null,
    children: [], parentNode: null, attrs: {}, _text: '',
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      getPropertyValue(k) { return this._props[k]; },
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._s.has(c) : !!force;
        if (on) this._s.add(c); else this._s.delete(c);
        return on;
      },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    remove() {
      if (!this.parentNode) return;
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    },
    addEventListener(type, fn) { (this._on[type] || (this._on[type] = [])).push(fn); },
    focus() {},
    closest() { return null; },
    // `<chess-board>` is a custom element this fake DOM cannot register. These are the whole
    // surface the solvers touch, so stubbing them lets a solver mount and paint for real.
    setPosition(fen) { this._fen = fen; },
    getPosition() { return this._fen; },
    highlightLastMove(a, b) { this._hl = [a, b]; },
    setCheck() {},
    clearSelection() {},
  };
  Object.defineProperty(n, 'className', {
    get() { return [...n.classList._s].join(' '); },
    set(v) { n.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(n, 'textContent', {
    get() { return n._text; },
    set(v) { n._text = String(v); n.children.length = 0; },
  });
  Object.defineProperty(n, 'innerHTML', {
    get() { return ''; },
    set() { n.children.length = 0; },
  });
  return n;
}

function makeDom() {
  return {
    createElement: (t) => makeNode(t),
    createElementNS: (ns, t) => makeNode(t, ns),
  };
}

/** Every node in the tree, depth first. */
function walk(node, out) {
  out = out || [];
  out.push(node);
  node.children.forEach(c => walk(c, out));
  return out;
}
const byClass = (root, cls) => walk(root).filter(n => n.classList.contains(cls));
const textOf = (root, cls) => byClass(root, cls).map(n => n.textContent);

/** Load the browser-shaped scripts into one sandbox, in index.html's order. */
function loadSandbox() {
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  // `ai.js` is in this list because `analysis-engine.js` reads `CoachAI` AT LOAD TIME — the same
  // trap that made the analysis worker throw on startup. Leaving it out is not a smaller test, it
  // is a test of a load order the page does not use.
  const need = ['engine.js', 'ai.js', 'rating.js', 'sound.js',
                'puzzle-data.js', 'puzzle-serving.js', 'puzzle-session.js', 'puzzle-store.js',
                'streak-engine.js', 'puzzle-progress.js', 'eco-data.js', 'movetree.js', 'pgn.js', 'analysis-engine.js',
                'opening-book.js', 'analysis-metrics.js', 'engine-host.js', 'analysis-store.js',
                'puzzle-metrics.js', 'puzzle-app.js', 'puzzle-stats.js', 'puzzle-hub.js',
                'puzzle-home.js', 'puzzle-board.js', 'puzzle-solver.js',
                'puzzle-daily.js', 'puzzle-thematic.js',
                'turbo-run.js', 'puzzle-streak.js', 'puzzle-turbo.js'];
  // Load in the page's own order, not this list's — the point is to prove the PAGE order works.
  const files = order.filter(f => need.includes(f));
  for (const f of need) {
    expect(order.includes(f), `index.html loads js/${f}`);
  }

  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN,
    parseInt, parseFloat, navigator: {},
    // `sound.js` constructs Audio objects at load. A stub keeps it loadable headlessly without
    // changing what the page does — the screens only ever call `play()`, whose effect is audible
    // and therefore out of scope here anyway.
    Audio: function () { return { play() { return Promise.resolve(); }, currentTime: 0,
                                  load() {}, cloneNode() { return new sandbox.Audio(); } }; },
    document: makeDom(),
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    try {
      vm.runInContext(fs.readFileSync(path.join(JS, f), 'utf8'), sandbox, { filename: f });
    } catch (e) {
      failures.push(`${f} threw at load: ${e.message}`);
      return null;
    }
  }
  passed++;   // every script loaded in the page's own order
  return sandbox;
}

function run() {
  passed = 0; failures.length = 0;

  const S = loadSandbox();
  if (!S) return finish();

  for (const g of ['BiyaPuzzleMetrics', 'BiyaPuzzleApp', 'BiyaPuzzleStats', 'BiyaPuzzleHub',
                   'BiyaPuzzleHome', 'BiyaPuzzleBoard', 'BiyaPuzzleSolver', 'BiyaPuzzleDaily',
                   'BiyaPuzzleThematic']) {
    expect(S[g] && typeof S[g] === 'object', `${g} is a browser global`);
  }
  expect(typeof S.BiyaPuzzleHub.render === 'function', 'the hub exposes render');
  expect(typeof S.BiyaPuzzleHome.render === 'function', 'the home exposes render');
  expect(typeof S.BiyaPuzzleSolver.render === 'function', 'the solver exposes render');
  expect(typeof S.BiyaPuzzleSolver.leave === 'function',
    'and a leave(), so the tab bar can cancel its timers');

  const MET = S.BiyaPuzzleMetrics;

  // =====================================================================================
  // 1. The Puzzle Hub (Part 9)
  // =====================================================================================
  {
    const view = makeNode('div');
    let opened = null, exited = false;
    S.BiyaPuzzleHub.render(view, (m) => { opened = m; }, () => { exited = true; });
    const root = view.children[0];
    expect(!!root, 'the hub renders a root');
    expect(root.classList.contains('pzh-view'), 'with the screen class');

    eq(textOf(root, 'pzh-title')[0], MET.STR.hubTitle, 'the header title');
    eq(textOf(root, 'pzh-hero-title')[0], MET.STR.hubHeroTitle, 'the hero title');
    eq(textOf(root, 'pzh-hero-sub')[0], MET.STR.hubHeroSub, 'the hero subtitle, emoji and all');

    const cards = byClass(root, 'pzh-card');
    eq(cards.length, 5, 'five mode cards');
    eq(textOf(root, 'pzh-card-title').join('|'),
       MET.HUB_MODES.map(m => m.title).join('|'), 'the five titles, in order');
    eq(textOf(root, 'pzh-card-sub').join('|'),
       MET.HUB_MODES.map(m => m.subtitle).join('|'), 'the five subtitles');
    eq(textOf(root, 'pzh-badge').join('|'),
       MET.HUB_MODES.map(m => m.badge).join('|'), 'the five badges');
    // Each card is tinted with its own accent, and the tile uses the concatenated alpha bytes.
    cards.forEach((c, i) => {
      const m = MET.HUB_MODES[i];
      eq(c.style.borderLeftColor, m.color, `card ${i} left border is the mode accent`);
      const tile = byClass(c, 'pzh-tile')[0];
      eq(tile.style.background, m.color + MET.TINT_FILL, `card ${i} tile fill is +'22'`);
      eq(tile.style.borderColor, m.color + MET.TINT_BORDER, `card ${i} tile border is +'55'`);
    });
    // Routing: tapping a card reports its id, and back exits.
    cards[0].onclick();
    eq(opened, 'play', 'the first card opens Play Puzzles');
    cards[4].onclick();
    eq(opened, 'streak', 'the fifth opens Streak');
    byClass(root, 'pzh-back')[0].onclick();
    expect(exited, 'back exits the hub');

    // Every custom property the stylesheet reads must actually be set.
    const css = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
    const section = css.slice(css.indexOf('---- Puzzle Hub'));
    const used = new Set([...section.matchAll(/var\((--pz[a-z0-9-]+)/g)].map(m => m[1]));
    const set = new Set(Object.keys(root.style._props));
    // The hub sets the hub + goal + shared vars; the other screens set theirs. Check the ones the
    // hub's own classes read, which is what a missing property would break.
    const hubVars = [...used].filter(v => /^--pz[hg]-/.test(v));
    const missing = hubVars.filter(v => !set.has(v));
    eq(missing.join(','), '', 'every --pzh-/--pzg- property the CSS reads is set by the hub');
    expect(hubVars.length > 25, `and there are ${hubVars.length} of them, so this is not vacuous`);
  }

  // =====================================================================================
  // 2. The daily-goal strip (Part 15.2)
  // =====================================================================================
  {
    const PROG = S.BiyaPuzzleProgress;
    const now = new Date(2026, 7, 11, 12).getTime();

    function strip(state) {
      return S.BiyaPuzzleHub.goalStrip(PROG.dailyGoalStatus(state, now));
    }
    const fresh = PROG.seed(now);
    const s0 = strip(fresh);
    eq(textOf(s0, 'pzg-title')[0], MET.STR.goalTitle, 'the strip title');
    eq(textOf(s0, 'pzg-sub')[0], MET.STR.goalProgress(0), 'zero solved today');
    eq(textOf(s0, 'pzg-ringlabel')[0], '0', 'the ring reads 0');
    eq(byClass(s0, 'pzg-pill').length, 0, 'no streak pill at zero');

    const some = PROG.seed(now);
    for (let i = 0; i < 3; i++) PROG.recordSolve(some, 'play', now);
    const s1 = strip(some);
    eq(textOf(s1, 'pzg-ringlabel')[0], '3', 'the ring counts up');
    eq(textOf(s1, 'pzg-sub')[0], MET.STR.goalProgress(3), 'and so does the sub-line');
    eq(byClass(s1, 'pzg-pill')[0].textContent, MET.STR.goalStreak(1),
       'a streak of one shows the pill');

    const done = PROG.seed(now);
    for (let i = 0; i < 12; i++) PROG.recordSolve(done, 'play', now);
    const s2 = strip(done);
    eq(textOf(s2, 'pzg-ringlabel')[0], '✅', 'completion swaps the label for a tick');
    eq(textOf(s2, 'pzg-sub')[0], MET.STR.goalComplete, 'and the copy');
    // The ring is an SVG with a track and a progress arc; the arc must be fully closed at 100%.
    const circles = walk(s2).filter(n => n.tagName === 'CIRCLE');
    eq(circles.length, 2, 'a track and a progress arc');
    eq(Number(circles[1].getAttribute('stroke-dashoffset')), 0, 'a full ring has no offset left');
    eq(circles[1].getAttribute('stroke'), MET.GOAL.ringDoneColor, 'and turns green');
    expect(/rotate\(-90/.test(circles[1].getAttribute('transform')),
      'the sweep starts at 12 o\'clock');
    const half = PROG.seed(now);
    for (let i = 0; i < 5; i++) PROG.recordSolve(half, 'play', now);
    const c2 = walk(strip(half)).filter(n => n.tagName === 'CIRCLE')[1];
    const dash = Number(c2.getAttribute('stroke-dasharray'));
    expect(Math.abs(Number(c2.getAttribute('stroke-dashoffset')) - dash / 2) < 1e-6,
      'half done is half the circumference');
  }

  // =====================================================================================
  // 3. Play Puzzles Home (Part 10.1) — day one, and with history
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp;
    const PROG = S.BiyaPuzzleProgress;

    APP.reset();
    const view = makeNode('div');
    let played = false, exited = false;
    S.BiyaPuzzleHome.render(view, () => { played = true; }, () => { exited = true; });
    const root = view.children[0];
    eq(textOf(root, 'pzp-title')[0], MET.STR.homeTitle, 'the header title');
    eq(textOf(root, 'pzp-badge')[0], MET.STR.homeBadge, 'the RATED badge');
    eq(textOf(root, 'pzp-hero-title')[0], MET.STR.homeHeroTitle, 'the hero');
    eq(textOf(root, 'pzp-info')[0], MET.STR.homeInfo, 'the info strip copy');
    eq(textOf(root, 'pzp-play')[0], MET.STR.homePlay, 'the Play button');
    eq(textOf(root, 'pzp-stat-label').join(','), 'ELO,Rated,Track', 'the three mini stats');

    // Day one: the rating card renders, and exactly one invitation replaces the four charts.
    eq(textOf(root, 'pzs-rating')[0], '1200', 'the rating card always renders');
    eq(textOf(root, 'pzs-best')[0], '1200', 'and the best');
    eq(textOf(root, 'pzs-delta')[0], '—', 'no history reads as an em dash, not +0');
    eq(byClass(root, 'pzs-empty').length, 1, 'one empty-state line');
    eq(textOf(root, 'pzs-empty')[0], MET.STR.statsEmpty, 'with the agreed copy');
    eq(byClass(root, 'pzs-spark').length, 0, 'no sparkline on day one');
    eq(byClass(root, 'pzs-acc').length, 0, 'no accuracy card');
    eq(byClass(root, 'pzs-bars').length, 0, 'no bar chart');
    eq(byClass(root, 'pzs-theme-row').length, 0, 'no theme rows');

    byClass(root, 'pzp-play')[0].onclick();
    expect(played, 'Play routes to the solver');
    byClass(root, 'pzp-back')[0].onclick();
    expect(exited, 'back returns to the hub');

    // With history: the four charts appear and the empty line goes.
    const st = APP.state();
    const t = Date.now();
    for (let i = 0; i < 12; i++) {
      PROG.recordRatedAttempt(st, { puzzleId: 900 + i, isCorrect: i % 4 !== 0,
                                    puzzleRating: 1200, themes: i % 2 ? ['fork'] : ['pin'] },
                              t - (11 - i) * 1000);
    }
    const view2 = makeNode('div');
    S.BiyaPuzzleHome.render(view2, () => {}, () => {});
    const r2 = view2.children[0];
    eq(byClass(r2, 'pzs-empty').length, 0, 'the invitation goes once there is data');
    eq(byClass(r2, 'pzs-spark').length, 1, 'the sparkline appears');
    eq(byClass(r2, 'pzs-acc').length, 1, 'the accuracy card appears');
    eq(byClass(r2, 'pzs-bars').length, 1, 'the bar chart appears');
    eq(byClass(r2, 'pzs-bar-col').length, 7, 'with seven columns');
    expect(byClass(r2, 'pzs-theme-row').length > 0, 'and the theme rows');
    const poly = walk(r2).filter(n => n.tagName === 'POLYLINE')[0];
    expect(!!poly, 'the sparkline is a polyline');
    expect(poly.getAttribute('points').split(' ').length === 12,
      'with one point per attempt');
    eq(poly.getAttribute('fill'), 'none', 'no fill, per Part 10.1');
    eq(Number(poly.getAttribute('stroke-width')), MET.STATS.sparkStrokeWidth, 'stroke width 1.5');
    // The delta is now a real number, and coloured.
    const d = textOf(r2, 'pzs-delta')[0];
    expect(d !== '—', 'the 7-day delta is now a number');
    expect(/^[+-]/.test(d), `and carries its sign: ${d}`);
    APP.reset();
  }

  // =====================================================================================
  // 3b. Daily Puzzle (Part 11)
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp, PROG = S.BiyaPuzzleProgress;
    APP.reset();

    let view = makeNode('div');
    let solveTapped = false, exited = false;
    S.BiyaPuzzleDaily.renderHome(view, () => { solveTapped = true; }, () => { exited = true; });
    let root = view.children[0];
    eq(textOf(root, 'pzd-title')[0], MET.STR.dailyTitle, 'the header title');
    eq(textOf(root, 'pzd-hero-title')[0], MET.STR.dailyHeroTitle, 'the hero title');
    eq(textOf(root, 'pzd-hero-sub')[0], MET.STR.dailyHeroSub, 'the hero subtitle');
    expect(textOf(root, 'pzd-hero-sub')[0].indexOf('always offline') > 0,
      'which says "always offline" — the original said "powered by Chess.com", now false');
    expect(textOf(root, 'pzd-hero-sub')[0].toLowerCase().indexOf('chess.com') < 0,
      'and never mentions Chess.com');
    eq(byClass(root, 'pzd-stat').length, 2, 'two stat cards');
    eq(textOf(root, 'pzd-stat-value').join(','), '0,0', 'both zero on day one');
    eq(textOf(root, 'pzd-stat-label').join(','), 'Day Streak,Total Solved', 'their labels');
    eq(textOf(root, 'pzd-info-title')[0], MET.STR.dailyHowTitle, 'the How it works card');
    eq(byClass(root, 'pzd-start').length, 1, 'the CTA is the solve button');
    eq(byClass(root, 'pzd-solved').length, 0, 'and the solved card is absent');
    byClass(root, 'pzd-start')[0].onclick();
    expect(solveTapped, 'the CTA routes to the solver');
    byClass(root, 'pzd-back')[0].onclick();
    expect(exited, 'back exits');

    // Already solved today: the CTA swaps for the solved card.
    PROG.recordDailyPuzzleSolve(APP.state(), Date.now());
    view = makeNode('div');
    S.BiyaPuzzleDaily.renderHome(view, () => {}, () => {});
    root = view.children[0];
    eq(byClass(root, 'pzd-start').length, 0, 'the CTA is gone once today is solved');
    eq(byClass(root, 'pzd-solved').length, 1, 'and the solved card takes its place');
    eq(textOf(root, 'pzd-solved-title')[0], MET.STR.dailySolvedTitle, 'with the right title');
    eq(textOf(root, 'pzd-solved-sub')[0], MET.STR.dailySolvedSub, 'and copy');
    eq(textOf(root, 'pzd-stat-value')[0], '1', 'the streak card now reads 1');
    APP.reset();

    // The solver.
    view = makeNode('div');
    S.BiyaPuzzleDaily.renderSolver(view, () => {});
    root = view.children[0];
    expect(!!root, 'the daily solver renders');
    eq(textOf(root, 'pzds-title')[0], MET.STR.dailyTitle, 'its title');
    expect(textOf(root, 'pzds-sub')[0].length > 0,
      'and a theme summary standing in for the network puzzle title');
    eq(byClass(root, 'pz-board').length, 1, 'a board band');
    const instr = textOf(root, 'pzds-instruction')[0];
    expect(instr === MET.STR.dailyWhite || instr === MET.STR.dailyBlack,
      'and an instruction line naming the side to move');
    expect(byClass(root, 'pzds-done')[0].classList.contains('pzds-hidden'),
      'the Done button is hidden until the puzzle is solved');
    expect(byClass(root, 'pzds-banner')[0].classList.contains('pzds-hidden'),
      'and so is the feedback banner');
    // The same date must give the same puzzle — the whole point of the local pool.
    const d1 = APP.dailyPuzzle(new Date(2026, 7, 11, 9));
    const d2 = APP.dailyPuzzle(new Date(2026, 7, 11, 22));
    eq(d1.puzzle.id, d2.puzzle.id, 'the daily puzzle is stable across the day');
    S.BiyaPuzzleDaily.leave();
    APP.reset();
  }

  // =====================================================================================
  // 3c. Thematic (Part 12)
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp;
    APP.reset();
    S.BiyaPuzzleThematic.setSelected(null);

    let view = makeNode('div');
    let started = null, exited = false;
    S.BiyaPuzzleThematic.renderGrid(view, (t) => { started = t; }, () => { exited = true; });
    let root = view.children[0];
    eq(textOf(root, 'pzt-title')[0], MET.STR.thematicTitle, 'the grid title');
    eq(textOf(root, 'pzt-badge')[0], MET.STR.thematicBadge, 'the themed-training badge');
    eq(textOf(root, 'pzt-section')[0], MET.STR.thematicChoose, 'the section label');
    const cards = byClass(root, 'pzt-card');
    eq(cards.length, 12, 'twelve theme cards — 3 columns x 4 rows');
    eq(textOf(root, 'pzt-card').join('|'), MET.THEMES.map(t => t.label).join('|'),
       'their labels, in the source order and with their code points intact');
    let bordersOk = true;
    cards.forEach((c, i) => { if (c.style.borderColor !== MET.THEMES[i].color) bordersOk = false; });
    expect(bordersOk, 'each card is bordered in its own theme colour');
    eq(byClass(root, 'pzt-lock').length, 0, 'no lock overlay — the premium gate is deleted');
    eq(textOf(root, 'pzt-start')[0], MET.STR.thematicSelectPrompt, 'Start reads "Select a Theme"');
    expect(byClass(root, 'pzt-start')[0].classList.contains('pzt-start-off'), 'and is disabled');
    byClass(root, 'pzt-start')[0].onclick();
    eq(started, null, 'tapping it does nothing');

    cards[3].onclick();
    root = view.children[0];
    eq(S.BiyaPuzzleThematic.selectedTheme(), MET.THEMES[3].id, 'the fourth card selects');
    eq(textOf(root, 'pzt-start')[0], MET.STR.thematicStart(MET.THEMES[3].label),
       'and the button names the chosen theme');
    expect(!byClass(root, 'pzt-start')[0].classList.contains('pzt-start-off'), 'and is enabled');
    eq(byClass(root, 'pzt-card')[3].style.background, MET.THEMES[3].color,
       'the selected card fills with its colour');
    byClass(root, 'pzt-card')[3].onclick();
    eq(S.BiyaPuzzleThematic.selectedTheme(), null, 'tapping the selected card deselects it');
    byClass(view.children[0], 'pzt-card')[5].onclick();
    byClass(view.children[0], 'pzt-start')[0].onclick();
    eq(started, MET.THEMES[5].id, 'Start hands the chosen theme to the solver');
    byClass(view.children[0], 'pzd-back')[0].onclick();
    expect(exited, 'back exits the grid');

    // The solver.
    view = makeNode('div');
    S.BiyaPuzzleThematic.renderSolver(view, 'fork', () => {});
    root = view.children[0];
    const forkLabel = MET.THEMES.filter(t => t.id === 'fork')[0].label;
    eq(textOf(root, 'pzts-title')[0], forkLabel, 'the solver titles with the theme label');
    eq(textOf(root, 'pzts-sub')[0], MET.STR.thematicSolved(0), 'and a session solve counter');
    eq(textOf(root, 'pzts-stat-label')[0], MET.STR.thematicRating, 'one stat: Puzzle Rating');
    eq(byClass(root, 'pzts-stat').length, 1,
       'and only one — Thematic shows no player rating, because it never moves one');
    expect(Number(textOf(root, 'pzts-stat-value')[0]) > 0, 'showing the served rating');
    const hint = textOf(root, 'pzts-hint')[0];
    expect(hint === MET.STR.thematicHintWhite || hint === MET.STR.thematicHintBlack, 'a hint line');
    eq(byClass(root, 'pz-board').length, 1, 'a board band');

    // The rule that is one call away from being wrong.
    const before = APP.state().profile.rating;
    const attemptsBefore = APP.state().attempts.length;
    const tsrc = fs.readFileSync(path.join(JS, 'puzzle-thematic.js'), 'utf8');
    const tcode = tsrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(tcode.indexOf('recordRatedAttempt') < 0,
      'the thematic screen never calls recordRatedAttempt — Thematic must not touch Elo');
    expect(tcode.indexOf('recordThematicAttempt') > 0, 'it calls recordThematicAttempt instead');
    eq(APP.state().profile.rating, before, 'and serving a thematic puzzle moved no rating');
    eq(APP.state().attempts.length, attemptsBefore, 'and wrote no ledger row');
    S.BiyaPuzzleThematic.leave();
    APP.reset();
  }

  // =====================================================================================
  // 4. The solver's derived layer, on the real screen's own helpers
  // =====================================================================================
  {
    // The screen itself needs `chess-board`, a custom element this fake DOM does not implement,
    // so the render path is left to the browser. What IS checkable here is that every string and
    // state the screen draws comes from the metrics layer rather than from a literal in the file.
    const src = fs.readFileSync(path.join(JS, 'puzzle-solver.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No layout numbers in the screen: every `px` must come through a custom property.
    const pxLiterals = code.match(/:\s*\d+px/g) || [];
    eq(pxLiterals.length, 0, `no hard-coded px in the solver (found ${pxLiterals.join(',')})`);
    expect(code.indexOf('compareMoves') < 0, 'the solver never calls the buggy comparator');
    // Every user-facing string comes from MET.STR.
    for (const s of ['Solved', 'Wrong move', 'Next Puzzle', 'Retry', 'Loading puzzle']) {
      expect(code.indexOf("'" + s) < 0 && code.indexOf('"' + s) < 0,
        `"${s}" is not typed into the solver — it comes from MET.STR`);
    }
    // ...and the strings themselves are the spec's.
    eq(MET.STR.solved, '✅ Solved!', 'the solved string');
    eq(MET.STR.wrongMove, '❌ Wrong move!', 'the wrong string');
    eq(MET.STR.nextPuzzle, 'Next Puzzle →', 'the next string, with its arrow');
    eq(MET.STR.noTime, '--:--', 'the pre-clock placeholder');
  }


  // =====================================================================================
  // 3d. Puzzle Streak (Part 13)
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp;
    const PROG = S.BiyaPuzzleProgress;
    APP.reset();

    let view = makeNode('div');
    let started = false, exited = false;
    S.BiyaPuzzleStreak.renderHome(view, () => { started = true; }, () => { exited = true; });
    let root = view.children[0];
    eq(textOf(root, 'pzk-title')[0], MET.STR.streakTitle, 'the streak home title');
    eq(textOf(root, 'pzk-badge')[0], MET.STR.streakBadge, 'the streak badge');
    eq(textOf(root, 'pzk-number')[0], '0', 'the big counter starts at zero');
    eq(textOf(root, 'pzk-label')[0], MET.STR.streakCurrent, 'labelled Current Streak');
    eq(textOf(root, 'pzk-sub')[0], MET.STR.streakOneMistake, 'with the sudden-death warning');
    eq(byClass(root, 'pzk-stat').length, 3, 'three stat cards');
    eq(textOf(root, 'pzk-stat-label').join(','),
       [MET.STR.streakBest, MET.STR.streakCurrentShort, MET.STR.streakNoTimer].join(','),
       'Best / Current / No Timer');
    eq(textOf(root, 'pzk-stat-value')[2], '∞', 'and the third really is the infinity sign');
    eq(textOf(root, 'pzk-empty')[0], MET.STR.streakEmpty, 'an empty Recent Runs list at first');
    eq(textOf(root, 'pzk-start')[0], MET.STR.streakStart,
       'and Start reads plainly when no run is live');

    // With a live run the start button changes and the resume modal appears.
    PROG.recordStreakSolve(APP.state(), null, Date.now());
    view = makeNode('div');
    S.BiyaPuzzleStreak.renderHome(view, () => { started = true; }, () => {});
    root = view.children[0];
    eq(textOf(root, 'pzk-number')[0], '1', 'the counter tracks the live streak');
    eq(textOf(root, 'pzk-start')[0], MET.STR.streakResumeStart,
       'and Start offers Resume / New Streak');
    byClass(root, 'pzk-start')[0].onclick();
    eq(byClass(root, 'pz-modal-scrim').length, 1, 'clicking it raises the resume modal');
    eq(textOf(root, 'pz-modal-title')[0], MET.STR.streakResumeTitle, 'titled Resume Session?');
    expect(textOf(root, 'pz-modal-body')[0].indexOf('1') > 0, 'naming the streak so far');
    byClass(root, 'pz-modal-keep')[0].onclick();          // Continue
    expect(started, 'Continue starts the solver');
    eq(APP.state().streak.currentStreak, 1, 'and does NOT reset the streak');

    // Recent Runs shows a finished run.
    APP.reset();
    PROG.endStreakRun(APP.state(), 7, 0, Date.now());
    view = makeNode('div');
    S.BiyaPuzzleStreak.renderHome(view, () => {}, () => {});
    root = view.children[0];
    eq(byClass(root, 'pzk-row').length, 1, 'the finished run appears in Recent Runs');
    eq(textOf(root, 'pzk-row-score')[0], '🔥 7', 'with its length');
    eq(textOf(root, 'pzk-row-date')[0], 'Today', 'and a relative date');
    eq(textOf(root, 'pzk-row-trophy')[0], '🏆', 'flagged as the best, because it is');

    // --- the solver ---
    APP.reset();
    view = makeNode('div');
    S.BiyaPuzzleStreak.renderSolver(view, () => { exited = true; });
    root = view.children[0];
    eq(byClass(root, 'pz-board').length, 1, 'the solver has a board band');
    eq(textOf(root, 'pzks-counter')[0], '🔥 0', 'a live counter');
    eq(textOf(root, 'pzks-stat-label').join(','),
       [MET.STR.streakStatStreak, MET.STR.streakStatBest].join(','), 'two stats');
    const shint = textOf(root, 'pzks-hint')[0];
    expect(shint === MET.STR.streakHint(true) || shint === MET.STR.streakHint(false),
      'and a hint line naming the side');

    // Part 22.6, the acceptance criterion: entering twice must hand back the SAME puzzle.
    const lockedId = PROG.pendingStreakPuzzle(APP.state());
    expect(lockedId != null, 'serving a streak puzzle takes the pending lock');
    S.BiyaPuzzleStreak.leave();
    view = makeNode('div');
    S.BiyaPuzzleStreak.renderSolver(view, () => {});
    eq(PROG.pendingStreakPuzzle(APP.state()), lockedId,
       're-entering the solver hands back the identical puzzle — no rerolling a hard one');
    S.BiyaPuzzleStreak.leave();

    // The `E2 → E4` formatting, including the promotion suffix.
    eq(S.BiyaPuzzleStreak.formatSolutionMove('e2e4'), 'E2 → E4', 'the solution move format');
    eq(S.BiyaPuzzleStreak.formatSolutionMove('a7a8q'), 'A7 → A8 (=Q)', 'and its promotion suffix');
    eq(S.BiyaPuzzleStreak.formatSolutionMove(null), '', 'nothing to show is empty, not "undefined"');

    // No sound on a correct solve is a deliberate choice, so it gets an assertion.
    const ksrc = fs.readFileSync(path.join(JS, 'puzzle-streak.js'), 'utf8');
    const onSolvedBody = ksrc.slice(ksrc.indexOf('function onSolved'),
                                    ksrc.indexOf('function onWrong'));
    expect(!/play\(/.test(onSolvedBody),
      'a correct streak solve plays NO sound — the reward is the next puzzle');
    expect(/play\('game-over'\)/.test(ksrc.slice(ksrc.indexOf('function onWrong'))),
      'but failing one does play game-over');
    // The bestBefore fix: the screen must capture the best at run START.
    expect(/bestBefore = st\.streak\.bestStreak/.test(ksrc),
      'the run captures the best as it stood when it started');
    expect(/endStreakRun\([^)]*bestBefore/.test(ksrc),
      'and hands THAT to endStreakRun, so the new-best badge can actually fire');
    APP.reset();
  }

  // =====================================================================================
  // 3e. Puzzle Turbo (Part 14)
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp;
    const PROG = S.BiyaPuzzleProgress;
    const TR = S.BiyaTurboRun;
    APP.reset();
    S.BiyaPuzzleTurbo.setSelectedMode(MET.TURBO_DEFAULT_MODE);

    let view = makeNode('div');
    let launched = null, exited = false;
    S.BiyaPuzzleTurbo.renderHome(view, (m, d) => { launched = { m, d }; },
                                 () => { exited = true; });
    let root = view.children[0];
    eq(textOf(root, 'pzr-title')[0], MET.STR.turboTitle, 'the turbo home title');
    eq(textOf(root, 'pzr-badge')[0], MET.STR.turboBadge, 'the rush badge');
    eq(textOf(root, 'pzr-info-text')[0], MET.STR.turboInfo, 'the info line');
    eq(textOf(root, 'pzr-mistake-badge')[0], MET.STR.turboMistakes, 'and the 3-mistake warning');
    eq(byClass(root, 'pzr-tab').length, 3, 'three mode tabs');
    eq(textOf(root, 'pzr-tab-text').join(','),
       MET.TURBO_MODES.map(m => m.label).join(','), 'infinite, 3 and 5');
    eq(byClass(root, 'pzr-tab').filter(n => n.classList.contains('on')).length, 1,
       'exactly one is selected');
    eq(byClass(root, 'pzr-tab')[1].classList.contains('on'),
       true, 'and it is the 3-minute one by default — not infinite');
    eq(textOf(root, 'pzr-start')[0], MET.STR.turboStart(3), 'the start button names the mode');
    eq(textOf(root, 'pzr-empty')[0], MET.STR.turboEmpty, 'no runs yet');

    // Recent Runs is filtered BY TAB — a 3-minute run must not show under 5 minutes.
    PROG.endRushRun(APP.state(), 3, 11, 1, 'timeUp', Date.now());
    PROG.endRushRun(APP.state(), 5, 22, 0, 'timeUp', Date.now());
    view = makeNode('div');
    S.BiyaPuzzleTurbo.renderHome(view, (m, d) => { launched = { m, d }; }, () => {});
    root = view.children[0];
    eq(byClass(root, 'pzr-row').length, 1, 'only the selected mode`s runs are listed');
    eq(textOf(root, 'pzr-row-score')[0], '⚡ 11', 'the 3-minute run');
    eq(textOf(root, 'pzr-tab-best')[1], MET.STR.turboBest(11), 'each tab carries its own best');
    eq(textOf(root, 'pzr-tab-best')[2], MET.STR.turboBest(22), 'and they differ');
    byClass(root, 'pzr-tab')[2].onclick();                       // switch to 5 min
    eq(textOf(root, 'pzr-row-score')[0], '⚡ 22', 'switching tabs re-filters the list');
    eq(textOf(root, 'pzr-start')[0], MET.STR.turboStart(5), 'and re-labels Start');

    // The resume prompt is infinite-only.
    byClass(root, 'pzr-tab')[1].onclick();                       // back to 3 min
    PROG.saveRushDraft(APP.state(), { score: 9, mistakes: 2, targetRating: 900,
                                      puzzlesServed: 11 }, Date.now());
    byClass(root, 'pzr-start')[0].onclick();
    eq(byClass(root, 'pz-modal-scrim').length, 0,
       'a timed mode never offers to resume, even with a draft sitting there');
    expect(launched && launched.m === 3 && launched.d == null, 'it just starts');
    launched = null;
    byClass(root, 'pzr-tab')[0].onclick();                       // infinite
    byClass(root, 'pzr-start')[0].onclick();
    eq(byClass(root, 'pz-modal-scrim').length, 1, 'infinite DOES offer it');
    expect(textOf(root, 'pz-modal-body')[0].indexOf('9') > 0, 'naming the score');
    byClass(root, 'pz-modal-keep')[0].onclick();                 // Resume
    expect(launched && launched.m === 0 && launched.d && launched.d.score === 9,
      'and Resume hands the draft to the run');

    // --- the run ---
    APP.reset();
    view = makeNode('div');
    S.BiyaPuzzleTurbo.renderRun(view, 3, null, () => { exited = true; });
    root = view.children[0];
    eq(byClass(root, 'pz-board').length, 1, 'the run has a board band');
    expect(byClass(root, 'pzrr-board')[0].classList.contains('pzrr-board'),
      'whose container is the positioning context for the feedback dot');
    eq(textOf(root, 'pzrr-timer')[0], '3:00', 'the clock starts at 3:00, minutes unpadded');
    eq(byClass(root, 'pzrr-dot').length, 3, 'three life dots');
    eq(byClass(root, 'pzrr-dot').filter(n => n.classList.contains('used')).length, 0,
       'none spent yet');
    eq(textOf(root, 'pzrr-stat-value')[0], '0', 'score starts at zero');
    eq(textOf(root, 'pzrr-stat-value')[1], '3 min', 'and the mode is named');

    // The quit modal, and fix #13: quitting still RECORDS the run.
    byClass(root, 'pzrr-quit')[0].onclick();
    eq(byClass(root, 'pzrr-scrim').length, 1, 'Quit raises a confirmation');
    eq(textOf(root, 'pzrr-modal-title')[0], MET.STR.turboQuitTitle, 'titled Quit Puzzle Turbo?');
    byClass(root, 'pzrr-keep')[0].onclick();
    eq(byClass(root, 'pzrr-scrim').length, 0, 'Keep Playing dismisses it');
    eq(PROG.recentRushRuns(APP.state(), 3).length, 0, 'and records nothing');
    byClass(root, 'pzrr-quit')[0].onclick();
    byClass(root, 'pzrr-quit-btn')[0].onclick();
    eq(byClass(root, 'pzrr-finished').length, 1,
       'confirming it swaps the run screen for the results, in place');
    eq(textOf(root, 'pzrr-fin-title')[0], TR.resultTitle('quit', false),
       'whose title is NOT hardcoded to Time`s Up!');
    eq(textOf(root, 'pzrr-fin-label')[0], MET.STR.turboSolved, 'over the solved count');
    eq(PROG.recentRushRuns(APP.state(), 3).length, 0,
       'a run quit at zero is still not written to history — the same rule endStreakRun applies');
    S.BiyaPuzzleTurbo.leave();

    // Fix #13 proper: a quit with a SCORE on the board must be recorded. Driven through the real
    // screen by resuming a draft, because that is the only way to reach the quit button with a
    // non-zero score without solving puzzles in a headless DOM.
    APP.reset();
    view = makeNode('div');
    S.BiyaPuzzleTurbo.renderRun(view, 0, { score: 9, mistakes: 2, targetRating: 900,
                                           puzzlesServed: 11 }, () => {});
    root = view.children[0];
    eq(textOf(root, 'pzrr-stat-value')[0], '9', 'the resumed score is on screen');
    eq(textOf(root, 'pzrr-timer')[0], '∞', 'and infinite mode shows no clock');
    eq(byClass(root, 'pzrr-dot').filter(n => n.classList.contains('used')).length, 2,
       'with two lives already spent');
    byClass(root, 'pzrr-quit')[0].onclick();
    byClass(root, 'pzrr-quit-btn')[0].onclick();
    eq(PROG.recentRushRuns(APP.state(), 0).length, 1,
       'quitting a scored run DOES record it — the original recorded nothing');
    eq(PROG.recentRushRuns(APP.state(), 0)[0].reason, 'quit', 'with the real reason');
    eq(PROG.recentRushRuns(APP.state(), 0)[0].score, 9, 'and the real score');
    eq(PROG.rushBestFor(APP.state(), 0), 9, 'which also becomes the mode`s best');
    eq(PROG.loadRushDraft(APP.state(), Date.now()), null, 'and the draft is cleared');
    root = view.children[0];
    eq(textOf(root, 'pzrr-fin-title')[0], TR.resultTitle('quit', true),
       'the results title reflects the new best');
    S.BiyaPuzzleTurbo.leave();

    // Leaving mid-run: Part 14.5's split, both halves.
    APP.reset();
    view = makeNode('div');
    S.BiyaPuzzleTurbo.renderRun(view, 0, { score: 4, mistakes: 0, targetRating: 800,
                                           puzzlesServed: 5 }, () => {});
    S.BiyaPuzzleTurbo.leave();
    const kept = PROG.loadRushDraft(APP.state(), Date.now());
    expect(kept && kept.score === 4, 'leaving an INFINITE run saves a resumable draft');
    eq(PROG.recentRushRuns(APP.state(), 0).length, 0, 'and does not end it');
    APP.reset();
    view = makeNode('div');
    S.BiyaPuzzleTurbo.renderRun(view, 3, null, () => {});
    S.BiyaPuzzleTurbo.leave();
    eq(PROG.loadRushDraft(APP.state(), Date.now()), null,
       'leaving a TIMED run saves no draft — a paused clock would be meaningless');
    S.BiyaPuzzleTurbo.leave();

    // Every exit routes through endRushRun — checked in the source, because a second exit path
    // is exactly how the original ended up recording nothing on a quit.
    const tsrc = fs.readFileSync(path.join(JS, 'puzzle-turbo.js'), 'utf8');
    eq((tsrc.match(/PROG\.endRushRun\(/g) || []).length, 1,
       'there is exactly ONE call to endRushRun in the whole screen');
    expect(/function finish\(reason\)/.test(tsrc), 'inside finish(reason)');
    expect(/if \(!run \|\| TR\.isOver\(run\)\) return;/.test(tsrc),
      'which refuses to run twice, so a clock expiry plus a navigation writes one row, not two');
    // Part 7.6: no prefetch buffer reached the screen.
    for (const banned of ['BUFFER_MAX', 'BUFFER_REFILL', 'BUFFER_PARALLEL']) {
      expect(tsrc.indexOf(banned) < 0, `no ${banned} — Turbo keeps one lookahead, not a buffer`);
    }
    APP.reset();
  }

  // =====================================================================================
  // 3f. Part 22.2 — the whole feature is offline, and that is checked, not assumed
  // =====================================================================================
  {
    // The RN source this was ported from still calls chess.com and lichess. None of that may have
    // survived the port, so every screen file is scanned rather than spot-checked.
    const FEATURE = ['puzzle-serving.js', 'puzzle-session.js', 'puzzle-store.js',
                     'puzzle-progress.js', 'puzzle-metrics.js', 'puzzle-stats.js',
                     'puzzle-app.js', 'puzzle-hub.js', 'puzzle-home.js', 'puzzle-solver.js',
                     'puzzle-board.js', 'puzzle-daily.js', 'puzzle-thematic.js',
                     'puzzle-streak.js', 'puzzle-turbo.js', 'turbo-run.js', 'streak-engine.js'];
    const BANNED = [/https?:\/\//, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/,
                    /lichess/i, /chess\.com/i, /chesscom/i, /api\./i, /EventSource/];
    for (const f of FEATURE) {
      const src = fs.readFileSync(path.join(JS, f), 'utf8');
      // Two exclusions, both principled:
      //  * comments may legitimately name what was REMOVED, so only code is scanned;
      //  * `createElementNS` needs the SVG namespace URI, which is an XML identifier and not an
      //    address — nothing fetches it. Dropping the whole `http` rule to accommodate it would
      //    gut the check, so the one literal is excluded by name.
      // `puzzle-metrics.js` is scanned only up to its self-test, which deliberately quotes the RN
      // source's `api.chess.com` in order to PROVE the port dropped it (Part 11.3). Asserting a
      // URL is absent is not the same as calling it.
      let code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
                    .split('http://www.w3.org/2000/svg').join('<svg-ns>');
      const cut = code.indexOf('function selfTestSource');
      if (cut > 0) code = code.slice(0, cut);
      for (const re of BANNED) {
        expect(!re.test(code), `${f} contains no ${re} — the hub is 100% offline`);
      }
    }
  }


  // =====================================================================================
  // 3g. Every `--pz*` custom property the puzzle screens read is actually written
  //
  // There is no compiler here and no browser in this gate, so a `var(--pzk-typo)` with no setter
  // is invisible: it resolves to nothing and the rule silently falls back to the initial value.
  // A screen can look finished and be laid out entirely by accident.
  //
  // Scoped to the `--pz*` namespace on purpose — the analysis board and home screen own their own
  // prefixes and their own checks. Both directions are tested: an unread var is drift left behind
  // by a rename, which is how a screen ends up half-styled by a stale name.
  // =====================================================================================
  {
    const css = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
    const jsFiles = fs.readdirSync(JS).filter(f => f.endsWith('.js'));
    const isPz = v => /^--pz/.test(v);

    const setters = new Set();
    let readInJs = new Set();
    for (const f of jsFiles) {
      const src = fs.readFileSync(path.join(JS, f), 'utf8');
      for (const m of src.matchAll(/(?:set|setProperty)\('(--[a-z0-9-]+)'/g)) setters.add(m[1]);
      // Components like <chess-board> carry their own stylesheet as a JS string, so a var can be
      // read somewhere app.css never sees.
      for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) readInJs.add(m[1]);
    }
    const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(m => m[1]));
    const readInCss = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map(m => m[1]));

    const unset = [...readInCss].filter(v => isPz(v) && !setters.has(v) && !declared.has(v));
    eq(unset.join(', '), '', 'every --pz* var the stylesheet reads is written by a screen');

    // EMPTY, and it should stay that way.
    //
    // It held thirteen entries at the end of Phase E and seven after Phase F. The last seven were
    // the promotion dialog's, closed in Phase G by rebuilding <chess-board>'s dialog to the two
    // layouts the source actually has — a row of unlabelled tiles for the Analysis Board, a list
    // of labelled accent rows for the puzzle hub — and routing all nine properties through one
    // `PuzzleMetrics.applyPromotion` instead of five partial copies.
    //
    // Anything appearing here now is new drift, not inherited debt.
    const KNOWN_UNREAD = new Set([]);
    const dead = [...setters].filter(v => isPz(v) && !readInCss.has(v) && !readInJs.has(v)
                                          && !declared.has(v) && !KNOWN_UNREAD.has(v));
    eq(dead.join(', '), '', 'and every --pz* var a screen writes is read by something');
    // The allowlist must not rot into a place things hide: an entry that becomes read, or that
    // stops being set at all, has to be deleted from it.
    const stale = [...KNOWN_UNREAD].filter(v => !setters.has(v) || readInCss.has(v)
                                                || readInJs.has(v));
    eq(stale.join(', '), '', 'and the allowlist has no stale entries');

    const checked = [...readInCss].filter(isPz).length;
    expect(checked > 400, `${checked} --pz* custom properties checked — not vacuous`);
  }

  // =====================================================================================
  // 3h. The sound layer is actually CONNECTED (Part 16)
  //
  // For all of phases B-E every puzzle screen did `typeof Sound !== 'undefined' ? Sound : null`.
  // The global sound.js exports is `SoundManager`; `Sound` has never existed. So `SND` was
  // permanently null and not one of the five modes ever made a sound — through a hub that has
  // 22,000 passing assertions.
  //
  // Nothing caught it because every existing test asserted that the sound CODE RUNS. It did run;
  // it ran into a null. So these assertions are deliberately end-to-end: patch the real player,
  // drive a real screen, and require that a sound came out the other side.
  // =====================================================================================
  {
    const APP = S.BiyaPuzzleApp;
    APP.reset();

    expect(typeof S.SoundManager === 'object' && S.SoundManager !== null,
      'sound.js exports a SoundManager global');
    expect(typeof S.Sound === 'undefined',
      'and there is NO global called `Sound` — the name five screens reached for');

    // Record what actually reaches the player.
    const played = [];
    const realPlay = S.SoundManager.play;
    S.SoundManager.play = (name) => { played.push(name); };
    try {
      // Mounting any solver plays game-start synchronously, before its opponent-reply timer.
      let view = makeNode('div');
      S.BiyaPuzzleStreak.renderSolver(view, () => {});
      eq(played.join(','), 'game-start',
        'mounting the Streak solver really does reach the player');
      S.BiyaPuzzleStreak.leave();

      played.length = 0;
      view = makeNode('div');
      S.BiyaPuzzleTurbo.renderRun(view, 3, null, () => {});
      eq(played.join(','), 'game-start', 'and so does starting a Turbo run');
      // Turbo's quit path ends the run, which is where its one chime belongs.
      played.length = 0;
      byClass(view.children[0], 'pzrr-quit')[0].onclick();
      byClass(view.children[0], 'pzrr-quit-btn')[0].onclick();
      eq(played.join(','), 'game-over', 'and ending a run chimes exactly once');
      S.BiyaPuzzleTurbo.leave();

      played.length = 0;
      view = makeNode('div');
      S.BiyaPuzzleDaily.renderSolver(view, () => {});
      eq(played.join(','), 'game-start', 'and mounting the Daily solver');
      S.BiyaPuzzleDaily.leave();
    } finally {
      S.SoundManager.play = realPlay;
    }
    APP.reset();
  }

  // =====================================================================================
  // 3i. Every sound a screen asks for is one of the four that exist
  //
  // `SoundManager.play` looks up the name and returns silently if it misses, so an invented name
  // is indistinguishable from a quiet moment. Turbo shipped `play('puzzle-correct')` for exactly
  // this reason. The four keys come from the extraction, not from a list written here.
  // =====================================================================================
  {
    const SND_FILES = Object.values(MET.SOUNDS.file);
    eq(SND_FILES.length, 4, 'four sounds, from hooks/usePuzzleSound.ts');
    const SCREENS = ['puzzle-solver.js', 'puzzle-daily.js', 'puzzle-thematic.js',
                     'puzzle-streak.js', 'puzzle-turbo.js', 'puzzle-board.js',
                     'puzzle-session.js'];
    let names = 0;
    for (const f of SCREENS) {
      const src = fs.readFileSync(path.join(JS, f), 'utf8');
      for (const m of src.matchAll(/(?:play|sound)\(\s*'([a-z][a-z-]*)'\s*\)/g)) {
        expect(MET.isRealSound(m[1]), `${f} plays '${m[1]}', which is a real sound`);
        names += 1;
      }
      // The session emits names as data rather than calling a player.
      for (const m of src.matchAll(/sound: '([a-z][a-z-]*)'/g)) {
        expect(MET.isRealSound(m[1]), `${f} emits sound '${m[1]}', which is real`);
        names += 1;
      }
    }
    expect(names >= 8, `${names} sound names checked — not vacuous`);

    // <chess-board> is standalone and imports nothing, so it keeps its own copies of the two
    // promotion titles as fallbacks. That duplication is fine only while it is asserted.
    const cb = fs.readFileSync(path.join(JS, 'chess-board.js'), 'utf8');
    expect(cb.includes("'" + MET.STR.promotionTitle + "'"),
      "the board component's list-layout title matches PuzzleStrings.promotionTitle");
    expect(cb.includes("'Promote to:'"),
      "and its row-layout title is the Analysis Board's, which is a different string");

    // WHICH modes chime on a correct solve. Reaching the solve path in a headless DOM needs the
    // mount timer to fire and this suite is synchronous, so — like the Streak assertion above —
    // these read the decision out of the source. The per-mode table itself is checked against the
    // extraction in `PuzzleMetricsSource`; this checks the screens agree with the table.
    const ratedSrc = fs.readFileSync(path.join(JS, 'puzzle-solver.js'), 'utf8');
    expect(/if \(correct\) play\('game-over'\);/.test(ratedSrc),
      'the rated solver chimes on a correct solve, matching play-puzzle/index.tsx:778');
    expect(MET.SOUNDS.chimeOnSolve.play, 'and the table says so');

    const dailySrc = fs.readFileSync(path.join(JS, 'puzzle-daily.js'), 'utf8');
    const dailyFinish = dailySrc.slice(dailySrc.indexOf('function finish()'),
                                       dailySrc.indexOf('function paint()'));
    expect(/play\('game-over'\)/.test(dailyFinish),
      'Daily chimes inside finish(), matching its own finishPuzzle()');

    const turboSrc = fs.readFileSync(path.join(JS, 'puzzle-turbo.js'), 'utf8');
    const turboSolved = turboSrc.slice(turboSrc.indexOf('function onSolved'),
                                       turboSrc.indexOf('function onWrong'));
    expect(!/play\(/.test(turboSolved),
      'Turbo does NOT chime on a solve — its only gameOver is the run ending');
    expect(!MET.SOUNDS.chimeOnSolve.turbo && MET.SOUNDS.chimeOnRunEnd.turbo,
      'which is what the table says');
    expect(/play\('game-over'\)/.test(turboSrc.slice(turboSrc.indexOf('function finish('))),
      'and it does chime when the run ends');
    // The two sounds the puzzle path deliberately does NOT use, though both files ship.
    for (const f of SCREENS) {
      const src = fs.readFileSync(path.join(JS, f), 'utf8')
                    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(!/'(check|castling)'/.test(src),
        `${f} uses no check or castle sound — that chain is the Play screen's, not the hub's`);
    }
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `PuzzleScreens: ${passed} assertions passed`
      : `PuzzleScreens: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
