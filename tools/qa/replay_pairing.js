#!/usr/bin/env node
/*
 * replay_pairing.js — check the Pairing Manager's Swift against the JavaScript that has actually
 * executed.
 *
 *     node tools/qa/replay_pairing.js
 *
 * `swift` is not on PATH on this checkout, so `PairingEngine.swift`, `PairingMetrics.swift` and
 * `PairingMetricsCheck.swift` were written blind. This is the mitigation every phase of this rebuild
 * has used: pull the concrete values out of the Swift SOURCE TEXT and compare them with the JS twin,
 * which is proven by `pairing_test.js` and mutation-tested by `puzzle_core_mutation_test.js`.
 *
 * It does not prove the Swift compiles. It proves the numbers, the tables and the copy in it are the
 * right ones — the half a compiler would not have caught anyway.
 *
 * ## What it deliberately does NOT do
 *
 * Re-prove the engine's behaviour. `pairing_test.js` owns that, over whole simulated tournaments,
 * and `pairing_screen_test.js` owns the rendered screens. This is the third leg: Swift source versus
 * proven JS. Duplicating the first two here would add assertions and no coverage.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const CORE = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');
const UI = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
/** `want` is always the value read out of the Swift source; `got` is what the JS produced. */
const eq = (got, want, what) => expect(got === want,
  `${what}: Swift says ${JSON.stringify(want)}, JS gives ${JSON.stringify(got)}`);
const swiftIs = (swift, js, what) => eq(js, swift, what);

/** The body of a top-level `enum X { … }`, by brace matching. */
function blockOf(src, name) {
  const at = src.search(new RegExp('(?:public )?enum ' + name + '\\b[^\\n{]*\\{'));
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

/** Strip comments, so a documented value is never mistaken for a live one. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '')
            .replace(/^[ \t]*\/\/\/.*$/gm, '');
}

/** The body of a `func name(` … `)` by brace matching, so a regex cannot wander into the next one. */
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

/** `public static let name: CGFloat = 12.5` / `= 12.5` / `= 1e7`. */
function swNum(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*(-?[\\d._e+]+)`)
    .exec(code(block));
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

/** `public static let name = Theme.c(0xRRGGBB)` / `Theme.c(0xRRGGBB, 0.08)`. */
function swColor(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}\\s*=\\s*Theme\\.c\\(0x([0-9A-Fa-f]{6})(?:,\\s*([\\d.]+))?\\)`)
    .exec(code(block));
  if (!m) return null;
  return m[2] === undefined ? '#' + m[1].toUpperCase()
                            : 'rgba' + m[1].toUpperCase() + '@' + Number(m[2]);
}

/** `public static let name = "…"`, with `\u{XXXX}` escapes resolved. */
function swStr(src, ns, name) {
  const block = blockOf(src, ns);
  if (block === null) return null;
  const m = new RegExp(`static let ${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(code(block));
  if (!m) return null;
  return m[1]
    .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** The JS colour form the extraction stores, in the shape `swColor` returns. */
function jsColorKey(v) {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase();
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!m) return v;
  const hex = [m[1], m[2], m[3]]
    .map((n) => Number(n).toString(16).toUpperCase().padStart(2, '0')).join('');
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return a === 1 ? '#' + hex : 'rgba' + hex + '@' + a;
}

function run() {
  passed = 0; failures.length = 0;

  const MET = require(path.join(JS, 'pairing-metrics.js'));
  const ENG = require(path.join(JS, 'pairing-engine.js'));
  const engine = read(CORE, 'PairingEngine.swift');
  const metrics = read(UI, 'PairingMetrics.swift');
  const strings = read(UI, 'PairingStrings.swift');
  if (!engine || !metrics || !strings) return finish();

  // ── 1. The cost ladder ───────────────────────────────────────────────────────────
  //
  // The values are arbitrary; their ORDER is the algorithm. Both are checked: the numbers against
  // the JS, and then the ordering as a property, because a consistent pair of wrong numbers would
  // satisfy the first check and still be a different engine.
  {
    const want = {
      costRepeat: ENG.costs.repeat, costColorAbsolute: ENG.costs.colorAbsolute,
      costRefloat: ENG.costs.refloat, costScore: ENG.costs.score,
      costColorUnit: ENG.costs.colorUnit,
    };
    for (const [swiftName, jsValue] of Object.entries(want)) {
      swiftIs(swNum(engine, 'PairingEngine', swiftName), jsValue, 'PairingEngine.' + swiftName);
    }
    const c = (n) => swNum(engine, 'PairingEngine', n);
    expect(c('costRepeat') > c('costColorAbsolute'), 'Swift: nothing outranks avoiding a rematch');
    expect(c('costColorAbsolute') > c('costRefloat'),
           'Swift: the absolute colour rules outrank float bookkeeping');
    expect(c('costRefloat') > c('costScore'),
           'Swift: a repeat downfloat costs more than a point of score difference');
    expect(c('costScore') > c('costColorUnit'),
           'Swift: a score point outweighs a unit of colour imbalance');
    swiftIs(swNum(engine, 'PairingEngine', 'nodeBudget'), 200000, 'PairingEngine.nodeBudget');
  }

  // ── 2. The preference ladder is ordered the same way in both ─────────────────────
  {
    const strength = blockOf(engine, 'Strength') || '';
    const cases = [...code(strength).matchAll(/case (\w+) = (\d+)/g)]
      .reduce((acc, m) => { acc[m[1]] = +m[2]; return acc; }, {});
    swiftIs(cases.none, ENG.PREF.none, 'Strength.none');
    swiftIs(cases.mild, ENG.PREF.mild, 'Strength.mild');
    swiftIs(cases.strong, ENG.PREF.strong, 'Strength.strong');
    swiftIs(cases.absolute, ENG.PREF.absolute, 'Strength.absolute');
    expect(Object.keys(cases).length === 4,
           `Strength has ${Object.keys(cases).length} cases, expected 4`);
  }

  // ── 3. The colour and float raw values match the JS strings ──────────────────────
  //
  // These cross the JSON boundary: the browser writes `"w"`/`"down"` into localStorage and the app
  // writes the same into pairing.json, so a renamed case would make one language unable to read the
  // other's document.
  {
    const colour = code(blockOf(engine, 'Color') || '');
    expect(/case white = "w"/.test(colour), 'Color.white encodes as "w"');
    expect(/case black = "b"/.test(colour), 'Color.black encodes as "b"');
    const float3 = code(blockOf(engine, 'Float3') || '');
    for (const c of ['none', 'up', 'down']) {
      expect(new RegExp('case ' + c + '\\b').test(float3), `Float3 has .${c}`);
    }
  }

  // ── 4. Every extracted constant, Swift against the extraction ────────────────────
  //
  // The generator emits both languages, so this is a second opinion rather than the only guard —
  // but a second opinion is exactly what catches a generator bug, which nothing else here would.
  {
    const pairs = [
      ['PairingList', MET.LIST], ['PairingCreate', MET.CREATE],
      ['PairingDetail', MET.DETAIL], ['PairingShare', MET.SHARE],
    ];
    let compared = 0;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    for (const [ns, blocks] of pairs) {
      const body = blockOf(metrics, ns);
      expect(body !== null, `PairingMetrics declares ${ns}`);
      if (body === null) continue;
      for (const [block, props] of Object.entries(blocks)) {
        for (const [prop, v] of Object.entries(props)) {
          if (v === null || typeof v === 'object') continue;   // shadowOffset is split in two
          const member = block + cap(prop);
          compared++;
          if (typeof v === 'number') {
            swiftIs(swNum(metrics, ns, member), v, `${ns}.${member}`);
          } else if (/^(#[0-9a-fA-F]{6}|rgba?\(|transparent$)/.test(v)) {
            if (v === 'transparent') {
              expect(new RegExp(`static let ${member} = Color.clear`).test(code(body)),
                     `${ns}.${member} is Color.clear`);
            } else {
              swiftIs(swColor(metrics, ns, member), jsColorKey(v), `${ns}.${member}`);
            }
          } else {
            swiftIs(swStr(metrics, ns, member), v, `${ns}.${member}`);
          }
        }
      }
    }
    // Anti-vacuity: a renamed block would otherwise make this compare nothing and pass.
    expect(compared > 600, `only ${compared} constants compared — the generator probably moved`);
  }

  // ── 5. The colour maps and the invented blocks ───────────────────────────────────
  {
    swiftIs(swColor(metrics, 'PairingPalette', 'swiss'), jsColorKey(MET.COLORS.swiss),
            'PairingPalette.swiss');
    swiftIs(swColor(metrics, 'PairingPalette', 'roundRobin'), jsColorKey(MET.COLORS.roundRobin),
            'PairingPalette.roundRobin');
    swiftIs(swColor(metrics, 'PairingPalette', 'ongoing'), jsColorKey(MET.COLORS.ongoing),
            'PairingPalette.ongoing');
    swiftIs(swColor(metrics, 'PairingPalette', 'finished'), jsColorKey(MET.COLORS.finished),
            'PairingPalette.finished');
    swiftIs(swColor(metrics, 'PairingPalette', 'setup'), jsColorKey(MET.COLORS.setup),
            'PairingPalette.setup');
    // The tint is a BYTE in the JS and its fraction in Swift; compare them as the same quantity.
    const byte = swNum(metrics, 'PairingPalette', 'tintByte');
    expect(Math.abs(byte - parseInt(MET.TINT_BYTE, 16) / 255) < 1e-5,
           `PairingPalette.tintByte ${byte} is not 0x${MET.TINT_BYTE}/255`);

    for (const k of ['rank', 'pts', 'wdl', 'bch', 'sb']) {
      swiftIs(swNum(metrics, 'PairingCols', k), MET.COLS[k], 'PairingCols.' + k);
    }
    for (const k of ['nameMax', 'ratingMin', 'ratingMax', 'roundsMin', 'roundsMax', 'longPressMs']) {
      swiftIs(swNum(metrics, 'PairingLimits', k), MET.LIMITS[k], 'PairingLimits.' + k);
    }
    swiftIs(swNum(metrics, 'PairingLimits', 'roundSelectorGap'), MET.LAYOUT.roundSelectorGap,
            'PairingLimits.roundSelectorGap');
    swiftIs(swNum(metrics, 'PairingShareCard', 'width'), MET.SHARE_CARD.width,
            'PairingShareCard.width');
    swiftIs(swNum(metrics, 'PairingShareCard', 'captureMs'), MET.DELAYS.shareCapture,
            'PairingShareCard.captureMs');
  }

  // ── 6. The two string tables hold the same KEYS and the same COPY ────────────────
  //
  // Both directions. This block exists because its absence cost two phases elsewhere: 61 Streak and
  // Turbo strings went into the JS twin and never into Swift, and every suite stayed green because
  // nothing compared the tables. A screen whose copy exists in one language only is not a smaller
  // feature, it is a screen that cannot be written.
  {
    const body = blockOf(strings, 'PairingStrings');
    expect(body !== null, 'PairingStrings.swift declares PairingStrings');
    const decls = [...code(body || '').matchAll(/static (let|func) ([A-Za-z_]\w*)/g)];
    const swiftKeys = new Set(decls.map((m) => m[2]));
    const swiftFuncs = new Set(decls.filter((m) => m[1] === 'func').map((m) => m[2]));
    const jsKeys = Object.keys(MET.STR);

    eq(jsKeys.filter((k) => !swiftKeys.has(k)).join(', '), '', 'every JS string has a Swift twin');
    eq([...swiftKeys].filter((k) => !jsKeys.includes(k)).join(', '), '',
       'and every Swift string has a JS twin');
    expect(jsKeys.length > 100, jsKeys.length + ' strings compared, not vacuous');

    // A Swift `func` must be a JS function and vice versa. Where they disagree, one language is
    // hard-coding what the other computes — which is how a plural ends up wrong in exactly one.
    for (const k of jsKeys) {
      const jsIsFn = typeof MET.STR[k] === 'function';
      if (jsIsFn === swiftFuncs.has(k)) { passed++; continue; }
      expect(false, 'PairingStrings.' + k + ' is a '
        + (jsIsFn ? 'function in JS but a constant in Swift'
                  : 'constant in JS but a function in Swift'));
    }
    expect(swiftFuncs.size > 15, swiftFuncs.size + ' interpolating strings compared');

    // The COPY itself, not just the key. The generator emits these from the JS, so a mismatch means
    // somebody hand-edited a generated file.
    let words = 0;
    for (const k of jsKeys) {
      if (typeof MET.STR[k] === 'function') continue;
      words++;
      swiftIs(swStr(strings, 'PairingStrings', k), MET.STR[k], 'PairingStrings.' + k);
    }
    expect(words > 85, words + ' plain strings compared, not vacuous');
  }

  // ── 7. The document: one shape, described in two languages ──────────────────────
  //
  // The claim `PairingDocument.swift` makes is that the browser's localStorage document and the
  // app's pairing.json ARE the same document. That is only true if every key matches, and a key
  // that does not match fails in the worst possible way: `JSONDecoder` drops an unknown key and
  // defaults a missing one, so a mismatched document decodes to something plausible and wrong.
  //
  // So the shape is compared mechanically. The JS side builds a real document — created, populated,
  // paired, scored — and the Swift side is read out of its `CodingKeys` and property declarations.
  {
    const ST = require(path.join(JS, 'pairing-store.js'));
    const doc = read(CORE, 'PairingDocument.swift');
    expect(!!doc, 'PairingDocument.swift exists');
    if (doc) {
      // A document with every branch populated: a bye, a decided result, and tie-breaks.
      const d = ST.emptyDoc();
      const id = ST.create(d, { name: 'Shape', type: ST.SWISS, totalRounds: 3 }, 1000);
      ['A', 'B', 'C'].forEach((n) => ST.addPlayer(d, id, { name: n, rating: 1500 }));
      ST.generate(d, id);
      ST.setResult(d, id, 1, 1, ST.WHITE_WIN);
      const t = d.tournaments[0];

      /**
       * The JSON key of every stored property of a Swift struct.
       *
       * `CodingKeys` wins where it exists — the house style renames `...ID` to `...Id` — and the
       * property name is used where it does not.
       */
      function swiftKeys(structName) {
        const body = blockOf(doc.replace(/public struct /g, 'enum '), structName);
        if (body === null) return null;
        const src = code(body);
        const ck = /enum CodingKeys[^{]*\{([\s\S]*?)\n {8}\}/.exec(src);
        if (ck) {
          const out = [];
          for (const part of ck[1].split(/[\n,]/)) {
            const m = /^\s*(?:case\s+)?([A-Za-z_]\w*)(?:\s*=\s*"([^"]+)")?\s*$/.exec(part);
            if (m && m[1]) out.push(m[2] || m[1]);
          }
          return new Set(out);
        }
        return new Set([...src.matchAll(/public var ([A-Za-z_]\w*)\s*:/g)].map((m) => m[1]));
      }

      const shapes = [
        ['State', Object.keys(d)],
        ['Tournament', Object.keys(t)],
        ['PlayerRow', Object.keys(t.players[0])],
        ['Round', Object.keys(t.rounds[0])],
        ['Board', Object.keys(t.rounds[0].boards[0])],
      ];
      let keysCompared = 0;
      for (const [name, jsKeys] of shapes) {
        const sw = swiftKeys(name);
        expect(sw !== null, `PairingDocument declares ${name}`);
        if (sw === null) continue;
        eq(jsKeys.filter((k) => !sw.has(k)).join(', '), '',
           `every JS key of ${name} has a Swift twin`);
        eq([...sw].filter((k) => !jsKeys.includes(k)).join(', '), '',
           `and every Swift key of ${name} has a JS twin`);
        keysCompared += jsKeys.length;
      }
      expect(keysCompared > 35, `${keysCompared} document keys compared — expected 35+`);

      // `round.floats` must be STRING-keyed. `JSONEncoder` writes an Int-keyed dictionary as a flat
      // array of alternating keys and values, so `[Int: Float3]` would emit a document the JS
      // cannot read — and this is the only place that would catch it.
      // `public var`, not just `var`: `generate` has a LOCAL `var floats: [String: …]` that a
      // looser regex matches, so the mutant that flips the stored property to [Int:] survived.
      expect(/public var floats: \[String: PairingEngine\.Float3\]/.test(code(doc)),
             'Round.floats is keyed by String, not Int');

      // The enum raw values cross the same boundary.
      const raws = (ns) => {
        const b = code(blockOf(doc.replace(/public enum /g, 'enum '), ns) || '');
        const out = {};
        for (const m of b.matchAll(/case (\w+)(?:\s*=\s*"([^"]+)")?/g)) out[m[1]] = m[2] || m[1];
        return out;
      };
      const kind = raws('Kind');
      swiftIs(kind.swiss, ST.SWISS, 'Kind.swiss');
      swiftIs(kind.roundRobin, ST.ROUND_ROBIN, 'Kind.roundRobin');
      const st = raws('Status');
      swiftIs(st.setup, ST.SETUP, 'Status.setup');
      swiftIs(st.ongoing, ST.ONGOING, 'Status.ongoing');
      swiftIs(st.finished, ST.FINISHED, 'Status.finished');
      const res = raws('Result');
      swiftIs(res.pending, ST.PENDING, 'Result.pending');
      swiftIs(res.whiteWin, ST.WHITE_WIN, 'Result.whiteWin');
      swiftIs(res.blackWin, ST.BLACK_WIN, 'Result.blackWin');
      swiftIs(res.draw, ST.DRAW, 'Result.draw');
      swiftIs(res.bye, ST.BYE, 'Result.bye');

      // The limits, which the create screen clamps against in both languages.
      const MET2 = require(path.join(JS, 'pairing-metrics.js'));
      for (const k of ['nameMax', 'ratingMin', 'ratingMax', 'roundsMin', 'roundsMax']) {
        swiftIs(swNum(doc, 'Limits', k), MET2.LIMITS[k], 'PairingDocument.Limits.' + k);
      }

      // The two rules that are easiest to lose in a transliteration, asserted as source structure
      // because there is no way to run the Swift here.
      expect(/if result != \.pending && status\(doc\.tournaments\[ti\]\) == \.finished/.test(code(doc)),
             'the finished lock refuses a CHANGE but allows a clear');
      expect(/rows\.append\(\(white: Optional\(bye\), black: nil, bye: true\)\)/.test(code(doc)),
             'the bye is appended LAST, not inserted first');
      expect(/result: b\.bye \? \.bye : \.pending/.test(code(doc)),
             'a bye is decided at generation, not left pending');
      expect(/players\[ti\]|nextSeed = doc\.tournaments\[ti\]\.players\.count \+ 1/
             .test(code(doc)), 'removal resets nextSeed to the dense count');
    }
  }

  // ── 8. The screens, as branch structure ─────────────────────────────────
  //
  // A SwiftUI body cannot be run here and cannot be compared value-for-value with anything. What can
  // be checked is that the decisions inside it are still the ones the §7 fixes require — each of
  // these is a bug that actually shipped, so each is worth pinning even in this crude form.
  {
    const list = read(UI, 'PairingScreens.swift');
    const detail = read(UI, 'PairingDetailScreens.swift');
    const modals = read(UI, 'PairingModals.swift');
    const store = read(UI, 'PairingStore.swift');
    const phone = read(UI, 'PhoneView.swift');
    const all = code(list + detail + modals + store);

    // #15 — the seed chip renders `player.seed`, never a row index.
    expect(/Text\(String\(p\.seed\)\)/.test(code(detail)),
           'the seed chip renders player.seed');
    expect(!/enumerated\(\)[\s\S]{0,200}playerSeedText/.test(code(detail)),
           'and not an enumerated row index');

    // #20 — the result badge is an EXHAUSTIVE switch with no draw fallthrough.
    const badge = /enum PairingResultBadge \{[\s\S]*?\n\}/.exec(code(detail));
    expect(!!badge, 'PairingResultBadge exists');
    if (badge) {
      expect(/case \.pending, \.bye: return PairingStrings\.vs/.test(badge[0]),
             'pending and bye both render `vs`');
      expect(!/default:/.test(badge[0]),
             'the badge switch has no `default:` — a new result case must be handled, not defaulted');
      expect(!/return PairingStrings\.resultDraw\s*\n\s*\}/.test(badge[0]),
             'and it does not end by falling through to a draw');
    }

    // #14 — rank 1 gold ON SCREEN, not only in the share image.
    expect(/rankColFirstBackgroundColor/.test(code(detail))
           && /rankTextFirstColor/.test(code(detail)),
           'rank 1 uses the first-place chip and text colours on screen');

    // #18 — delete and remove confirm BEFORE mutating.
    const del = /private func deletePrompt[\s\S]*?\n    \}/.exec(code(list));
    expect(!!del && /onDanger:/.test(del[0]) && /store\.remove\(/.test(del[0]),
           'deleting goes through a confirm prompt');
    expect(!/onLongPressGesture \{ store\.remove/.test(code(list)),
           'and long-press opens the prompt rather than deleting outright');
    expect(/case \.removePlayer/.test(code(detail)) && /PuzzleModal\(title: PairingStrings\.removeTitle/
           .test(code(detail)), 'removing a player goes through a confirm prompt');

    // #19 — a missing tournament renders an empty state.
    expect(/PairingStrings\.deletedTitle/.test(code(detail))
           && /PairingStrings\.deletedBody/.test(code(detail)),
           'a deleted tournament renders its own empty state');

    // #22 — the share text carries no URL, and ends with the hashtags.
    const share = /enum PairingShareText \{[\s\S]*?\n\}/.exec(code(detail));
    expect(!!share, 'PairingShareText exists');
    if (share) {
      expect(!/siteUrl|https?:/.test(share[0]), 'the share text embeds no URL');
      expect((share[0].match(/PairingStrings\.hashtags/g) || []).length === 2,
             'both share builders end with the hashtags');
    }

    // The store is the only writer, and it always persists.
    const mutate = funcBody(code(store), 'mutate');
    expect(!!mutate && /PairingLibraryFile\.save\(s\)/.test(mutate),
           'every mutation persists through the one funnel');
    expect((code(store).match(/PairingLibraryFile\.save\(/g) || []).length === 1,
           'and there is exactly one save call in the store');

    // The Home tile reaches the feature.
    expect(/onPairing:/.test(code(phone)) && /showPairing = true/.test(code(phone)),
           'PhoneView passes onPairing and presents the overlay');
    expect(/PairingRootScreen\(store: pairingStore/.test(code(phone)),
           'and mounts the Pairing root');

    // No numeric literal in a view body.
    //
    // The first version of this only looked at the FIRST argument, so `.padding(.bottom, 10)` slid
    // straight past it — the mutation suite proved that by surviving. It now scans the whole
    // argument list of each layout modifier for a bare number, anchored after `(`, `,` or `:` so a
    // digit inside an identifier (`buchholzCut1`, `Float3`) is not mistaken for one.
    const MODIFIERS = /\.(padding|frame|cornerRadius|spacing|lineWidth|offset)\(([^()]*)\)/g;
    const BARE = /(?:^|[,:]\s*)-?\d+(?:\.\d+)?\s*$|(?:^|[,:]\s*)-?\d+(?:\.\d+)?\s*,/;
    const offenders = [];
    for (const m of all.matchAll(MODIFIERS)) {
      if (BARE.test(m[2].trim())) offenders.push(m[0]);
    }
    eq(offenders.join('  '), '',
       'no numeric literal reaches a layout modifier — every number is a metrics constant');
    expect([...all.matchAll(MODIFIERS)].length > 100,
           'the layout-literal scan found few modifiers — the screens probably moved');
  }

  // ── 9. The offline guarantee, checked rather than asserted in prose ──────────────
  //
  // Book Two 0.1: "the only URLSession calls in the entire app live in ContentClient and
  // VideoPlayer". Phase 8 criterion 2 says the offline modules contain no URLSession, URLRequest or
  // hostname at all. That is a grep, so it may as well be one.
  {
    const files = [
      ['PairingEngine.swift', engine], ['PairingMetrics.swift', metrics],
      ['PairingStrings.swift', strings],
      ['PairingDocument.swift', read(CORE, 'PairingDocument.swift')],
      ['PairingMetricsCheck.swift', read(UI, 'PairingMetricsCheck.swift')],
      ['PairingStore.swift', read(UI, 'PairingStore.swift')],
      ['PairingScreens.swift', read(UI, 'PairingScreens.swift')],
      ['PairingDetailScreens.swift', read(UI, 'PairingDetailScreens.swift')],
      ['PairingModals.swift', read(UI, 'PairingModals.swift')],
    ];
    for (const [name, src] of files) {
      expect(!/URLSession|URLRequest/.test(src), `${name} contains no URLSession or URLRequest`);
      // The one legitimate hostname is the share card's footer, which is COPY, not a request.
      const hosts = (src.match(/https?:\/\/[^\s"']+/g) || []);
      expect(hosts.length === 0, `${name} contains no URL (${hosts.join(', ')})`);
    }
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayPairing: ${passed} Swift expectations confirmed against the JS`
      : `ReplayPairing: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
