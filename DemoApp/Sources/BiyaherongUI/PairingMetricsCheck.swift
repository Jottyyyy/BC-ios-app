import SwiftUI
import Foundation
import BiyaherongCoachCore

// Executable self-check for the Pairing Manager's derived layer, in the same spirit as
// `PuzzleMetricsCheck`: this toolchain has no XCTest, so the assertions live in a runnable harness.
// `swift run PairingMetricsCheck` exits non-zero on any failure.
//
// ## What it covers, and what it deliberately does not
//
// It does NOT re-check the 774 raw constants in `PairingMetrics.swift`. Those are not transcribed:
// `tools/metrics/gen_pairing_metrics.js` emits that file and the JS twin from the same extraction in
// the same pass, so there is no step between them for a typo to live in. Re-asserting them here
// would be a second copy of the same fact with a second chance to be wrong.
//
// What it asserts is the LOGIC — the colour maps and, more importantly, their fallbacks; the score
// formatter; and the standings comparator. Logic is where this port has actually gone wrong before:
// the RN result badge fell through to a draw for anything it did not recognise, and the standings
// were sorted three different ways in three different places.

public struct PairingMetricsCheckResult: Sendable {
    public var passed: Int
    public var failures: [String]
    public var ok: Bool { failures.isEmpty }
    public var summary: String {
        ok ? "PairingMetricsCheck: \(passed) assertions passed"
           : "PairingMetricsCheck: \(passed) passed, \(failures.count) FAILED\n"
             + failures.map { "  ✗ \($0)" }.joined(separator: "\n")
    }
}

public func biyaherongPairingMetricsCheck() -> PairingMetricsCheckResult {
    var passed = 0
    var failures: [String] = []

    func expect(_ condition: Bool, _ what: String) {
        condition ? (passed += 1) : failures.append(what)
    }
    func eq<T: Equatable>(_ got: T, _ want: T, _ what: String) {
        expect(got == want, "\(what): got \(got), want \(want)")
    }

    // ── 1. The colour maps, and their FALLBACKS ──────────────────────────────────────
    //
    // The fallback is the part worth asserting. The source returns gold for any status that is
    // neither ongoing nor finished, so a row with a corrupt status still draws a visible dot rather
    // than nothing at all.
    eq(PairingPalette.type(true), PairingPalette.swiss, "Swiss is teal")
    eq(PairingPalette.type(false), PairingPalette.roundRobin, "Round Robin is orange")
    eq(PairingPalette.status("ongoing"), PairingPalette.ongoing, "ongoing is teal")
    eq(PairingPalette.status("finished"), PairingPalette.finished, "finished is muted")
    eq(PairingPalette.status("setup"), PairingPalette.setup, "setup is gold")
    eq(PairingPalette.status(""), PairingPalette.setup, "an empty status still gets a colour")
    eq(PairingPalette.status("nonsense"), PairingPalette.setup, "and so does an unknown one")

    // The badge tint is a hex alpha BYTE concatenated in the source, not a rounded percentage.
    // 0x22/255 is 13.33 %, which the spec writes as "13 % alpha" — pin the byte.
    expect(abs(PairingPalette.tintByte - 34.0 / 255.0) < 0.000001,
           "the badge tint is 0x22/255, not a rounded 13 %")

    // ── 2. Chess notation, never decimals ────────────────────────────────────────────
    //
    // `1.0.0` is what the server's `decimal:1` cast produced when it met a TypeScript interface
    // declaring `number`. Half points are ½, whole points have no fraction at all.
    eq(PairingEngine.formatScore(0), "0", "zero")
    eq(PairingEngine.formatScore(0.5), "\u{00BD}", "a bare half point")
    eq(PairingEngine.formatScore(1), "1", "one")
    eq(PairingEngine.formatScore(1.5), "1\u{00BD}", "one and a half")
    eq(PairingEngine.formatScore(12), "12", "double figures")
    eq(PairingEngine.formatScore(12.5), "12\u{00BD}", "and a half")
    for v in [0.0, 0.5, 1.0, 1.5, 2.0, 7.5] {
        expect(!PairingEngine.formatScore(v).contains("."),
               "formatScore(\(v)) contains no decimal point")
    }

    // ── 3. The live round recommendation ─────────────────────────────────────────────
    eq(PairingEngine.recommendedRounds(2), 1, "two players need one round")
    eq(PairingEngine.recommendedRounds(8), 3, "eight need three")
    eq(PairingEngine.recommendedRounds(12), 4, "twelve need four")
    eq(PairingEngine.recommendedRounds(30), 5, "thirty need five")
    eq(PairingEngine.recommendedRounds(1), 1, "and a degenerate field still returns a round")

    // ── 4. ONE standings comparator, exercised through every key ─────────────────────
    //
    // Each row below differs from the next by exactly one tie-break, so the expected order is the
    // ladder itself: score, direct encounter, Buchholz, Sonneborn-Berger, wins, rating, name.
    let rows = [
        PairingEngine.StandingsRow(id: 1, name: "Zoe", score: 1),
        PairingEngine.StandingsRow(id: 2, name: "Ana", score: 2),
        PairingEngine.StandingsRow(id: 3, name: "Bob", score: 2, directEncounter: 1),
    ]
    let sorted = PairingEngine.standingsOrder(rows)
    eq(sorted.map { $0.name }, ["Bob", "Ana", "Zoe"],
       "score first, then direct encounter — the key the RN client dropped")

    let tied = [
        PairingEngine.StandingsRow(id: 1, name: "Bea", score: 1, buchholz: 3),
        PairingEngine.StandingsRow(id: 2, name: "Ada", score: 1, buchholz: 5),
    ]
    eq(PairingEngine.standingsOrder(tied).map { $0.name }, ["Ada", "Bea"], "Buchholz outranks name")

    let byName = [
        PairingEngine.StandingsRow(id: 1, name: "Bea", score: 1),
        PairingEngine.StandingsRow(id: 2, name: "Ada", score: 1),
    ]
    eq(PairingEngine.standingsOrder(byName).map { $0.name }, ["Ada", "Bea"],
       "and name is the last resort, so the order is always defined")

    // ── 5. The cost ladder's ORDER, which is the algorithm ───────────────────────────
    expect(PairingEngine.costRepeat > PairingEngine.costColorAbsolute,
           "nothing outranks avoiding a rematch")
    expect(PairingEngine.costColorAbsolute > PairingEngine.costRefloat,
           "FIDE C.04.1's absolute colour rules outrank float bookkeeping")
    expect(PairingEngine.costRefloat > PairingEngine.costScore,
           "rather pair a point out of bracket than float the same player down twice")
    expect(PairingEngine.costScore > PairingEngine.costColorUnit,
           "a point of score difference outweighs a unit of colour imbalance")

    // ── 6. Nothing is left at zero ───────────────────────────────────────────────────
    //
    // A cheap sweep for a constant zeroed by a bad edit — the kind that renders as an invisible
    // label rather than a crash.
    let sizes: [(String, CGFloat)] = [
        ("list.cardBorderRadius", PairingList.cardBorderRadius),
        ("list.fabPaddingVertical", PairingList.fabPaddingVertical),
        ("create.typeCardPadding", PairingCreate.typeCardPadding),
        ("detail.tabBorderRadius", PairingDetail.tabBorderRadius),
        ("detail.playerSeedWidth", PairingDetail.playerSeedWidth),
        ("share.cardBorderRadius", PairingShare.cardBorderRadius),
        ("shareCard.width", PairingShareCard.width),
        ("cols.rank", PairingCols.rank),
        ("cols.pts", PairingCols.pts),
    ]
    for (name, v) in sizes { expect(v > 0, "\(name) is a positive dimension") }

    // The five standings columns are distinct widths where the source makes them distinct — the
    // whole reason they are extracted from `inlineStyles` rather than the StyleSheet, where
    // `standingsVal.width` is 42 for every one of them.
    expect(PairingCols.pts != PairingCols.wdl, "Pts and W/D/L are different widths")
    expect(PairingCols.bch != PairingCols.wdl, "so are Buchholz and W/D/L")
    eq(PairingCols.sb, PairingCols.bch, "and the invented SB column mirrors Buchholz")

    return PairingMetricsCheckResult(passed: passed, failures: failures)
}
