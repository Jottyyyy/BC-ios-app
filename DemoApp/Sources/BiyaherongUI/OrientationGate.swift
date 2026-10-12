import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The one flag that decides whether anything in this app may rotate.
///
/// ── Why this exists ───────────────────────────────────────────────────────────
/// The client reported that the tutorial video will not go landscape when maximised. It could not:
/// `ios/project.yml` declared `UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait`,
/// a single value, and **the Info.plist list is an outer bound no runtime API can exceed.** Nothing
/// rotates, ever, no matter what the player asks for.
///
/// Widening that list is necessary and not sufficient: on its own it lets EVERY screen rotate, and
/// every screen here is a portrait phone layout. So the plist is widened and then narrowed again at
/// runtime, and this enum is the narrowing. `ios/App/BiyaherongApp.swift` installs an
/// `AppDelegate` whose `application(_:supportedInterfaceOrientationsFor:)` reads
/// `allowsLandscape` — portrait for the whole app, landscape only while the player says so.
///
/// ── The source does exactly this, and that is the surprise ────────────────────
/// The RN original is portrait-only too — `app.json:6` is `"orientation": "portrait"`, with no
/// orientation keys in its `ios.infoPlist`. It rotates anyway because `expo-screen-orientation`
/// overrides the supported orientations **at runtime**: `tutorial-videos/play.tsx:73-79` locks
/// portrait on mount and restores it on unmount, and `:113-123` swaps to `OrientationLock.LANDSCAPE`
/// on fullscreen and back on exit. That runtime layer is the thing the port never had. This file is
/// its Swift equivalent, down to the unmount restore — see `SystemVideoPlayer.dismantleUIViewController`
/// (NOT `onDisappear`: a fullscreen presentation fires that too, which was the 1.0.9 sound bug).
///
/// ── Why an enum with a static, and not an ObservableObject ────────────────────
/// The reader is `UIApplicationDelegate`, which UIKit calls on its own schedule from outside any
/// SwiftUI environment. It needs a value it can read synchronously with no view tree in hand.
/// Nothing observes this: the delegate is asked, it answers.
///
/// ⚠ **This is one of the two things on this branch that no gate on the Windows checkout can
/// verify.** `swift_lint.js` and `swift_symbol_check.js` see structure, not behaviour, and UIKit
/// orientation is behaviour. `tools/qa/orientation_check.js` asserts the WIRING — that the plist
/// and the generated project agree, and that the delegate consults this flag — which is the most a
/// machine here can do. The rest is a device check, written down in `docs/tutorial-videos.md`.
///
/// ── Why `@MainActor` ──────────────────────────────────────────────────────────
/// `allowsLandscape` is mutable static state, and this package builds in the Swift 6 language mode
/// (`swift-tools-version:6.0`), where nonisolated shared mutable state is an ERROR, not a warning.
/// `set` also reaches `UIApplication.shared`, which is main-actor isolated. Every other type in
/// this module that holds a `static var` — `PieceArt`, `CoachArt`, `HomeArt`, `BiyaherongBuild`,
/// `Haptics.enabled` — is `@MainActor` for the same reason; this one shipped without it, written
/// with no compiler in reach. All three callers (the app delegate, the representable, and the
/// player's delegate) are main-actor isolated already, so the annotation costs nothing.
@MainActor
public enum OrientationGate {

    /// False everywhere except inside the video player's fullscreen presentation.
    ///
    /// `private(set)` on purpose: a second writer is how an app ends up stuck in landscape on a
    /// screen that cannot draw it. The only mutator is `set(landscape:)` below, and every caller of
    /// it lives in `SystemVideoPlayer`: the two fullscreen callbacks (plus their cancellation
    /// undo) and `dismantleUIViewController`.
    public private(set) static var allowsLandscape = false

    /// The mask the app delegate hands back to UIKit.
    ///
    /// `.landscape`, not `.allButUpsideDown`: the source **locks** to landscape rather than merely
    /// permitting it (`play.tsx:119`), and the user asked for the Android behaviour. Allowing
    /// portrait here would let a fullscreen video rotate back into a portrait letterbox, which is
    /// the state the client was complaining about in the first place.
    public static var mask: UIInterfaceOrientationMask {
        allowsLandscape ? .landscape : .portrait
    }

    /// Open or close the gate, and ask the window scene to act on it.
    ///
    /// Two calls, both required and in this order:
    ///
    ///  1. `setNeedsUpdateOfSupportedInterfaceOrientations()` — iOS caches the controller's
    ///     supported set. Without this, the geometry request below is intersected against the
    ///     STALE mask and silently does nothing. This is the step that makes the modern API look
    ///     broken when it is skipped.
    ///  2. `requestGeometryUpdate` — the actual rotation. iOS 16+; this app is iOS 17+
    ///     (`project.yml` sets `IPHONEOS_DEPLOYMENT_TARGET`), so there is no fallback path and
    ///     nothing to feature-check.
    ///
    /// The error handler is deliberately empty rather than absent: a refused rotation is not a
    /// failure worth interrupting playback over, and the flag is already correct either way, so the
    /// next natural rotation settles it.
    public static func set(landscape: Bool) {
        allowsLandscape = landscape
        #if os(iOS)
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
        #endif
    }
}

#if !canImport(UIKit)
/// macOS has no interface orientation. The demo app must keep building, and `mask` above needs a
/// type — the same no-op shape `Haptics` uses for `UIImpactFeedbackGenerator`.
public struct UIInterfaceOrientationMask: OptionSet, Sendable {
    public let rawValue: UInt
    public init(rawValue: UInt) { self.rawValue = rawValue }
    public static let portrait = UIInterfaceOrientationMask(rawValue: 1 << 1)
    public static let landscape = UIInterfaceOrientationMask(rawValue: 1 << 4)
}
#endif
