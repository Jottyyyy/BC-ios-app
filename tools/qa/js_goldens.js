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
var A = require(path.join(JS, 'analysis-engine.js'));
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
var HOST = require(path.join(JS, 'engine-host.js'));
var BUDGET = require(path.join(__dirname, 'engine_budget_check.js'));
var WORKER = require(path.join(__dirname, 'worker_protocol_check.js'));

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
record('analysis-engine.selfTest', A.selfTest());
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
// Where the search runs, and the frame budget it must respect when it runs in-thread.
record('engine-host.selfTest', HOST.selfTest());
record('engine frame budget', BUDGET.selfTest());
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
