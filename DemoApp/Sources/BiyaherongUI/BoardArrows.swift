import SwiftUI
import BiyaherongCoachCore

// Engine-line arrows drawn over the board (spec 3.9).
//
// Composed as an `.overlay` on the board rather than being built into `BoardView`, for two reasons:
// it keeps `BoardView` — which Play and Puzzles also use — free of anything analysis-specific, and
// it follows the existing precedent, where `PromotionOverlay` is likewise applied at the call site.
//
// All geometry comes from `AnalysisArrow`, which is pure and asserted by `AnalysisMetricsCheck`; no
// numbers live in this file.

/// One arrow: a move plus its rank in the engine's line list (0 = best).
struct BoardArrow: Equatable, Identifiable {
    let from: Int
    let to: Int
    /// 0-based; drives the colour (green / blue / orange).
    let rank: Int
    var id: String { "\(from)-\(to)-\(rank)" }

    init(from: Int, to: Int, rank: Int) {
        self.from = from; self.to = to; self.rank = rank
    }

    /// Convenience for the engine's own output.
    init?(line: EngineLine) {
        guard let first = line.pv.first else { return nil }
        self.init(from: first.from, to: first.to, rank: line.rank - 1)
    }
}

struct BoardArrows: View {
    let arrows: [BoardArrow]
    let boardSize: CGFloat
    let flipped: Bool

    private var square: CGFloat { boardSize / 8 }

    var body: some View {
        // Weakest arrow first, so the best line ends up on top.
        ZStack {
            ForEach(arrows.sorted { $0.rank > $1.rank }) { arrow in
                shape(for: arrow)
            }
        }
        .frame(width: boardSize, height: boardSize)
        // Must never intercept taps or the drag gesture underneath.
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func shape(for arrow: BoardArrow) -> some View {
        let g = AnalysisArrow.geometry(from: arrow.from, to: arrow.to, square: square, flipped: flipped)
        let color = AnalysisArrow.color(rank: arrow.rank)
        ZStack {
            // Shaft, stopping short of the tip so it does not show through the head.
            Path { p in
                p.move(to: g.start)
                p.addLine(to: g.end)
            }
            .stroke(color, style: StrokeStyle(lineWidth: g.strokeWidth, lineCap: .round))
            // Head: a filled triangle whose apex is the destination centre.
            Path { p in
                p.move(to: g.tip)
                p.addLine(to: g.left)
                p.addLine(to: g.right)
                p.closeSubpath()
            }
            .fill(color)
        }
    }
}
