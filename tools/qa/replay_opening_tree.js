#!/usr/bin/env node
/*
 * replay_opening_tree.js — check the Opening Tree's Swift against the JavaScript that has run.
 *
 *     node tools/qa/replay_opening_tree.js
 *
 * `swift` is not on PATH on this checkout, so `OpeningTree.swift`, `OpeningMetrics.swift`,
 * `OpeningTreeStore.swift` and `OpeningTreeScreens.swift` were written blind. This is the
 * mitigation every phase of the rebuild has used: pull the concrete values out of the Swift SOURCE
 * TEXT and compare them with the JS twin, which `js_goldens.js` proves by running it.
 *
 * It does not prove the Swift compiles. It proves the numbers, the colours, the copy and — the part
 * that matters here — the two ALGORITHMIC rules are the same on both sides:
 *
 *   1. **Stats are the MOVER's, not the owner's.** A node's W/D/L describe how the side that played
 *      that move fared, so the score inverts on the opponent's plies. Get the inversion backwards
 *      and every second row of the move list is exactly wrong, in a way that looks plausible —
 *      Black's replies would read as the tree owner's results, and only a hand-checked game would
 *      show it.
 *   2. **The candidate sort ties by SAN.** `Dictionary` iteration order is unspecified in Swift and
 *      `sort` is not stable, so a comparator on `count` alone produces a different order on every
 *      run and a different order from the browser. No replay could then compare the two.
 *
 * And three structural things a value check would miss: that the ONE networked source set is the
 * same in both languages, that every `--op-*` / `--opc-*` custom property the JS sets is read by the
 * CSS and vice versa, and that the four scripts are in index.html in a load order that works.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const CORE = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
/** `eq(js, swift, what)` — the argument order `replay_premium.js` uses, so the message reads
 *  the right way round. Where neither side is Swift it is `eq(actual, expected, what)`. */
const eq = (got, want, what) => expect(got === want,
  `${what}: Swift says ${JSON.stringify(want)}, JS gives ${JSON.stringify(got)}`);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function read(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) { failures.push('missing ' + file); return ''; }
  return fs.readFileSync(full, 'utf8');
}

/** The body of `enum X { … }` / `struct X { … }`, brace-matched. */
function blockOf(src, name) {
  const at = src.search(new RegExp('(?:public )?(?:final class|class|enum|struct) ' + name
    + '\\b[^\\n{]*\\{'));
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

/** `static let x: CGFloat = 12.5` inside `enum Ns`. */
function swNum(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*(-?[\\d_.]+)`)
    .exec(code(block));
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

/** `static let x = Theme.c(0xRRGGBB)` inside `enum Ns` → `#RRGGBB`. */
function swColor(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}\\s*=\\s*Theme\\.c\\(0x([0-9A-Fa-f]{6})\\)`)
    .exec(code(block));
  return m ? '#' + m[1].toUpperCase() : null;
}

/**
 * A Swift string literal, `+`-concatenated across lines, with escapes resolved.
 * The metrics file wraps long copy, so a naive single-line regex would read half of it.
 */
function swString(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const at = block.search(new RegExp(`static let ${name}\\s*=`));
  if (at < 0) return null;
  const tail = block.slice(block.indexOf('=', at) + 1);
  let out = '';
  let i = 0;
  for (;;) {
    // Skip whitespace, `+` and newlines between fragments.
    while (i < tail.length && /[\s+]/.test(tail[i])) i++;
    if (tail[i] !== '"') break;
    i++;
    let piece = '';
    while (i < tail.length && tail[i] !== '"') {
      if (tail[i] === '\\') {
        const c = tail[i + 1];
        piece += c === 'n' ? '\n' : c === 't' ? '\t' : c;
        i += 2;
      } else { piece += tail[i++]; }
    }
    i++;
    out += piece;
    // Another fragment only if the next non-space character is a `+`.
    let j = i;
    while (j < tail.length && /\s/.test(tail[j])) j++;
    if (tail[j] !== '+') break;
  }
  return out;
}

const CORE_SRC = read(CORE, 'OpeningTree.swift');
const MET_SRC = read(UI, 'OpeningMetrics.swift');
const STORE_SRC = read(UI, 'OpeningTreeStore.swift');
const SCREENS_SRC = read(UI, 'OpeningTreeScreens.swift');
const APP_CSS = read(path.join(ROOT, 'web-demo', 'css'), 'app.css');
const INDEX = read(path.join(ROOT, 'web-demo'), 'index.html');
const OPENINGS_JS = read(JS, 'openings.js');

/** Comment-stripped, and sliced BY ITS OWN indices — mixing the two is how the first draft of
 *  this file silently skipped ten assertions on a source that was correct. */
const CORE_CODE = code(CORE_SRC);

const OT = require(path.join(JS, 'opening-tree.js'));
const MET = require(path.join(JS, 'opening-metrics.js'));
const ST = require(path.join(JS, 'opening-store.js'));

// ── 1. The two constants ────────────────────────────────────────────────────────
{
  const block = blockOf(CORE_SRC, 'OpeningTree');
  expect(block !== null, 'OpeningTree is a type in the Core');
  const m = /static let defaultMaxPlies = (\d+)/.exec(code(CORE_SRC));
  eq(OT.DEFAULT_MAX_PLIES, m ? Number(m[1]) : null, 'defaultMaxPlies');
  const g = /static let maxGamesLimit = (\d+)/.exec(code(CORE_SRC));
  eq(OT.MAX_GAMES_LIMIT, g ? Number(g[1]) : null, 'maxGamesLimit');
  expect(OT.DEFAULT_MAX_PLIES > 0 && OT.DEFAULT_MAX_PLIES % 2 === 0,
    'the ply cap is a whole number of full moves');
}

// ── 2. The outcome vocabulary ───────────────────────────────────────────────────
{
  const block = blockOf(CORE_SRC, 'Outcome') || '';
  for (const [key, raw] of Object.entries(OT.OUTCOMES)) {
    expect(new RegExp(`case ${key} = "${raw.replace(/[/]/g, '/')}"`).test(block),
      `Outcome.${key} is "${raw}" in Swift too`);
  }
  expect((block.match(/^\s*case \w+ = /gm) || []).length === 3,
    'three outcomes, and `*` is deliberately not one of them');

  // `score(forWhite:)` — the primitive the inversion is built on.
  expect(/case \.draw: return 0/.test(block), 'a draw scores zero');
  expect(/case \.whiteWin: return white \? 1 : -1/.test(block), 'white winning is +1 for white');
  expect(/case \.blackWin: return white \? -1 : 1/.test(block), 'and -1 for white when black wins');
  eq(OT.outcomeScore(OT.OUTCOMES.whiteWin, true), 1, 'the JS agrees on white winning');
  eq(OT.outcomeScore(OT.OUTCOMES.whiteWin, false), -1, 'and on the other side of it');
}

// ── 3. The mover inversion — the rule the whole feature turns on ────────────────
{
  const insert = CORE_CODE.slice(CORE_CODE.indexOf('private static func insert('));
  expect(insert.length > 100, 'the recursive insert is in the Core');
  expect(/let ownerScore = outcome\.score\(forWhite: game\.userIsWhite\)/.test(insert),
    'the owner score comes from the game');
  expect(/let moverIsOwner = \(step\.moverIsWhite == game\.userIsWhite\)/.test(insert),
    'the mover is compared with the owner');
  expect(/let moverScore = moverIsOwner \? ownerScore : -ownerScore/.test(insert),
    'and the score INVERTS on the opponent plies — get this backwards and every second row lies');
  expect(/if moverScore > 0 \{ node\.wins \+= 1 \} else if moverScore < 0 \{ node\.losses \+= 1 \}/
    .test(insert), 'positive is a win, negative a loss');

  // The same thing, executed, in the language that runs here.
  const t = OT.create();
  OT.addGame(t, { sanMoves: ['e4', 'c5'], userIsWhite: true, outcome: OT.OUTCOMES.whiteWin });
  eq(OT.nodeAt(t, ['e4']).wins, 1, 'the owner played e4 and won');
  eq(OT.nodeAt(t, ['e4', 'c5']).losses, 1, 'and the opponent played c5 and lost');
  const t2 = OT.create();
  OT.addGame(t2, { sanMoves: ['e4', 'c5'], userIsWhite: false, outcome: OT.OUTCOMES.whiteWin });
  eq(OT.nodeAt(t2, ['e4']).wins, 1, 'seen from black, e4 is STILL a win for whoever played it');
}

// ── 4. Truncation, rejection, and canonical SAN ─────────────────────────────────
{
  const add = CORE_CODE.slice(CORE_CODE.indexOf('public mutating func add(_ game: Game'));
  expect(/guard let move = position\.move\(forSAN: token\) else \{ break \}/.test(add),
    'a bad token BREAKS the walk rather than dropping the game');
  expect(/steps\.append\(\(position\.san\(for: move\), position\.sideToMove == \.white\)\)/.test(add),
    'SAN is re-generated from the parsed move, so spellings collapse to one key');
  expect(/if steps\.isEmpty \{\s*rejectedCount \+= 1/.test(add),
    'and only a game with NO legal first move counts as rejected');
  expect(/if steps\.count >= maxPlies \{ break \}/.test(add), 'the ply cap is enforced in the walk');

  const t = OT.create();
  eq(OT.addGame(t, { sanMoves: ['e4', 'Zz9', 'Nf3'], userIsWhite: true, outcome: null }), 1,
    'the JS truncates at the bad token too');
  eq(t.rejectedCount, 0, 'and does not call that a rejection');
  eq(OT.addGame(t, { sanMoves: ['Zz9'], userIsWhite: true, outcome: null }), 0, 'nothing inserted');
  eq(t.rejectedCount, 1, 'that one IS a rejection');
}

// ── 5. The candidate sort, and its tie-break ────────────────────────────────────
{
  const sorted = CORE_CODE.slice(CORE_CODE.indexOf('public func sortedMoves(at path:'));
  expect(/a\.count == b\.count \? a\.san < b\.san : a\.count > b\.count/.test(sorted),
    'Swift sorts by count descending, ties by SAN ascending');
  expect(/sortedMoves\(at: path\)\.first\?\.san/.test(CORE_CODE),
    'and `mostPlayed` is the first of that list, so forward and the list agree');

  const t = OT.create();
  ['e4', 'e4', 'd4', 'c4', 'Nf3'].forEach((first) => {
    OT.addGame(t, { sanMoves: [first], userIsWhite: true, outcome: OT.OUTCOMES.draw });
  });
  const moves = OT.sortedMoves(t, []);
  eq(moves.map((m) => m.san).join(' '), 'e4 Nf3 c4 d4',
    'the JS orders them the same way — capital N before lowercase c and d');
  eq(OT.mostPlayed(t, []), 'e4', 'and forward plays the top of the list');
}

// ── 6. Every metric, against the JS twin ────────────────────────────────────────
{
  for (const [name, want] of Object.entries(MET.LAYOUT)) {
    eq(want, swNum(MET_SRC, 'OpeningLayout', name), `OpeningLayout.${name}`);
  }
  for (const [name, want] of Object.entries(MET.PALETTE)) {
    eq(want.toUpperCase(), swColor(MET_SRC, 'OpeningPalette', name), `OpeningPalette.${name}`);
  }
  eq(MET.WDL.win.toUpperCase(), swColor(MET_SRC, 'OpeningWDL', 'win'), 'the win colour');
  eq(MET.WDL.draw.toUpperCase(), swColor(MET_SRC, 'OpeningWDL', 'draw'), 'the draw colour');
  eq(MET.WDL.loss.toUpperCase(), swColor(MET_SRC, 'OpeningWDL', 'loss'), 'the loss colour');
  eq(MET.WDL.barHeight, swNum(MET_SRC, 'OpeningWDL', 'barHeight'), 'the bar height');
  eq(MET.WDL.barRadius, swNum(MET_SRC, 'OpeningWDL', 'barRadius'), 'the bar radius');

  for (const [name, want] of Object.entries(MET.STRINGS)) {
    eq(want, swString(MET_SRC, 'OpeningStrings', name), `OpeningStrings.${name}`);
  }
  // Neither side may quietly grow a string the other does not have.
  const swiftStrings = (blockOf(MET_SRC, 'OpeningStrings') || '')
    .match(/^\s*static let (\w+) =/gm) || [];
  eq(Object.keys(MET.STRINGS).length, swiftStrings.length,
    'the two string tables are the same size');
}

// ── 7. The ONE networked source set ─────────────────────────────────────────────
//
// This is the only place in the app outside the future ContentClient that is allowed to want the
// radio, so the two languages must agree on exactly which sources those are.
{
  const block = blockOf(MET_SRC, 'OpeningSource') || '';
  const cases = (block.match(/case ([\w, ]+)\n/) || [])[1] || '';
  const swiftIds = cases.split(',').map((s) => s.trim()).filter(Boolean);
  eq(MET.SOURCES.map((s) => s.id).join(','), swiftIds.join(','), 'the source ids, in order');

  const online = (block.match(/case \.pgn, \.coach: return false\s*\n\s*case \.lichess, \.chesscom: return true/) !== null);
  expect(online, 'Swift marks exactly lichess + chesscom as online');
  eq(MET.SOURCES.filter((s) => s.online).map((s) => s.id).join(','), 'lichess,chesscom',
    'and so does the JS');
  expect(/var needsUsername: Bool \{ isOnline \}/.test(block),
    'the username field follows the online flag rather than a second list');

  // The offline half must never depend on it: the PGN path builds with no network at all.
  const built = require(path.join(JS, 'openings.js')).submit(
    { name: 'x', colour: 'both', source: 'pgn',
      pgn: '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 1-0\n' }, 1);
  expect(!built.error && built.tree.gameCount === 1, 'a PGN builds a tree with no network');
}

// ── 8. The store's shape ────────────────────────────────────────────────────────
{
  expect(/var canStepBack: Bool \{ !path\.isEmpty \}/.test(code(STORE_SRC)),
    'back is enabled by the path, in Swift');
  expect(/func stepForward\(\)[\s\S]{0,200}mostPlayed\(at: path\)/.test(code(STORE_SRC)),
    'and forward plays the most-played continuation');
  expect(/if i % 2 == 0 \{ out\.append\("\\\(i \/ 2 \+ 1\)\."\) \}/.test(STORE_SRC),
    'the history strip numbers white moves only');

  // The JS store, executed.
  const s = ST.create({ getItem: () => null, setItem: () => {} });
  const games = OT.gamesFromPGN('[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 1-0\n',
    { userName: 'A' });
  const saved = ST.build({ games, name: 'n', colour: 'white', source: 'pgn', nowMs: 1 });
  s.add(saved);
  s.openTree(saved.id);
  eq(s.canStepBack(), false, 'nothing to step back to at the root');
  s.stepForward(); s.stepForward(); s.stepForward();
  eq(s.historyText(), '1. e4 c5 2. Nf3', 'and the history strip numbers the same way');
  eq(s.canStepForward(), false, 'the line ends where the games do');
}

// ── 9. The CSS contract ─────────────────────────────────────────────────────────
//
// Same audit `replay_premium.js` runs over `--pw-*`: a rule reading a property nobody sets renders
// with nothing, and a property nobody reads is a number pretending to matter.
{
  const readProps = new Set([...APP_CSS.matchAll(/var\(\s*(--opc?-[A-Za-z0-9-]+)/g)]
    .map((m) => m[1]));
  expect(readProps.size > 20, `only ${readProps.size} --op* properties are read — the parser rotted`);

  const set = new Set();
  for (const k of Object.keys(MET.LAYOUT)) set.add('--op-' + k);
  for (const k of Object.keys(MET.PALETTE)) set.add('--opc-' + k);
  ['--op-barHeight', '--op-barRadius', '--opc-win', '--opc-draw', '--opc-loss', '--opc-loadFill']
    .forEach((k) => set.add(k));

  for (const name of readProps) {
    expect(set.has(name), `app.css reads ${name} but openings.js never sets it`);
  }
  // The two namespaces exist precisely because three keys name a width AND a colour.
  for (const both of ['buildBorder', 'inputBorder', 'infoBorder']) {
    expect(MET.LAYOUT[both] !== undefined && MET.PALETTE[both] !== undefined,
      `${both} is both a width and a colour, which is why --op-/--opc- are separate`);
    expect(readProps.has('--op-' + both) || readProps.has('--opc-' + both),
      `and at least one of ${both}'s two properties is used`);
  }
  expect(/\.op-build\s*\{[^}]*border:\s*var\(--op-buildBorder\)\s*solid\s*var\(--opc-buildBorder\)/
    .test(APP_CSS), 'the build button takes its WIDTH from --op- and its COLOUR from --opc-');
}

// ── 10. Load order ──────────────────────────────────────────────────────────────
{
  const order = ['js/opening-tree.js', 'js/opening-metrics.js', 'js/opening-store.js',
                 'js/openings.js'];
  let last = -1;
  for (const f of order) {
    const at = INDEX.indexOf('src="' + f + '"');
    expect(at > last, `${f} is in index.html, after the file it depends on`);
    last = at;
  }
  expect(INDEX.indexOf('src="js/engine.js"') < INDEX.indexOf('src="js/opening-tree.js"'),
    'and the engine is loaded before the tree that replays through it');
  expect(INDEX.indexOf('src="js/openings.js"') < INDEX.indexOf('src="js/app.js"'),
    'and every screen before the router that dispatches to it');

  // The router branch the client reported missing.
  const APP = code(read(JS, 'app.js'));
  expect(/else if \(action === 'openingTrainer'\) openingsGo\('list'\);/.test(APP),
    "the Home tile's 'openingTrainer' action finally has a destination");
  expect(/else if \(current === 'openings'\) renderOpenings\(\);/.test(APP),
    'and the router has a branch for it');
  // Swift's half of the same fix.
  expect(/onOpeningTrainer: gated \{/.test(code(read(UI, 'PhoneView.swift'))),
    'and PhoneView passes onOpeningTrainer at last — gated like every other tile');
}

// ── 11. No numeric literal in the screens ───────────────────────────────────────
//
// `swift_layout_check.js` enforces this for SwiftUI; the browser half needs its own, because a
// hardcoded pixel in `openings.js` would not fail anything else.
{
  const body = code(OPENINGS_JS)
    // Percentages and array indices are not layout constants.
    .replace(/\* 100\) \+ '%'/g, ' ')
    .replace(/\[\d+\]/g, ' ');
  const literals = body.match(/:\s*-?\d+(\.\d+)?px/g) || [];
  expect(literals.length === 0,
    `openings.js writes ${literals.length} pixel literal(s): ${literals.join(', ')}`);
}

// ---- report ------------------------------------------------------------------
const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `ReplayOpeningTree: ${passed} Swift expectations confirmed against the JS`
    : `ReplayOpeningTree: ${passed} confirmed, ${failures.length} BROKEN\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
