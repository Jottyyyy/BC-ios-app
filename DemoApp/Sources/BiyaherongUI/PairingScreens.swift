import SwiftUI
import BiyaherongCoachCore

// The Pairing Manager's root, list and create screens (spec 1.2-1.3).
//
// Twins of `web-demo/js/pairing-list.js` and `pairing-create.js`, which are rendered into a headless
// DOM by `tools/qa/pairing_screen_test.js`. Every number is a constant from the generated
// `PairingMetrics.swift`; there is no numeric literal or arithmetic in any body below, which is what
// lets the metrics check see the layout with no renderer.

enum PairingRoute: Hashable {
    case create
    case detail(Int)
}

/// The feature root. One `NavigationStack`, and children get closures rather than the path.
struct PairingRootScreen: View {
    @ObservedObject var store: PairingStore
    /// Free tournaments run to 3 rounds, premium to 30. Defaulted-free so the macOS demo's
    /// `TournamentView` panel, which has no store, is unaffected.
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void
    @State private var path: [PairingRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            PairingListScreen(store: store,
                              onOpen: { path.append(.detail($0)) },
                              onCreate: { path.append(.create) },
                              onExit: onExit)
                .navigationDestination(for: PairingRoute.self) { route in
                    destination(route).navigationBarBackTapHidden()
                }
        }
        .tint(PairingPalette.setup)
    }

    @ViewBuilder
    private func destination(_ route: PairingRoute) -> some View {
        switch route {
        case .create:
            PairingCreateScreen(store: store,
                                maxRounds: premium.maxSwissRounds,
                                onCreated: { id in
                                    path.removeLast()
                                    path.append(.detail(id))
                                },
                                onExit: { path.removeLast() })
        case .detail(let id):
            PairingDetailScreen(store: store, tournamentID: id, onExit: { path.removeLast() })
        }
    }
}

// MARK: - List (spec 1.2)

struct PairingListScreen: View {
    @ObservedObject var store: PairingStore
    let onOpen: (Int) -> Void
    let onCreate: () -> Void
    let onExit: () -> Void

    /// Which tournament the delete prompt is about. Nothing is removed until it is confirmed
    /// (spec 7 #18) — the RN app fired the request and dropped the row without ever checking the
    /// response, so a 422 looked like a success.
    @State private var pendingDelete: PairingDocument.Tournament?

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                header
                if store.tournaments.isEmpty { empty } else { list }
            }
            fab
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PairingList.containerBackgroundColor)
        .overlay { if let t = pendingDelete { deletePrompt(t) } }
    }

    private var header: some View {
        HStack(spacing: 0) {
            // A vector, not the `←` character the generated strings table used to carry.
            // The frame is untouched: `backBtnWidth` is an extracted StyleSheet value.
            NavIconButton(.back, size: PairingList.backArrowFontSize,
                          tint: PairingList.backArrowColor, action: onExit)
                .frame(width: PairingList.backBtnWidth, height: PairingList.backBtnHeight)
            VStack(spacing: PairingList.headerSubMarginTop) {
                Text(PairingStrings.tournaments)
                    .font(Theme.nunito(PairingList.headerTitleFontSize, .extraBold))
                    .foregroundStyle(PairingList.headerTitleColor)
                    .tracking(PairingList.headerTitleLetterSpacing)
                Text(PairingStrings.listSub)
                    .font(Theme.nunito(PairingList.headerSubFontSize))
                    .foregroundStyle(PairingList.headerSubColor)
                    .tracking(PairingList.headerSubLetterSpacing)
            }
            .frame(maxWidth: .infinity)
            HomeLogo(size: PairingList.backBtnWidth)
        }
        .padding(.horizontal, PairingList.headerPaddingHorizontal)
        .padding(.vertical, PairingList.headerPaddingVertical)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PairingList.headerBorderBottomColor)
                .frame(height: PairingList.headerBorderBottomWidth)
        }
    }

    private var empty: some View {
        VStack(spacing: 0) {
            Text(PairingStrings.emptyGlyph)
                .font(.system(size: PairingList.emptyIconFontSize))
                .foregroundStyle(PairingList.emptyIconColor)
                .padding(.bottom, PairingList.emptyIconMarginBottom)
            Text(PairingStrings.emptyTitle)
                .font(Theme.nunito(PairingList.emptyTitleFontSize, .bold))
                .foregroundStyle(PairingList.emptyTitleColor)
                .padding(.bottom, PairingList.emptyTitleMarginBottom)
            Text(PairingStrings.emptySub)
                .font(Theme.nunito(PairingList.emptySubFontSize))
                .foregroundStyle(PairingList.emptySubColor)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.bottom, PairingList.centerPaddingBottom)
    }

    private var list: some View {
        ScrollView {
            ForEach(store.tournaments, id: \.id) { t in
                card(t)
                    .padding(.bottom, PairingList.cardMarginBottom)
            }
            Text(PairingStrings.longPressHint)
                .font(Theme.nunitoItalic(PairingList.hintTextFontSize))
                .foregroundStyle(PairingList.hintTextColor)
                .frame(maxWidth: .infinity)
                .padding(.bottom, PairingList.hintTextPaddingBottom)
        }
        .padding(.horizontal, PairingList.listPaddingHorizontal)
        .padding(.top, PairingList.listPaddingTop)
        // The one that matters, and it was missing. `list: { paddingHorizontal: 14, paddingTop: 10,
        // paddingBottom: 90 }` (`tournaments/index.tsx:212`) — the 90 is what holds the scroll
        // content clear of the FAB floating over it in the same ZStack. Without it the last thing in
        // the ScrollView sits UNDER the New Tournament button, and the last thing in this ScrollView
        // is the long-press hint. A client reported it as "walang way na mag delete": the hint
        // explaining the only delete gesture was never visible. The browser applied all three
        // paddings from the start (`.pgl-list`), so nothing here could see it.
        .padding(.bottom, PairingList.listPaddingBottom)
    }

    private func card(_ t: PairingDocument.Tournament) -> some View {
        let accent = PairingPalette.type(t.type == .swiss)
        let status = PairingDocument.status(t)
        return Button {
            onOpen(t.id)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: PairingList.cardHeaderGap) {
                    Text(t.type == .swiss ? PairingStrings.swissBadge
                                          : PairingStrings.roundRobinBadge)
                        .font(Theme.nunito(PairingList.typeTextFontSize, .extraBold))
                        .tracking(PairingList.typeTextLetterSpacing)
                        .foregroundStyle(accent)
                        .padding(.horizontal, PairingList.typeBadgePaddingHorizontal)
                        .padding(.vertical, PairingList.typeBadgePaddingVertical)
                        // Hex alpha by byte, exactly as the source writes it — not a rounded percent.
                        .background(accent.opacity(PairingPalette.tintByte),
                                    in: RoundedRectangle(cornerRadius: PairingList.typeBadgeBorderRadius))
                        .overlay(RoundedRectangle(cornerRadius: PairingList.typeBadgeBorderRadius)
                            .stroke(accent, lineWidth: PairingList.typeBadgeBorderWidth))
                    Circle()
                        .fill(PairingPalette.status(status.rawValue))
                        .frame(width: PairingList.statusDotWidth,
                               height: PairingList.statusDotHeight)
                        .padding(.leading, PairingList.statusDotMarginLeft)
                        .padding(.trailing, PairingList.statusDotMarginRight)
                    Text(statusLabel(status))
                        .font(Theme.nunito(PairingList.statusTextFontSize, .bold))
                        .tracking(PairingList.statusTextLetterSpacing)
                        .foregroundStyle(PairingPalette.status(status.rawValue))
                    Spacer(minLength: 0)
                    Text(PairingStrings.chevron)
                        .font(Theme.nunito(PairingList.cardChevronFontSize))
                        .foregroundStyle(PairingList.cardChevronColor)
                }
                .padding(.bottom, PairingList.cardHeaderMarginBottom)

                Text(t.name)
                    .font(Theme.nunito(PairingList.cardNameFontSize, .bold))
                    .foregroundStyle(PairingList.cardNameColor)
                    .lineLimit(1)
                    .padding(.bottom, PairingList.cardNameMarginBottom)

                stats(t)
            }
            .padding(PairingList.cardPadding)
            .background(PairingList.cardBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingList.cardBorderRadius))
            .overlay(RoundedRectangle(cornerRadius: PairingList.cardBorderRadius)
                .stroke(PairingList.cardBorderColor, lineWidth: PairingList.cardBorderWidth))
        }
        .buttonStyle(PuzzlePressStyle(scale: PuzzlePress.cardScale))
        .onLongPressGesture { pendingDelete = t }
    }

    private func stats(_ t: PairingDocument.Tournament) -> some View {
        HStack(spacing: 0) {
            statCell(String(t.players.count), PairingStrings.players)
            divider
            statCell(PairingStrings.roundsMeta(t.rounds.count, PairingDocument.totalRoundsOf(t)),
                     PairingStrings.rounds)
            divider
            statCell(PairingRunDate.created(t.createdAt), PairingStrings.created)
        }
        .padding(.vertical, PairingList.cardStatsPaddingVertical)
        .padding(.horizontal, PairingList.cardStatsPaddingHorizontal)
        .background(PairingList.cardStatsBackgroundColor,
                    in: RoundedRectangle(cornerRadius: PairingList.cardStatsBorderRadius))
    }

    private var divider: some View {
        Rectangle()
            .fill(PairingList.statDividerBackgroundColor)
            .frame(width: PairingList.statDividerWidth, height: PairingList.statDividerHeight)
    }

    private func statCell(_ value: String, _ label: String) -> some View {
        VStack(spacing: 0) {
            Text(value)
                .font(Theme.nunito(PairingList.statValueFontSize, .extraBold))
                .foregroundStyle(PairingList.statValueColor)
            Text(label)
                .font(Theme.nunito(PairingList.statLabelFontSize, .medium))
                .foregroundStyle(PairingList.statLabelColor)
                .padding(.top, PairingList.statLabelMarginTop)
        }
        .frame(maxWidth: .infinity)
    }

    private var fab: some View {
        Button(action: onCreate) {
            HStack(spacing: PairingList.fabGap) {
                Text(PairingStrings.fabPlus)
                    .font(Theme.nunito(PairingList.fabIconFontSize, .extraBold))
                    .foregroundStyle(PairingList.fabIconColor)
                Text(PairingStrings.newTournament)
                    .font(Theme.nunito(PairingList.fabTextFontSize, .extraBold))
                    .foregroundStyle(PairingList.fabTextColor)
                    .tracking(PairingList.fabTextLetterSpacing)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, PairingList.fabPaddingVertical)
            .background(PairingList.fabBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingList.fabBorderRadius))
            .shadow(color: PairingList.fabShadowColor.opacity(PairingList.fabShadowOpacity),
                    radius: PairingList.fabShadowRadius,
                    x: PairingList.fabShadowOffsetWidth,
                    y: PairingList.fabShadowOffsetHeight)
        }
        .buttonStyle(PuzzlePressStyle())
        .padding(.horizontal, PairingList.fabLeft)
        .padding(.bottom, PairingList.fabLeft)
    }

    private func deletePrompt(_ t: PairingDocument.Tournament) -> some View {
        PuzzleModal(title: PairingStrings.deleteTitle,
                    body: PairingStrings.deleteBody(t.name),
                    dangerTitle: PairingStrings.deleteAction,
                    keepTitle: PairingStrings.cancel,
                    onDanger: {
                        pendingDelete = nil
                        store.remove(t.id)
                    },
                    onKeep: { pendingDelete = nil })
    }

    private func statusLabel(_ s: PairingDocument.Status) -> String {
        switch s {
        case .setup: return PairingStrings.statusSetup
        case .ongoing: return PairingStrings.statusOngoing
        case .finished: return PairingStrings.statusFinished
        }
    }
}

// MARK: - Create (spec 1.3)

struct PairingCreateScreen: View {
    @ObservedObject var store: PairingStore
    /// The Swiss round ceiling for this user — 3 free, 30 premium. Defaulted to the premium
    /// ceiling so the macOS `TournamentView` panel keeps behaving as it did.
    var maxRounds: Int = TournamentEngine.premiumMaxRounds
    let onCreated: (Int) -> Void
    let onExit: () -> Void

    @State private var name = ""
    @State private var kind: PairingDocument.Kind = .swiss
    @State private var rounds = PairingCreateScreen.presets[0]
    @State private var freeRounds = ""
    @State private var showRequired = false

    /// The four presets from the source, beside a free-entry field.
    static let presets = [3, 5, 7, 9]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    label(PairingStrings.nameLabel)
                    nameField
                    label(PairingStrings.formatLabel).padding(.top, PairingCreate.rrNoteMarginTop)
                    formatRow
                    if kind == .swiss { roundsSection } else { rrNote }
                }
                .padding(PairingCreate.bodyContentPadding)
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PairingCreate.containerBackgroundColor)
        .overlay { if showRequired { requiredPrompt } }
    }

    private var header: some View {
        HStack(spacing: 0) {
            // A vector, not the `←` character the generated strings table used to carry.
            // The frame is untouched: `backBtnWidth` is an extracted StyleSheet value.
            NavIconButton(.back, size: PairingCreate.backArrowFontSize,
                          tint: PairingCreate.backArrowColor, action: onExit)
                .frame(width: PairingCreate.backBtnWidth, height: PairingCreate.backBtnHeight)
            Text(PairingStrings.newTournament)
                .font(Theme.nunito(PairingCreate.headerTitleFontSize, .extraBold))
                .foregroundStyle(PairingCreate.headerTitleColor)
                .frame(maxWidth: .infinity)
            HomeLogo(size: PairingCreate.backBtnWidth)
        }
        .padding(.horizontal, PairingCreate.headerPaddingHorizontal)
        .padding(.vertical, PairingCreate.headerPaddingVertical)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PairingCreate.headerBorderBottomColor)
                .frame(height: PairingCreate.headerBorderBottomWidth)
        }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Theme.nunito(PairingCreate.labelFontSize, .bold))
            .foregroundStyle(PairingCreate.labelColor)
            .tracking(PairingCreate.labelLetterSpacing)
            .padding(.bottom, PairingCreate.labelMarginBottom)
    }

    private var nameField: some View {
        TextField(PairingStrings.namePlaceholder, text: $name)
            .textFieldStyle(.plain)
            .font(Theme.nunito(PairingCreate.inputFontSize))
            .foregroundStyle(PairingCreate.inputColor)
            .padding(.horizontal, PairingCreate.inputPaddingHorizontal)
            .padding(.vertical, PairingCreate.inputPaddingVertical)
            .background(PairingCreate.inputBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingCreate.inputBorderRadius))
            .overlay(RoundedRectangle(cornerRadius: PairingCreate.inputBorderRadius)
                .stroke(PairingCreate.inputBorderColor, lineWidth: PairingCreate.inputBorderWidth))
    }

    private var formatRow: some View {
        HStack(spacing: PairingCreate.typeRowGap) {
            formatCard(.swiss, PairingStrings.swissGlyph, PairingStrings.swiss,
                       PairingStrings.swissDesc)
            formatCard(.roundRobin, PairingStrings.roundRobinGlyph, PairingStrings.roundRobin,
                       PairingStrings.roundRobinDesc)
        }
    }

    private func formatCard(_ k: PairingDocument.Kind, _ glyph: String,
                            _ title: String, _ desc: String) -> some View {
        let on = kind == k
        let accent = PairingPalette.type(k == .swiss)
        return Button { kind = k } label: {
            VStack(alignment: .leading, spacing: 0) {
                Text(glyph)
                    .font(Theme.nunito(PairingCreate.typeIconTextFontSize, .extraBold))
                    .foregroundStyle(PairingCreate.typeIconTextColor)
                    .frame(width: PairingCreate.typeIconWidth, height: PairingCreate.typeIconHeight)
                    .background(on ? accent : PairingDetail.playerSeedBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingCreate.typeIconBorderRadius))
                    .padding(.bottom, PairingCreate.typeIconMarginBottom)
                Text(title)
                    .font(Theme.nunito(PairingCreate.typeNameFontSize, .extraBold))
                    .foregroundStyle(on ? accent : PairingCreate.typeNameColor)
                    .padding(.bottom, PairingCreate.typeNameMarginBottom)
                Text(desc)
                    .font(Theme.nunito(PairingCreate.typeDescFontSize))
                    .foregroundStyle(PairingCreate.typeDescColor)
                    .lineSpacing(PairingCreate.typeDescLineHeight)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PairingCreate.typeCardPadding)
            .background(on ? activeFill(k) : PairingCreate.typeCardBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingCreate.typeCardBorderRadius))
            .overlay(RoundedRectangle(cornerRadius: PairingCreate.typeCardBorderRadius)
                .stroke(on ? accent : PairingCreate.typeCardBorderColor,
                        lineWidth: PairingCreate.typeCardBorderWidth))
        }
        .buttonStyle(PuzzlePressStyle(scale: PuzzlePress.cardScale))
    }

    /// The selected fill is written as an explicit rgba in the source, so it is an extracted style
    /// rather than a computed tint.
    private func activeFill(_ k: PairingDocument.Kind) -> Color {
        k == .swiss ? PairingCreate.typeCardActiveBackgroundColor
                    : PairingCreate.typeCardActiveRRBackgroundColor
    }

    private var roundsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            label(PairingStrings.roundsLabel).padding(.top, PairingCreate.rrNoteMarginTop)
            HStack(spacing: PairingCreate.roundsRowGap) {
                ForEach(PairingCreateScreen.presets, id: \.self) { n in
                    // A preset above the user's ceiling clamps to it rather than being hidden —
                    // the hint below says why, which is more honest than a preset that vanishes.
                    Button { rounds = min(maxRounds, n); freeRounds = "" } label: {
                        Text(String(n))
                            .font(Theme.nunito(PairingCreate.roundBtnTextFontSize, .extraBold))
                            .foregroundStyle(rounds == n ? PairingCreate.roundBtnTextActiveColor
                                                         : PairingCreate.roundBtnTextColor)
                            .frame(width: PairingCreate.roundBtnWidth,
                                   height: PairingCreate.roundBtnHeight)
                            .background(rounds == n ? PairingCreate.roundBtnActiveBackgroundColor
                                                    : PairingCreate.roundBtnBackgroundColor,
                                        in: RoundedRectangle(cornerRadius: PairingCreate.roundBtnBorderRadius))
                            .overlay(RoundedRectangle(cornerRadius: PairingCreate.roundBtnBorderRadius)
                                .stroke(rounds == n ? PairingCreate.roundBtnActiveBorderColor
                                                    : PairingCreate.roundBtnBorderColor,
                                        lineWidth: PairingCreate.roundBtnBorderWidth))
                    }
                    .buttonStyle(PuzzlePressStyle())
                }
                TextField(PairingStrings.roundsPlaceholder, text: $freeRounds)
                    .textFieldStyle(.plain)
                    .multilineTextAlignment(.center)
                    .font(Theme.nunito(PairingCreate.roundInputFontSize))
                    .foregroundStyle(PairingCreate.roundInputColor)
                    .padding(.horizontal, PairingCreate.roundInputPaddingHorizontal)
                    .padding(.vertical, PairingCreate.roundInputPaddingVertical)
                    .background(PairingCreate.roundInputBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingCreate.roundInputBorderRadius))
                    .onChange(of: freeRounds) { _, v in
                        // Clamped, and the clamp is the store's — one rule, not two — then capped
                        // by the entitlement on top of it.
                        if let n = Int(v) { rounds = min(maxRounds, PairingDocument.clampRounds(n)) }
                    }
            }
            // The live recommendation, in place of the deleted free-plan limit notice.
            Text(PairingStrings.recommended(recommendFor,
                                            PairingEngine.recommendedRounds(recommendFor)))
                .font(Theme.nunito(PairingCreate.hintFontSize))
                .foregroundStyle(PairingCreate.hintColor)
                .padding(.top, PairingCreate.hintMarginTop)
            if maxRounds < TournamentEngine.premiumMaxRounds {
                Text(PaywallStrings.fill(PaywallStrings.roundsCap, ["n": String(maxRounds)]))
                    .font(Theme.nunito(PairingCreate.hintFontSize))
                    .foregroundStyle(PaywallPalette.title)
                    .padding(.top, PairingCreate.hintMarginTop)
            }
        }
    }

    /// Nobody has been added yet at create time, so the guidance is shown for the largest preset —
    /// the honest thing it can say before the field exists.
    private var recommendFor: Int { PairingCreateScreen.presets[PairingCreateScreen.presets.count - 1] }

    private var rrNote: some View {
        Text(PairingStrings.rrNote)
            .font(Theme.nunito(PairingCreate.rrNoteTextFontSize))
            .foregroundStyle(PairingCreate.rrNoteTextColor)
            .lineSpacing(PairingCreate.rrNoteTextLineHeight)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(PairingCreate.rrNotePadding)
            .background(PairingCreate.rrNoteBackgroundColor,
                        in: RoundedRectangle(cornerRadius: PairingCreate.rrNoteBorderRadius))
            .overlay(RoundedRectangle(cornerRadius: PairingCreate.rrNoteBorderRadius)
                .stroke(PairingCreate.rrNoteBorderColor, lineWidth: PairingCreate.rrNoteBorderWidth))
            .padding(.top, PairingCreate.rrNoteMarginTop)
    }

    private var footer: some View {
        Button {
            // A visible message, not a silent substitution. The RN screen turned a typed `0` into 3
            // with no feedback and let `99` through to a server 422.
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                showRequired = true
                return
            }
            guard let id = store.create(name: name, type: kind,
                                        totalRounds: kind == .swiss ? rounds : nil) else {
                showRequired = true
                return
            }
            onCreated(id)
        } label: {
            Text(PairingStrings.createTournament)
                .font(Theme.nunito(PairingCreate.createBtnTextFontSize, .extraBold))
                .foregroundStyle(PairingCreate.createBtnTextColor)
                .tracking(PairingCreate.createBtnTextLetterSpacing)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PairingCreate.createBtnPaddingVertical)
                .background(PairingCreate.createBtnBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingCreate.createBtnBorderRadius))
                .opacity(name.isEmpty ? PairingCreate.createBtnDisabledOpacity : 1)
        }
        .buttonStyle(PuzzlePressStyle())
        .padding(.horizontal, PairingCreate.footerPaddingHorizontal)
        .padding(.top, PairingCreate.footerPaddingTop)
        .padding(.bottom, PairingCreate.footerPaddingTop)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(PairingCreate.footerBorderTopColor)
                .frame(height: PairingCreate.footerBorderTopWidth)
        }
    }

    private var requiredPrompt: some View {
        PuzzleModal(title: PairingStrings.required,
                    body: PairingStrings.enterName,
                    dangerTitle: PairingStrings.cancel,
                    keepTitle: PairingStrings.cancel,
                    onDanger: { showRequired = false },
                    onKeep: { showRequired = false })
    }
}

// MARK: - Dates

/// "Mar 12", in the DEVICE's calendar (spec 7 #21).
///
/// The RN app rendered `created_at` — a UTC ISO string — through `toLocaleDateString('en-PH')`, so a
/// tournament created at 06:00 Manila time displayed the previous day. Here the stored value is an
/// epoch millisecond and the formatter is given the current calendar.
enum PairingRunDate {
    static func created(_ ms: Int) -> String {
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let f = DateFormatter()
        f.dateFormat = PairingStrings.createdDateFormat
        return f.string(from: date)
    }
}
