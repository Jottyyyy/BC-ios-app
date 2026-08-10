import Foundation
import BiyaherongCoachCore

/// The only impure part of persistence: read and write `analysis-library.json`.
///
/// Everything that decides anything lives in `AnalysisStore`, which is pure and asserted by
/// ParityRunner. This is ten lines of I/O around it, deliberately — it is the one piece no harness
/// on this checkout can reach, so it should contain nothing worth testing.
///
/// The document is plain `Codable` JSON rather than SwiftData. That is what lets the browser mirror
/// store the same shape in `localStorage` and both languages assert one canonical document; a
/// `ModelContainer` would be unreachable from every harness in this repo.
enum AnalysisLibraryFile {

    /// `~/Library/Application Support/Biyaherong/analysis-library.json` on both platforms.
    /// Application Support rather than Documents: this is app state the user never browses.
    static var url: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Biyaherong", isDirectory: true)
        return dir.appendingPathComponent("analysis-library.json")
    }

    /// A missing or corrupt file yields an EMPTY library rather than throwing.
    ///
    /// Losing a library is bad; a screen that will not open at all is worse — and the same
    /// degradation is what `AnalysisStore.decode` does, so the two halves behave alike.
    static func load() -> AnalysisLibrary {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return AnalysisLibrary() }
        return AnalysisStore.decode(text)
    }

    /// Atomic: a crash mid-write leaves the previous document intact rather than a truncated one.
    @discardableResult
    static func save(_ library: AnalysisLibrary) -> Bool {
        let text = AnalysisStore.encode(library)
        guard let data = text.data(using: .utf8) else { return false }
        let target = url
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
