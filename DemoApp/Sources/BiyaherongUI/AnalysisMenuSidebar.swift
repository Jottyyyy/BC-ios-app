import SwiftUI

// The ☰ sidebar (renderMenu:4489) — four sections, sliding in from the left.
//
// An `.overlay` like every other modal in this module: there is no `.sheet` anywhere here and
// `.fullScreenCover` does not exist on macOS.
//
// Every number comes from `AnalysisMenu`, which is pinned to `sidebarStyles` in board_styles.json.
// The width in particular is a RATIO of the screen — the extracted value 265.2 is one device's
// answer to `width * 0.68` and would be wrong everywhere else.

struct AnalysisMenuItem: Identifiable {
    let id = UUID()
    let icon: String
    let label: String
    /// nil = no toggle dot. Non-nil renders the dot, lit when true.
    var toggle: Bool?
    let action: () -> Void

    init(_ icon: String, _ label: String, toggle: Bool? = nil, action: @escaping () -> Void) {
        self.icon = icon
        self.label = label
        self.toggle = toggle
        self.action = action
    }
}

struct AnalysisMenuSection: Identifiable {
    let id = UUID()
    let title: String
    let items: [AnalysisMenuItem]
}

struct AnalysisMenuSidebar: View {
    let sections: [AnalysisMenuSection]
    let onClose: () -> Void

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                AnalysisMenu.scrim
                    .contentShape(Rectangle())
                    .onTapGesture { onClose() }

                VStack(spacing: 0) {
                    header
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(sections) { section in
                                Text(section.title.uppercased())
                                    .font(Theme.nunito(AnalysisMenu.sectionSize, .heavy))
                                    .tracking(AnalysisMenu.sectionTracking)
                                    .foregroundStyle(AnalysisMenu.sectionColor)
                                    .padding(.horizontal, AnalysisMenu.headerPaddingH)
                                    .padding(.top, AnalysisMenu.sectionPaddingTop)
                                    .padding(.bottom, AnalysisMenu.sectionPaddingBottom)
                                ForEach(section.items) { item in
                                    row(item)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(width: AnalysisMenu.width(screenWidth: geo.size.width),
                       height: geo.size.height, alignment: .top)
                .background(AnalysisMenu.bg)
                .overlay(alignment: .trailing) {
                    Rectangle()
                        .fill(AnalysisMenu.borderColor)
                        .frame(width: AnalysisMenu.borderWidth)
                }
                .transition(.move(edge: .leading))
            }
        }
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("Analysis")
                .font(Theme.nunito(AnalysisMenu.titleSize, .heavy))
                .tracking(AnalysisMenu.titleTracking)
                .foregroundStyle(AnalysisMenu.titleColor)
            Spacer(minLength: 0)
            Button(action: onClose) {
                Text("✕")
                    .font(Theme.nunito(AnalysisMenu.closeGlyphSize, .bold))
                    .foregroundStyle(AnalysisPalette.textSecondaryAlt)
                    .frame(width: AnalysisMenu.closeSize, height: AnalysisMenu.closeSize)
                    .background(AnalysisMenu.closeBg,
                                in: RoundedRectangle(cornerRadius: AnalysisMenu.closeRadius))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, AnalysisMenu.headerPaddingH)
        .padding(.top, AnalysisMenu.headerPaddingTop)
        .padding(.bottom, AnalysisMenu.headerPaddingBottom)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AnalysisMenu.borderColor)
                .frame(height: AnalysisMenu.borderWidth)
        }
    }

    private func row(_ item: AnalysisMenuItem) -> some View {
        Button {
            onClose()
            item.action()
        } label: {
            HStack(spacing: 0) {
                Text(item.icon)
                    .font(.system(size: AnalysisMenu.iconSize))
                    .frame(width: AnalysisMenu.iconWidth, alignment: .leading)
                Text(item.label)
                    .font(Theme.nunito(AnalysisMenu.labelSize, .medium))
                    .foregroundStyle(AnalysisMenu.labelColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let on = item.toggle {
                    Circle()
                        .fill(on ? AnalysisMenu.dotActive : AnalysisMenu.dotIdle)
                        .frame(width: AnalysisMenu.dotSize, height: AnalysisMenu.dotSize)
                }
            }
            .padding(.vertical, AnalysisMenu.itemPaddingV)
            .padding(.horizontal, AnalysisMenu.itemPaddingH)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
