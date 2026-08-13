import SwiftUI

// Play vs Coach: the handful of values that are NOT extracted, in one place so they can be counted.
//
// Everything the RN StyleSheets contain is in the generated `CoachMetrics.swift`. What is here is
// what has no counterpart there — SwiftUI structure the RN layout expresses differently, and the
// glyphs the browser twin also writes as literals. Each one is listed in `PORTING_NOTES.md` under
// "Invented, Swift side", and `CoachMetricsCheck` allows the screens to name only this enum and the
// generated ones, so a stray literal cannot hide among them.

/// Layout that SwiftUI needs and React Native did not express as a style property.
enum CoachLayout {

    /// RN spaces these sections with `marginBottom` on each child; SwiftUI uses one stack spacing.
    /// The value is `titleSub.marginTop`, which is the gap the source actually shows between the
    /// header block and what follows.
    static let sectionGap: CGFloat = CoachSelect.titleSubMarginTop

    /// The roster is two RN rows (`row1`, `row2`) of three and two cards. A `LazyVGrid` of three
    /// flexible columns reproduces that without hard-coding which coach is on which row.
    static let rosterColumns: [GridItem] = [
        GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()),
    ]

    /// The board is square. RN gets this from `BOARD_SIZE`; SwiftUI states it as a ratio so the
    /// board tracks the device instead of the reference width.
    static let boardAspect: CGFloat = 1

    /// `moveStripContent.gap`, as a stack spacing.
    static let stripGap: CGFloat = CoachPlay.moveStripContentGap

    /// One half-move, for `◀` / `▶`. A named constant only so no view body contains a bare `1`.
    static let oneStep: Int = 1

    static let enabledOpacity: Double = 1
    /// `navBtnDisabled.opacity` in the source.
    static let disabledOpacity: Double = CoachPlay.navBtnDisabledOpacity

    /// The resign scrim. RN renders a `Modal` with its own dimming; SwiftUI needs the colour.
    /// Matches the value the Puzzle Hub's prompts already use, rather than a second opinion.
    /// (The REVIEW modal needs no equivalent: `modalOverlay.backgroundColor` is extracted.)
    static let scrimOpacity: Double = 0.55

    /// `play.tsx` writes `coach.accentColor + '30'` for the review card's border — the accent with
    /// a hex alpha BYTE appended, which is spec §2.10's "accent @ 19 %". Kept as the byte and
    /// divided, because reading `30` as a percentage gives almost twice the strength; the Pairing
    /// Manager shipped exactly that confusion once, in a badge tint.
    static let accentBorderAlphaByte = 0x30
    static var accentBorderAlpha: Double { Double(accentBorderAlphaByte) / 255 }

    /// The premove chip sits inside the board's top-right corner. RN positions it absolutely with
    /// `top`/`right`; this is the same inset expressed as padding.
    static let premoveChipInset: CGFloat = CoachPlay.premoveChipPaddingHorizontal

    /// Promotion ranks, so `promotionSuffix` contains no bare `0` or `7`.
    static let lastRankWhite: Int = 7
    static let lastRankBlack: Int = 0

    /// Spec §7 #32 is that the RN premove ALWAYS auto-queened, losing every underpromotion. The
    /// default is still a queen — that is what a tap on a promotion square should do — but it is
    /// carried through `CoachTurn.Premove.promotion` explicitly, so the choice is the caller's and
    /// a promotion picker can be added without touching the mechanism.
    static let defaultPromotion = "q"
}

/// The nav and back glyphs.
///
/// Not `CoachStrings`: that file is generated from spec §2.14, which is COPY. These are icons that
/// happen to be characters, and the browser twin writes them as literals in `coach-play.js` for the
/// same reason. Kept together so the two languages can be compared at a glance.
enum CoachGlyph {
    static let back = "\u{2190}"        // ←
    static let first = "\u{23EE}"       // ⏮
    static let prev = "\u{25C0}"        // ◀
    static let next = "\u{25B6}"        // ▶
    static let last = "\u{23ED}"        // ⏭
}
