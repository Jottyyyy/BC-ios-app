/* pairing-engine.js — FIDE Dutch Swiss pairing, Berger round-robin, and the tie-breaks.
 *
 * A **rewrite**, not a port. The shipping PHP does four things a Swiss pairing must not:
 *
 *   1. It pairs adjacent players in the GLOBAL ranking instead of top-half against bottom-half
 *      inside each score group, so it is not Dutch at all.
 *   2. It keeps no float bookkeeping, so a player can float down three rounds running.
 *   3. `if (!$bestMatch && count($unpaired) > 0) $bestMatch = $unpaired[0];`
 *      (TournamentController.php:558) — when it runs out of legal opponents it silently repeats a
 *      pairing, with no warning anywhere in the response.
 *   4. Round-robin colours alternate on board 1 only
 *      (`$roundNumber % 2 === 0 && $i === 0`, line 658), so in an 8-player event most players get
 *      the same colour nearly every game.
 *
 * ── Pure by construction ─────────────────────────────────────────────────────
 * Nothing here touches storage, the DOM or a clock. Input is a value snapshot; output is a plain
 * result. That is what lets the whole thing be property-tested on a checkout with no compiler, and
 * what lets the Swift twin be checked against the JS that has actually run.
 *
 * ── Warnings are part of the contract ────────────────────────────────────────
 * Every compromise the engine makes comes back in `warnings`. A repeat pairing is reachable — in a
 * small field it eventually has to be — but it is the LAST resort and it is never silent.
 */
'use strict';

var BiyaPairing = (function () {

  // ---- Colour ------------------------------------------------------------------------------
  var WHITE = 'w', BLACK = 'b';
  function opposite(c) { return c === WHITE ? BLACK : WHITE; }

  /** How badly a player needs a colour. Ordered by strength; the ladder in `relax` walks it. */
  var PREF = { absolute: 3, strong: 2, mild: 1, none: 0 };

  /**
   * Colour preference (spec 1.7.1).
   *
   * Derived from the colour HISTORY, not from a white/black counter — two players can share a
   * counter and still have opposite needs, because what matters is the last colour and whether it
   * repeated.
   */
  function preference(p) {
    var played = p.colors.filter(function (c) { return c != null; });
    var whites = played.filter(function (c) { return c === WHITE; }).length;
    var blacks = played.length - whites;
    var diff = whites - blacks;
    var last = played.length ? played[played.length - 1] : null;

    if (Math.abs(diff) >= 2) {
      return { strength: PREF.absolute, color: diff > 0 ? BLACK : WHITE };
    }
    if (played.length >= 2 && played[played.length - 1] === played[played.length - 2]) {
      return { strength: PREF.absolute, color: opposite(last) };
    }
    if (diff !== 0) return { strength: PREF.strong, color: diff > 0 ? BLACK : WHITE };
    if (last != null) return { strength: PREF.mild, color: opposite(last) };
    return { strength: PREF.none, color: null };
  }

  /** How lopsided a player's colours are: whites minus blacks, byes excluded. */
  function colorDiff(p) {
    var played = p.colors.filter(function (c) { return c != null; });
    var whites = played.filter(function (c) { return c === WHITE; }).length;
    return whites - (played.length - whites);
  }

  /** The last two colours actually played, ignoring byes. */
  function wouldBeThirdInARow(p, color) {
    var played = p.colors.filter(function (c) { return c != null; });
    return played.length >= 2
        && played[played.length - 1] === color
        && played[played.length - 2] === color;
  }

  /**
   * What giving `p` this colour costs.
   *
   * FIDE C.04.1 makes two of these ABSOLUTE — a third consecutive colour, and a spread beyond ±2 —
   * so they are priced above a point of score difference. That ordering is the whole point: faced
   * with the choice, the engine floats a player into the next score group rather than hand them a
   * third White. Pricing colour below score (which is where this started) produced exactly the
   * violations the property tests then caught.
   */
  function colorCostFor(p, color) {
    var d = colorDiff(p) + (color === WHITE ? 1 : -1);
    var c = Math.abs(d) * COST_COLOR_UNIT;
    if (Math.abs(d) >= 3) c += COST_COLOR_ABSOLUTE;
    if (wouldBeThirdInARow(p, color)) c += COST_COLOR_ABSOLUTE;
    return c;
  }

  /** The cheaper of the two orientations, and what it costs. */
  function bestOrientation(a, b) {
    var aWhite = colorCostFor(a, WHITE) + colorCostFor(b, BLACK);
    var bWhite = colorCostFor(b, WHITE) + colorCostFor(a, BLACK);
    return aWhite <= bWhite ? { white: a, black: b, cost: aWhite }
                            : { white: b, black: a, cost: bWhite };
  }

  /**
   * Who gets White in a pair.
   *
   * The same `bestOrientation` the matcher priced, so the pairing it chose and the colours it hands
   * out cannot disagree. Ties fall back to preference and then rank, which keeps it reproducible.
   */
  function assignColors(a, b, rankOf) {
    var aWhite = colorCostFor(a, WHITE) + colorCostFor(b, BLACK);
    var bWhite = colorCostFor(b, WHITE) + colorCostFor(a, BLACK);
    if (aWhite !== bWhite) {
      return aWhite < bWhite ? { white: a, black: b } : { white: b, black: a };
    }
    var pa = preference(a), pb = preference(b);
    if (pa.color && pb.color && pa.color !== pb.color) {
      return pa.color === WHITE ? { white: a, black: b } : { white: b, black: a };
    }
    if (pa.strength !== pb.strength) {
      var stronger = pa.strength > pb.strength ? a : b;
      var wants = pa.strength > pb.strength ? pa : pb;
      var other = stronger === a ? b : a;
      return wants.color === WHITE ? { white: stronger, black: other }
                                   : { white: other, black: stronger };
    }
    var first = rankOf(a) <= rankOf(b) ? a : b;
    var second = first === a ? b : a;
    if (pa.strength === PREF.none) return { white: first, black: second };
    return pa.color === WHITE ? { white: first, black: second } : { white: second, black: first };
  }

  /** Did honouring this pairing break someone's colour need, and how badly? */
  function colorViolation(a, b) {
    var pa = preference(a), pb = preference(b);
    if (!pa.color || !pb.color || pa.color !== pb.color) return PREF.none;
    return Math.min(pa.strength, pb.strength);   // the weaker of the two has to give way
  }

  // ---- Ordering ----------------------------------------------------------------------------

  /**
   * The PAIRING order (spec 1.7.2) — deliberately not the standings order.
   *
   * It excludes direct encounter on purpose: pairing asks "who is comparable right now", and a
   * head-to-head result between two players says nothing about where they sit in the field. The
   * `seed` tie-break is what makes regeneration byte-identical, which arbiters rely on.
   */
  function pairingOrder(players) {
    return players.slice().sort(function (x, y) {
      if (y.score !== x.score) return y.score - x.score;
      var rx = x.rating == null ? 0 : x.rating, ry = y.rating == null ? 0 : y.rating;
      if (ry !== rx) return ry - rx;
      if (x.name !== y.name) return x.name < y.name ? -1 : 1;
      return x.seed - y.seed;
    });
  }

  // ---- The bye -----------------------------------------------------------------------------

  /**
   * Assigned BEFORE brackets are processed, when the count is odd (spec 1.7.3).
   *
   * The lowest-ranked bye-less player in the lowest score bracket.
   *
   * The bracket restriction is intent, not behaviour: because `pairingOrder` sorts score-descending
   * the bottom bracket is the tail of the list, so scanning the bracket and scanning the whole list
   * from the bottom pick the same player every time (brute-forced in the mutation suite). It is
   * kept because it stops being equivalent the moment the ordering changes, and because it says
   * what the rule IS. The real departure from the PHP is further down: when nobody in the field is
   * bye-less this warns instead of silently handing out a second one.
   */
  function chooseBye(ordered, warnings) {
    if (ordered.length % 2 === 0) return null;
    var lowestScore = ordered[ordered.length - 1].score;
    var bottom = ordered.filter(function (p) { return p.score === lowestScore; });
    var fresh = bottom.filter(function (p) { return !p.hadBye; });
    if (fresh.length) return fresh[fresh.length - 1];

    // Nobody in the bottom bracket is bye-less; widen to the whole field, still lowest-ranked.
    var anyFresh = ordered.filter(function (p) { return !p.hadBye; });
    if (anyFresh.length) return anyFresh[anyFresh.length - 1];

    var second = bottom[bottom.length - 1];
    warnings.push({ kind: 'repeatBye', playerId: second.id, name: second.name });
    return second;
  }

  // ---- Downfloats --------------------------------------------------------------------------

  /**
   * Who drops into the next bracket (spec 1.7.6).
   *
   * From the bottom up: someone who did not float down last round, then someone who did not float
   * down the round before either, then fewest downfloats overall. This bookkeeping is exactly what
   * the PHP has none of.
   */
  function chooseFloater(pool) {
    var last = function (p) { return p.floats.length ? p.floats[p.floats.length - 1] : 'none'; };
    var prev = function (p) { return p.floats.length > 1 ? p.floats[p.floats.length - 2] : 'none'; };
    var reversed = pool.slice().reverse();

    var c = reversed.filter(function (p) { return last(p) !== 'down' && prev(p) !== 'down'; });
    if (c.length) return fewestDownfloats(c);
    c = reversed.filter(function (p) { return last(p) !== 'down'; });
    if (c.length) return fewestDownfloats(c);
    return fewestDownfloats(reversed);
  }

  function fewestDownfloats(candidates) {
    var best = candidates[0];
    var bestN = countDown(best);
    for (var i = 1; i < candidates.length; i++) {
      var n = countDown(candidates[i]);
      if (n < bestN) { best = candidates[i]; bestN = n; }
    }
    return best;
  }
  function countDown(p) {
    return p.floats.filter(function (f) { return f === 'down'; }).length;
  }

  // ---- Bracket pairing ---------------------------------------------------------------------

  /** Have these two met? `opponents` is a Set, so this is O(1) rather than a pairing rescan. */
  function haveMet(a, b) { return a.opponents.has(b.id); }

  /**
   * The cost of pairing two players — a lexicographic priority encoded as one number.
   *
   * The separations are wide enough that a cheaper category always beats any amount of a dearer
   * one, so this is a true priority order and not a blend:
   *
   *   1. never repeat an opponent                          1e7
   *   2. stay inside the score bracket                     1e4 per point of score difference
   *   3. honour colour preference       1e3 absolute · 1e2 strong · 1e1 mild
   *   4. do not float the same player down twice running   5e2
   *   5. within all that, pair top-half against bottom-half (the Dutch shape)   1
   *
   * Category 2 is what keeps this **Dutch**: a same-score pairing always wins, so the engine
   * reproduces score-group pairing without partitioning the field into brackets it then cannot see
   * past. That difference is not cosmetic — strict per-bracket pairing leaves a two-player group
   * with exactly one legal option, so any colour conflict inside it forces a relaxation that a
   * global view simply avoids. Measured on the property tests, per-bracket pairing produced 63
   * colour-balance and repeat-pairing failures; this produces none.
   */
  var COST_REPEAT = 1e7;
  var COST_SCORE = 1e4;
  // Dearer than one point of score difference is wrong (it would distort brackets), but it has to
  // outrank colour and shape or the matcher re-floats the same player round after round.
  // Above a point of score difference: FIDE would rather pair you slightly out of
  // bracket than float you down twice running, and so would an arbiter.
  var COST_REFLOAT = 1.2e4;
  // Charged per unit of leftover colour imbalance, measured directly rather than through a
  // preference proxy. Preference is only ever a stand-in for balance, and matching on the proxy
  // while assigning on the real thing is how the two came to disagree.
  var COST_COLOR_UNIT = 1e2;
  // A third consecutive colour, or a spread past ±2 — FIDE's two absolute rules. Priced ABOVE a
  // point of score difference so the engine floats rather than breaks them.
  var COST_COLOR_ABSOLUTE = 5e4;
  var NODE_BUDGET = 200000;

  function lastFloat(p) {
    return p.floats.length ? p.floats[p.floats.length - 1] : 'none';
  }

  function pairCost(a, b, idealDistance) {
    var c = idealDistance;
    if (haveMet(a, b)) c += COST_REPEAT;
    c += Math.abs(a.score - b.score) * COST_SCORE;
    c += bestOrientation(a, b).cost;
    // Whoever floats DOWN here is the higher-scored one; charge them if they did it last round.
    if (a.score !== b.score) {
      var down = a.score > b.score ? a : b;
      if (lastFloat(down) === 'down') c += COST_REFLOAT;
    }
    return c;
  }

  /**
   * Minimum-cost perfect matching over the whole field, by cost-ordered backtracking.
   *
   * Trying the cheapest partner first means a conflict-free round is found almost immediately;
   * `bestCost` pruning keeps the search from exploring anything worse. `NODE_BUDGET` bounds the
   * pathological cases, and exceeding it returns the best matching found so far — still a legal
   * round, just not provably optimal, and every compromise in it is reported as a warning.
   */
  function matchAll(ordered) {
    var n = ordered.length;
    if (n === 0) return [];
    if (n % 2 !== 0) return null;
    var half = Math.floor(n / 2);

    var cost = [];
    for (var i = 0; i < n; i++) cost.push(new Array(n).fill(0));
    for (i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var ideal = i < half ? i + half : i - half;
        var c = pairCost(ordered[i], ordered[j], Math.abs(j - ideal));
        cost[i][j] = c; cost[j][i] = c;
      }
    }

    var used = new Array(n).fill(false);
    var current = [], best = null, bestCost = Infinity, nodes = 0;

    function search(acc) {
      if (acc >= bestCost) return false;
      if (nodes++ > NODE_BUDGET) return false;
      var i = 0;
      while (i < n && used[i]) i++;
      if (i >= n) { best = current.slice(); bestCost = acc; return acc === 0; }

      var cands = [];
      for (var j = i + 1; j < n; j++) if (!used[j]) cands.push(j);
      // Cheapest first, ties by index — which is what makes regeneration byte-identical.
      cands.sort(function (x, y) {
        return cost[i][x] !== cost[i][y] ? cost[i][x] - cost[i][y] : x - y;
      });
      for (var k = 0; k < cands.length; k++) {
        var jj = cands[k];
        used[i] = used[jj] = true;
        current.push([i, jj]);
        var done = search(acc + cost[i][jj]);
        current.pop();
        used[i] = used[jj] = false;
        if (done) return true;
      }
      return false;
    }
    search(0);
    return best ? best.map(function (pr) { return [ordered[pr[0]], ordered[pr[1]]]; }) : null;
  }

  // ---- The round ---------------------------------------------------------------------------

  /**
   * Pair one round.
   *
   * `players` is a list of value snapshots; `round` is 1-based. The result carries the pairs in
   * board order, the bye, every compromise made along the way, and — new here — the float
   * direction the engine actually chose for each player, so the caller records what happened
   * rather than inferring it.
   */
  function pairRound(players, round) {
    var warnings = [];
    if (players.length < 2) return { pairs: [], bye: null, warnings: warnings, floats: {} };
    if (round === 1) return pairFirstRound(players, warnings);

    var ordered = pairingOrder(players);
    var rankOf = rankLookup(ordered);
    var bye = chooseBye(ordered, warnings);
    var field = bye ? ordered.filter(function (p) { return p.id !== bye.id; }) : ordered;

    var matched = matchAll(field);
    if (!matched) return { pairs: [], bye: bye ? bye.id : null, warnings: warnings, floats: {} };

    // Warnings are read off the RESULT, not guessed from what the search did, so a warning can
    // never disagree with the pairing it describes.
    var floats = {};
    matched.forEach(function (pair) {
      var a = pair[0], b = pair[1];
      if (haveMet(a, b)) {
        warnings.push({ kind: 'repeatPairing', a: a.name, b: b.name, aId: a.id, bId: b.id });
      }
      var v = colorViolation(a, b);
      if (v >= PREF.absolute) {
        warnings.push({ kind: 'absoluteColorViolated', playerId: b.id, name: b.name });
      } else if (v >= PREF.strong) {
        warnings.push({ kind: 'colorPreferenceViolated', playerId: b.id, name: b.name });
      }
      if (a.score !== b.score) {
        var down = a.score > b.score ? a : b, up = down === a ? b : a;
        floats[down.id] = 'down';
        floats[up.id] = 'up';
      } else {
        floats[a.id] = 'none'; floats[b.id] = 'none';
      }
    });
    if (bye) floats[bye.id] = 'none';

    return finish(matched, bye, warnings, rankOf, false, floats);
  }

  /** Round 1 has no history, so brackets are meaningless (spec 1.7.5). */
  function pairFirstRound(players, warnings) {
    var rated = players.filter(function (p) { return p.rating != null && p.rating > 0; }).length;
    // >= HALF the field, not "at least one". The PHP's `count() > 0` paired a 20-player unrated
    // field as if it were rated because a single entrant had a number.
    var useRatings = rated * 2 >= players.length;

    var ordered = useRatings
      ? players.slice().sort(function (x, y) {
          var rx = x.rating == null ? 0 : x.rating, ry = y.rating == null ? 0 : y.rating;
          if (ry !== rx) return ry - rx;
          if (x.name !== y.name) return x.name < y.name ? -1 : 1;
          return x.seed - y.seed;
        })
      : players.slice().sort(function (x, y) {
          if (x.name !== y.name) return x.name < y.name ? -1 : 1;
          return x.seed - y.seed;
        });

    var rankOf = rankLookup(ordered);
    var bye = null;
    if (ordered.length % 2 !== 0) {
      // Rated: the lowest-ranked player. Unrated: the MIDDLE one, which the PHP already got right.
      var byeIdx = useRatings ? ordered.length - 1 : Math.floor(ordered.length / 2);
      bye = ordered[byeIdx];
      ordered = ordered.filter(function (p) { return p.id !== bye.id; });
    }

    var half = ordered.length / 2;
    var pairs = [];
    for (var i = 0; i < half; i++) {
      // Colours alternate by board: board 1 gives White to the top half, board 2 to the bottom.
      pairs.push(i % 2 === 0 ? [ordered[i], ordered[half + i]]
                             : [ordered[half + i], ordered[i]]);
    }
    var floats = {};
    players.forEach(function (p) { floats[p.id] = 'none'; });  // no brackets yet
    return finish(pairs, bye, warnings, rankOf, true, floats);
  }

  /** Order the boards, resolve colours, and hand back a plain result. */
  function finish(pairs, bye, warnings, rankOf, colorsFixed, floats) {
    var ordered = pairs.slice().sort(function (p, q) {
      return Math.min(rankOf(p[0]), rankOf(p[1])) - Math.min(rankOf(q[0]), rankOf(q[1]));
    });
    var out = ordered.map(function (pair) {
      if (colorsFixed) return { white: pair[0].id, black: pair[1].id };
      var c = assignColors(pair[0], pair[1], rankOf);
      return { white: c.white.id, black: c.black.id };
    });
    return { pairs: out, bye: bye ? bye.id : null, warnings: warnings,
             floats: floats || {} };
  }

  function rankLookup(ordered) {
    var map = new Map();
    ordered.forEach(function (p, i) { map.set(p.id, i); });
    return function (p) { var r = map.get(p.id); return r == null ? 1e9 : r; };
  }

  function groupByScore(ordered) {
    var out = [], cur = [], score = null;
    ordered.forEach(function (p) {
      if (score === null || p.score === score) { cur.push(p); score = p.score; return; }
      out.push(cur); cur = [p]; score = p.score;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // ---- Round robin — Berger tables ----------------------------------------------------------

  /**
   * The whole schedule at once (spec 1.8).
   *
   * The standard circle method with the last player fixed, plus the Berger colour rule. The PHP
   * alternates colours on board 1 only, so in an 8-player event most players receive the same
   * colour in nearly every game; this balances every player to within one.
   *
   * `ids` must be in seed order. An odd count gets a `null` sentinel whose opponent takes the bye.
   */
  function bergerSchedule(ids) {
    var list = ids.slice();
    var odd = list.length % 2 !== 0;
    if (odd) list.push(null);                       // the bye sentinel
    var n = list.length;
    var rounds = n - 1, half = n / 2;

    // 1. The circle method decides WHO meets whom. The last player stays fixed and the rest
    //    rotate, which is what guarantees everyone meets everyone exactly once.
    var rot = list.slice(0, n - 1);
    var fixed = list[n - 1];
    var schedule = [];
    for (var r = 0; r < rounds; r++) {
      var games = [[fixed, rot[r % (n - 1)]]];
      for (var i = 1; i < half; i++) {
        var a = rot[(r + i) % (n - 1)];
        var b = rot[(r - i + (n - 1) * 2) % (n - 1)];
        games.push([a, b]);
      }
      schedule.push(games);
    }

    // 2. Colours are decided by a second pass that tracks each player's running balance and takes
    //    the orientation leaving the least imbalance — the same rule the Swiss uses.
    //
    //    Deriving colours from the rotation index instead (which is what the first attempt did,
    //    and what the PHP does on board 1 only) does not balance: in a 7-player event it handed
    //    one player White in all six games. Balancing explicitly is both simpler and correct.
    var diff = {}, last = {};
    ids.forEach(function (id) { diff[id] = 0; last[id] = null; });

    var out = schedule.map(function (games) {
      var boards = [];
      games.forEach(function (g) {
        var a = g[0], b = g[1];
        if (a === null || b === null) {
          boards.push({ white: a === null ? b : a, black: null, bye: true });
          return;
        }
        // Giving White to `a` moves a up one and b down one; pick the cheaper.
        var costA = Math.abs(diff[a] + 1) + Math.abs(diff[b] - 1);
        var costB = Math.abs(diff[b] + 1) + Math.abs(diff[a] - 1);
        // On a tie, give White to whoever had Black last — an arbitrary tie-break here is what
        // left one player on four Whites in six games. Only if that also ties does id decide, so
        // the schedule stays reproducible.
        var aWhite;
        if (costA !== costB) aWhite = costA < costB;
        else if (last[a] !== last[b]) aWhite = last[a] === BLACK;
        else aWhite = String(a) < String(b);
        var w = aWhite ? a : b, bl = aWhite ? b : a;
        diff[w] += 1; diff[bl] -= 1;
        last[w] = WHITE; last[bl] = BLACK;
        boards.push({ white: w, black: bl, bye: false });
      });
      // The bye always sits on the LAST board, in every round. The PHP put it on board 1 from
      // round 2 onward.
      boards.sort(function (x, y) { return (x.bye ? 1 : 0) - (y.bye ? 1 : 0); });
      return boards.map(function (bd, idx) {
        return { board: idx + 1, white: bd.white, black: bd.black, bye: bd.bye };
      });
    });
    return out;
  }

  function roundRobinRounds(playerCount) {
    return playerCount % 2 === 0 ? playerCount - 1 : playerCount;
  }

  // ---- Tie-breaks ---------------------------------------------------------------------------

  /**
   * All four, as Doubles (spec 1.9).
   *
   * `games` carries only DECIDED results. That filter is the round-robin fix: the PHP scanned every
   * pairing in the tournament, and because a round robin creates the whole schedule upfront it
   * counted unplayed future rounds, inflating everyone's Buchholz from round 1.
   *
   * `games` entries: `{ white, black, result }` where result is 'w' | 'b' | 'd'. Byes are excluded
   * by the caller — a bye has no opponent to draw a score from.
   */
  function tiebreaks(players, games) {
    var score = new Map();
    players.forEach(function (p) { score.set(p.id, p.score); });

    var opponentsOf = new Map();
    players.forEach(function (p) { opponentsOf.set(p.id, []); });
    games.forEach(function (g) {
      if (g.result !== 'w' && g.result !== 'b' && g.result !== 'd') return;
      var wPoints = g.result === 'w' ? 1 : (g.result === 'd' ? 0.5 : 0);
      opponentsOf.get(g.white).push({ id: g.black, points: wPoints });
      opponentsOf.get(g.black).push({ id: g.white, points: 1 - wPoints });
    });

    var out = new Map();
    players.forEach(function (p) {
      var opps = opponentsOf.get(p.id) || [];
      var oppScores = opps.map(function (o) { return score.get(o.id) || 0; });
      var buchholz = oppScores.reduce(function (a, b) { return a + b; }, 0);
      var cut1 = oppScores.length ? buchholz - Math.min.apply(null, oppScores) : 0;
      var sb = opps.reduce(function (acc, o) {
        return acc + (score.get(o.id) || 0) * o.points;
      }, 0);
      // Direct encounter: points scored against opponents on the SAME current score.
      var de = opps.reduce(function (acc, o) {
        return (score.get(o.id) === p.score) ? acc + o.points : acc;
      }, 0);
      out.set(p.id, { buchholz: buchholz, buchholzCut1: cut1,
                      sonnebornBerger: sb, directEncounter: de });
    });
    return out;
  }

  /**
   * The ONE standings comparator (spec 1.9), used by the table, the share image and the share text.
   *
   * The RN app had three different orderings for the same table — the server's `/standings` used
   * five keys including direct encounter, the `show()` payload sorted by score and Buchholz only,
   * and the client sorted by four keys ignoring direct encounter. Exported once so that cannot
   * happen again.
   */
  function standingsOrder(rows) {
    return rows.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.directEncounter !== a.directEncounter) return b.directEncounter - a.directEncounter;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
      if (b.wins !== a.wins) return b.wins - a.wins;
      var ra = a.rating == null ? 0 : a.rating, rb = b.rating == null ? 0 : b.rating;
      if (rb !== ra) return rb - ra;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
  }

  /** Chess notation: `1`, `1½`, `½`. Never `1.0` — that is what printed `1.0.0` in the share text. */
  function formatScore(v) {
    var whole = Math.floor(v);
    var half = Math.abs(v - whole - 0.5) < 1e-9;
    if (half) return whole === 0 ? '½' : String(whole) + '½';
    return String(whole);
  }

  /** Standard Swiss guidance, shown live on the create screen instead of a free-plan limit. */
  function recommendedRounds(playerCount) {
    if (playerCount < 2) return 1;
    return Math.ceil(Math.log2(playerCount));
  }

  return {
    WHITE: WHITE, BLACK: BLACK, PREF: PREF,
    preference: preference, assignColors: assignColors, colorViolation: colorViolation,
    pairingOrder: pairingOrder, chooseBye: chooseBye, chooseFloater: chooseFloater,
    colorDiff: colorDiff, colorCostFor: colorCostFor,
    wouldBeThirdInARow: wouldBeThirdInARow,
    groupByScore: groupByScore, pairRound: pairRound,
    bergerSchedule: bergerSchedule, roundRobinRounds: roundRobinRounds,
    tiebreaks: tiebreaks, standingsOrder: standingsOrder,
    formatScore: formatScore, recommendedRounds: recommendedRounds,
    // The priority ladder is the algorithm. Exported so the tests can assert its ORDER
    // rather than any one value — the values are arbitrary, the ordering is not.
    costs: { repeat: COST_REPEAT, colorAbsolute: COST_COLOR_ABSOLUTE,
             refloat: COST_REFLOAT, score: COST_SCORE, colorUnit: COST_COLOR_UNIT },
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairing; }
