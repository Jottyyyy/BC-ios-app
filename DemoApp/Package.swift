// swift-tools-version:6.0
import PackageDescription

// Native macOS demo app that wraps the verified BiyaherongCoachCore engines so a human can
// interactively test the real logic. (No iOS simulator is available in this environment; this
// runs the exact same domain code the parity suite covers, on macOS.)
let package = Package(
    name: "DemoApp",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "..")],
    targets: [
        .executableTarget(
            name: "DemoApp",
            dependencies: [.product(name: "BiyaherongCoachCore", package: "BC-ios-app")],
            resources: [.copy("puzzles.sqlite")]
        )
    ]
)
