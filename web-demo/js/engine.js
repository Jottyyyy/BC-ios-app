/* =============================================================================
 * engine.js — Chess rules engine
 * Faithful 1:1 JavaScript port of:
 *   Sources/BiyaherongCoachCore/ChessBoard.swift  (perft-verified in the Swift app)
 *
 * 8x8 mailbox board. Square index = rank*8 + file, with a1 = 0, h1 = 7,
 * a8 = 56, h8 = 63. A piece is a plain immutable object {color, kind};
 * an empty square is null.
 *
 * No dependencies. Loads as a classic <script> (no ES modules) so it runs
 * straight from file:// on Windows. Everything is exposed on window.Engine.
 *
 * If you edit move generation, run the app with ?selftest to re-check perft.
 * ========================================================================== */
(function (global) {
  'use strict';

  // ---- Enums (match PieceColor / PieceKind raw values in ChessBoard.swift) ----
  var WHITE = 0, BLACK = 1;
  var PAWN = 0, KNIGHT = 1, BISHOP = 2, ROOK = 3, QUEEN = 4, KING = 5;
  var SAN_LETTER = ['', 'N', 'B', 'R', 'Q', 'K']; // pawn has no letter

  function opponent(c) { return c === WHITE ? BLACK : WHITE; }

  // ---- Piece ----------------------------------------------------------------
  function piece(color, kind) { return { color: color, kind: kind }; }
  function samePiece(a, b) { return !!a && !!b && a.color === b.color && a.kind === b.kind; }

  // ---- Square helpers (Square enum in Swift) --------------------------------
  function sqMake(file, rank) { return rank * 8 + file; }
  function sqFile(sq) { return sq & 7; }
  function sqRank(sq) { return sq >> 3; }
  function sqName(sq) { return String.fromCharCode(97 + sqFile(sq)) + (sqRank(sq) + 1); }
  function sqIndex(name) {
    if (!name || name.length !== 2) return null;
    var f = name.charCodeAt(0), r = name.charCodeAt(1);
    if (f < 97 || f > 104 || r < 49 || r > 56) return null;
    return sqMake(f - 97, r - 49);
  }

  // ---- Move -----------------------------------------------------------------
  function move(from, to, promotion) {
    return { from: from, to: to, promotion: (promotion === undefined ? null : promotion) };
  }
  function moveUci(m) {
    return sqName(m.from) + sqName(m.to) + (m.promotion != null ? SAN_LETTER[m.promotion].toLowerCase() : '');
  }
  function moveEquals(a, b) {
    return a.from === b.from && a.to === b.to && (a.promotion == null ? null : a.promotion) === (b.promotion == null ? null : b.promotion);
  }

  // ---- Position -------------------------------------------------------------
  // { squares:Array(64), sideToMove, castleWK,castleWQ,castleBK,castleBQ,
  //   enPassant:(sq|null), halfmove, fullmove }
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function clone(pos) {
    return {
      squares: pos.squares.slice(),
      sideToMove: pos.sideToMove,
      castleWK: pos.castleWK, castleWQ: pos.castleWQ,
      castleBK: pos.castleBK, castleBQ: pos.castleBQ,
      enPassant: pos.enPassant,
      halfmove: pos.halfmove, fullmove: pos.fullmove
    };
  }

  function pieceFromChar(ch) {
    var color = (ch >= 'A' && ch <= 'Z') ? WHITE : BLACK;
    switch (ch.toLowerCase()) {
      case 'p': return piece(color, PAWN);
      case 'n': return piece(color, KNIGHT);
      case 'b': return piece(color, BISHOP);
      case 'r': return piece(color, ROOK);
      case 'q': return piece(color, QUEEN);
      case 'k': return piece(color, KING);
      default: return null;
    }
  }
  function symbol(p) {
    var base = 'pnbrqk'[p.kind];
    return p.color === WHITE ? base.toUpperCase() : base;
  }

  // Parse FEN → position (or null if invalid). Mirrors init?(fen:).
  function fromFEN(fen) {
    var parts = fen.split(/\s+/).filter(function (s) { return s.length; });
    if (parts.length < 4) return null;
    var board = new Array(64).fill(null);
    var ranks = parts[0].split('/');
    if (ranks.length !== 8) return null;
    for (var i = 0; i < 8; i++) {
      var rank = 7 - i;                 // FEN lists rank 8 first
      var file = 0, rankStr = ranks[i];
      for (var c = 0; c < rankStr.length; c++) {
        var ch = rankStr[c];
        var d = '12345678'.indexOf(ch);
        if (d >= 0) { file += (d + 1); continue; }
        if (file >= 8) return null;
        var p = pieceFromChar(ch);
        if (!p) return null;
        board[sqMake(file, rank)] = p;
        file += 1;
      }
      if (file !== 8) return null;
    }
    var cr = parts[2];
    var epField = parts[3];
    var half = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    var full = parts.length > 5 ? parseInt(parts[5], 10) : 1;
    return {
      squares: board,
      sideToMove: parts[1] === 'w' ? WHITE : BLACK,
      castleWK: cr.indexOf('K') >= 0, castleWQ: cr.indexOf('Q') >= 0,
      castleBK: cr.indexOf('k') >= 0, castleBQ: cr.indexOf('q') >= 0,
      enPassant: epField === '-' ? null : sqIndex(epField),
      halfmove: isNaN(half) ? 0 : half,
      fullmove: isNaN(full) ? 1 : full
    };
  }

  // Serialize position → FEN. Mirrors `var fen`.
  function toFEN(pos) {
    var rows = [];
    for (var rank = 7; rank >= 0; rank--) {
      var row = '', empty = 0;
      for (var file = 0; file < 8; file++) {
        var p = pos.squares[sqMake(file, rank)];
        if (p) { if (empty > 0) { row += empty; empty = 0; } row += symbol(p); }
        else empty++;
      }
      if (empty > 0) row += empty;
      rows.push(row);
    }
    var cr = '';
    if (pos.castleWK) cr += 'K';
    if (pos.castleWQ) cr += 'Q';
    if (pos.castleBK) cr += 'k';
    if (pos.castleBQ) cr += 'q';
    if (cr === '') cr = '-';
    var ep = pos.enPassant == null ? '-' : sqName(pos.enPassant);
    return rows.join('/') + ' ' + (pos.sideToMove === WHITE ? 'w' : 'b') +
      ' ' + cr + ' ' + ep + ' ' + pos.halfmove + ' ' + pos.fullmove;
  }

  function start() { return fromFEN(START_FEN); }

  // ---- Attack / check queries ----------------------------------------------
  var KNIGHT_OFF = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_OFF = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var BISHOP_DIR = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ROOK_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function kingSquare(pos, color) {
    for (var s = 0; s < 64; s++) {
      var p = pos.squares[s];
      if (p && p.color === color && p.kind === KING) return s;
    }
    return -1; // matches Swift `?? -1` fallback used by legalMoves()
  }

  function slideHits(pos, f, r, dirs, kinds, color) {
    for (var i = 0; i < dirs.length; i++) {
      var nf = f + dirs[i][0], nr = r + dirs[i][1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        var p = pos.squares[sqMake(nf, nr)];
        if (p) { if (p.color === color && kinds.indexOf(p.kind) >= 0) return true; break; }
        nf += dirs[i][0]; nr += dirs[i][1];
      }
    }
    return false;
  }

  // Is `sq` attacked by any piece of `color`?
  function isAttacked(pos, sq, color) {
    var f = sqFile(sq), r = sqRank(sq);
    // pawns
    var pawnRankDir = color === WHITE ? -1 : 1;
    for (var d = 0; d < 2; d++) {
      var pf = f + (d === 0 ? -1 : 1), pr = r + pawnRankDir;
      if (pf >= 0 && pf < 8 && pr >= 0 && pr < 8) {
        var pp = pos.squares[sqMake(pf, pr)];
        if (pp && pp.color === color && pp.kind === PAWN) return true;
      }
    }
    // knights
    for (var k = 0; k < KNIGHT_OFF.length; k++) {
      var nf = f + KNIGHT_OFF[k][0], nr = r + KNIGHT_OFF[k][1];
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        var np = pos.squares[sqMake(nf, nr)];
        if (np && np.color === color && np.kind === KNIGHT) return true;
      }
    }
    // king
    for (var g = 0; g < KING_OFF.length; g++) {
      var kf = f + KING_OFF[g][0], kr = r + KING_OFF[g][1];
      if (kf >= 0 && kf < 8 && kr >= 0 && kr < 8) {
        var kp = pos.squares[sqMake(kf, kr)];
        if (kp && kp.color === color && kp.kind === KING) return true;
      }
    }
    // sliding
    if (slideHits(pos, f, r, BISHOP_DIR, [BISHOP, QUEEN], color)) return true;
    if (slideHits(pos, f, r, ROOK_DIR, [ROOK, QUEEN], color)) return true;
    return false;
  }

  function isInCheck(pos, color) {
    var k = kingSquare(pos, color);
    if (k < 0) return false;
    return isAttacked(pos, k, opponent(color));
  }

  // ---- Move generation ------------------------------------------------------
  function addLeap(pos, from, nf, nr, color, moves) {
    if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) return;
    var to = sqMake(nf, nr);
    var p = pos.squares[to];
    if (p && p.color === color) return;   // own piece blocks
    moves.push(move(from, to));
  }

  function slide(pos, from, f, r, dirs, color, moves) {
    for (var i = 0; i < dirs.length; i++) {
      var nf = f + dirs[i][0], nr = r + dirs[i][1];
      while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        var to = sqMake(nf, nr);
        var p = pos.squares[to];
        if (p) { if (p.color !== color) moves.push(move(from, to)); break; }
        moves.push(move(from, to));
        nf += dirs[i][0]; nr += dirs[i][1];
      }
    }
  }

  function addPawn(from, to, promo, moves) {
    if (promo) {
      var order = [QUEEN, ROOK, BISHOP, KNIGHT];
      for (var i = 0; i < 4; i++) moves.push(move(from, to, order[i]));
    } else moves.push(move(from, to));
  }

  function pawnMoves(pos, sq, f, r, color, moves) {
    var dir = color === WHITE ? 1 : -1;
    var startRank = color === WHITE ? 1 : 6;
    var promoRank = color === WHITE ? 7 : 0;
    // single push
    var oneR = r + dir;
    if (oneR >= 0 && oneR < 8 && pos.squares[sqMake(f, oneR)] == null) {
      addPawn(sq, sqMake(f, oneR), oneR === promoRank, moves);
      // double push (intermediate square implicitly empty because we're inside the "one ahead empty" branch)
      if (r === startRank && pos.squares[sqMake(f, r + 2 * dir)] == null) {
        moves.push(move(sq, sqMake(f, r + 2 * dir)));
      }
    }
    // captures + en passant
    for (var d = 0; d < 2; d++) {
      var cf = f + (d === 0 ? -1 : 1), cr = r + dir;
      if (cf < 0 || cf >= 8 || cr < 0 || cr >= 8) continue;
      var to = sqMake(cf, cr);
      var p = pos.squares[to];
      if (p && p.color !== color) addPawn(sq, to, cr === promoRank, moves);
      else if (to === pos.enPassant) moves.push(move(sq, to));
    }
  }

  function castlingMoves(pos, sq, color, moves) {
    var rank = color === WHITE ? 0 : 7;
    if (sq !== sqMake(4, rank)) return;                 // king must sit on the e-file
    if (isAttacked(pos, sq, opponent(color))) return;    // can't castle out of check
    var kingSide = color === WHITE ? pos.castleWK : pos.castleBK;
    var queenSide = color === WHITE ? pos.castleWQ : pos.castleBQ;
    if (kingSide) {
      var f5 = sqMake(5, rank), g6 = sqMake(6, rank);
      if (pos.squares[f5] == null && pos.squares[g6] == null &&
        !isAttacked(pos, f5, opponent(color)) && !isAttacked(pos, g6, opponent(color))) {
        moves.push(move(sq, g6));
      }
    }
    if (queenSide) {
      var d3 = sqMake(3, rank), c2 = sqMake(2, rank), b1 = sqMake(1, rank);
      if (pos.squares[d3] == null && pos.squares[c2] == null && pos.squares[b1] == null &&
        !isAttacked(pos, d3, opponent(color)) && !isAttacked(pos, c2, opponent(color))) {
        moves.push(move(sq, c2));       // b1/b8 checked for occupancy only, not attack (standard)
      }
    }
  }

  function pseudoLegalMoves(pos) {
    var moves = [];
    for (var sq = 0; sq < 64; sq++) {
      var p = pos.squares[sq];
      if (!p || p.color !== pos.sideToMove) continue;
      var f = sqFile(sq), r = sqRank(sq);
      switch (p.kind) {
        case PAWN: pawnMoves(pos, sq, f, r, p.color, moves); break;
        case KNIGHT: for (var i = 0; i < KNIGHT_OFF.length; i++) addLeap(pos, sq, f + KNIGHT_OFF[i][0], r + KNIGHT_OFF[i][1], p.color, moves); break;
        case KING:
          for (var g = 0; g < KING_OFF.length; g++) addLeap(pos, sq, f + KING_OFF[g][0], r + KING_OFF[g][1], p.color, moves);
          castlingMoves(pos, sq, p.color, moves);
          break;
        case BISHOP: slide(pos, sq, f, r, BISHOP_DIR, p.color, moves); break;
        case ROOK: slide(pos, sq, f, r, ROOK_DIR, p.color, moves); break;
        case QUEEN: slide(pos, sq, f, r, BISHOP_DIR.concat(ROOK_DIR), p.color, moves); break;
      }
    }
    return moves;
  }

  // Legal = pseudo-legal, minus moves that leave the mover's own king in check.
  function legalMoves(pos) {
    var mover = pos.sideToMove;
    var pseudo = pseudoLegalMoves(pos);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var next = applyRaw(pos, pseudo[i]);
      if (!isAttacked(next, kingSquare(next, mover), opponent(mover))) out.push(pseudo[i]);
    }
    return out;
  }

  function legalMovesFrom(pos, sq) {
    return legalMoves(pos).filter(function (m) { return m.from === sq; });
  }

  // ---- Make move ------------------------------------------------------------
  // Returns a NEW position. Never mutates `pos`. Order of effects matches applyRaw().
  function applyRaw(pos, m) {
    var p = clone(pos);
    var mover = pos.squares[m.from];
    var isPawn = mover.kind === PAWN;
    var isCapture = pos.squares[m.to] != null || (isPawn && m.to === pos.enPassant);

    p.squares[m.from] = null;
    // en passant capture: remove the pawn behind the target square
    if (isPawn && m.to === pos.enPassant && pos.squares[m.to] == null) {
      var capRank = sqRank(m.from);
      p.squares[sqMake(sqFile(m.to), capRank)] = null;
    }
    // place the piece (handles promotion)
    p.squares[m.to] = piece(mover.color, m.promotion != null ? m.promotion : mover.kind);

    // castling: relocate the rook
    if (mover.kind === KING && Math.abs(sqFile(m.to) - sqFile(m.from)) === 2) {
      var rank = sqRank(m.from);
      if (sqFile(m.to) === 6) { // king side
        p.squares[sqMake(5, rank)] = p.squares[sqMake(7, rank)];
        p.squares[sqMake(7, rank)] = null;
      } else {                  // queen side
        p.squares[sqMake(3, rank)] = p.squares[sqMake(0, rank)];
        p.squares[sqMake(0, rank)] = null;
      }
    }

    // castling rights
    if (mover.kind === KING) {
      if (mover.color === WHITE) { p.castleWK = false; p.castleWQ = false; }
      else { p.castleBK = false; p.castleBQ = false; }
    }
    // rook moved off, or a rook captured on, a home square
    clearRookRight(p, m.from);
    clearRookRight(p, m.to);

    // en passant target (only on a double pawn push)
    if (isPawn && Math.abs(sqRank(m.to) - sqRank(m.from)) === 2) {
      p.enPassant = sqMake(sqFile(m.from), (sqRank(m.from) + sqRank(m.to)) / 2);
    } else {
      p.enPassant = null;
    }

    p.halfmove = (isPawn || isCapture) ? 0 : pos.halfmove + 1;
    if (pos.sideToMove === BLACK) p.fullmove = pos.fullmove + 1;
    p.sideToMove = opponent(pos.sideToMove);
    return p;
  }

  function clearRookRight(p, sq) {
    if (sq === sqMake(0, 0)) p.castleWQ = false;
    else if (sq === sqMake(7, 0)) p.castleWK = false;
    else if (sq === sqMake(0, 7)) p.castleBQ = false;
    else if (sq === sqMake(7, 7)) p.castleBK = false;
  }

  function makeMove(pos, m) { return applyRaw(pos, m); }

  // ---- Status ---------------------------------------------------------------
  // 'ongoing' | 'check' | 'checkmate' | 'stalemate'
  function status(pos) {
    var inCheck = isInCheck(pos, pos.sideToMove);
    if (legalMoves(pos).length === 0) return inCheck ? 'checkmate' : 'stalemate';
    return inCheck ? 'check' : 'ongoing';
  }

  // ---- SAN ------------------------------------------------------------------
  function san(pos, m) {
    var mover = pos.squares[m.from];
    // castling
    if (mover.kind === KING && Math.abs(sqFile(m.to) - sqFile(m.from)) === 2) {
      var base = sqFile(m.to) === 6 ? 'O-O' : 'O-O-O';
      return base + checkSuffix(applyRaw(pos, m));
    }
    var isCapture = pos.squares[m.to] != null || (mover.kind === PAWN && m.to === pos.enPassant);
    var s = '';
    if (mover.kind === PAWN) {
      if (isCapture) s += String.fromCharCode(97 + sqFile(m.from)) + 'x';
      s += sqName(m.to);
      if (m.promotion != null) s += '=' + SAN_LETTER[m.promotion];
    } else {
      s += SAN_LETTER[mover.kind];
      s += disambiguation(pos, m, mover);
      if (isCapture) s += 'x';
      s += sqName(m.to);
    }
    return s + checkSuffix(applyRaw(pos, m));
  }

  function disambiguation(pos, m, mover) {
    var others = legalMoves(pos).filter(function (o) {
      return o.to === m.to && o.from !== m.from && samePiece(pos.squares[o.from], mover);
    });
    if (others.length === 0) return '';
    var sameFile = others.some(function (o) { return sqFile(o.from) === sqFile(m.from); });
    var sameRank = others.some(function (o) { return sqRank(o.from) === sqRank(m.from); });
    if (!sameFile) return String.fromCharCode(97 + sqFile(m.from));
    if (!sameRank) return String(sqRank(m.from) + 1);
    return sqName(m.from);
  }

  function checkSuffix(next) {
    var st = status(next);
    if (st === 'checkmate') return '#';
    if (st === 'check') return '+';
    return '';
  }

  // ---- SAN / UCI parsing ----------------------------------------------------
  // The inverse of san(). Parsers return null on anything they cannot resolve — never throw —
  // matching the sqIndex() convention above.

  // Strip what carries no positional meaning: check/mate marks, !? annotations, the e.p. marker,
  // and the zero-spelling of castling.
  function normalizeSan(s) {
    if (typeof s !== 'string') return '';
    var t = s.trim().replace(/\s*e\.p\.$/i, '').replace(/[+#!?]+$/, '');
    if (t === '0-0') return 'O-O';
    if (t === '0-0-0') return 'O-O-O';
    return t;
  }

  // Tolerant form: over-disambiguated (Nbd2 where Nd2 suffices), long algebraic (Nb1d2, Nb1-d2),
  // 'x' omitted (ed5), '=' omitted or parenthesised (a8Q, a8(Q)). Real PGN exporters emit all of it.
  var LOOSE_SAN = /^([NBRQK])?([a-h])?([1-8])?[x:-]?([a-h][1-8])(?:\s*=?\s*\(?([NBRQnbrq])\)?)?$/;

  function parseSanLoose(pos, want, moves) {
    var m = LOOSE_SAN.exec(want);
    if (!m) return null;
    var kind = m[1] ? SAN_LETTER.indexOf(m[1]) : PAWN;
    var fromFile = m[2] ? m[2].charCodeAt(0) - 97 : -1;
    var fromRank = m[3] ? parseInt(m[3], 10) - 1 : -1;
    var to = sqIndex(m[4]);
    var promo = m[5] ? SAN_LETTER.indexOf(m[5].toUpperCase()) : -1;
    if (to == null) return null; // a1 is 0, so this must be a null test, not a truthiness test
    var hits = [];
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i], pc = pos.squares[mv.from];
      if (mv.to !== to || pc.kind !== kind) continue;
      if (fromFile >= 0 && sqFile(mv.from) !== fromFile) continue;
      if (fromRank >= 0 && sqRank(mv.from) !== fromRank) continue;
      // An unspecified promotion defaults to queen, the universal convention.
      if (promo >= 0 ? mv.promotion !== promo
                     : (mv.promotion != null && mv.promotion !== QUEEN)) continue;
      hits.push(mv);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  // SAN -> Move. Two tiers: an exact match against SAN generated by san() itself — which makes the
  // inverse correct by construction, so parse and generate can never drift — then the tolerant
  // structural pass for spellings we would not have produced.
  function parseSan(pos, sanInput) {
    var want = normalizeSan(sanInput);
    if (want === '') return null;
    var moves = legalMoves(pos), i;
    for (i = 0; i < moves.length; i++) {
      if (normalizeSan(san(pos, moves[i])) === want) return moves[i];
    }
    return parseSanLoose(pos, want, moves);
  }

  // UCI -> Move ('e2e4', 'e7e8q'). Matched against legal moves, so illegal input yields null.
  function parseUci(pos, uci) {
    if (typeof uci !== 'string') return null;
    var s = uci.trim();
    if (s.length !== 4 && s.length !== 5) return null;
    var from = sqIndex(s.slice(0, 2)), to = sqIndex(s.slice(2, 4));
    if (from == null || to == null) return null;
    var promo = null;
    if (s.length === 5) {
      promo = SAN_LETTER.indexOf(s.charAt(4).toUpperCase());
      if (promo < KNIGHT || promo > QUEEN) return null; // only N B R Q are promotion targets
    }
    var moves = legalMoves(pos);
    for (var i = 0; i < moves.length; i++) {
      var mv = moves[i];
      if (mv.from !== from || mv.to !== to) continue;
      if (promo == null ? mv.promotion == null : mv.promotion === promo) return mv;
    }
    return null;
  }

  // ---- Position key ---------------------------------------------------------
  // The canonical key for transposition lookup (ECO book) and threefold repetition: the 4-field
  // FEN with the en-passant square cleared unless a capture can actually use it.
  //
  // Clearing a dead ep square is NOT cosmetic. toFEN() records the ep target after any double pawn
  // push, so '1. e4 e5 2. Nf3' and '1. Nf3 e5 2. e4' would otherwise hash differently despite being
  // the same position — breaking the commonest transpositions in chess and making threefold miss by
  // one occurrence. This mirrors oracle_position_key() in tools/oracle/chess_oracle.php byte for
  // byte; the two must never diverge.
  //
  // The test is the presence of a capturing pawn (pseudo-legal): a pawn pinned against its own king
  // still counts. That keeps the rule identical in PHP, Swift and JS, and a pin cannot change an
  // opening name.
  function positionKey(pos) {
    var f = toFEN(pos).split(' ');
    var ep = pos.enPassant, live = false;
    if (ep != null) {
      var epFile = sqFile(ep);
      // White captures upward, so its pawn sits a rank below the target; Black's sits a rank above.
      var fromRank = pos.sideToMove === WHITE ? sqRank(ep) - 1 : sqRank(ep) + 1;
      if (fromRank >= 0 && fromRank <= 7) {
        var pawn = piece(pos.sideToMove, PAWN);
        if (epFile > 0 && samePiece(pos.squares[sqMake(epFile - 1, fromRank)], pawn)) live = true;
        if (!live && epFile < 7 && samePiece(pos.squares[sqMake(epFile + 1, fromRank)], pawn)) live = true;
      }
    }
    return f[0] + ' ' + f[1] + ' ' + f[2] + ' ' + (live ? f[3] : '-');
  }

  // ---- Draw rules -----------------------------------------------------------
  // Deliberately NOT folded into status(), which stays 'ongoing'|'check'|'checkmate'|'stalemate' to
  // match ChessPosition.Status in ChessBoard.swift (switched on exhaustively by SoundManager).

  // K/K, K+B/K, K+N/K, and any position where every remaining bishop shares one colour complex.
  // K+N+N/K is deliberately NOT insufficient: mate is unforceable but not impossible.
  function insufficientMaterial(pos) {
    var bishops = [], knights = 0, others = 0, sq, p;
    for (sq = 0; sq < 64; sq++) {
      p = pos.squares[sq];
      if (p == null || p.kind === KING) continue;
      if (p.kind === BISHOP) bishops.push(sq);
      else if (p.kind === KNIGHT) knights++;
      else others++;
    }
    if (others > 0) return false;                  // a pawn, rook or queen can always mate
    if (bishops.length === 0) return knights <= 1; // K/K and K+N/K
    if (knights > 0) return false;                 // bishop + knight can mate
    if (bishops.length === 1) return true;         // K+B/K
    var colour = (sqFile(bishops[0]) + sqRank(bishops[0])) & 1;
    for (var i = 1; i < bishops.length; i++) {
      if (((sqFile(bishops[i]) + sqRank(bishops[i])) & 1) !== colour) return false;
    }
    return true;
  }

  function isFiftyMove(pos) { return pos.halfmove >= 100; }

  function repetitionCount(historyKeys, key) {
    if (!historyKeys) return 0;
    var n = 0;
    for (var i = 0; i < historyKeys.length; i++) if (historyKeys[i] === key) n++;
    return n;
  }

  // `historyKeys` is every positionKey() the game has visited, INCLUDING the current position.
  function isThreefold(historyKeys, key) { return repetitionCount(historyKeys, key) >= 3; }

  function drawReason(pos, historyKeys) {
    if (insufficientMaterial(pos)) return 'insufficient';
    if (isFiftyMove(pos)) return 'fifty';
    if (isThreefold(historyKeys, positionKey(pos))) return 'repetition';
    return null;
  }

  // The single terminal verdict the engine and the game review both short-circuit on.
  // { kind: 'ongoing'|'checkmate'|'draw', reason: string|null, winner: WHITE|BLACK|null }
  function terminalOutcome(pos, historyKeys) {
    var st = status(pos);
    if (st === 'checkmate') {
      return { kind: 'checkmate', reason: 'checkmate', winner: opponent(pos.sideToMove) };
    }
    if (st === 'stalemate') return { kind: 'draw', reason: 'stalemate', winner: null };
    var dr = drawReason(pos, historyKeys);
    if (dr) return { kind: 'draw', reason: dr, winner: null };
    return { kind: 'ongoing', reason: null, winner: null };
  }

  // ---- Perft (move-gen correctness self-test) -------------------------------
  function perft(pos, depth) {
    if (depth === 0) return 1;
    var moves = legalMoves(pos);
    if (depth === 1) return moves.length;
    var nodes = 0;
    for (var i = 0; i < moves.length; i++) nodes += perft(applyRaw(pos, moves[i]), depth - 1);
    return nodes;
  }

  // ---- Self-test ------------------------------------------------------------
  // Self-contained so it runs in the browser (index.html?selftest) and under Node alike. The full
  // 3,105-case replay against the PHP oracle lives in selfTestGoldens(), which needs the goldens
  // on disk and so is Node-only — see tools/qa/js_goldens.js.
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function fen(f) { return fromFEN(f); }
    function uciOf(pos, sanStr) { var m = parseSan(pos, sanStr); return m ? moveUci(m) : null; }
    // Play a SAN line from the start position, returning the final position (null if any ply fails).
    function line(sans, startFen) {
      var pos = startFen ? fen(startFen) : start();
      for (var i = 0; i < sans.length; i++) {
        var m = parseSan(pos, sans[i]);
        if (!m) return null;
        pos = makeMove(pos, m);
      }
      return pos;
    }

    // 1. normalizeSan strips only what carries no positional meaning
    expect(normalizeSan('e4+') === 'e4', 'normalizeSan drops the check mark');
    expect(normalizeSan('Qxf7#') === 'Qxf7', 'normalizeSan drops the mate mark');
    expect(normalizeSan('e4!?') === 'e4', 'normalizeSan drops annotations');
    expect(normalizeSan('Nf3?!') === 'Nf3', 'normalizeSan drops dubious marks');
    expect(normalizeSan('0-0') === 'O-O', 'normalizeSan maps zero-castling');
    expect(normalizeSan('0-0-0') === 'O-O-O', 'normalizeSan maps zero-castling long');
    expect(normalizeSan('exd6 e.p.') === 'exd6', 'normalizeSan drops the e.p. marker');

    // 2. exact forms — the tier-1 path
    var s = start();
    expect(uciOf(s, 'e4') === 'e2e4', 'parseSan pawn push');
    expect(uciOf(s, 'Nf3') === 'g1f3', 'parseSan knight');
    var najdorf = line(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
    expect(najdorf !== null, 'parseSan replays the Najdorf');
    expect(najdorf && toFEN(najdorf).indexOf('rnbqkb1r/1p2pppp/p2p1n2') === 0, 'Najdorf reaches the right position');
    var castled = line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
    expect(castled !== null, 'parseSan handles castling in a line');
    var scholars = line(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']);
    expect(scholars !== null && status(scholars) === 'checkmate', 'Scholar\'s mate ends in checkmate');

    // 3. tolerant forms — the tier-2 path. Every one of these MISSES tier 1 by construction.
    var oneN = fen('7k/8/8/8/8/8/8/1N2K3 w - - 0 1');
    expect(uciOf(oneN, 'Nd2') === 'b1d2', 'parseSan minimal knight move');
    expect(uciOf(oneN, 'Nbd2') === 'b1d2', 'parseSan over-disambiguated by file');
    expect(uciOf(oneN, 'N1d2') === 'b1d2', 'parseSan over-disambiguated by rank');
    expect(uciOf(oneN, 'Nb1d2') === 'b1d2', 'parseSan long algebraic');
    expect(uciOf(oneN, 'Nb1-d2') === 'b1d2', 'parseSan long algebraic with dash');
    var cap = fen('7k/8/8/3p4/4P3/8/8/7K w - - 0 1');
    expect(uciOf(cap, 'exd5') === 'e4d5', 'parseSan pawn capture');
    expect(uciOf(cap, 'ed5') === 'e4d5', 'parseSan pawn capture with x omitted');
    expect(uciOf(cap, 'e4xd5') === 'e4d5', 'parseSan long algebraic capture');
    var promo = fen('8/P6k/8/8/8/8/6K1/8 w - - 0 1');
    expect(uciOf(promo, 'a8=Q') === 'a7a8q', 'parseSan promotion');
    expect(uciOf(promo, 'a8Q') === 'a7a8q', 'parseSan promotion with = omitted');
    expect(uciOf(promo, 'a8(Q)') === 'a7a8q', 'parseSan parenthesised promotion');
    expect(uciOf(promo, 'a8=q') === 'a7a8q', 'parseSan lowercase promotion letter');
    expect(uciOf(promo, 'a8=N') === 'a7a8n', 'parseSan underpromotion');
    expect(uciOf(promo, 'a8') === 'a7a8q', 'parseSan bare promotion defaults to queen');
    var cst = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(uciOf(cst, 'O-O') === 'e1g1', 'parseSan kingside castling');
    expect(uciOf(cst, '0-0-0') === 'e1c1', 'parseSan zero-spelled queenside castling');

    // 4. rejection — null, never a throw and never a wrong guess
    expect(parseSan(s, 'zz9') === null, 'parseSan rejects garbage');
    expect(parseSan(s, 'e5') === null, 'parseSan rejects an illegal move');
    expect(parseSan(s, '') === null, 'parseSan rejects the empty string');
    expect(parseSan(s, '   ') === null, 'parseSan rejects whitespace only');
    expect(parseSan(s, null) === null, 'parseSan rejects a non-string');
    // Two knights both reach d2 here, so this is genuinely ambiguous. (From the start position
    // 'Nd2' is merely ILLEGAL — d2 is occupied — which would pass for the wrong reason.)
    var twoN = fen('7k/8/8/8/8/8/8/1N1K1N2 w - - 0 1');
    expect(parseSan(twoN, 'Nd2') === null, 'parseSan rejects an ambiguous move');
    expect(uciOf(twoN, 'Nbd2') === 'b1d2', 'parseSan resolves the ambiguity by file (b)');
    expect(uciOf(twoN, 'Nfd2') === 'f1d2', 'parseSan resolves the ambiguity by file (f)');

    // 5. UCI
    expect(moveUci(parseUci(s, 'e2e4')) === 'e2e4', 'parseUci pawn push');
    expect(moveUci(parseUci(promo, 'a7a8q')) === 'a7a8q', 'parseUci promotion');
    expect(moveUci(parseUci(promo, 'a7a8N')) === 'a7a8n', 'parseUci uppercase promotion letter');
    expect(parseUci(s, 'e2e5') === null, 'parseUci rejects an illegal move');
    expect(parseUci(s, 'e2e') === null, 'parseUci rejects a short string');
    expect(parseUci(s, 'z9e4') === null, 'parseUci rejects a bad square');
    expect(parseUci(s, 'a7a8k') === null, 'parseUci rejects a king promotion');
    expect(parseUci(s, 42) === null, 'parseUci rejects a non-string');

    // 6. round-trip: every legal move in a spread of positions must survive san -> parseSan
    var rtFens = [
      START_FEN,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      '7k/8/8/8/Q7/8/8/Q2Q2K1 w - - 0 1'
    ];
    for (var f = 0; f < rtFens.length; f++) {
      var rp = fen(rtFens[f]), rms = legalMoves(rp), bad = 0;
      for (var i = 0; i < rms.length; i++) {
        var back = parseSan(rp, san(rp, rms[i]));
        if (!back || !moveEquals(back, rms[i])) bad++;
      }
      expect(bad === 0, 'san -> parseSan round-trip, ' + rms.length + ' moves in position ' + (f + 1)
        + ' (' + bad + ' failed)');
    }

    // 7. positionKey — transpositions collapse, live ep survives, dead ep is cleared
    var pairs = [
      [['e4', 'e5', 'Nf3'], ['Nf3', 'e5', 'e4']],
      [['d4', 'd5', 'c4'], ['c4', 'd5', 'd4']],
      [['e4', 'c5', 'Nf3', 'd6'], ['Nf3', 'd6', 'e4', 'c5']]
    ];
    for (var q = 0; q < pairs.length; q++) {
      var a = line(pairs[q][0]), b = line(pairs[q][1]);
      expect(a && b && positionKey(a) === positionKey(b),
        'transposition ' + pairs[q][0].join(' ') + ' == ' + pairs[q][1].join(' '));
    }
    var liveEp = line(['e4', 'c5', 'e5', 'd5']);
    expect(liveEp && positionKey(liveEp).split(' ')[3] === 'd6', 'a capturable ep square is kept');
    var liveEp2 = line(['d4', 'e6', 'd5', 'c5']);
    expect(liveEp2 && positionKey(liveEp2).split(' ')[3] === 'c6', 'a capturable ep square is kept (dxc6)');
    var deadEp = line(['e4']);
    expect(deadEp && positionKey(deadEp).split(' ')[3] === '-', 'an uncapturable ep square is cleared');
    expect(deadEp && toFEN(deadEp).split(' ')[3] === 'e3', 'toFEN still records the raw ep square');
    expect(positionKey(start()) === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      'positionKey is the 4-field FEN');

    // 8. insufficient material
    var mat = [
      ['8/8/4k3/8/8/3K4/8/8 w - - 0 1', true, 'K vs K'],
      ['8/8/4k3/8/8/3K1B2/8/8 w - - 0 1', true, 'K+B vs K'],
      ['8/8/4k3/8/8/3K1N2/8/8 w - - 0 1', true, 'K+N vs K'],
      ['8/4b3/4k3/8/8/3K1B2/8/8 w - - 0 1', false, 'K+B vs K+B on opposite colours (e7 dark, f3 light)'],
      ['8/5b2/4k3/8/8/3K1B2/8/8 w - - 0 1', true, 'K+B vs K+B on the same colour (f7 and f3 both light)'],
      ['8/8/4k3/8/8/3K1NN1/8/8 w - - 0 1', false, 'K+N+N vs K is NOT insufficient'],
      ['8/8/4k3/8/8/3K1B1N/8/8 w - - 0 1', false, 'K+B+N vs K can mate'],
      ['8/8/4k3/8/8/3K1P2/8/8 w - - 0 1', false, 'a pawn is sufficient'],
      ['8/8/4k3/8/8/3K1R2/8/8 w - - 0 1', false, 'a rook is sufficient'],
      ['8/8/4k3/8/8/3K1Q2/8/8 w - - 0 1', false, 'a queen is sufficient'],
      [START_FEN, false, 'the start position is not a material draw']
    ];
    for (var t = 0; t < mat.length; t++) {
      expect(insufficientMaterial(fen(mat[t][0])) === mat[t][1], 'insufficientMaterial: ' + mat[t][2]);
    }

    // 9. fifty-move boundary
    expect(isFiftyMove(fen('7k/8/8/8/8/8/8/R5K1 w - - 99 60')) === false, 'fifty-move at 99 halfmoves');
    expect(isFiftyMove(fen('7k/8/8/8/8/8/8/R5K1 w - - 100 60')) === true, 'fifty-move at 100 halfmoves');
    expect(isFiftyMove(fen('7k/8/8/8/8/8/8/R5K1 w - - 101 60')) === true, 'fifty-move past 100 halfmoves');

    // 10. repetition counting
    var k = positionKey(start());
    expect(repetitionCount([k, k], k) === 2, 'repetitionCount counts occurrences');
    expect(isThreefold([k, k], k) === false, 'two occurrences is not threefold');
    expect(isThreefold([k, k, k], k) === true, 'three occurrences is threefold');
    var shuffle = line(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
    expect(shuffle !== null && positionKey(shuffle) === positionKey(start()),
      'a knight shuffle returns to the start key');

    // 11. terminalOutcome
    var mated = fen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1');
    expect(terminalOutcome(mated).kind === 'checkmate', 'terminalOutcome detects checkmate');
    expect(terminalOutcome(mated).winner === WHITE, 'terminalOutcome names the winner');
    var stale = fen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(terminalOutcome(stale).kind === 'draw', 'terminalOutcome detects stalemate');
    expect(terminalOutcome(stale).reason === 'stalemate', 'stalemate is reported as such');
    expect(terminalOutcome(fen('8/8/4k3/8/8/3K4/8/8 w - - 0 1')).reason === 'insufficient',
      'terminalOutcome detects a material draw');
    expect(terminalOutcome(fen('7k/8/8/8/8/8/8/R5K1 w - - 100 60')).reason === 'fifty',
      'terminalOutcome detects the fifty-move rule');
    expect(terminalOutcome(start(), [k, k, k]).reason === 'repetition',
      'terminalOutcome detects threefold repetition');
    expect(terminalOutcome(start()).kind === 'ongoing', 'the start position is ongoing');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'EngineSelfTest: ' + passed + ' assertions passed'
        : 'EngineSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  // Replays Goldens/san_parse.json — the real PHP oracle's output. Node-only, because the goldens
  // are gitignored build products. Three assertions per case: the parsed UCI, the resulting FEN
  // (all six fields), and the position key.
  function selfTestGoldens(cases) {
    var passed = 0, failures = [], extra = 0;
    function expect(cond, what) {
      if (cond) { passed++; return; }
      if (failures.length < 40) failures.push(what); else extra++;
    }
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i], pos = fromFEN(c.fenBefore);
      if (pos == null) { expect(false, c.src + ': fenBefore did not parse'); continue; }
      var m = parseSan(pos, c.san);
      if (!m) { expect(false, c.src + ': parseSan("' + c.san + '") returned null'); continue; }
      expect(moveUci(m) === c.uci, c.src + ': uci ' + moveUci(m) + ' != ' + c.uci);
      var after = makeMove(pos, m);
      expect(toFEN(after) === c.fenAfter, c.src + ': fenAfter mismatch');
      expect(positionKey(after) === c.key, c.src + ': positionKey mismatch');
    }
    if (extra > 0) failures.push('… and ' + extra + ' more failures');
    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'EngineGoldens: ' + passed + ' assertions passed over ' + cases.length + ' cases'
        : 'EngineGoldens: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  // ---- Public API -----------------------------------------------------------
  global.Engine = {
    // constants
    WHITE: WHITE, BLACK: BLACK,
    PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    SAN_LETTER: SAN_LETTER, START_FEN: START_FEN,
    // helpers
    opponent: opponent, piece: piece, samePiece: samePiece,
    sqMake: sqMake, sqFile: sqFile, sqRank: sqRank, sqName: sqName, sqIndex: sqIndex,
    move: move, moveUci: moveUci, moveEquals: moveEquals,
    // position
    fromFEN: fromFEN, toFEN: toFEN, start: start, clone: clone,
    // queries
    kingSquare: kingSquare, isAttacked: isAttacked, isInCheck: isInCheck,
    // moves
    pseudoLegalMoves: pseudoLegalMoves, legalMoves: legalMoves, legalMovesFrom: legalMovesFrom,
    makeMove: makeMove, status: status, san: san, perft: perft,
    // notation parsing (the inverse of san / moveUci)
    normalizeSan: normalizeSan, parseSan: parseSan, parseUci: parseUci,
    // position key + draw rules (deliberately outside status(), which mirrors the Swift enum)
    positionKey: positionKey, insufficientMaterial: insufficientMaterial, isFiftyMove: isFiftyMove,
    repetitionCount: repetitionCount, isThreefold: isThreefold,
    drawReason: drawReason, terminalOutcome: terminalOutcome,
    // tests
    selfTest: selfTest, selfTestGoldens: selfTestGoldens
  };

  /* Makes the engine requireable headlessly under Node without changing the browser behaviour.
     This file has no named binding, so unlike home.js the branch lives inside the IIFE. */
  if (typeof module !== 'undefined' && module.exports) { module.exports = global.Engine; }
})(typeof window !== 'undefined' ? window : globalThis);
