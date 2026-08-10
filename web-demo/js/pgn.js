/* pgn.js — PGN import and export, variations included
 *
 * The browser mirror of Sources/BiyaherongCoachCore/PGN.swift (Phase 3). PGN is not just an
 * interchange format here — it is the persistence format: a saved analysis is stored as its PGN
 * text plus an initial FEN, exactly as the Laravel `analysis_sessions.pgn` column does. So the
 * round trip has to be exact, and recursive variations have to survive it.
 *
 *     node -e "console.log(require('./web-demo/js/pgn.js').selfTest().summary)"
 *
 * Scope. Reads what real exporters emit: tag pairs with \" escapes, {block} and ;line comments,
 * % escape lines, $n NAGs, the !? suffix forms, recursive (variations), all four result tokens,
 * SetUp/FEN, and multi-game files. Writes a canonical form: Seven Tag Roster in order, one space
 * between tokens, wrapped at 80 columns.
 *
 * Null moves (`--`, `Z0`) are rejected — an explicit non-goal, not an oversight.
 *
 * A parse error does not throw away the game: parsing stops at the offending ply and the PARTIAL
 * tree is returned alongside the error, so the import UI can say "imported 34 of 41 moves".
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaPGN = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var T = isNode ? require('./movetree.js') : BiyaMoveTree;

  var MAX_RAV_DEPTH = 20;
  var MAX_NODES = 20000;

  var SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
  var TAG_DEFAULTS = {
    Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*'
  };
  // Emitted after the roster, in this order, when present.
  var EXTRA_TAGS = ['WhiteElo', 'BlackElo', 'ECO', 'Opening', 'TimeControl', 'Annotator',
                    'Location', 'SetUp', 'FEN'];

  // The six suffix annotations, in NAG numbering. Longest first so '!!' wins over '!'.
  var SUFFIX_NAGS = [['!!', 3], ['??', 4], ['!?', 5], ['?!', 6], ['!', 1], ['?', 2]];
  var NAG_SUFFIX = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

  var RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];

  // ---- Game splitting (faithful to PgnImportService::splitPgnGames) ----------
  // Reproduces the server's splitter exactly, including its raw (un-unescaped) tag values and the
  // leading space it prepends to every movetext chunk. parse() unescapes afterwards; keeping the
  // two apart is what lets Goldens/pgn_split.json compare byte for byte.
  function splitGames(pgn) {
    var text = String(pgn).replace(/\r\n?/g, '\n');
    var games = [];
    var lines = text.split('\n');
    var current = { headers: {}, movetext: '' };
    var inHeaders = true, hasContent = false;

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed === '') {
        if (inHeaders && hasContent) {
          inHeaders = false;
        } else if (!inHeaders && hasContent && current.movetext !== '') {
          games.push(current);
          current = { headers: {}, movetext: '' };
          inHeaders = true;
          hasContent = false;
        }
        continue;
      }
      hasContent = true;
      var m = inHeaders ? /^\[(\w+)\s+"(.*)"\]$/.exec(trimmed) : null;
      if (m) current.headers[m[1]] = m[2];
      else { inHeaders = false; current.movetext += ' ' + trimmed; }
    }
    if (current.movetext.trim() !== '') games.push(current);
    return games;
  }

  function unescapeTag(v) { return String(v).replace(/\\(["\\])/g, '$1'); }
  function escapeTag(v) { return String(v).replace(/([\\"])/g, '\\$1'); }

  // ---- Movetext scanner -----------------------------------------------------
  // Token: { type: 'move'|'number'|'comment'|'nag'|'ravOpen'|'ravClose'|'result'|'bad',
  //          value, san, nag }
  // Move tokens keep their !? suffix in `value` (so the token stream is directly comparable with
  // the PHP oracle's) while `san` is the bare move and `nag` the suffix's NAG code.

  function splitSuffix(tok) {
    for (var i = 0; i < SUFFIX_NAGS.length; i++) {
      var s = SUFFIX_NAGS[i][0];
      if (tok.length > s.length && tok.slice(-s.length) === s) {
        return { san: tok.slice(0, tok.length - s.length), nag: SUFFIX_NAGS[i][1] };
      }
    }
    return { san: tok, nag: 0 };
  }

  function tokenize(movetext) {
    // % escape lines are ignored entirely, per the PGN spec (column 0 only).
    var text = String(movetext).replace(/\r\n?/g, '\n').replace(/^%.*$/gm, ' ');
    var out = [], i = 0, n = text.length;

    while (i < n) {
      var c = text.charAt(i);
      if (c === ' ' || c === '\n' || c === '\t') { i++; continue; }
      if (c === '{') {
        var end = text.indexOf('}', i + 1);
        if (end < 0) { out.push({ type: 'comment', value: text.slice(i + 1).trim() }); break; }
        out.push({ type: 'comment', value: text.slice(i + 1, end).trim() });
        i = end + 1;
        continue;
      }
      if (c === ';') {
        var nl = text.indexOf('\n', i);
        if (nl < 0) { out.push({ type: 'comment', value: text.slice(i + 1).trim() }); break; }
        out.push({ type: 'comment', value: text.slice(i + 1, nl).trim() });
        i = nl + 1;
        continue;
      }
      if (c === '(') { out.push({ type: 'ravOpen' }); i++; continue; }
      if (c === ')') { out.push({ type: 'ravClose' }); i++; continue; }
      if (c === '$') {
        var nag = /^\$(\d+)/.exec(text.slice(i));
        if (nag) { out.push({ type: 'nag', value: parseInt(nag[1], 10) }); i += nag[0].length; continue; }
        i++;
        continue;
      }
      // A result token must stand alone — checked before move numbers so 1/2-1/2 is not read as "1".
      var rest = text.slice(i);
      var res = /^(1-0|0-1|1\/2-1\/2|\*)(?=$|[\s)])/.exec(rest);
      if (res) { out.push({ type: 'result', value: res[1] }); i += res[1].length; continue; }
      // Move numbers: "1." "12." "3..." and the no-space form "1.e4".
      var num = /^(\d+)(\.+)/.exec(rest);
      if (num) { out.push({ type: 'number', value: parseInt(num[1], 10) }); i += num[0].length; continue; }

      var word = /^[^\s(){};$]+/.exec(rest);
      if (!word) { i++; continue; }
      var raw = word[0];
      if (raw === '--' || raw === 'Z0' || raw === '@@@@') {
        out.push({ type: 'bad', value: raw });
      } else {
        var sp = splitSuffix(raw);
        out.push({ type: 'move', value: raw, san: sp.san, nag: sp.nag });
      }
      i += raw.length;
    }
    return out;
  }

  /** The main-line move tokens, RAV contents excluded, suffixes intact. */
  function mainlineTokens(movetext) {
    var toks = tokenize(movetext), depth = 0, out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.type === 'ravOpen') { depth++; continue; }
      if (t.type === 'ravClose') { if (depth > 0) depth--; continue; }
      if (depth === 0 && t.type === 'move') out.push(t.value);
    }
    return out;
  }

  // ---- Building the tree ----------------------------------------------------

  function buildTree(tokens, initialFen) {
    var tree = T.create(initialFen);
    if (tree == null) return null;
    var game = { tree: tree, result: '*', errors: [], moveCount: 0, preComment: '' };
    var state = { i: 0, nodes: 0, aborted: false };
    walk(tokens, tree, game, state, 0, null);
    return game;
  }

  function skipRav(tokens, state) {
    var depth = 1;
    while (state.i < tokens.length && depth > 0) {
      var t = tokens[state.i++];
      if (t.type === 'ravOpen') depth++;
      else if (t.type === 'ravClose') depth--;
    }
  }

  function walk(tokens, tree, game, state, depth, startNode) {
    var last = startNode;
    while (state.i < tokens.length) {
      if (state.aborted) return;
      var t = tokens[state.i];

      if (t.type === 'ravClose') { state.i++; return; }

      if (t.type === 'ravOpen') {
        state.i++;
        // A variation replaces the move just played, so it branches from that move's PARENT.
        if (last && last.parent && depth < MAX_RAV_DEPTH) {
          var save = tree.current;
          tree.current = last.parent;
          walk(tokens, tree, game, state, depth + 1, null);
          tree.current = save;
        } else {
          if (depth >= MAX_RAV_DEPTH) {
            game.errors.push({ ply: game.moveCount, token: '(', message: 'variation nesting too deep' });
          }
          skipRav(tokens, state);
        }
        continue;
      }

      if (t.type === 'move') {
        if (state.nodes >= MAX_NODES) {
          game.errors.push({ ply: game.moveCount, token: t.value, message: 'too many moves' });
          state.aborted = true;
          return;
        }
        var r = T.addSan(tree, t.san);
        if (!r) {
          game.errors.push({
            ply: game.moveCount + 1, token: t.value,
            message: 'illegal or unparseable move "' + t.value + '"'
          });
          state.aborted = true;
          return;
        }
        state.nodes++;
        if (depth === 0) game.moveCount++;
        if (t.nag && r.created) r.node.nag = t.nag;
        last = r.node;
        state.i++;
        continue;
      }

      if (t.type === 'nag') { if (last) last.nag = t.value; state.i++; continue; }

      if (t.type === 'comment') {
        if (last) last.comment = last.comment ? (last.comment + ' ' + t.value) : t.value;
        else game.preComment = game.preComment ? (game.preComment + ' ' + t.value) : t.value;
        state.i++;
        continue;
      }

      if (t.type === 'result') { game.result = t.value; state.i++; continue; }

      if (t.type === 'bad') {
        game.errors.push({
          ply: game.moveCount + 1, token: t.value, message: 'null moves are not supported'
        });
        state.aborted = true;
        return;
      }

      state.i++; // numbers and anything else carry no structure
    }
  }

  // ---- Public parse ---------------------------------------------------------

  /**
   * Parse a PGN file. Returns { games: [Game] }, where
   * Game = { headers, tree, result, errors, moveCount, preComment, initialFen }.
   * `errors` non-empty means the tree is a partial import, not a failure.
   */
  function parse(text) {
    var raw = splitGames(text);
    var games = [];
    for (var g = 0; g < raw.length; g++) {
      var headers = {};
      for (var k in raw[g].headers) {
        if (Object.prototype.hasOwnProperty.call(raw[g].headers, k)) {
          headers[k] = unescapeTag(raw[g].headers[k]);
        }
      }
      // SetUp "1" is the flag, but plenty of exporters emit FEN alone — honour either.
      var initialFen = headers.FEN ? headers.FEN : E.START_FEN;
      var built = buildTree(tokenize(raw[g].movetext), initialFen);
      if (built == null) {
        built = buildTree(tokenize(raw[g].movetext), E.START_FEN);
        if (built == null) continue;
        built.errors.unshift({ ply: 0, token: headers.FEN, message: 'invalid FEN tag; used the start position' });
        initialFen = E.START_FEN;
      }
      built.headers = headers;
      built.initialFen = initialFen;
      if (headers.Result && built.result === '*') built.result = headers.Result;
      games.push(built);
    }
    return { games: games };
  }

  /** Convenience for the common case. Returns a Game or null. */
  function parseFirst(text) {
    var r = parse(text);
    return r.games.length ? r.games[0] : null;
  }

  // ---- Serialization --------------------------------------------------------

  function numberToken(node, need) {
    if (node.color === E.WHITE) return node.moveNumber + '.';
    return need ? node.moveNumber + '...' : '';
  }

  function cleanComment(c) { return String(c).replace(/[{}]/g, '').trim(); }

  function emitMove(node, tokens, need) {
    var nt = numberToken(node, need);
    if (nt) tokens.push(nt);
    tokens.push(node.san);
    if (node.nag) tokens.push('$' + node.nag);
    if (node.comment) tokens.push('{' + cleanComment(node.comment) + '}');
    return !!node.comment; // a comment forces the next black move to be re-numbered
  }

  function emitFrom(parent, tokens, need) {
    var p = parent, needNumber = need;
    while (p.children.length) {
      var kids = p.children, main = kids[0];
      needNumber = emitMove(main, tokens, needNumber);
      for (var i = 1; i < kids.length; i++) {
        tokens.push('(');
        var vneed = emitMove(kids[i], tokens, true);
        emitFrom(kids[i], tokens, vneed);
        tokens.push(')');
        needNumber = true;
      }
      p = main;
    }
  }

  function wrap(tokens, width) {
    var lines = [], line = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (line === '') { line = t; continue; }
      // Parentheses hug: '(' joins what follows it and ')' joins what precedes it, so a variation
      // reads "(1... c5 2. Nf3)" and not "( 1... c5 2. Nf3 )". A hug may overrun `width` by a
      // character or two, which every PGN reader tolerates.
      if (t === ')' || line.charAt(line.length - 1) === '(') { line += t; continue; }
      if (line.length + 1 + t.length > width) { lines.push(line); line = t; }
      else line += ' ' + t;
    }
    if (line !== '') lines.push(line);
    return lines.join('\n');
  }

  /**
   * Serialize a game to canonical PGN. `game` needs { tree, headers, result, initialFen }.
   * The Seven Tag Roster is always emitted, in order, with the standard placeholders.
   */
  function serialize(game) {
    var headers = game.headers || {};
    var tree = game.tree;
    var result = game.result || headers.Result || '*';
    var out = [];

    var i, tag;
    for (i = 0; i < SEVEN_TAG_ROSTER.length; i++) {
      tag = SEVEN_TAG_ROSTER[i];
      var v = tag === 'Result' ? result : (headers[tag] != null && headers[tag] !== '' ? headers[tag] : TAG_DEFAULTS[tag]);
      out.push('[' + tag + ' "' + escapeTag(v) + '"]');
    }
    var startFen = (game.initialFen || (tree && tree.initialFen)) || E.START_FEN;
    var custom = startFen !== E.START_FEN;
    for (i = 0; i < EXTRA_TAGS.length; i++) {
      tag = EXTRA_TAGS[i];
      if (tag === 'SetUp' || tag === 'FEN') continue; // handled below so they always pair up
      if (headers[tag] != null && headers[tag] !== '') {
        out.push('[' + tag + ' "' + escapeTag(headers[tag]) + '"]');
      }
    }
    if (custom) {
      out.push('[SetUp "1"]');
      out.push('[FEN "' + escapeTag(startFen) + '"]');
    }
    out.push('');

    var tokens = [];
    if (game.preComment) tokens.push('{' + cleanComment(game.preComment) + '}');
    if (tree) emitFrom(tree.root, tokens, true);
    tokens.push(result);
    out.push(wrap(tokens, 80));
    return out.join('\n') + '\n';
  }

  // ---- Self-test ------------------------------------------------------------
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function sans(game) { return T.mainlineSans(game.tree).join(' '); }

    // 1. tokenizer — the strip pipeline the PHP oracle pins
    expect(mainlineTokens('1. e4 e5 2. Nf3 1-0').join(' ') === 'e4 e5 Nf3', 'plain movetext');
    expect(mainlineTokens('1. e4 {a comment} e5 *').join(' ') === 'e4 e5', 'block comments are dropped');
    expect(mainlineTokens('1. e4 ; trailing\n e5 *').join(' ') === 'e4 e5', 'line comments are dropped');
    expect(mainlineTokens('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *').join(' ') === 'e4 e5 Nf3',
      'variation contents are excluded from the main line');
    expect(mainlineTokens('1. e4 e5 (1... c5 (1... e6) 2. Nf3) 2. Nf3 *').join(' ') === 'e4 e5 Nf3',
      'nested variations are excluded');
    expect(mainlineTokens('1. e4 $1 e5 $2 *').join(' ') === 'e4 e5', 'NAGs are separate tokens');
    expect(mainlineTokens('1.e4 e5 2.Nf3 *').join(' ') === 'e4 e5 Nf3', 'numbers without spaces');
    expect(mainlineTokens('1. e4 e5 1/2-1/2').join(' ') === 'e4 e5', 'a draw result is not a move');
    expect(mainlineTokens('1. e4! e5?? 2. Nf3 *').join(' ') === 'e4! e5?? Nf3', 'suffixes stay on the token');
    expect(mainlineTokens('%evaluation 0.3\n1. e4 e5 *').join(' ') === 'e4 e5', '% escape lines are ignored');
    expect(mainlineTokens('1. e4 {a (tricky) comment} e5 *').join(' ') === 'e4 e5',
      'parens inside a comment do not open a variation');

    // 2. splitGames — oracle-faithful
    var two = splitGames('[Event "A"]\n\n1. e4 e5 1-0\n\n[Event "B"]\n\n1. d4 d5 0-1\n');
    expect(two.length === 2, 'two games split apart');
    expect(two[0].headers.Event === 'A' && two[1].headers.Event === 'B', 'headers land on the right game');
    expect(splitGames('1. e4 e5 *\n').length === 1, 'a headerless game still parses');
    expect(splitGames('[Event "CRLF"]\r\n\r\n1. e4 *\r\n').length === 1, 'CRLF is normalised');

    // 3. parsing into a tree
    var g = parseFirst('[Event "T"]\n[White "Juan"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n');
    expect(g !== null, 'parseFirst returns a game');
    expect(g.headers.Event === 'T' && g.headers.White === 'Juan', 'tags are read');
    expect(sans(g) === 'e4 e5 Nf3 Nc6 Bb5 a6', 'the main line is built');
    expect(g.result === '1-0', 'the result token is captured');
    expect(g.errors.length === 0, 'a clean game reports no errors');
    expect(g.moveCount === 6, 'moveCount counts main-line plies');

    // 4. variations become real branches
    var v = parseFirst('1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *');
    expect(sans(v) === 'e4 e5 Nf3 Nc6', 'the main line survives a variation');
    var e4node = v.tree.root.children[0];
    expect(e4node.children.length === 2, 'the branch point has two children');
    expect(e4node.children[0].san === 'e5' && e4node.children[1].san === 'c5', 'main line stays first');
    expect(e4node.children[1].children[0].san === 'Nf3', 'the variation continues');
    var nested = parseFirst('1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6) d6) 2. Nf3 *');
    var c5 = nested.tree.root.children[0].children[1];
    expect(c5 && c5.san === 'c5', 'the outer variation exists');
    // (2. Nc3 Nc6) is an alternative to Nf3, so it branches from c5 — not from Nf3.
    expect(c5.children.length === 2, 'the inner variation branches from the right node');
    expect(c5.children[0].san === 'Nf3' && c5.children[1].san === 'Nc3', 'and keeps main-line order');
    expect(c5.children[0].children[0].san === 'd6', 'the outer variation resumes after the inner one');

    // 5. annotations
    var a = parseFirst('1. e4! {best by test} e5 $2 *');
    var first = a.tree.root.children[0];
    expect(first.nag === 1, 'a ! suffix becomes NAG 1');
    expect(first.comment === 'best by test', 'a comment attaches to its move');
    expect(first.children[0].nag === 2, 'an explicit $2 attaches to the move before it');

    // 6. errors keep the partial tree
    var bad = parseFirst('1. e4 e5 2. Nf3 Qz9 4. Bb5 *');
    expect(bad.errors.length === 1, 'one error is reported');
    expect(bad.errors[0].ply === 4, 'the error names the failing ply');
    expect(sans(bad) === 'e4 e5 Nf3', 'the moves before the error are kept');
    var nullmove = parseFirst('1. e4 -- 2. Nf3 *');
    expect(nullmove.errors.length === 1 && /null moves/.test(nullmove.errors[0].message),
      'null moves are rejected with a clear message');

    // 7. SetUp / FEN.  1. O-O O-O would be illegal here: White's rook lands on f1 and covers f8,
    // so Black may not castle through it. Queenside first keeps the f-file clear.
    var fenGame = parseFirst('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O-O O-O *');
    expect(fenGame !== null && sans(fenGame) === 'O-O-O O-O', 'a game from a custom FEN parses');
    expect(fenGame.errors.length === 0, 'and reports no errors');
    expect(fenGame.initialFen.indexOf('r3k2r') === 0, 'the initial FEN is retained');
    var illegalCastle = parseFirst('[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O O-O *');
    expect(illegalCastle.errors.length === 1 && sans(illegalCastle) === 'O-O',
      'castling through a rook-covered square is rejected, keeping the partial line');

    // 8. serialize -> parse -> serialize is a fixpoint
    var samples = [
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
      '1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *',
      '1. e4 e5 (1... c5 (1... e6 2. d4) 2. Nf3) 2. Nf3 1/2-1/2',
      '1. e4! e5?! {sharp} 2. Nf3 $10 *',
      '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 0-1',
      '1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Bd7 5. bxa8=Q *'
    ];
    for (var s = 0; s < samples.length; s++) {
      var g1 = parseFirst(samples[s]);
      if (!g1) { expect(false, 'sample ' + s + ' failed to parse'); continue; }
      var text1 = serialize(g1);
      var g2 = parseFirst(text1);
      var text2 = g2 ? serialize(g2) : '';
      expect(text1 === text2, 'serialize is a fixpoint for sample ' + s);
      expect(g2 !== null && sans(g1) === sans(g2), 'the main line survives the round trip, sample ' + s);
    }

    // 9. serialization shape
    var out = serialize(parseFirst('[White "Juan"]\n[Black "Maria"]\n\n1. e4 e5 1-0'));
    expect(out.indexOf('[Event "?"]') === 0, 'the roster leads with Event');
    expect(out.indexOf('[Date "????.??.??"]') > 0, 'a missing date gets the placeholder');
    expect(out.indexOf('[White "Juan"]') > 0, 'supplied tags are kept');
    expect(out.indexOf('[Result "1-0"]') > 0, 'the result is written into the roster');
    expect(/\n\n/.test(out), 'a blank line separates the roster from the movetext');
    expect(/1\. e4 e5 1-0\n$/.test(out), 'the movetext ends with the result');
    expect(out.indexOf('[FEN') === -1, 'no FEN tag for a standard start');
    var custom = serialize(parseFirst('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O *'));
    expect(custom.indexOf('[SetUp "1"]') > 0 && custom.indexOf('[FEN "r3k2r') > 0,
      'a custom start emits SetUp and FEN together');
    var longGame = parseFirst('1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 '
      + '8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6 *');
    var wrapped = serialize(longGame).split('\n');
    var over = wrapped.filter(function (l) { return l.length > 80; });
    expect(over.length === 0, 'no movetext line exceeds 80 columns');

    // 10. tag escaping survives the round trip
    var esc = parseFirst('[Event "The \\"Big\\" One"]\n\n1. e4 *');
    expect(esc.headers.Event === 'The "Big" One', 'escaped quotes are unescaped on read');
    expect(serialize(esc).indexOf('[Event "The \\"Big\\" One"]') === 0, 'and re-escaped on write');

    // 11. multi-game
    var multi = parse('[Event "A"]\n\n1. e4 e5 1-0\n\n[Event "B"]\n\n1. d4 d5 0-1\n');
    expect(multi.games.length === 2, 'both games are returned');
    expect(sans(multi.games[0]) === 'e4 e5' && sans(multi.games[1]) === 'd4 d5', 'each has its own tree');
    expect(multi.games[0].result === '1-0' && multi.games[1].result === '0-1', 'each has its own result');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'PgnSelfTest: ' + passed + ' assertions passed'
        : 'PgnSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    splitGames: splitGames, tokenize: tokenize, mainlineTokens: mainlineTokens,
    parse: parse, parseFirst: parseFirst, serialize: serialize,
    SEVEN_TAG_ROSTER: SEVEN_TAG_ROSTER, NAG_SUFFIX: NAG_SUFFIX, RESULTS: RESULTS,
    MAX_RAV_DEPTH: MAX_RAV_DEPTH, MAX_NODES: MAX_NODES,
    selfTest: selfTest
  };
})();

/* Makes the parser runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPGN; }
