import SwiftUI

// Every number and colour the Opening Tree draws, and nothing else. Twin of
// `web-demo/js/opening-metrics.js`.
//
// Nothing here is transcribed from prose. `tools/metrics/extract_opening_styles.js` walks
// `analysis-board/openingtree.tsx` into `tools/metrics/opening_styles.json`, and the JS twin's
// `selfTestSource()` asserts all 131 of these values against it — the assertion that catches a
// mistyped digit, which no amount of agreement between two hand-typed copies ever will.
//
// The RN file is three screens behind one `view` state (`'list' | 'form' | 'explorer'`) sharing one
// StyleSheet. These blocks split it the way the ported screens do.

// MARK: - The board's width

/// **The explorer board's edge. The one entry point — nothing else on that screen picks.**
///
/// Same contract as `AnalysisBoard.edge` and for the same reason the CHANGELOG gives for it: the
/// board and the rail beside it must agree about how wide the board is, and two call sites reading
/// the same viewport is two chances to disagree.
///
/// It deliberately does **not** go through `AnalysisBoard.size`. That snap-to-8-physical-pixels
/// formula is pinned to `DragDropChessBoard.tsx` and belongs to the Analysis Board; this explorer
/// has been full-bleed in both languages since it shipped, the engine defaults OFF, and the
/// engine-off path has to stay byte-identical to what is on the client's phone today. Routing it
/// through `AnalysisBoard.edge` would narrow the board by 0.67pt on a screen nobody asked to change.
///
/// `AnalysisEval.railTotal` is READ, never copied into `OpeningLayout`: §6 of the replay requires
/// every `LAYOUT` key to be a literal `static let name = <number>`, so a copy is the only way to put
/// it there — and a copy of a derived number is exactly what these gates exist to stop.
enum OpeningBoard {
    static func edge(screenWidth: CGFloat, engineOn: Bool) -> CGFloat {
        max(0, screenWidth - (engineOn ? AnalysisEval.railTotal : 0))
    }
}

// MARK: - Palette

enum OpeningPalette {
    static let screenBg = Theme.c(0x0F1A2E)
    static let card = Theme.c(0x1A2942)
    static let cardDeep = Theme.c(0x111E33)
    static let hairline = Theme.c(0x1E3050)
    static let inputBorder = Theme.c(0x243654)
    static let text = Theme.c(0xFFFFFF)
    static let muted = Theme.c(0x8BA3C7)
    static let gold = Theme.c(0xFDB022)
    static let onGold = Theme.c(0x0F1A2E)
    static let chevron = Theme.c(0x5A6E87)
    static let danger = Theme.c(0xEF5350)

    /// The build CTA is green rather than gold: on the list screen gold is already the "open this
    /// tree" affordance, and two golds would make the primary action the ambiguous one.
    static let buildBg = Theme.c(0x1B5E20)
    static let buildBorder = Theme.c(0x2E7D32)

    static let infoBg = Theme.c(0x1A2B40)
    static let infoBorder = Theme.c(0x2A3D57)
    static let infoText = Theme.c(0x8FA8C4)

    static let doneBg = Theme.c(0x0D2010)
    static let doneBorder = Theme.c(0x2E7D32)
    static let doneText = Theme.c(0x4CAF50)
    static let errorBg = Theme.c(0x1A0808)
    static let errorBorder = Theme.c(0x5C1010)
    static let errorText = Theme.c(0xEF5350)

    // engine — extracted from `openingtree.tsx`. The panel's fill is `cardDeep`, its border
    // `hairline`, its prose `muted` and the ON state reuses `doneBg`/`doneText`; only these three
    // are new.
    static let engineToggleBorder = Theme.c(0x2A3F5A)   // engineToggleBtn.borderColor
    static let engineDepth = Theme.c(0x4A6080)          // engineDepthChip.color

    /// One colour per engine line, by rank — `ENGINE_MOVE_COLORS` in the RN module scope.
    ///
    /// NOT `AnalysisArrow.colors`, which carries the same three RGB triples at different alphas
    /// (0.85/0.80/0.80 against this screen's 0.90/0.85/0.85). They are two extractions of two
    /// screens and `opening-metrics.js`'s `selfTestSource` asserts these against
    /// `opening_styles.json`; reusing the other table would quietly fail that check, or pass it by
    /// having the check look away.
    static let engineRank: [Color] = [
        Color(.sRGB, red: 76 / 255, green: 175 / 255, blue: 80 / 255, opacity: 0.90),
        Color(.sRGB, red: 68 / 255, green: 138 / 255, blue: 255 / 255, opacity: 0.85),
        Color(.sRGB, red: 255 / 255, green: 152 / 255, blue: 0 / 255, opacity: 0.85),
    ]

    /// Clamped, so a fourth line drawn by a future multiPV cannot crash the panel.
    static func engineRankColor(_ rank: Int) -> Color {
        engineRank[min(max(rank, 0), engineRank.count - 1)]
    }

    /// The eval column's ink, by sign.
    ///
    /// The RN `getEvalColor` tests `startsWith('M')` BEFORE `startsWith('M-')`, so a black mate
    /// `M-3` comes back green — the losing side's forced mate painted as an advantage. That is a
    /// latent bug, not a decision, and `CLAUDE.md` says to port the intended behaviour: the minus
    /// is checked first here. Asserted by name in `replay_opening_tree.js`.
    static func engineEvalInk(_ text: String) -> Color {
        if text.isEmpty { return muted }
        if text.hasPrefix("-") || text.hasPrefix("M-") { return errorText }
        if text.hasPrefix("+") || text.hasPrefix("M") { return doneText }
        return muted
    }
}

// MARK: - The W/D/L bar

/// Three colours, and the ORDER is the semantics: wins · draws · losses, left to right, from the
/// **mover's** point of view (see `OpeningTree`). Extracted from `renderWdlBar`'s three inline
/// styles, which is the only place the RN file writes them — which is why the extractor names that
/// function explicitly rather than relying on the StyleSheet walk.
enum OpeningWDL {
    static let win = Theme.c(0x4CAF50)
    static let draw = Theme.c(0x888888)
    static let loss = Theme.c(0xEF5350)
    static let barHeight: CGFloat = 6
    static let barRadius: CGFloat = 3
}

// MARK: - Layout

enum OpeningLayout {
    // chrome, shared by all three views
    static let screenPadH: CGFloat = 16
    static let headerPadTop: CGFloat = 16
    static let headerPadBottom: CGFloat = 14
    static let backSize: CGFloat = 40
    static let backIconSize: CGFloat = 26
    static let titleSize: CGFloat = 20
    static let emptyPadH: CGFloat = 32
    static let emptyPadBottom: CGFloat = 60

    // list
    static let listGap: CGFloat = 10
    static let cardRadius: CGFloat = 14
    static let cardPad: CGFloat = 14
    static let cardGap: CGFloat = 10
    static let treeNameSize: CGFloat = 15
    static let treeNameGap: CGFloat = 4
    static let treeMetaSize: CGFloat = 12
    static let treeMetaLine: CGFloat = 18
    static let actionGap: CGFloat = 8
    static let loadRadius: CGFloat = 8
    static let loadPadH: CGFloat = 14
    static let loadPadV: CGFloat = 6
    static let loadTextSize: CGFloat = 13
    static let emptyIconSize: CGFloat = 56
    static let emptyIconGap: CGFloat = 12
    static let emptyTitleSize: CGFloat = 18
    static let emptyTitleGap: CGFloat = 8
    static let emptySubSize: CGFloat = 14
    static let emptySubLine: CGFloat = 22
    static let footerPadV: CGFloat = 12
    static let footerBorder: CGFloat = 1
    static let buildRadius: CGFloat = 14
    static let buildPadV: CGFloat = 16
    static let buildBorder: CGFloat = 1
    static let buildTextSize: CGFloat = 16

    // form
    static let formPadBottom: CGFloat = 32
    static let labelSize: CGFloat = 13
    static let labelTracking: CGFloat = 0.8
    static let labelTop: CGFloat = 20
    static let labelBottom: CGFloat = 8
    static let inputRadius: CGFloat = 10
    static let inputBorder: CGFloat = 1
    static let inputTextSize: CGFloat = 15
    static let inputPadH: CGFloat = 14
    static let inputPadV: CGFloat = 12
    /// INVENTED — the RN form has no PGN box, so there is nothing to extract. Taken from
    /// `pairing.css`'s `.pgd-modal-area`, the app's other paste-a-blob field, so the two agree.
    /// It is the ONE field with a minimum: a name and a username are one line, and a PGN that
    /// opens one line tall reads as a text input rather than as somewhere to paste four games.
    static let pgnMinHeight: CGFloat = 160
    static let toggleGap: CGFloat = 8
    static let toggleRadius: CGFloat = 10
    static let togglePadV: CGFloat = 12
    static let toggleBorder: CGFloat = 1
    static let toggleTextSize: CGFloat = 14
    static let submitRadius: CGFloat = 14
    static let submitPadV: CGFloat = 16
    static let submitTop: CGFloat = 16
    static let submitTextSize: CGFloat = 16
    static let infoRadius: CGFloat = 8
    static let infoBorder: CGFloat = 1
    static let infoPad: CGFloat = 12
    static let infoTop: CGFloat = 20
    static let infoBottom: CGFloat = 4
    static let infoTitleSize: CGFloat = 14
    static let infoTitleGap: CGFloat = 4
    static let infoSubSize: CGFloat = 13
    static let infoSubLine: CGFloat = 19

    // explorer
    static let boardGap: CGFloat = 12
    static let historyRadius: CGFloat = 10
    static let historyPadH: CGFloat = 14
    static let historyPadV: CGFloat = 8
    static let historyBottom: CGFloat = 10
    static let historySize: CGFloat = 13
    static let navGap: CGFloat = 10
    static let navRadius: CGFloat = 10
    static let navPadH: CGFloat = 16
    static let navPadV: CGFloat = 10
    static let navBorder: CGFloat = 1
    static let navTextSize: CGFloat = 14
    static let navDisabledOpacity: Double = 0.35
    static let navBottom: CGFloat = 10
    static let movesPadBottom: CGFloat = 32
    static let rowRadius: CGFloat = 12
    static let rowPad: CGFloat = 12
    static let rowBottom: CGFloat = 8
    static let rowGap: CGFloat = 12
    static let sanSize: CGFloat = 17
    static let sanWidth: CGFloat = 54
    static let statGap: CGFloat = 4
    static let statSize: CGFloat = 12
    static let chevronSize: CGFloat = 22
    // engine — every value EXTRACTED from `openingtree.tsx`'s StyleSheet, which the extractor has
    // been sweeping into `opening_styles.json` since the tree shipped. Nothing here is invented;
    // `opening-metrics.js`'s selfTestSource asserts each one against that file.
    static let engineTogglePadV: CGFloat = 8       // engineToggleBtn.paddingVertical
    static let engineTogglePadH: CGFloat = 14      // engineToggleBtn.paddingHorizontal
    static let engineToggleRadius: CGFloat = 10    // engineToggleBtn.borderRadius
    static let engineToggleBorder: CGFloat = 1     // engineToggleBtn.borderWidth
    static let engineToggleTop: CGFloat = 8        // engineToggleBtn.marginTop
    static let engineToggleBottom: CGFloat = 4     // engineToggleBtn.marginBottom
    static let engineToggleTextSize: CGFloat = 13  // engineToggleBtnText.fontSize
    static let engineRadius: CGFloat = 10          // engineSection.borderRadius
    static let engineBorder: CGFloat = 1           // engineSection.borderWidth
    static let enginePadH: CGFloat = 12            // engineSection.paddingHorizontal
    static let enginePadV: CGFloat = 8             // engineSection.paddingVertical
    static let engineGap: CGFloat = 4              // engineSection.gap
    static let engineBottom: CGFloat = 6           // engineSection.marginBottom
    static let engineRowPadV: CGFloat = 3          // engineLineRow.paddingVertical
    static let engineRowGap: CGFloat = 8           // engineLineRow.gap
    static let engineEvalSize: CGFloat = 12        // engineChipEval.fontSize
    static let engineEvalWidth: CGFloat = 42       // engineChipEval.minWidth
    static let engineSanSize: CGFloat = 13         // engineChipSan.fontSize
    static let engineSanWidth: CGFloat = 40        // engineChipSan.minWidth
    static let enginePvSize: CGFloat = 12          // engineLinePv.fontSize
    static let engineTextSize: CGFloat = 13        // engineLineText.fontSize
    static let engineDepthSize: CGFloat = 11       // engineDepthChip.fontSize
    static let engineDepthTop: CGFloat = 2         // engineDepthChip.marginTop
    static let engineStatusPadV: CGFloat = 4       // engineAnalyzingRow.paddingVertical

    static let noMovesRadius: CGFloat = 12
    static let noMovesPad: CGFloat = 20
    static let noMovesSize: CGFloat = 14

    // fetch banner
    static let bannerRadius: CGFloat = 10
    static let bannerPadH: CGFloat = 14
    static let bannerPadV: CGFloat = 10
    static let bannerBorder: CGFloat = 1
    static let bannerBottom: CGFloat = 8
    static let bannerRowBottom: CGFloat = 6
    static let bannerLabelSize: CGFloat = 13
    static let trackHeight: CGFloat = 4
    static let trackRadius: CGFloat = 2
}

// MARK: - Strings

/// The RN screen's copy where it has any, and new copy where the offline port changed what the
/// screen does — the game **sources**, above all. Flagged individually rather than silently mixed.
enum OpeningStrings {
    static let title = "Opening Tree"

    // list
    static let empty = "No trees yet"
    static let emptySub = "Build a tree from your games to see which openings you actually play, "
        + "and how they score."
    static let emptyIcon = "🌳"
    static let load = "Open"
    static let remove = "Delete"
    static let newTree = "+ New Tree"
    static let meta = "{games} games · {positions} positions · {colour}"

    // form
    static let colourLabel = "Side you played"
    static let sourceLabel = "Where the games come from"
    /// NEW — the offline port's own sources. The RN form offers Lichess and Chess.com only.
    static let sourcePgn = "Paste PGN"
    static let sourceCoach = "My Coach games"
    static let sourceLichess = "Lichess"
    static let sourceChesscom = "Chess.com"
    static let pgnLabel = "PGN"
    static let pgnPlaceholder = "[Event \"My games\"]\n\n1. e4 c5 2. Nf3 d6 1-0\n\n"
        + "[Event \"My games\"]\n\n1. d4 Nf6 2. c4 e6 0-1"
    static let userLabel = "Username"
    static let userPlaceholder = "your username on that site"
    static let maxLabel = "Games to fetch"
    /// What the box opens on. The RN form opens on the same 100 — its free ceiling — so a user who
    /// never touches the field gets the same tree in both apps.
    static let maxDefault = "100"
    static let maxPlaceholder = "e.g. 500"
    static let build = "Build Tree"
    static let building = "Building…"

    /// The online path is the ONE networked thing in the app, so it says so rather than failing
    /// silently in Airplane Mode.
    static let onlineNote = "Needs internet"
    static let onlineNoteSub = "Lichess and Chess.com are downloaded from your device. Everything "
        + "else in this app works offline — pasting a PGN does too."
    static let offlineNote = "Works offline"
    static let offlineNoteSub = "Both Lichess and Chess.com let you download all your games as a "
        + "PGN file; paste it here and nothing leaves the device."

    // engine — the toggle's two labels are the RN screen's, emoji and all.
    static let engineOn = "🔍 Engine: ON"
    static let engineOff = "🔍 Engine: OFF"
    static let engineAnalyzing = "Analyzing…"
    /// `d:12 · SF` when idle, `d:12…` while still searching — the RN depth chip's two spellings.
    static let engineDepth = "d:{n} · SF"
    static let engineDepthBusy = "d:{n}…"
    static let engineMate = "# Checkmate"
    static let engineStalemate = "= Stalemate"
    static let engineDraw = "= Draw"

    // off book — the state the old screen could not express. `noMoves` STAYS, for the genuine
    // on-book leaf: telling those two apart is the whole point.
    static let offBook = "Off book"
    static let offBookSub = "No game in this tree reached here. Play on to explore, "
        + "or go back to the line."
    static let offBookLimit = "That is as far as this goes. Go back to the line to keep exploring."
    static let backToTree = "Back to tree"

    // explorer
    static let noMoves = "No games reached this position."
    static let back = "← Back"
    static let forward = "Forward →"
    static let reset = "Reset"
    static let startPosition = "Starting position"
    static let movesHeader = "{n} moves played here"
    static let gamesSuffix = " games"
    static let wdl = "{w}W / {d}D / {l}L"

    // fetch banner
    static let fetching = "Downloading games…"
    static let fetched = "{n} games"
    static let done = "✓ Built from {n} games"

    // errors
    static let errNoPgn = "Paste some PGN first."
    static let errNoUser = "Enter a username."
    static let errNoGames = "No games found in that PGN."
    static let errNoCoachGames = "You have not finished a game against a coach yet."
    static let errNetwork = "Could not reach that site. Check your connection and try again."
    static let errUnknownUser = "No games found for that username."

    // MARK: - The tree's name, built rather than typed

    /// `hikaru · white`. The RN builds exactly this and never asks
    /// (`analysis-board/openingtree.tsx:531`):
    ///
    ///     const name = `${username} · ${playerColor}`
    ///
    /// The port had grown a **Tree name** field the RN never had, so every download made the user
    /// invent a label for a thing that already has one. A client asked for it back: *"Pwede ba
    /// tanggalin na yung tree name — automatic name ng tree eh yung account name na hahanapan ng
    /// tira."*
    static let autoNameTemplate = "{who} · {colour}"

    /// The `{who}` for a source with no account behind it.
    ///
    /// Paste PGN and My Coach games are the offline port's own — the RN form offers Lichess and
    /// Chess.com only — so there is no username to name them after. Deriving one from the PGN's
    /// `[White]`/`[Black]` headers was considered and rejected: it is a guess, it is wrong the
    /// moment a PGN holds more than one player's games, and nothing downstream uses it. A tree
    /// named for something that is not in it is worse than a tree named plainly.
    static let autoNamePasted = "Pasted games"

    /// The one place a tree's name is decided, in either language.
    ///
    /// `colour` arrives as the raw `OpeningTree.Colour` value — `white`/`black`/`both`, lower case,
    /// which is what the RN's `playerColor` is. The colour is part of the name and not just of the
    /// meta line underneath because two trees for one account, one per side, would otherwise be
    /// impossible to tell apart in the list.
    static func autoName(username: String, colour: String) -> String {
        let who = username.trimmingCharacters(in: .whitespacesAndNewlines)
        return fill(autoNameTemplate,
                    ["who": who.isEmpty ? autoNamePasted : who, "colour": colour])
    }

    /// `{k}` substitution, the same helper `PaywallStrings` uses. Never re-type a count into a
    /// string — that is how `Repertoire exceeds {actualCount} positions (max 500)` happened.
    static func fill(_ template: String, _ values: [String: String]) -> String {
        var out = template
        for (k, v) in values { out = out.replacingOccurrences(of: "{\(k)}", with: v) }
        return out
    }
}

// MARK: - Sources

/// Where a tree's games come from.
///
/// Declared as data rather than as a `switch` because both languages and
/// `tools/qa/replay_opening_tree.js` need the same answer to "is this one online?", and a
/// `switch` in three places is three chances to disagree.
enum OpeningSource: String, CaseIterable, Identifiable, Sendable, Codable {
    case pgn, coach, lichess, chesscom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pgn: return OpeningStrings.sourcePgn
        case .coach: return OpeningStrings.sourceCoach
        case .lichess: return OpeningStrings.sourceLichess
        case .chesscom: return OpeningStrings.sourceChesscom
        }
    }

    /// **The only `true`s in the app outside the future content client.** A source that needs the
    /// radio has to say so on screen; see `OpeningStrings.onlineNote`.
    var isOnline: Bool {
        switch self {
        case .pgn, .coach: return false
        case .lichess, .chesscom: return true
        }
    }

    /// Does the form show a username field for this source?
    var needsUsername: Bool { isOnline }
}
