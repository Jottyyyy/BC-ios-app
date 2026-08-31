import SwiftUI
import BiyaherongCoachCore
#if canImport(UIKit)
import UIKit
#endif

// The paywall, and the lock card a gated feature shows in place of its content.
//
// Every number comes from `PaywallMetrics.swift`; there is no numeric literal and no arithmetic in
// any view body here, which is what lets `PaywallMetricsCheck` assert the whole screen without a
// renderer. Twin of `BiyaPremium.render` in `web-demo/js/premium.js`.

struct PaywallScreen: View {
    @ObservedObject var store: PremiumStore
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: PaywallLayout.none) {
            header
            ScrollView {
                VStack(spacing: PaywallLayout.cardGap) {
                    if store.graceDaysLeft > 0 { graceCard }
                    if store.isPremium { subscribedBody } else { offerBody }
                }
                .padding(.horizontal, PaywallLayout.screenPaddingH)
                .padding(.vertical, PaywallLayout.heroPaddingV)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PaywallPalette.screenBg.ignoresSafeArea())
        .task { await store.load() }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: PaywallLayout.rowGap) {
            // The only back button in the app that had no fixed frame at all; `NavIconButton`
            // gives it the same 44pt hit area as every other one.
            NavIconButton(.back, size: PaywallType.headerTitleSize,
                          tint: PaywallPalette.heading, action: onClose)
            Text(store.isPremium ? PaywallStrings.premium : PaywallStrings.goPremium)
                .font(Theme.nunito(PaywallType.headerTitleSize, .bold))
                .foregroundStyle(PaywallPalette.heading)
            Spacer()
            if store.isPremium { activePill } else { HomeLogo(size: PaywallLayout.logoSize) }
        }
        .padding(.horizontal, PaywallLayout.screenPaddingH)
        .frame(height: PaywallLayout.headerHeight)
    }

    private var activePill: some View {
        Text(PaywallStrings.active)
            .font(Theme.nunito(PaywallType.activePillSize, .bold))
            .foregroundStyle(PaywallPalette.activePillInk)
            .padding(.horizontal, PaywallLayout.pillRadiusH)
            .padding(.vertical, PaywallLayout.pillRadiusV)
            .background(PaywallPalette.activePill, in: Capsule())
    }

    // MARK: Not subscribed

    private var offerBody: some View {
        VStack(spacing: PaywallLayout.cardGap) {
            hero
            benefitsCard
            if store.loadState == .failed {
                failureCard
            } else {
                planPicker
                cta
            }
            disclosureCard
            restore
        }
    }

    private var hero: some View {
        VStack(spacing: PaywallLayout.rowGap) {
            Text(PaywallGlyph.crown).font(.system(size: PaywallLayout.crownSize))
            Text(PaywallStrings.heroTitle)
                .font(Theme.nunito(PaywallType.heroTitleSize, .bold))
                .foregroundStyle(PaywallPalette.title)
            Text(PaywallStrings.heroBody)
                .font(Theme.nunito(PaywallType.heroBodySize, .medium))
                .foregroundStyle(PaywallPalette.body)
                .multilineTextAlignment(.center)
                .lineSpacing(PaywallType.extraLeading(target: PaywallType.heroBodyLineHeight,
                                                      size: PaywallType.heroBodySize))
        }
        .padding(.vertical, PaywallLayout.heroPaddingV)
    }

    private var benefitsCard: some View {
        card(border: PaywallPalette.cardBorder) {
            VStack(alignment: .leading, spacing: PaywallLayout.rowGap) {
                Text(PaywallStrings.planTitle)
                    .font(Theme.nunito(PaywallType.cardTitleSize, .bold))
                    .foregroundStyle(PaywallPalette.heading)
                ForEach(PaywallBenefits.all, id: \.text) { benefit in
                    HStack(spacing: PaywallLayout.rowGap) {
                        Text(PaywallGlyph.check)
                            .font(Theme.nunito(PaywallType.rowSize, .bold))
                            .foregroundStyle(PaywallPalette.check)
                        Text("\(benefit.emoji) \(benefit.text)")
                            .font(Theme.nunito(PaywallType.rowSize, .medium))
                            .foregroundStyle(PaywallPalette.heading)
                        Spacer(minLength: PaywallLayout.none)
                    }
                }
            }
        }
    }

    // MARK: Plan toggle

    /// Monthly / Yearly, extracted from RN `premium/index.tsx:609-651`. Selecting a card only
    /// moves `store.selectedPlan`; nothing is purchased until the CTA below is tapped.
    private var planPicker: some View {
        HStack(spacing: PaywallLayout.planRowGap) {
            ForEach(PremiumStore.Plan.allCases) { plan in
                planCard(plan)
            }
        }
        .padding(.bottom, PaywallLayout.planRowBottom)
    }

    private func planCard(_ plan: PremiumStore.Plan) -> some View {
        let selected = store.selectedPlan == plan
        return Button { store.selectedPlan = plan } label: {
            VStack(spacing: PaywallLayout.none) {
                Text(planLabel(plan))
                    .font(Theme.nunito(PaywallType.planLabelSize, .semiBold))
                    .foregroundStyle(selected ? PaywallPalette.planLabelSelected
                                              : PaywallPalette.planLabel)
                    .padding(.bottom, PaywallLayout.planLabelBottom)
                Text(store.displayPrice(for: plan) ?? PaywallStrings.loading)
                    .font(Theme.nunito(PaywallType.planPriceSize, .bold))
                    .foregroundStyle(selected ? PaywallPalette.planPriceSelected
                                              : PaywallPalette.planPrice)
                Text(planPeriod(plan))
                    .font(Theme.nunito(PaywallType.planPeriodSize, .regular))
                    .foregroundStyle(selected ? PaywallPalette.planPeriodSelected
                                              : PaywallPalette.planPeriod)
                    .padding(.top, PaywallLayout.planPeriodTop)
                if plan == .yearly { yearlyBadge }
            }
            .frame(maxWidth: .infinity)
            .padding(PaywallLayout.planCardPadding)
            .background(selected ? PaywallPalette.planCardSelected : PaywallPalette.planCard,
                        in: RoundedRectangle(cornerRadius: PaywallLayout.planCardRadius))
            .overlay(
                RoundedRectangle(cornerRadius: PaywallLayout.planCardRadius)
                    .strokeBorder(selected ? PaywallPalette.planBorderSelected
                                           : PaywallPalette.planBorder,
                                  lineWidth: PaywallLayout.planCardBorderWidth))
        }
        .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
    }

    /// `BEST VALUE`, and beneath it the saving — but only when both tiers resolved and the
    /// arithmetic says something true. A percentage that cannot be computed is simply absent.
    private var yearlyBadge: some View {
        VStack(spacing: PaywallLayout.none) {
            Text(PaywallStrings.bestValue)
                .font(Theme.nunito(PaywallType.badgeSize, .bold))
                .foregroundStyle(PaywallPalette.badgeInk)
            if let percent = store.yearlySavingsPercent {
                Text(PaywallStrings.fill(PaywallStrings.savePercent, ["n": String(percent)]))
                    .font(Theme.nunito(PaywallType.badgeSize, .bold))
                    .foregroundStyle(PaywallPalette.badgeInk)
            }
        }
        .padding(.horizontal, PaywallLayout.badgePaddingH)
        .padding(.vertical, PaywallLayout.badgePaddingV)
        .background(PaywallPalette.badgeFill,
                    in: RoundedRectangle(cornerRadius: PaywallLayout.badgeRadius))
        .padding(.top, PaywallLayout.badgeTop)
    }

    private func planLabel(_ plan: PremiumStore.Plan) -> String {
        plan == .monthly ? PaywallStrings.planMonthly : PaywallStrings.planYearly
    }

    private func planPeriod(_ plan: PremiumStore.Plan) -> String {
        plan == .monthly ? PaywallStrings.perMonth : PaywallStrings.perYear
    }

    private var cta: some View {
        VStack(spacing: PaywallLayout.rowGap) {
            Button { Task { await store.purchase() } } label: {
                Text(ctaLabel)
                    .font(Theme.nunito(PaywallType.ctaSize, .bold))
                    .foregroundStyle(PaywallPalette.ctaInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: PaywallLayout.ctaHeight)
                    .background(PaywallPalette.cta,
                                in: RoundedRectangle(cornerRadius: PaywallLayout.ctaRadius))
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
            .disabled(store.purchasing || store.product == nil)
            Text(priceNote)
                .font(Theme.nunito(PaywallType.restoreLinkSize, .medium))
                .foregroundStyle(PaywallPalette.body)
                .multilineTextAlignment(.center)
        }
    }

    /// The trial is only promised when StoreKit says this Apple Account can actually have it.
    private var ctaLabel: String {
        if store.purchasing { return PaywallStrings.loading }
        if store.product == nil { return PaywallStrings.loading }
        return store.trialEligible ? PaywallStrings.trialCta : PaywallStrings.subscribeCta
    }

    private var priceNote: String {
        let price = store.displayPrice ?? ""
        let yearly = store.selectedPlan == .yearly
        let template: String
        if store.trialEligible {
            template = yearly ? PaywallStrings.trialNoteYearly : PaywallStrings.trialNote
        } else {
            template = yearly ? PaywallStrings.priceNoteYearly : PaywallStrings.priceNote
        }
        return PaywallStrings.fill(template, ["price": price])
    }

    private var failureCard: some View {
        card(fill: PaywallPalette.failFill, border: PaywallPalette.failBorder,
             radius: PaywallLayout.failRadius, padding: PaywallLayout.failPadding) {
            VStack(alignment: .leading, spacing: PaywallLayout.rowGap) {
                Text(PaywallStrings.failTitle)
                    .font(Theme.nunito(PaywallType.rowSize, .bold))
                    .foregroundStyle(PaywallPalette.title)
                Text(PaywallStrings.failBody)
                    .font(Theme.nunito(PaywallType.restoreLinkSize, .medium))
                    .foregroundStyle(PaywallPalette.body)
                Button { Task { await store.load() } } label: {
                    Text(PaywallStrings.failRetry)
                        .font(Theme.nunito(PaywallType.restoreSize, .bold))
                        .foregroundStyle(PaywallPalette.title)
                }
                .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
            }
        }
    }

    /// Required by App Review on any auto-renewing subscription, and the only place in the app
    /// with a URL. See `PaywallLinks`.
    private var disclosureCard: some View {
        VStack(alignment: .leading, spacing: PaywallLayout.rowGap) {
            // Every product on the screen, priced and with its period spelled out. App Review
            // wants this in text, not only inside the plan cards; a tier whose price did not
            // resolve is omitted rather than shown with an empty price.
            Text(PaywallStrings.disclosureTitle)
                .font(Theme.nunito(PaywallType.disclosureTitleSize, .bold))
                .foregroundStyle(PaywallPalette.title)
                .padding(.bottom, PaywallLayout.disclosureTitleBottom)
            ForEach(PremiumStore.Plan.allCases) { plan in
                if let price = store.displayPrice(for: plan) {
                    Text(PaywallStrings.fill(disclosureTemplate(plan), ["price": price]))
                        .font(Theme.nunito(PaywallType.disclosureLineSize, .regular))
                        .foregroundStyle(PaywallPalette.heading)
                        .lineSpacing(PaywallType.extraLeading(
                            target: PaywallType.disclosureLineHeight,
                            size: PaywallType.disclosureLineSize))
                        .padding(.bottom, PaywallLayout.disclosureLineBottom)
                }
            }
            Text(PaywallStrings.disclosure)
                .font(Theme.nunito(PaywallType.legalSize, .regular))
                .foregroundStyle(PaywallPalette.legal)
                .lineSpacing(PaywallType.extraLeading(target: PaywallType.legalLineHeight,
                                                      size: PaywallType.legalSize))
                .padding(.top, PaywallLayout.disclosureBodyTop)
            HStack(spacing: PaywallLayout.rowGap) {
                ForEach(PaywallLinks.all, id: \.url) { link in
                    if let url = URL(string: link.url) {
                        Link(link.label, destination: url)
                            .font(Theme.nunito(PaywallType.legalSize, .semiBold))
                            .foregroundStyle(PaywallPalette.body)
                    }
                }
                Spacer(minLength: PaywallLayout.none)
            }
        }
    }

    private func disclosureTemplate(_ plan: PremiumStore.Plan) -> String {
        plan == .monthly ? PaywallStrings.disclosureMonthly : PaywallStrings.disclosureYearly
    }

    private var restore: some View {
        VStack(spacing: PaywallLayout.rowGap) {
            Button { Task { await store.restore() } } label: {
                Text(PaywallStrings.restoreButton)
                    .font(Theme.nunito(PaywallType.restoreSize, .semiBold))
                    .foregroundStyle(PaywallPalette.restoreInk)
                    .frame(maxWidth: .infinity)
                    .frame(height: PaywallLayout.restoreHeight)
                    .overlay(RoundedRectangle(cornerRadius: PaywallLayout.restoreRadius)
                        .strokeBorder(PaywallPalette.restoreBorder,
                                      lineWidth: PaywallLayout.restoreBorderWidth))
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
            if store.lastRestoreFoundNothing {
                Text(PaywallStrings.restoreNothing)
                    .font(Theme.nunito(PaywallType.restoreLinkSize, .medium))
                    .foregroundStyle(PaywallPalette.body)
                    .multilineTextAlignment(.center)
            }
        }
    }

    // MARK: Subscribed

    private var subscribedBody: some View {
        VStack(spacing: PaywallLayout.cardGap) {
            VStack(spacing: PaywallLayout.rowGap) {
                Text(PaywallGlyph.crown).font(.system(size: PaywallLayout.crownSize))
                Text(PaywallStrings.allSetTitle)
                    .font(Theme.nunito(PaywallType.heroTitleSize, .bold))
                    .foregroundStyle(PaywallPalette.title)
                Text(PaywallStrings.allSetBody)
                    .font(Theme.nunito(PaywallType.heroBodySize, .medium))
                    .foregroundStyle(PaywallPalette.body)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, PaywallLayout.heroPaddingV)
            planCard
            restore
        }
    }

    private var planCard: some View {
        card(border: PaywallPalette.activeCardBorder) {
            VStack(alignment: .leading, spacing: PaywallLayout.rowGap) {
                Text(PaywallStrings.yourPlan)
                    .font(Theme.nunito(PaywallType.cardTitleSize, .bold))
                    .foregroundStyle(PaywallPalette.title)
                if let expiry = store.expiresAt {
                    Text(PaywallStrings.fill(PaywallStrings.activeUntil,
                                             ["date": PaywallStrings.dateText(msOf(expiry))]))
                        .font(Theme.nunito(PaywallType.priceSize, .extraBold))
                        .foregroundStyle(PaywallPalette.title)
                        .frame(maxWidth: .infinity)
                    // Suppressed at zero. In GRACE the subscription has already lapsed, so this
                    // would read "0 days remaining" directly under a "✓ Active" pill — the amber
                    // warning above already says what is actually going on.
                    if daysLeft(expiry) > 0 {
                        Text(PaywallStrings.daysPillText(daysLeft(expiry)))
                            .font(Theme.nunito(PaywallType.daysPillSize, .bold))
                            .foregroundStyle(PaywallPalette.daysPillInk)
                            .padding(.horizontal, PaywallLayout.pillRadiusH)
                            .padding(.vertical, PaywallLayout.pillRadiusV)
                            .background(PaywallPalette.daysPill, in: Capsule())
                            .frame(maxWidth: .infinity)
                    }
                    row(PaywallGlyph.calendar,
                        store.willAutoRenew ? PaywallStrings.renewalRow : PaywallStrings.expiresRow)
                }
                row(PaywallGlyph.renew,
                    store.willAutoRenew ? PaywallStrings.autoRenewOn : PaywallStrings.autoRenewOff)
                row(PaywallGlyph.gear, PaywallStrings.manageBody)
                #if os(iOS)
                Button { Task { await manage() } } label: {
                    Text(PaywallStrings.manageButton)
                        .font(Theme.nunito(PaywallType.restoreSize, .bold))
                        .foregroundStyle(PaywallPalette.title)
                }
                .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
                #endif
            }
        }
    }

    /// The grace state. Amber, not red: nothing is lost, and the free tier is still there.
    private var graceCard: some View {
        card(fill: PaywallPalette.warnFill, border: PaywallPalette.warnBorder,
             radius: PaywallLayout.warnRadius, padding: PaywallLayout.warnPadding) {
            VStack(alignment: .leading, spacing: PaywallLayout.rowGap) {
                Text(PaywallStrings.graceTitle)
                    .font(Theme.nunito(PaywallType.rowSize, .bold))
                    .foregroundStyle(PaywallPalette.warnInk)
                Text(PaywallStrings.fill(PaywallStrings.graceBody,
                                         ["n": String(store.graceDaysLeft)]))
                    .font(Theme.nunito(PaywallType.restoreLinkSize, .medium))
                    .foregroundStyle(PaywallPalette.body)
            }
        }
    }

    // MARK: Pieces

    private func row(_ glyph: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: PaywallLayout.rowGap) {
            Text(glyph).font(Theme.nunito(PaywallType.rowSize, .regular))
            Text(text)
                .font(Theme.nunito(PaywallType.restoreLinkSize, .medium))
                .foregroundStyle(PaywallPalette.body)
            Spacer(minLength: PaywallLayout.none)
        }
    }

    private func card<Content: View>(fill: Color = PaywallPalette.card,
                                     border: Color,
                                     radius: CGFloat = PaywallLayout.cardRadius,
                                     padding: CGFloat = PaywallLayout.cardPadding,
                                     @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius)
                .strokeBorder(border, lineWidth: PaywallLayout.cardBorderWidth))
    }

    private func msOf(_ date: Date) -> Int { Int(date.timeIntervalSince1970 * 1000) }

    private func daysLeft(_ expiry: Date) -> Int {
        Entitlement.daysRemaining(untilMs: msOf(expiry), nowMs: msOf(Date()))
    }

    #if os(iOS)
    private func manage() async {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard let scene else { return }
        await store.manage(in: scene)
    }
    #endif
}

/// The emoji the paywall and the lock card draw. Named so no view body carries a bare literal.
enum PaywallGlyph {
    static let crown = "👑"
    static let check = "✓"
    static let calendar = "📅"
    static let renew = "🔄"
    static let gear = "⚙️"
    static let lock = "🔒"
}

/// What a gated feature shows **in its own shell** — never a modal over an empty screen (spec §3.3).
struct PremiumLockCard: View {
    let body_: String
    let onSeePlans: () -> Void
    /// Daily caps reset; a hard feature gate does not. Only the former gets the reset note.
    var showsResetNote = false

    var body: some View {
        VStack(spacing: PaywallLayout.rowGap) {
            Text(PaywallGlyph.crown).font(.system(size: PaywallLayout.crownSize))
            Text(PaywallStrings.lockTitle)
                .font(Theme.nunito(PaywallType.headerTitleSize, .bold))
                .foregroundStyle(PaywallPalette.title)
            Text(body_)
                .font(Theme.nunito(PaywallType.rowSize, .medium))
                .foregroundStyle(PaywallPalette.body)
                .multilineTextAlignment(.center)
                .lineSpacing(PaywallType.extraLeading(target: PaywallType.heroBodyLineHeight,
                                                      size: PaywallType.rowSize))
            if showsResetNote {
                Text(PaywallStrings.resetsNote)
                    .font(Theme.nunito(PaywallType.legalSize, .medium))
                    .foregroundStyle(PaywallPalette.body)
            }
            Button(action: onSeePlans) {
                Text(PaywallStrings.lockCta)
                    .font(Theme.nunito(PaywallType.ctaSize, .bold))
                    .foregroundStyle(PaywallPalette.ctaInk)
                    .padding(.horizontal, PaywallLayout.cardPadding)
                    .frame(height: PaywallLayout.ctaHeight)
                    .background(PaywallPalette.cta,
                                in: RoundedRectangle(cornerRadius: PaywallLayout.ctaRadius))
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
        }
        .padding(PaywallLayout.cardPadding)
        .frame(maxWidth: .infinity)
        .background(PaywallPalette.card,
                    in: RoundedRectangle(cornerRadius: PaywallLayout.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: PaywallLayout.cardRadius)
            .strokeBorder(PaywallPalette.cta, lineWidth: PaywallLayout.restoreBorderWidth))
        .padding(.horizontal, PaywallLayout.screenPaddingH)
    }
}
