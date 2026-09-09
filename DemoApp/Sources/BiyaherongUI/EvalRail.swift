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
    /// The board's orientation, so the rail can follow it.
    ///
    /// The rail's SIDE does not move — it is on the left either way — but the colour at the bottom
    /// of the rail is always the colour at the bottom of the board. The client reported the old
    /// behaviour as the bug it looked like: *"hindi na flip kapag nagflip ka, nasa taas parin ung
    /// black"*. See `AnalysisEval`'s doc comment for the rule this reversed and why.
    let flipped: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous)
            .fill(AnalysisPalette.evalTrack)
            .frame(width: AnalysisEval.railWidth, height: height)
            // Bottom normally, top when the board is flipped — White always grows from White's own
            // end. Anchoring this to a literal end has no symptom other than every evaluation in
            // the app being backwards for half the users, which is why it is asserted by name.
            .overlay(alignment: AnalysisEval.fillAlignment(flipped: flipped)) {
                RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous)
                    .fill(AnalysisPalette.evalFill)
                    .frame(width: AnalysisEval.railWidth,
                           height: AnalysisEval.fillHeight(rail: height, fraction: fraction))
            }
            .overlay(alignment: AnalysisEval.labelAlignment(fraction: fraction, flipped: flipped)) {
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
            // The flip animates on the same curve, so tapping 🔄 slides the block across rather
            // than snapping it — the same easing the evaluation itself moves on.
            .animation(.easeInOut(duration: AnalysisEval.animationSeconds), value: flipped)
    }
}
