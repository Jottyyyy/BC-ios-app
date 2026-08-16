#!/usr/bin/env node
/*
 * replay_login.js — check the login screen's Swift against the JavaScript that has actually run.
 *
 *     node tools/qa/replay_login.js
 *
 * `swift` is not on PATH on this checkout, so `LoginMetrics.swift`, `LoginStore.swift`,
 * `LoginScreen.swift` and `LoginMetricsCheck.swift` were written blind. This is the mitigation
 * every phase of this rebuild has used: pull the concrete values out of the Swift SOURCE TEXT and
 * compare them with the JS twin, which is proven by `BiyaLogin.selfTest()`.
 *
 * It does not prove the Swift compiles. It proves the numbers, the colours, the drift table and the
 * copy in it are the right ones — the half a compiler would not have caught anyway.
 *
 * It also guards four things that are not values at all and have bitten this repo before:
 *
 *   • the OFFLINE guarantee — no URLSession, no URLRequest, no http(s):// anywhere in the login
 *     feature. `ios/project.yml`'s export-compliance `NO` rests on the claim that the app has no
 *     network, and a login screen is the single most likely place to break it.
 *   • the SCRIPT ORDER — `js/login.js` must load before `js/app.js`, which reads it at boot.
 *   • the STYLESHEET — `css/coach.css` shipped 507 lines that `index.html` never linked, and
 *     nothing noticed. The login styles live in `app.css`, which IS linked, and this asserts it.
 *   • the CSS VARIABLES — every `--lg-*` the JS sets must be read by the CSS and vice versa. A
 *     variable set but never read is dead; one read but never set silently falls back to nothing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
/** `want` is always the value read out of the Swift source; `got` is what the JS produced. */
const eq = (got, want, what) => expect(got === want,
  `${what}: Swift says ${JSON.stringify(want)}, JS gives ${JSON.stringify(got)}`);
const near = (got, want, what) => expect(
  typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9,
  `${what}: Swift says ${want}, JS gives ${got}`);

/** Strip comments, so a documented value is never mistaken for a live one. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The body of a top-level `enum X { … }` / `struct X { … }`, by brace matching. */
function blockOf(src, name) {
  const at = src.search(new RegExp('(?:public )?(?:enum|struct) ' + name + '\\b[^\\n{]*\\{'));
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

/** The body of a `func name(` … `)` by brace matching. */
function funcBody(src, name) {
  const at = src.search(new RegExp('func\\s+' + name + '\\s*[(<]'));
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

function read(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) { failures.push('missing ' + file); return ''; }
  return fs.readFileSync(full, 'utf8');
}

// ---- Swift readers -----------------------------------------------------------------------------

let THEME = '';

/** `Theme.radius` / `Theme.radiusButton` — the shape tokens the login layout reuses by name. */
function themeNumber(name) {
  const m = new RegExp(`static let ${name}\\s*:\\s*CGFloat\\s*=\\s*(-?[\\d.]+)`).exec(code(THEME));
  return m ? Number(m[1]) : null;
}

/** `static let background = c(0x0F1A2E)` / `c(0x4A9FE8, 0.12)` in Theme.swift. */
function themeColor(name) {
  const m = new RegExp(`static let ${name}\\s*=\\s*c\\(0x([0-9A-Fa-f]{6})(?:,\\s*([\\d.]+))?\\)`)
    .exec(code(THEME));
  if (!m) return null;
  return colorKey(m[1], m[2]);
}

function colorKey(hex, alpha) {
  const h = hex.toUpperCase();
  return alpha === undefined ? '#' + h : 'rgba' + h + '@' + Number(alpha);
}

/**
 * `static let name: CGFloat = 12.5`, `= 0.35`, or `= Theme.radiusButton`.
 * Resolving the `Theme.` indirection is the point: the Swift says "reuse the app's button radius"
 * and the JS has to say 14, and this is what proves those are the same statement.
 */
function swNum(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*([^\\n]+)`).exec(code(block));
  if (!m) return null;
  const rhs = m[1].trim();
  const lit = /^(-?[\d.]+)/.exec(rhs);
  if (lit) return Number(lit[1]);
  const themed = /^Theme\.(\w+)/.exec(rhs);
  return themed ? themeNumber(themed[1]) : null;
}

/** `static let x = Theme.c(0xRRGGBB[, a])` or `static let x = Theme.<token>`. */
function swColor(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const direct = new RegExp(`static let ${name}\\s*=\\s*Theme\\.c\\(0x([0-9A-Fa-f]{6})(?:,\\s*([\\d.]+))?\\)`)
    .exec(code(block));
  if (direct) return colorKey(direct[1], direct[2]);
  const alias = new RegExp(`static let ${name}\\s*=\\s*Theme\\.(\\w+)\\s*$`, 'm').exec(code(block));
  return alias ? themeColor(alias[1]) : null;
}

/** `static let name = "…"`. */
function swStr(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}\\s*=\\s*"((?:[^"\\\\\\n]|\\\\.)*)"`).exec(code(block));
  if (!m) return null;
  return m[1].replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * A Swift `"""` literal, resolved the way the compiler resolves one: the closing delimiter's
 * indentation is stripped from every line, then a trailing `\` swallows its own newline.
 */
function swMultiline(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const at = block.search(new RegExp(`static let ${name}\\s*=\\s*"""`));
  if (at < 0) return null;
  const start = block.indexOf('\n', block.indexOf('"""', at)) + 1;
  const end = block.indexOf('"""', start);
  if (start <= 0 || end < 0) return null;
  const closingIndent = /(^|\n)([ \t]*)$/.exec(block.slice(start, end))[2];
  const lines = block.slice(start, end).replace(/\n[ \t]*$/, '').split('\n')
    .map((l) => (l.startsWith(closingIndent) ? l.slice(closingIndent.length) : l.replace(/^[ \t]+/, '')));
  return lines.join('\n').replace(/\\\n/g, '');
}

/** The JS colour form, in the shape `swColor` returns. */
function jsColorKey(v) {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]*)\s*)?\)$/.exec(v);
  if (!m) return v;
  const hex = [m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).toUpperCase().padStart(2, '0')).join('');
  return m[4] === undefined ? '#' + hex : 'rgba' + hex + '@' + Number(m[4]);
}

// ---- the run -----------------------------------------------------------------------------------

function run() {
  passed = 0; failures.length = 0;

  const L = require(path.join(JS, 'login.js'));
  THEME = read(UI, 'Theme.swift');
  const metrics = read(UI, 'LoginMetrics.swift');
  const store = read(UI, 'LoginStore.swift');
  const screen = read(UI, 'LoginScreen.swift');
  const check = read(UI, 'LoginMetricsCheck.swift');
  if (!metrics || !store || !screen) return finish();

  // 1. The JS self-test must be green before its values are used as a yardstick for anything.
  const self = L.selfTest();
  expect(self.ok, 'BiyaLogin.selfTest is green: ' + self.summary.split('\n')[0]);
  passed += 0;

  // 2. Typography — every key the JS declares must exist in the Swift with the same value.
  Object.keys(L.TYPE).forEach((k) => {
    near(L.TYPE[k], swNum(metrics, 'LoginType', k), 'LoginType.' + k);
  });

  // 3. Layout, including the `Theme.` indirections (buttonRadius, sheetRadius, sheetCloseRadius).
  Object.keys(L.LAYOUT).forEach((k) => {
    near(L.LAYOUT[k], swNum(metrics, 'LoginLayout', k), 'LoginLayout.' + k);
  });
  eq(L.LAYOUT.buttonRadius, themeNumber('radiusButton'), 'the button reuses Theme.radiusButton');
  eq(L.LAYOUT.sheetRadius, themeNumber('radius'), 'the legal sheet reuses Theme.radius');

  // 4. Timing.
  Object.keys(L.TIMING).forEach((k) => {
    near(L.TIMING[k], swNum(metrics, 'LoginTiming', k), 'LoginTiming.' + k);
  });

  // 5. Palette. Apple's two colours are asserted twice on purpose — once here as a Swift/JS match,
  //    and once as an absolute, because "both languages agree it is gold" is still wrong.
  Object.keys(L.PALETTE).forEach((k) => {
    eq(jsColorKey(L.PALETTE[k]), swColor(metrics, 'LoginPalette', k), 'LoginPalette.' + k);
  });
  eq(jsColorKey(L.PALETTE.appleFill), '#FFFFFF', 'the Apple button is pure white in both languages');
  eq(jsColorKey(L.PALETTE.appleInk), '#000000', 'the Apple mark is pure black in both languages');
  eq(swColor(metrics, 'LoginPalette', 'legal'), '#3A5070',
    "the legal footer keeps the RN login screen's colour");

  // 6. The band budget, recomputed from the Swift's own numbers rather than trusted.
  const swFixed = swNum(metrics, 'LoginLayout', 'heroTopPadding')
    + swNum(metrics, 'LoginLayout', 'logoSize')
    + swNum(metrics, 'LoginLayout', 'heroSpacing')
    + Math.round(swNum(metrics, 'LoginType', 'titleSize') * swNum(metrics, 'LoginType', 'lineHeightRatio'))
    + swNum(metrics, 'LoginLayout', 'titleTaglineGap')
    + Math.round(swNum(metrics, 'LoginType', 'taglineSize') * swNum(metrics, 'LoginType', 'lineHeightRatio'))
    + swNum(metrics, 'LoginLayout', 'buttonHeight')
    + swNum(metrics, 'LoginLayout', 'reassureTopGap')
    + Math.round(swNum(metrics, 'LoginType', 'reassureSize') * swNum(metrics, 'LoginType', 'lineHeightRatio'))
    + swNum(metrics, 'LoginLayout', 'footerTopGap')
    + Math.round(swNum(metrics, 'LoginType', 'legalSize') * swNum(metrics, 'LoginType', 'lineHeightRatio'))
    + swNum(metrics, 'LoginLayout', 'footerBottomPadding');
  near(L.fixedHeight(), swFixed, 'the fixed band budget');
  expect(swFixed + swNum(metrics, 'LoginLayout', 'minSpacer')
    <= swNum(metrics, 'LoginLayout', 'shortestSupportedHeight'),
  'the Swift budget fits the shortest supported phone');

  // 7. The drift table, element by element. A background that differs between the two languages is
  //    the exact drift this mirror exists to catch.
  const driftBlock = blockOf(metrics, 'LoginDrift') || '';
  const specs = [...code(driftBlock).matchAll(/LoginDriftSpec\(([\s\S]*?)\)/g)].map((m) => {
    const o = {};
    m[1].split(',').forEach((pair) => {
      const kv = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(pair);
      if (!kv) return;
      o[kv[1]] = kv[2] === 'true' ? true : kv[2] === 'false' ? false
        : /^"/.test(kv[2]) ? kv[2].slice(1, -1) : Number(kv[2]);
    });
    return o;
  });
  eq(specs.length, L.DRIFT.length, 'the drift table has the same length in both languages');
  L.DRIFT.forEach((js, i) => {
    const sw = specs[i];
    if (!sw) { failures.push('drift spec ' + i + ' missing from the Swift'); return; }
    Object.keys(js).forEach((k) => {
      if (typeof js[k] === 'number') near(js[k], sw[k], `drift[${i}].${k}`);
      else eq(js[k], sw[k], `drift[${i}].${k}`);
    });
  });
  // Every kind in the table must have real bundled art, in both languages.
  L.DRIFT.forEach((spec, i) => {
    const svg = path.join(ROOT, 'web-demo', 'assets', 'pieces',
      spec.kind + '-' + (spec.white ? 'w' : 'b') + '.svg');
    expect(fs.existsSync(svg), `drift[${i}] art exists in web-demo (${path.basename(svg)})`);
    const swiftSvg = path.join(UI, 'Pieces', spec.kind + '-' + (spec.white ? 'w' : 'b') + '.svg');
    expect(fs.existsSync(swiftSvg), `drift[${i}] art exists in the Swift bundle`);
  });

  // 8. The session, both the constants and the state machine's branches.
  eq(L.SESSION.storageKey, swStr(metrics, 'LoginSession', 'storageKey'), 'LoginSession.storageKey');
  eq(L.SESSION.appleProvider, swStr(metrics, 'LoginSession', 'appleProvider'),
    'LoginSession.appleProvider');
  expect(/static let providers:\s*\[String\]\s*=\s*\[appleProvider\]/.test(code(metrics)),
    'the Swift provider list is exactly [appleProvider], like the JS');
  const signIn = funcBody(store, 'signIn') || '';
  const signOut = funcBody(store, 'signOut') || '';
  expect(/guard LoginSession\.isSignedIn\(provider\)/.test(code(signIn)),
    'Swift signIn refuses a provider the predicate does not know, like the JS');
  expect(/self\.provider != provider/.test(code(signIn)),
    'Swift signIn is idempotent, like the JS');
  expect(/storage\.set\(LoginSession\.storageKey, provider\)/.test(code(signIn)),
    'Swift signIn persists the provider');
  expect(/guard provider != nil/.test(code(signOut)), 'Swift signOut is idempotent, like the JS');
  expect(/storage\.remove\(LoginSession\.storageKey\)/.test(code(signOut)),
    'Swift signOut REMOVES the key rather than blanking it, like the JS');
  // Fail closed at construction. This is the branch that decides whether a bad stored value lets
  // someone past the gate, so it is asserted in the source and not only in the check.
  expect(/LoginSession\.isSignedIn\(raw\)\s*\?\s*raw\s*:\s*nil/.test(code(store)),
    'the Swift store fails closed on an unrecognised stored value, like the JS');

  // 8b. At most ONE legal sheet. The Swift holds a single optional `legalTopic`, so opening Terms
  //     over Privacy swaps it; the browser appends a node and WILL stack them without an explicit
  //     removal — which it did, until a click-twice in the real browser found it.
  expect(/@State private var legalTopic: LoginLegalTopic\?/.test(code(screen)),
    'the Swift holds ONE optional legal topic, so a second tap swaps rather than stacks');
  const loginJs = code(fs.readFileSync(path.join(JS, 'login.js'), 'utf8'));
  expect(/function legalSheet[\s\S]{0,400}?querySelector\('\.lg-sheet'\)[\s\S]{0,120}?removeChild/
    .test(loginJs), 'the JS removes an open sheet before appending one, so taps cannot stack them');

  // 9. Copy. The two long legal bodies are compared in full — they are the likeliest thing in the
  //    feature to be edited in one language only.
  ['title', 'tagline', 'appleButton', 'reassurance', 'privacy', 'terms', 'legalSeparator',
    'defaultDisplayName', 'appleProviderLabel', 'noProviderLabel', 'accountCard', 'signedInWith',
    'signOut', 'sheetClose', 'privacyTitle', 'termsTitle'].forEach((k) => {
    eq(L.STRINGS[k], swStr(metrics, 'LoginStrings', k), 'LoginStrings.' + k);
  });
  ['privacyBody', 'termsBody'].forEach((k) => {
    eq(L.STRINGS[k], swMultiline(metrics, 'LoginStrings', k), 'LoginStrings.' + k);
  });
  eq(L.STRINGS.appleButton, 'Continue with Apple', "Apple's required button wording, verbatim");

  // 10. THE OFFLINE GUARANTEE. `ios/project.yml`'s export-compliance NO says the app has no
  //     network at all, and a login screen is the single most likely place to break that.
  const sources = { 'LoginMetrics.swift': metrics, 'LoginStore.swift': store,
    'LoginScreen.swift': screen, 'LoginMetricsCheck.swift': check,
    'web-demo/js/login.js': fs.readFileSync(path.join(JS, 'login.js'), 'utf8') };
  Object.keys(sources).forEach((name) => {
    const src = code(sources[name]);
    ['URLSession', 'URLRequest', 'fetch(', 'XMLHttpRequest', 'ASAuthorization'].forEach((tok) => {
      expect(src.indexOf(tok) < 0, `${name} contains no ${tok} — the sign-in is simulated`);
    });
    const urls = src.match(/https?:\/\/[^\s"')]+/g) || [];
    expect(urls.length === 0, `${name} contains no URL (${urls.join(', ')})`);
  });

  // 11. The wiring the browser needs. `css/coach.css` shipped unlinked and nothing noticed; these
  //     are the three ways this feature could ship the same silent nothing.
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  expect(order.includes('login.js'), 'index.html loads js/login.js');
  expect(order.indexOf('login.js') >= 0 && order.indexOf('login.js') < order.indexOf('app.js'),
    'js/login.js loads BEFORE js/app.js, which reads it at boot');
  const cssHref = [...html.matchAll(/<link rel="stylesheet" href="css\/([^"]+)"/g)].map((m) => m[1]);
  expect(cssHref.includes('app.css'), 'index.html links the stylesheet the login styles live in');

  const css = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
  expect(/\/\* ---- Login/.test(css), 'app.css has a Login section');
  ['.lg-view', '.lg-logo', '.lg-apple', '.lg-sheet-card', '.lg-signout'].forEach((sel) => {
    expect(css.indexOf('\n' + sel) >= 0 || css.indexOf(sel + ' {') >= 0,
      'app.css styles ' + sel);
  });

  const appJs = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  expect(/current === 'login'\) renderLogin\(\)/.test(appJs),
    "app.js's router has a 'login' branch — without one the trailing else silently shows the old "
    + 'sample-puzzle tab');
  expect(/BiyaLogin\.shared\(\)\.isSignedIn\(\)\s*\?\s*'home'\s*:\s*'login'/.test(appJs),
    'app.js gates the FIRST screen on the session');
  expect(/appCard\(\)\.classList\.add\('an-mode'\)/.test(appJs.slice(appJs.indexOf('function renderLogin'))),
    'renderLogin hides the tab bar');
  expect(/BiyaLogin\.selfTest\(\)/.test(appJs), 'index.html?selftest runs the login self-test');

  // 12. The `--lg-*` custom properties, both directions. One set but never read is dead code; one
  //     read but never set silently falls back to nothing.
  const setVars = new Set();
  fs.readdirSync(JS).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    for (const m of src.matchAll(/setProperty\(\s*'(--lg-[\w-]+)'/g)) setVars.add(m[1]);
  });
  const readVars = new Set();
  for (const m of css.matchAll(/var\(\s*(--lg-[\w-]+)/g)) readVars.add(m[1]);
  expect(setVars.size > 0, 'the login screen sets --lg-* custom properties');
  setVars.forEach((v) => expect(readVars.has(v), `${v} is set by the JS and read by the CSS`));
  readVars.forEach((v) => expect(setVars.has(v), `${v} is read by the CSS and set by the JS`));

  // 13. The bundled brand mark, in both trees.
  expect(fs.existsSync(path.join(UI, 'Images', 'brand-logo.png')),
    'the brand mark is in the SwiftPM resource bundle');
  expect(fs.existsSync(path.join(ROOT, 'web-demo', 'assets', 'images', 'brand-logo.png')),
    'the brand mark is in web-demo');
  expect(/case brandLogo = "brand-logo"/.test(code(read(UI, 'HomeArt.swift'))),
    'HomeArt knows the brand mark');
  expect(/png != 6/.test(code(read(UI, 'Diagnostics.swift'))),
    'Diagnostics counts the sixth PNG, or a missing bundle would warn on every launch');

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayLogin: ${passed} Swift expectations confirmed against the JS`
      : `ReplayLogin: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
