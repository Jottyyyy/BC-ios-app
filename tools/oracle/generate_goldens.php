<?php
/**
 * Golden-vector generator for the Biyaherong parity suite.
 *
 * Each function below is a faithful standalone extraction of the corresponding Laravel
 * controller method (verified against ../../BYAHERONG-COACH-LARAVEL). The arithmetic
 * engines (ELO, streak, daily limits, daily goal, game review) copy the exact function
 * bodies. The tournament engine re-ports the private methods using plain arrays plus a
 * stable sort that mirrors Laravel Collection semantics (stable + numeric, PHP 8).
 *
 * Output: JSON files under <repo>/Goldens/ consumed by the Swift ParityRunner.
 */

$OUT = realpath(__DIR__ . '/../..') . '/Goldens';
@mkdir($OUT, 0777, true);
function dumpGolden(string $name, $data): void {
    global $OUT;
    file_put_contents("$OUT/$name.json",
        json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    echo "wrote $name.json\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ELO (PuzzleController::submitAnswer, verbatim math) + compareMoves
// ─────────────────────────────────────────────────────────────────────────────
function elo(int $userRating, int $puzzleRating, bool $isCorrect): array {
    $expectedScore = 1 / (1 + pow(10, ($puzzleRating - $userRating) / 400));
    $actualScore   = $isCorrect ? 1 : 0;
    $kFactor       = 32;
    $ratingChange  = (int) round($kFactor * ($actualScore - $expectedScore));
    $newRating     = max(400, $userRating + $ratingChange);
    return [
        'userRating' => $userRating, 'puzzleRating' => $puzzleRating, 'isCorrect' => $isCorrect,
        'expectedScore' => $expectedScore, 'ratingChange' => $ratingChange, 'newRating' => $newRating,
    ];
}
$eloCases = [];
foreach ([400, 600, 800, 1200, 1600, 2000, 2400] as $ur) {
    foreach ([400, 700, 1000, 1200, 1201, 1500, 1900, 2300, 3000] as $pr) {
        foreach ([true, false] as $ok) { $eloCases[] = elo($ur, $pr, $ok); }
    }
}
// explicit edge cases
$eloCases[] = elo(1200, 1200, true);   // expect +16
$eloCases[] = elo(1200, 1200, false);  // expect -16
$eloCases[] = elo(400, 3000, false);   // floor clamp: stays 400
$eloCases[] = elo(400, 400, false);    // 400 - 16 -> max(400,384)=400
dumpGolden('rating', $eloCases);

function compareMoves(array $correct, array $user): bool {
    return isset($user[0]) && $user[0] === $correct[0];
}
$cmCases = [];
foreach ([
    [['a4e8','g8g7'], ['a4e8'],        true],
    [['a4e8','g8g7'], ['a4e8','x'],    true],
    [['a4e8'],        ['a4e9'],        false],
    [['a4e8'],        [],              false],
    [[],              ['a4e8'],        false],
    [['e2e4'],        ['E2E4'],        false], // case-sensitive
] as [$c, $u, $exp]) {
    $cmCases[] = ['correct' => $c, 'user' => $u, 'expected' => compareMoves($c, $u)];
}
dumpGolden('compare_moves', $cmCases);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Streak (StreakController)
// ─────────────────────────────────────────────────────────────────────────────
function streakTarget(int $cur, int $pr): array {
    $warm = $cur < 10;
    return ['currentStreak' => $cur, 'puzzleRating' => $pr,
            'targetRating' => $warm ? 600 : $pr, 'theme' => $warm ? 'mateIn1' : null];
}
$targetCases = [];
foreach ([0, 1, 9, 10, 11, 30] as $cur) {
    foreach ([600, 900, 2500] as $pr) { $targetCases[] = streakTarget($cur, $pr); }
}
dumpGolden('streak_target', $targetCases);

function streakIncrement(array $s, ?int $nextId): array {
    $s['currentStreak'] += 1;
    if ($s['currentStreak'] > $s['bestStreak']) $s['bestStreak'] = $s['currentStreak'];
    $s['puzzleRating'] = min(2500, ($s['puzzleRating'] ?? 600) + 50);
    $s['pendingPuzzleId'] = $nextId;
    return $s;
}
$incCases = [];
foreach ([
    [['currentStreak' => 0, 'bestStreak' => 0, 'puzzleRating' => 600, 'pendingPuzzleId' => 5], 9],
    [['currentStreak' => 4, 'bestStreak' => 10, 'puzzleRating' => 800, 'pendingPuzzleId' => 5], 42],
    [['currentStreak' => 38, 'bestStreak' => 38, 'puzzleRating' => 2490, 'pendingPuzzleId' => 1], 99], // cap at 2500
    [['currentStreak' => 40, 'bestStreak' => 40, 'puzzleRating' => 2500, 'pendingPuzzleId' => 1], null], // stays 2500
] as [$in, $next]) {
    $incCases[] = ['in' => $in, 'nextPuzzleId' => $next, 'out' => streakIncrement($in, $next)];
}
dumpGolden('streak_increment', $incCases);

function streakReset(array $s): array {
    $s['currentStreak'] = 0; $s['puzzleRating'] = 600; $s['pendingPuzzleId'] = null;
    return $s;
}
$resetCases = [];
foreach ([
    ['currentStreak' => 12, 'bestStreak' => 20, 'puzzleRating' => 1200, 'pendingPuzzleId' => 7],
    ['currentStreak' => 0, 'bestStreak' => 0, 'puzzleRating' => 600, 'pendingPuzzleId' => null],
] as $in) {
    $resetCases[] = ['in' => $in, 'out' => streakReset($in)];
}
dumpGolden('streak_reset', $resetCases);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Daily limits (ChecksDailyLimits)
// ─────────────────────────────────────────────────────────────────────────────
function maxUses(string $mode): int {
    if (str_starts_with($mode, 'rush_')) return 1;
    $caps = ['regular' => 5, 'streak' => 1, 'coach' => 2];
    return $caps[$mode] ?? 1;
}
function isAtLimit(string $mode, int $used, bool $prem): bool {
    if ($prem) return false;
    return $used >= maxUses($mode);
}
$dlCases = [];
foreach (['regular', 'streak', 'coach', 'rush_0', 'rush_3', 'rush_5', 'unknown_mode'] as $mode) {
    foreach ([0, 1, 2, 4, 5, 6] as $used) {
        foreach ([false, true] as $prem) {
            $dlCases[] = ['mode' => $mode, 'usedToday' => $used, 'isPremium' => $prem,
                          'maxUses' => maxUses($mode), 'isAtLimit' => isAtLimit($mode, $used, $prem)];
        }
    }
}
dumpGolden('daily_limits', $dlCases);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Daily goal (DailyGoalController::calculateStreak) — UTC day math
// ─────────────────────────────────────────────────────────────────────────────
function calcStreakDays(array $dateStrs, string $todayStr): int {
    // distinct start-of-day (Y-m-d), sorted desc, limit 365
    $set = array_values(array_unique($dateStrs));
    rsort($set); // string desc == date desc for Y-m-d
    $set = array_slice($set, 0, 365);
    if (empty($set)) return 0;

    $today = new DateTimeImmutable($todayStr, new DateTimeZone('UTC'));
    $streak = 0;
    $check = $today;

    if (!in_array($today->format('Y-m-d'), $set, true)) {
        $check = $today->modify('-1 day');
    }
    foreach ($set as $ds) {
        $d = new DateTimeImmutable($ds, new DateTimeZone('UTC'));
        $cmp = $d <=> $check;
        if ($cmp === 0) {
            $streak++;
            $check = $check->modify('-1 day');
        } elseif ($cmp < 0) {
            break;
        }
    }
    return $streak;
}
$dgCases = [];
$dgInputs = [
    [[], '2026-07-23'],
    [['2026-07-23'], '2026-07-23'],                                   // solved today -> 1
    [['2026-07-22'], '2026-07-23'],                                   // solved yesterday only -> 1
    [['2026-07-21'], '2026-07-23'],                                   // gap -> 0
    [['2026-07-23','2026-07-22','2026-07-21'], '2026-07-23'],         // 3
    [['2026-07-22','2026-07-21','2026-07-20'], '2026-07-23'],         // ends yesterday -> 3
    [['2026-07-23','2026-07-21','2026-07-20'], '2026-07-23'],         // today + gap -> 1
    [['2026-07-23','2026-07-23','2026-07-22'], '2026-07-23'],         // dup today -> 2
    [['2026-07-20','2026-07-19'], '2026-07-23'],                      // stale -> 0
];
foreach ($dgInputs as [$dates, $today]) {
    $dgCases[] = ['solveDates' => $dates, 'today' => $today, 'streakDays' => calcStreakDays($dates, $today)];
}
dumpGolden('daily_goal', $dgCases);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Game review (GameReviewController, verbatim methods)
// ─────────────────────────────────────────────────────────────────────────────
function normalizeEval(array $eval): int {
    if (isset($eval['eval_mate']) && $eval['eval_mate'] !== null) {
        $mate = (int) $eval['eval_mate'];
        return $mate > 0 ? 10000 - $mate * 10 : -10000 - $mate * 10;
    }
    return (int) ($eval['eval_cp'] ?? 0);
}
function classifyMove(int $cpLoss, bool $isBestMove, bool $isBrilliant = false): string {
    if ($isBrilliant)                return 'brilliant';
    if ($isBestMove && $cpLoss <= 5) return 'great';
    if ($isBestMove || $cpLoss <= 0) return 'best';
    if ($cpLoss <= 15)               return 'excellent';
    if ($cpLoss <= 30)               return 'good';
    if ($cpLoss <= 60)               return 'inaccuracy';
    if ($cpLoss <= 120)              return 'mistake';
    if ($cpLoss <= 200)              return 'miss';
    return 'blunder';
}
function isBrilliantMove(string $san, string $color, int $before, int $after): bool {
    $improvement = $color === 'w' ? ($after - $before) : ($before - $after);
    if ($improvement < 100) return false;
    return str_contains($san, 'x') && $improvement >= 150;
}
function evalToWinPct(int $evalCp, string $color): float {
    $eval = $color === 'w' ? $evalCp : -$evalCp;
    return 50 + 50 * (2 / (1 + pow(10, -$eval / 400)) - 1);
}
function review(array $evaluations, array $moves): array {
    $empty = ['brilliant' => 0, 'great' => 0, 'best' => 0, 'excellent' => 0,
              'good' => 0, 'inaccuracy' => 0, 'mistake' => 0, 'miss' => 0, 'blunder' => 0];
    $whiteClass = $empty; $blackClass = $empty;
    $whiteAcc = []; $blackAcc = [];
    $moveEvals = []; $graph = [];

    $graph[] = ['move_index' => 0, 'eval_cp' => normalizeEval($evaluations[0]),
                'eval_mate' => $evaluations[0]['eval_mate'] ?? null];

    for ($i = 1; $i < count($evaluations); $i++) {
        $move = $moves[$i] ?? null;
        $color = $move['color'] ?? null;
        $san = $move['san'] ?? null;
        $before = normalizeEval($evaluations[$i - 1]);
        $after = normalizeEval($evaluations[$i]);
        $graph[] = ['move_index' => $i, 'eval_cp' => $after, 'eval_mate' => $evaluations[$i]['eval_mate'] ?? null];
        if (!$color || !$san) continue;

        $cpLoss = $color === 'w' ? $before - $after : $after - $before;
        $cpLoss = max(0, $cpLoss);
        $bestMoveSan = $evaluations[$i - 1]['best_move_san'] ?? null;
        $isBest = $bestMoveSan && $san === $bestMoveSan;
        $isBrill = isBrilliantMove($san, $color, $before, $after);
        $cls = classifyMove($cpLoss, $isBest, $isBrill);
        $moveEvals[] = ['move_index' => $i, 'classification' => $cls, 'cp_loss' => $cpLoss, 'best_move_san' => $bestMoveSan];
        if ($color === 'w') $whiteClass[$cls]++; else $blackClass[$cls]++;

        $wpB = evalToWinPct($before, $color);
        $wpA = evalToWinPct($after, $color);
        $acc = $wpB > 0 ? min(100, max(0, ($wpA / $wpB) * 100)) : ($wpA >= $wpB ? 100 : 0);
        if ($color === 'w') $whiteAcc[] = $acc; else $blackAcc[] = $acc;
    }
    $wA = count($whiteAcc) > 0 ? round(array_sum($whiteAcc) / count($whiteAcc), 1) : 0;
    $bA = count($blackAcc) > 0 ? round(array_sum($blackAcc) / count($blackAcc), 1) : 0;

    return [
        'whiteAccuracy' => $wA, 'blackAccuracy' => $bA,
        'whiteClassifications' => $whiteClass, 'blackClassifications' => $blackClass,
        'moveEvaluations' => $moveEvals, 'evalGraph' => $graph,
    ];
}
// A synthetic game exercising every classification + mate folding + brilliant + accuracy.
$grInputs = [
    // case A: best move, great, excellent, good, inaccuracy, mistake, miss, blunder, brilliant, mate
    [
        'evaluations' => [
            ['eval_cp' => 20,  'eval_mate' => null, 'best_move_san' => 'e4'],   // start, best=e4
            ['eval_cp' => 20,  'eval_mate' => null, 'best_move_san' => 'e5'],   // w played e4 (best, cpLoss0->best/great)
            ['eval_cp' => 25,  'eval_mate' => null, 'best_move_san' => 'Nf3'],  // b played e5
            ['eval_cp' => 10,  'eval_mate' => null, 'best_move_san' => 'Nc6'],  // w cpLoss 15 -> excellent
            ['eval_cp' => 40,  'eval_mate' => null, 'best_move_san' => 'Bb5'],  // b cpLoss 30 -> good
            ['eval_cp' => -20, 'eval_mate' => null, 'best_move_san' => 'a6'],   // w cpLoss 60 -> inaccuracy
            ['eval_cp' => 100, 'eval_mate' => null, 'best_move_san' => 'Ba4'],  // b cpLoss 120 -> mistake
            ['eval_cp' => -100,'eval_mate' => null, 'best_move_san' => 'O-O'],  // w cpLoss 200 -> miss
            ['eval_cp' => 250, 'eval_mate' => null, 'best_move_san' => 'd4'],   // b cpLoss 350 -> blunder
            ['eval_cp' => 500, 'eval_mate' => null, 'best_move_san' => 'Qxf7'], // w capture +250 improvement -> brilliant
            ['eval_cp' => 0,   'eval_mate' => 3,    'best_move_san' => 'Rd8'],  // b, mate for white folded
        ],
        'moves' => [
            null,
            ['san' => 'e4', 'color' => 'w'],
            ['san' => 'e5', 'color' => 'b'],
            ['san' => 'Nf3','color' => 'w'],
            ['san' => 'Nc6','color' => 'b'],
            ['san' => 'Bb5','color' => 'w'],
            ['san' => 'a6', 'color' => 'b'],
            ['san' => 'O-O','color' => 'w'],
            ['san' => 'Qd8','color' => 'b'],
            ['san' => 'Qxf7','color'=> 'w'],
            ['san' => 'Rd8','color' => 'b'],
        ],
    ],
    // case B: black-mate folding + missing move (continue) + all-black
    [
        'evaluations' => [
            ['eval_cp' => 0,   'eval_mate' => null, 'best_move_san' => null],
            ['eval_cp' => -50, 'eval_mate' => null, 'best_move_san' => 'Nf6'],  // move index1 has null color -> skipped
            ['eval_cp' => 0,   'eval_mate' => -1,   'best_move_san' => 'Qh4'],  // b mate folded to -9990
        ],
        'moves' => [
            null,
            ['san' => null, 'color' => null],   // skipped (continue)
            ['san' => 'Qh4','color' => 'b'],
        ],
    ],
    // case C: san "0" must be treated as FALSY (skipped, graphed but not classified);
    // a normal move afterwards is classified.
    [
        'evaluations' => [
            ['eval_cp' => 0,   'eval_mate' => null, 'best_move_san' => '0'],
            ['eval_cp' => -300,'eval_mate' => null, 'best_move_san' => 'Nf3'],  // w plays "0" -> skipped
            ['eval_cp' => -280,'eval_mate' => null, 'best_move_san' => 'Nc6'],  // b plays normal
        ],
        'moves' => [
            null,
            ['san' => '0',  'color' => 'w'],   // PHP: !"0" is TRUE -> continue (not classified)
            ['san' => 'Bb5','color' => 'b'],
        ],
    ],
];
$grCases = [];
foreach ($grInputs as $in) {
    $grCases[] = ['evaluations' => $in['evaluations'], 'moves' => $in['moves'], 'result' => review($in['evaluations'], $in['moves'])];
}
dumpGolden('game_review', $grCases);

// Classification ladder — every threshold boundary × isBestMove × isBrilliant (kills boundary mutants).
$classifyCases = [];
foreach ([-5, 0, 1, 5, 6, 14, 15, 16, 29, 30, 31, 59, 60, 61, 119, 120, 121, 199, 200, 201, 500, 5000] as $cp) {
    foreach ([false, true] as $best) {
        foreach ([false, true] as $bril) {
            $classifyCases[] = ['cpLoss' => $cp, 'isBestMove' => $best, 'isBrilliant' => $bril, 'expected' => classifyMove($cp, $best, $bril)];
        }
    }
}
dumpGolden('classify', $classifyCases);

// Rating tier (ShareController::rating / OgImageController — identical thresholds).
function ratingTier(int $r): string {
    return match (true) {
        $r >= 2000 => 'Expert',
        $r >= 1600 => 'Advanced',
        $r >= 1200 => 'Intermediate',
        $r >= 800  => 'Beginner',
        default    => 'Novice',
    };
}
$tierCases = [];
foreach ([-10, 0, 400, 799, 800, 801, 1199, 1200, 1599, 1600, 1999, 2000, 2001, 3000] as $r) {
    $tierCases[] = ['rating' => $r, 'tier' => ratingTier($r)];
}
dumpGolden('rating_tier', $tierCases);

// Puzzle rush best-score upsert + mode labels (PuzzleRushController / ShareController::rush).
function rushBest(int $sub, ?int $stored): int { return $sub > ($stored ?? 0) ? $sub : ($stored ?? 0); }
function rushLabel(int $mode): string { $m = ['0' => 'Infinite', '3' => '3-minute', '5' => '5-minute']; return $m[(string) $mode] ?? ($mode . '-minute'); }
$rushBestCases = [];
foreach ([[0, null], [5, null], [10, 5], [3, 10], [0, 0], [7, 7], [100, 99]] as [$s, $st]) $rushBestCases[] = ['submitted' => $s, 'stored' => $st, 'best' => rushBest($s, $st)];
$rushLabelCases = [];
foreach ([0, 3, 5, 10, 1] as $m) $rushLabelCases[] = ['mode' => $m, 'label' => rushLabel($m)];
dumpGolden('rush', ['best' => $rushBestCases, 'labels' => $rushLabelCases]);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tournaments (TournamentController private methods, re-ported over arrays)
// ─────────────────────────────────────────────────────────────────────────────

// Stable sort mirroring Laravel Collection (stable, numeric via <=>).
function stableSort(array $arr, callable $cmp): array {
    $indexed = [];
    foreach ($arr as $i => $v) $indexed[] = [$i, $v];
    usort($indexed, function ($a, $b) use ($cmp) {
        $r = $cmp($a[1], $b[1]);
        return $r !== 0 ? $r : ($a[0] <=> $b[0]);
    });
    return array_map(fn($p) => $p[1], $indexed);
}

function pairingHistory(array $rounds): array {
    $h = [];
    foreach ($rounds as $round) {
        foreach ($round['pairings'] as $p) {
            if ($p['isBye']) continue;
            if (!isset($p['white']) || !isset($p['black']) || $p['white'] === null || $p['black'] === null) continue;
            $h[min($p['white'], $p['black']) . '-' . max($p['white'], $p['black'])] = true;
        }
    }
    return $h;
}

function generateSwiss(array $ps, array $rounds, int $roundNumber): array {
    $players = stableSort($ps, fn($a, $b) => $b['score'] <=> $a['score']);
    $pairings = []; $paired = [];
    $history = pairingHistory($rounds);
    $byeHistory = array_map(fn($p) => $p['id'], array_filter($ps, fn($p) => $p['byes'] > 0));

    if ($roundNumber === 1) {
        $hasRatings = count(array_filter($players, fn($p) => $p['ncfp_rating'] !== null)) > 0;
        if ($hasRatings) {
            // Laravel sortByDesc('ncfp_rating') under SORT_REGULAR: null ≡ 0 (both coerce to 0),
            // stable within the null/0 equivalence group.
            $sorted = stableSort($players, fn($a, $b) => ($b['ncfp_rating'] ?? 0) <=> ($a['ncfp_rating'] ?? 0));
            $half = intdiv(count($sorted), 2);
            for ($i = 0; $i < $half; $i++) {
                $top = $sorted[$i]; $bottom = $sorted[$half + $i];
                $pairings[] = $i % 2 === 0
                    ? ['white' => $top['id'], 'black' => $bottom['id'], 'isBye' => false]
                    : ['white' => $bottom['id'], 'black' => $top['id'], 'isBye' => false];
                $paired[] = $top['id']; $paired[] = $bottom['id'];
            }
            if (count($sorted) % 2 === 1) {
                $bye = $sorted[count($sorted) - 1];
                $pairings[] = ['white' => $bye['id'], 'black' => null, 'isBye' => true];
                $paired[] = $bye['id'];
            }
            return $pairings;
        } else {
            $sorted = stableSort($players, fn($a, $b) => $a['name'] <=> $b['name']);
            $count = count($sorted); $half = intdiv($count, 2);
            for ($i = 0; $i < $half; $i++) {
                $top = $sorted[$i]; $bottom = $sorted[$count - 1 - $i];
                $pairings[] = $i % 2 === 0
                    ? ['white' => $top['id'], 'black' => $bottom['id'], 'isBye' => false]
                    : ['white' => $bottom['id'], 'black' => $top['id'], 'isBye' => false];
                $paired[] = $top['id']; $paired[] = $bottom['id'];
            }
            if ($count % 2 === 1) {
                $bye = $sorted[$half];
                $pairings[] = ['white' => $bye['id'], 'black' => null, 'isBye' => true];
                $paired[] = $bye['id'];
            }
            return $pairings;
        }
    } else {
        // group by score numeric desc, stable within group
        $groups = [];
        foreach ($players as $p) {
            $n = count($groups);
            if ($n > 0 && $groups[$n - 1][0]['score'] === $p['score']) $groups[$n - 1][] = $p;
            else $groups[] = [$p];
        }
        $ordered = [];
        foreach ($groups as $group) {
            $sortedGroup = stableSort($group, function ($a, $b) {
                if ($b['buchholz'] !== $a['buchholz']) return $b['buchholz'] - $a['buchholz'];
                return ($b['ncfp_rating'] ?? 0) - ($a['ncfp_rating'] ?? 0);
            });
            foreach ($sortedGroup as $p) $ordered[] = $p;
        }
        if (count($ordered) % 2 === 1) {
            $byePlayer = null;
            for ($i = count($ordered) - 1; $i >= 0; $i--) {
                if (!in_array($ordered[$i]['id'], $byeHistory, true)) {
                    $byePlayer = $ordered[$i]; array_splice($ordered, $i, 1); break;
                }
            }
            if (!$byePlayer) $byePlayer = array_pop($ordered);
            $pairings[] = ['white' => $byePlayer['id'], 'black' => null, 'isBye' => true];
            $paired[] = $byePlayer['id'];
        }
        $remaining = array_values(array_filter($ordered, fn($p) => !in_array($p['id'], $paired, true)));
        $pairings = array_merge($pairings, pairByScoreGroup($remaining, $history, $paired));
    }

    $lookup = [];
    foreach ($ps as $p) $lookup[$p['id']] = $p;
    return balanceColors($pairings, $lookup);
}

function pairByScoreGroup(array $players, array $history, array &$paired): array {
    $pairings = []; $unpaired = $players;
    while (count($unpaired) >= 2) {
        $p1 = array_shift($unpaired);
        if (in_array($p1['id'], $paired, true)) continue;
        $bestMatch = null; $bestIndex = null;
        foreach ($unpaired as $idx => $p2) {
            if (in_array($p2['id'], $paired, true)) continue;
            $key = min($p1['id'], $p2['id']) . '-' . max($p1['id'], $p2['id']);
            if (!isset($history[$key])) { $bestMatch = $p2; $bestIndex = $idx; break; }
        }
        if (!$bestMatch && count($unpaired) > 0) { $bestIndex = 0; $bestMatch = $unpaired[0]; }
        if ($bestMatch) {
            array_splice($unpaired, $bestIndex, 1);
            $pairings[] = ['white' => $p1['id'], 'black' => $bestMatch['id'], 'isBye' => false];
            $paired[] = $p1['id']; $paired[] = $bestMatch['id'];
        }
    }
    return $pairings;
}

function balanceColors(array $pairings, array $players): array {
    foreach ($pairings as &$pair) {
        if ($pair['isBye']) continue;
        if (!$pair['white'] || !$pair['black']) continue;
        $w = $players[$pair['white']] ?? ['white_games' => 0, 'black_games' => 0];
        $b = $players[$pair['black']] ?? ['white_games' => 0, 'black_games' => 0];
        $wBalance = $w['white_games'] - $w['black_games'];
        $bBalance = $b['white_games'] - $b['black_games'];
        if ($wBalance > $bBalance) { $t = $pair['white']; $pair['white'] = $pair['black']; $pair['black'] = $t; }
    }
    return $pairings;
}

function generateRoundRobin(array $ps, int $roundNumber): array {
    $players = stableSort($ps, fn($a, $b) => $a['seed'] <=> $b['seed']);
    $n = count($players);
    $ids = array_map(fn($p) => $p['id'], $players);
    if ($n % 2 === 1) { $ids[] = null; $n++; }
    $fixed = $ids[0];
    $rotating = array_slice($ids, 1);
    for ($r = 0; $r < $roundNumber - 1; $r++) { $last = array_pop($rotating); array_unshift($rotating, $last); }
    $roundIds = array_merge([$fixed], $rotating);
    $pairings = []; $half = $n / 2;
    for ($i = 0; $i < $half; $i++) {
        $home = $roundIds[$i]; $away = $roundIds[$n - 1 - $i];
        if ($home === null) $pairings[] = ['white' => $away, 'black' => null, 'isBye' => true];
        elseif ($away === null) $pairings[] = ['white' => $home, 'black' => null, 'isBye' => true];
        elseif ($roundNumber % 2 === 0 && $i === 0) $pairings[] = ['white' => $away, 'black' => $home, 'isBye' => false];
        else $pairings[] = ['white' => $home, 'black' => $away, 'isBye' => false];
    }
    return $pairings;
}

// scoring helpers operate on $players indexed by id (assoc)
function applyResult(array &$players, ?int $w, ?int $b, string $result): void {
    if ($w === null || $b === null) return;
    $players[$w]['white_games']++; $players[$b]['black_games']++;
    if ($result === '1-0') { $players[$w]['score'] += 1; $players[$w]['wins']++; $players[$b]['losses']++; }
    elseif ($result === '0-1') { $players[$b]['score'] += 1; $players[$b]['wins']++; $players[$w]['losses']++; }
    elseif ($result === '1/2-1/2') { $players[$w]['score'] += 0.5; $players[$w]['draws']++; $players[$b]['score'] += 0.5; $players[$b]['draws']++; }
}
function awardBye(array &$players, ?int $id): void {
    if ($id === null) return;
    $players[$id]['score'] += 1; $players[$id]['byes']++;
}

function recalcTiebreakers(array $players, array $pairings): array {
    $scores = [];
    foreach ($players as $p) $scores[$p['id']] = (float) $p['score'];
    $out = [];
    foreach ($players as $player) {
        $opponentIds = []; $directEncounter = 0.0;
        foreach ($pairings as $pairing) {
            if ($pairing['isBye']) continue;
            $isWhite = $pairing['white'] === $player['id'];
            $isBlack = $pairing['black'] === $player['id'];
            if (!$isWhite && !$isBlack) continue;
            $oppId = $isWhite ? $pairing['black'] : $pairing['white'];
            if (!$oppId) continue;
            $opponentIds[] = $oppId;
            $oppScore = $scores[$oppId] ?? 0;
            if (abs($oppScore - $scores[$player['id']]) < 0.01) {
                if (($isWhite && $pairing['result'] === '1-0') || ($isBlack && $pairing['result'] === '0-1')) $directEncounter += 1.0;
                elseif ($pairing['result'] === '1/2-1/2') $directEncounter += 0.5;
            }
        }
        $buchholz = 0; $sb = 0;
        foreach ($opponentIds as $oppId) {
            $oppScore = $scores[$oppId] ?? 0;
            $buchholz += $oppScore;
            foreach ($pairings as $pairing) {
                if ($pairing['isBye']) continue;
                $isWhite = $pairing['white'] === $player['id'] && $pairing['black'] === $oppId;
                $isBlack = $pairing['black'] === $player['id'] && $pairing['white'] === $oppId;
                if ($isWhite || $isBlack) {
                    if (($isWhite && $pairing['result'] === '1-0') || ($isBlack && $pairing['result'] === '0-1')) $sb += $oppScore;
                    elseif ($pairing['result'] === '1/2-1/2') $sb += $oppScore * 0.5;
                }
            }
        }
        $p2 = $player;
        $p2['direct_encounter'] = round($directEncounter, 1);
        $p2['buchholz'] = (int) round($buchholz);
        $p2['sonneborn_berger'] = (int) round($sb);
        $out[] = $p2;
    }
    return $out;
}

function standings(array $players): array {
    return stableSort($players, function ($a, $b) {
        if ($a['score'] != $b['score']) return $b['score'] <=> $a['score'];
        if ($a['direct_encounter'] != $b['direct_encounter']) return $b['direct_encounter'] <=> $a['direct_encounter'];
        if ($a['buchholz'] != $b['buchholz']) return $b['buchholz'] <=> $a['buchholz'];
        if ($a['sonneborn_berger'] != $b['sonneborn_berger']) return $b['sonneborn_berger'] <=> $a['sonneborn_berger'];
        if ($a['wins'] != $b['wins']) return $b['wins'] <=> $a['wins'];
        return $a['id'] <=> $b['id'];
    });
}

// Player factory
function P(int $id, string $name, ?int $rating = null, int $seed = 0, float $score = 0.0,
          int $buchholz = 0, int $byes = 0, int $wg = 0, int $bg = 0): array {
    return ['id' => $id, 'name' => $name, 'ncfp_rating' => $rating, 'seed' => $seed,
            'score' => $score, 'direct_encounter' => 0.0, 'buchholz' => $buchholz,
            'sonneborn_berger' => 0, 'wins' => 0, 'draws' => 0, 'losses' => 0,
            'byes' => $byes, 'white_games' => $wg, 'black_games' => $bg];
}

// ── Swiss pairing unit cases ──
$swissCases = [];
// R1 with ratings, even
$swissCases[] = ['label' => 'r1_rated_even',
    'players' => [P(1,'A',1500), P(2,'B',1400), P(3,'C',1600), P(4,'D',1300)],
    'rounds' => [], 'roundNumber' => 1];
// R1 with ratings, odd (bye to lowest rated)
$swissCases[] = ['label' => 'r1_rated_odd',
    'players' => [P(1,'A',1500), P(2,'B',1400), P(3,'C',1600), P(4,'D',1300), P(5,'E',1200)],
    'rounds' => [], 'roundNumber' => 1];
// R1 no ratings (alphabetical fold), odd (middle bye)
$swissCases[] = ['label' => 'r1_unrated_odd',
    'players' => [P(3,'Charlie'), P(1,'Alice'), P(5,'Echo'), P(2,'Bravo'), P(4,'Delta')],
    'rounds' => [], 'roundNumber' => 1];
// R2 score groups + color balance + rematch avoidance
$swissCases[] = ['label' => 'r2_scoregroups',
    'players' => [
        P(1,'A',1500,0, 1.0, 1, 0, 1, 0),
        P(2,'B',1400,0, 1.0, 1, 0, 0, 1),
        P(3,'C',1600,0, 0.0, 1, 0, 1, 0),
        P(4,'D',1300,0, 0.0, 1, 0, 0, 1),
    ],
    'rounds' => [['pairings' => [
        ['white'=>1,'black'=>2,'isBye'=>false,'result'=>'1-0'],
        ['white'=>3,'black'=>4,'isBye'=>false,'result'=>'0-1'],
    ]]],
    'roundNumber' => 2];
// R2 odd with existing byeHistory (player 5 already had a bye)
$swissCases[] = ['label' => 'r2_odd_byehistory',
    'players' => [
        P(1,'A',1500,0, 1.0, 0, 0, 1, 0),
        P(2,'B',1400,0, 1.0, 0, 0, 0, 1),
        P(3,'C',1600,0, 0.0, 0, 0, 1, 0),
        P(4,'D',1300,0, 0.0, 0, 0, 0, 1),
        P(5,'E',1200,0, 1.0, 0, 1, 0, 0),   // already had a bye
    ],
    'rounds' => [['pairings' => [
        ['white'=>1,'black'=>2,'isBye'=>false,'result'=>'1-0'],
        ['white'=>3,'black'=>4,'isBye'=>false,'result'=>'0-1'],
        ['white'=>5,'black'=>null,'isBye'=>true,'result'=>'bye'],
    ]]],
    'roundNumber' => 2];
// R1 rated where null-rated and 0-rated coexist (null ≡ 0, stable). Catches the null-vs-0 sort.
$swissCases[] = ['label' => 'r1_rated_null_zero',
    'players' => [P(1, 'A', null), P(2, 'B', 0), P(3, 'C', 1500), P(4, 'D', 1200)],
    'rounds' => [], 'roundNumber' => 1];
// R1 unrated with purely-numeric names (SORT_REGULAR numeric compare "9" < "10").
$swissCases[] = ['label' => 'r1_unrated_numeric_names',
    'players' => [P(1, '3'), P(2, '20'), P(3, '100'), P(4, '5')],
    'rounds' => [], 'roundNumber' => 1];
// R1 unrated with accented / non-ASCII names (byte-wise strcmp, not Unicode-canonical).
$swissCases[] = ['label' => 'r1_unrated_accented',
    'players' => [P(1, 'Zoë'), P(2, 'Ábel'), P(3, 'niño'), P(4, 'Ana')],
    'rounds' => [], 'roundNumber' => 1];
foreach ($swissCases as &$c) {
    $c['expected'] = generateSwiss($c['players'], $c['rounds'], $c['roundNumber']);
}
unset($c);
dumpGolden('swiss_pairings', $swissCases);

// ── Round-robin pairing unit cases ──
$rrCases = [];
$rr4 = [P(1,'A',null,1), P(2,'B',null,2), P(3,'C',null,3), P(4,'D',null,4)];
foreach ([1, 2, 3] as $r) $rrCases[] = ['label' => "rr4_r$r", 'players' => $rr4, 'roundNumber' => $r, 'expected' => generateRoundRobin($rr4, $r)];
$rr5 = [P(1,'A',null,1), P(2,'B',null,2), P(3,'C',null,3), P(4,'D',null,4), P(5,'E',null,5)];
foreach ([1, 2, 3, 4, 5] as $r) $rrCases[] = ['label' => "rr5_r$r", 'players' => $rr5, 'roundNumber' => $r, 'expected' => generateRoundRobin($rr5, $r)];
dumpGolden('rr_pairings', $rrCases);

// ── Tiebreakers on a finished 4-player round-robin ──
$tbPlayers = [
    P(1,'A',null,1, 2.5), P(2,'B',null,2, 2.0), P(3,'C',null,3, 1.0), P(4,'D',null,4, 0.5),
];
$tbPairings = [
    // R1
    ['white'=>1,'black'=>4,'isBye'=>false,'result'=>'1-0'],
    ['white'=>2,'black'=>3,'isBye'=>false,'result'=>'1-0'],
    // R2
    ['white'=>1,'black'=>3,'isBye'=>false,'result'=>'1/2-1/2'],
    ['white'=>4,'black'=>2,'isBye'=>false,'result'=>'0-1'],
    // R3
    ['white'=>1,'black'=>2,'isBye'=>false,'result'=>'1-0'],
    ['white'=>3,'black'=>4,'isBye'=>false,'result'=>'1/2-1/2'],
];
$tbOut = recalcTiebreakers($tbPlayers, $tbPairings);
dumpGolden('tiebreakers', [[
    'label' => 'rr4_finished', 'players' => $tbPlayers, 'pairings' => $tbPairings,
    'expected' => array_map(fn($p) => ['id'=>$p['id'],'direct_encounter'=>$p['direct_encounter'],'buchholz'=>$p['buchholz'],'sonneborn_berger'=>$p['sonneborn_berger']], $tbOut),
]]);

// ── Standings ordering (tie-break cascade) ──
$stPlayers = [
    P(1,'A',null,1, 2.0), P(2,'B',null,2, 2.0), P(3,'C',null,3, 2.0), P(4,'D',null,4, 1.0),
];
// craft tie-break fields
$stPlayers[0]['direct_encounter'] = 1.0; $stPlayers[0]['buchholz'] = 4; $stPlayers[0]['wins'] = 2;
$stPlayers[1]['direct_encounter'] = 1.0; $stPlayers[1]['buchholz'] = 5; $stPlayers[1]['wins'] = 2; // higher buchholz -> above A
$stPlayers[2]['direct_encounter'] = 0.0; $stPlayers[2]['buchholz'] = 9; $stPlayers[2]['wins'] = 2; // lower DE -> below A,B
$stOrder = array_map(fn($p) => $p['id'], standings($stPlayers));
dumpGolden('standings', [['label' => 'cascade', 'players' => $stPlayers, 'expectedOrder' => $stOrder]]);

// ── applyResult / reverseResult (incl. result EDIT via reverse-then-apply) ──
function applyResultPair(array $w, array $b, string $result): array {
    $w['white_games']++; $b['black_games']++;
    if ($result === '1-0') { $w['score'] += 1; $w['wins']++; $b['losses']++; }
    elseif ($result === '0-1') { $b['score'] += 1; $b['wins']++; $w['losses']++; }
    elseif ($result === '1/2-1/2') { $w['score'] += 0.5; $w['draws']++; $b['score'] += 0.5; $b['draws']++; }
    return [$w, $b];
}
function reverseResultPair(array $w, array $b, string $result): array {
    $w['white_games']--; $b['black_games']--;
    if ($result === '1-0') { $w['score'] -= 1; $w['wins']--; $b['losses']--; }
    elseif ($result === '0-1') { $b['score'] -= 1; $b['wins']--; $w['losses']--; }
    elseif ($result === '1/2-1/2') { $w['score'] -= 0.5; $w['draws']--; $b['score'] -= 0.5; $b['draws']--; }
    return [$w, $b];
}
$scoringCases = [];
$scoringOps = [
    [['op' => 'apply', 'result' => '1-0']],
    [['op' => 'apply', 'result' => '0-1']],
    [['op' => 'apply', 'result' => '1/2-1/2']],
    [['op' => 'apply', 'result' => '1-0'], ['op' => 'reverse', 'result' => '1-0']],                                    // identity
    [['op' => 'apply', 'result' => '1-0'], ['op' => 'reverse', 'result' => '1-0'], ['op' => 'apply', 'result' => '0-1']], // edit 1-0 -> 0-1
    [['op' => 'apply', 'result' => '1/2-1/2'], ['op' => 'reverse', 'result' => '1/2-1/2'], ['op' => 'apply', 'result' => '1-0']],
];
foreach ($scoringOps as $ops) {
    $w = P(1, 'W'); $b = P(2, 'B');
    foreach ($ops as $o) { [$w, $b] = $o['op'] === 'apply' ? applyResultPair($w, $b, $o['result']) : reverseResultPair($w, $b, $o['result']); }
    $scoringCases[] = ['white_in' => P(1, 'W'), 'black_in' => P(2, 'B'), 'ops' => $ops, 'white_out' => $w, 'black_out' => $b];
}
dumpGolden('scoring', $scoringCases);

// ── End-to-end orchestrated scenarios ──
// Orchestrators mirror generatePairings + submitResult exactly.
function runSwissScenario(array $playersList, int $totalRounds, array $results): array {
    $players = []; foreach ($playersList as $p) $players[$p['id']] = $p; // indexed by id
    $priorRounds = []; $roundsOut = [];
    for ($r = 1; $r <= $totalRounds; $r++) {
        $current = array_values($players); // insertion (id) order preserved
        $pairs = generateSwiss($current, $priorRounds, $r);
        $roundsOut[] = ['round' => $r, 'pairings' => $pairs];
        // score byes for this round
        foreach ($pairs as $pair) if ($pair['isBye']) awardBye($players, $pair['white'] ?? $pair['black']);
        // submit results in board order
        $board = 1;
        foreach ($pairs as $pair) {
            if (!($pair['isBye'])) {
                $res = $results[$r][$board] ?? '1-0';
                applyResult($players, $pair['white'], $pair['black'], $res);
            }
            $board++;
        }
        // record persisted round (with results) for history + recalc
        $persist = [];
        $board = 1;
        foreach ($pairs as $pair) {
            $persist[] = ['white' => $pair['white'], 'black' => $pair['black'], 'isBye' => $pair['isBye'],
                          'result' => $pair['isBye'] ? 'bye' : ($results[$r][$board] ?? '1-0')];
            $board++;
        }
        $priorRounds[] = ['pairings' => $persist];
        // recalc across all rounds so far
        $allPairings = [];
        foreach ($priorRounds as $rd) foreach ($rd['pairings'] as $pp) $allPairings[] = $pp;
        $recalced = recalcTiebreakers(array_values($players), $allPairings);
        foreach ($recalced as $rp) $players[$rp['id']] = $rp;
    }
    $final = standings(array_values($players));
    return ['rounds_out' => $roundsOut, 'final_players' => $final];
}

function runRoundRobinScenario(array $playersList, int $totalRounds, array $results): array {
    $players = []; foreach ($playersList as $p) $players[$p['id']] = $p;
    // generate ALL rounds up front (RR pairings depend only on seed)
    $allRounds = [];
    for ($r = 1; $r <= $totalRounds; $r++) $allRounds[$r] = generateRoundRobin(array_values($players), $r);
    $roundsOut = []; foreach ($allRounds as $r => $pairs) $roundsOut[] = ['round' => $r, 'pairings' => $pairs];
    // persisted pairings (all rounds, with results filled as they are played)
    $persistAll = [];
    foreach ($allRounds as $r => $pairs) {
        $board = 1;
        foreach ($pairs as $pair) {
            $persistAll[] = ['round' => $r, 'board' => $board, 'white' => $pair['white'], 'black' => $pair['black'],
                             'isBye' => $pair['isBye'], 'result' => $pair['isBye'] ? 'bye' : 'pending'];
            $board++;
        }
    }
    // score bye for round 1
    foreach ($allRounds[1] as $pair) if ($pair['isBye']) awardBye($players, $pair['white'] ?? $pair['black']);
    for ($r = 1; $r <= $totalRounds; $r++) {
        // submit results for round r
        $board = 1;
        foreach ($allRounds[$r] as $pair) {
            if (!$pair['isBye']) {
                $res = $results[$r][$board] ?? '1-0';
                applyResult($players, $pair['white'], $pair['black'], $res);
                foreach ($persistAll as &$pp) { if ($pp['round'] === $r && $pp['board'] === $board) $pp['result'] = $res; }
                unset($pp);
            }
            $board++;
        }
        // round complete: recalc across ALL pairings (incl future pending)
        $allForRecalc = array_map(fn($pp) => ['white'=>$pp['white'],'black'=>$pp['black'],'isBye'=>$pp['isBye'],'result'=>$pp['result']], $persistAll);
        $recalced = recalcTiebreakers(array_values($players), $allForRecalc);
        foreach ($recalced as $rp) $players[$rp['id']] = $rp;
        // advance: score next round's bye
        if ($r < $totalRounds) foreach ($allRounds[$r + 1] as $pair) if ($pair['isBye']) awardBye($players, $pair['white'] ?? $pair['black']);
    }
    $final = standings(array_values($players));
    return ['rounds_out' => $roundsOut, 'final_players' => $final];
}

// Swiss scenario: 6 rated players, 3 rounds, deterministic mixed results.
$swissPlayers = [P(1,'A',1600,1), P(2,'B',1550,2), P(3,'C',1500,3), P(4,'D',1450,4), P(5,'E',1400,5), P(6,'F',1350,6)];
$swissResults = [
    1 => [1 => '1-0', 2 => '1/2-1/2', 3 => '0-1'],
    2 => [1 => '1-0', 2 => '1-0', 3 => '1/2-1/2'],
    3 => [1 => '1/2-1/2', 2 => '1-0', 3 => '1-0'],
];
$swissScenario = runSwissScenario($swissPlayers, 3, $swissResults);
dumpGolden('swiss_scenario', ['players' => $swissPlayers, 'total_rounds' => 3, 'results' => $swissResults] + $swissScenario);

// RR scenario: 5 players (odd -> byes), full round robin, mixed results.
$rrPlayers = [P(1,'A',null,1), P(2,'B',null,2), P(3,'C',null,3), P(4,'D',null,4), P(5,'E',null,5)];
$rrResults = [
    1 => [1 => '1-0', 2 => '1/2-1/2'],
    2 => [1 => '0-1', 2 => '1-0'],
    3 => [1 => '1-0', 2 => '1/2-1/2'],
    4 => [1 => '1/2-1/2', 2 => '0-1'],
    5 => [1 => '1-0', 2 => '1-0'],
];
$rrScenario = runRoundRobinScenario($rrPlayers, 5, $rrResults);
dumpGolden('rr_scenario', ['players' => $rrPlayers, 'total_rounds' => 5, 'results' => $rrResults] + $rrScenario);

// ── Puzzle serving ladders (deterministic model with lowest-id pick) ──
function C(int $id, int $rating, array $themes = []): array { return ['id' => $id, 'rating' => $rating, 'themes' => $themes]; }
function svWindow($pool, $center, $window, $theme, $seen) {
    $lo = $center - $window; $hi = $center + $window;
    return array_values(array_filter($pool, fn($c) => $c['rating'] >= $lo && $c['rating'] <= $hi
        && ($theme === null || in_array($theme, $c['themes'], true)) && !in_array($c['id'], $seen, true)));
}
function svUnseen($pool, $theme, $seen) {
    return array_values(array_filter($pool, fn($c) => ($theme === null || in_array($theme, $c['themes'], true)) && !in_array($c['id'], $seen, true)));
}
function svClosest($pool, $center, $theme) {
    $f = array_values(array_filter($pool, fn($c) => $theme === null || in_array($theme, $c['themes'], true)));
    if (!$f) return null;
    usort($f, function ($a, $b) use ($center) { $da = abs($a['rating'] - $center); $db = abs($b['rating'] - $center); return $da !== $db ? $da <=> $db : $a['id'] <=> $b['id']; });
    return $f[0];
}
function svLowest($set) { if (!$set) return null; usort($set, fn($a, $b) => $a['id'] <=> $b['id']); return $set[0]; }
function serveClosestL($pool, $center, $window, $theme, $seen) {
    if ($h = svLowest(svWindow($pool, $center, $window, $theme, $seen))) return ['candidate' => $h['id'], 'stage' => 'windowUnseen', 'didReset' => false];
    $s2 = svUnseen($pool, $theme, $seen); $c = svClosest($s2, $center, $theme);
    if ($s2 && $c) return ['candidate' => $c['id'], 'stage' => 'anyUnseenClosest', 'didReset' => false];
    if ($c3 = svClosest($pool, $center, $theme)) return ['candidate' => $c3['id'], 'stage' => 'afterResetClosest', 'didReset' => true];
    return ['candidate' => null, 'stage' => 'none', 'didReset' => true];
}
function serveRandomL($pool, $center, $window, $theme, $seen) {
    if ($h = svLowest(svWindow($pool, $center, $window, $theme, $seen))) return ['candidate' => $h['id'], 'stage' => 'windowUnseen', 'didReset' => false];
    if ($h2 = svLowest(svUnseen($pool, $theme, $seen))) return ['candidate' => $h2['id'], 'stage' => 'anyUnseenRandom', 'didReset' => false];
    if ($h3 = svLowest(svWindow($pool, $center, $window, $theme, []))) return ['candidate' => $h3['id'], 'stage' => 'afterResetRandom', 'didReset' => true];
    if ($h4 = svLowest(svUnseen($pool, $theme, []))) return ['candidate' => $h4['id'], 'stage' => 'afterResetRandom', 'didReset' => true];
    return ['candidate' => null, 'stage' => 'none', 'didReset' => true];
}
function serveThematicL($pool, $center, $window, $theme, $seen) {
    if ($h = svLowest(svWindow($pool, $center, $window, $theme, $seen))) return ['candidate' => $h['id'], 'stage' => 'windowUnseen', 'didReset' => false];
    if ($h2 = svLowest(svUnseen($pool, $theme, $seen))) return ['candidate' => $h2['id'], 'stage' => 'anyUnseenRandom', 'didReset' => false];
    if ($c3 = svClosest($pool, $center, $theme)) return ['candidate' => $c3['id'], 'stage' => 'afterResetClosest', 'didReset' => true];
    return ['candidate' => null, 'stage' => 'none', 'didReset' => true];
}
$poolT = [C(1, 600, ['x']), C(2, 650, ['x']), C(3, 700, []), C(4, 900, ['y'])];
$servingCases = [
    ['label' => 'closest_s1', 'ladder' => 'closest', 'pool' => $poolT, 'center' => 600, 'window' => 50, 'theme' => null, 'seen' => []],
    ['label' => 'closest_s2', 'ladder' => 'closest', 'pool' => $poolT, 'center' => 600, 'window' => 50, 'theme' => null, 'seen' => [1, 2]],
    ['label' => 'closest_s3', 'ladder' => 'closest', 'pool' => $poolT, 'center' => 600, 'window' => 50, 'theme' => null, 'seen' => [1, 2, 3, 4]],
    ['label' => 'closest_none', 'ladder' => 'closest', 'pool' => [], 'center' => 600, 'window' => 50, 'theme' => null, 'seen' => [9]],
    ['label' => 'closest_tie', 'ladder' => 'closest', 'pool' => [C(1, 650), C(2, 550)], 'center' => 600, 'window' => 100, 'theme' => null, 'seen' => [1, 2]],
    ['label' => 'closest_hi_boundary', 'ladder' => 'closest', 'pool' => [C(1, 650)], 'center' => 600, 'window' => 50, 'theme' => null, 'seen' => []],
    ['label' => 'closest_lo_boundary', 'ladder' => 'closest', 'pool' => [C(1, 650)], 'center' => 700, 'window' => 50, 'theme' => null, 'seen' => []],
    ['label' => 'random_s1', 'ladder' => 'random', 'pool' => $poolT, 'center' => 620, 'window' => 100, 'theme' => null, 'seen' => []],
    ['label' => 'random_s2', 'ladder' => 'random', 'pool' => $poolT, 'center' => 620, 'window' => 10, 'theme' => null, 'seen' => []],
    ['label' => 'random_s3', 'ladder' => 'random', 'pool' => $poolT, 'center' => 620, 'window' => 100, 'theme' => null, 'seen' => [1, 2, 3, 4]],
    ['label' => 'random_none', 'ladder' => 'random', 'pool' => [], 'center' => 620, 'window' => 100, 'theme' => null, 'seen' => []],
    ['label' => 'thematic_s1', 'ladder' => 'thematic', 'pool' => $poolT, 'center' => 600, 'window' => 200, 'theme' => 'x', 'seen' => []],
    ['label' => 'thematic_s2', 'ladder' => 'thematic', 'pool' => $poolT, 'center' => 300, 'window' => 5, 'theme' => 'x', 'seen' => []],
    ['label' => 'thematic_s3_closest', 'ladder' => 'thematic', 'pool' => $poolT, 'center' => 630, 'window' => 50, 'theme' => 'x', 'seen' => [1, 2]],
    ['label' => 'thematic_none', 'ladder' => 'thematic', 'pool' => $poolT, 'center' => 600, 'window' => 50, 'theme' => 'z', 'seen' => []],
];
foreach ($servingCases as &$sc) {
    $fn = ['closest' => 'serveClosestL', 'random' => 'serveRandomL', 'thematic' => 'serveThematicL'][$sc['ladder']];
    $sc['expected'] = $fn($sc['pool'], $sc['center'], $sc['window'], $sc['theme'], $sc['seen']);
}
unset($sc);
dumpGolden('serving', $servingCases);

// ─────────────────────────────────────────────────────────────────────────────
// 7. RANDOMIZED DIFFERENTIAL BATCHES (seeded for reproducibility)
//    Broadens coverage far beyond the curated cases; the Swift runner replays the
//    identical inputs and must match every output.
// ─────────────────────────────────────────────────────────────────────────────
mt_srand(1234567);
function rnd(int $lo, int $hi): int { return mt_rand($lo, $hi); }
function pickResult(): string { return ['1-0', '0-1', '1/2-1/2'][mt_rand(0, 2)]; }

// 7a. ELO — 3000 random cases across the full range
$eloRand = [];
for ($i = 0; $i < 3000; $i++) {
    $eloRand[] = elo(rnd(100, 3000), rnd(100, 3000), (bool) rnd(0, 1));
}
dumpGolden('rating_random', $eloRand);

// 7b. Daily goal — 500 random date sets
$dgRand = [];
$base = new DateTimeImmutable('2026-07-23', new DateTimeZone('UTC'));
for ($i = 0; $i < 500; $i++) {
    $today = $base->modify('-' . rnd(0, 5) . ' day');
    $k = rnd(0, 25);
    $dates = [];
    for ($j = 0; $j < $k; $j++) $dates[] = $today->modify('-' . rnd(0, 30) . ' day')->format('Y-m-d');
    $todayStr = $today->format('Y-m-d');
    $dgRand[] = ['solveDates' => $dates, 'today' => $todayStr, 'streakDays' => calcStreakDays($dates, $todayStr)];
}
dumpGolden('daily_goal_random', $dgRand);

// 7c. Game review — 300 random games
$sanSet = ['e4','Nf3','Bb5','O-O','Qxf7','Rxd8','Nxe5','d4','a6','Bxc6','Qh4','Kg1','c5','h6','Rd1'];
$grRand = [];
for ($g = 0; $g < 300; $g++) {
    $len = rnd(2, 14);
    $evals = []; $moves = [null];
    for ($i = 0; $i < $len; $i++) {
        $ev = ['best_move_san' => $sanSet[rnd(0, count($sanSet) - 1)]];
        if (rnd(0, 9) === 0) { $ev['eval_mate'] = rnd(0, 1) ? rnd(1, 6) : -rnd(1, 6); $ev['eval_cp'] = 0; }
        else { $ev['eval_cp'] = rnd(-1800, 1800); $ev['eval_mate'] = null; }
        $evals[] = $ev;
        if ($i >= 1) {
            if (rnd(0, 12) === 0) { $moves[] = ['san' => null, 'color' => null]; }
            else {
                $san = $sanSet[rnd(0, count($sanSet) - 1)];
                // sometimes play the engine's suggested best move to exercise best/great
                if (rnd(0, 3) === 0) $san = $evals[$i - 1]['best_move_san'];
                $moves[] = ['san' => $san, 'color' => $i % 2 === 1 ? 'w' : 'b'];
            }
        }
    }
    $grRand[] = ['evaluations' => $evals, 'moves' => $moves, 'result' => review($evals, $moves)];
}
dumpGolden('game_review_random', $grRand);

// 7d. Swiss scenarios — 150 random tournaments
$swissRand = [];
for ($s = 0; $s < 150; $s++) {
    $n = rnd(2, 10);
    $mode = rnd(0, 2); // 0 all-null, 1 all-rated, 2 mixed
    $players = [];
    for ($i = 1; $i <= $n; $i++) {
        $rating = match ($mode) { 0 => null, 1 => rnd(800, 2200), default => (rnd(0, 1) ? rnd(800, 2200) : null) };
        $players[] = P($i, sprintf('P%02d', $i), $rating, $i);
    }
    $totalRounds = min($n <= 2 ? 1 : rnd(2, 3), max(1, $n - 1));
    $maxBoards = intdiv($n + 1, 2);
    $results = [];
    for ($r = 1; $r <= $totalRounds; $r++) for ($b = 1; $b <= $maxBoards; $b++) $results[$r][$b] = pickResult();
    $sc = runSwissScenario($players, $totalRounds, $results);
    $swissRand[] = ['players' => $players, 'total_rounds' => $totalRounds, 'results' => $results] + $sc;
}
dumpGolden('swiss_random', $swissRand);

// 7e. Round-robin scenarios — 120 random tournaments
$rrRand = [];
for ($s = 0; $s < 120; $s++) {
    $n = rnd(2, 8);
    $players = [];
    for ($i = 1; $i <= $n; $i++) $players[] = P($i, sprintf('P%02d', $i), null, $i);
    $totalRounds = $n % 2 === 0 ? $n - 1 : $n;
    $maxBoards = intdiv($n + 1, 2);
    $results = [];
    for ($r = 1; $r <= $totalRounds; $r++) for ($b = 1; $b <= $maxBoards; $b++) $results[$r][$b] = pickResult();
    $sc = runRoundRobinScenario($players, $totalRounds, $results);
    $rrRand[] = ['players' => $players, 'total_rounds' => $totalRounds, 'results' => $results] + $sc;
}
dumpGolden('rr_random', $rrRand);

// 7f. PHPCompat differential — validate phpRegularCompare / phpStringIsTruthy vs real PHP.
$names = ['3', '5', '9', '10', '20', '100', '007', '1.5', '1.50', '2e2', '-4', '+4', 'abc', 'Abc',
          'ABC', 'ana', 'Ana', 'niño', 'Niño', 'Zoë', 'Ábel', 'ábel', '', '0', '00', 'a b', 'a1', '1a',
          'José', 'Jose', '  7  ', 'O-O', 'e4'];
$nameCases = [];
foreach ($names as $a) foreach ($names as $b) {
    $c = $a <=> $b;
    $nameCases[] = ['a' => $a, 'b' => $b, 'cmp' => $c < 0 ? -1 : ($c > 0 ? 1 : 0)];
}
dumpGolden('phpcompat_names', $nameCases);

$truthyStrings = ['', '0', '00', '0.0', '1', '-0', 'false', 'true', 'abc', ' ', '0 ', 'e4', 'O-O', 'Qxf7'];
$truthyCases = [];
foreach ($truthyStrings as $s) $truthyCases[] = ['s' => $s, 'truthy' => (bool) $s];
dumpGolden('phpcompat_truthy', $truthyCases);

// ─────────────────────────────────────────────────────────────────────────────
// 8. SAN parsing (App\Services\ChessEngine — the REAL class, not an extraction)
// ─────────────────────────────────────────────────────────────────────────────
//
// Unlike everything above, this section loads the actual Laravel ChessEngine (it is framework-free,
// so requiring it is strictly more faithful than copying it) and uses it to pin the SAN parser that
// Swift's ChessNotation.swift and web-demo/js/engine.js must reproduce.
//
// Each case is  { fenBefore, san, uci, fenAfter, key }  and carries THREE Swift assertions:
//   1. parseSAN(fenBefore, san)          == uci
//   2. makeMove(parsed).fen              == fenAfter        (all six FEN fields)
//   3. san(for: parsed) re-parses to the same Move          (closes the generate/parse loop)
// Assertion 3 is a round-trip, not string equality, because the oracle echoes its input SAN back
// (`'san' => $original`) and therefore cannot pin SAN *generation* — Swift's own san(for:) owns
// that, and disambiguation may legitimately be more minimal than the corpus spelling.
//
// Corpus A: a deterministic 1-in-12 sample of the vendored ECO lines — real, curated master
//           openings, ~2,400 plies of captures, castling and disambiguation.
// Corpus B: hand-built FEN-anchored sequences for what openings never reach — promotion and
//           underpromotion, capture-promotion, en passant for both colours, castling rights lost to
//           a rook capture, all three disambiguation forms, check/mate suffixes, and a pin that
//           makes a pseudo-legally ambiguous move unambiguous.

require_once __DIR__ . '/chess_oracle.php';

if (!ORACLE_ENGINE_AVAILABLE) {
    fwrite(STDERR, "\nWARNING: skipping the san_parse + pgn_tokens goldens — the real ChessEngine was\n"
        . "not found at " . ORACLE_ENGINE_PATH . ".\n"
        . "Set LARAVEL_ROOT or clone the sibling repo, then re-run. ParityRunner will fail its\n"
        . "san_parse/pgn_tokens floors until you do.\n\n");
} else {

$sanCases = [];

/** Replay a SAN sequence from `$fen`, emitting one golden case per ply. Aborts loudly on bad SAN. */
function sanSequence(array &$out, ?string $fen, array $sans, string $src): void {
    $engine = oracle_engine($fen);
    foreach ($sans as $i => $san) {
        $before = $engine->fen();
        try {
            $applied = $engine->applyMoveSan($san);
        } catch (\InvalidArgumentException $e) {
            fwrite(STDERR, "FATAL: bad golden corpus at $src ply " . ($i + 1) . " ('$san'): "
                . $e->getMessage() . "\n");
            exit(1);
        }
        $out[] = [
            'fenBefore' => $before,
            'san'       => $san,
            'uci'       => $applied['uci'],
            'fenAfter'  => $engine->fen(),
            'key'       => oracle_key($engine),
            'src'       => "$src#" . ($i + 1),
        ];
    }
}

// ── Corpus A: 1-in-12 sample of the vendored ECO lines ──
$ecoDir = __DIR__ . '/../eco/data';
$ecoRows = [];
foreach (['a', 'b', 'c', 'd', 'e'] as $letter) {
    $path = "$ecoDir/$letter.tsv";
    if (!is_file($path)) continue;
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    array_shift($lines);
    foreach ($lines as $line) {
        if (trim($line) === '') continue;
        $p = explode("\t", $line);
        if (count($p) >= 3) $ecoRows[] = $p;
    }
}
if (!$ecoRows) {
    fwrite(STDERR, "FATAL: no ECO rows for the san_parse corpus — see tools/eco/data/SOURCE.md.\n");
    exit(1);
}
foreach ($ecoRows as $i => $p) {
    if ($i % 12 !== 0) continue;
    sanSequence($sanCases, null, oracle_pgn_tokens($p[2]), "eco:{$p[0]}:{$p[1]}");
}
$ecoSampled = count($sanCases);

// ── Corpus B: what openings never reach ──
$promoFen  = '8/P6k/8/8/8/8/6K1/8 w - - 0 1';          // lone a7 pawn, both kings clear
$capPromo  = '1n5k/P7/8/8/8/8/6K1/8 w - - 0 1';        // a7 pawn, black knight on b8
$castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';   // all four castling rights live

foreach (['Q', 'R', 'B', 'N'] as $pc) {
    sanSequence($sanCases, $promoFen, ["a8=$pc"], "promotion:$pc");
    sanSequence($sanCases, $capPromo, ["axb8=$pc"], "capture-promotion:$pc");
}

sanSequence($sanCases, '8/8/8/3pP3/8/8/8/K6k w - d6 0 1',  ['exd6'], 'en-passant:white');
sanSequence($sanCases, '8/8/8/8/3Pp3/8/8/K6k b - d3 0 1',  ['exd3'], 'en-passant:black');
sanSequence($sanCases, null, ['e4', 'c5', 'e5', 'd5', 'exd6'], 'en-passant:from-startpos');

sanSequence($sanCases, $castleFen, ['O-O'],    'castle:white-king');
sanSequence($sanCases, $castleFen, ['O-O-O'],  'castle:white-queen');
$castleFenB = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
sanSequence($sanCases, $castleFenB, ['O-O'],   'castle:black-king');
sanSequence($sanCases, $castleFenB, ['O-O-O'], 'castle:black-queen');
sanSequence($sanCases, $castleFen, ['Rxa8'], 'castle-rights:rook-captured-queenside');
sanSequence($sanCases, $castleFen, ['Rxh8'], 'castle-rights:rook-captured-kingside');
sanSequence($sanCases, $castleFen, ['Ra2'],  'castle-rights:rook-moved-queenside');
sanSequence($sanCases, $castleFen, ['Kf1'],  'castle-rights:king-moved');

// disambiguation: by file, by rank, and by both
sanSequence($sanCases, '7k/8/8/8/8/8/8/1N1K1N2 w - - 0 1', ['Nbd2'], 'disambig:file-b');
sanSequence($sanCases, '7k/8/8/8/8/8/8/1N1K1N2 w - - 0 1', ['Nfd2'], 'disambig:file-f');
sanSequence($sanCases, '7k/8/8/R7/8/8/R7/6K1 w - - 0 1',   ['R5a3'], 'disambig:rank-5');
sanSequence($sanCases, '7k/8/8/R7/8/8/R7/6K1 w - - 0 1',   ['R2a3'], 'disambig:rank-2');
sanSequence($sanCases, '7k/8/8/8/Q7/8/8/Q2Q2K1 w - - 0 1', ['Qa1d4'], 'disambig:file-and-rank');
sanSequence($sanCases, '7k/8/8/8/Q7/8/8/Q2Q2K1 w - - 0 1', ['Qdd4'],  'disambig:file-only-d');
sanSequence($sanCases, '7k/8/8/8/Q7/8/8/Q2Q2K1 w - - 0 1', ['Q4d4'],  'disambig:rank-only-4');

// a pin makes a pseudo-legally ambiguous knight move unambiguous (only Nd1-c3 is legal)
sanSequence($sanCases, '4r2k/8/8/8/8/8/4N3/3NK3 w - - 0 1', ['Nc3'], 'disambig:pin-resolves');

// check and mate suffixes must be accepted and stripped
sanSequence($sanCases, '7k/8/8/8/8/8/8/R5K1 w - - 0 1',      ['Ra8+'], 'suffix:check');
sanSequence($sanCases, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',  ['Ra8#'], 'suffix:mate');
sanSequence($sanCases, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',  ['Ra8'],  'suffix:absent');
sanSequence($sanCases, null, ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'], 'suffix:scholars-mate');

// halfmove clock: resets on pawn move and capture, increments otherwise
sanSequence($sanCases, null, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6'], 'clock:quiet-increments');
sanSequence($sanCases, '7k/8/8/3p4/4P3/8/8/7K w - - 9 40', ['exd5'], 'clock:capture-resets');

dumpGolden('san_parse', $sanCases);
echo "  san_parse: " . count($sanCases) . " cases ("
    . $ecoSampled . " from the ECO sample, " . (count($sanCases) - $ecoSampled) . " targeted)\n";

// ─────────────────────────────────────────────────────────────────────────────
// 9. PGN tokenising (App\Services\PgnImportService::splitPgnGames + tokenizeMoves)
// ─────────────────────────────────────────────────────────────────────────────
//
// Pins the strip pipeline — comments, nested variations, NAGs, move numbers, result tokens — and
// header parsing. ORACLE LIMIT: the real tokenizer DISCARDS `( … )` variations, so these goldens
// pin mainline extraction only. Our PGN parser keeps RAVs; the cross-check is that its mainline SAN
// sequence equals the oracle's token list. Variation structure has no oracle and is covered by the
// pgn_roundtrip property group instead.

$pgnSamples = [
    'plain'            => "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0",
    'no-result'        => "1. e4 e5 2. Nf3",
    'black-ellipsis'   => "1. e4 e5 2. Nf3 Nc6 3... Bb5",
    'comments'         => "1. e4 {King's pawn} e5 {symmetric} 2. Nf3 Nc6 *",
    'nags'             => "1. e4 \$1 e5 \$2 2. Nf3 \$146 Nc6 0-1",
    'suffix-annots'    => "1. e4! e5?! 2. Nf3!? Nc6?? 3. Bb5!! a6? 1/2-1/2",
    'variation'        => "1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 1-0",
    'nested-variation' => "1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6) d6) 2. Nf3 *",
    'comment-in-var'   => "1. e4 e5 (1... c5 {Sicilian} 2. Nf3) 2. Nf3 1-0",
    'multiline'        => "1. e4 e5\n2. Nf3 Nc6\n3. Bb5 a6\n1-0",
    'draw-result'      => "1. d4 d5 1/2-1/2",
    'star-result'      => "1. d4 d5 *",
    'castling'         => "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O *",
    'promotion'        => "1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Bd7 5. bxa8=Q *",
    'long-numbers'     => "10. Nf3 Nc6 11. Bb5 a6 100. Kg1 Kg8 *",
    'no-space-numbers' => "1.e4 e5 2.Nf3 Nc6 3.Bb5 1-0",
    'paren-in-comment' => "1. e4 {a (tricky) comment} e5 2. Nf3 *",
    'result-in-comment'=> "1. e4 {agreed 1/2-1/2 here} e5 1-0",
    'digits-in-comment'=> "1. e4 {see 12. Nf3 later} e5 *",
    'empty-variation'  => "1. e4 () e5 2. Nf3 *",
    'variation-first'  => "1. e4 (1. d4 d5) e5 2. Nf3 *",
    'triple-nested'    => "1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6 (2... e6 3. g3)) d6) 2. Nf3 *",
    'nag-edges'        => "1. e4 \$0 e5 \$255 2. Nf3 \$11 *",
    'double-comment'   => "1. e4 {one} {two} e5 {three} *",
    'spaced-result'    => "1. e4 e5   1-0   ",
    'annot-and-nag'    => "1. e4! \$1 e5?? \$4 2. Nf3 *",
    'scholars'         => "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0",
];
$tokenCases = [];
foreach ($pgnSamples as $label => $movetext) {
    $tokenCases[] = ['label' => $label, 'movetext' => $movetext, 'tokens' => oracle_pgn_tokens($movetext)];
}
// Plus real movetext: a 1-in-60 sample of the ECO lines, which carry genuine move numbering.
foreach ($ecoRows as $i => $p) {
    if ($i % 60 !== 0) continue;
    $tokenCases[] = ['label' => "eco:{$p[0]}:{$p[1]}", 'movetext' => $p[2], 'tokens' => oracle_pgn_tokens($p[2])];
}
dumpGolden('pgn_tokens', $tokenCases);

$pgnFiles = [
    'single-game' => "[Event \"Test\"]\n[Site \"Manila\"]\n[White \"Juan\"]\n[Black \"Maria\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 1-0\n",
    'two-games'   => "[Event \"A\"]\n[White \"P1\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0\n\n[Event \"B\"]\n[White \"P2\"]\n[Result \"0-1\"]\n\n1. d4 d5 0-1\n",
    'crlf'        => "[Event \"CRLF\"]\r\n[Result \"*\"]\r\n\r\n1. e4 e5 *\r\n",
    'no-headers'  => "1. e4 e5 2. Nf3 Nc6 *\n",
    'empty-tag'   => "[Event \"\"]\n[Round \"?\"]\n[Date \"????.??.??\"]\n\n1. e4 *\n",
    'wrapped'     => "[Event \"Wrap\"]\n\n1. e4 e5 2. Nf3 Nc6\n3. Bb5 a6 4. Ba4 Nf6\n1-0\n",
    'setup-fen'   => "[Event \"Setup\"]\n[SetUp \"1\"]\n[FEN \"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1\"]\n\n1. O-O O-O *\n",
    'three-games' => "[Event \"A\"]\n\n1. e4 1-0\n\n[Event \"B\"]\n\n1. d4 0-1\n\n[Event \"C\"]\n\n1. c4 *\n",
    'trailing-blanks' => "[Event \"T\"]\n\n1. e4 e5 1-0\n\n\n\n",
    'no-blank-line'   => "[Event \"NB\"]\n[Result \"1-0\"]\n1. e4 e5 1-0\n",
    'ratings'     => "[White \"Juan\"]\n[Black \"Maria\"]\n[WhiteElo \"1850\"]\n[BlackElo \"1720\"]\n[ECO \"B90\"]\n[TimeControl \"600+5\"]\n\n1. e4 c5 *\n",
];
$splitCases = [];
foreach ($pgnFiles as $label => $pgn) {
    // json_encode turns an EMPTY PHP array into `[]`, which would break a Swift [String: String]
    // decode. Force every header map to an object so the shape is stable across all cases.
    $games = array_map(
        fn(array $g) => ['headers' => (object) $g['headers'], 'movetext' => $g['movetext']],
        oracle_split_pgn_games($pgn)
    );
    $splitCases[] = ['label' => $label, 'pgn' => $pgn, 'games' => $games];
}
dumpGolden('pgn_split', $splitCases);

} // end ORACLE_ENGINE_AVAILABLE

echo "DONE\n";
