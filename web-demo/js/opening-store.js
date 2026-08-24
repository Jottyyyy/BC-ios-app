/* opening-store.js — saved Opening Trees, and where the explorer is standing.
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/OpeningTreeStore.swift`. Everything that DECIDES anything
 * is in `opening-tree.js`, which is pure and self-tested; this is the ten lines of persistence
 * around it, plus the navigation state — which lives here rather than in the screen for the same
 * reason `app.js` keeps `pairingOpenId` router-scoped: `render()` runs again on every repaint, so a
 * screen cannot hold anything itself.
 */
'use strict';

var BiyaOpeningStore = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var OT = isNode ? require('./opening-tree.js') : BiyaOpeningTree;
  var MET = isNode ? require('./opening-metrics.js') : BiyaOpeningMetrics;

  var KEY = 'biya.openings.v1';

  /** `12 games · 84 positions · White` — filled, never re-typed. */
  function metaLine(t) {
    return MET.fill(MET.STRINGS.meta, {
      games: t.gameCount, positions: t.positionCount,
      colour: t.colour.charAt(0).toUpperCase() + t.colour.slice(1)
    });
  }

  function read(storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return { trees: [] };
    try {
      var raw = s.getItem(KEY);
      if (!raw) return { trees: [] };
      var doc = JSON.parse(raw);
      // A corrupt document yields an EMPTY one rather than throwing. Losing a tree is bad; a
      // screen that will not open at all is worse — the same degradation the Swift file chooses.
      return (doc && Array.isArray(doc.trees)) ? doc : { trees: [] };
    } catch (e) { return { trees: [] }; }
  }

  function write(doc, storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    // `localStorage` throws on some file:// configurations and when the quota is hit — a 2,000-game
    // tree is megabytes. A failed save must not take the screen down with it.
    try { s.setItem(KEY, JSON.stringify(doc)); return true; } catch (e) { return false; }
  }

  function createStore(storage) {
    var doc = read(storage);
    var openID = null;
    var path = [];

    function open() {
      for (var i = 0; i < doc.trees.length; i++) if (doc.trees[i].id === openID) return doc.trees[i];
      return null;
    }
    function flush() { return write(doc, storage); }

    var api = {
      trees: function () { return doc.trees; },
      open: open,
      openID: function () { return openID; },
      path: function () { return path.slice(); },

      add: function (tree) {
        doc.trees.unshift(tree);
        flush();
        return tree;
      },
      remove: function (id) {
        doc.trees = doc.trees.filter(function (t) { return t.id !== id; });
        if (openID === id) { openID = null; path = []; }
        flush();
      },
      openTree: function (id) { openID = id; path = []; },
      closeTree: function () { openID = null; path = []; },

      /* ---- navigation, mirroring the Swift store -------------------------- */
      candidates: function () {
        var t = open();
        return t ? OT.sortedMoves(t.tree, path) : [];
      },
      /* ---- off book ------------------------------------------------------- *
       * The explorer used to show one empty card for two different things: a line whose games
       * simply stop here, and a move no game in the tree ever played. Forward was dead either way
       * and nothing said which had happened. These four make the difference expressible. */
      bookDepth: function () {
        var t = open();
        return t ? OT.bookDepth(t.tree, path) : 0;
      },
      isOffBook: function () { return api.bookDepth() < path.length; },
      freePlies: function () { return path.length - api.bookDepth(); },
      atFreeLimit: function () { return api.freePlies() >= OT.MAX_FREE_PLIES; },

      /**
       * The ONE place a move enters the path, whichever route offered it — a clicked candidate
       * row, a clicked square or a dragged piece. The cap can only bite OFF book: on book the only
       * moves offered are the tree's own, and the tree is itself bounded by DEFAULT_MAX_PLIES.
       */
      play: function (san) {
        if (api.freePlies() >= OT.MAX_FREE_PLIES) return false;
        path.push(san);
        return true;
      },
      stepBack: function () { if (path.length) path.pop(); },
      reset: function () { path = []; },

      /**
       * Drop every off-book ply in ONE step. Leaving the book is one decision, so returning from it
       * is one too — N clicks of Back is the same journey spelled as a chore. Truncates to
       * `bookDepth` rather than counting its own way back, so there is one definition of where the
       * book ended.
       */
      backToTree: function () {
        if (api.isOffBook()) path = path.slice(0, api.bookDepth());
      },
      /** Forward plays the MOST-PLAYED continuation, matching the RN `handleForward`. */
      stepForward: function () {
        var t = open();
        if (!t) return;
        var next = OT.mostPlayed(t.tree, path);
        if (next) path.push(next);
      },
      canStepBack: function () { return path.length > 0; },
      canStepForward: function () {
        var t = open();
        return !!t && OT.mostPlayed(t.tree, path) !== null;
      },

      /** The FEN the path reaches, replayed from the start — never cached beside the path. */
      fen: function () {
        var E = isNode ? require('./engine.js') : Engine;
        var pos = E.start();
        for (var i = 0; i < path.length; i++) {
          var m = E.parseSan(pos, path[i]);
          if (!m) break;
          pos = E.makeMove(pos, m);
        }
        return E.toFEN(pos);
      },

      /**
       * The move that reached the current position, as square INDEXES — the shape
       * `setPosition(fen, { lastMove })` and `highlightLastMove` both want.
       *
       * Twin of `OpeningTreeStore.lastMove`, and NEW: the browser has never drawn this highlight at
       * all, because the explorer set the `fen` ATTRIBUTE, which carries no last move. The two
       * languages have quietly disagreed about a thing on screen and no gate could see it.
       *
       * Note the deliberate asymmetry with `fen()` above, mirrored from the Swift: `fen()` uses
       * `break` (draw the position you got to) where this returns null (highlight nothing rather
       * than the wrong two squares). Do not tidy them into agreeing.
       */
      lastMove: function () {
        if (!path.length) return null;
        var E = isNode ? require('./engine.js') : Engine;
        var pos = E.start();
        for (var i = 0; i < path.length - 1; i++) {
          var prev = E.parseSan(pos, path[i]);
          if (!prev) return null;
          pos = E.makeMove(pos, prev);
        }
        var m = E.parseSan(pos, path[path.length - 1]);
        return m ? { from: m.from, to: m.to } : null;
      },

      /** `1. e4 c5 2. Nf3`, or the empty-path label. */
      historyText: function () {
        if (!path.length) return MET.STRINGS.startPosition;
        var out = [];
        for (var i = 0; i < path.length; i++) {
          if (i % 2 === 0) out.push((i / 2 + 1) + '.');
          out.push(path[i]);
        }
        return out.join(' ');
      },

      clear: function () { doc = { trees: [] }; openID = null; path = []; flush(); }
    };
    return api;
  }

  var singleton = null;
  function shared() {
    if (!singleton) singleton = createStore(null);
    return singleton;
  }

  /**
   * Build a saved tree from games. Kept here rather than in the form so the Swift's
   * `SavedOpeningTree.init` and this have one shape to agree on, and so `nowMs` is injectable.
   */
  function build(opts) {
    var tree = OT.create();
    OT.addGames(tree, opts.games, opts.maxPlies);
    return {
      id: opts.id || ('t' + opts.nowMs + '-' + Math.floor(opts.nowMs % 100000)),
      name: opts.name,
      colour: opts.colour,
      source: opts.source,
      username: opts.username || '',
      gameCount: tree.gameCount,
      positionCount: OT.nodeCount(tree),
      createdAtMs: opts.nowMs,
      tree: tree
    };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    // An in-memory storage double, the same shape login.js and coach-store.js use.
    function fake() {
      var map = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
        setItem: function (k, v) { map[k] = String(v); },
        removeItem: function (k) { delete map[k]; },
        _map: map
      };
    }

    var st = fake();
    var s = createStore(st);
    expect(s.trees().length === 0, 'a fresh store is empty');
    expect(s.open() === null, 'and has nothing open');

    var games = OT.gamesFromPGN(
      '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 1-0\n\n'
      + '[White "A"]\n[Black "C"]\n[Result "0-1"]\n\n1. e4 e5 0-1\n', { userName: 'A' });
    var saved = build({ games: games, name: 'Mine', colour: 'white', source: 'pgn', nowMs: 1000 });
    s.add(saved);
    expect(s.trees().length === 1, 'a built tree is saved');
    expect(saved.gameCount === 2 && saved.positionCount === 4,
      'and carries its counts: 2 games, e4 + c5 + Nf3 + e5');
    expect(metaLine(saved) === '2 games · 4 positions · White', 'the meta line reads right');

    // It survives a reload from the SAME storage, which is what persistence means.
    var reopened = createStore(st);
    expect(reopened.trees().length === 1, 'a reloaded store sees it');
    expect(reopened.trees()[0].name === 'Mine', 'by name');

    // Navigation.
    s.openTree(saved.id);
    expect(s.open() !== null, 'the tree opens');
    expect(s.candidates().length === 1 && s.candidates()[0].san === 'e4',
      'both games start 1.e4, so there is one candidate');
    expect(s.canStepBack() === false, 'nothing to step back to at the root');
    expect(s.canStepForward() === true, 'but forward has a most-played move');
    s.stepForward();
    expect(s.path().join(' ') === 'e4', 'forward played it');
    expect(s.historyText() === '1. e4', 'and the history strip numbers it');
    expect(s.candidates().length === 2, 'two replies from there');
    expect(s.candidates()[0].count === 1 && s.candidates()[1].count === 1, 'one game each');
    expect(s.candidates()[0].san === 'c5' && s.candidates()[1].san === 'e5',
      'and the tie breaks by SAN ascending');
    s.play('c5');
    expect(s.historyText() === '1. e4 c5', 'black moves do not get a number');
    s.play('Nf3');
    expect(s.historyText() === '1. e4 c5 2. Nf3', 'the next white move does');
    expect(s.canStepForward() === false, 'and the line ends there');
    s.stepBack();
    expect(s.path().length === 2, 'back removes one ply');
    s.reset();
    expect(s.path().length === 0 && s.historyText() === MET.STRINGS.startPosition,
      'reset returns to the start position');

    // The FEN follows the path rather than being remembered beside it.
    expect(s.fen().indexOf('rnbqkbnr/pppppppp') === 0, 'the empty path is the start position');
    s.play('e4');
    expect(s.fen().indexOf(' b ') > 0, 'and one ply in it is black to move');

    // Deleting the open tree closes it rather than leaving a dangling id.
    s.remove(saved.id);
    expect(s.trees().length === 0 && s.open() === null && s.path().length === 0,
      'removing the open tree closes and clears it');

    // A storage that throws must not take the screen down.
    var hostile = { getItem: function () { throw new Error('nope'); },
                    setItem: function () { throw new Error('nope'); } };
    var h = createStore(hostile);
    expect(h.trees().length === 0, 'a throwing storage reads as empty');
    h.add(saved);
    expect(h.trees().length === 1, 'and an add still works in memory');

    // A corrupt document degrades to empty rather than throwing.
    var bad = fake();
    bad.setItem(KEY, '{not json');
    expect(createStore(bad).trees().length === 0, 'unparseable JSON reads as empty');
    bad.setItem(KEY, '{"trees":"nope"}');
    expect(createStore(bad).trees().length === 0, 'and so does a wrong-shaped document');

    // ---- off book: leaving the tree, and getting back ------------------------
    var off = createStore(fake());
    var offTree = build({
      games: [{ sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true, outcome: OT.OUTCOMES.whiteWin }],
      name: 'Sicilian', colour: 'both', source: 'pgn', username: '', nowMs: 1
    });
    off.add(offTree);
    off.openTree(offTree.id);
    expect(!off.isOffBook() && off.bookDepth() === 0 && off.freePlies() === 0,
      'the root of a tree is on book');
    off.play('e4');
    expect(!off.isOffBook() && off.candidates().length === 1,
      'and a move the tree holds keeps it on book, with the continuations still there');
    expect(off.play('e5') === true, 'a legal move the tree has never seen is accepted');
    expect(off.isOffBook(), 'and it is off book');
    expect(off.bookDepth() === 1 && off.freePlies() === 1,
      'the book ended at ply one and one ply hangs off it');
    expect(off.candidates().length === 0 && !off.canStepForward(),
      'off book there are no candidates and Forward is dead');
    expect(off.canStepBack(), 'but Back still works — it is the way back in');
    off.backToTree();
    expect(!off.isOffBook() && off.path().join(' ') === 'e4',
      'backToTree drops every off-book ply in one step, landing on the last book position');
    expect(off.candidates().length === 1, 'and the tree`s continuations are back');
    off.backToTree();
    expect(off.path().join(' ') === 'e4', 'calling it again on book changes nothing');

    // The cap. It exists because `fen()` and `lastMove()` replay the whole path on every repaint.
    var capped = 0;
    off.play('e5');
    while (off.play(capped % 2 === 0 ? 'Nf3' : 'Nc6')) capped++;
    expect(off.freePlies() === OT.MAX_FREE_PLIES,
      'free play stops at exactly MAX_FREE_PLIES, got ' + off.freePlies());
    expect(off.atFreeLimit() && off.play('a3') === false,
      'and the next move is REFUSED rather than silently swallowed');
    off.backToTree();
    expect(!off.isOffBook() && off.path().join(' ') === 'e4',
      'and backToTree still escapes from the cap');

    // The highlight the browser has never drawn. Indexes, not algebraic — the component wants
    // indexes and an algebraic square highlights nothing at all.
    var lm = createStore(fake());
    lm.add(offTree); lm.openTree(offTree.id);
    expect(lm.lastMove() === null, 'the start position has no last move');
    lm.play('e4');
    var mv = lm.lastMove();
    expect(mv !== null && typeof mv.from === 'number' && typeof mv.to === 'number',
      'and after a move it is a pair of square INDEXES');
    expect(mv.from === 12 && mv.to === 28, 'e2 to e4, got ' + mv.from + '->' + mv.to);

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'OpeningStore: ' + passed + ' assertions passed'
        : 'OpeningStore: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  return {
    KEY: KEY,
    create: createStore,
    shared: shared,
    build: build,
    metaLine: metaLine,
    selfTest: selfTest
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaOpeningStore; }
