#!/usr/bin/env node
/*
 * replay_position_editor.js — check the Swift `position_editor` group's hand-authored expectations
 * against the JavaScript that has actually been executed.
 *
 *     node tools/qa/replay_position_editor.js
 *
 * `swift` is not on PATH on this checkout, so the Swift table in Sources/ParityRunner/main.swift is
 * written blind. This is the mitigation Phase 2 established and every phase since has used: pull the
 * concrete (input, expectation) pairs straight out of the Swift SOURCE TEXT and run them through
 * web-demo/js/position-editor.js, which is proven against the engine goldens.
 *
 * It does not prove the Swift compiles. It proves the numbers and strings in it are the right ones,
 * which is the half a compiler would not have caught anyway.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PE = require(path.join(ROOT, 'web-demo', 'js', 'position-editor.js'));
const MAIN = path.join(ROOT, 'Sources', 'ParityRunner', 'main.swift');

const swift = fs.readFileSync(MAIN, 'utf8');
const start = swift.indexOf('h.begin("position_editor")');
if (start < 0) { console.error('FATAL: the position_editor group is not in main.swift'); process.exit(1); }
const end = swift.indexOf('\nh.begin(', start + 1);
const group = swift.slice(start, end < 0 ? swift.length : end);

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

// ---- 1. `issues(PositionEditor(fen: "…")) == "…"` ---------------------------
// The highest-value pairs: a FEN in, a fixed issue list out.
const issueRe = /issues\(PositionEditor\(fen: "([^"]+)"\)\) == "([^"]*)"/g;
let m, issueCases = 0;
while ((m = issueRe.exec(group)) !== null) {
  const [, fen, expected] = m;
  issueCases++;
  const got = PE.validate(PE.create(fen)).join(',');
  expect(got === expected, `validate("${fen}"): Swift expects "${expected}", JS gives "${got}"`);
}
expect(issueCases >= 4, `found ${issueCases} FEN->issues pairs in the Swift (expected at least 4)`);

// ---- 2. `PositionEditor(fen: "…").fen == "…"` -------------------------------
const fenRe = /PositionEditor\(fen: "([^"]+)"\)\.fen == "([^"]+)"/g;
let fenCases = 0;
while ((m = fenRe.exec(group)) !== null) {
  const [, input, expected] = m;
  fenCases++;
  const got = PE.fen(PE.create(input));
  expect(got === expected, `fen("${input}"): Swift expects "${expected}", JS gives "${got}"`);
}
expect(fenCases >= 1, `found ${fenCases} FEN->FEN pairs`);

// ---- 3. the issue MESSAGES -------------------------------------------------
// Every `firstIssueText == "…"` must be a string the JS table also produces.
const textRe = /firstIssueText == "([^"]+)"/g;
let textCases = 0;
while ((m = textRe.exec(group)) !== null) {
  const [, text] = m;
  textCases++;
  const known = Object.keys(PE.ISSUES).some(k => PE.ISSUES[k] === text);
  expect(known, `firstIssueText "${text}" is not one of the JS messages`);
}
expect(textCases >= 3, `found ${textCases} message assertions`);

// The two the source itself writes must be byte-identical in both languages.
expect(PE.ISSUES.whiteKingMissing === 'White king is missing.',
  'the white-king message is the source\'s, verbatim');
expect(PE.ISSUES.kingsAdjacent === 'Kings cannot be adjacent — illegal position.',
  'the adjacency message is the source\'s, verbatim (note the em dash)');
expect(group.includes('"White king is missing."'), 'and the Swift carries the same string');
expect(group.includes('"Kings cannot be adjacent — illegal position."'),
  'and the same adjacency string, em dash included');

// ---- 4. the palette order --------------------------------------------------
expect(group.includes('["K", "Q", "R", "B", "N", "P"]'), 'the Swift white palette matches board.tsx:276');
expect(group.includes('["k", "q", "r", "b", "n", "p"]'), 'the Swift black palette matches board.tsx:277');
expect(PE.WHITE_PIECE_KEYS.join(',') === 'K,Q,R,B,N,P', 'and so does the JS');
expect(PE.BLACK_PIECE_KEYS.join(',') === 'k,q,r,b,n,p', 'and the black one');

// ---- 5. the castling-normalisation expectations ----------------------------
// `fen.split(separator: " ")[2] == "Qkq"` etc. — replay each as a board edit.
const castling = [
  { build: e => PE.removeAt(e, 7), expected: 'Qkq', why: 'no h1 rook' },
  { build: e => { PE.removeAt(e, 7); PE.removeAt(e, 0); }, expected: 'kq', why: 'no white rooks' },
  { build: e => { PE.removeAt(e, 4); PE.put(e, 12, 'K'); }, expected: 'kq', why: 'white king off e1' },
  { build: e => { PE.removeAt(e, 60); PE.put(e, 52, 'k'); }, expected: 'KQ', why: 'black king off e8' },
  { build: e => PE.removeAt(e, 63), expected: 'KQq', why: 'no h8 rook' },
  { build: e => PE.removeAt(e, 56), expected: 'KQk', why: 'no a8 rook' },
];
for (const c of castling) {
  const e = PE.create();
  c.build(e);
  const got = PE.fen(e).split(' ')[2];
  expect(got === c.expected, `castling (${c.why}): Swift expects "${c.expected}", JS gives "${got}"`);
  expect(group.includes(`== "${c.expected}"`), `and the Swift really asserts "${c.expected}"`);
}

// ---- 6. the issue enum is the same size in both -----------------------------
const swiftIssueCount = (group.match(/Issue\.allCases\.count == (\d+)/) || [])[1];
expect(swiftIssueCount !== undefined, 'the Swift pins its issue count');
expect(Number(swiftIssueCount) === Object.keys(PE.ISSUES).length,
  `issue count: Swift says ${swiftIssueCount}, JS has ${Object.keys(PE.ISSUES).length}`);

// ---- 7. the phase-11 session table, against analysis.js ---------------------
// The NAG map is the one cross-language fact that would silently corrupt exported PGN if the two
// languages disagreed, so it is checked entry by entry rather than by eye.
const AB = require(path.join(ROOT, 'web-demo', 'js', 'analysis.js'));
const sessionStart = swift.indexOf('h.begin("analysis_session")');
const sessionEnd = swift.indexOf('\nh.begin(', sessionStart + 1);
const session = swift.slice(sessionStart, sessionEnd < 0 ? swift.length : sessionEnd);

// The table itself lives in Core, not in the harness.
const sessionSwift = fs.readFileSync(
  path.join(ROOT, 'Sources', 'BiyaherongCoachCore', 'AnalysisSession.swift'), 'utf8');
const swiftNagRe = /(\d+): "([^"]+)"/g;
const swiftNagBlock = (sessionSwift.match(/nagSymbols: \[Int: String\] = \[([\s\S]*?)\n    \]/) || [])[1] || '';
const swiftNags = {};
let nm;
while ((nm = swiftNagRe.exec(swiftNagBlock)) !== null) swiftNags[Number(nm[1])] = nm[2];
expect(Object.keys(swiftNags).length === 14, `the Swift NAG table has 14 entries, found ${Object.keys(swiftNags).length}`);
for (const code of Object.keys(swiftNags)) {
  const jsSym = AB.NAG_SYMBOL[code];
  expect(jsSym === swiftNags[code],
    `NAG ${code}: Swift says "${swiftNags[code]}", JS says "${jsSym}"`);
  expect(AB.nagFor(swiftNags[code]) === Number(code),
    `and the JS inverse of "${swiftNags[code]}" is ${code}`);
}
expect(Object.keys(AB.NAG_SYMBOL).length === Object.keys(swiftNags).length,
  'the two NAG tables are the same size');
// The correction that matters: shipping the source's swap would emit $15 where $14 is meant.
expect(AB.nagFor('⩲') === 14 && AB.nagFor('⩱') === 15,
  'the JS keeps the standard ⩲=$14 / ⩱=$15 mapping, not the swap the source has');
expect(session.includes('nag(forSymbol: "⩲") == 14') && session.includes('nag(forSymbol: "⩱") == 15'),
  'and the Swift asserts the same');

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `ReplaySwiftTables: ${passed} Swift expectations confirmed against the JS`
    : `ReplaySwiftTables: ${passed} confirmed, ${failures.length} DISAGREE\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
