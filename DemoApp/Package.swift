// swift-tools-version:6.0
import PackageDescription

// BiyaherongUI — the SwiftUI app UI + bundled resources (fonts, sounds, coach art,
// the 550k-puzzle SQLite DB), built on top of the verified BiyaherongCoachCore engine.
//
//  • The macOS `DemoApp` executable links it to run the engine-demo shell on a Mac
//    (no iOS simulator is available in this environment).
//  • The iOS/iPadOS Xcode app links the SAME `BiyaherongUI` library product so the
//    resources resolve via `Bundle.module`. See ios/BUILD-iOS.md.
let package = Package(
    name: "BiyaherongUI",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "BiyaherongUI", targets: ["BiyaherongUI"]),
    ],
    // NOTE: `name:` is required. Without it, SwiftPM derives the dependency's identity from the
    // checkout DIRECTORY name, so the product reference below only resolves when the repo happens
    // to sit in a folder called "BC-ios-app". CI clones into /Users/builder/clone and the build
    // dies at package resolution. Naming it pins the identity to the root manifest's package name.
    dependencies: [.package(name: "BiyaherongCoachCore", path: "..")],
    targets: [
        .target(
            name: "BiyaherongUI",
            dependencies: [.product(name: "BiyaherongCoachCore", package: "BiyaherongCoachCore")],
            // All `.copy` (never `.process`): the folder structure is preserved verbatim, so every
            // Bundle.module lookup MUST pass `subdirectory:`. `.process` would flatten these and
            // silently break PieceArt / Sound / Theme.fontsReady / HomeArt.
            resources: [.copy("puzzles.sqlite"), .copy("Fonts"), .copy("Characters"), .copy("Sounds"),
                        .copy("Pieces"), .copy("Images"), .copy("ECO")]
        ),
        .executableTarget(
            name: "DemoApp",
            dependencies: ["BiyaherongUI"]
        ),
        // Runnable self-check for the SVG piece renderer (no XCTest in this toolchain).
        .executableTarget(
            name: "PieceArtCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // Runnable self-check for the home screen's pure layer — responsive metrics, the hourly
        // quote index, expiry formatting and banner-style precedence (no XCTest in this toolchain).
        .executableTarget(
            name: "HomeMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // Runnable self-check for the Analysis Board's pure layer — board geometry, arrow/badge
        // geometry, the eval bar and graph, the display tables, and the band budget. Also asserts
        // those constants against tools/metrics/board_styles.json, extracted from the RN source.
        .executableTarget(
            name: "AnalysisMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
    ]
)
