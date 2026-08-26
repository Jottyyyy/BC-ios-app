#!/usr/bin/env node
/*
 * gen_video_metrics.js — emit Tutorial Videos' presentation constants in BOTH languages from one
 * source.
 *
 *     node tools/metrics/gen_video_metrics.js
 *     -> web-demo/js/video-metrics.js                        (whole file)
 *     -> DemoApp/Sources/BiyaherongUI/VideoMetrics.swift     (whole file)
 *
 * Same argument as `gen_coach_metrics.js`, which this is a near-copy of: both languages come out of
 * `video_styles.json`, which `extract_video_styles.js` re-derives from the React Native source. So
 * the two are not two transcriptions of a third thing — they are two renderings of one, and there is
 * no step between them for a typo to live in.
 *
 * That is not a style preference here. Two screens shipped from transcriptions on 2026-08-26 alone:
 * `"⬜ White"` where the RN had a king glyph, and a padding that was extracted and never applied.
 * Both agreed with their own twin and disagreed with the source, which is the one failure a
 * two-port parity harness cannot see.
 *
 * ## What is NOT generated
 *
 * The copy. `VideoStrings` is hand-written in both languages and pinned by `replay_videos.js`,
 * because the RN's strings are scattered through JSX rather than sitting in a table — and because
 * the offline app says things the RN never had to (there is no "this needs wifi" in a screen that
 * assumes a server).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(__dirname, 'video_styles.json');
const JS_OUT = path.join(ROOT, 'web-demo', 'js', 'video-metrics.js');
const SWIFT_OUT = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'VideoMetrics.swift');

if (!fs.existsSync(SRC)) {
  console.error('FATAL: ' + SRC + ' is missing. Run tools/metrics/extract_video_styles.js first.');
  process.exit(1);
}
const styles = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const BLOCKS = [
  { js: 'LIST', swift: 'VideoList', sheet: styles.screens.list.styles,
    source: styles.screens.list._source },
  { js: 'PLAY', swift: 'VideoPlay', sheet: styles.screens.play.styles,
    source: styles.screens.play._source },
];

// ---- Shared -------------------------------------------------------------------------------------

const isColour = (v) => typeof v === 'string'
  && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/.test(v) || v === 'transparent');

/** `catChip` + `paddingHorizontal` -> `catChipPaddingHorizontal`. */
function member(block, prop) {
  return block + prop.charAt(0).toUpperCase() + prop.slice(1);
}

// ---- JavaScript ---------------------------------------------------------------------------------

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
    lines.push('    ' + block + ': { ' + pairs + ' },');
  }
  lines.push('  };');
  return lines.join('\n');
}

// ---- Swift ---------------------------------------------------------------------------------------

/**
 * A React Native colour as a SwiftUI `Color`.
 *
 * FATAL on anything it cannot express, rather than passing it through as a string: a `Color`
 * silently typed as `String` would not compile on the Mac, and finding that out there is the whole
 * failure mode this repo exists to avoid.
 */
function swiftColor(v, where) {
  if (v === 'transparent') return 'Color.clear';
  let m = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (m) return 'Theme.c(0x' + m[1].toUpperCase() + ')';
  m = /^#([0-9a-fA-F]{3})$/.exec(v);
  if (m) {
    const hex = m[1].split('').map((c) => c + c).join('').toUpperCase();
    return 'Theme.c(0x' + hex + ')';
  }
  m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(v);
  if (m) {
    const a = parseInt(m[2], 16) / 255;
    return 'Theme.c(0x' + m[1].toUpperCase() + ', ' + Number(a.toFixed(4)) + ')';
  }
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

function swiftDecl(name, v, where) {
  if (typeof v === 'number') return '    public static let ' + name + ': CGFloat = ' + v;
  if (isColour(v)) return '    public static let ' + name + ' = ' + swiftColor(v, where);
  if (typeof v === 'string') {
    return '    public static let ' + name + ' = "' + v.replace(/"/g, '\\"') + '"';
  }
  return null;                     // objects (shadowOffset) split into components below
}

function swiftEnum(name, sheet, doc) {
  const seen = new Set();
  const out = ['/// ' + doc, 'public enum ' + name + ' {'];
  for (const [block, props] of Object.entries(sheet)) {
    for (const [prop, v] of Object.entries(props)) {
      const where = name + '.' + block + '.' + prop;
      if (v !== null && typeof v === 'object') {
        // `shadowOffset: {width, height}` becomes two scalars: SwiftUI's `.shadow` takes x and y
        // separately, and a CGSize would be the only compound value in the file.
        for (const [k, n] of Object.entries(v)) {
          const nm = member(block, prop + k.charAt(0).toUpperCase() + k.slice(1));
          if (seen.has(nm)) { console.error('FATAL: duplicate member ' + name + '.' + nm); process.exit(1); }
          seen.add(nm);
          out.push('    public static let ' + nm + ': CGFloat = ' + n);
        }
        continue;
      }
      const nm = member(block, prop);
      if (seen.has(nm)) { console.error('FATAL: duplicate member ' + name + '.' + nm); process.exit(1); }
      seen.add(nm);
      const line = swiftDecl(nm, v, where);
      if (line) out.push(line);
    }
  }
  out.push('}');
  return { text: out.join('\n'), count: seen.size };
}

// ---- The category table -------------------------------------------------------------------------
//
// `CATEGORY_ORDER` decides which sections exist and in what order; `CATEGORY_META` gives each its
// accent, its chip background and its glyph. Emitted from the extraction rather than typed, because
// five colours and five emoji is exactly the shape that gets copied one character wrong.
//
// The ORDER is the Core's — `VideoLibrary.categoryOrder` — and `replay_videos.js` pins the two
// together. It lives there because grouping is domain logic, not presentation; this file only says
// what each group looks like.

function categoryTable() {
  const consts = styles.screens.list.moduleConstants || {};
  const order = consts.CATEGORY_ORDER;
  const meta = consts.CATEGORY_META;
  if (!Array.isArray(order) || !meta) {
    console.error('FATAL: CATEGORY_ORDER / CATEGORY_META missing from the extraction. Re-run '
      + 'tools/metrics/extract_video_styles.js.');
    process.exit(1);
  }
  for (const cat of order) {
    if (!meta[cat]) {
      console.error('FATAL: CATEGORY_ORDER names "' + cat + '" and CATEGORY_META has no entry for '
        + 'it — that section would render with no colour and no glyph.');
      process.exit(1);
    }
  }

  const swiftRows = order.map((cat) => {
    const m = meta[cat];
    return '        "' + cat + '": Meta(accent: ' + swiftColor(m.color, 'CATEGORY_META.' + cat)
      + ', chipBackground: ' + swiftColor(m.bg, 'CATEGORY_META.' + cat)
      + ', glyph: "' + m.icon + '"),';
  });

  const jsRows = order.map((cat) => {
    const m = meta[cat];
    return "    '" + cat + "': { accent: " + jsValue(m.color) + ', chipBackground: '
      + jsValue(m.bg) + ', glyph: ' + jsValue(m.icon) + ' },';
  });

  return { order, swiftRows, jsRows, count: order.length };
}

const CATS = categoryTable();

// ---- Emit ---------------------------------------------------------------------------------------

const jsBody = BLOCKS.map((b) => jsBlock(b.js, b.sheet)).join('\n\n');
const swiftBody = BLOCKS.map((b) => swiftEnum(b.swift, b.sheet,
  'Extracted from `' + b.source + '` by tools/metrics/extract_video_styles.js.')).map((x) => x.text)
  .join('\n\n');
const swiftCount = BLOCKS.reduce((n, b) => n + swiftEnum(b.swift, b.sheet, '').count, 0);

const header = (lang) => `${lang === 'js' ? '/*' : '//'} GENERATED by tools/metrics/gen_video_metrics.js — DO NOT HAND-EDIT.
${lang === 'js' ? ' *' : '//'}
${lang === 'js' ? ' *' : '//'} Every number, colour and category glyph the Tutorial Videos screens draw, from
${lang === 'js' ? ' *' : '//'} tools/metrics/video_styles.json, which extract_video_styles.js re-derives from the
${lang === 'js' ? ' *' : '//'} React Native source. Nothing here is transcribed.
${lang === 'js' ? ' *' : '//'}
${lang === 'js' ? ' *' : '//'} The COPY is not here — see VideoStrings, which is hand-written and pinned by
${lang === 'js' ? ' *' : '//'} tools/qa/replay_videos.js. The RN keeps its strings in JSX rather than in a table, and
${lang === 'js' ? ' *' : '//'} this app says things the RN never had to: it can be offline, and the RN could not.
${lang === 'js' ? ' */' : '//'}`;

const jsFile = `${header('js')}
var BiyaVideoMetrics = (function () {
  'use strict';

${jsBody}

  /* What each section looks like. The ORDER lives in the Core (VideoLibrary.categoryOrder) and in
     web-demo/js/video-library.js, because grouping is domain logic; this table is only its skin. */
  var CATEGORIES = {
${CATS.jsRows.join('\n')}
  };

  /** An unknown category never reaches here — VideoLibrary.categoryKey folds it to Uncategorized
      first — but the fallback keeps a missing entry from rendering as \`undefined\`. */
  function categoryMeta(name) {
    return CATEGORIES[name] || CATEGORIES['${styles.screens.list.moduleConstants.CATEGORY_ORDER.slice(-1)[0]}'];
  }

  var API = {
    LIST: LIST, PLAY: PLAY, CATEGORIES: CATEGORIES, categoryMeta: categoryMeta,
    THUMB_W: ${styles.screens.list.moduleConstants.THUMB_W},
    THUMB_H: ${Math.round(styles.screens.list.moduleConstants.THUMB_W * (16 / 9))}
  };

  global_.BiyaVideoMetrics = API;
  return API;
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaVideoMetrics; }
`.replace('global_.BiyaVideoMetrics = API;\n  return API;', 'return API;');

const swiftFile = `${header('swift')}

import SwiftUI

${swiftBody}

/// What each section looks like.
///
/// The ORDER lives in VideoLibrary.categoryOrder (the Core) because grouping is domain logic;
/// this table is only its skin, and \`replay_videos.js\` pins the two together.
public enum VideoCategoryStyle {

    public struct Meta: Equatable, Sendable {
        public let accent: Color
        public let chipBackground: Color
        public let glyph: String
    }

    public static let all: [String: Meta] = [
${CATS.swiftRows.join('\n')}
    ]

    /// An unknown category never reaches here — \`VideoLibrary.categoryKey\` folds it to
    /// Uncategorized first — but the fallback keeps a missing entry from rendering as nothing.
    public static func meta(_ name: String) -> Meta {
        all[name] ?? all[VideoLibrary.uncategorized]!
    }
}

/// The card thumbnail. \`THUMB_H\` is FOLDED from the source's own
/// \`Math.round(THUMB_W * (16 / 9))\` rather than typed — a 9:16 portrait still.
public enum VideoThumb {
    public static let width: CGFloat = ${styles.screens.list.moduleConstants.THUMB_W}
    public static let height: CGFloat = ${Math.round(styles.screens.list.moduleConstants.THUMB_W * (16 / 9))}
}
`;

fs.writeFileSync(JS_OUT, jsFile);
fs.writeFileSync(SWIFT_OUT, swiftFile);

console.log('  JS    ' + BLOCKS.map((b) => b.js + ' ' + Object.keys(b.sheet).length).join('  '));
console.log('  Swift ' + swiftCount + ' constants across ' + BLOCKS.length + ' enums + '
  + CATS.count + ' categories');
console.log('wrote web-demo/js/video-metrics.js');
console.log('wrote DemoApp/Sources/BiyaherongUI/VideoMetrics.swift');
