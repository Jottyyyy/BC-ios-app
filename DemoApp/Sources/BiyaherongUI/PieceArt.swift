import SwiftUI
import BiyaherongCoachCore

// The chess-piece artwork bundled under Pieces/ — the classic Wikipedia set by
// Uray M. János (CC BY-SA), one SVG per colour+kind, named "<kind>-<w|b>.svg".
// Parsed once per piece and cached; see SVGVector.swift for the renderer.

@MainActor
enum PieceArt {
    private static var cache: [String: SVGDrawing] = [:]
    private static var unavailable: Set<String> = []

    /// Resource base name for a piece, e.g. `knight-w`.
    static func assetName(for piece: Piece) -> String {
        let kind: String
        switch piece.kind {
        case .pawn:   kind = "pawn"
        case .knight: kind = "knight"
        case .bishop: kind = "bishop"
        case .rook:   kind = "rook"
        case .queen:  kind = "queen"
        case .king:   kind = "king"
        }
        return "\(kind)-\(piece.color == .white ? "w" : "b")"
    }

    static func drawing(for piece: Piece) -> SVGDrawing? {
        let name = assetName(for: piece)
        if let cached = cache[name] { return cached }
        guard !unavailable.contains(name) else { return nil }
        guard let url = Bundle.module.url(forResource: name, withExtension: "svg", subdirectory: "Pieces"),
              let data = try? Data(contentsOf: url),
              let drawing = SVGDrawing.parse(data)
        else { unavailable.insert(name); return nil }
        cache[name] = drawing
        return drawing
    }

    /// Parses any of the twelve pieces not already cached (≈16 KB of XML total).
    /// The root calls this on appear, which is after the first board's own lazy
    /// loads — its job is warming the kinds that board didn't happen to contain,
    /// so switching tabs or opening the promotion sheet never parses inline.
    static func preload() {
        for color in [PieceColor.white, .black] {
            for kind in [PieceKind.pawn, .knight, .bishop, .rook, .queen, .king] {
                _ = drawing(for: Piece(color, kind))
            }
        }
    }

    /// VoiceOver description, e.g. "White knight".
    static func label(for piece: Piece) -> String {
        let kind = assetName(for: piece).split(separator: "-")[0]
        return "\(piece.color == .white ? "White" : "Black") \(kind)"
    }

    /// Unicode fallback, used only if the bundled artwork can't be loaded.
    static func glyph(_ piece: Piece) -> String {
        switch piece.kind {
        case .king:   return "\u{265A}"
        case .queen:  return "\u{265B}"
        case .rook:   return "\u{265C}"
        case .bishop: return "\u{265D}"
        case .knight: return "\u{265E}"
        case .pawn:   return "\u{265F}"
        }
    }
}

/// A chess piece drawn from its bundled vector artwork, aspect-fit into `size`.
/// The artwork carries its own padding, so `size` is the full board square.
struct PieceImage: View {
    let piece: Piece
    var size: CGFloat
    var shadow: Bool = true

    var body: some View {
        art
            .frame(width: size, height: size)
            .accessibilityLabel(Text(PieceArt.label(for: piece)))
    }

    @ViewBuilder private var art: some View {
        if let drawing = PieceArt.drawing(for: piece) {
            if shadow {
                canvas(drawing)
                    .shadow(color: .black.opacity(0.34), radius: max(0.5, size * 0.03), y: max(0.5, size * 0.02))
            } else {
                canvas(drawing)
            }
        } else {
            Text(PieceArt.glyph(piece))
                .font(.system(size: size * 0.74))
                .foregroundStyle(piece.color == .white ? Color(white: 0.98) : Color(white: 0.12))
        }
    }

    private func canvas(_ drawing: SVGDrawing) -> some View {
        Canvas { ctx, canvasSize in drawing.draw(in: &ctx, size: canvasSize) }
    }
}
