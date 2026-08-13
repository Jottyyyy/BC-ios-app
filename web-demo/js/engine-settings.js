/* engine-settings.js — how hard the analysis engine is allowed to work
 *
 *     node -e "console.log(require('./web-demo/js/engine-settings.js').selfTest().summary)"
 *
 * Twin of Sources/BiyaherongCoachCore/EngineSettings.swift; `tools/qa/replay_engine_settings.js`
 * checks that source against this one. Pure — no DOM, no storage of its own beyond the two
 * functions that take a storage object — so both languages can assert one canonical document.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 * Strength costs time, and time costs battery and heat. Which trade to make is the user's call, not
 * ours, so it is a setting: five presets from Battery Saver to Infinite, plus raw controls for
 * anyone who wants to name the numbers themselves.
 *
 * ── Why the deadline is the real knob, and depth is only a ceiling ───────────
 * Search cost is about 6x per ply and varies ~15x by position type. Measured on this engine over
 * the six positions `tools/qa/engine_budget_check.js` uses:
 *
 *     budget    depths reached                     mean
 *     500ms     5 4 4 8 7 3                        5.17
 *     1200ms    6 4 4 12 8 4                       6.33
 *     3000ms    7 5 5 18 10 5                      8.33
 *     8000ms    7 6 6 22 11 6                      9.67
 *
 * A fixed depth would be far too slow in the sharp midgame and far too shallow in the quiet
 * endgame — note that only the quiet endgame ever reaches its ceiling. So every preset is a
 * DEADLINE, and `maxDepth` exists to stop a nearly-empty board from spinning forever.
 *
 * ── Infinite ─────────────────────────────────────────────────────────────────
 * `thinkMs === 0` means no deadline: the search keeps deepening until the position changes, the
 * user stops it, or it hits `maxDepth`. The ceiling is what guarantees it terminates at all.
 * **Infinite deliberately does not apply to Analyze Game** — a 41-position review cannot be
 * unbounded — so the review budget saturates at `REVIEW_MAX` instead.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaEngineSettings = (function () {
  'use strict';

  /**
   * The five presets, weakest and coolest first.
   *
   * `heat` is 0-4 and drives nothing but the warning the panel shows; it is here rather than in the
   * view so that both languages agree on which presets are the expensive ones.
   */
  var PRESETS = [
    { id: 'saver', label: 'Battery Saver', thinkMs: 500, maxDepth: 8, multiPV: 2, heat: 0 },
    { id: 'balanced', label: 'Balanced', thinkMs: 1200, maxDepth: 12, multiPV: 3, heat: 1 },
    { id: 'strong', label: 'Strong', thinkMs: 3000, maxDepth: 18, multiPV: 3, heat: 2 },
    { id: 'maximum', label: 'Maximum', thinkMs: 8000, maxDepth: 22, multiPV: 4, heat: 3 },
    { id: 'infinite', label: 'Infinite', thinkMs: 0, maxDepth: 30, multiPV: 4, heat: 4 }
  ];
  var DEFAULT_PRESET = 'balanced';

  /** Advanced-mode ranges. Every value that reaches the engine passes through `clamp`. */
  var LINES_MIN = 1, LINES_MAX = 5;
  var DEPTH_MIN = 2, DEPTH_MAX = 30;
  var THINK_MIN = 200, THINK_MAX = 30000;
  /** The one legal value below THINK_MIN, and the only way to ask for no deadline at all. */
  var THINK_INFINITE = 0;

  /**
   * The per-position budget for Analyze Game is DERIVED from the interactive one, not a sixth
   * column in the table above. A review is ~41 positions where a live search is one, so it gets a
   * fraction of the time and a floor and a ceiling around it. Deriving rather than listing is what
   * stops the two from drifting; `selfTest` pins the five values this produces.
   */
  var REVIEW_DIVISOR = 6, REVIEW_MIN = 120, REVIEW_MAX = 1200;

  var STORAGE_KEY = 'biya.analysis.engine.v1';
  /** Bumped only if the encoded shape changes; an unknown version decodes to the defaults. */
  var ENCODING_VERSION = 'v1';

  var HEAT_WARNING_MIN = 2;
  var WARNING_TEXT = 'Stronger, but the phone runs hotter and each move takes longer.';
  var INFINITE_WARNING_TEXT =
    'Runs until you stop it. Tap the engine button to stop. Analyze Game stays time-limited.';

  // ---- Presets --------------------------------------------------------------

  function presetIDs() { return PRESETS.map(function (p) { return p.id; }); }

  /** Unknown ids fall back to the default rather than throwing — a stored id can outlive a rename. */
  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return preset(DEFAULT_PRESET);
  }

  function defaults() {
    var p = preset(DEFAULT_PRESET);
    return {
      preset: DEFAULT_PRESET,
      custom: false,
      multiPV: p.multiPV,
      maxDepth: p.maxDepth,
      thinkMs: p.thinkMs
    };
  }

  function clampInt(v, lo, hi, fallback) {
    var n = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  /** Every field forced into range. The only way settings reach the engine. */
  function clamp(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    var id = presetIDs().indexOf(s.preset) >= 0 ? s.preset : DEFAULT_PRESET;
    var think = s.thinkMs === THINK_INFINITE || s.thinkMs === '0'
      ? THINK_INFINITE
      : clampInt(s.thinkMs, THINK_MIN, THINK_MAX, d.thinkMs);
    return {
      preset: id,
      custom: s.custom === true || s.custom === 1 || s.custom === '1',
      multiPV: clampInt(s.multiPV, LINES_MIN, LINES_MAX, d.multiPV),
      maxDepth: clampInt(s.maxDepth, DEPTH_MIN, DEPTH_MAX, d.maxDepth),
      thinkMs: think
    };
  }

  /** Interactive budget -> per-position review budget. See REVIEW_DIVISOR above. */
  function reviewBudget(thinkMs) {
    if (thinkMs === THINK_INFINITE) return REVIEW_MAX;   // a review is never unbounded
    var v = Math.round(thinkMs / REVIEW_DIVISOR);
    return v < REVIEW_MIN ? REVIEW_MIN : (v > REVIEW_MAX ? REVIEW_MAX : v);
  }

  /**
   * What the engine actually gets: the preset's numbers, or the custom ones when Advanced is on.
   *
   * `infinite` is surfaced as its own flag rather than left as "thinkMs happens to be 0", because
   * every call site has to branch on it — the deadline closure, the status line, and the stop
   * button all behave differently — and a magic zero read three ways is a bug waiting to happen.
   */
  function resolve(s) {
    var c = clamp(s);
    var p = preset(c.preset);
    var multiPV = c.custom ? c.multiPV : p.multiPV;
    var maxDepth = c.custom ? c.maxDepth : p.maxDepth;
    var thinkMs = c.custom ? c.thinkMs : p.thinkMs;
    return {
      label: c.custom ? 'Custom' : p.label,
      multiPV: multiPV,
      maxDepth: maxDepth,
      thinkMs: thinkMs,
      infinite: thinkMs === THINK_INFINITE,
      reviewMs: reviewBudget(thinkMs),
      heat: c.custom ? heatForCustom(thinkMs) : p.heat
    };
  }

  /** Custom settings still need a heat level, and time is what generates the heat. */
  function heatForCustom(thinkMs) {
    if (thinkMs === THINK_INFINITE) return 4;
    var best = 0;
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (p.thinkMs !== THINK_INFINITE && thinkMs >= p.thinkMs) best = p.heat;
    }
    return best;
  }

  // ---- Display --------------------------------------------------------------

  /** "1.2s" / "0.5s" / "∞". Seconds, because milliseconds mean nothing to a reader. */
  function timeText(thinkMs) {
    if (thinkMs === THINK_INFINITE) return '∞';
    return (thinkMs / 1000).toFixed(1).replace(/\.0$/, '') + 's';
  }

  /** The one-line description under a preset name: "1.2s · depth 12 · 3 lines". */
  function summary(r) {
    return timeText(r.thinkMs) + ' · depth ' + r.maxDepth
      + ' · ' + r.multiPV + (r.multiPV === 1 ? ' line' : ' lines');
  }

  function presetSummary(id) { return summary(resolve({ preset: id, custom: false })); }

  /** The warning under the list, or null when there is nothing worth warning about. */
  function warning(s) {
    var r = resolve(s);
    if (r.infinite) return INFINITE_WARNING_TEXT;
    return r.heat >= HEAT_WARNING_MIN ? WARNING_TEXT : null;
  }

  // ---- The panel, as data ---------------------------------------------------
  //
  // Which rows exist, what they say, which is selected, which controls Advanced shows and what each
  // one's range is — all of it decided HERE rather than in a view body. Two reasons, and the second
  // is the one that matters:
  //
  //  1. There is no browser on this checkout, so a panel built inside a DOM closure is a panel
  //     nothing can check. As data it is asserted in Node like everything else.
  //  2. The SwiftUI panel and the web one must be the same panel. Sharing the model rather than the
  //     screenshot is what makes that true by construction instead of by proofreading.

  var CONTROL_LINES = 'multiPV', CONTROL_DEPTH = 'maxDepth', CONTROL_THINK = 'thinkMs';

  /**
   * The Think time control folds "no deadline" into the bottom of its own range: one step BELOW
   * THINK_MIN means Infinite. A slider plus a separate Infinite checkbox would let the two disagree
   * (what does a 5s infinite search mean?); one control cannot.
   */
  var THINK_STEP = 100;
  var THINK_SLIDER_MIN = THINK_MIN - THINK_STEP;

  function controlsFor(r) {
    return [
      { key: CONTROL_LINES, kind: 'segment', label: 'Lines',
        value: r.multiPV, valueText: String(r.multiPV),
        min: LINES_MIN, max: LINES_MAX, step: 1,
        options: [1, 2, 3, 4, 5] },
      { key: CONTROL_DEPTH, kind: 'slider', label: 'Max depth',
        value: r.maxDepth, valueText: String(r.maxDepth),
        min: DEPTH_MIN, max: DEPTH_MAX, step: 1, options: null },
      { key: CONTROL_THINK, kind: 'slider', label: 'Think time',
        value: r.infinite ? THINK_SLIDER_MIN : r.thinkMs, valueText: timeText(r.thinkMs),
        min: THINK_SLIDER_MIN, max: THINK_MAX, step: THINK_STEP, options: null }
    ];
  }

  /** Everything the Engine panel draws, for a given stored setting. */
  function panelModel(s, advancedOpen) {
    var c = clamp(s);
    var r = resolve(c);
    return {
      title: 'Engine',
      presets: PRESETS.map(function (p) {
        return {
          id: p.id, label: p.label, summary: presetSummary(p.id),
          active: !c.custom && c.preset === p.id
        };
      }),
      warning: warning(c),
      advancedOpen: advancedOpen === true || c.custom,
      advancedLabel: 'Advanced',
      advancedState: c.custom ? 'ON' : 'OFF',
      controls: controlsFor(r),
      resolved: r
    };
  }

  /** Picking a preset also seeds the Advanced fields, so opening it starts from what you just chose. */
  function selectPreset(s, id) {
    var p = preset(id);
    return clamp({ preset: p.id, custom: false,
                   multiPV: p.multiPV, maxDepth: p.maxDepth, thinkMs: p.thinkMs });
  }

  /**
   * Apply one Advanced control's new value.
   *
   * Always switches Advanced ON: editing a control that then did nothing because a preset was still
   * selected would be the panel lying about what it does.
   */
  function applyControl(s, key, value) {
    var c = clamp(s);
    var r = resolve(c);
    var next = { preset: c.preset, custom: true,
                 multiPV: r.multiPV, maxDepth: r.maxDepth, thinkMs: r.thinkMs };
    if (key === CONTROL_THINK) {
      next.thinkMs = value < THINK_MIN ? THINK_INFINITE : value;
    } else if (key === CONTROL_LINES) {
      next.multiPV = value;
    } else if (key === CONTROL_DEPTH) {
      next.maxDepth = value;
    }
    return clamp(next);
  }

  // ---- Persistence ----------------------------------------------------------
  //
  // A pipe-delimited line rather than JSON: it is the same handful of characters in both languages
  // with no encoder to agree on, it is human-readable in a storage inspector, and a corrupt or
  // truncated one decodes to the defaults instead of throwing.

  function encode(s) {
    var c = clamp(s);
    return [ENCODING_VERSION, c.preset, c.custom ? '1' : '0',
            c.multiPV, c.maxDepth, c.thinkMs].join('|');
  }

  function decode(text) {
    if (typeof text !== 'string' || !text.length) return defaults();
    var parts = text.split('|');
    if (parts.length !== 6 || parts[0] !== ENCODING_VERSION) return defaults();
    return clamp({
      preset: parts[1],
      custom: parts[2] === '1',
      multiPV: parts[3],
      maxDepth: parts[4],
      thinkMs: parts[5] === '0' ? THINK_INFINITE : parts[5]
    });
  }

  /** `storage` is anything with getItem/setItem. Storage that throws is not a reason to break. */
  function load(storage) {
    try {
      var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return defaults();
      return decode(s.getItem(STORAGE_KEY));
    } catch (e) {
      return defaults();
    }
  }

  function save(settings, storage) {
    try {
      var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return false;
      s.setItem(STORAGE_KEY, encode(settings));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Self-test ------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }

    // 1. The table itself.
    expect(PRESETS.length === 5, 'five presets');
    expect(presetIDs().join(',') === 'saver,balanced,strong,maximum,infinite',
      'presets run weakest to strongest, got ' + presetIDs().join(','));
    for (var i = 1; i < PRESETS.length; i++) {
      expect(PRESETS[i].maxDepth > PRESETS[i - 1].maxDepth,
        PRESETS[i].id + ' searches deeper than ' + PRESETS[i - 1].id);
      expect(PRESETS[i].heat > PRESETS[i - 1].heat, PRESETS[i].id + ' runs hotter');
      expect(PRESETS[i].multiPV >= PRESETS[i - 1].multiPV, PRESETS[i].id + ' shows at least as many lines');
      if (PRESETS[i].thinkMs !== THINK_INFINITE) {
        expect(PRESETS[i].thinkMs > PRESETS[i - 1].thinkMs, PRESETS[i].id + ' thinks for longer');
      }
    }
    expect(preset('infinite').thinkMs === THINK_INFINITE, 'only Infinite has no deadline');
    expect(preset('infinite').maxDepth === DEPTH_MAX,
      'Infinite is bounded by the depth ceiling, or it would never terminate');

    // 2. Balanced is what the board did before this setting existed, so an untouched install
    //    behaves exactly as it always has. Depth is the ONLY thing that changed, and upwards.
    var bal = resolve(defaults());
    expect(bal.thinkMs === 1200, 'the default budget is still 1200ms, got ' + bal.thinkMs);
    expect(bal.multiPV === 3, 'the default is still three lines, got ' + bal.multiPV);
    expect(bal.reviewMs === 200, 'the default review budget is still 200ms, got ' + bal.reviewMs);
    expect(bal.infinite === false, 'the default is not infinite');

    // 3. The derived review budget reproduces every intended value. If this drifts, one of the two
    //    numbers is wrong, and the point of deriving it is that there is only one to get right.
    var wantReview = { saver: 120, balanced: 200, strong: 500, maximum: 1200, infinite: 1200 };
    presetIDs().forEach(function (id) {
      var got = resolve({ preset: id }).reviewMs;
      expect(got === wantReview[id], id + ' review budget is ' + wantReview[id] + 'ms, got ' + got);
    });
    expect(reviewBudget(THINK_INFINITE) === REVIEW_MAX,
      'an infinite live search still gives the REVIEW a finite budget — 41 positions cannot be unbounded');

    // 4. Clamping. Everything that reaches the engine has been through it.
    expect(clamp({ preset: 'nonsense' }).preset === DEFAULT_PRESET, 'an unknown preset id falls back');
    expect(clamp({ multiPV: 99 }).multiPV === LINES_MAX, 'lines clamp to the maximum');
    expect(clamp({ multiPV: 0 }).multiPV === LINES_MIN, 'lines clamp to the minimum');
    expect(clamp({ maxDepth: 999 }).maxDepth === DEPTH_MAX, 'depth clamps to the ceiling');
    expect(clamp({ maxDepth: -5 }).maxDepth === DEPTH_MIN, 'depth clamps to the floor');
    expect(clamp({ thinkMs: 999999 }).thinkMs === THINK_MAX, 'think time clamps to the maximum');
    expect(clamp({ thinkMs: 50 }).thinkMs === THINK_MIN, 'a too-small think time clamps UP, not to zero');
    expect(clamp({ thinkMs: 0 }).thinkMs === THINK_INFINITE, 'zero survives clamping — it means infinite');
    expect(clamp({ multiPV: 'abc' }).multiPV === defaults().multiPV, 'unparseable values fall back');
    expect(clamp(null).preset === DEFAULT_PRESET, 'null clamps to the defaults');
    expect(clamp(undefined).multiPV === defaults().multiPV, 'undefined clamps to the defaults');

    // 5. Custom overrides the preset — and only when it is switched on.
    var custom = { preset: 'saver', custom: true, multiPV: 5, maxDepth: 20, thinkMs: 4000 };
    var rc = resolve(custom);
    expect(rc.multiPV === 5 && rc.maxDepth === 20 && rc.thinkMs === 4000, 'Advanced values win');
    expect(rc.label === 'Custom', 'and the label says so');
    var off = resolve({ preset: 'saver', custom: false, multiPV: 5, maxDepth: 20, thinkMs: 4000 });
    expect(off.multiPV === 2 && off.thinkMs === 500,
      'with Advanced off, the stored custom values are ignored, not merged');
    expect(resolve({ custom: true, thinkMs: THINK_INFINITE }).infinite === true,
      'Advanced can ask for infinite too');
    expect(heatForCustom(500) === 0 && heatForCustom(3000) === 2 && heatForCustom(9000) === 3,
      'a custom budget takes the heat level of the preset it matches or exceeds');
    expect(heatForCustom(THINK_INFINITE) === 4, 'custom infinite is the hottest');

    // 6. Display.
    expect(timeText(1200) === '1.2s', 'timeText 1.2s, got ' + timeText(1200));
    expect(timeText(500) === '0.5s', 'timeText 0.5s, got ' + timeText(500));
    expect(timeText(3000) === '3s', 'a whole number of seconds drops the .0, got ' + timeText(3000));
    expect(timeText(THINK_INFINITE) === '∞', 'infinite shows as the symbol');
    expect(presetSummary('balanced') === '1.2s · depth 12 · 3 lines',
      'the Balanced summary line, got ' + presetSummary('balanced'));
    expect(presetSummary('infinite') === '∞ · depth 30 · 4 lines',
      'the Infinite summary line, got ' + presetSummary('infinite'));
    expect(summary(resolve({ custom: true, multiPV: 1, maxDepth: 5, thinkMs: 1000 })) === '1s · depth 5 · 1 line',
      'one line is singular');

    // 7. Warnings appear exactly where the heat is.
    expect(warning({ preset: 'saver' }) === null, 'Battery Saver needs no warning');
    expect(warning({ preset: 'balanced' }) === null, 'nor does Balanced');
    expect(warning({ preset: 'strong' }) === WARNING_TEXT, 'Strong warns');
    expect(warning({ preset: 'maximum' }) === WARNING_TEXT, 'Maximum warns');
    expect(warning({ preset: 'infinite' }) === INFINITE_WARNING_TEXT,
      'Infinite gets its own warning, because it needs to say how to stop it');

    // 7b. The panel model — everything the view draws, checked without a view.
    var pm = panelModel(defaults(), false);
    expect(pm.presets.length === 5, 'the panel lists all five presets');
    expect(pm.presets.filter(function (p) { return p.active; }).length === 1,
      'exactly one preset row is selected');
    expect(pm.presets[1].active === true, 'and it is Balanced by default');
    expect(pm.presets[1].summary === '1.2s · depth 12 · 3 lines', 'each row carries its own summary');
    expect(pm.advancedOpen === false, 'Advanced starts closed');
    expect(pm.advancedState === 'OFF', 'and says so');
    expect(pm.warning === null, 'no warning on the default preset');
    expect(pm.controls.length === 3, 'three Advanced controls');
    expect(pm.controls.map(function (c) { return c.key; }).join(',') === 'multiPV,maxDepth,thinkMs',
      'Lines, Max depth, Think time — in that order');
    expect(pm.controls[0].kind === 'segment' && pm.controls[0].options.length === 5,
      'Lines is a five-way segmented picker, not a slider');
    expect(pm.controls[1].kind === 'slider' && pm.controls[1].min === DEPTH_MIN
      && pm.controls[1].max === DEPTH_MAX, 'Max depth spans the full depth range');
    expect(pm.controls[2].valueText === '1.2s', 'Think time reads back as seconds');
    var pmCustom = panelModel({ preset: 'saver', custom: true, multiPV: 2, maxDepth: 8, thinkMs: 500 }, false);
    expect(pmCustom.advancedOpen === true, 'a custom setting forces Advanced open — it is what is in effect');
    expect(pmCustom.presets.every(function (p) { return !p.active; }),
      'and no preset row is selected, because none is');
    var pmInf = panelModel({ preset: 'infinite' }, false);
    expect(pmInf.controls[2].value === pmInf.controls[2].min,
      'Infinite sits at the very bottom of the Think time range');
    expect(pmInf.controls[2].valueText === '∞', 'and reads as the symbol');
    expect(pmInf.warning === INFINITE_WARNING_TEXT, 'with the Infinite warning');

    // 7c. The two edits the panel can make.
    expect(encode(selectPreset(defaults(), 'strong')) === 'v1|strong|0|3|18|3000',
      'picking a preset seeds the Advanced fields with its numbers, got '
      + encode(selectPreset(defaults(), 'strong')));
    var edited = applyControl(defaults(), CONTROL_LINES, 5);
    expect(edited.custom === true, 'editing a control switches Advanced on');
    expect(edited.multiPV === 5, 'and takes the new value');
    expect(edited.maxDepth === 12 && edited.thinkMs === 1200,
      'while the other two keep whatever was in effect');
    expect(applyControl(defaults(), CONTROL_THINK, THINK_SLIDER_MIN).thinkMs === THINK_INFINITE,
      'the bottom of the Think time range is Infinite');
    expect(applyControl(defaults(), CONTROL_THINK, 5000).thinkMs === 5000, 'any other value is itself');
    expect(applyControl(defaults(), CONTROL_DEPTH, 999).maxDepth === DEPTH_MAX,
      'a control value is clamped like any other');
    expect(encode(applyControl(defaults(), 'nonsense', 1)) === encode(applyControl(defaults(), 'nonsense', 2)),
      'an unknown control key changes nothing but the custom flag');

    // 8. The encoding round-trips, and survives everything it should.
    var all = [defaults(), custom, { preset: 'infinite', custom: false, multiPV: 4, maxDepth: 30, thinkMs: 0 }];
    for (var a = 0; a < all.length; a++) {
      var round = decode(encode(all[a]));
      expect(encode(round) === encode(all[a]), 'round trip ' + a + ': ' + encode(round));
    }
    expect(encode(defaults()) === 'v1|balanced|0|3|12|1200',
      'the canonical default document, got ' + encode(defaults()));
    expect(encode(decode('v1|infinite|0|4|30|0')) === 'v1|infinite|0|4|30|0', 'infinite round-trips');
    expect(encode(decode('')) === encode(defaults()), 'an empty string decodes to the defaults');
    expect(encode(decode('garbage')) === encode(defaults()), 'garbage decodes to the defaults');
    expect(encode(decode('v9|balanced|0|3|12|1200')) === encode(defaults()),
      'a future version decodes to the defaults rather than half-reading it');
    expect(encode(decode('v1|balanced|0|3')) === encode(defaults()), 'a truncated line decodes to the defaults');
    expect(encode(decode('v1|balanced|0|99|99|99999')) === 'v1|balanced|0|5|30|30000',
      'out-of-range stored values are clamped on the way in, got ' + encode(decode('v1|balanced|0|99|99|99999')));
    expect(encode(decode(null)) === encode(defaults()), 'null decodes to the defaults');

    // 9. Storage, including storage that does not work.
    var mem = (function () {
      var m = {};
      return { getItem: function (k) { return m[k] === undefined ? null : m[k]; },
               setItem: function (k, v) { m[k] = String(v); } };
    })();
    expect(load(mem).preset === DEFAULT_PRESET, 'an empty store loads the defaults');
    save({ preset: 'strong', custom: false, multiPV: 3, maxDepth: 18, thinkMs: 3000 }, mem);
    expect(load(mem).preset === 'strong', 'what was saved is what loads');
    expect(mem.getItem(STORAGE_KEY) === 'v1|strong|0|3|18|3000',
      'stored under the versioned key in the canonical shape, got ' + mem.getItem(STORAGE_KEY));
    var broken = { getItem: function () { throw new Error('denied'); },
                   setItem: function () { throw new Error('denied'); } };
    expect(load(broken).preset === DEFAULT_PRESET, 'storage that throws loads the defaults');
    expect(save(defaults(), broken) === false, 'and reports the failed save rather than throwing');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'EngineSettingsSelfTest: ' + passed + ' assertions passed'
        : 'EngineSettingsSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    PRESETS: PRESETS, DEFAULT_PRESET: DEFAULT_PRESET, STORAGE_KEY: STORAGE_KEY,
    LINES_MIN: LINES_MIN, LINES_MAX: LINES_MAX,
    DEPTH_MIN: DEPTH_MIN, DEPTH_MAX: DEPTH_MAX,
    THINK_MIN: THINK_MIN, THINK_MAX: THINK_MAX, THINK_INFINITE: THINK_INFINITE,
    REVIEW_MIN: REVIEW_MIN, REVIEW_MAX: REVIEW_MAX, REVIEW_DIVISOR: REVIEW_DIVISOR,
    WARNING_TEXT: WARNING_TEXT, INFINITE_WARNING_TEXT: INFINITE_WARNING_TEXT,
    presetIDs: presetIDs, preset: preset, defaults: defaults, clamp: clamp,
    resolve: resolve, reviewBudget: reviewBudget, heatForCustom: heatForCustom,
    timeText: timeText, summary: summary, presetSummary: presetSummary, warning: warning,
    CONTROL_LINES: CONTROL_LINES, CONTROL_DEPTH: CONTROL_DEPTH, CONTROL_THINK: CONTROL_THINK,
    THINK_STEP: THINK_STEP, THINK_SLIDER_MIN: THINK_SLIDER_MIN,
    panelModel: panelModel, selectPreset: selectPreset, applyControl: applyControl,
    encode: encode, decode: decode, load: load, save: save,
    selfTest: selfTest
  };
})();

/* Makes the settings requireable headlessly under Node without changing browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaEngineSettings; }
