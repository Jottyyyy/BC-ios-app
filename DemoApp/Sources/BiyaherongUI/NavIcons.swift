import SwiftUI

// The app's navigation icons, drawn as vectors in one place.
//
// Mirrored by web-demo/js/icons.js from the SAME numbers (`NavIcon` below ↔ that file's `GEO`), and
// `tools/qa/nav_icons_check.js` asserts the two agree.
//
// Why this file exists. Back and menu were TEXT GLYPHS — `←` (U+2190) and `☰` (U+2630) — drawn at
// 22pt in Nunito, a font that has neither, so each fell back to whatever the platform picked. `☰`
// is the I Ching trigram for heaven, not a hamburger: thin bars, uneven gaps. `CoachLayout.swift`
// said it out loud — "icons that happen to be characters".
//
// And the two languages had already drifted apart. This side drew `Image(systemName:
// "chevron.left")` on the puzzle screens and the paywall while the browser drew `←` on the same
// screens, with no gate to notice. One drawing, from one set of numbers, fixes both at once.
//
// `Shape`, not an SVG asset: `SVGVector.swift` deliberately rejects `currentColor` (see its parser),
// and these icons have to take each screen's own tint — pairing's gold, coach's white, analysis's
// off-white. `BoardArrows.swift` is the precedent for hand-built paths in this module.

/// The one geometry, in a 24×24 box. Mirrored by `GEO` in web-demo/js/icons.js.
///
/// In `Theme`'s spirit — the global design system — because this is the first component that is
/// genuinely shared by every screen family rather than owned by one.
enum NavIcon {
    /// The design box every path below is expressed in. Scaled to whatever the caller asks for.
    static let box: CGFloat = 24
    /// Round caps and joins, at the weight the rest of the app's line art already uses.
    static let stroke: CGFloat = 2

    // The chevron: a two-segment polyline from top-right, in to the left, back out to bottom-right.
    // The insets are not symmetric on purpose — a chevron's visual mass sits at its apex, not at
    // its box centre, so equal insets read as shifted right.
    static let chevronX: CGFloat = 9
    static let chevronTop: CGFloat = 5
    static let chevronBottom: CGFloat = 19
    static let chevronApex: CGFloat = 15

    // Three bars, evenly spaced: a real hamburger, equal weight and equal gaps, which is exactly
    // what `☰` was not.
    static let barInset: CGFloat = 4
    static let barTop: CGFloat = 7
    static let barGap: CGFloat = 5
    static let barCount = 3

    /// Apple's minimum comfortable target, applied to WIDTH only.
    ///
    /// Not height: the Analysis header is 36pt tall, and a 44pt-tall button inside it spills 4pt
    /// over the board's top rank — measured in the browser twin, where it would have stolen taps
    /// from a8-h8. Every screen's own frame is already 36-44 tall; width is the axis that was
    /// actually cramped, with several buttons at 40.
    static let hitTarget: CGFloat = 44
    /// What a press dims to. Matches `.an-hidden`'s sibling rule in the browser stylesheet.
    static let pressedOpacity: Double = 0.55

    /// Scale a design-box coordinate into a rect of `side` points.
    static func scaled(_ v: CGFloat, side: CGFloat) -> CGFloat { v / box * side }
}

/// `‹` — the iOS convention for back, and what this side already drew on four screens.
struct BackChevron: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let x0 = rect.minX + (rect.width - side) / 2
        let y0 = rect.minY + (rect.height - side) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x0 + NavIcon.scaled(x, side: side), y: y0 + NavIcon.scaled(y, side: side))
        }
        var path = Path()
        path.move(to: p(NavIcon.chevronApex, NavIcon.chevronTop))
        path.addLine(to: p(NavIcon.chevronX, NavIcon.box / 2))
        path.addLine(to: p(NavIcon.chevronApex, NavIcon.chevronBottom))
        return path
    }
}

/// Three even bars.
struct MenuBars: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let x0 = rect.minX + (rect.width - side) / 2
        let y0 = rect.minY + (rect.height - side) / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x0 + NavIcon.scaled(x, side: side), y: y0 + NavIcon.scaled(y, side: side))
        }
        var path = Path()
        for i in 0 ..< NavIcon.barCount {
            let y = NavIcon.barTop + CGFloat(i) * NavIcon.barGap
            path.move(to: p(NavIcon.barInset, y))
            path.addLine(to: p(NavIcon.box - NavIcon.barInset, y))
        }
        return path
    }
}

/// A nav icon at a given size, tinted, with the stroke scaled to match.
///
/// The stroke has to scale with the icon or a 28pt back button draws a hairline next to a 22pt one.
struct NavIconGlyph: View {
    enum Kind { case back, menu }
    let kind: Kind
    let size: CGFloat
    let tint: Color

    var body: some View {
        let width = NavIcon.scaled(NavIcon.stroke, side: size)
        let style = StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
        return Group {
            switch kind {
            case .back: BackChevron().stroke(tint, style: style)
            case .menu: MenuBars().stroke(tint, style: style)
            }
        }
        .frame(width: size, height: size)
    }
}

/// The button every screen's back and ☰ go through.
///
/// It deliberately does NOT impose a frame: `CoachSelect.backBtnWidth` (44),
/// `PairingList.backBtnWidth` (40) and the rest are extracted StyleSheet values, and the caller
/// keeps applying its own. What this adds is the icon, the hit area and the pressed state — the
/// three things none of the hand-rolled buttons had.
struct NavIconButton: View {
    let kind: NavIconGlyph.Kind
    let size: CGFloat
    let tint: Color
    let action: () -> Void

    init(_ kind: NavIconGlyph.Kind, size: CGFloat, tint: Color, action: @escaping () -> Void) {
        self.kind = kind
        self.size = size
        self.tint = tint
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            NavIconGlyph(kind: kind, size: size, tint: tint)
                // `minWidth` only — see `hitTarget`. `contentShape` makes the whole box tappable
                // rather than just the stroked path, which is what a 2pt chevron badly needs.
                .frame(minWidth: NavIcon.hitTarget)
                .contentShape(Rectangle())
        }
        .buttonStyle(NavIconPressStyle())
    }
}

/// Dim on press. Every hand-rolled back button had no pressed state at all.
struct NavIconPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? NavIcon.pressedOpacity : 1)
    }
}
