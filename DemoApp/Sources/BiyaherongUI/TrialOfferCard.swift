import SwiftUI

/// The trial offer, as a card over whatever the user was already looking at.
///
/// **Why a card and not the paywall.** Until now every locked tap pushed the full "Go Premium"
/// screen, which throws the user off Home to say one sentence. This says the same sentence over
/// the screen they were on, and the button opens the paywall for anyone who wants the plan picker.
/// It also opens itself a few seconds after launch, which the full screen could never politely do.
///
/// **It sells, and it says what it costs.** `offerNote` is not optional here, unlike on
/// `PremiumLockCard` where a caller might have no store in scope. A card whose whole purpose is a
/// button reading "Try for ₱0.00" is exactly the surface Guideline 3.1.2 is about — *"clearly
/// indicate how long the free trial lasts and the price billed once the free trial is over"* — so
/// the sentence that does that is a requirement of constructing one.
///
/// **Two ways out, plus the scrim.** The ✕ and "No, thanks" are both new to this app: the two
/// existing offer overlays (`PuzzleHubScreen.capOverlay`, `CoachScreens.reviewCapOverlay`) are
/// dismissed by tapping the scrim and nothing else, which is fine for a card the user asked for by
/// hitting a cap and not fine for one that appears on its own. The host supplies the scrim, the
/// same split `capOverlay` uses.
struct TrialOfferCard: View {
    /// The button — `PremiumStore.offerCta`. "Try for ₱0.00" once the store has answered.
    let cta: String
    /// What the button starts, in words — `PremiumStore.offerNote`.
    let offerNote: String
    let onTry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: PaywallLayout.rowGap) {
            HStack {
                Spacer()
                Button(action: onDismiss) {
                    Text(PaywallGlyph.close)
                        .font(.system(size: PaywallLayout.offerCloseSize))
                        .foregroundStyle(PaywallPalette.body)
                        .frame(width: PaywallLayout.offerCloseHit,
                               height: PaywallLayout.offerCloseHit,
                               alignment: .center)
                }
                .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
            }
            Text(PaywallGlyph.crown).font(.system(size: PaywallLayout.offerArtSize))
            Text(PaywallStrings.offerTitle)
                .font(Theme.nunito(PaywallType.headerTitleSize, .bold))
                .foregroundStyle(PaywallPalette.title)
                .multilineTextAlignment(.center)
            Text(PaywallStrings.offerBody)
                .font(Theme.nunito(PaywallType.rowSize, .medium))
                .foregroundStyle(PaywallPalette.body)
                .multilineTextAlignment(.center)
                .lineSpacing(PaywallType.extraLeading(target: PaywallType.heroBodyLineHeight,
                                                      size: PaywallType.rowSize))
            Button(action: onTry) {
                Text(cta)
                    .font(Theme.nunito(PaywallType.ctaSize, .bold))
                    .foregroundStyle(PaywallPalette.ctaInk)
                    .padding(.horizontal, PaywallLayout.cardPadding)
                    .frame(maxWidth: .infinity)
                    .frame(height: PaywallLayout.ctaHeight)
                    .background(PaywallPalette.cta,
                                in: RoundedRectangle(cornerRadius: PaywallLayout.ctaRadius))
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
            // Under the button, in the legal size, exactly as the lock card and the paywall's own
            // CTA carry it — one sentence, composed once, so the three cannot disagree.
            Text(offerNote)
                .font(Theme.nunito(PaywallType.legalSize, .medium))
                .foregroundStyle(PaywallPalette.body)
                .multilineTextAlignment(.center)
            Button(action: onDismiss) {
                Text(PaywallStrings.offerDismiss)
                    .font(Theme.nunito(PaywallType.rowSize, .bold))
                    .foregroundStyle(PaywallPalette.body)
                    .frame(maxWidth: .infinity)
                    .frame(height: PaywallLayout.offerDismissHeight)
            }
            .buttonStyle(DimButtonStyle(pressedOpacity: PaywallLayout.pressed))
        }
        .padding(PaywallLayout.cardPadding)
        .frame(maxWidth: PaywallLayout.offerCardMaxWidth)
        .background(PaywallPalette.card,
                    in: RoundedRectangle(cornerRadius: PaywallLayout.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: PaywallLayout.cardRadius)
            .strokeBorder(PaywallPalette.cta, lineWidth: PaywallLayout.restoreBorderWidth))
        .padding(.horizontal, PaywallLayout.screenPaddingH)
    }
}
