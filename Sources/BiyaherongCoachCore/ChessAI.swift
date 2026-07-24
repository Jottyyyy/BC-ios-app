import Foundation

/// A coach opponent (Play vs Coach, brief §8.1). Strength is shaped by search depth plus
/// human-like imperfection (a chance to play a random move, and eval noise for variety).
public struct CoachPersona: Sendable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let blurb: String
    public let title: String            // Beginner … Master (display rank)
    public let favoriteOpening: String
    public let rating: Int              // approximate playing strength (Elo-ish), for display
    public let depth: Int
    public let blunderChance: Double    // 0…1 probability of playing a random legal move
    public let randomness: Int          // ± centipawn noise added to root move scores

    public init(id: String, name: String, blurb: String, title: String, favoriteOpening: String,
                rating: Int, depth: Int, blunderChance: Double, randomness: Int) {
        self.id = id; self.name = name; self.blurb = blurb
        self.title = title; self.favoriteOpening = favoriteOpening; self.rating = rating
        self.depth = depth; self.blunderChance = blunderChance; self.randomness = randomness
    }
}

public enum Coaches {
    /// The 5 coach characters (names from the current app), weakest → strongest.
    public static let all: [CoachPersona] = [
        .init(id: "jaden", name: "Jaden Pogi", blurb: "Learning the ropes — plays fast and loose.",
              title: "Beginner", favoriteOpening: "Italian Game", rating: 650, depth: 1, blunderChance: 0.35, randomness: 90),
        .init(id: "jade", name: "Pretty Jade", blurb: "Tidy club player who keeps the position clean.",
              title: "Casual", favoriteOpening: "Scandinavian Defense", rating: 1150, depth: 2, blunderChance: 0.16, randomness: 55),
        .init(id: "jude", name: "Handsome Jude", blurb: "Sharp tactician — always hunting a combination.",
              title: "Club", favoriteOpening: "Sicilian Najdorf", rating: 1550, depth: 2, blunderChance: 0.06, randomness: 30),
        .init(id: "julie", name: "Mommy Julie", blurb: "Patient and positional. Squeezes you slowly.",
              title: "Expert", favoriteOpening: "Queen's Gambit", rating: 1850, depth: 3, blunderChance: 0.03, randomness: 15),
        .init(id: "pogi", name: "Coach Pogi", blurb: "Master strength. Punishes every mistake.",
              title: "Master", favoriteOpening: "Ruy López", rating: 2250, depth: 3, blunderChance: 0.0, randomness: 0),
    ]
    /// Lowest and highest coach ratings (for strength-bar scaling).
    public static let ratingFloor = 500
    public static let ratingCeiling = 2400
}

/// A small but correct negamax + alpha-beta engine with material + piece-square evaluation.
/// Pure and deterministic given a fixed RNG (the RNG is only touched for blunders/eval noise).
public enum ChessAI {

    static let mate = 1_000_000

    static func material(_ k: PieceKind) -> Int {
        switch k { case .pawn: return 100; case .knight: return 320; case .bishop: return 330
        case .rook: return 500; case .queen: return 900; case .king: return 0 }
    }

    /// Static evaluation from the side-to-move's perspective (centipawns).
    public static func evaluate(_ pos: ChessPosition) -> Int {
        var score = 0
        for s in 0..<64 {
            guard let p = pos.squares[s] else { continue }
            let pst = table(p.kind)[p.color == .white ? s : (s ^ 56)]
            let v = material(p.kind) + pst
            score += p.color == .white ? v : -v
        }
        return pos.sideToMove == .white ? score : -score
    }

    static func negamax(_ pos: ChessPosition, _ depth: Int, _ alpha0: Int, _ beta: Int, _ ply: Int) -> Int {
        let moves = pos.legalMoves()
        if moves.isEmpty { return pos.isInCheck(pos.sideToMove) ? -(mate - ply) : 0 }  // mate / stalemate
        if depth == 0 { return evaluate(pos) }
        var alpha = alpha0
        var best = Int.min + 1
        for m in ordered(moves, pos) {
            let score = -negamax(pos.makeMove(m), depth - 1, -beta, -alpha, ply + 1)
            if score > best { best = score }
            if best > alpha { alpha = best }
            if alpha >= beta { break }
        }
        return best
    }

    /// Captures first (MVV-LVA-ish) to sharpen alpha-beta; stable within equal keys.
    static func ordered(_ moves: [Move], _ pos: ChessPosition) -> [Move] {
        moves.enumerated().sorted { a, b in
            let ka = captureScore(a.element, pos), kb = captureScore(b.element, pos)
            return ka != kb ? ka > kb : a.offset < b.offset
        }.map(\.element)
    }
    static func captureScore(_ m: Move, _ pos: ChessPosition) -> Int {
        guard let victim = pos.squares[m.to] else { return -1 }
        let attacker = pos.squares[m.from]!
        return material(victim.kind) * 10 - material(attacker.kind)
    }

    /// Best move for `persona`. Deterministic when the persona has no blunder/randomness.
    public static func bestMove<G: RandomNumberGenerator>(_ pos: ChessPosition, persona: CoachPersona, using rng: inout G) -> Move? {
        let moves = pos.legalMoves()
        guard !moves.isEmpty else { return nil }
        if persona.blunderChance > 0, Double.random(in: 0..<1, using: &rng) < persona.blunderChance {
            return moves.randomElement(using: &rng)
        }
        var best: Move?
        var bestScore = Int.min + 1
        for m in ordered(moves, pos) {
            var score = -negamax(pos.makeMove(m), persona.depth - 1, Int.min + 2, Int.max - 2, 1)
            if persona.randomness > 0 { score += Int.random(in: -persona.randomness...persona.randomness, using: &rng) }
            if score > bestScore { bestScore = score; best = m }
        }
        return best
    }

    // Piece-square tables, white's perspective, a1 = index 0. Black reads `table[s ^ 56]`.
    static func table(_ k: PieceKind) -> [Int] {
        switch k {
        case .pawn: return pawn
        case .knight: return knight
        case .bishop: return bishop
        case .rook: return rook
        case .queen: return queen
        case .king: return king
        }
    }

    static let pawn = [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 10, 10, -20, -20, 10, 10, 5,
        5, -5, -10, 0, 0, -10, -5, 5,
        0, 0, 0, 20, 20, 0, 0, 0,
        5, 5, 10, 25, 25, 10, 5, 5,
        10, 10, 20, 30, 30, 20, 10, 10,
        50, 50, 50, 50, 50, 50, 50, 50,
        0, 0, 0, 0, 0, 0, 0, 0,
    ]
    static let knight = [
        -50, -40, -30, -30, -30, -30, -40, -50,
        -40, -20, 0, 5, 5, 0, -20, -40,
        -30, 5, 10, 15, 15, 10, 5, -30,
        -30, 0, 15, 20, 20, 15, 0, -30,
        -30, 5, 15, 20, 20, 15, 5, -30,
        -30, 0, 10, 15, 15, 10, 0, -30,
        -40, -20, 0, 0, 0, 0, -20, -40,
        -50, -40, -30, -30, -30, -30, -40, -50,
    ]
    static let bishop = [
        -20, -10, -10, -10, -10, -10, -10, -20,
        -10, 5, 0, 0, 0, 0, 5, -10,
        -10, 10, 10, 10, 10, 10, 10, -10,
        -10, 0, 10, 10, 10, 10, 0, -10,
        -10, 5, 5, 10, 10, 5, 5, -10,
        -10, 0, 5, 10, 10, 5, 0, -10,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -20, -10, -10, -10, -10, -10, -10, -20,
    ]
    static let rook = [
        0, 0, 0, 5, 5, 0, 0, 0,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        -5, 0, 0, 0, 0, 0, 0, -5,
        5, 10, 10, 10, 10, 10, 10, 5,
        0, 0, 0, 0, 0, 0, 0, 0,
    ]
    static let queen = [
        -20, -10, -10, -5, -5, -10, -10, -20,
        -10, 0, 5, 0, 0, 0, 0, -10,
        -10, 5, 5, 5, 5, 5, 0, -10,
        0, 0, 5, 5, 5, 5, 0, -5,
        -5, 0, 5, 5, 5, 5, 0, -5,
        -10, 0, 5, 5, 5, 5, 0, -10,
        -10, 0, 0, 0, 0, 0, 0, -10,
        -20, -10, -10, -5, -5, -10, -10, -20,
    ]
    static let king = [
        20, 30, 10, 0, 0, 10, 30, 20,
        20, 20, 0, 0, 0, 0, 20, 20,
        -10, -20, -20, -20, -20, -20, -20, -10,
        -20, -30, -30, -40, -40, -30, -30, -20,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
        -30, -40, -40, -50, -50, -40, -40, -30,
    ]
}
