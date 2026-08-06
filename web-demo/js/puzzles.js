/* =============================================================================
 * puzzles.js — Embedded sample puzzles for the Puzzles tab
 *
 * The full app ships a 550,000-puzzle SQLite bank (~100 MB) that isn't
 * practical to load in a browser, so this demo embeds a small hand-verified set.
 * EVERY puzzle here was checked with the engine: the solution line is fully
 * legal and ends in checkmate (see scratchpad/puzzles_verify.js).
 *
 * Format — the solver is whichever side is to move in `fen`:
 *   solution: [ solverMoveUci, opponentReplyUci, solverMoveUci, ... ]
 * All samples are mate-in-1 (one solver move). To add a mate-in-2, list all
 * three plies: [yourMove, forcedReply, yourMate].
 *
 * ⇢ To add puzzles: append here, then run the app with ?selftest to confirm
 *   each line ends in checkmate.
 * Exposes window.SAMPLE_PUZZLES. Classic <script>, no modules.
 * ========================================================================== */
(function (global) {
  'use strict';

  global.SAMPLE_PUZZLES = [
    { id: 'p-backrank-1', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', solution: ['a1a8'], theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 900 },
    { id: 'p-rook-c8', fen: '7k/5ppp/8/8/8/8/8/2R4K w - - 0 1', solution: ['c1c8'], theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 920 },
    { id: 'p-backrank-2', fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['d1d8'], theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 950 },
    { id: 'p-black-back', fen: 'r6k/8/8/8/8/8/5PPP/6K1 b - - 0 1', solution: ['a8a1'], theme: 'Back-rank mate', objective: 'Black to play, mate in 1', rating: 970 },
    { id: 'p-rooklift', fen: '6k1/4Rppp/8/8/8/8/8/6K1 w - - 0 1', solution: ['e7e8'], theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 1000 },
    { id: 'p-bishop-guard', fen: '6k1/5ppp/8/8/8/5B2/8/3R2K1 w - - 0 1', solution: ['d1d8'], theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 1020 },
    { id: 'p-backrank-cap', fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', solution: ['d1d8'], theme: 'Deflection / capture', objective: 'White to play, mate in 1', rating: 1080 },
    { id: 'p-queen-back', fen: '6k1/5ppp/8/8/8/8/5PPP/1Q4K1 w - - 0 1', solution: ['b1b8'], theme: 'Queen back-rank', objective: 'White to play, mate in 1', rating: 1120 },
    { id: 'p-queenking', fen: '6k1/8/6K1/8/8/8/8/3Q4 w - - 0 1', solution: ['d1d8'], theme: 'Queen & king mate', objective: 'White to play, mate in 1', rating: 1180 },
    { id: 'p-smother', fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1', solution: ['h6f7'], theme: 'Smothered mate', objective: 'White to play, mate in 1', rating: 1300 }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
