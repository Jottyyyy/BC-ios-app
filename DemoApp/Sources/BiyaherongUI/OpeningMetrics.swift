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
    static let nameLabel = "Tree name"
    static let namePlaceholder = "e.g. My White repertoire"
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
    static let errNoName = "Give the tree a name."
    static let errNoPgn = "Paste some PGN first."
    static let errNoUser = "Enter a username."
    static let errNoGames = "No games found in that PGN."
    static let errNoCoachGames = "You have not finished a game against a coach yet."
    static let errNetwork = "Could not reach that site. Check your connection and try again."
    static let errUnknownUser = "No games found for that username."

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
