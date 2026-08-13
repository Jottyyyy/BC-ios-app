import Foundation

/// FIDE Dutch Swiss pairing, Berger round-robin schedules, and the four tie-breaks.
///
/// Twin of `web-demo/js/pairing-engine.js`, which is property-tested over whole simulated
/// tournaments (`tools/qa/pairing_test.js`) and mutation-tested; `tools/qa/replay_pairing.js` checks
/// this source against it. Foundation only, and pure by construction: no storage, no clock, no
/// engine. Input is a value snapshot, output is a plain result.
///
/// ## This is a rewrite, not a port
///
/// It sits BESIDE `TournamentEngine`, which is the faithful port of the shipping PHP and is pinned
/// to it by golden vectors. Do not merge them. The PHP does four things a Swiss pairing must not:
///
///   1. pairs adjacent players in the GLOBAL ranking rather than top-half against bottom-half inside
///      each score group, so it is not Dutch at all;
///   2. keeps no float bookkeeping, so a player can float down three rounds running;
///   3. `if (!$bestMatch && count($unpaired) > 0) $bestMatch = $unpaired[0];` — out of legal
///      opponents, it silently repeats a pairing with no warning anywhere in the response;
///   4. alternates round-robin colours on board 1 only, so most players get the same colour in
///      nearly every game.
///
/// ## Warnings are part of the contract
///
/// Every compromise comes back in `warnings`. A repeat pairing is reachable — in a small field it
/// eventually has to be — but it is the LAST resort and it is never silent.
public enum PairingEngine {

    // MARK: - Values

    public enum Color: String, Equatable, Codable, Sendable {
        case white = "w"
        case black = "b"

        public var opposite: Color { self == .white ? .black : .white }
    }

    public enum Float3: String, Equatable, Codable, Sendable {
        case none
        case up
        case down
    }

    /// How badly a player needs a colour. Ordered by strength.
    public enum Strength: Int, Equatable, Comparable, Codable, Sendable {
        case none = 0
        case mild = 1
        case strong = 2
        case absolute = 3

        public static func < (a: Strength, b: Strength) -> Bool { a.rawValue < b.rawValue }
    }

    public struct Preference: Equatable, Sendable {
        public var strength: Strength
        public var color: Color?
        public init(strength: Strength, color: Color?) {
            self.strength = strength
            self.color = color
        }
    }

    /// The engine's view of a player: a snapshot, never a stored record.
    ///
    /// `colors` is indexed by round with `nil` for a bye, which is what lets "the colour of my last
    /// game" stay truthful across one. A counter cannot express that — two players can share a
    /// white/black count and still have opposite needs.
    public struct Player: Equatable, Sendable {
        public var id: Int
        public var name: String
        public var rating: Int?
        public var seed: Int
        public var score: Double
        public var opponents: Set<Int>
        public var colors: [Color?]
        public var floats: [Float3]
        public var hadBye: Bool

        public init(id: Int, name: String, rating: Int? = nil, seed: Int = 0, score: Double = 0,
                    opponents: Set<Int> = [], colors: [Color?] = [], floats: [Float3] = [],
                    hadBye: Bool = false) {
            self.id = id
            self.name = name
            self.rating = rating
            self.seed = seed
            self.score = score
            self.opponents = opponents
            self.colors = colors
            self.floats = floats
            self.hadBye = hadBye
        }
    }

    public struct Pair: Equatable, Codable, Sendable {
        public var white: Int
        public var black: Int
        public init(white: Int, black: Int) {
            self.white = white
            self.black = black
        }
    }

    /// One board of a Berger schedule. `black` is nil on the bye board.
    public struct ScheduledBoard: Equatable, Codable, Sendable {
        public var board: Int
        public var white: Int
        public var black: Int?
        public var isBye: Bool
        public init(board: Int, white: Int, black: Int?, isBye: Bool) {
            self.board = board
            self.white = white
            self.black = black
            self.isBye = isBye
        }
    }

    public struct Warning: Equatable, Codable, Sendable {
        public enum Kind: String, Equatable, Codable, Sendable {
            case repeatPairing
            case absoluteColorViolated
            case colorPreferenceViolated
            case repeatBye
        }
        public var kind: Kind
        public var name: String
        public var playerID: Int
        /// Only a repeat pairing names two players; for the rest these mirror `name`/`playerID`.
        public var otherName: String
        public var otherID: Int

        public init(kind: Kind, name: String, playerID: Int,
                    otherName: String = "", otherID: Int = 0) {
            self.kind = kind
            self.name = name
            self.playerID = playerID
            self.otherName = otherName
            self.otherID = otherID
        }
    }

    public struct RoundResult: Equatable, Sendable {
        public var pairs: [Pair]
        public var bye: Int?
        public var warnings: [Warning]
        public var floats: [Int: Float3]

        public init(pairs: [Pair] = [], bye: Int? = nil, warnings: [Warning] = [],
                    floats: [Int: Float3] = [:]) {
            self.pairs = pairs
            self.bye = bye
            self.warnings = warnings
            self.floats = floats
        }
    }

    public struct Tiebreaks: Equatable, Codable, Sendable {
        public var buchholz: Double
        public var buchholzCut1: Double
        public var sonnebornBerger: Double
        public var directEncounter: Double

        public init(buchholz: Double = 0, buchholzCut1: Double = 0,
                    sonnebornBerger: Double = 0, directEncounter: Double = 0) {
            self.buchholz = buchholz
            self.buchholzCut1 = buchholzCut1
            self.sonnebornBerger = sonnebornBerger
            self.directEncounter = directEncounter
        }
    }

    /// A decided game. Pending ones never reach here — see `tiebreaks`.
    public struct Game: Equatable, Sendable {
        public enum Outcome: String, Equatable, Sendable {
            case whiteWin = "w"
            case blackWin = "b"
            case draw = "d"
        }
        public var white: Int
        public var black: Int
        public var result: Outcome
        public init(white: Int, black: Int, result: Outcome) {
            self.white = white
            self.black = black
            self.result = result
        }
    }

    /// One row of the standings table. Deliberately not `Player`: standings need the tie-breaks and
    /// the W/D/L counts, and pairing needs the colour history, and neither needs the other's.
    public struct StandingsRow: Equatable, Sendable {
        public var id: Int
        public var name: String
        public var rating: Int?
        public var score: Double
        public var directEncounter: Double
        public var buchholz: Double
        public var sonnebornBerger: Double
        public var wins: Int

        public init(id: Int, name: String, rating: Int? = nil, score: Double = 0,
                    directEncounter: Double = 0, buchholz: Double = 0,
                    sonnebornBerger: Double = 0, wins: Int = 0) {
            self.id = id
            self.name = name
            self.rating = rating
            self.score = score
            self.directEncounter = directEncounter
            self.buchholz = buchholz
            self.sonnebornBerger = sonnebornBerger
            self.wins = wins
        }
    }

    // MARK: - The priority ladder
    //
    // A lexicographic priority encoded as one number. The separations are wide enough that a cheaper
    // category always beats any amount of a dearer one, so this is a true priority order and not a
    // blend. The VALUES are arbitrary; the ORDER is the algorithm, and it is what breaks silently —
    // `tools/qa/pairing_test.js` asserts the order directly for that reason.

    /// Never re-pair two players while any alternative exists.
    public static let costRepeat: Double = 1e7
    /// FIDE C.04.1's absolute colour rules: a spread past ±2, or a third consecutive colour.
    /// Priced ABOVE a point of score difference, so the engine floats rather than breaks them.
    public static let costColorAbsolute: Double = 5e4
    /// Above a score point too: FIDE would rather pair you slightly out of bracket than float you
    /// down twice running, and so would an arbiter.
    public static let costRefloat: Double = 1.2e4
    /// Per point of score difference between the two players.
    public static let costScore: Double = 1e4
    /// Per unit of leftover colour imbalance, measured directly rather than through a preference
    /// proxy. Preference is only ever a stand-in for balance, and matching on the proxy while
    /// assigning on the real thing is how the two came to disagree.
    public static let costColorUnit: Double = 1e2
    /// Branch-and-bound cutoff. Above it the search returns its best matching so far — still a legal
    /// round, just not provably optimal, and every compromise in it is still reported.
    public static let nodeBudget = 200_000

    // MARK: - Colour

    /// Colour preference (spec 1.7.1), derived from the HISTORY rather than a counter.
    public static func preference(_ p: Player) -> Preference {
        let played = p.colors.compactMap { $0 }
        let whites = played.filter { $0 == .white }.count
        let blacks = played.count - whites
        let diff = whites - blacks
        let last = played.last

        if abs(diff) >= 2 {
            return Preference(strength: .absolute, color: diff > 0 ? .black : .white)
        }
        if played.count >= 2, played[played.count - 1] == played[played.count - 2] {
            return Preference(strength: .absolute, color: last?.opposite)
        }
        if diff != 0 { return Preference(strength: .strong, color: diff > 0 ? .black : .white) }
        if let last { return Preference(strength: .mild, color: last.opposite) }
        return Preference(strength: .none, color: nil)
    }

    /// Whites minus blacks, byes excluded.
    public static func colorDiff(_ p: Player) -> Int {
        let played = p.colors.compactMap { $0 }
        let whites = played.filter { $0 == .white }.count
        return whites - (played.count - whites)
    }

    /// Would this colour be the third of its kind in a row? Byes do not interrupt the run.
    public static func wouldBeThirdInARow(_ p: Player, _ color: Color) -> Bool {
        let played = p.colors.compactMap { $0 }
        return played.count >= 2
            && played[played.count - 1] == color
            && played[played.count - 2] == color
    }

    /// What giving `p` this colour costs.
    public static func colorCostFor(_ p: Player, _ color: Color) -> Double {
        let d = colorDiff(p) + (color == .white ? 1 : -1)
        var c = Double(abs(d)) * costColorUnit
        if abs(d) >= 3 { c += costColorAbsolute }
        if wouldBeThirdInARow(p, color) { c += costColorAbsolute }
        return c
    }

    /// The cost of the cheaper of the two orientations.
    public static func bestOrientationCost(_ a: Player, _ b: Player) -> Double {
        let aWhite = colorCostFor(a, .white) + colorCostFor(b, .black)
        let bWhite = colorCostFor(b, .white) + colorCostFor(a, .black)
        return Swift.min(aWhite, bWhite)
    }

    /// Who gets White.
    ///
    /// The same cost the matcher priced, so the pairing it chose and the colours it hands out cannot
    /// disagree. Ties fall back to preference and then rank, which keeps it reproducible.
    public static func assignColors(_ a: Player, _ b: Player,
                                    rankOf: (Player) -> Int) -> (white: Player, black: Player) {
        let aWhite = colorCostFor(a, .white) + colorCostFor(b, .black)
        let bWhite = colorCostFor(b, .white) + colorCostFor(a, .black)
        if aWhite != bWhite { return aWhite < bWhite ? (a, b) : (b, a) }

        let pa = preference(a), pb = preference(b)
        if let ca = pa.color, let cb = pb.color, ca != cb {
            return ca == .white ? (a, b) : (b, a)
        }
        if pa.strength != pb.strength {
            let aStronger = pa.strength > pb.strength
            let stronger = aStronger ? a : b
            let wants = aStronger ? pa : pb
            let other = aStronger ? b : a
            return wants.color == .white ? (stronger, other) : (other, stronger)
        }
        let firstIsA = rankOf(a) <= rankOf(b)
        let first = firstIsA ? a : b
        let second = firstIsA ? b : a
        if pa.strength == .none { return (first, second) }
        return pa.color == .white ? (first, second) : (second, first)
    }

    /// Did honouring this pairing break someone's colour need, and how badly?
    public static func colorViolation(_ a: Player, _ b: Player) -> Strength {
        let pa = preference(a), pb = preference(b)
        guard let ca = pa.color, let cb = pb.color, ca == cb else { return .none }
        return Swift.min(pa.strength, pb.strength)   // the weaker of the two has to give way
    }

    // MARK: - Ordering

    /// The PAIRING order (spec 1.7.2) — deliberately **not** the standings order.
    ///
    /// It excludes direct encounter on purpose: pairing asks "who is comparable right now", and a
    /// head-to-head result between two players says nothing about where they sit in the field. The
    /// `seed` tie-break is what makes regeneration byte-identical, which arbiters rely on — and,
    /// because seeds are unique, it also makes this a total order, so Swift's unstable sort is safe
    /// here without an index tie-break.
    public static func pairingOrder(_ players: [Player]) -> [Player] {
        players.sorted { x, y in
            if x.score != y.score { return x.score > y.score }
            let rx = x.rating ?? 0, ry = y.rating ?? 0
            if rx != ry { return rx > ry }
            if x.name != y.name { return x.name < y.name }
            return x.seed < y.seed
        }
    }

    // MARK: - The bye

    /// The lowest-ranked bye-less player in the lowest score bracket (spec 1.7.3).
    ///
    /// The bracket restriction is intent, not behaviour: because `pairingOrder` sorts
    /// score-descending, the bottom bracket is the tail of the list, so scanning the bracket and
    /// scanning the whole list from the bottom pick the same player every time (brute-forced over
    /// 287,712 cases in the mutation suite). It is kept because it stops being equivalent the moment
    /// the ordering changes, and because it says what the rule IS.
    ///
    /// The real departure from the PHP is the tail: when nobody in the field is bye-less this WARNS
    /// instead of silently handing out a second one.
    public static func chooseBye(_ ordered: [Player], warnings: inout [Warning]) -> Player? {
        if ordered.count % 2 == 0 { return nil }
        guard let lowest = ordered.last?.score else { return nil }
        let bottom = ordered.filter { $0.score == lowest }
        let fresh = bottom.filter { !$0.hadBye }
        if let last = fresh.last { return last }

        let anyFresh = ordered.filter { !$0.hadBye }
        if let last = anyFresh.last { return last }

        guard let second = bottom.last else { return nil }
        warnings.append(Warning(kind: .repeatBye, name: second.name, playerID: second.id))
        return second
    }

    // MARK: - Downfloats

    /// Who drops into the next bracket (spec 1.7.6).
    ///
    /// From the bottom up: someone who did not float down last round, then someone who did not float
    /// down the round before either, then fewest downfloats overall. The two-deep lookback is what
    /// the PHP has none of, and it is load-bearing — with only a one-deep filter the suite cannot
    /// tell the two apart.
    public static func chooseFloater(_ pool: [Player]) -> Player? {
        func last(_ p: Player) -> Float3 { p.floats.last ?? .none }
        func prev(_ p: Player) -> Float3 {
            p.floats.count > 1 ? p.floats[p.floats.count - 2] : .none
        }
        let reversed = Array(pool.reversed())

        let clean = reversed.filter { last($0) != .down && prev($0) != .down }
        if !clean.isEmpty { return fewestDownfloats(clean) }
        let ok = reversed.filter { last($0) != .down }
        if !ok.isEmpty { return fewestDownfloats(ok) }
        return fewestDownfloats(reversed)
    }

    static func fewestDownfloats(_ candidates: [Player]) -> Player? {
        guard var best = candidates.first else { return nil }
        var bestN = countDown(best)
        for c in candidates.dropFirst() {
            let n = countDown(c)
            if n < bestN { best = c; bestN = n }
        }
        return best
    }

    static func countDown(_ p: Player) -> Int { p.floats.filter { $0 == .down }.count }

    // MARK: - Matching

    static func haveMet(_ a: Player, _ b: Player) -> Bool { a.opponents.contains(b.id) }

    static func lastFloat(_ p: Player) -> Float3 { p.floats.last ?? .none }

    /// The cost of pairing two players.
    public static func pairCost(_ a: Player, _ b: Player, idealDistance: Int) -> Double {
        var c = Double(idealDistance)
        if haveMet(a, b) { c += costRepeat }
        c += abs(a.score - b.score) * costScore
        c += bestOrientationCost(a, b)
        // Whoever floats DOWN here is the higher-scored one; charge them if they did it last round.
        if a.score != b.score {
            let down = a.score > b.score ? a : b
            if lastFloat(down) == .down { c += costRefloat }
        }
        return c
    }

    /// Minimum-cost perfect matching over the whole field, by cost-ordered backtracking.
    ///
    /// Trying the cheapest partner first means a conflict-free round is found almost immediately;
    /// the `bestCost` bound keeps the search from exploring anything worse.
    ///
    /// Matching globally rather than strictly per bracket is what keeps this Dutch *and* solvable:
    /// a same-score pairing always wins on cost, so score groups are reproduced without partitioning
    /// the field into brackets the search cannot see past. Strict per-bracket pairing leaves a
    /// two-player group with exactly one legal option, so any colour conflict inside it forces a
    /// relaxation a global view simply avoids — measured at 63 failures against none.
    static func matchAll(_ ordered: [Player]) -> [(Player, Player)]? {
        let n = ordered.count
        if n == 0 { return [] }
        if n % 2 != 0 { return nil }
        let half = n / 2

        var cost = [[Double]](repeating: [Double](repeating: 0, count: n), count: n)
        for i in 0..<n {
            for j in (i + 1)..<n {
                let ideal = i < half ? i + half : i - half
                let c = pairCost(ordered[i], ordered[j], idealDistance: abs(j - ideal))
                cost[i][j] = c
                cost[j][i] = c
            }
        }

        var used = [Bool](repeating: false, count: n)
        var current: [(Int, Int)] = []
        var best: [(Int, Int)]?
        var bestCost = Double.infinity
        var nodes = 0

        func search(_ acc: Double) -> Bool {
            if acc >= bestCost { return false }
            nodes += 1
            if nodes > nodeBudget { return false }
            var i = 0
            while i < n && used[i] { i += 1 }
            if i >= n {
                best = current
                bestCost = acc
                return acc == 0
            }

            var cands: [Int] = []
            for j in (i + 1)..<n where !used[j] { cands.append(j) }
            // Cheapest first, ties by index — which is what makes regeneration byte-identical, and
            // what makes this comparator a total order despite Swift's unstable sort.
            cands.sort { x, y in
                cost[i][x] != cost[i][y] ? cost[i][x] < cost[i][y] : x < y
            }
            for jj in cands {
                used[i] = true
                used[jj] = true
                current.append((i, jj))
                let done = search(acc + cost[i][jj])
                current.removeLast()
                used[i] = false
                used[jj] = false
                if done { return true }
            }
            return false
        }
        _ = search(0)
        guard let best else { return nil }
        return best.map { (ordered[$0.0], ordered[$0.1]) }
    }

    // MARK: - The round

    /// Pair one round. `round` is 1-based.
    public static func pairRound(_ players: [Player], round: Int) -> RoundResult {
        var warnings: [Warning] = []
        if players.count < 2 { return RoundResult(warnings: warnings) }
        if round == 1 { return pairFirstRound(players, warnings: &warnings) }

        let ordered = pairingOrder(players)
        let rank = rankLookup(ordered)
        let bye = chooseBye(ordered, warnings: &warnings)
        let field = bye == nil ? ordered : ordered.filter { $0.id != bye!.id }

        guard let matched = matchAll(field) else {
            return RoundResult(bye: bye?.id, warnings: warnings)
        }

        // Warnings are read off the RESULT, not guessed from what the search did, so a warning can
        // never disagree with the pairing it describes.
        var floats: [Int: Float3] = [:]
        for (a, b) in matched {
            if haveMet(a, b) {
                warnings.append(Warning(kind: .repeatPairing, name: a.name, playerID: a.id,
                                        otherName: b.name, otherID: b.id))
            }
            let v = colorViolation(a, b)
            if v >= .absolute {
                warnings.append(Warning(kind: .absoluteColorViolated, name: b.name, playerID: b.id))
            } else if v >= .strong {
                warnings.append(Warning(kind: .colorPreferenceViolated, name: b.name,
                                        playerID: b.id))
            }
            if a.score != b.score {
                let down = a.score > b.score ? a : b
                let up = a.score > b.score ? b : a
                floats[down.id] = .down
                floats[up.id] = .up
            } else {
                floats[a.id] = .none
                floats[b.id] = .none
            }
        }
        if let bye { floats[bye.id] = .none }

        return finish(matched, bye: bye, warnings: warnings, rankOf: rank,
                      colorsFixed: false, floats: floats)
    }

    /// Round 1 has no history, so brackets are meaningless (spec 1.7.5).
    static func pairFirstRound(_ players: [Player], warnings: inout [Warning]) -> RoundResult {
        let rated = players.filter { ($0.rating ?? 0) > 0 }.count
        // >= HALF the field, not "at least one". The PHP's `count() > 0` paired a 20-player unrated
        // field as if it were rated because a single entrant had a number.
        let useRatings = rated * 2 >= players.count

        // Both folds end in `seed`, which is unique, so each is a total order.
        var ordered = useRatings
            ? players.sorted { x, y in
                let rx = x.rating ?? 0, ry = y.rating ?? 0
                if rx != ry { return rx > ry }
                if x.name != y.name { return x.name < y.name }
                return x.seed < y.seed
            }
            : players.sorted { x, y in
                if x.name != y.name { return x.name < y.name }
                return x.seed < y.seed
            }

        let rank = rankLookup(ordered)
        var bye: Player?
        if ordered.count % 2 != 0 {
            // Rated: the lowest-ranked player. Unrated: the MIDDLE one, which the PHP got right.
            let byeIdx = useRatings ? ordered.count - 1 : ordered.count / 2
            bye = ordered[byeIdx]
            ordered = ordered.filter { $0.id != bye!.id }
        }

        let half = ordered.count / 2
        var pairs: [(Player, Player)] = []
        for i in 0..<half {
            // Colours alternate by board: board 1 gives White to the top half, board 2 to the bottom.
            pairs.append(i % 2 == 0 ? (ordered[i], ordered[half + i])
                                    : (ordered[half + i], ordered[i]))
        }
        var floats: [Int: Float3] = [:]
        for p in players { floats[p.id] = .none }     // no brackets yet
        return finish(pairs, bye: bye, warnings: warnings, rankOf: rank,
                      colorsFixed: true, floats: floats)
    }

    /// Order the boards, resolve colours, and hand back a plain result.
    ///
    /// The board sort keys on the better-ranked player of each pair. Ranks are unique and no two
    /// pairs share a player, so the keys are distinct and the comparator is a total order — Swift's
    /// unstable sort is safe here.
    static func finish(_ pairs: [(Player, Player)], bye: Player?, warnings: [Warning],
                       rankOf: @escaping (Player) -> Int, colorsFixed: Bool,
                       floats: [Int: Float3]) -> RoundResult {
        let ordered = pairs.sorted { p, q in
            Swift.min(rankOf(p.0), rankOf(p.1)) < Swift.min(rankOf(q.0), rankOf(q.1))
        }
        let out = ordered.map { pair -> Pair in
            if colorsFixed { return Pair(white: pair.0.id, black: pair.1.id) }
            let c = assignColors(pair.0, pair.1, rankOf: rankOf)
            return Pair(white: c.white.id, black: c.black.id)
        }
        return RoundResult(pairs: out, bye: bye?.id, warnings: warnings, floats: floats)
    }

    static func rankLookup(_ ordered: [Player]) -> (Player) -> Int {
        var map: [Int: Int] = [:]
        for (i, p) in ordered.enumerated() { map[p.id] = i }
        return { map[$0.id] ?? 1_000_000_000 }
    }

    public static func groupByScore(_ ordered: [Player]) -> [[Player]] {
        var out: [[Player]] = []
        var cur: [Player] = []
        var score: Double?
        for p in ordered {
            if score == nil || p.score == score { cur.append(p); score = p.score; continue }
            out.append(cur)
            cur = [p]
            score = p.score
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    // MARK: - Round robin

    /// The whole schedule at once (spec 1.8). `ids` must be in seed order.
    ///
    /// The circle method decides who meets whom; a second pass decides colours by tracking each
    /// player's running balance. Deriving colours from the rotation index instead — which is what
    /// the PHP does on board 1 — does not balance: in a 7-player event it handed one player White in
    /// all six games.
    public static func bergerSchedule(_ ids: [Int]) -> [[ScheduledBoard]] {
        var list: [Int?] = ids.map { $0 }
        if list.count % 2 != 0 { list.append(nil) }        // the bye sentinel
        let n = list.count
        if n < 2 { return [] }
        let rounds = n - 1, half = n / 2

        let rot = Array(list[0..<(n - 1)])
        let fixed = list[n - 1]
        var schedule: [[(Int?, Int?)]] = []
        for r in 0..<rounds {
            var games: [(Int?, Int?)] = [(fixed, rot[r % (n - 1)])]
            for i in 1..<half {
                let a = rot[(r + i) % (n - 1)]
                let b = rot[(r - i + (n - 1) * 2) % (n - 1)]
                games.append((a, b))
            }
            schedule.append(games)
        }

        var diff: [Int: Int] = [:]
        var last: [Int: Color] = [:]
        for id in ids { diff[id] = 0 }

        return schedule.map { games -> [ScheduledBoard] in
            var boards: [(white: Int, black: Int?, bye: Bool)] = []
            for (ga, gb) in games {
                guard let a = ga, let b = gb else {
                    let present = ga ?? gb
                    if let present { boards.append((white: present, black: nil, bye: true)) }
                    continue
                }
                // Giving White to `a` moves a up one and b down one; pick the cheaper.
                let costA = abs((diff[a] ?? 0) + 1) + abs((diff[b] ?? 0) - 1)
                let costB = abs((diff[b] ?? 0) + 1) + abs((diff[a] ?? 0) - 1)
                // On a tie, White goes to whoever had Black last. An arbitrary tie-break here is
                // what once left a player on four Whites in six games. Only if that also ties does
                // id decide, so the schedule stays reproducible.
                var aWhite: Bool
                if costA != costB {
                    aWhite = costA < costB
                } else if last[a] != last[b] {
                    aWhite = last[a] == .black
                } else {
                    aWhite = String(a) < String(b)
                }
                let w = aWhite ? a : b
                let bl = aWhite ? b : a
                diff[w] = (diff[w] ?? 0) + 1
                diff[bl] = (diff[bl] ?? 0) - 1
                last[w] = .white
                last[bl] = .black
                boards.append((white: w, black: bl, bye: false))
            }
            // The bye always sits on the LAST board, in every round; the PHP put it on board 1 from
            // round 2 onward.
            //
            // **This is the one sort in the file that genuinely needs an index tie-break.** Its key
            // is a bye flag, so every non-bye board ties — V8's sort is stable and leaves them in
            // circle order, and Swift's is not, so without the offset the boards would come out in
            // an arbitrary order and no two runs would agree.
            let stable = boards.enumerated().sorted { x, y in
                let bx = x.element.bye ? 1 : 0, by = y.element.bye ? 1 : 0
                return bx != by ? bx < by : x.offset < y.offset
            }.map { $0.element }
            return stable.enumerated().map { idx, bd in
                ScheduledBoard(board: idx + 1, white: bd.white, black: bd.black, isBye: bd.bye)
            }
        }
    }

    public static func roundRobinRounds(_ playerCount: Int) -> Int {
        playerCount % 2 == 0 ? playerCount - 1 : playerCount
    }

    // MARK: - Tie-breaks

    /// All four, as `Double` (spec 1.9).
    ///
    /// `games` carries only DECIDED results, and that filter is the round-robin fix: the PHP scanned
    /// every pairing in the tournament, and because a round robin creates the whole schedule upfront
    /// it counted unplayed future rounds, inflating everyone's Buchholz from round 1.
    public static func tiebreaks(_ players: [(id: Int, score: Double)],
                                 games: [Game]) -> [Int: Tiebreaks] {
        var score: [Int: Double] = [:]
        for p in players { score[p.id] = p.score }

        var opponentsOf: [Int: [(id: Int, points: Double)]] = [:]
        for p in players { opponentsOf[p.id] = [] }
        for g in games {
            let wPoints: Double = g.result == .whiteWin ? 1 : (g.result == .draw ? 0.5 : 0)
            opponentsOf[g.white]?.append((id: g.black, points: wPoints))
            opponentsOf[g.black]?.append((id: g.white, points: 1 - wPoints))
        }

        var out: [Int: Tiebreaks] = [:]
        for p in players {
            let opps = opponentsOf[p.id] ?? []
            let oppScores = opps.map { score[$0.id] ?? 0 }
            let buchholz = oppScores.reduce(0, +)
            let cut1 = oppScores.isEmpty ? 0 : buchholz - (oppScores.min() ?? 0)
            let sb = opps.reduce(0.0) { acc, o in acc + (score[o.id] ?? 0) * o.points }
            // Direct encounter: points scored against opponents on the SAME current score.
            let de = opps.reduce(0.0) { acc, o in
                (score[o.id] == p.score) ? acc + o.points : acc
            }
            out[p.id] = Tiebreaks(buchholz: buchholz, buchholzCut1: cut1,
                                  sonnebornBerger: sb, directEncounter: de)
        }
        return out
    }

    /// The ONE standings comparator (spec 1.9), used by the table, the share image and the share
    /// text.
    ///
    /// The RN app had three different orderings for the same table — the server's `/standings` used
    /// five keys including direct encounter, the `show()` payload sorted by score and Buchholz only,
    /// and the client sorted by four keys ignoring direct encounter. Exported once so that cannot
    /// happen again.
    public static func standingsOrder(_ rows: [StandingsRow]) -> [StandingsRow] {
        rows.sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.directEncounter != b.directEncounter { return a.directEncounter > b.directEncounter }
            if a.buchholz != b.buchholz { return a.buchholz > b.buchholz }
            if a.sonnebornBerger != b.sonnebornBerger {
                return a.sonnebornBerger > b.sonnebornBerger
            }
            if a.wins != b.wins { return a.wins > b.wins }
            let ra = a.rating ?? 0, rb = b.rating ?? 0
            if ra != rb { return ra > rb }
            return a.name < b.name
        }
    }

    /// Chess notation: `1`, `1½`, `½`. Never `1.0` — that is what printed `1.0.0` in the RN share
    /// text, where a `decimal:1` cast met a TypeScript interface that declared `number`.
    public static func formatScore(_ v: Double) -> String {
        let whole = Int(floor(v))
        let half = abs(v - Double(whole) - 0.5) < 1e-9
        if half { return whole == 0 ? "\u{00BD}" : "\(whole)\u{00BD}" }
        return "\(whole)"
    }

    /// Standard Swiss guidance, shown live on the create screen instead of a free-plan limit.
    public static func recommendedRounds(_ playerCount: Int) -> Int {
        if playerCount < 2 { return 1 }
        return Int(ceil(log2(Double(playerCount))))
    }
}
