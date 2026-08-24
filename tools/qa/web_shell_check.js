#!/usr/bin/env node
/*
 * web_shell_check.js — what `web-demo/index.html` actually wires, and how the scroll chrome behaves.
 *
 *     node tools/qa/web_shell_check.js
 *
 * Why this exists. Three bugs, one shape: a file or a declaration that is *correct on disk* and
 * never reaches the page. Every JS suite, every Swift check and every replay stayed green through
 * all three, because they all read source rather than asking what the browser loads.
 *
 *   1 · `css/coach.css` was NEVER linked — 507 correct lines, 21 correct `.cgs-*` rules, and
 *       `index.html` listed only theme/app/pairing. It shipped that way from the commit that
 *       introduced Play vs Coach, and became visible the moment `app.js` routed Play to
 *       `BiyaCoachSelect.render`: the coach screens rendered as raw UA buttons, white on white.
 *       The CHANGELOG records this being NOTICED a round earlier — and the guard written for it,
 *       `replay_login.js`, asserts only that `app.css` is linked, so it never fired.
 *       `coach_screen_test.js` reads `coach.css` off disk, which validates a file in complete
 *       isolation from whether the page loads it.
 *
 *   2 · Ten scroll containers showed the bare OS scrollbar. `app.css` states the rule at line 9 —
 *       "Hide scrollbars everywhere for an app-like look" — and applies it to `html, body` plus the
 *       `.an-*` bands only. `scrollbar-width` does not inherit and `::-webkit-scrollbar` on
 *       `html, body` does not cascade, so the rule was documentation, not enforcement.
 *
 *   3 · `resize: vertical` on four textareas. A drag-to-resize handle **does not exist on iOS**, so
 *       every one of them is a control the Swift app cannot have — a cross-language divergence, not
 *       just an eyesore. One of them sat inside a scrolling column and put two scrollbars and a grip
 *       side by side, which is what the client screenshotted.
 *
 * So: assert the wiring and the CSS themselves. Same move `board_layout_check.js` was created for.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web-demo');
const CSS_DIR = path.join(WEB, 'css');
const JS_DIR = path.join(WEB, 'js');

const INDEX = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** Strip CSS comments so a rule described in prose is never mistaken for a rule. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

// ── 1. Every stylesheet on disk is linked, and every link resolves ──────────────
{
  const onDisk = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).sort();
  const linked = [...INDEX.matchAll(/<link rel="stylesheet" href="css\/([^"]+)"/g)].map((m) => m[1]);

  expect(onDisk.length > 0, 'web-demo/css contains stylesheets at all');
  for (const f of onDisk) {
    expect(linked.includes(f),
      `web-demo/css/${f} exists but index.html never links it — it will not load, and every `
      + 'rule in it renders as nothing');
  }
  for (const f of linked) {
    expect(onDisk.includes(f), `index.html links css/${f}, which is not on disk`);
  }
  expect(new Set(linked).size === linked.length, 'no stylesheet is linked twice');

  // theme.css declares the tokens every other sheet reads, so it cannot come second.
  expect(linked[0] === 'theme.css',
    `theme.css must be linked first (it owns the tokens); got ${linked[0]}`);
}

// ── 2. Every script on disk is loaded, or is a worker ───────────────────────────
//
// The allow-list is verified rather than trusted: a file is exempt only if another script actually
// references it, so a genuinely orphaned module cannot hide behind an entry here.
{
  const onDisk = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
  const tags = [...INDEX.matchAll(/<script src="js\/([^"]+)"/g)].map((m) => m[1]);
  const allSources = onDisk.map((f) => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');

  for (const f of onDisk) {
    if (tags.includes(f)) { passed++; continue; }
    // Not in a <script> tag — the only legitimate reason is that something spawns it as a Worker.
    const referenced = allSources.includes("'js/" + f + "'") || allSources.includes('"js/' + f + '"');
    expect(referenced,
      `web-demo/js/${f} is neither in a <script> tag nor referenced by any other script`);
    expect(!referenced || /new Worker\(/.test(allSources),
      `web-demo/js/${f} is referenced but nothing constructs a Worker — check how it loads`);
  }
  for (const f of tags) {
    expect(onDisk.includes(f), `index.html loads js/${f}, which is not on disk`);
  }
  expect(new Set(tags).size === tags.length, 'no script is loaded twice');
}

// ── 3. Every scroll container hides its scrollbar ───────────────────────────────
//
// `scrollbar-width` does not inherit, so the globals on `html, body` do nothing for a nested band.
// Each scroller has to say it itself, and needs the `::-webkit-scrollbar` half too — Chrome on
// Windows, which is what this demo is previewed in, honours only that one.
{
  const SHEETS = ['app.css', 'pairing.css', 'coach.css'];
  let scrollers = 0;

  for (const file of SHEETS) {
    const css = stripComments(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'));

    // Selector + its declaration block, for every rule in the sheet.
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      const body = m[2];
      if (!/overflow(-y)?\s*:\s*(auto|scroll)/.test(body)) continue;
      // A pseudo-element rule is the fix, not a thing needing fixing.
      if (selector.includes('::-webkit-scrollbar')) continue;
      scrollers++;

      expect(/scrollbar-width\s*:\s*none/.test(body),
        `${file}: '${selector}' scrolls but does not set scrollbar-width: none — `
        + 'it will show the bare OS scrollbar');

      // The webkit half has to name the same selector. Compared on the selector's leading token so
      // `.a, .b { overflow }` + `.a::-webkit-scrollbar` is accepted the way the .an-* bands write it.
      const head = selector.split(',')[0].trim();
      const hasWebkit = new RegExp(
        head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*::?-webkit-scrollbar').test(css);
      expect(hasWebkit,
        `${file}: '${head}' sets scrollbar-width but has no ::-webkit-scrollbar rule — `
        + 'Chrome, which this demo is previewed in, ignores the standard property');
    }
  }
  expect(scrollers >= 15,
    `only ${scrollers} scroll containers found across ${SHEETS.join(', ')} — the parser rotted`);
}

// ── 4. No resize grip anywhere ──────────────────────────────────────────────────
//
// `resize` has no counterpart on iOS. A textarea the browser lets you drag-resize is a control the
// Swift app cannot offer, so the mirror must not offer it either.
{
  const SHEETS = ['app.css', 'pairing.css', 'coach.css'];
  let textareas = 0;

  for (const file of SHEETS) {
    const css = stripComments(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      const resize = /resize\s*:\s*([a-z-]+)/.exec(m[2]);
      if (!resize) continue;
      textareas++;
      expect(resize[1] === 'none',
        `${file}: '${selector}' sets resize: ${resize[1]} — iOS has no resize handle, so this is a `
        + 'control the Swift app cannot have');
    }
  }
  // A <textarea> is a scroll container by UA DEFAULT and never declares `overflow`, so the
  // selector scan in section 3 is structurally blind to it — and it was the textarea's own bar,
  // hard against `.op-form`'s, that the client screenshotted. One element rule covers all five.
  const appCss = stripComments(fs.readFileSync(path.join(CSS_DIR, 'app.css'), 'utf8'));
  // Matched on a rule whose selector is the bare element, not `.op-textarea` — hence the leading
  // boundary character rather than a plain substring.
  const bareTextarea = /[^-\w.]textarea\s*\{([^}]*)\}/.exec(appCss);
  expect(!!bareTextarea && /scrollbar-width\s*:\s*none/.test(bareTextarea[1]),
    'app.css has no bare `textarea { scrollbar-width: none }` rule — every textarea in the demo '
    + 'will show its own OS scrollbar, and no selector scan can catch it');
  expect(/textarea::-webkit-scrollbar\s*\{/.test(appCss),
    'and no `textarea::-webkit-scrollbar` rule, which is the half Chrome actually honours');

  // Every <textarea> the JS builds must be covered by a resize rule; a new one with no rule at
  // all gets the UA default, which is `resize: both`.
  const areas = [];
  for (const f of fs.readdirSync(JS_DIR).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    if (/'textarea'|"textarea"/.test(src)) areas.push(f);
  }
  expect(areas.length > 0, 'the demo still builds textareas at all');
  expect(textareas >= areas.length,
    `${areas.length} file(s) build a <textarea> (${areas.join(', ')}) but only ${textareas} rule(s) `
    + 'set resize — one of them is falling through to the UA default of resize: both');
}

// ── 5. A board a piece can be picked up on can be DRAGGED ───────────────────────
//
// The same shape as the three bugs above: correct on disk, dead in the browser. `<chess-board>`
// wants TWO things before a piece will move — `.rules`, which says where it may go, and drag,
// which is OFF until a screen asks for it (`_dragEnabled = false`, chess-board.js:186). Set the
// first and forget the second and you get a board that selects, highlights legal targets and plays
// a move on a tap while ignoring every drag, with nothing anywhere to say so. That is what
// `coach-play.js` shipped, through 34,000 green assertions and a round on a real phone.
//
// So the implication IS the rule: rules ⇒ drag. A board with NEITHER is a display board, and the
// rule exempts it. `swift_layout_check.js` rule 7 is this rule's Swift half, written off
// `onTap`/`onDragMove` because SwiftUI has no `.rules`.
//
// **That exemption now has no subject.** `openings.js` was the demo's last rules-free board, and
// its explorer board became playable when the client asked to be able to step in at a position and
// play their own move. A floor of "at least one exists" over an empty set says nothing, so the arm
// is proved three other ways instead — a NAMED reader exercised on fixtures, an EXACT census, and a
// mutant that makes a real playable board display-shaped. See rule 7's header for the full
// reasoning; the two halves are deliberately identical.
{
  /** JS with comments removed, so a property NAMED in prose never counts as a property SET. */
  const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  /**
   * Does this source BUILD a board, give it `.rules`, and turn drag on?
   *
   * A NAMED function so the arms can be exercised on fixtures — the demo has no rules-free board
   * left to prove them on.
   */
  function readBoard(s) {
    // Both spellings the component honours: the property, or the attribute at any value but the
    // literal 'false' (chess-board.js:204/219). puzzle-board.js and puzzle-solver.js use the
    // attribute and are correct, so a check that demanded the property would fail working code.
    const attr = s.match(/setAttribute\(\s*['"]draggable-pieces['"]\s*,\s*(['"])([^'"]*)\1\s*\)/);
    return {
      isBoard: /createElement\(\s*['"]chess-board['"]\s*\)/.test(s),
      hasRules: /\.rules\s*=/.test(s),
      dragOn: /\.draggablePieces\s*=\s*true/.test(s) || (attr !== null && attr[2] !== 'false'),
    };
  }

  // Both arms, on fixtures. This is what keeps the exemption REACHABLE now that nothing in the
  // demo is exempt by it.
  expect(readBoard("var b = document.createElement('chess-board');").isBoard,
    'a board is still recognised at all');
  expect(!readBoard("var b = document.createElement('chess-board');").hasRules,
    'a board with no .rules is a DISPLAY board and stays exempt — this is the arm with no subject');
  expect(readBoard('b.rules = a; b.draggablePieces = true;').dragOn, 'the property spelling');
  expect(readBoard("b.setAttribute('draggable-pieces', '');").dragOn, 'the attribute spelling');
  expect(!readBoard("b.setAttribute('draggable-pieces', 'false');").dragOn,
    "and 'false' is the one attribute value that means off");
  expect(!readBoard(stripJs('// b.rules = adapter();')).hasRules,
    'a `.rules` NAMED in prose is not a `.rules` SET — the strip is what lets this rule be read in '
    + 'files that document the bug at length');

  const playable = [], displayOnly = [];
  for (const f of fs.readdirSync(JS_DIR).filter((x) => x.endsWith('.js'))) {
    const s = stripJs(fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
    const b = readBoard(s);
    if (!b.isBoard) continue;
    if (!b.hasRules) { displayOnly.push(f); continue; }
    playable.push(f);
    expect(b.dragOn,
      `web-demo/js/${f} gives its board \`.rules\` but never turns drag on. A piece can be picked `
      + 'up and tapped to its square, and dragging it does nothing at all. Set '
      + '`.draggablePieces = true` (or the `draggable-pieces` attribute), or take `.rules` away '
      + 'and mean it — a board with neither is a display board, which is fine.');
  }
  // A floor, so a regex that stops matching cannot report a clean sweep of nothing.
  expect(playable.length >= 6,
    `only ${playable.length} board-building screen(s) matched (${playable.join(', ') || 'none'}) — `
    + 'the detector has stopped finding them, so this rule now passes without reading anything');
  // The census, stated EXACTLY where it used to be floored — and what the mutation harness's
  // 'the rules detector stops discriminating' moves off zero.
  expect(displayOnly.length === 0,
    `${displayOnly.length} rules-free board(s) found (${displayOnly.join(', ') || 'none'}); this `
    + 'demo has none. openings.js was the last one and its explorer board is playable now that you '
    + 'can leave the saved line and play your own move. If you add a deliberately read-only board, '
    + 'change this number and say so in CHANGELOG.md — it is the census, and it is what makes "a '
    + 'board with neither is exempt" falsifiable.');
}

// ---- report ------------------------------------------------------------------
const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `WebShell: ${passed} wiring and scroll-chrome invariants hold`
    : `WebShell: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
