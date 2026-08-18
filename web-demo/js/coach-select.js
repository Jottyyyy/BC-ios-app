/* coach-select.js — the Coach Select screen (spec 2.5).
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/CoachScreens.swift` (not written yet). Five coach cards over
 * the tagline, and the `Allow Take Back` toggle.
 *
 * Stateless about data: the toggle lives in storage and the personas come from `coach-engine.js`, so
 * a repaint cannot lose anything. Every number is a `coach-metrics.js` constant pushed onto the root
 * as a `--cgs-*` custom property — no numeric literal in the render body.
 *
 * ## The toggle is persisted, and that is the fix
 *
 * Spec 7 #39: the RN app has an `Allow Take Back` switch that is never written anywhere, so it
 * resets to its default on every launch and the setting is decorative. One `localStorage` key makes
 * it real, and the suite asserts it survives a reload.
 */
'use strict';

var BiyaCoachSelect = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./coach-metrics.js') : BiyaCoachMetrics;
  var STR = (isNode ? require('./coach-strings.js') : BiyaCoachStrings).STR;
  var ENG = isNode ? require('./coach-engine.js') : BiyaCoachEngine;

  var TAKEBACK_KEY = 'biya.coach.takeback.v1';

  /**
   * The five coaches, in the order the screen shows them.
   *
   * `MET.COACHES` is the source's own `COACH_DATA`, lifted by the extractor — name, role, tagline,
   * the four in-game lines, accent colour and rating. It is read rather than restated for the
   * reason this whole pipeline exists: the first version of this file typed the roster out by hand
   * and got three of the five ratings and four of the five names wrong, with nothing to catch it.
   *
   * `blurb` is the one field the extraction cannot supply — the select CARD's one-liner is spec
   * 2.14 copy, not `COACH_DATA` — so it is joined on by level. The depth each coach plays at comes
   * from `coach-engine.js`, so a card cannot advertise a strength the engine does not use. The
   * avatars are photo assets in the real app (`level-N.webp`); the browser demo has no art
   * pipeline, so it draws the level number in the same circle and the Swift twin loads the image.
   */
  var BLURBS = {
    1: STR.blurbBeginner, 2: STR.blurbTricky, 3: STR.blurbSharp,
    4: STR.blurbCalm, 5: STR.blurbSharp,
  };
  var COACHES = MET.COACHES.map(function (c) {
    return {
      level: c.level, name: c.name, title: c.role, rating: c.rating,
      accentColor: c.accentColor, blurb: BLURBS[c.level],
      // Carried through because `coach-game.js`'s `evaluate` reads them straight into the result
      // card; a coach object without them renders `undefined` where the coach should speak.
      intro: c.intro, thinkingMsg: c.thinkingMsg, yourTurnMsg: c.yourTurnMsg,
      winMsg: c.winMsg, loseMsg: c.loseMsg,
    };
  });

  /** The profile for a level, clamped — spec 7 #35 is a deep link arriving with `COACH_DATA[NaN]`. */
  function coachAt(level) {
    var lv = ENG.clampLevel(level);
    for (var i = 0; i < COACHES.length; i++) if (COACHES[i].level === lv) return COACHES[i];
    return COACHES[0];
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'cgs', MET.SELECT);
  }

  // ---- The take-back setting (spec 7 #39) --------------------------------------------------------

  function takeBackEnabled(storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    try { return s.getItem(TAKEBACK_KEY) === '1'; } catch (e) { return false; }
  }

  function setTakeBack(on, storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    try { s.setItem(TAKEBACK_KEY, on ? '1' : '0'); return true; } catch (e) { return false; }
  }

  // ---- Render -------------------------------------------------------------------------------------

  /** `cb` is `{ onPick(level), onExit(), onToggle(on) }`. */
  function render(view, cb, storage) {
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var root = el('div', 'cgs-view');
    applyMetrics(root);

    var header = el('div', 'cgs-header');
    var back = el('button', 'cgs-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    header.appendChild(back);
    var centre = el('div', 'cgs-header-center');
    centre.appendChild(el('div', 'cgs-title', STR.selectHeader));
    centre.appendChild(el('div', 'cgs-family', STR.selectFamily));
    header.appendChild(centre);
    header.appendChild(BiyaIcons.brandLogoEl('cgs-logo'));
    root.appendChild(header);

    root.appendChild(el('div', 'cgs-blurb', STR.selectBlurb));
    root.appendChild(el('div', 'cgs-tagline', STR.tagline));
    root.appendChild(el('div', 'cgs-subtagline', STR.subTagline));

    var list = el('div', 'cgs-list');
    COACHES.forEach(function (c) { list.appendChild(card(c, cb)); });
    root.appendChild(list);

    root.appendChild(takeBackRow(cb, storage));
    view.appendChild(root);
  }

  /** Where the five coach portraits live. Same five files the Swift bundle ships. */
  var COACH_ART = 'assets/characters/';

  function card(c, cb) {
    var b = el('button', 'cgs-card');
    // The coach's face, the same asset `CoachArt.image(level:)` loads in Swift
    // (`CoachScreens.avatar`). This used to be `String(c.level)` — a bare digit in an empty ring,
    // while the app showed a photo. `onerror` falls back to that digit rather than to a broken
    // image box, which mirrors the Swift's "a missing asset degrades to the ring alone".
    var avatar = el('div', 'cgs-avatar');
    var face = el('img');
    face.src = COACH_ART + 'level-' + c.level + '.webp';
    face.alt = '';
    face.onerror = function () { avatar.removeChild(face); avatar.textContent = String(c.level); };
    avatar.appendChild(face);
    b.appendChild(avatar);

    var info = el('div', 'cgs-info');
    info.appendChild(el('div', 'cgs-name', c.name));
    info.appendChild(el('div', 'cgs-blurb-line', c.blurb));
    b.appendChild(info);

    var right = el('div', 'cgs-right');
    right.appendChild(el('div', 'cgs-elo', STR.elo(c.rating)));
    // The depth is read from the engine, never restated — a card that advertised a strength the
    // engine does not use would be a lie nothing could catch.
    right.appendChild(el('div', 'cgs-depth', String(ENG.config(c.level).depth)));
    b.appendChild(right);

    b.onclick = function () { if (cb.onPick) cb.onPick(c.level); };
    return b;
  }

  function takeBackRow(cb, storage) {
    var row = el('div', 'cgs-takeback');
    row.appendChild(el('div', 'cgs-takeback-label', STR.allowTakeBack));
    var on = takeBackEnabled(storage);
    var sw = el('button', 'cgs-switch' + (on ? ' on' : ''), on ? '1' : '0');
    sw.onclick = function () {
      var next = !takeBackEnabled(storage);
      setTakeBack(next, storage);
      sw.className = 'cgs-switch' + (next ? ' on' : '');
      sw.textContent = next ? '1' : '0';
      if (cb.onToggle) cb.onToggle(next);
    };
    row.appendChild(sw);
    return row;
  }

  // ---- Self-test ----------------------------------------------------------------------------------
  //
  // The DOM half is covered by `tools/qa/coach_screen_test.js` once it exists. What is checked here
  // is the part that has logic in it: the persisted setting, and the coach table's agreement with
  // the engine.

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }
    function mem() {
      var box = {};
      return {
        getItem: function (k) { return k in box ? box[k] : null; },
        setItem: function (k, v) { box[k] = String(v); },
        removeItem: function (k) { delete box[k]; },
      };
    }

    // --- the take-back setting survives a reload (spec 7 #39) ---
    var s = mem();
    eq(takeBackEnabled(s), false, 'take-back is off by default');
    setTakeBack(true, s);
    eq(takeBackEnabled(s), true, 'turning it on sticks');
    // "Survives a reload" is the whole fix: a fresh read of the same storage, as a new launch does.
    eq(takeBackEnabled({ getItem: s.getItem, setItem: s.setItem }), true,
       'and a fresh read of the same storage still sees it');
    setTakeBack(false, s);
    eq(takeBackEnabled(s), false, 'and turning it off sticks too');
    // A storage that throws must not take the screen down with it.
    var hostile = {
      getItem: function () { throw new Error('nope'); },
      setItem: function () { throw new Error('nope'); },
    };
    eq(takeBackEnabled(hostile), false, 'an unreadable storage reads as off');
    eq(setTakeBack(true, hostile), false, 'and an unwritable one reports failure rather than throwing');

    // --- the coach table ---
    eq(COACHES.length, 5, 'five coaches');
    eq(COACHES.map(function (c) { return c.level; }).join(','), '1,2,3,4,5',
       'levels 1 to 5 in order');
    // Pinned against the SPEC table (2.14), which is an independent transcription of the same
    // COACH_DATA the metrics layer reads. Two sources that were written apart and agree is a real
    // check; the metrics generator separately asserts field-by-field equality with the extraction.
    eq(COACHES.map(function (c) { return c.name; }).join(','),
       'Jaden Pogi,Pretty Jade,Handsome Jude,Mommy Julie,Coach Pogi', 'the five names from spec 2.14');
    eq(COACHES.map(function (c) { return c.rating; }).join(','),
       '800,1500,1800,2000,2500', 'and the five ratings');
    eq(COACHES.map(function (c) { return c.title; }).join(','),
       'Young Pawn Hero,Little Princess Gambit,Kuya Tactician,Mommy Strategist,The Master Trainer',
       'and the five roles');
    // The in-game lines have to travel with the coach: `evaluate` puts them in the result card.
    COACHES.forEach(function (c) {
      expect(typeof c.winMsg === 'string' && c.winMsg.length > 0, c.name + ' has a win line');
      expect(typeof c.loseMsg === 'string' && c.loseMsg.length > 0, c.name + ' has a losing line');
      expect(/^#[0-9A-Fa-f]{6}$/.test(c.accentColor), c.name + ' has an accent colour');
    });
    // Spec 7 #35: a level that is not a level must land somewhere real, not on `undefined`.
    eq(coachAt(3).name, 'Handsome Jude', 'coachAt finds a real level');
    eq(coachAt(99).level, 5, 'and clamps one that is too high');
    eq(coachAt(0).level, 1, 'and one that is too low');
    eq(coachAt(NaN).level, 1, 'and NaN, which is spec 7 #35 itself');
    // Ratings climb, or the list is not a ladder.
    for (var i = 1; i < COACHES.length; i++) {
      expect(COACHES[i].rating > COACHES[i - 1].rating,
             'coach ' + (i + 1) + ' is rated above coach ' + i);
    }
    // Every card's depth comes from the engine, so the two can never disagree.
    COACHES.forEach(function (c) {
      var d = ENG.config(c.level).depth;
      expect(d > 0, 'L' + c.level + ' has a real search depth');
      eq(d, ENG.LEVEL_CONFIG[c.level].depth, 'L' + c.level + ' depth matches the engine table');
    });
    // Every blurb is one of the four the spec lists.
    var blurbs = [STR.blurbBeginner, STR.blurbTricky, STR.blurbSharp, STR.blurbCalm];
    COACHES.forEach(function (c) {
      expect(blurbs.indexOf(c.blurb) >= 0, c.name + "'s blurb is one of spec 2.1's four");
    });

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-select: ' + passed + ' assertions passed'
        : 'coach-select: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    COACHES: COACHES, coachAt: coachAt, TAKEBACK_KEY: TAKEBACK_KEY,
    render: render, applyMetrics: applyMetrics,
    takeBackEnabled: takeBackEnabled, setTakeBack: setTakeBack,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachSelect; }
