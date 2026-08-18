import SwiftUI
import BiyaherongCoachCore

// Tournament Detail: Players / Rounds / Standings, the four modals, and the plain-text share
// (spec 1.4-1.6). Twin of `web-demo/js/pairing-detail.js`.
//
// The screen is stateless about data — every mutation goes through `PairingStore` and the body
// re-reads the document. What it does keep is which tab and which round you were looking at.

struct PairingDetailScreen: View {
    @ObservedObject var store: PairingStore
    let tournamentID: Int
    let onExit: () -> Void

    private enum Tab: Int { case players, rounds, standings }

    @State private var tab: Tab = .players
    @State private var openRound = 1
    @State private var sheet: Sheet?

    private enum Sheet: Identifiable {
        case addPlayer
        case bulkAdd
        case result(round: Int, board: Int)
        case removePlayer(Int)

        var id: String {
            switch self {
            case .addPlayer: return "add"
            case .bulkAdd: return "bulk"
            case .result(let r, let b): return "res\(r)-\(b)"
            case .removePlayer(let p): return "rm\(p)"
            }
        }
    }

    private var tournament: PairingDocument.Tournament? { store.tournament(tournamentID) }

    var body: some View {
        VStack(spacing: 0) {
            if let t = tournament {
                header(t)
                tabs(t)
                ScrollView {
                    switch tab {
                    case .players: playersTab(t)
                    case .rounds: roundsTab(t)
                    case .standings: standingsTab(t)
                    }
                }
            } else {
                missing
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PairingDetail.containerBackgroundColor)
        .overlay { if let s = sheet, let t = tournament { modal(s, t) } }
    }

    // MARK: - Header

    private func header(_ t: PairingDocument.Tournament) -> some View {
        let accent = PairingPalette.type(t.type == .swiss)
        return HStack(spacing: 0) {
            // A vector, not the `←` character the generated strings table used to carry.
            // The frame is untouched: `backBtnWidth` is an extracted StyleSheet value.
            NavIconButton(.back, size: PairingDetail.backArrowFontSize,
                          tint: PairingDetail.backArrowColor, action: onExit)
                .frame(width: PairingDetail.backBtnWidth, height: PairingDetail.backBtnHeight)
            VStack(spacing: PairingDetail.headerMetaMarginTop) {
                Text(t.name)
                    .font(Theme.nunito(PairingDetail.headerTitleFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.headerTitleColor)
                    .lineLimit(1)
                HStack(spacing: PairingDetail.headerMetaGap) {
                    Text(t.type == .swiss ? PairingStrings.swissBadge
                                          : PairingStrings.roundRobinBadge)
                        .font(Theme.nunito(PairingDetail.headerBadgeTextFontSize, .extraBold))
                        .tracking(PairingDetail.headerBadgeTextLetterSpacing)
                        .foregroundStyle(accent)
                        .padding(.horizontal, PairingDetail.headerBadgePaddingHorizontal)
                        .padding(.vertical, PairingDetail.headerBadgePaddingVertical)
                        .overlay(RoundedRectangle(cornerRadius: PairingDetail.headerBadgeBorderRadius)
                            .stroke(accent, lineWidth: PairingDetail.headerBadgeBorderWidth))
                    Text(PairingStrings.roundsMeta(t.rounds.count,
                                                   PairingDocument.totalRoundsOf(t)))
                        .font(Theme.nunito(PairingDetail.headerRoundsFontSize, .bold))
                        .foregroundStyle(PairingDetail.headerRoundsColor)
                }
            }
            .frame(maxWidth: .infinity)
            HomeLogo(size: PairingDetail.backBtnWidth)
        }
        .padding(.horizontal, PairingDetail.headerPaddingHorizontal)
        .padding(.vertical, PairingDetail.headerPaddingVertical)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PairingDetail.headerBorderBottomColor)
                .frame(height: PairingDetail.headerBorderBottomWidth)
        }
    }

    private func tabs(_ t: PairingDocument.Tournament) -> some View {
        HStack(spacing: PairingDetail.tabsGap) {
            tabButton(.players, PairingStrings.playersTab(t.players.count))
            tabButton(.rounds, PairingStrings.roundsTab)
            tabButton(.standings, PairingStrings.standingsTab)
        }
        .padding(.horizontal, PairingDetail.tabsPaddingHorizontal)
        .padding(.top, PairingDetail.tabsPaddingTop)
        .padding(.bottom, PairingDetail.tabsPaddingBottom)
    }

    private func tabButton(_ which: Tab, _ title: String) -> some View {
        Button { tab = which } label: {
            Text(title)
                .font(Theme.nunito(PairingDetail.tabTextFontSize, .bold))
                .foregroundStyle(tab == which ? PairingDetail.tabTextActiveColor
                                              : PairingDetail.tabTextColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PairingDetail.tabPaddingVertical)
                .background(tab == which ? PairingDetail.tabActiveBackgroundColor
                                         : PairingDetail.tabBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.tabBorderRadius))
        }
        .buttonStyle(PuzzlePressStyle())
    }

    /// A tournament deleted from under this screen gets an empty state, not a blank box and not a
    /// spinner that never resolves (spec 7 #19).
    private var missing: some View {
        VStack(spacing: 0) {
            Text(PairingStrings.deletedTitle)
                .font(Theme.nunito(PairingList.emptyTitleFontSize, .bold))
                .foregroundStyle(PairingList.emptyTitleColor)
                .padding(.bottom, PairingList.emptyTitleMarginBottom)
            Text(PairingStrings.deletedBody)
                .font(Theme.nunito(PairingList.emptySubFontSize))
                .foregroundStyle(PairingList.emptySubColor)
            Button(action: onExit) {
                // The "tournament deleted" escape hatch. It is a filled pill rather than a header
                // button, so it takes the GLYPH and keeps its own Button and padding.
                NavIconGlyph(kind: .back, size: PairingDetail.actionBtnTextFontSize,
                             tint: PairingDetail.actionBtnTextColor)
                    .padding(.horizontal, PairingDetail.tabsPaddingHorizontal)
                    .padding(.vertical, PairingDetail.actionBtnPaddingVertical)
                    .background(PairingDetail.actionBtnBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingDetail.actionBtnBorderRadius))
            }
            .buttonStyle(PuzzlePressStyle())
            .padding(.top, PairingDetail.playerActionsPaddingTop)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Tab A: Players

    private func playersTab(_ t: PairingDocument.Tournament) -> some View {
        let setup = PairingDocument.status(t) == .setup
        // Seed order during setup, SCORE order once play starts — what an organiser wants to look
        // at, and what the RN screen did. It is also what makes the seed fix observable: while the
        // list is in seed order with dense seeds, the row index and the seed are the same number.
        //
        // A sorted COPY (spec 7 #16): the RN code called `.sort()` on the state array during render.
        let rows = t.players.sorted { a, b in
            if setup { return a.seed < b.seed }
            if a.score != b.score { return a.score > b.score }
            return a.seed < b.seed
        }
        return VStack(spacing: 0) {
            if rows.isEmpty {
                Text(PairingStrings.noPlayers)
                    .font(Theme.nunito(PairingDetail.emptyTabTextFontSize))
                    .foregroundStyle(PairingDetail.emptyTabTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.emptyTabPaddingVertical)
            } else {
                ForEach(rows, id: \.id) { p in
                    playerRow(p, setup: setup)
                        .padding(.bottom, PairingDetail.playerRowMarginBottom)
                }
            }
            if setup { playerActions }
        }
        .padding(.horizontal, PairingDetail.tabBodyPaddingHorizontal)
        .padding(.top, PairingDetail.tabBodyPaddingTop)
        .padding(.bottom, PairingDetail.tabBodyPaddingBottom)
    }

    private func playerRow(_ p: PairingDocument.PlayerRow, setup: Bool) -> some View {
        HStack(spacing: 0) {
            // `p.seed`, never the row index (spec 7 #15). The RN app printed the position in a
            // score-sorted list, so the numbers shown were never the seeds the schedule used.
            Text(String(p.seed))
                .font(Theme.nunito(PairingDetail.playerSeedTextFontSize, .extraBold))
                .foregroundStyle(PairingDetail.playerSeedTextColor)
                .frame(width: PairingDetail.playerSeedWidth, height: PairingDetail.playerSeedHeight)
                .background(PairingDetail.playerSeedBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.playerSeedBorderRadius))
                .padding(.trailing, PairingDetail.playerSeedMarginRight)
            VStack(alignment: .leading, spacing: 0) {
                Text(p.name)
                    .font(Theme.nunito(PairingDetail.playerNameFontSize, .bold))
                    .foregroundStyle(PairingDetail.playerNameColor)
                if let r = p.rating {
                    Text(PairingStrings.ncfp(r))
                        .font(Theme.nunito(PairingDetail.playerRatingFontSize, .semiBold))
                        .foregroundStyle(PairingDetail.playerRatingColor)
                        .padding(.top, PairingDetail.playerRatingMarginTop)
                }
            }
            Spacer(minLength: 0)
            if setup {
                Button { sheet = .removePlayer(p.id) } label: {
                    Text(PairingStrings.removeGlyph)
                        .font(Theme.nunito(PairingDetail.removeBtnTextFontSize, .bold))
                        .foregroundStyle(PairingDetail.removeBtnTextColor)
                        .frame(width: PairingDetail.removeBtnWidth,
                               height: PairingDetail.removeBtnHeight)
                        .background(PairingDetail.removeBtnBackgroundColor,
                                    in: RoundedRectangle(cornerRadius: PairingDetail.removeBtnBorderRadius))
                }
                .buttonStyle(PuzzlePressStyle())
            } else {
                Text(PairingEngine.formatScore(p.score))
                    .font(Theme.nunito(PairingDetail.playerScoreFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.playerScoreColor)
            }
        }
        .padding(PairingDetail.playerRowPadding)
        .background(PairingDetail.playerRowBackgroundColor,
                    in: RoundedRectangle(cornerRadius: PairingDetail.playerRowBorderRadius))
    }

    private var playerActions: some View {
        HStack(spacing: PairingDetail.playerActionsGap) {
            Button { sheet = .bulkAdd } label: {
                Text(PairingStrings.bulkAdd)
                    .font(Theme.nunito(PairingDetail.actionBtnTextFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.actionBtnSecondaryTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.actionBtnPaddingVertical)
                    .overlay(RoundedRectangle(cornerRadius: PairingDetail.actionBtnBorderRadius)
                        .stroke(PairingDetail.actionBtnSecondaryBorderColor,
                                lineWidth: PairingDetail.actionBtnSecondaryBorderWidth))
            }
            .buttonStyle(PuzzlePressStyle())
            Button { sheet = .addPlayer } label: {
                Text(PairingStrings.addPlayerBtn)
                    .font(Theme.nunito(PairingDetail.actionBtnTextFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.actionBtnTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.actionBtnPaddingVertical)
                    .background(PairingDetail.actionBtnBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingDetail.actionBtnBorderRadius))
            }
            .buttonStyle(PuzzlePressStyle())
        }
        .padding(.top, PairingDetail.playerActionsPaddingTop)
        .padding(.bottom, PairingDetail.playerActionsPaddingBottom)
    }

    // MARK: - Tab B: Rounds

    private func roundsTab(_ t: PairingDocument.Tournament) -> some View {
        let finished = PairingDocument.status(t) == .finished
        let current = PairingDocument.round(t, number: min(openRound, max(t.rounds.count, 1)))
        return VStack(spacing: 0) {
            if t.rounds.isEmpty {
                Text(t.players.count < 2 ? PairingStrings.needTwoPlayers
                                         : PairingStrings.generateToStart)
                    .font(Theme.nunito(PairingDetail.emptyTabTextFontSize))
                    .foregroundStyle(PairingDetail.emptyTabTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.emptyTabPaddingVertical)
            } else {
                roundSelector(t)
                if let r = current {
                    ForEach(r.boards, id: \.board) { b in
                        boardRow(t, round: r, board: b, finished: finished)
                            .padding(.bottom, PairingDetail.pairingCardMarginBottom)
                    }
                    if !r.warnings.isEmpty { notes(r) }
                }
            }
            if finished {
                Text(PairingStrings.tournamentComplete)
                    .font(Theme.nunito(PairingDetail.finishedTextFontSize, .extraBold))
                    .foregroundStyle(PairingDetail.finishedTextColor)
                    .tracking(PairingDetail.finishedTextLetterSpacing)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.finishedBannerPaddingVertical)
                    .background(PairingDetail.finishedBannerBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingDetail.finishedBannerBorderRadius))
                    .overlay(RoundedRectangle(cornerRadius: PairingDetail.finishedBannerBorderRadius)
                        .stroke(PairingDetail.finishedBannerBorderColor,
                                lineWidth: PairingDetail.finishedBannerBorderWidth))
                    .padding(.top, PairingDetail.finishedBannerMarginBottom)
            } else if PairingDocument.canGenerate(t) {
                generateButton(t)
            }
        }
        .padding(.horizontal, PairingDetail.tabBodyPaddingHorizontal)
        .padding(.top, PairingDetail.tabBodyPaddingTop)
        .padding(.bottom, PairingDetail.tabBodyPaddingBottom)
    }

    private func roundSelector(_ t: PairingDocument.Tournament) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: PairingLimits.roundSelectorGap) {
                ForEach(t.rounds, id: \.number) { r in
                    Button { openRound = r.number } label: {
                        Text(PairingStrings.roundChip(r.number))
                            .font(Theme.nunito(PairingDetail.roundTabTextFontSize, .extraBold))
                            .foregroundStyle(openRound == r.number
                                             ? PairingDetail.roundTabTextActiveColor
                                             : PairingDetail.roundTabTextColor)
                            .padding(.horizontal, PairingDetail.roundTabPaddingHorizontal)
                            .padding(.vertical, PairingDetail.roundTabPaddingVertical)
                            .background(openRound == r.number
                                        ? PairingDetail.roundTabActiveBackgroundColor
                                        : PairingDetail.roundTabBackgroundColor,
                                        in: RoundedRectangle(cornerRadius: PairingDetail.roundTabBorderRadius))
                            .overlay(RoundedRectangle(cornerRadius: PairingDetail.roundTabBorderRadius)
                                .stroke(PairingDocument.roundComplete(r)
                                        ? PairingDetail.roundTabCompletedBorderColor : Color.clear,
                                        lineWidth: PairingDetail.roundTabCompletedBorderWidth))
                    }
                    .buttonStyle(PuzzlePressStyle())
                }
                Spacer(minLength: 0)
                if let r = PairingDocument.round(t, number: openRound) {
                    ShareLink(item: PairingShareText.round(t, round: r)) {
                        Text(PairingStrings.share)
                            .font(Theme.nunito(PairingDetail.roundShareBtnTextFontSize, .extraBold))
                            .foregroundStyle(PairingDetail.roundShareBtnTextColor)
                            .padding(.horizontal, PairingDetail.roundShareBtnPaddingHorizontal)
                            .padding(.vertical, PairingDetail.roundShareBtnPaddingVertical)
                            .background(PairingDetail.roundShareBtnBackgroundColor,
                                        in: RoundedRectangle(cornerRadius: PairingDetail.roundShareBtnBorderRadius))
                    }
                }
            }
        }
        .frame(maxHeight: PairingDetail.roundSelectorMaxHeight)
        .padding(.top, PairingDetail.roundSelectorMarginTop)
        .padding(.bottom, PairingDetail.roundSelectorMarginBottom)
    }

    private func boardRow(_ t: PairingDocument.Tournament, round r: PairingDocument.Round,
                          board b: PairingDocument.Board, finished: Bool) -> some View {
        let white = PairingDocument.player(t, id: b.white)
        let black = PairingDocument.player(t, id: b.black)
        let label = PairingResultBadge.text(b.result)
        let decided = b.result != .pending && label != nil
        return HStack(spacing: 0) {
            Text(String(b.board))
                .font(Theme.nunito(PairingDetail.boardNumTextFontSize, .extraBold))
                .foregroundStyle(PairingDetail.boardNumTextColor)
                .frame(width: PairingDetail.boardNumWidth, height: PairingDetail.boardNumHeight)
                .background(PairingDetail.boardNumBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.boardNumBorderRadius))
                .padding(.trailing, PairingDetail.boardNumMarginRight)
            if b.isBye {
                Text(PairingStrings.byeLine(white?.name ?? ""))
                    .font(Theme.nunitoItalic(PairingDetail.byeTextFontSize, .semiBold))
                    .foregroundStyle(PairingDetail.byeTextColor)
                Spacer(minLength: 0)
            } else {
                side(white?.name ?? "", isWhite: true, winner: b.result == .whiteWin)
                Text(label ?? PairingStrings.vs)
                    .font(Theme.nunito(PairingDetail.resultTextFontSize, .extraBold))
                    .foregroundStyle(decided ? PairingDetail.resultTextDoneColor
                                             : PairingDetail.resultTextPendingColor)
                    .frame(minWidth: PairingDetail.resultBadgeMinWidth)
                    .padding(.horizontal, PairingDetail.resultBadgePaddingHorizontal)
                    .padding(.vertical, PairingDetail.resultBadgePaddingVertical)
                    .background(decided ? PairingDetail.resultDoneBackgroundColor
                                        : PairingDetail.resultPendingBackgroundColor,
                                in: RoundedRectangle(cornerRadius: PairingDetail.resultBadgeBorderRadius))
                    .padding(.horizontal, PairingDetail.resultBadgeMarginHorizontal)
                side(black?.name ?? "", isWhite: false, winner: b.result == .blackWin)
            }
        }
        .padding(PairingDetail.pairingCardPadding)
        .background(PairingDetail.pairingCardBackgroundColor,
                    in: RoundedRectangle(cornerRadius: PairingDetail.pairingCardBorderRadius))
        .contentShape(Rectangle())
        .onTapGesture {
            guard !b.isBye else { return }
            guard !finished || b.result != .pending else { return }
            sheet = .result(round: r.number, board: b.board)
        }
    }

    private func side(_ name: String, isWhite: Bool, winner: Bool) -> some View {
        HStack(spacing: PairingDetail.pairingPlayerGap) {
            if isWhite { dot(isWhite) }
            Text(name)
                .font(Theme.nunito(PairingDetail.pairingPlayerNameFontSize,
                                   winner ? .extraBold : .semiBold))
                .foregroundStyle(winner ? PairingDetail.winnerNameColor
                                        : PairingDetail.pairingPlayerNameColor)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: isWhite ? .leading : .trailing)
            if !isWhite { dot(isWhite) }
        }
        .frame(maxWidth: .infinity)
    }

    private func dot(_ isWhite: Bool) -> some View {
        Circle()
            .fill(isWhite ? PairingDots.white
                          : PairingDetail.pairingCardBackgroundColor)
            .frame(width: PairingDetail.colorDotWidth, height: PairingDetail.colorDotHeight)
            .overlay(Circle().stroke(isWhite ? Color.clear : PairingDetail.roundTabTextColor,
                                     lineWidth: PairingDetail.headerBadgeBorderWidth))
    }

    /// The engine's compromises, surfaced rather than swallowed (spec 1.7.7). The server never told
    /// anyone it had re-paired two players.
    private func notes(_ r: PairingDocument.Round) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(PairingStrings.pairingNotes)
                .font(Theme.nunito(PairingDetail.byeTextFontSize, .extraBold))
                .foregroundStyle(PairingDetail.finishedTextColor)
            ForEach(Array(r.warnings.enumerated()), id: \.offset) { _, w in
                Text(noteText(w))
                    .font(Theme.nunito(PairingDetail.playerRatingFontSize))
                    .foregroundStyle(PairingDetail.byeTextColor)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(PairingDetail.pairingCardPadding)
        .background(PairingDetail.finishedBannerBackgroundColor,
                    in: RoundedRectangle(cornerRadius: PairingDetail.finishedBannerBorderRadius))
        .padding(.top, PairingDetail.pairingCardMarginBottom)
    }

    private func noteText(_ w: PairingEngine.Warning) -> String {
        switch w.kind {
        case .repeatPairing: return PairingStrings.warnRepeat(w.name, w.otherName)
        case .repeatBye: return PairingStrings.warnBye(w.name)
        case .absoluteColorViolated, .colorPreferenceViolated:
            return PairingStrings.warnColor(w.name)
        }
    }

    private func generateButton(_ t: PairingDocument.Tournament) -> some View {
        Button {
            store.generate(t.id)
            openRound = max(store.tournament(t.id)?.rounds.count ?? 1, 1)
        } label: {
            Text(t.type == .roundRobin ? PairingStrings.generateSchedule
                                       : PairingStrings.generateRound(t.rounds.count + 1))
                .font(Theme.nunito(PairingDetail.generateBtnTextFontSize, .extraBold))
                .foregroundStyle(PairingDetail.generateBtnTextColor)
                .tracking(PairingDetail.generateBtnTextLetterSpacing)
                .frame(maxWidth: .infinity)
                .padding(.vertical, PairingDetail.generateBtnPaddingVertical)
                .background(PairingDetail.generateBtnBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.generateBtnBorderRadius))
                .shadow(color: PairingDetail.generateBtnShadowColor
                    .opacity(PairingDetail.generateBtnShadowOpacity),
                        radius: PairingDetail.generateBtnShadowRadius,
                        x: PairingDetail.generateBtnShadowOffsetWidth,
                        y: PairingDetail.generateBtnShadowOffsetHeight)
        }
        .buttonStyle(PuzzlePressStyle())
        .padding(.top, PairingDetail.generateWrapPaddingTop)
    }

    // MARK: - Tab C: Standings

    private func standingsTab(_ t: PairingDocument.Tournament) -> some View {
        let rows = PairingDocument.standings(t)
        return VStack(spacing: 0) {
            if rows.isEmpty {
                Text(PairingStrings.noPlayersToDisplay)
                    .font(Theme.nunito(PairingDetail.emptyTabTextFontSize))
                    .foregroundStyle(PairingDetail.emptyTabTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, PairingDetail.emptyTabPaddingVertical)
            } else {
                standingsHeaderRow
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                    standingsRow(r, in: t, rank: i + 1, alt: i % 2 == 0)
                }
                ShareLink(item: PairingShareText.standings(t)) {
                    Text(PairingStrings.shareStandings)
                        .font(Theme.nunito(PairingDetail.standingsShareBtnTextFontSize, .extraBold))
                        .foregroundStyle(PairingDetail.standingsShareBtnTextColor)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, PairingDetail.standingsShareBtnPaddingVertical)
                        .background(PairingDetail.standingsShareBtnBackgroundColor,
                                    in: RoundedRectangle(cornerRadius: PairingDetail.standingsShareBtnBorderRadius))
                }
                .padding(.top, PairingDetail.standingsShareBtnMarginTop)
            }
        }
        .padding(.horizontal, PairingDetail.tabBodyPaddingHorizontal)
        .padding(.top, PairingDetail.tabBodyPaddingTop)
        .padding(.bottom, PairingDetail.tabBodyPaddingBottom)
    }

    private var standingsHeaderRow: some View {
        HStack(spacing: 0) {
            col(PairingStrings.colRank, PairingCols.rank)
            Text(PairingStrings.colPlayer)
                .font(Theme.nunito(PairingDetail.shColFontSize, .bold))
                .foregroundStyle(PairingDetail.shColColor)
                .tracking(PairingDetail.shColLetterSpacing)
                .frame(maxWidth: .infinity, alignment: .leading)
            col(PairingStrings.colPts, PairingCols.pts)
            col(PairingStrings.colW, PairingCols.wdl)
            col(PairingStrings.colD, PairingCols.wdl)
            col(PairingStrings.colL, PairingCols.wdl)
            col(PairingStrings.colBch, PairingCols.bch)
            col(PairingStrings.colSB, PairingCols.sb)
        }
        .padding(.horizontal, PairingDetail.standingsHeaderPaddingHorizontal)
        .padding(.vertical, PairingDetail.standingsHeaderPaddingVertical)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(PairingDetail.standingsHeaderBorderBottomColor)
                .frame(height: PairingDetail.standingsHeaderBorderBottomWidth)
        }
        .padding(.bottom, PairingDetail.standingsHeaderMarginBottom)
    }

    private func col(_ text: String, _ width: CGFloat) -> some View {
        Text(text)
            .font(Theme.nunito(PairingDetail.shColFontSize, .bold))
            .foregroundStyle(PairingDetail.shColColor)
            .tracking(PairingDetail.shColLetterSpacing)
            .frame(width: width)
    }

    /// `StandingsRow` carries only the `wins` its tie-break ladder needs, so the draw and loss
    /// columns read the player record — the same recompute pass fills all three in, and it is the
    /// pair the twin's row object carries alongside `wins`.
    private func standingsRow(_ r: PairingEngine.StandingsRow, in t: PairingDocument.Tournament,
                              rank: Int, alt: Bool) -> some View {
        let first = rank == 1
        let record = PairingDocument.player(t, id: r.id)
        return HStack(spacing: 0) {
            // Rank 1 gold, ON SCREEN as well as in the share image (spec 7 #14). The RN styles for
            // this existed and were only ever applied to the image.
            Text(String(rank))
                .font(Theme.nunito(PairingDetail.rankTextFontSize, .extraBold))
                .foregroundStyle(first ? PairingDetail.rankTextFirstColor
                                       : PairingDetail.rankTextColor)
                .frame(width: PairingDetail.rankColWidth, height: PairingDetail.rankColHeight)
                .background(first ? PairingDetail.rankColFirstBackgroundColor
                                  : PairingDetail.rankColBackgroundColor,
                            in: RoundedRectangle(cornerRadius: PairingDetail.rankColBorderRadius))
            VStack(alignment: .leading, spacing: 0) {
                Text(r.name)
                    .font(Theme.nunito(PairingDetail.standingsNameFontSize, .bold))
                    .foregroundStyle(PairingDetail.standingsNameColor)
                    .lineLimit(1)
                if let rating = r.rating {
                    Text(PairingStrings.ncfp(rating))
                        .font(Theme.nunito(PairingDetail.standingsRatingFontSize))
                        .foregroundStyle(PairingDetail.standingsRatingColor)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(PairingEngine.formatScore(r.score))
                .font(Theme.nunito(PairingDetail.standingsValFontSize, .extraBold))
                .foregroundStyle(PairingDetail.standingsPtsColor)
                .frame(width: PairingCols.pts)
            value(String(r.wins), PairingCols.wdl)
            value(String(record?.draws ?? 0), PairingCols.wdl)
            value(String(record?.losses ?? 0), PairingCols.wdl)
            value(PairingEngine.formatScore(r.buchholz), PairingCols.bch)
            value(PairingEngine.formatScore(r.sonnebornBerger), PairingCols.sb)
        }
        .padding(.horizontal, PairingDetail.standingsHeaderPaddingHorizontal)
        .padding(.vertical, PairingDetail.standingsHeaderPaddingVertical)
        .background(alt ? PairingDetail.standingsRowAltBackgroundColor : Color.clear,
                    in: RoundedRectangle(cornerRadius: PairingDetail.standingsRowBorderRadius))
    }

    private func value(_ text: String, _ width: CGFloat) -> some View {
        Text(text)
            .font(Theme.nunito(PairingDetail.standingsValFontSize, .bold))
            .foregroundStyle(PairingDetail.standingsValColor)
            .frame(width: width)
    }

    // MARK: - Modals (spec 1.5)

    @ViewBuilder
    private func modal(_ s: Sheet, _ t: PairingDocument.Tournament) -> some View {
        switch s {
        case .addPlayer:
            PairingAddPlayerModal(onCancel: { sheet = nil },
                                  onAdd: { name, full, rating in
                                      store.addPlayer(t.id, name: name, fullName: full,
                                                      rating: rating)
                                      sheet = nil
                                  })
        case .bulkAdd:
            PairingBulkAddModal(onCancel: { sheet = nil },
                                onAdd: { text in
                                    store.bulkAdd(t.id, text: text)
                                    sheet = nil
                                })
        case .removePlayer(let pid):
            PuzzleModal(title: PairingStrings.removeTitle,
                        body: PairingStrings.removeBody(
                            PairingDocument.player(t, id: pid)?.name ?? ""),
                        dangerTitle: PairingStrings.remove,
                        keepTitle: PairingStrings.cancel,
                        onDanger: {
                            sheet = nil
                            store.removePlayer(t.id, playerID: pid)
                        },
                        onKeep: { sheet = nil })
        case .result(let rn, let bn):
            if let r = PairingDocument.round(t, number: rn),
               let b = r.boards.first(where: { $0.board == bn }) {
                PairingResultModal(white: PairingDocument.player(t, id: b.white)?.name ?? "",
                                   black: PairingDocument.player(t, id: b.black)?.name ?? "",
                                   board: bn,
                                   canClear: b.result != .pending,
                                   onPick: { result in
                                       store.setResult(t.id, round: rn, board: bn, result: result)
                                       sheet = nil
                                   },
                                   onClear: {
                                       store.clearResult(t.id, round: rn, board: bn)
                                       sheet = nil
                                   },
                                   onCancel: { sheet = nil })
            }
        }
    }
}

// MARK: - The result badge

/// Exhaustive (spec 7 #20).
///
/// The RN code was a chain that fell through to `½-½` for anything it did not recognise, so a corrupt
/// result rendered as a draw — a wrong answer that looks like a right one. Here an unrecognised value
/// returns nil and the caller draws the pending badge, which is visibly "we don't know".
enum PairingResultBadge {
    static func text(_ r: PairingDocument.Result) -> String? {
        switch r {
        case .whiteWin: return PairingStrings.resultWhite
        case .blackWin: return PairingStrings.resultBlack
        case .draw: return PairingStrings.resultDraw
        case .pending, .bye: return PairingStrings.vs
        }
    }
}

// MARK: - Share text (spec 1.6)

/// The plain-text share. **No URL** (spec 7 #22) — the RN version pasted its ngrok tunnel into every
/// shared message, which is both broken and a leak.
///
/// The `ImageRenderer` card from §1.6 is not built yet; this is the fallback the spec itself defines.
enum PairingShareText {
    static func round(_ t: PairingDocument.Tournament, round r: PairingDocument.Round) -> String {
        var lines = [PairingStrings.textBrand, PairingStrings.textRule,
                     PairingStrings.textTrophy + t.name,
                     PairingStrings.textClipboard
                        + PairingStrings.shareSubtitle(r.number,
                                                       PairingDocument.totalRoundsOf(t),
                                                       typeLabel(t)),
                     ""]
        for b in r.boards {
            let w = PairingDocument.player(t, id: b.white)?.name ?? ""
            if b.isBye {
                lines.append(PairingStrings.textBoard(b.board) + w + PairingStrings.textBye)
                continue
            }
            let bl = PairingDocument.player(t, id: b.black)?.name ?? ""
            let badge = PairingResultBadge.text(b.result) ?? PairingStrings.vs
            lines.append(PairingStrings.textBoard(b.board) + w + "  " + badge + "  " + bl)
        }
        lines.append("")
        lines.append(PairingStrings.hashtags)
        return lines.joined(separator: "\n")
    }

    static func standings(_ t: PairingDocument.Tournament) -> String {
        var lines = [PairingStrings.textBrand, PairingStrings.textRule,
                     PairingStrings.textTrophy + t.name, ""]
        for (i, p) in PairingDocument.standings(t).enumerated() {
            var rank = "\(i + 1)."
            while rank.count < 3 { rank += " " }
            let record = PairingDocument.player(t, id: p.id)
            let wdl: String = "\(p.wins)W \(record?.draws ?? 0)D \(record?.losses ?? 0)L"
            var line: String = rank
            line += " " + p.name
            line += "  " + PairingEngine.formatScore(p.score)
            line += "  " + wdl
            lines.append(line)
        }
        lines.append("")
        lines.append(PairingStrings.hashtags)
        return lines.joined(separator: "\n")
    }

    static func typeLabel(_ t: PairingDocument.Tournament) -> String {
        t.type == .swiss ? PairingStrings.swissBadge : PairingStrings.roundRobinBadge
    }
}
