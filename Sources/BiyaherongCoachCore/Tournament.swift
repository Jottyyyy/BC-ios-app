import Foundation

// MARK: - Value models

/// A tournament player (mutable scoring row). Mirrors `tournament_players`.
public struct TournamentPlayer: Equatable, Codable {
    public var id: Int
    public var name: String
    public var ncfpRating: Int?
    public var seed: Int
    public var score: Double
    public var directEncounter: Double
    public var buchholz: Int
    public var sonnebornBerger: Int
    public var wins: Int
    public var draws: Int
    public var losses: Int
    public var byes: Int
    public var whiteGames: Int
    public var blackGames: Int

    public init(id: Int, name: String, ncfpRating: Int? = nil, seed: Int = 0,
                score: Double = 0, directEncounter: Double = 0, buchholz: Int = 0,
                sonnebornBerger: Int = 0, wins: Int = 0, draws: Int = 0, losses: Int = 0,
                byes: Int = 0, whiteGames: Int = 0, blackGames: Int = 0) {
        self.id = id; self.name = name; self.ncfpRating = ncfpRating; self.seed = seed
        self.score = score; self.directEncounter = directEncounter; self.buchholz = buchholz
        self.sonnebornBerger = sonnebornBerger; self.wins = wins; self.draws = draws
        self.losses = losses; self.byes = byes; self.whiteGames = whiteGames; self.blackGames = blackGames
    }
}

/// A generated pairing (before persistence).
public struct PairSpec: Equatable, Codable {
    public var white: Int?
    public var black: Int?
    public var isBye: Bool
    public init(white: Int?, black: Int?, isBye: Bool) {
        self.white = white; self.black = black; self.isBye = isBye
    }
}

/// A persisted pairing row. `result` ∈ {"1-0","0-1","1/2-1/2","bye","pending"}.
public struct TournamentPairing: Equatable, Codable {
    public var whitePlayerId: Int?
    public var blackPlayerId: Int?
    public var result: String
    public var isBye: Bool
    public init(whitePlayerId: Int?, blackPlayerId: Int?, result: String, isBye: Bool) {
        self.whitePlayerId = whitePlayerId; self.blackPlayerId = blackPlayerId
        self.result = result; self.isBye = isBye
    }
}

/// A round with its pairings.
public struct TournamentRound: Equatable, Codable {
    public var roundNumber: Int
    public var pairings: [TournamentPairing]
    public init(roundNumber: Int, pairings: [TournamentPairing]) {
        self.roundNumber = roundNumber; self.pairings = pairings
    }
}

// MARK: - Engine (pure ports of TournamentController private methods)

public enum TournamentEngine {

    public static let freeMaxPlayers = 10
    public static let freeMaxRounds = 3
    public static let premiumMaxPlayers = 999
    public static let premiumMaxRounds = 30

    // ── pairing history ──────────────────────────────────────────────────────

    /// Undirected "min-max" keys of every non-bye pairing already played.
    public static func pairingHistory(rounds: [TournamentRound]) -> Set<String> {
        var history = Set<String>()
        for round in rounds {
            for p in round.pairings {
                if p.isBye { continue }
                guard let w = p.whitePlayerId, let b = p.blackPlayerId else { continue }
                history.insert("\(min(w, b))-\(max(w, b))")
            }
        }
        return history
    }

    // ── Swiss ─────────────────────────────────────────────────────────────────

    /// `generateSwissPairings`. `players` MUST be in insertion (id-ascending) order —
    /// the natural DB relation order the server relies on.
    public static func generateSwissPairings(players ps: [TournamentPlayer],
                                             rounds: [TournamentRound],
                                             roundNumber: Int) -> [PairSpec] {
        let players = stableSortedByScoreDesc(ps)            // sortByDesc('score'), stable
        var pairings: [PairSpec] = []
        var paired = Set<Int>()
        let history = pairingHistory(rounds: rounds)
        let byeHistory = Set(ps.filter { $0.byes > 0 }.map { $0.id })

        if roundNumber == 1 {
            let hasRatings = players.contains { $0.ncfpRating != nil }
            if hasRatings {
                let sorted = stableSortedByRatingDesc(players) // sortByDesc('ncfp_rating'), nulls last
                let half = sorted.count / 2
                for i in 0..<half {
                    let top = sorted[i], bottom = sorted[half + i]
                    if i % 2 == 0 { pairings.append(PairSpec(white: top.id, black: bottom.id, isBye: false)) }
                    else { pairings.append(PairSpec(white: bottom.id, black: top.id, isBye: false)) }
                    paired.insert(top.id); paired.insert(bottom.id)
                }
                if sorted.count % 2 == 1 {
                    let bye = sorted[sorted.count - 1]
                    pairings.append(PairSpec(white: bye.id, black: nil, isBye: true))
                    paired.insert(bye.id)
                }
                return pairings // R1 never balances colors
            } else {
                let sorted = stableSortedByNameAsc(players)   // sortBy('name')
                let count = sorted.count, half = count / 2
                for i in 0..<half {
                    let top = sorted[i], bottom = sorted[count - 1 - i]
                    if i % 2 == 0 { pairings.append(PairSpec(white: top.id, black: bottom.id, isBye: false)) }
                    else { pairings.append(PairSpec(white: bottom.id, black: top.id, isBye: false)) }
                    paired.insert(top.id); paired.insert(bottom.id)
                }
                if count % 2 == 1 {
                    let bye = sorted[half]
                    pairings.append(PairSpec(white: bye.id, black: nil, isBye: true))
                    paired.insert(bye.id)
                }
                return pairings // R1 never balances colors
            }
        } else {
            // Group by score (numeric desc), stable within group by input order.
            let groups = groupByScoreDesc(players)
            var ordered: [TournamentPlayer] = []
            for group in groups {
                ordered.append(contentsOf: stableSortGroupByBuchholzThenRating(group))
            }

            // Odd count → assign BYE to lowest-ranked player without a prior BYE.
            if ordered.count % 2 == 1 {
                var byePlayer: TournamentPlayer?
                var i = ordered.count - 1
                while i >= 0 {
                    if !byeHistory.contains(ordered[i].id) {
                        byePlayer = ordered[i]; ordered.remove(at: i); break
                    }
                    i -= 1
                }
                if byePlayer == nil { byePlayer = ordered.removeLast() }
                if let bp = byePlayer {
                    pairings.append(PairSpec(white: bp.id, black: nil, isBye: true))
                    paired.insert(bp.id)
                }
            }

            let remaining = ordered.filter { !paired.contains($0.id) }
            pairings.append(contentsOf: pairByScoreGroup(remaining, history: history, paired: &paired))
        }

        let lookup = Dictionary(ps.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return balanceColors(pairings, players: lookup)
    }

    /// Greedy first-fit rematch-avoiding pairing (`pairByScoreGroup`).
    static func pairByScoreGroup(_ players: [TournamentPlayer], history: Set<String>,
                                 paired: inout Set<Int>) -> [PairSpec] {
        var pairings: [PairSpec] = []
        var unpaired = players
        while unpaired.count >= 2 {
            let p1 = unpaired.removeFirst()
            if paired.contains(p1.id) { continue }
            var bestMatch: TournamentPlayer?
            var bestIndex: Int?
            for (idx, p2) in unpaired.enumerated() {
                if paired.contains(p2.id) { continue }
                let key = "\(min(p1.id, p2.id))-\(max(p1.id, p2.id))"
                if !history.contains(key) { bestMatch = p2; bestIndex = idx; break }
            }
            if bestMatch == nil, !unpaired.isEmpty { bestIndex = 0; bestMatch = unpaired[0] }
            if let bm = bestMatch, let bi = bestIndex {
                unpaired.remove(at: bi)
                pairings.append(PairSpec(white: p1.id, black: bm.id, isBye: false))
                paired.insert(p1.id); paired.insert(bm.id)
            }
        }
        return pairings
    }

    /// Single color-swap balancing pass (`balanceColors`). Rounds ≥ 2 only.
    static func balanceColors(_ pairings: [PairSpec], players: [Int: TournamentPlayer]) -> [PairSpec] {
        var result = pairings
        for i in result.indices {
            if result[i].isBye { continue }
            guard let w = result[i].white, let b = result[i].black else { continue }
            let wp = players[w], bp = players[b]
            let wBalance = (wp?.whiteGames ?? 0) - (wp?.blackGames ?? 0)
            let bBalance = (bp?.whiteGames ?? 0) - (bp?.blackGames ?? 0)
            if wBalance > bBalance {
                let t = result[i].white; result[i].white = result[i].black; result[i].black = t
            }
        }
        return result
    }

    // ── Round-Robin (circle method) ─────────────────────────────────────────

    public static func generateRoundRobinPairings(players ps: [TournamentPlayer],
                                                  roundNumber: Int) -> [PairSpec] {
        guard !ps.isEmpty else { return [] } // controller guards <2 players (422); defensive here
        let players = stableSortedBySeedAsc(ps)
        var n = players.count
        var ids: [Int?] = players.map { $0.id }
        if n % 2 == 1 { ids.append(nil); n += 1 }

        let fixed = ids[0]
        var rotating = Array(ids[1...])
        for _ in 0..<(roundNumber - 1) {
            let last = rotating.removeLast()
            rotating.insert(last, at: 0)
        }
        var roundIds: [Int?] = [fixed]
        roundIds.append(contentsOf: rotating)

        var pairings: [PairSpec] = []
        let half = n / 2
        for i in 0..<half {
            let home = roundIds[i], away = roundIds[n - 1 - i]
            if home == nil {
                pairings.append(PairSpec(white: away, black: nil, isBye: true))
            } else if away == nil {
                pairings.append(PairSpec(white: home, black: nil, isBye: true))
            } else if roundNumber % 2 == 0 && i == 0 {
                pairings.append(PairSpec(white: away, black: home, isBye: false))
            } else {
                pairings.append(PairSpec(white: home, black: away, isBye: false))
            }
        }
        return pairings
    }

    // ── Round count for round-robin ──────────────────────────────────────────

    /// Rounds needed for `playerCount` players in a single round-robin.
    public static func roundRobinRounds(playerCount: Int, isPremium: Bool) -> Int {
        guard playerCount > 1 else { return 0 }
        var rounds = playerCount % 2 == 0 ? playerCount - 1 : playerCount
        if !isPremium { rounds = min(rounds, freeMaxRounds) }
        return rounds
    }

    /// Swiss `total_rounds` clamp (`TournamentController::store`):
    /// `min(requested ?? 3, isPremium ? 30 : 3)`. (Round-robin uses `roundRobinRounds`.)
    public static func swissTotalRounds(requested: Int?, isPremium: Bool) -> Int {
        min(requested ?? 3, isPremium ? premiumMaxRounds : freeMaxRounds)
    }

    // ── Result scoring ───────────────────────────────────────────────────────

    public static func applyResult(white: inout TournamentPlayer, black: inout TournamentPlayer, result: String) {
        white.whiteGames += 1
        black.blackGames += 1
        switch result {
        case "1-0": white.score += 1; white.wins += 1; black.losses += 1
        case "0-1": black.score += 1; black.wins += 1; white.losses += 1
        case "1/2-1/2": white.score += 0.5; white.draws += 1; black.score += 0.5; black.draws += 1
        default: break
        }
    }

    public static func reverseResult(white: inout TournamentPlayer, black: inout TournamentPlayer, result: String) {
        white.whiteGames -= 1
        black.blackGames -= 1
        switch result {
        case "1-0": white.score -= 1; white.wins -= 1; black.losses -= 1
        case "0-1": black.score -= 1; black.wins -= 1; white.losses -= 1
        case "1/2-1/2": white.score -= 0.5; white.draws -= 1; black.score -= 0.5; black.draws -= 1
        default: break
        }
    }

    /// BYE scoring applied at generation / round-activation time.
    public static func awardBye(_ player: inout TournamentPlayer) {
        player.score += 1
        player.byes += 1
    }

    // ── Tiebreakers ──────────────────────────────────────────────────────────

    /// `recalculateTiebreakers`. Returns players with updated
    /// direct_encounter / buchholz / sonneborn_berger.
    public static func recalculateTiebreakers(players: [TournamentPlayer],
                                              pairings: [TournamentPairing]) -> [TournamentPlayer] {
        var scores: [Int: Double] = [:]
        for p in players { scores[p.id] = p.score }
        var result = players

        for idx in result.indices {
            let player = result[idx]
            var opponentIds: [Int] = []
            var directEncounter = 0.0

            for pairing in pairings {
                if pairing.isBye { continue }
                let isWhite = pairing.whitePlayerId == player.id
                let isBlack = pairing.blackPlayerId == player.id
                if !isWhite && !isBlack { continue }
                guard let oppId = isWhite ? pairing.blackPlayerId : pairing.whitePlayerId else { continue }
                opponentIds.append(oppId)

                let oppScore = scores[oppId] ?? 0
                if abs(oppScore - (scores[player.id] ?? 0)) < 0.01 {
                    if (isWhite && pairing.result == "1-0") || (isBlack && pairing.result == "0-1") {
                        directEncounter += 1.0
                    } else if pairing.result == "1/2-1/2" {
                        directEncounter += 0.5
                    }
                }
            }

            var buchholz = 0.0
            var sonnebornBerger = 0.0
            for oppId in opponentIds {
                let oppScore = scores[oppId] ?? 0
                buchholz += oppScore
                for pairing in pairings {
                    if pairing.isBye { continue }
                    let isWhite = pairing.whitePlayerId == player.id && pairing.blackPlayerId == oppId
                    let isBlack = pairing.blackPlayerId == player.id && pairing.whitePlayerId == oppId
                    if isWhite || isBlack {
                        if (isWhite && pairing.result == "1-0") || (isBlack && pairing.result == "0-1") {
                            sonnebornBerger += oppScore
                        } else if pairing.result == "1/2-1/2" {
                            sonnebornBerger += oppScore * 0.5
                        }
                    }
                }
            }

            result[idx].directEncounter = phpRound1(directEncounter)
            result[idx].buchholz = Int(buchholz.rounded(.toNearestOrAwayFromZero))
            result[idx].sonnebornBerger = Int(sonnebornBerger.rounded(.toNearestOrAwayFromZero))
        }
        return result
    }

    // ── Standings ────────────────────────────────────────────────────────────

    /// Standings order: score → direct_encounter → buchholz → sonneborn_berger → wins
    /// (all desc), final tie-break id asc.
    public static func standingsSorted(_ players: [TournamentPlayer]) -> [TournamentPlayer] {
        players.sorted { x, y in
            if x.score != y.score { return x.score > y.score }
            if x.directEncounter != y.directEncounter { return x.directEncounter > y.directEncounter }
            if x.buchholz != y.buchholz { return x.buchholz > y.buchholz }
            if x.sonnebornBerger != y.sonnebornBerger { return x.sonnebornBerger > y.sonnebornBerger }
            if x.wins != y.wins { return x.wins > y.wins }
            return x.id < y.id
        }
    }
}

// MARK: - Stable sort helpers (Laravel Collection sorts are stable + numeric)

private func stableSortedByScoreDesc(_ arr: [TournamentPlayer]) -> [TournamentPlayer] {
    arr.enumerated().sorted { a, b in
        if a.element.score != b.element.score { return a.element.score > b.element.score }
        return a.offset < b.offset
    }.map(\.element)
}

private func stableSortedByRatingDesc(_ arr: [TournamentPlayer]) -> [TournamentPlayer] {
    // Laravel `sortByDesc('ncfp_rating')` under SORT_REGULAR treats null as EQUAL to 0
    // (both coerce to false / 0 numerically), so a null-rated and a 0-rated player form one
    // stable equivalence group placed after positives. Reproduce with `(rating ?? 0)`.
    arr.enumerated().sorted { a, b in
        let ra = a.element.ncfpRating ?? 0, rb = b.element.ncfpRating ?? 0
        return ra != rb ? ra > rb : a.offset < b.offset
    }.map(\.element)
}

private func stableSortedByNameAsc(_ arr: [TournamentPlayer]) -> [TournamentPlayer] {
    // Laravel `sortBy('name')` uses PHP SORT_REGULAR: numeric-string names compare
    // numerically ("9" < "10") and other names compare byte-wise (not Unicode-canonical).
    arr.enumerated().sorted { a, b in
        let c = phpRegularCompare(a.element.name, b.element.name)
        return c != 0 ? c < 0 : a.offset < b.offset
    }.map(\.element)
}

private func stableSortedBySeedAsc(_ arr: [TournamentPlayer]) -> [TournamentPlayer] {
    arr.enumerated().sorted { a, b in
        a.element.seed != b.element.seed ? a.element.seed < b.element.seed : a.offset < b.offset
    }.map(\.element)
}

/// Group players by exact score, groups ordered numerically descending, players within a
/// group preserving input order. (Input is already score-desc-stable, so equal scores are
/// contiguous — grouping consecutive runs preserves order and yields desc group order.)
private func groupByScoreDesc(_ players: [TournamentPlayer]) -> [[TournamentPlayer]] {
    var groups: [[TournamentPlayer]] = []
    for p in players {
        if let last = groups.last, last[0].score == p.score {
            groups[groups.count - 1].append(p)
        } else {
            groups.append([p])
        }
    }
    return groups
}

/// Within a score group: buchholz desc, then (ncfp_rating ?? 0) desc, stable.
private func stableSortGroupByBuchholzThenRating(_ group: [TournamentPlayer]) -> [TournamentPlayer] {
    group.enumerated().sorted { a, b in
        if a.element.buchholz != b.element.buchholz { return a.element.buchholz > b.element.buchholz }
        let ra = a.element.ncfpRating ?? 0, rb = b.element.ncfpRating ?? 0
        if ra != rb { return ra > rb }
        return a.offset < b.offset
    }.map(\.element)
}

/// PHP `round($x, 1)` — half-away-from-zero to 1 dp.
func phpRound1(_ x: Double) -> Double { (x * 10).rounded(.toNearestOrAwayFromZero) / 10 }
