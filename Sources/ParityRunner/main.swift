import Foundation
import BiyaherongCoachCore

// ─────────────────────────────────────────────────────────────────────────────
// Parity harness. Loads golden JSON produced by the real PHP oracle
// (tools/oracle/generate_goldens.php) and asserts the Swift domain layer matches.
// Run: `swift run ParityRunner`. Exit code 0 = all parity checks passed.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Harness

final class Harness {
    var pass = 0, fail = 0
    var failures: [String] = []
    var groupCounts: [String: Int] = [:]
    private var group = ""

    func begin(_ name: String) { group = name }

    func check(_ ok: Bool, _ ctx: @autoclosure () -> String) {
        groupCounts[group, default: 0] += 1
        if ok { pass += 1 } else { fail += 1; failures.append("[\(group)] \(ctx())") }
    }

    func approx(_ a: Double, _ b: Double, tol: Double = 1e-6) -> Bool { abs(a - b) <= tol }

    /// QA guard against vacuous/partial passes: every mandatory group MUST contribute at least its
    /// expected floor of assertions. Catches a missing/empty golden (0 assertions) AND a truncated
    /// golden (present but short — e.g. a generation bug emitting 1 case). Floors are deterministic;
    /// bump them when cases are intentionally added.
    func requireMinCounts(_ mins: [String: Int]) {
        for (n, m) in mins {
            let got = groupCounts[n] ?? 0
            if got < m {
                fail += 1
                failures.append("[qa] group '\(n)' contributed \(got) assertions, expected >= \(m) (missing/empty/truncated golden or skipped batch)")
            }
        }
    }

    func summary(verbose: Bool = true) -> Int {
        if verbose {
            print("Per-group assertions:")
            for (g, c) in groupCounts.sorted(by: { $0.key < $1.key }) { print(String(format: "  %-22@ %d", g as NSString, c)) }
        }
        print(String(repeating: "─", count: 60))
        if failures.isEmpty {
            print("✅ ALL PARITY CHECKS PASSED — \(pass) assertions across \(groupCounts.count) groups")
            return 0
        }
        print("❌ \(fail) FAILURES / \(pass + fail) assertions\n")
        for f in failures.prefix(60) { print("  • \(f)") }
        if failures.count > 60 { print("  … and \(failures.count - 60) more") }
        return 1
    }
}

// Golden directory: argv[1] override, else <repo>/Goldens relative to this source file.
let goldenDir: URL = {
    if CommandLine.arguments.count > 1 { return URL(fileURLWithPath: CommandLine.arguments[1]) }
    return URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()   // Sources/ParityRunner
        .deletingLastPathComponent()   // Sources
        .deletingLastPathComponent()   // repo root
        .appendingPathComponent("Goldens")
}()

func load<T: Decodable>(_ name: String, _ type: T.Type) -> T {
    let url = goldenDir.appendingPathComponent("\(name).json")
    guard let data = try? Data(contentsOf: url) else {
        fatalError("Missing golden file: \(url.path) — run tools/oracle/generate_goldens.php")
    }
    do { return try JSONDecoder().decode(T.self, from: data) }
    catch { fatalError("Decode \(name).json failed: \(error)") }
}

func loadOptional<T: Decodable>(_ name: String, _ type: T.Type) -> T? {
    let url = goldenDir.appendingPathComponent("\(name).json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    do { return try JSONDecoder().decode(T.self, from: data) }
    catch { fatalError("Decode \(name).json failed: \(error)") }
}

let h = Harness()

// MARK: - Decoding DTOs (match the golden JSON key names exactly)

struct EloCase: Decodable {
    let userRating: Int, puzzleRating: Int, isCorrect: Bool
    let expectedScore: Double, ratingChange: Int, newRating: Int
}
struct CompareMovesCase: Decodable { let correct: [String], user: [String], expected: Bool }
struct StreakTargetCase: Decodable { let currentStreak: Int, puzzleRating: Int, targetRating: Int; let theme: String? }
struct StreakStateDTO: Decodable, Equatable {
    let currentStreak: Int, bestStreak: Int, puzzleRating: Int; let pendingPuzzleId: Int?
}
struct StreakIncCase: Decodable { let `in`: StreakStateDTO; let nextPuzzleId: Int?; let out: StreakStateDTO }
struct StreakResetCase: Decodable { let `in`: StreakStateDTO; let out: StreakStateDTO }
struct DailyLimitCase: Decodable { let mode: String, usedToday: Int, isPremium: Bool, maxUses: Int, isAtLimit: Bool }
struct DailyGoalCase: Decodable { let solveDates: [String], today: String, streakDays: Int }

struct GEval: Decodable { let eval_cp: Int?, eval_mate: Int?, best_move_san: String? }
struct GMove: Decodable { let san: String?, color: String? }
struct GRME: Decodable { let move_index: Int, classification: String, cp_loss: Int; let best_move_san: String? }
struct GRGP: Decodable { let move_index: Int, eval_cp: Int; let eval_mate: Int? }
struct GRResult: Decodable {
    let whiteAccuracy: Double, blackAccuracy: Double
    let whiteClassifications: [String: Int], blackClassifications: [String: Int]
    let moveEvaluations: [GRME], evalGraph: [GRGP]
}
struct GameReviewCase: Decodable { let evaluations: [GEval], moves: [GMove?], result: GRResult }
struct ClassifyCase: Decodable { let cpLoss: Int, isBestMove: Bool, isBrilliant: Bool, expected: String }
struct TierCase: Decodable { let rating: Int, tier: String }
struct RushBest: Decodable { let submitted: Int; let stored: Int?; let best: Int }
struct RushLabel: Decodable { let mode: Int, label: String }
struct RushGolden: Decodable { let best: [RushBest]; let labels: [RushLabel] }

struct GPlayer: Decodable {
    let id: Int, name: String; let ncfp_rating: Int?; let seed: Int
    let score: Double, direct_encounter: Double; let buchholz: Int, sonneborn_berger: Int
    let wins: Int, draws: Int, losses: Int, byes: Int, white_games: Int, black_games: Int
    func toPlayer() -> TournamentPlayer {
        TournamentPlayer(id: id, name: name, ncfpRating: ncfp_rating, seed: seed, score: score,
                         directEncounter: direct_encounter, buchholz: buchholz, sonnebornBerger: sonneborn_berger,
                         wins: wins, draws: draws, losses: losses, byes: byes,
                         whiteGames: white_games, blackGames: black_games)
    }
}
struct GPair: Decodable, Equatable { let white: Int?, black: Int?, isBye: Bool }
struct GRPairing: Decodable { let white: Int?, black: Int?, isBye: Bool; let result: String? }
struct GRound: Decodable { let pairings: [GRPairing] }
struct SwissCase: Decodable { let label: String; let players: [GPlayer]; let rounds: [GRound]; let roundNumber: Int; let expected: [GPair] }
struct RRCase: Decodable { let label: String; let players: [GPlayer]; let roundNumber: Int; let expected: [GPair] }
struct GTB: Decodable { let id: Int, direct_encounter: Double, buchholz: Int, sonneborn_berger: Int }
struct TBCase: Decodable { let label: String; let players: [GPlayer]; let pairings: [GRPairing]; let expected: [GTB] }
struct StandingsCase: Decodable { let label: String; let players: [GPlayer]; let expectedOrder: [Int] }
struct GCand: Decodable { let id: Int, rating: Int; let themes: [String] }
struct GSel: Decodable { let candidate: Int?; let stage: String; let didReset: Bool }
struct ServingCase: Decodable { let label: String; let ladder: String; let pool: [GCand]; let center: Int; let window: Int; let theme: String?; let seen: [Int]; let expected: GSel }
struct ScoreOp: Decodable { let op: String, result: String }
struct ScoringCase: Decodable { let white_in: GPlayer, black_in: GPlayer; let ops: [ScoreOp]; let white_out: GPlayer, black_out: GPlayer }
struct GRoundOut: Decodable { let round: Int; let pairings: [GPair] }
struct ScenarioGolden: Decodable {
    let players: [GPlayer]; let total_rounds: Int
    let results: [String: [String: String]]
    let rounds_out: [GRoundOut]; let final_players: [GPlayer]
}

func toPairing(_ g: GRPairing) -> TournamentPairing {
    TournamentPairing(whitePlayerId: g.white, blackPlayerId: g.black, result: g.result ?? "pending", isBye: g.isBye)
}
func samePair(_ a: PairSpec, _ b: GPair) -> Bool { a.white == b.white && a.black == b.black && a.isBye == b.isBye }

// MARK: - 1. Rating

h.begin("rating")
for c in load("rating", [EloCase].self) {
    let out = PuzzleRatingEngine.evaluate(userRating: c.userRating, puzzleRating: c.puzzleRating, isCorrect: c.isCorrect)
    let ctx = "u\(c.userRating) p\(c.puzzleRating) ok=\(c.isCorrect)"
    h.check(h.approx(out.expectedScore, c.expectedScore, tol: 1e-9), "\(ctx) expected \(out.expectedScore) != \(c.expectedScore)")
    h.check(out.ratingChange == c.ratingChange, "\(ctx) change \(out.ratingChange) != \(c.ratingChange)")
    h.check(out.newRating == c.newRating, "\(ctx) new \(out.newRating) != \(c.newRating)")
}
h.begin("compare_moves")
for c in load("compare_moves", [CompareMovesCase].self) {
    let got = PuzzleRatingEngine.compareMoves(correct: c.correct, user: c.user)
    h.check(got == c.expected, "correct=\(c.correct) user=\(c.user) -> \(got) != \(c.expected)")
}

// MARK: - 2. Streak

h.begin("streak_target")
for c in load("streak_target", [StreakTargetCase].self) {
    let (r, t) = StreakEngine.target(currentStreak: c.currentStreak, puzzleRating: c.puzzleRating)
    h.check(r == c.targetRating, "cur=\(c.currentStreak) pr=\(c.puzzleRating) target \(r) != \(c.targetRating)")
    h.check(t == c.theme, "cur=\(c.currentStreak) theme \(String(describing: t)) != \(String(describing: c.theme))")
}
h.begin("streak_increment")
for c in load("streak_increment", [StreakIncCase].self) {
    let s = StreakEngine.State(currentStreak: c.in.currentStreak, bestStreak: c.in.bestStreak,
                               puzzleRating: c.in.puzzleRating, pendingPuzzleId: c.in.pendingPuzzleId)
    let out = StreakEngine.increment(s, nextPuzzleId: c.nextPuzzleId)
    h.check(out.currentStreak == c.out.currentStreak && out.bestStreak == c.out.bestStreak
            && out.puzzleRating == c.out.puzzleRating && out.pendingPuzzleId == c.out.pendingPuzzleId,
            "in=\(c.in) got (\(out.currentStreak),\(out.bestStreak),\(out.puzzleRating),\(String(describing: out.pendingPuzzleId))) != \(c.out)")
}
h.begin("streak_reset")
for c in load("streak_reset", [StreakResetCase].self) {
    let s = StreakEngine.State(currentStreak: c.in.currentStreak, bestStreak: c.in.bestStreak,
                               puzzleRating: c.in.puzzleRating, pendingPuzzleId: c.in.pendingPuzzleId)
    let out = StreakEngine.reset(s)
    h.check(out.currentStreak == c.out.currentStreak && out.bestStreak == c.out.bestStreak
            && out.puzzleRating == c.out.puzzleRating && out.pendingPuzzleId == c.out.pendingPuzzleId,
            "reset in=\(c.in) got != \(c.out)")
}

// MARK: - 3. Daily limits

h.begin("daily_limits")
for c in load("daily_limits", [DailyLimitCase].self) {
    h.check(DailyLimits.maxUses(for: c.mode) == c.maxUses, "\(c.mode) maxUses")
    let at = DailyLimits.isAtDailyLimit(mode: c.mode, usedToday: c.usedToday, isPremium: c.isPremium)
    h.check(at == c.isAtLimit, "\(c.mode) used=\(c.usedToday) prem=\(c.isPremium) -> \(at) != \(c.isAtLimit)")
}

// MARK: - 4. Daily goal

h.begin("daily_goal")
let iso = DateFormatter(); iso.dateFormat = "yyyy-MM-dd"; iso.timeZone = TimeZone(identifier: "UTC")
iso.calendar = DailyGoal.utcCalendar; iso.locale = Locale(identifier: "en_US_POSIX")
for c in load("daily_goal", [DailyGoalCase].self) {
    let dates = c.solveDates.compactMap { iso.date(from: $0) }
    h.check(dates.count == c.solveDates.count, "daily_goal \(c.today): \(c.solveDates.count - dates.count) unparseable date(s) dropped")
    guard let today = iso.date(from: c.today) else { h.check(false, "bad today \(c.today)"); continue }
    let got = DailyGoal.calculateStreakDays(solveDates: dates, today: today)
    h.check(got == c.streakDays, "dates=\(c.solveDates) today=\(c.today) -> \(got) != \(c.streakDays)")
}

// MARK: - 5. Game review

h.begin("game_review")
for (ci, c) in load("game_review", [GameReviewCase].self).enumerated() {
    let evals = c.evaluations.map { GameReview.Evaluation(evalCp: $0.eval_cp, evalMate: $0.eval_mate, bestMoveSan: $0.best_move_san) }
    let moves = c.moves.map { GameReview.Move(san: $0?.san, color: $0?.color) }
    let r = GameReview.review(evaluations: evals, moves: moves)
    h.check(h.approx(r.whiteAccuracy, c.result.whiteAccuracy, tol: 1e-4), "case\(ci) whiteAcc \(r.whiteAccuracy) != \(c.result.whiteAccuracy)")
    h.check(h.approx(r.blackAccuracy, c.result.blackAccuracy, tol: 1e-4), "case\(ci) blackAcc \(r.blackAccuracy) != \(c.result.blackAccuracy)")
    h.check(r.whiteClassifications == c.result.whiteClassifications, "case\(ci) whiteClass \(r.whiteClassifications) != \(c.result.whiteClassifications)")
    h.check(r.blackClassifications == c.result.blackClassifications, "case\(ci) blackClass \(r.blackClassifications) != \(c.result.blackClassifications)")
    h.check(r.moveEvaluations.count == c.result.moveEvaluations.count, "case\(ci) moveEval count \(r.moveEvaluations.count) != \(c.result.moveEvaluations.count)")
    for (a, b) in zip(r.moveEvaluations, c.result.moveEvaluations) {
        h.check(a.moveIndex == b.move_index && a.classification == b.classification && a.cpLoss == b.cp_loss && a.bestMoveSan == b.best_move_san,
                "case\(ci) me idx\(b.move_index): (\(a.classification),\(a.cpLoss)) != (\(b.classification),\(b.cp_loss))")
    }
    h.check(r.evalGraph.count == c.result.evalGraph.count, "case\(ci) graph count")
    for (a, b) in zip(r.evalGraph, c.result.evalGraph) {
        h.check(a.moveIndex == b.move_index && a.evalCp == b.eval_cp && a.evalMate == b.eval_mate,
                "case\(ci) graph idx\(b.move_index): cp\(a.evalCp) != \(b.eval_cp)")
    }
}

h.begin("classify")
for c in load("classify", [ClassifyCase].self) {
    let got = GameReview.classifyMove(cpLoss: c.cpLoss, isBestMove: c.isBestMove, isBrilliant: c.isBrilliant)
    h.check(got == c.expected, "cp\(c.cpLoss) best\(c.isBestMove) bril\(c.isBrilliant) -> \(got) != \(c.expected)")
}

h.begin("rating_tier")
for c in load("rating_tier", [TierCase].self) {
    h.check(RatingTier.classify(c.rating) == c.tier, "tier \(c.rating) -> \(RatingTier.classify(c.rating)) != \(c.tier)")
}

h.begin("rush")
let rush = load("rush", RushGolden.self)
for c in rush.best {
    h.check(PuzzleRush.bestScore(submitted: c.submitted, stored: c.stored) == c.best, "rushBest \(c.submitted)/\(String(describing: c.stored)) -> \(PuzzleRush.bestScore(submitted: c.submitted, stored: c.stored)) != \(c.best)")
}
for c in rush.labels {
    h.check(PuzzleRush.modeLabel(c.mode) == c.label, "rushLabel \(c.mode) -> \(PuzzleRush.modeLabel(c.mode)) != \(c.label)")
}

// Perft — chess move-generation correctness against known node counts.
h.begin("perft")
let perftCases: [(String, [Int])] = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [20, 400, 8902, 197281]),
    ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]),   // Kiwipete
    ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]),                          // position 3
    ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]),           // position 4
    ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]),                // position 5
]
for (fen, expected) in perftCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    for (i, exp) in expected.enumerated() {
        let got = perft(pos, i + 1)
        h.check(got == exp, "perft(\(fen.prefix(24))… d\(i + 1)) = \(got) != \(exp)")
    }
}

// Chess AI — the strongest coach (deterministic: no blunder/noise) must find forced tactics.
h.begin("chess_ai")
var aiRng = SystemRandomNumberGenerator()
let coachPogi = Coaches.all.last!
for (fen, expUci) in [
    ("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "a1a8"),        // back-rank mate-in-1 (Ra8#)
    ("4k3/8/8/8/3q4/8/3Q4/4K3 w - - 0 1", "d2d4"),        // win the free queen (Qxd4)
] {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let m = ChessAI.bestMove(pos, persona: coachPogi, using: &aiRng)
    h.check(m?.uci == expUci, "AI \(fen.prefix(18))… -> \(m?.uci ?? "nil") != \(expUci)")
}

// MARK: - 6. Tournaments

h.begin("swiss_pairings")
for c in load("swiss_pairings", [SwissCase].self) {
    let players = c.players.map { $0.toPlayer() }
    let rounds = c.rounds.enumerated().map { TournamentRound(roundNumber: $0.offset + 1, pairings: $0.element.pairings.map(toPairing)) }
    let got = TournamentEngine.generateSwissPairings(players: players, rounds: rounds, roundNumber: c.roundNumber)
    h.check(got.count == c.expected.count, "\(c.label) count \(got.count) != \(c.expected.count)")
    for (a, b) in zip(got, c.expected) { h.check(samePair(a, b), "\(c.label) pair (\(String(describing: a.white)),\(String(describing: a.black)),\(a.isBye)) != (\(String(describing: b.white)),\(String(describing: b.black)),\(b.isBye))") }
}

h.begin("rr_pairings")
for c in load("rr_pairings", [RRCase].self) {
    let players = c.players.map { $0.toPlayer() }
    let got = TournamentEngine.generateRoundRobinPairings(players: players, roundNumber: c.roundNumber)
    h.check(got.count == c.expected.count, "\(c.label) count \(got.count) != \(c.expected.count)")
    for (a, b) in zip(got, c.expected) { h.check(samePair(a, b), "\(c.label) pair mismatch \(String(describing: a.white))/\(String(describing: a.black)) vs \(String(describing: b.white))/\(String(describing: b.black))") }
}

h.begin("tiebreakers")
for c in load("tiebreakers", [TBCase].self) {
    let players = c.players.map { $0.toPlayer() }
    let pairings = c.pairings.map(toPairing)
    let got = TournamentEngine.recalculateTiebreakers(players: players, pairings: pairings)
    h.check(got.count == c.expected.count, "\(c.label) tb count \(got.count) != \(c.expected.count)")
    let byId = Dictionary(uniqueKeysWithValues: got.map { ($0.id, $0) })
    for e in c.expected {
        guard let p = byId[e.id] else { h.check(false, "\(c.label) missing id \(e.id)"); continue }
        h.check(h.approx(p.directEncounter, e.direct_encounter, tol: 1e-9), "\(c.label) id\(e.id) de \(p.directEncounter) != \(e.direct_encounter)")
        h.check(p.buchholz == e.buchholz, "\(c.label) id\(e.id) bh \(p.buchholz) != \(e.buchholz)")
        h.check(p.sonnebornBerger == e.sonneborn_berger, "\(c.label) id\(e.id) sb \(p.sonnebornBerger) != \(e.sonneborn_berger)")
    }
}

h.begin("standings")
for c in load("standings", [StandingsCase].self) {
    let players = c.players.map { $0.toPlayer() }
    let order = TournamentEngine.standingsSorted(players).map { $0.id }
    h.check(order == c.expectedOrder, "\(c.label) order \(order) != \(c.expectedOrder)")
}

h.begin("serving")
for c in load("serving", [ServingCase].self) {
    let pool = c.pool.map { PuzzleServing.Candidate(id: $0.id, rating: $0.rating, themes: $0.themes) }
    let seen = Set(c.seen)
    let sel: PuzzleServing.Selection
    switch c.ladder {
    case "closest": sel = PuzzleServing.serveClosest(pool, center: c.center, window: c.window, theme: c.theme, seen: seen)
    case "random": sel = PuzzleServing.serveRandom(pool, center: c.center, window: c.window, theme: c.theme, seen: seen)
    case "thematic": sel = PuzzleServing.serveThematic(pool, center: c.center, window: c.window, theme: c.theme, seen: seen)
    default: h.check(false, "\(c.label) unknown ladder \(c.ladder)"); continue
    }
    h.check(sel.candidate?.id == c.expected.candidate, "\(c.label) candidate \(String(describing: sel.candidate?.id)) != \(String(describing: c.expected.candidate))")
    h.check(sel.stage.rawValue == c.expected.stage, "\(c.label) stage \(sel.stage.rawValue) != \(c.expected.stage)")
    h.check(sel.didReset == c.expected.didReset, "\(c.label) didReset \(sel.didReset) != \(c.expected.didReset)")
}

h.begin("scoring")
@MainActor
func samePlayerScore(_ a: TournamentPlayer, _ e: GPlayer, _ ctx: String) {
    h.check(h.approx(a.score, e.score, tol: 1e-9) && a.wins == e.wins && a.draws == e.draws && a.losses == e.losses
            && a.whiteGames == e.white_games && a.blackGames == e.black_games,
            "\(ctx): (s\(a.score) w\(a.wins) d\(a.draws) l\(a.losses) wg\(a.whiteGames) bg\(a.blackGames)) != (s\(e.score) w\(e.wins) d\(e.draws) l\(e.losses) wg\(e.white_games) bg\(e.black_games))")
}
for (ci, c) in load("scoring", [ScoringCase].self).enumerated() {
    var w = c.white_in.toPlayer(), b = c.black_in.toPlayer()
    for o in c.ops {
        if o.op == "apply" { TournamentEngine.applyResult(white: &w, black: &b, result: o.result) }
        else { TournamentEngine.reverseResult(white: &w, black: &b, result: o.result) }
    }
    samePlayerScore(w, c.white_out, "scoring#\(ci) white")
    samePlayerScore(b, c.black_out, "scoring#\(ci) black")
}

// Direct checks for helpers/constants not covered by golden scenarios.
h.begin("misc")
h.check(DailyGoal.dailyTarget == 10, "dailyTarget \(DailyGoal.dailyTarget) != 10")
for (pc, prem, exp) in [(2, false, 1), (4, false, 3), (5, false, 3), (5, true, 5), (8, true, 7), (6, false, 3), (1, false, 0), (0, true, 0)] {
    let got = TournamentEngine.roundRobinRounds(playerCount: pc, isPremium: prem)
    h.check(got == exp, "roundRobinRounds(\(pc),prem=\(prem)) = \(got) != \(exp)")
}
for (req, prem, exp) in [(nil, false, 3), (5, false, 3), (10, true, 10), (3, false, 3), (nil, true, 3), (30, true, 30), (50, true, 30), (1, false, 1)] as [(Int?, Bool, Int)] {
    let got = TournamentEngine.swissTotalRounds(requested: req, isPremium: prem)
    h.check(got == exp, "swissTotalRounds(\(String(describing: req)),prem=\(prem)) = \(got) != \(exp)")
}
do {
    let cal = DailyGoal.utcCalendar
    let d = cal.date(from: DateComponents(year: 2026, month: 7, day: 23, hour: 12))!
    h.check(DailyLimits.dayKey(for: d, calendar: cal) == "2026-07-23", "dayKey mid-day")
    let midnight = cal.date(from: DateComponents(year: 2026, month: 1, day: 5, hour: 0))!
    h.check(DailyLimits.dayKey(for: midnight, calendar: cal) == "2026-01-05", "dayKey midnight zero-pad")
}

// End-to-end orchestrators (mirror generatePairings + submitResult exactly)

func runSwissScenario(_ playersList: [TournamentPlayer], totalRounds: Int, results: [String: [String: String]])
    -> (roundsOut: [(round: Int, pairings: [PairSpec])], finalPlayers: [TournamentPlayer]) {
    var players = Dictionary(uniqueKeysWithValues: playersList.map { ($0.id, $0) })
    let idOrder = playersList.map { $0.id }
    func current() -> [TournamentPlayer] { idOrder.map { players[$0]! } }
    func award(_ id: Int?) { guard let id, var p = players[id] else { return }; TournamentEngine.awardBye(&p); players[id] = p }
    func apply(_ w: Int?, _ b: Int?, _ res: String) {
        guard let w, let b, var wp = players[w], var bp = players[b] else { return }
        TournamentEngine.applyResult(white: &wp, black: &bp, result: res); players[w] = wp; players[b] = bp
    }
    var priorRounds: [TournamentRound] = []
    var roundsOut: [(Int, [PairSpec])] = []
    for r in 1...totalRounds {
        let pairs = TournamentEngine.generateSwissPairings(players: current(), rounds: priorRounds, roundNumber: r)
        roundsOut.append((r, pairs))
        for pair in pairs where pair.isBye { award(pair.white ?? pair.black) }
        var board = 1
        for pair in pairs { if !pair.isBye { apply(pair.white, pair.black, results[String(r)]?[String(board)] ?? "1-0") }; board += 1 }
        var persist: [TournamentPairing] = []; board = 1
        for pair in pairs {
            let res = pair.isBye ? "bye" : (results[String(r)]?[String(board)] ?? "1-0")
            persist.append(TournamentPairing(whitePlayerId: pair.white, blackPlayerId: pair.black, result: res, isBye: pair.isBye)); board += 1
        }
        priorRounds.append(TournamentRound(roundNumber: r, pairings: persist))
        let allPairings = priorRounds.flatMap { $0.pairings }
        for rp in TournamentEngine.recalculateTiebreakers(players: current(), pairings: allPairings) { players[rp.id] = rp }
    }
    return (roundsOut.map { (round: $0.0, pairings: $0.1) }, TournamentEngine.standingsSorted(current()))
}

func runRRScenario(_ playersList: [TournamentPlayer], totalRounds: Int, results: [String: [String: String]])
    -> (roundsOut: [(round: Int, pairings: [PairSpec])], finalPlayers: [TournamentPlayer]) {
    var players = Dictionary(uniqueKeysWithValues: playersList.map { ($0.id, $0) })
    let idOrder = playersList.map { $0.id }
    func current() -> [TournamentPlayer] { idOrder.map { players[$0]! } }
    func award(_ id: Int?) { guard let id, var p = players[id] else { return }; TournamentEngine.awardBye(&p); players[id] = p }
    func apply(_ w: Int?, _ b: Int?, _ res: String) {
        guard let w, let b, var wp = players[w], var bp = players[b] else { return }
        TournamentEngine.applyResult(white: &wp, black: &bp, result: res); players[w] = wp; players[b] = bp
    }
    var allRounds: [Int: [PairSpec]] = [:]
    for r in 1...totalRounds { allRounds[r] = TournamentEngine.generateRoundRobinPairings(players: current(), roundNumber: r) }
    let roundsOut = (1...totalRounds).map { (round: $0, pairings: allRounds[$0]!) }
    struct Rec { let round: Int; let board: Int; let white: Int?; let black: Int?; let isBye: Bool; var result: String }
    var persistAll: [Rec] = []
    for r in 1...totalRounds { var board = 1; for pair in allRounds[r]! { persistAll.append(Rec(round: r, board: board, white: pair.white, black: pair.black, isBye: pair.isBye, result: pair.isBye ? "bye" : "pending")); board += 1 } }
    for pair in allRounds[1]! where pair.isBye { award(pair.white ?? pair.black) }
    for r in 1...totalRounds {
        var board = 1
        for pair in allRounds[r]! {
            if !pair.isBye {
                let res = results[String(r)]?[String(board)] ?? "1-0"
                apply(pair.white, pair.black, res)
                for i in persistAll.indices where persistAll[i].round == r && persistAll[i].board == board { persistAll[i].result = res }
            }
            board += 1
        }
        let allForRecalc = persistAll.map { TournamentPairing(whitePlayerId: $0.white, blackPlayerId: $0.black, result: $0.result, isBye: $0.isBye) }
        for rp in TournamentEngine.recalculateTiebreakers(players: current(), pairings: allForRecalc) { players[rp.id] = rp }
        if r < totalRounds { for pair in allRounds[r + 1]! where pair.isBye { award(pair.white ?? pair.black) } }
    }
    return (roundsOut, TournamentEngine.standingsSorted(current()))
}

@MainActor
func checkScenario(_ group: String, _ label: String, _ g: ScenarioGolden, _ out: (roundsOut: [(round: Int, pairings: [PairSpec])], finalPlayers: [TournamentPlayer])) {
    let name = label
    h.begin(group)
    h.check(out.roundsOut.count == g.rounds_out.count, "\(name) round count")
    for (ro, go) in zip(out.roundsOut, g.rounds_out) {
        h.check(ro.round == go.round, "\(name) round num")
        h.check(ro.pairings.count == go.pairings.count, "\(name) r\(go.round) pair count \(ro.pairings.count) != \(go.pairings.count)")
        for (a, b) in zip(ro.pairings, go.pairings) { h.check(samePair(a, b), "\(name) r\(go.round) pair (\(String(describing: a.white)),\(String(describing: a.black)),\(a.isBye)) != (\(String(describing: b.white)),\(String(describing: b.black)),\(b.isBye))") }
    }
    h.check(out.finalPlayers.count == g.final_players.count, "\(name) final count")
    for (a, e) in zip(out.finalPlayers, g.final_players) {
        h.check(a.id == e.id, "\(name) standings order id \(a.id) != \(e.id)")
        h.check(h.approx(a.score, e.score, tol: 1e-9), "\(name) id\(e.id) score \(a.score) != \(e.score)")
        h.check(h.approx(a.directEncounter, e.direct_encounter, tol: 1e-9), "\(name) id\(e.id) de \(a.directEncounter) != \(e.direct_encounter)")
        h.check(a.buchholz == e.buchholz, "\(name) id\(e.id) bh \(a.buchholz) != \(e.buchholz)")
        h.check(a.sonnebornBerger == e.sonneborn_berger, "\(name) id\(e.id) sb \(a.sonnebornBerger) != \(e.sonneborn_berger)")
        h.check(a.wins == e.wins && a.draws == e.draws && a.losses == e.losses, "\(name) id\(e.id) wdl (\(a.wins),\(a.draws),\(a.losses)) != (\(e.wins),\(e.draws),\(e.losses))")
        h.check(a.byes == e.byes, "\(name) id\(e.id) byes \(a.byes) != \(e.byes)")
        h.check(a.whiteGames == e.white_games && a.blackGames == e.black_games, "\(name) id\(e.id) colors (\(a.whiteGames),\(a.blackGames)) != (\(e.white_games),\(e.black_games))")
    }
}

let swissG = load("swiss_scenario", ScenarioGolden.self)
checkScenario("swiss_scenario", "swiss_scenario", swissG, runSwissScenario(swissG.players.map { $0.toPlayer() }, totalRounds: swissG.total_rounds, results: swissG.results))

let rrG = load("rr_scenario", ScenarioGolden.self)
checkScenario("rr_scenario", "rr_scenario", rrG, runRRScenario(rrG.players.map { $0.toPlayer() }, totalRounds: rrG.total_rounds, results: rrG.results))

// MARK: - 7. Randomized differential batches (broad coverage; identical inputs both sides)

if let cases = loadOptional("rating_random", [EloCase].self) {
    h.begin("rating_random")
    for c in cases {
        let out = PuzzleRatingEngine.evaluate(userRating: c.userRating, puzzleRating: c.puzzleRating, isCorrect: c.isCorrect)
        h.check(h.approx(out.expectedScore, c.expectedScore, tol: 1e-9) && out.ratingChange == c.ratingChange && out.newRating == c.newRating,
                "u\(c.userRating) p\(c.puzzleRating) ok=\(c.isCorrect) -> (\(out.ratingChange),\(out.newRating)) != (\(c.ratingChange),\(c.newRating))")
    }
}
if let cases = loadOptional("daily_goal_random", [DailyGoalCase].self) {
    h.begin("daily_goal_random")
    for c in cases {
        let dates = c.solveDates.compactMap { iso.date(from: $0) }
        h.check(dates.count == c.solveDates.count, "daily_goal_random \(c.today): unparseable date dropped")
        guard let today = iso.date(from: c.today) else { h.check(false, "bad today"); continue }
        let got = DailyGoal.calculateStreakDays(solveDates: dates, today: today)
        h.check(got == c.streakDays, "today=\(c.today) n=\(c.solveDates.count) -> \(got) != \(c.streakDays)")
    }
}
if let cases = loadOptional("game_review_random", [GameReviewCase].self) {
    h.begin("game_review_random")
    for (ci, c) in cases.enumerated() {
        let evals = c.evaluations.map { GameReview.Evaluation(evalCp: $0.eval_cp, evalMate: $0.eval_mate, bestMoveSan: $0.best_move_san) }
        let moves = c.moves.map { GameReview.Move(san: $0?.san, color: $0?.color) }
        let r = GameReview.review(evaluations: evals, moves: moves)
        h.check(h.approx(r.whiteAccuracy, c.result.whiteAccuracy, tol: 1e-3), "g\(ci) wAcc \(r.whiteAccuracy) != \(c.result.whiteAccuracy)")
        h.check(h.approx(r.blackAccuracy, c.result.blackAccuracy, tol: 1e-3), "g\(ci) bAcc \(r.blackAccuracy) != \(c.result.blackAccuracy)")
        h.check(r.whiteClassifications == c.result.whiteClassifications, "g\(ci) wClass \(r.whiteClassifications) != \(c.result.whiteClassifications)")
        h.check(r.blackClassifications == c.result.blackClassifications, "g\(ci) bClass \(r.blackClassifications) != \(c.result.blackClassifications)")
        h.check(r.moveEvaluations.count == c.result.moveEvaluations.count, "g\(ci) me count")
        for (a, b) in zip(r.moveEvaluations, c.result.moveEvaluations) {
            h.check(a.moveIndex == b.move_index && a.classification == b.classification && a.cpLoss == b.cp_loss && a.bestMoveSan == b.best_move_san, "g\(ci) me idx\(b.move_index) (\(a.classification),\(a.cpLoss)) != (\(b.classification),\(b.cp_loss))")
        }
        h.check(r.evalGraph.count == c.result.evalGraph.count, "g\(ci) graph count \(r.evalGraph.count) != \(c.result.evalGraph.count)")
        for (a, b) in zip(r.evalGraph, c.result.evalGraph) {
            h.check(a.moveIndex == b.move_index && a.evalCp == b.eval_cp && a.evalMate == b.eval_mate, "g\(ci) graph idx\(b.move_index) \(a.evalCp) != \(b.eval_cp)")
        }
    }
}
if let scenarios = loadOptional("swiss_random", [ScenarioGolden].self) {
    for (i, g) in scenarios.enumerated() {
        checkScenario("swiss_random", "swiss_random#\(i)", g, runSwissScenario(g.players.map { $0.toPlayer() }, totalRounds: g.total_rounds, results: g.results))
    }
}
if let scenarios = loadOptional("rr_random", [ScenarioGolden].self) {
    for (i, g) in scenarios.enumerated() {
        checkScenario("rr_random", "rr_random#\(i)", g, runRRScenario(g.players.map { $0.toPlayer() }, totalRounds: g.total_rounds, results: g.results))
    }
}

// PHPCompat differential (validates phpRegularCompare / phpStringIsTruthy against real PHP)
struct NameCmpCase: Decodable { let a: String, b: String, cmp: Int }
struct TruthyCase: Decodable { let s: String, truthy: Bool }
if let cases = loadOptional("phpcompat_names", [NameCmpCase].self) {
    h.begin("phpcompat_names")
    for c in cases {
        let got = phpRegularCompare(c.a, c.b)
        let sign = got < 0 ? -1 : (got > 0 ? 1 : 0)
        h.check(sign == c.cmp, "cmp(\(c.a),\(c.b)) = \(sign) != \(c.cmp)")
    }
}
if let cases = loadOptional("phpcompat_truthy", [TruthyCase].self) {
    h.begin("phpcompat_truthy")
    for c in cases { h.check(phpStringIsTruthy(c.s) == c.truthy, "truthy(\(c.s)) = \(phpStringIsTruthy(c.s)) != \(c.truthy)") }
}

// MARK: - Done

// Every mandatory group must contribute at least its expected floor of assertions
// (guards against vacuous passes AND truncated goldens). Floors are the deterministic
// current counts; bump when cases are intentionally added.
h.requireMinCounts([
    "rating": 390, "compare_moves": 6, "streak_target": 36, "streak_increment": 4, "streak_reset": 2,
    "daily_limits": 168, "daily_goal": 18, "game_review": 47, "classify": 88, "rating_tier": 14, "rush": 12,
    "perft": 17, "chess_ai": 2,
    "swiss_pairings": 27, "rr_pairings": 29, "tiebreakers": 13, "standings": 1, "serving": 45,
    "scoring": 12, "misc": 19, "swiss_scenario": 65, "rr_scenario": 67,
    "phpcompat_names": 1089, "phpcompat_truthy": 14,
    "rating_random": 3000, "daily_goal_random": 1000, "game_review_random": 6114,
    "swiss_random": 9814, "rr_random": 8164,
])

exit(Int32(h.summary()))
