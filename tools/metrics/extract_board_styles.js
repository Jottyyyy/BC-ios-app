#!/usr/bin/env node
/*
 * extract_board_styles.js — pull the Analysis Board's real layout numbers out of the React Native
 * source, mechanically.
 *
 *     node tools/metrics/extract_board_styles.js
 *     → tools/metrics/board_styles.json   (COMMITTED — see below)
 *
 * Why this exists. The written spec for this screen is prose, and prose loses information. It says
 * "eval bar height 3"; the source has TWO eval bars — `evalBarTrack.height = 8` (the main bar under
 * the board) and `engineEvalBarTrack.height = 3` (the per-line micro bar). Transcribing by hand
 * would have sized the main bar wrong and nothing downstream would have caught it. The home screen
 * set the rule already: port "the real StyleSheet numbers, not prose".
 *
 * So this walks the TypeScript AST of board.tsx and emits every resolved value. `AnalysisMetrics.swift`
 * and `web-demo/js/analysis-metrics.js` then assert their encoded constants against the output, which
 * makes the metrics layer oracle-tested rather than eyeballed.
 *
 * The output is **committed**, unlike Goldens/. It derives from the sibling RN repo, which the person
 * compiling the Swift may not have — the same reasoning that commits `eco.tsv`.
 *
 * Requires `typescript`, which is already present in the sibling repo's node_modules (v5.9.3). No
 * install, no network.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const BOARD_TSX = path.join(FRONTEND, 'app', '(app)', 'user', 'analysis-board', 'board.tsx');
const DRAG_TSX = path.join(FRONTEND, 'components', 'DragDropChessBoard.tsx');
const GRAPH_TSX = path.join(FRONTEND, 'components', 'EvalGraph.tsx');
const OUT = path.join(__dirname, 'board_styles.json');

// The AST evaluator, the StyleSheet walker and the signed-term describer live in rn_ast.js — the
// Puzzle Hub's extractor needs exactly the same machinery over eleven more files. This file's
// output must stay byte-identical across that refactor, which is how the move was verified.
const RN = require('./rn_ast.js');
const ts = RN.loadTypeScript(FRONTEND);
for (const f of [BOARD_TSX, DRAG_TSX, GRAPH_TSX]) {
  if (!fs.existsSync(f)) { console.error('FATAL: missing ' + f); process.exit(1); }
}

// ---- Pre-seeded free variables ---------------------------------------------
// The board geometry formula lives in DragDropChessBoard.tsx, not board.tsx:
//     _physicalBoardSize = floor(window.width * PixelRatio.get() / 8) * 8
//     BOARD_SIZE = _physicalBoardSize / ratio;  SQUARE_SIZE = BOARD_SIZE / 8
// which is exactly the spec's rule. We evaluate it at a reference device so the extracted pixel
// values are concrete and comparable; the metrics layer keeps the FORMULA, not these numbers.
const REF_WIDTH = 390;      // iPhone 14/15 logical points
const REF_HEIGHT = 844;
const REF_RATIO = 3;        // @3x

const physicalWidth = Math.round(REF_WIDTH * REF_RATIO);
const BOARD_SIZE = (Math.floor(physicalWidth / 8) * 8) / REF_RATIO;
const SQUARE_SIZE = BOARD_SIZE / 8;

const SEED = {
  BOARD_SIZE: BOARD_SIZE,
  SQUARE_SIZE: SQUARE_SIZE,
  EDIT_BOARD_SIZE: BOARD_SIZE,
  EDIT_SQUARE_SIZE: BOARD_SIZE / 8,
  EDIT_PALETTE_BTN_SIZE: 36,
  EDIT_PALETTE_PIECE_SIZE: 26,
  PALETTE_BTN_SIZE: Math.floor((BOARD_SIZE - 28 - 30) / 6),
  PALETTE_PIECE_SIZE: Math.round(Math.floor((BOARD_SIZE - 28 - 30) / 6) * 0.7),
  width: REF_WIDTH,
  screenHeight: REF_HEIGHT,
};

// ---- Walk board.tsx ---------------------------------------------------------

const boardSF = RN.parse(ts, BOARD_TSX);
const ev = RN.createEvaluator(ts, SEED);
const unresolved = ev.unresolved;
const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, boardSF, ev);

// ---- Render-function constants ----------------------------------------------------
//
// The StyleSheet walk above cannot see the geometry that lives INSIDE a render function — the
// arrow widths, the annotation badge's radius and corner offsets, the text baseline. Those were
// left on the plan's hand-transcribe list, and hand-transcription is exactly what went wrong:
// `renderAnnotationOverlay` puts the badge at `pos.y + SQUARE_SIZE * 0.29` (BELOW the centre, since
// `squareToPixel` returns the centre), and both metrics layers were written with a MINUS and then
// asserted each other's wrong answer. Two hand-typed copies agreeing is not verification.
//
// So extract the expressions themselves. Each `const NAME = <expr>` and each braced JSX attribute
// inside the named functions is flattened into signed additive TERMS, so a consumer can assert the
// DIRECTION of an offset and not merely its magnitude.

const RENDER_FUNCTIONS = ['squareToPixel', 'renderArrowsOverlay', 'renderAnnotationOverlay',
                          'renderEditSquare'];

const renderConstants = RN.findNamedFunctions(ts, boardSF, RENDER_FUNCTIONS);

for (const f of RENDER_FUNCTIONS) {
  if (!renderConstants[f]) { console.error('FATAL: render function not found in board.tsx: ' + f); process.exit(1); }
}

// ---- The board geometry formula, from the other file ------------------------

const dragText = fs.readFileSync(DRAG_TSX, 'utf8');
const formulaLines = dragText.split('\n')
  .map((l, i) => ({ n: i + 1, l: l.trim() }))
  .filter(x => /_physicalBoardSize|BOARD_SIZE\s*=|SQUARE_SIZE\s*=|PixelRatio\.get/.test(x.l))
  .map(x => x.n + ': ' + x.l);

// ---- The eval graph ---------------------------------------------------------------
//
// `components/EvalGraph.tsx` draws its own SVG, so its colours live in JSX attributes rather than a
// StyleSheet and the AST walk above never sees them. That matters: the graph paints `#1A2740` over
// a wrapper the modal has already painted `#0F1A2E`, and hand-transcribing the pair is exactly the
// kind of thing that silently ships the wrong shade.
//
// A targeted scan of the SVG elements is cruder than the StyleSheet walk, but it still RE-DERIVES
// on every run instead of trusting a copy, which is the whole point.

const graphText = fs.readFileSync(GRAPH_TSX, 'utf8');
function graphAttr(element, attr) {
  // e.g. <Rect ... fill="#1A2740" rx={6} />  — match within the element's own tag.
  const tag = new RegExp('<' + element + '\\b[^>]*?>', 's');
  const m = tag.exec(graphText);
  if (!m) return undefined;
  const str = new RegExp(attr + '="([^"]*)"').exec(m[0]);
  if (str) return str[1];
  const num = new RegExp(attr + '=\\{([-0-9.]+)\\}').exec(m[0]);
  return num ? Number(num[1]) : undefined;
}
const evalGraph = {
  _source: 'BYAHERONG-COACH-FRONTEND/components/EvalGraph.tsx',
  _note: 'Scanned from the SVG element attributes; this file has no StyleSheet for them.',
  clamp: (/const CLAMP = (\d+)/.exec(graphText) || [])[1] !== undefined
    ? Number(/const CLAMP = (\d+)/.exec(graphText)[1]) : undefined,
  background: graphAttr('Rect', 'fill'),
  backgroundRadius: graphAttr('Rect', 'rx'),
  whiteFill: (/Polygon points=\{whitePoints\} fill="([^"]*)"/.exec(graphText) || [])[1],
  blackFill: (/Polygon points=\{blackPoints\} fill="([^"]*)"/.exec(graphText) || [])[1],
  midLine: graphAttr('Line', 'stroke'),
  midLineWidth: graphAttr('Line', 'strokeWidth'),
  curve: graphAttr('Polyline', 'stroke'),
  curveWidth: graphAttr('Polyline', 'strokeWidth'),
  containerRadius: (/borderRadius: (\d+)/.exec(graphText) || [])[1] !== undefined
    ? Number(/borderRadius: (\d+)/.exec(graphText)[1]) : undefined,
};

// ---- Device-derived values ------------------------------------------------------
//
// Anything the source computed from `Dimensions.get('window')` has been FOLDED against the
// reference device, so it lands in the JSON as a plain number: `screenHeight * 0.80` becomes
// `675.2`. Transcribing that literal would be correct on a 390x844 iPhone and wrong on every other
// device — and nothing downstream would notice, because the value is a perfectly ordinary number.
//
// So flag them. Any value that is an exact, tidy multiple of the reference width or height is
// almost certainly a folded ratio; the consumer should encode the RATIO instead. Board- and
// square-sized values are excluded: those are genuinely the board, and the metrics layer already
// derives them from `AnalysisBoard.size(screenWidth:pixelRatio:)`.

function ratioIfDerived(v, base) {
  if (typeof v !== 'number' || Number.isInteger(v) || v <= 0) return null;
  const r = v / base;
  const rounded = Math.round(r * 1000) / 1000;
  // Tidy means it survives a round-trip at three decimals, and is a plausible fraction of a screen.
  if (Math.abs(r - rounded) > 1e-9 || rounded <= 0.02 || rounded >= 2) return null;
  return rounded;
}

const deviceDerived = {};
for (const [blockName, block] of Object.entries(stylesheets)) {
  for (const [key, style] of Object.entries(block)) {
    for (const [prop, v] of Object.entries(style)) {
      if (v === BOARD_SIZE || v === SQUARE_SIZE) continue;     // genuinely the board
      const w = ratioIfDerived(v, REF_WIDTH);
      const h = ratioIfDerived(v, REF_HEIGHT);
      if (!w && !h) continue;
      deviceDerived[blockName + '.' + key + '.' + prop] = {
        value: v,
        ...(w ? { widthRatio: w } : {}),
        ...(h ? { heightRatio: h } : {}),
      };
    }
  }
}

// ---- Emit --------------------------------------------------------------------

const out = {
  _generated: 'tools/metrics/extract_board_styles.js — do not hand-edit',
  _source: 'BYAHERONG-COACH-FRONTEND/app/(app)/user/analysis-board/board.tsx',
  _note: 'Values are the REAL StyleSheet numbers. The spec prose is secondary; where they disagree, '
       + 'the deviation is recorded in PORTING_NOTES.md.',
  geometry: {
    _formula: 'BOARD_SIZE = floor(screenWidthPx / 8) * 8 / pixelRatio;  SQUARE_SIZE = BOARD_SIZE / 8',
    _source: 'BYAHERONG-COACH-FRONTEND/components/DragDropChessBoard.tsx',
    _sourceLines: formulaLines,
    referenceDevice: { width: REF_WIDTH, height: REF_HEIGHT, pixelRatio: REF_RATIO },
    BOARD_SIZE: BOARD_SIZE,
    SQUARE_SIZE: SQUARE_SIZE,
  },
  _deviceDerived: {
    _note: 'Values folded from Dimensions.get() against the reference device. Encode the RATIO, '
         + 'never the literal — it is wrong on every other screen size.',
    values: deviceDerived,
  },
  evalGraph: evalGraph,
  renderConstants: Object.assign({
    _note: 'Geometry that lives inside a render function, where no StyleSheet can hold it. Each '
         + 'expression is flattened into signed additive terms so a consumer asserts the DIRECTION '
         + 'of an offset, not only its size. `squareToPixel` is included because it defines the '
         + 'anchor every one of these offsets is measured from — it returns the square CENTRE.',
  }, renderConstants),
  moduleConstants: moduleConstants,
  stylesheets: stylesheets,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -------------------------------------------------------------------

let keys = 0, props = 0;
for (const [name, block] of Object.entries(stylesheets)) {
  const k = Object.keys(block).length;
  keys += k;
  props += Object.values(block).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log('  ' + name.padEnd(20) + String(k).padStart(4) + ' keys');
}
console.log('  ' + 'TOTAL'.padEnd(20) + String(keys).padStart(4) + ' keys, ' + props + ' properties');
console.log('  module constants     ' + Object.keys(moduleConstants).join(', '));
console.log('  geometry @' + REF_WIDTH + 'x' + REF_HEIGHT + '@' + REF_RATIO + 'x: BOARD_SIZE=' + BOARD_SIZE
  + '  SQUARE_SIZE=' + SQUARE_SIZE);
const ddKeys = Object.keys(deviceDerived);
console.log('  device-derived (encode the RATIO, not the value): ' + (ddKeys.length || 'none'));
for (const k of ddKeys) {
  const d = deviceDerived[k];
  console.log('    ' + k.padEnd(40) + d.value
    + (d.widthRatio ? '  = W*' + d.widthRatio : '') + (d.heightRatio ? '  = H*' + d.heightRatio : ''));
}

if (unresolved.length) {
  console.log('\n  unresolved (' + unresolved.length + '):');
  const seen = new Set();
  for (const u of unresolved) {
    const sig = u.kind + '|' + u.text;
    if (seen.has(sig)) continue;
    seen.add(sig);
    console.log('    ' + u.where.padEnd(42) + u.kind.padEnd(22) + u.text);
  }
}
console.log('\nwrote tools/metrics/board_styles.json (' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
