import SwiftUI
import BiyaherongCoachCore

// Play Puzzles (Part 10) — the rated mode. Home is the stats screen; the solver is the only one
// with a clock, an Elo delta, an engine panel and a Save sheet.

/// Part 10.1 — rating, accuracy, sparkline, activity and theme performance.
struct PuzzlePlayHomeScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onPlay: () -> Void
    let onExit: () -> Void

    /// Every Part 10.1 statistic in one call. The spark box is the only one that needs geometry —
    /// in the source that chart is `flex: 1`, so its width is measured by whoever draws it rather
    /// than extracted, which is why it arrives as a parameter instead of as a constant.
    private func summary(sparkWidth: CGFloat) -> PuzzleStats.Summary {
        PuzzleStats.summary(store.state, now: PuzzleHubStore.nowMs(),
                            sparkWidth: Double(sparkWidth),
                            sparkHeight: Double(PuzzleStatsStyle.sparkHeight),
                            sparkYMargin: PuzzleStatsStyle.sparkYMargin,
                            barMaxHeight: Double(PuzzleStatsStyle.barMaxHeight),
                            barMinHeight: Double(PuzzleStatsStyle.barMinHeight))
    }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.homeTitle, subtitle: nil,
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
            // Under two attempts there is no line to draw, and the web drops the whole card rather
            // than show an empty box (`sparkCard` returns null) — so does this.
            if hasSparkline { sparklineCard }
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
                // Through the shared formatter, never `Text("\(acc.percent)")`: a `Double` interpolated
                // into a `Text` literal becomes a `LocalizedStringKey`, which formats it as `%lf` —
                // the "91.700000" in the client's round-3 recording, with no "%" either.
                Text(AnalysisTables.accuracyText(acc.percent))
                    .font(Theme.nunito(PuzzleStatsStyle.accuracySize, .bold))
                    .foregroundStyle(PuzzleStatsStyle.accuracyColor(acc.percent))
            }
        }
    }

    private var hasSparkline: Bool {
        PuzzleStats.sparkline(store.state, width: 1, height: 1,
                              yMargin: PuzzleStatsStyle.sparkYMargin) != nil
    }

    private var sparklineCard: some View {
        card(PuzzleStrings.yourRating) {
            PuzzleSparkline(state: store.state)
                .frame(height: PuzzleStatsStyle.sparkHeight)
        }
    }

    private var activityCard: some View {
        let bars = PuzzleStats.activity(store.state, now: PuzzleHubStore.nowMs(),
                                        maxHeight: Double(PuzzleStatsStyle.barMaxHeight),
                                        minHeight: Double(PuzzleStatsStyle.barMinHeight))
        return card(PuzzleStrings.activity) {
            HStack(alignment: .bottom, spacing: PuzzleStatsStyle.barRowMarginTop) {
                ForEach(bars, id: \.dayKey) { bar in
                    VStack(spacing: 0) {
                        // Blank on an empty day, as the spec has it (Part 10.1) and the web draws
                        // it — a row of "0"s over the stubs read as data rather than as no data.
                        Text(bar.count > 0 ? String(bar.count) : "")
                            .font(Theme.nunito(PuzzleStatsStyle.barCountSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                            .frame(height: PuzzleStatsStyle.barCountHeight)
                        RoundedRectangle(cornerRadius: PuzzleStatsStyle.barRadius)
                            .fill(PuzzlePalette.gold)
                            .frame(width: PuzzleStatsStyle.barWidth, height: CGFloat(bar.height))
                        Text(dayInitial(bar.dayKey))
                            .font(Theme.nunito(PuzzleStatsStyle.barDaySize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    /// The first character of the localized short weekday, per Part 10.1.
    ///
    /// The key is read back through a UTC calendar rather than a hand-written date format, the way
    /// `PuzzleProgress.dayNumber` reads it: the key is already a settled calendar day, so re-parsing
    /// it in the device's zone could name the day before.
    private func dayInitial(_ dayKey: String) -> String {
        let p = dayKey.split(separator: "-").map { Int($0) ?? 0 }
        guard p.count == 3 else { return "" }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        guard let d = utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) else {
            return ""
        }
        let symbols = Calendar.current.shortWeekdaySymbols
        let weekday = utc.component(.weekday, from: d)          // 1 = Sunday, as the symbols index
        guard weekday >= 1, weekday <= symbols.count else { return "" }
        return String(symbols[weekday - 1].prefix(1))
    }

    private var themeCard: some View {
        let rows = PuzzleStats.themePerformance(store.state)
        return card(PuzzleStrings.themePerformance) {
            VStack(alignment: .leading, spacing: PuzzleStatsStyle.cardPadding) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: PuzzleStatsStyle.cardPadding) {
                        Text(row.theme)
                            .font(Theme.nunito(PuzzleStatsStyle.themeNameSize, .regular))
                            .foregroundStyle(PuzzlePalette.textPrimary)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: PuzzleStatsStyle.themeTrackRadius)
                                    .fill(PuzzlePalette.cardAlt)
                                RoundedRectangle(cornerRadius: PuzzleStatsStyle.themeTrackRadius)
                                    .fill(PuzzlePalette.gold)
                                    .frame(width: geo.size.width * CGFloat(row.percent) / 100)
                            }
                        }
                        .frame(height: PuzzleStatsStyle.themeTrackHeight)
                        Text(String(row.percent) + "%")
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
            // `nil` below two attempts: a one-point polyline is an invisible dot that reads as a
            // bug, so the box draws nothing at all rather than a stray mark.
            if let spark = PuzzleStats.sparkline(state,
                                                 width: Double(geo.size.width),
                                                 height: Double(geo.size.height),
                                                 yMargin: PuzzleStatsStyle.sparkYMargin) {
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
        }
        // No inset here. `sparkPadding` (32) is the card's own 16 + 16, a WIDTH the web subtracts
        // (`width - S.sparkPadding`) — and `card` already applies it. Used as an inset on all four
        // sides it took 64 pt out of a 52 pt box, the reader got a height of 0, and every point
        // landed on one invisible line: the empty "Your Rating" card in the client's recording.
        .background(PuzzlePalette.screenBg,
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

    /// `@State`, not `let` — the same restart-on-rebuild the Turbo clock had; see
    /// `PuzzleTurboRunScreen.tick`. Every serve rebuilds this struct too.
    @State private var tick = Timer.publish(every: PuzzleSolverVM.tickSeconds, on: .main, in: .common)
        .autoconnect()

    var body: some View {
        // One GeometryReader, at the top — see PuzzleSolverParts.PuzzleBoardBand for why the board
        // must be sized from the width and never from a nested reader's leftover height.
        GeometryReader { geo in
            VStack(spacing: 0) {
                PuzzleScreenHeader(title: PuzzleStrings.puzzle, subtitle: nil,
                                   titleSize: PuzzleType.dailySolverTitle,
                                   onBack: { leaveScreen(); onExit() })
                infoStrip
                PuzzleBoardBand(engine: engine, edge: geo.size.width)
                statsRow
                PuzzleBottomPanel(engine: engine, onNext: next)
                if PuzzleDisplay.hasEnginePanel(engine.mode) { PuzzleEnginePanelView(engine: engine) }
                Spacer(minLength: 0)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .background(PuzzlePalette.screenBg)
            .overlay { promotion }
            .onAppear(perform: startIfNeeded)
            .onDisappear(perform: leaveScreen)
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

    /// Band 4 — `Your Rating {rating}` over its delta · ⏱ · `Puzzle {rating}` (spec Part 10.2,
    /// RN `play-puzzle/index.tsx:900-921`, web `puzzle-solver.js` `paintStats`).
    ///
    /// It was never built: the port moved the timer into the header and kept only a bare "+12"
    /// under the board, so a player who wanted their new rating had to back out to the hub to read
    /// it — which is the round-3 report, and which also re-rolled the puzzle. The rating is read
    /// live from the store, so it is the NEW rating the instant `finish` records the attempt.
    private var statsRow: some View {
        let delta = PuzzleDisplay.deltaStyle(ratingDelta)
        return HStack(alignment: .top, spacing: 0) {
            stat(PuzzleStrings.yourRating) {
                Text("\(store.state.profile.rating)")
                    .font(Theme.nunito(PuzzleType.solverStatValue, .bold))
                    .foregroundStyle(PuzzlePalette.gold)
                    .monospacedDigit()
                // Always laid out, blank until a result exists — the web's `min-height: 1em` — so
                // the row does not grow, and push the buttons down, the moment the delta lands.
                Text(delta?.text ?? " ")
                    .font(Theme.nunito(PuzzleType.solverRatingDelta, .bold))
                    .foregroundStyle(delta?.color ?? .clear)
                    .padding(.top, PuzzleSolverStyle.ratingDeltaMarginTop)
            }
            stat(PuzzleStrings.clock) {
                Text(PuzzleDisplay.formatTime(elapsed))
                    .font(Theme.nunito(PuzzleType.solverStatValue, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .monospacedDigit()
            }
            stat(PuzzleStrings.puzzle) {
                Text(engine.puzzle.map { "\($0.rating)" } ?? PuzzleStrings.noRating)
                    .font(Theme.nunito(PuzzleType.solverStatValue, .bold))
                    .foregroundStyle(PuzzlePalette.gold)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, PuzzleSolverStyle.statsPaddingH)
        .padding(.vertical, PuzzleSolverStyle.statsPaddingV)
        .frame(maxWidth: .infinity)
        .background(PuzzlePalette.card)
    }

    /// One stats column: a label over its value, centred — `.pz-stat` in the web twin.
    private func stat<V: View>(_ label: String, @ViewBuilder _ value: () -> V) -> some View {
        VStack(spacing: 0) {
            Text(label)
                .font(Theme.nunito(PuzzleType.solverStatLabel, .medium))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .padding(.bottom, PuzzleSolverStyle.statLabelMarginBottom)
            value()
        }
        .frame(maxWidth: .infinity)
    }

    /// Resume the puzzle the player backed out of, or serve a fresh one.
    ///
    /// The Core has carried `PlayPuzzleDraft` since the port (spec Part 10.2: "restore silently on
    /// entry if it is under 24 hours old"); no Swift screen ever called it, so backing out of a
    /// hard puzzle and pressing Play again served a different one — a free skip, and the client's
    /// round-3 report. The web twin restored it all along.
    private func startIfNeeded() {
        guard engine.session == nil else { return }
        engine.onSolved = { _ in finish(correct: true) }
        engine.onWrong = { _ in finish(correct: false) }
        if let restored = store.resumablePlay() {
            ratingDelta = nil
            elapsed = 0
            startedAt = PuzzleHubStore.nowMs()
            engine.mount(restored)
            return
        }
        next()
    }

    /// Serve, and reset the clock and the delta with it. `serveRated` commits `seen` and persists;
    /// the draft is written at the same moment, so leaving by ANY route — the chevron, the tab
    /// bar, the app being killed — finds this puzzle waiting.
    private func next() {
        ratingDelta = nil
        elapsed = 0
        startedAt = PuzzleHubStore.nowMs()
        guard let p = store.serveRated() else { return }
        store.mutate { s in
            PuzzleProgress.savePlayDraft(&s, puzzleId: p.id, now: PuzzleHubStore.nowMs())
        }
        engine.mount(p)
    }

    /// Leaving with an unsolved puzzle refreshes the draft, so its 24 h run from when the player
    /// LEFT — RN saves on blur (`:231-243`) and the web on the back button. A solved puzzle has no
    /// draft to refresh: `finish` already cleared it.
    private func leaveScreen() {
        if let p = engine.puzzle, let phase = engine.session?.phase, phase != .solved,
           store.state.playDraft?.puzzleId == p.id {
            store.mutate { s in
                PuzzleProgress.savePlayDraft(&s, puzzleId: p.id, now: PuzzleHubStore.nowMs())
            }
        }
        engine.leave()
    }

    /// Rated submission, exactly once per puzzle — `recordRatedAttempt` enforces that itself, and
    /// the delta is held in view state so a Retry cannot blank it.
    ///
    /// A solve clears the draft; a wrong move keeps it, as RN and the web do, so backing out after
    /// a miss brings the same puzzle back. That cannot be counted twice: a repeat returns
    /// `firstAttempt == false` with no change, and no delta is shown for it.
    private func finish(correct: Bool) {
        guard let p = engine.puzzle else { return }
        let res = store.mutate { s in
            let r = PuzzleProgress.recordRatedAttempt(&s, puzzleId: p.id, isCorrect: correct,
                                                      puzzleRating: p.rating, themes: p.themes,
                                                      solveTimeSeconds: elapsed,
                                                      now: PuzzleHubStore.nowMs())
            if correct { s.playDraft = nil }
            return r
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
