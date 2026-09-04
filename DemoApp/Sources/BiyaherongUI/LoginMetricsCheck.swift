import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the login screen's pure layer, in the same spirit as ParityRunner,
// PieceArtCheck and HomeMetricsCheck: this toolchain has no XCTest, so the assertions live in a
// runnable harness. `swift run LoginMetricsCheck` exits non-zero on any failure.
//
// It asserts everything about the screen that can be established WITHOUT a renderer — the band
// budget (a login screen that scrolls is a bug), the drift field's keep-out zones, the palette's
// two untouchable colours, the copy, and the whole session state machine including its fail-closed
// branch, driven through an in-memory storage double.
//
// This is only possible because no view body in LoginScreen.swift contains a numeric literal or an
// arithmetic operator — every number is a stored property or a pure function from LoginMetrics.swift.
// Keep it that way, or coverage silently drains out of this file.

public struct LoginMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "LoginMetricsCheck: \(passed) assertions passed"
           : "LoginMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

/// A `CoachGame.Storage` that lives in memory, so the session machine is testable with no
/// `UserDefaults` and no side effects on the machine running the check. A class, not a struct: the
/// protocol's `set`/`remove` are non-mutating.
private final class LoginMemoryStorage: CoachGame.Storage {
    private var values: [String: String]
    var writes = 0
    var removals = 0

    init(_ seed: [String: String] = [:]) { values = seed }

    func get(_ key: String) -> String? { values[key] }
    func set(_ key: String, _ value: String) { values[key] = value; writes += 1 }
    func remove(_ key: String) { values.removeValue(forKey: key); removals += 1 }

    var stored: String? { values[LoginSession.storageKey] }
    var isEmpty: Bool { values.isEmpty }
}

@MainActor
public func biyaherongLoginMetricsCheck() -> LoginMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func expectNear(_ a: CGFloat, _ b: CGFloat, _ what: String, _ tol: CGFloat = 0.01) {
        expect(abs(a - b) <= tol, "\(what): got \(a), expected \(b)")
    }
    func expectEqual(_ a: String, _ b: String, _ what: String) {
        expect(a == b, "\(what): got \"\(a)\", expected \"\(b)\"")
    }

    // MARK: - Typography

    expectNear(LoginType.line(LoginType.titleSize), 41, "title line box")
    expectNear(LoginType.line(LoginType.taglineSize), 19, "tagline line box")
    expectNear(LoginType.line(LoginType.reassureSize), 18, "reassurance line box")
    expectNear(LoginType.line(LoginType.legalSize), 15, "legal line box")
    expect(LoginType.lineHeightRatio == HomeType.nunitoLineHeightRatio,
           "login and home agree on Nunito's nominal line box")
    // A hierarchy that inverts is a design bug the eye forgives and the layout does not.
    expect(LoginType.titleSize > LoginType.buttonLabelSize,
           "the brand title outranks the button label")
    expect(LoginType.buttonLabelSize > LoginType.taglineSize,
           "the button label outranks the tagline")
    expect(LoginType.taglineSize > LoginType.reassureSize,
           "the tagline outranks the reassurance line")
    expect(LoginType.reassureSize > LoginType.legalSize,
           "the reassurance line outranks the legal footer")

    // MARK: - The band budget

    let fixed = LoginLayout.fixedHeight()
    expectNear(fixed, 469, "fixed bands total")
    // The whole point of the budget: it must fit the SHORTEST phone the app supports, with the
    // flexible band still at or above its floor. A login screen that scrolls is a bug.
    expect(fixed + LoginLayout.minSpacer <= LoginLayout.shortestSupportedHeight,
           "the fixed bands + the minimum spacer fit an iPhone SE (\(fixed + LoginLayout.minSpacer) "
           + "> \(LoginLayout.shortestSupportedHeight))")
    // …and it must not merely fit: it has to leave a visible gap, or the button crowds the tagline.
    expect(LoginLayout.spacer(screenHeight: LoginLayout.shortestSupportedHeight) >= LoginLayout.minSpacer,
           "the spacer never drops below its floor on the shortest phone")
    // Clamped, not negative: a phone shorter than the budget gets the floor, not an overlap.
    expectNear(LoginLayout.spacer(screenHeight: 100), LoginLayout.minSpacer,
               "spacer clamps to its floor on an absurdly short screen")
    expect(LoginLayout.spacer(screenHeight: 812) > LoginLayout.spacer(screenHeight: 667),
           "a taller screen gives the spacer more room")
    // The leftover is SPLIT, never lost: the hero's share plus the spacer's share is all of it.
    for h: CGFloat in [667, 812, 852, 932] {
        let above = LoginLayout.heroTop(screenHeight: h) - LoginLayout.heroTopPadding
        expectNear(above + LoginLayout.spacer(screenHeight: h), LoginLayout.leftover(screenHeight: h),
                   "the leftover is fully distributed at \(h)pt", 1)
        expectNear(above, (LoginLayout.leftover(screenHeight: h) * LoginLayout.spacerTopShare).rounded(),
                   "hero-top share at \(h)pt")
    }
    expectNear(LoginLayout.heroTop(screenHeight: 100), LoginLayout.heroTopPadding,
               "with no leftover the hero sits exactly on its floor")
    // The proportion is what makes the screen look the same on every phone — pinning the hero to
    // its floor instead left a ~400pt void between it and the button on a tall one.
    let shortFrac = (LoginLayout.heroTop(screenHeight: 667) + LoginLayout.logoSize / 2) / 667
    let tallFrac = (LoginLayout.heroTop(screenHeight: 932) + LoginLayout.logoSize / 2) / 932
    expect(abs(shortFrac - tallFrac) < 0.02,
           "the logo lands at the same fraction of the screen on the shortest and tallest phones "
           + "(\(shortFrac) vs \(tallFrac))")
    expect(LoginLayout.spacerTopShare > 0 && LoginLayout.spacerTopShare < 0.5,
           "the hero sits above optical centre, where the eye expects it")

    // MARK: - Shape and reuse

    expect(LoginLayout.buttonHeight >= 44,
           "the Apple button clears Apple's 44pt minimum target (got \(LoginLayout.buttonHeight))")
    expect(LoginLayout.buttonRadius == Theme.radiusButton, "the button reuses Theme.radiusButton")
    expect(LoginLayout.sheetRadius == Theme.radius, "the legal sheet reuses Theme.radius")
    expect(LoginLayout.logoRingWidth == HomeLayout.logoBorderWidth,
           "the login ring is the same weight as the home header's, so it reads as the same object")
    expect(LoginLayout.logoRadius < LoginLayout.logoSize / 2,
           "the logo is a squircle, not a circle — a circle crops the wordmark off the brand mark")
    expect(LoginLayout.entranceScale < LoginLayout.restScale, "the hero grows into place")
    expect(LoginLayout.hidden < LoginLayout.shown, "the entrance fades in, not out")

    // MARK: - Palette

    expect(LoginPalette.screenBg == Theme.background, "the screen is the app's background")
    expect(LoginPalette.title == Theme.gold, "the brand title is gold")
    expect(LoginPalette.tagline == Theme.mutedForeground, "the tagline is muted")
    // Apple's mark is the one thing here that is not ours: black on white, never tinted.
    expect(LoginPalette.appleFill == Theme.c(0xFFFFFF), "the Apple button is pure white")
    expect(LoginPalette.appleInk == Theme.c(0x000000), "the Apple mark and label are pure black")
    expect(LoginPalette.appleFill != Theme.gold && LoginPalette.appleInk != Theme.gold,
           "the Apple button is never recoloured to the app's accent")
    // Extracted, not invented — `legalLink` in the RN login screen.
    expect(LoginPalette.legal == Theme.c(0x3A5070), "the legal footer keeps the RN screen's colour")
    expect(LoginPalette.glowOuter == Theme.c(0xFDB022, 0),
           "the hero glow fades to fully transparent gold, so it has no visible edge")

    // MARK: - Timing

    expect(LoginTiming.heroEntranceDelay < LoginTiming.textEntranceDelay,
           "the logo lands before the words")
    expect(LoginTiming.textEntranceDelay < LoginTiming.buttonEntranceDelay,
           "the words land before the button")
    expect(LoginTiming.signInFadeSeconds > 0 && LoginTiming.signInFadeSeconds <= 0.5,
           "the sign-in cross-fade stays immediate (got \(LoginTiming.signInFadeSeconds)s)")
    expect(LoginTiming.heroDamping > 0 && LoginTiming.heroDamping < 1,
           "the hero spring is underdamped but does not ring")
    for spec in LoginDrift.specs {
        expect(spec.seconds > LoginTiming.buttonEntranceSeconds,
               "drift is slower than the entrance, so it reads as ambient: \(spec.kind)")
    }

    // MARK: - The drift field

    let specs = LoginDrift.specs
    expect(specs.count == 8, "eight drifting pieces (got \(specs.count))")
    for (i, spec) in specs.enumerated() {
        expect(spec.x > 0 && spec.x < 1, "spec \(i) x is a fraction inside the container")
        expect(spec.y > 0 && spec.y < 1, "spec \(i) y is a fraction inside the container")
        expect(spec.size > 0 && spec.travel > 0 && spec.seconds > 0,
               "spec \(i) has a real size, travel and duration")
        expect(spec.delay >= 0, "spec \(i) delay is not negative")
        // Faint, or it competes with the hero it is supposed to sit behind.
        expect(spec.opacity > 0 && spec.opacity <= 0.08,
               "spec \(i) stays faint (got \(spec.opacity))")
        // Keep-out: nothing behind the logo/title column, and nothing behind the button band.
        expect(spec.x < 0.30 || spec.x > 0.70,
               "spec \(i) stays out of the hero column (x = \(spec.x))")
        expect(spec.y < 0.80, "spec \(i) stays above the action band (y = \(spec.y))")
        expect(LoginArt.kind(spec.kind) != .king || spec.kind == "king",
               "spec \(i) names a piece the art mapper actually knows (\(spec.kind))")
    }
    // Two pieces sharing a point would look like one piece with a doubled opacity.
    let points = specs.map { "\($0.x),\($0.y)" }
    expect(Set(points).count == points.count, "no two pieces share a position")
    expect(specs.contains { $0.white } && specs.contains { !$0.white },
           "both colours appear in the field")
    let mapped = LoginDrift.point(specs[0], in: CGSize(width: 392, height: 812))
    expectNear(mapped.x, 392 * specs[0].x, "drift point maps x by the container width")
    expectNear(mapped.y, 812 * specs[0].y, "drift point maps y by the container height")
    expect(LoginDrift.usedKinds == LoginDrift.usedKinds.sorted(),
           "usedKinds is sorted, so preloading is deterministic")
    expect(Set(LoginDrift.usedKinds).count == LoginDrift.usedKinds.count, "usedKinds is unique")
    expect(Set(LoginDrift.usedKinds) == Set(specs.map(\.kind)), "usedKinds covers the whole table")

    // MARK: - The session predicate

    expect(!LoginSession.isSignedIn(nil), "a missing key is signed out")
    expect(!LoginSession.isSignedIn(""), "an empty value is signed out")
    expect(!LoginSession.isSignedIn("0"), "a zero value is signed out")
    expect(!LoginSession.isSignedIn("google"), "an unknown provider is signed out")
    expect(!LoginSession.isSignedIn("APPLE"), "the provider check is case-sensitive")
    expect(!LoginSession.isSignedIn(" apple"), "a padded value is signed out, not trimmed")
    expect(LoginSession.isSignedIn(LoginSession.appleProvider), "\"apple\" is signed in")
    expect(LoginSession.providers.contains(LoginSession.appleProvider),
           "apple is in the provider list")
    // The second provider. A guest session is a REAL session — the predicate accepts it — because
    // the alternative was a third state every downstream reader would have had to learn.
    expect(LoginSession.isSignedIn(LoginSession.guestProvider), "\"guest\" is signed in too")
    expect(LoginSession.providers.contains(LoginSession.guestProvider),
           "guest is in the provider list")
    expect(LoginSession.guestProvider != LoginSession.appleProvider,
           "and it is distinguishable, so Profile can say which one opened the session")
    expectEqual(LoginSession.providerLabel("apple"), LoginStrings.appleProviderLabel,
                "provider label for apple")
    expectEqual(LoginSession.providerLabel("guest"), LoginStrings.guestProviderLabel,
                "provider label for a guest")
    expect(LoginSession.providerLabel("guest") != LoginStrings.noProviderLabel,
           "a guest is not shown as signed out — the em dash means no session at all")
    expectEqual(LoginSession.providerLabel(nil), LoginStrings.noProviderLabel,
                "provider label when signed out")
    expectEqual(LoginSession.providerLabel("google"), LoginStrings.noProviderLabel,
                "provider label for an unknown provider")
    expect(LoginSession.storageKey == "biya.auth.session.v1",
           "the storage key keeps the biya.<area>.<thing>.v1 shape")

    // MARK: - The store, through an in-memory storage

    let empty = LoginMemoryStorage()
    let fresh = LoginStore(storage: empty)
    expect(!fresh.isSignedIn, "a fresh install starts signed out")
    expect(empty.isEmpty, "constructing the store writes nothing")

    fresh.signIn()
    expect(fresh.isSignedIn, "signing in opens the session")
    expectEqual(empty.stored ?? "", LoginSession.appleProvider, "the provider is persisted")
    expect(empty.writes == 1, "signing in writes exactly once (got \(empty.writes))")

    fresh.signIn()
    expect(empty.writes == 1, "signing in twice is idempotent (got \(empty.writes) writes)")

    let resumed = LoginStore(storage: empty)
    expect(resumed.isSignedIn, "a later launch resumes the session")
    expectEqual(resumed.providerLabel, LoginStrings.appleProviderLabel, "the resumed provider label")

    fresh.signOut()
    expect(!fresh.isSignedIn, "signing out closes the session")
    expect(empty.stored == nil, "signing out REMOVES the key rather than blanking it")
    expect(empty.removals == 1, "signing out removes exactly once (got \(empty.removals))")

    fresh.signOut()
    expect(empty.removals == 1, "signing out twice is idempotent (got \(empty.removals))")
    expect(!LoginStore(storage: empty).isSignedIn, "the next launch is signed out again")

    // Fail closed: a value the predicate does not recognise shows the login screen. A half-written
    // or hand-edited key must never be the thing that lets someone past the gate.
    let garbage = LoginMemoryStorage([LoginSession.storageKey: "yes"])
    expect(!LoginStore(storage: garbage).isSignedIn, "an unrecognised stored value fails closed")
    let blank = LoginMemoryStorage([LoginSession.storageKey: ""])
    expect(!LoginStore(storage: blank).isSignedIn, "a blank stored value fails closed")
    // An unknown provider is refused rather than persisted, so the stored set stays the known set.
    let refuse = LoginMemoryStorage()
    let refusing = LoginStore(storage: refuse)
    refusing.signIn("google")
    expect(!refusing.isSignedIn && refuse.isEmpty, "an unknown provider is refused, not stored")

    // MARK: - Copy

    expectEqual(LoginStrings.title, "Biyaherong Coach", "brand title")
    expectEqual(LoginStrings.tagline, "Kabiyahe mo sa pag improve!", "the original app's tagline")
    // Apple's required wording. Not "Sign in with Apple", not a translation.
    expectEqual(LoginStrings.appleButton, "Continue with Apple", "the Apple button's wording")
    expect(!LoginStrings.reassurance.isEmpty, "the reassurance line exists")
    expect(!LoginStrings.guestButton.isEmpty, "the guest button has a label")
    expect(LoginStrings.guestButton != LoginStrings.appleButton, "and it is not the Apple one")
    expect(LoginLayout.guestButtonHeight >= 44,
           "the guest button clears Apple's 44pt minimum target — a way past a broken sign-in "
           + "that is hard to hit is not one")
    expect(LoginLayout.guestButtonHeight < LoginLayout.buttonHeight,
           "and is still the quieter of the two: Apple is the offer, this is the escape")
    // The failure alert's message, and the branch inside it.
    expectEqual(LoginAuth.failureMessage(code: nil), LoginStrings.authFailedBody,
                "with no code from Apple the message is the body alone")
    expectEqual(LoginAuth.failureMessage(code: ""), LoginStrings.authFailedBody,
                "an empty code adds nothing")
    expect(LoginAuth.failureMessage(code: "AuthorizationError 1000").contains("1000"),
           "a real code is carried into the message — the diagnosis build 51 did not have")
    expect(LoginAuth.failureMessage(code: "AuthorizationError 1000")
        .hasPrefix(LoginStrings.authFailedBody),
           "and it is appended to the body, not substituted for it")
    expect(LoginStrings.authFailedCode.contains("{code}"),
           "the code template has a slot to fill")
    expectEqual(LoginStrings.defaultDisplayName, "Biyahero", "the player's display name")
    expect(!LoginStrings.defaultDisplayName.isEmpty,
           "the display name is non-empty, so the profile avatar has an initial to draw")
    for topic in LoginLegalTopic.allCases {
        expect(!LoginStrings.legalTitle(topic).isEmpty, "\(topic.rawValue) sheet has a title")
        expect(LoginStrings.legalBody(topic).count > 100, "\(topic.rawValue) sheet has real text")
        // Bundled text, never a link — the app has no network and the offline claim depends on it.
        expect(!LoginStrings.legalBody(topic).contains("http"),
               "\(topic.rawValue) text contains no URL")
    }
    expect(LoginStrings.legalTitle(.privacy) != LoginStrings.legalTitle(.terms),
           "the two sheets are distinguishable")
    expect(LoginStrings.legalBody(.privacy) != LoginStrings.legalBody(.terms),
           "the two sheets say different things")
    expect(LoginLegalTopic.allCases.count == 2, "two legal topics")

    return LoginMetricsCheckResult(passed: passed, failures: failures)
}
