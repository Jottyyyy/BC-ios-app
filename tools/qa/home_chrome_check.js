#!/usr/bin/env node
/*
 * home_chrome_check.js — the Home screen's header and banner band, pinned across both languages.
 *
 *     node tools/qa/home_chrome_check.js
 *
 * Why this exists. Three of the client's round-4 asks land on one band each, and all three are the
 * kind of change that half-lands:
 *
 *   1. The header logo must be the BRAND mark, not the app icon's gold knight. Both assets are
 *      bundled and both are 6-of-6 in `Diagnostics.swift`'s PNG count, so pointing at the wrong one
 *      is invisible to every existing gate — `replay_login.js` only checks that `HomeArt` KNOWS the
 *      brand mark, not that Home draws it.
 *   2. The magnifier button must be gone. Deleting it is one line per language; deleting it
 *      *correctly* is two, because the logo sits at true screen centre only by being flanked by
 *      two equal-width controls. A half-landed removal shifts the mark 19 px right, which looks
 *      like a rendering bug rather than a missing counterweight.
 *   3. Donate must be gone — Apple does not permit an app to collect donations. It had a string
 *      table, a palette entry, a CSS skin, a theme token and a callback in each language, and
 *      leaving any of them is dead weight that reads as "still supported".
 *
 * And one thing that must NOT change: `bannerHeight` budgets two subtitle lines because Donate's
 * subtitle had two. It feeds `fixedBandsHeight` -> `gridHeight` -> `tile(inGridContent:)`, so
 * "tidying" it to one line after Donate leaves silently resizes all six cards on every device.
 *
 * There is no Swift compiler on this checkout, so the Swift half is read as text — the same
 * stand-in `swift_lint.js`, `swift_symbol_check.js` and `nav_icons_check.js` are.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const WEB = path.join(ROOT, 'web-demo');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const PARTS = read(UI, 'HomeParts.swift');
const SCREEN = read(UI, 'HomeScreen.swift');
const HMET = read(UI, 'HomeMetrics.swift');
const LMET = read(UI, 'LoginMetrics.swift');
const HOME_JS = read(WEB, 'js', 'home.js');
const LOGIN_JS = read(WEB, 'js', 'login.js');
const APP_CSS = read(WEB, 'css', 'app.css');
const THEME_CSS = read(WEB, 'css', 'theme.css');

const SWIFT = { 'HomeParts.swift': PARTS, 'HomeScreen.swift': SCREEN, 'HomeMetrics.swift': HMET };
const BROWSER = { 'home.js': HOME_JS, 'app.css': APP_CSS, 'theme.css': THEME_CSS };

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** Source with `//` and `/* *\/` comments blanked, so a comment explaining a removal is not
 *  mistaken for the thing it describes. Crude on purpose: it only has to survive these files. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/\/?|\*).*$/gm, ' ');
}
const CODE = {};
for (const [name, src] of Object.entries(SWIFT)) CODE[name] = code(src);
for (const [name, src] of Object.entries(BROWSER)) CODE[name] = code(src);

// ── 1. The header draws the brand mark, in both languages ───────────────────────
{
  const logo = PARTS.slice(PARTS.indexOf('struct HomeLogo: View {'),
                           PARTS.indexOf('struct HomeHeader: View {'));
  expect(logo.length > 100, 'HomeLogo is still a type in HomeParts.swift');
  expect(/HomeAppIcon\([^)]*asset: \.brandLogo/s.test(logo),
    'HomeLogo draws HomeArt.Asset.brandLogo');
  expect(!/asset: \.appIcon/.test(logo), 'HomeLogo does not draw the app icon');
  // The knight is not deleted — it is still the coach ring and the iOS icon. It just is not this.
  expect(/HomeAppIcon\(size: ring, shape: shape\)/.test(CODE['HomeScreen.swift']),
    'the Play-with-Coach ring still draws the app icon (default asset)');
  expect(/case appIcon = "app-icon"/.test(read(UI, 'HomeArt.swift')),
    'and HomeArt still declares it');

  const src = HOME_JS.match(/class="home-logo"><img src="'\s*\+\s*ART\s*\+\s*'([\w.-]+)"/);
  expect(!!src, 'home.js still builds the header logo from ART + a filename');
  expect(!!src && src[1] === 'brand-logo.png',
    `home.js header logo is ${src && src[1]}, expected brand-logo.png`);
  expect(fs.existsSync(path.join(UI, 'Images', 'brand-logo.png')),
    'brand-logo.png is bundled for Swift');
  expect(fs.existsSync(path.join(WEB, 'assets', 'images', 'brand-logo.png')),
    'brand-logo.png is bundled for the browser');
}

// ── 2. …clipped to a squircle, at the login hero's proportion ───────────────────
//
// A circle crops the wordmark off the bottom of the collage. And the radius has to be a RATIO:
// logoSize scales 41 -> 92, so a constant reads as a circle at one end and a square at the other.
{
  const logo = PARTS.slice(PARTS.indexOf('struct HomeLogo: View {'),
                           PARTS.indexOf('struct HomeHeader: View {'));
  expect(/RoundedRectangle\(cornerRadius:/.test(logo), 'HomeLogo clips to a RoundedRectangle');
  expect(!/Circle\(\)/.test(code(logo)), 'HomeLogo no longer clips or strokes a Circle');
  expect(/HomeLayout\.logoRadiusRatio/.test(logo), 'and its radius is the shared ratio');

  const num = (src, name) => {
    const m = src.match(new RegExp(name + '(?::\\s*CGFloat)?\\s*[:=]\\s*([0-9.]+)'));
    return m ? Number(m[1]) : NaN;
  };
  const swiftLoginR = num(LMET, 'static let logoRadius');
  const swiftLoginS = num(LMET, 'static let logoSize');
  const jsLoginR = num(LOGIN_JS, 'logoRadius');
  const jsLoginS = num(LOGIN_JS, 'logoSize');
  expect(swiftLoginR === 30 && swiftLoginS === 124,
    `LoginLayout logo is ${swiftLoginR}/${swiftLoginS}, expected 30/124`);
  expect(jsLoginR === swiftLoginR && jsLoginS === swiftLoginS,
    'the browser login hero agrees with the Swift one');

  // Swift takes the ratio BY REFERENCE, so it cannot drift from the hero at all.
  expect(/static let logoRadiusRatio: CGFloat = LoginLayout\.logoRadius \/ LoginLayout\.logoSize/
    .test(HMET), 'HomeLayout.logoRadiusRatio is derived from LoginLayout, not re-typed');

  // The browser cannot: login.js is a separate IIFE with no load-order guarantee here, so it
  // restates the fraction — which is exactly why this assertion exists.
  const jsRatio = HOME_JS.match(/var LOGO_RADIUS_RATIO = (\d+) \/ (\d+);/);
  expect(!!jsRatio, 'home.js declares LOGO_RADIUS_RATIO as a fraction');
  expect(!!jsRatio && Number(jsRatio[1]) === swiftLoginR && Number(jsRatio[2]) === swiftLoginS,
    'home.js LOGO_RADIUS_RATIO is the login hero fraction, unrounded');

  // …and the fraction actually reaches the element.
  expect(/logoRadius: Math\.round\(logoSize \* LOGO_RADIUS_RATIO\)/.test(HOME_JS),
    'metricsFor computes logoRadius from it');
  expect(/setProperty\('--h-logo-r'/.test(HOME_JS), "and publishes it as --h-logo-r");
  expect(/\.home-logo\s*\{[^}]*border-radius:\s*var\(--h-logo-r\)/.test(APP_CSS),
    '.home-logo reads --h-logo-r rather than a 50% circle');
  expect(!/\.home-logo\s*\{[^}]*border-radius:\s*50%/.test(APP_CSS),
    '.home-logo is not a circle any more');
}

// ── 3. The magnifier is gone — and its counterweight is not ─────────────────────
{
  for (const [name, src] of Object.entries(CODE)) {
    expect(!/\u{1F50D}/u.test(src), `${name} still contains the magnifier emoji`);
    expect(!/HomeSearchButton/.test(src), `${name} still references HomeSearchButton`);
    expect(!/onSearch/.test(src), `${name} still references onSearch`);
    expect(!/searchFill|searchSize|searchEmojiSize/.test(src),
      `${name} still references a search constant`);
    expect(!/home-search/.test(src), `${name} still references .home-search`);
  }
  expect(!/--home-search-fill/.test(THEME_CSS), 'theme.css still defines --home-search-fill');
  expect(!/'search'/.test(CODE['home.js']), "home.js still emits the 'search' action");

  // The counterweight. Without it the logo is no longer at screen centre.
  const header = PARTS.slice(PARTS.indexOf('struct HomeHeader: View {'),
                             PARTS.indexOf('// MARK: - Quote strip'));
  expect(/Color\.clear\.frame\(width: HomeLayout\.avatarSize, height: HomeLayout\.avatarSize\)/
    .test(header), 'the Swift header balances the avatar with an equal empty slot');
  expect(/HomeLogo\(size: metrics\.logoSize\)\s*\n\s*\.frame\(maxWidth: \.infinity\)/.test(header),
    'and the logo still expands between them');

  expect(/el\('div', 'home-header-balance'\)/.test(HOME_JS),
    'the browser header appends the same counterweight');
  const balance = APP_CSS.match(/\.home-header-balance\s*\{([^}]*)\}/);
  expect(!!balance, '.home-header-balance is styled');
  const avatarPt = (HMET.match(/static let avatarSize: CGFloat = ([0-9.]+)/) || [])[1];
  const avatarPx = (APP_CSS.match(/\.home-avatar\s*\{[^}]*width:\s*(\d+)px/) || [])[1];
  expect(avatarPt !== undefined && avatarPx === avatarPt,
    `the avatar is ${avatarPt}pt in Swift and ${avatarPx}px in CSS`);
  expect(!!balance && new RegExp('width:\\s*' + avatarPx + 'px').test(balance[1]),
    'and the counterweight is exactly that wide');
  expect(!!balance && /flex:\s*none/.test(balance[1]),
    'and does not flex, or it would eat the logo’s space');
}

// ── 4. Donate is gone, everywhere ───────────────────────────────────────────────
{
  for (const [name, src] of Object.entries(CODE)) {
    expect(!/[Dd]onate|DONATE/.test(src), `${name} still references Donate`);
    expect(!/sponsor/i.test(src), `${name} still references the sponsor skin/palette`);
  }
  expect(!/--home-sponsor/.test(THEME_CSS), 'theme.css still defines --home-sponsor');
  expect(!/HomePalette\.sponsor|static let sponsor/.test(HMET),
    'HomeMetrics still declares HomePalette.sponsor');

  // Exactly one banner is built, in each language.
  const row = PARTS.slice(PARTS.indexOf('struct HomeBannerRow: View {'));
  const swiftBanners = (row.match(/HomeBanner\(emoji:/g) || []).length;
  expect(swiftBanners === 1, `HomeBannerRow builds ${swiftBanners} banners, expected 1`);
  const jsBanners = (HOME_JS.match(/banners\.appendChild\(buildBanner\(/g) || []).length;
  expect(jsBanners === 1, `home.js builds ${jsBanners} banners, expected 1`);
  expect(/Button\(action: onMembership\)/.test(row), 'and the survivor is Membership');
}

// ── 5. The band the grid is measured against did NOT shrink ─────────────────────
{
  const banner = HMET.slice(HMET.indexOf('var bannerHeight: CGFloat {'));
  expect(/naturalLineHeight\(HomeLayout\.bannerSubSize, \.semiBold\) \* 2/.test(banner),
    'bannerHeight still budgets TWO subtitle lines — one line resizes all six cards');
  expect(/bannerHeight/.test(HMET.slice(HMET.indexOf('var fixedBandsHeight: CGFloat {'),
                                        HMET.indexOf('func gridHeight('))),
    'and fixedBandsHeight still consumes it, which is why that matters');
}

// ── 6. No orphaned callbacks left on the screen's surface ───────────────────────
{
  const decls = (SCREEN.match(/^\s{4}var on[A-Z]\w*: \(\) -> Void$/gm) || []).length;
  const params = (SCREEN.match(/^\s+on[A-Z]\w*: @escaping \(\) -> Void = \{\}[,)]/gm) || []).length;
  const assigns = (SCREEN.match(/^\s+self\.on[A-Z]\w* = on[A-Z]\w*$/gm) || []).length;
  expect(decls === 8, `HomeScreen declares ${decls} callbacks, expected 8 (was 10)`);
  expect(params === decls, `${params} init parameters against ${decls} properties`);
  expect(assigns === decls, `${assigns} assignments against ${decls} properties`);
}

// ---- report ------------------------------------------------------------------
const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `HomeChrome: ${passed} header/banner invariants hold across both languages`
    : `HomeChrome: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
