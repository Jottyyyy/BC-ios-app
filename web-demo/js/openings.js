/* openings.js — the Opening Tree's three screens: saved list, build form, explorer.
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/OpeningTreeScreens.swift`. One file because the RN original
 * is one file (`analysis-board/openingtree.tsx`, three views behind a `view` state) and they share
 * a header, a palette and a store.
 *
 * Every number comes from `opening-metrics.js`, pushed onto the root as `--op-*` custom properties.
 * There is no numeric literal below — the same rule the pairing and analysis screens follow.
 */
'use strict';

var BiyaOpenings = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./opening-metrics.js') : BiyaOpeningMetrics;
  var OT = isNode ? require('./opening-tree.js') : BiyaOpeningTree;
  var ST = isNode ? require('./opening-store.js') : BiyaOpeningStore;

  /**
   * The download module, resolved LAZILY.
   *
   * Eagerly, this file would pull `opening-download.js` in at load time — and that file is the
   * only one in `web-demo/` that touches `fetch`. Keeping the reference behind a call means the
   * screens still load, render and self-test in an environment with no network stack at all,
   * which is what `js_goldens.js` runs in.
   */
  function DL() {
    if (typeof BiyaOpeningDownload !== 'undefined') return BiyaOpeningDownload;
    if (isNode) return require('./opening-download.js');
    throw new Error('openings.js needs opening-download.js — load it first');
  }

  /** The Analysis Board's metrics — the eval rail's width, colours and timing are theirs. */
  function analysisMetrics() {
    if (typeof BiyaAnalysisMetrics !== 'undefined') return BiyaAnalysisMetrics;
    if (isNode) return require('./analysis-metrics.js');
    throw new Error('openings.js needs analysis-metrics.js — load it first');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---- the engine's state, set by the router --------------------------------
   *
   * Pushed in rather than owned here, the way `BiyaHome.setPremium` does it: `app.js` runs the
   * search and owns its token, this file draws the answer. Keeping the loop out of the renderer is
   * what lets `openings.js` still be `require`d headlessly by `js_goldens.js`, where there is no
   * Worker and no DOM.
   *
   * `on` is FALSE by default — the client's own answer. This screen is a repertoire browser first,
   * and a search firing on every step of a fast walk is not what it is for.
   */
  var engineState = { on: false, rows: [], analyzing: false, snapshot: null };
  function setEngine(next) {
    engineState = {
      on: !!(next && next.on),
      rows: (next && next.rows) || [],
      analyzing: !!(next && next.analyzing),
      // The whole snapshot, not just the rows: the RAIL needs the position's own score, which is
      // `snapshot.score` — terminal-first, so a finished game pins the rail rather than reading as
      // a large evaluation. Row 1's eval and the rail's label are two projections of that one
      // score and cannot be allowed to disagree.
      snapshot: (next && next.snapshot) || null
    };
  }
  function engineOn() { return engineState.on; }

  /**
   * Push every metric onto the root, so the stylesheet holds no number of its own.
   *
   * TWO namespaces, and they are not cosmetic: `--op-*` is geometry and `--opc-*` is colour.
   * `buildBorder`, `inputBorder` and `infoBorder` each name a WIDTH in `LAYOUT` and a COLOUR in
   * `PALETTE`; under one prefix the colour pass silently overwrote the width, and three borders
   * rendered with `#243654` as their thickness — i.e. not at all.
   */
  function applyMetrics(node) {
    var L = MET.LAYOUT, P = MET.PALETTE, W = MET.WDL;
    function px(k, v) { node.style.setProperty('--op-' + k, v + 'px'); }
    function raw(k, v) { node.style.setProperty('--op-' + k, v); }
    function colour(k, v) { node.style.setProperty('--opc-' + k, v); }

    Object.keys(L).forEach(function (k) {
      var v = L[k];
      // An opacity is unitless; everything else the layout owns is a pixel.
      if (k === 'navDisabledOpacity') raw(k, v);
      else px(k, v);
    });
    Object.keys(P).forEach(function (k) { colour(k, P[k]); });
    px('barHeight', W.barHeight);
    px('barRadius', W.barRadius);
    colour('win', W.win);
    colour('draw', W.draw);
    colour('loss', W.loss);
    // The load pill's fill is `rgba(253,176,34,0.15)` in the source: the gold at 15%, composed
    // from the same token rather than restated as a fourth spelling of it.
    colour('loadFill', 'color-mix(in srgb, ' + P.gold + ' 15%, transparent)');

    applyRailVars(node);
  }

  /**
   * The eval rail's own custom properties, from the ANALYSIS metrics.
   *
   * The explorer reuses `.an-eval` verbatim — one rail, one stylesheet block, which is what
   * `swift_layout_check.js` §4e's "only ONE vertical eval bar" means in the browser. That block
   * reads `--an-*`, and those are set by `analysis.js` on the ANALYSIS root, which this screen is
   * not inside. So they are set here too, from the same table, never restated as numbers.
   *
   * `--an-board-edge` is deliberately NOT among them: the rail's height is this screen's board
   * edge, and `.op-eval` overrides it with `--op-boardEdge`. Setting the analysis one here would
   * give the rail the other screen's height.
   */
  function applyRailVars(node) {
    var A = analysisMetrics();
    function set(k, v) { node.style.setProperty(k, v); }
    set('--an-rail-w', A.railWidth() + 'px');
    set('--an-rail-r', A.EVAL_BAR.railRadius + 'px');
    set('--an-rail-pad-v', A.EVAL_BAR.railPaddingV + 'px');
    set('--an-rail-gap', A.EVAL_BAR.railGap + 'px');
    set('--an-eval-anim', A.TIMINGS.evalBarAnimation + 'ms');
    set('--an-fs-rail', A.evalLabelFontSize() + 'px');
    set('--an-eval-track', A.PALETTE.evalTrack);
    set('--an-eval-fill', A.PALETTE.evalFill);
    set('--an-on-gold', A.PALETTE.onGold);
    set('--an-text', A.PALETTE.textPrimary);
  }

  /* ---- shared chrome ------------------------------------------------------- */

  function header(title, onBack) {
    var h = el('div', 'op-header');
    // `nav-icon` is not decoration: it carries the shared icon size AND Apple's 44px minimum hit
    // width, which none of the hand-rolled back buttons had. `nav_icons_check.js` fails a button
    // without it. `el`'s third argument is textContent, so the markup is set explicitly.
    var back = el('button', 'op-back nav-icon');
    back.innerHTML = BiyaIcons.back();
    back.onclick = onBack;
    h.appendChild(back);
    h.appendChild(el('div', 'op-title', title));
    h.appendChild(el('div', 'op-balance'));
    return h;
  }

  /* ---- list ---------------------------------------------------------------- */

  function renderList(view, store, handlers) {
    var root = el('div', 'op-view');
    applyMetrics(root);
    root.appendChild(header(MET.STRINGS.title, handlers.onExit));

    var trees = store.trees();
    if (!trees.length) {
      var empty = el('div', 'op-empty');
      empty.appendChild(el('div', 'op-empty-icon', MET.STRINGS.emptyIcon));
      empty.appendChild(el('div', 'op-empty-title', MET.STRINGS.empty));
      empty.appendChild(el('div', 'op-empty-sub', MET.STRINGS.emptySub));
      root.appendChild(empty);
    } else {
      var list = el('div', 'op-list');
      trees.forEach(function (t) {
        var card = el('div', 'op-card');
        var main = el('div', 'op-card-main');
        main.appendChild(el('div', 'op-tree-name', t.name));
        main.appendChild(el('div', 'op-tree-meta', ST.metaLine(t)));
        card.appendChild(main);

        var actions = el('div', 'op-card-actions');
        var open = el('button', 'op-load', MET.STRINGS.load);
        open.onclick = function () { handlers.onOpen(t.id); };
        actions.appendChild(open);
        var del = el('button', 'op-delete', MET.STRINGS.remove);
        del.onclick = function () { handlers.onDelete(t.id); };
        actions.appendChild(del);
        card.appendChild(actions);
        list.appendChild(card);
      });
      root.appendChild(list);
    }

    var footer = el('div', 'op-footer');
    var build = el('button', 'op-build', MET.STRINGS.newTree);
    build.onclick = handlers.onBuild;
    footer.appendChild(build);
    root.appendChild(footer);

    view.appendChild(root);
  }

  /* ---- build form ---------------------------------------------------------- */

  /** Form state is held by the caller so a repaint cannot lose a half-typed PGN. */
  function renderForm(view, form, handlers) {
    var root = el('div', 'op-view');
    applyMetrics(root);
    root.appendChild(header(MET.STRINGS.title, handlers.onCancel));

    var body = el('div', 'op-form');

    function label(text) { return el('div', 'op-label', text.toUpperCase()); }

    body.appendChild(label(MET.STRINGS.colourLabel));
    body.appendChild(toggleRow(['white', 'black', 'both'], form.colour, function (v) {
      form.colour = v; handlers.onChanged();
    }, function (v) { return v.charAt(0).toUpperCase() + v.slice(1); }));

    body.appendChild(label(MET.STRINGS.sourceLabel));
    body.appendChild(toggleRow(MET.SOURCES.map(function (s) { return s.id; }), form.source,
      function (v) { form.source = v; form.error = null; handlers.onChanged(); },
      function (v) { return MET.sourceById(v).label; }));

    if (MET.isOnlineSource(form.source)) {
      body.appendChild(label(MET.STRINGS.userLabel));
      var user = el('input', 'op-input');
      user.type = 'text';
      user.placeholder = MET.STRINGS.userPlaceholder;
      user.value = form.username;
      user.oninput = function () { form.username = user.value; };
      body.appendChild(user);

      body.appendChild(label(MET.STRINGS.maxLabel));
      var max = el('input', 'op-input');
      // `text`, not `number`. A number input renders spinners the phone frame has no room for and
      // reports '' for anything it dislikes, which is indistinguishable from an empty box —
      // `resolvedMax` already clamps, so the strict input would only hide typing from it.
      max.type = 'text';
      max.inputMode = 'numeric';
      max.placeholder = MET.STRINGS.maxPlaceholder;
      max.value = form.maxGames;
      max.oninput = function () { form.maxGames = max.value; };
      body.appendChild(max);
    } else if (form.source === 'pgn') {
      body.appendChild(label(MET.STRINGS.pgnLabel));
      var pgn = el('textarea', 'op-input op-textarea');
      pgn.placeholder = MET.STRINGS.pgnPlaceholder;
      pgn.value = form.pgn;
      pgn.oninput = function () { form.pgn = pgn.value; };
      body.appendChild(pgn);
    }

    // The app's only networked path says so on screen. Not a warning — the difference between
    // "this feature is broken" and "this one button needs the radio".
    var online = MET.isOnlineSource(form.source);
    var note = el('div', 'op-note');
    note.appendChild(el('div', 'op-note-title',
      online ? MET.STRINGS.onlineNote : MET.STRINGS.offlineNote));
    note.appendChild(el('div', 'op-note-sub',
      online ? MET.STRINGS.onlineNoteSub : MET.STRINGS.offlineNoteSub));
    body.appendChild(note);

    // The live counter, drawn only while a download is running. It borrows the connectivity note's
    // box rather than introducing a fourth panel style — same slot, same kind of statement.
    if (form.downloading) {
      var prog = el('div', 'op-note');
      prog.appendChild(el('div', 'op-note-title', MET.STRINGS.fetching));
      prog.appendChild(el('div', 'op-note-sub',
        MET.fill(MET.STRINGS.fetched, { n: form.fetched || 0 })));
      body.appendChild(prog);
    }

    if (form.error) body.appendChild(el('div', 'op-error', form.error));

    var submit = el('button', 'op-submit',
      form.downloading ? MET.STRINGS.building : MET.STRINGS.build);
    // Disabled rather than hidden. A second click would start a SECOND download into the same
    // tree and double every count in it — a bug that reads as "the numbers are wrong", never as
    // "I double-clicked".
    submit.disabled = !!form.downloading;
    submit.onclick = function () { if (!form.downloading) handlers.onSubmit(); };
    body.appendChild(submit);

    root.appendChild(body);
    view.appendChild(root);
  }

  function toggleRow(values, active, onPick, labelFor) {
    var row = el('div', 'op-toggles');
    values.forEach(function (v) {
      var b = el('button', 'op-toggle' + (v === active ? ' active' : ''), labelFor(v));
      b.onclick = function () { onPick(v); };
      row.appendChild(b);
    });
    return row;
  }

  /* ---- explorer ------------------------------------------------------------ */

  function renderExplorer(view, store, handlers) {
    var root = el('div', 'op-view');
    applyMetrics(root);
    var open = store.open();
    root.appendChild(header(open ? open.name : MET.STRINGS.title, handlers.onClose));

    var boardWrap = el('div', 'op-board');
    var board = explorerBoard(store, handlers.onPlay);
    // The rail, LEFT of the board and a sibling of it — never a wrapper. It is the SAME rail the
    // Analysis Board draws: same `.an-eval` class, same `.fill`/`.lbl` children, same
    // `.an-eval.off { display: none }`. Only where its height comes from is this screen's.
    var rail = el('div', 'an-eval op-eval' + (engineState.on ? '' : ' off'));
    var fill = el('div', 'fill');
    var lbl = el('div', 'lbl');
    rail.appendChild(fill);
    rail.appendChild(lbl);
    boardWrap.appendChild(rail);
    boardWrap.appendChild(board);
    root.appendChild(boardWrap);
    paintEval(fill, lbl);
    sizeExplorer(root, view);

    root.appendChild(engineToggle(handlers.onEngineToggle));
    root.appendChild(enginePanel());

    root.appendChild(el('div', 'op-history', store.historyText()));

    var nav = el('div', 'op-nav');
    nav.appendChild(navBtn(MET.STRINGS.back, store.canStepBack(), handlers.onBack));
    nav.appendChild(navBtn(MET.STRINGS.reset, store.canStepBack(), handlers.onReset));
    nav.appendChild(navBtn(MET.STRINGS.forward, store.canStepForward(), handlers.onForward));
    root.appendChild(nav);

    var moves = store.candidates();
    if (store.isOffBook()) {
      // A NOTE, not an error — you have not done anything wrong by looking at a position your
      // games never reached. It borrows the form's connectivity-note box rather than inventing
      // geometry: zero new layout keys, so §9's property audit stays green untouched.
      var chip = el('div', 'op-offbook');
      chip.appendChild(el('div', 'op-offbook-title', MET.STRINGS.offBook));
      chip.appendChild(el('div', 'op-offbook-sub',
        store.atFreeLimit() ? MET.STRINGS.offBookLimit : MET.STRINGS.offBookSub));
      var out = el('button', 'op-navbtn', MET.STRINGS.backToTree);
      out.onclick = handlers.onBackToTree;
      chip.appendChild(out);
      root.appendChild(chip);
    } else if (!moves.length) {
      root.appendChild(el('div', 'op-nomoves', MET.STRINGS.noMoves));
    } else {
      var list = el('div', 'op-moves');
      moves.forEach(function (c) { list.appendChild(moveRow(c, handlers.onPlay)); });
      root.appendChild(list);
    }

    view.appendChild(root);
  }

  /** The chess engine, resolved lazily — `engine.js` sets a global under a script tag. */
  function E() {
    if (typeof Engine !== 'undefined') return Engine;
    if (isNode) return require('./engine.js');
    throw new Error('openings.js needs engine.js — load it first');
  }

  /** What the component needs before a piece can be picked up. Same shape as coach-play.js's. */
  function rulesAdapter() {
    return {
      legalMovesFrom: function (fen, sq) {
        var e = E(), pos = e.fromFEN(fen);
        if (!pos) return [];
        return e.legalMovesFrom(pos, sq).map(function (m) {
          return { to: m.to, promotion: m.promotion };
        });
      }
    };
  }

  /**
   * A board move as the STORE's vocabulary, which is SAN.
   *
   * The component reports UCI; the path is SAN. Resolving it through `E.san` — the same function
   * `opening-tree.js` canonicalises with — is what makes a board move land on the tree's own
   * branch. Spell it by hand and `Qxf7+` goes onto a path whose tree holds `Qxf7`: the board
   * advances, the move list empties, an ON-book move reads as off book, and nothing says why. It
   * would look exactly like the feature working.
   *
   * Null when it does not resolve; the caller drops it.
   */
  function sanFromUci(fen, uci) {
    var e = E(), pos = e.fromFEN(fen);
    if (!pos) return null;
    var m = e.parseUci(pos, uci);
    return m ? e.san(pos, m) : null;
  }

  /**
   * The explorer's board.
   *
   * Exported for the same reason `coach-play.js` exports its own: `board_component_test.js` must
   * drive a real pointer through the SCREEN's wiring, in the screen's own order, rather than
   * through a board the test configured itself — which is exactly how the coach drag shipped dead
   * through 34,000 green assertions.
   *
   * It used to be read-only, on the reasoning that "navigation is the move LIST's job, so a tap on
   * the board would be a second, silently different way to walk the tree". That was right while the
   * tree was the only thing you could walk. Playing your own move is not a second way to walk the
   * tree — it is the way you LEAVE it, which is what the client asked for.
   */
  function explorerBoard(store, onPlay) {
    var open = store.open();
    var b = document.createElement('chess-board');
    b.setAttribute('coordinates', '');
    // `setPosition`, not the `fen` ATTRIBUTE: the attribute carries no last move, which is why this
    // board has never highlighted one while its Swift twin always has.
    if (b.setPosition) b.setPosition(store.fen(), { animate: false, lastMove: store.lastMove() });
    // The PROPERTY. `flipped` is attribute-truthy for every value but the literal 'false', so
    // `flipped="0"` would be upside down for White.
    b.flipped = !!(open && open.colour === 'black');
    b.rules = rulesAdapter();
    // Both, or the drag is dead: the component attaches NO pointer handlers until a screen asks.
    b.draggablePieces = true;
    b.addEventListener('move', function (ev) {
      var d = ev && ev.detail;
      if (!d) return;
      var san = sanFromUci(store.fen(), d.uci);
      if (san) onPlay(san);
    });
    return b;
  }

  /**
   * The board's width, through the ONE entry point.
   *
   * Both the board and the rail read `--op-boardEdge`, so they cannot disagree about how wide the
   * board is — the failure the Analysis Board's own `edge` function exists to prevent. Measured
   * from the view rather than assumed: the phone frame is a real element with a real width.
   */
  function sizeExplorer(root, view) {
    var box = view.getBoundingClientRect ? view.getBoundingClientRect() : { width: 0 };
    var w = box.width || view.clientWidth || 0;
    if (!w) return;
    root.style.setProperty('--op-boardEdge', MET.boardEdge(w, engineState.on) + 'px');
  }

  /**
   * The rail's fill and label.
   *
   * `MET` here is the OPENING metrics; the fraction and the label placement are the ANALYSIS ones,
   * because it is the analysis rail. `evalFractionFor` carries the branch a bare fraction cannot:
   * a delivered mate pins the rail to a full 1, where a mate four moves away is 0.95.
   */
  function paintEval(fill, lbl) {
    var A = analysisMetrics();
    var AN = isNode ? require('./analysis-engine.js') : BiyaAnalysis;
    var snap = engineState.snapshot;
    var f = snap ? AN.evalFractionFor(AN.evalPartsOf(snap)) : A.evalBarFraction(null, null);
    fill.style.height = (f * 100) + '%';
    lbl.className = 'lbl ' + (A.evalLabelAtBottom(f) ? 'bottom' : 'top');
    // ONE formatter, the same one the rows' eval column uses — the rail and row 1 are two
    // projections of the same score and cannot disagree.
    lbl.textContent = snap && snap.score ? AN.formatScore(snap.score) : '';
  }

  /** `alignSelf: flex-start` in the RN source, so it hugs the left rather than stretching. */
  function engineToggle(onToggle) {
    var wrap = el('div', 'op-engine-toggle-row');
    var b = el('button', 'op-engine-toggle' + (engineState.on ? ' on' : ''),
      engineState.on ? MET.STRINGS.engineOn : MET.STRINGS.engineOff);
    b.onclick = onToggle;
    wrap.appendChild(b);
    return wrap;
  }

  /**
   * The three best lines, or what is happening instead.
   *
   * The rows are NOT clickable, and that is a decision rather than an omission: `store.play` would
   * append a SAN the tree has no node for, so a control that looks exactly like the candidate rows
   * below would silently take you off book. Playing an engine move is what the BOARD is for.
   */
  function enginePanel() {
    var panel = el('div', 'op-engine' + (engineState.on ? '' : ' off'));
    if (!engineState.on) return panel;

    // The spinner shows only while there is nothing to show — once lines exist the depth chip's
    // trailing `…` carries the same information without the panel jumping.
    if (!engineState.rows.length) {
      if (engineState.analyzing) {
        panel.appendChild(el('div', 'op-engine-status', MET.STRINGS.engineAnalyzing));
      }
      return panel;
    }

    engineState.rows.forEach(function (row) {
      var line = el('div', 'op-erow');
      var ev = el('div', 'op-eeval', row.evalText);
      ev.style.color = MET.engineEvalInk(row.evalText);
      line.appendChild(ev);
      var san = el('div', 'op-esan', row.san);
      san.style.color = MET.engineRankColor(row.rank);
      line.appendChild(san);
      line.appendChild(el('div', 'op-epv', row.continuation));
      panel.appendChild(line);
    });
    panel.appendChild(el('div', 'op-edepth',
      MET.fill(engineState.analyzing ? MET.STRINGS.engineDepthBusy : MET.STRINGS.engineDepth,
               { n: engineState.rows[0].depth })));
    return panel;
  }

  function navBtn(text, enabled, onTap) {
    var b = el('button', 'op-navbtn' + (enabled ? '' : ' disabled'), text);
    if (enabled) b.onclick = onTap; else b.disabled = true;
    return b;
  }

  function moveRow(c, onPlay) {
    var row = el('button', 'op-move');
    row.onclick = function () { onPlay(c.san); };
    row.appendChild(el('div', 'op-san', c.san));

    var stats = el('div', 'op-stats');
    var line = el('div', 'op-statline');
    line.appendChild(el('span', 'op-count', c.count + MET.STRINGS.gamesSuffix));
    line.appendChild(el('span', 'op-wdl',
      MET.fill(MET.STRINGS.wdl, { w: c.wins, d: c.draws, l: c.losses })));
    stats.appendChild(line);

    // Three proportional segments over a track. Widths rather than the RN `flex:` trick, which
    // cannot express "nothing scored" — three zero-flex children collapse and the bar vanishes.
    var bar = el('div', 'op-bar');
    [['win', c.wins], ['draw', c.draws], ['loss', c.losses]].forEach(function (pair) {
      var seg = el('div', 'op-seg op-seg-' + pair[0]);
      seg.style.width = (OT.share(c, pair[1]) * 100) + '%';
      bar.appendChild(seg);
    });
    stats.appendChild(bar);
    row.appendChild(stats);

    if (c.hasContinuations) row.appendChild(el('div', 'op-chevron', '›'));
    return row;
  }

  /* ---- the one entry point ------------------------------------------------- */

  /**
   * Leaf renderer: owns its own clear of `#view`, per the contract in docs/web-demo.md.
   * `mode` is the router's, so a repaint cannot lose which of the three screens is up.
   */
  function render(view, store, form, mode, handlers) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    if (mode === 'form') renderForm(view, form, handlers);
    else if (store.open()) renderExplorer(view, store, handlers);
    else renderList(view, store, handlers);
  }

  /**
   * The form's submit, still a PURE function — so the router stays a router and this stays
   * testable without a DOM or a network.
   *
   * Returns one of three things: `{ tree }` when the games were already on the device,
   * `{ error }`, or `{ download }` — a plan naming the site, the username, the colour and the
   * ceiling. It never fetches. The router awaits the plan and comes back through `submitGames`,
   * which is the same tail the paste path takes.
   *
   * It used to return `{ error: errNetwork }` for both online sources: "Could not reach that
   * site. Check your connection and try again.", for a download that had never been written. That
   * is the bug the client reported as *"hindi nag-oopening tree"* — the message is
   * indistinguishable from a real outage, so they checked their wifi and reported the app.
   */
  function submit(form, nowMs, isPremium) {
    if (form.source === 'coach') return { error: MET.STRINGS.errNoCoachGames };
    if (MET.isOnlineSource(form.source)) {
      var user = String(form.username || '').trim();
      if (!user) return { error: MET.STRINGS.errNoUser };
      return {
        download: {
          site: form.source,
          username: user,
          colour: form.colour,
          // The screen is behind the trial gate, so `isPremium` is true for anyone who can see
          // this form; it is still read rather than assumed, because the gate is a product
          // decision and this is a limit.
          limit: DL().resolvedMax(isPremium !== false, form.maxGames)
        }
      };
    }

    if (!String(form.pgn || '').trim()) return { error: MET.STRINGS.errNoPgn };
    var games = OT.gamesFromPGN(form.pgn, {
      fallbackIsWhite: form.colour !== 'black',
      colour: form.colour
    });
    if (!games.length) return { error: MET.STRINGS.errNoGames };

    // Built BEFORE the emptiness check, not after. `mainlineTokens` is a tokenizer, not a
    // validator: `"not a game"` comes back as three move tokens and would pass a `games.length`
    // test while producing a tree with nothing in it. Only the replay knows whether the PGN held
    // any chess, so the check is on POSITIONS.
    // '', not `form.username`. Switching from Lichess to Paste PGN leaves the username behind in
    // the form, and naming a pasted tree after an account whose games are not in it is worse than
    // naming it plainly.
    var built = ST.build({ games: games, name: MET.autoName('', form.colour),
                           colour: form.colour,
                           source: form.source, username: form.username || '', nowMs: nowMs });
    if (!built.positionCount) return { error: MET.STRINGS.errNoGames };
    return { tree: built };
  }

  /**
   * The downloaded half's tail — build, or say why not. The same three checks the paste path ends
   * on, in the same order, because a tree built from Lichess and a tree built from a pasted export
   * of the same games must be the same tree.
   *
   * A username that exists but has no games in the chosen colour comes back as `errUnknownUser`
   * rather than `errNetwork`: it is not a connection problem, and telling the user to check their
   * connection sends them to fix the one thing that is working.
   */
  function submitGames(form, games, nowMs) {
    if (!games || !games.length) return { error: MET.STRINGS.errUnknownUser };
    // Only the online sources reach here, so the username is always the account just downloaded.
    var built = ST.build({ games: games, name: MET.autoName(form.username, form.colour),
                           colour: form.colour, source: form.source,
                           username: form.username || '', nowMs: nowMs });
    if (!built.positionCount) return { error: MET.STRINGS.errNoGames };
    return { tree: built };
  }

  function emptyForm() {
    return {
      colour: 'both', source: 'pgn', pgn: '', username: '',
      maxGames: MET.STRINGS.maxDefault, downloading: false, fetched: 0, error: null
    };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    var f = emptyForm();
    // There is no name to give and none to refuse: the form has no such field any more, so the
    // FIRST thing a bare form can be wrong about is its PGN.
    expect(f.name === undefined, 'the form carries no name of its own');
    expect(MET.STRINGS.errNoName === undefined,
      'and the error for a missing one is gone with it');
    expect(submit(f, 1).error === MET.STRINGS.errNoPgn, 'an empty PGN is refused');
    f.pgn = 'not a game';
    expect(submit(f, 1).error === MET.STRINGS.errNoGames, 'unparseable PGN is refused');

    f.pgn = '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 1-0\n';
    var ok = submit(f, 1234);
    expect(!ok.error && ok.tree, 'a real PGN builds');
    expect(ok.tree.name === 'Pasted games · both' && ok.tree.gameCount === 1,
      'named for the source it came from, since a paste has no account behind it');
    expect(ok.tree.createdAtMs === 1234, 'and the injected clock, never Date.now()');

    // The two online sources return a PLAN, not an apology. This is the assertion that used to
    // read `errNetwork === 'and then says the download is not wired'` — it pinned the client's bug
    // in place, which is why 346 green expectations never saw it.
    f.source = 'lichess';
    expect(submit(f, 1).error === MET.STRINGS.errNoUser, 'an online source needs a username');
    f.username = '  someone  ';
    var plan = submit(f, 1, true);
    expect(!plan.error && !!plan.download, 'and with one it plans a download');
    expect(plan.download.site === 'lichess', 'naming the site');
    expect(plan.download.username === 'someone', 'the TRIMMED username');
    expect(plan.download.colour === f.colour, 'the colour');
    expect(plan.download.limit === 100, 'and the default ceiling');
    f.maxGames = '900';
    expect(submit(f, 1, true).download.limit === 900, 'a premium box raises it');
    expect(submit(f, 1, false).download.limit === 100, 'a free one does not');
    f.source = 'chesscom';
    expect(submit(f, 1, true).download.site === 'chesscom', 'chess.com plans too');
    f.source = 'coach';
    expect(submit(f, 1).error === MET.STRINGS.errNoCoachGames, 'coach games still say so');

    // The downloaded tail — same three checks as the paste path, same order.
    var d = emptyForm();
    d.source = 'lichess';
    d.username = 'someone';
    expect(submitGames(d, [], 5).error === MET.STRINGS.errUnknownUser,
      'no games back is a username problem, NOT a connection one');
    // THE highest-risk line in the interactive board, exercised directly.
    //
    // The component reports UCI and the store's path is SAN. Return the UCI unresolved and the
    // board still advances, the move list empties, an ON-book move reads as off book, and nothing
    // anywhere says why — it looks exactly like the feature working. There is no other symptom, so
    // this is the assertion that has to exist.
    var startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(sanFromUci(startFen, 'e2e4') === 'e4',
      'a board move resolves to the SAN the tree is keyed by, not the UCI the component reports — '
      + 'got ' + JSON.stringify(sanFromUci(startFen, 'e2e4')));
    expect(sanFromUci(startFen, 'g1f3') === 'Nf3', 'and a knight move too');
    expect(sanFromUci(startFen, 'e2e5') === null, 'an illegal move resolves to nothing');
    expect(sanFromUci('not a fen', 'e2e4') === null, 'and so does an unreadable position');

    var built = submitGames(d, [{ sanMoves: ['e4', 'c5'], userIsWhite: true, outcome: '1-0' }], 5);
    expect(!built.error && built.tree.gameCount === 1, 'and real games build a tree');
    expect(built.tree.source === 'lichess' && built.tree.username === 'someone',
      'which remembers where it came from');
    // The client's actual request, asserted: the tree names itself after the account it was built
    // from. `analysis-board/openingtree.tsx:531` builds the same string.
    expect(built.tree.name === 'someone · both',
      'and names itself after the account and side, never a label the user had to invent — got '
      + JSON.stringify(built.tree.name));
    var dw = emptyForm();
    dw.source = 'chesscom'; dw.username = '  Hikaru  '; dw.colour = 'white';
    expect(submitGames(dw, [{ sanMoves: ['e4'], userIsWhite: true, outcome: '1-0' }], 5)
      .tree.name === 'Hikaru · white', 'the username is trimmed and the side follows it');
    expect(built.tree.createdAtMs === 5, 'on the injected clock');

    // The colour filter reaches the builder.
    var g = emptyForm();
    g.name = 'Black only';
    g.colour = 'black';
    g.pgn = '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 1-0\n';
    var blackOnly = submit(g, 1);
    // fallbackIsWhite is false for a black tree, so the one game counts as the owner's black game.
    expect(!blackOnly.error && blackOnly.tree.gameCount === 1,
      'a black tree keeps a game with no name match');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'Openings: ' + passed + ' assertions passed'
        : 'Openings: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    render: render,
    submit: submit,
    submitGames: submitGames,
    emptyForm: emptyForm,
    applyMetrics: applyMetrics,
    board: explorerBoard,
    sanFromUci: sanFromUci,
    setEngine: setEngine,
    engineOn: engineOn,
    selfTest: selfTest
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaOpenings; }
