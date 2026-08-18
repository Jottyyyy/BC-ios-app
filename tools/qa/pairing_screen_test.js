#!/usr/bin/env node
/*
 * pairing_screen_test.js — the three Pairing Manager screens, rendered into a headless DOM.
 *
 *     node tools/qa/pairing_screen_test.js
 *
 * Sibling of `puzzle_screen_test.js`, and the same argument for existing: neither the engine suite
 * nor the store suite nor the metrics suite would notice a screen that throws on its first paint or
 * wires a button to nothing. Every one of those was green while this feature was invisible in the
 * browser, because no pairing script tag existed in index.html at all.
 *
 * Two things the puzzle harness could not do, added here:
 *
 *   1. **`value` and `type` on the fake node.** The Create screen and the Add Player modal are
 *      forms. Without a settable `value` there is no way to drive them, so they would have shipped
 *      with zero coverage — the largest untested surface in the feature.
 *   2. **A `--pg*` audit.** The puzzle version checks its vars in both directions. Here the metrics
 *      push is TOTAL (`MET.applyAll` writes all ~750 properties), so "set but never read" is the
 *      normal case and says nothing. The direction that still carries information is the other one:
 *      every `var(--pg…)` the stylesheet reads must actually be set, or it renders as nothing.
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

// ---- The fake DOM ---------------------------------------------------------------------------

function makeNode(tag, ns) {
  const n = {
    _on: {},
    tagName: String(tag).toUpperCase(), ns: ns || null,
    children: [], parentNode: null, attrs: {}, _text: '',
    // Forms. `value` is a plain property here rather than an attribute, which is what the screens
    // read and write, and `disabled` so a guarded button can be asserted.
    value: '', type: '', disabled: false, scrollTop: 0,
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

// ---- The sandbox ------------------------------------------------------------------------------

function loadSandbox() {
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const need = ['icons.js', 'pairing-engine.js', 'pairing-metrics.js', 'pairing-store.js',
                'pairing-list.js', 'pairing-create.js', 'pairing-detail.js'];
  // Load in the PAGE's order, not this list's — the point is to prove the page order works.
  // pairing-store reads BiyaPairing at load time, so an engine tag placed after it would throw
  // here exactly as it would in a browser.
  for (const f of need) expect(order.includes(f), `index.html loads js/${f}`);
  expect(order.indexOf('pairing-engine.js') < order.indexOf('pairing-store.js'),
         'the engine tag precedes the store tag');
  expect(order.indexOf('pairing-detail.js') < order.indexOf('app.js'),
         'every pairing screen is loaded before app.js');

  const files = order.filter(f => need.includes(f));
  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Error, isNaN, isFinite,
    parseInt, parseFloat,
    navigator: { share: null, clipboard: null },
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
  sandbox._store = store;
  return sandbox;
}

// ---- The suite ---------------------------------------------------------------------------------

function run() {
  passed = 0; failures.length = 0;
  const S = loadSandbox();
  if (!S) return finish();

  const MET = S.BiyaPairingMetrics;
  const ST = S.BiyaPairingStore;
  const T = MET.STR;

  const mountList = (cb) => {
    const view = makeNode('div');
    S.BiyaPairingList.render(view, ST.load(), cb || {});
    return view.children[0];
  };
  const mountDetail = (id, cb) => {
    const view = makeNode('div');
    S.BiyaPairingDetail.render(view, id, cb || {});
    return view.children[0];
  };

  // ── The list, empty ─────────────────────────────────────────────────────────
  {
    let created = false, exited = false;
    const root = mountList({ onCreate: () => { created = true; },
                             onExit: () => { exited = true; } });
    expect(root.classList.contains('pgl-view'), 'the list mounts with its screen class');
    eq(textOf(root, 'pgl-title')[0], T.tournaments, 'the header title');
    eq(textOf(root, 'pgl-sub')[0], T.listSub, 'and its subtitle');
    eq(textOf(root, 'pgl-empty-title')[0], T.emptyTitle, 'the empty state');
    eq(textOf(root, 'pgl-empty-icon')[0], T.emptyGlyph, 'with the knight glyph');
    eq(byClass(root, 'pgl-card').length, 0, 'and no cards');
    eq(byClass(root, 'pgl-hint').length, 0, 'the long-press hint is hidden while empty');
    first(root, 'pgl-fab').onclick();
    expect(created, 'the FAB opens Create');
    first(root, 'pgl-back').onclick();
    expect(exited, 'back leaves the feature');

    // The metrics really reached the root, and as CSS custom properties.
    eq(root.style.getPropertyValue('--pgl-card-border-radius'),
       MET.LIST.card.borderRadius + 'px', 'an extracted radius is pushed as a var');
    eq(root.style.getPropertyValue('--pgl-card-background-color'),
       MET.LIST.card.backgroundColor, 'and an extracted colour');
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  let swissId = null;
  {
    const view = makeNode('div');
    let createdId = null;
    S.BiyaPairingCreate.render(view, { onCreated: (id) => { createdId = id; } });
    const root = view.children[0];
    eq(textOf(root, 'pgc-title')[0], T.newTournament, 'the create header');
    eq(byClass(root, 'pgc-type').length, 2, 'two format cards');
    eq(textOf(root, 'pgc-type-name').join('|'), T.swiss + '|' + T.roundRobin,
       'Swiss then Round Robin');
    eq(byClass(root, 'pgc-round').length, 4, 'four round presets');
    eq(textOf(root, 'pgc-round').join(','), '3,5,7,9', 'the presets from the source');
    expect(first(root, 'pgc-create').disabled, 'Create is disabled with no name');

    // Round Robin hides the round picker and shows the note instead.
    byClass(root, 'pgc-type')[1].onclick();
    eq(byClass(root, 'pgc-round').length, 0, 'Round Robin has no round picker');
    eq(textOf(root, 'pgc-rr-note-text')[0], T.rrNote, 'it shows the note instead');
    byClass(root, 'pgc-type')[0].onclick();
    eq(byClass(root, 'pgc-round').length, 4, 'switching back restores the presets');
    expect(textOf(root, 'pgc-hint')[0].indexOf('Recommended') === 0,
           'and the live recommendation replaces the old free-plan notice');

    const name = first(root, 'pgc-input');
    name.value = 'Manila Open';
    name.oninput();
    expect(!first(root, 'pgc-create').disabled, 'a name enables Create');
    byClass(root, 'pgc-round')[1].onclick();          // 5 rounds
    first(root, 'pgc-create').onclick();
    expect(createdId != null, 'Create makes a tournament');
    swissId = createdId;
    const t = ST.tournament(ST.load(), swissId);
    eq(t.name, 'Manila Open', 'with the typed name');
    eq(t.totalRounds, 5, 'and the chosen round count');
  }

  // ── Create refuses an empty name, visibly ────────────────────────────────────
  {
    const view = makeNode('div');
    let createdId = null;
    S.BiyaPairingCreate.render(view, { onCreated: (id) => { createdId = id; } });
    const root = view.children[0];
    // Reach past the disabled flag the way a stray tap would, and check it still refuses.
    first(root, 'pgc-create').onclick();
    expect(createdId === null, 'an empty name creates nothing');
    eq(textOf(root, 'pz-modal-title')[0], T.required, 'and says so in a modal');
    eq(textOf(root, 'pz-modal-body')[0], T.enterName, 'with the reason');
  }

  // ── The list, populated ──────────────────────────────────────────────────────
  {
    let opened = null;
    const root = mountList({ onOpen: (id) => { opened = id; } });
    eq(byClass(root, 'pgl-card').length, 1, 'one card');
    eq(textOf(root, 'pgl-card-name')[0], 'Manila Open', 'showing the name');
    eq(textOf(root, 'pgl-type-badge')[0], T.swissBadge, 'the SWISS badge');
    eq(first(root, 'pgl-type-badge').style.backgroundColor, MET.COLORS.swiss + MET.TINT_BYTE,
       'tinted with the concatenated alpha BYTE, not a percentage');
    eq(first(root, 'pgl-type-badge').style.borderColor, MET.COLORS.swiss, 'and the solid accent');
    eq(textOf(root, 'pgl-status-text')[0], T.statusSetup, 'status SETUP before any round');
    eq(first(root, 'pgl-status-dot').style.backgroundColor, MET.COLORS.setup, 'with a gold dot');
    eq(textOf(root, 'pgl-stat-value')[0], '0', 'no players yet');
    eq(textOf(root, 'pgl-stat-value')[1], '0/5', 'no rounds of five');
    eq(textOf(root, 'pgl-hint')[0], T.longPressHint, 'the hint appears once there is a card');
    first(root, 'pgl-card').onclick();
    eq(opened, swissId, 'tapping a card opens it');
  }

  // ── Detail: players, bulk add, seeds ─────────────────────────────────────────
  {
    S.BiyaPairingDetail.setTab(S.BiyaPairingDetail.TAB_PLAYERS);
    let root = mountDetail(swissId);
    eq(textOf(root, 'pgd-header-title')[0], 'Manila Open', 'the detail header');
    eq(textOf(root, 'pgd-header-rounds')[0], T.roundsMeta(0, 5), 'R0/5');
    eq(textOf(root, 'pgd-empty')[0], T.noPlayers, 'the empty players tab');
    eq(textOf(root, 'pgd-tab')[0], T.playersTab(0), 'the tab counts players');

    first(root, 'pgd-action-secondary').onclick();       // Bulk Add
    eq(textOf(root, 'pz-modal-title')[0], T.bulkAddTitle, 'the bulk modal opens');
    const area = first(root, 'pgd-modal-area');
    area.value = 'Juan Dela Cruz\nMaria Santos 1500\nPedro Reyes 1200\nAna Cruz 007\n'
               + 'Rex Uy 1800\nLito Yu 1400\nDina Ong 1600';
    area.oninput();
    eq(first(root, 'pgd-modal-confirm').textContent, T.addNPlayers(7),
       'the confirm label counts live');
    first(root, 'pgd-modal-confirm').onclick();

    root = mountDetail(swissId);
    const t = ST.tournament(ST.load(), swissId);
    eq(t.players.length, 7, 'seven players added');
    eq(t.players[1].rating, 1500, 'a trailing integer became a rating');
    eq(t.players[3].name, 'Ana Cruz 007', 'a non-round-tripping number stayed part of the name');
    eq(textOf(root, 'pgd-seed').join(','), '1,2,3,4,5,6,7', 'seeds are dense and shown as seeds');
    eq(textOf(root, 'pgd-player-rating')[0], T.ncfp(1500), 'a rated player shows NCFP');
    eq(byClass(root, 'pgd-remove').length, 7, 'each row can be removed while in setup');
  }

  // ── Detail: rounds, the bye, results, and clearing one ───────────────────────
  {
    S.BiyaPairingDetail.setTab(S.BiyaPairingDetail.TAB_ROUNDS);
    let root = mountDetail(swissId);
    eq(textOf(root, 'pgd-empty')[0], T.generateToStart, 'nothing generated yet');
    eq(first(root, 'pgd-generate').textContent, T.generateRound(1), 'the generate label');

    first(root, 'pgd-generate').onclick();
    root = mountDetail(swissId);
    const t = ST.tournament(ST.load(), swissId);
    eq(t.rounds.length, 1, 'round 1 exists');
    eq(byClass(root, 'pgd-pairing').length, 4, 'seven players make three boards and a bye');
    // The bye is the LAST board (spec 7 #7) — the server put it on board 1 from round 2 onward.
    eq(byClass(root, 'pgd-bye').length, 1, 'exactly one bye row');
    const boards = byClass(root, 'pgd-pairing');
    expect(byClass(boards[boards.length - 1], 'pgd-bye').length === 1,
           'and it is on the last board');
    eq(textOf(root, 'pgd-badge').join('|'), [T.vs, T.vs, T.vs].join('|'),
       'every real board starts pending');

    // Enter a result on board 1.
    boards[0].onclick();
    eq(textOf(root, 'pz-modal-title')[0], T.enterResult, 'the result modal opens');
    eq(textOf(root, 'pgd-modal-sub')[0], T.board(1), 'for the right board');
    eq(byClass(root, 'pgd-result-btn').length, 3, 'three outcomes');
    eq(byClass(root, 'pgd-result-clear').length, 0,
       'and no Clear until there is something to clear');
    byClass(root, 'pgd-result-btn')[0].onclick();       // White wins

    root = mountDetail(swissId);
    eq(textOf(root, 'pgd-badge')[0], T.resultWhite, 'board 1 shows 1-0');
    expect(byClass(root, 'pgd-badge')[0].classList.contains('done'), 'and is styled as decided');
    eq(byClass(root, 'pgd-pname')[0].classList.contains('win'), true, 'the winner is highlighted');

    // Clear it — the option the RN app had no way to express (spec 7 #23).
    byClass(root, 'pgd-pairing')[0].onclick();
    eq(byClass(root, 'pgd-result-clear').length, 1, 'Clear appears once a result exists');
    first(root, 'pgd-result-clear').onclick();
    root = mountDetail(swissId);
    eq(textOf(root, 'pgd-badge')[0], T.vs, 'clearing returns the board to pending');
    expect(!byClass(root, 'pgd-badge')[0].classList.contains('done'), 'and to pending styling');
  }

  // ── The seed chip is the SEED, not the row number (spec 7 #15) ───────────────
  //
  // This has to be checked AFTER results exist. While the list is in seed order with dense seeds,
  // the row index and the seed are the same number and the two implementations are
  // indistinguishable — the mutation suite proved that by surviving. Once play starts the list is
  // score-ordered, which is the situation the RN bug actually shipped in.
  {
    const doc = ST.load();
    // Decide the whole first round so the score order is unambiguous.
    const t0 = ST.tournament(doc, swissId);
    t0.rounds[0].boards.forEach(b => {
      if (!b.isBye) ST.setResult(doc, swissId, 1, b.board, ST.BLACK_WIN);
    });
    ST.save(doc);

    S.BiyaPairingDetail.setTab(S.BiyaPairingDetail.TAB_PLAYERS);
    const root = mountDetail(swissId);
    const t = ST.tournament(ST.load(), swissId);
    const seeds = textOf(root, 'pgd-seed');
    const names = textOf(root, 'pgd-player-name');
    eq(seeds.length, names.length, 'a seed chip per player row');
    // Every chip is its own player's seed.
    names.forEach((name, i) => {
      const p = t.players.filter(x => x.name === name)[0];
      eq(seeds[i], String(p.seed), `row ${i} shows ${name}'s seed`);
    });
    // And the list is genuinely NOT in seed order any more, or the check above proves nothing.
    expect(seeds.join(',') !== seeds.slice().sort((a, b) => a - b).join(','),
           'the score-ordered list really has diverged from seed order');
    eq(byClass(root, 'pgd-remove').length, 0, 'and players can no longer be removed');
  }

  // ── The result badge is exhaustive (spec 7 #20) ──────────────────────────────
  {
    const D = S.BiyaPairingDetail;
    eq(D.resultBadge(ST.WHITE_WIN), T.resultWhite, '1-0');
    eq(D.resultBadge(ST.BLACK_WIN), T.resultBlack, '0-1');
    eq(D.resultBadge(ST.DRAW), T.resultDraw, 'half-half');
    eq(D.resultBadge(ST.PENDING), T.vs, 'pending');
    // The one that matters: the RN chain fell through to a draw for anything unrecognised, so a
    // corrupt result rendered as a plausible-looking half point.
    eq(D.resultBadge('garbage'), null, 'an unrecognised result is NOT silently a draw');
    eq(D.resultBadge(undefined), null, 'nor is a missing one');
  }

  // ── Standings: one comparator, rank 1 gold on screen ─────────────────────────
  {
    S.BiyaPairingDetail.setTab(S.BiyaPairingDetail.TAB_STANDINGS);
    const root = mountDetail(swissId);
    eq(textOf(root, 'pgd-st-col').slice(0, 8).join(','),
       [T.colRank, T.colPlayer, T.colPts, T.colW, T.colD, T.colL, T.colBch, T.colSB].join(','),
       'the eight column headers, SB included');
    const rows = byClass(root, 'pgd-st-row');
    eq(rows.length, 7, 'a row per player');
    // Rank 1 gold, ON SCREEN (spec 7 #14) — the RN styles existed and only reached the share image.
    expect(byClass(rows[0], 'pgd-st-rank')[0].classList.contains('gold'),
           'rank 1 gets the gold chip on screen');
    expect(!byClass(rows[1], 'pgd-st-rank')[0].classList.contains('gold'),
           'and rank 2 does not');
    const order = ST.standings(ST.tournament(ST.load(), swissId)).map(p => p.name);
    eq(byClass(rows[0], 'pgd-st-pname')[0].textContent, order[0],
       'the table uses the shared comparator');
    eq(textOf(root, 'pgd-st-share')[0], T.shareStandings, 'and offers the share button');
  }

  // ── Round robin: the whole schedule at once ──────────────────────────────────
  {
    const doc = ST.load();
    const rid = ST.create(doc, { name: 'Club RR', type: ST.ROUND_ROBIN }, 1000);
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach(n => ST.addPlayer(doc, rid, { name: n }));
    ST.save(doc);
    S.BiyaPairingDetail.setTab(S.BiyaPairingDetail.TAB_ROUNDS);
    let root = mountDetail(rid);
    eq(first(root, 'pgd-generate').textContent, T.generateSchedule,
       'round robin generates a whole schedule, not one round');
    first(root, 'pgd-generate').onclick();
    root = mountDetail(rid);
    eq(ST.tournament(ST.load(), rid).rounds.length, 5, 'six players play five rounds');
    eq(byClass(root, 'pgd-round-chip').length, 5, 'and the selector shows all five');
    eq(byClass(root, 'pgd-generate').length, 0, 'with nothing left to generate');
  }

  // ── A deleted tournament gets an empty state, not a blank box (spec 7 #19) ───
  {
    const root = mountDetail(999999);
    eq(textOf(root, 'pgd-empty-title')[0], T.deletedTitle, 'a missing tournament says so');
    eq(textOf(root, 'pgd-empty-sub')[0], T.deletedBody, 'and explains why');
    eq(byClass(root, 'pgd-tab').length, 0, 'with no tabs to press');
  }

  // ── Long-press delete confirms before removing (spec 7 #18) ──────────────────
  {
    const before = ST.load().tournaments.length;
    let root = mountList({});
    first(root, 'pgl-card')._longPress();
    eq(textOf(root, 'pz-modal-title')[0], T.deleteTitle, 'long press asks first');
    expect(textOf(root, 'pz-modal-body')[0].indexOf('"') >= 0, 'quoting the name');
    byClass(root, 'pz-modal-btn')[0].onclick();          // Cancel
    eq(ST.load().tournaments.length, before, 'cancelling removes nothing');
    root = mountList({});
    first(root, 'pgl-card')._longPress();
    byClass(root, 'pz-modal-btn')[1].onclick();          // Delete
    eq(ST.load().tournaments.length, before - 1, 'confirming removes exactly one');
  }

  // ── The share text carries no URL (spec 7 #22) ───────────────────────────────
  {
    const t = ST.tournament(ST.load(), swissId);
    const round = S.BiyaPairingDetail.roundText(t, t.rounds[0]);
    const standings = S.BiyaPairingDetail.standingsText(t);
    [['round', round], ['standings', standings]].forEach(([what, text]) => {
      expect(!/https?:|ngrok|\.com|\.ph\b/.test(text.replace(T.siteUrl, '')),
             `the ${what} share text embeds no URL`);
      expect(text.indexOf(T.hashtags) >= 0, `the ${what} share text ends with the hashtags`);
      expect(text.indexOf(T.textRule) >= 0, `the ${what} share text keeps its rule`);
    });
    expect(round.indexOf(T.textBye) >= 0, 'the round text names the bye');
    // `1.0.0` was what the server's decimal-as-string produced. Chess notation, or nothing.
    expect(!/\d\.\d/.test(standings), 'no decimal scores anywhere in the standings text');
  }

  // ── Every metrics key the screens reference exists ───────────────────────────
  //
  // `metrics_key_check.js` does this for the Analysis feature, but it is written around a single
  // hard-coded module and view list, so covering a second feature is a refactor rather than a list
  // append. The Swift half is already handled — `swift_symbol_check.js` now resolves `Pairing*`
  // namespaces — so what is left is the JS half, and that is what this does.
  //
  // It matters because the failure is silent: `MET.STR.tournamnets` is `undefined`, which
  // `el(tag, cls, text)` renders as the string "undefined" or as nothing at all, depending on the
  // call. No exception, no blank screen, just a label that is quietly wrong.
  {
    const SCREENS = ['pairing-list.js', 'pairing-create.js', 'pairing-detail.js'];
    let checked = 0;
    for (const f of SCREENS) {
      const src = fs.readFileSync(path.join(JS, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
      // `MET.BLOCK` and `MET.BLOCK.key`
      for (const m of src.matchAll(/\bMET\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
        const [, block, key] = m;
        checked++;
        if (!(block in MET)) { failures.push(`${f}: MET.${block} does not exist`); continue; }
        if (key === undefined) continue;
        const holder = MET[block];
        if (holder && typeof holder === 'object' && !(key in holder)) {
          failures.push(`${f}: MET.${block}.${key} does not exist`);
        }
      }
      // `T.key`, where `var T = MET.STR` is the convention in all three screens.
      if (/var T = MET\.STR/.test(src)) {
        for (const m of src.matchAll(/\bT\.([A-Za-z_$][\w$]*)/g)) {
          checked++;
          if (!(m[1] in MET.STR)) failures.push(`${f}: MET.STR.${m[1]} does not exist`);
        }
      }
    }
    expect(checked > 120, `only ${checked} metrics references found — the screens probably moved`);
  }

  // ── Every var the stylesheet reads is actually set ───────────────────────────
  //
  // The direction that carries information here. `MET.applyAll` pushes all ~750 properties, so
  // "set but unread" is normal and says nothing; "read but never set" renders as nothing at all.
  {
    const css = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'pairing.css'), 'utf8');
    const read = new Set([...css.matchAll(/var\((--pg[a-z-]+)/g)].map(m => m[1]));
    expect(read.size > 150, `only ${read.size} --pg vars read — the stylesheet probably moved`);

    const set = new Set();
    // Mirrors what the three `applyMetrics` functions actually push, including the two blocks the
    // detail screen adds by hand: the standings widths (inline styles in the source) and the
    // round-selector gap (a `contentContainerStyle`, which the AST walker does not collect).
    [['pgl', MET.LIST], ['pgc', MET.CREATE], ['pgd', MET.DETAIL], ['pgs', MET.SHARE],
     ['pgd', { col: MET.COLS, layout: MET.LAYOUT }]]
      .forEach(([prefix, blocks]) => {
        const fake = { style: { setProperty: (k) => set.add(k) } };
        MET.applyAll(fake, prefix, blocks);
      });
    // The three composed by hand, plus the polish namespace, which is not extracted by design.
    ['--pgl-fab-shadow', '--pgc-create-btn-shadow', '--pgd-generate-shadow',
     '--pgx-fast', '--pgx-ease', '--pgx-press'].forEach(v => set.add(v));

    const missing = [...read].filter(v => !set.has(v)).sort();
    eq(missing.join(', '), '', 'every --pg var the stylesheet reads is pushed by the metrics layer');
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `PairingScreens: ${passed} assertions passed`
      : `PairingScreens: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
