import SwiftUI
import BiyaherongCoachCore

// Puzzle Streak (Part 13). Sudden death: one wrong move ends the run.

/// Part 13.1 — the big counter, three stat cards, and Recent Runs where the leaderboard was.
struct PuzzleStreakHomeScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onStart: () -> Void
    let onExit: () -> Void

    @State private var showResume = false

    private var streak: StreakState { store.state.streak }
    private var live: Bool { streak.currentStreak > 0 }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.streakTitle, subtitle: nil,
                               titleSize: PuzzleType.streakTitle, onBack: onExit) {
                Text(PuzzleStrings.streakBadge)
                    .font(Theme.nunito(PuzzleType.streakBadge, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, PuzzleStreakHome.badgePaddingH)
                    .padding(.vertical, PuzzleStreakHome.badgePaddingV)
                    .background(PuzzleStreakHome.badgeFill,
                                in: RoundedRectangle(cornerRadius: PuzzleStreakHome.badgeRadius))
            }
            VStack(spacing: PuzzleStreakHome.topGap) {
                display
                statsRow
            }
            .padding(.horizontal, PuzzleStreakHome.topPaddingH)
            listTitle
            runList
            bottom
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PuzzlePalette.screenBg)
        .overlay { if showResume { resumeModal } }
    }

    private var display: some View {
        VStack(spacing: 0) {
            Text("\(streak.currentStreak)")
                .font(Theme.nunito(PuzzleStreakHome.numberSize, .bold))
                .foregroundStyle(PuzzleStreakHome.badgeFill)
            Text(PuzzleStrings.streakCurrent)
                .font(Theme.nunito(PuzzleStreakHome.labelSize, .semiBold))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .padding(.top, PuzzleStreakHome.labelMarginTop)
            Text(PuzzleStrings.streakOneMistake)
                .font(Theme.nunito(PuzzleStreakHome.subSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
                .padding(.top, PuzzleStreakHome.subMarginTop)
        }
        .frame(maxWidth: .infinity, minHeight: PuzzleStreakHome.displayMinHeight)
        .padding(PuzzleStreakHome.displayPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleStreakHome.displayRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleStreakHome.displayRadius)
            .stroke(PuzzleStreakHome.displayBorderColor,
                    lineWidth: PuzzleStreakHome.displayBorder))
    }

    private var statsRow: some View {
        HStack(spacing: PuzzleStreakHome.statsGap) {
            statCard(PuzzleStrings.streakTrophy, "\(streak.bestStreak)", PuzzleStrings.streakBest)
            statCard(PuzzleStrings.streakFlame, "\(streak.currentStreak)",
                     PuzzleStrings.streakCurrentShort)
            statCard(PuzzleStrings.streakPawn, PuzzleStrings.infinity, PuzzleStrings.streakNoTimer)
        }
    }

    private func statCard(_ emoji: String, _ value: String, _ label: String) -> some View {
        VStack(spacing: PuzzleStreakHome.statGap) {
            Text(emoji).font(.system(size: PuzzleStreakHome.statEmojiSize))
            Text(value)
                .font(Theme.nunito(PuzzleStreakHome.statValueSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
            Text(label)
                .font(Theme.nunito(PuzzleStreakHome.statLabelSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, PuzzleStreakHome.statPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleStreakHome.statRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleStreakHome.statRadius)
            .stroke(PuzzleStreakHome.statBorderColor, lineWidth: PuzzleStreakHome.statBorder))
    }

    private var listTitle: some View {
        Text(PuzzleStrings.streakRecent)
            .font(Theme.nunito(PuzzleStreakHome.listTitleSize, .bold))
            .foregroundStyle(PuzzlePalette.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, PuzzleStreakHome.listPaddingH)
            .padding(.top, PuzzleStreakHome.listPaddingTop)
            .padding(.bottom, PuzzleStreakHome.listPaddingBottom)
    }

    private var runList: some View {
        let runs = PuzzleProgress.recentStreakRuns(store.state)
        return ScrollView {
            if runs.isEmpty {
                Text(PuzzleStrings.streakEmpty)
                    .font(Theme.nunito(PuzzleStreakHome.emptySize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, PuzzleStreakHome.listPaddingTop)
            } else {
                ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
                    HStack(spacing: PuzzleStreakHome.rowGap) {
                        Text(PuzzleStrings.streakRunScore(run.length))
                            .font(Theme.nunito(PuzzleStreakHome.rowScoreSize, .bold))
                            .foregroundStyle(PuzzleStreakHome.badgeFill)
                            .frame(minWidth: PuzzleStreakHome.rowScoreMinWidth, alignment: .leading)
                        Text(PuzzleRunDate.relative(run.endedAt, now: PuzzleHubStore.nowMs()))
                            .font(Theme.nunito(PuzzleStreakHome.rowDateSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                        Spacer(minLength: 0)
                        if run.length == streak.bestStreak && run.length > 0 {
                            Text(PuzzleStrings.streakTrophy)
                                .font(.system(size: PuzzleStreakHome.rowDateSize))
                        }
                    }
                    .padding(.horizontal, PuzzleStreakHome.rowPaddingH)
                    .padding(.vertical, PuzzleStreakHome.rowPaddingV)
                    .background(PuzzlePalette.card,
                                in: RoundedRectangle(cornerRadius: PuzzleStreakHome.rowRadius))
                    .padding(.bottom, PuzzleStreakHome.rowMarginBottom)
                }
                .padding(.horizontal, PuzzleStreakHome.listPaddingH)
            }
        }
    }

    private var bottom: some View {
        // One child now. The Share button above Start was removed at the client’s request — it
        // was `Button { }`, real chrome wired to an empty closure, so on a phone it did nothing.
        // The `VStack` and its `bottomGap` stay: the gap is an extracted RN constant and the
        // paddings need a wrapper anyway.
        VStack(spacing: PuzzleStreakHome.bottomGap) {
            Button { if live { showResume = true } else { onStart() } } label: {
                Text(live ? PuzzleStrings.streakResumeStart : PuzzleStrings.streakStart)
                    .font(Theme.nunito(PuzzleStreakHome.startSize, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PuzzleStreakHome.startPaddingV)
                    .background(PuzzleStreakHome.startFill,
                                in: RoundedRectangle(cornerRadius: PuzzleStreakHome.startRadius))
            }
            .buttonStyle(PuzzlePressStyle())
        }
        .padding(.horizontal, PuzzleStreakHome.bottomPaddingH)
        .padding(.top, PuzzleStreakHome.bottomPaddingTop)
        .padding(.bottom, PuzzleStreakHome.bottomPaddingBottom)
    }

    /// Offered only when a run is actually live. "Continue" relies on the pending lock to hand back
    /// the same puzzle; "New Game" closes the run at zero, which clears it.
    private var resumeModal: some View {
        PuzzleModal(title: PuzzleStrings.streakResumeTitle,
                    body: PuzzleStrings.streakResumeBody(streak.currentStreak),
                    dangerTitle: PuzzleStrings.streakNewGame,
                    keepTitle: PuzzleStrings.streakContinue,
                    onDanger: {
                        showResume = false
                        store.mutate { s in
                            PuzzleProgress.endStreakRun(&s, length: 0,
                                                        bestBefore: s.streak.bestStreak,
                                                        now: PuzzleHubStore.nowMs())
                        }
                        onStart()
                    },
                    onKeep: { showResume = false; onStart() })
    }
}

/// Part 13.3 — the streak solver.
struct PuzzleStreakSolverScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onExit: () -> Void

    @StateObject private var engine = PuzzleSolverEngine(mode: .streak)
    /// The best as it stood when THIS run started. Captured on entry because
    /// `StreakEngine.increment` raises `bestStreak` on every solve — comparing against the live
    /// value at the end makes the 🏆 badge unreachable.
    @State private var bestBefore = 0
    @State private var result: PuzzleProgress.RunResult?
    @State private var finalStreak = 0
    @State private var showStrip = false

    var body: some View {
        // ONE GeometryReader per screen, at the very top. Everything below reads `geo.size.width`;
        // nothing below may open its own, because a GeometryReader nested in the VStack is greedy —
        // it takes the leftover HEIGHT, and the board was then sized off that instead of the width.
        GeometryReader { geo in
            VStack(spacing: 0) {
                header
                statsBar
                PuzzleBoardBand(engine: engine, edge: geo.size.width)
                bottom
                Spacer(minLength: 0)
            }
            // Explicit size, pinned to `.top`. The old `.frame(maxHeight: .infinity)` defaulted to
            // `.center`, so once the header went greedy the whole screen drifted into the middle of
            // the phone with a blank block above it. Leftover height belongs BELOW the hint, which
            // is where `.pzks-bottom` leaves it in the browser.
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .background(PuzzlePalette.screenBg)
            .overlay { promotion }
            .overlay { if result != nil && !showStrip { resultOverlay } }
            .onAppear(perform: start)
            .onDisappear { engine.leave() }
        }
    }

    private var header: some View {
        HStack {
            NavIconButton(.back, size: PuzzleStreakSolver.backSize,
                          tint: PuzzlePalette.textPrimary,
                          action: { engine.leave(); onExit() })
                .frame(width: PuzzleStreakSolver.backBtnW, height: PuzzleStreakSolver.backBtnH)
            Spacer()
            Text(PuzzleStrings.streakRunScore(store.state.streak.currentStreak))
                .font(Theme.nunito(PuzzleStreakSolver.counterSize, .bold))
                .foregroundStyle(PuzzleStreakHome.badgeFill)
            Spacer()
            // The browser draws `.pzd-logo` here (app.css:1349-1350) — a gold ring with a soft
            // glow. Swift had a bare `Color.clear.frame(width:)` instead, and that single missing
            // `height:` is what broke this screen: `Color` is greedy, `.frame(width:)` constrains
            // only the width, so the header reported an unbounded max height, became a flexible
            // child of the outer VStack, and claimed a slice of the screen as blank space.
            // Both axes are spelled out here, deliberately, the way CoachScreens.swift:76 does.
            // …and it was an EMPTY ring. `AppLogo.tsx` is a ring around an image; both languages
            // ported the ring and neither ported the image. `HomeLogo` is that ring with the mark
            // in it, at the same size, so this is a drop-in.
            HomeLogo(size: PuzzleStreakSolver.logoSize)
        }
        .padding(.horizontal, PuzzleStreakSolver.headerPaddingH)
        .padding(.vertical, PuzzleStreakSolver.headerPaddingV)
    }

    private var statsBar: some View {
        HStack {
            stat(PuzzleStrings.streakStatStreak, "\(store.state.streak.currentStreak)")
            Text(PuzzleStrings.streakFlame)
                .font(.system(size: PuzzleStreakSolver.statDividerSize))
            stat(PuzzleStrings.streakStatBest, "\(store.state.streak.bestStreak)")
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, PuzzleStreakSolver.statsPaddingH)
        .padding(.vertical, PuzzleStreakSolver.statsPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.statsRadius))
        .shadow(color: .black.opacity(PuzzleStreakSolver.statsShadowOpacity),
                radius: PuzzleStreakSolver.statsShadowRadius,
                y: PuzzleStreakSolver.statsShadowY)
        .padding(.horizontal, PuzzleStreakSolver.statsMarginH)
        .padding(.bottom, PuzzleStreakSolver.statsMarginBottom)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: PuzzleStreakSolver.statLabelMarginBottom) {
            Text(label)
                .font(Theme.nunito(PuzzleStreakSolver.statLabelSize, .regular))
                .foregroundStyle(PuzzlePalette.textSecondary)
            Text(value)
                .font(Theme.nunito(PuzzleStreakSolver.statValueSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var bottom: some View {
        VStack(spacing: PuzzleStreakSolver.bottomGap) {
            if showStrip {
                solutionStrip
            } else if result == nil {
                Text(PuzzleStrings.streakHint(engine.userIsWhite))
                    .font(Theme.nunito(PuzzleStreakSolver.hintSize, .medium))
                    .foregroundStyle(PuzzlePalette.textSecondary)
            }
        }
        .padding(.horizontal, PuzzleStreakSolver.bottomPaddingH)
    }

    @ViewBuilder
    private var promotion: some View {
        if engine.pendingPromotion != nil, let s = engine.session {
            PuzzlePromotionOverlay(color: s.userColor, mode: engine.mode) {
                engine.choosePromotion($0)
            }
        }
    }

    /// The failure overlay. The badge reads `result.isNewBest` and nothing else — one source of
    /// truth, so no inline comparison can disagree with it.
    @ViewBuilder
    private var resultOverlay: some View {
        if let r = result {
            ZStack {
                PuzzleStreakSolver.overlayScrim.ignoresSafeArea()
                VStack(spacing: PuzzleStreakSolver.boxGap) {
                    Text(PuzzleStrings.streakGameOver)
                        .font(Theme.nunito(PuzzleStreakSolver.resultHeaderSize, .bold))
                        .foregroundStyle(PuzzlePalette.wrong)
                    Text(PuzzleStrings.streakRunScore(finalStreak))
                        .font(Theme.nunito(PuzzleStreakSolver.resultNumberSize, .bold))
                        .foregroundStyle(PuzzleStreakHome.badgeFill)
                    Text(PuzzleStrings.streakBestLine(r.best))
                        .font(Theme.nunito(PuzzleStreakSolver.resultBestSize, .regular))
                        .foregroundStyle(PuzzlePalette.textSecondary)
                    if r.isNewBest {
                        Text(PuzzleStrings.streakNewBest)
                            .font(Theme.nunito(PuzzleStreakSolver.newBestSize, .bold))
                            .foregroundStyle(PuzzlePalette.gold)
                            .padding(.horizontal, PuzzleStreakSolver.newBestPaddingH)
                            .padding(.vertical, PuzzleStreakSolver.newBestPaddingV)
                            .background(PuzzleStreakSolver.newBestFill,
                                        in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.newBestRadius))
                            .overlay(RoundedRectangle(cornerRadius: PuzzleStreakSolver.newBestRadius)
                                .stroke(PuzzlePalette.gold,
                                        lineWidth: PuzzleStreakSolver.newBestBorder))
                    }
                    // Navy on gold, not white on gold: `.pzks-btn-gold { color: var(--pz-on-gold) }`
                    // (app.css:1614). The browser was rendering it white too, because the streak
                    // root never set `--pz-on-gold` — both sides are corrected together.
                    overlayButton(PuzzleStrings.streakShowSolution, PuzzlePalette.gold,
                                  text: PuzzlePalette.onGold) {
                        reveal()
                    }
                    overlayButton(PuzzleStrings.streakPlayAgain, PuzzleStreakHome.badgeFill) {
                        playAgain()
                    }
                    Button { engine.leave(); onExit() } label: {
                        Text(PuzzleStrings.streakBackToMenu)
                            .font(Theme.nunito(PuzzleStreakSolver.backToMenuSize, .regular))
                            .foregroundStyle(PuzzlePalette.textSecondary)
                            .padding(.top, PuzzleStreakSolver.backToMenuMarginTop)
                            .padding(.vertical, PuzzleStreakSolver.backToMenuPaddingV)
                    }
                    .buttonStyle(PuzzlePressStyle())
                }
                .padding(PuzzleStreakSolver.boxPadding)
                .background(PuzzlePalette.card,
                            in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.boxRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleStreakSolver.boxRadius)
                    .stroke(PuzzleStreakSolver.boxBorderColor,
                            lineWidth: PuzzleStreakSolver.boxBorder))
                .padding(.horizontal, PuzzleStreakSolver.overlayPaddingH)
            }
        }
    }

    private func overlayButton(_ title: String, _ fill: Color, text: Color = .white,
                               _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.nunito(PuzzleStreakSolver.btnSize, .bold))
                .foregroundStyle(text)
                .padding(.horizontal, PuzzleStreakSolver.btnPaddingH)
                .padding(.vertical, PuzzleStreakSolver.btnPaddingV)
                .background(fill,
                            in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.btnRadius))
        }
        .buttonStyle(PuzzlePressStyle())
    }

    /// The revealed move, printed `E2 → E4` over a two-toned board highlight.
    private var solutionStrip: some View {
        VStack(spacing: PuzzleStreakSolver.stripGap) {
            VStack(spacing: 0) {
                Text(PuzzleStrings.streakCorrectMove)
                    .font(Theme.nunito(PuzzleStreakSolver.stripLabelSize, .bold))
                    .tracking(PuzzleStreakSolver.stripLabelLetterSpacing)
                    .foregroundStyle(PuzzleStreakSolver.stripLabelColor)
                Text(PuzzleRunDate.solutionMove(engine.expectedUci))
                    .font(Theme.nunito(PuzzleStreakSolver.stripMoveSize, .bold))
                    .tracking(PuzzleStreakSolver.stripMoveLetterSpacing)
                    .foregroundStyle(PuzzlePalette.gold)
            }
            HStack(spacing: PuzzleStreakSolver.stripButtonsGap) {
                stripButton(PuzzleStrings.streakStripMenu, PuzzleStreakSolver.stripMenuFill) {
                    engine.leave(); onExit()
                }
                stripButton(PuzzleStrings.streakStripPlayAgain, PuzzleStreakHome.badgeFill) {
                    playAgain()
                }
            }
        }
        .padding(.horizontal, PuzzleStreakSolver.stripPaddingH)
        .padding(.vertical, PuzzleStreakSolver.stripPaddingV)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.stripRadius))
        .overlay(RoundedRectangle(cornerRadius: PuzzleStreakSolver.stripRadius)
            .stroke(PuzzleStreakSolver.stripBorderColor, lineWidth: PuzzleStreakSolver.stripBorder))
    }

    private func stripButton(_ title: String, _ fill: Color,
                             _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.nunito(PuzzleStreakSolver.stripBtnSize, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PuzzleStreakSolver.stripBtnPaddingV)
                .background(fill,
                            in: RoundedRectangle(cornerRadius: PuzzleStreakSolver.stripBtnRadius))
        }
        .buttonStyle(PuzzlePressStyle())
    }

    // MARK: - Flow

    private func start() {
        guard engine.session == nil else { return }
        bestBefore = store.state.streak.bestStreak
        engine.onSolved = { _ in solved() }
        engine.onWrong = { _ in failed() }
        serve(entering: true)
    }

    /// Part 22.6 — the anti-reroll lock.
    ///
    /// On ENTRY the pending puzzle is read before anything is served, so leaving the screen and
    /// coming back hands back the identical puzzle. Without it, backing out is a free reroll of a
    /// hard one.
    private func serve(entering: Bool) {
        if entering, let locked = PuzzleProgress.pendingStreakPuzzle(store.state),
           let p = store.puzzle(id: locked) {
            engine.mount(p)
            return
        }
        let target = PuzzleProgress.streakTarget(store.state)
        guard let p = store.serveStreak(targetRating: target.rating, theme: target.theme) else {
            return
        }
        store.mutate { s in PuzzleProgress.lockStreakPuzzle(&s, puzzleId: p.id) }
        engine.mount(p)
    }

    /// No sound here. In a streak the reward is the next puzzle appearing — `game-over` fires on
    /// failure instead, which is what the source does.
    ///
    /// The next puzzle is served FIRST so its id can become the lock in the same step the streak
    /// increments; that pairing is what `recordStreakSolve(nextPuzzleId:)` exists for.
    private func solved() {
        let after = StreakEngine.increment(store.state.streak, nextPuzzleId: nil)
        let target = StreakEngine.target(currentStreak: after.currentStreak,
                                         puzzleRating: after.puzzleRating)
        let next = store.serveStreak(targetRating: target.rating, theme: target.theme)
        store.mutate { s in
            PuzzleProgress.recordStreakSolve(&s, nextPuzzleId: next?.id,
                                             now: PuzzleHubStore.nowMs())
        }
        guard let next else { return }
        engine.mount(next)
    }

    private func failed() {
        finalStreak = store.state.streak.currentStreak
        result = store.mutate { s in
            PuzzleProgress.endStreakRun(&s, length: finalStreak, bestBefore: bestBefore,
                                        now: PuzzleHubStore.nowMs())
        }
    }

    /// "Show Solution" hides the overlay entirely and reveals the move on the board.
    private func reveal() {
        engine.highlightSolution(engine.expectedUci)
        showStrip = true
    }

    private func playAgain() {
        result = nil
        showStrip = false
        engine.highlightSolution(nil)
        bestBefore = store.state.streak.bestStreak
        serve(entering: false)
    }
}

/// Formatting the run lists and the revealed move share.
enum PuzzleRunDate {
    /// "Today" / "Yesterday" / "Mar 12".
    static func relative(_ ms: Int, now: Int) -> String {
        let day = PuzzleProgress.dayNumber(PuzzleProgress.dayKey(ms))
        let today = PuzzleProgress.dayNumber(PuzzleProgress.dayKey(now))
        if day == today { return PuzzleStrings.today }
        if day == today - 1 { return PuzzleStrings.yesterday }
        let f = DateFormatter()
        f.dateFormat = PuzzleStrings.runDateFormat
        return f.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    /// `E2 → E4`, with ` (=Q)` when the UCI carries a promotion.
    static func solutionMove(_ uci: String?) -> String {
        guard let uci, uci.count >= 4 else { return "" }
        let from = String(uci.prefix(2)).uppercased()
        let to = String(uci.dropFirst(2).prefix(2)).uppercased()
        var out = from + PuzzleStrings.moveArrow + to
        if uci.count > 4 {
            out += PuzzleStrings.promotionSuffixOpen
                + String(uci.dropFirst(4).prefix(1)).uppercased()
                + PuzzleStrings.promotionSuffixClose
        }
        return out
    }
}
