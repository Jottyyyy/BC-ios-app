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
    + swNum(metrics, 'LoginLayout', 'guestTopGap')
    + swNum(metrics, 'LoginLayout', 'guestButtonHeight')
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
  eq(L.SESSION.guestProvider, swStr(metrics, 'LoginSession', 'guestProvider'),
    'LoginSession.guestProvider');
  expect(/static let providers:\s*\[String\]\s*=\s*\[appleProvider, guestProvider\]/
    .test(code(metrics)),
  'the Swift provider list is exactly [appleProvider, guestProvider], like the JS');
  eq(L.SESSION.providers.join(','), 'apple,guest',
    'and the JS list is the same two, in the same order');
  // Both are real sessions. The guest one is not a bypass of the gate and not a third state: the
  // predicate accepts it, so everything downstream — the shell, Profile, Sign out — is unchanged.
  expect(L.isSignedIn(L.SESSION.guestProvider),
    'a stored "guest" reads as signed in, like a stored "apple"');
  expect(!L.isSignedIn('anything-else'), 'and anything else still fails closed');
  eq(L.providerLabel(L.SESSION.guestProvider),
    swStr(metrics, 'LoginStrings', 'guestProviderLabel'),
    'a guest session shows its own Profile label, not the signed-out em dash');
  expect(/guard isSignedIn\(raw\) else \{ return LoginStrings\.noProviderLabel \}/
    .test(code(metrics)),
  'and the Swift label function branches the same way: signed out first, then which provider');
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
  ['title', 'tagline', 'appleButton', 'guestButton', 'reassurance', 'privacy', 'terms',
    'legalSeparator', 'defaultDisplayName', 'appleProviderLabel', 'guestProviderLabel',
    'noProviderLabel', 'accountCard', 'signedInWith',
    'signOut', 'sheetClose', 'privacyTitle', 'termsTitle', 'authFailed', 'authFailedCode',
    'deleteAccount', 'deleteTitle', 'deleteConfirm', 'deleteCancel'].forEach((k) => {
    eq(L.STRINGS[k], swStr(metrics, 'LoginStrings', k), 'LoginStrings.' + k);
  });
  ['privacyBody', 'termsBody', 'deleteBody', 'authFailedBody'].forEach((k) => {
    eq(L.STRINGS[k], swMultiline(metrics, 'LoginStrings', k), 'LoginStrings.' + k);
  });
  eq(L.STRINGS.appleButton, 'Continue with Apple', "Apple's required button wording, verbatim");

  // 9a. THE WAY IN THAT CANNOT FAIL.
  //
  //     Build 1.0.7 (51) was rejected under Guideline 2.1(a) — "the app displays error upon login".
  //     The alert App Review screenshotted, "Could Not Connect", appears NOWHERE in this repo: it is
  //     Apple's own, from a sign-in service running in another process against Apple's servers. It
  //     was fatal only because there was no second door, and requiring the first one was a 5.1.1(v)
  //     problem in its own right — "if your app doesn't include significant account-based features,
  //     let people use it without a login", and this app has an account server nowhere.
  //
  //     So: the door exists, it is on the screen and not only in the failure alert, and the alert
  //     leads to it. Asserted in both languages, because a mirror that lost it would leave the
  //     browser looking fine while the shipped app stayed walled.
  {
    const scr = code(screen);
    expect(/struct LoginGuestButton: View/.test(scr), 'the Swift has a guest button at all');
    expect(/LoginGuestButton\(action: \{ continueWithoutAccount\(\) \}\)/.test(scr),
      'and the login screen draws it, below Apple\'s — not buried in a menu');
    expect(/onSignedIn\(LoginSession\.guestProvider\)/.test(scr),
      'it opens a real guest session rather than skipping the gate');
    expect(/Button\(LoginStrings\.guestButton\) \{[\s\S]{0,120}continueWithoutAccount\(\)/.test(scr),
      'and the FAILURE ALERT offers the same way out — build 51\'s alert had one button and it led '
      + 'back to the same wall');
    expect(/message: \{[\s\S]{0,80}Text\(appleAuth\.failureMessage\)/.test(scr),
      'the alert explains itself, and carries the code Apple gave us');
    const guestJs = code(fs.readFileSync(path.join(JS, 'login.js'), 'utf8'));
    expect(/el\('button', 'lg-guest'/.test(guestJs), 'the browser draws the guest button too');
    expect(/shared\(\)\.signIn\(SESSION\.guestProvider\)/.test(guestJs),
      'and signs in with the same provider');

    // The message, composed in the shared decision half so both languages say the same sentence.
    eq(L.authFailureMessage(null), L.STRINGS.authFailedBody, 'no code from Apple: the body alone');
    eq(L.authFailureMessage('AuthorizationError 1000'),
      L.STRINGS.authFailedBody + '\n\n'
        + L.STRINGS.authFailedCode.replace('{code}', 'AuthorizationError 1000'),
      'a code is appended, never substituted for the body');
    expect(/static func failureMessage\(code: String\?\) -> String/.test(code(metrics)),
      'the Swift composes it in LoginAuth, beside the rest of the decision half');
    expect(/guard let code, !code\.isEmpty else \{ return LoginStrings\.authFailedBody \}/
      .test(code(metrics)), 'with the same empty-code branch');

    // The diagnostic itself: build 51 could not be diagnosed because the delegate read `.canceled`
    // and discarded the NSError. A cancel still carries no code — it is not a failure.
    const aa = code(read(UI, 'LoginAppleAuth.swift'));
    expect(/@Published private\(set\) var failureCode: String\?/.test(aa),
      'LoginAppleAuth keeps the code Apple reported');
    expect(/let ns = error as NSError/.test(aa),
      'read from the NSError it was handed, which is exactly what used to be thrown away');
    expect(/self\.failureCode = cancelled \? nil : detail/.test(aa),
      'and a CANCEL carries none — backing out of Apple\'s sheet is not a fault');
    // The presentation anchor. `ASPresentationAnchor()` is a UIWindow with no windowScene, so it is
    // a last resort and not a default — App Review tested 1.0.7 on an iPad.
    expect(/activationState == \.foregroundActive/.test(aa),
      'the anchor prefers a window from a FOREGROUND ACTIVE scene');
    expect(/\?\? ASPresentationAnchor\(\)/.test(aa) && (aa.match(/\?\?/g) || []).length >= 4,
      'and the detached window is the last rung of a ladder, not the only fallback');
  }

  // 9b. ACCOUNT DELETION's two lists. Guideline 5.1.1(v) needs the erase list; Apple's rule that
  //     deleting an account must not forfeit a paid subscription needs the KEEP list, and that one
  //     is the easier of the two to lose in a refactor.
  {
    const A = L.ACCOUNT_DATA;
    const swAcc = code(metrics);
    const arrayOf = (name) => {
      const m = new RegExp('static let ' + name +
        ': \\[String\\] = \\[([\\s\\S]*?)\\]').exec(swAcc);
      return m ? (m[1].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)) : null;
    };
    ['erasedKeys', 'erasedKeyPrefixes', 'erasedFiles', 'keptKeys'].forEach((name) => {
      const sw = arrayOf(name);
      expect(!!sw, `LoginAccountData.${name} parses`);
      if (sw) eq(A[name].join(','), sw.join(','), `LoginAccountData.${name}`);
    });

    // EXTRACT, DON'T TRANSCRIBE: every erased key is a literal here, copied from a declaration
    // that lives on a @MainActor store this enum cannot reach. So check the copies against the
    // originals — a renamed key that only got changed in one place is exactly the leftover this
    // feature exists to prevent.
    const CORE = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');
    const owners = [
      ['biya.auth.session.v1', metrics, 'LoginSession.storageKey'],
      ['biya.coach.takeback.v1', read(UI, 'CoachStore.swift'), 'CoachStore.takeBackKey'],
      ['biya.analysis.engine.v1', read(CORE, 'EngineSettings.swift'), 'EngineSettings.storageKey'],
      ['biya.coach.draft.v1.', read(CORE, 'CoachGame.swift'), 'CoachGame.draftKeyPrefix'],
      ['biya.store.subscription.v1', read(UI, 'PremiumStore.swift'), 'PremiumStore.snapshotKey'],
      ['biya.store.usage.v1', read(UI, 'PremiumStore.swift'), 'PremiumStore.usageKey'],
    ];
    owners.forEach(([key, src, owner]) => {
      expect(!!src && code(src).indexOf('"' + key + '"') >= 0,
        `${owner} still declares "${key}" — LoginAccountData copies it`);
    });
    // The two that must NOT be erased, stated as an assertion rather than as a comment.
    A.keptKeys.forEach((k) => {
      expect(A.erasedKeys.indexOf(k) < 0, `${k} is KEPT, never erased`);
      A.erasedKeyPrefixes.forEach((p) => {
        expect(k.indexOf(p) !== 0, `${k} is not swept up by the prefix ${p}`);
      });
    });

    // The browser mirrors it as a MODAL, not a route: trial_gate_check.js asserts OPEN_ROUTES is
    // exactly home/login/paywall/profile/analysis, and a delete-account route would break that.
    const appJs = code(fs.readFileSync(path.join(JS, 'app.js'), 'utf8'));
    expect(/function confirmDeleteAccount\(\)/.test(appJs), 'the browser confirms before erasing');
    expect(/function eraseAccountData\(\)/.test(appJs), 'and has an eraser driven by ACCOUNT_DATA');
    expect(appJs.indexOf('BiyaLogin.ACCOUNT_DATA') >= 0,
      'the browser eraser reads the SHARED list rather than its own copy');
    expect(!/'delete-account'/.test(appJs), 'deletion is not a route');
    // Swift confirms too. A one-tap irreversible wipe is the bug this asserts against.
    expect(/isPresented: \$confirmingDelete/.test(code(read(UI, 'PhoneView.swift'))),
      'the Swift delete is behind a confirmation');
  }

  // 9c. THE SIGN-IN STATE MACHINE. `ASAuthorizationController` cannot be mirrored in a browser,
  //     so the two languages share the DECISION half instead: which event moves the screen where.
  //     Comparing it here is what stops the mirror being a vacuous "both look the same".
  {
    const table = [
      ['idle', 'start', 'requesting'], ['idle', 'succeeded', 'idle'],
      ['idle', 'cancelled', 'idle'], ['idle', 'failed', 'idle'],
      ['requesting', 'start', 'requesting'], ['requesting', 'succeeded', 'idle'],
      ['requesting', 'cancelled', 'idle'], ['requesting', 'failed', 'failed'],
      ['failed', 'start', 'requesting'], ['failed', 'succeeded', 'failed'],
      ['failed', 'cancelled', 'failed'], ['failed', 'failed', 'failed'],
    ];
    eq(L.AUTH_PHASES.length * L.AUTH_EVENTS.length, table.length,
      'the table covers every phase x event pair');
    for (const [phase, event, want] of table) {
      eq(L.authNext(phase, event), want, `authNext(${phase}, ${event})`);
    }
    // The branch worth stating twice, because getting it wrong in one language is invisible:
    // a user who backs out of Apple's sheet must NOT be shown an error.
    expect(!L.authShowsError(L.authNext('requesting', 'cancelled')),
      'a cancelled sign-in shows no error');
    expect(L.authShowsError(L.authNext('requesting', 'failed')), 'a failed one does');
    expect(L.authIsBusy('requesting') && !L.authIsBusy('idle'),
      'the request is busy only while Apple has the sheet up');

    // The Swift arms, read off the source. Every non-default transition the JS table names must
    // appear literally; everything else falls to `default: return phase`.
    const swAuth = code(metrics);
    ['case (.idle, .start), (.failed, .start): return .requesting',
     'case (.requesting, .succeeded): return .idle',
     'case (.requesting, .cancelled): return .idle',
     'case (.requesting, .failed): return .failed',
     'default: return phase'].forEach((arm) => {
      expect(swAuth.indexOf(arm) >= 0, `LoginAuth.next holds: ${arm}`);
    });
    expect(/showsError\(_ phase: LoginAuthPhase\) -> Bool \{ phase == \.failed \}/.test(swAuth),
      'LoginAuth.showsError agrees with the JS');
    expect(/isBusy\(_ phase: LoginAuthPhase\) -> Bool \{ phase == \.requesting \}/.test(swAuth),
      'LoginAuth.isBusy agrees with the JS');
    eq(L.AUTH_PHASES.join(','), 'idle,requesting,failed', 'the JS phase vocabulary');
    eq(L.AUTH_EVENTS.join(','), 'start,succeeded,cancelled,failed', 'the JS event vocabulary');
    ['idle', 'requesting', 'failed', 'start', 'succeeded', 'cancelled'].forEach((c) => {
      expect(new RegExp('case ' + c + '\\b').test(swAuth), `the Swift declares .${c}`);
    });
  }

  // 10. THE OFFLINE GUARANTEE. `ios/project.yml`'s export-compliance NO says the app has no
  //     network at all, and a login screen is the single most likely place to break that.
  //
  //     `ASAuthorization` used to be banned here alongside the networking tokens, because the
  //     sign-in was SIMULATED and this ban was what kept it that way. It is real now — a fake
  //     "Continue with Apple" is an App Store rejection — so that one token became an ALLOWLIST
  //     OF ONE instead of a deletion: `LoginAppleAuth.swift` must make the call, and nothing else
  //     may. The networking tokens stay banned EVERYWHERE, including in that new file: Apple's
  //     sheet reaches Apple over the system's own transport, and a URLSession in the login feature
  //     would still be a first-party network call and still a lie in ios/project.yml.
  const appleAuth = read(UI, 'LoginAppleAuth.swift');
  expect(!!appleAuth, 'LoginAppleAuth.swift exists');
  const sources = { 'LoginMetrics.swift': metrics, 'LoginStore.swift': store,
    'LoginScreen.swift': screen, 'LoginMetricsCheck.swift': check,
    'LoginAppleAuth.swift': appleAuth || '',
    'web-demo/js/login.js': fs.readFileSync(path.join(JS, 'login.js'), 'utf8') };
  Object.keys(sources).forEach((name) => {
    const src = code(sources[name]);
    ['URLSession', 'URLRequest', 'fetch(', 'XMLHttpRequest'].forEach((tok) => {
      expect(src.indexOf(tok) < 0, `${name} contains no ${tok} — the app opens no connection`);
    });
    const urls = src.match(/https?:\/\/[^\s"')]+/g) || [];
    expect(urls.length === 0, `${name} contains no URL (${urls.join(', ')})`);
  });

  //     The allowlist, both halves. A positive assertion so the call cannot quietly go away and
  //     leave a button that does nothing again, and a negative one so it cannot spread.
  expect(code(sources['LoginAppleAuth.swift']).indexOf('ASAuthorizationController') >= 0,
    'LoginAppleAuth.swift makes the real Sign in with Apple call');
  expect(code(sources['LoginAppleAuth.swift']).indexOf('requestedScopes = []') >= 0,
    'and asks for NO scopes — a name or an email would be data the privacy manifest denies collecting');
  ['LoginMetrics.swift', 'LoginStore.swift', 'LoginScreen.swift', 'LoginMetricsCheck.swift',
   'web-demo/js/login.js'].forEach((name) => {
    expect(code(sources[name]).indexOf('ASAuthorization') < 0,
      `${name} does not touch AuthenticationServices — LoginAppleAuth.swift is the only file that may`);
  });
  //     Exhaustive, so the permission cannot spread to a file this list has never heard of.
  const importers = fs.readdirSync(UI).filter((f) => f.endsWith('.swift'))
    .filter((f) => /^import AuthenticationServices$/m
      .test(code(fs.readFileSync(path.join(UI, f), 'utf8'))));
  eq(importers.join(','), 'LoginAppleAuth.swift',
    'exactly one file in the UI imports AuthenticationServices');
  //     THE BUILD SWITCH, and WHERE it is allowed to live.
  //
  //     `SWIFT_ACTIVE_COMPILATION_CONDITIONS` set on the Xcode project — in `ios/project.yml`, on
  //     the xcodebuild command line, anywhere at target level — does NOT reach a local SwiftPM
  //     package's targets. Every UI file is in the `BiyaherongUI` package, so a `#if` in there
  //     compiles identically in every build whatever CI passes. Three rounds of "the flag is set
  //     in codemagic.yaml" produced three identical builds and no error anywhere to explain it.
  //
  //     So the `#if` lives in `ios/App/BiyaherongApp.swift`, a real Xcode target, and hands a
  //     Bool to the package at runtime. These assertions exist to stop it drifting back.
  {
    const UIDIR = UI;
    const buildMode = read(UIDIR, 'BuildMode.swift');
    expect(!!buildMode, 'BuildMode.swift exists');
    const bm = code(buildMode || '');
    expect(/public private\(set\) static var isTestBuild = false/.test(bm),
      'the default FAILS CLOSED. It was `true`, so that a build nobody could open — the failure '
      + 'that kept happening, silently — could not recur. But "a build told nothing" stopped '
      + 'meaning a tester\'s build and started meaning whatever ship_testflight.sh produces, and '
      + 'that script sets nothing: the documented one-command ship was uploading a giveaway');
    expect(/public static func configure\(isTestBuild: Bool\)/.test(bm),
      'and the app target sets it through configure(isTestBuild:)');

    // THE assertion this whole section exists for: an inert `#if` must never come back.
    const pkg = fs.readdirSync(UIDIR).filter((f) => f.endsWith('.swift'));
    const inert = pkg.filter((f) =>
      /#if\s+!?\s*BIYA_(APPSTORE|TESTBUILD)/.test(code(fs.readFileSync(path.join(UIDIR, f), 'utf8'))));
    eq(inert.join(','), '',
      'NO file in the BiyaherongUI package may branch on either build condition — a compilation '
      + 'condition set on the Xcode project never reaches a package target, so such a `#if` is '
      + 'inert and compiles the same way in every build');

    // The app target, where it genuinely applies.
    const appMain = fs.readFileSync(
      path.join(ROOT, 'ios', 'App', 'BiyaherongApp.swift'), 'utf8');
    const am = code(appMain);
    expect(/#if BIYA_TESTBUILD[\s\S]{0,200}configure\(isTestBuild: true\)/.test(am),
      'the app target opts INTO the open build under BIYA_TESTBUILD');
    expect(/#else[\s\S]{0,200}configure\(isTestBuild: false\)[\s\S]{0,40}#endif/.test(am),
      'and every other build is a REAL one — forgetting the flag now costs a tester an '
      + 'inconvenience instead of costing the product its revenue');
    expect(!/BIYA_APPSTORE/.test(am),
      'the old opt-into-charging condition is gone, not merely unused — leaving it would give a '
      + 'future editor two flags with opposite senses to confuse');
    expect(/init\(\)/.test(am),
      'set from init(), before the view tree exists, so every reader sees the right value');

    // The three readers.
    const sw = code(sources['LoginAppleAuth.swift']);
    expect(/if BiyaherongBuild\.isTestBuild \{[\s\S]{0,80}finish\(\.succeeded\)/.test(sw),
      'the sign-in opens the session directly in a test build');
    expect(/#if os\(iOS\)[\s\S]{0,600}ASAuthorizationController/.test(sw),
      'and the REAL Apple call is still there for a submission build');
    const store = code(sources['LoginStore.swift']);
    expect(/if BiyaherongBuild\.isTestBuild, self\.provider == nil/.test(store),
      'the login SCREEN is skipped too — a session is opened at launch');
    const premium = code(read(UIDIR, 'PremiumStore.swift'));
    expect(/if BiyaherongBuild\.isTestBuild \{[\s\S]{0,80}access = \.premium\(trial: false\)/
      .test(premium),
      'the entitlement is granted in a test build, with its mandatory associated value');
    expect(/\} else \{[\s\S]{0,120}access = Entitlement\.resolve\(snapshot, now: nowMs\(\)\)/
      .test(premium),
      'and the real resolution is untouched otherwise');
    expect((premium.match(/access = /g) || []).length === 2,
      'exactly two writers of `access`: the test grant and the real resolve');

    // ── The three workflows ────────────────────────────────────────────────────────────────────
    const ci = fs.readFileSync(path.join(ROOT, 'codemagic.yaml'), 'utf8');
    const at = (k) => {
      const i = ci.indexOf('\n  ' + k + ':');
      expect(i > 0, `codemagic.yaml declares ${k}`);
      return i;
    };
    const iFree = at('ios-free-unsigned'), iTf = at('ios-testflight'), iAs = at('ios-appstore');
    expect(iFree < iTf && iTf < iAs, 'the three workflows are in the documented order');
    const sets = (block) => /SWIFT_ACTIVE_COMPILATION_CONDITIONS: BIYA_TESTBUILD/.test(block);

    expect(sets(ci.slice(iFree, iTf)),
      'ios-free-unsigned opts INTO the open build by rewriting project.yml before xcodegen — the '
      + 'mechanism this repo has proved works, unlike passing a setting through the Codemagic CLI');
    expect(sets(ci.slice(iTf, iAs)), 'ios-testflight opts in too; it is named TEST BUILD');
    expect(!sets(ci.slice(iAs)),
      'ios-appstore sets NOTHING — the checked-in default is already the submission behaviour, '
      + 'which is the entire point of inverting the flag');

    // Every workflow asserts, none assumes. The two test ones refuse on absence, the submission
    // one refuses on presence, and all three read the EFFECTIVE settings rather than the file.
    expect(/REFUSING: BIYA_TESTBUILD did NOT reach the compiler/.test(ci.slice(iFree, iTf)),
      'ios-free-unsigned REFUSES if the open build did not arrive — the original silent failure');
    expect(/REFUSING: BIYA_TESTBUILD did NOT reach the compiler/.test(ci.slice(iTf, iAs)),
      'ios-testflight refuses on the same absence');
    expect(/REFUSING: BIYA_TESTBUILD reached the compiler on a SUBMISSION build/.test(ci.slice(iAs)),
      'and ios-appstore refuses on its PRESENCE — contamination is the only way it can go wrong now');
    expect((ci.match(/-showBuildSettings/g) || []).length === 3,
      'all three read back the effective build settings; none trusts its own sed');
    expect(/applesignin/.test(ci.slice(iAs)),
      'ios-appstore also checks the entitlement survived signing — the failure with no other symptom');

    const proj = fs.readFileSync(path.join(ROOT, 'ios', 'project.yml'), 'utf8');
    expect(/SWIFT_ACTIVE_COMPILATION_CONDITIONS: ""/.test(proj),
      'ios/project.yml ships the REAL default in `base`');
    expect(!/^\s{8}SWIFT_ACTIVE_COMPILATION_CONDITIONS: BIYA_TESTBUILD/m.test(proj),
      'and never hard-codes the test flag at base level — that would make every archive a giveaway');
    expect(/configs:[\s\S]{0,600}Debug:\s*\n\s+SWIFT_ACTIVE_COMPILATION_CONDITIONS: BIYA_TESTBUILD/
      .test(proj),
      'the open build survives where it was actually wanted: `configs: Debug`, so Xcode Run is '
      + 'still openable while Release — every archive — charges');

    // ship_testflight.sh is the reason the default was inverted at all: it sets no build settings,
    // so under the old sense it uploaded a build with a granted subscription and a fake sign-in.
    const ship = fs.readFileSync(
      path.join(ROOT, 'tools', 'ship', 'ship_testflight.sh'), 'utf8');
    expect(/BIYA_TESTBUILD/.test(ship),
      'ship_testflight.sh knows about the flag at all — it did not, which was the whole hole');
    expect(/-showBuildSettings/.test(ship),
      'and reads the EFFECTIVE settings back, the same way it refuses to trust EXPORT SUCCEEDED');
  }

  //     And the browser twin declares itself a stub, so it can never be read as the real thing.
  expect(/var SIMULATED_AUTH = true;/.test(code(sources['web-demo/js/login.js'])),
    'the browser sign-in declares itself simulated');
  expect(!/SIMULATED_AUTH/.test(code(sources['LoginAppleAuth.swift'])),
    'and the Swift does NOT carry that flag');

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
  ['.lg-view', '.lg-logo', '.lg-apple', '.lg-guest', '.lg-sheet-card', '.lg-signout'].forEach((sel) => {
    expect(css.indexOf('\n' + sel) >= 0 || css.indexOf(sel + ' {') >= 0,
      'app.css styles ' + sel);
  });

  const appJs = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  expect(/current === 'login'\) renderLogin\(\)/.test(appJs),
    "app.js's router has a 'login' branch — without one the trailing else silently shows the old "
    + 'sample-puzzle tab');
  expect(/BiyaLogin\.shared\(\)\.isSignedIn\(\)\s*\?\s*'home'\s*:\s*'login'/.test(appJs),
    'app.js gates the FIRST screen on the session');
  // This used to assert `renderLogin` adds `an-mode`, whose only CSS rule was
  // `.app-card.an-mode .tabbar { display: none }`. With Home as the app root there is no tab bar,
  // so the class and its twenty add/remove calls are gone; what still matters is that the gate
  // owns the whole box.
  expect(/view\.classList\.add\('flush'\)/.test(appJs.slice(appJs.indexOf('function renderLogin'))),
    'renderLogin owns the whole phone box — a login screen with a gutter is not a gate');
  // Comment-stripped: the note in `renderLogin` explaining that `an-mode` was removed must not
  // read as the removal having failed. Same trap `home_chrome_check.js` blanks comments for.
  expect(!/an-mode/.test(code(appJs)), 'and `an-mode` is gone entirely, with the bar it hid');
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
