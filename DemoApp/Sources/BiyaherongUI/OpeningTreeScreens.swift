import SwiftUI
import BiyaherongCoachCore

// The Opening Tree's three screens: the saved-tree list, the build form and the explorer.
//
// One file, because the RN original is one file (`analysis-board/openingtree.tsx`, 1,457 lines,
// three views behind a `view` state) and they share a header, a palette and a store. Split by
// `struct` rather than by file, which is what `PairingScreens.swift` does for the same reason.
//
// Every number comes from `OpeningMetrics`, which the JS twin asserts against the extraction. No
// numeric literal appears in a view body — `tools/qa/swift_layout_check.js` fails the build if one
// does.

// MARK: - Root

/// The pushed route. Its own navigation state is the store's `openID`, so a repaint of the host
/// cannot reset it — the same rule `app.js` follows with `pairingOpenId`.
struct OpeningTreeRootScreen: View {
    @ObservedObject var store: OpeningTreeStore
    /// Only the build form reads it, and only for the download ceiling. It is threaded from the
    /// root rather than reached for globally because that is how `PairingRootScreen` and
    /// `CoachRootScreen` take it, and one screen inventing its own route to the entitlement is
    /// how the RN app ended up with three disagreeing copies of `is_premium`.
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void

    /// Nil until "+ New Tree" is tapped. A separate flag rather than a third case on `openID`,
    /// because a half-filled form is not a tree and must not be one.
    @State private var building = false

    var body: some View {
        Group {
            if building {
                OpeningTreeBuildScreen(store: store, premium: premium,
                                       onDone: { building = false })
            } else if store.open != nil {
                OpeningTreeExplorerScreen(store: store)
            } else {
                OpeningTreeListScreen(store: store,
                                      onBuild: { building = true },
                                      onExit: onExit)
            }
        }
        .background(OpeningPalette.screenBg)
    }
}

// MARK: - Shared chrome

/// `back · title · balance` — the same three-slot header every pushed route in this app uses, and
/// the same reason for the trailing balance as on Home: the title is centred by being flanked.
struct OpeningHeader: View {
    let title: String
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // The one shared back vector — never a `←` character, which Nunito does not have.
            // `nav_icons_check.js` fails any screen that draws its own.
            NavIconButton(.back, size: OpeningLayout.backIconSize,
                          tint: OpeningPalette.text, action: onBack)
                .frame(width: OpeningLayout.backSize, height: OpeningLayout.backSize)
            Text(title)
                .font(Theme.nunito(OpeningLayout.titleSize, .bold))
                .foregroundStyle(OpeningPalette.text)
                .frame(maxWidth: .infinity)
            Color.clear.frame(width: OpeningLayout.backSize, height: OpeningLayout.backSize)
        }
        .padding(.horizontal, OpeningLayout.screenPadH)
        .padding(.top, OpeningLayout.headerPadTop)
        .padding(.bottom, OpeningLayout.headerPadBottom)
    }
}

// MARK: - List

struct OpeningTreeListScreen: View {
    @ObservedObject var store: OpeningTreeStore
    let onBuild: () -> Void
    let onExit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            OpeningHeader(title: OpeningStrings.title, onBack: onExit)
            if store.trees.isEmpty { empty } else { list }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var empty: some View {
        VStack(spacing: 0) {
            Text(OpeningStrings.emptyIcon)
                .font(.system(size: OpeningLayout.emptyIconSize))
                .padding(.bottom, OpeningLayout.emptyIconGap)
            Text(OpeningStrings.empty)
                .font(Theme.nunito(OpeningLayout.emptyTitleSize, .bold))
                .foregroundStyle(OpeningPalette.text)
                .padding(.bottom, OpeningLayout.emptyTitleGap)
            Text(OpeningStrings.emptySub)
                .font(Theme.nunito(OpeningLayout.emptySubSize))
                .foregroundStyle(OpeningPalette.muted)
                .multilineTextAlignment(.center)
                .lineSpacing(OpeningType.emptySubLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, OpeningLayout.emptyPadH)
        .padding(.bottom, OpeningLayout.emptyPadBottom)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: OpeningLayout.listGap) {
                ForEach(store.trees) { row(for: $0) }
            }
            .padding(.horizontal, OpeningLayout.screenPadH)
            .padding(.bottom, OpeningLayout.screenPadH)
        }
    }

    private func row(for tree: SavedOpeningTree) -> some View {
        HStack(spacing: OpeningLayout.cardGap) {
            VStack(alignment: .leading, spacing: 0) {
                Text(tree.name)
                    .font(Theme.nunito(OpeningLayout.treeNameSize, .bold))
                    .foregroundStyle(OpeningPalette.text)
                    .lineLimit(1)
                    .padding(.bottom, OpeningLayout.treeNameGap)
                Text(tree.metaLine)
                    .font(Theme.nunito(OpeningLayout.treeMetaSize))
                    .foregroundStyle(OpeningPalette.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: OpeningLayout.actionGap) {
                Button { store.openTree(id: tree.id) } label: {
                    Text(OpeningStrings.load)
                        .font(Theme.nunito(OpeningLayout.loadTextSize, .bold))
                        .foregroundStyle(OpeningPalette.gold)
                        .padding(.horizontal, OpeningLayout.loadPadH)
                        .padding(.vertical, OpeningLayout.loadPadV)
                        .background(OpeningPalette.gold.opacity(OpeningType.loadFillOpacity),
                                    in: RoundedRectangle(cornerRadius: OpeningLayout.loadRadius,
                                                         style: .continuous))
                }
                .buttonStyle(.plain)

                Button { store.remove(id: tree.id) } label: {
                    Text(OpeningStrings.remove)
                        .font(Theme.nunito(OpeningLayout.loadTextSize, .semiBold))
                        .foregroundStyle(OpeningPalette.danger)
                        .padding(.horizontal, OpeningLayout.loadPadH)
                        .padding(.vertical, OpeningLayout.loadPadV)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(OpeningLayout.cardPad)
        .background(OpeningPalette.card,
                    in: RoundedRectangle(cornerRadius: OpeningLayout.cardRadius, style: .continuous))
    }

    private var footer: some View {
        VStack(spacing: 0) {
            Button(action: onBuild) {
                Text(OpeningStrings.newTree)
                    .font(Theme.nunito(OpeningLayout.buildTextSize, .bold))
                    .foregroundStyle(OpeningPalette.text)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, OpeningLayout.buildPadV)
                    .background(OpeningPalette.buildBg,
                                in: RoundedRectangle(cornerRadius: OpeningLayout.buildRadius,
                                                     style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: OpeningLayout.buildRadius,
                                              style: .continuous)
                        .strokeBorder(OpeningPalette.buildBorder,
                                      lineWidth: OpeningLayout.buildBorder))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, OpeningLayout.screenPadH)
        .padding(.vertical, OpeningLayout.footerPadV)
        .overlay(Rectangle().fill(OpeningPalette.card)
            .frame(height: OpeningLayout.footerBorder), alignment: .top)
    }
}

// MARK: - Build form

struct OpeningTreeBuildScreen: View {
    @ObservedObject var store: OpeningTreeStore
    let onDone: () -> Void

    @ObservedObject var premium: PremiumStore

    @State private var name = ""
    @State private var colour: OpeningTree.Colour = .both
    @State private var source: OpeningSource = .pgn
    @State private var pgn = ""
    @State private var username = ""
    @State private var error: String?

    /// The download ceiling, as typed. A `String` rather than an `Int` because the field is a
    /// text field: an `Int` binding cannot represent "the user has cleared the box", and the RN
    /// original hit exactly that — it keeps `maxGamesInput` as a string for the same reason.
    @State private var maxGames = OpeningStrings.maxDefault
    /// Nil unless a download is running. Holding the `Task` is what makes it cancellable: leaving
    /// the form tears it down, so a user who backs out mid-fetch is not still pulling 900 games.
    @State private var download: Task<Void, Never>?
    @State private var fetched = 0

    private var isDownloading: Bool { download != nil }

    var body: some View {
        VStack(spacing: 0) {
            OpeningHeader(title: OpeningStrings.title, onBack: onDone)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    label(OpeningStrings.nameLabel)
                    field($name, placeholder: OpeningStrings.namePlaceholder)

                    label(OpeningStrings.colourLabel)
                    colourRow

                    label(OpeningStrings.sourceLabel)
                    sourceRow

                    if source.needsUsername {
                        label(OpeningStrings.userLabel)
                        field($username, placeholder: OpeningStrings.userPlaceholder)
                        label(OpeningStrings.maxLabel)
                        field($maxGames, placeholder: OpeningStrings.maxPlaceholder)
                    } else if source == .pgn {
                        label(OpeningStrings.pgnLabel)
                        field($pgn, placeholder: OpeningStrings.pgnPlaceholder,
                              minHeight: OpeningLayout.pgnMinHeight)
                    }

                    connectivityNote
                    if isDownloading { progressNote }
                    if let error { errorNote(error) }
                    submit
                }
                .padding(.horizontal, OpeningLayout.screenPadH)
                .padding(.bottom, OpeningLayout.formPadBottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // Leaving the form cancels the download. Without this a user who taps Back mid-fetch keeps
        // pulling games into a screen that is gone, and the `sink` writes into `@State` that no
        // longer has a view — silent, but it is a live network request nobody can stop.
        .onDisappear { download?.cancel(); download = nil }
    }

    private func label(_ text: String) -> some View {
        Text(text.uppercased())
            .font(Theme.nunito(OpeningLayout.labelSize, .semiBold))
            .tracking(OpeningLayout.labelTracking)
            .foregroundStyle(OpeningPalette.muted)
            .padding(.top, OpeningLayout.labelTop)
            .padding(.bottom, OpeningLayout.labelBottom)
    }

    /// `minHeight` is nil for the one-line fields and `pgnMinHeight` for the PGN box.
    ///
    /// `TextField(axis: .vertical)` grows from a SINGLE line, so without it the browser opened a
    /// 160 pt paste target and the app opened a text input — the same control at two sizes.
    private func field(_ text: Binding<String>, placeholder: String,
                       minHeight: CGFloat? = nil) -> some View {
        TextField(placeholder, text: text, axis: .vertical)
            .frame(minHeight: minHeight, alignment: .topLeading)
            .textFieldStyle(.plain)
            .font(Theme.nunito(OpeningLayout.inputTextSize))
            .foregroundStyle(OpeningPalette.text)
            .padding(.horizontal, OpeningLayout.inputPadH)
            .padding(.vertical, OpeningLayout.inputPadV)
            .background(OpeningPalette.card,
                        in: RoundedRectangle(cornerRadius: OpeningLayout.inputRadius,
                                             style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: OpeningLayout.inputRadius, style: .continuous)
                .strokeBorder(OpeningPalette.inputBorder, lineWidth: OpeningLayout.inputBorder))
    }

    private var colourRow: some View {
        HStack(spacing: OpeningLayout.toggleGap) {
            ForEach(OpeningTree.Colour.allCases, id: \.self) { c in
                toggle(c.label, active: colour == c) { colour = c }
            }
        }
    }

    private var sourceRow: some View {
        HStack(spacing: OpeningLayout.toggleGap) {
            ForEach(OpeningSource.allCases) { s in
                toggle(s.label, active: source == s) { source = s; error = nil }
            }
        }
    }

    private func toggle(_ text: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(Theme.nunito(OpeningLayout.toggleTextSize, .semiBold))
                .foregroundStyle(active ? OpeningPalette.onGold : OpeningPalette.muted)
                .lineLimit(1)
                .minimumScaleFactor(OpeningType.toggleMinScale)
                .frame(maxWidth: .infinity)
                .padding(.vertical, OpeningLayout.togglePadV)
                .background(active ? OpeningPalette.gold : OpeningPalette.card,
                            in: RoundedRectangle(cornerRadius: OpeningLayout.toggleRadius,
                                                 style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: OpeningLayout.toggleRadius,
                                          style: .continuous)
                    .strokeBorder(active ? OpeningPalette.gold : OpeningPalette.inputBorder,
                                  lineWidth: OpeningLayout.toggleBorder))
        }
        .buttonStyle(.plain)
    }

    /// The app's only networked path says so on screen. It is not a warning — it is the difference
    /// between "this feature is broken" and "this one button needs the radio".
    private var connectivityNote: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(source.isOnline ? OpeningStrings.onlineNote : OpeningStrings.offlineNote)
                .font(Theme.nunito(OpeningLayout.infoTitleSize, .semiBold))
                .foregroundStyle(OpeningPalette.gold)
                .padding(.bottom, OpeningLayout.infoTitleGap)
            Text(source.isOnline ? OpeningStrings.onlineNoteSub : OpeningStrings.offlineNoteSub)
                .font(Theme.nunito(OpeningLayout.infoSubSize))
                .foregroundStyle(OpeningPalette.infoText)
                .lineSpacing(OpeningType.infoSubLeading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(OpeningLayout.infoPad)
        .background(OpeningPalette.infoBg,
                    in: RoundedRectangle(cornerRadius: OpeningLayout.infoRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: OpeningLayout.infoRadius, style: .continuous)
            .strokeBorder(OpeningPalette.infoBorder, lineWidth: OpeningLayout.infoBorder))
        .padding(.top, OpeningLayout.infoTop)
        .padding(.bottom, OpeningLayout.infoBottom)
    }

    /// The live counter, drawn only while a download is running.
    ///
    /// It reuses the connectivity note's box rather than introducing a fourth panel style: this is
    /// the same slot saying the same kind of thing, and a banner with its own geometry would be a
    /// set of numbers `opening_styles.json` cannot vouch for.
    private var progressNote: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(OpeningStrings.fetching)
                .font(Theme.nunito(OpeningLayout.infoTitleSize, .semiBold))
                .foregroundStyle(OpeningPalette.gold)
                .padding(.bottom, OpeningLayout.infoTitleGap)
            Text(OpeningStrings.fill(OpeningStrings.fetched, ["n": String(fetched)]))
                .font(Theme.nunito(OpeningLayout.infoSubSize))
                .foregroundStyle(OpeningPalette.infoText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(OpeningLayout.infoPad)
        .background(OpeningPalette.infoBg,
                    in: RoundedRectangle(cornerRadius: OpeningLayout.infoRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: OpeningLayout.infoRadius, style: .continuous)
            .strokeBorder(OpeningPalette.infoBorder, lineWidth: OpeningLayout.infoBorder))
        .padding(.top, OpeningLayout.infoBottom)
    }

    private func errorNote(_ message: String) -> some View {
        Text(message)
            .font(Theme.nunito(OpeningLayout.infoSubSize, .semiBold))
            .foregroundStyle(OpeningPalette.errorText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(OpeningLayout.infoPad)
            .background(OpeningPalette.errorBg,
                        in: RoundedRectangle(cornerRadius: OpeningLayout.infoRadius,
                                             style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: OpeningLayout.infoRadius, style: .continuous)
                .strokeBorder(OpeningPalette.errorBorder, lineWidth: OpeningLayout.infoBorder))
            .padding(.top, OpeningLayout.infoBottom)
    }

    private var submit: some View {
        Button(action: build) {
            Text(isDownloading ? OpeningStrings.building : OpeningStrings.build)
                .font(Theme.nunito(OpeningLayout.submitTextSize, .bold))
                .foregroundStyle(OpeningPalette.onGold)
                .frame(maxWidth: .infinity)
                .padding(.vertical, OpeningLayout.submitPadV)
                .background(OpeningPalette.gold,
                            in: RoundedRectangle(cornerRadius: OpeningLayout.submitRadius,
                                                 style: .continuous))
        }
        .buttonStyle(.plain)
        // Disabled rather than hidden, and dimmed with the same token the explorer's nav arrows
        // use. A second tap would start a SECOND download into the same tree and double every
        // count in it — the sort of bug that reads as "the numbers are wrong", never as "I
        // double-tapped".
        .disabled(isDownloading)
        .opacity(isDownloading ? OpeningLayout.navDisabledOpacity : 1)
        .padding(.top, OpeningLayout.submitTop)
    }

    /// The form's one submit, for all four sources.
    ///
    /// It used to be PGN-and-coach only: picking Lichess or Chess.com checked the username and
    /// then set `errNetwork` — *"Could not reach that site. Check your connection and try again."*
    /// — for a download that had never been written. That is the bug the client reported as *"hindi
    /// nag-oopening tree"*, and the reason it survived a green suite and TestFlight is that the
    /// message it produced is indistinguishable from the real thing: the user has no way to tell a
    /// missing feature from a missing signal, so they check their wifi and report the app.
    ///
    /// The two paths differ in exactly one way — one of them has to wait — so the tree-building
    /// tail is shared rather than written twice.
    private func build() {
        guard !isDownloading else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { error = OpeningStrings.errNoName; return }
        error = nil

        switch source {
        case .pgn:
            guard !pgn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                error = OpeningStrings.errNoPgn; return
            }
            let games = OpeningTree.games(fromPGN: pgn,
                                          userName: nil,
                                          fallbackIsWhite: colour != .black,
                                          colour: colour)
            guard !games.isEmpty else { error = OpeningStrings.errNoGames; return }
            // The real check is in `finish`, on POSITIONS: `PGN.mainlineTokens` is a tokenizer, not
            // a validator, so "not a game" comes back as three move tokens and passes this one.
            finish(name: trimmed, games: games)
        case .coach:
            error = OpeningStrings.errNoCoachGames
        case .lichess:
            startDownload(site: .lichess, name: trimmed)
        case .chesscom:
            startDownload(site: .chesscom, name: trimmed)
        }
    }

    /// Pull the games, then hand them to the same tail the paste path uses.
    ///
    /// The games are accumulated here rather than inserted as they arrive, which is the one place
    /// this deliberately does **less** than the RN screen. That one jumps to the explorer with an
    /// empty tree and grows it live, and it pays for the effect with a half-built tree on screen
    /// whenever a download fails — a saved artefact of a failure, indistinguishable from a real
    /// tree once the banner is gone. Here nothing is saved until the download finishes, so a
    /// failure leaves the form open with the reason on it and the list exactly as it was. The
    /// counter still moves, because that is what the banner is for.
    private func startDownload(site: OpeningDownload.Site, name treeName: String) {
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !user.isEmpty else { error = OpeningStrings.errNoUser; return }

        let limit = OpeningDownload.resolvedMax(isPremium: premium.isPremium,
                                                requested: Int(maxGames.trimmingCharacters(
                                                    in: .whitespacesAndNewlines)) ?? 0)
        fetched = 0

        download = Task { @MainActor in
            defer { download = nil }
            let collected: [OpeningTree.Game]
            do {
                collected = try await OpeningDownloader().run(site: site,
                                                              username: user,
                                                              colour: colour,
                                                              limit: limit) { total in
                    fetched = total
                }
            } catch is CancellationError {
                // The user left the form. Nothing to say and nowhere to say it.
                return
            } catch let failure as OpeningDownload.Failure {
                error = failure.message
                return
            } catch {
                self.error = OpeningStrings.errNetwork
                return
            }
            // A username that exists but has no games in the chosen colour is NOT a network
            // problem, and telling the user to check their connection would send them to fix the
            // one thing that is working. It is the same 404-shaped answer, from a 200.
            guard !collected.isEmpty else { error = OpeningStrings.errUnknownUser; return }
            finish(name: treeName, games: collected)
        }
    }

    /// Build, save, close — the tail both sources share.
    private func finish(name treeName: String, games: [OpeningTree.Game]) {
        var tree = OpeningTree()
        tree.add(games)
        guard tree.nodeCount > 0 else { error = OpeningStrings.errNoGames; return }
        store.add(SavedOpeningTree(name: treeName,
                                   colour: colour,
                                   source: source,
                                   username: username,
                                   createdAtMs: Date().timeIntervalSince1970 * OpeningType.msPerSecond,
                                   tree: tree))
        onDone()
    }
}

// MARK: - Explorer

struct OpeningTreeExplorerScreen: View {
    @ObservedObject var store: OpeningTreeStore

    /// Owned here rather than by the root, so closing the tree destroys it — which is also what
    /// resets the toggle to OFF on re-entry.
    @StateObject private var engine = OpeningEngineVM()

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                OpeningHeader(title: store.open?.name ?? OpeningStrings.title,
                              onBack: { store.closeTree() })
                board(width: geo.size.width)
                engineToggle
                if engine.engineOn { enginePanel }
                history
                navRow
                moves
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .onChange(of: store.path) { _, _ in engine.positionChanged(to: store.position) }
        // A detached Task is not cancelled by deinit, so leaving has to say so.
        .onDisappear { engine.stop() }
    }

    private func board(width: CGFloat) -> some View {
        let edge = OpeningBoard.edge(screenWidth: width, engineOn: engine.engineOn)
        return HStack(alignment: .top, spacing: AnalysisEval.railGap) {
            // The rail is a SIBLING of the band, never a wrapper: `ChessBoardBand` is the board box
            // and anything that adds leading width to it moves everything anchored to its frame.
            // And it LEAVES the layout with the engine — a hidden-but-present rail would keep its
            // width and its gap, so the board would gain nothing.
            if engine.engineOn { evalRail(height: edge) }
            ChessBoardBand(edge: edge) { side in
                BoardView(pieces: store.position.map(piecesFrom) ?? [],
                          selected: nil,
                          legalTargets: [],
                          lastMove: store.lastMove,
                          flipped: store.open?.colour == .black,
                          checkSquare: nil,
                          boardSize: side,
                          onTap: { _ in })
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, OpeningLayout.boardGap)
    }

    /// The one rail, from `EvalRail.swift`. A forwarder rather than an inline `EvalRail(...)` so
    /// `evalRail(height: edge)` reads the same here as on the Analysis Board — which is what
    /// `swift_layout_check.js` §4d's site table matches on.
    private func evalRail(height: CGFloat) -> some View {
        EvalRail(height: height, fraction: engine.evalFraction, label: engine.evalLabel)
    }

    /// `alignSelf: flex-start` in the RN source, so it hugs the left rather than stretching.
    private var engineToggle: some View {
        HStack(spacing: 0) {
            Button { engine.toggle(position: store.position) } label: {
                Text(engine.engineOn ? OpeningStrings.engineOn : OpeningStrings.engineOff)
                    .font(Theme.nunito(OpeningLayout.engineToggleTextSize, .semiBold))
                    .foregroundStyle(engine.engineOn ? OpeningPalette.doneText
                                                     : OpeningPalette.muted)
                    .padding(.horizontal, OpeningLayout.engineTogglePadH)
                    .padding(.vertical, OpeningLayout.engineTogglePadV)
                    .background(engine.engineOn ? OpeningPalette.doneBg : OpeningPalette.card,
                                in: RoundedRectangle(cornerRadius: OpeningLayout.engineToggleRadius,
                                                     style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: OpeningLayout.engineToggleRadius,
                                              style: .continuous)
                        .strokeBorder(engine.engineOn ? OpeningPalette.doneText
                                                      : OpeningPalette.engineToggleBorder,
                                      lineWidth: OpeningLayout.engineToggleBorder))
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, OpeningLayout.screenPadH)
        .padding(.top, OpeningLayout.engineToggleTop)
        .padding(.bottom, OpeningLayout.engineToggleBottom)
    }

    /// The three best lines, or what is happening instead.
    ///
    /// The rows are **not** tappable, and that is a decision rather than an omission: `store.play`
    /// would append a SAN the tree has no node for, so a control that looks exactly like the
    /// candidate rows below would silently take you off book. Playing an engine move is what the
    /// BOARD is for.
    private var enginePanel: some View {
        VStack(alignment: .leading, spacing: OpeningLayout.engineGap) {
            if let status = engineStatus {
                Text(status)
                    .font(Theme.nunito(OpeningLayout.engineTextSize))
                    .foregroundStyle(OpeningPalette.muted)
                    .padding(.vertical, OpeningLayout.engineStatusPadV)
            }
            ForEach(engine.rows, id: \.rank) { engineRow($0) }
            if !engine.rows.isEmpty {
                Text(OpeningStrings.fill(engine.analyzing ? OpeningStrings.engineDepthBusy
                                                          : OpeningStrings.engineDepth,
                                         ["n": String(engine.rows[0].depth)]))
                    .font(Theme.nunito(OpeningLayout.engineDepthSize))
                    .foregroundStyle(OpeningPalette.engineDepth)
                    .padding(.top, OpeningLayout.engineDepthTop)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, OpeningLayout.enginePadH)
        .padding(.vertical, OpeningLayout.enginePadV)
        .background(OpeningPalette.cardDeep,
                    in: RoundedRectangle(cornerRadius: OpeningLayout.engineRadius,
                                         style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: OpeningLayout.engineRadius, style: .continuous)
            .strokeBorder(OpeningPalette.hairline, lineWidth: OpeningLayout.engineBorder))
        .padding(.horizontal, OpeningLayout.screenPadH)
        .padding(.bottom, OpeningLayout.engineBottom)
    }

    /// `Analyzing…` before the first snapshot, the outcome once the game is over, otherwise nil.
    ///
    /// The spinner shows only while there is nothing to show — once lines exist the depth chip's
    /// trailing `…` carries the same information without the panel jumping.
    private var engineStatus: String? {
        if !engine.rows.isEmpty { return nil }
        return engine.analyzing ? OpeningStrings.engineAnalyzing : nil
    }

    private func engineRow(_ row: EngineRow) -> some View {
        HStack(spacing: OpeningLayout.engineRowGap) {
            Text(row.evalText)
                .font(Theme.nunito(OpeningLayout.engineEvalSize, .bold))
                .foregroundStyle(OpeningPalette.engineEvalInk(row.evalText))
                .frame(minWidth: OpeningLayout.engineEvalWidth, alignment: .leading)
            Text(row.san)
                .font(Theme.nunito(OpeningLayout.engineSanSize, .bold))
                .foregroundStyle(OpeningPalette.engineRankColor(row.rank))
                .frame(minWidth: OpeningLayout.engineSanWidth, alignment: .leading)
            Text(row.continuation)
                .font(Theme.nunito(OpeningLayout.enginePvSize))
                .foregroundStyle(OpeningPalette.muted)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, OpeningLayout.engineRowPadV)
    }

    private var history: some View {
        Text(store.historyText)
            .font(Theme.nunito(OpeningLayout.historySize, .semiBold))
            .foregroundStyle(OpeningPalette.gold)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, OpeningLayout.historyPadH)
            .padding(.vertical, OpeningLayout.historyPadV)
            .background(OpeningPalette.cardDeep,
                        in: RoundedRectangle(cornerRadius: OpeningLayout.historyRadius,
                                             style: .continuous))
            .padding(.horizontal, OpeningLayout.screenPadH)
            .padding(.bottom, OpeningLayout.historyBottom)
    }

    private var navRow: some View {
        HStack(spacing: OpeningLayout.navGap) {
            navButton(OpeningStrings.back, enabled: store.canStepBack) { store.stepBack() }
            navButton(OpeningStrings.reset, enabled: store.canStepBack) { store.reset() }
            navButton(OpeningStrings.forward, enabled: store.canStepForward) { store.stepForward() }
        }
        .padding(.horizontal, OpeningLayout.screenPadH)
        .padding(.bottom, OpeningLayout.navBottom)
    }

    private func navButton(_ text: String, enabled: Bool,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(Theme.nunito(OpeningLayout.navTextSize, .semiBold))
                .foregroundStyle(OpeningPalette.text)
                .padding(.horizontal, OpeningLayout.navPadH)
                .padding(.vertical, OpeningLayout.navPadV)
                .background(OpeningPalette.card,
                            in: RoundedRectangle(cornerRadius: OpeningLayout.navRadius,
                                                 style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: OpeningLayout.navRadius, style: .continuous)
                    .strokeBorder(OpeningPalette.inputBorder, lineWidth: OpeningLayout.navBorder))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? OpeningType.enabledOpacity : OpeningLayout.navDisabledOpacity)
    }

    private var moves: some View {
        ScrollView {
            if store.candidates.isEmpty {
                Text(OpeningStrings.noMoves)
                    .font(Theme.nunito(OpeningLayout.noMovesSize))
                    .foregroundStyle(OpeningPalette.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(OpeningLayout.noMovesPad)
                    .background(OpeningPalette.card,
                                in: RoundedRectangle(cornerRadius: OpeningLayout.noMovesRadius,
                                                     style: .continuous))
                    .padding(.horizontal, OpeningLayout.screenPadH)
            } else {
                LazyVStack(spacing: OpeningLayout.rowBottom) {
                    ForEach(store.candidates, id: \.san) { row(for: $0) }
                }
                .padding(.horizontal, OpeningLayout.screenPadH)
                .padding(.bottom, OpeningLayout.movesPadBottom)
            }
        }
    }

    private func row(for c: OpeningTree.Candidate) -> some View {
        Button { store.play(c.san) } label: {
            HStack(spacing: OpeningLayout.rowGap) {
                Text(c.san)
                    .font(Theme.nunito(OpeningLayout.sanSize, .bold))
                    .foregroundStyle(OpeningPalette.text)
                    .frame(width: OpeningLayout.sanWidth, alignment: .leading)

                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        Text(OpeningType.gamesLabel(c.count))
                            .font(Theme.nunito(OpeningLayout.statSize))
                            .foregroundStyle(OpeningPalette.muted)
                        Spacer(minLength: 0)
                        Text(OpeningType.wdlLabel(c))
                            .font(Theme.nunito(OpeningLayout.statSize))
                            .foregroundStyle(OpeningPalette.muted)
                    }
                    .padding(.bottom, OpeningLayout.statGap)
                    wdlBar(c)
                }
                .frame(maxWidth: .infinity)

                if c.hasContinuations {
                    Text(OpeningType.chevron)
                        .font(Theme.nunito(OpeningLayout.chevronSize, .bold))
                        .foregroundStyle(OpeningPalette.chevron)
                }
            }
            .padding(OpeningLayout.rowPad)
            .background(OpeningPalette.card,
                        in: RoundedRectangle(cornerRadius: OpeningLayout.rowRadius,
                                             style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// Three proportional segments. `GeometryReader` rather than the RN `flex:` trick, because the
    /// flex form cannot express "nothing scored" — three zero-flex children collapse and the bar
    /// silently vanishes. Here the track stays and the segments are simply empty.
    private func wdlBar(_ c: OpeningTree.Candidate) -> some View {
        GeometryReader { g in
            HStack(spacing: 0) {
                Rectangle().fill(OpeningWDL.win).frame(width: g.size.width * c.winShare)
                Rectangle().fill(OpeningWDL.draw).frame(width: g.size.width * c.drawShare)
                Rectangle().fill(OpeningWDL.loss).frame(width: g.size.width * c.lossShare)
                Spacer(minLength: 0)
            }
        }
        .frame(height: OpeningWDL.barHeight)
        .background(OpeningPalette.cardDeep)
        .clipShape(RoundedRectangle(cornerRadius: OpeningWDL.barRadius, style: .continuous))
    }
}

// MARK: - Derived text and the few numbers that are not extracted

/// The values that have no counterpart in the RN StyleSheet, kept together and named so the
/// invented list cannot grow without someone noticing — the same discipline `CoachMetrics` uses.
enum OpeningType {
    /// The load button's fill is `rgba(253,176,34,0.15)` in the source; Swift takes the alpha off
    /// the same gold rather than restating the colour.
    static let loadFillOpacity: Double = 0.15
    static let enabledOpacity: Double = 1
    static let toggleMinScale: CGFloat = 0.8
    static let msPerSecond: Double = 1000

    /// `lineHeight` in RN is the WHOLE line box; SwiftUI's `lineSpacing` is the gap BETWEEN lines.
    /// Subtracting the font size is the conversion, done here rather than in a view body.
    static var emptySubLeading: CGFloat { OpeningLayout.emptySubLine - OpeningLayout.emptySubSize }
    static var infoSubLeading: CGFloat { OpeningLayout.infoSubLine - OpeningLayout.infoSubSize }

    /// `›`, drawn as text like the RN source's, rather than as a vector: `nav_icons_check.js`
    /// governs back and ☰ only, and a list chevron is neither.
    static let chevron = "›"

    static func gamesLabel(_ n: Int) -> String { "\(n)\(OpeningStrings.gamesSuffix)" }

    static func wdlLabel(_ c: OpeningTree.Candidate) -> String {
        OpeningStrings.fill(OpeningStrings.wdl,
                            ["w": String(c.wins), "d": String(c.draws), "l": String(c.losses)])
    }
}
