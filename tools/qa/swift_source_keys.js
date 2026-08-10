#!/usr/bin/env node
/*
 * swift_source_keys.js — every StyleSheet key `AnalysisMetricsCheck.swift` asserts must exist.
 *
 *     node tools/qa/swift_source_keys.js
 *
 * That check reads `tools/metrics/board_styles.json` at runtime and compares each encoded constant
 * against the real RN value. Its failure mode with no compiler here is quiet: a key that does not
 * exist in the JSON reads back `nil`, the assertion fails, and nobody finds out until the teammate
 * runs `swift run AnalysisMetricsCheck` on a Mac.
 *
 * So resolve the same lookups from Node, where they can be run today. This is the counterpart of
 * `metrics_key_check.js` pointed the other way: that one asks "does the CONSTANT exist", this one
 * asks "does the SOURCE VALUE it is compared against exist".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const styles = require(path.join(ROOT, 'tools', 'metrics', 'board_styles.json'));
const CHECK = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'AnalysisMetricsCheck.swift');

const src = fs.readFileSync(CHECK, 'utf8');
let checked = 0;
const failures = [];
const expect = (cond, what) => { cond ? checked++ : (checked++, failures.push(what)); };

function lookup(block, key, prop) {
  const b = styles.stylesheets[block];
  if (!b) return { missing: `block ${block}` };
  const style = b[key];
  if (!style) return { missing: `${block}.${key}` };
  if (!Object.prototype.hasOwnProperty.call(style, prop)) return { missing: `${block}.${key}.${prop}` };
  return { value: style[prop] };
}

// `matches("editFenInput", "borderRadius", …)` and `sourceString("x", "y")` read `stylesheets.styles`.
for (const re of [/\bmatches\("([^"]+)",\s*"([^"]+)"/g, /\bsourceString\("([^"]+)",\s*"([^"]+)"/g,
                  /\bsourceNumber\("([^"]+)",\s*"([^"]+)"/g]) {
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, key, prop] = m;
    const r = lookup('styles', key, prop);
    expect(!r.missing, `AnalysisMetricsCheck asserts styles.${key}.${prop}, which the source has no value for`);
  }
}

// `acc("card", "borderRadius", …)` reads accModalStyles; `sb(...)` reads sidebarStyles.
const scoped = [
  { fn: 'acc', block: 'accModalStyles' },
  { fn: 'sb', block: 'sidebarStyles' },
];
for (const { fn, block } of scoped) {
  const re = new RegExp('\\b' + fn + '\\("([^"]+)",\\s*"([^"]+)"', 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, key, prop] = m;
    const r = lookup(block, key, prop);
    expect(!r.missing, `AnalysisMetricsCheck asserts ${block}.${key}.${prop}, which the source has no value for`);
  }
}

// `pin(SV, "fieldRow", "gap", …)` names its block by variable; map the two that exist.
const pinBlocks = { SV: 'saveModalStyles', LD: 'loadModalStyles' };
const pinRe = /\bpin\((\w+),\s*"([^"]+)",\s*"([^"]+)"/g;
let pm;
while ((pm = pinRe.exec(src)) !== null) {
  const [, varName, key, prop] = pm;
  const block = pinBlocks[varName];
  if (!block) { expect(false, `pin() uses an unknown block variable ${varName}`); continue; }
  const r = lookup(block, key, prop);
  expect(!r.missing, `AnalysisMetricsCheck asserts ${block}.${key}.${prop}, which the source has no value for`);
}

expect(checked > 100, `only ${checked} source lookups found — the parser probably stopped matching`);

const result = {
  passed: checked - failures.length,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `SwiftSourceKeys: ${checked} StyleSheet lookups all resolve`
    : `SwiftSourceKeys: ${checked - failures.length} resolve, ${failures.length} MISSING\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
