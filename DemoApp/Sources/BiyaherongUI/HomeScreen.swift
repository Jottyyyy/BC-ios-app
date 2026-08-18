import SwiftUI

// The home screen — a dark-navy, never-scrolling, single-viewport dashboard.
//
// Presentation only: no networking, no persistence, no navigation. Every dynamic value is an input
// and every tap is a closure the caller supplies (§12).
//
// Four bands, stacked. The header, quote strip and banner row are FIXED heights computed in
// HomeMetrics; the card grid is the only flexible band and takes exactly the leftover, which it
// then splits into three equal rows of two equal tiles.
//
// Ported from ../BYAHERONG-COACH-FRONTEND/app/(app)/user/home.tsx.

public struct HomeScreen: View {
    // §12 inputs
    var userName: String
    var profileImage: Image?
    var isPremium: Bool
    var subscriptionEndsAt: Date?
    var isColorful: Bool

    /// The size the responsive `scale` is derived from. Defaults to the view's own container.
    ///
    /// The host passes the whole phone shell here so the scalar matches the original's
    /// `Dimensions.get('window')`. Deriving it from this view's own box instead would make every
    /// icon and font ~19% smaller than the design, because this box is already inset by the safe
    /// areas and the tab bar. The *layout* still uses the real container — only the scalar differs.
    var scaleBasis: CGSize?

    var onAvatar: () -> Void
    var onPuzzles: () -> Void
    var onAnalysis: () -> Void
    var onVideos: () -> Void
    var onOpeningTrainer: () -> Void
    var onPlayCoach: () -> Void
    var onPairing: () -> Void
    var onMembership: () -> Void

    public init(userName: String = "",
                profileImage: Image? = nil,
                isPremium: Bool = false,
                subscriptionEndsAt: Date? = nil,
                isColorful: Bool = false,
                scaleBasis: CGSize? = nil,
                onAvatar: @escaping () -> Void = {},
                onPuzzles: @escaping () -> Void = {},
                onAnalysis: @escaping () -> Void = {},
                onVideos: @escaping () -> Void = {},
                onOpeningTrainer: @escaping () -> Void = {},
                onPlayCoach: @escaping () -> Void = {},
                onPairing: @escaping () -> Void = {},
                onMembership: @escaping () -> Void = {}) {
        self.userName = userName
        self.profileImage = profileImage
        self.isPremium = isPremium
        self.subscriptionEndsAt = subscriptionEndsAt
        self.isColorful = isColorful
        self.scaleBasis = scaleBasis
        self.onAvatar = onAvatar
        self.onPuzzles = onPuzzles
        self.onAnalysis = onAnalysis
        self.onVideos = onVideos
        self.onOpeningTrainer = onOpeningTrainer
        self.onPlayCoach = onPlayCoach
        self.onPairing = onPairing
        self.onMembership = onMembership
    }

    public var body: some View {
        GeometryReader { geo in
            let metrics = HomeScreenMetrics(basis: scaleBasis ?? geo.size)
            let tile = metrics.tile(inGridContent: metrics.gridContent(container: geo.size))

            VStack(spacing: 0) {
                HomeHeader(metrics: metrics,
                           userName: userName,
                           profileImage: profileImage,
                           isPremium: isPremium,
                           onAvatar: onAvatar)

                grid(metrics: metrics, tile: tile)
                    .frame(height: metrics.gridHeight(container: geo.size))

                HomeQuoteStrip(metrics: metrics)
                    .padding(.horizontal, HomeLayout.screenPaddingH)
                    .padding(.bottom, HomeLayout.quoteMarginBottom)

                HomeBannerRow(metrics: metrics,
                              isPremium: isPremium,
                              isColorful: isColorful,
                              subscriptionEndsAt: subscriptionEndsAt,
                              onMembership: onMembership)
                    .padding(.horizontal, HomeLayout.screenPaddingH)
                    .padding(.bottom, HomeLayout.bannerMarginBottom)
            }
            // GeometryReader places its children top-leading and proposes nothing, so the stack has
            // to be told to fill the box.
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .background(Theme.background)
        .onAppear { HomeArt.preload() }
    }

    /// Three rows of two, every tile built from ONE `HomeTileSize` — which is what makes "all six
    /// cards are pixel-identical" true by construction rather than by inspection.
    ///
    /// The tiles carry an explicit `.frame(width:height:)` rather than `.frame(maxHeight: .infinity)`.
    /// That distinction is load-bearing: a flexible frame lets a child return MORE than the height
    /// proposed to it, so one card whose intrinsic content exceeds its third would overflow the
    /// stack and quietly steal height from the other two rows. An explicit frame is authoritative.
    private func grid(metrics: HomeScreenMetrics, tile: HomeTileSize) -> some View {
        VStack(spacing: metrics.cardGap) {
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: metrics.cardGap) {
                    ForEach(0..<2, id: \.self) { column in
                        HomeCardView(card: HomeCard.grid[row * 2 + column],
                                     metrics: metrics,
                                     tile: tile,
                                     isColorful: isColorful,
                                     action: action(for: HomeCard.grid[row * 2 + column]))
                    }
                }
                .frame(height: tile.height)
            }
        }
        .padding(.horizontal, HomeLayout.screenPaddingH)
        .padding(.top, HomeLayout.gridPaddingTop)
        .padding(.bottom, HomeLayout.gridPaddingBottom)
    }

    private func action(for card: HomeCard) -> () -> Void {
        switch card {
        case .puzzles: return onPuzzles
        case .analysis: return onAnalysis
        case .videos: return onVideos
        case .openingTrainer: return onOpeningTrainer
        case .playCoach: return onPlayCoach
        case .pairing: return onPairing
        }
    }
}

// MARK: - One tile

struct HomeCardView: View {
    let card: HomeCard
    let metrics: HomeScreenMetrics
    let tile: HomeTileSize
    let isColorful: Bool
    let action: () -> Void

    /// The icon slot's edge length, already clamped to the room this row actually has.
    private var iconBox: CGFloat { metrics.iconBox(rowHeight: tile.height, card: card) }

    /// The card's internal spacing — `cardGap`, capped on a tile too short for the full design.
    private var innerGap: CGFloat { metrics.innerGap(rowHeight: tile.height) }

    var body: some View {
        Button(action: action) {
            stack
                .padding(metrics.cardPadding)
                .frame(width: tile.width, height: tile.height)
                .background(card.fill(isColorful: isColorful))
                // Order is not stylistic: clip first so the fill takes the rounded silhouette, then
                // the border overlay (unclipped, drawn inside), then the shadow — which is cast by
                // the clipped silhouette. `.shadow(…).clipShape(…)` would erase the shadow entirely.
                .clipShape(RoundedRectangle(cornerRadius: HomeLayout.cardRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: HomeLayout.cardRadius)
                        // Toggled with `.clear` rather than `lineWidth: 0` so the geometry is
                        // literally identical between themes. As an overlay it never affects
                        // layout, so dropping the border in Colorful mode cannot shift content.
                        .strokeBorder(isColorful ? Color.clear : Theme.border,
                                      lineWidth: HomeLayout.cardBorderWidth)
                )
                .shadow(color: .black.opacity(HomeLayout.cardShadowOpacity),
                        radius: HomeLayout.cardShadowRadius, y: HomeLayout.cardShadowY)
        }
        .buttonStyle(.homeCard)
        .accessibilityLabel(Text(card.title.replacingOccurrences(of: "\n", with: " ")))
    }

    @ViewBuilder private var stack: some View {
        if card == .playCoach {
            VStack(spacing: innerGap) {
                coachRing
                title
                ctaPill
            }
        } else {
            VStack(spacing: innerGap) {
                iconSlot
                title
                if let subtitle = card.subtitle {
                    Text(subtitle)
                        .font(Theme.nunito(metrics.cardSubSize, .semiBold))
                        .tracking(HomeLayout.cardSubTracking)
                        .lineSpacing(HomeType.extraLeading(
                            target: metrics.cardSubSize * HomeLayout.cardSubLineHeightRatio,
                            size: metrics.cardSubSize, weight: .semiBold))
                        .foregroundStyle(isColorful ? HomePalette.colorfulSubtitle : Theme.mutedForeground)
                        .multilineTextAlignment(.center)
                        // Vertical room is budgeted exactly, so text only ever gives way sideways.
                        .lineLimit(1)
                        .minimumScaleFactor(HomeLayout.subtitleMinScale)
                        .padding(.top, HomeLayout.subtitleTopMargin)
                }
            }
        }
    }

    private var title: some View {
        Text(card.title)
            .font(Theme.nunito(metrics.cardTitleSize, .extraBold))
            .tracking(HomeLayout.cardTitleTracking)
            .foregroundStyle(Theme.foreground)
            .multilineTextAlignment(.center)
            .lineLimit(card.titleLines)
            .minimumScaleFactor(HomeLayout.titleMinScale)
    }

    /// The icon, in a slot whose size is IDENTICAL in both themes.
    ///
    /// This is what acceptance criterion #4 rests on. Sky draws a circular backdrop behind an icon
    /// inset to 67%; Colorful drops the backdrop and draws the icon bare at 100% — a genuinely
    /// larger footprint. Because both are centred in a `ZStack` that is explicitly framed to the
    /// slot, neither can influence the slot's size, so every element below keeps its exact `y`.
    private var iconSlot: some View {
        ZStack {
            if !isColorful {
                Circle()
                    .fill(card.skyIconBackdrop)
                    .frame(width: iconBox * metrics.circleRatio, height: iconBox * metrics.circleRatio)
            }
            HomeCardIcon(card: card,
                         size: iconBox * (isColorful ? 1 : HomeScreenMetrics.innerIconRatio))
        }
        .frame(width: iconBox, height: iconBox)
    }

    /// §8 — the hero card's glowing squircle. The only non-circular icon frame on the screen, and
    /// with the CTA pill the reason this tile reads as the primary action.
    ///
    /// It sits in the same `iconBox` slot as the other five so its title baseline lines up with
    /// theirs. The glow IS clipped by the card's rounded rect — that reproduces the original, where
    /// `overflow: 'hidden'` sets `masksToBounds` and clips child shadows the same way.
    private var coachRing: some View {
        let ring = iconBox * metrics.circleRatio
        let shape = RoundedRectangle(cornerRadius: metrics.coachRingRadius, style: .continuous)
        // `.brandLogo`, not the defaulted `.appIcon`. The gold knight is the APP icon — it stays
        // on the iOS home screen and in `ios/AppIcon.svg` — and this was the last place inside the
        // app that still drew it.
        return HomeAppIcon(size: ring, shape: shape, asset: .brandLogo)
            .overlay(shape.strokeBorder(Theme.gold, lineWidth: HomeLayout.coachRingBorderWidth))
            .shadow(color: Theme.gold.opacity(HomeLayout.coachGlowOpacity),
                    radius: HomeLayout.coachGlowRadius)
            .frame(width: iconBox, height: iconBox)
    }

    /// Navy text on gold, matching the avatar treatment. The screen's only CTA.
    private var ctaPill: some View {
        Text("PLAY NOW →")
            .font(Theme.nunito(metrics.ctaTextSize, .extraBold))
            .tracking(HomeLayout.ctaTracking)
            .foregroundStyle(Theme.onGold)
            .lineLimit(1)
            .padding(.horizontal, metrics.ctaPaddingH)
            .padding(.vertical, metrics.ctaPaddingV)
            .background(Theme.gold,
                        in: RoundedRectangle(cornerRadius: HomeLayout.ctaRadius, style: .continuous))
    }
}
