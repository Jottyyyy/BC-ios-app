import SwiftUI

/// **THE eval rail.** One implementation, two mount sites.
///
/// This body used to live inside `AnalysisBoardScreen.evalRail(height:)`, back when the Analysis
/// Board was the only screen with an engine. The Opening Tree explorer has one now, and
/// `swift_layout_check.js` §4e's rule — *"there is only ONE vertical eval bar in the module"* — is
/// the reason this is a shared view rather than a second copy. A second rail is not a duplicated
/// twenty lines; it is two places for the label ink and the fill anchor to disagree, on two screens
/// nobody diffs against each other.
///
/// ## Shape here, placement there
///
/// Everything about how the rail LOOKS is in this file and asserted here (`swift_layout_check.js`
/// §4d-shape). Everything about where it SITS — left of the board, inside the `HStack`, gone when
/// the engine is off, and the board width that follows from that — stays on each screen, because
/// that is where it can be got wrong per screen: arrows sliding by the rail's width, or a board
/// that does not take the space back. §4d's `RAIL_SITES` loop checks the mount at every site.
///
/// Each screen keeps a three-line `evalRail(height:)` forwarder rather than naming `EvalRail`
/// inline. That is deliberate: it keeps `evalRail(height: edge)` at the call site, so every mount
/// assertion and every mount mutant written against the Analysis Board still matches character for
/// character.
struct EvalRail: View {

    /// The board's edge. The rail is exactly as tall as the board it stands beside — that is the
    /// whole reason both come from one `edge` function on each screen.
    let height: CGFloat
    /// 0…1, White at the top. From `AnalysisEval.fraction(cp:mate:)`, never computed at the call
    /// site: mate pins to 0.95/0.05 and a missing score is 0.5, and a screen deriving that itself
    /// is a screen that will get the mate case wrong.
    let fraction: CGFloat
    /// `+1.3` / `M4` / `½-½`, from `EngineScore.displayText`. Empty draws nothing.
    let label: String

    var body: some View {
        RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous)
            .fill(AnalysisPalette.evalTrack)
            .frame(width: AnalysisEval.railWidth, height: height)
            // BOTTOM, so White grows upward. Inverting this has no symptom other than every
            // evaluation in the app being backwards, which is why it is asserted by name.
            .overlay(alignment: .bottom) {
                RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous)
                    .fill(AnalysisPalette.evalFill)
                    .frame(width: AnalysisEval.railWidth,
                           height: AnalysisEval.fillHeight(rail: height, fraction: fraction))
            }
            .overlay(alignment: AnalysisEval.labelAlignment(fraction: fraction)) {
                Text(label)
                    .font(AnalysisType.mono(AnalysisEval.labelFontSize, AnalysisType.evalRailWeight))
                    .foregroundStyle(AnalysisEval.labelInk(fraction: fraction))
                    .lineLimit(AnalysisLayout.singleLine)
                    // The rail is SIZED for four glyphs, which is every label a real game
                    // produces. `+10.5` is the fifth, and shrinks 4/5 rather than clipping.
                    .minimumScaleFactor(AnalysisEval.labelMinScale)
                    .padding(.vertical, AnalysisEval.railPaddingV)
            }
            .clipShape(RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous))
            .animation(.easeInOut(duration: AnalysisEval.animationSeconds), value: fraction)
    }
}
