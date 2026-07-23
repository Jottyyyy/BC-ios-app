import SwiftUI
import AppKit

/// shadcn/ui "neutral" theme (OKLCH → sRGB). Grayscale base + red destructive + 5 chart hues,
/// adapting to light/dark. Border radius base 10px.
enum Theme {
    static let radius: CGFloat = 10

    private static func dyn(_ light: UInt, _ dark: UInt) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? ns(dark) : ns(light)
        })
    }
    private static func ns(_ hex: UInt) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
                green: CGFloat((hex >> 8) & 0xff) / 255,
                blue: CGFloat(hex & 0xff) / 255, alpha: 1)
    }

    // Base (light / dark)
    static let background        = dyn(0xffffff, 0x252525)
    static let foreground        = dyn(0x252525, 0xfafafa)
    static let card              = dyn(0xffffff, 0x2b2b2b)
    static let muted             = dyn(0xf5f5f5, 0x333333)
    static let mutedForeground   = dyn(0x8e8e8e, 0xa1a1a1)
    static let border            = dyn(0xe5e5e5, 0x404040)
    static let primary           = dyn(0x343434, 0xfafafa)
    static let primaryForeground = dyn(0xfafafa, 0x252525)
    static let destructive       = dyn(0xdc2626, 0xf87171)   // readable red text in both modes

    // Chart hues (the only vivid colors)
    static let chart1 = dyn(0xf54900, 0x1447e6)   // orange / indigo
    static let chart2 = dyn(0x009689, 0x00bc7d)   // teal / green  → "positive"
    static let chart3 = dyn(0x104e64, 0xfe9a00)   // dark-blue / gold
    static let chart4 = dyn(0xffb900, 0xad46ff)   // yellow / purple
    static let chart5 = dyn(0xfe9a00, 0xff2056)   // amber / pink-red

    // Board (neutral, to match the grayscale theme)
    static let boardLight = dyn(0xe6e6e4, 0x8a8a8a)
    static let boardDark  = dyn(0x8f8f8f, 0x5c5c5c)

    // Semantic aliases
    static var positive: Color { chart2 }
    static var negative: Color { destructive }
    static var accent:   Color { chart1 }
    static var warning:  Color { chart5 }
}
