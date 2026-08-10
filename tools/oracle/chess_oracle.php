<?php
/**
 * Shared chess oracle for the Biyaherong parity suite and the ECO book build.
 *
 * Unlike the arithmetic engines in generate_goldens.php — which are standalone *extractions* of
 * controller method bodies — this include loads the **real** `App\Services\ChessEngine` class from
 * the sibling Laravel repo. It is a self-contained class with no framework dependencies, so
 * requiring the actual source is strictly more faithful than copying it, and it guarantees that
 * `Goldens/san_parse.json` and the ECO book are produced by the *same* parser: the book's position
 * keys are therefore consistent with the SAN goldens by construction.
 *
 * The PGN helpers below ARE extractions, from `App\Services\PgnImportService` (which depends on
 * Laravel's ValidationException and so cannot be required directly).
 *
 * Override the sibling-repo location with:  LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL
 */

// ── Locate and load the real ChessEngine ─────────────────────────────────────────────────────────

function oracle_laravel_root(): string {
    $env = getenv('LARAVEL_ROOT');
    if ($env !== false && $env !== '') return rtrim($env, "/\\");
    return realpath(__DIR__ . '/../../..') . DIRECTORY_SEPARATOR . 'BYAHERONG-COACH-LARAVEL';
}

define('ORACLE_ENGINE_PATH', oracle_laravel_root() . '/app/Services/ChessEngine.php');
define('ORACLE_ENGINE_AVAILABLE', is_file(ORACLE_ENGINE_PATH));
if (ORACLE_ENGINE_AVAILABLE) {
    require_once ORACLE_ENGINE_PATH;
}

/**
 * Hard-fail with an actionable message. Callers that cannot proceed without the engine
 * (build_eco.php) call this; generate_goldens.php instead skips its chess groups and warns, so a
 * missing sibling repo never blocks the arithmetic goldens. The ParityRunner floors then fail
 * loudly on the absent files, which is the correct outcome — you cannot claim parity without them.
 */
function oracle_require_engine(): void {
    if (ORACLE_ENGINE_AVAILABLE) return;
    fwrite(STDERR,
        "FATAL: cannot find the real ChessEngine at\n  " . ORACLE_ENGINE_PATH . "\n\n" .
        "The chess oracle loads the actual Laravel class rather than a copy, so the sibling repo\n" .
        "must be present. Clone it beside this one, or set LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL.\n");
    exit(1);
}

/** Fresh engine at the standard start position, or at `$fen`. */
function oracle_engine(?string $fen = null): \App\Services\ChessEngine {
    return new \App\Services\ChessEngine($fen);
}

// ── The position key ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical position key: the 4-field FEN with the en-passant square cleared unless an
 * en-passant capture is actually available to the side to move.
 *
 * This is NOT `ChessEngine::fenNormalized()`, and the difference is load-bearing. `fenNormalized()`
 * records the ep square after *any* double pawn push, so `1. e4 e5 2. Nf3` (ep `-`) and
 * `1. Nf3 e5 2. e4` (ep `e3`) hash differently despite being the same position. That breaks
 * transposition lookup for the most common move orders in chess, and it also makes threefold
 * repetition miss by one occurrence. Clearing a dead ep square is the standard EPD/X-FEN
 * convention and is what Lichess and Polyglot books do.
 *
 * The test is the *presence of a capturing pawn* (pseudo-legal), not full legality: a pawn pinned
 * against its own king still counts. That keeps the rule trivially identical in PHP, Swift and
 * JavaScript, and the pinned-pawn case cannot change an opening name.
 *
 * Mirrored by `ChessPosition.positionKey` (Swift) and `Engine.positionKey` (JS) — all three must
 * agree byte for byte.
 */
function oracle_position_key(string $fen): string {
    $parts = preg_split('/\s+/', trim($fen));
    [$board, $side, $castling, $ep] = [$parts[0], $parts[1], $parts[2], $parts[3]];

    if ($ep === '-') return "$board $side $castling -";

    // Expand the placement field into [rankIdx][fileIdx], rankIdx 0 = rank 1.
    $grid = array_fill(0, 8, array_fill(0, 8, null));
    $ranks = explode('/', $board);
    for ($i = 0; $i < 8; $i++) {
        $r = 7 - $i;
        $f = 0;
        foreach (str_split($ranks[$i]) as $ch) {
            if (ctype_digit($ch)) { $f += (int) $ch; } else { $grid[$r][$f++] = $ch; }
        }
    }

    $epFile = ord($ep[0]) - ord('a');
    $epRank = (int) $ep[1] - 1;
    // White to move captures upward, so its pawn sits one rank below the target; Black one above.
    $pawn     = $side === 'w' ? 'P' : 'p';
    $fromRank = $side === 'w' ? $epRank - 1 : $epRank + 1;

    $available = false;
    if ($fromRank >= 0 && $fromRank <= 7) {
        foreach ([$epFile - 1, $epFile + 1] as $f) {
            if ($f >= 0 && $f <= 7 && $grid[$fromRank][$f] === $pawn) { $available = true; break; }
        }
    }

    return "$board $side $castling " . ($available ? $ep : '-');
}

/** The position key for an engine's current position. */
function oracle_key(\App\Services\ChessEngine $engine): string {
    return oracle_position_key($engine->fen());
}

// ── PgnImportService extractions ─────────────────────────────────────────────────────────────────
//
// NOTE (oracle limit, deliberate): `tokenizeMoves` strips `( … )` recursive variations entirely, so
// these helpers are an oracle for the MAINLINE only. They pin the fiddly strip pipeline — comments,
// nested parens, NAGs, move numbers, result tokens — and header parsing. Variation *structure* has
// no oracle and is covered by the round-trip property group instead.

/**
 * Verbatim extraction of PgnImportService::splitPgnGames (lines 124-163).
 * Returns [['headers' => [...], 'movetext' => '...'], ...].
 */
function oracle_split_pgn_games(string $pgn): array {
    $pgn = preg_replace('/\r\n?/', "\n", $pgn);
    $games = [];
    $lines = explode("\n", $pgn);

    $current = ['headers' => [], 'movetext' => ''];
    $inHeaders = true;
    $hasContent = false;

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') {
            if ($inHeaders && $hasContent) {
                $inHeaders = false;
            } elseif (!$inHeaders && $hasContent && $current['movetext'] !== '') {
                $games[] = $current;
                $current = ['headers' => [], 'movetext' => ''];
                $inHeaders = true;
                $hasContent = false;
            }
            continue;
        }

        $hasContent = true;
        if ($inHeaders && preg_match('/^\[(\w+)\s+"(.*)"\]$/', $trimmed, $m)) {
            $current['headers'][$m[1]] = $m[2];
        } else {
            $inHeaders = false;
            $current['movetext'] .= ' ' . $trimmed;
        }
    }
    if (trim($current['movetext']) !== '') {
        $games[] = $current;
    }

    return $games;
}

/**
 * The strip pipeline from PgnImportService::tokenizeMoves (lines 174-187), returning just the SAN
 * token list. The real method then feeds these to ChessEngine; that half is pinned by `san_parse`.
 */
function oracle_pgn_tokens(string $movetext): array {
    $clean = preg_replace('/\{[^}]*\}/', ' ', $movetext);
    while (preg_match('/\([^()]*\)/', $clean)) {
        $clean = preg_replace('/\([^()]*\)/', ' ', $clean);
    }
    $clean = preg_replace('/\$\d+/', ' ', $clean);
    $clean = preg_replace('/\b\d+\.+\s*/', ' ', $clean);
    $clean = preg_replace('/\b(1-0|0-1|1\/2-1\/2)\b/', ' ', $clean);
    $clean = preg_replace('/(?<=\s|^)\*(?=\s|$)/', ' ', $clean);

    return preg_split('/\s+/', trim($clean), -1, PREG_SPLIT_NO_EMPTY);
}
