import SwiftUI
import BiyaherongCoachCore

// The Analysis Board screen: seven bands, in the order the React Native source renders them
// (board.tsx:4565-4712). See docs/analysis-board.md.
//
//   1  header            ←  Analysis Board  ☰
//   2  board             a FIXED square derived from the WIDTH, + the main eval bar under it
//   3  status, toolbar   two rows here, not the source's one — see `statusLine`

//   4  autoplay bar      only while autoplaying
//   5  move strip        main line as tokens, branches inline as chips
//   6  panels            the ECO explorer (where the Lichess masters panel used to be)
//   7  engine lines      micro eval bar · ≤3 rows · depth + opening
//
// NO NUMERIC LITERAL AND NO ARITHMETIC IN ANY VIEW BODY. Every number is a stored property or a
// pure function from AnalysisMetrics, which is what lets `AnalysisMetricsCheck` assert the layout
// with no renderer. Break that and coverage drains out silently.

struct AnalysisBoardScreen: View {
    @StateObject private var vm = AnalysisVM()
    /// Supplied by the parent, exactly like `ChessGameVM.backToSelect` — this module has no
    /// NavigationStack and no `@Environment(\.dismiss)`.
    var onClose: () -> Void = {}

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                header
                boardBand(width: geo.size.width)
                if vm.editing {
                    // board.tsx:4616 hides the whole status+toolbar row in edit mode, in its own
                    // words "to maximise board space" — and with it go the strip, the autoplay bar
                    // and the engine lines, none of which mean anything on a half-built board.
                    ScrollView(.vertical, showsIndicators: false) {
                        AnalysisEditPanel(editor: $vm.editor,
                                          selection: $vm.editorSelection,
                                          fenInput: $vm.editorFEN,
                                          onApply: { vm.applyEditedPosition() },
                                          onLoadFEN: { vm.loadEditorFEN() })
                    }
                    .padding(.horizontal, AnalysisLayout.panelsPaddingH)
                    .frame(maxHeight: .infinity)
                } else {
                    statusLine
                    statusBand
                    if vm.autoplaying { autoplayBand }
                    AnalysisMoveStrip(tokens: vm.stripTokens,
                                      onTap: { vm.goTo(id: $0) },
                                      onLongPress: { vm.annotateOrManage(id: $0) })
                    AnalysisOpeningPanel(rows: vm.bookRows, onPlay: { vm.playBookMove($0) })
                    AnalysisEnginePanel(rows: vm.engineRows,
                                        fraction: vm.evalFraction,
                                        depth: vm.depth,
                                        analyzing: vm.analyzing,
                                        symbol: vm.evalSymbol,
                                        opening: vm.openingText,
                                        onPlay: { vm.playEngineRow($0) })
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .background(AnalysisPalette.screenBg)
            .overlay(alignment: .center) { branchPicker }
            .overlay(alignment: .center) { reviewModal }
            .overlay(alignment: .bottom) { librarySheets }
            .overlay(alignment: .leading) {
                if vm.menuOpen {
                    AnalysisMenuSidebar(sections: vm.menuSections(), onClose: { vm.closeMenu() })
                }
            }
            .animation(.easeOut(duration: AnalysisTiming.screenPresentSeconds), value: vm.menuOpen)
        }
    }

    // MARK: - 1. Header

    private var header: some View {
        HStack(spacing: 0) {
            headerButton("←", action: onClose)
            Text("Analysis Board")
                .font(Theme.nunito(AnalysisType.headerTitle, .extraBold))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .frame(maxWidth: .infinity)
            headerButton("☰", action: { vm.openMenu() })
        }
        .padding(.horizontal, AnalysisLayout.headerPaddingH)
        .padding(.vertical, AnalysisLayout.headerPaddingV)
        .frame(height: AnalysisLayout.headerBtnHeight)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.headerBorder)
        }
    }

    private func headerButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisType.headerBtn))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .frame(width: AnalysisLayout.headerBtnWidth)
        }
        .buttonStyle(.plain)
    }

    // MARK: - 2. Board + the main eval bar
    //
    // The RN render has NO eval bar (`renderEvalBar:2741` is dead code); the 8pt bar is the spec's
    // addition and belongs here, under the board. The 3pt one is real and lives in the engine panel.

    private func boardBand(width: CGFloat) -> some View {
        let edge = AnalysisBoard.size(screenWidth: width, pixelRatio: displayScale)
        return VStack(spacing: AnalysisLayout.boardPaddingTop) {
            BoardView(pieces: vm.pieces,
                      selected: vm.selected,
                      legalTargets: vm.legalTargets,
                      lastMove: vm.lastMove,
                      flipped: vm.flipped,
                      checkSquare: vm.checkSquare,
                      boardSize: edge,
                      onTap: { vm.tap($0) },
                      style: vm.style,
                      onDragMove: { from, to in vm.drag(from: from, to: to) })
                .frame(width: edge, height: edge)
                // Arrows sit on top as an overlay, the same way PromotionOverlay is applied —
                // BoardView itself stays free of anything analysis-specific.
                .overlay(alignment: .topLeading) {
                    BoardArrows(arrows: vm.boardArrows, boardSize: edge, flipped: vm.flipped)
                }
                .overlay(alignment: .topLeading) {
                    if let badge = vm.annotationBadge {
                        AnalysisAnnotationOverlay(square: badge.square, symbol: badge.symbol,
                                                  color: badge.color, boardEdge: edge,
                                                  flipped: vm.flipped)
                    }
                }
                .overlay(alignment: .center) {
                    if vm.pendingPromotion != nil {
                        PromotionOverlay(color: vm.position.sideToMove) { vm.choosePromotion($0) }
                    }
                }
            evalBar(width: edge)
        }
        .padding(.top, AnalysisLayout.boardPaddingTop)
        // `maxHeight: .infinity` here is what starved the ECO panel: the board band claimed every
        // spare point while `AnalysisOpeningPanel` sat capped at `panelsMaxHeight`. The board is a
        // FIXED square derived from the width — it must hug that, and the panel below must be the
        // band that flexes. The browser had the same mistake in a worse form (the board's width
        // tracked the leftover height, so it resized on every move); see docs/analysis-board.md.
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func evalBar(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: AnalysisEval.mainRadius, style: .continuous)
            .fill(AnalysisPalette.evalTrack)
            .frame(width: width, height: AnalysisEval.mainHeight)
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: AnalysisEval.mainRadius, style: .continuous)
                    .fill(AnalysisPalette.evalFill)
                    .frame(width: width * vm.evalFraction, height: AnalysisEval.mainHeight)
            }
            .clipShape(RoundedRectangle(cornerRadius: AnalysisEval.mainRadius, style: .continuous))
            .animation(.easeInOut(duration: AnalysisEval.animationSeconds), value: vm.evalFraction)
    }

    /// `UIScreen.main.scale` is iOS-only and deprecated; the environment value works on both
    /// platforms and is what SwiftUI itself uses to snap to pixels.
    @Environment(\.displayScale) private var displayScale

    // MARK: - 3. The status line, then the toolbar
    //
    // TWO ROWS, not the source's one. Nine emoji buttons measure 346pt in a 365pt card, leaving the
    // status ~19pt — it simply vanished. RN's icon glyphs are narrower than emoji, which is why the
    // source got away with `statusToolbarRow`. The numbers are `styles.statusLine`'s: a block the
    // source declares for exactly this standalone row and then never renders. Deviation recorded.

    private var statusLine: some View {
        HStack(spacing: AnalysisLayout.rowGap) {
            Text(vm.statusText)
                .font(AnalysisType.mono(AnalysisType.status, .bold))
                .foregroundStyle(AnalysisPalette.textSecondary)
                .lineLimit(AnalysisLayout.statusLineLimit)
            if vm.analyzing {
                ProgressView()
                    .controlSize(.mini)
                    .tint(AnalysisPalette.spinner)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, AnalysisLayout.statusLinePaddingH)
        .padding(.vertical, AnalysisLayout.statusLinePaddingV)
        .frame(minHeight: AnalysisLayout.statusLineMinHeight)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
        }
    }

    private var statusBand: some View {
        HStack(spacing: AnalysisLayout.toolGap) {
            HStack(spacing: AnalysisLayout.toolGap) {
                // Nine buttons, the source's own row. Save, Load and Analyze Game live in ☰, where
                // the source keeps them; eleven did not fit a 365pt card and squeezed the status
                // line into three lines.
                toolButton("📂", on: false) { vm.openLibrary() }
                // The source's ✏️ annotates the CURRENT move (board.tsx:4626) and is disabled at
                // the root; Edit Board is a ☰ item.
                toolButton("✏️", on: false) { vm.openAnnotationPickerForCurrent() }
                    .disabled(vm.isAtStart)
                toolButton("💡", on: vm.autoAnalyze) { vm.toggleEngine() }
                toolButton("🔄", on: false) { vm.flip() }
                toolButton(vm.autoplaying ? "⏸" : "▶", on: vm.autoplaying) { vm.toggleAutoplay() }
                navButton("⏮") { vm.goToStart() }
                navButton("◀") { vm.goBack() }
                navButton("▶") { vm.goForward() }
                navButton("⏭") { vm.goToEnd() }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, AnalysisLayout.statusPaddingLeft)
        .padding(.trailing, AnalysisLayout.headerPaddingH)
        .frame(minHeight: AnalysisLayout.statusMinHeight)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
        }
    }

    private func toolButton(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisType.toolBtn))
                .foregroundStyle(on ? AnalysisPalette.gold : AnalysisPalette.textPrimary)
                .frame(minWidth: AnalysisLayout.toolBtnMinWidth)
                .padding(.horizontal, AnalysisLayout.toolBtnPaddingH)
                .padding(.vertical, AnalysisLayout.toolBtnPaddingV)
                .background(AnalysisPalette.surfaceAlt,
                            in: RoundedRectangle(cornerRadius: AnalysisLayout.toolBtnRadius))
        }
        .buttonStyle(.plain)
    }

    private func navButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisType.navBtn))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .frame(minWidth: AnalysisLayout.navBtnMinWidth)
                .padding(.horizontal, AnalysisLayout.navBtnPaddingH)
                .padding(.vertical, AnalysisLayout.navBtnPaddingV)
                .background(AnalysisPalette.surfaceAlt,
                            in: RoundedRectangle(cornerRadius: AnalysisLayout.navBtnRadius))
        }
        .buttonStyle(.plain)
    }

    // MARK: - 4. Autoplay speed bar

    private var autoplayBand: some View {
        Button { vm.cycleSpeed() } label: {
            Text("Speed: \(vm.autoplaySpeedLabel) — tap to change")
                .font(AnalysisType.mono(AnalysisType.autoplayBar, .semibold))
                .foregroundStyle(AnalysisPalette.gold)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AnalysisLayout.autoplayPaddingV)
                .background(AnalysisPalette.surfaceAlt)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var reviewModal: some View {
        if let state = vm.reviewState {
            AnalysisReviewModal(state: state,
                                summary: vm.reviewSummary,
                                onCancel: { vm.cancelReview() },
                                onClose: { vm.dismissReview() })
        }
    }

    /// The save form, the library, and the one-line notices they raise.
    @ViewBuilder
    private var librarySheets: some View {
        switch vm.sheet {
        case .save:
            AnalysisSaveSheet(fields: $vm.saveFields,
                              folders: vm.folders,
                              moveCount: vm.stripTokens.filter { $0.kind == .move }.count,
                              isUpdate: vm.isUpdatingSavedGame,
                              onCreateFolder: { vm.createFolder($0) },
                              onSave: { vm.saveGame() },
                              onClose: { vm.closeSheet() })
        case .library:
            AnalysisLibrarySheet(rows: vm.libraryRows,
                                 folders: vm.folders,
                                 unfiledCount: vm.unfiledCount,
                                 countFor: { vm.count(inFolder: $0) },
                                 folderName: { vm.folderName($0) },
                                 filter: $vm.libraryFilter,
                                 search: $vm.librarySearch,
                                 onOpen: { vm.openSavedGame($0) },
                                 onDelete: { vm.deleteSavedGame($0) },
                                 onDeleteFolder: { vm.deleteFolder($0) },
                                 onClose: { vm.closeSheet() })
        case .notice(let title, let body):
            AnalysisBottomSheet(title: title, onClose: { vm.closeSheet() }) {
                Text(body)
                    .font(Theme.nunito(AnalysisLibraryStyle.fieldSize))
                    .foregroundStyle(AnalysisPalette.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, AnalysisLibraryStyle.fieldGap)
            }
        case .pgnImport:
            AnalysisPgnImportSheet(text: $vm.pgnText,
                                   onLoad: { vm.importPGN() },
                                   onClose: { vm.closeSheet() })
        case .pgnExport(let text):
            AnalysisPgnExportSheet(text: text,
                                   suggestedName: vm.exportFilename,
                                   onClose: { vm.closeSheet() })
        case .annotate(let nodeID, let san, let nag):
            AnalysisAnnotationPicker(san: san,
                                     currentNAG: nag,
                                     onPick: { vm.setAnnotation($0, forNodeID: nodeID) },
                                     onClear: { vm.clearAnnotation(forNodeID: nodeID) },
                                     onClose: { vm.closeSheet() })
        case .variation(let info):
            AnalysisVariationModal(info: info,
                                   onPromote: { vm.promoteVariation(nodeID: info.id) },
                                   onDelete: { vm.deleteVariation(nodeID: info.id) },
                                   onClose: { vm.closeSheet() })
        case .autoplaySpeed:
            AnalysisAutoplaySpeedSheet(current: vm.autoplaySpeed,
                                       onPick: { vm.autoplaySpeed = $0; vm.closeSheet() },
                                       onClose: { vm.closeSheet() })
        case nil:
            EmptyView()
        }
    }

    // MARK: - The branch picker
    //
    // `goForward` with several children has to ask which (board.tsx:1506-1516). An overlay rather
    // than a `.sheet`: this module has no sheet anywhere, and `.fullScreenCover` does not exist on
    // macOS. `PromotionOverlay` set the precedent.

    @ViewBuilder
    private var branchPicker: some View {
        if !vm.branchOptions.isEmpty {
            ZStack {
                Color.black.opacity(AnalysisLayout.scrimOpacity)
                    .onTapGesture { vm.cancelBranch() }
                VStack(spacing: AnalysisLayout.toolGap) {
                    Text("Which continuation?")
                        .font(Theme.nunito(AnalysisType.status, .extraBold))
                        .foregroundStyle(AnalysisPalette.textMuted)
                    ForEach(Array(vm.branchOptions.enumerated()), id: \.offset) { index, node in
                        Button { vm.chooseBranch(index) } label: {
                            Text(node.san)
                                .font(AnalysisType.mono(AnalysisType.stripMove, .bold))
                                .foregroundStyle(index == 0
                                                 ? AnalysisPalette.onGold : AnalysisPalette.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(AnalysisLayout.sheetPadding)
                                .background(index == 0
                                            ? AnalysisPalette.gold : AnalysisPalette.surfaceAlt,
                                            in: RoundedRectangle(cornerRadius: AnalysisLayout.toolBtnRadius))
                        }
                        .buttonStyle(.plain)
                    }
                    Button { vm.cancelBranch() } label: {
                        Text("Cancel")
                            .font(Theme.nunito(AnalysisType.status, .semiBold))
                            .foregroundStyle(AnalysisPalette.textMuted)
                    }
                    .buttonStyle(.plain)
                }
                .padding(AnalysisLayout.sheetPadding)
                .background(AnalysisPalette.surface,
                            in: RoundedRectangle(cornerRadius: AnalysisLayout.sheetRadius))
                .frame(maxWidth: AnalysisLayout.sheetMaxWidth)
            }
        }
    }
}

// MARK: - 5. The move strip
//
// (The review modal is composed above, as `reviewModal`; its own file is AnalysisReviewModal.swift.)

/// Main line as a flat token run, with each position's alternatives inline as chips right after the
/// move they branch from. Auto-scrolls to the cursor, copying `MoveRibbon` (Graphics.swift:129-158).
struct AnalysisMoveStrip: View {
    let tokens: [StripToken]
    let onTap: (Int) -> Void
    /// Long-press: a main-line move opens the annotation picker, a branch chip the variation card.
    /// Defaulted so the preview and any other caller need not supply it.
    var onLongPress: (Int) -> Void = { _ in }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AnalysisLayout.stripGap) {
                    if tokens.isEmpty {
                        Text("Play a move to start a line")
                            .font(Theme.nunito(AnalysisType.status, .medium))
                            .foregroundStyle(AnalysisPalette.textMuted)
                    }
                    // StripToken is not Identifiable, and a move number repeats — index is the id.
                    ForEach(Array(tokens.enumerated()), id: \.offset) { index, token in
                        tokenView(token).id(index)
                    }
                }
                .padding(.horizontal, AnalysisLayout.stripPaddingH)
                .padding(.vertical, AnalysisLayout.stripPaddingV)
            }
            .frame(height: AnalysisLayout.stripMaxHeight)
            .background(AnalysisPalette.surface)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
            }
            .onChange(of: currentIndex) { _, i in
                if let i { withAnimation { proxy.scrollTo(i, anchor: .center) } }
            }
        }
    }

    private var currentIndex: Int? { tokens.firstIndex { $0.isCurrent } }

    @ViewBuilder
    private func tokenView(_ token: StripToken) -> some View {
        switch token.kind {
        case .number:
            Text(token.text)
                .font(AnalysisType.mono(AnalysisType.stripNum, .semibold))
                .foregroundStyle(AnalysisPalette.textMuted)
        case .move:
            Button { onTap(token.id) } label: {
                HStack(spacing: 0) {
                    Text(token.text)
                        .font(AnalysisType.mono(AnalysisType.stripMove, .bold))
                        .foregroundStyle(colour(token))
                    // A reviewed move carries its tier's symbol, 9pt, right after the SAN
                    // (board.tsx:3092). `good`'s symbol is empty on purpose, so the guard is on the
                    // string rather than on the key.
                    if let key = token.classification,
                       let style = AnalysisTables.classification(key), !style.symbol.isEmpty {
                        Text(style.symbol)
                            .font(Theme.nunito(AnalysisType.engineEval, .bold))
                            .foregroundStyle(style.color)
                            .padding(.leading, AnalysisLayout.classMarkGap)
                    }
                }
                .padding(.horizontal, AnalysisLayout.tokenPaddingH)
                .padding(.vertical, AnalysisLayout.tokenPaddingV)
                .background(token.isCurrent ? AnalysisPalette.gold : Color.clear,
                            in: RoundedRectangle(cornerRadius: AnalysisLayout.tokenRadius))
            }
            .buttonStyle(.plain)
            .onLongPressGesture(minimumDuration: AnalysisTiming.longPressSeconds) {
                onLongPress(token.id)
            }
        case .alternative:
            Button { onTap(token.id) } label: {
                Text(token.text)
                    .font(AnalysisType.mono(AnalysisType.altChip, .semibold))
                    .foregroundStyle(colour(token))
                    .padding(.horizontal, AnalysisLayout.chipPaddingH)
                    .padding(.vertical, AnalysisLayout.chipPaddingV)
                    .background(token.isCurrent ? AnalysisPalette.gold : AnalysisPalette.surfaceAlt2,
                                in: RoundedRectangle(cornerRadius: AnalysisLayout.toolBtnRadius))
            }
            .buttonStyle(.plain)
            .onLongPressGesture(minimumDuration: AnalysisTiming.longPressSeconds) {
                onLongPress(token.id)
            }
        }
    }

    private func colour(_ token: StripToken) -> Color {
        if token.isCurrent { return AnalysisPalette.onGold }
        if token.isOnPath { return AnalysisPalette.gold }
        return AnalysisPalette.textSecondary
    }
}

// MARK: - 6. The opening panel

/// The ECO explorer, standing where `renderMasterDB` used to. The Lichess dependency is gone; these
/// rows come from the bundled book.
struct AnalysisOpeningPanel: View {
    let rows: [OpeningBook.Continuation]
    let onPlay: (String) -> Void

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: AnalysisLayout.rowGap, pinnedViews: [.sectionHeaders]) {
                Section {
                    if rows.isEmpty {
                        Text("Out of book — no ECO continuations here.")
                            .font(Theme.nunito(AnalysisType.status, .medium))
                            .foregroundStyle(AnalysisPalette.textMuted)
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        Button { onPlay(row.san) } label: {
                            HStack(alignment: .firstTextBaseline, spacing: AnalysisLayout.rowSpacing) {
                                Text(row.san)
                                    .font(AnalysisType.mono(AnalysisType.stripMove, .bold))
                                    .foregroundStyle(AnalysisPalette.textPrimary)
                                    .frame(minWidth: AnalysisLayout.bookSanWidth, alignment: .leading)
                                Text(row.entry.eco)
                                    .font(AnalysisType.mono(AnalysisType.engineOpening, .bold))
                                    .foregroundStyle(AnalysisPalette.gold)
                                Text(row.entry.name)
                                    .font(Theme.nunito(AnalysisType.altChip))
                                    .foregroundStyle(AnalysisPalette.textSecondary)
                                    .lineLimit(AnalysisLayout.singleLine)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, AnalysisLayout.rowPaddingH)
                            .padding(.vertical, AnalysisLayout.rowPaddingV)
                            .background(AnalysisPalette.surfaceAlt2,
                                        in: RoundedRectangle(cornerRadius: AnalysisLayout.toolBtnRadius))
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Opening book")
                        .font(Theme.nunito(AnalysisType.engineOpening, .bold))
                        .foregroundStyle(AnalysisPalette.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, AnalysisLayout.rowPaddingV)
                        .background(AnalysisPalette.screenBg)
                }
            }
            .padding(.horizontal, AnalysisLayout.panelsPaddingH)
        }
        // The band that gives way. It absorbs a short screen, a taller engine panel and a wrapped
        // status line, so none of that can reach the board. `panelsMaxHeight` is a ceiling, not a
        // fixed height — `bands(viewportHeight:boardEdge:)` computes the real one.
        .frame(maxHeight: AnalysisLayout.panelsMaxHeight)
        .frame(maxHeight: .infinity)
        .background(AnalysisPalette.screenBg)
    }
}

// MARK: - 7. The engine panel

/// Micro eval bar, up to three rows of `eval · SAN · continuation`, then depth and opening
/// (board.tsx:2772-2845). This is where the 3pt bar and the opening name actually live.
struct AnalysisEnginePanel: View {
    let rows: [EngineRow]
    let fraction: CGFloat
    let depth: Int
    let analyzing: Bool
    let symbol: String?
    let opening: String?
    let onPlay: (EngineRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: AnalysisLayout.rowGap) {
            microBar
            if rows.isEmpty {
                Text(analyzing ? "Analyzing…" : "Engine off")
                    .font(AnalysisType.mono(AnalysisType.engineText))
                    .foregroundStyle(AnalysisPalette.textSecondary)
                    .padding(.vertical, AnalysisLayout.rowPaddingV)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Button { onPlay(row) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: AnalysisLayout.rowSpacing) {
                        Text(row.evalText)
                            .font(AnalysisType.mono(AnalysisType.engineEval, .bold))
                            .foregroundStyle(AnalysisPalette.textPrimary)
                            .frame(minWidth: AnalysisLayout.engineEvalWidth, alignment: .trailing)
                        Text(row.san)
                            .font(AnalysisType.mono(AnalysisType.engineSan, .heavy))
                            .foregroundStyle(AnalysisArrow.color(rank: row.rank))
                            .frame(minWidth: AnalysisLayout.engineSanWidth, alignment: .leading)
                        Text(row.continuation)
                            .font(AnalysisType.mono(AnalysisType.enginePv))
                            .foregroundStyle(AnalysisPalette.textMuted)
                            .lineLimit(AnalysisLayout.singleLine)
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
            }
            infoRow
        }
        .padding(.horizontal, AnalysisLayout.enginePaddingH)
        .padding(.top, AnalysisLayout.enginePaddingTop)
        .padding(.bottom, AnalysisLayout.enginePaddingBottom)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
        }
    }

    private var microBar: some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: AnalysisEval.microRadius, style: .continuous)
                .fill(AnalysisPalette.evalTrack)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: AnalysisEval.microRadius, style: .continuous)
                        .fill(AnalysisPalette.evalFill)
                        .frame(width: geo.size.width * fraction)
                }
                .clipShape(RoundedRectangle(cornerRadius: AnalysisEval.microRadius, style: .continuous))
        }
        .frame(height: AnalysisEval.microHeight)
        .padding(.bottom, AnalysisEval.microMarginBottom)
        .animation(.easeInOut(duration: AnalysisEval.animationSeconds), value: fraction)
    }

    private var infoRow: some View {
        HStack(spacing: AnalysisLayout.rowSpacing) {
            Text(analyzing ? "d:\(depth)…" : "d:\(depth)")
                .font(AnalysisType.mono(AnalysisType.engineDepth, .bold))
                .foregroundStyle(AnalysisPalette.textSecondary)
                .padding(.horizontal, AnalysisLayout.chipPaddingH)
                .padding(.vertical, AnalysisLayout.chipPaddingV)
                .background(AnalysisPalette.surfaceAlt,
                            in: RoundedRectangle(cornerRadius: AnalysisLayout.toolBtnRadius))
            if let symbol {
                Text(symbol)
                    .font(Theme.nunito(AnalysisType.engineSan, .extraBold))
                    .foregroundStyle(AnalysisPalette.textPrimary)
            }
            if let opening {
                Text(opening)
                    .font(AnalysisType.mono(AnalysisType.engineOpening, .bold))
                    .foregroundStyle(AnalysisPalette.gold)
                    .lineLimit(AnalysisLayout.singleLine)
            }
            Spacer(minLength: 0)
        }
    }
}
