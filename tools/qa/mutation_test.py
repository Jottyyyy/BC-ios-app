#!/usr/bin/env python3
"""Mutation testing for the parity suite.

Injects one deliberate fault at a time into the domain engines, rebuilds, runs ParityRunner,
and confirms it goes RED (non-zero exit). A surviving mutation (suite stays GREEN) is a
coverage/assertion hole. Each source file is always restored.
"""
import subprocess, sys, os

ROOT = "/Users/joshuagencianeo/Documents/GitHub/BC-ios-app"
SRC = os.path.join(ROOT, "Sources/BiyaherongCoachCore")

# (name, file, old_substring, new_substring)
MUTATIONS = [
    # Rating
    ("rating_floor_flip",      "Rating.swift",      "max(floor, userRating + ratingChange)", "min(floor, userRating + ratingChange)"),
    ("rating_k_factor",        "Rating.swift",      "public static let kFactor = 32.0",       "public static let kFactor = 30.0"),
    ("rating_round_trunc",     "Rating.swift",      "(kFactor * (actual - expected)).rounded(.toNearestOrAwayFromZero)", "(kFactor * (actual - expected)).rounded(.towardZero)"),
    ("compare_moves_flip",     "Rating.swift",      "return u == c",                          "return u != c"),
    # Streak
    ("streak_cap_removed",     "Streak.swift",      "s.puzzleRating = min(ratingMax, s.puzzleRating + ratingStep)", "s.puzzleRating = s.puzzleRating + ratingStep"),
    ("streak_warmup_boundary", "Streak.swift",      "let isWarmup = currentStreak < warmupCount", "let isWarmup = currentStreak <= warmupCount"),
    ("streak_step",            "Streak.swift",      "public static let ratingStep = 50",      "public static let ratingStep = 40"),
    # Daily limits
    ("daily_limit_boundary",   "DailyLimits.swift", "return usedToday >= maxUses(for: mode)", "return usedToday > maxUses(for: mode)"),
    ("daily_regular_cap",      "DailyLimits.swift", '"regular": 5,   // rated Play Puzzles',  '"regular": 4,   // rated Play Puzzles'),
    ("daily_rush_default",     "DailyLimits.swift", 'if mode.hasPrefix("rush_") { return 1 }', 'if mode.hasPrefix("rush_") { return 2 }'),
    # Daily goal
    ("dailygoal_yesterday",    "DailyGoal.swift",   "calendar.date(byAdding: .day, value: -1, to: todayStart)!", "calendar.date(byAdding: .day, value: -2, to: todayStart)!"),
    ("dailygoal_gap_branch",   "DailyGoal.swift",   "} else if date < checkDate {",           "} else if date <= checkDate {"),
    # Game review
    ("gr_excellent_boundary",  "GameReview.swift",  'if cpLoss <= 15 { return "excellent" }', 'if cpLoss <= 14 { return "excellent" }'),
    ("gr_mate_fold_sign",      "GameReview.swift",  "return mate > 0 ? (10000 - mate * 10) : (-10000 - mate * 10)", "return mate > 0 ? (10000 + mate * 10) : (-10000 - mate * 10)"),
    ("gr_brilliant_capture",   "GameReview.swift",  'return san.contains("x") && improvement >= 150', 'return san.contains("z") && improvement >= 150'),
    ("gr_winpct_divisor",      "GameReview.swift",  "50 + 50 * (2 / (1 + pow(10, -eval / 400)) - 1)", "50 + 50 * (2 / (1 + pow(10, -eval / 300)) - 1)"),
    ("gr_great_boundary",      "GameReview.swift",  'if isBestMove && cpLoss <= 5 { return "great" }', 'if isBestMove && cpLoss <= 6 { return "great" }'),
    ("gr_blunder_boundary",    "GameReview.swift",  'if cpLoss <= 200 { return "miss" }',     'if cpLoss <= 201 { return "miss" }'),
    # Tournament
    ("tourn_balance_ge",       "Tournament.swift",  "if wBalance > bBalance {",               "if wBalance >= bBalance {"),
    ("tourn_draw_score",       "Tournament.swift",  "white.score += 0.5; white.draws += 1; black.score += 0.5; black.draws += 1", "white.score += 0.6; white.draws += 1; black.score += 0.5; black.draws += 1"),
    ("tourn_standings_dir",    "Tournament.swift",  "if x.score != y.score { return x.score > y.score }", "if x.score != y.score { return x.score < y.score }"),
    ("tourn_rr_color",         "Tournament.swift",  "} else if roundNumber % 2 == 0 && i == 0 {", "} else if roundNumber % 2 == 1 && i == 0 {"),
    ("tourn_rematch_invert",   "Tournament.swift",  "if !history.contains(key) { bestMatch = p2; bestIndex = idx; break }", "if history.contains(key) { bestMatch = p2; bestIndex = idx; break }"),
    ("tourn_buchholz_trunc",   "Tournament.swift",  "result[idx].buchholz = Int(buchholz.rounded(.toNearestOrAwayFromZero))", "result[idx].buchholz = Int(buchholz)"),
    ("tourn_de_epsilon",       "Tournament.swift",  "if abs(oppScore - (scores[player.id] ?? 0)) < 0.01 {", "if abs(oppScore - (scores[player.id] ?? 0)) < 100 {"),
    ("tourn_win_score",        "Tournament.swift",  'case "1-0": white.score += 1; white.wins += 1; black.losses += 1', 'case "1-0": white.score += 2; white.wins += 1; black.losses += 1'),
    ("tourn_standings_wins",   "Tournament.swift",  "if x.wins != y.wins { return x.wins > y.wins }", "if x.wins != y.wins { return x.wins < y.wins }"),
    # Puzzle serving
    ("serving_window_lo",      "PuzzleServing.swift", "c.rating >= lo && c.rating <= hi",     "c.rating > lo && c.rating <= hi"),
    ("serving_window_hi",      "PuzzleServing.swift", "c.rating >= lo && c.rating <= hi",     "c.rating >= lo && c.rating < hi"),
    ("serving_closest_absent", "PuzzleServing.swift", "let da = abs(a.rating - center), db = abs(b.rating - center)", "let da = (a.rating - center), db = abs(b.rating - center)"),
    ("serving_closest_tie",    "PuzzleServing.swift", "return da != db ? da < db : a.id < b.id", "return da != db ? da < db : a.id > b.id"),
    ("tourn_reverse_score",    "Tournament.swift",  'case "1-0": white.score -= 1; white.wins -= 1; black.losses -= 1', 'case "1-0": white.score -= 2; white.wins -= 1; black.losses -= 1'),
    ("tourn_rr_rounds",        "Tournament.swift",  "var rounds = playerCount % 2 == 0 ? playerCount - 1 : playerCount", "var rounds = playerCount % 2 == 0 ? playerCount + 1 : playerCount"),
    ("daylimit_daykey_pad",    "DailyLimits.swift", '"%04d-%02d-%02d"',                       '"%04d-%02d-%d"'),
    ("swiss_total_rounds",     "Tournament.swift",  "min(requested ?? 3, isPremium ? premiumMaxRounds : freeMaxRounds)", "max(requested ?? 3, isPremium ? premiumMaxRounds : freeMaxRounds)"),
    # Rating tier + rush
    ("rating_tier_expert",     "Rating.swift",      'if rating >= 2000 { return "Expert" }',  'if rating >= 2001 { return "Expert" }'),
    ("rating_tier_beginner",   "Rating.swift",      'if rating >= 800 { return "Beginner" }', 'if rating >= 801 { return "Beginner" }'),
    ("rush_best_dir",          "PuzzleRush.swift",  "submitted > (stored ?? 0) ? submitted : (stored ?? 0)", "submitted < (stored ?? 0) ? submitted : (stored ?? 0)"),
    ("rush_label_infinite",    "PuzzleRush.swift",  'case 0: return "Infinite"',              'case 0: return "Zero"'),
    # PHP compat
    ("phpcompat_truthy_zero",  "PHPCompat.swift",   'func phpStringIsTruthy(_ s: String) -> Bool { !(s.isEmpty || s == "0") }', 'func phpStringIsTruthy(_ s: String) -> Bool { !(s.isEmpty || s == "1") }'),
    ("phpcompat_numeric_dir",  "PHPCompat.swift",   "if da < db { return -1 }",               "if da < db { return 1 }"),
]


# Known EQUIVALENT mutants: mutations that provably cannot change observable behavior, so no
# test can (or should) kill them. Excluded from the survivor gate with justification.
EQUIVALENT = {
    # `else if date < checkDate` is only reached when date != checkDate (the `== checkDate` case is
    # handled by the preceding `if`), so `<=` is identical to `<`. Provably a no-op.
    "dailygoal_gap_branch": "unreachable-equal: preceding `== checkDate` branch makes <= identical to <",
}


def run_suite():
    r = subprocess.run(["swift", "run", "ParityRunner"], cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def main():
    print("Baseline run…")
    rc, out, err = run_suite()
    if rc != 0:
        print("BASELINE NOT GREEN — aborting.\n", out[-2000:], err[-2000:]); sys.exit(2)
    print("Baseline GREEN.\n")

    killed, survived, skipped, build_killed = [], [], [], []
    for i, (name, f, old, new) in enumerate(MUTATIONS, 1):
        path = os.path.join(SRC, f)
        orig = open(path).read()
        n = orig.count(old)
        if n != 1:
            skipped.append((name, f"old occurs {n}x")); print(f"[{i:>2}/{len(MUTATIONS)}] {name:26} SKIP (matches {n})"); continue
        try:
            open(path, "w").write(orig.replace(old, new, 1))
            rc, out, err = run_suite()
        finally:
            open(path, "w").write(orig)
        is_build_err = ("error:" in err) or ("error:" in out)
        if rc != 0:
            if is_build_err: build_killed.append(name); tag = "KILLED (build err)"
            else: killed.append(name); tag = "KILLED"
        else:
            survived.append(name); tag = "*** SURVIVED ***"
        print(f"[{i:>2}/{len(MUTATIONS)}] {name:26} {tag}")

    real_survivors = [s for s in survived if s not in EQUIVALENT]
    equiv_survivors = [s for s in survived if s in EQUIVALENT]

    print("\n" + "=" * 60)
    total = len(MUTATIONS) - len(skipped)
    print(f"Mutations: {len(MUTATIONS)}  | tested: {total}  | killed(behavior): {len(killed)}  | killed(build): {len(build_killed)}  | survived: {len(survived)}  | skipped: {len(skipped)}")
    if build_killed: print("killed via build error (weaker signal):", ", ".join(build_killed))
    if skipped: print("skipped (bad match):", ", ".join(f"{n}({r})" for n, r in skipped))
    if equiv_survivors:
        print("\nℹ️  Survived but EQUIVALENT (provably cannot be killed):")
        for s in equiv_survivors: print(f"   • {s} — {EQUIVALENT[s]}")
    if real_survivors:
        print("\n❌ REAL SURVIVORS (coverage/assertion holes):")
        for s in real_survivors: print("   •", s)
    else:
        print("\n✅ No real survivors — every non-equivalent fault was caught by the suite.")

    print("\nRestoring + verifying baseline…")
    rc, _, _ = run_suite()
    print("Baseline GREEN after restore." if rc == 0 else "!!! BASELINE NOT GREEN AFTER RESTORE — check files.")
    sys.exit(1 if real_survivors or rc != 0 else 0)


if __name__ == "__main__":
    main()
