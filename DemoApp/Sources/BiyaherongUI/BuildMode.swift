import Foundation
import StockfishEngine

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
/// ## Why the default is `false`
///
/// It was `true` for a good reason, and that reason still holds: the failure this repo kept hitting
/// was a build nobody could open and no error to say why, so a build that is not told otherwise
/// should be openable. What changed is that "not told otherwise" stopped meaning "a tester's
/// build" and started meaning "whatever `tools/ship/ship_testflight.sh` produces" — and that script
/// sets no flag, so the repo's documented one-command ship was uploading a build that **grants the
/// subscription to everyone and performs no Apple authentication**. A silent failure in the daily
/// workflow is bad; silently giving the product away is worse, because nothing looks wrong.
///
/// So the default is now the safe one and the old convenience is preserved where it was actually
/// needed, which is the Debug configuration: `ios/project.yml` sets `BIYA_TESTBUILD` under
/// `configs: Debug`, so opening the project in Xcode and pressing Run still lands in a fully open
/// app, against the local `Biyaherong.storekit`. Only **archives** — Release — are real.
///
/// Both ship paths now assert rather than assume. `ios-appstore` and `ship_testflight.sh` read the
/// EFFECTIVE build settings back and refuse if `BIYA_TESTBUILD` is present; the CI test workflows
/// refuse if it is absent. `tools/qa/build_mode_check.js` pins the whole arrangement, because none
/// of it compiles on Windows.
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

    /// `false` unless the app target opts in. Read by the three sites named above.
    ///
    /// Fail CLOSED: a caller that never runs `configure` — a unit test, a preview, a host that
    /// forgot — gets the real gates rather than a free subscription.
    public private(set) static var isTestBuild = false

    /// Called once, from the app target's `init`, before the view tree is built.
    public static func configure(isTestBuild: Bool) {
        Self.isTestBuild = isTestBuild
        warmUpEngine()
    }

    /// Start Stockfish in the background, at launch.
    ///
    /// It reads a 71 MB network file and lays out a transposition table, which is a visible stall
    /// on the main thread and roughly free on a utility one. Doing it here rather than on the first
    /// tap means the Analysis Board is already warm when someone opens it.
    ///
    /// **Nothing is thrown or shown on failure**, and that is deliberate: `AnalysisVM` checks
    /// `StockfishRuntime.isStarted` and falls back to `LocalEngine`, so a missing network file
    /// costs strength rather than the screen. `tools/qa/stockfish_vendor_check.js` is what makes
    /// sure that path stays theoretical. See docs/stockfish.md.
    public static func warmUpEngine() {
        Task.detached(priority: .utility) {
            _ = StockfishRuntime.start()
        }
    }
}
