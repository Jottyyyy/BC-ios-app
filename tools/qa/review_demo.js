#!/usr/bin/env node
/*
 * review_demo.js — review a whole game end to end, offline, and print the result.
 *
 * This is the Analysis Board's headline feature exercised for real: an opening played out of the
 * bundled ECO book, every position evaluated by the local engine, then classified and scored by the
 * PHP-parity review math, with the `book` tier applied on top.
 *
 *     node tools/qa/review_demo.js [moves] [depth]
 *
 * It is a demonstration, not a test — `tools/qa/js_goldens.js` is the gate. It exists so the claim
 * "a full game reviews offline" can be checked by running it rather than taken on trust.
 */
'use strict';

var path = require('path');
var JS = path.resolve(__dirname, '..', '..', 'web-demo', 'js');

var E = require(path.join(JS, 'engine.js'));
var AI = require(path.join(JS, 'ai.js'));
var A = require(path.join(JS, 'analysis-engine.js'));
var V = require(path.join(JS, 'review.js'));
var B = require(path.join(JS, 'opening-book.js'));
var T = require(path.join(JS, 'movetree.js'));
var P = require(path.join(JS, 'pgn.js'));

var TARGET_MOVES = parseInt(process.argv[2], 10) || 40;
var EVAL_DEPTH = parseInt(process.argv[3], 10) || 3;

// ---- 1. Build a game -------------------------------------------------------
// Start down a real opening so the book prefix is meaningful, then let the coach play it out.
// Deterministic: a fixed seed and a persona with no blunder chance and no noise.
var OPENING = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'];
// ai.js exports CoachAI, not the Coaches list, so the persona is spelled out here. No blunder
// chance and no randomness, so the same seed always produces the same game.
var persona = { id: 'demo', name: 'Demo', depth: 2, blunderChance: 0, randomness: 0 };
var rng = AI.mulberry32(20260810);

var tree = T.create();
for (var i = 0; i < OPENING.length; i++) {
  if (!T.addSan(tree, OPENING[i])) { console.error('opening line failed at ' + OPENING[i]); process.exit(1); }
}
while (T.mainlineSans(tree).length < TARGET_MOVES * 2) {
  var pos = T.position(tree.current);
  var outcome = E.terminalOutcome(pos, T.historyKeys(tree.current));
  if (outcome.kind !== 'ongoing') break;
  var m = AI.bestMove(pos, persona, rng);
  if (!m) break;
  T.addMove(tree, m);
}
var line = T.mainline(tree);
var sans = line.map(function (n) { return n.san; });

// ---- 2. Positions, keys, and the review input ------------------------------
var positions = [E.start()];
var keys = [E.positionKey(E.start())];
var moves = [null];
var p = E.start();
for (var j = 0; j < line.length; j++) {
  var mv = E.parseSan(p, line[j].san);
  p = E.makeMove(p, mv);
  positions.push(p);
  keys.push(E.positionKey(p));
  // SAN is re-derived from the tree, never taken from a string — GameReview compares bestMoveSan by
  // string equality, so an imported spelling would silently mis-classify.
  moves.push({ san: line[j].san, color: line[j].color === E.WHITE ? 'w' : 'b' });
}

// ---- 3. Evaluate every position --------------------------------------------
process.stdout.write('evaluating ' + positions.length + ' positions at depth ' + EVAL_DEPTH + ' ');
var t0 = Date.now();
var evaluations = positions.map(function (pos, idx) {
  if (idx % 20 === 0) process.stdout.write('.');
  var snap = A.analyze(pos, { maxDepth: EVAL_DEPTH, multiPV: 1 });
  var best = snap.lines.length ? snap.lines[0].pvSAN[0] : null;
  return A.asReviewEvaluation(snap.score, best);
});
var evalMs = Date.now() - t0;
console.log(' done in ' + (evalMs / 1000).toFixed(1) + 's');

// ---- 4. Review, then apply the book tier -----------------------------------
var base = V.review(evaluations, moves);
var bookPlies = B.bookPlies(keys);
var annotated = V.annotate(base, moves, bookPlies);
var prefix = B.bookPrefixLength(keys);

// ---- 5. Report --------------------------------------------------------------
var lastNamed = null;
for (var k = 1; k <= prefix; k++) lastNamed = B.nameFor(keys[k], lastNamed);

console.log('');
console.log('GAME REVIEW  —  ' + (sans.length / 2).toFixed(1) + ' moves, ' + sans.length + ' plies');
console.log(new Array(58).join('-'));
console.log('opening      : ' + (lastNamed ? lastNamed.eco + ' ' + lastNamed.name : 'unknown'));
console.log('book prefix  : ' + prefix + ' plies in book, then out');
console.log('');
console.log('accuracy     : White ' + base.whiteAccuracy.toFixed(1) + '%    Black ' + base.blackAccuracy.toFixed(1) + '%');
console.log('');
console.log('  White                          Black');
annotated.displayOrder.forEach(function (key) {
  var w = annotated.whiteClassifications[key] || 0;
  var b = annotated.blackClassifications[key] || 0;
  if (w === 0 && b === 0) return;
  console.log('  ' + String(w).padStart(5) + '   ' + key.padEnd(22) + String(b).padStart(5));
});
var wTot = 0, bTot = 0;
annotated.displayOrder.forEach(function (key) {
  wTot += annotated.whiteClassifications[key] || 0;
  bTot += annotated.blackClassifications[key] || 0;
});
console.log('  ' + new Array(38).join('-'));
console.log('  ' + String(wTot).padStart(5) + '   ' + 'total'.padEnd(22) + String(bTot).padStart(5));
console.log('');
console.log('sanity       : counts sum to ' + (wTot + bTot) + ', classified plies ' + base.moveEvaluations.length
  + (wTot + bTot === base.moveEvaluations.length ? '  OK' : '  MISMATCH'));
console.log('             : eval graph has ' + base.evalGraph.length + ' points for ' + positions.length + ' positions'
  + (base.evalGraph.length === positions.length ? '  OK' : '  MISMATCH'));
console.log('             : accuracy untouched by the book tier  '
  + (annotated.base.whiteAccuracy === base.whiteAccuracy ? 'OK' : 'MISMATCH'));
console.log('');
console.log('PGN          : ' + P.serialize({ tree: tree, headers: { Event: 'Offline review demo' },
  result: '*', initialFEN: tree.initialFen }).split('\n\n')[1].split('\n')[0] + ' …');
