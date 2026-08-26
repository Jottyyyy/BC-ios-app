#!/usr/bin/env node
/*
 * extract_video_styles.js — pull the Tutorial Videos layout out of the React Native source,
 * mechanically.
 *
 *     node tools/metrics/extract_video_styles.js
 *     → tools/metrics/video_styles.json   (COMMITTED)
 *
 * Sixth extractor, same machine (`rn_ast.js`) as the board, the puzzles, the tournaments, the
 * coaches and the opening tree. Two files this time — `tutorial-videos/index.tsx` (the catalogue and
 * its paywall) and `play.tsx` (the player) — because they are two screens with two StyleSheets and
 * folding them into one block would let a same-named key from one silently overwrite the other.
 *
 * The output is committed, unlike Goldens/: whoever compiles the Swift may not have the sibling RN
 * repo — the same reasoning that commits `eco.tsv` and the other five style JSONs.
 *
 * ## Why this exists rather than a hand-typed table
 *
 * Twice in one day this repository shipped a screen built from a transcription that agreed with its
 * own twin and disagreed with the RN: `"⬜ White"` where the source had a king glyph, and a 90pt
 * padding that was extracted and then never applied. `CATEGORY_META` here is five colours and five
 * emoji — exactly the shape that gets copied one digit wrong — so it is read, not typed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const RN = require('./rn_ast.js');

const ROOT = path.resolve(__dirname, '..', '..');
// `FRONTEND_ROOT` overrides the sibling lookup: a git worktree sits three levels deep under
// `.claude/worktrees/<slug>`, so `ROOT/..` is `.claude/worktrees/` and the sibling repo is not
// there. Same reason `tools/oracle` takes `LARAVEL_ROOT`.
const FRONTEND = process.env.FRONTEND_ROOT
  ? path.resolve(process.env.FRONTEND_ROOT)
  : path.resolve(ROOT, '..', 'BYAHERONG-COACH-FRONTEND');
const DIR = path.join(FRONTEND, 'app', '(app)', 'user', 'tutorial-videos');
const OUT = path.join(__dirname, 'video_styles.json');

const SCREENS = [
  { key: 'list', file: path.join(DIR, 'index.tsx'),
    spec: 'BOOK TWO — Tutorial Videos: the catalogue, its sections and its paywall' },
  { key: 'play', file: path.join(DIR, 'play.tsx'),
    spec: 'BOOK TWO — Tutorial Videos: the player' },
];

const ts = RN.loadTypeScript(FRONTEND);

// `Dimensions.get` is the seed's own source; `insets.*` is a runtime safe-area read, not a design
// constant. The reference phone is the one every other extractor uses.
const REF_WIDTH = 390, REF_HEIGHT = 844;
const SEED = {
  width: REF_WIDTH, height: REF_HEIGHT,
  SCREEN_WIDTH: REF_WIDTH, SCREEN_HEIGHT: REF_HEIGHT,
  screenWidth: REF_WIDTH, screenHeight: REF_HEIGHT,
};

const out = {
  _generated: 'tools/metrics/extract_video_styles.js — do not hand-edit',
  screens: {},
};

for (const { key, file, spec } of SCREENS) {
  if (!fs.existsSync(file)) {
    console.error('FATAL: missing ' + file
      + '\n       The sibling RN repo is not checked out beside this one. See CLAUDE.md.');
    process.exit(1);
  }

  const sf = RN.parse(ts, file);
  const ev = RN.createEvaluator(ts, SEED);
  const { stylesheets, moduleConstants } = RN.collectStyleSheets(ts, sf, ev);
  const names = Object.keys(stylesheets);

  if (!names.length) {
    console.error('FATAL: no StyleSheet found in ' + path.basename(file)
      + ' — the walker is looking in the wrong place, and every number downstream would be MISSING '
      + 'rather than wrong, which is the failure mode that looks like a clean run.');
    process.exit(1);
  }

  out.screens[key] = {
    _spec: spec,
    _source: path.relative(FRONTEND, file).replace(/\\/g, '/'),
    _bindings: names,
    styles: stylesheets[names[0]],
    extraStyles: names.length > 1
      ? Object.fromEntries(names.slice(1).map((n) => [n, stylesheets[n]]))
      : null,
    moduleConstants,
    renderConstants: RN.findRenderLikeFunctions(ts, sf),
    inlineStyles: RN.collectInlineStyles(ts, sf),
  };
}

// ---- The category table is load-bearing ---------------------------------------------------------
//
// `CATEGORY_ORDER` decides which sections exist and in what order; `CATEGORY_META` gives each its
// colour and its glyph. Five strings and five emoji — the exact shape that gets copied one character
// wrong — so their absence is fatal rather than a warning. Without them the port would be built from
// prose, which is the one thing CLAUDE.md forbids by name.
const listConstants = out.screens.list.moduleConstants || {};
for (const required of ['CATEGORY_ORDER', 'CATEGORY_META']) {
  if (listConstants[required] === undefined) {
    console.error('FATAL: ' + required + ' not found in tutorial-videos/index.tsx. It decides which '
      + 'sections exist and what each one looks like; transcribing it by hand is how a colour ends '
      + 'up one digit off with nothing to catch it.');
    process.exit(1);
  }
}

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
})(out.screens);
out.palette = {
  _note: 'Every colour literal in either StyleSheet, by frequency.',
  counts: Object.fromEntries(Object.entries(palette).sort((a, b) => b[1] - a[1])),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// ---- Report -------------------------------------------------------------------------------------
for (const [key, screen] of Object.entries(out.screens)) {
  const all = Object.assign({}, screen.styles, ...Object.values(screen.extraStyles || {}));
  const keys = Object.keys(all).length;
  const props = Object.values(all).reduce((a, x) => a + Object.keys(x).length, 0);
  console.log(key.padEnd(5) + ' (' + screen._bindings.join('+') + ')  '
    + keys + ' keys  ' + props + ' props  '
    + Object.keys(screen.inlineStyles).length + ' inline  '
    + Object.keys(screen.moduleConstants).length + ' consts');
}
console.log('wrote ' + path.relative(ROOT, OUT).replace(/\\/g, '/'));
