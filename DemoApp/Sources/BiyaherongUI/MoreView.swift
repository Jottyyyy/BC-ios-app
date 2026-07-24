import SwiftUI
import BiyaherongCoachCore

struct MoreView: View {
    @State private var streak = StreakEngine.State()

    @State private var mode = "regular"
    @State private var used = 0
    @State private var premium = false

    @State private var rushSubmitted = 25
    @State private var rushStored = 20
    @State private var rushMode = 3

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Streak · Rush · Limits").font(Theme.nunito(28, .extraBold))

                Card(title: "Puzzle Streak") {
                    let target = StreakEngine.target(currentStreak: streak.currentStreak, puzzleRating: streak.puzzleRating)
                    VStack(spacing: 12) {
                        HStack {
                            Metric(label: "Current streak", value: "\(streak.currentStreak)", tint: Theme.warning)
                            Divider().frame(height: 40)
                            Metric(label: "Best", value: "\(streak.bestStreak)")
                            Divider().frame(height: 40)
                            Metric(label: "Difficulty", value: "\(streak.puzzleRating)")
                            Divider().frame(height: 40)
                            Metric(label: "Next target", value: "\(target.rating)\(target.theme != nil ? " · \(target.theme!)" : "")", tint: Theme.accent)
                        }
                        HStack {
                            Button("Solve ✓") { streak = StreakEngine.increment(streak, nextPuzzleId: nil) }
                                .buttonStyle(.borderedProminent)
                            Button("Fail ✗") { streak = StreakEngine.reset(streak) }
                            Spacer()
                            Text(streak.currentStreak < StreakEngine.warmupCount ? "Warm-up (mate-in-1, rating 600)" : "Ramping +50 per solve, cap 2500")
                                .font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }

                Card(title: "Daily limits (free tier)") {
                    VStack(spacing: 12) {
                        HStack {
                            Text("Mode").frame(width: 70, alignment: .leading)
                            Picker("", selection: $mode) {
                                ForEach(["regular", "streak", "coach", "rush_0", "rush_3", "rush_5"], id: \.self) { Text($0).tag($0) }
                            }.frame(width: 160)
                            Spacer()
                            Toggle("Premium", isOn: $premium).toggleStyle(.switch)
                        }
                        HStack {
                            Text("Used today").frame(width: 90, alignment: .leading)
                            Stepper(value: $used, in: 0...20) { Text("\(used)").monospacedDigit() }
                            Spacer()
                        }
                        HStack {
                            Metric(label: "Cap", value: "\(DailyLimits.maxUses(for: mode))")
                            Divider().frame(height: 40)
                            let blocked = DailyLimits.isAtDailyLimit(mode: mode, usedToday: used, isPremium: premium)
                            VStack(spacing: 4) {
                                Text(blocked ? "BLOCKED" : "ALLOWED")
                                    .font(Theme.nunito(18, .bold))
                                    .foregroundStyle(blocked ? Theme.negative : Theme.positive)
                                Text(premium ? "premium bypasses limits" : "free tier").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                            }.frame(maxWidth: .infinity)
                        }
                    }
                }

                Card(title: "Puzzle Rush best score") {
                    VStack(spacing: 12) {
                        HStack {
                            Text("Mode").frame(width: 70, alignment: .leading)
                            Picker("", selection: $rushMode) { ForEach(PuzzleRush.modes, id: \.self) { Text(PuzzleRush.modeLabel($0)).tag($0) } }.frame(width: 160)
                            Spacer()
                        }
                        HStack {
                            Text("New score").frame(width: 90, alignment: .leading)
                            Stepper(value: $rushSubmitted, in: 0...100) { Text("\(rushSubmitted)").monospacedDigit() }
                            Text("Stored best").foregroundStyle(Theme.mutedForeground)
                            Stepper(value: $rushStored, in: 0...100) { Text("\(rushStored)").monospacedDigit() }
                            Spacer()
                        }
                        HStack {
                            Metric(label: "Resulting best", value: "\(PuzzleRush.bestScore(submitted: rushSubmitted, stored: rushStored))", tint: Theme.positive)
                            Divider().frame(height: 40)
                            Metric(label: "Improved?", value: rushSubmitted > rushStored ? "yes" : "no")
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
        }
    }
}
