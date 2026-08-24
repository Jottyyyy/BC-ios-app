/* opening-download.js — the JS twin of Sources/BiyaherongCoachCore/OpeningDownload.swift.
 *
 * The wire formats of the Opening Tree's two online sources, ported from `fetchLichessStreaming`
 * and `fetchChessComChunked` in the sibling RN repo's `analysis-board/openingtree.tsx`.
 *
 * The client's report is why this exists: *"hindi nag-oopening tree"* — picking Lichess or
 * Chess.com validated the username and then returned `errNetwork` ("Could not reach that site"),
 * blaming their connection for a download nobody had written.
 *
 * Everything above the `run` section is PURE — bytes in, values out, no network — and that is the
 * half `tools/qa/replay_opening_tree.js` replays the Swift's tables against. The `fetch` calls at
 * the bottom are the browser's answer to `BiyaherongUI/OpeningDownloader.swift`; they are the only
 * network in `web-demo/`, exactly as the Swift ones are the only `URLSession` in the app.
 */
(function (global) {
  'use strict';

  function tree() {
    if (global.BiyaOpeningTree) return global.BiyaOpeningTree;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('./opening-tree.js');
    }
    throw new Error('opening-download.js needs opening-tree.js — load it first');
  }

  /* ---- sites and failures --------------------------------------------------- */

  var SITES = { lichess: 'lichess', chesscom: 'chesscom' };

  /**
   * Why a download produced nothing. Two cases, because the user can act on exactly two things:
   * the name they typed and the radio. A 500, a dropped connection and a truncated body are all
   * `network`, since "try again" is the only useful advice for any of them.
   */
  var FAILURES = { unknownUser: 'unknownUser', network: 'network' };

  /* ---- limits --------------------------------------------------------------- */

  var FREE_MAX_GAMES = 100;
  var PREMIUM_MAX_GAMES = 1000;
  var MIN_MAX_GAMES = 1;

  /** `resolvedMax` from the RN screen, exactly. Free ignores the box; premium clamps it. */
  function resolvedMax(isPremium, requested) {
    if (!isPremium) return FREE_MAX_GAMES;
    var n = parseInt(requested, 10);
    if (!n || n < MIN_MAX_GAMES) n = MIN_MAX_GAMES;
    return Math.min(n, PREMIUM_MAX_GAMES);
  }

  /* ---- requests ------------------------------------------------------------- */

  // `encodeURIComponent` is the reference the Swift `componentAllowed` set was written FROM, so
  // the two languages build byte-identical URLs and the replay can compare them directly.
  function encodeComponent(raw) { return encodeURIComponent(String(raw == null ? '' : raw)); }

  /**
   * `pgnInJson=true` is what makes each streamed line carry a `moves` string. Without it Lichess
   * sends PGN text and the whole line-oriented parse below has nothing to key on.
   */
  function lichessGamesURL(username, maxGames) {
    return 'https://lichess.org/api/games/user/' + encodeComponent(username)
      + '?pgnInJson=true&max=' + maxGames;
  }

  var LICHESS_ACCEPT = 'application/x-ndjson';

  /** Chess.com has no "last N games" endpoint — it publishes one archive per month. */
  function chesscomArchivesURL(username) {
    return 'https://api.chess.com/pub/player/' + encodeComponent(username) + '/games/archives';
  }

  /** A 404 is the one status that means something the user can fix. */
  function failureForStatus(code) {
    return code === 404 ? FAILURES.unknownUser : FAILURES.network;
  }

  function isSuccess(code) { return code >= 200 && code < 300; }

  /* ---- Lichess NDJSON ------------------------------------------------------- */

  /**
   * Lichess statuses that mean the game has NO RESULT, as distinct from a drawn one.
   *
   * A deliberate deviation from the RN screen, recorded in PORTING_NOTES.md. Its mapping is
   * `winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2'`, so an ABORTED game —
   * no winner, no result, very often the first game in a stream — scores as a draw for both
   * sides. `opening-tree.js` already decided the other way for pasted PGN, and an import path
   * that disagrees with the paste path about the same game is worse than the bug being fixed.
   */
  var LICHESS_UNFINISHED = ['created', 'started', 'aborted', 'noStart', 'unknownFinish'];

  function isUnfinishedStatus(status) {
    return LICHESS_UNFINISHED.indexOf(String(status == null ? '' : status)) >= 0;
  }

  /**
   * Which side the tree's owner had, read from the GAME rather than assumed from the form.
   *
   * This is where the online path is allowed to be better than the RN one. `addGamesToTree` takes
   * the White/Black picker as the answer whenever it is not "both", so a tree built as "White"
   * labels every game White — including the ones the user had Black in, whose results then land
   * inverted. The username is known for every online game, so the real colour is available, and
   * the picker FILTERS on it exactly as the paste path does.
   */
  function lichessUserIsWhite(root, username, fallback) {
    var wanted = String(username == null ? '' : username).trim();
    if (!wanted || !root || !root.players) return fallback;
    function name(side) {
      var p = root.players[side];
      return p && p.user && typeof p.user.name === 'string' ? p.user.name : null;
    }
    var w = name('white');
    if (w && w.toLowerCase() === wanted.toLowerCase()) return true;
    var b = name('black');
    if (b && b.toLowerCase() === wanted.toLowerCase()) return false;
    return fallback;
  }

  /** `winner` when there is one; otherwise a draw unless the status says it never finished. */
  function lichessOutcome(root) {
    var OT = tree();
    if (!root) return null;
    if (root.winner === 'white') return OT.OUTCOMES.whiteWin;
    if (root.winner === 'black') return OT.OUTCOMES.blackWin;
    return isUnfinishedStatus(root.status) ? null : OT.OUTCOMES.draw;
  }

  /**
   * One NDJSON line → one game, or null if the line is not one.
   *
   * Null rather than throwing for the same reason the RN `.filter()` drops them: a stream is read
   * while it arrives, and one malformed line must not lose the 99 good ones around it.
   */
  function gameFromLichessLine(line, username, fallbackIsWhite) {
    var text = String(line == null ? '' : line).trim();
    if (!text) return null;
    var root;
    try { root = JSON.parse(text); } catch (e) { return null; }
    if (!root || typeof root.moves !== 'string') return null;

    var sanMoves = root.moves.split(' ').filter(function (s) { return s.length > 0; });
    if (!sanMoves.length) return null;

    return {
      sanMoves: sanMoves,
      userIsWhite: lichessUserIsWhite(root, username, fallbackIsWhite),
      outcome: lichessOutcome(root)
    };
  }

  /** A whole NDJSON body — or any complete-lines chunk of one — filtered by colour. */
  function gamesFromLichessNDJSON(text, username, colour) {
    var OT = tree();
    var out = [];
    var lines = String(text == null ? '' : text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var g = gameFromLichessLine(lines[i], username, colour !== OT.COLOURS.black);
      if (!g) continue;
      if (!OT.colourAccepts(colour, g.userIsWhite)) continue;
      out.push(g);
    }
    return out;
  }

  /**
   * The index one past the last complete line in `buffer`, or -1 when there is not one.
   *
   * The streaming reader's whole correctness rests on this: a chunk boundary falls anywhere,
   * including the middle of a JSON object, and parsing half a line drops a game silently. The RN
   * `processBuffer` does the same with `lastIndexOf('\n')`.
   */
  function lastCompleteLineEnd(buffer) {
    var i = String(buffer == null ? '' : buffer).lastIndexOf('\n');
    return i < 0 ? -1 : i + 1;
  }

  /* ---- Chess.com archives --------------------------------------------------- */

  /**
   * The archive URLs, NEWEST MONTH FIRST.
   *
   * Chess.com publishes them oldest-first and the RN code reverses the list. Not cosmetic: the
   * walk stops at `maxGames`, so the order decides WHICH games a 100-game tree is built from.
   * Oldest-first would build every free user a tree of the games they played when they signed up,
   * which is precisely the opposite of what an opening tree is asked for.
   */
  function chesscomArchives(json) {
    if (!json || !Array.isArray(json.archives)) return [];
    return json.archives.filter(function (a) { return typeof a === 'string'; }).slice().reverse();
  }

  /**
   * One month's archive → games, newest first within the month, filtered by colour.
   *
   * The PGN each entry carries goes to `gamesFromPGN` rather than a regex the way the RN version
   * does. That parser is already pinned to the real `PgnImportService`, and it reads the
   * `White`/`Black`/`Result` tags Chess.com already writes — so the colour match, the result and
   * the RAV/NAG handling are all the paste path's behaviour, for free.
   */
  function gamesFromChesscomArchive(json, username, colour) {
    var OT = tree();
    if (!json || !Array.isArray(json.games)) return [];
    var out = [];
    var entries = json.games.slice().reverse();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e.pgn !== 'string' || !e.pgn) continue;
      var parsed = OT.gamesFromPGN(e.pgn, {
        userName: username,
        fallbackIsWhite: colour !== OT.COLOURS.black,
        colour: colour
      });
      for (var j = 0; j < parsed.length; j++) out.push(parsed[j]);
    }
    return out;
  }

  /**
   * Trim a just-arrived chunk to the room left under the ceiling.
   *
   * Both sites overshoot, for different reasons — Lichess returns whole lines, Chess.com whole
   * months — so both callers need this and neither should re-derive it. An empty array back is
   * also the signal to stop asking for more.
   */
  function trim(games, have, limit) {
    var room = limit - have;
    if (room <= 0) return [];
    return room >= games.length ? games : games.slice(0, room);
  }

  /* ---- running it ----------------------------------------------------------- */
  //
  // The only network in web-demo/, and the twin of the only URLSession in the app.

  /**
   * Stream a Lichess user's games, calling `onGames` with each complete-lines chunk.
   *
   * `response.body.getReader()` is the browser's answer to the RN `xhr.onprogress` loop: read a
   * chunk, decode it, keep only up to the last newline, parse that, carry the remainder forward.
   * Falls back to a whole-body read where streams are unavailable, which costs the live counter
   * but not the tree.
   */
  function runLichess(opts) {
    var username = opts.username, colour = opts.colour, limit = opts.limit;
    var onGames = opts.onGames || function () {};
    var cancelled = opts.cancelled || function () { return false; };
    var total = 0;

    return fetch(lichessGamesURL(username, limit), {
      headers: { Accept: LICHESS_ACCEPT }
    }).then(function (res) {
      if (!isSuccess(res.status)) throw makeFailure(failureForStatus(res.status));
      if (!res.body || !res.body.getReader) {
        return res.text().then(function (text) {
          emit(gamesFromLichessNDJSON(text, username, colour));
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function pump() {
        if (cancelled() || total >= limit) return reader.cancel().catch(function () {});
        return reader.read().then(function (r) {
          if (r.done) {
            if (buffer.trim()) emit(gamesFromLichessNDJSON(buffer, username, colour));
            return undefined;
          }
          buffer += decoder.decode(r.value, { stream: true });
          var end = lastCompleteLineEnd(buffer);
          if (end >= 0) {
            emit(gamesFromLichessNDJSON(buffer.slice(0, end), username, colour));
            buffer = buffer.slice(end);
          }
          return pump();
        });
      }
      return pump();
    }).then(function () { return total; }, function (e) { throw asFailure(e); });

    function emit(games) {
      var kept = trim(games, total, limit);
      if (!kept.length) return;
      total += kept.length;
      onGames(kept, total);
    }
  }

  /** Chess.com, archive by archive, newest month first — the twin of `fetchChessComChunked`. */
  function runChesscom(opts) {
    var username = opts.username, colour = opts.colour, limit = opts.limit;
    var onGames = opts.onGames || function () {};
    var cancelled = opts.cancelled || function () { return false; };
    var total = 0;

    return fetch(chesscomArchivesURL(username)).then(function (res) {
      if (!isSuccess(res.status)) throw makeFailure(failureForStatus(res.status));
      return res.json();
    }).then(function (json) {
      var months = chesscomArchives(json);

      // Sequential, not `Promise.all`: the ceiling is a running total, so a month only knows how
      // much room it has once the newer ones have been counted. Parallel fetches would also hand
      // Chess.com a burst of requests for a list that is routinely 100+ months long.
      function next(i) {
        if (i >= months.length || total >= limit || cancelled()) return Promise.resolve();
        return fetch(months[i]).then(function (r) {
          return isSuccess(r.status) ? r.json() : null;
        }).then(function (monthJson) {
          if (monthJson) {
            var kept = trim(gamesFromChesscomArchive(monthJson, username, colour), total, limit);
            if (kept.length) { total += kept.length; onGames(kept, total); }
          }
          return next(i + 1);
        }, function () {
          // One unreadable month is skipped, exactly as the RN `catch { continue }` does. Losing
          // April must not lose the other 99 months with it.
          return next(i + 1);
        });
      }
      return next(0);
    }).then(function () { return total; }, function (e) { throw asFailure(e); });
  }

  function makeFailure(kind) {
    var e = new Error(kind);
    e.openingFailure = kind;
    return e;
  }

  /** Anything that is not already one of our two cases is a connection problem. */
  function asFailure(e) {
    if (e && e.openingFailure) return e;
    return makeFailure(FAILURES.network);
  }

  function run(site, opts) {
    return site === SITES.chesscom ? runChesscom(opts) : runLichess(opts);
  }

  /* ---- self-test ------------------------------------------------------------ */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }
    function eq(a, b, w) { expect(a === b, w + ' — expected ' + b + ', got ' + a); }

    var OT = tree();

    // 1. limits
    eq(resolvedMax(false, 900), 100, 'a free account gets 100 whatever the box says');
    eq(resolvedMax(true, 900), 900, 'premium gets what it asks for');
    eq(resolvedMax(true, 9000), 1000, 'premium is clamped to 1000');
    eq(resolvedMax(true, 0), 1, 'a zero box is one game, not none');
    eq(resolvedMax(true, NaN), 1, 'and so is an unparseable one');

    // 2. URLs
    eq(lichessGamesURL('Magnus', 50),
      'https://lichess.org/api/games/user/Magnus?pgnInJson=true&max=50', 'the lichess URL');
    eq(lichessGamesURL('a b/c', 1),
      'https://lichess.org/api/games/user/a%20b%2Fc?pgnInJson=true&max=1',
      'a username cannot escape its path segment');
    eq(chesscomArchivesURL('Hikaru'),
      'https://api.chess.com/pub/player/Hikaru/games/archives', 'the chess.com URL');

    // 3. failures
    eq(failureForStatus(404), FAILURES.unknownUser, '404 is a bad username');
    eq(failureForStatus(500), FAILURES.network, '500 is a connection problem');
    eq(failureForStatus(200), FAILURES.network, 'and so is anything else non-2xx-shaped');
    expect(isSuccess(200) && isSuccess(299) && !isSuccess(300) && !isSuccess(199),
      'success is 200..299');

    // 4. one NDJSON line
    var line = JSON.stringify({
      moves: 'e4 c5 Nf3', winner: 'white', status: 'mate',
      players: { white: { user: { name: 'Alice' } }, black: { user: { name: 'Bob' } } }
    });
    var g = gameFromLichessLine(line, 'alice', true);
    expect(g !== null, 'a well-formed line parses');
    eq(g.sanMoves.length, 3, 'three plies');
    eq(g.userIsWhite, true, 'and the username matched White case-insensitively');
    eq(g.outcome, OT.OUTCOMES.whiteWin, 'winner:white is 1-0');

    var asBlack = gameFromLichessLine(line, 'BOB', true);
    eq(asBlack.userIsWhite, false, 'the same game, from Black’s side');

    var noMatch = gameFromLichessLine(line, 'carol', false);
    eq(noMatch.userIsWhite, false, 'an unmatched username falls back to the picker');

    expect(gameFromLichessLine('', 'a', true) === null, 'a blank line is not a game');
    expect(gameFromLichessLine('{oops', 'a', true) === null, 'nor is broken JSON');
    expect(gameFromLichessLine('{"winner":"white"}', 'a', true) === null, 'nor is one with no moves');
    expect(gameFromLichessLine('{"moves":""}', 'a', true) === null, 'nor is an empty move list');

    // 5. the aborted-game deviation
    var aborted = gameFromLichessLine(
      JSON.stringify({ moves: 'e4', status: 'aborted' }), 'a', true);
    eq(aborted.outcome, null, 'an aborted game has NO result — the RN code scores it as a draw');
    var drawn = gameFromLichessLine(
      JSON.stringify({ moves: 'e4 e5', status: 'draw' }), 'a', true);
    eq(drawn.outcome, OT.OUTCOMES.draw, 'a real draw still is one');
    var stalemate = gameFromLichessLine(
      JSON.stringify({ moves: 'e4 e5', status: 'stalemate' }), 'a', true);
    eq(stalemate.outcome, OT.OUTCOMES.draw, 'and so is a stalemate');

    // 6. a whole body, and the colour filter
    var body = [
      JSON.stringify({ moves: 'e4 c5', winner: 'white', status: 'mate',
        players: { white: { user: { name: 'Alice' } }, black: { user: { name: 'Bob' } } } }),
      '',
      JSON.stringify({ moves: 'd4 Nf6', winner: 'black', status: 'resign',
        players: { white: { user: { name: 'Bob' } }, black: { user: { name: 'Alice' } } } })
    ].join('\n');
    eq(gamesFromLichessNDJSON(body, 'alice', OT.COLOURS.both).length, 2, 'both games, for both');
    var whiteOnly = gamesFromLichessNDJSON(body, 'alice', OT.COLOURS.white);
    eq(whiteOnly.length, 1, 'one game as White');
    eq(whiteOnly[0].userIsWhite, true, 'and it is the one she had White in');
    var blackOnly = gamesFromLichessNDJSON(body, 'alice', OT.COLOURS.black);
    eq(blackOnly.length, 1, 'one game as Black');
    eq(blackOnly[0].outcome, OT.OUTCOMES.blackWin, 'which she won');

    // 7. chunk boundaries
    eq(lastCompleteLineEnd('abc'), -1, 'a chunk with no newline holds no complete line');
    eq(lastCompleteLineEnd('a\nb'), 2, 'and one with a newline ends there');
    eq(lastCompleteLineEnd('a\nb\n'), 4, 'a trailing newline is a complete line');
    var half = body.slice(0, body.indexOf('\n') + 5);
    eq(gamesFromLichessNDJSON(half.slice(0, lastCompleteLineEnd(half)), 'alice',
      OT.COLOURS.both).length, 1, 'a split chunk yields only its complete line');

    // 8. chess.com archives
    eq(chesscomArchives({ archives: ['a/2024/01', 'b/2024/02'] })[0], 'b/2024/02',
      'archives come back newest first');
    eq(chesscomArchives({}).length, 0, 'a shapeless body is no archives');
    eq(chesscomArchives({ archives: 'nope' }).length, 0, 'and so is a non-array');

    var pgnA = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 c5 1-0';
    var pgnB = '[White "Bob"]\n[Black "Alice"]\n[Result "1-0"]\n\n1. d4 Nf6 1-0';
    var month = { games: [{ pgn: pgnA }, { pgn: pgnB }] };
    var monthGames = gamesFromChesscomArchive(month, 'Alice', OT.COLOURS.both);
    eq(monthGames.length, 2, 'both games in the month');
    eq(monthGames[0].userIsWhite, false, 'newest first — Alice had Black in the later game');
    eq(gamesFromChesscomArchive(month, 'Alice', OT.COLOURS.white).length, 1,
      'the colour filter reaches the archive path too');
    eq(gamesFromChesscomArchive({ games: [{}, { pgn: '' }] }, 'a', OT.COLOURS.both).length, 0,
      'entries with no PGN are skipped, not counted');

    // 9. the ceiling
    eq(trim([1, 2, 3], 0, 2).length, 2, 'a chunk is trimmed to the room left');
    eq(trim([1, 2, 3], 2, 2).length, 0, 'and none of it survives once the ceiling is reached');
    eq(trim([1, 2, 3], 0, 9).length, 3, 'an under-full chunk passes whole');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'OpeningDownload: ' + passed + ' assertions passed'
        : 'OpeningDownload: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  global.BiyaOpeningDownload = {
    SITES: SITES,
    FAILURES: FAILURES,
    FREE_MAX_GAMES: FREE_MAX_GAMES,
    PREMIUM_MAX_GAMES: PREMIUM_MAX_GAMES,
    MIN_MAX_GAMES: MIN_MAX_GAMES,
    LICHESS_ACCEPT: LICHESS_ACCEPT,
    LICHESS_UNFINISHED: LICHESS_UNFINISHED,
    resolvedMax: resolvedMax,
    encodeComponent: encodeComponent,
    lichessGamesURL: lichessGamesURL,
    chesscomArchivesURL: chesscomArchivesURL,
    failureForStatus: failureForStatus,
    isSuccess: isSuccess,
    isUnfinishedStatus: isUnfinishedStatus,
    lichessUserIsWhite: lichessUserIsWhite,
    lichessOutcome: lichessOutcome,
    gameFromLichessLine: gameFromLichessLine,
    gamesFromLichessNDJSON: gamesFromLichessNDJSON,
    lastCompleteLineEnd: lastCompleteLineEnd,
    chesscomArchives: chesscomArchives,
    gamesFromChesscomArchive: gamesFromChesscomArchive,
    trim: trim,
    run: run,
    selfTest: selfTest
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.BiyaOpeningDownload;
})(typeof window !== 'undefined' ? window : globalThis);
