import SwiftUI
import BiyaherongUI

// macOS engine-demo entry point. The real UI + resources live in the BiyaherongUI
// library, which the iOS Xcode app also links (see ios/BUILD-iOS.md).
@main
struct DemoApp: App {
    init() {
        if ProcessInfo.processInfo.environment["BIYA_DIAG"] != nil {
            FileHandle.standardError.write(Data(biyaherongDiagnostics().utf8))
            exit(0)
        }
    }
    var body: some Scene {
        WindowGroup("Biyaherong Coach — Engine Demo") {
            BiyaherongMacRoot()
        }
        .defaultSize(width: 1060, height: 740)
    }
}
