import SwiftUI
import BiyaherongCoachCore

// Play vs Coach: the three screens (spec §2.5–2.8).
//
// Twins of `web-demo/js/coach-select.js`, `coach-color.js` and `coach-play.js`, which are rendered
// into a headless DOM by `tools/qa/coach_screen_test.js`. Every number is a constant from the
// generated `CoachMetrics.swift`; there is no numeric literal and no arithmetic in any body below,
// which is what lets `CoachMetricsCheck` see the layout with no renderer.

/// The feature root. Three screens, one store, no navigation path — the store owns which is showing
/// so a reply landing during a transition cannot address a screen that has gone.
struct CoachRootScreen: View {
    @ObservedObject var store: CoachStore
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void
    let onPaywall: () -> Void

    var body: some View {
        Group {
            switch store.screen {
            case .select:
                CoachSelectScreen(store: store, premium: premium, onExit: onExit,
                                  onPaywall: onPaywall)
            case .colour(let level):
                CoachColourScreen(store: store, level: level)
            case .game:
                CoachGameScreen(store: store, onPaywall: onPaywall)
            }
        }
        .background(CoachSelect.containerBackgroundColor.ignoresSafeArea())
        // Play vs Coach's "Start Review" produces the same Game Review the Analysis Board does, so
        // it spends the same allowance. Capping one and not the other would be a free bypass.
        .onAppear { store.reviewGate = { premium.consumeReview() } }
    }
}

// MARK: - Coach Select (spec §2.5)

struct CoachSelectScreen: View {
    @ObservedObject var store: CoachStore
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void
    let onPaywall: () -> Void

    var body: some View {
        VStack(spacing: CoachLayout.sectionGap) {
            header
            ScrollView {
                VStack(spacing: CoachLayout.sectionGap) {
                    Text(CoachStrings.selectBlurb)
                        .font(.system(size: CoachSelect.titleSubFontSize))
                        .foregroundStyle(CoachSelect.titleSubColor)
                        .multilineTextAlignment(.center)
                    roster
                    takeBackRow
                    footer
                }
                .padding(.horizontal, CoachSelect.row1PaddingHorizontal)
            }
        }
    }

    private var header: some View {
        HStack {
            NavIconButton(.back, size: CoachSelect.backIconFontSize,
                          tint: CoachSelect.backIconColor, action: { onExit() })
            .frame(width: CoachSelect.backBtnWidth, height: CoachSelect.backBtnHeight)
            Spacer()
            VStack(spacing: .zero) {
                Text(CoachStrings.selectHeader)
                    .font(.system(size: CoachSelect.titleLargeFontSize, weight: .heavy))
                    .foregroundStyle(CoachSelect.titleLargeColor)
                    .tracking(CoachSelect.titleLargeLetterSpacing)
                Text(CoachStrings.selectFamily)
                    .font(.system(size: CoachSelect.titleSmallFontSize, weight: .semibold))
                    .foregroundStyle(CoachSelect.titleSmallColor)
                    .tracking(CoachSelect.titleSmallLetterSpacing)
            }
            Spacer()
            // The browser draws `.cgs-logo` / `.cgp-logo` here — the `AppLogo.tsx` ring. Swift had
            // an invisible counterweight of the same size, so this is a drop-in: same footprint,
            // no longer blank.
            HomeLogo(size: CoachSelect.backBtnWidth)
        }
        .padding(.top, CoachSelect.backBtnMarginTop)
        .padding(.leading, CoachSelect.backBtnMarginLeft)
    }

    private var roster: some View {
        LazyVGrid(columns: CoachLayout.rosterColumns, spacing: CoachSelect.row1MarginBottom) {
            ForEach(CoachRoster.all) { coach in
                Button { pick(coach) } label: { lockable(coach) }
                    .buttonStyle(.plain)
            }
        }
    }

    /// Coaches 3-5 are premium, exactly as `locked={!userIsPremium && c.id > 2}` had it. A locked
    /// card goes straight to the paywall rather than opening a modal first — also as it did.
    private func pick(_ coach: CoachProfile) {
        if premium.isCoachLocked(level: coach.id) { onPaywall() } else { store.pick(level: coach.id) }
    }

    /// The lock skin. Every one of these tokens was extracted from the RN source and has been
    /// sitting unused in `CoachMetrics.swift` since the port — nothing here is invented.
    @ViewBuilder
    private func lockable(_ coach: CoachProfile) -> some View {
        if premium.isCoachLocked(level: coach.id) {
            VStack(spacing: .zero) {
                card(coach)
                    .overlay {
                        CoachSelect.lockOverlayBackgroundColor
                            .overlay(Text(PaywallGlyph.lock)
                                .font(.system(size: CoachSelect.lockIconFontSize)))
                    }
                premiumTag
            }
        } else {
            card(coach)
        }
    }

    private var premiumTag: some View {
        Text(PaywallStrings.premium.uppercased())
            .font(.system(size: CoachSelect.premiumTagTextFontSize, weight: .bold))
            .tracking(CoachSelect.premiumTagTextLetterSpacing)
            .foregroundStyle(CoachSelect.premiumTagTextColor)
            .padding(.horizontal, CoachSelect.premiumTagPaddingHorizontal)
            .padding(.vertical, CoachSelect.premiumTagPaddingVertical)
            .background(CoachSelect.premiumTagBackgroundColor,
                        in: RoundedRectangle(cornerRadius: CoachSelect.premiumTagBorderRadius))
            .overlay(RoundedRectangle(cornerRadius: CoachSelect.premiumTagBorderRadius)
                .strokeBorder(CoachSelect.premiumTagBorderColor,
                              lineWidth: CoachSelect.premiumTagBorderWidth))
            .padding(.top, CoachSelect.premiumTagMarginTop)
    }

    private func card(_ coach: CoachProfile) -> some View {
        VStack(spacing: .zero) {
            avatar(coach)
            Text(coach.name)
                .font(.system(size: CoachSelect.coachNameFontSize, weight: .bold))
                .foregroundStyle(CoachSelect.coachNameColor)
                .padding(.bottom, CoachSelect.coachNameMarginBottom)
            Text(coach.role)
                .font(.system(size: CoachSelect.coachRoleFontSize, weight: .semibold))
                .foregroundStyle(CoachSelect.coachRoleColor)
            Text(CoachStrings.elo(coach.rating))
                .font(.system(size: CoachSelect.coachRatingFontSize, weight: .bold))
                .foregroundStyle(CoachSelect.coachRatingColor)
                .padding(.top, CoachSelect.coachRatingMarginTop)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, CoachSelect.coachCardPaddingHorizontal)
        .padding(.bottom, CoachSelect.coachCardPaddingBottom)
    }

    /// The card's three concentric sizes are FOLDED from `CoachCard`'s own arithmetic —
    /// `avatarSize` → `ringSize = +6` → `haloSize = +10` — by `gen_coach_metrics.js`, which reads
    /// them out of the extraction as signed terms. Nothing here computes a size.
    private func avatar(_ coach: CoachProfile) -> some View {
        ZStack {
            Circle()
                .fill(CoachSelect.glowHaloBackgroundColor)
                .frame(width: CoachSelect.cardSizeHaloRegular,
                       height: CoachSelect.cardSizeHaloRegular)
            Circle()
                .fill(CoachSelect.cyanRingBackgroundColor)
                .overlay(Circle().strokeBorder(CoachSelect.cyanRingBorderColor,
                                               lineWidth: CoachSelect.cyanRingBorderWidth))
                .frame(width: CoachSelect.cardSizeRingRegular,
                       height: CoachSelect.cardSizeRingRegular)
            // `CoachArt` is the loader the rest of the app already uses; a missing asset degrades
            // to the ring alone rather than to a broken-image box.
            CoachArt.image(level: coach.id)?
                .resizable()
                .scaledToFill()
                .frame(width: CoachSelect.cardSizeAvatarRegular,
                       height: CoachSelect.cardSizeAvatarRegular)
                .clipShape(Circle())
        }
        .padding(.bottom, CoachSelect.glowHaloMarginBottom)
    }

    /// Spec §7 #39: the RN switch was never persisted, so it reset on every launch.
    private var takeBackRow: some View {
        HStack {
            Text(CoachStrings.allowTakeBack)
                .font(.system(size: CoachSelect.settingsLabelFontSize, weight: .semibold))
                .foregroundStyle(CoachSelect.settingsLabelColor)
            Spacer()
            Toggle("", isOn: $store.allowTakeBack).labelsHidden()
        }
        .padding(.horizontal, CoachSelect.settingsRowPaddingHorizontal)
        .padding(.vertical, CoachSelect.settingsRowPaddingVertical)
        .background(
            RoundedRectangle(cornerRadius: CoachSelect.settingsRowBorderRadius)
                .fill(CoachSelect.settingsRowBackgroundColor)
                .overlay(
                    RoundedRectangle(cornerRadius: CoachSelect.settingsRowBorderRadius)
                        .strokeBorder(CoachSelect.settingsRowBorderColor,
                                      lineWidth: CoachSelect.settingsRowBorderWidth))
        )
        .padding(.horizontal, CoachSelect.settingsRowMarginHorizontal)
        .padding(.bottom, CoachSelect.settingsRowMarginBottom)
    }

    private var footer: some View {
        VStack(spacing: .zero) {
            Text(CoachStrings.tagline)
                .font(.system(size: CoachSelect.footerBoldFontSize, weight: .bold))
                .foregroundStyle(CoachSelect.footerBoldColor)
                .padding(.bottom, CoachSelect.footerBoldMarginBottom)
            Text(CoachStrings.subTagline)
                .font(.system(size: CoachSelect.footerLightFontSize))
                .foregroundStyle(CoachSelect.footerLightColor)
                .italic()
                .tracking(CoachSelect.footerLightLetterSpacing)
        }
        .multilineTextAlignment(.center)
    }
}

// MARK: - Colour Select (spec §2.6)

struct CoachColourScreen: View {
    @ObservedObject var store: CoachStore
    let level: Int

    private var draft: CoachGame.Game? { store.draft(level: level) }

    var body: some View {
        VStack(spacing: CoachLayout.sectionGap) {
            HStack {
                NavIconButton(.back, size: CoachSelect.backIconFontSize,
                              tint: CoachSelect.backIconColor, action: { store.backToSelect() })
                .frame(width: CoachSelect.backBtnWidth, height: CoachSelect.backBtnHeight)
                Spacer()
            }
            Text(CoachStrings.chooseSide)
                .font(.system(size: CoachPlay.colorLabelFontSize, weight: .bold))
                .foregroundStyle(CoachPlay.colorLabelColor)
                .tracking(CoachPlay.colorLabelLetterSpacing)

            if let d = draft { banner(d) }

            HStack(spacing: CoachPlay.colorRowGap) {
                side(.white)
                side(.black)
            }
            .padding(.horizontal, CoachPlay.savedGameBannerMarginHorizontal)
            Spacer()
        }
    }

    private func banner(_ d: CoachGame.Game) -> some View {
        HStack(spacing: CoachPlay.savedGameBannerGap) {
            Text(CoachStrings.unfinished(moveCount(d),
                                        d.userColor == .white ? CoachStrings.white
                                                              : CoachStrings.black))
                .font(.system(size: CoachPlay.savedGameTextFontSize, weight: .semibold))
                .foregroundStyle(CoachPlay.savedGameTextColor)
        }
        .padding(.horizontal, CoachPlay.savedGameBannerPaddingHorizontal)
        .padding(.vertical, CoachPlay.savedGameBannerPaddingVertical)
        .background(
            RoundedRectangle(cornerRadius: CoachPlay.savedGameBannerBorderRadius)
                .fill(CoachPlay.savedGameBannerBackgroundColor)
                .overlay(
                    RoundedRectangle(cornerRadius: CoachPlay.savedGameBannerBorderRadius)
                        .strokeBorder(CoachPlay.savedGameBannerBorderColor,
                                      lineWidth: CoachPlay.savedGameBannerBorderWidth))
        )
        .padding(.horizontal, CoachPlay.savedGameBannerMarginHorizontal)
    }

    private func moveCount(_ g: CoachGame.Game) -> Int { g.moveRecords.count - 1 }

    /// Spec §7 #33: **Continue honours the colour you tapped.** The RN app resumed the saved game
    /// whichever side you chose, so picking Black and continuing put you back as White.
    private func side(_ colour: CoachGame.Side) -> some View {
        Button {
            let resume = draft.flatMap { d in d.userColor == colour ? d : nil }
            store.start(level: level, userColor: colour, resume: resume)
        } label: {
            VStack(spacing: CoachPlay.colorCardGap) {
                Text(colour == .white ? CoachStrings.whiteChip : CoachStrings.blackChip)
                    .font(.system(size: colour == .white ? CoachPlay.kingWFontSize
                                                         : CoachPlay.kingBFontSize))
                    .foregroundStyle(colour == .white ? CoachPlay.kingWColor : CoachPlay.kingBColor)
                Text(colour == .white ? CoachStrings.white : CoachStrings.black)
                    .font(.system(size: colour == .white ? CoachPlay.colorNameWFontSize
                                                         : CoachPlay.colorNameBFontSize,
                                  weight: .bold))
                    .foregroundStyle(colour == .white ? CoachPlay.colorNameWColor
                                                      : CoachPlay.colorNameBColor)
                Text(colour == .white ? CoachStrings.whiteSub
                                      : CoachStrings.blackSub(CoachRoster.of(level: level).name))
                    .font(.system(size: colour == .white ? CoachPlay.colorHintWFontSize
                                                         : CoachPlay.colorHintBFontSize))
                    .foregroundStyle(colour == .white ? CoachPlay.colorHintWColor
                                                      : CoachPlay.colorHintBColor)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, CoachPlay.colorCardPaddingVertical)
            .background(
                RoundedRectangle(cornerRadius: CoachPlay.colorCardBorderRadius)
                    .fill(colour == .white ? CoachPlay.colorCardWhiteBackgroundColor
                                           : CoachPlay.colorCardBlackBackgroundColor)
                    .overlay(
                        RoundedRectangle(cornerRadius: CoachPlay.colorCardBorderRadius)
                            .strokeBorder(colour == .white ? CoachPlay.colorCardWhiteBorderColor
                                                           : CoachPlay.colorCardBlackBorderColor,
                                          lineWidth: CoachPlay.colorCardBorderWidth))
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - The game (spec §2.7, §2.8)

struct CoachGameScreen: View {
    @ObservedObject var store: CoachStore
    /// Defaulted, so the store's own screens can be previewed without an entitlement.
    var onPaywall: () -> Void = {}
    @State private var selected: Int?
    @State private var legalTargets: Set<Int> = []

    private var game: CoachGame.Game? { store.game }

    var body: some View {
        // One GeometryReader, at the top — see PuzzleSolverParts.PuzzleBoardBand. This screen's
        // board used the same `GeometryReader` + `min(w, h)` shape the puzzle solvers did, so it
        // shrank the same way whenever the move strip or the result card grew.
        GeometryReader { geo in
            VStack(spacing: .zero) {
                header
                board(edge: geo.size.width)
                moveStrip
                navRow
                if let g = game, CoachGame.isOver(g) { resultCard(g) } else { actions }
                Spacer(minLength: .zero)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            .overlay { if store.confirmingResign { resignPrompt } }
            .overlay { if let state = store.review { reviewModal(state) } }
            // "Start Review" here produces the same Game Review the Analysis Board does and spends
            // the same allowance, so it hits the same wall — with the same message.
            .overlay { if store.reviewBlocked { reviewCapOverlay } }
        }
    }

    private var header: some View {
        HStack {
            NavIconButton(.back, size: CoachSelect.backIconFontSize,
                          tint: CoachSelect.backIconColor, action: { store.exitGame() })
            .frame(width: CoachSelect.backBtnWidth, height: CoachSelect.backBtnHeight)
            Spacer()
            VStack(spacing: .zero) {
                Text(store.profile.name)
                    .font(.system(size: CoachPlay.headerNameFontSize, weight: .bold))
                    .foregroundStyle(CoachPlay.headerNameColor)
                Text(statusLine)
                    .font(.system(size: CoachPlay.headerRoleFontSize, weight: .semibold))
                    .foregroundStyle(store.profile.accent)
                    .padding(.top, CoachPlay.headerRoleMarginTop)
            }
            Spacer()
            // The browser draws `.cgs-logo` / `.cgp-logo` here — the `AppLogo.tsx` ring. Swift had
            // an invisible counterweight of the same size, so this is a drop-in: same footprint,
            // no longer blank.
            HomeLogo(size: CoachSelect.backBtnWidth)
        }
        .padding(.horizontal, CoachPlay.playHeaderPaddingHorizontal)
        .padding(.top, CoachPlay.playHeaderPaddingTop)
        .padding(.bottom, CoachPlay.playHeaderPaddingBottom)
    }

    private var statusLine: String {
        guard let g = game else { return CoachStrings.live }
        if CoachGame.isOver(g) {
            switch g.outcome {
            case .win:  return CoachStrings.gameOverWon
            case .draw: return CoachStrings.gameOverDraw
            default:    return CoachStrings.gameOver
            }
        }
        return CoachGame.isLive(g) ? CoachStrings.live : CoachStrings.reviewing
    }

    private func board(edge: CGFloat) -> some View {
        let shown = game.map { CoachGame.displayPosition($0) }
        let pos = shown.flatMap { ChessPosition(fen: $0.fen) }
        return ChessBoardBand(edge: edge) { side in
            ZStack(alignment: .topTrailing) {
                BoardView(pieces: pos.map(piecesFrom) ?? [],
                          selected: selected,
                          legalTargets: legalTargets,
                          lastMove: lastMove(shown, pos),
                          flipped: game.map(CoachGame.isFlipped) ?? false,
                          checkSquare: checkSquare(pos),
                          boardSize: side,
                          onTap: { tap($0, in: pos) })
                if let p = store.controller.premove { premoveChip(p) }
            }
        }
    }

    private func lastMove(_ shown: CoachGame.Shown?, _ pos: ChessPosition?) -> Move? {
        guard let shown = shown, let from = shown.from, let to = shown.to,
              let f = Square.index(from), let t = Square.index(to) else { return nil }
        return Move(from: f, to: t, promotion: nil)
    }

    private func checkSquare(_ pos: ChessPosition?) -> Int? {
        guard let pos = pos, pos.isInCheck(pos.sideToMove) else { return nil }
        return pos.kingSquare(pos.sideToMove)
    }

    /// A tap is a move when it is the user's turn and a PREMOVE when the coach is thinking — the
    /// controller decides which, never the board.
    private func tap(_ sq: Int, in pos: ChessPosition?) {
        guard let g = game, let pos = pos else { return }
        if let from = selected, legalTargets.contains(sq) {
            let uci = Square.name(from) + Square.name(sq) + promotionSuffix(from, sq, pos)
            selected = nil
            legalTargets = []
            if CoachTurn.canUserMove(g, store.controller) {
                store.userMove(uci: uci)
            } else {
                store.premove(from: Square.name(from), to: Square.name(sq),
                              promotion: promotionSuffix(from, sq, pos).isEmpty
                                  ? nil : promotionSuffix(from, sq, pos))
            }
            return
        }
        let moves = pos.legalMoves(from: sq)
        if moves.isEmpty { selected = nil; legalTargets = []; return }
        selected = sq
        legalTargets = Set(moves.map { $0.to })
    }

    /// Spec §7 #32: the RN premove always auto-queened. A promotion still defaults to a queen here,
    /// but it is carried explicitly so the choice is the caller's rather than the mechanism's.
    private func promotionSuffix(_ from: Int, _ to: Int, _ pos: ChessPosition) -> String {
        guard pos.squares[from]?.kind == .pawn,
              Square.rank(to) == CoachLayout.lastRankWhite
                  || Square.rank(to) == CoachLayout.lastRankBlack else { return "" }
        return CoachLayout.defaultPromotion
    }

    private func premoveChip(_ p: CoachTurn.Premove) -> some View {
        Button { store.clearPremove() } label: {
            Text(CoachStrings.premove(p.from, p.to))
                .font(.system(size: CoachPlay.premoveChipTextFontSize, weight: .bold))
                .foregroundStyle(CoachPlay.premoveChipTextColor)
                .padding(.horizontal, CoachPlay.premoveChipPaddingHorizontal)
                .padding(.vertical, CoachPlay.premoveChipPaddingVertical)
                .background(
                    RoundedRectangle(cornerRadius: CoachPlay.premoveChipBorderRadius)
                        .fill(CoachPlay.premoveChipBackgroundColor)
                        .overlay(
                            RoundedRectangle(cornerRadius: CoachPlay.premoveChipBorderRadius)
                                .strokeBorder(CoachPlay.premoveChipBorderColor,
                                              lineWidth: CoachPlay.premoveChipBorderWidth))
                )
        }
        .buttonStyle(.plain)
        .padding(CoachLayout.premoveChipInset)
    }

    // MARK: Move strip

    /// `fullMoveNumber` was deliberately dropped from the record (spec §2.4): the RN struct wrote it
    /// on every move and nothing read it. Pairs come from the array index instead.
    private var pairs: [CoachMovePair] {
        guard let g = game else { return [] }
        var out: [CoachMovePair] = []
        var i = 1
        while i < g.moveRecords.count {
            out.append(CoachMovePair(
                no: (i - 1) / 2 + 1,
                white: g.moveRecords[i].san ?? "",
                whiteIndex: i,
                black: i + 1 < g.moveRecords.count ? g.moveRecords[i + 1].san : nil,
                blackIndex: i + 1 < g.moveRecords.count ? i + 1 : nil))
            i += 2
        }
        return out
    }

    private var activeIndex: Int? {
        guard let g = game else { return nil }
        return CoachGame.isLive(g) ? g.moveRecords.count - 1 : g.reviewIndex
    }

    private var moveStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CoachLayout.stripGap) {
                ForEach(pairs) { pair in
                    Text(String(pair.no))
                        .font(.system(size: CoachPlay.movePairNumFontSize))
                        .foregroundStyle(CoachPlay.movePairNumColor)
                        .padding(.horizontal, CoachPlay.movePairNumPaddingHorizontal)
                    token(pair.white, index: pair.whiteIndex)
                    if let black = pair.black, let bi = pair.blackIndex {
                        token(black, index: bi)
                    }
                }
            }
        }
        .frame(maxHeight: CoachPlay.moveStripMaxHeight)
        .padding(.horizontal, CoachPlay.moveStripMarginHorizontal)
        .padding(.bottom, CoachPlay.moveStripMarginBottom)
    }

    private func token(_ san: String, index: Int) -> some View {
        Button { store.seek(index) } label: {
            Text(san)
                .font(.system(size: CoachPlay.moveTokenTextFontSize))
                .foregroundStyle(index == activeIndex ? CoachPlay.moveTokenTextActiveColor
                                                      : CoachPlay.moveTokenTextColor)
                .padding(.horizontal, CoachPlay.moveTokenPaddingHorizontal)
                .padding(.vertical, CoachPlay.moveTokenPaddingVertical)
                .background(
                    RoundedRectangle(cornerRadius: CoachPlay.moveTokenBorderRadius)
                        .fill(index == activeIndex ? CoachPlay.moveTokenActiveBackgroundColor
                                                   : CoachPlay.moveTokenBackgroundColor))
        }
        .buttonStyle(.plain)
    }

    // MARK: Nav

    /// `⏮` and `◀` take the SAME flag (spec §7 #37). Passing `canFirst` to one and `canPrev` to the
    /// other would reintroduce by hand the inconsistency `CoachTurn` exists to remove.
    private var navRow: some View {
        let nav = game.map(CoachTurn.navState)
        return HStack(spacing: CoachPlay.navBarGap) {
            navButton(CoachGlyph.first, nav?.canFirst ?? false) { store.seek(.zero) }
            navButton(CoachGlyph.prev, nav?.canPrev ?? false) {
                if let n = nav { store.seek(n.index - CoachLayout.oneStep) }
            }
            navButton(CoachGlyph.next, nav?.canNext ?? false) {
                if let n = nav { store.seek(n.index + CoachLayout.oneStep) }
            }
            navButton(CoachGlyph.last, nav?.canLast ?? false) { store.seek(nil) }
            if nav?.canLive == true {
                navButton(CoachStrings.liveButton, true) { store.seek(nil) }
            }
        }
        .padding(.horizontal, CoachPlay.navBarPaddingHorizontal)
        .padding(.vertical, CoachPlay.navBarPaddingVertical)
    }

    private func navButton(_ label: String, _ enabled: Bool,
                           _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: CoachPlay.navBtnTextFontSize))
                .foregroundStyle(CoachPlay.navBtnTextColor)
                .frame(width: CoachPlay.navBtnWidth, height: CoachPlay.navBtnHeight)
                .background(RoundedRectangle(cornerRadius: CoachPlay.navBtnBorderRadius)
                    .fill(CoachPlay.navBtnBackgroundColor))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? CoachLayout.enabledOpacity : CoachLayout.disabledOpacity)
    }

    // MARK: Actions and modals

    private var actions: some View {
        HStack(spacing: CoachPlay.bottomBarGap) {
            Button { store.confirmingResign = true } label: {
                Text(CoachStrings.resign)
                    .font(.system(size: CoachPlay.resignTextFontSize, weight: .bold))
                    .foregroundStyle(CoachPlay.resignTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CoachPlay.actionBtnPaddingVertical)
                    .background(RoundedRectangle(cornerRadius: CoachPlay.actionBtnBorderRadius)
                        .fill(CoachPlay.resignBtnBackgroundColor)
                        .overlay(RoundedRectangle(cornerRadius: CoachPlay.actionBtnBorderRadius)
                            .strokeBorder(CoachPlay.resignBtnBorderColor,
                                          lineWidth: CoachPlay.resignBtnBorderWidth)))
            }
            .buttonStyle(.plain)

            Button { store.takeBack() } label: {
                Text(CoachStrings.takeBack)
                    .font(.system(size: CoachPlay.takeBackTextFontSize, weight: .bold))
                    .foregroundStyle(CoachPlay.takeBackTextColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, CoachPlay.actionBtnPaddingVertical)
                    .background(RoundedRectangle(cornerRadius: CoachPlay.actionBtnBorderRadius)
                        .fill(CoachPlay.takeBackBtnBackgroundColor)
                        .overlay(RoundedRectangle(cornerRadius: CoachPlay.actionBtnBorderRadius)
                            .strokeBorder(CoachPlay.takeBackBtnBorderColor,
                                          lineWidth: CoachPlay.takeBackBtnBorderWidth)))
            }
            .buttonStyle(.plain)
            .disabled(!store.allowTakeBack)
            .opacity(store.allowTakeBack ? CoachLayout.enabledOpacity : CoachLayout.disabledOpacity)
        }
        .padding(.horizontal, CoachPlay.bottomBarPaddingHorizontal)
        .padding(.top, CoachPlay.bottomBarPaddingTop)
        .padding(.bottom, CoachPlay.bottomBarPaddingBottom)
    }

    private func resultCard(_ g: CoachGame.Game) -> some View {
        VStack(spacing: CoachPlay.modalCardGap) {
            Text(resultTitle(g))
                .font(.system(size: CoachPlay.modalResultLabelFontSize, weight: .heavy))
                .foregroundStyle(store.profile.accent)
            Text(g.result ?? "")
                .font(.system(size: CoachPlay.modalResultTextFontSize))
                .foregroundStyle(CoachPlay.headerNameColor)
                .multilineTextAlignment(.center)
                .lineSpacing(CoachPlay.modalResultTextLineHeight)
                .padding(.horizontal, CoachPlay.modalResultTextPaddingHorizontal)
            // The primary button is the coach's own colour: `play.tsx` applies it inline over
            // `modalBtn`, which is why that block carries no background of its own.
            Button { store.rematch() } label: {
                Text(CoachStrings.rematch)
                    .font(.system(size: CoachPlay.modalBtnTextFontSize, weight: .bold))
                    .foregroundStyle(CoachPlay.modalBtnTextColor)
                    .padding(.horizontal, CoachPlay.modalBtnPaddingHorizontal)
                    .padding(.vertical, CoachPlay.modalBtnPaddingVertical)
                    .background(RoundedRectangle(cornerRadius: CoachPlay.modalBtnBorderRadius)
                        .fill(store.profile.accent))
            }
            .buttonStyle(.plain)
            // Shown only when there is something to review: one position is a game that never
            // started, and the accuracy would be a mean over nothing.
            if CoachReview.isReviewable(g) {
                Button { store.startReview() } label: {
                    Text(CoachStrings.reviewGame)
                        .font(.system(size: CoachPlay.modalReviewBtnTextFontSize, weight: .bold))
                        .foregroundStyle(CoachPlay.modalReviewBtnTextColor)
                        .padding(.horizontal, CoachPlay.modalReviewBtnPaddingHorizontal)
                        .padding(.vertical, CoachPlay.modalReviewBtnPaddingVertical)
                        .background(
                            RoundedRectangle(cornerRadius: CoachPlay.modalReviewBtnBorderRadius)
                                .fill(CoachPlay.modalReviewBtnBackgroundColor)
                                .overlay(
                                    RoundedRectangle(
                                        cornerRadius: CoachPlay.modalReviewBtnBorderRadius)
                                        .strokeBorder(CoachPlay.modalReviewBtnBorderColor,
                                                      lineWidth: CoachPlay.modalReviewBtnBorderWidth)))
                }
                .buttonStyle(.plain)
                .padding(.top, CoachPlay.modalReviewBtnMarginTop)
            }
        }
        .padding(.horizontal, CoachPlay.modalCardPaddingHorizontal)
        .padding(.vertical, CoachPlay.modalCardPaddingVertical)
        .background(RoundedRectangle(cornerRadius: CoachPlay.modalCardBorderRadius)
            .fill(CoachPlay.modalCardBackgroundColor))
        .padding(.horizontal, CoachPlay.moveStripMarginHorizontal)
    }

    private func resultTitle(_ g: CoachGame.Game) -> String {
        switch g.outcome {
        case .win:  return CoachStrings.youWon
        case .loss: return CoachStrings.youLost
        default:    return CoachStrings.draw
        }
    }

    /// Spec §7 #24: resign asks first. The RN app ended the game on one tap.
    private var resignPrompt: some View {
        ZStack {
            Color.black.opacity(CoachLayout.scrimOpacity).ignoresSafeArea()
            VStack(spacing: CoachPlay.modalCardGap) {
                Text(CoachStrings.resignTitle)
                    .font(.system(size: CoachPlay.modalResultLabelFontSize, weight: .heavy))
                    .foregroundStyle(CoachPlay.headerNameColor)
                Text(CoachStrings.resignBody(store.profile.name))
                    .font(.system(size: CoachPlay.modalResultTextFontSize))
                    .foregroundStyle(CoachPlay.headerNameColor)
                    .multilineTextAlignment(.center)
                HStack(spacing: CoachPlay.modalActionsGap) {
                    Button { store.resignConfirmed() } label: {
                        Text(CoachStrings.resign)
                            .font(.system(size: CoachPlay.modalBtnTextFontSize, weight: .bold))
                            .foregroundStyle(CoachPlay.resignTextColor)
                            .padding(.horizontal, CoachPlay.modalBtnPaddingHorizontal)
                            .padding(.vertical, CoachPlay.modalBtnPaddingVertical)
                            .background(RoundedRectangle(cornerRadius: CoachPlay.modalBtnBorderRadius)
                                .fill(CoachPlay.resignBtnBackgroundColor))
                    }
                    .buttonStyle(.plain)
                    Button { store.confirmingResign = false } label: {
                        Text(CoachStrings.keepPlaying)
                            .font(.system(size: CoachPlay.modalBtnTextFontSize, weight: .bold))
                            .foregroundStyle(CoachPlay.modalReviewBtnTextColor)
                            .padding(.horizontal, CoachPlay.modalBtnPaddingHorizontal)
                            .padding(.vertical, CoachPlay.modalBtnPaddingVertical)
                            .background(RoundedRectangle(cornerRadius: CoachPlay.modalBtnBorderRadius)
                                .fill(CoachPlay.modalReviewBtnBackgroundColor))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, CoachPlay.modalCardPaddingHorizontal)
            .padding(.vertical, CoachPlay.modalCardPaddingVertical)
            .background(RoundedRectangle(cornerRadius: CoachPlay.modalCardBorderRadius)
                .fill(CoachPlay.modalCardBackgroundColor))
        }
    }

    // MARK: Game Review (spec §2.10)

    /// One modal for both halves of the review: the determinate bar is replaced in place, so a
    /// review that finishes does not flash a second card.
    @ViewBuilder
    private var reviewCapOverlay: some View {
        ZStack {
            PaywallPalette.scrim
                .ignoresSafeArea()
                .onTapGesture { store.reviewBlocked = false }
            PremiumLockCard(body_: PaywallStrings.fill(PaywallStrings.reviewCap,
                                                       ["limit": String(Entitlement.reviewsPerDay)]),
                            onSeePlans: {
                                store.reviewBlocked = false
                                onPaywall()
                            },
                            showsResetNote: true)
        }
    }

    private func reviewModal(_ state: CoachStore.ReviewState) -> some View {
        ZStack {
            CoachPlay.modalOverlayBackgroundColor.ignoresSafeArea()
            VStack(spacing: .zero) {
                Text(CoachStrings.gameReview)
                    .font(.system(size: CoachPlay.reviewModalTitleFontSize, weight: .black))
                    .foregroundStyle(CoachPlay.reviewModalTitleColor)
                    .tracking(CoachPlay.reviewModalTitleLetterSpacing)
                    .padding(.bottom, CoachPlay.reviewModalTitleMarginBottom)
                switch state {
                case .running(let done, let total):
                    reviewProgress(done: done, total: total)
                case .done(let summary):
                    reviewResults(summary)
                }
            }
            .padding(.horizontal, CoachPlay.reviewModalCardPaddingHorizontal)
            .padding(.vertical, CoachPlay.reviewModalCardPaddingVertical)
            .background(
                RoundedRectangle(cornerRadius: CoachPlay.reviewModalCardBorderRadius)
                    .fill(CoachPlay.reviewModalCardBackgroundColor)
                    .overlay(
                        RoundedRectangle(cornerRadius: CoachPlay.reviewModalCardBorderRadius)
                            // `play.tsx` writes `coach.accentColor + '30'` — the accent with a hex
                            // alpha BYTE appended, which is spec §2.10's "accent @ 19 %". Read as a
                            // percentage it would be almost twice as strong; the Pairing Manager
                            // shipped exactly that confusion once.
                            .strokeBorder(store.profile.accent
                                            .opacity(CoachLayout.accentBorderAlpha),
                                          lineWidth: CoachPlay.reviewModalCardBorderWidth))
            )
            .padding(.horizontal, CoachPlay.reviewModalCardPaddingHorizontal)
        }
    }

    /// `Analyzing… {done}/{total}` and a determinate bar. On-device the position count is known
    /// before the first search starts, so the RN spinner and its "This may take 20-30 seconds" —
    /// which described a network round trip — are replaced by real progress.
    private func reviewProgress(done: Int, total: Int) -> some View {
        VStack(spacing: CoachPlay.reviewModalActionsGap) {
            Text(CoachStrings.analyzing(done, total))
                .font(.system(size: CoachPlay.reviewLoadingTextFontSize, weight: .semibold))
                .foregroundStyle(CoachPlay.reviewLoadingTextColor)
            ProgressView(value: Double(done), total: Double(Swift.max(total, CoachLayout.oneStep)))
                .tint(CoachPlay.graphCurveStroke)
            Button { store.cancelReview() } label: {
                Text(CoachStrings.keepPlaying)
                    .font(.system(size: CoachPlay.reviewLoadingHintFontSize))
                    .foregroundStyle(CoachPlay.reviewLoadingHintColor)
            }
            .buttonStyle(.plain)
        }
    }

    private func reviewResults(_ summary: CoachReview.Summary) -> some View {
        let userColor = game?.userColor ?? .white
        let cols = CoachReview.columns(summary, userColor: userColor)
        return VStack(spacing: .zero) {
            HStack(spacing: .zero) {
                reviewColumn(cols[0])
                Rectangle()
                    .fill(CoachPlay.reviewDividerBackgroundColor)
                    .frame(width: CoachPlay.reviewDividerWidth,
                           height: CoachPlay.reviewDividerHeight)
                    .padding(.horizontal, CoachPlay.reviewDividerMarginHorizontal)
                reviewColumn(cols[1])
            }
            .padding(.bottom, CoachPlay.reviewPlayersRowMarginBottom)

            CoachEvalGraph(points: summary.evalGraph)
                .frame(height: CoachPlay.graphHeight)
                .padding(.bottom, CoachPlay.reviewGraphWrapMarginBottom)

            VStack(spacing: CoachPlay.reviewClassificationsBlockGap) {
                ForEach(CoachReview.classificationRows(summary, userColor: userColor)) { row in
                    HStack(spacing: CoachPlay.reviewClassRowGap) {
                        reviewCount(row.left, key: row.key)
                        reviewDot(row.key)
                        Text(AnalysisTables.classificationText(row.key))
                            .font(.system(size: CoachPlay.reviewClassLabelFontSize,
                                          weight: .semibold))
                            .foregroundStyle(CoachPlay.reviewClassLabelColor)
                            .frame(width: CoachPlay.reviewClassLabelWidth)
                        reviewDot(row.key)
                        reviewCount(row.right, key: row.key)
                    }
                }
            }
            .padding(.bottom, CoachPlay.reviewClassificationsBlockMarginBottom)

            HStack(spacing: CoachPlay.reviewModalActionsGap) {
                Button { store.handOffReview() } label: {
                    Text(CoachStrings.startReview)
                        .font(.system(size: CoachPlay.reviewStartBtnTextFontSize, weight: .black))
                        .foregroundStyle(CoachPlay.reviewStartBtnTextColor)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CoachPlay.reviewStartBtnPaddingVertical)
                        .background(RoundedRectangle(
                            cornerRadius: CoachPlay.reviewStartBtnBorderRadius)
                            .fill(store.profile.accent))
                }
                .buttonStyle(.plain)
                Button { store.cancelReview(); store.rematch() } label: {
                    Text(CoachStrings.newGame)
                        .font(.system(size: CoachPlay.reviewNewGameBtnTextFontSize, weight: .bold))
                        .foregroundStyle(CoachPlay.reviewNewGameBtnTextColor)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, CoachPlay.reviewNewGameBtnPaddingVertical)
                        .background(RoundedRectangle(
                            cornerRadius: CoachPlay.reviewNewGameBtnBorderRadius)
                            .fill(CoachPlay.reviewNewGameBtnBackgroundColor)
                            .overlay(RoundedRectangle(
                                cornerRadius: CoachPlay.reviewNewGameBtnBorderRadius)
                                .strokeBorder(CoachPlay.reviewNewGameBtnBorderColor,
                                              lineWidth: CoachPlay.reviewNewGameBtnBorderWidth)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func reviewColumn(_ c: CoachReview.Column) -> some View {
        VStack(spacing: .zero) {
            Text(c.label)
                .font(.system(size: CoachPlay.reviewPlayerLabelFontSize, weight: .bold))
                .foregroundStyle(CoachPlay.reviewPlayerLabelColor)
            Text(AnalysisTables.accuracyText(c.accuracy))
                .font(.system(size: CoachPlay.reviewAccuracyValueFontSize, weight: .black))
                .foregroundStyle(AnalysisReview.accuracyColor(c.accuracy))
            Text(CoachStrings.accuracy.uppercased())
                .font(.system(size: CoachPlay.reviewAccuracyLabelFontSize, weight: .semibold))
                .foregroundStyle(CoachPlay.reviewAccuracyLabelColor)
                .tracking(CoachPlay.reviewAccuracyLabelLetterSpacing)
        }
        .frame(maxWidth: .infinity)
    }

    private func reviewCount(_ n: Int, key: String) -> some View {
        Text(String(n))
            .font(.system(size: CoachPlay.reviewClassCountFontSize, weight: .heavy))
            .foregroundStyle((AnalysisTables.classification(key)?.color ?? CoachPlay.headerNameColor))
            .frame(width: CoachPlay.reviewClassCountWidth)
    }

    private func reviewDot(_ key: String) -> some View {
        Circle()
            .fill((AnalysisTables.classification(key)?.color ?? CoachPlay.headerNameColor))
            .frame(width: CoachPlay.reviewClassDotWidth, height: CoachPlay.reviewClassDotHeight)
    }
}

/// The review's eval curve (spec §2.10).
///
/// Every colour and width is `CoachPlay.graph*`, lifted by the extractor from
/// `components/EvalGraph.tsx` — the shared component the RN screen renders. The spec states them
/// in prose as well; reading them is what stops the two drifting.
struct CoachEvalGraph: View {
    let points: [GameReview.EvalGraphPoint]

    var body: some View {
        GeometryReader { geo in
            let pts = CoachReview.graphPoints(points,
                                              width: geo.size.width,
                                              height: geo.size.height,
                                              clampCp: CoachPlay.graphClampCp)
            ZStack {
                RoundedRectangle(cornerRadius: CoachPlay.graphBorderRadius)
                    .fill(CoachPlay.graphBackgroundColor)
                if pts.count > 1 {
                    // The midline first, so the curve draws over it.
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: geo.size.height / 2))
                        p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height / 2))
                    }
                    .stroke(CoachPlay.graphMidStroke, lineWidth: CoachPlay.graphMidStrokeWidth)
                    Path { p in
                        p.move(to: CGPoint(x: pts[0].x, y: pts[0].y))
                        for pt in pts.dropFirst() {
                            p.addLine(to: CGPoint(x: pt.x, y: pt.y))
                        }
                    }
                    .stroke(CoachPlay.graphCurveStroke,
                            style: StrokeStyle(lineWidth: CoachPlay.graphCurveStrokeWidth,
                                               lineJoin: .round))
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: CoachPlay.graphBorderRadius))
    }
}

/// One row of the move strip. `Identifiable` so `ForEach` needs no index arithmetic in a body.
struct CoachMovePair: Identifiable {
    let no: Int
    let white: String
    let whiteIndex: Int
    let black: String?
    let blackIndex: Int?
    var id: Int { whiteIndex }
}
