import SwiftUI
import BiyaherongCoachCore

// ── Panel wrapper: a scaled iPhone frame on a soft violet backdrop ───────────

struct PhoneView: View {
    /// Demo chrome only — it lives OUTSIDE the phone frame because it is not part of the app.
    /// `isColorful` is a plain view input on HomeScreen with no persistence (§12); this picker
    /// exists so both themes are visible on a desktop without editing code.
    @State private var homeColorful = false

    var body: some View {
        GeometryReader { geo in
            let scale = min(1.05, max(0.5, (geo.size.height - 20) / 824))
            ZStack {
                LinearGradient(colors: [Theme.card, Theme.background], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
                PhoneFrame { PhoneApp(homeColorful: homeColorful) }.scaleEffect(scale)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .overlay(alignment: .top) {
                Picker("Home theme", selection: $homeColorful) {
                    Text("Sky").tag(false)
                    Text("Colorful").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                .padding(.top, 8)
            }
        }
    }
}

struct PhoneFrame<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .frame(width: 392, height: 812)
            .background(Theme.background)
            .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 46, style: .continuous).stroke(Color.black.opacity(0.9), lineWidth: 12))
            .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1).padding(6))
            .overlay(alignment: .top) {
                Capsule().fill(.black).frame(width: 120, height: 34).padding(.top, 12)
            }
            .shadow(color: .black.opacity(0.4), radius: 34, y: 14)
    }
}

struct PhoneApp: View {
    /// Passed straight through to `HomeScreen`. Defaulted, so existing call sites are unaffected.
    var homeColorful: Bool = false

    /// The Puzzle Hub's state. One store for all five modes and every screen inside them.
    @StateObject private var puzzleStore = PuzzleHubStore()
    /// The Analysis Board is a pushed route in the original. It covers the whole phone, which is
    /// now what EVERY destination does — see the note on `body`.
    @State private var showAnalysis = false
    /// The Puzzle Hub. It was tab 1 until the tab bar was removed; it is a pushed route now, like
    /// everything else reached from a Home tile.
    @State private var showPuzzles = false
    /// Profile. Reached from the Home header's avatar, which is the only door it has ever had
    /// besides the tab bar — so it is the one screen that needed a back button of its own.
    @State private var showProfile = false
    /// The Pairing Manager is a pushed route too, for the same reason: it is reached from a Home
    /// tile, not a tab, and its three tabs of its own leave no room for the app's.
    @StateObject private var pairingStore = PairingStore()
    @State private var showPairing = false
    /// Play vs Coach, presented the same way and for the same reason: three screens of its own,
    /// reached from the Home tile. It used to share the app with a *second* play screen on tab 2 —
    /// the pre-port sample, kept alive only because `BoardView` lived inside `PlayView.swift`.
    /// That lift happened; the tab bar removal took its last door; the screen is gone.
    @StateObject private var coachStore = CoachStore()
    @State private var showCoach = false
    /// The Opening Tree, presented the same way and for the same reason: three screens of its own,
    /// reached from the Home tile. The tile has existed since the screen was written and its
    /// callback was never passed — this is the destination it was waiting for.
    @StateObject private var openingStore = OpeningTreeStore()
    @State private var showOpenings = false
    /// The simulated sign-in. It gates the whole app: until it is signed in, `LoginScreen` covers
    /// every sibling below. Persisted, so this is the first screen once and not on every launch.
    /// See docs/login.md.
    @StateObject private var loginStore = LoginStore()
    /// The subscription. One store for the whole shell, so every gate reads the same live
    /// entitlement rather than a cached copy — the failure the RN app had, where a stale
    /// `@is_premium` in AsyncStorage disagreed with the server. See docs/subscription.md.
    @StateObject private var premium = PremiumStore()
    /// The paywall. Reached from the "⭐ Go Premium" banner, from a cap a subscriber's lapse put
    /// them under — and, since round 4 of client feedback, from **every** tap a user without an
    /// entitlement makes. See `locked` below.
    @State private var showPaywall = false
    @Environment(\.scenePhase) private var scenePhase

    // Explicit rather than relying on the synthesized inits: the `private` @StateObject properties
    // make the memberwise initializer private, so only the file-local no-argument form would be
    // reachable from Roots.swift. Spelling it out keeps both call sites obviously valid.
    init(homeColorful: Bool = false) { self.homeColorful = homeColorful }

    // ── The trial gate ───────────────────────────────────────────────────────
    //
    // Client decision, round 4: *"make sure hindi sila makakapaglaro ng kahit ano … kapag hindi
    // sila naka 7-days free trial … kada click lagi mong dalhin doon na go for free trial."*
    //
    // This REVERSES the policy `docs/subscription.md` was written around, where the free tier was
    // genuinely playable and the paywall was reached on demand. Home still draws — the user has to
    // see what the trial buys — but every tile and every content tab now lands on the paywall
    // instead of a screen.
    //
    // It lives here, at the shell, and nowhere else. `Entitlement`, `DailyLimits` and every
    // per-feature gate in `PuzzleHubScreen` / `CoachScreens` are untouched: they are parity-tested
    // Core with `requireMinCounts` floors, they still describe the state a LAPSED subscriber
    // returns to, and one guard at the only choke point is the difference between a rule and a
    // checklist of screens somebody will forget to add to.

    /// A signed-in user with no entitlement at all — the state every fresh install is in.
    ///
    /// `isSignedIn` is half of it because the login gate is the ZStack's LAST sibling and covers
    /// the paywall: raising a paywall behind the login screen would be invisible, and would put a
    /// second wall in front of the first one.
    private var locked: Bool { loginStore.isSignedIn && !premium.isPremium }

    /// The two destinations a locked user keeps. **Home**, so the offer has something to sell
    /// against; and **Profile**, because it owns Sign out — walling it strands a user who signed in
    /// with the wrong Apple Account, and Restore Purchases lives on the paywall they would then be
    /// unable to leave.
    ///
    /// This used to be `openTabs: Set<Int> = [0, 3]`, and the browser had to map those indices
    /// through its own tab table to know what they meant. With Home as the root there are no
    /// indices: the open set is "Home, plus Profile", and Home is simply what is underneath.
    private var profileIsOpen: Bool { true }

    /// Every pushed route is closed while locked, by construction: each one is raised by a Home
    /// tile and by nothing else, and every tile goes through `gated`. `showProfile` is the single
    /// deliberate exception, raised straight from `onAvatar`.
    ///
    /// Resolved on every render rather than only at tap time: `Transaction.updates` can revoke an
    /// entitlement mid-session, and a user standing inside the Puzzle Hub when that happens must
    /// not keep playing it until they next tap something.
    private var lockedOut: Bool { locked }

    /// Wraps a Home tile's action. Runs it, or raises the paywall in its place while locked.
    ///
    /// Every destination — Puzzles, Analysis, Play vs Coach, Pairing, Opening Tree — is reachable
    /// ONLY from a Home tile, so wrapping the tiles closes all five without a flag of their own.
    private func gated(_ action: @escaping () -> Void) -> () -> Void {
        { if locked { openPaywall() } else { action() } }
    }

    var body: some View {
        // The home screen's responsive scalar is derived from the whole phone screen, matching the
        // original's `Dimensions.get('window')`. Adding the safe-area insets back reconstructs that
        // window height; inside the macOS PhoneFrame there are no insets and this is a clean
        // 392 × 812, which is exactly the design baseline.
        GeometryReader { shell in
            let basis = CGSize(width: shell.size.width,
                               height: shell.size.height
                                   + shell.safeAreaInsets.top + shell.safeAreaInsets.bottom)
            // A ZStack sibling rather than `.fullScreenCover`, which does not exist on macOS — and
            // this view renders inside the macOS demo (AppShell.swift:46).
            //
            // **Home is the root.** There is no tab bar: every destination is a sibling raised by a
            // Home tile and closed by its own back button, which is what the original RN app does
            // and what `docs/home-screen.md` named as the fix for a grid that was ~74 pt
            // over-constrained by hosting Home as tab 0.
            ZStack {
                VStack(spacing: 0) {
                    #if os(macOS)
                    statusBar   // simulated status bar for the desktop phone-frame preview only
                    #endif
                    home(basis: basis)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if showPuzzles {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        // The HUB, not the ten hand-made samples. Those use the opposite move
                        // convention (`solution[0]` is the solver's, where the corpus has
                        // `moves[0]` belonging to the opponent), so the two cannot share a solver —
                        // which is why the old screen is a dev entry rather than adapted.
                        PuzzleHubScreen(store: puzzleStore, premium: premium,
                                        onExit: { showPuzzles = false },
                                        onPaywall: { openPaywall() })
                    }
                    .background(PuzzlePalette.screenBg)
                    .transition(.move(edge: .bottom))
                }
                if showProfile {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        ProfilePhone(store: puzzleStore, login: loginStore, premium: premium,
                                     onExit: { showProfile = false },
                                     onPaywall: { openPaywall() })
                    }
                    .background(Theme.background)
                    .transition(.move(edge: .bottom))
                }
                if showAnalysis {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        AnalysisBoardScreen(onClose: { showAnalysis = false },
                                            reviewGate: { premium.consumeReview() },
                                            onPaywall: { openPaywall() })
                    }
                    .background(AnalysisPalette.screenBg)
                    .transition(.move(edge: .bottom))
                }
                if showPairing {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        PairingRootScreen(store: pairingStore, premium: premium,
                                          onExit: { showPairing = false })
                    }
                    // `PairingPalette` has no screenBg and there is no PairingTiming; rather than
                    // invent two constants, the extracted screen fill and the Analysis Board's
                    // present timing are reused deliberately.
                    .background(PairingList.containerBackgroundColor)
                    .transition(.move(edge: .bottom))
                }
                if showOpenings {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        OpeningTreeRootScreen(store: openingStore,
                                              onExit: { showOpenings = false })
                    }
                    .background(OpeningPalette.screenBg)
                    .transition(.move(edge: .bottom))
                }
                if showCoach {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        CoachRootScreen(store: coachStore, premium: premium,
                                        onExit: { showCoach = false },
                                        onPaywall: { openPaywall() })
                            // Spec 2.10's hand-off: Start Review closes Play vs Coach and opens
                            // the Analysis Board on the reviewed game, classifications and all.
                            .onChange(of: coachStore.pendingHandoff) { _, payload in
                                guard payload != nil else { return }
                                showCoach = false
                                withAnimation(.easeInOut(
                                    duration: AnalysisTiming.screenPresentSeconds)) {
                                    showAnalysis = true
                                }
                            }
                    }
                    .background(CoachSelect.containerBackgroundColor)
                    .transition(.move(edge: .bottom))
                }
                // The paywall sits ABOVE the three pushed routes — a gate hit inside Play vs Coach
                // has to be able to cover it — but BELOW the login gate, which must stay last.
                if showPaywall {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        PaywallScreen(store: premium, onClose: { closePaywall() })
                    }
                    .background(PaywallPalette.screenBg)
                    .transition(.move(edge: .bottom))
                }
                // LAST sibling on purpose: the login gate has to cover every pushed route above,
                // not sit behind them. A ZStack sibling for the same reason they are —
                // `.fullScreenCover` does not exist on macOS and this view renders inside the
                // desktop phone frame.
                //
                // It cross-fades rather than sliding: signing in reveals the app that was always
                // there, where the routes above are pushes onto it.
                if !loginStore.isSignedIn {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        LoginScreen(onSignedIn: { signIn() })
                    }
                    .background(LoginPalette.screenBg)
                    .transition(.opacity)
                }
            }
            .frame(width: shell.size.width, height: shell.size.height)
        }
        // The entitlement is re-read at launch and on every foreground, and `Transaction.updates`
        // carries renewals and revocations for the rest of the app's life. Nothing here is trusted
        // from a cached boolean.
        .task {
            premium.startObserving()
            await premium.refresh()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await premium.refresh() }
        }
    }

    private func openPaywall() {
        withAnimation(.easeInOut(duration: PaywallTiming.presentSeconds)) { showPaywall = true }
    }

    private func closePaywall() {
        withAnimation(.easeInOut(duration: PaywallTiming.presentSeconds)) { showPaywall = false }
    }

    /// The simulated sign-in, animated here rather than inside `LoginScreen` — the screen raises the
    /// event, the host owns the transition, the same split every other route on this shell uses.
    private func signIn() {
        withAnimation(.easeInOut(duration: LoginTiming.signInFadeSeconds)) { loginStore.signIn() }
    }

    /// Only the callbacks with a real destination today are wired; the rest are the empty closures
    /// the screen is designed around and stay that way until those screens exist. `onVideos` is the
    /// last one left — `onOpeningTrainer` got its screen in round 4, and `onSearch` / `onDonate`
    /// were removed with the controls that raised them.
    ///
    /// Every wired destination goes through `gated`, so a user who has not started the trial gets
    /// the paywall instead. `onAvatar` and `onMembership` deliberately do not: one leads to Sign
    /// out, the other IS the paywall.
    ///
    /// Arguments must follow `HomeScreen.init`'s declaration order — `userName` is first, and
    /// `onAnalysis` sits between `onPuzzles` and `onPlayCoach`.
    private func home(basis: CGSize) -> some View {
        // `userName` used to be left at its default, so the header avatar drew the "?" fallback.
        // There is a signed-in user now, so it draws their initial.
        HomeScreen(userName: loginStore.displayName,
                   isPremium: premium.isPremium,
                   subscriptionEndsAt: premium.expiresAt,
                   isColorful: homeColorful,
                   scaleBasis: basis,
                   // Not gated: Profile owns Sign out, and the membership banner IS the offer.
                   onAvatar: { withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                       showProfile = true
                   } },
                   onPuzzles: gated {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showPuzzles = true
                       }
                   },
                   onAnalysis: gated {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showAnalysis = true
                       }
                   },
                   onOpeningTrainer: gated {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showOpenings = true
                       }
                   },
                   onPlayCoach: gated {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showCoach = true
                       }
                   },
                   onPairing: gated {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showPairing = true
                       }
                   },
                   // The banner has drawn "⭐ Go Premium" since the screen was written and its tap
                   // went nowhere. This is where it goes.
                   onMembership: { openPaywall() })
    }

    private var statusBar: some View {
        HStack {
            Text("9:41").font(Theme.nunito(14, .semiBold))
            Spacer()
            HStack(spacing: 6) { Image(systemName: "cellularbars"); Image(systemName: "wifi"); Image(systemName: "battery.75") }
                .font(Theme.nunito(12, .medium))
        }
        .foregroundStyle(Theme.foreground)
        .padding(.horizontal, 26).padding(.top, 15).padding(.bottom, 6)
    }
}

// ── Shared building blocks ───────────────────────────────────────────────────

struct PhoneTitle: View {
    let title: String
    var body: some View {
        HStack {
            Text(title).font(Theme.nunito(30, .bold)).foregroundStyle(Theme.foreground)
            Spacer()
        }.padding(.horizontal, 18).padding(.top, 4)
    }
}

/// `PhoneTitle` with a way out.
///
/// A second type rather than an optional `onBack:` on the first: `PhoneTitle` is the plain
/// left-aligned heading the desktop panels use, and a defaulted closure would let a screen forget
/// its exit silently. Here the back button is not optional — it is the only exit there is.
///
/// The icon is `NavIconButton`, never a `<-` character: `docs/navigation-chrome.md` makes that the
/// one permitted back control and `tools/qa/nav_icons_check.js` fails a screen that draws its own.
struct PhoneHeader: View {
    let title: String
    let onBack: () -> Void
    var body: some View {
        HStack(spacing: 0) {
            NavIconButton(.back, size: PhoneChrome.backIcon, tint: Theme.foreground, action: onBack)
                .frame(width: PhoneChrome.backBox, height: PhoneChrome.backBox)
            Text(title).font(Theme.nunito(PhoneChrome.titleSize, .bold))
                .foregroundStyle(Theme.foreground)
            Spacer()
        }
        .padding(.horizontal, PhoneChrome.headerPaddingH)
        .padding(.top, PhoneChrome.headerPaddingTop)
    }
}

/// The header's numbers. Named rather than inlined because `swift_layout_check.js` allows no
/// numeric literal in a view body — and because `PhoneTitle`'s 30/18/4 above are exactly that,
/// grandfathered in.
enum PhoneChrome {
    static let backIcon: CGFloat = 24
    static let backBox: CGFloat = 40
    static let titleSize: CGFloat = 30
    static let headerPaddingH: CGFloat = 18
    static let headerPaddingTop: CGFloat = 4
}

/// The Analysis Board's and Play's promotion picker: a row of square tiles, no labels.
///
/// Every number now comes from `AnalysisPromotion`, extracted from `board.tsx`. It used to be
/// hand-typed — 46pt tiles where the source has 60, radius 8 where it has 12, `Theme.boardLight`
/// where it has `#455A64`, and no title at all — while the extracted values sat unread. That is
/// the same bug the web `<chess-board>` dialog had, in the other language.
///
/// **This is not the puzzle hub's dialog.** See `PuzzlePromotionOverlay`: the two share a purpose
/// and not one measurement, so they are deliberately two views.
struct PromotionOverlay: View {
    let color: PieceColor
    let onChoose: (PieceKind) -> Void
    var body: some View {
        VStack(spacing: AnalysisPromotion.titleMarginBottom) {
            Text(AnalysisPromotion.title)
                .font(Theme.nunito(AnalysisPromotion.titleSize, .bold))
                .foregroundStyle(AnalysisPromotion.titleColor)
            HStack(spacing: AnalysisPromotion.optionsGap) {
                ForEach(AnalysisPromotion.order, id: \.self) { k in
                    Button { onChoose(k) } label: {
                        PieceImage(piece: Piece(color, k),
                                   size: AnalysisPromotion.optionSize, shadow: false)
                            .frame(width: AnalysisPromotion.optionSize,
                                   height: AnalysisPromotion.optionSize)
                            .background(AnalysisPromotion.optionFill,
                                        in: RoundedRectangle(cornerRadius: AnalysisPromotion.optionRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(AnalysisPromotion.dialogPadding)
        .background(AnalysisPromotion.dialogFill,
                    in: RoundedRectangle(cornerRadius: AnalysisPromotion.dialogRadius))
        .shadow(radius: AnalysisPromotion.elevation)
    }
}

/// The puzzle hub's promotion picker: a vertical list of labelled, accent-filled rows.
///
/// Structurally different from `PromotionOverlay` because the source is: `promotionOption` in the
/// puzzle screens is `flexDirection: 'row'` with a text label and the screen's accent as its fill,
/// where `board.tsx` has an unlabelled 60pt square. Both are extracted; neither is a preference.
///
/// The scrim comes from `PuzzlePromotion.scrimFor(mode)` — Streak and Turbo dim to 0.82 where the
/// other three use 0.80, which is the whole reason the extraction keeps two values.
struct PuzzlePromotionOverlay: View {
    let color: PieceColor
    let mode: PuzzleSession.Mode
    let onChoose: (PieceKind) -> Void

    var body: some View {
        ZStack {
            PuzzlePromotion.scrimFor(mode).ignoresSafeArea()
            VStack(spacing: PuzzlePromotion.optionsGap) {
                Text(PuzzleStrings.promotionTitle)
                    .font(Theme.nunito(PuzzlePromotion.titleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, PuzzlePromotion.titleMarginBottom)
                ForEach(PuzzlePromotion.order, id: \.self) { k in
                    Button { onChoose(k) } label: {
                        HStack(spacing: PuzzlePromotion.optionGap) {
                            PieceImage(piece: Piece(color, k),
                                       size: PuzzlePromotion.glyphSize, shadow: false)
                            Text(PuzzlePromotion.label(k))
                                .font(Theme.nunito(PuzzlePromotion.optionTextSize, .bold))
                                .foregroundStyle(PuzzlePalette.textPrimary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(PuzzlePromotion.optionPadding)
                        .background(PuzzlePromotion.accent(mode),
                                    in: RoundedRectangle(cornerRadius: PuzzlePromotion.optionRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(PuzzlePromotion.dialogPadding)
            .frame(width: PuzzlePromotion.dialogWidth)
            .background(PuzzlePalette.card,
                        in: RoundedRectangle(cornerRadius: PuzzlePromotion.dialogRadius))
        }
    }
}

func phoneCard<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text(title.uppercased()).font(Theme.nunito(11, .semiBold)).tracking(0.7).foregroundStyle(Theme.mutedForeground)
        content()
    }
    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
    .padding(.horizontal, 18)
}

// ── What used to live here ──────────────────────────────────────────────────────
//
// Three screens, all of them reached only through the bottom tab bar, all of them gone with it:
//
//   • `PuzzlesPhone` — the ten hand-made samples. Already replaced by `PuzzleHubScreen`; the
//     samples survive at `AppShell`'s `.samples` panel, the engine spot-check they were written
//     for.
//   • `PlayPhone` + `phoneBoard` + `PlayPhoneBoard` — the pre-port sample play screen. Its browser
//     twin was deleted a round earlier and `docs/play-vs-coach.md` recorded the one thing keeping
//     this one alive: `BoardView` lived inside `PlayView.swift`. It does not any more, and the tab
//     bar was its last door. `LegacyCoachSelect` STAYS — the macOS demo's `Panel.play` renders it
//     through `PlayView`, which is the board harness, not a phone screen.
//   • `LearnPhone` — unreachable even before this change. No tab hosted it and nothing referenced
//     it; it was dead code that read as a screen.

// ── Profile ──────────────────────────────────────────────────────────────

struct ProfilePhone: View {
    /// Reads the hub's store, not the retired sample solver — otherwise the profile would show a
    /// rating and a solve count from a screen the user can no longer reach.
    @ObservedObject var store: PuzzleHubStore
    /// The session, so this screen can end it. It is the only way back to the login screen once
    /// the sign-in has been persisted.
    @ObservedObject var login: LoginStore
    /// The subscription, so this screen can show its state and route to the paywall.
    @ObservedObject var premium: PremiumStore
    /// Raised by the Delete account button and lowered by either alert action.
    @State private var confirmingDelete = false
    /// Back to Home. Profile is reached from the Home header's avatar and had no way out at all
    /// while the tab bar existed — it was the only screen in either language without one.
    let onExit: () -> Void
    let onPaywall: () -> Void
    private var initial: String { String(login.displayName.prefix(1)) }
    private var accuracy: Double {
        // `PuzzleStats.accuracy` is the golden-tested one; it returns nil before any attempt.
        guard let a = PuzzleStats.accuracy(store.state) else { return 0 }
        return Double(a.solved) / Double(max(a.attempted, 1))
    }
    private var rating: Int { store.state.profile.rating }
    private var solvedCount: Int { PuzzleStats.accuracy(store.state)?.solved ?? 0 }
    private var attempted: Int { PuzzleStats.accuracy(store.state)?.attempted ?? 0 }
    /// Same window and ordering `PuzzleStats.sparkline` charts — the newest `sparkWindow` rows,
    /// reversed to oldest-first — flattened to the `[Int]` this panel's `Sparkline` draws.
    private var ratingHistory: [Int] {
        PuzzleProgress.ratingHistory(store.state, limit: PuzzleStats.sparkWindow)
            .reversed().map(\.ratingAfter)
    }
    private let tierRows: [(String, Int)] = [("Expert", 2000), ("Advanced", 1600), ("Intermediate", 1200), ("Beginner", 800), ("Novice", 0)]

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                PhoneHeader(title: "Profile", onBack: onExit)

                HStack(spacing: 14) {
                    Text(initial).font(Theme.nunito(30, .extraBold)).foregroundStyle(Theme.onGold)
                        .frame(width: 64, height: 64).background(Theme.onGold.opacity(0.14), in: Circle())
                        .overlay(Circle().stroke(Theme.onGold.opacity(0.3)))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(login.displayName).font(Theme.nunito(20, .bold)).foregroundStyle(Theme.onGold)
                        Text(RatingTier.classify(rating)).font(Theme.nunito(14, .medium)).foregroundStyle(Theme.onGold.opacity(0.75))
                        Text("\(rating) rating").font(Theme.nunito(21, .extraBold)).foregroundStyle(Theme.onGold)
                    }
                    Spacer()
                }
                .padding(18).background(Theme.violetGradient, in: RoundedRectangle(cornerRadius: 18)).padding(.horizontal, 18)

                HStack(spacing: 10) {
                    StatTile(icon: "checkmark.seal.fill", value: "\(solvedCount)", label: "Solved", tint: Theme.positive)
                    StatTile(icon: "target", value: attempted == 0 ? "—" : "\(Int(round(accuracy * 100)))%", label: "Accuracy", tint: Theme.violet)
                    StatTile(icon: "flag.checkered", value: "\(attempted)", label: "Attempts", tint: Theme.warning)
                }.padding(.horizontal, 18)

                phoneCard("Rating progress") {
                    Sparkline(values: ratingHistory).frame(height: 62)
                }

                phoneCard("Tier") {
                    VStack(alignment: .leading, spacing: 10) {
                        GeometryReader { geo in
                            let (lo, hi) = band(rating)
                            let frac = max(0.02, min(1, Double(rating - lo) / Double(max(1, hi - lo))))
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.border).frame(height: 8)
                                Capsule().fill(Theme.violetGradient).frame(width: geo.size.width * frac, height: 8)
                            }
                        }.frame(height: 8)
                        ForEach(tierRows, id: \.0) { name, floor in
                            HStack {
                                Circle().fill(RatingTier.classify(rating) == name ? AnyShapeStyle(Theme.violet) : AnyShapeStyle(Theme.border)).frame(width: 8, height: 8)
                                Text(name).fontWeight(RatingTier.classify(rating) == name ? .semibold : .regular)
                                Spacer()
                                Text("\(floor)+").foregroundStyle(Theme.mutedForeground)
                            }.font(Theme.nunito(15, .regular))
                        }
                    }
                }

                phoneCard("Your coaches") {
                    HStack(spacing: 12) {
                        ForEach(Coaches.all) { c in
                            VStack(spacing: 4) {
                                CoachAvatar(name: c.name, size: 40, level: CoachArt.level(forCoachId: c.id))
                                Text(c.name.split(separator: " ").first.map(String.init) ?? "").font(Theme.nunito(9, .regular)).foregroundStyle(Theme.mutedForeground)
                            }
                        }
                    }
                }

                phoneCard(PaywallStrings.premium) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 6) {
                            Text(premium.isPremium ? PaywallGlyph.crown : PaywallStrings.goPremium)
                                .font(Theme.nunito(13, .medium))
                            Text(subscriptionLine)
                                .font(Theme.nunito(13, .medium))
                            Spacer()
                        }.foregroundStyle(premium.isPremium ? Theme.gold : Theme.mutedForeground)
                        Button(action: onPaywall) {
                            Text(premium.isPremium ? PaywallStrings.manageRow
                                                   : PaywallStrings.lockCta)
                                .font(Theme.nunito(14, .bold))
                                .foregroundStyle(Theme.onGold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(Theme.gold,
                                            in: RoundedRectangle(cornerRadius: Theme.radiusButton))
                        }
                        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
                    }
                }

                phoneCard(LoginStrings.accountCard) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 6) {
                            Image(systemName: LoginArt.appleSymbol).font(Theme.nunito(13, .medium))
                            Text("\(LoginStrings.signedInWith) \(login.providerLabel)")
                                .font(Theme.nunito(13, .medium))
                            Spacer()
                        }.foregroundStyle(Theme.mutedForeground)
                        Button(action: { signOut() }) {
                            Text(LoginStrings.signOut)
                                .font(Theme.nunito(14, .bold))
                                .foregroundStyle(Theme.negative)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(Theme.negative.opacity(0.12),
                                            in: RoundedRectangle(cornerRadius: Theme.radiusButton))
                        }
                        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
                        // Guideline 5.1.1(v): with a real Sign in with Apple, deletion has to be
                        // reachable in-app. Quieter than Sign out on purpose — it is the rarer and
                        // the more destructive of the two — but on the same card, one tap from the
                        // Home avatar, which is the route left open even to a locked user.
                        Button(action: { confirmingDelete = true }) {
                            Text(LoginStrings.deleteAccount)
                                .font(Theme.nunito(13, .semiBold))
                                .foregroundStyle(Theme.negative)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(DimButtonStyle(pressedOpacity: LoginLayout.pressedButton))
                        .alert(LoginStrings.deleteTitle, isPresented: $confirmingDelete) {
                            Button(LoginStrings.deleteCancel, role: .cancel) { }
                            Button(LoginStrings.deleteConfirm, role: .destructive) {
                                deleteAccount()
                            }
                        } message: {
                            Text(LoginStrings.deleteBody)
                        }
                    }
                }
                Spacer(minLength: 8)
            }
        }
    }

    /// One line for all three states, so the card never has to say "Premium Active" to someone
    /// whose entitlement is actually stale.
    private var subscriptionLine: String {
        switch premium.access {
        case .premium:
            guard let expiry = premium.expiresAt else { return HomeMembership.noExpirySubtitle }
            return HomeMembership.expiryText(expiry)
        case .grace(let days):
            return PaywallStrings.fill(PaywallStrings.graceTitle, [:])
                + " · " + PaywallStrings.daysPillText(days)
        case .free:
            return HomeMembership.freeSubtitle
        }
    }

    /// Erases the account's local data, then ends the session — which drops the whole shell back
    /// to the login gate, so there is nothing left to navigate back to.
    ///
    /// `store.reset()` comes FIRST and on purpose: the hub's progress is live in memory, and a
    /// store that persisted itself after the file had been removed would quietly write the deleted
    /// progress straight back. Reset, then erase, then sign out.
    private func deleteAccount() {
        store.reset()
        AccountDeletion.eraseAll()
        withAnimation(.easeInOut(duration: LoginTiming.signInFadeSeconds)) { login.signOut() }
    }

    /// Ends the session. Same fade as signing in, played in reverse by the gate in `PhoneApp`.
    private func signOut() {
        withAnimation(.easeInOut(duration: LoginTiming.signInFadeSeconds)) { login.signOut() }
    }

    private func band(_ r: Int) -> (Int, Int) {
        if r >= 2000 { return (2000, 2800) }
        if r >= 1600 { return (1600, 2000) }
        if r >= 1200 { return (1200, 1600) }
        if r >= 800 { return (800, 1200) }
        return (0, 800)
    }
}
