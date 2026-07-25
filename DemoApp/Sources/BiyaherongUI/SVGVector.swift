import Foundation
import SwiftUI

// A tiny, dependency-free renderer for the SVG subset the bundled artwork uses:
// <svg viewBox> / <g> / <path> / <circle> / <ellipse> / <line> / <rect> /
// <polygon> / <polyline>, with paint attributes (fill, stroke, stroke-width,
// stroke-linecap, stroke-linejoin, inline style="…") and `transform` inherited
// down the element tree.
//
// Staying vector means one asset serves every size — a 41 pt phone board square,
// a 60 pt desktop one and a 46 pt promotion button are all crisp off the same
// file, with no @2x/@3x rasters to keep in sync.
//
// Failure policy: parsing is all-or-nothing on purpose. Anything this renderer
// cannot reproduce faithfully — a malformed path, an unsupported paint or
// transform, a truncated document — fails the whole drawing so `PieceImage`
// falls back to a complete Unicode glyph. Half-parsed art (a headless king) is
// far worse than an honest fallback, and silently wrong art (a white piece
// painted black) is worse still.

/// A parsed SVG flattened into an ordered list of painted paths, in viewBox units.
struct SVGDrawing: Sendable {
    struct Element: Sendable {
        var path: Path
        var fill: Color?          // nil == fill="none"
        var stroke: Color?        // nil == stroke="none"
        var lineWidth: CGFloat
        var lineCap: CGLineCap
        var lineJoin: CGLineJoin
    }

    var viewBox: CGRect
    var elements: [Element]

    /// Paints the drawing centred and aspect-fit inside `size`.
    /// Stroke widths ride the same transform, exactly as an SVG renderer scales them.
    func draw(in ctx: inout GraphicsContext, size: CGSize) {
        guard viewBox.width > 0, viewBox.height > 0, size.width > 0, size.height > 0 else { return }
        let scale = min(size.width / viewBox.width, size.height / viewBox.height)
        ctx.translateBy(x: (size.width - viewBox.width * scale) / 2,
                        y: (size.height - viewBox.height * scale) / 2)
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -viewBox.minX, y: -viewBox.minY)
        for e in elements {
            // SVG paints each element's fill first, then its stroke, before moving on.
            if let fill = e.fill { ctx.fill(e.path, with: .color(fill)) }
            if let stroke = e.stroke, e.lineWidth > 0 {
                ctx.stroke(e.path, with: .color(stroke),
                           style: StrokeStyle(lineWidth: e.lineWidth, lineCap: e.lineCap,
                                              lineJoin: e.lineJoin, miterLimit: 4))   // SVG's default miterlimit
            }
        }
    }

    static func parse(_ source: String) -> SVGDrawing? {
        guard let data = source.data(using: .utf8) else { return nil }
        return parse(data)
    }

    static func parse(_ data: Data) -> SVGDrawing? {
        let parser = XMLParser(data: data)
        let sink = SVGDocumentParser()
        parser.delegate = sink                       // XMLParser holds this weakly
        parser.shouldResolveExternalEntities = false // never touch the DOCTYPE's DTD URL
        parser.shouldProcessNamespaces = false
        // A false return means malformed or truncated XML. Trusting the elements
        // collected so far would ship a piece with limbs missing.
        guard parser.parse(), !sink.failed, !sink.elements.isEmpty else { return nil }
        var box = sink.viewBox
        if box.width <= 0 || box.height <= 0 {
            guard let w = sink.width, let h = sink.height, w > 0, h > 0 else { return nil }
            box = CGRect(x: 0, y: 0, width: w, height: h)
        }
        return SVGDrawing(viewBox: box, elements: sink.elements)
    }
}

/// A SwiftUI view for any parsed drawing.
struct SVGVectorView: View {
    let drawing: SVGDrawing
    var body: some View {
        Canvas { ctx, size in drawing.draw(in: &ctx, size: size) }
    }
}

// MARK: - Inherited state

/// The inheritable presentation attributes plus the current transform, seeded
/// with the SVG initial values.
private struct SVGState {
    var fill: Color? = .black
    var stroke: Color? = nil
    var lineWidth: CGFloat = 1
    var lineCap: CGLineCap = .butt
    var lineJoin: CGLineJoin = .miter
    var transform: CGAffineTransform = .identity

    private static let caps: [String: CGLineCap] = ["butt": .butt, "round": .round, "square": .square]
    private static let joins: [String: CGLineJoin] = ["miter": .miter, "round": .round, "bevel": .bevel]
    private static let inheritable = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]

    /// Returns false if a value is present but not something we can reproduce.
    mutating func set(_ key: String, _ rawValue: String) -> Bool {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value == "inherit" { return true }
        switch key {
        case "fill", "stroke":
            guard let paint = SVGColor.parse(value) else { return false }
            if key == "fill" { fill = paint.color } else { stroke = paint.color }
        case "stroke-width":
            guard let n = SVGLength.parse(value) else { return false }
            lineWidth = n
        case "stroke-linecap":
            guard let c = Self.caps[value.lowercased()] else { return false }
            lineCap = c
        case "stroke-linejoin":
            guard let j = Self.joins[value.lowercased()] else { return false }
            lineJoin = j
        default: break
        }
        return true
    }

    /// Presentation attributes first, then `style="…"` — which wins, per CSS cascade.
    /// `transform` composes onto the inherited matrix.
    mutating func apply(_ attributes: [String: String]) -> Bool {
        for key in Self.inheritable {
            if let v = attributes[key], !set(key, v) { return false }
        }
        if let style = attributes["style"] {
            for declaration in style.split(separator: ";") {
                let parts = declaration.split(separator: ":", maxSplits: 1)
                guard parts.count == 2 else { continue }
                let key = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                guard Self.inheritable.contains(key) else { continue }
                if !set(key, String(parts[1])) { return false }
            }
        }
        if let raw = attributes["transform"] {
            guard let local = SVGTransform.parse(raw) else { return false }
            transform = local.concatenating(transform)   // local applies first, then the inherited matrix
        }
        return true
    }

    /// SVG scales stroke width by the current transform; sqrt(|det|) is the
    /// standard scalar approximation for a non-uniform matrix.
    var strokeScale: CGFloat {
        let det = abs(transform.a * transform.d - transform.b * transform.c)
        return det > 0 ? sqrt(det) : 1
    }
}

// MARK: - Value parsing

/// SVG user units. Absolute unit suffixes are converted; percentages need a
/// viewport we do not have, so they are rejected rather than silently misread.
private enum SVGLength {
    private static let units: [(String, CGFloat)] = [
        ("px", 1), ("pt", 96.0 / 72), ("pc", 16), ("mm", 96 / 25.4), ("cm", 96 / 2.54), ("in", 96),
    ]

    static func parse(_ raw: String) -> CGFloat? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !s.isEmpty, !s.hasSuffix("%") else { return nil }
        for (unit, factor) in units where s.hasSuffix(unit) {
            guard let v = Double(s.dropLast(unit.count).trimmingCharacters(in: .whitespaces)) else { return nil }
            return CGFloat(v) * factor
        }
        guard let v = Double(s) else { return nil }
        return CGFloat(v)
    }
}

private enum SVGColor {
    /// `nil` return == unsupported. A supported "none" is a `Paint` with a nil colour.
    struct Paint { var color: Color? }

    static func parse(_ raw: String) -> Paint? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if s == "none" || s == "transparent" { return Paint(color: nil) }
        // currentColor has no meaning without an inherited text colour, and gradient/
        // pattern references need <defs> we do not render. Both must fail loudly:
        // guessing black here would silently repaint a white piece.
        if s == "currentcolor" || s.hasPrefix("url(") { return nil }

        if s.hasPrefix("#") {
            let hex = Array(s.dropFirst())
            func nib(_ i: Int) -> Double? { hex[i].hexDigitValue.map { Double($0) / 15 } }
            func byte(_ i: Int) -> Double? {
                guard let hi = hex[i].hexDigitValue, let lo = hex[i + 1].hexDigitValue else { return nil }
                return Double(hi * 16 + lo) / 255
            }
            switch hex.count {
            case 3:
                guard let r = nib(0), let g = nib(1), let b = nib(2) else { return nil }
                return Paint(color: rgb(r, g, b))
            case 4:
                guard let r = nib(0), let g = nib(1), let b = nib(2), let a = nib(3) else { return nil }
                return Paint(color: rgb(r, g, b, a))
            case 6:
                guard let r = byte(0), let g = byte(2), let b = byte(4) else { return nil }
                return Paint(color: rgb(r, g, b))
            case 8:
                guard let r = byte(0), let g = byte(2), let b = byte(4), let a = byte(6) else { return nil }
                return Paint(color: rgb(r, g, b, a))
            default:
                return nil
            }
        }

        if s.hasPrefix("rgb(") || s.hasPrefix("rgba(") {
            let inner = s.drop { $0 != "(" }.dropFirst().prefix { $0 != ")" }
            let parts = inner.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
                             .map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 3 || parts.count == 4 else { return nil }
            func channel(_ t: String) -> Double? {
                if t.hasSuffix("%") { return Double(t.dropLast()).map { $0 / 100 } }
                return Double(t).map { $0 / 255 }
            }
            guard let r = channel(parts[0]), let g = channel(parts[1]), let b = channel(parts[2]) else { return nil }
            var a = 1.0
            if parts.count == 4 {
                let t = parts[3]
                guard let v = t.hasSuffix("%") ? Double(t.dropLast()).map({ $0 / 100 }) : Double(t) else { return nil }
                a = v
            }
            return Paint(color: rgb(r, g, b, a))
        }

        return named[s].map { Paint(color: $0) }
    }

    private static func rgb(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) -> Color {
        Color(.sRGB, red: min(1, max(0, r)), green: min(1, max(0, g)), blue: min(1, max(0, b)),
              opacity: min(1, max(0, a)))
    }

    private static let named: [String: Color] = [
        "black": rgb(0, 0, 0), "white": rgb(1, 1, 1),
        "gray": rgb(0.5, 0.5, 0.5), "grey": rgb(0.5, 0.5, 0.5),
        "silver": rgb(0.753, 0.753, 0.753), "dimgray": rgb(0.412, 0.412, 0.412),
        "lightgray": rgb(0.827, 0.827, 0.827), "lightgrey": rgb(0.827, 0.827, 0.827),
        "darkgray": rgb(0.663, 0.663, 0.663), "darkgrey": rgb(0.663, 0.663, 0.663),
        "red": rgb(1, 0, 0), "green": rgb(0, 0.502, 0), "blue": rgb(0, 0, 1),
        "yellow": rgb(1, 1, 0), "orange": rgb(1, 0.647, 0), "brown": rgb(0.647, 0.165, 0.165),
        "tan": rgb(0.824, 0.706, 0.549), "beige": rgb(0.961, 0.961, 0.863),
    ]
}

private enum SVGTransform {
    /// `translate(…) scale(…) rotate(…) skewX(…) skewY(…) matrix(…)`, composed
    /// left-to-right: the leftmost function is the outermost, so it applies last.
    static func parse(_ raw: String) -> CGAffineTransform? {
        var result = CGAffineTransform.identity
        var rest = Substring(raw)
        var sawAny = false
        while true {
            rest = rest.drop { $0 == " " || $0 == "," || $0.isNewline || $0 == "\t" }
            guard !rest.isEmpty else { break }
            guard let open = rest.firstIndex(of: "("), let close = rest.firstIndex(of: ")"), open < close
            else { return nil }
            let name = rest[rest.startIndex..<open].trimmingCharacters(in: .whitespacesAndNewlines)
            var scan = PathScanner(String(rest[rest.index(after: open)..<close]))
            var args: [CGFloat] = []
            while let n = scan.number() { args.append(n) }
            guard scan.atEnd() else { return nil }          // trailing junk inside the parens
            guard let local = matrix(name, args) else { return nil }
            result = local.concatenating(result)
            sawAny = true
            rest = rest[rest.index(after: close)...]
        }
        return sawAny ? result : nil
    }

    private static func matrix(_ name: String, _ a: [CGFloat]) -> CGAffineTransform? {
        func radians(_ degrees: CGFloat) -> CGFloat { degrees * .pi / 180 }
        switch name {
        case "translate" where a.count == 1: return CGAffineTransform(translationX: a[0], y: 0)
        case "translate" where a.count == 2: return CGAffineTransform(translationX: a[0], y: a[1])
        case "scale" where a.count == 1:     return CGAffineTransform(scaleX: a[0], y: a[0])
        case "scale" where a.count == 2:     return CGAffineTransform(scaleX: a[0], y: a[1])
        case "rotate" where a.count == 1:    return CGAffineTransform(rotationAngle: radians(a[0]))
        case "rotate" where a.count == 3:
            return CGAffineTransform(translationX: -a[1], y: -a[2])
                .concatenating(CGAffineTransform(rotationAngle: radians(a[0])))
                .concatenating(CGAffineTransform(translationX: a[1], y: a[2]))
        case "skewx" where a.count == 1:     return CGAffineTransform(a: 1, b: 0, c: tan(radians(a[0])), d: 1, tx: 0, ty: 0)
        case "skewy" where a.count == 1:     return CGAffineTransform(a: 1, b: tan(radians(a[0])), c: 0, d: 1, tx: 0, ty: 0)
        // SVG matrix(a b c d e f) maps directly onto CoreGraphics' row-vector form.
        case "matrix" where a.count == 6:    return CGAffineTransform(a: a[0], b: a[1], c: a[2], d: a[3], tx: a[4], ty: a[5])
        default: return nil
        }
    }
}

// MARK: - Document parsing

private final class SVGDocumentParser: NSObject, XMLParserDelegate {
    private(set) var viewBox = CGRect.zero
    private(set) var width: CGFloat?
    private(set) var height: CGFloat?
    private(set) var elements: [SVGDrawing.Element] = []
    private(set) var failed = false

    private var stack: [SVGState] = [SVGState()]
    private var skipDepth = 0        // inside <defs>/<clipPath>/… — never painted

    /// Renderable content this parser cannot reproduce. Meeting one fails the
    /// document rather than quietly dropping visible art.
    private static let unsupported: Set<String> = ["text", "tspan", "image", "use", "foreignObject", "switch", "style"]
    /// Definition containers: their content never paints directly, so skipping is correct.
    private static let definitions: Set<String> = ["defs", "clipPath", "mask", "symbol", "marker", "pattern"]

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        var state = stack.last ?? SVGState()
        if !state.apply(attributeDict) { failed = true }
        stack.append(state)

        if skipDepth > 0 { skipDepth += 1; return }
        if Self.unsupported.contains(elementName) { failed = true; return }
        if Self.definitions.contains(elementName) { skipDepth = 1; return }
        guard !failed else { return }

        /// A required geometry attribute: absent uses `fallback`, present-but-unreadable fails.
        func length(_ key: String, _ fallback: CGFloat = 0) -> CGFloat? {
            guard let raw = attributeDict[key] else { return fallback }
            guard let v = SVGLength.parse(raw) else { failed = true; return nil }
            return v
        }

        switch elementName {
        case "svg":
            if let vb = attributeDict["viewBox"] {
                guard let r = Self.parseViewBox(vb) else { failed = true; return }
                viewBox = r
            }
            width = attributeDict["width"].flatMap(SVGLength.parse)
            height = attributeDict["height"].flatMap(SVGLength.parse)

        case "path":
            guard let d = attributeDict["d"] else { break }
            guard let p = SVGPathData.parse(d) else { failed = true; return }
            emit(p, state)

        case "circle":
            guard let cx = length("cx"), let cy = length("cy"), let r = length("r") else { return }
            guard r > 0 else { break }
            emit(Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)), state)

        case "ellipse":
            guard let cx = length("cx"), let cy = length("cy"),
                  let rx = length("rx"), let ry = length("ry") else { return }
            guard rx > 0, ry > 0 else { break }
            emit(Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2)), state)

        case "rect":
            guard let x = length("x"), let y = length("y"),
                  let w = length("width"), let h = length("height"),
                  let rx0 = length("rx", -1), let ry0 = length("ry", -1) else { return }
            guard w > 0, h > 0 else { break }
            let rect = CGRect(x: x, y: y, width: w, height: h)
            // Per SVG, an omitted rx/ry mirrors the other; both omitted means square corners.
            let rx = rx0 >= 0 ? rx0 : max(0, ry0), ry = ry0 >= 0 ? ry0 : max(0, rx0)
            emit(rx > 0 || ry > 0
                 ? Path(roundedRect: rect, cornerSize: CGSize(width: rx, height: ry))
                 : Path(rect), state)

        case "line":
            guard let x1 = length("x1"), let y1 = length("y1"),
                  let x2 = length("x2"), let y2 = length("y2") else { return }
            var p = Path()
            p.move(to: CGPoint(x: x1, y: y1))
            p.addLine(to: CGPoint(x: x2, y: y2))
            emit(p, state)

        case "polygon", "polyline":
            guard let raw = attributeDict["points"] else { break }
            guard let p = Self.parsePoints(raw, close: elementName == "polygon") else { failed = true; return }
            emit(p, state)

        default:
            break   // <g>, <title>, <desc>, <metadata>, unknown wrappers: nothing to paint
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if stack.count > 1 { stack.removeLast() }
        if skipDepth > 0 { skipDepth -= 1 }
    }

    func parser(_ parser: XMLParser, parseErrorOccurred parseError: any Error) { failed = true }

    private func emit(_ path: Path, _ state: SVGState) {
        guard state.fill != nil || state.stroke != nil else { return }
        let shaped = state.transform.isIdentity ? path : path.applying(state.transform)
        elements.append(.init(path: shaped, fill: state.fill, stroke: state.stroke,
                              lineWidth: state.lineWidth * state.strokeScale,
                              lineCap: state.lineCap, lineJoin: state.lineJoin))
    }

    private static func parseViewBox(_ raw: String) -> CGRect? {
        let parts = raw.split(whereSeparator: { $0 == " " || $0 == "," || $0.isNewline || $0 == "\t" })
                       .compactMap { Double($0) }
        guard parts.count == 4, parts[2] > 0, parts[3] > 0 else { return nil }
        return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    }

    private static func parsePoints(_ raw: String, close: Bool) -> Path? {
        let fields = raw.split(whereSeparator: { $0 == " " || $0 == "," || $0.isNewline || $0 == "\t" })
        let nums = fields.compactMap { Double($0) }
        guard nums.count == fields.count, nums.count >= 4, nums.count % 2 == 0 else { return nil }
        var p = Path()
        p.move(to: CGPoint(x: nums[0], y: nums[1]))
        var i = 2
        while i + 1 < nums.count { p.addLine(to: CGPoint(x: nums[i], y: nums[i + 1])); i += 2 }
        if close { p.closeSubpath() }
        return p
    }
}

// MARK: - Path data ("d" attribute)

enum SVGPathData {
    /// Full SVG 1.1 path grammar: M L H V C S Q T A Z, absolute and relative,
    /// with implicit command repetition.
    ///
    /// Every iteration either consumes at least one byte or returns nil, so the
    /// loop always terminates. Closepath is the one command that reads no
    /// operands, which is why it clears `command`: leaving it set would let a
    /// stray trailing token (`"… Z 5 5"`) re-enter the Z arm forever.
    static func parse(_ d: String) -> Path? {
        var scan = PathScanner(d)
        var path = Path()
        var cur = CGPoint.zero
        var subpathStart = CGPoint.zero
        var prevCubicControl: CGPoint?
        var prevQuadControl: CGPoint?
        var command: Character?
        var opened = false

        while !scan.atEnd() {
            if scan.atCommand() { command = scan.takeCommand() }
            guard let c = command else { return nil }   // operands with no command in effect
            let relative = c.isLowercase

            // Reads current-point-relative or absolute coordinates. `cur` is captured
            // by reference, so this always sees the live current point.
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                relative ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y)
            }

            switch c {
            case "M", "m":
                guard let x = scan.number(), let y = scan.number() else { return nil }
                cur = point(x, y); subpathStart = cur
                path.move(to: cur)
                opened = true
                prevCubicControl = nil; prevQuadControl = nil
                command = relative ? "l" : "L"          // further coordinate pairs are line-tos

            case "L", "l":
                guard opened, let x = scan.number(), let y = scan.number() else { return nil }
                cur = point(x, y); path.addLine(to: cur)
                prevCubicControl = nil; prevQuadControl = nil

            case "H", "h":
                guard opened, let x = scan.number() else { return nil }
                cur = CGPoint(x: relative ? cur.x + x : x, y: cur.y); path.addLine(to: cur)
                prevCubicControl = nil; prevQuadControl = nil

            case "V", "v":
                guard opened, let y = scan.number() else { return nil }
                cur = CGPoint(x: cur.x, y: relative ? cur.y + y : y); path.addLine(to: cur)
                prevCubicControl = nil; prevQuadControl = nil

            case "C", "c":
                guard opened,
                      let x1 = scan.number(), let y1 = scan.number(),
                      let x2 = scan.number(), let y2 = scan.number(),
                      let x = scan.number(), let y = scan.number() else { return nil }
                let c1 = point(x1, y1), c2 = point(x2, y2), end = point(x, y)
                path.addCurve(to: end, control1: c1, control2: c2)
                cur = end; prevCubicControl = c2; prevQuadControl = nil

            case "S", "s":
                guard opened,
                      let x2 = scan.number(), let y2 = scan.number(),
                      let x = scan.number(), let y = scan.number() else { return nil }
                let c1 = prevCubicControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let c2 = point(x2, y2), end = point(x, y)
                path.addCurve(to: end, control1: c1, control2: c2)
                cur = end; prevCubicControl = c2; prevQuadControl = nil

            case "Q", "q":
                guard opened,
                      let x1 = scan.number(), let y1 = scan.number(),
                      let x = scan.number(), let y = scan.number() else { return nil }
                let cp = point(x1, y1), end = point(x, y)
                path.addQuadCurve(to: end, control: cp)
                cur = end; prevQuadControl = cp; prevCubicControl = nil

            case "T", "t":
                guard opened, let x = scan.number(), let y = scan.number() else { return nil }
                let cp = prevQuadControl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
                let end = point(x, y)
                path.addQuadCurve(to: end, control: cp)
                cur = end; prevQuadControl = cp; prevCubicControl = nil

            case "A", "a":
                guard opened,
                      let rx = scan.number(), let ry = scan.number(), let rotation = scan.number(),
                      let largeArc = scan.flag(), let sweep = scan.flag(),
                      let x = scan.number(), let y = scan.number() else { return nil }
                let end = point(x, y)
                appendArc(&path, from: cur, to: end, rx: rx, ry: ry,
                          rotationDegrees: rotation, largeArc: largeArc, sweep: sweep)
                cur = end; prevCubicControl = nil; prevQuadControl = nil

            case "Z", "z":
                guard opened else { return nil }
                path.closeSubpath()
                cur = subpathStart                       // a closed subpath leaves the pen at its start
                prevCubicControl = nil; prevQuadControl = nil
                command = nil                            // closepath takes no operands — see the note above

            default:
                return nil
            }
        }
        return opened ? path : nil
    }

    /// Endpoint→centre arc conversion (SVG 1.1 §F.6.5/F.6.6), emitted as ≤90° cubics.
    private static func appendArc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint,
                                  rx rxIn: CGFloat, ry ryIn: CGFloat, rotationDegrees: CGFloat,
                                  largeArc: Bool, sweep: Bool) {
        // Coincident endpoints mean "no arc"; a zero radius degenerates to a line.
        if p0 == p1 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        guard rx > 0, ry > 0 else { path.addLine(to: p1); return }

        let phi = rotationDegrees * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 =  cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy

        // F.6.6 — scale radii up if they can't span the chord.
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { let s = sqrt(lambda); rx *= s; ry *= s }

        let rx2 = rx * rx, ry2 = ry * ry, x12 = x1 * x1, y12 = y1 * y1
        let denominator = rx2 * y12 + ry2 * x12
        let numerator = max(0, rx2 * ry2 - rx2 * y12 - ry2 * x12)   // clamp float noise at λ ≈ 1
        var coefficient = denominator > 0 ? sqrt(numerator / denominator) : 0
        if largeArc == sweep { coefficient = -coefficient }

        let cxp = coefficient * (rx * y1 / ry)
        let cyp = coefficient * (-ry * x1 / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let norm = sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy)
            guard norm > 0 else { return 0 }
            var a = acos(min(1, max(-1, (ux * vx + uy * vy) / norm)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let ux = (x1 - cxp) / rx, uy = (y1 - cyp) / ry
        let vx = (-x1 - cxp) / rx, vy = (-y1 - cyp) / ry
        let theta = angle(1, 0, ux, uy)
        var sweepAngle = angle(ux, uy, vx, vy)
        if !sweep, sweepAngle > 0 { sweepAngle -= 2 * .pi }
        else if sweep, sweepAngle < 0 { sweepAngle += 2 * .pi }

        let segments = max(1, Int(ceil(abs(sweepAngle) / (.pi / 2))))
        let delta = sweepAngle / CGFloat(segments)
        let handle = 4.0 / 3.0 * tan(delta / 4)          // bezier approximation of a circular sector

        func onEllipse(_ t: CGFloat) -> CGPoint {
            CGPoint(x: cosPhi * rx * cos(t) - sinPhi * ry * sin(t) + cx,
                    y: sinPhi * rx * cos(t) + cosPhi * ry * sin(t) + cy)
        }
        func tangent(_ t: CGFloat) -> CGPoint {
            CGPoint(x: -cosPhi * rx * sin(t) - sinPhi * ry * cos(t),
                    y: -sinPhi * rx * sin(t) + cosPhi * ry * cos(t))
        }

        var t0 = theta
        var from = p0
        for i in 0..<segments {
            let t1 = t0 + delta
            // Land the final point exactly on the requested endpoint.
            let to = (i == segments - 1) ? p1 : onEllipse(t1)
            let d0 = tangent(t0), d1 = tangent(t1)
            path.addCurve(to: to,
                          control1: CGPoint(x: from.x + handle * d0.x, y: from.y + handle * d0.y),
                          control2: CGPoint(x: to.x - handle * d1.x, y: to.y - handle * d1.y))
            from = to; t0 = t1
        }
    }
}

/// Byte scanner for path data and transform arguments: numbers may be separated
/// by whitespace, commas or nothing at all (`M-1-2`), and arc flags are single
/// `0`/`1` characters that may run together with what follows.
private struct PathScanner {
    private let bytes: [UInt8]
    private var i = 0

    init(_ s: String) { bytes = Array(s.utf8) }

    private mutating func skipSeparators() {
        while i < bytes.count {
            switch bytes[i] {
            case 0x20, 0x09, 0x0A, 0x0D, 0x0C, 0x2C: i += 1   // space tab LF CR FF comma
            default: return
            }
        }
    }

    private static func isLetter(_ c: UInt8) -> Bool {
        (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)
    }

    mutating func atEnd() -> Bool { skipSeparators(); return i >= bytes.count }

    mutating func atCommand() -> Bool {
        skipSeparators()
        return i < bytes.count && Self.isLetter(bytes[i])
    }

    mutating func takeCommand() -> Character? {
        skipSeparators()
        guard i < bytes.count, Self.isLetter(bytes[i]) else { return nil }
        defer { i += 1 }
        return Character(UnicodeScalar(bytes[i]))
    }

    mutating func number() -> CGFloat? {
        skipSeparators()
        let start = i
        if i < bytes.count, bytes[i] == 0x2B || bytes[i] == 0x2D { i += 1 }        // + -
        var digits = 0
        while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1; digits += 1 }
        if i < bytes.count, bytes[i] == 0x2E {                                     // .
            i += 1
            while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1; digits += 1 }
        }
        guard digits > 0 else { i = start; return nil }
        if i < bytes.count, bytes[i] == 0x65 || bytes[i] == 0x45 {                 // e E
            let beforeExponent = i
            i += 1
            if i < bytes.count, bytes[i] == 0x2B || bytes[i] == 0x2D { i += 1 }
            var exponentDigits = 0
            while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1; exponentDigits += 1 }
            if exponentDigits == 0 { i = beforeExponent }
        }
        guard let text = String(bytes: bytes[start..<i], encoding: .utf8), let v = Double(text) else {
            i = start; return nil
        }
        return CGFloat(v)
    }

    mutating func flag() -> Bool? {
        skipSeparators()
        guard i < bytes.count else { return nil }
        switch bytes[i] {
        case 0x30: i += 1; return false
        case 0x31: i += 1; return true
        default: return nil
        }
    }
}
