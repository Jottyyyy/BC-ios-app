/* pairing-list.js — the Tournament List (spec 1.2).
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/PairingScreens.swift`. Stateless: the document lives in
 * `pairing-store.js` and is handed in, so a repaint cannot lose anything and the screen has nothing
 * of its own to keep in sync.
 *
 * Every number comes from `pairing-metrics.js`, pushed onto the root as `--pgl-*` custom properties
 * by `MET.applyAll`. There is no numeric literal below.
 */
'use strict';

var BiyaPairingList = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./pairing-metrics.js') : BiyaPairingMetrics;
  var ST = isNode ? require('./pairing-store.js') : BiyaPairingStore;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'pgl', MET.LIST);
    // The shadow quartet has no single CSS property, so it is composed rather than pushed.
    node.style.setProperty('--pgl-fab-shadow', MET.shadow(MET.LIST.fab, MET.LIST.fab.shadowColor));
  }

  /**
   * "Mar 12", in the DEVICE's calendar (spec 7 #21).
   *
   * The RN app rendered `created_at` — a UTC ISO string — through `toLocaleDateString('en-PH')`,
   * so a tournament created at 06:00 Manila time displayed the previous day. Here the stored value
   * is an epoch millisecond and the formatter is given no timezone, so it uses the device's.
   */
  function createdLabel(ms) {
    var d = new Date(ms);
    try {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (e) {
      return String(d.getMonth() + 1) + '/' + String(d.getDate());
    }
  }

  var STATUS_LABEL = {};
  STATUS_LABEL[ST.SETUP] = 'statusSetup';
  STATUS_LABEL[ST.ONGOING] = 'statusOngoing';
  STATUS_LABEL[ST.FINISHED] = 'statusFinished';

  function statCell(value, label) {
    var cell = el('div', 'pgl-stat');
    cell.appendChild(el('div', 'pgl-stat-value', value));
    cell.appendChild(el('div', 'pgl-stat-label', label));
    return cell;
  }

  /**
   * The delete prompt. Nothing is removed until the user confirms (spec 7 #18) — the RN app fired
   * the request and dropped the row without ever checking the response, so a 422 looked like a
   * success.
   */
  function confirmDelete(root, t, done) {
    var T = MET.STR;
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', T.deleteTitle));
    box.appendChild(el('div', 'pz-modal-body', T.deleteBody(t.name)));
    var row = el('div', 'pz-modal-row');
    var cancel = el('button', 'pz-modal-btn pz-modal-keep', T.cancel);
    cancel.onclick = function () { scrim.remove(); };
    var del = el('button', 'pz-modal-btn pz-modal-danger', T.deleteAction);
    del.onclick = function () {
      scrim.remove();
      var doc = ST.load();
      if (ST.remove(doc, t.id)) { ST.save(doc); if (done) done(); }
    };
    row.appendChild(cancel); row.appendChild(del);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
    return scrim;
  }

  function card(root, t, cb) {
    var T = MET.STR;
    var c = el('button', 'pgl-card');
    var typeColor = MET.typeColor(t.type);
    var st = ST.status(t);

    var head = el('div', 'pgl-card-head');
    var badge = el('div', 'pgl-type-badge', MET.typeLabel(t.type));
    // Hex alpha by byte concatenation, exactly as the source writes it — not a rounded percent.
    badge.style.backgroundColor = MET.tint(typeColor, MET.TINT_BYTE);
    badge.style.borderColor = typeColor;
    badge.style.color = typeColor;
    head.appendChild(badge);

    var dot = el('div', 'pgl-status-dot');
    dot.style.backgroundColor = MET.statusColor(st);
    head.appendChild(dot);
    var stText = el('div', 'pgl-status-text', T[STATUS_LABEL[st]]);
    stText.style.color = MET.statusColor(st);
    head.appendChild(stText);
    head.appendChild(el('div', 'pgl-chevron', T.chevron));
    c.appendChild(head);

    c.appendChild(el('div', 'pgl-card-name', t.name));

    var stats = el('div', 'pgl-stats');
    stats.appendChild(statCell(String(t.players.length), T.players));
    stats.appendChild(el('div', 'pgl-stat-divider'));
    stats.appendChild(statCell(t.rounds.length + '/' + ST.totalRoundsOf(t), T.rounds));
    stats.appendChild(el('div', 'pgl-stat-divider'));
    stats.appendChild(statCell(createdLabel(t.createdAt), T.created));
    c.appendChild(stats);

    c.onclick = function () { if (cb.onOpen) cb.onOpen(t.id); };

    // Long press deletes. The headless harness cannot hold a pointer down, so the handler is also
    // hung on the node as `_longPress` and the pointer events below simply call it — the test then
    // exercises the REAL handler rather than a copy of it.
    c._longPress = function () { confirmDelete(root, t, cb.onChanged); };
    if (typeof setTimeout === 'function') {
      var timer = null;
      var cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
      c.onpointerdown = function () {
        cancel();
        timer = setTimeout(function () { timer = null; c._longPress(); }, MET.LIMITS.longPressMs);
      };
      c.onpointerup = cancel;
      c.onpointercancel = cancel;
      c.onpointerleave = cancel;
    }
    return c;
  }

  /**
   * `cb` is `{ onOpen(id), onCreate(), onExit(), onChanged() }`.
   *
   * `onChanged` is a repaint request, not a data callback: the screen has already written the
   * document by the time it fires.
   */
  function render(view, doc, cb) {
    var T = MET.STR;
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var root = el('div', 'pgl-view');
    applyMetrics(root);

    var header = el('div', 'pgl-header');
    var back = el('button', 'pgl-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    header.appendChild(back);
    var centre = el('div', 'pgl-header-center');
    centre.appendChild(el('div', 'pgl-title', T.tournaments));
    centre.appendChild(el('div', 'pgl-sub', T.listSub));
    header.appendChild(centre);
    header.appendChild(BiyaIcons.brandLogoEl('pgl-logo'));
    root.appendChild(header);

    var list = doc.tournaments;
    if (!list.length) {
      var empty = el('div', 'pgl-empty');
      empty.appendChild(el('div', 'pgl-empty-icon', T.emptyGlyph));
      empty.appendChild(el('div', 'pgl-empty-title', T.emptyTitle));
      empty.appendChild(el('div', 'pgl-empty-sub', T.emptySub));
      root.appendChild(empty);
    } else {
      var wrap = el('div', 'pgl-list');
      list.forEach(function (t) { wrap.appendChild(card(root, t, cb)); });
      wrap.appendChild(el('div', 'pgl-hint', T.longPressHint));
      root.appendChild(wrap);
    }

    var fab = el('button', 'pgl-fab');
    fab.style.boxShadow = MET.shadow(MET.LIST.fab, MET.LIST.fab.shadowColor);
    fab.appendChild(el('span', 'pgl-fab-icon', T.fabPlus));
    fab.appendChild(el('span', 'pgl-fab-text', T.newTournament));
    fab.onclick = function () { if (cb.onCreate) cb.onCreate(); };
    root.appendChild(fab);

    view.appendChild(root);
  }

  return { render: render, createdLabel: createdLabel, applyMetrics: applyMetrics };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairingList; }
