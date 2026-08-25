#!/usr/bin/env node
/*
 * stockfish_vendor_check.js — the vendored Stockfish tree is still the thing we think it is.
 *
 *     node tools/qa/stockfish_vendor_check.js
 *
 * ## Why this file exists
 *
 * `Engine/Sources/CStockfish/sf/` is 70,000 lines of somebody else's C++, and **nothing on this
 * checkout can compile a single line of it** (`CLAUDE.md`: Windows, no Xcode, no Swift). The first
 * time anyone finds out whether this integration works is on a Mac. Everything that can be checked
 * without a compiler is therefore checked here, and the checks are chosen for one property: each
 * one guards a failure that produces a BUILD THAT LOOKS FINE.
 *
 *   • **The patch.** SwiftPM never runs Stockfish's Makefile, and Stockfish auto-detects none of the
 *     switches that Makefile would set — `USE_NEON` is read at `nnue/simd.h:34`, never `__ARM_NEON`.
 *     One `#include "../sfconfig.h"` in `types.h` supplies them. Lose it in an upgrade and the app
 *     compiles, links, ships, plays correct chess, and evaluates several times slower with nothing
 *     anywhere reporting a problem.
 *
 *   • **The net names.** `evaluate.h` hardcodes the two nets this Stockfish expects.
 *     `Network::verify` compares what loaded against what was asked for and, on a mismatch, calls
 *     `exit(EXIT_FAILURE)` — in an iOS app, the process vanishing mid-tap. `biya_sf_start` turns
 *     that into an error code, but only if it is reached; upgrading Stockfish without swapping the
 *     nets is the way to reach it.
 *
 *   • **The 100 MiB wall.** GitHub refuses a file over 100 MiB outright. Stockfish 18's big net is
 *     103.9 MiB and 17.1's is 71.4 MiB, which is the entire reason this repository vendors 17.1 —
 *     a fact that lives nowhere in the source and would be rediscovered the hard way, at push time,
 *     by whoever upgrades next.
 *
 *   • **The nets are what they claim.** Stockfish names a net for the first 12 hex digits of its own
 *     SHA-256 (`evaluate.h:32`), so the filename is a checksum. A truncated or half-written download
 *     is caught here rather than at `verify_networks` on a device.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE = path.join(ROOT, 'Engine');
const SF = path.join(ENGINE, 'Sources', 'CStockfish', 'sf');
const NETS = path.join(ENGINE, 'Sources', 'StockfishEngine', 'Nets');

/** GitHub rejects any single file above this. Not a style rule — a hard push failure. */
const GITHUB_FILE_LIMIT = 100 * 1024 * 1024;

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

const read = (p) => fs.readFileSync(p, 'utf8');

// -- 1. The tree is there ------------------------------------------------------------------------

expect(fs.existsSync(SF), 'Engine/Sources/CStockfish/sf exists');
expect(fs.existsSync(path.join(SF, 'evaluate.h')), 'sf/evaluate.h exists');
expect(fs.existsSync(path.join(SF, 'Copying.txt')),
  'sf/Copying.txt is vendored — GPLv3 requires the licence text travel with the source');
expect(fs.existsSync(path.join(SF, 'AUTHORS')), 'sf/AUTHORS is vendored');

// -- 2. The one patch, and only the one ----------------------------------------------------------

const types = read(path.join(SF, 'types.h'));
expect(/#include\s+"\.\.\/sfconfig\.h"/.test(types),
  'sf/types.h includes ../sfconfig.h — WITHOUT THIS THE NNUE RUNS SCALAR AND NOTHING FAILS');
expect(/BIYAHERONG PATCH/.test(types), 'the patch is labelled in sf/types.h so it survives a merge');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const patched = walk(SF).filter((f) => /\.(h|cpp)$/.test(f) && /BIYAHERONG PATCH/.test(read(f)));
expect(patched.length === 1,
  `exactly one vendored file is patched, found ${patched.length}: `
  + patched.map((f) => path.relative(SF, f)).join(', ')
  + ' — every extra edit is one an upgrade has to rediscover');

// -- 3. sfconfig.h sets what the Makefile would ---------------------------------------------------

const config = read(path.join(ENGINE, 'Sources', 'CStockfish', 'sfconfig.h'));
expect(/#define\s+USE_NEON\s+8/.test(config),
  'sfconfig.h defines USE_NEON as 8 — simd.h tests `USE_NEON >= 8`, so a bare #define picks the '
  + '32-bit paths');
expect(/__aarch64__/.test(config), 'sfconfig.h keys NEON off __aarch64__, not off a platform');
expect(/#define\s+IS_64BIT/.test(config),
  'sfconfig.h defines IS_64BIT — types.h self-defines it only for MSVC on Windows');
expect(/#define\s+NNUE_EMBEDDING_OFF/.test(config),
  'sfconfig.h defines NNUE_EMBEDDING_OFF — otherwise network.cpp tries to incbin a 71 MB file');
expect(/#define\s+USE_POPCNT/.test(config), 'sfconfig.h defines USE_POPCNT');

// -- 4. The nets are the nets this Stockfish asks for ---------------------------------------------

const evaluateH = read(path.join(SF, 'evaluate.h'));
const bigName = (evaluateH.match(/EvalFileDefaultNameBig\s+"([^"]+)"/) || [])[1];
const smallName = (evaluateH.match(/EvalFileDefaultNameSmall\s+"([^"]+)"/) || [])[1];

expect(!!bigName && !!smallName, 'evaluate.h names both default nets');

for (const [label, name] of [['big', bigName], ['small', smallName]]) {
  if (!name) continue;
  const file = path.join(NETS, name);
  if (!fs.existsSync(file)) {
    failures.push(`the ${label} net ${name} named by evaluate.h is NOT in Engine/Sources/`
      + 'StockfishEngine/Nets — Stockfish would exit(EXIT_FAILURE) on the first search');
    continue;
  }
  passed++;

  const bytes = fs.readFileSync(file);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const claimed = name.replace(/^nn-/, '').replace(/\.nnue$/, '');
  expect(digest.startsWith(claimed),
    `${name} hashes to ${digest.slice(0, 12)} — Stockfish names a net for the first 12 digits of `
    + 'its own SHA-256, so this file is truncated or is not that net');

  expect(bytes.length < GITHUB_FILE_LIMIT,
    `${name} is ${(bytes.length / 1048576).toFixed(1)} MiB and GitHub refuses anything over 100 MiB. `
    + 'This is why 17.1 is vendored rather than 18 — see the header of this file before "fixing" it '
    + 'by upgrading.');
}

// -- 5. Nothing else claims to be an entry point --------------------------------------------------

const pkg = read(path.join(ENGINE, 'Package.swift'));
expect(/"sf\/main\.cpp"/.test(pkg),
  'Package.swift excludes sf/main.cpp — it defines main(), and an app already has one');
expect(/\.gnucxx17/.test(pkg), 'Package.swift builds Stockfish as gnu++17, as its own Makefile does');
expect(!/unsafeFlags/.test(pkg),
  'Package.swift uses no unsafeFlags — SwiftPM bans them in a package consumed as a dependency, and '
  + 'nothing here can compile-test the fallout');

const mains = walk(SF)
  .filter((f) => f.endsWith('.cpp'))
  .filter((f) => /^\s*int\s+main\s*\(/m.test(read(f)))
  .map((f) => path.relative(SF, f));
expect(mains.length === 1 && mains[0].replace(/\\/g, '/') === 'main.cpp',
  `exactly one vendored file defines main(), found: ${mains.join(', ') || 'none'}`);

// -- 6. The public header stayed C ----------------------------------------------------------------

const header = read(path.join(ENGINE, 'Sources', 'CStockfish', 'include', 'biya_stockfish.h'));
expect(/extern "C"/.test(header), 'the public header wraps its declarations in extern "C"');

// Comments stripped first. The rule is about DECLARATIONS, and the header's own paragraph
// explaining "no class, no std::, no templates" matched the rule that forbids them — a gate that
// fails on its own documentation teaches people to delete the documentation.
const headerCode = header
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');
expect(!/\bstd::|\bclass\b|\btemplate\b/.test(headerCode),
  'the public header declares no C++ — Swift imports it as a C module, and one std:: in it forces '
  + 'the whole package onto C++ interop');

// -- 7. GPL ---------------------------------------------------------------------------------------

const licence = read(path.join(ROOT, 'LICENSE'));
expect(/GNU GENERAL PUBLIC LICENSE/i.test(licence),
  'LICENSE is the GPL — vendoring Stockfish makes the combined work GPLv3 and there is no version '
  + 'of this that is optional');

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `StockfishVendor: ${passed} checks OK (${bigName}, ${smallName})`
    : `StockfishVendor: ${failures.length} FAILED\n` + failures.map((f) => '  x ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { run: () => result, selfTest: () => result };
