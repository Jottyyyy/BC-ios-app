#!/usr/bin/env node
/*
 * swift_layout_check.js — the SwiftUI half of board_layout_check.js.
 *
 *     node tools/qa/swift_layout_check.js
 *
 * Why this exists. A TestFlight build of the Puzzle Streak solver came back with a block of empty
 * navy above the header, the content floating in the middle of the phone, and a board that filled
 * about three quarters of the width. The browser twin of the same screen was correct. Three
 * separate causes, each a single token wide:
 *
 *   1.  Color.clear.frame(width: PuzzleStreakSolver.backBtnW)
 *
 *       `Color` is greedy and `.frame(width:)` constrains ONE axis, so the header reported an
 *       unbounded max height, became a flexible child of the screen's VStack, and was handed a
 *       slice of the leftover screen height as blank space.
 *
 *   2.  GeometryReader { geo in … min(geo.size.width, geo.size.height) … }
 *
 *       A GeometryReader inside a stack accepts whatever it is proposed, which in a VStack is the
 *       leftover HEIGHT. Taking `min(w, h)` therefore sized the board's WIDTH off that leftover:
 *       the board never filled the screen and resized whenever anything above or below it grew.
 *       This is the same bug board_layout_check.js was written for, one language over — there it
 *       was `width: min(100cqw, 100cqh - …)` in CSS.
 *
 *   3.  .frame(maxWidth: .infinity, maxHeight: .infinity)   // on a screen root
 *
 *       The default alignment is `.center`. Once (1) and (2) stopped the content filling the
 *       frame, "centre" is where it went.
 *
 * None of the three is visible to a compiler, and there is no Swift compiler on the Windows
 * checkout at all (see CLAUDE.md). Every existing suite was green while the screen was visibly
 * wrong — exactly the failure mode board_layout_check.js was created to close, so this closes the
 * matching hole on the Swift side. Each rule below is one of those bugs restated as a grep.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

const swiftFiles = fs.readdirSync(UI).filter(f => f.endsWith('.swift')).sort();
expect(swiftFiles.length > 20,
  `expected the BiyaherongUI sources, found ${swiftFiles.length} .swift files — wrong path?`);

const src = new Map(swiftFiles.map(f => [f, fs.readFileSync(path.join(UI, f), 'utf8')]));

/** Source with `//` line comments and `/* … *​/` blocks removed, so prose about a bug never trips
 *  a rule written to catch the bug. Every file here documents these mistakes at length. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}
const code = new Map([...src].map(([f, s]) => [f, stripComments(s)]));

/** Line number of the first match, for a message a human can jump to. */
function lineOf(file, re) {
  const lines = src.get(file).split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

// ---- 1. a one-axis frame on a greedy view ------------------------------------
// `Color`, `Rectangle` and friends accept any proposal. Constraining only the width leaves the
// height unbounded, which silently promotes the enclosing stack row to a flexible child.
//
// The chain has to be WALKED, not pattern-matched: the Streak header's ring is
// `Circle().strokeBorder(…).frame(width:…, height:…)`, and a regex anchored on `Circle()` followed
// immediately by `.frame(` would sail straight past it — which it did, until the mutation test
// said so.
{
  /** The first `.frame(…)` in the modifier chain starting at `i`, or null. */
  function frameInChain(s, i) {
    const n = s.length;
    while (i < n) {
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] !== '.') return null;                       // chain ended
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(i + 1, j);
      let k = j;
      while (k < n && /\s/.test(s[k])) k++;
      if (s[k] !== '(') return null;                       // a property, not a call — give up
      let end = k, depth = 0;
      for (; end < n; end++) {
        if (s[end] === '(') depth++;
        else if (s[end] === ')') { depth--; if (depth === 0) { end++; break; } }
      }
      if (name === 'frame') return s.slice(i, end);
      let t = end;                                          // step over a trailing closure
      while (t < n && /[ \t]/.test(s[t])) t++;
      if (s[t] === '{') {
        let d = 0;
        for (; t < n; t++) {
          if (s[t] === '{') d++;
          else if (s[t] === '}') { d--; if (d === 0) { t++; break; } }
        }
        i = t;
      } else i = end;
    }
    return null;
  }

  // Scoped to `Color.…`, which is the layout-placeholder idiom and nothing else — a `Color` in a
  // stack is there to occupy space, so a width with no height is always the bug.
  //
  // Shapes are deliberately NOT in this set, even though they are equally greedy. A first pass
  // included them and flagged three correct sites: `AnalysisBoardScreen.microBar`,
  // `PuzzlePlayScreens`' theme bars and `AnalysisMenuSidebar`'s vertical rule. All three are a
  // fill or a divider inside a container that already fixes the other axis, where taking one axis
  // is the right idiom. A rule that cries wolf on the correct spelling gets suppressed, and then
  // it is not a rule.
  //
  // `Spacer()` is absent for a different reason: it is greedy only along its stack's axis, and
  // `Spacer().frame(width:)` in an HStack is ordinary.
  const greedy = /\bColor\.\w+/g;
  for (const [file, s] of code) {
    let m;
    greedy.lastIndex = 0;
    while ((m = greedy.exec(s)) !== null) {
      const frame = frameInChain(s, m.index + m[0].length);
      if (!frame || !/\bwidth:/.test(frame)) continue;      // no frame, or not width-constrained
      if (/height:/.test(frame)) { passed++; continue; }    // both axes spelled — the fix
      failures.push(
        `${file}:${lineOf(file, new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))} — `
        + `\`${m[0]}…${frame.trim()}\` constrains one axis of a greedy view. Spell BOTH width and `
        + 'height (CoachScreens.swift does), or the enclosing row becomes a flexible child and '
        + 'eats leftover screen height as blank space.');
    }
  }
}

// ---- 2. no board may be sized from the leftover height ------------------------
{
  for (const [file, s] of code) {
    expect(!/min\(\s*geo\w*\.size\.width\s*,\s*geo\w*\.size\.height\s*\)/.test(s),
      `${file} — a board sized as \`min(geo.size.width, geo.size.height)\`. A GeometryReader in a `
      + 'stack is handed the leftover HEIGHT, so this makes the board width track it. Take the '
      + 'edge from the screen\'s single top-level reader and pass it down (see ChessBoardBand).');
  }
}

// ---- 3. one GeometryReader per screen, and every board goes through the band ----
{
  const callers = [...code].filter(([, s]) => /\bBoardView\(/.test(s)).map(([f]) => f);
  expect(callers.length > 0, 'no file constructs BoardView — the check is looking at the wrong tree');
  for (const file of callers) {
    if (file === 'BoardView.swift') continue;      // the band's own definition site
    expect(/\bChessBoardBand\(/.test(code.get(file)),
      `${file} constructs BoardView without going through ChessBoardBand. The band is the one `
      + 'place that turns an edge into a square; a screen that sizes its own board is how the '
      + 'six different wrappers drifted apart in the first place.');
  }
  // `.aspectRatio(…, contentMode: .fit)` wrapped around a GeometryReader is the other spelling of
  // rule 2: it lets the band's height, not its width, choose the edge.
  for (const [file, s] of code) {
    expect(!/GeometryReader[\s\S]{0,700}?\}\s*\n\s*\.aspectRatio\(/.test(s),
      `${file} — \`GeometryReader { … }.aspectRatio(…)\` as a board band. That is rule 2 in `
      + 'different clothes: the square still gets to be height-limited. Use ChessBoardBand.');
  }
}

// ---- 4. screen roots pin their content to the top -----------------------------
// The signature of a puzzle screen root is the full-bleed frame immediately followed by the screen
// fill. Anything else (a centred results card, for instance) is left alone deliberately.
{
  const re = /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)\s*\n\s*\.background\(PuzzlePalette\.screenBg\)/;
  for (const [file, s] of code) {
    expect(!re.test(s),
      `${file}:${lineOf(file, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)} — a screen `
      + 'root is full-bleed with no `alignment: .top`, so it defaults to `.center`. Leftover height '
      + 'belongs BELOW the content, the way `.pzks-bottom` leaves it in the browser.');
  }
}

// ---- 5. the five solver screens keep the shape the browser has ----------------
// Board rigid, bottom band flexible — `.pz-board { flex: none }` + a trailing Spacer.
{
  const solvers = ['PuzzlePlayScreens.swift', 'PuzzleDailyScreens.swift',
    'PuzzleThematicScreens.swift', 'PuzzleStreakScreens.swift', 'PuzzleTurboScreens.swift'];
  for (const file of solvers) {
    const s = code.get(file);
    expect(s !== undefined, `${file} is missing`);
    if (!s) continue;
    expect(/PuzzleBoardBand\(engine: engine, edge: /.test(s),
      `${file} — PuzzleBoardBand must be given an explicit \`edge:\`; it no longer measures itself.`);
    expect(/alignment: \.top\)/.test(s),
      `${file} — the screen root must pin to \`alignment: .top\`.`);
    // Scoped to the stack the board is in, not the whole file: a Spacer somewhere else entirely
    // (a result overlay, another screen in the same file) satisfied a file-wide search while the
    // solver's own one was gone. The mutation test caught that too.
    const afterBoard = s.slice(s.indexOf('PuzzleBoardBand('));
    expect(/Spacer\(minLength: 0\)/.test(afterBoard.slice(0, 900)),
      `${file} — the Spacer that follows the board is what makes the BOTTOM the flexible band. `
      + 'Without it the board has to compete for the leftover height again.');
  }
}

// ---- 6. the tab bar hides on pushed puzzle routes ----------------------------
// The browser does this with `an-mode` on every pushed route; the app must match, or the solver
// screens draw a tab bar the web twin does not have.
{
  const phone = code.get('PhoneView.swift') || '';
  const hub = code.get('PuzzleHubScreen.swift') || '';
  expect(/if !puzzlePushed \{ PhoneTabBar/.test(phone),
    'PhoneView.swift — PhoneTabBar must be hidden while the Puzzles tab has a route pushed.');
  expect(/onPushedChange/.test(hub) && /onPushedChange/.test(phone),
    'PuzzleHubScreen must report its pushed depth and PhoneView must consume it.');
}

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `SwiftLayout: ${passed} SwiftUI layout invariants hold`
    : `SwiftLayout: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
