#!/usr/bin/env node
/*
 * gen_puzzle_fixtures.js — emit the Swift fixture table for the `puzzle_*` parity groups.
 *
 *     node tools/qa/gen_puzzle_fixtures.js > fixtures.swift
 *
 * The rows are real puzzles and every expectation is COMPUTED by `web-demo/js/puzzle-session.js`,
 * so nothing in the table is typed by hand. "Extract, don't transcribe" — the same rule the board
 * metrics follow.
 *
 * The candidates are found in the browser slice (small, fast to scan) but each one is then
 * RESOLVED AGAINST THE SHIPPING SQLITE by `lichess_id`, and it is the corpus id that is emitted.
 * The slice renumbers its rows 1..N for the demo, so emitting a slice id would point the parity
 * fixtures at whatever puzzle happened to hold that number in the bundle.
 */
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const E = require(path.join(JS, 'engine.js'));
const S = require(path.join(JS, 'puzzle-session.js'));
const DATA = require(path.join(JS, 'puzzle-data.js'));

function pick(pred) { return DATA.puzzles.find(pred); }

const mate1 = pick(p => p.themes.includes('mateIn1') && p.moves.length === 2);
const four = pick(p => p.moves.length === 4);
const eight = pick(p => p.moves.length >= 8);
const promo = pick(p => p.moves[1] && p.moves[1].length === 5);
const black = pick(p => E.fromFEN(p.fen).sideToMove === E.WHITE && p.moves.length === 4);
const white = pick(p => E.fromFEN(p.fen).sideToMove === E.BLACK && p.moves.length === 4);

// A position with more than one mating move, for the off-book-mate rule.
let offbook = null;
for (const p of DATA.puzzles) {
  if (!p.themes.includes('mateIn1') || p.moves.length !== 2) continue;
  const pos = E.makeMove(E.fromFEN(p.fen), E.parseUci(E.fromFEN(p.fen), p.moves[0]));
  const mates = E.legalMoves(pos).filter(m => E.status(E.makeMove(pos, m)) === 'checkmate')
                 .map(E.moveUci);
  if (mates.length > 1) {
    const alt = mates.find(u => u !== p.moves[1]);
    if (alt) { offbook = { p, alt }; break; }
  }
}

// A legal, non-mating, non-expected move for the wrong-move table.
function wrongFor(p) {
  const pos = E.makeMove(E.fromFEN(p.fen), E.parseUci(E.fromFEN(p.fen), p.moves[0]));
  return E.legalMoves(pos)
    .filter(m => E.moveUci(m) !== p.moves[1] && E.status(E.makeMove(pos, m)) !== 'checkmate')
    .map(E.moveUci)[0];
}

const rows = [
  ['mate1', mate1], ['four', four], ['eight', eight], ['promo', promo],
  ['solverBlack', black], ['solverWhite', white], ['offbook', offbook.p],
];

// Resolve each candidate to its row in the SHIPPING corpus, by the globally stable lichess id.
const db = new DatabaseSync(path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'puzzles.sqlite'),
                            { readOnly: true });
const lookup = db.prepare('SELECT id, fen, moves, rating FROM puzzles WHERE lichess_id = ?');
function corpusId(p) {
  const row = lookup.get(p.lichessId);
  if (!row) throw new Error(`${p.lichessId} is not in the bundle — rebuild the corpus`);
  if (row.fen !== p.fen || row.moves !== p.moves.join(' ') || row.rating !== p.rating) {
    throw new Error(`${p.lichessId} differs between the slice and the bundle`);
  }
  return row.id;
}

const out = [];
out.push('// GENERATED FIXTURES — real rows from the bundled corpus, emitted by');
out.push('// tools/qa/gen_puzzle_fixtures.js. Ids are SHIPPING-CORPUS ids resolved by lichess_id,');
out.push('// not the browser slice\'s renumbered ones. Expectations were COMPUTED by');
out.push('// web-demo/js/puzzle-session.js, not typed by hand.');
out.push('struct PZFixture { let key: String; let id: Int; let lichessId: String; let fen: String');
out.push('                   let moves: [String]');
out.push('                   let rating: Int; let themes: [String]; let userIsWhite: Bool');
out.push('                   let flipped: Bool; let wrongMove: String; let pgn: String }');
out.push('let pzFixtures: [PZFixture] = [');
for (const [key, p] of rows) {
  const s = S.create(p, 'play');
  const w = wrongFor(p) || '';
  const pgn = S.solutionPGN(p);
  out.push(`    PZFixture(key: ${JSON.stringify(key)}, id: ${corpusId(p)},`);
  out.push(`              lichessId: ${JSON.stringify(p.lichessId)}, fen: ${JSON.stringify(p.fen)},`);
  out.push(`              moves: [${p.moves.map(m => JSON.stringify(m)).join(', ')}],`);
  out.push(`              rating: ${p.rating}, themes: [${p.themes.map(t => JSON.stringify(t)).join(', ')}],`);
  out.push(`              userIsWhite: ${s.userColor === E.WHITE}, flipped: ${s.flipped},`);
  out.push(`              wrongMove: ${JSON.stringify(w)}, pgn: ${JSON.stringify(pgn)}),`);
}
out.push(']');
out.push(`let pzOffbookMate = ${JSON.stringify(offbook.alt)}   // a mate that is NOT the stored line`);
console.log(out.join('\n'));
console.error('mate1=' + mate1.id + ' four=' + four.id + ' eight=' + eight.id +
              ' promo=' + (promo && promo.id) + ' offbook=' + offbook.p.id + ' alt=' + offbook.alt);
