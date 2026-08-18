#!/usr/bin/env node
/*
 * board_layout_check.js — the Analysis Board's chessboard must be sized by WIDTH and must not flex.
 *
 *     node tools/qa/board_layout_check.js
 *
 * Why this exists. A user reported two things: the board did not fill the screen, and it grew and
 * shrank on every move. Both were one bug, and it lived entirely in CSS:
 *
 *     .an-board            { flex: 1 1 auto; container-type: size; }
 *     .an-board chess-board{ width: min(100cqw, calc(100cqh - var(--an-eval-h) - 4px)); }
 *
 * `100cqh` is the band's leftover height, so the board's WIDTH tracked the leftover HEIGHT — and the
 * ECO panel and the engine panel both change height on every move as rows appear and vanish. Height
 * being the binding constraint also meant the board never filled the card.
 *
 * Nothing in the repo could see it. `analysis-metrics.js` asserts the right NUMBERS, but the CSS was
 * not asking for them; `metrics_key_check.js` reads JS and Swift, not stylesheets. Every suite was
 * green while the screen was visibly wrong — which is the same failure mode as the annotation badge,
 * one layer down.
 *
 * So: assert the CSS itself. These are structural properties, not pixel values, and each one is a
 * restatement of the bug in a form a stylesheet can be checked against.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'web-demo', 'js', 'analysis.js'), 'utf8');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** The declaration block of a selector, or null. Good enough for this flat stylesheet. */
function rule(selector) {
  const i = CSS.indexOf('\n' + selector + ' {');
  if (i < 0) return null;
  const open = CSS.indexOf('{', i);
  const close = CSS.indexOf('}', open);
  return close < 0 ? null : CSS.slice(open + 1, close);
}

// ---- 1. the board band does not flex -----------------------------------------
const boardBand = rule('.an-board');
expect(boardBand !== null, '.an-board exists');
if (boardBand) {
  expect(/flex:\s*none/.test(boardBand),
    '.an-board must be `flex: none` — a flexible board band is what made the board resize on '
    + 'every move, got: ' + (/(flex:[^;]*)/.exec(boardBand) || ['(no flex)'])[0]);
  expect(!/container-type/.test(boardBand),
    '.an-board must NOT declare container-type — that is what let `cqh` leak into the board width');
}

// ---- 2. the board is sized from the published width, not from a container query ----
const boardEl = rule('.an-board chess-board');
expect(boardEl !== null, '.an-board chess-board exists');
if (boardEl) {
  expect(/width:\s*var\(--an-board-edge\)/.test(boardEl),
    'the board takes its width from --an-board-edge, got: '
    + (/(width:[^;]*)/.exec(boardEl) || ['(none)'])[0]);
  expect(!/cq[whibm]/.test(boardEl), 'and uses no container-query unit');
}
const evalBar = rule('.an-eval');
expect(evalBar !== null && /width:\s*var\(--an-board-edge\)/.test(evalBar),
  'the eval bar matches the board width, so the two cannot drift apart');

// No `cq` unit anywhere in the Analysis Board's section. `.puz-board` legitimately uses them, and
// it sits above that marker. Comments are stripped first — the section explains the old broken rule
// in prose, and a check that cannot tell a declaration from a description is worse than none.
const analysisSection = CSS.slice(CSS.indexOf('/* ---- Analysis Board'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
const cqHits = (analysisSection.match(/\d+cq[whibm]/g) || []);
expect(cqHits.length === 0,
  'no container-query unit survives in the Analysis Board CSS, found: ' + cqHits.join(' '));

// ---- 3. the panels band is the one that gives way ----------------------------
const panels = rule('.an-panels');
expect(panels !== null, '.an-panels exists');
if (panels) {
  expect(/flex:\s*1\s+1\s+auto/.test(panels),
    '.an-panels must be `flex: 1 1 auto` — it absorbs the slack the board refuses to, got: '
    + (/(flex:[^;]*)/.exec(panels) || ['(no flex)'])[0]);
  expect(/min-height:\s*0/.test(panels), 'and `min-height: 0`, or it cannot actually shrink');
}

// ---- 3b. exactly one band gives way, and it is the engine panel --------------
//
// Out of edit mode `.an-panels` is hidden, so the flexible child is `.an-engine`. There must be
// EXACTLY one: with none, a short column leaves a gap; with two, they fight over the slack and a
// fixed band can be squeezed to nothing while its content paints over its neighbours.
//
// This is the CSS half of `swift_layout_check.js` rule 4b. Both languages need it, and they degrade
// differently — flex leaves the gap at the bottom, SwiftUI centres the whole column — so neither
// check stands in for the other.
const VIEW_BANDS = ['.an-header', '.an-board', '.an-statusline', '.an-pvbar', '.an-status',
                    '.an-autoplay', '.an-strip'];
for (const sel of VIEW_BANDS) {
  const band = rule(sel);
  expect(band !== null, sel + ' exists as a band of .an-view');
  if (band) {
    expect(/flex:\s*none/.test(band),
      sel + ' must be `flex: none` — a band that can shrink gets squeezed to nothing by the '
      + 'engine panel and its content paints over its neighbours, got: '
      + (/(flex:[^;]*)/.exec(band) || ['(no flex)'])[0]);
  }
}
const engine = rule('.an-engine');
expect(engine !== null, '.an-engine exists');
if (engine) {
  expect(/flex:\s*1\s+1\s+auto/.test(engine),
    '.an-engine must be `flex: 1 1 auto` — it is the band that gives way now that the book box is '
    + 'a strip, got: ' + (/(flex:[^;]*)/.exec(engine) || ['(no flex)'])[0]);
  expect(/min-height:\s*0/.test(engine), 'and `min-height: 0`, or it cannot actually shrink');
  expect(/justify-content:\s*flex-end/.test(engine),
    'and `justify-content: flex-end`, so the rows stay pinned to the bottom rather than floating '
    + 'in the middle of the slack');
}
// The opening book has NO band at all any more. Inverted rather than deleted: the strip replaced a
// 230px panel and was itself removed one round later, and the way that comes back is by someone
// re-adding a band nobody asked for.
for (const gone of ['.an-bookstrip', '.an-bchip', '.an-bsan', '.an-beco', '.an-brow', '.an-bname',
                    '.an-panel-head', '.an-panel-empty']) {
  expect(rule(gone) === null, gone + ' is gone from the stylesheet — band 6 is edit mode only now');
}
for (const gone of ['bookstrip', 'paintBookStrip', 'bookContinuations', 'an-bchip']) {
  expect(!JS.includes(gone), 'analysis.js no longer mentions ' + gone);
}
// But `.an-hidden` lived inside that block and is NOT part of it — the preview bar, the status line
// and `.an-panels` all toggle with it.
expect(rule('.an-hidden') !== null,
  '.an-hidden survives the book strip it was nested under — the preview bar needs it');
expect(/an-hidden/.test(JS), 'and the JS still uses it');

// ---- 3c. a short screen DROPS engine rows, it does not squash them -----------
//
// `.an-engine` is the band that gives way. Without `flex: none` on the rows, flex shrinks each row
// while its TEXT keeps its own height, and the overflow paints straight over the move strip above —
// which is what a 375x667 SE did. The rows keep their natural size and `.an-rows` clips from the
// bottom, so the third line is lost before the first.
const rowsBox = rule('.an-rows');
expect(rowsBox !== null, '.an-rows exists');
if (rowsBox) {
  expect(/overflow:\s*hidden/.test(rowsBox),
    '.an-rows must clip — an unclipped rows box paints over the move strip on a short screen');
  expect(/min-height:\s*0/.test(rowsBox), 'and `min-height: 0`, or it cannot shrink to clip');
  expect(/flex:\s*0\s+1\s+auto/.test(rowsBox),
    '.an-rows shrinks but never grows, got: ' + (/(flex:[^;]*)/.exec(rowsBox) || ['(no flex)'])[0]);
}
// And the count of rows/lines is a decision, made once, by the shared metrics function — not two
// copies of the arithmetic. `--an-engine-lines` is narrowed from the seed by `planEngine()`.
expect(/function planEngine\s*\(/.test(JS), 'planEngine() exists');
expect(/MET\.enginePlan\(/.test(JS),
  'and it goes through MET.enginePlan — the same pure function AnalysisLayout.enginePlan mirrors '
  + 'and both metrics suites assert, rather than a second copy of the budget');
expect(/planEngine\(/.test(JS.slice(JS.indexOf('function sizeBands'), JS.indexOf('function planEngine'))),
  'and sizeBands() calls it, so a resize re-plans');
expect(/planEngine\(rows\.length\)/.test(JS),
  'and paintEngine re-plans on every paint — a plan cached against the row count never recovers '
  + 'from an early measurement of a half-laid-out screen');

const erow = rule('.an-erow');
expect(erow !== null && /flex:\s*none/.test(erow),
  '.an-erow must be `flex: none` — a squashed row overflows its own box, got: '
  + (/(flex:[^;]*)/.exec(erow || '') || ['(no flex)'])[0]);

// ---- 4. the JS publishes what the CSS asks for -------------------------------
for (const prop of ['--an-board-edge', '--an-panels-h']) {
  expect(CSS.includes('var(' + prop + ')'), 'the CSS reads ' + prop);
  expect(JS.includes("'" + prop + "'"), 'and analysis.js publishes ' + prop);
}
expect(/function sizeBands\s*\(/.test(JS), 'sizeBands() exists');
expect(/MET\.bandLayout\(/.test(JS),
  'and it goes through MET.bandLayout — the pure function the metrics suite already asserts, '
  + 'rather than a second copy of the formula');
expect(!/sizeEditBoard/.test(JS),
  'the phase-11 sizeEditBoard() is gone — one place computes the board size, not two');
expect(!/--an-ed-board/.test(CSS + JS), 'and its custom property with it');

// The resize listener has to detach, or leaving and re-entering the screen stacks them up.
expect(/addEventListener\('resize'/.test(JS), 'a resize listener refits the board');
expect(/removeEventListener\('resize'/.test(JS), 'and removes itself once the screen is gone');

// ---- 5. the status line has its own row --------------------------------------
const statusLine = rule('.an-statusline');
expect(statusLine !== null, '.an-statusline exists — the status text has its own row');
if (statusLine) {
  expect(/min-height:\s*var\(--an-statusline-h\)/.test(statusLine),
    'sized from the metrics layer, not a literal');
}
expect(JS.includes("el('div', 'an-statusline')"), 'and analysis.js renders it');
expect(!/an-status-left/.test(CSS + JS),
  'the old combined status/toolbar wrapper is gone from both files');

// ---- the Engine Settings panel's custom properties ---------------------------
//
// The panel's stylesheet reads `var(--an-eng-…)` and `applyMetricsVars()` sets them from
// `MET.ENGINE_PANEL`. Nothing else connects the two: a typo on either side is a silently
// unstyled panel, and `metrics_key_check.js` reads JS and Swift, not stylesheets. So check the
// two lists against each other in both directions — the same failure mode as the board band
// above, one layer along.
{
  const read = new Set([...CSS.matchAll(/var\((--an-eng-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const set = new Set([...JS.matchAll(/set\('(--an-eng-[a-z0-9-]+)'/g)].map((m) => m[1]));
  expect(read.size > 0, 'the stylesheet reads some --an-eng-* properties at all');
  for (const name of read) {
    expect(set.has(name),
      `app.css reads ${name} but analysis.js never sets it — the panel would draw unstyled`);
  }
  for (const name of set) {
    expect(read.has(name), `analysis.js sets ${name} but no rule reads it — dead metric`);
  }
  // And every value it sets comes out of the metrics module, not a literal.
  const engineVars = /var EP = MET\.ENGINE_PANEL;/.test(JS);
  expect(engineVars, 'the panel\'s numbers come from MET.ENGINE_PANEL, not from literals');
  const literals = [...JS.matchAll(/set\('--an-eng-[a-z0-9-]+',\s*(\d)/g)];
  expect(literals.length === 0,
    `no --an-eng-* property may be set from a literal, found ${literals.length}`);
}

// ---- and the SAME audit over every other --an-* property ---------------------
//
// The block above only covered `--an-eng-*`, the Engine SETTINGS panel. Everything else the screen
// draws — the engine LINES' font sizes, the band heights, the book strip — went unaudited, so a
// renamed `--an-fs-epv` would have drawn unstyled with nothing complaining. Same check, wider net.
//
// `--an-board-edge` and `--an-panels-h` are exempt: `sizeBands()` sets them through
// `root.style.setProperty`, not the `set()` helper, and rule 4 above already pins both.
{
  const VIA_SIZE_BANDS = new Set(['--an-board-edge', '--an-panels-h']);

  // PRE-EXISTING DEAD METRICS, found the moment this audit was widened past `--an-eng-*`. Every
  // one is set by `applyMetricsVars()` and read by no rule in any stylesheet — the branch picker,
  // the PGN modal and the variation modal are all styled by classes now, and their custom
  // properties were never removed. Harmless, but they are 24 numbers pretending to matter.
  //
  // Listed rather than deleted so this change stays about the engine panel; the stale check below
  // makes the list shrink-only, so cleaning them up later is a subtraction and nothing new can
  // join them.
  const KNOWN_DEAD = new Set([
    '--an-success', '--an-danger',
    '--an-md-pgn-scrim', '--an-md-pgn-bg', '--an-md-pgn-r', '--an-md-pgn-pad',
    '--an-md-opt-bg', '--an-md-opt-r', '--an-md-opt-pv', '--an-md-opt-ph', '--an-md-opt-bw',
    '--an-md-opt-bc', '--an-md-opt-main-bc', '--an-md-opt-main-bg', '--an-md-opt-fs',
    '--an-md-opt-prev-fs',
    '--an-md-var-bg', '--an-md-var-r', '--an-md-var-hw', '--an-md-var-hh',
    '--an-md-pick-bg', '--an-md-pick-r', '--an-md-pick-pad', '--an-fs-pick-title',
  ]);

  const read = new Set([...CSS.matchAll(/var\(\s*(--an-[a-z0-9-]+)/g)].map((m) => m[1]));
  const set = new Set([...JS.matchAll(/set\('(--an-[a-z0-9-]+)'/g)].map((m) => m[1]));
  expect(read.size > 20, `only ${read.size} --an-* properties found — the parser probably rotted`);
  // The dangerous direction: a rule reading a property nobody sets renders with nothing.
  for (const name of read) {
    if (VIA_SIZE_BANDS.has(name)) continue;
    expect(set.has(name),
      `app.css reads ${name} but analysis.js never sets it — that rule draws unstyled`);
  }
  for (const name of set) {
    if (KNOWN_DEAD.has(name)) continue;
    expect(read.has(name), `analysis.js sets ${name} but no rule reads it — dead metric`);
  }
  for (const name of KNOWN_DEAD) {
    expect(!read.has(name),
      `${name} is on the known-dead list but IS read now — take it off the list`);
    expect(set.has(name),
      `${name} is on the known-dead list but nothing sets it any more — take it off the list`);
  }
}

// ── 8. The square colours are the EXTRACTED pair, in both languages ──────────────
//
// `tools/metrics/extract_puzzle_styles.js` has captured the real RN board's palette into
// `puzzle_styles.json` -> `shared.board` since the puzzle screens were ported — and NOTHING read
// it. Every board outside the Analysis Board drew an invented `#5BA3F5`/`#2C4A73` blue instead,
// in both languages, for as long as the port has existed. Nothing could see it: no suite anywhere
// asserted a square colour literal, and the two languages agreed with each other, which is exactly
// the "two hand-typed copies agreeing is not verification" trap CLAUDE.md names.
//
// So: pin every place a square colour is written to the extraction. Five writers, one source.
{
  const SRC = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'metrics', 'puzzle_styles.json'), 'utf8'));
  const THEME_CSS = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'theme.css'), 'utf8');
  const CB_JS = fs.readFileSync(path.join(ROOT, 'web-demo', 'js', 'chess-board.js'), 'utf8');
  const AMET_JS = fs.readFileSync(path.join(ROOT, 'web-demo', 'js', 'analysis-metrics.js'), 'utf8');
  const AMET_SWIFT = fs.readFileSync(
    path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'AnalysisMetrics.swift'), 'utf8');

  const board = SRC.shared && SRC.shared.board
    && SRC.shared.board.styles && SRC.shared.board.styles.styles;
  expect(!!board, 'puzzle_styles.json still carries shared.board — the extractor was not narrowed');

  const norm = (c) => String(c || '').trim().toUpperCase();
  const LIGHT = norm(board && board.lightSquare && board.lightSquare.backgroundColor);
  const DARK = norm(board && board.darkSquare && board.darkSquare.backgroundColor);
  expect(/^#[0-9A-F]{6}$/.test(LIGHT) && /^#[0-9A-F]{6}$/.test(DARK),
    `shared.board did not yield a hex pair (got ${LIGHT} / ${DARK})`);
  expect(LIGHT !== DARK, 'the extracted light and dark squares are different colours');

  /**
   * The value of a `--name: value;` declaration in a flat stylesheet.
   * Hand-parsed rather than built into a RegExp: the property name starts with `--`, and a
   * dynamically assembled pattern around it is exactly the kind of escaping a gate should not own.
   */
  const cssVar = (css, name) => {
    const at = css.indexOf(name + ':');
    if (at < 0) return null;
    const end = css.indexOf(';', at);
    return end < 0 ? null : norm(css.slice(at + name.length + 1, end));
  };

  // (a) the browser's global default — the ONLY definition, read only by <chess-board>
  expect(cssVar(THEME_CSS, '--board-light') === LIGHT,
    `theme.css --board-light is ${cssVar(THEME_CSS, '--board-light')}, extraction says ${LIGHT}`);
  expect(cssVar(THEME_CSS, '--board-dark') === DARK,
    `theme.css --board-dark is ${cssVar(THEME_CSS, '--board-dark')}, extraction says ${DARK}`);

  // (b) the component's own fallbacks, for a host that never loads theme.css. These are what a
  //     stray `<chess-board>` renders, so a stale fallback is a real second palette.
  const fallback = (name) => {
    const at = CB_JS.indexOf('var(' + name + ',');
    if (at < 0) return null;
    const m = CB_JS.slice(at).match(/^var\([^,]+,\s*(#[0-9A-Fa-f]{6})\)/);
    return m ? norm(m[1]) : null;
  };
  expect(fallback('--board-light') === LIGHT,
    `chess-board.js falls back to ${fallback('--board-light')}, extraction says ${LIGHT}`);
  expect(fallback('--board-dark') === DARK,
    `chess-board.js falls back to ${fallback('--board-dark')}, extraction says ${DARK}`);

  // (c) the Analysis Board's `classic` theme is the same pair by another route — the client's
  //     reference screenshot IS that theme, and the whole point of this change is that the two
  //     stop disagreeing.
  const jsClassic = AMET_JS.match(
    /classic:\s*\{[^}]*light:\s*'(#[0-9A-Fa-f]{6})'[^}]*dark:\s*'(#[0-9A-Fa-f]{6})'/);
  expect(!!jsClassic, 'analysis-metrics.js still declares BOARD_THEMES.classic');
  expect(!!jsClassic && norm(jsClassic[1]) === LIGHT && norm(jsClassic[2]) === DARK,
    'BOARD_THEMES.classic is the extracted pair');

  // (d) the Swift twin of (c). There is no compiler on this checkout, so it is read as text —
  //     the same stand-in swift_lint.js and swift_symbol_check.js are.
  const swiftClassic = (accessor) => {
    const start = AMET_SWIFT.indexOf('var ' + accessor + ': Color {');
    if (start < 0) return null;
    const stop = AMET_SWIFT.indexOf('\n    }', start);
    const m = AMET_SWIFT.slice(start, stop).match(
      /case \.classic:\s*return Theme\.c\(0x([0-9A-Fa-f]{6})\)/);
    return m ? '#' + norm(m[1]) : null;
  };
  expect(swiftClassic('light') === LIGHT,
    `BoardTheme.classic.light is ${swiftClassic('light')}, extraction says ${LIGHT}`);
  expect(swiftClassic('dark') === DARK,
    `BoardTheme.classic.dark is ${swiftClassic('dark')}, extraction says ${DARK}`);

  // (e) and the shared default — the one every puzzle solver, Play vs Coach and the two macOS
  //     panels inherit by passing no `style:` at all — takes it from the theme rather than
  //     restating a hex or falling back to the legacy blue.
  const styleBody = AMET_SWIFT.slice(AMET_SWIFT.indexOf('struct BoardStyle: Equatable {'),
                                     AMET_SWIFT.indexOf('func dotSize(square:'));
  expect(/var light: Color = BoardTheme\.classic\.light/.test(styleBody)
      && /var dark: Color = BoardTheme\.classic\.dark/.test(styleBody),
    'BoardStyle defaults to BoardTheme.classic, not a hardcoded pair');
  expect(!/var (light|dark): Color = Theme\.board(Light|Dark)/.test(styleBody),
    'BoardStyle no longer defaults to the legacy Theme.boardLight/boardDark blue');

  // (f) the legacy blue must not survive as a SQUARE anywhere. It is still a real colour — the
  //     PlayView level capsule and the PuzzleView rating chip use it — so this checks the two
  //     board writers specifically, not the constant's existence.
  const SQUARE_WRITERS = [
    ['theme.css --board-light', cssVar(THEME_CSS, '--board-light')],
    ['theme.css --board-dark', cssVar(THEME_CSS, '--board-dark')],
    ['chess-board.js light fallback', fallback('--board-light')],
    ['chess-board.js dark fallback', fallback('--board-dark')],
  ];
  for (const [what, value] of SQUARE_WRITERS) {
    expect(value !== '#5BA3F5' && value !== '#2C4A73', `${what} is still the invented blue`);
  }
}

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `BoardLayout: ${passed} CSS/JS layout invariants hold`
    : `BoardLayout: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
