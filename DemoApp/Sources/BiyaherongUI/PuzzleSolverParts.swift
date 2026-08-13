import SwiftUI
import BiyaherongCoachCore

/// The solver plumbing every puzzle mode shares — the Swift twin of `web-demo/js/puzzle-board.js`.
///
/// Part 1 of the spec: *"Every solver screen shares the same board, the same move-validation core,
/// and the same promotion dialog. Build that core once and configure it per mode — do not write
/// five solvers."*
///
/// The validation core already is once: `PuzzleSession` in the Core. What was still going to be
/// duplicated five times is the SCREEN plumbing — holding the session, running the mount sequence
/// with the mode's opponent delay, pumping submit → opponent reply → finish, and cancelling every
/// timer on the way out. This is that, and nothing else.
///
/// ## What it deliberately does not own
/// Chrome. No header, no stats row, no banner, no result overlay, no buttons — those are what
/// genuinely differ between the five modes, and the RN source has five separate solver files for
/// exactly that reason. Each screen supplies its own and receives callbacks.
@MainActor
final class PuzzleSolverEngine: ObservableObject {

    @Published private(set) var session: PuzzleSession.State?
    @Published private(set) var puzzle: PuzzleStore.Puzzle?
    /// Set when a promotion is pending; the screen shows `PuzzlePromotionOverlay` on it.
    @Published var pendingPromotion: (from: String, to: String)?
    @Published private(set) var solutionHighlight: [Int: Color] = [:]
    /// Tap-to-move state. Without these the board only accepted drags, showed no legal-move dots
    /// and highlighted no selection — the whole tap path was missing, which on a phone is the way
    /// most people actually move a piece.
    @Published private(set) var selected: Int?
    @Published private(set) var legalTargets: Set<Int> = []
    /// Engine suggestions, shown after a Solution reveal on the two modes that have a panel.
    /// `EngineRow` is the Analysis Board's own row type — same panel, same shape, one definition.
    @Published private(set) var engineLines: [EngineRow] = []
    @Published private(set) var engineBusy = false

    let mode: PuzzleSession.Mode

    /// Fired after the outcome has been applied, so a screen repaints from `session` rather than
    /// from anything the callback carries.
    var onCorrect: ((PuzzleSession.Correct) -> Void)?
    var onSolved: ((PuzzleSession.Correct) -> Void)?
    var onWrong: ((PuzzleSession.Wrong) -> Void)?

    /// Every scheduled continuation, so leaving cancels all of them. A stray opponent reply landing
    /// on the next screen is the bug this exists to prevent.
    private var tasks: [Task<Void, Never>] = []
    /// Bumped on every new search so a late progress hop from an abandoned one is dropped.
    private var engineToken = 0
    private var alive = true

    init(mode: PuzzleSession.Mode) { self.mode = mode }

    // MARK: - Mount

    /// Every mode's mount is identical (Part 5.3); only the opponent delay differs.
    func mount(_ p: PuzzleStore.Puzzle) {
        cancel()
        alive = true
        puzzle = p
        session = PuzzleSession.create(puzzle: p.session, mode: mode)
        deselect()
        solutionHighlight = [:]
        play(.gameStart)
        after(PuzzleSession.opponentDelayMs(mode)) { [weak self] in
            guard let self, var s = self.session else { return }
            let r = s.applySetupMove()
            self.session = s
            self.play(r.sound)
        }
    }

    // MARK: - Submit
    //
    // `BoardView` speaks square indices and the Core speaks names, so the conversion lives here —
    // once, rather than in each of the five screens.

    /// Part 5.4, pumped. The screen never sees a raw move, only the outcome.
    func submit(from: Int, to: Int, promotion: PieceKind? = nil) {
        guard let a = squareName(from), let b = squareName(to) else { return }
        submit(from: a, to: b, promotion: promotion)
    }

    func submit(from: String, to: String, promotion: PieceKind? = nil) {
        guard var s = session else { return }
        if promotion == nil, s.needsPromotion(from: from, to: to) {
            pendingPromotion = (from, to)
            return
        }
        let out = s.submit(from: from, to: to, promotion: promotion)
        session = s
        deselect()
        switch out {
        case .illegal, .ignored:
            return
        case .freePlay(let sound, _):
            play(sound)
        case .correct(let c):
            play(c.sound)
            onCorrect?(c)
            if c.solved { onSolved?(c); return }
            after(c.opponentReplyAfterMs ?? 0) { [weak self] in
                guard let self, var s2 = self.session else { return }
                let r = s2.applyOpponentReply()
                self.session = s2
                self.play(r.sound)
                if r.solved {
                    self.after(r.solvedAfterMs ?? 0) { [weak self] in self?.onSolved?(c) }
                }
            }
        case .wrong(let w):
            // The policy travels with the outcome. The screen decides what to DRAW; it does not
            // decide the rules — whether the board snaps back, whether the run ends and whether a
            // life is spent all come from `w.policy`.
            play(w.sound)
            onWrong?(w)
        }
    }

    /// Tap-to-move, the same shape as `ChessGameVM.tap` (PlayView.swift:75): tap a piece to
    /// select it, tap it again to deselect, tap a legal target to move, tap another of your own
    /// pieces to switch selection.
    ///
    /// Promotion is not special-cased here — `submit` already raises `pendingPromotion` when the
    /// move needs a piece, so both input paths go through one decision.
    func tap(_ sq: Int) {
        guard interactive, let s = session else { return }
        if let sel = selected {
            if sq == sel { deselect(); return }
            if legalTargets.contains(sq) {
                deselect()
                submit(from: sel, to: sq)
                return
            }
            selectPiece(sq, in: s)
            return
        }
        selectPiece(sq, in: s)
    }

    private func selectPiece(_ sq: Int, in s: PuzzleSession.State) {
        guard let p = s.position.squares[sq], p.color == s.position.sideToMove else {
            deselect()
            return
        }
        selected = sq
        legalTargets = Set(s.position.legalMoves(from: sq).map { $0.to })
    }

    private func deselect() {
        selected = nil
        legalTargets = []
    }

    func choosePromotion(_ kind: PieceKind) {
        guard let p = pendingPromotion else { return }
        pendingPromotion = nil
        submit(from: p.from, to: p.to, promotion: kind)
    }

    func retry() {
        guard var s = session else { return }
        let r = s.retry()
        deselect()
        session = s
        cancel()
        alive = true
        play(r.sound)
        after(r.setupAfterMs) { [weak self] in
            guard let self, var s2 = self.session else { return }
            let out = s2.applySetupMove()
            self.session = s2
            self.play(out.sound)
        }
    }

    @discardableResult
    func revealSolution() -> PuzzleSession.RevealResult? {
        guard var s = session else { return nil }
        let r = s.revealSolution()
        session = s
        // The reveal result says whether this mode wants an engine run — Play and Thematic do,
        // the other three have no panel to put it in.
        if r.runEngine { runEngine() }
        return r
    }

    /// Analyse the current position for the suggestions panel.
    ///
    /// Detached, for the reason `AnalysisVM` documents at its own call site: the engine blocks its
    /// thread and never yields, so running it on the main actor would freeze the board. Progress
    /// hops back per completed depth so lines appear as they are found.
    func runEngine() {
        guard let s = session else { return }
        let position = s.position
        let deadline = Date().addingTimeInterval(PuzzleSolverVM.engineDeadlineSeconds)
        engineBusy = true
        engineLines = []
        let token = engineToken + 1
        engineToken = token
        Task.detached(priority: .userInitiated) { [weak self] in
            let local = LocalEngine()
            _ = local.analyze(
                position,
                // `SearchLimits`, not `EngineLimits` — there is no such type, and this line has
                // never compiled. The puzzle hint panel keeps the DEFAULT limits deliberately: the
                // Analysis Board's preset is that screen's setting, not this one's, and the hint
                // here already has its own 3 s budget.
                limits: SearchLimits(maxDepth: AnalysisEngineLimits.maxDepth,
                                     multiPV: AnalysisEngineLimits.multiPV),
                historyKeys: [],
                shouldCancel: { Date() > deadline },
                onProgress: { snap in
                    Task { @MainActor in
                        guard let self, self.engineToken == token else { return }
                        self.adoptEngine(snap)
                    }
                })
            await MainActor.run {
                guard let self, self.engineToken == token else { return }
                self.engineBusy = false
            }
        }
    }

    /// `AnalysisSession.engineRows(from:)` already turns a snapshot into panel rows — eval text,
    /// SAN and the PV preview — so this reuses it rather than re-deriving the same three.
    ///
    /// The count is trimmed per mode: Play shows three lines and Thematic two, and
    /// `PuzzleDisplay.engineLineCount` is what knows which.
    @MainActor
    private func adoptEngine(_ snapshot: AnalysisSnapshot) {
        engineLines = Array(AnalysisSession.engineRows(from: snapshot)
            .prefix(PuzzleDisplay.engineLineCount(mode)))
    }

    /// Part 13.3's two-toned reveal: the from-square dimmer than the to-square, so the move reads
    /// as a direction rather than a pair. Rendered through `BoardView.customHighlights` — the
    /// board itself needs no change for it.
    func highlightSolution(_ uci: String?) {
        guard let uci, uci.count >= 4,
              let from = Square.index(String(uci.prefix(2))),
              let to = Square.index(String(uci.dropFirst(2).prefix(2))) else {
            solutionHighlight = [:]
            return
        }
        solutionHighlight = [from: PuzzleStreakSolver.solutionFromTint,
                             to: PuzzleStreakSolver.solutionToTint]
    }

    /// The move the solver is waiting for, in UCI — what the reveal highlights and prints.
    var expectedUci: String? {
        guard let s = session, s.moveIndex < s.puzzle.moves.count else { return nil }
        return s.puzzle.moves[s.moveIndex]
    }

    // MARK: - Board inputs

    var userIsWhite: Bool { session?.userColor == .white }

    var pieces: [BoardPiece] {
        guard let s = session else { return [] }
        return piecesFrom(s.position)
    }

    /// The last move as the board wants it. The session stores square NAMES; `BoardView` takes a
    /// `Move`, so the conversion lives here rather than at the call site — which previously just
    /// passed `nil` and so never highlighted anything.
    var lastMove: Move? {
        guard let lm = session?.lastMove,
              let f = Square.index(lm.from), let t = Square.index(lm.to) else { return nil }
        return Move(from: f, to: t, promotion: nil)
    }

    var checkSquare: Int? {
        guard let s = session else { return nil }
        let st = s.position.status()
        return (st == .check || st == .checkmate) ? s.position.kingSquare(s.position.sideToMove)
                                                  : nil
    }

    /// Locked to the solver's colour while playing; unlocked for two-sided play once the answer is
    /// out (Part 6.5).
    var interactive: Bool {
        guard let s = session else { return false }
        return s.phase == .playing || s.phase == .reviewing
    }

    private func squareName(_ i: Int) -> String? {
        (i >= 0 && i < 64) ? Square.name(i) : nil
    }

    // MARK: - Timers and teardown

    private func after(_ ms: Int, _ body: @escaping @MainActor () -> Void) {
        guard ms > 0 else { body(); return }
        let t = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
            guard let self, self.alive, !Task.isCancelled else { return }
            body()
        }
        tasks.append(t)
    }

    /// Exposed because Turbo's advance delay arrives in the wrong-move outcome but is scheduled by
    /// the screen. A screen-owned task would survive `leave()`, so a stray advance could mount a
    /// puzzle behind an already-showing results overlay.
    func schedule(_ ms: Int, _ body: @escaping @MainActor () -> Void) { after(ms, body) }

    func cancel() {
        tasks.forEach { $0.cancel() }
        tasks.removeAll()
    }

    /// Cancel, and refuse to fire anything further — a solver that has left the screen.
    func leave() {
        alive = false
        engineToken += 1          // abandon any search in flight
        engineBusy = false
        cancel()
    }

    /// The Core names its sounds and `PuzzleSounds` maps them to files. Deliberately NOT
    /// `SoundManager.playMove`, whose checkmate/check/castle chain belongs to the Play screen —
    /// the puzzle path is capture-or-move and nothing else (Part 16).
    private func play(_ sound: PuzzleSession.Sound?) {
        guard let sound else { return }
        SoundManager.shared.play(sound.rawValue)
    }
}

// MARK: - Shared chrome

/// The header every pushed puzzle screen wears: a back control, a title, and whatever the screen
/// wants on the right.
struct PuzzleScreenHeader<Trailing: View>: View {
    let title: String
    let subtitle: String?
    /// Passed in rather than assumed: each screen has its own title size in the extraction, and
    /// picking one here would silently restyle four screens to match a fifth.
    let titleSize: CGFloat
    let onBack: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: PuzzleSolverStyle.backIconSize, weight: .semibold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .frame(width: PuzzleSolverStyle.backBtnW, height: PuzzleSolverStyle.backBtnH)
            }
            .buttonStyle(PuzzlePressStyle())
            VStack(spacing: PuzzleDailySolver.headerSubMarginTop) {
                Text(title)
                    .font(Theme.nunito(titleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.nunito(PuzzleType.dailyHeroSub, .regular))
                        .foregroundStyle(PuzzlePalette.textSecondary)
                        .frame(maxWidth: PuzzleDailySolver.headerSubMaxWidth)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            trailing()
                .frame(minWidth: PuzzleSolverStyle.spacerW)
        }
        .padding(.horizontal, PuzzleSolverStyle.headerPaddingH)
        .padding(.vertical, PuzzleSolverStyle.headerPaddingV)
    }
}

extension PuzzleScreenHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, titleSize: CGFloat,
         onBack: @escaping () -> Void) {
        self.init(title: title, subtitle: subtitle, titleSize: titleSize, onBack: onBack,
                  trailing: { EmptyView() })
    }
}

/// The board band, sized to the width it is given, with the solver's highlights applied.
struct PuzzleBoardBand: View {
    @ObservedObject var engine: PuzzleSolverEngine
    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            BoardView(pieces: engine.pieces,
                      selected: engine.selected,
                      legalTargets: engine.legalTargets,
                      lastMove: engine.lastMove,
                      flipped: engine.session?.flipped ?? false,
                      checkSquare: engine.checkSquare,
                      boardSize: side,
                      onTap: { sq in
                          guard engine.interactive else { return }
                          Haptics.play(.pickUp)
                          engine.tap(sq)
                      },
                      customHighlights: engine.solutionHighlight,
                      onDragMove: { from, to in
                          guard engine.interactive else { return }
                          Haptics.play(.pickUp)
                          engine.submit(from: from, to: to)
                      })
                .frame(width: side, height: side)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// The bottom button row, from `PuzzleDisplay.bottomPanel(_:mode:)`.
///
/// The view asks which buttons to show; it does not decide. That matters because the answer is
/// derived from `WRONG_POLICY` — Streak and Turbo forbid Retry, and Daily has no Solution — and a
/// screen restating those rules is how the two came to disagree in Phase D.
struct PuzzleBottomPanel: View {
    @ObservedObject var engine: PuzzleSolverEngine
    let onNext: () -> Void
    /// Streak's strip replaces this panel entirely, so it can opt out.
    var onSolution: (() -> Void)?

    var body: some View {
        let panel = PuzzleDisplay.bottomPanel(engine.session?.phase ?? .loading, mode: engine.mode)
        Group {
            if panel.row {
                HStack(spacing: PuzzleSolverStyle.wrongRowGap) {
                    ForEach(panel.buttons, id: \.rawValue) { button($0) }
                }
            } else {
                VStack(spacing: PuzzleSolverStyle.wrongRowGap) {
                    ForEach(panel.buttons, id: \.rawValue) { button($0) }
                }
            }
        }
        .padding(.horizontal, PuzzleSolverStyle.bottomPaddingH)
        .padding(.top, PuzzleSolverStyle.bottomPaddingTop)
    }

    @ViewBuilder
    private func button(_ kind: PuzzleDisplay.PanelButton) -> some View {
        switch kind {
        case .retry:
            action(PuzzleStrings.retry, fill: nil) { engine.retry() }
        case .solution, .solutionBtn:
            action(PuzzleStrings.solutionBtn, fill: PuzzlePalette.gold) {
                engine.revealSolution()
                onSolution?()
            }
        case .next:
            action(PuzzleStrings.nextPuzzle, fill: PuzzlePalette.correct, wide: false, action: onNext)
        case .engine, .save:
            // Owned by the engine panel and the Save sheet, which are separate views.
            EmptyView()
        }
    }

    private func action(_ title: String, fill: Color?, wide: Bool = true,
                        action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.nunito(PuzzleType.solverButton, .bold))
                .foregroundStyle(fill == nil ? PuzzlePalette.textPrimary : .white)
                .frame(maxWidth: wide ? .infinity : nil)
                .padding(.horizontal, wide ? 0 : PuzzleSolverStyle.nextPaddingH)
                .padding(.vertical, PuzzleSolverStyle.retryPaddingV)
                .background(fill ?? PuzzlePalette.cardAlt,
                            in: RoundedRectangle(cornerRadius: PuzzleSolverStyle.retryRadius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleSolverStyle.retryRadius)
                    .stroke(fill == nil ? PuzzleSolverStyle.retryBorderColor : .clear,
                            lineWidth: PuzzleSolverStyle.retryBorder))
        }
        .buttonStyle(PuzzlePressStyle())
    }
}

/// The engine suggestions panel — Play and Thematic only, and `PuzzleDisplay` decides which.
///
/// Shown after the solution is revealed. The line count differs by mode (`engineLineCount`), which
/// is why it is asked for rather than assumed.
struct PuzzleEnginePanelView: View {
    @ObservedObject var engine: PuzzleSolverEngine

    var body: some View {
        let lines = engine.engineLines
        Group {
            if !lines.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text(PuzzleStrings.engineSuggestions)
                        .font(Theme.nunito(PuzzleEnginePanel.titleSize, .bold))
                        .foregroundStyle(PuzzlePalette.textPrimary)
                        .padding(.bottom, PuzzleEnginePanel.headerMarginBottom)
                    ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                        HStack(spacing: PuzzleEnginePanel.rowGap) {
                            Circle()
                                .fill(PuzzlePalette.gold)
                                .frame(width: PuzzleEnginePanel.dotSize,
                                       height: PuzzleEnginePanel.dotSize)
                            Text(line.san)
                                .font(Theme.nunito(PuzzleEnginePanel.sanSize, .bold))
                                .foregroundStyle(PuzzlePalette.textPrimary)
                                .frame(width: PuzzleEnginePanel.sanWidth, alignment: .leading)
                            Text(line.evalText)
                                .font(Theme.nunito(PuzzleEnginePanel.evalSize, .regular))
                                .foregroundStyle(PuzzlePalette.textSecondary)
                                .frame(width: PuzzleEnginePanel.evalWidth, alignment: .leading)
                            Text(line.continuation)
                                .font(Theme.nunito(PuzzleEnginePanel.pvSize, .regular))
                                .foregroundStyle(PuzzlePalette.textSecondary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, PuzzleEnginePanel.rowPaddingV)
                        .overlay(alignment: .top) {
                            if i > 0 {
                                PuzzleEnginePanel.rowBorderColor
                                    .frame(height: PuzzleEnginePanel.rowBorderWidth)
                            }
                        }
                    }
                }
                .padding(PuzzleEnginePanel.padding)
                .background(PuzzlePalette.card,
                            in: RoundedRectangle(cornerRadius: PuzzleEnginePanel.radius))
                .overlay(RoundedRectangle(cornerRadius: PuzzleEnginePanel.radius)
                    .stroke(PuzzleEnginePanel.borderColor,
                            lineWidth: PuzzleEnginePanel.borderWidth))
                .padding(.horizontal, PuzzleSolverStyle.bottomPaddingH)
                .padding(.top, PuzzleSolverStyle.bottomPaddingTop)
            }
        }
    }
}

/// The in-app confirmation both run modes use: Streak's resume prompt and Turbo's quit dialog.
///
/// One view because the two are the same dialog with different copy — a title, a body, and two
/// buttons where the destructive one sits on the left. Turbo's geometry is the extracted one
/// (`PuzzleTurboRun.modal*`); Streak's prompt is invented, so it borrows the same numbers rather
/// than inventing a second set.
struct PuzzleModal: View {
    let title: String
    let body: String
    let dangerTitle: String
    let keepTitle: String
    let onDanger: () -> Void
    let onKeep: () -> Void

    var body: some View {
        ZStack {
            PuzzleTurboRun.modalScrim.ignoresSafeArea()
            VStack(spacing: 0) {
                Text(title)
                    .font(Theme.nunito(PuzzleTurboRun.modalTitleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, PuzzleTurboRun.modalTitleMarginBottom)
                Text(body)
                    .font(Theme.nunito(PuzzleTurboRun.modalBodySize, .regular))
                    .foregroundStyle(PuzzlePalette.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(PuzzleTurboRun.modalBodyLineHeight)
                    .padding(.bottom, PuzzleTurboRun.modalBodyMarginBottom)
                HStack(spacing: PuzzleTurboRun.modalButtonsGap) {
                    modalButton(dangerTitle, PuzzleTurboRun.modalQuitFill, onDanger)
                    modalButton(keepTitle, PuzzleTurboRun.modalKeepFill, onKeep)
                }
            }
            .padding(PuzzleTurboRun.modalPadding)
            .frame(maxWidth: PuzzleTurboRun.modalWidth)
            .background(PuzzlePalette.card,
                        in: RoundedRectangle(cornerRadius: PuzzleTurboRun.modalRadius))
            .overlay(RoundedRectangle(cornerRadius: PuzzleTurboRun.modalRadius)
                .stroke(PuzzleTurboRun.modalBorderColor, lineWidth: PuzzleTurboRun.modalBorder))
        }
    }

    private func modalButton(_ title: String, _ fill: Color,
                             _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.nunito(PuzzleTurboRun.modalBtnSize, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PuzzleTurboRun.modalBtnPaddingV)
                .background(fill,
                            in: RoundedRectangle(cornerRadius: PuzzleTurboRun.modalBtnRadius))
        }
        .buttonStyle(PuzzlePressStyle())
    }
}

/// Press feedback for every puzzle button.
///
/// SwiftUI's `.plain` style is completely inert on press, so a tap gave no acknowledgement at all
/// — on a phone that reads as "did it register?" and people tap twice. The dim comes from
/// `PuzzleHub.pressOpacity`, which the extraction has always carried and nothing had ever read;
/// the scale is motion, which the RN StyleSheets cannot express and so is ours.
///
/// The web twin does the same thing in `app.css`'s polish layer.
struct PuzzlePressStyle: ButtonStyle {
    /// Cards are large, so they take a gentler squeeze than a button does.
    var scale: CGFloat = 0.975

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? PuzzleHub.pressOpacity : 1)
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.easeOut(duration: PuzzlePress.duration), value: configuration.isPressed)
    }
}

/// Motion timings. Not extracted — the RN source has no transitions at all — so they live in one
/// place rather than as numbers inside view bodies.
enum PuzzlePress {
    static let duration: Double = 0.12
    static let cardScale: CGFloat = 0.99
}
