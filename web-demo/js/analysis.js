/* analysis.js — the Analysis Board screen
 *
 *     node -e "console.log(require('./web-demo/js/analysis.js').selfTest().summary)"
 *
 * Two halves, the same split home.js uses:
 *
 *   PURE LAYER  — the screen's behaviour as functions of state: what the status line says, which
 *                 opening we are in, which arrows to draw, what the engine rows read, whether the
 *                 current analysis is stale, and what the move strip's tokens are. No DOM. Mirrored
 *                 line-for-line by Sources/BiyaherongCoachCore/AnalysisSession.swift, which the
 *                 ParityRunner `analysis_session` group asserts.
 *   RENDERING   — the seven bands, the board wiring, and the engine loop.
 *
 * Ported from ../BYAHERONG-COACH-FRONTEND/app/(app)/user/analysis-board/board.tsx (6,865 lines).
 * The band order is that file's top-level JSX (:4565-4712), not the written spec — see
 * docs/analysis-board.md. Every number comes from BiyaAnalysisMetrics; none is written here.
 *
 * The original screen was network-bound (HTTP analysis, HTTP review, Lichess masters). All three
 * are gone: the engine is BiyaAnalysis, and the masters panel is the bundled ECO book.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysisBoard = (function () {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var E = isNode ? require('./engine.js') : Engine;
  var T = isNode ? require('./movetree.js') : BiyaMoveTree;
  var BOOK = isNode ? require('./opening-book.js') : BiyaOpeningBook;
  var AN = isNode ? require('./analysis-engine.js') : BiyaAnalysis;
  var MET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;
  var V = isNode ? require('./review.js') : BiyaReview;
  var ST = isNode ? require('./analysis-store.js') : BiyaAnalysisStore;
  // Setup Position. Only the view half uses it, but it is declared here with the rest so a missing
  // <script> tag fails loudly at load instead of silently inside a click handler.
  var PE = isNode ? require('./position-editor.js') : BiyaPositionEditor;
  // Where the search actually runs. `AN` is still used for its pure helpers; the host owns the
  // threading decision so no screen has to know about it.
  var HOST = isNode ? require('./engine-host.js') : BiyaEngineHost;
  // Saving serialises the tree to a full PGN — headers included, unlike the source's movetext-only
  // `generatePgn()`, which is why a custom start position survives a round trip here.
  var P = isNode ? require('./pgn.js') : BiyaPGN;
  // Sound is browser-only and belongs to the view half; the pure layer never touches it.
  var SND = isNode ? null : (typeof SoundManager !== 'undefined' ? SoundManager : null);

  /* ===================== pure layer (mirrors AnalysisSession.swift) ===================== */

  /**
   * The whole screen's state. `tree` is the move tree; everything else is a view input. Deliberately
   * a plain object: the Swift twin is a class, but nothing here needs identity.
   */
  function createSession(initialFen) {
    var tree = T.create(initialFen || E.START_FEN);
    if (!tree) return null;
    return {
      tree: tree,
      snapshot: null,        // the latest AnalysisSnapshot, or null when nothing has been searched
      analyzing: false,      // a search is in flight right now
      autoAnalyze: true,
      autoplaying: false,
      flipped: false,
      selected: null,
      // ---- review ----
      review: null,          // the Annotated result, or null when the game has not been reviewed
      reviewByNodeId: {},    // node id -> classification key
      reviewProgress: null   // { completed, total } while a review is running
    };
  }

  /**
   * Stamp a completed review onto the session.
   *
   * The index rule is the trap: `move_index` is **1-based** (0 is the starting position) while the
   * plan's nodes are 0-based, so the node for an evaluation is `nodes[move_index - 1]`. The RN
   * source does the same `- 1` (`applyClassificationsToTree`, board.tsx:1827). Main line only —
   * variations are never classified.
   *
   * Pass `null` to clear (a cancelled review must leave nothing behind).
   */
  function applyReview(s, annotated, nodes) {
    s.reviewProgress = null;
    if (!annotated) { s.review = null; s.reviewByNodeId = {}; return; }
    var byId = {};
    annotated.moveEvaluations.forEach(function (me) {
      var node = nodes[me.move_index - 1];
      if (node) byId[node.id] = me.classification;
    });
    s.review = annotated;
    s.reviewByNodeId = byId;
  }

  /** The classification of the move that reached `nodeId`, or null. */
  function classificationFor(s, nodeId) {
    return Object.prototype.hasOwnProperty.call(s.reviewByNodeId, nodeId)
      ? s.reviewByNodeId[nodeId] : null;
  }

  /**
   * What the accuracy modal renders. Rows follow `displayOrder` and DROP tiers where both sides are
   * zero, exactly as the source does (board.tsx:3887). Labels, symbols and colours are deliberately
   * absent: they need the metrics tables, which live in the UI layer — the same boundary
   * `evalParts` draws.
   */
  function reviewSummary(s) {
    if (!s.review) return null;
    var rows = [];
    s.review.displayOrder.forEach(function (key) {
      var w = s.review.whiteClassifications[key] || 0;
      var b = s.review.blackClassifications[key] || 0;
      if (w === 0 && b === 0) return;
      rows.push({ key: key, white: w, black: b });
    });
    return {
      whiteAccuracy: s.review.base.whiteAccuracy,
      blackAccuracy: s.review.base.blackAccuracy,
      rows: rows,
      graph: s.review.base.evalGraph.map(function (p) {
        return { cp: p.eval_cp, mate: p.eval_mate };
      })
    };
  }

  /** The position at the cursor. */
  function position(s) { return T.position(s.tree.current); }

  /** Root-to-cursor position keys — what drawReason and terminalOutcome need. */
  function historyKeys(s) { return T.historyKeys(s.tree.current); }

  function outcome(s) { return E.terminalOutcome(position(s), historyKeys(s)); }

  /**
   * The status line (board.tsx:2853-2871).
   *
   * TWO DELIBERATE DEVIATIONS from that source, both recorded in PORTING_NOTES:
   *
   *  1. The move number. The original computes `floor(node.halfMoveIndex / 2) + 1` — the number of
   *     the move just PLAYED — so after 1.e4 e5 it reads "1. White's move" when the next move is 2.
   *     We use the position's own `fullmove`, which is what a chess player reads. This is a UI port,
   *     not a golden-tested algorithm, so there is no parity contract to break.
   *  2. "(analyzing)" is appended on `isAnalyzing || autoAnalyze` in the original, so it shows
   *     permanently whenever auto-analyse is on, idle or not. Here it tracks a real in-flight search.
   */
  function statusText(s) {
    if (s.autoplaying) return '▶ Autoplay...';
    var pos = position(s);
    var o = E.terminalOutcome(pos, historyKeys(s));
    if (o.kind === 'checkmate') return 'Checkmate!';
    if (o.kind === 'draw') return o.reason === 'stalemate' ? 'Stalemate' : 'Draw';

    var white = pos.sideToMove === E.WHITE;
    var text = pos.fullmove + (white ? '.' : '...') + ' ' + (white ? "White's move" : "Black's move");
    if (s.analyzing) text += '\n(analyzing)';
    if (E.status(pos) === 'check') text += ' +';
    return text;
  }

  /**
   * The opening at the cursor. Walks root→cursor so a position that is in book but unnamed keeps the
   * last named line — twenty moves into the Najdorf still reads "Najdorf" (spec 12.2).
   */
  function openingEntry(s) {
    var line = T.lineTo(s.tree.current), last = null;
    for (var i = 0; i < line.length; i++) last = BOOK.nameFor(line[i].key, last);
    return last;
  }

  /** `ECO: Name`, or null when nothing along the line has ever been named. */
  function openingText(s) {
    var e = openingEntry(s);
    return e ? e.eco + ': ' + e.name : null;
  }

  /** Book continuations from the cursor — the ECO panel's rows, replacing the masters explorer. */
  function bookContinuations(s) { return BOOK.continuations(position(s)); }

  /** One arrow per engine line, rank 0 = best. Drawn straight from the PV's first move. */
  function arrows(s) {
    if (!s.snapshot || !s.snapshot.lines) return [];
    var out = [];
    for (var i = 0; i < s.snapshot.lines.length; i++) {
      var pv = s.snapshot.lines[i].pv;
      if (!pv || !pv.length) continue;
      out.push({ from: pv[0].from, to: pv[0].to, rank: i });
    }
    return out;
  }

  /** How many PV plies the engine row shows after the move itself (board.tsx:2827). */
  var PV_PREVIEW = 6;

  /** One row per engine line: eval · SAN · continuation (board.tsx:2807-2831). */
  function engineRows(s) {
    if (!s.snapshot || !s.snapshot.lines) return [];
    return s.snapshot.lines.map(function (ln, i) {
      var pv = ln.pv && ln.pv.length ? ln.pv[0] : null;
      return {
        rank: i,
        evalText: AN.formatScore(ln.score),
        san: ln.pvSAN && ln.pvSAN.length ? ln.pvSAN[0] : '',
        continuation: (ln.pvSAN || []).slice(1, 1 + PV_PREVIEW).join(' '),
        uci: pv ? E.moveUci(pv) : '',
        from: pv ? pv.from : -1,
        to: pv ? pv.to : -1,
        depth: ln.depth
      };
    });
  }

  /**
   * The snapshot's white-relative score, split into the three raw parts a presentation layer needs.
   *
   * This is the boundary between the shared session layer and the per-platform UI. Turning a score
   * into a bar fraction or a ⩲ symbol needs the metrics tables, which live in the UI module
   * (AnalysisMetrics.swift) and cannot be reached from a Foundation-only Core. So the session
   * publishes the numbers and each platform maps them with the same table.
   */
  function evalParts(s) {
    var sc = s.snapshot && s.snapshot.score;
    if (!sc) return { cp: null, mate: null, winner: null };
    if (sc.kind === 'cp') return { cp: sc.cp, mate: null, winner: null };
    if (sc.kind === 'mate') return { cp: null, mate: sc.mate, winner: null };
    var t = sc.terminal;
    return { cp: null, mate: null, winner: (t && t.kind === 'checkmate') ? t.winner : null };
  }

  /** White's share of the eval bar, 0…1. UI-side mapping of `evalParts`. */
  function evalFraction(s) {
    var p = evalParts(s);
    if (p.winner != null) return p.winner === E.WHITE ? 1 : 0;   // a delivered mate pins the bar
    if (p.cp == null && p.mate == null) return 0.5;
    return MET.evalBarFraction(p.cp, p.mate);
  }

  /** The notation symbol for the current eval (=, ⩲, +- …). UI-side mapping of `evalParts`. */
  function evalSymbol(s) {
    var p = evalParts(s);
    if (p.cp == null && p.mate == null) return null;
    return MET.evalSymbol(p.cp, p.mate);
  }

  /**
   * Does the snapshot describe some OTHER position than the one we are looking at?
   *
   * This is the whole restart policy. The original guarded with
   * `if (isAnalyzing || fen === lastAnalyzedFen) return;` (board.tsx:885) — and because its fetch
   * could not be cancelled, moving during a request silently dropped the new position and the panel
   * kept showing stale lines forever. Our engine IS cancellable, so staleness means "cancel and
   * restart", never "skip".
   */
  function isStale(s) {
    return !s.snapshot || s.snapshot.fen !== E.toFEN(position(s));
  }

  /** Should a search start right now? */
  function wantsAnalysis(s) {
    return s.autoAnalyze && !s.autoplaying && isStale(s) && outcome(s).kind === 'ongoing';
  }

  // `nagText` lives further down, beside the rest of the annotation layer.

  /**
   * The horizontal move strip (board.tsx:3049-3120): the MAIN LINE as a flat token run, with each
   * position's alternatives inserted inline as chips right after the main move they branch from.
   * It is not a nested tree — that is what makes one horizontal scroller enough.
   */
  function stripTokens(s) {
    var main = T.mainline(s.tree);
    if (!main.length) return [];
    var onPath = {};
    T.lineTo(s.tree.current).forEach(function (n) { onPath[n.id] = true; });
    var curId = s.tree.current.id;
    var out = [];

    main.forEach(function (node) {
      if (node.color === E.WHITE) {
        out.push({ kind: 'num', text: node.moveNumber + '.', classification: null });
      }
      out.push({
        kind: 'move', id: node.id, text: node.san + nagText(node.nag),
        active: node.id === curId, onPath: !!onPath[node.id],
        classification: classificationFor(s, node.id)
      });
      var siblings = node.parent ? node.parent.children : [];
      siblings.forEach(function (alt) {
        if (alt.id === node.id) return;
        var prefix = alt.moveNumber + (alt.color === E.WHITE ? '.' : '...');
        // Branch chips never carry a classification — review only walks the main line, and the
        // source's chip renderer does not read `reviewClassification` either.
        out.push({
          kind: 'alt', id: alt.id, text: prefix + alt.san + nagText(alt.nag),
          active: alt.id === curId, onPath: !!onPath[alt.id], classification: null
        });
      });
    });
    return out;
  }

  // ---- mutations -------------------------------------------------------------
  // Every one of these clears the snapshot and the selection, exactly as goToNode does
  // (board.tsx:1457-1470). A snapshot describes one position; moving invalidates it.

  function invalidate(s) { s.snapshot = null; s.selected = null; }

  /** Play a move object. Returns { node, created } or null when illegal. */
  function play(s, mv) {
    var r = T.addMove(s.tree, mv);
    if (r) invalidate(s);
    return r;
  }
  function playUci(s, uci) {
    var r = T.addUci(s.tree, uci);
    if (r) invalidate(s);
    return r;
  }
  function playSan(s, san) {
    var r = T.addSan(s.tree, san);
    if (r) invalidate(s);
    return r;
  }

  function goToNode(s, node) { T.goTo(s.tree, node); invalidate(s); return node; }
  function goToStart(s) { s.autoplaying = false; T.goToStart(s.tree); invalidate(s); return s.tree.current; }
  function goBack(s) { s.autoplaying = false; T.goBack(s.tree); invalidate(s); return s.tree.current; }
  function goToEnd(s) { s.autoplaying = false; T.goToEnd(s.tree); invalidate(s); return s.tree.current; }

  /** The children available from the cursor — more than one means the UI must ask which. */
  function forwardOptions(s) { return T.forwardOptions(s.tree); }

  /** Step forward into `index`. Returns null when there is nowhere to go. */
  function goForward(s, index) {
    var opts = forwardOptions(s);
    if (!opts.length) return null;
    T.goForward(s.tree, index || 0);
    invalidate(s);
    return s.tree.current;
  }

  /** The last move played on the way to the cursor — what the board highlights. */
  function lastMove(s) {
    var n = s.tree.current;
    return n.move ? { from: n.move.from, to: n.move.to } : null;
  }

  /** The king square to flash, or null. */
  function checkSquare(s) {
    var pos = position(s);
    var st = E.status(pos);
    return (st === 'check' || st === 'checkmate') ? E.kingSquare(pos, pos.sideToMove) : null;
  }

  // ---- annotations ------------------------------------------------------------
  // The source stores a SYMBOL string on the node (`node.annotation`). We store the NAG code,
  // because `MoveNode.nag` already exists, `PGN` already round-trips `$n`, and a symbol string
  // would be a second encoding of the same fact — the drift this repo keeps catching.

  /** NAG code -> the symbol shown after the SAN. The picker's inverse is `nagFor`. */
  var NAG_SYMBOL = {
    1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!',
    10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+-', 19: '-+'
  };
  /**
   * Symbol -> NAG. Built from the table so the two can never disagree.
   * `∞` ($13) is display-only: it can arrive in an imported PGN, but the source's picker has no
   * button for it, so ours does not either.
   */
  var NAG_FOR_SYMBOL = (function () {
    var m = {};
    for (var code in NAG_SYMBOL) {
      if (Object.prototype.hasOwnProperty.call(NAG_SYMBOL, code)) m[NAG_SYMBOL[code]] = Number(code);
    }
    return m;
  })();

  function nagText(nag) { return NAG_SYMBOL[nag] || ''; }
  function nagFor(symbol) {
    var n = NAG_FOR_SYMBOL[symbol];
    return n === undefined ? 0 : n;
  }

  /**
   * The annotation picker's two sections (board.tsx:3266, :3284). Both tables live in the metrics
   * layer, where they are asserted against the RN source — including the ⩲/⩱ correction.
   */
  function annotationSections() {
    function rows(table) {
      return table.map(function (a) {
        return { symbol: a.symbol, label: a.label, color: a.color, nag: nagFor(a.symbol) };
      });
    }
    return [
      { title: 'Move Quality', options: rows(MET.MOVE_ANNOTATIONS) },
      { title: 'Position Evaluation', options: rows(MET.POSITION_ANNOTATIONS) }
    ];
  }

  /** Attach (or with nag 0, remove) an annotation. Mirrors setMoveAnnotation:2552. */
  function setNag(s, nodeId, nag) {
    var n = nodeById(s, nodeId);
    if (!n || n === s.tree.root) return false;
    n.nag = nag | 0;
    return true;
  }
  function clearNag(s, nodeId) { return setNag(s, nodeId, 0); }

  /**
   * The glyph the board overlay draws for a node, or null.
   *
   * Deliberately the MANUAL annotation only. `renderAnnotationOverlay:2666` reads
   * `currentNode.annotation` and never touches `reviewClassification`, and it looks the symbol up
   * in MOVE_ANNOTATIONS alone — so a *position* annotation like `±` shows in the strip but draws
   * no badge. Both details are ported as-is.
   */
  function annotationSymbol(s, nodeId) {
    var n = nodeById(s, nodeId);
    if (!n || !n.nag) return null;
    var sym = NAG_SYMBOL[n.nag];
    if (!sym) return null;
    var isMoveQuality = MET.MOVE_ANNOTATIONS.some(function (a) { return a.symbol === sym; });
    return isMoveQuality ? sym : null;
  }

  /** The square the badge sits on: where the current move landed. null at the root. */
  function annotationSquare(s) {
    var n = s.tree.current;
    return n.move ? n.move.to : null;
  }

  // ---- variations --------------------------------------------------------------

  function nodeById(s, id) {
    var found = null;
    (function walk(n) {
      if (found) return;
      if (n.id === id) { found = n; return; }
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
    })(s.tree.root);
    return found;
  }

  /**
   * What the variation modal shows about a node (renderVariationModal:4357-4372).
   *
   * The source's third type, GM REFERENCE, is dropped: it keys off `node.isGmGame`, which only the
   * Lichess masters explorer ever set, and that panel became the bundled ECO book in Phase 8.
   */
  function variationInfo(s, nodeId) {
    var n = nodeById(s, nodeId);
    if (!n || n === s.tree.root) return null;
    var siblings = n.parent ? n.parent.children : [];
    var isMainline = siblings.length > 0 && siblings[0] === n;
    return {
      id: n.id,
      san: n.san,
      nagText: nagText(n.nag),
      movePrefix: n.moveNumber + (n.color === E.WHITE ? '.' : '...'),
      isMainline: isMainline,
      typeLabel: isMainline ? 'MAIN LINE' : 'SUB-VARIATION',
      siblingCount: siblings.length,
      subtreeCount: T.countSubtree(n),
      canPromote: !isMainline
    };
  }

  /** ⭐ Set as Main Line (:4419). Promotes the whole line, not just one ply. */
  function promoteNode(s, nodeId) {
    var n = nodeById(s, nodeId);
    if (!n || n === s.tree.root) return false;
    var changed = T.promoteFully(s.tree, n);
    if (changed) invalidate(s);
    return changed;
  }

  /**
   * 🗑 Delete Branch (:4469). Returns how many nodes went.
   * `T.remove` already walks the cursor back to the parent when it was inside the subtree; the
   * review has to be dropped too, since its node ids may no longer exist.
   */
  function deleteBranch(s, nodeId) {
    var n = nodeById(s, nodeId);
    if (!n || n === s.tree.root) return 0;
    var gone = T.remove(s.tree, n);
    if (gone) { invalidate(s); applyReview(s, null, []); }
    return gone;
  }

  // ---- PGN in and out ------------------------------------------------------------

  /**
   * Swap the whole game out — the entry point for opening a saved session, importing a PGN, and
   * applying an edited position. Mirrors AnalysisSession.replaceTree. It does NOT move the cursor;
   * each caller decides where to land.
   */
  function replaceTree(s, newTree) {
    s.tree = newTree;
    s.snapshot = null;
    s.selected = null;
    s.autoplaying = false;
    applyReview(s, null, []);
  }

  /**
   * Import (handleImportPgn:2326). Replaces the tree wholesale and reports what was found, so the
   * caller can pre-fill the save form from the headers exactly as the source does (:2333-2349).
   *
   * ASSUMPTION, recorded: a multi-game PGN loads its FIRST game and says how many it saw. The
   * source does the same thing silently.
   */
  function importPGN(s, text) {
    var parsed = P.parse(String(text == null ? '' : text));
    var games = parsed.games || [];
    var g = games.length ? games[0] : null;
    // `PGN.parse` is deliberately tolerant — it will hand back a zero-move game full of parse
    // errors rather than refuse. That is right for a parser and wrong for an import: wiping the
    // board because someone pasted a paragraph is destructive. An import counts only if it
    // produced at least one move, or a custom start position (a setup-only PGN is legitimate).
    var moves = g ? T.mainline(g.tree).length : 0;
    var custom = !!g && g.initialFen && g.initialFen !== E.START_FEN;
    if (!g || (moves === 0 && !custom)) {
      return {
        ok: false, gamesFound: games.length, moveCount: 0,
        errors: g ? (g.errors || []) : [], headers: {}, result: '*',
        initialFen: E.START_FEN
      };
    }
    // No reposition needed: PGN.parse restores the cursor after every RAV, so it already sits on
    // the last move of the main line — which is where loadPgnMoves leaves it too. Asserted below.
    replaceTree(s, g.tree);
    return {
      ok: true,
      gamesFound: games.length,
      moveCount: T.mainline(s.tree).length,
      errors: g.errors || [],
      headers: g.headers || {},
      result: g.result || '*',
      initialFen: g.initialFen || E.START_FEN
    };
  }

  /** Export (handleCopyPgn:2373). Empty string when there is nothing to share. */
  function exportPGN(s, headers, result) {
    var moves = T.mainline(s.tree);
    if (!moves.length && s.tree.initialFen === E.START_FEN) return '';
    return P.serialize({
      headers: headers || {}, tree: s.tree, result: result || '*',
      errors: [], moveCount: moves.length, preComment: '', initialFen: s.tree.initialFen
    });
  }

  /** ✓ Apply Position (toggleEditMode:2438). The edited board becomes a brand-new tree. */
  function applyEditedPosition(s, pos) {
    if (!pos) return false;
    var tree = T.create(E.toFEN(pos));
    if (!tree) return false;
    replaceTree(s, tree);
    return true;
  }

  /* ============================== self-check ============================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function eq(a, b, what) { expect(a === b, what + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }
    function near(a, b, what) { expect(Math.abs(a - b) < 1e-9, what + ': got ' + a + ', expected ' + b); }

    // 1. a fresh session
    var s = createSession();
    expect(s !== null, 'a session is created from the start position');
    eq(E.toFEN(position(s)), E.START_FEN, 'cursor starts at the start position');
    eq(historyKeys(s).length, 1, 'history holds just the start key');
    eq(statusText(s), "1. White's move", 'status at the start');
    eq(arrows(s).length, 0, 'no arrows without a snapshot');
    eq(engineRows(s).length, 0, 'no engine rows without a snapshot');
    eq(stripTokens(s).length, 0, 'the strip is empty before any move');
    eq(isStale(s), true, 'a session with no snapshot is stale');
    eq(lastMove(s), null, 'no last move at the start');
    eq(checkSquare(s), null, 'nobody is in check at the start');
    near(evalFraction(s), 0.5, 'the eval bar is centred with no snapshot');

    // 2. the move number DEVIATION — the source would say "1." here
    playSan(s, 'e4');
    eq(statusText(s), "1... Black's move", 'after 1.e4 it is Black to move on move 1');
    playSan(s, 'e5');
    eq(statusText(s), "2. White's move",
       'after 1.e4 e5 the next move is 2 (the RN source reads "1." here — deliberate deviation)');

    // 3. the move strip, mainline only
    var toks = stripTokens(s);
    eq(toks.length, 3, 'two plies render as number + move + move');
    eq(toks[0].kind + ':' + toks[0].text, 'num:1.', 'the number token precedes White');
    eq(toks[1].text, 'e4', 'first move token');
    eq(toks[2].text, 'e5', 'second move token');
    eq(toks[2].active, true, 'the cursor token is active');
    eq(toks[1].active, false, 'earlier tokens are not active');
    eq(toks[1].onPath, true, 'earlier tokens are on the path');

    // 4. branching — the alternative appears inline as a chip
    goBack(s);                       // back to after 1.e4
    playSan(s, 'c5');                // a sibling of e5
    var branched = stripTokens(s);
    var alts = branched.filter(function (t) { return t.kind === 'alt'; });
    eq(alts.length, 1, 'one alternative chip');
    eq(alts[0].text, '1...c5', 'the chip carries its own move number and the ... prefix');
    eq(alts[0].active, true, 'the chip is active because the cursor is on it');
    eq(branched.filter(function (t) { return t.kind === 'move'; }).length, 2,
       'the main line still shows two moves');
    eq(T.mainline(s.tree)[1].san, 'e5', 'c5 is a variation, not the main line');

    // 5. navigation clears the snapshot, always
    s.snapshot = { fen: E.toFEN(position(s)), lines: [], score: null };
    eq(isStale(s), false, 'a snapshot for the current position is fresh');
    goBack(s);
    eq(s.snapshot, null, 'going back clears the snapshot');
    eq(isStale(s), true, 'and that makes it stale again');
    s.snapshot = { fen: E.toFEN(position(s)), lines: [], score: null };
    eq(playSan(s, 'Nf3'), null, 'Nf3 is not legal for Black, so it is rejected');
    expect(s.snapshot !== null, 'a rejected move leaves the snapshot alone');
    playSan(s, 'Nc6');
    eq(s.snapshot, null, 'playing a move clears the snapshot');

    // 6. forward with several children has to ask which
    goToStart(s);
    goForward(s);                                  // into e4 — the only child of the root
    eq(forwardOptions(s).length, 3, 'after 1.e4 there are three recorded continuations');
    eq(forwardOptions(s).map(function (n) { return n.san; }).join(' '), 'e5 c5 Nc6',
       'in the order they were added, children[0] being the main line');
    eq(goForward(s, 1).san, 'c5', 'the index selects which branch');
    goBack(s);
    eq(goForward(s, 2).san, 'Nc6', 'including the third');
    goBack(s);
    eq(goForward(s).san, 'e5', 'no index means the main line');
    eq(goForward(s, 0), null, 'a leaf has nowhere to go forward');
    goToStart(s);
    eq(goToEnd(s).san, 'e5', 'goToEnd follows the MAIN line, not the last one played');

    // 7. staleness drives the restart policy
    var s2 = createSession();
    s2.snapshot = { fen: E.START_FEN, lines: [], score: null };
    eq(wantsAnalysis(s2), false, 'a fresh snapshot needs no work');
    playSan(s2, 'd4');
    eq(wantsAnalysis(s2), true, 'moving makes it want a new search');
    s2.autoAnalyze = false;
    eq(wantsAnalysis(s2), false, 'not with auto-analyse off');
    s2.autoAnalyze = true; s2.autoplaying = true;
    eq(wantsAnalysis(s2), false, 'not while autoplaying');
    eq(statusText(s2), '▶ Autoplay...', 'autoplay replaces the whole status line');
    s2.autoplaying = false;
    eq(statusText(s2), "1... Black's move", 'and stops doing so when it ends');

    // 8. terminal positions
    var mated = createSession('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    eq(statusText(mated), 'Checkmate!', 'fool\'s mate reads as checkmate');
    eq(wantsAnalysis(mated), false, 'a finished game is never analysed');
    var stale = createSession('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    eq(statusText(stale), 'Stalemate', 'stalemate is named');
    var bare = createSession('7k/8/6K1/8/8/8/8/8 w - - 0 1');
    eq(statusText(bare), 'Draw', 'insufficient material reads as a draw');
    eq(outcome(bare).reason, 'insufficient', 'and names its reason');

    // 9. check marker — a check that is NOT mate (1.e4 d5 2.Bb5+ can be blocked four ways)
    var chk = createSession();
    ['e4', 'd5', 'Bb5'].forEach(function (m) { playSan(chk, m); });
    eq(E.status(position(chk)), 'check', 'Bb5 gives check without mating');
    expect(statusText(chk).indexOf(' +') > 0, 'a check appends " +", got ' + JSON.stringify(statusText(chk)));
    expect(statusText(chk).indexOf("Black's move") > 0, 'and still says whose move it is');

    // 10. the analysing marker tracks a real search, not the toggle (deviation 2)
    var an = createSession();
    an.autoAnalyze = true;
    expect(statusText(an).indexOf('(analyzing)') < 0,
           'auto-analyse alone does not claim to be analysing');
    an.analyzing = true;
    expect(statusText(an).indexOf('\n(analyzing)') > 0, 'an in-flight search does');

    // 11. openings, including a transposition
    var op = createSession();
    eq(openingText(op), null, 'the start position has no name');
    playSan(op, 'e4');
    expect((openingText(op) || '').indexOf('B00') === 0, 'after 1.e4 the book names B00, got ' + openingText(op));
    playSan(op, 'c5');
    expect((openingText(op) || '').indexOf('Sicilian') > 0, 'after 1...c5 it is a Sicilian, got ' + openingText(op));
    var deep = createSession();
    ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4'].forEach(function (m) { playSan(deep, m); });
    eq(openingText(deep), 'B50: Sicilian Defense', 'six plies in');
    // The whole reason nameFor carries `lastKnown`: this position IS in book but is a pass-through
    // row with no name of its own. Without the carry it would go blank mid-opening.
    playSan(deep, 'Nxd4');
    eq(BOOK.named(deep.tree.current.key), null, 'ply 7 is a pass-through row, not a named line');
    eq(openingText(deep), 'B50: Sicilian Defense', 'an unnamed book position keeps the previous name');
    ['Nf6', 'Nc3', 'a6'].forEach(function (m) { playSan(deep, m); });
    expect((openingText(deep) || '').indexOf('Najdorf') > 0,
           'ten plies in it is the Najdorf, got ' + openingText(deep));
    ['Be3', 'e5', 'Nb3', 'Be6', 'f3'].forEach(function (m) { playSan(deep, m); });
    eq(openingText(deep), 'B90: Sicilian Defense: Najdorf Variation, English Attack',
       'and fifteen plies in it has a full name');
    // Now leave the book altogether — the name must still stick (spec 12.2).
    playSan(deep, 'Be7');
    eq(BOOK.contains(deep.tree.current.key), false, 'ply 16 is out of book');
    eq(openingText(deep), 'B90: Sicilian Defense: Najdorf Variation, English Attack',
       'leaving the book keeps the last named line rather than going blank');
    eq(bookContinuations(deep).length, 0, 'and offers no continuations from out of book');
    var cont = bookContinuations(createSession());
    expect(cont.length > 10, 'the start position has many book continuations, got ' + cont.length);
    expect(cont.every(function (c, i, a) { return i === 0 || a[i - 1].san <= c.san; }),
           'continuations are sorted by SAN');

    // 12. arrows and engine rows come straight from a snapshot
    var fake = createSession();
    var pos0 = position(fake);
    var e4 = E.parseSan(pos0, 'e4'), d4 = E.parseSan(pos0, 'd4');
    fake.snapshot = {
      fen: E.START_FEN, depth: 4, nodes: 100, isFinal: true, terminal: null,
      score: { kind: 'cp', cp: 30 },
      lines: [
        { rank: 1, score: { kind: 'cp', cp: 30 }, pv: [e4], pvSAN: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'], depth: 4 },
        { rank: 2, score: { kind: 'cp', cp: 20 }, pv: [d4], pvSAN: ['d4', 'd5'], depth: 4 }
      ]
    };
    var ar = arrows(fake);
    eq(ar.length, 2, 'one arrow per line');
    eq(ar[0].from, e4.from, 'the best arrow starts where the best move does');
    eq(ar[0].rank, 0, 'ranks are 0-based for the arrow colours');
    eq(ar[1].rank, 1, 'the second line is rank 1');
    var rows = engineRows(fake);
    eq(rows[0].san, 'e4', 'the row names its move');
    eq(rows[0].evalText, '+0.3', 'the row formats its score');
    eq(rows[0].continuation, 'e5 Nf3 Nc6 Bb5 a6 Ba4',
       'the continuation shows six plies after the move');
    eq(rows[1].continuation, 'd5', 'a short PV shows what it has');
    eq(isStale(fake), false, 'a snapshot matching the cursor is fresh');
    eq(evalParts(fake).cp, 30, 'evalParts carries the centipawns');
    eq(evalParts(fake).mate, null, 'and no mate');
    eq(evalParts(fake).winner, null, 'and no terminal winner');
    near(evalFraction(fake), 0.53, 'a +30cp eval nudges the bar');
    eq(evalSymbol(fake), '=', '+30cp is still equal');

    // 13. mate and terminal scores in the bar
    var mate = createSession();
    mate.snapshot = { fen: E.START_FEN, lines: [], score: { kind: 'mate', mate: 3 } };
    near(evalFraction(mate), 0.95, 'a mate for White pins the bar near the top');
    eq(evalSymbol(mate), '+-', 'and reads as winning');
    mate.snapshot = { fen: E.START_FEN, lines: [], score: { kind: 'mate', mate: -2 } };
    near(evalFraction(mate), 0.05, 'a mate against White pins it near the bottom');
    eq(evalParts(mate).mate, -2, 'evalParts carries a mate score');
    mate.snapshot = {
      fen: E.START_FEN, lines: [],
      score: { kind: 'terminal', terminal: { kind: 'checkmate', reason: 'checkmate', winner: E.BLACK } }
    };
    eq(evalParts(mate).winner, E.BLACK, 'evalParts names the side that delivered mate');
    eq(evalSymbol(mate), null, 'a finished game has no eval symbol');
    near(evalFraction(mate), 0, 'a delivered mate pins the bar to the result');

    // 14. the board's own inputs
    var bd = createSession();
    playSan(bd, 'e4');
    eq(lastMove(bd).from, e4.from, 'the last move is what the board highlights');
    eq(lastMove(bd).to, e4.to, 'and where it went');
    goToStart(bd);
    eq(lastMove(bd), null, 'the root has no last move');

    // 15. Review state — the 1-based move_index mapping is the whole risk here
    var rv = createSession();
    ['e4', 'e5', 'Nf3', 'Nc6'].forEach(function (m) { playSan(rv, m); });
    eq(rv.review, null, 'a fresh session has no review');
    eq(reviewSummary(rv), null, 'and no summary');
    eq(stripTokens(rv).filter(function (t) { return t.classification; }).length, 0,
       'no strip token carries a classification');

    var rvPlan = V.plan(rv.tree);
    eq(rvPlan.nodes.length, 4, 'the plan walked four plies');
    // A hand-built result: move_index 1..4 -> nodes[0..3]. Deliberately not from the engine, so the
    // mapping is asserted independently of what any search happens to return.
    var fakeAnn = {
      base: {
        whiteAccuracy: 91.5, blackAccuracy: 62.25,
        whiteClassifications: {}, blackClassifications: {},
        moveEvaluations: [], evalGraph: [
          { move_index: 0, eval_cp: 0, eval_mate: null },
          { move_index: 1, eval_cp: 30, eval_mate: null },
          { move_index: 2, eval_cp: -400, eval_mate: null },
          { move_index: 3, eval_cp: 10, eval_mate: null },
          { move_index: 4, eval_cp: 0, eval_mate: 2 }
        ]
      },
      moveEvaluations: [
        { move_index: 1, classification: 'book', cp_loss: 0, best_move_san: 'e4' },
        { move_index: 2, classification: 'blunder', cp_loss: 430, best_move_san: 'c5' },
        { move_index: 3, classification: 'best', cp_loss: 0, best_move_san: 'Nf3' },
        { move_index: 4, classification: 'good', cp_loss: 12, best_move_san: 'Nc6' }
      ],
      whiteClassifications: { brilliant: 0, great: 0, book: 1, best: 1, excellent: 0, good: 0,
                              inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 },
      blackClassifications: { brilliant: 0, great: 0, book: 0, best: 0, excellent: 0, good: 1,
                              inaccuracy: 0, mistake: 0, miss: 0, blunder: 1 },
      displayOrder: V.DISPLAY_ORDER.slice()
    };
    applyReview(rv, fakeAnn, rvPlan.nodes);

    eq(classificationFor(rv, rvPlan.nodes[0].id), 'book', 'move_index 1 maps to nodes[0], not nodes[1]');
    eq(classificationFor(rv, rvPlan.nodes[1].id), 'blunder', 'move_index 2 maps to nodes[1]');
    eq(classificationFor(rv, rvPlan.nodes[3].id), 'good', 'move_index 4 maps to nodes[3]');
    eq(classificationFor(rv, rv.tree.root.id), null, 'the root is never classified');
    eq(classificationFor(rv, 9999), null, 'an unknown id gives null, not undefined');

    var toks15 = stripTokens(rv);
    var moveToks = toks15.filter(function (t) { return t.kind === 'move'; });
    eq(moveToks.map(function (t) { return t.classification; }).join(','), 'book,blunder,best,good',
       'the strip carries them in order');
    eq(toks15.filter(function (t) { return t.kind === 'num'; })[0].classification, null,
       'number tokens carry none');

    var sum = reviewSummary(rv);
    eq(sum.whiteAccuracy, 91.5, 'the summary reports White\'s accuracy');
    eq(sum.blackAccuracy, 62.25, 'and Black\'s');
    eq(sum.rows.map(function (r) { return r.key; }).join(','), 'book,best,good,blunder',
       'rows follow displayOrder and DROP all-zero tiers');
    eq(sum.rows[0].white, 1, 'book: White 1');
    eq(sum.rows[0].black, 0, 'book: Black 0');
    eq(sum.rows[3].key, 'blunder', 'blunder is last in displayOrder');
    eq(sum.rows[3].black, 1, 'and it is Black\'s');
    eq(sum.graph.length, 5, 'the graph has one point per position');
    eq(sum.graph[0].cp, 0, 'graph[0] is the start position');
    eq(sum.graph[4].mate, 2, 'and a mate score survives the mapping');

    // A variation added after the review must not gain a classification.
    goBack(rv);                                  // back to after 2.Nf3 — Black to move
    expect(playSan(rv, 'Nf6') !== null, 'a Black alternative to 2...Nc6 is legal');
    var altToks = stripTokens(rv).filter(function (t) { return t.kind === 'alt'; });
    eq(altToks.length, 1, 'one branch chip');
    eq(altToks[0].classification, null, 'a branch chip is never classified');
    eq(classificationFor(rv, rvPlan.nodes[3].id), 'good', 'and the main line keeps its labels');
    expect(rv.review !== null, 'navigating and branching does not drop the review');

    // Clearing — what a cancelled review must do.
    applyReview(rv, null, []);
    eq(rv.review, null, 'clearing drops the review');
    eq(reviewSummary(rv), null, 'and the summary');
    eq(classificationFor(rv, rvPlan.nodes[0].id), null, 'and every classification');
    eq(rv.reviewProgress, null, 'and the progress');

    // ---- annotations (phase 11) ------------------------------------------------
    // The NAG table and its inverse must agree, or a picked symbol round-trips to a different one.
    var symbolCount = 0;
    for (var nagCode in NAG_SYMBOL) {
      if (!Object.prototype.hasOwnProperty.call(NAG_SYMBOL, nagCode)) continue;
      symbolCount++;
      eq(nagFor(NAG_SYMBOL[nagCode]), Number(nagCode), 'NAG ' + nagCode + ' round-trips through its symbol');
    }
    eq(symbolCount, 14, 'six move-quality NAGs plus eight position NAGs');
    eq(nagText(0), '', 'NAG 0 renders as nothing');
    eq(nagText(999), '', 'an unknown NAG renders as nothing');
    eq(nagFor('nonsense'), 0, 'an unknown symbol maps to no NAG');
    // The ⩲/⩱ correction reaches the picker, which is what writes NAGs into the PGN.
    eq(nagFor('⩲'), 14, '⩲ is $14 — White is slightly better (the source has this backwards)');
    eq(nagFor('⩱'), 15, '⩱ is $15 — Black is slightly better');
    eq(nagFor('!!'), 3, '!! is $3');
    eq(nagFor('?!'), 6, '?! is $6');

    var secs = annotationSections();
    eq(secs.length, 2, 'the picker has two sections');
    eq(secs[0].title, 'Move Quality', 'first section (board.tsx:3266)');
    eq(secs[1].title, 'Position Evaluation', 'second section (board.tsx:3284)');
    eq(secs[0].options.length, 6, 'six move-quality buttons');
    eq(secs[1].options.length, 7, 'seven position buttons');
    expect(secs[0].options.every(function (o) { return o.nag > 0 && o.color && o.label; }),
      'every move-quality option carries a NAG, a colour and a label');
    expect(secs[1].options.every(function (o) { return o.nag > 0; }),
      'and every position option maps to a real NAG');

    var an = createSession();
    expect(playSan(an, 'e4') !== null, 'annotation fixture: 1.e4');
    var e4id = an.tree.current.id;
    expect(playSan(an, 'e5') !== null, 'annotation fixture: 1...e5');
    var e5id = an.tree.current.id;
    eq(annotationSymbol(an, e4id), null, 'a move starts unannotated');
    expect(setNag(an, e4id, 3), 'set !! on 1.e4');
    eq(annotationSymbol(an, e4id), '!!', 'and the overlay shows it');
    eq(stripTokens(an).filter(function (t) { return t.id === e4id; })[0].text, 'e4!!',
      'the strip appends the glyph to the SAN');
    expect(setNag(an, e4id, 16), 'change it to ±');
    eq(stripTokens(an).filter(function (t) { return t.id === e4id; })[0].text, 'e4±',
      'a position annotation still shows in the strip');
    eq(annotationSymbol(an, e4id), null,
      'but draws NO badge — renderAnnotationOverlay looks only in MOVE_ANNOTATIONS');
    expect(clearNag(an, e4id), 'clear it');
    eq(annotationSymbol(an, e4id), null, 'no glyph');
    eq(stripTokens(an).filter(function (t) { return t.id === e4id; })[0].text, 'e4', 'and a bare SAN');
    expect(!setNag(an, an.tree.root.id, 3), 'the root cannot be annotated');
    expect(!setNag(an, 99999, 3), 'nor can a node that does not exist');
    eq(annotationSymbol(an, 99999), null, 'and a missing node has no glyph');
    // The badge sits on the destination of the CURRENT move.
    eq(annotationSquare(an), an.tree.current.move.to, 'the badge square is where the move landed');
    goToStart(an);
    eq(annotationSquare(an), null, 'and there is none at the root');

    // ---- variations (phase 11) --------------------------------------------------
    var vr = createSession();
    playSan(vr, 'e4'); playSan(vr, 'e5'); playSan(vr, 'Nf3');
    var nf3id = vr.tree.current.id;
    goBack(vr);                                    // after 1...e5
    expect(playSan(vr, 'Nc3') !== null, 'a second-choice 2.Nc3');
    var nc3id = vr.tree.current.id;
    playSan(vr, 'Nc6');                            // give the variation a continuation

    var mainInfo = variationInfo(vr, nf3id);
    var altInfo = variationInfo(vr, nc3id);
    eq(mainInfo.typeLabel, 'MAIN LINE', '2.Nf3 is the main line');
    eq(mainInfo.canPromote, false, 'and cannot be promoted');
    eq(mainInfo.movePrefix, '2.', 'a White move reads "2."');
    eq(altInfo.typeLabel, 'SUB-VARIATION', '2.Nc3 is a sub-variation');
    eq(altInfo.canPromote, true, 'and can be promoted');
    eq(altInfo.siblingCount, 2, 'there are two continuations at that point');
    eq(altInfo.subtreeCount, 2, '2.Nc3 plus its one continuation');
    eq(variationInfo(vr, vr.tree.root.id), null, 'the root has no variation card');
    eq(variationInfo(vr, 99999), null, 'nor does a node that is not there');
    var blackInfo = variationInfo(vr, vr.tree.current.id);
    eq(blackInfo.movePrefix, '2...', 'a Black move reads "2..."');
    setNag(vr, nc3id, 5);
    eq(variationInfo(vr, nc3id).nagText, '!?', 'the card shows the annotation');
    clearNag(vr, nc3id);

    // Promoting the DEEPEST node of a variation must lift the whole line, not one ply — which is
    // the difference between MoveTree.promote and promoteFully, and is invisible on a 1-ply branch.
    playSan(vr, 'Bc4');                            // 2.Nc3 Nc6 3.Bc4 — three plies deep now
    var bc4id = vr.tree.current.id;
    expect(promoteNode(vr, bc4id), 'promote the deepest node of the variation');
    eq(T.mainlineSans(vr.tree).join(' '), 'e4 e5 Nc3 Nc6 Bc4',
      'promoting a leaf lifts every ancestor with it');
    eq(variationInfo(vr, nc3id).typeLabel, 'MAIN LINE', '2.Nc3 came along');
    eq(variationInfo(vr, nf3id).typeLabel, 'SUB-VARIATION', 'and 2.Nf3 has been demoted');
    expect(!promoteNode(vr, vr.tree.root.id), 'the root cannot be promoted');
    expect(!promoteNode(vr, 99999), 'nor can a missing node');
    expect(!promoteNode(vr, nc3id), 'promoting the main line again changes nothing');

    // Deleting the branch the cursor is standing in must not leave a dangling cursor.
    goToNode(vr, nodeById(vr, nf3id));
    eq(vr.tree.current.id, nf3id, 'stand inside the branch about to go');
    eq(deleteBranch(vr, nf3id), 1, 'one node removed');
    expect(vr.tree.current.id !== nf3id, 'the cursor moved out of the deleted subtree');
    eq(variationInfo(vr, nf3id), null, 'and the node is gone');
    eq(deleteBranch(vr, vr.tree.root.id), 0, 'the root cannot be deleted');
    eq(deleteBranch(vr, 99999), 0, 'nor can a missing node');
    // A delete drops the review, because its node ids may no longer exist.
    var vd = createSession();
    playSan(vd, 'e4'); var vdid = vd.tree.current.id; playSan(vd, 'e5');
    applyReview(vd, fakeAnn, rvPlan.nodes);
    expect(vd.review !== null, 'a review is attached');
    deleteBranch(vd, vdid);
    eq(vd.review, null, 'deleting a branch drops the review');

    // ---- PGN in and out (phase 11) ----------------------------------------------
    var im = createSession();
    var withVars = '[Event "Test Cup"]\n[Site "Manila"]\n[White "Ana"]\n[Black "Ben"]\n'
      + '[Result "1-0"]\n[ECO "C20"]\n\n1. e4 e5 2. Nf3 $1 (2. Nc3 Nc6) 2... Nc6 1-0\n';
    var res = importPGN(im, withVars);
    expect(res.ok, 'a PGN with a variation imports');
    eq(res.gamesFound, 1, 'one game found');
    eq(res.moveCount, 4, 'four main-line moves');
    eq(res.errors.length, 0, 'and no parse errors');
    eq(res.headers.White, 'Ana', 'the headers come back for the save form');
    eq(res.headers.ECO, 'C20', 'including ECO');
    eq(res.result, '1-0', 'and the result');
    eq(T.mainlineSans(im.tree).join(' '), 'e4 e5 Nf3 Nc6', 'the main line is the imported one');
    eq(im.tree.current.san, 'Nc6', 'and the cursor lands on the last move');
    eq(im.snapshot, null, 'importing invalidates any snapshot');
    var impAlts = stripTokens(im).filter(function (t) { return t.kind === 'alt'; });
    eq(impAlts.length, 1, 'the variation survived as a branch chip');
    eq(nodeById(im, stripTokens(im).filter(function (t) {
      return t.kind === 'move' && t.text.indexOf('Nf3') === 0;
    })[0].id).nag, 1, 'the $1 attached to 2.Nf3');

    var bad = createSession();
    var badRes = importPGN(bad, 'this is not a pgn at all');
    eq(badRes.ok, false, 'nonsense does not import');
    expect(badRes.errors.length > 0, 'the tolerant parser still reports what it choked on');
    eq(T.mainline(bad.tree).length, 0, 'and the board is left alone');
    // The board must survive a failed import even when there was already a game on it.
    var keep = createSession();
    playSan(keep, 'd4'); playSan(keep, 'd5');
    eq(importPGN(keep, 'not a pgn').ok, false, 'a failed import over a real game fails');
    eq(T.mainlineSans(keep.tree).join(' '), 'd4 d5', 'and leaves that game untouched');
    // A setup-only PGN has no moves but is still a real import.
    var setupOnly = createSession();
    var setupText = '[SetUp "1"]\n[FEN "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1"]\n\n*\n';
    var setupRes = importPGN(setupOnly, setupText);
    expect(setupRes.ok, 'a setup-only PGN imports');
    eq(setupRes.moveCount, 0, 'with no moves');
    eq(setupOnly.tree.initialFen, '8/8/8/3k4/8/8/4P3/4K3 w - - 0 1', 'onto its custom position');
    eq(importPGN(createSession(), '').ok, false, 'the empty string does not import');
    eq(importPGN(createSession(), null).ok, false, 'nor does null');

    var multi = createSession();
    var two = '[White "A"]\n\n1. e4 *\n\n[White "B"]\n\n1. d4 *\n';
    var multiRes = importPGN(multi, two);
    eq(multiRes.gamesFound, 2, 'a two-game PGN reports both');
    eq(T.mainlineSans(multi.tree).join(' '), 'e4', 'but loads the first (recorded assumption)');

    // Export, and the round trip that matters: what we write, we can read back.
    var ex = createSession();
    eq(exportPGN(ex, {}, '*'), '', 'an untouched start position exports nothing');
    playSan(ex, 'e4'); playSan(ex, 'c5');
    setNag(ex, ex.tree.current.id, 6);
    var text = exportPGN(ex, { White: 'Ana', Black: 'Ben', ECO: 'B20' }, '1-0');
    expect(text.indexOf('[White "Ana"]') >= 0, 'the export carries its headers');
    expect(text.indexOf('[ECO "B20"]') >= 0, 'including the non-roster ones');
    expect(text.indexOf('1-0') >= 0, 'and the result');
    var back = createSession();
    var backRes = importPGN(back, text);
    expect(backRes.ok, 'the export re-imports');
    eq(T.mainlineSans(back.tree).join(' '), 'e4 c5', 'with the same moves');
    eq(back.tree.current.nag, 6, 'and the NAG survived the round trip');
    eq(exportPGN(back, backRes.headers, backRes.result), text, 'and re-exporting is byte-identical');

    // ---- applying an edited position (phase 11) ---------------------------------
    var ed = createSession();
    playSan(ed, 'e4');
    var endgame = E.fromFEN('8/8/8/3k4/8/8/4P3/4K3 w - - 0 1');
    expect(applyEditedPosition(ed, endgame), 'a legal position applies');
    eq(ed.tree.initialFen, '8/8/8/3k4/8/8/4P3/4K3 w - - 0 1', 'the tree restarts from it');
    eq(T.mainline(ed.tree).length, 0, 'with no moves');
    eq(position(ed).sideToMove, E.WHITE, 'and White to move');
    eq(ed.snapshot, null, 'the snapshot went with the old game');
    var ap = createSession();
    playSan(ap, 'e4');
    ap.autoplaying = true;
    expect(applyEditedPosition(ap, E.fromFEN('8/8/8/3k4/8/8/8/4K3 w - - 0 1')),
      'apply while autoplaying');
    eq(ap.autoplaying, false, 'swapping the game out stops autoplay');
    var sel = createSession();
    playSan(sel, 'e4');
    sel.selected = 12;
    expect(applyEditedPosition(sel, E.fromFEN('8/8/8/3k4/8/8/8/4K3 w - - 0 1')),
      'apply with a square selected');
    eq(sel.selected, null, 'and the selection goes with the old board');
    var ip = createSession();
    ip.autoplaying = true;
    importPGN(ip, '1. d4 d5 *');
    eq(ip.autoplaying, false, 'and so does an import');
    expect(!applyEditedPosition(ed, null), 'applying nothing does nothing');
    // A custom start survives an export/import round trip, which the SOURCE's does not
    // (its generatePgn emits movetext only — bug #1 in the phase-10 notes).
    playSan(ed, 'e4');
    var edText = exportPGN(ed, {}, '*');
    expect(edText.indexOf('[FEN "8/8/8/3k4/8/8/4P3/4K3 w - - 0 1"]') >= 0,
      'the export carries a [FEN] tag for a custom start');
    var edBack = createSession();
    expect(importPGN(edBack, edText).ok, 'and it re-imports');
    eq(edBack.tree.initialFen, '8/8/8/3k4/8/8/4P3/4K3 w - - 0 1', 'onto the same custom position');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisBoardSelfTest: ' + passed + ' assertions passed'
        : 'AnalysisBoardSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  /* ============================== rendering ============================== */

  var session = null;
  var ui = null;            // element refs, captured once so repaints never rebuild the DOM
  var root = null;
  var engineToken = 0;      // bumped to abandon any search in flight
  var debounceTimer = null;
  var autoplayTimer = null;
  var autoplaySpeed = MET.DEFAULT_AUTOPLAY_SPEED;
  var boardTheme = MET.DEFAULT_BOARD_THEME;
  // ---- phase 11 view state ----
  var showArrows = true;              // the ☰ Settings toggle (board.tsx:4517)
  var editing = false;                // Setup Position is open
  var editor = null;                  // the BiyaPositionEditor while it is
  var editorPiece = null;             // the palette selection, or PE.ERASER, or null
  var lastTapSquare = null;           // the double-tap-to-remove gesture (350ms)
  var lastTapAt = 0;

  /** `<kind>-<w|b>.svg`, the naming the piece set and SVGVector.swift both use. */
  var PIECE_FILE = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** The board asks for legal moves; it never touches the engine itself. */
  var rulesAdapter = {
    legalMovesFrom: function (fen, sq) {
      var pos = E.fromFEN(fen);
      if (!pos) return [];
      return E.legalMovesFrom(pos, sq).map(function (m) { return { to: m.to, promotion: m.promotion }; });
    }
  };
  function findMove(pos, from, to, promotion) {
    return E.legalMoves(pos).find(function (m) {
      return m.from === from && m.to === to &&
        ((promotion == null && m.promotion == null) || m.promotion === promotion);
    });
  }
  /** Still on screen? Every timer checks this instead of needing a teardown hook (home.js:406). */
  function alive() { return root != null && document.body.contains(root); }

  /**
   * The board's size, and the space the ECO panel gets — the only two numbers on this screen that
   * need a measured element, because everything else is a constant from the metrics layer.
   *
   * THE RULE THIS ENFORCES: the board is a function of the screen's WIDTH and nothing else.
   *
   * It used to be sized `min(100cqw, calc(100cqh - …))` inside a `flex: 1 1 auto` band, so its
   * width tracked the leftover HEIGHT. The ECO panel and the engine panel both change height on
   * every move — rows appear and vanish — so the board grew and shrank as you played, and because
   * height was the binding constraint it never filled the screen either. One cause, both symptoms.
   *
   * `MET.bandLayout` is the pure function that already encoded the right answer (and is asserted at
   * three screen sizes in both languages); it simply was not being called. The board is capped only
   * by a genuinely short viewport, never by what the bands below happen to contain — and the panels
   * band is `flex: 1 1 auto`, so it is the one that gives way.
   */
  function sizeBands() {
    if (!root) return;
    var box = root.getBoundingClientRect();
    if (!box.width || !box.height) return;      // detached, or the tab is not rendering
    var edge = MET.boardSize(box.width, window.devicePixelRatio || 2);
    var bands = MET.bandLayout(box.height, edge);
    root.style.setProperty('--an-board-edge', bands.board + 'px');
    root.style.setProperty('--an-panels-h', bands.panels + 'px');
  }

  /**
   * Every number the stylesheet needs, pushed across as custom properties. Same trick as
   * home.js:274-290, and the reason no measurement or arithmetic appears in the CSS.
   */
  function applyMetrics(node) {
    var B = MET.BANDS, P = MET.PALETTE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--an-bg', P.screenBg); set('--an-surface', P.surface);
    set('--an-surface-alt', P.surfaceAlt); set('--an-surface-alt2', P.surfaceAlt2);
    set('--an-divider', P.divider); set('--an-gold', P.gold); set('--an-on-gold', P.onGold);
    set('--an-text', P.textPrimary); set('--an-text-2', P.textSecondary);
    set('--an-text-muted', P.textMuted); set('--an-spinner', P.spinner);
    set('--an-eval-track', P.evalTrack); set('--an-eval-fill', P.evalFill);
    set('--an-success', P.success); set('--an-danger', P.danger);
    set('--an-header-h', B.headerBtnH + 'px');
    set('--an-header-pad-h', B.headerPaddingH + 'px');
    set('--an-header-pad-v', B.headerPaddingV + 'px');
    set('--an-header-btn-w', B.headerBtnW + 'px');
    set('--an-board-pad-top', B.boardPaddingTop + 'px');
    set('--an-status-h', B.statusMinHeight + 'px');
    set('--an-statusline-h', B.statusLineMinHeight + 'px');
    set('--an-statusline-pad-h', B.statusLinePaddingH + 'px');
    set('--an-statusline-pad-v', B.statusLinePaddingV + 'px');
    set('--an-status-pad-l', B.statusPaddingLeft + 'px');
    set('--an-tool-pad-h', B.toolBtnPaddingH + 'px');
    set('--an-tool-pad-v', B.toolBtnPaddingV + 'px');
    set('--an-tool-radius', B.toolBtnRadius + 'px');
    set('--an-tool-min-w', B.toolBtnMinWidth + 'px');
    set('--an-nav-pad-h', B.navBtnPaddingH + 'px');
    set('--an-nav-min-w', B.navBtnMinWidth + 'px');
    set('--an-autoplay-pad-v', B.autoplayPaddingV + 'px');
    set('--an-strip-h', B.stripMaxHeight + 'px');
    set('--an-strip-pad-h', B.stripPaddingH + 'px');
    set('--an-strip-pad-v', B.stripPaddingV + 'px');
    set('--an-strip-gap', B.stripGap + 'px');
    set('--an-panels-max', B.panelsMaxHeight + 'px');
    set('--an-panels-pad-h', B.panelsPaddingH + 'px');
    set('--an-engine-pad-h', B.enginePaddingH + 'px');
    set('--an-engine-pad-t', B.enginePaddingTop + 'px');
    set('--an-engine-pad-b', B.enginePaddingBottom + 'px');
    set('--an-eval-h', MET.EVAL_BAR.mainHeight + 'px');
    set('--an-eval-r', MET.EVAL_BAR.mainRadius + 'px');
    set('--an-micro-h', MET.EVAL_BAR.microHeight + 'px');
    set('--an-micro-r', MET.EVAL_BAR.microRadius + 'px');
    set('--an-eval-anim', MET.TIMINGS.evalBarAnimation + 'ms');
    // The board component ships its own default; this is the app's value, asserted like the rest.
    set('--piece-anim', MET.TIMINGS.pieceAnimation + 'ms cubic-bezier(.22,.61,.36,1)');
    // Typography — the real StyleSheet sizes, asserted against board_styles.json.
    var T2 = MET.TYPE;
    set('--an-fs-title', T2.headerTitle + 'px'); set('--an-fs-hbtn', T2.headerBtn + 'px');
    set('--an-fs-status', T2.status + 'px'); set('--an-fs-tool', T2.toolBtn + 'px');
    set('--an-fs-nav', T2.navBtn + 'px'); set('--an-fs-autoplay', T2.autoplayBar + 'px');
    set('--an-fs-num', T2.stripNum + 'px'); set('--an-fs-move', T2.stripMove + 'px');
    set('--an-fs-alt', T2.altChip + 'px');
    set('--an-fs-eeval', T2.engineEval + 'px'); set('--an-fs-esan', T2.engineSan + 'px');
    set('--an-fs-epv', T2.enginePv + 'px'); set('--an-fs-etext', T2.engineText + 'px');
    set('--an-fs-depth', T2.engineDepth + 'px'); set('--an-fs-opening', T2.engineOpening + 'px');
    set('--board-light', MET.BOARD_THEMES[boardTheme].light);
    set('--board-dark', MET.BOARD_THEMES[boardTheme].dark);
    // Review modal — every value from accModalStyles, via the metrics layer.
    var R = MET.REVIEW, G = MET.GRAPH_STYLE;
    set('--an-rv-scrim', R.scrim);
    set('--an-rv-pad-h', R.overlayPaddingH + 'px'); set('--an-rv-pad-v', R.overlayPaddingV + 'px');
    set('--an-rv-card-bg', MET.PALETTE.reviewCard);
    set('--an-rv-card-r', R.cardRadius + 'px');
    set('--an-rv-card-border', R.cardBorderColor);
    set('--an-rv-head-pt', R.headerPaddingTop + 'px');
    set('--an-rv-head-pb', R.headerPaddingBottom + 'px');
    set('--an-rv-head-ph', R.headerPaddingH + 'px');
    set('--an-rv-hairline', R.hairlineColor);
    set('--an-rv-title-fs', R.titleSize + 'px'); set('--an-rv-title-tr', R.titleTracking + 'px');
    set('--an-rv-body-pv', R.loadingPaddingV + 'px'); set('--an-rv-body-ph', R.loadingPaddingH + 'px');
    set('--an-rv-text-fs', R.loadingTextSize + 'px'); set('--an-rv-text-color', R.loadingTextColor);
    set('--an-rv-gap', R.loadingGap + 'px');
    set('--an-rv-hint-fs', R.hintSize + 'px'); set('--an-rv-hint-color', R.hintColor);
    set('--an-rv-skip-mt', R.skipMarginTop + 'px');
    set('--an-rv-skip-pv', R.skipPaddingV + 'px'); set('--an-rv-skip-ph', R.skipPaddingH + 'px');
    set('--an-rv-skip-r', R.skipRadius + 'px'); set('--an-rv-skip-border', R.skipBorderColor);
    set('--an-rv-skip-fs', R.skipTextSize + 'px'); set('--an-rv-skip-color', R.skipTextColor);
    set('--an-rv-content-ph', R.contentPaddingH + 'px');
    set('--an-rv-content-pt', R.contentPaddingTop + 'px');
    set('--an-rv-content-pb', R.contentPaddingBottom + 'px');
    set('--an-rv-section', R.sectionGap + 'px');
    set('--an-rv-player-fs', R.playerNameSize + 'px'); set('--an-rv-player-color', R.playerNameColor);
    set('--an-rv-player-gap', R.playerNameGap + 'px');
    set('--an-rv-score-fs', R.scoreSize + 'px'); set('--an-rv-score-lh', R.scoreLineHeight + 'px');
    set('--an-rv-slabel-fs', R.scoreLabelSize + 'px'); set('--an-rv-slabel-color', R.scoreLabelColor);
    set('--an-rv-slabel-tr', R.scoreLabelTracking + 'px');
    set('--an-rv-divider-h', R.dividerHeight + 'px'); set('--an-rv-divider-color', R.dividerColor);
    set('--an-rv-divider-mh', R.dividerMarginH + 'px');
    set('--an-rv-thead-pb', R.tableHeaderPaddingBottom + 'px');
    set('--an-rv-side-w', R.sideColumnWidth + 'px'); set('--an-rv-side-fs', R.sideLabelSize + 'px');
    set('--an-rv-side-color', R.sideLabelColor);
    set('--an-rv-row-pv', R.rowPaddingV + 'px'); set('--an-rv-row-rule', R.rowRuleColor);
    set('--an-rv-count-fs', R.countSize + 'px'); set('--an-rv-centre-gap', R.centreGap + 'px');
    set('--an-rv-dot', R.dotSize + 'px'); set('--an-rv-dot-r', R.dotRadius + 'px');
    set('--an-rv-name-fs', R.nameSize + 'px'); set('--an-rv-name-color', R.nameColor);
    set('--an-rv-foot-pad', R.footerPadding + 'px');
    set('--an-rv-btn-r', R.buttonRadius + 'px'); set('--an-rv-btn-pv', R.buttonPaddingV + 'px');
    set('--an-rv-btn-fs', R.buttonTextSize + 'px'); set('--an-rv-btn-tr', R.buttonTextTracking + 'px');
    set('--an-rv-graph-r', G.wrapRadius + 'px'); set('--an-rv-graph-bg', G.wrapBackground);
    set('--an-rv-graph-h', MET.GRAPH.height + 'px');
    // Save form + library — every value from saveModalStyles / loadModalStyles.
    var L = MET.LIBRARY;
    set('--an-bs-scrim', L.scrim); set('--an-bs-bg', L.sheetBg);
    set('--an-bs-r', L.sheetRadius + 'px'); set('--an-bs-pad', L.sheetPadding + 'px');
    set('--an-bs-head-gap', L.headerGap + 'px');
    set('--an-bs-title-fs', L.titleSize + 'px'); set('--an-bs-close-fs', L.closeSize + 'px');
    set('--an-bs-field-gap', L.fieldGap + 'px'); set('--an-bs-field-bg', L.fieldBg);
    set('--an-bs-field-r', L.fieldRadius + 'px');
    set('--an-bs-field-ph', L.fieldPaddingH + 'px'); set('--an-bs-field-pv', L.fieldPaddingV + 'px');
    set('--an-bs-field-fs', L.fieldSize + 'px');
    set('--an-bs-res-gap', L.resultGap + 'px'); set('--an-bs-res-mb', L.resultMarginBottom + 'px');
    set('--an-bs-res-pv', L.resultPaddingV + 'px'); set('--an-bs-res-r', L.resultRadius + 'px');
    set('--an-bs-res-fs', L.resultSize + 'px'); set('--an-bs-res-idle', L.resultIdle);
    set('--an-bs-chip-ph', L.chipPaddingH + 'px'); set('--an-bs-chip-pv', L.chipPaddingV + 'px');
    set('--an-bs-chip-r', L.chipRadius + 'px'); set('--an-bs-chip-gap', L.chipGap + 'px');
    set('--an-bs-chip-fs', L.chipSize + 'px'); set('--an-bs-chip-idle', L.chipIdle);
    set('--an-bs-btn-gap', L.buttonGap + 'px'); set('--an-bs-btn-mt', L.buttonMarginTop + 'px');
    set('--an-bs-btn-pv', L.buttonPaddingV + 'px'); set('--an-bs-btn-r', L.buttonRadius + 'px');
    set('--an-bs-btn-fs', L.buttonSize + 'px');
    set('--an-bs-cancel-bg', L.cancelBg); set('--an-bs-save-bg', L.saveBg);
    set('--an-lib-card-bg', L.cardBg); set('--an-lib-card-r', L.cardRadius + 'px');
    set('--an-lib-card-pad', L.cardPadding + 'px'); set('--an-lib-card-gap', L.cardGap + 'px');
    set('--an-lib-primary-fs', L.primarySize + 'px'); set('--an-lib-primary-gap', L.primaryGap + 'px');
    set('--an-lib-pgn-fs', L.pgnSize + 'px'); set('--an-lib-pgn-color', L.pgnColor);
    set('--an-lib-meta-fs', L.metaSize + 'px'); set('--an-lib-meta-color', L.metaColor);
    set('--an-lib-meta-gap', L.metaGap + 'px');
    set('--an-lib-action', L.actionSize + 'px'); set('--an-lib-action-r', L.actionRadius + 'px');
    set('--an-lib-action-bg', L.actionBg);
    // ☰ sidebar — sidebarStyles. The width is a RATIO of the screen, never the folded literal.
    var MN = MET.MENU;
    set('--an-mn-scrim', MN.scrim); set('--an-mn-bg', MN.bg);
    set('--an-mn-width', (MN.widthRatio * 100) + '%');
    set('--an-mn-border', MN.borderColor); set('--an-mn-border-w', MN.borderWidth + 'px');
    set('--an-mn-head-ph', MN.headerPaddingH + 'px');
    set('--an-mn-head-pt', MN.headerPaddingTop + 'px');
    set('--an-mn-head-pb', MN.headerPaddingBottom + 'px');
    set('--an-mn-title-fs', MN.titleSize + 'px'); set('--an-mn-title-color', MN.titleColor);
    set('--an-mn-title-tr', MN.titleTracking + 'px');
    set('--an-mn-close', MN.closeSize + 'px'); set('--an-mn-close-r', MN.closeRadius + 'px');
    set('--an-mn-close-bg', MN.closeBg); set('--an-mn-close-fs', MN.closeGlyphSize + 'px');
    set('--an-mn-sect-fs', MN.sectionSize + 'px'); set('--an-mn-sect-color', MN.sectionColor);
    set('--an-mn-sect-tr', MN.sectionTracking + 'px');
    set('--an-mn-sect-pt', MN.sectionPaddingTop + 'px');
    set('--an-mn-sect-pb', MN.sectionPaddingBottom + 'px');
    set('--an-mn-item-pv', MN.itemPaddingV + 'px'); set('--an-mn-item-ph', MN.itemPaddingH + 'px');
    set('--an-mn-icon-fs', MN.iconSize + 'px'); set('--an-mn-icon-w', MN.iconWidth + 'px');
    set('--an-mn-label-fs', MN.labelSize + 'px'); set('--an-mn-label-color', MN.labelColor);
    set('--an-mn-dot', MN.dotSize + 'px'); set('--an-mn-dot-idle', MN.dotIdle);
    set('--an-mn-dot-on', MN.dotActive);
    // Setup Position — the 28 `edit*` keys.
    var ED = MET.EDIT;
    set('--an-ed-bg', ED.panelBg); set('--an-ed-r', ED.panelRadius + 'px');
    set('--an-ed-pad', ED.panelPadding + 'px');
    set('--an-ed-title-fs', ED.titleSize + 'px'); set('--an-ed-title-color', ED.titleColor);
    set('--an-ed-hint-fs', ED.hintSize + 'px'); set('--an-ed-hint-color', ED.hintColor);
    set('--an-ed-title-gap', ED.titleRowGap + 'px');
    set('--an-ed-pal-gap', ED.paletteGap + 'px'); set('--an-ed-pal-row-gap', ED.paletteRowGap + 'px');
    set('--an-ed-btn', ED.pieceBtn + 'px'); set('--an-ed-btn-r', ED.pieceBtnRadius + 'px');
    set('--an-ed-piece', ED.piece + 'px');
    set('--an-ed-light', ED.lightSquare); set('--an-ed-dark', ED.darkSquare);
    set('--an-ed-active-bw', ED.activeBorder + 'px');
    set('--an-ed-active-bc', ED.activeBorderColor); set('--an-ed-active-fill', ED.activeFill);
    set('--an-ed-act-gap', ED.actionGap + 'px'); set('--an-ed-act-pv', ED.actionPaddingV + 'px');
    set('--an-ed-act-r', ED.actionRadius + 'px'); set('--an-ed-act-bg', ED.actionBg);
    set('--an-ed-act-fs', ED.actionSize + 'px'); set('--an-ed-act-color', ED.actionColor);
    set('--an-ed-erase-bg', ED.eraseActiveBg); set('--an-ed-erase-color', ED.eraseActiveText);
    set('--an-ed-turn-dark-bg', ED.turnDarkBg); set('--an-ed-turn-dark-color', ED.turnDarkText);
    set('--an-ed-turn-light-color', ED.turnLightText);
    set('--an-ed-cas-lbl-fs', ED.castlingLabelSize + 'px');
    set('--an-ed-cas-lbl-color', ED.castlingLabelColor);
    set('--an-ed-cas-tr', ED.castlingTracking + 'px'); set('--an-ed-cas-gap', ED.castlingGap + 'px');
    set('--an-ed-cas-pv', ED.castlingPaddingV + 'px'); set('--an-ed-cas-r', ED.castlingRadius + 'px');
    set('--an-ed-cas-bg', ED.castlingBg); set('--an-ed-cas-fs', ED.castlingSize + 'px');
    set('--an-ed-cas-color', ED.castlingColor); set('--an-ed-cas-on-bg', ED.castlingOnBg);
    set('--an-ed-cas-on-bc', ED.castlingOnBorder); set('--an-ed-cas-on-color', ED.castlingOnColor);
    set('--an-ed-err', ED.errorColor); set('--an-ed-err-fs', ED.errorSize + 'px');
    set('--an-ed-done-bg', ED.doneBg); set('--an-ed-done-pv', ED.donePaddingV + 'px');
    set('--an-ed-done-r', ED.doneRadius + 'px'); set('--an-ed-done-color', ED.doneColor);
    set('--an-ed-done-fs', ED.doneSize + 'px'); set('--an-ed-done-tr', ED.doneTracking + 'px');
    set('--an-ed-fen-gap', ED.fenGap + 'px'); set('--an-ed-fen-bg', ED.fenBg);
    set('--an-ed-fen-r', ED.fenRadius + 'px'); set('--an-ed-fen-ph', ED.fenPaddingH + 'px');
    set('--an-ed-fen-pv', ED.fenPaddingV + 'px'); set('--an-ed-fen-color', ED.fenColor);
    set('--an-ed-fen-fs', ED.fenSize + 'px');
    set('--an-ed-load-bc', ED.loadBorder); set('--an-ed-load-color', ED.loadColor);
    set('--an-ed-load-ph', ED.loadPaddingH + 'px'); set('--an-ed-load-fs', ED.loadSize + 'px');
    // Import PGN, the branch picker, the variation card and the annotation picker.
    var MO = MET.MODALS;
    set('--an-md-pgn-scrim', MO.pgnScrim); set('--an-md-pgn-bg', MO.pgnBg);
    set('--an-md-pgn-r', MO.pgnRadius + 'px'); set('--an-md-pgn-pad', MO.pgnPadding + 'px');
    set('--an-md-pgn-in-bg', MO.pgnInputBg); set('--an-md-pgn-in-r', MO.pgnInputRadius + 'px');
    set('--an-md-pgn-in-min', MO.pgnInputMinHeight + 'px');
    set('--an-md-pgn-in-max', MO.pgnInputMaxHeight + 'px');
    set('--an-md-pgn-in-fs', MO.pgnInputSize + 'px'); set('--an-md-pgn-in-color', MO.pgnInputColor);
    set('--an-md-pgn-in-pad', MO.pgnInputPadding + 'px');
    set('--an-md-opt-bg', MO.optionBg); set('--an-md-opt-r', MO.optionRadius + 'px');
    set('--an-md-opt-pv', MO.optionPaddingV + 'px'); set('--an-md-opt-ph', MO.optionPaddingH + 'px');
    set('--an-md-opt-bw', MO.optionBorderWidth + 'px'); set('--an-md-opt-bc', MO.optionBorderColor);
    set('--an-md-opt-main-bc', MO.optionMainBorder); set('--an-md-opt-main-bg', MO.optionMainBg);
    set('--an-md-opt-fs', MO.optionMoveSize + 'px'); set('--an-md-opt-prev-fs', MO.optionPreviewSize + 'px');
    set('--an-md-var-bg', MO.varSheetBg); set('--an-md-var-r', MO.varSheetRadius + 'px');
    set('--an-md-var-hw', MO.varHandleW + 'px'); set('--an-md-var-hh', MO.varHandleH + 'px');
    set('--an-md-var-main', MO.varMainColor); set('--an-md-var-sub', MO.varSubColor);
    set('--an-md-var-main-bg', MO.varMainBg); set('--an-md-var-sub-bg', MO.varSubBg);
    set('--an-md-var-del', MO.varDeleteColor); set('--an-md-var-del-bg', MO.varDeleteBg);
    set('--an-md-var-pv', MO.varActionPaddingV + 'px'); set('--an-md-var-ar', MO.varActionRadius + 'px');
    set('--an-md-var-gap', MO.varActionGap + 'px');
    set('--an-md-var-fs', MO.varTitleSize + 'px'); set('--an-md-var-sub-fs', MO.varSubtitleSize + 'px');
    set('--an-md-pick-bg', MO.pickerBg); set('--an-md-pick-r', MO.pickerRadius + 'px');
    set('--an-md-pick-pad', MO.pickerPadding + 'px');
    set('--an-md-grid-gap', MO.gridGap + 'px'); set('--an-md-grid-mb', MO.gridMarginBottom + 'px');
    set('--an-md-btn-w', MO.btnW + 'px'); set('--an-md-btn-h', MO.btnH + 'px');
    set('--an-md-btn-r', MO.btnRadius + 'px'); set('--an-md-btn-bg', MO.btnBg);
    set('--an-md-label-color', MO.labelColor); set('--an-md-label-gap', MO.labelGap + 'px');
    set('--an-md-clear-bg', MO.clearBg); set('--an-md-clear-r', MO.clearRadius + 'px');
    set('--an-md-clear-pv', MO.clearPaddingV + 'px'); set('--an-md-clear-color', MO.clearColor);
    set('--an-md-clear-fs', MO.clearSize + 'px');
    set('--an-md-sect-color', MO.sectionColor); set('--an-md-sect-tr', MO.sectionTracking + 'px');
    set('--an-md-sect-mt', MO.sectionMarginTop + 'px'); set('--an-md-sect-mb', MO.sectionMarginBottom + 'px');
    set('--an-fs-pick-title', T2.annotationPickerTitle + 'px');
    set('--an-fs-pick-sym', T2.annotationSymbol + 'px');
    set('--an-fs-pick-label', T2.annotationLabel + 'px');
    set('--an-fs-pick-sect', T2.annotationSection + 'px');
  }

  // ---- painting --------------------------------------------------------------
  // Each band repaints independently; nothing rebuilds the whole screen.

  function paintBoard(animate) {
    ui.board.flipped = session.flipped;
    if (editing) { paintEditor(); return; }   // the editor owns the board while it is open
    var pos = position(session);
    ui.board.setPosition(E.toFEN(pos), {
      animate: animate !== false,
      lastMove: lastMove(session),
      check: checkSquare(session)
    });
    ui.board.interactive = !session.autoplaying;
    paintArrows();
    paintBadge();
  }
  /** Engine arrows are hidden while editing and behind the ☰ Settings toggle (board.tsx:2592). */
  function paintArrows() {
    ui.board.arrows = (showArrows && !editing) ? arrows(session) : [];
  }

  /**
   * The manual-annotation badge (renderAnnotationOverlay:2666): one circle on the square the
   * current move landed on. BOTTOM-right of the centre — see AnalysisBadge, whose sign this
   * rebuild had backwards until the extractor started pinning it.
   */
  function paintBadge() {
    var layer = ui.badge;
    layer.innerHTML = '';
    var sym = annotationSymbol(session, session.tree.current.id);
    var sq = annotationSquare(session);
    if (!sym || sq == null) { layer.style.display = 'none'; return; }
    var style = MET.MOVE_ANNOTATIONS.filter(function (a) { return a.symbol === sym; })[0];
    if (!style) { layer.style.display = 'none'; return; }
    layer.style.display = '';
    // Unlike the arrows, the badge CANNOT use a one-unit-per-square viewBox. Its geometry mixes
    // ratios of a square (radius 0.21, offset 0.29) with ABSOLUTE point offsets (the 1.5pt shadow
    // and the 1.5pt ring). In a unit box those 1.5s become one and a half SQUARES — the ring came
    // out eight times the badge. So the viewBox is the board's real pixel edge and every constant
    // is in the same units, exactly as the RN original draws it.
    var edge = layer.getBoundingClientRect().width;
    if (!edge) { layer.style.display = 'none'; return; }
    var g = MET.badgeGeometry(sq, edge / 8, session.flipped, sym.length);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + edge + ' ' + edge);
    function add(tag, attrs) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]); }
      svg.appendChild(n);
      return n;
    }
    add('circle', { cx: g.shadowCenter.x, cy: g.shadowCenter.y, r: g.radius, fill: 'rgba(0,0,0,0.45)' });
    add('circle', { cx: g.center.x, cy: g.center.y, r: g.ringRadius, fill: 'white', opacity: '0.9' });
    add('circle', { cx: g.center.x, cy: g.center.y, r: g.radius, fill: style.color });
    var t = add('text', {
      x: g.center.x, y: g.textBaseline, 'text-anchor': 'middle',
      fill: 'white', 'font-size': g.fontSize, 'font-weight': 'bold'
    });
    t.textContent = sym;
    layer.appendChild(svg);
  }

  function paintEval() {
    ui.evalFill.style.width = (evalFraction(session) * 100) + '%';
    ui.microFill.style.width = (evalFraction(session) * 100) + '%';
  }

  function paintStatus() {
    ui.status.innerHTML = esc(statusText(session)).replace(/\n/g, '<br>');
    ui.spinner.style.visibility = session.analyzing ? 'visible' : 'hidden';
    ui.tools.engine.classList.toggle('on', session.autoAnalyze);
    ui.tools.annotate.disabled = session.tree.current === session.tree.root;
    ui.tools.autoplay.classList.toggle('on', session.autoplaying);
    ui.tools.autoplay.textContent = session.autoplaying ? '⏸' : '▶';
    ui.autoplayBar.style.display = session.autoplaying ? 'block' : 'none';
    ui.autoplayBar.textContent = 'Speed: ' + speedLabel() + ' — tap to change';
  }
  function speedLabel() {
    var s = MET.AUTOPLAY_SPEEDS.filter(function (x) { return x.value === autoplaySpeed; })[0];
    return s ? s.label : autoplaySpeed + 'ms';
  }

  function paintStrip() {
    var toks = stripTokens(session);
    ui.strip.innerHTML = '';
    if (!toks.length) {
      ui.strip.appendChild(el('span', 'an-strip-empty', 'Play a move to start a line'));
      return;
    }
    var activeEl = null;
    toks.forEach(function (t) {
      if (t.kind === 'num') { ui.strip.appendChild(el('span', 'an-num', esc(t.text))); return; }
      var cls = t.kind === 'alt' ? 'an-alt' : 'an-move';
      if (t.active) cls += ' active';
      else if (t.onPath) cls += ' onpath';
      var b = el('button', cls, esc(t.text));
      // A reviewed move carries its tier's symbol, 9pt, right after the SAN (board.tsx:3092).
      // `good` has an empty symbol on purpose, so guard on the string, not on the key.
      var style = t.classification ? MET.CLASSIFICATIONS[t.classification] : null;
      if (style && style.symbol) {
        var mark = el('span', 'an-cls', esc(style.symbol));
        mark.style.color = style.color;
        b.appendChild(mark);
      }
      b.onclick = function () { gotoId(t.id); };
      // Long-press: a main-line move opens the annotation picker; a branch chip opens the
      // variation card. Same 400ms the source's six delayLongPress props use.
      attachLongPress(b, t.kind === 'alt'
        ? function () { showVariationCard(t.id); }
        : function () { showAnnotationPicker(t.id); });
      ui.strip.appendChild(b);
      if (t.active) activeEl = b;
    });
    // Keep the cursor in view, the way MoveRibbon does in the Swift twin.
    if (activeEl && activeEl.scrollIntoView) {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function paintEngine() {
    var rows = engineRows(session);
    ui.rows.innerHTML = '';
    if (!rows.length) {
      var msg = session.analyzing ? 'Analyzing…'
        : (outcome(session).kind !== 'ongoing' ? terminalText() : 'Engine off');
      ui.rows.appendChild(el('div', 'an-erow-empty', esc(msg)));
    } else {
      rows.forEach(function (r) {
        var row = el('button', 'an-erow');
        var ev = el('span', 'an-eeval', esc(r.evalText));
        var san = el('span', 'an-esan', esc(r.san));
        san.style.color = MET.arrowColor(r.rank);
        var pv = el('span', 'an-epv', esc(r.continuation));
        row.appendChild(ev); row.appendChild(san); row.appendChild(pv);
        row.onclick = function () { playUciMove(r.uci); };
        ui.rows.appendChild(row);
      });
    }
    var depth = session.snapshot ? session.snapshot.depth : 0;
    ui.depth.textContent = 'd:' + depth + (session.analyzing ? '…' : '');
    var op = openingText(session);
    ui.opening.textContent = op || '';
    ui.opening.style.display = op ? '' : 'none';
    var sym = evalSymbol(session);
    ui.symbol.textContent = sym || '';
  }
  function terminalText() {
    var o = outcome(session);
    if (o.kind === 'checkmate') return '# Checkmate';
    if (o.kind === 'draw') return '= ' + (o.reason === 'stalemate' ? 'Stalemate' : 'Draw');
    return '';
  }

  function paintPanels() {
    var conts = bookContinuations(session);
    ui.panels.innerHTML = '';
    var head = el('div', 'an-panel-head', 'Opening book');
    ui.panels.appendChild(head);
    if (!conts.length) {
      ui.panels.appendChild(el('div', 'an-panel-empty', 'Out of book — no ECO continuations here.'));
      return;
    }
    conts.forEach(function (c) {
      var row = el('button', 'an-brow');
      row.appendChild(el('span', 'an-bsan', esc(c.san)));
      row.appendChild(el('span', 'an-beco', esc(c.eco || '')));
      row.appendChild(el('span', 'an-bname', esc(c.name || '')));
      row.onclick = function () { playSanMove(c.san); };
      ui.panels.appendChild(row);
    });
  }

  function paintAll(animate) {
    root.classList.toggle('editing', editing);
    paintBoard(animate); paintEval(); paintStatus(); paintStrip(); paintEngine();
    if (editing) renderEditPanel(ui.panels); else paintPanels();
  }

  // ---- the engine loop --------------------------------------------------------

  /** Abandon anything in flight and, if the position wants analysis, debounce a fresh search. */
  function scheduleAnalysis() {
    clearTimeout(debounceTimer);
    engineToken += 1;                       // invalidates any running search
    session.analyzing = false;
    if (!wantsAnalysis(session)) { paintStatus(); paintEngine(); return; }
    // Never start a search while a piece is still sliding. On the worker path this is belt and
    // braces; from file:// the search runs in-thread and a chunk landing mid-slide is exactly the
    // stutter this whole change is about.
    debounceTimer = setTimeout(runAnalysis,
      Math.max(MET.TIMINGS.analysisDebounce, MET.TIMINGS.pieceAnimation));
  }

  /**
   * One progressive search. The deadline lives inside `shouldCancel`, which is what bounds wall
   * time — a fixed depth cannot, because cost varies ~15x across position types.
   *
   * The original dropped a position change that arrived mid-request (board.tsx:885). Here the token
   * makes the stale search abandon its results, and `scheduleAnalysis` starts a new one.
   */
  function runAnalysis() {
    if (!alive()) return;
    var token = (engineToken += 1);
    var pos = position(session);
    var keys = historyKeys(session);
    var deadline = Date.now() + MET.TIMINGS.engineDeadline;
    session.analyzing = true;
    paintStatus(); paintEngine();
    // Through the host: a Worker when the page is served, sliced in-thread from file://. Same
    // options, same onDepth, same resolved snapshot — see web-demo/js/engine-host.js.
    HOST.analyzeProgressive(pos, {
      maxDepth: MET.ENGINE_LIMITS.maxDepth,
      multiPV: MET.ENGINE_LIMITS.multiPV,
      historyKeys: keys,
      shouldCancel: function () { return token !== engineToken || Date.now() > deadline; },
      onDepth: function (snap) {
        if (token !== engineToken || !alive()) return;
        session.snapshot = snap;
        paintEngine(); paintEval(); paintArrows();
      }
    }).then(function (snap) {
      if (token !== engineToken || !alive()) return;
      session.analyzing = false;
      if (snap) session.snapshot = snap;
      paintStatus(); paintEngine(); paintEval(); paintArrows();
    });
  }

  // ---- interaction -------------------------------------------------------------

  function afterMove(animate) { paintAll(animate); scheduleAnalysis(); scheduleDraft(); }

  function onBoardMove(e) {
    if (editing) return;                        // edit-mode taps arrive via square-select
    var pos = position(session);
    var m = findMove(pos, e.detail.from, e.detail.to, e.detail.promotion);
    if (!m) return;
    var mover = pos.squares[m.from];
    var castle = mover.kind === E.KING && Math.abs((m.to & 7) - (m.from & 7)) === 2;
    var capture = pos.squares[m.to] != null || (mover.kind === E.PAWN && m.to === pos.enPassant);
    if (!play(session, m)) return;
    if (SND) SND.playForMove({ status: E.status(position(session)), capture: capture, castle: castle });
    afterMove(true);
  }
  function playUciMove(uci) { if (uci && playUci(session, uci)) afterMove(true); }
  function playSanMove(san) { if (san && playSan(session, san)) afterMove(true); }

  function gotoId(id) {
    var found = null;
    (function walk(n) {
      if (found) return;
      if (n.id === id) { found = n; return; }
      n.children.forEach(walk);
    })(session.tree.root);
    if (found) { goToNode(session, found); afterMove(true); }
  }

  function stepForward() {
    var opts = forwardOptions(session);
    if (!opts.length) return;
    if (opts.length === 1) { goForward(session, 0); afterMove(true); return; }
    showBranchPicker(opts);
  }

  /** goForward with several children has to ask which (board.tsx:1506-1516). */
  function showBranchPicker(opts) {
    var sheet = el('div', 'an-sheet');
    var card = el('div', 'an-sheet-card');
    card.appendChild(el('div', 'an-sheet-title', 'Which continuation?'));
    opts.forEach(function (n, i) {
      var b = el('button', 'an-sheet-btn' + (i === 0 ? ' main' : ''),
        esc(n.san) + (i === 0 ? ' <span class="an-sheet-tag">main line</span>' : ''));
      b.onclick = function () { sheet.remove(); goForward(session, i); afterMove(true); };
      card.appendChild(b);
    });
    var cancel = el('button', 'an-sheet-btn cancel', 'Cancel');
    cancel.onclick = function () { sheet.remove(); };
    card.appendChild(cancel);
    sheet.appendChild(card);
    sheet.onclick = function (ev) { if (ev.target === sheet) sheet.remove(); };
    root.appendChild(sheet);
  }

  function toggleAutoplay() {
    session.autoplaying = !session.autoplaying;
    clearTimeout(autoplayTimer);
    if (session.autoplaying) { scheduleAnalysis(); stepAutoplay(); }
    paintAll(false);
  }
  function stepAutoplay() {
    autoplayTimer = setTimeout(function () {
      if (!alive() || !session.autoplaying) return;
      var opts = forwardOptions(session);
      if (!opts.length) { session.autoplaying = false; paintAll(false); scheduleAnalysis(); return; }
      goForward(session, 0);                       // autoplay always follows the main line
      session.autoplaying = true;
      paintAll(true);
      stepAutoplay();
    }, autoplaySpeed);
  }
  function cycleSpeed() {
    var vals = MET.AUTOPLAY_SPEEDS.map(function (s) { return s.value; });
    autoplaySpeed = vals[(vals.indexOf(autoplaySpeed) + 1) % vals.length];
    paintStatus();
  }

  // ---- the screen ---------------------------------------------------------------

  /** Leaf renderer: owns its own clear of #view, per the contract in docs/web-demo.md. */
  function render(view, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');          // this screen owns the whole box; no gutter, no scroll

    if (!session) session = createSession();
    engineToken += 1;
    reviewToken += 1;                      // abandon a review that was running when we left
    clearTimeout(debounceTimer); clearTimeout(autoplayTimer); clearTimeout(draftTimer);
    session.analyzing = false;
    session.autoplaying = false;
    session.reviewProgress = null;
    editing = false; editor = null; editorPiece = null;   // never resume mid-edit on re-entry

    root = el('div', 'an-view');
    applyMetrics(root);

    // 1 — header
    var header = el('div', 'an-header');
    var back = el('button', 'an-hbtn', '←');
    back.onclick = function () { engineToken += 1; if (onExit) onExit(); };
    var menu = el('button', 'an-hbtn', '☰');
    menu.onclick = showMenu;
    menu.title = 'Menu';
    header.appendChild(back);
    header.appendChild(el('div', 'an-title', 'Analysis Board'));
    header.appendChild(menu);
    root.appendChild(header);

    // 2 — board + the main eval bar (a spec addition; the RN render has none)
    var boardBand = el('div', 'an-board');
    var board = document.createElement('chess-board');
    board.setAttribute('coordinates', 'true');
    board.rules = rulesAdapter;
    board.draggablePieces = true;
    board.flipped = session.flipped;
    board.addEventListener('move', onBoardMove);
    // Every square, legal or not — Setup Position needs the raw tap (see chess-board.js).
    board.addEventListener('tap', function (e) { if (editing) onEditSquare(e.detail.square); });
    var boardStack = el('div', 'an-board-stack');
    boardStack.appendChild(board);
    var badge = el('div', 'an-badge');           // the manual-annotation circle, pointer-events:none
    badge.style.display = 'none';
    boardStack.appendChild(badge);
    boardBand.appendChild(boardStack);
    var evalBar = el('div', 'an-eval', '<div class="fill"></div>');
    boardBand.appendChild(evalBar);
    root.appendChild(boardBand);

    // 3 — the status line, then the toolbar.
    //
    // TWO ROWS, not the source's one. Nine emoji buttons measure 346px in a 365px card, leaving the
    // status ~19px — it simply vanished. RN's icon glyphs are narrower than emoji, which is why the
    // source got away with `statusToolbarRow`. The values come from `styles.statusLine`, a block the
    // source declares for exactly this standalone row and then never renders. Deviation recorded.
    var statusLine = el('div', 'an-statusline');
    var statusText_ = el('div', 'an-status-text');
    var spinner = el('span', 'an-spin');
    statusLine.appendChild(statusText_); statusLine.appendChild(spinner);
    root.appendChild(statusLine);

    var statusBand = el('div', 'an-status');
    var tools = el('div', 'an-tools');
    function tool(cls, label, title, fn) {
      var b = el('button', cls, label);
      b.title = title; b.onclick = fn;
      tools.appendChild(b);
      return b;
    }
    tool('an-tool', '📂', 'Saved analyses', renderLibrarySheet);
    // The source's ✏️ annotates the CURRENT move (board.tsx:4626); Edit Board is a ☰ item only.
    var tAnnotate = tool('an-tool', '✏️', 'Annotate this move', function () {
      if (session.tree.current === session.tree.root) return;   // the source disables it at the root
      showAnnotationPicker(session.tree.current.id);
    });
    var tEngine = tool('an-tool', '💡', 'Toggle the engine', function () {
      session.autoAnalyze = !session.autoAnalyze;
      if (!session.autoAnalyze) session.snapshot = null;
      scheduleAnalysis(); paintAll(false);
    });
    var tFlip = tool('an-tool', '🔄', 'Flip the board', function () {
      session.flipped = !session.flipped; paintBoard(false);
    });
    var tAuto = tool('an-tool', '▶', 'Autoplay the main line', toggleAutoplay);
    tool('an-nav', '⏮', 'Start', function () { goToStart(session); afterMove(false); });
    tool('an-nav', '◀', 'Back', function () { goBack(session); afterMove(true); });
    tool('an-nav', '▶', 'Forward', stepForward);
    tool('an-nav', '⏭', 'End', function () { goToEnd(session); afterMove(false); });
    statusBand.appendChild(tools);
    root.appendChild(statusBand);

    // 4 — autoplay speed bar
    var autoplayBar = el('div', 'an-autoplay');
    autoplayBar.onclick = cycleSpeed;
    root.appendChild(autoplayBar);

    // 5 — the move strip
    var strip = el('div', 'an-strip');
    root.appendChild(strip);

    // 6 — panels (the ECO explorer, where the Lichess masters panel used to be)
    var panels = el('div', 'an-panels');
    root.appendChild(panels);

    // 7 — engine lines
    var engine = el('div', 'an-engine');
    var micro = el('div', 'an-micro', '<div class="fill"></div>');
    var rows = el('div', 'an-rows');
    var info = el('div', 'an-info');
    var depth = el('span', 'an-depth', 'd:0');
    var symbol = el('span', 'an-symbol');
    var opening = el('span', 'an-opening');
    info.appendChild(depth); info.appendChild(symbol); info.appendChild(opening);
    engine.appendChild(micro); engine.appendChild(rows); engine.appendChild(info);
    root.appendChild(engine);

    view.appendChild(root);

    ui = {
      board: board, evalFill: evalBar.querySelector('.fill'),
      microFill: micro.querySelector('.fill'),
      status: statusText_, statusLine: statusLine, spinner: spinner, autoplayBar: autoplayBar,
      strip: strip, panels: panels, rows: rows, depth: depth, opening: opening, symbol: symbol,
      badge: badge,
      tools: { engine: tEngine, flip: tFlip, autoplay: tAuto, annotate: tAnnotate },
      reviewSheet: null, reviewFill: null, reviewCount: null,
      sheet: null, menu: null,
      editErr: null, editTurn: null, editCastle: null, editPalette: null
    };

    // The board's size, once the tree is in the document and can be measured.
    sizeBands();
    // Re-fit on resize and on a device-picker change. Self-cancelling by the `home.js:406` idiom:
    // once the screen is gone the listener removes itself, so leaving and re-entering does not
    // stack them up.
    var onResize = function () {
      if (!alive()) { window.removeEventListener('resize', onResize); return; }
      sizeBands();
    };
    window.addEventListener('resize', onResize);

    // Silent draft restore, exactly as the source does — no prompt (board.tsx:795).
    if (!restoredOnce) { restoredOnce = true; restoreDraft(); }
    paintAll(false);
    scheduleAnalysis();
    return root;
  }

  // ---- game review ------------------------------------------------------------
  // The original splits this across two half-featured paths: `runAccuracyAnalysis` (board.tsx:2254)
  // shows the modal but discards `move_evaluations`, so the strip stays blank; `handleAnalyzeGame`
  // (:1854) stamps the strip but shows only an Alert, with no graph and no cancel. One action here
  // does both — a deliberate deviation, recorded in PORTING_NOTES.

  var reviewToken = 0;

  function startReview() {
    var gamePlan = V.plan(session.tree);
    if (gamePlan.positions.length < 3) {          // the source's only guard (board.tsx:2256)
      showReviewSheet({ state: 'short' });
      return;
    }
    var token = (reviewToken += 1);
    // A review and a live search would fight over the same main thread. Stop the engine first.
    engineToken += 1;
    clearTimeout(debounceTimer);
    session.analyzing = false;
    applyReview(session, null, []);               // a rerun starts from nothing
    session.reviewProgress = { completed: 0, total: gamePlan.positions.length };
    paintAll(false);
    showReviewSheet({ state: 'running' });

    V.reviewProgressive(gamePlan, {
      maxDepth: MET.ENGINE_LIMITS.maxDepth,
      budgetMs: MET.TIMINGS.reviewDeadline,
      shouldCancel: function () { return token !== reviewToken || !alive(); },
      onProgress: function (completed, total) {
        if (token !== reviewToken || !alive()) return;
        session.reviewProgress = { completed: completed, total: total };
        updateReviewProgress();
      }
    }).then(function (res) {
      if (token !== reviewToken || !alive()) return;
      session.reviewProgress = null;
      // A short array means cancelled, never a truncated game — so nothing is stamped. Skip already
      // closed the sheet (it bumps the token, so this branch is the defensive path, not the usual
      // one); the RN "Skip Analysis" likewise just dismisses.
      if (!res.complete) { applyReview(session, null, []); hideReviewSheet(); return; }
      var annotated = V.finish(gamePlan, res.evaluations, BOOK.bookPlies(gamePlan.keys));
      applyReview(session, annotated, gamePlan.nodes);
      paintStrip();
      showReviewSheet({ state: 'done' });
      scheduleAnalysis();                          // the live engine can resume now
    });
  }

  function cancelReview() {
    reviewToken += 1;
    session.reviewProgress = null;
    applyReview(session, null, []);
    hideReviewSheet();
    paintAll(false);
    scheduleAnalysis();
  }

  function updateReviewProgress() {
    if (!ui.reviewFill || !session.reviewProgress) return;
    var p = session.reviewProgress;
    var pct = p.total ? (p.completed / p.total) * 100 : 0;
    ui.reviewFill.style.width = pct + '%';
    ui.reviewCount.textContent = p.completed + ' / ' + p.total + ' positions';
  }

  function hideReviewSheet() {
    if (ui && ui.reviewSheet && ui.reviewSheet.parentNode) ui.reviewSheet.remove();
    if (ui) { ui.reviewSheet = null; ui.reviewFill = null; ui.reviewCount = null; }
  }

  /** The accuracy modal: running / done / cancelled / too-short. */
  function showReviewSheet(opts) {
    hideReviewSheet();
    var R = MET.REVIEW;
    var sheet = el('div', 'an-rv');
    var card = el('div', 'an-rv-card');
    card.style.maxHeight = MET.cardMaxHeight(root.getBoundingClientRect().height) + 'px';
    card.appendChild(el('div', 'an-rv-head', 'Game Analysis'));

    if (opts.state === 'running') {
      var body = el('div', 'an-rv-body');
      body.appendChild(el('div', 'an-rv-text', 'Analyzing game…'));
      var count = el('div', 'an-rv-hint', '0 / 0 positions');
      body.appendChild(count);
      var track = el('div', 'an-rv-track', '<div class="fill"></div>');
      body.appendChild(track);
      var skip = el('button', 'an-rv-skip', 'Skip Analysis');
      skip.onclick = cancelReview;
      body.appendChild(skip);
      card.appendChild(body);
      ui.reviewFill = track.querySelector('.fill');
      ui.reviewCount = count;
    } else if (opts.state === 'done') {
      card.appendChild(reviewResults());
      var foot = el('div', 'an-rv-foot');
      var close = el('button', 'an-rv-btn', 'Done');
      close.onclick = hideReviewSheet;
      foot.appendChild(close);
      card.appendChild(foot);
    } else {
      // The only other reachable state: too few moves to review (board.tsx:2256 guards the same way).
      var b2 = el('div', 'an-rv-body');
      b2.appendChild(el('div', 'an-rv-text', 'Not enough moves'));
      b2.appendChild(el('div', 'an-rv-hint', 'Play or import at least two moves before reviewing.'));
      var ok = el('button', 'an-rv-skip', 'Close');
      ok.onclick = hideReviewSheet;
      b2.appendChild(ok);
      card.appendChild(b2);
    }

    sheet.appendChild(card);
    sheet.onclick = function (e) { if (e.target === sheet && opts.state !== 'running') hideReviewSheet(); };
    root.appendChild(sheet);
    ui.reviewSheet = sheet;
    if (opts.state === 'running') updateReviewProgress();
    void R;
  }

  /** Scores, the eval graph, and the classification table. */
  function reviewResults() {
    var sum = reviewSummary(session);
    var wrap = el('div', 'an-rv-scroll');
    if (!sum) return wrap;

    var scores = el('div', 'an-rv-scores');
    [['White', sum.whiteAccuracy], ['Black', sum.blackAccuracy]].forEach(function (pair, i) {
      if (i === 1) scores.appendChild(el('div', 'an-rv-div'));
      var col = el('div', 'an-rv-col');
      col.appendChild(el('div', 'an-rv-player', pair[0]));
      var v = el('div', 'an-rv-score', pair[1].toFixed(1) + '%');
      v.style.color = MET.accuracyColor(pair[1]);
      col.appendChild(v);
      col.appendChild(el('div', 'an-rv-scorelabel', 'Accuracy'));
      scores.appendChild(col);
    });
    wrap.appendChild(scores);

    if (sum.graph.length > 1) {
      var gw = el('div', 'an-rv-graph');
      gw.appendChild(evalGraphSvg(sum.graph));
      wrap.appendChild(gw);
    }

    var head = el('div', 'an-rv-thead');
    head.appendChild(el('span', 'an-rv-side', 'White'));
    head.appendChild(el('span', 'an-rv-mid', ''));
    head.appendChild(el('span', 'an-rv-side', 'Black'));
    wrap.appendChild(head);

    sum.rows.forEach(function (r) {
      var style = MET.CLASSIFICATIONS[r.key];
      var row = el('div', 'an-rv-row');
      var w = el('span', 'an-rv-count', String(r.white)); w.style.color = style.color;
      var b = el('span', 'an-rv-count', String(r.black)); b.style.color = style.color;
      var mid = el('span', 'an-rv-centre');
      var dot = el('span', 'an-rv-dot'); dot.style.background = style.color;
      mid.appendChild(dot);
      mid.appendChild(el('span', 'an-rv-name',
        esc(style.label) + (style.symbol ? ' ' + esc(style.symbol) : '')));
      row.appendChild(w); row.appendChild(mid); row.appendChild(b);
      wrap.appendChild(row);
    });
    return wrap;
  }

  /**
   * The eval graph (components/EvalGraph.tsx). Two filled polygons clipped at the midline — white
   * above, black below — then the centre line and the curve. x is index-based, not move_index.
   */
  function evalGraphSvg(points) {
    var G = MET.GRAPH_STYLE, H = MET.GRAPH.height, W = 100;      // viewBox units; CSS scales it
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'an-rv-svg');

    function add(tag, attrs) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      svg.appendChild(n);
      return n;
    }
    add('rect', { x: 0, y: 0, width: W, height: H, rx: G.backgroundRadius, fill: G.background });

    var mid = H / 2;
    var pts = points.map(function (p, i) {
      return MET.graphPoint(p.cp, p.mate, i, points.length, W, H);
    });
    var white = ['0,' + mid], black = ['0,' + mid];
    pts.forEach(function (p) {
      white.push(p.x + ',' + Math.min(p.y, mid));
      black.push(p.x + ',' + Math.max(p.y, mid));
    });
    var lastX = pts[pts.length - 1].x;
    white.push(lastX + ',' + mid);
    black.push(lastX + ',' + mid);

    add('polygon', { points: white.join(' '), fill: G.whiteFill });
    add('polygon', { points: black.join(' '), fill: G.blackFill });
    add('line', { x1: 0, y1: mid, x2: W, y2: mid, stroke: G.midLine, 'stroke-width': G.midLineWidth });
    add('polyline', {
      points: pts.map(function (p) { return p.x + ',' + p.y; }).join(' '),
      fill: 'none', stroke: G.curve, 'stroke-width': MET.GRAPH.lineWidth, 'stroke-linejoin': 'round'
    });
    return svg;
  }

  // ---- persistence: the save form, the library, and drafts ----------------------
  // Records mirror ../BYAHERONG-COACH-LARAVEL's analysis_sessions / analysis_folders so a future
  // sync stays possible; the rules all live in BiyaAnalysisStore, which is pure and asserted.

  var library = null;               // the loaded document
  var currentSessionId = null;      // set => Save updates rather than inserts
  var meta = blankMeta();           // the save form's fields
  var draftTimer = null;
  var restoredOnce = false;
  var libraryFilter = 'all';
  var librarySearch = '';

  function blankMeta() {
    return {
      title: '', notes: '', folderId: null, result: '*',
      whitePlayer: '', blackPlayer: '', whiteRating: '', blackRating: '',
      eventName: '', gameDate: '', timeControl: '', location: '', roundInfo: '', eco: ''
    };
  }
  function ensureLibrary() {
    if (!library) {
      library = ST.load();
      ST.seedDefaultFolders(library, Date.now());
      ST.persist(library);
    }
    return library;
  }

  /** The full PGN for the current tree — headers included, unlike the source's movetext-only one. */
  function currentPgn() {
    var game = {
      headers: pgnHeaders(), tree: session.tree, result: meta.result || '*',
      errors: [], moveCount: T.mainline(session.tree).length,
      preComment: '', initialFen: session.tree.initialFen
    };
    return P.serialize(game);
  }
  /** The metadata that belongs in PGN tags. Only `title` and `notes` have no tag of their own. */
  function pgnHeaders() {
    var h = {};
    if (meta.whitePlayer) h.White = meta.whitePlayer;
    if (meta.blackPlayer) h.Black = meta.blackPlayer;
    if (meta.eventName) h.Event = meta.eventName;
    if (meta.location) h.Site = meta.location;
    if (meta.gameDate) h.Date = meta.gameDate.replace(/-/g, '.');
    if (meta.roundInfo) h.Round = meta.roundInfo;
    if (meta.result && meta.result !== '*') h.Result = meta.result;
    if (meta.whiteRating) h.WhiteElo = String(meta.whiteRating);
    if (meta.blackRating) h.BlackElo = String(meta.blackRating);
    if (meta.eco) h.ECO = meta.eco;
    if (meta.timeControl) h.TimeControl = meta.timeControl;
    return h;
  }

  // -- drafts ---------------------------------------------------------------------
  // 800ms debounce and a 24h TTL, both the source's own numbers. Restore is silent.

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      if (!alive()) return;
      var pgn = currentPgn();
      var fen = session.tree.initialFen;
      if (!ST.draftWorthKeeping(T.mainline(session.tree).length ? pgn : '', fen)) return;
      var lib = ensureLibrary();
      ST.putDraft(lib, ST.DRAFT_NEW, {
        pgn: pgn, initialFen: fen, sessionId: currentSessionId,
        title: meta.title, notes: meta.notes, folderId: meta.folderId
      }, Date.now());
      ST.persist(lib);
    }, ST.DRAFT_DEBOUNCE_MS);
  }

  /** Silent restore, as the source does — no "restore?" prompt. */
  function restoreDraft() {
    var lib = ensureLibrary();
    var d = ST.draft(lib, ST.DRAFT_NEW, Date.now());
    if (!d) { ST.persist(lib); return false; }   // persist: reading a stale draft prunes it
    var loaded = P.parseFirst(d.pgn);
    if (!loaded || !loaded.tree) return false;
    session.tree = loaded.tree;
    T.goToEnd(session.tree);
    currentSessionId = d.sessionId;
    meta.title = d.title || '';
    meta.notes = d.notes || '';
    meta.folderId = d.folderId;
    applyReview(session, null, []);
    session.snapshot = null;
    return true;
  }

  function clearDraft() {
    var lib = ensureLibrary();
    if (ST.clearDraft(lib, ST.DRAFT_NEW)) ST.persist(lib);
  }

  // -- the save form ---------------------------------------------------------------

  function openSaveSheet() {
    if (!T.mainline(session.tree).length) {
      showNotice('No moves', 'Play some moves before saving.');
      return;
    }
    ensureLibrary();
    // Prefill from the PGN headers the tree already carries, without clobbering typed input.
    renderSaveSheet();
  }

  function saveCurrent() {
    var lib = ensureLibrary();
    var rec = ST.saveSession(lib, {
      id: currentSessionId,
      pgn: currentPgn(),
      initialFen: session.tree.initialFen,
      title: meta.title, notes: meta.notes, folderId: meta.folderId,
      result: meta.result,
      whitePlayer: meta.whitePlayer, blackPlayer: meta.blackPlayer,
      whiteRating: meta.whiteRating, blackRating: meta.blackRating,
      eventName: meta.eventName, gameDate: meta.gameDate,
      timeControl: meta.timeControl, location: meta.location,
      roundInfo: meta.roundInfo, eco: meta.eco
    }, Date.now());
    if (!rec) { showNotice('Nothing to save', 'The game has no moves.'); return; }
    currentSessionId = rec.id;
    ST.persist(lib);
    clearDraft();
    hideSheet();
    showNotice('Saved', rec.title + ' is in your library.');
  }

  function openSession(id) {
    var lib = ensureLibrary();
    var rec = ST.session(lib, id);
    if (!rec) return;
    var loaded = P.parseFirst(rec.pgn);
    if (!loaded || !loaded.tree) { showNotice('Could not open', 'That PGN did not parse.'); return; }
    replaceTree(session, loaded.tree);
    T.goToEnd(session.tree);
    currentSessionId = rec.id;
    meta = {
      title: rec.title || '', notes: rec.notes || '', folderId: rec.folderId,
      result: rec.result || '*',
      whitePlayer: rec.whitePlayer || '', blackPlayer: rec.blackPlayer || '',
      whiteRating: rec.whiteRating == null ? '' : String(rec.whiteRating),
      blackRating: rec.blackRating == null ? '' : String(rec.blackRating),
      eventName: rec.eventName || '', gameDate: rec.gameDate || '',
      timeControl: rec.timeControl || '', location: rec.location || '',
      roundInfo: rec.roundInfo || '', eco: rec.eco || ''
    };
    hideSheet();
    paintAll(false);
    scheduleAnalysis();
  }

  function deleteSavedSession(id) {
    var lib = ensureLibrary();
    if (!ST.deleteSession(lib, id)) return;
    if (currentSessionId === id) currentSessionId = null;
    ST.persist(lib);
    renderLibrarySheet();
  }

  // -- sheets ------------------------------------------------------------------------

  function hideSheet() {
    if (ui && ui.sheet && ui.sheet.parentNode) ui.sheet.remove();
    if (ui) ui.sheet = null;
  }

  /** A bottom sheet, the shape every modal in the source uses. */
  function bottomSheet(title) {
    hideSheet();
    var wrap = el('div', 'an-bs');
    var card = el('div', 'an-bs-card');
    var head = el('div', 'an-bs-head');
    head.appendChild(el('div', 'an-bs-title', esc(title)));
    var close = el('button', 'an-bs-close', '✕');
    close.onclick = hideSheet;
    head.appendChild(close);
    card.appendChild(head);
    wrap.appendChild(card);
    wrap.onclick = function (e) { if (e.target === wrap) hideSheet(); };
    root.appendChild(wrap);
    ui.sheet = wrap;
    return card;
  }

  function showNotice(title, body) {
    var card = bottomSheet(title);
    card.appendChild(el('div', 'an-bs-note', esc(body)));
    var ok = el('button', 'an-bs-save', 'OK');
    ok.onclick = hideSheet;
    card.appendChild(ok);
  }

  function field(parent, label, key, opts) {
    opts = opts || {};
    var input = el('input', 'an-bs-input');
    input.type = 'text';
    input.placeholder = label;
    input.value = meta[key] || '';
    if (opts.numeric) input.inputMode = 'numeric';
    if (opts.upper) input.style.textTransform = 'uppercase';
    input.oninput = function () { meta[key] = input.value; };
    parent.appendChild(input);
    return input;
  }

  function renderSaveSheet() {
    var card = bottomSheet('Game Details');
    var body = el('div', 'an-bs-body');

    field(body, 'Title', 'title');
    var wRow = el('div', 'an-bs-row');
    field(wRow, 'White player', 'whitePlayer');
    field(wRow, 'Rating', 'whiteRating', { numeric: true }).classList.add('narrow');
    body.appendChild(wRow);
    var bRow = el('div', 'an-bs-row');
    field(bRow, 'Black player', 'blackPlayer');
    field(bRow, 'Rating', 'blackRating', { numeric: true }).classList.add('narrow');
    body.appendChild(bRow);

    var results = el('div', 'an-bs-results');
    MET.RESULT_OPTIONS.forEach(function (r) {
      var b = el('button', 'an-bs-result' + (meta.result === r ? ' active' : ''),
                 esc(MET.resultLabel(r)));
      b.onclick = function () { meta.result = r; renderSaveSheet(); };
      results.appendChild(b);
    });
    body.appendChild(results);

    field(body, 'Event', 'eventName');
    var row3 = el('div', 'an-bs-row');
    field(row3, 'Time control', 'timeControl');
    field(row3, 'Round', 'roundInfo');
    body.appendChild(row3);
    var row4 = el('div', 'an-bs-row');
    field(row4, 'Location', 'location');
    field(row4, 'ECO', 'eco', { upper: true });
    body.appendChild(row4);
    var date = field(body, 'Date (YYYY-MM-DD)', 'gameDate');
    date.type = 'date';

    body.appendChild(el('div', 'an-bs-label', 'Folder'));
    var chips = el('div', 'an-bs-chips');
    function folderChip(label, id) {
      var b = el('button', 'an-bs-chip' + (meta.folderId === id ? ' active' : ''), esc(label));
      b.onclick = function () { meta.folderId = id; renderSaveSheet(); };
      chips.appendChild(b);
    }
    folderChip('None', null);
    ST.folders(ensureLibrary()).forEach(function (f) { folderChip(f.name, f.id); });
    var add = el('button', 'an-bs-chip add', '+ New');
    add.onclick = function () {
      var name = prompt('Folder name');
      if (!name) return;
      var lib = ensureLibrary();
      var f = ST.createFolder(lib, name, null, Date.now());
      if (f) { meta.folderId = f.id; ST.persist(lib); }
      renderSaveSheet();
    };
    chips.appendChild(add);
    body.appendChild(chips);

    var notes = el('textarea', 'an-bs-input an-bs-notes');
    notes.placeholder = 'Notes';
    notes.value = meta.notes || '';
    notes.oninput = function () { meta.notes = notes.value; };
    body.appendChild(notes);

    body.appendChild(el('div', 'an-bs-note',
      T.mainline(session.tree).length + ' moves' + (currentSessionId ? ' · updating' : '')));
    card.appendChild(body);

    var foot = el('div', 'an-bs-foot');
    var cancel = el('button', 'an-bs-cancel', 'Cancel');
    cancel.onclick = hideSheet;
    var save = el('button', 'an-bs-save', currentSessionId ? 'Update' : 'Save');
    save.onclick = saveCurrent;
    foot.appendChild(cancel); foot.appendChild(save);
    card.appendChild(foot);
  }

  function renderLibrarySheet() {
    var lib = ensureLibrary();
    var card = bottomSheet('📂 Saved Analyses');
    var body = el('div', 'an-bs-body');

    var search = el('input', 'an-bs-input');
    search.type = 'search';
    search.placeholder = 'Search title, notes or players';
    search.value = librarySearch;
    search.oninput = function () { librarySearch = search.value; renderRows(); };
    body.appendChild(search);

    var chips = el('div', 'an-bs-chips');
    function filterChip(label, value) {
      var b = el('button', 'an-bs-chip' + (libraryFilter === value ? ' active' : ''), esc(label));
      b.onclick = function () { libraryFilter = value; renderLibrarySheet(); };
      chips.appendChild(b);
      return b;
    }
    filterChip('All', 'all');
    filterChip('Unfiled (' + ST.sessionCount(lib, null) + ')', 'unfiled');
    ST.folders(lib).forEach(function (f) {
      var b = filterChip('📁 ' + f.name + ' (' + ST.sessionCount(lib, f.id) + ')', f.id);
      if (!f.isDefault) {
        // Deleting a folder UNFILES its games; it never deletes them.
        b.oncontextmenu = function (e) {
          e.preventDefault();
          if (!confirm('Delete "' + f.name + '"? Its games move to Unfiled.')) return;
          ST.deleteFolder(lib, f.id);
          if (libraryFilter === f.id) libraryFilter = 'all';
          ST.persist(lib);
          renderLibrarySheet();
        };
        b.title = 'Right-click to delete';
      }
    });
    body.appendChild(chips);

    var rows = el('div', 'an-bs-rows');
    body.appendChild(rows);
    card.appendChild(body);

    function renderRows() {
      rows.innerHTML = '';
      var list = ST.sessions(lib, libraryFilter, librarySearch);
      if (!list.length) {
        rows.appendChild(el('div', 'an-bs-note',
          librarySearch ? 'Nothing matches that search.' : 'No saved analyses yet.'));
        return;
      }
      list.forEach(function (rec) {
        var row = el('div', 'an-lib-card');
        var main = el('div', 'an-lib-main');
        var players = rec.whitePlayer || rec.blackPlayer
          ? (rec.whitePlayer || '?') + (rec.whiteRating ? ' (' + rec.whiteRating + ')' : '')
            + ' vs ' + (rec.blackPlayer || '?') + (rec.blackRating ? ' (' + rec.blackRating + ')' : '')
          : rec.title;
        main.appendChild(el('div', 'an-lib-primary', esc(players)));
        main.appendChild(el('div', 'an-lib-pgn', esc(pgnPreview(rec.pgn))));
        var f = rec.folderId == null ? null : ST.folder(lib, rec.folderId);
        var bits = [];
        if (rec.result) bits.push(rec.result);
        if (rec.eco) bits.push(rec.eco);
        if (f) bits.push('📁 ' + f.name);
        bits.push(new Date(rec.updatedAt).toLocaleDateString());
        main.appendChild(el('div', 'an-lib-meta', esc(bits.join(' · '))));
        main.onclick = function () { openSession(rec.id); };
        row.appendChild(main);
        var del = el('button', 'an-lib-action', '🗑️');
        del.title = 'Delete';
        del.onclick = function () {
          if (confirm('Delete "' + rec.title + '"?')) deleteSavedSession(rec.id);
        };
        row.appendChild(del);
        rows.appendChild(row);
      });
    }
    renderRows();
  }

  /** The movetext, headers stripped — what the row preview shows. */
  function pgnPreview(pgn) {
    var body = String(pgn || '').replace(/\[[^\]]*\]\s*/g, '').trim().replace(/\s+/g, ' ');
    return body.length > 55 ? body.slice(0, 55) + '…' : body;
  }

  function cycleTheme() {
    var keys = Object.keys(MET.BOARD_THEMES);
    boardTheme = keys[(keys.indexOf(boardTheme) + 1) % keys.length];
    applyMetrics(root);
  }

  // ============================ phase 11: the ☰ sidebar ============================
  // renderMenu:4489 — four sections. `sidebarStyles` is the live block; `styles.menuContainer`
  // belongs to a dead earlier menu at a different width, which is why the metrics layer asserts
  // the two really do differ.

  function hideMenu() {
    if (ui && ui.menu && ui.menu.parentNode) ui.menu.remove();
    if (ui) ui.menu = null;
  }

  function showMenu() {
    hideMenu();
    var wrap = el('div', 'an-mn');
    var panel = el('div', 'an-mn-panel');
    var head = el('div', 'an-mn-head');
    head.appendChild(el('div', 'an-mn-title', 'Analysis'));
    var close = el('button', 'an-mn-close', '✕');
    close.onclick = hideMenu;
    head.appendChild(close);
    panel.appendChild(head);

    var body = el('div', 'an-mn-body');
    var sections = [
      { title: 'Game', items: [
        { icon: '🔁', label: 'New Game', run: newGame },
        { icon: '✏️', label: editing ? 'Leave Edit Board' : 'Edit Board', run: toggleEditMode },
        { icon: '📥', label: 'Import PGN', run: showPgnImport },
        { icon: '🔬', label: 'Analyze Game', run: startReview }
      ] },
      { title: 'File', items: [
        { icon: '💾', label: 'Save Analysis', run: openSaveSheet },
        { icon: '📂', label: 'Load Analysis', run: renderLibrarySheet }
      ] },
      { title: 'Share', items: [
        { icon: '📋', label: 'Copy PGN', run: copyPgn },
        { icon: '📤', label: 'Export PGN', run: showPgnExport }
      ] },
      { title: 'Settings', items: [
        { icon: '🏹', label: 'Engine Arrows  ' + (showArrows ? 'ON' : 'OFF'),
          toggle: showArrows, run: function () { showArrows = !showArrows; paintArrows(); } },
        { icon: '⏱️', label: 'Autoplay Speed', run: showAutoplaySpeeds },
        // Not in the source's menu: offline there is no Master DB row to sit here, and the board
        // theme had nowhere else to live once ☰ stopped being its stand-in button.
        { icon: '🎨', label: 'Board Theme  ' + MET.BOARD_THEMES[boardTheme].label, run: cycleTheme }
      ] }
    ];

    sections.forEach(function (sec) {
      body.appendChild(el('div', 'an-mn-sect', esc(sec.title)));
      sec.items.forEach(function (item) {
        var row = el('button', 'an-mn-item');
        row.appendChild(el('span', 'an-mn-icon', item.icon));
        row.appendChild(el('span', 'an-mn-label', esc(item.label)));
        if ('toggle' in item) {
          row.appendChild(el('span', 'an-mn-dot' + (item.toggle ? ' on' : '')));
        }
        row.onclick = function () { hideMenu(); item.run(); };
        body.appendChild(row);
      });
    });
    panel.appendChild(body);
    wrap.appendChild(panel);
    wrap.onclick = function (e) { if (e.target === wrap) hideMenu(); };
    root.appendChild(wrap);
    ui.menu = wrap;
  }

  /** 🔁 New Game (handleReset:1526) — and it clears the draft, as the source does. */
  function newGame() {
    if (editing) leaveEditMode();
    var fresh = createSession();
    replaceTree(session, fresh.tree);
    session.autoAnalyze = true;
    currentSessionId = null;
    meta = blankMeta();
    clearDraft();
    paintAll(false);
    scheduleAnalysis();
  }

  // ============================ phase 11: Setup Position ============================
  // renderEditPositionPanel:3615 + handleEditSquarePress:2389 + toggleEditMode:2429.

  function toggleEditMode() { editing ? leaveEditMode() : enterEditMode(); }

  function enterEditMode() {
    session.autoplaying = false;
    engineToken += 1;                        // the engine has nothing to say about a half-built board
    clearTimeout(debounceTimer);
    session.analyzing = false;
    editor = PE.create(E.toFEN(position(session)));
    editorPiece = null;
    lastTapSquare = null; lastTapAt = 0;
    editing = true;
    paintAll(false);
  }

  function leaveEditMode() {
    editing = false;
    editor = null;
    editorPiece = null;
    paintAll(false);
    scheduleAnalysis();
  }

  /** ✓ Apply Position. Refuses an illegal board and says why, exactly as the source alerts. */
  function applyEditorPosition() {
    var issue = PE.firstIssueText(editor);
    if (issue) { showNotice('Invalid Position', issue); return; }
    var pos = PE.apply(editor);
    if (!pos) { showNotice('Invalid Position', 'The position on the board is not valid.'); return; }
    applyEditedPosition(session, pos);
    currentSessionId = null;                 // a new position is a new game, not an edit of the old
    editing = false;
    editor = null;
    editorPiece = null;
    paintAll(false);
    scheduleAnalysis();
    scheduleDraft();
  }

  /**
   * A tap on the board while editing. Double-tapping an occupied square removes the piece — the
   * source's own gesture, at its own 350ms window (AnalysisTiming.doubleTapWindowMs).
   */
  function onEditSquare(sq) {
    var now = Date.now();
    var isDoubleTap = lastTapSquare === sq && (now - lastTapAt) < MET.TIMINGS.doubleTapWindow;
    lastTapSquare = sq; lastTapAt = now;

    if (isDoubleTap && editor.squares[sq]) { PE.removeAt(editor, sq); paintEditor(); return; }
    if (editorPiece === PE.ERASER) PE.removeAt(editor, sq);
    else if (editorPiece) PE.put(editor, sq, editorPiece);
    paintEditor();
  }

  /** Repaint the board and the panel from the editor — everything else on screen is frozen. */
  function paintEditor() {
    ui.board.setPosition(PE.fen(editor), { animate: false });
    ui.board.arrows = [];
    if (ui.editErr) {
      var issue = PE.firstIssueText(editor);
      ui.editErr.textContent = issue ? '⚠ ' + issue : '';
      ui.editErr.style.display = issue ? '' : 'none';
    }
    if (ui.editTurn) {
      var white = editor.sideToMove === E.WHITE;
      ui.editTurn.textContent = white ? '⬜ White' : '⬛ Black';
      ui.editTurn.classList.toggle('dark', !white);
    }
    if (ui.editCastle) {
      ui.editCastle.forEach(function (b) { b.classList.toggle('on', !!editor[b.dataset.flag]); });
    }
    if (ui.editPalette) {
      ui.editPalette.forEach(function (b) {
        b.classList.toggle('active', b.dataset.piece === editorPiece);
      });
    }
  }

  /** Band 6 becomes the editor while edit mode is on — the source swaps the same region. */
  function renderEditPanel(parent) {
    parent.innerHTML = '';
    var panel = el('div', 'an-ed');
    var titleRow = el('div', 'an-ed-title-row');
    titleRow.appendChild(el('span', 'an-ed-title', '✏️ Setup Position'));
    titleRow.appendChild(el('span', 'an-ed-hint', 'Double-tap piece to remove'));
    panel.appendChild(titleRow);

    ui.editPalette = [];
    function paletteRow(keys, cls) {
      var row = el('div', 'an-ed-pal ' + cls);
      keys.forEach(function (k) {
        var b = el('button', 'an-ed-piece');
        b.dataset.piece = k;
        var img = document.createElement('img');
        img.src = 'assets/pieces/' + PIECE_FILE[k.toLowerCase()] + '-'
          + (k === k.toUpperCase() ? 'w' : 'b') + '.svg';
        img.alt = k;
        b.appendChild(img);
        b.onclick = function () {
          editorPiece = (editorPiece === k) ? null : k;
          paintEditor();
        };
        row.appendChild(b);
        ui.editPalette.push(b);
      });
      panel.appendChild(row);
    }
    paletteRow(PE.WHITE_PIECE_KEYS, 'light');
    paletteRow(PE.BLACK_PIECE_KEYS, 'dark');

    var actions = el('div', 'an-ed-actions');
    var erase = el('button', 'an-ed-act', '🗑️ Erase');
    erase.dataset.piece = PE.ERASER;
    erase.onclick = function () {
      editorPiece = (editorPiece === PE.ERASER) ? null : PE.ERASER;
      paintEditor();
    };
    ui.editPalette.push(erase);
    var clearBtn = el('button', 'an-ed-act', '🧹 Clear');
    clearBtn.onclick = function () { PE.clear(editor); paintEditor(); };
    var turn = el('button', 'an-ed-act an-ed-turn', '⬜ White');
    turn.onclick = function () { PE.toggleSideToMove(editor); paintEditor(); };
    ui.editTurn = turn;
    actions.appendChild(erase); actions.appendChild(clearBtn); actions.appendChild(turn);
    panel.appendChild(actions);

    var cas = el('div', 'an-ed-cas');
    cas.appendChild(el('div', 'an-ed-cas-label', 'Castling Rights'));
    var casRow = el('div', 'an-ed-cas-row');
    ui.editCastle = [];
    [['castleWK', '⬜K'], ['castleWQ', '⬜Q'], ['castleBK', '⬛K'], ['castleBQ', '⬛Q']]
      .forEach(function (pair) {
        var b = el('button', 'an-ed-cas-btn', pair[1]);
        b.dataset.flag = pair[0];
        b.onclick = function () { editor[pair[0]] = !editor[pair[0]]; paintEditor(); };
        casRow.appendChild(b);
        ui.editCastle.push(b);
      });
    cas.appendChild(casRow);
    panel.appendChild(cas);

    var err = el('div', 'an-ed-err');
    err.style.display = 'none';
    ui.editErr = err;
    panel.appendChild(err);

    var done = el('button', 'an-ed-done', '✓  Apply Position');
    done.onclick = applyEditorPosition;
    panel.appendChild(done);

    var fenRow = el('div', 'an-ed-fen-row');
    var fenInput = el('input', 'an-ed-fen');
    fenInput.type = 'text';
    fenInput.placeholder = 'Paste FEN...';
    var load = el('button', 'an-ed-load', 'Load');
    load.onclick = function () {
      if (!fenInput.value.trim()) return;
      if (!PE.loadFEN(editor, fenInput.value)) { showNotice('Invalid FEN', 'Could not load FEN string.'); return; }
      fenInput.value = '';
      paintEditor();
    };
    fenRow.appendChild(fenInput); fenRow.appendChild(load);
    panel.appendChild(fenRow);

    parent.appendChild(panel);
    paintEditor();
  }

  // ============================ phase 11: PGN in and out ============================

  /** 📥 Import PGN (renderPgnModal:3757) — paste, or pick a file. */
  function showPgnImport() {
    var card = bottomSheet('📋 Import PGN');
    var area = el('textarea', 'an-md-pgn-input');
    area.placeholder = 'Paste PGN here...\n\n1. e4 e5 2. Nf3 Nc6...';
    card.appendChild(area);

    var row = el('div', 'an-md-row');
    var file = el('input');
    file.type = 'file';
    file.accept = '.pgn,text/plain';
    file.style.display = 'none';
    file.onchange = function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { area.value = String(reader.result || ''); };
      reader.onerror = function () { showNotice('Error', 'Could not read the file.'); };
      reader.readAsText(f);
    };
    var pick = el('button', 'an-bs-cancel', '📁 File');
    pick.onclick = function () { file.click(); };
    var load = el('button', 'an-bs-save', '▶ Load PGN');
    load.onclick = function () {
      var text = area.value;
      if (!text.trim()) { showNotice('Error', 'Please enter PGN text.'); return; }
      var res = importPGN(session, text);
      if (!res.ok) {
        showNotice('Could not import', res.errors.length
          ? 'No playable moves. First problem: ' + res.errors[0].message
          : 'That does not look like a PGN.');
        return;
      }
      fillMetaFromHeaders(res);
      currentSessionId = null;             // an imported game is not the saved one you had open
      hideSheet();
      paintAll(false);
      scheduleAnalysis();
      scheduleDraft();
      if (res.errors.length || res.gamesFound > 1) {
        showNotice('Imported', res.moveCount + ' moves'
          + (res.gamesFound > 1 ? '. That file held ' + res.gamesFound + ' games — the first was loaded.' : '')
          + (res.errors.length ? ' ' + res.errors.length + ' token(s) were skipped.' : ''));
      }
    };
    row.appendChild(pick); row.appendChild(load);
    card.appendChild(file);
    card.appendChild(row);
    area.focus();
  }

  /**
   * Pre-fill the save form from the PGN's headers, only where the field is still empty
   * (handleImportPgn:2333-2349) — so an import never overwrites something you typed.
   */
  function fillMetaFromHeaders(res) {
    var h = res.headers || {};
    function fill(key, value) { if (value && !meta[key]) meta[key] = String(value); }
    fill('whitePlayer', h.White);
    fill('blackPlayer', h.Black);
    fill('whiteRating', h.WhiteElo);
    fill('blackRating', h.BlackElo);
    fill('eventName', h.Event);
    fill('location', h.Site);
    fill('roundInfo', h.Round);
    fill('eco', h.ECO);
    fill('timeControl', h.TimeControl);
    if (h.Date && !meta.gameDate) {
      var iso = String(h.Date).replace(/\./g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) meta.gameDate = iso;
    }
    if (meta.result === '*' && ['1-0', '0-1', '1/2-1/2'].indexOf(res.result) >= 0) meta.result = res.result;
    if (!meta.title && h.White && h.Black) meta.title = h.White + ' vs ' + h.Black;
  }

  /** 📋 Copy PGN (handleCopyPgn:2373). */
  function copyPgn() {
    var text = exportPGN(session, pgnHeaders(), meta.result || '*');
    if (!text) { showNotice('No moves', 'Play some moves first.'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showNotice('Copied', 'PGN copied to clipboard.'); })
        .catch(function () { showPgnExport(); });
    } else {
      showPgnExport();
    }
  }

  /**
   * 📤 Export PGN. The source calls the OS share sheet (`Share.share`); a browser has no such
   * thing, so this shows the text to copy and offers a download — the same intent, offline.
   */
  function showPgnExport() {
    var text = exportPGN(session, pgnHeaders(), meta.result || '*');
    if (!text) { showNotice('No moves', 'Play some moves first.'); return; }
    var card = bottomSheet('📤 Export PGN');
    var area = el('textarea', 'an-md-pgn-input');
    area.value = text;
    area.readOnly = true;
    card.appendChild(area);
    var row = el('div', 'an-md-row');
    var sel = el('button', 'an-bs-cancel', '📋 Select all');
    sel.onclick = function () { area.focus(); area.select(); };
    var dl = el('button', 'an-bs-save', '⬇ Download .pgn');
    dl.onclick = function () {
      var blob = new Blob([text], { type: 'application/x-chess-pgn' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (meta.title || 'analysis').replace(/[^\w.-]+/g, '_') + '.pgn';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
    };
    row.appendChild(sel); row.appendChild(dl);
    card.appendChild(row);
  }

  // ============================ phase 11: the pickers ============================

  /** The annotation picker (renderAnnotationPicker:3257), reached by long-pressing a move token. */
  function showAnnotationPicker(nodeId) {
    var node = nodeById(session, nodeId);
    if (!node) return;
    var card = bottomSheet('Annotate: ' + node.san);
    annotationSections().forEach(function (sec) {
      card.appendChild(el('div', 'an-md-sect', esc(sec.title)));
      var grid = el('div', 'an-md-grid');
      sec.options.forEach(function (opt) {
        var b = el('button', 'an-md-abtn' + (node.nag === opt.nag ? ' active' : ''));
        var sym = el('span', 'an-md-asym', esc(opt.symbol));
        sym.style.color = opt.color;
        b.appendChild(sym);
        b.appendChild(el('span', 'an-md-alabel', esc(opt.label)));
        b.onclick = function () {
          setNag(session, nodeId, node.nag === opt.nag ? 0 : opt.nag);
          hideSheet(); paintAll(false); scheduleDraft();
        };
        grid.appendChild(b);
      });
      card.appendChild(grid);
    });
    var clear = el('button', 'an-md-clear', 'Clear Annotation');
    clear.onclick = function () {
      clearNag(session, nodeId); hideSheet(); paintAll(false); scheduleDraft();
    };
    card.appendChild(clear);
  }

  /** The variation card (renderVariationModal:4357) — promote or delete a line. */
  function showVariationCard(nodeId) {
    var info = variationInfo(session, nodeId);
    if (!info) return;
    var card = bottomSheet(info.movePrefix + ' ' + info.san + info.nagText);
    var badge = el('div', 'an-md-vbadge' + (info.isMainline ? ' main' : ''), esc(info.typeLabel));
    card.appendChild(badge);

    function action(cls, icon, title, sub, run) {
      var row = el('button', 'an-md-vrow ' + cls);
      row.appendChild(el('span', 'an-md-vicon', icon));
      var col = el('div', 'an-md-vtext');
      col.appendChild(el('div', 'an-md-vtitle', esc(title)));
      col.appendChild(el('div', 'an-md-vsub', esc(sub)));
      row.appendChild(col);
      row.appendChild(el('span', 'an-md-vchev', '›'));
      row.onclick = run;
      card.appendChild(row);
      return row;
    }

    if (info.canPromote) {
      action('promote', '⭐', 'Set as Main Line', 'Promote this variation to the primary line',
        function () {
          promoteNode(session, nodeId);
          hideSheet(); paintAll(false); scheduleAnalysis(); scheduleDraft();
        });
    }
    action('delete', '🗑', 'Delete Branch',
      info.subtreeCount === 1 ? 'Remove this move' : 'Remove this variation and all ' + info.subtreeCount + ' of its moves',
      function () { confirmDeleteBranch(nodeId, info); });
  }

  function confirmDeleteBranch(nodeId, info) {
    var card = bottomSheet('⚠️  Delete this branch?');
    card.appendChild(el('div', 'an-bs-note',
      'This will permanently remove ' + info.movePrefix + ' ' + info.san
      + ' and all continuation moves. This cannot be undone.'));
    var row = el('div', 'an-md-row');
    var cancel = el('button', 'an-bs-cancel', 'Cancel');
    cancel.onclick = function () { showVariationCard(nodeId); };
    var del = el('button', 'an-bs-save an-md-danger', 'Delete');
    del.onclick = function () {
      deleteBranch(session, nodeId);
      hideSheet(); paintAll(false); scheduleAnalysis(); scheduleDraft();
    };
    row.appendChild(cancel); row.appendChild(del);
    card.appendChild(row);
  }

  /** ⏱️ Autoplay Speed (renderAutoplaySettings:4279). */
  function showAutoplaySpeeds() {
    var card = bottomSheet('Autoplay Speed');
    var grid = el('div', 'an-md-grid');
    MET.AUTOPLAY_SPEEDS.forEach(function (sp) {
      var b = el('button', 'an-md-abtn' + (sp.value === autoplaySpeed ? ' active' : ''));
      b.appendChild(el('span', 'an-md-asym', esc(sp.label)));
      b.onclick = function () { autoplaySpeed = sp.value; hideSheet(); paintStatus(); };
      grid.appendChild(b);
    });
    card.appendChild(grid);
  }

  /**
   * Long-press wiring, shared by every move token and branch chip. There is no long-press anywhere
   * else in this rebuild, so the delay comes from the metrics layer (delayLongPress={400}).
   */
  function attachLongPress(node, run) {
    var timer = null, fired = false;
    function start() {
      fired = false;
      timer = setTimeout(function () { fired = true; run(); }, MET.TIMINGS.longPressDelay);
    }
    function cancel() { clearTimeout(timer); timer = null; }
    node.addEventListener('pointerdown', start);
    node.addEventListener('pointerup', cancel);
    node.addEventListener('pointerleave', cancel);
    node.addEventListener('pointercancel', cancel);
    // Swallow the click the long-press would otherwise also produce.
    node.addEventListener('click', function (e) {
      if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }

  /** Drop the whole session — the Home tile should open a clean board next time. */
  function reset() {
    engineToken += 1;
    reviewToken += 1;
    clearTimeout(debounceTimer); clearTimeout(autoplayTimer); clearTimeout(draftTimer);
    session = null; currentSessionId = null; meta = blankMeta(); restoredOnce = false;
    editing = false; editor = null; editorPiece = null;
    // Drop the cached document too. It is re-read on next use, so an external change (another tab,
    // or a dev reset) cannot be clobbered by writing a stale copy back over it.
    library = null;
  }

  return {
    // pure
    createSession: createSession, position: position, historyKeys: historyKeys, outcome: outcome,
    statusText: statusText, openingEntry: openingEntry, openingText: openingText,
    bookContinuations: bookContinuations, arrows: arrows, engineRows: engineRows,
    evalParts: evalParts, evalFraction: evalFraction, evalSymbol: evalSymbol,
    isStale: isStale, wantsAnalysis: wantsAnalysis,
    stripTokens: stripTokens, nagText: nagText, PV_PREVIEW: PV_PREVIEW,
    applyReview: applyReview, classificationFor: classificationFor, reviewSummary: reviewSummary,
    play: play, playUci: playUci, playSan: playSan,
    goToNode: goToNode, goToStart: goToStart, goBack: goBack, goForward: goForward, goToEnd: goToEnd,
    forwardOptions: forwardOptions, lastMove: lastMove, checkSquare: checkSquare,
    // annotations, variations, PGN in/out, edit mode (phase 11)
    NAG_SYMBOL: NAG_SYMBOL, nagFor: nagFor, annotationSections: annotationSections,
    setNag: setNag, clearNag: clearNag,
    annotationSymbol: annotationSymbol, annotationSquare: annotationSquare,
    nodeById: nodeById, variationInfo: variationInfo,
    promoteNode: promoteNode, deleteBranch: deleteBranch,
    replaceTree: replaceTree, importPGN: importPGN, exportPGN: exportPGN,
    applyEditedPosition: applyEditedPosition,
    selfTest: selfTest,
    // view
    render: render, reset: reset
  };
})();

/* Makes the pure layer runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaAnalysisBoard; }
