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
    dependencies: [
        .package(name: "BiyaherongCoachCore", path: ".."),
        // Stockfish 17.1 and its two NNUE networks (~75 MiB of the app's size). Same `name:` pin,
        // same reason. This is why the app is GPLv3 — see ../LICENSE.
        .package(name: "BiyaherongEngine", path: "../Engine"),
    ],
    targets: [
        .target(
            name: "BiyaherongUI",
            dependencies: [
                .product(name: "BiyaherongCoachCore", package: "BiyaherongCoachCore"),
                .product(name: "StockfishEngine", package: "BiyaherongEngine"),
            ],
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
        // The Puzzle Hub's derived layer: the bottom panel, the info strip, both clock formatters,
        // the Turbo bands, the feedback dot's signed geometry, the sound tables and the two
        // promotion dialogs. The raw constants are covered by tools/qa/replay_puzzle_core.js.
        .executableTarget(
            name: "PuzzleMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // The Pairing Manager's derived layer: the type/status colour maps and their fallbacks, the
        // chess-notation score formatter, and the standings comparator. The raw constants are not
        // re-checked here — tools/metrics/gen_pairing_metrics.js emits them and PairingMetrics.swift
        // together with the JS twin, so there is no transcription step for them to drift across.
        .executableTarget(
            name: "PairingMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // Play vs Coach's derived layer: the FOLDED avatar geometry (a fold that quietly produced
        // two equal numbers would draw a ring with no halo and look almost right), the roster and
        // its clamping, the accent lookup's fallback, and the unextracted constants — which are
        // asserted so the invented list cannot grow without someone noticing.
        .executableTarget(
            name: "CoachMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // The login screen's pure layer: the band budget against the shortest supported phone (a
        // login screen that scrolls is a bug), the drift field's keep-out zones, the two colours of
        // Apple's button that must never be retinted, and the session state machine — including the
        // fail-closed branch, which is the one that decides whether a bad stored value lets someone
        // past the gate.
        .executableTarget(
            name: "LoginMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
        // The subscription's pure layer: the trial/expiry/grace state machine and every boundary in
        // it, the monotonic clock floor that stops a back-dated clock resurrecting a lapsed
        // subscription, the round-UP day count the server got wrong, and every free-tier cap —
        // including that Puzzle Turbo is counted PER MODE, which is the easy thing to read wrong.
        .executableTarget(
            name: "PaywallMetricsCheck",
            dependencies: ["BiyaherongUI"]
        ),
    ]
)
