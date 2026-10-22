#!/usr/bin/env node
/*
 * board_theme_check.js — one board theme, chosen in Profile, drawn by every board.
 *
 *     node tools/qa/board_theme_check.js
 *
 * WHY THIS EXISTS. Client round 3 (2026-10-22): "hindi mapalitan kulay sa chessboard ng puzzle".
 * The RN app has ONE theme, saved (`contexts/BoardThemeContext.tsx`), chosen on the Profile screen
 * under "Applies to all chess boards", and read by every `DragDropChessBoard`. The port kept the
 * three themes as an unsaved property of the Analysis Board, behind a comment calling them a
 * deviation — so the five puzzle modes, Play vs Coach and the Opening Tree were always Classic
 * Brown, and nothing anywhere asserted otherwise.
 *
 *   §1  the themes, in both languages, equal the extraction (board_styles.json → boardThemes)
 *   §2  the Profile picker's copy and geometry, in both languages, equal the extraction
 *   §3  one key, saved, classified for delete-account, and reset by it — in both languages
 *   §4  Swift: every board resolves its squares from the store; Profile writes it; ☰ writes it
 *   §5  the browser twin, executed: set / get / cycle / forget, the root properties, the card
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const JS = path.join(ROOT, 'web-demo', 'js');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** Strip comments so a documented rule is never mistaken for a live one. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
const read = (dir, f) => code(fs.readFileSync(path.join(dir, f), 'utf8'));
const norm = (c) => String(c).toUpperCase();

function funcBody(src, name) {
  const at = src.search(new RegExp('func\\s+' + name + '\\s*\\('));
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

/** The body of a Swift `var name: T {` … switch, by the next `\n    }` at its indent. */
function swiftVarBlock(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return '';
  return src.slice(at, src.indexOf('\n    }', at));
}

const BS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'metrics', 'board_styles.json'), 'utf8'));
const X = BS.boardThemes;
expect(!!X && Array.isArray(X.themes) && X.themes.length === 3,
  'board_styles.json carries boardThemes with three themes — rerun extract_board_styles.js');

const metricsSwift = read(UI, 'AnalysisMetrics.swift');
const storeSwift = read(UI, 'BoardThemeStore.swift');
const boardViewSwift = read(UI, 'BoardView.swift');
const analysisVM = read(UI, 'AnalysisVM.swift');
const phoneSwift = read(UI, 'PhoneView.swift');
const loginSwift = read(UI, 'LoginMetrics.swift');
const AMET = require(path.join(JS, 'analysis-metrics.js'));
const BT = require(path.join(JS, 'board-theme.js'));
const LOGIN = require(path.join(JS, 'login.js'));

// ── §1 the themes ────────────────────────────────────────────────────────────────
if (X) {
  const themeEnum = metricsSwift.slice(metricsSwift.indexOf('enum BoardTheme:'),
                                       metricsSwift.indexOf('struct BoardStyle'));
  const swiftCase = (block, key) => {
    const m = new RegExp('case \\.' + key + ':\\s*return ([^\\n]+)').exec(block);
    return m ? m[1].trim() : null;
  };
  const lightBlock = swiftVarBlock(themeEnum, 'var light: Color {');
  const darkBlock = swiftVarBlock(themeEnum, 'var dark: Color {');
  const labelBlock = swiftVarBlock(themeEnum, 'var label: String {');
  const swatchBlock = swiftVarBlock(themeEnum, 'var swatch: String {');
  const swiftCases = (/case ([a-z, ]+)\n/.exec(themeEnum) || [, ''])[1].split(',').map((s) => s.trim());
  eq(swiftCases.join(','), X.themes.map((t) => t.key).join(','), 'Swift BoardTheme cases, in order');
  eq(Object.keys(AMET.BOARD_THEMES).join(','), X.themes.map((t) => t.key).join(','),
    'JS BOARD_THEMES keys, in order');
  for (const t of X.themes) {
    eq(swiftCase(lightBlock, t.key), `Theme.c(0x${t.light.slice(1)})`, `Swift ${t.key}.light`);
    eq(swiftCase(darkBlock, t.key), `Theme.c(0x${t.dark.slice(1)})`, `Swift ${t.key}.dark`);
    const swatch = (swiftCase(swatchBlock, t.key) || '').replace(/^"|"$/g, '');
    const label = (swiftCase(labelBlock, t.key) || '').replace(/^"|"$/g, '');
    eq(swatch + ' ' + label, t.label, `Swift ${t.key} swatch + label is the source's label`);
    const j = AMET.BOARD_THEMES[t.key] || {};
    eq(norm(j.light), t.light, `JS ${t.key}.light`);
    eq(norm(j.dark), t.dark, `JS ${t.key}.dark`);
    eq(j.swatch + ' ' + j.label, t.label, `JS ${t.key} swatch + label is the source's label`);
  }
  expect(/var pickerLabel: String \{ swatch \+ " " \+ label \}/.test(themeEnum),
    'Swift pickerLabel is swatch + " " + label, not a fourth copy of the words');
  expect(new RegExp('static let `default`: BoardTheme = \\.' + X.default).test(themeEnum),
    `the Swift default is the source's ${X.default}`);
  eq(AMET.DEFAULT_BOARD_THEME, X.default, 'and so is the JS default');
  expect(!/DEVIATION: the RN board had (one|a single) colour pair/.test(
    fs.readFileSync(path.join(UI, 'AnalysisMetrics.swift'), 'utf8')
    + fs.readFileSync(path.join(JS, 'analysis-metrics.js'), 'utf8')),
    'the false "the RN board had one colour pair" comment is gone from both languages');
}

// ── §2 the Profile picker ─────────────────────────────────────────────────────────
if (X) {
  const S = X.styles;
  const picker = storeSwift.slice(storeSwift.indexOf('enum BoardThemePicker'),
                                  storeSwift.indexOf('struct BoardThemePickerCard'));
  const swiftConst = (name) => {
    const m = new RegExp('static let ' + name + '(?::\\s*CGFloat)?\\s*=\\s*([^\\n]+)').exec(picker);
    if (!m) return undefined;
    const v = m[1].trim();
    let h = /^Theme\.c\(0x([0-9A-Fa-f]{6})\)$/.exec(v);
    if (h) return '#' + norm(h[1]);
    h = /^"(.*)"$/.exec(v);
    if (h) return h[1];
    return Number(v);
  };
  const want = {
    title: X.copy.title, subtitle: X.copy.subtitle, check: X.copy.check,
    cardFill: S.sectionCard.backgroundColor, cardRadius: S.sectionCard.borderRadius,
    cardPadding: S.sectionCard.padding,
    titleSize: S.sectionTitle.fontSize, titleColor: S.sectionTitle.color,
    titleMarginBottom: S.sectionTitle.marginBottom,
    subtitleSize: S.sectionSubtitle.fontSize, subtitleColor: S.sectionSubtitle.color,
    subtitleMarginBottom: S.sectionSubtitle.marginBottom,
    optionGap: S.themeOption.gap, optionPadding: S.themeOption.padding,
    optionRadius: S.themeOption.borderRadius, optionMarginTop: S.themeOption.marginTop,
    optionFill: S.themeOption.backgroundColor,
    activeFill: S.themeOptionActive.backgroundColor, activeBorder: S.themeOptionActive.borderWidth,
    activeBorderColor: S.themeOptionActive.borderColor,
    miniBoard: S.miniBoard.width, miniRadius: S.miniBoard.borderRadius,
    miniSquare: S.miniSquare.width, miniCells: X.mini.cells,
    labelSize: S.themeOptionLabel.fontSize, labelColor: S.themeOptionLabel.color,
    labelActiveColor: S.themeOptionLabelActive.color,
    checkSize: S.themeCheckmark.fontSize, checkColor: S.themeCheckmark.color,
  };
  for (const [k, v] of Object.entries(want)) {
    const w = typeof v === 'string' && /^#/.test(v) ? norm(v) : v;
    const sv = swiftConst(k);
    eq(sv, w, `BoardThemePicker.${k}`);
    const jv = BT.PICKER[k];
    eq(typeof jv === 'string' && /^#/.test(jv) ? norm(jv) : jv, w, `JS PICKER.${k}`);
  }
  eq(Object.keys(BT.PICKER).length, Object.keys(want).length,
    'JS PICKER carries exactly the extracted values, nothing invented beside them');
  eq(S.miniSquare.width * X.mini.cells, S.miniBoard.width,
    'the source\'s mini board is exactly cells x square — the clip hides nothing');
  // The parity rule: top-left light. Easy to port backwards with nothing looking wrong.
  eq(X.mini.lightWhen, '(r + c) % 2 === 0', 'the source lights the even squares');
  expect(/static func isLight\(row: Int, column: Int\) -> Bool \{ \(row \+ column\) % 2 == 0 \}/.test(picker),
    'Swift isLight is the source\'s parity');
  eq(BT.isLight(0, 0), true, 'JS: the top-left mini square is light');
  eq(BT.isLight(0, 1), false, 'JS: and its neighbour dark');
}

// ── §3 one key, classified, and reset by delete-account ──────────────────────────
{
  const key = (/static let storageKey = "([^"]+)"/.exec(storeSwift) || [])[1];
  eq(key, 'biya.board.theme.v1', 'BoardThemeStore.storageKey');
  eq(BT.KEY, key, 'the browser twin owns the same key');
  const erased = (/static let erasedKeys: \[String\] = \[([\s\S]*?)\]/.exec(loginSwift) || [, ''])[1];
  expect(erased.indexOf('"' + key + '"') >= 0, 'Swift LoginAccountData.erasedKeys lists it');
  expect(LOGIN.ACCOUNT_DATA.erasedKeys.indexOf(key) >= 0, 'and so does the JS ACCOUNT_DATA');
  const del = funcBody(phoneSwift, 'deleteAccount') || '';
  const forgetAt = del.indexOf('BoardThemeStore.shared.forget()');
  expect(forgetAt >= 0 && forgetAt < del.indexOf('AccountDeletion.eraseAll()'),
    'Swift delete-account resets the live store before erasing — else the next change rewrites it');
  const forget = funcBody(storeSwift, 'forget') || '';
  expect(/theme = \.default/.test(forget) && /removeObject\(forKey: Self\.storageKey\)/.test(forget),
    'forget() returns to the default AND drops the key');
  const appJs = code(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'));
  expect(/eraseAccountData\(\);\s*BiyaBoardTheme\.forget\(\);/.test(appJs),
    'the browser repaints its boards after erasing the account');
}

// ── §4 Swift: every board draws the store ────────────────────────────────────────
{
  expect(/@ObservedObject private var appTheme = BoardThemeStore\.shared/.test(boardViewSwift),
    'BoardView observes the one store, so all nine boards follow it with no call-site change');
  expect(/private var lightSquare: Color \{ style\.followsAppTheme \? appTheme\.theme\.light : style\.light \}/.test(boardViewSwift)
    && /private var darkSquare: Color \{ style\.followsAppTheme \? appTheme\.theme\.dark : style\.dark \}/.test(boardViewSwift),
    'the square pair is the app theme unless the style opted out');
  const cell = funcBody(boardViewSwift, 'cell') || '';
  expect(/isLight \? lightSquare : darkSquare/.test(cell) && !/style\.(light|dark)\b/.test(cell),
    'the cell paints from lightSquare/darkSquare and never reads style.light/dark directly');
  expect(/var followsAppTheme: Bool = true/.test(metricsSwift),
    'BoardStyle follows the app theme by default');
  // Nobody opts out today. A board that does must be added here, with its reason.
  const OPT_OUTS = [];
  const offenders = fs.readdirSync(UI).filter((f) => f.endsWith('.swift'))
    .filter((f) => /followsAppTheme:\s*false/.test(read(UI, f)));
  eq(offenders.join(','), OPT_OUTS.join(','), 'no board opts out of the app theme');
  expect(!/@Published var theme: BoardTheme/.test(analysisVM),
    'the Analysis Board no longer keeps a private, unsaved theme');
  expect(/var theme: BoardTheme \{\s*get \{ BoardThemeStore\.shared\.theme \}/.test(analysisVM)
    && /BoardThemeStore\.shared\.theme = newValue/.test(analysisVM),
    'its theme is a view of the store, read and written through');
  const cycle = funcBody(analysisVM, 'cycleTheme') || '';
  expect(/theme = all\[/.test(cycle), 'and ☰ > Board Theme cycles it');
  // The store persists, and reads an unknown value back as the default.
  expect(/defaults\.set\(theme\.rawValue, forKey: Self\.storageKey\)/.test(storeSwift),
    'a change is written through');
  expect(/flatMap\(BoardTheme\.init\(rawValue:\)\)\s*\?\? \.default/.test(storeSwift),
    'and an unknown saved value reads back as the default');
  // Profile hosts the picker, and the picker writes the store.
  const profile = phoneSwift.slice(phoneSwift.indexOf('struct ProfilePhone'));
  expect(/BoardThemePickerCard\(store: BoardThemeStore\.shared\)/.test(profile),
    'Profile shows the Board Theme card, as the source does');
  const card = storeSwift.slice(storeSwift.indexOf('struct BoardThemePickerCard'));
  expect(/Button \{ store\.theme = t \}/.test(card), 'tapping a row sets the app-wide theme');
  expect(/ForEach\(BoardTheme\.allCases\)/.test(card), 'one row per theme');
  expect(/Text\(t\.pickerLabel\)/.test(card), 'each labelled with the source\'s full label');
  expect(/if active \{\s*Text\(BoardThemePicker\.check\)/.test(card), 'and only the active row carries ✓');
}

// ── §5 the browser twin, executed ─────────────────────────────────────────────────
{
  const store = {};
  const rootStyle = {};
  const saved = { localStorage: global.localStorage, document: global.document };
  function fakeNode() {
    const n = {
      className: '', textContent: '', type: '', children: [], attrs: {}, onclick: null,
      style: { setProperty(k, v) { this[k] = v; } },
      appendChild(c) { n.children.push(c); return c; },
      setAttribute(k, v) { n.attrs[k] = String(v); },
    };
    return n;
  }
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.document = {
    documentElement: { style: { setProperty: (k, v) => { rootStyle[k] = v; } } },
    createElement: () => fakeNode(),
  };
  try {
    eq(BT.get(), 'classic', 'nothing saved reads as Classic Brown');
    BT.set('green');
    eq(store[BT.KEY], 'green', 'set() saves under the shared key');
    eq(norm(rootStyle['--board-light']), norm(AMET.BOARD_THEMES.green.light),
      'and paints --board-light on the document root, where every <chess-board> inherits it');
    eq(norm(rootStyle['--board-dark']), norm(AMET.BOARD_THEMES.green.dark), 'and --board-dark');
    BT.set('magenta');
    eq(BT.get(), 'green', 'an unknown theme is refused, not saved');
    store[BT.KEY] = 'removed-in-a-later-build';
    eq(BT.get(), 'classic', 'an unknown SAVED value reads back as the default');
    BT.set('classic');
    const order = [];
    for (let i = 0; i < 3; i++) { BT.cycle(); order.push(BT.get()); }
    eq(order.join(','), 'green,blue,classic', '☰ cycles in the source\'s order and wraps');
    BT.set('blue');
    BT.forget();
    eq(store[BT.KEY], undefined, 'forget() drops the key');
    eq(norm(rootStyle['--board-light']), norm(AMET.BOARD_THEMES.classic.light),
      'and repaints Classic Brown');

    // The card, built for real.
    BT.set('blue');
    let changed = null;
    const card = BT.pickerCard((k) => { changed = k; });
    const kids = card.children;
    eq(kids[0].textContent, BT.PICKER.title, 'the card title');
    eq(kids[1].textContent, BT.PICKER.subtitle, 'and its subtitle');
    const rows = kids.filter((n) => /bt-option/.test(n.className));
    eq(rows.length, 3, 'three rows');
    eq(rows.map((r) => r.children[1].textContent).join('|'), X.themes.map((t) => t.label).join('|'),
      'labelled with the source\'s full labels, in order');
    eq(rows.filter((r) => /bt-active/.test(r.className)).length, 1, 'one active row');
    expect(/bt-active/.test(rows[2].className) && rows[2].children.length === 3
      && rows[2].children[2].textContent === BT.PICKER.check, 'the saved one, with the ✓');
    const mini = rows[1].children[0].children;
    eq(mini.length, BT.PICKER.miniCells * BT.PICKER.miniCells, 'a 4 x 4 mini board');
    eq(norm(mini[0].style.background), norm(AMET.BOARD_THEMES.green.light), 'top-left light');
    eq(norm(mini[1].style.background), norm(AMET.BOARD_THEMES.green.dark), 'its neighbour dark');
    eq(norm(mini[4].style.background), norm(AMET.BOARD_THEMES.green.dark), 'the next row starts dark');
    rows[0].onclick();
    eq(store[BT.KEY], 'classic', 'tapping a row saves it');
    eq(changed, 'classic', 'and tells the screen to repaint');
  } finally {
    global.localStorage = saved.localStorage;
    global.document = saved.document;
  }

  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  const at = (f) => order.indexOf(f);
  expect(at('board-theme.js') > at('analysis-metrics.js'), 'board-theme.js loads after the theme table');
  for (const f of ['analysis.js', 'app.js', 'puzzle-solver.js', 'coach-play.js', 'openings.js']) {
    expect(at(f) < 0 || at('board-theme.js') < at(f), `and before ${f}, so its first board is already themed`);
  }
  const an = code(fs.readFileSync(path.join(JS, 'analysis.js'), 'utf8'));
  expect(!/var boardTheme\b/.test(an), 'the browser Analysis Board keeps no theme of its own');
  expect(/BT\.cycle\(\)/.test(an) && /BT\.colors\(\)\.label/.test(an),
    'its ☰ row cycles and names the shared one');
  const appJs = code(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'));
  const prof = appJs.slice(appJs.indexOf('function renderProfile()'));
  expect(/BiyaBoardTheme\.pickerCard\(/.test(prof.slice(0, prof.indexOf('\n  }\n'))),
    'the browser Profile shows the Board Theme card');
}

const result = {
  passed, failures, ok: failures.length === 0,
  summary: failures.length === 0
    ? `BoardTheme: ${passed} invariants hold`
    : `BoardTheme: ${passed} held, ${failures.length} FAILED\n` + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result, run: () => result };
