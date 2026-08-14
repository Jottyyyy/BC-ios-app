#!/usr/bin/env node
/*
 * js_goldens.js — replay the PHP oracle's golden vectors against the web-demo JavaScript.
 *
 * This is the real gate for the JS half of the Analysis Board. `swift` is not on PATH on the
 * Windows checkout, so ParityRunner cannot run there; this script is what proves the notation
 * layer is correct BEFORE any of it is transliterated into Swift.
 *
 *     php tools/oracle/generate_goldens.php     # produces Goldens/*.json
 *     php tools/eco/build_eco.php               # produces the ECO book + eco_lookup.json
 *     node tools/qa/js_goldens.js               # this script — exit 0 means green
 *
 * Goldens/ is gitignored, so regenerate before running. Every suite is also reported on its own so
 * a failure names the layer that broke.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var GOLDENS = path.join(ROOT, 'Goldens');
var JS = path.join(ROOT, 'web-demo', 'js');

var E = require(path.join(JS, 'engine.js'));
var T = require(path.join(JS, 'movetree.js'));
var P = require(path.join(JS, 'pgn.js'));
var EVAL = require(path.join(JS, 'analysis-eval.js'));
var A = require(path.join(JS, 'analysis-engine.js'));
var ESET = require(path.join(JS, 'engine-settings.js'));
var V = require(path.join(JS, 'review.js'));
var B = require(path.join(JS, 'opening-book.js'));
var MET = require(path.join(JS, 'analysis-metrics.js'));
var AB = require(path.join(JS, 'analysis.js'));
var ST = require(path.join(JS, 'analysis-store.js'));
var PE = require(path.join(JS, 'position-editor.js'));
// Runs chess-board.js inside a `vm` context with a fake DOM, so it never touches our globals.
var BOARD = require(path.join(__dirname, 'board_component_test.js'));
// Guards the one thing the two store suites cannot check about each other.
var CANON = require(path.join(__dirname, 'canonical_library_check.js'));
var MKEYS = require(path.join(__dirname, 'metrics_key_check.js'));
var REPLAY = require(path.join(__dirname, 'replay_position_editor.js'));
var SKEYS = require(path.join(__dirname, 'swift_source_keys.js'));
var LAYOUT = require(path.join(__dirname, 'board_layout_check.js'));
var SLAYOUT = require(path.join(__dirname, 'swift_layout_check.js'));
var SLAYOUTMUT = require(path.join(__dirname, 'swift_layout_mutation_test.js'));
var HOST = require(path.join(JS, 'engine-host.js'));
var BUDGET = require(path.join(__dirname, 'engine_budget_check.js'));
var STRENGTH = require(path.join(__dirname, 'engine_strength_check.js'));
var RENGINE = require(path.join(__dirname, 'replay_engine_settings.js'));
var WORKER = require(path.join(__dirname, 'worker_protocol_check.js'));
var CORPUS = require(path.join(__dirname, 'puzzle_corpus_check.js'));
var PUZCORE = require(path.join(__dirname, 'puzzle_core_test.js'));
var PAIRING = require(path.join(__dirname, 'pairing_test.js'));
var PMETRICS = require(path.join(ROOT, 'web-demo', 'js', 'pairing-metrics.js'));
var PSTORE = require(path.join(ROOT, 'web-demo', 'js', 'pairing-store.js'));
var PSCREENS = require(path.join(__dirname, 'pairing_screen_test.js'));
var RPAIR = require(path.join(__dirname, 'replay_pairing.js'));
var FIDE = require(path.join(__dirname, 'fide_dutch_test.js'));
var COACH = require(path.join(ROOT, 'web-demo', 'js', 'coach-engine.js'));
var CBOOK = require(path.join(ROOT, 'web-demo', 'js', 'coach-book.js'));
var CGAME = require(path.join(ROOT, 'web-demo', 'js', 'coach-game.js'));
var CMET = require(path.join(ROOT, 'web-demo', 'js', 'coach-metrics.js'));
var CSTR = require(path.join(ROOT, 'web-demo', 'js', 'coach-strings.js'));
var CSEL = require(path.join(ROOT, 'web-demo', 'js', 'coach-select.js'));
var CCOL = require(path.join(ROOT, 'web-demo', 'js', 'coach-color.js'));
var CTURN = require(path.join(ROOT, 'web-demo', 'js', 'coach-turn.js'));
var CPLAY = require(path.join(ROOT, 'web-demo', 'js', 'coach-play.js'));
var CSCREEN = require(path.join(__dirname, 'coach_screen_test.js'));
var CREVIEW = require(path.join(__dirname, '..', '..', 'web-demo', 'js', 'coach-review.js'));
var RCOACH = require(path.join(__dirname, 'replay_coach.js'));
var RPUZ = require(path.join(__dirname, 'replay_puzzle_core.js'));
var RVM  = require(path.join(__dirname, 'replay_puzzle_vm.js'));
var PMET = require(path.join(JS, 'puzzle-metrics.js'));
var PSTAT = require(path.join(JS, 'puzzle-stats.js'));
var PSTREAK = require(path.join(JS, 'streak-engine.js'));
var PTURBO  = require(path.join(JS, 'turbo-run.js'));
var PSCREEN = require(path.join(__dirname, 'puzzle_screen_test.js'));

function loadGolden(name) {
  var p = path.join(GOLDENS, name + '.json');
  if (!fs.existsSync(p)) {
    console.error('MISSING Goldens/' + name + '.json — run: php tools/oracle/generate_goldens.php');
    if (name === 'eco_lookup') console.error('  (and: php tools/eco/build_eco.php)');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

var suites = [];
function record(name, result) { suites.push({ name: name, result: result }); }
// Suites that need the event loop (the worker yields with setTimeout between depths).
var asyncSuites = [];

// A tiny harness matching the shape the module self-tests return.
function harness() {
  var passed = 0, failures = [], extra = 0;
  return {
    expect: function (cond, what) {
      if (cond) { passed++; return; }
      if (failures.length < 25) failures.push(what); else extra++;
    },
    done: function (label) {
      if (extra > 0) failures.push('… and ' + extra + ' more failures');
      return {
        passed: passed, failures: failures, ok: failures.length === 0,
        summary: failures.length === 0
          ? label + ': ' + passed + ' assertions passed'
          : label + ': ' + passed + ' passed, ' + failures.length + ' FAILED\n'
            + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
      };
    }
  };
}

// ---- 1. The module self-tests (no goldens needed) ---------------------------
record('engine.selfTest', E.selfTest());
record('movetree.selfTest', T.selfTest());
record('pgn.selfTest', P.selfTest());
record('analysis-eval.selfTest', EVAL.selfTest());
record('analysis-engine.selfTest', A.selfTest());
record('engine-settings.selfTest', ESET.selfTest());
record('review.selfTest', V.selfTest());
record('opening-book.selfTest', B.selfTest());
record('analysis-metrics.selfTest', MET.selfTest());
// The Analysis Board's pure session layer — the twin of AnalysisSession.swift.
record('analysis-board.selfTest', AB.selfTest());
// The saved-game library: records, folder rules, search, and the 24h draft TTL.
record('analysis-store.selfTest', ST.selfTest());
// Setup Position: piece placement, castling normalisation, and the validation chess.js used to do.
record('position-editor.selfTest', PE.selfTest());
// The metrics constants against the values extracted from the real RN StyleSheet.
record('analysis-metrics vs RN source',
       MET.selfTestSource(require(path.join(ROOT, 'tools', 'metrics', 'board_styles.json'))));
// The <chess-board> component: arrow geometry, drag, and the tap-to-move regression guard.
record('board component', BOARD.selfTest());
record('canonical library document', CANON.selfTest());
// Every MET.<BLOCK>.<key> the screens read must exist — a typo there fails silently.
record('metrics keys resolve', MKEYS.selfTest());
// The blind-written Swift tables, replayed through the JS that has actually run.
record('swift tables vs JS', REPLAY.selfTest());
// Every StyleSheet lookup AnalysisMetricsCheck makes must have a value to find.
record('swift source lookups', SKEYS.selfTest());
// The board must be sized by WIDTH and must not flex — the one bug that lived in CSS.
record('board layout invariants', LAYOUT.selfTest());
// The same rule in SwiftUI, where four screens had reinvented it as `min(width, height)` — plus
// the greedy one-axis frame that pushed the Streak solver into the middle of the phone.
record('swift layout invariants', SLAYOUT.selfTest());
// …and the proof those greps can still fail.
record('swift layout mutation', SLAYOUTMUT.selfTest());
// Where the search runs, and the frame budget it must respect when it runs in-thread.
record('engine-host.selfTest', HOST.selfTest());
record('engine frame budget', BUDGET.selfTest());
record('engine strength', STRENGTH.selfTest());
record('swift engine settings vs JS', RENGINE.selfTest());
// The bundled puzzle corpus: quotas, indexes, and every line replayed through the real engine.
// Every later puzzle assertion is stated against this DB, so a bad corpus would make them all
// pass while the app served nothing.
record('puzzle corpus', CORPUS.selfTest());
// The Puzzle Hub's pure layer — solver state machine, selection ladders, progress store. Written
// and proven in JS first, then transliterated; these are the runs the Swift is checked against.
record('puzzle core', PUZCORE.selfTest());
record('pairing engine', PAIRING.selfTest());
record('pairing store', PSTORE.selfTest());
record('pairing screens', PSCREENS.selfTest());
record('swift pairing vs JS', RPAIR.selfTest());
record('published FIDE pairings', FIDE.selfTest());
record('coach engine', COACH.selfTest());
record('coach opening book', CBOOK.selfTest());
record('coach game state', CGAME.selfTest());
record('coach strings', CSTR.selfTest());
record('coach select', CSEL.selfTest());
record('coach colour select', CCOL.selfTest());
record('coach turn controller', CTURN.selfTest());
record('coach game screen', CPLAY.selfTest());
record('coach screens', CSCREEN.selfTest());
record('coach review', CREVIEW.selfTest());
record('swift coach vs JS', RCOACH.selfTest());
record('coach-metrics vs RN source',
       CMET.selfTestSource(require(path.join(ROOT, 'tools', 'metrics', 'coach_styles.json'))));
record('coach book legality', CBOOK.selfTestLegality(require(path.join(ROOT, 'web-demo', 'js', 'engine.js'))));
record('pairing-metrics.selfTest', PMETRICS.selfTest());
record('pairing-metrics vs RN source',
       PMETRICS.selfTestSource(require(path.join(ROOT, 'tools', 'metrics', 'tournament_styles.json'))));
// ...and the check that the transliteration did not drift.
record('swift puzzle tables vs JS', RPUZ.selfTest());
// The SCREENS' decisions, not just their constants. `swift_symbol_check.js` proves every name
// resolves and `swift_lint.js` proves the brackets match; neither can tell whether a screen took
// the right branch, which is the whole failure mode of porting eleven views without a compiler.
record('swift puzzle screens vs JS', RVM.selfTest());
// The Puzzle Hub's presentation layer, and the same layer asserted against the AST extraction of
// the real RN StyleSheets. Nothing on these screens is a transcribed number.
record('puzzle-metrics.selfTest', PMET.selfTest());
record('puzzle-metrics vs RN source',
       PMET.selfTestSource(require(path.join(ROOT, 'tools', 'metrics', 'puzzle_styles.json'))));
// The Home screen's charts, as pure functions — every one has a day-one edge case.
record('puzzle-stats.selfTest', PSTAT.selfTest());
// The Streak ramp's JS twin. It had none until Daily/Thematic landed, which is why
// `StreakEngine.increment` sat dead in Swift with nothing to notice.
record('streak-engine.selfTest', PSTREAK.selfTest());
// Turbo's run engine — the lives, the ramp and the clock. It was reachable only from the
// mutation harness, which meant the gate could go green with the whole of Part 14.2 broken.
record('turbo-run.selfTest', PTURBO.selfTest());
// The three screens rendered into a fake DOM. Neither the logic nor the metrics suite would
// notice a screen that throws on its first paint or wires a button to nothing.
record('puzzle screens', PSCREEN.selfTest());
// The worker itself, driven through its real message protocol in a fake worker scope.
// Async: it yields between depths exactly as it does in a browser, so the report waits.
asyncSuites.push({ name: 'analysis worker protocol', mod: WORKER });

// ---- 2b. game_review — the review math against the PHP oracle's own vectors ---
// Same 303 cases and the same tolerances the Swift `game_review` / `game_review_random` groups use,
// so the two languages assert identically. Matching their assertion counts exactly (47 and 6114) is
// the cheapest proof of that.
record('game_review goldens', V.selfTestGoldens(loadGolden('game_review'), 'case', 1e-4));
record('game_review_random goldens', V.selfTestGoldens(loadGolden('game_review_random'), 'g', 1e-3));

// ---- 2. san_parse — SAN parsing, resulting FEN, and the position key --------
record('san_parse goldens', E.selfTestGoldens(loadGolden('san_parse')));

// ---- 3. pgn_tokens — our scanner vs the server's strip pipeline -------------
// The oracle keeps !? suffixes attached to SAN tokens and discards ( … ) variations entirely, so
// this compares main-line token TEXT. It is the assertion that ties our RAV-preserving parser back
// to the mainline-only oracle.
(function () {
  var h = harness();
  var cases = loadGolden('pgn_tokens');
  cases.forEach(function (c) {
    var got = P.mainlineTokens(c.movetext);
    h.expect(got.length === c.tokens.length,
      c.label + ': token count ' + got.length + ' != ' + c.tokens.length);
    h.expect(got.join(' ') === c.tokens.join(' '),
      c.label + ': [' + got.join(' ') + '] != [' + c.tokens.join(' ') + ']');
  });
  record('pgn_tokens goldens', h.done('PgnTokens'));
})();

// ---- 4. pgn_split — game splitting and header parsing -----------------------
(function () {
  var h = harness();
  var cases = loadGolden('pgn_split');
  cases.forEach(function (c) {
    var got = P.splitGames(c.pgn);
    h.expect(got.length === c.games.length,
      c.label + ': game count ' + got.length + ' != ' + c.games.length);
    for (var i = 0; i < Math.min(got.length, c.games.length); i++) {
      h.expect(got[i].movetext === c.games[i].movetext,
        c.label + ' #' + (i + 1) + ': movetext ' + JSON.stringify(got[i].movetext)
          + ' != ' + JSON.stringify(c.games[i].movetext));
      h.expect(JSON.stringify(got[i].headers) === JSON.stringify(c.games[i].headers),
        c.label + ' #' + (i + 1) + ': headers ' + JSON.stringify(got[i].headers)
          + ' != ' + JSON.stringify(c.games[i].headers));
    }
  });
  record('pgn_split goldens', h.done('PgnSplit'));
})();

// ---- 5. eco — the bundled opening book --------------------------------------
(function () {
  var h = harness();
  var g = loadGolden('eco_lookup');
  var ecoPath = path.join(JS, 'eco-data.js');
  if (!fs.existsSync(ecoPath)) {
    console.error('MISSING web-demo/js/eco-data.js — run: php tools/eco/build_eco.php');
    process.exit(2);
  }
  var BOOK = require(ecoPath);

  function replay(sanList) {
    var pos = E.start();
    for (var i = 0; i < sanList.length; i++) {
      var m = E.parseSan(pos, sanList[i]);
      if (!m) return null;
      pos = E.makeMove(pos, m);
    }
    return pos;
  }

  g.lookups.forEach(function (c) {
    var pos = replay(c.sanMoves);
    if (!pos) { h.expect(false, c.eco + ' ' + c.name + ': line did not replay'); return; }
    h.expect(E.positionKey(pos) === c.key, c.eco + ' ' + c.name + ': position key mismatch');
    var entry = BOOK[c.key];
    h.expect(!!entry, c.eco + ' ' + c.name + ': key missing from the book');
    if (entry) {
      h.expect(entry[0] === c.eco && entry[1] === c.name,
        c.eco + ' ' + c.name + ': book says ' + JSON.stringify(entry));
    }
  });

  g.transpositions.forEach(function (t) {
    var a = replay(P.mainlineTokens(t.lineA));
    var b = replay(P.mainlineTokens(t.lineB));
    h.expect(a && b && E.positionKey(a) === E.positionKey(b),
      'transposition "' + t.lineA + '" == "' + t.lineB + '"');
    h.expect(a && E.positionKey(a) === t.keyA, 'transposition "' + t.lineA + '" matches the oracle key');
  });

  record('eco goldens', h.done('Eco'));
})();

// ---- Report -----------------------------------------------------------------
// Async suites finish on the event loop, so the report waits for them and then runs unchanged.
// Run them now — after every synchronous suite, so a check that yields to the event loop is timing
// the code and not this harness blocking it for the length of the ECO replay.
function settle() {
  return asyncSuites.reduce(function (chain, a) {
    return chain.then(function () {
      return a.mod.run().then(function (r) { record(a.name, r); });
    });
  }, Promise.resolve());
}

settle().then(function () {

var total = 0, failed = 0;
console.log('');
suites.forEach(function (s) {
  var r = s.result;
  total += r.passed;
  if (!r.ok) failed++;
  console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.summary.split('\n')[0]);
  if (!r.ok) r.failures.forEach(function (f) { console.log('          ✗ ' + f); });
});
console.log('');
console.log(String(new Array(62).join('─')));
if (failed === 0) {
  console.log('✅ JS GOLDENS GREEN — ' + total + ' assertions across ' + suites.length + ' suites');
  process.exit(0);
}
console.log('❌ ' + failed + ' of ' + suites.length + ' suites FAILED (' + total + ' assertions passed)');
process.exit(1);
});
