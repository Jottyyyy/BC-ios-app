#!/usr/bin/env node
/*
 * canonical_library_check.js — the two canonical library documents must stay byte-identical.
 *
 *     node tools/qa/canonical_library_check.js      # standalone; exit 0 means green
 *     (also runs as a suite inside tools/qa/js_goldens.js)
 *
 * `web-demo/js/analysis-store.js` and `ParityRunner`'s `analysis_store` group each hardcode the same
 * canonical library JSON, and each asserts that it decodes to the same records. That is the
 * cross-language contract for persistence — but it only means anything if the two strings really are
 * the same string.
 *
 * Nothing else would catch a drift: each side would happily keep asserting against its own copy, and
 * the suites would stay green while the contract quietly evaporated. So this reads the Swift literal
 * out of `main.swift`, reconstructs it the way the compiler would, and compares.
 *
 * Swift multiline literals need two things undone to recover the runtime string:
 *   - the closing delimiter's indentation is stripped from every line;
 *   - a trailing `\` joins a line to the next with no newline.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..', '..');
var SWIFT = path.join(ROOT, 'Sources', 'ParityRunner', 'main.swift');
var JS = path.join(ROOT, 'web-demo', 'js', 'analysis-store.js');

/** Recover the runtime value of `let <name> = """ … """` from Swift source. */
function swiftMultiline(source, name) {
  var start = new RegExp('let\\s+' + name + '\\s*=\\s*"""\\r?\\n');
  var m = start.exec(source);
  if (!m) return null;
  var rest = source.slice(m.index + m[0].length);
  var endAt = rest.indexOf('"""');
  if (endAt < 0) return null;

  var body = rest.slice(0, endAt);
  // The closing delimiter's own indentation is what gets stripped from every line.
  var closingIndent = /(^|\n)([ \t]*)$/.exec(body);
  var indent = closingIndent ? closingIndent[2] : '';
  var lines = body.replace(/\r?\n[ \t]*$/, '').split(/\r?\n/);
  var stripped = lines.map(function (l) {
    return l.indexOf(indent) === 0 ? l.slice(indent.length) : l.replace(/^[ \t]+/, '');
  });
  // A trailing backslash means "continue on the same line".
  var out = '';
  stripped.forEach(function (l, i) {
    if (/\\$/.test(l)) out += l.slice(0, -1);
    else out += l + (i === stripped.length - 1 ? '' : '\n');
  });
  return out;
}

function selfTest() {
  var passed = 0, failures = [];
  function expect(cond, what) { cond ? passed++ : failures.push(what); }

  var swiftSrc = fs.readFileSync(SWIFT, 'utf8');
  var swiftDoc = swiftMultiline(swiftSrc, 'canonical');
  expect(swiftDoc !== null, 'the canonical literal is present in ParityRunner/main.swift');

  var jsDoc = require(JS).CANONICAL;
  expect(typeof jsDoc === 'string' && jsDoc.length > 0, 'analysis-store.js exports CANONICAL');

  if (swiftDoc && jsDoc) {
    if (swiftDoc === jsDoc) {
      passed++;
    } else {
      var at = 0;
      while (at < swiftDoc.length && at < jsDoc.length && swiftDoc[at] === jsDoc[at]) at++;
      failures.push('the two canonical documents DIFFER at offset ' + at
        + '\n      swift: ' + JSON.stringify(swiftDoc.slice(Math.max(0, at - 30), at + 40))
        + '\n      js:    ' + JSON.stringify(jsDoc.slice(Math.max(0, at - 30), at + 40)));
    }
    // Both must be valid JSON, or the "each decodes it" claim is vacuous on one side.
    [['swift', swiftDoc], ['js', jsDoc]].forEach(function (pair) {
      var ok = true, msg = '';
      try { JSON.parse(pair[1]); } catch (e) { ok = false; msg = e.message; }
      expect(ok, 'the ' + pair[0] + ' canonical document is valid JSON: ' + msg);
    });
    // And it must actually exercise something: an empty library would make every claim trivial.
    var doc = null;
    try { doc = JSON.parse(jsDoc); } catch (e) { /* reported above */ }
    if (doc) {
      expect(doc.sessions && doc.sessions.length >= 2, 'it carries at least two sessions');
      expect(doc.folders && doc.folders.length >= 2, 'and at least two folders');
      expect(doc.folders.some(function (f) { return f.isDefault; }), 'including a default one');
      expect(doc.sessions.some(function (s) { return s.folderId === null; }), 'and an unfiled game');
      expect(doc.sessions.some(function (s) { return s.folderId !== null; }), 'and a filed one');
      expect(doc.sessions.some(function (s) { return s.notes === null; }),
             'with a null somewhere, so null handling is exercised');
    }
  }

  return {
    passed: passed, failures: failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? 'CanonicalLibrary: ' + passed + ' assertions passed'
      : 'CanonicalLibrary: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
        + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
  };
}

module.exports = { selfTest: selfTest, swiftMultiline: swiftMultiline };

if (require.main === module) {
  var r = selfTest();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
