#!/usr/bin/env node
/*
 * swift_layout_mutation_test.js — proves swift_layout_check.js is not vacuous.
 *
 *     node tools/qa/swift_layout_mutation_test.js
 *
 * A grep-based gate is worth exactly as much as its ability to fail. This reintroduces each of the
 * bugs that gate was written for, one at a time, into a COPY of the sources, and requires the check
 * to reject every one. If a mutant survives, the rule that was supposed to catch it is dead — the
 * same reasoning as tools/qa/corpus_mutation_test.py and puzzle_core_mutation_test.js.
 *
 * Nothing here touches the real tree: each mutant is written into a scratch directory that mirrors
 * `DemoApp/Sources/BiyaherongUI/`, and the checker is required with its ROOT pointed at it.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const CHECK = path.join(__dirname, 'swift_layout_check.js');

// Each mutant: a file, a literal to find, and what to replace it with — i.e. the bug, restored.
const MUTANTS = [
  {
    id: 'greedy_one_axis_frame',
    file: 'PuzzleStreakScreens.swift',
    // The anchor moved when the empty gold ring became `HomeLogo` — `AppLogo.tsx` is a ring around
    // an image, and neither language had ever put the image in it. Same `to:`, same bug reproduced;
    // only the line it replaces changed. (A mutant whose `from:` no longer matches never applies,
    // which reads as a pass and proves nothing, so it is re-pointed rather than dropped.)
    from: 'HomeLogo(size: PuzzleStreakSolver.logoSize)',
    to: 'Color.clear.frame(width: PuzzleStreakSolver.backBtnW)',
    why: 'the original Streak header bug, verbatim: a Color spacer with a width and no height',
  },
  {
    id: 'board_sized_from_leftover_height',
    file: 'PuzzleSolverParts.swift',
    from: 'ChessBoardBand(edge: edge) { side in',
    to: 'ChessBoardBand(edge: min(geo.size.width, geo.size.height)) { side in',
    why: 'a board edge taken from min(width, height)',
  },
  {
    id: 'board_bypasses_the_band',
    file: 'PuzzleSolverParts.swift',
    from: 'ChessBoardBand(edge: edge) { side in',
    to: 'Group { let side = edge;',
    why: 'a screen constructing BoardView without ChessBoardBand',
  },
  {
    id: 'screen_root_not_pinned_to_top',
    file: 'PuzzleHubScreen.swift',
    from: '.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)\n        .background(PuzzlePalette.screenBg)',
    to: '.frame(maxWidth: .infinity, maxHeight: .infinity)\n        .background(PuzzlePalette.screenBg)',
    why: 'a screen root left on the default .center alignment',
  },
  {
    id: 'solver_board_measures_itself',
    file: 'PuzzleDailyScreens.swift',
    from: 'PuzzleBoardBand(engine: engine, edge: geo.size.width)',
    to: 'PuzzleBoardBand(engine: engine)',
    why: 'a solver board with no explicit edge',
  },
  {
    id: 'solver_loses_its_flexible_bottom',
    file: 'PuzzleStreakScreens.swift',
    from: '                bottom\n                Spacer(minLength: 0)',
    to: '                bottom',
    why: 'the trailing Spacer removed, so the board competes for leftover height again',
  },
  {
    id: 'analysis_root_loses_its_flexible_child',
    file: 'AnalysisBoardScreen.swift',
    from: '.frame(maxHeight: .infinity, alignment: .bottom)',
    to: '.frame(maxWidth: .infinity)',
    why: 'the engine panel stops claiming the leftover height, so the root frame centres the '
      + 'whole column and a navy gap opens above the header',
  },
  {
    id: 'engine_rows_overdraw_the_strip',
    file: 'AnalysisBoardScreen.swift',
    from: '.clipped()',
    to: '',
    why: 'the rows box unclipped, so on a short screen the rows that do not fit paint over the '
      + 'move strip above',
  },
  {
    id: 'book_band_reintroduced',
    file: 'AnalysisBoardScreen.swift',
    from: '                    AnalysisMoveStrip(tokens: vm.stripTokens,',
    to: '                    AnalysisBookStrip(rows: vm.bookRows)\n'
      + '                    AnalysisMoveStrip(tokens: vm.stripTokens,',
    why: 'an opening-book band added back to the Analysis root, which is how the box the client '
      + 'asked twice to be rid of would return',
  },
  {
    // Replaces `tab_bar_shown_on_pushed_routes`, whose anchor
    // (`if !puzzlePushed { PhoneTabBar(tab: gatedTab) }`) no longer exists: Home became the app
    // root and the bar went with it. A mutant whose `from:` string is gone never applies, which
    // reads as a pass and proves nothing — so it is replaced rather than deleted.
    id: 'puzzle_hub_left_as_a_bare_tab',
    file: 'PhoneView.swift',
    from: 'if showPuzzles {',
    to: 'if true {',
    why: 'the Puzzle Hub drawn unconditionally over Home, i.e. as a tab again',
  },
  {
    id: 'coach_board_loses_its_drag',
    file: 'CoachScreens.swift',
    from: '                          onDragMove: { from, to in drag(from, to, in: pos) })',
    to: '                          coordinates: true)',
    why: 'the coach game board back to tap-only — the shipped bug verbatim. `BoardView` installs '
      + 'no drag gesture at all without `onDragMove`, so every drag is silently swallowed while '
      + 'the board still selects, highlights and plays on a tap',
  },
  {
    // Rule 7 EXEMPTS display boards, and an exemption that cannot stop applying is a hole of its
    // own. This makes the Opening Tree board playable by tap; it must then be required to accept a
    // drag as well. Never compiled — the checker only greps — so `step` need not exist.
    id: 'display_board_becomes_playable',
    file: 'OpeningTreeScreens.swift',
    from: '                      onTap: { _ in })',
    to: '                      onTap: { sq in store.step(sq) })',
    why: 'a read-only board handed a real tap handler and no drag — rule 7 has to stop exempting '
      + 'it the moment it stops being a display board',
  },

  // ---- the eval rail's SHAPE -------------------------------------------------
  //
  // These five were hand-run and recorded as prose in CHANGELOG.md ("21/21 mutants"), which held
  // exactly as long as nobody moved the code. The rail's body has just moved out of
  // `AnalysisBoardScreen.swift` into `EvalRail.swift` so two screens can share one — and a hand-run
  // mutant does not follow a file. Left as prose, the five assertions guarding the rail's geometry
  // would have gone quiet the moment the forwarder replaced the body, and every suite would have
  // stayed green while the rail could be rewritten backwards.
  //
  // A gate nothing mutates is a gate on trust. Mechanised here, they move with the file.
  {
    id: 'rail_fill_anchored_at_the_top',
    file: 'EvalRail.swift',
    from: '.overlay(alignment: .bottom)',
    to: '.overlay(alignment: .top)',
    why: 'the eval fill growing DOWN from the ceiling — every evaluation in the app is then '
      + 'backwards while every number behind it stays right, which is the only symptom there is',
  },
  {
    id: 'rail_fill_height_by_hand',
    file: 'EvalRail.swift',
    from: 'AnalysisEval.fillHeight(rail: height, fraction: fraction)',
    to: 'height * fraction',
    why: 'the fill height as arithmetic in a view body rather than the pure function — it drops '
      + "the 0…1 clamp, so a mate's 0.95 and a corrupt fraction both draw past the rail",
  },
  {
    id: 'rail_label_at_the_source_size',
    file: 'EvalRail.swift',
    from: 'AnalysisType.mono(AnalysisEval.labelFontSize,',
    to: 'AnalysisType.mono(AnalysisType.evalRail,',
    why: 'the label at the SOURCE size instead of the size derived to fit the rail — SwiftUI '
      + 'shrinks it silently via minimumScaleFactor while the browser, which has no such thing, '
      + 'clips. The two renderers disagree on screen with every metrics assertion still green',
  },
  {
    id: 'rail_label_ink_inlined',
    file: 'EvalRail.swift',
    from: 'AnalysisEval.labelInk(fraction: fraction)',
    to: 'AnalysisPalette.textPrimary',
    why: 'the label ink decided in the view rather than in the metrics layer — it is a second copy '
      + 'of the >= 0.5 rule and drifts from the JS twin, which reads the shared one',
  },
  {
    id: 'rail_fill_not_clipped',
    file: 'EvalRail.swift',
    from: '.clipShape(RoundedRectangle(cornerRadius: AnalysisEval.railRadius, style: .continuous))',
    to: '.padding(0)',
    why: 'the fill unclipped — at a full-height eval it spills past the rail`s rounded corners, '
      + 'which looks like a rendering artefact rather than a missing modifier',
  },
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swift-layout-mut-'));
const scratchUI = path.join(scratch, 'DemoApp', 'Sources', 'BiyaherongUI');
fs.mkdirSync(scratchUI, { recursive: true });
fs.mkdirSync(path.join(scratch, 'tools', 'qa'), { recursive: true });

// Copied with line endings NORMALISED to LF. This checkout has both: `git merge` writes CRLF into
// the files it touches while files written directly are LF, so a literal anchor containing "\n"
// silently stops matching a file that a merge happened to rewrite — and every mutant in it goes
// untested while the run still looks like it did something. The checker only greps, so normalising
// costs nothing, and the scratch copy is thrown away either way.
const sources = fs.readdirSync(UI).filter(f => f.endsWith('.swift'));
for (const f of sources) {
  const text = fs.readFileSync(path.join(UI, f), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(scratchUI, f), text);
}

// The checker resolves ROOT from its own location, so a copy two levels under the scratch root
// sees the copied sources and nothing else.
const scratchCheck = path.join(scratch, 'tools', 'qa', 'swift_layout_check.js');
fs.copyFileSync(CHECK, scratchCheck);

/** Runs the copied checker over the scratch tree. Returns true when it PASSES. */
function checkPasses() {
  try {
    execFileSync(process.execPath, [scratchCheck], { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

const failures = [];
let killed = 0;

// Baseline: an unmutated copy must pass, or every "kill" below is meaningless.
if (!checkPasses()) {
  failures.push('BASELINE — the unmutated copy already fails the check; nothing below proves anything');
}

for (const m of MUTANTS) {
  const target = path.join(scratchUI, m.file);
  const original = fs.readFileSync(target, 'utf8');
  if (!original.includes(m.from)) {
    failures.push(`${m.id} — anchor not found in ${m.file}; the mutant never applied `
      + '(the source moved, so this rule is now untested)');
    continue;
  }
  fs.writeFileSync(target, original.replace(m.from, m.to));
  const survived = checkPasses();
  fs.writeFileSync(target, original);
  if (survived) failures.push(`${m.id} SURVIVED — ${m.why} is not caught by swift_layout_check.js`);
  else killed++;
}

fs.rmSync(scratch, { recursive: true, force: true });

const result = {
  passed: killed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `SwiftLayoutMutation: ${killed}/${MUTANTS.length} mutants killed`
    : `SwiftLayoutMutation: ${killed}/${MUTANTS.length} killed, ${failures.length} PROBLEM(S)\n`
      + failures.map(f => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
