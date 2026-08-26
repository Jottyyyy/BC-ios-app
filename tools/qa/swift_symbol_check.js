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
walk(path.join(ROOT, 'Engine', 'Sources'), all);   // the Stockfish adapter is a third package
walk(path.join(ROOT, 'ios'), all);
var targets = args.length ? args.map(function (f) { return f.replace(/\\/g, '/'); }) : all;

// ---- build the member table from EVERY file, always -----------------------------------------
//
// Never from `targets` alone: a narrowed run that also narrowed the table would report every
// unknown name as fine, which is the trap `swift_lint.js` fell into.
var members = {};   // Namespace -> Set(member)
var declared = {};  // Namespace -> true
// Where each TOP-LEVEL type is declared, so two of the same name in one module can be reported.
// Swift allows a nested `Foo.Bar` beside a top-level `Bar`; two top-level `Bar`s in one module is a
// redeclaration error. This check exists because exactly that shipped unnoticed: the generated
// `CoachMetrics.swift` declared `public enum CoachSelect` while `CoachSelect.swift` declared a view
// of the same name, and nothing on this checkout compiles Swift.
var topLevelSites = {};   // "module|Name" -> [file, ...]

function collect(rel) {
  var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Strip comments so a name mentioned in prose is not mistaken for a declaration or a use.
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  var re = /(?:^|\n)[ \t]*(?:public |internal |private |fileprivate |open |final |@\w+\s+)*(?:enum|struct|final class|class|actor|extension)\s+([A-Za-z_]\w*)[^\n{]*\{/g;
  var m;
  while ((m = re.exec(src)) !== null) {
    var ns = m[1];
    declared[ns] = true;
    // Column 0 means top level: the regex allows leading tabs and spaces for a nested
    // declaration, so the indentation is what separates the two cases.
    var indent = m[0].replace(/^\n/, '').match(/^[ \t]*/)[0];
    if (indent === '' && !/^extension\b/.test(m[0].trim())) {
      var mod = rel.indexOf('BiyaherongCoachCore') >= 0 ? 'Core' : 'UI';
      var key = mod + '|' + ns;
      (topLevelSites[key] || (topLevelSites[key] = [])).push(rel);
    }
    var set = members[ns] || (members[ns] = new Set());
    // The body, to its matching brace — nested types are collected under their own name by the
    // outer loop, so a shallow scan of this block is enough.
    var body = blockAt(src, re.lastIndex - 1);
    var mm;
    var member = /(?:^|\n)[ \t]*(?:public |internal |private(?:\(set\))? |fileprivate |open |static |final |class |lazy |weak |unowned |mutating |nonmutating |override |convenience |required |dynamic |nonisolated(?:\(unsafe\))? |@\w+(?:\([^)]*\))?\s+)*(?:let|var|func|case|typealias|init|subscript)\s+([A-Za-z_]\w*)/g;
    while ((mm = member.exec(body)) !== null) set.add(mm[1]);
    // SYNTHESIZED members. These are never written, so a shallow scan can never find them, and
    // without this every `Foo.allCases` reads as unresolved — a false alarm that teaches people to
    // skim past the real ones. Read off the inheritance clause rather than allow-listed by name.
    var inherits = m[0];
    if (/\bCaseIterable\b/.test(inherits)) set.add('allCases');
    if (/(?:^|\n)[ \t]*(?:[\w@()]+\s+)*enum\s+[A-Za-z_]\w*\s*:\s*(?:String|Int|Double|Character)\b/.test(inherits)) {
      set.add('rawValue');
    }
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
//
// This list is an ALLOW-LIST, which means a new module is invisible here until someone adds it —
// and invisible looks exactly like clean. `Stockfish[A-Z]\w*` was added when a deliberately bogus
// `StockfishBridge.thisMemberDoesNotExist` survived a full green run: the walk had been widened to
// `Engine/Sources` and the TYPE count rose, so everything read as covered while every reference in
// the new module was being skipped. Widening the walk is half the job; this line is the other half.
var CHECKED = /^(Puzzle[A-Z]\w*|Analysis[A-Z]\w*|Pairing[A-Z]\w*|Coach[A-Z]\w*|Login[A-Z]\w*|Home[A-Z]\w*|Paywall[A-Z]\w*|Premium[A-Z]\w*|Stockfish[A-Z]\w*|Video[A-Z]\w*|Entitlement|Theme|Haptics|DailyGoal|StreakEngine|TurboRun|Rating|PuzzleServing|PuzzleSelection|PuzzleSession|PuzzleProgress|PuzzleStats|PuzzleRush|DailyLimits|GameReview|ReviewAnnotator|MoveTree|OpeningBook|ChessNotation)$/;
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
// Scoped to the screen prefixes so SwiftUI and Foundation types are out of scope by construction
// rather than by an allowlist that would rot.
var PROJECT_TYPE = /\b((?:Puzzle|Analysis|Pairing|Coach|Login|Paywall|Premium)[A-Z]\w*)\s*\(/g;
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

// Two top-level types of one name in one module do not compile. Reported here rather than left to
// the Mac, because this checkout has no compiler to leave it to.
var dupes = 0;
Object.keys(topLevelSites).forEach(function (key) {
  var files = topLevelSites[key].filter(function (f, i, a) { return a.indexOf(f) === i; });
  if (files.length < 2) return;
  var parts = key.split('|');
  console.log('  DUPLICATE  ' + parts[1] + ' is declared at top level ' + files.length
              + ' times in module ' + parts[0] + ': ' + files.join(', '));
  dupes++;
});
bad += dupes;

console.log(bad ? '\nX ' + bad + ' unresolved reference(s); '
                  + checked + ' members and ' + typeChecked + ' types checked'
                : '\nOK — ' + checked + ' member references and ' + typeChecked
                  + ' project types all resolve');
process.exit(bad ? 1 : 0);
