import SwiftUI
import BiyaherongCoachCore

// Play Puzzles (Part 10) — the rated mode. Home is the stats screen; the solver is the only one
// with a clock, an Elo delta, an engine panel and a Save sheet.

/// Part 10.1 — rating, accuracy, sparkline, activity and theme performance.
struct PuzzlePlayHomeScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onPlay: () -> Void
    let onExit: () -> Void

    private var summary: PuzzleStats.Summary {
        PuzzleStats.summary(store.state, now: PuzzleHubStore.nowMs())
    }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.homeTitle,
                               titleSize: PuzzleType.homeTitle, onBack: onExit) {
                Text(PuzzleStrings.homeBadge)
                    .font(Theme.nunito(PuzzleType.homeBadge, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, PuzzlePlayHome.badgePaddingH)
                    .padding(.vertical, PuzzlePlayHome.badgePaddingV)
                    .background(PuzzlePalette.correct,
                                in: RoundedRectangle(cornerRadius: PuzzlePlayHome.badgeRadius))
            }
            ScrollView {
                VStack(spacing: PuzzlePlayHome.topGap) {
                    hero
                    if PuzzleStats.isEmpty(store.state) {
                        Text(PuzzleStrings.statsEmpty)
                            .font(Theme.nunito(PuzzleStatsStyle.emptySize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.vertical, PuzzlePlayHome.topGap)
                    } else {
                        PuzzleStatsCards(store: store)
                    }
                }
                .padding(.horizontal, PuzzlePlayHome.topPaddingH)
            }
            bottom
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PuzzlePalette.screenBg)
    }

    private var hero: some View {
        VStack(spacing: PuzzlePlayHome.heroGap) {
            Text(PuzzleStrings.homeHeroTitle)
                .font(Theme.nunito(PuzzleType.homeHeroTitle, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
            Text(PuzzleStrings.homeHeroSub)
                .font(Theme.nunito(PuzzleType.homeHeroSub, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .padding(.top, PuzzlePlayHome.heroSubMarginTop)
            HStack(spacing: 0) {
                statCell(PuzzleStrings.currentRating, "\(store.state.profile.rating)")
                divider
                statCell(PuzzleStrings.best, "\(store.state.profile.highestRating)")
            }
            .padding(.horizontal, PuzzlePlayHome.statRowPaddingH)
            .padding(.vertical, PuzzlePlayHome.statRowPaddingV)
            .background(PuzzlePlayHome.statRowFill,
                        in: RoundedRectangle(cornerRadius: PuzzlePlayHome.statRowRadius))
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, PuzzlePlayHome.heroPaddingH)
        .padding(.vertical, PuzzlePlayHome.heroPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzlePlayHome.heroRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzlePlayHome.heroRadius)
            .stroke(PuzzlePlayHome.heroBorderColor, lineWidth: PuzzlePlayHome.heroBorder))
    }

    private func statCell(_ label: String, _ value: String) -> some View {
        VStack(spacing: 0) {
            Text(value)
                .font(Theme.nunito(PuzzleStatsStyle.ratingSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
            Text(label)
                .font(Theme.nunito(PuzzleStatsStyle.ratingLabelSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .padding(.top, PuzzlePlayHome.statLabelMarginTop)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, PuzzlePlayHome.statPaddingH)
    }

    private var divider: some View {
        PuzzlePlayHome.dividerColor
            .frame(width: PuzzlePlayHome.dividerW, height: PuzzlePlayHome.dividerH)
    }

    private var bottom: some View {
        VStack(spacing: PuzzlePlayHome.bottomGap) {
            Text(PuzzleStrings.homeInfo)
                .font(Theme.nunito(PuzzleStatsStyle.emptySize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(PuzzlePlayHome.infoLineHeight)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, PuzzlePlayHome.infoPaddingH)
                .padding(.vertical, PuzzlePlayHome.infoPaddingV)
                .background(PuzzlePlayHome.infoFill,
                            in: RoundedRectangle(cornerRadius: PuzzlePlayHome.infoRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzlePlayHome.infoRadius)
                    .stroke(PuzzlePlayHome.infoBorderColor,
                            lineWidth: PuzzlePlayHome.infoBorder))
            Button(action: onPlay) {
                Text(PuzzleStrings.homePlay)
                    .font(Theme.nunito(PuzzleType.dailyStart, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PuzzlePlayHome.playPaddingV)
                    .background(PuzzlePalette.correct,
                                in: RoundedRectangle(cornerRadius: PuzzlePlayHome.playRadius))
                    .shadow(color: .black.opacity(PuzzlePlayHome.playShadowOpacity),
                            radius: PuzzlePlayHome.playShadowRadius,
                            y: PuzzlePlayHome.playShadowY)
            }
            .buttonStyle(PuzzlePressStyle())
        }
        .padding(.horizontal, PuzzlePlayHome.bottomPaddingH)
        .padding(.top, PuzzlePlayHome.bottomPaddingTop)
        .padding(.bottom, PuzzlePlayHome.bottomPaddingBottom)
    }
}

/// Accuracy, the rating sparkline, the activity bars and theme performance.
///
/// Every number comes from `PuzzleStats` in the Core, which is golden-tested — this draws the
/// result and computes nothing.
struct PuzzleStatsCards: View {
    @ObservedObject var store: PuzzleHubStore

    var body: some View {
        VStack(spacing: PuzzleStatsStyle.cardMarginBottom) {
            if let acc = PuzzleStats.accuracy(store.state) { accuracyCard(acc) }
            sparklineCard
            activityCard
            themeCard
        }
    }

    private func card<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: PuzzleStatsStyle.cardPadding) {
            Text(title)
                .font(Theme.nunito(PuzzleStatsStyle.sectionTitleSize, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PuzzleStatsStyle.cardPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleStatsStyle.cardRadius))
    }

    private func accuracyCard(_ acc: PuzzleStats.Accuracy) -> some View {
        card(PuzzleStrings.accuracy) {
            VStack(alignment: .leading, spacing: 0) {
                Text(PuzzleStrings.solvedOf(acc.solved, acc.attempted))
                    .font(Theme.nunito(PuzzleStatsStyle.accuracySubSize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                Text("\(acc.percent)")
                    .font(Theme.nunito(PuzzleStatsStyle.accuracySize, .bold))
                    .foregroundStyle(PuzzleStatsStyle.accuracyColor(acc.percent))
            }
        }
    }

    private var sparklineCard: some View {
        card(PuzzleStrings.yourRating) {
            PuzzleSparkline(state: store.state)
                .frame(height: PuzzleStatsStyle.sparkHeight)
        }
    }

    private var activityCard: some View {
        let bars = PuzzleStats.activity(store.state, now: PuzzleHubStore.nowMs())
        return card(PuzzleStrings.activity) {
            HStack(alignment: .bottom, spacing: PuzzleStatsStyle.barRowMarginTop) {
                ForEach(Array(bars.enumerated()), id: \.offset) { _, bar in
                    VStack(spacing: 0) {
                        Text("\(bar.count)")
                            .font(Theme.nunito(PuzzleStatsStyle.barCountSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                            .frame(height: PuzzleStatsStyle.barCountHeight)
                        RoundedRectangle(cornerRadius: PuzzleStatsStyle.barRadius)
                            .fill(PuzzlePalette.gold)
                            .frame(width: PuzzleStatsStyle.barWidth, height: barHeight(bar))
                        Text(bar.label)
                            .font(Theme.nunito(PuzzleStatsStyle.barDaySize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    /// The bar's own fraction, scaled between the extracted floor and ceiling. `PuzzleStats`
    /// supplies `fraction`; the two heights are the only presentation here.
    private func barHeight(_ bar: PuzzleStats.ActivityBar) -> CGFloat {
        let span = PuzzleStatsStyle.barMaxHeight - PuzzleStatsStyle.barMinHeight
        return PuzzleStatsStyle.barMinHeight + span * CGFloat(bar.fraction)
    }

    private var themeCard: some View {
        let rows = PuzzleStats.themePerformance(store.state)
        return card(PuzzleStrings.themePerformance) {
            VStack(alignment: .leading, spacing: PuzzleStatsStyle.cardPadding) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: PuzzleStatsStyle.cardPadding) {
                        Text(row.label)
                            .font(Theme.nunito(PuzzleStatsStyle.themeNameSize, .regular))
                            .foregroundStyle(PuzzlePalette.textPrimary)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: PuzzleStatsStyle.themeTrackRadius)
                                    .fill(PuzzlePalette.cardAlt)
                                RoundedRectangle(cornerRadius: PuzzleStatsStyle.themeTrackRadius)
                                    .fill(PuzzlePalette.gold)
                                    .frame(width: geo.size.width * CGFloat(row.fraction))
                            }
                        }
                        .frame(height: PuzzleStatsStyle.themeTrackHeight)
                        Text("\(row.percent)")
                            .font(Theme.nunito(PuzzleStatsStyle.themePctSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                            .frame(minWidth: PuzzleStatsStyle.themePctMinWidth, alignment: .trailing)
                    }
                }
            }
        }
    }
}

/// The rating sparkline.
///
/// `PuzzleStats.sparkline` maps every point into a box, so it needs the box first — and the width
/// is whatever the card gives it. That is why the state goes in and the geometry is read here,
/// rather than a width being invented as a constant: there is no extracted width, because in the
/// source the chart is `flex: 1`.
struct PuzzleSparkline: View {
    let state: PuzzleProgressState

    var body: some View {
        GeometryReader { geo in
            let spark = PuzzleStats.sparkline(state,
                                              width: Double(geo.size.width),
                                              height: Double(geo.size.height))
            Path { p in
                guard let first = spark.points.first else { return }
                p.move(to: CGPoint(x: first.x, y: first.y))
                for pt in spark.points.dropFirst() {
                    p.addLine(to: CGPoint(x: pt.x, y: pt.y))
                }
            }
            .stroke(PuzzlePalette.gold,
                    style: StrokeStyle(lineWidth: PuzzleStatsStyle.sparkStrokeWidth,
                                       lineCap: .round, lineJoin: .round))
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .padding(PuzzleStatsStyle.sparkPadding)
        .background(PuzzlePalette.cardAlt,
                    in: RoundedRectangle(cornerRadius: PuzzleStatsStyle.sparkRadius))
    }
}

/// Part 10.2 / 10.3 — the rated solver. The only mode with a clock, an Elo delta, an engine panel
/// and a Save sheet, and `PuzzleDisplay` is what decides that rather than this view.
struct PuzzlePlaySolverScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onExit: () -> Void

    @StateObject private var engine = PuzzleSolverEngine(mode: .play)
    @State private var elapsed = 0
    @State private var ratingDelta: Int?
    @State private var startedAt: Int?

    private let tick = Timer.publish(every: PuzzleSolverVM.tickSeconds, on: .main, in: .common)
        .autoconnect()

    var body: some View {
        // One GeometryReader, at the top — see PuzzleSolverParts.PuzzleBoardBand for why the board
        // must be sized from the width and never from a nested reader's leftover height.
        GeometryReader { geo in
            VStack(spacing: 0) {
                PuzzleScreenHeader(title: PuzzleStrings.puzzle,
                                   titleSize: PuzzleType.dailySolverTitle,
                                   onBack: { engine.leave(); onExit() }) {
                    Text(PuzzleDisplay.formatTime(elapsed))
                        .font(Theme.nunito(PuzzleType.solverStatValue, .bold))
                        .foregroundStyle(PuzzlePalette.textPrimary)
                        .monospacedDigit()
                }
                infoStrip
                PuzzleBoardBand(engine: engine, edge: geo.size.width)
                deltaRow
                PuzzleBottomPanel(engine: engine, onNext: next)
                if PuzzleDisplay.hasEnginePanel(engine.mode) { PuzzleEnginePanelView(engine: engine) }
                Spacer(minLength: 0)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .background(PuzzlePalette.screenBg)
            .overlay { promotion }
            .onAppear(perform: startIfNeeded)
            .onDisappear { engine.leave() }
            .onReceive(tick) { _ in
                guard let startedAt, engine.session?.phase == .playing else { return }
                elapsed = (PuzzleHubStore.nowMs() - startedAt) / PuzzleSolverVM.msPerSecond
            }
        }
    }

    @ViewBuilder
    private var promotion: some View {
        if engine.pendingPromotion != nil, let s = engine.session {
            PuzzlePromotionOverlay(color: s.userColor, mode: engine.mode) {
                engine.choosePromotion($0)
            }
        }
    }

    private var infoStrip: some View {
        let strip = PuzzleDisplay.infoStrip(engine.session?.phase ?? .loading,
                                            userIsWhite: engine.userIsWhite,
                                            solveTimeSeconds: elapsed)
        return Text(strip.text)
            .font(Theme.nunito(PuzzleType.solverInfoStrip, .semiBold))
            .foregroundStyle(strip.color)
            .frame(maxWidth: .infinity, minHeight: PuzzleSolverStyle.infoStripHeight)
            .padding(.horizontal, PuzzleSolverStyle.infoStripPaddingH)
    }

    @ViewBuilder
    private var deltaRow: some View {
        if let delta = PuzzleDisplay.deltaStyle(ratingDelta) {
            Text(delta.text)
                .font(Theme.nunito(PuzzleType.solverRatingDelta, .bold))
                .foregroundStyle(delta.color)
                .padding(.top, PuzzleSolverStyle.ratingDeltaMarginTop)
        }
    }

    private func startIfNeeded() {
        guard engine.session == nil else { return }
        engine.onSolved = { _ in finish(correct: true) }
        engine.onWrong = { _ in finish(correct: false) }
        next()
    }

    /// Serve, and reset the clock and the delta with it. `serveRated` commits `seen` and persists.
    private func next() {
        ratingDelta = nil
        elapsed = 0
        startedAt = PuzzleHubStore.nowMs()
        guard let p = store.serveRated() else { return }
        engine.mount(p)
    }

    /// Rated submission, exactly once per puzzle — `recordRatedAttempt` enforces that itself, and
    /// the delta is held in view state so a Retry cannot blank it.
    private func finish(correct: Bool) {
        guard let p = engine.puzzle else { return }
        let res = store.mutate { s in
            PuzzleProgress.recordRatedAttempt(&s, puzzleId: p.id, isCorrect: correct,
                                              puzzleRating: p.rating, themes: p.themes,
                                              solveTimeSeconds: elapsed,
                                              now: PuzzleHubStore.nowMs())
        }
        if res.firstAttempt { ratingDelta = res.ratingChange }
    }
}

/// Timings the solver screens share. Their own namespace so no view body holds a number.
enum PuzzleSolverVM {
    static let msPerSecond = 1000
    static let tickSeconds: Double = 1.0
    /// How long the suggestions search may run. The same budget the Analysis Board gives its live
    /// board — a puzzle position is no harder and the user is waiting on it.
    static let engineDeadlineSeconds: Double = 3.0
}
