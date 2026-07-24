import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
import BiyaherongCoachCore

// Small, reusable, chess-grounded graphics used across the app.

/// Loads the coach character illustrations (level-1…5, weakest→strongest) from the bundle.
@MainActor
enum CoachArt {
    private static var cache: [Int: Image] = [:]
    static func image(level: Int) -> Image? {
        if let c = cache[level] { return c }
        guard (1...5).contains(level),
              let url = Bundle.module.url(forResource: "level-\(level)", withExtension: "webp", subdirectory: "Characters") else { return nil }
        #if canImport(UIKit)
        guard let plat = UIImage(contentsOfFile: url.path) else { return nil }
        let img = Image(uiImage: plat)
        #else
        guard let plat = NSImage(contentsOf: url) else { return nil }
        let img = Image(nsImage: plat)
        #endif
        cache[level] = img
        return img
    }
    /// Strength level (1…5) for a coach id.
    static func level(forCoachId id: String?) -> Int {
        (Coaches.all.firstIndex { $0.id == id } ?? 0) + 1
    }
}

/// Vertical evaluation bar — white advantage fills from the bottom. The signature chess element.
struct EvalBar: View {
    let whitePct: Double     // 0…100 (White win probability)
    let height: CGFloat
    var body: some View {
        let frac = max(0.02, min(0.98, whitePct / 100))
        RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(Color(white: 0.14))
            .overlay(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Color(white: 0.95))
                    .frame(height: height * frac)
            }
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.violet).frame(height: 1.5).offset(y: -height / 2)
            }
            .frame(width: 14, height: height)
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).stroke(Theme.border, lineWidth: 1))
            .animation(.easeInOut(duration: 0.4), value: frac)
    }
}

/// Circular progress ring with a centered readout.
struct RingGauge: View {
    let value: Double        // 0…1
    var size: CGFloat = 88
    var color: Color = Theme.violet
    var center: String
    var caption: String
    var body: some View {
        ZStack {
            Circle().stroke(Theme.border, lineWidth: size * 0.1)
            Circle().trim(from: 0, to: max(0.001, min(1, value)))
                .stroke(color, style: StrokeStyle(lineWidth: size * 0.1, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.5), value: value)
            VStack(spacing: 0) {
                Text(center).font(.system(size: size * 0.26, weight: .bold, design: .rounded)).foregroundStyle(Theme.foreground)
                Text(caption).font(.system(size: size * 0.11)).foregroundStyle(Theme.mutedForeground)
            }
        }.frame(width: size, height: size)
    }
}

/// A filled mini line chart (e.g., rating over time).
struct Sparkline: View {
    let values: [Int]
    var color: Color = Theme.violet
    var body: some View {
        GeometryReader { geo in
            let vals = values.isEmpty ? [0, 0] : (values.count == 1 ? [values[0], values[0]] : values)
            let lo = Double(vals.min()!), hi = Double(vals.max()!), range = max(1, hi - lo)
            let pts: [CGPoint] = vals.enumerated().map { i, v in
                CGPoint(x: geo.size.width * Double(i) / Double(vals.count - 1),
                        y: geo.size.height * (1 - (Double(v) - lo) / range) * 0.86 + geo.size.height * 0.07)
            }
            ZStack {
                Path { p in
                    p.move(to: CGPoint(x: pts[0].x, y: geo.size.height))
                    for pt in pts { p.addLine(to: pt) }
                    p.addLine(to: CGPoint(x: pts.last!.x, y: geo.size.height))
                    p.closeSubpath()
                }.fill(LinearGradient(colors: [color.opacity(0.28), color.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                Path { p in
                    for (i, pt) in pts.enumerated() { i == 0 ? p.move(to: pt) : p.addLine(to: pt) }
                }.stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = pts.last { Circle().fill(color).frame(width: 5, height: 5).position(last) }
            }
        }
    }
}

/// Tiny vertical bar chart (e.g., weekly activity).
struct MiniBars: View {
    let values: [Int]
    var color: Color = Theme.violet
    var body: some View {
        GeometryReader { geo in
            let hi = max(1, values.max() ?? 1)
            let w = geo.size.width / CGFloat(max(1, values.count))
            HStack(alignment: .bottom, spacing: w * 0.28) {
                ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(v == 0 ? AnyShapeStyle(Theme.border) : AnyShapeStyle(color))
                        .frame(height: max(3, geo.size.height * CGFloat(v) / CGFloat(hi)))
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

/// Score-sheet style move ribbon that scrolls to the latest move.
struct MoveRibbon: View {
    let sans: [String]
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 5) {
                    if sans.isEmpty {
                        Text("Moves appear here").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                    }
                    ForEach(Array(sans.enumerated()), id: \.offset) { i, san in
                        HStack(spacing: 3) {
                            if i % 2 == 0 {
                                Text("\(i / 2 + 1)").font(Theme.nunito(10, .medium)).foregroundStyle(Theme.mutedForeground)
                            }
                            Text(san).font(.system(.footnote, design: .monospaced)).fontWeight(.medium)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(i == sans.count - 1 ? AnyShapeStyle(Theme.violet.opacity(0.18)) : AnyShapeStyle(Theme.muted), in: Capsule())
                                .foregroundStyle(i == sans.count - 1 ? Theme.violet : Theme.foreground)
                        }.id(i)
                    }
                }.padding(.horizontal, 6).padding(.vertical, 8)
            }
            .frame(height: 40)
            .background(Theme.background)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .onChange(of: sans.count) { _, c in withAnimation { proxy.scrollTo(c - 1, anchor: .trailing) } }
        }
    }
}

/// Violet monogram medallion for a coach.
struct CoachAvatar: View {
    let name: String
    var size: CGFloat = 40
    var level: Int? = nil       // 1…5 → show character art; nil → gold monogram
    var body: some View {
        Group {
            if let level, let img = CoachArt.image(level: level) {
                img.resizable().scaledToFill().frame(width: size, height: size, alignment: .top)
            } else {
                ZStack {
                    Theme.gold
                    Text(initials).font(Theme.nunito(size * 0.4, .extraBold)).foregroundStyle(Theme.onGold)
                }
            }
        }
        .frame(width: size, height: size)
        .background(Theme.cardAlt)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.gold.opacity(0.55), lineWidth: 1.5))
    }
    private var initials: String {
        name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
    }
}

/// Five dots showing relative coach strength.
struct StrengthDots: View {
    let level: Int   // 1…5
    var body: some View {
        HStack(spacing: 3) {
            ForEach(1...5, id: \.self) { i in
                Circle().fill(i <= level ? AnyShapeStyle(Theme.violet) : AnyShapeStyle(Theme.border))
                    .frame(width: 6, height: 6)
            }
        }
    }
}

/// A pill badge for a move classification (icon + label).
struct ClassificationBadge: View {
    let classification: String
    var body: some View {
        Label(classification.capitalized, systemImage: icon)
            .font(Theme.nunito(15, .bold))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }
    private var color: Color {
        switch classification {
        case "brilliant": return Theme.chart2
        case "great", "best": return Theme.positive
        case "excellent", "good": return Theme.chart2
        case "inaccuracy": return Theme.chart4
        case "mistake", "miss": return Theme.warning
        default: return Theme.negative
        }
    }
    private var icon: String {
        switch classification {
        case "brilliant": return "sparkles"
        case "great", "best": return "star.fill"
        case "excellent", "good": return "checkmark.circle.fill"
        case "inaccuracy": return "exclamationmark.triangle.fill"
        case "mistake", "miss": return "xmark.circle.fill"
        default: return "flame.fill"
        }
    }
}

/// Small labeled stat tile with an SF Symbol.
struct StatTile: View {
    let icon: String
    let value: String
    let label: String
    var tint: Color = Theme.violet
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(Theme.nunito(15, .semiBold)).foregroundStyle(tint)
            Text(value).font(Theme.nunito(20, .bold)).foregroundStyle(Theme.foreground)
            Text(label).font(Theme.nunito(11, .regular)).foregroundStyle(Theme.mutedForeground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
    }
}
