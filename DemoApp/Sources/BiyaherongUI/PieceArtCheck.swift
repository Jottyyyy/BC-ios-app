import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the SVG piece renderer, in the same spirit as
// ParityRunner: this toolchain has no XCTest, so the assertions live in a
// runnable harness. `swift run PieceArtCheck` exits non-zero on any failure.
//
// Covers the twelve bundled pieces end-to-end plus the grammar/paint/transform
// edge cases that a visual spot-check cannot see. Path probes run under a
// watchdog so a non-terminating parse is reported as a failure instead of
// hanging the harness — the bug this file was written to keep out.

public struct PieceArtCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "PieceArtCheck: \(passed) assertions passed"
           : "PieceArtCheck: \(passed) passed, \(failures.count) FAILED\n" + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

@MainActor
public func biyaherongPieceArtCheck() -> PieceArtCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func near(_ a: CGFloat, _ b: CGFloat, _ tol: CGFloat = 0.01) -> Bool { abs(a - b) <= tol }
    func nearRect(_ r: CGRect, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ tol: CGFloat = 0.01) -> Bool {
        near(r.minX, x, tol) && near(r.minY, y, tol) && near(r.width, w, tol) && near(r.height, h, tol)
    }

    /// Runs `body` on a worker thread and fails the check if it does not finish.
    /// A parser that loops forever must not take the harness with it.
    func withWatchdog<T: Sendable>(_ label: String, seconds: Double = 3, _ body: @escaping @Sendable () -> T) -> T? {
        let box = UnsafeSendableBox<T>()
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { box.value = body(); done.signal() }
        guard done.wait(timeout: .now() + seconds) == .success else {
            failures.append("\(label): did not terminate within \(seconds)s (infinite loop?)")
            return nil
        }
        return box.value
    }

    func svg(_ body: String, viewBox: String = "0 0 45 45") -> SVGDrawing? {
        SVGDrawing.parse("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"\(viewBox)\">\(body)</svg>")
    }

    // ── 0. The bundled art IS the repo's asset set, byte for byte ────────────
    // SwiftPM resources must live inside the target, so Pieces/ mirrors
    // assets/images/chess-pieces/ (as Sounds/ mirrors assets/sounds/). A mirror
    // can drift; this pins it. Skipped when running from a shipped app bundle
    // rather than the source checkout.
    let assetDir = URL(fileURLWithPath: #filePath)     // …/DemoApp/Sources/BiyaherongUI/PieceArtCheck.swift
        .deletingLastPathComponent()                   // …/Sources/BiyaherongUI
        .deletingLastPathComponent()                   // …/Sources
        .deletingLastPathComponent()                   // …/DemoApp
        .deletingLastPathComponent()                   // repo root
        .appendingPathComponent("assets/images/chess-pieces")
    if FileManager.default.fileExists(atPath: assetDir.path) {
        let sourceNames = Set(((try? FileManager.default.contentsOfDirectory(atPath: assetDir.path)) ?? [])
            .filter { $0.hasSuffix(".svg") })
        expect(sourceNames.count == 12, "assets/images/chess-pieces holds \(sourceNames.count) SVGs, expected 12")
        for name in sourceNames.sorted() {
            let source = try? Data(contentsOf: assetDir.appendingPathComponent(name))
            let bundled = Bundle.module.url(forResource: String(name.dropLast(4)), withExtension: "svg", subdirectory: "Pieces")
                .flatMap { try? Data(contentsOf: $0) }
            expect(source != nil && source == bundled, "Pieces/\(name) has drifted from assets/images/chess-pieces/\(name)")
        }
    }

    // ── 1. The twelve bundled pieces ─────────────────────────────────────────
    // Element counts are the painted-shape counts in the shipped artwork; a change
    // here means a file was edited or the parser started dropping shapes.
    let expectedElements: [String: Int] = [
        "king-w": 6, "king-b": 8, "queen-w": 9, "queen-b": 10, "rook-w": 6, "rook-b": 7,
        "bishop-w": 6, "bishop-b": 6, "knight-w": 4, "knight-b": 5, "pawn-w": 1, "pawn-b": 1,
    ]
    for color in [PieceColor.white, .black] {
        for kind in [PieceKind.pawn, .knight, .bishop, .rook, .queen, .king] {
            let piece = Piece(color, kind)
            let name = PieceArt.assetName(for: piece)
            guard let drawing = PieceArt.drawing(for: piece) else {
                failures.append("\(name): failed to load or parse")
                continue
            }
            expect(drawing.viewBox == CGRect(x: 0, y: 0, width: 45, height: 45), "\(name): viewBox is \(drawing.viewBox)")
            expect(drawing.elements.count == expectedElements[name], "\(name): \(drawing.elements.count) elements, expected \(expectedElements[name] ?? -1)")
            expect(drawing.elements.allSatisfy { $0.fill != nil || $0.stroke != nil }, "\(name): an element paints nothing")
            // Artwork plus its stroke must stay inside the viewBox, or it clips on the board.
            let inked = drawing.elements.reduce(CGRect.null) { $0.union($1.path.boundingRect.insetBy(dx: -$1.lineWidth / 2, dy: -$1.lineWidth / 2)) }
            expect(drawing.viewBox.insetBy(dx: -0.5, dy: -0.5).contains(inked), "\(name): ink \(inked) escapes the viewBox")
        }
    }

    // ── 2. Path grammar ──────────────────────────────────────────────────────
    // Closepath consumes no operands: a stray token after it must be rejected, not looped on.
    for bad in ["M0 0 L10 0 L10 10 Z 5 5", "M 0,0 L 1,1 z.", "M0 0 Z 1", "M0 0 L1 1 z z 2 2"] {
        if let r = withWatchdog("path \"\(bad)\"", { SVGPathData.parse(bad) }) {
            expect(r == nil, "path \"\(bad)\": expected nil, got a path")
        }
    }
    expect(SVGPathData.parse("M0 0 L10 0 L10 10 Z") != nil, "a well-formed closed triangle should parse")
    expect(SVGPathData.parse("M0 0 L10 0 Z L20 20") != nil, "a drawto after closepath should parse")
    expect(SVGPathData.parse("L 1 1") == nil, "a drawto with no preceding moveto should fail")
    expect(SVGPathData.parse("") == nil, "empty path data should fail")
    expect(SVGPathData.parse("M 0,0 Q 1,1") == nil, "a truncated operand list should fail")
    // Number forms: sign-as-separator, repeated decimals, exponents.
    if let p = SVGPathData.parse("M-1-2L-3-4") { expect(nearRect(p.boundingRect, -3, -4, 2, 2), "sign-as-separator bounds \(p.boundingRect)") }
    else { failures.append("\"M-1-2L-3-4\" (sign as separator) failed to parse") }
    expect(SVGPathData.parse("M1.5.5.5.5") != nil, "\"M1.5.5.5.5\" should parse as (1.5,0.5) then (0.5,0.5)")
    if let p = SVGPathData.parse("M0 0 L1e2 0") { expect(near(p.boundingRect.maxX, 100), "exponent notation should reach x=100") }
    else { failures.append("exponent notation failed to parse") }
    // Implicit repetition and the shorthand commands.
    if let p = SVGPathData.parse("M0 0 h10 v10 h-10 z") { expect(nearRect(p.boundingRect, 0, 0, 10, 10), "h/v square bounds \(p.boundingRect)") }
    else { failures.append("h/v square failed to parse") }
    if let p = SVGPathData.parse("M0 0 L10 0 10 10 0 10") { expect(nearRect(p.boundingRect, 0, 0, 10, 10), "implicit line-to bounds \(p.boundingRect)") }
    else { failures.append("implicit line-to after M failed to parse") }

    // ── 3. Arcs ──────────────────────────────────────────────────────────────
    // The knight's nose: two half-arcs closing a unit circle centred (9,25.5).
    if let p = SVGPathData.parse("M 9.5,25.5 A 0.5,0.5,0 1,1 8.5,25.5 A 0.5,0.5,0 1,1 9.5,25.5 Z") {
        expect(nearRect(p.boundingRect, 8.5, 25.0, 1.0, 1.0, 0.02), "arc circle bounds \(p.boundingRect)")
    } else { failures.append("knight nose arc failed to parse") }
    // The knight's eye: a 30°-rotated ellipse whose radii need the F.6.6 scale-up.
    // Centre is the endpoints' midpoint (14.5, 15.5); the half-extents of a rotated
    // ellipse are √(rx²cos²φ + ry²sin²φ) = 0.866 and √(rx²sin²φ + ry²cos²φ) = 1.323.
    if let p = SVGPathData.parse("M 15.25,14.2 A 0.5,1.5,30 1,1 13.75,16.8 A 0.5,1.5,30 1,1 15.25,14.2 Z") {
        expect(nearRect(p.boundingRect, 14.5 - 0.866, 15.5 - 1.323, 1.732, 2.646, 0.01), "rotated-ellipse arc bounds \(p.boundingRect)")
    } else { failures.append("knight eye arc failed to parse") }
    expect(SVGPathData.parse("M0 0 A 0,5,0 0,1 10,0") != nil, "a zero-radius arc should degenerate to a line, not fail")
    expect(SVGPathData.parse("M5 5 A 2,2,0 0,1 5,5") != nil, "an arc with coincident endpoints should be skipped, not fail")
    for large in ["0", "1"] { for sweep in ["0", "1"] {
        expect(SVGPathData.parse("M0 0 A 5,3,20 \(large),\(sweep) 8,4") != nil, "arc flags \(large)/\(sweep) should parse")
    } }
    expect(SVGPathData.parse("M0 0 a1 1 0 118.5 25.5") != nil, "arc flags with no separator should parse")

    // ── 4. Transforms ────────────────────────────────────────────────────────
    if let d = svg("<g transform=\"translate(20,20) scale(2)\"><path d=\"M0 0 L5 0 L5 5 Z\" fill=\"#000\"/></g>"),
       let e = d.elements.first {
        expect(nearRect(e.path.boundingRect, 20, 20, 10, 10), "translate+scale bounds \(e.path.boundingRect)")
    } else { failures.append("translate+scale group failed to parse") }
    if let d = svg("<g transform=\"translate(10,0)\"><g transform=\"translate(0,5)\"><path d=\"M0 0 L2 0 L2 2 Z\" fill=\"#000\"/></g></g>"),
       let e = d.elements.first {
        expect(nearRect(e.path.boundingRect, 10, 5, 2, 2), "nested translate bounds \(e.path.boundingRect)")
    } else { failures.append("nested translate failed to parse") }
    if let d = svg("<path transform=\"matrix(2,0,0,2,1,1)\" d=\"M0 0 L3 0 L3 3 Z\" fill=\"none\" stroke=\"#000\" stroke-width=\"1.5\"/>"),
       let e = d.elements.first {
        expect(nearRect(e.path.boundingRect, 1, 1, 6, 6), "matrix bounds \(e.path.boundingRect)")
        expect(near(e.lineWidth, 3), "stroke width should scale with the matrix, got \(e.lineWidth)")
    } else { failures.append("matrix transform failed to parse") }
    if let d = svg("<path transform=\"rotate(90)\" d=\"M1 0 L2 0 L2 1 Z\" fill=\"#000\"/>"), let e = d.elements.first {
        expect(nearRect(e.path.boundingRect, -1, 1, 1, 1), "rotate(90) bounds \(e.path.boundingRect)")
    } else { failures.append("rotate transform failed to parse") }
    expect(svg("<path transform=\"warp(2)\" d=\"M0 0 L1 1\" fill=\"#000\"/>") == nil, "an unknown transform function should fail the drawing")
    expect(svg("<path transform=\"translate(1,2,3)\" d=\"M0 0 L1 1\" fill=\"#000\"/>") == nil, "a wrong-arity transform should fail the drawing")

    // ── 5. Paint ─────────────────────────────────────────────────────────────
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"rgb(255,255,255)\"/>") != nil, "rgb() should parse")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"rgba(255,255,255,0.5)\"/>") != nil, "rgba() should parse")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"#ffffffff\"/>") != nil, "8-digit hex should parse")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"#fff8\"/>") != nil, "4-digit hex should parse")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"white\"/>") != nil, "a named colour should parse")
    // Guessing a colour we cannot read would repaint a white piece black — fail instead.
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"currentColor\"/>") == nil, "currentColor should fail rather than guess")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"url(#grad)\"/>") == nil, "a gradient reference should fail rather than guess")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"hsl(0,0%,100%)\"/>") == nil, "an unsupported colour function should fail")
    expect(svg("<path d=\"M0 0 L1 1\" fill=\"none\"/>") == nil, "a document where nothing paints should fail rather than render blank")
    if let d = svg("<g fill=\"#000\"><path d=\"M0 0 L1 1\" fill=\"none\" stroke=\"#FFF\"/></g>"), let e = d.elements.first {
        expect(e.fill == nil && e.stroke != nil, "an element override should beat the group's fill")
    } else { failures.append("group/element paint override failed to parse") }

    // ── 6. Lengths, shapes, and structure ────────────────────────────────────
    if let d = svg("<path d=\"M0 0 L1 1\" fill=\"none\" stroke=\"#000\" stroke-width=\"1.5px\"/>"), let e = d.elements.first {
        expect(near(e.lineWidth, 1.5), "a px stroke-width should read 1.5, got \(e.lineWidth)")
    } else { failures.append("px stroke-width failed to parse") }
    expect(svg("<circle cx=\"5\" cy=\"5\" r=\"0.5px\" fill=\"#000\"/>")?.elements.count == 1, "a px radius should keep the circle")
    expect(svg("<path d=\"M0 0 L1 1\" stroke-width=\"50%\" stroke=\"#000\"/>") == nil, "a percentage length should fail rather than be misread")
    if let d = svg("<rect x=\"0\" y=\"0\" width=\"40\" height=\"10\" rx=\"8\" ry=\"2\" fill=\"#000\"/>"), let e = d.elements.first {
        expect(nearRect(e.path.boundingRect, 0, 0, 40, 10), "rect bounds \(e.path.boundingRect)")
    } else { failures.append("rect with distinct rx/ry failed to parse") }
    expect(svg("<defs><path d=\"M0 0 L1 1\" fill=\"#000\"/></defs><path d=\"M2 2 L3 3\" fill=\"#000\"/>")?.elements.count == 1,
           "content inside <defs> should not paint")
    expect(svg("<text x=\"0\" y=\"0\">K</text>") == nil, "an unsupported renderable element should fail the drawing")
    expect(svg("<title>King</title><path d=\"M0 0 L1 1\" fill=\"#000\"/>")?.elements.count == 1, "<title> should be ignored, not fail")
    expect(svg("<path d=\"M0 0 L1 1 L\" fill=\"#000\"/>") == nil, "one malformed path should fail the whole drawing")
    expect(SVGDrawing.parse("<svg viewBox=\"0 0 45 45\"><path d=\"M0 0 L1 1\" fill=\"#000\"") == nil,
           "truncated XML should fail rather than ship partial art")
    expect(SVGDrawing.parse("") == nil, "empty input should fail")
    // No viewBox: fall back to the intrinsic width/height.
    expect(SVGDrawing.parse("<svg width=\"45\" height=\"45\"><path d=\"M0 0 L1 1\" fill=\"#000\"/></svg>")?.viewBox
           == CGRect(x: 0, y: 0, width: 45, height: 45), "width/height should back-fill a missing viewBox")

    return PieceArtCheckResult(passed: passed, failures: failures)
}

/// Minimal box for handing a worker thread's result back across the watchdog.
private final class UnsafeSendableBox<T>: @unchecked Sendable {
    var value: T?
}
