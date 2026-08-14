import SwiftUI
import BiyaherongCoachCore

// ── Panel wrapper: a scaled iPhone frame on a soft violet backdrop ───────────

struct PhoneView: View {
    /// Demo chrome only — it lives OUTSIDE the phone frame because it is not part of the app.
    /// `isColorful` is a plain view input on HomeScreen with no persistence (§12); this picker
    /// exists so both themes are visible on a desktop without editing code.
    @State private var homeColorful = false

    var body: some View {
        GeometryReader { geo in
            let scale = min(1.05, max(0.5, (geo.size.height - 20) / 824))
            ZStack {
                LinearGradient(colors: [Theme.card, Theme.background], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
                PhoneFrame { PhoneApp(homeColorful: homeColorful) }.scaleEffect(scale)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .overlay(alignment: .top) {
                Picker("Home theme", selection: $homeColorful) {
                    Text("Sky").tag(false)
                    Text("Colorful").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                .padding(.top, 8)
            }
        }
    }
}

struct PhoneFrame<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .frame(width: 392, height: 812)
            .background(Theme.background)
            .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 46, style: .continuous).stroke(Color.black.opacity(0.9), lineWidth: 12))
            .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1).padding(6))
            .overlay(alignment: .top) {
                Capsule().fill(.black).frame(width: 120, height: 34).padding(.top, 12)
            }
            .shadow(color: .black.opacity(0.4), radius: 34, y: 14)
    }
}

struct PhoneApp: View {
    /// Passed straight through to `HomeScreen`. Defaulted, so existing call sites are unaffected.
    var homeColorful: Bool = false

    /// The Puzzle Hub's state. One store for all five modes and every screen inside them.
    @StateObject private var puzzleStore = PuzzleHubStore()
    @StateObject private var gameVM = ChessGameVM()
    @State private var tab = 0
    /// The Analysis Board is a pushed route in the original, with no tab bar — its seven bands
    /// cannot spare the height. It therefore covers the whole phone rather than living in a tab.
    @State private var showAnalysis = false
    /// The Pairing Manager is a pushed route too, for the same reason: it is reached from a Home
    /// tile, not a tab, and its three tabs of its own leave no room for the app's.
    @StateObject private var pairingStore = PairingStore()
    @State private var showPairing = false
    /// Play vs Coach, presented the same way and for the same reason: three screens of its own,
    /// reached from the Home tile. It is NOT the Play tab — that still shows the pre-port sample
    /// screen, which cannot be retired until `BoardView` is lifted out of `PlayView.swift`.
    @StateObject private var coachStore = CoachStore()
    @State private var showCoach = false
    /// True while the Puzzles tab has a route pushed on top of the hub — the tab bar hides, the
    /// way it does in the browser. See `PuzzleHubScreen.onPushedChange`.
    @State private var puzzlePushed = false

    // Explicit rather than relying on the synthesized inits: the `private` @StateObject properties
    // make the memberwise initializer private, so only the file-local no-argument form would be
    // reachable from Roots.swift. Spelling it out keeps both call sites obviously valid.
    init(homeColorful: Bool = false) { self.homeColorful = homeColorful }

    var body: some View {
        // The home screen's responsive scalar is derived from the whole phone screen, matching the
        // original's `Dimensions.get('window')`. Adding the safe-area insets back reconstructs that
        // window height; inside the macOS PhoneFrame there are no insets and this is a clean
        // 392 × 812, which is exactly the design baseline.
        GeometryReader { shell in
            let basis = CGSize(width: shell.size.width,
                               height: shell.size.height
                                   + shell.safeAreaInsets.top + shell.safeAreaInsets.bottom)
            // A ZStack sibling rather than `.fullScreenCover`, which does not exist on macOS — and
            // this view renders inside the macOS demo (AppShell.swift:46). It also has to cover
            // `PhoneTabBar`, which is a plain VStack sibling and not a real TabView.
            ZStack {
                VStack(spacing: 0) {
                    #if os(macOS)
                    statusBar   // simulated status bar for the desktop phone-frame preview only
                    #endif
                    Group {
                        switch tab {
                        case 0: home(basis: basis)
                        // The Puzzles tab is the HUB now, not the ten hand-made samples. Those
                        // use the opposite move convention (`solution[0]` is the solver's, where
                        // the corpus has `moves[0]` belonging to the opponent), so the two cannot
                        // share a solver — which is why the old screen is retired to a dev entry
                        // rather than adapted.
                        case 1: PuzzleHubScreen(store: puzzleStore, onExit: { tab = 0 },
                                                onPushedChange: { puzzlePushed = $0 })
                        case 2: PlayPhone(vm: gameVM)
                        default: ProfilePhone(store: puzzleStore)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // Hidden while the Puzzles tab has a route pushed, matching the browser, where
                    // every pushed route sets `an-mode` and `.app-card.an-mode .tabbar` is
                    // `display: none`. The Analysis Board, Pairing and Coach are ZStack siblings
                    // below and already cover the bar; only the Puzzle Hub lives inside a tab.
                    if !puzzlePushed { PhoneTabBar(tab: $tab) }
                }
                if showAnalysis {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        AnalysisBoardScreen(onClose: { showAnalysis = false })
                    }
                    .background(AnalysisPalette.screenBg)
                    .transition(.move(edge: .bottom))
                }
                if showPairing {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        PairingRootScreen(store: pairingStore, onExit: { showPairing = false })
                    }
                    // `PairingPalette` has no screenBg and there is no PairingTiming; rather than
                    // invent two constants, the extracted screen fill and the Analysis Board's
                    // present timing are reused deliberately.
                    .background(PairingList.containerBackgroundColor)
                    .transition(.move(edge: .bottom))
                }
                if showCoach {
                    VStack(spacing: 0) {
                        #if os(macOS)
                        statusBar
                        #endif
                        CoachRootScreen(store: coachStore, onExit: { showCoach = false })
                            // Spec 2.10's hand-off: Start Review closes Play vs Coach and opens
                            // the Analysis Board on the reviewed game, classifications and all.
                            .onChange(of: coachStore.pendingHandoff) { _, payload in
                                guard payload != nil else { return }
                                showCoach = false
                                withAnimation(.easeInOut(
                                    duration: AnalysisTiming.screenPresentSeconds)) {
                                    showAnalysis = true
                                }
                            }
                    }
                    .background(CoachSelect.containerBackgroundColor)
                    .transition(.move(edge: .bottom))
                }
            }
            .frame(width: shell.size.width, height: shell.size.height)
        }
    }

    /// Only the callbacks with a real destination today are wired; the rest are the empty closures
    /// the screen is designed around and stay that way until those screens exist.
    ///
    /// Arguments must follow `HomeScreen.init`'s declaration order — `onAnalysis` sits between
    /// `onPuzzles` and `onPlayCoach`.
    private func home(basis: CGSize) -> some View {
        HomeScreen(isColorful: homeColorful,
                   scaleBasis: basis,
                   onAvatar: { tab = 3 },
                   onPuzzles: { tab = 1 },
                   onAnalysis: {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showAnalysis = true
                       }
                   },
                   onPlayCoach: {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showCoach = true
                       }
                   },
                   onPairing: {
                       withAnimation(.easeInOut(duration: AnalysisTiming.screenPresentSeconds)) {
                           showPairing = true
                       }
                   })
    }

    private var statusBar: some View {
        HStack {
            Text("9:41").font(Theme.nunito(14, .semiBold))
            Spacer()
            HStack(spacing: 6) { Image(systemName: "cellularbars"); Image(systemName: "wifi"); Image(systemName: "battery.75") }
                .font(Theme.nunito(12, .medium))
        }
        .foregroundStyle(Theme.foreground)
        .padding(.horizontal, 26).padding(.top, 15).padding(.bottom, 6)
    }
}

struct PhoneTabBar: View {
    @Binding var tab: Int
    private let items = [("Home", "square.grid.2x2.fill"), ("Puzzles", "puzzlepiece.fill"),
                         ("Play", "checkerboard.rectangle"), ("Profile", "person.crop.circle")]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(items.indices, id: \.self) { i in
                Button { withAnimation(.easeInOut(duration: 0.15)) { tab = i } } label: {
                    VStack(spacing: 3) {
                        Image(systemName: items[i].1).font(Theme.nunito(19, .semiBold))
                        Text(items[i].0).font(Theme.nunito(10, .medium))
                    }
                    .foregroundStyle(tab == i ? Theme.violet : Theme.mutedForeground)
                    .frame(maxWidth: .infinity)
                }.buttonStyle(.plain)
            }
        }
        .padding(.top, 10).padding(.bottom, 22)
        .background(.ultraThinMaterial)
        .overlay(Rectangle().fill(Theme.border).frame(height: 1), alignment: .top)
    }
}

// ── Shared building blocks ───────────────────────────────────────────────────

struct PhoneTitle: View {
    let title: String
    var body: some View {
        HStack {
            Text(title).font(Theme.nunito(30, .bold)).foregroundStyle(Theme.foreground)
            Spacer()
        }.padding(.horizontal, 18).padding(.top, 4)
    }
}

/// The Analysis Board's and Play's promotion picker: a row of square tiles, no labels.
///
/// Every number now comes from `AnalysisPromotion`, extracted from `board.tsx`. It used to be
/// hand-typed — 46pt tiles where the source has 60, radius 8 where it has 12, `Theme.boardLight`
/// where it has `#455A64`, and no title at all — while the extracted values sat unread. That is
/// the same bug the web `<chess-board>` dialog had, in the other language.
///
/// **This is not the puzzle hub's dialog.** See `PuzzlePromotionOverlay`: the two share a purpose
/// and not one measurement, so they are deliberately two views.
struct PromotionOverlay: View {
    let color: PieceColor
    let onChoose: (PieceKind) -> Void
    var body: some View {
        VStack(spacing: AnalysisPromotion.titleMarginBottom) {
            Text(AnalysisPromotion.title)
                .font(Theme.nunito(AnalysisPromotion.titleSize, .bold))
                .foregroundStyle(AnalysisPromotion.titleColor)
            HStack(spacing: AnalysisPromotion.optionsGap) {
                ForEach(AnalysisPromotion.order, id: \.self) { k in
                    Button { onChoose(k) } label: {
                        PieceImage(piece: Piece(color, k),
                                   size: AnalysisPromotion.optionSize, shadow: false)
                            .frame(width: AnalysisPromotion.optionSize,
                                   height: AnalysisPromotion.optionSize)
                            .background(AnalysisPromotion.optionFill,
                                        in: RoundedRectangle(cornerRadius: AnalysisPromotion.optionRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(AnalysisPromotion.dialogPadding)
        .background(AnalysisPromotion.dialogFill,
                    in: RoundedRectangle(cornerRadius: AnalysisPromotion.dialogRadius))
        .shadow(radius: AnalysisPromotion.elevation)
    }
}

/// The puzzle hub's promotion picker: a vertical list of labelled, accent-filled rows.
///
/// Structurally different from `PromotionOverlay` because the source is: `promotionOption` in the
/// puzzle screens is `flexDirection: 'row'` with a text label and the screen's accent as its fill,
/// where `board.tsx` has an unlabelled 60pt square. Both are extracted; neither is a preference.
///
/// The scrim comes from `PuzzlePromotion.scrimFor(mode)` — Streak and Turbo dim to 0.82 where the
/// other three use 0.80, which is the whole reason the extraction keeps two values.
struct PuzzlePromotionOverlay: View {
    let color: PieceColor
    let mode: PuzzleSession.Mode
    let onChoose: (PieceKind) -> Void

    var body: some View {
        ZStack {
            PuzzlePromotion.scrimFor(mode).ignoresSafeArea()
            VStack(spacing: PuzzlePromotion.optionsGap) {
                Text(PuzzleStrings.promotionTitle)
                    .font(Theme.nunito(PuzzlePromotion.titleSize, .bold))
                    .foregroundStyle(PuzzlePalette.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, PuzzlePromotion.titleMarginBottom)
                ForEach(PuzzlePromotion.order, id: \.self) { k in
                    Button { onChoose(k) } label: {
                        HStack(spacing: PuzzlePromotion.optionGap) {
                            PieceImage(piece: Piece(color, k),
                                       size: PuzzlePromotion.glyphSize, shadow: false)
                            Text(PuzzlePromotion.label(k))
                                .font(Theme.nunito(PuzzlePromotion.optionTextSize, .bold))
                                .foregroundStyle(PuzzlePalette.textPrimary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(PuzzlePromotion.optionPadding)
                        .background(PuzzlePromotion.accent(mode),
                                    in: RoundedRectangle(cornerRadius: PuzzlePromotion.optionRadius))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(PuzzlePromotion.dialogPadding)
            .frame(width: PuzzlePromotion.dialogWidth)
            .background(PuzzlePalette.card,
                        in: RoundedRectangle(cornerRadius: PuzzlePromotion.dialogRadius))
        }
    }
}

/// The legacy Play tab's board chrome. `size` is now measured, not assumed: it used to default to
/// 344 and be called with a hard-coded 330, which meant the board was the wrong width on every
/// phone that is not the design baseline. It goes through `ChessBoardBand` like every other board.
func phoneBoard(_ board: BoardView, size: CGFloat) -> some View {
    ChessBoardBand(edge: size) { _ in board }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
}

/// What `PlayPhone` reserves beside the board: the eval bar's 14pt, the 8pt gap, and the row's
/// 16pt padding on each side. Named rather than inlined so the board edge below reads as one
/// subtraction instead of four magic numbers.
private enum PlayPhoneBoard {
    static let evalBarWidth: CGFloat = 14
    static let evalBarGap: CGFloat = 8
    static let rowPaddingH: CGFloat = 16
    static func edge(screenWidth: CGFloat) -> CGFloat {
        max(0, screenWidth - rowPaddingH * 2 - evalBarWidth - evalBarGap)
    }
}

func phoneCard<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        Text(title.uppercased()).font(Theme.nunito(11, .semiBold)).tracking(0.7).foregroundStyle(Theme.mutedForeground)
        content()
    }
    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
    .padding(.horizontal, 18)
}

// ── Puzzles tab ─────────────────────────────────────────────────────────────────
//
// `PuzzlesPhone` lived here and is gone: the tab shows `PuzzleHubScreen` now. The ten hand-made
// samples it drew survive at `AppShell`'s `.samples` panel, which is the engine spot-check they
// were written for. Two unreachable copies of a retired screen would be one too many.

struct PlayPhone: View {
    @ObservedObject var vm: ChessGameVM
    private var coachLevel: Int { (Coaches.all.firstIndex { $0.id == vm.coach?.id } ?? 0) + 1 }

    var body: some View {
        if vm.started {
            // One GeometryReader, at the top — the board edge below is derived from this width.
            GeometryReader { geo in gameView(edge: PlayPhoneBoard.edge(screenWidth: geo.size.width)) }
        } else {
            LegacyCoachSelect(vm: vm)
        }
    }

    private func gameView(edge: CGFloat) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Text("Play").font(Theme.nunito(30, .bold)).foregroundStyle(Theme.foreground)
                    Spacer()
                    Button { vm.backToSelect() } label: {
                        Label("Change", systemImage: "arrow.left.arrow.right").font(Theme.nunito(14, .medium)).foregroundStyle(Theme.violet)
                    }.buttonStyle(.plain)
                }.padding(.horizontal, 18).padding(.top, 4)

                HStack(spacing: 10) {
                    if let c = vm.coach {
                        CoachAvatar(name: c.name, size: 40, level: CoachArt.level(forCoachId: c.id))
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) { Text(c.name).font(Theme.nunito(14, .semiBold)); TitleBadge(c.title) }
                            StrengthDots(level: coachLevel)
                        }
                        Spacer()
                        Text("\(c.rating)").font(Theme.nunito(16, .bold)).foregroundStyle(Theme.violet)
                    } else {
                        Image(systemName: "person.2.fill").font(Theme.nunito(18, .semiBold)).foregroundStyle(Theme.violet)
                        Text("Pass & play").font(Theme.nunito(14, .semiBold))
                        Spacer()
                    }
                }.padding(.horizontal, 18)

                HStack(alignment: .top, spacing: PlayPhoneBoard.evalBarGap) {
                    EvalBar(whitePct: vm.whiteWinPct, height: edge)
                    phoneBoard(BoardView(pieces: vm.pieces, selected: vm.selected, legalTargets: vm.legalTargets,
                                         lastMove: vm.lastMove, flipped: vm.flipped, checkSquare: vm.checkKingSquare,
                                         boardSize: edge, onTap: { vm.tap($0) }), size: edge)
                        .overlay { if vm.pendingPromotion != nil { PromotionOverlay(color: vm.position.sideToMove) { vm.choosePromotion($0) } } }
                }.padding(.horizontal, PlayPhoneBoard.rowPaddingH)

                HStack(spacing: 6) {
                    Text(vm.thinking ? "\(vm.coach?.name ?? "Coach") is thinking…" : vm.statusText)
                        .font(Theme.nunito(12, .medium))
                        .foregroundStyle(vm.status == .checkmate ? Theme.negative : (vm.status == .check ? Theme.warning : Theme.mutedForeground))
                    Spacer()
                    Text("Material \(vm.materialDiff > 0 ? "+" : "")\(vm.materialDiff)")
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.mutedForeground)
                }.padding(.horizontal, 18)

                MoveRibbon(sans: vm.history).padding(.horizontal, 18)

                HStack(spacing: 10) {
                    Button(action: { vm.newGame() }) {
                        Label("New game", systemImage: "arrow.clockwise").frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(Theme.violetGradient, in: RoundedRectangle(cornerRadius: Theme.radius))
                            .foregroundStyle(Theme.onGold).fontWeight(.semibold)
                    }.buttonStyle(.plain)
                    controlIcon("arrow.uturn.backward") { vm.undo() }.disabled(vm.history.isEmpty || vm.thinking)
                    controlIcon("arrow.up.arrow.down") { withAnimation { vm.flipped.toggle() } }
                }.padding(.horizontal, 18)
                Spacer(minLength: 8)
            }
        }
    }

    private func controlIcon(_ name: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).frame(width: 46, height: 40)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
                .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border))
                .foregroundStyle(Theme.foreground)
        }.buttonStyle(.plain)
    }
}

// ── Learn tab ────────────────────────────────────────────────────────────────

struct LearnPhone: View {
    @State private var before = 60
    @State private var after = -30
    @State private var color = "w"
    @State private var isBest = false

    private var cpLoss: Int { max(0, color == "w" ? (before - after) : (after - before)) }
    private var isBrill: Bool { GameReview.isBrilliantMove(san: "x", color: color, evalBefore: before, evalAfter: after) }
    private var cls: String { GameReview.classifyMove(cpLoss: cpLoss, isBestMove: isBest, isBrilliant: isBrill) }
    private var winAfter: Double { GameReview.evalToWinPct(evalCp: after, color: color) }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                PhoneTitle(title: "Learn")
                HStack(spacing: 16) {
                    RingGauge(value: winAfter / 100, size: 104,
                              color: winAfter >= 50 ? Theme.positive : Theme.warning,
                              center: "\(Int(round(winAfter)))", caption: "% win")
                    VStack(alignment: .leading, spacing: 12) {
                        ClassificationBadge(classification: cls)
                        HStack(spacing: 6) { Image(systemName: "arrow.down.right"); Text("\(cpLoss) cp lost") }
                            .font(Theme.nunito(15, .regular)).foregroundStyle(Theme.mutedForeground)
                        Text("How every move is graded — the exact ladder from the verified engine.")
                            .font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }.padding(.horizontal, 18)

                phoneCard("Evaluation (centipawns)") {
                    VStack(spacing: 12) { sliderRow("Before", $before); sliderRow("After", $after) }
                }
                phoneCard("Context") {
                    VStack(spacing: 12) {
                        Picker("", selection: $color) { Text("White to move").tag("w"); Text("Black to move").tag("b") }.pickerStyle(.segmented)
                        Toggle("Played the engine's best move", isOn: $isBest)
                    }
                }
                Spacer(minLength: 8)
            }
        }
    }

    private func sliderRow(_ label: String, _ v: Binding<Int>) -> some View {
        HStack {
            Text(label).font(Theme.nunito(15, .regular)).frame(width: 66, alignment: .leading)
            Slider(value: Binding(get: { Double(v.wrappedValue) }, set: { v.wrappedValue = Int($0) }), in: -1500...1500, step: 5)
            Text("\(v.wrappedValue)").font(.system(size: 15, design: .monospaced)).frame(width: 52, alignment: .trailing).foregroundStyle(Theme.mutedForeground)
        }
    }
}

// ── Profile tab ──────────────────────────────────────────────────────────────

struct ProfilePhone: View {
    /// Reads the hub's store, not the retired sample solver — otherwise the profile would show a
    /// rating and a solve count from a screen the user can no longer reach.
    @ObservedObject var store: PuzzleHubStore
    private var accuracy: Double {
        // `PuzzleStats.accuracy` is the golden-tested one; it returns nil before any attempt.
        guard let a = PuzzleStats.accuracy(store.state) else { return 0 }
        return Double(a.solved) / Double(max(a.attempted, 1))
    }
    private var rating: Int { store.state.profile.rating }
    private var solvedCount: Int { PuzzleStats.accuracy(store.state)?.solved ?? 0 }
    private var attempted: Int { PuzzleStats.accuracy(store.state)?.attempted ?? 0 }
    /// Same window and ordering `PuzzleStats.sparkline` charts — the newest `sparkWindow` rows,
    /// reversed to oldest-first — flattened to the `[Int]` this panel's `Sparkline` draws.
    private var ratingHistory: [Int] {
        PuzzleProgress.ratingHistory(store.state, limit: PuzzleStats.sparkWindow)
            .reversed().map(\.ratingAfter)
    }
    private let tierRows: [(String, Int)] = [("Expert", 2000), ("Advanced", 1600), ("Intermediate", 1200), ("Beginner", 800), ("Novice", 0)]

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                PhoneTitle(title: "Profile")

                HStack(spacing: 14) {
                    Text("B").font(Theme.nunito(30, .extraBold)).foregroundStyle(Theme.onGold)
                        .frame(width: 64, height: 64).background(Theme.onGold.opacity(0.14), in: Circle())
                        .overlay(Circle().stroke(Theme.onGold.opacity(0.3)))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Biyahero").font(Theme.nunito(20, .bold)).foregroundStyle(Theme.onGold)
                        Text(RatingTier.classify(rating)).font(Theme.nunito(14, .medium)).foregroundStyle(Theme.onGold.opacity(0.75))
                        Text("\(rating) rating").font(Theme.nunito(21, .extraBold)).foregroundStyle(Theme.onGold)
                    }
                    Spacer()
                }
                .padding(18).background(Theme.violetGradient, in: RoundedRectangle(cornerRadius: 18)).padding(.horizontal, 18)

                HStack(spacing: 10) {
                    StatTile(icon: "checkmark.seal.fill", value: "\(solvedCount)", label: "Solved", tint: Theme.positive)
                    StatTile(icon: "target", value: attempted == 0 ? "—" : "\(Int(round(accuracy * 100)))%", label: "Accuracy", tint: Theme.violet)
                    StatTile(icon: "flag.checkered", value: "\(attempted)", label: "Attempts", tint: Theme.warning)
                }.padding(.horizontal, 18)

                phoneCard("Rating progress") {
                    Sparkline(values: ratingHistory).frame(height: 62)
                }

                phoneCard("Tier") {
                    VStack(alignment: .leading, spacing: 10) {
                        GeometryReader { geo in
                            let (lo, hi) = band(rating)
                            let frac = max(0.02, min(1, Double(rating - lo) / Double(max(1, hi - lo))))
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.border).frame(height: 8)
                                Capsule().fill(Theme.violetGradient).frame(width: geo.size.width * frac, height: 8)
                            }
                        }.frame(height: 8)
                        ForEach(tierRows, id: \.0) { name, floor in
                            HStack {
                                Circle().fill(RatingTier.classify(rating) == name ? AnyShapeStyle(Theme.violet) : AnyShapeStyle(Theme.border)).frame(width: 8, height: 8)
                                Text(name).fontWeight(RatingTier.classify(rating) == name ? .semibold : .regular)
                                Spacer()
                                Text("\(floor)+").foregroundStyle(Theme.mutedForeground)
                            }.font(Theme.nunito(15, .regular))
                        }
                    }
                }

                phoneCard("Your coaches") {
                    HStack(spacing: 12) {
                        ForEach(Coaches.all) { c in
                            VStack(spacing: 4) {
                                CoachAvatar(name: c.name, size: 40, level: CoachArt.level(forCoachId: c.id))
                                Text(c.name.split(separator: " ").first.map(String.init) ?? "").font(Theme.nunito(9, .regular)).foregroundStyle(Theme.mutedForeground)
                            }
                        }
                    }
                }
                Spacer(minLength: 8)
            }
        }
    }

    private func band(_ r: Int) -> (Int, Int) {
        if r >= 2000 { return (2000, 2800) }
        if r >= 1600 { return (1600, 2000) }
        if r >= 1200 { return (1200, 1600) }
        if r >= 800 { return (800, 1200) }
        return (0, 800)
    }
}
