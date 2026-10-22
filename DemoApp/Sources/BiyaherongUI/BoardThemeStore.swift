import SwiftUI

/// The one board theme every board in the app draws — Profile → "♟️ Board Theme".
///
/// ── The bug this exists to fix ────────────────────────────────────────────────
/// Client round 3: *"hindi mapalitan kulay sa chessboard ng puzzle"*. The RN app has ONE theme,
/// persisted (`BoardThemeContext.tsx`, AsyncStorage `@board_theme`), chosen on the Profile screen
/// under "Applies to all chess boards" and read by every `DragDropChessBoard`. The port kept the
/// three themes as an unsaved `@Published` on `AnalysisVM`, reachable only from the Analysis
/// Board's ☰ menu — so the other eight boards, every puzzle mode among them, were always Classic
/// Brown, and even the Analysis Board forgot its choice each time it was reopened. The spec had
/// asked for exactly this setting (`BIYAHERONG-PORT-SPEC.md:1880`, "Persist it once, read it
/// everywhere") and it was never built.
///
/// ── How every board follows it ────────────────────────────────────────────────
/// `BoardView` observes this store directly, so all nine boards pick the theme up with no change
/// at any call site — the five puzzle solvers, Play vs Coach and the Opening Tree pass no `style:`
/// at all. A board that genuinely wants its own squares opts out with `BoardStyle.followsAppTheme`.
///
/// Mirrored in `web-demo/js/board-theme.js`, which owns the same key.
@MainActor
final class BoardThemeStore: ObservableObject {
    static let shared = BoardThemeStore()

    /// Copied into `LoginAccountData.erasedKeys` and `web-demo/js/board-theme.js`;
    /// `tools/qa/board_theme_check.js` checks all three agree.
    static let storageKey = "biya.board.theme.v1"

    /// Written through on change, the shape `AnalysisVM.engineSettings` uses. An unknown stored
    /// value — a theme removed in a later build — reads back as the default rather than failing.
    @Published var theme: BoardTheme {
        didSet {
            guard theme != oldValue else { return }
            defaults.set(theme.rawValue, forKey: Self.storageKey)
        }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = defaults.string(forKey: Self.storageKey).flatMap(BoardTheme.init(rawValue:))
            ?? .default
    }

    /// Delete-account. `AccountDeletion` erases the key, but this store outlives the screen that
    /// asked, so without this the deleted choice would stay on every board until a relaunch — and
    /// the next change would write it straight back.
    func forget() {
        theme = .default
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// The Profile card — RN `profile/index.tsx`, the "Board Theme Settings" section.
///
/// Every value below is extracted: `tools/metrics/board_styles.json` → `boardThemes`, which
/// `tools/qa/board_theme_check.js` compares this enum and the browser twin against.
enum BoardThemePicker {
    static let title = "♟️ Board Theme"
    static let subtitle = "Applies to all chess boards"
    static let check = "✓"

    // sectionCard / sectionTitle / sectionSubtitle
    static let cardFill = Theme.c(0x1A2942)
    static let cardRadius: CGFloat = 16
    static let cardPadding: CGFloat = 16
    static let titleSize: CGFloat = 16
    static let titleColor = Theme.c(0xFFFFFF)
    static let titleMarginBottom: CGFloat = 4
    static let subtitleSize: CGFloat = 12
    static let subtitleColor = Theme.c(0x8BA3C7)
    static let subtitleMarginBottom: CGFloat = 12

    // themeOption / themeOptionActive
    static let optionGap: CGFloat = 14
    static let optionPadding: CGFloat = 12
    static let optionRadius: CGFloat = 12
    static let optionMarginTop: CGFloat = 8
    static let optionFill = Theme.c(0x253552)
    static let activeFill = Theme.c(0x1E3A5F)
    static let activeBorder: CGFloat = 1
    static let activeBorderColor = Theme.c(0xFDB022)

    // miniBoard / miniSquare — a 4 x 4 corner of the board, light where (row + column) is even
    static let miniBoard: CGFloat = 40
    static let miniRadius: CGFloat = 4
    static let miniSquare: CGFloat = 10
    static let miniCells = 4

    // themeOptionLabel(Active) / themeCheckmark
    static let labelSize: CGFloat = 15
    static let labelColor = Theme.c(0x8BA3C7)
    static let labelActiveColor = Theme.c(0xFFFFFF)
    static let checkSize: CGFloat = 18
    static let checkColor = Theme.c(0xFDB022)

    /// `(r + c) % 2 === 0 ? t.light : t.dark` — the top-left square is LIGHT, as on a real board
    /// seen from White.
    static func isLight(row: Int, column: Int) -> Bool { (row + column) % 2 == 0 }
}

/// The three-row picker: a mini board, the label, and a gold ✓ on the one in use.
struct BoardThemePickerCard: View {
    @ObservedObject var store: BoardThemeStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(BoardThemePicker.title)
                .font(Theme.nunito(BoardThemePicker.titleSize, .bold))
                .foregroundStyle(BoardThemePicker.titleColor)
                .padding(.bottom, BoardThemePicker.titleMarginBottom)
            Text(BoardThemePicker.subtitle)
                .font(Theme.nunito(BoardThemePicker.subtitleSize, .regular))
                .foregroundStyle(BoardThemePicker.subtitleColor)
                .padding(.bottom, BoardThemePicker.subtitleMarginBottom)
            ForEach(BoardTheme.allCases) { option(for: $0) }
        }
        .padding(BoardThemePicker.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BoardThemePicker.cardFill,
                    in: RoundedRectangle(cornerRadius: BoardThemePicker.cardRadius))
    }

    private func option(for t: BoardTheme) -> some View {
        let active = store.theme == t
        return Button { store.theme = t } label: {
            HStack(spacing: BoardThemePicker.optionGap) {
                miniBoard(t)
                Text(t.pickerLabel)
                    .font(Theme.nunito(BoardThemePicker.labelSize, .semiBold))
                    .foregroundStyle(active ? BoardThemePicker.labelActiveColor
                                            : BoardThemePicker.labelColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if active {
                    Text(BoardThemePicker.check)
                        .font(Theme.nunito(BoardThemePicker.checkSize, .bold))
                        .foregroundStyle(BoardThemePicker.checkColor)
                }
            }
            .padding(BoardThemePicker.optionPadding)
            .background(active ? BoardThemePicker.activeFill : BoardThemePicker.optionFill,
                        in: RoundedRectangle(cornerRadius: BoardThemePicker.optionRadius))
            .overlay(RoundedRectangle(cornerRadius: BoardThemePicker.optionRadius)
                .stroke(active ? BoardThemePicker.activeBorderColor : .clear,
                        lineWidth: BoardThemePicker.activeBorder))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, BoardThemePicker.optionMarginTop)
        .accessibilityLabel(Text(t.label))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func miniBoard(_ t: BoardTheme) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<BoardThemePicker.miniCells, id: \.self) { r in
                HStack(spacing: 0) {
                    ForEach(0..<BoardThemePicker.miniCells, id: \.self) { c in
                        Rectangle()
                            .fill(BoardThemePicker.isLight(row: r, column: c) ? t.light : t.dark)
                            .frame(width: BoardThemePicker.miniSquare,
                                   height: BoardThemePicker.miniSquare)
                    }
                }
            }
        }
        .frame(width: BoardThemePicker.miniBoard, height: BoardThemePicker.miniBoard)
        .clipShape(RoundedRectangle(cornerRadius: BoardThemePicker.miniRadius))
    }
}
