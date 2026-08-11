import SwiftUI
import BiyaherongCoachCore

// This file holds the internal app shell (desktop demo sidebar + shared cards).
// The public entry points live in Roots.swift; the platform `@main` App structs
// live in the executable target (macOS) and the Xcode iOS app target.

enum Panel: String, CaseIterable, Identifiable {
    case phone = "Phone UI"
    case puzzles = "Puzzle Hub"
    case play = "Play (Board)"
    case home = "Overview"
    case rating = "Puzzle Rating"
    case review = "Game Review"
    case tournament = "Tournament"
    case more = "Streak · Rush · Limits"
    /// The retired ten hand-made puzzles. Kept reachable in the DEMO app only, for the
    /// engine spot-check they were written for — the phone's Puzzles tab is the hub.
    /// Mirrors `?dev=samples` in `web-demo`.
    case samples = "Dev · Sample Puzzles"
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .phone: return "iphone"
        case .puzzles: return "puzzlepiece.fill"
        case .play: return "checkerboard.rectangle"
        case .home: return "checkmark.seal"
        case .rating: return "chart.line.uptrend.xyaxis"
        case .review: return "magnifyingglass"
        case .tournament: return "trophy"
        case .more: return "flame"
        case .samples: return "wrench.and.screwdriver"
        }
    }
}

struct RootView: View {
    @State private var selection: Panel? = .phone
    /// One store for the sidebar's hub, so switching panels does not reset progress.
    @StateObject private var puzzleStore = PuzzleHubStore()
    var body: some View {
        NavigationSplitView {
            List(Panel.allCases, selection: $selection) { p in
                Label(p.rawValue, systemImage: p.icon).tag(p)
            }
            .navigationTitle("Engine Demo")
            .frame(minWidth: 210)
            .scrollContentBackground(.hidden)
            .background(Theme.card)
        } detail: {
            Group {
                switch selection ?? .phone {
                case .phone: PhoneView()
                // The hub, same as the phone's Puzzles tab. The ten hand-made samples live on
                // at `.samples` — they are the engine spot-check they were written for, and they
                // use the opposite move convention, so they cannot share this solver.
                case .puzzles: PuzzleHubScreen(store: puzzleStore, onExit: {})
                case .samples: PuzzleView()
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
        .background(Theme.background)
        .environment(\.font, Theme.nunito(15))
        .preferredColorScheme(.dark)
    }
}

// Shared small UI helpers ----------------------------------------------------

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(Theme.nunito(16, .bold)).foregroundStyle(Theme.foreground)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radius))
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
    }
}

struct Metric: View {
    let label: String
    let value: String
    var tint: Color = Theme.foreground
    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(Theme.nunito(20, .bold)).foregroundStyle(tint)
            Text(label).font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
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
                Text("Biyaherong Chess Coach — Offline Core").font(Theme.nunito(28, .extraBold))
                Text("This macOS app runs the exact `BiyaherongCoachCore` domain layer that the parity suite verifies — 30,258 assertions against the real Laravel backend, 40/41 mutation score. Pick a panel to exercise a real engine.")
                    .foregroundStyle(Theme.mutedForeground)
                Card(title: "What you can test here") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(items, id: \.0) { item in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.positive)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.0).fontWeight(.semibold)
                                    Text(item.1).font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                        }
                    }
                }
                Text("Note: this is a native macOS harness, not the iOS app — no iOS simulator is available in this build environment. The engine code is identical to what the iOS app will embed.")
                    .font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground).padding(.top, 4)
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}
