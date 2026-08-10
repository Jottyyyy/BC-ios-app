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

let ts;
try {
  ts = require(path.join(FRONTEND, 'node_modules', 'typescript'));
} catch (e) {
  console.error('FATAL: cannot load typescript from ' + path.join(FRONTEND, 'node_modules', 'typescript'));
  console.error('The sibling BYAHERONG-COACH-FRONTEND repo (with node_modules) must be present.');
  process.exit(1);
}
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

// `...StyleSheet.absoluteFillObject`
const ABSOLUTE_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 };

// ---- AST evaluation ---------------------------------------------------------

const unresolved = [];

function makeEvaluator(sf) {
  function evalNode(node, where) {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;

    // `'relative' as const`
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return evalNode(node.expression, where);
    if (ts.isParenthesizedExpression(node)) return evalNode(node.expression, where);

    if (ts.isPrefixUnaryExpression(node)) {
      const v = evalNode(node.operand, where);
      if (typeof v !== 'number') return undefined;
      if (node.operator === ts.SyntaxKind.MinusToken) return -v;
      if (node.operator === ts.SyntaxKind.PlusToken) return v;
      return undefined;
    }

    // Pre-seeded module constants: SQUARE_SIZE, width, …
    if (ts.isIdentifier(node)) {
      if (Object.prototype.hasOwnProperty.call(SEED, node.text)) return SEED[node.text];
      unresolved.push({ where, kind: 'Identifier', text: node.getText() });
      return undefined;
    }

    // Arithmetic over seeded constants: `width * 0.65`, `screenHeight * 0.80`
    if (ts.isBinaryExpression(node)) {
      const l = evalNode(node.left, where), r = evalNode(node.right, where);
      if (typeof l !== 'number' || typeof r !== 'number') return undefined;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken: return l * r;
        case ts.SyntaxKind.SlashToken: return l / r;
        case ts.SyntaxKind.PlusToken: return l + r;
        case ts.SyntaxKind.MinusToken: return l - r;
        default:
          unresolved.push({ where, kind: 'BinaryExpression', text: node.getText() });
          return undefined;
      }
    }

    // `Platform.OS === 'ios' ? A : B` — keep the iOS branch; this app ships on iOS.
    if (ts.isConditionalExpression(node)) {
      const cond = node.condition.getText();
      if (/Platform\.OS\s*===\s*'ios'/.test(cond)) return evalNode(node.whenTrue, where);
      if (/Platform\.OS\s*!==\s*'ios'/.test(cond)) return evalNode(node.whenFalse, where);
      unresolved.push({ where, kind: 'ConditionalExpression', text: node.getText().slice(0, 70) });
      return undefined;
    }

    // Math.floor / Math.round / Math.min / Math.max over resolved values
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const m = /^Math\.(floor|round|ceil|abs|min|max)$/.exec(callee);
      if (m) {
        const args = node.arguments.map(a => evalNode(a, where));
        if (args.some(a => typeof a !== 'number')) return undefined;
        return Math[m[1]].apply(null, args);
      }
      unresolved.push({ where, kind: 'CallExpression', text: node.getText().slice(0, 70) });
      return undefined;
    }

    if (ts.isObjectLiteralExpression(node)) return objectOf(node, where);
    if (ts.isArrayLiteralExpression(node)) {
      const out = node.elements.map(e => evalNode(e, where));
      return out.some(v => v === undefined) ? undefined : out;
    }

    unresolved.push({ where, kind: ts.SyntaxKind[node.kind], text: node.getText().slice(0, 70) });
    return undefined;
  }

  function objectOf(obj, where) {
    const out = {};
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        if (/StyleSheet\.absoluteFillObject/.test(p.expression.getText())) Object.assign(out, ABSOLUTE_FILL);
        else unresolved.push({ where, kind: 'Spread', text: p.getText() });
        continue;
      }
      if (!ts.isPropertyAssignment(p)) continue;
      const key = p.name.getText().replace(/^['"]|['"]$/g, '');
      const v = evalNode(p.initializer, where + '.' + key);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  return { evalNode, objectOf };
}

function parse(file) {
  return ts.createSourceFile(path.basename(file), fs.readFileSync(file, 'utf8'),
                             ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// ---- Walk board.tsx ---------------------------------------------------------

const boardSF = parse(BOARD_TSX);
const { evalNode, objectOf } = makeEvaluator(boardSF);

const stylesheets = {};
const moduleConstants = {};

function visit(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText();

    // const styles = StyleSheet.create({ … })
    if (ts.isCallExpression(node.initializer)
        && node.initializer.expression.getText() === 'StyleSheet.create'
        && node.initializer.arguments.length === 1
        && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
      const block = {};
      for (const p of node.initializer.arguments[0].properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = p.name.getText().replace(/^['"]|['"]$/g, '');
        block[key] = objectOf(p.initializer, name + '.' + key);
      }
      stylesheets[name] = block;
      return;   // do not descend; already consumed
    }

    // Module-scope constants the views read: ARROW_COLORS, AUTOPLAY_SPEEDS, and the bare numbers
    // (EDIT_PALETTE_PIECE_SIZE, …) — those are just as easy to mistype as a StyleSheet value.
    if (/^[A-Z][A-Z0-9_]*$/.test(name)
        && (ts.isArrayLiteralExpression(node.initializer) || ts.isObjectLiteralExpression(node.initializer)
            || ts.isNumericLiteral(node.initializer) || ts.isStringLiteral(node.initializer))) {
      const v = evalNode(node.initializer, 'const.' + name);
      if (v !== undefined) moduleConstants[name] = v;
      return;
    }
  }
  ts.forEachChild(node, visit);
}
visit(boardSF);

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

/** Flatten an additive chain into signed leaves: `a + b*2 - c` → [+a, +b*2, -c]. */
function additiveTerms(node, sign, out) {
  if (ts.isParenthesizedExpression(node)) return additiveTerms(node.expression, sign, out);
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k === ts.SyntaxKind.PlusToken) {
      additiveTerms(node.left, sign, out); additiveTerms(node.right, sign, out); return out;
    }
    if (k === ts.SyntaxKind.MinusToken) {
      additiveTerms(node.left, sign, out); additiveTerms(node.right, -sign, out); return out;
    }
  }
  out.push({ sign: sign, node: node });
  return out;
}

/** Describe one leaf: a bare number, a reference, or `ref * k` / `ref / k` / `k * ref`. */
function describeTerm(t) {
  const text = t.node.getText().replace(/\s+/g, ' ');
  const d = { sign: t.sign, text: text };
  if (ts.isNumericLiteral(t.node)) { d.value = Number(t.node.text); return d; }
  if (ts.isIdentifier(t.node) || ts.isPropertyAccessExpression(t.node)) { d.ref = text; d.ratio = 1; return d; }
  if (ts.isBinaryExpression(t.node)) {
    const op = t.node.operatorToken.kind;
    const l = t.node.left, r = t.node.right;
    const refText = n => (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) ? n.getText() : null;
    if (op === ts.SyntaxKind.AsteriskToken) {
      if (refText(l) && ts.isNumericLiteral(r)) { d.ref = refText(l); d.ratio = Number(r.text); return d; }
      if (ts.isNumericLiteral(l) && refText(r)) { d.ref = refText(r); d.ratio = Number(l.text); return d; }
    }
    if (op === ts.SyntaxKind.SlashToken && refText(l) && ts.isNumericLiteral(r)) {
      d.ref = refText(l); d.ratio = 1 / Number(r.text); return d;
    }
  }
  return d;   // opaque: text only, still diffable
}

function describeExpr(node) {
  if (ts.isParenthesizedExpression(node)) return describeExpr(node.expression);
  if (ts.isConditionalExpression(node)) {
    return {
      text: node.getText().replace(/\s+/g, ' '),
      condition: node.condition.getText().replace(/\s+/g, ' '),
      whenTrue: describeExpr(node.whenTrue),
      whenFalse: describeExpr(node.whenFalse),
    };
  }
  return {
    text: node.getText().replace(/\s+/g, ' '),
    terms: additiveTerms(node, 1, []).map(describeTerm),
  };
}

const renderConstants = {};

function collectRenderFunction(name, body) {
  const found = {};
  const jsxCount = {};
  (function walk(n) {
    // `const cx = pos.x + SQUARE_SIZE * 0.29;`
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      found[n.name.text] = describeExpr(n.initializer);
    }
    // `return { x: …, y: … };`
    if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
      for (const p of n.expression.properties) {
        if (ts.isPropertyAssignment(p)) {
          found['return.' + p.name.getText()] = describeExpr(p.initializer);
        }
      }
    }
    // `<Circle cx={cx + 1.5} r={r} />` — the shadow offset, the ring, the text baseline.
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText();
      const idx = (jsxCount[tag] = (jsxCount[tag] || 0));
      jsxCount[tag] += 1;
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const attr = a.name.getText();
        if (ts.isStringLiteral(a.initializer)) {
          found[tag + '[' + idx + '].' + attr] = { text: a.initializer.text, literal: a.initializer.text };
        } else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
          found[tag + '[' + idx + '].' + attr] = describeExpr(a.initializer.expression);
        }
      }
    }
    ts.forEachChild(n, walk);
  })(body);
  renderConstants[name] = found;
}

(function findRenderFunctions(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && RENDER_FUNCTIONS.indexOf(node.name.text) !== -1
      && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    collectRenderFunction(node.name.text, node.initializer.body);
    return;
  }
  ts.forEachChild(node, findRenderFunctions);
})(boardSF);

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
