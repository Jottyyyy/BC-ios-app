import SwiftUI
import BiyaherongCoachCore

/// Pre-game "choose your opponent" screen: the coach roster as a ranked challenge ladder.
struct CoachSelect: View {
    @ObservedObject var vm: ChessGameVM
    @State private var selectedId: String
    @State private var asWhite = true

    init(vm: ChessGameVM) {
        self.vm = vm
        _selectedId = State(initialValue: vm.coach?.id ?? "jude")
    }
    private var selected: CoachPersona? { Coaches.all.first { $0.id == selectedId } }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    ForEach(Coaches.all) { c in
                        CoachCard(coach: c, selected: selectedId == c.id) { selectedId = c.id }
                    }
                    twoPlayers
                }
                .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 14)
                .frame(maxWidth: 520).frame(maxWidth: .infinity)
            }
            bottomBar
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Choose your opponent").font(Theme.nunito(26, .bold)).foregroundStyle(Theme.foreground)
            Text("Every coach has a strength rating. Beat stronger ones to climb.")
                .font(Theme.nunito(14, .medium)).foregroundStyle(Theme.mutedForeground)
        }.padding(.bottom, 2)
    }

    private var twoPlayers: some View {
        Button { vm.start(coach: nil, humanColor: .white) } label: {
            HStack(spacing: 12) {
                Image(systemName: "person.2.fill").font(Theme.nunito(18, .semiBold)).foregroundStyle(Theme.violet)
                    .frame(width: 54, height: 54).background(Theme.violetSoft, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pass & play").font(Theme.nunito(16, .bold)).foregroundStyle(Theme.foreground)
                    Text("Two players on one device").font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.mutedForeground)
            }
            .padding(12)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Text("Play as").font(Theme.nunito(14, .medium)).foregroundStyle(Theme.mutedForeground)
                Picker("", selection: $asWhite) { Text("White").tag(true); Text("Black").tag(false) }
                    .pickerStyle(.segmented).frame(width: 170)
                Spacer()
            }
            Button { vm.start(coach: selected, humanColor: asWhite ? .white : .black) } label: {
                Label("Play vs \(selected?.name ?? "")", systemImage: "play.fill")
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(Theme.violetGradient, in: RoundedRectangle(cornerRadius: Theme.radius))
                    .foregroundStyle(Theme.onGold).font(Theme.nunito(16, .bold))
            }.buttonStyle(.plain)
        }
        .padding(16).frame(maxWidth: 520).frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .overlay(Rectangle().fill(Theme.border).frame(height: 1), alignment: .top)
    }
}

struct CoachCard: View {
    let coach: CoachPersona
    let selected: Bool
    let onTap: () -> Void
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                CoachAvatar(name: coach.name, size: 54, level: CoachArt.level(forCoachId: coach.id))
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(coach.name).font(Theme.nunito(16, .bold)).foregroundStyle(Theme.foreground)
                        TitleBadge(coach.title)
                    }
                    Text(coach.blurb).font(Theme.nunito(12, .medium)).foregroundStyle(Theme.mutedForeground)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 5) { Image(systemName: "book.closed").font(Theme.nunito(11, .medium)); Text(coach.favoriteOpening).font(Theme.nunito(11, .medium)) }
                        .foregroundStyle(Theme.mutedForeground)
                    StrengthBar(rating: coach.rating)
                }
                Spacer(minLength: 6)
                VStack(spacing: 0) {
                    Text("\(coach.rating)").font(Theme.nunito(22, .extraBold)).foregroundStyle(Theme.violet)
                    Text("rating").font(Theme.nunito(9, .regular)).foregroundStyle(Theme.mutedForeground)
                }
            }
            .padding(12)
            .background(selected ? AnyShapeStyle(Theme.violetSoft) : AnyShapeStyle(Theme.muted), in: RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(selected ? Theme.violet : Theme.border, lineWidth: selected ? 2 : 1))
        }.buttonStyle(.plain)
    }
}

struct TitleBadge: View {
    let title: String
    init(_ t: String) { title = t }
    var body: some View {
        Text(title.uppercased()).font(Theme.nunito(9, .bold)).tracking(0.5)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Theme.violet.opacity(0.15), in: Capsule())
            .foregroundStyle(Theme.violet)
    }
}

struct StrengthBar: View {
    let rating: Int
    private var frac: Double {
        Double(rating - Coaches.ratingFloor) / Double(Coaches.ratingCeiling - Coaches.ratingFloor)
    }
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.border).frame(height: 6)
                Capsule().fill(Theme.violetGradient).frame(width: geo.size.width * max(0.05, min(1, frac)), height: 6)
            }
        }.frame(height: 6)
    }
}
