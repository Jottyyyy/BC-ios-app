#!/usr/bin/env node
/*
 * replay_premium.js — check the subscription's Swift against the JavaScript that has actually run.
 *
 *     node tools/qa/replay_premium.js
 *
 * `swift` is not on PATH on this checkout, so `Entitlement.swift`, `PremiumStore.swift`,
 * `PaywallMetrics.swift`, `PaywallScreen.swift` and `PaywallMetricsCheck.swift` were written blind.
 * This is the mitigation every phase of this rebuild has used: pull the concrete values out of the
 * Swift SOURCE TEXT and compare them with the JS twin, which is proven by `BiyaPremium.selfTest()`.
 *
 * It does not prove the Swift compiles. It proves the numbers, the colours, the caps and the copy
 * are the right ones — the half a compiler would not have caught anyway.
 *
 * It also guards five things that are not values, and that decide whether someone has paid:
 *
 *   • the STATE MACHINE's branches — fail-closed on a snapshot with no expiry, no grace after a
 *     deliberate cancel, and the monotonic clock floor. Each is one line in `resolve`, and each is
 *     the difference between a paywall and a suggestion.
 *   • the OFFLINE guarantee — StoreKit is allowed (it is on-device by definition), `URLSession`
 *     and friends are not, and exactly TWO URLs are permitted: Apple's standard EULA and the
 *     privacy policy, both of which App Review requires on an auto-renewing subscription. A third
 *     URL fails.
 *   • the PHP-PINNED TABLE — `DailyLimits` must not grow the invented `review` mode, in either
 *     language, or it stops matching the backend its 168 golden assertions verified it against.
 *   • the SCRIPT ORDER and the stylesheet link — `css/coach.css` shipped 507 lines that
 *     `index.html` never linked, and nothing noticed.
 *   • the CSS VARIABLES — every `--pw-*` the JS sets must be read by the CSS and vice versa.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');
const CORE = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want,
  `${what}: Swift says ${JSON.stringify(want)}, JS gives ${JSON.stringify(got)}`);
const near = (got, want, what) => expect(
  typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-9,
  `${what}: Swift says ${want}, JS gives ${got}`);

function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

function blockOf(src, name) {
  // `final class` too — `PremiumStore` is one, and its storage keys live there.
  const at = src.search(
    new RegExp('(?:public )?(?:final class|class|enum|struct) ' + name + '\\b[^\\n{]*\\{'));
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

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

let THEME = '';

function themeNumber(name) {
  const m = new RegExp(`static let ${name}\\s*:\\s*CGFloat\\s*=\\s*(-?[\\d.]+)`).exec(code(THEME));
  return m ? Number(m[1]) : null;
}

function colorKey(hex, alpha) {
  const h = hex.toUpperCase();
  return alpha === undefined ? '#' + h : 'rgba' + h + '@' + Number(alpha);
}

function themeColor(name) {
  const m = new RegExp(`static let ${name}\\s*=\\s*c\\(0x([0-9A-Fa-f]{6})(?:,\\s*([\\d.]+))?\\)`)
    .exec(code(THEME));
  return m ? colorKey(m[1], m[2]) : null;
}

/** `static let x: CGFloat = 12.5`, `= 86_400_000`, or `= Theme.radiusButton`. */
function swNum(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*([^\\n]+)`).exec(code(block));
  if (!m) return null;
  const rhs = m[1].trim();
  const lit = /^(-?[\d_.]+)/.exec(rhs);
  if (lit) return Number(lit[1].replace(/_/g, ''));
  const themed = /^Theme\.(\w+)/.exec(rhs);
  return themed ? themeNumber(themed[1]) : null;
}

function swColor(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const direct = new RegExp(`static let ${name}\\s*=\\s*Theme\\.c\\(0x([0-9A-Fa-f]{6})(?:,\\s*([\\d.]+))?\\)`)
    .exec(code(block));
  if (direct) return colorKey(direct[1], direct[2]);
  const alias = new RegExp(`static let ${name}\\s*=\\s*Theme\\.(\\w+)\\s*$`, 'm').exec(code(block));
  return alias ? themeColor(alias[1]) : null;
}

function swStr(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  // `(?!"")` so the opening of a `"""` literal is not read as an empty string — `swText` then
  // falls through to `swMultiline`, which is what actually resolves it.
  const m = new RegExp(`static let ${name}\\s*=\\s*"(?!"")((?:[^"\\\\\\n]|\\\\.)*)"`)
    .exec(code(block));
  if (!m) return null;
  return m[1].replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** A Swift `"""` literal, resolved the way the compiler resolves one. */
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

/** A Swift string that may be either form. */
function swText(src, ns, name) {
  const single = swStr(src, ns, name);
  return single === null ? swMultiline(src, ns, name) : single;
}

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

  const P = require(path.join(JS, 'premium.js'));
  const L = require(path.join(JS, 'daily-limits.js'));
  THEME = read(UI, 'Theme.swift');
  const ent = read(CORE, 'Entitlement.swift');
  const limits = read(CORE, 'DailyLimits.swift');
  const tourney = read(CORE, 'Tournament.swift');
  const metrics = read(UI, 'PaywallMetrics.swift');
  const store = read(UI, 'PremiumStore.swift');
  const screen = read(UI, 'PaywallScreen.swift');
  const check = read(UI, 'PaywallMetricsCheck.swift');
  const keychain = read(UI, 'KeychainStorage.swift');
  if (!ent || !metrics || !store || !screen) return finish();

  // 1. Both JS suites must be green before their values are used as a yardstick for anything.
  const selfP = P.selfTest();
  const selfL = L.selfTest();
  expect(selfP.ok, 'BiyaPremium.selfTest is green: ' + selfP.summary.split('\n')[0]);
  expect(selfL.ok, 'BiyaDailyLimits.selfTest is green: ' + selfL.summary.split('\n')[0]);

  // 2. The entitlement constants.
  ['graceDays', 'trialDays', 'reviewsPerDay', 'freeCoachLevels', 'msPerDay'].forEach((k) => {
    near(P.CONST[k], swNum(ent, 'Entitlement', k), 'Entitlement.' + k);
  });
  near(P.CONST.freeMaxRounds, swNum(tourney, 'TournamentEngine', 'freeMaxRounds'),
    'the free round ceiling is the ported TournamentEngine constant');
  near(P.CONST.premiumMaxRounds, swNum(tourney, 'TournamentEngine', 'premiumMaxRounds'),
    'and so is the premium one');
  eq(P.CONST.graceDays, 7, 'grace is 7 days in both languages, not the spec\'s 14');

  // 3. The PHP-pinned caps, and that neither language has smuggled a mode into them.
  Object.keys(L.CAPS).forEach((k) => {
    const m = new RegExp(`"${k}":\\s*(\\d+)`).exec(code(blockOf(limits, 'DailyLimits') || ''));
    near(L.CAPS[k], m ? Number(m[1]) : null, 'DailyLimits.caps.' + k);
  });
  eq(Object.keys(L.CAPS).length, 3, 'the JS table has exactly three named modes');
  expect(!/"review"/.test(code(limits)),
    'the invented review cap is NOT in DailyLimits.swift — that table is pinned to the PHP oracle');
  expect(!Object.prototype.hasOwnProperty.call(L.CAPS, 'review'),
    'and not in its JS twin either');
  eq(P.maxUses('review'), 3, 'the review cap comes from the entitlement layer');
  eq(P.maxUses('regular'), 5, 'the ported caps still come from DailyLimits');
  eq(P.maxUses('rush_5'), 1, 'each Turbo mode carries its own allowance');

  // 4. THE STATE MACHINE. Each of these is one line in `resolve`, and each is the difference
  //    between a paywall and a suggestion.
  const resolveBody = code(funcBody(ent, 'resolve') || '');
  expect(/guard let expiry = s\.expiresAtMs else \{ return \.free \}/.test(resolveBody),
    'Swift resolve FAILS CLOSED on a snapshot claiming a subscription with no expiry');
  expect(/guard s\.willAutoRenew else \{ return \.free \}/.test(resolveBody),
    'Swift gives no grace after a deliberate cancel — the expiry was expected');
  expect(/expiry \+ graceDays \* msPerDay/.test(resolveBody),
    'Swift runs the grace window from the cached EXPIRY, not from the last refresh');
  expect(/trustedNow\(deviceNow: now, floor: s\.trustedFloorMs\)/.test(resolveBody),
    'Swift resolves against the floored clock, not the raw device clock');
  expect(/max\(deviceNow, floor\)/.test(code(funcBody(ent, 'trustedNow') || '')),
    'the clock floor is a max, so a back-dated clock cannot help');
  // The renewal-day subscriber, replayed through the JS. This is why grace exists.
  const DAY = P.CONST.msPerDay, T = 1786000000000;
  eq(P.resolve(Object.assign(P.emptySnapshot(), {
    isSubscribed: true, willAutoRenew: true, expiresAtMs: T - 60000
  }), T).kind, 'grace', 'a subscriber one minute past renewal, offline, keeps access');
  eq(P.resolve(Object.assign(P.emptySnapshot(), {
    isSubscribed: true, willAutoRenew: false, expiresAtMs: T - 60000
  }), T).kind, 'free', 'a cancelled one does not');
  eq(P.resolve(Object.assign(P.emptySnapshot(), { isSubscribed: true }), T).kind, 'free',
    'and a forged snapshot with no expiry buys nothing');

  // The store's own guards.
  expect(/expiresAtMs` is deliberately KEPT|expiresAtMs. is deliberately KEPT/.test(store),
    'PremiumStore documents why it keeps the expiry when an entitlement disappears');
  expect(/s\.isSubscribed = false/.test(code(store))
    && !/s\.expiresAtMs = nil/.test(code(store)),
  'PremiumStore never clears expiresAtMs — that is what the grace window runs from');
  expect(/case \.verified\(let transaction\)/.test(code(store)),
    'PremiumStore treats .unverified as no entitlement');
  expect(/transaction\.revocationDate == nil/.test(code(store)),
    'PremiumStore skips revoked (refunded) transactions');
  expect(/max\(s\.trustedFloorMs, Int\(signed\.timeIntervalSince1970/.test(code(store)),
    'the clock floor only ever moves forward');
  eq(P.SESSION.snapshotKey, swStr(store, 'PremiumStore', 'snapshotKey'), 'the snapshot key');
  eq(P.SESSION.usageKey, swStr(store, 'PremiumStore', 'usageKey'), 'the usage key');

  // 4b. The two tiers, and the local StoreKit configuration that has to name the same products.
  //
  //     A product ID that does not match is not a compile error and not a crash: `Product.products`
  //     simply returns fewer products, the row shows "Loading…" forever, and — because the app is
  //     fully gated — there is nothing else on screen to suggest what went wrong. Worth a gate.
  const planIDs = [...code(store).matchAll(/case \.(monthly|yearly):\s*return "([^"]+)"/g)]
    .map((m) => ({ plan: m[1], id: m[2] }));
  eq(planIDs.length, 2, 'PremiumStore.Plan declares exactly two tiers');
  planIDs.forEach(({ plan, id }) => {
    expect(id.endsWith('.plus.' + plan),
      `${plan}'s product ID ends in .plus.${plan} — the suffix the App Store Connect record uses`);
    expect(id.startsWith('com.prince24pogi.biyaherongchessapp.'),
      'and is namespaced by PRODUCT_BUNDLE_IDENTIFIER; App Store Connect scopes products per app '
      + 'record, so changing the bundle ID orphans every one of them');
  });
  expect(/guard Plan\.matching\(transaction\.productID\) != nil/.test(code(store)),
    'ANY tier in the group entitles — filtering to one product ID would lock out every yearly '
    + 'subscriber the moment that tier existed');
  expect(!/static let subscriptionGroupID/.test(code(store)),
    'the subscription group ID is NOT a hand-typed constant. It was "biyaherong.plus"; App Store '
    + 'Connect assigns a numeric one, so the status lookup never matched — and being a `try?` it '
    + 'failed silently and demoted willAutoRenew to a guess');
  expect(/products\.values\.first\?\.subscription\?\.subscriptionGroupID/.test(code(store)),
    'it comes off a loaded product instead');

  const kit = JSON.parse(fs.readFileSync(path.join(ROOT, 'ios', 'Biyaherong.storekit'), 'utf8'));
  const groups = kit.subscriptionGroups || [];
  eq(groups.length, 1, 'one subscription group locally, so StoreKit treats the tiers as one ladder');
  const kitSubs = groups[0].subscriptions || [];
  eq(kitSubs.length, 2, 'and both tiers are configured for the Debug scheme');
  planIDs.forEach(({ plan, id }) => {
    const sub = kitSubs.find((s) => s.productID === id);
    expect(!!sub, `Biyaherong.storekit configures ${plan} as ${id}`);
    if (!sub) return;
    eq(sub.recurringSubscriptionPeriod, plan === 'monthly' ? 'P1M' : 'P1Y',
      `${plan} recurs over the period its name promises`);
    eq(sub.introductoryOffer && sub.introductoryOffer.paymentMode, 'free',
      `${plan} carries the free trial — eligibility is per GROUP, so a tier without one would be `
      + 'a row that silently cannot offer what the CTA above it promises');
    eq(sub.introductoryOffer && sub.introductoryOffer.subscriptionPeriod, 'P1W',
      `${plan}'s trial is one week, matching Entitlement.trialDays`);
  });
  expect(kitSubs.every((s) => s.subscriptionGroupID === groups[0].id),
    'every tier names its own group');

  // 5. The paywall's numbers and colours.
  Object.keys(P.LAYOUT).forEach((k) => {
    near(P.LAYOUT[k], swNum(metrics, 'PaywallLayout', k), 'PaywallLayout.' + k);
  });
  Object.keys(P.TYPE).forEach((k) => {
    near(P.TYPE[k], swNum(metrics, 'PaywallType', k), 'PaywallType.' + k);
  });
  Object.keys(P.PALETTE).forEach((k) => {
    eq(jsColorKey(P.PALETTE[k]), swColor(metrics, 'PaywallPalette', k), 'PaywallPalette.' + k);
  });
  near(P.TIMING.presentSeconds, swNum(metrics, 'PaywallTiming', 'presentSeconds'),
    'PaywallTiming.presentSeconds');
  eq(P.LAYOUT.pressed < 1 && P.LAYOUT.pressed > 0, true, 'the pressed opacity is a fraction');

  // 6. Copy, including the disclosure App Review requires verbatim.
  Object.keys(P.STRINGS).forEach((k) => {
    eq(P.STRINGS[k], swText(metrics, 'PaywallStrings', k), 'PaywallStrings.' + k);
  });
  expect(P.STRINGS.disclosure.indexOf('automatically renews') >= 0,
    'the disclosure names auto-renewal');
  expect(P.STRINGS.disclosure.indexOf('24 hours') >= 0, 'and the 24-hour window');

  // 6b. THE TRIAL, SAID OUT LOUD.
  //
  //     Apple's rule for an introductory offer is that the purchase flow "clearly indicate how long
  //     the free trial lasts and the price billed once the free trial is over". Before this it was
  //     said in exactly two strings, with the 7 typed inside the sentence, and every OTHER upsell
  //     surface — the lock card behind each daily cap, the Game Review cap, the Tutorial Videos
  //     paywall — said "Premium Feature" and "Subscribe Now" and nothing at all about money.
  {
    // The length is a parameter, in both languages. A literal cannot follow App Store Connect, and
    // copy that outlives the product it describes is a 3.1.2 misrepresentation rather than a typo.
    ['trialCta', 'trialNote', 'trialNoteYearly', 'disclosureTrial'].forEach((k) => {
      expect(P.STRINGS[k].indexOf('{days}') >= 0, `${k} takes the trial length as a parameter`);
    });
    // `disclosureTrial` excluded: its "24 hours" is Apple's cancellation deadline, a fixed rule of
    // the App Store rather than anything App Store Connect can change.
    ['trialCta', 'trialNote', 'trialNoteYearly'].forEach((k) => {
      expect(!/\d/.test(P.STRINGS[k]), `${k} contains no digit of its own`);
    });

    // And it is FILLED from the product, not from the constant. `Entitlement.trialDays` remains the
    // fallback and the value before the store answers; `introductoryOffer` is the authority.
    expect(/@Published private\(set\) var trialDays: Int = Entitlement\.trialDays/.test(code(store)),
      'PremiumStore.trialDays defaults to the constant');
    expect(/offer\.paymentMode == \.freeTrial/.test(code(store)),
      'and is read off a FREE-trial introductory offer, not any offer');
    expect(/trialDays = Self\.trialDays\(among: byPlan\.values\) \?\? Entitlement\.trialDays/
      .test(code(store)), 'load() takes it from the product and falls back to the constant');
    expect(/case \.week: perUnit = 7/.test(code(store)),
      'a P1W offer resolves to 7 days — the period the .storekit file declares');

    // ONE implementation of the sentence. Four copies of this logic would be four chances to drift.
    expect(/static func offerNote\(trialEligible: Bool, yearly: Bool, days: Int, price: String\?\)/
      .test(code(metrics)), 'the Swift composes the offer sentence in one place');
    expect(/price \?\? loading/.test(code(metrics)),
      'and a price that has not resolved says "Loading…" rather than leaving a gap — `?? ""` used '
      + 'to render "7 days free, then  per month." on the screen App Review reads most carefully');
    expect(/private var priceNote: String \{ store\.offerNote \}/.test(code(screen)),
      "the paywall's own note goes through it too, so the CTA cannot drift from the lock cards");

    // Every upsell surface carries it. This is the client's actual request.
    expect(/var offerNote: String\?/.test(code(screen)),
      'PremiumLockCard takes the offer sentence');
    expect(/if let offerNote \{[\s\S]{0,200}Text\(offerNote\)/.test(code(screen)),
      'and draws it under the button');
    [['PuzzleHubScreen.swift', /offerNote: premium\.offerNote/],
     ['CoachScreens.swift', /offerNote: offerNote/],
     ['AnalysisReviewModal.swift', /Text\(offerNote\)/],
     ['VideoScreens.swift', /VideoPaywall\(onSubscribe: onPaywall, offerNote: premium\.offerNote\)/],
     ['PhoneView.swift', /offerNote: premium\.offerNote/]].forEach(([file, re]) => {
      expect(re.test(code(read(UI, file))), `${file} passes the offer sentence to its upsell`);
    });
    const premiumJs = code(fs.readFileSync(path.join(JS, 'premium.js'), 'utf8'));
    const appCss = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
    expect(/pw-lock-offer/.test(premiumJs) && /\.pw-lock-offer/.test(appCss),
      'and the browser lock card draws it, with a rule in app.css to draw it with');

    // The disclosure card names the offer, and only when this Apple Account can have it.
    expect(/if store\.trialEligible \{[\s\S]{0,300}PaywallStrings\.disclosureTrial/.test(code(screen)),
      'the legal card names the introductory offer, and only when it is actually on offer');
    expect(/disclosureTrial/.test(premiumJs), 'and the browser card does too');

    // When the charge lands. The client asked for this in as many words:
    // "tsaka palang sila madedeckan kapag naka 7 days na sila para alam nila."
    expect(P.STRINGS.trialChargeNote.indexOf('{date}') >= 0,
      'the in-trial note names the DATE billing starts');
    expect(P.STRINGS.trialEndsRow !== P.STRINGS.renewalRow,
      "a trial's end is not called a renewal — that date is the FIRST CHARGE");
    expect(/if store\.isInTrial \{ return PaywallStrings\.trialEndsRow \}/.test(code(screen)),
      'the Swift row has three states, not two');
    expect(/store\.isInTrial\(\) \? STRINGS\.trialEndsRow/.test(premiumJs),
      'and so does the browser one');
    expect(/if store\.isInTrial \{[\s\S]{0,240}PaywallStrings\.trialChargeNote/.test(code(screen)),
      'and the note is drawn beside it');
  }
  // The glyph table, so no renderer in either language carries a bare emoji.
  Object.keys(P.GLYPH).forEach((k) => {
    eq(P.GLYPH[k], swStr(screen, 'PaywallGlyph', k), 'PaywallGlyph.' + k);
  });
  // The demo-only strings must NOT have crept into the shared table.
  Object.keys(P.DEMO).forEach((k) => {
    expect(swText(metrics, 'PaywallStrings', k) === null,
      `PaywallStrings has no ${k} — it is web-demo chrome, not shipped copy`);
  });

  // 7. The benefit rows and the two links, element by element.
  const benefits = [...code(blockOf(metrics, 'PaywallBenefits') || '')
    .matchAll(/PaywallBenefit\(emoji: "([^"]*)", text: "([^"]*)"\)/g)]
    .map((m) => ({ emoji: m[1], text: m[2] }));
  eq(benefits.length, P.BENEFITS.length, 'the benefit list is the same length');
  P.BENEFITS.forEach((b, i) => {
    eq(b.emoji, benefits[i] && benefits[i].emoji, `benefit[${i}].emoji`);
    eq(b.text, benefits[i] && benefits[i].text, `benefit[${i}].text`);
  });
  const links = [...code(blockOf(metrics, 'PaywallLinks') || '')
    .matchAll(/PaywallLink\(label: "([^"]*)",\s*url: "([^"]*)"\)/g)]
    .map((m) => ({ label: m[1], url: m[2] }));
  eq(links.length, 2, 'exactly two links in the Swift');
  eq(P.LINKS.length, 2, 'and two in the JS');
  P.LINKS.forEach((l, i) => {
    eq(l.label, links[i] && links[i].label, `link[${i}].label`);
    eq(l.url, links[i] && links[i].url, `link[${i}].url`);
  });
  expect(P.LINKS[0].url.indexOf('apple.com/legal') >= 0, "the first is Apple's standard EULA");

  // 8. THE OFFLINE GUARANTEE, with exactly two deliberate exceptions.
  //    StoreKit is allowed — it reads the device's own transaction cache. A network client is not,
  //    and a third URL is not.
  const allowedURLs = new Set(P.LINKS.map((l) => l.url));
  const sources = {
    'Entitlement.swift': ent, 'PremiumStore.swift': store, 'PaywallMetrics.swift': metrics,
    'PaywallScreen.swift': screen, 'PaywallMetricsCheck.swift': check,
    'KeychainStorage.swift': keychain,
    'web-demo/js/premium.js': fs.readFileSync(path.join(JS, 'premium.js'), 'utf8'),
    'web-demo/js/daily-limits.js': fs.readFileSync(path.join(JS, 'daily-limits.js'), 'utf8')
  };
  Object.keys(sources).forEach((name) => {
    const src = code(sources[name]);
    ['URLSession', 'URLRequest', 'XMLHttpRequest', 'WebSocket'].forEach((tok) => {
      expect(src.indexOf(tok) < 0, `${name} contains no ${tok} — the entitlement is on-device`);
    });
    const urls = (src.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => !allowedURLs.has(u));
    expect(urls.length === 0,
      `${name} contains no URL beyond the two App Review requires (${urls.join(', ')})`);
  });
  // Core stays engine-agnostic: the parity contract forbids a framework import there.
  expect(code(ent).indexOf('import StoreKit') < 0,
    'Entitlement.swift does NOT import StoreKit — the Core is Foundation-only');
  expect(code(store).indexOf('import StoreKit') >= 0,
    'PremiumStore.swift is the one file that does');
  const uiFiles = fs.readdirSync(UI).filter((f) => f.endsWith('.swift'));
  const importers = uiFiles.filter((f) => /^import StoreKit$/m.test(fs.readFileSync(path.join(UI, f), 'utf8')));
  eq(importers.join(','), 'PremiumStore.swift', 'exactly one file in the UI imports StoreKit');

  // 9. The wiring the browser needs.
  const html = fs.readFileSync(path.join(ROOT, 'web-demo', 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  ['daily-limits.js', 'premium.js'].forEach((f) => {
    expect(order.includes(f), `index.html loads js/${f}`);
    expect(order.indexOf(f) >= 0 && order.indexOf(f) < order.indexOf('app.js'),
      `js/${f} loads BEFORE js/app.js, which reads it`);
  });
  expect(order.indexOf('daily-limits.js') < order.indexOf('premium.js'),
    'daily-limits.js loads before premium.js, which reads it at load time');
  const css = fs.readFileSync(path.join(ROOT, 'web-demo', 'css', 'app.css'), 'utf8');
  expect(/\/\* ---- Paywall/.test(css), 'app.css has a Paywall section');
  ['.pw-view', '.pw-cta', '.pw-lock-card', '.pw-warn', '.pw-fail'].forEach((sel) => {
    expect(css.indexOf('\n' + sel) >= 0, 'app.css styles ' + sel);
  });
  const appJs = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  expect(/current === 'paywall'\) renderPaywall\(\)/.test(appJs),
    "app.js's router has a 'paywall' branch — without one the trailing else silently shows the "
    + 'old sample-puzzle tab');
  expect(/action === 'membership'\) goPaywall\(\)/.test(appJs),
    "the Home banner's 'membership' action finally goes somewhere");
  expect(/BiyaPremium\.selfTest\(\)/.test(appJs) && /BiyaDailyLimits\.selfTest\(\)/.test(appJs),
    'index.html?selftest runs both new suites');
  // Every gate, present in the shell.
  expect(/BiyaPremium\.MODE\.regular/.test(appJs), 'the rated-puzzle allowance is gated');
  expect(/BiyaPremium\.MODE\.streak/.test(appJs), 'the streak allowance is gated');
  expect(/BiyaPremium\.MODE\.rush\(mode\)/.test(appJs), 'Turbo is gated PER MODE');
  expect(/isThematicLocked/.test(appJs), 'Thematic is gated');
  // …and in the Swift.
  const phone = read(UI, 'PhoneView.swift');
  const hub = read(UI, 'PuzzleHubScreen.swift');
  const coach = read(UI, 'CoachScreens.swift');
  expect(/Entitlement\.Mode\.rush\(mode\)/.test(code(hub)), 'the Swift gates Turbo per mode');
  expect(/Entitlement\.Mode\.regular/.test(code(hub)), 'and the rated allowance');
  expect(/Entitlement\.Mode\.streak/.test(code(hub)), 'and the streak allowance');
  expect(/premium\.isThematicLocked/.test(code(hub)), 'and Thematic');
  expect(/isCoachLocked\(level: coach\.id\)/.test(code(coach)), 'and coaches 3-5');
  expect(/onMembership: \{ openPaywall\(\) \}/.test(code(phone)),
    'the Swift Home banner opens the paywall');
  // BOTH review entry points spend the same allowance — capping one is a free bypass of the other.
  expect(/reviewGate: \{ premium\.consumeReview\(\) \}/.test(code(phone)),
    'the Analysis Board review is gated');
  expect(/store\.reviewGate = \{ premium\.consumeReview\(\) \}/.test(code(coach)),
    'and so is Play vs Coach\'s, through the same allowance');
  expect(/func consumeReview\(\)/.test(code(store)),
    'and both go through one implementation, not two');

  // 10. The `--pw-*` custom properties, both directions.
  const setVars = new Set();
  fs.readdirSync(JS).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    // A trailing hyphen is a composed PREFIX (`'--pw-t-' + kebab(k)`), not a variable name.
    for (const m of src.matchAll(/setProperty\('(--pw-[\w-]*[\w])'/g)) setVars.add(m[1]);
  });
  // `applyMetrics` composes its names, so derive the full set the way it does.
  const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  Object.keys(P.LAYOUT).forEach((k) => setVars.add('--pw-' + kebab(k)));
  Object.keys(P.TYPE).forEach((k) => setVars.add('--pw-t-' + kebab(k)));
  Object.keys(P.PALETTE).forEach((k) => setVars.add('--pw-c-' + kebab(k)));
  setVars.add('--pw-present-secs');
  const readVars = new Set();
  for (const m of css.matchAll(/var\(\s*(--pw-[\w-]+)/g)) readVars.add(m[1]);
  expect(setVars.size > 20, 'the paywall sets its metrics as --pw-* custom properties');
  readVars.forEach((v) => expect(setVars.has(v), `${v} is read by the CSS and set by the JS`));
  setVars.forEach((v) => expect(readVars.has(v), `${v} is set by the JS and read by the CSS`));
  // The namespace must not collide with an audit that belongs to another screen.
  [...setVars].forEach((v) => expect(!/^--(pz|pg|cg|an-|lg-|h-)/.test(v.slice(2)),
    `${v} stays out of another screen's namespace`));

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayPremium: ${passed} Swift expectations confirmed against the JS`
      : `ReplayPremium: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
