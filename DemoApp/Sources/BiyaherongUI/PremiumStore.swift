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

    /// Must match App Store Connect exactly, and App Store Connect is namespaced per app record —
    /// so this prefix has to agree with `PRODUCT_BUNDLE_IDENTIFIER` in `ios/project.yml`.
    static let monthlyProductID = "com.prince24pogi.biyaherongchessapp.plus.monthly"
    /// The subscription group. One group, one product today; a yearly tier would join it here so
    /// StoreKit handles the upgrade/downgrade itself.
    static let subscriptionGroupID = "biyaherong.plus"

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed
    }

    @Published private(set) var access: Entitlement.Access = .free
    @Published private(set) var product: Product?
    @Published private(set) var loadState: LoadState = .idle
    @Published private(set) var purchasing = false
    /// Whether to advertise the free trial. StoreKit is the authority on eligibility — an Apple
    /// Account that has already used the introductory offer is not offered it again — so this errs
    /// toward the plain "Subscribe" label rather than promising a trial that will not appear.
    @Published private(set) var trialEligible = false
    /// Set after a restore that found nothing, so the paywall can say so rather than doing nothing.
    @Published var lastRestoreFoundNothing = false

    private var snapshot: Entitlement.Snapshot
    private var usage: Entitlement.Usage
    private let storage: CoachGame.Storage
    private var updatesTask: Task<Void, Never>?

    static let snapshotKey = "biya.store.subscription.v1"
    static let usageKey = "biya.store.usage.v1"

    var isPremium: Bool { access.isPremium }
    var isInTrial: Bool { if case .premium(let t) = access { return t } else { return false } }
    var graceDaysLeft: Int { if case .grace(let d) = access { return d } else { return 0 } }
    var expiresAt: Date? {
        snapshot.expiresAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000.0) }
    }
    var willAutoRenew: Bool { snapshot.willAutoRenew }
    /// `Product.displayPrice` or nothing. Never a hard-coded currency — the RN app managed to show
    /// three different prices in one session.
    var displayPrice: String? { product?.displayPrice }

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

    /// Fetches the product so the paywall can show a real price. Purely cosmetic — the entitlement
    /// does not depend on it, so a failure here never locks anyone out.
    func load() async {
        loadState = .loading
        do {
            let products = try await Product.products(for: [Self.monthlyProductID])
            product = products.first
            loadState = product == nil ? .failed : .loaded
            if let subscription = product?.subscription, subscription.introductoryOffer != nil {
                trialEligible = await subscription.isEligibleForIntroOffer
            } else {
                trialEligible = false
            }
        } catch {
            loadState = .failed
        }
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
            guard transaction.productID == Self.monthlyProductID else { continue }
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
        if let statuses = try? await Product.SubscriptionInfo.status(for: Self.subscriptionGroupID),
           let first = statuses.first,
           case .verified(let info) = first.renewalInfo {
            renews = info.willAutoRenew
        }

        apply(expiry: bestExpiry, isTrial: isTrial, signed: signed, renews: renews)
    }

    // MARK: - Purchase

    @discardableResult
    func purchase() async -> Bool {
        guard let product else { return false }
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
        #if BIYA_TEST_BUILD
        // ── TEST BUILDS ONLY ──────────────────────────────────────────────────────────────────
        //
        // There is no subscription product in App Store Connect yet, so `Product.products(for:)`
        // returns an empty list and the paywall can only say "Store Unavailable". The trial gate
        // stands in front of every route, so a tester gets past the login screen and then has
        // nothing at all they can open — the app is a paywall with no way through it.
        //
        // Granted here rather than by faking a `Snapshot`, because this is the one funnel every
        // path already goes through, and everything below it — the trust floor, the grace window,
        // the expiry maths — stays exactly as it ships. Nothing in the real resolution is edited
        // or bypassed; it is simply not consulted in a build that has no store to consult.
        //
        // `ios-appstore` never sets this flag and REFUSES to build if it finds it.
        access = .premium
        #else
        access = Entitlement.resolve(snapshot, now: nowMs())
        #endif
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
