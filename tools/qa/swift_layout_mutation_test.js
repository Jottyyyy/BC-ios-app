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
    from: `Circle()
                .strokeBorder(PuzzlePalette.gold, lineWidth: PuzzleStreakSolver.logoBorder)
                .frame(width: PuzzleStreakSolver.logoSize, height: PuzzleStreakSolver.logoSize)`,
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
    id: 'tab_bar_shown_on_pushed_routes',
    file: 'PhoneView.swift',
    from: 'if !puzzlePushed { PhoneTabBar(tab: $tab) }',
    to: 'PhoneTabBar(tab: $tab)',
    why: 'the tab bar left visible on pushed puzzle routes',
  },
];

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'swift-layout-mut-'));
const scratchUI = path.join(scratch, 'DemoApp', 'Sources', 'BiyaherongUI');
fs.mkdirSync(scratchUI, { recursive: true });
fs.mkdirSync(path.join(scratch, 'tools', 'qa'), { recursive: true });

const sources = fs.readdirSync(UI).filter(f => f.endsWith('.swift'));
for (const f of sources) fs.copyFileSync(path.join(UI, f), path.join(scratchUI, f));

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
