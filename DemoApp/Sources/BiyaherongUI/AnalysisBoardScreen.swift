import SwiftUI
import BiyaherongCoachCore

// The Analysis Board screen: seven bands, in the order the React Native source renders them
// (board.tsx:4565-4712). See docs/analysis-board.md.
//
//   1  header            ←  Analysis Board  ☰
//   2  board             a FIXED square derived from the WIDTH, + the eval RAIL on its left
//   3  status, toolbar   two rows here, not the source's one — see `statusLine`

//   4  autoplay bar      only while autoplaying
//   5  move strip        main line as tokens, branches inline as chips
//   6  panels            edit mode only — Setup Position renders into it
//   7  engine lines      micro eval bar · ranked rows · depth + opening
//
// Band 6 used to be the ECO explorer, then a strip of book chips. Both are gone: the client asked
// for the strip's removal one round after it replaced the panel, and neither was earning its
// height. The opening NAME survives, in the engine panel's info row, which is where the RN source
// put it in the first place.
//
// NO NUMERIC LITERAL AND NO ARITHMETIC IN ANY VIEW BODY. Every number is a stored property or a
// pure function from AnalysisMetrics, which is what lets `AnalysisMetricsCheck` assert the layout
// with no renderer. Break that and coverage drains out silently.

struct AnalysisBoardScreen: View {
    @StateObject private var vm = AnalysisVM()
    /// Supplied by the parent, exactly like `ChessGameVM.backToSelect` — this module has no
    /// NavigationStack and no `@Environment(\.dismiss)`.
    var onClose: () -> Void = {}
    /// The free tier's daily Game Review allowance. A closure rather than the store itself, so the
    /// analysis layer stays unaware that subscriptions exist. Defaulted to ungated, which is what
    /// the macOS demo panel wants.
    var reviewGate: (() -> Bool)?
    var onPaywall: () -> Void = {}
    /// What the Game Review cap overlay says the subscription costs — `PremiumStore.offerNote`,
    /// already composed. A plain String for the same reason `reviewGate` is a closure: this module
    /// stays unaware that subscriptions exist.
    var offerNote: String?

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
                    // The preview bar takes the status line's row while a line is being walked —
                    // the status describes the real cursor, which is not what the board is showing.
                    if vm.previewing { previewBar } else { statusLine }
                    statusBand
                    if vm.autoplaying { autoplayBand }
                    AnalysisMoveStrip(tokens: vm.stripTokens,
                                      onTap: { vm.goTo(id: $0) },
                                      onLongPress: { vm.annotateOrManage(id: $0) })
                    // The engine panel is THE flexible child now, and there must be exactly one:
                    // delete it and the root `.frame(width:height:)` centres the whole column,
                    // opening a navy gap above the header. It used to be the book panel, which
                    // hoarded the slack whether or not it had anything to show.
                    //
                    // Its own frame is `maxHeight: .infinity, alignment: .bottom` and sits OUTSIDE
                    // the background, so the panel still hugs its content and stays pinned to the
                    // bottom — it claims the band without painting it.
                    // How many rows, and whether they may wrap, is a function of the screen —
                    // on a 375x667 SE three WRAPPED rows do not fit, and three single-line ones
                    // do. Rows beat wrapping: see `AnalysisLayout.enginePlan`.
                    AnalysisEnginePanel(rows: vm.engineRows,
                                        plan: enginePlan(size: geo.size),
                                        fraction: vm.evalFraction,
                                        depth: vm.depth,
                                        analyzing: vm.analyzing,
                                        symbol: vm.evalSymbol,
                                        opening: vm.openingText,
                                        // Tapping a line WALKS it now instead of committing its
                                        // first move — you can see what the engine means before
                                        // deciding to keep it.
                                        onPlay: { vm.previewLine($0) })
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
        // The VM owns the review; the host owns the allowance. Handing the closure over on appear
        // keeps the analysis layer free of any notion of a subscription.
        .onAppear { vm.reviewGate = reviewGate }
    }

    /// The engine panel's row/line budget for this viewport. A pure function of the metrics and the
    /// geometry — no measurement, and it does not have to be exact: `rowsBox` clips, so an answer a
    /// point or two out costs a hidden row, never an overdrawn move strip.
    private func enginePlan(size: CGSize) -> (rows: Int, lines: Int) {
        // The SAME edge the board draws at, engine state and all. Budget against a different one
        // and the panel is sized for a board that is not on screen — the symptom is a silently
        // missing engine row rather than anything visible.
        let edge = AnalysisBoard.edge(screenWidth: size.width, pixelRatio: displayScale,
                                      engineOn: vm.autoAnalyze)
        let available = AnalysisLayout.engineAvailable(viewportHeight: size.height,
                                                       edge: edge,
                                                       autoplaying: vm.autoplaying)
        return AnalysisLayout.enginePlan(available: available, wanted: vm.engineRows.count)
    }

    // MARK: - 1. Header

    private var header: some View {
        HStack(spacing: 0) {
            headerButton(.back, action: onClose)
            Text("Analysis Board")
                .font(Theme.nunito(AnalysisType.headerTitle, .extraBold))
                .foregroundStyle(AnalysisPalette.textPrimary)
                .frame(maxWidth: .infinity)
            headerButton(.menu, action: { vm.openMenu() })
        }
        .padding(.horizontal, AnalysisLayout.headerPaddingH)
        .padding(.vertical, AnalysisLayout.headerPaddingV)
        .frame(height: AnalysisLayout.headerBtnHeight)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.headerBorder)
        }
    }

    /// Vectors, not the `←` and `☰` characters this used to draw. Nunito has neither, so both fell
    /// back to whatever face the platform picked, and `☰` is the I Ching trigram for heaven rather
    /// than a hamburger. `headerBtn` still sets the size; see NavIcons.swift.
    private func headerButton(_ kind: NavIconGlyph.Kind,
                              action: @escaping () -> Void) -> some View {
        NavIconButton(kind, size: AnalysisType.headerBtn,
                      tint: AnalysisPalette.textPrimary, action: action)
            .frame(width: AnalysisLayout.headerBtnWidth)
    }

    // MARK: - 2. Board + the vertical eval rail
    //
    // LEFT, FIXED, never mirrored — flipping the board does not move the rail. That is what Lichess
    // and Chess.com do, and what the client asked for: "pwede ilagay sa gilid tulad lichess or
    // chesscom".
    //
    // The RN render has no eval bar at all — `renderEvalBar:2741` is declared and never called. Its
    // header comment reads "RENDER EVAL BAR (vertical, DroidFish-style)" while the style beneath it
    // says `flexDirection: 'row'`: the original intended a vertical bar and shipped a horizontal one.
    // We build the comment. There is ONE main eval bar now; the 3pt micro bar is a different bar,
    // real in the source, and still horizontal in the engine panel.
    //
    // THE RAIL IS ONLY THERE WHEN THE ENGINE IS. `toggleEngine` drops the snapshot when it turns
    // the engine off, so the rail would sit at a dead 50/50 with no number — "hindi na need yun pag
    // nakapatay engine … yung space nya kainin na ng chessboard". The board takes the width back,
    // via the one `AnalysisBoard.edge` both this and `enginePlan` call.
    //
    // THE RAIL IS A SIBLING OF `ChessBoardBand`, NEVER A WRAPPER. `BoardArrows` and
    // `AnalysisAnnotationOverlay` are `.overlay(alignment: .topLeading)` ON THE BAND and anchor to
    // its frame. Wrap or pad the band and every arrow and every badge slides right by the rail's
    // width, with the board still looking perfect — a silent failure. `swift_layout_check.js` §4d
    // pins the ordering and the attachment.

    private func boardBand(width: CGFloat) -> some View {
        // This screen keeps its own edge formula — `AnalysisBoard.size` snaps the edge down to a
        // whole multiple of 8 physical pixels so squares land on pixel boundaries, and that is
        // pinned to the RN source. It still goes through `ChessBoardBand`, so there is exactly one
        // place that turns an edge into a square.
        let edge = AnalysisBoard.edge(screenWidth: width, pixelRatio: displayScale,
                                      engineOn: vm.autoAnalyze)
        // `alignment: .top` is spelled rather than left to the default `.center`: both children are
        // exactly `edge` tall today, and this is what keeps them aligned if one ever is not.
        // An HStack applies its spacing BETWEEN children, so with the rail gone the gap goes too and
        // the board is centred on its own — no stray `railGap` to trim.
        return HStack(alignment: .top, spacing: AnalysisEval.railGap) {
            if vm.autoAnalyze { evalRail(height: edge) }
            ChessBoardBand(edge: edge) { side in
                BoardView(pieces: vm.pieces,
                          selected: vm.selected,
                          legalTargets: vm.legalTargets,
                          lastMove: vm.lastMove,
                          flipped: vm.flipped,
                          checkSquare: vm.checkSquare,
                          boardSize: side,
                          onTap: { vm.tap($0) },
                          style: vm.style,
                          onDragMove: { from, to in vm.drag(from: from, to: to) })
            }
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
        }
        .padding(.vertical, AnalysisLayout.boardPaddingTop)
        // `maxHeight: .infinity` here is what starved the ECO panel: the board band claimed every
        // spare point while `AnalysisOpeningPanel` sat capped at `panelsMaxHeight`. The board is a
        // FIXED square derived from the width — it must hug that, and the panel below must be the
        // band that flexes. The browser had the same mistake in a worse form (the board's width
        // tracked the leftover height, so it resized on every move); see docs/analysis-board.md.
        .frame(maxWidth: .infinity, alignment: .top)
    }

    /// The vertical eval rail. White fills from the BOTTOM regardless of the flip: `EngineScore` is
    /// documented "Always White-relative", so nothing here can know or care which way the board is
    /// facing.
    ///
    /// The score hangs off the LEADING side's end — bottom when White leads, on the white block, in
    /// dark ink; top when Black leads, on the bare dark track, in light ink. Those are the only two
    /// placements where the label is guaranteed to sit on solid colour, and
    /// `AnalysisEval.labelAtBottom` is exact about it rather than heuristic.
    ///
    /// `Alignment` is not animatable, so the number JUMPS ends the instant the eval crosses zero
    /// while the fill keeps animating. That is what Lichess does. Do not "fix" it by cross-fading
    /// two `Text`s — that draws the number at both ends mid-transition and reads as a bug.
    /// The rail's SHAPE moved to `EvalRail.swift` when the Opening Tree explorer grew an engine of
    /// its own — one rail, two screens, which is what §4e's "only ONE vertical eval bar" means now
    /// that there is more than one place to draw it.
    ///
    /// This forwarder stays rather than naming `EvalRail(...)` at the call site, and that is not
    /// ceremony: it keeps `evalRail(height: edge)` in `boardBand`, so every mount assertion and
    /// every mount mutant written against this screen still matches character for character.
    private func evalRail(height: CGFloat) -> some View {
        EvalRail(height: height, fraction: vm.evalFraction, label: vm.evalLabel)
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

    // MARK: - 3b. The line-preview bar
    //
    // Takes the status line's row while an engine line is being walked on the board. Same paddings,
    // same minimum height, same divider — so the band does not jump as it appears — but a different
    // job: the status text describes the real cursor, and the real cursor is not what you are
    // looking at. ✕ leaves exactly where you were; ＋ commits what is on screen as a variation.

    private var previewBar: some View {
        HStack(spacing: AnalysisLayout.previewGap) {
            previewNav("◀") { vm.previewStep(-1) }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: AnalysisLayout.previewGap) {
                    ForEach(vm.previewTokens) { tok in
                        Text(tok.san)
                            .font(AnalysisType.mono(AnalysisType.previewPly, .bold))
                            // Dark ink on the current chip: the arrow colours are saturated, and
                            // the move strip's active token makes the same swap for the same reason.
                            .foregroundStyle(tok.isCurrent ? AnalysisPalette.onGold
                                             : tok.played ? AnalysisPalette.textPrimary
                                                          : AnalysisPalette.textMuted)
                            .lineLimit(AnalysisLayout.singleLine)
                            .padding(.horizontal, AnalysisLayout.tokenPaddingH)
                            .padding(.vertical, AnalysisLayout.tokenPaddingV)
                            .background(
                                RoundedRectangle(cornerRadius: AnalysisLayout.tokenRadius)
                                    .fill(tok.isCurrent
                                          ? AnalysisArrow.color(rank: vm.previewRank)
                                          : Color.clear))
                            .contentShape(Rectangle())
                            .onTapGesture { vm.previewGo(to: tok.ply) }
                    }
                }
            }
            previewNav("▶") { vm.previewStep(1) }
                .disabled(!vm.previewCanStepForward)
            previewAction("✕", tint: AnalysisPalette.textSecondary) { vm.previewExit() }
            previewAction("＋", tint: AnalysisPalette.gold) { vm.previewCommit() }
        }
        .padding(.horizontal, AnalysisLayout.statusLinePaddingH)
        .padding(.vertical, AnalysisLayout.statusLinePaddingV)
        .frame(minHeight: AnalysisLayout.statusLineMinHeight)
        .background(AnalysisPalette.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(AnalysisPalette.divider).frame(height: AnalysisLayout.statusBorder)
        }
    }

    private func previewNav(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisType.previewBtn))
                .foregroundStyle(AnalysisPalette.textPrimary)
        }
        .buttonStyle(.plain)
    }

    private func previewAction(_ label: String, tint: Color,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(Theme.nunito(AnalysisType.previewBtn, .bold))
                .foregroundStyle(tint)
                .padding(.horizontal, AnalysisLayout.previewBtnPaddingH)
                .padding(.vertical, AnalysisLayout.previewBtnPaddingV)
                .background(
                    RoundedRectangle(cornerRadius: AnalysisLayout.previewBtnRadius)
                        .fill(AnalysisPalette.surfaceAlt))
        }
        .buttonStyle(.plain)
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
                                onClose: { vm.dismissReview() },
                                onUpgrade: { vm.dismissReview(); onPaywall() },
                                offerNote: offerNote)
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
        case .engineSettings:
            // Deliberately stays open after a change, unlike the autoplay sheet: picking a preset is
            // something you compare, and the engine re-runs behind the sheet so the effect is
            // visible in the panel's own summary lines.
            AnalysisEngineSettingsSheet(model: vm.enginePanel,
                                        engineName: vm.engineName,
                                        engineNote: vm.engineNote,
                                        onPickPreset: { vm.selectEnginePreset($0) },
                                        onSetControl: { vm.setEngineControl($0, $1) },
                                        onToggleAdvanced: { vm.toggleEngineAdvanced() },
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

// MARK: - 7. The engine panel

/// Micro eval bar, up to three rows of `eval · SAN · continuation`, then depth and opening
/// (board.tsx:2772-2845). This is where the 3pt bar and the opening name actually live.
struct AnalysisEnginePanel: View {
    let rows: [EngineRow]
    /// How many rows to draw and how many lines each may wrap to, from `AnalysisLayout.enginePlan`.
    /// Defaulted so the puzzle hub's suggestions panel, which has no viewport to measure, keeps the
    /// full budget it always had.
    var plan: (rows: Int, lines: Int) = (AnalysisLayout.engineMaxRows, AnalysisLayout.engineLineLimit)
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
            // The rows are their OWN box, clipped, and it is the only part of the panel allowed to
            // give way. On a 375x667 SE five wrapped rows do not fit; the band shrinks, and without
            // this the rows would draw over the move strip above. Clipping from the bottom loses the
            // last line before the first, which is the right way round. The browser twin does the
            // same with `.an-rows { flex: 0 1 auto; min-height: 0; overflow: hidden }`; both are
            // asserted (swift_layout_check rule 4c, board_layout_check §3c).
            rowsBox
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
        // AFTER the background, deliberately: the panel claims the screen's leftover height so it
        // is the root VStack's one flexible child, but it still hugs its content and paints only
        // behind it. Putting this before `.background` would flood the band with surface colour —
        // which is the mistake the book panel used to make.
        .frame(maxHeight: .infinity, alignment: .bottom)
    }

    private var rowsBox: some View {
        VStack(alignment: .leading, spacing: AnalysisLayout.rowGap) {
            ForEach(Array(rows.prefix(plan.rows).enumerated()), id: \.offset) { _, row in
                Button { onPlay(row) } label: {
                    HStack(alignment: .firstTextBaseline, spacing: AnalysisLayout.rowSpacing) {
                        // The rank badge. It takes THIS line's arrow colour, so the number on
                        // screen and the arrow on the board are visibly the same line — the board
                        // draws up to three arrows and nothing else said which row each belonged to.
                        //
                        // `engineDepth`, not `engineEval`: every other engine cell is asserted
                        // equal to the move strip's size, and a badge as large as the moves would
                        // out-shout them. The depth chip is the existing "chip" size and already a
                        // declared deviation, so this needs no new one.
                        Text(row.rankLabel)
                            .font(AnalysisType.mono(AnalysisType.engineDepth, .heavy))
                            .foregroundStyle(AnalysisPalette.onGold)
                            .padding(.vertical, AnalysisLayout.engineRankPaddingV)
                            .frame(width: AnalysisLayout.engineRankWidth)
                            .background(AnalysisArrow.color(rank: row.rank),
                                        in: RoundedRectangle(
                                            cornerRadius: AnalysisLayout.engineRankRadius))
                        Text(row.evalText)
                            .font(AnalysisType.mono(AnalysisType.engineEval, .bold))
                            .foregroundStyle(AnalysisPalette.textPrimary)
                            .frame(minWidth: AnalysisLayout.engineEvalWidth, alignment: .trailing)
                        Text(row.san)
                            .font(AnalysisType.mono(AnalysisType.engineSan, .heavy))
                            .foregroundStyle(AnalysisArrow.color(rank: row.rank))
                            .frame(minWidth: AnalysisLayout.engineSanWidth, alignment: .leading)
                        // Two lines, not one. At the move strip's 13pt a single line holds FEWER
                        // moves than the old 9pt one did — "bigger text" and "more moves" cancel
                        // out unless the continuation is allowed to wrap.
                        Text(row.continuation)
                            .font(AnalysisType.mono(AnalysisType.enginePv))
                            .foregroundStyle(AnalysisPalette.textMuted)
                            .lineLimit(plan.lines)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
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
