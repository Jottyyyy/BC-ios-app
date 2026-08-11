import SwiftUI
import BiyaherongCoachCore

// Board-mutation helpers shared by every screen that animates a move. They take a `[BoardPiece]`
// (which carries a stable `id` per piece, so SwiftUI slides rather than replaces) and apply one
// move to it, including the two cases a naive "move the piece" gets wrong: en passant, where the
// captured pawn is not on the destination square, and castling, where the rook moves too.
//
// Lifted out of PuzzleView.swift when the Puzzle Hub arrived. They were always general; living in
// that file only meant a second screen could not reach them without depending on a retired one.

// Shared piece-mutation helpers (used by the puzzle board; mirror ChessGameVM's logic).
func capturedPiece(in pos: ChessPosition, move m: Move) -> Piece? {
    let moving = pos.squares[m.from]!
    let isEP = moving.kind == .pawn && m.to == pos.enPassant && pos.squares[m.to] == nil
    let cs = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                  : (pos.squares[m.to] != nil ? m.to : nil)
    return cs.flatMap { pos.squares[$0] }
}

func mutatePieces(_ pieces: inout [BoardPiece], move m: Move, positionBefore pos: ChessPosition) {
    let moving = pos.squares[m.from]!
    let isEP = moving.kind == .pawn && m.to == pos.enPassant && pos.squares[m.to] == nil
    let capSq = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                     : (pos.squares[m.to] != nil ? m.to : nil)
    if let cs = capSq { pieces.removeAll { $0.square == cs } }
    if let idx = pieces.firstIndex(where: { $0.square == m.from }) {
        if let promo = m.promotion { pieces[idx].piece = Piece(moving.color, promo) }
        pieces[idx].square = m.to
    }
    if moving.kind == .king, abs(Square.file(m.to) - Square.file(m.from)) == 2 {
        let rank = Square.rank(m.from)
        let (rf, rt) = Square.file(m.to) == 6
            ? (Square.make(file: 7, rank: rank), Square.make(file: 5, rank: rank))
            : (Square.make(file: 0, rank: rank), Square.make(file: 3, rank: rank))
        if let ri = pieces.firstIndex(where: { $0.square == rf }) { pieces[ri].square = rt }
    }
}

func move(fromUci uci: String, in pos: ChessPosition) -> Move? {
    let cs = Array(uci)
    guard cs.count >= 4,
          let from = Square.index(String(cs[0...1])),
          let to = Square.index(String(cs[2...3])) else { return nil }
    var promo: PieceKind?
    if cs.count >= 5 { promo = ["q": .queen, "r": .rook, "b": .bishop, "n": .knight][Character(cs[4].lowercased())] }
    return pos.legalMoves().first { $0.from == from && $0.to == to && $0.promotion == promo }
}

func piecesFrom(_ pos: ChessPosition) -> [BoardPiece] {
    (0..<64).compactMap { sq in pos.squares[sq].map { BoardPiece(id: UUID(), square: sq, piece: $0) } }
}
