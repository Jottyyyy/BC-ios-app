#!/usr/bin/env node
/*
 * gen_pairing_metrics.js — emit the Pairing Manager's presentation constants in BOTH languages from
 * one source.
 *
 *     node tools/metrics/gen_pairing_metrics.js
 *     -> web-demo/js/pairing-metrics.js          (the geometry region only)
 *     -> DemoApp/Sources/BiyaherongUI/PairingMetrics.swift   (whole file)
 *     -> DemoApp/Sources/BiyaherongUI/PairingStrings.swift   (whole file)
 *
 * ## Why this exists
 *
 * The puzzle layer hand-writes its Swift constants and relies on `replay_puzzle_core.js` to notice
 * when they drift from the JS. That works, but it makes the replay the *only* thing standing between
 * a typo and a wrong screen, and it means the two languages are two transcriptions of a third thing
 * rather than two renderings of one.
 *
 * Here both come out of `tournament_styles.json`, which is itself re-derived from the React Native
 * source by `extract_tournament_styles.js` on every run. So `replay_pairing.js` becomes a redundancy
 * check — a second opinion — instead of the load-bearing guard. That is the difference between
 * "EXTRACT, DON'T TRANSCRIBE" as a slogan and as a property of the build.
 *
 * ## Strings
 *
 * `PairingStrings.swift` is emitted too, but from a different source: the JS `STR` table rather than
 * the extraction, because copy comes from spec 1.11 and there is nothing in the RN styles to derive
 * it from. Plain constants are copied across verbatim, so the two languages cannot hold different
 * COPY — not merely different keys. The 17 interpolating strings are shaped by a table in this file,
 * which fails loudly if the JS grows or loses one.
 *
 *     -> DemoApp/Sources/BiyaherongUI/PairingStrings.swift
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(__dirname, 'tournament_styles.json');
const JS_OUT = path.join(ROOT, 'web-demo', 'js', 'pairing-metrics.js');
const SWIFT_OUT = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'PairingMetrics.swift');

const styles = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// The four StyleSheets, and the Swift enum each becomes.
const BLOCKS = [
  { js: 'LIST',   swift: 'PairingList',   get: (s) => s.screens.list.styles },
  { js: 'CREATE', swift: 'PairingCreate', get: (s) => s.screens.create.styles },
  { js: 'DETAIL', swift: 'PairingDetail', get: (s) => s.screens.detail.styles },
  { js: 'SHARE',  swift: 'PairingShare',  get: (s) => s.screens.detail.shareStyles },
];

// ---- JavaScript -------------------------------------------------------------------------------

function jsValue(v) {
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null) return 'null';
  return JSON.stringify(v);
}

function jsBlock(name, sheet) {
  const lines = ['  var ' + name + ' = {'];
  for (const [block, props] of Object.entries(sheet)) {
    const pairs = Object.entries(props).map(([p, v]) => p + ': ' + jsValue(v)).join(', ');
    lines.push('      ' + block + ': { ' + pairs + ' },');
  }
  lines.push('    };');
  return lines.join('\n');
}

// ---- Swift ------------------------------------------------------------------------------------

/** `cardStats` + `paddingHorizontal` -> `cardStatsPaddingHorizontal`. */
function member(block, prop) {
  return block + prop.charAt(0).toUpperCase() + prop.slice(1);
}

/**
 * A React Native colour string as a SwiftUI `Color`.
 *
 * `rgba(253,176,34,0.08)` is the form the source uses for every translucent border and tint, and
 * `Theme.c` already takes an alpha, so nothing is lost. A colour this cannot parse is FATAL rather
 * than passed through as a string: a `Color` silently typed as `String` would not compile on the
 * Mac, and finding that out there is the whole failure mode this repo is built to avoid.
 */
function swiftColor(v, where) {
  if (v === 'transparent') return 'Color.clear';
  let m = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (m) return 'Theme.c(0x' + m[1].toUpperCase() + ')';
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) {
    const hex = [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).toUpperCase().padStart(2, '0')).join('');
    const a = m[4] === undefined ? null : Number(m[4]);
    return a === null || a === 1 ? 'Theme.c(0x' + hex + ')' : 'Theme.c(0x' + hex + ', ' + a + ')';
  }
  console.error('FATAL: cannot express colour ' + JSON.stringify(v) + ' at ' + where);
  process.exit(1);
}

const isColour = (v) => typeof v === 'string'
  && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/.test(v) || v === 'transparent');

function swiftDecl(name, v, where) {
  if (typeof v === 'number') return '    public static let ' + name + ': CGFloat = ' + v;
  if (isColour(v)) return '    public static let ' + name + ' = ' + swiftColor(v, where);
  if (typeof v === 'string') {
    return '    public static let ' + name + ' = "' + v.replace(/"/g, '\\"') + '"';
  }
  return null;                      // objects (shadowOffset) are split into their components below
}

function swiftEnum(name, sheet, doc) {
  const seen = new Set();
  const out = ['/// ' + doc, 'public enum ' + name + ' {'];
  for (const [block, props] of Object.entries(sheet)) {
    for (const [prop, v] of Object.entries(props)) {
      const where = name + '.' + block + '.' + prop;
      if (v !== null && typeof v === 'object') {
        // `shadowOffset: {width, height}` becomes two scalars, because SwiftUI's `.shadow` takes
        // x and y separately and a CGSize here would be the only compound value in the file.
        for (const [k, n] of Object.entries(v)) {
          const nm = member(block, prop + k.charAt(0).toUpperCase() + k.slice(1));
          if (seen.has(nm)) { console.error('FATAL: duplicate member ' + nm); process.exit(1); }
          seen.add(nm);
          out.push('    public static let ' + nm + ': CGFloat = ' + n);
        }
        continue;
      }
      const nm = member(block, prop);
      if (seen.has(nm)) { console.error('FATAL: duplicate member ' + nm); process.exit(1); }
      seen.add(nm);
      const line = swiftDecl(nm, v, where);
      if (line) out.push(line);
    }
  }
  out.push('}');
  return { text: out.join('\n'), count: seen.size };
}

// The blocks that are not StyleSheets: the extracted colour maps, the inline column widths, and the
// handful of invented values. Kept in step with `pairing-metrics.js` by `replay_pairing.js`.
function extras() {
  const cm = styles.screens.list.colorMaps;
  const detailMap = styles.screens.detail.colorMaps.typeColor;
  if (cm.getTypeColor[0].value !== detailMap[0].value
      || cm.getTypeColor[1].value !== detailMap[1].value) {
    console.error('FATAL: the list and detail screens disagree about the type colours');
    process.exit(1);
  }
  const inline = styles.screens.detail.inlineStyles;
  const widths = Object.keys(inline)
    .filter((k) => /^Text\[\d+\]\.width$/.test(k))
    .map((k) => inline[k].terms[0].value);
  const need = (w, what) => {
    if (widths.indexOf(w) < 0) {
      console.error('FATAL: no inline column width of ' + w + ' in the source (' + what + ')');
      process.exit(1);
    }
    return w;
  };

  // The white piece dot is an INLINE style, not a StyleSheet entry — `colorDot` carries only the
  // geometry and the fill is applied per side at the call site. Read it out rather than retyping it.
  const dotFill = Object.keys(inline)
    .filter((k) => /\.backgroundColor$/.test(k))
    .map((k) => inline[k].text.replace(/'/g, ''))
    .filter((v) => /^#[0-9A-Fa-f]{6}$/.test(v) && v.toUpperCase() === '#FAFAFA')[0];
  if (!dotFill) {
    console.error('FATAL: no #FAFAFA inline fill in the source for the white piece dot');
    process.exit(1);
  }

  return `
/// The type and status colours, extracted from the source's own \`condition -> literal\` maps.
///
/// Ordered in the source, and the order is the semantics: any status that is neither ongoing nor
/// finished is gold. The detail screen keeps its own copy of the type mapping as a plain ternary
/// (\`[id].tsx:400\`); the generator asserts the two agree rather than assuming it.
public enum PairingPalette {
    public static let swiss = ${swiftColor(cm.getTypeColor[0].value, 'swiss')}
    public static let roundRobin = ${swiftColor(cm.getTypeColor[1].value, 'roundRobin')}
    public static let ongoing = ${swiftColor(cm.getStatusColor[0].value, 'ongoing')}
    public static let finished = ${swiftColor(cm.getStatusColor[1].value, 'finished')}
    public static let setup = ${swiftColor(cm.getStatusColor[2].value, 'setup')}

    /// The badge fill is the accent at 0x22 — hex alpha by string concatenation in the source, not
    /// a rounded percentage. 0x22/255 is 13.33 %, which the spec writes as "13 % alpha".
    public static let tintByte: Double = ${(0x22 / 255).toFixed(6)}

    public static func type(_ isSwiss: Bool) -> Color { isSwiss ? swiss : roundRobin }

    /// The fallback stays last, exactly as the source writes it: an unrecognised status is gold
    /// rather than nil, so a corrupt row still draws a visible dot.
    public static func status(_ s: String) -> Color {
        if s == "ongoing" { return ongoing }
        if s == "finished" { return finished }
        return setup
    }
}

/// The standings column widths, which are INLINE styles rather than StyleSheet entries.
///
/// \`[id].tsx\` writes them as \`style={[styles.standingsVal, { width: 30 }]}\`, so they never reach a
/// StyleSheet and the block walker cannot see them — \`standingsVal.width\` is 42 for every column,
/// which is wrong for five of the six. The generator reads them out of \`inlineStyles\` and fails if
/// any is absent. \`sb\` is invented: spec 1.4 adds a Sonneborn-Berger column the RN table never had,
/// and it mirrors the Buchholz one beside it.
public enum PairingCols {
    public static let rank: CGFloat = ${need(28, 'rank')}
    public static let pts: CGFloat = ${need(42, 'pts')}
    public static let wdl: CGFloat = ${need(30, 'W/D/L')}
    public static let bch: CGFloat = ${need(36, 'Buchholz')}
    public static let sb: CGFloat = ${need(36, 'SB, mirroring Buchholz')}
}

/// Values with no counterpart in the React Native source. Recorded in PORTING_NOTES.md.
public enum PairingLimits {
    public static let nameMax = 100
    public static let ratingMin = 0
    public static let ratingMax = 3000
    public static let roundsMin = 1
    public static let roundsMax = 30
    /// Long-press to delete (spec 1.2). React Native's \`onLongPress\` uses a platform default that
    /// is not a number anywhere in the source; 500 ms is the iOS convention.
    public static let longPressMs = 500
    /// The round-selector gap lives in a \`contentContainerStyle\`, which the AST walker does not
    /// collect.
    public static let roundSelectorGap: CGFloat = 6
    /// Spec 1.5 gives the bulk-add editor a height of 160. It is not in the RN StyleSheet — that
    /// screen uses a plain multiline TextInput — so this one really is invented.
    public static let bulkEditorHeight: CGFloat = 160
}

/// The white piece dot. An INLINE style in the source (\`colorDot\` carries only geometry), so it is
/// read out of \`inlineStyles\` rather than retyped; the generator fails if it is not there.
public enum PairingDots {
    public static let white = ${swiftColor(dotFill, 'whiteDot')}
}

/// The off-screen share card (spec 1.6). The WIDTH is the design constant; the pixel ratio is the
/// device, and only the former belongs here.
public enum PairingShareCard {
    public static let width: CGFloat = ${styles.shareCard.width}
    /// The wait before capturing, from the source's two \`setTimeout\` calls.
    public static let captureMs = ${styles.delays.byScreen.detail[0].ms}
}
`;
}

// ---- Strings -----------------------------------------------------------------------------------
//
// The plain constants are emitted from the JS table, so the two cannot hold different COPY, not just
// different keys. The interpolating ones are hand-shaped below because a JS function body is not
// mechanically translatable — but their arities and names come from the JS, so a new interpolating
// string added there and forgotten here is a generator failure rather than a silent gap.

const FUNCS = {
  deleteBody:          ['_ name: String', '"Delete \\"\\(name)\\"? This cannot be undone."'],
  recommended:         ['_ n: Int, _ r: Int', '"Recommended for \\(n) players: \\(r) rounds"'],
  playersTab:          ['_ n: Int', '"Players (\\(n))"'],
  roundsMeta:          ['_ cur: Int, _ total: Int', '"R\\(cur)/\\(total)"'],
  ncfp:                ['_ r: Int', '"NCFP \\(r)"'],
  removeBody:          ['_ name: String', '"Remove \\(name)?"'],
  roundChip:           ['_ n: Int', '"R\\(n)"'],
  byeLine:             ['_ name: String', '"\\(name) \\u{2014} BYE (1 pt)"'],
  generateRound:       ['_ n: Int', '"Generate Round \\(n) Pairings"'],
  addNPlayers:         ['_ n: Int', '"Add \\(n) Players"'],
  board:               ['_ n: Int', '"Board \\(n)"'],
  warnRepeat:          ['_ a: String, _ b: String',
                        '"\\(a) vs \\(b) \\u{2014} repeat pairing (no legal alternative)"'],
  warnColor:           ['_ name: String', '"\\(name) \\u{2014} colour preference not met"'],
  warnBye:             ['_ name: String', '"\\(name) \\u{2014} second bye awarded"'],
  shareStandingsTitle: ['_ name: String', '"\\(name) \\u{2014} Standings"'],
  shareSubtitle:       ['_ n: Int, _ total: Int, _ type: String',
                        '"Round \\(n) of \\(total) \\u{2022} \\(type)"'],
  textBoard:           ['_ n: Int', '"Bd \\(n): "'],
};

/** A Swift string literal with every non-ASCII character escaped, so the file stays 7-bit. */
function swiftString(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (c < 0x20 || c > 0x7e) out += '\\u{' + c.toString(16).toUpperCase() + '}';
    else out += ch;
  }
  return '"' + out + '"';
}

function stringsFile() {
  const MET = require(path.join(ROOT, 'web-demo', 'js', 'pairing-metrics.js'));
  const keys = Object.keys(MET.STR);
  const jsFuncs = keys.filter((k) => typeof MET.STR[k] === 'function');

  const missing = jsFuncs.filter((k) => !FUNCS[k]);
  if (missing.length) {
    console.error('FATAL: the JS has interpolating strings this generator cannot shape: '
                  + missing.join(', '));
    process.exit(1);
  }
  const stale = Object.keys(FUNCS).filter((k) => !jsFuncs.includes(k));
  if (stale.length) {
    console.error('FATAL: this generator shapes strings the JS no longer has: ' + stale.join(', '));
    process.exit(1);
  }

  const lines = [];
  for (const k of keys) {
    if (typeof MET.STR[k] === 'function') {
      const [sig, body] = FUNCS[k];
      lines.push('    public static func ' + k + '(' + sig + ') -> String { ' + body + ' }');
    } else {
      lines.push('    public static let ' + k + ' = ' + swiftString(MET.STR[k]));
    }
  }

  return `// GENERATED by tools/metrics/gen_pairing_metrics.js — DO NOT HAND-EDIT.
//
// Spec 1.11, verbatim. The plain constants are emitted from \`web-demo/js/pairing-metrics.js\`'s
// \`STR\` table so the two languages cannot hold different copy; the interpolating ones are shaped by
// a table in the generator, which fails if the JS grows or loses one.
//
// Every network-error string from the React Native app is deliberately absent: there is no network.
// So are the free-plan limit messages — the one-time purchase removes the cap entirely.

import Foundation

public enum PairingStrings {
${lines.join('\n')}
}
`;
}

// ---- Emit ---------------------------------------------------------------------------------

// 1. The JS geometry region, between the markers.
let js = fs.readFileSync(JS_OUT, 'utf8');
const BEGIN = '  // GENERATED-BEGIN geometry';
const END = '  // GENERATED-END geometry';
const b = js.indexOf(BEGIN), e = js.indexOf(END);
if (b < 0 || e < 0) {
  console.error('FATAL: pairing-metrics.js has no GENERATED-BEGIN/END geometry markers');
  process.exit(1);
}
const jsBody = BLOCKS.map((x) => jsBlock(x.js, x.get(styles))).join('\n\n');
js = js.slice(0, b) + BEGIN + '\n' + jsBody + '\n' + js.slice(e);
fs.writeFileSync(JS_OUT, js);

// 2. The whole Swift file.
let total = 0;
const enums = BLOCKS.map((x) => {
  const r = swiftEnum(x.swift, x.get(styles),
    'Extracted from `' + (x.js === 'SHARE' ? 'shareStyles' : 'styles') + '` in '
    + styles.screens[x.js === 'SHARE' ? 'detail' : x.js.toLowerCase()]._source + '.');
  total += r.count;
  return r.text;
});

const swift = `// GENERATED by tools/metrics/gen_pairing_metrics.js — DO NOT HAND-EDIT.
//
// Twin of \`web-demo/js/pairing-metrics.js\`. Both are emitted from
// \`tools/metrics/tournament_styles.json\`, which \`extract_tournament_styles.js\` re-derives from the
// React Native source on every run — so these are not two transcriptions of a third thing, they are
// two renderings of one. \`tools/qa/replay_pairing.js\` compares them anyway, as a second opinion.
//
// **No numeric literal and no arithmetic in any view body.** Every number a Pairing screen draws is
// a stored property here. Break that and the coverage drains out silently: an inlined number is a
// number no check can see.
//
// \`PairingStrings\` is NOT generated and lives in \`PairingStrings.swift\` — copy is copy, taken
// verbatim from spec 1.11, and kept in step with the JS by the key-parity block in the replay.

import SwiftUI

${enums.join('\n\n')}
${extras()}`;

fs.writeFileSync(SWIFT_OUT, swift);

// 3. The strings, emitted last because they read the JS module this run just rewrote.
const STRINGS_OUT = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'PairingStrings.swift');
fs.writeFileSync(STRINGS_OUT, stringsFile());

console.log('  JS    ' + BLOCKS.map((x) => x.js + ' ' + Object.keys(x.get(styles)).length).join('  '));
console.log('  Swift ' + total + ' constants across ' + BLOCKS.length + ' enums + 4 hand-shaped ones');
console.log('wrote web-demo/js/pairing-metrics.js (geometry region)');
console.log('wrote DemoApp/Sources/BiyaherongUI/PairingMetrics.swift ('
  + (fs.statSync(SWIFT_OUT).size / 1024).toFixed(1) + ' KB)');
console.log('wrote DemoApp/Sources/BiyaherongUI/PairingStrings.swift');
