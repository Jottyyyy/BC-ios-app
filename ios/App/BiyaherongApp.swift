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
    /// Not set → a REAL build: Apple sign-in, StoreKit entitlement, paywall. `BIYA_TESTBUILD`
    /// opts into the open one, and is set in exactly three places — `configs: Debug` in
    /// `ios/project.yml` (so local Xcode Run stays openable) and the two CI test workflows.
    ///
    /// The sense of this flag was inverted deliberately. It used to read `#if BIYA_APPSTORE`, so
    /// forgetting the flag shipped a build that granted the subscription and faked the sign-in —
    /// which is exactly what `tools/ship/ship_testflight.sh` did, silently, because it sets no
    /// build settings at all. Forgetting a flag must cost a tester an inconvenience, never cost
    /// the product its revenue. See BuildMode.swift for the whole argument.
    init() {
        #if BIYA_TESTBUILD
        BiyaherongBuild.configure(isTestBuild: true)
        #else
        BiyaherongBuild.configure(isTestBuild: false)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            BiyaherongPhoneRoot()
        }
    }
}
