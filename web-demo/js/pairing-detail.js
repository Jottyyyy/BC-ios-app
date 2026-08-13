/* pairing-detail.js — Tournament Detail: Players / Rounds / Standings (spec 1.4–1.6).
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/PairingDetailScreens.swift`. The largest screen in the
 * feature and still stateless about data — every mutation goes through `pairing-store.js` and the
 * screen repaints from the document. The only things it remembers are which tab and which round you
 * were looking at, and those live at module scope for the same reason the router holds the
 * tournament id: `render()` runs again on every repaint, so anything kept inside it is lost.
 *
 * Every number comes from `pairing-metrics.js` as a `--pgd-*` custom property. No numeric literal
 * below.
 */
'use strict';

var BiyaPairingDetail = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./pairing-metrics.js') : BiyaPairingMetrics;
  var ST = isNode ? require('./pairing-store.js') : BiyaPairingStore;
  var ENG = isNode ? require('./pairing-engine.js') : BiyaPairing;

  var TAB_PLAYERS = 0, TAB_ROUNDS = 1, TAB_STANDINGS = 2;
  var tab = TAB_PLAYERS;
  var openRound = 1;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'pgd', MET.DETAIL);
    MET.applyAll(node, 'pgs', MET.SHARE);
    node.style.setProperty('--pgd-generate-shadow',
      MET.shadow(MET.DETAIL.generateBtn, MET.DETAIL.generateBtn.shadowColor));
    // The standings widths are inline styles in the source, and the round-selector gap has no
    // source at all; both are pushed explicitly rather than folded into the block sweep.
    MET.applyAll(node, 'pgd', { col: MET.COLS, layout: MET.LAYOUT });
  }

  // ---- Result badges ---------------------------------------------------------------------------

  /**
   * Exhaustive (spec 7 #20).
   *
   * The RN code was a chain that fell through to `½-½` for anything it did not recognise, so a
   * corrupt result rendered as a draw — a wrong answer that looks like a right one. Here an
   * unrecognised value returns `null` and the caller draws the pending badge, which is visibly
   * "we don't know" rather than invisibly "it was a draw".
   */
  function resultBadge(result) {
    var T = MET.STR;
    if (result === ST.WHITE_WIN) return T.resultWhite;
    if (result === ST.BLACK_WIN) return T.resultBlack;
    if (result === ST.DRAW) return T.resultDraw;
    if (result === ST.PENDING) return T.vs;
    if (result === ST.BYE) return T.vs;
    return null;
  }

  // ---- Modals ----------------------------------------------------------------------------------

  function modal(root, title, sub) {
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box pgd-modal');
    box.appendChild(el('div', 'pz-modal-title', title));
    if (sub) box.appendChild(el('div', 'pgd-modal-sub', sub));
    scrim.appendChild(box);
    root.appendChild(scrim);
    return { scrim: scrim, box: box };
  }

  function field(box, label, placeholder, numeric) {
    box.appendChild(el('div', 'pgd-modal-label', label));
    var input = el('input', 'pgd-modal-input');
    input.type = numeric ? 'number' : 'text';
    input.setAttribute('placeholder', placeholder);
    box.appendChild(input);
    return input;
  }

  function actions(box, cancelText, confirmText, onCancel, onConfirm) {
    var row = el('div', 'pgd-modal-actions');
    var cancel = el('button', 'pgd-modal-cancel', cancelText);
    cancel.onclick = onCancel;
    var ok = el('button', 'pgd-modal-confirm', confirmText);
    ok.onclick = onConfirm;
    row.appendChild(cancel); row.appendChild(ok);
    box.appendChild(row);
    return ok;
  }

  function addPlayerModal(root, t, changed) {
    var T = MET.STR;
    var m = modal(root, T.addPlayer, null);
    var name = field(m.box, T.nameRequired, T.playerNamePlaceholder, false);
    var full = field(m.box, T.fullName, T.optional, false);
    var rating = field(m.box, T.ncfpRating, T.optional, true);
    actions(m.box, T.cancel, T.add,
      function () { m.scrim.remove(); },
      function () {
        var doc = ST.load();
        if (ST.addPlayer(doc, t.id, { name: name.value, fullName: full.value,
                                      rating: rating.value }) != null) {
          ST.save(doc);
        }
        m.scrim.remove();
        if (changed) changed();
      });
    return m.scrim;
  }

  function bulkAddModal(root, t, changed) {
    var T = MET.STR;
    var m = modal(root, T.bulkAddTitle, T.bulkAddSub);
    var area = el('textarea', 'pgd-modal-area');
    area.setAttribute('placeholder', T.bulkPlaceholder);
    m.box.appendChild(area);
    var ok = actions(m.box, T.cancel, T.addNPlayers(0),
      function () { m.scrim.remove(); },
      function () {
        var doc = ST.load();
        if (ST.bulkAdd(doc, t.id, area.value)) ST.save(doc);
        m.scrim.remove();
        if (changed) changed();
      });
    // The confirm label counts live, so you can see what the parser made of what you pasted before
    // you commit to it.
    area.oninput = function () { ok.textContent = T.addNPlayers(ST.bulkCount(area.value)); };
    return m.scrim;
  }

  function resultModal(root, t, round, board, changed) {
    var T = MET.STR;
    var white = ST.player(t, board.white);
    var black = ST.player(t, board.black);
    var m = modal(root, T.enterResult, T.board(board.board));

    var players = el('div', 'pgd-result-players');
    players.appendChild(el('div', 'pgd-result-white', white ? white.name : ''));
    players.appendChild(el('div', 'pgd-result-vs', T.vs));
    players.appendChild(el('div', 'pgd-result-black', black ? black.name : ''));
    m.box.appendChild(players);

    var apply = function (res) {
      var doc = ST.load();
      if (ST.setResult(doc, t.id, round.number, board.board, res)) ST.save(doc);
      m.scrim.remove();
      if (changed) changed();
    };

    [[ST.WHITE_WIN, 'white', T.resultWhiteBig, T.resultWhiteSub],
     [ST.DRAW, 'draw', T.resultDrawBig, T.resultDrawSub],
     [ST.BLACK_WIN, 'black', T.resultBlackBig, T.resultBlackSub]].forEach(function (r) {
      var b = el('button', 'pgd-result-btn pgd-result-' + r[1]);
      b.appendChild(el('div', 'pgd-result-main', r[2]));
      b.appendChild(el('div', 'pgd-result-sub', r[3]));
      b.onclick = function () { apply(r[0]); };
      m.box.appendChild(b);
    });

    // The fourth option the RN app had no way to express (spec 1.5, 7 #23). Only shown when there
    // is something to clear.
    if (board.result !== ST.PENDING) {
      var clear = el('button', 'pgd-result-clear', T.clearResult);
      clear.onclick = function () { apply(ST.PENDING); };
      m.box.appendChild(clear);
    }

    var cancel = el('button', 'pgd-result-cancel', T.cancel);
    cancel.onclick = function () { m.scrim.remove(); };
    m.box.appendChild(cancel);
    return m.scrim;
  }

  function confirmRemove(root, t, p, changed) {
    var T = MET.STR;
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', T.removeTitle));
    box.appendChild(el('div', 'pz-modal-body', T.removeBody(p.name)));
    var row = el('div', 'pz-modal-row');
    var cancel = el('button', 'pz-modal-btn pz-modal-keep', T.cancel);
    cancel.onclick = function () { scrim.remove(); };
    var del = el('button', 'pz-modal-btn pz-modal-danger', T.remove);
    del.onclick = function () {
      scrim.remove();
      var doc = ST.load();
      if (ST.removePlayer(doc, t.id, p.id)) { ST.save(doc); if (changed) changed(); }
    };
    row.appendChild(cancel); row.appendChild(del);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
    return scrim;
  }

  // ---- Share (spec 1.6) --------------------------------------------------------------------------

  /**
   * The plain-text fallback. **No URL** (spec 7 #22) — the RN version pasted its ngrok tunnel into
   * every shared message, which is both broken and a leak.
   */
  function roundText(t, round) {
    var T = MET.STR;
    var lines = [T.textBrand, T.textRule, T.textTrophy + t.name,
                 T.textClipboard + T.shareSubtitle(round.number, ST.totalRoundsOf(t),
                                                   MET.typeLabel(t.type)), ''];
    round.boards.forEach(function (b) {
      var w = ST.player(t, b.white);
      if (b.isBye) { lines.push(T.textBoard(b.board) + (w ? w.name : '') + T.textBye); return; }
      var bl = ST.player(t, b.black);
      lines.push(T.textBoard(b.board) + (w ? w.name : '') + '  ' + (resultBadge(b.result) || T.vs)
                 + '  ' + (bl ? bl.name : ''));
    });
    lines.push('', T.hashtags);
    return lines.join('\n');
  }

  function standingsText(t) {
    var T = MET.STR;
    var lines = [T.textBrand, T.textRule, T.textTrophy + t.name, ''];
    ST.standings(t).forEach(function (p, i) {
      var rank = String(i + 1) + '.';
      while (rank.length < 3) rank += ' ';
      lines.push(rank + ' ' + p.name + '  ' + ENG.formatScore(p.score)
                 + '  ' + p.wins + 'W ' + p.draws + 'D ' + p.losses + 'L');
    });
    lines.push('', T.hashtags);
    return lines.join('\n');
  }

  function share(text) {
    if (typeof navigator === 'undefined') return;
    if (navigator.share) navigator.share({ text: text })['catch'](function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text)['catch'](function () {});
  }

  // ---- Tabs --------------------------------------------------------------------------------------

  function playersTab(root, t, changed) {
    var T = MET.STR;
    var wrap = el('div', 'pgd-tabbody');
    var setup = ST.status(t) === ST.SETUP;

    if (!t.players.length) {
      wrap.appendChild(el('div', 'pgd-empty', T.noPlayers));
    } else {
      // Seed order during setup, SCORE order once play has started — which is what an organiser
      // wants to look at, and what the RN screen did.
      //
      // This ordering is what makes the seed fix observable at all. While the list is in seed order
      // with dense seeds, the row index and the seed are the same number, so "show `player.seed`"
      // and "show the row index" are indistinguishable — the mutation suite proved exactly that by
      // surviving. Under score order they diverge, which is the situation the RN bug shipped in.
      //
      // A sorted COPY (spec 7 #16): the RN code called `.sort()` on the state array during render.
      var rows = t.players.slice().sort(function (a, b) {
        if (setup) return a.seed - b.seed;
        if (b.score !== a.score) return b.score - a.score;
        return a.seed - b.seed;
      });
      rows.forEach(function (p) {
        var row = el('div', 'pgd-player');
        // `p.seed`, never the row index (spec 7 #15). The RN app printed the position in a
        // score-sorted list, so the numbers shown were never the seeds the schedule used.
        row.appendChild(el('div', 'pgd-seed', String(p.seed)));
        var info = el('div', 'pgd-player-info');
        info.appendChild(el('div', 'pgd-player-name', p.name));
        if (p.rating != null) info.appendChild(el('div', 'pgd-player-rating', T.ncfp(p.rating)));
        row.appendChild(info);
        if (setup) {
          var rm = el('button', 'pgd-remove', T.removeGlyph);
          rm.onclick = function () { confirmRemove(root, t, p, changed); };
          row.appendChild(rm);
        } else {
          row.appendChild(el('div', 'pgd-player-score', ENG.formatScore(p.score)));
        }
        wrap.appendChild(row);
      });
    }

    if (setup) {
      var foot = el('div', 'pgd-player-actions');
      var bulk = el('button', 'pgd-action-secondary', T.bulkAdd);
      bulk.onclick = function () { bulkAddModal(root, t, changed); };
      var add = el('button', 'pgd-action', T.addPlayerBtn);
      add.onclick = function () { addPlayerModal(root, t, changed); };
      foot.appendChild(bulk); foot.appendChild(add);
      wrap.appendChild(foot);
    }
    return wrap;
  }

  function roundsTab(root, t, changed) {
    var T = MET.STR;
    var wrap = el('div', 'pgd-tabbody');
    var finished = ST.status(t) === ST.FINISHED;

    if (t.rounds.length) {
      if (openRound > t.rounds.length) openRound = t.rounds.length;
      var sel = el('div', 'pgd-round-sel');
      t.rounds.forEach(function (r) {
        var chip = el('button', 'pgd-round-chip'
          + (r.number === openRound ? ' on' : '')
          + (ST.roundComplete(r) ? ' done' : ''), T.roundChip(r.number));
        chip.onclick = function () { openRound = r.number; if (changed) changed(); };
        sel.appendChild(chip);
      });
      var shareBtn = el('button', 'pgd-round-share', T.share);
      shareBtn.onclick = function () {
        share(roundText(t, ST.roundOf(t, openRound) || t.rounds[0]));
      };
      sel.appendChild(shareBtn);
      wrap.appendChild(sel);

      var round = ST.roundOf(t, openRound) || t.rounds[0];
      round.boards.forEach(function (b) {
        var c = el('div', 'pgd-pairing');
        c.appendChild(el('div', 'pgd-board', String(b.board)));
        var w = ST.player(t, b.white);
        if (b.isBye) {
          c.appendChild(el('div', 'pgd-bye', T.byeLine(w ? w.name : '')));
          wrap.appendChild(c);
          return;
        }
        var bl = ST.player(t, b.black);
        var left = el('div', 'pgd-side');
        left.appendChild(el('div', 'pgd-dot pgd-dot-w'));
        var wn = el('div', 'pgd-pname' + (b.result === ST.WHITE_WIN ? ' win' : ''),
                    w ? w.name : '');
        left.appendChild(wn);
        c.appendChild(left);

        var label = resultBadge(b.result);
        var decided = b.result !== ST.PENDING && label !== null;
        var badge = el('div', 'pgd-badge' + (decided ? ' done' : ''), label || T.vs);
        c.appendChild(badge);

        var right = el('div', 'pgd-side pgd-side-r');
        var bn = el('div', 'pgd-pname' + (b.result === ST.BLACK_WIN ? ' win' : ''),
                    bl ? bl.name : '');
        right.appendChild(bn);
        right.appendChild(el('div', 'pgd-dot pgd-dot-b'));
        c.appendChild(right);

        if (!finished || b.result !== ST.PENDING) {
          c.onclick = function () { resultModal(root, t, round, b, changed); };
        }
        wrap.appendChild(c);
      });

      // The engine's compromises, surfaced rather than swallowed (spec 1.7.7, 1.11).
      if (round.warnings && round.warnings.length) {
        var notes = el('div', 'pgd-notes');
        notes.appendChild(el('div', 'pgd-notes-title', T.pairingNotes));
        round.warnings.forEach(function (w) {
          var line = w.kind === 'repeatPairing' ? T.warnRepeat(w.a, w.b)
                   : w.kind === 'repeatBye' ? T.warnBye(w.name)
                   : T.warnColor(w.name);
          notes.appendChild(el('div', 'pgd-note', line));
        });
        wrap.appendChild(notes);
      }
    } else {
      wrap.appendChild(el('div', 'pgd-empty',
        t.players.length < 2 ? T.needTwoPlayers : T.generateToStart));
    }

    if (finished) {
      wrap.appendChild(el('div', 'pgd-finished', T.tournamentComplete));
    } else if (ST.canGenerate(t)) {
      var gen = el('button', 'pgd-generate',
        t.type === ST.ROUND_ROBIN ? T.generateSchedule : T.generateRound(t.rounds.length + 1));
      gen.style.boxShadow = MET.shadow(MET.DETAIL.generateBtn, MET.DETAIL.generateBtn.shadowColor);
      gen.onclick = function () {
        var doc = ST.load();
        if (ST.generate(doc, t.id)) {
          ST.save(doc);
          openRound = ST.tournament(doc, t.id).rounds.length;
        }
        if (changed) changed();
      };
      wrap.appendChild(gen);
    }
    return wrap;
  }

  function standingsTab(root, t) {
    var T = MET.STR;
    var wrap = el('div', 'pgd-tabbody');
    if (!t.players.length) {
      wrap.appendChild(el('div', 'pgd-empty', T.noPlayersToDisplay));
      return wrap;
    }

    var head = el('div', 'pgd-st-head');
    [['rank', T.colRank], ['name', T.colPlayer], ['pts', T.colPts], ['w', T.colW],
     ['d', T.colD], ['l', T.colL], ['bch', T.colBch], ['sb', T.colSB]].forEach(function (c) {
      head.appendChild(el('div', 'pgd-st-col pgd-st-' + c[0], c[1]));
    });
    wrap.appendChild(head);

    // ONE comparator, the same one the share text uses (spec 7 #13).
    ST.standings(t).forEach(function (p, i) {
      var first = i === 0;
      var row = el('div', 'pgd-st-row' + (i % 2 === 0 ? ' alt' : '') + (first ? ' first' : ''));
      // Rank 1 gold, ON SCREEN as well as in the share image (spec 7 #14) — the RN styles for this
      // existed and were only ever applied to the image.
      row.appendChild(el('div', 'pgd-st-col pgd-st-rank' + (first ? ' gold' : ''), String(i + 1)));
      var nameCell = el('div', 'pgd-st-col pgd-st-name');
      nameCell.appendChild(el('div', 'pgd-st-pname', p.name));
      if (p.rating != null) nameCell.appendChild(el('div', 'pgd-st-prating', T.ncfp(p.rating)));
      row.appendChild(nameCell);
      row.appendChild(el('div', 'pgd-st-col pgd-st-pts', ENG.formatScore(p.score)));
      row.appendChild(el('div', 'pgd-st-col pgd-st-w', String(p.wins)));
      row.appendChild(el('div', 'pgd-st-col pgd-st-d', String(p.draws)));
      row.appendChild(el('div', 'pgd-st-col pgd-st-l', String(p.losses)));
      row.appendChild(el('div', 'pgd-st-col pgd-st-bch', ENG.formatScore(p.buchholz)));
      row.appendChild(el('div', 'pgd-st-col pgd-st-sb', ENG.formatScore(p.sonnebornBerger)));
      wrap.appendChild(row);
    });

    var shareBtn = el('button', 'pgd-st-share', T.shareStandings);
    shareBtn.onclick = function () { share(standingsText(t)); };
    wrap.appendChild(shareBtn);
    return wrap;
  }

  // ---- Render -------------------------------------------------------------------------------------

  /** `cb` is `{ onExit(), onChanged() }`. */
  function render(view, id, cb) {
    var T = MET.STR;
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var root = el('div', 'pgd-view');
    applyMetrics(root);
    var doc = ST.load();
    var t = ST.tournament(doc, id);

    var header = el('div', 'pgd-header');
    var back = el('button', 'pgd-back', T.back);
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    header.appendChild(back);

    // A tournament deleted from under this screen gets an empty state, not a blank box and not a
    // spinner that never resolves (spec 7 #19).
    if (!t) {
      header.appendChild(el('div', 'pgd-header-title', T.deletedTitle));
      root.appendChild(header);
      var gone = el('div', 'pgd-empty-screen');
      gone.appendChild(el('div', 'pgd-empty-title', T.deletedTitle));
      gone.appendChild(el('div', 'pgd-empty-sub', T.deletedBody));
      root.appendChild(gone);
      view.appendChild(root);
      return;
    }

    var centre = el('div', 'pgd-header-center');
    centre.appendChild(el('div', 'pgd-header-title', t.name));
    var meta = el('div', 'pgd-header-meta');
    var badge = el('div', 'pgd-header-badge', MET.typeLabel(t.type));
    badge.style.borderColor = MET.typeColor(t.type);
    badge.style.color = MET.typeColor(t.type);
    meta.appendChild(badge);
    meta.appendChild(el('div', 'pgd-header-rounds',
                        T.roundsMeta(t.rounds.length, ST.totalRoundsOf(t))));
    centre.appendChild(meta);
    header.appendChild(centre);
    header.appendChild(el('div', 'pgd-logo'));
    root.appendChild(header);

    var tabs = el('div', 'pgd-tabs');
    [[TAB_PLAYERS, T.playersTab(t.players.length)], [TAB_ROUNDS, T.roundsTab],
     [TAB_STANDINGS, T.standingsTab]].forEach(function (spec) {
      var b = el('button', 'pgd-tab' + (tab === spec[0] ? ' on' : ''), spec[1]);
      b.onclick = function () { tab = spec[0]; if (cb.onChanged) cb.onChanged(); };
      tabs.appendChild(b);
    });
    root.appendChild(tabs);

    if (tab === TAB_ROUNDS) root.appendChild(roundsTab(root, t, cb.onChanged));
    else if (tab === TAB_STANDINGS) root.appendChild(standingsTab(root, t));
    else root.appendChild(playersTab(root, t, cb.onChanged));

    view.appendChild(root);
  }

  /** The tab is module state; the tests and the router both need to be able to set it. */
  function setTab(i) { tab = i; }
  function setRound(n) { openRound = n; }

  return {
    render: render, applyMetrics: applyMetrics,
    resultBadge: resultBadge, roundText: roundText, standingsText: standingsText,
    setTab: setTab, setRound: setRound,
    TAB_PLAYERS: TAB_PLAYERS, TAB_ROUNDS: TAB_ROUNDS, TAB_STANDINGS: TAB_STANDINGS,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairingDetail; }
