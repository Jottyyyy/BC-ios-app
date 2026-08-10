<?php
/**
 * Builds the bundled offline ECO opening book.
 *
 *   tools/eco/data/{a,b,c,d,e}.tsv          (vendored lichess-org/chess-openings, CC0)
 *        │  replay each line's SAN through the REAL App\Services\ChessEngine
 *        ▼
 *   DemoApp/Sources/BiyaherongUI/ECO/eco.tsv   read-only book shipped in the app bundle
 *   web-demo/js/eco-data.js                    the browser mirror's copy
 *   Goldens/eco_lookup.json                    a sample for the ParityRunner `eco` group
 *
 * Keys come from `oracle_position_key()` — the 4-field FEN with a dead en-passant square cleared —
 * so transpositions collapse to one entry and the keys are identical to those in
 * Goldens/san_parse.json by construction. (Plain `fenNormalized()` would NOT collapse them: see the
 * comment on `oracle_position_key` in tools/oracle/chess_oracle.php.)
 *
 * Two kinds of row are emitted:
 *   named        — a position where an ECO line ENDS; carries that line's eco + name.
 *   pass-through — a position an ECO line merely traverses; name is empty.
 * Both count as "in book" (which drives the `book` classification tier); only named rows change the
 * displayed opening. A miss keeps the last known name, so pass-through positions read correctly.
 *
 * Usage:  php tools/eco/build_eco.php
 */

require_once __DIR__ . '/../oracle/chess_oracle.php';
oracle_require_engine();

$ROOT     = realpath(__DIR__ . '/../..');
$DATA     = __DIR__ . '/data';
$OUT_APP  = $ROOT . '/DemoApp/Sources/BiyaherongUI/ECO/eco.tsv';
$OUT_WEB  = $ROOT . '/web-demo/js/eco-data.js';
$OUT_GOLD = $ROOT . '/Goldens/eco_lookup.json';

@mkdir(dirname($OUT_APP), 0777, true);
@mkdir(dirname($OUT_GOLD), 0777, true);

// ── 1. Read the vendored TSVs ────────────────────────────────────────────────────────────────────

$rows = [];
foreach (['a', 'b', 'c', 'd', 'e'] as $letter) {
    $path = "$DATA/$letter.tsv";
    if (!is_file($path)) {
        fwrite(STDERR, "FATAL: missing $path — see tools/eco/data/SOURCE.md for the fetch command.\n");
        exit(1);
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    array_shift($lines); // header: eco \t name \t pgn
    foreach ($lines as $line) {
        if (trim($line) === '') continue;
        $parts = explode("\t", $line);
        if (count($parts) < 3) {
            fwrite(STDERR, "FATAL: malformed row in $letter.tsv: $line\n");
            exit(1);
        }
        $rows[] = ['eco' => $parts[0], 'name' => $parts[1], 'pgn' => $parts[2]];
    }
}
echo "read " . count($rows) . " ECO entries\n";

// Deterministic order: by ply count (shortest first, so a shorter line never overwrites a more
// specific one), then eco, then name. Nothing here may depend on filesystem or hash ordering.
usort($rows, function ($a, $b) {
    $pa = count(oracle_pgn_tokens($a['pgn']));
    $pb = count(oracle_pgn_tokens($b['pgn']));
    return [$pa, $a['eco'], $a['name']] <=> [$pb, $b['eco'], $b['name']];
});

// ── 2. Replay every line through the real engine ─────────────────────────────────────────────────

$named       = [];   // key => ['eco' => .., 'name' => .., 'plies' => n]
$passThrough = [];   // key => eco
$maxPlies    = 0;
$failures    = [];
$collisions  = 0;

foreach ($rows as $row) {
    $tokens = oracle_pgn_tokens($row['pgn']);
    if (count($tokens) === 0) {
        $failures[] = [$row['eco'], $row['name'], 'empty movetext'];
        continue;
    }

    $engine = oracle_engine();
    $ok = true;
    $keys = [];
    foreach ($tokens as $san) {
        try {
            $engine->applyMoveSan($san);
        } catch (\InvalidArgumentException $e) {
            $failures[] = [$row['eco'], $row['name'], "'$san': " . $e->getMessage()];
            $ok = false;
            break;
        }
        $keys[] = oracle_key($engine);
    }
    if (!$ok) continue;

    $plies = count($keys);
    $maxPlies = max($maxPlies, $plies);

    // every position along the line is "in book"
    foreach (array_slice($keys, 0, $plies - 1) as $k) {
        if (!isset($passThrough[$k])) $passThrough[$k] = $row['eco'];
    }

    // the terminal position carries the name
    $terminal = $keys[$plies - 1];
    if (isset($named[$terminal])) {
        $collisions++;   // a genuine transposition between two named lines; shortest already won
    } else {
        $named[$terminal] = ['eco' => $row['eco'], 'name' => $row['name'], 'plies' => $plies];
    }
}

if ($failures) {
    fwrite(STDERR, "\nFATAL: " . count($failures) . " ECO line(s) failed to replay:\n");
    foreach (array_slice($failures, 0, 20) as $f) {
        fwrite(STDERR, "  [{$f[0]}] {$f[1]} — {$f[2]}\n");
    }
    if (count($failures) > 20) fwrite(STDERR, "  … and " . (count($failures) - 20) . " more\n");
    exit(1);
}

// pass-through positions that are also named drop out of the pass-through set
foreach (array_keys($named) as $k) unset($passThrough[$k]);

echo "named positions:        " . count($named) . "\n";
echo "pass-through positions: " . count($passThrough) . "\n";
echo "transposition merges:   $collisions\n";
echo "deepest line:           $maxPlies plies\n";

// ── 3. Emit the app book (sorted by key for a stable, diffable artifact) ─────────────────────────

$book = [];
foreach ($named as $k => $v)      $book[$k] = [$v['eco'], $v['name']];
foreach ($passThrough as $k => $e) $book[$k] = [$e, ''];
ksort($book, SORT_STRING);

$fh = fopen($OUT_APP, 'wb');
fwrite($fh, "# Biyaherong offline ECO book — GENERATED by tools/eco/build_eco.php, do not hand-edit.\n");
fwrite($fh, "# Source: lichess-org/chess-openings (CC0). Key = 4-field FEN, en-passant square cleared when no ep capture is available.\n");
fwrite($fh, "# key\teco\tname   (name empty = position is in book but carries no name of its own)\n");
foreach ($book as $k => $v) fwrite($fh, $k . "\t" . $v[0] . "\t" . $v[1] . "\n");
fclose($fh);
echo "wrote " . str_replace($ROOT . DIRECTORY_SEPARATOR, '', $OUT_APP) . " (" . count($book) . " rows, "
    . number_format(filesize($OUT_APP) / 1024, 1) . " KB)\n";

// ── 4. Emit the web-demo mirror ──────────────────────────────────────────────────────────────────

$js  = "/* GENERATED by tools/eco/build_eco.php — do not hand-edit.\n";
$js .= "   Offline ECO book mirrored from DemoApp/Sources/BiyaherongUI/ECO/eco.tsv.\n";
$js .= "   Source: lichess-org/chess-openings (CC0). Key = 4-field FEN, en-passant square cleared when no ep capture is available.\n";
$js .= "   Value: [eco, name]; an empty name means the position is in book but unnamed. */\n";
$js .= "(function (root) {\n  var ECO_DATA = ";
$js .= json_encode($book, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$js .= ";\n  if (typeof module !== 'undefined' && module.exports) { module.exports = ECO_DATA; }\n";
$js .= "  root.ECO_DATA = ECO_DATA;\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n";
file_put_contents($OUT_WEB, $js);
echo "wrote " . str_replace($ROOT . DIRECTORY_SEPARATOR, '', $OUT_WEB) . " ("
    . number_format(filesize($OUT_WEB) / 1024, 1) . " KB)\n";

// ── 4b. A byte copy into Goldens/ so ParityRunner can exercise the real OpeningBook(tsv:) parser
//        against the real shipped file rather than a toy string. Goldens/ is gitignored and is the
//        only directory the runner reads.

copy($OUT_APP, $ROOT . '/Goldens/eco_book.tsv');
echo "wrote Goldens/eco_book.tsv (copy of the shipped book, for the ParityRunner `eco` group)\n";

// ── 5. Emit a golden sample for the ParityRunner `eco` group ─────────────────────────────────────
//
// Every 9th named entry plus the hand-picked anchors below, each carrying the SAN path that
// produces it so Swift can replay and confirm it lands on the same key.

$anchors = ['1. e4', '1. e4 c5', '1. d4', '1. e4 e5 2. Nf3 Nc6 3. Bb5', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6'];
$sample  = [];
$i = 0;
foreach ($rows as $row) {
    $isAnchor = in_array($row['pgn'], $anchors, true);
    if (!$isAnchor && ($i++ % 9 !== 0)) continue;

    $engine = oracle_engine();
    $tokens = oracle_pgn_tokens($row['pgn']);
    foreach ($tokens as $san) $engine->applyMoveSan($san);
    $key = oracle_key($engine);

    // only emit rows this line actually NAMES (a longer line may own the terminal position)
    if (!isset($named[$key]) || $named[$key]['name'] !== $row['name']) continue;

    $sample[] = [
        'sanMoves' => $tokens,
        'key'      => $key,
        'eco'      => $named[$key]['eco'],
        'name'     => $named[$key]['name'],
        'plyCount' => count($tokens),
    ];
}

// transposition cases: the same position reached by two different move orders must share a key
$transpositions = [];
foreach ([['1. e4 e5 2. Nf3', '1. Nf3 e5 2. e4'],
          ['1. d4 d5 2. c4',  '1. c4 d5 2. d4'],
          ['1. e4 c5 2. Nf3 d6', '1. Nf3 d6 2. e4 c5']] as $pair) {
    $keys = [];
    foreach ($pair as $line) {
        $engine = oracle_engine();
        foreach (oracle_pgn_tokens($line) as $san) $engine->applyMoveSan($san);
        $keys[] = oracle_key($engine);
    }
    $transpositions[] = ['lineA' => $pair[0], 'lineB' => $pair[1], 'keyA' => $keys[0], 'keyB' => $keys[1]];
}

file_put_contents($OUT_GOLD, json_encode(
    ['lookups' => $sample, 'transpositions' => $transpositions],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
echo "wrote Goldens/eco_lookup.json (" . count($sample) . " lookups, "
    . count($transpositions) . " transposition pairs)\n";

echo "DONE\n";
