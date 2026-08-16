import SwiftUI

// The login screen's PURE layer: the band budget, every fixed size, the palette, the type scale,
// the drifting-piece table, the timings, the copy, and the session predicate.
//
// Nothing here builds a view, which is the point — `LoginMetricsCheck` (the runnable self-check
// executable, since this toolchain has no XCTest) asserts every value and every function in this
// file without a running UI, and `tools/qa/replay_login.js` asserts the same values against the
// JavaScript twin in `web-demo/js/login.js`.
//
// The rule that keeps that true, the same one `HomeMetrics.swift` states: **no numeric literal and
// no arithmetic in any view body.** Every number on the screen is a stored property or a pure
// function from this file.
//
// ## Where the numbers come from
//
// This screen has **no counterpart in the React Native app** — the original's `(auth)/login.tsx` is
// a username/password form against a Laravel API, and this one is a single simulated
// "Continue with Apple" button on a 100%-offline app. So most values here are *invented*, not
// extracted, and PORTING_NOTES.md carries the table of them. What IS taken from the source:
//
//   • the whole palette, via `Theme` — a 1:1 copy of the RN `constants/theme.ts`
//   • `LoginPalette.legal` (#3A5070), the RN login screen's `legalLink` colour
//   • `LoginLayout.screenPaddingH` (24), its `screen.paddingHorizontal`
//   • `LoginStrings.title` / `.tagline`, its hero copy, verbatim
//   • `LoginType.titleTracking` (0.5), its `appName.letterSpacing`

// MARK: - Typography

enum LoginType {
    /// Nunito's natural line box as a multiple of the point size. Mirrors
    /// `HomeType.nunitoLineHeightRatio`; used here for the *budget* only, never to lay text out —
    /// SwiftUI measures the real face at draw time. Keeping it a constant is what lets the JS twin
    /// compute the identical budget.
    static let lineHeightRatio: CGFloat = 1.364

    /// The nominal line box for a size, rounded the way both languages round.
    static func line(_ size: CGFloat) -> CGFloat { (size * lineHeightRatio).rounded() }

    static let titleSize: CGFloat = 30
    static let taglineSize: CGFloat = 14
    static let buttonLabelSize: CGFloat = 17
    static let reassureSize: CGFloat = 13
    static let legalSize: CGFloat = 11

    static let sheetTitleSize: CGFloat = 20
    static let sheetBodySize: CGFloat = 14
    static let sheetCloseSize: CGFloat = 15

    /// `appName.letterSpacing: 0.5` in the RN login screen.
    static let titleTracking: CGFloat = 0.5
    /// Apple's own button label is very slightly tightened; matching it keeps the simulated control
    /// from reading wider than the real `ASAuthorizationAppleIDButton` that will replace it.
    static let buttonTracking: CGFloat = -0.2
}

// MARK: - Palette

enum LoginPalette {
    static let screenBg = Theme.background

    /// The warm pool of light behind the hero. Two stops of one hue, so it reads as a glow rather
    /// than a visible disc.
    static let glowInner = Theme.c(0xFDB022, 0.16)
    static let glowOuter = Theme.c(0xFDB022, 0)

    static let logoRing = Theme.gold
    static let logoGlow = Theme.gold

    static let title = Theme.gold
    static let tagline = Theme.mutedForeground
    static let reassure = Theme.mutedForeground

    /// Apple's **white** button variant — the correct one on a dark background, per Apple's
    /// guidance. Black-on-white, not tinted: the mark must never be recoloured.
    static let appleFill = Theme.c(0xFFFFFF)
    static let appleInk = Theme.c(0x000000)
    static let appleShadow = Theme.c(0x000000, 0.35)

    /// Extracted: `legalLink` / `legalSep` in `(auth)/login.tsx`.
    static let legal = Theme.c(0x3A5070)

    static let sheetScrim = Theme.c(0x000000, 0.55)
    static let sheetFill = Theme.card
    static let sheetBorder = Theme.border
    static let sheetTitle = Theme.foreground
    static let sheetBody = Theme.mutedForeground
}

// MARK: - Layout

enum LoginLayout {
    /// `screen.paddingHorizontal: 24` in the RN login screen.
    static let screenPaddingH: CGFloat = 24

    // Hero
    static let heroTopPadding: CGFloat = 64
    static let logoSize: CGFloat = 124
    /// A squircle, not a circle: the brand mark is a square photo composition with a wordmark
    /// across its lower third, and a circle crops the "APP" badge off.
    static let logoRadius: CGFloat = 30
    /// Same weight as the home header's ring (`HomeLayout.logoBorderWidth`), so the two logos on
    /// the two screens are recognisably the same object.
    static let logoRingWidth: CGFloat = 2
    static let logoGlowRadius: CGFloat = 22
    static let logoGlowOpacity: Double = 0.45
    static let heroSpacing: CGFloat = 18
    static let titleTaglineGap: CGFloat = 6

    // Action band
    /// Apple's minimum is 44; 54 is a comfortable target for a child's thumb and matches the
    /// visual weight of the 124pt hero above it.
    static let buttonHeight: CGFloat = 54
    static let buttonRadius: CGFloat = Theme.radiusButton
    static let buttonGlyphSize: CGFloat = 19
    static let buttonGlyphGap: CGFloat = 8
    static let buttonShadowRadius: CGFloat = 14
    static let buttonShadowY: CGFloat = 6
    static let pressedButton: Double = 0.82

    static let reassureTopGap: CGFloat = 14
    static let footerTopGap: CGFloat = 18
    static let footerBottomPadding: CGFloat = 22
    static let legalGap: CGFloat = 8

    /// The smallest gap the flexible spacer is ever allowed to collapse to.
    static let minSpacer: CGFloat = 24

    /// How much of the leftover height goes ABOVE the hero rather than below it.
    ///
    /// Without this the hero pinned to a 64pt top padding and the button pinned to the bottom, which
    /// on a tall phone left ~400pt of nothing between them and read as two disconnected clusters.
    /// Splitting the leftover drifts the hero down toward optical centre and keeps the proportion
    /// the same on every device: the logo lands at ~32% of the screen on a 667pt phone and on an
    /// 852pt one alike. 0.35 rather than 0.5 because the eye reads a centred block as slightly low.
    ///
    /// This is exactly what flexbox does with `flex-grow: 35` / `flex-grow: 65` over a zero basis,
    /// which is how the browser twin spells the same rule.
    static let spacerTopShare: CGFloat = 0.35

    // The warm pool of light behind the hero.
    static let glowCenter = UnitPoint(x: 0.5, y: 0.26)
    static let glowStartRadius: CGFloat = 0
    static let glowEndRadius: CGFloat = 320

    // Entrance
    static let entranceScale: CGFloat = 0.86
    static let restScale: CGFloat = 1
    static let entranceRise: CGFloat = 14
    static let atRest: CGFloat = 0
    static let hidden: Double = 0
    static let shown: Double = 1

    // Legal sheet
    static let sheetWidth: CGFloat = 320
    static let sheetRadius: CGFloat = Theme.radius
    static let sheetPadding: CGFloat = 22
    static let sheetMaxBodyHeight: CGFloat = 300
    static let sheetTitleGap: CGFloat = 10
    static let sheetBodyGap: CGFloat = 18
    static let sheetCloseHeight: CGFloat = 44
    static let sheetCloseRadius: CGFloat = Theme.radiusButton
    static let sheetBorderWidth: CGFloat = 1
    static let sheetLineSpacing: CGFloat = 4

    /// Everything the screen draws except the one flexible spacer. Both languages compute this the
    /// same way, and `LoginMetricsCheck` asserts it leaves room on the shortest phone the app
    /// supports — a login screen that scrolls is a bug, not a layout.
    static func fixedHeight() -> CGFloat {
        heroTopPadding
            + logoSize
            + heroSpacing
            + LoginType.line(LoginType.titleSize)
            + titleTaglineGap
            + LoginType.line(LoginType.taglineSize)
            + buttonHeight
            + reassureTopGap
            + LoginType.line(LoginType.reassureSize)
            + footerTopGap
            + LoginType.line(LoginType.legalSize)
            + footerBottomPadding
    }

    /// The height the fixed bands do not claim. Everything below distributes exactly this.
    static func leftover(screenHeight: CGFloat) -> CGFloat {
        max(0, screenHeight - fixedHeight())
    }

    /// Where the hero starts: its floor, plus its share of the leftover. On a screen with no
    /// leftover at all this is exactly `heroTopPadding`, so the budget below still holds.
    static func heroTop(screenHeight: CGFloat) -> CGFloat {
        heroTopPadding + (leftover(screenHeight: screenHeight) * spacerTopShare).rounded()
    }

    /// What the flexible band between the hero and the button gets — the rest of the leftover,
    /// never below the floor.
    static func spacer(screenHeight: CGFloat) -> CGFloat {
        max(minSpacer, (leftover(screenHeight: screenHeight) * (1 - spacerTopShare)).rounded())
    }

    /// The shortest device the app targets (iPhone SE, 2nd/3rd gen). The budget must fit here.
    static let shortestSupportedHeight: CGFloat = 667
}

// MARK: - Timing

enum LoginTiming {
    static let heroEntranceSeconds: Double = 0.55
    static let heroEntranceDelay: Double = 0.05
    static let heroDamping: Double = 0.72
    static let textEntranceSeconds: Double = 0.45
    static let textEntranceDelay: Double = 0.18
    static let buttonEntranceSeconds: Double = 0.45
    static let buttonEntranceDelay: Double = 0.30
    /// The cross-fade to the dashboard. The user asked for an *immediate* sign-in, so this is a
    /// transition, not a simulated round trip — there is no fake spinner and no artificial wait.
    static let signInFadeSeconds: Double = 0.35
    static let sheetFadeSeconds: Double = 0.22

    /// The logo settles with a spring; the text and the button only rise and fade. A spring on all
    /// three reads as three separate bounces, which is busier than "welcoming".
    static var heroEntrance: Animation {
        .spring(response: heroEntranceSeconds, dampingFraction: heroDamping).delay(heroEntranceDelay)
    }
    static var textEntrance: Animation {
        .easeOut(duration: textEntranceSeconds).delay(textEntranceDelay)
    }
    static var buttonEntrance: Animation {
        .easeOut(duration: buttonEntranceSeconds).delay(buttonEntranceDelay)
    }
}

// MARK: - Drifting background art

/// One faint chess piece drifting behind the hero. Real bundled piece art (`PieceImage`), not a new
/// asset and not an emoji.
struct LoginDriftSpec: Equatable {
    /// `PieceArt` asset stem, e.g. `knight`. A string rather than a `PieceKind` so the JS twin can
    /// compare the table without importing the engine.
    let kind: String
    let white: Bool
    /// Position as a fraction of the container, so the field is device-independent.
    let x: CGFloat
    let y: CGFloat
    let size: CGFloat
    /// How far it drifts, and how long one leg of the round trip takes.
    let travel: CGFloat
    let seconds: Double
    let delay: Double
    let opacity: Double
}

enum LoginDrift {
    /// Eight pieces, hand-placed to stay clear of the hero and the button. Deliberately a fixed
    /// table and not randomised: `inRandomOrder()`-style non-determinism is modelled as injected
    /// data in this repo, never as reproduced RNG, and a background that differs run to run cannot
    /// be asserted at all.
    static let specs: [LoginDriftSpec] = [
        LoginDriftSpec(kind: "pawn", white: true, x: 0.10, y: 0.08,
                       size: 34, travel: 10, seconds: 7.0, delay: 0.0, opacity: 0.06),
        LoginDriftSpec(kind: "knight", white: true, x: 0.78, y: 0.06,
                       size: 46, travel: 14, seconds: 9.0, delay: 0.6, opacity: 0.07),
        LoginDriftSpec(kind: "rook", white: false, x: 0.90, y: 0.20,
                       size: 32, travel: 9, seconds: 8.0, delay: 1.2, opacity: 0.05),
        LoginDriftSpec(kind: "bishop", white: true, x: 0.06, y: 0.30,
                       size: 30, travel: 11, seconds: 10.0, delay: 0.3, opacity: 0.05),
        LoginDriftSpec(kind: "queen", white: false, x: 0.16, y: 0.52,
                       size: 40, travel: 12, seconds: 8.5, delay: 1.6, opacity: 0.06),
        LoginDriftSpec(kind: "pawn", white: false, x: 0.86, y: 0.48,
                       size: 28, travel: 8, seconds: 7.5, delay: 0.9, opacity: 0.05),
        LoginDriftSpec(kind: "knight", white: false, x: 0.72, y: 0.68,
                       size: 36, travel: 13, seconds: 9.5, delay: 2.0, opacity: 0.05),
        LoginDriftSpec(kind: "rook", white: true, x: 0.12, y: 0.74,
                       size: 34, travel: 10, seconds: 8.2, delay: 1.4, opacity: 0.06)
    ]

    /// Where a spec sits in a container. Kept here so no view body does arithmetic.
    static func point(_ spec: LoginDriftSpec, in size: CGSize) -> CGPoint {
        CGPoint(x: size.width * spec.x, y: size.height * spec.y)
    }

    /// The drift itself. `autoreverses` is what makes it a float rather than a loop that snaps.
    static func animation(_ spec: LoginDriftSpec) -> Animation {
        .easeInOut(duration: spec.seconds).repeatForever(autoreverses: true).delay(spec.delay)
    }

    /// Every distinct piece the field needs, so the caller can warm them before the screen appears.
    static var usedKinds: [String] { Array(Set(specs.map(\.kind))).sorted() }
}

// MARK: - Session

/// The persisted sign-in, as a pure predicate over the stored string. No `UserDefaults` here — the
/// store injects that (see `LoginStore`), which is what makes this assertable.
enum LoginSession {
    /// Same `biya.<area>.<thing>.v1` shape as `biya.coach.takeback.v1` and `biya.analysis.engine.v1`.
    static let storageKey = "biya.auth.session.v1"

    static let appleProvider = "apple"

    /// The providers a stored value may name. Unknown values are treated as signed out rather than
    /// trusted, so a hand-edited or half-written key fails closed.
    static let providers: [String] = [appleProvider]

    static func isSignedIn(_ raw: String?) -> Bool {
        guard let raw, !raw.isEmpty else { return false }
        return providers.contains(raw)
    }

    /// What the Profile tab shows beside "Signed in with".
    static func providerLabel(_ raw: String?) -> String {
        isSignedIn(raw) && raw == appleProvider ? LoginStrings.appleProviderLabel : LoginStrings.noProviderLabel
    }
}

// MARK: - Copy

/// Taglish, matching the original app's voice. The button label is Apple's required wording and
/// stays English.
enum LoginStrings {
    static let title = "Biyaherong Coach"
    static let tagline = "Kabiyahe mo sa pag improve!"
    static let appleButton = "Continue with Apple"
    static let reassurance = "Walang password — i-tap lang at maglaro na!"

    static let privacy = "Privacy"
    static let terms = "Terms"
    static let legalSeparator = "·"

    static let defaultDisplayName = "Biyahero"
    static let appleProviderLabel = "Apple"
    static let noProviderLabel = "—"

    static let accountCard = "Account"
    static let signedInWith = "Signed in with"
    static let signOut = "Sign out"

    static let sheetClose = "Sige, salamat!"

    static let privacyTitle = "Privacy"
    static let privacyBody = """
    Biyaherong Coach works 100% offline. It does not collect, store, or send any personal \
    information anywhere — there is no account server and no analytics.

    Your puzzles, ratings, games and settings live on this device only. Signing in simply remembers \
    you here so you do not see this screen again.

    Walang datos na inilalabas. Lahat ay nasa device mo lang.
    """

    static let termsTitle = "Terms"
    static let termsBody = """
    Biyaherong Coach is for learning and enjoying chess. Play fair, be kind, and have fun.

    The app is provided as-is for practice and study. Chess piece artwork is licensed CC BY-SA, the \
    Nunito typeface under the SIL Open Font License, and the app itself is GPL.

    Maglaro nang patas. Mag-enjoy!
    """

    static func legalBody(_ topic: LoginLegalTopic) -> String {
        topic == .privacy ? privacyBody : termsBody
    }

    static func legalTitle(_ topic: LoginLegalTopic) -> String {
        topic == .privacy ? privacyTitle : termsTitle
    }
}

/// Which bundled legal text the sheet is showing. Bundled, not a URL: the app has no network, and
/// opening one would break the offline guarantee `ios/project.yml` relies on.
enum LoginLegalTopic: String, CaseIterable, Identifiable {
    case privacy
    case terms
    var id: String { rawValue }
}
