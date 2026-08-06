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

  // ---- Perft (move-gen correctness self-test) -------------------------------
  function perft(pos, depth) {
    if (depth === 0) return 1;
    var moves = legalMoves(pos);
    if (depth === 1) return moves.length;
    var nodes = 0;
    for (var i = 0; i < moves.length; i++) nodes += perft(applyRaw(pos, moves[i]), depth - 1);
    return nodes;
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
    makeMove: makeMove, status: status, san: san, perft: perft
  };
})(typeof window !== 'undefined' ? window : globalThis);
