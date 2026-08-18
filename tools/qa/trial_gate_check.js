#!/usr/bin/env node
/*
 * trial_gate_check.js — nothing is reachable without an entitlement, in either language.
 *
 *     node tools/qa/trial_gate_check.js
 *
 * Why this exists. The gate is one guard at one choke point per language — which is the right
 * shape, and also the reason it is easy to half-land: the guard lives in `PhoneView.swift` and
 * `app.js`, while the screens it protects live in twenty other files that say nothing about it. A
 * new route added to either router is unprotected by default and nothing else in the repo notices.
 *
 * And there was already exactly that hole here. Before this change `app.js` gated only the four
 * puzzle modes: Play vs Coach, the Analysis Board and the Swiss round ceiling had **no premium
 * reference at all** in the browser (`coach-select.js`, `analysis.js`, `pairing-create.js`), while
 * Swift gated all three. `replay_premium.js` asserts the JS *puzzle* gates and the *Swift*
 * coach/review gates separately, so the drift passed every suite — and the client, who tests on
 * Windows, saw an app with no locks on it.
 *
 * So the invariants here are deliberately about the ROUTER, not about any screen:
 *
 *   1. Both languages compute "locked" the same way, from the live store and not a cached flag.
 *   2. The open set is the same on both sides. This used to mean mapping Swift tab INDICES through
 *      the browser's tab table; with Home as the app root there are no indices, so it now means
 *      that neither language has a tab bar left and that Profile is the one ungated destination.
 *   3. Every wired Home tile goes through the gate, and the two deliberate exemptions (Sign out,
 *      and the offer itself) are exactly those two.
 *   4. The browser re-checks on every paint, because an entitlement can lapse between taps.
 *   5. The paywall is still dismissible, and the login gate still covers it.
 *
 * There is no Swift compiler on this checkout, so the Swift half is read as text — the same
 * stand-in `swift_lint.js` and `nav_icons_check.js` are.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const PHONE = read('DemoApp', 'Sources', 'BiyaherongUI', 'PhoneView.swift');
const APP = read('web-demo', 'js', 'app.js');
const ENT = read('Sources', 'BiyaherongCoachCore', 'Entitlement.swift');

let passed = 0;
const failures = [];
const expect = (cond, what) => { cond ? passed++ : failures.push(what); };

/** Source with comments blanked, so prose describing the gate is never mistaken for the gate. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*(\/\/\/?|\*).*$/gm, ' ');
}
const PHONE_CODE = code(PHONE);
const APP_CODE = code(APP);

// ── 1. "Locked" means the same thing on both sides ──────────────────────────────
{
  expect(/private var locked: Bool \{ loginStore\.isSignedIn && !premium\.isPremium \}/
    .test(PHONE_CODE), 'PhoneApp.locked is signed-in-and-not-premium');
  expect(/function locked\(\) \{\s*return BiyaLogin\.shared\(\)\.isSignedIn\(\) && !BiyaPremium\.shared\(\)\.isPremium\(\);\s*\}/
    .test(APP_CODE), 'app.js locked() is the same predicate');

  // Read from the live store, never a cached boolean — the failure the RN app shipped.
  expect(!/var\s+(isLocked|cachedLocked)\b/.test(APP_CODE),
    'app.js does not cache the locked state in a variable');
  expect(!/@State private var locked/.test(PHONE_CODE),
    'PhoneApp.locked is computed, not @State');

  // `.free` still resolves fail-closed in Core; the gate is a shell rule layered on that.
  expect(/guard let expiry = s\.expiresAtMs else \{ return \.free \}/.test(ENT),
    'Entitlement.resolve still fails closed with no subscription');
}

// ── 2. The open set is the same on both sides ───────────────────────────────────
//
// This used to map Swift tab INDICES through the browser's `TABS` table, because the two languages
// named the open set differently — `[0, 3]` against `{ home, profile }`. With Home as the app root
// there are no indices: every destination is a pushed route raised by a Home tile, so the open set
// is "Home, which is underneath everything" plus "Profile, which owns Sign out".
{
  // Home is not a route in Swift at all — it is what the ZStack draws when nothing covers it.
  expect(/home\(basis: basis\)/.test(PHONE_CODE),
    'Home is the root the pushed routes are raised over');
  expect(!/PhoneTabBar|var tab = 0|openTabs|visibleTab|gatedTab/.test(PHONE_CODE),
    'no tab bar, and none of the tab-index machinery that came with it, survives in Swift');
  expect(!/var TABS =|renderTabbar/.test(APP_CODE),
    'nor in the browser');

  // Profile is the ONE destination raised without `gated`, and it is raised from the avatar.
  const profile = PHONE_CODE.slice(PHONE_CODE.indexOf('onAvatar:'),
                                   PHONE_CODE.indexOf('onPuzzles:'));
  expect(/showProfile = true/.test(profile), 'the Home avatar raises Profile');
  expect(!/gated/.test(profile), 'and does NOT gate it — Profile owns Sign out');

  const jsOpen = APP.match(/var OPEN_ROUTES = \{([^}]*)\}/);
  expect(!!jsOpen, 'app.js declares OPEN_ROUTES');
  const jsKeys = jsOpen ? jsOpen[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean) : [];
  expect(jsKeys.sort().join(',') === 'home,login,paywall,profile',
    `OPEN_ROUTES is ${jsKeys.join(',')}, expected exactly home + profile + the login gate and the `
    + 'paywall it routes to');
}

// ── 3. Every wired Home tile goes through the gate ──────────────────────────────
{
  const home = PHONE_CODE.slice(PHONE_CODE.indexOf('HomeScreen(userName: loginStore.displayName'));
  const wired = [...home.matchAll(/^\s+(on[A-Z]\w*): ?(gated )?/gm)]
    .reduce((acc, m) => { acc[m[1]] = !!m[2]; return acc; }, {});
  for (const name of ['onPuzzles', 'onAnalysis', 'onPlayCoach', 'onPairing',
                      'onOpeningTrainer']) {
    expect(wired[name] === true, `${name} is not wrapped in gated`);
  }
  // The two deliberate exemptions, and exactly those two.
  expect(wired.onAvatar === false, 'onAvatar stays open — Profile owns Sign out');
  expect(wired.onMembership === false, 'onMembership stays open — it IS the offer');
  const ungated = Object.keys(wired).filter((k) => !wired[k]);
  expect(ungated.length === 2,
    `${ungated.length} ungated Home callbacks (${ungated.join(', ')}), expected 2`);

  // Pushed routes are reachable ONLY from those tiles, which is what makes wrapping them enough.
  for (const flag of ['showAnalysis = true', 'showCoach = true', 'showPairing = true',
                      'showOpenings = true']) {
    const hits = (PHONE_CODE.match(new RegExp(flag.replace(/ /g, '\\s*'), 'g')) || []).length;
    expect(hits <= 2, `${flag} is set ${hits} times — a second entry point would bypass the gate`);
  }

  expect(/if \(locked\(\) && action !== 'avatar' && action !== 'membership'\) \{ goPaywall\(\); return; \}/
    .test(APP_CODE), 'app.js gates the Home tiles with the same two exemptions');
}

// ── 4. Every destination is raised through the gate, and closes back to Home ────
{
  // Six flags, six Home tiles, and `gated` on every one but the avatar's.
  for (const flag of ['showPuzzles', 'showAnalysis', 'showCoach', 'showPairing', 'showOpenings']) {
    expect(new RegExp('@State private var ' + flag + ' = false').test(PHONE_CODE),
      `PhoneApp declares ${flag}`);
    const raises = (PHONE_CODE.match(new RegExp(flag + '\\s*=\\s*true', 'g')) || []).length;
    // One raise per flag — a second entry point would bypass `gated`. `showAnalysis` is the
    // one documented exception: spec 2.10's hand-off closes Play vs Coach and opens the
    // Analysis Board on the reviewed game, and Coach itself was gated on the way in.
    const allowed = flag === 'showAnalysis' ? 2 : 1;
    expect(raises === allowed,
      `${flag} is raised ${raises} times, expected ${allowed} — a second entry point bypasses the gate`);
    const lowers = (PHONE_CODE.match(new RegExp(flag + '\\s*=\\s*false', 'g')) || []).length;
    expect(lowers >= 1, `${flag} has no way back to Home`);
  }

  expect(/onChange\(of: coachStore\.pendingHandoff\)[\s\S]{0,400}showAnalysis = true/
    .test(PHONE_CODE),
    "showAnalysis's second raise is the coach hand-off, not a new door into the Board");

  // Profile is the sixth, and the deliberate exception: raised, and closed, but never gated.
  expect(/showProfile = true/.test(PHONE_CODE) && /showProfile = false/.test(PHONE_CODE),
    'Profile is raised from the avatar and closed by its own back button');

  // The browser's backstop is now the ONLY re-check, since there is no tab bar to intercept.
  const guardAt = APP_CODE.indexOf('if (locked() && !isOpenRoute(current)) {');
  const firstBranch = APP_CODE.indexOf("if (current === 'login') renderLogin();");
  expect(guardAt > 0, 'app.js render() has the backstop guard');
  expect(guardAt > 0 && firstBranch > guardAt, 'and it runs before the route dispatch');
  expect(/paywallReturn = 'home';/.test(APP_CODE),
    'the backstop returns to Home, not to the screen it just walled');

  // Every screen can be left. This is the client's actual requirement, and it is what replaced
  // the tab bar: `docs/home-screen.md` named "a way back from the six destinations" as the one
  // thing missing before Home could be the root.
  expect(/function renderProfile\(\)[\s\S]{0,400}screen-back nav-icon/.test(APP_CODE),
    'the browser Profile has a back button — it was the one screen in either language without one');
  expect(/PhoneHeader\(title: "Profile", onBack: onExit\)/.test(PHONE_CODE),
    'and so does the Swift one');
}

// ── 5. The paywall is a gate, not a trap ────────────────────────────────────────
{
  expect(/private func closePaywall\(\)/.test(PHONE_CODE), 'the Swift paywall can still be closed');
  expect(/function goPaywallBack\(\)/.test(APP_CODE), 'and the browser one can too');

  // Order in the ZStack is load-bearing: the login gate must stay the LAST sibling, or a locked
  // user on a fresh install would meet the paywall before signing in — and the paywall would be
  // drawn behind a screen that covers it.
  const paywallAt = PHONE_CODE.indexOf('if showPaywall {');
  const loginAt = PHONE_CODE.indexOf('if !loginStore.isSignedIn {');
  expect(paywallAt > 0 && loginAt > paywallAt,
    'the login gate is still declared after the paywall, so it covers it');
}

// ---- report ------------------------------------------------------------------
const result = {
  passed,
  failures,
  ok: failures.length === 0,
  summary: failures.length === 0
    ? `TrialGate: ${passed} entitlement-gate invariants hold across both languages`
    : `TrialGate: ${passed} hold, ${failures.length} BROKEN\n`
      + failures.map((f) => '  ✗ ' + f).join('\n'),
};

if (require.main === module) {
  console.log(result.summary);
  process.exit(result.ok ? 0 : 1);
}

module.exports = { selfTest: () => result };
