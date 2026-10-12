#!/usr/bin/env node
/*
 * branch_flow_check.js — variations on the Analysis Board: drawn, asked about, and never erased.
 *
 *     node tools/qa/branch_flow_check.js
 *
 * WHY THIS EXISTS. On 2026-10-12 the client reported, about the iOS app: "Sa analysis board pala
 * nabubura automatic yung variation. Isang line lang ang pwede sa apple. Gayahin natin sa android."
 * The tree never lost a move. The STRIP never drew one: the port cited board.tsx:3049-3120 and
 * stopped five lines short of the block that draws the line the cursor is on (:3125-3158). Play
 * 5...Nf6 6.Bg5 7.e3 off the main line and two of the three moves appeared nowhere. Both languages
 * had the gap, and the browser's self-test asserted "one alternative chip" — true, and the bug.
 *
 * Android also ASKS before branching ("Line Already Exists": Overwrite / New Branch / Cancel); the
 * port silently made a side line every time. And its "Choose Continuation" picker had shrunk to
 * "Which continuation?" over bare SAN while carrying every metric of the real one unused.
 *
 * WHAT THIS CHECKS, and what it leaves to others.
 *   §1  every new Swift constant equals its JS twin — JS is held to the RN source by
 *       analysis-metrics.js selfTestSource, so this closes the loop to Swift with no compiler.
 *   §2  the Core: the strip continuation, overwriteMain keeping the other side lines, the preview.
 *       The BEHAVIOUR is replayed by analysis.js / movetree.js self-tests; this pins that the Swift
 *       has the same shape, since there is no `swift` here to run ParityRunner.
 *   §3  routing: a board move asks first; an engine-line commit never does; each answer does what
 *       its button says — in both languages.
 *   §4  the screen draws all of it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const UI = ['DemoApp', 'Sources', 'BiyaherongUI'];
const CORE = ['Sources', 'BiyaherongCoachCore'];

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** Source with `//` comments removed, so a docstring QUOTING old code cannot satisfy a check. */
const code = (src) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/** One Swift `func name(` … up to the closing brace at the given indentation. */
const swiftFunc = (src, name, indent = '    ') =>
  (code(src).match(new RegExp('func ' + name + '\\([\\s\\S]*?\\n' + indent + '\\}')) || [''])[0];
/** One JS `function name(` … up to its closing brace at two-space indentation. */
const jsFunc = (src, name) =>
  (code(src).match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}')) || [''])[0];

const styles = require(path.join(ROOT, 'tools', 'metrics', 'board_styles.json'));
const MET = require(path.join(ROOT, 'web-demo', 'js', 'analysis-metrics.js'));

// ---- §1. Swift constants == JS constants -------------------------------------------------
{
  const metrics = code(read(...UI, 'AnalysisMetrics.swift'));
  /** The body of `enum Name {` … `\n}`. */
  const block = (name) => (metrics.match(new RegExp('enum ' + name + ' \\{[\\s\\S]*?\\n\\}')) || [''])[0];
  const palette = {};
  for (const m of block('AnalysisPalette').matchAll(/static let (\w+) = Theme\.c\(0x([0-9A-Fa-f]{6})\)/g)) {
    palette[m[1]] = '#' + m[2].toUpperCase();
  }
  /** A Swift `static let` resolved to the same shape the JS stores: number, '#RRGGBB', rgba(), string. */
  function swiftValue(enumName, key) {
    const body = block(enumName);
    const line = (body.match(new RegExp('static let ' + key + '(?::\\s*\\w+)?\\s*=\\s*(.+)')) || [])[1];
    if (line === undefined) return { missing: true };
    const v = line.trim();
    let m;
    if ((m = /^(-?[0-9.]+)$/.exec(v))) return { value: Number(m[1]) };
    if ((m = /^"((?:[^"\\]|\\.)*)"$/.exec(v))) return { value: m[1] };
    if ((m = /^Theme\.c\(0x([0-9A-Fa-f]{6})\)$/.exec(v))) return { value: '#' + m[1].toUpperCase() };
    if ((m = /^Theme\.c\(0x([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2}),\s*([0-9.]+)\)$/.exec(v))) {
      return { value: `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${m[4]})` };
    }
    if ((m = /^AnalysisPalette\.(\w+)$/.exec(v))) return palette[m[1]] ? { value: palette[m[1]] } : { missing: true };
    return { unparsed: v };
  }
  // Colours only: `rgba(253,176,34,0.18)` and `rgba(253, 176, 34, 0.18)` are one colour. COPY is
  // compared byte for byte — "Overwrite  —  Replace" carries two spaces each side, on purpose.
  const norm = (x) => (typeof x === 'string' && /^(rgba?\(|#)/.test(x)
    ? x.replace(/\s+/g, '').replace(/^#([0-9a-f]{6})$/i, (_, h) => '#' + h.toUpperCase()) : x);

  const pairs = [
    ['AnalysisLayout', MET.BANDS, ['chipBg', 'chipRadius', 'chipRuleWidth', 'chipRuleColor', 'chipActiveBg',
      'chipText', 'chipTextActive', 'continuationColor', 'chipPaddingH', 'chipPaddingV']],
    ['AnalysisModals', MET.MODALS, ['overlayScrim', 'overlayPadding', 'overlayPaddingBottom',
      'branchBg', 'branchRadius', 'branchPadding', 'branchWidth', 'branchTitleSize', 'branchSubSize',
      'optionBg', 'optionRadius', 'optionPaddingV', 'optionPaddingH', 'optionBorderWidth',
      'optionBorderColor', 'optionMainBorder', 'optionMainBg', 'optionMoveSize', 'optionPreviewSize',
      'branchTitleColor', 'branchTitleGap', 'branchSubColor', 'branchSubGap', 'optionGap',
      'optionMoveColor', 'optionPreviewColor', 'optionPreviewGap', 'optionArrowSize', 'optionArrowColor',
      'optionArrowGap', 'cancelBg', 'cancelRadius', 'cancelPaddingV', 'cancelGap', 'cancelColor',
      'cancelSize', 'branchTitle', 'branchSubtitle', 'branchMainTag', 'branchArrow', 'branchCancel',
      'confirmScrim', 'confirmGutter', 'confirmBg', 'confirmRadius', 'confirmPadding', 'confirmMaxWidth',
      'confirmBorder', 'confirmBorderWidth', 'confirmTitleColor', 'confirmTitleSize', 'confirmTitleGap',
      'confirmTitleTracking', 'pillRowGap', 'pillRowMargin', 'pillBg', 'pillNewBg', 'pillRadius',
      'pillPaddingH', 'pillPaddingV', 'pillMinWidth', 'pillLabelColor', 'pillLabelSize',
      'pillLabelTracking', 'pillLabelGap', 'pillSanColor', 'pillSanSize', 'separatorColor',
      'separatorSize', 'confirmSubColor', 'confirmSubSize', 'confirmSubLineHeight', 'confirmSubGap',
      'confirmSubBoldColor', 'actionRadius', 'actionPaddingV', 'actionPaddingH', 'actionGap',
      'actionTextSize', 'overwriteBg', 'overwriteColor', 'newBranchBg', 'newBranchColor',
      'backPaddingV', 'backBorder', 'backBorderWidth', 'backColor', 'confirmTitle', 'confirmCurrent',
      'confirmNew', 'confirmSeparator', 'confirmSubtitle', 'confirmOverwrite', 'confirmNewBranch',
      'confirmCancel']],
  ];
  for (const [enumName, js, keys] of pairs) {
    for (const key of keys) {
      const sw = swiftValue(enumName, key);
      if (sw.missing) { expect(false, `Swift ${enumName}.${key} is missing`); continue; }
      if (sw.unparsed) { expect(false, `Swift ${enumName}.${key} = ${sw.unparsed} — not a form this check reads`); continue; }
      expect(js[key] !== undefined, `JS twin of ${enumName}.${key} is missing`);
      expect(norm(sw.value) === norm(js[key]),
        `${enumName}.${key}: Swift ${JSON.stringify(sw.value)} != JS ${JSON.stringify(js[key])}`);
    }
  }
}

// ---- §2. The Core: the continuation, the overwrite, the preview ----------------------------
{
  const session = read(...CORE, 'AnalysisSession.swift');
  const tree = read(...CORE, 'MoveTree.swift');
  const js = read('web-demo', 'js', 'analysis.js');
  const jsTree = read('web-demo', 'js', 'movetree.js');
  const cont = styles.stripContinuation || {};

  expect(/public static let branchArrow = "(.)"/.test(session)
    && /public static let branchArrow = "(.)"/.exec(session)[1] === cont.arrow,
    `Swift AnalysisSession.branchArrow is the source's arrow (${cont.arrow})`);
  expect((/var BRANCH_ARROW = '(.)'/.exec(js) || [])[1] === cont.arrow, 'and so is the JS BRANCH_ARROW');
  for (const kind of ['branchArrow = "arrow"', 'branchNumber = "bnum"', 'branchMove = "bmove"']) {
    expect(session.includes('case ' + kind), `StripToken.Kind has ${kind} — the raw value the JS twin uses`);
  }

  // THE shipped bug: the strip stopped after the chips. The continuation block must exist, start
  // past the root, stop at the cursor, and number White only.
  const strip = (code(session).match(/public var stripTokens: \[StripToken\] \{[\s\S]*?\n    \}/) || [''])[0];
  expect(/kind: \.branchArrow/.test(strip), 'Swift stripTokens emits the continuation arrow (board.tsx:3125-3158)');
  expect(/line\.dropFirst\(\)/.test(strip), 'and drops the root before looking for the divergence');
  expect(/!mainIDs\.contains\(curID\)/.test(strip), 'and only when the cursor is off the main line');
  expect(/path\[diverge\.\.\.\]/.test(strip), 'and walks from the divergence to the CURSOR (line(to: current)), not beyond');
  expect(/if n\.color == \.white \{\s*out\.append\(StripToken\(kind: \.branchNumber/.test(strip),
    'numbering White moves only');
  expect(/kind: \.branchMove[\s\S]{0,160}isCurrent: n\.id == curID, isOnPath: true/.test(strip),
    'with the cursor marked current');
  const jsStrip = jsFunc(js, 'stripTokens');
  expect(/kind: 'arrow'/.test(jsStrip) && /line\.slice\(1\)/.test(jsStrip) && /!mainIds\[curId\]/.test(jsStrip),
    'the JS twin draws the same continuation');

  // Overwrite replaces ONE line. The source's `parentChildren.length = 0` wipes the other side lines
  // too; porting that is how "nabubura ang variation" would come straight back.
  const ow = swiftFunc(tree, 'overwriteMain');
  expect(ow.length > 0, 'MoveTree.overwriteMain exists');
  expect(/if let main = cur\.children\.first, main\.move != move \{ remove\(main\) \}/.test(ow),
    'overwriteMain removes children[0] only');
  expect(!/removeContinuations|removeAll|children = \[\]|children\.removeFirst/.test(ow),
    'and never clears the other side lines — the deliberate deviation from length = 0');
  expect(/cur\.children\.insert\(r\.node, at: 0\)/.test(ow) && !/swapAt/.test(ow),
    'the new move goes to the FRONT by insertion; swapAt would reorder the other siblings');
  const jsOw = jsFunc(jsTree, 'overwriteMain');
  expect(/remove\(tree, cur\.children\[0\]\)/.test(jsOw) && /cur\.children\.unshift\(r\.node\)/.test(jsOw)
    && !/length = 0|removeAfter/.test(jsOw), 'the JS twin replaces one line the same way');

  // The question is asked only where it means something.
  const conflict = swiftFunc(session, 'branchConflict');
  expect(/guard let main = cur\.children\.first/.test(conflict), 'no question where the line has no continuation');
  expect(/!cur\.children\.contains\(where: \{ \$0\.move == move \}\)/.test(conflict),
    'none when the move already exists — that just walks into it');
  expect(/pos\.legalMoves\(\)\.contains\(move\)/.test(conflict), 'none for an illegal move');

  // The preview's length and ellipsis are the source's (buildBranchPreview).
  const sel = styles.branchSelection || {};
  const preview = swiftFunc(session, 'continuationPreview');
  expect(new RegExp('count < ' + sel.previewMoves).test(preview), `the Swift preview is ${sel.previewMoves} moves long`);
  expect(preview.includes('"' + sel.previewEllipsis + '"'), 'and ends with the source\'s ellipsis');
  expect(new RegExp('count < ' + sel.previewMoves).test(jsFunc(js, 'continuationPreview')), 'so is the JS one');
}

// ---- §3. Routing: who asks, who does not, what each answer does ------------------------------
{
  const vm = code(read(...UI, 'AnalysisVM.swift'));
  const perform = swiftFunc(vm, 'perform');
  expect(/askingFirst: Bool = true/.test(perform), 'a board move ASKS by default');
  expect(/if askingFirst, let question = session\.branchConflict\(for: m\) \{[\s\S]*?branchConflict = question[\s\S]*?return/.test(perform),
    'and asks BEFORE anything is played');
  expect(perform.indexOf('session.branchConflict') < perform.indexOf('session.play(m)'),
    'the question comes before session.play');
  expect(/overwrite \? session\.overwrite\(m\) : session\.play\(m\)/.test(perform), 'Overwrite goes through session.overwrite');
  expect(/perform\(m, askingFirst: false\)/.test(swiftFunc(vm, 'previewCommit')),
    'an engine-line commit never asks — a modal mid-commit would strand the rest of the line');
  expect(/perform\(q\.move, askingFirst: false, overwrite: true\)/.test(swiftFunc(vm, 'branchOverwrite')),
    'Overwrite replaces');
  const nb = swiftFunc(vm, 'branchNewVariation');
  expect(/perform\(q\.move, askingFirst: false\)/.test(nb) && !/overwrite/.test(nb), 'New Branch adds, never replaces');
  expect(!/perform\(/.test(swiftFunc(vm, 'branchCancel')), 'Cancel plays nothing');
  for (const f of ['branchOverwrite', 'branchNewVariation', 'branchCancel']) {
    expect(/branchConflict = nil/.test(swiftFunc(vm, f)), `${f} closes the question`);
  }

  const js = code(read('web-demo', 'js', 'analysis.js'));
  const onMove = jsFunc(js, 'onBoardMove');
  expect(/var q = branchConflict\(session, m\);\s*if \(q\) \{ showBranchConfirm\(q\)/.test(onMove)
    && onMove.indexOf('branchConflict') < onMove.indexOf('commitBoardMove'),
    'the browser asks before it plays, too');
  expect(!/branchConflict/.test(jsFunc(js, 'previewCommit')), 'and its engine-line commit does not ask either');
  const confirm = jsFunc(js, 'showBranchConfirm');
  expect(/commitBoardMove\(q\.move, true\)/.test(confirm) && /commitBoardMove\(q\.move, false\)/.test(confirm),
    'the browser\'s Overwrite replaces and its New Branch adds');
}

// ---- §4. The screen draws all of it --------------------------------------------------------
{
  const screen = code(read(...UI, 'AnalysisBoardScreen.swift'));
  expect(/\.overlay\(alignment: \.center\) \{ branchConfirm \}/.test(screen), 'the board screen presents Line Already Exists');
  expect(/case \.branchArrow, \.branchNumber:/.test(screen) && /case \.move, \.branchMove:/.test(screen),
    'the strip draws every continuation token kind');
  expect(/AnalysisLayout\.continuationColor/.test(screen), 'in the source\'s continuation colour');
  expect(/tokens\.lastIndex \{ \$0\.isCurrent \}/.test(screen),
    'and scrolls to the LAST current token — the continuation, not the chip');
  expect(/AnalysisLayout\.chipRuleColor/.test(screen) && /AnalysisLayout\.chipActiveBg/.test(screen),
    'chips are the source\'s slate-with-gold-rule, tinted on the path');
  expect(/AnalysisModals\.branchTitle/.test(screen) && /vm\.branchPreview\(node\)/.test(screen)
    && /AnalysisModals\.branchMainTag/.test(screen), 'the picker is Choose Continuation, with previews and the tag');
  expect(!/Which continuation\?/.test(screen), 'and "Which continuation?" is gone');
  for (const k of ['confirmTitle', 'confirmCurrent', 'confirmNew', 'confirmOverwrite', 'confirmNewBranch',
                   'confirmCancel', 'confirmSubtitle']) {
    expect(screen.includes('AnalysisModals.' + k), `Line Already Exists draws AnalysisModals.${k}`);
  }
  expect(/vm\.branchOverwrite\(\)/.test(screen) && /vm\.branchNewVariation\(\)/.test(screen)
    && /vm\.branchCancel\(\)/.test(screen), 'and wires all three answers');
}

const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `BranchFlow: ${passed} invariants hold`
    : `BranchFlow: ${passed} held, ${failures.length} FAILED\n` + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
