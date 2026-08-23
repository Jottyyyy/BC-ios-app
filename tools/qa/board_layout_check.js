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
  // The band is a ROW now: the eval rail sits beside the board, not under it.
  expect(/flex-direction:\s*row/.test(boardBand),
    '.an-board is a ROW — the eval rail sits beside the board, not under it, got: '
    + (/(flex-direction:[^;]*)/.exec(boardBand) || ['(none)'])[0]);
  expect(/align-items:\s*flex-start/.test(boardBand),
    'and top-aligned, so the rail and the board share a top edge');
  expect(/justify-content:\s*center/.test(boardBand),
    'and centred, so rail + gap + board sits in the middle of the phone');
  expect(/gap:\s*var\(--an-rail-gap\)/.test(boardBand),
    'and the gap between them comes from the metrics layer, not a literal');
  // The two spellings that would silently undo the decision.
  expect(!/flex-direction:\s*column/.test(boardBand),
    'and never column — that is the old bar-under-the-board layout');
  expect(!/row-reverse/.test(boardBand),
    'and never row-reverse — the rail is on the LEFT and the side is FIXED, it does not mirror');
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
// ---- 2b. the eval RAIL ---------------------------------------------------------
//
// This rule used to read "the eval bar matches the board WIDTH, so the two cannot drift apart",
// back when the bar was an 8px strip under the board. The bar is a vertical rail on the left now.
// Same invariant, other axis — RESTATED rather than deleted, because deleting it is exactly how a
// deviation gets smuggled instead of declared.
const evalRail = rule('.an-eval');
expect(evalRail !== null, '.an-eval exists — the vertical eval rail');
if (evalRail) {
  expect(/height:\s*var\(--an-board-edge\)/.test(evalRail),
    'the rail is exactly as tall as the board is wide, so the two cannot drift apart, got: '
    + (/(height:[^;]*)/.exec(evalRail) || ['(none)'])[0]);
  expect(/width:\s*var\(--an-rail-w\)/.test(evalRail),
    'and its width comes from the metrics layer, not a literal');
  expect(!/width:\s*var\(--an-board-edge\)/.test(evalRail),
    'and it is NOT the old full-width horizontal bar — there is ONE main eval bar, on the side');
  expect(/flex:\s*none/.test(evalRail),
    '.an-eval must be `flex: none` — a flexible rail eats the width the board was sized for');
  expect(!/cq[whibm]/.test(evalRail), 'and uses no container-query unit');
}
// The fill grows UPWARD from the bottom. Anchor it at the top and the rail reads INVERTED, with no
// other symptom whatsoever — the eval is White-relative and White is always at the bottom.
const evalFill = rule('.an-eval .fill');
expect(evalFill !== null && /bottom:\s*0/.test(evalFill),
  'the rail fill is anchored at the BOTTOM — White grows upward');
expect(evalFill !== null && /transition:\s*height/.test(evalFill),
  'and animates its HEIGHT, not the old width');
// Both label ends exist and are inked differently, or one of them is invisible against its ground.
const lblBottom = rule('.an-eval .lbl.bottom');
const lblTop = rule('.an-eval .lbl.top');
expect(lblBottom !== null && /bottom:\s*0/.test(lblBottom) && /color:/.test(lblBottom),
  'the label has a BOTTOM placement with its own ink (dark, on the white fill)');
expect(lblTop !== null && /top:\s*0/.test(lblTop) && /color:/.test(lblTop),
  'and a TOP one (light, on the dark track)');
expect(lblBottom !== null && lblTop !== null
  && /color:\s*([^;]+)/.exec(lblBottom)[1] !== /color:\s*([^;]+)/.exec(lblTop)[1],
  'and they are DIFFERENT colours — the whole point is that the label lands on solid contrast');

// ---- 2c. the board stack is exactly the board box ------------------------------
const stack = rule('.an-board-stack');
expect(stack !== null && /flex:\s*none/.test(stack) && /width:\s*var\(--an-board-edge\)/.test(stack),
  '.an-board-stack is `flex: none` and exactly --an-board-edge wide — `.an-badge` is `inset: 0` '
  + 'against it and paintBadge builds the badge viewBox from its measured width, so a stack that '
  + 'stretched to include the rail would put every annotation badge off by the rail width');

// ---- 2d. the rail is a fixed-side SIBLING, in the JS ----------------------------
//
// The failure mode this guards is silent: put the rail anywhere that adds leading width to what
// `.an-badge` measures, and every badge slides right by the rail's width while the board still
// looks perfect. `swift_layout_check.js` §4d is the SwiftUI twin — the two renderers degrade
// differently, so neither stands in for the other.
{
  const a = JS.indexOf("el('div', 'an-board')");
  const b = JS.indexOf("el('div', 'an-statusline')");
  expect(a >= 0 && b > a, 'the band-building block is where it was — the slice found nothing');
  const bandBuild = JS.slice(a, b);
  expect(bandBuild.indexOf("'an-eval'") >= 0
    && bandBuild.indexOf('boardBand.appendChild(evalBar)') >= 0
    && bandBuild.indexOf('boardBand.appendChild(evalBar)')
       < bandBuild.indexOf('boardBand.appendChild(boardStack)'),
    'the rail is appended to .an-board BEFORE the board stack — it lives on the LEFT');
  expect(!/boardStack\.appendChild\(evalBar\)/.test(JS),
    'and it is a SIBLING of .an-board-stack, never a child of it');
  // ONE entry point picks the edge, because the rail is only there when the ENGINE is: switching
  // the engine off drops the snapshot, so the rail would sit at a dead 50/50 with no number, and
  // the board takes that width back. sizeBands() and planEngine() must agree about how wide the
  // board is — budget against the other one and the panel is sized for a board not on screen.
  expect(/MET\.boardEdge\(box\.width,[^)]*session\.autoAnalyze\)/.test(JS),
    'sizeBands() takes the edge from MET.boardEdge(..., session.autoAnalyze) — the one function '
    + 'that decides whether the rail is costing the board any width');
  expect(!/MET\.boardSize\(/.test(JS) && !/MET\.boardSizeBesideRail\(/.test(JS),
    'and never either branch directly: two call sites picking for themselves is how the board and '
    + "the engine panel's budget drift apart");
  // The rail leaves the LAYOUT when the engine is off, not merely the eye. A hidden-but-present
  // rail keeps its width and .an-board's gap, so the board gains nothing and the row sits
  // off-centre by half of both — visible, and invisible to every metrics assertion.
  const railOff = rule('.an-eval.off');
  expect(railOff !== null && /display:\s*none/.test(railOff),
    '.an-eval.off is \`display: none\` — not visibility/opacity, which keeps the width and gap');
  expect(/ui\.evalRail\.classList\.toggle\('off', !session\.autoAnalyze\)/.test(JS),
    'and paintEval puts that class on exactly when the engine is off');
  // Toggling the engine changes the board's width, so the bands have to be re-fitted. Nothing else
  // calls sizeBands on a toggle: without this the board keeps the old edge until the next resize.
  {
    const t = JS.indexOf("'Toggle the engine'");
    expect(t >= 0, 'the engine toggle button is where it was');
    const handler = JS.slice(t, t + 600);
    expect(/sizeBands\(\)/.test(handler),
      'the engine toggle calls sizeBands() — the rail appears and disappears with it, so the '
      + 'board\'s width changes and the old edge would otherwise survive until the next resize');
  }
  expect(/MET\.evalLabelAtBottom\(/.test(JS),
    'and which end the label hangs off is the shared pure function, not a second `f >= 0.5` here');
  expect(/ui\.evalFill\.style\.height/.test(JS),
    'paintEval sets the RAIL fill height — setting width again would leave the rail frozen');
  expect(/ui\.microFill\.style\.width/.test(JS),
    'and still sets the micro bar WIDTH — that one is a different bar and is still horizontal');
  // The rail's width and its label size are both DERIVED, and both must come from the metrics
  // layer. CSS has no `minimumScaleFactor`: hand the browser the source's 11px and it clips
  // `-0.3` inside a 20px rail while SwiftUI quietly shrinks it — the two renderers disagreeing on
  // screen with every suite still green. That is the failure this pair exists to make impossible.
  expect(/MET\.railWidth\(\)/.test(JS),
    "--an-rail-w comes from MET.railWidth() — the rail is an 8px track inside 6px of padding "
    + 'each side, derived, not a literal');
  expect(/MET\.evalLabelFontSize\(\)/.test(JS),
    '--an-fs-rail comes from MET.evalLabelFontSize() — the size that FITS the rail, shared with '
    + 'Swift, not the source font size the rail is too narrow for');
  expect(!/set\('--an-fs-rail',\s*T2\.evalRail/.test(JS),
    'and NOT from T2.evalRail directly: 11px in a 20px rail clips in the browser and only in the '
    + 'browser, which is the one bug neither metrics suite can see');
}

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
for (const prop of ['--an-board-edge', '--an-panels-h', '--an-rail-w', '--an-rail-gap']) {
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

// ---- 9. the OTHER vertical eval bar cannot come back ---------------------------
//
// `.eval-bar` was a second, never-referenced vertical eval bar with its own invented palette
// (#f2f2f2 on #242424, with a gold midline) and its own `.board-row` wrapper. Nothing in
// web-demo/*.js or index.html ever built one. It was harmless while the Analysis Board's bar was
// horizontal; with a real rail beside the board it becomes a trap — the wrong answer sitting next
// to the right one, and the first thing anyone looking for "the vertical eval bar" would find.
//
// Inverted rather than deleted, the way the book strip was. Note these rules sat ABOVE the
// `/* ---- Analysis Board` marker, so the analysisSection slice never saw them — which is how they
// survived every sweep for three rounds.
for (const gone of ['.board-row', '.board-row chess-board', '.eval-bar', '.eval-bar .fill',
                    '.eval-bar .mid', '.board-solo']) {
  expect(rule(gone) === null,
    gone + ' is gone — a second, never-referenced vertical eval bar with its own palette. The '
    + 'Analysis Board has a real one now, built from the extraction.');
}
expect(!/\beval-bar\b/.test(CSS),
  'and no rule mentions eval-bar at all any more — .an-eval is the only eval bar in the stylesheet');

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
