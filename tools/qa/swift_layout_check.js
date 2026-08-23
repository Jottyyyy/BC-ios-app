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

// ---- 4b. the Analysis Board's root has exactly ONE flexible child ---------------
// Same failure, one screen along, and rule 4's regex could never see it: the analysis root is
// `.frame(width: geo.size.width, height: geo.size.height)`, which also defaults to `.center`. Its
// column is a fixed stack, so if nothing inside claims the leftover height SwiftUI centres the lot
// and a navy gap opens ABOVE the header. That is what nearly shipped when the opening-book panel —
// which had been the flexible child by accident, because it hoarded slack it had nothing to fill —
// was replaced by a 44pt strip.
{
  const s = code.get('AnalysisBoardScreen.swift');
  expect(s !== undefined, 'AnalysisBoardScreen.swift is missing');
  if (s) {
    const flexible = (s.match(/\.frame\([^)]*maxHeight: \.infinity/g) || []).length;
    expect(flexible >= 1,
      'AnalysisBoardScreen has no `maxHeight: .infinity` at all — with nothing flexible, the root '
      + 'frame centres the whole column and a gap opens above the header');
    // The engine panel is the one that claims it, and its frame must come AFTER the background or
    // the band floods with surface colour — the exact mistake the book panel used to make.
    expect(/\.background\(AnalysisPalette\.surface\)[\s\S]{0,400}?\.frame\(maxHeight: \.infinity, alignment: \.bottom\)/
      .test(s),
    'the engine panel must claim the leftover height AFTER its `.background`, bottom-aligned, so '
      + 'it hugs its content and paints only behind it');
    // And there is no book band at all any more. Inverted rather than deleted: the strip replaced a
    // 230pt panel and was itself removed one round later, and the way that comes back is by someone
    // re-adding a band nobody asked for.
    expect(!/AnalysisBookStrip/.test(s) && !/vm\.bookRows/.test(s),
      'the Analysis root builds no opening-book band — band 6 is edit mode only now');
  }
}

// ---- 4c. a short screen DROPS engine rows, it does not overdraw ------------------
// The engine panel is the band that gives way, so on a 375x667 SE the rows do not all fit. They must
// live in their OWN clipped box: without it the VStack draws them anyway and they land on top of the
// move strip above. Clipping from the bottom loses the last line before the first, which is the
// right way round. The browser twin does the same with `.an-rows`; board_layout_check §3c pins it.
{
  const s = code.get('AnalysisBoardScreen.swift');
  if (s) {
    const i = s.indexOf('private var rowsBox');
    expect(i >= 0,
      'AnalysisEnginePanel must put its rows in a `rowsBox` of their own — a bare ForEach in the '
      + 'panel VStack overdraws the move strip when the band is short');
    if (i >= 0) {
      // To the next member, not a fixed window: the ForEach body is long, and a window that stops
      // short of `.clipped()` fails a correct file — which is exactly what a 1400-char guess did.
      const rest = s.slice(i + 1);
      const end = rest.search(/\n {4}(private )?(var|func) /);
      const box = end < 0 ? rest : rest.slice(0, end);
      expect(/\.clipped\(\)/.test(box),
        'rowsBox must be `.clipped()`, or the rows that do not fit paint over the band above');
      expect(/rows\.prefix\(plan\.rows\)/.test(box),
        'and capped at `plan.rows`, so a short screen drops rows instead of clipping them');
    }
    // The info row is NOT inside the clipped box: depth and the opening name must survive a short
    // screen, because they are one line and they are what tells you the engine is still working.
    expect(/rowsBox[\s\S]{0,80}?infoRow/.test(s),
      'infoRow must sit outside rowsBox — the depth chip has to survive a short screen');
    // The budget itself is a pure metrics function, not arithmetic in the view.
    expect(/AnalysisLayout\.enginePlan\(available:/.test(s),
      'the row/line budget must come from AnalysisLayout.enginePlan — the same function the JS twin '
      + 'and both metrics suites assert; a second copy in the view body would drift');
    expect(!/plan\.rows\s*[-+*/]/.test(s), 'and no arithmetic on it in a view body');
  }
}

// ---- 4d. the eval rail is a fixed-side SIBLING of the board ---------------------
//
// `BoardArrows` and `AnalysisAnnotationOverlay` are `.overlay(alignment: .topLeading)` ON
// `ChessBoardBand`, so they anchor to the BAND's frame. Put the rail anywhere that adds leading
// width to what those overlays anchor to — a wrapper, a padding, an HStack the band is not
// directly in — and every arrow and every badge slides right by the rail's width while the board
// still looks perfect. That is the annotation-badge failure mode again, one layer up, and no
// compiler and no assertion about numbers can see it.
//
// This is `board_layout_check.js` §2d's Swift twin. The two renderers degrade differently, so
// neither stands in for the other.
{
  const s = code.get('AnalysisBoardScreen.swift');
  expect(s !== undefined, 'AnalysisBoardScreen.swift is missing');
  if (s) {
    const i = s.indexOf('private func boardBand(');
    expect(i >= 0, 'AnalysisBoardScreen still has a boardBand(width:)');
    if (i >= 0) {
      // To the next member, not a fixed window — the band body is long and a short guess would
      // fail a correct file, which is the mistake §4c already documents.
      const rest = s.slice(i + 1);
      const end = rest.search(/\n {4}(private )?(var|func) /);
      const band = end < 0 ? rest : rest.slice(0, end);
      expect(/HStack\(alignment: \.top, spacing: AnalysisEval\.railGap\)/.test(band),
        'boardBand must be an HStack, top-aligned, spaced by AnalysisEval.railGap. A default '
        + '`.center` alignment drifts the moment the two children stop being the same height, and '
        + 'a literal spacing is a number in a view body.');
      expect(band.indexOf('evalRail(') >= 0
        && band.indexOf('evalRail(') < band.indexOf('ChessBoardBand('),
        'the rail comes FIRST — it is on the LEFT, and it stays there when the board is flipped');
      expect(!/evalRail\([^)]*flip/.test(band),
        'and nothing about the rail depends on the flip: the side is FIXED, like Lichess');
      expect(/ChessBoardBand\([\s\S]{0,1200}?\.overlay\(alignment: \.topLeading\)/.test(band),
        'the arrow and badge overlays stay attached to ChessBoardBand, not to the HStack — the '
        + 'band IS the board box and every offset is measured from its frame');
      expect(/AnalysisBoard\.sizeBesideRail\(screenWidth:/.test(band),
        'the edge comes from AnalysisBoard.sizeBesideRail — the pinned snap-to-8 formula fed a '
        + 'width the rail has already been taken out of');
    }
    expect(!/AnalysisBoard\.size\(screenWidth:/.test(s),
      'no call site on this screen sizes the board from the FULL width — enginePlan has to budget '
      + 'against the same edge the board draws at, or a row goes missing on a short screen with '
      + 'nothing to show for it');
    // ONE main eval bar. Inverted rather than deleted, the way the book strip was.
    expect(!/func evalBar\(width:/.test(s),
      'the full-width horizontal eval bar is gone — there is one main eval bar and it is the rail');
    expect(/func evalRail\(height:/.test(s), 'and the rail replaced it');
    expect(!/AnalysisEval\.mainHeight/.test(s),
      'nothing in a view draws AnalysisEval.mainHeight any more — it survives only as the pin on '
      + "the source's evalBarTrack.height (see AnalysisEval's doc comment)");
    // The label's placement and its ink are DECISIONS, made once, in the metrics layer.
    expect(/AnalysisEval\.labelAlignment\(fraction:/.test(s)
      && /AnalysisEval\.labelInk\(fraction:/.test(s),
      'which end the label hangs off, and what colour it is, come from AnalysisEval — a `>= 0.5` '
      + 'in a view body is a second copy of the rule and would drift from the JS twin');
    expect(/AnalysisEval\.fillHeight\(rail:/.test(s) && !/height: height \*/.test(s),
      'and the fill height is the pure function, not arithmetic in a view body');
    // The label is drawn at the size that FITS the rail, which is the same number the browser is
    // handed. Draw `AnalysisType.evalRail` (the source's 11) here instead and SwiftUI shrinks it
    // silently via minimumScaleFactor while the browser — which has no such thing — clips. The two
    // renderers would disagree on screen with every metrics assertion still green.
    expect(/AnalysisType\.mono\(AnalysisEval\.labelFontSize,/.test(s),
      'the rail label is drawn at AnalysisEval.labelFontSize — the size derived to fit the rail '
      + 'and shared with the browser, not the source size the rail is too narrow for');
    expect(!/AnalysisType\.mono\(AnalysisType\.evalRail/.test(s),
      'and never AnalysisType.evalRail directly: that is the CAP inside labelFontSize, not a size '
      + 'to draw at');
  }
}

// ---- 4e. there is only ONE vertical eval bar in the module ----------------------
//
// `Graphics.swift` carried a `struct EvalBar` — a vertical bar with 14pt, radius 5, a 0.02/0.98
// clamp and `Theme.violet` all hardcoded in its view body — that was never once instantiated. It
// was harmless while the Analysis Board's bar was horizontal. With a real rail beside the board it
// is the wrong answer sitting next to the right one, and the first thing anyone looking for "the
// vertical eval bar" would find. Inverted rather than deleted.
{
  expect(!/struct EvalBar\b/.test(code.get('Graphics.swift') || ''),
    'Graphics.swift declares no second EvalBar — AnalysisBoardScreen.evalRail is the only eval bar '
    + 'in the app, and the hardcoded one was never instantiated');
  expect(!/whiteWinPct/.test(code.get('PlayView.swift') || ''),
    'and its only feed is gone with it — whiteCentipawns ran a full ChessAI.evaluate for nobody');
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

// ---- 6. there is no tab bar, and no machinery for hiding one ------------------
//
// This rule used to be its opposite: `if !puzzlePushed { PhoneTabBar(...) }`, plus the
// `onPushedChange` plumbing the hub needed to report its depth so the host could hide the bar on a
// pushed route. Home is the app root now — every destination covers the whole phone — so the bar,
// the flag and the plumbing are all gone, and the assertion is inverted so none of them can come
// back without someone reading this.
//
// `docs/home-screen.md` had named this as the fix for a grid ~74pt over-constrained by hosting
// Home as tab 0, and named the one prerequisite: a way back from every destination. That is what
// replaced it.
{
  const phone = code.get('PhoneView.swift') || '';
  const hub = code.get('PuzzleHubScreen.swift') || '';
  expect(!/PhoneTabBar/.test(phone), 'PhoneView.swift — no tab bar; Home is the app root.');
  expect(!/puzzlePushed/.test(phone),
    'PhoneView.swift — `puzzlePushed` existed only to hide the bar; it should be gone with it.');
  expect(!/onPushedChange/.test(hub) && !/onPushedChange/.test(phone),
    'PuzzleHubScreen no longer reports its pushed depth — nothing consumes it.');
  // What replaced it: the hub is raised and closed like every other pushed route.
  expect(/if showPuzzles \{/.test(phone),
    'PhoneView.swift — the Puzzle Hub is a pushed route now, raised by the Home tile.');
  expect(/onExit: \{ showPuzzles = false \}/.test(phone),
    'PhoneView.swift — and its back button closes it to Home.');
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
