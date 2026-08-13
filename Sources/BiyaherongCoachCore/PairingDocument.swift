import Foundation

/// The Pairing Manager's document, and every mutation of it.
///
/// Twin of `web-demo/js/pairing-store.js`, which is asserted by its own suite and mutation-tested;
/// `tools/qa/replay_pairing.js` checks this source against it. Pure and Foundation-only: no storage,
/// no clock. `PairingLibraryFile` in the UI package does the ten lines of I/O around it, the same
/// split as `AnalysisStore` / `AnalysisLibraryFile`.
///
/// ## The one design decision worth reading
///
/// **Player aggregates are RECOMPUTED from the rounds after every mutation, never patched.**
///
/// The server did the opposite: `applyResult` incremented score/W/D/L/colour counters and
/// `reverseResult` decremented them again when a result was edited. That arrangement produced three
/// of the defects in spec §7 on its own — bye points awarded after the tie-break pass (#12),
/// tie-breaks recomputed only when a round happened to complete (#11), and results that stayed
/// editable after `finished` because the counters had no idea what state the tournament was in
/// (#17). Every one is a *synchronisation* bug: two representations of the same fact drifting apart.
///
/// Recomputing deletes the second representation. `setResult` writes one enum onto one board and
/// calls `recompute`; there is nothing to reverse, so `clearResult` (#23, which the RN app had no way
/// to express at all) is the same code path with `.pending`. The cost is O(rounds × boards) per
/// keystroke, on tournaments of at most a few hundred games. That is free.
///
/// `status` is computed the same way and for the same reason (spec §1.10): it is never stored, so it
/// cannot disagree with the data.
public enum PairingDocument {

    public static let version = 1

    // MARK: - Values

    public enum Kind: String, Equatable, Codable, Sendable {
        case swiss
        case roundRobin = "round_robin"
    }

    public enum Status: String, Equatable, Codable, Sendable {
        case setup
        case ongoing
        case finished
    }

    /// The five values a board can hold. The raw strings match the server's enum and the JS twin, so
    /// one document describes both.
    public enum Result: String, Equatable, Codable, Sendable {
        case pending
        case whiteWin = "1-0"
        case blackWin = "0-1"
        case draw = "1/2-1/2"
        case bye
    }

    // MARK: - The document
    //
    // Nested inside the enum on purpose: `TournamentPlayer`, `TournamentRound` and
    // `TournamentPairing` are already taken at module scope by `Tournament.swift`, which is the
    // faithful port of the PHP and must keep them.
    //
    // Key names match `pairing-store.js` exactly, including the `...Id` spelling, so the browser's
    // localStorage document and this app's `pairing.json` are the same document.

    public struct PlayerRow: Equatable, Codable, Sendable {
        public var id: Int
        public var name: String
        public var fullName: String?
        public var rating: Int?
        public var seed: Int
        public var score: Double
        public var wins: Int
        public var draws: Int
        public var losses: Int
        public var byes: Int
        public var whiteGames: Int
        public var blackGames: Int
        public var colors: [PairingEngine.Color?]
        public var floats: [PairingEngine.Float3]
        public var opponentIDs: [Int]
        public var hadBye: Bool
        public var buchholz: Double
        public var buchholzCut1: Double
        public var sonnebornBerger: Double
        public var directEncounter: Double

        enum CodingKeys: String, CodingKey {
            case id, name, fullName, rating, seed, score
            case wins, draws, losses, byes, whiteGames, blackGames
            case colors, floats, opponentIDs = "opponentIds", hadBye
            case buchholz, buchholzCut1, sonnebornBerger, directEncounter
        }

        public init(id: Int, name: String, fullName: String? = nil, rating: Int? = nil,
                    seed: Int = 0, score: Double = 0, wins: Int = 0, draws: Int = 0,
                    losses: Int = 0, byes: Int = 0, whiteGames: Int = 0, blackGames: Int = 0,
                    colors: [PairingEngine.Color?] = [], floats: [PairingEngine.Float3] = [],
                    opponentIDs: [Int] = [], hadBye: Bool = false, buchholz: Double = 0,
                    buchholzCut1: Double = 0, sonnebornBerger: Double = 0,
                    directEncounter: Double = 0) {
            self.id = id
            self.name = name
            self.fullName = fullName
            self.rating = rating
            self.seed = seed
            self.score = score
            self.wins = wins
            self.draws = draws
            self.losses = losses
            self.byes = byes
            self.whiteGames = whiteGames
            self.blackGames = blackGames
            self.colors = colors
            self.floats = floats
            self.opponentIDs = opponentIDs
            self.hadBye = hadBye
            self.buchholz = buchholz
            self.buchholzCut1 = buchholzCut1
            self.sonnebornBerger = sonnebornBerger
            self.directEncounter = directEncounter
        }
    }

    public struct Board: Equatable, Codable, Sendable {
        public var board: Int
        public var white: Int?
        public var black: Int?
        public var isBye: Bool
        public var result: Result

        public init(board: Int, white: Int?, black: Int?, isBye: Bool, result: Result) {
            self.board = board
            self.white = white
            self.black = black
            self.isBye = isBye
            self.result = result
        }
    }

    public struct Round: Equatable, Codable, Sendable {
        public var number: Int
        public var boards: [Board]
        public var warnings: [PairingEngine.Warning]
        /// Keyed by the player id's STRING form, and that is not a style choice.
        ///
        /// `JSONEncoder` writes an `Int`-keyed dictionary as a flat array of alternating keys and
        /// values, not as an object — so `[Int: Float3]` here would produce a document the JS twin
        /// cannot read, and nothing on this checkout would notice. `RoundResult.floats` stays
        /// `Int`-keyed because it never leaves memory.
        public var floats: [String: PairingEngine.Float3]

        public init(number: Int, boards: [Board] = [],
                    warnings: [PairingEngine.Warning] = [],
                    floats: [String: PairingEngine.Float3] = [:]) {
            self.number = number
            self.boards = boards
            self.warnings = warnings
            self.floats = floats
        }
    }

    public struct Tournament: Equatable, Codable, Sendable {
        public var id: Int
        public var name: String
        public var type: Kind
        public var totalRounds: Int
        public var createdAt: Int
        public var updatedAt: Int
        public var nextSeed: Int
        public var players: [PlayerRow]
        public var rounds: [Round]

        public init(id: Int, name: String, type: Kind = .swiss, totalRounds: Int = 0,
                    createdAt: Int = 0, updatedAt: Int = 0, nextSeed: Int = 1,
                    players: [PlayerRow] = [], rounds: [Round] = []) {
            self.id = id
            self.name = name
            self.type = type
            self.totalRounds = totalRounds
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.nextSeed = nextSeed
            self.players = players
            self.rounds = rounds
        }
    }

    /// The whole document — one JSON file, one localStorage key.
    public struct State: Equatable, Codable, Sendable {
        public var v: Int
        public var nextID: Int
        public var tournaments: [Tournament]

        enum CodingKeys: String, CodingKey {
            case v, nextID = "nextId", tournaments
        }

        public init(v: Int = PairingDocument.version, nextID: Int = 1,
                    tournaments: [Tournament] = []) {
            self.v = v
            self.nextID = nextID
            self.tournaments = tournaments
        }
    }

    // MARK: - Limits

    public enum Limits {
        public static let nameMax = 100
        public static let playerNameMax = 255
        public static let ratingMin = 0
        public static let ratingMax = 3000
        public static let roundsMin = 1
        public static let roundsMax = 30
        public static let roundsDefault = 3
    }

    // MARK: - Lookup

    public static func tournament(_ doc: State, id: Int) -> Tournament? {
        doc.tournaments.first { $0.id == id }
    }

    static func index(_ doc: State, id: Int) -> Int? {
        doc.tournaments.firstIndex { $0.id == id }
    }

    public static func player(_ t: Tournament, id: Int?) -> PlayerRow? {
        guard let id else { return nil }
        return t.players.first { $0.id == id }
    }

    public static func round(_ t: Tournament, number: Int) -> Round? {
        t.rounds.first { $0.number == number }
    }

    // MARK: - Create and delete

    /// Returns the new tournament's id, or nil when the name is blank.
    @discardableResult
    public static func create(_ doc: inout State, name: String, type: Kind = .swiss,
                              totalRounds: Int? = nil, now: Int) -> Int? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        // Clamped, not silently substituted. The RN screen turned a typed `0` into 3 with no
        // feedback and let `99` through to a server 422.
        let rounds = type == .swiss ? clampRounds(totalRounds) : 0
        let t = Tournament(id: doc.nextID,
                           name: String(trimmed.prefix(Limits.nameMax)),
                           type: type,
                           totalRounds: rounds,
                           createdAt: now,
                           updatedAt: now)
        doc.nextID += 1
        doc.tournaments.insert(t, at: 0)
        return t.id
    }

    public static func clampRounds(_ v: Int?) -> Int {
        guard let v, v >= Limits.roundsMin else { return Limits.roundsDefault }
        return Swift.min(Limits.roundsMax, v)
    }

    @discardableResult
    public static func remove(_ doc: inout State, id: Int) -> Bool {
        let before = doc.tournaments.count
        doc.tournaments.removeAll { $0.id == id }
        return doc.tournaments.count != before
    }

    // MARK: - Status, computed (spec 1.10)

    public static func status(_ t: Tournament) -> Status {
        if t.rounds.isEmpty { return .setup }
        if t.rounds.count >= totalRoundsOf(t) && pendingCount(t) == 0 { return .finished }
        return .ongoing
    }

    /// Round robin's round count follows from the field; Swiss's was chosen at creation.
    public static func totalRoundsOf(_ t: Tournament) -> Int {
        t.type == .roundRobin ? PairingEngine.roundRobinRounds(t.players.count) : t.totalRounds
    }

    public static func pendingCount(_ t: Tournament) -> Int {
        t.rounds.reduce(0) { acc, r in
            acc + r.boards.filter { !$0.isBye && $0.result == .pending }.count
        }
    }

    public static func roundComplete(_ r: Round) -> Bool {
        !r.boards.contains { !$0.isBye && $0.result == .pending }
    }

    // MARK: - Players

    /// Seeds are a monotonic counter, and removal renumbers the survivors densely (spec §7 #1).
    ///
    /// The server used `seed = currentCount + 1` and never renumbered, so removing a player produced
    /// duplicate seeds — and the round-robin circle sorts by seed, so the schedule degraded
    /// silently. Both halves matter: monotonic alone still collides after a removal, dense alone
    /// reorders people who were never touched.
    @discardableResult
    public static func addPlayer(_ doc: inout State, tournamentID: Int, name: String,
                                 fullName: String? = nil, rating: Int? = nil) -> Int? {
        guard let ti = index(doc, id: tournamentID) else { return nil }
        if status(doc.tournaments[ti]) != .setup { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let seed = doc.tournaments[ti].nextSeed
        let row = PlayerRow(id: seed,
                            name: String(trimmed.prefix(Limits.playerNameMax)),
                            fullName: normaliseName(fullName),
                            rating: normaliseRating(rating),
                            seed: seed)
        doc.tournaments[ti].nextSeed += 1
        doc.tournaments[ti].players.append(row)
        recompute(&doc.tournaments[ti])
        return row.id
    }

    static func normaliseName(_ v: String?) -> String? {
        guard let v else { return nil }
        let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    public static func normaliseRating(_ v: Int?) -> Int? {
        guard let v, v >= Limits.ratingMin, v <= Limits.ratingMax else { return nil }
        return v
    }

    /// `Maria Santos 1500` -> name + rating; `Juan Dela Cruz` -> name only (spec §1.5).
    ///
    /// The round-trip test is the part that matters: the last token must print back exactly as it
    /// was written, which rejects `007`, `15.5` and `1500abc` — all of which a plain integer parse
    /// would happily accept as 7, 15 and 1500.
    public static func parseBulkLine(_ line: String) -> (name: String, rating: Int?)? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let parts = trimmed.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        if parts.count >= 2, let last = parts.last, let n = Int(last),
           n >= Limits.ratingMin, n <= Limits.ratingMax, String(n) == last {
            return (name: parts.dropLast().joined(separator: " "), rating: n)
        }
        return (name: trimmed, rating: nil)
    }

    /// How many players `text` would add — shown live on the confirm button, so what the parser made
    /// of a paste is visible before it is committed.
    public static func bulkCount(_ text: String) -> Int {
        text.components(separatedBy: "\n").filter { parseBulkLine($0) != nil }.count
    }

    @discardableResult
    public static func bulkAdd(_ doc: inout State, tournamentID: Int, text: String) -> Int {
        var added = 0
        for line in text.components(separatedBy: "\n") {
            guard let parsed = parseBulkLine(line) else { continue }
            if addPlayer(&doc, tournamentID: tournamentID, name: parsed.name,
                         rating: parsed.rating) != nil {
                added += 1
            }
        }
        return added
    }

    @discardableResult
    public static func removePlayer(_ doc: inout State, tournamentID: Int, playerID: Int) -> Bool {
        guard let ti = index(doc, id: tournamentID) else { return false }
        if status(doc.tournaments[ti]) != .setup { return false }
        let before = doc.tournaments[ti].players.count
        doc.tournaments[ti].players.removeAll { $0.id == playerID }
        if doc.tournaments[ti].players.count == before { return false }
        // Dense renumbering, in the order they were added.
        for i in doc.tournaments[ti].players.indices {
            doc.tournaments[ti].players[i].seed = i + 1
        }
        doc.tournaments[ti].nextSeed = doc.tournaments[ti].players.count + 1
        recompute(&doc.tournaments[ti])
        return true
    }

    // MARK: - Pairing

    public static func canGenerate(_ t: Tournament) -> Bool {
        if t.players.count < 2 { return false }
        if status(t) == .finished { return false }
        if t.rounds.count >= totalRoundsOf(t) { return false }
        if t.type == .roundRobin { return t.rounds.isEmpty }   // the whole schedule, once
        return t.rounds.allSatisfy(roundComplete)
    }

    /// The engine's view of the field: value snapshots, never the stored records.
    static func engineState(_ t: Tournament) -> [PairingEngine.Player] {
        t.players.map { p in
            PairingEngine.Player(id: p.id, name: p.name, rating: p.rating, seed: p.seed,
                                 score: p.score, opponents: Set(p.opponentIDs),
                                 colors: p.colors, floats: p.floats, hadBye: p.hadBye)
        }
    }

    @discardableResult
    public static func generate(_ doc: inout State, tournamentID: Int, now: Int) -> Bool {
        guard let ti = index(doc, id: tournamentID) else { return false }
        if !canGenerate(doc.tournaments[ti]) { return false }

        if doc.tournaments[ti].type == .roundRobin {
            let ids = doc.tournaments[ti].players
                .sorted { $0.seed < $1.seed }
                .map { $0.id }
            let schedule = PairingEngine.bergerSchedule(ids)
            doc.tournaments[ti].totalRounds = schedule.count
            for (i, boards) in schedule.enumerated() {
                let rows = boards.map { b in
                    (white: Optional(b.white), black: b.black, bye: b.isBye)
                }
                doc.tournaments[ti].rounds.append(Round(number: i + 1, boards: materialise(rows)))
            }
        } else {
            let next = doc.tournaments[ti].rounds.count + 1
            let res = PairingEngine.pairRound(engineState(doc.tournaments[ti]), round: next)
            var rows = res.pairs.map { p in
                (white: Optional(p.white), black: Optional(p.black), bye: false)
            }
            // The bye is ALWAYS the last board (spec §7 #7). The server put it last in round 1 and
            // on board 1 from round 2 onward, so the same player sat at the top of every sheet.
            if let bye = res.bye { rows.append((white: Optional(bye), black: nil, bye: true)) }
            var floats: [String: PairingEngine.Float3] = [:]
            for (id, f) in res.floats { floats[String(id)] = f }
            doc.tournaments[ti].rounds.append(Round(number: next, boards: materialise(rows),
                                                    warnings: res.warnings, floats: floats))
        }
        recompute(&doc.tournaments[ti])
        doc.tournaments[ti].updatedAt = now
        return true
    }

    static func materialise(_ rows: [(white: Int?, black: Int?, bye: Bool)]) -> [Board] {
        rows.enumerated().map { i, b in
            // A bye is decided the moment it is awarded — nobody plays it, and leaving it pending is
            // what let the server compute standings that ignored it (spec §7 #12).
            Board(board: i + 1, white: b.white, black: b.black, isBye: b.bye,
                  result: b.bye ? .bye : .pending)
        }
    }

    // MARK: - Results

    @discardableResult
    public static func setResult(_ doc: inout State, tournamentID: Int, round number: Int,
                                 board: Int, result: Result, now: Int) -> Bool {
        guard let ti = index(doc, id: tournamentID) else { return false }
        guard let ri = doc.tournaments[ti].rounds.firstIndex(where: { $0.number == number }) else {
            return false
        }
        guard let bi = doc.tournaments[ti].rounds[ri].boards
            .firstIndex(where: { $0.board == board }) else { return false }
        if doc.tournaments[ti].rounds[ri].boards[bi].isBye { return false }
        if result == .bye { return false }

        // Results lock when the tournament is finished (spec §1.10, §7 #17) — with ONE exception:
        // clearing.
        //
        // A literal reading of "results are locked" is unimplementable alongside Clear Result
        // (§1.5, §7 #23). Finishing is *caused* by the last result being entered, so the moment you
        // make a typo on the deciding board the tournament locks and the new Clear Result button can
        // never reach it. The rule that satisfies both: once finished, a result may not be CHANGED
        // to another result, but it may be cleared — which returns the tournament to `.ongoing`,
        // after which ordinary editing applies again. Clearing is the deliberate "I got that wrong"
        // action, so it is exactly the one that should survive the lock.
        //
        // Recorded as a deviation in PORTING_NOTES.md.
        if result != .pending && status(doc.tournaments[ti]) == .finished { return false }

        doc.tournaments[ti].rounds[ri].boards[bi].result = result
        recompute(&doc.tournaments[ti])
        doc.tournaments[ti].updatedAt = now
        return true
    }

    /// Spec §1.5's fourth option, which the RN app had no way to express.
    @discardableResult
    public static func clearResult(_ doc: inout State, tournamentID: Int, round number: Int,
                                   board: Int, now: Int) -> Bool {
        setResult(&doc, tournamentID: tournamentID, round: number, board: board,
                  result: .pending, now: now)
    }

    // MARK: - Recomputation

    /// Rebuild every derived field on every player, from the rounds alone.
    ///
    /// Order matters in exactly one place: the tie-breaks need final scores, so they run last.
    public static func recompute(_ t: inout Tournament) {
        for i in t.players.indices {
            t.players[i].score = 0
            t.players[i].wins = 0
            t.players[i].draws = 0
            t.players[i].losses = 0
            t.players[i].byes = 0
            t.players[i].whiteGames = 0
            t.players[i].blackGames = 0
            t.players[i].colors = []
            t.players[i].floats = []
            t.players[i].opponentIDs = []
            t.players[i].hadBye = false
            t.players[i].buchholz = 0
            t.players[i].buchholzCut1 = 0
            t.players[i].sonnebornBerger = 0
            t.players[i].directEncounter = 0
        }
        var slot: [Int: Int] = [:]
        for (i, p) in t.players.enumerated() { slot[p.id] = i }

        var games: [PairingEngine.Game] = []
        for r in t.rounds {
            // Colour history is indexed by round, so a player who was not paired at all still needs
            // a slot — otherwise "the colour of my last game" silently reads someone else's round.
            var seen = Set<Int>()
            for b in r.boards {
                if b.isBye {
                    guard let w = b.white, let wi = slot[w] else { continue }
                    t.players[wi].score += 1
                    t.players[wi].byes += 1
                    t.players[wi].hadBye = true
                    t.players[wi].colors.append(nil)
                    seen.insert(w)
                    continue
                }
                guard let w = b.white, let bl = b.black,
                      let wi = slot[w], let bi = slot[bl] else { continue }
                seen.insert(w)
                seen.insert(bl)
                t.players[wi].colors.append(.white)
                t.players[bi].colors.append(.black)
                t.players[wi].whiteGames += 1
                t.players[bi].blackGames += 1
                t.players[wi].opponentIDs.append(bl)
                t.players[bi].opponentIDs.append(w)
                switch b.result {
                case .whiteWin:
                    t.players[wi].score += 1
                    t.players[wi].wins += 1
                    t.players[bi].losses += 1
                case .blackWin:
                    t.players[bi].score += 1
                    t.players[bi].wins += 1
                    t.players[wi].losses += 1
                case .draw:
                    t.players[wi].score += 0.5
                    t.players[bi].score += 0.5
                    t.players[wi].draws += 1
                    t.players[bi].draws += 1
                case .pending, .bye:
                    break
                }
                switch b.result {
                case .whiteWin:
                    games.append(PairingEngine.Game(white: w, black: bl, result: .whiteWin))
                case .blackWin:
                    games.append(PairingEngine.Game(white: w, black: bl, result: .blackWin))
                case .draw:
                    games.append(PairingEngine.Game(white: w, black: bl, result: .draw))
                case .pending, .bye:
                    break
                }
            }
            for i in t.players.indices where !seen.contains(t.players[i].id) {
                t.players[i].colors.append(nil)
            }
            for i in t.players.indices {
                t.players[i].floats.append(r.floats[String(t.players[i].id)] ?? .none)
            }
        }

        let tb = PairingEngine.tiebreaks(t.players.map { (id: $0.id, score: $0.score) },
                                         games: games)
        for i in t.players.indices {
            guard let x = tb[t.players[i].id] else { continue }
            t.players[i].buchholz = x.buchholz
            t.players[i].buchholzCut1 = x.buchholzCut1
            t.players[i].sonnebornBerger = x.sonnebornBerger
            t.players[i].directEncounter = x.directEncounter
        }
    }

    // MARK: - Standings

    /// ONE ordering, used by the table, the share image and the share text (spec §7 #13).
    ///
    /// The RN app had three: the server ranked on five keys including direct encounter, the `show`
    /// payload sorted by score and Buchholz only, and the client sorted by four keys and dropped
    /// direct encounter — so the same tournament produced a different leader depending on where you
    /// looked.
    public static func standings(_ t: Tournament) -> [PairingEngine.StandingsRow] {
        PairingEngine.standingsOrder(t.players.map { p in
            PairingEngine.StandingsRow(id: p.id, name: p.name, rating: p.rating, score: p.score,
                                       directEncounter: p.directEncounter, buchholz: p.buchholz,
                                       sonnebornBerger: p.sonnebornBerger, wins: p.wins)
        })
    }

    // MARK: - Coding

    /// A missing or corrupt document yields an EMPTY one rather than throwing.
    ///
    /// Losing a tournament list is bad; a screen that will not open at all is worse — and the same
    /// degradation is what the JS twin does, so the two halves behave alike.
    public static func decode(_ json: String) -> State {
        guard let data = json.data(using: .utf8),
              var s = try? JSONDecoder().decode(State.self, from: data) else {
            return State()
        }
        s.v = version
        if s.nextID < 1 { s.nextID = 1 }
        return s
    }

    /// Keys are sorted so the output is deterministic and comparable with the JS twin's.
    public static func encode(_ s: State) -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        guard let data = try? enc.encode(s), let text = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return text
    }
}
