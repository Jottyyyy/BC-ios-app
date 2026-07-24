import SwiftUI
import BiyaherongCoachCore

struct ReviewView: View {
    // Interactive single-move classifier
    @State private var evalBefore = 20
    @State private var evalAfter = 5
    @State private var color = "w"
    @State private var isBestMove = false
    @State private var san = "Nf3"

    private var cpLoss: Int {
        max(0, color == "w" ? (evalBefore - evalAfter) : (evalAfter - evalBefore))
    }
    private var isBrilliant: Bool {
        GameReview.isBrilliantMove(san: san, color: color, evalBefore: evalBefore, evalAfter: evalAfter)
    }
    private var classification: String {
        GameReview.classifyMove(cpLoss: cpLoss, isBestMove: isBestMove, isBrilliant: isBrilliant)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Game Review").font(Theme.nunito(28, .extraBold))
                Text("The move classifier and accuracy math from `GameReviewController` (centipawns are from White's perspective).")
                    .foregroundStyle(Theme.mutedForeground)

                Card(title: "Classify one move") {
                    VStack(spacing: 14) {
                        SliderRow(label: "Eval before", value: $evalBefore, range: -2000...2000)
                        SliderRow(label: "Eval after", value: $evalAfter, range: -2000...2000)
                        HStack {
                            Text("Mover").frame(width: 110, alignment: .leading)
                            Picker("", selection: $color) { Text("White").tag("w"); Text("Black").tag("b") }
                                .pickerStyle(.segmented).frame(width: 180)
                            Spacer()
                            Toggle("Engine's best move", isOn: $isBestMove).toggleStyle(.switch)
                        }
                        HStack {
                            Text("SAN").frame(width: 110, alignment: .leading)
                            TextField("e.g. Qxf7", text: $san).frame(width: 180)
                            Text("(a capture 'x' with ≥150 gain = Brilliant)").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                            Spacer()
                        }
                    }
                }

                Card(title: "Verdict") {
                    HStack(spacing: 8) {
                        Metric(label: "Centipawn loss", value: "\(cpLoss)")
                        Divider().frame(height: 44)
                        VStack(spacing: 4) {
                            Text(classification.capitalized)
                                .font(Theme.nunito(22, .extraBold))
                                .foregroundStyle(tint(classification))
                            Text("classification").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        }.frame(maxWidth: .infinity)
                        Divider().frame(height: 44)
                        Metric(label: "Win % before", value: String(format: "%.1f", GameReview.evalToWinPct(evalCp: evalBefore, color: color)))
                        Divider().frame(height: 44)
                        Metric(label: "Win % after", value: String(format: "%.1f", GameReview.evalToWinPct(evalCp: evalAfter, color: color)))
                    }
                }

                SampleGameCard()
            }
            .padding(24)
            .frame(maxWidth: 760, alignment: .leading)
        }
    }

    private func tint(_ c: String) -> Color {
        switch c {
        case "brilliant": return Theme.chart2
        case "great", "best": return Theme.positive
        case "excellent", "good": return Theme.chart2
        case "inaccuracy": return Theme.chart4
        case "mistake", "miss": return Theme.warning
        default: return Theme.negative
        }
    }
}

struct SampleGameCard: View {
    // A short synthetic game exercising the full review pipeline.
    private let result: GameReview.Result = {
        let evals: [GameReview.Evaluation] = [
            .init(evalCp: 20, evalMate: nil, bestMoveSan: "e4"),
            .init(evalCp: 20, evalMate: nil, bestMoveSan: "e5"),
            .init(evalCp: 25, evalMate: nil, bestMoveSan: "Nf3"),
            .init(evalCp: 10, evalMate: nil, bestMoveSan: "Nc6"),
            .init(evalCp: -20, evalMate: nil, bestMoveSan: "a6"),
            .init(evalCp: 250, evalMate: nil, bestMoveSan: "d4"),
            .init(evalCp: 500, evalMate: nil, bestMoveSan: "Qxf7"),
            .init(evalCp: 0, evalMate: 3, bestMoveSan: "Rd8"),
        ]
        let moves: [GameReview.Move] = [
            .init(san: nil, color: nil),
            .init(san: "e4", color: "w"),
            .init(san: "e5", color: "b"),
            .init(san: "Nf3", color: "w"),
            .init(san: "Bb5", color: "b"),
            .init(san: "Qd8", color: "w"),
            .init(san: "Qxf7", color: "b"),
            .init(san: "Rd8", color: "w"),
        ]
        return GameReview.review(evaluations: evals, moves: moves)
    }()

    var body: some View {
        Card(title: "Full sample game review") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Metric(label: "White accuracy", value: String(format: "%.1f%%", result.whiteAccuracy), tint: Theme.positive)
                    Divider().frame(height: 40)
                    Metric(label: "Black accuracy", value: String(format: "%.1f%%", result.blackAccuracy), tint: Theme.positive)
                }
                Divider()
                ForEach(result.moveEvaluations, id: \.moveIndex) { m in
                    HStack {
                        Text("Move \(m.moveIndex)").frame(width: 70, alignment: .leading).foregroundStyle(Theme.mutedForeground)
                        Text(m.classification.capitalized).fontWeight(.semibold)
                        Spacer()
                        Text("cp loss \(m.cpLoss)").monospacedDigit().foregroundStyle(Theme.mutedForeground)
                    }
                    .font(Theme.nunito(15, .regular))
                }
            }
        }
    }
}
