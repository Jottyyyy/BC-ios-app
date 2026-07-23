import SwiftUI
import BiyaherongCoachCore

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup("Biyaherong Coach — Engine Demo") {
            RootView()
        }
        .defaultSize(width: 1060, height: 740)
    }
}

enum Panel: String, CaseIterable, Identifiable {
    case puzzles = "Puzzles"
    case play = "Play (Board)"
    case home = "Overview"
    case rating = "Puzzle Rating"
    case review = "Game Review"
    case tournament = "Tournament"
    case more = "Streak · Rush · Limits"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .puzzles: return "puzzlepiece.fill"
        case .play: return "checkerboard.rectangle"
        case .home: return "checkmark.seal"
        case .rating: return "chart.line.uptrend.xyaxis"
        case .review: return "magnifyingglass"
        case .tournament: return "trophy"
        case .more: return "flame"
        }
    }
}

struct RootView: View {
    @State private var selection: Panel? = .puzzles
    var body: some View {
        NavigationSplitView {
            List(Panel.allCases, selection: $selection) { p in
                Label(p.rawValue, systemImage: p.icon).tag(p)
            }
            .navigationTitle("Engine Demo")
            .frame(minWidth: 210)
        } detail: {
            Group {
                switch selection ?? .puzzles {
                case .puzzles: PuzzleView()
                case .play: PlayView()
                case .home: HomeView()
                case .rating: RatingView()
                case .review: ReviewView()
                case .tournament: TournamentView()
                case .more: MoreView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background)
        }
        .tint(Theme.primary)
        .foregroundStyle(Theme.foreground)
    }
}

// Shared small UI helpers ----------------------------------------------------

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).foregroundStyle(Theme.foreground)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
    }
}

struct Metric: View {
    let label: String
    let value: String
    var tint: Color = Theme.foreground
    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(.system(.title2, design: .rounded).weight(.semibold)).foregroundStyle(tint)
            Text(label).font(.caption).foregroundStyle(Theme.mutedForeground)
        }
        .frame(maxWidth: .infinity)
    }
}

struct HomeView: View {
    let items: [(String, String)] = [
        ("Puzzle Rating", "ELO (K=32, floor 400) + rating tier — PuzzleController / ShareController"),
        ("Game Review", "9-tier move classification + accuracy + eval graph — GameReviewController"),
        ("Tournament", "Swiss & Round-Robin pairing, Buchholz / Sonneborn-Berger / direct-encounter — TournamentController"),
        ("Streak · Rush · Limits", "Streak ramp, rush best-score, daily caps, serving ladders"),
    ]
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Biyaherong Chess Coach — Offline Core").font(.largeTitle.weight(.bold))
                Text("This macOS app runs the exact `BiyaherongCoachCore` domain layer that the parity suite verifies — 30,258 assertions against the real Laravel backend, 40/41 mutation score. Pick a panel to exercise a real engine.")
                    .foregroundStyle(.secondary)
                Card(title: "What you can test here") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(items, id: \.0) { item in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.positive)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.0).fontWeight(.semibold)
                                    Text(item.1).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                Text("Note: this is a native macOS harness, not the iOS app — no iOS simulator is available in this build environment. The engine code is identical to what the iOS app will embed.")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 4)
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}
