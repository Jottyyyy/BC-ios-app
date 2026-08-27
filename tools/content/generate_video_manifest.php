<?php
/**
 * generate_video_manifest.php — write the Tutorial Videos manifest the app reads.
 *
 *     php tools/content/generate_video_manifest.php            -> build/tutorial-videos.json
 *     php tools/content/generate_video_manifest.php out.json   -> somewhere else
 *
 * Then upload the file to the content bucket and point `ContentClient.manifestURL` at it.
 *
 * ## Why a file and not the API
 *
 * Spec §0.1: *"Content = static files on R2/S3. No API. No accounts. No sync."* The RN app reads the
 * same rows from `GET /api/tutorial-videos`, which sits inside `Route::middleware('auth:sanctum')`
 * and therefore needs a Sanctum token. **This app has no account and no token, by design** — it
 * signs in with Apple locally and never talks to the Laravel backend at all, and there is no
 * `/api/auth/apple` endpoint that could give it one. A published file needs neither.
 *
 * ## Why it reads the database rather than being written by hand
 *
 * The manifest has to describe the same catalogue the admin panel manages, and it has to keep
 * describing it after the next upload. A hand-kept copy is a second source of truth that starts
 * correct and drifts — which is the failure this repository has hit repeatedly. So this runs the
 * SAME query `TutorialVideoController@index` runs, in the same order, and emits the same field
 * names. Re-run it after any change in the admin panel.
 *
 * Override the sibling-repo location with:  LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL
 */

function manifest_laravel_root(): string {
    $env = getenv('LARAVEL_ROOT');
    if ($env !== false && $env !== '') return rtrim($env, "/\\");
    return realpath(__DIR__ . '/../../..') . DIRECTORY_SEPARATOR . 'BYAHERONG-COACH-LARAVEL';
}

$root = manifest_laravel_root();
$autoload = $root . '/vendor/autoload.php';
$bootstrap = $root . '/bootstrap/app.php';

if (!is_file($autoload) || !is_file($bootstrap)) {
    fwrite(STDERR,
        "FATAL: the Laravel app was not found at $root.\n"
        . "This reads the tutorial_videos table through Laravel itself, so the sibling repo has to\n"
        . "be present and `composer install`ed. Set LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL.\n");
    exit(1);
}

require_once $autoload;
$app = require_once $bootstrap;
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

// The same query as TutorialVideoController@index — same scope, same order, same columns. If that
// controller changes, this line is what has to change with it.
try {
    $videos = App\Models\TutorialVideo::visible()
        ->orderBy('sort_order')
        ->orderByDesc('created_at')
        ->get(['id', 'title', 'description', 'category', 'thumbnail_url', 'video_url', 'created_at'])
        ->toArray();
} catch (Throwable $e) {
    fwrite(STDERR, "FATAL: could not read tutorial_videos — " . $e->getMessage() . "\n"
        . "Check the DB credentials in $root/.env.\n");
    exit(1);
}

// A row with no playable URL is dropped HERE rather than on the device. The app drops it too —
// `VideoLibrary.parse` skips anything it cannot play — but a catalogue that is short for a reason
// nobody can see from the outside is worth catching at publish time, where the admin can fix it.
$skipped = [];
$rows = [];
foreach ($videos as $v) {
    $url = trim((string) ($v['video_url'] ?? ''));
    $title = trim((string) ($v['title'] ?? ''));
    if ($url === '' || $title === '' || !isset($v['id'])) {
        $skipped[] = ($v['id'] ?? '?') . ' ' . ($title !== '' ? $title : '(untitled)');
        continue;
    }
    $rows[] = $v;
}

$out = $argv[1] ?? (realpath(__DIR__ . '/../..') . '/build/tutorial-videos.json');
@mkdir(dirname($out), 0777, true);

// The wrapped shape, matching what the controller returns, so the manifest and the API response are
// literally interchangeable — `VideoLibrary.parse` accepts either.
file_put_contents($out,
    json_encode(['videos' => $rows], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

$categories = [];
foreach ($rows as $v) {
    $c = trim((string) ($v['category'] ?? '')) ?: 'Uncategorized';
    $categories[$c] = ($categories[$c] ?? 0) + 1;
}

echo "wrote $out\n";
echo "  " . count($rows) . " video(s)\n";
foreach ($categories as $name => $n) {
    // The app folds any category outside its own list into Uncategorized rather than dropping the
    // video, which is what the RN screen does. Naming them here is how a typo gets noticed.
    $known = in_array($name, ['Opening', 'Middlegame', 'Endgame', 'General', 'Uncategorized'], true);
    echo "    $name: $n" . ($known ? "" : "   <- NOT a known category; the app will show it under Uncategorized") . "\n";
}
if ($skipped) {
    echo "  SKIPPED " . count($skipped) . " row(s) with no title or no video_url:\n";
    foreach ($skipped as $s) echo "    $s\n";
}
echo "\nUpload it to the content bucket, then set ContentClient.manifestURL to its public URL.\n";
