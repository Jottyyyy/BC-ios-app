import SwiftUI
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Import PGN (renderPgnModal:3757) and its export counterpart.
//
// The source offers Paste (clipboard) and File (expo-document-picker). Here that is a text area
// plus `.fileImporter`, which is SwiftUI's own picker and needs no new dependency. NOTE for the
// first compile: `.fileImporter` has no precedent anywhere in this module, so it is the one genuinely
// new API surface Phase 11 introduces — see the CHANGELOG's likely-first-compile-errors list.
//
// Export replaces the source's `Share.share` OS sheet, which has no counterpart offline: the text is
// shown to copy, with `.fileExporter` for saving a .pgn. Same intent, recorded as a deviation.

/// A PGN file for `.fileExporter`. `UTType.pgn` does not exist, so it is declared here against the
/// same MIME the source's DocumentPicker asks for (`application/x-chess-pgn`).
struct PGNDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.plainText]
    static let writableContentTypes: [UTType] = [.plainText]

    var text: String

    init(text: String) { self.text = text }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let s = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = s
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}

struct AnalysisPgnImportSheet: View {
    @Binding var text: String
    let onLoad: () -> Void
    let onClose: () -> Void

    @State private var importing = false

    var body: some View {
        AnalysisBottomSheet(title: "📋 Import PGN", onClose: onClose) {
            VStack(spacing: 0) {
                editor
                HStack(spacing: AnalysisLibraryStyle.buttonGap) {
                    Button { importing = true } label: {
                        Text("📁 File")
                            .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                            .foregroundStyle(AnalysisPalette.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                            .background(AnalysisLibraryStyle.cancelBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                    }
                    .buttonStyle(.plain)
                    Button(action: onLoad) {
                        Text("▶ Load PGN")
                            .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                            .background(AnalysisLibraryStyle.saveBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, AnalysisLibraryStyle.buttonMarginTop)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.plainText]) { result in
            guard case .success(let url) = result else { return }
            // Sandboxed on iOS: the URL has to be opened for access before it can be read.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let contents = try? String(contentsOf: url, encoding: .utf8) { text = contents }
        }
    }

    private var editor: some View {
        TextEditor(text: $text)
            .font(AnalysisType.mono(AnalysisModals.pgnInputSize))
            .foregroundStyle(AnalysisModals.pgnInputColor)
            .scrollContentBackground(.hidden)
            .padding(AnalysisModals.pgnInputPadding)
            .frame(minHeight: AnalysisModals.pgnInputMinHeight,
                   maxHeight: AnalysisModals.pgnInputMaxHeight)
            .background(AnalysisModals.pgnInputBg,
                        in: RoundedRectangle(cornerRadius: AnalysisModals.pgnInputRadius))
    }
}

struct AnalysisPgnExportSheet: View {
    let text: String
    let suggestedName: String
    let onClose: () -> Void

    @State private var exporting = false

    var body: some View {
        AnalysisBottomSheet(title: "📤 Export PGN", onClose: onClose) {
            VStack(spacing: 0) {
                ScrollView(.vertical, showsIndicators: false) {
                    Text(text)
                        .font(AnalysisType.mono(AnalysisModals.pgnInputSize))
                        .foregroundStyle(AnalysisModals.pgnInputColor)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(AnalysisModals.pgnInputPadding)
                }
                .frame(minHeight: AnalysisModals.pgnInputMinHeight,
                       maxHeight: AnalysisModals.pgnInputMaxHeight)
                .background(AnalysisModals.pgnInputBg,
                            in: RoundedRectangle(cornerRadius: AnalysisModals.pgnInputRadius))

                HStack(spacing: AnalysisLibraryStyle.buttonGap) {
                    Button {
                        Clipboard.copy(text)
                    } label: {
                        Text("📋 Copy")
                            .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                            .foregroundStyle(AnalysisPalette.textPrimary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                            .background(AnalysisLibraryStyle.cancelBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                    }
                    .buttonStyle(.plain)
                    Button { exporting = true } label: {
                        Text("⬇ Save .pgn")
                            .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                            .background(AnalysisLibraryStyle.saveBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, AnalysisLibraryStyle.buttonMarginTop)
            }
        }
        .fileExporter(isPresented: $exporting,
                      document: PGNDocument(text: text),
                      contentType: .plainText,
                      defaultFilename: suggestedName) { _ in }
    }
}

/// One clipboard call, two platforms. UIKit and AppKit disagree on the API and this module has to
/// build on both, so the `#if` lives here rather than at the call sites.
enum Clipboard {
    static func copy(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
