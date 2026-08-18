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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

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

    body.appendChild(label(MET.STRINGS.nameLabel));
    var name = el('input', 'op-input');
    name.type = 'text';
    name.placeholder = MET.STRINGS.namePlaceholder;
    name.value = form.name;
    name.oninput = function () { form.name = name.value; };
    body.appendChild(name);

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

    if (form.error) body.appendChild(el('div', 'op-error', form.error));

    var submit = el('button', 'op-submit', MET.STRINGS.build);
    submit.onclick = function () { handlers.onSubmit(); };
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
    var board = document.createElement('chess-board');
    board.setAttribute('fen', store.fen());
    board.setAttribute('coordinates', '');
    // Read-only: navigation is the move LIST's job, so a tap on the board would be a second,
    // silently different way to walk the tree.
    if (open && open.colour === 'black') board.setAttribute('flipped', '');
    boardWrap.appendChild(board);
    root.appendChild(boardWrap);

    root.appendChild(el('div', 'op-history', store.historyText()));

    var nav = el('div', 'op-nav');
    nav.appendChild(navBtn(MET.STRINGS.back, store.canStepBack(), handlers.onBack));
    nav.appendChild(navBtn(MET.STRINGS.reset, store.canStepBack(), handlers.onReset));
    nav.appendChild(navBtn(MET.STRINGS.forward, store.canStepForward(), handlers.onForward));
    root.appendChild(nav);

    var moves = store.candidates();
    if (!moves.length) {
      root.appendChild(el('div', 'op-nomoves', MET.STRINGS.noMoves));
    } else {
      var list = el('div', 'op-moves');
      moves.forEach(function (c) { list.appendChild(moveRow(c, handlers.onPlay)); });
      root.appendChild(list);
    }

    view.appendChild(root);
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
   * The form's submit, as a pure function of the form and the games it can reach — so the router
   * stays a router and this is testable without a DOM.
   *
   * Returns `{ tree }` or `{ error }`. The two ONLINE sources are declared and drawn (a form that
   * hid them would be lying about what the feature is) but not wired: the download belongs beside
   * the Swift `ContentClient`, and a second `fetch` in a click handler is exactly the leak that
   * rule exists to prevent.
   */
  function submit(form, nowMs) {
    var name = String(form.name || '').trim();
    if (!name) return { error: MET.STRINGS.errNoName };

    if (form.source === 'coach') return { error: MET.STRINGS.errNoCoachGames };
    if (MET.isOnlineSource(form.source)) {
      if (!String(form.username || '').trim()) return { error: MET.STRINGS.errNoUser };
      return { error: MET.STRINGS.errNetwork };
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
    var built = ST.build({ games: games, name: name, colour: form.colour,
                           source: form.source, username: form.username || '', nowMs: nowMs });
    if (!built.positionCount) return { error: MET.STRINGS.errNoGames };
    return { tree: built };
  }

  function emptyForm() {
    return { name: '', colour: 'both', source: 'pgn', pgn: '', username: '', error: null };
  }

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    var f = emptyForm();
    expect(submit(f, 1).error === MET.STRINGS.errNoName, 'a nameless tree is refused');
    f.name = 'Mine';
    expect(submit(f, 1).error === MET.STRINGS.errNoPgn, 'an empty PGN is refused');
    f.pgn = 'not a game';
    expect(submit(f, 1).error === MET.STRINGS.errNoGames, 'unparseable PGN is refused');

    f.pgn = '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 c5 1-0\n';
    var ok = submit(f, 1234);
    expect(!ok.error && ok.tree, 'a real PGN builds');
    expect(ok.tree.name === 'Mine' && ok.tree.gameCount === 1, 'with the name and one game');
    expect(ok.tree.createdAtMs === 1234, 'and the injected clock, never Date.now()');

    // The two online sources are reachable in the form and refuse politely rather than silently.
    f.source = 'lichess';
    expect(submit(f, 1).error === MET.STRINGS.errNoUser, 'an online source needs a username');
    f.username = 'someone';
    expect(submit(f, 1).error === MET.STRINGS.errNetwork, 'and then says the download is not wired');
    f.source = 'coach';
    expect(submit(f, 1).error === MET.STRINGS.errNoCoachGames, 'coach games say so too');

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
    emptyForm: emptyForm,
    applyMetrics: applyMetrics,
    selfTest: selfTest
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaOpenings; }
