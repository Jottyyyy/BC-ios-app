#!/usr/bin/env node
/*
 * coach_screen_test.js — the three Play vs Coach screens, rendered into a headless DOM.
 *
 *     node tools/qa/coach_screen_test.js
 *
 * Sibling of `pairing_screen_test.js`, and the same argument for existing: the module suites prove
 * the logic, and would all stay green for a screen that throws on its first paint or wires a button
 * to nothing.
 *
 * This one is written BEFORE `web-demo/css/coach.css` on purpose. For the Pairing Manager the
 * stylesheet came first and this audit then rejected three variables that had been invented — cheap
 * to fix because the audit existed. CSS is the one file in the pipeline where a mistake is
 * invisible: an undefined custom property does not error, it renders as nothing. So the check goes
 * in first and the stylesheet is written against a live gate.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const CSS = path.join(ROOT, 'web-demo', 'css', 'coach.css');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- The fake DOM ------------------------------------------------------------------------------

function makeNode(tag, ns) {
  const n = {
    _on: {},
    tagName: String(tag).toUpperCase(), ns: ns || null,
    children: [], parentNode: null, attrs: {}, _text: '',
    value: '', type: '', disabled: false, scrollTop: 0, flipped: false, rules: null,
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
    focus() {}, closest() { return null; },
    // <chess-board> stubs. These are not free-form: they hold the REAL component's contract,
    // because every way of getting it wrong fails silently in a browser and invisibly here. The
    // first version of the game screen got all five wrong at once and this suite stayed green.
    setPosition(fen) { this._fen = fen; },
    getPosition() { return this._fen; },
    // `_cellBySq` is keyed by NUMERIC square index; algebraic strings highlight nothing.
    highlightLastMove(a, b) {
      if (a !== null && (typeof a !== 'number' || typeof b !== 'number')) {
        throw new Error('highlightLastMove takes numeric square indexes, got '
                        + JSON.stringify([a, b]));
      }
      this._hl = [a, b];
    },
    setCheck() {}, clearSelection() {},
    /** Fire the component's own `'move'` event, with the detail shape it really emits. */
    emitMove(uci) {
      const sq = (n) => (n.charCodeAt(0) - 97) + (Number(n[1]) - 1) * 8;
      const detail = { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)),
                       promotion: uci[4] ? 'nbrq'.indexOf(uci[4]) + 1 : null, uci: uci };
      (this._on.move || []).forEach(fn => fn({ detail }));
      return (this._on.move || []).length;
    },
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

const makeDom = () => ({
  createElement: (t) => makeNode(t),
  createElementNS: (ns, t) => makeNode(t, ns),
});

function walk(node, out) {
  out = out || [];
  out.push(node);
  node.children.forEach(c => walk(c, out));
  return out;
}
const byClass = (root, cls) => walk(root).filter(n => n.classList.contains(cls));
const textOf = (root, cls) => byClass(root, cls).map(n => n.textContent);
const first = (root, cls) => byClass(root, cls)[0];

// ---- The sandbox -------------------------------------------------------------------------------

function loadSandbox() {
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const need = ['icons.js', 'engine.js', 'ai.js', 'rating.js', 'movetree.js',
                'analysis-eval.js', 'analysis-engine.js',
                'review.js', 'analysis-metrics.js',
                'coach-engine.js', 'coach-book.js', 'coach-game.js',
                'coach-metrics.js', 'coach-strings.js', 'coach-turn.js',
                'coach-review.js', 'coach-select.js', 'coach-color.js',
                'coach-play.js'];
  for (const f of need) expect(order.includes(f), `index.html loads js/${f}`);
  // The order the browser will actually use, asserted rather than assumed.
  expect(order.indexOf('coach-game.js') < order.indexOf('coach-turn.js'),
         'coach-game loads before coach-turn, which reads it');
  expect(order.indexOf('coach-turn.js') < order.indexOf('coach-play.js'),
         'and coach-turn before coach-play');
  expect(order.indexOf('coach-strings.js') < order.indexOf('coach-select.js'),
         'strings load before the screens that read them');
  expect(order.indexOf('coach-play.js') < order.indexOf('app.js'),
         'and every screen before app.js');
  expect(order.indexOf('review.js') < order.indexOf('coach-review.js'),
         'the review maths loads before the adapter over it');
  expect(order.indexOf('analysis-metrics.js') < order.indexOf('coach-review.js'),
         'and so does the shared classification table the adapter delegates to');
  expect(order.indexOf('coach-review.js') < order.indexOf('coach-play.js'),
         'and the adapter before the screen that opens its modal');

  const files = order.filter(f => need.includes(f));
  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, isFinite,
    parseInt, parseFloat, navigator: { share: null, clipboard: null },
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
  passed++;                       // every script loaded, in the page's own order
  return sandbox;
}

/**
 * The wiring in `app.js`, read as source.
 *
 * Everything above proves the screens work when a host drives them correctly. This proves the host
 * exists and drives them — the gap the Pairing Manager only ever closed by eye. It is a source
 * audit rather than an execution because `app.js` is a closure over a dozen browser globals and the
 * whole puzzle stack; running it here would mean stubbing more than it tests.
 *
 * What it cannot see is behaviour, so it checks the two things that go wrong silently: a route that
 * renders nothing, and a screen handed fewer callbacks than it offers.
 */
function auditAppWiring() {
  const src = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');

  expect(/current === 'coach-color'\) renderCoachColor\(\)/.test(src),
         'app.js routes coach-color');
  expect(/current === 'coach-game'\) renderCoachGame\(\)/.test(src),
         'app.js routes coach-game');
  expect(/function renderPlay\(\)[\s\S]{0,200}BiyaCoachSelect\.render/.test(src),
         'the Play tab renders Coach Select');
  expect(/renderCoachColor[\s\S]{0,300}BiyaCoachColor\.render/.test(src),
         'and the colour route renders Colour Select');
  expect(/renderCoachGame[\s\S]{0,300}BiyaCoachPlay\.render/.test(src),
         'and the game route renders the game');

  // Every callback the game screen offers has to be supplied, or a control is wired to nothing.
  const play = fs.readFileSync(path.join(JS, 'coach-play.js'), 'utf8');
  const offered = [...play.matchAll(/cb\.(on[A-Z]\w+)/g)].map(m => m[1]);
  const uniq = [...new Set(offered)].sort();
  expect(uniq.length >= 6, `the game screen offers ${uniq.length} callbacks — expected at least 6`);
  // The game screen and the review modal are two render calls in app.js, so both blocks count —
  // scoping to the first one is how `onStartReview` looked unwired when it was not.
  const blockAt = (name) => {
    const at = src.indexOf('function ' + name);
    return at < 0 ? '' : src.slice(at, at + 1200);
  };
  const block = blockAt('renderCoachGame') + blockAt('coachDrawReviewModal');
  const unwired = uniq.filter(k => !block.includes(k + ':'));
  eq(unwired.join(', '), '', 'every callback the game screen offers is passed by app.js');
  // This used to assert the OPPOSITE — that `onReview` was deliberately unwired while spec 2.10
  // did not exist. It exists now, so the assertion is inverted rather than deleted: the reminder
  // did its job.
  expect(uniq.includes('onReview') && block.includes('onReview:'),
         'onReview is wired now that spec 2.10 is built');
  expect(/BiyaCoachReview\.handoff/.test(src),
         'and the hand-off goes through `handoff`, which cannot produce an empty array (§7 #28)');
  expect(/loadReviewedGame\(payload\)/.test(src),
         'and reaches the Analysis Board with its payload');

  // Leaving by the tab bar must cancel the reply in flight (spec 7 #25/#26).
  expect(/leaveCurrentPuzzle[\s\S]{0,300}coach-game'\) coachLeave\(\)/.test(src),
         'the tab bar cancels an in-flight coach reply');
  // Every asynchronous continuation is guarded by the generation token.
  expect(/if \(!T\.accepts\(coachTab\.ctl, token\)\) return;/.test(src),
         'the search result is dropped unless its token still matches');
  expect(/if \(!T\.settle\(coachTab\.ctl, token\)\) return;/.test(src),
         'and so is the paced reply behind the timer');

  // The sample Play tab this replaced is gone, not merely unreachable.
  expect(!/function renderGame\(/.test(src), 'the retired sample game screen is deleted');
  expect(!/play\.passAndPlay/.test(src), 'and its pass-and-play state with it');
  expect(!/function strengthPct\(/.test(src), 'and the helpers only it used');
}

// ---- The suite ----------------------------------------------------------------------------------

function run() {
  passed = 0; failures.length = 0;
  const S = loadSandbox();
  if (!S) return finish();

  auditAppWiring();

  const STR = S.BiyaCoachStrings.STR;
  const GAME = S.BiyaCoachGame;
  const TURN = S.BiyaCoachTurn;
  const coach = { level: 2, name: 'Jade', winMsg: 'I win', loseMsg: 'You win' };

  // ── Coach Select ────────────────────────────────────────────────────────────
  {
    const view = makeNode('div');
    let picked = null, exited = false;
    S.BiyaCoachSelect.render(view, {
      onPick: (lv) => { picked = lv; },
      onExit: () => { exited = true; },
    });
    const root = view.children[0];
    expect(root.classList.contains('cgs-view'), 'the select screen mounts');
    eq(textOf(root, 'cgs-title')[0], STR.selectHeader, 'the header');
    eq(byClass(root, 'cgs-card').length, 5, 'five coach cards');
    eq(textOf(root, 'cgs-name').join('|'),
       'Jaden Pogi|Pretty Jade|Handsome Jude|Mommy Julie|Coach Pogi',
       'the five names, in order');
    // The ELO badge shows the rating, not the level.
    expect(textOf(root, 'cgs-elo')[0].indexOf('800') > 0, 'the first card shows its rating');
    byClass(root, 'cgs-card')[2].onclick();
    eq(picked, 3, 'tapping the third card picks level 3');
    first(root, 'cgs-back').onclick();
    expect(exited, 'back exits');

    // The metrics really reached the root as custom properties.
    expect(root.style.getPropertyValue('--cgs-container-background-color') != null,
           'the select screen pushes its extracted background');
  }

  // ── The take-back toggle persists (§7 #39) ──────────────────────────────────
  {
    const view = makeNode('div');
    S.BiyaCoachSelect.render(view, {});
    const sw = first(view.children[0], 'cgs-switch');
    expect(!sw.classList.contains('on'), 'the toggle starts off');
    sw.onclick();
    expect(sw.classList.contains('on'), 'tapping turns it on');
    // A fresh render is what a relaunch does — the setting must come back on.
    const view2 = makeNode('div');
    S.BiyaCoachSelect.render(view2, {});
    expect(first(view2.children[0], 'cgs-switch').classList.contains('on'),
           'and a fresh render still shows it on');
  }

  // ── Colour Select ───────────────────────────────────────────────────────────
  {
    const view = makeNode('div');
    let started = null;
    S.BiyaCoachColor.render(view, 3, 'Jade', { onStart: (s) => { started = s; } }, null, 1000);
    const root = view.children[0];
    eq(textOf(root, 'cgc-title')[0], STR.chooseSide, 'the colour header');
    eq(byClass(root, 'cgc-side').length, 2, 'two sides');
    eq(textOf(root, 'cgc-side-title').join('|'), STR.white + '|' + STR.black, 'White then Black');
    eq(byClass(root, 'cgc-unfinished').length, 0, 'no resume chip with no draft');
    byClass(root, 'cgc-side')[1].onclick();
    expect(started !== null, 'tapping a side starts a game');
    eq(started.userColor, 'b', 'as the colour tapped');
    eq(started.resume, false, 'and not a resume');
  }

  // ── The game screen ─────────────────────────────────────────────────────────
  {
    const g = GAME.newGame(3, 'w');
    GAME.record(g, 'e2e4');
    GAME.record(g, 'e7e5');
    GAME.record(g, 'g1f3');
    const ctl = TURN.create();
    const view = makeNode('div');
    let sought = 'unset', resigned = false;
    S.BiyaCoachPlay.render(view, g, ctl, coach, {
      onSeek: (i) => { sought = i; },
      onResign: () => { resigned = true; },
    });
    const root = view.children[0];
    expect(root.classList.contains('cgp-view'), 'the game screen mounts');
    eq(textOf(root, 'cgp-coach-name')[0], 'Jade', 'the coach is named');
    eq(textOf(root, 'cgp-status')[0], STR.live, 'and a live game says LIVE');

    // The board is a real element carrying the live position.
    const board = walk(root).filter(n => n.tagName === 'CHESS-BOARD')[0];
    expect(!!board, 'a chess-board is mounted');
    eq(board.getPosition(), GAME.liveFen(g), 'showing the live position');
    // The PROPERTY, not the attribute: the component reads `flipped` as attribute-truthy, so
    // `flipped="0"` would turn the board upside down for a White player.
    eq(board.flipped, false, 'unflipped for a White player');
    eq(board.getAttribute('flipped'), undefined, 'and set as a property, never as an attribute');
    // Without a rules adapter the component finds no legal target and nothing is selectable.
    expect(board.rules && typeof board.rules.legalMovesFrom === 'function',
           'the board is given a rules adapter, or no piece can be picked up');
    // 57 is b8 — Black's knight, and after 1.e4 e5 2.Nf3 it is Black to move. Asserting the side
    // to move matters: the adapter is what stops the user dragging the coach's pieces around.
    eq(board.rules.legalMovesFrom(GAME.liveFen(g), 57).length, 2,
       'the adapter answers with the real legal moves for the side to move');
    eq(board.rules.legalMovesFrom(GAME.liveFen(g), 1).length, 0,
       'and none for the side that is not');

    // The move arrives as the component's own event, carrying its own UCI. Assigning `.onmove`
    // would never fire, and `detail.from + detail.to` would be arithmetic. A fresh game, because
    // after 1.e4 e5 2.Nf3 it is the coach to move and the same tap is a PREMOVE.
    {
      const fresh = GAME.newGame(3, 'w');
      const fctl = TURN.create();
      const fview = makeNode('div');
      let played = null;
      S.BiyaCoachPlay.render(fview, fresh, fctl, coach, { onMove: (u) => { played = u; } });
      const live = walk(fview.children[0]).filter(n => n.tagName === 'CHESS-BOARD')[0];
      eq(live.emitMove('b1c3'), 1, 'exactly one move listener is attached');
      eq(played, 'b1c3', 'and it reports the UCI string, not a sum of square indexes');

      // The same tap while the coach is thinking queues a premove instead, in the algebraic form
      // `consumePremove` reassembles into a UCI string.
      const pview = makeNode('div');
      const pctl = TURN.create();
      TURN.begin(pctl);
      S.BiyaCoachPlay.render(pview, fresh, pctl, coach, { onMove: () => {} });
      const pboard = walk(pview.children[0]).filter(n => n.tagName === 'CHESS-BOARD')[0];
      pboard.emitMove('d2d4');
      eq(JSON.stringify(pctl.premove), '{"from":"d2","to":"d4","promotion":null}',
         'a tap while the coach thinks queues an algebraic premove');
    }

    // The move strip pairs correctly and every button seeks to its own move.
    eq(byClass(root, 'cgp-pair').length, 2, 'three half-moves make two pairs');
    eq(textOf(root, 'cgp-san').join(' '), 'e4 e5 Nf3', 'in order');
    byClass(root, 'cgp-san')[0].onclick();
    eq(sought, 1, 'tapping the first move seeks record 1, not 0');

    // Nav: ⏮ and ◀ agree, and the newest position offers nothing later (§7 #37).
    const nav = byClass(root, 'cgp-nav-btn');
    eq(nav[0].disabled, nav[1].disabled, 'the two back buttons share one disabled state');
    eq(nav[0].disabled, false, 'both live once moves exist');
    eq(nav[2].disabled, true, 'nothing later than the newest');

    // Resign asks rather than acting (§7 #24) — the screen raises it, the caller prompts.
    first(root, 'cgp-resign').onclick();
    expect(resigned, 'resign is raised to the caller, which prompts');
    const scrim = S.BiyaCoachPlay.resignPrompt(root, 'Jade', () => {});
    eq(textOf(root, 'pz-modal-title')[0], STR.resignTitle, 'and the prompt asks first');
    expect(textOf(root, 'pz-modal-body')[0].indexOf('Jade') === 0, 'naming the coach');
    scrim.remove();
  }

  // ── A finished game shows its result and no actions ─────────────────────────
  {
    const g = GAME.newGame(3, 'w');
    g.resigned = true;
    GAME.applyEvaluation(g, coach);
    const view = makeNode('div');
    S.BiyaCoachPlay.render(view, g, TURN.create(), coach, {});
    const root = view.children[0];
    eq(textOf(root, 'cgp-result-title')[0], STR.youLost, 'the result card names the outcome');
    eq(textOf(root, 'cgp-result-body')[0], g.result, 'and gives the reason');
    eq(byClass(root, 'cgp-resign').length, 0, 'a finished game offers no Resign');
    eq(byClass(root, 'cgp-rematch').length, 1, 'but does offer a rematch');
    // Review appears only when the host wired it — see `resultCard`.
    eq(byClass(root, 'cgp-review').length, 0, 'and no Review button without a handler for it');
    // The primary button wears the coach's own accent, inline, the way `play.tsx` does. The
    // stylesheet deliberately sets no background here, so a broken lookup would render the
    // button transparent rather than fail.
    {
      // A game with moves in it, because the button now also asks whether there is anything to
      // review — `g` here resigned on move zero.
      const played = GAME.newGame(3, 'w');
      GAME.record(played, 'e2e4');
      GAME.record(played, 'e7e5');
      played.resigned = true;
      GAME.applyEvaluation(played, coach);
      const rv = makeNode('div');
      S.BiyaCoachPlay.render(rv, played, TURN.create(), coach, { onReview: () => {} });
      eq(byClass(rv.children[0], 'cgp-review').length, 1, 'and one when the host provides it');
    }
    eq(first(root, 'cgp-rematch').style.getPropertyValue('background'),
       S.BiyaCoachMetrics.ACCENTS[coach.level], 'and it is the coach accent colour');
  }

  // ── The premove badge appears and can be cancelled (§7 #32) ─────────────────
  {
    const g = GAME.newGame(3, 'w');
    GAME.record(g, 'e2e4');
    const ctl = TURN.create();
    TURN.begin(ctl);
    TURN.setPremove(ctl, g, 'e7', 'e5', null);
    const view = makeNode('div');
    S.BiyaCoachPlay.render(view, g, ctl, coach, {});
    const root = view.children[0];
    eq(byClass(root, 'cgp-premove').length, 1, 'a queued premove shows a badge');
    eq(textOf(root, 'cgp-premove')[0], STR.premove('e7', 'e5'), 'reading the queued move');
    first(root, 'cgp-premove').onclick();
    eq(ctl.premove, null, 'and tapping it cancels');
  }

  // ── Every var the stylesheet reads is actually set ──────────────────────────
  //
  // The whole reason this file exists before `coach.css` does. Until the stylesheet lands there is
  // nothing to audit, so what is asserted instead is that the screens genuinely push variables —

  // ── The Game Review modal (spec 2.10) ───────────────────────────────────────
  {
    const RV = S.BiyaCoachReview;
    const g = GAME.newGame(3, 'w');
    ['e2e4', 'e7e5', 'g1f3', 'b8c6'].forEach((u) => GAME.record(g, u));

    // Running: a determinate bar, and the count the spec asks for.
    {
      const root = makeNode('div');
      let cancelled = false;
      S.BiyaCoachPlay.reviewModal(root, { running: true, done: 2, total: 5 },
                                  { onCancel: () => { cancelled = true; } });
      eq(textOf(root, 'cgp-review-title')[0], STR.gameReview, 'the modal is titled');
      eq(textOf(root, 'cgp-review-progress-text')[0], STR.analyzing(2, 5),
         'and shows real progress, not a guessed duration');
      eq(first(root, 'cgp-review-bar-fill').style.getPropertyValue('width'), '40%',
         'the bar is determinate');
      first(root, 'cgp-review-cancel').onclick();
      expect(cancelled, 'and can be cancelled');
      eq(byClass(root, 'cgp-review-scrim').length, 0, 'which closes it');
    }

    // A zero total cannot render as a full bar.
    {
      const root = makeNode('div');
      S.BiyaCoachPlay.reviewModal(root, { running: true, done: 0, total: 0 }, {});
      eq(first(root, 'cgp-review-bar-fill').style.getPropertyValue('width'), '0%',
         'a zero total is 0%, not NaN%');
    }

    // Finished: the orientation fix, end to end through the DOM.
    const summary = {
      whiteAccuracy: 91.24, blackAccuracy: 44.5,
      whiteClassifications: { best: 3, blunder: 0, good: 1 },
      blackClassifications: { best: 1, blunder: 2, good: 0 },
      evalGraph: [{ eval_cp: 0 }, { eval_cp: 120 }, { eval_cp: -80 }],
      moveEvaluations: [{ move_index: 1, classification: 'best' }],
      displayOrder: ['best', 'good', 'blunder'],
    };
    {
      const root = makeNode('div');
      let started = false, fresh = false;
      S.BiyaCoachPlay.reviewModal(root, { running: false, summary, userColor: 'w' },
                                  { onStartReview: () => { started = true; },
                                    onNewGame: () => { fresh = true; } });
      eq(textOf(root, 'cgp-review-accuracy')[0], '91.2%', 'your accuracy, to one decimal');
      eq(textOf(root, 'cgp-review-accuracy')[1], '44.5%', 'then the coach');
      eq(first(root, 'cgp-review-accuracy').style.getPropertyValue('color'), '#4CAF50',
         'and it is coloured by band');
      eq(byClass(root, 'cgp-review-class').length, 3, 'three classification rows');
      // The label carries its symbol, from the ten-tier table both review screens share — the
      // Analysis Board renders `Best ★` the same way.
      eq(textOf(root, 'cgp-review-class-label').join(' | '), 'Best ★ | Good | Blunder ??',
         'in display order, labelled from the shared table');
      eq(first(root, 'cgp-review-dot').style.getPropertyValue('background'),
         S.BiyaCoachReview.classColor('best'), 'and tinted from it too');
      eq(byClass(root, 'cgp-review-graph').length, 1, 'and an eval graph');
      // The card's border is the accent with a hex alpha BYTE, exactly as `play.tsx` writes it —
      // not the accent at 30 % opacity, which is what reading `'30'` as a percentage would give.
      const bordered = makeNode('div');
      S.BiyaCoachPlay.reviewModal(bordered,
        { running: false, summary, userColor: 'w', accent: '#E91E8C' }, {});
      eq(first(bordered, 'cgp-review-card').style.getPropertyValue('border-color'),
         '#E91E8C' + S.BiyaCoachPlay.ACCENT_ALPHA_BYTE, 'the card border is the accent plus a byte');
      eq(S.BiyaCoachPlay.ACCENT_ALPHA_BYTE, '30', 'and the byte is the one the source appends');
      first(root, 'cgp-review-start').onclick();
      expect(started, 'Start Review hands off');
      const root2 = makeNode('div');
      S.BiyaCoachPlay.reviewModal(root2, { running: false, summary, userColor: 'w' },
                                  { onNewGame: () => { fresh = true; } });
      first(root2, 'cgp-review-newgame').onclick();
      expect(fresh, 'and New Game starts one');
    }

    // Playing Black: the accuracy column and the counts under it must describe the SAME player.
    // The RN modal ordered these two halves differently, which is spec 2.10's own fix.
    {
      const root = makeNode('div');
      S.BiyaCoachPlay.reviewModal(root, { running: false, summary, userColor: 'b' }, {});
      eq(textOf(root, 'cgp-review-accuracy')[0], '44.5%', 'as Black, your accuracy is still first');
      const counts = textOf(root, 'cgp-review-count');
      eq(counts[0], '1', 'and the first BEST count is yours, not the coach\'s');
      eq(counts[1], '3', 'with the coach on the right');
    }

    // A summary that never arrived draws nothing rather than an empty card.
    {
      const root = makeNode('div');
      eq(S.BiyaCoachPlay.reviewModal(root, { running: false, summary: null }, {}), null,
         'no summary, no modal');
      eq(byClass(root, 'cgp-review-scrim').length, 0, 'and nothing is appended');
    }

    // The Review button appears only for a game there is something to review in.
    {
      const oneMove = GAME.newGame(3, 'w');
      GAME.record(oneMove, 'e2e4');
      oneMove.resigned = true;
      GAME.applyEvaluation(oneMove, coach);
      const view = makeNode('div');
      S.BiyaCoachPlay.render(view, oneMove, TURN.create(), coach, { onReview: () => {} });
      eq(byClass(view.children[0], 'cgp-review').length, 1,
         'one move IS reviewable — two positions is a game the maths can walk');
      const empty = GAME.newGame(3, 'w');
      empty.resigned = true;
      GAME.applyEvaluation(empty, coach);
      const view2 = makeNode('div');
      S.BiyaCoachPlay.render(view2, empty, TURN.create(), coach, { onReview: () => {} });
      eq(byClass(view2.children[0], 'cgp-review').length, 0,
         'a game with no moves at all is not');
    }

    // §7 #28 — the hand-off carries the classifications. Asserted at the seam the RN version broke.
    {
      const h = RV.handoff(g, summary);
      expect(h !== null, 'the hand-off is built');
      eq(h.classifications.length, 1, 'and carries the classifications, never an empty array');
      eq(RV.handoff(g, null), null, 'while a missing summary produces no hand-off at all');
    }
  }

  // an `applyMetrics` that silently did nothing would make the audit vacuous the moment it arrived.
  {
    const MET = S.BiyaCoachMetrics;
    const set = new Set();
    [['cgs', MET.SELECT], ['cgc', MET.PLAY], ['cgp', MET.PLAY]].forEach(([prefix, blocks]) => {
      const fake = { style: { setProperty: (k) => set.add(k) } };
      MET.applyAll(fake, prefix, blocks);
    });
    expect(set.size > 600, `only ${set.size} custom properties available — the metrics moved`);

    if (fs.existsSync(CSS)) {
      const css = fs.readFileSync(CSS, 'utf8');
      const read = new Set([...css.matchAll(/var\((--cg[a-z0-9-]+)/g)].map(m => m[1]));
      expect(read.size > 60, `only ${read.size} --cg vars read — the stylesheet looks incomplete`);
      // `--cgx-*` is the polish namespace: motion and focus, defined in the stylesheet itself and
      // deliberately NOT extracted, so no metrics value is touched by it.
      ['--cgx-fast', '--cgx-ease', '--cgx-press'].forEach(v => set.add(v));
      const missing = [...read].filter(v => !set.has(v)).sort();
      eq(missing.join(', '), '',
         'every --cg var the stylesheet reads is pushed by the metrics layer');
    } else {
      // Not a silent pass: the absence is reported, and the audit turns on by itself.
      console.log('  note: web-demo/css/coach.css does not exist yet — the --cg audit '
                  + 'activates automatically when it does.');
    }
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `CoachScreens: ${passed} assertions passed`
      : `CoachScreens: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
