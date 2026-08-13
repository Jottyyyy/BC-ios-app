#!/usr/bin/env node
/*
 * gen_coach_metrics.js — emit Play vs Coach's presentation constants in BOTH languages from one
 * source.
 *
 *     node tools/metrics/gen_coach_metrics.js
 *     -> web-demo/js/coach-metrics.js                        (whole file)
 *     -> DemoApp/Sources/BiyaherongUI/CoachMetrics.swift     (whole file)
 *
 * Same argument as `gen_pairing_metrics.js`, which this is a near-copy of: both languages come out
 * of `coach_styles.json`, which `extract_coach_styles.js` re-derives from the React Native source on
 * every run. So the two are not two transcriptions of a third thing, they are two renderings of one,
 * and there is no step between them for a typo to live in.
 *
 * Unlike the Pairing generator this writes the JS file WHOLE rather than editing a region between
 * markers — `coach-metrics.js` has no hand-written half yet. `CoachStrings` (spec 2.14) is
 * deliberately not here: copy has to be transcribed verbatim before it can be generated, and it
 * belongs with the screens that use it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(__dirname, 'coach_styles.json');
const JS_OUT = path.join(ROOT, 'web-demo', 'js', 'coach-metrics.js');
const SWIFT_OUT = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'CoachMetrics.swift');

const styles = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/**
 * One entry per StyleSheet in the extraction.
 *
 * `play.tsx` holds the colour-select phase AND the game, so its blocks split by name rather than by
 * file — `CoachPlay` is one enum and the metrics layer reads whichever prefix it needs. Any extra
 * bindings the extractor found become enums of their own; merging them would silently overwrite
 * same-named blocks from two different designs.
 */
function blockList() {
  const out = [
    { js: 'SELECT', swift: 'CoachSelect', sheet: styles.screens.coachSelect.styles,
      source: styles.screens.coachSelect._source },
    { js: 'PLAY', swift: 'CoachPlay', sheet: styles.screens.play.styles,
      source: styles.screens.play._source },
  ];
  for (const key of ['coachSelect', 'play']) {
    const extra = styles.screens[key].extraStyles;
    if (!extra) continue;
    for (const [binding, sheet] of Object.entries(extra)) {
      out.push({
        js: binding.toUpperCase(),
        swift: 'Coach' + binding.charAt(0).toUpperCase() + binding.slice(1),
        sheet: sheet,
        source: styles.screens[key]._source,
      });
    }
  }
  return out;
}

/**
 * The avatar geometry, FOLDED from the extracted signed terms — never typed.
 *
 * `CoachCard` computes three sizes in its body, each built on the one above it:
 *
 *     avatarSize = coach.featured ? FEATURED_SIZE : REGULAR_SIZE
 *     ringSize   = avatarSize + 6
 *     haloSize   = ringSize + 10
 *
 * The extraction records those as `{sign, ref|value, ratio}` terms, so this evaluates them twice —
 * once down each side of the `featured` ternary — and emits the six results as a `cardSize` block
 * appended to the SELECT sheet. Appending is what makes it free everywhere else: `applyAll` pushes
 * the block as `--cgs-card-size-*` with no new plumbing, `swiftEnum` gives Swift the same six
 * constants, and the screen-test audit picks them up because it builds its allowed set from
 * `applyAll` itself.
 *
 * FATAL on an unresolvable reference. A missing size that silently became `NaN` would reach the
 * stylesheet as `NaNpx` and render as nothing at all — the exact failure this pipeline exists to
 * make impossible.
 */
function cardSizeBlock() {
  const fn = styles.screens.coachSelect.renderConstants.CoachCard;
  if (!fn) {
    console.error('FATAL: renderConstants.CoachCard is missing — the extractor no longer finds the '
                  + 'card component, so the avatar geometry is gone');
    process.exit(1);
  }
  const NAMES = ['avatarSize', 'ringSize', 'haloSize'];

  function foldTerms(expr, env, where) {
    let sum = 0;
    for (const t of expr.terms) {
      let v;
      if (typeof t.value === 'number') {
        v = t.value;
      } else if (t.ref !== undefined && env[t.ref] !== undefined) {
        v = env[t.ref] * (t.ratio === undefined ? 1 : t.ratio);
      } else {
        console.error('FATAL: ' + where + ' references ' + JSON.stringify(t.ref)
                      + ', which is not a module constant or an earlier local');
        process.exit(1);
      }
      sum += t.sign * v;
    }
    return sum;
  }

  function fold(expr, env, featured, where) {
    if (expr && expr.condition !== undefined) {
      // The only condition in this component is `coach.featured`. Anything else is a new branch
      // nobody has looked at, and guessing which side to take would bake in a wrong size.
      if (expr.condition !== 'coach.featured') {
        console.error('FATAL: ' + where + ' branches on ' + JSON.stringify(expr.condition)
                      + ', which this generator does not know how to fold');
        process.exit(1);
      }
      return foldTerms(featured ? expr.whenTrue : expr.whenFalse, env, where);
    }
    if (!expr || !expr.terms) {
      console.error('FATAL: ' + where + ' did not extract as foldable terms');
      process.exit(1);
    }
    return foldTerms(expr, env, where);
  }

  const out = {};
  for (const featured of [false, true]) {
    const env = Object.assign({}, styles.screens.coachSelect.moduleConstants);
    for (const n of NAMES) {
      env[n] = fold(fn[n], env, featured, 'CoachCard.' + n);
    }
    const suffix = featured ? 'Featured' : 'Regular';
    out['avatar' + suffix] = env.avatarSize;
    out['ring' + suffix] = env.ringSize;
    out['halo' + suffix] = env.haloSize;
  }
  // Every one of the six must have come out a real number; `NaN` is the value that survives a bad
  // fold and then disappears downstream without a word.
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v)) {
      console.error('FATAL: cardSize.' + k + ' folded to ' + v);
      process.exit(1);
    }
  }
  return out;
}

/**
 * The five per-coach accent colours, read out of the source's own `COACH_DATA`.
 *
 * `play.tsx` styles the primary modal button as `[styles.modalBtn, { backgroundColor:
 * coach.accentColor }]` — an inline colour, which is why `modalBtn` itself has no background in the
 * StyleSheet. Five hex strings are exactly the kind of thing that gets hand-copied one digit wrong,
 * so they come from the extraction like every other value.
 */
function accentColours() {
  const out = {};
  for (const c of roster()) out[c.level] = c.accentColor;
  return out;
}

/**
 * The five coaches, read whole out of the source's own `COACH_DATA`.
 *
 * This is not a convenience. The web demo shipped a hand-typed roster for one session and three of
 * the five ratings were wrong (1200/1600/2400 against the real 1500/1800/2500) and four of the five
 * names were short forms nobody in the app uses. Both the spec table (2.14) and the RN source say
 * otherwise, and they agree with each other — the transcription was the only thing that disagreed.
 *
 * `winMsg` / `loseMsg` are load-bearing rather than decorative: `coach-game.js`'s `evaluate` puts
 * them straight into the result card, so a roster without them renders `undefined` to the user.
 */
const ROSTER_FIELDS = ['name', 'role', 'tagline', 'intro', 'thinkingMsg', 'yourTurnMsg',
                       'winMsg', 'loseMsg', 'accentColor', 'rating'];
function roster() {
  const data = styles.screens.play.moduleConstants.COACH_DATA;
  if (!data) {
    console.error('FATAL: play.moduleConstants.COACH_DATA is missing — the coach roster moved');
    process.exit(1);
  }
  return [1, 2, 3, 4, 5].map((level) => {
    const c = data[level];
    if (!c) {
      console.error('FATAL: COACH_DATA[' + level + '] is missing');
      process.exit(1);
    }
    const out = { level };
    for (const f of ROSTER_FIELDS) {
      const want = f === 'rating' ? 'number' : 'string';
      if (typeof c[f] !== want) {
        console.error('FATAL: COACH_DATA[' + level + '].' + f + ' is not a ' + want);
        process.exit(1);
      }
      out[f] = c[f];
    }
    return out;
  });
}

/**
 * The eval graph's own values (spec 2.10), from `components/EvalGraph.tsx`.
 *
 * The spec states the fill, the radius, both advantage fills, the centre line and the curve in
 * prose. Every one is a literal on an SVG attribute in that component, which `collectSvgAttrs`
 * lifts — so none of them is retyped here. `clampCp` comes from the component's own `CLAMP`, which
 * is also the number `coach-review.js` clamps to; reading it means the two cannot disagree.
 */
function graphBlock() {
  const g = styles.screens.evalGraph;
  if (!g || !g.svg) {
    console.error('FATAL: the EvalGraph extraction is missing — spec 2.10 has no graph values');
    process.exit(1);
  }
  const need = ['Rect.fill', 'Rect.rx', 'Polygon.fill', 'Polygon.fill.1', 'Line.stroke',
                'Line.strokeWidth', 'Polyline.stroke', 'Polyline.strokeWidth',
                'EvalGraph.height'];
  for (const k of need) {
    if (g.svg[k] === undefined) {
      console.error('FATAL: EvalGraph is missing ' + k);
      process.exit(1);
    }
  }
  if (typeof g.moduleConstants.CLAMP !== 'number') {
    console.error('FATAL: EvalGraph has no CLAMP constant');
    process.exit(1);
  }
  return {
    backgroundColor: g.svg['Rect.fill'],
    borderRadius: g.svg['Rect.rx'],
    height: g.svg['EvalGraph.height'],
    whiteFill: g.svg['Polygon.fill'],
    blackFill: g.svg['Polygon.fill.1'],
    midStroke: g.svg['Line.stroke'],
    midStrokeWidth: g.svg['Line.strokeWidth'],
    curveStroke: g.svg['Polyline.stroke'],
    curveStrokeWidth: g.svg['Polyline.strokeWidth'],
    clampCp: g.moduleConstants.CLAMP,
  };
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
    lines.push('      ' + block + ': { ' + pairs + ' },');
  }
  lines.push('    };');
  return lines.join('\n');
}

// ---- Swift ---------------------------------------------------------------------------------------

/** `resultBanner` + `paddingHorizontal` -> `resultBannerPaddingHorizontal`. */
function member(block, prop) {
  return block + prop.charAt(0).toUpperCase() + prop.slice(1);
}

/**
 * A React Native colour as a SwiftUI `Color`.
 *
 * FATAL on anything it cannot express, rather than passing it through as a string: a `Color`
 * silently typed as `String` would not compile on the Mac, and finding that out there is the whole
 * failure mode this repo exists to avoid. This screen has 71 distinct colours — more than twice the
 * tournament count — so the odds of meeting an unusual form are correspondingly higher.
 */
function swiftColor(v, where) {
  if (v === 'transparent') return 'Color.clear';
  let m = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (m) return 'Theme.c(0x' + m[1].toUpperCase() + ')';
  // `#RGB` shorthand, which the tournament screens never used.
  m = /^#([0-9a-fA-F]{3})$/.exec(v);
  if (m) {
    const hex = m[1].split('').map((c) => c + c).join('').toUpperCase();
    return 'Theme.c(0x' + hex + ')';
  }
  // `#RRGGBBAA`.
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

const isColour = (v) => typeof v === 'string'
  && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgba?\(/.test(v) || v === 'transparent');

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

/** The board geometry and the extracted colour maps — everything that is not a StyleSheet. */
function extras() {
  const maps = Object.assign({}, styles.screens.coachSelect.colorMaps,
                             styles.screens.play.colorMaps);
  const mapLines = [];
  for (const [fnName, cases] of Object.entries(maps)) {
    const enumName = 'Coach' + fnName.charAt(0).toUpperCase() + fnName.slice(1);
    const rows = cases.map((c, i) => {
      const label = c.when === 'else' ? 'fallback' : 'case' + (i + 1);
      return '    /// `' + c.when.replace(/\n/g, ' ') + '`\n'
           + '    public static let ' + label + ' = ' + swiftColor(c.value, enumName + '.' + label);
    });
    mapLines.push('/// Extracted from the source\'s own `condition -> literal` map, IN ORDER — the\n'
      + '/// last branch is the fallback and moving it changes what an unrecognised value renders as.\n'
      + 'public enum ' + enumName + ' {\n' + rows.join('\n') + '\n}');
  }

  const g = styles.geometry;
  return `
/// The board, from the same formula the Analysis Board and the puzzle solvers use — this screen
/// imports the same component. The FORMULA is what matters; these are the reference device.
public enum CoachBoard {
    public static let referenceWidth: CGFloat = ${g.referenceDevice.width}
    public static let referenceHeight: CGFloat = ${g.referenceDevice.height}
    public static let referencePixelRatio: CGFloat = ${g.referenceDevice.pixelRatio}
    public static let boardSize: CGFloat = ${g.BOARD_SIZE}
    public static let squareSize: CGFloat = ${g.SQUARE_SIZE}

    /// \`floor(screenWidthPx / 8) * 8 / pixelRatio\` — recomputed per device rather than assumed.
    public static func size(width: CGFloat, pixelRatio: CGFloat) -> CGFloat {
        (floor((width * pixelRatio).rounded() / 8) * 8) / pixelRatio
    }
}

/// Level -> accent colour, from the source's own \`COACH_DATA\`. \`play.tsx\` applies it inline over
/// \`modalBtn\`, which is why that StyleSheet block carries no background of its own.
public enum CoachAccent {
${Object.entries(accentColours()).map(([lv, hex]) =>
  '    public static let level' + lv + ' = ' + swiftColor(hex, 'CoachAccent.level' + lv)).join('\n')}

    public static func of(level: Int) -> Color {
        switch level {
${Object.keys(accentColours()).map((lv) =>
  '        case ' + lv + ': return level' + lv).join('\n')}
        default: return level1
        }
    }
}

/// One coach, verbatim from the source's own \`COACH_DATA\`.
///
/// \`winMsg\` / \`loseMsg\` are what the result card shows, so they are part of the roster rather
/// than of \`CoachStrings\`: they vary per coach, and a missing one is a blank modal.
public struct CoachProfile: Identifiable, Hashable {
    public let id: Int
    public let name: String
    public let role: String
    public let tagline: String
    public let intro: String
    public let thinkingMsg: String
    public let yourTurnMsg: String
    public let winMsg: String
    public let loseMsg: String
    public let rating: Int

    /// The button colour \`play.tsx\` applies inline over \`modalBtn\`.
    public var accent: Color { CoachAccent.of(level: id) }
}

public enum CoachRoster {
    public static let all: [CoachProfile] = [
${roster().map((c) => '        CoachProfile(id: ' + c.level + ', name: ' + swiftString(c.name)
  + ', role: ' + swiftString(c.role) + ',\n                     tagline: '
  + swiftString(c.tagline) + ',\n                     intro: ' + swiftString(c.intro)
  + ',\n                     thinkingMsg: ' + swiftString(c.thinkingMsg)
  + ',\n                     yourTurnMsg: ' + swiftString(c.yourTurnMsg)
  + ',\n                     winMsg: ' + swiftString(c.winMsg)
  + ',\n                     loseMsg: ' + swiftString(c.loseMsg)
  + ',\n                     rating: ' + c.rating + '),').join('\n')}
    ]

    /// Out-of-range levels clamp rather than trap — spec 7 #35 is a deep link arriving with a
    /// non-numeric level and indexing \`COACH_DATA[NaN]\`.
    public static func of(level: Int) -> CoachProfile {
        all.first { $0.id == level } ?? all[0]
    }
}
${mapLines.length ? '\n' + mapLines.join('\n\n') + '\n' : ''}`;
}

// ---- Strings ------------------------------------------------------------------------------------
//
// Emitted from `coach-strings.js` rather than the extraction: copy comes from spec 2.14 and there is
// nothing in the RN StyleSheets to derive it from. Plain constants are copied across verbatim, so
// the two languages cannot hold different WORDS, not merely different keys.

const STRING_FUNCS = {
  elo:         ['_ n: Int', '"ELO \(n)"'],
  blackSub:    ['_ coach: String', '"\(coach) goes first"'],
  unfinished:  ['_ n: Int, _ colour: String',
                '"Unfinished game \u{00B7} \(n) moves as \(colour)"'],
  resumeBody:  ['_ n: Int, _ colour: String',
                '"You have an unfinished game \u{2014} \(n) moves played as \(colour)."'],
  premove:     ['_ from: String, _ to: String', '"\u{26A1} \(from)\u{2192}\(to)"'],
  resignBody:  ['_ coach: String', '"\(coach) will win this game."'],
  analyzing:   ['_ done: Int, _ total: Int', '"Analyzing\u{2026} \(done)/\(total)"'],
  resigned:    ['_ coach: String', '"You resigned. \(coach) wins this round!"'],
};

/** A Swift string literal with every non-ASCII character escaped, so the file stays 7-bit. */
function swiftString(str) {
  let out = '';
  for (const ch of str) {
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
  const S = require(path.join(ROOT, 'web-demo', 'js', 'coach-strings.js'));
  const keys = Object.keys(S.STR);
  const jsFuncs = keys.filter((k) => typeof S.STR[k] === 'function');

  const missing = jsFuncs.filter((k) => !STRING_FUNCS[k]);
  if (missing.length) {
    console.error('FATAL: the JS has interpolating strings this generator cannot shape: '
                  + missing.join(', '));
    process.exit(1);
  }
  const stale = Object.keys(STRING_FUNCS).filter((k) => !jsFuncs.includes(k));
  if (stale.length) {
    console.error('FATAL: this generator shapes strings the JS no longer has: ' + stale.join(', '));
    process.exit(1);
  }

  const lines = keys.map((k) => {
    if (typeof S.STR[k] === 'function') {
      const [sig, body] = STRING_FUNCS[k];
      return '    public static func ' + k + '(' + sig + ') -> String { ' + body + ' }';
    }
    return '    public static let ' + k + ' = ' + swiftString(S.STR[k]);
  });

  return `// GENERATED by tools/metrics/gen_coach_metrics.js — DO NOT HAND-EDIT.
//
// Spec 2.14, verbatim. The plain constants are emitted from \`web-demo/js/coach-strings.js\` so the
// two languages cannot hold different copy; the eight interpolating ones are shaped by a table in
// the generator, which fails if the JS grows or loses one.
//
// Eleven network-error strings and the \`Premium\` coach-lock badge are deliberately absent: there is
// no network and no lock. The Opening Explorer and the annotate/draw layer are not ported either —
// both are already unreachable in the shipping build.

import Foundation

public enum CoachStrings {
${lines.join('\n')}
}
`;
}

// ---- Emit -----------------------------------------------------------------------------------

const BLOCKS = blockList();
// Folded, not transcribed — see `cardSizeBlock`. It rides on the SELECT sheet so every consumer
// (JS, Swift, the CSS audit) gets it without knowing it is special.
BLOCKS[0].sheet.cardSize = cardSizeBlock();
// Likewise for the eval graph: it rides on the PLAY sheet as `graph`, so JS, Swift and the CSS
// audit all see it without a fourth code path.
BLOCKS[1].sheet.graph = graphBlock();

const jsBody = BLOCKS.map((b) => jsBlock(b.js, b.sheet)).join('\n\n');
const jsFile = `/* coach-metrics.js — Play vs Coach's pure presentation layer.
 *
 * GENERATED by tools/metrics/gen_coach_metrics.js — DO NOT HAND-EDIT.
 *
 * Twin of \`DemoApp/Sources/BiyaherongUI/CoachMetrics.swift\`. Both are emitted from
 * \`tools/metrics/coach_styles.json\`, which \`extract_coach_styles.js\` re-derives from the React
 * Native source on every run.
 *
 * Consequently the screens contain NO numeric literal and NO arithmetic in a render body. Break that
 * and the coverage drains out silently: an inlined number is a number no check can see.
 */
'use strict';

var BiyaCoachMetrics = (function () {

${jsBody}

  var BOARD = {
    referenceWidth: ${styles.geometry.referenceDevice.width},
    referenceHeight: ${styles.geometry.referenceDevice.height},
    referencePixelRatio: ${styles.geometry.referenceDevice.pixelRatio},
    boardSize: ${styles.geometry.BOARD_SIZE},
    squareSize: ${styles.geometry.SQUARE_SIZE},
  };

  /** \`floor(screenWidthPx / 8) * 8 / pixelRatio\` — the source's own formula. */
  function boardSize(width, pixelRatio) {
    return (Math.floor(Math.round(width * pixelRatio) / 8) * 8) / pixelRatio;
  }

  /** Level -> the coach's accent colour, from the source's own \`COACH_DATA\`. */
  var ACCENTS = ${JSON.stringify(accentColours(), null, 2).split('\n').join('\n  ')};

  /** The five coaches, verbatim from the source's own \`COACH_DATA\`. */
  var COACHES = ${JSON.stringify(roster(), null, 2).split('\n').join('\n  ')};

  var COLOR_MAPS = ${JSON.stringify(
    Object.assign({}, styles.screens.coachSelect.colorMaps, styles.screens.play.colorMaps),
    null, 2).split('\n').join('\n  ')};

  /** Every scalar property of every block, as \`--<prefix>-<block>-<prop>\` custom properties. */
  var UNITLESS = {
    flex: 1, flexGrow: 1, flexShrink: 1, fontWeight: 1, opacity: 1, zIndex: 1,
    aspectRatio: 1, shadowOpacity: 1, elevation: 1,
  };
  function kebab(s) { return s.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  function cssVarName(prefix, block, prop) {
    return '--' + prefix + '-' + kebab(block) + '-' + kebab(prop);
  }
  function cssValue(prop, v) {
    if (typeof v === 'number') return UNITLESS[prop] ? String(v) : v + 'px';
    return String(v);
  }
  function applyAll(node, prefix, blocks) {
    Object.keys(blocks).forEach(function (block) {
      var b = blocks[block];
      if (!b) return;
      Object.keys(b).forEach(function (prop) {
        var v = b[prop];
        if (v === null || typeof v === 'object') return;
        node.style.setProperty(cssVarName(prefix, block, prop), cssValue(prop, v));
      });
    });
  }

  function selfTestSource(src) {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    var same = function (a, b) {
      if (a !== null && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
      return a === b;
    };
    var pairs = ${JSON.stringify(BLOCKS.map((b) => b.js))};
    var sheets = {
      SELECT: src.screens.coachSelect.styles,
      PLAY: src.screens.play.styles,
    };
    var mine = { SELECT: SELECT, PLAY: PLAY };
    var compared = 0;
    pairs.forEach(function (name) {
      var theirs = sheets[name], ours = mine[name];
      if (!theirs || !ours) return;
      Object.keys(theirs).forEach(function (block) {
        expect(ours[block] != null, name + '.' + block + ' is missing from the metrics layer');
        if (!ours[block]) return;
        Object.keys(theirs[block]).forEach(function (prop) {
          expect(same(ours[block][prop], theirs[block][prop]),
                 name + '.' + block + '.' + prop + ': metrics have '
                 + JSON.stringify(ours[block][prop]) + ', the RN source has '
                 + JSON.stringify(theirs[block][prop]));
          compared++;
        });
      });
    });
    expect(compared > 600,
           'only ' + compared + ' properties compared — the extraction probably moved');
    var gsvg = src.screens.evalGraph.svg;
    expect(PLAY.graph.backgroundColor === gsvg['Rect.fill'], 'the graph fill is the extracted one');
    expect(PLAY.graph.curveStroke === gsvg['Polyline.stroke'], 'and the curve colour');
    expect(PLAY.graph.clampCp === src.screens.evalGraph.moduleConstants.CLAMP,
           'and the clamp is the component CLAMP, not a second opinion');
    var data = src.screens.play.moduleConstants.COACH_DATA;
    expect(COACHES.length === 5, 'five coaches');
    COACHES.forEach(function (c) {
      var them = data[c.level];
      ['name', 'role', 'tagline', 'intro', 'thinkingMsg', 'yourTurnMsg', 'winMsg', 'loseMsg',
       'accentColor', 'rating'].forEach(function (f) {
        expect(c[f] === them[f], 'coach ' + c.level + '.' + f + ' matches COACH_DATA');
      });
    });
    for (var ci = 1; ci < COACHES.length; ci++) {
      expect(COACHES[ci].rating > COACHES[ci - 1].rating, 'ratings ascend by level');
    }
    var levels = Object.keys(ACCENTS);
    expect(levels.length === 5, 'five accent colours, one per coach');
    levels.forEach(function (lv) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(ACCENTS[lv]), 'accent ' + lv + ' is a hex colour');
      expect(ACCENTS[lv] === src.screens.play.moduleConstants.COACH_DATA[lv].accentColor,
             'accent ' + lv + ' matches COACH_DATA');
    });
    expect(BOARD.squareSize * 8 === BOARD.boardSize, 'the board is eight squares wide');
    expect(boardSize(BOARD.referenceWidth, BOARD.referencePixelRatio) === BOARD.boardSize,
           'the formula reproduces the reference board size');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-metrics vs RN source: ' + passed + ' assertions passed'
        : 'coach-metrics vs RN source: ' + passed + ' passed, ' + failures.length + ' FAILED\\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\\n'),
    };
  }

  return {
${BLOCKS.map((b) => '    ' + b.js + ': ' + b.js + ',').join('\n')}
    BOARD: BOARD, COLOR_MAPS: COLOR_MAPS, ACCENTS: ACCENTS, COACHES: COACHES,
    boardSize: boardSize,
    cssVarName: cssVarName, cssValue: cssValue, applyAll: applyAll,
    selfTestSource: selfTestSource,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachMetrics; }
`;
fs.writeFileSync(JS_OUT, jsFile);

let total = 0;
const enums = BLOCKS.map((b) => {
  const r = swiftEnum(b.swift, b.sheet, 'Extracted from ' + b.source + '.');
  total += r.count;
  return r.text;
});

const swift = `// GENERATED by tools/metrics/gen_coach_metrics.js — DO NOT HAND-EDIT.
//
// Twin of \`web-demo/js/coach-metrics.js\`. Both are emitted from
// \`tools/metrics/coach_styles.json\`, which \`extract_coach_styles.js\` re-derives from the React
// Native source on every run — so these are not two transcriptions of a third thing, they are two
// renderings of one.
//
// **No numeric literal and no arithmetic in any view body.** Every number a Play vs Coach screen
// draws is a stored property here. Break that and the coverage drains out silently.
//
// \`CoachStrings\` is NOT generated here: copy comes from spec 2.14 and has to be transcribed before
// it can be emitted.

import SwiftUI

${enums.join('\n\n')}
${extras()}`;
fs.writeFileSync(SWIFT_OUT, swift);

const STRINGS_OUT = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'CoachStrings.swift');
fs.writeFileSync(STRINGS_OUT, stringsFile());

console.log('  JS    ' + BLOCKS.map((b) => b.js + ' ' + Object.keys(b.sheet).length).join('  '));
console.log('  Swift ' + total + ' constants across ' + BLOCKS.length + ' enums + board + maps');
console.log('wrote web-demo/js/coach-metrics.js ('
  + (fs.statSync(JS_OUT).size / 1024).toFixed(1) + ' KB)');
console.log('wrote DemoApp/Sources/BiyaherongUI/CoachMetrics.swift ('
  + (fs.statSync(SWIFT_OUT).size / 1024).toFixed(1) + ' KB)');
console.log('wrote DemoApp/Sources/BiyaherongUI/CoachStrings.swift');
