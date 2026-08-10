import Foundation

/// PGN import and export, variations included (Analysis Board).
///
/// PGN is not just an interchange format here — it is the **persistence format**: a saved analysis
/// is stored as its PGN text plus an initial FEN, exactly as the Laravel `analysis_sessions.pgn`
/// column does. So the round trip has to be exact, and recursive variations have to survive it.
///
/// Transliterated from `web-demo/js/pgn.js`, which is proven by its own 66-assertion suite plus the
/// oracle-derived `pgn_tokens` / `pgn_split` goldens.
///
/// Scope: tag pairs with `\"` escapes, `{block}` and `;line` comments, `%` escape lines, `$n` NAGs,
/// the `!?` suffix forms, recursive variations, all four result tokens, `SetUp`/`FEN`, and
/// multi-game files. Null moves (`--`, `Z0`) are rejected — an explicit non-goal.
///
/// A parse error does not throw the game away: parsing stops at the offending ply and the
/// **partial** tree is returned alongside the error, so an import can report "34 of 41 moves".
///
/// **No regex**, matching `ChessNotation.swift`. The JavaScript tag pattern
/// `/^\[(\w+)\s+"(.*)"\]$/` has a greedy `.*`, which is reproduced by taking the value between the
/// *first* and the *last* quote of the bracketed line.
public enum PGN {

    public static let maxRAVDepth = 20
    public static let maxNodes = 20000

    public static let sevenTagRoster = ["Event", "Site", "Date", "Round", "White", "Black", "Result"]
    static let tagDefaults: [String: String] = [
        "Event": "?", "Site": "?", "Date": "????.??.??", "Round": "?",
        "White": "?", "Black": "?", "Result": "*",
    ]
    /// Emitted after the roster, in this order, when present. `SetUp`/`FEN` are handled separately
    /// so they always pair up.
    static let extraTags = ["WhiteElo", "BlackElo", "ECO", "Opening", "TimeControl", "Annotator", "Location"]

    /// The six suffix annotations, in NAG numbering. Longest first so `!!` wins over `!`.
    static let suffixNAGs: [(String, Int)] = [("!!", 3), ("??", 4), ("!?", 5), ("?!", 6), ("!", 1), ("?", 2)]

    public static let results = ["1-0", "0-1", "1/2-1/2", "*"]

    // MARK: - Types

    public struct RawGame: Equatable {
        public var headers: [String: String]
        public var movetext: String
    }

    public struct ParseError: Equatable {
        public let ply: Int
        public let token: String
        public let message: String
    }

    public struct Game {
        public var headers: [String: String] = [:]
        public var tree: MoveTree
        public var result: String = "*"
        public var errors: [ParseError] = []
        public var moveCount: Int = 0
        public var preComment: String = ""
        public var initialFEN: String = ChessPosition.startFEN

        /// Public so a caller can serialise a tree it built itself — saving a game, not just
        /// re-emitting one that was parsed. The synthesized memberwise init is internal.
        public init(tree: MoveTree, headers: [String: String] = [:], result: String = "*",
                    errors: [ParseError] = [], moveCount: Int = 0, preComment: String = "",
                    initialFEN: String = ChessPosition.startFEN) {
            self.tree = tree; self.headers = headers; self.result = result
            self.errors = errors; self.moveCount = moveCount
            self.preComment = preComment; self.initialFEN = initialFEN
        }
    }

    enum Token: Equatable {
        case move(text: String, san: String, nag: Int)
        case number
        case comment(String)
        case nag(Int)
        case ravOpen
        case ravClose
        case result(String)
        case bad(String)
    }

    // MARK: - Game splitting (faithful to PgnImportService::splitPgnGames)

    /// Reproduces the server's splitter exactly, including its raw (un-unescaped) tag values and the
    /// leading space it prepends to every movetext chunk. `parse` unescapes afterwards; keeping the
    /// two apart is what lets `Goldens/pgn_split.json` compare byte for byte.
    public static func splitGames(_ pgn: String) -> [RawGame] {
        let text = pgn.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var games: [RawGame] = []
        var current = RawGame(headers: [:], movetext: "")
        var inHeaders = true
        var hasContent = false

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                if inHeaders && hasContent {
                    inHeaders = false
                } else if !inHeaders && hasContent && !current.movetext.isEmpty {
                    games.append(current)
                    current = RawGame(headers: [:], movetext: "")
                    inHeaders = true
                    hasContent = false
                }
                continue
            }
            hasContent = true
            if inHeaders, let tag = parseTagLine(trimmed) {
                current.headers[tag.0] = tag.1
            } else {
                inHeaders = false
                current.movetext += " " + trimmed
            }
        }
        if !current.movetext.trimmingCharacters(in: .whitespaces).isEmpty { games.append(current) }
        return games
    }

    /// `[Name "value"]` → `("Name", "value")`, or `nil`. The value runs from the first quote to the
    /// last, reproducing the JavaScript pattern's greedy capture.
    static func parseTagLine(_ line: String) -> (String, String)? {
        let cs = Array(line)
        guard cs.count >= 4, cs[0] == "[", cs[cs.count - 1] == "]" else { return nil }
        let inner = Array(cs[1 ..< (cs.count - 1)])
        // tag name: \w+
        var i = 0
        while i < inner.count, inner[i] == "_" || inner[i].isLetter || inner[i].isNumber { i += 1 }
        guard i > 0, i < inner.count else { return nil }
        let name = String(inner[0 ..< i])
        // at least one space
        var j = i
        while j < inner.count, inner[j] == " " || inner[j] == "\t" { j += 1 }
        guard j > i else { return nil }
        guard let firstQuote = inner[j...].firstIndex(of: "\""),
              let lastQuote = inner.lastIndex(of: "\""),
              lastQuote > firstQuote,
              lastQuote == inner.count - 1 else { return nil }
        return (name, String(inner[(firstQuote + 1) ..< lastQuote]))
    }

    static func unescapeTag(_ v: String) -> String {
        var out = ""
        var escaped = false
        for ch in v {
            if escaped { out.append(ch); escaped = false }
            else if ch == "\\" { escaped = true }
            else { out.append(ch) }
        }
        if escaped { out.append("\\") }
        return out
    }

    static func escapeTag(_ v: String) -> String {
        var out = ""
        for ch in v {
            if ch == "\\" || ch == "\"" { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    // MARK: - Movetext scanner

    /// Split a `!?` suffix off a move token. Returns the bare SAN and the NAG code.
    static func splitSuffix(_ token: String) -> (san: String, nag: Int) {
        for (suffix, nag) in suffixNAGs where token.count > suffix.count && token.hasSuffix(suffix) {
            return (String(token.dropLast(suffix.count)), nag)
        }
        return (token, 0)
    }

    static func isDelimiter(_ ch: Character) -> Bool {
        ch == "(" || ch == ")" || ch == "{" || ch == "}" || ch == ";" || ch == "$"
    }

    /// Move tokens keep their `!?` suffix in `text` (so the token stream is directly comparable with
    /// the PHP oracle's) while `san` is the bare move and `nag` the suffix's code.
    ///
    /// Internal, not public: `Token` is an implementation detail, and a `public` function may not expose
    /// an internal type — Swift rejects it outright. Callers outside the module want `mainlineTokens`,
    /// which returns `[String]`; that is what `ParityRunner`'s `pgn_tokens` group uses.
    static func tokenize(_ movetext: String) -> [Token] {
        // % escape lines are ignored entirely, per the PGN spec (column 0 only).
        var lines: [String] = []
        let normalised = movetext.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        for line in normalised.split(separator: "\n", omittingEmptySubsequences: false) {
            lines.append(line.hasPrefix("%") ? " " : String(line))
        }
        let cs = Array(lines.joined(separator: "\n"))

        var out: [Token] = []
        var i = 0
        while i < cs.count {
            let c = cs[i]
            if c == " " || c == "\n" || c == "\t" { i += 1; continue }

            if c == "{" {
                var j = i + 1
                while j < cs.count, cs[j] != "}" { j += 1 }
                out.append(.comment(String(cs[(i + 1) ..< min(j, cs.count)]).trimmingCharacters(in: .whitespacesAndNewlines)))
                i = min(j + 1, cs.count)
                continue
            }
            if c == ";" {
                var j = i + 1
                while j < cs.count, cs[j] != "\n" { j += 1 }
                out.append(.comment(String(cs[(i + 1) ..< j]).trimmingCharacters(in: .whitespacesAndNewlines)))
                i = j
                continue
            }
            if c == "(" { out.append(.ravOpen); i += 1; continue }
            if c == ")" { out.append(.ravClose); i += 1; continue }
            if c == "$" {
                var j = i + 1
                var digits = ""
                while j < cs.count, cs[j].isNumber { digits.append(cs[j]); j += 1 }
                if let n = Int(digits) { out.append(.nag(n)); i = j } else { i += 1 }
                continue
            }
            // A result token must stand alone — checked before move numbers so 1/2-1/2 is not read
            // as the number "1".
            if let r = matchResult(cs, at: i) { out.append(.result(r)); i += r.count; continue }
            // Move numbers: "1." "12." "3..." and the no-space form "1.e4".
            if c.isNumber {
                var j = i
                while j < cs.count, cs[j].isNumber { j += 1 }
                if j < cs.count, cs[j] == "." {
                    while j < cs.count, cs[j] == "." { j += 1 }
                    out.append(.number)
                    i = j
                    continue
                }
            }
            var j = i
            while j < cs.count, cs[j] != " ", cs[j] != "\n", cs[j] != "\t", !isDelimiter(cs[j]) { j += 1 }
            if j == i { i += 1; continue }
            let raw = String(cs[i ..< j])
            if raw == "--" || raw == "Z0" || raw == "@@@@" {
                out.append(.bad(raw))
            } else {
                let sp = splitSuffix(raw)
                out.append(.move(text: raw, san: sp.san, nag: sp.nag))
            }
            i = j
        }
        return out
    }

    /// A result token at `i`, if one stands alone there.
    static func matchResult(_ cs: [Character], at i: Int) -> String? {
        for r in results {
            let rc = Array(r)
            guard i + rc.count <= cs.count else { continue }
            var matches = true
            for k in 0 ..< rc.count {
                if cs[i + k] != rc[k] { matches = false; break }
            }
            guard matches else { continue }
            let end = i + rc.count
            if end == cs.count { return r }
            let next = cs[end]
            if next == " " || next == "\n" || next == "\t" || next == ")" { return r }
        }
        return nil
    }

    /// The main-line move tokens, RAV contents excluded, suffixes intact.
    public static func mainlineTokens(_ movetext: String) -> [String] {
        var depth = 0
        var out: [String] = []
        for t in tokenize(movetext) {
            switch t {
            case .ravOpen: depth += 1
            case .ravClose: if depth > 0 { depth -= 1 }
            case .move(let text, _, _): if depth == 0 { out.append(text) }
            default: break
            }
        }
        return out
    }

    // MARK: - Parsing

    /// Parse a PGN file. `errors` being non-empty means a game is a partial import, not a failure.
    public static func parse(_ text: String) -> [Game] {
        var games: [Game] = []
        for raw in splitGames(text) {
            var headers: [String: String] = [:]
            for (k, v) in raw.headers { headers[k] = unescapeTag(v) }

            // SetUp "1" is the flag, but plenty of exporters emit FEN alone — honour either.
            var initialFEN = headers["FEN"] ?? ChessPosition.startFEN
            var fenWasBad = false
            var candidate = MoveTree(initialFEN: initialFEN)
            if candidate == nil {
                initialFEN = ChessPosition.startFEN
                fenWasBad = true
                candidate = MoveTree(initialFEN: initialFEN)
            }
            guard let tree = candidate else { continue }

            var game = Game(headers: headers, tree: tree, result: "*", errors: [],
                            moveCount: 0, preComment: "", initialFEN: tree.initialFEN)
            if fenWasBad {
                game.errors.append(ParseError(ply: 0, token: headers["FEN"] ?? "",
                                              message: "invalid FEN tag; used the start position"))
            }
            var state = WalkState()
            let tokens = tokenize(raw.movetext)
            walk(tokens, tree: tree, game: &game, state: &state, depth: 0, startNode: nil)
            if let r = headers["Result"], game.result == "*" { game.result = r }
            games.append(game)
        }
        return games
    }

    /// Convenience for the common case.
    public static func parseFirst(_ text: String) -> Game? {
        let g = parse(text)
        return g.isEmpty ? nil : g[0]
    }

    struct WalkState {
        var i = 0
        var nodes = 0
        var aborted = false
    }

    static func skipRAV(_ tokens: [Token], _ state: inout WalkState) {
        var depth = 1
        while state.i < tokens.count && depth > 0 {
            switch tokens[state.i] {
            case .ravOpen: depth += 1
            case .ravClose: depth -= 1
            default: break
            }
            state.i += 1
        }
    }

    static func walk(_ tokens: [Token], tree: MoveTree, game: inout Game,
                     state: inout WalkState, depth: Int, startNode: MoveNode?) {
        var last = startNode
        while state.i < tokens.count {
            if state.aborted { return }
            let t = tokens[state.i]

            switch t {
            case .ravClose:
                state.i += 1
                return

            case .ravOpen:
                state.i += 1
                // A variation replaces the move just played, so it branches from that move's PARENT.
                if let l = last, let p = l.parent, depth < maxRAVDepth {
                    let save = tree.current
                    tree.current = p
                    walk(tokens, tree: tree, game: &game, state: &state, depth: depth + 1, startNode: nil)
                    tree.current = save
                } else {
                    if depth >= maxRAVDepth {
                        game.errors.append(ParseError(ply: game.moveCount, token: "(",
                                                      message: "variation nesting too deep"))
                    }
                    skipRAV(tokens, &state)
                }

            case .move(let text, let san, let nag):
                if state.nodes >= maxNodes {
                    game.errors.append(ParseError(ply: game.moveCount, token: text,
                                                  message: "too many moves"))
                    state.aborted = true
                    return
                }
                guard let r = tree.add(san: san) else {
                    game.errors.append(ParseError(ply: game.moveCount + 1, token: text,
                                                  message: "illegal or unparseable move \"\(text)\""))
                    state.aborted = true
                    return
                }
                state.nodes += 1
                if depth == 0 { game.moveCount += 1 }
                if nag != 0 && r.created { r.node.nag = nag }
                last = r.node
                state.i += 1

            case .nag(let n):
                last?.nag = n
                state.i += 1

            case .comment(let c):
                if let l = last {
                    l.comment = l.comment.isEmpty ? c : (l.comment + " " + c)
                } else {
                    game.preComment = game.preComment.isEmpty ? c : (game.preComment + " " + c)
                }
                state.i += 1

            case .result(let r):
                game.result = r
                state.i += 1

            case .bad(let text):
                game.errors.append(ParseError(ply: game.moveCount + 1, token: text,
                                              message: "null moves are not supported"))
                state.aborted = true
                return

            case .number:
                state.i += 1   // numbers carry no structure
            }
        }
    }

    // MARK: - Serialization

    static func numberToken(_ node: MoveNode, needsNumber: Bool) -> String {
        if node.color == .white { return "\(node.moveNumber)." }
        return needsNumber ? "\(node.moveNumber)..." : ""
    }

    static func cleanComment(_ c: String) -> String {
        String(c.filter { $0 != "{" && $0 != "}" }).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Emit one move. Returns whether the *next* move must be re-numbered.
    static func emitMove(_ node: MoveNode, into tokens: inout [String], needsNumber: Bool) -> Bool {
        let nt = numberToken(node, needsNumber: needsNumber)
        if !nt.isEmpty { tokens.append(nt) }
        tokens.append(node.san)
        if node.nag != 0 { tokens.append("$\(node.nag)") }
        if !node.comment.isEmpty { tokens.append("{" + cleanComment(node.comment) + "}") }
        return !node.comment.isEmpty
    }

    static func emit(from parent: MoveNode, into tokens: inout [String], needsNumber: Bool) {
        var p = parent
        var needs = needsNumber
        while let main = p.children.first {
            needs = emitMove(main, into: &tokens, needsNumber: needs)
            for i in 1 ..< p.children.count {
                tokens.append("(")
                let vneeds = emitMove(p.children[i], into: &tokens, needsNumber: true)
                emit(from: p.children[i], into: &tokens, needsNumber: vneeds)
                tokens.append(")")
                needs = true
            }
            p = main
        }
    }

    static func wrap(_ tokens: [String], width: Int) -> String {
        var lines: [String] = []
        var line = ""
        for t in tokens {
            if line.isEmpty { line = t; continue }
            // Parentheses hug: '(' joins what follows it and ')' joins what precedes it, so a
            // variation reads "(1... c5 2. Nf3)" and not "( 1... c5 2. Nf3 )". A hug may overrun
            // `width` by a character or two, which every PGN reader tolerates.
            if t == ")" || line.last == "(" { line += t; continue }
            if line.count + 1 + t.count > width { lines.append(line); line = t }
            else { line += " " + t }
        }
        if !line.isEmpty { lines.append(line) }
        return lines.joined(separator: "\n")
    }

    /// Serialize a game to canonical PGN: the Seven Tag Roster in order with the standard
    /// placeholders, `FEN` only for a non-standard start and always paired with `SetUp "1"`, and
    /// movetext wrapped at 80 columns.
    public static func serialize(_ game: Game) -> String {
        var out: [String] = []
        let result = game.result.isEmpty ? (game.headers["Result"] ?? "*") : game.result

        for tag in sevenTagRoster {
            let value: String
            if tag == "Result" {
                value = result
            } else if let v = game.headers[tag], !v.isEmpty {
                value = v
            } else {
                value = tagDefaults[tag] ?? "?"
            }
            out.append("[\(tag) \"\(escapeTag(value))\"]")
        }
        for tag in extraTags {
            if let v = game.headers[tag], !v.isEmpty { out.append("[\(tag) \"\(escapeTag(v))\"]") }
        }
        let startFEN = game.initialFEN.isEmpty ? game.tree.initialFEN : game.initialFEN
        if startFEN != ChessPosition.startFEN {
            out.append("[SetUp \"1\"]")
            out.append("[FEN \"\(escapeTag(startFEN))\"]")
        }
        out.append("")

        var tokens: [String] = []
        if !game.preComment.isEmpty { tokens.append("{" + cleanComment(game.preComment) + "}") }
        emit(from: game.tree.root, into: &tokens, needsNumber: true)
        tokens.append(result)
        out.append(wrap(tokens, width: 80))
        return out.joined(separator: "\n") + "\n"
    }
}
