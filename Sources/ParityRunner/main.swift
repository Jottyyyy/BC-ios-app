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

/// Raw text from the goldens directory — the ECO book ships as TSV, not JSON, so that the real
/// `OpeningBook(tsv:)` parser is exercised against the real file.
func loadText(_ name: String) -> String? {
    let url = goldenDir.appendingPathComponent(name)
    return try? String(contentsOf: url, encoding: .utf8)
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

// SAN parsing — the inverse of san(for:), against the REAL App\Services\ChessEngine.
// Every ply of a 1-in-12 sample of the vendored ECO lines plus hand-built cases for what openings
// never reach. Three assertions per case: the parsed UCI, the resulting six-field FEN, and the
// position key. `src` is the oracle's provenance tag, e.g. "eco:B90:… Najdorf Variation#9".
struct SanParseCase: Decodable {
    let fenBefore: String, san: String, uci: String, fenAfter: String, key: String, src: String
}
h.begin("san_parse")
for c in load("san_parse", [SanParseCase].self) {
    guard let pos = ChessPosition(fen: c.fenBefore) else { h.check(false, "\(c.src) bad fenBefore"); continue }
    guard let m = pos.move(forSAN: c.san) else { h.check(false, "\(c.src) move(forSAN: \"\(c.san)\") -> nil"); continue }
    h.check(m.uci == c.uci, "\(c.src) uci \(m.uci) != \(c.uci)")
    let after = pos.makeMove(m)
    h.check(after.fen == c.fenAfter, "\(c.src) fen \(after.fen) != \(c.fenAfter)")
    h.check(after.positionKey == c.key, "\(c.src) key \(after.positionKey) != \(c.key)")
}

// Notation edge cases the oracle cannot supply: the tolerant spellings real PGN exporters emit,
// UCI parsing, and rejection. Hardcoded like `perft` and `chess_ai` — there is no server
// counterpart to generate them. Labels match the assertions in web-demo/js/engine.js so the two
// tables can be diffed by eye.
h.begin("notation_extra")
let oneKnight = "7k/8/8/8/8/8/8/1N2K3 w - - 0 1"      // only b1 can reach d2
let twoKnights = "7k/8/8/8/8/8/8/1N1K1N2 w - - 0 1"   // b1 AND f1 reach d2 — genuinely ambiguous
let pawnCapture = "7k/8/8/3p4/4P3/8/8/7K w - - 0 1"
let promotion = "8/P6k/8/8/8/8/6K1/8 w - - 0 1"
let castling = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
// Explicit element types throughout, like `perftCases` above: a bare 20-element literal of tuples
// is the classic way to make the Swift type-checker give up on an expression.
let sanAccept: [(String, String, String)] = [
    (oneKnight, "Nd2", "b1d2"),                       // minimal — what we generate
    (oneKnight, "Nbd2", "b1d2"),                      // over-disambiguated by file
    (oneKnight, "N1d2", "b1d2"),                      // over-disambiguated by rank
    (oneKnight, "Nb1d2", "b1d2"),                     // long algebraic
    (oneKnight, "Nb1-d2", "b1d2"),                    // long algebraic with a dash
    (twoKnights, "Nbd2", "b1d2"),                     // real disambiguation still works
    (twoKnights, "Nfd2", "f1d2"),
    (pawnCapture, "exd5", "e4d5"),
    (pawnCapture, "ed5", "e4d5"),                     // 'x' omitted
    (pawnCapture, "e4xd5", "e4d5"),                   // long algebraic capture
    (promotion, "a8=Q", "a7a8q"),
    (promotion, "a8Q", "a7a8q"),                      // '=' omitted
    (promotion, "a8(Q)", "a7a8q"),                    // parenthesised
    (promotion, "a8=q", "a7a8q"),                     // lowercase promotion letter
    (promotion, "a8=N", "a7a8n"),                     // underpromotion
    (promotion, "a8", "a7a8q"),                       // bare — defaults to queen
    (castling, "O-O", "e1g1"),
    (castling, "0-0-0", "e1c1"),                      // zero-spelled
    (castling, "O-O+", "e1g1"),                       // suffixes are stripped
    (castling, "O-O!?", "e1g1"),
]
for (fen, san, expected) in sanAccept {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let got = pos.move(forSAN: san)?.uci
    h.check(got == expected, "parseSAN \"\(san)\" -> \(got ?? "nil") != \(expected)")
}
let sanReject: [(String, String, String)] = [
    (ChessPosition.startFEN, "zz9", "garbage"),
    (ChessPosition.startFEN, "e5", "an illegal move"),
    (ChessPosition.startFEN, "", "the empty string"),
    (ChessPosition.startFEN, "   ", "whitespace only"),
    (twoKnights, "Nd2", "an ambiguous move"),
]
for (fen, san, why) in sanReject {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let got = pos.move(forSAN: san)
    h.check(got == nil, "parseSAN rejects \(why): \"\(san)\" -> \(got?.uci ?? "nil")")
}
// "" means the parse must fail.
let uciCases: [(String, String, String)] = [
    (ChessPosition.startFEN, "e2e4", "e2e4"),
    (promotion, "a7a8q", "a7a8q"),
    (promotion, "a7a8N", "a7a8n"),                    // uppercase promotion letter
    (ChessPosition.startFEN, "e2e5", ""),             // illegal
    (ChessPosition.startFEN, "e2e", ""),              // too short
    (ChessPosition.startFEN, "z9e4", ""),             // bad square
    (promotion, "a7a8k", ""),                         // a king is not a promotion target
]
for (fen, uci, expected) in uciCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let got = pos.move(forUCI: uci)?.uci ?? ""
    h.check(got == expected, "parseUCI \"\(uci)\" -> \(got.isEmpty ? "nil" : got) != \(expected.isEmpty ? "nil" : expected)")
}

// Draw rules and the position key. Also hardcoded: App\Services\ChessEngine explicitly skips
// check/stalemate/fifty-move/repetition, so there is nothing on the server to oracle against.
// Expected values are hand-reasoned, not copied from the JS twin's output — the two languages
// assert independent expectations of the same chess facts.
h.begin("draw_rules")
let materialCases: [(String, Bool, String)] = [
    ("8/8/4k3/8/8/3K4/8/8 w - - 0 1", true, "K vs K"),
    ("8/8/4k3/8/8/3K1B2/8/8 w - - 0 1", true, "K+B vs K"),
    ("8/8/4k3/8/8/3K1N2/8/8 w - - 0 1", true, "K+N vs K"),
    ("8/4b3/4k3/8/8/3K1B2/8/8 w - - 0 1", false, "K+B vs K+B on opposite colours (e7 dark, f3 light)"),
    ("8/5b2/4k3/8/8/3K1B2/8/8 w - - 0 1", true, "K+B vs K+B on the same colour (f7 and f3 both light)"),
    ("8/8/4k3/8/8/3K1NN1/8/8 w - - 0 1", false, "K+N+N vs K is NOT insufficient"),
    ("8/8/4k3/8/8/3K1B1N/8/8 w - - 0 1", false, "K+B+N vs K can mate"),
    ("8/8/4k3/8/8/3K1P2/8/8 w - - 0 1", false, "a pawn is sufficient"),
    ("8/8/4k3/8/8/3K1R2/8/8 w - - 0 1", false, "a rook is sufficient"),
    ("8/8/4k3/8/8/3K1Q2/8/8 w - - 0 1", false, "a queen is sufficient"),
    (ChessPosition.startFEN, false, "the start position is not a material draw"),
]
for (fen, expected, why) in materialCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    h.check(pos.hasInsufficientMaterial == expected, "insufficientMaterial: \(why)")
}
let fiftyCases: [(String, Bool, String)] = [
    ("7k/8/8/8/8/8/8/R5K1 w - - 99 60", false, "fifty-move at 99 halfmoves"),
    ("7k/8/8/8/8/8/8/R5K1 w - - 100 60", true, "fifty-move at 100 halfmoves"),
    ("7k/8/8/8/8/8/8/R5K1 w - - 101 60", true, "fifty-move past 100 halfmoves"),
]
for (fen, expected, why) in fiftyCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    h.check(pos.isFiftyMoveDraw == expected, why)
}
let startKey = ChessPosition.start().positionKey
h.check(startKey == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "positionKey is the 4-field FEN")
h.check(ChessRules.repetitionCount([startKey, startKey], of: startKey) == 2, "repetitionCount counts occurrences")
h.check(ChessRules.isThreefold([startKey, startKey], of: startKey) == false, "two occurrences is not threefold")
h.check(ChessRules.isThreefold([startKey, startKey, startKey], of: startKey) == true, "three occurrences is threefold")
let epKeyCases: [(String, String, String)] = [
    ("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "-", "an uncapturable ep square is cleared"),
    ("rnbqkbnr/pp2pppp/8/2ppP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3", "d6", "a capturable ep square is kept"),
    ("rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3", "e3", "a capturable ep square is kept (dxe3)"),
]
for (fen, expectedEp, why) in epKeyCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let got = String(pos.positionKey.split(separator: " ")[3])
    h.check(got == expectedEp, "\(why): ep \(got) != \(expectedEp)")
}
let terminalCases: [(String, TerminalKind, TerminalReason, String)] = [
    ("R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1", .checkmate, .checkmate, "checkmate"),
    ("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", .draw, .stalemate, "stalemate"),
    ("8/8/4k3/8/8/3K4/8/8 w - - 0 1", .draw, .insufficient, "a material draw"),
    ("7k/8/8/8/8/8/8/R5K1 w - - 100 60", .draw, .fifty, "the fifty-move rule"),
]
for (fen, kind, reason, why) in terminalCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let out = pos.terminalOutcome()
    h.check(out.kind == kind && out.reason == reason,
            "terminalOutcome \(why): \(out.kind.rawValue)/\(out.reason?.rawValue ?? "nil") != \(kind.rawValue)/\(reason.rawValue)")
}
if let mated = ChessPosition(fen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1") {
    h.check(mated.terminalOutcome().winner == .white, "terminalOutcome names the winner")
}
h.check(ChessPosition.start().terminalOutcome().kind == .ongoing, "the start position is ongoing")
h.check(ChessPosition.start().terminalOutcome(historyKeys: [startKey, startKey, startKey]).reason == .repetition,
        "terminalOutcome detects threefold repetition")

// Move tree — structural invariants, plus the exact flatten() rows for one fixed PGN. That last
// assertion is the highest-value cross-language check in the feature: the identical table is
// asserted by web-demo/js/movetree.js, so the two implementations cannot silently disagree about
// traversal order, nesting depth or PGN move numbering.
h.begin("movetree")
if let t = MoveTree() {
    h.check(t.root.children.isEmpty, "a new tree has no moves")
    h.check(t.current === t.root, "the cursor starts at the root")
    h.check(t.root.ply == 0, "the root is ply 0")
    h.check(t.root.fenAfter == ChessPosition.startFEN, "the root holds the start position")
    let first = t.add(san: "e4")
    h.check(first?.created == true, "add(san:) creates a node")
    h.check(first?.node.uci == "e2e4", "the node carries the uci")
    h.check(t.add(san: "zz9") == nil, "add(san:) rejects unparseable input")
    t.goToStart()
    let again = t.add(san: "e4")
    h.check(again?.created == false, "replaying an existing move does not create a node")
    h.check(t.root.children.count == 1, "the root still has exactly one child")
    t.goToStart()
    let d4 = t.add(san: "d4")
    h.check(t.root.children.count == 2, "a different move branches")
    h.check(t.root.children[0].san == "e4", "the first move played stays the main line")
    if let node = d4?.node {
        h.check(t.promote(node), "promote swaps with children[0]")
        h.check(t.root.children[0].san == "d4", "the promoted move is now the main line")
        h.check(t.promote(t.root.children[0]) == false, "promoting the main line is a no-op")
        h.check(t.remove(node) == 1, "remove reports the subtree size")
        h.check(t.root.children.count == 1, "the variation is gone")
    }
}
h.check(MoveTree(initialFEN: "not a fen") == nil, "MoveTree rejects a bad FEN")
if let t2 = MoveTree() {
    for s in ["e4", "e5", "Nf3", "Nc6"] { t2.add(san: s) }
    let deep = t2.current
    h.check(MoveTree.path(to: deep) == [0, 0, 0, 0], "path(to:) yields child indices")
    h.check(t2.node(atPath: [0, 0, 0, 0]) === deep, "node(atPath:) round-trips")
    h.check(t2.node(atPath: [0, 0, 9]) == nil, "node(atPath:) returns nil for a bad path")
    h.check(t2.mainlineSANs() == ["e4", "e5", "Nf3", "Nc6"], "mainlineSANs follows children[0]")
    h.check(MoveTree.line(to: deep).count == 5, "line(to:) includes the root")
    h.check(MoveTree.historyKeys(to: deep).count == 5, "historyKeys includes the root")
    h.check(MoveTree.historyKeys(to: deep).first == ChessPosition.start().positionKey,
            "the first history key is the start position")
    t2.goToStart()
    h.check(t2.goForward().san == "e4", "goForward follows the main line")
    t2.goBack(); t2.goBack()
    h.check(t2.current === t2.root, "goBack at the root is a no-op")
    h.check(t2.goToEnd().san == "Nc6", "goToEnd reaches the leaf")
}
// The fixed PGN. Expected rows are copied from the JS twin's output, which was inspected by hand.
let flattenSource = "1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 3. Bb5 *"
let expectedRows: [(Int, String, String)] = [
    (0, "1.", "e4"),
    (0, "", "e5"),
    (1, "1...", "c5"),
    (1, "2.", "Nf3"),
    (1, "", "d6"),
    (0, "2.", "Nf3"),
    (0, "", "Nc6"),
    (0, "3.", "Bb5"),
]
if let g = PGN.parseFirst(flattenSource) {
    g.tree.goToEnd()
    let rows = g.tree.flatten()
    h.check(rows.count == expectedRows.count, "flatten row count \(rows.count) != \(expectedRows.count)")
    if rows.count == expectedRows.count {
        for (i, want) in expectedRows.enumerated() {
            let got = rows[i]
            h.check(got.depth == want.0 && got.numberText == want.1 && got.san == want.2,
                    "flatten row \(i): (\(got.depth),\"\(got.numberText)\",\"\(got.san)\") != (\(want.0),\"\(want.1)\",\"\(want.2)\")")
        }
    }
    h.check(rows.filter { $0.isCurrent }.count == 1, "exactly one row is current")
    h.check(rows.last?.isCurrent == true, "the last main-line move is current after goToEnd")
    h.check(rows.filter { $0.isOnPath }.count == 5, "the path back to the root is marked")
    h.check(rows[2].parentID == rows[0].id, "parentID links the variation to its branch point")
} else {
    h.check(false, "the fixed flatten PGN failed to parse")
}

// PGN tokenising and file splitting — against the PHP oracle's goldens from phase 0.
struct PgnTokenCase: Decodable { let label: String, movetext: String, tokens: [String] }
h.begin("pgn_tokens")
for c in load("pgn_tokens", [PgnTokenCase].self) {
    let got = PGN.mainlineTokens(c.movetext)
    h.check(got.count == c.tokens.count, "\(c.label) token count \(got.count) != \(c.tokens.count)")
    h.check(got == c.tokens, "\(c.label) [\(got.joined(separator: " "))] != [\(c.tokens.joined(separator: " "))]")
}

struct PgnSplitGame: Decodable { let headers: [String: String], movetext: String }
struct PgnSplitCase: Decodable { let label: String, pgn: String, games: [PgnSplitGame] }
h.begin("pgn_split")
for c in load("pgn_split", [PgnSplitCase].self) {
    let got = PGN.splitGames(c.pgn)
    h.check(got.count == c.games.count, "\(c.label) game count \(got.count) != \(c.games.count)")
    for (a, b) in zip(got, c.games) {
        h.check(a.movetext == b.movetext, "\(c.label) movetext \"\(a.movetext)\" != \"\(b.movetext)\"")
        h.check(a.headers == b.headers, "\(c.label) headers \(a.headers) != \(b.headers)")
    }
}

// PGN round trip. Expected canonical movetext is the JS twin's output, so a divergence in either
// serializer shows up here rather than as a silent formatting drift.
h.begin("pgn_roundtrip")
let pgnCorpus: [(String, String)] = [
    ("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0",
     "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0"),
    ("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *",
     "1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *"),
    ("1. e4 e5 (1... c5 (1... e6 2. d4) 2. Nf3) 2. Nf3 1/2-1/2",
     "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3 1/2-1/2"),
    ("1. e4! e5?! {sharp} 2. Nf3 $10 *",
     "1. e4 $1 e5 $6 {sharp} 2. Nf3 $10 *"),
    ("1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Bd7 5. bxa8=Q *",
     "1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Bd7 5. bxa8=Q *"),
    ("1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 0-1",
     "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 0-1"),
]
for (src, wantBody) in pgnCorpus {
    guard let g1 = PGN.parseFirst(src) else { h.check(false, "failed to parse \(src)"); continue }
    let text1 = PGN.serialize(g1)
    let parts = text1.components(separatedBy: "\n\n")
    let body = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespacesAndNewlines) : ""
    h.check(body == wantBody, "canonical movetext \"\(body)\" != \"\(wantBody)\"")
    guard let g2 = PGN.parseFirst(text1) else { h.check(false, "failed to reparse \(src)"); continue }
    h.check(PGN.serialize(g2) == text1, "serialize is a fixpoint for \(src.prefix(28))…")
    h.check(g1.tree.mainlineSANs() == g2.tree.mainlineSANs(), "the main line survives the round trip")
    h.check(g1.errors.isEmpty, "a clean corpus game reports no errors")
}
if let bad = PGN.parseFirst("1. e4 e5 2. Nf3 Qz9 4. Bb5 *") {
    h.check(bad.errors.count == 1, "one error is reported for a bad move")
    h.check(bad.errors.first?.ply == 4, "the error names the failing ply")
    h.check(bad.tree.mainlineSANs() == ["e4", "e5", "Nf3"], "the moves before the error are kept")
}
if let nullMove = PGN.parseFirst("1. e4 -- 2. Nf3 *") {
    h.check(nullMove.errors.first?.message.contains("null moves") == true, "null moves are rejected")
}
if let setup = PGN.parseFirst("[SetUp \"1\"]\n[FEN \"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1\"]\n\n1. O-O-O O-O *") {
    h.check(setup.tree.mainlineSANs() == ["O-O-O", "O-O"], "a game from a custom FEN parses")
    h.check(PGN.serialize(setup).contains("[SetUp \"1\"]"), "a custom start emits SetUp")
    h.check(PGN.serialize(setup).contains("[FEN \"r3k2r"), "a custom start emits FEN")
}
if let multi = PGN.parseFirst("[Event \"The \\\"Big\\\" One\"]\n\n1. e4 *") {
    h.check(multi.headers["Event"] == "The \"Big\" One", "escaped quotes are unescaped on read")
    h.check(PGN.serialize(multi).hasPrefix("[Event \"The \\\"Big\\\" One\"]"), "and re-escaped on write")
}
h.check(PGN.parse("[Event \"A\"]\n\n1. e4 e5 1-0\n\n[Event \"B\"]\n\n1. d4 d5 0-1\n").count == 2,
        "a two-game file yields two games")

// The analysis search. Mate expectations are ground truth from a brute-force checker, NOT from this
// engine — guessing them by eye produced four wrong entries when the JS twin was written.
h.begin("search")
let engine = LocalEngine()
let mateCases: [(String, Int, Int, String)] = [
    ("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 1, 2, "back-rank mate in 1 (Ra8#)"),
    ("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", 1, 2, "back-rank mate in 1, both sides castled"),
    ("6k1/5p1p/8/8/8/8/8/R5RK w - - 0 1", 1, 2, "back-rank mate in 1 through an open g7"),
    ("7k/R7/1R6/8/8/8/8/7K w - - 0 1", 1, 2, "rook ladder mate in 1"),
    ("6k1/8/6K1/8/8/8/8/7Q w - - 0 1", 1, 2, "K+Q mate in 1"),
    ("7k/8/6K1/8/8/8/8/R7 w - - 0 1", 1, 2, "K+R corner mate in 1"),
    ("7k/6R1/8/8/8/8/8/6RK w - - 0 1", 2, 4, "two-rook mate in 2"),
    ("6k1/8/6K1/8/8/8/8/7R w - - 0 1", 2, 4, "K+R mate in 2"),
]
for (fen, wantMate, depth, why) in mateCases {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let r = engine.analyzeToCompletion(pos, limits: SearchLimits(maxDepth: depth, multiPV: 1))
    guard let best = r.lines.first else { h.check(false, "\(why): no lines"); continue }
    if case .mate(let n) = best.score {
        h.check(n == wantMate, "\(why): M\(n) != M\(wantMate)")
    } else {
        h.check(false, "\(why): \(best.score.displayText) is not a mate score")
    }
}
if let quiet = ChessPosition(fen: "5rk1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1") {
    let r = engine.analyzeToCompletion(quiet, limits: SearchLimits(maxDepth: 3, multiPV: 1))
    if case .cp = r.lines.first?.score { h.check(true, "no mate available -> cp") }
    else { h.check(false, "no mate available: expected a cp score") }
}
// MultiPV invariants and PV legality.
if let mid = ChessPosition(fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4") {
    let r = engine.analyzeToCompletion(mid, limits: SearchLimits(maxDepth: 3, multiPV: 3))
    h.check(r.lines.count == 3, "multiPV returns 3 lines, got \(r.lines.count)")
    var roots = Set<String>()
    for (i, l) in r.lines.enumerated() {
        h.check(l.rank == i + 1, "line \(i + 1) rank \(l.rank)")
        h.check(l.pvSAN.count == l.pv.count, "line \(i + 1) pvSAN length matches pv")
        var p = mid, legal = true
        for m in l.pv {
            if !p.legalMoves().contains(m) { legal = false; break }
            p = p.makeMove(m)
        }
        h.check(legal, "line \(i + 1) PV is fully legal")
        if let f = l.pv.first { roots.insert(f.uci) }
    }
    h.check(roots.count == r.lines.count, "multiPV root moves are distinct")
    if r.lines.count > 1 {
        for i in 1 ..< r.lines.count {
            if case .cp(let a) = r.lines[i - 1].score, case .cp(let b) = r.lines[i].score {
                h.check(a >= b, "multiPV scores are non-increasing (\(a) then \(b))")
            }
        }
    }
    // Determinism: the same request twice must produce the identical snapshot.
    let again = engine.analyzeToCompletion(mid, limits: SearchLimits(maxDepth: 3, multiPV: 3))
    h.check(again.lines == r.lines, "the search is deterministic")
    h.check(again.nodes == r.nodes, "node counts match across identical runs")
    // Progress fires once per completed depth.
    var seen: [Int] = []
    _ = engine.analyze(mid, limits: SearchLimits(maxDepth: 3), historyKeys: [],
                       shouldCancel: { false }, onProgress: { seen.append($0.depth) })
    h.check(seen == [1, 2, 3], "onProgress fires per depth, got \(seen)")
}
// White-relative signs: the same board must score with the same sign whoever is to move.
for (fen, why) in [("4k3/8/8/8/8/8/8/3QK3 w - - 0 1", "White to move"),
                   ("4k3/8/8/8/8/8/8/3QK3 b - - 0 1", "Black to move")] {
    guard let pos = ChessPosition(fen: fen) else { h.check(false, "bad fen \(fen)"); continue }
    let r = engine.analyzeToCompletion(pos, limits: SearchLimits(maxDepth: 2))
    if case .cp(let c) = r.lines.first?.score {
        h.check(c > 0, "White up a queen scores positive, \(why): got \(c)")
    } else {
        h.check(true, "White up a queen found a mate, \(why)")
    }
}
// Quiescence: a hanging queen must be taken rather than left to the horizon.
if let hanging = ChessPosition(fen: "4k3/8/8/8/3q4/8/3Q4/4K3 w - - 0 1") {
    let r = engine.analyzeToCompletion(hanging, limits: SearchLimits(maxDepth: 2))
    h.check(r.lines.first?.pvSAN.first == "Qxd4",
            "the free queen is captured, got \(r.lines.first?.pvSAN.first ?? "nil")")
}
// Terminal short-circuit, and the guard against the server's evalMate:0 bug.
if let mated = ChessPosition(fen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 1 1") {
    let r = engine.analyzeToCompletion(mated, limits: SearchLimits(maxDepth: 4))
    h.check(r.lines.isEmpty, "a finished game produces no lines")
    h.check(r.nodes == 0, "a finished game is never searched")
    h.check(r.terminal?.kind == .checkmate, "checkmate is reported as terminal")
    let ev = r.score?.asReviewEvaluation() ?? GameReview.Evaluation(evalCp: nil, evalMate: nil, bestMoveSan: nil)
    h.check(ev.evalMate == nil, "terminal mate NEVER sets evalMate — the server's latent bug")
    h.check(ev.evalCp == 10000, "White mating gives evalCp +10000, got \(String(describing: ev.evalCp))")
    h.check(GameReview.normalizeEval(ev) == 10000, "normalizeEval agrees, so the review sees +10000")
}
if let stale = ChessPosition(fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1") {
    let r = engine.analyzeToCompletion(stale, limits: SearchLimits(maxDepth: 4))
    h.check(r.terminal?.reason == .stalemate, "stalemate is terminal")
    h.check(r.score?.asReviewEvaluation().evalCp == 0, "a draw is 0 cp")
}
// A real, non-terminal mate still uses evalMate.
if let m1 = ChessPosition(fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1") {
    let r = engine.analyzeToCompletion(m1, limits: SearchLimits(maxDepth: 2))
    let ev = r.lines.first?.score.asReviewEvaluation(bestMoveSan: "Ra8#")
    h.check(ev?.evalMate == 1 && ev?.evalCp == nil, "a forced mate uses evalMate, not evalCp")
    h.check(ev?.bestMoveSan == "Ra8#", "the best-move SAN is carried through")
}
// Display formatting matches the spec's engine-line column.
h.check(EngineScore.cp(130).displayText == "+1.3", "displayText +1.3")
h.check(EngineScore.cp(-70).displayText == "-0.7", "displayText -0.7")
h.check(EngineScore.cp(0).displayText == "+0.0", "displayText +0.0")
h.check(EngineScore.mate(4).displayText == "M4", "displayText M4")
h.check(EngineScore.mate(-3).displayText == "M-3", "displayText M-3")
h.check(engine.identifier == "local-negamax-v2", "the engine identifies itself for review caching")

// Determinism at a size where the transposition table actually fills and is consulted. The smaller
// check above would pass even if the table were never reached; this one would not.
if let sharp = ChessPosition(fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6") {
    let limits = SearchLimits(maxDepth: 6, maxNodes: 60000, multiPV: 3)
    let a = engine.analyzeToCompletion(sharp, limits: limits)
    let b = engine.analyzeToCompletion(sharp, limits: limits)
    h.check(a.nodes == b.nodes, "a table-filling search is still node-for-node reproducible")
    h.check(a.lines == b.lines, "and returns the identical lines")
    h.check(a.nodes > 0, "and actually searched something (\(a.nodes) nodes)")
    for l in a.lines {
        var p = sharp, legal = true
        for m in l.pv {
            if !p.legalMoves().contains(m) { legal = false; break }
            p = p.makeMove(m)
        }
        h.check(legal, "line \(l.rank)'s PV survives the accelerators intact")
        h.check(!l.pv.isEmpty, "line \(l.rank) has a principal variation at all")
    }

    // The tail extension. A PV can never be longer than the search was deep — the recursion stops
    // writing to `line` at depth 0 — so at depth 6 every line used to be exactly six plies, which
    // is what the client asked to see more of. `extendTail` searches on past that.
    //
    // Asserted through the PUBLIC result rather than by reaching into `Search`, so it is the
    // shipped behaviour under test. Mirrored assertion-for-assertion in analysis-engine.js §11.
    var extendedAny = false
    for l in a.lines {
        h.check(l.pvSAN.count == l.pv.count, "extended line \(l.rank): pv and pvSAN stay parallel")
        h.check(l.pv.count <= LocalEngine.pvExtendLimit,
                "extended line \(l.rank): stops at pvExtendLimit, got \(l.pv.count)")
        if l.pv.count > l.depth { extendedAny = true }
        // Position identity WITHOUT the clocks — the same rule threefold uses, and the same thing
        // the engine's own Zobrist key stands for.
        var p = sharp
        var seen: Set<String> = [p.fen.split(separator: " ").prefix(4).joined(separator: " ")]
        var noRepeat = true
        for m in l.pv {
            p = p.makeMove(m)
            let key = p.fen.split(separator: " ").prefix(4).joined(separator: " ")
            if !seen.insert(key).inserted { noRepeat = false; break }
        }
        h.check(noRepeat, "extended line \(l.rank): the line never revisits a position")
    }
    h.check(extendedAny, "the tail probe actually lengthens a line past the searched depth")
    // The display cap must be the thing that truncates a line, not the engine.
    h.check(LocalEngine.pvExtendLimit > AnalysisSession.pvPreview,
            "pvExtendLimit stays above AnalysisSession.pvPreview")
}

// The Engine Settings the Analysis Board drives the search with (☰ > Engine). Mirrors
// `engine-settings.js`'s own suite; `tools/qa/replay_engine_settings.js` pins the two tables to each
// other, and this proves the Swift side computes what those tables imply.
h.begin("engine_settings")

h.check(EngineSettings.presets.count == 5, "five presets")
h.check(EngineSettings.presetIDs() == ["saver", "balanced", "strong", "maximum", "infinite"],
        "weakest to strongest, got \(EngineSettings.presetIDs())")
for i in 1 ..< EngineSettings.presets.count {
    let p = EngineSettings.presets[i], q = EngineSettings.presets[i - 1]
    h.check(p.maxDepth > q.maxDepth, "\(p.id) searches deeper than \(q.id)")
    h.check(p.heat > q.heat, "\(p.id) runs hotter than \(q.id)")
    h.check(p.multiPV >= q.multiPV, "\(p.id) shows at least as many lines as \(q.id)")
    if p.thinkMs != EngineSettings.thinkInfinite {
        h.check(p.thinkMs > q.thinkMs, "\(p.id) thinks for longer than \(q.id)")
    }
}
h.check(EngineSettings.preset("infinite").thinkMs == EngineSettings.thinkInfinite,
        "only Infinite has no deadline")
h.check(EngineSettings.preset("infinite").maxDepth == EngineSettings.depthMax,
        "Infinite is bounded by the depth ceiling, or it would never terminate")
h.check(EngineSettings.preset("nonsense").id == EngineSettings.defaultPreset,
        "an unknown preset id falls back rather than trapping")

// The default IS what the board did before this setting existed.
let bal = EngineSettings.resolve(EngineSettings.defaults())
h.check(bal.thinkMs == 1200, "the default budget is still 1200ms, got \(bal.thinkMs)")
h.check(bal.multiPV == 3, "the default is still three lines, got \(bal.multiPV)")
h.check(bal.reviewMs == 200, "the default review budget is still 200ms, got \(bal.reviewMs)")
h.check(bal.infinite == false, "and the default is not an unbounded search")
h.check(bal.searchLimits.maxDepth == 12 && bal.searchLimits.multiPV == 3,
        "the resolved SearchLimits carry the preset through")
h.check(bal.reviewLimits.multiPV == 1, "a review always runs one line")

// The review budget is DERIVED, not listed. If this drifts, one of the two numbers is wrong, and
// the point of deriving it is that there is only one to get right.
for (id, want) in [("saver", 120), ("balanced", 200), ("strong", 500),
                   ("maximum", 1200), ("infinite", 1200)] {
    let got = EngineSettings.resolve(EngineSettings.Value(preset: id, custom: false,
                                                          multiPV: 0, maxDepth: 0, thinkMs: 0)).reviewMs
    h.check(got == want, "\(id) review budget is \(want)ms, got \(got)")
}
h.check(EngineSettings.reviewBudget(EngineSettings.thinkInfinite) == EngineSettings.reviewMax,
        "an infinite LIVE search still gives the REVIEW a finite budget — 41 positions cannot be unbounded")

// Clamping: everything that reaches the engine has been through it.
func clamped(_ v: EngineSettings.Value) -> EngineSettings.Value { EngineSettings.clamp(v) }
let wild = EngineSettings.Value(preset: "nope", custom: true, multiPV: 99,
                                maxDepth: 999, thinkMs: 999_999)
let tame = clamped(wild)
h.check(tame.preset == EngineSettings.defaultPreset, "an unknown preset id clamps to the default")
h.check(tame.multiPV == EngineSettings.linesMax, "lines clamp to the maximum")
h.check(tame.maxDepth == EngineSettings.depthMax, "depth clamps to the ceiling")
h.check(tame.thinkMs == EngineSettings.thinkMax, "think time clamps to the maximum")
let tiny = clamped(EngineSettings.Value(preset: "balanced", custom: true, multiPV: 0,
                                        maxDepth: -5, thinkMs: 50))
h.check(tiny.multiPV == EngineSettings.linesMin, "lines clamp to the minimum")
h.check(tiny.maxDepth == EngineSettings.depthMin, "depth clamps to the floor")
h.check(tiny.thinkMs == EngineSettings.thinkMin, "a too-small think time clamps UP, not to zero")
h.check(clamped(EngineSettings.Value(preset: "balanced", custom: false, multiPV: 3,
                                     maxDepth: 12, thinkMs: 0)).thinkMs == EngineSettings.thinkInfinite,
        "zero survives clamping — it means infinite")

// Custom overrides the preset, and only when it is switched on.
let custom = EngineSettings.Value(preset: "saver", custom: true, multiPV: 5,
                                  maxDepth: 20, thinkMs: 4000)
let rc = EngineSettings.resolve(custom)
h.check(rc.multiPV == 5 && rc.maxDepth == 20 && rc.thinkMs == 4000, "Advanced values win")
h.check(rc.label == "Custom", "and the label says so")
var off = custom; off.custom = false
let ro = EngineSettings.resolve(off)
h.check(ro.multiPV == 2 && ro.thinkMs == 500,
        "with Advanced off the stored custom values are ignored, not merged")

// Display.
h.check(EngineSettings.timeText(1200) == "1.2s", "timeText 1.2s, got \(EngineSettings.timeText(1200))")
h.check(EngineSettings.timeText(3000) == "3s", "a whole number of seconds drops the .0")
h.check(EngineSettings.timeText(EngineSettings.thinkInfinite) == "∞", "infinite shows as the symbol")
h.check(EngineSettings.presetSummary("balanced") == "1.2s · depth 12 · 3 lines",
        "the Balanced summary line, got \(EngineSettings.presetSummary("balanced"))")
h.check(EngineSettings.presetSummary("infinite") == "∞ · depth 30 · 4 lines",
        "the Infinite summary line, got \(EngineSettings.presetSummary("infinite"))")

// Warnings appear exactly where the heat is.
func warn(_ id: String) -> String? {
    EngineSettings.warning(EngineSettings.Value(preset: id, custom: false, multiPV: 0,
                                                maxDepth: 0, thinkMs: 0))
}
h.check(warn("saver") == nil, "Battery Saver needs no warning")
h.check(warn("balanced") == nil, "nor does Balanced")
h.check(warn("strong") == EngineSettings.warningText, "Strong warns")
h.check(warn("maximum") == EngineSettings.warningText, "Maximum warns")
h.check(warn("infinite") == EngineSettings.infiniteWarningText,
        "Infinite gets its own warning, because it needs to say how to stop it")

// The panel model — everything the SwiftUI sheet draws, checked without a view.
let panel = EngineSettings.panelModel(EngineSettings.defaults(), advancedOpen: false)
h.check(panel.presets.count == 5, "the panel lists all five presets")
h.check(panel.presets.filter { $0.active }.count == 1, "exactly one preset row is selected")
h.check(panel.presets[1].active, "and it is Balanced by default")
h.check(panel.advancedOpen == false, "Advanced starts closed")
h.check(panel.advancedState == "OFF", "and says so")
h.check(panel.warning == nil, "no warning on the default preset")
h.check(panel.controls.map(\.key) == [EngineSettings.controlLines,
                                      EngineSettings.controlDepth,
                                      EngineSettings.controlThink],
        "Lines, Max depth, Think time — in that order")
h.check(panel.controls[0].kind == .segment && panel.controls[0].options == [1, 2, 3, 4, 5],
        "Lines is a five-way segmented picker, not a slider")
h.check(EngineSettings.panelModel(custom, advancedOpen: false).advancedOpen,
        "a custom setting forces Advanced open — it is what is in effect")
h.check(EngineSettings.panelModel(custom, advancedOpen: false).presets.allSatisfy { !$0.active },
        "and no preset row is selected, because none is")
let infPanel = EngineSettings.panelModel(
    EngineSettings.Value(preset: "infinite", custom: false, multiPV: 0, maxDepth: 0, thinkMs: 0),
    advancedOpen: false)
h.check(infPanel.controls[2].value == infPanel.controls[2].min,
        "Infinite sits at the very bottom of the Think time range")
h.check(infPanel.controls[2].valueText == "∞", "and reads as the symbol")

// The two edits the panel can make.
h.check(EngineSettings.encode(EngineSettings.selectPreset(EngineSettings.defaults(), "strong"))
        == "v1|strong|0|3|18|3000",
        "picking a preset seeds the Advanced fields with its numbers")
let edited = EngineSettings.applyControl(EngineSettings.defaults(), EngineSettings.controlLines, 5)
h.check(edited.custom, "editing a control switches Advanced on")
h.check(edited.multiPV == 5, "and takes the new value")
h.check(edited.maxDepth == 12 && edited.thinkMs == 1200,
        "while the other two keep whatever was in effect")
h.check(EngineSettings.applyControl(EngineSettings.defaults(), EngineSettings.controlThink,
                                    EngineSettings.thinkSliderMin).thinkMs == EngineSettings.thinkInfinite,
        "the bottom of the Think time range is Infinite")
h.check(EngineSettings.applyControl(EngineSettings.defaults(), EngineSettings.controlDepth, 999)
        .maxDepth == EngineSettings.depthMax, "a control value is clamped like any other")

// The encoding round-trips and survives everything it should.
h.check(EngineSettings.encode(EngineSettings.defaults()) == "v1|balanced|0|3|12|1200",
        "the canonical default document, got \(EngineSettings.encode(EngineSettings.defaults()))")
for v in [EngineSettings.defaults(), custom,
          EngineSettings.Value(preset: "infinite", custom: false, multiPV: 4,
                               maxDepth: 30, thinkMs: 0)] {
    h.check(EngineSettings.encode(EngineSettings.decode(EngineSettings.encode(v)))
            == EngineSettings.encode(v), "round trip: \(EngineSettings.encode(v))")
}
for bad in ["", "garbage", "v9|balanced|0|3|12|1200", "v1|balanced|0|3"] {
    h.check(EngineSettings.encode(EngineSettings.decode(bad))
            == EngineSettings.encode(EngineSettings.defaults()),
            "\"\(bad)\" decodes to the defaults rather than half-reading it")
}
h.check(EngineSettings.encode(EngineSettings.decode(nil))
        == EngineSettings.encode(EngineSettings.defaults()), "nil decodes to the defaults")
h.check(EngineSettings.encode(EngineSettings.decode("v1|balanced|0|99|99|99999"))
        == "v1|balanced|0|5|30|30000", "out-of-range stored values are clamped on the way in")

// Storage, through the injectable protocol the UI layer's UserDefaults adapter conforms to.
final class MemoryStorage: EngineSettings.Storage {
    var values: [String: String] = [:]
    func get(_ key: String) -> String? { values[key] }
    func set(_ key: String, _ value: String) { values[key] = value }
    func remove(_ key: String) { values.removeValue(forKey: key) }
}
let mem = MemoryStorage()
h.check(EngineSettings.load(mem).preset == EngineSettings.defaultPreset,
        "an empty store loads the defaults")
EngineSettings.save(EngineSettings.selectPreset(EngineSettings.defaults(), "strong"), mem)
h.check(EngineSettings.load(mem).preset == "strong", "what was saved is what loads")
h.check(mem.values[EngineSettings.storageKey] == "v1|strong|0|3|18|3000",
        "stored under the versioned key in the canonical shape")


// The bundled ECO opening book. Exercises the real OpeningBook(tsv:) parser against the real
// shipped file (copied into Goldens/ by build_eco.php), then replays the oracle's sampled lines.
struct EcoLookupCase: Decodable {
    let sanMoves: [String], key: String, eco: String, name: String, plyCount: Int
}
struct EcoTransposition: Decodable { let lineA: String, lineB: String, keyA: String, keyB: String }
struct EcoGolden: Decodable { let lookups: [EcoLookupCase], transpositions: [EcoTransposition] }

if let tsv = loadText("eco_book.tsv"), let g = loadOptional("eco_lookup", EcoGolden.self) {
    h.begin("eco")
    let book = OpeningBook(tsv: tsv)
    h.check(book.count > 7000, "the book parsed \(book.count) rows, expected > 7000")
    for c in g.lookups {
        var pos = ChessPosition.start()
        var ok = true
        for san in c.sanMoves {
            guard let m = pos.move(forSAN: san) else { ok = false; break }
            pos = pos.makeMove(m)
        }
        guard ok else { h.check(false, "\(c.eco) \(c.name): line did not replay"); continue }
        h.check(pos.positionKey == c.key, "\(c.eco) \(c.name): key \(pos.positionKey) != \(c.key)")
        guard let e = book.entry(for: c.key) else {
            h.check(false, "\(c.eco) \(c.name): key missing from the book")
            continue
        }
        h.check(e.eco == c.eco && e.name == c.name,
                "\(c.eco) \(c.name): book says (\(e.eco), \(e.name))")
    }
    for t in g.transpositions {
        var a = ChessPosition.start(), b = ChessPosition.start()
        var ok = true
        for san in PGN.mainlineTokens(t.lineA) {
            guard let m = a.move(forSAN: san) else { ok = false; break }
            a = a.makeMove(m)
        }
        for san in PGN.mainlineTokens(t.lineB) {
            guard let m = b.move(forSAN: san) else { ok = false; break }
            b = b.makeMove(m)
        }
        guard ok else { h.check(false, "transposition \(t.lineA) did not replay"); continue }
        h.check(a.positionKey == b.positionKey, "transposition \"\(t.lineA)\" == \"\(t.lineB)\"")
        h.check(a.positionKey == t.keyA, "transposition \"\(t.lineA)\" matches the oracle key")
    }
    // Pass-through rows are in book but carry no name — that is what makes the `book` tier fire for
    // a whole opening rather than only at the handful of positions an ECO line happens to end on.
    var kid = ChessPosition.start()
    for san in ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"] {
        if let m = kid.move(forSAN: san) { kid = kid.makeMove(m) }
    }
    h.check(book.contains(kid.positionKey), "a pass-through position is in book")
    h.check(book.named(kid.positionKey) == nil, "but it carries no name of its own")
    let ruy = book.named("r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -")
    h.check(ruy?.name == "Ruy Lopez", "the Ruy Lopez is named")
    if let ruy {
        h.check(book.nameFor(kid.positionKey, lastKnown: ruy) == ruy,
                "a pass-through keeps the last known opening")
        h.check(book.nameFor("not a key", lastKnown: ruy) == ruy, "a miss keeps it too")
    }
    h.check(book.nameFor("not a key", lastKnown: nil) == nil, "with nothing known, a miss stays nil")
    let starts = book.continuations(from: ChessPosition.start())
    h.check(starts.count > 15, "the start position has many book continuations (\(starts.count))")
    h.check(starts.map(\.san) == starts.map(\.san).sorted(), "continuations are sorted by SAN")
    h.check(starts.contains { $0.san == "e4" } && starts.contains { $0.san == "d4" },
            "e4 and d4 are book continuations")
} else {
    h.begin("eco")
    h.check(false, "Goldens/eco_book.tsv or eco_lookup.json missing — run php tools/eco/build_eco.php")
}

// The `book` tier, layered over the untouched GameReview result. Reuses the same 303 golden cases
// the game_review groups consume, so no new fixtures are needed.
h.begin("review_book")
if let reviewCases = loadOptional("game_review", [GameReviewCase].self) {
    for (ci, c) in reviewCases.enumerated() {
        let evals = c.evaluations.map { GameReview.Evaluation(evalCp: $0.eval_cp, evalMate: $0.eval_mate, bestMoveSan: $0.best_move_san) }
        let moves = c.moves.map { GameReview.Move(san: $0?.san, color: $0?.color) }
        let base = GameReview.review(evaluations: evals, moves: moves)

        // An EMPTY book must change nothing. This is the load-bearing assertion: the `book` tier is
        // a post-layer, and GameReview keeps exactly its nine keys.
        let none = ReviewAnnotator.annotate(base, moves: moves, bookPlies: [])
        h.check(none.moveEvaluations == base.moveEvaluations, "case\(ci) empty book leaves moveEvaluations untouched")
        h.check(none.whiteAccuracy == base.whiteAccuracy && none.blackAccuracy == base.blackAccuracy,
                "case\(ci) accuracy is never recomputed")
        h.check(none.whiteClassifications.count == 10, "case\(ci) the display map has 10 keys")
        h.check(none.whiteClassifications["book"] == 0, "case\(ci) an empty book adds book:0")
        // Iterate the base result's own keys rather than GameReview.emptyClassifications, which is
        // internal to BiyaherongCoachCore and invisible from this module.
        var whiteMatches = true, blackMatches = true
        for k in base.whiteClassifications.keys {
            if none.whiteClassifications[k] != base.whiteClassifications[k] { whiteMatches = false }
            if none.blackClassifications[k] != base.blackClassifications[k] { blackMatches = false }
        }
        h.check(whiteMatches, "case\(ci) empty book preserves every White count")
        h.check(blackMatches, "case\(ci) empty book preserves every Black count")

        // Marking every ply as book moves every count into `book` and empties the rest.
        let allPlies = Set(base.moveEvaluations.map(\.moveIndex))
        let all = ReviewAnnotator.annotate(base, moves: moves, bookPlies: allPlies)
        h.check(all.moveEvaluations.allSatisfy { $0.classification == "book" },
                "case\(ci) a full book relabels every ply")
        let bookTotal = (all.whiteClassifications["book"] ?? 0) + (all.blackClassifications["book"] ?? 0)
        h.check(bookTotal == base.moveEvaluations.count,
                "case\(ci) book counts sum to the classified plies (\(bookTotal) != \(base.moveEvaluations.count))")
        h.check(all.base.whiteClassifications == base.whiteClassifications,
                "case\(ci) the base result survives untouched")
        // Counts always sum to the number of classified plies, whatever the book says.
        var sum = 0
        for k in ReviewAnnotator.displayOrder {
            sum += (none.whiteClassifications[k] ?? 0) + (none.blackClassifications[k] ?? 0)
        }
        h.check(sum == base.moveEvaluations.count, "case\(ci) counts sum to the move count")
    }
}
if let randomCases = loadOptional("game_review_random", [GameReviewCase].self) {
    for (ci, c) in randomCases.enumerated() {
        let evals = c.evaluations.map { GameReview.Evaluation(evalCp: $0.eval_cp, evalMate: $0.eval_mate, bestMoveSan: $0.best_move_san) }
        let moves = c.moves.map { GameReview.Move(san: $0?.san, color: $0?.color) }
        let base = GameReview.review(evaluations: evals, moves: moves)
        let none = ReviewAnnotator.annotate(base, moves: moves, bookPlies: [])
        h.check(none.moveEvaluations == base.moveEvaluations, "g\(ci) empty book leaves moveEvaluations untouched")
        h.check(none.whiteAccuracy == base.whiteAccuracy, "g\(ci) accuracy is never recomputed")
        var sum = 0
        for k in ReviewAnnotator.displayOrder {
            sum += (none.whiteClassifications[k] ?? 0) + (none.blackClassifications[k] ?? 0)
        }
        h.check(sum == base.moveEvaluations.count, "g\(ci) counts sum to the move count")
        // Relabelling ply 1 moves exactly one count out of its tier and into `book`.
        if let first = base.moveEvaluations.first {
            let one = ReviewAnnotator.annotate(base, moves: moves, bookPlies: [first.moveIndex])
            let isWhite = moves[first.moveIndex].color == "w"
            let counts = isWhite ? one.whiteClassifications : one.blackClassifications
            let baseCounts = isWhite ? base.whiteClassifications : base.blackClassifications
            h.check(counts["book"] == 1, "g\(ci) one book ply gives book:1")
            h.check(counts[first.classification] == (baseCounts[first.classification] ?? 0) - 1,
                    "g\(ci) and drops the original tier by exactly one")
        }
    }
}
h.check(ReviewAnnotator.displayOrder.count == 10, "displayOrder has ten tiers")
h.check(ReviewAnnotator.displayOrder[2] == "book", "book sits after great — the fix for CLASSIFICATION_ORDER")
// GameReview must still produce exactly nine keys: the book tier is a post-layer, not a tenth
// branch inside the pinned classifier.
h.check(GameReview.review(evaluations: [], moves: []).whiteClassifications.count == 9,
        "GameReview itself still has exactly nine keys")

// MARK: - 5b. Analysis session (the Analysis Board's behaviour, with no screen attached)
//
// Hand-authored on both sides, like `draw_rules` and `notation_extra`: there is no PHP oracle for a
// screen. The expectations are DERIVED FROM the React Native source (line numbers in the comments),
// not copied from the JS twin's output, so the two languages assert independently-reasoned facts
// about the same behaviour. The labels are kept identical to the JS ones so the two tables can be
// diffed by eye against web-demo/js/analysis.js's selfTest.

h.begin("analysis_session")
do {
    // loadText takes the FULL filename and returns an Optional — same call shape as the `eco` group.
    let book = OpeningBook(tsv: loadText("eco_book.tsv") ?? "")
    h.check(book.count > 7000, "the ECO book loaded (\(book.count) rows)")

    func newSession(_ fen: String = ChessPosition.startFEN) -> AnalysisSession? {
        AnalysisSession(initialFEN: fen, book: book)
    }

    // 1. a fresh session
    guard let s = newSession() else {
        h.check(false, "a session is created from the start position")
        exit(Int32(h.summary()))
    }
    h.check(s.position.fen == ChessPosition.startFEN, "cursor starts at the start position")
    h.check(s.historyKeys.count == 1, "history holds just the start key")
    h.check(s.statusText == "1. White's move", "status at the start: \(s.statusText)")
    h.check(s.arrows.isEmpty, "no arrows without a snapshot")
    h.check(s.engineRows.isEmpty, "no engine rows without a snapshot")
    h.check(s.stripTokens.isEmpty, "the strip is empty before any move")
    h.check(s.isStale, "a session with no snapshot is stale")
    h.check(s.lastMove == nil, "no last move at the start")
    h.check(s.checkSquare == nil, "nobody is in check at the start")

    // 2. the move-number DEVIATION — board.tsx:2861 would say "1." after 1.e4 e5
    s.play(san: "e4")
    h.check(s.statusText == "1... Black's move", "after 1.e4 it is Black to move on move 1")
    s.play(san: "e5")
    h.check(s.statusText == "2. White's move",
            "after 1.e4 e5 the next move is 2 (the RN source reads \"1.\" — deliberate deviation)")

    // 3. the move strip, mainline only (board.tsx:3049-3120)
    let toks = s.stripTokens
    h.check(toks.count == 3, "two plies render as number + move + move, got \(toks.count)")
    h.check(toks[0].kind == .number && toks[0].text == "1.", "the number token precedes White")
    h.check(toks[1].text == "e4", "first move token")
    h.check(toks[2].text == "e5", "second move token")
    h.check(toks[2].isCurrent, "the cursor token is current")
    h.check(!toks[1].isCurrent, "earlier tokens are not current")
    h.check(toks[1].isOnPath, "earlier tokens are on the path")

    // 4. branching — the alternative appears inline as a chip
    s.goBack()
    s.play(san: "c5")
    let alts = s.stripTokens.filter { $0.kind == .alternative }
    h.check(alts.count == 1, "one alternative chip, got \(alts.count)")
    h.check(alts.first?.text == "1...c5", "the chip carries its own move number and the ... prefix")
    h.check(alts.first?.isCurrent == true, "the chip is current because the cursor is on it")
    h.check(s.stripTokens.filter { $0.kind == .move }.count == 2, "the main line still shows two moves")
    h.check(s.tree.mainline()[1].san == "e5", "c5 is a variation, not the main line")

    // 5. navigation always clears the snapshot (board.tsx:1457-1470)
    let fakeSnap = AnalysisSnapshot(fen: s.position.fen, depth: 1, nodes: 1, lines: [],
                                    isFinal: true, terminal: nil)
    s.snapshot = fakeSnap
    h.check(!s.isStale, "a snapshot for the current position is fresh")
    s.goBack()
    h.check(s.snapshot == nil, "going back clears the snapshot")
    h.check(s.isStale, "and that makes it stale again")
    s.snapshot = AnalysisSnapshot(fen: s.position.fen, depth: 1, nodes: 1, lines: [],
                                  isFinal: true, terminal: nil)
    h.check(s.play(san: "Nf3") == nil, "Nf3 is not legal for Black, so it is rejected")
    h.check(s.snapshot != nil, "a rejected move leaves the snapshot alone")
    s.play(san: "Nc6")
    h.check(s.snapshot == nil, "playing a move clears the snapshot")

    // 6. forward with several children has to ask which (board.tsx:1506-1516)
    s.goToStart()
    s.goForward()
    h.check(s.forwardOptions().count == 3, "after 1.e4 there are three recorded continuations")
    h.check(s.forwardOptions().map { $0.san }.joined(separator: " ") == "e5 c5 Nc6",
            "in the order they were added, children[0] being the main line")
    h.check(s.goForward(1)?.san == "c5", "the index selects which branch")
    s.goBack()
    h.check(s.goForward(2)?.san == "Nc6", "including the third")
    s.goBack()
    h.check(s.goForward()?.san == "e5", "no index means the main line")
    h.check(s.goForward() == nil, "a leaf has nowhere to go forward")
    s.goToStart()
    h.check(s.goToEnd().san == "e5", "goToEnd follows the MAIN line, not the last one played")

    // 7. staleness drives the restart policy (board.tsx:885 — the bug we do not reproduce)
    if let s2 = newSession() {
        s2.snapshot = AnalysisSnapshot(fen: ChessPosition.startFEN, depth: 1, nodes: 1, lines: [],
                                       isFinal: true, terminal: nil)
        h.check(!s2.wantsAnalysis, "a fresh snapshot needs no work")
        s2.play(san: "d4")
        h.check(s2.wantsAnalysis, "moving makes it want a new search")
        s2.autoAnalyze = false
        h.check(!s2.wantsAnalysis, "not with auto-analyse off")
        s2.autoAnalyze = true; s2.autoplaying = true
        h.check(!s2.wantsAnalysis, "not while autoplaying")
        h.check(s2.statusText == "▶ Autoplay...", "autoplay replaces the whole status line")
        s2.autoplaying = false
        h.check(s2.statusText == "1... Black's move", "and stops doing so when it ends")
    } else { h.check(false, "session 2") }

    // 8. terminal positions
    if let mated = newSession("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3") {
        h.check(mated.statusText == "Checkmate!", "fool's mate reads as checkmate")
        h.check(!mated.wantsAnalysis, "a finished game is never analysed")
    } else { h.check(false, "mated session") }
    if let stale = newSession("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1") {
        h.check(stale.statusText == "Stalemate", "stalemate is named")
    } else { h.check(false, "stalemate session") }
    if let bare = newSession("7k/8/6K1/8/8/8/8/8 w - - 0 1") {
        h.check(bare.statusText == "Draw", "insufficient material reads as a draw")
        h.check(bare.outcome.reason == .insufficient, "and names its reason")
    } else { h.check(false, "bare session") }

    // 9. check marker — 1.e4 d5 2.Bb5+ is check, not mate (four blocks are available)
    if let chk = newSession() {
        for m in ["e4", "d5", "Bb5"] { chk.play(san: m) }
        h.check(chk.position.status() == .check, "Bb5 gives check without mating")
        h.check(chk.statusText.hasSuffix(" +"), "a check appends \" +\": \(chk.statusText)")
        h.check(chk.statusText.contains("Black's move"), "and still says whose move it is")
    } else { h.check(false, "check session") }

    // 10. the analysing marker tracks a real search, not the toggle (deviation 2)
    if let an = newSession() {
        an.autoAnalyze = true
        h.check(!an.statusText.contains("(analyzing)"),
                "auto-analyse alone does not claim to be analysing")
        an.analyzing = true
        h.check(an.statusText.contains("\n(analyzing)"), "an in-flight search does")
    } else { h.check(false, "analysing session") }

    // 11. openings, including the carry that keeps a name after leaving the book (spec 12.2)
    if let op = newSession() {
        h.check(op.openingText == nil, "the start position has no name")
        op.play(san: "e4")
        h.check(op.openingText?.hasPrefix("B00") == true,
                "after 1.e4 the book names B00, got \(op.openingText ?? "nil")")
        op.play(san: "c5")
        h.check(op.openingText?.contains("Sicilian") == true, "after 1...c5 it is a Sicilian")
        for m in ["Nf3", "d6", "d4", "cxd4"] { op.play(san: m) }
        h.check(op.openingText == "B50: Sicilian Defense", "six plies in")
        op.play(san: "Nxd4")
        h.check(book.named(op.tree.current.key) == nil, "ply 7 is a pass-through row, not a named line")
        h.check(op.openingText == "B50: Sicilian Defense",
                "an unnamed book position keeps the previous name")
        for m in ["Nf6", "Nc3", "a6"] { op.play(san: m) }
        h.check(op.openingText?.contains("Najdorf") == true, "ten plies in it is the Najdorf")
        for m in ["Be3", "e5", "Nb3", "Be6", "f3"] { op.play(san: m) }
        h.check(op.openingText == "B90: Sicilian Defense: Najdorf Variation, English Attack",
                "and fifteen plies in it has a full name")
        op.play(san: "Be7")
        h.check(!book.contains(op.tree.current.key), "ply 16 is out of book")
        h.check(op.openingText == "B90: Sicilian Defense: Najdorf Variation, English Attack",
                "leaving the book keeps the last named line rather than going blank")
        h.check(op.bookContinuations.isEmpty, "and offers no continuations from out of book")
    } else { h.check(false, "opening session") }
    if let cont = newSession() {
        h.check(cont.bookContinuations.count > 10,
                "the start position has many book continuations, got \(cont.bookContinuations.count)")
        let sans = cont.bookContinuations.map { $0.san }
        h.check(sans == sans.sorted(), "continuations are sorted by SAN")
    } else { h.check(false, "continuations session") }

    // 12. arrows and engine rows come straight from a snapshot (board.tsx:2807-2831)
    if let fake = newSession(), let e4 = fake.position.move(forSAN: "e4"),
       let d4 = fake.position.move(forSAN: "d4") {
        fake.snapshot = AnalysisSnapshot(
            fen: ChessPosition.startFEN, depth: 4, nodes: 100,
            lines: [
                EngineLine(rank: 1, score: .cp(30), pv: [e4],
                           pvSAN: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"], depth: 4),
                EngineLine(rank: 2, score: .cp(20), pv: [d4], pvSAN: ["d4", "d5"], depth: 4),
            ],
            isFinal: true, terminal: nil)
        let ar = fake.arrows
        h.check(ar.count == 2, "one arrow per line")
        h.check(ar[0].from == e4.from, "the best arrow starts where the best move does")
        h.check(ar[0].rank == 0, "ranks are 0-based for the arrow colours")
        h.check(ar[1].rank == 1, "the second line is rank 1")
        let rows = fake.engineRows
        h.check(rows[0].san == "e4", "the row names its move")
        h.check(rows[0].evalText == "+0.3", "the row formats its score, got \(rows[0].evalText)")
        h.check(rows[0].continuation == "e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6",
                "the continuation shows every ply it has, up to pvPreview, "
                + "got \(rows[0].continuation)")
        h.check(AnalysisSession.pvPreview > 6,
                "and pvPreview is past the source's 6, so a deep search is not clipped")
        h.check(rows[1].continuation == "d5", "a short PV shows what it has")
        h.check(!fake.isStale, "a snapshot matching the cursor is fresh")
        h.check(fake.evalParts.cp == 30, "evalParts carries the centipawns")
        h.check(fake.evalParts.mate == nil, "and no mate")
        h.check(fake.evalParts.winner == nil, "and no terminal winner")

        // 12b. The line preview — the state machine behind "tap a line to play it out".
        // `rows[0]` has eight SANs behind a one-move pv, which is exactly the shape the trim in
        // `LinePreview.start` exists for. Mirrored assertion-for-assertion in analysis.js §12b.
        if let trimmed = LinePreview.start(rows[0]) {
            h.check(trimmed.sans.count == 1,
                    "a line with more SANs than moves is trimmed to what can actually be played, "
                    + "got \(trimmed.sans.count)")
            h.check(trimmed.uci.count == trimmed.sans.count, "sans and uci are the same length")
        } else { h.check(false, "a one-move line still previews") }
        h.check(LinePreview.start(EngineRow(rank: 0, evalText: "", san: "", continuation: "",
                                            uci: "", from: -1, to: -1, depth: 0)) == nil,
                "a row with no line has nothing to preview")
    } else { h.check(false, "snapshot session") }

    // 12c. The preview walked over a real four-ply line.
    if let lp = newSession() {
        var walk = lp.position
        var moves: [Move] = []
        for san in ["e4", "e5", "Nf3", "Nc6"] {
            guard let m = walk.move(forSAN: san) else { break }
            moves.append(m)
            walk = walk.makeMove(m)
        }
        lp.snapshot = AnalysisSnapshot(
            fen: ChessPosition.startFEN, depth: 4, nodes: 1,
            lines: [EngineLine(rank: 1, score: .cp(30), pv: moves,
                               pvSAN: ["e4", "e5", "Nf3", "Nc6"], depth: 4)],
            isFinal: true, terminal: nil)
        let row = lp.engineRows[0]
        h.check(row.pvUCI.count == 4, "the row carries the WHOLE line, not just its first move")
        h.check(lp.canPreview(row), "a line computed for this position can be walked")
        if let p1 = LinePreview.start(row) {
            h.check(p1.ply == 1, "a preview enters on the first move")
            h.check(p1.sans.joined(separator: " ") == "e4 e5 Nf3 Nc6", "and labels every ply")
            h.check(p1.rank == 0, "and it remembers which line it came from")

            let toks = p1.tokens
            h.check(toks.count == 4, "one token per ply")
            h.check(toks[0].played && toks[0].isCurrent, "the first token is played and current")
            h.check(!toks[1].played && !toks[1].isCurrent,
                    "the ones ahead of the cursor are neither")
            h.check(toks[3].ply == 4, "tokens are 1-based, so they hand back to jumped(to:)")

            h.check(p1.stepped(-1) == nil, "stepping off the FRONT leaves the preview")
            h.check(p1.stepped(1)?.ply == 2, "stepping forward advances one ply")
            let pEnd = p1.jumped(to: 4)
            h.check(pEnd.ply == 4, "a jump lands on the ply that was tapped")
            h.check(pEnd.stepped(1) == pEnd, "stepping past the END is a no-op, NOT an exit")
            h.check(p1.jumped(to: 9) == p1, "a jump out of range is a no-op")
            h.check(p1.jumped(to: 0) == p1, "and so is a jump to ply 0")
            h.check(p1.canStepForward, "ply 1 of 4 can step forward")
            h.check(!pEnd.canStepForward, "the last ply cannot")
            h.check(p1.movesToCommit.count == 1, "＋ commits only what is on the board")
            h.check(pEnd.movesToCommit.count == 4, "and all of it once the line has been walked")

            if let st1 = lp.previewPosition(p1) {
                h.check(st1.last.uci == "e2e4", "the preview reports the move that got there")
                h.check(st1.position.sideToMove == .black, "and the position after it")
            } else { h.check(false, "the first ply resolves") }
            if let stEnd = lp.previewPosition(pEnd) {
                h.check(stEnd.position.fen == walk.fen,
                        "walking the whole line reaches the line's end position")
            } else { h.check(false, "the last ply resolves") }
            h.check(lp.position.fen == ChessPosition.startFEN,
                    "and the SESSION never moved — nothing was committed")

            // A snapshot can outlive the position it was computed for. Such a line refuses to
            // start AND refuses to walk — the guard that keeps a stale tap from playing nonsense.
            if let stale = newSession(), let d4 = stale.position.move(forSAN: "d4") {
                _ = stale.play(d4)
                stale.snapshot = lp.snapshot
                h.check(!stale.canPreview(row),
                        "a line that no longer plays from here refuses to start")
                h.check(stale.previewPosition(p1) == nil, "and refuses to walk")
            } else { h.check(false, "stale session") }
        } else { h.check(false, "the four-ply line previews") }
    } else { h.check(false, "preview session") }

    // 13. mate and terminal scores
    if let mate = newSession() {
        mate.snapshot = AnalysisSnapshot(fen: ChessPosition.startFEN, depth: 1, nodes: 1,
                                         lines: [], isFinal: true, terminal: nil)
        h.check(mate.evalParts.cp == nil && mate.evalParts.mate == nil,
                "a snapshot with no lines has no score")
        mate.snapshot = AnalysisSnapshot(
            fen: ChessPosition.startFEN, depth: 1, nodes: 1,
            lines: [EngineLine(rank: 1, score: .mate(-2), pv: [], pvSAN: [], depth: 1)],
            isFinal: true, terminal: nil)
        h.check(mate.evalParts.mate == -2, "evalParts carries a mate score")
        mate.snapshot = AnalysisSnapshot(
            fen: ChessPosition.startFEN, depth: 0, nodes: 0, lines: [], isFinal: true,
            terminal: TerminalOutcome(kind: .checkmate, reason: .checkmate, winner: .black))
        h.check(mate.evalParts.winner == .black, "evalParts names the side that delivered mate")
    } else { h.check(false, "mate session") }

    // 14. the board's own inputs
    if let bd = newSession() {
        bd.play(san: "e4")
        h.check(bd.lastMove?.uci == "e2e4", "the last move is what the board highlights")
        bd.goToStart()
        h.check(bd.lastMove == nil, "the root has no last move")
    } else { h.check(false, "board session") }

    // 15. Review state — the 1-based moveIndex mapping is the whole risk here
    if let rv = newSession() {
        for m in ["e4", "e5", "Nf3", "Nc6"] { rv.play(san: m) }
        h.check(rv.review == nil, "a fresh session has no review")
        h.check(rv.reviewSummary == nil, "and no summary")
        h.check(rv.stripTokens.allSatisfy { $0.classification == nil },
                "no strip token carries a classification")

        let rvPlan = ReviewAnnotator.plan(rv.tree)
        h.check(rvPlan.nodes.count == 4, "the plan walked four plies")

        // A hand-built result: moveIndex 1...4 -> nodes[0...3]. Deliberately NOT from the engine, so
        // the mapping is asserted independently of what any search happens to return.
        let evals: [GameReview.Evaluation] = [
            GameReview.Evaluation(evalCp: 0, evalMate: nil, bestMoveSan: nil),
            GameReview.Evaluation(evalCp: 30, evalMate: nil, bestMoveSan: "e4"),
            GameReview.Evaluation(evalCp: -400, evalMate: nil, bestMoveSan: "c5"),
            GameReview.Evaluation(evalCp: 10, evalMate: nil, bestMoveSan: "Nf3"),
            GameReview.Evaluation(evalCp: 0, evalMate: nil, bestMoveSan: "Nc6"),
        ]
        let base = GameReview.review(evaluations: evals, moves: rvPlan.moves)
        let annotated = ReviewAnnotator.annotate(base, moves: rvPlan.moves, bookPlies: [1])
        rv.applyReview(annotated, nodes: rvPlan.nodes)

        h.check(rv.classification(forNodeID: rvPlan.nodes[0].id) == "book",
                "moveIndex 1 maps to nodes[0], not nodes[1]")
        h.check(rv.classification(forNodeID: rvPlan.nodes[1].id) != nil, "moveIndex 2 maps to nodes[1]")
        h.check(rv.classification(forNodeID: rvPlan.nodes[3].id) != nil, "moveIndex 4 maps to nodes[3]")
        h.check(rv.classification(forNodeID: rv.tree.root.id) == nil, "the root is never classified")
        h.check(rv.classification(forNodeID: 9999) == nil, "an unknown id gives nil")

        let moveToks = rv.stripTokens.filter { $0.kind == .move }
        h.check(moveToks.count == 4, "four move tokens")
        h.check(moveToks[0].classification == "book", "the strip carries the first tier")
        h.check(moveToks.allSatisfy { $0.classification != nil }, "and one for every reviewed ply")
        h.check(rv.stripTokens.filter { $0.kind == .number }.allSatisfy { $0.classification == nil },
                "number tokens carry none")

        if let sum = rv.reviewSummary {
            h.check(sum.whiteAccuracy == base.whiteAccuracy, "the summary reports the base accuracy")
            h.check(sum.blackAccuracy == base.blackAccuracy, "for both sides")
            h.check(!sum.rows.isEmpty, "the table has rows")
            h.check(sum.rows.allSatisfy { $0.white > 0 || $0.black > 0 },
                    "and DROPS tiers that are zero on both sides")
            let order = ReviewAnnotator.displayOrder
            let idx = sum.rows.compactMap { order.firstIndex(of: $0.key) }
            h.check(idx == idx.sorted(), "rows follow displayOrder")
            h.check(sum.rows.contains { $0.key == "book" }, "and Book is among them")
            h.check(sum.graph.count == base.evalGraph.count, "one graph point per position")
        } else { h.check(false, "reviewSummary after applyReview") }

        // A variation added after the review must not gain a classification.
        rv.goBack()
        rv.play(san: "Nf6")
        let alts = rv.stripTokens.filter { $0.kind == .alternative }
        h.check(alts.count == 1, "one branch chip")
        h.check(alts[0].classification == nil, "a branch chip is never classified")
        h.check(rv.review != nil, "navigating and branching does not drop the review")

        // Clearing — what a cancelled review must do.
        rv.applyReview(nil, nodes: [])
        h.check(rv.review == nil, "clearing drops the review")
        h.check(rv.reviewSummary == nil, "and the summary")
        h.check(rv.classification(forNodeID: rvPlan.nodes[0].id) == nil, "and every classification")
        h.check(rv.reviewProgress == nil, "and the progress")
    } else { h.check(false, "review session") }

    // 16. The Evaluator steps one position at a time and reports a short run honestly
    if let ev = newSession() {
        for m in ["e4", "e5", "Nf3"] { ev.play(san: m) }
        let p = ReviewAnnotator.plan(ev.tree)
        var walker = ReviewAnnotator.Evaluator(plan: p, limits: SearchLimits(maxDepth: 1))
        h.check(walker.total == 4, "four positions to evaluate")
        h.check(walker.completed == 0, "none done yet")
        h.check(!walker.isFinished, "and not finished")
        var steps = 0
        while walker.step(engine: LocalEngine(), shouldCancel: { false }) { steps += 1 }
        h.check(steps == 4, "one step per position, got \(steps)")
        h.check(walker.completed == 4, "all four completed")
        h.check(walker.isComplete, "a full walk is complete")
        h.check(walker.isFinished, "and finished")
        h.check(walker.evaluations.count == 4, "with one evaluation each")

        var stopper = ReviewAnnotator.Evaluator(plan: p, limits: SearchLimits(maxDepth: 1))
        stopper.step(engine: LocalEngine(), shouldCancel: { false })
        stopper.step(engine: LocalEngine(), shouldCancel: { true })
        h.check(stopper.cancelled, "cancelling is recorded")
        h.check(stopper.isFinished, "and ends the walk")
        h.check(stopper.completed == 1, "with only the completed positions")
        h.check(!stopper.isComplete, "isComplete() is the guard against a short review")
    } else { h.check(false, "evaluator session") }

    // ---- annotations (phase 11) ------------------------------------------------
    // The NAG table and its inverse must agree, or a picked symbol round-trips to a different one.
    if let an = newSession() {
        h.check(AnalysisSession.nagSymbols.count == 14,
                "six move-quality NAGs plus eight position NAGs")
        for (code, sym) in AnalysisSession.nagSymbols {
            h.check(AnalysisSession.nag(forSymbol: sym) == code,
                    "NAG \(code) round-trips through its symbol")
        }
        h.check(AnalysisSession.nagText(0) == "", "NAG 0 renders as nothing")
        h.check(AnalysisSession.nagText(999) == "", "an unknown NAG renders as nothing")
        h.check(AnalysisSession.nag(forSymbol: "nonsense") == 0, "an unknown symbol maps to no NAG")
        // The ⩲/⩱ correction reaches the picker, which is what writes NAGs into the PGN.
        h.check(AnalysisSession.nag(forSymbol: "⩲") == 14,
                "⩲ is $14 — White is slightly better (the source has this backwards)")
        h.check(AnalysisSession.nag(forSymbol: "⩱") == 15, "⩱ is $15 — Black is slightly better")
        h.check(AnalysisSession.nag(forSymbol: "!!") == 3, "!! is $3")
        h.check(AnalysisSession.nag(forSymbol: "?!") == 6, "?! is $6")

        an.play(san: "e4"); let e4id = an.tree.current.id
        an.play(san: "e5")
        h.check(an.annotationSymbol(forNodeID: e4id) == nil, "a move starts unannotated")
        h.check(an.setNAG(3, forNodeID: e4id), "set !! on 1.e4")
        h.check(an.annotationSymbol(forNodeID: e4id) == "!!", "and the overlay shows it")
        h.check(an.stripTokens.first { $0.id == e4id && $0.kind == .move }?.text == "e4!!",
                "the strip appends the glyph to the SAN")
        h.check(an.setNAG(16, forNodeID: e4id), "change it to ±")
        h.check(an.stripTokens.first { $0.id == e4id && $0.kind == .move }?.text == "e4±",
                "a position annotation still shows in the strip")
        h.check(an.annotationSymbol(forNodeID: e4id) == nil,
                "but draws NO badge — renderAnnotationOverlay looks only in MOVE_ANNOTATIONS")
        h.check(an.clearNAG(forNodeID: e4id), "clear it")
        h.check(an.stripTokens.first { $0.id == e4id && $0.kind == .move }?.text == "e4",
                "and a bare SAN comes back")
        h.check(!an.setNAG(3, forNodeID: an.tree.root.id), "the root cannot be annotated")
        h.check(!an.setNAG(3, forNodeID: 99999), "nor can a node that does not exist")
        h.check(an.annotationSymbol(forNodeID: 99999) == nil, "and a missing node has no glyph")
        h.check(an.annotationSquare == an.tree.current.move?.to,
                "the badge square is where the move landed")
        an.goToStart()
        h.check(an.annotationSquare == nil, "and there is none at the root")
    } else { h.check(false, "annotation session") }

    // ---- variations (phase 11) --------------------------------------------------
    if let vr = newSession() {
        vr.play(san: "e4"); vr.play(san: "e5"); vr.play(san: "Nf3")
        let nf3id = vr.tree.current.id
        vr.goBack()
        vr.play(san: "Nc3"); let nc3id = vr.tree.current.id
        vr.play(san: "Nc6")

        guard let mainInfo = vr.variationInfo(nodeID: nf3id),
              let altInfo = vr.variationInfo(nodeID: nc3id) else {
            h.check(false, "variation info for both continuations"); exit(Int32(h.summary()))
        }
        h.check(mainInfo.typeLabel == "MAIN LINE", "2.Nf3 is the main line")
        h.check(!mainInfo.canPromote, "and cannot be promoted")
        h.check(mainInfo.movePrefix == "2.", "a White move reads \"2.\"")
        h.check(altInfo.typeLabel == "SUB-VARIATION", "2.Nc3 is a sub-variation")
        h.check(altInfo.canPromote, "and can be promoted")
        h.check(altInfo.siblingCount == 2, "there are two continuations at that point")
        h.check(altInfo.subtreeCount == 2, "2.Nc3 plus its one continuation")
        h.check(vr.variationInfo(nodeID: vr.tree.root.id) == nil, "the root has no variation card")
        h.check(vr.variationInfo(nodeID: 99999) == nil, "nor does a node that is not there")
        h.check(vr.variationInfo(nodeID: vr.tree.current.id)?.movePrefix == "2...",
                "a Black move reads \"2...\"")
        vr.setNAG(5, forNodeID: nc3id)
        h.check(vr.variationInfo(nodeID: nc3id)?.nagText == "!?", "the card shows the annotation")
        vr.clearNAG(forNodeID: nc3id)

        // Promoting the DEEPEST node must lift the whole line, not one ply — the difference
        // between MoveTree.promote and promoteFully, and invisible on a 1-ply branch.
        vr.play(san: "Bc4"); let bc4id = vr.tree.current.id
        h.check(vr.promote(nodeID: bc4id), "promote the deepest node of the variation")
        h.check(vr.tree.mainlineSANs().joined(separator: " ") == "e4 e5 Nc3 Nc6 Bc4",
                "promoting a leaf lifts every ancestor with it")
        h.check(vr.variationInfo(nodeID: nc3id)?.typeLabel == "MAIN LINE", "2.Nc3 came along")
        h.check(vr.variationInfo(nodeID: nf3id)?.typeLabel == "SUB-VARIATION", "and 2.Nf3 was demoted")
        h.check(!vr.promote(nodeID: vr.tree.root.id), "the root cannot be promoted")
        h.check(!vr.promote(nodeID: 99999), "nor can a missing node")
        h.check(!vr.promote(nodeID: nc3id), "promoting the main line again changes nothing")

        // Deleting the branch the cursor is standing in must not leave a dangling cursor.
        if let nf3 = vr.node(id: nf3id) { vr.goTo(nf3) }
        h.check(vr.tree.current.id == nf3id, "stand inside the branch about to go")
        h.check(vr.deleteBranch(nodeID: nf3id) == 1, "one node removed")
        h.check(vr.tree.current.id != nf3id, "the cursor moved out of the deleted subtree")
        h.check(vr.variationInfo(nodeID: nf3id) == nil, "and the node is gone")
        h.check(vr.deleteBranch(nodeID: vr.tree.root.id) == 0, "the root cannot be deleted")
        h.check(vr.deleteBranch(nodeID: 99999) == 0, "nor can a missing node")
    } else { h.check(false, "variation session") }

    // ---- PGN in and out (phase 11) ----------------------------------------------
    if let im = newSession() {
        let withVars = """
        [Event "Test Cup"]
        [Site "Manila"]
        [White "Ana"]
        [Black "Ben"]
        [Result "1-0"]
        [ECO "C20"]

        1. e4 e5 2. Nf3 $1 (2. Nc3 Nc6) 2... Nc6 1-0

        """
        let res = im.importPGN(withVars)
        h.check(res.ok, "a PGN with a variation imports")
        h.check(res.gamesFound == 1, "one game found")
        h.check(res.moveCount == 4, "four main-line moves")
        h.check(res.errors.isEmpty, "and no parse errors")
        h.check(res.headers["White"] == "Ana", "the headers come back for the save form")
        h.check(res.headers["ECO"] == "C20", "including ECO")
        h.check(res.result == "1-0", "and the result")
        h.check(im.tree.mainlineSANs().joined(separator: " ") == "e4 e5 Nf3 Nc6",
                "the main line is the imported one")
        h.check(im.tree.current.san == "Nc6", "and the cursor lands on the last move")
        h.check(im.snapshot == nil, "importing invalidates any snapshot")
        h.check(im.stripTokens.filter { $0.kind == .alternative }.count == 1,
                "the variation survived as a branch chip")
    } else { h.check(false, "import session") }

    if let bad = newSession() {
        let badRes = bad.importPGN("this is not a pgn at all")
        h.check(!badRes.ok, "nonsense does not import")
        h.check(!badRes.errors.isEmpty, "the tolerant parser still reports what it choked on")
        h.check(bad.tree.mainline().isEmpty, "and the board is left alone")
        h.check(!bad.importPGN("").ok, "the empty string does not import")
        // A failed import must not wipe a game that was already there.
        bad.play(san: "d4"); bad.play(san: "d5")
        h.check(!bad.importPGN("not a pgn").ok, "a failed import over a real game fails")
        h.check(bad.tree.mainlineSANs().joined(separator: " ") == "d4 d5",
                "and leaves that game untouched")
    } else { h.check(false, "bad-import session") }

    if let setupOnly = newSession() {
        let setupText = """
        [SetUp "1"]
        [FEN "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1"]

        *

        """
        let r = setupOnly.importPGN(setupText)
        h.check(r.ok, "a setup-only PGN imports")
        h.check(r.moveCount == 0, "with no moves")
        h.check(setupOnly.tree.initialFEN == "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1",
                "onto its custom position")
    } else { h.check(false, "setup-only session") }

    if let multi = newSession() {
        let two = """
        [White "A"]

        1. e4 *

        [White "B"]

        1. d4 *

        """
        let r = multi.importPGN(two)
        h.check(r.gamesFound == 2, "a two-game PGN reports both")
        h.check(multi.tree.mainlineSANs() == ["e4"], "but loads the first (recorded assumption)")
    } else { h.check(false, "multi-game session") }

    if let ex = newSession(), let back = newSession() {
        h.check(ex.exportPGN() == "", "an untouched start position exports nothing")
        ex.play(san: "e4"); ex.play(san: "c5")
        ex.setNAG(6, forNodeID: ex.tree.current.id)
        let text = ex.exportPGN(headers: ["White": "Ana", "Black": "Ben", "ECO": "B20"], result: "1-0")
        h.check(text.contains("[White \"Ana\"]"), "the export carries its headers")
        h.check(text.contains("[ECO \"B20\"]"), "including the non-roster ones")
        h.check(text.contains("1-0"), "and the result")
        let backRes = back.importPGN(text)
        h.check(backRes.ok, "the export re-imports")
        h.check(back.tree.mainlineSANs() == ["e4", "c5"], "with the same moves")
        h.check(back.tree.current.nag == 6, "and the NAG survived the round trip")
        h.check(back.exportPGN(headers: backRes.headers, result: backRes.result) == text,
                "and re-exporting is byte-identical")
    } else { h.check(false, "export session") }

    // ---- applying an edited position (phase 11) ---------------------------------
    if let ed = newSession() {
        ed.play(san: "e4")
        guard let endgame = ChessPosition(fen: "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1") else {
            h.check(false, "the endgame FEN parses"); exit(Int32(h.summary()))
        }
        h.check(ed.applyEditedPosition(endgame), "a legal position applies")
        h.check(ed.tree.initialFEN == "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1", "the tree restarts from it")
        h.check(ed.tree.mainline().isEmpty, "with no moves")
        h.check(ed.position.sideToMove == .white, "and White to move")
        h.check(ed.snapshot == nil, "the snapshot went with the old game")
        ed.autoplaying = true
        ed.applyEditedPosition(endgame)
        h.check(!ed.autoplaying, "swapping the game out stops autoplay")
        ed.selected = 12
        ed.applyEditedPosition(endgame)
        h.check(ed.selected == nil, "and the selection goes with the old board")
        // A custom start survives an export/import round trip, which the SOURCE's does not: its
        // generatePgn emits movetext only, so a setup game does not survive a save (phase-10 bug #1).
        ed.play(san: "e4")
        let edText = ed.exportPGN()
        h.check(edText.contains("[FEN \"8/8/8/3k4/8/8/4P3/4K3 w - - 0 1\"]"),
                "the export carries a [FEN] tag for a custom start")
        if let edBack = newSession() {
            h.check(edBack.importPGN(edText).ok, "and it re-imports")
            h.check(edBack.tree.initialFEN == "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1",
                    "onto the same custom position")
        } else { h.check(false, "custom-start re-import session") }
    } else { h.check(false, "edited-position session") }
}

// MARK: - 5d. Setup Position (edit mode)
//
// Hand-authored on both sides, like `draw_rules` and `analysis_session`: there is no PHP oracle for
// a board editor. The expectations are reasoned from board.tsx (line numbers in the comments), not
// copied from the JS twin's output, and the labels match web-demo/js/position-editor.js's selfTest
// so the two tables can be diffed by eye.

h.begin("position_editor")
do {
    // ---- palette -------------------------------------------------------------
    h.check(PositionEditor.whitePieceKeys == ["K", "Q", "R", "B", "N", "P"],
            "white palette order matches board.tsx:276")
    h.check(PositionEditor.blackPieceKeys == ["k", "q", "r", "b", "n", "p"],
            "black palette order matches board.tsx:277")
    for k in PositionEditor.whitePieceKeys + PositionEditor.blackPieceKeys {
        h.check(PositionEditor.key(for: PositionEditor.piece(forKey: k)) == k, "round trip \(k)")
    }
    h.check(PositionEditor.piece(forKey: "K")?.color == .white, "uppercase is White")
    h.check(PositionEditor.piece(forKey: "k")?.color == .black, "lowercase is Black")
    h.check(PositionEditor.piece(forKey: "x") == nil, "an unknown letter is not a piece")
    h.check(PositionEditor.piece(forKey: "") == nil, "the empty string is not a piece")
    h.check(PositionEditor.piece(forKey: "KQ") == nil, "a two-character key is not a piece")
    h.check(PositionEditor.key(for: nil) == nil, "no piece, no key")

    // ---- create --------------------------------------------------------------
    var ed = PositionEditor()
    h.check(ed.fen == ChessPosition.startFEN, "a fresh editor is the start position")
    h.check(ed.sideToMove == .white, "White to move by default")
    h.check(ed.castleWK && ed.castleWQ && ed.castleBK && ed.castleBQ, "all four rights start on")
    h.check(PositionEditor(fen: "8/8/8/8/8/8/8/K6k w - - 0 1").fen == "8/8/8/8/8/8/8/K6k w - - 0 1",
            "create from a FEN")
    h.check(PositionEditor(fen: "not a fen").fen == ChessPosition.startFEN,
            "a broken FEN falls back to the start position")
    // A struct is a value: copying must not alias the squares.
    var copy = ed
    copy.put("Q", at: 28)
    h.check(ed.squares[28] == nil, "a copy does not alias the original squares")

    // ---- put / remove / clear ------------------------------------------------
    var ed2 = PositionEditor()
    ed2.clear()
    h.check(ed2.fen.split(separator: " ")[0] == "8/8/8/8/8/8/8/8", "clear empties the board")
    h.check(!ed2.castleWK && !ed2.castleWQ && !ed2.castleBK && !ed2.castleBQ,
            "clear drops the castling toggles with the rooks")
    h.check(ed2.put("K", at: 4), "place a white king on e1")
    h.check(ed2.put("k", at: 60), "place a black king on e8")
    h.check(ed2.fen.split(separator: " ")[0] == "4k3/8/8/8/8/8/8/4K3", "the kings are where they were put")
    h.check(!ed2.put("K", at: 64), "a square past the board is refused")
    h.check(!ed2.put("K", at: -1), "a negative square is refused")
    h.check(!ed2.put("Z", at: 20), "an unknown piece key is refused")
    h.check(ed2.remove(at: 4), "removing an occupied square reports true")
    h.check(!ed2.remove(at: 4), "removing an empty square reports false")
    h.check(!ed2.remove(at: 99), "removing off-board reports false")
    ed2.put("K", at: 4)

    // ---- side to move --------------------------------------------------------
    h.check(ed2.toggleSideToMove() == .black, "toggle to Black")
    h.check(ed2.fen.split(separator: " ")[1] == "b", "and the FEN says so")
    h.check(ed2.toggleSideToMove() == .white, "toggle back to White")

    // ---- reset ---------------------------------------------------------------
    var ed3 = PositionEditor(fen: "8/8/8/8/8/8/8/K6k b - - 0 1")
    ed3.reset()
    h.check(ed3.fen == ChessPosition.startFEN, "reset restores the start position, side and rights")

    // ---- loadFEN -------------------------------------------------------------
    var ed4 = PositionEditor()
    h.check(ed4.loadFEN("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1"), "a legal FEN loads")
    h.check(ed4.sideToMove == .black, "loadFEN syncs the turn (board.tsx:2541)")
    h.check(ed4.castleWK && ed4.castleWQ && ed4.castleBK && ed4.castleBQ,
            "loadFEN syncs all four castling toggles (board.tsx:2542)")
    // The trim is load-bearing HERE, unlike in the JS twin: ChessPosition(fen:) splits on the SPACE
    // character alone, so a tab-wrapped FEN pasted from a web page would be refused without it.
    h.check(ed4.loadFEN("\t8/8/8/8/8/8/8/K6k w - - 0 1\n"), "a tab/newline wrapped FEN is trimmed and loads")
    h.check(ed4.fen == "8/8/8/8/8/8/8/K6k w - - 0 1", "and the trimmed FEN is what loaded")
    h.check(!ed4.loadFEN("garbage"), "a broken FEN is refused")
    h.check(ed4.fen == "8/8/8/8/8/8/8/K6k w - - 0 1", "and a refused load changes nothing")
    h.check(!ed4.loadFEN(""), "the empty string is refused")
    h.check(!ed4.loadFEN("   \t \n  "), "whitespace alone is not a FEN")
    h.check(ed4.loadFEN("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"),
            "a FEN carrying an ep square loads")
    h.check(ed4.fen.split(separator: " ")[3] == "-", "but the editor never emits an en-passant square")

    // ---- castling normalisation ----------------------------------------------
    var ed5 = PositionEditor()
    ed5.remove(at: 7)
    h.check(ed5.fen.split(separator: " ")[2] == "Qkq", "no h1 rook, no white kingside right")
    ed5.remove(at: 0)
    h.check(ed5.fen.split(separator: " ")[2] == "kq", "no a1 rook either")
    var ed6 = PositionEditor()
    ed6.remove(at: 4); ed6.put("K", at: 12)
    h.check(ed6.fen.split(separator: " ")[2] == "kq", "a king off its home square loses both white rights")
    var ed6b = PositionEditor()
    ed6b.remove(at: 60); ed6b.put("k", at: 52)
    h.check(ed6b.fen.split(separator: " ")[2] == "KQ", "a black king off e8 loses both black rights")
    var ed6c = PositionEditor()
    ed6c.remove(at: 63)
    h.check(ed6c.fen.split(separator: " ")[2] == "KQq", "no h8 rook, no black kingside right")
    var ed6d = PositionEditor()
    ed6d.remove(at: 56)
    h.check(ed6d.fen.split(separator: " ")[2] == "KQk", "no a8 rook, no black queenside right")
    var ed7 = PositionEditor()
    ed7.castleWK = false; ed7.castleBQ = false
    h.check(ed7.fen.split(separator: " ")[2] == "Qk", "the toggles themselves are honoured")
    var ed8 = PositionEditor()
    ed8.clear(); ed8.put("K", at: 4); ed8.put("k", at: 60)
    ed8.castleWK = true; ed8.castleWQ = true; ed8.castleBK = true; ed8.castleBQ = true
    h.check(ed8.fen.split(separator: " ")[2] == "-",
            "ticking every box with no rooks on the board yields no rights")
    let nc = PositionEditor().normalizedCastling
    h.check(nc.wk && nc.wq && nc.bk && nc.bq, "the start position keeps all four")

    // ---- validation ----------------------------------------------------------
    func issues(_ e: PositionEditor) -> String { e.validate().map(\.rawValue).joined(separator: ",") }

    let v = PositionEditor()
    h.check(issues(v) == "", "the start position is valid")
    h.check(v.isValid, "isValid agrees")
    h.check(v.firstIssueText == nil, "and there is no banner")

    var noKings = PositionEditor(); noKings.clear()
    h.check(issues(noKings) == "whiteKingMissing,blackKingMissing", "an empty board is missing both kings")
    h.check(noKings.firstIssueText == "White king is missing.", "the message is the source's, verbatim")

    var oneKing = PositionEditor(); oneKing.clear(); oneKing.put("K", at: 0)
    h.check(issues(oneKing) == "blackKingMissing", "a lone white king is missing its opponent")
    h.check(oneKing.firstIssueText == "Black king is missing.", "second message, also verbatim")

    var twoWhite = PositionEditor(); twoWhite.clear()
    twoWhite.put("K", at: 0); twoWhite.put("K", at: 2); twoWhite.put("k", at: 63)
    h.check(issues(twoWhite) == "tooManyWhiteKings", "two white kings is refused")
    var twoBlack = PositionEditor(); twoBlack.clear()
    twoBlack.put("K", at: 0); twoBlack.put("k", at: 61); twoBlack.put("k", at: 63)
    h.check(issues(twoBlack) == "tooManyBlackKings", "two black kings is refused")

    var adj = PositionEditor(); adj.clear(); adj.put("K", at: 0); adj.put("k", at: 1)
    h.check(issues(adj) == "kingsAdjacent", "side by side")
    h.check(adj.firstIssueText == "Kings cannot be adjacent — illegal position.", "the source's wording")
    var diag = PositionEditor(); diag.clear(); diag.put("K", at: 0); diag.put("k", at: 9)
    h.check(issues(diag) == "kingsAdjacent", "diagonally adjacent counts too")
    var apart = PositionEditor(); apart.clear(); apart.put("K", at: 0); apart.put("k", at: 18)
    h.check(issues(apart) == "", "a knight's move apart is fine")
    var sameFile = PositionEditor(); sameFile.clear(); sameFile.put("K", at: 0); sameFile.put("k", at: 8)
    h.check(issues(sameFile) == "kingsAdjacent", "one rank apart on the same file")

    var pawn8 = PositionEditor(); pawn8.clear()
    pawn8.put("K", at: 0); pawn8.put("k", at: 63); pawn8.put("P", at: 56)
    h.check(issues(pawn8) == "pawnOnBackRank", "a white pawn on rank 8")
    var pawn1 = PositionEditor(); pawn1.clear()
    pawn1.put("K", at: 4); pawn1.put("k", at: 60); pawn1.put("p", at: 1)
    h.check(issues(pawn1) == "pawnOnBackRank", "a black pawn on rank 1")
    var pawn2 = PositionEditor(); pawn2.clear()
    pawn2.put("K", at: 4); pawn2.put("k", at: 60); pawn2.put("P", at: 8)
    h.check(issues(pawn2) == "", "a pawn on rank 2 is ordinary")

    // The side NOT to move must not already be in check — what chess.js refused for the source.
    h.check(issues(PositionEditor(fen: "4k3/8/8/8/8/8/8/4R2K w - - 0 1")) == "sideNotToMoveInCheck",
            "Black is in check but it is White to move")
    h.check(issues(PositionEditor(fen: "4k3/8/8/8/8/8/8/4R2K b - - 0 1")) == "",
            "the same board with Black to move is a legal check")
    h.check(issues(PositionEditor(fen: "4k3/8/8/8/8/8/8/R6K w - - 0 1")) == "", "no check either way")
    h.check(issues(PositionEditor(fen: "3k3r/8/8/8/8/8/8/7K b - - 0 1")) == "sideNotToMoveInCheck",
            "and it works the other way round too")

    // Order is fixed, so the banner does not flicker between renders.
    var many = PositionEditor(); many.clear()
    many.put("K", at: 0); many.put("K", at: 1); many.put("k", at: 2); many.put("P", at: 56)
    h.check(issues(many) == "tooManyWhiteKings,kingsAdjacent,pawnOnBackRank",
            "issues come back in a fixed order")
    h.check(PositionEditor.Issue.kingsAdjacent.text.contains("adjacent"), "issue text is looked up")
    h.check(PositionEditor.Issue.allCases.count == 7, "seven ways a board can be refused")

    // ---- apply ----------------------------------------------------------------
    h.check(noKings.apply() == nil, "an invalid board applies to nothing")
    let good = PositionEditor(fen: "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1")
    guard let applied = good.apply() else {
        h.check(false, "a legal board applies"); exit(Int32(h.summary()))
    }
    h.check(applied.fen == "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1", "and reproduces its own FEN")
    h.check(!applied.legalMoves().isEmpty, "the applied position generates moves")
    h.check(good.makeTree() != nil, "and it makes a tree")
    h.check(noKings.makeTree() == nil, "an invalid board makes none")
    // Apply always resets the clocks — `new Chess(fen)` in the source does not preserve them either.
    let clocks = PositionEditor(fen: "8/8/8/3k4/8/8/4P3/4K3 w - - 37 99")
    h.check(clocks.fen.split(separator: " ").dropFirst(4).joined(separator: " ") == "0 1",
            "the editor always emits fresh clocks")

    // A round trip through apply is stable — the property the move tree depends on.
    for probe in ["8/8/8/8/8/8/8/K6k w - - 0 1",
                  "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
                  "8/5k2/8/8/8/8/2P5/6K1 b - - 0 1",
                  "4k3/8/4K3/8/8/8/8/8 w - - 0 1"] {
        let e = PositionEditor(fen: probe)
        guard let out = e.apply() else { h.check(false, "probe \(probe) should apply"); continue }
        h.check(out.fen == e.fen, "apply round trip: \(probe)")
    }
}

// MARK: - 5c. Analysis store (the saved-game library)
//
// Hand-authored on both sides, like `analysis_session`. The strongest assertion here is the
// CANONICAL DOCUMENT: the same JSON string is hardcoded in `web-demo/js/analysis-store.js`, and each
// language must decode it to the same records. That is a genuine cross-language contract, not two
// implementations agreeing with themselves — and it is only possible because the store is plain
// JSON on both sides.

h.begin("analysis_store")
do {
    // Keep byte-identical with CANONICAL in web-demo/js/analysis-store.js.
    let canonical = """
    {"version":1,"nextSessionId":3,"nextFolderId":5,\
    "folders":[\
    {"id":1,"name":"Opening Repertoire","color":"#4CAF50","sortOrder":1,"isDefault":true,"createdAt":1000},\
    {"id":4,"name":"Endgames","color":"#FDB022","sortOrder":4,"isDefault":false,"createdAt":2000}],\
    "sessions":[\
    {"id":1,"folderId":1,"title":"Najdorf line","notes":null,"pgn":"1. e4 c5 *",\
    "initialFen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",\
    "result":null,"whitePlayer":"Ana","blackPlayer":"Bo","whiteRating":1850,"blackRating":1720,\
    "eventName":"Club night","gameDate":"2026-02-14","timeControl":"15+10","location":"Cebu",\
    "roundInfo":"3","eco":"B90","createdAt":1000,"updatedAt":3000},\
    {"id":2,"folderId":null,"title":"Untitled Analysis","notes":"scratch","pgn":"1. d4 *",\
    "initialFen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",\
    "result":"1-0","whitePlayer":null,"blackPlayer":null,"whiteRating":null,"blackRating":null,\
    "eventName":null,"gameDate":null,"timeControl":null,"location":null,\
    "roundInfo":null,"eco":null,"createdAt":2000,"updatedAt":2000}],\
    "drafts":{}}
    """

    // 1. an empty library
    var lib = AnalysisLibrary()
    h.check(lib.version == AnalysisStore.libraryVersion, "a fresh library carries its version")
    h.check(lib.sessions.isEmpty, "no sessions")
    h.check(lib.folders.isEmpty, "no folders")
    h.check(AnalysisStore.sessions(lib).isEmpty, "the list is empty")
    h.check(AnalysisStore.draft(&lib, mode: AnalysisStore.draftNew, now: 0) == nil, "and no draft")

    // 2. seeding is idempotent and matches the server's own three
    AnalysisStore.seedDefaultFolders(&lib, now: 1000)
    h.check(lib.folders.count == 3, "three defaults are seeded")
    h.check(AnalysisStore.folders(lib).map { $0.name }.joined(separator: ", ")
            == "Opening Repertoire, Setup Position, My Games", "in the server's order")
    h.check(AnalysisStore.folders(lib)[0].color == "#4CAF50", "with its colour")
    h.check(AnalysisStore.folders(lib).allSatisfy { $0.isDefault }, "all marked default")
    AnalysisStore.seedDefaultFolders(&lib, now: 2000)
    h.check(lib.folders.count == 3, "seeding twice adds nothing")

    // 3. folder CRUD
    guard let custom = AnalysisStore.createFolder(&lib, name: "  Endgames  ", now: 2000) else {
        h.check(false, "createFolder")
        exit(Int32(h.summary()))
    }
    h.check(custom.name == "Endgames", "a new folder is trimmed")
    h.check(custom.color == AnalysisStore.defaultFolderColor, "and gets the default colour")
    h.check(custom.sortOrder == 4, "sortOrder is max + 1")
    h.check(!custom.isDefault, "and it is not a default")
    h.check(AnalysisStore.createFolder(&lib, name: "   ", now: 2000) == nil, "a blank name is rejected")
    let longName = AnalysisStore.createFolder(&lib, name: String(repeating: "x", count: 200), now: 2000)
    h.check(longName?.name.count == AnalysisStore.Limits.folderName, "a long name is clamped")
    if let longName { AnalysisStore.deleteFolder(&lib, id: longName.id) }
    h.check(AnalysisStore.renameFolder(&lib, id: custom.id, name: "Rook endings"),
            "a custom folder renames")
    h.check(AnalysisStore.folder(lib, id: custom.id)?.name == "Rook endings", "and keeps the name")
    let firstDefault = AnalysisStore.folders(lib)[0].id
    h.check(!AnalysisStore.renameFolder(&lib, id: firstDefault, name: "Nope"),
            "a DEFAULT folder refuses to rename")
    h.check(!AnalysisStore.deleteFolder(&lib, id: firstDefault), "and refuses to delete")
    h.check(!AnalysisStore.renameFolder(&lib, id: 9999, name: "Ghost"), "an unknown id refuses")

    // 4. saving
    guard let s1 = AnalysisStore.save(&lib, AnalysisStore.SaveFields(
        pgn: "1. e4 c5 *", title: "  Najdorf line  ", folderID: custom.id,
        whitePlayer: "Ana", blackPlayer: "Bo", whiteRating: "1850", blackRating: "1720",
        eventName: "Club night", gameDate: "2026-02-14", timeControl: "15+10",
        location: "Cebu", roundInfo: "3", eco: "B90"), now: 1000) else {
        h.check(false, "save")
        exit(Int32(h.summary()))
    }
    h.check(s1.id == 1, "the first session gets id 1")
    h.check(s1.title == "Najdorf line", "the title is trimmed")
    h.check(s1.whiteRating == 1850, "a numeric string rating becomes a number")
    h.check(s1.notes == nil, "an absent field is nil, not empty")
    h.check(s1.initialFEN == ChessPosition.startFEN, "initialFEN defaults to the standard start")
    h.check(s1.createdAt == 1000 && s1.updatedAt == 1000, "both stamps are set")
    h.check(AnalysisStore.save(&lib, AnalysisStore.SaveFields(pgn: "   "), now: 1000) == nil,
            "a blank PGN is refused")

    let untitled = AnalysisStore.save(&lib, AnalysisStore.SaveFields(
        pgn: "1. d4 *", notes: "scratch", result: "1-0"), now: 2000)
    h.check(untitled?.title == AnalysisStore.defaultTitle, "no title falls back to the default")
    h.check(untitled?.folderID == nil, "and it is unfiled")
    h.check(untitled?.id == 2, "ids keep counting")

    let starred = AnalysisStore.save(&lib, AnalysisStore.SaveFields(pgn: "1. c4 *", result: "*"), now: 2100)
    h.check(starred?.result == nil, "a \"*\" result is stored as nil")
    if let starred { AnalysisStore.deleteSession(&lib, id: starred.id) }

    // 5. updating in place
    let updated = AnalysisStore.save(&lib, AnalysisStore.SaveFields(
        id: s1.id, pgn: "1. e4 c5 2. Nf3 *", title: "Najdorf line"), now: 3000)
    h.check(updated?.id == s1.id, "an existing id updates rather than inserting")
    h.check(lib.sessions.count == 2, "the count is unchanged")
    h.check(updated?.createdAt == 1000, "createdAt is preserved")
    h.check(updated?.updatedAt == 3000, "updatedAt moves")
    h.check(updated?.whitePlayer == nil, "fields absent from the update are cleared, as a PUT would")
    let ghost = AnalysisStore.save(&lib, AnalysisStore.SaveFields(id: 9999, pgn: "1. f4 *"), now: 3100)
    h.check(ghost?.id == 4, "an id that no longer exists inserts with a FRESH id (3 was used)")
    if let ghost { AnalysisStore.deleteSession(&lib, id: ghost.id) }

    // 6. filtering, search and order
    AnalysisStore.save(&lib, AnalysisStore.SaveFields(
        id: s1.id, pgn: "1. e4 c5 2. Nf3 *", title: "Najdorf line", folderID: custom.id,
        whitePlayer: "Zubov", blackPlayer: "Bo"), now: 3000)
    h.check(AnalysisStore.sessions(lib).count == 2, "all shows both")
    h.check(AnalysisStore.sessions(lib).first?.id == s1.id, "ordered by updatedAt descending")
    h.check(AnalysisStore.sessions(lib, filter: .unfiled).count == 1, "unfiled shows one")
    h.check(AnalysisStore.sessions(lib, filter: .unfiled).first?.id == untitled?.id, "the right one")
    h.check(AnalysisStore.sessions(lib, filter: .folder(custom.id)).count == 1, "a folder filters")
    h.check(AnalysisStore.sessions(lib, search: "najdorf").count == 1, "search is case-insensitive")
    h.check(AnalysisStore.sessions(lib, search: "ZUB").count == 1, "and matches a player")
    h.check(AnalysisStore.sessions(lib, search: "scratch").count == 1, "and the notes")
    h.check(AnalysisStore.sessions(lib, search: "nothing here").isEmpty, "a miss returns nothing")
    h.check(AnalysisStore.sessions(lib, search: "ana").count == 1,
            "it matches mid-word, as ilike %term% does")
    h.check(AnalysisStore.sessions(lib, filter: .folder(custom.id), search: "scratch").isEmpty,
            "filter and search combine")
    h.check(AnalysisStore.sessionCount(lib, folderID: custom.id) == 1, "the chip count for a folder")
    h.check(AnalysisStore.sessionCount(lib, folderID: nil) == 1, "and for unfiled")

    // 7. deleting a folder UNFILES its games — it must never delete them
    h.check(AnalysisStore.deleteFolder(&lib, id: custom.id), "a custom folder deletes")
    h.check(lib.sessions.count == 2, "its sessions survive")
    h.check(AnalysisStore.session(lib, id: s1.id)?.folderID == nil, "and become unfiled")
    h.check(AnalysisStore.sessionCount(lib, folderID: nil) == 2, "so unfiled now holds both")
    h.check(AnalysisStore.folder(lib, id: custom.id) == nil, "the folder itself is gone")

    let orphan = AnalysisStore.save(&lib, AnalysisStore.SaveFields(pgn: "1. g3 *", folderID: 9999), now: 4000)
    h.check(orphan?.folderID == nil, "an unknown folderID is treated as unfiled")
    if let orphan { AnalysisStore.deleteSession(&lib, id: orphan.id) }

    if let uid = untitled?.id {
        h.check(AnalysisStore.deleteSession(&lib, id: uid), "deleting reports success")
        h.check(!AnalysisStore.deleteSession(&lib, id: uid), "deleting twice does not")
    }
    h.check(lib.sessions.count == 1, "and the count drops")

    // 8. drafts — the TTL is why time is injected
    var d = AnalysisLibrary()
    AnalysisStore.putDraft(&d, mode: AnalysisStore.draftNew,
                           AnalysisDraft(pgn: "1. e4 *", initialFEN: ChessPosition.startFEN,
                                         timestamp: 0), now: 10_000)
    h.check(AnalysisStore.draft(&d, mode: AnalysisStore.draftNew, now: 10_000)?.pgn == "1. e4 *",
            "a fresh draft reads back")
    h.check(AnalysisStore.draft(&d, mode: AnalysisStore.draftNew,
                                now: 10_000 + AnalysisStore.draftTTLMs) != nil,
            "exactly at the TTL it is still good")
    h.check(AnalysisStore.draft(&d, mode: AnalysisStore.draftNew,
                                now: 10_000 + AnalysisStore.draftTTLMs + 1) == nil,
            "one millisecond later it is stale")
    h.check(d.drafts[AnalysisStore.draftNew] == nil, "and reading a stale draft PRUNES it")

    AnalysisStore.putDraft(&d, mode: AnalysisStore.draftOpenFile,
                           AnalysisDraft(pgn: "1. d4 *", initialFEN: ChessPosition.startFEN,
                                         timestamp: 0, sessionID: 7, title: "T", notes: "N",
                                         folderID: 2), now: 5000)
    let od = AnalysisStore.draft(&d, mode: AnalysisStore.draftOpenFile, now: 5000)
    h.check(od?.sessionID == 7, "the openfile draft carries its session id")
    h.check(od?.title == "T", "its title")
    h.check(od?.folderID == 2, "and its folder")
    h.check(AnalysisStore.draft(&d, mode: AnalysisStore.draftSetup, now: 5000) == nil,
            "the slots are independent")
    h.check(AnalysisStore.clearDraft(&d, mode: AnalysisStore.draftOpenFile), "clearing succeeds")
    h.check(!AnalysisStore.clearDraft(&d, mode: AnalysisStore.draftOpenFile), "twice does not")

    h.check(!AnalysisStore.draftWorthKeeping(pgn: "", initialFEN: ChessPosition.startFEN),
            "an empty board at the start is not worth saving")
    h.check(AnalysisStore.draftWorthKeeping(pgn: "1. e4 *", initialFEN: ChessPosition.startFEN),
            "moves are")
    h.check(AnalysisStore.draftWorthKeeping(pgn: "", initialFEN: "8/8/8/8/8/8/8/K6k w - - 0 1"),
            "so is a custom start with no moves")

    // 9. normalize — ids recover past whatever is present
    let recovered = AnalysisStore.normalize(AnalysisLibrary(
        folders: [AnalysisFolderRecord(id: 4, name: "F", color: "#fff", sortOrder: 1,
                                       isDefault: false, createdAt: 0)],
        sessions: []))
    h.check(recovered.nextFolderID == 5, "next folder id recovers past the highest present")
    h.check(AnalysisStore.decode("nonsense").sessions.isEmpty, "garbage decodes to an empty library")
    h.check(AnalysisStore.decode("{}").folders.isEmpty, "and so does an empty object")

    // 10. THE CANONICAL DOCUMENT — the cross-language contract
    let parsed = AnalysisStore.decode(canonical)
    h.check(parsed.sessions.count == 2, "the canonical document has two sessions")
    h.check(parsed.folders.count == 2, "and two folders")
    h.check(parsed.nextSessionID == 3, "its next session id")
    h.check(parsed.nextFolderID == 5, "and next folder id")
    h.check(AnalysisStore.session(parsed, id: 1)?.title == "Najdorf line", "session 1 is the Najdorf")
    h.check(AnalysisStore.session(parsed, id: 1)?.whiteRating == 1850, "with its rating as a number")
    h.check(AnalysisStore.session(parsed, id: 1)?.eco == "B90", "and its ECO")
    h.check(AnalysisStore.session(parsed, id: 1)?.gameDate == "2026-02-14", "and its date")
    h.check(AnalysisStore.session(parsed, id: 1)?.notes == nil, "a null decodes to nil")
    h.check(AnalysisStore.session(parsed, id: 2)?.folderID == nil, "session 2 is unfiled")
    h.check(AnalysisStore.session(parsed, id: 2)?.result == "1-0", "and decisive")
    h.check(AnalysisStore.folder(parsed, id: 4)?.name == "Endgames", "the custom folder came through")
    h.check(AnalysisStore.folder(parsed, id: 1)?.isDefault == true, "and the default is marked")
    h.check(AnalysisStore.sessions(parsed).first?.id == 1, "the newest-updated sorts first")
    h.check(AnalysisStore.sessions(parsed, filter: .unfiled).count == 1, "one is unfiled")
    h.check(AnalysisStore.sessionCount(parsed, folderID: 1) == 1, "folder 1 holds one game")
    h.check(parsed.drafts.isEmpty, "and it carries no drafts")
    // Our own round trip is a fixpoint. Byte-equality with the JS string is deliberately NOT
    // claimed: JSONEncoder(.sortedKeys) and JSON.stringify order keys differently.
    h.check(AnalysisStore.decode(AnalysisStore.encode(parsed)) == parsed,
            "encode then decode is a fixpoint")
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

// MARK: - Puzzle Hub (spec Parts 4, 5, 7, 8, 15)
//
// No goldens: the PHP oracle covers the puzzle ARITHMETIC (`rating`, `serving`, `streak_*`,
// `rush`, `daily_goal`) and those groups already pass above. What follows is the layer built on
// top of them — the solver state machine, the selection ladders over a pool, and the local
// progress store — which has no server counterpart to generate vectors from.
//
// The fixtures are real rows from the bundled corpus and their expectations were COMPUTED by
// `web-demo/js/puzzle-session.js` (emitted by `tools/qa/gen_puzzle_fixtures.js`), not typed out.
// `tools/qa/replay_puzzle_core.js` re-derives every one of them from this source text, so a later
// hand-edit here that drifts from the JS is caught even though `swift` cannot run on the
// authoring checkout.

// GENERATED FIXTURES — real rows from the bundled corpus, emitted by
// tools/qa/gen_puzzle_fixtures.js. Ids are SHIPPING-CORPUS ids resolved by lichess_id,
// not the browser slice's renumbered ones. Expectations were COMPUTED by
// web-demo/js/puzzle-session.js, not typed by hand.
struct PZFixture { let key: String; let id: Int; let lichessId: String; let fen: String
                   let moves: [String]
                   let rating: Int; let themes: [String]; let userIsWhite: Bool
                   let flipped: Bool; let wrongMove: String; let pgn: String }
let pzFixtures: [PZFixture] = [
    PZFixture(key: "mate1", id: 711,
              lichessId: "1aq1P", fen: "6k1/1b3ppp/1p2p3/p7/6P1/2rp1N2/1r2BK1P/3R4 b - - 1 41",
              moves: ["d3e2", "d1d8"],
              rating: 408, themes: ["backRankMate", "endgame", "mate", "mateIn1", "oneMove"],
              userIsWhite: true, flipped: false,
              wrongMove: "d1e1", pgn: "41... dxe2 42. Rd8# *"),
    PZFixture(key: "four", id: 228,
              lichessId: "3LbEZ", fen: "7k/4R2p/1p2p2P/2pp1r2/8/P4p1K/1PP5/8 b - - 1 37",
              moves: ["f3f2", "e7e8", "f5f8", "e8f8"],
              rating: 400, themes: ["endgame", "mate", "mateIn2", "rookEndgame", "short"],
              userIsWhite: true, flipped: false,
              wrongMove: "b2b3", pgn: "37... f2 38. Re8+ Rf8 39. Rxf8# *"),
    PZFixture(key: "eight", id: 16103,
              lichessId: "3ef1K", fen: "8/8/8/R1p2rkp/P1K5/8/8/8 w - - 0 46",
              moves: ["a5c5", "f5c5", "c4c5", "h5h4", "a4a5", "h4h3", "a5a6", "h3h2", "a6a7", "h2h1q"],
              rating: 795, themes: ["advancedPawn", "crushing", "endgame", "promotion", "quietMove", "rookEndgame", "veryLong"],
              userIsWhite: false, flipped: true,
              wrongMove: "f5e5", pgn: "46. Rxc5 Rxc5+ 47. Kxc5 h4 48. a5 h3 49. a6 h2 50. a7 h1=Q *"),
    PZFixture(key: "promo", id: 9645,
              lichessId: "5SvTF", fen: "2kRr3/1bP3pp/1B6/1P6/4p3/3p2P1/4P2P/6K1 b - - 3 36",
              moves: ["e8d8", "c7d8q"],
              rating: 652, themes: ["advancedPawn", "endgame", "master", "mate", "mateIn1", "oneMove", "promotion"],
              userIsWhite: true, flipped: false,
              wrongMove: "g1h1", pgn: "36... Rxd8 37. cxd8=Q# *"),
    PZFixture(key: "solverBlack", id: 739,
              lichessId: "1sxiH", fen: "4r1k1/p4ppp/Q7/8/8/6P1/P5PP/2R1r2K w - - 1 30",
              moves: ["c1e1", "e8e1", "a6f1", "e1f1"],
              rating: 409, themes: ["backRankMate", "endgame", "mate", "mateIn2", "queenRookEndgame", "short"],
              userIsWhite: false, flipped: true,
              wrongMove: "f7f6", pgn: "30. Rxe1 Rxe1+ 31. Qf1 Rxf1# *"),
    PZFixture(key: "solverWhite", id: 228,
              lichessId: "3LbEZ", fen: "7k/4R2p/1p2p2P/2pp1r2/8/P4p1K/1PP5/8 b - - 1 37",
              moves: ["f3f2", "e7e8", "f5f8", "e8f8"],
              rating: 400, themes: ["endgame", "mate", "mateIn2", "rookEndgame", "short"],
              userIsWhite: true, flipped: false,
              wrongMove: "b2b3", pgn: "37... f2 38. Re8+ Rf8 39. Rxf8# *"),
    PZFixture(key: "offbook", id: 2347,
              lichessId: "2yEwW", fen: "r1bqkb1r/pp1pnppp/2n1p3/2p2P1Q/2B1P3/8/PPPP2PP/RNB1K1NR b KQkq - 0 5",
              moves: ["e6f5", "h5f7"],
              rating: 456, themes: ["attackingF2F7", "mate", "mateIn1", "oneMove", "opening"],
              userIsWhite: true, flipped: false,
              wrongMove: "b1c3", pgn: "5... exf5 6. Qxf7# *"),
]
let pzOffbookMate = "c4f7"   // a mate that is NOT the stored line


/// `PieceKind` from a UCI promotion suffix, for the fixture walker.
func pzPromo(_ uci: String) -> PieceKind? {
    switch uci.last {
    case "q": return .queen
    case "r": return .rook
    case "b": return .bishop
    case "n": return .knight
    default: return nil
    }
}

func pzPuzzle(_ f: PZFixture) -> PuzzleSession.Puzzle {
    PuzzleSession.Puzzle(id: f.id, fen: f.fen, moves: f.moves, rating: f.rating,
                         themes: f.themes, openingTags: [])
}

h.begin("puzzle_session")
do {
    // ---- 5.1 the move convention, on every fixture ---------------------------
    for f in pzFixtures {
        guard var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .play) else {
            h.check(false, "[\(f.key)] the fixture FEN parses"); continue
        }
        h.check(s.phase == .loading, "[\(f.key)] a new session starts in loading")
        h.check(s.moveIndex == 1, "[\(f.key)] moveIndex starts at 1 — index 0 is the opponent's")
        h.check(s.userColor == (f.userIsWhite ? .white : .black),
                "[\(f.key)] the solver is the OPPOSITE of the FEN's side to move")
        h.check(s.flipped == f.flipped, "[\(f.key)] the board flips when the solver plays Black")
        h.check(s.mistakes == 0, "[\(f.key)] no mistakes yet")
        h.check(f.moves.count % 2 == 0, "[\(f.key)] the corpus move count is even")

        let setup = s.applySetupMove()
        h.check(setup.applied, "[\(f.key)] the setup move applies")
        h.check(setup.uci == f.moves[0], "[\(f.key)] and it is moves[0]")
        h.check(s.phase == .playing, "[\(f.key)] the session becomes playable")
        h.check(s.position.sideToMove == s.userColor, "[\(f.key)] then it is the solver's turn")
        h.check(s.lastMove?.from == String(f.moves[0].prefix(2)),
                "[\(f.key)] lastMove points at the setup move")
        h.check(!s.applySetupMove().applied, "[\(f.key)] applying the setup twice is a no-op")
    }

    // ---- userColor does not depend on the mode -------------------------------
    for f in pzFixtures {
        for m in PuzzleSession.Mode.allCases {
            h.check(PuzzleSession.create(puzzle: pzPuzzle(f), mode: m)?.userColor
                        == (f.userIsWhite ? .white : .black),
                    "[\(f.key)/\(m.rawValue)] userColor is mode-independent")
        }
    }
    h.check(PuzzleSession.create(puzzle: PuzzleSession.Puzzle(id: 0, fen: "not a fen",
                                                              moves: ["a2a4"], rating: 0),
                                 mode: .play) == nil,
            "an unparseable FEN yields no session rather than trapping")
    h.check(PuzzleSession.userColor(fen: pzFixtures[0].fen)
                == (pzFixtures[0].userIsWhite ? .white : .black), "userColor(fen:) agrees")

    // ---- solving a whole line, in every mode ---------------------------------
    for f in pzFixtures {
        for mode in PuzzleSession.Mode.allCases {
            guard var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: mode) else { continue }
            _ = s.applySetupMove()
            var idx = 1
            var guardCount = 0
            while s.phase == .playing && idx < f.moves.count && guardCount < 40 {
                guardCount += 1
                let u = f.moves[idx]
                let out = s.submit(from: String(u.prefix(2)),
                                   to: String(u.dropFirst(2).prefix(2)),
                                   promotion: u.count == 5 ? pzPromo(u) : nil)
                guard case .correct(let c) = out else {
                    h.check(false, "[\(f.key)/\(mode.rawValue)] ply \(idx) should be correct")
                    break
                }
                if c.solved { break }
                h.check(c.opponentReplyAfterMs == PuzzleSession.Timing.opponentDelayMs(mode),
                        "[\(f.key)/\(mode.rawValue)] the reply delay is the master-table value")
                let reply = s.applyOpponentReply()
                h.check(reply.applied, "[\(f.key)/\(mode.rawValue)] the opponent replies")
                idx += 2
                h.check(s.moveIndex == idx, "[\(f.key)/\(mode.rawValue)] moveIndex advances by 2")
            }
            h.check(s.phase == .solved, "[\(f.key)/\(mode.rawValue)] the line solves")
            h.check(!s.applyOpponentReply().applied,
                    "[\(f.key)/\(mode.rawValue)] no reply is pending after a solve")
        }
    }

    // ---- 5.4 rule 1: the checkmate short-circuit -----------------------------
    if let f = pzFixtures.first(where: { $0.key == "offbook" }),
       var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .play) {
        _ = s.applySetupMove()
        let out = s.submit(from: String(pzOffbookMate.prefix(2)),
                           to: String(pzOffbookMate.dropFirst(2).prefix(2)))
        if case .correct(let c) = out {
            h.check(c.byCheckmate, "an OFF-BOOK mate is correct, and flagged as such")
            h.check(c.played == pzOffbookMate, "the accepted move is the one played")
            h.check(c.played != f.moves[1], "and it is NOT the stored answer")
        } else {
            h.check(false, "the checkmate short-circuit accepts an off-book mate")
        }
        h.check(s.phase == .solved, "the puzzle ends")
        h.check(s.solvedByCheckmate, "and records how")
        h.check(s.position.status() == .checkmate, "the board really is mate")
        // This is exactly the case the server's comparator got wrong (spec fix #10).
        h.check(!PuzzleRatingEngine.compareMoves(correct: [f.moves[1]], user: [pzOffbookMate]),
                "the server's compareMoves would have called this wrong")
    }

    // ---- 5.5 the five wrong-move policies ------------------------------------
    for f in pzFixtures where !f.wrongMove.isEmpty {
        for mode in PuzzleSession.Mode.allCases {
            guard var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: mode) else { continue }
            _ = s.applySetupMove()
            let before = s.position.fen
            let out = s.submit(from: String(f.wrongMove.prefix(2)),
                               to: String(f.wrongMove.dropFirst(2).prefix(2)))
            guard case .wrong(let w) = out else {
                h.check(false, "[\(f.key)/\(mode.rawValue)] an off-book non-mate is wrong")
                continue
            }
            let p = PuzzleSession.wrongPolicy(mode)
            h.check(w.policy == p, "[\(f.key)/\(mode.rawValue)] the mode's policy is reported")
            h.check(w.expected == f.moves[1], "[\(f.key)/\(mode.rawValue)] the expected move")
            h.check(w.mistakes == 1, "[\(f.key)/\(mode.rawValue)] the mistake is counted")
            h.check((s.position.fen == before) == p.undo,
                    "[\(f.key)/\(mode.rawValue)] the board \(p.undo ? "snaps back" : "keeps the move")")
            h.check(s.phase == (p.staysPlayable ? .playing : .failed),
                    "[\(f.key)/\(mode.rawValue)] phase after a wrong move")
            h.check(w.sound == (p.gameOverSound ? .gameOver : nil),
                    "[\(f.key)/\(mode.rawValue)] wrong-move sound")
        }
    }

    // The policy table itself, read off Part 5.5 line for line.
    let pPlay = PuzzleSession.wrongPolicy(.play)
    h.check(pPlay.undo && !pPlay.staysPlayable && !pPlay.endsRun && !pPlay.costsALife
            && pPlay.bannerMs == nil && pPlay.advanceMs == nil && !pPlay.gameOverSound
            && pPlay.offersRetry, "Play: undo, Retry/Solution/Next, no sound")
    let pDaily = PuzzleSession.wrongPolicy(.daily)
    h.check(pDaily.undo && pDaily.staysPlayable && pDaily.bannerMs == 1300 && pDaily.offersRetry
            && !pDaily.endsRun, "Daily: undo, a 1300ms banner, unlimited retries")
    let pThem = PuzzleSession.wrongPolicy(.thematic)
    h.check(pThem.undo && !pThem.staysPlayable && !pThem.endsRun && pThem.offersRetry,
            "Thematic: undo, Retry/Solution, no rating penalty")
    let pStreak = PuzzleSession.wrongPolicy(.streak)
    h.check(pStreak.undo && pStreak.endsRun && pStreak.gameOverSound && !pStreak.offersRetry,
            "Streak: undo, the run ends immediately, game-over sound")
    let pTurbo = PuzzleSession.wrongPolicy(.turbo)
    h.check(!pTurbo.undo && pTurbo.costsALife && pTurbo.advanceMs == 500 && !pTurbo.offersRetry,
            "Turbo: NO undo, one life, next puzzle in 500ms")

    // Daily's unlimited retries, and that the answer still works afterwards.
    if let f = pzFixtures.first(where: { $0.key == "four" }),
       var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .daily) {
        _ = s.applySetupMove()
        for _ in 0..<3 {
            _ = s.submit(from: String(f.wrongMove.prefix(2)),
                         to: String(f.wrongMove.dropFirst(2).prefix(2)))
        }
        h.check(s.mistakes == 3, "Daily allows repeated wrong tries")
        h.check(s.phase == .playing, "and stays playable")
        if case .correct = s.submit(from: String(f.moves[1].prefix(2)),
                                    to: String(f.moves[1].dropFirst(2).prefix(2))) {
            h.check(true, "and the right answer is still accepted")
        } else { h.check(false, "and the right answer is still accepted") }
    }

    // ---- an illegal move is a silent no-op everywhere ------------------------
    for mode in PuzzleSession.Mode.allCases {
        guard var s = PuzzleSession.create(puzzle: pzPuzzle(pzFixtures[1]), mode: mode) else { continue }
        _ = s.applySetupMove()
        let before = s.position.fen
        h.check(s.submit(from: "a1", to: "a8") == .illegal, "[\(mode.rawValue)] illegal is illegal")
        h.check(s.mistakes == 0, "[\(mode.rawValue)] and is not a mistake")
        h.check(s.phase == .playing, "[\(mode.rawValue)] and ends nothing")
        h.check(s.position.fen == before, "[\(mode.rawValue)] and moves no piece")
    }

    // ---- 5.6 promotion --------------------------------------------------------
    if let f = pzFixtures.first(where: { $0.key == "promo" }),
       var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .play) {
        _ = s.applySetupMove()
        let u = f.moves[1]
        let from = String(u.prefix(2)), to = String(u.dropFirst(2).prefix(2))
        h.check(s.needsPromotion(from: from, to: to),
                "a pawn reaching the last rank needs the dialog")
        h.check(!s.needsPromotion(from: "z9", to: "a1"), "a nonsense square does not")
        // needsPromotion must agree with the engine over EVERY legal move, not just this one.
        let engineSays = s.position.legalMoves().filter { m in
            s.position.squares[m.from]?.kind == .pawn
                && (Square.rank(m.to) == 7 || Square.rank(m.to) == 0)
        }.count
        let weSay = s.position.legalMoves().filter {
            s.needsPromotion(from: Square.name($0.from), to: Square.name($0.to))
        }.count
        h.check(weSay == engineSays, "needsPromotion agrees with the engine on every legal move")
        // An omitted promotion defaults to queen (5.1).
        if case .correct = s.submit(from: from, to: to) {
            h.check(u.hasSuffix("q"), "an omitted promotion defaults to queen")
        } else { h.check(false, "the promotion move is accepted") }
    }

    // ---- 10.3 retry and Solution ---------------------------------------------
    if let f = pzFixtures.first(where: { $0.key == "four" }),
       var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .play) {
        _ = s.applySetupMove()
        _ = s.submit(from: String(f.moves[1].prefix(2)), to: String(f.moves[1].dropFirst(2).prefix(2)))
        _ = s.applyOpponentReply()
        h.check(s.moveIndex == 3, "two plies in")
        let r = s.retry()
        h.check(s.moveIndex == 1, "retry resets the move index")
        h.check(s.phase == .loading, "retry returns to the pre-setup state")
        h.check(s.position.fen == f.fen, "retry rebuilds from the puzzle FEN")
        h.check(s.lastMove == nil, "retry clears the last move")
        h.check(r.restartClock, "retry restarts the clock — fix (a)")
        h.check(r.sound == .gameStart, "retry plays the game-start sound — fix (b)")
        h.check(!r.submitsRating, "retry never re-submits the rating")
        h.check(r.setupAfterMs == 500, "retry replays the setup after 500ms")
    }
    if let f = pzFixtures.first(where: { $0.key == "eight" }),
       var s = PuzzleSession.create(puzzle: pzPuzzle(f), mode: .play) {
        _ = s.applySetupMove()
        let rev = s.revealSolution()
        h.check(s.phase == .reviewing, "Solution moves the session to reviewing")
        h.check(rev.runEngine && rev.maxArrows == 3, "and asks the engine for up to 3 arrows")
        h.check(rev.remaining.count == f.moves.count - 1, "the remaining line is reported")
        h.check(rev.remaining.first == f.moves[1], "starting at the solver's next move")
        // Two-sided free play, judged by nothing.
        let a = s.position.legalMoves()[0]
        if case .freePlay = s.submit(from: Square.name(a.from), to: Square.name(a.to),
                                     promotion: a.promotion) {
            h.check(true, "a move while reviewing is free play")
        } else { h.check(false, "a move while reviewing is free play") }
        h.check(s.mistakes == 0, "and is never scored")
        let b = s.position.legalMoves()[0]
        if case .freePlay = s.submit(from: Square.name(b.from), to: Square.name(b.to),
                                     promotion: b.promotion) {
            h.check(true, "the opponent's pieces move too")
        } else { h.check(false, "the opponent's pieces move too") }
    }

    // ---- 10.3 Save Puzzle -----------------------------------------------------
    for f in pzFixtures {
        let p = pzPuzzle(f)
        h.check(PuzzleSession.solutionPGN(p) == f.pgn, "[\(f.key)] the Save Puzzle PGN")
        h.check(f.pgn.hasSuffix(" *"), "[\(f.key)] terminated by ` *`")
        h.check(!f.pgn.contains("[FEN"), "[\(f.key)] no FEN header — it goes in initialFEN")
        h.check(PuzzleSession.savePuzzleName(p) == "Puzzle #\(f.id)", "[\(f.key)] prefilled name")
        let notes = PuzzleSession.savePuzzleNotes(p)
        h.check(notes.hasPrefix("Rating: \(f.rating)"), "[\(f.key)] notes open with the rating")
        h.check(!notes.split(separator: "\n", omittingEmptySubsequences: false).contains(""),
                "[\(f.key)] only non-empty lines")
        h.check(notes.contains("Themes: " + f.themes.joined(separator: ", ")),
                "[\(f.key)] themes line")
        h.check(!notes.contains("Opening:"), "[\(f.key)] no opening line when there are no tags")
    }

    // ---- Part 17, the Master Timing Table -------------------------------------
    h.check(PuzzleSession.Timing.opponentDelayMs(.play) == 500, "Play opponent delay")
    h.check(PuzzleSession.Timing.opponentDelayMs(.thematic) == 500, "Thematic opponent delay")
    h.check(PuzzleSession.Timing.opponentDelayMs(.streak) == 500, "Streak opponent delay")
    // Part 5.3 says "500 everywhere except Turbo"; Part 17 gives Daily 400. Part 17 wins.
    h.check(PuzzleSession.Timing.opponentDelayMs(.daily) == 400, "Daily is 400, per the master table")
    h.check(PuzzleSession.Timing.opponentDelayMs(.turbo) == 300, "Turbo opponent delay")
    h.check(PuzzleSession.Timing.turboAdvanceMs == 500, "Turbo advances after 500ms")
    h.check(PuzzleSession.Timing.turboFeedbackMs == 500, "the Turbo feedback dot lives 500ms")
    h.check(PuzzleSession.Timing.dailyWrongBannerMs == 1300, "the Daily wrong banner lives 1300ms")
    h.check(PuzzleSession.Timing.tickMs == 1000, "clocks tick every 1000ms")
    h.check(PuzzleSession.Timing.goalRingMs == 400, "the goal ring animates over 400ms")
    h.check(PuzzleSession.Timing.draftTTLMs == 86_400_000, "drafts live 24 hours")
    h.check(PuzzleSession.Timing.turboSeconds(3) == 180, "3-minute Turbo")
    h.check(PuzzleSession.Timing.turboSeconds(5) == 300, "5-minute Turbo")
    h.check(PuzzleSession.Timing.turboSeconds(0) == 0, "Infinite Turbo has no clock")

    // ---- Part 15.1, the one predicate ------------------------------------------
    for m in [PuzzleSession.Mode.play, .daily, .thematic, .streak] {
        h.check(PuzzleSession.countsTowardDailyGoal(m), "\(m.rawValue) counts toward the daily goal")
    }
    h.check(!PuzzleSession.countsTowardDailyGoal(.turbo),
            "Turbo is excluded — a 3-minute run would make a 10-a-day goal meaningless")
}

h.begin("puzzle_selection")
do {
    // Ids deliberately NOT in rating order, and two candidates exactly on the +-100 boundary:
    // with the ids sorted, "lowest id" and "closest by ABS" coincide and the three ladders become
    // indistinguishable; with nothing on the boundary, an inclusive-vs-exclusive window is invisible.
    let pool = PuzzleSelection.ArrayPool([
        PuzzleServing.Candidate(id: 1, rating: 1000, themes: ["fork"]),
        PuzzleServing.Candidate(id: 2, rating: 1050, themes: ["pin"]),
        PuzzleServing.Candidate(id: 3, rating: 1400, themes: ["fork"]),
        PuzzleServing.Candidate(id: 4, rating: 1800, themes: ["skewer"]),
        PuzzleServing.Candidate(id: 5, rating: 1100, themes: ["pin"]),
        PuzzleServing.Candidate(id: 6, rating: 900, themes: ["pin"]),
        PuzzleServing.Candidate(id: 7, rating: 1610, themes: ["fork"]),
    ])
    h.check(pool.windowUnseen(center: 1000, window: 100, theme: nil, seen: []).count == 4,
            "whereBetween is inclusive at BOTH ends")
    h.check(pool.windowUnseen(center: 1000, window: 99, theme: nil, seen: []).count == 2,
            "one point narrower excludes both edges")

    var r = PuzzleSelection.serveRandom(pool, center: 1000, window: 100, theme: nil, seen: [])
    h.check(r.stage == .windowUnseen && r.candidate?.id == 1 && !r.didReset, "tier 1")
    r = PuzzleSelection.serveRandom(pool, center: 1000, window: 100, theme: nil, seen: [1, 2, 5, 6])
    h.check(r.stage == .anyUnseenRandom && r.candidate?.id == 3, "tier 2: any unseen, random")
    r = PuzzleSelection.serveRandom(pool, center: 1000, window: 100, theme: nil,
                                    seen: [1, 2, 3, 4, 5, 6, 7])
    h.check(r.stage == .afterResetRandom && r.didReset, "tier 3 reports the reset")
    // Streak's tier 2 is CLOSEST where Play's is random. Unseen is {4 @1800, 7 @1610}: the closest
    // to 1500 is 7 and the lowest id is 4, so the two ladders cannot agree by coincidence.
    r = PuzzleSelection.serveClosest(pool, center: 1500, window: 50, theme: nil, seen: [1, 2, 3, 5, 6])
    h.check(r.stage == .anyUnseenClosest && r.candidate?.id == 7, "streak tier 2 is closest-by-abs")
    r = PuzzleSelection.serveRandom(pool, center: 1500, window: 50, theme: nil, seen: [1, 2, 3, 5, 6])
    h.check(r.candidate?.id == 4, "where Play's tier 2 takes the picker's answer")
    r = PuzzleSelection.serveThematic(pool, center: 1000, theme: "fork", seen: [1])
    h.check(r.stage == .anyUnseenRandom && r.candidate?.id == 3, "thematic tier 2 is random")
    r = PuzzleSelection.serveThematic(pool, center: 1000, theme: "fork", seen: [1, 3, 7])
    h.check(r.stage == .afterResetClosest && r.candidate?.id == 1, "thematic tier 3 is closest")
    let empty = PuzzleSelection.ArrayPool([])
    r = PuzzleSelection.serveClosest(empty, center: 1200, window: 50, theme: nil, seen: [])
    h.check(r.stage == .none && r.candidate == nil && r.didReset,
            "an empty pool yields nothing, and PHP still deleted the seen rows first")

    // The three ladders here must agree with the golden-pinned array versions, case for case.
    // This is what lets the SQLite store reuse `PuzzleServing`'s contract without a second port.
    let arr = pool.candidates
    for center in [400, 900, 1000, 1200, 1500, 1800, 2400] {
        for window in [50, 100, 200] {
            for theme in [nil, "fork", "pin", "skewer", "nosuch"] as [String?] {
                for seen in [Set<Int>(), Set([1]), Set([1, 2, 3]), Set([1, 2, 3, 4, 5, 6, 7])] {
                    let a = PuzzleSelection.serveRandom(pool, center: center, window: window,
                                                        theme: theme, seen: seen)
                    let b = PuzzleServing.serveRandom(arr, center: center, window: window,
                                                      theme: theme, seen: seen)
                    h.check(a == b, "serveRandom(\(center),\(window),\(theme ?? "-")) matches PuzzleServing")
                    let c = PuzzleSelection.serveClosest(pool, center: center, window: window,
                                                         theme: theme, seen: seen)
                    let d = PuzzleServing.serveClosest(arr, center: center, window: window,
                                                       theme: theme, seen: seen)
                    h.check(c == d, "serveClosest(\(center),\(window),\(theme ?? "-")) matches PuzzleServing")
                    if let t = theme {
                        let e = PuzzleSelection.serveThematic(pool, center: center, window: window,
                                                              theme: t, seen: seen)
                        let f = PuzzleServing.serveThematic(arr, center: center, window: window,
                                                            theme: t, seen: seen)
                        h.check(e == f, "serveThematic(\(center),\(window),\(t)) matches PuzzleServing")
                    }
                }
            }
        }
    }

    // ---- the Tier-3 scope (spec fix #7) ----------------------------------------
    h.check(PuzzleSelection.scopeForReset(theme: "fork", center: 1200, window: 100,
                                          seenCount: 5, corpusCount: 1000) == .theme("fork"),
            "a themed query scopes the wipe to its theme")
    h.check(PuzzleSelection.scopeForReset(theme: nil, center: 1200, window: 100,
                                          seenCount: 5, corpusCount: 1000)
                == .window(lo: 1100, hi: 1300),
            "an unthemed query scopes to its rating band")
    h.check(PuzzleSelection.scopeForReset(theme: "fork", center: 1200, window: 100,
                                          seenCount: 1000, corpusCount: 1000) == .all,
            "only a genuinely exhausted corpus wipes everything")
    // The bug itself: exhausting one theme must not cost another mode its history.
    var seen: Set<Int> = [1, 2, 3, 4, 5, 6, 7]
    let removed = PuzzleSelection.forget(.theme("fork"), from: &seen, in: pool)
    h.check(removed == 3, "the three forks are forgotten")
    h.check(seen == [2, 4, 5, 6], "and nothing else is — this is spec fix #7")
    var seen2: Set<Int> = [1, 2, 3, 4, 5, 6, 7]
    h.check(PuzzleSelection.forget(.window(lo: 900, hi: 1100), from: &seen2, in: pool) == 4,
            "a banded wipe forgets its band")
    h.check(seen2 == [3, 4, 7], "and leaves the rest")
    var seen3: Set<Int> = [1, 2, 3]
    let wiped = PuzzleSelection.forget(.all, from: &seen3, in: pool)
    h.check(wiped == 3 && seen3.isEmpty, "a global wipe forgets everything")

    // ---- windows (7.2 / 7.3 / 7.4) ---------------------------------------------
    h.check(PuzzleServing.regularWindow == 100, "rated is +-100")
    h.check(PuzzleServing.streakWindow == 50, "streak and turbo are +-50")
    h.check(PuzzleServing.thematicWindow == 200, "thematic is +-200")

    // ---- the daily index (11.1) --------------------------------------------------
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Manila")!      // UTC+8: where fix #1 was visible
    func d(_ y: Int, _ m: Int, _ dd: Int, _ hh: Int = 12) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: dd, hour: hh))!
    }
    h.check(PuzzleSelection.daysSinceEpoch(d(2026, 1, 1), calendar: cal) == 0, "the epoch is day 0")
    h.check(PuzzleSelection.daysSinceEpoch(d(2026, 1, 2), calendar: cal) == 1, "the day after is 1")
    h.check(PuzzleSelection.dailyIndex(d(2026, 1, 1), poolCount: 3000, calendar: cal) == 0,
            "index 0 at the epoch")
    h.check(PuzzleSelection.dailyIndex(d(2026, 8, 11, 0), poolCount: 3000, calendar: cal)
                == PuzzleSelection.dailyIndex(d(2026, 8, 11, 23), poolCount: 3000, calendar: cal),
            "the same LOCAL day gives the same puzzle — fix #1")
    h.check(PuzzleSelection.dailyIndex(d(2026, 8, 12, 0), poolCount: 3000, calendar: cal)
                != PuzzleSelection.dailyIndex(d(2026, 8, 11, 23), poolCount: 3000, calendar: cal),
            "and it rolls at local midnight, not 8am")
    let past = PuzzleSelection.dailyIndex(d(2025, 6, 15), poolCount: 3000, calendar: cal)
    h.check(past >= 0 && past < 3000, "a pre-epoch date stays in range — the double modulo")
    h.check(PuzzleSelection.dailyIndex(d(2026, 1, 1), poolCount: 0, calendar: cal) == 0,
            "an empty pool does not divide by zero")
    var walked = Set<Int>()
    for i in 0..<365 { walked.insert(PuzzleSelection.dailyIndex(d(2026, 1, 1).addingTimeInterval(Double(i) * 86400), poolCount: 3000, calendar: cal)) }
    h.check(walked.count == 365, "a year of dates gives 365 distinct puzzles")

    h.check(PuzzleSelection.uiThemes.count == 12, "twelve UI themes (Part 12.1)")
    h.check(PuzzleSelection.uiThemes.first == "hangingPiece", "in grid order")
    h.check(PuzzleSelection.uiThemes.last == "middlegame", "ending with middlegame")
}

h.begin("puzzle_progress")
do {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Asia/Manila")!
    func ms(_ y: Int, _ m: Int, _ dd: Int, _ hh: Int = 12) -> Int {
        Int(cal.date(from: DateComponents(year: y, month: m, day: dd, hour: hh))!
                .timeIntervalSince1970 * 1000)
    }
    let t0 = ms(2026, 8, 11)

    // ---- seeding (Part 4) ------------------------------------------------------
    var s = PuzzleProgress.seed(now: t0)
    h.check(s.profile.rating == 1200, "a new profile starts at 1200")
    h.check(s.profile.highestRating == 1200, "and its high-water mark matches")
    h.check(s.rushBest.count == 3, "three RushBest rows are seeded")
    h.check(s.streak.puzzleRating == 600, "the streak ramp starts at 600")
    h.check(s.streak.currentStreak == 0 && s.streak.bestStreak == 0, "no streak yet")
    h.check(s.attempts.isEmpty && s.seen.isEmpty && s.streakRuns.isEmpty && s.rushRuns.isEmpty
            && s.rushDraft == nil && s.playDraft == nil && s.themeStats.isEmpty
            && s.dailySolves.isEmpty, "and nothing else is seeded")
    h.check(s.version == PuzzleProgress.stateVersion, "the state carries its version")

    // ---- the rated ledger (Part 8) ---------------------------------------------
    let want = PuzzleRatingEngine.evaluate(userRating: 1200, puzzleRating: 1300, isCorrect: true)
    let r1 = PuzzleProgress.recordRatedAttempt(&s, puzzleId: 10, isCorrect: true,
                                               puzzleRating: 1300, themes: ["fork", "pin"],
                                               solveTimeSeconds: 12, now: t0, calendar: cal)
    h.check(r1.firstAttempt, "the first attempt counts")
    h.check(r1.ratingChange == want.ratingChange, "the Elo delta comes from the pinned engine")
    h.check(s.profile.rating == want.newRating, "and is applied")
    h.check(s.profile.highestRating == want.newRating, "highestRating follows a rise")
    h.check(s.attempts.count == 1, "one ledger row")
    h.check(s.attempts[0].solveTimeSeconds == 12, "solve time is kept locally")
    h.check(s.themeStats["fork"]?.attempted == 1 && s.themeStats["fork"]?.solved == 1,
            "ThemeStat attempted and solved")
    h.check(s.themeStats["pin"]?.attempted == 1, "every theme on the puzzle is counted")
    h.check(r1.countedTowardGoal, "a correct rated solve counts toward the goal")

    let ratingBefore = s.profile.rating, highBefore = s.profile.highestRating
    let r2 = PuzzleProgress.recordRatedAttempt(&s, puzzleId: 10, isCorrect: true,
                                               puzzleRating: 1300, themes: ["fork", "pin"],
                                               now: t0 + 1000, calendar: cal)
    h.check(!r2.firstAttempt && r2.ratingChange == 0, "a replay moves nothing")
    h.check(s.profile.rating == ratingBefore, "the rating is unchanged")
    h.check(s.attempts.count == 1, "no second ledger row")
    h.check(s.themeStats["fork"]?.attempted == 1, "no second ThemeStat bump")
    h.check(!r2.countedTowardGoal, "and no second daily-goal credit")

    let r3 = PuzzleProgress.recordRatedAttempt(&s, puzzleId: 11, isCorrect: false,
                                               puzzleRating: 1000, themes: ["endgame"],
                                               now: t0, calendar: cal)
    h.check(r3.ratingChange < 0, "a wrong answer costs rating — that is the point of a rating")
    h.check(s.profile.highestRating == highBefore, "a fall does not lower highestRating")
    h.check(s.themeStats["endgame"]?.attempted == 1 && s.themeStats["endgame"]?.solved == 0,
            "a failed attempt is attempted but not solved")
    h.check(!r3.countedTowardGoal, "and earns no goal credit")

    // The floor, exercised against an EVENLY rated puzzle: a 401 losing to a 2800 drops ~0.
    var low = PuzzleProgress.seed(now: t0)
    low.profile.rating = 401
    let lr = PuzzleProgress.recordRatedAttempt(&low, puzzleId: 1, isCorrect: false,
                                               puzzleRating: 400, themes: [], now: t0,
                                               calendar: cal)
    h.check(lr.ratingChange <= -10, "an even-money loss is a real drop")
    h.check(low.profile.rating == 400, "the rating floor holds at exactly 400")
    h.check(low.attempts[0].ratingAfter == 400, "and the ledger records the floored value")

    // Spec fix #9: the newest rows, not the oldest.
    var hst = PuzzleProgress.seed(now: t0)
    for i in 0..<40 {
        PuzzleProgress.recordRatedAttempt(&hst, puzzleId: i, isCorrect: true, puzzleRating: 1200,
                                          themes: [], now: t0 + i * 1000, calendar: cal)
    }
    let hist = PuzzleProgress.ratingHistory(hst, limit: 30)
    h.check(hist.count == 30, "history is capped at 30")
    h.check(hist[0].puzzleId == 39, "and starts with the NEWEST — the server took the oldest")
    h.check(hist[29].puzzleId == 10, "walking back 30")

    // ---- the daily goal (Part 15) ----------------------------------------------
    var g = PuzzleProgress.seed(now: ms(2026, 8, 11))
    var status = PuzzleProgress.dailyGoalStatus(g, now: ms(2026, 8, 11), calendar: cal)
    h.check(status.solvedToday == 0 && status.target == 10 && !status.complete,
            "nothing solved yet, and the target is the server's literal 10")
    for _ in 0..<10 { PuzzleProgress.recordSolve(&g, mode: .thematic, now: ms(2026, 8, 11), calendar: cal) }
    status = PuzzleProgress.dailyGoalStatus(g, now: ms(2026, 8, 11), calendar: cal)
    h.check(status.solvedToday == 10 && status.complete && status.progress == 1.0,
            "the goal completes at 10 and the ring fills")
    PuzzleProgress.recordSolve(&g, mode: .thematic, now: ms(2026, 8, 11), calendar: cal)
    h.check(PuzzleProgress.dailyGoalStatus(g, now: ms(2026, 8, 11), calendar: cal).progress == 1.0,
            "and the ring does not overfill")
    let beforeTurbo = g.dailySolves[PuzzleProgress.dayKey(ms(2026, 8, 11), calendar: cal)]
    h.check(!PuzzleProgress.recordSolve(&g, mode: .turbo, now: ms(2026, 8, 11), calendar: cal),
            "a Turbo solve does not count")
    h.check(g.dailySolves[PuzzleProgress.dayKey(ms(2026, 8, 11), calendar: cal)] == beforeTurbo,
            "and does not move the counter")

    var gs = PuzzleProgress.seed(now: ms(2026, 8, 1))
    for dd in [7, 8, 9, 10, 11] {
        PuzzleProgress.recordSolve(&gs, mode: .play, now: ms(2026, 8, dd), calendar: cal)
    }
    h.check(PuzzleProgress.goalStreakDays(gs, now: ms(2026, 8, 11), calendar: cal) == 5,
            "five consecutive days")
    h.check(PuzzleProgress.goalStreakDays(gs, now: ms(2026, 8, 12), calendar: cal) == 5,
            "the streak survives the whole of the following day")
    h.check(PuzzleProgress.goalStreakDays(gs, now: ms(2026, 8, 13), calendar: cal) == 0,
            "and dies the day after that")
    var gg = PuzzleProgress.seed(now: ms(2026, 8, 1))
    for dd in [5, 6, 9, 10, 11] {
        PuzzleProgress.recordSolve(&gg, mode: .play, now: ms(2026, 8, dd), calendar: cal)
    }
    h.check(PuzzleProgress.goalStreakDays(gg, now: ms(2026, 8, 11), calendar: cal) == 3,
            "a gap breaks the streak")
    h.check(PuzzleProgress.goalStreakDays(PuzzleProgress.seed(now: t0), now: t0, calendar: cal) == 0,
            "no solves, no streak")

    // Day keys are LOCAL and roll at local midnight (fix #1).
    h.check(PuzzleProgress.dayKey(ms(2026, 8, 11, 23), calendar: cal) == "2026-08-11",
            "late evening is today")
    h.check(PuzzleProgress.dayKey(ms(2026, 8, 12, 0), calendar: cal) == "2026-08-12",
            "past midnight is tomorrow")
    h.check(PuzzleProgress.dayNumber("2026-08-12") - PuzzleProgress.dayNumber("2026-08-11") == 1,
            "day numbers are contiguous")
    h.check(PuzzleProgress.key(fromDayNumber: PuzzleProgress.dayNumber("2026-03-15")) == "2026-03-15",
            "day keys round-trip")
    h.check(PuzzleProgress.dayNumber("2026-03-30") - PuzzleProgress.dayNumber("2026-03-29") == 1,
            "DST spring forward is still one day")
    h.check(PuzzleProgress.dayNumber("2026-10-26") - PuzzleProgress.dayNumber("2026-10-25") == 1,
            "DST fall back is still one day")

    // ---- Daily Puzzle state (Part 11) ------------------------------------------
    var dp = PuzzleProgress.seed(now: ms(2026, 8, 1))
    var dr = PuzzleProgress.recordDailyPuzzleSolve(&dp, now: ms(2026, 8, 9), calendar: cal)
    h.check(dr.streak == 1 && dp.daily.totalSolved == 1, "the first daily solve starts a streak")
    dr = PuzzleProgress.recordDailyPuzzleSolve(&dp, now: ms(2026, 8, 9, 20), calendar: cal)
    h.check(dr.alreadySolvedToday && dp.daily.streak == 1 && dp.daily.totalSolved == 1,
            "solving twice on one day is caught, and doubles nothing")
    dr = PuzzleProgress.recordDailyPuzzleSolve(&dp, now: ms(2026, 8, 10), calendar: cal)
    h.check(dr.streak == 2, "the next day continues it")
    dr = PuzzleProgress.recordDailyPuzzleSolve(&dp, now: ms(2026, 8, 13), calendar: cal)
    h.check(dr.streak == 1, "a missed day restarts it")
    h.check(dp.dailySolves[PuzzleProgress.dayKey(ms(2026, 8, 13), calendar: cal)] == 1,
            "a daily solve also feeds the goal counter")

    // ---- runs -------------------------------------------------------------------
    var rs = PuzzleProgress.seed(now: t0)
    var run = PuzzleProgress.endStreakRun(&rs, length: 7, bestBefore: 0, now: t0)
    h.check(run.isNewBest && rs.streak.bestStreak == 7, "a first run is a best")
    h.check(rs.streakRuns.count == 1, "and is written to history")
    h.check(rs.streak.currentStreak == 0 && rs.streak.puzzleRating == 600,
            "the run and the difficulty ramp both reset")
    run = PuzzleProgress.endStreakRun(&rs, length: 3, bestBefore: 7, now: t0 + 1)
    h.check(!run.isNewBest && rs.streak.bestStreak == 7,
            "a shorter run does not lower the best — one source of truth (fix #8)")
    PuzzleProgress.endStreakRun(&rs, length: 0, bestBefore: 7, now: t0 + 2)
    h.check(rs.streakRuns.count == 2, "a zero-length run is not written to history")

    var rh = PuzzleProgress.seed(now: t0)
    let rr = PuzzleProgress.endRushRun(&rh, mode: 3, score: 24, mistakes: 1, reason: .timeUp, now: t0)
    h.check(rr.isNewBest && rh.rushBest["3"] == 24, "the first timed run is a best")
    h.check(rh.rushRuns[0].reason == .timeUp, "the real reason is stored")
    PuzzleProgress.endRushRun(&rh, mode: 3, score: 12, mistakes: 3, reason: .threeMistakes,
                              now: t0 + 1)
    h.check(rh.rushRuns[1].reason == .threeMistakes,
            "three mistakes is not \"Time's Up!\" — fix #6")
    h.check(rh.rushBest["3"] == 24, "a worse run does not lower the best")
    PuzzleProgress.endRushRun(&rh, mode: 0, score: 40, mistakes: 0, reason: .quit, now: t0 + 2)
    h.check(rh.rushRuns[2].reason == .quit && rh.rushBest["0"] == 40,
            "quitting still writes history and saves the best — fix #13")
    h.check(rh.rushBest["3"] == 24, "per-mode bests are independent")
    PuzzleProgress.saveRushDraft(&rh, score: 5, mistakes: 1, targetRating: 900, puzzlesServed: 6,
                                 now: t0)
    PuzzleProgress.endRushRun(&rh, mode: 0, score: 5, mistakes: 1, reason: .backgrounded, now: t0 + 3)
    h.check(rh.rushDraft == nil, "ending an infinite run clears its draft — fix #5")

    // ---- drafts (24h TTL) --------------------------------------------------------
    let DAY = 24 * 60 * 60 * 1000
    var dfs = PuzzleProgress.seed(now: t0)
    PuzzleProgress.savePlayDraft(&dfs, puzzleId: 77, now: t0)
    h.check(PuzzleProgress.loadPlayDraft(&dfs, now: t0 + DAY - 1000)?.puzzleId == 77,
            "a draft under 24h restores")
    h.check(PuzzleProgress.loadPlayDraft(&dfs, now: t0 + DAY + 1000) == nil,
            "a draft over 24h does not")
    h.check(dfs.playDraft == nil, "and the stale draft is cleared")
    PuzzleProgress.saveRushDraft(&dfs, score: 9, mistakes: 2, targetRating: 1100,
                                 puzzlesServed: 11, now: t0)
    h.check(PuzzleProgress.loadRushDraft(&dfs, now: t0 + 1000)?.score == 9,
            "a rush draft under 24h restores")
    h.check(PuzzleProgress.loadRushDraft(&dfs, now: t0 + DAY + 1) == nil,
            "and expires the same way")
    h.check(dfs.rushDraft == nil, "clearing itself as it goes")

    // ---- the seen set, and the JSON round-trip -----------------------------------
    var js = PuzzleProgress.seed(now: t0)
    PuzzleProgress.commitSeen(&js, Set([5, 1, 3]))
    h.check(js.seen == [1, 3, 5], "the seen set serialises sorted, so the file is stable")
    h.check(PuzzleProgress.seenSet(js) == Set([1, 3, 5]), "and reads back")
    PuzzleProgress.recordRatedAttempt(&js, puzzleId: 3, isCorrect: true, puzzleRating: 1250,
                                      themes: ["fork"], solveTimeSeconds: 8, now: t0, calendar: cal)
    PuzzleProgress.endStreakRun(&js, length: 4, bestBefore: 0, now: t0)
    PuzzleProgress.savePlayDraft(&js, puzzleId: 3, now: t0)
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    if let data = try? enc.encode(js),
       let back = try? JSONDecoder().decode(PuzzleProgressState.self, from: data) {
        h.check(back == js, "the whole state round-trips through JSON")
        if let again = try? enc.encode(back) {
            h.check(again == data, "and re-encodes byte for byte")
        } else { h.check(false, "and re-encodes byte for byte") }
    } else {
        h.check(false, "the whole state round-trips through JSON")
    }
}


// MARK: - Opening Tree (client round 4)
//
// No golden file: `openingtree.tsx` is TypeScript, not a Laravel controller, so there is no PHP
// oracle to generate one. The differential partner is `web-demo/js/opening-tree.js`, and
// `tools/qa/replay_opening_tree.js` compares the two source texts. What follows is the half a
// replay cannot do — running the algorithm.

h.begin("opening_tree")
do {
    typealias OT = OpeningTree

    // ---- outcomes ------------------------------------------------------------
    h.check(OT.Outcome.parse("1-0") == .whiteWin, "1-0 parses")
    h.check(OT.Outcome.parse("0-1") == .blackWin, "0-1 parses")
    h.check(OT.Outcome.parse("1/2-1/2") == .draw, "1/2-1/2 parses")
    h.check(OT.Outcome.parse("½-½") == .draw, "and so does the half glyph real exporters emit")
    h.check(OT.Outcome.parse("*") == nil, "an unfinished game has no outcome")
    h.check(OT.Outcome.parse("") == nil, "nor does a missing Result tag")
    h.check(OT.Outcome.whiteWin.score(forWhite: true) == 1, "white winning is +1 for white")
    h.check(OT.Outcome.whiteWin.score(forWhite: false) == -1, "and -1 for black")
    h.check(OT.Outcome.draw.score(forWhite: true) == 0, "a draw is 0 either way")
    h.check(OT.Outcome.draw.score(forWhite: false) == 0, "both ways round")
    h.check(OT.Outcome.allCases.count == 3, "three outcomes, and `*` is not one of them")

    // ---- the mover inversion -------------------------------------------------
    //
    // The rule the whole feature turns on: a node's W/D/L is the MOVER's, so it flips on the
    // opponent's plies. Backwards, every second row of the move list is exactly wrong in a way
    // that looks plausible.
    var t = OT()
    t.add(OT.Game(sanMoves: ["e4", "c5", "Nf3"], userIsWhite: true, outcome: .whiteWin))
    h.check(t.gameCount == 1, "one game counted")
    h.check(t.nodeCount == 3, "three nodes for three plies")
    h.check(t.depth == 3, "and a depth of three")
    h.check(t.node(at: ["e4"])?.wins == 1, "the owner played e4 and won, so e4 is a win")
    h.check(t.node(at: ["e4", "c5"])?.losses == 1,
            "the OPPONENT played c5 and lost, so c5 is a loss — the inversion")
    h.check(t.node(at: ["e4", "c5"])?.wins == 0, "and not a win")
    h.check(t.node(at: ["e4", "c5", "Nf3"])?.wins == 1, "Nf3 is the owner again")

    var flipped = OT()
    flipped.add(OT.Game(sanMoves: ["e4", "c5"], userIsWhite: false, outcome: .whiteWin))
    h.check(flipped.node(at: ["e4"])?.wins == 1,
            "seen from Black, e4 is STILL a win for whoever played it")
    h.check(flipped.node(at: ["e4", "c5"])?.losses == 1, "and c5 still a loss")

    // ---- unfinished games ----------------------------------------------------
    var unfinished = OT()
    unfinished.add(OT.Game(sanMoves: ["d4"], userIsWhite: true, outcome: nil))
    h.check(unfinished.node(at: ["d4"])?.count == 1, "an unfinished game still counts")
    h.check(unfinished.node(at: ["d4"])?.scored == 0, "but scores nothing")

    // ---- truncation vs rejection ---------------------------------------------
    var truncated = OT()
    let plies = truncated.add(OT.Game(sanMoves: ["e4", "e5", "Qz9", "Nf3"],
                                      userIsWhite: true, outcome: .draw))
    h.check(plies == 2, "the walk stops at the unreadable token")
    h.check(truncated.nodeCount == 2, "and keeps everything before it")
    h.check(truncated.rejectedCount == 0, "a truncated game is not a rejected one")
    h.check(truncated.add(OT.Game(sanMoves: ["Zz9"], userIsWhite: true, outcome: nil)) == 0,
            "a game whose first move is unreadable inserts nothing")
    h.check(truncated.rejectedCount == 1, "and IS counted as rejected")

    // ---- canonical SAN collapses spellings -----------------------------------
    var canonical = OT()
    let scholars = ["e4", "e5", "Qh5", "Nc6", "Qxf7"]
    canonical.add(OT.Game(sanMoves: scholars, userIsWhite: true, outcome: .whiteWin))
    canonical.add(OT.Game(sanMoves: ["e4", "e5", "Qh5", "Nc6", "Qxf7#"],
                          userIsWhite: true, outcome: .whiteWin))
    let mate = canonical.sortedMoves(at: ["e4", "e5", "Qh5", "Nc6"])
    h.check(mate.count == 1, "Qxf7 and Qxf7# are one move, not two branches")
    h.check(mate.first?.count == 2, "and both games land on it")

    // ---- the sort, and its tie-break -----------------------------------------
    //
    // `Dictionary` order is unspecified and `sort` is not stable, so without the SAN tie-break
    // this order differs between runs AND from the JS twin.
    var sorted = OT()
    for first in ["e4", "e4", "d4", "c4", "Nf3"] {
        sorted.add(OT.Game(sanMoves: [first], userIsWhite: true, outcome: .draw))
    }
    let moves = sorted.sortedMoves(at: [])
    h.check(moves.map(\.san) == ["e4", "Nf3", "c4", "d4"],
            "count descending, then SAN ascending — capital N sorts before lowercase c and d")
    h.check(moves.first?.count == 2, "the most played was played twice")
    h.check(sorted.mostPlayed(at: []) == "e4", "forward plays the top of that list")
    h.check(sorted.mostPlayed(at: ["e4"]) == nil, "and stops at a leaf")
    h.check(moves.first?.hasContinuations == false, "a one-ply game leaves no continuations")

    // ---- shares --------------------------------------------------------------
    let c = OT.Candidate(san: "e4", count: 4, wins: 2, draws: 1, losses: 1,
                         hasContinuations: true)
    h.check(abs(c.winShare - 0.5) < 1e-9, "half the scored games were wins")
    h.check(abs(c.drawShare - 0.25) < 1e-9, "a quarter drawn")
    h.check(abs(c.lossShare - 0.25) < 1e-9, "a quarter lost")
    h.check(c.scored == 4, "four scored")
    let empty = OT.Candidate(san: "e4", count: 1, wins: 0, draws: 0, losses: 0,
                             hasContinuations: false)
    h.check(empty.winShare == 0, "nothing scored is zero, not a division by zero")

    // ---- the ply cap ---------------------------------------------------------
    var capped = OT()
    var shuffle: [String] = []
    for _ in 0 ..< 30 { shuffle.append(contentsOf: ["Nf3", "Nf6", "Ng1", "Ng8"]) }
    h.check(capped.add(OT.Game(sanMoves: shuffle, userIsWhite: true, outcome: nil),
                       maxPlies: 6) == 6, "the cap truncates the walk")
    h.check(capped.depth == 6, "and the tree is exactly that deep")
    h.check(OT.defaultMaxPlies == 40, "the default cap is 20 full moves")

    // ---- off book: where the path LEAVES the tree -----------------------------
    //
    // `children(at:)` answers [:] both at a leaf and for a path that has left the tree, so the
    // explorer showed one empty card for two different things and Forward was dead either way.
    // `bookDepth` is the same walk, reporting where it stopped.
    var book = OT()
    book.add(OT.Game(sanMoves: ["e4", "c5", "Nf3"], userIsWhite: true, outcome: .whiteWin))
    h.check(book.bookDepth(along: []) == 0, "the empty path is zero plies into the book")
    h.check(book.bookDepth(along: ["e4"]) == 1, "one on-book ply is one")
    h.check(book.bookDepth(along: ["e4", "c5", "Nf3"]) == 3, "and the whole line is three")
    h.check(book.bookDepth(along: ["d4"]) == 0, "a first move nobody played is zero, not one")
    h.check(book.bookDepth(along: ["e4", "e5"]) == 1, "a divergence at ply two reports ply one")
    h.check(book.bookDepth(along: ["e4", "e5", "Nf3"]) == 1,
            "and everything after it is off book too, however legal")
    h.check(book.bookDepth(along: ["e4", "c5", "Nf3", "d6"]) == 3,
            "playing past a LEAF is off book as well — a leaf and a divergence answer the same")
    h.check(book.bookDepth(along: ["Zz9"]) == 0, "an unreadable SAN is simply not in the tree")
    h.check(book.sortedMoves(at: ["e4", "e5"]).isEmpty, "and off book there are no candidates")
    // The transposition, asserted as a DECISION rather than discovered as a surprise.
    h.check(book.bookDepth(along: ["Nf3", "c5", "e4"]) == 0,
            "1.Nf3 c5 2.e4 transposes into 1.e4 c5 2.Nf3 and is STILL off book — the tree is keyed "
            + "by the line you played, which is why OpeningBook exists and keys by FEN")
    h.check(OT.maxFreePlies == 20, "twenty plies of free play hang off the tree")
    h.check(OT.maxFreePlies < OT.defaultMaxPlies, "fewer than the tree itself is deep")
    h.check(OT.maxFreePlies % 2 == 0, "and a whole number of full moves")

    // ---- paths off the tree --------------------------------------------------
    h.check(sorted.node(at: ["Zz9"]) == nil, "an unknown path has no node")
    h.check(sorted.children(at: ["Zz9"]).isEmpty, "and no children")
    h.check(sorted.sortedMoves(at: ["Zz9", "e4"]).isEmpty, "walking past it stays empty")
    h.check(OT().isEmpty, "a fresh tree is empty")

    // ---- PGN -> games --------------------------------------------------------
    let pgn = """
    [White "Alice"]
    [Black "Bob"]
    [Result "0-1"]

    1. e4 e5 2. Nf3 0-1

    [White "Bob"]
    [Black "Alice"]
    [Result "1-0"]

    1. d4 d5 1-0
    """
    let games = OT.games(fromPGN: pgn, userName: "alice")
    h.check(games.count == 2, "two games split apart")
    h.check(games.first?.userIsWhite == true, "Alice was White in the first")
    h.check(games.first?.outcome == .blackWin, "and lost it")
    h.check(games.last?.userIsWhite == false, "she was Black in the second")
    h.check(games.last?.outcome == .whiteWin, "which she also lost")
    h.check(OT.games(fromPGN: pgn, userName: "alice", colour: .white).count == 1,
            "the colour filter keeps only her White games")
    h.check(OT.games(fromPGN: pgn, userName: "alice", colour: .black).count == 1,
            "and only her Black ones")
    h.check(OT.games(fromPGN: pgn, userName: "carol", fallbackIsWhite: false).count == 2,
            "an unmatched name falls back rather than dropping the game")
    h.check(OT.games(fromPGN: pgn, userName: "carol", fallbackIsWhite: false).first?.userIsWhite
            == false, "…to the side the form picked")
    // The terminator stands in for a missing Result tag — and it is read off the MOVETEXT, because
    // `PGN.mainlineTokens` drops result tokens by design.
    let bare = OT.games(fromPGN: "[Event \"x\"]\n\n1. e4 e5 1/2-1/2\n", userName: nil)
    h.check(bare.count == 1 && bare.first?.outcome == .draw,
            "a movetext terminator stands in for a missing Result tag")

    // ---- colour --------------------------------------------------------------
    h.check(OT.Colour.white.accepts(isWhite: true), "the white filter takes white games")
    h.check(!OT.Colour.white.accepts(isWhite: false), "and refuses black ones")
    h.check(OT.Colour.both.accepts(isWhite: true) && OT.Colour.both.accepts(isWhite: false),
            "both takes either")
    h.check(OT.Colour.allCases.count == 3, "three colour filters")

    // ---- persistence ---------------------------------------------------------
    var round = OT()
    round.add(games)
    let data = round.encodedJSON()
    h.check(data != nil, "a tree encodes")
    if let data, let back = OT.decodedJSON(data) {
        h.check(back == round, "and decodes back to itself")
        h.check(back.sortedMoves(at: []).map(\.san) == round.sortedMoves(at: []).map(\.san),
                "with the same candidate order")
        h.check(back.gameCount == round.gameCount, "and the same game count")
    } else {
        h.check(false, "the encoded tree decodes")
    }
    // Deterministic bytes, so "did this change?" is answerable in the store and in a diff.
    h.check(round.encodedJSON() == round.encodedJSON(), "encoding is byte-stable")

    // ---- the download ---------------------------------------------------------
    //
    // The client reported the Opening Tree as broken because picking Lichess or Chess.com set
    // `errNetwork` — "check your connection" — for a download nobody had written. These run the
    // parse half on a Mac; `replay_opening_tree.js` §12 is the half that runs on Windows.
    typealias DL = OpeningDownload

    // Limits. The RN form clamps at 1000 in both of its two places, and this app carried 2000.
    h.check(DL.premiumMaxGames == 1000, "the premium ceiling is the RN form's real 1000")
    h.check(DL.freeMaxGames == 100, "and the free one is 100")
    h.check(DL.resolvedMax(isPremium: false, requested: 900) == 100, "free ignores the box")
    h.check(DL.resolvedMax(isPremium: true, requested: 900) == 900, "premium gets what it asks")
    h.check(DL.resolvedMax(isPremium: true, requested: 99_999) == 1000, "up to the ceiling")
    h.check(DL.resolvedMax(isPremium: true, requested: 0) == 1, "an empty box is one game")

    // Endpoints. A username must not be able to escape its path segment.
    h.check(DL.lichessGamesURL(username: "bob", maxGames: 7)
            == "https://lichess.org/api/games/user/bob?pgnInJson=true&max=7", "the lichess URL")
    h.check(DL.lichessGamesURL(username: "a/b", maxGames: 1)
            == "https://lichess.org/api/games/user/a%2Fb?pgnInJson=true&max=1",
            "a slash in a username is escaped, not passed through")
    h.check(DL.chesscomArchivesURL(username: "bob")
            == "https://api.chess.com/pub/player/bob/games/archives", "the chess.com URL")
    h.check(DL.encodeComponent("a b") == "a%20b", "a space is escaped")
    h.check(DL.encodeComponent("Aa9-_.!~*'()") == "Aa9-_.!~*'()",
            "and encodeURIComponent's unreserved set is left alone")

    // What a status means. Exactly one code is worth a different sentence.
    h.check(DL.failure(forStatus: 404) == .unknownUser, "404 is a username the site lacks")
    h.check(DL.failure(forStatus: 500) == .network, "500 is worth retrying")
    h.check(DL.isSuccess(status: 200) && DL.isSuccess(status: 299), "2xx is success")
    h.check(!DL.isSuccess(status: 300) && !DL.isSuccess(status: 199), "and nothing either side")

    // One NDJSON line.
    //
    // The fixtures are SERIALISED rather than written as string literals. A hand-escaped JSON blob
    // is unreadable, and a `"""` block full of braces is worse than unreadable here — it defeats
    // `swift_lint.js`, whose bracket balancer treats `"""` as an empty string followed by a live
    // one and then reports the JSON's own braces as unbalanced code.
    func ndjson(_ object: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }
    func player(_ white: String, _ black: String) -> [String: Any] {
        ["white": ["user": ["name": white]], "black": ["user": ["name": black]]]
    }

    let line = ndjson(["moves": "e4 c5 Nf3", "winner": "white", "status": "mate",
                       "players": player("Alice", "Bob")])
    let parsed = DL.game(fromLichessLine: line, username: "alice", fallbackIsWhite: true)
    h.check(parsed?.sanMoves == ["e4", "c5", "Nf3"], "a line's moves parse")
    h.check(parsed?.userIsWhite == true, "the username matches White case-insensitively")
    h.check(parsed?.outcome == .whiteWin, "and winner:white is 1-0")
    h.check(DL.game(fromLichessLine: line, username: "BOB", fallbackIsWhite: true)?.userIsWhite
            == false, "the same game reads from Black's side")
    h.check(DL.game(fromLichessLine: line, username: "carol", fallbackIsWhite: false)?.userIsWhite
            == false, "an unmatched username falls back to the picker")
    h.check(DL.game(fromLichessLine: "", username: "a", fallbackIsWhite: true) == nil,
            "a blank line is not a game")
    h.check(DL.game(fromLichessLine: "not json", username: "a", fallbackIsWhite: true) == nil,
            "nor is broken JSON — one bad line must not lose the stream")
    h.check(DL.game(fromLichessLine: ndjson(["winner": "white"]), username: "a",
                    fallbackIsWhite: true) == nil, "nor is a line with no moves")

    // The aborted-game deviation: the RN mapping scores every winner-less game as a draw.
    h.check(DL.game(fromLichessLine: ndjson(["moves": "e4", "status": "aborted"]),
                    username: "a", fallbackIsWhite: true)?.outcome == nil,
            "an ABORTED game has no result — the RN code scores it as a draw")
    h.check(DL.game(fromLichessLine: ndjson(["moves": "e4 e5", "status": "draw"]),
                    username: "a", fallbackIsWhite: true)?.outcome == .draw,
            "while a real draw still is one")
    h.check(DL.lichessUnfinishedStatuses.contains("aborted"), "and aborted is on the list")

    // A whole body, and the colour filter the RN screen does not apply. The blank line between the
    // two is deliberate — a real stream carries them, and they must not become a third game.
    let body = ndjson(["moves": "e4 c5", "winner": "white", "status": "mate",
                       "players": player("Alice", "Bob")])
        + "\n\n"
        + ndjson(["moves": "d4 Nf6", "winner": "black", "status": "resign",
                  "players": player("Bob", "Alice")])
    h.check(DL.games(fromLichessNDJSON: body, username: "alice", colour: .both).count == 2,
            "both games come back for 'both'")
    let whiteOnly = DL.games(fromLichessNDJSON: body, username: "alice", colour: .white)
    h.check(whiteOnly.count == 1 && whiteOnly.first?.userIsWhite == true,
            "and only the White one for 'white' — read off the GAME, not assumed from the form")
    let blackOnly = DL.games(fromLichessNDJSON: body, username: "alice", colour: .black)
    h.check(blackOnly.count == 1 && blackOnly.first?.outcome == .blackWin,
            "the Black one keeps the result she actually got")

    // Chess.com: archives newest first, and the PGN goes through the pinned parser.
    func json(_ object: Any) -> Data {
        (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    }
    let archiveJSON = json(["archives": ["u/2024/01", "u/2024/02"]])
    h.check(DL.chesscomArchives(fromJSON: archiveJSON) == ["u/2024/02", "u/2024/01"],
            "archives are reversed to newest-first — oldest-first builds every tree from month one")
    h.check(DL.chesscomArchives(fromJSON: json([:] as [String: Any])).isEmpty,
            "a shapeless body is none")
    let pgnA = "[White \"Alice\"]\n[Black \"Bob\"]\n[Result \"1-0\"]\n\n1. e4 c5 1-0"
    let pgnB = "[White \"Bob\"]\n[Black \"Alice\"]\n[Result \"1-0\"]\n\n1. d4 Nf6 1-0"
    let monthJSON = json(["games": [["pgn": pgnA], ["pgn": pgnB]]])
    let month = DL.games(fromChesscomArchiveJSON: monthJSON, username: "Alice", colour: .both)
    h.check(month.count == 2, "both games in a month")
    h.check(month.first?.userIsWhite == false, "newest first — Alice had Black in the later game")
    h.check(DL.games(fromChesscomArchiveJSON: monthJSON, username: "Alice", colour: .white).count
            == 1, "the colour filter reaches the archive path too")

    // The ceiling, which both sites overshoot for different reasons.
    let three = [OT.Game(sanMoves: ["e4"], userIsWhite: true, outcome: nil),
                 OT.Game(sanMoves: ["d4"], userIsWhite: true, outcome: nil),
                 OT.Game(sanMoves: ["c4"], userIsWhite: true, outcome: nil)]
    h.check(DL.trim(three, have: 0, limit: 2).count == 2, "a chunk is trimmed to the room left")
    h.check(DL.trim(three, have: 2, limit: 2).isEmpty, "and nothing survives a full tree")
    h.check(DL.trim(three, have: 0, limit: 9).count == 3, "an under-full chunk passes whole")

    // A downloaded game and a pasted one of the same game must build the same tree.
    var fromWire = OT()
    fromWire.add(DL.games(fromLichessNDJSON: body, username: "alice", colour: .both))
    var fromPaste = OT()
    fromPaste.add([OT.Game(sanMoves: ["e4", "c5"], userIsWhite: true, outcome: .whiteWin),
                   OT.Game(sanMoves: ["d4", "Nf6"], userIsWhite: false, outcome: .blackWin)])
    h.check(fromWire == fromPaste, "a downloaded tree equals the pasted tree of the same games")
}

// MARK: - Done

// Every mandatory group must contribute at least its expected floor of assertions
// (guards against vacuous passes AND truncated goldens). Floors are the deterministic
// current counts; bump when cases are intentionally added.
h.requireMinCounts([
    "rating": 390, "compare_moves": 6, "streak_target": 36, "streak_increment": 4, "streak_reset": 2,
    "daily_limits": 168, "daily_goal": 18, "game_review": 47, "classify": 88, "rating_tier": 14, "rush": 12,
    "perft": 17, "chess_ai": 2, "san_parse": 9000, "notation_extra": 30, "draw_rules": 30,
    "movetree": 35, "pgn_tokens": 180, "pgn_split": 35, "pgn_roundtrip": 35, "search": 66,
    "engine_settings": 70,
    "eco": 1200, "review_book": 1500, "analysis_session": 235, "analysis_store": 80,
    "position_editor": 80,
    // No golden file: the source is TypeScript, not a Laravel controller, so there is no PHP
    // oracle. The differential partner is web-demo/js/opening-tree.js, compared source-to-source
    // by tools/qa/replay_opening_tree.js.
    // 60 -> 97: the download's parse half (limits, endpoints, NDJSON, archives, the ceiling and
    // the aborted-game deviation). 97 -> 110: `bookDepth` and `maxFreePlies` — the off-book model
    // an interactive board needs, including the transposition decision. RAISED, never lowered.
    "opening_tree": 110,
    "puzzle_session": 600, "puzzle_selection": 1100, "puzzle_progress": 70,
    "swiss_pairings": 27, "rr_pairings": 29, "tiebreakers": 13, "standings": 1, "serving": 45,
    "scoring": 12, "misc": 19, "swiss_scenario": 65, "rr_scenario": 67,
    "phpcompat_names": 1089, "phpcompat_truthy": 14,
    "rating_random": 3000, "daily_goal_random": 1000, "game_review_random": 6114,
    "swiss_random": 9814, "rr_random": 8164,
])

exit(Int32(h.summary()))
