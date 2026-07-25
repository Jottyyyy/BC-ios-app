import Foundation

/// Headless self-check for resource loading. Run the app with BIYA_DIAG=1 to print this and exit —
/// used to verify the bundled puzzle DB / fonts / sounds actually resolve inside a packaged app.
public func biyaherongDiagnostics() -> String {
    var out = "== Biyaherong diagnostics ==\n"
    out += "Bundle.main:   \(Bundle.main.bundlePath)\n"
    out += "Bundle.module: \(Bundle.module.bundlePath)\n"

    let modURL = Bundle.module.url(forResource: "puzzles", withExtension: "sqlite")
    out += "puzzles.sqlite via Bundle.module: \(modURL?.path ?? "NIL")\n"

    let located = PuzzleStore.locateDatabase()
    out += "puzzles.sqlite via locateDatabase(): \(located?.path ?? "NIL")\n"

    if let s = PuzzleStore() {
        out += "PuzzleStore: OPENED, count=\(s.count)\n"
    } else {
        out += "PuzzleStore: nil (open FAILED)\n"
    }

    let ttf = Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts")?.count ?? -1
    let webp = Bundle.module.urls(forResourcesWithExtension: "webp", subdirectory: "Characters")?.count ?? -1
    let mp3 = Bundle.module.urls(forResourcesWithExtension: "mp3", subdirectory: "Sounds")?.count ?? -1
    let svg = Bundle.module.urls(forResourcesWithExtension: "svg", subdirectory: "Pieces")?.count ?? -1
    out += "Fonts(ttf)=\(ttf)  Characters(webp)=\(webp)  Sounds(mp3)=\(mp3)  Pieces(svg)=\(svg)\n"
    if svg != 12 { out += "WARNING: expected 12 piece SVGs — boards will fall back to Unicode glyphs\n" }
    return out
}
