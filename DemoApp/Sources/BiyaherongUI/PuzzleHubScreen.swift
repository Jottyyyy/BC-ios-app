import SwiftUI
import BiyaherongCoachCore

/// Where the ten puzzle routes live, so the hub and every screen agree on one spelling.
enum PuzzleRoute: Hashable {
    case playHome, playSolver
    case dailyHome, dailySolver
    case thematicGrid, thematicSolver(String)
    case streakHome, streakSolver
    case turboHome, turboRun(mode: Int, resumeDraft: Bool)
}

/// The Puzzle Hub (Part 9) — five mode cards over the daily-goal strip.
///
/// The entry point for everything built since Phase A. Until now the app's Puzzles tab showed ten
/// hand-made sample positions and none of the Core reached a screen.
struct PuzzleHubScreen: View {
    @ObservedObject var store: PuzzleHubStore
    /// The subscription. Every free-tier cap in the hub is read live from here, never from a
    /// cached flag — the exact drift the RN app had between `@is_premium` and the server.
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void
    /// Called with `true` while any route is pushed on top of the hub, so the host can hide the
    /// app's tab bar. The browser does exactly this — every pushed puzzle route calls
    /// `appCard().classList.add('an-mode')`, whose only job is `.tabbar { display: none }`
    /// (web-demo/js/app.js). Without it the solver screens draw a tab bar the web twin does not
    /// have, and lose ~90pt of the height the board wants.
    ///
    /// Defaulted, so the macOS demo's `AppShell` call site is unaffected.
    var onPushedChange: (Bool) -> Void = { _ in }
    var onPaywall: () -> Void = {}
    @State private var path: [PuzzleRoute] = []
    /// The cap the user just hit, held as its message so the overlay is one branch and not five.
    @State private var capMessage: String?
    /// Daily allowances reset at midnight and say so; a hard feature gate does not.
    @State private var capResets = true

    var body: some View {
        NavigationStack(path: $path) {
            hub
                .navigationDestination(for: PuzzleRoute.self) { route in
                    destination(route)
                        .navigationBarBackTapHidden()
                }
        }
        .tint(PuzzlePalette.gold)
        // `path.count` rather than `path.isEmpty`: pushing solver-on-top-of-home keeps the flag
        // true, and `onChange` on a Bool that never changes value would not fire on the way in.
        .onChange(of: path.count) { _, count in onPushedChange(count > 0) }
        .onDisappear { onPushedChange(false) }
        // Above the NavigationStack, because a cap can be hit from a pushed route (Play home on
        // the way into the solver) and the lock card has to cover that too.
        .overlay(alignment: .center) { capOverlay }
    }

    // MARK: - The hub itself

    private var hub: some View {
        VStack(spacing: 0) {
            header
            hero
            PuzzleGoalStripView(store: store)
            cards
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PuzzlePalette.screenBg)
    }

    private var header: some View {
        HStack(spacing: 0) {
            Button(action: onExit) {
                Image(systemName: "chevron.left")
                    .font(.system(size: PuzzleHub.chevronLineHeight, weight: .semibold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .frame(width: PuzzleHub.backBtnW, height: PuzzleHub.backBtnH)
            }
            .buttonStyle(PuzzlePressStyle())
            Text(PuzzleStrings.hubTitle)
                .font(Theme.nunito(PuzzleType.hubTitle, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
            Spacer()
        }
        .padding(.horizontal, PuzzleHub.headerPaddingH)
        .padding(.vertical, PuzzleHub.headerPaddingV)
    }

    private var hero: some View {
        VStack(spacing: PuzzleHub.heroGap) {
            Text(PuzzleStrings.hubHeroGlyph)
                .font(.system(size: PuzzleType.hubEmoji))
                .frame(width: PuzzleHub.heroGlowSize, height: PuzzleHub.heroGlowSize)
                .background(PuzzleHub.heroGlowFill,
                            in: RoundedRectangle(cornerRadius: PuzzleHub.heroGlowRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: PuzzleHub.heroGlowRadius)
                        .stroke(PuzzleHub.heroGlowBorderColor, lineWidth: PuzzleHub.heroGlowBorder))
                .padding(.bottom, PuzzleHub.heroGlowMarginBottom)
            Text(PuzzleStrings.hubHeroTitle)
                .font(Theme.nunito(PuzzleType.hubHeroTitle, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
            Text(PuzzleStrings.hubHeroSub)
                .font(Theme.nunito(PuzzleType.hubHeroSub, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
        }
        .padding(.top, PuzzleHub.heroPaddingTop)
        .padding(.bottom, PuzzleHub.heroPaddingBottom)
    }

    private var cards: some View {
        VStack(spacing: PuzzleHub.cardGap) {
            ForEach(PuzzleHub.modes) { mode in
                Button { open(mode.id) } label: { PuzzleModeCard(mode: mode) }
                    .buttonStyle(PuzzlePressStyle(scale: PuzzlePress.cardScale))
            }
        }
        .padding(.horizontal, PuzzleHub.cardsPaddingH)
        .padding(.bottom, PuzzleHub.cardsPaddingBottom)
    }

    /// Card → route. All five are live; there is no "coming soon" branch left.
    ///
    /// Only **Thematic** is gated here, because it is the one hard premium gate — the others are
    /// daily allowances, and those are spent when a run actually starts, not when its home screen
    /// is opened. Browsing the Streak screen and backing out must not cost the user their run.
    private func open(_ id: String) {
        switch id {
        case "play": path.append(.playHome)
        case "daily": path.append(.dailyHome)
        case "thematic":
            if premium.isThematicLocked {
                raise(PaywallStrings.thematicLock, resets: false)
            } else {
                path.append(.thematicGrid)
            }
        case "streak": path.append(.streakHome)
        case "turbo": path.append(.turboHome)
        default: break
        }
    }

    // MARK: - The free tier's allowances

    /// Spends one use of `mode` and runs `go`, or raises the cap message and does nothing.
    private func gate(_ mode: String, _ message: String, _ go: () -> Void) {
        guard premium.canUse(mode) else {
            raise(message, resets: true)
            return
        }
        premium.recordUse(mode)
        go()
    }

    private func raise(_ message: String, resets: Bool) {
        capResets = resets
        capMessage = message
    }

    /// `You've solved 5/5 free puzzles today…` — the count substituted, never re-typed.
    private var ratedCapMessage: String {
        PaywallStrings.fill(PaywallStrings.puzzleCap,
                            ["used": String(premium.used(Entitlement.Mode.regular)),
                             "limit": String(Entitlement.maxUses(for: Entitlement.Mode.regular))])
    }

    @ViewBuilder
    private var capOverlay: some View {
        if let capMessage {
            ZStack {
                PaywallPalette.scrim
                    .ignoresSafeArea()
                    .onTapGesture { self.capMessage = nil }
                PremiumLockCard(body_: capMessage,
                                onSeePlans: {
                                    self.capMessage = nil
                                    onPaywall()
                                },
                                showsResetNote: capResets)
            }
        }
    }

    @ViewBuilder
    private func destination(_ route: PuzzleRoute) -> some View {
        switch route {
        case .playHome:
            // The allowance is spent HERE, on the way into the solver — a failed attempt still
            // costs a use, exactly as the original counted them.
            PuzzlePlayHomeScreen(store: store,
                                 onPlay: {
                                     gate(Entitlement.Mode.regular, ratedCapMessage) {
                                         path.append(.playSolver)
                                     }
                                 },
                                 onExit: { path.removeLast() })
        case .playSolver:
            PuzzlePlaySolverScreen(store: store, onExit: { path.removeLast() })
        case .dailyHome:
            PuzzleDailyHomeScreen(store: store, onSolve: { path.append(.dailySolver) },
                                  onExit: { path.removeLast() })
        case .dailySolver:
            PuzzleDailySolverScreen(store: store, onExit: { path.removeLast() })
        case .thematicGrid:
            PuzzleThematicGridScreen(store: store,
                                     onStart: { path.append(.thematicSolver($0)) },
                                     onExit: { path.removeLast() })
        case .thematicSolver(let theme):
            PuzzleThematicSolverScreen(store: store, theme: theme,
                                       onExit: { path.removeLast() })
        case .streakHome:
            PuzzleStreakHomeScreen(store: store,
                                   onStart: {
                                       gate(Entitlement.Mode.streak, PaywallStrings.streakCap) {
                                           path.append(.streakSolver)
                                       }
                                   },
                                   onExit: { path.removeLast() })
        case .streakSolver:
            PuzzleStreakSolverScreen(store: store, onExit: { path.removeLast() })
        case .turboHome:
            // PER MODE. `rush_0`, `rush_3` and `rush_5` carry their own allowance — one shared
            // counter would be the easy, wrong reading of the original.
            PuzzleTurboHomeScreen(store: store,
                                  onStart: { mode, resume in
                                      // Resuming a draft is the SAME run continued — it already
                                      // cost its allowance when it started.
                                      guard !resume else {
                                          path.append(.turboRun(mode: mode, resumeDraft: true))
                                          return
                                      }
                                      gate(Entitlement.Mode.rush(mode), PaywallStrings.rushCap) {
                                          path.append(.turboRun(mode: mode, resumeDraft: false))
                                      }
                                  },
                                  onExit: { path.removeLast() })
        case .turboRun(let mode, let resume):
            PuzzleTurboRunScreen(store: store, mode: mode, resumeDraft: resume,
                                 onExit: { path.removeLast() })
        }
    }
}

/// One mode card: a coloured tile, the copy, a badge and a chevron, over a left accent border.
struct PuzzleModeCard: View {
    let mode: PuzzleHub.Mode

    var body: some View {
        HStack(spacing: PuzzleHub.cardPaddingH) {
            Text(mode.emoji)
                .font(.system(size: PuzzleType.hubEmoji))
                .frame(width: PuzzleHub.tileSize, height: PuzzleHub.tileSize)
                .background(PuzzleHub.tint(mode.hex, PuzzleHub.tintFillByte),
                            in: RoundedRectangle(cornerRadius: PuzzleHub.tileRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleHub.tileRadius)
                    .stroke(PuzzleHub.tint(mode.hex, PuzzleHub.tintBorderByte),
                            lineWidth: PuzzleHub.tileBorder))
            VStack(alignment: .leading, spacing: PuzzleHub.titleMarginBottom) {
                Text(mode.title)
                    .font(Theme.nunito(PuzzleType.hubCardTitle, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                Text(mode.subtitle)
                    .font(Theme.nunito(PuzzleType.hubCardSub, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)

            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: PuzzleHub.titleMarginBottom) {
                Text(mode.badge)
                    .font(Theme.nunito(PuzzleType.hubBadge, .bold))
                    .tracking(PuzzleHub.badgeLetterSpacing)
                    .foregroundStyle(mode.color)
                    .padding(.horizontal, PuzzleHub.badgePaddingH)
                    .padding(.vertical, PuzzleHub.badgePaddingV)
                    .background(PuzzleHub.tint(mode.hex, PuzzleHub.tintFillByte),
                                in: RoundedRectangle(cornerRadius: PuzzleHub.badgeRadius))
                Image(systemName: "chevron.right")
                    .font(.system(size: PuzzleType.hubChevron))
                    .foregroundStyle(PuzzlePalette.textSecondary)
            }
        }
        .padding(.horizontal, PuzzleHub.cardPaddingH)
        .padding(.vertical, PuzzleHub.cardPaddingV)
        .background(PuzzlePalette.card, in: RoundedRectangle(cornerRadius: PuzzleHub.cardRadius))
        // The left accent border, as an overlay rather than a border so only one edge is painted.
        .overlay(alignment: .leading) {
            mode.color.frame(width: PuzzleHub.cardBorderLeft)
        }
        .clipShape(RoundedRectangle(cornerRadius: PuzzleHub.cardRadius))
        .shadow(color: .black.opacity(PuzzleHub.cardShadowOpacity),
                radius: PuzzleHub.cardShadowRadius, y: PuzzleHub.cardShadowY)
    }
}

/// The daily-goal strip (Part 15.2): a progress ring, the copy, and the streak pill.
///
/// INVENTED — the server had a `/api/daily-goal` endpoint the mobile app never called, so there is
/// no StyleSheet behind these numbers and `PuzzleMetricsCheck` cannot assert them against the
/// extraction the way it does every other screen. Recorded in PORTING_NOTES.
struct PuzzleGoalStripView: View {
    @ObservedObject var store: PuzzleHubStore

    private var status: PuzzleProgress.GoalStatus {
        PuzzleProgress.dailyGoalStatus(store.state, now: PuzzleHubStore.nowMs())
    }

    var body: some View {
        let s = status
        HStack(spacing: PuzzleGoalStrip.rowGap) {
            PuzzleGoalRing(fraction: s.progress, label: "\(s.solvedToday)")
            VStack(alignment: .leading, spacing: PuzzleGoalStrip.textGap) {
                Text(PuzzleStrings.goalTitle)
                    .font(Theme.nunito(PuzzleGoalStrip.titleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                Text(s.complete ? PuzzleStrings.goalComplete
                                : PuzzleStrings.goalProgress(s.solvedToday))
                    .font(Theme.nunito(PuzzleGoalStrip.subSize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
            }
            Spacer(minLength: 0)
            Text(PuzzleStrings.goalStreak(s.goalStreak))
                .font(Theme.nunito(PuzzleGoalStrip.pillTextSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
                .padding(.horizontal, PuzzleGoalStrip.pillPaddingH)
                .padding(.vertical, PuzzleGoalStrip.pillPaddingV)
                .background(PuzzleGoalStrip.pillFill,
                            in: RoundedRectangle(cornerRadius: PuzzleGoalStrip.pillRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleGoalStrip.pillRadius)
                    .stroke(PuzzleGoalStrip.pillBorder, lineWidth: PuzzleGoalStrip.borderWidth))
        }
        .padding(.horizontal, PuzzleGoalStrip.paddingH)
        .padding(.vertical, PuzzleGoalStrip.paddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleGoalStrip.radius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleGoalStrip.radius)
            .stroke(PuzzleGoalStrip.borderColor, lineWidth: PuzzleGoalStrip.borderWidth))
        .padding(.horizontal, PuzzleGoalStrip.marginH)
        .padding(.bottom, PuzzleGoalStrip.marginBottom)
    }
}

/// The ring. A trimmed circle rather than an arc path — the sweep is one `trim` animation and
/// needs no repaint loop, which is the same reason the web version uses `stroke-dashoffset`.
struct PuzzleGoalRing: View {
    let fraction: Double
    let label: String

    var body: some View {
        ZStack {
            Circle()
                .stroke(PuzzleGoalStrip.ringTrack, lineWidth: PuzzleGoalStrip.ringStroke)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(PuzzlePalette.gold,
                        style: StrokeStyle(lineWidth: PuzzleGoalStrip.ringStroke, lineCap: .round))
                .rotationEffect(.degrees(PuzzleGoalStrip.ringStartDegrees))
                .animation(.easeOut(duration: PuzzleGoalStrip.animationSeconds), value: fraction)
            Text(label)
                .font(Theme.nunito(PuzzleGoalStrip.ringLabelSize, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
        }
        .frame(width: PuzzleGoalStrip.ringSize, height: PuzzleGoalStrip.ringSize)
    }
}

extension View {
    /// The pushed puzzle routes draw their own back control, matching the source. One modifier so
    /// eleven screens do not each repeat the two calls.
    func navigationBarBackTapHidden() -> some View {
        // `ToolbarPlacement.navigationBar` is iOS-only; the macOS demo hosts these routes inside
        // `PhoneView`'s frame, which has no navigation bar to hide, so the back button is enough.
        #if os(iOS)
        return self.navigationBarBackButtonHidden(true)
            .toolbar(.hidden, for: .navigationBar)
        #else
        return self.navigationBarBackButtonHidden(true)
        #endif
    }
}
