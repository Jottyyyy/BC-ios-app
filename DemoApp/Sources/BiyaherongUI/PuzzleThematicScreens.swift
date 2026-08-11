import SwiftUI
import BiyaherongCoachCore

// Thematic Puzzles (Part 12). Practice by tactic, and **not rated** — solving here moves no Elo,
// though it still counts toward Theme Performance and the daily goal.

/// Part 12.2 — twelve themes in a 3×4 grid, then Start.
struct PuzzleThematicGridScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let onStart: (String) -> Void
    let onExit: () -> Void

    @State private var selected: String?

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: PuzzleThematicGrid.gridGap),
              count: PuzzleThematicGrid.cols)
    }

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: PuzzleStrings.thematicTitle,
                               titleSize: PuzzleType.thematicTitle, onBack: onExit)
            badgeRow
            Text(PuzzleStrings.thematicChoose)
                .font(Theme.nunito(PuzzleType.thematicSection, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, PuzzleThematicGrid.sectionLabelPaddingH)
                .padding(.bottom, PuzzleThematicGrid.sectionLabelMarginBottom)
            ScrollView {
                LazyVGrid(columns: columns, spacing: PuzzleThematicGrid.gridRowGap) {
                    ForEach(PuzzleThematicGrid.themes) { theme in
                        // Tapping the SELECTED card deselects it (Part 12.2), which is why this
                        // is a toggle rather than an assignment.
                        Button { selected = (selected == theme.id) ? nil : theme.id } label: {
                            card(theme)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, PuzzleThematicGrid.gridPaddingH)
                .padding(.bottom, PuzzleThematicGrid.gridPaddingBottom)
            }
            startButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
    }

    private var badgeRow: some View {
        HStack(spacing: PuzzleThematicGrid.badgeRowGap) {
            Text(PuzzleStrings.thematicBadge)
                .font(Theme.nunito(PuzzleType.thematicBadge, .bold))
                .tracking(PuzzleThematicGrid.badgeLetterSpacing)
                .foregroundStyle(.white)
                .padding(.horizontal, PuzzleThematicGrid.badgePaddingH)
                .padding(.vertical, PuzzleThematicGrid.badgePaddingV)
                .background(PuzzlePalette.thematicPurple,
                            in: RoundedRectangle(cornerRadius: PuzzleThematicGrid.badgeRadius))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, PuzzleThematicGrid.headerPaddingH)
        .padding(.bottom, PuzzleThematicGrid.badgeRowMarginBottom)
    }

    private func card(_ theme: PuzzleThematicGrid.Theme) -> some View {
        Text(theme.label)
            .font(Theme.nunito(PuzzleType.thematicCard, .semiBold))
            .foregroundStyle(PuzzlePalette.textPrimary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(PuzzleThematicGrid.cardPadding)
            // Selected takes the theme's full colour; unselected stays on the card fill with the
            // colour only as its border. The source has no dimmed middle state.
            .background(selected == theme.id ? theme.color : PuzzlePalette.card,
                        in: RoundedRectangle(cornerRadius: PuzzleThematicGrid.cardRadius))
            .overlay(RoundedRectangle(cornerRadius: PuzzleThematicGrid.cardRadius)
                .stroke(theme.color, lineWidth: PuzzleThematicGrid.cardBorder))
    }

    /// Disabled until a theme is picked — the source dims it rather than hiding it, so the button
    /// keeps its place and the screen does not jump.
    private var startButton: some View {
        Button { if let selected { onStart(selected) } } label: {
            Text(selected == nil ? PuzzleStrings.thematicSelectPrompt
                                 : PuzzleStrings.thematicStart(label(of: selected)))
                .font(Theme.nunito(PuzzleType.thematicStart, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PuzzleThematicGrid.startPaddingV)
                .background(selected == nil ? PuzzleThematicGrid.startDisabledFill
                                            : PuzzlePalette.thematicPurple,
                            in: RoundedRectangle(cornerRadius: PuzzleThematicGrid.startRadius))
                .opacity(selected == nil ? PuzzleThematicGrid.startDisabledOpacity : 1)
        }
        .buttonStyle(.plain)
        .disabled(selected == nil)
        .padding(.horizontal, PuzzleThematicGrid.startMarginH)
        .padding(.bottom, PuzzleThematicGrid.startMarginBottom)
    }

    private func label(of id: String?) -> String {
        PuzzleThematicGrid.themes.first { $0.id == id }?.label ?? ""
    }
}

/// Part 12.3 — the thematic solver. A stats bar, two engine lines, and no rating.
struct PuzzleThematicSolverScreen: View {
    @ObservedObject var store: PuzzleHubStore
    let theme: String
    let onExit: () -> Void

    @StateObject private var engine = PuzzleSolverEngine(mode: .thematic)
    @State private var solvedThisSession = 0
    @State private var feedback: Bool?
    @State private var dry = false

    var body: some View {
        VStack(spacing: 0) {
            PuzzleScreenHeader(title: themeLabel,
                               subtitle: PuzzleStrings.thematicSolved(solvedThisSession),
                               titleSize: PuzzleType.thematicSolverTitle,
                               onBack: { engine.leave(); onExit() })
            statsBar
            PuzzleBoardBand(engine: engine)
            hint
            feedbackBanner
            if dry {
                Text(PuzzleStrings.thematicDry)
                    .font(Theme.nunito(PuzzleThematicSolver.feedbackTextSize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .padding(.top, PuzzleThematicSolver.feedbackMarginBottom)
            }
            PuzzleBottomPanel(engine: engine, onNext: next)
            if PuzzleDisplay.hasEnginePanel(engine.mode) { PuzzleEnginePanelView(engine: engine) }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PuzzlePalette.screenBg)
        .overlay { promotion }
        .onAppear(perform: start)
        .onDisappear { engine.leave() }
    }

    private var themeLabel: String {
        PuzzleThematicGrid.themes.first { $0.id == theme }?.label ?? theme
    }

    @ViewBuilder
    private var promotion: some View {
        if engine.pendingPromotion != nil, let s = engine.session {
            PuzzlePromotionOverlay(color: s.userColor, mode: engine.mode) {
                engine.choosePromotion($0)
            }
        }
    }

    /// One stat: the puzzle rating. Deliberately **not** the player's — Thematic moves no Elo, so
    /// showing a personal rating here would imply it does.
    private var statsBar: some View {
        VStack(spacing: PuzzleThematicSolver.statLabelMarginBottom) {
            Text(PuzzleStrings.thematicRating)
                .font(Theme.nunito(PuzzleThematicSolver.statLabelSize, .regular))
                .tracking(PuzzleThematicSolver.statLabelLetterSpacing)
                .foregroundStyle(PuzzlePalette.textSecondary)
            Text("\(engine.puzzle?.rating ?? store.state.profile.rating)")
                .font(Theme.nunito(PuzzleThematicSolver.statValueSize, .bold))
                .foregroundStyle(PuzzlePalette.gold)
        }
        .frame(maxWidth: .infinity)
        .padding(PuzzleThematicSolver.statsPadding)
        .background(PuzzlePalette.card,
                    in: RoundedRectangle(cornerRadius: PuzzleThematicSolver.statsRadius))
        .shadow(color: .black.opacity(PuzzleThematicSolver.statsShadowOpacity),
                radius: PuzzleThematicSolver.statsShadowRadius,
                y: PuzzleThematicSolver.statsShadowY)
        .padding(.horizontal, PuzzleThematicSolver.statsMarginH)
        .padding(.top, PuzzleThematicSolver.statsMarginTop)
        .padding(.bottom, PuzzleThematicSolver.statsMarginBottom)
    }

    private var hint: some View {
        Text(engine.userIsWhite ? PuzzleStrings.thematicHintWhite : PuzzleStrings.thematicHintBlack)
            .font(Theme.nunito(PuzzleThematicSolver.hintSize, .regular))
            .foregroundStyle(PuzzlePalette.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, PuzzleThematicSolver.hintMarginH)
            .padding(.vertical, PuzzleThematicSolver.hintPaddingV)
    }

    @ViewBuilder
    private var feedbackBanner: some View {
        if let ok = feedback {
            Text(ok ? PuzzleStrings.thematicWin : PuzzleStrings.thematicMiss)
                .font(Theme.nunito(PuzzleThematicSolver.feedbackTextSize, .bold))
                .foregroundStyle(PuzzlePalette.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(PuzzleThematicSolver.feedbackPadding)
                .background(ok ? PuzzleThematicSolver.feedbackCorrectFill
                               : PuzzleThematicSolver.feedbackWrongFill,
                            in: RoundedRectangle(cornerRadius: PuzzleThematicSolver.feedbackRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleThematicSolver.feedbackRadius)
                    .stroke(ok ? PuzzleThematicSolver.feedbackCorrectBorder
                               : PuzzleThematicSolver.feedbackWrongBorder,
                            lineWidth: PuzzleThematicGrid.cardBorder))
                .padding(.horizontal, PuzzleThematicSolver.feedbackMarginH)
                .padding(.bottom, PuzzleThematicSolver.feedbackMarginBottom)
        }
    }

    private func start() {
        guard engine.session == nil else { return }
        engine.onSolved = { _ in finish(correct: true) }
        engine.onWrong = { _ in finish(correct: false) }
        next()
    }

    private func next() {
        feedback = nil
        guard let p = store.serveThematic(theme: theme) else { dry = true; return }
        dry = false
        engine.mount(p)
    }

    /// `recordThematicAttempt`, **not** `recordRatedAttempt`. Theme Performance and the daily goal
    /// both move; Elo does not, and the screen test asserts this file never calls the rated one.
    private func finish(correct: Bool) {
        feedback = correct
        if correct { solvedThisSession += 1 }
        guard let p = engine.puzzle else { return }
        store.mutate { s in
            PuzzleProgress.recordThematicAttempt(&s, themes: p.themes, isCorrect: correct,
                                                 now: PuzzleHubStore.nowMs())
        }
    }
}
