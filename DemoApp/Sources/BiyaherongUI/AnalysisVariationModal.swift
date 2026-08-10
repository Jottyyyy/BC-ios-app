import SwiftUI
import BiyaherongCoachCore

// The variation card (renderVariationModal:4357) — promote a line, or delete it.
//
// The source's third type, GM REFERENCE, is dropped: it keys off `node.isGmGame`, which only the
// Lichess masters explorer ever set, and that panel became the bundled ECO book in Phase 8.
// `AnalysisSession.VariationInfo` already carries the two remaining labels, so this view has no
// branching logic of its own beyond showing or hiding the promote row.
//
// The delete confirmation is a second state of the same sheet, exactly as `varDeleteConfirm` is in
// the source — Cancel returns to the card rather than dismissing.

struct AnalysisVariationModal: View {
    let info: AnalysisSession.VariationInfo
    let onPromote: () -> Void
    let onDelete: () -> Void
    let onClose: () -> Void

    @State private var confirmingDelete = false

    var body: some View {
        AnalysisBottomSheet(title: info.movePrefix + " " + info.san + info.nagText,
                            onClose: onClose) {
            VStack(alignment: .leading, spacing: 0) {
                typeBadge
                if confirmingDelete {
                    deleteConfirmation
                } else {
                    if info.canPromote {
                        actionRow(icon: "⭐",
                                  iconBg: AnalysisModals.varMainBg,
                                  title: "Set as Main Line",
                                  titleColor: AnalysisPalette.textPrimary,
                                  subtitle: "Promote this variation to the primary line",
                                  chevronColor: AnalysisPalette.textMuted,
                                  action: onPromote)
                    }
                    actionRow(icon: "🗑",
                              iconBg: AnalysisModals.varDeleteBg,
                              title: "Delete Branch",
                              titleColor: AnalysisModals.varDeleteColor,
                              subtitle: deleteSubtitle,
                              chevronColor: AnalysisModals.varDeleteColor,
                              action: { confirmingDelete = true })
                }
            }
        }
    }

    /// "Remove this move" reads wrong for a branch with continuations, and the count is the thing
    /// that makes the confirmation meaningful.
    private var deleteSubtitle: String {
        info.subtreeCount == 1
            ? "Remove this move"
            : "Remove this variation and all \(info.subtreeCount) of its moves"
    }

    private var typeBadge: some View {
        Text(info.typeLabel)
            .font(Theme.nunito(AnalysisType.annotationSection, .heavy))
            .tracking(AnalysisModals.sectionTracking)
            .foregroundStyle(info.isMainline ? AnalysisModals.varMainColor : AnalysisModals.varSubColor)
            .padding(.horizontal, AnalysisLibraryStyle.fieldGap)
            .padding(.vertical, AnalysisLibraryStyle.primaryGap)
            .background(info.isMainline ? AnalysisModals.varMainBg : AnalysisModals.varSubBg,
                        in: RoundedRectangle(cornerRadius: AnalysisModals.varIconRadius))
            .overlay {
                RoundedRectangle(cornerRadius: AnalysisModals.varIconRadius)
                    .strokeBorder(info.isMainline ? AnalysisModals.varMainColor : AnalysisModals.varSubColor,
                                  lineWidth: AnalysisEdit.boardBorder)
            }
            .padding(.bottom, AnalysisLibraryStyle.resultMarginBottom)
    }

    private func actionRow(icon: String, iconBg: Color, title: String, titleColor: Color,
                           subtitle: String, chevronColor: Color,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: AnalysisModals.varActionGap) {
                Text(icon)
                    .font(.system(size: AnalysisType.annotationPickerTitle))
                    .frame(width: AnalysisModals.varIconSize, height: AnalysisModals.varIconSize)
                    .background(iconBg, in: RoundedRectangle(cornerRadius: AnalysisModals.varIconRadius))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title)
                        .font(Theme.nunito(AnalysisModals.varTitleSize, .bold))
                        .foregroundStyle(titleColor)
                    Text(subtitle)
                        .font(Theme.nunito(AnalysisModals.varSubtitleSize, .regular))
                        .foregroundStyle(AnalysisPalette.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text("›")
                    .font(Theme.nunito(AnalysisType.annotationSymbol, .regular))
                    .foregroundStyle(chevronColor)
            }
            .padding(.vertical, AnalysisModals.varActionPaddingV)
            .padding(.horizontal, AnalysisLibraryStyle.primaryGap)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var deleteConfirmation: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("⚠️  Delete this branch?")
                .font(Theme.nunito(AnalysisModals.varTitleSize, .bold))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .padding(.bottom, AnalysisLibraryStyle.primaryGap)
            Text("This will permanently remove \(info.movePrefix) \(info.san) and all continuation "
                 + "moves. This cannot be undone.")
                .font(Theme.nunito(AnalysisModals.varSubtitleSize, .regular))
                .foregroundStyle(AnalysisPalette.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: AnalysisLibraryStyle.buttonGap) {
                Button { confirmingDelete = false } label: {
                    Text("Cancel")
                        .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                        .foregroundStyle(AnalysisPalette.textPrimary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                        .background(AnalysisLibraryStyle.cancelBg,
                                    in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                }
                .buttonStyle(.plain)
                Button(action: onDelete) {
                    Text("Delete")
                        .font(Theme.nunito(AnalysisLibraryStyle.buttonSize, .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, AnalysisLibraryStyle.buttonPaddingV)
                        .background(AnalysisModals.varDeleteColor,
                                    in: RoundedRectangle(cornerRadius: AnalysisLibraryStyle.buttonRadius))
                }
                .buttonStyle(.plain)
            }
            .padding(.top, AnalysisLibraryStyle.buttonMarginTop)
        }
    }
}

// MARK: - Autoplay speed (renderAutoplaySettings:4279)

struct AnalysisAutoplaySpeedSheet: View {
    let current: Int
    let onPick: (Int) -> Void
    let onClose: () -> Void

    var body: some View {
        AnalysisBottomSheet(title: "Autoplay Speed", onClose: onClose) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: AnalysisModals.btnW),
                                         spacing: AnalysisModals.gridGap)],
                      spacing: AnalysisModals.gridGap) {
                ForEach(AnalysisTables.autoplaySpeeds, id: \.value) { speed in
                    Button { onPick(speed.value) } label: {
                        Text(speed.label)
                            .font(Theme.nunito(AnalysisType.annotationSymbol, .black))
                            .foregroundStyle(speed.value == current
                                             ? AnalysisPalette.gold : AnalysisPalette.textSecondaryAlt)
                            .frame(width: AnalysisModals.btnW, height: AnalysisModals.btnH)
                            .background(AnalysisModals.btnBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisModals.btnRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, AnalysisModals.gridMarginBottom)
        }
    }
}
