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
 *   2. The open set is the same on both sides — asserted by mapping the Swift tab INDICES through
 *      the browser's own tab table, rather than trusting that 0 and 3 mean what they used to.
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
// Swift names tabs by index and the browser by id, so this maps one through the other rather than
// asserting two lists that only look alike.
{
  const swiftTabs = PHONE_CODE.match(/private static let openTabs: Set<Int> = \[([\d, ]+)\]/);
  expect(!!swiftTabs, 'PhoneApp declares openTabs');
  const idx = swiftTabs ? swiftTabs[1].split(',').map((n) => Number(n.trim())) : [];

  // The browser's tab table is the shared vocabulary.
  const tabIds = [...APP.matchAll(/\{ id: '(\w+)', ico: ICON\.\w+, lbl: '[^']+' \}/g)].map((m) => m[1]);
  expect(tabIds.length === 4, `the browser declares ${tabIds.length} tabs, expected 4`);

  const open = new Set(idx.map((i) => tabIds[i]));
  expect(open.has('home') && open.has('profile'),
    `Swift openTabs ${JSON.stringify(idx)} maps to ${JSON.stringify([...open])}, expected home+profile`);
  expect(open.size === 2, 'and to nothing else');

  const jsOpen = APP.match(/var OPEN_ROUTES = \{([^}]*)\}/);
  expect(!!jsOpen, 'app.js declares OPEN_ROUTES');
  const jsKeys = jsOpen ? jsOpen[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean) : [];
  // login and paywall are routes, not tabs: the gate must not wall the screens it routes TO.
  expect(jsKeys.includes('login') && jsKeys.includes('paywall'),
    'OPEN_ROUTES keeps the login gate and the paywall itself reachable');
  for (const id of open) {
    expect(jsKeys.includes(id), `OPEN_ROUTES is missing ${id}, which Swift keeps open`);
  }
  for (const id of jsKeys) {
    expect(['login', 'paywall'].includes(id) || open.has(id),
      `OPEN_ROUTES keeps ${id} open but Swift does not`);
  }
}

// ── 3. Every wired Home tile goes through the gate ──────────────────────────────
{
  const home = PHONE_CODE.slice(PHONE_CODE.indexOf('HomeScreen(userName: loginStore.displayName'));
  const wired = [...home.matchAll(/^\s+(on[A-Z]\w*): ?(gated )?/gm)]
    .reduce((acc, m) => { acc[m[1]] = !!m[2]; return acc; }, {});
  for (const name of ['onPuzzles', 'onAnalysis', 'onPlayCoach', 'onPairing']) {
    expect(wired[name] === true, `${name} is not wrapped in gated`);
  }
  // The two deliberate exemptions, and exactly those two.
  expect(wired.onAvatar === false, 'onAvatar stays open — Profile owns Sign out');
  expect(wired.onMembership === false, 'onMembership stays open — it IS the offer');
  const ungated = Object.keys(wired).filter((k) => !wired[k]);
  expect(ungated.length === 2,
    `${ungated.length} ungated Home callbacks (${ungated.join(', ')}), expected 2`);

  // Pushed routes are reachable ONLY from those tiles, which is what makes wrapping them enough.
  for (const flag of ['showAnalysis = true', 'showCoach = true', 'showPairing = true']) {
    const hits = (PHONE_CODE.match(new RegExp(flag.replace(/ /g, '\\s*'), 'g')) || []).length;
    expect(hits <= 2, `${flag} is set ${hits} times — a second entry point would bypass the gate`);
  }

  expect(/if \(locked\(\) && action !== 'avatar' && action !== 'membership'\) \{ goPaywall\(\); return; \}/
    .test(APP_CODE), 'app.js gates the Home tiles with the same two exemptions');
}

// ── 4. The tab bar and the content area both read the gated values ──────────────
{
  expect(/PhoneTabBar\(tab: gatedTab\)/.test(PHONE_CODE), 'the tab bar takes the gated binding');
  expect(!/PhoneTabBar\(tab: \$tab\)/.test(PHONE_CODE), 'and not the raw @State binding');
  expect(/switch visibleTab \{/.test(PHONE_CODE),
    'the content area switches on visibleTab, so a mid-session lapse cannot leave a gated tab up');
  expect(/private var visibleTab: Int \{ locked && !PhoneApp\.openTabs\.contains\(tab\) \? 0 : tab \}/
    .test(PHONE_CODE), 'and visibleTab falls back to Home');

  expect(/leaveCurrentPuzzle\(\);\s*\n\s*if \(locked\(\) && !isOpenRoute\(t\.id\)\) \{ goPaywall\(\); return; \}/
    .test(APP_CODE), 'the browser tab bar gates AFTER cancelling the solver');

  // The router backstop, and it has to run before the dispatch chain.
  const guardAt = APP_CODE.indexOf('if (locked() && !isOpenRoute(current)) {');
  const firstBranch = APP_CODE.indexOf("if (current === 'login') renderLogin();");
  expect(guardAt > 0, 'app.js render() has the backstop guard');
  expect(guardAt > 0 && firstBranch > guardAt, 'and it runs before the route dispatch');
  expect(/paywallReturn = 'home';/.test(APP_CODE),
    'the backstop returns to Home, not to the screen it just walled');
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
