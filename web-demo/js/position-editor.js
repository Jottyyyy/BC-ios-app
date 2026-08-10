/* position-editor.js — Setup Position (edit mode) for the Analysis Board
 *
 * The browser mirror of Sources/BiyaherongCoachCore/PositionEditor.swift.
 *
 *     node -e "console.log(require('./web-demo/js/position-editor.js').selfTest().summary)"
 *
 * Ported from board.tsx: `handleEditSquarePress:2389`, `syncCastlingFromFen:2421`,
 * `toggleEditMode:2429`, `handleLoadFen:2533` and `validateKingPositions:334`.
 *
 * ── Why validation lives here ─────────────────────────────────────────────────
 * The original checks only two things itself (`validateKingPositions`): a missing king, and kings
 * standing next to each other. Everything else it delegates to chess.js —
 * `toggleEditMode:2448` builds the FEN, hands it to `new Chess(fen)` and catches the throw. We have
 * no chess.js offline, so those rejections have to be written down rather than inherited. The set
 * below is what that constructor would have refused:
 *
 *   missing king · two kings of one colour · adjacent kings · a pawn on rank 1 or 8 ·
 *   the side NOT to move already in check (you cannot be "about to be captured")
 *
 * One deliberate softening, recorded in PORTING_NOTES: castling rights whose king or rook is not on
 * its home square are DROPPED SILENTLY rather than reported. That is the X-FEN convention, it is
 * what a user ticking `⬜K` on a board with no h1 rook actually means, and refusing would be a
 * dead end with no obvious fix. Everything else is a hard stop with a message.
 *
 * The editor never sets an en-passant square: neither does the original, because chess.js emits `-`
 * for any position it did not reach by a double pawn push.
 *
 * PURE — no DOM, no storage, no clock. Classic script, so it runs from file:// on Windows.
 */
var BiyaPositionEditor = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;

  /* ===================== piece keys ===================== */

  // board.tsx:276-277 — the palette rows, in the source's order.
  var WHITE_PIECE_KEYS = ['K', 'Q', 'R', 'B', 'N', 'P'];
  var BLACK_PIECE_KEYS = ['k', 'q', 'r', 'b', 'n', 'p'];
  var ERASER = 'eraser';

  var KIND_OF = { p: E.PAWN, n: E.KNIGHT, b: E.BISHOP, r: E.ROOK, q: E.QUEEN, k: E.KING };

  /** 'K' -> {color: WHITE, kind: KING};  null for anything unrecognised. */
  function pieceFor(key) {
    if (typeof key !== 'string' || key.length !== 1) return null;
    var lower = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(KIND_OF, lower)) return null;
    return { color: key === key.toUpperCase() ? E.WHITE : E.BLACK, kind: KIND_OF[lower] };
  }

  /** The inverse, for rendering the palette selection back out of a square. */
  function keyFor(piece) {
    if (!piece) return null;
    var base = 'pnbrqk'[piece.kind];
    return piece.color === E.WHITE ? base.toUpperCase() : base;
  }

  /* ===================== the editor ===================== */

  function create(fen) {
    var pos = fen ? E.fromFEN(fen) : E.start();
    if (!pos) pos = E.start();
    return {
      squares: pos.squares.slice(),
      sideToMove: pos.sideToMove,
      castleWK: pos.castleWK, castleWQ: pos.castleWQ,
      castleBK: pos.castleBK, castleBQ: pos.castleBQ
    };
  }

  function clone(ed) {
    return {
      squares: ed.squares.slice(),
      sideToMove: ed.sideToMove,
      castleWK: ed.castleWK, castleWQ: ed.castleWQ,
      castleBK: ed.castleBK, castleBQ: ed.castleBQ
    };
  }

  function put(ed, sq, key) {
    if (sq < 0 || sq > 63) return false;
    var p = pieceFor(key);
    if (!p) return false;
    ed.squares[sq] = p;
    return true;
  }

  function removeAt(ed, sq) {
    if (sq < 0 || sq > 63) return false;
    var had = ed.squares[sq] != null;
    ed.squares[sq] = null;
    return had;
  }

  /** 🧹 Clear — board.tsx:3675. Castling rights go with the rooks. */
  function clear(ed) {
    ed.squares = new Array(64).fill(null);
    ed.castleWK = ed.castleWQ = ed.castleBK = ed.castleBQ = false;
  }

  /** Back to the standard array, side and rights (not in the source's UI, but the obvious inverse). */
  function reset(ed) {
    var s = E.start();
    ed.squares = s.squares.slice();
    ed.sideToMove = s.sideToMove;
    ed.castleWK = ed.castleWQ = ed.castleBK = ed.castleBQ = true;
  }

  function toggleSideToMove(ed) {
    ed.sideToMove = ed.sideToMove === E.WHITE ? E.BLACK : E.WHITE;
    return ed.sideToMove;
  }

  /**
   * Paste FEN → Load (board.tsx:2533-2547). The source also syncs the turn and castling toggles
   * from the loaded string (`:2540-2542`), which is the only reason this is not just `create`.
   */
  function loadFEN(ed, fen) {
    var pos = E.fromFEN(String(fen == null ? '' : fen).trim());
    if (!pos) return false;
    ed.squares = pos.squares.slice();
    ed.sideToMove = pos.sideToMove;
    ed.castleWK = pos.castleWK; ed.castleWQ = pos.castleWQ;
    ed.castleBK = pos.castleBK; ed.castleBQ = pos.castleBQ;
    return true;
  }

  /* ===================== castling normalisation ===================== */

  var E1 = 4, H1 = 7, A1 = 0, E8 = 60, H8 = 63, A8 = 56;

  function isPiece(sq, squares, color, kind) {
    var p = squares[sq];
    return !!p && p.color === color && p.kind === kind;
  }

  /**
   * Drop rights the board cannot support. X-FEN convention, applied silently — see the header.
   * Returns a plain object so a caller can show what survived without mutating the editor.
   */
  function normalizedCastling(ed) {
    var s = ed.squares;
    var wKingHome = isPiece(E1, s, E.WHITE, E.KING);
    var bKingHome = isPiece(E8, s, E.BLACK, E.KING);
    return {
      wk: ed.castleWK && wKingHome && isPiece(H1, s, E.WHITE, E.ROOK),
      wq: ed.castleWQ && wKingHome && isPiece(A1, s, E.WHITE, E.ROOK),
      bk: ed.castleBK && bKingHome && isPiece(H8, s, E.BLACK, E.ROOK),
      bq: ed.castleBQ && bKingHome && isPiece(A8, s, E.BLACK, E.ROOK)
    };
  }

  /* ===================== FEN ===================== */

  /** The position the editor currently describes, as a plain Engine position (never null). */
  function position(ed) {
    var c = normalizedCastling(ed);
    return {
      squares: ed.squares.slice(),
      sideToMove: ed.sideToMove,
      castleWK: c.wk, castleWQ: c.wq, castleBK: c.bk, castleBQ: c.bq,
      enPassant: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  function fen(ed) { return E.toFEN(position(ed)); }

  /* ===================== validation ===================== */

  var ISSUES = {
    whiteKingMissing:    'White king is missing.',
    blackKingMissing:    'Black king is missing.',
    tooManyWhiteKings:   'There can only be one white king.',
    tooManyBlackKings:   'There can only be one black king.',
    kingsAdjacent:       'Kings cannot be adjacent — illegal position.',
    pawnOnBackRank:      'A pawn cannot stand on rank 1 or rank 8.',
    sideNotToMoveInCheck: 'The side not to move is already in check.'
  };

  function issueText(code) { return ISSUES[code] || code; }

  /**
   * Every reason this board cannot be played from, in a fixed order so the banner is stable.
   * The first two messages are the source's, verbatim (validateKingPositions:352, :356).
   */
  function validate(ed) {
    var out = [];
    var s = ed.squares;
    var wKings = [], bKings = [];
    var pawnOnBack = false;

    for (var sq = 0; sq < 64; sq++) {
      var p = s[sq];
      if (!p) continue;
      if (p.kind === E.KING) { (p.color === E.WHITE ? wKings : bKings).push(sq); }
      if (p.kind === E.PAWN) {
        var rank = E.sqRank(sq);
        if (rank === 0 || rank === 7) pawnOnBack = true;
      }
    }

    if (wKings.length === 0) out.push('whiteKingMissing');
    if (bKings.length === 0) out.push('blackKingMissing');
    if (wKings.length > 1) out.push('tooManyWhiteKings');
    if (bKings.length > 1) out.push('tooManyBlackKings');

    // Every pair, not just the first of each colour: on a board that already has a duplicate king,
    // checking only wKings[0] would let a genuine adjacency hide behind the count error.
    var adjacent = false;
    for (var wi = 0; wi < wKings.length && !adjacent; wi++) {
      for (var bi = 0; bi < bKings.length; bi++) {
        if (Math.abs(E.sqFile(wKings[wi]) - E.sqFile(bKings[bi])) <= 1
            && Math.abs(E.sqRank(wKings[wi]) - E.sqRank(bKings[bi])) <= 1) { adjacent = true; break; }
      }
    }
    if (adjacent) out.push('kingsAdjacent');

    if (pawnOnBack) out.push('pawnOnBackRank');

    // The side that just "moved" cannot still be in check — chess.js refuses this too.
    // Only meaningful once both kings exist and are not already flagged as adjacent.
    if (wKings.length === 1 && bKings.length === 1 && out.indexOf('kingsAdjacent') < 0) {
      var pos = position(ed);
      var waiting = ed.sideToMove === E.WHITE ? E.BLACK : E.WHITE;
      if (E.isInCheck(pos, waiting)) out.push('sideNotToMoveInCheck');
    }

    return out;
  }

  function isValid(ed) { return validate(ed).length === 0; }

  /** The banner text, or null when the board is playable. */
  function firstIssueText(ed) {
    var v = validate(ed);
    return v.length ? issueText(v[0]) : null;
  }

  /**
   * ✓ Apply Position (board.tsx:2432-2471): validate, then hand back a real position.
   * null means the board was refused — the caller keeps the user in edit mode, as the source does.
   */
  function apply(ed) {
    if (!isValid(ed)) return null;
    return E.fromFEN(fen(ed));      // round-trip so the caller gets a canonical position
  }

  /* ===================== self-test ===================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function eq(a, b, what) {
      expect(a === b, what + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
    }
    function issues(ed) { return validate(ed).join(','); }

    // ---- piece keys ----------------------------------------------------------
    eq(WHITE_PIECE_KEYS.length, 6, 'six white palette keys');
    eq(BLACK_PIECE_KEYS.length, 6, 'six black palette keys');
    eq(WHITE_PIECE_KEYS.join(''), 'KQRBNP', 'white palette order matches board.tsx:276');
    eq(BLACK_PIECE_KEYS.join(''), 'kqrbnp', 'black palette order matches board.tsx:277');
    for (var i = 0; i < WHITE_PIECE_KEYS.length; i++) {
      var k = WHITE_PIECE_KEYS[i];
      eq(keyFor(pieceFor(k)), k, 'round trip ' + k);
      eq(keyFor(pieceFor(BLACK_PIECE_KEYS[i])), BLACK_PIECE_KEYS[i], 'round trip ' + BLACK_PIECE_KEYS[i]);
    }
    eq(pieceFor('K').color, E.WHITE, 'uppercase is White');
    eq(pieceFor('k').color, E.BLACK, 'lowercase is Black');
    eq(pieceFor('x'), null, 'an unknown letter is not a piece');
    eq(pieceFor(''), null, 'the empty string is not a piece');
    eq(pieceFor('KQ'), null, 'a two-character key is not a piece');
    eq(keyFor(null), null, 'no piece, no key');

    // ---- create / clone ------------------------------------------------------
    var ed = create();
    eq(fen(ed), E.START_FEN, 'a fresh editor is the start position');
    eq(ed.sideToMove, E.WHITE, 'White to move by default');
    expect(ed.castleWK && ed.castleWQ && ed.castleBK && ed.castleBQ, 'all four rights start on');
    var c1 = clone(ed);
    put(c1, 28, 'Q');
    expect(ed.squares[28] == null, 'clone does not alias the original squares');
    eq(fen(create('8/8/8/8/8/8/8/K6k w - - 0 1')), '8/8/8/8/8/8/8/K6k w - - 0 1', 'create from a FEN');
    eq(fen(create('not a fen')), E.START_FEN, 'a broken FEN falls back to the start position');

    // ---- put / remove / clear ------------------------------------------------
    var ed2 = create();
    clear(ed2);
    eq(fen(ed2).split(' ')[0], '8/8/8/8/8/8/8/8', 'clear empties the board');
    expect(!ed2.castleWK && !ed2.castleWQ && !ed2.castleBK && !ed2.castleBQ,
      'clear drops the castling toggles with the rooks');
    expect(put(ed2, 4, 'K'), 'place a white king on e1');
    expect(put(ed2, 60, 'k'), 'place a black king on e8');
    eq(fen(ed2).split(' ')[0], '4k3/8/8/8/8/8/8/4K3', 'the two kings are where they were put');
    expect(!put(ed2, 64, 'K'), 'a square past the board is refused');
    expect(!put(ed2, -1, 'K'), 'a negative square is refused');
    expect(!put(ed2, 20, 'Z'), 'an unknown piece key is refused');
    expect(removeAt(ed2, 4), 'removing an occupied square reports true');
    expect(!removeAt(ed2, 4), 'removing an empty square reports false');
    expect(!removeAt(ed2, 99), 'removing off-board reports false');
    put(ed2, 4, 'K');

    // ---- side to move --------------------------------------------------------
    eq(toggleSideToMove(ed2), E.BLACK, 'toggle to Black');
    eq(fen(ed2).split(' ')[1], 'b', 'and the FEN says so');
    eq(toggleSideToMove(ed2), E.WHITE, 'toggle back to White');

    // ---- reset ---------------------------------------------------------------
    var ed3 = create('8/8/8/8/8/8/8/K6k b - - 0 1');
    reset(ed3);
    eq(fen(ed3), E.START_FEN, 'reset restores the start position, side and rights');

    // ---- loadFEN -------------------------------------------------------------
    var ed4 = create();
    expect(loadFEN(ed4, 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'), 'a legal FEN loads');
    eq(ed4.sideToMove, E.BLACK, 'loadFEN syncs the turn (board.tsx:2541)');
    expect(ed4.castleWK && ed4.castleWQ && ed4.castleBK && ed4.castleBQ,
      'loadFEN syncs all four castling toggles (board.tsx:2542)');
    // Trimming is not cosmetic: ChessPosition(fen:) splits on the SPACE character only, so a FEN
    // pasted from a web page with a leading tab or newline would be rejected there without it.
    // NOTE: removing `.trim()` is an EQUIVALENT MUTANT *in JavaScript* — engine.js splits on /\s+/
    // and drops empties, so these two cases pass either way here. The assertion that actually kills
    // it lives in the Swift `position_editor` group, where the parser is stricter.
    expect(loadFEN(ed4, '\t8/8/8/8/8/8/8/K6k w - - 0 1\n'),
      'a tab/newline wrapped FEN is trimmed and loads');
    eq(fen(ed4), '8/8/8/8/8/8/8/K6k w - - 0 1', 'and the trimmed FEN is what loaded');
    expect(!loadFEN(ed4, '   \t \n  '), 'whitespace alone is not a FEN');
    expect(!loadFEN(ed4, 'garbage'), 'a broken FEN is refused');
    eq(fen(ed4), '8/8/8/8/8/8/8/K6k w - - 0 1', 'and a refused load changes nothing');
    expect(!loadFEN(ed4, ''), 'the empty string is refused');
    expect(!loadFEN(ed4, null), 'null is refused');
    // A loaded ep square is dropped, like everything else the editor emits.
    expect(loadFEN(ed4, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'),
      'a FEN carrying an ep square loads');
    eq(fen(ed4).split(' ')[3], '-', 'but the editor never emits an en-passant square');

    // ---- castling normalisation ----------------------------------------------
    var ed5 = create();
    removeAt(ed5, 7);                                   // take the h1 rook away
    eq(fen(ed5).split(' ')[2], 'Qkq', 'no h1 rook, no white kingside right');
    removeAt(ed5, 0);
    eq(fen(ed5).split(' ')[2], 'kq', 'no a1 rook either');
    var ed6 = create();
    removeAt(ed6, 4); put(ed6, 12, 'K');                // king off e1
    eq(fen(ed6).split(' ')[2], 'kq', 'a king off its home square loses both white rights');
    var ed6b = create();
    removeAt(ed6b, 60); put(ed6b, 52, 'k');             // and the same for Black
    eq(fen(ed6b).split(' ')[2], 'KQ', 'a black king off e8 loses both black rights');
    var ed6c = create();
    removeAt(ed6c, 63);
    eq(fen(ed6c).split(' ')[2], 'KQq', 'no h8 rook, no black kingside right');
    var ed6d = create();
    removeAt(ed6d, 56);
    eq(fen(ed6d).split(' ')[2], 'KQk', 'no a8 rook, no black queenside right');
    var ed7 = create();
    ed7.castleWK = ed7.castleBQ = false;
    eq(fen(ed7).split(' ')[2], 'Qk', 'the toggles themselves are honoured');
    var ed8 = create();
    clear(ed8); put(ed8, 4, 'K'); put(ed8, 60, 'k');
    ed8.castleWK = ed8.castleWQ = ed8.castleBK = ed8.castleBQ = true;
    eq(fen(ed8).split(' ')[2], '-', 'ticking every box with no rooks on the board yields no rights');
    var nc = normalizedCastling(create());
    expect(nc.wk && nc.wq && nc.bk && nc.bq, 'the start position keeps all four');

    // ---- validation ----------------------------------------------------------
    var v = create();
    eq(issues(v), '', 'the start position is valid');
    expect(isValid(v), 'isValid agrees');
    eq(firstIssueText(v), null, 'and there is no banner');

    var noKings = create(); clear(noKings);
    eq(issues(noKings), 'whiteKingMissing,blackKingMissing', 'an empty board is missing both kings');
    eq(firstIssueText(noKings), 'White king is missing.', 'the message is the source\'s, verbatim');

    var oneKing = create(); clear(oneKing); put(oneKing, 0, 'K');
    eq(issues(oneKing), 'blackKingMissing', 'a lone white king is missing its opponent');
    eq(firstIssueText(oneKing), 'Black king is missing.', 'second message, also verbatim');

    var twoWhite = create(); clear(twoWhite);
    put(twoWhite, 0, 'K'); put(twoWhite, 2, 'K'); put(twoWhite, 63, 'k');
    eq(issues(twoWhite), 'tooManyWhiteKings', 'two white kings is refused');
    var twoBlack = create(); clear(twoBlack);
    put(twoBlack, 0, 'K'); put(twoBlack, 61, 'k'); put(twoBlack, 63, 'k');
    eq(issues(twoBlack), 'tooManyBlackKings', 'two black kings is refused');

    var adj = create(); clear(adj); put(adj, 0, 'K'); put(adj, 1, 'k');   // a1 / b1
    eq(issues(adj), 'kingsAdjacent', 'side by side');
    eq(firstIssueText(adj), 'Kings cannot be adjacent — illegal position.', 'the source\'s wording');
    var diag = create(); clear(diag); put(diag, 0, 'K'); put(diag, 9, 'k'); // a1 / b2
    eq(issues(diag), 'kingsAdjacent', 'diagonally adjacent counts too');
    var apart = create(); clear(apart); put(apart, 0, 'K'); put(apart, 18, 'k'); // a1 / c3
    eq(issues(apart), '', 'a knight\'s move apart is fine');
    var sameFile = create(); clear(sameFile); put(sameFile, 0, 'K'); put(sameFile, 8, 'k'); // a1 / a2
    eq(issues(sameFile), 'kingsAdjacent', 'one rank apart on the same file');

    var pawn8 = create(); clear(pawn8);
    put(pawn8, 0, 'K'); put(pawn8, 63, 'k'); put(pawn8, 56, 'P');   // a8
    eq(issues(pawn8), 'pawnOnBackRank', 'a white pawn on rank 8');
    var pawn1 = create(); clear(pawn1);
    put(pawn1, 4, 'K'); put(pawn1, 60, 'k'); put(pawn1, 1, 'p');    // b1
    eq(issues(pawn1), 'pawnOnBackRank', 'a black pawn on rank 1');
    var pawn2 = create(); clear(pawn2);
    put(pawn2, 4, 'K'); put(pawn2, 60, 'k'); put(pawn2, 8, 'P');    // a2
    eq(issues(pawn2), '', 'a pawn on rank 2 is ordinary');

    // The side NOT to move must not be in check.
    var wrongCheck = create('4k3/8/8/8/8/8/8/4R2K w - - 0 1');       // Re1 attacks e8, White to move
    eq(issues(wrongCheck), 'sideNotToMoveInCheck', 'Black is in check but it is White to move');
    var rightCheck = create('4k3/8/8/8/8/8/8/4R2K b - - 0 1');
    eq(issues(rightCheck), '', 'the same board with Black to move is a legal check');
    var noCheck = create('4k3/8/8/8/8/8/8/R6K w - - 0 1');
    eq(issues(noCheck), '', 'no check either way');
    var whiteInCheck = create('3k3r/8/8/8/8/8/8/7K b - - 0 1');      // Rh8 attacks Kh1 down the h-file
    eq(issues(whiteInCheck), 'sideNotToMoveInCheck', 'and it works the other way round too');

    // Order is fixed, so the banner does not flicker between renders.
    var many = create(); clear(many);
    put(many, 0, 'K'); put(many, 1, 'K'); put(many, 2, 'k'); put(many, 56, 'P');
    eq(issues(many), 'tooManyWhiteKings,kingsAdjacent,pawnOnBackRank', 'issues come back in a fixed order');
    eq(issueText('kingsAdjacent'), ISSUES.kingsAdjacent, 'issueText looks the message up');
    eq(issueText('nonsense'), 'nonsense', 'and passes an unknown code straight through');

    // ---- apply ----------------------------------------------------------------
    eq(apply(noKings), null, 'an invalid board applies to nothing');
    var good = create('8/8/8/3k4/8/8/4P3/4K3 w - - 0 1');
    var applied = apply(good);
    expect(applied != null, 'a legal board applies');
    eq(E.toFEN(applied), '8/8/8/3k4/8/8/4P3/4K3 w - - 0 1', 'and reproduces its own FEN');
    eq(E.legalMoves(applied).length > 0, true, 'the applied position generates moves');
    // Apply resets the clocks, exactly as `new Chess(fen)` in the source does not preserve them.
    var clocks = create('8/8/8/3k4/8/8/4P3/4K3 w - - 37 99');
    eq(fen(clocks).split(' ').slice(4).join(' '), '0 1', 'the editor always emits fresh clocks');

    // A round trip through apply is stable — the property the move tree depends on.
    var probes = [
      '8/8/8/8/8/8/8/K6k w - - 0 1',
      'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      '8/5k2/8/8/8/8/2P5/6K1 b - - 0 1',
      '4k3/8/4K3/8/8/8/8/8 w - - 0 1'                          // kings two ranks apart
    ];
    for (var pi = 0; pi < probes.length; pi++) {
      var probeEd = create(probes[pi]);
      var out = apply(probeEd);
      if (out == null) { expect(false, 'probe ' + probes[pi] + ' should apply'); continue; }
      eq(E.toFEN(out), fen(probeEd), 'apply round trip: ' + probes[pi]);
    }

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'PositionEditorSelfTest: ' + passed + ' assertions passed'
        : 'PositionEditorSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    WHITE_PIECE_KEYS: WHITE_PIECE_KEYS, BLACK_PIECE_KEYS: BLACK_PIECE_KEYS, ERASER: ERASER,
    ISSUES: ISSUES,
    pieceFor: pieceFor, keyFor: keyFor,
    create: create, clone: clone,
    put: put, removeAt: removeAt, clear: clear, reset: reset, toggleSideToMove: toggleSideToMove,
    loadFEN: loadFEN, normalizedCastling: normalizedCastling,
    position: position, fen: fen,
    validate: validate, isValid: isValid, issueText: issueText, firstIssueText: firstIssueText,
    apply: apply,
    selfTest: selfTest
  };
})();

/* Makes the pure layer runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPositionEditor; }
