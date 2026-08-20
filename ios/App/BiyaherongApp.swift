import SwiftUI
import BiyaherongUI

// iPhone / iPad entry point.
// All UI, engine and resources come from the BiyaherongUI package library, so this
// file stays tiny — it just shows the phone root full-screen.
@main
struct BiyaherongApp: App {

    /// THE build switch, and it has to be here rather than in the package.
    ///
    /// `SWIFT_ACTIVE_COMPILATION_CONDITIONS` set on this Xcode project does NOT reach a local
    /// SwiftPM package's targets, and every UI file lives in the `BiyaherongUI` package. A `#if`
    /// in there compiles the same way in every build whatever CI passes — which is why three
    /// rounds of setting the flag in codemagic.yaml produced three identical builds and no error.
    /// This file is a real Xcode target, so the setting does apply, and the value is handed to the
    /// package at runtime.
    ///
    /// Not set → a TEST build: no login screen, no paywall, everything open. `BIYA_APPSTORE` is
    /// set only by codemagic.yaml's `ios-appstore`, which refuses to build if it did not arrive.
    init() {
        #if BIYA_APPSTORE
        BiyaherongBuild.configure(isTestBuild: false)
        #else
        BiyaherongBuild.configure(isTestBuild: true)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            BiyaherongPhoneRoot()
        }
    }
}
