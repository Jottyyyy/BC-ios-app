import Foundation

/// The Opening Tree — a SAN-keyed move tree over your own games, with win/draw/loss per candidate.
///
/// Ported from `analysis-board/openingtree.tsx` in the sibling RN repo (1,457 lines, three screens
/// in one file), which is itself a rebuild of <https://www.openingtree.com>. The client named that
/// site directly: *"simple lang ang logic at gusto ko mangyari dyan katulad dito mismo."*
///
/// ## The shape, and why it is this one
///
/// A node is keyed by the **SAN of the move that reaches it**, not by a FEN. That is the RN
/// original's `Record<string, TreeNode>` and openingtree.com's own model, and it is a real
/// decision rather than an accident: a SAN path is the *line you played*, so `1.e4 c5 2.Nf3` and
/// `1.Nf3 c5 2.e4` stay separate branches even though they transpose. A FEN key would merge them,
/// which is right for an opening *book* (`OpeningBook` does exactly that, deliberately) and wrong
/// for "show me how I actually play".
///
/// ## The one subtle rule: stats are the MOVER's
///
/// `wins`/`draws`/`losses` on a node describe how the side that **played that move** fared, not how
/// the tree's owner fared. Walking into the opponent's replies therefore keeps reading "how did
/// this move do for whoever chose it", which is what makes a two-colour tree legible. The RN loop
/// inverts win and loss on the opponent's plies for exactly this reason, and `add(_:)` below
/// reproduces that inversion.
///
/// ## Deliberately NOT here
///
/// Where the games come from. The Core takes `Game` values and knows nothing about PGN files,
/// Play-vs-Coach history or a Lichess endpoint — the UI layer owns all three, which keeps this
/// Foundation-only and keeps the one networked source out of the parity core entirely.
///
/// Nor ECO names: the screen overlays `OpeningBook.nameFor(_:lastKnown:)` as it walks, so the tree
/// stays a pure statistic and the book stays a pure lookup.
public struct OpeningTree: Equatable, Sendable, Codable {

    // MARK: - Types

    /// A game's result, as PGN spells it. `*` (unfinished) is deliberately absent: a game with no
    /// result contributes a count but no W/D/L, and `Game.outcome` being optional says that better
    /// than a fourth case would.
    public enum Outcome: String, CaseIterable, Sendable, Codable, Equatable {
        case whiteWin = "1-0"
        case blackWin = "0-1"
        case draw = "1/2-1/2"

        /// Tolerant of the spellings real exporters emit. `nil` for `*`, an empty tag, or anything
        /// unrecognised — the caller decides whether that game is worth adding.
        public static func parse(_ text: String) -> Outcome? {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch t {
            case "1-0", "1−0": return .whiteWin
            case "0-1", "0−1": return .blackWin
            case "1/2-1/2", "1/2", "½-½", "0.5-0.5": return .draw
            default: return nil
            }
        }

        /// Did `white` win, lose or draw? The primitive both the mover inversion and the UI use.
        public func score(forWhite white: Bool) -> Int {
            switch self {
            case .draw: return 0
            case .whiteWin: return white ? 1 : -1
            case .blackWin: return white ? -1 : 1
            }
        }
    }

    /// One game, reduced to what the tree needs.
    ///
    /// `userIsWhite` is per game rather than per tree because "both colours" is a real option on
    /// the RN form: a tree can hold games where the owner was White and games where they were
    /// Black, and the mover inversion is resolved per ply against this flag.
    public struct Game: Equatable, Sendable, Codable {
        public var sanMoves: [String]
        public var userIsWhite: Bool
        public var outcome: Outcome?

        public init(sanMoves: [String], userIsWhite: Bool, outcome: Outcome?) {
            self.sanMoves = sanMoves
            self.userIsWhite = userIsWhite
            self.outcome = outcome
        }
    }

    /// A node. `children` is recursive; `Dictionary` is a COW reference type underneath, so this is
    /// a finite-size struct despite naming itself.
    public struct Node: Equatable, Sendable, Codable {
        public var count = 0
        public var wins = 0
        public var draws = 0
        public var losses = 0
        public var children: [String: Node] = [:]

        public init() {}

        /// Games that reached this node and ended decisively or drawn. Can be less than `count`
        /// when unfinished games are in the tree.
        public var scored: Int { wins + draws + losses }
    }

    /// One row of the candidate list — a flattened `Node` plus the move that reaches it.
    ///
    /// It does NOT carry `children`, only whether there are any: the list is rebuilt on every
    /// navigation step and copying whole subtrees into it would make a 1,000-game tree crawl.
    public struct Candidate: Equatable, Sendable {
        public let san: String
        public let count: Int
        public let wins: Int
        public let draws: Int
        public let losses: Int
        public let hasContinuations: Bool

        public init(san: String, count: Int, wins: Int, draws: Int, losses: Int,
                    hasContinuations: Bool) {
            self.san = san
            self.count = count
            self.wins = wins
            self.draws = draws
            self.losses = losses
            self.hasContinuations = hasContinuations
        }

        public var scored: Int { wins + draws + losses }

        /// `part / scored`, clamped to `0...1`, or 0 when nothing is scored.
        ///
        /// The RN bar uses `flex: wins` and lets the layout normalise, which cannot express "no
        /// scored games" — three zero-flex children collapse to nothing and the bar silently
        /// vanishes. Returning an explicit share lets both UIs draw an empty track instead.
        public func share(_ part: Int) -> Double {
            let total = scored
            guard total > 0, part > 0 else { return 0 }
            return min(1, Double(part) / Double(total))
        }

        public var winShare: Double { share(wins) }
        public var drawShare: Double { share(draws) }
        public var lossShare: Double { share(losses) }
    }

    // MARK: - Constants

    /// How deep a game is walked into the tree.
    ///
    /// INVENTED — the RN screen has no cap and walks every ply of every game. That is a memory
    /// hazard at its own 1,000-game download limit (a 120-ply game contributes 120 nested
    /// dictionaries) and it is not what an opening tree is for: past move 20 the counts are 1 and
    /// the branch is a game record, not a repertoire. 40 plies is 20 full moves. Recorded in
    /// PORTING_NOTES.
    public static let defaultMaxPlies = 40

    /// How many plies of **free play** may hang off the tree before the board stops accepting moves.
    ///
    /// INVENTED — openingtree.com has no such limit and neither does the RN screen, because in
    /// neither can you move a piece at all. It is not defensiveness: `OpeningTreeStore.position`
    /// and `.lastMove` each replay the whole path on every SwiftUI `body` evaluation, and `path` is
    /// `@Published`, so an uncapped walk makes every repaint linear in how long the user has been
    /// wandering. That degrades *smoothly*, which is worse than crashing — a screen that gets
    /// vaguely sluggish over minutes with nothing pointing at why.
    ///
    /// It also makes an existing comment true again: `position`'s own doc said *"the walk is
    /// bounded by `defaultMaxPlies`, so it is 40 `makeMove`s at worst"*, which held only while the
    /// UI offered nothing but the tree's own moves.
    ///
    /// Deliberately **not** a reuse of `defaultMaxPlies`. That one bounds how much of a GAME is
    /// worth recording; this bounds how far a USER may wander. One constant serving two meanings is
    /// how `maxGamesLimit` came to be 2000. Recorded in PORTING_NOTES.
    public static let maxFreePlies = 20

    // The download ceiling used to live here as `maxGamesLimit = 2000`, described as "the download
    // ceiling the RN form offers". The RN form ceiling is **1000** — `Math.min(…, 1000)` at
    // openingtree.tsx:479 and again at :917 — so the constant was wrong and the parity check that
    // read it asserted the wrong number against the right prose. It is gone rather than corrected:
    // the limits belong to the download, so `OpeningDownload.premiumMaxGames` is the one copy.

    // MARK: - State

    /// Depth-1 children — the moves playable from the start.
    public private(set) var root: [String: Node] = [:]
    /// Games handed to `add`, including ones truncated by an illegal move.
    public private(set) var gameCount = 0
    /// Games rejected outright, i.e. whose FIRST move would not parse. Surfaced rather than
    /// swallowed: a whole import silently producing an empty tree is the failure mode a user
    /// reports as "it doesn't work".
    public private(set) var rejectedCount = 0

    public init() {}

    public var isEmpty: Bool { root.isEmpty }

    // MARK: - Building

    /// Replay a game and increment every node along its path.
    ///
    /// Faithful to `addGamesToTree`, including the two things about it that look like bugs and are
    /// not:
    ///
    /// - **An unparseable move truncates the game rather than dropping it.** Everything before the
    ///   bad token is real data and is kept. Real PGN carries null moves, `Z0`, and exporter
    ///   quirks; discarding a 30-move game over ply 31 would lose the opening it was imported for.
    /// - **Illegality is judged by the position, not the string.** SAN is re-generated from the
    ///   parsed move via `san(for:)`, so `Qxd8+`, `Qd8` over-disambiguated and `Qxd8` all collapse
    ///   to one canonical key. Two exports of the same game therefore land on the same branch.
    @discardableResult
    public mutating func add(_ game: Game, maxPlies: Int = OpeningTree.defaultMaxPlies) -> Int {
        gameCount += 1
        guard var position = ChessPosition(fen: ChessPosition.startFEN) else { return 0 }

        // Resolve the SAN first, then insert: the walk needs the mover's colour at each ply, and
        // taking it from the position BEFORE the move is exact where ply parity is only a
        // convention that happens to hold from the standard start.
        var steps: [(san: String, moverIsWhite: Bool)] = []
        steps.reserveCapacity(min(game.sanMoves.count, maxPlies))
        for token in game.sanMoves {
            if steps.count >= maxPlies { break }
            guard let move = position.move(forSAN: token) else { break }
            steps.append((position.san(for: move), position.sideToMove == .white))
            position = position.makeMove(move)
        }

        if steps.isEmpty {
            rejectedCount += 1
            return 0
        }
        OpeningTree.insert(steps[...], into: &root, game: game)
        return steps.count
    }

    public mutating func add(_ games: [Game], maxPlies: Int = OpeningTree.defaultMaxPlies) {
        for g in games { add(g, maxPlies: maxPlies) }
    }

    /// The recursive half. `removeValue` rather than a subscript read so the node being mutated is
    /// uniquely referenced and its subtree is not copied on every increment — the difference
    /// between linear and quadratic on a 1,000-game import.
    private static func insert(_ steps: ArraySlice<(san: String, moverIsWhite: Bool)>,
                               into children: inout [String: Node],
                               game: Game) {
        guard let step = steps.first else { return }
        var node = children.removeValue(forKey: step.san) ?? Node()
        node.count += 1

        // The mover inversion. `outcome.score(forWhite:)` is the tree owner's result; a node
        // records the MOVER's, so it flips on the opponent's plies.
        if let outcome = game.outcome {
            let ownerScore = outcome.score(forWhite: game.userIsWhite)
            let moverIsOwner = (step.moverIsWhite == game.userIsWhite)
            let moverScore = moverIsOwner ? ownerScore : -ownerScore
            if moverScore > 0 { node.wins += 1 } else if moverScore < 0 { node.losses += 1 }
            else { node.draws += 1 }
        }

        insert(steps.dropFirst(), into: &node.children, game: game)
        children[step.san] = node
    }

    // MARK: - Reading

    /// The children reachable by walking `path` from the start. Empty for a path off the tree.
    public func children(at path: [String]) -> [String: Node] {
        var level = root
        for san in path {
            guard let next = level[san] else { return [:] }
            level = next.children
        }
        return level
    }

    /// How many **leading** plies of `path` still exist in the tree.
    ///
    /// `children(at:)` answers `[:]` both at a leaf and for a path that has left the tree, which is
    /// why the explorer could not tell *"your games stop here"* from *"you played something none of
    /// them did"* — one empty card, two meanings, and Forward dead either way. This is the same
    /// walk, reporting **where it stopped** instead of what it found. `bookDepth == path.count` is
    /// on book; anything less is the ply at which the user left it.
    ///
    /// **A transposition is still off book, and that is the tree's premise rather than a gap.**
    /// `1.Nf3 c5 2.e4` does not rejoin `1.e4 c5 2.Nf3`, because this tree is keyed by the *line you
    /// played* (see the type's own doc comment). `OpeningBook` is the FEN-keyed thing that
    /// deliberately collapses transpositions; merging them here would make the candidate counts
    /// describe a different move order than the history strip above them shows.
    public func bookDepth(along path: [String]) -> Int {
        var level = root
        var depth = 0
        for san in path {
            guard let next = level[san] else { return depth }
            depth += 1
            level = next.children
        }
        return depth
    }

    /// The node `path` ends on, or nil if the path leaves the tree.
    public func node(at path: [String]) -> Node? {
        var level = root
        var found: Node?
        for san in path {
            guard let next = level[san] else { return nil }
            found = next
            level = next.children
        }
        return found
    }

    /// The candidate list at `path` — **count descending, ties broken by SAN ascending.**
    ///
    /// The tie-break is not decoration. `Dictionary` iteration order is unspecified and differs
    /// between runs, and Swift's `sort` is not stable (`CLAUDE.md`), so a comparator on `count`
    /// alone would shuffle equal-count moves between two renders of the same tree — and would put
    /// this language and the JS twin in different orders, which no replay could then compare.
    public func sortedMoves(at path: [String]) -> [Candidate] {
        children(at: path)
            .map { Candidate(san: $0.key,
                             count: $0.value.count,
                             wins: $0.value.wins,
                             draws: $0.value.draws,
                             losses: $0.value.losses,
                             hasContinuations: !$0.value.children.isEmpty) }
            .sorted { a, b in a.count == b.count ? a.san < b.san : a.count > b.count }
    }

    /// The most-played continuation, i.e. what a "forward" button plays. Nil at a leaf.
    public func mostPlayed(at path: [String]) -> String? { sortedMoves(at: path).first?.san }

    /// Every position in the tree, breadth-first, as a path. Used by the stats header and by the
    /// tests; not on any per-frame path.
    public var nodeCount: Int {
        func count(_ level: [String: Node]) -> Int {
            level.values.reduce(0) { $0 + 1 + count($1.children) }
        }
        return count(root)
    }

    /// The deepest path in the tree, in plies.
    public var depth: Int {
        func deepest(_ level: [String: Node]) -> Int {
            level.values.reduce(0) { max($0, 1 + deepest($1.children)) }
        }
        return deepest(root)
    }

    // MARK: - Persistence

    /// JSON, for the document store. `Codable` on the recursive `Node` handles the tree itself;
    /// this pair exists so the store never has to know the encoder's configuration.
    public func encodedJSON() -> Data? {
        let encoder = JSONEncoder()
        // Sorted keys so a tree that has not changed serialises byte-identically, which is what
        // makes "did this actually change?" answerable in the store and in a diff.
        encoder.outputFormatting = [.sortedKeys]
        return try? encoder.encode(self)
    }

    public static func decodedJSON(_ data: Data) -> OpeningTree? {
        try? JSONDecoder().decode(OpeningTree.self, from: data)
    }
}

// MARK: - Building games from PGN

public extension OpeningTree {

    /// Turn a PGN blob into games, one per `[Event]` block.
    ///
    /// Reuses `PGN.splitGames` and `PGN.mainlineTokens`, both already pinned to the real PHP
    /// `PgnImportService` by the `pgn_split` and `pgn_tokens` golden groups — so multi-game
    /// splitting, RAV skipping and NAG stripping are the backend's behaviour rather than a second
    /// implementation of it.
    ///
    /// `userName` decides which side the owner played, matched case-insensitively against the
    /// `White` and `Black` tags. When it matches neither — a PGN from somebody else's games, or one
    /// with no tags — `fallbackIsWhite` decides, which is what the form's White/Black/Both picker
    /// resolves to.
    static func games(fromPGN pgn: String,
                      userName: String?,
                      fallbackIsWhite: Bool = true,
                      colour: Colour = .both) -> [Game] {
        var out: [Game] = []
        for raw in PGN.splitGames(pgn) {
            let tokens = PGN.mainlineTokens(raw.movetext)
            if tokens.isEmpty { continue }

            let white = raw.headers["White"] ?? ""
            let black = raw.headers["Black"] ?? ""
            var isWhite = fallbackIsWhite
            if let name = userName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
                if white.caseInsensitiveCompare(name) == .orderedSame { isWhite = true }
                else if black.caseInsensitiveCompare(name) == .orderedSame { isWhite = false }
            }
            guard colour.accepts(isWhite: isWhite) else { continue }

            // The Result tag, or the movetext's own terminator when the tag is missing — plenty
            // of hand-pasted exports carry only one of the two. It is read off the RAW movetext,
            // not off `tokens`: `mainlineTokens` drops result tokens by design, so looking there
            // would find the last MOVE and quietly never match.
            let tail = raw.movetext.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" }).last
            let outcome = Outcome.parse(raw.headers["Result"] ?? "")
                ?? tail.flatMap { Outcome.parse(String($0)) }
            out.append(Game(sanMoves: tokens, userIsWhite: isWhite, outcome: outcome))
        }
        return out
    }

    /// Which side's games go into the tree.
    enum Colour: String, CaseIterable, Sendable, Codable, Equatable {
        case white, black, both

        public func accepts(isWhite: Bool) -> Bool {
            switch self {
            case .white: return isWhite
            case .black: return !isWhite
            case .both: return true
            }
        }

        public var label: String {
            switch self {
            case .white: return "White"
            case .black: return "Black"
            case .both: return "Both"
            }
        }
    }
}
