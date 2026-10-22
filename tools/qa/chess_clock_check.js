#!/usr/bin/env node
/*
 * chess_clock_check.js — the Chess Clock, in both languages, checked against each other.
 *
 *     node tools/qa/chess_clock_check.js
 *
 * WHY THIS EXISTS. The clock (client round 3, 2026-10-22) is the one feature in the port with no
 * original: the RN app and the Laravel backend have none, so there is no oracle and no extraction.
 * What stands in for them is the same trick the position editor uses — the Swift table is written
 * in a step language, and this file pulls it out of Sources/ParityRunner/main.swift and EXECUTES it
 * through web-demo/js/chess-clock.js. A hand-written expectation that the JS does not reproduce is
 * a failure here, long before `swift run ParityRunner` sees it on a Mac.
 *
 *   §1  every `chess_clock` script, format, level, label and clamp, replayed through the JS core
 *   §2  the core's constants and presets: Swift text == JS values
 *   §3  the screen's strings and metrics: ChessClockMetrics.swift == chess-clock.js, key for key
 *   §4  the Swift screen's wiring: the decisions a compiler would not check
 *   §5  Home: the seventh tile, and the band it lives in
 *   §6  the browser screen, rendered on a fake DOM and driven
 *
 * The ParityRunner floor for `chess_clock` is derived here from the same table, so it cannot be
 * set by hand to a number the scripts do not produce.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const CORE_DIR = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');
const JS = path.join(ROOT, 'web-demo', 'js');
const CC = require(path.join(JS, 'chess-clock.js'));
const C = CC.CORE;

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
const readRaw = (dir, f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
const read = (dir, f) => code(readRaw(dir, f));

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

/** A Swift array-literal body, by bracket matching from `let name: … = [`. */
function swiftArray(src, name) {
  const at = src.indexOf('let ' + name + ':');
  if (at < 0) return null;
  const open = src.indexOf('[', src.indexOf('=', at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}
const swiftStrings = (s) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));

/** The step language's control spec — the twin of `clockControl` in main.swift. */
function clockControl(spec) {
  const m = /^(\d+)(?:\/(\d+))?(?:([+d])(\d+))?$/.exec(spec);
  if (!m) return null;
  const top = Number(m[1]);
  return C.control(top, m[2] != null ? Number(m[2]) : top,
    m[3] ? (m[3] === '+' ? 'increment' : 'delay') : 'none', m[4] ? Number(m[4]) : 0);
}

const MAIN = readRaw(path.join(ROOT, 'Sources', 'ParityRunner'), 'main.swift');
const groupAt = MAIN.indexOf('h.begin("chess_clock")');
const GROUP = groupAt < 0 ? '' : MAIN.slice(groupAt, MAIN.indexOf('// MARK: - Done', groupAt));
expect(groupAt >= 0, 'main.swift has a chess_clock group');

// The number of `h.check` calls the Swift group will make — so its floor can be asserted.
let swiftChecks = 0;

// ── §1 replay ────────────────────────────────────────────────────────────────────
{
  // (a) the scripts
  const body = swiftArray(GROUP, 'clockScripts') || '';
  const scripts = [];
  const re = /\(\s*"((?:[^"\\]|\\.)*)",\s*"([^"]+)",\s*\[([\s\S]*?)\]\s*\)/g;
  let m;
  while ((m = re.exec(body)) !== null) scripts.push({ name: m[1], spec: m[2], steps: swiftStrings(m[3]) });
  expect(scripts.length >= 12, `${scripts.length} clock scripts found in main.swift (expected 12+)`);
  let stepCount = 0;
  for (const sc of scripts) {
    const ctl = clockControl(sc.spec);
    if (!ctl) { failures.push(`${sc.name}: unparseable control ${sc.spec}`); continue; }
    const clk = C.create(ctl);
    sc.steps.forEach((step, n) => {
      const ctx = `${sc.name}, step ${n + 1} \`${step}\``;
      const words = step.split(' ');
      let at = 0;
      if (/^@\d+$/.test(words[words.length - 1])) at = Number(words.pop().slice(1));
      const named = (v) => v || 'none';
      stepCount++;
      switch (words[0]) {
        case 'press': swiftChecks++; expect(C.press(clk, words[1], at) === true, `${ctx}: the press should count`); break;
        case 'ignore': swiftChecks++; expect(C.press(clk, words[1], at) === false, `${ctx}: the press should be ignored`); break;
        case 'tick': swiftChecks++; expect(C.tick(clk, at) === false, `${ctx}: no flag yet`); break;
        case 'flag': swiftChecks++; expect(C.tick(clk, at) === true, `${ctx}: this tick raises the flag`); break;
        case 'pause': C.pause(clk, at); break;
        case 'resume': C.resume(clk, at); break;
        case 'reset': C.reset(clk); break;
        case 'state': swiftChecks++; eq(clk.status, words[1], ctx); break;
        case 'active': swiftChecks++; eq(named(clk.active), words[1], ctx); break;
        case 'white': swiftChecks++; eq(named(clk.white), words[1], ctx); break;
        case 'flagged': swiftChecks++; eq(named(clk.flagged), words[1], ctx); break;
        case 'bonused': swiftChecks++; eq(named(clk.lastBonused), words[1], ctx); break;
        case 'moves': swiftChecks++; eq(C.moves(clk, words[1]), Number(words[2]), ctx); break;
        case 'left': swiftChecks++; eq(C.remainingMs(clk, words[1], at), Number(words[2]), ctx); break;
        case 'delay': swiftChecks++; eq(C.delayLeftMs(clk, at), Number(words[1]), ctx); break;
        default: failures.push(`${ctx}: a step the replay does not know — keep the grammars in sync`);
      }
    });
  }
  expect(stepCount >= 130, `${stepCount} steps replayed (expected 130+)`);

  // (b) formats, levels, labels, clamps
  const pairs = (name) => {
    const b = swiftArray(GROUP, name) || '';
    return [...b.matchAll(/\(\s*(-?\d+|"[^"]*"),\s*"((?:[^"\\]|\\.)*)"(?:,\s*"([^"]*)")?\s*\)/g)]
      .map((x) => [x[1].replace(/^"|"$/g, ''), x[2], x[3]]);
  };
  const fmts = pairs('clockFormats');
  expect(fmts.length >= 18, `${fmts.length} format pairs`);
  for (const [ms, text] of fmts) { swiftChecks++; eq(C.display(Number(ms)), text, `display(${ms})`); }
  const levels = pairs('clockLevels');
  expect(levels.length >= 5, `${levels.length} level pairs`);
  for (const [ms, lv] of levels) { swiftChecks++; eq(C.level(Number(ms)), lv, `level(${ms})`); }
  const labels = pairs('clockLabels');
  expect(labels.length >= 18, `${labels.length} label rows`);
  for (const [spec, lab, cat] of labels) {
    const c = clockControl(spec);
    swiftChecks += 2;
    eq(c && C.label(c), lab, `label(${spec})`);
    eq(c && C.category(c), cat, `category(${spec})`);
  }
  const clamps = pairs('clockClamps');
  expect(clamps.length >= 4, `${clamps.length} clamp rows`);
  for (const [spec, lab] of clamps) { swiftChecks++; eq(C.label(C.clamp(clockControl(spec))), lab, `clamped(${spec})`); }
  // The fixed checks at the end of the group, replayed one for one.
  const fixed = [
    [C.sameControl(C.clamp(clockControl('60+0')), C.clamp(clockControl('60'))), '60+0 is 60 once clamped'],
    [C.sameControl(C.clamp(clockControl('60d0')), C.clamp(clockControl('60'))), '60d0 is 60 once clamped'],
  ];
  for (const [ok, what] of fixed) { swiftChecks++; expect(ok, 'JS: ' + what); }
  let last = 0;
  for (const p of C.PRESETS) {
    swiftChecks++;
    const band = C.CATEGORIES.indexOf(C.category(p));
    expect(band >= last, `preset ${C.label(p)} does not go back a band`);
    last = band;
  }
  swiftChecks++;
  eq(new Set(C.PRESETS.map(C.category)).size, C.CATEGORIES.length, 'every band has a preset');
  swiftChecks++;
  expect(C.PRESETS.some((p) => C.sameControl(p, C.DEFAULT)), 'the default control is a preset');
  swiftChecks++;
  eq(C.label(C.DEFAULT), '5 | 3', 'the default is 5 | 3');
  swiftChecks++;
  expect(C.other('top') === 'bottom' && C.other('bottom') === 'top', 'the sides are each other\'s');
  // Same shape as the Swift: a fixed check appears in the group exactly once per line above.
  for (const what of ['60+0 is 60 once clamped', '60d0 is 60 once clamped', 'every band has a preset',
                      'the default control is a preset', 'the default is 5 | 3',
                      'the sides are each other\'s', 'does not go back a band']) {
    expect(GROUP.indexOf(what) >= 0, `the Swift group still asserts "${what}"`);
  }

  // (c) the floor: exactly what the table produces, so it can be neither vacuous nor hand-set.
  const floor = (/"chess_clock":\s*(\d+)/.exec(MAIN) || [])[1];
  eq(Number(floor), swiftChecks, 'requireMinCounts["chess_clock"] is the count the table produces');
}

// ── §2 the core's constants, Swift == JS ─────────────────────────────────────────
{
  const core = read(CORE_DIR, 'ChessClock.swift');
  expect(!/import (SwiftUI|UIKit|AppKit)/.test(core), 'ChessClock.swift is Foundation-only, like the rest of the Core');
  const sw = (name) => {
    const m = new RegExp('static let ' + name + ' = ([^\\n]+)').exec(core);
    if (!m) return undefined;
    // `9 * 3600 + 59 * 60 + 59` and `10_000` both evaluate as plain arithmetic.
    const expr = m[1].replace(/\/\/.*$/, '').replace(/_/g, '').trim();   // a trailing comment is not code
    return Function('"use strict"; return (' + expr + ');')();
  };
  for (const k of Object.keys(C.LIMITS)) eq(sw(k), C.LIMITS[k], `TimeControl.${k}`);
  for (const k of Object.keys(C.FORMAT)) eq(sw(k), C.FORMAT[k], `ClockFormat.${k}`);
  eq(Object.keys(C.LIMITS).length, 7, 'every JS limit has been compared');

  const presetText = swiftArray(core, 'presets') || '';
  const swPresets = [...presetText.matchAll(/TimeControl\(minutes: (\d+), increment: (\d+)\)/g)]
    .map((m) => C.label(C.fromMinutes(Number(m[1]), Number(m[2]))));
  eq(swPresets.join(','), C.PRESETS.map(C.label).join(','), 'the preset table, in order');
  const def = /static let `default` = TimeControl\(minutes: (\d+), increment: (\d+)\)/.exec(core);
  eq(def && C.label(C.fromMinutes(Number(def[1]), Number(def[2]))), C.label(C.DEFAULT), 'the default');
  const cats = /enum Category: [^{]*\{\s*case ([a-z, ]+)\n/.exec(core);
  eq(cats && cats[1].split(',').map((s) => s.trim()).join(','), C.CATEGORIES.join(','), 'the bands, in order');
  for (const k of C.CATEGORIES) {
    expect(new RegExp('case \\.' + k + ': return "' + C.CATEGORY_LABELS[k] + '"').test(core),
      `the ${k} band is called "${C.CATEGORY_LABELS[k]}" in both`);
  }
  const bon = /enum Bonus: [^{]*\{[\s\S]*?case none[\s\S]*?case increment[\s\S]*?case delay/.test(core);
  expect(bon && C.BONUSES.join(',') === 'none,increment,delay', 'the three bonus kinds');
  // The rules a hand port is likeliest to get backwards, stated in the Swift text.
  const press = funcBody(core, 'press') || '';
  expect(/active = side\.other\s*\n\s*white = side\.other/.test(press),
    'Swift: the first press starts the OTHER side, and that side is White');
  expect(/guard side == active else \{ return false \}/.test(press),
    'Swift: only the running side can end its turn');
  expect(/if tick\(at: now\) \{ return false \}/.test(press),
    'Swift: a press after the time ran out flags instead of moving');
  const charged = funcBody(core, 'chargedMs') || '';
  expect(/max\(0, used - control\.effectiveBonusSeconds \* 1000\)/.test(charged),
    'Swift: a delay is subtracted from the turn, never banked');
}

// ── §3 the screen's strings and metrics, Swift == JS, key for key ─────────────────
{
  const met = read(UI, 'ChessClockMetrics.swift');
  const block = (name) => {
    const at = met.indexOf('enum ' + name + ' {');
    if (at < 0) return '';
    let depth = 0;
    for (let i = met.indexOf('{', at); i < met.length; i++) {
      if (met[i] === '{') depth++;
      else if (met[i] === '}') { depth--; if (depth === 0) return met.slice(at, i); }
    }
    return '';
  };
  const strings = block('ChessClockStrings');
  const swStr = {};
  for (const m of strings.matchAll(/static let (\w+) = "((?:[^"\\]|\\.)*)"/g)) swStr[m[1]] = m[2];
  eq(Object.keys(swStr).sort().join(','), Object.keys(CC.STR).sort().join(','),
    'ChessClockStrings and STR declare the same keys');
  for (const k of Object.keys(CC.STR)) eq(swStr[k], CC.STR[k], `ChessClockStrings.${k}`);

  const metrics = block('ChessClockMetrics');
  const swMet = {};
  for (const m of metrics.matchAll(/static let (\w+)(?::\s*[\w.]+)?\s*=\s*([^\n]+)/g)) {
    const v = m[2].trim();
    let h = /^Theme\.c\(0x([0-9A-Fa-f]{6})(?:,\s*([0-9.]+))?\)$/.exec(v);
    if (h) {
      const hex = h[1].toUpperCase();
      swMet[m[1]] = h[2] == null ? '#' + hex
        : `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4), 16)}, ${Number(h[2])})`;
    } else swMet[m[1]] = Number(v);
  }
  const norm = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/\s+/g, '') : v);
  eq(Object.keys(swMet).sort().join(','), Object.keys(CC.MET).sort().join(','),
    'ChessClockMetrics and MET declare the same keys');
  for (const k of Object.keys(CC.MET)) eq(norm(swMet[k]), norm(CC.MET[k]), `ChessClockMetrics.${k}`);
  eq(CC.MET.maxMinutes * 60 + 59, C.LIMITS.maxSeconds, 'the steppers top out exactly at the limit');
  expect(1000 % CC.MET.tickMs === 0 && CC.MET.tickMs <= C.FORMAT.tenthsBelowMs / 100,
    'the tick is fine enough that a tenth is never skipped');

  // The saved-prefs key, classified for delete-account in both languages.
  const key = (/static let storageKey = "([^"]+)"/.exec(met) || [])[1];
  eq(key, CC.STORAGE_KEY, 'ChessClockPrefs.storageKey == the browser key');
  const loginSwift = read(UI, 'LoginMetrics.swift');
  const erased = (/static let erasedKeys: \[String\] = \[([\s\S]*?)\]/.exec(loginSwift) || [, ''])[1];
  expect(erased.indexOf('"' + key + '"') >= 0, 'the clock key is erased by delete-account (Swift)');
  const LOGIN = require(path.join(JS, 'login.js'));
  expect(LOGIN.ACCOUNT_DATA.erasedKeys.indexOf(key) >= 0, 'and by the browser');
  const phone = read(UI, 'PhoneView.swift');
  const del = funcBody(phone, 'deleteAccount') || '';
  expect(del.indexOf('ChessClockPrefs.shared.forget()') >= 0
    && del.indexOf('ChessClockPrefs.shared.forget()') < del.indexOf('AccountDeletion.eraseAll()'),
    'delete-account resets the live prefs before erasing them');
  eq(CC.homeSubtitle(C.DEFAULT), 'Blitz · 5 | 3', 'the Home tile reads "Blitz · 5 | 3" on a fresh install');
  expect(/static func homeSubtitle\(_ c: TimeControl\) -> String \{ c\.category\.label \+ " · " \+ c\.label \}/.test(strings),
    'and the Swift builds it the same way');
}

// ── §4 the Swift screen's wiring ──────────────────────────────────────────────────
{
  const screen = read(UI, 'ChessClockScreen.swift');
  expect(screen.length > 0, 'ChessClockScreen.swift exists');
  expect(/half\(\.top\)\s*\n\s*\.rotationEffect\(\.degrees\(180\)\)/.test(screen),
    'the top half is turned 180° — portrait, so OrientationGate keeps its one writer');
  expect(!/OrientationGate/.test(screen), 'and the clock never touches the orientation gate');
  expect(/@State private var tick = Timer\.publish\(every: ChessClockMetrics\.tickSeconds/.test(screen),
    'the tick publisher lives in @State (the Turbo lesson)');
  expect(/ProcessInfo\.processInfo\.systemUptime/.test(screen) && !/Date\(\)/.test(screen),
    'time is monotonic uptime, never the wall clock');
  expect(/\.onChange\(of: clock\.status\) \{ _, status in\s*ChessClockIdle\.keepAwake\(status == \.running\)/.test(screen),
    'the screen stays awake exactly while the clock runs');
  expect(/\.onDisappear \{ ChessClockIdle\.keepAwake\(false\) \}/.test(screen),
    'and is released when the screen goes away');
  const idle = screen.slice(screen.indexOf('enum ChessClockIdle'));
  expect(/#if os\(iOS\)\s*UIApplication\.shared\.isIdleTimerDisabled = on\s*#endif/.test(idle),
    'isIdleTimerDisabled is set on iOS only, so the macOS demo still builds');
  expect(/\.onChange\(of: scenePhase\) \{ _, phase in\s*if phase != \.active \{ pauseIfRunning\(\) \}/.test(screen),
    'leaving the app pauses the game');
  const pressFn = funcBody(screen, 'press') || '';
  expect(/guard clock\.press\(side, at: t\) else \{ return \}/.test(pressFn)
    && /Haptics\.play\(\.move\)/.test(pressFn),
    'a counted press buzzes; an ignored one does nothing');
  const tickFn = funcBody(screen, 'onTick') || '';
  expect(/guard clock\.status == \.running else \{ return \}/.test(tickFn)
    && /if clock\.tick\(at: t\) \{/.test(tickFn), 'the tick only works while running, and raises the flag');
  const askReset = funcBody(screen, 'askReset') || '';
  expect(/guard clock\.status != \.ready else \{ return \}/.test(askReset) && /confirmingReset = true/.test(askReset),
    'reset asks first when there is a game to lose');
  expect(/barButton\("timer"[\s\S]{0,120}pauseIfRunning\(\)\s*editing = true/.test(screen),
    'opening the time control pauses a running game first');
  const startFn = funcBody(screen, 'start') || '';
  expect(/prefs\.control = control/.test(startFn) && /clock\.setControl\(control\)/.test(startFn),
    'a new control is saved AND starts a fresh game');
  const playFn = funcBody(screen, 'play') || '';
  expect(/guard prefs\.sound else \{ return \}/.test(playFn), 'the sound switch is honoured');
  // No literal number or string in a view modifier — every one is a ChessClockMetrics constant.
  const literal = screen.match(/\.(padding|frame|font|cornerRadius)\([^)]*\b\d+(\.\d+)?\b(?![\w.])/g) || [];
  eq(literal.join(' | '), '', 'no layout literal in the clock screen');
}

// ── §5 Home: the seventh tile, in the band Donate left ───────────────────────────
{
  const parts = read(UI, 'HomeParts.swift');
  const row = parts.slice(parts.indexOf('struct HomeBannerRow: View {'));
  expect(/Button\(action: onClock\) \{\s*HomeBanner\(emoji: ChessClockStrings\.homeEmoji,\s*title: ChessClockStrings\.title/.test(row),
    'the clock tile is a HomeBanner in the bottom band, so the grid is untouched');
  expect(/subtitle: clockSubtitle/.test(row), 'its subtitle is the last control used');
  const home = read(UI, 'HomeScreen.swift');
  expect(/ForEach\(0\.\.<3, id: \\\.self\) \{ row in/.test(home),
    'the grid is still three rows — the clock did not cost the six cards anything');
  const phone = read(UI, 'PhoneView.swift');
  expect(/clockSubtitle: ChessClockStrings\.homeSubtitle\(clockPrefs\.control\)/.test(phone),
    'PhoneApp feeds the tile the saved control');
  expect(/onClock: \{\s*withAnimation/.test(phone) && !/onClock: gated/.test(phone),
    'and opens the clock ungated — it is free');
  expect(/if showClock \{[\s\S]{0,200}ChessClockScreen\(prefs: clockPrefs, onExit: \{ showClock = false \}\)/.test(phone),
    'the clock is a sibling layer, closed by its own ✕');
  const HOME = require(path.join(JS, 'home.js'));
  eq(HOME.CLOCK_TILE.emoji, CC.STR.homeEmoji, 'the browser tile\'s emoji is the shared one');
  eq(HOME.CLOCK_TILE.title, CC.STR.title, 'and its title');
  const app = code(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'));
  expect(/else if \(action === 'clock'\) \{ current = 'clock'; render\(\); \}/.test(app),
    'the browser routes the tile to the clock');
  expect(/if \(current !== 'clock'\) BiyaChessClock\.leave\(\);/.test(app),
    'and stops its tick and wake lock on any other route');
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  expect(order.indexOf('chess-clock.js') >= 0 && order.indexOf('chess-clock.js') < order.indexOf('app.js'),
    'chess-clock.js loads before app.js, which reads it at Home');
}

// ── §6 the browser screen, rendered and driven ───────────────────────────────────
{
  const store = {};
  const saved = { localStorage: global.localStorage, document: global.document,
                  setInterval: global.setInterval, clearInterval: global.clearInterval,
                  performance: global.performance };
  function node(tag) {
    const n = {
      tagName: tag, className: '', children: [], attrs: {}, onclick: null, type: '', disabled: false,
      _text: '', style: { setProperty(k, v) { this[k] = v; } },
      appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
      remove() { if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); },
      setAttribute(k, v) { n.attrs[k] = String(v); }, classList: { add() {}, remove() {} },
    };
    Object.defineProperty(n, 'textContent', { get() { return n._text; }, set(v) { n._text = String(v); n.children.length = 0; } });
    Object.defineProperty(n, 'innerHTML', { get() { return ''; }, set() { n.children.length = 0; } });
    return n;
  }
  const walk = (n, out = []) => { out.push(n); n.children.forEach((c) => walk(c, out)); return out; };
  const byClass = (root, cls) => walk(root).filter((n) => (' ' + n.className + ' ').indexOf(' ' + cls + ' ') >= 0);
  let clock = 0, interval = null;
  global.performance = { now: () => clock };
  global.setInterval = (fn) => { interval = fn; return 1; };
  global.clearInterval = () => { interval = null; };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null),
                          setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  global.document = { createElement: node, addEventListener() {}, removeEventListener() {}, hidden: false };
  try {
    const view = node('div');
    let exited = false;
    CC.render(view, () => { exited = true; });
    const root = view.children[0];
    const top = byClass(root, 'clk-top')[0], bottom = byClass(root, 'clk-bottom')[0];
    const timeOf = (h) => byClass(h, 'clk-time')[0].textContent;
    const chipOf = (h) => byClass(h, 'clk-chip-text')[0].textContent;
    const kingOf = (h) => { const k = byClass(h, 'clk-chip-king')[0]; return k.style.display === 'none' ? null : k.src; };
    eq(timeOf(top), '5:00', 'a fresh clock reads 5:00 on top');
    eq(timeOf(bottom), '5:00', 'and on the bottom');
    eq(chipOf(bottom), CC.STR.tapToStart, 'and says how to begin');
    expect(/is-ready/.test(top.className), 'both halves start ready');
    const btns = byClass(root, 'clk-btn');
    eq(btns.length, 5, 'the bar has five controls');
    expect(btns[2].disabled, 'pause is disabled before the game starts');
    bottom.onclick();                                   // Black presses: White's (top) clock runs
    expect(/is-active/.test(top.className) && /is-waiting/.test(bottom.className), 'the top clock runs');
    eq(chipOf(top), CC.STR.white, 'and the top player is White');
    eq(kingOf(top), 'assets/pieces/king-w.svg', 'beside the board\'s own white king, not a font glyph');
    eq(kingOf(bottom), 'assets/pieces/king-b.svg', 'and the bottom beside the black one');
    expect(typeof interval === 'function', 'a tick is running');
    clock = 4000; interval();
    eq(timeOf(top), '4:56', 'four seconds later the top reads 4:56');
    top.onclick();                                      // White moves: +3
    eq(timeOf(top), '4:59', 'the move banks the 3 s increment');
    eq(byClass(top, 'clk-bonus')[0].textContent, '+3' + CC.STR.bonusSecondsUnit, 'and flashes +3s');
    eq(byClass(top, 'clk-moves')[0].textContent, CC.STR.moves + ': 1', 'and counts the move');
    clock = 9000; interval();
    eq(byClass(top, 'clk-bonus')[0].textContent, '', 'the flash is gone after a second and a bit');
    btns[2].onclick();                                  // pause
    expect(/is-paused/.test(bottom.className), 'pause dims both halves');
    clock = 60000;
    eq(timeOf(bottom), '4:55', 'and freezes the running clock');
    bottom.onclick();
    eq(timeOf(bottom), '4:55', 'a tap while paused does nothing');
    btns[2].onclick();                                  // resume
    clock = 360000; interval();
    expect(/is-flagged/.test(bottom.className) && /is-winner/.test(top.className), 'the bottom flag falls');
    eq(chipOf(bottom), CC.STR.flagGlyph + ' ' + CC.STR.timesUp, 'the loser reads Time\'s up');
    eq(chipOf(top), CC.STR.trophyGlyph + ' ' + CC.STR.winsOnTime, 'the winner Wins on time');
    eq(kingOf(top), null, 'and no king is drawn once the game is decided');
    expect(interval === null, 'and the tick stops');
    btns[4].onclick();                                  // sound off
    eq(JSON.parse(store[CC.STORAGE_KEY]).sound, false, 'the sound switch is saved');
    btns[1].onclick();                                  // reset after a finished game asks
    const modal = byClass(root, 'clk-modal')[0];
    expect(!!modal, 'reset asks first when there was a game');
    byClass(modal, 'clk-modal-yes')[0].onclick();
    eq(timeOf(top), '5:00', 'and resets to the same control');
    btns[3].onclick();                                  // the time-control sheet
    const sheet = byClass(root, 'clk-sheet')[0];
    expect(!!sheet, 'the timer button opens the time-control sheet');
    eq(byClass(sheet, 'clk-preset').length, C.PRESETS.length, 'with every preset');
    byClass(sheet, 'clk-preset').find((b) => b.textContent === '3 | 2').onclick();
    byClass(byClass(root, 'clk-sheet')[0], 'clk-sheet-start')[0].onclick();
    eq(timeOf(top), '3:00', 'Start puts the new control on the clock');
    expect(C.sameControl(JSON.parse(store[CC.STORAGE_KEY]).control, C.fromMinutes(3, 2)),
      'and saves it for next time');
    eq(CC.homeSubtitle(CC.loadPrefs().control), 'Blitz · 3 | 2', 'which the Home tile then names');
    store[CC.STORAGE_KEY] = '{not json';
    expect(C.sameControl(CC.loadPrefs().control, C.DEFAULT), 'a corrupt record reads as the default');
    btns[0].onclick();
    expect(exited && interval === null, '✕ closes the clock and stops it');
  } finally {
    Object.assign(global, saved);
  }
}

const result = () => ({
  passed, failures, ok: failures.length === 0,
  summary: failures.length === 0
    ? `ChessClock: ${passed} checks hold (the Swift group makes ${swiftChecks})`
    : `ChessClock: ${passed} held, ${failures.length} FAILED\n` + failures.map((f) => '  ✗ ' + f).join('\n'),
});

module.exports = { selfTest: result, run: result, swiftChecks: () => swiftChecks };

if (require.main === module) {
  const r = result();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
