import Foundation
import StoreKit
import BiyaherongCoachCore
#if canImport(UIKit)
import UIKit
#endif

/// The subscription, and the free tier's daily counters.
///
/// **This is the only file in the app that imports StoreKit.** Every rule it applies —  trial,
/// expiry, grace, the clock floor, every cap — lives in `Entitlement` in the Core, which is
/// Foundation-only and fully asserted without a device. This file's whole job is to turn what
/// Apple says into an `Entitlement.Snapshot` and hand it down.
///
/// Twin of `BiyaPremium` in `web-demo/js/premium.js`, whose store is simulated because a browser
/// has no StoreKit; `tools/qa/replay_premium.js` asserts the two state machines agree.
///
/// ## There is no server, and that is the design
///
/// `Transaction.currentEntitlements` is served from the device's own transaction cache, and every
/// transaction in it is a JWS Apple already signed — so the check is cryptographic, local, and
/// works with the radio off. No receipt POST, no shared secret, no accounts.
///
/// What an offline device cannot see is a **renewal**: Apple charges the card server-side and
/// issues a new transaction the phone never receives, so a cached entitlement can only ever expire.
/// `Entitlement.graceDays` is the answer, and the free tier is what makes it safe — when grace
/// lapses the user drops to the free tier with every puzzle rating and saved game intact, not to a
/// dead app.
///
/// Two holes stay open because closing them needs a server: a **refund** is invisible until the
/// device syncs, and a **clock rollback** extends access. See PORTING_NOTES.md.
@MainActor
final class PremiumStore: ObservableObject {

    /// The tiers, in one subscription group so StoreKit handles upgrade and downgrade itself.
    ///
    /// Each `productID` must match App Store Connect **exactly**. App Store Connect namespaces
    /// products per app record, so the prefix has to agree with `PRODUCT_BUNDLE_IDENTIFIER` in
    /// `ios/project.yml` — change the bundle ID and every product here resolves to nothing, which
    /// on this screen means a permanent "Store Unavailable" and, because the app is fully gated,
    /// nothing else to look at.
    enum Plan: String, CaseIterable, Identifiable, Sendable {
        case monthly
        case yearly

        var id: String { rawValue }

        var productID: String {
            switch self {
            case .monthly: return "com.prince24pogi.biyaherongchessapp.plus.monthly"
            case .yearly:  return "com.prince24pogi.biyaherongchessapp.plus.yearly"
            }
        }

        static var allProductIDs: [String] { allCases.map(\.productID) }

        static func matching(_ productID: String) -> Plan? {
            allCases.first { $0.productID == productID }
        }
    }

    /// Kept because a lot of prose and one test still name it. New code should use `Plan`.
    static var monthlyProductID: String { Plan.monthly.productID }

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed
    }

    @Published private(set) var access: Entitlement.Access = .free
    /// Every tier StoreKit could resolve. A tier missing here is a tier that cannot be bought.
    @Published private(set) var products: [Plan: Product] = [:]
    /// Which row the paywall has selected. Yearly by default: it is the better value for the user
    /// and the better outcome for the business, and preselecting the cheaper-per-month plan is
    /// what every subscription screen does. One line to change if that ever stops being true.
    @Published var selectedPlan: Plan = .yearly
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var purchasing = false
    /// Whether to advertise the free trial. StoreKit is the authority on eligibility — an Apple
    /// Account that has already used the introductory offer is not offered it again — so this errs
    /// toward the plain "Subscribe" label rather than promising a trial that will not appear.
    @Published private(set) var trialEligible = false
    /// How long the free trial is, **in days, read from the offer StoreKit returned** — not typed
    /// into a sentence.
    ///
    /// The copy used to say "7-Day" inside the string itself, with nothing checking that against the
    /// product. App Store Connect owns the real duration; if it is ever set to anything else, a
    /// hardcoded 7 stops being a rounding error and becomes a Guideline 3.1.2 misrepresentation —
    /// *"clearly indicate how long the free trial lasts and the price billed once the free trial is
    /// over"*. Same rule the prices already follow, for the same reason.
    ///
    /// `Entitlement.trialDays` is the fallback, and the value before the store answers.
    @Published private(set) var trialDays: Int = Entitlement.trialDays
    /// Set after a restore that found nothing, so the paywall can say so rather than doing nothing.
    @Published var lastRestoreFoundNothing = false

    private var snapshot: Entitlement.Snapshot
    private var usage: Entitlement.Usage
    private let storage: CoachGame.Storage
    private var updatesTask: Task<Void, Never>?

    static let snapshotKey = "biya.store.subscription.v1"
    static let usageKey = "biya.store.usage.v1"

    var isPremium: Bool { access.isPremium }

    /// The App Store was asked and had nothing to sell — a wrong product ID, an in-app purchase not
    /// yet approved, or no network on a device with no cached entitlement.
    ///
    /// The shell reads this to decide NOT to wall anybody (`PhoneApp.locked`). A person who cannot
    /// reach the store cannot buy, and a paywall in front of someone who cannot buy is just a dead
    /// app. `.idle` and `.loading` are deliberately not this: they mean "not asked yet".
    var storeUnavailable: Bool { loadState == .failed }
    var isInTrial: Bool { if case .premium(let t) = access { return t } else { return false } }
    var graceDaysLeft: Int { if case .grace(let d) = access { return d } else { return 0 } }
    var expiresAt: Date? {
        snapshot.expiresAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000.0) }
    }
    var willAutoRenew: Bool { snapshot.willAutoRenew }
    /// The selected tier's `Product`, or nil while the store is still answering.
    var product: Product? { products[selectedPlan] }

    /// `Product.displayPrice` or nothing. Never a hard-coded currency — the RN app managed to show
    /// three different prices in one session.
    var displayPrice: String? { product?.displayPrice }

    func displayPrice(for plan: Plan) -> String? { products[plan]?.displayPrice }

    /// How much cheaper a year is than twelve months, as a whole percent, or nil.
    ///
    /// Computed from the two `Product.price` values rather than written down, for the same reason
    /// the prices themselves are: App Store Connect owns them, they differ per storefront, and a
    /// transcribed number is a number that goes stale silently. Nil whenever either tier is
    /// missing or the arithmetic would not make sense, and the badge simply does not appear.
    var yearlySavingsPercent: Int? {
        guard let monthly = products[.monthly]?.price,
              let yearly = products[.yearly]?.price else { return nil }
        let twelve = monthly * 12
        guard twelve > 0, yearly < twelve else { return nil }
        let fraction = (twelve - yearly) / twelve
        let percent = (fraction * 100 as NSDecimalNumber).intValue
        return percent > 0 ? percent : nil
    }

    init(storage: CoachGame.Storage = SecureStorage.make()) {
        self.storage = storage
        self.snapshot = Self.decode(Entitlement.Snapshot.self, storage.get(Self.snapshotKey))
            ?? .empty
        self.usage = Self.decode(Entitlement.Usage.self, storage.get(Self.usageKey)) ?? .empty
        recompute()
    }

    // No `deinit` cancelling `updatesTask`: a `deinit` is nonisolated and cannot touch this
    // actor's state under Swift 6 strict concurrency. The store is a `@StateObject` on `PhoneApp`
    // and lives for the whole app anyway, so the task's lifetime is the process's.

    // MARK: - Lifecycle

    /// Fetches both tiers so the paywall can show real prices. Purely cosmetic — the entitlement
    /// does not depend on it, so a failure here never locks anyone out.
    func load() async {
        loadState = .loading
        do {
            let resolved = try await Product.products(for: Plan.allProductIDs)
            var byPlan: [Plan: Product] = [:]
            for product in resolved {
                if let plan = Plan.matching(product.id) { byPlan[plan] = product }
            }
            products = byPlan
            // Loaded if ANY tier resolved. One missing tier is a hole in the offer, not a dead
            // screen — the other row still sells, and the failure card would hide a working one.
            loadState = byPlan.isEmpty ? .failed : .loaded
            // Fall back to a tier that actually exists, so the CTA is never wired to nothing.
            if byPlan[selectedPlan] == nil, let first = Plan.allCases.first(where: { byPlan[$0] != nil }) {
                selectedPlan = first
            }
            trialEligible = await Self.introOfferEligible(among: byPlan.values)
            trialDays = Self.trialDays(among: byPlan.values) ?? Entitlement.trialDays
        } catch {
            loadState = .failed
        }
    }

    /// The introductory offer's length in days, read off the product.
    ///
    /// Nil when no tier carries a free trial, in which case the caller keeps `Entitlement.trialDays`
    /// — the copy still has a number to put in the sentence, and `trialEligible` is what decides
    /// whether that sentence is shown at all.
    private static func trialDays(among products: some Collection<Product>) -> Int? {
        for product in products {
            guard let offer = product.subscription?.introductoryOffer,
                  offer.paymentMode == .freeTrial,
                  let days = days(offer.period) else { continue }
            return days
        }
        return nil
    }

    /// A `SubscriptionPeriod` as whole days. The month and year figures are Apple's own billing
    /// conventions, and they only ever appear here — a trial is configured in days or weeks in
    /// practice, and `P1W` is what `ios/Biyaherong.storekit` declares.
    private static func days(_ period: Product.SubscriptionPeriod) -> Int? {
        let perUnit: Int
        switch period.unit {
        case .day: perUnit = 1
        case .week: perUnit = 7
        case .month: perUnit = 30
        case .year: perUnit = 365
        @unknown default: return nil
        }
        let total = perUnit * period.value
        return total > 0 ? total : nil
    }

    /// Is this Apple Account eligible for the introductory offer?
    ///
    /// Asked ONCE and applied to every row, because eligibility is a property of the subscription
    /// **group**, not of a product: a customer who has used the free trial on monthly cannot have
    /// it again on yearly. Asking per row would promise a second trial the App Store will not
    /// honour, and the user would find out at the payment sheet.
    private static func introOfferEligible(among products: some Collection<Product>) async -> Bool {
        for product in products {
            guard let subscription = product.subscription,
                  subscription.introductoryOffer != nil else { continue }
            return await subscription.isEligibleForIntroOffer
        }
        return false
    }

    /// The newest signed transaction for one of our products, straight from StoreKit.
    ///
    /// This is the **receipt Apple signed**, and it is what the content server checks instead of a
    /// token — this app has no account to authenticate with, so the signature is the identity. See
    /// `ContentClient` and `App\Services\AppleTransactionVerifier` on the backend.
    ///
    /// Read fresh on every call rather than cached: StoreKit reissues these on renewal and
    /// revocation, and a stale one is either a needless rejection or a grant that outlives its
    /// subscription. `.unverified` is skipped for the same reason the entitlement skips it — a
    /// failed signature is not a receipt, whatever the payload claims — and the server would refuse
    /// it anyway, which is the point of sending the signature rather than a claim.
    func currentReceipt() async -> String? {
        var newest: (expiry: Date, jws: String)?

        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            guard Plan.matching(transaction.productID) != nil else { continue }
            guard transaction.revocationDate == nil else { continue }
            guard let expiry = transaction.expirationDate else { continue }
            if newest == nil || expiry > newest!.expiry {
                newest = (expiry, result.jwsRepresentation)
            }
        }

        return newest?.jws
    }

    /// Watches for renewals, revocations and purchases made on another device, for the app's life.
    /// This is how an offline user in grace is restored the moment they reconnect.
    func startObserving() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard let self else { return }
                if case .verified(let transaction) = update { await transaction.finish() }
                await self.refresh()
            }
        }
    }

    /// Re-reads the on-device entitlement. Runs at launch, on foreground, and on every update.
    func refresh() async {
        var bestExpiry: Date?
        var isTrial = false
        var signed: Date?

        for await result in Transaction.currentEntitlements {
            // `.unverified` is treated as no entitlement at all — a failed signature is not a
            // subscription, whatever the payload claims.
            guard case .verified(let transaction) = result else { continue }
            // ANY tier in the group entitles. Filtering to one product ID would have locked out
            // every yearly subscriber the moment that tier existed.
            guard Plan.matching(transaction.productID) != nil else { continue }
            // A refunded transaction is revoked. Offline we learn this late; that is one of the
            // two accepted holes.
            guard transaction.revocationDate == nil else { continue }
            guard let expiry = transaction.expirationDate else { continue }
            if bestExpiry == nil || expiry > bestExpiry! {
                bestExpiry = expiry
                isTrial = transaction.offerType == .introductory
            }
            // The clock floor moves to the newest Apple-signed timestamp we have ever seen.
            if signed == nil || transaction.signedDate > signed! { signed = transaction.signedDate }
        }

        // Auto-renew state decides whether a lapse gets grace. If we cannot read it we keep what we
        // had, and a brand-new subscription is assumed to renew — the wrong guess costs a bounded
        // seven days, where the opposite wrong guess locks out someone who paid.
        var renews = snapshot.willAutoRenew || bestExpiry != nil
        // The group ID comes from a loaded product, never from a constant. It used to be the
        // hand-typed string "biyaherong.plus"; App Store Connect assigns a NUMERIC group ID, so
        // that lookup never matched, and because it is a `try?` it failed silently and quietly
        // demoted this to the guess above. A value that cannot be verified locally should not be
        // typed locally — extract it.
        if let groupID = products.values.first?.subscription?.subscriptionGroupID,
           let statuses = try? await Product.SubscriptionInfo.status(for: groupID),
           let first = statuses.first,
           case .verified(let info) = first.renewalInfo {
            renews = info.willAutoRenew
        }

        apply(expiry: bestExpiry, isTrial: isTrial, signed: signed, renews: renews)
    }

    // MARK: - Purchase

    @discardableResult
    func purchase() async -> Bool {
        await purchase(selectedPlan)
    }

    @discardableResult
    func purchase(_ plan: Plan) async -> Bool {
        guard let product = products[plan] else { return false }
        purchasing = true
        defer { purchasing = false }
        do {
            let outcome = try await product.purchase()
            switch outcome {
            case .success(let verification):
                if case .verified(let transaction) = verification { await transaction.finish() }
                await refresh()
                return isPremium
            case .userCancelled:
                // Deliberately silent. A cancelled purchase shows no alert and no toast.
                return false
            case .pending:
                return false
            @unknown default:
                return false
            }
        } catch {
            return false
        }
    }

    /// Restore. Required by App Review, and the only path that needs the network.
    func restore() async {
        lastRestoreFoundNothing = false
        try? await AppStore.sync()
        await refresh()
        lastRestoreFoundNothing = !isPremium
    }

    #if os(iOS)
    /// Apple's own management sheet — the app never cancels a subscription itself.
    func manage(in scene: UIWindowScene) async {
        try? await AppStore.showManageSubscriptions(in: scene)
    }
    #endif

    // MARK: - The free tier's counters

    func canUse(_ mode: String) -> Bool {
        !Entitlement.isAtLimit(usage, mode: mode, isPremium: isPremium, now: nowMs())
    }

    func used(_ mode: String) -> Int {
        Entitlement.used(usage, mode: mode, now: nowMs())
    }

    /// Uses left today, or `nil` when unlimited.
    func remaining(_ mode: String) -> Int? {
        Entitlement.remaining(usage, mode: mode, isPremium: isPremium, now: nowMs())
    }

    /// Records one use. Call when a run **starts**, not when a puzzle is solved — a failed attempt
    /// still consumes a free use, exactly as the original counted them.
    func recordUse(_ mode: String) {
        guard !isPremium else { return }
        Entitlement.record(&usage, mode: mode, now: nowMs())
        persist(Self.usageKey, usage)
    }

    /// Spends one Game Review allowance; false when the free tier's daily three are gone.
    ///
    /// Lives here, not at the call sites, because there are **two** review entry points — the
    /// Analysis Board's ☰ menu and Play vs Coach's "Start Review" — and capping one while the other
    /// runs free is not a cap at all.
    func consumeReview() -> Bool {
        guard canUse(Entitlement.Mode.review) else { return false }
        recordUse(Entitlement.Mode.review)
        return true
    }

    func isCoachLocked(level: Int) -> Bool {
        Entitlement.isCoachLocked(level: level, isPremium: isPremium)
    }

    var isThematicLocked: Bool { Entitlement.isThematicLocked(isPremium: isPremium) }
    var maxSwissRounds: Int { Entitlement.maxSwissRounds(isPremium: isPremium) }

    // MARK: - Internals

    /// The trusted clock: device time, floored by the newest Apple-signed timestamp ever seen.
    private func nowMs() -> Int {
        Entitlement.trustedNow(deviceNow: Int(Date().timeIntervalSince1970 * 1000),
                               floor: snapshot.trustedFloorMs)
    }

    private func apply(expiry: Date?, isTrial: Bool, signed: Date?, renews: Bool) {
        var s = snapshot
        if let expiry {
            s.isSubscribed = true
            s.expiresAtMs = Int(expiry.timeIntervalSince1970 * 1000)
            s.isInTrial = isTrial
        } else {
            s.isSubscribed = false
            // `expiresAtMs` is deliberately KEPT. It is what the grace window runs from, and
            // clearing it here would drop the renewal-day subscriber straight to the free tier —
            // the exact failure grace exists to prevent.
        }
        if let signed {
            s.trustedFloorMs = max(s.trustedFloorMs, Int(signed.timeIntervalSince1970 * 1000))
        }
        s.willAutoRenew = renews
        s.lastVerifiedMs = nowMs()
        snapshot = s
        persist(Self.snapshotKey, s)
        recompute()
    }

    private func recompute() {
        // In a TEST build there is no subscription product in App Store Connect, so
        // `Product.products(for:)` comes back empty and the paywall can only say "Store
        // Unavailable" — with the trial gate in front of every route, that leaves a tester nothing
        // they can open.
        //
        // Granted at this ONE funnel rather than by forging a `Snapshot`, so everything the real
        // resolution does — the trust floor, the grace window, the expiry maths — is neither
        // edited nor bypassed; in a build with no store to consult it is simply not consulted.
        //
        // `trial: false` is a plain active subscription, not the introductory period: ordinary
        // premium UI rather than a countdown for a trial nobody started. The associated value is
        // mandatory — `access = .premium` does not compile, which is what
        // `tools/qa/swift_enum_payload_check.js` exists to catch.
        //
        // Decided by the APP TARGET (`BiyaherongBuild`). A `#if` here would be INERT: a
        // project-level compilation condition never reaches a SwiftPM package target.
        if BiyaherongBuild.isTestBuild {
            access = .premium(trial: false)
        } else {
            access = Entitlement.resolve(snapshot, now: nowMs())
        }
    }

    private func persist<T: Encodable>(_ key: String, _ value: T) {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8)
        else { return }
        storage.set(key, text)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ raw: String?) -> T? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}
