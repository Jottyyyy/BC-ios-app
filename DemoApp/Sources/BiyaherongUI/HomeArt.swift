import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// The home screen's card artwork, bundled under Images/ (declared `.copy` in Package.swift, so
// every lookup passes `subdirectory: "Images"`).
//
// Five of the six assets are raster and render aspect-fit and untinted; `opening_book` is the one
// genuine vector and goes through SVGVector.
//
// Provenance worth knowing: in the React Native app, `analysis.svg` and `video_icon.svg` were not
// vectors at all — each was a three-line <svg> wrapping a base64 <image>, so the `fill="#FFFFFF"`
// prop that screen passed them was already a no-op. SVGVector rejects <image> outright, so those
// two payloads were decoded back to the PNGs they always were. Do not "restore" them to SVG.

@MainActor
enum HomeArt {
    /// Resource base names under Images/.
    enum Asset: String {
        case puzzleKnight = "puzzle_knight"
        case analysis = "analysis"
        case video = "video_icon"
        case swiss = "swiss"
        case appIcon = "app-icon"
        /// The full brand mark ("Byaherong COACH APP"), as opposed to `appIcon`'s gold knight.
        /// Copied from the RN app's `assets/images/icon.png` — the logo its login, register and
        /// splash screens all use. Only the login screen draws it. See docs/login.md.
        case brandLogo = "brand-logo"
        case openingBook = "opening_book"     // the only true vector
    }

    private static var rasterCache: [String: Image] = [:]
    private static var vectorCache: [String: SVGDrawing] = [:]
    private static var unavailable: Set<String> = []

    /// Loads a bundled PNG once and caches the SwiftUI `Image`.
    static func raster(_ asset: Asset) -> Image? {
        let name = asset.rawValue
        if let cached = rasterCache[name] { return cached }
        guard !unavailable.contains(name) else { return nil }
        guard let url = Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Images")
        else { unavailable.insert(name); return nil }
        #if canImport(UIKit)
        guard let plat = UIImage(contentsOfFile: url.path) else { unavailable.insert(name); return nil }
        let img = Image(uiImage: plat)
        #else
        guard let plat = NSImage(contentsOf: url) else { unavailable.insert(name); return nil }
        let img = Image(nsImage: plat)
        #endif
        rasterCache[name] = img
        return img
    }

    /// Parses the one bundled vector once and caches it.
    static func vector(_ asset: Asset) -> SVGDrawing? {
        let name = asset.rawValue
        if let cached = vectorCache[name] { return cached }
        guard !unavailable.contains(name) else { return nil }
        guard let url = Bundle.module.url(forResource: name, withExtension: "svg", subdirectory: "Images"),
              let data = try? Data(contentsOf: url),
              let drawing = SVGDrawing.parse(data)
        else { unavailable.insert(name); return nil }
        vectorCache[name] = drawing
        return drawing
    }

    /// Warms every home asset. Called on appear so switching to the Home tab never decodes inline.
    /// `brandLogo` is included because the login screen is the app's FIRST screen — it is the one
    /// asset that would otherwise decode while the user is looking at it.
    static func preload() {
        for a: Asset in [.puzzleKnight, .analysis, .video, .swiss, .appIcon, .brandLogo] { _ = raster(a) }
        _ = vector(.openingBook)
    }

    /// The art each grid tile uses. Play-with-Coach is absent on purpose: its app icon is drawn by
    /// the bespoke glowing squircle ring in HomeScreen, not by `HomeCardIcon`.
    static func asset(for card: HomeCard) -> Asset? {
        switch card {
        case .puzzles: return .puzzleKnight
        case .analysis: return .analysis
        case .videos: return .video
        case .openingTrainer: return .openingBook
        case .pairing: return .swiss
        case .playCoach: return nil
        }
    }

    /// Last-resort glyph if a bundled asset is missing, so a card degrades to a readable icon
    /// rather than a blank hole (same philosophy as PieceArt's Unicode fallback).
    static func fallbackSymbol(for card: HomeCard) -> String {
        switch card {
        case .puzzles: return "puzzlepiece.fill"
        case .analysis: return "chart.line.uptrend.xyaxis"
        case .videos: return "play.rectangle.fill"
        case .openingTrainer: return "book.closed.fill"
        case .playCoach: return "person.fill"
        case .pairing: return "trophy.fill"
        }
    }

    /// Resource-resolution report for `biyaherongDiagnostics()`. Deliberately `nonisolated` and
    /// cache-free: it answers "is the file in the bundle and does it parse", which is exactly the
    /// failure a missing `.copy("Images")` produces inside a packaged app.
    nonisolated static func diagnosticsSummary() -> String {
        var missing: [String] = []
        for name in ["puzzle_knight", "analysis", "video_icon", "swiss", "app-icon", "brand-logo"] {
            if Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Images") == nil {
                missing.append(name + ".png")
            }
        }
        var bookState = "ok"
        if let url = Bundle.module.url(forResource: "opening_book", withExtension: "svg", subdirectory: "Images"),
           let data = try? Data(contentsOf: url) {
            if SVGDrawing.parse(data) == nil { bookState = "PARSE FAILED" }
        } else {
            bookState = "MISSING"
        }
        return missing.isEmpty
            ? "all 6 PNGs resolve, opening_book.svg \(bookState)"
            : "MISSING \(missing.joined(separator: ", ")); opening_book.svg \(bookState)"
    }
}

/// A grid tile's icon, drawn aspect-fit inside a `size` square.
///
/// Raster art is untinted (it carries its own colour); the vector paints the colours baked into the
/// file. `.interpolation(.high)` matters here — the source PNGs are 512–1024 px being drawn at
/// 36–122 pt, so the default interpolation visibly aliases.
struct HomeCardIcon: View {
    let card: HomeCard
    let size: CGFloat

    var body: some View {
        content.frame(width: size, height: size)
    }

    @ViewBuilder private var content: some View {
        if let asset = HomeArt.asset(for: card) {
            if asset == .openingBook, let drawing = HomeArt.vector(asset) {
                Canvas { ctx, canvasSize in drawing.draw(in: &ctx, size: canvasSize) }
            } else if let img = HomeArt.raster(asset) {
                img.resizable().interpolation(.high).aspectRatio(contentMode: .fit)
            } else {
                fallback
            }
        } else {
            fallback
        }
    }

    private var fallback: some View {
        Image(systemName: HomeArt.fallbackSymbol(for: card))
            .font(.system(size: size * 0.62))
            .foregroundStyle(Theme.foreground)
    }
}

/// A bundled square mark, aspect-filled and clipped to `shape`. Used by the header logo (a circle),
/// the Play-with-Coach ring (a squircle) and — with `asset: .brandLogo` — the login hero.
///
/// `asset` is defaulted and declared last, so the two original call sites are unchanged.
struct HomeAppIcon<S: Shape>: View {
    let size: CGFloat
    let shape: S
    var asset: HomeArt.Asset = .appIcon

    var body: some View {
        Group {
            if let img = HomeArt.raster(asset) {
                img.resizable().interpolation(.high).aspectRatio(contentMode: .fill)
            } else {
                Theme.cardAlt
                    .overlay(Image(systemName: "crown.fill")
                        .font(.system(size: size * 0.42))
                        .foregroundStyle(Theme.gold))
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
    }
}
