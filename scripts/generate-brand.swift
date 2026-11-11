import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    .deletingLastPathComponent().deletingLastPathComponent()
let source = try String(contentsOf: root.appendingPathComponent("app/src/lib/palette.ts"), encoding: .utf8)
let pattern = try NSRegularExpression(pattern: #"""
(\w+): \['(#[A-Fa-f0-9]{6}(?:[A-Fa-f0-9]{2})?)', '(#[A-Fa-f0-9]{6}(?:[A-Fa-f0-9]{2})?)'\]
"""#)
var palette: [String: [String]] = [:]
for match in pattern.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
    let parts = (1...3).map { String(source[Range(match.range(at: $0), in: source)!]) }
    palette[parts[0]] = [parts[1], parts[2]]
}
guard let accent = palette["accent"], let bg = palette["bg"],
      let text = palette["text"], let onAccent = palette["onAccent"] else {
    fatalError("The shared Relay palette could not be read.")
}

func write(_ data: Data, to relative: String) throws {
    let url = root.appendingPathComponent(relative)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
    print(relative)
}

func write(_ string: String, to relative: String) throws {
    try write(Data(string.utf8), to: relative)
}

func channels(_ hex: String) -> [CGFloat] {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return [CGFloat((value >> 16) & 255), CGFloat((value >> 8) & 255), CGFloat(value & 255)].map { $0 / 255 }
}

func color(_ hex: String) -> CGColor {
    let rgb = channels(hex)
    return CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: rgb + [1])!
}

func encoded(_ hex: String) -> String {
    "extended-srgb:" + (channels(hex) + [1]).map { String(format: "%.5f", locale: Locale(identifier: "en_US_POSIX"), Double($0)) }.joined(separator: ",")
}

func number(_ value: CGFloat) -> String {
    value.rounded() == value ? String(Int(value)) : String(format: "%.3f", locale: Locale(identifier: "en_US_POSIX"), Double(value))
}

let relay = CGMutablePath()
relay.move(to: CGPoint(x: 20, y: 14))
relay.addLine(to: CGPoint(x: 20, y: 43))
relay.addQuadCurve(to: CGPoint(x: 32, y: 55), control: CGPoint(x: 20, y: 55))
relay.addLine(to: CGPoint(x: 47, y: 55))
relay.move(to: CGPoint(x: 60, y: 66))
relay.addLine(to: CGPoint(x: 60, y: 37))
relay.addQuadCurve(to: CGPoint(x: 48, y: 25), control: CGPoint(x: 60, y: 25))
relay.addLine(to: CGPoint(x: 33, y: 25))

func svgPath(_ path: CGPath) -> String {
    var parts: [String] = []
    path.applyWithBlock { element in
        let e = element.pointee
        let point: (Int) -> String = { "\(number(e.points[$0].x)) \(number(e.points[$0].y))" }
        switch e.type {
        case .moveToPoint: parts.append("M" + point(0))
        case .addLineToPoint: parts.append("L" + point(0))
        case .addQuadCurveToPoint: parts.append("Q" + point(0) + " " + point(1))
        case .addCurveToPoint: parts.append("C" + point(0) + " " + point(1) + " " + point(2))
        case .closeSubpath: parts.append("Z")
        @unknown default: fatalError("Unsupported path element.")
        }
    }
    return parts.joined(separator: " ")
}

func mark(_ stroke: String) -> String {
    #"<path d="\#(svgPath(relay))" fill="none" stroke="\#(stroke)" stroke-width="12"/>"#
}

func solidMark(_ fill: String) -> String {
    let path = relay.copy(strokingWithWidth: 12, lineCap: .butt, lineJoin: .miter, miterLimit: 10)
    return #"<path d="\#(svgPath(path))" fill="\#(fill)"/>"#
}

func svg(_ width: Int, _ height: Int, _ title: String, _ body: String) -> String {
    """
    <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)" role="img" aria-labelledby="title">
    <title id="title">\(title)</title>
    \(body)
    </svg>

    """
}

func outline(_ string: String, size: CGFloat, weight: NSFont.Weight) -> CGPath {
    let nativeFont = NSFont.systemFont(ofSize: size, weight: weight)
    let font = CTFontCreateWithName(nativeFont.fontName as CFString, size, nil)
    let attributed = NSAttributedString(string: string, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    let line = CTLineCreateWithAttributedString(attributed)
    let result = CGMutablePath()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var positions = [CGPoint](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
        for i in 0..<count {
            if let path = CTFontCreatePathForGlyph(font, glyphs[i], nil) {
                result.addPath(path, transform: CGAffineTransform(translationX: positions[i].x, y: positions[i].y))
            }
        }
    }
    return result
}

func textSVG(_ path: CGPath, x: CGFloat, baseline: CGFloat, fill: String) -> String {
    #"<path d="\#(svgPath(path))" transform="translate(\#(number(x)) \#(number(baseline))) scale(1 -1)" fill="\#(fill)"/>"#
}

func drawMark(_ context: CGContext, size: Int, stroke: String, scale: CGFloat = 11.5) {
    let factor = CGFloat(size) / 1024
    context.saveGState()
    context.translateBy(x: (1024 - 80 * scale) / 2 * factor, y: (1024 - 80 * scale) / 2 * factor)
    context.scaleBy(x: scale * factor, y: scale * factor)
    context.addPath(relay)
    context.setStrokeColor(color(stroke))
    context.setLineWidth(12)
    context.setLineCap(.butt)
    context.strokePath()
    context.restoreGState()
}

func png(width: Int, height: Int, background: String?, draw: (CGContext) -> Void) -> Data {
    let alpha = background == nil ? CGImageAlphaInfo.premultipliedLast : .noneSkipLast
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: alpha.rawValue)!
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    if let background {
        context.setFillColor(color(background))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    }
    draw(context)
    let data = NSMutableData()
    let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(destination))
    return data as Data
}

for (file, stroke) in [("mark.svg", "currentColor"), ("mark-light.svg", accent[0]), ("mark-dark.svg", accent[1]), ("mark-white.svg", "#FFFFFF")] {
    try write(svg(80, 80, "Luther Relay mark", mark(stroke)), to: "assets/brand/\(file)")
}
let word = outline("Luther", size: 68, weight: .semibold)
let width = Int(ceil(word.boundingBoxOfPath.maxX)) + 124
for (mode, i) in [("light", 0), ("dark", 1)] {
    let body = #"<g transform="translate(8 12)">\#(mark(accent[i]))</g>"# + "\n" + textSVG(word, x: 108, baseline: 76, fill: text[i])
    try write(svg(width, 104, "Luther", body), to: "assets/brand/wordmark-\(mode).svg")
}
let layer = #"<g transform="translate(52 52) scale(11.5)">\#(solidMark("#FFFFFF"))</g>"#
try write(svg(1024, 1024, "Luther Relay app icon foreground", layer), to: "app/assets/luther.icon/Assets/relay.svg")
let iconBody = #"<rect width="1024" height="1024" fill="\#(accent[0])"/>"# + "\n" + layer
try write(svg(1024, 1024, "Luther app icon", iconBody), to: "assets/brand/icon.svg")

let iconDocument: [String: Any] = [
    "fill": ["solid": encoded(accent[0])],
    "fill-specializations": [["appearance": "dark", "value": ["solid": encoded(bg[1])]]],
    "groups": [[
        "layers": [[
            "image-name": "relay.svg", "name": "Relay",
            "fill": ["solid": encoded(onAccent[0])],
            "fill-specializations": [["appearance": "dark", "value": ["solid": encoded(accent[1])]]]
        ]],
        "shadow": ["kind": "neutral", "opacity": 0.25],
        "translucency": ["enabled": false, "value": 0.5]
    ]],
    "supported-platforms": ["squares": "shared"]
]
try write(try JSONSerialization.data(withJSONObject: iconDocument, options: [.prettyPrinted, .sortedKeys]), to: "app/assets/luther.icon/icon.json")
try write(try JSONSerialization.data(withJSONObject: palette, options: [.prettyPrinted, .sortedKeys]), to: "assets/brand/palette.json")

for (file, size, background, stroke, scale) in [
    ("luther-icon.png", 1024, Optional(accent[0]), onAccent[0], 11.5),
    ("luther-icon-dark.png", 1024, Optional(bg[1]), accent[1], 11.5),
    ("luther-favicon.png", 64, Optional(accent[0]), onAccent[0], 11.5),
    ("luther-android-foreground.png", 1024, nil, onAccent[0], 8.4),
    ("luther-android-monochrome.png", 1024, nil, "#FFFFFF", 8.4),
    ("luther-splash.png", 512, nil, accent[0], 11.5),
    ("luther-splash-dark.png", 512, nil, accent[1], 11.5)
] {
    try write(png(width: size, height: size, background: background) { context in
        drawMark(context, size: size, stroke: stroke, scale: scale)
    }, to: "app/assets/images/\(file)")
}

let socialWord = outline("Luther", size: 116, weight: .semibold)
let tagline = outline("Your agents. Your Mac. Anywhere.", size: 32, weight: .regular)
let detail = outline("A control plane for the coding agents on your Mac.", size: 23, weight: .regular)
let social = """
<rect width="1200" height="630" fill="\(bg[1])"/>
<g transform="translate(72 176) scale(2)">\(mark(accent[1]))</g>
\(textSVG(socialWord, x: 280, baseline: 307, fill: text[1]))
\(textSVG(tagline, x: 94, baseline: 425, fill: text[1]))
\(textSVG(detail, x: 94, baseline: 474, fill: palette["dim"]![1]))
"""
try write(svg(1200, 630, "Luther — Your agents. Your Mac. Anywhere.", social), to: "assets/brand/social-preview.svg")
try write(png(width: 1200, height: 630, background: bg[1]) { context in
    context.saveGState()
    context.translateBy(x: 72, y: 176)
    context.scaleBy(x: 2, y: 2)
    context.addPath(relay)
    context.setStrokeColor(color(accent[1]))
    context.setLineWidth(12)
    context.strokePath()
    context.restoreGState()
    for (path, x, y, fill) in [(socialWord, 280.0, 307.0, text[1]), (tagline, 94.0, 425.0, text[1]), (detail, 94.0, 474.0, palette["dim"]![1])] {
        context.saveGState()
        context.translateBy(x: x, y: y)
        context.scaleBy(x: 1, y: -1)
        context.addPath(path)
        context.setFillColor(color(fill))
        context.fillPath()
        context.restoreGState()
    }
}, to: "assets/brand/social-preview.png")
