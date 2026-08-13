import SwiftUI
import BiyaherongCoachCore

// MARK: - ⚙️ Engine (☰ > Engine)
//
// INVENTED: nothing in the RN source has this screen, which shipped fixed search limits. Built on
// the same `AnalysisBottomSheet` as every other sheet in this ☰ section so there is one idiom.
//
// **Nothing here decides anything.** Which rows exist, what each says, which is selected, which
// controls Advanced shows and what range each one has all come from `EngineSettings.panelModel`,
// which is pure, asserted in Node, and shared with the browser twin — the only way the two panels
// can be the same panel on a checkout with no Swift compiler and no browser.
//
// NO NUMERIC LITERAL AND NO ARITHMETIC IN ANY VIEW BODY (AnalysisBoardScreen.swift:16-18): every
// number is `AnalysisEngineStyle` or comes out of the model. (`AnalysisEnginePanel` is taken — that
// is the engine-LINES band on the board itself.)

struct AnalysisEngineSettingsSheet: View {
    let model: EngineSettings.PanelModel
    let onPickPreset: (String) -> Void
    let onSetControl: (String, Int) -> Void
    let onToggleAdvanced: () -> Void
    let onClose: () -> Void

    var body: some View {
        AnalysisBottomSheet(title: model.title, onClose: onClose) {
            VStack(alignment: .leading, spacing: AnalysisEngineStyle.rowGap) {
                ForEach(model.presets) { row in
                    presetRow(row)
                }

                if let warning = model.warning {
                    Text(warningText(warning))
                        .font(Theme.nunito(AnalysisEngineStyle.warningSize))
                        .foregroundStyle(AnalysisPalette.gold)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, AnalysisEngineStyle.warningGap)
                }

                Button(action: onToggleAdvanced) {
                    HStack {
                        Text(disclosure)
                            .font(Theme.nunito(AnalysisEngineStyle.advancedLabelSize, .bold))
                            .foregroundStyle(AnalysisPalette.textSecondaryAlt)
                        Spacer()
                        Text(model.advancedState)
                            .font(Theme.nunito(AnalysisEngineStyle.advancedValueSize, .bold))
                            .foregroundStyle(AnalysisPalette.gold)
                    }
                }
                .buttonStyle(.plain)
                .padding(.top, AnalysisEngineStyle.sectionGap)

                if model.advancedOpen {
                    ForEach(model.controls) { control in
                        controlRow(control)
                    }
                }
            }
        }
    }

    /// `"▾ Advanced"` / `"▸ Advanced"`. Built here rather than in the model: it is a disclosure
    /// glyph, which is presentation, where the label beside it is copy.
    private var disclosure: String {
        (model.advancedOpen ? "▾ " : "▸ ") + model.advancedLabel
    }

    private func warningText(_ s: String) -> String { "⚠ " + s }

    // MARK: Preset row

    @ViewBuilder
    private func presetRow(_ row: EngineSettings.PresetRow) -> some View {
        Button { onPickPreset(row.id) } label: {
            HStack(spacing: AnalysisEngineStyle.dotInset) {
                Circle()
                    .strokeBorder(row.active ? AnalysisPalette.gold : AnalysisPalette.textMuted,
                                  lineWidth: AnalysisEngineStyle.selectionStroke)
                    .background(Circle().fill(row.active ? AnalysisPalette.gold : Color.clear))
                    .frame(width: AnalysisEngineStyle.dotSize, height: AnalysisEngineStyle.dotSize)
                VStack(alignment: .leading) {
                    Text(row.label)
                        .font(Theme.nunito(AnalysisEngineStyle.nameSize, .bold))
                        .foregroundStyle(AnalysisPalette.textPrimary)
                    Text(row.summary)
                        .font(Theme.nunito(AnalysisEngineStyle.summarySize))
                        .foregroundStyle(AnalysisPalette.textSecondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, AnalysisEngineStyle.rowPaddingH)
            .frame(maxWidth: .infinity, minHeight: AnalysisEngineStyle.rowHeight, alignment: .leading)
            .background(AnalysisPalette.surfaceAlt,
                        in: RoundedRectangle(cornerRadius: AnalysisEngineStyle.rowRadius))
            .overlay {
                RoundedRectangle(cornerRadius: AnalysisEngineStyle.rowRadius)
                    .strokeBorder(row.active ? AnalysisPalette.gold : Color.clear,
                                  lineWidth: AnalysisEngineStyle.selectionStroke)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: Advanced control

    @ViewBuilder
    private func controlRow(_ control: EngineSettings.Control) -> some View {
        VStack(alignment: .leading) {
            HStack(alignment: .firstTextBaseline) {
                Text(control.label)
                    .font(Theme.nunito(AnalysisEngineStyle.advancedLabelSize))
                    .foregroundStyle(AnalysisPalette.textSecondaryAlt)
                Spacer()
                Text(control.valueText)
                    .font(Theme.nunito(AnalysisEngineStyle.advancedValueSize, .bold))
                    .foregroundStyle(AnalysisPalette.gold)
            }
            switch control.kind {
            case .segment: segment(control)
            case .slider: slider(control)
            }
        }
        .frame(minHeight: AnalysisEngineStyle.advancedRowHeight)
    }

    /// Lines is a segmented picker, not a slider: five discrete values a thumb cannot land on
    /// precisely, and the count is the number people change most.
    @ViewBuilder
    private func segment(_ control: EngineSettings.Control) -> some View {
        HStack(spacing: AnalysisEngineStyle.segmentGap) {
            ForEach(control.options, id: \.self) { value in
                let on = value == control.value
                Button { onSetControl(control.key, value) } label: {
                    Text(String(value))
                        .font(Theme.nunito(AnalysisEngineStyle.advancedValueSize, .bold))
                        .foregroundStyle(on ? AnalysisPalette.onGold : AnalysisPalette.textMuted)
                        .frame(maxWidth: .infinity, minHeight: AnalysisEngineStyle.segmentHeight)
                        .background(on ? AnalysisPalette.gold : AnalysisPalette.surfaceAlt,
                                    in: RoundedRectangle(cornerRadius: AnalysisEngineStyle.segmentRadius))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// `onEditingChanged`, not the binding's own setter: committing on every pixel of a drag would
    /// restart the search on each one, which is both useless and the most expensive thing this panel
    /// could do. The label is drawn above, so the slider carries none of its own.
    @ViewBuilder
    private func slider(_ control: EngineSettings.Control) -> some View {
        SliderCommittingOnRelease(control: control, onCommit: onSetControl)
            .frame(height: AnalysisEngineStyle.thumbSize)
    }
}

/// A `Slider` that reports only when the drag ends.
///
/// Its own view because it needs `@State` to track the in-flight value: SwiftUI's `Slider` wants a
/// live binding, and the whole point here is that the live value must NOT reach the engine.
private struct SliderCommittingOnRelease: View {
    let control: EngineSettings.Control
    let onCommit: (String, Int) -> Void

    @State private var live: Double?

    var body: some View {
        Slider(value: Binding(get: { live ?? Double(control.value) },
                              set: { live = $0 }),
               in: Double(control.min)...Double(control.max),
               step: Double(control.step),
               onEditingChanged: { editing in
                   guard !editing, let v = live else { return }
                   live = nil
                   onCommit(control.key, Int(v.rounded()))
               })
            .tint(AnalysisPalette.gold)
    }
}

// MARK: - Storage

/// `UserDefaults` behind `EngineSettings.Storage`, so the Core stays Foundation-only and testable.
/// Same shape as `CoachDefaultsStorage`, which is the one other persisted preference in the app.
struct AnalysisDefaultsStorage: EngineSettings.Storage {
    let defaults: UserDefaults

    init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    func get(_ key: String) -> String? { defaults.string(forKey: key) }
    func set(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
    func remove(_ key: String) { defaults.removeObject(forKey: key) }
}
