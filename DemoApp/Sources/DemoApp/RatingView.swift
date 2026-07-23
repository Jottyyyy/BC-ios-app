import SwiftUI
import BiyaherongCoachCore

struct RatingView: View {
    @State private var userRating = 1200
    @State private var puzzleRating = 1200
    @State private var isCorrect = true

    private var outcome: PuzzleRatingEngine.Outcome {
        PuzzleRatingEngine.evaluate(userRating: userRating, puzzleRating: puzzleRating, isCorrect: isCorrect)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Puzzle Rating (ELO)").font(.largeTitle.weight(.bold))
                Text("Solve a rated puzzle and watch your rating move. K = 32, floor 400, no upper cap — exactly `PuzzleController::submitAnswer`.")
                    .foregroundStyle(.secondary)

                Card(title: "Inputs") {
                    VStack(spacing: 14) {
                        SliderRow(label: "Your rating", value: $userRating, range: 400...3000)
                        SliderRow(label: "Puzzle rating", value: $puzzleRating, range: 400...3000)
                        Toggle(isOn: $isCorrect) {
                            Text(isCorrect ? "Solved correctly" : "Failed the puzzle")
                        }
                        .toggleStyle(.switch)
                    }
                }

                Card(title: "Result") {
                    HStack(spacing: 8) {
                        Metric(label: "Expected score", value: String(format: "%.3f", outcome.expectedScore))
                        Divider().frame(height: 44)
                        Metric(label: "Rating change",
                               value: (outcome.ratingChange >= 0 ? "+" : "") + "\(outcome.ratingChange)",
                               tint: outcome.ratingChange >= 0 ? Theme.positive : Theme.negative)
                        Divider().frame(height: 44)
                        Metric(label: "New rating", value: "\(outcome.newRating)")
                        Divider().frame(height: 44)
                        Metric(label: "Tier", value: RatingTier.classify(outcome.newRating), tint: Theme.accent)
                    }
                }

                Card(title: "Try these") {
                    VStack(alignment: .leading, spacing: 8) {
                        presetButton("Equal rating, solved  →  +16", 1200, 1200, true)
                        presetButton("Equal rating, failed  →  −16", 1200, 1200, false)
                        presetButton("Beat a much stronger puzzle", 1200, 2000, true)
                        presetButton("Floor test: 400 vs 3000, failed", 400, 3000, false)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }

    private func presetButton(_ title: String, _ u: Int, _ p: Int, _ ok: Bool) -> some View {
        Button(title) { userRating = u; puzzleRating = p; isCorrect = ok }
            .buttonStyle(.link)
    }
}

struct SliderRow: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    var body: some View {
        HStack {
            Text(label).frame(width: 110, alignment: .leading)
            Slider(value: Binding(get: { Double(value) }, set: { value = Int($0) }),
                   in: Double(range.lowerBound)...Double(range.upperBound), step: 1)
            Stepper(value: $value, in: range, step: 10) {
                Text("\(value)").monospacedDigit().frame(width: 48, alignment: .trailing)
            }
        }
    }
}
