import SwiftUI
import BiyaherongCoachCore

// The Chess Clock's strings, numbers and saved preferences (client round 3, 2026-10-22).
//
// Everything here is INVENTED — the clock has no RN original to extract from — and recorded in
// PORTING_NOTES.md. Each enum is the twin of an object in `web-demo/js/chess-clock.js` (`STR`,
// `MET`), and `tools/qa/chess_clock_check.js` compares them key for key, so the two screens cannot
// drift. No view body in `ChessClockScreen.swift` holds a number or a string literal.

/// `STR` in chess-clock.js.
enum ChessClockStrings {
    static let title = "Chess Clock"
    static let tapToStart = "Tap to start"
    static let moves = "Moves"
    static let white = "White"
    static let black = "Black"
    static let timesUp = "Time's up"
    static let winsOnTime = "Wins on time"
    static let paused = "Paused"
    static let timeControl = "Time Control"
    static let custom = "Custom"
    static let timePerPlayer = "Time per player"
    static let oddsToggle = "Different time per player"
    static let topPlayer = "Top player"
    static let bottomPlayer = "Bottom player"
    static let bonus = "Bonus"
    static let bonusNone = "None"
    static let bonusIncrement = "Increment"
    static let bonusDelay = "Delay"
    static let incrementHelp = "Added to your clock after every move."
    static let delayHelp = "Your clock waits this long before it starts each turn."
    static let minutes = "min"
    static let seconds = "sec"
    static let bonusSecondsUnit = "s"
    static let start = "Start"
    static let cancel = "Cancel"
    static let resetTitle = "Reset the clock?"
    static let resetBody = "The game in progress will be lost."
    static let resetConfirm = "Reset"
    static let close = "Close"
    static let reset = "Reset"
    static let pause = "Pause"
    static let resume = "Resume"
    static let sound = "Sound"
    static let flagGlyph = "⏱"
    static let trophyGlyph = "🏆"
    static let homeEmoji = "⏱️"

    /// What the Home tile says under its title: `Blitz · 5 | 3`.
    static func homeSubtitle(_ c: TimeControl) -> String { c.category.label + " · " + c.label }

    /// `Moves: 12`.
    static func movesText(_ n: Int) -> String { moves + ": " + String(n) }

    /// `+3s`, beside the side that was just paid an increment.
    static func bonusText(_ seconds: Int) -> String { "+" + String(seconds) + bonusSecondsUnit }

    /// `Start · 5 | 3`.
    static func startText(_ c: TimeControl) -> String { start + " · " + c.label }

    /// The chip over each half: who is White, who flagged, or how to begin.
    static func chip(_ clock: ChessClock, side: ClockSide) -> String {
        switch clock.status {
        case .ready: return tapToStart
        case .flagged:
            return clock.flagged == side ? flagGlyph + " " + timesUp : trophyGlyph + " " + winsOnTime
        case .paused where clock.active == side: return paused
        case .running, .paused: return clock.white == side ? white : black
        }
    }

    /// The king drawn beside "White" / "Black" — the board's own piece art, not a ♔ / ♚ font glyph,
    /// which each platform draws differently (the browser turned ♚ into an emoji). `nil` whenever
    /// the chip says something else.
    static func chipKing(_ clock: ChessClock, side: ClockSide) -> Piece? {
        switch clock.status {
        case .ready, .flagged: return nil
        case .paused where clock.active == side: return nil
        case .running, .paused: return Piece(clock.white == side ? .white : .black, .king)
        }
    }
}

/// `MET` in chess-clock.js. The palette is the app's own — navy, gold, the Play buttons' green —
/// and the low/critical pair is Puzzle Turbo's amber and red, so "running out" reads the same
/// everywhere in the app.
enum ChessClockMetrics {
    static let readyFill = Theme.c(0x253552)
    static let waitingFill = Theme.c(0x1A2942)
    static let activeFill = Theme.c(0x2E9E57)
    static let activeFillEnd = Theme.c(0x45BF6E)
    static let lowFill = Theme.c(0xFDB022)
    static let criticalFill = Theme.c(0xE5484D)
    static let flaggedFill = Theme.c(0xB3261E)
    static let winnerFill = Theme.c(0x1A2942)
    static let barFill = Theme.c(0x0F1A2E)
    static let readyText = Theme.c(0xFFFFFF)
    static let waitingText = Theme.c(0x8BA3C7)
    static let activeText = Theme.c(0xFFFFFF)
    static let lowText = Theme.c(0x0F1A2E)
    static let criticalText = Theme.c(0xFFFFFF)
    static let winnerText = Theme.c(0xFDB022)
    static let chipFill = Theme.c(0x0F1A2E, 0.35)
    static let chipText = Theme.c(0xFFFFFF)
    static let gold = Theme.c(0xFDB022)
    static let pausedScrim = Theme.c(0x0F1A2E, 0.55)

    /// The digits fill about a quarter of the half's width, capped so a tablet-wide frame does not
    /// draw them a third of the screen tall.
    static let timeSizeRatio: CGFloat = 0.26
    static let timeMaxSize: CGFloat = 112
    static let timeMinScale: CGFloat = 0.4
    static let movesSize: CGFloat = 15
    static let chipSize: CGFloat = 13
    static let chipIconSize: CGFloat = 18
    static let bonusSize: CGFloat = 20
    static let chipPaddingH: CGFloat = 12
    static let chipPaddingV: CGFloat = 5
    static let halfPadding: CGFloat = 20
    static let barHeight: CGFloat = 64
    static let barIconSize: CGFloat = 24
    static let barButton: CGFloat = 48
    /// How long "+3s" stays up after an increment is paid.
    static let bonusFlashMs = 1200
    /// The repaint cadence. Tenths are on screen for the last ten seconds, so 100 ms is the
    /// coarsest tick that never skips a digit.
    static let tickMs = 100
    static let halfRadius: CGFloat = 0
    static let sheetRadius: CGFloat = 20
    static let sheetPadding: CGFloat = 18
    static let chipGap: CGFloat = 8
    static let chipRadius: CGFloat = 12
    static let chipMinWidth: CGFloat = 64
    static let chipPaddingVSheet: CGFloat = 10
    static let sectionGap: CGFloat = 16
    static let stepperButton: CGFloat = 40
    static let minuteStep = 1
    static let secondStep = 5
    /// 599:59 — `TimeControl.maxSeconds` in minutes, so the steppers cannot ask for more.
    static let maxMinutes = 599
    static let pressedOpacity: Double = 0.92

    static var tickSeconds: Double { Double(tickMs) / 1000 }

    /// The digits' point size for a half this wide.
    static func timeSize(width: CGFloat) -> CGFloat { min(width * timeSizeRatio, timeMaxSize) }
}

/// What a half looks like right now. One decision, made in one place, for both halves.
enum ChessClockHalfState: String, Equatable {
    case ready, waiting, active, low, critical, flagged, winner

    static func of(_ clock: ChessClock, side: ClockSide, at now: Int) -> ChessClockHalfState {
        switch clock.status {
        case .flagged: return clock.flagged == side ? .flagged : .winner
        case .ready: return .ready
        case .running, .paused:
            guard clock.active == side else { return .waiting }
            switch ClockFormat.level(clock.remainingMs(side, at: now)) {
            case .normal: return .active
            case .low: return .low
            case .critical: return .critical
            }
        }
    }

    var text: Color {
        switch self {
        case .ready: return ChessClockMetrics.readyText
        case .waiting: return ChessClockMetrics.waitingText
        case .active: return ChessClockMetrics.activeText
        case .low: return ChessClockMetrics.lowText
        case .critical, .flagged: return ChessClockMetrics.criticalText
        case .winner: return ChessClockMetrics.winnerText
        }
    }
}

/// The last time control and the sound switch — `biya.clock.v1`, one JSON record, the same shape
/// `web-demo/js/chess-clock.js` keeps in localStorage. Listed in `LoginAccountData.erasedKeys`.
@MainActor
final class ChessClockPrefs: ObservableObject {
    static let shared = ChessClockPrefs()
    static let storageKey = "biya.clock.v1"

    struct Record: Codable, Equatable {
        var control: TimeControl
        var sound: Bool
    }

    @Published var control: TimeControl { didSet { save() } }
    @Published var sound: Bool { didSet { save() } }

    private let defaults: UserDefaults

    /// A missing or unreadable record is the default — 5 | 3, sound on — never a crash; and a saved
    /// control is clamped on the way in, so a corrupted record cannot start a 0-second game.
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let saved = defaults.data(forKey: Self.storageKey)
            .flatMap { try? JSONDecoder().decode(Record.self, from: $0) }
        control = (saved?.control ?? .default).clamped()
        sound = saved?.sound ?? true
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(Record(control: control, sound: sound)) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    /// Delete-account. The key is erased by `AccountDeletion`; this resets what is live, or the
    /// next change would write the deleted record straight back.
    func forget() {
        control = .default
        sound = true
        defaults.removeObject(forKey: Self.storageKey)
    }
}
