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
    var name = String(form.name || '').trim();
    if (!name) return { error: MET.STRINGS.errNoName };

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
    var built = ST.build({ games: games, name: name, colour: form.colour,
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
    var built = ST.build({ games: games, name: String(form.name || '').trim(),
                           colour: form.colour, source: form.source,
                           username: form.username || '', nowMs: nowMs });
    if (!built.positionCount) return { error: MET.STRINGS.errNoGames };
    return { tree: built };
  }

  function emptyForm() {
    return {
      name: '', colour: 'both', source: 'pgn', pgn: '', username: '',
      maxGames: MET.STRINGS.maxDefault, downloading: false, fetched: 0, error: null
    };
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
    d.name = 'Downloaded';
    d.source = 'lichess';
    d.username = 'someone';
    expect(submitGames(d, [], 5).error === MET.STRINGS.errUnknownUser,
      'no games back is a username problem, NOT a connection one');
    var built = submitGames(d, [{ sanMoves: ['e4', 'c5'], userIsWhite: true, outcome: '1-0' }], 5);
    expect(!built.error && built.tree.gameCount === 1, 'and real games build a tree');
    expect(built.tree.source === 'lichess' && built.tree.username === 'someone',
      'which remembers where it came from');
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
    selfTest: selfTest
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaOpenings; }
