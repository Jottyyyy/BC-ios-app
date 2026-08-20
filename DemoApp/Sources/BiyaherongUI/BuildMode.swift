import Foundation

/// Is this a TEST build or a submission build — decided by the **app target**, never in here.
///
/// ## Why this is not a `#if`
///
/// It was, twice, and it never worked. `SWIFT_ACTIVE_COMPILATION_CONDITIONS` set on the Xcode
/// project — in `ios/project.yml`, on the `xcodebuild` command line, anywhere at the target level —
/// **does not reach a local SwiftPM package's targets.** Every file in this directory belongs to
/// the `BiyaherongUI` package, so a `#if` here compiles identically in every build no matter what
/// CI passes. Three rounds of "the flag is set in codemagic.yaml" produced three builds that
/// behaved exactly the same, with no error anywhere to explain it.
///
/// So the `#if` lives in `ios/App/BiyaherongApp.swift`, which is a real Xcode target where the
/// setting does apply, and it calls `configure(isTestBuild:)` from its `init` — before any view
/// exists, so every reader below sees the right value.
///
/// ## Why the default is `true`
///
/// A build that is not told otherwise is a **testable** one. The failure this repo kept hitting was
/// a build nobody could open and no error to say why; the opposite failure — a submission build
/// that forgot to opt in — is caught loudly by `ios-appstore`, which refuses to build unless
/// `BIYA_APPSTORE` really reached the compiler. A silent failure in the daily workflow is worse
/// than a loud one in the rare workflow.
///
/// ## What it switches
///
/// - `LoginStore.init` opens a session at launch, so the login screen never appears;
/// - `LoginAppleAuth.start` opens the session directly instead of calling Apple;
/// - `PremiumStore.recompute` grants the entitlement instead of resolving it from StoreKit.
///
/// All three are needed together: there is no Sign in with Apple capability on the App ID yet and
/// no subscription product in App Store Connect, so each one alone still leaves a wall.
@MainActor
public enum BiyaherongBuild {

    /// `true` unless the app target says otherwise. Read by the three sites named above.
    public private(set) static var isTestBuild = true

    /// Called once, from the app target's `init`, before the view tree is built.
    public static func configure(isTestBuild: Bool) {
        Self.isTestBuild = isTestBuild
    }
}
