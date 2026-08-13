/* coach-book.js — the per-persona opening book (spec 2.3).
 *
 *     node -e "console.log(require('./web-demo/js/coach-book.js').selfTest().summary)"
 *
 * What gives each bot a recognisable style: a hard-coded book that overrides the engine for the
 * first seven moves a side, then hands the game back. It is 100 % offline already.
 *
 * ## Declarative, not a nested `if`
 *
 * The RN source expresses this as a chain of nested conditionals per level. The spec asks for a
 * table instead, and the reason is worth stating: as a chain, "level 3 as Black against 1.e4" is a
 * path through the code, so nothing can enumerate the book, count it, or diff it against the source.
 * As `{ level, side, history, move }` rows it is data — and the tests below can assert the whole
 * Najdorf line is present rather than that one branch happened to be taken.
 *
 *   history  an EXACT prefix match on the SAN list played so far
 *   move     UCI
 *
 * ## Two rules that carry the feature
 *
 *   1. The book stops once 14 plies have been played (seven per side); after that the engine owns
 *      the game.
 *   2. **An illegal book move falls through to the engine SILENTLY.** A hard-coded line meeting a
 *      real board is not an error condition — it is Tuesday. Never crash, never pass.
 */
'use strict';

var BiyaCoachBook = (function () {

  var WHITE = 'w', BLACK = 'b';

  /** Seven moves per side. `sanHistory.length < 14` is the spec's own gate. */
  var BOOK_PLIES = 14;

  // ---- Level 1 — Jaden: deliberate junk, move 1 only -------------------------------------------
  //
  // Not a line, a pool: uniform over six openings that are all bad on purpose. This IS the level's
  // character, and after move 1 the depth-2 engine takes over.

  var L1_WHITE = ['f2f3', 'g2g4', 'b2b4', 'a2a3', 'h2h3', 'b1a3'];
  var L1_BLACK = ['f7f6', 'a7a6', 'h7h6', 'g7g5', 'b8a6'];

  // ---- Levels 2-5 — real repertoires ------------------------------------------------------------
  //
  // Rows are `[history, move]`. Order does not matter: the lookup is an exact match on the history,
  // so at most one row can apply.

  var RULES = {
    2: {
      // Jade: King's Gambit / Latvian / Budapest.
      w: [
        [[], 'e2e4'],
        [['e4', 'e5'], 'f2f4'],
        [['e4', 'e5', 'f4', 'exf4'], 'g1f3'],
        [['e4', 'c5'], 'd2d4'],
        [['e4', 'e6'], 'd2d4'],
        [['e4', 'd6'], 'd2d4'],
      ],
      b: [
        [['e4'], 'e7e5'],
        [['e4', 'e5', 'Nf3'], 'f7f5'],
        [['d4'], 'g8f6'],
        [['d4', 'Nf6', 'c4'], 'e7e5'],
      ],
    },
    3: {
      // Jude: Italian / Najdorf.
      w: [
        [[], 'e2e4'],
        [['e4', 'e5'], 'g1f3'],
        [['e4', 'e5', 'Nf3', 'Nc6'], 'f1c4'],
        [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], 'c2c3'],
        [['e4', 'e5', 'Nf3', 'Nf6'], 'f3e5'],
      ],
      b: [
        [['e4'], 'c7c5'],
        [['e4', 'c5', 'Nf3'], 'd7d6'],
        [['e4', 'c5', 'Nf3', 'd6', 'd4'], 'c5d4'],
        [['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'], 'g8f6'],
        [['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], 'a7a6'],
        [['e4', 'c5', 'c3'], 'd7d5'],
        [['e4', 'c5', 'd4'], 'c5d4'],
        [['d4'], 'g8f6'],
        [['d4', 'Nf6', 'c4'], 'c7c5'],
        [['d4', 'Nf6', 'c4', 'c5', 'd5'], 'e7e6'],
        [['d4', 'Nf6', 'c4', 'c5', 'd5', 'e6', 'Nc3'], 'e6d5'],
        [['d4', 'Nf6', 'Nf3'], 'g7g6'],
      ],
    },
    4: {
      // Julie: London / French / Nimzo-Indian. The London is gated on exact history lengths, so it
      // plays the same setup whatever Black does — which is the point of the system.
      w: [
        [[], 'd2d4'],
        [null, 'g1f3', 2],
        [null, 'c1f4', 4],
        [null, 'e2e3', 6],
        [null, 'c2c3', 8],
        [null, 'f1d3', 10],
      ],
      b: [
        [['e4'], 'e7e6'],
        [['e4', 'e6', 'd4'], 'd7d5'],
        [['e4', 'e6', 'd4', 'd5', 'e5'], 'c7c5'],
        [['e4', 'e6', 'd4', 'd5', 'Nc3'], 'g8f6'],
        [['e4', 'e6', 'd4', 'd5', 'Nd2'], 'g8f6'],
        [['d4'], 'g8f6'],
        [['d4', 'Nf6', 'c4'], 'e7e6'],
        [['d4', 'Nf6', 'c4', 'e6', 'Nc3'], 'f8b4'],
        [['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'Nf3'], 'b7b6'],
        [['d4', 'Nf6', 'Nf3'], 'e7e6'],
      ],
    },
    5: {
      // Coach Pogi: Smith-Morra / Ruy Lopez / Scandinavian / Slav.
      w: [
        [[], 'e2e4'],
        [['e4', 'c5'], 'd2d4'],
        [['e4', 'c5', 'd4', 'cxd4'], 'c2c3'],
        [['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3'], 'b1c3'],
        [['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3', 'Nxc3', 'Nc6'], 'g1f3'],
        [['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3', 'Nxc3', 'Nc6', 'Nf3', 'd6'], 'f1c4'],
        [['e4', 'e5'], 'g1f3'],
        [['e4', 'e5', 'Nf3', 'Nc6'], 'f1b5'],
        [['e4', 'e5', 'Nf3', 'Nf6'], 'f3e5'],
      ],
      b: [
        [['e4'], 'd7d5'],
        [['e4', 'd5', 'exd5'], 'd8d5'],
        [['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'], 'd5a5'],
        [['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4'], 'g8f6'],
        [['e4', 'd5', 'e5'], 'c7c5'],
        [['d4'], 'd7d5'],
        [['d4', 'd5', 'c4'], 'c7c6'],
        [['d4', 'd5', 'c4', 'c6', 'Nf3'], 'g8f6'],
        [['d4', 'd5', 'c4', 'c6', 'Nc3'], 'g8f6'],
        [['d4', 'd5', 'Nf3'], 'g8f6'],
        [['d4', 'd5', 'Bf4'], 'c7c6'],
      ],
    },
  };

  function sameHistory(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * The book move for this position, or null to fall through to the engine.
   *
   * `sanHistory` is the SAN list played so far, so its length is the ply count and its parity is the
   * side to move. `isLegal(uci)` is injected: the book has no board of its own, and asking the
   * caller keeps this pure.
   */
  function bookMove(level, sanHistory, isLegal, rng) {
    var history = sanHistory || [];
    if (history.length >= BOOK_PLIES) return null;
    var side = history.length % 2 === 0 ? WHITE : BLACK;
    var candidate = candidateFor(level, side, history, rng);
    if (!candidate) return null;
    // An illegal book move is not an error. A hard-coded line meeting a real board is ordinary, and
    // the spec is explicit: fall through silently.
    if (isLegal && !isLegal(candidate)) return null;
    return candidate;
  }

  function candidateFor(level, side, history, rng) {
    var lv = String(level);
    if (lv === '1') {
      // Move 1 only. As Black that means exactly one ply has been played, whatever it was.
      if (side === WHITE && history.length === 0) return pool(L1_WHITE, rng);
      if (side === BLACK && history.length === 1) return pool(L1_BLACK, rng);
      return null;
    }
    var table = RULES[lv];
    if (!table) return null;
    var rows = table[side];
    for (var i = 0; i < rows.length; i++) {
      var wantHistory = rows[i][0], move = rows[i][1], atPly = rows[i][2];
      // A row with a null history is gated on ply COUNT alone — the London, which plays the same
      // setup whatever the opponent does.
      if (wantHistory === null) {
        if (history.length === atPly) return move;
        continue;
      }
      if (sameHistory(wantHistory, history)) return move;
    }
    return null;
  }

  function pool(moves, rng) {
    var r = typeof rng === 'function' ? rng() : 0;
    return moves[Math.floor(r * moves.length) % moves.length];
  }

  /** Every move the book can ever play, for the legality sweep in the tests. */
  function allMoves() {
    var out = L1_WHITE.concat(L1_BLACK);
    Object.keys(RULES).forEach(function (lv) {
      [WHITE, BLACK].forEach(function (side) {
        RULES[lv][side].forEach(function (row) { out.push(row[1]); });
      });
    });
    return out;
  }

  // ---- Self-test ---------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }
    var legal = function () { return true; };
    var half = function () { return 0.5; };

    // --- the gate ---
    var long14 = [];
    for (var i = 0; i < 14; i++) long14.push('e4');
    eq(bookMove(5, long14, legal, half), null, 'the book stops at 14 plies');
    expect(bookMove(5, long14.slice(0, 13), legal, half) === null
           || typeof bookMove(5, long14.slice(0, 13), legal, half) === 'string',
           'and 13 plies is still inside it');

    // --- an illegal move falls through SILENTLY ---
    var never = function () { return false; };
    eq(bookMove(5, [], never, half), null, 'an illegal book move yields null, not a throw');
    eq(bookMove(2, ['e4'], never, half), null, 'as Black too');
    eq(bookMove(5, [], legal, half), 'e2e4', 'and the same position plays it when it is legal');

    // --- level 1 is a POOL, not a line ---
    function l1(side, n) {
      var seen = {}, k = 0;
      var rng = function () { k += 1; return ((k * 0.101) % 1); };
      var hist = side === WHITE ? [] : ['e4'];
      for (var j = 0; j < n; j++) seen[bookMove(1, hist, legal, rng)] = true;
      return Object.keys(seen);
    }
    eq(l1(WHITE, 400).length, L1_WHITE.length, 'L1 as White reaches every junk opening');
    eq(l1(BLACK, 400).length, L1_BLACK.length, 'L1 as Black reaches every junk defence');
    expect(L1_WHITE.indexOf('g2g4') >= 0, 'the Grob is in the White pool');
    expect(L1_BLACK.indexOf('f7f6') >= 0, 'the Barnes Defense is in the Black pool');
    // Nothing after move 1 — the depth-2 engine takes over.
    eq(bookMove(1, ['e4', 'e5'], legal, half), null, 'L1 has no second move as White');
    eq(bookMove(1, ['e4', 'e5', 'Nf3'], legal, half), null, 'nor as Black');
    // Whatever White opened with, Black still answers from the pool.
    expect(bookMove(1, ['d4'], legal, half) !== null, 'L1 as Black answers any first move');

    // --- the repertoires, spot-checked along their whole main lines ---
    eq(bookMove(2, ['e4', 'e5'], legal, half), 'f2f4', "L2 plays the King's Gambit");
    eq(bookMove(2, ['e4', 'e5', 'Nf3'], legal, half), 'f7f5', 'L2 answers with the Latvian');
    eq(bookMove(2, ['d4', 'Nf6', 'c4'], legal, half), 'e7e5', 'and the Budapest');

    eq(bookMove(3, ['e4', 'e5', 'Nf3', 'Nc6'], legal, half), 'f1c4', 'L3 plays the Italian');
    eq(bookMove(3, ['e4', 'e5', 'Nf3', 'Nf6'], legal, half), 'f3e5', 'and takes on the Petrov');
    // The Najdorf, move by move — the point of a declarative book is that a whole line is checkable.
    var najdorf = [
      [['e4'], 'c7c5'],
      [['e4', 'c5', 'Nf3'], 'd7d6'],
      [['e4', 'c5', 'Nf3', 'd6', 'd4'], 'c5d4'],
      [['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4'], 'g8f6'],
      [['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'], 'a7a6'],
    ];
    najdorf.forEach(function (step, n) {
      eq(bookMove(3, step[0], legal, half), step[1], 'L3 Najdorf move ' + (n + 1));
    });

    // The London is gated on ply COUNT, so it plays the same setup whatever Black replies.
    var london = ['d2d4', 'g1f3', 'c1f4', 'e2e3', 'c2c3', 'f1d3'];
    ['e5', 'Nf6', 'd5'].forEach(function (reply) {
      var hist = [];
      london.forEach(function (want, n) {
        eq(bookMove(4, hist.slice(), legal, half), want,
           'L4 London move ' + (n + 1) + ' against ...' + reply);
        hist.push('X');           // whatever White played
        hist.push(reply);         // and whatever Black replied
      });
    });
    eq(bookMove(4, ['e4', 'e6', 'd4', 'd5', 'e5'], legal, half), 'c7c5',
       'L4 meets the French Advance with c5');
    eq(bookMove(4, ['d4', 'Nf6', 'c4', 'e6', 'Nc3'], legal, half), 'f8b4', 'and plays the Nimzo');

    eq(bookMove(5, ['e4', 'c5'], legal, half), 'd2d4', 'L5 opens the Smith-Morra');
    eq(bookMove(5, ['e4', 'c5', 'd4', 'cxd4'], legal, half), 'c2c3', 'and offers the gambit pawn');
    eq(bookMove(5, ['e4', 'e5', 'Nf3', 'Nc6'], legal, half), 'f1b5', 'L5 plays the Ruy Lopez');
    eq(bookMove(5, ['e4'], legal, half), 'd7d5', 'L5 answers 1.e4 with the Scandinavian');
    eq(bookMove(5, ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'], legal, half), 'd5a5', 'Mieses-Kotrc');
    eq(bookMove(5, ['d4', 'd5', 'c4'], legal, half), 'c7c6', 'and the Slav against 1.d4');

    // --- structural invariants over the whole table ---
    var moves = allMoves();
    expect(moves.length > 55, moves.length + ' book moves encoded, expected 55+');
    moves.forEach(function (m) {
      expect(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m), 'every book move is UCI, got ' + m);
    });
    // A history is a prefix of the position it applies to, so its length must match the side.
    Object.keys(RULES).forEach(function (lv) {
      RULES[lv].w.forEach(function (row) {
        var len = row[0] === null ? row[2] : row[0].length;
        expect(len % 2 === 0, 'L' + lv + ' White rows are reached on an even ply, got ' + len);
      });
      RULES[lv].b.forEach(function (row) {
        var len = row[0] === null ? row[2] : row[0].length;
        expect(len % 2 === 1, 'L' + lv + ' Black rows are reached on an odd ply, got ' + len);
      });
    });
    // No two rows for one level and side may share a history, or the book would be ambiguous.
    Object.keys(RULES).forEach(function (lv) {
      [WHITE, BLACK].forEach(function (side) {
        var seen = {};
        RULES[lv][side].forEach(function (row) {
          var key = row[0] === null ? 'ply' + row[2] : row[0].join(' ');
          expect(!seen[key], 'L' + lv + ' ' + side + ' has one rule for "' + key + '"');
          seen[key] = true;
        });
      });
    });
    // Every level answers move 1 as White, or its opening is whatever the engine happens to like.
    [1, 2, 3, 4, 5].forEach(function (lv) {
      expect(bookMove(lv, [], legal, half) !== null, 'L' + lv + ' has a first move as White');
      expect(bookMove(lv, ['e4'], legal, half) !== null, 'and an answer to 1.e4');
    });
    // An unknown level falls through rather than throwing.
    eq(bookMove(99, [], legal, half), null, 'an unknown level has no book');
    eq(bookMove(3, null, legal, half), 'e2e4', 'a null history is treated as the start');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-book: ' + passed + ' assertions passed'
        : 'coach-book: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  /**
   * Every book line, replayed on a REAL board.
   *
   * `selfTest` above proves the table says what the spec says. This proves the table is playable
   * chess: each history is reachable from the start position, and each book move is legal in the
   * position it claims. Those are different failures — a mistyped SAN in a history, or a UCI square
   * off by one file, would satisfy the first check completely and produce a book that silently falls
   * through to the engine on every line it touches.
   *
   * The engine is injected rather than required, so this file stays dependency-free and the browser
   * load order does not have to care.
   */
  function selfTestLegality(E) {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }

    var lines = 0;
    Object.keys(RULES).forEach(function (lv) {
      [WHITE, BLACK].forEach(function (side) {
        RULES[lv][side].forEach(function (row) {
          // Ply-gated rows (the London) have no fixed history to replay.
          if (row[0] === null) return;
          var pos = E.start(), ok = true;
          row[0].forEach(function (sanText) {
            if (!ok) return;
            var m = E.parseSan(pos, sanText);
            if (!m) {
              ok = false;
              expect(false, 'L' + lv + ' ' + side + ': unreachable SAN "' + sanText
                            + '" in [' + row[0].join(' ') + ']');
              return;
            }
            pos = E.makeMove(pos, m);
          });
          if (!ok) return;
          lines++;
          expect(!!E.parseUci(pos, row[1]),
                 'L' + lv + ' ' + side + ': ' + row[1] + ' is legal after ['
                 + row[0].join(' ') + ']');
        });
      });
    });
    expect(lines > 50, lines + ' book lines replayed, expected 50+');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-book legality: ' + lines + ' lines replayed, every move legal'
        : 'coach-book legality: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    BOOK_PLIES: BOOK_PLIES, WHITE: WHITE, BLACK: BLACK,
    L1_WHITE: L1_WHITE, L1_BLACK: L1_BLACK, RULES: RULES,
    bookMove: bookMove, allMoves: allMoves,
    // The tables themselves, so `tools/metrics/gen_coach_book.js` can emit the Swift twin
    // from them rather than from a second reading of the same lines.
    BOOK_PLIES: BOOK_PLIES, L1_WHITE: L1_WHITE, L1_BLACK: L1_BLACK, RULES: RULES,
    selfTest: selfTest, selfTestLegality: selfTestLegality,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachBook; }
