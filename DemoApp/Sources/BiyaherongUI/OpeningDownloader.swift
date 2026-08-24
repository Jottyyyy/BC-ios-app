import Foundation
import BiyaherongCoachCore

/// **The only `URLSession` in the app.**
///
/// Spec §0.1 draws the app as two halves and names the online one: *"Opening Trainer → downloads a
/// repertoire pack" · "Tutorial Videos → streams from the bucket"*, with the rule that the only
/// `URLSession` calls live in `ContentClient` and `VideoPlayer`. Neither exists yet, and the
/// Opening Tree's two online sources reached the client before either did — so this file is that
/// rule's first inhabitant rather than an exception to it. When `ContentClient` lands, this is the
/// shape it copies: a transport with no opinions, over a parser that has all of them.
///
/// ## What is deliberately NOT here
///
/// Any decision. Every one — which URL, which colour the owner had, whether a status means a bad
/// username or a bad connection, when a chunk has overshot the ceiling — is in `OpeningDownload`,
/// in the parity core, where `replay_opening_tree.js` can reach it from Windows and
/// `ParityRunner`'s `opening_tree` group can run it on a Mac. What is left is forty lines of
/// `await`. That split is the entire point: on this checkout there is no Swift compiler and no
/// simulator, so anything this file decides on its own is decided untested.
///
/// ## Why the whole type is `@MainActor`
///
/// The package is `swift-tools-version:6.0` with no language-mode override, so **Swift 6 strict
/// concurrency applies**. A progress callback that crossed an isolation boundary would have to be
/// `@Sendable`, and a `@Sendable` closure cannot capture the `@State` it needs to write — the
/// counter would not compile, or would compile only after being smuggled through a reference box.
/// Pinning the downloader to the main actor makes `onProgress` an ordinary non-escaping closure
/// called from the same isolation domain, which needs no annotation at all.
///
/// It costs nothing that matters. Every `await` below suspends, so the main thread is free for the
/// whole of each network wait; what runs on it is one small `JSONSerialization` parse per line,
/// which is microseconds. The tree building this feeds (`OpeningTree.add`) was already on the main
/// actor, so nothing has moved onto it that was not there.
///
/// ## Cancellation
///
/// By `Task` cancellation, not a flag. The RN screen carries a `cancelRef` that every callback
/// re-checks because a React component cannot be cancelled; a `Task` can, so tearing down the
/// screen tears down the download, and `Task.checkCancellation()` at the top of each loop turn is
/// the whole implementation.
@MainActor
struct OpeningDownloader {

    /// Injected so the demo shell and any future test can run this without a network.
    var session: URLSession = .shared

    /// Download `username`'s games from `site`.
    ///
    /// Returns everything that arrived, filtered by colour and trimmed to `limit`. `onProgress`
    /// gets the running total as it grows, which is what the banner draws; it is not given the
    /// games, because nothing on screen shows them until the tree is built.
    ///
    /// Throws `OpeningDownload.Failure`, or `CancellationError` if the screen went away. Every
    /// other error — a dropped connection, a DNS failure, a body that stops mid-line — becomes
    /// `.network`, because "try again" is the only advice that fits all of them and a raw
    /// `URLError` on screen is not advice at all.
    func run(site: OpeningDownload.Site,
             username: String,
             colour: OpeningTree.Colour,
             limit: Int,
             onProgress: (Int) -> Void) async throws -> [OpeningTree.Game] {
        switch site {
        case .lichess:
            return try await runLichess(username: username, colour: colour,
                                        limit: limit, onProgress: onProgress)
        case .chesscom:
            return try await runChesscom(username: username, colour: colour,
                                         limit: limit, onProgress: onProgress)
        }
    }

    // MARK: - Lichess

    /// One NDJSON line at a time, which is what lets the counter move while the download runs.
    ///
    /// `bytes.lines` rather than a hand-rolled buffer: it splits the *byte* stream, so a chunk
    /// boundary landing inside a multi-byte character cannot corrupt a line. See the note in
    /// `OpeningDownload` — the JS twin has to do this by hand, and it is the one place the two
    /// languages are allowed to differ.
    private func runLichess(username: String,
                            colour: OpeningTree.Colour,
                            limit: Int,
                            onProgress: (Int) -> Void) async throws -> [OpeningTree.Game] {
        guard let url = URL(string: OpeningDownload.lichessGamesURL(username: username,
                                                                   maxGames: limit)) else {
            throw OpeningDownload.Failure.network
        }
        var request = URLRequest(url: url)
        request.setValue(OpeningDownload.lichessAccept, forHTTPHeaderField: "Accept")

        let (bytes, response) = try await bytesForRequest(request)
        try check(response)

        var games: [OpeningTree.Game] = []
        let fallbackIsWhite = colour != .black
        do {
            for try await line in bytes.lines {
                try Task.checkCancellation()
                if games.count >= limit { break }
                guard let game = OpeningDownload.game(fromLichessLine: line,
                                                      username: username,
                                                      fallbackIsWhite: fallbackIsWhite),
                      colour.accepts(isWhite: game.userIsWhite) else { continue }
                games.append(game)
                onProgress(games.count)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // A body that stops mid-stream. Whatever already arrived is real data and is kept —
            // the RN reader keeps its chunks too — so this is only fatal when nothing arrived.
            if games.isEmpty { throw OpeningDownload.Failure.network }
        }
        return games
    }

    // MARK: - Chess.com

    /// Archive by archive, newest month first — the twin of `fetchChessComChunked`.
    private func runChesscom(username: String,
                             colour: OpeningTree.Colour,
                             limit: Int,
                             onProgress: (Int) -> Void) async throws -> [OpeningTree.Game] {
        guard let listURL = URL(string: OpeningDownload.chesscomArchivesURL(username: username))
        else { throw OpeningDownload.Failure.network }

        let (listData, listResponse) = try await dataForURL(listURL)
        try check(listResponse)
        let months = OpeningDownload.chesscomArchives(fromJSON: listData)

        var games: [OpeningTree.Game] = []
        // Sequential, not a task group: the ceiling is a running total, so a month only knows how
        // much room it has once the newer ones are counted. It also keeps a 100-month account from
        // firing a hundred simultaneous requests at an API with no rate-limit header.
        for month in months {
            try Task.checkCancellation()
            if games.count >= limit { break }
            guard let url = URL(string: month) else { continue }

            // One unreadable month is skipped, exactly as the RN `catch { continue }` does:
            // losing April must not lose the other ninety-nine months with it.
            guard let pair = try? await dataForURL(url),
                  let http = pair.1 as? HTTPURLResponse,
                  OpeningDownload.isSuccess(status: http.statusCode) else { continue }

            let parsed = OpeningDownload.games(fromChesscomArchiveJSON: pair.0,
                                               username: username,
                                               colour: colour)
            let kept = OpeningDownload.trim(parsed, have: games.count, limit: limit)
            guard !kept.isEmpty else { continue }
            games.append(contentsOf: kept)
            onProgress(games.count)
        }
        return games
    }

    // MARK: - Transport

    private func bytesForRequest(_ request: URLRequest) async throws
        -> (URLSession.AsyncBytes, URLResponse) {
        do { return try await session.bytes(for: request) }
        catch is CancellationError { throw CancellationError() }
        catch { throw OpeningDownload.Failure.network }
    }

    private func dataForURL(_ url: URL) async throws -> (Data, URLResponse) {
        do { return try await session.data(from: url) }
        catch is CancellationError { throw CancellationError() }
        catch { throw OpeningDownload.Failure.network }
    }

    /// A non-HTTP response is `.network` rather than a crash: `URLSession` promises
    /// `HTTPURLResponse` for an `https` URL, and a force-cast on a promise is how a screen
    /// disappears in the field.
    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw OpeningDownload.Failure.network }
        guard OpeningDownload.isSuccess(status: http.statusCode) else {
            throw OpeningDownload.failure(forStatus: http.statusCode)
        }
    }
}

extension OpeningDownload.Failure {
    /// What the form shows. The two cases exist because these are the two sentences worth saying —
    /// and `errNetwork` now only appears when the connection really is the problem, which is the
    /// bug this whole feature was reported as.
    ///
    /// The copy lives here rather than in the Core because `OpeningStrings` is a UI table: the
    /// parity core names the failure, the shell decides how to say it.
    var message: String {
        switch self {
        case .unknownUser: return OpeningStrings.errUnknownUser
        case .network: return OpeningStrings.errNetwork
        }
    }
}
