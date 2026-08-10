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

    @StateObject private var puzzleVM = PuzzleVM()
    @StateObject private var gameVM = ChessGameVM()
    @State private var tab = 0
    /// The Analysis Board is a pushed route in the original, with no tab bar — its seven bands
    /// cannot spare the height. It therefore covers the whole phone rather than living in a tab.
    @State private var showAnalysis = false

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
                        case 1: PuzzlesPhone(vm: puzzleVM)
                        case 2: PlayPhone(vm: gameVM)
                        default: ProfilePhone(vm: puzzleVM)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    PhoneTabBar(tab: $tab)
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
                   onPlayCoach: { tab = 2 })
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

struct PromotionOverlay: View {
    let color: PieceColor
    let onChoose: (PieceKind) -> Void
    var body: some View {
        HStack(spacing: 8) {
            ForEach([PieceKind.queen, .rook, .bishop, .knight], id: \.self) { k in
                Button { onChoose(k) } label: {
                    PieceImage(piece: Piece(color, k), size: 40, shadow: false)
                        .frame(width: 46, height: 46).background(Theme.boardLight, in: RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain)
            }
        }
        .padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)).shadow(radius: 16)
    }
}

func phoneBoard(_ board: BoardView, size: CGFloat = 344) -> some View {
    board
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
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

// ── Puzzles tab ──────────────────────────────────────────────────────────────

struct PuzzlesPhone: View {
    @ObservedObject var vm: PuzzleVM
    private var accuracy: Double { vm.attempted == 0 ? 0 : Double(vm.solved) / Double(vm.attempted) }

    var body: some View {
        ScrollView {
            VStack(spacing: 13) {
                PhoneTitle(title: "Puzzles")
                HStack(spacing: 12) {
                    RingGauge(value: accuracy, size: 74,
                              center: vm.attempted == 0 ? "—" : "\(Int(round(accuracy * 100)))",
                              caption: "% solved")
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text("YOUR RATING").font(Theme.nunito(10, .semiBold)).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                            Spacer()
                            Text("\(vm.userRating)").font(Theme.nunito(19, .bold)).foregroundStyle(Theme.violet)
                        }
                        Sparkline(values: vm.ratingHistory).frame(height: 40)
                        Text(vm.puzzle.map { "Puzzle \($0.rating) · \(vm.solved) solved" } ?? " ")
                            .font(Theme.nunito(11, .regular)).foregroundStyle(Theme.mutedForeground)
                    }
                    .padding(12)
                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
                }.padding(.horizontal, 18)

                phoneBoard(BoardView(pieces: vm.pieces, selected: vm.selected, legalTargets: vm.legalTargets,
                                     lastMove: vm.lastMove, flipped: vm.flipped, checkSquare: vm.checkKingSquare,
                                     boardSize: 344, onTap: { vm.tap($0) }))
                    .overlay { if vm.pendingPromotion != nil { PromotionOverlay(color: vm.sideToMove) { vm.choosePromotion($0) } } }

                MoveRibbon(sans: vm.sanHistory).padding(.horizontal, 18)

                VStack(spacing: 10) {
                    statusLine
                    Button(action: { vm.phase == .solving ? vm.finishSkip() : vm.next() }) {
                        Label(vm.phase == .solving ? "Skip puzzle" : "Next puzzle",
                              systemImage: vm.phase == .solving ? "forward.fill" : "arrow.right.circle.fill")
                            .frame(maxWidth: .infinity).padding(.vertical, 11)
                            .background(vm.phase == .solving ? AnyShapeStyle(Theme.muted) : AnyShapeStyle(Theme.violetGradient),
                                        in: RoundedRectangle(cornerRadius: Theme.radius))
                            .foregroundStyle(vm.phase == .solving ? Theme.foreground : Theme.onGold)
                            .fontWeight(.semibold)
                    }.buttonStyle(.plain)
                }.padding(.horizontal, 18)
                Spacer(minLength: 8)
            }
        }
    }

    private var statusLine: some View {
        HStack {
            switch vm.phase {
            case .solved:
                Label("Solved  +\(vm.lastDelta)", systemImage: "checkmark.seal.fill").foregroundStyle(Theme.positive)
            case .failed:
                Label("Missed  \(vm.lastDelta)", systemImage: "xmark.seal.fill").foregroundStyle(Theme.negative)
                if let s = vm.correctSAN { Text("· best \(s)").foregroundStyle(Theme.mutedForeground) }
            default:
                Text(vm.message).foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
        }.font(Theme.nunito(14, .medium))
    }
}

// ── Play tab ─────────────────────────────────────────────────────────────────

struct PlayPhone: View {
    @ObservedObject var vm: ChessGameVM
    private var coachLevel: Int { (Coaches.all.firstIndex { $0.id == vm.coach?.id } ?? 0) + 1 }

    var body: some View {
        if vm.started { gameView } else { CoachSelect(vm: vm) }
    }

    private var gameView: some View {
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

                HStack(alignment: .top, spacing: 8) {
                    EvalBar(whitePct: vm.whiteWinPct, height: 330)
                    phoneBoard(BoardView(pieces: vm.pieces, selected: vm.selected, legalTargets: vm.legalTargets,
                                         lastMove: vm.lastMove, flipped: vm.flipped, checkSquare: vm.checkKingSquare,
                                         boardSize: 330, onTap: { vm.tap($0) }), size: 330)
                        .overlay { if vm.pendingPromotion != nil { PromotionOverlay(color: vm.position.sideToMove) { vm.choosePromotion($0) } } }
                }.padding(.horizontal, 16)

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
    @ObservedObject var vm: PuzzleVM
    private var accuracy: Double { vm.attempted == 0 ? 0 : Double(vm.solved) / Double(vm.attempted) }
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
                        Text(RatingTier.classify(vm.userRating)).font(Theme.nunito(14, .medium)).foregroundStyle(Theme.onGold.opacity(0.75))
                        Text("\(vm.userRating) rating").font(Theme.nunito(21, .extraBold)).foregroundStyle(Theme.onGold)
                    }
                    Spacer()
                }
                .padding(18).background(Theme.violetGradient, in: RoundedRectangle(cornerRadius: 18)).padding(.horizontal, 18)

                HStack(spacing: 10) {
                    StatTile(icon: "checkmark.seal.fill", value: "\(vm.solved)", label: "Solved", tint: Theme.positive)
                    StatTile(icon: "target", value: vm.attempted == 0 ? "—" : "\(Int(round(accuracy * 100)))%", label: "Accuracy", tint: Theme.violet)
                    StatTile(icon: "flag.checkered", value: "\(vm.attempted)", label: "Attempts", tint: Theme.warning)
                }.padding(.horizontal, 18)

                phoneCard("Rating progress") {
                    Sparkline(values: vm.ratingHistory).frame(height: 62)
                }

                phoneCard("Tier") {
                    VStack(alignment: .leading, spacing: 10) {
                        GeometryReader { geo in
                            let (lo, hi) = band(vm.userRating)
                            let frac = max(0.02, min(1, Double(vm.userRating - lo) / Double(max(1, hi - lo))))
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.border).frame(height: 8)
                                Capsule().fill(Theme.violetGradient).frame(width: geo.size.width * frac, height: 8)
                            }
                        }.frame(height: 8)
                        ForEach(tierRows, id: \.0) { name, floor in
                            HStack {
                                Circle().fill(RatingTier.classify(vm.userRating) == name ? AnyShapeStyle(Theme.violet) : AnyShapeStyle(Theme.border)).frame(width: 8, height: 8)
                                Text(name).fontWeight(RatingTier.classify(vm.userRating) == name ? .semibold : .regular)
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
