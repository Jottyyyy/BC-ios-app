import SwiftUI
import BiyaherongCoachCore

// The three form modals (spec 1.5). The two confirm dialogs reuse `PuzzleModal`; these need fields,
// so they are their own views over the same scrim.
//
// Twins of the modal builders in `web-demo/js/pairing-detail.js`.

/// The shared chrome: scrim, card, title, optional sub-title.
private struct PairingModalCard<Content: View>: View {
    let title: String
    let subtitle: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            PuzzleTurboRun.modalScrim.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(Theme.nunito(PairingDetail.modalTitleFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.modalTitleColor)
                    .frame(maxWidth: .infinity)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.nunito(PairingDetail.modalSubFontSize))
                        .foregroundStyle(PairingDetail.modalSubColor)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, PairingDetail.modalSubMarginBottom)
                }
                content()
            }
            .padding(PairingDetail.modalCardPadding)
            .background(PairingDetail.modalCardBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingDetail.modalCardBorderRadius))
            .padding(.horizontal, PairingDetail.tabsPaddingHorizontal)
        }
    }
}

private struct PairingModalField: View {
    let label: String
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased())
                .font(Theme.nunito(PairingDetail.modalLabelFontSize, .bold))
                .foregroundStyle(PairingDetail.modalLabelColor)
                .tracking(PairingDetail.modalLabelLetterSpacing)
                .padding(.top, PairingDetail.modalLabelMarginTop)
                .padding(.bottom, PairingDetail.modalLabelMarginBottom)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(Theme.nunito(PairingDetail.modalInputFontSize))
                .foregroundStyle(PairingDetail.modalInputColor)
                .padding(.horizontal, PairingDetail.modalInputPaddingHorizontal)
                .padding(.vertical, PairingDetail.modalInputPaddingVertical)
                .background(PairingDetail.modalInputBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.modalInputBorderRadius))
                .overlay(RoundedRectangle(cornerRadius: PairingDetail.modalInputBorderRadius)
                    .stroke(PairingDetail.modalInputBorderColor,
                            lineWidth: PairingDetail.modalInputBorderWidth))
        }
    }
}

private struct PairingModalActions: View {
    let confirmTitle: String
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        HStack(spacing: PairingDetail.modalActionsGap) {
            Button(action: onCancel) {
                Text(PairingStrings.cancel)
                    .font(Theme.nunito(PairingDetail.modalCancelTextFontSize, .bold))
                    .foregroundStyle(PairingDetail.modalCancelTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.modalCancelPaddingVertical)
                    .overlay(RoundedRectangle(cornerRadius: PairingDetail.modalCancelBorderRadius)
                        .stroke(PairingDetail.modalCancelBorderColor,
                                lineWidth: PairingDetail.modalCancelBorderWidth))
            }
            .buttonStyle(PuzzlePressStyle())
            Button(action: onConfirm) {
                Text(confirmTitle)
                    .font(Theme.nunito(PairingDetail.modalConfirmTextFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.modalConfirmTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.modalCancelPaddingVertical)
                    .background(PairingDetail.modalConfirmBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingDetail.modalCancelBorderRadius))
            }
            .buttonStyle(PuzzlePressStyle())
        }
        .padding(.top, PairingDetail.modalActionsMarginTop)
    }
}

struct PairingAddPlayerModal: View {
    let onCancel: () -> Void
    let onAdd: (String, String?, Int?) -> Void

    @State private var name = ""
    @State private var fullName = ""
    @State private var rating = ""

    var body: some View {
        PairingModalCard(title: PairingStrings.addPlayer, subtitle: nil) {
            PairingModalField(label: PairingStrings.nameRequired,
                              placeholder: PairingStrings.playerNamePlaceholder, text: $name)
            PairingModalField(label: PairingStrings.fullName,
                              placeholder: PairingStrings.optional, text: $fullName)
            PairingModalField(label: PairingStrings.ncfpRating,
                              placeholder: PairingStrings.optional, text: $rating)
            PairingModalActions(confirmTitle: PairingStrings.add,
                                onCancel: onCancel,
                                onConfirm: {
                                    onAdd(name, fullName.isEmpty ? nil : fullName, Int(rating))
                                })
        }
    }
}

struct PairingBulkAddModal: View {
    let onCancel: () -> Void
    let onAdd: (String) -> Void

    @State private var text = ""

    var body: some View {
        PairingModalCard(title: PairingStrings.bulkAddTitle,
                         subtitle: PairingStrings.bulkAddSub) {
            TextEditor(text: $text)
                .font(Theme.nunito(PairingDetail.modalInputFontSize))
                .foregroundStyle(PairingDetail.modalInputColor)
                .scrollContentBackground(.hidden)
                .frame(height: PairingLimits.bulkEditorHeight)
                .padding(.horizontal, PairingDetail.modalInputPaddingHorizontal)
                .padding(.vertical, PairingDetail.modalInputPaddingVertical)
                .background(PairingDetail.modalInputBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.modalInputBorderRadius))
            // The confirm label counts live, so what the parser made of a paste is visible before it
            // is committed.
            PairingModalActions(confirmTitle: PairingStrings.addNPlayers(
                                    PairingDocument.bulkCount(text)),
                                onCancel: onCancel,
                                onConfirm: { onAdd(text) })
        }
    }
}

struct PairingResultModal: View {
    let white: String
    let black: String
    let board: Int
    let canClear: Bool
    let onPick: (PairingDocument.Result) -> Void
    let onClear: () -> Void
    let onCancel: () -> Void

    var body: some View {
        PairingModalCard(title: PairingStrings.enterResult,
                         subtitle: PairingStrings.board(board)) {
            HStack(spacing: PairingDetail.resultPlayersGap) {
                Text(white)
                    .font(Theme.nunito(PairingDetail.resultPlayerWhiteFontSize, .bold))
                    .foregroundStyle(PairingDetail.resultPlayerWhiteColor)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Text(PairingStrings.vs)
                    .font(Theme.nunito(PairingDetail.resultVsFontSize, .semiBold))
                    .foregroundStyle(PairingDetail.resultVsColor)
                Text(black)
                    .font(Theme.nunito(PairingDetail.resultPlayerBlackFontSize, .bold))
                    .foregroundStyle(PairingDetail.resultPlayerBlackColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.bottom, PairingDetail.resultPlayersMarginBottom)

            outcome(PairingStrings.resultWhiteBig, PairingStrings.resultWhiteSub,
                    PairingDetail.resultBtnWhiteBackgroundColor,
                    PairingDetail.resultBtnTextDarkColor, .whiteWin)
            outcome(PairingStrings.resultDrawBig, PairingStrings.resultDrawSub,
                    PairingDetail.resultBtnDrawBackgroundColor,
                    PairingDetail.resultBtnTextLightColor, .draw)
            outcome(PairingStrings.resultBlackBig, PairingStrings.resultBlackSub,
                    PairingDetail.resultBtnBlackBackgroundColor,
                    PairingDetail.resultBtnTextLightColor, .blackWin)

            // The fourth option the RN app had no way to express (spec 1.5, 7 #23). Shown only when
            // there is something to clear.
            if canClear {
                Button(action: onClear) {
                    Text(PairingStrings.clearResult)
                        .font(Theme.nunito(PairingDetail.resultCancelTextFontSize, .bold))
                        .foregroundStyle(PairingDetail.removeBtnTextColor)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, PairingDetail.resultCancelBtnPaddingVertical)
                }
                .buttonStyle(PuzzlePressStyle())
            }
            Button(action: onCancel) {
                Text(PairingStrings.cancel)
                    .font(Theme.nunito(PairingDetail.resultCancelTextFontSize, .bold))
                    .foregroundStyle(PairingDetail.resultCancelTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.resultCancelBtnPaddingVertical)
            }
            .buttonStyle(PuzzlePressStyle())
            .padding(.top, PairingDetail.resultCancelBtnMarginTop)
        }
    }

    private func outcome(_ main: String, _ sub: String, _ fill: Color, _ tint: Color,
                         _ result: PairingDocument.Result) -> some View {
        Button { onPick(result) } label: {
            VStack(spacing: 0) {
                Text(main)
                    .font(Theme.nunito(PairingDetail.resultBtnTextDarkFontSize, .extraBold))
                    .foregroundStyle(tint)
                Text(sub)
                    .font(Theme.nunito(PairingDetail.resultBtnSubFontSize, .semiBold))
                    .foregroundStyle(PairingDetail.resultBtnSubColor)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, PairingDetail.resultBtnPaddingVertical)
            .background(fill, in: RoundedRectangle(cornerRadius: PairingDetail.resultBtnBorderRadius))
        }
        .buttonStyle(PuzzlePressStyle())
        .padding(.bottom, PairingDetail.resultButtonsGap)
    }
}
