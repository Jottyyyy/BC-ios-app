#!/usr/bin/env node
/*
 * swift_symbol_check.js — does every `Namespace.member` a Swift file names actually exist?
 *
 *     node tools/qa/swift_symbol_check.js                    # every tracked .swift file
 *     node tools/qa/swift_symbol_check.js path/a.swift …     # just these
 *
 * `swift` is not on PATH on this checkout, so a view that reads `PuzzleHub.cardTextGap` when the
 * constant is called `cardGap` is invisible until someone runs `swift build` on a Mac. That is the
 * single most common error when writing eleven screens blind against a 1,300-line metrics file:
 * not bad logic, just a name that does not exist.
 *
 * `swift_lint.js` matches brackets and `swift_source_keys.js` checks StyleSheet *lookups*; neither
 * knows whether a member reference resolves. This does.
 *
 * It is deliberately conservative — it only checks references to namespaces it can SEE declared,
 * and only members declared as `static let/var/func` or `case`. Anything it cannot resolve
 * confidently is skipped rather than guessed, because a false alarm here would train people to
 * ignore it.
 *
 * Exit 0 = clean.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.resolve(__dirname, '..', '..');

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.swift')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  });
  return out;
}

var args = process.argv.slice(2);
var all = walk(path.join(ROOT, 'Sources'), []);
walk(path.join(ROOT, 'DemoApp', 'Sources'), all);
walk(path.join(ROOT, 'ios'), all);
var targets = args.length ? args.map(function (f) { return f.replace(/\\/g, '/'); }) : all;

// ---- build the member table from EVERY file, always -----------------------------------------
//
// Never from `targets` alone: a narrowed run that also narrowed the table would report every
// unknown name as fine, which is the trap `swift_lint.js` fell into.
var members = {};   // Namespace -> Set(member)
var declared = {};  // Namespace -> true

function collect(rel) {
  var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Strip comments so a name mentioned in prose is not mistaken for a declaration or a use.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  var re = /(?:^|\n)[ \t]*(?:public |internal |private |fileprivate |open |final |@\w+\s+)*(?:enum|struct|final class|class|actor|extension)\s+([A-Za-z_]\w*)[^\n{]*\{/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var ns = m[1];
    declared[ns] = true;
    var set = members[ns] || (members[ns] = new Set());
    // The body, to its matching brace — nested types are collected under their own name by the
    // outer loop, so a shallow scan of this block is enough.
    var body = blockAt(src, re.lastIndex - 1);
    var mm;
    var member = /(?:^|\n)[ \t]*(?:public |internal |private(?:\(set\))? |fileprivate |open |static |final |class |lazy |weak |@\w+(?:\([^)]*\))?\s+)*(?:let|var|func|case|typealias|init|subscript)\s+([A-Za-z_]\w*)/g;
    while ((mm = member.exec(body)) !== null) set.add(mm[1]);
    // A NESTED type is reachable as `Outer.Inner`, so it counts as a member of its parent.
    // Without this, `PuzzleHub.Mode` and `DailyGoal.Status` read as unresolved — false alarms
    // that would teach people to skim past the real ones.
    var nested = /(?:^|\n)[ \t]*(?:public |internal |private |fileprivate |open |final |indirect |@\w+\s+)*(?:enum|struct|class|actor|typealias|protocol)\s+([A-Za-z_]\w*)/g;
    while ((mm = nested.exec(body)) !== null) set.add(mm[1]);
    // `case a, b, c` in an enum, and `case .foo` shorthand targets.
    var cases = /(?:^|\n)[ \t]*case\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/g;
    while ((mm = cases.exec(body)) !== null) {
      mm[1].split(',').forEach(function (c) { set.add(c.trim()); });
    }
  }
}

function blockAt(src, openIdx) {
  var depth = 0;
  for (var i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1);
}

all.forEach(collect);

// ---- check the references --------------------------------------------------------------------
//
// Only namespaces that look like a metrics/constant holder are checked. Instance values, locals
// and anything generic are out of scope: this is a name check, not a type checker.
var CHECKED = /^(Puzzle[A-Z]\w*|Analysis[A-Z]\w*|Theme|Haptics|DailyGoal|StreakEngine|TurboRun|Rating|PuzzleServing|PuzzleSelection|PuzzleSession|PuzzleProgress|PuzzleStats|PuzzleRush|DailyLimits)$/;
var SKIP_MEMBER = /^(self|init|Type|shared)$/;

var bad = 0, checked = 0;
targets.forEach(function (rel) {
  var full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { console.log('MISS  ' + rel); bad++; return; }
  var src = fs.readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  var re = /\b([A-Z]\w*)\.([a-zA-Z_]\w*)/g;
  var m, seen = {};
  while ((m = re.exec(src)) !== null) {
    var ns = m[1], mem = m[2];
    if (!CHECKED.test(ns) || !declared[ns] || SKIP_MEMBER.test(mem)) continue;
    var key = ns + '.' + mem;
    if (seen[key]) continue;
    seen[key] = true;
    checked++;
    if (!members[ns].has(mem)) {
      var line = src.slice(0, m.index).split('\n').length;
      console.log('  UNKNOWN ' + rel + ':' + line + '  ' + key);
      bad++;
    }
  }
});

// ---- project TYPES that are used but never declared -------------------------------------------
//
// The member check above cannot see `PuzzleFooScreen(store: …)` when `PuzzleFooScreen` does not
// exist at all — there is no namespace to look inside. That is the dominant hazard when writing a
// set of interdependent screens blind: one references another by a name that was never written,
// and nothing notices until a Mac.
//
// Scoped to `Puzzle*` and `Analysis*` so SwiftUI and Foundation types are out of scope by
// construction rather than by an allowlist that would rot.
var PROJECT_TYPE = /\b((?:Puzzle|Analysis)[A-Z]\w*)\s*\(/g;
var typeBad = 0, typeChecked = 0;
targets.forEach(function (rel) {
  var full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return;
  var src = fs.readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  var m, seen = {};
  PROJECT_TYPE.lastIndex = 0;
  while ((m = PROJECT_TYPE.exec(src)) !== null) {
    var t = m[1];
    if (seen[t]) continue;
    seen[t] = true;
    typeChecked++;
    if (!declared[t]) {
      var line = src.slice(0, m.index).split('\n').length;
      console.log('  UNDECLARED ' + rel + ':' + line + '  type ' + t + ' is used but never declared');
      typeBad++;
    }
  }
});
bad += typeBad;

console.log(bad ? '\nX ' + bad + ' unresolved reference(s); '
                  + checked + ' members and ' + typeChecked + ' types checked'
                : '\nOK — ' + checked + ' member references and ' + typeChecked
                  + ' project types all resolve');
process.exit(bad ? 1 : 0);
