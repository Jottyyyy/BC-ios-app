#!/usr/bin/env node
/*
 * swift_padding_check.js — a rendered block may not lose one of its paddings.
 *
 *     node tools/qa/swift_padding_check.js
 *
 * ## Why this file exists
 *
 * The Tournaments list applied two of its three extracted paddings:
 *
 *     .padding(.horizontal, PairingList.listPaddingHorizontal)
 *     .padding(.top, PairingList.listPaddingTop)
 *     // listPaddingBottom = 90, never applied
 *
 * The RN source is `list: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 90 }`, and that 90
 * is the whole reason the scroll content clears the "New Tournament" button floating over it in the
 * same ZStack. Without it, the last thing in the ScrollView sits UNDER the button — and the last
 * thing in that ScrollView is the hint reading *"Long press a card to delete"*, which is the only
 * documentation of the only delete gesture. A client reported it as **"walang way na mag delete ng
 * tournament"**: the feature was there, its instructions were behind a button.
 *
 * Nothing could catch it. The browser applied all three (`.pgl-list` is a three-value `padding`
 * shorthand), so `web-demo/` looked right — and the browser is where this checkout tests.
 * `metrics_key_check.js` and `swift_source_keys.js` check that every constant REFERENCE resolves;
 * neither can notice a constant nobody references. And a blanket "unused extracted constant" rule is
 * useless here: 99 of them are unused in the pairing metrics alone, nearly all legitimately — the
 * share card and the free-tier banner are not ported at all.
 *
 * ## The rule, and why it is this one
 *
 * **If the Swift applies ANY of a block's `*Padding<Side>` constants, it must apply ALL of them.**
 *
 * Referencing one is the proof the block is rendered, which is exactly what an unused-constant
 * census cannot establish. So the noisy case — a block nobody draws — is silent by construction, and
 * the dangerous case — a block that IS drawn and quietly lost a side — is a failure. Measured at 0
 * violations across every metrics file once the three real ones were fixed.
 *
 * Borders and margins are deliberately out of scope: a margin usually becomes padding on a
 * neighbour in SwiftUI, so "unapplied" says nothing there.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** Every metrics file that holds extracted StyleSheet constants. */
const METRICS = [
  'PairingMetrics.swift', 'CoachMetrics.swift', 'PuzzleMetrics.swift',
  'AnalysisMetrics.swift', 'HomeMetrics.swift', 'PaywallMetrics.swift',
  'LoginMetrics.swift',
].map((f) => path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', f))
  .filter((f) => fs.existsSync(f));

const SIDES = 'Top|Bottom|Left|Right|Horizontal|Vertical';
const DECL = new RegExp(`^\\s*public static (?:let|var) (\\w+Padding(?:${SIDES}))\\b`);
const ENUM = /^public enum (\w+)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.build') walk(p, out); }
    else if (e.name.endsWith('.swift')) out.push(p);
  }
  return out;
}

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

const allSwift = [];
for (const r of ['Sources', 'DemoApp/Sources', 'Engine/Sources', 'ios']) {
  walk(path.join(ROOT, r), allSwift);
}

expect(METRICS.length >= 5, `${METRICS.length} metrics files found — the sweep is not vacuous`);

let blocksChecked = 0;
for (const metrics of METRICS) {
  // The declaring file is excluded from the corpus: a constant's own declaration is not a use.
  const corpus = allSwift
    .filter((f) => path.resolve(f) !== path.resolve(metrics))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  let enumName = '';
  const blocks = new Map();
  for (const ln of fs.readFileSync(metrics, 'utf8').split('\n')) {
    const e = ENUM.exec(ln);
    if (e) { enumName = e[1]; continue; }
    const m = DECL.exec(ln);
    if (!m) continue;
    const name = m[1];
    const key = enumName + '.' + name.replace(new RegExp(`Padding(${SIDES})$`), '');
    if (!blocks.has(key)) blocks.set(key, []);
    // FULLY QUALIFIED, and this is not fussiness. Searching for `.listPaddingBottom` alone reports
    // `PairingList.listPaddingBottom` as used because `PuzzleStreakHome.listPaddingBottom` exists
    // and matches the same suffix — which is exactly how the first draft of this file passed while
    // the Tournaments bug was still in the tree. Block names repeat across screens; only the
    // enum-qualified name identifies one.
    blocks.get(key).push({
      name,
      used: new RegExp('\\b' + enumName + '\\.' + name + '\\b').test(corpus),
    });
  }

  for (const [key, members] of blocks) {
    const used = members.filter((m) => m.used);
    if (used.length === 0) continue;             // not rendered — nothing to say
    blocksChecked++;
    const missing = members.filter((m) => !m.used).map((m) => m.name);
    expect(missing.length === 0,
      `${path.basename(metrics)}: ${key} is rendered — ${used.map((m) => m.name).join(', ')} `
      + `applied — but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} never applied. `
      + 'A block that lost one side is the Tournaments-list bug: the content ran under the button '
      + 'floating over it. See the header of this file.');
  }
}

expect(blocksChecked >= 20,
  `${blocksChecked} rendered blocks examined — too few means the parse stopped matching`);

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `SwiftPadding: ${blocksChecked} rendered blocks, every side applied`
    : `SwiftPadding: ${failures.length} block(s) missing a side\n`
      + failures.map((f) => '  x ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { run: () => result, selfTest: () => result };
