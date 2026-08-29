import Foundation
import BiyaherongCoachCore

/// Fetches the Tutorial Videos manifest. **The second of the two files in this app allowed to open
/// a connection**, the first being `OpeningDownloader.swift`.
///
/// Spec §0.1 names it: *"the only `URLSession` calls in the entire app live in `ContentClient`
/// (Phase 4.2) and `VideoPlayer` (Phase 5.3)"*, and
/// `tools/qa/replay_opening_tree.js` §12 enforces the list. Adding a third means changing that
/// allow-list on purpose, which is the point of having one.
///
/// It copies `OpeningDownloader`'s shape deliberately, as the spec said it would: **a transport with
/// no opinions, over a parser in the parity core.** Nothing here knows what a video is —
/// `VideoLibrary.parse` does, and it is Foundation-only and replayed in JavaScript.
///
/// ## Why the public route and not the authenticated API
///
/// The RN app reads the same rows from `GET /api/tutorial-videos`, which sits inside
/// `Route::middleware('auth:sanctum')`. **This app has no account and no token, by design** — it
/// signs in with Apple on the device and never talks to the Laravel backend, and no
/// `/api/auth/apple` endpoint exists that could mint one. Pointing the screen at that path would
/// 401 forever, which on a phone is indistinguishable from a broken feature.
///
/// So Laravel publishes the same catalogue with no auth at all, at `/api/content/tutorial-videos`.
/// One controller, one shared query, two doors — they cannot describe different catalogues.
@MainActor
public enum ContentClient {

    /// Where the manifest lives.
    ///
    /// **A deviation from spec §0.1** — *"Content = static files on R2/S3. No API. No accounts. No
    /// sync."* — taken deliberately and written up in `PORTING_NOTES.md`. The spec's objection was
    /// to accounts and sync, and this route has neither: no token, no session, no write path. What
    /// it does have is the thing a bucket file does not, which is that it cannot go stale. The
    /// static file has to be regenerated and re-uploaded by hand after every upload in the admin
    /// panel, and a catalogue that quietly stops matching the shelf is worse than one that was
    /// never published, because nothing about it looks wrong.
    ///
    /// `tools/content/generate_video_manifest.php` still writes that file for anyone who would
    /// rather serve it from a bucket. Point this at its URL instead and nothing else changes —
    /// `VideoLibrary.parse` accepts both, because they are the same bytes.
    public static let manifestURL = "https://biyaherongchesscoach.com/api/content/tutorial-videos"

    /// `true` once `manifestURL` names somewhere to look.
    public static var isConfigured: Bool {
        !manifestURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public enum Failure: Error, Equatable, Sendable {
        /// No `manifestURL`. Not a network problem, and must not be reported as one.
        case notConfigured
        /// The device says it has no route to the internet, or the request never landed.
        case offline
        /// It landed and was not a catalogue — a 404, an HTML error page, a truncated file.
        case unreadable

        public var isOffline: Bool { self == .offline }
    }

    /// How long to wait before calling it offline.
    ///
    /// The manifest is a few kilobytes of JSON; anything slower than this is a captive portal or a
    /// dead connection, and both are better reported than waited on. `OpeningDownloader` uses a
    /// longer budget because it streams hundreds of games.
    static let timeout: TimeInterval = 15

    /// Pull the catalogue.
    ///
    /// Cancellation is the caller's: leaving the screen tears the `Task` down, and a cancelled fetch
    /// says nothing rather than reporting a failure the user did not cause.
    public static func videos() async throws -> [VideoLibrary.Video] {
        guard isConfigured else { throw Failure.notConfigured }
        guard let url = URL(string: manifestURL) else { throw Failure.notConfigured }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        // A manifest is republished whenever the admin panel changes, and a stale one is a
        // catalogue missing the video somebody just added. Revalidating costs one round trip on a
        // screen that is already making one.
        request.cachePolicy = .reloadRevalidatingCacheData

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            // Every transport error is reported as offline, deliberately. A DNS failure, a timeout
            // and a refused connection are the same thing to somebody holding a phone, and the
            // action is the same: check your connection.
            throw Failure.offline
        }

        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw Failure.unreadable
        }

        let videos = VideoLibrary.parse(data)
        // An EMPTY catalogue is not a failure — a published manifest with no rows is exactly what
        // the list's "No Videos Yet" state is for. Only bytes that were not a catalogue at all are.
        guard !videos.isEmpty || looksLikeCatalogue(data) else { throw Failure.unreadable }
        return videos
    }

    /// Did the server hand back something shaped like a manifest, even an empty one?
    ///
    /// Distinguishes "no videos published" from "the bucket returned an HTML 404 page", which
    /// otherwise both parse to zero videos and would tell the user the same wrong thing.
    static func looksLikeCatalogue(_ data: Data) -> Bool {
        guard let root = try? JSONSerialization.jsonObject(with: data) else { return false }
        if root is [Any] { return true }
        if let object = root as? [String: Any] { return object["videos"] is [Any] }
        return false
    }
}
