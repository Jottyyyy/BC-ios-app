/* pairing-store.js — the Pairing Manager's document, and every mutation of it.
 *
 *     node -e "console.log(require('./web-demo/js/pairing-store.js').selfTest().summary)"
 *
 * Pure: no DOM, no timers, no storage of its own. `load`/`save` take an injected storage object so
 * the whole layer runs in Node, which is what lets it be tested at all on this checkout. Twin of
 * `Sources/BiyaherongCoachCore/PairingDocument.swift`.
 *
 * ## The one design decision worth reading
 *
 * **Player aggregates are RECOMPUTED from the rounds after every mutation, never patched.**
 *
 * The server did the opposite: `applyResult` incremented score/W/D/L/colour counters and
 * `reverseResult` decremented them again when a result was edited. That arrangement produced three
 * of the defects in spec §7 on its own — bye points awarded after the tie-break pass rather than at
 * generation (#12), tie-breaks recomputed only when a round happened to complete (#11), and results
 * that stayed editable after `finished` because the counters had no idea what state the tournament
 * was in (#17). Every one of them is a *synchronisation* bug: two representations of the same fact
 * drifting apart.
 *
 * Recomputing deletes the second representation. `setResult` writes one enum onto one board and
 * calls `recompute`; there is nothing to reverse, so `clearResult` (#23, which the RN app had no
 * way to express at all) is the same code path with `'pending'`. The cost is O(rounds x boards) per
 * keystroke, on tournaments of at most a few hundred games. That is free.
 *
 * Status is computed the same way and for the same reason (§1.10): `.setup` until a round exists,
 * `.finished` when the last round of the last round is decided, `.ongoing` between. It is never
 * stored, so it cannot disagree with the data.
 */
'use strict';

var BiyaPairingStore = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var ENG = isNode ? require('./pairing-engine.js') : BiyaPairing;

  var KEY = 'biya.pairing.v1';
  var VERSION = 1;

  var SWISS = 'swiss';
  var ROUND_ROBIN = 'round_robin';

  var PENDING = 'pending';
  var WHITE_WIN = '1-0';
  var BLACK_WIN = '0-1';
  var DRAW = '1/2-1/2';
  var BYE = 'bye';

  var SETUP = 'setup', ONGOING = 'ongoing', FINISHED = 'finished';

  // ---- The document ---------------------------------------------------------------------------

  function emptyDoc() { return { v: VERSION, nextId: 1, tournaments: [] }; }

  /** A missing or corrupt document yields an EMPTY one rather than throwing. */
  function decode(text) {
    if (!text) return emptyDoc();
    try {
      var d = JSON.parse(text);
      if (!d || typeof d !== 'object' || !Array.isArray(d.tournaments)) return emptyDoc();
      d.v = VERSION;
      if (typeof d.nextId !== 'number') d.nextId = 1;
      return d;
    } catch (e) { return emptyDoc(); }
  }

  function encode(doc) { return JSON.stringify(doc); }

  function load(storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return emptyDoc();
    try { return decode(s.getItem(KEY)); } catch (e) { return emptyDoc(); }
  }

  function save(doc, storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    try { s.setItem(KEY, encode(doc)); return true; } catch (e) { return false; }
  }

  function tournament(doc, id) {
    for (var i = 0; i < doc.tournaments.length; i++) {
      if (doc.tournaments[i].id === id) return doc.tournaments[i];
    }
    return null;
  }

  // ---- Create and delete ----------------------------------------------------------------------

  function create(doc, fields, now) {
    var name = String(fields.name == null ? '' : fields.name).trim();
    if (!name) return null;
    var type = fields.type === ROUND_ROBIN ? ROUND_ROBIN : SWISS;
    // Clamp rather than silently substitute. The RN screen turned a typed 0 into 3 with no feedback
    // and let 99 through to a server 422.
    var rounds = type === SWISS ? clampRounds(fields.totalRounds) : 0;
    var t = {
      id: doc.nextId++,
      name: name.slice(0, 100),
      type: type,
      totalRounds: rounds,
      createdAt: now,
      updatedAt: now,
      nextSeed: 1,
      players: [],
      rounds: [],
    };
    doc.tournaments.unshift(t);
    return t.id;
  }

  function clampRounds(v) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 1) return 3;
    return Math.min(30, n);
  }

  function remove(doc, id) {
    var before = doc.tournaments.length;
    doc.tournaments = doc.tournaments.filter(function (t) { return t.id !== id; });
    return doc.tournaments.length !== before;
  }

  // ---- Status, computed (spec 1.10) -------------------------------------------------------------

  function status(t) {
    if (!t.rounds.length) return SETUP;
    if (t.rounds.length >= totalRoundsOf(t) && !pendingCount(t)) return FINISHED;
    return ONGOING;
  }

  /** Round robin's round count follows from the field; Swiss's was chosen at creation. */
  function totalRoundsOf(t) {
    return t.type === ROUND_ROBIN ? ENG.roundRobinRounds(t.players.length) : t.totalRounds;
  }

  function pendingCount(t) {
    var n = 0;
    t.rounds.forEach(function (r) {
      r.boards.forEach(function (b) { if (!b.isBye && b.result === PENDING) n++; });
    });
    return n;
  }

  function roundComplete(r) {
    return !r.boards.some(function (b) { return !b.isBye && b.result === PENDING; });
  }

  // ---- Players ---------------------------------------------------------------------------------

  /**
   * Seeds are a monotonic counter, and removal renumbers the survivors densely (spec §7 #1).
   *
   * The server used `seed = currentCount + 1` and never renumbered, so removing a player produced
   * duplicate seeds — and the round-robin circle sorts by seed, so the schedule degraded silently.
   * Both halves matter: monotonic alone still collides after a removal, dense alone reorders people
   * who were never touched.
   */
  function addPlayer(doc, tid, fields) {
    var t = tournament(doc, tid);
    if (!t || status(t) !== SETUP) return null;
    var name = String(fields.name == null ? '' : fields.name).trim();
    if (!name) return null;
    var rating = normaliseRating(fields.rating);
    var p = {
      id: t.nextSeed,
      name: name.slice(0, 255),
      fullName: fields.fullName ? String(fields.fullName).trim() : null,
      rating: rating,
      seed: t.nextSeed,
    };
    t.nextSeed++;
    t.players.push(p);
    recompute(t);
    return p.id;
  }

  function normaliseRating(v) {
    if (v == null || v === '') return null;
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 0 || n > 3000) return null;
    return n;
  }

  /**
   * `Maria Santos 1500` -> name + rating; `Juan Dela Cruz` -> name only. Ported exactly (spec §1.5).
   *
   * The round-trip test is the part that matters: `String(rating) === last` rejects `007`, `15.5`
   * and `1500abc`, all of which `parseInt` would otherwise happily accept as 7, 15 and 1500.
   */
  function parseBulkLine(line) {
    var trimmed = String(line == null ? '' : line).trim();
    if (!trimmed) return null;
    var parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var n = parseInt(last, 10);
      if (isFinite(n) && n >= 0 && n <= 3000 && String(n) === last) {
        return { name: parts.slice(0, -1).join(' '), rating: n };
      }
    }
    return { name: trimmed, rating: null };
  }

  function bulkAdd(doc, tid, text) {
    var t = tournament(doc, tid);
    if (!t || status(t) !== SETUP) return 0;
    var added = 0;
    String(text == null ? '' : text).split('\n').forEach(function (line) {
      var parsed = parseBulkLine(line);
      if (parsed && addPlayer(doc, tid, parsed) != null) added++;
    });
    return added;
  }

  function bulkCount(text) {
    return String(text == null ? '' : text).split('\n')
      .filter(function (l) { return parseBulkLine(l) != null; }).length;
  }

  function removePlayer(doc, tid, pid) {
    var t = tournament(doc, tid);
    if (!t || status(t) !== SETUP) return false;
    var before = t.players.length;
    t.players = t.players.filter(function (p) { return p.id !== pid; });
    if (t.players.length === before) return false;
    // Dense renumbering, in the order they were added.
    t.players.forEach(function (p, i) { p.seed = i + 1; });
    t.nextSeed = t.players.length + 1;
    recompute(t);
    return true;
  }

  // ---- Pairing ---------------------------------------------------------------------------------

  function canGenerate(t) {
    if (t.players.length < 2) return false;
    if (status(t) === FINISHED) return false;
    if (t.rounds.length >= totalRoundsOf(t)) return false;
    if (t.type === ROUND_ROBIN) return t.rounds.length === 0;   // the whole schedule, once
    return t.rounds.every(roundComplete);
  }

  /** The engine's view of a player: a value snapshot, never the stored record. */
  function engineState(t) {
    var byId = {};
    t.players.forEach(function (p) {
      byId[p.id] = {
        id: p.id, name: p.name, rating: p.rating, seed: p.seed,
        score: p.score, opponents: new Set(p.opponentIds),
        colors: p.colors.slice(), floats: p.floats.slice(), hadBye: p.hadBye,
      };
    });
    return t.players.map(function (p) { return byId[p.id]; });
  }

  function generate(doc, tid) {
    var t = tournament(doc, tid);
    if (!t || !canGenerate(t)) return false;
    if (t.type === ROUND_ROBIN) {
      var ids = t.players.slice()
        .sort(function (a, b) { return a.seed - b.seed; })
        .map(function (p) { return p.id; });
      var sched = ENG.bergerSchedule(ids);
      t.totalRounds = sched.length;
      sched.forEach(function (boards, i) {
        t.rounds.push({
          number: i + 1,
          boards: materialise(boards),
          warnings: [],
        });
      });
    } else {
      var res = ENG.pairRound(engineState(t), t.rounds.length + 1);
      var boards = res.pairs.map(function (p) {
        return { white: p.white, black: p.black, bye: false };
      });
      // The bye is ALWAYS the last board (spec §7 #7). The server put it last in round 1 and on
      // board 1 from round 2 onward, so the same player appeared at the top of the sheet.
      if (res.bye != null) boards.push({ white: res.bye, black: null, bye: true });
      t.rounds.push({
        number: t.rounds.length + 1,
        boards: materialise(boards),
        warnings: res.warnings.slice(),
        floats: res.floats,
      });
    }
    recompute(t);
    t.updatedAt = Date.now ? nowSafe() : 0;
    return true;
  }

  // `Date.now` is fine in the browser; the tests inject time instead, so this is only ever reached
  // from a real click.
  function nowSafe() { return new Date().getTime(); }

  function materialise(boards) {
    return boards.map(function (b, i) {
      return {
        board: i + 1,
        white: b.white,
        black: b.black == null ? null : b.black,
        isBye: !!b.bye,
        // A bye is decided the moment it is awarded — it is not a game anybody plays, and leaving
        // it `pending` is what let the server compute standings that ignored it (§7 #12).
        result: b.bye ? BYE : PENDING,
      };
    });
  }

  // ---- Results ---------------------------------------------------------------------------------

  var RESULTS = [WHITE_WIN, BLACK_WIN, DRAW];

  function setResult(doc, tid, roundNumber, board, result) {
    var t = tournament(doc, tid);
    if (!t) return false;
    var r = roundOf(t, roundNumber);
    if (!r) return false;
    var b = r.boards.filter(function (x) { return x.board === board; })[0];
    if (!b || b.isBye) return false;
    if (result !== PENDING && RESULTS.indexOf(result) < 0) return false;

    // Results lock when the tournament is finished (§1.10, §7 #17) — with ONE exception: clearing.
    //
    // A literal reading of "results are locked" is unimplementable alongside Clear Result (§1.5,
    // §7 #23). Finishing is *caused* by the last result being entered, so the moment you make a
    // typo on the deciding board the tournament locks and the new Clear Result button can never
    // reach it. The rule that satisfies both is: once finished, no result may be CHANGED to another
    // result, but it may be cleared — which returns the tournament to `.ongoing`, after which
    // ordinary editing applies again. Clearing is the deliberate "I got that wrong" action, so it
    // is exactly the one that should still work.
    //
    // Recorded as a deviation in PORTING_NOTES.md.
    //
    // The first version of this guard read `status(t) === FINISHED && b.result === PENDING`, which
    // is DEAD CODE: finished means zero pending boards, so it could never fire. It looked like a
    // lock and locked nothing.
    if (result !== PENDING && status(t) === FINISHED) return false;
    b.result = result;
    recompute(t);
    t.updatedAt = nowSafe();
    return true;
  }

  /** Spec §1.5's fourth option, which the RN app had no way to express. */
  function clearResult(doc, tid, roundNumber, board) {
    return setResult(doc, tid, roundNumber, board, PENDING);
  }

  function roundOf(t, n) {
    for (var i = 0; i < t.rounds.length; i++) if (t.rounds[i].number === n) return t.rounds[i];
    return null;
  }

  // ---- Recomputation ----------------------------------------------------------------------------

  /**
   * Rebuild every derived field on every player, from the rounds alone.
   *
   * Order matters in exactly one place: the tie-breaks need final scores, so they run last.
   */
  function recompute(t) {
    var byId = {};
    t.players.forEach(function (p) {
      p.score = 0; p.wins = 0; p.draws = 0; p.losses = 0; p.byes = 0;
      p.whiteGames = 0; p.blackGames = 0;
      p.colors = []; p.floats = []; p.opponentIds = []; p.hadBye = false;
      p.buchholz = 0; p.buchholzCut1 = 0; p.sonnebornBerger = 0; p.directEncounter = 0;
      byId[p.id] = p;
    });

    var games = [];
    t.rounds.forEach(function (r) {
      // Colour history is indexed by round, so a player who was not paired at all still needs a
      // slot — otherwise "the colour of my last game" silently reads someone else's round.
      var seen = {};
      r.boards.forEach(function (b) {
        var w = byId[b.white], bl = b.black == null ? null : byId[b.black];
        if (b.isBye) {
          if (w) {
            w.score += 1; w.byes += 1; w.hadBye = true;
            w.colors.push(null); seen[w.id] = true;
          }
          return;
        }
        if (!w || !bl) return;
        seen[w.id] = true; seen[bl.id] = true;
        w.colors.push('w'); bl.colors.push('b');
        w.whiteGames += 1; bl.blackGames += 1;
        w.opponentIds.push(bl.id); bl.opponentIds.push(w.id);
        if (b.result === WHITE_WIN)      { w.score += 1; w.wins++; bl.losses++; }
        else if (b.result === BLACK_WIN) { bl.score += 1; bl.wins++; w.losses++; }
        else if (b.result === DRAW)      { w.score += 0.5; bl.score += 0.5; w.draws++; bl.draws++; }
        if (b.result !== PENDING) {
          games.push({ white: w.id, black: bl.id,
                       result: b.result === WHITE_WIN ? 'w' : (b.result === BLACK_WIN ? 'b' : 'd') });
        }
      });
      t.players.forEach(function (p) { if (!seen[p.id]) p.colors.push(null); });
      var f = r.floats || {};
      t.players.forEach(function (p) { p.floats.push(f[p.id] || 'none'); });
    });

    var tb = ENG.tiebreaks(t.players.map(function (p) {
      return { id: p.id, score: p.score };
    }), games);
    t.players.forEach(function (p) {
      var x = tb.get(p.id);
      if (!x) return;
      p.buchholz = x.buchholz;
      p.buchholzCut1 = x.buchholzCut1;
      p.sonnebornBerger = x.sonnebornBerger;
      p.directEncounter = x.directEncounter;
    });
  }

  // ---- Standings -------------------------------------------------------------------------------

  /**
   * ONE ordering, used by the table, the share image and the share text (spec §7 #13).
   *
   * The RN app had three: the server ranked on five keys including direct encounter, the `show`
   * payload sorted by score and Buchholz only, and the client sorted by four keys and dropped
   * direct encounter — so the same tournament produced a different leader depending on where you
   * looked.
   */
  function standings(t) {
    return ENG.standingsOrder(t.players.map(function (p) {
      return {
        id: p.id, name: p.name, rating: p.rating, seed: p.seed, score: p.score,
        directEncounter: p.directEncounter, buchholz: p.buchholz,
        buchholzCut1: p.buchholzCut1, sonnebornBerger: p.sonnebornBerger,
        wins: p.wins, draws: p.draws, losses: p.losses, byes: p.byes,
      };
    }));
  }

  function player(t, id) {
    for (var i = 0; i < t.players.length; i++) if (t.players[i].id === id) return t.players[i];
    return null;
  }

  // ---- Self-test --------------------------------------------------------------------------------

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    // --- bulk parsing, including everything the round-trip test is there to reject ---
    eq(parseBulkLine('Juan Dela Cruz').name, 'Juan Dela Cruz', 'a name with no rating');
    eq(parseBulkLine('Juan Dela Cruz').rating, null, 'and no rating');
    eq(parseBulkLine('Maria Santos 1500').name, 'Maria Santos', 'name split from rating');
    eq(parseBulkLine('Maria Santos 1500').rating, 1500, 'the rating');
    eq(parseBulkLine('Pedro 007').rating, null, 'a leading zero does not round-trip');
    eq(parseBulkLine('Pedro 007').name, 'Pedro 007', 'so the whole line is the name');
    eq(parseBulkLine('Ana 15.5').rating, null, 'a decimal does not round-trip');
    eq(parseBulkLine('Ana 1500abc').rating, null, 'trailing junk does not round-trip');
    eq(parseBulkLine('Ana 3001').rating, null, 'above the ceiling');
    eq(parseBulkLine('Ana 3000').rating, 3000, 'at the ceiling');
    eq(parseBulkLine('Ana 0').rating, 0, 'zero is a rating');
    expect(parseBulkLine('   ') === null, 'a blank line is not a player');
    expect(parseBulkLine('') === null, 'nor is an empty one');
    // One token, so the rating branch never opens: a bare number is somebody's name.
    eq(parseBulkLine('1500').name, '1500', 'a lone number is a name, not a rating');
    eq(parseBulkLine('1500').rating, null, 'with no rating');

    // --- a tournament must have a name ---
    var blank = emptyDoc();
    expect(create(blank, { name: '', type: SWISS, totalRounds: 3 }, 1) === null,
           'an empty name creates nothing');
    expect(create(blank, { name: '   ', type: SWISS, totalRounds: 3 }, 1) === null,
           'nor does whitespace');
    eq(blank.tournaments.length, 0, 'and the document is untouched');
    expect(create(blank, { name: ' Real ', type: SWISS, totalRounds: 3 }, 1) != null,
           'a real name is accepted');
    eq(blank.tournaments[0].name, 'Real', 'and stored trimmed');

    // --- seeds: monotonic, and dense after a removal (spec 7 #1) ---
    var doc = emptyDoc();
    var id = create(doc, { name: 'Manila Open', type: SWISS, totalRounds: 3 }, 1000);
    var t = tournament(doc, id);
    ['A', 'B', 'C', 'D'].forEach(function (n) { addPlayer(doc, id, { name: n }); });
    eq(t.players.map(function (p) { return p.seed; }).join(','), '1,2,3,4', 'seeds start dense');
    removePlayer(doc, id, t.players[1].id);
    eq(t.players.map(function (p) { return p.seed; }).join(','), '1,2,3',
       'and are renumbered densely on removal');
    eq(t.players.map(function (p) { return p.name; }).join(','), 'A,C,D',
       'without reordering the survivors');
    addPlayer(doc, id, { name: 'E' });
    eq(t.players.map(function (p) { return p.seed; }).join(','), '1,2,3,4',
       'a later add continues the dense run rather than colliding');

    // --- status is computed, never stored (spec 1.10) ---
    eq(status(t), SETUP, 'a tournament with no rounds is in setup');
    expect(generate(doc, id), 'round 1 generates');
    eq(status(t), ONGOING, 'and the tournament is now ongoing');
    eq(t.rounds[0].boards.length, 2, 'four players make two boards');
    expect(addPlayer(doc, id, { name: 'F' }) == null, 'players are locked once play starts');

    // --- results, and the fact that clearing is the same code path ---
    var b1 = t.rounds[0].boards[0];
    expect(setResult(doc, id, 1, 1, WHITE_WIN), 'a result is accepted');
    eq(player(t, b1.white).score, 1, 'the winner has a point');
    eq(player(t, b1.black).score, 0, 'the loser has none');
    expect(clearResult(doc, id, 1, 1), 'and it can be cleared');
    eq(player(t, b1.white).score, 0, 'which takes the point back');
    eq(player(t, b1.white).wins, 0, 'and the win');
    // Recomputation, not reversal: the counters cannot drift because there is only one of them.
    expect(setResult(doc, id, 1, 1, DRAW), 'and re-entered as something else');
    eq(player(t, b1.white).score, 0.5, 'a draw is half a point');
    eq(player(t, b1.white).draws, 1, 'counted once');

    // --- a bye scores at generation, not later (spec 7 #12) ---
    var d2 = emptyDoc();
    var oddId = create(d2, { name: 'Odd', type: SWISS, totalRounds: 3 }, 1000);
    ['A', 'B', 'C'].forEach(function (n) { addPlayer(d2, oddId, { name: n }); });
    var odd = tournament(d2, oddId);
    generate(d2, oddId);
    var byeBoard = odd.rounds[0].boards[odd.rounds[0].boards.length - 1];
    expect(byeBoard.isBye, 'the bye is on the LAST board');
    eq(byeBoard.result, BYE, 'and is decided immediately');
    eq(player(odd, byeBoard.white).score, 1, 'worth a point before any result is entered');
    eq(player(odd, byeBoard.white).byes, 1, 'and counted as a bye');
    eq(player(odd, byeBoard.white).wins, 0, 'but not as a win');

    // --- colour history keeps a slot for the bye, so "my last colour" stays truthful ---
    eq(player(odd, byeBoard.white).colors.length, 1, 'the bye still occupies a round');
    eq(player(odd, byeBoard.white).colors[0], null, 'as a null colour');

    // --- finishing locks new results ---
    var d3 = emptyDoc();
    var fid = create(d3, { name: 'Short', type: SWISS, totalRounds: 1 }, 1000);
    ['A', 'B'].forEach(function (n) { addPlayer(d3, fid, { name: n }); });
    var f = tournament(d3, fid);
    generate(d3, fid);
    eq(status(f), ONGOING, 'one round generated, none decided');
    setResult(d3, fid, 1, 1, WHITE_WIN);
    eq(status(f), FINISHED, 'the last result finishes the tournament');
    expect(!canGenerate(f), 'and no further round can be generated');
    // Locked: a finished result cannot be swapped for a different one...
    expect(!setResult(d3, fid, 1, 1, DRAW), 'a finished result cannot be changed');
    eq(f.rounds[0].boards[0].result, WHITE_WIN, 'and the original stands');
    // ...but it CAN be cleared, which is the whole point of Clear Result existing.
    expect(clearResult(d3, fid, 1, 1), 'but it can be cleared');
    eq(status(f), ONGOING, 'which reopens the tournament');
    expect(setResult(d3, fid, 1, 1, DRAW), 'and then it is editable again');
    eq(status(f), FINISHED, 'the replacement finishes it once more');

    // --- round robin: the whole schedule at once, everyone meets everyone ---
    var d4 = emptyDoc();
    var rid = create(d4, { name: 'RR', type: ROUND_ROBIN, totalRounds: 0 }, 1000);
    ['A', 'B', 'C', 'D', 'E'].forEach(function (n) { addPlayer(d4, rid, { name: n }); });
    var rr = tournament(d4, rid);
    generate(d4, rid);
    eq(rr.rounds.length, 5, 'five players play five rounds');
    expect(!canGenerate(rr), 'and the schedule is generated exactly once');
    var met = {};
    rr.rounds.forEach(function (r) {
      r.boards.forEach(function (b) {
        if (b.isBye) return;
        var k = [b.white, b.black].sort().join('|');
        expect(!met[k], 'every pair meets exactly once (' + k + ')');
        met[k] = true;
      });
    });
    eq(Object.keys(met).length, 10, 'five players make ten distinct games');

    // --- persistence degrades to an empty document rather than throwing ---
    eq(decode('').tournaments.length, 0, 'no document');
    eq(decode('{{{').tournaments.length, 0, 'a corrupt document');
    eq(decode('{"nope":1}').tournaments.length, 0, 'a document of the wrong shape');
    var round = decode(encode(doc));
    eq(round.tournaments.length, doc.tournaments.length, 'a real document round-trips');
    eq(round.tournaments[0].players.length, doc.tournaments[0].players.length, 'with its players');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'pairing-store: ' + passed + ' assertions passed'
        : 'pairing-store: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return {
    KEY: KEY, VERSION: VERSION,
    SWISS: SWISS, ROUND_ROBIN: ROUND_ROBIN,
    PENDING: PENDING, WHITE_WIN: WHITE_WIN, BLACK_WIN: BLACK_WIN, DRAW: DRAW, BYE: BYE,
    SETUP: SETUP, ONGOING: ONGOING, FINISHED: FINISHED,
    emptyDoc: emptyDoc, decode: decode, encode: encode, load: load, save: save,
    tournament: tournament, create: create, remove: remove,
    status: status, totalRoundsOf: totalRoundsOf, pendingCount: pendingCount,
    roundComplete: roundComplete,
    addPlayer: addPlayer, bulkAdd: bulkAdd, bulkCount: bulkCount, parseBulkLine: parseBulkLine,
    removePlayer: removePlayer, player: player,
    canGenerate: canGenerate, generate: generate, roundOf: roundOf,
    setResult: setResult, clearResult: clearResult,
    recompute: recompute, standings: standings,
    selfTest: selfTest,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairingStore; }
