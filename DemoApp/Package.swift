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
    dependencies: [.package(path: "..")],
    targets: [
        .target(
            name: "BiyaherongUI",
            dependencies: [.product(name: "BiyaherongCoachCore", package: "BC-ios-app")],
            resources: [.copy("puzzles.sqlite"), .copy("Fonts"), .copy("Characters"), .copy("Sounds")]
        ),
        .executableTarget(
            name: "DemoApp",
            dependencies: ["BiyaherongUI"]
        ),
    ]
)
