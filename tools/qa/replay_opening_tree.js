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

/** OpeningMetrics.swift, comment-stripped — §15 reads OpeningBoard.edge and engineEvalInk. */
const CORE_MET = code(MET_SRC);

const OT = require(path.join(JS, 'opening-tree.js'));
const MET = require(path.join(JS, 'opening-metrics.js'));
const ST = require(path.join(JS, 'opening-store.js'));

// ── 1. The two constants ────────────────────────────────────────────────────────
{
  const block = blockOf(CORE_SRC, 'OpeningTree');
  expect(block !== null, 'OpeningTree is a type in the Core');
  const m = /static let defaultMaxPlies = (\d+)/.exec(code(CORE_SRC));
  eq(OT.DEFAULT_MAX_PLIES, m ? Number(m[1]) : null, 'defaultMaxPlies');
  // `maxGamesLimit` used to be checked here and is deliberately gone from both languages — it was
  // a transcription of the RN ceiling that got the number wrong (2000 for a form that clamps at
  // 1000) and this assertion read it back to itself. The ceiling lives in `OpeningDownload` now
  // and §12 checks it against the RN source's real value.
  expect(OT.MAX_GAMES_LIMIT === undefined, 'the JS twin has dropped its copy of the ceiling too');
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
  ['--op-barHeight', '--op-barRadius', '--opc-win', '--opc-draw', '--opc-loss', '--opc-loadFill',
    // MEASURED, not tabled. The explorer's board edge depends on the viewport and on whether the
    // engine is on, so it cannot be a `LAYOUT` key — §6 requires every one of those to be a literal
    // `static let name = <number>` in the Swift. `sizeExplorer` sets it through `MET.boardEdge`,
    // which is the one entry point both the board and the rail read.
    '--op-boardEdge']
    .forEach((k) => set.add(k));
  // …and it really is set, through the one function. A property listed here but never written is
  // an exemption with nothing under it.
  expect(/root\.style\.setProperty\('--op-boardEdge', MET\.boardEdge\(/.test(OPENINGS_JS),
    'openings.js sets --op-boardEdge through MET.boardEdge — not by hand, and not from two places');

  // The rail's own properties come from the ANALYSIS table, because it is the analysis rail. They
  // are set on this screen's root too, since `analysis.js` sets them on a root this screen is not
  // inside — so they are excluded from the audit above rather than duplicated into MET.LAYOUT.
  for (const k of ['--an-rail-w', '--an-rail-r', '--an-rail-pad-v', '--an-rail-gap',
                   '--an-eval-anim', '--an-fs-rail', '--an-eval-track', '--an-eval-fill',
                   '--an-on-gold', '--an-text']) {
    expect(OPENINGS_JS.includes("set('" + k + "'"),
      `openings.js sets ${k} — the rail is drawn by .an-eval, whose properties analysis.js sets on `
      + 'a root this screen is never inside');
  }
  expect(!/setProperty\('--an-board-edge'/.test(OPENINGS_JS),
    'and NOT --an-board-edge: the rail is as tall as THIS screen`s board, which is --op-boardEdge; '
    + 'setting the analysis one would give it the other screen`s height');

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
  const order = ['js/opening-tree.js', 'js/opening-metrics.js', 'js/opening-download.js',
                 'js/opening-store.js', 'js/openings.js'];
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

// ── 12. The download ────────────────────────────────────────────────────────────
//
// The client's bug: picking Lichess or Chess.com validated the username and then set
// `errNetwork` — "Could not reach that site. Check your connection and try again." — for a
// download that had never been written. It survived 346 green expectations because §7 below
// asserted only that the two sources were MARKED online, and the JS selfTest asserted the refusal
// itself ("and then says the download is not wired"). A test that pins the bug is worse than no
// test: it makes the bug look decided.
//
// So this section checks the thing that actually broke — that picking an online source starts a
// download — and then that the two languages agree about what that download IS.
{
  const DOWN_SRC = read(CORE, 'OpeningDownload.swift');
  const DOWN_CODE = code(DOWN_SRC);
  const LOADER_SRC = read(UI, 'OpeningDownloader.swift');
  const DL = require(path.join(JS, 'opening-download.js'));

  // -- the regression guard, first. Both languages, both sources. --------------
  for (const site of ['lichess', 'chesscom']) {
    expect(new RegExp(`case \\.${site}:\\s*\\n\\s*startDownload\\(site: \\.${site},`)
      .test(code(SCREENS_SRC)), `picking ${site} starts a download in Swift, not an apology`);
  }
  // `errNetwork` may still be SET — a download really can fail — but only from a `catch`. Set
  // anywhere else it is the old refusal wearing the new code's clothes, which is exactly how this
  // bug would come back: someone adds an early return for a case they have not wired yet.
  {
    const screens = code(SCREENS_SRC);
    const uses = [];
    let at = screens.indexOf('errNetwork');
    while (at >= 0) { uses.push(at); at = screens.indexOf('errNetwork', at + 1); }
    expect(uses.length > 0, 'the Swift form can still report a real outage');
    for (const i of uses) {
      expect(/\bcatch\b[^{]*\{[^{}]*$/.test(screens.slice(Math.max(0, i - 240), i)),
        'and every errNetwork it sets is inside a catch, not an unwired early return');
    }
  }
  expect(/return \{\s*\n?\s*download: \{/.test(code(OPENINGS_JS)),
    'the JS submit returns a download PLAN for an online source');
  expect(!/isOnlineSource\(form\.source\)[\s\S]{0,200}errNetwork/.test(code(OPENINGS_JS)),
    'and no longer returns errNetwork for one');

  // -- the limits ---------------------------------------------------------------
  const num = (name) => {
    const m = new RegExp(`static let ${name} = (\\d+)`).exec(DOWN_CODE);
    return m ? Number(m[1]) : null;
  };
  eq(DL.FREE_MAX_GAMES, num('freeMaxGames'), 'freeMaxGames');
  eq(DL.PREMIUM_MAX_GAMES, num('premiumMaxGames'), 'premiumMaxGames');
  eq(DL.MIN_MAX_GAMES, num('minMaxGames'), 'minMaxGames');
  // The constant this feature was built on top of a transcription error: `OpeningTree` carried
  // `maxGamesLimit = 2000` described as "the download ceiling the RN form offers", and the parity
  // check read that constant back to itself. The RN form's ceiling is 1000, twice over —
  // `Math.min(…, 1000)` at openingtree.tsx:479 and :917.
  eq(DL.PREMIUM_MAX_GAMES, 1000, 'the RN form ceiling, which is 1000 and was written as 2000');
  expect(!/maxGamesLimit/.test(CORE_CODE), 'and the wrong constant is gone rather than corrected');

  // `resolvedMax` is the one piece of arithmetic here, so it is replayed rather than read.
  eq(DL.resolvedMax(false, 900), DL.FREE_MAX_GAMES, 'free ignores the box');
  eq(DL.resolvedMax(true, 900), 900, 'premium gets what it asks for');
  eq(DL.resolvedMax(true, 99999), DL.PREMIUM_MAX_GAMES, 'and is clamped at the ceiling');
  eq(DL.resolvedMax(true, 0), DL.MIN_MAX_GAMES, 'an empty box is one game, not none');
  expect(/guard isPremium else \{ return freeMaxGames \}/.test(DOWN_CODE),
    'and the Swift takes the same two branches');
  expect(/min\(max\(requested, minMaxGames\), premiumMaxGames\)/.test(DOWN_CODE),
    'in the same order — clamp low, then high');

  // -- the endpoints ------------------------------------------------------------
  //
  // Compared as SUBSTRINGS of the Swift literal rather than by reconstructing its interpolation:
  // the point is that neither language can quietly change host, path or query.
  const lich = DL.lichessGamesURL('bob', 7);
  eq(lich, 'https://lichess.org/api/games/user/bob?pgnInJson=true&max=7', 'the lichess URL');
  expect(DOWN_SRC.includes('https://lichess.org/api/games/user/'),
    'and the Swift builds the same host and path');
  expect(DOWN_SRC.includes('?pgnInJson=true&max='),
    'with the same query — pgnInJson is what puts `moves` on each line');
  const cc = DL.chesscomArchivesURL('bob');
  eq(cc, 'https://api.chess.com/pub/player/bob/games/archives', 'the chess.com archives URL');
  expect(DOWN_SRC.includes('https://api.chess.com/pub/player/')
    && DOWN_SRC.includes('/games/archives'), 'and the Swift builds that one too');
  const accept = /static let lichessAccept = "([^"]+)"/.exec(DOWN_SRC);
  eq(DL.LICHESS_ACCEPT, accept ? accept[1] : null, 'the NDJSON Accept header');

  // A username must not be able to escape its path segment. `CharacterSet.urlPathAllowed` would
  // let `/` through, which is why the Swift spells `encodeURIComponent`'s set out by hand.
  eq(DL.lichessGamesURL('a/b', 1),
    'https://lichess.org/api/games/user/a%2Fb?pgnInJson=true&max=1',
    'a slash in a username is escaped');
  const allowed = /charactersIn:\s*\n?\s*"([^"]+)"\)/.exec(DOWN_SRC);
  expect(allowed !== null, 'the Swift names its allowed set');
  if (allowed) {
    for (const ch of ['/', ':', '@', '+', '&', '?', '#', ' ']) {
      expect(!allowed[1].includes(ch),
        `and it does NOT permit ${JSON.stringify(ch)}, which would change the endpoint`);
    }
  }

  // -- what a status means ------------------------------------------------------
  eq(DL.failureForStatus(404), 'unknownUser', '404 is a username the site does not have');
  eq(DL.failureForStatus(500), 'network', 'and anything else is worth retrying');
  expect(/code == 404 \? \.unknownUser : \.network/.test(DOWN_CODE),
    'the Swift makes the same one-case distinction');
  expect(/\(200\.\.\.299\)\.contains\(code\)/.test(DOWN_CODE), 'and accepts the same 2xx range');
  expect(DL.isSuccess(200) && DL.isSuccess(299) && !DL.isSuccess(300) && !DL.isSuccess(199),
    'as does the JS');
  const failCases = /enum Failure[^{]*\{\s*case (\w+)\s*\n\s*case (\w+)/.exec(DOWN_SRC);
  expect(failCases !== null, 'Failure has exactly two cases in Swift');
  if (failCases) {
    eq(Object.keys(DL.FAILURES).join(','), `${failCases[1]},${failCases[2]}`, 'and the JS agrees');
  }
  const siteCases = /enum Site[^{]*\{\s*case ([\w, ]+)\n/.exec(DOWN_SRC);
  eq(Object.keys(DL.SITES).join(','),
    siteCases ? siteCases[1].split(',').map((s) => s.trim()).join(',') : null, 'the site ids');

  // -- the aborted-game deviation ----------------------------------------------
  //
  // The RN mapping scores a game with no winner as a DRAW, so an aborted game — very often the
  // first in a stream — becomes half a point for both sides. `OpeningTree.Outcome` already
  // decided the other way for pasted PGN, and two import paths disagreeing about one game is
  // worse than the bug being fixed. Both languages must carry the same status list.
  const statuses = /lichessUnfinishedStatuses: Set<String> =\s*\n?\s*\[([^\]]+)\]/.exec(DOWN_SRC);
  expect(statuses !== null, 'Swift lists the unfinished statuses');
  if (statuses) {
    const swift = statuses[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    eq(DL.LICHESS_UNFINISHED.join(','), swift.join(','), 'the unfinished statuses, in order');
    expect(swift.includes('aborted'), 'and "aborted" is one of them — the whole point');
  }
  expect(DL.lichessOutcome({ winner: 'white' }) === '1-0'
    && DL.lichessOutcome({ winner: 'black' }) === '0-1'
    && DL.lichessOutcome({ status: 'draw' }) === '1/2-1/2'
    && DL.lichessOutcome({ status: 'aborted' }) === null,
    'and the JS mapping is winner / draw / no-result');
  expect(/case "white": return \.whiteWin/.test(DOWN_CODE)
    && /case "black": return \.blackWin/.test(DOWN_CODE)
    && /contains\(status\) \? nil : \.draw/.test(DOWN_CODE),
    'as is the Swift one');

  // -- the colour rule ----------------------------------------------------------
  //
  // The online path reads the colour off the GAME and lets the picker filter, where the RN screen
  // takes the picker as the answer and mislabels every game the user had the other colour in.
  expect(/if let w = name\("white"\), w\.caseInsensitiveCompare\(wanted\) == \.orderedSame/
    .test(DOWN_CODE), 'Swift matches the username case-insensitively against White');
  eq(DL.lichessUserIsWhite({ players: { white: { user: { name: 'Bob' } } } }, 'bob', false), true,
    'and so does the JS');
  eq(DL.lichessUserIsWhite({ players: { black: { user: { name: 'Bob' } } } }, 'bob', true), false,
    'Black too');
  eq(DL.lichessUserIsWhite({}, 'bob', true), true, 'an unmatched game falls back to the picker');
  expect(/colour\.accepts\(isWhite: game\.userIsWhite\)/.test(DOWN_CODE),
    'and the picker FILTERS in Swift, exactly as it does on the paste path');

  // -- the ceiling, and the archive order ---------------------------------------
  eq(DL.trim([1, 2, 3], 0, 2).length, 2, 'a chunk is trimmed to the room left');
  eq(DL.trim([1, 2, 3], 2, 2).length, 0, 'and nothing survives once the ceiling is reached');
  expect(/let room = limit - have/.test(DOWN_CODE) && /Array\(games\.prefix\(room\)\)/.test(DOWN_CODE),
    'the Swift trims the same way');
  eq(DL.chesscomArchives({ archives: ['2024/01', '2024/02'] })[0], '2024/02',
    'archives come back NEWEST first');
  expect(/\.reversed\(\)/.test(DOWN_CODE),
    'and the Swift reverses too — oldest-first would build every tree from the user’s first month');

  // -- the transport is in ONE file ---------------------------------------------
  //
  // Spec §0.1: "the only URLSession calls in the entire app live in ContentClient and
  // VideoPlayer". Neither exists yet and this download reached the client first, so
  // OpeningDownloader is that rule's first inhabitant — and it stays the ONLY one.
  expect(!/URLSession|URLRequest/.test(DOWN_CODE),
    'the parity core opens no socket — it only describes the request');
  expect(/URLSession/.test(LOADER_SRC), 'OpeningDownloader is where the transport lives');
  const uiFiles = fs.readdirSync(UI).filter((f) => f.endsWith('.swift'));
  const networked = uiFiles.filter((f) =>
    /URLSession|URLRequest/.test(code(fs.readFileSync(path.join(UI, f), 'utf8'))));
  eq(networked.join(','), 'OpeningDownloader.swift',
    'and it is the ONLY file in BiyaherongUI that does');
  expect(uiFiles.length > 20, `swept ${uiFiles.length} UI files — the sweep is not vacuous`);

  // Same rule in the browser: one file with `fetch`, and it is the twin.
  const jsFiles = fs.readdirSync(JS).filter((f) => f.endsWith('.js'));
  const fetching = jsFiles.filter((f) =>
    /\bfetch\(|XMLHttpRequest/.test(code(fs.readFileSync(path.join(JS, f), 'utf8'))));
  eq(fetching.join(','), 'opening-download.js', 'exactly one web-demo file fetches');
  expect(jsFiles.length > 20, `swept ${jsFiles.length} JS files — the sweep is not vacuous`);

  // -- and cancellation is real -------------------------------------------------
  expect(/\.onDisappear \{ download\?\.cancel\(\)/.test(code(SCREENS_SRC)),
    'leaving the Swift form cancels the download');
  expect(/Task\.checkCancellation\(\)/.test(code(LOADER_SRC)),
    'and the loader checks for it inside both loops');
  expect(/openingForm !== form/.test(code(read(path.join(ROOT, 'web-demo'), 'js/app.js'))),
    'and the browser drops a download that resolves into a screen the user has left');
}

// ── 13. Off book — the distinction the explorer could not make ──────────────────
//
// `children(at:)` answers empty both at a leaf and for a path that has left the tree, so one card
// meant two things and Forward was dead either way. `bookDepth` is the same walk reporting WHERE
// IT STOPPED. Everything below runs in the JS and is checked against the Swift source text.
{
  const core = CORE_CODE.slice(CORE_CODE.indexOf('public func bookDepth(along path:'));
  expect(core.length > 60, 'bookDepth is in the Core, beside children(at:)');
  expect(/guard let next = level\[san\] else \{ return depth \}/.test(core),
    'and it RETURNS the depth it reached rather than falling out with [:] — the whole difference '
    + 'between "your games stop here" and "you played something none of them did"');

  const t = OT.create();
  OT.addGame(t, { sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true, outcome: OT.OUTCOMES.whiteWin });
  eq(OT.bookDepth(t, []), 0, 'the empty path is zero plies into the book');
  eq(OT.bookDepth(t, ['e4']), 1, 'one on-book ply');
  eq(OT.bookDepth(t, ['e4', 'c5', 'Nf3']), 3, 'the whole line');
  eq(OT.bookDepth(t, ['d4']), 0, 'a first move nobody played is zero, not one');
  eq(OT.bookDepth(t, ['e4', 'e5']), 1, 'a divergence at ply two reports ply one');
  eq(OT.bookDepth(t, ['e4', 'e5', 'Nf3']), 1, 'and stays there however far the user plays on');
  eq(OT.bookDepth(t, ['e4', 'c5', 'Nf3', 'd6']), 3,
    'playing on past a LEAF is off book too — a leaf and a divergence give the same answer');
  eq(OT.bookDepth(t, ['Zz9']), 0, 'an unreadable SAN is simply not in the tree');

  // The transposition, asserted as a DECISION rather than discovered as a surprise.
  eq(OT.bookDepth(t, ['Nf3', 'c5', 'e4']), 0,
    '1.Nf3 c5 2.e4 transposes into 1.e4 c5 2.Nf3 and is STILL off book: the tree is keyed by the '
    + 'LINE you played, not by the position, which is why OpeningBook exists and keys by FEN');

  const m = /static let maxFreePlies = (\d+)/.exec(CORE_CODE);
  eq(OT.MAX_FREE_PLIES, m ? Number(m[1]) : null, 'maxFreePlies');
  expect(OT.MAX_FREE_PLIES > 0 && OT.MAX_FREE_PLIES % 2 === 0,
    'the free-play cap is a whole number of full moves');
  expect(OT.MAX_FREE_PLIES < OT.DEFAULT_MAX_PLIES,
    'and shorter than the tree itself — a wander, not a second game');
}

// ── 14. The two stores agree about leaving the book and getting back ────────────
{
  const store = code(STORE_SRC);
  // Derived, not decided a second way. Two definitions of "off book" is two answers.
  expect(/var isOffBook: Bool \{ bookDepth < path\.count \}/.test(store),
    'Swift derives isOffBook from bookDepth rather than tracking a flag of its own');
  expect(/var freePlies: Int \{ path\.count - bookDepth \}/.test(store), 'and freePlies with it');
  expect(/path = Array\(path\.prefix\(bookDepth\)\)/.test(store),
    'backToTree truncates to bookDepth — one definition of where the book ended, not a second '
    + 'count of the way out');
  expect(/guard freePlies < OpeningTree\.maxFreePlies else \{ return false \}/.test(store),
    'and the cap lives in play(), which is the one place a move enters the path — a cap on the '
    + 'board handler alone would be bypassed by every other route');

  const JSSTORE = code(read(JS, 'opening-store.js'));
  expect(/api\.bookDepth\(\) < path\.length/.test(JSSTORE), 'the JS derives it the same way');
  expect(/path\.slice\(0, api\.bookDepth\(\)\)/.test(JSSTORE), 'and truncates the same way');
  expect(/if \(api\.freePlies\(\) >= OT\.MAX_FREE_PLIES\) return false;/.test(JSSTORE),
    'and caps in the same place');

  // Executed, not just read: the whole round trip out of the book and back in.
  const ST_ = require(path.join(JS, 'opening-store.js'));
  function mem() {
    const map = {};
    return { getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
             setItem: (k, v) => { map[k] = String(v); },
             removeItem: (k) => { delete map[k]; } };
  }
  const s = ST_.create(mem());
  const tree = ST_.build({
    games: [{ sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true, outcome: OT.OUTCOMES.whiteWin }],
    name: 'x', colour: 'both', source: 'pgn', username: '', nowMs: 1 });
  s.add(tree); s.openTree(tree.id);
  expect(!s.isOffBook(), 'the root is on book');
  s.play('e4');
  expect(!s.isOffBook() && s.candidates().length === 1, 'a tree move stays on book');
  expect(s.play('e5') === true, 'a legal move no game played is accepted');
  expect(s.isOffBook() && s.freePlies() === 1, 'and it is one ply off book');
  expect(s.candidates().length === 0 && !s.canStepForward(),
    'off book there are no candidates and Forward is dead');
  s.stepBack();
  expect(!s.isOffBook(), 'a single Back over the divergence is also a way home');
  s.play('e5');
  s.backToTree();
  expect(!s.isOffBook() && s.path().join(' ') === 'e4', 'and backToTree is the one-step way');

  // The highest-risk bug in the whole feature, asserted directly: a move made on the BOARD must
  // land on the tree's own branch. Spell the SAN by hand anywhere and an ON-book move reads as
  // off book — the board advances, the list empties, and nothing says why.
  const E = require(path.join(JS, 'engine.js'));
  const start = E.start();
  eq(E.san(start, E.parseUci(start, 'e2e4')), 'e4',
    'e2e4 resolves to the SAN the tree is keyed by');
  const s2 = ST_.create(mem());
  s2.add(tree); s2.openTree(tree.id);
  s2.play(E.san(start, E.parseUci(start, 'e2e4')));
  expect(!s2.isOffBook(),
    'so a move made on the board lands on the tree`s own branch rather than beside it');
}

// ── 15. The engine is the SHARED engine ─────────────────────────────────────────
//
// This screen is the third consumer of one search (the Analysis Board, the puzzle hint panel, and
// now the explorer). The way that goes wrong is not a crash: it is a screen quietly acquiring its
// own depth, its own multiPV or its own debounce, which then disagrees with the others for reasons
// nobody can see. So the numbers are asserted to come from the shared tables and NEVER be literals.
{
  const vm = code(read(UI, 'OpeningEngineVM.swift'));
  const app = code(read(path.join(ROOT, 'web-demo'), 'js/app.js'));

  expect(/LocalEngine\(\)/.test(vm), 'Swift runs the same LocalEngine as every other screen');
  expect(/AnalysisEngineLimits\.maxDepth/.test(vm) && /AnalysisEngineLimits\.multiPV/.test(vm),
    'with AnalysisEngineLimits — NOT the Analysis Board`s EngineSettings preset, which is that '
    + "screen's setting and not this one's");
  expect(!/EngineSettings/.test(vm), 'and it does not reach for that preset at all');
  expect(/AnalysisSession\.engineRows\(from:/.test(vm),
    'the rows come from AnalysisSession.engineRows — static for exactly this reason');
  expect(/AnalysisEval\.fraction\(parts:/.test(vm) && /AnalysisSession\.evalParts\(from:/.test(vm),
    'and the rail fraction from the shared parts, so a finished game pins it rather than reading '
    + 'as a large evaluation');
  expect(/AnalysisTiming\.analysisDebounceMs/.test(vm), 'the debounce is the shared one');
  expect(!/SearchLimits\(maxDepth: \d/.test(vm) && !/multiPV: \d/.test(vm),
    'and NO depth or multiPV is written as a number here');

  expect(/HOST|BiyaEngineHost/.test(app), 'the browser goes through the shared engine host');
  expect(/BiyaAnalysisMetrics\.ENGINE_LIMITS\.maxDepth/.test(app)
    && /BiyaAnalysisMetrics\.ENGINE_LIMITS\.multiPV/.test(app),
    'with the same limits table');
  expect(/BiyaAnalysisMetrics\.TIMINGS\.analysisDebounce/.test(app),
    'and the same debounce');
  expect(/BiyaAnalysis\.engineRows\(/.test(app),
    'and the same row builder — the twin of AnalysisSession.engineRows');

  // The toggle defaults OFF in both languages. It is the client's own answer, and a screen that
  // starts searching the moment it opens is a different product.
  expect(/@Published private\(set\) var engineOn = false/.test(vm),
    'the Swift toggle starts OFF');
  expect(/var engineOn = false;/.test(app), 'and so does the browser one');

  // Cancellation is real in both. The Swift has a Task to cancel; the browser cannot un-send a
  // search, so it invalidates by token and every callback re-checks.
  expect(/Task\.checkCancellation|token\.isCancelled/.test(vm),
    'the Swift search is cancellable from the main actor');
  expect(/\.onDisappear \{ engine\.stop\(\) \}/.test(code(SCREENS_SRC)),
    'and leaving the explorer stops it — a detached Task is not cancelled by deinit');
  expect(/\.onChange\(of: store\.path\)/.test(code(SCREENS_SRC)),
    'and every step of the walk re-schedules it');
  expect(/token !== engineToken/.test(app),
    'the browser invalidates by token, and every callback re-checks it');

  // The rail leaves the layout with the engine. A hidden-but-present rail keeps its own width AND
  // the row's gap, so the board would gain nothing and the row would sit off-centre by half of both.
  expect(/if engine\.engineOn \{ evalRail\(height: edge\) \}/.test(code(SCREENS_SRC)),
    'Swift draws the rail only when the engine is on');
  expect(/'an-eval op-eval' \+ \(engineState\.on \? '' : ' off'\)/.test(OPENINGS_JS),
    'and the browser toggles `off` on the same class the Analysis Board uses');
  expect(/\.an-eval\.off \{ display: none; \}/.test(APP_CSS),
    'which is display:none — never visibility or an opacity');

  // ONE entry point for the width, and both consumers go through it.
  expect(/OpeningBoard\.edge\(screenWidth: width, engineOn: engine\.engineOn\)/
    .test(code(SCREENS_SRC)), 'the Swift board edge comes from OpeningBoard.edge');
  expect(!/AnalysisEval\.railTotal/.test(code(SCREENS_SRC)),
    'and the screen never subtracts the rail by hand — that is the edge function`s job');
  eq(MET.boardEdge(390, false), 390, 'engine off, the browser board is full width');
  eq(MET.boardEdge(390, true), 390 - 25, 'and engine on it gives back exactly the rail');
  expect(/max\(0, screenWidth - \(engineOn \? AnalysisEval\.railTotal : 0\)\)/.test(CORE_MET),
    'and the Swift computes it the same way, reading railTotal rather than copying 25');

  // The RN eval-colour bug, NOT reproduced.
  eq(MET.engineEvalInk('M-3'), MET.PALETTE.errorText,
    'a BLACK mate is red. The RN getEvalColor tests startsWith("M") before startsWith("M-"), so '
    + 'M-3 comes back green there — the losing side`s own forced mate painted as an advantage');
  eq(MET.engineEvalInk('M3'), MET.PALETTE.doneText, 'and a white mate is green');
  eq(MET.engineEvalInk('-0.7'), MET.PALETTE.errorText, 'a negative eval is red');
  eq(MET.engineEvalInk('+1.3'), MET.PALETTE.doneText, 'a positive one is green');
  eq(MET.engineEvalInk(''), MET.PALETTE.muted, 'and nothing at all is muted');
  expect(/hasPrefix\("M-"\)/.test(CORE_MET) && /hasPrefix\("-"\) \|\| text\.hasPrefix\("M-"\)/
    .test(CORE_MET), 'and the Swift checks the minus FIRST, which is the whole fix');
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
