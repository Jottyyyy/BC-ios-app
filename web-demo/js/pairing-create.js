/* pairing-create.js — the Create Tournament screen (spec 1.3).
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/PairingScreens.swift`. The only screen in this feature with
 * local state, and it is deliberately trivial: the four fields of a form that has not been
 * submitted yet. Nothing is written until `Create` is pressed.
 *
 * Every number comes from `pairing-metrics.js` as a `--pgc-*` custom property. No numeric literal
 * below.
 */
'use strict';

var BiyaPairingCreate = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./pairing-metrics.js') : BiyaPairingMetrics;
  var ST = isNode ? require('./pairing-store.js') : BiyaPairingStore;
  var ENG = isNode ? require('./pairing-engine.js') : BiyaPairing;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    MET.applyAll(node, 'pgc', MET.CREATE);
    node.style.setProperty('--pgc-create-btn-shadow',
      MET.shadow(MET.CREATE.createBtn, MET.CREATE.createBtn.shadowColor));
  }

  /** The four presets from the source, plus the free-entry field beside them. */
  var PRESETS = [3, 5, 7, 9];

  function sectionLabel(text) { return el('div', 'pgc-label', text); }

  function typeCard(state, type, glyph, name, desc, onPick) {
    var active = state.type === type;
    var accent = MET.typeColor(type);
    var c = el('button', 'pgc-type' + (active ? ' on' : ''));
    if (active) {
      c.style.borderColor = accent;
      // The selected fill is the accent at 6 % — the source writes it as an explicit rgba, so it
      // is an extracted style, not a computed tint.
      c.style.backgroundColor = (type === ST.SWISS
        ? MET.CREATE.typeCardActive : MET.CREATE.typeCardActiveRR).backgroundColor;
    }
    var icon = el('div', 'pgc-type-icon', glyph);
    icon.style.backgroundColor = active ? accent : MET.CREATE.typeIcon.backgroundColor
      || MET.COLORS.setup;
    c.appendChild(icon);
    var nm = el('div', 'pgc-type-name', name);
    if (active) nm.style.color = accent;
    c.appendChild(nm);
    c.appendChild(el('div', 'pgc-type-desc', desc));
    c.onclick = function () { onPick(type); };
    return c;
  }

  /**
   * `cb` is `{ onCreated(id), onExit() }`.
   *
   * `playerCount` is only ever known after creation, so the live round recommendation shows the
   * guidance for the number the organiser has typed — which is the honest thing it can say before
   * anybody has been added. It replaces the RN screen's `Free: max 3 rounds` notice.
   */
  function render(view, cb) {
    var T = MET.STR;
    cb = cb || {};
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var state = { name: '', type: ST.SWISS, rounds: PRESETS[0], expected: 0 };

    var root = el('div', 'pgc-view');
    applyMetrics(root);

    var header = el('div', 'pgc-header');
    var back = el('button', 'pgc-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (cb.onExit) cb.onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pgc-title', T.newTournament));
    header.appendChild(BiyaIcons.brandLogoEl('pgc-logo'));
    root.appendChild(header);

    var body = el('div', 'pgc-body');

    // 1. Name
    body.appendChild(sectionLabel(T.nameLabel));
    var nameInput = el('input', 'pgc-input');
    nameInput.type = 'text';
    nameInput.setAttribute('placeholder', T.namePlaceholder);
    nameInput.setAttribute('maxlength', String(MET.LIMITS.nameMax));
    nameInput.oninput = function () { state.name = nameInput.value; refresh(); };
    body.appendChild(nameInput);

    // 2. Format
    var formatLabel = sectionLabel(T.formatLabel);
    formatLabel.classList.add('pgc-spaced');
    body.appendChild(formatLabel);
    var typeRow = el('div', 'pgc-type-row');
    body.appendChild(typeRow);

    // 3 / 4. Rounds (Swiss) or the round-robin note
    var roundsWrap = el('div', 'pgc-rounds-wrap');
    body.appendChild(roundsWrap);

    root.appendChild(body);

    var footer = el('div', 'pgc-footer');
    var createBtn = el('button', 'pgc-create', T.createTournament);
    createBtn.style.boxShadow = MET.shadow(MET.CREATE.createBtn, MET.CREATE.createBtn.shadowColor);
    createBtn.onclick = function () {
      // Validation is a visible message, not a silent substitution. The RN screen turned a typed
      // `0` into 3 with no feedback and let `99` through to a server 422.
      if (!state.name.trim()) { showRequired(root); return; }
      var doc = ST.load();
      var id = ST.create(doc, { name: state.name, type: state.type, totalRounds: state.rounds },
                         new Date().getTime());
      if (id == null) { showRequired(root); return; }
      ST.save(doc);
      if (cb.onCreated) cb.onCreated(id);
    };
    footer.appendChild(createBtn);
    root.appendChild(footer);

    function refresh() {
      typeRow.innerHTML = '';
      var pick = function (t) { state.type = t; refresh(); };
      typeRow.appendChild(typeCard(state, ST.SWISS, T.swissGlyph, T.swiss, T.swissDesc, pick));
      typeRow.appendChild(typeCard(state, ST.ROUND_ROBIN, T.roundRobinGlyph, T.roundRobin,
                                   T.roundRobinDesc, pick));

      roundsWrap.innerHTML = '';
      if (state.type === ST.SWISS) {
        var lbl = sectionLabel(T.roundsLabel);
        lbl.classList.add('pgc-spaced');
        roundsWrap.appendChild(lbl);
        var row = el('div', 'pgc-rounds-row');
        PRESETS.forEach(function (n) {
          var b = el('button', 'pgc-round' + (state.rounds === n ? ' on' : ''), String(n));
          b.onclick = function () { state.rounds = n; refresh(); };
          row.appendChild(b);
        });
        var free = el('input', 'pgc-round-input');
        free.type = 'text';
        free.setAttribute('placeholder', T.roundsPlaceholder);
        free.setAttribute('maxlength', '2');
        free.value = PRESETS.indexOf(state.rounds) < 0 ? String(state.rounds) : '';
        free.oninput = function () {
          var n = parseInt(free.value, 10);
          // Clamped, and the clamp is what the store applies too — one rule, not two.
          if (isFinite(n)) {
            state.rounds = Math.min(MET.LIMITS.roundsMax, Math.max(MET.LIMITS.roundsMin, n));
          }
          refresh();
        };
        row.appendChild(free);
        roundsWrap.appendChild(row);
        // The live recommendation, in place of the deleted free-plan limit notice.
        var n = state.expected > 1 ? state.expected : PRESETS[PRESETS.length - 1];
        roundsWrap.appendChild(el('div', 'pgc-hint',
                                  T.recommended(n, ENG.recommendedRounds(n))));
      } else {
        var note = el('div', 'pgc-rr-note');
        note.appendChild(el('div', 'pgc-rr-note-text', T.rrNote));
        roundsWrap.appendChild(note);
      }

      createBtn.disabled = !state.name.trim();
      createBtn.classList.toggle('off', !state.name.trim());
    }

    refresh();
    view.appendChild(root);
    if (nameInput.focus) nameInput.focus();
  }

  function showRequired(root) {
    var T = MET.STR;
    var scrim = el('div', 'pz-modal-scrim');
    var box = el('div', 'pz-modal-box');
    box.appendChild(el('div', 'pz-modal-title', T.required));
    box.appendChild(el('div', 'pz-modal-body', T.enterName));
    var row = el('div', 'pz-modal-row');
    var ok = el('button', 'pz-modal-btn pz-modal-keep', T.cancel);
    ok.onclick = function () { scrim.remove(); };
    row.appendChild(ok);
    box.appendChild(row);
    scrim.appendChild(box);
    root.appendChild(scrim);
    return scrim;
  }

  return { render: render, applyMetrics: applyMetrics, PRESETS: PRESETS };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairingCreate; }
