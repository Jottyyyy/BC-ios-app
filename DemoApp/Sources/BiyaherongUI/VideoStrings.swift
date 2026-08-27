import Foundation

/// Every word the Tutorial Videos screens say.
///
/// Hand-written in both languages and pinned by `tools/qa/replay_videos.js`, unlike
/// `VideoMetrics.swift` which is generated: the RN keeps its copy inline in JSX rather than in a
/// table, so there is nothing to extract from, and this app has to say things the RN never had to.
///
/// The RN screen assumes a server is reachable, because it only ever ran with one. This one can be
/// in Airplane Mode, so it has words for that — and it has to say them without making the user feel
/// the app is broken.
public enum VideoStrings {

    // MARK: - Chrome, verbatim from `tutorial-videos/index.tsx`

    public static let title = "Tutorial Videos"
    public static let loading = "Loading videos..."
    public static let emptyGlyph = "\u{1F3AC}"                    // 🎬
    public static let emptyTitle = "No Videos Yet"
    public static let emptySub = "Tutorial videos will appear here once available."
    public static let playGlyph = "\u{25B6}"                      // ▶

    /// `12 videos` / `1 video`. The RN inlines the same ternary at `index.tsx:180`.
    public static func count(_ n: Int) -> String {
        "\(n) " + (n == 1 ? "video" : "videos")
    }

    // MARK: - The paywall, verbatim

    public static let lockGlyph = "\u{1F512}"                     // 🔒
    public static let paywallLabel = "Premium Feature"
    public static let paywallMessage = "Mag-subscribe muna para ma-access ang tutorial videos."
    public static let paywallSubtext = "Unlock unlimited videos, puzzles, at coach chats."
    public static let subscribe = "Subscribe Now"

    // MARK: - Being offline, which the RN never had to describe

    public static let onlineGlyph = "\u{1F4F6}"                   // 📶
    public static let onlineTitle = "Online Feature"

    /// Shown when the screen is opened with no connection.
    ///
    /// Taglish, matching the paywall copy above — that is the voice this feature already speaks in,
    /// and switching to English for the error would read as a different app.
    public static let offlineBody = "Kailangan ng internet para mapanood ang tutorial videos."
    public static let offlineSub = "Mag-connect sa wifi o data, tapos subukan ulit."

    /// The standing note, shown even when the videos loaded.
    ///
    /// The rest of this app works in Airplane Mode, so a screen that quietly needs a connection is
    /// a surprise. Saying so once, on the list, is cheaper than the user finding out on a plane.
    public static let onlineNote = "Kailangan ng internet — nagsi-stream ang mga video na ito."

    public static let retry = "Try Again"

    // MARK: - Failures the user can act on

    public static let errorTitle = "Could not load videos"
    public static let errorBody = "Check your connection and try again."

    /// The catalogue has no address yet.
    ///
    /// Spec §0.1 reads the list from a published manifest on the content bucket, and nobody has
    /// published one — `AWS_BUCKET` is empty in the Laravel `.env` and `tutorial_videos` has no rows.
    /// This is deliberately NOT phrased as a connection problem: telling a user to check their wifi
    /// when the app has nowhere to look would send them to fix the one thing that is working.
    public static let notConfiguredTitle = "Videos are not published yet"
    public static let notConfiguredBody =
        "The catalogue has not been set up. Please check back after the next update."
}
