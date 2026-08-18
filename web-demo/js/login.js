/* Login screen — the browser mirror of DemoApp/Sources/BiyaherongUI/LoginScreen.swift
 *
 * The app's first screen: brand hero, one SIMULATED "Continue with Apple" button, a bundled legal
 * sheet. Signing in persists, so this is the first screen once and not on every launch; Profile >
 * Sign out is the way back to it.
 *
 * The top half of this file is the PURE layer and is a line-for-line mirror of LoginMetrics.swift
 * and LoginStore.swift — the band budget, the palette, the drift table, the copy and the whole
 * session state machine. `BiyaLogin.selfTest()` asserts it, and because the file exports itself
 * under Node it can also be run headlessly:
 *
 *     node -e "console.log(require('./web-demo/js/login.js').selfTest().summary)"
 *
 * `tools/qa/replay_login.js` asserts these constants against the Swift ones. Keep the two in
 * lockstep — a divergence between them is exactly the drift this mirror exists to catch.
 *
 * THE SIGN-IN IS SIMULATED. There is no network call here and none in the Swift: the app is 100%
 * offline and the claim in ios/project.yml depends on staying that way. See PORTING_NOTES.md.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaLogin = (function () {
  'use strict';

  /* ===================== pure layer (mirrors LoginMetrics.swift) ===================== */

  /* -- typography -- */
  var TYPE = {
    lineHeightRatio: 1.364,
    titleSize: 30,
    taglineSize: 14,
    buttonLabelSize: 17,
    reassureSize: 13,
    legalSize: 11,
    sheetTitleSize: 20,
    sheetBodySize: 14,
    sheetCloseSize: 15,
    titleTracking: 0.5,
    buttonTracking: -0.2
  };

  /** The nominal Nunito line box, rounded the way both languages round. */
  function line(size) { return Math.round(size * TYPE.lineHeightRatio); }

  /* -- palette. A 1:1 copy of LoginPalette, which is itself built from Theme. -- */
  var PALETTE = {
    screenBg: '#0F1A2E',
    glowInner: 'rgba(253, 176, 34, .16)',
    glowOuter: 'rgba(253, 176, 34, 0)',
    logoRing: '#FDB022',
    logoGlow: '#FDB022',
    title: '#FDB022',
    tagline: '#8BA3C7',
    reassure: '#8BA3C7',
    /* Apple's mark is the one thing here that is not ours: black on white, never tinted. */
    appleFill: '#FFFFFF',
    appleInk: '#000000',
    appleShadow: 'rgba(0, 0, 0, .35)',
    /* Extracted: `legalLink` in the RN app's (auth)/login.tsx. */
    legal: '#3A5070',
    sheetScrim: 'rgba(0, 0, 0, .55)',
    sheetFill: '#1A2942',
    sheetBorder: 'rgba(74, 159, 232, .12)',
    sheetTitle: '#FFFFFF',
    sheetBody: '#8BA3C7'
  };

  /* -- layout -- */
  var LAYOUT = {
    screenPaddingH: 24,
    heroTopPadding: 64,
    logoSize: 124,
    logoRadius: 30,
    logoRingWidth: 2,
    logoGlowRadius: 22,
    logoGlowOpacity: 0.45,
    heroSpacing: 18,
    titleTaglineGap: 6,
    buttonHeight: 54,
    buttonRadius: 14,
    buttonGlyphSize: 19,
    buttonGlyphGap: 8,
    buttonShadowRadius: 14,
    buttonShadowY: 6,
    pressedButton: 0.82,
    reassureTopGap: 14,
    footerTopGap: 18,
    footerBottomPadding: 22,
    legalGap: 8,
    minSpacer: 24,
    /* How much of the leftover height goes ABOVE the hero. Spelled as `flex-grow: 35` / `65` over a
       zero basis in the CSS, which is the same distribution `LoginLayout.heroTop` computes. */
    spacerTopShare: 0.35,
    glowEndRadius: 320,
    entranceScale: 0.86,
    entranceRise: 14,
    sheetWidth: 320,
    sheetRadius: 20,
    sheetPadding: 22,
    sheetMaxBodyHeight: 300,
    sheetTitleGap: 10,
    sheetBodyGap: 18,
    sheetCloseHeight: 44,
    sheetCloseRadius: 14,
    sheetLineSpacing: 4,
    shortestSupportedHeight: 667
  };

  /**
   * Everything the screen draws except the one flexible spacer. Mirrors
   * `LoginLayout.fixedHeight()`; `LoginMetricsCheck` and `selfTest` both assert it leaves room on
   * the shortest phone the app supports. A login screen that scrolls is a bug, not a layout.
   */
  function fixedHeight() {
    return LAYOUT.heroTopPadding
      + LAYOUT.logoSize
      + LAYOUT.heroSpacing
      + line(TYPE.titleSize)
      + LAYOUT.titleTaglineGap
      + line(TYPE.taglineSize)
      + LAYOUT.buttonHeight
      + LAYOUT.reassureTopGap
      + line(TYPE.reassureSize)
      + LAYOUT.footerTopGap
      + line(TYPE.legalSize)
      + LAYOUT.footerBottomPadding;
  }

  /** The height the fixed bands do not claim. Everything below distributes exactly this. */
  function leftoverFor(screenHeight) { return Math.max(0, screenHeight - fixedHeight()); }

  /** Where the hero starts: its floor, plus its share of the leftover. */
  function heroTopFor(screenHeight) {
    return LAYOUT.heroTopPadding + Math.round(leftoverFor(screenHeight) * LAYOUT.spacerTopShare);
  }

  /** What the flexible band between the hero and the button gets on a given screen. */
  function spacerFor(screenHeight) {
    return Math.max(LAYOUT.minSpacer,
      Math.round(leftoverFor(screenHeight) * (1 - LAYOUT.spacerTopShare)));
  }

  /* -- timing -- */
  var TIMING = {
    heroEntranceSeconds: 0.55,
    heroEntranceDelay: 0.05,
    heroDamping: 0.72,
    textEntranceSeconds: 0.45,
    textEntranceDelay: 0.18,
    buttonEntranceSeconds: 0.45,
    buttonEntranceDelay: 0.30,
    signInFadeSeconds: 0.35,
    sheetFadeSeconds: 0.22
  };

  /* -- the drifting background field --
   *
   * Real bundled piece art at very low opacity, hand-placed to stay clear of the hero column and
   * the action band. Deliberately a fixed table and not randomised: a background that differs run
   * to run cannot be asserted at all.
   */
  var DRIFT = [
    { kind: 'pawn', white: true, x: 0.10, y: 0.08, size: 34, travel: 10, seconds: 7.0, delay: 0.0, opacity: 0.06 },
    { kind: 'knight', white: true, x: 0.78, y: 0.06, size: 46, travel: 14, seconds: 9.0, delay: 0.6, opacity: 0.07 },
    { kind: 'rook', white: false, x: 0.90, y: 0.20, size: 32, travel: 9, seconds: 8.0, delay: 1.2, opacity: 0.05 },
    { kind: 'bishop', white: true, x: 0.06, y: 0.30, size: 30, travel: 11, seconds: 10.0, delay: 0.3, opacity: 0.05 },
    { kind: 'queen', white: false, x: 0.16, y: 0.52, size: 40, travel: 12, seconds: 8.5, delay: 1.6, opacity: 0.06 },
    { kind: 'pawn', white: false, x: 0.86, y: 0.48, size: 28, travel: 8, seconds: 7.5, delay: 0.9, opacity: 0.05 },
    { kind: 'knight', white: false, x: 0.72, y: 0.68, size: 36, travel: 13, seconds: 9.5, delay: 2.0, opacity: 0.05 },
    { kind: 'rook', white: true, x: 0.12, y: 0.74, size: 34, travel: 10, seconds: 8.2, delay: 1.4, opacity: 0.06 }
  ];

  /** Where a spec sits in a container. Mirrors `LoginDrift.point`. */
  function driftPoint(spec, size) { return { x: size.width * spec.x, y: size.height * spec.y }; }

  /** Every distinct piece the field needs, sorted so preloading is deterministic. */
  function usedKinds() {
    var seen = {}, out = [];
    DRIFT.forEach(function (s) { if (!seen[s.kind]) { seen[s.kind] = 1; out.push(s.kind); } });
    return out.sort();
  }

  /** The bundled SVG for a drift spec — the same art the boards draw, no new asset. */
  function pieceSrc(spec) { return PIECES + spec.kind + '-' + (spec.white ? 'w' : 'b') + '.svg'; }

  /* -- the session, as a pure predicate over the stored string (mirrors LoginSession) -- */
  var SESSION = {
    /* Same biya.<area>.<thing>.v1 shape as biya.coach.takeback.v1. */
    storageKey: 'biya.auth.session.v1',
    appleProvider: 'apple',
    providers: ['apple']
  };

  function isSignedIn(raw) {
    if (raw === null || raw === undefined || raw === '') return false;
    return SESSION.providers.indexOf(raw) >= 0;
  }

  function providerLabel(raw) {
    return isSignedIn(raw) && raw === SESSION.appleProvider
      ? STRINGS.appleProviderLabel : STRINGS.noProviderLabel;
  }

  /* -- what "delete my account" erases, and what it does not (mirrors LoginAccountData).
   *
   *    One list in two languages, because the cost of drift here is either a leftover or a wiped
   *    subscription. replay_login.js compares all four arrays AND checks the erased keys against
   *    the declarations they mirror in the other Swift files. -- */
  var ACCOUNT_DATA = {
    erasedKeys: [
      'biya.auth.session.v1',     /* LoginSession.storageKey */
      'biya.coach.takeback.v1',   /* CoachStore.takeBackKey */
      'biya.analysis.engine.v1'   /* EngineSettings.storageKey */
    ],
    erasedKeyPrefixes: ['biya.coach.draft.v1.'],   /* CoachGame.draftKeyPrefix */
    /* Swift-side mechanism: on iOS these are files in Application Support/Biyaherong. The browser
     * has no such folder, so the twin erases keys only — but the LIST is shared, because it is the
     * list that must not drift. */
    erasedFiles: ['puzzle-progress.json', 'pairing.json', 'openings.json', 'analysis-library.json'],
    /* KEPT. The entitlement snapshot, because Apple requires that deleting an account does not
     * forfeit a paid subscription; and the daily counters, because clearing them would make
     * "delete, sign in again" a free reset of every free-tier cap. */
    keptKeys: ['biya.store.subscription.v1', 'biya.store.usage.v1']
  };

  /* -- the sign-in state machine (mirrors LoginAuth in LoginMetrics.swift).
   *
   *    The browser cannot have an ASAuthorizationController, so what is shared is the DECISION
   *    half: which event moves the screen where, and which of them the user is told about. The
   *    branch that matters is that a CANCEL is not an error. -- */
  var AUTH_PHASES = ['idle', 'requesting', 'failed'];
  var AUTH_EVENTS = ['start', 'succeeded', 'cancelled', 'failed'];

  /* This browser build has no real Apple sign-in, and says so out loud. replay_login.js asserts
   * the flag is here AND that no Swift file carries it, so the stub can never be mistaken for the
   * real call. */
  var SIMULATED_AUTH = true;

  function authNext(phase, event) {
    if ((phase === 'idle' || phase === 'failed') && event === 'start') return 'requesting';
    if (phase === 'requesting' && event === 'succeeded') return 'idle';
    if (phase === 'requesting' && event === 'cancelled') return 'idle';
    if (phase === 'requesting' && event === 'failed') return 'failed';
    return phase;
  }

  function authShowsError(phase) { return phase === 'failed'; }
  function authIsBusy(phase) { return phase === 'requesting'; }

  /* -- copy. Taglish, matching the original app's voice. The button label is Apple's required
   *    wording and stays English. -- */
  var STRINGS = {
    title: 'Biyaherong Coach',
    tagline: 'Kabiyahe mo sa pag improve!',
    appleButton: 'Continue with Apple',
    reassurance: 'Walang password — i-tap lang at maglaro na!',
    privacy: 'Privacy',
    terms: 'Terms',
    legalSeparator: '·',
    defaultDisplayName: 'Biyahero',
    appleProviderLabel: 'Apple',
    noProviderLabel: '—',
    accountCard: 'Account',
    signedInWith: 'Signed in with',
    signOut: 'Sign out',
    sheetClose: 'Sige, salamat!',
    authFailed: 'Hindi natuloy ang sign in. Subukan ulit.',
    deleteAccount: 'Delete account',
    deleteTitle: 'Burahin ang account?',
    deleteConfirm: 'Burahin',
    deleteCancel: 'Huwag na',
    deleteBody: 'Mabubura lahat ng nasa device na ito: mga puzzle, rating, laro at settings mo. '
      + 'Hindi na ito maibabalik.\n\nHindi kasama ang subscription mo. Hindi ito makakansela at '
      + 'hindi mawawala — pamahalaan ito sa Settings > Apple Account > Subscriptions.',
    privacyTitle: 'Privacy',
    privacyBody: 'Biyaherong Coach works offline. It does not collect, store, or send any personal '
      + 'information anywhere — there is no account server and no analytics.\n\n'
      + 'Signing in goes through Apple, so the first sign-in needs internet. Nothing else does: '
      + 'your puzzles, ratings, games and settings live on this device only.\n\n'
      + 'Walang datos na inilalabas. Lahat ay nasa device mo lang.',
    termsTitle: 'Terms',
    termsBody: 'Biyaherong Coach is for learning and enjoying chess. Play fair, be kind, and have '
      + 'fun.\n\nThe app is provided as-is for practice and study. Chess piece artwork is licensed '
      + 'CC BY-SA, the Nunito typeface under the SIL Open Font License, and the opening names '
      + 'under CC0.\n\nMaglaro nang patas. Mag-enjoy!'
  };

  var TOPICS = ['privacy', 'terms'];
  function legalTitle(topic) { return topic === 'privacy' ? STRINGS.privacyTitle : STRINGS.termsTitle; }
  function legalBody(topic) { return topic === 'privacy' ? STRINGS.privacyBody : STRINGS.termsBody; }

  /* -- the store (mirrors LoginStore.swift) --
   *
   * `storage` is injectable so the state machine is testable with no localStorage, exactly as the
   * Swift takes a `CoachGame.Storage`. Every access is wrapped: localStorage throws on some
   * file:// configurations and a login screen that cannot read a key must still open.
   */
  function memoryStorage(seed) {
    var values = {};
    if (seed) { Object.keys(seed).forEach(function (k) { values[k] = seed[k]; }); }
    return {
      writes: 0,
      removals: 0,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null; },
      setItem: function (k, v) { values[k] = v; this.writes++; },
      removeItem: function (k) { delete values[k]; this.removals++; },
      keys: function () { return Object.keys(values); }
    };
  }

  function defaultStorage() {
    return (typeof localStorage !== 'undefined') ? localStorage : null;
  }

  function createStore(storage) {
    var s = storage === undefined ? defaultStorage() : storage;
    var raw = null;
    try { raw = s ? s.getItem(SESSION.storageKey) : null; } catch (e) { raw = null; }
    /* Fail closed: anything the predicate does not recognise is a signed-out session, not a
     * trusted one. A half-written or hand-edited key shows the login screen. */
    var provider = isSignedIn(raw) ? raw : null;

    return {
      provider: function () { return provider; },
      isSignedIn: function () { return isSignedIn(provider); },
      providerLabel: function () { return providerLabel(provider); },
      displayName: function () { return STRINGS.defaultDisplayName; },
      /** Idempotent, and it refuses a provider the predicate does not know. */
      signIn: function (p) {
        if (p === undefined) p = SESSION.appleProvider;
        if (!isSignedIn(p) || provider === p) return false;
        provider = p;
        try { if (s) s.setItem(SESSION.storageKey, p); } catch (e) { /* ignore */ }
        return true;
      },
      /** REMOVES the key rather than blanking it, so a later read is a clean miss. */
      signOut: function () {
        if (provider === null) return false;
        provider = null;
        try { if (s) s.removeItem(SESSION.storageKey); } catch (e) { /* ignore */ }
        return true;
      }
    };
  }

  /* The one the app shell uses. A module-level singleton so the Profile tab's Sign out and the
   * login screen are looking at the same session, the way `@StateObject` on `PhoneApp` is one
   * `LoginStore` for the whole phone. */
  var session = null;
  function shared() { return session || (session = createStore()); }

  /* ===================== self-test ===================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function expectNear(a, b, what, tol) {
      expect(Math.abs(a - b) <= (tol === undefined ? 0.01 : tol), what + ': got ' + a + ', expected ' + b);
    }
    function expectEqual(a, b, what) { expect(a === b, what + ': got "' + a + '", expected "' + b + '"'); }

    /* 1. typography */
    expectNear(line(TYPE.titleSize), 41, 'title line box');
    expectNear(line(TYPE.taglineSize), 19, 'tagline line box');
    expectNear(line(TYPE.reassureSize), 18, 'reassurance line box');
    expectNear(line(TYPE.legalSize), 15, 'legal line box');
    expect(TYPE.titleSize > TYPE.buttonLabelSize, 'the brand title outranks the button label');
    expect(TYPE.buttonLabelSize > TYPE.taglineSize, 'the button label outranks the tagline');
    expect(TYPE.taglineSize > TYPE.reassureSize, 'the tagline outranks the reassurance line');
    expect(TYPE.reassureSize > TYPE.legalSize, 'the reassurance line outranks the legal footer');

    /* 2. the band budget */
    var fixed = fixedHeight();
    expectNear(fixed, 413, 'fixed bands total');
    expect(fixed + LAYOUT.minSpacer <= LAYOUT.shortestSupportedHeight,
      'the fixed bands + the minimum spacer fit an iPhone SE');
    expect(spacerFor(LAYOUT.shortestSupportedHeight) >= LAYOUT.minSpacer,
      'the spacer never drops below its floor on the shortest phone');
    expectNear(spacerFor(100), LAYOUT.minSpacer, 'spacer clamps to its floor on an absurdly short screen');
    expect(spacerFor(812) > spacerFor(667), 'a taller screen gives the spacer more room');
    // The leftover is split, never lost: hero-top's share plus the spacer's share IS the leftover.
    [667, 812, 852, 932].forEach(function (h) {
      expectNear(heroTopFor(h) - LAYOUT.heroTopPadding + spacerFor(h), leftoverFor(h),
        'the leftover is fully distributed at ' + h + 'pt', 1);
      expectNear(heroTopFor(h) - LAYOUT.heroTopPadding,
        Math.round(leftoverFor(h) * LAYOUT.spacerTopShare), 'hero-top share at ' + h + 'pt');
    });
    expectNear(heroTopFor(100), LAYOUT.heroTopPadding,
      'with no leftover the hero sits exactly on its floor');
    // The proportion is what makes the screen look the same on every phone.
    expect(Math.abs((heroTopFor(667) + LAYOUT.logoSize / 2) / 667
      - (heroTopFor(932) + LAYOUT.logoSize / 2) / 932) < 0.02,
    'the logo lands at the same fraction of the screen on the shortest and tallest phones');
    expect(LAYOUT.spacerTopShare > 0 && LAYOUT.spacerTopShare < 0.5,
      'the hero sits above optical centre, where the eye expects it');

    /* 3. shape */
    expect(LAYOUT.buttonHeight >= 44, "the Apple button clears Apple's 44pt minimum target");
    expect(LAYOUT.logoRadius < LAYOUT.logoSize / 2, 'the logo is a squircle, not a circle');
    expect(LAYOUT.entranceScale < 1, 'the hero grows into place');

    /* 4. palette — the two colours that must never be retinted */
    expectEqual(PALETTE.appleFill, '#FFFFFF', 'the Apple button is pure white');
    expectEqual(PALETTE.appleInk, '#000000', 'the Apple mark and label are pure black');
    expect(PALETTE.appleFill !== PALETTE.title && PALETTE.appleInk !== PALETTE.title,
      'the Apple button is never recoloured to the app accent');
    expectEqual(PALETTE.legal, '#3A5070', "the legal footer keeps the RN screen's colour");
    expectEqual(PALETTE.screenBg, '#0F1A2E', 'the screen is the app background');
    expectEqual(PALETTE.title, '#FDB022', 'the brand title is gold');

    /* 5. timing */
    expect(TIMING.heroEntranceDelay < TIMING.textEntranceDelay, 'the logo lands before the words');
    expect(TIMING.textEntranceDelay < TIMING.buttonEntranceDelay, 'the words land before the button');
    expect(TIMING.signInFadeSeconds > 0 && TIMING.signInFadeSeconds <= 0.5,
      'the sign-in cross-fade stays immediate');
    expect(TIMING.heroDamping > 0 && TIMING.heroDamping < 1, 'the hero spring does not ring');

    /* 6. the drift field */
    expect(DRIFT.length === 8, 'eight drifting pieces (got ' + DRIFT.length + ')');
    var KNOWN = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    DRIFT.forEach(function (spec, i) {
      expect(spec.x > 0 && spec.x < 1, 'spec ' + i + ' x is a fraction inside the container');
      expect(spec.y > 0 && spec.y < 1, 'spec ' + i + ' y is a fraction inside the container');
      expect(spec.size > 0 && spec.travel > 0 && spec.seconds > 0,
        'spec ' + i + ' has a real size, travel and duration');
      expect(spec.delay >= 0, 'spec ' + i + ' delay is not negative');
      expect(spec.opacity > 0 && spec.opacity <= 0.08, 'spec ' + i + ' stays faint');
      expect(spec.x < 0.30 || spec.x > 0.70, 'spec ' + i + ' stays out of the hero column');
      expect(spec.y < 0.80, 'spec ' + i + ' stays above the action band');
      expect(KNOWN.indexOf(spec.kind) >= 0, 'spec ' + i + ' names a real piece (' + spec.kind + ')');
      expect(spec.seconds > TIMING.buttonEntranceSeconds, 'drift is slower than the entrance');
    });
    var pts = DRIFT.map(function (s) { return s.x + ',' + s.y; });
    expect(pts.filter(function (p, i) { return pts.indexOf(p) === i; }).length === pts.length,
      'no two pieces share a position');
    expect(DRIFT.some(function (s) { return s.white; }) && DRIFT.some(function (s) { return !s.white; }),
      'both colours appear in the field');
    var mapped = driftPoint(DRIFT[0], { width: 392, height: 812 });
    expectNear(mapped.x, 392 * DRIFT[0].x, 'drift point maps x by the container width');
    expectNear(mapped.y, 812 * DRIFT[0].y, 'drift point maps y by the container height');
    var kinds = usedKinds();
    expect(kinds.join(',') === kinds.slice().sort().join(','), 'usedKinds is sorted');
    expect(kinds.filter(function (k, i) { return kinds.indexOf(k) === i; }).length === kinds.length,
      'usedKinds is unique');

    /* 7. the session predicate */
    expect(!isSignedIn(null), 'a missing key is signed out');
    expect(!isSignedIn(undefined), 'an undefined value is signed out');
    expect(!isSignedIn(''), 'an empty value is signed out');
    expect(!isSignedIn('0'), 'a zero value is signed out');
    expect(!isSignedIn('google'), 'an unknown provider is signed out');
    expect(!isSignedIn('APPLE'), 'the provider check is case-sensitive');
    expect(!isSignedIn(' apple'), 'a padded value is signed out, not trimmed');
    expect(isSignedIn(SESSION.appleProvider), '"apple" is signed in');
    expectEqual(providerLabel('apple'), STRINGS.appleProviderLabel, 'provider label for apple');
    expectEqual(providerLabel(null), STRINGS.noProviderLabel, 'provider label when signed out');
    expectEqual(providerLabel('google'), STRINGS.noProviderLabel, 'provider label for an unknown provider');
    expectEqual(SESSION.storageKey, 'biya.auth.session.v1',
      'the storage key keeps the biya.<area>.<thing>.v1 shape');

    /* 8. the store, through an in-memory storage */
    var mem = memoryStorage();
    var fresh = createStore(mem);
    expect(!fresh.isSignedIn(), 'a fresh install starts signed out');
    expect(mem.keys().length === 0, 'constructing the store writes nothing');

    expect(fresh.signIn() === true, 'signing in reports a change');
    expect(fresh.isSignedIn(), 'signing in opens the session');
    expectEqual(mem.getItem(SESSION.storageKey), SESSION.appleProvider, 'the provider is persisted');
    expect(mem.writes === 1, 'signing in writes exactly once (got ' + mem.writes + ')');
    expect(fresh.signIn() === false, 'signing in twice is idempotent');
    expect(mem.writes === 1, 'signing in twice writes once (got ' + mem.writes + ')');

    var resumed = createStore(mem);
    expect(resumed.isSignedIn(), 'a later launch resumes the session');
    expectEqual(resumed.providerLabel(), STRINGS.appleProviderLabel, 'the resumed provider label');

    expect(fresh.signOut() === true, 'signing out reports a change');
    expect(!fresh.isSignedIn(), 'signing out closes the session');
    expect(mem.getItem(SESSION.storageKey) === null, 'signing out REMOVES the key');
    expect(mem.removals === 1, 'signing out removes exactly once (got ' + mem.removals + ')');
    expect(fresh.signOut() === false, 'signing out twice is idempotent');
    expect(mem.removals === 1, 'signing out twice removes once (got ' + mem.removals + ')');
    expect(!createStore(mem).isSignedIn(), 'the next launch is signed out again');

    var garbage = memoryStorage({ 'biya.auth.session.v1': 'yes' });
    expect(!createStore(garbage).isSignedIn(), 'an unrecognised stored value fails closed');
    var blank = memoryStorage({ 'biya.auth.session.v1': '' });
    expect(!createStore(blank).isSignedIn(), 'a blank stored value fails closed');
    var refuse = memoryStorage();
    var refusing = createStore(refuse);
    refusing.signIn('google');
    expect(!refusing.isSignedIn() && refuse.keys().length === 0,
      'an unknown provider is refused, not stored');
    /* A storage that throws on every access must not stop the screen from opening. */
    var hostile = {
      getItem: function () { throw new Error('blocked'); },
      setItem: function () { throw new Error('blocked'); },
      removeItem: function () { throw new Error('blocked'); }
    };
    var blocked = createStore(hostile);
    expect(!blocked.isSignedIn(), 'a blocked storage reads as signed out');
    expect(blocked.signIn() === true, 'a blocked storage still signs in for this session');

    /* 9. copy */
    expectEqual(STRINGS.title, 'Biyaherong Coach', 'brand title');
    expectEqual(STRINGS.tagline, 'Kabiyahe mo sa pag improve!', "the original app's tagline");
    expectEqual(STRINGS.appleButton, 'Continue with Apple', "the Apple button's wording");
    expect(STRINGS.reassurance.length > 0, 'the reassurance line exists');
    expectEqual(STRINGS.defaultDisplayName, 'Biyahero', "the player's display name");
    TOPICS.forEach(function (t) {
      expect(legalTitle(t).length > 0, t + ' sheet has a title');
      expect(legalBody(t).length > 100, t + ' sheet has real text');
      expect(legalBody(t).indexOf('http') < 0, t + ' text contains no URL');
    });
    expect(legalTitle('privacy') !== legalTitle('terms'), 'the two sheets are distinguishable');
    expect(legalBody('privacy') !== legalBody('terms'), 'the two sheets say different things');
    expect(TOPICS.length === 2, 'two legal topics');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'BiyaLogin: ' + passed + ' assertions passed'
        : 'BiyaLogin: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  /* ===================== view ===================== */

  var BRAND = 'assets/images/brand-logo.png';
  var BRAND_FALLBACK = 'assets/images/app-icon.png';
  var PIECES = 'assets/pieces/';

  /* Apple's mark, as the official single-path glyph. Never recoloured — `currentColor` is only
   * ever the button's black ink. */
  var APPLE_PATH = 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 '
    + '3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 '
    + '1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415'
    + '-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39'
    + '-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662'
    + '.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

  /** `#RRGGBB` + an alpha → the `rgba()` the stylesheet needs. */
  function rgbaOf(hex, alpha) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', '
      + parseInt(h.slice(4, 6), 16) + ', ' + alpha + ')';
  }

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  /**
   * Pushes every number onto the screen root as a `--lg-*` custom property, so the CSS reads the
   * same table the self-test asserts instead of a second hand-typed copy. Same technique as
   * `BiyaHome.applyMetrics`.
   */
  function applyMetrics(root) {
    var s = root.style;
    s.setProperty('--lg-pad-h', LAYOUT.screenPaddingH + 'px');
    s.setProperty('--lg-hero-top', LAYOUT.heroTopPadding + 'px');
    s.setProperty('--lg-logo', LAYOUT.logoSize + 'px');
    s.setProperty('--lg-logo-radius', LAYOUT.logoRadius + 'px');
    s.setProperty('--lg-logo-ring', LAYOUT.logoRingWidth + 'px');
    s.setProperty('--lg-logo-glow', LAYOUT.logoGlowRadius + 'px');
    // The glow's colour and its alpha come from two different tables, so they are combined HERE
    // rather than re-typed as one literal in the stylesheet — CSS cannot apply an alpha to a
    // colour variable without `color-mix`, which is newer than this demo needs to be.
    s.setProperty('--lg-logo-glow-shadow', rgbaOf(PALETTE.logoGlow, LAYOUT.logoGlowOpacity));
    s.setProperty('--lg-hero-gap', LAYOUT.heroSpacing + 'px');
    s.setProperty('--lg-title-gap', LAYOUT.titleTaglineGap + 'px');
    s.setProperty('--lg-btn-h', LAYOUT.buttonHeight + 'px');
    s.setProperty('--lg-btn-radius', LAYOUT.buttonRadius + 'px');
    s.setProperty('--lg-btn-glyph', LAYOUT.buttonGlyphSize + 'px');
    s.setProperty('--lg-btn-gap', LAYOUT.buttonGlyphGap + 'px');
    s.setProperty('--lg-btn-shadow', LAYOUT.buttonShadowRadius + 'px');
    s.setProperty('--lg-btn-shadow-y', LAYOUT.buttonShadowY + 'px');
    s.setProperty('--lg-pressed', String(LAYOUT.pressedButton));
    s.setProperty('--lg-reassure-gap', LAYOUT.reassureTopGap + 'px');
    s.setProperty('--lg-footer-gap', LAYOUT.footerTopGap + 'px');
    s.setProperty('--lg-footer-bottom', LAYOUT.footerBottomPadding + 'px');
    s.setProperty('--lg-legal-gap', LAYOUT.legalGap + 'px');
    s.setProperty('--lg-spacer-min', LAYOUT.minSpacer + 'px');
    // The 35 / 65 split, as flex-grow weights over a zero basis — the browser's spelling of
    // `LoginLayout.heroTop` + the `Spacer` beneath it.
    s.setProperty('--lg-grow-top', String(Math.round(LAYOUT.spacerTopShare * 100)));
    s.setProperty('--lg-grow-bottom', String(Math.round((1 - LAYOUT.spacerTopShare) * 100)));
    s.setProperty('--lg-glow-end', LAYOUT.glowEndRadius + 'px');
    s.setProperty('--lg-entrance-scale', String(LAYOUT.entranceScale));
    s.setProperty('--lg-rise', LAYOUT.entranceRise + 'px');
    s.setProperty('--lg-title-size', TYPE.titleSize + 'px');
    s.setProperty('--lg-title-track', TYPE.titleTracking + 'px');
    s.setProperty('--lg-tagline-size', TYPE.taglineSize + 'px');
    s.setProperty('--lg-btn-size', TYPE.buttonLabelSize + 'px');
    s.setProperty('--lg-btn-track', TYPE.buttonTracking + 'px');
    s.setProperty('--lg-reassure-size', TYPE.reassureSize + 'px');
    s.setProperty('--lg-legal-size', TYPE.legalSize + 'px');
    s.setProperty('--lg-hero-secs', TIMING.heroEntranceSeconds + 's');
    s.setProperty('--lg-hero-delay', TIMING.heroEntranceDelay + 's');
    s.setProperty('--lg-text-secs', TIMING.textEntranceSeconds + 's');
    s.setProperty('--lg-text-delay', TIMING.textEntranceDelay + 's');
    s.setProperty('--lg-btn-secs', TIMING.buttonEntranceSeconds + 's');
    s.setProperty('--lg-btn-delay', TIMING.buttonEntranceDelay + 's');
    s.setProperty('--lg-fade-secs', TIMING.signInFadeSeconds + 's');
    s.setProperty('--lg-sheet-secs', TIMING.sheetFadeSeconds + 's');
    s.setProperty('--lg-sheet-w', LAYOUT.sheetWidth + 'px');
    s.setProperty('--lg-sheet-radius', LAYOUT.sheetRadius + 'px');
    s.setProperty('--lg-sheet-pad', LAYOUT.sheetPadding + 'px');
    s.setProperty('--lg-sheet-max', LAYOUT.sheetMaxBodyHeight + 'px');
    s.setProperty('--lg-sheet-title-gap', LAYOUT.sheetTitleGap + 'px');
    s.setProperty('--lg-sheet-body-gap', LAYOUT.sheetBodyGap + 'px');
    s.setProperty('--lg-sheet-close-h', LAYOUT.sheetCloseHeight + 'px');
    s.setProperty('--lg-sheet-close-radius', LAYOUT.sheetCloseRadius + 'px');
    s.setProperty('--lg-sheet-title-size', TYPE.sheetTitleSize + 'px');
    s.setProperty('--lg-sheet-body-size', TYPE.sheetBodySize + 'px');
    s.setProperty('--lg-sheet-close-size', TYPE.sheetCloseSize + 'px');
    s.setProperty('--lg-sheet-line', LAYOUT.sheetLineSpacing + 'px');
    // Colours too, so the stylesheet reads the one PALETTE table instead of holding a second copy
    // of the same hexes. `replay_login.js` audits every --lg-* in both directions, which is what
    // makes that a guarantee rather than a habit.
    s.setProperty('--lg-glow-inner', PALETTE.glowInner);
    s.setProperty('--lg-glow-outer', PALETTE.glowOuter);
    s.setProperty('--lg-logo-ring-color', PALETTE.logoRing);
    s.setProperty('--lg-title-color', PALETTE.title);
    s.setProperty('--lg-tagline-color', PALETTE.tagline);
    s.setProperty('--lg-reassure-color', PALETTE.reassure);
    s.setProperty('--lg-apple-fill', PALETTE.appleFill);
    s.setProperty('--lg-apple-ink', PALETTE.appleInk);
    s.setProperty('--lg-apple-shadow', PALETTE.appleShadow);
    s.setProperty('--lg-legal-color', PALETTE.legal);
    s.setProperty('--lg-scrim', PALETTE.sheetScrim);
    s.setProperty('--lg-sheet-fill', PALETTE.sheetFill);
    s.setProperty('--lg-sheet-border', PALETTE.sheetBorder);
    s.setProperty('--lg-sheet-title-color', PALETTE.sheetTitle);
    s.setProperty('--lg-sheet-body-color', PALETTE.sheetBody);
  }

  function driftLayer() {
    var wrap = el('div', 'lg-drift');
    DRIFT.forEach(function (spec) {
      var img = el('img', 'lg-piece');
      img.src = pieceSrc(spec);
      img.alt = '';
      img.style.left = (spec.x * 100) + '%';
      img.style.top = (spec.y * 100) + '%';
      img.style.width = spec.size + 'px';
      img.style.opacity = String(spec.opacity);
      img.style.setProperty('--lg-travel', spec.travel + 'px');
      img.style.animationDuration = spec.seconds + 's';
      img.style.animationDelay = spec.delay + 's';
      wrap.appendChild(img);
    });
    return wrap;
  }

  function legalSheet(root, topic) {
    // At most ONE sheet, ever. The Swift holds a single optional `legalTopic`, so tapping Terms
    // while Privacy is open swaps it there; appending here without this would STACK them, and
    // closing would peel one off and leave the other behind.
    var open = root.querySelector('.lg-sheet');
    if (open) root.removeChild(open);
    var sheet = el('div', 'lg-sheet');
    var body = legalBody(topic).split('\n\n').map(function (p) {
      return '<p>' + p + '</p>';
    }).join('');
    sheet.innerHTML =
      '<div class="lg-scrim"></div>' +
      '<div class="lg-sheet-card" role="dialog" aria-modal="true">' +
      '<div class="lg-sheet-title">' + legalTitle(topic) + '</div>' +
      '<div class="lg-sheet-body">' + body + '</div>' +
      '<button class="lg-sheet-close" type="button">' + STRINGS.sheetClose + '</button>' +
      '</div>';
    function close() { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); }
    sheet.querySelector('.lg-scrim').onclick = close;
    sheet.querySelector('.lg-sheet-close').onclick = close;
    root.appendChild(sheet);
  }

  /**
   * Leaf renderer: owns its own clear of #view, per the contract in docs/web-demo.md.
   * `onSignedIn` is raised after the simulated sign-in has been persisted; the shell owns the
   * transition to the dashboard, the same split the Swift uses.
   */
  function render(view, onSignedIn) {
    view.scrollTop = 0;
    view.innerHTML = '';

    var root = el('div', 'lg-view');
    applyMetrics(root);
    root.appendChild(el('div', 'lg-glow'));
    root.appendChild(driftLayer());

    var content = el('div', 'lg-content');

    var hero = el('div', 'lg-hero');
    hero.innerHTML =
      '<span class="lg-logo"><img src="' + BRAND + '" alt="' + STRINGS.title + '" ' +
      'onerror="this.onerror=null;this.src=\'' + BRAND_FALLBACK + '\'"></span>' +
      '<div class="lg-words">' +
      '<div class="lg-title">' + STRINGS.title + '</div>' +
      '<div class="lg-tagline">' + STRINGS.tagline + '</div>' +
      '</div>';
    // Two flexible bands, not one. The hero used to sit on its 64px floor with all the leftover
    // below it, which on a tall phone read as two disconnected clusters.
    content.appendChild(el('div', 'lg-spacer-top'));
    content.appendChild(hero);
    content.appendChild(el('div', 'lg-spacer'));

    var actions = el('div', 'lg-actions');
    var btn = el('button', 'lg-apple');
    btn.type = 'button';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="'
      + APPLE_PATH + '"/></svg><span>' + STRINGS.appleButton + '</span>';
    btn.onclick = function () {
      shared().signIn();
      if (onSignedIn) onSignedIn();
    };
    actions.appendChild(btn);
    actions.appendChild(el('div', 'lg-reassure', STRINGS.reassurance));

    var legal = el('div', 'lg-legal');
    TOPICS.forEach(function (topic, i) {
      if (i > 0) legal.appendChild(el('span', 'lg-legal-sep', STRINGS.legalSeparator));
      var link = el('button', 'lg-legal-link', legalTitle(topic));
      link.type = 'button';
      link.onclick = function () { legalSheet(root, topic); };
      legal.appendChild(link);
    });
    actions.appendChild(legal);
    content.appendChild(actions);

    root.appendChild(content);
    view.appendChild(root);
  }

  return {
    // pure
    TYPE: TYPE, PALETTE: PALETTE, LAYOUT: LAYOUT, TIMING: TIMING, DRIFT: DRIFT,
    STRINGS: STRINGS, SESSION: SESSION, TOPICS: TOPICS,
    line: line, fixedHeight: fixedHeight, spacerFor: spacerFor,
    leftoverFor: leftoverFor, heroTopFor: heroTopFor,
    driftPoint: driftPoint, usedKinds: usedKinds,
    isSignedIn: isSignedIn, providerLabel: providerLabel,
    AUTH_PHASES: AUTH_PHASES, AUTH_EVENTS: AUTH_EVENTS, SIMULATED_AUTH: SIMULATED_AUTH,
    ACCOUNT_DATA: ACCOUNT_DATA,
    authNext: authNext, authShowsError: authShowsError, authIsBusy: authIsBusy,
    legalTitle: legalTitle, legalBody: legalBody,
    createStore: createStore, memoryStorage: memoryStorage, shared: shared,
    selfTest: selfTest,
    // view
    render: render
  };
})();

/* Makes the pure layer runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaLogin; }
