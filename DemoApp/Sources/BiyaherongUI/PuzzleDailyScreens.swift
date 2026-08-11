import SwiftUI
import BiyaherongCoachCore

// Daily Puzzle (Part 11). The same puzzle for every device on a given date, chosen from the
// bundled corpus by date — no network, which is why the source's "powered by Chess.com" hero
// subtitle and its credit link are both gone (Part 22.2).

/// Part 11.2 — the hero, the streak and total cards, and how-it-works.
struct PuzzleDailyHomeScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onSolve: () -> Void
    let onExit: () -> Void

    private var daily: DailyPuzzleState { store.state.daily }
    private var solvedToday: Bool {
        daily.lastSolvedDay == PuzzleProgress.dayKey(PuzzleHubStore.nowMs())
    }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.dailyTitle,
                               titleSize: PuzzleType.dailyTitle, onBack: onExit)
            ScrollView {
                VStack(spacing: 0) {
                    hero
                    stats
                    howItWorks
                    if solvedToday { solvedCard }
                }
                .padding(.horizontal, PuzzleDailyHome.contentPaddingH)
                .padding(.bottom, PuzzleDailyHome.contentPaddingBottom)
            }
            startButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
    }

    private var hero: some View {
        VStack(spacing: 0) {
            Text(PuzzleStrings.dailyHeroTitle)
                .font(Theme.nunito(PuzzleType.dailyHeroTitle, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .padding(.bottom, PuzzleDailyHome.heroTitleMarginBottom)
            // "always offline", not the source's "powered by Chess.com" — the hostname is deleted
            // and Part 22.2 asserts it stays deleted.
            Text(PuzzleStrings.dailyHeroSub)
                .font(Theme.nunito(PuzzleType.dailyHeroSub, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(PuzzleDailyHome.heroPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleDailyHome.heroRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleDailyHome.heroRadius)
            .stroke(PuzzleDailyHome.heroBorderColor, lineWidth: PuzzleDailyHome.heroBorder))
        .padding(.bottom, PuzzleDailyHome.heroMarginBottom)
    }

    private var stats: some View {
        HStack(spacing: PuzzleDailyHome.statsGap) {
            statCard(PuzzleStrings.dailyStreakLabel, "\(daily.streak)")
            statCard(PuzzleStrings.dailyTotalLabel, "\(daily.totalSolved)")
        }
        .padding(.bottom, PuzzleDailyHome.statsMarginBottom)
    }

    private func statCard(_ label: String, _ value: String) -> some View {
        VStack(spacing: PuzzleDailyHome.statCardGap) {
            Text(value)
                .font(Theme.nunito(PuzzleDailyHome.statValueSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
            Text(label)
                .font(Theme.nunito(PuzzleDailyHome.statLabelSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(PuzzleDailyHome.statCardPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleDailyHome.statCardRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleDailyHome.statCardRadius)
            .stroke(PuzzleDailyHome.statCardBorderColor,
                    lineWidth: PuzzleDailyHome.statCardBorder))
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(PuzzleStrings.dailyHowTitle)
                .font(Theme.nunito(PuzzleDailyHome.infoTitleSize, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .padding(.bottom, PuzzleDailyHome.infoTitleMarginBottom)
            Text(PuzzleStrings.dailyHowBody)
                .font(Theme.nunito(PuzzleDailyHome.infoTextSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .lineSpacing(PuzzleDailyHome.infoLineHeight)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PuzzleDailyHome.infoPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleDailyHome.infoRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleDailyHome.infoRadius)
            .stroke(PuzzleDailyHome.infoBorderColor, lineWidth: PuzzleDailyHome.infoBorder))
        .padding(.bottom, PuzzleDailyHome.infoMarginBottom)
    }

    private var solvedCard: some View {
        VStack(spacing: PuzzleDailyHome.solvedGap) {
            Text(PuzzleStrings.dailySolvedTitle)
                .font(Theme.nunito(PuzzleType.dailySolvedTitle, .bold))
                .foregroundStyle(PuzzlePalette.correct)
            Text(PuzzleStrings.dailySolvedSub)
                .font(Theme.nunito(PuzzleDailyHome.infoTextSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(PuzzleDailyHome.solvedSubLineHeight)
        }
        .frame(maxWidth: .infinity)
        .padding(PuzzleDailyHome.solvedPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleDailyHome.solvedRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleDailyHome.solvedRadius)
            .stroke(PuzzleDailyHome.solvedBorderColor, lineWidth: PuzzleDailyHome.solvedBorder))
    }

    /// Always enabled: re-solving is allowed, it just does not count twice —
    /// `recordDailyPuzzleSolve` enforces one per calendar day itself.
    private var startButton: some View {
        Button(action: onSolve) {
            Text(PuzzleStrings.dailyStart)
                .font(Theme.nunito(PuzzleType.dailyStart, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PuzzleDailyHome.startPaddingV)
                .background(PuzzlePalette.gold,
                            in: RoundedRectangle(cornerRadius: PuzzleDailyHome.startRadius))
                .shadow(color: .black.opacity(PuzzleDailyHome.startShadowOpacity),
                        radius: PuzzleDailyHome.startShadowRadius,
                        y: PuzzleDailyHome.startShadowY)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, PuzzleDailyHome.contentPaddingH)
        .padding(.bottom, PuzzleDailyHome.contentPaddingBottom)
    }
}

/// Part 11.3 — the daily solver. A feedback banner instead of a Retry row, and a Done button.
///
/// Daily is the only mode whose wrong-move banner expires by itself and returns to `playing`;
/// every other mode needs an explicit Retry, a new puzzle, or has ended. That rule lives in
/// `WRONG_POLICY`, and the banner's lifetime comes from the extraction.
struct PuzzleDailySolverScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onExit: () -> Void

    @StateObject private var engine = PuzzleSolverEngine(mode: .daily)
    @State private var banner: Banner?

    enum Banner: Equatable { case solved, wrong }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.dailyTitle,
                               subtitle: themeSummary,
                               titleSize: PuzzleType.dailySolverTitle,
                               onBack: { engine.leave(); onExit() })
            instruction
            PuzzleBoardBand(engine: engine)
            bannerView
            doneButton
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
        .overlay { promotion }
        .onAppear(perform: start)
        .onDisappear { engine.leave() }
    }

    /// The source shows the puzzle's title from the API; offline there is none, so the themes
    /// stand in for it.
    private var themeSummary: String? {
        engine.puzzle.map { $0.themes.joined(separator: " ") }
    }

    @ViewBuilder
    private var promotion: some View {
        if engine.pendingPromotion != nil, let s = engine.session {
            PuzzlePromotionOverlay(color: s.userColor, mode: engine.mode) {
                engine.choosePromotion($0)
            }
        }
    }

    private var instruction: some View {
        Text(engine.userIsWhite ? PuzzleStrings.dailyWhite : PuzzleStrings.dailyBlack)
            .font(Theme.nunito(PuzzleType.solverInfoStrip, .semiBold))
            .foregroundStyle(PuzzlePalette.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, PuzzleDailySolver.instructionPaddingV)
    }

    @ViewBuilder
    private var bannerView: some View {
        if let banner {
            HStack(spacing: PuzzleDailySolver.feedbackGap) {
                Text(banner == .solved ? PuzzleStrings.dailyWin : PuzzleStrings.dailyMiss)
                    .font(Theme.nunito(PuzzleDailySolver.feedbackIconSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(PuzzleDailySolver.feedbackPadding)
            .background(banner == .solved ? PuzzleDailySolver.feedbackSolvedFill
                                          : PuzzleDailySolver.feedbackWrongFill,
                        in: RoundedRectangle(cornerRadius: PuzzleDailySolver.feedbackRadius))
            .overlay(RoundedRectangle(cornerRadius: PuzzleDailySolver.feedbackRadius)
                .stroke(banner == .solved ? PuzzleDailySolver.feedbackSolvedBorder
                                          : PuzzleDailySolver.feedbackWrongBorder,
                        lineWidth: PuzzleDailyHome.heroBorder))
            .padding(.horizontal, PuzzleDailySolver.feedbackMarginH)
            .padding(.top, PuzzleDailySolver.feedbackMarginTop)
        }
    }

    @ViewBuilder
    private var doneButton: some View {
        if banner == .solved {
            Button { engine.leave(); onExit() } label: {
                Text(PuzzleStrings.dailyDone)
                    .font(Theme.nunito(PuzzleType.solverButton, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PuzzleDailySolver.donePaddingV)
                    .background(PuzzlePalette.correct,
                                in: RoundedRectangle(cornerRadius: PuzzleDailySolver.doneRadius))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, PuzzleDailySolver.doneMarginH)
            .padding(.top, PuzzleDailySolver.doneMarginTop)
        }
    }

    private func start() {
        guard engine.session == nil else { return }
        engine.onSolved = { _ in finish() }
        engine.onWrong = { _ in showWrongBanner() }
        guard let p = store.dailyPuzzle() else { return }
        engine.mount(p)
    }

    /// One solve per calendar day counts; `recordDailyPuzzleSolve` enforces that itself, so
    /// re-entering and re-solving cannot double the streak.
    private func finish() {
        banner = .solved
        store.mutate { s in
            PuzzleProgress.recordDailyPuzzleSolve(&s, now: PuzzleHubStore.nowMs())
        }
    }

    /// The only self-expiring banner in the hub. Scheduled on the solver's own timer list so
    /// leaving cancels it — otherwise it would clear a banner on whatever screen came next.
    private func showWrongBanner() {
        banner = .wrong
        engine.schedule(PuzzleDailySolver.wrongBannerMs) { banner = nil }
    }
}
