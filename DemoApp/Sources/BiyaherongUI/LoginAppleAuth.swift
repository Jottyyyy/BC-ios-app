import Foundation
#if os(iOS)
import AuthenticationServices
import UIKit
#endif

/// The real Sign in with Apple call — and the ONLY file in this package that talks to
/// `AuthenticationServices`.
///
/// `tools/qa/replay_login.js` asserts both halves of that: that this file makes the call, and that
/// no other file imports the framework. That gate used to ban the framework outright, because the
/// sign-in was simulated and the ban was what kept it honest; it is an allowlist of one now. The
/// networking half of the ban still applies **here too** — Apple's sheet reaches Apple over the
/// system's own transport, and the app itself still opens no connection of its own.
///
/// The decision half — which event moves the screen where, and which of them the user is told
/// about — is `LoginAuth` in `LoginMetrics.swift`, because the browser twin needs it and a browser
/// cannot have an `ASAuthorizationController`. Everything in this file is mechanism.
@MainActor
final class LoginAppleAuth: NSObject, ObservableObject {

    /// Never assigned directly: every transition goes through `LoginAuth.next`, so the two
    /// languages cannot come to disagree about what a cancel does.
    @Published private(set) var phase: LoginAuthPhase = .idle

    /// Raised once, on success. This type never touches storage — `LoginStore` owns the session,
    /// and keeping it that way is why the store needed no change at all.
    private var onSuccess: ((String) -> Void)?

    #if os(iOS)
    /// Held for the lifetime of the request. The system does not retain an
    /// `ASAuthorizationController`, and a released one simply never calls back — a hang with no
    /// error, which is the worst shape this failure could take.
    private var controller: ASAuthorizationController?
    #endif

    func start(onSuccess: @escaping (String) -> Void) {
        guard !LoginAuth.isBusy(phase) else { return }
        self.onSuccess = onSuccess
        phase = LoginAuth.next(phase, .start)
        #if os(iOS)
        let request = ASAuthorizationAppleIDProvider().createRequest()
        // NO scopes, deliberately. The app shows `LoginStrings.defaultDisplayName` and persists
        // nothing but the provider string, so asking for a name or an email would be collecting
        // data it has no use for — and would make the empty `NSPrivacyCollectedDataTypes` in
        // `ios/App/PrivacyInfo.xcprivacy` untrue. Zero scopes keeps that manifest honest.
        request.requestedScopes = []
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        controller.performRequests()
        #else
        // macOS: the demo shell is built unsigned (`DemoApp/run-demo.sh`), and Sign in with Apple
        // needs an entitlement only a signed app carries — the same fence, for the same reason, as
        // `SecureStorage`'s Keychain branch. The desktop preview opens the session directly rather
        // than raising a sheet that cannot succeed.
        finish(.succeeded)
        #endif
    }

    /// Clears a reported failure — the alert's dismissal, and the only way out of `.failed` short
    /// of trying again.
    func dismissError() {
        guard phase == .failed else { return }
        phase = .idle
    }

    fileprivate func finish(_ event: LoginAuthEvent) {
        phase = LoginAuth.next(phase, event)
        #if os(iOS)
        controller = nil
        #endif
        guard event == .succeeded else { return }
        let raise = onSuccess
        onSuccess = nil
        raise?(LoginSession.appleProvider)
    }
}

#if os(iOS)
extension LoginAppleAuth: ASAuthorizationControllerDelegate {

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        Task { @MainActor in self.finish(.succeeded) }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        // Backing out of Apple's sheet is a choice, not a fault, and `LoginAuth.next` is where that
        // distinction is written down. Everything else is a real failure and earns a message.
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        Task { @MainActor in self.finish(cancelled ? .cancelled : .failed) }
    }
}

extension LoginAppleAuth: ASAuthorizationControllerPresentationContextProviding {

    nonisolated func presentationAnchor(
        for controller: ASAuthorizationController
    ) -> ASPresentationAnchor {
        // The system calls this on the main thread, which is what makes the assumption sound.
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)
                ?? ASPresentationAnchor()
        }
    }
}
#endif
