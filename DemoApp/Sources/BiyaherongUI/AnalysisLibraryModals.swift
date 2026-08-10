import SwiftUI
import BiyaherongCoachCore

// The save form and the saved-game library, as bottom sheets — the shape every modal in the source
// uses (`bottomModalOverlay` / `bottomModalContent`).
//
// Overlays rather than `.sheet`: this module has none anywhere, and `.fullScreenCover` does not
// exist on macOS. `PromotionOverlay` set the precedent and `AnalysisReviewModal` followed it.
//
// Every number comes from `AnalysisLibraryStyle`, which is pinned to the extracted StyleSheet.

/// The mutable state of the save form. A plain value type so the VM owns it and the view is a pure
/// function of it — the same split every other band on this screen uses.
struct AnalysisSaveFields: Equatable {
    var title = ""
    var notes = ""
    var folderID: Int?
    var result = "*"
    var whitePlayer = ""
    var blackPlayer = ""
    var whiteRating = ""
    var blackRating = ""
    var eventName = ""
    var gameDate = ""
    var timeControl = ""
    var location = ""
    var roundInfo = ""
    var eco = ""

    /// What `AnalysisStore.save` wants. The PGN and starting position come from the caller, because
    /// only it has the tree.
    func storeFields(id: Int?, pgn: String, initialFEN: String) -> AnalysisStore.SaveFields {
        AnalysisStore.SaveFields(
            id: id, pgn: pgn, initialFEN: initialFEN, title: title, notes: notes,
            folderID: folderID, result: result,
            whitePlayer: whitePlayer, blackPlayer: blackPlayer,
            whiteRating: whiteRating, blackRating: blackRating,
            eventName: eventName, gameDate: gameDate, timeControl: timeControl,
            location: location, roundInfo: roundInfo, eco: eco)
    }

    /// The reverse, for reopening a saved game.
    static func from(_ rec: AnalysisSessionRecord) -> AnalysisSaveFields {
        var f = AnalysisSaveFields()
        f.title = rec.title
        f.notes = rec.notes ?? ""
        f.folderID = rec.folderID
        f.result = rec.result ?? "*"
        f.whitePlayer = rec.whitePlayer ?? ""
        f.blackPlayer = rec.blackPlayer ?? ""
        f.whiteRating = rec.whiteRating.map(String.init) ?? ""
        f.blackRating = rec.blackRating.map(String.init) ?? ""
        f.eventName = rec.eventName ?? ""
        f.gameDate = rec.gameDate ?? ""
        f.timeControl = rec.timeControl ?? ""
        f.location = rec.location ?? ""
        f.roundInfo = rec.roundInfo ?? ""
        f.eco = rec.eco ?? ""
        return f
    }
}

/// A bottom sheet: scrim, rounded card pinned to the bottom, header with a close button.
struct AnalysisBottomSheet<Content: View>: View {
    let title: String
    let onClose: () -> Void
    @ViewBuilder var content: Content

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                AnalysisLibraryStyle.scrim.onTapGesture { onClose() }
                VStack(spacing: 0) {
                    HStack {
                        Text(title)
                            .font(Theme.nunito(AnalysisLibraryStyle.titleSize, .bold))
                            .foregroundStyle(AnalysisPalette.textPrimary)
                        Spacer(minLength: 0)
                        Button(action: onClose) {
                            Text("✕")
                                .font(Theme.nunito(AnalysisLibraryStyle.closeSize, .bold))
                                .foregroundStyle(AnalysisPalette.gold)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.bottom, AnalysisLibraryStyle.headerGap)
                    content
                }
                .padding(AnalysisLibraryStyle.sheetPadding)
                .frame(maxWidth: .infinity)
                .frame(maxHeight: AnalysisLibraryStyle.sheetMaxHeight(viewportHeight: geo.size.height))
                .background(AnalysisLibraryStyle.sheetBg,
                            in: UnevenRoundedRectangle(
                                topLeadingRadius: AnalysisLibraryStyle.sheetRadius,
                                topTrailingRadius: AnalysisLibraryStyle.sheetRadius))
            }
        }
    }
}

// MARK: - The save form

struct AnalysisSaveSheet: View {
    @Binding var fields: AnalysisSaveFields
    let folders: [AnalysisFolderRecord]
    let moveCount: Int
    let isUpdate: Bool
    let onCreateFolder: (String) -> Void
    let onSave: () -> Void
    let onClose: () -> Void

    @State private var newFolderName = ""

    var body: some View {
        AnalysisBottomSheet(title: "Game Details", onClose: onClose) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    input("Title", $fields.title)
                    HStack(spacing: AnalysisLibraryStyle.fieldGap) {
                        input("White player", $fields.whitePlayer)
                        input("Rating", $fields.whiteRating).frame(width: AnalysisLibraryStyle.ratingWidth)
                    }
                    HStack(spacing: AnalysisLibraryStyle.fieldGap) {
                        input("Black player", $fields.blackPlayer)
                        input("Rating", $fields.blackRating).frame(width: AnalysisLibraryStyle.ratingWidth)
                    }
                    resultPicker
                    input("Event", $fields.eventName)
                    HStack(spacing: AnalysisLibraryStyle.fieldGap) {
                        input("Time control", $fields.timeControl)
                        input("Round", $fields.roundInfo)
                    }
                    HStack(spacing: AnalysisLibraryStyle.fieldGap) {
                        input("Location", $fields.location)
                        input("ECO", $fields.eco)
                    }
                    input("Date (YYYY-MM-DD)", $fields.gameDate)
                    folderPicker
                    input("Notes", $fields.notes)
                        .frame(minHeight: AnalysisLibraryStyle.notesMinHeight, alignment: .top)
                    Text(moveCount == 1 ? "1 move" : "\(moveCount) moves")
                        .font(Theme.nunito(AnalysisLibraryStyle.resultSize))
                        .foregroundStyle(AnalysisPalette.textMuted)
                        .padding(.vertical, AnalysisLibraryStyle.headerGap)
                }
            }
            footer
        }
    }

    private func input(_ placeholder: String, _ binding: Binding<String>) -> some View {
        TextField(placeholder, text: binding)
            .textFieldStyle(.plain)
            .font(Theme.nunito(AnalysisLibraryStyle.fieldSize))
            .foregroundStyle(AnalysisPalette.textPrimary)
            .padding(.horizontal, AnalysisLibraryStyle.fieldPaddingH)
            .padding(.vertical, AnalysisLibraryStyle.fieldPaddingV)
            .background(AnalysisLibraryStyle.fieldBg,
                        in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.fieldRadius))
            .padding(.bottom, AnalysisLibraryStyle.fieldGap)
    }

    private var resultPicker: some View {
        HStack(spacing: AnalysisLibraryStyle.resultGap) {
            ForEach(AnalysisLibraryStyle.resultOptions, id: \.self) { r in
                Button { fields.result = r } label: {
                    Text(AnalysisLibraryStyle.resultLabel(r))
                        .font(Theme.nunito(AnalysisLibraryStyle.resultSize, .bold))
                        .foregroundStyle(fields.result == r
                                         ? AnalysisPalette.onGold : AnalysisLibraryStyle.resultIdle)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, AnalysisLibraryStyle.resultPaddingV)
                        .background(fields.result == r
                                    ? AnalysisPalette.gold : AnalysisLibraryStyle.fieldBg,
                                    in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.resultRadius))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, AnalysisLibraryStyle.resultMarginTop)
        .padding(.bottom, AnalysisLibraryStyle.resultMarginBottom)
    }

    private var folderPicker: some View {
        VStack(alignment: .leading, spacing: AnalysisLibraryStyle.headerGap) {
            Text("Folder")
                .font(Theme.nunito(AnalysisLibraryStyle.resultSize, .bold))
                .foregroundStyle(AnalysisPalette.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AnalysisLibraryStyle.chipGap) {
                    chip("None", selected: fields.folderID == nil) { fields.folderID = nil }
                    ForEach(folders) { f in
                        chip(f.name, selected: fields.folderID == f.id) { fields.folderID = f.id }
                    }
                }
            }
            HStack(spacing: AnalysisLibraryStyle.fieldGap) {
                input("New folder", $newFolderName)
                Button {
                    onCreateFolder(newFolderName)
                    newFolderName = ""
                } label: {
                    Text("Add")
                        .font(Theme.nunito(AnalysisLibraryStyle.chipSize, .bold))
                        .foregroundStyle(AnalysisPalette.gold)
                        .padding(.horizontal, AnalysisLibraryStyle.chipPaddingH)
                        .padding(.vertical, AnalysisLibraryStyle.chipPaddingV)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, AnalysisLibraryStyle.fieldGap)
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisLibraryStyle.chipSize, .bold))
                .foregroundStyle(selected ? AnalysisPalette.onGold : AnalysisLibraryStyle.chipIdle)
                .padding(.horizontal, AnalysisLibraryStyle.chipPaddingH)
                .padding(.vertical, AnalysisLibraryStyle.chipPaddingV)
                .background(selected ? AnalysisPalette.gold : AnalysisLibraryStyle.fieldBg,
                            in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.chipRadius))
        }
        .buttonStyle(.plain)
    }

    private var footer: some View {
        HStack(spacing: AnalysisLibraryStyle.buttonGap) {
            Button(action: onClose) {
                Text("Cancel")
                    .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .extraBold))
                    .foregroundStyle(AnalysisPalette.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                    .background(AnalysisLibraryStyle.cancelBg,
                                in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
            }
            .buttonStyle(.plain)
            Button(action: onSave) {
                Text(isUpdate ? "Update" : "Save")
                    .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .extraBold))
                    .foregroundStyle(AnalysisPalette.textPrimary)
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

// MARK: - The library

struct AnalysisLibrarySheet: View {
    let rows: [AnalysisSessionRecord]
    let folders: [AnalysisFolderRecord]
    let unfiledCount: Int
    let countFor: (Int) -> Int
    let folderName: (Int) -> String?
    @Binding var filter: AnalysisStore.Filter
    @Binding var search: String
    let onOpen: (Int) -> Void
    let onDelete: (Int) -> Void
    let onDeleteFolder: (Int) -> Void
    let onClose: () -> Void

    var body: some View {
        AnalysisBottomSheet(title: "📂 Saved Analyses", onClose: onClose) {
            TextField("Search title, notes or players", text: $search)
                .textFieldStyle(.plain)
                .font(Theme.nunito(AnalysisLibraryStyle.fieldSize))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .padding(.horizontal, AnalysisLibraryStyle.fieldPaddingH)
                .padding(.vertical, AnalysisLibraryStyle.fieldPaddingV)
                .background(AnalysisLibraryStyle.fieldBg,
                            in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.fieldRadius))
                .padding(.bottom, AnalysisLibraryStyle.fieldGap)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AnalysisLibraryStyle.chipGap) {
                    chip("All", selected: filter == .all) { filter = .all }
                    chip("Unfiled (\(unfiledCount))", selected: filter == .unfiled) { filter = .unfiled }
                    ForEach(folders) { f in
                        chip("📁 \(f.name) (\(countFor(f.id)))", selected: filter == .folder(f.id)) {
                            filter = .folder(f.id)
                        }
                        // A default folder cannot be deleted, so it gets no gesture at all.
                        .simultaneousGesture(LongPressGesture(
                            minimumDuration: Double(AnalysisTiming.longPressDelayMs) / 1000)
                            .onEnded { _ in if !f.isDefault { onDeleteFolder(f.id) } })
                    }
                }
            }
            .padding(.bottom, AnalysisLibraryStyle.fieldGap)

            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    if rows.isEmpty {
                        Text(search.isEmpty ? "No saved analyses yet." : "Nothing matches that search.")
                            .font(Theme.nunito(AnalysisLibraryStyle.resultSize))
                            .foregroundStyle(AnalysisPalette.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, AnalysisLibraryStyle.cardGap)
                    }
                    ForEach(rows) { rec in
                        row(rec)
                    }
                }
            }
        }
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisLibraryStyle.chipSize, .bold))
                .foregroundStyle(selected ? AnalysisPalette.onGold : AnalysisLibraryStyle.chipIdle)
                .padding(.horizontal, AnalysisLibraryStyle.chipPaddingH)
                .padding(.vertical, AnalysisLibraryStyle.chipPaddingV)
                .background(selected ? AnalysisPalette.gold : AnalysisLibraryStyle.fieldBg,
                            in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.chipRadius))
        }
        .buttonStyle(.plain)
    }

    private func row(_ rec: AnalysisSessionRecord) -> some View {
        HStack(spacing: AnalysisLibraryStyle.cardGap) {
            Button { onOpen(rec.id) } label: {
                VStack(alignment: .leading, spacing: 0) {
                    Text(AnalysisLibraryStyle.primaryLine(rec))
                        .font(Theme.nunito(AnalysisLibraryStyle.primarySize, .bold))
                        .foregroundStyle(AnalysisPalette.textPrimary)
                        .lineLimit(AnalysisLayout.singleLine)
                        .padding(.bottom, AnalysisLibraryStyle.primaryGap)
                    Text(AnalysisLibraryStyle.pgnPreview(rec.pgn))
                        .font(AnalysisType.mono(AnalysisLibraryStyle.pgnSize))
                        .foregroundStyle(AnalysisLibraryStyle.pgnColor)
                        .lineLimit(AnalysisLayout.singleLine)
                    Text(metaLine(rec))
                        .font(Theme.nunito(AnalysisLibraryStyle.metaSize))
                        .foregroundStyle(AnalysisLibraryStyle.metaColor)
                        .lineLimit(AnalysisLayout.singleLine)
                        .padding(.top, AnalysisLibraryStyle.metaGap)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            Button { onDelete(rec.id) } label: {
                Text("🗑️")
                    .frame(width: AnalysisLibraryStyle.actionSize,
                           height: AnalysisLibraryStyle.actionSize)
                    .background(AnalysisLibraryStyle.actionBg,
                                in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.actionRadius))
            }
            .buttonStyle(.plain)
        }
        .padding(AnalysisLibraryStyle.cardPadding)
        .background(AnalysisLibraryStyle.cardBg,
                    in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.cardRadius))
        .padding(.bottom, AnalysisLibraryStyle.cardGap)
    }

    private func metaLine(_ rec: AnalysisSessionRecord) -> String {
        var bits: [String] = []
        if let r = rec.result { bits.append(r) }
        if let e = rec.eco { bits.append(e) }
        if let fid = rec.folderID, let n = folderName(fid) { bits.append("📁 \(n)") }
        return bits.joined(separator: " · ")
    }
}
