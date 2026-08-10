import SwiftUI
import BiyaherongCoachCore

// Setup Position (renderEditPositionPanel:3615).
//
// It takes over the panels band while it is open, and the source hides the status+toolbar row with
// it — `{!editMode && <View style={styles.statusToolbarRow}>` (board.tsx:4616), in its own words
// "to maximise board space". `AnalysisBoardScreen` does the same.
//
// The panel is a pure function of a `PositionEditor` plus a palette selection; every rule it
// enforces lives in Core and is asserted by the `position_editor` parity group. Every number comes
// from `AnalysisEdit`, pinned to the 28 `edit*` keys in board_styles.json.

struct AnalysisEditPanel: View {
    @Binding var editor: PositionEditor
    /// The palette selection: a piece key, `AnalysisEditPanel.eraser`, or nil.
    @Binding var selection: String?
    @Binding var fenInput: String
    let onApply: () -> Void
    let onLoadFEN: () -> Void

    static let eraser = "eraser"

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow
            palette(PositionEditor.whitePieceKeys, background: AnalysisEdit.lightSquare)
            palette(PositionEditor.blackPieceKeys, background: AnalysisEdit.darkSquare)
            actionsRow
            castlingSection
            if let issue = editor.firstIssueText {
                Text("⚠ " + issue)
                    .font(Theme.nunito(AnalysisEdit.errorSize, .semiBold))
                    .foregroundStyle(AnalysisEdit.errorColor)
                    .padding(.bottom, AnalysisEdit.titleRowGap)
            }
            applyButton
            fenRow
        }
        .padding(AnalysisEdit.panelPadding)
        .background(AnalysisEdit.panelBg,
                    in: RoundedRectangle(cornerRadius: AnalysisEdit.panelRadius))
    }

    private var titleRow: some View {
        HStack(spacing: 0) {
            Text("✏️ Setup Position")
                .font(Theme.nunito(AnalysisEdit.titleSize, .bold))
                .foregroundStyle(AnalysisEdit.titleColor)
            Spacer(minLength: 0)
            Text("Double-tap piece to remove")
                .font(Theme.nunito(AnalysisEdit.hintSize, .regular).italic())
                .foregroundStyle(AnalysisEdit.hintColor)
        }
        .padding(.bottom, AnalysisEdit.titleRowGap)
    }

    private func palette(_ keys: [String], background: Color) -> some View {
        HStack(spacing: AnalysisEdit.paletteGap) {
            ForEach(keys, id: \.self) { key in
                Button {
                    selection = (selection == key) ? nil : key
                } label: {
                    PieceGlyph(key: key, size: AnalysisEdit.piece)
                        .frame(width: AnalysisEdit.pieceButton, height: AnalysisEdit.pieceButton)
                        .background(selection == key ? AnalysisEdit.activeFill : background,
                                    in: RoundedRectangle(cornerRadius: AnalysisEdit.pieceButtonRadius))
                        .overlay {
                            RoundedRectangle(cornerRadius: AnalysisEdit.pieceButtonRadius)
                                .strokeBorder(selection == key ? AnalysisEdit.activeBorderColor : .clear,
                                              lineWidth: AnalysisEdit.activeBorder)
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, AnalysisEdit.paletteRowGap)
    }

    private var actionsRow: some View {
        HStack(spacing: AnalysisEdit.actionGap) {
            actionButton("🗑️ Erase",
                         background: selection == Self.eraser ? AnalysisEdit.eraseActiveBg : AnalysisEdit.actionBg,
                         foreground: selection == Self.eraser ? AnalysisEdit.eraseActiveText : AnalysisEdit.actionColor) {
                selection = (selection == Self.eraser) ? nil : Self.eraser
            }
            actionButton("🧹 Clear",
                         background: AnalysisEdit.actionBg,
                         foreground: AnalysisEdit.actionColor) {
                editor.clear()
            }
            actionButton(editor.sideToMove == .white ? "⬜ White" : "⬛ Black",
                         background: editor.sideToMove == .white ? AnalysisEdit.lightSquare : AnalysisEdit.turnDarkBg,
                         foreground: editor.sideToMove == .white ? AnalysisEdit.turnLightText : AnalysisEdit.turnDarkText) {
                editor.toggleSideToMove()
            }
        }
        .padding(.vertical, AnalysisEdit.paletteRowGap)
    }

    private func actionButton(_ label: String, background: Color, foreground: Color,
                              _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(label)
                .font(Theme.nunito(AnalysisEdit.actionSize, .bold))
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AnalysisEdit.actionPaddingV)
                .background(background, in: RoundedRectangle(cornerRadius: AnalysisEdit.actionRadius))
        }
        .buttonStyle(.plain)
    }

    private var castlingSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("CASTLING RIGHTS")
                .font(Theme.nunito(AnalysisEdit.castlingLabelSize, .bold))
                .tracking(AnalysisEdit.castlingTracking)
                .foregroundStyle(AnalysisEdit.castlingLabelColor)
                .padding(.bottom, AnalysisEdit.paletteRowGap)
            HStack(spacing: AnalysisEdit.castlingGap) {
                castlingChip("⬜K", isOn: editor.castleWK) { editor.castleWK.toggle() }
                castlingChip("⬜Q", isOn: editor.castleWQ) { editor.castleWQ.toggle() }
                castlingChip("⬛K", isOn: editor.castleBK) { editor.castleBK.toggle() }
                castlingChip("⬛Q", isOn: editor.castleBQ) { editor.castleBQ.toggle() }
            }
        }
        .padding(.vertical, AnalysisEdit.paletteRowGap)
    }

    private func castlingChip(_ label: String, isOn: Bool, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(label)
                .font(Theme.nunito(AnalysisEdit.castlingSize, .bold))
                .foregroundStyle(isOn ? AnalysisEdit.castlingOnColor : AnalysisEdit.castlingColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AnalysisEdit.castlingPaddingV)
                .background(isOn ? AnalysisEdit.castlingOnBg : AnalysisEdit.castlingBg,
                            in: RoundedRectangle(cornerRadius: AnalysisEdit.castlingRadius))
                .overlay {
                    RoundedRectangle(cornerRadius: AnalysisEdit.castlingRadius)
                        .strokeBorder(isOn ? AnalysisEdit.castlingOnBorder : .clear,
                                      lineWidth: AnalysisEdit.boardBorder)
                }
        }
        .buttonStyle(.plain)
    }

    private var applyButton: some View {
        Button(action: onApply) {
            Text("✓  Apply Position")
                .font(Theme.nunito(AnalysisEdit.doneSize, .heavy))
                .tracking(AnalysisEdit.doneTracking)
                .foregroundStyle(AnalysisEdit.doneColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AnalysisEdit.donePaddingV)
                .background(AnalysisEdit.doneBg,
                            in: RoundedRectangle(cornerRadius: AnalysisEdit.doneRadius))
        }
        .buttonStyle(.plain)
        .padding(.bottom, AnalysisEdit.actionGap)
    }

    private var fenRow: some View {
        HStack(spacing: AnalysisEdit.fenGap) {
            TextField("Paste FEN...", text: $fenInput)
                .textFieldStyle(.plain)
                .font(AnalysisType.mono(AnalysisEdit.fenSize))
                .foregroundStyle(AnalysisEdit.fenColor)
                .padding(.horizontal, AnalysisEdit.fenPaddingH)
                .padding(.vertical, AnalysisEdit.fenPaddingV)
                .background(AnalysisEdit.fenBg,
                            in: RoundedRectangle(cornerRadius: AnalysisEdit.fenRadius))
            Button(action: onLoadFEN) {
                Text("Load")
                    .font(Theme.nunito(AnalysisEdit.loadSize, .bold))
                    .foregroundStyle(AnalysisEdit.loadColor)
                    .padding(.horizontal, AnalysisEdit.loadPaddingH)
                    .padding(.vertical, AnalysisEdit.fenPaddingV)
                    .background(AnalysisEdit.fenBg,
                                in: RoundedRectangle(cornerRadius: AnalysisEdit.fenRadius))
                    .overlay {
                        RoundedRectangle(cornerRadius: AnalysisEdit.fenRadius)
                            .strokeBorder(AnalysisEdit.loadBorder, lineWidth: AnalysisEdit.boardBorder)
                    }
            }
            .buttonStyle(.plain)
        }
    }
}

/// One palette piece. Reuses `PieceImage`, so the palette shows the same bundled vector art the
/// board does — including its all-or-nothing Unicode fallback — rather than a second piece renderer.
private struct PieceGlyph: View {
    let key: String
    let size: CGFloat

    var body: some View {
        if let piece = PositionEditor.piece(forKey: key) {
            PieceImage(piece: piece, size: size, shadow: false)
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }
}
