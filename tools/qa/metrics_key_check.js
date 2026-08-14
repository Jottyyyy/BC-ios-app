#!/usr/bin/env node
/*
 * metrics_key_check.js — every `MET.<BLOCK>.<key>` the screen reads must actually exist.
 *
 *     node tools/qa/metrics_key_check.js
 *
 * Why this exists. `analysis.js` read `MET.TIMINGS.doubleTap` and `MET.TIMINGS.longPress`; the real
 * keys are `doubleTapWindow` and `longPressDelay`. Neither threw. `undefined` made
 * `now - last < undefined` false forever and `setTimeout(fn, undefined)` fire immediately, so
 * double-tap-to-remove silently did nothing and long-press fired on touch. Both shipped through a
 * green suite and were only caught by driving the real UI in a browser.
 *
 * That is a whole class of bug — a typo in a property name on an object literal — and it is
 * mechanically checkable: walk the source for `MET.X.y` and ask the module whether `y` is there.
 * Cheap, and it fails at the gate instead of on a phone.
 *
 * Exit 0 = every reference resolves.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');

const MET = require(path.join(JS, 'analysis-metrics.js'));

// Files that read the metrics layer, and the local name they bind it to.
const CONSUMERS = [
  { file: 'analysis.js', alias: 'MET' },
  { file: 'analysis-store.js', alias: 'MET' },
  { file: 'position-editor.js', alias: 'MET' },
];

let checked = 0;
const failures = [];

for (const { file, alias } of CONSUMERS) {
  const full = path.join(JS, file);
  if (!fs.existsSync(full)) { failures.push(`missing consumer ${file}`); continue; }
  const src = fs.readFileSync(full, 'utf8');

  // `MET.BLOCK.key` — two levels, which is where the typos live. A bare `MET.fn(...)` is a function
  // call and is caught by the module simply not having it; check those too.
  const two = /\bMET\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = two.exec(src)) !== null) {
    const [, block, key] = m;
    checked++;
    const container = MET[block];
    if (container === undefined) {
      failures.push(`${file}: ${alias}.${block} does not exist`);
    } else if (typeof container === 'object' && container !== null && !Array.isArray(container)
               && !Object.prototype.hasOwnProperty.call(container, key)) {
      const near = Object.keys(container)
        .filter(k => k.toLowerCase().startsWith(key.slice(0, 4).toLowerCase()));
      failures.push(`${file}: ${alias}.${block}.${key} does not exist`
        + (near.length ? `  (did you mean ${near.join(' / ')}?)` : ''));
    }
  }

  // One level: `MET.someFunction` / `MET.SOME_TABLE`.
  const one = /\bMET\.([A-Za-z_$][\w$]*)/g;
  while ((m = one.exec(src)) !== null) {
    const name = m[1];
    checked++;
    if (!Object.prototype.hasOwnProperty.call(MET, name)) {
      failures.push(`${file}: ${alias}.${name} is not exported by analysis-metrics.js`);
    }
  }
}

// ---- the same check, on the Swift side --------------------------------------
// There is no compiler on this checkout, so a mistyped `AnalysisEdit.pieceSize` would sit in the
// source until the teammate's first build. The metrics enums are flat `static let`s, which makes
// them as parseable as the JS object literals.
const SWIFT_METRICS = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'AnalysisMetrics.swift');
const SWIFT_VIEWS = [
  'AnalysisBoardScreen.swift', 'AnalysisVM.swift', 'AnalysisMenuSidebar.swift',
  'AnalysisEditPanel.swift', 'AnalysisPgnModals.swift', 'AnalysisAnnotationPicker.swift',
  'AnalysisVariationModal.swift', 'AnalysisLibraryModals.swift', 'AnalysisReviewModal.swift',
  'AnalysisEngineSettings.swift',
  // The shared board. It is not an Analysis screen, but `BoardStyle`, `AnalysisIndicator` and
  // `BoardCoords` all live in AnalysisMetrics.swift and this is the only file that reads all three.
  'BoardView.swift',
  // The check itself is nothing BUT metrics references, so it is the highest-value file here.
  'AnalysisMetricsCheck.swift',
];

/** Every `static let/var/func NAME` declared inside each top-level `enum X { … }`. */
function parseSwiftEnums(src) {
  const out = {};
  const enumRe = /^enum ([A-Za-z_]\w*)\s*\{/gm;
  let m;
  while ((m = enumRe.exec(src)) !== null) {
    const name = m[1];
    // Walk braces from the opening one to find the enum's extent.
    let depth = 0, i = src.indexOf('{', m.index), start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start, i);
    const members = new Set();
    const memberRe = /\bstatic\s+(?:let|var|func)\s+`?([A-Za-z_]\w*)`?/g;
    let mm;
    while ((mm = memberRe.exec(body)) !== null) members.add(mm[1]);
    // Nested types (`struct Geometry`, `enum Issue`) are members too.
    const nestedRe = /\b(?:struct|enum)\s+([A-Za-z_]\w*)/g;
    while ((mm = nestedRe.exec(body)) !== null) members.add(mm[1]);
    out[name] = members;
  }
  return out;
}

const swiftEnums = parseSwiftEnums(fs.readFileSync(SWIFT_METRICS, 'utf8'));
// Only the metrics enums are checked; anything else is a type the compiler will resolve normally.
const CHECKED_ENUMS = ['AnalysisBoard', 'AnalysisPalette', 'AnalysisIndicator', 'AnalysisArrow',
  'AnalysisBadge', 'AnalysisLayout', 'AnalysisEval', 'AnalysisGraph', 'AnalysisReview',
  'AnalysisGraphStyle', 'AnalysisLibraryStyle', 'AnalysisTables', 'AnalysisTiming',
  'AnalysisEngineLimits', 'AnalysisEngineStyle', 'AnalysisType', 'AnalysisMenu', 'AnalysisEdit',
  'AnalysisModals', 'BoardCoords'];

for (const name of CHECKED_ENUMS) {
  checked++;
  if (!swiftEnums[name]) failures.push(`AnalysisMetrics.swift is missing enum ${name}`);
}

for (const file of SWIFT_VIEWS) {
  const full = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', file);
  if (!fs.existsSync(full)) { failures.push(`missing Swift view ${file}`); continue; }
  const src = fs.readFileSync(full, 'utf8');
  for (const name of CHECKED_ENUMS) {
    const members = swiftEnums[name];
    if (!members) continue;
    const refRe = new RegExp('\\b' + name + '\\.([A-Za-z_]\\w*)', 'g');
    let r;
    while ((r = refRe.exec(src)) !== null) {
      const member = r[1];
      checked++;
      if (!members.has(member)) {
        const near = [...members].filter(k => k.toLowerCase().startsWith(member.slice(0, 4).toLowerCase()));
        failures.push(`${file}: ${name}.${member} does not exist`
          + (near.length ? `  (did you mean ${near.join(' / ')}?)` : ''));
      }
    }
  }
}

const result = {
  passed: checked - failures.length,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `MetricsKeys: ${checked} JS + Swift metrics references all resolve`
    : `MetricsKeys: ${checked - failures.length} resolved, ${failures.length} BROKEN\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
