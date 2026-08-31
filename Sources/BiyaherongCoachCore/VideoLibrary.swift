import Foundation

/// The Tutorial Videos catalogue: what a video is, and how the list is grouped.
///
/// Foundation only, and no transport — this parses bytes somebody else fetched, exactly as
/// `OpeningDownload` describes a request it never makes. The fetch lives in
/// `BiyaherongUI/ContentClient.swift`, which spec §0.1 names as one of the two files allowed to
/// open a connection.
///
/// ## Where the bytes come from
///
/// A JSON manifest, fetched from Laravel's public `/api/content/tutorial-videos`. The RN app reads
/// the same rows from `GET /api/tutorial-videos` behind a Sanctum token; this app has no account
/// and no token by design, so Laravel publishes the catalogue a second time with no auth at all,
/// off the same query — one controller, two doors, one shelf.
///
/// Spec §0.1 asked for a static file on a bucket instead. `tools/content/generate_video_manifest.php`
/// still writes one and this parser accepts either; the deviation is in `PORTING_NOTES.md`.
///
/// See `docs/tutorial-videos.md`.
public enum VideoLibrary {

    // MARK: - A video

    public struct Video: Equatable, Sendable, Identifiable {
        public let id: Int
        public let title: String
        public let description: String?
        /// Already normalised — never nil, never empty. See `categoryKey`.
        public let category: String
        public let videoURL: String
        public let thumbnailURL: String?
        /// The server's own timestamp string, kept verbatim. Formatting is a UI concern and a
        /// `Date` round-trip here would invent a timezone the manifest never stated.
        public let createdAt: String

        public init(id: Int, title: String, description: String?, category: String,
                    videoURL: String, thumbnailURL: String?, createdAt: String) {
            self.id = id; self.title = title; self.description = description
            self.category = category; self.videoURL = videoURL
            self.thumbnailURL = thumbnailURL; self.createdAt = createdAt
        }
    }

    public struct Section: Equatable, Sendable, Identifiable {
        public let title: String
        public let videos: [Video]
        public var id: String { title }

        public init(title: String, videos: [Video]) {
            self.title = title; self.videos = videos
        }
    }

    // MARK: - Categories

    /// The order the sections appear in, from `tutorial-videos/index.tsx:28`.
    public static let categoryOrder = ["Opening", "Middlegame", "Endgame", "General", "Uncategorized"]

    /// Where a video with no category — or one nobody planned for — ends up.
    public static let uncategorized = "Uncategorized"

    /// Normalise a raw category into one of `categoryOrder`.
    ///
    /// **DEVIATION, deliberate.** The RN builds its sections as
    /// `CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0)`, so a video whose category is not in
    /// that list — `"Tactics"`, a typo, a category added in the admin panel later — is grouped and
    /// then silently dropped. It never appears anywhere, and nothing says so: the admin sees the
    /// video saved and visible, and the app shows a catalogue missing it.
    ///
    /// Folding the unknown into `Uncategorized` means a mis-categorised video is in the wrong
    /// section rather than in none. `PORTING_NOTES.md` records it.
    public static func categoryKey(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return uncategorized }
        return categoryOrder.contains(trimmed) ? trimmed : uncategorized
    }

    // MARK: - Parsing

    /// Read the manifest.
    ///
    /// Accepts either `{"videos": [...]}` — the shape `TutorialVideoController@index` returns and
    /// the manifest copies — or a bare `[...]`, because a hand-published file is very likely to be
    /// the array on its own and refusing it would be pedantry with a blank screen attached.
    ///
    /// A row is skipped when it has no usable `id`, `title` or `video_url`. **A card that cannot
    /// play is worse than a card that is not there**: it looks like the feature is broken rather
    /// than like the catalogue is short. Skipping is silent by design — a malformed row is the
    /// publisher's problem, and `generate_video_manifest.php` is what stops one being published.
    public static func parse(_ data: Data) -> [Video] {
        guard let root = try? JSONSerialization.jsonObject(with: data) else { return [] }
        let rows: [Any]
        if let object = root as? [String: Any], let list = object["videos"] as? [Any] {
            rows = list
        } else if let list = root as? [Any] {
            rows = list
        } else {
            return []
        }

        var out: [Video] = []
        for case let row as [String: Any] in rows {
            guard let id = intValue(row["id"]) else { continue }
            let title = stringValue(row["title"]) ?? ""
            guard !title.isEmpty else { continue }
            guard let videoURL = stringValue(row["video_url"]), !videoURL.isEmpty else { continue }

            out.append(Video(id: id,
                             title: title,
                             description: stringValue(row["description"]),
                             category: categoryKey(stringValue(row["category"])),
                             videoURL: videoURL,
                             thumbnailURL: stringValue(row["thumbnail_url"]),
                             createdAt: stringValue(row["created_at"]) ?? ""))
        }
        return out
    }

    /// Group into sections, in `categoryOrder`, dropping the empty ones.
    ///
    /// Order WITHIN a section is the manifest's own — `sort_order`, then newest first, which is what
    /// `TutorialVideoController@index` emits. Re-sorting here would quietly overrule whoever set
    /// `sort_order` in the admin panel.
    public static func sections(_ videos: [Video]) -> [Section] {
        categoryOrder.compactMap { category in
            let matching = videos.filter { $0.category == category }
            return matching.isEmpty ? nil : Section(title: category, videos: matching)
        }
    }

    // MARK: - Tolerant readers
    //
    // A manifest is published by hand or by a script that may change; `1` and `"1"` are the same id
    // and a JSON `null` is not a description.

    static func stringValue(_ any: Any?) -> String? {
        if let s = any as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        if let n = any as? NSNumber { return n.stringValue }
        return nil
    }

    static func intValue(_ any: Any?) -> Int? {
        if let i = any as? Int { return i }
        if let n = any as? NSNumber { return n.intValue }
        if let s = any as? String { return Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }
}
