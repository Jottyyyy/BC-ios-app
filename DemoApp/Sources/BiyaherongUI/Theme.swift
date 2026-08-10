import SwiftUI
import CoreText

/// Nunito weights (real TTFs bundled under Fonts/). The fontsource files carry a
/// "NunitoExtraLight-" PostScript prefix but the actual weights are correct (Regular…ExtraBold).
enum NunitoWeight {
    case regular, medium, semiBold, bold, extraBold, heavy, black
    var psName: String {
        switch self {
        case .regular: return "NunitoExtraLight-Regular"
        case .medium: return "NunitoExtraLight-Medium"
        case .semiBold: return "NunitoExtraLight-SemiBold"
        case .bold: return "NunitoExtraLight-Bold"
        // Nothing heavier than ExtraBold ships, and an invented psName resolves to nothing and
        // renders in the wrong face with no warning — so heavy/black take the heaviest real one
        // and differ only in the SF fallback below.
        case .extraBold, .heavy, .black: return "NunitoExtraLight-ExtraBold"
        }
    }
    var systemWeight: Font.Weight {
        switch self {
        case .regular: return .regular; case .medium: return .medium
        case .semiBold: return .semibold; case .bold: return .bold; case .extraBold: return .heavy
        case .heavy: return .heavy; case .black: return .black
        }
    }
}

/// Biyaherong Chess Coach — fixed dark-navy theme with gold accents and Nunito type.
enum Theme {

    // MARK: Fonts (register bundled Nunito once; fall back to SF Rounded)

    static let fontsReady: Bool = {
        guard let urls = Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts"), !urls.isEmpty
        else { return false }
        for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
        return true
    }()

    static func nunito(_ size: CGFloat, _ weight: NunitoWeight = .regular) -> Font {
        fontsReady ? .custom(weight.psName, fixedSize: size) : .system(size: size, weight: weight.systemWeight, design: .rounded)
    }

    /// Nunito ships **no italic face** (only Regular…ExtraBold), and SwiftUI's `.italic()` is a
    /// silent no-op on a family without one — it requests the italic symbolic trait, CoreText finds
    /// no match, and the text renders upright with no warning. The home screen's quote is specified
    /// italic, so shear the real face instead.
    ///
    /// CoreText's text space is y-up, so a positive `c` leans the top of each glyph to the right.
    static func nunitoItalic(_ size: CGFloat, _ weight: NunitoWeight = .regular,
                             degrees: CGFloat = 12) -> Font {
        guard fontsReady else {
            return .system(size: size, weight: weight.systemWeight, design: .rounded).italic()
        }
        let base = CTFontCreateWithName(weight.psName as CFString, size, nil)
        let descriptor = CTFontCopyFontDescriptor(base)
        var slant = CGAffineTransform(a: 1, b: 0, c: tan(degrees * .pi / 180), d: 1, tx: 0, ty: 0)
        return Font(CTFontCreateWithFontDescriptor(descriptor, size, &slant))
    }

    // MARK: Shape

    static let radius: CGFloat = 20         // cards
    static let radiusButton: CGFloat = 14
    static let radiusChip: CGFloat = 10

    // MARK: Palette (fixed dark)

    /// Internal (not private) so the rest of the module builds its own tokens the same way —
    /// see `HomePalette`. One hex helper, one colour space, no drift.
    static func c(_ hex: UInt, _ a: Double = 1) -> Color {
        Color(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
              blue: Double(hex & 0xff) / 255, opacity: a)
    }

    static let background      = c(0x0F1A2E)
    static let card            = c(0x1A2942)
    static let cardAlt         = c(0x162D4A)
    static let input           = c(0x253552)
    static let foreground      = c(0xFFFFFF)
    static let mutedForeground = c(0x8BA3C7)
    static let textMuted       = c(0x5A6E87)
    static let border          = c(0x4A9FE8, 0.12)
    static let iconChip        = c(0x4A9FE8, 0.15)
    static let hairline        = c(0xFFFFFF, 0.06)

    static let gold   = c(0xFDB022)
    static let onGold  = c(0x0F1A2E)
    static let blue   = c(0x4A90E2)
    static let blueSky = c(0x4A9FE8)
    static let green  = c(0x5CC264)
    static let orange = c(0xFF8A3D)
    static let red    = c(0xFF6B6B)
    static let purple = c(0x9B6DD6)
    static let teal   = c(0x00BFA5)

    // Chess board tints
    static let boardLight = c(0x5BA3F5)
    static let boardDark  = c(0x2C4A73)

    // MARK: Semantic aliases (existing view code refers to these names)

    static var muted: Color { card }          // card / tile fill
    static var primary: Color { gold }
    static var accent: Color { gold }
    static var positive: Color { green }
    static var negative: Color { red }
    static var warning: Color { orange }

    // gold now carries what "violet" used to; kept for source compatibility
    static var violet: Color { gold }
    static var violetDeep: Color { c(0xD99416) }
    static var violetSoft: Color { c(0xFDB022, 0.14) }
    static var violetGradient: LinearGradient { LinearGradient(colors: [gold, gold], startPoint: .top, endPoint: .bottom) }

    // chart hues → app accents
    static var chart1: Color { blue }
    static var chart2: Color { green }
    static var chart3: Color { teal }
    static var chart4: Color { gold }
    static var chart5: Color { orange }
}
