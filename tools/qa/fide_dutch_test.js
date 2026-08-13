#!/usr/bin/env node
/*
 * fide_dutch_test.js — the engine against PUBLISHED FIDE Dutch pairings.
 *
 *     node tools/qa/fide_dutch_test.js
 *
 * Book Two's acceptance criterion 4: "Feed the engine a published FIDE Dutch example and match the
 * official pairings." Every other pairing suite in this repo checks the engine against itself —
 * `pairing_test.js` asserts properties it satisfies, `replay_pairing.js` asserts the Swift agrees
 * with the JS. Both would stay green if the whole algorithm were subtly un-Dutch. This is the only
 * check with an outside authority in it.
 *
 * ## Provenance
 *
 * The official FIDE Handbook chapter C.04.3 is purely normative and contains **no worked example**
 * (checked directly). The fixtures below are therefore taken from the test corpus of
 * **bbpPairings** (BieremaBoyzProgramming), an independent Swiss pairing engine:
 *
 *     https://github.com/BieremaBoyzProgramming/bbpPairings
 *     test/tests/dutch_2025_C5.{input,output.expected}
 *     test/tests/dutch_2025_C9.{input,output.expected}
 *     Apache-2.0 — one-way compatible with this app's GPL.
 *
 * The names refer to the criteria of C.04.3 each case exercises. Each `input` is a FIDE TRF, quoted
 * verbatim below so the reconstruction is auditable rather than trusted; each `output.expected` is
 * a board count followed by `white black` per line, with `0` for the bye.
 *
 * ## The one thing this engine cannot express
 *
 * Both TRFs use `0000 - Z` — a pre-assigned ZERO-POINT bye, awarded to a player who is unavailable
 * for a round. This engine has no concept of one: it allocates a bye itself, always worth a full
 * point, and has no way to mark a player as unavailable or to score a bye at zero.
 *
 * The fixtures encode the Z the only way they can — in C5 by leaving that player out of the round
 * entirely, in C9 by carrying the round as a `null` colour and an already-had-a-bye flag. Both are
 * faithful to what the Z means for THESE positions, and both cases pass. But the general feature is
 * genuinely missing, and that is recorded in PORTING_NOTES.md rather than papered over here.
 */
'use strict';

const path = require('path');
const ENG = require(path.join(__dirname, '..', '..', 'web-demo', 'js', 'pairing-engine.js'));

let passed = 0;
const failures = [];
const expect = (c, what) => { c ? passed++ : failures.push(what); };
const eq = (got, want, what) => expect(got === want, `${what}: got ${got}, want ${want}`);

/** A player snapshot. `colors` uses `null` for a round sat out. */
function player(id, rating, score, colors, opponents, hadBye) {
  return {
    id: id,
    name: 'Player' + String(id).padStart(4, '0'),
    rating: rating,
    seed: id,
    score: score,
    opponents: new Set(opponents),
    colors: colors,
    floats: colors.map(() => 'none'),
    hadBye: !!hadBye,
  };
}

/** `white black` per board, then the bye as `id 0` — the shape of `.output.expected`. */
function render(result) {
  return result.pairs.map((p) => p.white + ' ' + p.black)
    .concat(result.bye == null ? [] : [result.bye + ' 0'])
    .join('|');
}

const CASES = [
  {
    name: 'dutch_2025_C5',
    round: 3,
    /*
     * 012 Dutch 2025 C5 test
     * 001    1      Test0001 Player0001   2720   2.0    1     4 w 1     2 b 1
     * 001    2      Test0002 Player0002   2701   1.0    3     5 b 1     1 w 0
     * 001    3      Test0003 Player0003   2697   2.0    2     6 w 1     4 b 1
     * 001    4      Test0004 Player0004   2689   0.0    5     1 b 0     3 w 0  0000 - Z
     * 001    5      Test0005 Player0005   2673   1.0    4     2 w 0     6 b 1
     * 001    6      Test0006 Player0006   2664   0.0    6     3 b 0     5 w 0
     * XXR 3
     *
     * Player 4 carries `0000 - Z` for round 3 and so is not in the field being paired.
     */
    field: [
      player(1, 2720, 2.0, ['w', 'b'], [4, 2]),
      player(2, 2701, 1.0, ['b', 'w'], [5, 1]),
      player(3, 2697, 2.0, ['w', 'b'], [6, 4]),
      player(5, 2673, 1.0, ['w', 'b'], [2, 6]),
      player(6, 2664, 0.0, ['b', 'w'], [3, 5]),
    ],
    expected: '1 5|3 2|6 0',
    // What makes this case interesting: the Dutch top-half/bottom-half shape would pair 1-2, but
    // they have already met, so the engine must reach past its first choice and still get the
    // colours right.
    notes: 'a repeat forces 1-5 rather than the nominal 1-2',
  },
  {
    name: 'dutch_2025_C9',
    round: 2,
    /*
     * 012 Dutch 2025 C9 test
     * 001    1      Test0001 Player0001   2720   1.0    1     3 w 1
     * 001    2      Test0002 Player0002   2701   1.0    2     4 b 1
     * 001    3      Test0003 Player0003   2697   0.0    3     1 b 0
     * 001    4      Test0004 Player0004   2689   0.0    4     2 w 0
     * 001    5      Test0005 Player0005   2673   0.0    5  0000 - Z
     * XXR 3
     *
     * Player 5 sat out round 1 on a zero-point bye: no colour that round, and already counts as
     * having had one — which is why the round-2 bye goes to player 4 and not to them.
     */
    field: [
      player(1, 2720, 1.0, ['w'], [3]),
      player(2, 2701, 1.0, ['b'], [4]),
      player(3, 2697, 0.0, ['b'], [1]),
      player(4, 2689, 0.0, ['w'], [2]),
      player(5, 2673, 0.0, [null], [], true),
    ],
    expected: '2 1|3 5|4 0',
    notes: 'the bye must skip the player who already had one',
  },
];

function run() {
  passed = 0; failures.length = 0;

  for (const c of CASES) {
    const result = ENG.pairRound(c.field, c.round);
    eq(render(result), c.expected, `${c.name} (${c.notes})`);
    // A published example the engine only matches by compromising is not a match. Both of these
    // are clean rounds in the reference implementation, so they must be clean here too.
    eq(result.warnings.length, 0,
       `${c.name} reaches the official pairing with no compromises`
       + (result.warnings.length ? ': ' + JSON.stringify(result.warnings) : ''));
    // Regeneration is byte-identical (criterion 6), checked here as well because a published
    // fixture is the one place a non-deterministic engine would be caught red-handed.
    eq(render(ENG.pairRound(c.field, c.round)), c.expected,
       `${c.name} regenerates identically`);
  }

  // Anti-vacuity: a fixture list that quietly emptied would otherwise pass with nothing checked.
  expect(CASES.length >= 2, `${CASES.length} published cases encoded, expected at least 2`);

  return {
    passed, failures, ok: failures.length === 0,
    summary: failures.length === 0
      ? `FideDutch: ${passed} assertions passed against ${CASES.length} published pairings`
      : `FideDutch: ${passed} passed, ${failures.length} FAILED\n`
        + failures.map((f) => '  x ' + f).join('\n'),
  };
}

module.exports = { run, selfTest: run, CASES };

if (require.main === module) {
  const r = run();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
