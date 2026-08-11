#!/usr/bin/env node
/*
 * extract_puzzle_styles.js — pull the Puzzle Hub's real layout numbers out of the React Native
 * source, mechanically.
 *
 *     node tools/metrics/extract_puzzle_styles.js
 *     → tools/metrics/puzzle_styles.json   (COMMITTED)
 *
 * Same machine as `extract_board_styles.js`, over eleven files instead of three; the shared walk
 * lives in `rn_ast.js`. Why it exists is unchanged: the 23-part written spec is prose, and prose
 * loses information. Two concrete examples found while writing this, both of which a transcriber
 * would have got wrong:
 *
 *   1. The spec's Part 1 describes ONE "standard header" used by every screen, at
 *      `paddingTop 10, paddingBottom 6`. There is no shared header component — all eleven screens
 *      declare their own, and they disagree: the hub is `paddingVertical: 10`, the rated solver is
 *      `paddingVertical: 8`. The spec's number matches neither.
 *   2. The hub tints its mode tiles with `mode.color + '22'` and `+ '55'` — hex alpha by string
 *      concatenation. The spec rounds those to "13% alpha" and "33% alpha". 0x22/255 is 13.33%,
 *      0x55/255 is 33.33%. Pin the bytes, not the rounding.
 *
 * The output is committed, unlike Goldens/: whoever compiles the Swift may not have the sibling
 * RN repo, which is the same reasoning that commits `eco.tsv` and `board_styles.json`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./rn_ast.js');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const USER = path.join(FRONTEND, 'app', '(app)', 'user');
const OUT = path.join(__dirname, 'puzzle_styles.json');

const ts = RN.loadTypeScript(FRONTEND);

// Screen keys are the SPEC's names, not the folder names, so the metrics layer maps one-to-one.
// Two of the folders lie about their contents and the mapping is the first thing to get right:
//   * `play-puzzle/index.tsx` is the SOLVER; `play-puzzle/leaderboard.tsx` is its home. Every
//     other mode uses the opposite convention (`index` = home, `puzzle` = solver).
//   * the folder is `puzzle-rush`, but the user-facing name is Puzzle Turbo everywhere (Part 9.2).
const SCREENS = [
  { key: 'hub',            file: ['puzzle-hub', 'index.tsx'],        spec: 'Part 9' },
  { key: 'playHome',       file: ['play-puzzle', 'leaderboard.tsx'], spec: 'Part 10.1' },
  { key: 'playSolver',     file: ['play-puzzle', 'index.tsx'],       spec: 'Part 10.2 / 10.3' },
  { key: 'dailyHome',      file: ['daily-puzzle', 'index.tsx'],      spec: 'Part 11.2' },
  { key: 'dailySolver',    file: ['daily-puzzle', 'puzzle.tsx'],     spec: 'Part 11.3' },
  { key: 'thematicGrid',   file: ['thematic', 'index.tsx'],          spec: 'Part 12.2' },
  { key: 'thematicSolver', file: ['thematic', 'puzzle.tsx'],         spec: 'Part 12.3' },
  { key: 'streakHome',     file: ['puzzle-streak', 'index.tsx'],     spec: 'Part 13.1' },
  { key: 'streakSolver',   file: ['puzzle-streak', 'puzzle.tsx'],    spec: 'Part 13.3' },
  { key: 'turboHome',      file: ['puzzle-rush', 'index.tsx'],       spec: 'Part 14.1' },
  { key: 'turboRun',       file: ['puzzle-rush', 'rush-game.tsx'],   spec: 'Part 14.3' },
];

const SHARED = [
  { key: 'board', file: path.join(FRONTEND, 'components', 'DragDropChessBoard.tsx') },
  { key: 'logo',  file: path.join(FRONTEND, 'components', 'AppLogo.tsx') },
];

// ---- The board geometry, evaluated at a reference device -----------------------------------
// Identical to extract_board_styles.js: the formula lives in DragDropChessBoard.tsx, and the
// metrics layer keeps the FORMULA — these concrete numbers exist only so the extracted pixel
// values are comparable.
const REF_WIDTH = 390, REF_HEIGHT = 844, REF_RATIO = 3;
const BOARD_SIZE = (Math.floor(Math.round(REF_WIDTH * REF_RATIO) / 8) * 8) / REF_RATIO;
const SQUARE_SIZE = BOARD_SIZE / 8;

const SEED = {
  BOARD_SIZE, SQUARE_SIZE,
  width: REF_WIDTH, screenWidth: REF_WIDTH, screenHeight: REF_HEIGHT, height: REF_HEIGHT,
};

// ---- Walk ------------------------------------------------------------------------------------

const unresolved = [];
const screens = {};

function walkFile(key, file, spec) {
  if (!fs.existsSync(file)) { console.error('FATAL: missing ' + file); process.exit(1); }
  const sf = RN.parse(ts, file);
  const ev = RN.createEvaluator(ts, SEED);
  const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, sf, ev);
  const renderConstants = RN.findRenderLikeFunctions(ts, sf);
  const inlineStyles = RN.collectInlineStyles(ts, sf);
  for (const u of ev.unresolved) unresolved.push(Object.assign({ screen: key }, u));

  // Exactly one StyleSheet per puzzle file, but the binding name differs (`styles` in eight,
  // a bare `s` in three). Record the name: a consumer that guessed wrong would find nothing.
  const names = Object.keys(stylesheets);
  if (names.length !== 1) {
    console.error('FATAL: expected exactly one StyleSheet in ' + file + ', found ' + names.length);
    process.exit(1);
  }
  screens[key] = {
    _spec: spec,
    _source: path.relative(FRONTEND, file).replace(/\\/g, '/'),
    _binding: names[0],
    styles: stylesheets[names[0]],
    moduleConstants,
    renderConstants,
    inlineStyles,
    // Behaviour, not geometry — but the same argument applies. Sound names and delays were the
    // only numbers and strings in this port still typed by hand, and three of the sound names were
    // wrong precisely because nothing checked them against anything.
    soundCalls: RN.collectSoundCalls(ts, sf),
    delays: resolveDelays(RN.collectDelays(ts, sf), moduleConstants, key),
  };
}

/**
 * Turn `setTimeout(fn, COMPUTER_MOVE_DELAY)` into a number.
 *
 * A named delay that cannot be resolved is FATAL rather than skipped: a missing delay is invisible
 * downstream — the consumer just sees one fewer entry — and this extraction exists precisely so
 * that "invisible" stops being possible.
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

for (const s of SCREENS) walkFile(s.key, path.join(USER, ...s.file), s.spec);

// The sound hook is the vocabulary every solver draws on, so it is read once and kept whole.
const SOUND_HOOK_FILE = path.join(FRONTEND, 'hooks', 'usePuzzleSound.ts');
if (!fs.existsSync(SOUND_HOOK_FILE)) {
  console.error('FATAL: missing ' + SOUND_HOOK_FILE); process.exit(1);
}
const soundHook = RN.collectSoundHook(ts, SOUND_HOOK_FILE);
if (soundHook.keys.length !== 4) {
  console.error('FATAL: expected 4 SoundKeys, found ' + soundHook.keys.length
                + ' — the puzzle sound vocabulary changed and the metrics layer must follow');
  process.exit(1);
}

const shared = {};
for (const s of SHARED) {
  if (!fs.existsSync(s.file)) { console.error('FATAL: missing ' + s.file); process.exit(1); }
  const sf = RN.parse(ts, s.file);
  const ev = RN.createEvaluator(ts, SEED);
  const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, sf, ev);
  for (const u of ev.unresolved) unresolved.push(Object.assign({ screen: 'shared.' + s.key }, u));
  shared[s.key] = {
    _source: path.relative(FRONTEND, s.file).replace(/\\/g, '/'),
    styles: stylesheets,
    moduleConstants,
    inlineStyles: RN.collectInlineStyles(ts, sf),
  };
}

// ---- Cross-screen findings -------------------------------------------------------------------
//
// The spec claims a single "standard header". Prove or disprove it mechanically rather than
// asserting the prose: collect every screen's own header style and report them side by side, so a
// consumer encodes per-screen values when they differ and one shared value when they do not.

const headerVariants = {};
for (const [key, s] of Object.entries(screens)) {
  const h = s.styles.header;
  if (h) headerVariants[key] = h;
}
const headerSignatures = new Set(Object.values(headerVariants).map(h => JSON.stringify(h)));

// The palette, counted. Not decoration: it is how you tell the fifteen load-bearing colours from
// the ~90 one-off accents, and it makes an accidentally-introduced 91st visible in a diff.
const colourUse = {};
function countColours(obj) {
  for (const v of Object.values(obj || {})) {
    if (typeof v === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\()/.test(v)) {
      colourUse[v] = (colourUse[v] || 0) + 1;
    } else if (v && typeof v === 'object') countColours(v);
  }
}
for (const s of Object.values(screens)) countColours(s.styles);
const palette = Object.fromEntries(
  Object.entries(colourUse).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

// ---- Emit ---------------------------------------------------------------------------------

const out = {
  _generated: 'tools/metrics/extract_puzzle_styles.js — do not hand-edit',
  _note: 'The REAL StyleSheet numbers for the Puzzle Hub. The 23-part spec prose is secondary; '
       + 'where they disagree the deviation is recorded in PORTING_NOTES.md.',
  geometry: {
    _formula: 'BOARD_SIZE = floor(screenWidthPx / 8) * 8 / pixelRatio;  SQUARE_SIZE = BOARD_SIZE / 8',
    _source: 'BYAHERONG-COACH-FRONTEND/components/DragDropChessBoard.tsx',
    _note: 'Identical to the Analysis Board — the puzzle screens import the same component. The '
         + 'metrics layer keeps the FORMULA; these numbers are the reference device only.',
    referenceDevice: { width: REF_WIDTH, height: REF_HEIGHT, pixelRatio: REF_RATIO },
    BOARD_SIZE, SQUARE_SIZE,
  },
  headers: {
    _note: 'Part 1 of the spec describes ONE standard header (paddingTop 10, paddingBottom 6). '
         + 'There is no shared header component and the screens disagree — '
         + headerSignatures.size + ' distinct shapes across ' + Object.keys(headerVariants).length
         + ' screens. Encode per screen.',
    variants: headerVariants,
  },
  palette: {
    _note: 'Every colour literal in the eleven StyleSheets, by use count. A handful carry the '
         + 'screens; the long tail is one-off accents.',
    _distinct: Object.keys(palette).length,
    counts: palette,
  },
  sound: {
    _note: 'The puzzle path\'s entire sound vocabulary. Deliberately NARROWER than the Play '
         + 'screen\'s SoundManager: four keys, and playMoveSound is capture-or-move with no check '
         + 'or castle case. A screen asking for a fifth name is a bug, not a new feature.',
    _source: 'BYAHERONG-COACH-FRONTEND/hooks/usePuzzleSound.ts',
    hook: soundHook,
    byScreen: Object.fromEntries(
      Object.entries(screens).map(([k, s]) => [k, s.soundCalls]).filter(e => e[1].length)),
  },
  delays: {
    _note: 'Every setTimeout/setInterval with a literal delay. `abort: true` marks the network '
         + 'timeouts — recorded rather than dropped, because this app has no network and the '
         + 'absence of those call sites in the port is itself the thing worth being able to check.',
    byScreen: Object.fromEntries(
      Object.entries(screens).map(([k, s]) => [k, s.delays]).filter(e => e[1].length)),
  },
  shared,
  screens,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -----------------------------------------------------------------------------

let totalKeys = 0, totalProps = 0, totalInline = 0, totalRender = 0;
for (const [key, s] of Object.entries(screens)) {
  const k = Object.keys(s.styles).length;
  const p = Object.values(s.styles).reduce((a, x) => a + Object.keys(x).length, 0);
  const inl = Object.keys(s.inlineStyles).length;
  const rf = Object.keys(s.renderConstants).length;
  totalKeys += k; totalProps += p; totalInline += inl; totalRender += rf;
  console.log('  ' + key.padEnd(16) + ('(' + s._binding + ')').padEnd(9)
    + String(k).padStart(4) + ' keys' + String(p).padStart(6) + ' props'
    + String(inl).padStart(5) + ' inline' + String(rf).padStart(4) + ' render-fns');
}
console.log('  ' + 'TOTAL'.padEnd(25) + String(totalKeys).padStart(4) + ' keys'
  + String(totalProps).padStart(6) + ' props' + String(totalInline).padStart(5) + ' inline'
  + String(totalRender).padStart(4) + ' render-fns');
console.log('  distinct colours: ' + Object.keys(palette).length
  + '   top: ' + Object.keys(palette).slice(0, 6).join(' '));
console.log('  header shapes: ' + headerSignatures.size + ' distinct across '
  + Object.keys(headerVariants).length + ' screens'
  + (headerSignatures.size > 1 ? '  <- the spec claims one' : ''));

// Unresolved values are a GATE, not a log. A value the evaluator cannot fold is a hole in the
// extraction, and a hole is invisible downstream — the metrics layer simply never encodes that
// number and no assertion misses it. The one expected class is `PIECE_COMPONENTS`, which maps
// piece letters to imported SVG React components; those are not measurements.
const EXPECTED_UNRESOLVED = /^const\.PIECE_COMPONENTS\./;
const seen = new Set();
const rows = [];
let unexpected = 0;
for (const u of unresolved) {
  const sig = u.screen + '|' + u.where + '|' + u.text;
  if (seen.has(sig)) continue;
  seen.add(sig);
  const expected = EXPECTED_UNRESOLVED.test(u.where);
  if (!expected) unexpected++;
  rows.push('    ' + (expected ? '     ' : '  !  ')
    + (u.screen + ' ' + u.where).padEnd(44) + u.kind.padEnd(18) + u.text);
}
if (rows.length) {
  console.log('\n  unresolved (' + rows.length + ' distinct, ' + unexpected + ' unexpected):');
  for (const r of rows.slice(0, 40)) console.log(r);
  if (rows.length > 40) console.log('    … and ' + (rows.length - 40) + ' more');
}
console.log('\nwrote tools/metrics/puzzle_styles.json ('
  + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
if (unexpected) {
  console.error('\nFAILED: ' + unexpected + ' unresolved value(s) marked "!" above. Each is a '
    + 'number the metrics layer will never see. Teach the evaluator, or seed the constant.');
  process.exit(1);
}
