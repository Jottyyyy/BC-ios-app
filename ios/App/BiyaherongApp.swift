import SwiftUI
import BiyaherongUI
#if canImport(UIKit)
// `UIApplicationDelegateAdaptor` comes from SwiftUI, but the protocol it adapts and the three
// types in the signature below — `UIApplication`, `UIWindow`, `UIInterfaceOrientationMask` — do not.
import UIKit
#endif

// iPhone / iPad entry point.
// All UI, engine and resources come from the BiyaherongUI package library, so this
// file stays tiny — it just shows the phone root full-screen.
#if canImport(UIKit)
/// The orientation narrower, and the reason the app can allow landscape at all.
///
/// `ios/project.yml` now lists landscape alongside portrait in
/// `INFOPLIST_KEY_UISupportedInterfaceOrientations`, because the Info.plist list is an outer bound
/// that no runtime API can exceed — without it the tutorial video could never rotate, which is the
/// bug the client reported. But that list alone would let **every** screen rotate, and every screen
/// in this app is a portrait phone layout.
///
/// So this delegate hands the list back narrowed: portrait for the whole app, and landscape only
/// while `OrientationGate` says the video player is presenting fullscreen. The pair is the Swift
/// equivalent of what `expo-screen-orientation` does for the RN original, which is likewise
/// declared portrait-only in `app.json` and rotates purely at runtime.
///
/// It lives in this file, not in the `BiyaherongUI` package, for the same reason the build switch
/// below does: `@UIApplicationDelegateAdaptor` needs a real Xcode app target.
final class BiyaherongAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        OrientationGate.mask
    }
}
#endif

@main
struct BiyaherongApp: App {

    #if canImport(UIKit)
    /// Installs the delegate above. Without this line the widened plist is unguarded and the whole
    /// app rotates.
    @UIApplicationDelegateAdaptor(BiyaherongAppDelegate.self) private var appDelegate
    #endif

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
