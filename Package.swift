// swift-tools-version:6.0
import PackageDescription

// Biyaherong Chess Coach — offline iOS/iPadOS rebuild.
// This package is the pure-Swift DOMAIN layer (Foundation only, no UIKit/SwiftUI).
// It is verified against the real Laravel backend via golden vectors (see ParityRunner).
// The Xcode app target embeds `BiyaherongCoachCore` as a local package dependency.
let package = Package(
    name: "BiyaherongCoachCore",
    platforms: [
        .macOS(.v13), // for `swift run ParityRunner` in CI / dev
        .iOS(.v17),   // production target (SwiftData requires iOS 17)
    ],
    products: [
        .library(name: "BiyaherongCoachCore", targets: ["BiyaherongCoachCore"]),
    ],
    targets: [
        .target(
            name: "BiyaherongCoachCore"
        ),
        // The parity suite. Run: `swift run ParityRunner`
        // (No XCTest/Testing in the bare toolchain; this is an in-house harness.)
        .executableTarget(
            name: "ParityRunner",
            dependencies: ["BiyaherongCoachCore"]
        ),
    ]
)
