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
// `../BYAHERONG-COACH-FRONTEND` is right from a normal checkout and WRONG from a git worktree: a
// worktree sits three levels down in `.claude/worktrees/<slug>`, so the relative hop lands on
// `.claude/worktrees/BYAHERONG-COACH-FRONTEND` and the tool dies claiming the sibling repo is
// missing. `FRONTEND_ROOT` is the same escape hatch `LARAVEL_ROOT` already gives the oracle, and
// docs/git-workflow.md documents that trap for exactly this reason.
const FRONTEND = process.env.FRONTEND_ROOT
  ? path.resolve(process.env.FRONTEND_ROOT)
  : path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
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

// ---- Variations: the strip's branch continuation, and both branch modals ----------
//
// Three things the StyleSheet walk cannot see, all of which the port needs and none of which may be
// retyped:
//
//  1. `renderHorizontalMoveTree`'s active branch continuation (board.tsx:3125-3158) colours its
//     arrow, numbers and moves with INLINE literals, not style keys. The port stopped five lines
//     above that block, and the client reported the result as variations being erased.
//  2. "Choose Continuation" keeps its styles in the StyleSheet, but its COPY in JSX text.
//  3. "Line Already Exists" lives in its own file, `BranchConfirmModal.tsx`, which this extractor
//     had never read — styles and copy both.
//
// A targeted text scan, like the eval graph's: cruder than the AST walk, but re-derived on every
// run. Every miss is FATAL, the same as a missing render function — a quiet `undefined` is how a
// check ends up asserting nothing.

const BRANCH_TSX = path.join(FRONTEND, 'app', '(app)', 'user', 'analysis-board', 'BranchConfirmModal.tsx');
if (!fs.existsSync(BRANCH_TSX)) { console.error('FATAL: missing ' + BRANCH_TSX); process.exit(1); }
const boardText = fs.readFileSync(BOARD_TSX, 'utf8');
const branchText = fs.readFileSync(BRANCH_TSX, 'utf8');

function mustMatch(re, text, what) {
  const m = re.exec(text);
  if (!m) { console.error('FATAL: could not extract ' + what); process.exit(1); }
  return m[1];
}
/** `const name = …` up to the next top-level-in-component `const`, which ends a render function. */
function fnBody(text, name) {
  const at = text.indexOf('  const ' + name + ' = ');
  if (at < 0) { console.error('FATAL: function not found in board.tsx: ' + name); process.exit(1); }
  const next = text.indexOf('\n  const ', at + 1);
  return text.slice(at, next < 0 ? undefined : next);
}
/** Turn the modal's JSX placeholders into the neutral `{existing}` / `{new}` both ports fill in. */
const placeholders = (s) => s.replace(/\{existingMainlineSan\}/g, '{existing}')
  .replace(/\{newMoveSan\}/g, '{new}');

const horiz = fnBody(boardText, 'renderHorizontalMoveTree');
const cont = horiz.slice(horiz.indexOf('!isOnMainLine)'));
if (cont.length === horiz.length) { console.error('FATAL: branch continuation block not found'); process.exit(1); }
const stripContinuation = {
  _source: 'board.tsx renderHorizontalMoveTree — the `if (currentNode && !isOnMainLine)` block',
  _note: 'Inline literals: the colours here are NOT in any style key. Shown from where the line leaves '
       + 'the main line up to the cursor, numbered before White only.',
  arrow: mustMatch(/key="branch-arrow"[\s\S]*?\? '[^']*' : '([^']+)'/, cont, 'continuation arrow'),
  arrowStyle: mustMatch(/key="branch-arrow" style=\{\[styles\.(\w+)/, cont, 'arrow base style'),
  arrowColor: mustMatch(/key="branch-arrow" style=\{\[styles\.\w+, \{[^}]*color: '([^']+)'/, cont, 'arrow colour'),
  numberColor: mustMatch(/key=\{`bnum-[^`]*`\} style=\{\[styles\.\w+, \{[^}]*color: '([^']+)'/, cont, 'number colour'),
  moveStyle: mustMatch(/key=\{`branch-[\s\S]*?style=\{\[styles\.(\w+), \{/, cont, 'move base style'),
  moveColor: mustMatch(/key=\{`branch-[\s\S]*?styles\.\w+, \{[^}]*color: '([^']+)' \}/, cont, 'move colour'),
};

const selection = fnBody(boardText, 'renderBranchSelectionModal');
const preview = fnBody(boardText, 'buildBranchPreview');
const branchSelection = {
  _source: 'board.tsx renderBranchSelectionModal + buildBranchPreview — copy only; styles are in stylesheets',
  title: mustMatch(/<Text style=\{styles\.branchModalTitle\}>([^<]+)<\/Text>/, selection, 'picker title'),
  subtitle: mustMatch(/<Text style=\{styles\.branchModalSub\}>([^<]+)<\/Text>/, selection, 'picker subtitle'),
  mainLineTag: mustMatch(/i === 0 \? '([^']+)' : ''/, selection, 'main-line tag'),
  arrow: mustMatch(/<Text style=\{styles\.branchOptionArrow\}>([^<]+)<\/Text>/, selection, 'option arrow'),
  cancel: mustMatch(/<Text style=\{styles\.branchCancelBtnText\}>([^<]+)<\/Text>/, selection, 'picker cancel'),
  previewMoves: Number(mustMatch(/count < (\d+)/, preview, 'preview length')),
  previewEllipsis: mustMatch(/if \(n\) text \+= '([^']+)'/, preview, 'preview ellipsis'),
};

// The subtitle is JSX text interleaved with two bold <Text> runs. JSX trims each line and drops
// newlines that sit next to a tag, and `{' '}` is a literal space — so: trim, join, then substitute.
const subtitleJsx = mustMatch(/<Text style=\{styles\.subtitle\}>([\s\S]*?)<\/Text>\s*\n\s*<TouchableOpacity/,
  branchText, 'confirm subtitle');
const confirmSubtitle = placeholders(subtitleJsx.split('\n').map((l) => l.trim()).filter(Boolean).join('')
  .replace(/\{' '\}/g, ' ')
  .replace(/<Text style=\{styles\.subtitleBold\}>(\{\w+\})<\/Text>/g, '$1'));
const pillLabels = [];
for (const m of branchText.matchAll(/<Text style=\{styles\.movePillLabel\}>([^<]+)<\/Text>/g)) pillLabels.push(m[1]);
if (pillLabels.length !== 2) { console.error('FATAL: expected two pill labels, got ' + pillLabels.length); process.exit(1); }
const button = (key) => placeholders(mustMatch(
  new RegExp('<Text style=\\{styles\\.' + key + '\\}>\\s*([\\s\\S]*?)\\s*</Text>'), branchText, key));
const branchConfirm = {
  _source: 'BYAHERONG-COACH-FRONTEND/app/(app)/user/analysis-board/BranchConfirmModal.tsx',
  _note: 'Raised by executeMove (board.tsx:1357-1368) when a move is played where a continuation '
       + 'exists and the move is not one of them. `{existing}`/`{new}` are the two SANs.',
  copy: {
    title: mustMatch(/<Text style=\{styles\.title\}>([^<]+)<\/Text>/, branchText, 'confirm title'),
    currentLabel: pillLabels[0],
    newLabel: pillLabels[1],
    separator: mustMatch(/<Text style=\{styles\.moveSeparator\}>([^<]+)<\/Text>/, branchText, 'separator'),
    subtitle: confirmSubtitle,
    overwrite: button('btnOverwriteText'),
    newBranch: button('btnNewBranchText'),
    cancel: button('btnBackText'),
  },
  styles: RN.collectStyleSheets(ts, RN.parse(ts, BRANCH_TSX), RN.createEvaluator(ts, SEED)).stylesheets.styles,
};
if (!branchConfirm.styles) { console.error('FATAL: BranchConfirmModal.tsx StyleSheet not found'); process.exit(1); }

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

// ---- Drag-to-move, from the same file -----------------------------------------
//
// The lift lives in `Gesture.Pan()` worklets and `useAnimatedStyle` callbacks. The StyleSheet walk
// cannot see either — `styles` in DragDropChessBoard.tsx holds the squares and the labels and
// nothing at all about a piece that has left the board. So this is a targeted scan, cruder in
// exactly the way the eval graph's is and for exactly the same reason: it RE-DERIVES on every run
// instead of trusting a copy.
//
// Every length is a MULTIPLE of SQUARE_SIZE, never a pixel count. The board is sized per device, so
// a folded value would be right on a 390@3x phone and wrong on every other one — the trap
// `_deviceDerived` above exists to flag.

function dragNum(re, what) {
  const m = re.exec(dragText);
  if (!m) {
    console.error('FATAL: drag constant not found in DragDropChessBoard.tsx: ' + what);
    process.exit(1);
  }
  return Number(m[1]);
}
function dragStr(re, what) {
  const m = re.exec(dragText);
  if (!m) {
    console.error('FATAL: drag value not found in DragDropChessBoard.tsx: ' + what);
    process.exit(1);
  }
  return m[1];
}

// Reanimated states a spring as (stiffness, damping, mass); SwiftUI states the same physical spring
// as (response, dampingFraction). Converted here rather than eyeballed, so the curve is the source's
// own and not a guess that looked close:
//     response        = 2π / √(stiffness / mass)        — the undamped period
//     dampingFraction = damping / (2 · √(stiffness · mass))
function swiftUISpring(stiffness, damping, mass) {
  return {
    response: Math.round((2 * Math.PI / Math.sqrt(stiffness / mass)) * 10000) / 10000,
    dampingFraction: Math.round((damping / (2 * Math.sqrt(stiffness * mass))) * 10000) / 10000,
  };
}
function springAt(re, what) {
  const m = re.exec(dragText);
  if (!m) {
    console.error('FATAL: spring not found in DragDropChessBoard.tsx: ' + what);
    process.exit(1);
  }
  const [, stiffness, damping, mass] = m.map(Number);
  return { stiffness, damping, mass, swiftUI: swiftUISpring(stiffness, damping, mass) };
}
const SPRING = (to) => new RegExp(
  'withSpring\\(' + to + ',\\s*\\{ stiffness: (\\d+), damping: (\\d+), mass: ([0-9.]+)');

const dragConstants = {
  _note: 'The lifted piece, re-derived from the RN gesture worklets on every run. Lengths are '
       + 'multiples of SQUARE_SIZE; anchors are fractions of the FLOAT BOX, which is what the '
       + 'source offsets against. The springs are converted to SwiftUI\'s (response, '
       + 'dampingFraction) by the standard identities, not matched by eye.',
  _source: 'BYAHERONG-COACH-FRONTEND/components/DragDropChessBoard.tsx',

  // Sizes, in squares. The RESTING piece is 0.95 of a square, so the lift is 1.3/0.95 as seen.
  floatBoxSquares: dragNum(/FLOAT_SIZE\s*=\s*SQUARE_SIZE\s*\*\s*([0-9.]+)/, 'FLOAT_SIZE'),
  floatPieceSquares: dragNum(/FLOAT_PIECE_SIZE\s*=\s*SQUARE_SIZE\s*\*\s*([0-9.]+)/, 'FLOAT_PIECE_SIZE'),
  restingPieceSquares: dragNum(/PieceComp width=\{SQUARE_SIZE \* ([0-9.]+)\}/, 'the resting piece size'),

  // Where the float box hangs off the finger, as a fraction of its OWN box. X centres it; Y lifts
  // it clear so the piece is not under the fingertip — which is the whole of what the client asked
  // for: "kita na inaangat piyesa".
  floatAnchorX: dragNum(/floatX\.value\s*=\s*e\.absoluteX - ox - FLOAT_SIZE \* ([0-9.]+)/, 'floatX anchor'),
  floatAnchorY: dragNum(/floatY\.value\s*=\s*e\.absoluteY - oy - FLOAT_SIZE \* ([0-9.]+)/, 'floatY anchor'),

  // The correction that keeps the HIGHLIGHT under the lifted piece rather than under the finger.
  // The source applies the same number on hover and on drop; both are read, and a consumer that
  // finds them unequal has found a real divergence rather than a rounding difference.
  hoverLiftSquares: dragNum(
    /const relY = \(e\.absoluteY - boardOriginY\.value\) - SQUARE_SIZE \* ([0-9.]+)/, 'hover correction'),
  dropLiftSquares: dragNum(
    /const correctedY = e\.absoluteY - SQUARE_SIZE \* ([0-9.]+)/, 'drop correction'),

  edgeToleranceSquares: dragNum(/EDGE_TOLERANCE = SQUARE_SIZE \* ([0-9.]+)/, 'EDGE_TOLERANCE'),
  thresholdPx: dragNum(/\.minDistance\(([0-9.]+)\)/, 'minDistance'),
  originOpacity: dragNum(/opacity: isDragOrigin \? ([0-9.]+) : 1/, 'the drag-origin opacity'),

  shadow: {
    offsetY: dragNum(/shadowOffset:\s*\{ width: 0, height: ([0-9.]+) \}/, 'shadowOffset.height'),
    opacity: dragNum(/shadowOpacity:\s*([0-9.]+)/, 'shadowOpacity'),
    radius: dragNum(/shadowRadius:\s*([0-9.]+)/, 'shadowRadius'),
  },
  hoverFill: dragStr(/hoverStyle[\s\S]*?backgroundColor:\s*'([^']+)'/, 'the hover fill'),

  pickupSpring: springAt(SPRING(1), 'the pickup spring'),
  releaseSpring: springAt(SPRING(0), 'the release spring'),
};

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
  stripContinuation: stripContinuation,
  branchSelection: branchSelection,
  branchConfirm: branchConfirm,
  renderConstants: Object.assign({
    _note: 'Geometry that lives inside a render function, where no StyleSheet can hold it. Each '
         + 'expression is flattened into signed additive terms so a consumer asserts the DIRECTION '
         + 'of an offset, not only its size. `squareToPixel` is included because it defines the '
         + 'anchor every one of these offsets is measured from — it returns the square CENTRE.',
  }, renderConstants),
  dragConstants: dragConstants,
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
