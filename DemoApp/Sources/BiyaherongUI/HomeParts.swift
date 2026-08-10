import SwiftUI

// The home screen's small pieces: press feedback, the header trio, the quote strip and the two
// bottom banners. The screen itself is in HomeScreen.swift; all numbers come from HomeMetrics.swift.

// MARK: - Press feedback (§11)

/// Touch feedback only: dim on press, restore instantly. No spring, no bounce, no scale transform.
///
/// A custom `ButtonStyle` (rather than `.opacity` driven by a tap gesture) is what makes the whole
/// tile a single hit target with correct press semantics — a gesture has no pressed state at all,
/// and hand-rolling one with `DragGesture` means re-implementing cancel-on-drag-out, re-arm on
/// drag-back-in, and system touch-cancel. It also keeps the button traits VoiceOver, Full Keyboard
/// Access and Switch Control rely on.
///
/// Note this deliberately does NOT combine with `.buttonStyle(.plain)` used elsewhere in this
/// target: `.plain` applies its own pressed dim, so layering both would double-dim. A custom style
/// replaces it.
struct DimButtonStyle: ButtonStyle {
    var pressedOpacity: Double

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            // Extends the hit area across the tile's transparent padding and gaps, not just where
            // glyphs happen to paint.
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            // `isPressed` changes are not implicitly animated; this only defends against an
            // ancestor `withAnimation` (e.g. a tab switch) leaking a fade into the press.
            .animation(nil, value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == DimButtonStyle {
    static var homeCard: DimButtonStyle { DimButtonStyle(pressedOpacity: HomeLayout.pressedCard) }
    static var homeControl: DimButtonStyle { DimButtonStyle(pressedOpacity: HomeLayout.pressedControl) }
    static var homeBanner: DimButtonStyle { DimButtonStyle(pressedOpacity: HomeLayout.pressedBanner) }
}

// MARK: - Header

/// Avatar — a profile image, or a gold circle carrying the user's initial in navy.
/// When premium, an airplane badge overhangs the bottom-right corner.
/// (The airplane is deliberate brand wordplay: "Biyahero" means traveler.)
struct HomeAvatar: View {
    let userName: String
    let profileImage: Image?
    let isPremium: Bool

    private var initial: String {
        guard let c = userName.trimmingCharacters(in: .whitespacesAndNewlines).first else { return "?" }
        return String(c).uppercased()
    }

    var body: some View {
        face
            .frame(width: HomeLayout.avatarSize, height: HomeLayout.avatarSize)
            .clipShape(Circle())
            // Overlaid AFTER the clip so the badge can overhang the avatar's edge, and as an
            // overlay so it never contributes to layout — matching the original's absolute
            // positioning at bottom:-2 / right:-4.
            .overlay(alignment: .bottomTrailing) {
                if isPremium {
                    Text(HomeMembership.premiumEmoji)
                        .font(.system(size: HomeLayout.premiumBadgeEmojiSize))
                        .frame(width: HomeLayout.premiumBadgeSize, height: HomeLayout.premiumBadgeSize)
                        .background(Theme.background, in: Circle())
                        .offset(x: HomeLayout.premiumBadgeOffsetX, y: HomeLayout.premiumBadgeOffsetY)
                }
            }
            .accessibilityLabel(Text(isPremium ? "Profile, premium member" : "Profile"))
    }

    @ViewBuilder private var face: some View {
        if let profileImage {
            profileImage.resizable().interpolation(.high).aspectRatio(contentMode: .fill)
        } else {
            // Navy-on-gold, matching the CTA pill — not white-on-gold.
            Theme.gold.overlay(
                Text(initial)
                    .font(Theme.nunito(HomeLayout.avatarInitialSize, .extraBold))
                    .foregroundStyle(Theme.onGold)
            )
        }
    }
}

/// App logo — circular, gold-ringed, gold-glowing. Sits at true screen centre because the header
/// gives it all the space between the avatar and the search button.
struct HomeLogo: View {
    let size: CGFloat

    var body: some View {
        HomeAppIcon(size: size, shape: Circle())
            // `strokeBorder`, not `stroke`: stroke centres the line on the path, putting half of it
            // outside the shape. RN/CSS borders are drawn inside the box.
            .overlay(Circle().strokeBorder(Theme.gold, lineWidth: HomeLayout.logoBorderWidth))
            // Applied AFTER the clip, or the glow would be clipped away with the contents.
            // RN-iOS `shadowRadius` maps 1:1 onto SwiftUI's blur radius.
            .shadow(color: Theme.gold.opacity(HomeLayout.logoGlowOpacity), radius: HomeLayout.logoGlowRadius)
    }
}

struct HomeSearchButton: View {
    var body: some View {
        Text("🔍")
            .font(.system(size: HomeLayout.searchEmojiSize))
            .frame(width: HomeLayout.searchSize, height: HomeLayout.searchSize)
            .background(HomePalette.searchFill, in: Circle())
            .accessibilityLabel(Text("Search"))
    }
}

/// `avatar | logo (optically centred) | search` — a fixed band.
struct HomeHeader: View {
    let metrics: HomeScreenMetrics
    let userName: String
    let profileImage: Image?
    let isPremium: Bool
    let onAvatar: () -> Void
    let onSearch: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onAvatar) {
                HomeAvatar(userName: userName, profileImage: profileImage, isPremium: isPremium)
            }
            .buttonStyle(.homeControl)

            // Expands to fill everything between the two 38pt controls and centres the logo inside
            // it, so the logo lands at true screen centre regardless of the side elements.
            HomeLogo(size: metrics.logoSize)
                .frame(maxWidth: .infinity)

            Button(action: onSearch) { HomeSearchButton() }
                .buttonStyle(.homeControl)
        }
        .padding(.horizontal, HomeLayout.headerPaddingH)
        .frame(height: metrics.headerHeight)
    }
}

// MARK: - Quote strip

/// A soft, low-contrast strip between the grid and the banners. Deliberately LEFT-aligned — the
/// asymmetry is the point, against the rigidly centred grid above it. No border.
///
/// Height is pinned by `metrics.quoteHeight` rather than hugging: the quote rotates hourly and the
/// lines differ in length, so a hugging strip would resize the grid — and therefore all six tiles —
/// at the top of an hour.
struct HomeQuoteStrip: View {
    let metrics: HomeScreenMetrics

    var body: some View {
        // Anchoring the schedule at the CURRENT hour start makes this expression idempotent within
        // the hour, so re-evaluating `body` never restarts it — and aligns the tick to the boundary
        // the index actually changes on. The quote is derived from `context.date`, never from a
        // counter, so a late or missed tick can only delay when the change is noticed; it can never
        // desynchronise the text from the true hour.
        TimelineView(.periodic(from: HomeQuotes.hourStart(Date()), by: HomeQuotes.interval)) { context in
            content(HomeQuotes.text(at: context.date))
        }
        .frame(height: metrics.quoteHeight)
    }

    private func content(_ quote: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(quote)
                // Nunito ships no italic face and `.italic()` is a silent no-op on such a family,
                // so this is a real synthetic oblique. See Theme.nunitoItalic.
                .font(Theme.nunitoItalic(HomeLayout.quoteTextSize, .semiBold))
                .tracking(HomeLayout.quoteTracking)
                .lineSpacing(HomeType.extraLeading(target: HomeLayout.quoteLineHeight,
                                                   size: HomeLayout.quoteTextSize, weight: .semiBold))
                .lineLimit(2)
                .minimumScaleFactor(0.9)
                .foregroundStyle(HomePalette.quoteText)

            Text(HomeQuotes.attribution)
                .font(Theme.nunito(HomeLayout.quoteAttribSize, .bold))
                .tracking(HomeLayout.quoteAttribTracking)
                .foregroundStyle(HomePalette.quoteAttrib)
                .padding(.top, HomeLayout.quoteAttribTopMargin)
        }
        // Padding INSIDE the fill frame: padding applied after `.frame(maxHeight: .infinity)` would
        // add to the pinned height instead of insetting within it.
        .padding(.horizontal, HomeLayout.quotePaddingH)
        .padding(.vertical, HomeLayout.quotePaddingV)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(HomePalette.quoteFill,
                    in: RoundedRectangle(cornerRadius: HomeLayout.quoteRadius, style: .continuous))
        // The change should be discovered, not announced: no crossfade, no text morph, and no
        // animation inherited from an unrelated transition in flight when the tick lands.
        .contentTransition(.identity)
        .transaction { $0.animation = nil }
    }
}

// MARK: - Bottom banners

/// One half-width banner: a centred emoji / title / subtitle stack.
///
/// Deliberately smaller and quieter than the cards — these are secondary, always-present utilities,
/// not features competing with the grid.
struct HomeBanner: View {
    let emoji: String
    let title: String
    let titleColor: Color
    let subtitle: String
    let subtitleColor: Color
    let fill: Color
    /// `nil` removes the hairline entirely — leaving it on a saturated fill reads as a dirty edge.
    let border: Color?
    let height: CGFloat

    var body: some View {
        VStack(spacing: HomeLayout.bannerStackSpacing) {
            // Emoji resolve to Apple Color Emoji, whose line box does not follow Nunito's metrics.
            // Pinning the box keeps both banners' internal rhythm identical.
            Text(emoji)
                .font(.system(size: HomeLayout.bannerEmojiSize))
                .frame(height: HomeType.naturalLineHeight(HomeLayout.bannerEmojiSize))
            Text(title)
                .font(Theme.nunito(HomeLayout.bannerTitleSize, .extraBold))
                .tracking(HomeLayout.bannerTitleTracking)
                .foregroundStyle(titleColor)
                .lineLimit(1)
                .minimumScaleFactor(HomeLayout.subtitleMinScale)
            Text(subtitle)
                .font(Theme.nunito(HomeLayout.bannerSubSize, .semiBold))
                .foregroundStyle(subtitleColor)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(HomeLayout.subtitleMinScale)
        }
        .padding(.horizontal, HomeLayout.bannerPaddingH)
        // Both banners take the SAME explicit height. An HStack sizes to its tallest child but does
        // not stretch the shorter one, so without this the one-line "Unlock everything" banner
        // would render visibly shorter than the two-line Donate banner.
        .frame(maxWidth: .infinity).frame(height: height)
        .background(fill, in: RoundedRectangle(cornerRadius: HomeLayout.bannerRadius, style: .continuous))
        .overlay {
            if let border {
                RoundedRectangle(cornerRadius: HomeLayout.bannerRadius, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            }
        }
    }
}

/// The Donate + Membership pair.
struct HomeBannerRow: View {
    let metrics: HomeScreenMetrics
    let isPremium: Bool
    let isColorful: Bool
    let subscriptionEndsAt: Date?
    let onDonate: () -> Void
    let onMembership: () -> Void

    private var subtitleColor: Color {
        isColorful ? HomePalette.colorfulSubtitle : Theme.mutedForeground
    }

    private var style: MembershipBannerStyle {
        MembershipBannerStyle.resolve(isPremium: isPremium, isColorful: isColorful)
    }

    var body: some View {
        HStack(spacing: HomeLayout.bannerGap) {
            Button(action: onDonate) {
                HomeBanner(emoji: HomeDonate.emoji,
                           title: HomeDonate.title,
                           titleColor: Theme.foreground,
                           subtitle: HomeDonate.subtitle,
                           subtitleColor: subtitleColor,
                           fill: isColorful ? HomePalette.sponsor : Theme.card,
                           border: isColorful ? nil : HomePalette.bannerBorder,
                           height: metrics.bannerHeight)
            }
            .buttonStyle(.homeBanner)

            Button(action: onMembership) {
                HomeBanner(emoji: HomeMembership.emoji(isPremium: isPremium),
                           title: HomeMembership.title(isPremium: isPremium),
                           titleColor: isPremium ? Theme.gold : Theme.foreground,
                           subtitle: HomeMembership.subtitle(isPremium: isPremium,
                                                             endsAt: subscriptionEndsAt),
                           subtitleColor: subtitleColor,
                           fill: membershipFill,
                           border: membershipBorder,
                           height: metrics.bannerHeight)
            }
            .buttonStyle(.homeBanner)
        }
        .frame(height: metrics.bannerHeight)
    }

    private var membershipFill: Color {
        switch style {
        case .standard: return Theme.card
        case .colorful: return HomePalette.membership
        case .premiumGold: return HomePalette.premiumBannerFill
        }
    }

    private var membershipBorder: Color? {
        switch style {
        case .standard: return HomePalette.bannerBorder
        case .colorful: return nil
        case .premiumGold: return HomePalette.premiumBannerBorder
        }
    }
}
