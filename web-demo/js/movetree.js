/* movetree.js — the analysis move tree, with variations
 *
 * The browser mirror of Sources/BiyaherongCoachCore/MoveTree.swift (Phase 3). Every position the
 * user reaches is a node; `children[0]` IS the main line at that point, and every other child is a
 * variation. This is the single data structure the whole Analysis Board is a view over.
 *
 * The pure payoff is `flatten()`: it turns the tree into a flat array of plain value rows, which is
 * what the views actually render. Keeping the traversal, the move numbering and the
 * variation nesting inside one pure function is what lets the self-test assert tree semantics
 * without a renderer — and what lets Swift and JS be checked against each other row for row.
 *
 *     node -e "console.log(require('./web-demo/js/movetree.js').selfTest().summary)"
 *
 * Nodes carry a `parent` back-reference, so the graph is cyclic: never JSON.stringify a node.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaMoveTree = (function () {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : Engine;

  // ---- Construction ---------------------------------------------------------
  // Tree: { root, current, initialFen, nextId }
  // Node: { id, parent, children, move, san, uci, moveNumber, color, ply, fenAfter, key,
  //         nag, comment }
  // The root is the starting position: no move, ply 0, and `fenAfter` is the initial FEN.

  function create(initialFen) {
    var fen = initialFen || E.START_FEN;
    var pos = E.fromFEN(fen);
    if (pos == null) return null;
    var root = {
      id: 0, parent: null, children: [], move: null, san: '', uci: '',
      moveNumber: pos.fullmove, color: pos.sideToMove, ply: 0,
      fenAfter: E.toFEN(pos), key: E.positionKey(pos), nag: 0, comment: ''
    };
    return { root: root, current: root, initialFen: E.toFEN(pos), nextId: 1 };
  }

  /** The parsed position AFTER `node`'s move. */
  function position(node) { return E.fromFEN(node.fenAfter); }

  // ---- Adding moves ---------------------------------------------------------

  /**
   * Play `mv` from the current node. Replaying a move that already exists NAVIGATES into it rather
   * than duplicating the node — the rule the board relies on so repeating a line never forks it.
   * Returns { node, created } or null if the move is not legal here.
   */
  function addMove(tree, mv) {
    var cur = tree.current, i;
    for (i = 0; i < cur.children.length; i++) {
      if (E.moveEquals(cur.children[i].move, mv)) {
        tree.current = cur.children[i];
        return { node: cur.children[i], created: false };
      }
    }
    var pos = position(cur);
    if (pos == null) return null;
    var legal = E.legalMoves(pos), ok = false;
    for (i = 0; i < legal.length; i++) if (E.moveEquals(legal[i], mv)) { ok = true; break; }
    if (!ok) return null;

    var after = E.makeMove(pos, mv);
    var node = {
      id: tree.nextId++, parent: cur, children: [], move: mv,
      san: E.san(pos, mv), uci: E.moveUci(mv),
      moveNumber: pos.fullmove, color: pos.sideToMove, ply: cur.ply + 1,
      fenAfter: E.toFEN(after), key: E.positionKey(after), nag: 0, comment: ''
    };
    cur.children.push(node);
    tree.current = node;
    return { node: node, created: true };
  }

  /** Play a SAN move from the current node. Returns { node, created } or null. */
  function addSan(tree, sanStr) {
    var pos = position(tree.current);
    if (pos == null) return null;
    var mv = E.parseSan(pos, sanStr);
    return mv ? addMove(tree, mv) : null;
  }

  /** Play a UCI move from the current node. Returns { node, created } or null. */
  function addUci(tree, uci) {
    var pos = position(tree.current);
    if (pos == null) return null;
    var mv = E.parseUci(pos, uci);
    return mv ? addMove(tree, mv) : null;
  }

  // ---- Navigation -----------------------------------------------------------

  function goTo(tree, node) { tree.current = node; return node; }
  function goToStart(tree) { tree.current = tree.root; return tree.root; }
  function goBack(tree) {
    if (tree.current.parent) tree.current = tree.current.parent;
    return tree.current;
  }

  /** The continuations available from the current node — >1 means the UI must ask. */
  function forwardOptions(tree) { return tree.current.children.slice(); }

  function goForward(tree, index) {
    var kids = tree.current.children;
    if (!kids.length) return tree.current;
    tree.current = kids[index == null ? 0 : index] || kids[0];
    return tree.current;
  }

  /** Follow children[0] to the end of the line the current node sits on. */
  function goToEnd(tree) {
    while (tree.current.children.length) tree.current = tree.current.children[0];
    return tree.current;
  }

  // ---- Paths ----------------------------------------------------------------

  /** Child indices from the root down to `node` — the cursor format drafts persist. */
  function pathTo(node) {
    var path = [], n = node;
    while (n && n.parent) {
      path.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    return path;
  }

  /** Resolve a child-index path. Returns null if it does not exist. */
  function nodeAtPath(tree, path) {
    var n = tree.root;
    for (var i = 0; i < (path || []).length; i++) {
      n = n.children[path[i]];
      if (!n) return null;
    }
    return n;
  }

  /** Root -> node inclusive. */
  function lineTo(node) {
    var out = [], n = node;
    while (n) { out.unshift(n); n = n.parent; }
    return out;
  }

  /** Every position key from the root to `node` inclusive — feed this to E.drawReason. */
  function historyKeys(node) {
    return lineTo(node).map(function (n) { return n.key; });
  }

  /** The main line from the root: follow children[0] to the end. */
  function mainline(tree) {
    var out = [], n = tree.root;
    while (n.children.length) { n = n.children[0]; out.push(n); }
    return out;
  }

  function mainlineSans(tree) {
    return mainline(tree).map(function (n) { return n.san; });
  }

  // ---- Editing --------------------------------------------------------------

  /** Make `node` its parent's main line by swapping it with children[0]. */
  function promote(tree, node) {
    var p = node.parent;
    if (!p) return false;
    var i = p.children.indexOf(node);
    if (i <= 0) return false;
    p.children[i] = p.children[0];
    p.children[0] = node;
    return true;
  }

  /** Promote `node` and every ancestor, so the whole line becomes the main line. */
  function promoteFully(tree, node) {
    var changed = false, n = node;
    while (n && n.parent) { if (promote(tree, n)) changed = true; n = n.parent; }
    return changed;
  }

  function isDescendant(node, maybeAncestor) {
    var n = node;
    while (n) { if (n === maybeAncestor) return true; n = n.parent; }
    return false;
  }

  function countSubtree(node) {
    var n = 1;
    for (var i = 0; i < node.children.length; i++) n += countSubtree(node.children[i]);
    return n;
  }

  /**
   * Delete `node` and everything below it. If the cursor was inside the deleted subtree it moves to
   * the parent, so `current` is never left dangling.
   */
  function remove(tree, node) {
    var p = node.parent;
    if (!p) return 0;
    var i = p.children.indexOf(node);
    if (i < 0) return 0;
    var n = countSubtree(node);
    p.children.splice(i, 1);
    if (isDescendant(tree.current, node)) tree.current = p;
    return n;
  }

  /** Truncate: drop every continuation after `node`. */
  function removeAfter(tree, node) {
    var n = 0;
    while (node.children.length) n += remove(tree, node.children[0]);
    return n;
  }

  // ---- Flatten (the pure render model) --------------------------------------
  // A pre-order walk in PGN reading order: each move, then any alternatives to the move that
  // FOLLOWS it as nested lines, then the main line continues. Rows are plain values — no node
  // references — so the views can diff them and both languages can be compared row for row.

  function rowFor(node, depth) {
    return {
      id: node.id, parentId: node.parent ? node.parent.id : null, depth: depth,
      ply: node.ply, moveNumber: node.moveNumber, color: node.color,
      numberText: '', san: node.san, uci: node.uci,
      nag: node.nag, comment: node.comment,
      fenAfter: node.fenAfter, key: node.key,
      isMainline: depth === 0, isCurrent: false, isOnPath: false
    };
  }

  function emitFrom(parent, depth, rows) {
    var p = parent;
    while (p.children.length) {
      var kids = p.children, main = kids[0];
      rows.push(rowFor(main, depth));
      for (var i = 1; i < kids.length; i++) {
        rows.push(rowFor(kids[i], depth + 1));
        emitFrom(kids[i], depth + 1, rows);
      }
      p = main;
    }
  }

  function flatten(tree) {
    var rows = [];
    emitFrom(tree.root, 0, rows);

    // A white move always shows "12."; a black move shows "12..." only when it does not directly
    // follow its own parent — i.e. at the start of a line or after an interposed variation.
    // This is exactly PGN's rule, and it is why numbering is computed here and not in a view.
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.color === E.WHITE) r.numberText = r.moveNumber + '.';
      else r.numberText = (i === 0 || rows[i - 1].id !== r.parentId) ? r.moveNumber + '...' : '';
    }

    var onPath = {};
    var n = tree.current;
    while (n) { onPath[n.id] = true; n = n.parent; }
    for (var j = 0; j < rows.length; j++) {
      rows[j].isCurrent = rows[j].id === tree.current.id;
      rows[j].isOnPath = onPath[rows[j].id] === true;
    }
    return rows;
  }

  // ---- Self-test ------------------------------------------------------------
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function play(tree, sans) {
      for (var i = 0; i < sans.length; i++) if (!addSan(tree, sans[i])) return false;
      return true;
    }

    // 1. an empty tree
    var t = create();
    expect(t !== null, 'create() succeeds');
    expect(t.root.children.length === 0, 'a new tree has no moves');
    expect(t.current === t.root, 'the cursor starts at the root');
    expect(t.root.ply === 0, 'the root is ply 0');
    expect(t.root.fenAfter === E.START_FEN, 'the root holds the start position');
    expect(create('not a fen') === null, 'create() rejects a bad FEN');

    // 2. adding moves
    var r = addSan(t, 'e4');
    expect(r !== null && r.created === true, 'addSan creates a node');
    expect(r.node.san === 'e4' && r.node.uci === 'e2e4', 'the node carries san and uci');
    expect(r.node.ply === 1 && r.node.moveNumber === 1 && r.node.color === E.WHITE, 'ply/number/colour');
    expect(t.current === r.node, 'the cursor follows the new move');
    expect(addSan(t, 'zz9') === null, 'addSan rejects unparseable input');
    expect(addUci(t, 'e7e5') !== null, 'addUci plays a legal move');
    expect(addUci(t, 'e7e5') === null, 'addUci rejects an illegal move');

    // 3. replaying an existing move navigates instead of duplicating
    goToStart(t);
    var again = addSan(t, 'e4');
    expect(again.created === false, 'replaying an existing move does not create a node');
    expect(t.root.children.length === 1, 'the root still has exactly one child');
    expect(t.current === again.node, 'the cursor moved into the existing node');

    // 4. branching
    goToStart(t);
    var d4 = addSan(t, 'd4');
    expect(d4.created === true && t.root.children.length === 2, 'a different move branches');
    expect(t.root.children[0].san === 'e4', 'the first move played stays the main line');
    expect(promote(t, d4.node) === true, 'promote swaps with children[0]');
    expect(t.root.children[0].san === 'd4', 'the promoted move is now the main line');
    expect(promote(t, t.root.children[0]) === false, 'promoting the main line is a no-op');
    expect(promote(t, t.root) === false, 'promoting the root is a no-op');

    // 5. paths
    var t2 = create();
    play(t2, ['e4', 'e5', 'Nf3', 'Nc6']);
    var deep = t2.current;
    expect(pathTo(deep).join(',') === '0,0,0,0', 'pathTo yields child indices');
    expect(nodeAtPath(t2, [0, 0, 0, 0]) === deep, 'nodeAtPath round-trips');
    expect(nodeAtPath(t2, [0, 0, 9]) === null, 'nodeAtPath returns null for a bad path');
    expect(pathTo(t2.root).length === 0, 'the root has an empty path');
    expect(mainlineSans(t2).join(' ') === 'e4 e5 Nf3 Nc6', 'mainlineSans follows children[0]');
    expect(lineTo(deep).length === 5, 'lineTo includes the root');
    expect(historyKeys(deep).length === 5, 'historyKeys includes the root');
    expect(historyKeys(deep)[0] === E.positionKey(E.start()), 'the first history key is the start');

    // 6. navigation
    goToStart(t2);
    expect(t2.current === t2.root, 'goToStart');
    goForward(t2);
    expect(t2.current.san === 'e4', 'goForward follows the main line');
    goBack(t2);
    expect(t2.current === t2.root, 'goBack');
    goBack(t2);
    expect(t2.current === t2.root, 'goBack at the root is a no-op');
    goToEnd(t2);
    expect(t2.current.san === 'Nc6', 'goToEnd reaches the leaf');
    goToStart(t2);
    expect(forwardOptions(t2).length === 1, 'forwardOptions reports one continuation');

    // 7. deleting
    var t3 = create();
    play(t3, ['e4', 'e5', 'Nf3']);
    goToStart(t3);
    play(t3, ['d4', 'd5']);
    var alt = nodeAtPath(t3, [1]);
    expect(alt !== null && alt.san === 'd4', 'the variation is the second child');
    goToEnd(t3);
    var removed = remove(t3, alt);
    expect(removed === 2, 'remove reports the subtree size');
    expect(t3.root.children.length === 1, 'the variation is gone');
    expect(t3.current === t3.root, 'the cursor escaped the deleted subtree');
    expect(remove(t3, t3.root) === 0, 'removing the root is a no-op');
    goToEnd(t3);
    expect(removeAfter(t3, t3.root.children[0]) === 2, 'removeAfter truncates the continuation');
    expect(mainlineSans(t3).join(' ') === 'e4', 'only the first move survives');

    // 8. flatten — the pure render model
    var t4 = create();
    play(t4, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    goToStart(t4);
    goForward(t4);                       // sit on 1. e4
    play(t4, ['c5', 'Nf3', 'd6']);       // 1... c5 as a variation on 1... e5
    var rows = flatten(t4);
    expect(rows.length === 8, 'flatten emits every node once (got ' + rows.length + ')');
    expect(rows[0].san === 'e4' && rows[0].depth === 0, 'row 0 is the first main-line move');
    expect(rows[1].san === 'e5' && rows[1].depth === 0, 'the main line continues at depth 0');
    expect(rows[2].san === 'c5' && rows[2].depth === 1, 'the variation is nested one level');
    expect(rows[5].san === 'Nf3' && rows[5].depth === 0, 'the main line resumes after the variation');
    expect(rows[0].numberText === '1.', 'a white move is numbered');
    expect(rows[1].numberText === '', 'a black move following its parent is not numbered');
    expect(rows[2].numberText === '1...', 'a black move starting a variation gets the ellipsis');
    expect(rows[5].numberText === '2.', 'numbering survives the variation');
    expect(rows[0].isMainline === true && rows[2].isMainline === false, 'isMainline tracks depth');
    var current = rows.filter(function (x) { return x.isCurrent; });
    expect(current.length === 1 && current[0].san === 'd6', 'exactly one row is current');
    var path = rows.filter(function (x) { return x.isOnPath; });
    expect(path.length === 4, 'the path back to the root is marked (got ' + path.length + ')');
    expect(rows[2].parentId === rows[0].id, 'parentId links the variation to its branch point');
    expect(flatten(create()).length === 0, 'an empty tree flattens to nothing');

    // 9. a black-to-move initial FEN numbers correctly
    var t5 = create('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    play(t5, ['c5', 'Nf3']);
    var r5 = flatten(t5);
    expect(r5[0].numberText === '1...', 'a black first move from a custom FEN gets the ellipsis');
    expect(r5[1].numberText === '2.', 'the following white move increments');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'MoveTreeSelfTest: ' + passed + ' assertions passed'
        : 'MoveTreeSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    create: create, position: position,
    addMove: addMove, addSan: addSan, addUci: addUci,
    goTo: goTo, goToStart: goToStart, goBack: goBack, goForward: goForward, goToEnd: goToEnd,
    forwardOptions: forwardOptions,
    pathTo: pathTo, nodeAtPath: nodeAtPath, lineTo: lineTo, historyKeys: historyKeys,
    mainline: mainline, mainlineSans: mainlineSans,
    promote: promote, promoteFully: promoteFully, remove: remove, removeAfter: removeAfter,
    countSubtree: countSubtree, isDescendant: isDescendant,
    flatten: flatten,
    selfTest: selfTest
  };
})();

/* Makes the tree runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaMoveTree; }
