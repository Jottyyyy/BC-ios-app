import SwiftUI
import BiyaherongCoachCore

@MainActor
final class TournamentVM: ObservableObject {
    @Published var playerCount = 6
    @Published var rated = true
    @Published var type = "swiss"          // "swiss" | "round_robin"
    @Published var swissRounds = 3

    @Published var order: [Int] = []
    @Published var byId: [Int: TournamentPlayer] = [:]
    @Published var priorRounds: [TournamentRound] = []
    @Published var currentPairings: [PairSpec] = []
    @Published var currentResults: [String] = []
    @Published var completedRounds = 0
    @Published var totalRounds = 3
    @Published var message = "Configure a tournament and press Start."

    var started: Bool { !order.isEmpty }
    var finished: Bool { started && completedRounds >= totalRounds }
    func currentPlayers() -> [TournamentPlayer] { order.compactMap { byId[$0] } }

    func start() {
        order = []; byId = [:]; priorRounds = []; currentPairings = []; currentResults = []; completedRounds = 0
        for i in 1...playerCount {
            let rating = rated ? 1800 - (i - 1) * 60 : nil
            byId[i] = TournamentPlayer(id: i, name: "P\(i)", ncfpRating: rating, seed: i)
            order.append(i)
        }
        totalRounds = type == "swiss"
            ? TournamentEngine.swissTotalRounds(requested: swissRounds, isPremium: true)
            : TournamentEngine.roundRobinRounds(playerCount: playerCount, isPremium: true)
        message = "Started \(type == "swiss" ? "Swiss" : "Round-Robin") with \(playerCount) players, \(totalRounds) rounds."
    }

    func generateNextRound() {
        guard started, !finished, currentPairings.isEmpty else { return }
        let r = completedRounds + 1
        let pairs = type == "swiss"
            ? TournamentEngine.generateSwissPairings(players: currentPlayers(), rounds: priorRounds, roundNumber: r)
            : TournamentEngine.generateRoundRobinPairings(players: currentPlayers(), roundNumber: r)
        // Award byes at generation (demo simplification).
        for p in pairs where p.isBye {
            if let id = p.white ?? p.black, var pl = byId[id] { TournamentEngine.awardBye(&pl); byId[id] = pl }
        }
        currentPairings = pairs
        currentResults = pairs.map { $0.isBye ? "bye" : "1-0" }
        message = "Round \(r): enter results, then Submit."
    }

    func submitRound() {
        guard !currentPairings.isEmpty else { return }
        var persisted: [TournamentPairing] = []
        for (i, p) in currentPairings.enumerated() {
            let res = p.isBye ? "bye" : currentResults[i]
            if !p.isBye, let w = p.white, let b = p.black, var wp = byId[w], var bp = byId[b] {
                TournamentEngine.applyResult(white: &wp, black: &bp, result: res)
                byId[w] = wp; byId[b] = bp
            }
            persisted.append(TournamentPairing(whitePlayerId: p.white, blackPlayerId: p.black, result: res, isBye: p.isBye))
        }
        priorRounds.append(TournamentRound(roundNumber: completedRounds + 1, pairings: persisted))
        let all = priorRounds.flatMap { $0.pairings }
        for rp in TournamentEngine.recalculateTiebreakers(players: currentPlayers(), pairings: all) { byId[rp.id] = rp }
        completedRounds += 1
        currentPairings = []; currentResults = []
        message = finished ? "Tournament finished." : "Round \(completedRounds) submitted."
    }

    func standings() -> [TournamentPlayer] { TournamentEngine.standingsSorted(currentPlayers()) }
    func name(_ id: Int?) -> String { id.flatMap { byId[$0]?.name } ?? "—" }
}

struct TournamentView: View {
    @StateObject private var vm = TournamentVM()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Tournament").font(Theme.nunito(28, .extraBold))
                Text("Swiss & Round-Robin pairing with Buchholz, Sonneborn-Berger, and direct-encounter tiebreaks — `TournamentController`.")
                    .foregroundStyle(Theme.mutedForeground)

                Card(title: "Setup") {
                    VStack(spacing: 12) {
                        HStack {
                            Text("Format").frame(width: 90, alignment: .leading)
                            Picker("", selection: $vm.type) {
                                Text("Swiss").tag("swiss"); Text("Round-Robin").tag("round_robin")
                            }.pickerStyle(.segmented).frame(width: 260)
                            Spacer()
                            Toggle("Seed by rating", isOn: $vm.rated).toggleStyle(.switch)
                        }
                        HStack {
                            Text("Players").frame(width: 90, alignment: .leading)
                            Stepper(value: $vm.playerCount, in: 2...12) { Text("\(vm.playerCount)").monospacedDigit() }
                            if vm.type == "swiss" {
                                Spacer(); Text("Rounds").foregroundStyle(Theme.mutedForeground)
                                Stepper(value: $vm.swissRounds, in: 1...9) { Text("\(vm.swissRounds)").monospacedDigit() }
                            }
                            Spacer()
                            Button("Start / Reset") { vm.start() }.buttonStyle(.borderedProminent)
                        }
                    }
                }

                if vm.started {
                    HStack {
                        Text(vm.message).foregroundStyle(Theme.mutedForeground)
                        Spacer()
                        if vm.currentPairings.isEmpty {
                            Button(vm.finished ? "Finished" : "Generate round \(vm.completedRounds + 1)") { vm.generateNextRound() }
                                .disabled(vm.finished)
                        } else {
                            Button("Submit round \(vm.completedRounds + 1)") { vm.submitRound() }
                                .buttonStyle(.borderedProminent)
                        }
                    }

                    if !vm.currentPairings.isEmpty { pairingsCard }
                    standingsCard
                }
            }
            .padding(24)
            .frame(maxWidth: 820, alignment: .leading)
        }
    }

    private var pairingsCard: some View {
        Card(title: "Round \(vm.completedRounds + 1) pairings") {
            VStack(spacing: 8) {
                ForEach(Array(vm.currentPairings.enumerated()), id: \.offset) { idx, p in
                    HStack {
                        Text("Bd \(idx + 1)").frame(width: 44, alignment: .leading).foregroundStyle(Theme.mutedForeground)
                        if p.isBye {
                            Text("\(vm.name(p.white ?? p.black))  —  BYE (+1)").italic()
                            Spacer()
                        } else {
                            Text("\(vm.name(p.white)) (W)").frame(width: 90, alignment: .leading)
                            Text("vs").foregroundStyle(Theme.mutedForeground)
                            Text("\(vm.name(p.black)) (B)").frame(width: 90, alignment: .leading)
                            Spacer()
                            Picker("", selection: Binding(
                                get: { vm.currentResults[idx] },
                                set: { vm.currentResults[idx] = $0 })) {
                                Text("1-0").tag("1-0"); Text("½-½").tag("1/2-1/2"); Text("0-1").tag("0-1")
                            }.pickerStyle(.segmented).frame(width: 170)
                        }
                    }
                    .font(Theme.nunito(15, .regular))
                }
            }
        }
    }

    private var standingsCard: some View {
        Card(title: "Standings") {
            VStack(spacing: 6) {
                HStack {
                    Text("#").frame(width: 24, alignment: .leading)
                    Text("Player").frame(width: 80, alignment: .leading)
                    Text("Score").frame(width: 56, alignment: .trailing)
                    Text("DE").frame(width: 44, alignment: .trailing)
                    Text("Buch").frame(width: 52, alignment: .trailing)
                    Text("SB").frame(width: 44, alignment: .trailing)
                    Text("W-D-L").frame(width: 70, alignment: .trailing)
                }
                .font(Theme.nunito(12, .semiBold)).foregroundStyle(Theme.mutedForeground)
                Divider()
                ForEach(Array(vm.standings().enumerated()), id: \.element.id) { i, p in
                    HStack {
                        Text("\(i + 1)").frame(width: 24, alignment: .leading).foregroundStyle(Theme.mutedForeground)
                        Text(p.name).frame(width: 80, alignment: .leading).fontWeight(.medium)
                        Text(fmt(p.score)).frame(width: 56, alignment: .trailing).monospacedDigit()
                        Text(fmt(p.directEncounter)).frame(width: 44, alignment: .trailing).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                        Text("\(p.buchholz)").frame(width: 52, alignment: .trailing).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                        Text("\(p.sonnebornBerger)").frame(width: 44, alignment: .trailing).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                        Text("\(p.wins)-\(p.draws)-\(p.losses)").frame(width: 70, alignment: .trailing).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                    }
                    .font(Theme.nunito(15, .regular))
                }
            }
        }
    }

    private func fmt(_ d: Double) -> String {
        d == d.rounded() ? String(Int(d)) : String(format: "%.1f", d)
    }
}

extension TournamentPlayer: @retroactive Identifiable {}
