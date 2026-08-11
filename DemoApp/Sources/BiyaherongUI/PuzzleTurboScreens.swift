import SwiftUI
import BiyaherongCoachCore

// Puzzle Turbo (Part 14). Three lives, a running difficulty ramp, and — in two of the three
// modes — a clock.

/// Part 14.1 — mode select. Three tabs each carrying their own best, and Recent Runs filtered by
/// the selected one.
struct PuzzleTurboHomeScreen: View {
    @ObservedObject var store: PuzzleHubStore
    /// `(mode, resumeDraft)`.
    let onStart: (Int, Bool) -> Void
    let onExit: () -> Void

    @State private var selected = PuzzleTurboModes.defaultMode
    @State private var resumeDraft: RushDraft?

    private var mode: PuzzleTurboModes.Mode {
        PuzzleTurboModes.all.first { $0.minutes == selected } ?? PuzzleTurboModes.all[0]
    }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.turboTitle,
                               titleSize: PuzzleType.turboTitle, onBack: onExit) {
                Text(PuzzleStrings.turboBadge)
                    .font(Theme.nunito(PuzzleType.turboBadge, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, PuzzleTurboHome.badgePaddingH)
                    .padding(.vertical, PuzzleTurboHome.badgePaddingV)
                    .background(PuzzleTurboHome.badgeFill,
                                in: RoundedRectangle(cornerRadius: PuzzleTurboHome.badgeRadius))
            }
            VStack(spacing: PuzzleTurboHome.topGap) {
                infoBar
                modeCard
            }
            .padding(.horizontal, PuzzleTurboHome.topPaddingH)
            listTitle
            runList
            bottom
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
        .overlay { if resumeDraft != nil { resumeModal } }
    }

    private var infoBar: some View {
        HStack {
            Text(PuzzleStrings.turboInfo)
                .font(Theme.nunito(PuzzleTurboHome.infoSize, .regular))
                .foregroundStyle(PuzzlePalette.textPrimary)
            Spacer(minLength: 0)
            Text(PuzzleStrings.turboMistakes)
                .font(Theme.nunito(PuzzleTurboHome.mistakeBadgeSize, .bold))
                .foregroundStyle(PuzzleTurboHome.mistakeBadgeColor)
                .padding(.horizontal, PuzzleTurboHome.mistakeBadgePaddingH)
                .padding(.vertical, PuzzleTurboHome.mistakeBadgePaddingV)
                .background(PuzzleTurboHome.mistakeBadgeFill,
                            in: RoundedRectangle(cornerRadius: PuzzleTurboHome.mistakeBadgeRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleTurboHome.mistakeBadgeRadius)
                    .stroke(PuzzleTurboHome.mistakeBadgeBorder,
                            lineWidth: PuzzleTurboHome.infoBorder))
        }
        .padding(.horizontal, PuzzleTurboHome.infoPaddingH)
        .padding(.vertical, PuzzleTurboHome.infoPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleTurboHome.infoRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleTurboHome.infoRadius)
            .stroke(PuzzleTurboHome.infoBorderColor, lineWidth: PuzzleTurboHome.infoBorder))
    }

    private var modeCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(PuzzleStrings.turboSelectMode)
                .font(Theme.nunito(PuzzleTurboHome.cardLabelSize, .bold))
                .tracking(PuzzleTurboHome.cardLabelLetterSpacing)
                .foregroundStyle(PuzzleTurboHome.cardLabelColor)
                .padding(.bottom, PuzzleTurboHome.cardLabelMarginBottom)
            HStack(spacing: PuzzleTurboHome.tabGap) {
                ForEach(PuzzleTurboModes.all, id: \.minutes) { m in
                    Button { selected = m.minutes } label: { tab(m) }
                        .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, PuzzleTurboHome.cardPaddingH)
        .padding(.vertical, PuzzleTurboHome.cardPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleTurboHome.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleTurboHome.cardRadius)
            .stroke(PuzzleTurboHome.cardBorderColor, lineWidth: PuzzleTurboHome.cardBorder))
    }

    private func tab(_ m: PuzzleTurboModes.Mode) -> some View {
        let on = m.minutes == selected
        return VStack(spacing: PuzzleTurboHome.tabGapInner) {
            Text(m.label)
                .font(Theme.nunito(PuzzleTurboHome.tabTextSize, .bold))
                .foregroundStyle(on ? .white : PuzzlePalette.textPrimary)
            Text(PuzzleStrings.turboBest(PuzzleProgress.rushBest(store.state, mode: m.minutes)))
                .font(Theme.nunito(PuzzleTurboHome.tabBestSize, .regular))
                .foregroundStyle(on ? PuzzleTurboHome.tabBestSelectedColor
                                    : PuzzleTurboHome.tabBestColor)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, PuzzleTurboHome.tabPaddingH)
        .padding(.vertical, PuzzleTurboHome.tabPaddingV)
        .background(on ? m.color : PuzzleTurboHome.tabFill,
                    in: RoundedRectangle(cornerRadius: PuzzleTurboHome.tabRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleTurboHome.tabRadius)
            .stroke(on ? m.color : PuzzleTurboHome.tabBorderColor,
                    lineWidth: PuzzleTurboHome.tabBorder))
    }

    private var listTitle: some View {
        Text(PuzzleStrings.turboRecent(mode.label))
            .font(Theme.nunito(PuzzleTurboHome.listTitleSize, .bold))
            .foregroundStyle(PuzzlePalette.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, PuzzleTurboHome.listPaddingH)
            .padding(.top, PuzzleTurboHome.listPaddingTop)
            .padding(.bottom, PuzzleTurboHome.listPaddingBottom)
    }

    /// Filtered by the selected tab — a 3-minute best is not a 5-minute best.
    private var runList: some View {
        let runs = PuzzleProgress.recentRushRuns(store.state, mode: selected)
        return ScrollView {
            if runs.isEmpty {
                Text(PuzzleStrings.turboEmpty)
                    .font(Theme.nunito(PuzzleTurboHome.emptySize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, PuzzleTurboHome.listPaddingTop)
            } else {
                ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                    HStack(spacing: PuzzleTurboHome.rowGap) {
                        Text(PuzzleStrings.turboRunScore(run.score))
                            .font(Theme.nunito(PuzzleTurboHome.rowScoreSize, .bold))
                            .foregroundStyle(PuzzlePalette.gold)
                            .frame(minWidth: PuzzleTurboHome.rowScoreMinWidth, alignment: .leading)
                        Text(PuzzleStrings.turboRunMistakes(run.mistakes))
                            .font(Theme.nunito(PuzzleTurboHome.rowMistakesSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                        Spacer(minLength: 0)
                        Text(PuzzleRunDate.relative(run.endedAt, now: PuzzleHubStore.nowMs()))
                            .font(Theme.nunito(PuzzleTurboHome.rowDateSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                    }
                    .padding(.horizontal, PuzzleTurboHome.rowPaddingH)
                    .padding(.vertical, PuzzleTurboHome.rowPaddingV)
                    .background(PuzzlePalette.card,
                                in: RoundedRectangle(cornerRadius: PuzzleTurboHome.rowRadius))
                    .padding(.bottom, PuzzleTurboHome.rowMarginBottom)
                }
                .padding(.horizontal, PuzzleTurboHome.listPaddingH)
            }
        }
    }

    private var bottom: some View {
        VStack(spacing: PuzzleTurboHome.bottomGap) {
            Button { } label: {
                Text(PuzzleStrings.turboShare)
                    .font(Theme.nunito(PuzzleTurboHome.shareSize, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PuzzleTurboHome.sharePaddingV)
                    .background(PuzzleTurboHome.shareFill,
                                in: RoundedRectangle(cornerRadius: PuzzleTurboHome.shareRadius))
            }
            .buttonStyle(.plain)
            Button(action: start) {
                Text(PuzzleStrings.turboStart(selected))
                    .font(Theme.nunito(PuzzleTurboHome.startSize, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PuzzleTurboHome.startPaddingV)
                    // The start button takes the SELECTED mode's colour — the source sets it
                    // inline, which is why the extraction shows it with no fill of its own.
                    .background(mode.color,
                                in: RoundedRectangle(cornerRadius: PuzzleTurboHome.startRadius))
                    .shadow(color: .black.opacity(PuzzleTurboHome.startShadowOpacity),
                            radius: PuzzleTurboHome.startShadowRadius,
                            y: PuzzleTurboHome.startShadowY)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, PuzzleTurboHome.bottomPaddingH)
        .padding(.top, PuzzleTurboHome.bottomPaddingTop)
        .padding(.bottom, PuzzleTurboHome.bottomPaddingBottom)
    }

    /// The resume prompt is **infinite-only**: a timed run cannot be paused, so a draft of one
    /// would be meaningless. `loadRushDraft` also drops anything over 24 h old.
    private func start() {
        guard selected == PuzzleTurboRunVM.infiniteMode else { onStart(selected, false); return }
        let draft = store.mutate { s in
            PuzzleProgress.loadRushDraft(&s, now: PuzzleHubStore.nowMs())
        }
        if let draft, draft.score > 0 { resumeDraft = draft } else { onStart(selected, false) }
    }

    @ViewBuilder
    private var resumeModal: some View {
        if let d = resumeDraft {
            PuzzleModal(title: PuzzleStrings.turboResumeTitle,
                        body: PuzzleStrings.turboResumeBody(d.score, d.mistakes),
                        dangerTitle: PuzzleStrings.turboNewSession,
                        keepTitle: PuzzleStrings.turboResume,
                        onDanger: {
                            resumeDraft = nil
                            store.mutate { s in s.rushDraft = nil }
                            onStart(selected, false)
                        },
                        onKeep: { resumeDraft = nil; onStart(selected, true) })
        }
    }
}

/// Part 14.3 / 14.4 — the run.
struct PuzzleTurboRunScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let mode: Int
    let resumeDraft: Bool
    let onExit: () -> Void

    @StateObject private var engine = PuzzleSolverEngine(mode: .turbo)
    @State private var run = TurboRun.State(mode: 0, score: 0, mistakes: 0, targetRating: 0,
                                            puzzlesServed: 0, startedAt: nil, endedAt: nil,
                                            reason: nil)
    @State private var result: PuzzleProgress.RushResult?
    @State private var showQuit = false
    @State private var feedback: (square: String, correct: Bool)?
    @State private var secondsLeft: Int?

    private let tick = Timer.publish(every: PuzzleSolverVM.tickSeconds, on: .main, in: .common)
        .autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            if result != nil { results } else { running }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
        .overlay { promotion }
        .overlay { if showQuit { quitModal } }
        .onAppear(perform: start)
        .onDisappear(perform: leave)
        .onReceive(tick) { _ in tickClock() }
    }

    // MARK: - Running

    private var running: some View {
        VStack(spacing: 0) {
            header
            statsBar
            ZStack(alignment: .topLeading) {
                PuzzleBoardBand(engine: engine)
                feedbackDot
            }
            hint
            Spacer(minLength: 0)
        }
    }

    private var header: some View {
        HStack {
            Button { showQuit = true } label: {
                Text(PuzzleStrings.turboQuit)
                    .font(Theme.nunito(PuzzleTurboRun.quitSize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .frame(width: PuzzleTurboRun.quitBtnW, height: PuzzleTurboRun.quitBtnH,
                           alignment: .leading)
            }
            .buttonStyle(.plain)
            Spacer()
            Text(TurboRun.formatClock(secondsLeft))
                .font(Theme.nunito(PuzzleTurboRun.timerSize, .bold))
                .foregroundStyle(PuzzleTurboModes.timerColor(secondsLeft))
                .monospacedDigit()
            Spacer()
            lives
        }
        .padding(.horizontal, PuzzleTurboRun.headerPaddingH)
        .padding(.vertical, PuzzleTurboRun.headerPaddingV)
    }

    private var lives: some View {
        HStack(spacing: PuzzleTurboRun.mistakesGap) {
            ForEach(0..<TurboRun.maxMistakes, id: \.self) { i in
                Text(i < run.mistakes ? PuzzleStrings.turboLifeSpent
                                      : PuzzleStrings.turboLifeLeft)
                    .font(.system(size: PuzzleTurboRun.mistakeDotSize))
                    .opacity(i < run.mistakes ? PuzzleTurboRun.mistakeUsedOpacity
                                              : PuzzleTurboRun.mistakeLeftOpacity)
            }
        }
    }

    private var statsBar: some View {
        HStack {
            stat(PuzzleStrings.turboScore, "\(run.score)")
            stat(PuzzleStrings.turboMode, modeLabel)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, PuzzleTurboRun.statsPaddingH)
        .padding(.vertical, PuzzleTurboRun.statsPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleTurboRun.statsRadius))
        .shadow(color: .black.opacity(PuzzleTurboRun.statsShadowOpacity),
                radius: PuzzleTurboRun.statsShadowRadius, y: PuzzleTurboRun.statsShadowY)
        .padding(.horizontal, PuzzleTurboRun.statsMarginH)
        .padding(.bottom, PuzzleTurboRun.statsMarginBottom)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: PuzzleTurboRun.statLabelMarginBottom) {
            Text(label)
                .font(Theme.nunito(PuzzleTurboRun.statLabelSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
            Text(value)
                .font(Theme.nunito(PuzzleTurboRun.statValueSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
        }
        .frame(maxWidth: .infinity)
    }

    /// The ✓/✕ over the square that was played, from the extracted **signed** terms.
    ///
    /// `PuzzleTurboFeedback.origin` owns the arithmetic — `left` subtracts its radius term and
    /// `top` adds its own, and the board flip is asymmetric. Re-deriving it here is exactly how the
    /// annotation badge once shipped in the wrong corner in both languages.
    @ViewBuilder
    private var feedbackDot: some View {
        if let fb = feedback {
            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height)
                let r = side / CGFloat(PuzzleTurboRunVM.filesPerRank)
                    * PuzzleTurboFeedback.radiusFactor
                let origin = PuzzleTurboFeedback.origin(square: fb.square, boardSize: side,
                                                        userIsWhite: engine.userIsWhite)
                Text(fb.correct ? PuzzleStrings.turboFeedbackOk : PuzzleStrings.turboFeedbackBad)
                    .font(.system(size: r * PuzzleTurboFeedback.glyphFactor, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: r * PuzzleTurboRunVM.diameter,
                           height: r * PuzzleTurboRunVM.diameter)
                    .background(fb.correct ? PuzzleTurboFeedback.correctFill
                                           : PuzzleTurboFeedback.wrongFill,
                                in: Circle())
                    .overlay(Circle().stroke(PuzzleTurboFeedback.borderColor,
                                             lineWidth: PuzzleTurboFeedback.borderWidth))
                    .offset(x: origin.x, y: origin.y)
            }
            .allowsHitTesting(false)
        }
    }

    private var hint: some View {
        Text(engine.userIsWhite ? PuzzleStrings.turboWhite : PuzzleStrings.turboBlack)
            .font(Theme.nunito(PuzzleTurboRun.hintSize, .medium))
            .foregroundStyle(PuzzlePalette.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, PuzzleTurboRun.bottomPaddingH)
    }

    @ViewBuilder
    private var promotion: some View {
        if engine.pendingPromotion != nil, let s = engine.session {
            PuzzlePromotionOverlay(color: s.userColor, mode: engine.mode) {
                engine.choosePromotion($0)
            }
        }
    }

    /// Quitting still RECORDS the run (fix #13) — the original recorded nothing.
    @ViewBuilder
    private var quitModal: some View {
        PuzzleModal(title: PuzzleStrings.turboQuitTitle,
                    body: PuzzleStrings.turboQuitBody,
                    dangerTitle: PuzzleStrings.turboQuit,
                    keepTitle: PuzzleStrings.turboKeepPlaying,
                    onDanger: { showQuit = false; finish(.quit) },
                    onKeep: { showQuit = false })
    }

    // MARK: - Results (Part 14.4)

    @ViewBuilder
    private var results: some View {
        if let r = result {
            VStack(spacing: 0) {
                Text(r.isNewBest ? PuzzleStrings.streakTrophy : PuzzleStrings.turboBolt)
                    .font(.system(size: PuzzleTurboRun.finishedIconSize))
                    .padding(.bottom, PuzzleTurboRun.finishedIconMarginBottom)
                // From the REAL reason, never a constant — the original always said "Time's Up!".
                Text(TurboRun.resultTitle(run.reason, isNewBest: r.isNewBest))
                    .font(Theme.nunito(PuzzleTurboRun.finishedTitleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .padding(.bottom, PuzzleTurboRun.finishedTitleMarginBottom)
                Text("\(run.score)")
                    .font(Theme.nunito(PuzzleTurboRun.finishedScoreSize, .bold))
                    .foregroundStyle(PuzzlePalette.gold)
                Text(PuzzleStrings.turboSolved)
                    .font(Theme.nunito(PuzzleTurboRun.finishedLabelSize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .padding(.bottom, PuzzleTurboRun.finishedLabelMarginBottom)
                VStack(spacing: PuzzleTurboRun.finishedStatsGap) {
                    Text(PuzzleStrings.turboMistakeCount(run.mistakes))
                    Text(PuzzleStrings.turboModeLine(run.mode))
                    Text(PuzzleStrings.turboBest(r.best))
                }
                .font(Theme.nunito(PuzzleTurboRun.finishedStatSize, .regular))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .padding(.bottom, PuzzleTurboRun.finishedStatsMarginBottom)
                Button { } label: {
                    Text(PuzzleStrings.turboShareResult)
                        .font(Theme.nunito(PuzzleTurboRun.shareSize, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, PuzzleTurboRun.sharePaddingH)
                        .padding(.vertical, PuzzleTurboRun.sharePaddingV)
                        .background(PuzzleTurboRun.shareFill,
                                    in: RoundedRectangle(cornerRadius: PuzzleTurboRun.shareRadius))
                }
                .buttonStyle(.plain)
                .padding(.bottom, PuzzleTurboRun.shareMarginBottom)
                Button { onExit() } label: {
                    Text(PuzzleStrings.turboBack)
                        .font(Theme.nunito(PuzzleTurboRun.doneSize, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, PuzzleTurboRun.donePaddingH)
                        .padding(.vertical, PuzzleTurboRun.donePaddingV)
                        .background(PuzzleTurboRun.doneFill,
                                    in: RoundedRectangle(cornerRadius: PuzzleTurboRun.doneRadius))
                }
                .buttonStyle(.plain)
            }
            .padding(PuzzleTurboRun.finishedPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var modeLabel: String {
        PuzzleTurboModes.all.first { $0.minutes == run.mode }?.label ?? ""
    }

    // MARK: - Flow

    private func start() {
        guard engine.session == nil else { return }
        if resumeDraft, let d = store.mutate({ s in
            PuzzleProgress.loadRushDraft(&s, now: PuzzleHubStore.nowMs())
        }) {
            run = TurboRun.resume(d)
        } else {
            run = TurboRun.start(profileRating: store.state.profile.rating, mode: mode)
        }
        engine.onSolved = { _ in solved() }
        engine.onWrong = { w in missed(w) }
        next()
    }

    private func next() {
        let t = TurboRun.target(run)
        guard let p = store.serveStreak(targetRating: t.rating, theme: t.theme) else {
            finish(.finished)
            return
        }
        run = TurboRun.served(run, now: PuzzleHubStore.nowMs())
        engine.mount(p)
        refreshClock()
    }

    private func solved() {
        run = TurboRun.solved(run)
        if checkEnd() { return }
        engine.schedule(PuzzleSession.Timing.turboAdvanceMs) { next() }
    }

    private func missed(_ w: PuzzleSession.Wrong) {
        run = TurboRun.missed(run)
        // The piece STAYS where it landed — Turbo's policy says so, and the dot marks the square.
        feedback = (String(w.played.dropFirst(2).prefix(2)), false)
        engine.schedule(PuzzleSession.Timing.turboFeedbackMs) { feedback = nil }
        if checkEnd() { return }
        engine.schedule(w.policy.advanceMs ?? PuzzleSession.Timing.turboAdvanceMs) { next() }
    }

    /// The clock and the lives, checked in one place.
    private func checkEnd() -> Bool {
        guard let reason = TurboRun.endReason(run, now: PuzzleHubStore.nowMs()) else { return false }
        finish(reason)
        return true
    }

    private func tickClock() {
        guard result == nil, !TurboRun.isOver(run) else { return }
        refreshClock()
        _ = checkEnd()
    }

    /// Read, never counted. `secondsLeft` is derived from `startedAt`, so a delayed or dropped
    /// tick cannot make the clock drift — the interval only repaints.
    private func refreshClock() {
        secondsLeft = TurboRun.secondsLeft(run, now: PuzzleHubStore.nowMs())
    }

    /// The ONE exit. Idempotent all the way down: `TurboRun.end` keeps the first reason, so a clock
    /// expiry plus a navigation writes one history row, not two (fixes #5, #6 and #13).
    private func finish(_ reason: TurboRun.Reason) {
        guard !TurboRun.isOver(run) else { return }
        let now = PuzzleHubStore.nowMs()
        run = TurboRun.end(run, reason: reason, now: now)
        engine.cancel()
        result = store.mutate { s in
            s.rushDraft = nil
            return PuzzleProgress.endRushRun(&s, mode: run.mode, score: run.score,
                                             mistakes: run.mistakes, reason: reason, now: now)
        }
        SoundManager.shared.play(PuzzleSounds.Key.gameOver.file)
    }

    /// Part 14.5's split: an infinite run saves a resumable draft; a timed one ends and is
    /// recorded as `backgrounded`.
    private func leave() {
        engine.leave()
        guard !TurboRun.isOver(run), result == nil else { return }
        if run.mode == PuzzleTurboRunVM.infiniteMode && run.score > 0 {
            let d = TurboRun.draft(run, now: PuzzleHubStore.nowMs())
            store.mutate { s in
                PuzzleProgress.saveRushDraft(&s, score: d.score, mistakes: d.mistakes,
                                             targetRating: d.targetRating,
                                             puzzlesServed: d.puzzlesServed, now: d.savedAt)
            }
            run = TurboRun.end(run, reason: .backgrounded, now: PuzzleHubStore.nowMs())
        } else {
            finish(.backgrounded)
        }
    }
}

/// Turbo's own view constants, so no number appears in a body.
enum PuzzleTurboRunVM {
    /// `0` is the infinite sentinel: no clock at all.
    static let infiniteMode = 0
    static let filesPerRank: Int = 8
    /// The feedback dot is drawn from its radius, so its box is two of them.
    static let diameter: CGFloat = 2
}
