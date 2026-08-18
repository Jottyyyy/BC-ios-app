/* premium.js — the browser mirror of Sources/BiyaherongCoachCore/Entitlement.swift
 *                                  + DemoApp/Sources/BiyaherongUI/PaywallScreen.swift
 *
 * The subscription entitlement, the free tier's daily counters, and the paywall screen.
 *
 * The top half is the PURE layer and is a line-for-line mirror of `Entitlement.swift` — the trial,
 * the expiry, the grace window, the monotonic clock floor and every cap. `BiyaPremium.selfTest()`
 * asserts it, and because the file exports itself under Node it can also be run headlessly:
 *
 *     node -e "console.log(require('./web-demo/js/premium.js').selfTest().summary)"
 *
 * `tools/qa/replay_premium.js` asserts these constants against the Swift ones. Keep them in
 * lockstep — a divergence between them is exactly the drift this mirror exists to catch.
 *
 * THE STORE HERE IS SIMULATED. There is no StoreKit in a browser, so `createStore` drives the same
 * state machine off a snapshot you can move by hand — which is the point: the whole lifecycle
 * (free → trial → active → expired → grace → free) is demonstrable on Windows without a device,
 * a sandbox account or a month of waiting.
 *
 * On the Swift side the sign-in path is equally offline: `Transaction.currentEntitlements` is
 * served from the device's own cache and Apple already signed every transaction in it. See
 * docs/subscription.md.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
'use strict';

var BiyaPremium = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var LIMITS = isNode ? require('./daily-limits.js') : BiyaDailyLimits;

  /* ===================== pure layer (mirrors Entitlement.swift) ===================== */

  var CONST = {
    /* Seven, not the spec's fourteen: the product is MONTHLY and fourteen days is half a billing
       cycle. Deviation recorded in PORTING_NOTES.md. */
    graceDays: 7,
    trialDays: 7,
    /* The one invented cap. Everything else comes from the PHP-pinned DailyLimits table. */
    reviewsPerDay: 3,
    freeCoachLevels: 2,
    freeMaxRounds: 3,
    premiumMaxRounds: 30,
    msPerDay: 86400000
  };

  var MODE = {
    regular: 'regular',
    streak: 'streak',
    coach: 'coach',
    review: 'review',
    /* Puzzle Turbo is counted PER MODE — one free run of each per day, not one in total. */
    rush: function (minutes) { return 'rush_' + minutes; }
  };
  MODE.all = [MODE.regular, MODE.streak, MODE.coach, MODE.review,
              MODE.rush(0), MODE.rush(3), MODE.rush(5)];

  /** Delegates to the PHP-pinned table for everything but `review`. */
  function maxUses(mode) {
    return mode === MODE.review ? CONST.reviewsPerDay : LIMITS.maxUses(mode);
  }

  /** A fresh install: nothing known, nothing claimed. */
  function emptySnapshot() {
    return {
      isSubscribed: false,
      expiresAtMs: null,
      isInTrial: false,
      willAutoRenew: false,
      lastVerifiedMs: null,
      trustedFloorMs: 0
    };
  }

  /**
   * The clock, floored by the highest Apple-signed timestamp ever seen. Device time is
   * attacker-controlled; a server-signed `signedDate` is not.
   */
  function trustedNow(deviceNow, floor) { return Math.max(deviceNow, floor); }

  /** Whole days, rounded UP, on calendar-day boundaries; never 0 while any time remains. */
  function daysRemaining(untilMs, nowMs) {
    if (!(untilMs > nowMs)) return 0;
    var a = new Date(nowMs); a.setHours(0, 0, 0, 0);
    var b = new Date(untilMs); b.setHours(0, 0, 0, 0);
    var whole = Math.round((b.getTime() - a.getTime()) / CONST.msPerDay);
    return Math.max(1, whole);
  }

  /** `.premium` / `.grace` / `.free`, as a tagged object. */
  function access(kind, extra) {
    var a = { kind: kind, trial: false, daysLeft: 0 };
    if (extra) { if (extra.trial !== undefined) a.trial = extra.trial;
                 if (extra.daysLeft !== undefined) a.daysLeft = extra.daysLeft; }
    return a;
  }

  /** Everything premium unlocks is unlocked in grace too — one predicate, so no gate forgets. */
  function isPremiumAccess(a) { return a.kind === 'premium' || a.kind === 'grace'; }

  /** The whole state machine. The only place these rules live. */
  function resolve(s, now) {
    var t = trustedNow(now, s.trustedFloorMs);

    /* FAIL CLOSED. An auto-renewable subscription always carries an expiry, so a snapshot claiming
       one without a date is not something StoreKit produced — it is a fresh install, a half-written
       file, or a hand-edited one. Trusting `isSubscribed` alone would hand out permanent premium to
       anyone who can write two words into localStorage. */
    if (s.expiresAtMs === null || s.expiresAtMs === undefined) return access('free');
    if (t < s.expiresAtMs) {
      return s.isSubscribed ? access('premium', { trial: s.isInTrial }) : access('free');
    }
    /* Lapsed. Auto-renew OFF means the user turned it off and knew this date was coming — the
       expiry is final. Grace exists for the subscriber who cannot reach Apple, not the one who
       cancelled. */
    if (!s.willAutoRenew) return access('free');

    var graceEnd = s.expiresAtMs + CONST.graceDays * CONST.msPerDay;
    if (t >= graceEnd) return access('free');
    return access('grace', { daysLeft: daysRemaining(graceEnd, t) });
  }

  /* -- gates that are not counted -- */
  function isThematicLocked(isPremium) { return !isPremium; }
  function isCoachLocked(level, isPremium) { return !isPremium && level > CONST.freeCoachLevels; }
  function maxSwissRounds(isPremium) {
    return isPremium ? CONST.premiumMaxRounds : CONST.freeMaxRounds;
  }

  /* -- daily usage -- */
  function usageKey(day, mode) { return day + '|' + mode; }
  function dayKey(nowMs) { return LIMITS.dayKey(nowMs); }
  function emptyUsage() { return { counts: {} }; }

  function used(u, mode, now) {
    var k = usageKey(dayKey(now), mode);
    return Object.prototype.hasOwnProperty.call(u.counts, k) ? u.counts[k] : 0;
  }

  /**
   * Records one use and returns the new count. Called when a run STARTS, never on a solve — the RN
   * original bumped after the puzzle was fetched, so a failed attempt still consumes a free use.
   */
  function record(u, mode, now) {
    var k = usageKey(dayKey(now), mode);
    var next = used(u, mode, now) + 1;
    u.counts[k] = next;
    prune(u, now);
    return next;
  }

  function isAtLimit(u, mode, isPremium, now) {
    if (isPremium) return false;
    if (mode === MODE.review) return used(u, mode, now) >= CONST.reviewsPerDay;
    return LIMITS.isAtDailyLimit(mode, used(u, mode, now), false);
  }

  /** Uses left today, or `null` when unlimited. */
  function remaining(u, mode, isPremium, now) {
    if (isPremium) return null;
    return Math.max(0, maxUses(mode) - used(u, mode, now));
  }

  /** Drops every day but today and yesterday, so the map cannot grow forever. */
  function prune(u, now) {
    var today = dayKey(now), yesterday = dayKey(now - CONST.msPerDay);
    var kept = {};
    Object.keys(u.counts).forEach(function (k) {
      var day = k.split('|')[0];
      if (day === today || day === yesterday) kept[k] = u.counts[k];
    });
    u.counts = kept;
  }

  /* ===================== the store (mirrors PremiumStore.swift) ===================== */

  var SESSION = {
    /* Same biya.<area>.<thing>.v1 shape as biya.auth.session.v1. */
    snapshotKey: 'biya.store.subscription.v1',
    usageKey: 'biya.store.usage.v1'
  };

  function memoryStorage(seed) {
    var values = {};
    if (seed) { Object.keys(seed).forEach(function (k) { values[k] = seed[k]; }); }
    return {
      writes: 0,
      removals: 0,
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
      },
      setItem: function (k, v) { values[k] = v; this.writes++; },
      removeItem: function (k) { delete values[k]; this.removals++; },
      keys: function () { return Object.keys(values); }
    };
  }

  function defaultStorage() {
    return (typeof localStorage !== 'undefined') ? localStorage : null;
  }

  function readJSON(s, key, fallback) {
    try {
      var raw = s ? s.getItem(key) : null;
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(s, key, value) {
    try { if (s) s.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  /**
   * `storage` and `clock` are injectable so the whole lifecycle is testable with no localStorage
   * and no waiting — the Swift takes a `CoachGame.Storage` for exactly the same reason.
   */
  function createStore(storage, clock) {
    var s = storage === undefined ? defaultStorage() : storage;
    var nowFn = clock || function () { return Date.now(); };

    var snap = Object.assign(emptySnapshot(), readJSON(s, SESSION.snapshotKey, {}));
    var usage = { counts: (readJSON(s, SESSION.usageKey, {}).counts) || {} };

    function persistSnap() { writeJSON(s, SESSION.snapshotKey, snap); }
    function persistUsage() { writeJSON(s, SESSION.usageKey, usage); }

    var api = {
      now: function () { return nowFn(); },
      snapshot: function () { return Object.assign({}, snap); },
      access: function () { return resolve(snap, nowFn()); },
      isPremium: function () { return isPremiumAccess(resolve(snap, nowFn())); },
      isInTrial: function () { return resolve(snap, nowFn()).trial; },
      graceDaysLeft: function () {
        var a = resolve(snap, nowFn());
        return a.kind === 'grace' ? a.daysLeft : 0;
      },
      expiresAt: function () { return snap.expiresAtMs; },
      willAutoRenew: function () { return snap.willAutoRenew; },

      /** Applies what a refresh saw. The clock floor only ever moves forward. */
      apply: function (next, signedAtMs) {
        snap = Object.assign(emptySnapshot(), next);
        snap.lastVerifiedMs = nowFn();
        snap.trustedFloorMs = Math.max(snap.trustedFloorMs,
                                       signedAtMs === undefined ? nowFn() : signedAtMs);
        persistSnap();
        return api.access();
      },

      /* -- simulated purchases. The Swift calls StoreKit here; the browser cannot. -- */
      startTrial: function () {
        var t = nowFn();
        return api.apply({ isSubscribed: true, isInTrial: true, willAutoRenew: true,
                           expiresAtMs: t + CONST.trialDays * CONST.msPerDay }, t);
      },
      subscribe: function () {
        var t = nowFn();
        return api.apply({ isSubscribed: true, isInTrial: false, willAutoRenew: true,
                           expiresAtMs: t + 30 * CONST.msPerDay }, t);
      },
      /** Auto-renew off: access runs to the expiry and then ends, with no grace. */
      cancel: function () {
        snap.willAutoRenew = false;
        persistSnap();
        return api.access();
      },
      clear: function () {
        snap = emptySnapshot();
        try { if (s) s.removeItem(SESSION.snapshotKey); } catch (e) { /* ignore */ }
        return api.access();
      },

      /* -- usage -- */
      used: function (mode) { return used(usage, mode, nowFn()); },
      remaining: function (mode) { return remaining(usage, mode, api.isPremium(), nowFn()); },
      canUse: function (mode) { return !isAtLimit(usage, mode, api.isPremium(), nowFn()); },
      recordUse: function (mode) {
        if (api.isPremium()) return 0;
        var n = record(usage, mode, nowFn());
        persistUsage();
        return n;
      },
      resetUsage: function () {
        usage = emptyUsage();
        try { if (s) s.removeItem(SESSION.usageKey); } catch (e) { /* ignore */ }
      }
    };
    return api;
  }

  /* One store for the whole shell, the way `@StateObject` on PhoneApp is one PremiumStore. */
  var session = null;
  function shared() { return session || (session = createStore()); }

  /* ===================== self-test ===================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want));
    }
    var DAY = CONST.msPerDay;
    var T0 = new Date(2026, 7, 16, 12, 0, 0).getTime();   // a fixed noon, so no test is clock-flaky
    function snap(o) { return Object.assign(emptySnapshot(), o); }

    /* 1. constants */
    eq(CONST.graceDays, 7, 'grace is 7 days, not the spec\'s 14');
    eq(CONST.trialDays, 7, 'the trial is 7 days');
    eq(CONST.reviewsPerDay, 3, 'free users get 3 Game Reviews a day');
    eq(CONST.freeCoachLevels, 2, 'coaches 1-2 are free');
    eq(maxUses(MODE.review), 3, 'the review cap comes from here, not DailyLimits');
    eq(maxUses(MODE.regular), 5, 'the ported caps still come from DailyLimits');
    eq(maxUses(MODE.rush(3)), 1, 'each Turbo mode gets its own single run');
    expect(!Object.prototype.hasOwnProperty.call(LIMITS.CAPS, 'review'),
      'the invented cap is NOT in the PHP-pinned table');

    /* 2. resolve — the happy paths */
    eq(resolve(snap({}), T0).kind, 'free', 'a fresh install is free');
    eq(resolve(snap({ isSubscribed: true, expiresAtMs: T0 + DAY, willAutoRenew: true }), T0).kind,
      'premium', 'an unexpired subscription is premium');
    var trial = resolve(snap({ isSubscribed: true, isInTrial: true, willAutoRenew: true,
                              expiresAtMs: T0 + 3 * DAY }), T0);
    eq(trial.kind, 'premium', 'a trial is premium');
    eq(trial.trial, true, 'and it reports itself as a trial');

    /* 3. resolve — expiry, grace, and the cancel branch */
    var lapsed = { isSubscribed: true, willAutoRenew: true, expiresAtMs: T0 - DAY };
    eq(resolve(snap(lapsed), T0).kind, 'grace', 'one day past expiry with auto-renew ON is grace');
    eq(resolve(snap(lapsed), T0).daysLeft, 6, 'six of the seven grace days remain');
    eq(resolve(snap({ isSubscribed: true, willAutoRenew: true, expiresAtMs: T0 - 7 * DAY }), T0).kind,
      'free', 'grace ends after exactly 7 days');
    eq(resolve(snap({ isSubscribed: true, willAutoRenew: true,
                      expiresAtMs: T0 - 7 * DAY + 1000 }), T0).kind,
      'grace', 'one second inside the window is still grace');
    eq(resolve(snap({ isSubscribed: true, willAutoRenew: false, expiresAtMs: T0 - 1000 }), T0).kind,
      'free', 'a CANCELLED subscription gets no grace — the expiry was expected');
    eq(resolve(snap({ isSubscribed: true, willAutoRenew: false, expiresAtMs: T0 + DAY }), T0).kind,
      'premium', 'cancelled but not yet expired is still premium');
    /* The renewal-day subscriber: the whole reason grace exists. */
    expect(isPremiumAccess(resolve(snap({ isSubscribed: true, willAutoRenew: true,
                                          expiresAtMs: T0 - 60000 }), T0)),
      'a subscriber one minute past renewal, offline, keeps access');
    /* Grace is treated as premium by every gate. */
    expect(isPremiumAccess(access('grace', { daysLeft: 1 })), 'grace counts as premium');
    expect(isPremiumAccess(access('premium', {})), 'premium counts as premium');
    expect(!isPremiumAccess(access('free')), 'free does not');

    /* 4. the clock floor */
    eq(trustedNow(100, 500), 500, 'a back-dated clock is floored');
    eq(trustedNow(900, 500), 900, 'a legitimate clock passes through');
    eq(trustedNow(500, 500), 500, 'equal is fine');
    var rolled = snap({ isSubscribed: true, willAutoRenew: false, expiresAtMs: T0,
                        trustedFloorMs: T0 + DAY });
    eq(resolve(rolled, T0 - 30 * DAY).kind, 'free',
      'rolling the clock back a month does NOT resurrect an expired subscription');

    /* 5. daysRemaining — the round-UP rule the server got wrong */
    eq(daysRemaining(T0 + 3 * DAY, T0), 3, 'three whole days');
    eq(daysRemaining(T0 + 3 * DAY + DAY / 2, T0), 4, '3.5 days rounds UP to 4');
    eq(daysRemaining(T0 + 60000, T0), 1, 'under 24 hours is 1 day remaining, never 0');
    eq(daysRemaining(T0, T0), 0, 'exactly expired is 0');
    eq(daysRemaining(T0 - DAY, T0), 0, 'past expiry is 0, never negative');

    /* 6. the uncounted gates */
    expect(isThematicLocked(false) && !isThematicLocked(true), 'Thematic is a hard premium gate');
    [1, 2].forEach(function (l) {
      expect(!isCoachLocked(l, false), 'coach ' + l + ' is free');
    });
    [3, 4, 5].forEach(function (l) {
      expect(isCoachLocked(l, false), 'coach ' + l + ' is premium');
      expect(!isCoachLocked(l, true), 'coach ' + l + ' unlocks with premium');
    });
    eq(maxSwissRounds(false), 3, 'free tournaments are 3 rounds');
    eq(maxSwissRounds(true), 30, 'premium tournaments are 30 rounds');

    /* 7. usage counting */
    var u = emptyUsage();
    eq(used(u, MODE.regular, T0), 0, 'a fresh day starts at zero');
    for (var i = 1; i <= 5; i++) eq(record(u, MODE.regular, T0), i, 'use ' + i + ' counts');
    expect(isAtLimit(u, MODE.regular, false, T0), '5 of 5 exhausts the free tier');
    expect(!isAtLimit(u, MODE.regular, true, T0), 'premium is never at a limit');
    eq(remaining(u, MODE.regular, false, T0), 0, 'nothing remaining');
    eq(remaining(u, MODE.regular, true, T0), null, 'premium remaining is unlimited (null)');
    eq(remaining(u, MODE.streak, false, T0), 1, 'the streak allowance is untouched');
    /* Modes are independent, and Turbo is independent PER MODE. */
    record(u, MODE.rush(3), T0);
    expect(isAtLimit(u, MODE.rush(3), false, T0), '3-minute Turbo is used up');
    expect(!isAtLimit(u, MODE.rush(5), false, T0), '5-minute Turbo is still free');
    expect(!isAtLimit(u, MODE.rush(0), false, T0), 'infinite Turbo is still free');
    /* Reviews use the invented cap, not DailyLimits' default of 1. */
    record(u, MODE.review, T0); record(u, MODE.review, T0);
    expect(!isAtLimit(u, MODE.review, false, T0), '2 of 3 reviews is fine');
    record(u, MODE.review, T0);
    expect(isAtLimit(u, MODE.review, false, T0), '3 of 3 reviews is the cap');
    /* A new day resets everything. */
    expect(!isAtLimit(u, MODE.regular, false, T0 + DAY), 'tomorrow is a fresh allowance');

    /* 8. pruning */
    var p = emptyUsage();
    record(p, MODE.regular, T0 - 10 * DAY);
    record(p, MODE.regular, T0);
    eq(Object.keys(p.counts).length, 1, 'a 10-day-old bucket is pruned away');
    var q = emptyUsage();
    record(q, MODE.regular, T0 - DAY);
    record(q, MODE.regular, T0);
    eq(Object.keys(q.counts).length, 2, 'yesterday is kept, so a midnight rollover is not lossy');

    /* 9. the store, through an in-memory storage and a fake clock */
    var mem = memoryStorage();
    var t = T0;
    var st = createStore(mem, function () { return t; });
    eq(st.access().kind, 'free', 'a fresh store is free');
    expect(mem.keys().length === 0, 'constructing the store writes nothing');

    st.startTrial();
    expect(st.isPremium() && st.isInTrial(), 'the trial unlocks premium');
    expect(mem.getItem(SESSION.snapshotKey) !== null, 'the snapshot is persisted');
    /* A reload mid-trial resumes it. */
    expect(createStore(mem, function () { return t; }).isPremium(), 'a reload resumes the trial');

    t = T0 + 8 * DAY;   // the trial lapsed a day ago; still auto-renewing, still offline
    eq(st.access().kind, 'grace', 'a lapsed trial with auto-renew on falls into grace');
    expect(st.isPremium(), 'and grace keeps the app unlocked');

    t = T0 + 20 * DAY;  // grace is long gone
    eq(st.access().kind, 'free', 'after grace the user drops to the FREE TIER, not a dead app');
    expect(!st.isPremium(), 'and premium is off');

    st.subscribe();
    expect(st.isPremium() && !st.isInTrial(), 'subscribing after the trial is plain premium');
    st.cancel();
    expect(st.isPremium(), 'cancelling keeps access until the period ends');
    t = t + 31 * DAY;
    eq(st.access().kind, 'free', 'a cancelled subscription ends cleanly with no grace');

    /* Usage is gated by the live entitlement, not a cached flag. */
    st.clear();
    st.resetUsage();
    for (var j = 0; j < 5; j++) st.recordUse(MODE.regular);
    expect(!st.canUse(MODE.regular), 'a free user runs out');
    st.subscribe();
    expect(st.canUse(MODE.regular), 'subscribing lifts the cap immediately');
    eq(st.recordUse(MODE.regular), 0, 'premium use is not counted at all');

    /* A storage that throws on every access must not stop the app from opening. */
    var hostile = {
      getItem: function () { throw new Error('blocked'); },
      setItem: function () { throw new Error('blocked'); },
      removeItem: function () { throw new Error('blocked'); }
    };
    var blocked = createStore(hostile, function () { return T0; });
    eq(blocked.access().kind, 'free', 'a blocked storage reads as free, not as premium');
    blocked.startTrial();
    expect(blocked.isPremium(), 'and the session still works in memory');

    /* Corrupt JSON fails closed. */
    var bad = createStore(memoryStorage({ 'biya.store.subscription.v1': '{not json' }),
                          function () { return T0; });
    eq(bad.access().kind, 'free', 'unparseable stored state fails closed');
    /* FAIL CLOSED. `{"isSubscribed":true}` is two words in localStorage; without an expiry it must
       buy nothing, or the whole entitlement is one hand-edit away from being free forever. */
    var partial = createStore(memoryStorage({ 'biya.store.subscription.v1': '{"isSubscribed":true}' }),
                              function () { return T0; });
    eq(partial.access().kind, 'free', 'a subscription claim with no expiry fails closed');
    var forged = createStore(memoryStorage({
      'biya.store.subscription.v1': '{"isSubscribed":true,"willAutoRenew":true}'
    }), function () { return T0; });
    eq(forged.access().kind, 'free', 'adding willAutoRenew does not help it either');

    /* 10. copy */
    eq(STRINGS.trialCta, 'Start Your 7-Day Free Trial', 'the trial CTA names the length');
    expect(STRINGS.disclosure.indexOf('automatically renews') >= 0,
      'the App Review disclosure is present');
    expect(STRINGS.disclosure.indexOf('24 hours') >= 0, 'and names the 24-hour window');
    eq(LINKS.length, 2, 'exactly two links — the EULA and the privacy policy');
    expect(LINKS[0].url.indexOf('apple.com/legal') >= 0, 'the first is Apple\'s standard EULA');
    BENEFITS.forEach(function (b, n) {
      expect(b.emoji.length > 0 && b.text.length > 0, 'benefit ' + n + ' is filled in');
    });
    expect(BENEFITS.length >= 5, 'the paywall lists what the money buys');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'BiyaPremium: ' + passed + ' assertions passed'
        : 'BiyaPremium: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  /* ===================== paywall design (mirrors PaywallMetrics.swift) ===================== */

  var PALETTE = {
    screenBg: '#0F1A2E',
    card: '#1A2942',
    cardBorder: 'rgba(253, 176, 34, .2)',
    activeCardBorder: 'rgba(253, 176, 34, .3)',
    title: '#FDB022',
    body: '#8BA3C7',
    heading: '#FFFFFF',
    check: '#FDB022',
    cta: '#FDB022',
    ctaInk: '#0F1A2E',
    activePill: '#4CAF50',
    activePillInk: '#FFFFFF',
    daysPill: 'rgba(76, 175, 80, .15)',
    daysPillInk: '#4CAF50',
    warnFill: 'rgba(255, 138, 61, .12)',
    warnBorder: 'rgba(255, 138, 61, .5)',
    warnInk: '#FF8A3D',
    failFill: 'rgba(253, 176, 34, .08)',
    failBorder: 'rgba(253, 176, 34, .5)',
    restoreBorder: '#FDB022',
    restoreInk: '#FDB022',
    legal: '#5A6E87',
    /* Behind the lock card, wherever a gated feature raises one. */
    scrim: 'rgba(0, 0, 0, .55)'
  };

  var LAYOUT = {
    screenPaddingH: 20,
    heroPaddingV: 24,
    crownSize: 64,
    cardRadius: 16,
    cardPadding: 20,
    cardBorderWidth: 1,
    cardGap: 14,
    rowGap: 10,
    ctaHeight: 56,
    ctaRadius: 16,
    restoreHeight: 50,
    restoreRadius: 14,
    restoreBorderWidth: 1.5,
    pillRadiusH: 12,
    pillRadiusV: 6,
    pillRadius: 20,
    failRadius: 14,
    failPadding: 16,
    warnRadius: 14,
    warnPadding: 16,
    headerHeight: 52,
    logoSize: 30,
    pressed: 0.82
  };

  var TYPE = {
    headerTitleSize: 20,
    heroTitleSize: 24,
    heroBodySize: 14,
    heroBodyLineHeight: 22,
    cardTitleSize: 18,
    rowSize: 14,
    priceSize: 20,
    ctaSize: 16,
    activePillSize: 12,
    daysPillSize: 13,
    restoreSize: 14,
    restoreLinkSize: 13,
    legalSize: 11,
    legalLineHeight: 16
  };

  var TIMING = { presentSeconds: 0.28, purchaseSeconds: 0.6 };

  var STRINGS = {
    goPremium: 'Go Premium',
    premium: 'Premium',
    active: '✓ Active',
    heroTitle: 'Unlock Full Access',
    heroBody: 'Train without limits. Get the most out of Biyaherong Chess Coach.',
    planTitle: 'Biyaherong Plus',
    trialCta: 'Start Your 7-Day Free Trial',
    subscribeCta: 'Subscribe',
    trialNote: '7 days free, then {price} per month. Cancel anytime.',
    priceNote: '{price} per month. Cancel anytime.',
    loading: 'Loading…',
    restoreLink: 'Restore Purchases',
    restoreButton: 'Already paid? Restore',
    restoreNothing: "We couldn't find a purchase linked to this Apple ID.",

    failTitle: "Couldn't load subscriptions from the App Store",
    failBody: "Make sure you're signed in to the App Store under Settings → Apple ID, then retry.",
    failRetry: 'Retry',

    allSetTitle: "You're all set!",
    allSetBody: 'Every mode is unlocked. Maglaro na!',
    yourPlan: 'Your Monthly Subscription',
    activeUntil: 'Active until {date}',
    daysRemaining: '{n} days remaining',
    oneDayRemaining: '1 day remaining',
    renewalRow: 'Next Renewal Date',
    expiresRow: 'Expires On',
    autoRenewOn: 'Your subscription renews automatically via the App Store.',
    autoRenewOff: 'Auto-renewal is off. Your access ends on the expiry date.',
    manageRow: 'Manage Subscription',
    manageBody: 'To cancel or change your plan, go to Settings → Apple ID → Subscriptions.',
    manageButton: 'Manage',

    /* Grace. No RN counterpart — this state did not exist when there was a server. */
    graceTitle: "We couldn't check your subscription",
    graceBody: 'Connect to the internet within {n} days to keep Premium. You can keep playing '
      + 'the free tier either way — walang mawawala sa progress mo.',

    /* The lock card (spec §3.3), and the cap-reached copy, from UpgradePrompt.tsx. */
    lockTitle: 'Premium Feature',
    lockCta: 'See What You Get',
    resetsNote: '🔄 Free limits reset daily at midnight',
    thematicLock: 'Thematic Puzzles are a Premium feature. Upgrade to unlock all themes and train '
      + 'specific tactics anytime!',
    coachLock: 'This opponent is available to Premium members only. Upgrade to unlock all 5 coaches!',
    puzzleCap: "You've solved {used}/{limit} free puzzles today. Upgrade to Premium for unlimited "
      + 'puzzles!',
    streakCap: "You've used your 1 free streak attempt today. Upgrade to Premium for unlimited "
      + 'streak attempts!',
    rushCap: "You've used your 1 free Puzzle Rush attempt for this mode today. Upgrade to Premium "
      + 'for unlimited attempts!',
    reviewCap: "You've used your {limit} free Game Reviews today. Upgrade to Premium for unlimited "
      + 'reviews!',
    roundsCap: 'Free users can create up to {n} rounds. Upgrade to Premium for more.',

    /* Required verbatim by App Review on any auto-renewing subscription. */
    disclosure: 'Payment will be charged to your Apple ID account at confirmation of purchase. '
      + 'Subscription automatically renews unless auto-renew is turned off at least 24 hours '
      + 'before the end of the current period. Your account will be charged for renewal within '
      + '24 hours prior to the end of the current period at the same price. You can manage your '
      + 'subscriptions and turn off auto-renewal by going to your App Store account settings '
      + 'after purchase.'
  };

  /**
   * The only two URLs in the app, and both are required by App Review on an auto-renewing
   * subscription. `tools/qa/replay_premium.js` allowlists exactly these two and fails on a third.
   */
  var LINKS = [
    { label: 'Terms of Use (EULA)',
      url: 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/' },
    { label: 'Privacy Policy', url: 'https://biyaherongchesscoach.com/privacy' }
  ];

  /** Mirrors `PaywallGlyph` — named so no renderer carries a bare emoji literal. */
  var GLYPH = {
    crown: '👑', check: '✓', calendar: '📅', renew: '🔄', gear: '⚙️', lock: '🔒'
  };

  /**
   * Web-demo only, and deliberately kept OUT of `STRINGS` so the Swift/JS replay can compare that
   * table key-for-key. A browser has no `Product.displayPrice`, and hard-coding a peso figure is
   * the exact bug the RN app shipped (three different prices in one session).
   */
  var DEMO = {
    simulatedPrice: '(App Store price)',
    simulateCancel: 'Simulate: turn off auto-renew'
  };

  var BENEFITS = [
    { emoji: '♟️', text: 'Unlimited puzzles — no daily caps' },
    { emoji: '🔥', text: 'Unlimited Streak and Turbo runs' },
    { emoji: '🎯', text: 'Every themed puzzle set' },
    { emoji: '🔍', text: 'Unlimited Game Reviews' },
    { emoji: '🤖', text: 'All 5 coaches unlocked' },
    { emoji: '🏆', text: 'Tournaments up to 30 rounds' }
  ];

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : m;
    });
  }

  function daysPillText(n) {
    return n === 1 ? STRINGS.oneDayRemaining : fill(STRINGS.daysRemaining, { n: n });
  }

  /** `Sep 12, 2026` — the same frozen month table the Home banner uses. */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateText(ms) {
    var d = new Date(ms);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* ===================== view (mirrors PaywallScreen.swift) ===================== */

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  /**
   * Pushes every number AND colour onto the screen root as a `--pw-*` custom property, so the
   * stylesheet reads the one table the self-test asserts instead of a second hand-typed copy.
   * `tools/qa/replay_premium.js` audits every `--pw-*` in both directions.
   */
  function applyMetrics(root) {
    var s = root.style;
    Object.keys(LAYOUT).forEach(function (k) {
      s.setProperty('--pw-' + kebab(k), unitFor(k, LAYOUT[k]));
    });
    Object.keys(TYPE).forEach(function (k) {
      s.setProperty('--pw-t-' + kebab(k), TYPE[k] + 'px');
    });
    Object.keys(PALETTE).forEach(function (k) {
      s.setProperty('--pw-c-' + kebab(k), PALETTE[k]);
    });
    s.setProperty('--pw-present-secs', TIMING.presentSeconds + 's');
  }

  /** `cardRadius` -> `card-radius`, so the CSS names stay lowercase-and-hyphens. */
  function kebab(k) { return k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }

  /** The two unitless values; everything else in LAYOUT is a pixel measurement. */
  function unitFor(key, value) {
    return (key === 'pressed') ? String(value) : value + 'px';
  }

  function storeFailRequested() {
    return typeof location !== 'undefined' && /(\?|&)storefail\b/.test(location.search);
  }

  function benefitRows() {
    return BENEFITS.map(function (b) {
      return '<div class="pw-row"><span class="pw-check">' + GLYPH.check + '</span>'
        + '<span>' + b.emoji + ' ' + b.text + '</span></div>';
    }).join('');
  }

  function linkRow() {
    return LINKS.map(function (l) {
      return '<a class="pw-link" href="' + l.url + '" target="_blank" rel="noopener">'
        + l.label + '</a>';
    }).join('<span class="pw-legal-sep">·</span>');
  }

  /**
   * The lock card a gated feature shows in place of its content — never a modal over an empty
   * screen. Returns the scrim + card; the caller appends it and owns dismissal.
   */
  function lockCard(message, opts) {
    opts = opts || {};
    var wrap = el('div', 'pw-lock');
    // Its own metrics: the lock card is raised OVER whatever screen the user was on, so there is
    // no `.pw-view` root above it holding the custom properties.
    applyMetrics(wrap);
    wrap.innerHTML = '<div class="pw-lock-scrim"></div>'
      + '<div class="pw-lock-card">'
      + '<div class="pw-crown">' + GLYPH.crown + '</div>'
      + '<div class="pw-lock-title">' + STRINGS.lockTitle + '</div>'
      + '<div class="pw-lock-body">' + message + '</div>'
      + (opts.resets ? '<div class="pw-reset">' + STRINGS.resetsNote + '</div>' : '')
      + '<button class="pw-cta" type="button">' + STRINGS.lockCta + '</button>'
      + '</div>';
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.querySelector('.pw-lock-scrim').onclick = close;
    wrap.querySelector('.pw-cta').onclick = function () {
      close();
      if (opts.onSeePlans) opts.onSeePlans();
    };
    return wrap;
  }

  /**
   * Leaf renderer: owns its own clear of #view, per the contract in docs/web-demo.md.
   *
   * The purchase buttons drive the SIMULATED store — there is no StoreKit in a browser. That is
   * the point: it makes the whole lifecycle walkable without a device or a month of waiting.
   */
  function render(view, onClose) {
    view.scrollTop = 0;
    view.innerHTML = '';
    var store = shared();
    var root = el('div', 'pw-view');
    applyMetrics(root);

    var head = el('div', 'pw-head');
    head.innerHTML = '<button class="pw-back nav-icon" type="button">' + BiyaIcons.back() + '</button>'
      + '<div class="pw-head-title">'
      + (store.isPremium() ? STRINGS.premium : STRINGS.goPremium) + '</div>'
      + (store.isPremium()
        ? '<span class="pw-active">' + STRINGS.active + '</span>'
        : '<img class="pw-logo" src="assets/images/brand-logo.png" alt="" '
          + 'style="margin-left:auto">');
    head.querySelector('.pw-back').onclick = onClose;
    root.appendChild(head);

    var body = el('div', 'pw-body');
    if (store.graceDaysLeft() > 0) {
      body.appendChild(el('div', 'pw-warn',
        '<div class="pw-warn-title">' + STRINGS.graceTitle + '</div>'
        + '<div class="pw-warn-body">'
        + fill(STRINGS.graceBody, { n: store.graceDaysLeft() }) + '</div>'));
    }
    if (store.isPremium()) { renderSubscribed(body, store); } else { renderOffer(body, store); }
    root.appendChild(body);
    view.appendChild(root);

    function rerender() { render(view, onClose); }
    root.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.onclick = function () {
        var act = btn.getAttribute('data-act');
        if (act === 'trial') store.startTrial();
        else if (act === 'subscribe') store.subscribe();
        else if (act === 'restore') store.subscribe();
        else if (act === 'cancel') store.cancel();
        rerender();
      };
    });
  }

  function renderOffer(body, store) {
    body.appendChild(el('div', 'pw-hero',
      '<div class="pw-crown">' + GLYPH.crown + '</div>'
      + '<div class="pw-hero-title">' + STRINGS.heroTitle + '</div>'
      + '<div class="pw-hero-body">' + STRINGS.heroBody + '</div>'));

    body.appendChild(el('div', 'pw-card',
      '<div class="pw-card-title">' + STRINGS.planTitle + '</div>' + benefitRows()));

    /* The state an unsigned build ALWAYS lands in: no App ID with In-App Purchase, so
       `Product.products(for:)` comes back empty and there is no price to show. Reachable here with
       `?storefail`, because it is the state most testers will actually see. */
    if (storeFailRequested()) {
      body.appendChild(el('div', 'pw-fail',
        '<div class="pw-fail-title">' + STRINGS.failTitle + '</div>'
        + '<div class="pw-fail-body">' + STRINGS.failBody + '</div>'
        + '<button class="pw-restore" type="button" data-act="retry">'
        + STRINGS.failRetry + '</button>'));
      return;
    }

    /* The browser has no `Product.displayPrice`, so the simulated store shows a placeholder rather
       than a hard-coded peso figure — hard-coding one is the exact bug the RN app had. */
    body.appendChild(el('div', 'pw-actions',
      '<button class="pw-cta" type="button" data-act="trial">' + STRINGS.trialCta + '</button>'
      + '<div class="pw-price">' + fill(STRINGS.trialNote, { price: DEMO.simulatedPrice })
      + '</div>'));

    body.appendChild(el('div', 'pw-legal',
      '<div class="pw-disclosure">' + STRINGS.disclosure + '</div>'
      + '<div class="pw-links">' + linkRow() + '</div>'));

    body.appendChild(el('div', 'pw-actions',
      '<button class="pw-restore" type="button" data-act="restore">'
      + STRINGS.restoreButton + '</button>'));
  }

  function renderSubscribed(body, store) {
    var expiry = store.expiresAt();
    body.appendChild(el('div', 'pw-hero',
      '<div class="pw-crown">' + GLYPH.crown + '</div>'
      + '<div class="pw-hero-title">' + STRINGS.allSetTitle + '</div>'
      + '<div class="pw-hero-body">' + STRINGS.allSetBody + '</div>'));

    var rows = '<div class="pw-card-title pw-gold">' + STRINGS.yourPlan + '</div>';
    if (expiry) {
      /* The days pill is suppressed at zero. In GRACE the subscription has already lapsed, so it
         would read "0 days remaining" directly under a "✓ Active" pill — the amber warning above
         already says what is actually going on. */
      var left = daysRemaining(expiry, store.now());
      rows += '<div class="pw-until">' + fill(STRINGS.activeUntil, { date: dateText(expiry) })
        + '</div>'
        + (left > 0 ? '<div class="pw-days">' + daysPillText(left) + '</div>' : '')
        + '<div class="pw-row"><span>' + GLYPH.calendar + '</span><span>'
        + (store.willAutoRenew() ? STRINGS.renewalRow : STRINGS.expiresRow) + '</span></div>';
    }
    rows += '<div class="pw-row"><span>' + GLYPH.renew + '</span><span>'
      + (store.willAutoRenew() ? STRINGS.autoRenewOn : STRINGS.autoRenewOff) + '</span></div>'
      + '<div class="pw-row"><span>' + GLYPH.gear + '</span><span>'
      + STRINGS.manageBody + '</span></div>';
    body.appendChild(el('div', 'pw-card pw-card-active', rows));

    if (store.willAutoRenew()) {
      body.appendChild(el('div', 'pw-actions',
        '<button class="pw-restore" type="button" data-act="cancel">'
        + DEMO.simulateCancel + '</button>'));
    }
  }

  return {
    // pure
    CONST: CONST, MODE: MODE, SESSION: SESSION,
    maxUses: maxUses, emptySnapshot: emptySnapshot, emptyUsage: emptyUsage,
    trustedNow: trustedNow, daysRemaining: daysRemaining, resolve: resolve, access: access,
    isPremiumAccess: isPremiumAccess,
    isThematicLocked: isThematicLocked, isCoachLocked: isCoachLocked,
    maxSwissRounds: maxSwissRounds,
    usageKey: usageKey, dayKey: dayKey, used: used, record: record, isAtLimit: isAtLimit,
    remaining: remaining, prune: prune,
    createStore: createStore, memoryStorage: memoryStorage, shared: shared,
    selfTest: selfTest,
    // design
    PALETTE: PALETTE, LAYOUT: LAYOUT, TYPE: TYPE, TIMING: TIMING,
    STRINGS: STRINGS, LINKS: LINKS, BENEFITS: BENEFITS,
    GLYPH: GLYPH, DEMO: DEMO,
    fill: fill, daysPillText: daysPillText, dateText: dateText,
    // view
    applyMetrics: applyMetrics, render: render, lockCard: lockCard
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPremium; }
