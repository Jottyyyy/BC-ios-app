#!/usr/bin/env node
/*
 * replay_coach.js — check Play vs Coach's Swift against the JavaScript that has actually executed.
 *
 *     node tools/qa/replay_coach.js
 *
 * `swift` is not on PATH on this checkout, so `CoachEngine.swift`, `CoachGame.swift`,
 * `CoachTurn.swift` and `CoachBook.swift` were written blind. This is the same mitigation every
 * phase of this rebuild has used: pull the concrete values, tables and BRANCHES out of the Swift
 * source text and compare them with the JS twin, which is proven by its own suites and
 * mutation-tested.
 *
 * It does not prove the Swift compiles. It proves the numbers, the tables, the copy and the
 * decisions in it are the right ones — the half a compiler would not have caught anyway.
 *
 * ## What it deliberately does NOT do
 *
 * Re-prove the behaviour. `coach-engine.js`, `coach-game.js`, `coach-turn.js` and `coach-book.js`
 * each own that, and `coach_screen_test.js` owns the rendered screens. This is the third leg.
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

function read(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) { failures.push('missing ' + file); return ''; }
  return fs.readFileSync(full, 'utf8');
}

/** Strip comments, so a documented value is never mistaken for a live one. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^[ \t]*\/\/\/.*$/gm, '')
            .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The body of a `func name(` … `)`, by brace matching. */
function funcBody(src, name) {
  const at = code(src).search(new RegExp('func\\s+' + name + '\\s*[(<]'));
  if (at < 0) return null;
  const c = code(src);
  const open = c.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < c.length; i++) {
    if (c[i] === '{') depth++;
    else if (c[i] === '}') { depth--; if (depth === 0) return c.slice(open + 1, i); }
  }
  return null;
}

/** `public static let name = 12` / `: Int = 12` / `= 0.6`. */
function swNum(src, name) {
  // A trailing `// …` is tolerated rather than stripped globally: `code()` only removes whole-line
  // comments on purpose, because a blanket `//` strip would eat the inside of a string literal.
  const m = new RegExp(
    `static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*(-?[\\d._e+*\\s]+?)\\s*(?://.*)?$`, 'm')
    .exec(code(src));
  if (!m) return null;
  const text = m[1].replace(/_/g, '').trim();
  // `7 * 24 * 60 * 60 * 1000` is a product on purpose — it reads as seven days.
  if (/^[\d.\s*]+$/.test(text)) return text.split('*').reduce((a, b) => a * Number(b.trim()), 1);
  return Number(text);
}

/** `public static let name = "…"`, with `\u{XXXX}` escapes resolved. */
function swStr(src, name) {
  const m = new RegExp(`static let ${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(code(src));
  if (!m) return null;
  return unescapeSwift(m[1]);
}

function unescapeSwift(s) {
  return s
    .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// ---- The suite -----------------------------------------------------------------------------------

function run() {
  passed = 0; failures.length = 0;

  const ENG = require(path.join(JS, 'coach-engine.js'));
  const GAME = require(path.join(JS, 'coach-game.js'));
  const TURN = require(path.join(JS, 'coach-turn.js'));
  const BOOK = require(path.join(JS, 'coach-book.js'));
  const MET = require(path.join(JS, 'coach-metrics.js'));

  const swEngine = read(CORE, 'CoachEngine.swift');
  const swGame = read(CORE, 'CoachGame.swift');
  const swTurn = read(CORE, 'CoachTurn.swift');
  const swBook = read(CORE, 'CoachBook.swift');
  const swBookData = read(CORE, 'CoachBookData.swift');
  const swStrings = read(UI, 'CoachStrings.swift');
  if (!swEngine || !swGame || !swTurn || !swBook || !swBookData) return finish();

  // ── CoachEngine: the level table ────────────────────────────────────────────
  {
    const rows = [...code(swEngine).matchAll(
      /(\d+):\s*Config\(depth:\s*(\d+),\s*numMoves:\s*(\d+)\)/g)];
    eq(rows.length, 5, 'five levels in the Swift LEVEL_CONFIG');
    for (const [, lv, depth, numMoves] of rows) {
      const js = ENG.LEVEL_CONFIG[Number(lv)];
      expect(!!js, `Swift has a level ${lv} the JS does not`);
      if (!js) continue;
      eq(js.depth, Number(depth), `L${lv} depth`);
      eq(js.numMoves, Number(numMoves), `L${lv} numMoves`);
    }
    eq(ENG.MOVETIME_CAP_MS, swNum(swEngine, 'movetimeCapMs'), 'the 1 s movetime cap');
    eq(1, swNum(swEngine, 'minLevel'), 'minLevel');
    eq(5, swNum(swEngine, 'maxLevel'), 'maxLevel');
  }

  // ── CoachEngine: the think-time bands ───────────────────────────────────────
  {
    const rows = [...code(swEngine).matchAll(/(\d+):\s*Band\(min:\s*(\d+),\s*max:\s*(\d+)\)/g)];
    eq(rows.length, 5, 'five think-time bands');
    for (const [, lv, lo, hi] of rows) {
      // The JS band is private, so it is read through the function: rng 0 gives the floor and
      // rng just under 1 gives the ceiling. That checks the arithmetic as well as the table.
      eq(ENG.thinkTimeMs(Number(lv), 32, () => 0), Number(lo), `L${lv} think-time floor`);
      eq(ENG.thinkTimeMs(Number(lv), 32, () => 0.999999), Number(hi), `L${lv} think-time ceiling`);
    }
    eq(8, swNum(swEngine, 'endgamePieces'), 'the endgame piece threshold');
    eq(0.6, swNum(swEngine, 'endgameScale'), 'and the 40 % scale-down');
    // The scaled ceiling, per level, computed the same way in both languages.
    for (const lv of [1, 2, 3, 4, 5]) {
      const full = ENG.thinkTimeMs(lv, 32, () => 0.999999);
      const scaled = ENG.thinkTimeMs(lv, 7, () => 0.999999);
      const floor = ENG.thinkTimeMs(lv, 7, () => 0);
      eq(scaled, Math.max(floor, Math.round(full * 0.6)),
         `L${lv} endgame ceiling is the rounded 60 % of the full one`);
    }
  }

  // ── CoachEngine: pickIndex is the same five branches ────────────────────────
  {
    const body = funcBody(swEngine, 'pickIndex');
    expect(!!body, 'pickIndex is in the Swift');
    if (body) {
      expect(/if count <= 1 \{ return 0 \}/.test(body),
             'a single line is always index 0, before any rng is drawn');
      expect(/case 1:[\s\S]*?Int\(Double\(count\) \* rng\(\)\) % count/.test(body),
             'L1 is uniform over every line');
      expect(/case 2:[\s\S]*?rng\(\) < 0\.4 \? 0 :/.test(body), 'L2 takes the best 40 % of the time');
      expect(/case 3:[\s\S]*?rng\(\) < 0\.7 \? 0 : Swift\.min\(1, count - 1\)/.test(body),
             'L3 takes the best 70 %, else the second line');
      expect(/default:\s*return 0/.test(body), 'L4 and L5 always take the best');
    }
    // The distributions themselves, replayed through the JS with a scripted rng. Swift draws in the
    // same order, which is what the branch shapes above establish.
    const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
    eq(ENG.pickIndex([0, 1, 2], 1, seq([0.0])), 0, 'L1 rng 0.0 -> line 0');
    eq(ENG.pickIndex([0, 1, 2], 1, seq([0.5])), 1, 'L1 rng 0.5 -> line 1');
    eq(ENG.pickIndex([0, 1, 2], 1, seq([0.9])), 2, 'L1 rng 0.9 -> line 2');
    eq(ENG.pickIndex([0, 1, 2], 2, seq([0.2])), 0, 'L2 rng 0.2 -> best');
    eq(ENG.pickIndex([0, 1, 2], 2, seq([0.5, 0.9])), 2, 'L2 rng 0.5 then 0.9 -> line 2');
    eq(ENG.pickIndex([0, 1, 2], 3, seq([0.5])), 0, 'L3 rng 0.5 -> best');
    eq(ENG.pickIndex([0, 1, 2], 3, seq([0.8])), 1, 'L3 rng 0.8 -> the second line');
    eq(ENG.pickIndex([0, 1, 2], 4, seq([0.9])), 0, 'L4 ignores the rng');
    eq(ENG.pickIndex([0, 1, 2], 5, seq([0.9])), 0, 'L5 too');
  }

  // ── CoachGame: the six result strings, in three places ──────────────────────
  {
    const pairs = [['threefold', 'threefold'], ['stalemate', 'stalemate'],
                   ['fiftyMove', 'fiftyMove'], ['insufficient', 'insufficient'],
                   ['genericDraw', 'genericDraw']];
    for (const [sw, js] of pairs) {
      eq(GAME.STR[js], swStr(swGame, sw), `the ${js} line`);
    }
    const resign = /static func resign\(_ coachName: String\) -> String \{\s*"((?:[^"\\]|\\.)*)"/
      .exec(code(swGame));
    expect(!!resign, 'the resign line is a function in the Swift too');
    if (resign) {
      const swiftText = unescapeSwift(resign[1]).replace('\\(coachName)', 'Jade');
      eq(GAME.STR.resign('Jade'), swiftText, 'the resign line');
    }
    // Duplicated in the presentation layer on purpose — pure domain logic must not import it — so
    // the two copies are pinned identical here. Allow the duplication, forbid the divergence.
    if (swStrings) {
      for (const [sw] of pairs) {
        const key = { threefold: 'drawThreefold', stalemate: 'drawStalemate',
                      fiftyMove: 'drawFiftyMove', insufficient: 'drawInsufficient',
                      genericDraw: 'drawGeneric' }[sw];
        eq(swStr(swStrings, key), swStr(swGame, sw),
           `CoachStrings.${key} matches CoachGame.Str.${sw}`);
      }
    }
  }

  // ── CoachGame: the draft contract ───────────────────────────────────────────
  {
    eq('biya.coach.draft.v1.', swStr(swGame, 'draftKeyPrefix'), 'the draft key prefix');
    eq(7 * 24 * 60 * 60 * 1000, swNum(swGame, 'draftTTLms'), 'the seven-day draft TTL');
    const load = funcBody(swGame, 'loadDraft');
    expect(!!load, 'loadDraft is in the Swift');
    if (load) {
      const clears = (load.match(/clearDraft\(level: level, storage: storage\)/g) || []).length;
      expect(clears >= 3,
             `malformed, expired and unreadable drafts all delete the key (${clears} of 3 sites)`);
      expect(/now - d\.savedAt > draftTTLms/.test(load), 'the TTL is compared the same way');
      expect(/ChessPosition\(fen: r\.fen\) == nil/.test(load),
             'every record FEN must parse, or the key is deleted');
    }
    const save = funcBody(swGame, 'saveDraft');
    expect(!!save && /if isOver\(g\) \{ clearDraft/.test(save),
           'a finished game clears its draft rather than saving one');
  }

  // ── CoachGame: repetition is three fields, not four (§7 #30) ────────────────
  {
    const body = funcBody(swGame, 'repetitionKey');
    expect(!!body && /prefix\(3\)/.test(body),
           'the repetition key is the first THREE FEN fields');
    // Same key from both languages over a real FEN with an en-passant square.
    const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    eq(GAME.repetitionKey(fen), 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq',
       'and the JS drops the ep square too');
    eq(3, Number((/prefix\((\d+)\)/.exec(body) || [])[1]), 'three, stated once');
  }

  // ── CoachGame: insufficient material, branch for branch ─────────────────────
  {
    const body = funcBody(swGame, 'isInsufficientMaterial');
    expect(!!body, 'isInsufficientMaterial is in the Swift');
    if (body) {
      expect(/if others > 0 \{ return false \}/.test(body), 'any major piece or pawn ends it');
      expect(/knights == 0 && bishopColors\.isEmpty/.test(body), 'K vs K');
      expect(/knights \+ bishopColors\.count == 1/.test(body), 'K plus one minor');
      expect(/allSatisfy \{ \$0 == bishopColors\[0\] \}/.test(body),
             'bishops all on one colour cannot mate');
      expect(/\(\(sq \/ 8\) \+ \(sq % 8\)\) % 2/.test(body),
             'the square colour is computed the same way');
    }
    // The JS answers, on positions that exercise each branch.
    const E = require(path.join(JS, 'engine.js'));
    const cases = [
      ['8/8/8/4k3/8/8/8/4K3 w - - 0 1', true, 'K vs K'],
      ['8/8/8/4k3/8/8/8/3BK3 w - - 0 1', true, 'K+B vs K'],
      ['8/8/8/4k3/8/8/8/3NK3 w - - 0 1', true, 'K+N vs K'],
      ['8/8/8/2b1k3/8/8/8/3BK3 w - - 0 1', false, 'bishops on opposite colours can mate'],
      ['8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', false, 'a pawn is enough'],
      ['8/8/8/3nk3/8/8/8/3NK3 w - - 0 1', false, 'two knights is not a dead position'],
    ];
    for (const [fen, want, what] of cases) {
      eq(GAME.isInsufficientMaterial(E.fromFEN(fen)), want, what);
    }
  }

  // ── CoachTurn: one counter, and what bumps it ───────────────────────────────
  {
    const inv = funcBody(swTurn, 'invalidate');
    expect(!!inv, 'invalidate is in the Swift');
    if (inv) {
      expect(/c\.generation \+= 1/.test(inv), 'invalidate bumps the generation');
      expect(/c\.thinking = false/.test(inv), 'and clears the thinking flag');
      expect(/c\.premove = nil/.test(inv), 'and drops the premove with it');
    }
    expect(/token == c\.generation/.test(funcBody(swTurn, 'accepts') || ''),
           'accepts is generation equality and nothing else');
    const takeBack = funcBody(swTurn, 'takeBack');
    expect(!!takeBack && /invalidate\(&c\)/.test(takeBack),
           'take-back invalidates whatever is in flight');
    expect(/removed < 2/.test(takeBack || ''), 'and removes both halves of the pair');

    // The nav rule §7 #37: the two back buttons take ONE flag.
    const nav = funcBody(swTurn, 'navState');
    expect(!!nav, 'navState is in the Swift');
    if (nav) {
      expect(/canFirst: hasEarlier,[\s\S]{0,40}canPrev: hasEarlier/.test(nav),
             'canFirst and canPrev are the same expression, not two rules');
      expect(/canNext: at < last,[\s\S]{0,40}canLast: at < last/.test(nav),
             'and so are canNext and canLast');
    }
    // Replayed against the JS, which the screen test drives.
    const g = GAME.newGame(3, 'w');
    GAME.record(g, 'e2e4'); GAME.record(g, 'e7e5');
    const live = TURN.navState(g);
    eq(live.canFirst, live.canPrev, 'live: the two back buttons agree');
    eq(live.canNext, false, 'live: nothing later than the newest');
    eq(live.canLive, false, 'live: no Live button when already live');
    GAME.setReviewIndex(g, 0);
    const back = TURN.navState(g);
    eq(back.canFirst, false, 'at the start: nothing earlier');
    eq(back.canPrev, false, 'and the same flag says so');
    eq(back.canLive, true, 'and Live is offered');
  }

  // ── CoachTurn: the premove reassembles into a UCI string ────────────────────
  {
    const body = funcBody(swTurn, 'consumePremove');
    expect(!!body, 'consumePremove is in the Swift');
    if (body) {
      expect(/c\.premove = nil/.test(body), 'the premove is consumed before anything can return');
      expect(/p\.from \+ p\.to \+ \(p\.promotion \?\? ""\)/.test(body),
             'and reassembled from algebraic parts, exactly as the JS does');
    }
    const ctl = TURN.create();
    const g = GAME.newGame(3, 'w');
    TURN.begin(ctl);
    TURN.setPremove(ctl, g, 'e2', 'e4', null);
    eq(TURN.consumePremove(ctl, g, null), 'e2e4', 'a plain premove');
    TURN.begin(ctl);
    TURN.setPremove(ctl, g, 'e7', 'e8', 'q');
    eq(TURN.consumePremove(ctl, g, null), 'e7e8q', 'and one with a promotion');
    TURN.begin(ctl);
    TURN.setPremove(ctl, g, 'e2', 'e4', null);
    eq(TURN.consumePremove(ctl, g, () => false), null, 'an illegal one returns null');
    eq(ctl.premove, null, 'and is spent either way');
  }

  // ── CoachBook: the tables, row for row ──────────────────────────────────────
  {
    eq(BOOK.BOOK_PLIES, swNum(swBookData, 'bookPlies'), 'the fourteen-ply gate');

    const poolOf = (name) => {
      const m = new RegExp(`static let ${name}: \\[String\\] = \\[([^\\]]*)\\]`).exec(code(swBookData));
      return m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean) : null;
    };
    eq(BOOK.L1_WHITE.join(','), (poolOf('l1White') || []).join(','), "level 1's White pool");
    eq(BOOK.L1_BLACK.join(','), (poolOf('l1Black') || []).join(','), "and its Black pool");

    // Every repertoire row, matched by (level, side, history) -> move.
    const swiftRows = [];
    let level = null, side = null;
    for (const line of code(swBookData).split('\n')) {
      let m = /^\s{4}(\d+): \[/.exec(line);
      if (m) { level = Number(m[1]); continue; }
      m = /^\s{8}\.(white|black): \[/.exec(line);
      if (m) { side = m[1] === 'white' ? 'w' : 'b'; continue; }
      m = /Row\(history: \[([^\]]*)\], move: "([^"]+)"\)/.exec(line);
      if (m) {
        const hist = m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
        swiftRows.push({ level, side, key: hist.join(' '), move: m[2] });
        continue;
      }
      m = /Row\(atPly: (\d+), move: "([^"]+)"\)/.exec(line);
      if (m) swiftRows.push({ level, side, atPly: Number(m[1]), move: m[2] });
    }

    const jsRows = [];
    for (const lv of Object.keys(BOOK.RULES)) {
      for (const sd of ['w', 'b']) {
        for (const r of BOOK.RULES[lv][sd] || []) {
          if (r[0] === null) jsRows.push({ level: Number(lv), side: sd, atPly: r[2], move: r[1] });
          else jsRows.push({ level: Number(lv), side: sd, key: r[0].join(' '), move: r[1] });
        }
      }
    }
    eq(swiftRows.length, jsRows.length, 'the same number of book rows in both languages');
    const sig = (r) => `${r.level}${r.side}|${r.atPly === undefined ? r.key : '@' + r.atPly}`;
    const swiftBy = new Map(swiftRows.map((r) => [sig(r), r.move]));
    for (const r of jsRows) {
      eq(r.move, swiftBy.get(sig(r)), `book row ${sig(r)}`);
    }
    expect(jsRows.length >= 60, `only ${jsRows.length} repertoire rows — the table looks truncated`);
  }

  // ── CoachBook: the lookup's two rules ───────────────────────────────────────
  {
    const body = funcBody(swBook, 'bookMove');
    expect(!!body, 'bookMove is in the Swift');
    if (body) {
      expect(/sanHistory\.count >= bookPlies \{ return nil \}/.test(body),
             'the book stops at fourteen plies');
      expect(/if let isLegal = isLegal, !isLegal\(candidate\) \{ return nil \}/.test(body),
             'an unplayable book move falls through silently rather than raising');
      expect(/sanHistory\.count % 2 == 0 \? \.white : \.black/.test(body),
             'the side comes from the ply count');
    }
    const cand = funcBody(swBook, 'candidate');
    expect(!!cand, 'the row walk is in the Swift');
    if (cand) {
      expect(/history\.count == row\.atPly/.test(cand),
             'a ply-gated row matches on count alone — the London');
      expect(/want == history/.test(cand), 'and every other row on an exact history');
    }
    // Replayed: the same histories give the same moves in the JS.
    const always = () => 0;
    eq(BOOK.bookMove(3, [], null, always), 'e2e4', 'L3 opens 1.e4');
    eq(BOOK.bookMove(3, ['e4'], null, always), 'c7c5', 'and answers 1.e4 with the Sicilian');
    eq(BOOK.bookMove(4, ['d4', 'Nf6'], null, always), 'g1f3', "L4's London is ply-gated");
    eq(BOOK.bookMove(1, [], null, always), BOOK.L1_WHITE[0], 'L1 rng 0 takes the first junk move');
    eq(BOOK.bookMove(1, ['e4', 'e5'], null, always), null, 'and L1 leaves after move 1');
    eq(BOOK.bookMove(3, ['e4'], () => false, always), null,
       'an illegal candidate falls through to the engine');
    eq(BOOK.bookMove(3, 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6'.split(' '),
                     null, always), null, 'and the book is closed after fourteen plies');
  }

  // ── The roster reaches Swift whole ──────────────────────────────────────────
  {
    const swMetrics = read(UI, 'CoachMetrics.swift');
    for (const c of MET.COACHES) {
      const row = new RegExp(`CoachProfile\\(id: ${c.level}, name: "([^"]+)"[\\s\\S]{0,900}?rating: (\\d+)\\)`)
        .exec(code(swMetrics));
      expect(!!row, `coach ${c.level} is in CoachRoster`);
      if (!row) continue;
      eq(c.name, unescapeSwift(row[1]), `coach ${c.level} name`);
      eq(c.rating, Number(row[2]), `coach ${c.level} rating`);
    }
    const accents = [...code(swMetrics).matchAll(/static let level(\d) = Theme\.c\(0x([0-9A-F]{6})\)/g)];
    eq(accents.length, 5, 'five accent colours in Swift');
    for (const [, lv, hex] of accents) {
      eq(MET.ACCENTS[lv].toUpperCase(), '#' + hex, `accent ${lv}`);
    }
  }

  // ── The SwiftUI screens and the store: BRANCHES, not values ─────────────────
  //
  // A SwiftUI body cannot be run or compared value-for-value here, so what is pinned is the
  // decisions inside it. Each one below is a place the browser twin makes the same call, and each
  // is a place a plausible-looking Swift edit would silently change behaviour.
  {
    const swScreens = read(UI, 'CoachScreens.swift');
    const swStore = read(UI, 'CoachStore.swift');
    const swLayout = read(UI, 'CoachLayout.swift');
    if (swScreens && swStore) {
      // §7 #37 — the two back buttons take ONE flag, in Swift as in JS.
      const nav = /navButton\(CoachGlyph\.first, nav\?\.canFirst[\s\S]{0,400}?navButton\(CoachGlyph\.last, nav\?\.canLast/
        .exec(code(swScreens));
      expect(!!nav, 'the four nav buttons are wired in order');
      if (nav) {
        expect(/CoachGlyph\.prev, nav\?\.canPrev/.test(nav[0]),
               'and the second takes canPrev, not a second opinion about canFirst');
      }
      // §7 #24 — resign raises a prompt; only the confirmation ends the game.
      expect(/store\.confirmingResign = true/.test(code(swScreens)),
             'the resign button raises the prompt rather than resigning');
      expect(/Button \{ store\.resignConfirmed\(\) \}/.test(code(swScreens)),
             'and only the confirm button calls through');
      expect(/func resignConfirmed[\s\S]{0,200}cancelInFlight\(\)/.test(code(swStore)),
             'confirming cancels whatever is in flight first (§7 #25)');
      // §7 #27 — reviewing pauses the coach.
      const seek = funcBody(swStore, 'seek');
      expect(!!seek && /if !CoachGame\.isLive\(g\) \{ cancelInFlight\(\); return \}/.test(seek),
             'seeking into history cancels the reply in flight');
      expect(!!seek && /askCoach\(\)/.test(seek),
             'and returning to live picks the game back up');
      // §7 #33 — Continue honours the colour you tapped.
      expect(/d\.userColor == colour \? d : nil/.test(code(swScreens)),
             'Continue resumes only when the tapped colour matches the draft');
      // §7 #34 — a restored game resets the modal and sounds the start.
      const start = funcBody(swStore, 'start');
      expect(!!start && /confirmingResign = false/.test(start),
             'starting clears any modal left from last time');
      expect(!!start && /SoundManager\.shared\.gameStart\(\)/.test(start),
             'and plays the game-start sound');
      expect(!!start && /CoachGame\.applyEvaluation\(&g, coach: voice\(level: level\)\)/.test(start),
             'and re-evaluates rather than trusting the draft');
      // The book is consulted before the search, and the search is cancellable.
      const ask = funcBody(swStore, 'askCoach');
      expect(!!ask && ask.indexOf('CoachBook.bookMove') < ask.indexOf('LocalEngine()'),
             'the book is consulted before the engine');
      expect(!!ask && /cancel\.isCancelled \|\| Date\(\) > deadline/.test(ask),
             'and the search itself is cancellable, not merely its result');
      expect(!!ask && /CoachTurn\.begin\(&controller\)/.test(ask),
             'every reply is stamped with a generation token');
      const land = funcBody(swStore, 'landReply');
      expect(!!land && /CoachTurn\.settle\(&controller, token: token\) else \{ return \}/.test(land),
             'and dropped unless the token still matches');
      expect(!!land && /consumePremove/.test(land),
             'the premove is consumed when the reply lands');
      // The reply is PACED, not delayed: §2.13's floor must not become an addition.
      expect(/Double\(think\) \/ 1000 - spent/.test(code(swStore)),
             'the wait runs down whatever the search already spent');
      // The Review button, and the modal behind it (§2.10). This assertion used to say the
      // OPPOSITE — that no button was drawn while the screen did not exist. It is inverted rather
      // than deleted, because the reminder is what brought the work back.
      expect(/CoachStrings\.reviewGame/.test(code(swScreens)),
             'the Review button is drawn now that spec 2.10 is built');
      expect(/CoachReview\.isReviewable\(g\)/.test(code(swScreens)),
             'and only for a game there is something to review in');
      expect(/CoachReview\.columns\(summary, userColor: userColor\)/.test(code(swScreens)),
             'the modal reads ONE column order, which is the 2.10 orientation fix');
      const results = funcBody(swScreens, 'reviewResults');
      expect(!!results && /CoachReview\.classificationRows\(summary, userColor: userColor\)/
               .test(results),
             'and the rows read the same one, so they cannot disagree with the accuracy above');
      expect(/store\.handOffReview\(\)/.test(code(swScreens)),
             'Start Review hands off');
      const handoff = funcBody(swStore, 'reviewHandoff');
      expect(!!handoff && /case \.done\(let summary\) = review else \{ return nil \}/.test(handoff),
             'and the hand-off reads the summary from the state, never a captured variable (§7 #28)');
      const startReview = funcBody(swStore, 'startReview');
      expect(!!startReview && /guard walker\.isComplete else/.test(startReview),
             'a cancelled review is discarded, never reported as a short one');
      expect(!!startReview && /CoachReview\.reviewDepth/.test(startReview),
             'and the batch runs at the spec depth');
      // The board never decides whether a tap is a move or a premove.
      expect(/if CoachTurn\.canUserMove\(g, store\.controller\) \{[\s\S]{0,120}store\.userMove/
             .test(code(swScreens)),
             'the controller decides move vs premove, not the board');
    }
    // No numeric literal in a view body: every number is a metrics or CoachLayout constant.
    if (swScreens) {
      const bodies = code(swScreens);
      // Anchored after `(`, `,` or `:` so a digit inside an identifier (`level1`, `Float3`) is not
      // mistaken for a literal — the same anchoring `replay_pairing.js` had to learn.
      // `0` and `1` are excluded, as the sibling pairing check does: they are origins and
      // identities — `CGPoint(x: 0, …)` for the left edge of a path — not design values. Any other
      // number in a body is a metrics constant that did not get used.
      const literals = [...bodies.matchAll(/[(,:]\s*(-?\d+(?:\.\d+)?)\s*[),]/g)]
        .map((m) => m[1])
        .filter((n) => n !== '0' && n !== '1');
      eq(literals.join(', '), '', 'no numeric literal reaches a CoachScreens view body');
    }
    if (swLayout) {
      // Everything unextracted is in one file, so PORTING_NOTES can enumerate it — but the two
      // enums are counted SEPARATELY, because they are different kinds of thing. Lumping them gave
      // a number that meant nothing: five icons made the "invented constants" budget look spent.
      const enumBody = (name) => {
        const at = code(swLayout).indexOf('enum ' + name + ' {');
        return at < 0 ? '' : code(swLayout).slice(at, code(swLayout).indexOf('\n}', at));
      };
      // Only the ones that are actually INVENTED count against the budget. An entry whose value
      // is read from the extraction is not a new number, it is a rename — and lumping the two
      // together makes the budget mean nothing.
      const decls = [...enumBody('CoachLayout')
        .matchAll(/static (?:let|var) (\w+)[^=]*=\s*(.+)/g)];
      const layout = decls.filter(([, , rhs]) => !/Coach(Select|Play|Layout)\./.test(rhs))
        .map((m) => m[1]);
      const glyphs = [...enumBody('CoachGlyph').matchAll(/static let (\w+)/g)].map((m) => m[1]);
      expect(layout.length > 0 && glyphs.length > 0, 'both unextracted enums are found');
      expect(layout.length <= 10,
             `${layout.length} INVENTED layout constants — the list is growing`);
      expect(decls.length > layout.length,
             'and some of CoachLayout is derived from the extraction rather than chosen');
      // FOUR, not five. `back` was retired: it is a vector now (NavIcons.swift / js/icons.js), and
      // "an icon that happens to be a character" was exactly the thing that rendered in a fallback
      // face on a real phone. The four transport arrows stay glyphs.
      eq(glyphs.length, 4, 'four transport glyphs, no more — back is a vector now');
      expect(glyphs.indexOf('back') < 0,
             'and `back` is not among them; nav_icons_check.js asserts it does not come back');
      // Three of the twelve are DERIVED from extracted values rather than chosen, which is why
      // they are allowed at all. If one is ever replaced by a bare number the count still passes,
      // so the derivation itself is what is pinned.
      for (const [name, from] of [['sectionGap', 'CoachSelect.titleSubMarginTop'],
                                  ['stripGap', 'CoachPlay.moveStripContentGap'],
                                  ['disabledOpacity', 'CoachPlay.navBtnDisabledOpacity'],
                                  ['premoveChipInset', 'CoachPlay.premoveChipPaddingHorizontal']]) {
        expect(new RegExp(`static let ${name}[^=]*=\\s*${from.replace('.', '\\.')}`)
                 .test(enumBody('CoachLayout')),
               `${name} is derived from ${from}, not chosen`);
      }
    }
  }

  // ── CoachReview: the adapter, against the JS ────────────────────────────────
  {
    const RV = require(path.join(JS, 'coach-review.js'));
    const swReview = read(CORE, 'CoachReview.swift');
    if (swReview) {
      eq(RV.REVIEW_DEPTH, swNum(swReview, 'reviewDepth'), "spec 2.10's batch depth");
      eq(RV.MIN_POSITIONS, swNum(swReview, 'minPositions'), 'the minimum reviewable size');

      const bands = [...code(swReview).matchAll(/if pct >= (\d+) \{ return "(#[0-9A-F]{6})" \}/g)];
      eq(bands.length, 3, 'three accuracy thresholds plus a fallback');
      for (const [, at, hex] of bands) {
        eq(RV.accuracyColor(Number(at)), hex, `the accuracy band at ${at}`);
        eq(RV.accuracyColor(Number(at) - 0.1) === hex, false, `and it is a floor, not a range`);
      }
      // The LAST `return` in the function, which is the fallback below every band. Matching the
      // first one found the top band instead and compared green against red.
      const returns = [...(funcBody(swReview, 'accuracyColorHex') || '')
        .matchAll(/return "(#[0-9A-F]{6})"/g)].map((m) => m[1]);
      eq(returns.length, 4, 'four colours: three bands and a fallback');
      eq(RV.accuracyColor(0), returns[returns.length - 1],
         'and the fallback below the last band');

      // The orientation fix, branch for branch.
      const cols = funcBody(swReview, 'columns');
      expect(!!cols, 'columns is in the Swift');
      if (cols) {
        expect(/label: "You"/.test(cols) && /label: "Coach"/.test(cols),
               'your column comes first, whichever colour you played');
        expect(/userColor == .white \? s.whiteAccuracy : s.blackAccuracy/.test(cols),
               'and its accuracy is read by the SAME test the counts are');
      }
      const rows = funcBody(swReview, 'classificationRows');
      expect(!!rows && /columns\(s, userColor: userColor\)/.test(rows),
             'the rows are built FROM the columns, which is what makes them agree');
      expect(!!rows && /if left == 0 && right == 0 \{ continue \}/.test(rows),
             'and a class that is zero on both sides is skipped');

      // The hand-off cannot be empty (§7 #28).
      const ho = funcBody(swReview, 'handoff');
      expect(!!ho && /guard let s = summary, !s.moveEvaluations.isEmpty else \{ return nil \}/
               .test(ho),
             'an absent or empty summary produces no hand-off at all');
      expect(!!ho && /classifications: s.moveEvaluations/.test(ho),
             'and a real one carries the classifications');

      // The graph clamps the same way in both languages.
      const gp = funcBody(swReview, 'graphPoints');
      expect(!!gp && /guard graph.count >= 2 else \{ return \[\] \}/.test(gp),
             'a single point draws no curve');
      expect(!!gp && /height \/ 2 - \(cp \/ clampCp\) \* \(height \/ 2\)/.test(gp),
             'and y is measured downwards from the midline, as the JS does');
      const jsPts = RV.graphPoints([{ eval_cp: 0 }, { eval_cp: 9000 }, { eval_cp: -9000 }], 100, 60);
      eq(jsPts[1].cp, MET.PLAY.graph.clampCp, 'the JS clamps to the extracted CLAMP');
      eq(jsPts[1].y, 0, 'a clamped white advantage is the top of the box');
      eq(jsPts[2].y, 60, 'and a clamped black one the bottom');
    }
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayCoach: ${passed} Swift expectations confirmed against the JS`
      : `ReplayCoach: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
