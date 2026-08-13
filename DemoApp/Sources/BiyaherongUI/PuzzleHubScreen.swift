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
    let onExit: () -> Void
    @State private var path: [PuzzleRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            hub
                .navigationDestination(for: PuzzleRoute.self) { route in
                    destination(route)
                        .navigationBarBackTapHidden()
                }
        }
        .tint(PuzzlePalette.gold)
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
    private func open(_ id: String) {
        switch id {
        case "play": path.append(.playHome)
        case "daily": path.append(.dailyHome)
        case "thematic": path.append(.thematicGrid)
        case "streak": path.append(.streakHome)
        case "turbo": path.append(.turboHome)
        default: break
        }
    }

    @ViewBuilder
    private func destination(_ route: PuzzleRoute) -> some View {
        switch route {
        case .playHome:
            PuzzlePlayHomeScreen(store: store, onPlay: { path.append(.playSolver) },
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
            PuzzleStreakHomeScreen(store: store, onStart: { path.append(.streakSolver) },
                                   onExit: { path.removeLast() })
        case .streakSolver:
            PuzzleStreakSolverScreen(store: store, onExit: { path.removeLast() })
        case .turboHome:
            PuzzleTurboHomeScreen(store: store,
                                  onStart: { path.append(.turboRun(mode: $0, resumeDraft: $1)) },
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
