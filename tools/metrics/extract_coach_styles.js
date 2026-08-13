#!/usr/bin/env node
/*
 * extract_coach_styles.js — pull Play vs Coach's real layout numbers out of the React Native
 * source, mechanically.
 *
 *     node tools/metrics/extract_coach_styles.js
 *     → tools/metrics/coach_styles.json   (COMMITTED)
 *
 * Fourth extractor, same machine (`rn_ast.js`) as the board, the puzzles and the tournaments. The
 * reason has not changed and this is the file that most needs it: `play.tsx` is 3,082 lines, the
 * densest screen in the app, and nobody is going to transcribe its numbers correctly by hand.
 *
 * The output is committed, unlike Goldens/: whoever compiles the Swift may not have the sibling RN
 * repo — the same reasoning that commits `eco.tsv` and the other three style JSONs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./rn_ast.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const COACH = path.join(FRONTEND, 'app', '(app)', 'user', 'play-coach');
const OUT = path.join(__dirname, 'coach_styles.json');

const ts = RN.loadTypeScript(FRONTEND);

// Screen keys are the SPEC's names (§2.5-2.7). `play.tsx` carries BOTH the colour-select phase and
// the game itself — it is one file with one StyleSheet family, so it is extracted once and the
// metrics layer splits it by block name.
const SCREENS = [
  { key: 'coachSelect', file: 'index.tsx', spec: '2.5' },
  { key: 'play',        file: 'play.tsx',  spec: '2.6 / 2.7 / 2.8' },
];

/**
 * Helpers that map a condition to a literal — the same class the tournament extractor had to add a
 * walker for, because `collectRenderFunction` looks for style-ish values and returns `{}` for these.
 *
 * Here they decide the result banner and the per-level accent, which is to say they decide what the
 * screen SAYS. Left unextracted they would be the only hand-typed strings in the feature.
 */
const COLOR_MAP_FUNCTIONS = ['getResultColor', 'getLevelColor', 'getStatusColor', 'getBadgeColor',
                             'levelColor', 'resultColor', 'accentColor'];

// `CoachCard` is the fifth entry for one reason: it is a function DECLARATION, not the
// `const f = () =>` form the render-like walker looks for, and it owns the avatar geometry
// (`avatarSize` -> `ringSize` -> `haloSize`). Without it those three sizes are absent from the JSON
// and the stylesheet has to invent them.
const NAMED_FUNCTIONS = ['getResultColor', 'getLevelColor', 'formatTime', 'buildPgn',
                         'getGameResultText', 'renderMoveStrip', 'CoachCard'];

// ---- Seeds ------------------------------------------------------------------------------------
//
// The board geometry is the same formula the Analysis Board and the puzzle screens use — this screen
// imports the same component. The metrics layer keeps the FORMULA; these concrete numbers exist only
// so the extracted pixel values are comparable.
const REF_WIDTH = 390, REF_HEIGHT = 844, REF_RATIO = 3;
const BOARD_SIZE = (Math.floor(Math.round(REF_WIDTH * REF_RATIO) / 8) * 8) / REF_RATIO;
const SQUARE_SIZE = BOARD_SIZE / 8;

const SEED = {
  BOARD_SIZE, SQUARE_SIZE,
  width: REF_WIDTH, screenWidth: REF_WIDTH, screenHeight: REF_HEIGHT, height: REF_HEIGHT,
  // Both files write `const { width: SCREEN_WIDTH } = Dimensions.get('window')`. The evaluator
  // seeds `width`, but the destructuring RENAME means the folded value never reaches the new name —
  // so eighteen dimensions came back unresolved, including two modal widths. Seed the renamed
  // binding too; `ORB = SCREEN_WIDTH * 1.5` then folds on its own.
  SCREEN_WIDTH: REF_WIDTH, SCREEN_HEIGHT: REF_HEIGHT,
  // `const ORB = SCREEN_WIDTH * 1.5` (index.tsx:230) — the decorative background glow. Seeded from
  // the source's own formula at the reference device, exactly as BOARD_SIZE is: the metrics layer
  // keeps the formula, and this number only makes the extracted pixels comparable.
  ORB: REF_WIDTH * 1.5,
};

// `insets.*` is a runtime safe-area read, not a design constant; the spec writes every use of it as
// `safeArea + N`, and `additiveTerms` keeps the offset regardless. Whitelisted rather than seeded,
// so a fake number never lands in the JSON looking measured.
// The five coach avatars are the second expected class. Spec 2.1 is explicit that these are photo
// assets and not emoji, so a `require()` here is the correct thing to find — it is a picture, not a
// measurement. The puzzle extractor makes the same exception for `PIECE_COMPONENTS`.
const EXPECTED_UNRESOLVED =
  /(^|\.)insets\b|useSafeAreaInsets|Dimensions\.get|COACH_DATA\.\d+\.image/;

// ---- Walk ---------------------------------------------------------------------------------------

const unresolved = [];
const screens = {};

function walkFile(key, file, spec) {
  if (!fs.existsSync(file)) { console.error('FATAL: missing ' + file); process.exit(1); }
  const sf = RN.parse(ts, file);
  const ev = RN.createEvaluator(ts, SEED);
  const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, sf, ev);
  const renderConstants = Object.assign(
    RN.findRenderLikeFunctions(ts, sf),
    RN.findNamedFunctions(ts, sf, NAMED_FUNCTIONS));
  const inlineStyles = RN.collectInlineStyles(ts, sf);
  for (const u of ev.unresolved) unresolved.push(Object.assign({ screen: key }, u));

  // No fixed count here. The tournament extractor asserts one or two bindings; a 3,082-line screen
  // may reasonably declare more, and guessing the number would only produce a false failure. What
  // IS asserted is that there is at least one — zero means the walker found nothing and every
  // number downstream would be missing rather than wrong.
  const names = Object.keys(stylesheets);
  if (names.length < 1) {
    console.error('FATAL: no StyleSheet found in ' + file
                  + ' — the walker is looking in the wrong place');
    process.exit(1);
  }
  screens[key] = {
    _spec: spec,
    _source: path.relative(FRONTEND, file).replace(/\\/g, '/'),
    _bindings: names,
    styles: stylesheets[names[0]],
    // Everything past the first binding, kept whole and keyed by its own name. Merging them would
    // silently overwrite same-named blocks between two different designs.
    extraStyles: names.length > 1
      ? Object.fromEntries(names.slice(1).map((n) => [n, stylesheets[n]]))
      : null,
    moduleConstants,
    renderConstants,
    colorMaps: collectColorMaps(ts, sf, COLOR_MAP_FUNCTIONS),
    inlineStyles,
    soundCalls: RN.collectSoundCalls(ts, sf),
    delays: resolveDelays(RN.collectDelays(ts, sf), moduleConstants, key),
  };
}

/**
 * `condition -> literal` maps, as an ORDERED list, because the order is the semantics: the last
 * branch is the fallback and moving it changes what an unrecognised value renders as.
 */
function collectColorMaps(ts, sf, names) {
  const out = {};
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && names.indexOf(node.name.text) !== -1
        && node.initializer
        && (ts.isArrowFunction(node.initializer)
            || ts.isConditionalExpression(node.initializer))) {
      const cases = [];
      (function scan(n, cond) {
        if (ts.isStringLiteral(n)) { cases.push({ when: cond, value: n.text }); return; }
        if (ts.isConditionalExpression(n)) {
          scan(n.whenTrue, n.condition.getText());
          scan(n.whenFalse, 'else');
          return;
        }
        if (ts.isIfStatement(n)) {
          scan(n.thenStatement, n.expression.getText());
          if (n.elseStatement) scan(n.elseStatement, 'else');
          return;
        }
        if (ts.isReturnStatement(n)) { if (n.expression) scan(n.expression, cond); return; }
        if (ts.isBlock(n)) { n.statements.forEach((st) => scan(st, cond)); return; }
        if (ts.isParenthesizedExpression(n)) { scan(n.expression, cond); return; }
      })(ts.isArrowFunction(node.initializer) ? node.initializer.body : node.initializer, 'else');
      if (cases.length) out[node.name.text] = cases;
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

/**
 * A named delay that cannot be resolved is FATAL rather than skipped.
 *
 * This screen is the one where that matters most: spec 2.12 names four uncleared `setTimeout`s as
 * real defects, so the set of delays in the source is evidence, and a missing entry would read as
 * "there was no timer there".
 */
function resolveDelays(delays, moduleConstants, key) {
  return delays.map((d) => {
    if (d.ms != null) return d;
    const v = moduleConstants[d.msRef];
    if (typeof v !== 'number') {
      console.error('FATAL: ' + key + ' line ' + d.line + ' delays by `' + d.msRef
                    + '`, which is not a numeric module constant');
      process.exit(1);
    }
    return Object.assign({}, d, { ms: v });
  });
}

for (const s of SCREENS) walkFile(s.key, path.join(COACH, s.file), s.spec);

// The eval graph is a SHARED component, not part of either screen, so it needs its own walk.
// Spec 2.10 states its fill, radius and stroke widths in prose; every one of them is a literal in
// this file, and the difference between reading them and retyping them is the whole rule. Its
// container is a StyleSheet, but the colours live on SVG attributes, so `collectSvgAttrs` picks
// those up separately.
walkFile('evalGraph', path.join(FRONTEND, 'components', 'EvalGraph.tsx'), '2.10');
screens.evalGraph.svg = collectSvgAttrs(ts, RN.parse(ts, path.join(FRONTEND, 'components',
                                                                  'EvalGraph.tsx')));
// `<EvalGraph height={60} />` is a literal on the CALL SITE, not inside the component, so the
// height only exists in play.tsx. Merged in rather than transcribed.
Object.assign(screens.evalGraph.svg,
              pick(collectSvgAttrs(ts, RN.parse(ts, path.join(COACH, 'play.tsx'))), /^EvalGraph\./));

function pick(obj, re) {
  const out = {};
  for (const k of Object.keys(obj)) if (re.test(k)) out[k] = obj[k];
  return out;
}

/**
 * The literal `fill` / `stroke` / `strokeWidth` / `rx` attributes on an SVG element.
 *
 * `collectInlineStyles` only looks at `style={{…}}`; these are plain JSX attributes on `<Rect>`,
 * `<Polygon>`, `<Line>` and `<Polyline>`, so they would otherwise be invisible to the whole
 * pipeline — and they are exactly the colours spec 2.10 describes.
 */
function collectSvgAttrs(ts, sf) {
  const out = {};
  const wanted = { fill: 1, stroke: 1, strokeWidth: 1, rx: 1, width: 1, height: 1 };
  (function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      for (const a of node.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const name = a.name.getText();
        if (!wanted[name]) continue;
        let value = null;
        if (ts.isStringLiteral(a.initializer)) value = a.initializer.text;
        else if (ts.isJsxExpression(a.initializer) && a.initializer.expression
                 && ts.isNumericLiteral(a.initializer.expression)) {
          value = Number(a.initializer.expression.text);
        } else if (ts.isJsxExpression(a.initializer) && a.initializer.expression
                   && ts.isStringLiteral(a.initializer.expression)) {
          value = a.initializer.expression.text;
        }
        if (value === null) continue;
        const key = tag + '.' + name;
        // First wins: the same tag can appear twice (two `<Polygon>`s), and they are distinguished
        // by index below rather than by overwriting each other.
        let i = 0;
        while (out[key + (i ? '.' + i : '')] !== undefined) i += 1;
        out[key + (i ? '.' + i : '')] = value;
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

// ---- Cross-screen findings -------------------------------------------------------------------

const headerVariants = {};
for (const [key, s] of Object.entries(screens)) {
  if (s.styles.header) headerVariants[key] = s.styles.header;
}
const headerSignatures = new Set(Object.values(headerVariants).map((h) => JSON.stringify(h)));

const colourUse = {};
function countColours(obj) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(v)) {
      colourUse[v] = (colourUse[v] || 0) + 1;
    } else if (v && typeof v === 'object') countColours(v);
  }
}
for (const s of Object.values(screens)) { countColours(s.styles); countColours(s.extraStyles); }
const palette = Object.fromEntries(
  Object.entries(colourUse).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

// ---- Emit ---------------------------------------------------------------------------------

const out = {
  _generated: 'tools/metrics/extract_coach_styles.js — do not hand-edit',
  _note: 'The REAL StyleSheet numbers for Play vs Coach. Spec 2.5-2.8 prose is secondary; where '
       + 'they disagree the deviation is recorded in PORTING_NOTES.md.',
  geometry: {
    _formula: 'BOARD_SIZE = floor(screenWidthPx / 8) * 8 / pixelRatio;  SQUARE_SIZE = BOARD_SIZE / 8',
    _note: 'The same component the Analysis Board and the puzzle solvers use. The metrics layer '
         + 'keeps the FORMULA; these numbers are the reference device only.',
    referenceDevice: { width: REF_WIDTH, height: REF_HEIGHT, pixelRatio: REF_RATIO },
    BOARD_SIZE, SQUARE_SIZE,
  },
  headers: {
    _note: headerSignatures.size + ' distinct header shapes across '
         + Object.keys(headerVariants).length + ' screens. Encode per screen — the same finding as '
         + 'the puzzle and tournament ports.',
    variants: headerVariants,
  },
  palette: {
    _note: 'Every colour literal in the extracted StyleSheets, by use count.',
    _distinct: Object.keys(palette).length,
    counts: palette,
  },
  sound: {
    _note: 'Spec 2.11. Recorded from the source rather than the prose, because three puzzle sound '
         + 'names were wrong precisely because nothing checked them against anything.',
    byScreen: Object.fromEntries(
      Object.entries(screens).map(([k, s]) => [k, s.soundCalls]).filter((e) => e[1].length)),
  },
  delays: {
    _note: 'Every setTimeout/setInterval with a literal delay. Spec 2.12 names four uncleared ones '
         + 'as defects, so this list is evidence and not decoration.',
    byScreen: Object.fromEntries(
      Object.entries(screens).map(([k, s]) => [k, s.delays]).filter((e) => e[1].length)),
  },
  screens,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -----------------------------------------------------------------------------

let totalKeys = 0, totalProps = 0, totalInline = 0, totalRender = 0;
for (const [key, s] of Object.entries(screens)) {
  const all = Object.assign({}, s.styles);
  if (s.extraStyles) for (const b of Object.values(s.extraStyles)) Object.assign(all, b);
  const k = Object.keys(all).length;
  const p = Object.values(all).reduce((a, x) => a + Object.keys(x).length, 0);
  const inl = Object.keys(s.inlineStyles).length;
  const rf = Object.keys(s.renderConstants).length;
  totalKeys += k; totalProps += p; totalInline += inl; totalRender += rf;
  console.log('  ' + key.padEnd(12) + ('(' + s._bindings.join('+') + ')').padEnd(20)
    + String(k).padStart(4) + ' keys' + String(p).padStart(6) + ' props'
    + String(inl).padStart(5) + ' inline' + String(rf).padStart(4) + ' fns');
}
console.log('  ' + 'TOTAL'.padEnd(32) + String(totalKeys).padStart(4) + ' keys'
  + String(totalProps).padStart(6) + ' props' + String(totalInline).padStart(5) + ' inline'
  + String(totalRender).padStart(4) + ' fns');
console.log('  distinct colours: ' + Object.keys(palette).length
  + '   top: ' + Object.keys(palette).slice(0, 6).join(' '));

// Unresolved values are a GATE, not a log — a value the evaluator cannot fold is a hole in the
// extraction, and a hole is invisible downstream.
const seen = new Set();
const rows = [];
let unexpected = 0;
for (const u of unresolved) {
  const sig = u.screen + '|' + u.where + '|' + u.text;
  if (seen.has(sig)) continue;
  seen.add(sig);
  const expected = EXPECTED_UNRESOLVED.test(u.where) || EXPECTED_UNRESOLVED.test(u.text);
  if (!expected) unexpected++;
  rows.push('    ' + (expected ? '     ' : '  !  ')
    + (u.screen + ' ' + u.where).padEnd(46) + u.kind.padEnd(18) + u.text);
}
if (rows.length) {
  console.log('\n  unresolved (' + rows.length + ' distinct, ' + unexpected + ' unexpected):');
  for (const r of rows.slice(0, 40)) console.log(r);
  if (rows.length > 40) console.log('    … and ' + (rows.length - 40) + ' more');
}
console.log('\nwrote tools/metrics/coach_styles.json ('
  + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
if (unexpected) {
  console.error('\nFAILED: ' + unexpected + ' unresolved value(s) marked "!" above. Each is a '
    + 'number the metrics layer will never see. Teach the evaluator, or seed the constant.');
  process.exit(1);
}
