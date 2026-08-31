import SwiftUI

// The paywall's PURE layer: palette, geometry, type scale, timings and every string.
//
// Nothing here builds a view — `PaywallMetricsCheck` asserts all of it without a renderer, and
// `tools/qa/replay_premium.js` asserts the same values against the JavaScript twin in
// `web-demo/js/premium.js`. The rule that keeps that possible, the same one the Home and Login
// screens obey: **no numeric literal and no arithmetic in any view body.**
//
// ## Where the design comes from
//
// The layout is the port spec's §3.2, extracted from the RN paywall, plus the trial copy, which
// has no counterpart anywhere: the RN app never offered one. The cap and lock copy is
// `components/UpgradePrompt.tsx:26-50` verbatim, minus its hard-coded `₱99` — every price on this
// screen comes from `Product.displayPrice`, because the original managed to show three different
// prices in one session.
//
// The plan toggle and its badge were omitted while there was only a monthly product. They came
// back with the yearly tier, and every number in `PaywallPlanLayout` / `PaywallPlanType` below was
// re-extracted from `app/(app)/user/premium/index.tsx:1072-1101` rather than taken from the spec
// prose — which is how we caught that the sub-line is **12pt** (`planToggleSub`), not the 11pt of
// `planPriceSub`, a different style on a different card. The spec also describes a `Save {n}%`
// beside the badge that the RN never actually renders; it is kept, computed from the two real
// `Product.price` values, and PORTING_NOTES.md records the disagreement.

// MARK: - Palette

enum PaywallPalette {
    static let screenBg = Theme.background
    static let card = Theme.card
    static let cardBorder = Theme.c(0xFDB022, 0.2)
    static let activeCardBorder = Theme.c(0xFDB022, 0.3)

    // Plan toggle — `planToggleBtn` / `planToggleBtnActive`, RN index.tsx:1073-1082.
    static let planCard = Theme.card
    static let planCardSelected = Theme.c(0x1E3050)
    static let planBorder = Theme.c(0xFDB022, 0.2)
    static let planBorderSelected = Theme.gold
    static let planLabel = Theme.mutedForeground
    static let planLabelSelected = Theme.gold
    static let planPrice = Theme.foreground
    static let planPriceSelected = Theme.gold
    static let planPeriod = Theme.mutedForeground
    static let planPeriodSelected = Theme.foreground
    static let badgeFill = Theme.c(0xFDB022, 0.15)
    static let badgeInk = Theme.gold

    static let title = Theme.gold
    static let body = Theme.mutedForeground
    static let heading = Theme.foreground
    static let check = Theme.gold

    static let cta = Theme.gold
    static let ctaInk = Theme.onGold

    /// The green is the spec's `#4CAF50`, which is not one of `Theme`'s tokens — `Theme.green` is
    /// `#5CC264`. Kept as the spec's value rather than nudged onto a near neighbour.
    static let activePill = Theme.c(0x4CAF50)
    static let activePillInk = Theme.foreground
    static let daysPill = Theme.c(0x4CAF50, 0.15)
    static let daysPillInk = Theme.c(0x4CAF50)

    /// The grace warning. Amber, not red: nothing is broken and nothing is lost — the user just
    /// needs to reconnect at some point.
    static let warnFill = Theme.c(0xFF8A3D, 0.12)
    static let warnBorder = Theme.c(0xFF8A3D, 0.5)
    static let warnInk = Theme.orange

    static let failFill = Theme.c(0xFDB022, 0.08)
    static let failBorder = Theme.c(0xFDB022, 0.5)

    static let restoreBorder = Theme.gold
    static let restoreInk = Theme.gold
    static let legal = Theme.textMuted
    /// Behind the lock card, wherever a gated feature raises one.
    static let scrim = Theme.c(0x000000, 0.55)
}

// MARK: - Geometry

enum PaywallLayout {
    static let screenPaddingH: CGFloat = 20
    static let heroPaddingV: CGFloat = 24
    static let crownSize: CGFloat = 64
    static let cardRadius: CGFloat = 16
    static let cardPadding: CGFloat = 20
    static let cardBorderWidth: CGFloat = 1
    static let cardGap: CGFloat = 14
    static let rowGap: CGFloat = 10
    static let ctaHeight: CGFloat = 56
    static let ctaRadius: CGFloat = 16
    static let restoreHeight: CGFloat = 50
    static let restoreRadius: CGFloat = 14
    static let restoreBorderWidth: CGFloat = 1.5
    static let pillRadiusH: CGFloat = 12
    static let pillRadiusV: CGFloat = 6
    static let pillRadius: CGFloat = 20
    static let failRadius: CGFloat = 14
    static let failPadding: CGFloat = 16
    static let warnRadius: CGFloat = 14
    static let warnPadding: CGFloat = 16
    static let headerHeight: CGFloat = 52
    static let logoSize: CGFloat = 30
    static let pressed: Double = 0.82

    // Plan toggle and the badge — RN `premium/index.tsx:1072-1101`.
    static let planRowGap: CGFloat = 12          // planToggleRow.gap
    static let planRowBottom: CGFloat = 16       // planToggleRow.marginBottom
    static let planCardRadius: CGFloat = 16      // planToggleBtn.borderRadius
    static let planCardPadding: CGFloat = 16     // planToggleBtn.padding
    static let planCardBorderWidth: CGFloat = 2  // planToggleBtn.borderWidth
    static let planLabelBottom: CGFloat = 4      // planToggleLabel.marginBottom
    static let planPeriodTop: CGFloat = 2        // planToggleSub.marginTop
    static let badgeTop: CGFloat = 8             // saveBadge.marginTop
    static let badgePaddingH: CGFloat = 10       // saveBadge.paddingHorizontal
    static let badgePaddingV: CGFloat = 4        // saveBadge.paddingVertical
    static let badgeRadius: CGFloat = 8          // saveBadge.borderRadius

    // The per-tier price lines above the legal paragraph — RN `index.tsx:1155-1166`.
    static let disclosureTitleBottom: CGFloat = 6  // disclosureTitle.marginBottom
    static let disclosureLineBottom: CGFloat = 2   // disclosureLine.marginBottom
    static let disclosureBodyTop: CGFloat = 8      // disclosureBody.marginTop

    // Values the view needs that carry no design meaning; named so no body does arithmetic.
    static let none: CGFloat = 0
    static let hidden: Double = 0
    static let shown: Double = 1
}


// MARK: - Type

enum PaywallType {
    static let headerTitleSize: CGFloat = 20
    static let heroTitleSize: CGFloat = 24
    static let heroBodySize: CGFloat = 14
    static let heroBodyLineHeight: CGFloat = 22
    static let cardTitleSize: CGFloat = 18
    static let rowSize: CGFloat = 14
    static let priceSize: CGFloat = 20
    static let ctaSize: CGFloat = 16
    static let activePillSize: CGFloat = 12
    static let daysPillSize: CGFloat = 13
    static let restoreSize: CGFloat = 14
    // Plan toggle — RN `index.tsx:1083-1101`.
    static let planLabelSize: CGFloat = 13       // planToggleLabel.fontSize
    static let planPriceSize: CGFloat = 28       // planTogglePrice.fontSize
    static let planPeriodSize: CGFloat = 12      // planToggleSub.fontSize — NOT planPriceSub's 11
    static let badgeSize: CGFloat = 10           // saveBadgeText.fontSize
    // The per-tier price lines. The legal paragraph below them already uses legalSize/-LineHeight,
    // which match `disclosureBody`'s 11/16.
    static let disclosureTitleSize: CGFloat = 14 // disclosureTitle.fontSize
    static let disclosureLineSize: CGFloat = 12  // disclosureLine.fontSize
    static let disclosureLineHeight: CGFloat = 18 // disclosureLine.lineHeight

    static let restoreLinkSize: CGFloat = 13
    static let legalSize: CGFloat = 11
    static let legalLineHeight: CGFloat = 16

    /// SwiftUI's `lineSpacing` is extra leading BETWEEN lines, not a CSS-style total — the same
    /// conversion `HomeType.extraLeading` does, restated here so the paywall does no arithmetic.
    static func extraLeading(target: CGFloat, size: CGFloat) -> CGFloat {
        max(0, target - size * HomeType.nunitoLineHeightRatio)
    }
}

enum PaywallTiming {
    static let presentSeconds: Double = 0.28
    static let purchaseSeconds: Double = 0.6
}

// MARK: - Copy

enum PaywallStrings {
    static let goPremium = "Go Premium"
    static let premium = "Premium"
    static let active = "✓ Active"
    static let heroTitle = "Unlock Full Access"
    static let heroBody = "Train without limits. Get the most out of Biyaherong Chess Coach."
    static let planTitle = "Biyaherong Plus"
    static let trialCta = "Start Your 7-Day Free Trial"
    static let subscribeCta = "Subscribe"
    static let trialNote = "7 days free, then {price} per month. Cancel anytime."
    static let priceNote = "{price} per month. Cancel anytime."
    static let trialNoteYearly = "7 days free, then {price} per year. Cancel anytime."
    static let priceNoteYearly = "{price} per year. Cancel anytime."

    // Plan toggle — labels and sub-lines verbatim from RN premium/index.tsx:628, 74-79.
    static let planMonthly = "Monthly"
    static let planYearly = "Yearly"
    static let perMonth = "per month"
    static let perYear = "per year"
    static let bestValue = "BEST VALUE"
    /// Spec §3.2 asks for this beside the badge; the RN never renders it. The number is computed
    /// from the two real `Product.price` values and the row is dropped when it cannot be.
    static let savePercent = "Save {n}%"
    static let loading = "Loading…"
    static let restoreLink = "Restore Purchases"
    static let restoreButton = "Already paid? Restore"
    static let restoreNothing = "We couldn't find a purchase linked to this Apple ID."

    static let failTitle = "Couldn't load subscriptions from the App Store"
    static let failBody = "Make sure you're signed in to the App Store under Settings → Apple ID, then retry."
    static let failRetry = "Retry"

    static let allSetTitle = "You're all set!"
    static let allSetBody = "Every mode is unlocked. Maglaro na!"
    static let yourPlan = "Your Monthly Subscription"
    static let activeUntil = "Active until {date}"
    static let daysRemaining = "{n} days remaining"
    static let oneDayRemaining = "1 day remaining"
    static let renewalRow = "Next Renewal Date"
    static let expiresRow = "Expires On"
    static let autoRenewOn = "Your subscription renews automatically via the App Store."
    static let autoRenewOff = "Auto-renewal is off. Your access ends on the expiry date."
    static let manageRow = "Manage Subscription"
    static let manageBody = "To cancel or change your plan, go to Settings → Apple ID → Subscriptions."
    static let manageButton = "Manage"

    /// Grace. No RN counterpart — the state did not exist when a server answered the question.
    static let graceTitle = "We couldn't check your subscription"
    static let graceBody = """
    Connect to the internet within {n} days to keep Premium. You can keep playing the free tier \
    either way — walang mawawala sa progress mo.
    """

    // The lock card (spec §3.3) and the cap-reached copy (UpgradePrompt.tsx:26-50).
    static let lockTitle = "Premium Feature"
    static let lockCta = "See What You Get"
    static let resetsNote = "🔄 Free limits reset daily at midnight"
    static let thematicLock = """
    Thematic Puzzles are a Premium feature. Upgrade to unlock all themes and train specific \
    tactics anytime!
    """
    static let coachLock = "This opponent is available to Premium members only. Upgrade to unlock all 5 coaches!"
    static let puzzleCap = "You've solved {used}/{limit} free puzzles today. Upgrade to Premium for unlimited puzzles!"
    static let streakCap = """
    You've used your 1 free streak attempt today. Upgrade to Premium for unlimited streak attempts!
    """
    static let rushCap = """
    You've used your 1 free Puzzle Rush attempt for this mode today. Upgrade to Premium for \
    unlimited attempts!
    """
    static let reviewCap = """
    You've used your {limit} free Game Reviews today. Upgrade to Premium for unlimited reviews!
    """
    static let roundsCap = "Free users can create up to {n} rounds. Upgrade to Premium for more."

    /// The per-tier price lines above the legal paragraph, verbatim from RN
    /// `premium/index.tsx:716-720`. App Review wants the price and period of every product on the
    /// screen stated in text, not only inside the plan cards.
    static let disclosureTitle = "Biyaherong Plus"
    static let disclosureMonthly = "Premium Monthly — {price} per month"
    static let disclosureYearly = "Premium Yearly — {price} per year"

    /// Required verbatim by App Review on any auto-renewing subscription.
    static let disclosure = """
    Payment will be charged to your Apple ID account at confirmation of purchase. Subscription \
    automatically renews unless auto-renew is turned off at least 24 hours before the end of the \
    current period. Your account will be charged for renewal within 24 hours prior to the end of \
    the current period at the same price. You can manage your subscriptions and turn off \
    auto-renewal by going to your App Store account settings after purchase.
    """

    /// `{placeholder}` substitution. One implementation, mirrored in the JS, so no call site does
    /// string surgery of its own.
    static func fill(_ template: String, _ values: [String: String]) -> String {
        var out = template
        for (k, v) in values.sorted(by: { $0.key < $1.key }) {
            out = out.replacingOccurrences(of: "{\(k)}", with: v)
        }
        return out
    }

    static func daysPillText(_ n: Int) -> String {
        n == 1 ? oneDayRemaining : fill(daysRemaining, ["n": String(n)])
    }

    /// `Sep 12, 2026` — the same frozen month table `HomeMembership.expiryText` uses, and for the
    /// same three reasons documented there.
    static func dateText(_ ms: Int, calendar: Calendar = .current) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = calendar.timeZone
        let date = Date(timeIntervalSince1970: Double(ms) / 1000.0)
        let c = cal.dateComponents([.year, .month, .day], from: date)
        guard let y = c.year, let m = c.month, let d = c.day, (1...12).contains(m) else { return "" }
        return "\(HomeMembership.monthAbbreviations[m - 1]) \(d), \(y)"
    }
}

// MARK: - Tables

/// One row of "what the money buys".
struct PaywallBenefit: Equatable {
    let emoji: String
    let text: String
}

enum PaywallBenefits {
    static let all: [PaywallBenefit] = [
        PaywallBenefit(emoji: "♟️", text: "Unlimited puzzles — no daily caps"),
        PaywallBenefit(emoji: "🔥", text: "Unlimited Streak and Turbo runs"),
        PaywallBenefit(emoji: "🎯", text: "Every themed puzzle set"),
        PaywallBenefit(emoji: "🔍", text: "Unlimited Game Reviews"),
        PaywallBenefit(emoji: "🤖", text: "All 5 coaches unlocked"),
        PaywallBenefit(emoji: "🏆", text: "Tournaments up to 30 rounds")
    ]
}

/// The **only** two URLs in the app, both required by App Review on an auto-renewing subscription.
///
/// The repo's offline greps ban URLs outright; `tools/qa/replay_premium.js` allowlists exactly
/// these two and fails on a third, so the exception cannot quietly widen. They open in Safari —
/// nothing in the app fetches them.
struct PaywallLink: Equatable {
    let label: String
    let url: String
}

enum PaywallLinks {
    static let all: [PaywallLink] = [
        PaywallLink(label: "Terms of Use (EULA)",
                    url: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"),
        // `/privacy` 404s. It is what the RN shipped and what spec §3.2 wrote down, and both were
        // wrong: the Laravel route is `/privacy-policy` (routes/web.php). App Review clicks this
        // on every auto-renewing-subscription submission, so it was a rejection waiting to happen.
        PaywallLink(label: "Privacy Policy", url: "https://biyaherongchesscoach.com/privacy-policy")
    ]
}
