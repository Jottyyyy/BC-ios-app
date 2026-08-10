import Foundation
import BiyaherongCoachCore

/// Loads the bundled ECO book off disk and hands `OpeningBook` the text.
///
/// `OpeningBook` is file-IO-free on purpose: giving Core a resource would create a `Bundle.module`
/// in a manifest nobody on this checkout can compile-verify. So the read lives here, in the module
/// that already owns every other bundled resource.
///
/// The lookup form is the one `Diagnostics.swift:37-45` already uses — `subdirectory: "ECO"` is
/// mandatory, because every resource in this package is declared `.copy` (folder structure kept
/// verbatim) rather than `.process` (flattened).
enum OpeningBookLoader {
    /// Built once, on first use. ~700 KB of TSV parses in a few milliseconds.
    ///
    /// A missing file yields an EMPTY book rather than a crash: without it the analysis board simply
    /// never names an opening, which is the same silent-degradation mode `Diagnostics` warns about.
    /// Run `BIYA_DIAG=1` to see that warning.
    static let shared: OpeningBook = {
        guard let url = Bundle.module.url(forResource: "eco", withExtension: "tsv",
                                          subdirectory: "ECO"),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            return OpeningBook(tsv: "")
        }
        return OpeningBook(tsv: text)
    }()
}
