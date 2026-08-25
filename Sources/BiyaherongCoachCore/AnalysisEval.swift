import Foundation

/// The evaluation the **analysis** engine uses, and the Zobrist keys its transposition table needs.
///
/// Transliterated from `web-demo/js/analysis-eval.js`, which is proven by a 47-assertion suite
/// covering mirror symmetry over six positions, every structural term against a control position,
/// the direction tables against `Engine.pseudoLegalMoves`, and a 400-position key-collision walk.
///
/// ## Why this is not `ChessAI.evaluate`
///
/// `ChessAI.evaluate` is material plus one piece-square table and nothing else, and it is
/// **parity-pinned** — the five coach personas are golden-tested against it, so changing it would
/// change how every coach plays. It stays exactly as it is. This sits beside it, exactly as
/// `CoachEngine` sits beside `ChessAI`, and only `LocalEngine` uses it.
///
/// What the old one could not see, and this one can:
///
/// - **Game phase.** One king table for the whole game pushes the king into the corner in a K+P
///   endgame, where its job is to march up the board. Every term is scored twice — midgame and
///   endgame — and interpolated on the material left. This alone is the largest single fix.
/// - **Pawn structure** — doubled, isolated and passed pawns, the last weighted far higher in the
///   endgame where a passed pawn is often the whole position.
/// - **King safety** — the pawn shield, open files beside the king, and an enemy queen closing in.
/// - **Mobility** — how many squares each piece actually reaches.
/// - **Bishop pair**, **rooks on open files**, and a **tempo** bonus.
///
/// ## The scale is deliberately unchanged
///
/// A pawn is still 100 centipawns and the sign is still side-to-move relative, so the eval bar, the
/// engine panel, `GameReview.classifyMove`'s thresholds and `ReviewAnnotator` all keep working with
/// no change at all. This makes the number *better*, never differently scaled.
///
/// ## Keep this `internal`
///
/// `BiyaherongUI` has its own `AnalysisEval` — the eval BAR's metrics. The two never collide today
/// because this one is module-internal and therefore invisible over there. Making it `public` would
/// make every bare `AnalysisEval.` in the UI module ambiguous-looking and quietly resolve to the
/// wrong one. `LocalEngine` is the only caller and lives in this module, so there is no reason to.
enum AnalysisEval {

    // MARK: - Material

    /// Midgame values are `ChessAI.material` itself. The endgame set raises pawns (a passed pawn
    /// wins games) and rooks, the two pieces that gain most as the board empties.
    static func materialMG(_ k: PieceKind) -> Int { ChessAI.material(k) }

    static func materialEG(_ k: PieceKind) -> Int {
        switch k { case .pawn: return 120; case .knight: return 320; case .bishop: return 340
        case .rook: return 530; case .queen: return 940; case .king: return 0 }
    }

    // MARK: - Piece-square tables

    /// Midgame **is** `ChessAI.table`, called through rather than copied, so the two cannot drift.
    static func tableMG(_ k: PieceKind) -> [Int] { ChessAI.table(k) }

    /// Only the king and the pawn get their own endgame table: they are the two pieces whose correct
    /// square genuinely inverts between the phases. The other four reuse the midgame table, and the
    /// mobility and passed-pawn terms carry the rest of the endgame knowledge.
    static func tableEG(_ k: PieceKind) -> [Int] {
        switch k {
        case .king: return kingEG
        case .pawn: return pawnEG
        default: return ChessAI.table(k)
        }
    }

    /// Written a1-first to match `ChessAI.table`'s orientation (index 0 = a1, rows ascend by rank).
    static let kingEG: [Int] = [
        -50, -30, -30, -30, -30, -30, -30, -50,
        -30, -30, 0, 0, 0, 0, -30, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 30, 40, 40, 30, -10, -30,
        -30, -10, 20, 30, 30, 20, -10, -30,
        -30, -20, -10, 0, 0, -10, -20, -30,
        -50, -40, -30, -20, -20, -30, -40, -50
    ]

    static let pawnEG: [Int] = [
        0, 0, 0, 0, 0, 0, 0, 0,
        5, 5, 5, 5, 5, 5, 5, 5,
        10, 10, 10, 10, 10, 10, 10, 10,
        20, 20, 20, 20, 20, 20, 20, 20,
        35, 35, 35, 35, 35, 35, 35, 35,
        60, 60, 60, 60, 60, 60, 60, 60,
        100, 100, 100, 100, 100, 100, 100, 100,
        0, 0, 0, 0, 0, 0, 0, 0
    ]

    // MARK: - Phase

    /// The classic 24-point scale: every knight and bishop is 1, every rook 2, every queen 4. A full
    /// board is 24 (pure midgame), a bare K+P endgame is 0. Capped, because promotions can exceed it.
    static func phaseWeight(_ k: PieceKind) -> Int {
        switch k { case .knight, .bishop: return 1; case .rook: return 2; case .queen: return 4
        default: return 0 }
    }
    static let phaseMax = 24

    // MARK: - Term weights

    static let doubledMG = -12, doubledEG = -24
    static let isolatedMG = -14, isolatedEG = -18
    /// Indexed by the pawn's rank RELATIVE to its own side (0 = home rank, 6 = about to promote).
    static let passedMG = [0, 5, 10, 20, 35, 60, 100, 0]
    static let passedEG = [0, 10, 20, 35, 60, 100, 150, 0]
    static let bishopPairMG = 30, bishopPairEG = 45
    static let rookOpenMG = 20, rookOpenEG = 10
    static let rookSemiMG = 10, rookSemiEG = 5
    static let tempo = 12
    /// King safety is midgame-only by construction (the taper zeroes it), but it is also the most
    /// expensive term, so it is skipped outright once too little material is left for it to matter.
    static let kingSafetyMinPhase = 6
    static let shieldMissing = -25, shieldFar = -18, shieldNear = -10
    static let kingOpenFile = -15
    static let queenProximity = -4

    static func mobilityMG(_ k: PieceKind) -> Int {
        switch k { case .knight: return 4; case .bishop: return 5; case .rook: return 2
        case .queen: return 1; default: return 0 }
    }
    static func mobilityEG(_ k: PieceKind) -> Int {
        switch k { case .knight: return 4; case .bishop: return 5; case .rook: return 4
        case .queen: return 2; default: return 0 }
    }

    // MARK: - Direction tables

    /// Local copies, because `ChessBoard` does not expose its own. The JS twin's `selfTest` proves
    /// each one against `Engine.pseudoLegalMoves` for a lone piece on an empty board, so "local
    /// copy" cannot quietly become "different copy".
    static let knightOff: [(Int, Int)] = [(1, 2), (2, 1), (2, -1), (1, -2),
                                          (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
    static let kingOff: [(Int, Int)] = [(1, 0), (1, 1), (0, 1), (-1, 1),
                                        (-1, 0), (-1, -1), (0, -1), (1, -1)]
    static let bishopDir: [(Int, Int)] = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    static let rookDir: [(Int, Int)] = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    static let queenDir: [(Int, Int)] = bishopDir + rookDir

    /// How many squares this piece reaches — empty squares plus the first enemy piece on each ray.
    ///
    /// Deliberately **not** `pos.pseudoLegalMoves().filter { … }`: that allocates a `Move` per
    /// destination and this runs at every leaf of the search. Counting into an `Int` is the point.
    static func mobilityCount(_ pos: ChessPosition, _ sq: Int, _ kind: PieceKind,
                              _ color: PieceColor) -> Int {
        let f = Square.file(sq), r = Square.rank(sq)
        var n = 0
        if kind == .knight || kind == .king {
            for off in (kind == .knight ? knightOff : kingOff) {
                let nf = f + off.0, nr = r + off.1
                if nf < 0 || nf > 7 || nr < 0 || nr > 7 { continue }
                if let occ = pos.squares[Square.make(file: nf, rank: nr)] {
                    if occ.color != color { n += 1 }
                } else {
                    n += 1
                }
            }
            return n
        }
        let dirs = kind == .bishop ? bishopDir : (kind == .rook ? rookDir : queenDir)
        for d in dirs {
            var nf = f + d.0, nr = r + d.1
            while nf >= 0, nf <= 7, nr >= 0, nr <= 7 {
                if let occ = pos.squares[Square.make(file: nf, rank: nr)] {
                    if occ.color != color { n += 1 }
                    break
                }
                n += 1
                nf += d.0; nr += d.1
            }
        }
        return n
    }

    /// Chebyshev (king-move) distance — the natural metric for "how close is that queen".
    static func kingDistance(_ a: Int, _ b: Int) -> Int {
        max(abs(Square.file(a) - Square.file(b)), abs(Square.rank(a) - Square.rank(b)))
    }

    // MARK: - Evaluate

    /// Static evaluation, in centipawns, **from the side to move's point of view** — the same sign
    /// convention as `ChessAI.evaluate`, because negamax depends on it and the single flip to
    /// White-relative happens once, at the search root.
    static func evaluate(_ pos: ChessPosition) -> Int {
        var mg = 0, eg = 0, phase = 0

        var pawnsOnFile = [[Int]](repeating: [Int](repeating: 0, count: 8), count: 2)
        var pawnList: [[Int]] = [[], []]
        var bishops = [0, 0]
        var kingSq = [-1, -1]
        var queenSq = [-1, -1]

        for sq in 0..<64 {
            guard let p = pos.squares[sq] else { continue }
            let c = p.color, k = p.kind
            let ci = c == .white ? 0 : 1
            let idx = c == .white ? sq : (sq ^ 56)          // black mirrors vertically
            let vMg = materialMG(k) + tableMG(k)[idx]
            let vEg = materialEG(k) + tableEG(k)[idx]
            if c == .white { mg += vMg; eg += vEg } else { mg -= vMg; eg -= vEg }
            phase += phaseWeight(k)

            switch k {
            case .pawn: pawnsOnFile[ci][Square.file(sq)] += 1; pawnList[ci].append(sq)
            case .bishop: bishops[ci] += 1
            case .king: kingSq[ci] = sq
            case .queen: queenSq[ci] = sq
            default: break
            }

            // Mobility. Pawns are excluded: their value is structure, not square count.
            if k != .pawn {
                let mob = mobilityCount(pos, sq, k, c)
                if c == .white { mg += mob * mobilityMG(k); eg += mob * mobilityEG(k) }
                else { mg -= mob * mobilityMG(k); eg -= mob * mobilityEG(k) }
            }

            // Rooks like files without pawns on them.
            if k == .rook {
                let f = Square.file(sq)
                let own = pawnCount(pos, file: f, color: c)
                let foe = pawnCount(pos, file: f, color: c == .white ? .black : .white)
                var oMg = 0, oEg = 0
                if own == 0 && foe == 0 { oMg = rookOpenMG; oEg = rookOpenEG }
                else if own == 0 { oMg = rookSemiMG; oEg = rookSemiEG }
                if c == .white { mg += oMg; eg += oEg } else { mg -= oMg; eg -= oEg }
            }
        }

        if phase > phaseMax { phase = phaseMax }

        if bishops[0] >= 2 { mg += bishopPairMG; eg += bishopPairEG }
        if bishops[1] >= 2 { mg -= bishopPairMG; eg -= bishopPairEG }

        for ci in 0..<2 {
            let sign = ci == 0 ? 1 : -1
            let mine = pawnsOnFile[ci], theirs = pawnsOnFile[1 - ci]
            let color: PieceColor = ci == 0 ? .white : .black
            for f in 0..<8 {
                if mine[f] > 1 {
                    mg += sign * doubledMG * (mine[f] - 1)
                    eg += sign * doubledEG * (mine[f] - 1)
                }
                if mine[f] > 0, f == 0 || mine[f - 1] == 0, f == 7 || mine[f + 1] == 0 {
                    mg += sign * isolatedMG * mine[f]
                    eg += sign * isolatedEG * mine[f]
                }
            }
            for sq in pawnList[ci] {
                let r = Square.rank(sq)
                let rel = color == .white ? r : 7 - r      // rank from this pawn's own side
                if isPassed(pos, sq, color) {
                    mg += sign * passedMG[rel]
                    eg += sign * passedEG[rel]
                }
            }
            if phase >= kingSafetyMinPhase, kingSq[ci] >= 0 {
                mg += sign * kingSafety(pos, kingSq[ci], color, mine, theirs, queenSq[1 - ci])
            }
        }

        // Taper: a full board is all midgame, a bare endgame all endgame.
        let score = Int((Double(mg * phase + eg * (phaseMax - phase)) / Double(phaseMax)).rounded())
        let stm = pos.sideToMove == .white ? score : -score
        return stm + tempo
    }

    /// Pawns of `color` on `file`. Small enough to recount; called only for rooks.
    static func pawnCount(_ pos: ChessPosition, file f: Int, color: PieceColor) -> Int {
        var n = 0
        for r in 0..<8 {
            if let p = pos.squares[Square.make(file: f, rank: r)], p.kind == .pawn, p.color == color {
                n += 1
            }
        }
        return n
    }

    /// No enemy pawn on this file or either neighbour, anywhere ahead of it.
    static func isPassed(_ pos: ChessPosition, _ sq: Int, _ color: PieceColor) -> Bool {
        let f = Square.file(sq), r = Square.rank(sq)
        let foe: PieceColor = color == .white ? .black : .white
        let lo = f > 0 ? f - 1 : 0, hi = f < 7 ? f + 1 : 7
        for ff in lo...hi {
            if color == .white {
                var r1 = r + 1
                while r1 <= 7 {
                    if let a = pos.squares[Square.make(file: ff, rank: r1)],
                       a.kind == .pawn, a.color == foe { return false }
                    r1 += 1
                }
            } else {
                var r2 = r - 1
                while r2 >= 0 {
                    if let b = pos.squares[Square.make(file: ff, rank: r2)],
                       b.kind == .pawn, b.color == foe { return false }
                    r2 -= 1
                }
            }
        }
        return true
    }

    /// Midgame king safety: the pawns in front of it, the files beside it, and the enemy queen.
    ///
    /// Deliberately **not** an attack-map count. Asking `isAttacked` for the nine squares around each
    /// king is eighteen ray-scans per leaf, which measurably outweighed what it bought; these three
    /// terms are file arithmetic and one distance, and they catch the same
    /// castled-king-stripped-of-its-pawns pattern that actually decides games.
    static func kingSafety(_ pos: ChessPosition, _ ksq: Int, _ color: PieceColor,
                           _ myPawnFiles: [Int], _ foePawnFiles: [Int], _ foeQueenSq: Int) -> Int {
        let f = Square.file(ksq), r = Square.rank(ksq)
        var s = 0
        let lo = f > 0 ? f - 1 : 0, hi = f < 7 ? f + 1 : 7
        // A king that can still castle is not yet committed to a shelter, so its "shield" files are
        // whichever three it happens to stand between — d/e/f from the start square. Charging for
        // those is charging White for playing 1.e4, and it did: e4 and d4 were each fined 18cp
        // while Nc3 and Nf3 paid nothing, so the engine's whole opening repertoire became
        // Nc3/Nf3/e3/d3. Once the rights are gone — by castling, or by the king walking out — the
        // term is exactly right and applies unchanged.
        let canCastle = color == .white ? (pos.castleWK || pos.castleWQ)
                                        : (pos.castleBK || pos.castleBQ)
        for ff in lo...hi {
            // The nearest friendly pawn ahead of the king on this file.
            var dist = -1
            var step = 1
            while step <= 7 {
                let rr = color == .white ? r + step : r - step
                if rr < 0 || rr > 7 { break }
                if let p = pos.squares[Square.make(file: ff, rank: rr)],
                   p.kind == .pawn, p.color == color { dist = step; break }
                step += 1
            }
            if !canCastle {
                if dist < 0 { s += shieldMissing }
                else if dist == 2 { s += shieldNear }
                else if dist > 2 { s += shieldFar }
            }
            // A file with no pawn of either colour is a highway to the king.
            if myPawnFiles[ff] == 0 && foePawnFiles[ff] == 0 { s += kingOpenFile }
        }
        if foeQueenSq >= 0 { s += queenProximity * (7 - kingDistance(foeQueenSq, ksq)) }
        return s
    }

    // MARK: - Zobrist

    /// Seeded, so the table is fixed and the search is deterministic run to run.
    ///
    /// The JS twin splits every key into two 32-bit halves because JavaScript's bitwise operators
    /// truncate to 32 bits; Swift has no such problem, so a key here is one `UInt64`. The two
    /// languages therefore hash to different numbers, which is fine and deliberate — the table is a
    /// per-search accelerator, never part of any output, and nothing compares the two.
    static let zobristSeed: UInt64 = 0x9E3779B97F4A7C15

    struct Zobrist {
        var piece: [UInt64]        // ((color * 6) + kind) * 64 + square
        var castle: [UInt64]
        var enPassant: [UInt64]
        var side: UInt64
    }

    /// SplitMix64 — one line, no state beyond the counter, and identical on every platform.
    static func splitMix64(_ state: inout UInt64) -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }

    static let zobrist: Zobrist = {
        var state = zobristSeed
        var piece = [UInt64](repeating: 0, count: 2 * 6 * 64)
        for i in 0..<piece.count { piece[i] = splitMix64(&state) }
        var castle = [UInt64](repeating: 0, count: 4)
        for i in 0..<4 { castle[i] = splitMix64(&state) }
        var ep = [UInt64](repeating: 0, count: 8)
        for i in 0..<8 { ep[i] = splitMix64(&state) }
        return Zobrist(piece: piece, castle: castle, enPassant: ep, side: splitMix64(&state))
    }()

    static func pieceIndex(_ color: PieceColor, _ kind: PieceKind, _ sq: Int) -> Int {
        (((color == .white ? 0 : 1) * 6) + kind.rawValue) * 64 + sq
    }

    /// This position's key. Called once per interior node, never in quiescence, where the leaves are.
    static func hash(_ pos: ChessPosition) -> UInt64 {
        var h: UInt64 = 0
        for sq in 0..<64 {
            guard let p = pos.squares[sq] else { continue }
            h ^= zobrist.piece[pieceIndex(p.color, p.kind, sq)]
        }
        if pos.castleWK { h ^= zobrist.castle[0] }
        if pos.castleWQ { h ^= zobrist.castle[1] }
        if pos.castleBK { h ^= zobrist.castle[2] }
        if pos.castleBQ { h ^= zobrist.castle[3] }
        // Only the FILE, and only when the square is set — matching `positionKey`'s rule that a dead
        // en-passant square must not split a transposition.
        if let ep = pos.enPassant { h ^= zobrist.enPassant[Square.file(ep)] }
        if pos.sideToMove == .black { h ^= zobrist.side }
        return h
    }

    /// Any non-pawn, non-king material — the null-move pruning zugzwang guard.
    static func hasNonPawnMaterial(_ pos: ChessPosition, _ color: PieceColor) -> Bool {
        for sq in 0..<64 {
            if let p = pos.squares[sq], p.color == color, p.kind != .pawn, p.kind != .king {
                return true
            }
        }
        return false
    }

    /// 0 (bare endgame) to 24 (full board). Exposed for the search's pruning decisions.
    static func phaseOf(_ pos: ChessPosition) -> Int {
        var n = 0
        for sq in 0..<64 {
            if let p = pos.squares[sq] { n += phaseWeight(p.kind) }
        }
        return min(n, phaseMax)
    }
}
