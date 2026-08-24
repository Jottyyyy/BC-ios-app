/* opening-tree.js — the JS twin of Sources/BiyaherongCoachCore/OpeningTree.swift.
 *
 * A SAN-keyed move tree over your own games, with win/draw/loss per candidate. Ported from
 * `analysis-board/openingtree.tsx` (1,457 lines) in the sibling RN repo, which is itself a rebuild
 * of https://www.openingtree.com — the site the client named.
 *
 * This half is the one that RUNS on Windows, so it is the gate: `tools/qa/replay_opening_tree.js`
 * replays the Swift's hand-authored tables through it, and `js_goldens.js` runs `selfTest()`.
 * Keep the two in step move for move — see the doc comment on the Swift for the two rules that
 * matter (stats are the MOVER's, and the sort tie-breaks by SAN).
 */
(function (global) {
  'use strict';

  /**
   * The engine and the PGN parser, resolved LAZILY.
   *
   * Both attach themselves differently: `engine.js` sets `global.Engine`, `pgn.js` declares
   * `BiyaPGN` as a file-level `var` — a global under a `<script>` tag, module-scoped under
   * `require`. Capturing either at load time works in the browser and breaks under Node whenever
   * this file is required first. Lazy lookup works in both, and a missing dependency becomes a
   * named error rather than `undefined is not a function` twenty frames down.
   */
  function engine() {
    if (global.Engine) return global.Engine;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('./engine.js');
    }
    throw new Error('opening-tree.js needs engine.js — load it first');
  }

  /**
   * `pgn.js` declares `BiyaPGN` as a file-level `var`, which is a global under a `<script>` tag and
   * module-scoped under `require`. Resolved lazily so this file works in both, and so the browser
   * never sees a `require` call: the load order in index.html puts pgn.js first, but a lazy lookup
   * means a reorder degrades to a clear error instead of a silently undefined dependency.
   */
  function pgnLib() {
    if (global.BiyaPGN) return global.BiyaPGN;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('./pgn.js');
    }
    throw new Error('opening-tree.js needs pgn.js — load it first');
  }

  /* ---- constants (mirrored in Swift) --------------------------------------- */
  var DEFAULT_MAX_PLIES = 40;   // INVENTED — see the Swift, and PORTING_NOTES
  // INVENTED — how far off the tree a user may wander. NOT a reuse of DEFAULT_MAX_PLIES: that one
  // bounds how much of a GAME is worth recording, this one how far a USER may go. See the Swift.
  var MAX_FREE_PLIES = 20;

  var OUTCOMES = { whiteWin: '1-0', blackWin: '0-1', draw: '1/2-1/2' };

  /** Tolerant of the spellings real exporters emit. null for `*` or anything unrecognised. */
  function parseOutcome(text) {
    var t = String(text == null ? '' : text).trim();
    if (t === '1-0' || t === '1−0') return OUTCOMES.whiteWin;
    if (t === '0-1' || t === '0−1') return OUTCOMES.blackWin;
    if (t === '1/2-1/2' || t === '1/2' || t === '½-½' || t === '0.5-0.5') {
      return OUTCOMES.draw;
    }
    return null;
  }

  /** Did white win (+1), lose (-1) or draw (0)? The primitive the mover inversion is built on. */
  function outcomeScore(outcome, forWhite) {
    if (outcome === OUTCOMES.draw) return 0;
    if (outcome === OUTCOMES.whiteWin) return forWhite ? 1 : -1;
    if (outcome === OUTCOMES.blackWin) return forWhite ? -1 : 1;
    return 0;
  }

  var COLOURS = { white: 'white', black: 'black', both: 'both' };
  function colourAccepts(colour, isWhite) {
    if (colour === COLOURS.white) return isWhite;
    if (colour === COLOURS.black) return !isWhite;
    return true;
  }

  /* ---- the tree ------------------------------------------------------------ */

  function emptyNode() { return { count: 0, wins: 0, draws: 0, losses: 0, children: {} }; }

  function createTree() {
    return { root: {}, gameCount: 0, rejectedCount: 0 };
  }

  /**
   * Replay a game and increment every node along its path. Faithful to `addGamesToTree`, including
   * the two things about it that look like bugs and are not: an unparseable move TRUNCATES the game
   * rather than dropping it, and legality is judged by the position with the SAN re-generated from
   * the parsed move, so `Qxd8+` / `Qxd8` / an over-disambiguated spelling all collapse to one key.
   *
   * Returns the number of plies actually inserted.
   */
  function addGame(tree, game, maxPlies) {
    var cap = (maxPlies === undefined || maxPlies === null) ? DEFAULT_MAX_PLIES : maxPlies;
    tree.gameCount++;

    var E = engine();
    var pos = E.start();
    if (!pos) return 0;

    // Resolve the SAN first, then insert: the walk needs the mover's colour at each ply, and taking
    // it from the position BEFORE the move is exact where ply parity is only a convention.
    var steps = [];
    for (var i = 0; i < game.sanMoves.length; i++) {
      if (steps.length >= cap) break;
      var mv = E.parseSan(pos, game.sanMoves[i]);
      if (!mv) break;
      steps.push({ san: E.san(pos, mv), moverIsWhite: pos.sideToMove === E.WHITE });
      pos = E.makeMove(pos, mv);
    }

    if (!steps.length) { tree.rejectedCount++; return 0; }
    insert(steps, 0, tree.root, game);
    return steps.length;
  }

  /** The recursive half. Mirrors the Swift's `insert`, inversion and all. */
  function insert(steps, i, children, game) {
    if (i >= steps.length) return;
    var step = steps[i];
    var node = children[step.san];
    if (!node) { node = emptyNode(); children[step.san] = node; }
    node.count++;

    // The mover inversion. `outcomeScore` is the tree OWNER's result; a node records the MOVER's,
    // so it flips on the opponent's plies.
    if (game.outcome) {
      var ownerScore = outcomeScore(game.outcome, game.userIsWhite);
      var moverIsOwner = (step.moverIsWhite === game.userIsWhite);
      var moverScore = moverIsOwner ? ownerScore : -ownerScore;
      if (moverScore > 0) node.wins++;
      else if (moverScore < 0) node.losses++;
      else node.draws++;
    }

    insert(steps, i + 1, node.children, game);
  }

  function addGames(tree, games, maxPlies) {
    for (var i = 0; i < games.length; i++) addGame(tree, games[i], maxPlies);
  }

  /* ---- reading ------------------------------------------------------------- */

  function childrenAt(tree, path) {
    var level = tree.root;
    for (var i = 0; i < path.length; i++) {
      var next = level[path[i]];
      if (!next) return {};
      level = next.children;
    }
    return level;
  }

  /**
   * How many LEADING plies of `path` still exist in the tree.
   *
   * `childrenAt` answers `{}` both at a leaf and for a path that has left the tree, which is why
   * the explorer could not tell "your games stop here" from "you played something none of them
   * did". This is the same walk, reporting WHERE IT STOPPED. `bookDepth === path.length` is on
   * book; anything less is the ply at which the user left it.
   *
   * A transposition is still off book — the tree is keyed by the LINE you played, which is the
   * type's whole premise. See the Swift.
   */
  function bookDepth(tree, path) {
    var level = tree.root, depth = 0;
    for (var i = 0; i < path.length; i++) {
      var next = level[path[i]];
      if (!next) return depth;
      depth++;
      level = next.children;
    }
    return depth;
  }

  function nodeAt(tree, path) {
    var level = tree.root, found = null;
    for (var i = 0; i < path.length; i++) {
      var next = level[path[i]];
      if (!next) return null;
      found = next;
      level = next.children;
    }
    return found;
  }

  function scored(n) { return n.wins + n.draws + n.losses; }

  /**
   * `part / scored`, clamped to 0..1, or 0 when nothing is scored.
   *
   * The RN bar uses `flex: wins` and lets the layout normalise, which cannot express "no scored
   * games": three zero-flex children collapse and the bar silently vanishes. An explicit share lets
   * both UIs draw an empty track instead.
   */
  function share(cand, part) {
    var total = cand.wins + cand.draws + cand.losses;
    if (total <= 0 || part <= 0) return 0;
    return Math.min(1, part / total);
  }

  /**
   * The candidate list — count DESCENDING, ties broken by SAN ASCENDING.
   *
   * The tie-break is not decoration. Object key order is insertion order here but arbitrary in the
   * Swift `Dictionary`, and Swift's `sort` is not stable, so a comparator on `count` alone would
   * put the two languages in different orders and no replay could compare them.
   */
  function sortedMoves(tree, path) {
    var level = childrenAt(tree, path);
    var out = Object.keys(level).map(function (san) {
      var n = level[san];
      return {
        san: san, count: n.count, wins: n.wins, draws: n.draws, losses: n.losses,
        hasContinuations: Object.keys(n.children).length > 0
      };
    });
    out.sort(function (a, b) {
      if (a.count !== b.count) return b.count - a.count;
      return a.san < b.san ? -1 : (a.san > b.san ? 1 : 0);
    });
    return out;
  }

  function mostPlayed(tree, path) {
    var s = sortedMoves(tree, path);
    return s.length ? s[0].san : null;
  }

  function nodeCount(tree) {
    function count(level) {
      var n = 0;
      for (var k in level) if (Object.prototype.hasOwnProperty.call(level, k)) {
        n += 1 + count(level[k].children);
      }
      return n;
    }
    return count(tree.root);
  }

  function depth(tree) {
    function deepest(level) {
      var d = 0;
      for (var k in level) if (Object.prototype.hasOwnProperty.call(level, k)) {
        d = Math.max(d, 1 + deepest(level[k].children));
      }
      return d;
    }
    return deepest(tree.root);
  }

  /* ---- PGN -> games -------------------------------------------------------- */

  /**
   * Reuses `BiyaPGN.splitGames` and `mainlineTokens`, both pinned to the real PHP
   * `PgnImportService` by the `pgn_split` / `pgn_tokens` golden groups — so multi-game splitting,
   * RAV skipping and NAG stripping are the backend's behaviour, not a second implementation.
   */
  function gamesFromPGN(pgn, opts) {
    var o = opts || {};
    var userName = (o.userName || '').trim();
    var fallbackIsWhite = o.fallbackIsWhite !== false;
    var colour = o.colour || COLOURS.both;
    var out = [];
    var PGN = pgnLib();
    var raws = PGN.splitGames(pgn);
    for (var i = 0; i < raws.length; i++) {
      var raw = raws[i];
      var tokens = PGN.mainlineTokens(raw.movetext);
      if (!tokens.length) continue;

      var white = raw.headers.White || '';
      var black = raw.headers.Black || '';
      var isWhite = fallbackIsWhite;
      if (userName) {
        if (white.toLowerCase() === userName.toLowerCase()) isWhite = true;
        else if (black.toLowerCase() === userName.toLowerCase()) isWhite = false;
      }
      if (!colourAccepts(colour, isWhite)) continue;

      // The Result tag, or the movetext's own terminator when the tag is missing — plenty of
      // hand-pasted exports carry only one of the two. It is read off the RAW movetext, not off
      // `tokens`: `mainlineTokens` drops result tokens by design, so looking there would find the
      // last MOVE and quietly never match.
      var outcome = parseOutcome(raw.headers.Result || '');
      if (!outcome) {
        var tail = String(raw.movetext || '').trim().split(/\s+/).pop();
        outcome = parseOutcome(tail || '');
      }
      out.push({ sanMoves: tokens, userIsWhite: isWhite, outcome: outcome });
    }
    return out;
  }

  /* ---- self-test ----------------------------------------------------------- */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    // 1. outcome parsing, including the spellings that are NOT the canonical three
    expect(parseOutcome('1-0') === OUTCOMES.whiteWin, '1-0');
    expect(parseOutcome('0-1') === OUTCOMES.blackWin, '0-1');
    expect(parseOutcome('1/2-1/2') === OUTCOMES.draw, '1/2-1/2');
    expect(parseOutcome('½-½') === OUTCOMES.draw, 'the half glyph');
    expect(parseOutcome('*') === null, 'an unfinished game has no outcome');
    expect(parseOutcome('') === null, 'nor does a missing tag');
    expect(outcomeScore(OUTCOMES.whiteWin, true) === 1, 'white wins, for white');
    expect(outcomeScore(OUTCOMES.whiteWin, false) === -1, 'white wins, for black');
    expect(outcomeScore(OUTCOMES.draw, true) === 0, 'a draw scores zero either way');

    // 2. one game, and the MOVER inversion — the rule the whole feature turns on
    var t = createTree();
    addGame(t, { sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true, outcome: OUTCOMES.whiteWin });
    expect(t.gameCount === 1, 'one game counted');
    expect(nodeCount(t) === 3, 'three nodes for three plies');
    expect(depth(t) === 3, 'and a depth of three');
    var e4 = nodeAt(t, ['e4']);
    expect(e4 && e4.count === 1 && e4.wins === 1 && e4.losses === 0,
      'the owner played e4 and won, so e4 is a win');
    var c5 = nodeAt(t, ['e4', 'c5']);
    expect(c5 && c5.count === 1 && c5.wins === 0 && c5.losses === 1,
      'the OPPONENT played c5 and lost, so c5 is a loss — the inversion');
    var nf3 = nodeAt(t, ['e4', 'c5', 'Nf3']);
    expect(nf3 && nf3.wins === 1, 'and Nf3 is the owner again');

    // …and the same game seen from the other side inverts every node.
    var t2 = createTree();
    addGame(t2, { sanMoves: ['e4', 'c5'], userIsWhite: false, outcome: OUTCOMES.whiteWin });
    expect(nodeAt(t2, ['e4']).wins === 1, 'e4 is still a win for the side that played it');
    expect(nodeAt(t2, ['e4', 'c5']).losses === 1, 'and c5 still a loss, whoever owns the tree');

    // 3. an unfinished game contributes a count and no result
    var t3 = createTree();
    addGame(t3, { sanMoves: ['d4'], userIsWhite: true, outcome: null });
    var d4 = nodeAt(t3, ['d4']);
    expect(d4.count === 1 && scored(d4) === 0, 'an unfinished game counts but does not score');

    // 4. truncation, not rejection
    var t4 = createTree();
    var plies = addGame(t4, { sanMoves: ['e4', 'e5', 'Qz9', 'Nf3'], userIsWhite: true,
                              outcome: OUTCOMES.draw });
    expect(plies === 2, 'the walk stops at the bad token');
    expect(nodeCount(t4) === 2, 'and keeps everything before it');
    expect(t4.rejectedCount === 0, 'a truncated game is not a rejected one');

    // …but a game whose FIRST move is unreadable is rejected outright and says so.
    var t5 = createTree();
    expect(addGame(t5, { sanMoves: ['Zz9'], userIsWhite: true, outcome: null }) === 0,
      'nothing inserted');
    expect(t5.rejectedCount === 1 && t5.gameCount === 1, 'and it is counted as rejected');

    // 5. canonical SAN collapses spellings
    var t6 = createTree();
    addGame(t6, { sanMoves: ['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7'], userIsWhite: true,
                  outcome: OUTCOMES.whiteWin });
    addGame(t6, { sanMoves: ['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7#'], userIsWhite: true,
                  outcome: OUTCOMES.whiteWin });
    var mate = sortedMoves(t6, ['e4', 'e5', 'Qh5', 'Nc6']);
    expect(mate.length === 1, 'Qxf7 and Qxf7# are the same move, not two branches');
    expect(mate[0].count === 2, 'and both games land on it');

    // 6. the sort: count descending, SAN ascending on a tie
    var t7 = createTree();
    ['e4', 'e4', 'd4', 'c4', 'Nf3'].forEach(function (first) {
      addGame(t7, { sanMoves: [first], userIsWhite: true, outcome: OUTCOMES.draw });
    });
    var moves = sortedMoves(t7, []);
    expect(moves[0].san === 'e4' && moves[0].count === 2, 'the most played is first');
    expect(moves[1].san === 'Nf3', 'ties break by SAN ascending — N sorts before c and d');
    expect(moves[2].san === 'c4' && moves[3].san === 'd4', 'and the rest follow');
    expect(mostPlayed(t7, []) === 'e4', 'forward plays the most-played child');
    expect(mostPlayed(t7, ['e4']) === null, 'and stops at a leaf');
    expect(moves[0].hasContinuations === false, 'a one-ply game leaves no continuations');

    // 7. shares, and the empty-track case the RN bar could not express
    var c = { san: 'e4', count: 4, wins: 2, draws: 1, losses: 1 };
    expect(Math.abs(share(c, c.wins) - 0.5) < 1e-9, 'half the scored games were wins');
    expect(Math.abs(share(c, c.draws) - 0.25) < 1e-9, 'a quarter drawn');
    expect(share({ wins: 0, draws: 0, losses: 0 }, 0) === 0, 'nothing scored is zero, not NaN');

    // 8. the ply cap
    var long = [];
    for (var i = 0; i < 30; i++) { long.push('Nf3'); long.push('Nf6'); long.push('Ng1'); long.push('Ng8'); }
    var t8 = createTree();
    expect(addGame(t8, { sanMoves: long, userIsWhite: true, outcome: null }, 6) === 6,
      'the cap truncates the walk');
    expect(depth(t8) === 6, 'and the tree is exactly that deep');
    expect(DEFAULT_MAX_PLIES === 40, 'the ply cap');
    expect(MAX_FREE_PLIES === 20 && MAX_FREE_PLIES % 2 === 0 && MAX_FREE_PLIES < DEFAULT_MAX_PLIES,
      'the free-play cap is a whole number of full moves, shorter than the tree');

    // 9. PGN -> games, including who the owner was
    var pgn = '[White "Alice"]\n[Black "Bob"]\n[Result "0-1"]\n\n1. e4 e5 2. Nf3 0-1\n\n'
            + '[White "Bob"]\n[Black "Alice"]\n[Result "1-0"]\n\n1. d4 d5 1-0\n';
    var games = gamesFromPGN(pgn, { userName: 'alice' });
    expect(games.length === 2, 'two games split apart');
    expect(games[0].userIsWhite === true && games[0].outcome === OUTCOMES.blackWin,
      'Alice was White in the first and lost it');
    expect(games[1].userIsWhite === false && games[1].outcome === OUTCOMES.whiteWin,
      'and Black in the second, which she also lost');
    expect(gamesFromPGN(pgn, { userName: 'alice', colour: COLOURS.white }).length === 1,
      'the colour filter keeps only her White games');
    expect(gamesFromPGN(pgn, { userName: 'alice', colour: COLOURS.black }).length === 1,
      'and only her Black ones');
    // No Result tag: the movetext terminator carries it.
    var bare = gamesFromPGN('[Event "x"]\n\n1. e4 e5 1/2-1/2\n', {});
    expect(bare.length === 1 && bare[0].outcome === OUTCOMES.draw,
      'the terminator stands in for a missing Result tag');
    // An unknown name falls back rather than dropping the game.
    var unknown = gamesFromPGN(pgn, { userName: 'carol', fallbackIsWhite: false });
    expect(unknown.length === 2 && unknown[0].userIsWhite === false,
      'an unmatched name uses the fallback side');

    // 10. round trip through JSON, which is how the store keeps a tree
    var t10 = createTree();
    addGames(t10, gamesFromPGN(pgn, { userName: 'alice' }));
    var back = JSON.parse(JSON.stringify(t10));
    expect(JSON.stringify(sortedMoves(back, [])) === JSON.stringify(sortedMoves(t10, [])),
      'a serialised tree reads back identically');

    // 11. a path off the tree is empty, not a crash
    expect(sortedMoves(t10, ['e4', 'Zz9']).length === 0, 'an unknown path has no candidates');
    expect(nodeAt(t10, ['Zz9']) === null, 'and no node');
    expect(childrenAt(t10, ['Zz9', 'e4']) && Object.keys(childrenAt(t10, ['Zz9'])).length === 0,
      'walking past it stays empty');

    // 12. bookDepth — the distinction `childrenAt` cannot make. Both of the cases below give it
    //     `{}`, and only one of them means "you left the book".
    var t12 = createTree();
    addGame(t12, { sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true, outcome: OUTCOMES.whiteWin });
    expect(bookDepth(t12, []) === 0, 'the empty path is zero plies into the book');
    expect(bookDepth(t12, ['e4']) === 1, 'one on-book ply is one');
    expect(bookDepth(t12, ['e4', 'c5', 'Nf3']) === 3, 'and the whole line is three');
    expect(bookDepth(t12, ['d4']) === 0, 'a first move nobody played is zero, not one');
    expect(bookDepth(t12, ['e4', 'e5']) === 1, 'a divergence at ply two reports ply one');
    expect(bookDepth(t12, ['e4', 'e5', 'Nf3']) === 1,
      'and stays there however far the user plays on');
    expect(bookDepth(t12, ['e4', 'c5', 'Nf3', 'd6']) === 3,
      'playing on past a LEAF is off book too — a leaf and a divergence answer the same');
    expect(bookDepth(t12, ['Zz9']) === 0, 'an unreadable SAN is simply not in the tree');
    // The transposition, asserted as a DECISION rather than discovered as a surprise.
    expect(bookDepth(t12, ['Nf3', 'c5', 'e4']) === 0,
      '1.Nf3 c5 2.e4 transposes into 1.e4 c5 2.Nf3 and is STILL off book: this tree is keyed by '
      + 'the LINE you played, which is why OpeningBook exists and keys by FEN');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'OpeningTree: ' + passed + ' assertions passed'
        : 'OpeningTree: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  global.BiyaOpeningTree = {
    DEFAULT_MAX_PLIES: DEFAULT_MAX_PLIES,
    MAX_FREE_PLIES: MAX_FREE_PLIES,
    OUTCOMES: OUTCOMES,
    COLOURS: COLOURS,
    parseOutcome: parseOutcome,
    outcomeScore: outcomeScore,
    colourAccepts: colourAccepts,
    create: createTree,
    addGame: addGame,
    addGames: addGames,
    childrenAt: childrenAt,
    bookDepth: bookDepth,
    nodeAt: nodeAt,
    scored: scored,
    share: share,
    sortedMoves: sortedMoves,
    mostPlayed: mostPlayed,
    nodeCount: nodeCount,
    depth: depth,
    gamesFromPGN: gamesFromPGN,
    selfTest: selfTest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.BiyaOpeningTree;
})(typeof window !== 'undefined' ? window : globalThis);
