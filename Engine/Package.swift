// swift-tools-version:6.0
import PackageDescription

// BiyaherongEngine — Stockfish 18, embedded.
//
// Two targets, and the split is the point:
//
//   • `CStockfish`  — the vendored Stockfish C++ tree plus one small `extern "C"` shim. This is the
//                     only C++ in the repository and the only code nothing here can compile, so it
//                     does as little as possible: marshalling, and the guard rails around
//                     Stockfish's habit of calling `exit()` on a bad net.
//   • `StockfishEngine` — Swift. Conforms to Core's `AnalysisEngine`, and holds every DECISION:
//                     the White-relative score flip, PV parsing, snapshot assembly, limit
//                     translation. All of it is mirrored by `tools/qa/stockfish_bridge_twin.js` and
//                     asserted by `tools/qa/replay_stockfish.js`, which is how anything in this
//                     repository gets verified without a compiler.
//
// The public header is deliberately pure C (`include/biya_stockfish.h`). That keeps
// `.interoperabilityMode(.Cxx)` — and its hard coupling to a specific Swift toolchain — out of the
// package: Swift imports `CStockfish` exactly as it would any C library.
//
// LICENCE: Stockfish is GPLv3, so this package and everything linking it are GPLv3.
// See ../LICENSE and Sources/CStockfish/sf/Copying.txt.
let package = Package(
    name: "BiyaherongEngine",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "StockfishEngine", targets: ["StockfishEngine"]),
    ],
    // Same `name:` pin as DemoApp/Package.swift, and for the same reason recorded there: without it
    // SwiftPM derives the dependency's identity from the CHECKOUT DIRECTORY name, and CI clones into
    // a directory that is not called "BC-ios-app".
    dependencies: [.package(name: "BiyaherongCoachCore", path: "..")],
    targets: [
        .target(
            name: "CStockfish",
            // Everything else under Sources/CStockfish is compiled by SwiftPM's own globbing. These
            // are the files that are not sources: excluded rather than deleted, so the vendored tree
            // stays a faithful copy of the release and the next upgrade is a clean replace.
            //
            // `sf/main.cpp` is excluded for a different reason: it defines `main()`, and linking two
            // of those into an app fails.
            exclude: [
                "sf/main.cpp",
                "sf/Makefile",
                "sf/Copying.txt",
                "sf/AUTHORS",
                "sf/incbin/UNLICENCE",
            ],
            cxxSettings: [
                // Lets `sf/*` reach `../sfconfig.h`, and the shim reach `include/`.
                .headerSearchPath("."),
            ]
        ),
        .target(
            name: "StockfishEngine",
            dependencies: [
                "CStockfish",
                .product(name: "BiyaherongCoachCore", package: "BiyaherongCoachCore"),
            ],
            // `.copy`, never `.process` — the same rule DemoApp's resources follow. `.process` would
            // flatten the folder and `StockfishEngine.netsDirectory` looks the directory up by name.
            // The two files are ~77 MB together and are the reason the app is the size it is.
            resources: [.copy("Nets")]
        ),
    ],
    // Stockfish 18 is C++17 and uses GNU extensions the strict dialect rejects. `.gnucxx17` is what
    // its own Makefile compiles with, and what chesskit-engine ships with — this is not a guess.
    cxxLanguageStandard: .gnucxx17
)
