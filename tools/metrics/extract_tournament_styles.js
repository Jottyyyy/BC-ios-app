#!/usr/bin/env node
/*
 * extract_tournament_styles.js — pull the Pairing Manager's real layout numbers out of the React
 * Native source, mechanically.
 *
 *     node tools/metrics/extract_tournament_styles.js
 *     → tools/metrics/tournament_styles.json   (COMMITTED)
 *
 * Third extractor, same machine (`rn_ast.js`) as the board and the puzzles. The reason is the one
 * that has already cost this port twice: prose loses information, and two hand-typed copies
 * agreeing with each other is not verification.
 *
 * Three things in these three files that a transcriber would get wrong, all found by running this:
 *
 *   1. The spec's §1.2/§1.3 give the header as `h 16 / v 12` and §1.4 as `h 16 / v 10`. That is
 *      correct — but only because there are THREE separate headers, one per screen, and no shared
 *      component. Same finding as the puzzle port. Encode per screen.
 *   2. The list card's type badge fills with `getTypeColor(item.type) + '22'` — hex alpha by string
 *      concatenation (`index.tsx:101`). The spec rounds it to "13% alpha". 0x22/255 is 13.33 %.
 *      Pin the byte.
 *   3. `[id].tsx` declares TWO StyleSheets — `styles` for the screen and `shareStyles` for the
 *      off-screen share card. The puzzle extractor asserts exactly one binding per file and would
 *      exit here; both are recorded, because the share card's numbers are a separate design at
 *      ~90 % scale and merging them would silently overwrite half of each.
 *
 * The output is committed, unlike Goldens/: whoever compiles the Swift may not have the sibling
 * RN repo — the same reasoning that commits `eco.tsv`, `board_styles.json` and `puzzle_styles.json`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./rn_ast.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const TOURN = path.join(FRONTEND, 'app', '(app)', 'user', 'tournaments');
const OUT = path.join(__dirname, 'tournament_styles.json');

const ts = RN.loadTypeScript(FRONTEND);

// Screen keys are the SPEC's names (§1.2–1.4), so the metrics layer maps one-to-one.
const SCREENS = [
  { key: 'list',   file: 'index.tsx',  spec: '1.2' },
  { key: 'create', file: 'create.tsx', spec: '1.3' },
  { key: 'detail', file: '[id].tsx',   spec: '1.4 / 1.5 / 1.6' },
];

/**
 * `[id].tsx` builds its shared plain-text with two named helpers rather than `render*` ones, so
 * `findRenderLikeFunctions` — which discovers by naming convention — returns nothing for this file.
 * Name them explicitly. They matter: §1.6's plain-text fallback is defined by what these emit,
 * including the 21-character rule and the two spaces in the hashtag line.
 */
const NAMED_FUNCTIONS = ['buildRoundText', 'buildStandingsText', 'parseBulkLine', 'getTypeColor',
                         'getStatusColor', 'formatScore'];

/**
 * The type/status colour maps, which `collectRenderFunction` returns EMPTY for.
 *
 * That walker looks for style-ish values; these four functions are pure `condition -> string
 * literal` maps (`index.tsx:84-91`) and it sees nothing in them. Left alone, the six colours that
 * decide what a SWISS badge and an ONGOING dot look like would be the only numbers in this feature
 * still typed by hand — which is exactly the class of value this whole extractor exists to remove.
 *
 * Recorded as an ORDERED list of `{ when, value }`, because these are if-chains and ternaries where
 * the order is the semantics: `getStatusColor` returns gold for anything that is neither ongoing nor
 * finished, so the fallback must stay last.
 */
// `typeColor` is not a function — the detail screen writes the same mapping as a plain ternary
// binding (`[id].tsx:400`). Included so the two screens' copies are extracted side by side and can
// be asserted equal, rather than assumed equal.
const COLOR_MAP_FUNCTIONS = ['getTypeColor', 'getStatusColor', 'getTypeLabel', 'getResultText',
                             'typeColor'];

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
        if (ts.isBlock(n)) { n.statements.forEach(st => scan(st, cond)); return; }
        if (ts.isParenthesizedExpression(n)) { scan(n.expression, cond); return; }
      })(ts.isArrowFunction(node.initializer) ? node.initializer.body : node.initializer, 'else');
      if (cases.length) out[node.name.text] = cases;
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

// ---- Seeds -------------------------------------------------------------------------------
//
// No board geometry here — these screens draw no board. What they DO have is a share card sized in
// device pixels (`captureRef(..., { width: 360 * PixelRatio.get() })`, [id].tsx:327) and two
// safe-area reads. Seeding them keeps the evaluator's `unresolved` list meaningful: an unresolved
// value is supposed to mean "a number the metrics layer will never see", and drowning that signal
// in three known-dynamic reads is how the gate stops working.
const REF_WIDTH = 390, REF_HEIGHT = 844, REF_RATIO = 3;
const SHARE_CARD_WIDTH = 360;

const SEED = {
  width: REF_WIDTH, screenWidth: REF_WIDTH, screenHeight: REF_HEIGHT, height: REF_HEIGHT,
  SHARE_CARD_WIDTH,
};

// `insets.bottom` is a runtime safe-area value, not a design constant. The spec writes every use of
// it as `safeArea + N`, so what must survive extraction is the OFFSET, which `additiveTerms` keeps
// as a signed term regardless. Whitelisted rather than seeded, so a fake number never leaks into
// the JSON as though it were measured.
const EXPECTED_UNRESOLVED = /(^|\.)insets\b|useSafeAreaInsets/;

// ---- Walk ------------------------------------------------------------------------------------

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

  // One StyleSheet in the list and create screens, TWO in the detail screen (`styles` +
  // `shareStyles`). Both are kept whole and keyed by binding name — a consumer that guessed the
  // name, or that merged them, would find the wrong numbers rather than none.
  const names = Object.keys(stylesheets);
  if (names.length < 1 || names.length > 2) {
    console.error('FATAL: expected one or two StyleSheets in ' + file + ', found ' + names.length
                  + ' (' + names.join(', ') + ')');
    process.exit(1);
  }
  screens[key] = {
    _spec: spec,
    _source: path.relative(FRONTEND, file).replace(/\\/g, '/'),
    _bindings: names,
    styles: stylesheets[names[0]],
    // Present only on the detail screen. Named rather than folded in, because it is a distinct
    // design: §1.6 renders the same rows at ~90 % scale into a 360pt card.
    shareStyles: names.length > 1 ? stylesheets[names[1]] : null,
    moduleConstants,
    renderConstants,
    colorMaps: collectColorMaps(ts, sf, COLOR_MAP_FUNCTIONS),
    inlineStyles,
    delays: resolveDelays(RN.collectDelays(ts, sf), moduleConstants, key),
  };
}

/**
 * Turn `setTimeout(fn, CAPTURE_WAIT)` into a number.
 *
 * A named delay that cannot be resolved is FATAL rather than skipped, for the same reason as in the
 * puzzle extractor: a missing delay is invisible downstream. Both delays here are the pre-capture
 * waits before `captureRef` ([id].tsx:326, :370) — the one piece of timing in the whole feature.
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

for (const s of SCREENS) walkFile(s.key, path.join(TOURN, s.file), s.spec);

// ---- Cross-screen findings -------------------------------------------------------------------
//
// Same check as the puzzle extractor, and it finds the same thing: prove or disprove the "one
// standard header" claim mechanically rather than believing the prose.

const headerVariants = {};
for (const [key, s] of Object.entries(screens)) {
  if (s.styles.header) headerVariants[key] = s.styles.header;
}
const headerSignatures = new Set(Object.values(headerVariants).map(h => JSON.stringify(h)));

// The palette, counted — how you tell the load-bearing colours from the one-off accents, and what
// makes an accidentally-introduced new one visible in a diff.
const colourUse = {};
function countColours(obj) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(v)) {
      colourUse[v] = (colourUse[v] || 0) + 1;
    } else if (v && typeof v === 'object') countColours(v);
  }
}
for (const s of Object.values(screens)) { countColours(s.styles); countColours(s.shareStyles); }
const palette = Object.fromEntries(
  Object.entries(colourUse).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

// ---- Emit ---------------------------------------------------------------------------------

const out = {
  _generated: 'tools/metrics/extract_tournament_styles.js — do not hand-edit',
  _note: 'The REAL StyleSheet numbers for the Pairing Manager. Spec §1.2–1.6 prose is secondary; '
       + 'where they disagree the deviation is recorded in PORTING_NOTES.md.',
  shareCard: {
    _note: 'The share card is captured off-screen at `left: -9999` and rasterised at '
         + '`SHARE_CARD_WIDTH * PixelRatio.get()`. The WIDTH is the design constant; the pixel '
         + 'ratio is the device. Only the former belongs in the metrics layer.',
    _source: 'app/(app)/user/tournaments/[id].tsx',
    width: SHARE_CARD_WIDTH,
    referenceDevice: { width: REF_WIDTH, height: REF_HEIGHT, pixelRatio: REF_RATIO },
  },
  headers: {
    _note: 'Spec §1.2/§1.3 say `h 16 / v 12` and §1.4 says `h 16 / v 10`. There is no shared '
         + 'header component — ' + headerSignatures.size + ' distinct shapes across '
         + Object.keys(headerVariants).length + ' screens. Encode per screen.',
    variants: headerVariants,
  },
  palette: {
    _note: 'Every colour literal in the four StyleSheets (three screens, plus the share card), by '
         + 'use count.',
    _distinct: Object.keys(palette).length,
    counts: palette,
  },
  delays: {
    _note: 'Every setTimeout/setInterval with a literal delay. In this feature they are the waits '
         + 'before capturing the off-screen share card — the only timing the Pairing Manager has.',
    byScreen: Object.fromEntries(
      Object.entries(screens).map(([k, s]) => [k, s.delays]).filter(e => e[1].length)),
  },
  screens,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -----------------------------------------------------------------------------

let totalKeys = 0, totalProps = 0, totalInline = 0, totalRender = 0;
for (const [key, s] of Object.entries(screens)) {
  const all = Object.assign({}, s.styles, s.shareStyles || {});
  const k = Object.keys(all).length;
  const p = Object.values(all).reduce((a, x) => a + Object.keys(x).length, 0);
  const inl = Object.keys(s.inlineStyles).length;
  const rf = Object.keys(s.renderConstants).length;
  totalKeys += k; totalProps += p; totalInline += inl; totalRender += rf;
  console.log('  ' + key.padEnd(10) + ('(' + s._bindings.join('+') + ')').padEnd(22)
    + String(k).padStart(4) + ' keys' + String(p).padStart(6) + ' props'
    + String(inl).padStart(5) + ' inline' + String(rf).padStart(4) + ' fns');
}
console.log('  ' + 'TOTAL'.padEnd(32) + String(totalKeys).padStart(4) + ' keys'
  + String(totalProps).padStart(6) + ' props' + String(totalInline).padStart(5) + ' inline'
  + String(totalRender).padStart(4) + ' fns');
console.log('  distinct colours: ' + Object.keys(palette).length
  + '   top: ' + Object.keys(palette).slice(0, 6).join(' '));
console.log('  header shapes: ' + headerSignatures.size + ' distinct across '
  + Object.keys(headerVariants).length + ' screens'
  + (headerSignatures.size > 1 ? '  <- the spec implies one per screen; confirmed' : ''));

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
    + (u.screen + ' ' + u.where).padEnd(44) + u.kind.padEnd(18) + u.text);
}
if (rows.length) {
  console.log('\n  unresolved (' + rows.length + ' distinct, ' + unexpected + ' unexpected):');
  for (const r of rows.slice(0, 40)) console.log(r);
  if (rows.length > 40) console.log('    … and ' + (rows.length - 40) + ' more');
}
console.log('\nwrote tools/metrics/tournament_styles.json ('
  + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
if (unexpected) {
  console.error('\nFAILED: ' + unexpected + ' unresolved value(s) marked "!" above. Each is a '
    + 'number the metrics layer will never see. Teach the evaluator, or seed the constant.');
  process.exit(1);
}
