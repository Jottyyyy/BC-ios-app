#!/usr/bin/env node
/*
 * extract_opening_styles.js — pull the Opening Tree's real layout numbers out of the React Native
 * source, mechanically.
 *
 *     node tools/metrics/extract_opening_styles.js
 *     → tools/metrics/opening_styles.json   (COMMITTED)
 *
 * Fifth extractor, same machine (`rn_ast.js`) as the board, the puzzles, the tournaments and the
 * coaches. `openingtree.tsx` is 1,457 lines carrying THREE screens in one file — the saved-tree
 * list, the build form and the explorer — behind a `view` state of `'list' | 'form' | 'explorer'`,
 * with a single StyleSheet shared across all three. The metrics layer splits it by block name.
 *
 * The output is committed, unlike Goldens/: whoever compiles the Swift may not have the sibling RN
 * repo — the same reasoning that commits `eco.tsv` and the other four style JSONs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./rn_ast.js');

const ROOT = path.resolve(__dirname, '..', '..');
// `FRONTEND_ROOT` overrides the sibling lookup, for the same reason `tools/oracle` takes
// `LARAVEL_ROOT`: a git worktree sits three levels deep under `.claude/worktrees/<slug>`, so
// `ROOT/..` resolves to `.claude/worktrees/` and the sibling repo is not there. The other four
// extractors still hardcode the relative path and fail from a worktree; see docs/git-workflow.md.
const FRONTEND = process.env.FRONTEND_ROOT
  ? path.resolve(process.env.FRONTEND_ROOT)
  : path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const FILE = path.join(FRONTEND, 'app', '(app)', 'user', 'analysis-board', 'openingtree.tsx');
const OUT = path.join(__dirname, 'opening_styles.json');

const ts = RN.loadTypeScript(FRONTEND);

/**
 * The functions worth extracting, and why each one:
 *
 *  - `renderWdlBar`   the three-segment win/draw/loss bar — the screen's whole point, and the one
 *                     place its three result colours are written.
 *  - `renderArrows`   the engine-overlay geometry, which shares `squareToPixel` with the Analysis
 *                     Board and must not be re-derived.
 *  - `squareToPixel`  that shared formula itself.
 *  - `getEvalColor`   condition → colour, i.e. what the eval chip SAYS.
 *  - `addGamesToTree` a function DECLARATION, not `const f = () =>`, so the render-like walker
 *                     never sees it. It is the algorithm this whole feature is, and extracting it
 *                     keeps the Swift port honest about the W/L inversion on the opponent's plies.
 *  - `extractMovesFromPgn` the Chess.com PGN cleaner, ditto (declaration form).
 *  - `getSortedMoves` the candidate ordering — count descending, which is the list's semantics.
 */
const NAMED_FUNCTIONS = ['addGamesToTree', 'extractMovesFromPgn', 'squareToPixel',
                         'renderWdlBar', 'renderArrows', 'getEvalColor', 'getSortedMoves',
                         'getNodeAtCurrentPosition'];

const COLOR_MAP_FUNCTIONS = ['getEvalColor'];

// ---- Seeds ------------------------------------------------------------------------------------
//
// The board geometry is the same formula the Analysis Board, the puzzle screens and Play vs Coach
// use — this screen imports the same `DragDropChessBoard`. The metrics layer keeps the FORMULA;
// these concrete numbers exist only so the extracted pixel values are comparable.
const REF_WIDTH = 390, REF_HEIGHT = 844, REF_RATIO = 3;
const BOARD_SIZE = (Math.floor(Math.round(REF_WIDTH * REF_RATIO) / 8) * 8) / REF_RATIO;
const SQUARE_SIZE = BOARD_SIZE / 8;

const SEED = {
  BOARD_SIZE, SQUARE_SIZE,
  width: REF_WIDTH, screenWidth: REF_WIDTH, screenHeight: REF_HEIGHT, height: REF_HEIGHT,
  SCREEN_WIDTH: REF_WIDTH, SCREEN_HEIGHT: REF_HEIGHT,
};

// `insets.*` is a runtime safe-area read, not a design constant. `Dimensions.get` is the seed's own
// source. Anything else unresolved is a hole in the extraction and fails the run.
const EXPECTED_UNRESOLVED = /(^|\.)insets\b|useSafeAreaInsets|Dimensions\.get/;

// ---- Walk ---------------------------------------------------------------------------------------

if (!fs.existsSync(FILE)) {
  console.error('FATAL: missing ' + FILE
    + '\n       The sibling RN repo is not checked out beside this one. See CLAUDE.md.');
  process.exit(1);
}

const sf = RN.parse(ts, FILE);
const ev = RN.createEvaluator(ts, SEED);
const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, sf, ev);
const renderConstants = Object.assign(
  RN.findRenderLikeFunctions(ts, sf),
  RN.findNamedFunctions(ts, sf, NAMED_FUNCTIONS));
const inlineStyles = RN.collectInlineStyles(ts, sf);

const names = Object.keys(stylesheets);
if (names.length < 1) {
  console.error('FATAL: no StyleSheet found in openingtree.tsx — the walker is looking in the '
    + 'wrong place, and every number downstream would be missing rather than wrong.');
  process.exit(1);
}

// The three functions that ARE the feature. Absent, the port would be transcribed from prose, which
// is the one thing CLAUDE.md forbids by name — so their absence is fatal, not a warning.
for (const f of ['addGamesToTree', 'renderWdlBar', 'getSortedMoves']) {
  if (!renderConstants[f]) {
    console.error('FATAL: ' + f + ' not found in openingtree.tsx. It is load-bearing: the tree '
      + 'algorithm, the W/D/L bar and the candidate ordering are what this feature is.');
    process.exit(1);
  }
}

/**
 * `condition -> literal` maps, as an ORDERED list, because the order is the semantics: the last
 * branch is the fallback and moving it changes what an unrecognised value renders as.
 * Same shape as `extract_coach_styles.js`'s.
 */
function collectColorMaps(names) {
  const out = {};
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && names.indexOf(node.name.text) !== -1 && node.initializer) {
      const branches = [];
      (function scan(n) {
        if (ts.isIfStatement(n) && n.thenStatement) {
          const lit = n.thenStatement.getText().match(/return\s+('[^']*'|"[^"]*")/);
          if (lit) branches.push({ when: n.expression.getText(), value: lit[1].slice(1, -1) });
          if (n.elseStatement) scan(n.elseStatement);
          return;
        }
        if (ts.isReturnStatement(n) && n.expression) {
          const t = n.expression.getText();
          if (/^('[^']*'|"[^"]*")$/.test(t)) branches.push({ when: null, value: t.slice(1, -1) });
          return;
        }
        ts.forEachChild(n, scan);
      })(node.initializer);
      if (branches.length) out[node.name.text] = branches;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

const screen = {
  _spec: 'client round 4 — the openingtree.com-style tree',
  _source: path.relative(FRONTEND, FILE).replace(/\\/g, '/'),
  _bindings: names,
  styles: stylesheets[names[0]],
  extraStyles: names.length > 1
    ? Object.fromEntries(names.slice(1).map((n) => [n, stylesheets[n]]))
    : null,
  moduleConstants,
  renderConstants,
  colorMaps: collectColorMaps(COLOR_MAP_FUNCTIONS),
  inlineStyles,
};

// ---- Palette census -----------------------------------------------------------------------------
const palette = {};
(function countColours(o) {
  if (!o || typeof o !== 'object') return;
  for (const v of Object.values(o)) {
    if (typeof v === 'string' && /^(#[0-9A-Fa-f]{3,8}|rgba?\()/.test(v.trim())) {
      const k = v.trim();
      palette[k] = (palette[k] || 0) + 1;
    } else if (v && typeof v === 'object') countColours(v);
  }
})(Object.assign({}, screen.styles, screen.extraStyles || {}));

const out = {
  _generated: 'tools/metrics/extract_opening_styles.js — do not hand-edit',
  _source: screen._source,
  openingTree: screen,
  palette: {
    _note: 'Every colour literal in the StyleSheet, by frequency.',
    counts: Object.fromEntries(Object.entries(palette).sort((a, b) => b[1] - a[1])),
  },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -------------------------------------------------------------------------------------
const all = Object.assign({}, screen.styles, ...Object.values(screen.extraStyles || {}));
const keys = Object.keys(all).length;
const props = Object.values(all).reduce((a, x) => a + Object.keys(x).length, 0);
console.log('openingTree  (' + names.join('+') + ')  '
  + keys + ' keys  ' + props + ' props  '
  + Object.keys(inlineStyles).length + ' inline  '
  + Object.keys(renderConstants).length + ' fns  '
  + Object.keys(moduleConstants).length + ' consts');
console.log('  distinct colours: ' + Object.keys(palette).length
  + '   top: ' + Object.keys(palette).slice(0, 6).join(' '));

// Unresolved values are a GATE, not a log — a value the evaluator cannot fold is a hole in the
// extraction, and a hole is invisible downstream.
const seen = new Set();
const rows = [];
let unexpected = 0;
for (const u of ev.unresolved) {
  const sig = u.where + '|' + u.text;
  if (seen.has(sig)) continue;
  seen.add(sig);
  const expected = EXPECTED_UNRESOLVED.test(u.where) || EXPECTED_UNRESOLVED.test(u.text);
  if (!expected) unexpected++;
  rows.push('    ' + (expected ? '     ' : '  !  ') + u.where.padEnd(46) + u.kind.padEnd(18) + u.text);
}
if (rows.length) {
  console.log('\n  unresolved (' + rows.length + ' distinct, ' + unexpected + ' unexpected):');
  for (const r of rows.slice(0, 40)) console.log(r);
  if (rows.length > 40) console.log('    … and ' + (rows.length - 40) + ' more');
}
console.log('\nwrote tools/metrics/opening_styles.json ('
  + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
if (unexpected) {
  console.error('\nFAILED: ' + unexpected + ' unresolved value(s) marked "!" above. Each is a '
    + 'number the metrics layer will never see. Teach the evaluator, or seed the constant.');
  process.exit(1);
}
