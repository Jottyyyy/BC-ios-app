#!/usr/bin/env node
/*
 * nav_icons_check.js — back and ☰ are vectors, from one set of numbers, in both languages.
 *
 *     node tools/qa/nav_icons_check.js
 *
 * Why this exists. An inventory of the two renderers turned up something no suite could see: Swift
 * drew `Image(systemName: "chevron.left")` on the puzzle screens and the paywall while the browser
 * drew the character `←` on those same screens. The two languages had visibly diverged and **not
 * one assertion anywhere named a glyph, an icon or a button class** — grepping tools/qa/ for
 * `hbtn`, `☰`, `←`, `headerBtn` or `backBtn` found only numeric metric parity.
 *
 * The rest was worse than divergence. `←` (U+2190) and `☰` (U+2630) were drawn at 22pt in Nunito, a
 * font that has neither, so both fell back to whatever face the platform picked; and `☰` is the I
 * Ching trigram for heaven, with thin bars and uneven gaps, not a hamburger. `CoachLayout.swift`
 * had described them for what they were all along: "icons that happen to be characters."
 *
 * So this file pins the three things that fix is made of:
 *
 *   1. the glyphs do not come back, in either language;
 *   2. every button goes through the one shared component — `NavIconButton` / `BiyaIcons`;
 *   3. the two components draw the SAME geometry, number for number.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const JSDIR = path.join(ROOT, 'web-demo', 'js');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };
const eq = (a, b, what) => expect(a === b, `${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

const swiftFiles = fs.readdirSync(UI).filter((f) => f.endsWith('.swift')).sort();
const jsFiles = fs.readdirSync(JSDIR).filter((f) => f.endsWith('.js')).sort();
expect(swiftFiles.length > 20 && jsFiles.length > 20,
  `expected both source trees, found ${swiftFiles.length} swift / ${jsFiles.length} js`);

const swift = new Map(swiftFiles.map((f) => [f, fs.readFileSync(path.join(UI, f), 'utf8')]));
const js = new Map(jsFiles.map((f) => [f, fs.readFileSync(path.join(JSDIR, f), 'utf8')]));

/** Source with `//` line comments removed, so prose ABOUT a retired glyph never trips a rule. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const swiftCode = new Map([...swift].map(([f, s]) => [f, strip(s)]));
const jsCode = new Map([...js].map(([f, s]) => [f, strip(s)]));

// ---- 1. the glyphs do not come back ------------------------------------------
// U+2190 LEFTWARDS ARROW and U+2630 TRIGRAM FOR HEAVEN, in source or as an escape.
// A BARE glyph — one that is the whole string literal — is an icon, and is banned. The same
// character inside a sentence is COPY: `"← Back to Daily Puzzle"` is a labelled text link extracted
// from the RN source, and splitting it would break string parity for no gain. The client asked
// about the back BUTTON and the hamburger, not about link text.
const BANNED = [
  { re: /(["'`])\s*←\s*\1/, name: 'a bare ← as an icon' },
  { re: /(["'`])\s*☰\s*\1/, name: 'a bare ☰ as an icon' },
  { re: /\\u\{2190\}/, name: 'the escape \\u{2190} (←)' },
  { re: /\\u\{2630\}/, name: 'the escape \\u{2630} (☰)' },
  { re: />\s*←\s*</, name: 'a ← written straight into markup' },
  { re: />\s*☰\s*</, name: 'a ☰ written straight into markup' },
];
for (const [file, s] of swiftCode) {
  for (const b of BANNED) {
    expect(!b.re.test(s),
      `${file} contains ${b.name}. Back and menu are vectors — NavIconButton(.back / .menu), `
      + 'see NavIcons.swift. A character falls back to whatever face the platform has.');
  }
}
for (const [file, s] of jsCode) {
  for (const b of BANNED) {
    expect(!b.re.test(s),
      `web-demo/js/${file} contains ${b.name}. Back and menu are vectors — BiyaIcons.back() / `
      + '.menu(), see js/icons.js.');
  }
}
// And the four transport arrows are deliberately NOT in that list: they are still glyphs, on
// purpose, and this asserts the scope line has not quietly moved.
expect(/⏮/.test(swift.get('CoachLayout.swift') || ''),
  'the transport glyphs are still characters — only back and menu were converted');

// ---- 2. one component, everywhere --------------------------------------------
// SF Symbols were the OTHER drawing path, and having two is how the languages drifted.
for (const [file, s] of swiftCode) {
  expect(!/systemName:\s*"chevron\.left"/.test(s),
    `${file} draws an SF Symbol chevron. There is one back icon now and the browser can draw it `
    + 'too; that is the whole point (NavIcons.swift).');
}
const navIcons = swift.get('NavIcons.swift');
expect(navIcons !== undefined, 'NavIcons.swift exists');
for (const sym of ['enum NavIcon', 'struct BackChevron: Shape', 'struct MenuBars: Shape',
                   'struct NavIconGlyph', 'struct NavIconButton', 'struct NavIconPressStyle']) {
  expect((navIcons || '').includes(sym), `NavIcons.swift declares ${sym}`);
}
const icons = js.get('icons.js');
expect(icons !== undefined, 'web-demo/js/icons.js exists');
for (const sym of ['var GEO', 'function back(', 'function menu(', 'currentColor']) {
  expect((icons || '').includes(sym), `icons.js declares ${sym}`);
}
// `currentColor` is what lets every screen keep its own tint without this module knowing any of
// them — pairing gold, coach white, analysis off-white.
expect(/stroke="currentColor"/.test(icons || ''),
  'the browser icons stroke with currentColor, so each screen keeps its own colour rule');

// Every browser back/menu button goes through BiyaIcons, and carries `nav-icon` so the shared
// sizing and hit-area rule applies.
//
// The markup is assigned with `innerHTML`, never handed to `el()`'s third argument: in every screen
// file except analysis.js that argument is `textContent`, so an SVG string passed there is inserted
// as literal TEXT and draws nothing at all. That is exactly what happened on the first pass, and
// the browser was the only thing that caught it — hence this rule.
let buttons = 0;
for (const [file, s] of jsCode) {
  if (file === 'icons.js') continue;
  const re = /(\w+) = el\('button',\s*'([^']*\b(?:back|hbtn)\b[^']*)'\s*(,\s*([^)]*))?\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    buttons++;
    const varName = m[1], cls = m[2], arg = m[4];
    expect(/\bnav-icon\b/.test(cls),
      `web-demo/js/${file}: button '${cls}' is missing the nav-icon class, so it gets neither the `
      + 'shared icon size nor the 44px hit area');
    expect(arg === undefined,
      `web-demo/js/${file}: button '${cls}' passes content to el() — in most of these files that `
      + `is textContent, and an SVG string set as text draws nothing. Assign ${varName}.innerHTML.`);
    expect(new RegExp(varName + '\\.innerHTML = BiyaIcons\\.(back|menu)\\(').test(s),
      `web-demo/js/${file}: '${cls}' never gets BiyaIcons markup via ${varName}.innerHTML`);
  }
}
// The paywall builds its header as one innerHTML string rather than through `el`.
expect(/class="pw-back nav-icon"[\s\S]{0,40}BiyaIcons\.back\(\)/.test(jsCode.get('premium.js') || ''),
  'the paywall back button draws BiyaIcons.back() too');
expect(buttons >= 12,
  `expected the back/menu buttons across the browser screens, matched ${buttons} — the regex or the `
  + 'call shape moved');

// The stylesheet's side of it.
const CSS = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
expect(/\.nav-icon\s*\{/.test(CSS), 'app.css declares .nav-icon');
expect(/\.nav-icon\s*>\s*svg\s*\{/.test(CSS), 'and sizes the svg inside it');
expect(/\.nav-icon\s*\{[^}]*min-width:\s*44px/.test(CSS),
  '.nav-icon widens the hit target to Apple\'s 44px minimum, which none of the hand-rolled buttons had');
expect(!/\.nav-icon\s*\{[^}]*min-height:\s*44px/.test(CSS),
  'and does NOT force the height: the Analysis header is 36 tall, and a 44-tall button spills over '
  + "the board's top rank");
expect(/static let hitTarget: CGFloat = 44/.test(navIcons || '')
  && /\.frame\(minWidth: NavIcon\.hitTarget\)/.test(navIcons || ''),
  'and the Swift applies the same 44 to width alone');
expect(fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8').includes('js/icons.js'),
  'index.html loads js/icons.js');

// ---- 3. the two components draw the same geometry ----------------------------
// The whole reason to hand-draw rather than use SF Symbols: both languages can be held to one set
// of numbers. If these drift, the icon looks different in the app than in the demo, which is the
// bug this replaces.
const GEO_KEYS = ['box', 'stroke', 'chevronX', 'chevronTop', 'chevronBottom', 'chevronApex',
                  'barInset', 'barTop', 'barGap'];
const swiftGeo = {};
for (const m of (navIcons || '').matchAll(/static let (\w+)(?::\s*CGFloat)?\s*=\s*(-?[\d.]+)/g)) {
  swiftGeo[m[1]] = Number(m[2]);
}
const jsGeoBlock = /var GEO = \{([\s\S]*?)\n  \};/.exec(icons || '');
expect(jsGeoBlock !== null, 'icons.js has a GEO block this check can read');
const jsGeo = {};
if (jsGeoBlock) {
  for (const m of jsGeoBlock[1].matchAll(/(\w+):\s*(-?[\d.]+)/g)) jsGeo[m[1]] = Number(m[2]);
}
for (const k of GEO_KEYS) {
  expect(swiftGeo[k] !== undefined, `NavIcon.${k} is declared in Swift`);
  expect(jsGeo[k] !== undefined, `GEO.${k} is declared in icons.js`);
  if (swiftGeo[k] !== undefined && jsGeo[k] !== undefined) {
    eq(jsGeo[k], swiftGeo[k], `NavIcon.${k} matches GEO.${k}`);
  }
}
// Sanity on the shapes themselves, so a plausible-looking but wrong number cannot pass.
expect(swiftGeo.chevronApex > swiftGeo.chevronX,
  'the chevron points LEFT — its apex is right of its tip');
expect(swiftGeo.chevronTop < swiftGeo.box / 2 && swiftGeo.chevronBottom > swiftGeo.box / 2,
  'and it straddles the vertical centre');
expect(swiftGeo.barTop + 2 * swiftGeo.barGap < swiftGeo.box - swiftGeo.barInset,
  'the three menu bars fit inside the box with room below');
expect(swiftGeo.barTop + swiftGeo.barGap === swiftGeo.box / 2,
  'and the middle bar sits exactly on the centre line — the thing ☰ never did');

// ---- report ------------------------------------------------------------------
const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `NavIcons: ${passed} icon invariants hold across both languages`
    : `NavIcons: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
