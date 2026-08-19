#!/usr/bin/env node
'use strict';
/**
 * swift_enum_payload_check — an enum case that carries a payload must be CONSTRUCTED with one.
 *
 * `Entitlement.Access` declares `case premium(trial: Bool)`. Writing `access = .premium` is a
 * type error: without the argument list that expression is a function, not an `Access`. It reads
 * perfectly, it survives `swift_lint.js` (which checks brackets and access levels) and
 * `swift_symbol_check.js` (which resolves `Namespace.member`, not enum construction), and it dies
 * only at `swift build` — on a Mac, hours later. That exact mistake shipped in this repo twice.
 *
 * The confusion is that `case .premium:` in a `switch`, and `if case .premium = x`, are BOTH legal
 * for a payload case — pattern matching may drop the payload. Construction may not. So this file
 * looks only at the unambiguous construction sites:
 *
 *     = .name        (assignment)
 *     return .name   (return)
 *
 * ...where `.name` is not followed by `(`.
 *
 * FALSE POSITIVES are designed out rather than tolerated: a name is only checked when EVERY
 * declaration of it in the tree carries a payload. `LoginAuthPhase.failed` has none while some
 * other enum's `.failed` might have one, so the name is ambiguous and is skipped. That makes the
 * check quiet and trustworthy instead of noisy and ignored.
 *
 * Run with NO arguments. Narrowing the file list would only hide the case you have not thought of.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = [
  path.join(ROOT, 'Sources', 'BiyaherongCoachCore'),
  path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI'),
];

/** Comment-strip, so prose about `= .premium` is never read as code. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function swiftFiles() {
  const out = [];
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.swift')) out.push(path.join(dir, f));
    }
  }
  return out;
}

const files = swiftFiles();
const sources = new Map();
for (const f of files) sources.set(f, code(fs.readFileSync(f, 'utf8')));

// ── 1. Collect every enum case, and whether it carries a payload ────────────────
// A case line may declare several: `case a, b(Int), c`.
const withPayload = new Set();
const withoutPayload = new Set();

for (const src of sources.values()) {
  for (const line of src.split('\n')) {
    const m = /^\s*(?:public |internal |private |fileprivate )?case\s+(.+)$/.exec(line);
    if (!m) continue;
    const body = m[1].trim();
    // `case .x:` / `case let …` / `case (…)` are PATTERNS inside a switch, not declarations.
    if (/^[.(]/.test(body) || /^let\b|^var\b/.test(body)) continue;
    if (body.endsWith(':')) continue;                 // a switch arm
    // Split on top-level commas so `case a, b(Int)` yields both.
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    for (const raw of parts) {
      const p = raw.trim();
      const nm = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(p);
      if (!nm) continue;
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(p)) withPayload.add(nm[1]);
      else withoutPayload.add(nm[1]);
    }
  }
}

// Only names that ALWAYS carry a payload are unambiguous enough to check.
const mustCarry = [...withPayload].filter((n) => !withoutPayload.has(n));

// ── 2. Find bare constructions of those names ──────────────────────────────────
const failures = [];
let checked = 0;

for (const [file, src] of sources) {
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    for (const name of mustCarry) {
      // `= .name` or `return .name`, not followed by `(` and not part of a longer identifier.
      const re = new RegExp('(=\\s*|return\\s+)\\.' + name + '(?![A-Za-z0-9_(])');
      if (!re.test(line)) continue;
      // `if case .name = x` and `guard case .name = x` are patterns, not constructions.
      if (/\b(if|guard|while)\s+case\b/.test(line)) continue;
      failures.push(`${path.relative(ROOT, file)}:${i + 1}  .${name} is built with no payload`
        + `\n      ${line.trim()}`);
    }
    checked++;
  });
}

// ── report ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log('\nSwiftEnumPayload: FAILED\n');
  for (const f of failures) console.log('  x ' + f);
  console.log(`\n${failures.length} bare construction(s) of a payload-carrying case.`);
  console.log('These do not compile. Add the argument list, e.g. `.premium(trial: false)`.\n');
  process.exit(1);
}

console.log(`\nSwiftEnumPayload: OK — ${mustCarry.length} payload-carrying case name(s) `
  + `checked across ${files.length} file(s), ${checked} lines`);
