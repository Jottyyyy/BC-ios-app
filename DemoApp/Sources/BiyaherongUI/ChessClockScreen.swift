import SwiftUI
import BiyaherongCoachCore
#if canImport(UIKit)
import UIKit
#endif

/// The Chess Clock — client round 3 (2026-10-22). Free for everyone, reached from Home.
///
/// Two halves facing each other, the top one turned 180° for the player across the table, and a
/// bar between them: close · reset · pause · time control · sound. Tap your own half after you
/// move. The state machine is `ChessClock` in the Core; this view only draws it and feeds it time.
///
/// ── Decisions a compiler cannot check, pinned by `tools/qa/chess_clock_check.js` §4 ──────────
/// - **Portrait, rotated, not landscape.** The top half is `.rotationEffect(.degrees(180))`, so
///   `OrientationGate` keeps its single writer (the video player) and nothing about rotation moves.
/// - **The tick publisher lives in `@State`.** As a `let` it is rebuilt with the struct and the
///   clock restarts its subscription on every redraw — the Puzzle Turbo bug from 1.0.10.
/// - **Time is `ProcessInfo.systemUptime`,** monotonic: a wall clock can jump (NTP, a time zone
///   change) and a jump would be charged to whoever's clock was running.
/// - **The screen stays awake only while the clock runs,** and is allowed to sleep again the
///   moment it stops, pauses, flags or the screen goes away.
/// - **Backgrounding pauses the game.** A clock that kept running behind a phone call loses a
///   game nobody was playing.
struct ChessClockScreen: View {
    @ObservedObject var prefs: ChessClockPrefs
    let onExit: () -> Void

    @State private var clock: ChessClock
    @State private var now: Int = ChessClockScreen.uptimeMs()
    @State private var tick = Timer.publish(every: ChessClockMetrics.tickSeconds, on: .main, in: .common)
        .autoconnect()
    @State private var editing = false
    @State private var confirmingReset = false
    @State private var flash: ClockFlash?
    @Environment(\.scenePhase) private var scenePhase

    /// The side just paid an increment, and when — "+3s" stays up for `bonusFlashMs`.
    struct ClockFlash: Equatable {
        let side: ClockSide
        let at: Int
    }

    init(prefs: ChessClockPrefs, onExit: @escaping () -> Void) {
        _prefs = ObservedObject(wrappedValue: prefs)
        self.onExit = onExit
        _clock = State(initialValue: ChessClock(control: prefs.control))
    }

    static func uptimeMs() -> Int { Int(ProcessInfo.processInfo.systemUptime * 1000) }

    var body: some View {
        VStack(spacing: 0) {
            half(.top)
                .rotationEffect(.degrees(180))
            controlBar
            half(.bottom)
        }
        .background(ChessClockMetrics.barFill.ignoresSafeArea())
        .onReceive(tick) { _ in onTick() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { pauseIfRunning() }
        }
        .onChange(of: clock.status) { _, status in
            ChessClockIdle.keepAwake(status == .running)
        }
        .onDisappear { ChessClockIdle.keepAwake(false) }
        .sheet(isPresented: $editing) {
            ChessClockSettingsSheet(initial: prefs.control) { start($0) }
        }
        .confirmationDialog(ChessClockStrings.resetTitle, isPresented: $confirmingReset,
                            titleVisibility: .visible) {
            Button(ChessClockStrings.resetConfirm, role: .destructive) { clock.reset(); flash = nil }
            Button(ChessClockStrings.cancel, role: .cancel) { }
        } message: {
            Text(ChessClockStrings.resetBody)
        }
    }

    // MARK: - The halves

    private func half(_ side: ClockSide) -> some View {
        let state = ChessClockHalfState.of(clock, side: side, at: now)
        let remaining = clock.remainingMs(side, at: now)
        return Button { press(side) } label: {
            GeometryReader { geo in
                ZStack {
                    fill(state)
                    VStack(spacing: ChessClockMetrics.chipGap) {
                        HStack(spacing: ChessClockMetrics.chipPaddingV) {
                            if let king = ChessClockStrings.chipKing(clock, side: side) {
                                PieceImage(piece: king, size: ChessClockMetrics.chipIconSize, shadow: false)
                            }
                            Text(ChessClockStrings.chip(clock, side: side))
                                .font(Theme.nunito(ChessClockMetrics.chipSize, .bold))
                                .foregroundStyle(ChessClockMetrics.chipText)
                        }
                        .padding(.horizontal, ChessClockMetrics.chipPaddingH)
                        .padding(.vertical, ChessClockMetrics.chipPaddingV)
                        .background(ChessClockMetrics.chipFill, in: Capsule())
                        Text(ClockFormat.display(remaining))
                            .font(.system(size: ChessClockMetrics.timeSize(width: geo.size.width),
                                          weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(ChessClockMetrics.timeMinScale)
                            .foregroundStyle(state.text)
                        Text(bonusText(side))
                            .font(Theme.nunito(ChessClockMetrics.bonusSize, .extraBold))
                            .foregroundStyle(state.text)
                    }
                    .padding(ChessClockMetrics.halfPadding)
                    if clock.status == .paused {
                        ChessClockMetrics.pausedScrim
                    }
                }
                .overlay(alignment: .topTrailing) {
                    Text(ChessClockStrings.movesText(clock.moves(side)))
                        .font(Theme.nunito(ChessClockMetrics.movesSize, .semiBold))
                        .foregroundStyle(state.text)
                        .padding(ChessClockMetrics.halfPadding)
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
        }
        .buttonStyle(ChessClockHalfStyle())
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(Text((side == .top ? ChessClockStrings.topPlayer : ChessClockStrings.bottomPlayer)
                                 + ", " + ClockFormat.display(remaining)))
    }

    @ViewBuilder
    private func fill(_ state: ChessClockHalfState) -> some View {
        switch state {
        case .ready: ChessClockMetrics.readyFill
        case .waiting: ChessClockMetrics.waitingFill
        case .active:
            LinearGradient(colors: [ChessClockMetrics.activeFill, ChessClockMetrics.activeFillEnd],
                           startPoint: .top, endPoint: .bottom)
        case .low: ChessClockMetrics.lowFill
        case .critical: ChessClockMetrics.criticalFill
        case .flagged: ChessClockMetrics.flaggedFill
        case .winner: ChessClockMetrics.winnerFill
        }
    }

    /// `+3s` under the clock that was just paid, for `bonusFlashMs`; empty — but laid out, so the
    /// digits never jump — the rest of the time.
    private func bonusText(_ side: ClockSide) -> String {
        guard let flash, flash.side == side, now - flash.at < ChessClockMetrics.bonusFlashMs else { return " " }
        return ChessClockStrings.bonusText(clock.control.effectiveBonusSeconds)
    }

    // MARK: - The bar

    private var controlBar: some View {
        HStack(spacing: 0) {
            barButton("xmark", ChessClockStrings.close) {
                ChessClockIdle.keepAwake(false)
                onExit()
            }
            barButton("arrow.counterclockwise", ChessClockStrings.reset) { askReset() }
            barButton(clock.status == .paused ? "play.fill" : "pause.fill",
                      clock.status == .paused ? ChessClockStrings.resume : ChessClockStrings.pause) {
                togglePause()
            }
            .disabled(!(clock.status == .running || clock.status == .paused))
            barButton("timer", ChessClockStrings.timeControl) {
                pauseIfRunning()
                editing = true
            }
            barButton(prefs.sound ? "speaker.wave.2.fill" : "speaker.slash.fill",
                      ChessClockStrings.sound) {
                prefs.sound.toggle()
            }
        }
        .frame(height: ChessClockMetrics.barHeight)
        .background(ChessClockMetrics.barFill)
    }

    private func barButton(_ symbol: String, _ label: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: ChessClockMetrics.barIconSize, weight: .semibold))
                .foregroundStyle(ChessClockMetrics.chipText)
                .frame(width: ChessClockMetrics.barButton, height: ChessClockMetrics.barButton)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text(label))
    }

    // MARK: - Events

    private func press(_ side: ClockSide) {
        let t = Self.uptimeMs()
        let wasReady = clock.status == .ready
        now = t
        guard clock.press(side, at: t) else { return }
        Haptics.play(.move)
        play(wasReady ? PuzzleSession.Sound.gameStart.rawValue : PuzzleSession.Sound.move.rawValue)
        flash = clock.lastBonused.map { ClockFlash(side: $0, at: t) }
    }

    private func onTick() {
        guard clock.status == .running else { return }
        let t = Self.uptimeMs()
        now = t
        if clock.tick(at: t) {
            play(PuzzleSession.Sound.gameOver.rawValue)
            Haptics.play(.success)
        }
    }

    private func togglePause() {
        let t = Self.uptimeMs()
        if clock.status == .running { clock.pause(at: t) } else { clock.resume(at: t) }
        now = t
    }

    private func pauseIfRunning() {
        guard clock.status == .running else { return }
        let t = Self.uptimeMs()
        clock.pause(at: t)
        now = t
    }

    /// Asks only when there is a game to lose; a clock nobody has started resets silently.
    private func askReset() {
        guard clock.status != .ready else { return }
        pauseIfRunning()
        confirmingReset = true
    }

    /// From the sheet: save the control, and start a fresh game on it.
    private func start(_ control: TimeControl) {
        prefs.control = control
        clock.setControl(control)
        flash = nil
        now = Self.uptimeMs()
    }

    /// The clock's own switch, on top of the app-wide one `SoundManager` already honours.
    private func play(_ name: String) {
        guard prefs.sound else { return }
        SoundManager.shared.play(name)
    }
}

/// A half is one big button; pressing it should not flash it the way the default style does.
struct ChessClockHalfStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? ChessClockMetrics.pressedOpacity : 1)
    }
}

/// The screen must not dim mid-game — and must be allowed to again the moment the clock stops.
///
/// `isIdleTimerDisabled` is app-wide, so whoever turns it on owns turning it off; every path out of
/// a running clock calls `keepAwake(false)`. macOS has no idle timer to hold, and the demo app must
/// keep building, so it is a no-op there.
@MainActor
enum ChessClockIdle {
    static func keepAwake(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
        #endif
    }
}

/// The time-control sheet: presets by speed, or a custom control with odds and a bonus.
struct ChessClockSettingsSheet: View {
    let onStart: (TimeControl) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: TimeControl
    @State private var odds: Bool

    init(initial: TimeControl, onStart: @escaping (TimeControl) -> Void) {
        let c = initial.clamped()
        _draft = State(initialValue: c)
        _odds = State(initialValue: c.isOdds)
        self.onStart = onStart
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: ChessClockMetrics.sectionGap) {
                Text(ChessClockStrings.timeControl)
                    .font(Theme.nunito(ChessClockMetrics.bonusSize, .extraBold))
                    .foregroundStyle(Theme.foreground)
                ForEach(TimeControl.Category.allCases, id: \.self) { band in
                    section(band.label)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: ChessClockMetrics.chipMinWidth),
                                                 spacing: ChessClockMetrics.chipGap)],
                              spacing: ChessClockMetrics.chipGap) {
                        ForEach(TimeControl.presets.filter { $0.category == band }, id: \.self) { p in
                            presetChip(p)
                        }
                    }
                }
                section(ChessClockStrings.custom)
                Toggle(ChessClockStrings.oddsToggle, isOn: $odds)
                    .font(Theme.nunito(ChessClockMetrics.movesSize, .semiBold))
                    .foregroundStyle(Theme.foreground)
                    .tint(ChessClockMetrics.gold)
                    .onChange(of: odds) { _, on in
                        if !on { draft.bottomSeconds = draft.topSeconds }
                    }
                if odds {
                    timeRow(ChessClockStrings.topPlayer, seconds: $draft.topSeconds)
                    timeRow(ChessClockStrings.bottomPlayer, seconds: $draft.bottomSeconds)
                } else {
                    timeRow(ChessClockStrings.timePerPlayer, seconds: bothSides)
                }
                section(ChessClockStrings.bonus)
                Picker(ChessClockStrings.bonus, selection: $draft.bonus) {
                    Text(ChessClockStrings.bonusNone).tag(TimeControl.Bonus.none)
                    Text(ChessClockStrings.bonusIncrement).tag(TimeControl.Bonus.increment)
                    Text(ChessClockStrings.bonusDelay).tag(TimeControl.Bonus.delay)
                }
                .pickerStyle(.segmented)
                .onChange(of: draft.bonus) { _, kind in
                    if kind == .none { draft.bonusSeconds = 0 }
                    else if draft.bonusSeconds == 0 { draft.bonusSeconds = TimeControl.default.bonusSeconds }
                }
                if draft.bonus != .none {
                    Stepper(value: $draft.bonusSeconds, in: 1...TimeControl.maxBonusSeconds) {
                        Text(String(draft.bonusSeconds) + " " + ChessClockStrings.bonusSecondsUnit)
                            .font(Theme.nunito(ChessClockMetrics.movesSize, .bold))
                            .foregroundStyle(Theme.foreground)
                    }
                    Text(draft.bonus == .delay ? ChessClockStrings.delayHelp : ChessClockStrings.incrementHelp)
                        .font(Theme.nunito(ChessClockMetrics.chipSize, .regular))
                        .foregroundStyle(Theme.mutedForeground)
                }
                HStack(spacing: ChessClockMetrics.chipGap) {
                    Button(ChessClockStrings.cancel) { dismiss() }
                        .font(Theme.nunito(ChessClockMetrics.movesSize, .bold))
                        .foregroundStyle(Theme.mutedForeground)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, ChessClockMetrics.chipPaddingVSheet)
                    Button {
                        onStart(draft.clamped())
                        dismiss()
                    } label: {
                        Text(ChessClockStrings.startText(draft.clamped()))
                            .font(Theme.nunito(ChessClockMetrics.movesSize, .extraBold))
                            .foregroundStyle(Theme.onGold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, ChessClockMetrics.chipPaddingVSheet)
                            .background(ChessClockMetrics.gold,
                                        in: RoundedRectangle(cornerRadius: ChessClockMetrics.chipRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(ChessClockMetrics.sheetPadding)
        }
        .background(Theme.background)
        .presentationDetents([.large])
    }

    private func section(_ title: String) -> some View {
        Text(title.uppercased())
            .font(Theme.nunito(ChessClockMetrics.chipSize, .bold))
            .foregroundStyle(Theme.mutedForeground)
    }

    private func presetChip(_ p: TimeControl) -> some View {
        let on = p == draft
        return Button {
            draft = p
            odds = false
        } label: {
            Text(p.label)
                .font(Theme.nunito(ChessClockMetrics.movesSize, .bold))
                .foregroundStyle(on ? Theme.onGold : Theme.foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, ChessClockMetrics.chipPaddingVSheet)
                .background(on ? ChessClockMetrics.gold : ChessClockMetrics.readyFill,
                            in: RoundedRectangle(cornerRadius: ChessClockMetrics.chipRadius))
        }
        .buttonStyle(.plain)
    }

    /// Both halves at once, when the toggle says the players have the same time.
    private var bothSides: Binding<Int> {
        Binding(get: { draft.topSeconds },
                set: { draft.topSeconds = $0; draft.bottomSeconds = $0 })
    }

    private func timeRow(_ title: String, seconds: Binding<Int>) -> some View {
        let minutes = Binding(get: { seconds.wrappedValue / 60 },
                              set: { seconds.wrappedValue = $0 * 60 + seconds.wrappedValue % 60 })
        let secs = Binding(get: { seconds.wrappedValue % 60 },
                           set: { seconds.wrappedValue = seconds.wrappedValue / 60 * 60 + $0 })
        return VStack(alignment: .leading, spacing: ChessClockMetrics.chipGap) {
            Text(title)
                .font(Theme.nunito(ChessClockMetrics.movesSize, .semiBold))
                .foregroundStyle(Theme.foreground)
            Stepper(value: minutes, in: 0...ChessClockMetrics.maxMinutes, step: ChessClockMetrics.minuteStep) {
                Text(String(minutes.wrappedValue) + " " + ChessClockStrings.minutes)
                    .font(Theme.nunito(ChessClockMetrics.movesSize, .bold))
                    .foregroundStyle(Theme.foreground)
            }
            Stepper(value: secs, in: 0...59, step: ChessClockMetrics.secondStep) {
                Text(String(secs.wrappedValue) + " " + ChessClockStrings.seconds)
                    .font(Theme.nunito(ChessClockMetrics.movesSize, .bold))
                    .foregroundStyle(Theme.foreground)
            }
        }
    }
}
