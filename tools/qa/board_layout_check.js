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
