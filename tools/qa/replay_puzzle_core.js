#!/usr/bin/env node
/*
 * replay_puzzle_core.js — check the Swift `puzzle_*` groups against the JavaScript that has
 * actually executed.
 *
 *     node tools/qa/replay_puzzle_core.js
 *
 * `swift` is not on PATH on this checkout, so the Swift in `Sources/ParityRunner/main.swift` and
 * in the three `Puzzle*.swift` Core files is written blind. This is the mitigation every phase of
 * this rebuild has used: pull the concrete (input, expectation) pairs straight out of the Swift
 * SOURCE TEXT and run them through the JS twins, which are proven by `puzzle_core_test.js` and
 * mutation-tested by `puzzle_core_mutation_test.js`.
 *
 * It does not prove the Swift compiles. It proves the numbers, strings and tables in it are the
 * right ones — the half a compiler would not have caught anyway. It also checks that the fixtures
 * are REAL corpus rows rather than something plausible-looking, because a fixture invented by hand
 * would make every assertion above it self-consistent and wrong.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'web-demo', 'js');
const E = require(path.join(JS, 'engine.js'));
const S = require(path.join(JS, 'puzzle-session.js'));
const SERVE = require(path.join(JS, 'puzzle-serving.js'));
const STORE = require(path.join(JS, 'puzzle-store.js'));
const PROG = require(path.join(JS, 'puzzle-progress.js'));

const MAIN = path.join(ROOT, 'Sources', 'ParityRunner', 'main.swift');
const CORE = path.join(ROOT, 'Sources', 'BiyaherongCoachCore');
const DB_PATH = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'puzzles.sqlite');

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
/** `want` is always the value read out of the Swift source; `got` is what the JS produced. */
const eq = (got, want, what) => expect(got === want,
  `${what}: Swift says ${JSON.stringify(want)}, JS gives ${JSON.stringify(got)}`);
/** The same check with the arguments the other way round, for readability at the call site. */
const swiftIs = (swift, js, what) => eq(js, swift, what);

/**
 * The body of a top-level `enum X { … }`, by brace matching.
 *
 * Needed because these files declare a dozen namespaces and a bare regex for `static let radius`
 * would happily match whichever one came first.
 */
function blockOf(src, name) {
  const at = src.search(new RegExp('(?:public )?enum ' + name + '\\b[^\\n{]*\\{'));
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

/** Strip // and /* *​/ comments so a documented value is never mistaken for a live one. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
}

function run() {
  passed = 0; failures.length = 0;

  const swift = fs.readFileSync(MAIN, 'utf8');
  const sessionSrc = code(fs.readFileSync(path.join(CORE, 'PuzzleSession.swift'), 'utf8'));
  const selSrc = code(fs.readFileSync(path.join(CORE, 'PuzzleSelection.swift'), 'utf8'));
  const progSrc = code(fs.readFileSync(path.join(CORE, 'PuzzleProgress.swift'), 'utf8'));

  // ---- 1. the fixture table ------------------------------------------------------
  // PZFixture(key: "…", id: N, fen: "…",
  //           moves: ["…", …],
  //           rating: N, themes: [ … ],
  //           userIsWhite: B, flipped: B,
  //           wrongMove: "…", pgn: "…"),
  const re = new RegExp(
    'PZFixture\\(key: "([^"]+)", id: (\\d+),\\s*' +
    'lichessId: "([^"]+)", fen: "([^"]+)",\\s*' +
    'moves: \\[([^\\]]*)\\],\\s*' +
    'rating: (\\d+), themes: \\[([^\\]]*)\\],\\s*' +
    'userIsWhite: (true|false), flipped: (true|false),\\s*' +
    'wrongMove: "([^"]*)", pgn: "([^"]*)"\\)', 'g');
  const strs = (s) => s.split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean);

  let m, fixtures = [];
  while ((m = re.exec(swift)) !== null) {
    fixtures.push({
      key: m[1], id: +m[2], lichessId: m[3], fen: m[4], moves: strs(m[5]), rating: +m[6],
      themes: strs(m[7]), userIsWhite: m[8] === 'true', flipped: m[9] === 'true',
      wrongMove: m[10], pgn: m[11].replace(/\\"/g, '"'),
    });
  }
  expect(fixtures.length >= 7, `found ${fixtures.length} fixtures in main.swift (expected >= 7)`);

  // Every fixture must be a row of the SHIPPING corpus, byte for byte. A hand-written fixture
  // would make every assertion built on it self-consistent and wrong — and a fixture carrying the
  // browser slice's renumbered id would silently point at a different puzzle, which is exactly
  // what the first run of this check caught.
  if (fs.existsSync(DB_PATH)) {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const byId = db.prepare('SELECT lichess_id, fen, moves, rating FROM puzzles WHERE id = ?');
    const byLichess = db.prepare('SELECT id FROM puzzles WHERE lichess_id = ?');
    for (const f of fixtures) {
      const row = byId.get(f.id);
      expect(!!row, `[${f.key}] puzzle #${f.id} exists in the bundle`);
      if (row) {
        eq(row.lichess_id, f.lichessId, `[${f.key}] the id and the lichess id agree`);
        eq(row.fen, f.fen, `[${f.key}] fen matches the bundle`);
        eq(row.moves, f.moves.join(' '), `[${f.key}] moves match the bundle`);
        eq(row.rating, f.rating, `[${f.key}] rating matches the bundle`);
      }
      const back = byLichess.get(f.lichessId);
      eq(back && back.id, f.id, `[${f.key}] the lichess id resolves back to the same row`);
    }
    db.close();
  } else {
    failures.push('puzzles.sqlite is missing — run tools/puzzlebank/build_puzzles.py');
  }

  // ---- 2. every fixture expectation, recomputed --------------------------------
  for (const f of fixtures) {
    const puzzle = { id: f.id, fen: f.fen, moves: f.moves, rating: f.rating, themes: f.themes,
                     openingTags: [] };
    const s = S.create(puzzle, 'play');
    eq(s.userColor === E.WHITE, f.userIsWhite, `[${f.key}] userIsWhite`);
    eq(s.flipped, f.flipped, `[${f.key}] flipped`);
    eq(S.solutionPGN(puzzle), f.pgn, `[${f.key}] the Save Puzzle PGN`);
    expect(f.moves.length % 2 === 0, `[${f.key}] an even move count`);

    // The wrong move must be legal, not the answer, and not mate — otherwise the wrong-move
    // table above it would be asserting the checkmate short-circuit by accident.
    if (f.wrongMove) {
      S.applySetupMove(s);
      const mv = E.parseUci(s.position, f.wrongMove);
      expect(!!mv, `[${f.key}] the wrongMove is legal after the setup move`);
      expect(f.wrongMove !== f.moves[1], `[${f.key}] and is not the expected answer`);
      if (mv) {
        expect(E.status(E.makeMove(s.position, mv)) !== 'checkmate',
          `[${f.key}] and does not deliver mate`);
      }
    }
  }

  // The off-book mate must genuinely be a second, different mate.
  const alt = /let pzOffbookMate = "([a-h][1-8][a-h][1-8][qrbn]?)"/.exec(swift);
  expect(!!alt, 'pzOffbookMate is declared');
  const off = fixtures.find(f => f.key === 'offbook');
  if (alt && off) {
    const s = S.create({ id: off.id, fen: off.fen, moves: off.moves, rating: off.rating,
                         themes: off.themes }, 'play');
    S.applySetupMove(s);
    const mv = E.parseUci(s.position, alt[1]);
    expect(!!mv, 'the off-book mate is legal');
    expect(alt[1] !== off.moves[1], 'and is NOT the stored answer');
    if (mv) {
      eq(E.status(E.makeMove(s.position, mv)), 'checkmate', 'and really is mate');
    }
  }

  // ---- 3. the constant tables, Swift source vs the proven JS ---------------------
  // Part 17 timings.
  const delay = (mode) => {
    const block = /func opponentDelayMs\(_ mode: Mode\) -> Int \{[\s\S]*?\n        \}/.exec(sessionSrc);
    if (!block) return null;
    const rx = new RegExp(`case[^\\n]*\\.${mode}\\b[^\\n]*: return (\\d+)`);
    const hit = rx.exec(block[0]);
    return hit ? +hit[1] : null;
  };
  for (const mode of S.MODES) {
    eq(S.TIMING.opponentDelayMs[mode], delay(mode), `Timing.opponentDelayMs(.${mode})`);
  }
  const num = (src, name) => {
    const hit = new RegExp(`static let ${name} = ([\\d_]+(?:\\s*\\*\\s*[\\d_]+)*)`).exec(src);
    if (!hit) return null;
    return hit[1].split('*').map(x => parseInt(x.replace(/_/g, ''), 10)).reduce((a, b) => a * b, 1);
  };
  eq(S.TIMING.turboAdvanceMs, num(sessionSrc, 'turboAdvanceMs'), 'Timing.turboAdvanceMs');
  eq(S.TIMING.turboFeedbackMs, num(sessionSrc, 'turboFeedbackMs'), 'Timing.turboFeedbackMs');
  eq(S.TIMING.dailyWrongBannerMs, num(sessionSrc, 'dailyWrongBannerMs'), 'Timing.dailyWrongBannerMs');
  eq(S.TIMING.tickMs, num(sessionSrc, 'tickMs'), 'Timing.tickMs');
  eq(S.TIMING.goalRingMs, num(sessionSrc, 'goalRingMs'), 'Timing.goalRingMs');
  eq(S.TIMING.draftTtlMs, num(sessionSrc, 'draftTTLMs'), 'Timing.draftTTLMs');

  // Part 5.5, the wrong-move policy table — the eight flags, per mode, out of the Swift switch.
  const policyBlock = /public static func wrongPolicy\([\s\S]*?\n    \}/.exec(sessionSrc);
  expect(!!policyBlock, 'the wrongPolicy switch is present');
  if (policyBlock) {
    for (const mode of S.MODES) {
      // The lookahead must also match the END of the switch, or the last case (.turbo) never
      // matches and its eight flags go unchecked.
      const rx = new RegExp(`case \\.${mode}:([\\s\\S]*?)(?=\\n        case \\.|\\n        \\})`);
      const hit = rx.exec(policyBlock[0]);
      expect(!!hit, `wrongPolicy has a .${mode} case`);
      if (!hit) continue;
      const text = hit[1];
      const flag = (n) => new RegExp(`${n}: (true|false)`).exec(text)?.[1] === 'true';
      const optInt = (n) => {
        const v = new RegExp(`${n}: ([A-Za-z.\\d_]+)`).exec(text)?.[1];
        if (v === 'nil' || v == null) return null;
        if (/^\d+$/.test(v)) return +v;
        // A named constant, e.g. `Timing.dailyWrongBannerMs`.
        return num(sessionSrc, v.split('.').pop());
      };
      const want = S.WRONG_POLICY[mode];
      swiftIs(flag('undo'), want.undo, `wrongPolicy(.${mode}).undo`);
      swiftIs(flag('staysPlayable'), want.staysPlayable, `wrongPolicy(.${mode}).staysPlayable`);
      swiftIs(flag('endsRun'), want.endsRun, `wrongPolicy(.${mode}).endsRun`);
      swiftIs(flag('costsALife'), want.costsALife, `wrongPolicy(.${mode}).costsALife`);
      swiftIs(flag('gameOverSound'), want.gameOverSound, `wrongPolicy(.${mode}).gameOverSound`);
      swiftIs(flag('offersRetry'), want.offersRetry, `wrongPolicy(.${mode}).offersRetry`);
      swiftIs(optInt('bannerMs'), want.bannerMs, `wrongPolicy(.${mode}).bannerMs`);
      swiftIs(optInt('advanceMs'), want.advanceMs, `wrongPolicy(.${mode}).advanceMs`);
    }
  }

  // The daily-goal predicate — one place, and it must exclude exactly Turbo.
  expect(/countsTowardDailyGoal\(_ mode: Mode\) -> Bool \{ mode != \.turbo \}/.test(sessionSrc),
    'countsTowardDailyGoal excludes exactly Turbo');

  // The epoch and the 12 UI themes.
  const epoch = /dailyEpoch = DateComponents\(year: (\d+), month: (\d+), day: (\d+)\)/.exec(selSrc);
  expect(!!epoch, 'the daily epoch is declared');
  if (epoch) {
    swiftIs(+epoch[1], STORE.DAILY_EPOCH.year, 'daily epoch year');
    swiftIs(+epoch[2], STORE.DAILY_EPOCH.month, 'daily epoch month');
    swiftIs(+epoch[3], STORE.DAILY_EPOCH.day, 'daily epoch day');
  }
  const themes = /uiThemes = \[([\s\S]*?)\]/.exec(selSrc);
  expect(!!themes, 'uiThemes is declared');
  if (themes) {
    const list = strs(themes[1].replace(/\s+/g, ' '));
    swiftIs(list.join(','), STORE.UI_THEMES.join(','), 'the 12 UI themes, in grid order');
  }

  // Progress constants.
  eq(PROG.DEFAULT_RATING, num(progSrc, 'defaultRating'), 'PuzzleProgress.defaultRating');
  eq(PROG.STATE_VERSION, num(progSrc, 'stateVersion'), 'PuzzleProgress.stateVersion');
  eq(180, /func turboSeconds[\s\S]*?case 3: return (\d+)/.exec(sessionSrc) &&
     +/func turboSeconds[\s\S]*?case 3: return (\d+)/.exec(sessionSrc)[1], '3-minute Turbo');
  eq(300, /func turboSeconds[\s\S]*?case 5: return (\d+)/.exec(sessionSrc) &&
     +/func turboSeconds[\s\S]*?case 5: return (\d+)/.exec(sessionSrc)[1], '5-minute Turbo');
  expect(/goalLookbackDays = 365/.test(progSrc), 'the 365-day goal lookback');

  // ---- 4. the invariants the Swift must NOT break --------------------------------
  // Spec fix #10: nothing in this feature may call the server's first-move-only comparator.
  for (const [name, src] of [['PuzzleSession', sessionSrc], ['PuzzleSelection', selSrc],
                             ['PuzzleProgress', progSrc]]) {
    expect(src.indexOf('compareMoves') < 0,
      `${name}.swift never calls compareMoves — it compares against the OPPONENT's move`);
  }
  // The Parity Core stays Foundation-only.
  for (const [name, file] of [['PuzzleSession', 'PuzzleSession.swift'],
                              ['PuzzleSelection', 'PuzzleSelection.swift'],
                              ['PuzzleProgress', 'PuzzleProgress.swift']]) {
    const raw = fs.readFileSync(path.join(CORE, file), 'utf8');
    const imports = [...raw.matchAll(/^import\s+(\w+)/gm)].map(x => x[1]);
    eq(imports.join(','), 'Foundation', `${name}.swift imports Foundation and nothing else`);
  }
  // Spec fix #7 must be expressed as a scope, not a blanket wipe.
  expect(/case theme\(String\)/.test(selSrc) && /case window\(lo: Int, hi: Int\)/.test(selSrc),
    'the Tier-3 scope distinguishes a theme from a rating band');
  // The pinned ladder must be untouched: PuzzleSelection may not redefine the predicates.
  expect(selSrc.indexOf('PuzzleServing.eligibleInWindow') > 0
         && selSrc.indexOf('PuzzleServing.closestByAbs') > 0,
    'ArrayPool delegates to PuzzleServing rather than restating its predicates');
  // Every ported sort must have an explicit tie-break: Swift's sort is not stable.
  const sorts = [...progSrc.matchAll(/\.sorted\s*(\{|\()/g)].length;
  expect(sorts >= 2, `PuzzleProgress has ${sorts} sorts to check`);
  expect(/\$0\.solvedAt > \$1\.solvedAt : \$0\.puzzleId > \$1\.puzzleId/.test(progSrc),
    'ratingHistory breaks its sort tie on the id — Swift sort is not stable');

  // ---- 5. the floors are declared and are not vacuous ----------------------------
  for (const g of ['puzzle_session', 'puzzle_selection', 'puzzle_progress']) {
    const hit = new RegExp(`"${g}": (\\d+)`).exec(swift);
    expect(!!hit, `${g} has a requireMinCounts floor`);
    if (hit) expect(+hit[1] >= 50, `${g}'s floor (${hit[1]}) is not vacuous`);
    expect(swift.indexOf(`h.begin("${g}")`) > 0, `${g} is actually begun`);
  }

  // ---- 5b. the presentation layer, Swift vs the proven JS ---------------------------
  // `PuzzleMetrics.swift` and `PuzzleStats.swift` are blind-written too, and the metrics layer is
  // where a wrong number is least visible: it renders, it just renders wrong.
  {
    const METRICS = path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'PuzzleMetrics.swift');
    const STATS_SW = path.join(CORE, 'PuzzleStats.swift');
    if (!fs.existsSync(METRICS)) { failures.push('PuzzleMetrics.swift is missing'); }
    else {
      const met = code(fs.readFileSync(METRICS, 'utf8'));
      const MET = require(path.join(JS, 'puzzle-metrics.js'));

      /** `public static let name: T = 12.5` / `= 12.5` */
      const swNum = (src, ns, name) => {
        const block = blockOf(src, ns);
        if (!block) return null;
        const m = new RegExp(`static let ${name}(?::\\s*[A-Za-z]+)?\\s*=\\s*(-?[\\d.]+)`).exec(block);
        return m ? Number(m[1]) : null;
      };
      const swHex = (src, ns, name) => {
        const block = blockOf(src, ns);
        if (!block) return null;
        const m = new RegExp(`static let ${name}\\s*=\\s*Theme\\.c\\(0x([0-9A-Fa-f]{6})\\)`).exec(block);
        return m ? '#' + m[1].toUpperCase() : null;
      };
      const swStr = (src, ns, name) => {
        const block = blockOf(src, ns);
        if (!block) return null;
        const m = new RegExp(`static let ${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(block);
        return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
      };

      // Palette
      for (const [swName, jsName] of [['screenBg', 'screenBg'], ['card', 'card'],
           ['cardAlt', 'cardAlt'], ['textPrimary', 'textPrimary'],
           ['textSecondary', 'textSecondary'], ['gold', 'gold'], ['onGold', 'onGold'],
           ['correct', 'correct'], ['wrong', 'wrong'], ['engineEval', 'engineEval'],
           ['shareBlue', 'shareBlue'], ['ratedGreen', 'ratedGreen'],
           ['thematicPurple', 'thematicPurple'], ['streakOrange', 'streakOrange']]) {
        swiftIs(swHex(met, 'PuzzlePalette', swName), MET.PALETTE[jsName],
                `PuzzlePalette.${swName}`);
      }

      // Geometry, per namespace — the same keys both languages encode.
      const NS = [
        ['PuzzleHub', MET.HUB, ['headerPaddingH', 'headerPaddingV', 'backBtnW', 'backBtnH',
          'heroPaddingTop', 'heroPaddingBottom', 'heroGap', 'heroGlowSize', 'heroGlowRadius',
          'heroGlowBorder', 'heroGlowMarginBottom', 'cardsPaddingH', 'cardsPaddingBottom',
          'cardRadius', 'cardPaddingV', 'cardPaddingH', 'cardBorderLeft', 'cardGap',
          'cardShadowOpacity', 'cardShadowRadius', 'cardShadowY', 'tileSize', 'tileRadius',
          'tileBorder', 'titleMarginBottom', 'badgePaddingH', 'badgePaddingV', 'badgeRadius',
          'badgeLetterSpacing', 'chevronLineHeight', 'pressOpacity']],
        ['PuzzleGoalStrip', MET.GOAL, ['radius', 'paddingH', 'paddingV', 'borderWidth', 'marginH',
          'marginBottom', 'rowGap', 'ringSize', 'ringStroke', 'ringLabelSize', 'titleSize',
          'subSize', 'pillRadius', 'pillPaddingH', 'pillPaddingV', 'pillTextSize']],
        ['PuzzlePlayHome', MET.PLAY_HOME, ['headerPaddingH', 'headerPaddingTop',
          'headerPaddingBottom', 'badgePaddingH', 'badgePaddingV', 'badgeRadius', 'topPaddingH',
          'topGap', 'heroRadius', 'heroPaddingH', 'heroPaddingV', 'heroGap', 'heroBorder',
          'heroSubMarginTop', 'statRowRadius', 'statRowPaddingH', 'statRowPaddingV',
          'statPaddingH', 'statLabelMarginTop', 'dividerW', 'dividerH', 'bottomPaddingH',
          'bottomPaddingBottom', 'bottomPaddingTop', 'bottomGap', 'infoRadius', 'infoPaddingH',
          'infoPaddingV', 'infoBorder', 'infoLineHeight', 'shareRadius', 'sharePaddingV',
          'playRadius', 'playPaddingV', 'playShadowY', 'playShadowOpacity', 'playShadowRadius']],
        ['PuzzleStatsStyle', MET.STATS, ['cardRadius', 'cardPadding', 'cardMarginBottom',
          'sectionTitleSize', 'ratingSize', 'ratingLabelSize', 'bestSize', 'deltaSize',
          'sparkHeight', 'sparkRadius', 'sparkStrokeWidth', 'sparkPadding', 'sparkYMargin',
          'accuracySize', 'accuracySubSize', 'barMaxHeight', 'barMinHeight', 'barWidth',
          'barRadius', 'barCountHeight', 'barCountSize', 'barDaySize', 'barRowMarginTop',
          'themeNameSize', 'themeTrackHeight', 'themeTrackRadius', 'themePctSize',
          'themePctMinWidth', 'emptySize']],
        ['PuzzleSolverStyle', MET.SOLVER, ['headerPaddingH', 'headerPaddingV', 'headerHeight',
          'backBtnW', 'backBtnH', 'backIconSize', 'logoSize', 'spacerW', 'infoStripHeight',
          'infoStripPaddingH', 'statsPaddingV', 'statsPaddingH', 'statLabelMarginBottom',
          'ratingDeltaMarginTop', 'bottomPaddingH', 'bottomPaddingTop', 'wrongRowGap',
          'retryRadius', 'retryPaddingV', 'retryBorder', 'solutionRadius', 'solutionPaddingV',
          'nextRadius', 'nextPaddingH', 'nextPaddingV', 'nextMarginTop', 'nextMarginBottom',
          'loadingTextSize', 'loadingMarginTop']],
        ['PuzzleEnginePanel', MET.ENGINE, ['radius', 'padding', 'borderWidth',
          'headerMarginBottom', 'titleSize', 'refreshSize', 'rowPaddingV', 'rowGap',
          'rowBorderWidth', 'dotSize', 'dotWidth', 'sanSize', 'sanWidth', 'evalSize', 'evalWidth',
          'pvSize', 'playLines', 'thematicLines', 'pvFrom', 'pvTo']],
        ['PuzzlePromotion', MET.PROMOTION, ['dialogRadius', 'dialogPadding', 'dialogWidth',
          'titleSize', 'titleMarginBottom', 'optionsGap', 'optionRadius', 'optionPadding',
          'optionGap', 'optionTextSize', 'glyphSize']],
        ['PuzzleSaveSheet', MET.SAVE_SHEET, ['buttonRadius', 'buttonPaddingV', 'buttonMarginTop',
          'buttonBorder', 'buttonTextSize', 'cardRadiusTop', 'cardPadding', 'cardPaddingBottom',
          'titleSize', 'titleMarginBottom', 'labelSize', 'labelMarginBottom', 'inputRadius',
          'inputSize', 'inputPaddingH', 'inputPaddingV', 'inputMarginBottom', 'inputBorder',
          'notesMinHeight', 'rowGap', 'rowMarginTop', 'buttonRowTextSize', 'nameMax']],
        ['PuzzleDailyHome', MET.DAILY_HOME, ['headerPaddingH', 'headerPaddingTop',
          'headerPaddingBottom', 'contentPaddingH', 'contentPaddingBottom', 'heroRadius',
          'heroPadding', 'heroMarginBottom', 'heroBorder', 'heroIconSize', 'heroIconMarginBottom',
          'heroTitleMarginBottom', 'statsGap', 'statsMarginBottom', 'statCardRadius',
          'statCardPadding', 'statCardGap', 'statCardBorder', 'statEmojiSize', 'statValueSize',
          'statLabelSize', 'infoRadius', 'infoPadding', 'infoMarginBottom', 'infoBorder',
          'infoTitleSize', 'infoTitleMarginBottom', 'infoTextSize', 'infoLineHeight',
          'startRadius', 'startPaddingV', 'startShadowY', 'startShadowOpacity',
          'startShadowRadius', 'solvedRadius', 'solvedPadding', 'solvedGap', 'solvedBorder',
          'solvedIconSize', 'solvedSubLineHeight']],
        ['PuzzleDailySolver', MET.DAILY_SOLVER, ['headerPaddingH', 'headerPaddingV',
          'headerSubMarginTop', 'headerSubMaxWidth', 'feedbackMarginH', 'feedbackRadius',
          'feedbackPadding', 'feedbackMarginTop', 'feedbackGap', 'feedbackIconSize',
          'instructionPaddingV', 'doneMarginH', 'doneRadius', 'donePaddingV', 'doneMarginTop',
          'loadingMarginTop']],
        ['PuzzleThematicGrid', MET.THEMATIC_GRID, ['headerPaddingH', 'headerPaddingTop',
          'headerPaddingBottom', 'badgeRowGap', 'badgeRowMarginBottom', 'badgePaddingH',
          'badgePaddingV', 'badgeRadius', 'badgeLetterSpacing', 'sectionLabelMarginBottom',
          'sectionLabelPaddingH', 'gridPaddingH', 'gridPaddingBottom', 'gridGap', 'gridRowGap',
          'cols', 'rows', 'cardRadius', 'cardBorder', 'cardPadding', 'startRadius',
          'startPaddingV', 'startMarginH', 'startMarginBottom', 'startDisabledOpacity']],
        ['PuzzleThematicSolver', MET.THEMATIC_SOLVER, ['headerPaddingH', 'headerPaddingV',
          'headerSubMarginTop', 'statsRadius', 'statsPadding', 'statsMarginH', 'statsMarginTop',
          'statsMarginBottom', 'statsShadowY', 'statsShadowOpacity', 'statsShadowRadius',
          'statLabelSize', 'statLabelMarginBottom', 'statLabelLetterSpacing', 'statValueSize',
          'feedbackMarginH', 'feedbackRadius', 'feedbackPadding', 'feedbackMarginBottom',
          'feedbackGap', 'feedbackTextSize', 'wrongRowGap', 'retryRadius', 'retryPaddingV',
          'retryBorder', 'solutionRadius', 'solutionPaddingV', 'nextRadius', 'nextPaddingH',
          'nextPaddingV', 'nextMarginTop', 'buttonTextSize', 'enginePadding', 'engineMarginH',
          'engineMarginTop', 'engineHeaderMarginBottom', 'engineRowPaddingV', 'hintMarginH',
          'hintPaddingV', 'hintSize', 'loadingMarginTop']],
        ['PuzzleStreakHome', MET.STREAK_HOME, ['headerPaddingH', 'headerPaddingTop', 'headerPaddingBottom', 'badgePaddingH',
          'badgePaddingV', 'badgeRadius', 'topPaddingH', 'topGap', 'displayRadius',
          'displayPadding', 'displayMinHeight', 'displayBorder', 'numberSize',
          'numberLineHeight', 'labelSize', 'labelMarginTop', 'subSize', 'subMarginTop',
          'statsGap', 'statRadius', 'statPaddingV', 'statGap', 'statBorder', 'statEmojiSize',
          'statValueSize', 'statLabelSize', 'listTitleSize', 'listPaddingH', 'listPaddingTop',
          'listPaddingBottom', 'countBadgeRadius', 'countBadgePaddingH', 'countBadgePaddingV',
          'countBadgeSize', 'rowRadius', 'rowPaddingH', 'rowPaddingV', 'rowMarginBottom',
          'rowGap', 'rowScoreSize', 'rowScoreMinWidth', 'rowDateSize', 'emptySize',
          'bottomPaddingH', 'bottomPaddingBottom', 'bottomPaddingTop', 'bottomGap',
          'startRadius', 'startPaddingV',
          'startSize']],
        ['PuzzleStreakSolver', MET.STREAK_SOLVER, ['headerPaddingH', 'headerPaddingV', 'backBtnW', 'backBtnH', 'backSize', 'counterSize',
          'statsRadius', 'statsPaddingV', 'statsPaddingH', 'statsMarginH', 'statsMarginBottom',
          'statsShadowY', 'statsShadowOpacity', 'statsShadowRadius', 'statLabelSize',
          'statLabelMarginBottom', 'statValueSize', 'statDividerSize', 'bottomPaddingH',
          'bottomGap', 'hintSize', 'loadingGap', 'loadingSize', 'loadingMarginTop',
          'overlayPaddingH', 'boxRadius', 'boxPadding', 'boxGap', 'boxBorder',
          'resultHeaderSize', 'resultNumberSize', 'resultNumberLineHeight', 'resultBestSize',
          'newBestRadius', 'newBestPaddingH', 'newBestPaddingV', 'newBestBorder', 'newBestSize',
          'btnRadius', 'btnPaddingV', 'btnPaddingH', 'btnSize', 'tryAgainRadius',
          'tryAgainPaddingV', 'tryAgainPaddingH', 'backToMenuMarginTop', 'backToMenuPaddingV',
          'backToMenuSize', 'stripGap', 'stripPaddingH', 'stripPaddingV', 'stripRadius',
          'stripBorder', 'stripLabelSize', 'stripLabelLetterSpacing', 'stripMoveSize',
          'stripMoveLetterSpacing', 'stripButtonsGap', 'stripBtnRadius', 'stripBtnPaddingV',
          'stripBtnSize']],
        ['PuzzleTurboHome', MET.TURBO_HOME, ['headerPaddingH', 'headerPaddingTop', 'headerPaddingBottom', 'badgePaddingH',
          'badgePaddingV', 'badgeRadius', 'topPaddingH', 'topGap', 'infoRadius', 'infoPaddingH',
          'infoPaddingV', 'infoBorder', 'infoSize', 'mistakeBadgeRadius', 'mistakeBadgePaddingH',
          'mistakeBadgePaddingV', 'mistakeBadgeSize', 'cardRadius', 'cardPaddingH',
          'cardPaddingV', 'cardBorder', 'cardLabelSize', 'cardLabelMarginBottom',
          'cardLabelLetterSpacing', 'tabGap', 'tabPaddingV', 'tabPaddingH', 'tabRadius',
          'tabGapInner', 'tabBorder', 'tabTextSize', 'tabBestSize', 'listTitleSize',
          'listPaddingH', 'listPaddingTop', 'listPaddingBottom', 'rowRadius', 'rowPaddingH',
          'rowPaddingV', 'rowMarginBottom', 'rowGap', 'rowScoreSize', 'rowScoreMinWidth',
          'rowMistakesSize', 'rowDateSize', 'emptySize', 'bottomPaddingH', 'bottomPaddingBottom',
          'bottomPaddingTop', 'bottomGap',
          'startRadius', 'startPaddingV', 'startSize', 'startShadowY', 'startShadowOpacity',
          'startShadowRadius']],
        ['PuzzleTurboRun', MET.TURBO_RUN, ['headerPaddingH', 'headerPaddingV', 'quitBtnW', 'quitBtnH', 'quitSize', 'timerSize',
          'statsRadius', 'statsPaddingV', 'statsPaddingH', 'statsMarginH', 'statsMarginBottom',
          'statsShadowY', 'statsShadowOpacity', 'statsShadowRadius', 'statLabelSize',
          'statLabelMarginBottom', 'statValueSize', 'mistakesGap', 'mistakeDotSize',
          'mistakeUsedOpacity', 'mistakeLeftOpacity', 'bottomPaddingH', 'hintSize', 'loadingGap',
          'loadingSize', 'modalRadius', 'modalPadding', 'modalWidth', 'modalBorder',
          'modalTitleSize', 'modalTitleMarginBottom', 'modalBodySize', 'modalBodyMarginBottom',
          'modalBodyLineHeight', 'modalButtonsGap', 'modalBtnRadius', 'modalBtnPaddingV',
          'modalBtnSize', 'finishedPadding', 'finishedIconSize', 'finishedIconMarginBottom',
          'finishedTitleSize', 'finishedTitleMarginBottom', 'finishedScoreSize',
          'finishedLabelSize', 'finishedLabelMarginBottom', 'finishedStatsGap',
          'finishedStatsMarginBottom', 'finishedStatSize', 'doneRadius', 'donePaddingV',
          'donePaddingH', 'doneSize']],
        ['PuzzleTurboFeedback', MET.TURBO_FEEDBACK, ['radiusFactor', 'colOffset', 'leftSign', 'leftFactor', 'topSign', 'topFactor',
          'glyphFactor', 'glyphLineFactor', 'borderWidth', 'zIndex']],
        ['PuzzleType', MET.TYPE, Object.keys(MET.TYPE)],
      ];
      let checked = 0;
      for (const [ns, jsObj, keys] of NS) {
        expect(!!blockOf(met, ns), `PuzzleMetrics declares ${ns}`);
        for (const k of keys) {
          const sw = swNum(met, ns, k);
          swiftIs(sw, jsObj[k], `${ns}.${k}`);
          checked++;
        }
      }
      expect(checked > 500, `${checked} Swift constants checked against the JS — not vacuous`);

      // The five hub cards: copy and accents, both languages.
      const modeRe = /Mode\(id: "([a-z]+)", emoji: "([^"]+)", title: "([^"]+)",\s*subtitle: "((?:[^"\\]|\\.)*)", badge: "([A-Z]+)", hex: 0x([0-9A-Fa-f]{6})\)/g;
      const swModes = [...met.matchAll(modeRe)].map(m => ({
        id: m[1], emoji: m[2], title: m[3], subtitle: m[4].replace(/\\"/g, '"'),
        badge: m[5], color: '#' + m[6].toUpperCase(),
      }));
      eq(swModes.length, 5, 'the Swift hub declares five modes');
      swModes.forEach((m, i) => {
        const j = MET.HUB_MODES[i];
        swiftIs(m.id, j.id, `hub mode ${i} id`);
        swiftIs(m.title, j.title, `hub mode ${i} title`);
        swiftIs(m.subtitle, j.subtitle, `hub mode ${i} subtitle`);
        swiftIs(m.badge, j.badge, `hub mode ${i} badge`);
        swiftIs(m.emoji, j.emoji, `hub mode ${i} emoji`);
        swiftIs(m.color, j.color, `hub mode ${i} accent`);
      });
      // ...and the recorded source colours, which is what makes the Part 9.2 fix checkable.
      const srcRe = /"([a-z]+)": 0x([0-9A-Fa-f]{6})/g;
      const srcBlock = blockOf(met, 'PuzzleHub') || '';
      const swSource = {};
      let sm;
      while ((sm = srcRe.exec(srcBlock)) !== null) swSource[sm[1]] = '#' + sm[2].toUpperCase();
      for (const k of Object.keys(MET.HUB_SOURCE_COLORS)) {
        swiftIs(swSource[k], MET.HUB_SOURCE_COLORS[k], `recorded source colour for ${k}`);
      }
      const differ = swModes.filter(m => swSource[m.id] !== m.color).map(m => m.id).sort();
      eq(differ.join(','), 'streak,thematic,turbo',
         'exactly Thematic, Turbo and Streak are unified onto the screen colours');

      // The twelve themes, in both languages, with their code points intact.
      const themeRe = /Theme\(id: "([a-zA-Z0-9]+)", label: "([^"]+)", hex: 0x([0-9A-Fa-f]{6})\)/g;
      const swThemes = [...met.matchAll(themeRe)].map(m => ({
        id: m[1], label: m[2], color: '#' + m[3].toUpperCase(),
      }));
      eq(swThemes.length, 12, 'the Swift grid declares twelve themes');
      swThemes.forEach((t, i) => {
        const j = MET.THEMES[i];
        swiftIs(t.id, j.id, `theme ${i} id`);
        swiftIs(t.label, j.label, `theme ${i} label`);
        swiftIs(t.color, j.color, `theme ${i} colour`);
      });
      // The variation selectors the spec warns about, checked in the Swift too.
      expect(swThemes[2] && swThemes[2].label.indexOf('️') > 0,
        'the Swift keeps the U+FE0F in "⚔️ Fork"');
      expect(swThemes[10] && swThemes[10].label.indexOf('️') < 0,
        'and does not add one to "♚ Mate in 2"');

      // Strings — Part 19, verbatim in both languages.
      for (const k of ['hubTitle', 'hubHeroTitle', 'hubHeroSub', 'goalTitle', 'goalComplete',
                       'homeTitle', 'homeBadge', 'homeHeroTitle', 'homeHeroSub', 'homeInfo',
                       'homeShare', 'homePlay', 'currentRating', 'best', 'accuracy', 'activity',
                       'themePerformance', 'statsEmpty', 'loading', 'whiteToMove', 'blackToMove',
                       'solved', 'wrongMove', 'viewingSolution', 'yourRating', 'clock', 'puzzle',
                       'noTime', 'solution', 'nextPuzzle', 'retry', 'solutionBtn', 'analyzing',
                       'engineSuggestions', 'refresh', 'savePuzzle', 'savedToBoard',
                       'choosePromotion', 'saveName', 'saveNamePlaceholder', 'saveNotes',
                       'saveNotesPlaceholder', 'cancel', 'save',
                       'dailyTitle', 'dailyHeroTitle', 'dailyHeroSub', 'dailyStreakLabel',
                       'dailyTotalLabel', 'dailyHowTitle', 'dailyStart', 'dailySolvedTitle',
                       'dailySolvedSub', 'dailyLoading', 'dailyWin', 'dailyMiss', 'dailyWhite',
                       'dailyBlack', 'dailyDone', 'thematicTitle', 'thematicBadge',
                       'thematicChoose', 'thematicSelectPrompt', 'thematicRating',
                       'thematicHintWhite', 'thematicHintBlack', 'thematicWin', 'thematicMiss',
                       'thematicDry']) {
        swiftIs(swStr(met, 'PuzzleStrings', k), MET.STR[k], `PuzzleStrings.${k}`);
      }

      // The three fixes the metrics layer is responsible for.
      expect(/nextMarginTop: CGFloat = 8/.test(met) && /nextMarginBottom: CGFloat = 8/.test(met),
        'the Swift carries BOTH of "Next Puzzle"\'s margins');
      expect(/headerPaddingV: CGFloat = 10/.test(blockOf(met, 'PuzzleHub') || '')
             && /headerPaddingV: CGFloat = 8/.test(blockOf(met, 'PuzzleSolverStyle') || ''),
        'the hub and solver headers are encoded separately, not as one "standard header"');
      expect(/tintFillByte: UInt = 0x22/.test(met) && /tintBorderByte: UInt = 0x55/.test(met),
        'the tint is the source\'s hex byte, not a rounded percentage');
      // Spec fix #11, stated as a type: one strip state, not four booleans.
      expect(/enum StripState[^\n]*\{[\s\S]*?case playing, solved, wrong, solution/.test(met),
        'the info strip is a single enum');
    }

    // PuzzleStats: the domain constants, and the tie-break Swift's unstable sort needs.
    if (!fs.existsSync(STATS_SW)) { failures.push('PuzzleStats.swift is missing'); }
    else {
      const st = code(fs.readFileSync(STATS_SW, 'utf8'));
      const PS = require(path.join(JS, 'puzzle-stats.js'));
      const MET = require(path.join(JS, 'puzzle-metrics.js'));
      const n = (name) => {
        const m = new RegExp(`static let ${name}\\s*=\\s*(\\d+)`).exec(st);
        return m ? Number(m[1]) : null;
      };
      swiftIs(n('sparkWindow'), MET.STATS.sparkWindow, 'PuzzleStats.sparkWindow');
      swiftIs(n('sparkMinPoints'), MET.STATS.sparkMinPoints, 'PuzzleStats.sparkMinPoints');
      swiftIs(n('themeRows'), MET.STATS.themeRows, 'PuzzleStats.themeRows');
      swiftIs(n('activityDays'), 7, 'PuzzleStats.activityDays');
      expect(/\$0\.attempted > \$1\.attempted : \$0\.theme < \$1\.theme/.test(st),
        'themePerformance breaks its sort tie on the name — Swift sort is not stable');
      expect(/\$0\.solvedAt < \$1\.solvedAt : \$0\.puzzleId < \$1\.puzzleId/.test(st),
        'weekDelta breaks its tie on the id, for the same reason');
      expect(/import Foundation/.test(st) && !/import SwiftUI/.test(st),
        'PuzzleStats stays Foundation-only — the pixel sizes are parameters, not constants');
      // The whole point of the split: no presentation constant leaked into Core.
      for (const bad of ['barMaxHeight = ', 'sparkHeight = ', 'Color(']) {
        expect(st.indexOf(bad) < 0, `PuzzleStats holds no presentation constant (${bad.trim()})`);
      }
      expect(typeof PS.summary === 'function', 'the JS twin exposes the same summary entry point');
    }
  }

  // ---- 5b. the two string tables hold the SAME KEYS ------------------------------
  //
  // Not the same values — those are copy, and Swift interpolates where JS concatenates. Just the
  // keys, in both directions.
  //
  // This exists because its absence cost two phases: the Streak and Turbo copy (61 strings, Parts
  // 13 and 14) went into the JS twin in Phase E and never into Swift, and every suite stayed green
  // because nothing compared the tables. A screen whose copy exists in one language only is not a
  // smaller feature, it is a screen that cannot be written.
  {
    const MET = require(path.join(JS, 'puzzle-metrics.js'));
    const swiftStrings = blockOf(fs.readFileSync(
      path.join(ROOT, 'DemoApp', 'Sources', 'BiyaherongUI', 'PuzzleMetrics.swift'), 'utf8'),
      'PuzzleStrings');
    expect(!!swiftStrings, 'PuzzleMetrics declares PuzzleStrings');
    const decls = [...code(swiftStrings || '')
      .matchAll(/static (let|func) ([A-Za-z_]\w*)/g)];
    const swiftKeys = new Set(decls.map(m => m[2]));
    const swiftFuncs = new Set(decls.filter(m => m[1] === 'func').map(m => m[2]));
    const jsKeys = Object.keys(MET.STR);
    eq(jsKeys.filter(k => !swiftKeys.has(k)).join(', '), '',
       'every JS string has a Swift twin');
    eq([...swiftKeys].filter(k => !jsKeys.includes(k)).join(', '), '',
       'and every Swift string has a JS twin');
    expect(jsKeys.length > 130, jsKeys.length + ' strings compared, not vacuous');
    // A Swift `func` must be a JS function and vice versa. Where they disagree one language is
    // hard-coding what the other computes, which is how a plural ends up wrong in exactly one.
    for (const k of jsKeys) {
      const jsIsFn = typeof MET.STR[k] === 'function';
      if (jsIsFn === swiftFuncs.has(k)) continue;
      expect(false, 'PuzzleStrings.' + k + ' is a '
        + (jsIsFn ? 'function in JS but a constant in Swift'
                  : 'constant in JS but a function in Swift'));
    }
    expect(swiftFuncs.size > 8, swiftFuncs.size + ' interpolating strings compared');
  }

  // ---- 6. the day-key format matches between the two languages --------------------
  expect(/DailyLimits\.dayKey\(for:/.test(progSrc),
    'PuzzleProgress reuses DailyLimits.dayKey rather than formatting its own');
  eq(PROG.dayKey(Date.UTC(2026, 2, 5, 12)).length, 10, 'the JS day key is yyyy-MM-dd');
  expect(/%04d-%02d-%02d/.test(
    fs.readFileSync(path.join(CORE, 'DailyLimits.swift'), 'utf8')),
    'and the Swift one is zero-padded to the same shape');

  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayPuzzleCore: ${passed} Swift expectations confirmed against the JS`
      : `ReplayPuzzleCore: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map(f => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
