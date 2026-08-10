#!/usr/bin/env node
/*
 * swift_lint.js — structural lint for Swift that cannot be compiled on this checkout.
 *
 *     node tools/qa/swift_lint.js                  # every tracked .swift file
 *     node tools/qa/swift_lint.js path/a.swift …   # just these
 *
 * `swift` is not on PATH on the Windows checkout, so most of the Swift in this repo is written
 * blind and compiled later by a teammate. This is NOT a compiler and makes no attempt to be one —
 * it catches the specific class of damage that writing blind actually produces: a bracket that
 * does not balance, usually from a bad edit rather than bad logic.
 *
 * It strips comments and string literals (including `\( … )` interpolation, which nests) and then
 * matches brackets, so it does not trip over a `}` inside a string. A handful of regex smell
 * checks follow. Anything subtler than that is the compiler's job.
 *
 * Exit 0 = clean.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var BACKSLASH = String.fromCharCode(92);

// Recursively collect .swift under a directory.
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.build') walk(p, out); }
    else if (e.name.slice(-6) === '.swift') out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  });
  return out;
}

var files = process.argv.slice(2);
if (!files.length) {
  files = walk(path.join(ROOT, 'Sources'), []);
  walk(path.join(ROOT, 'DemoApp', 'Sources'), files);
  walk(path.join(ROOT, 'ios'), files);
}

var bad = 0;

files.forEach(function (f) {
  var full = path.isAbsolute(f) ? f : path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log('MISS  ' + f); bad++; return; }
  var src = fs.readFileSync(full, 'utf8');
  var stack = [];
  var i = 0, line = 1;

  while (i < src.length) {
    var c = src[i], nx = src[i + 1];

    if (c === '\n') { line++; i++; continue; }

    if (c === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }

    if (c === '/' && nx === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2;
      continue;
    }

    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === BACKSLASH && src[i + 1] === '(') {
          // \( … ) interpolation — skip it whole, tracking nested parens
          i += 2;
          var d = 1;
          while (i < src.length && d > 0) {
            if (src[i] === '(') d++;
            else if (src[i] === ')') d--;
            else if (src[i] === '\n') line++;
            i++;
          }
          continue;
        }
        if (src[i] === BACKSLASH) { i += 2; continue; }
        if (src[i] === '\n') line++;
        i++;
      }
      i++;
      continue;
    }

    if (c === '{' || c === '(' || c === '[') stack.push({ c: c, line: line });
    if (c === '}' || c === ')' || c === ']') {
      var want = c === '}' ? '{' : (c === ')' ? '(' : '[');
      var top = stack.pop();
      if (!top || top.c !== want) {
        console.log('  ' + f + ':' + line + '  unbalanced "' + c + '"' +
          (top ? ' (opened "' + top.c + '" at line ' + top.line + ')' : ' with nothing open'));
        bad++;
      }
    }
    i++;
  }

  if (stack.length) {
    stack.slice(0, 5).forEach(function (s) {
      console.log('  ' + f + ':' + s.line + '  unclosed "' + s.c + '"');
    });
    bad += stack.length;
  }
  var n = src.split('\n').length;
  console.log((stack.length ? 'FAIL  ' : 'ok    ') + pad(f, 58) + n + ' lines');
});

function pad(s, w) { while (s.length < w) s += ' '; return s; }

// Cheap smell checks that do not need a parser.
var smells = [
  [/\bfunc\s+func\b/, 'duplicated func keyword'],
  [/\blet\s+let\b/, 'duplicated let keyword'],
  [/[^=!<>]==[^=]\s*$/m, 'line ending in a bare =='],
  [/,\s*\)/, 'trailing comma before a close paren'],
];
files.forEach(function (f) {
  var full = path.isAbsolute(f) ? f : path.join(ROOT, f);
  if (!fs.existsSync(full)) return;
  var src = fs.readFileSync(full, 'utf8');
  smells.forEach(function (pair) {
    if (pair[0].test(src)) { console.log('  SMELL ' + f + ': ' + pair[1]); bad++; }
  });
});

// ---- access-level check -----------------------------------------------------
// "Method cannot be declared public because its result uses an internal type" is a hard compile
// error, it is invisible to a bracket matcher, and it is exactly what a module written without a
// compiler accumulates. This found `PGN.tokenize` returning the internal `PGN.Token`.
//
// Scope: one Swift module at a time. Types are collected per module (a directory under Sources/ or
// DemoApp/Sources/), because `internal` means "visible within the module" — a type internal to
// BiyaherongCoachCore is genuinely invisible to BiyaherongUI, and vice versa.
//
// This is a heuristic, not a type checker: it only sees names, so a local variable that happens to
// share a name with an internal type is a false positive. In practice the name space is small
// enough that has not happened, and a false positive costs one rename.

function moduleOf(rel) {
  var m = /^(?:DemoApp\/)?Sources\/([^/]+)\//.exec(rel);
  return m ? m[1] : '(root)';
}

var TYPE_DECL = /(?:^|\n)([ \t]*)((?:(?:public|internal|private|fileprivate|open|final|indirect|@\w+)\s+)*)(struct|enum|class|actor|protocol|typealias)\s+([A-Za-z_]\w*)/g;
// A declaration's own access wins; without a modifier it is internal.
function accessOf(mods) {
  if (/\b(public|open)\b/.test(mods)) return 'public';
  if (/\b(private|fileprivate)\b/.test(mods)) return 'private';
  return 'internal';
}

var byModule = {};        // module -> { typeName -> access }
var sources = {};         // rel path -> text
files.forEach(function (f) {
  var full = path.isAbsolute(f) ? f : path.join(ROOT, f);
  if (!fs.existsSync(full)) return;
  var rel = path.relative(ROOT, full).replace(/\\/g, '/');
  var src = fs.readFileSync(full, 'utf8');
  sources[rel] = src;
  var mod = moduleOf(rel);
  var table = byModule[mod] || (byModule[mod] = {});
  var m;
  TYPE_DECL.lastIndex = 0;
  while ((m = TYPE_DECL.exec(src)) !== null) {
    var name = m[4], access = accessOf(m[2]);
    // A name declared public anywhere in the module stays public (extensions, re-declarations).
    if (table[name] !== 'public') table[name] = access;
  }
});

// Signatures whose visibility can exceed a type they name.
var PUBLIC_SIG = /(?:^|\n)[ \t]*(?:(?:@\w+(?:\([^)]*\))?|final|static|class|override|mutating|nonmutating)\s+)*(?:public|open)\s+(?:(?:static|final|class|mutating|nonmutating)\s+)*(func|var|let|init|subscript|typealias)\s*([A-Za-z_]\w*)?([^\n{=]*)/g;

Object.keys(sources).forEach(function (rel) {
  var table = byModule[moduleOf(rel)] || {};
  var src = sources[rel];
  var m;
  PUBLIC_SIG.lastIndex = 0;
  while ((m = PUBLIC_SIG.exec(src)) !== null) {
    var kind = m[1], name = m[2] || '', sig = m[3] || '';
    var seen = {};
    (sig.match(/\b[A-Z]\w*/g) || []).forEach(function (t) {
      if (seen[t] || table[t] !== 'internal') return;
      seen[t] = true;
      var line = src.slice(0, m.index).split('\n').length + 1;
      console.log('  ACCESS ' + rel + ':' + line + '  public ' + kind + ' ' + name +
        ' exposes internal type "' + t + '"');
      bad++;
    });
  }
});

console.log(bad ? '\nX ' + bad + ' structural problem(s) in ' + files.length + ' file(s)'
                : '\nOK — ' + files.length + ' file(s) structurally sound');
process.exit(bad ? 1 : 0);
