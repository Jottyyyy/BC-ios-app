import SwiftUI
import BiyaherongCoachCore

// The login screen: brand hero, one simulated "Continue with Apple" button, a bundled legal sheet.
// Presentation only — the session lives in `LoginStore` and the gate lives in `PhoneApp`.
//
// Every number comes from `LoginMetrics.swift`; there is no numeric literal and no arithmetic in
// any view body here, which is what makes `LoginMetricsCheck` able to assert the whole layout
// without a renderer. Keep it that way.
//
// Twin of `web-demo/js/login.js`; `tools/qa/replay_login.js` asserts they agree.

/// Piece art and the Apple mark. The drift table stores its kinds as strings so the metrics file
/// stays free of engine types; this is where they become real pieces.
@MainActor
enum LoginArt {
    /// Apple's own mark. Never recoloured and never substituted — it is the one glyph on this
    /// screen that is not ours.
    static let appleSymbol = "applelogo"

    static func kind(_ name: String) -> PieceKind {
        switch name {
        case "pawn": return .pawn
        case "knight": return .knight
        case "bishop": return .bishop
        case "rook": return .rook
        case "queen": return .queen
        default: return .king
        }
    }

    static func piece(_ spec: LoginDriftSpec) -> Piece {
        Piece(spec.white ? .white : .black, kind(spec.kind))
    }

    /// Warms the brand logo and every piece the drift field draws, so the first frame of the app's
    /// very first screen never decodes inline.
    static func preload() {
        _ = HomeArt.raster(.brandLogo)
        for spec in LoginDrift.specs { _ = PieceArt.drawing(for: piece(spec)) }
    }
}

// MARK: - The screen

struct LoginScreen: View {
    /// Raised when a session opens, with the provider that opened it — `LoginSession.appleProvider`
    /// or `LoginSession.guestProvider`. The host owns the transition to the dashboard.
    let onSignedIn: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false
    @State private var legalTopic: LoginLegalTopic?
    /// Owns the Apple request. `@StateObject` because the request outlives a body re-evaluation and
    /// a controller that gets released mid-flight never calls back.
    @StateObject private var appleAuth = LoginAppleAuth()

    var body: some View {
        GeometryReader { geo in
            ZStack {
                LoginPalette.screenBg.ignoresSafeArea()
                LoginGlow()
                LoginDriftLayer(animated: !reduceMotion, container: geo.size)
                content(screenHeight: geo.size.height)
                if let topic = legalTopic {
                    LoginLegalSheet(topic: topic, onClose: { closeLegal() })
                        .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .onAppear { entered = true }
    }

    // MARK: Bands

    /// The hero's top is its floor PLUS its share of the leftover, and the `Spacer` below takes the
    /// rest — which is the same distribution the browser's `flex-grow: 35 / 65` produces. Pinning
    /// the hero to the floor instead left a ~400pt void on a tall phone.
    private func content(screenHeight: CGFloat) -> some View {
        VStack(spacing: LoginLayout.atRest) {
            hero
            Spacer(minLength: LoginLayout.minSpacer)
            actions
        }
        .padding(.horizontal, LoginLayout.screenPaddingH)
        .padding(.top, LoginLayout.heroTop(screenHeight: screenHeight))
        .padding(.bottom, LoginLayout.footerBottomPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var hero: some View {
        VStack(spacing: LoginLayout.atRest) {
            logo
            VStack(spacing: LoginLayout.atRest) {
                Text(LoginStrings.title)
                    .font(Theme.nunito(LoginType.titleSize, .extraBold))
                    .tracking(LoginType.titleTracking)
                    .foregroundStyle(LoginPalette.title)
                Text(LoginStrings.tagline)
                    .font(Theme.nunito(LoginType.taglineSize, .medium))
                    .foregroundStyle(LoginPalette.tagline)
                    .padding(.top, LoginLayout.titleTaglineGap)
            }
            .multilineTextAlignment(.center)
            .padding(.top, LoginLayout.heroSpacing)
            .offset(y: entered ? LoginLayout.atRest : LoginLayout.entranceRise)
            .opacity(entered ? LoginLayout.shown : LoginLayout.hidden)
            .animation(entrance(LoginTiming.textEntrance), value: entered)
        }
    }

    /// The brand mark in a gold-ringed squircle. Same construction as `HomeLogo`
    /// (`HomeParts.swift:90`): `strokeBorder` so the ring sits inside the box the way an RN/CSS
    /// border does, and the glow applied AFTER the clip or it would be clipped away with it.
    private var logo: some View {
        HomeAppIcon(size: LoginLayout.logoSize,
                    shape: RoundedRectangle(cornerRadius: LoginLayout.logoRadius, style: .continuous),
                    asset: .brandLogo)
            .overlay(RoundedRectangle(cornerRadius: LoginLayout.logoRadius, style: .continuous)
                .strokeBorder(LoginPalette.logoRing, lineWidth: LoginLayout.logoRingWidth))
            .shadow(color: LoginPalette.logoGlow.opacity(LoginLayout.logoGlowOpacity),
                    radius: LoginLayout.logoGlowRadius)
            .scaleEffect(entered ? LoginLayout.restScale : LoginLayout.entranceScale)
            .opacity(entered ? LoginLayout.shown : LoginLayout.hidden)
            .animation(entrance(LoginTiming.heroEntrance), value: entered)
            .accessibilityLabel(Text(LoginStrings.title))
    }

    private var actions: some View {
        VStack(spacing: LoginLayout.atRest) {
            LoginAppleButton(action: { signIn() })
                // An alert, not a band: this screen's height budget is asserted against the
                // shortest supported phone, and a login screen that scrolls is a bug. An alert
                // costs no layout at all.
                //
                // The FIRST button is the way out. App Review's 1.0.7 rejection was an alert with
                // one button on it, and that button led back to the same wall; this one leads into
                // the app. `sheetClose` is the cancel role, so it is still the one Escape picks.
                .alert(LoginStrings.authFailed,
                       isPresented: Binding(get: { LoginAuth.showsError(appleAuth.phase) },
                                            set: { if !$0 { appleAuth.dismissError() } })) {
                    Button(LoginStrings.guestButton) {
                        appleAuth.dismissError()
                        continueWithoutAccount()
                    }
                    Button(LoginStrings.sheetClose, role: .cancel) { appleAuth.dismissError() }
                } message: {
                    Text(appleAuth.failureMessage)
                }
            LoginGuestButton(action: { continueWithoutAccount() })
                .padding(.top, LoginLayout.guestTopGap)
            Text(LoginStrings.reassurance)
                .font(Theme.nunito(LoginType.reassureSize, .medium))
                .foregroundStyle(LoginPalette.reassure)
                .multilineTextAlignment(.center)
                .padding(.top, LoginLayout.reassureTopGap)
            legalFooter
                .padding(.top, LoginLayout.footerTopGap)
        }
        .offset(y: entered ? LoginLayout.atRest : LoginLayout.entranceRise)
        .opacity(entered ? LoginLayout.shown : LoginLayout.hidden)
        .animation(entrance(LoginTiming.buttonEntrance), value: entered)
    }

    private var legalFooter: some View {
        HStack(spacing: LoginLayout.legalGap) {
            legalButton(.privacy)
            Text(LoginStrings.legalSeparator)
                .font(Theme.nunito(LoginType.legalSize, .medium))
                .foregroundStyle(LoginPalette.legal)
            legalButton(.terms)
        }
    }

    private func legalButton(_ topic: LoginLegalTopic) -> some View {
        Button { openLegal(topic) } label: {
            Text(LoginStrings.legalTitle(topic))
                .font(Theme.nunito(LoginType.legalSize, .medium))
                .foregroundStyle(LoginPalette.legal)
        }
        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
    }

    // MARK: Behaviour

    /// Under Reduce Motion the entrance still *happens* — it just happens instantly, because
    /// `.animation(nil, value:)` applies the change without interpolating it.
    private func entrance(_ base: Animation) -> Animation? { reduceMotion ? nil : base }

    /// Raises Apple's real sheet. Only a genuine success opens the session; a cancel leaves the
    /// gate exactly where it was, and a failure surfaces the alert. The haptic moved inside the
    /// success branch — it used to fire on the tap, which would now celebrate a cancel.
    private func signIn() {
        appleAuth.start { provider in
            Haptics.play(.success)
            onSignedIn(provider)
        }
    }

    /// The second way in, and the one that cannot fail: it calls nothing, waits for nothing, and
    /// reaches nothing. There is no account server behind the Apple button either — see
    /// `LoginSession.guestProvider` for why requiring it was both the rejection and a 5.1.1(v)
    /// problem of its own.
    private func continueWithoutAccount() {
        Haptics.play(.success)
        onSignedIn(LoginSession.guestProvider)
    }

    private func openLegal(_ topic: LoginLegalTopic) {
        withAnimation(.easeInOut(duration: LoginTiming.sheetFadeSeconds)) { legalTopic = topic }
    }

    private func closeLegal() {
        withAnimation(.easeInOut(duration: LoginTiming.sheetFadeSeconds)) { legalTopic = nil }
    }
}

// MARK: - Parts

/// Apple's **white** sign-in button. White-on-dark is the variant Apple's guidance calls for on a
/// dark background, and the mark stays black on white — it is never tinted to the app's gold.
///
/// The label is deliberately the SYSTEM font rather than Nunito, the one exception on this screen:
/// the real `ASAuthorizationAppleIDButton` that will replace this renders in San Francisco, so
/// matching it now means the control does not visibly change size when the simulation goes away.
/// Recorded in PORTING_NOTES.md.
struct LoginAppleButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: LoginLayout.buttonGlyphGap) {
                Image(systemName: LoginArt.appleSymbol)
                    .font(.system(size: LoginLayout.buttonGlyphSize, weight: .medium))
                Text(LoginStrings.appleButton)
                    .font(.system(size: LoginType.buttonLabelSize, weight: .semibold))
                    .tracking(LoginType.buttonTracking)
            }
            .foregroundStyle(LoginPalette.appleInk)
            .frame(maxWidth: .infinity)
            .frame(height: LoginLayout.buttonHeight)
            .background(LoginPalette.appleFill,
                        in: RoundedRectangle(cornerRadius: LoginLayout.buttonRadius, style: .continuous))
            .shadow(color: LoginPalette.appleShadow,
                    radius: LoginLayout.buttonShadowRadius, y: LoginLayout.buttonShadowY)
        }
        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
        .accessibilityLabel(Text(LoginStrings.appleButton))
    }
}

/// The way in that does not go through anybody's servers.
///
/// An OUTLINE, not a fill, and shorter than the Apple button: the hierarchy is deliberate — Apple's
/// is the offer, this is the escape. What it is not is hidden. Apple's own Guideline 5.1.1(v) asks
/// for exactly this when an app has no significant account-based features, and this one has none at
/// all, so burying it in a menu would be complying with the letter and missing the point.
///
/// Nunito rather than the system font, unlike `LoginAppleButton`: that one matches Apple's own
/// control by rule, this one is the app's, so it uses the app's face.
struct LoginGuestButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(LoginStrings.guestButton)
                .font(Theme.nunito(LoginType.guestLabelSize, .semiBold))
                .foregroundStyle(LoginPalette.guestLabel)
                .frame(maxWidth: .infinity)
                .frame(height: LoginLayout.guestButtonHeight)
                .background(
                    RoundedRectangle(cornerRadius: LoginLayout.buttonRadius, style: .continuous)
                        .strokeBorder(LoginPalette.guestBorder,
                                      lineWidth: LoginLayout.guestBorderWidth))
        }
        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
        .accessibilityLabel(Text(LoginStrings.guestButton))
    }
}

/// The warm pool of light behind the hero — two stops of one hue, so it reads as a glow and not as
/// a visible disc.
struct LoginGlow: View {
    var body: some View {
        RadialGradient(colors: [LoginPalette.glowInner, LoginPalette.glowOuter],
                       center: LoginLayout.glowCenter,
                       startRadius: LoginLayout.glowStartRadius,
                       endRadius: LoginLayout.glowEndRadius)
            .ignoresSafeArea()
            .allowsHitTesting(false)
    }
}

/// The faint field of drifting pieces. Real bundled SVG art at very low opacity — no new asset, and
/// no emoji, so it is the same artwork the boards draw.
struct LoginDriftLayer: View {
    let animated: Bool
    let container: CGSize

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(LoginDrift.specs.indices, id: \.self) { i in
                LoginDriftPiece(spec: LoginDrift.specs[i], animated: animated, container: container)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

struct LoginDriftPiece: View {
    let spec: LoginDriftSpec
    let animated: Bool
    let container: CGSize

    @State private var drifted = false

    var body: some View {
        PieceImage(piece: LoginArt.piece(spec), size: spec.size, shadow: false)
            .opacity(spec.opacity)
            .position(LoginDrift.point(spec, in: container))
            .offset(y: drifted ? spec.travel : LoginLayout.atRest)
            .onAppear { start() }
    }

    /// Under Reduce Motion the pieces are drawn and simply never move — removing them would take
    /// the texture away as well, which is not what the setting asks for.
    private func start() {
        guard animated else { return }
        withAnimation(LoginDrift.animation(spec)) { drifted = true }
    }
}

/// Privacy / Terms, from BUNDLED text. Not a URL: the app has no network, and opening one would
/// break the offline guarantee `ios/project.yml:69-71` rests on.
struct LoginLegalSheet: View {
    let topic: LoginLegalTopic
    let onClose: () -> Void

    var body: some View {
        ZStack {
            LoginPalette.sheetScrim
                .ignoresSafeArea()
                .onTapGesture { onClose() }
            card
        }
    }

    private var card: some View {
        VStack(spacing: LoginLayout.atRest) {
            Text(LoginStrings.legalTitle(topic))
                .font(Theme.nunito(LoginType.sheetTitleSize, .bold))
                .foregroundStyle(LoginPalette.sheetTitle)
            ScrollView {
                Text(LoginStrings.legalBody(topic))
                    .font(Theme.nunito(LoginType.sheetBodySize, .regular))
                    .foregroundStyle(LoginPalette.sheetBody)
                    .lineSpacing(LoginLayout.sheetLineSpacing)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: LoginLayout.sheetMaxBodyHeight)
            .padding(.top, LoginLayout.sheetTitleGap)
            Button(action: onClose) {
                Text(LoginStrings.sheetClose)
                    .font(Theme.nunito(LoginType.sheetCloseSize, .bold))
                    .foregroundStyle(Theme.onGold)
                    .frame(maxWidth: .infinity)
                    .frame(height: LoginLayout.sheetCloseHeight)
                    .background(Theme.gold,
                                in: RoundedRectangle(cornerRadius: LoginLayout.sheetCloseRadius))
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
            .padding(.top, LoginLayout.sheetBodyGap)
        }
        .padding(LoginLayout.sheetPadding)
        .frame(width: LoginLayout.sheetWidth)
        .background(LoginPalette.sheetFill,
                    in: RoundedRectangle(cornerRadius: LoginLayout.sheetRadius))
        .overlay(RoundedRectangle(cornerRadius: LoginLayout.sheetRadius)
            .strokeBorder(LoginPalette.sheetBorder, lineWidth: LoginLayout.sheetBorderWidth))
    }
}
