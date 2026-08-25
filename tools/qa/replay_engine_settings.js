#!/usr/bin/env node
/*
 * replay_engine_settings.js — check the engine's Swift against the JavaScript that has executed.
 *
 *     node tools/qa/replay_engine_settings.js
 *
 * `swift` is not on PATH on this checkout, so `EngineSettings.swift`, `AnalysisEval.swift` and the
 * new half of `LocalEngine.swift` were written blind. Same mitigation every phase of this rebuild
 * has used, and the same one `replay_coach.js` and `replay_pairing.js` apply: pull the concrete
 * values, tables, copy and BRANCHES out of the Swift source text and compare them against the JS
 * twin, which is proven by its own suites.
 *
 * It does not prove the Swift compiles — `swift_lint.js` and `swift_symbol_check.js` cover the
 * structure, and `swift build` on a Mac is the last word. It proves the numbers and the decisions
 * in it are the right ones, which is the half a compiler would not have caught anyway.
 *
 * ## What it deliberately does NOT do
 *
 * Re-prove behaviour. `engine-settings.js` and `analysis-eval.js` each own that through their own
 * self-tests, and `engine_strength_check.js` owns whether the search actually got stronger. This is
 * the third leg: that the Swift says the same thing.
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

/** `static let name = 12`, including several on one line (`static let a = 1, b = 2`). */
function swNum(src, name) {
  const m = new RegExp(
    `static let (?:[A-Za-z0-9_]+\\s*(?::\\s*[A-Za-z0-9_]+)?\\s*=\\s*-?[\\d_]+\\s*,\\s*)*` +
    `${name}(?::\\s*[A-Za-z0-9_]+)?\\s*=\\s*(-?[\\d_]+)`, 'm').exec(code(src));
  if (!m) return null;
  return Number(m[1].replace(/_/g, ''));
}

/** `static let name = "…"`, with `\u{XXXX}` escapes resolved. */
function swStr(src, name) {
  const m = new RegExp(`static let ${name}\\s*(?::\\s*String\\s*)?=\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`)
    .exec(code(src));
  if (!m) return null;
  return m[1]
    .replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** A `[a, b, c]` integer array literal bound to `static let name`. */
function swIntArray(src, name) {
  const m = new RegExp(`static let ${name}(?::\\s*\\[Int\\])?\\s*=\\s*\\[([\\s\\S]*?)\\]`)
    .exec(code(src));
  if (!m) return null;
  return m[1].split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
}

// ---- The suite -----------------------------------------------------------------------------------

function run() {
  passed = 0; failures.length = 0;

  const ES = require(path.join(JS, 'engine-settings.js'));
  const EV = require(path.join(JS, 'analysis-eval.js'));
  const AE = require(path.join(JS, 'analysis-engine.js'));

  const swSettings = read(CORE, 'EngineSettings.swift');
  const swEval = read(CORE, 'AnalysisEval.swift');
  const swEngine = read(CORE, 'LocalEngine.swift');
  const swMetrics = read(UI, 'AnalysisMetrics.swift');
  const swVM = read(UI, 'AnalysisVM.swift');
  if (!swSettings || !swEval || !swEngine) return finish();

  // ── EngineSettings: the preset table ────────────────────────────────────────
  {
    const rows = [...code(swSettings).matchAll(
      /Preset\(id:\s*"([a-z]+)",\s*label:\s*"([^"]+)",\s*thinkMs:\s*(\d+),\s*maxDepth:\s*(\d+),\s*multiPV:\s*(\d+),\s*heat:\s*(\d+)\)/g)];
    eq(rows.length, ES.PRESETS.length, 'the Swift preset table has as many rows as the JS');
    for (const [, id, label, thinkMs, maxDepth, multiPV, heat] of rows) {
      const js = ES.PRESETS.find((p) => p.id === id);
      expect(!!js, `Swift has a preset "${id}" the JS does not`);
      if (!js) continue;
      eq(js.label, label, `${id} label`);
      eq(js.thinkMs, Number(thinkMs), `${id} thinkMs`);
      eq(js.maxDepth, Number(maxDepth), `${id} maxDepth`);
      eq(js.multiPV, Number(multiPV), `${id} multiPV`);
      eq(js.heat, Number(heat), `${id} heat`);
    }
    // Order matters: it is the order the panel lists them in, weakest first.
    eq(ES.PRESETS.map((p) => p.id).join(','), rows.map((r) => r[1]).join(','),
      'the presets are in the same order in both languages');
  }

  // ── EngineSettings: ranges, keys and copy ───────────────────────────────────
  {
    eq(ES.DEFAULT_PRESET, swStr(swSettings, 'defaultPreset'), 'the default preset');
    eq(ES.STORAGE_KEY, swStr(swSettings, 'storageKey'), 'the storage key');
    eq(ES.LINES_MIN, swNum(swSettings, 'linesMin'), 'linesMin');
    eq(ES.LINES_MAX, swNum(swSettings, 'linesMax'), 'linesMax');
    eq(ES.DEPTH_MIN, swNum(swSettings, 'depthMin'), 'depthMin');
    eq(ES.DEPTH_MAX, swNum(swSettings, 'depthMax'), 'depthMax');
    eq(ES.THINK_MIN, swNum(swSettings, 'thinkMin'), 'thinkMin');
    eq(ES.THINK_MAX, swNum(swSettings, 'thinkMax'), 'thinkMax');
    eq(ES.THINK_INFINITE, swNum(swSettings, 'thinkInfinite'), 'thinkInfinite');
    eq(ES.THINK_STEP, swNum(swSettings, 'thinkStep'), 'thinkStep');
    eq(ES.REVIEW_DIVISOR, swNum(swSettings, 'reviewDivisor'), 'reviewDivisor');
    eq(ES.REVIEW_MIN, swNum(swSettings, 'reviewMin'), 'reviewMin');
    eq(ES.REVIEW_MAX, swNum(swSettings, 'reviewMax'), 'reviewMax');
    eq(ES.WARNING_TEXT, swStr(swSettings, 'warningText'), 'the heat warning copy');
    eq(ES.INFINITE_WARNING_TEXT, swStr(swSettings, 'infiniteWarningText'),
      'the Infinite warning copy');
    eq(ES.CONTROL_LINES, swStr(swSettings, 'controlLines'), 'the Lines control key');
    eq(ES.CONTROL_DEPTH, swStr(swSettings, 'controlDepth'), 'the Max depth control key');
    eq(ES.CONTROL_THINK, swStr(swSettings, 'controlThink'), 'the Think time control key');
    // Rebuilt entirely from what the Swift SAYS, including the default preset's own numbers. This
    // line used to end `|0|3|12|1200` — a hand-typed third copy of the Balanced row, which meant
    // raising a ceiling in both languages still failed here, with a message blaming the Swift for a
    // number the Swift no longer contained. Extract, don't transcribe: the preset table is parsed
    // twenty lines above, so read the default row out of it.
    {
      const swDefaultID = swStr(swSettings, 'defaultPreset');
      const swDefault = [...code(swSettings).matchAll(
        /Preset\(id:\s*"([a-z]+)",\s*label:\s*"[^"]+",\s*thinkMs:\s*(\d+),\s*maxDepth:\s*(\d+),\s*multiPV:\s*(\d+),/g)]
        .find((r) => r[1] === swDefaultID);
      expect(!!swDefault, `the Swift preset table has no row for the default preset "${swDefaultID}"`);
      if (swDefault) {
        const [, id, thinkMs, maxDepth, multiPV] = swDefault;
        eq(ES.encode(ES.defaults()),
          `${swStr(swSettings, 'encodingVersion')}|${id}|0|${multiPV}|${maxDepth}|${thinkMs}`,
          'the canonical default document, rebuilt from the Swift constants');
      }
    }
    eq(2, swNum(swSettings, 'heatWarningMin'), 'the heat level at which the warning appears');
  }

  // ── EngineSettings: the panel model's shape and copy ────────────────────────
  {
    const sw = code(swSettings);
    const m = ES.panelModel(ES.defaults(), false);
    expect(/title:\s*"Engine"/.test(sw), 'the Swift panel is titled "Engine"');
    eq(m.title, 'Engine', 'and so is the JS one');
    expect(/advancedLabel:\s*"Advanced"/.test(sw), 'the Swift disclosure says "Advanced"');
    eq(m.advancedLabel, 'Advanced', 'and so does the JS one');
    expect(/advancedState:\s*c\.custom \? "ON" : "OFF"/.test(sw),
      'the Swift Advanced state is ON when custom, OFF otherwise');
    eq(m.advancedState, 'OFF', 'and reads OFF by default in the JS');
    // The three controls, in order, with their kinds.
    const ctl = [...sw.matchAll(/Control\(key:\s*(control[A-Za-z]+),\s*kind:\s*\.([a-z]+),\s*label:\s*"([^"]+)"/g)];
    eq(m.controls.length, ctl.length, 'the same number of Advanced controls');
    const keyFor = { controlLines: ES.CONTROL_LINES, controlDepth: ES.CONTROL_DEPTH,
                     controlThink: ES.CONTROL_THINK };
    ctl.forEach(([, key, kind, label], i) => {
      eq(m.controls[i].key, keyFor[key], `control ${i} key`);
      eq(m.controls[i].kind, kind, `control ${i} kind`);
      eq(m.controls[i].label, label, `control ${i} label`);
    });
    expect(/options:\s*\[1, 2, 3, 4, 5\]/.test(sw), 'the Swift Lines picker offers 1-5');
    eq(m.controls[0].options.join(','), '1,2,3,4,5', 'and so does the JS one');
    expect(/advancedOpen:\s*advancedOpen \|\| c\.custom/.test(sw),
      'the Swift forces Advanced open when a custom setting is in effect');
    eq(ES.panelModel({ preset: 'saver', custom: true, multiPV: 2, maxDepth: 8, thinkMs: 500 }, false)
      .advancedOpen, true, 'and so does the JS');
    expect(/thinkSliderMin: Int \{ thinkMin - thinkStep \}/.test(sw),
      'the Swift Think time slider starts one step below the minimum — that step is Infinite');
    eq(ES.THINK_SLIDER_MIN, ES.THINK_MIN - ES.THINK_STEP, 'and so does the JS');
  }

  // ── AnalysisEval: material, tables and term weights ─────────────────────────
  {
    // Midgame material is shared with the coach in both languages rather than re-typed.
    expect(/static func materialMG\([\s\S]{0,80}ChessAI\.material\(k\)/.test(code(swEval)),
      'the Swift midgame material IS ChessAI.material, not a copy of it');
    expect(/var MAT_MG = AI\.MATERIAL/.test(fs.readFileSync(path.join(JS, 'analysis-eval.js'), 'utf8')),
      'and the JS midgame material IS CoachAI.MATERIAL');
    expect(/static func tableMG\([\s\S]{0,80}ChessAI\.table\(k\)/.test(code(swEval)),
      'the Swift midgame PSTs ARE ChessAI.table');

    const egMat = /case \.pawn: return (\d+); case \.knight: return (\d+); case \.bishop: return (\d+)\s*case \.rook: return (\d+); case \.queen: return (\d+); case \.king: return (\d+)/
      .exec(code(swEval));
    expect(!!egMat, 'the Swift endgame material table parses');
    if (egMat) {
      const want = [1, 2, 3, 4, 5, 6].map((i) => Number(egMat[i]));
      // JS order is pawn,knight,bishop,rook,queen,king — the same as the Swift switch above.
      eq(EV.MAT_EG.join(','), want.join(','), 'the endgame material values');
    }

    for (const [swName, jsTable] of [['kingEG', EV.PST_EG[5]], ['pawnEG', EV.PST_EG[0]]]) {
      const arr = swIntArray(swEval, swName);
      expect(Array.isArray(arr) && arr.length === 64, `the Swift ${swName} table has 64 entries`);
      if (arr) eq(jsTable.join(','), arr.join(','), `the ${swName} table`);
    }

    eq(EV.PHASE_MAX, swNum(swEval, 'phaseMax'), 'phaseMax');
    eq(EV.TEMPO, swNum(swEval, 'tempo'), 'the tempo bonus');
    eq(-12, swNum(swEval, 'doubledMG'), 'doubledMG');
    eq(-24, swNum(swEval, 'doubledEG'), 'doubledEG');
    eq(-14, swNum(swEval, 'isolatedMG'), 'isolatedMG');
    eq(-18, swNum(swEval, 'isolatedEG'), 'isolatedEG');
    eq(30, swNum(swEval, 'bishopPairMG'), 'bishopPairMG');
    eq(45, swNum(swEval, 'bishopPairEG'), 'bishopPairEG');
    eq(20, swNum(swEval, 'rookOpenMG'), 'rookOpenMG');
    eq(10, swNum(swEval, 'rookOpenEG'), 'rookOpenEG');
    eq(10, swNum(swEval, 'rookSemiMG'), 'rookSemiMG');
    eq(5, swNum(swEval, 'rookSemiEG'), 'rookSemiEG');
    eq(6, swNum(swEval, 'kingSafetyMinPhase'), 'kingSafetyMinPhase');
    eq(-25, swNum(swEval, 'shieldMissing'), 'shieldMissing');
    eq(-18, swNum(swEval, 'shieldFar'), 'shieldFar');
    eq(-10, swNum(swEval, 'shieldNear'), 'shieldNear');
    eq(-15, swNum(swEval, 'kingOpenFile'), 'kingOpenFile');
    eq(-4, swNum(swEval, 'queenProximity'), 'queenProximity');
    eq('0,5,10,20,35,60,100,0', (swIntArray(swEval, 'passedMG') || []).join(','), 'passedMG');
    eq('0,10,20,35,60,100,150,0', (swIntArray(swEval, 'passedEG') || []).join(','), 'passedEG');

    // The direction tables, against the JS ones that its own self-test proved against the engine.
    for (const [swName, len] of [['knightOff', 8], ['kingOff', 8], ['bishopDir', 4], ['rookDir', 4]]) {
      const m = new RegExp(`static let ${swName}: \\[\\(Int, Int\\)\\] = \\[([\\s\\S]*?)\\]\\s*\\n`)
        .exec(code(swEval));
      expect(!!m, `the Swift ${swName} table parses`);
      if (!m) continue;
      const pairs = [...m[1].matchAll(/\((-?\d+),\s*(-?\d+)\)/g)].map((p) => p[1] + ',' + p[2]);
      eq(pairs.length, len, `${swName} has ${len} entries`);
    }
  }

  // ── LocalEngine: the search's own constants and branches ────────────────────
  {
    const sw = code(swEngine);
    eq(AE.MAX_QDEPTH, swNum(swEngine, 'maxQDepth'), 'the quiescence depth cap');
    eq(200, swNum(swEngine, 'deltaMargin'), 'the delta-pruning margin');
    eq(2048, swNum(swEngine, 'cancelCheckInterval'), 'the cancel poll interval');
    eq(64, swNum(swEngine, 'maxPly'), 'the ply ceiling that bounds check extensions');
    eq(3, swNum(swEngine, 'nullMinDepth'), 'nullMinDepth');
    eq(2, swNum(swEngine, 'nullR'), 'nullR');
    eq(3, swNum(swEngine, 'nullRDeep'), 'nullRDeep');
    eq(6, swNum(swEngine, 'nullDeepDepth'), 'nullDeepDepth');
    eq(3, swNum(swEngine, 'lmrMinDepth'), 'lmrMinDepth');
    eq(3, swNum(swEngine, 'lmrMinMove'), 'lmrMinMove');
    eq(6, swNum(swEngine, 'lmrWideMove'), 'lmrWideMove');
    eq(5, swNum(swEngine, 'lmrWideDepth'), 'lmrWideDepth');
    eq(AE.IDENTIFIER, /public let identifier = "([^"]+)"/.exec(sw)?.[1],
      'the engine identifier matches the JS');

    // ---- Quiescence takes TWO counters, and they are not interchangeable -------------
    //
    // `swift build` runs on a Mac; on this checkout these greps are the only thing between a wrong
    // Swift signature and a shipped one. This file stayed green for three phases while quiescence
    // was dead in BOTH languages, because it pins constants and neither bug was a constant —
    // `maxQDepth` was 6 before and is 6 now. What it could not see was the parameter list.
    const jsEngineSrc = read(JS, 'analysis-engine.js');
    expect(/func quiesce\(_ pos: ChessPosition, _ alpha0: Int, _ beta: Int,\s*\n\s*_ ply: Int, _ qdepth: Int\)/.test(sw),
      'Swift quiescence takes BOTH a root distance and a leaf-local counter — one parameter serving '
      + 'both is what disabled it at every shipped preset (depth 8/12/18/22/30)');
    expect(/if depth <= 0 \{ return quiesce\(pos, alpha, beta, ply, 0\) \}/.test(sw),
      'and negamax resets the leaf-local counter to 0 on entry rather than passing ply for it');
    expect(/-quiesce\(pos\.makeMove\(m\), -beta, -alpha, ply \+ 1, qdepth \+ 1\)/.test(sw),
      'and both counters advance together in the recursion');
    expect(!/ChessAI\.mate - qdepth/.test(sw),
      'no mate is scored from the leaf-local counter — that is the PLAUSIBLE WRONG FIX, and it '
      + 'reports a three-ply mate as M1');
    expect(/\} else if ply >= LocalEngine\.maxPly \{/.test(sw),
      'and in-check quiescence is bounded by maxPly: the qdepth cap sits in a branch a checking '
      + 'node never reaches, so it had no bound at all');
    expect(/Search\.prototype\.quiesce = function \(pos, alpha, beta, ply, qdepth\)/
      .test(jsEngineSrc), 'the JS twin takes the same two counters');
    expect(/return this\.quiesce\(pos, alpha, beta, ply, 0\);/.test(jsEngineSrc),
      'and resets the same one');
    expect(!/MATE - qdepth/.test(jsEngineSrc), 'and scores no mate from it either');
    expect(/\} else if \(ply >= MAX_PLY\) \{/.test(jsEngineSrc), 'and bounds in-check the same way');

    // ---- The pawn shield is gated on castling rights, and only the shield ------------
    //
    // Gated on RIGHTS specifically, and rights are part of the Zobrist key — so the transposition
    // table cannot hand back a score computed under a different evaluation for the same key. A
    // guard on anything NOT in that key (a move number, a search-local flag) would do exactly that,
    // silently, and it would look like non-determinism.
    const jsEvalSrc = read(JS, 'analysis-eval.js');
    expect(/let canCastle = color == \.white \? \(pos\.castleWK \|\| pos\.castleWQ\)/.test(code(swEval)),
      'the Swift pawn shield is gated on this colour still having castling rights');
    expect(/if !canCastle \{[\s\S]{0,240}shieldMissing[\s\S]{0,240}shieldFar/.test(code(swEval)),
      'and all three shield branches sit inside that gate');
    expect(/var canCastle = color === E\.WHITE \? \(pos\.castleWK \|\| pos\.castleWQ\)/.test(jsEvalSrc),
      'and the JS twin reads the same flags');
    // The open-file term is deliberately OUTSIDE the gate. An open file beside an uncastled king is
    // a highway either way, and it is the only term still punishing a king left in the centre —
    // gate it too and staying there costs nothing at all.
    expect(/if myPawnFiles\[ff\] == 0 && foePawnFiles\[ff\] == 0 \{ s \+= kingOpenFile \}/
      .test(code(swEval)), 'while kingOpenFile is NOT gated in Swift');
    expect(/if \(myPawnFiles\[ff\] === 0 && foePawnFiles\[ff\] === 0\) s \+= KING_OPEN_FILE;/
      .test(jsEvalSrc), 'nor in the JS');

    // The two rules that keep the accelerators honest. Both are single lines, and both are the kind
    // of thing that silently degrades the search if someone "simplifies" them.
    expect(/if e\.depth >= depth, !isPV \{/.test(sw),
      'a PV node never takes a table cutoff (or the displayed PV would be truncated)');
    expect(/if !isPV, !inCheck, depth >= LocalEngine\.nullMinDepth/.test(sw),
      'null-move pruning is forbidden in PV nodes and in check');
    expect(/AnalysisEval\.hasNonPawnMaterial\(pos, pos\.sideToMove\)/.test(sw),
      'and behind the zugzwang guard');
    expect(/nullScore > LocalEngine\.mateThreshold \? beta : nullScore/.test(sw),
      'a null-move cutoff never reports an unproven mate');
    expect(/if !cancelled, score > alpha, red > 0 \|\| isPV \{/.test(sw),
      'a reduced search that beats alpha is always re-searched at full depth');
    expect(/if inCheck, ply < LocalEngine\.maxPly \{ depth \+= 1 \}/.test(sw),
      'the check extension is bounded by maxPly');
    expect(/AnalysisEval\.evaluate\(pos\)/.test(sw),
      'the search evaluates with AnalysisEval, not the parity-pinned ChessAI.evaluate');
    expect(!/ChessAI\.evaluate/.test(sw),
      'and no longer calls ChessAI.evaluate at all');
    // MultiPV windowing: the displayed lines stay exact.
    expect(/sc = -s\.negamax\(next, depth - 1, -kth, -kth \+ 1, 1, &line\)/.test(sw),
      'root moves outside the top-k get a null window against the k-th best');
    expect(/if sc >= kth \{[\s\S]{0,200}-LocalEngine\.win, LocalEngine\.win/.test(sw),
      'and anything reaching it is re-searched exactly, so every displayed line is exact');
  }

  // ── The UI layer reads the settings rather than a constant ──────────────────
  if (swVM && swMetrics) {
    expect(/EngineSettings\.resolve\(/.test(code(swVM)),
      'AnalysisVM resolves the engine settings instead of reading a fixed limit');
    expect(/\.infinite\s*$|\.infinite[\s?)]/m.test(code(swVM)),
      'and branches on Infinite, which has no deadline to compare against');
    expect(/let deadline: Date\? = resolved\.infinite/.test(code(swVM)),
      'specifically: Infinite makes the deadline nil rather than a date far in the future');
    expect(/reviewMs/.test(code(swVM)),
      'the review uses the settings-derived per-position budget');
    eq(ES.resolve(ES.defaults()).maxDepth, swNum(swMetrics, 'maxDepth'),
      'AnalysisEngineLimits.maxDepth is still the Balanced default');
    eq(ES.resolve(ES.defaults()).multiPV, swNum(swMetrics, 'multiPV'),
      'AnalysisEngineLimits.multiPV is still the Balanced default');
    eq(ES.resolve(ES.defaults()).thinkMs, swNum(swMetrics, 'engineDeadlineMs'),
      'AnalysisTiming.engineDeadlineMs is still the Balanced default');
    eq(ES.resolve(ES.defaults()).reviewMs, swNum(swMetrics, 'reviewDeadlineMs'),
      'AnalysisTiming.reviewDeadlineMs is still the Balanced default');
  }

  return finish();
}

function finish() {
  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `ReplayEngineSettings: ${passed} Swift expectations confirmed against the JS`
      : `ReplayEngineSettings: ${passed} passed, ${failures.length} FAILED\n`
        + failures.slice(0, 25).map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
