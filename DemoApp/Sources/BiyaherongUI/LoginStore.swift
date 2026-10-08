import Foundation
import BiyaherongCoachCore

/// The signed-in session: one string, persisted, behind an injected storage.
///
/// Twin of `BiyaLogin`'s session half in `web-demo/js/login.js`; `tools/qa/replay_login.js` asserts
/// the two agree, including the fail-closed branch for an unknown stored value.
///
/// ## The Apple sign-in is SIMULATED
///
/// `signIn(_:)` writes the provider and publishes. There is no `AuthenticationServices` call, no
/// `URLSession`, and no network of any kind — which is deliberate, and `replay_login.js` fails the
/// build on any of the three appearing here.
///
/// It no longer keeps a "100% offline" claim true for the whole app: the Opening Tree's download
/// makes the app **~90% offline**, and the export-compliance `NO` in `ios/project.yml` now rests on
/// the standard-encryption exemption rather than on there being no network at all. What this file's
/// silence still buys is narrower and still worth having — **the login screen itself reaches
/// nothing**, so nothing is sent before a user has agreed to anything.
///
/// Everything a real Sign in with Apple needs is behind this one method. Replacing it means calling
/// `ASAuthorizationController` in the view's button action, then calling `signIn(_:)` on success —
/// the store, the persistence, the gate in `PhoneApp` and the Profile tab's Sign out do not change.
/// That will need the `com.apple.developer.applesignin` entitlement added to `ios/project.yml`.
/// See PORTING_NOTES.md.
///
/// The storage protocol is `CoachGame.Storage`, reused rather than re-declared: it is already the
/// repo's "anything that can hold a string by key", it already has a `UserDefaults` adapter in
/// `CoachStore.swift`, and a third identical protocol would only be a third thing to keep in sync.
@MainActor
final class LoginStore: ObservableObject {

    /// The provider the session was opened with, or `nil` when signed out. Private setter: the two
    /// mutating paths below are the only ones, so the published value and the stored string cannot
    /// drift apart.
    @Published private(set) var provider: String?

    var isSignedIn: Bool { LoginSession.isSignedIn(provider) }

    /// The name the player typed, or `nil` while they have not. Private setter for the same reason
    /// `provider` has one: `setDisplayName` is the single path, so the published value and the
    /// stored string cannot drift.
    @Published private(set) var customName: String?

    /// `LoginProfile.letterAvatar`, or `"coach-1"…"coach-5"`.
    @Published private(set) var avatar: String = LoginProfile.letterAvatar

    /// What every screen draws.
    ///
    /// **This used to be `{ LoginStrings.defaultDisplayName }` — a computed property that ignored
    /// the session and returned a constant.** Not a fallback: there was no setter, no storage key
    /// and no UI, so every device showed "Biyahero" and the client reported it as a bug. The
    /// comment that stood here justified it with "this sign-in is simulated anyway", which stopped
    /// being true when real Sign in with Apple landed and was never revisited.
    ///
    /// Apple still never supplies a name — `LoginAppleAuth` requests zero scopes on purpose, so
    /// that `PrivacyInfo.xcprivacy` can keep an empty `NSPrivacyCollectedDataTypes` — so the name
    /// is the player's own, typed on this device and kept on it.
    var displayName: String { customName ?? LoginStrings.defaultDisplayName }

    /// The coach picture to draw, or `nil` for the circled initial.
    var avatarCoachLevel: Int? { LoginProfile.coachLevel(avatar) }

    var providerLabel: String { LoginSession.providerLabel(provider) }

    private let storage: CoachGame.Storage

    init(storage: CoachGame.Storage = CoachDefaultsStorage()) {
        self.storage = storage
        // Fail closed: anything the predicate does not recognise is a signed-out session, not a
        // trusted one. A half-written or hand-edited key therefore shows the login screen instead
        // of silently letting someone past it.
        let raw = storage.get(LoginSession.storageKey)
        self.provider = LoginSession.isSignedIn(raw) ? raw : nil
        // Same fail-closed reading for the profile: `sanitize` turns anything unusable into `nil`
        // (which shows the default name) and an unrecognised avatar falls back to the letter. A
        // hand-edited key cannot put this screen into a state it has no branch for.
        self.customName = LoginProfile.sanitize(storage.get(LoginProfile.nameKey))
        let storedAvatar = storage.get(LoginProfile.avatarKey)
        self.avatar = LoginProfile.isValidAvatar(storedAvatar) ? storedAvatar! : LoginProfile.letterAvatar
        // In a TEST build, open the session at launch so the app boots straight to Home and the
        // login screen never appears. Asked for directly: the client is testing FEATURES, and a
        // login screen — even a one-tap one — was still a wall in front of them.
        //
        // A real, persisted session rather than a bypass of the gate, so everything downstream is
        // unchanged: `PhoneApp`'s gate simply finds itself already signed in, Profile still shows
        // "Signed in with Apple", and Sign out still works — and then one tap comes straight back.
        //
        // Decided by the APP TARGET (`BiyaherongBuild`). A `#if` here would be INERT.
        if BiyaherongBuild.isTestBuild, self.provider == nil {
            self.provider = LoginSession.appleProvider
            storage.set(LoginSession.storageKey, LoginSession.appleProvider)
        }
    }

    /// Opens a session. Idempotent — signing in twice is not an error and does not re-publish.
    func signIn(_ provider: String = LoginSession.appleProvider) {
        guard LoginSession.isSignedIn(provider), self.provider != provider else { return }
        self.provider = provider
        storage.set(LoginSession.storageKey, provider)
    }

    /// Closes it. The key is REMOVED rather than set to an empty string, so a later read is a clean
    /// miss and not a value the predicate has to special-case.
    ///
    /// The name and avatar are deliberately NOT cleared here. They are device-local preferences,
    /// like `biya.coach.takeback.v1`, and signing back in to find yourself renamed would be a
    /// surprise. **Delete account does erase them** — both keys are in `LoginAccountData.erasedKeys`,
    /// which is the list `replay_login.js` holds the two languages to.
    func signOut() {
        guard provider != nil else { return }
        provider = nil
        storage.remove(LoginSession.storageKey)
    }

    /// Sets the player's name, or clears it back to the default when they empty the field.
    ///
    /// Goes through `LoginProfile.sanitize`, so trailing spaces, a pasted newline and a 300-character
    /// paste all land as the same shape the browser twin produces for the same input.
    func setDisplayName(_ raw: String) {
        let clean = LoginProfile.sanitize(raw)
        guard clean != customName else { return }
        customName = clean
        if let clean { storage.set(LoginProfile.nameKey, clean) } else { storage.remove(LoginProfile.nameKey) }
    }

    /// Picks an avatar. An unrecognised value is ignored rather than stored — the picker can only
    /// offer `LoginProfile.avatars`, so reaching here with anything else means something is wrong
    /// and the last good value is the safer answer.
    func setAvatar(_ raw: String) {
        guard LoginProfile.isValidAvatar(raw), raw != avatar else { return }
        avatar = raw
        if raw == LoginProfile.letterAvatar { storage.remove(LoginProfile.avatarKey) }
        else { storage.set(LoginProfile.avatarKey, raw) }
    }
}
