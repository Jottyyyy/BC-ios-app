import SwiftUI
import BiyaherongCoachCore

// The annotation picker (renderAnnotationPicker:3257) and the annotation badge overlay
// (renderAnnotationOverlay:2666).
//
// Two sections — Move Quality and Position Evaluation — from `AnalysisTables`, which is pinned to
// the source's own `MOVE_ANNOTATIONS` / `POSITION_ANNOTATIONS`. The ⩲/⩱ pair is DELIBERATELY
// corrected: the source labels `⩱` "Slight edge White" and `⩲` "Slight edge Black", which is
// backwards, and it matters more here than anywhere else because the picker writes NAGs into the
// exported PGN. Shipping the swap would emit `$15` where `$14` is meant.

struct AnalysisAnnotationPicker: View {
    let san: String
    let currentNAG: Int
    let onPick: (Int) -> Void
    let onClear: () -> Void
    let onClose: () -> Void

    private struct Section: Identifiable {
        let id = UUID()
        let title: String
        let options: [AnalysisTables.Annotation]
    }

    private var sections: [Section] {
        [Section(title: "Move Quality", options: AnalysisTables.moveAnnotations),
         Section(title: "Position Evaluation", options: AnalysisTables.positionAnnotations)]
    }

    var body: some View {
        AnalysisBottomSheet(title: "Annotate: " + san, onClose: onClose) {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(sections) { section in
                        Text(section.title.uppercased())
                            .font(Theme.nunito(AnalysisType.annotationSection, .bold))
                            .tracking(AnalysisModals.sectionTracking)
                            .foregroundStyle(AnalysisModals.sectionColor)
                            .padding(.top, AnalysisModals.sectionMarginTop)
                            .padding(.bottom, AnalysisModals.sectionMarginBottom)
                        grid(section.options)
                    }
                    Button(action: onClear) {
                        Text("Clear Annotation")
                            .font(Theme.nunito(AnalysisModals.clearSize, .bold))
                            .foregroundStyle(AnalysisModals.clearColor)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, AnalysisModals.clearPaddingV)
                            .background(AnalysisModals.clearBg,
                                        in: RoundedRectangle(cornerRadius: AnalysisModals.clearRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func grid(_ options: [AnalysisTables.Annotation]) -> some View {
        // A flexible grid rather than a fixed column count: the source uses `flexWrap: 'wrap'`, and
        // 70pt buttons fit three across on an SE and four on a Pro Max.
        LazyVGrid(columns: [GridItem(.adaptive(minimum: AnalysisModals.btnW),
                                     spacing: AnalysisModals.gridGap)],
                  spacing: AnalysisModals.gridGap) {
            ForEach(options, id: \.symbol) { option in
                let nag = AnalysisSession.nag(forSymbol: option.symbol)
                Button { onPick(nag) } label: {
                    VStack(spacing: 0) {
                        Text(option.symbol)
                            .font(Theme.nunito(AnalysisType.annotationSymbol, .black))
                            .foregroundStyle(option.color)
                        Text(option.label)
                            .font(Theme.nunito(AnalysisType.annotationLabel, .semibold))
                            .foregroundStyle(AnalysisModals.labelColor)
                            .multilineTextAlignment(.center)
                            .padding(.top, AnalysisModals.labelGap)
                    }
                    .frame(width: AnalysisModals.btnW, height: AnalysisModals.btnH)
                    .background(AnalysisModals.btnBg,
                                in: RoundedRectangle(cornerRadius: AnalysisModals.btnRadius))
                    .overlay {
                        RoundedRectangle(cornerRadius: AnalysisModals.btnRadius)
                            .strokeBorder(nag == currentNAG ? AnalysisPalette.gold : .clear,
                                          lineWidth: AnalysisEdit.activeBorder)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.bottom, AnalysisModals.gridMarginBottom)
    }
}

// MARK: - The badge overlay

/// The manual-annotation badge, drawn on the square the current move landed on.
///
/// BOTTOM-right of the square's centre. `squareToPixel` returns the CENTRE and
/// `renderAnnotationOverlay:2676-2678` adds `+ SQUARE_SIZE * 0.29` to BOTH axes — a sign this
/// rebuild had backwards in both languages until the extractor started pinning it. Every value here
/// comes from `AnalysisBadge`, whose geometry the metrics check now asserts against the extracted
/// `renderConstants`.
///
/// Only MOVE-QUALITY annotations get a badge: the source looks the symbol up in `MOVE_ANNOTATIONS`
/// alone, so `±` shows in the move strip and draws nothing here. `AnalysisSession.annotationSymbol`
/// already applies that rule, so this view just draws what it is given.
struct AnalysisAnnotationOverlay: View {
    let square: Int
    let symbol: String
    let color: Color
    let boardEdge: CGFloat
    let flipped: Bool

    var body: some View {
        let g = AnalysisBadge.geometry(square, square: boardEdge / 8, flipped: flipped,
                                       symbolLength: symbol.count)
        ZStack(alignment: .topLeading) {
            Color.clear
            Circle()
                .fill(Color.black.opacity(0.45))
                .frame(width: g.radius * 2, height: g.radius * 2)
                .position(g.shadowCenter)
            Circle()
                .fill(Color.white.opacity(0.9))
                .frame(width: g.ringRadius * 2, height: g.ringRadius * 2)
                .position(g.center)
            Circle()
                .fill(color)
                .frame(width: g.radius * 2, height: g.radius * 2)
                .position(g.center)
            Text(symbol)
                .font(.system(size: g.fontSize, weight: .bold))
                .foregroundStyle(.white)
                .position(g.center)
        }
        .frame(width: boardEdge, height: boardEdge)
        .allowsHitTesting(false)
    }
}
