#!/usr/bin/env node
/*
 * replay_stockfish.js — the Swift Stockfish adapter says what the JS twin says.
 *
 *     node tools/qa/replay_stockfish.js
 *
 * ## What this can and cannot prove
 *
 * It cannot run Stockfish. Nothing on this checkout can: no Swift compiler, no C++ toolchain, no
 * Xcode (`CLAUDE.md`). What it CAN do is the thing this repository has always done in place of a
 * compiler — take the layer where the judgement calls live, mirror it in JavaScript, run the mirror
 * against real vectors, and then assert that the Swift is structurally the same program.
 *
 * That split is why `StockfishBridge.swift` exists at all. The C shim marshals; every decision that
 * could be wrong in a way a reader would nod past — the side-to-move-to-White flip, `mate 0`, which
 * of two reports for a rank survives, when an iteration counts as finished, where a PV stops — was
 * pulled up into Swift so it could be mirrored by `tools/qa/stockfish_bridge_twin.js` and executed
 * here. Section 1 runs the twin. Sections 2 onward pin the Swift to it.
 *
 * `tools/qa/stockfish_vendor_check.js` covers the other half: that the vendored C++ tree, its one
 * patch, and the two network files are still what the build assumes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BRIDGE_JS = path.join(__dirname, 'stockfish_bridge_twin.js');
const BRIDGE_SWIFT = path.join(ROOT, 'Engine', 'Sources', 'StockfishEngine', 'StockfishBridge.swift');
const ENGINE_SWIFT = path.join(ROOT, 'Engine', 'Sources', 'StockfishEngine', 'StockfishEngine.swift');
const LOCAL_SWIFT = path.join(ROOT, 'Sources', 'BiyaherongCoachCore', 'LocalEngine.swift');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

const read = (p) => fs.readFileSync(p, 'utf8');
const bridge = read(BRIDGE_SWIFT);
const engine = read(ENGINE_SWIFT);

// -- 1. The twin actually runs --------------------------------------------------------------------

const twin = require(BRIDGE_JS).selfTest();
passed += twin.passed;
if (!twin.ok) failures.push(...twin.failures.map((f) => 'stockfish_bridge_twin.js: ' + f));
expect(twin.passed >= 40, `the JS twin ran ${twin.passed} assertions — it must not shrink`);

// -- 2. The PV limit is one number in three places ------------------------------------------------

const swiftPvLimit = (bridge.match(/pvLimit\s*=\s*(\d+)/) || [])[1];
const jsPvLimit = (read(BRIDGE_JS).match(/PV_LIMIT\s*=\s*(\d+)/) || [])[1];
const localLimit = (read(LOCAL_SWIFT).match(/pvExtendLimit\s*=\s*(\d+)/) || [])[1];

expect(swiftPvLimit === jsPvLimit,
  `pvLimit is ${swiftPvLimit} in Swift and ${jsPvLimit} in JS`);
expect(swiftPvLimit === localLimit,
  `StockfishBridge.pvLimit (${swiftPvLimit}) must equal LocalEngine.pvExtendLimit (${localLimit}) — `
  + 'the panel is entitled to the same line length whichever engine produced it');

// -- 3. The sign flip, and mate 0 -----------------------------------------------------------------

expect(/sideToMove\s*==\s*\.white\s*\?\s*1\s*:\s*-1/.test(bridge),
  'whiteRelative derives its sign from sideToMove == .white');
expect(/if\s+value\s*==\s*0\s*\{\s*return\s+\.mate\(-sign\)/.test(bridge),
  'whiteRelative maps `mate 0` to a mate AGAINST the side to move — a zero would break '
  + "EngineScore.mate's documented never-zero invariant");
expect(/return\s+\.mate\(value\s*\*\s*sign\)/.test(bridge), 'a mate score is flipped, not just cp');
expect(/return\s+\.cp\(value\s*\*\s*sign\)/.test(bridge), 'a cp score is flipped');

// The twin proves the behaviour; this proves nobody quietly deleted the flip on one side.
const flips = [
  [false, 34, 'white', 34], [false, 34, 'black', -34],
  [true, 3, 'white', 3], [true, 3, 'black', -3],
  [true, 0, 'white', -1], [true, 0, 'black', 1],
];
const JS = require(BRIDGE_JS);
const E = require(path.join(ROOT, 'web-demo', 'js', 'engine.js'));
for (const [isMate, value, side, want] of flips) {
  const got = JS.whiteRelative(isMate, value, side === 'white' ? E.WHITE : E.BLACK).value;
  expect(got === want, `whiteRelative(${isMate}, ${value}, ${side}) = ${got}, want ${want}`);
}

// -- 4. The merge rule ----------------------------------------------------------------------------

expect(/if\s+!line\.isBound\s*\|\|\s*existing\.isBound\s*\{\s*store\[line\.multiPV\]\s*=\s*line/
  .test(bridge),
  'merge keeps an exact score over a bound — the guard against the eval bar lurching on every '
  + 'aspiration re-search');
expect(/isBound:\s*Bool\s*\{\s*isLowerBound\s*\|\|\s*isUpperBound\s*\}/.test(bridge),
  'isBound is either bound, not just the lower one');

// -- 5. Completeness ------------------------------------------------------------------------------

expect(/store\.count\s*>=\s*min\(multiPV,\s*max\(legalMoves,\s*1\)\)/.test(bridge),
  'isComplete bounds by legal moves AND floors that at 1 — otherwise a position with one legal '
  + 'move can never complete a 3-line search');

// -- 6. Ranks are 0-based -------------------------------------------------------------------------

expect(/rank:\s*raw\.multiPV\s*-\s*1/.test(bridge),
  "EngineLine.rank is UCI's multipv minus one — off by one here shows the second-best move first");
expect(/sideToMove:\s*position\.sideToMove/.test(bridge),
  'the snapshot flips using the position it describes, not a captured side');

// -- 7. Limits ------------------------------------------------------------------------------------

expect(/min\(max\(limits\.maxDepth,\s*1\),\s*245\)/.test(bridge), 'depth clamps to 1...245');
expect(/min\(max\(limits\.multiPV,\s*1\),\s*8\)/.test(bridge), 'multiPV clamps to 1...8 in Swift');

const shim = read(path.join(ROOT, 'Engine', 'Sources', 'CStockfish', 'biya_stockfish.cpp'));
expect(/std::min\(std::max\(multi_pv,\s*1\),\s*8\)/.test(shim),
  'the C layer clamps multiPV to the SAME 1...8 — two different ceilings means the snapshot expects '
  + 'lines the engine was never asked for, and isComplete never fires');
expect(/std::min\(depth,\s*245\)/.test(shim), 'the C layer clamps depth to 245 (MAX_PLY is 246)');

// -- 8. The engine's own contract -----------------------------------------------------------------

expect(/terminalOutcome\(historyKeys:\s*historyKeys\)/.test(engine),
  'StockfishEngine short-circuits a finished game before searching, as LocalEngine does');
expect(/identifier\s*=\s*"stockfish-17\.1"/.test(engine),
  'the identifier names the engine AND its version, so a cached review from another one is not '
  + 'mixed with these numbers');

const localId = (read(LOCAL_SWIFT).match(/identifier\s*=\s*"([^"]+)"/) || [])[1];
const sfId = (engine.match(/identifier\s*=\s*"([^"]+)"/) || [])[1];
expect(localId !== sfId, `the two engines must not share an identifier (both "${sfId}")`);

expect(/withoutActuallyEscaping\(shouldCancel\)/.test(engine)
  && /withoutActuallyEscaping\(onProgress\)/.test(engine),
  'both caller closures are bridged with withoutActuallyEscaping — the protocol keeps them '
  + 'non-escaping and the C callback needs them to survive the call');

expect(/isFinal:\s*false/.test(engine), 'progress snapshots are not final');
expect(/StockfishBridge\.isComplete\(store:/.test(engine),
  'the engine publishes an iteration only when it completed — a half-reported depth is a snapshot '
  + 'that never existed');

// -- 9. No UI, and no second network ---------------------------------------------------------------

for (const file of [bridge, engine]) {
  expect(!/import\s+(UIKit|SwiftUI|AppKit)/.test(file),
    'the engine package imports no UI framework');
}
expect(!/URLSession|URLRequest/.test(bridge + engine + shim),
  'the engine package opens no connection — Stockfish is embedded precisely so it does not have to');

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `StockfishReplay: ${passed} assertions OK (JS twin ${twin.passed})`
    : `StockfishReplay: ${failures.length} FAILED\n` + failures.map((f) => '  x ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { run: () => result, selfTest: () => result };
