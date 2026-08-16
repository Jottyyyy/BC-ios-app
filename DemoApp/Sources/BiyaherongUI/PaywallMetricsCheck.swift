import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the subscription's pure layer, in the same spirit as ParityRunner,
// HomeMetricsCheck and LoginMetricsCheck: this toolchain has no XCTest, so the assertions live in
// a runnable harness. `swift run PaywallMetricsCheck` exits non-zero on any failure.
//
// It asserts the parts that decide whether someone has paid, without a device, a network or a
// sandbox account: the trial/expiry/grace state machine and every one of its boundaries, the
// monotonic clock floor, the round-UP day count the server got wrong, every free-tier cap
// (including that Turbo is counted per mode), the two colours of Apple's own chrome, and the
// paywall copy App Review requires verbatim.
//
// This is only possible because no view body in PaywallScreen.swift contains a numeric literal or
// an arithmetic operator — every number is a stored property or a pure function from
// PaywallMetrics.swift. Keep it that way, or coverage silently drains out of this file.

public struct PaywallMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "PaywallMetricsCheck: \(passed) assertions passed"
           : "PaywallMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

/// A `CoachGame.Storage` in memory, so the store's persistence is testable with no keychain and no
/// side effects. A class, not a struct: the protocol's `set`/`remove` are non-mutating.
private final class PaywallMemoryStorage: CoachGame.Storage {
    private var values: [String: String]
    init(_ seed: [String: String] = [:]) { values = seed }
    func get(_ key: String) -> String? { values[key] }
    func set(_ key: String, _ value: String) { values[key] = value }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    var isEmpty: Bool { values.isEmpty }
}

@MainActor
public func biyaherongPaywallMetricsCheck() -> PaywallMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func expectEqual<T: Equatable>(_ a: T, _ b: T, _ what: String) {
        expect(a == b, "\(what): got \(a), expected \(b)")
    }

    let day = Entitlement.msPerDay
    // A fixed instant, so no assertion is clock-flaky.
    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    let t0 = Int(utc.date(from: DateComponents(year: 2026, month: 8, day: 16, hour: 12))!
        .timeIntervalSince1970 * 1000)

    func snap(subscribed: Bool = true, expires: Int? = nil, trial: Bool = false,
              renews: Bool = true, floor: Int = 0) -> Entitlement.Snapshot {
        Entitlement.Snapshot(isSubscribed: subscribed, expiresAtMs: expires, isInTrial: trial,
                             willAutoRenew: renews, lastVerifiedMs: nil, trustedFloorMs: floor)
    }

    // MARK: - Constants

    expectEqual(Entitlement.graceDays, 7, "grace is 7 days, not the spec's 14")
    expectEqual(Entitlement.trialDays, 7, "the trial is 7 days")
    expectEqual(Entitlement.reviewsPerDay, 3, "free users get 3 Game Reviews a day")
    expectEqual(Entitlement.freeCoachLevels, 2, "coaches 1-2 are free")
    expectEqual(Entitlement.maxUses(for: Entitlement.Mode.review), 3,
                "the review cap comes from Entitlement, not DailyLimits")
    expectEqual(Entitlement.maxUses(for: Entitlement.Mode.regular), 5,
                "the ported caps still come from DailyLimits")
    expectEqual(Entitlement.maxUses(for: Entitlement.Mode.rush(3)), 1,
                "each Turbo mode gets its own single run")
    // The invented cap must NOT be smuggled into the PHP-pinned table.
    expect(DailyLimits.caps["review"] == nil,
           "the invented review cap is not in the golden-tested DailyLimits table")
    expectEqual(DailyLimits.caps.count, 3, "DailyLimits still has exactly its three named modes")

    // MARK: - resolve

    expectEqual(Entitlement.resolve(.empty, now: t0), .free, "a fresh install is free")
    expectEqual(Entitlement.resolve(snap(expires: t0 + day), now: t0), .premium(trial: false),
                "an unexpired subscription is premium")
    expectEqual(Entitlement.resolve(snap(expires: t0 + 3 * day, trial: true), now: t0),
                .premium(trial: true), "a trial reports itself as a trial")
    // FAIL CLOSED: a claim with no expiry is not something StoreKit produced.
    expectEqual(Entitlement.resolve(snap(expires: nil), now: t0), .free,
                "a subscription claim with no expiry buys nothing")

    // Expiry, grace, and the cancel branch.
    expectEqual(Entitlement.resolve(snap(expires: t0 - day), now: t0), .grace(daysLeft: 6),
                "one day past expiry with auto-renew ON is grace, 6 days left")
    expectEqual(Entitlement.resolve(snap(expires: t0 - 7 * day), now: t0), .free,
                "grace ends after exactly 7 days")
    expectEqual(Entitlement.resolve(snap(expires: t0 - 7 * day + 1000), now: t0),
                .grace(daysLeft: 1), "one second inside the window is still grace")
    expectEqual(Entitlement.resolve(snap(expires: t0 - 1000, renews: false), now: t0), .free,
                "a CANCELLED subscription gets no grace — the expiry was expected")
    expectEqual(Entitlement.resolve(snap(expires: t0 + day, renews: false), now: t0),
                .premium(trial: false), "cancelled but not yet expired is still premium")
    // The renewal-day subscriber. This one assertion is the reason grace exists at all.
    expect(Entitlement.resolve(snap(expires: t0 - 60_000), now: t0).isPremium,
           "a subscriber one minute past renewal, offline, keeps access")
    expect(Entitlement.Access.grace(daysLeft: 1).isPremium, "grace counts as premium")
    expect(Entitlement.Access.premium(trial: true).isPremium, "a trial counts as premium")
    expect(!Entitlement.Access.free.isPremium, "free does not")

    // MARK: - The clock floor

    expectEqual(Entitlement.trustedNow(deviceNow: 100, floor: 500), 500,
                "a back-dated clock is floored")
    expectEqual(Entitlement.trustedNow(deviceNow: 900, floor: 500), 900,
                "a legitimate clock passes through")
    expectEqual(Entitlement.resolve(snap(expires: t0, renews: false, floor: t0 + day),
                                    now: t0 - 30 * day), .free,
                "rolling the clock back a month does NOT resurrect an expired subscription")

    // MARK: - daysRemaining (the round-UP rule the server got wrong)

    expectEqual(Entitlement.daysRemaining(untilMs: t0 + 3 * day, nowMs: t0, calendar: utc), 3,
                "three whole days")
    expectEqual(Entitlement.daysRemaining(untilMs: t0 + 3 * day + day / 2, nowMs: t0, calendar: utc),
                4, "3.5 days rounds UP to 4")
    expectEqual(Entitlement.daysRemaining(untilMs: t0 + 60_000, nowMs: t0, calendar: utc), 1,
                "under 24 hours is 1 day remaining, never 0")
    expectEqual(Entitlement.daysRemaining(untilMs: t0, nowMs: t0, calendar: utc), 0,
                "exactly expired is 0")
    expectEqual(Entitlement.daysRemaining(untilMs: t0 - day, nowMs: t0, calendar: utc), 0,
                "past expiry is 0, never negative")

    // MARK: - The uncounted gates

    expect(Entitlement.isThematicLocked(isPremium: false), "Thematic is premium-only")
    expect(!Entitlement.isThematicLocked(isPremium: true), "and unlocks with premium")
    for level in [1, 2] {
        expect(!Entitlement.isCoachLocked(level: level, isPremium: false), "coach \(level) is free")
    }
    for level in [3, 4, 5] {
        expect(Entitlement.isCoachLocked(level: level, isPremium: false),
               "coach \(level) is premium")
        expect(!Entitlement.isCoachLocked(level: level, isPremium: true),
               "coach \(level) unlocks with premium")
    }
    expectEqual(Entitlement.maxSwissRounds(isPremium: false), 3, "free tournaments are 3 rounds")
    expectEqual(Entitlement.maxSwissRounds(isPremium: true), 30, "premium tournaments are 30 rounds")
    expectEqual(Entitlement.maxSwissRounds(isPremium: false), TournamentEngine.freeMaxRounds,
                "the free ceiling is the ported constant, not a second copy")

    // MARK: - Usage

    var u = Entitlement.Usage.empty
    expectEqual(Entitlement.used(u, mode: Entitlement.Mode.regular, now: t0, calendar: utc), 0,
                "a fresh day starts at zero")
    for i in 1...5 {
        expectEqual(Entitlement.record(&u, mode: Entitlement.Mode.regular, now: t0, calendar: utc),
                    i, "use \(i) counts")
    }
    expect(Entitlement.isAtLimit(u, mode: Entitlement.Mode.regular, isPremium: false, now: t0,
                                 calendar: utc), "5 of 5 exhausts the free tier")
    expect(!Entitlement.isAtLimit(u, mode: Entitlement.Mode.regular, isPremium: true, now: t0,
                                  calendar: utc), "premium is never at a limit")
    expectEqual(Entitlement.remaining(u, mode: Entitlement.Mode.regular, isPremium: false, now: t0,
                                      calendar: utc), 0, "nothing remaining")
    expect(Entitlement.remaining(u, mode: Entitlement.Mode.regular, isPremium: true, now: t0,
                                 calendar: utc) == nil, "premium remaining is unlimited (nil)")
    expectEqual(Entitlement.remaining(u, mode: Entitlement.Mode.streak, isPremium: false, now: t0,
                                      calendar: utc), 1, "the streak allowance is untouched")

    // Turbo is independent PER MODE — one shared counter would be the easy, wrong reading.
    Entitlement.record(&u, mode: Entitlement.Mode.rush(3), now: t0, calendar: utc)
    expect(Entitlement.isAtLimit(u, mode: Entitlement.Mode.rush(3), isPremium: false, now: t0,
                                 calendar: utc), "3-minute Turbo is used up")
    expect(!Entitlement.isAtLimit(u, mode: Entitlement.Mode.rush(5), isPremium: false, now: t0,
                                  calendar: utc), "5-minute Turbo is still free")
    expect(!Entitlement.isAtLimit(u, mode: Entitlement.Mode.rush(0), isPremium: false, now: t0,
                                  calendar: utc), "infinite Turbo is still free")

    // Reviews use the invented cap of 3, not DailyLimits' unknown-mode default of 1.
    Entitlement.record(&u, mode: Entitlement.Mode.review, now: t0, calendar: utc)
    Entitlement.record(&u, mode: Entitlement.Mode.review, now: t0, calendar: utc)
    expect(!Entitlement.isAtLimit(u, mode: Entitlement.Mode.review, isPremium: false, now: t0,
                                  calendar: utc), "2 of 3 reviews is fine")
    Entitlement.record(&u, mode: Entitlement.Mode.review, now: t0, calendar: utc)
    expect(Entitlement.isAtLimit(u, mode: Entitlement.Mode.review, isPremium: false, now: t0,
                                 calendar: utc), "3 of 3 reviews is the cap")
    expect(!Entitlement.isAtLimit(u, mode: Entitlement.Mode.regular, isPremium: false,
                                  now: t0 + day, calendar: utc), "tomorrow is a fresh allowance")

    var pruned = Entitlement.Usage.empty
    Entitlement.record(&pruned, mode: Entitlement.Mode.regular, now: t0 - 10 * day, calendar: utc)
    Entitlement.record(&pruned, mode: Entitlement.Mode.regular, now: t0, calendar: utc)
    expectEqual(pruned.counts.count, 1, "a 10-day-old bucket is pruned away")
    var keep = Entitlement.Usage.empty
    Entitlement.record(&keep, mode: Entitlement.Mode.regular, now: t0 - day, calendar: utc)
    Entitlement.record(&keep, mode: Entitlement.Mode.regular, now: t0, calendar: utc)
    expectEqual(keep.counts.count, 2, "yesterday is kept, so a midnight rollover is not lossy")

    // MARK: - The store's persistence

    let mem = PaywallMemoryStorage()
    let store = PremiumStore(storage: mem)
    expect(!store.isPremium, "a fresh store is not premium")
    expect(mem.isEmpty, "constructing the store writes nothing")
    expect(store.canUse(Entitlement.Mode.regular), "and the free tier is open")
    for _ in 1...5 { store.recordUse(Entitlement.Mode.regular) }
    expect(!store.canUse(Entitlement.Mode.regular), "five uses exhaust the free tier")
    expect(!mem.isEmpty, "the counters are persisted")
    let resumed = PremiumStore(storage: mem)
    expect(!resumed.canUse(Entitlement.Mode.regular), "and survive a relaunch")
    expect(resumed.canUse(Entitlement.Mode.streak), "without leaking across modes")
    // A corrupt or hand-written store fails closed rather than granting access.
    let forged = PremiumStore(storage: PaywallMemoryStorage([
        PremiumStore.snapshotKey: "{\"isSubscribed\":true,\"willAutoRenew\":true}"
    ]))
    expect(!forged.isPremium, "a hand-written snapshot with no expiry fails closed")
    let garbage = PremiumStore(storage: PaywallMemoryStorage([PremiumStore.snapshotKey: "{oops"]))
    expect(!garbage.isPremium, "unparseable stored state fails closed")
    expect(PremiumStore.snapshotKey == "biya.store.subscription.v1",
           "the snapshot key keeps the biya.<area>.<thing>.v1 shape")
    expect(PremiumStore.monthlyProductID.hasPrefix("com.prince24pogi.biyaherongchessapp"),
           "the product ID is namespaced under the app record's bundle ID")

    // MARK: - Palette and type

    expectEqual(PaywallPalette.screenBg, Theme.background, "the paywall is the app's background")
    expectEqual(PaywallPalette.cta, Theme.gold, "the CTA is gold")
    expectEqual(PaywallPalette.ctaInk, Theme.onGold, "on navy ink")
    expectEqual(PaywallPalette.activePill, Theme.c(0x4CAF50), "the Active pill keeps the spec green")
    expect(PaywallPalette.warnInk != Theme.negative,
           "grace warns in amber, not red — nothing is broken and nothing is lost")
    expect(PaywallType.heroTitleSize > PaywallType.cardTitleSize,
           "the hero outranks the card titles")
    expect(PaywallType.cardTitleSize > PaywallType.rowSize, "card titles outrank their rows")
    expect(PaywallType.rowSize > PaywallType.legalSize, "rows outrank the legal small print")
    expect(PaywallLayout.ctaHeight >= 44, "the CTA clears Apple's 44pt minimum target")
    expect(PaywallLayout.restoreHeight >= 44, "so does Restore, which App Review requires")

    // MARK: - Copy

    expectEqual(PaywallStrings.trialCta, "Start Your 7-Day Free Trial",
                "the CTA names the trial length")
    expect(PaywallStrings.disclosure.contains("automatically renews"),
           "the App Review disclosure is present")
    expect(PaywallStrings.disclosure.contains("24 hours"), "and names the 24-hour window")
    expect(PaywallStrings.disclosure.contains("Apple ID"), "and names where the charge lands")
    expectEqual(PaywallLinks.all.count, 2,
                "exactly two URLs in the whole app — the EULA and the privacy policy")
    expect(PaywallLinks.all[0].url.contains("apple.com/legal"),
           "the first is Apple's standard EULA")
    for link in PaywallLinks.all {
        expect(link.url.hasPrefix("https://"), "\(link.label) is https")
        expect(!link.label.isEmpty, "\(link.url) has a label")
    }
    expect(PaywallBenefits.all.count >= 5, "the paywall says what the money buys")
    for benefit in PaywallBenefits.all {
        expect(!benefit.emoji.isEmpty && !benefit.text.isEmpty, "every benefit row is filled in")
    }
    expectEqual(PaywallStrings.fill("{a} and {b}", ["a": "x", "b": "y"]), "x and y",
                "placeholder substitution")
    expectEqual(PaywallStrings.fill("{missing}", [:]), "{missing}",
                "an unknown placeholder is left alone rather than blanked")
    expectEqual(PaywallStrings.daysPillText(1), "1 day remaining", "one day is not pluralised")
    expectEqual(PaywallStrings.daysPillText(5), "5 days remaining", "five days is")
    expectEqual(PaywallStrings.dateText(t0, calendar: utc), "Aug 16, 2026",
                "the expiry date uses the frozen month table")

    return PaywallMetricsCheckResult(passed: passed, failures: failures)
}
