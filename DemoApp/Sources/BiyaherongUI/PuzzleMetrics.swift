import SwiftUI
import BiyaherongCoachCore

/// The Puzzle Hub's pure presentation layer.
///
/// Twin of `web-demo/js/puzzle-metrics.js`. Every number the puzzle screens draw lives here, and
/// every one is asserted against `tools/metrics/puzzle_styles.json` — the AST extraction of the
/// real React Native StyleSheets — by `PuzzleMetricsCheck`. Nothing here is transcribed from the
/// spec's prose.
///
/// **No numeric literal and no arithmetic in any view body.** Every number is a stored property or
/// a pure function from this file, which is what lets the metrics check assert the layout with no
/// renderer. Break that and the coverage drains out silently.
///
/// ## Three things the extraction proved the spec got wrong
/// 1. Part 1 describes one "standard header" at `paddingTop 10, paddingBottom 6`. There is no
///    shared header component: eight distinct shapes across eleven screens, and the spec's numbers
///    match only the Play Puzzles home. The hub is `paddingVertical 10`, the solver 8.
/// 2. Part 10.3 gives "Next Puzzle →" a top margin of 8. It has both — an inline `marginTop: 8`
///    at three call sites AND `marginBottom: 8` in the StyleSheet.
/// 3. Part 9.2's mode tiles are "13% alpha" and "33% alpha". The source concatenates hex bytes,
///    `mode.color + "22"` and `+ "55"`, i.e. 13.33% and 33.33%. The bytes are what ship.
///
/// ## Typography
/// Part 0: the RN original loads Nunito but never applies it on any puzzle screen — they all render
/// in the platform system font. So these screens use SF Pro, **not** `Theme.nunito`. The one
/// exception is the timer, which needs `.monospacedDigit()` or it jitters every second.
public enum PuzzlePalette {
    public static let screenBg = Theme.c(0x0F1A2E)
    public static let card = Theme.c(0x1A2942)
    public static let cardAlt = Theme.c(0x253552)
    public static let textPrimary = Theme.c(0xFFFFFF)
    public static let textSecondary = Theme.c(0x8BA3C7)
    public static let gold = Theme.c(0xFDB022)
    public static let onGold = Theme.c(0x0F1A2E)
    public static let correct = Theme.c(0x43D97C)
    public static let wrong = Theme.c(0xFF6B6B)
    public static let engineEval = Theme.c(0x90CAF9)
    /// **No Swift screen reads this any more, and it still may not be deleted.**
    ///
    /// It painted the five puzzle-hub share buttons; those were removed at the client's request
    /// (they were `Button { }` — chrome wired to an empty closure). Its JS twin is still live:
    /// `PLAY_HOME.shareFill` → `--pzp-share-fill` → `.pzp-share`, the one real share button in the
    /// hub. `replay_puzzle_core.js`'s palette loop asserts this declaration by name, so tidying it
    /// away reds the gate — and Swift's own Play Home never had a share button to read it.
    public static let shareBlue = Theme.c(0x1E88E5)

    /// Mode accents. Part 9.2 flags that the hub's own card colours for Thematic, Turbo and Streak
    /// differ from those screens' accents; the fix unifies on the SCREEN colours so a tapped card
    /// flows into a matching screen. `PuzzleHub.sourceHex` keeps what the source had, so the
    /// deviation stays checkable rather than becoming folklore.
    public static let ratedGreen = Theme.c(0x5CC264)
    public static let dailyGreen = Theme.c(0x7CB342)
    public static let thematicPurple = Theme.c(0x8E24AA)
    public static let turboBlue = Theme.c(0x1E88E5)
    public static let streakOrange = Theme.c(0xF4511E)
}

// MARK: - Hub (Part 9)

public enum PuzzleHub {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingV: CGFloat = 10
    public static let backBtnW: CGFloat = 40
    public static let backBtnH: CGFloat = 40
    public static let heroPaddingTop: CGFloat = 6
    public static let heroPaddingBottom: CGFloat = 10
    public static let heroGap: CGFloat = 4
    public static let heroGlowSize: CGFloat = 68
    public static let heroGlowRadius: CGFloat = 34
    public static let heroGlowBorder: CGFloat = 2
    public static let heroGlowMarginBottom: CGFloat = 4
    public static let heroGlowFill = Color(red: 253/255, green: 176/255, blue: 34/255, opacity: 0.12)
    public static let heroGlowBorderColor = Color(red: 253/255, green: 176/255, blue: 34/255,
                                                  opacity: 0.35)
    public static let cardsPaddingH: CGFloat = 14
    public static let cardsPaddingBottom: CGFloat = 10
    public static let cardRadius: CGFloat = 14
    public static let cardPaddingV: CGFloat = 13
    public static let cardPaddingH: CGFloat = 14
    public static let cardBorderLeft: CGFloat = 4
    public static let cardGap: CGFloat = 12
    public static let cardShadowOpacity: Double = 0.25
    public static let cardShadowRadius: CGFloat = 4
    public static let cardShadowY: CGFloat = 2
    public static let tileSize: CGFloat = 44
    public static let tileRadius: CGFloat = 12
    public static let tileBorder: CGFloat = 1.5
    public static let titleMarginBottom: CGFloat = 2
    public static let badgePaddingH: CGFloat = 8
    public static let badgePaddingV: CGFloat = 3
    public static let badgeRadius: CGFloat = 20
    public static let badgeLetterSpacing: CGFloat = 0.5
    public static let chevronLineHeight: CGFloat = 24
    public static let pressOpacity: Double = 0.72

    /// Hex alpha the way the source writes it — a concatenated byte, not a rounded percentage.
    /// `0x22 / 255` is 13.33% and `0x55 / 255` is 33.33%; the spec rounds them to 13 and 33.
    public static let tintFillByte: UInt = 0x22
    public static let tintBorderByte: UInt = 0x55
    public static func tint(_ hex: UInt, _ byte: UInt) -> Color {
        Theme.c(hex, Double(byte) / 255.0)
    }

    public struct Mode: Identifiable, Equatable, Sendable {
        public let id: String
        public let emoji: String
        public let title: String
        public let subtitle: String
        public let badge: String
        /// The SCREEN accent, after the Part 9.2 unification.
        public let hex: UInt
        public var color: Color { Theme.c(hex) }
    }

    public static let modes: [Mode] = [
        Mode(id: "play", emoji: "♟️", title: "Play Puzzles",
             subtitle: "Solve rated puzzles & level up", badge: "RATED", hex: 0x5CC264),
        Mode(id: "daily", emoji: "📅", title: "Daily Puzzle",
             subtitle: "Today's special challenge awaits", badge: "DAILY", hex: 0xFDB022),
        Mode(id: "thematic", emoji: "🎯", title: "Thematic Puzzles",
             subtitle: "Master specific tactics & patterns", badge: "THEMES", hex: 0x8E24AA),
        Mode(id: "turbo", emoji: "⚡", title: "Puzzle Turbo",
             subtitle: "Race against the clock!", badge: "RUSH", hex: 0x1E88E5),
        // 0xF4511E, not the hub's own 0xFF6B35 — Part 9.2(a) unifies the card onto the Streak
        // SCREEN's accent so a tapped card flows into a matching screen. `sourceHex` below keeps
        // what the source had.
        Mode(id: "streak", emoji: "🔥", title: "Puzzle Streak",
             subtitle: "One mistake and it's over — keep going!", badge: "STREAK", hex: 0xF4511E),
    ]

    /// What the RN source actually used. Three of these differ from `modes` above, deliberately.
    public static let sourceHex: [String: UInt] = [
        "play": 0x5CC264, "daily": 0xFDB022, "thematic": 0xA855F7,
        "turbo": 0x4A90E2, "streak": 0xFF6B35,
    ]
}

// MARK: - Daily-goal strip (Part 15.2)

/// INVENTED — there is no RN source for this. The server had a `/api/daily-goal` endpoint the
/// mobile app never called, so there is no StyleSheet to extract and `PuzzleMetricsCheck` cannot
/// assert these. Recorded in PORTING_NOTES.md.
public enum PuzzleGoalStrip {
    public static let radius: CGFloat = 14
    public static let paddingH: CGFloat = 14
    public static let paddingV: CGFloat = 12
    public static let borderWidth: CGFloat = 1
    public static let borderColor = Color(red: 253/255, green: 176/255, blue: 34/255, opacity: 0.2)
    public static let marginH: CGFloat = 14
    public static let marginBottom: CGFloat = 10
    public static let rowGap: CGFloat = 14
    public static let ringSize: CGFloat = 44
    public static let ringStroke: CGFloat = 5
    public static let ringTrack = Theme.c(0x253552)
    public static let ringLabelSize: CGFloat = 15
    public static let titleSize: CGFloat = 14
    public static let subSize: CGFloat = 12
    public static let pillFill = Color(red: 253/255, green: 176/255, blue: 34/255, opacity: 0.12)
    public static let pillRadius: CGFloat = 20
    public static let pillPaddingH: CGFloat = 10
    public static let pillPaddingV: CGFloat = 5
    public static let pillBorder = Color(red: 253/255, green: 176/255, blue: 34/255, opacity: 0.3)
    public static let pillTextSize: CGFloat = 12
    public static let textGap: CGFloat = 2
    /// SwiftUI's `trim` starts at 3 o'clock; the ring reads from the top like every progress ring
    /// in the app, so it is rotated a quarter turn back.
    public static let ringStartDegrees: Double = -90
    /// The sweep, per Part 17.
    public static let animationMs = PuzzleSession.Timing.goalRingMs
    public static var animationSeconds: Double { Double(animationMs) / 1000.0 }
}

// MARK: - Play Puzzles Home (Part 10.1)

public enum PuzzlePlayHome {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingTop: CGFloat = 10
    public static let headerPaddingBottom: CGFloat = 6
    public static let badgePaddingH: CGFloat = 10
    public static let badgePaddingV: CGFloat = 4
    public static let badgeRadius: CGFloat = 12
    public static let topPaddingH: CGFloat = 16
    public static let topGap: CGFloat = 8
    public static let heroRadius: CGFloat = 14
    public static let heroPaddingH: CGFloat = 12
    public static let heroPaddingV: CGFloat = 10
    public static let heroGap: CGFloat = 10
    public static let heroBorder: CGFloat = 1
    public static let heroBorderColor = Color(red: 92/255, green: 194/255, blue: 100/255,
                                              opacity: 0.3)
    public static let heroSubMarginTop: CGFloat = 2
    public static let statRowFill = Color(red: 92/255, green: 194/255, blue: 100/255, opacity: 0.07)
    public static let statRowRadius: CGFloat = 8
    public static let statRowPaddingH: CGFloat = 8
    public static let statRowPaddingV: CGFloat = 6
    public static let statPaddingH: CGFloat = 6
    public static let statLabelMarginTop: CGFloat = 1
    public static let dividerW: CGFloat = 1
    public static let dividerH: CGFloat = 20
    public static let dividerColor = Color.white.opacity(0.08)
    public static let bottomPaddingH: CGFloat = 16
    public static let bottomPaddingBottom: CGFloat = 10
    public static let bottomPaddingTop: CGFloat = 6
    public static let bottomGap: CGFloat = 8
    public static let infoFill = Color(red: 92/255, green: 194/255, blue: 100/255, opacity: 0.07)
    public static let infoRadius: CGFloat = 10
    public static let infoPaddingH: CGFloat = 12
    public static let infoPaddingV: CGFloat = 8
    public static let infoBorder: CGFloat = 1
    public static let infoBorderColor = Color(red: 92/255, green: 194/255, blue: 100/255,
                                              opacity: 0.18)
    public static let infoLineHeight: CGFloat = 16
    public static let shareRadius: CGFloat = 14
    public static let sharePaddingV: CGFloat = 11
    public static let playRadius: CGFloat = 14
    public static let playPaddingV: CGFloat = 14
    public static let playShadowY: CGFloat = 4
    public static let playShadowOpacity: Double = 0.35
    public static let playShadowRadius: CGFloat = 8
}

/// The five stats cards. INVENTED geometry — the source had a leaderboard here, and Part 10.1 is
/// itself new design. Recorded in PORTING_NOTES.md.
public enum PuzzleStatsStyle {
    public static let cardRadius: CGFloat = 16
    public static let cardPadding: CGFloat = 16
    public static let cardMarginBottom: CGFloat = 12
    public static let sectionTitleSize: CGFloat = 16
    public static let ratingSize: CGFloat = 32
    public static let ratingLabelSize: CGFloat = 12
    public static let bestSize: CGFloat = 20
    public static let deltaSize: CGFloat = 12
    public static let sparkHeight: CGFloat = 52
    public static let sparkRadius: CGFloat = 6
    public static let sparkStrokeWidth: CGFloat = 1.5
    public static let sparkPadding: CGFloat = 32
    public static let sparkYMargin: Int = 25
    public static let accuracySize: CGFloat = 28
    public static let accuracySubSize: CGFloat = 12
    public static let barMaxHeight: CGFloat = 80
    public static let barMinHeight: CGFloat = 4
    public static let barWidth: CGFloat = 28
    public static let barRadius: CGFloat = 4
    public static let barCountHeight: CGFloat = 14
    public static let barCountSize: CGFloat = 10
    public static let barDaySize: CGFloat = 11
    public static let barRowMarginTop: CGFloat = 12
    public static let themeNameSize: CGFloat = 13
    public static let themeTrackHeight: CGFloat = 6
    public static let themeTrackRadius: CGFloat = 3
    public static let themePctSize: CGFloat = 12
    public static let themePctMinWidth: CGFloat = 44
    public static let emptySize: CGFloat = 13

    /// Accuracy colour thresholds (Part 10.1), descending so a boundary lands in the better band.
    public static func accuracyColor(_ pct: Double) -> Color {
        if pct >= 80 { return PuzzlePalette.correct }
        if pct >= 60 { return PuzzlePalette.gold }
        return PuzzlePalette.wrong
    }
}

// MARK: - Play Puzzles Solver (Part 10.2)

public enum PuzzleSolverStyle {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingV: CGFloat = 8
    public static let headerHeight: CGFloat = 56
    public static let backBtnW: CGFloat = 40
    public static let backBtnH: CGFloat = 40
    public static let backIconSize: CGFloat = 24
    public static let logoSize: CGFloat = 40
    public static let spacerW: CGFloat = 40
    public static let infoStripHeight: CGFloat = 34
    public static let infoStripPaddingH: CGFloat = 12
    public static let statsPaddingV: CGFloat = 10
    public static let statsPaddingH: CGFloat = 12
    public static let statLabelMarginBottom: CGFloat = 2
    public static let ratingDeltaMarginTop: CGFloat = 1
    public static let bottomPaddingH: CGFloat = 12
    public static let bottomPaddingTop: CGFloat = 8
    public static let wrongRowGap: CGFloat = 12
    public static let retryRadius: CGFloat = 10
    public static let retryPaddingV: CGFloat = 12
    public static let retryBorder: CGFloat = 1
    public static let retryBorderColor = Color.white.opacity(0.15)
    public static let solutionRadius: CGFloat = 10
    public static let solutionPaddingV: CGFloat = 12
    public static let nextRadius: CGFloat = 10
    public static let nextPaddingH: CGFloat = 24
    public static let nextPaddingV: CGFloat = 10
    /// BOTH are real: the StyleSheet carries `marginBottom: 8`, and three call sites add
    /// `marginTop: 8` inline. The spec mentions only the top one.
    public static let nextMarginTop: CGFloat = 8
    public static let nextMarginBottom: CGFloat = 8
    public static let loadingTextSize: CGFloat = 16
    public static let loadingMarginTop: CGFloat = 12
}

public enum PuzzleEnginePanel {
    public static let radius: CGFloat = 12
    public static let padding: CGFloat = 8
    public static let borderWidth: CGFloat = 1
    public static let borderColor = Color(red: 253/255, green: 176/255, blue: 34/255, opacity: 0.2)
    public static let headerMarginBottom: CGFloat = 6
    public static let titleSize: CGFloat = 13
    public static let refreshSize: CGFloat = 18
    public static let rowPaddingV: CGFloat = 3
    public static let rowGap: CGFloat = 8
    public static let rowBorderWidth: CGFloat = 1
    public static let rowBorderColor = Color.white.opacity(0.05)
    public static let dotSize: CGFloat = 10
    public static let dotWidth: CGFloat = 12
    public static let sanSize: CGFloat = 13
    public static let sanWidth: CGFloat = 48
    public static let evalSize: CGFloat = 12
    public static let evalWidth: CGFloat = 44
    public static let pvSize: CGFloat = 11
    /// Play Puzzles shows the top 2 lines; Thematic shows 3 (Part 18).
    public static let playLines = 2
    public static let thematicLines = 3
    /// `pv[1..<6]` — the first move is omitted, it is already the SAN column.
    public static let pvFrom = 1
    public static let pvTo = 6
}

public enum PuzzlePromotion {
    /// Part 2 keeps these deliberately distinct, and the difference is real in the source:
    /// Play/Daily/Thematic dim to 0.80, Streak and Turbo to 0.82. Encoding one value left the
    /// other recorded only in a comment.
    public static let scrim = Color.black.opacity(0.8)
    public static let scrimIntense = Color.black.opacity(0.82)
    public static func scrimFor(_ mode: PuzzleSession.Mode) -> Color {
        (mode == .streak || mode == .turbo) ? scrimIntense : scrim
    }
    public static let dialogRadius: CGFloat = 20
    public static let dialogPadding: CGFloat = 24
    public static let dialogWidth: CGFloat = 280
    public static let titleSize: CGFloat = 18
    public static let titleMarginBottom: CGFloat = 16
    public static let optionsGap: CGFloat = 10
    public static let optionRadius: CGFloat = 12
    public static let optionPadding: CGFloat = 14
    public static let optionGap: CGFloat = 12
    public static let optionTextSize: CGFloat = 16
    public static let glyphSize: CGFloat = 36
    /// Fixed order, and no cancel — one must be chosen (Part 5.6).
    public static let order: [PieceKind] = [.queen, .rook, .bishop, .knight]
    public static func label(_ kind: PieceKind) -> String {
        switch kind {
        case .queen: return "Queen"
        case .rook: return "Rook"
        case .bishop: return "Bishop"
        case .knight: return "Knight"
        default: return ""
        }
    }
    /// The row fill is the screen's accent.
    public static func accent(_ mode: PuzzleSession.Mode) -> Color {
        switch mode {
        case .play, .thematic: return Theme.c(0x4A90E2)
        case .daily: return Theme.c(0x7CB342)
        case .streak: return Theme.c(0xF4511E)
        case .turbo: return Theme.c(0x1E88E5)
        }
    }
}

public enum PuzzleSaveSheet {
    public static let buttonRadius: CGFloat = 10
    public static let buttonPaddingV: CGFloat = 10
    public static let buttonMarginTop: CGFloat = 8
    public static let buttonBorder: CGFloat = 1
    public static let buttonBorderColor = Color(red: 253/255, green: 176/255, blue: 34/255,
                                                opacity: 0.4)
    public static let savedBorderColor = Color(red: 67/255, green: 217/255, blue: 124/255,
                                               opacity: 0.4)
    public static let buttonTextSize: CGFloat = 14
    public static let scrim = Color.black.opacity(0.6)
    public static let cardRadiusTop: CGFloat = 20
    public static let cardPadding: CGFloat = 20
    public static let cardPaddingBottom: CGFloat = 36
    public static let titleSize: CGFloat = 16
    public static let titleMarginBottom: CGFloat = 16
    public static let labelSize: CGFloat = 12
    public static let labelMarginBottom: CGFloat = 4
    public static let inputRadius: CGFloat = 8
    public static let inputSize: CGFloat = 14
    public static let inputPaddingH: CGFloat = 12
    public static let inputPaddingV: CGFloat = 10
    public static let inputMarginBottom: CGFloat = 12
    public static let inputBorder: CGFloat = 1
    public static let inputBorderColor = Color.white.opacity(0.1)
    public static let notesMinHeight: CGFloat = 70
    public static let rowGap: CGFloat = 10
    public static let rowMarginTop: CGFloat = 4
    public static let buttonRowTextSize: CGFloat = 15
    public static let nameMax = 120
}


// MARK: - Daily Puzzle (Part 11)

public enum PuzzleDailyHome {
    public static let headerPaddingH: CGFloat = 20
    public static let headerPaddingTop: CGFloat = 16
    public static let headerPaddingBottom: CGFloat = 12
    public static let contentPaddingH: CGFloat = 20
    public static let contentPaddingBottom: CGFloat = 40
    public static let heroRadius: CGFloat = 20
    public static let heroPadding: CGFloat = 28
    public static let heroMarginBottom: CGFloat = 20
    public static let heroBorder: CGFloat = 1
    public static let heroBorderColor = Color(red: 124/255, green: 179/255, blue: 66/255,
                                              opacity: 0.3)
    public static let heroIconSize: CGFloat = 56
    public static let heroIconMarginBottom: CGFloat = 12
    public static let heroTitleMarginBottom: CGFloat = 6
    public static let statsGap: CGFloat = 12
    public static let statsMarginBottom: CGFloat = 16
    public static let statCardRadius: CGFloat = 16
    public static let statCardPadding: CGFloat = 20
    public static let statCardGap: CGFloat = 4
    public static let statCardBorder: CGFloat = 1
    public static let statCardBorderColor = Color(red: 253/255, green: 176/255, blue: 34/255,
                                                  opacity: 0.15)
    public static let statEmojiSize: CGFloat = 28
    public static let statValueSize: CGFloat = 32
    public static let statLabelSize: CGFloat = 12
    public static let infoRadius: CGFloat = 16
    public static let infoPadding: CGFloat = 20
    public static let infoMarginBottom: CGFloat = 20
    public static let infoBorder: CGFloat = 1
    public static let infoBorderColor = Color(red: 124/255, green: 179/255, blue: 66/255,
                                              opacity: 0.15)
    public static let infoTitleSize: CGFloat = 15
    public static let infoTitleMarginBottom: CGFloat = 8
    public static let infoTextSize: CGFloat = 14
    public static let infoLineHeight: CGFloat = 22
    public static let startRadius: CGFloat = 16
    public static let startPaddingV: CGFloat = 18
    public static let startShadowY: CGFloat = 4
    public static let startShadowOpacity: Double = 0.3
    public static let startShadowRadius: CGFloat = 8
    public static let solvedRadius: CGFloat = 16
    public static let solvedPadding: CGFloat = 28
    public static let solvedGap: CGFloat = 8
    public static let solvedBorder: CGFloat = 1
    public static let solvedBorderColor = Color(red: 92/255, green: 194/255, blue: 100/255,
                                                opacity: 0.3)
    public static let solvedIconSize: CGFloat = 48
    public static let solvedSubLineHeight: CGFloat = 22
}

public enum PuzzleDailySolver {
    public static let headerPaddingH: CGFloat = 20
    public static let headerPaddingV: CGFloat = 12
    public static let headerSubMarginTop: CGFloat = 2
    public static let headerSubMaxWidth: CGFloat = 200
    public static let feedbackMarginH: CGFloat = 16
    public static let feedbackRadius: CGFloat = 12
    public static let feedbackPadding: CGFloat = 16
    public static let feedbackMarginTop: CGFloat = 12
    public static let feedbackGap: CGFloat = 8
    public static let feedbackIconSize: CGFloat = 24
    public static let feedbackSolvedFill = Color(red: 92/255, green: 194/255, blue: 100/255,
                                                 opacity: 0.2)
    public static let feedbackSolvedBorder = Theme.c(0x5CC264)
    public static let feedbackWrongFill = Color(red: 1, green: 68/255, blue: 68/255, opacity: 0.2)
    public static let feedbackWrongBorder = Theme.c(0xFF4444)
    public static let instructionPaddingV: CGFloat = 12
    public static let doneMarginH: CGFloat = 16
    public static let doneRadius: CGFloat = 16
    public static let donePaddingV: CGFloat = 16
    public static let doneMarginTop: CGFloat = 12
    public static let loadingMarginTop: CGFloat = 12
    /// Part 5.5: only the WRONG banner auto-hides. The solved one is the end state.
    public static let wrongBannerMs = PuzzleSession.Timing.dailyWrongBannerMs
}

// MARK: - Thematic (Part 12)

public enum PuzzleThematicGrid {
    public static let headerPaddingH: CGFloat = 20
    public static let headerPaddingTop: CGFloat = 8
    public static let headerPaddingBottom: CGFloat = 8
    public static let badgeRowGap: CGFloat = 8
    public static let badgeRowMarginBottom: CGFloat = 10
    public static let badgePaddingH: CGFloat = 16
    public static let badgePaddingV: CGFloat = 6
    public static let badgeRadius: CGFloat = 20
    public static let badgeLetterSpacing: CGFloat = 1
    public static let sectionLabelMarginBottom: CGFloat = 8
    public static let sectionLabelPaddingH: CGFloat = 16
    public static let gridPaddingH: CGFloat = 12
    public static let gridPaddingBottom: CGFloat = 8
    public static let gridGap: CGFloat = 8
    public static let gridRowGap: CGFloat = 8
    /// 3 columns x 4 rows, filling the available height — no scroll view (Part 12.2).
    public static let cols = 3
    public static let rows = 4
    public static let cardRadius: CGFloat = 12
    public static let cardBorder: CGFloat = 1.5
    public static let cardPadding: CGFloat = 6
    public static let startRadius: CGFloat = 16
    public static let startPaddingV: CGFloat = 16
    public static let startMarginH: CGFloat = 12
    public static let startMarginBottom: CGFloat = 8
    public static let startDisabledFill = Theme_c(0x3A2A4A)
    public static let startDisabledOpacity: Double = 0.6

    /// The twelve themes, from the source's own `THEMES` array.
    ///
    /// Extracted rather than typed because the labels carry variation selectors: the emoji in
    /// `Fork`, `Skewer`, `Mate in 1` and `Middlegame` are U+FE0F sequences and the one in
    /// `Mate in 2` is not — exactly what a hand copy silently normalises away.
    public struct Theme: Identifiable, Equatable, Sendable {
        public let id: String
        public let label: String
        public let hex: UInt
        public var color: Color { Theme_c(hex) }
    }
    public static let themes: [Theme] = [
        Theme(id: "hangingPiece", label: "🎯 Hanging Piece", hex: 0x8E24AA),
        Theme(id: "crushing", label: "💥 Crushing", hex: 0x7B1FA2),
        Theme(id: "fork", label: "⚔️ Fork", hex: 0x6A1B9A),
        Theme(id: "pin", label: "📌 Pin", hex: 0x4A148C),
        Theme(id: "skewer", label: "🗡️ Skewer", hex: 0x880E4F),
        Theme(id: "discoveredAttack", label: "🔍 Discovered Attack", hex: 0x1565C0),
        Theme(id: "advantage", label: "📈 Advantage", hex: 0x0D47A1),
        Theme(id: "endgame", label: "🏁 Endgame", hex: 0x1B5E20),
        Theme(id: "backRankMate", label: "🏰 Back Rank Mate", hex: 0xBF360C),
        Theme(id: "mateIn1", label: "♟️ Mate in 1", hex: 0xB71C1C),
        Theme(id: "mateIn2", label: "♚ Mate in 2", hex: 0xC62828),
        Theme(id: "middlegame", label: "⚙️ Middlegame", hex: 0x37474F),
    ]
}

/// A free function so `PuzzleThematicGrid.Theme` can compute a colour without shadowing `Theme`.
public func Theme_c(_ hex: UInt) -> Color { Theme.c(hex) }

public enum PuzzleThematicSolver {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingV: CGFloat = 12
    public static let headerSubMarginTop: CGFloat = 2
    public static let statsRadius: CGFloat = 16
    public static let statsPadding: CGFloat = 16
    public static let statsMarginH: CGFloat = 8
    public static let statsMarginTop: CGFloat = 8
    public static let statsMarginBottom: CGFloat = 12
    public static let statsShadowY: CGFloat = 2
    public static let statsShadowOpacity: Double = 0.15
    public static let statsShadowRadius: CGFloat = 8
    public static let statLabelSize: CGFloat = 13
    public static let statLabelMarginBottom: CGFloat = 4
    public static let statLabelLetterSpacing: CGFloat = 0.3
    public static let statValueSize: CGFloat = 28
    public static let feedbackMarginH: CGFloat = 8
    public static let feedbackRadius: CGFloat = 12
    public static let feedbackPadding: CGFloat = 16
    public static let feedbackMarginBottom: CGFloat = 12
    public static let feedbackGap: CGFloat = 12
    public static let feedbackCorrectFill = Color(red: 67/255, green: 217/255, blue: 124/255,
                                                  opacity: 0.2)
    public static let feedbackCorrectBorder = Theme.c(0x43D97C)
    public static let feedbackWrongFill = Color(red: 1, green: 68/255, blue: 68/255, opacity: 0.2)
    public static let feedbackWrongBorder = Theme.c(0xFF4444)
    public static let feedbackTextSize: CGFloat = 16
    public static let wrongRowGap: CGFloat = 12
    public static let retryRadius: CGFloat = 10
    public static let retryPaddingV: CGFloat = 12
    public static let retryBorder: CGFloat = 1
    public static let retryBorderColor = Color.white.opacity(0.15)
    public static let solutionRadius: CGFloat = 10
    public static let solutionPaddingV: CGFloat = 12
    public static let nextRadius: CGFloat = 10
    public static let nextPaddingH: CGFloat = 24
    public static let nextPaddingV: CGFloat = 10
    public static let nextMarginTop: CGFloat = 10
    public static let buttonTextSize: CGFloat = 15
    /// Thematic's engine panel is roomier than Play's: padding 12 vs 8, rows 5 vs 3.
    public static let enginePadding: CGFloat = 12
    public static let engineMarginH: CGFloat = 8
    public static let engineMarginTop: CGFloat = 8
    public static let engineHeaderMarginBottom: CGFloat = 8
    public static let engineRowPaddingV: CGFloat = 5
    public static let hintMarginH: CGFloat = 8
    public static let hintPaddingV: CGFloat = 12
    public static let hintSize: CGFloat = 14
    public static let loadingMarginTop: CGFloat = 12
}

// MARK: - Typography

// MARK: - Puzzle Streak (Part 13)

/// Streak home. Twin of `STREAK_HOME` in `web-demo/js/puzzle-metrics.js`.
public enum PuzzleStreakHome {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingTop: CGFloat = 10
    public static let headerPaddingBottom: CGFloat = 6
    public static let badgeFill = PuzzlePalette.streakOrange
    public static let badgePaddingH: CGFloat = 10
    public static let badgePaddingV: CGFloat = 4
    public static let badgeRadius: CGFloat = 12
    public static let topPaddingH: CGFloat = 16
    public static let topGap: CGFloat = 8
    public static let displayRadius: CGFloat = 16
    public static let displayPadding: CGFloat = 14
    public static let displayMinHeight: CGFloat = 86
    public static let displayBorder: CGFloat = 1
    public static let displayBorderColor = Color(red: 244/255, green: 81/255, blue: 30/255)
        .opacity(0.3)
    public static let numberSize: CGFloat = 46
    public static let numberLineHeight: CGFloat = 52
    public static let labelSize: CGFloat = 14
    public static let labelMarginTop: CGFloat = 2
    public static let subSize: CGFloat = 11
    public static let subMarginTop: CGFloat = 2
    public static let statsGap: CGFloat = 8
    public static let statRadius: CGFloat = 14
    public static let statPaddingV: CGFloat = 10
    public static let statGap: CGFloat = 2
    public static let statBorder: CGFloat = 1
    public static let statBorderColor = Color(red: 244/255, green: 81/255, blue: 30/255)
        .opacity(0.15)
    public static let statEmojiSize: CGFloat = 18
    public static let statValueSize: CGFloat = 20
    public static let statLabelSize: CGFloat = 10
    public static let listTitleSize: CGFloat = 13
    public static let listPaddingH: CGFloat = 16
    public static let listPaddingTop: CGFloat = 8
    public static let listPaddingBottom: CGFloat = 4
    public static let countBadgeFill = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.12)
    public static let countBadgeBorder = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.3)
    public static let countBadgeRadius: CGFloat = 10
    public static let countBadgePaddingH: CGFloat = 8
    public static let countBadgePaddingV: CGFloat = 3
    public static let countBadgeSize: CGFloat = 10
    /// The run rows reuse the source's own podium geometry — the leaderboard is gone but Part 13.1
    /// describes its rows, down to the 60pt minimum on the score.
    public static let rowRadius: CGFloat = 14
    public static let rowPaddingH: CGFloat = 12
    public static let rowPaddingV: CGFloat = 10
    public static let rowMarginBottom: CGFloat = 6
    public static let rowGap: CGFloat = 10
    public static let rowScoreSize: CGFloat = 15
    public static let rowScoreMinWidth: CGFloat = 60
    public static let rowDateSize: CGFloat = 13
    public static let emptySize: CGFloat = 13
    public static let bottomPaddingH: CGFloat = 16
    public static let bottomPaddingBottom: CGFloat = 10
    public static let bottomPaddingTop: CGFloat = 6
    public static let bottomGap: CGFloat = 8
    public static let startFill = PuzzlePalette.streakOrange
    public static let startRadius: CGFloat = 14
    public static let startPaddingV: CGFloat = 14
    public static let startSize: CGFloat = 16
}

/// Streak solver. Twin of `STREAK_SOLVER`.
public enum PuzzleStreakSolver {
    public static let headerPaddingH: CGFloat = 20
    public static let headerPaddingV: CGFloat = 6
    public static let backBtnW: CGFloat = 44
    public static let backBtnH: CGFloat = 44
    public static let backSize: CGFloat = 28
    public static let counterSize: CGFloat = 34
    public static let statsRadius: CGFloat = 16
    public static let statsPaddingV: CGFloat = 8
    public static let statsPaddingH: CGFloat = 16
    public static let statsMarginH: CGFloat = 8
    public static let statsMarginBottom: CGFloat = 6
    public static let statsShadowY: CGFloat = 2
    public static let statsShadowOpacity: Double = 0.15
    public static let statsShadowRadius: CGFloat = 6
    public static let statLabelSize: CGFloat = 11
    public static let statLabelMarginBottom: CGFloat = 2
    public static let statValueSize: CGFloat = 22
    public static let statDividerSize: CGFloat = 20
    /// The header's right-hand mark, from `.pzd-logo` (web-demo/css/app.css:1349-1350):
    /// `width/height 30px; border-radius 50%; border 2px solid var(--pz-gold);
    ///  box-shadow 0 0 6px rgba(253,176,34,.6)`.
    /// It replaces a `Color.clear` that carried a width and no height — see the header comment in
    /// PuzzleStreakScreens.swift for why that one omission cost the whole screen's layout.
    public static let logoSize: CGFloat = 30
    public static let logoBorder: CGFloat = 2
    public static let logoGlowRadius: CGFloat = 6
    public static let logoGlowColor = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.6)
    public static let bottomPaddingH: CGFloat = 16
    public static let bottomGap: CGFloat = 10
    public static let hintSize: CGFloat = 14
    public static let loadingGap: CGFloat = 16
    public static let loadingSize: CGFloat = 15
    public static let loadingMarginTop: CGFloat = 4
    // Result overlay (Part 13.3)
    public static let overlayScrim = Color.black.opacity(0.78)
    public static let overlayPaddingH: CGFloat = 20
    public static let boxRadius: CGFloat = 24
    public static let boxPadding: CGFloat = 28
    public static let boxGap: CGFloat = 12
    public static let boxBorder: CGFloat = 1
    public static let boxBorderColor = Color(red: 244/255, green: 81/255, blue: 30/255)
        .opacity(0.3)
    public static let resultHeaderSize: CGFloat = 22
    public static let resultNumberSize: CGFloat = 56
    public static let resultNumberLineHeight: CGFloat = 64
    public static let resultBestSize: CGFloat = 14
    public static let newBestFill = Color(red: 253/255, green: 176/255, blue: 34/255).opacity(0.15)
    public static let newBestRadius: CGFloat = 12
    public static let newBestPaddingH: CGFloat = 16
    public static let newBestPaddingV: CGFloat = 6
    public static let newBestBorder: CGFloat = 1.5
    public static let newBestSize: CGFloat = 16
    public static let btnRadius: CGFloat = 12
    public static let btnPaddingV: CGFloat = 11
    public static let btnPaddingH: CGFloat = 32
    public static let btnSize: CGFloat = 15
    public static let tryAgainRadius: CGFloat = 14
    public static let tryAgainPaddingV: CGFloat = 13
    public static let tryAgainPaddingH: CGFloat = 40
    public static let backToMenuMarginTop: CGFloat = 4
    public static let backToMenuPaddingV: CGFloat = 10
    public static let backToMenuSize: CGFloat = 14
    // Solution strip
    public static let stripGap: CGFloat = 10
    public static let stripPaddingH: CGFloat = 16
    public static let stripPaddingV: CGFloat = 12
    public static let stripRadius: CGFloat = 16
    public static let stripBorder: CGFloat = 1
    public static let stripBorderColor = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.25)
    public static let stripLabelSize: CGFloat = 11
    public static let stripLabelColor = Color(red: 1.0, green: 170/255, blue: 85/255)
    public static let stripLabelLetterSpacing: CGFloat = 0.5
    public static let stripMoveSize: CGFloat = 24
    public static let stripMoveLetterSpacing: CGFloat = 1
    public static let stripButtonsGap: CGFloat = 8
    public static let stripBtnRadius: CGFloat = 10
    public static let stripBtnPaddingV: CGFloat = 11
    public static let stripBtnSize: CGFloat = 14
    public static let stripMenuFill = Color(red: 30/255, green: 58/255, blue: 95/255)
    public static let stripMenuBorder = Color(red: 139/255, green: 163/255, blue: 199/255)
        .opacity(0.3)
    /// The revealed move's two square tints — deliberately different, so the move reads as a
    /// direction rather than a pair (Part 13.3).
    public static let solutionFromTint = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.65)
    public static let solutionToTint = Color(red: 253/255, green: 176/255, blue: 34/255)
        .opacity(0.95)
}

// MARK: - Puzzle Turbo (Part 14)

/// Turbo mode select. Twin of `TURBO_HOME`.
public enum PuzzleTurboHome {
    public static let headerPaddingH: CGFloat = 16
    public static let headerPaddingTop: CGFloat = 10
    public static let headerPaddingBottom: CGFloat = 6
    public static let badgeFill = PuzzlePalette.turboBlue
    public static let badgePaddingH: CGFloat = 10
    public static let badgePaddingV: CGFloat = 4
    public static let badgeRadius: CGFloat = 12
    public static let topPaddingH: CGFloat = 16
    public static let topGap: CGFloat = 8
    public static let infoRadius: CGFloat = 12
    public static let infoPaddingH: CGFloat = 12
    public static let infoPaddingV: CGFloat = 9
    public static let infoBorder: CGFloat = 1
    public static let infoBorderColor = Color(red: 30/255, green: 136/255, blue: 229/255)
        .opacity(0.25)
    public static let infoSize: CGFloat = 12
    public static let mistakeBadgeFill = Color(red: 229/255, green: 57/255, blue: 53/255)
        .opacity(0.15)
    public static let mistakeBadgeRadius: CGFloat = 8
    public static let mistakeBadgePaddingH: CGFloat = 8
    public static let mistakeBadgePaddingV: CGFloat = 4
    public static let mistakeBadgeColor = Color(red: 239/255, green: 154/255, blue: 154/255)
    public static let mistakeBadgeBorder = Color(red: 229/255, green: 57/255, blue: 53/255)
        .opacity(0.35)
    public static let mistakeBadgeSize: CGFloat = 10
    public static let cardRadius: CGFloat = 14
    public static let cardPaddingH: CGFloat = 12
    public static let cardPaddingV: CGFloat = 10
    public static let cardBorder: CGFloat = 1
    public static let cardBorderColor = Color(red: 30/255, green: 136/255, blue: 229/255)
        .opacity(0.2)
    public static let cardLabelSize: CGFloat = 10
    public static let cardLabelMarginBottom: CGFloat = 8
    public static let cardLabelLetterSpacing: CGFloat = 0.8
    public static let cardLabelColor = Color(red: 90/255, green: 112/255, blue: 144/255)
    public static let tabGap: CGFloat = 8
    public static let tabPaddingV: CGFloat = 8
    public static let tabPaddingH: CGFloat = 4
    public static let tabRadius: CGFloat = 12
    public static let tabGapInner: CGFloat = 2
    public static let tabFill = PuzzlePalette.cardAlt
    public static let tabBorder: CGFloat = 1.5
    public static let tabBorderColor = Color.white.opacity(0.1)
    public static let tabTextSize: CGFloat = 12
    public static let tabBestSize: CGFloat = 10
    public static let tabBestColor = Color(red: 90/255, green: 112/255, blue: 144/255)
    /// The selected tab sits on its mode's colour, so its Best line lightens to stay legible.
    public static let tabBestSelectedColor = Color.white.opacity(0.85)
    public static let listTitleSize: CGFloat = 13
    public static let listPaddingH: CGFloat = 16
    public static let listPaddingTop: CGFloat = 8
    public static let listPaddingBottom: CGFloat = 4
    public static let rowRadius: CGFloat = 14
    public static let rowPaddingH: CGFloat = 12
    public static let rowPaddingV: CGFloat = 10
    public static let rowMarginBottom: CGFloat = 6
    public static let rowGap: CGFloat = 10
    public static let rowScoreSize: CGFloat = 15
    public static let rowScoreMinWidth: CGFloat = 60
    public static let rowMistakesSize: CGFloat = 12
    public static let rowDateSize: CGFloat = 13
    public static let emptySize: CGFloat = 13
    public static let bottomPaddingH: CGFloat = 16
    public static let bottomPaddingBottom: CGFloat = 10
    public static let bottomPaddingTop: CGFloat = 6
    public static let bottomGap: CGFloat = 8
    /// No fill here on purpose: the source sets the start button's colour inline from the selected
    /// mode, which is why the extraction shows no `backgroundColor` on it.
    public static let startRadius: CGFloat = 14
    public static let startPaddingV: CGFloat = 14
    public static let startSize: CGFloat = 16
    public static let startShadowY: CGFloat = 3
    public static let startShadowOpacity: Double = 0.25
    public static let startShadowRadius: CGFloat = 6
}

/// Turbo run. Twin of `TURBO_RUN`.
public enum PuzzleTurboRun {
    public static let headerPaddingH: CGFloat = 20
    public static let headerPaddingV: CGFloat = 6
    public static let quitBtnW: CGFloat = 52
    public static let quitBtnH: CGFloat = 40
    public static let quitSize: CGFloat = 15
    public static let timerSize: CGFloat = 34
    public static let statsRadius: CGFloat = 16
    public static let statsPaddingV: CGFloat = 8
    public static let statsPaddingH: CGFloat = 16
    public static let statsMarginH: CGFloat = 8
    public static let statsMarginBottom: CGFloat = 6
    public static let statsShadowY: CGFloat = 2
    public static let statsShadowOpacity: Double = 0.15
    public static let statsShadowRadius: CGFloat = 6
    public static let statLabelSize: CGFloat = 11
    public static let statLabelMarginBottom: CGFloat = 2
    public static let statValueSize: CGFloat = 22
    public static let mistakesGap: CGFloat = 4
    public static let mistakeDotSize: CGFloat = 16
    public static let mistakeUsedOpacity: Double = 1.0
    public static let mistakeLeftOpacity: Double = 0.2
    public static let bottomPaddingH: CGFloat = 16
    public static let hintSize: CGFloat = 14
    public static let loadingGap: CGFloat = 16
    public static let loadingSize: CGFloat = 15
    // Quit modal (Part 14.4)
    public static let modalScrim = Color.black.opacity(0.7)
    public static let modalRadius: CGFloat = 20
    public static let modalPadding: CGFloat = 24
    public static let modalWidth: CGFloat = 300
    public static let modalBorder: CGFloat = 1
    public static let modalTitleSize: CGFloat = 18
    public static let modalTitleMarginBottom: CGFloat = 10
    public static let modalBodySize: CGFloat = 14
    public static let modalBodyMarginBottom: CGFloat = 20
    public static let modalBodyLineHeight: CGFloat = 20
    public static let modalButtonsGap: CGFloat = 12
    public static let modalBtnRadius: CGFloat = 12
    public static let modalBtnPaddingV: CGFloat = 12
    public static let modalBtnSize: CGFloat = 14
    public static let modalKeepFill = PuzzlePalette.cardAlt
    public static let modalBorderColor = Color.white.opacity(0.1)
    public static let modalKeepBorder = Color.white.opacity(0.15)
    public static let modalQuitFill = Color(red: 229/255, green: 57/255, blue: 53/255)
    // Results (Part 14.4)
    public static let finishedPadding: CGFloat = 40
    public static let finishedIconSize: CGFloat = 64
    public static let finishedIconMarginBottom: CGFloat = 16
    public static let finishedTitleSize: CGFloat = 24
    public static let finishedTitleMarginBottom: CGFloat = 24
    public static let finishedScoreSize: CGFloat = 72
    public static let finishedLabelSize: CGFloat = 16
    public static let finishedLabelMarginBottom: CGFloat = 24
    public static let finishedStatsGap: CGFloat = 8
    public static let finishedStatsMarginBottom: CGFloat = 24
    public static let finishedStatSize: CGFloat = 16
    public static let doneFill = Color(red: 74/255, green: 144/255, blue: 226/255)
    public static let doneRadius: CGFloat = 16
    public static let donePaddingV: CGFloat = 16
    public static let donePaddingH: CGFloat = 32
    public static let doneSize: CGFloat = 16
}

/// The ✓/✕ dot Turbo draws over the played square (Part 14.3), as **signed terms**.
///
/// The signs are separate constants because `left` subtracts its radius term while `top` adds its
/// own, and a transcribed sign is exactly how the annotation badge once shipped in the wrong corner
/// in both languages. `tools/qa/replay_puzzle_core.js` reads these back out of the Swift source and
/// compares them with the JS that has actually run.
public enum PuzzleTurboFeedback {
    public static let radiusFactor: CGFloat = 0.21
    public static let colOffset: CGFloat = 1
    public static let leftSign: CGFloat = -1
    public static let leftFactor: CGFloat = 1.4
    public static let topSign: CGFloat = 1
    public static let topFactor: CGFloat = 0.4
    public static let glyphFactor: CGFloat = 0.95
    public static let glyphLineFactor: CGFloat = 1.3
    public static let borderWidth: CGFloat = 1.5
    public static let zIndex: CGFloat = 20
    public static let borderColor = Color.white
    public static let correctFill = Color(red: 43/255, green: 196/255, blue: 110/255).opacity(0.96)
    public static let wrongFill = Color(red: 220/255, green: 50/255, blue: 47/255).opacity(0.96)

    /// The dot's top-left, in points, within a board of side `boardSize`.
    ///
    /// The flip is asymmetric on purpose: the file mirrors for Black, the rank does not.
    public static func origin(square: String, boardSize: CGFloat,
                              userIsWhite: Bool) -> CGPoint {
        let chars = Array(square.utf8)
        guard chars.count >= 2 else { return .zero }
        let file = CGFloat(Int(chars[0]) - 97)
        let rank = CGFloat(Int(chars[1]) - 49)
        let sq = boardSize / 8
        let col = userIsWhite ? file : 7 - file
        let row = userIsWhite ? 7 - rank : rank
        let r = sq * radiusFactor
        return CGPoint(x: (col + colOffset) * sq + leftSign * r * leftFactor,
                       y: row * sq + topSign * r * topFactor)
    }
}

/// The three Turbo modes, from the source's own `TIME_OPTIONS`.
public enum PuzzleTurboModes {
    public struct Mode: Equatable, Sendable {
        public let minutes: Int
        public let label: String
        public let color: Color
    }
    public static let all: [Mode] = [
        Mode(minutes: 0, label: "∞ Infinite",
             color: Color(red: 156/255, green: 39/255, blue: 176/255)),
        Mode(minutes: 3, label: "3 min",
             color: Color(red: 30/255, green: 136/255, blue: 229/255)),
        Mode(minutes: 5, label: "5 min",
             color: Color(red: 67/255, green: 160/255, blue: 71/255)),
    ]
    /// Part 14.1: the default selection is 3, not infinite.
    public static let defaultMode: Int = 3

    /// The clock's four colour bands, most-urgent first so a boundary lands in the louder band: at
    /// exactly 10 seconds the clock is already red, not amber.
    public static func timerColor(_ secondsLeft: Int?) -> Color {
        guard let s = secondsLeft else {
            return Color(red: 156/255, green: 39/255, blue: 176/255)   // infinite
        }
        if s <= 10 { return Color(red: 1.0, green: 68/255, blue: 68/255) }
        if s <= 30 { return PuzzlePalette.gold }
        return PuzzlePalette.correct
    }
}

// MARK: - Sound (Part 16)

/// The puzzle path's entire sound vocabulary. Twin of `SOUNDS` in `web-demo/js/puzzle-metrics.js`.
///
/// Extracted from `hooks/usePuzzleSound.ts` and deliberately **narrower** than the Play screen's
/// `SoundManager`: four sounds, and the move sound is capture-or-move with no check and no castle
/// case. `check.mp3` and `castling.mp3` both ship and the puzzle screens never reach them — that is
/// the source's choice, not an omission.
///
/// ## Why this is a table and not five call sites
/// Every sound name in `web-demo/` was hand-typed, and three of the five screens got the wiring
/// wrong: they reached for a global that did not exist, so nothing played at all, and one asked for
/// a name (`puzzle-correct`) that is not a sound. Both failures are silent — a missing sound looks
/// exactly like a quiet moment. Naming the vocabulary once makes a fifth name a test failure.
public enum PuzzleSounds {

    /// The four keys, in the source's own declaration order.
    public enum Key: String, CaseIterable, Sendable {
        case gameStart, move, capture, gameOver

        /// The bundled asset, which is kebab-case where the key is camel.
        public var file: String {
            switch self {
            case .gameStart: return "game-start"
            case .move:      return "move"
            case .capture:   return "capture"
            case .gameOver:  return "game-over"
            }
        }
    }

    /// `flags.includes('c') || flags.includes('e')` — capture or en passant.
    public static let captureFlags: [String] = ["c", "e"]

    /// The move sound, from whether the move captured. The whole of `playMoveSound`.
    public static func forMove(captured: Bool) -> Key { captured ? .capture : .move }

    /// Does a **correct solve** chime?
    ///
    /// Three modes yes, two no, and the split is not arbitrary: Play, Daily and Thematic are
    /// one-puzzle-at-a-time, so finishing *is* the event. Streak and Turbo are runs, where
    /// `gameOver` marks the run ending — chiming per solve would fire it dozens of times.
    public static func chimesOnSolve(_ mode: String) -> Bool {
        ["play", "daily", "thematic"].contains(mode)
    }

    /// And the mirror: only the two run modes chime when the run itself ends.
    public static func chimesOnRunEnd(_ mode: String) -> Bool {
        ["streak", "turbo"].contains(mode)
    }
}

public enum PuzzleType {
    public static let hubTitle: CGFloat = 18
    public static let hubHeroTitle: CGFloat = 19
    public static let hubHeroSub: CGFloat = 13
    public static let hubBackIcon: CGFloat = 24
    public static let hubCardTitle: CGFloat = 14
    public static let hubCardSub: CGFloat = 11
    public static let hubBadge: CGFloat = 9
    public static let hubChevron: CGFloat = 22
    public static let hubEmoji: CGFloat = 22
    public static let homeTitle: CGFloat = 18
    public static let homeBadge: CGFloat = 11
    public static let homeHeroTitle: CGFloat = 14
    public static let homeHeroSub: CGFloat = 11
    public static let homeHeroEmoji: CGFloat = 28
    public static let homeStatIcon: CGFloat = 14
    public static let homeStatLabel: CGFloat = 9
    public static let homeInfo: CGFloat = 11
    public static let homeShare: CGFloat = 14
    public static let homePlay: CGFloat = 17
    public static let homeEmpty: CGFloat = 13
    public static let solverBackIcon: CGFloat = 24
    public static let solverInfoStrip: CGFloat = 13
    public static let solverStatLabel: CGFloat = 11
    public static let solverStatValue: CGFloat = 16
    public static let solverRatingDelta: CGFloat = 11
    public static let solverButton: CGFloat = 15
    public static let solverLoading: CGFloat = 16
    public static let dailyTitle: CGFloat = 20
    public static let dailyHeroTitle: CGFloat = 20
    public static let dailyHeroSub: CGFloat = 13
    public static let dailyStart: CGFloat = 18
    public static let dailySolvedTitle: CGFloat = 20
    public static let dailySolverTitle: CGFloat = 18
    public static let dailySolverSub: CGFloat = 12
    public static let dailyFeedback: CGFloat = 16
    public static let dailyInstruction: CGFloat = 15
    public static let dailyDone: CGFloat = 16
    public static let thematicTitle: CGFloat = 20
    public static let thematicBadge: CGFloat = 13
    public static let thematicSection: CGFloat = 14
    public static let thematicCard: CGFloat = 13
    public static let thematicStart: CGFloat = 16
    public static let thematicSolverTitle: CGFloat = 18
    public static let thematicSolverSub: CGFloat = 12
    public static let streakTitle: CGFloat = 18
    public static let streakBadge: CGFloat = 11
    public static let streakSolverBack: CGFloat = 28
    public static let streakCounter: CGFloat = 34
    public static let turboTitle: CGFloat = 18
    public static let turboBadge: CGFloat = 11
    public static let turboQuit: CGFloat = 15
    public static let turboTimer: CGFloat = 34
}

// MARK: - Strings (Part 19), verbatim

public enum PuzzleStrings {
    /// puzzle-streak/puzzle.tsx:528. The Analysis Board says "Promote to:" instead.
    public static let promotionTitle = "Choose Promotion"
    public static let hubTitle = "Puzzle Hub"
    /// The hero glyph.
    ///
    /// The source draws a knight IMAGE (`PuzzleKnightImg`), not text, so both twins
    /// substitute the glyph rather than invent a different emoji. It was briefly a puzzle
    /// piece here and a knight in the JS — caught by the string-table parity check the
    /// moment that check existed.
    public static let hubHeroGlyph = "♞"
    public static let hubHeroTitle = "Choose Your Mode!"
    public static let hubHeroSub = "Train your tactics your way 💪"
    public static let goalTitle = "Daily Goal"
    public static func goalProgress(_ n: Int) -> String { "\(n) of 10 solved today" }
    public static let goalComplete = "Goal complete — nice work! 🎉"
    public static func goalStreak(_ d: Int) -> String { "🔥 \(d)d" }

    public static let homeTitle = "Play Puzzles"
    public static let homeBadge = "♟️ RATED"
    public static let homeHeroTitle = "Rated Puzzle Mode"
    public static let homeHeroSub = "Solve puzzles · Earn ELO · Climb the ranks"
    public static let homeStats: [(icon: String, label: String)] =
        [("⭐", "ELO"), ("🧩", "Rated"), ("📈", "Track")]
    public static let homeInfo = "Correct solve = +ELO · Wrong move = −ELO · Rating range: ±100"
    public static let homeShare = "📤 Share My Rating"
    public static let homePlay = "♟️ Play Puzzles"
    public static let currentRating = "Current Rating"
    public static let best = "Best"
    public static let accuracy = "Accuracy"
    public static func solvedOf(_ s: Int, _ a: Int) -> String { "\(s) of \(a) solved" }
    public static let activity = "Activity — Last 7 Days"
    public static let themePerformance = "Theme Performance"
    /// Agreed rather than specified: on day one the rating card renders and the four data-driven
    /// cards collapse into this one line.
    public static let statsEmpty = "Solve your first puzzle to start tracking your stats."
    /// No URL — the hosted /share endpoints are gone (Part 21). The text is the whole payload.
    public static func shareText(_ rating: Int) -> String {
        "Check out my chess puzzle stats on Biyaherong Chess Coach! ♟️\n"
        + "My puzzle rating: ⭐ \(rating)\n#BiyaherongChess #ChessPH"
    }

    public static let loading = "Loading puzzle..."
    public static let whiteToMove = "♙ White to Move"
    public static let blackToMove = "♟ Black to Move"
    public static let solved = "✅ Solved!"
    public static let wrongMove = "❌ Wrong move!"
    public static let viewingSolution = "💡 Viewing Solution"
    public static let yourRating = "Your Rating"
    public static let clock = "⏱"
    public static let puzzle = "Puzzle"
    public static let noTime = "--:--"
    public static let solution = "Solution"
    public static let nextPuzzle = "Next Puzzle →"
    public static let retry = "🔄 Retry"
    public static let solutionBtn = "💡 Solution"
    public static let analyzing = "⏳ Analyzing..."
    public static let engineSuggestions = "💡 Engine Suggestions"
    public static let refresh = "↻"
    public static let savePuzzle = "💾 Save Puzzle"
    public static let savedToBoard = "✅ Saved to Analysis Board"
    public static let choosePromotion = "Choose Promotion"
    public static let saveName = "Name"
    public static let saveNamePlaceholder = "Puzzle name..."
    public static let saveNotes = "Notes (optional)"
    public static let saveNotesPlaceholder = "Themes, rating, notes..."
    public static let cancel = "Cancel"
    public static let save = "Save"

    // Daily (Part 19)
    public static let dailyTitle = "Daily Puzzle"
    public static let dailyHeroTitle = "Today's Challenge"
    /// The original read "powered by Chess.com", which is now false.
    public static let dailyHeroSub = "A new puzzle every day — always offline"
    public static let dailyStreakLabel = "Day Streak"
    public static let dailyTotalLabel = "Total Solved"
    public static let dailyHowTitle = "How it works"
    public static let dailyHowBody = "Solve today's puzzle to keep your streak alive. Miss a day "
        + "and it resets to zero. Come back every day to build your longest streak!"
    public static let dailyStart = "🧩 Solve Today's Puzzle"
    public static let dailySolvedTitle = "Puzzle Solved!"
    public static let dailySolvedSub = "Come back tomorrow — today's puzzle is already solved."
    public static let dailyLoading = "Loading today's puzzle..."
    public static let dailyWin = "🏆 Puzzle Solved! Streak updated!"
    public static let dailyMiss = "✗ Not the right move — try again!"
    public static let dailyWhite = "White ♙ to move"
    public static let dailyBlack = "Black ♟ to move"
    public static let dailyDone = "← Back to Daily Puzzle"

    // Thematic (Part 19)
    public static let thematicTitle = "Thematic Puzzles"
    public static let thematicBadge = "🎯 THEMED TRAINING"
    public static let thematicChoose = "Choose a Theme"
    public static let thematicSelectPrompt = "Select a Theme"
    public static func thematicStart(_ label: String) -> String { "Start \(label) Puzzles" }
    public static func thematicSolved(_ n: Int) -> String { "Solved: \(n)" }
    public static let thematicRating = "Puzzle Rating"
    public static let thematicHintWhite = "♙ You play White — Find the best move!"
    public static let thematicHintBlack = "♟ You play Black — Find the best move!"
    public static let thematicWin = "✅ Puzzle Solved!"
    public static let thematicMiss = "❌ Wrong move!"
    public static let thematicDry = "All puzzles solved for this theme!"

    // MARK: Streak (Part 13) and Turbo (Part 14)
    //
    // Added in Phase G. They were written into the JS twin in Phase E and never here, so
    // the Swift side had 86 of the 138 strings and nothing compared the two tables.
    // `replay_puzzle_core.js` now asserts key parity in both directions.

    public static let streakTitle = "Puzzle Streak"
    public static let streakBadge = "🔥 STREAK"
    public static let streakCurrent = "Current Streak"
    public static let streakOneMistake = "One mistake ends it!"
    public static let streakBest = "Best"
    public static let streakCurrentShort = "Current"
    public static let streakNoTimer = "No Timer"
    public static let streakRecent = "🔥 Recent Runs"
    public static let streakEmpty = "No runs yet — start your first streak! 🔥"
    public static let streakStart = "🔥 Start Streak"
    public static let streakResumeStart = "🔥 Resume / New Streak"
    public static let streakResumeTitle = "Resume Session?"
    public static let streakNewGame = "New Game"
    public static let streakContinue = "Continue"
    public static let streakLoading = "Loading puzzle..."
    public static let streakStatStreak = "Streak"
    public static let streakStatBest = "Best"
    public static let streakGameOver = "Game Over"
    public static let streakNewBest = "🏆 NEW BEST!"
    public static let streakShowSolution = "💡 Show Solution"
    public static let streakPlayAgain = "🔄 Play Again"
    public static let streakBackToMenu = "← Back to Menu"
    public static let streakCorrectMove = "Correct move:"
    public static let streakStripMenu = "Menu"
    public static let streakStripPlayAgain = "Play Again"
    public static let turboTitle = "Puzzle Turbo"
    public static let turboBadge = "⚡ RUSH"
    public static let turboInfo = "Solve as many puzzles as you can!"
    public static let turboMistakes = "3 mistakes = game over"
    public static let turboSelectMode = "SELECT MODE"
    public static let turboEmpty = "No runs yet — be the first! ⚡"
    public static let turboResumeTitle = "Resume Session?"
    public static let turboNewSession = "New Session"
    public static let turboResume = "Resume"
    public static let turboLoading = "Loading puzzles..."
    public static let turboQuit = "Quit"
    public static let turboScore = "Score"
    public static let turboMode = "Mode"
    public static let turboWhite = "♙ White to move"
    public static let turboBlack = "♟ Black to move"
    public static let turboSolved = "Puzzles Solved"
    public static let turboBack = "← Back to Puzzle Turbo"
    public static let turboQuitTitle = "Quit Puzzle Turbo?"
    public static let turboQuitBody = "Your current run will be lost."
    public static let turboKeepPlaying = "Keep Playing"

    /// The nine that interpolate. Transcribed from the JS twin's `STR` and pinned to it by the
    /// key-parity assertion in `replay_puzzle_core.js` — the check whose absence let all 61 of
    /// these strings exist in one language only for two phases.
    public static func streakResumeBody(_ n: Int) -> String {
        "You have an unfinished streak (\u{1F525} \(n) solved). Continue where you left off or start fresh?"
    }
    public static func streakBestLine(_ n: Int) -> String { "Best: \(n)" }
    /// Which side the solver plays. Same sentence, different piece glyph.
    public static func streakHint(_ white: Bool) -> String {
        white ? "\u{2659} You play White \u{2014} Find the best move!"
              : "\u{265F} You play Black \u{2014} Find the best move!"
    }

    public static func turboBest(_ n: Int) -> String { "Best: \(n)" }
    public static func turboRecent(_ label: String) -> String { "\u{1F3C6} \(label) Runs" }
    /// `0` is the infinite sentinel, so it reads as a word rather than "0 min".
    public static func turboStart(_ minutes: Int) -> String {
        minutes == 0 ? "\u{26A1} Start Rush (Infinite)" : "\u{26A1} Start Rush (\(minutes) min)"
    }
    public static func turboResumeBody(_ score: Int, _ mistakes: Int) -> String {
        "You have a previous session (Score: \(score), Mistakes: \(mistakes)/3). "
        + "Resume or start fresh?"
    }
    /// Singular at one, plural everywhere else — including zero.
    public static func turboMistakeCount(_ n: Int) -> String {
        "\u{274C} \(n) mistake" + (n == 1 ? "" : "s")
    }
    public static func turboModeLine(_ minutes: Int) -> String {
        minutes == 0 ? "\u{221E} Infinite mode" : "\u{23F1}\u{FE0F} \(minutes) min mode"
    }

    // MARK: Glyphs and formatting shared by the run screens
    //
    // Their own constants rather than literals in a view body, which is the rule that keeps
    // `PuzzleMetricsCheck` able to see everything. Each has a JS twin; the parity check enforces it.

    public static let streakTrophy = "\u{1F3C6}"
    public static let streakFlame = "\u{1F525}"
    public static let streakPawn = "\u{265F}"
    public static let infinity = "\u{221E}"
    /// A streak length wearing its flame: `🔥 12`.
    public static func streakRunScore(_ n: Int) -> String { "\u{1F525} \(n)" }
    /// A Turbo score wearing its bolt: `⚡ 30`.
    public static func turboRunScore(_ n: Int) -> String { "\u{26A1} \(n)" }
    public static func turboRunMistakes(_ n: Int) -> String { "\u{274C} \(n)" }

    public static let today = "Today"
    public static let yesterday = "Yesterday"
    /// Anything older than yesterday. `MMM d` — "Mar 12".
    public static let runDateFormat = "MMM d"

    /// The revealed move reads `E2 \u{2192} E4`, with ` (=Q)` when the UCI promotes.
    public static let moveArrow = " \u{2192} "
    public static let promotionSuffixOpen = " (="
    public static let promotionSuffixClose = ")"

    public static let turboBolt = "\u{26A1}"
    /// The life dots. Both are always drawn; opacity is what marks one as spent.
    public static let turboLifeSpent = "\u{274C}"
    public static let turboLifeLeft = "\u{26AA}"
    /// The feedback dot's two glyphs.
    public static let turboFeedbackOk = "\u{2713}"
    public static let turboFeedbackBad = "\u{2715}"
}

// MARK: - Derived, pure

public enum PuzzleDisplay {

    /// `MM:SS`, zero-padded, minutes uncapped — the source's own `formatTime`.
    public static func formatTime(_ seconds: Int?) -> String {
        guard let s = seconds, s >= 0 else { return PuzzleStrings.noTime }
        return String(format: "%02d:%02d", s / 60, s % 60)
    }

    public enum StripState: String, Equatable, Sendable {
        case playing, solved, wrong, solution
    }

    public struct Strip: Equatable, Sendable {
        public let state: StripState
        public let text: String
        public let color: Color
    }

    /// The info strip as ONE state, not four booleans (spec fix #11).
    ///
    /// The original evaluates four independent conditions, so "✅ Solved!" and "💡 Viewing
    /// Solution" can both render inside a 34pt strip. Here `reviewing` wins outright.
    public static func infoStrip(_ phase: PuzzleSession.Phase, userIsWhite: Bool,
                                 solveTimeSeconds: Int? = nil) -> Strip {
        switch phase {
        case .reviewing:
            return Strip(state: .solution, text: PuzzleStrings.viewingSolution,
                         color: PuzzlePalette.gold)
        case .solved:
            var t = PuzzleStrings.solved
            // Two spaces before the clock — the source's own spacing.
            if let s = solveTimeSeconds { t += "  ⏱ " + formatTime(s) }
            return Strip(state: .solved, text: t, color: PuzzlePalette.correct)
        case .failed:
            return Strip(state: .wrong, text: PuzzleStrings.wrongMove, color: PuzzlePalette.wrong)
        case .playing, .loading:
            return Strip(state: .playing,
                         text: userIsWhite ? PuzzleStrings.whiteToMove : PuzzleStrings.blackToMove,
                         color: PuzzlePalette.textSecondary)
        }
    }

    public enum PanelButton: String, Equatable, Sendable {
        case solution, next, retry, solutionBtn, engine, save
    }

    public struct BottomPanel: Equatable, Sendable {
        public let buttons: [PanelButton]
        /// Retry and Solution sit side by side after a wrong move.
        public let row: Bool
    }

    /// Which screens have an engine panel and a Save sheet at all.
    ///
    /// Not a preference: `puzzle_styles.json` carries `enginePanel*` keys only on `playSolver` and
    /// `thematicSolver`, and `savePuzzle*` only on `playSolver`. Daily, Streak and Turbo genuinely
    /// do not have them, so offering the buttons would be inventing UI.
    public static func hasEnginePanel(_ mode: PuzzleSession.Mode) -> Bool {
        mode == .play || mode == .thematic
    }
    public static func hasSaveSheet(_ mode: PuzzleSession.Mode) -> Bool { mode == .play }

    /// How many engine lines a mode shows (Part 18): Play 2, Thematic 3.
    public static func engineLineCount(_ mode: PuzzleSession.Mode) -> Int {
        mode == .thematic ? PuzzleEnginePanel.thematicLines : PuzzleEnginePanel.playLines
    }

    /// The bottom-panel states (Part 10.2, band 5). Playing is deliberately empty — there are no
    /// buttons at all while solving.
    ///
    /// Takes the MODE, not just the phase. Written phase-only for Play, it returned
    /// Retry / Solution / Next on `failed` for every mode — which flatly contradicts
    /// `wrongPolicy(.streak).offersRetry == false` and the same for `.turbo`. Streak ends the run
    /// on a wrong move and Turbo moves straight to the next puzzle; neither offers a Retry. Two
    /// sources of truth for one fact, and the wrong one was the visible one.
    ///
    /// The wrong-move row is now DERIVED from the policy rather than restated, so they cannot
    /// drift again.
    public static func bottomPanel(_ phase: PuzzleSession.Phase,
                                   mode: PuzzleSession.Mode) -> BottomPanel {
        switch phase {
        case .solved:
            return BottomPanel(buttons: hasEnginePanel(mode) ? [.solution, .next] : [.next],
                               row: false)
        case .failed:
            guard PuzzleSession.wrongPolicy(mode).offersRetry else {
                return BottomPanel(buttons: [], row: false)
            }
            var btns: [PanelButton] = [.retry]
            if hasEnginePanel(mode) { btns.append(.solutionBtn) }
            btns.append(.next)
            return BottomPanel(buttons: btns, row: btns.count > 2)
        case .reviewing:
            var r: [PanelButton] = [.engine]
            if hasSaveSheet(mode) { r.append(.save) }
            r.append(.next)
            return BottomPanel(buttons: r, row: false)
        case .playing, .loading:
            return BottomPanel(buttons: [], row: false)
        }
    }

    public struct Delta: Equatable, Sendable {
        public let text: String
        public let color: Color
    }

    /// A rating delta's sign and colour. `nil` before any rated result.
    public static func deltaStyle(_ change: Int?) -> Delta? {
        guard let c = change else { return nil }
        return Delta(text: (c >= 0 ? "+" : "") + String(c),
                     color: c >= 0 ? PuzzlePalette.correct : PuzzlePalette.wrong)
    }
}
