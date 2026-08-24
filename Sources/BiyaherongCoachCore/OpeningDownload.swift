import Foundation

/// The **wire formats** the Opening Tree's two online sources speak — and nothing else.
///
/// Ported from `analysis-board/openingtree.tsx`'s `fetchLichessStreaming` and
/// `fetchChessComChunked` in the sibling RN repo, which is where these two endpoints and their
/// shapes come from. The client's report is the reason this file exists: *"hindi nag-oopening
/// tree"* — because picking Lichess or Chess.com in this app validated the username and then
/// returned `errNetwork` ("Could not reach that site"), which blamed their connection for a
/// download that was never written.
///
/// ## Why a parser lives in the parity core when the download does not
///
/// `OpeningTree`'s own doc comment says the Core "knows nothing about … a Lichess endpoint", and
/// that stays true of `OpeningTree`. This is the seam that makes it affordable: **everything here
/// is a pure function from bytes to values, and none of it opens a socket.** Building the request
/// is a string, and reading the answer is a parse — the same thing `PGN.swift` already is for a
/// pasted file. The `URLSession` that actually performs the request lives in
/// `BiyaherongUI/OpeningDownloader.swift`, which is the only file in this feature the offline greps
/// exempt, and spec §0.1's rule survives intact: the transport is in one place.
///
/// The split is not tidiness. Every bug in a download of this shape is in the parse — a `winner`
/// key that is absent for two unrelated reasons, an archive list that arrives oldest-first, a
/// username that matches neither player. Put those behind a `URLSession` and no gate on this
/// Windows checkout can reach them; put them here and `replay_opening_tree.js` replays every one
/// against the JS twin.
public enum OpeningDownload {

    // MARK: - Sites

    /// The two sites the RN form offers. Named separately from `OpeningSource` (which is a UI
    /// concern and carries `pgn`/`coach` too) so the Core does not have to know what a form is.
    public enum Site: String, CaseIterable, Sendable, Codable, Equatable {
        case lichess, chesscom
    }

    /// Why a download produced nothing.
    ///
    /// Two cases, because the user can act on exactly two things: the name they typed, and the
    /// radio. Anything else — a 500, a dropped connection, a truncated body — is `.network`, since
    /// "try again" is the only useful advice for all of them.
    /// `Error` is declared HERE, not added by an extension in the UI layer. A retroactive
    /// conformance across a module boundary is a Swift 6 warning and, worse, a claim any other
    /// module could also make — the conformance belongs to whoever owns the type.
    public enum Failure: String, Error, Sendable, Codable, Equatable {
        case unknownUser
        case network
    }

    // MARK: - Limits

    /// Games a free account may pull. The RN screen's `resolvedMax` hardcodes this for non-premium
    /// users and ignores the input box entirely, which is why the box is hidden for them.
    public static let freeMaxGames = 100

    /// The ceiling a premium account may raise the box to — `Math.min(…, 1000)` in the RN form, in
    /// **both** the submit path (line 479) and the input's own clamp (line 917).
    public static let premiumMaxGames = 1000

    /// The floor. `Math.max(parseInt(…) || 1, 1)` — a blank or unparseable box is one game, not
    /// zero, so a mistyped field still returns something rather than silently succeeding at nothing.
    public static let minMaxGames = 1

    /// `resolvedMax` from the RN screen, exactly: premium clamps the box into
    /// `minMaxGames...premiumMaxGames`, free ignores it.
    public static func resolvedMax(isPremium: Bool, requested: Int) -> Int {
        guard isPremium else { return freeMaxGames }
        return min(max(requested, minMaxGames), premiumMaxGames)
    }

    // MARK: - Requests
    //
    // Strings, not `URLRequest`s. Building one here would drag `URLRequest` into the parity core
    // for no gain — the caller has to make one anyway — and would put a type the offline greps
    // scan for into a file they do not exempt.

    /// The characters `encodeURIComponent` leaves alone.
    ///
    /// Spelled out rather than taken from `CharacterSet.urlPathAllowed`, which permits `/`, `:`,
    /// `@` and `+` — a username containing any of those would escape the path segment and change
    /// which endpoint is called. This set is `encodeURIComponent`'s exactly, so the two languages
    /// build byte-identical URLs and `replay_opening_tree.js` can compare them.
    private static let componentAllowed = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    public static func encodeComponent(_ raw: String) -> String {
        raw.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? raw
    }

    /// `GET` this with `Accept: application/x-ndjson` and read it a line at a time.
    ///
    /// `pgnInJson=true` is what makes each line carry a `moves` string; without it Lichess streams
    /// PGN text and the whole line-oriented parse below has nothing to key on.
    public static func lichessGamesURL(username: String, maxGames: Int) -> String {
        "https://lichess.org/api/games/user/\(encodeComponent(username))"
            + "?pgnInJson=true&max=\(maxGames)"
    }

    /// Lichess streams NDJSON only when asked to. Sent as a header rather than a query parameter
    /// because that is the API's contract.
    public static let lichessAccept = "application/x-ndjson"

    /// Chess.com has no "last N games" endpoint — it publishes one archive per month, and the list
    /// of them is this. `chesscomArchives(fromJSON:)` reverses it.
    public static func chesscomArchivesURL(username: String) -> String {
        "https://api.chess.com/pub/player/\(encodeComponent(username))/games/archives"
    }

    /// A 404 is the one status that means something specific: neither site has that user.
    /// Everything else is worth retrying, so it reads as a connection problem.
    public static func failure(forStatus code: Int) -> Failure {
        code == 404 ? .unknownUser : .network
    }

    /// `200...299`, the range the RN `xhr.onload` accepts.
    public static func isSuccess(status code: Int) -> Bool { (200...299).contains(code) }

    // MARK: - Lichess NDJSON

    /// Lichess statuses that mean **the game has no result**, as distinct from a drawn one.
    ///
    /// This is a DELIBERATE DEVIATION from the RN screen, recorded in `PORTING_NOTES.md`. Its
    /// mapping is `winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2'`, so an
    /// **aborted** game — no winner, no result, frequently the first game in a stream — is scored
    /// as a draw for both sides. `OpeningTree.Outcome` already made the opposite decision for
    /// pasted PGN ("`*` is deliberately absent: a game with no result contributes a count but no
    /// W/D/L"), and an import path that disagrees with the paste path about the same game is a
    /// worse bug than the one being fixed.
    public static let lichessUnfinishedStatuses: Set<String> =
        ["created", "started", "aborted", "noStart", "unknownFinish"]

    /// One NDJSON line → one game, or nil if the line is not one.
    ///
    /// Nil rather than throwing for the same reason the RN `.filter()` drops them: a stream is
    /// read while it arrives, and one malformed line must not lose the 99 good ones around it.
    public static func game(fromLichessLine line: String,
                            username: String,
                            fallbackIsWhite: Bool) -> OpeningTree.Game? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any],
              let moves = root["moves"] as? String else { return nil }

        let sanMoves = moves.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard !sanMoves.isEmpty else { return nil }

        return OpeningTree.Game(sanMoves: sanMoves,
                                userIsWhite: lichessUserIsWhite(root,
                                                                username: username,
                                                                fallback: fallbackIsWhite),
                                outcome: lichessOutcome(root))
    }

    /// Which side the tree's owner had, read from the game rather than assumed from the form.
    ///
    /// **This is where the online path is allowed to be better than the RN one.** `addGamesToTree`
    /// takes the form's White/Black picker as the answer whenever it is not "both", so a tree built
    /// as "White" labels every game White — including the ones the user had Black in, whose results
    /// then land inverted. Here the username is known for every online game, so the real colour is
    /// available, and `OpeningTree.Colour` **filters** on it exactly as the paste path does. Same
    /// picker, same meaning, in all three sources.
    public static func lichessUserIsWhite(_ root: [String: Any],
                                          username: String,
                                          fallback: Bool) -> Bool {
        let wanted = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !wanted.isEmpty, let players = root["players"] as? [String: Any] else {
            return fallback
        }
        func name(_ side: String) -> String? {
            ((players[side] as? [String: Any])?["user"] as? [String: Any])?["name"] as? String
        }
        if let w = name("white"), w.caseInsensitiveCompare(wanted) == .orderedSame { return true }
        if let b = name("black"), b.caseInsensitiveCompare(wanted) == .orderedSame { return false }
        return fallback
    }

    /// `winner` when there is one; otherwise a draw unless the status says the game never finished.
    public static func lichessOutcome(_ root: [String: Any]) -> OpeningTree.Outcome? {
        switch root["winner"] as? String {
        case "white": return .whiteWin
        case "black": return .blackWin
        default: break
        }
        let status = (root["status"] as? String) ?? ""
        return lichessUnfinishedStatuses.contains(status) ? nil : .draw
    }

    /// A whole NDJSON body — or any complete-lines chunk of one — filtered by colour.
    public static func games(fromLichessNDJSON text: String,
                             username: String,
                             colour: OpeningTree.Colour) -> [OpeningTree.Game] {
        var out: [OpeningTree.Game] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            guard let game = game(fromLichessLine: String(line),
                                  username: username,
                                  fallbackIsWhite: colour != .black) else { continue }
            guard colour.accepts(isWhite: game.userIsWhite) else { continue }
            out.append(game)
        }
        return out
    }

    // The JS twin carries a `lastCompleteLineEnd` here and this file deliberately does not.
    //
    // A chunk boundary falls anywhere, including the middle of a JSON object, and parsing half a
    // line drops a game silently — so the RN `processBuffer` keeps a buffer and cuts it at the last
    // newline. In Swift that job belongs to `URLSession.AsyncBytes.lines`, which does it on the
    // byte stream and gets the UTF-8 boundaries right that a String-index version would have to
    // re-derive. The browser has no equivalent — `ReadableStream` hands back bytes and nothing
    // else — so `opening-download.js` implements it and this file does not. An ASYMMETRY ON
    // PURPOSE, and the only one in the pair; recorded in `PORTING_NOTES.md` so that the next reader
    // does not "restore" it.

    // MARK: - Chess.com archives

    /// The archive URLs, **newest month first**.
    ///
    /// Chess.com publishes them oldest-first and the RN code reverses the list. Not cosmetic: the
    /// walk stops at `maxGames`, so the order decides *which* games a 100-game tree is built from.
    /// Oldest-first would build every free user a tree of the games they played when they signed
    /// up, which is precisely the opposite of what an opening tree is asked for.
    public static func chesscomArchives(fromJSON data: Data) -> [String] {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any],
              let archives = root["archives"] as? [Any] else { return [] }
        return archives.compactMap { $0 as? String }.reversed()
    }

    /// One month's archive → games, **newest first within the month**, filtered by colour.
    ///
    /// The PGN each entry carries is handed to `OpeningTree.games(fromPGN:…)` rather than scraped
    /// with a regex the way the RN version does. That parser is already pinned to the real
    /// `PgnImportService` by the `pgn_split` and `pgn_tokens` golden groups, and it reads the
    /// `White`/`Black`/`Result` tags Chess.com already writes — so the colour match, the result and
    /// the RAV/NAG handling are all the behaviour the paste path has, for free.
    public static func games(fromChesscomArchiveJSON data: Data,
                             username: String,
                             colour: OpeningTree.Colour) -> [OpeningTree.Game] {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let root = object as? [String: Any],
              let entries = root["games"] as? [Any] else { return [] }

        var out: [OpeningTree.Game] = []
        for entry in entries.reversed() {
            guard let game = entry as? [String: Any],
                  let pgn = game["pgn"] as? String, !pgn.isEmpty else { continue }
            out.append(contentsOf: OpeningTree.games(fromPGN: pgn,
                                                     userName: username,
                                                     fallbackIsWhite: colour != .black,
                                                     colour: colour))
        }
        return out
    }

    /// Trim a just-arrived chunk to the room left under the ceiling.
    ///
    /// The two sites overshoot for different reasons — Lichess returns whole lines and Chess.com
    /// whole months — so both callers need this, and neither should re-derive it. Returns an empty
    /// array once `have` has reached `limit`, which is also the signal to stop asking for more.
    public static func trim(_ games: [OpeningTree.Game],
                            have: Int,
                            limit: Int) -> [OpeningTree.Game] {
        let room = limit - have
        guard room > 0 else { return [] }
        return room >= games.count ? games : Array(games.prefix(room))
    }
}
