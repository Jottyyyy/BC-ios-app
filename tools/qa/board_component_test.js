#!/usr/bin/env node
/*
 * board_component_test.js — headless checks for the <chess-board> Web Component.
 *
 *     node tools/qa/board_component_test.js      # standalone; exit 0 means green
 *     (also runs as a suite inside tools/qa/js_goldens.js)
 *
 * Phase 7 gave `<chess-board>` an SVG arrow overlay and pointer-drag. Neither is expressible in
 * the pure-logic harness, because both are DOM behaviour — so this builds the smallest fake DOM
 * the component actually touches and drives it directly.
 *
 * Two things this is NOT:
 *   - a browser. It cannot prove layout, CSS cascade or real hit-testing. web-demo/index.html
 *     stays the acceptance check.
 *   - a rules engine. The `rules` adapter is stubbed, so these are interaction assertions only.
 *
 * What it IS good for is the regression that actually threatens this repo: drag support silently
 * killing tap-to-move in Play and Puzzles. The delegated click lives on `.squares`, so any layer
 * stacked above it without `pointer-events:none` breaks input everywhere — and that is asserted
 * here, on the real CSS text, alongside a full tap-to-move round trip with drag switched on.
 *
 * The component source is evaluated in a `vm` context with its own fake globals, so requiring this
 * module never touches the host's `document` / `window` / `customElements`.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..', '..');
var SOURCE = path.join(ROOT, 'web-demo', 'js', 'chess-board.js');

// ---- the fake DOM -----------------------------------------------------------
// Deliberately minimal: every method here exists because chess-board.js calls it.
function buildDom() {
  function Klass(el) { this.el = el; this.set = Object.create(null); }
  Klass.prototype.add = function () {
    for (var i = 0; i < arguments.length; i++) this.set[arguments[i]] = true;
    this.el._syncClass();
  };
  Klass.prototype.remove = function () {
    for (var i = 0; i < arguments.length; i++) delete this.set[arguments[i]];
    this.el._syncClass();
  };
  Klass.prototype.contains = function (c) { return !!this.set[c]; };
  Klass.prototype.toString = function () { return Object.keys(this.set).join(' '); };

  function El(tag, ns) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns || null;
    this.children = []; this.childNodes = this.children; this.parentNode = null;
    this.attrs = Object.create(null); this.dataset = {}; this.style = {};
    this._listeners = Object.create(null); this.classList = new Klass(this);
    this._className = ''; this.textContent = ''; this.offsetWidth = 0;
  }
  El.prototype._syncClass = function () { this._className = this.classList.toString(); };
  Object.defineProperty(El.prototype, 'className', {
    get: function () { return this._className; },
    set: function (v) {
      this._className = String(v || '');
      this.classList.set = Object.create(null);
      this._className.split(/\s+/).forEach(function (c) { if (c) this.classList.set[c] = true; }, this);
    }
  });
  Object.defineProperty(El.prototype, 'firstChild', {
    get: function () { return this.children[0] || null; }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return ''; },
    set: function (v) { if (v === '') this.children.length = 0; }
  });
  El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
  El.prototype.removeChild = function (c) {
    var i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null; return c;
  };
  El.prototype.setAttribute = function (n, v) {
    this.attrs[n] = String(v); if (n === 'class') this.className = String(v);
  };
  El.prototype.getAttribute = function (n) { return n in this.attrs ? this.attrs[n] : null; };
  El.prototype.hasAttribute = function (n) { return n in this.attrs; };
  El.prototype.removeAttribute = function (n) { delete this.attrs[n]; };
  El.prototype.addEventListener = function (t, f) {
    (this._listeners[t] = this._listeners[t] || []).push(f);
  };
  El.prototype.removeEventListener = function (t, f) {
    var a = this._listeners[t]; if (!a) return;
    var i = a.indexOf(f); if (i >= 0) a.splice(i, 1);
  };
  El.prototype.dispatchEvent = function (e) {
    e.target = e.target || this;
    var n = this;
    while (n) {
      (n._listeners[e.type] || []).slice().forEach(function (f) { f.call(n, e); });
      n = e.bubbles ? n.parentNode : null;
    }
    return true;
  };
  El.prototype.closest = function (sel) {
    var want = sel.replace('.', ''), n = this;
    while (n) { if (n.classList && n.classList.contains(want)) return n; n = n.parentNode; }
    return null;
  };
  El.prototype.getBoundingClientRect = function () {
    return this._rect || { left: 0, top: 0, width: 0, height: 0 };
  };
  El.prototype.setPointerCapture = function () { };
  El.prototype.releasePointerCapture = function () { };
  El.prototype.attachShadow = function () { this.shadowRoot = new El('shadow-root'); return this.shadowRoot; };

  function CustomEventShim(type, init) {
    init = init || {};
    this.type = type; this.detail = init.detail;
    this.bubbles = !!init.bubbles; this.composed = !!init.composed;
  }

  var registry = Object.create(null);
  // A MANUAL frame clock. The drag coalesces its writes into one rAF callback, and the only way to
  // assert "one transform per frame, however many pointer events arrived" is to control when a
  // frame happens. `flushFrames()` runs whatever is pending.
  var frames = [];
  var frameId = 0;
  var sandbox = {
    HTMLElement: El,
    CustomEvent: CustomEventShim,
    requestAnimationFrame: function (f) { frameId += 1; frames.push({ id: frameId, fn: f }); return frameId; },
    cancelAnimationFrame: function (id) {
      for (var i = 0; i < frames.length; i++) if (frames[i].id === id) { frames.splice(i, 1); return; }
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    document: {
      createElement: function (t) { return new El(t); },
      createElementNS: function (ns, t) { return new El(t, ns); }
    },
    customElements: {
      define: function (n, c) { registry[n] = c; },
      get: function (n) { return registry[n]; }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox, { filename: SOURCE });
  return {
    sandbox: sandbox, registry: registry, El: El, CustomEvent: CustomEventShim,
    flushFrames: function () {
      var due = frames.splice(0, frames.length);
      due.forEach(function (f) { f.fn(); });
      return due.length;
    },
    pendingFrames: function () { return frames.length; }
  };
}

// ---- the suite --------------------------------------------------------------
function selfTest() {
  var dom = buildDom();
  var Board = dom.registry['chess-board'];
  var CE = dom.CustomEvent;
  var passed = 0, failures = [], extra = 0;

  function check(ok, what) {
    if (ok) { passed++; return; }
    if (failures.length < 25) failures.push(what); else extra++;
  }
  function near(a, b, ctx) { check(Math.abs(a - b) < 1e-9, ctx + ': ' + a + ' != ' + b); }

  check(!!Board, 'chess-board registers itself');
  if (!Board) return report();

  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var E2 = 12, E4 = 28, E3 = 20, D2 = 11, E5 = 36, E7 = 52, E8 = 60;
  var SIZE = 800, SQ = SIZE / 8;

  // A board whose "engine" allows exactly the moves the case names.
  function makeBoard(opts) {
    var b = new Board();
    b.rules = {
      legalMovesFrom: function (fen, sq) {
        return (opts.targets[sq] || []).map(function (t) {
          return (typeof t === 'number') ? { to: t, promotion: null } : t;
        });
      }
    };
    if (opts.draggable) b.setAttribute('draggable-pieces', '');
    b.connectedCallback();
    b._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
    b.setPosition(opts.fen || START, { animate: false });
    return b;
  }
  function clickSquare(b, sq) {
    var e = new CE('click', { bubbles: true });
    e.target = b._cellBySq.get(sq);
    b._squaresEl.dispatchEvent(e);
  }
  // Client point at the centre of a square, honouring the current flip.
  function point(b, sq) {
    var file = sq & 7, rank = sq >> 3;
    var col = b._flipped ? 7 - file : file;
    var row = b._flipped ? rank : 7 - rank;
    return { clientX: col * SQ + SQ / 2, clientY: row * SQ + SQ / 2 };
  }
  function pointer(b, type, sq, dx, dy) {
    var p = point(b, sq);
    var e = {
      type: type, pointerId: 1, preventDefault: function () { },
      clientX: p.clientX + (dx || 0), clientY: p.clientY + (dy || 0)
    };
    (b._boardEl._listeners[type] || []).slice().forEach(function (f) { f.call(b._boardEl, e); });
  }
  function recorder(b) {
    var moves = [];
    b.addEventListener('move', function (e) { moves.push(e.detail); });
    return moves;
  }

  // -- 1. arrow geometry ------------------------------------------------------
  (function () {
    var b = makeBoard({ targets: {} });
    check(b.arrows.length === 0, 'arrows start empty');

    b.arrows = [{ from: E2, to: E4, rank: 0 }];
    check(b._overlayEl.getAttribute('viewBox') === '0 0 8 8', 'overlay viewBox is 8x8, so geometry is resolution-free');
    check(b._overlayEl.children.length === 2, 'one arrow renders a line plus a head, got ' + b._overlayEl.children.length);
    var line = b._overlayEl.children[0], head = b._overlayEl.children[1];
    check(line.tagName === 'LINE', 'shaft is a <line>');
    check(head.tagName === 'POLYGON', 'head is a <polygon>');
    // e2 is file 4 rank 1 -> visual col 4 row 6 -> centre (4.5, 6.5); e4 -> (4.5, 4.5)
    near(+line.getAttribute('x1'), 4.5, 'shaft x1');
    near(+line.getAttribute('y1'), 6.5, 'shaft y1');
    near(+line.getAttribute('x2'), 4.5, 'shaft x2 (vertical move, so unchanged)');
    near(+line.getAttribute('y2'), 4.5 + 0.35 * 0.7, 'shaft stops short of the tip');
    near(+line.getAttribute('stroke-width'), 0.18, 'shaft width is SQUARE * 0.18');
    check(head.getAttribute('points').indexOf('4.5,4.5 ') === 0,
      'head apex sits on the destination centre, got ' + head.getAttribute('points'));

    // rank drives colour, and the best line is painted last so it lands on top
    b.arrows = [{ from: E2, to: E4, rank: 1 }, { from: D2, to: E3, rank: 0 }];
    check(b._overlayEl.children.length === 4, 'two arrows render four nodes');
    var col = b._overlayEl.children.map(function (c) {
      return c.getAttribute('stroke') || c.getAttribute('fill');
    });
    check(col[0] === col[1] && col[2] === col[3], 'each arrow is drawn in a single colour');
    check(col[0].indexOf('68,138,255') >= 0, 'rank 1 is blue, got ' + col[0]);
    check(col[2].indexOf('76,175,80') >= 0, 'rank 0 is green and drawn last, got ' + col[2]);

    // a flip must move every endpoint — this is why _layoutCells redraws
    b.arrows = [{ from: E2, to: E4, rank: 0 }];
    b.flipped = true;
    var fl = b._overlayEl.children[0];
    near(+fl.getAttribute('x1'), 3.5, 'flipped shaft x1');
    near(+fl.getAttribute('y1'), 1.5, 'flipped shaft y1');
    near(+fl.getAttribute('y2'), 3.5 - 0.35 * 0.7, 'flipped shaft y2');

    b.arrows = [];
    check(b._overlayEl.children.length === 0, 'clearing arrows empties the overlay');
  })();

  // -- 2. stacking and hit-testing -------------------------------------------
  // The load-bearing invariant: the tap path is a delegated click on `.squares`, so nothing above
  // it may be hit-testable. Getting this wrong breaks Play and Puzzles, not just analysis.
  (function () {
    var b = makeBoard({ targets: {} });
    var css = b.shadowRoot.children[0].textContent;
    check(/\.overlay\{[^}]*pointer-events:none/.test(css), 'the arrow overlay is pointer-events:none');
    check(/\.pieces\{[^}]*pointer-events:none/.test(css), 'the piece layer is still pointer-events:none');
    check(/\.piece\.dragging\{[^}]*transition:none/.test(css), 'the drag ghost switches its slide transition off');
    check(/\.board\.draggable\{touch-action:none/.test(css), 'touch-action is only disabled on draggable boards');
    var order = b._boardEl.children;
    check(order.indexOf(b._squaresEl) < order.indexOf(b._piecesEl), 'squares render below pieces');
    check(order.indexOf(b._piecesEl) < order.indexOf(b._overlayEl), 'pieces render below the overlay');
    check(order.indexOf(b._overlayEl) < order.indexOf(b._promoEl), 'the overlay renders below the promotion sheet');
  })();

  // -- 3. tap-to-move regression ---------------------------------------------
  (function () {
    var plain = makeBoard({ targets: { 12: [E3, E4] } });
    var m1 = recorder(plain);
    clickSquare(plain, E2); clickSquare(plain, E4);
    check(m1.length === 1 && m1[0].uci === 'e2e4', 'tap-to-move works, got ' + JSON.stringify(m1));

    var dragging = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    check(dragging.draggablePieces === true, 'the draggable-pieces attribute is read at connect time');
    check(dragging._boardEl.classList.contains('draggable'), 'the draggable class is applied');
    var m2 = recorder(dragging);
    clickSquare(dragging, E2); clickSquare(dragging, E4);
    check(m2.length === 1 && m2[0].uci === 'e2e4', 'tap-to-move survives drag mode, got ' + JSON.stringify(m2));
  })();

  // -- 3b. the `tap` event (added for Setup Position) --------------------------
  // It must fire for EVERY square — including empty ones and a non-interactive board — because the
  // position editor needs "which square did you touch" with no notion of a legal move. And it must
  // not disturb tap-to-move, which is the input path Play and Puzzles depend on.
  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] } });
    var taps = [];
    b.addEventListener('tap', function (e) { taps.push(e.detail.square); });
    var moves = recorder(b);

    clickSquare(b, 35);                                  // an empty square with no targets
    check(taps.length === 1 && taps[0] === 35, 'tapping an empty square fires tap, got ' + JSON.stringify(taps));
    check(b._selected === null, 'and selects nothing');

    clickSquare(b, E2); clickSquare(b, E4);
    check(taps.join(',') === '35,12,28', 'every square fires exactly one tap, got ' + taps.join(','));
    check(moves.length === 1 && moves[0].uci === 'e2e4', 'and the move still fires alongside it');

    var off = makeBoard({ targets: { 12: [E3, E4] } });
    off.interactive = false;
    var offTaps = [], offMoves = recorder(off);
    off.addEventListener('tap', function (e) { offTaps.push(e.detail.square); });
    clickSquare(off, E2); clickSquare(off, E4);
    check(offTaps.join(',') === '12,28', 'a non-interactive board still reports taps, got ' + offTaps.join(','));
    check(offMoves.length === 0, 'but makes no moves — which is what edit mode relies on');

    // The click a completed drag leaves behind must not produce a phantom tap either.
    var d = makeBoard({ targets: { 12: [E3, E4], 28: [E5] }, draggable: true });
    var dTaps = [];
    d.addEventListener('tap', function (e) { dTaps.push(e.detail.square); });
    pointer(d, 'pointerdown', E2); pointer(d, 'pointermove', E4); pointer(d, 'pointerup', E4);
    clickSquare(d, E4);
    check(dTaps.length === 0, 'the swallowed post-drag click fires no tap, got ' + JSON.stringify(dTaps));
    clickSquare(d, E4);
    check(dTaps.length === 1, 'the next real click does');
  })();

  // -- 4. drag ----------------------------------------------------------------
  (function () {
    // The drop square is movable too — that is analysis mode, where both colours can move, and the
    // only configuration in which a leaked trailing click is observable.
    var b = makeBoard({ targets: { 12: [E3, E4], 28: [E5] }, draggable: true });
    var moves = recorder(b);
    pointer(b, 'pointerdown', E2);
    check(!!b._drag && b._drag.from === E2, 'pointerdown on a movable piece arms a drag');
    pointer(b, 'pointermove', E4);
    check(b._drag.moved === true, 'crossing the threshold starts the drag');
    check(b._drag.el.classList.contains('dragging'), 'the ghost gets the dragging class');
    // The visual work is deferred to a frame — that is the coalescing, asserted properly below.
    check(!b._cellBySq.get(E4).classList.contains('drophover'), 'nothing is painted before the frame');
    dom.flushFrames();
    check(b._cellBySq.get(E4).classList.contains('drophover'), 'the square under the pointer is highlighted');
    pointer(b, 'pointerup', E4);
    check(moves.length === 1 && moves[0].uci === 'e2e4',
      'a drag fires the same move event a tap does, got ' + JSON.stringify(moves));
    check(b._drag === null, 'drag state is cleared on drop');
    check(!b._cellBySq.get(E4).classList.contains('drophover'), 'the drop highlight is cleared');
    check(b._selected === null, 'committing the move cleared the selection');
    clickSquare(b, E4);
    check(b._selected === null, 'the click a drop generates is swallowed, got _selected=' + b._selected);
    check(b._suppressClick === false, 'the suppression flag is one-shot');
    clickSquare(b, E4);
    check(b._selected === E4, 'the next click selects as usual');
  })();


  // -- 4b. smoothness: the three things that made a drag feel laggy -------------
  //
  // All three were reported as one symptom ("may delay, hindi smooth"). Each is asserted here in
  // the form it actually took, because none of them is visible to a numbers-only suite.
  (function () {
    // (a) NO LAYOUT READS ON THE POINTERMOVE PATH.
    // `_onPointerMove` used to call getBoundingClientRect(), and `_squareAtPoint` called it AGAIN —
    // two forced layouts per event, at up to 120Hz. The rect is now read once, on pointerdown.
    var b = makeBoard({ targets: { 12: [E3, E4], 28: [E5] }, draggable: true });
    var reads = 0;
    var realRect = b._boardEl.getBoundingClientRect;
    b._boardEl.getBoundingClientRect = function () { reads += 1; return realRect.call(this); };

    pointer(b, 'pointerdown', E2);
    check(reads === 1, 'pointerdown reads the board rect exactly once, got ' + reads);
    check(b._rect !== null, 'and caches it for the drag');

    reads = 0;
    pointer(b, 'pointermove', E4);
    pointer(b, 'pointermove', E5);
    pointer(b, 'pointermove', E4);
    dom.flushFrames();
    check(reads === 0, 'no pointermove or frame reads the rect again, got ' + reads + ' reads');

    // (b) ONE WRITE PER FRAME, HOWEVER MANY EVENTS ARRIVE.
    var writes = 0;
    var ghost = b._drag.el;
    var lastTransform = ghost.style.transform;
    Object.defineProperty(ghost.style, 'transform', {
      configurable: true,
      get: function () { return lastTransform; },
      set: function (v) { writes += 1; lastTransform = v; }
    });
    pointer(b, 'pointermove', E5);
    pointer(b, 'pointermove', E4);
    pointer(b, 'pointermove', E5);
    check(writes === 0, 'three events inside one frame write nothing yet, got ' + writes);
    check(dom.pendingFrames() === 1, 'and schedule exactly one frame, got ' + dom.pendingFrames());
    dom.flushFrames();
    check(writes === 1, 'the frame writes the transform once, got ' + writes);

    // (c) AT MOST TWO CELLS CHANGE, NOT ALL 64.
    // The old code ran `_cells.forEach(remove('drophover'))` on every single pointer event.
    var touched = 0;
    b._cells.forEach(function (c) {
      var add = c.classList.add, rm = c.classList.remove;
      c.classList.add = function () { touched += 1; return add.apply(this, arguments); };
      c.classList.remove = function () { touched += 1; return rm.apply(this, arguments); };
    });
    pointer(b, 'pointermove', E4);
    dom.flushFrames();
    check(touched <= 2, 'moving to a new square touches at most 2 cells, got ' + touched);
    touched = 0;
    pointer(b, 'pointermove', E4);          // same square again
    dom.flushFrames();
    check(touched === 0, 'and staying on the same square touches none, got ' + touched);

    pointer(b, 'pointerup', E4);
    check(b._rect === null, 'the cached rect is released on drop');
    check(b._hoverSq === null, 'and the hover square is cleared');
    check(dom.pendingFrames() === 0, 'and no frame is left scheduled');
  })();

  // -- 4c. a drop lands where you let go ----------------------------------------
  //
  // It used to snap the piece back to its origin and then slide it to the target over 330ms once
  // the app repainted — you watched it jump home and travel back. chess.com and lichess leave it.
  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4], 28: [E5] }, draggable: true });
    var moves = recorder(b);
    pointer(b, 'pointerdown', E2);
    pointer(b, 'pointermove', E4);
    dom.flushFrames();
    pointer(b, 'pointerup', E4);
    check(moves.length === 1, 'the drop fires its move');
    check(b._justDropped === true, 'and flags the render that follows as a drop');

    // The app now applies the move and repaints, exactly as analysis.js/app.js do.
    var el = b._els.get(E2).el;
    var transitions = [];
    var realStyle = el.style;
    b.setPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
                  { animate: true, lastMove: { from: E2, to: E4 } });
    check(b._justDropped === false, 'the flag is one-shot');
    check(b._els.get(E4) && b._els.get(E4).el === el, 'the same element ended up on the target');
    check(Number(el.dataset.sq) === E4, 'placed on e4');

    // A TAP move, by contrast, must still animate — that is the whole point of the slide.
    var t = makeBoard({ targets: { 12: [E3, E4] } });
    clickSquare(t, E2); clickSquare(t, E4);
    check(t._justDropped === false, 'a tap never sets the drop flag');
  })();

  // -- 4d. the slide is quick and does not overshoot ----------------------------
  (function () {
    var raw = require('fs').readFileSync(require('path').join(
      require('path').resolve(__dirname, '..', '..'), 'web-demo', 'js', 'chess-board.js'), 'utf8');
    // Strip comments first: the source explains the OLD curve in a comment right above the new
    // rule, and a check that cannot tell a declaration from a description is worse than none.
    var css = raw.replace(/\/\/[^\r\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    check(/--piece-anim,\s*170ms/.test(css),
      'the slide defaults to 170ms — between lichess (~200) and chess.com (~150)');
    check(!/transition:transform \.33s/.test(css),
      'the springy 330ms slide is gone');
    check(!/cubic-bezier\(\.34,1\.15/.test(css),
      'and so is its overshoot curve, which read as bouncy rather than crisp');
    check(/transition:transform var\(--piece-anim/.test(css),
      'the duration is a CSS variable, so a host can retune it without forking the component');
  })();

  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    pointer(b, 'pointerdown', E2);
    pointer(b, 'pointermove', E2, 2, 1);          // 2.2px — under the 4px threshold
    check(b._drag.moved === false, 'a few pixels of jitter is not a drag');
    pointer(b, 'pointerup', E2);
    check(b._suppressClick === false, 'a sub-threshold press leaves the click alone');
  })();

  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    var moves = recorder(b);
    pointer(b, 'pointerdown', E2);
    pointer(b, 'pointermove', E5);
    pointer(b, 'pointerup', E5);
    check(moves.length === 0, 'dropping on an illegal square makes no move');
    check(b._selected === null, 'and clears the selection');
  })();

  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    pointer(b, 'pointerdown', E4);
    check(b._drag === null, 'a square with no legal moves never arms a drag');
  })();

  (function () {
    var b = makeBoard({
      fen: '8/4P3/8/8/8/8/8/4K2k w - - 0 1',
      targets: { 52: [{ to: E8, promotion: 4 }, { to: E8, promotion: 2 }] },
      draggable: true
    });
    var moves = recorder(b);
    pointer(b, 'pointerdown', E7);
    pointer(b, 'pointermove', E8);
    pointer(b, 'pointerup', E8);
    check(moves.length === 0, 'a promotion drag does not fire move immediately');
    check(!!b._pendingPromo && b._pendingPromo.to === E8, 'it opens the promotion sheet instead');
  })();

  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    b.flipped = true;
    var moves = recorder(b);
    pointer(b, 'pointerdown', E2);
    pointer(b, 'pointermove', E4);
    pointer(b, 'pointerup', E4);
    check(moves.length === 1 && moves[0].uci === 'e2e4',
      'drag maps points correctly on a flipped board, got ' + JSON.stringify(moves));
  })();

  (function () {
    var b = makeBoard({ targets: { 12: [E3, E4] }, draggable: true });
    b.draggablePieces = false;
    check(!b._boardEl.classList.contains('draggable'), 'disabling drag removes the class');
    pointer(b, 'pointerdown', E2);
    check(b._drag === null, 'and detaches the handlers');
    b.draggablePieces = true;
    pointer(b, 'pointerdown', E2);
    check(!!b._drag, 're-enabling re-attaches them');
  })();

  // -- 5. the component's arrow constants vs the metrics layer -----------------
  // chess-board.js is deliberately standalone — it does not require analysis-metrics.js, because
  // the component has to keep working on its own. That duplicates four ratios and three colours,
  // so assert them equal here rather than hoping. The overlay's viewBox is 8x8, i.e. one unit per
  // square, which is exactly `arrowGeometry` at square = 1.
  (function () {
    var MET;
    try { MET = require(path.join(ROOT, 'web-demo', 'js', 'analysis-metrics.js')); }
    catch (e) { check(false, 'analysis-metrics.js loads: ' + e.message); return; }

    // "rgba(76, 175, 80, 0.85)" and "rgba(76,175,80,.85)" are the same colour; compare numbers.
    function rgba(s) {
      var m = /rgba?\(([^)]+)\)/.exec(String(s));
      return m ? m[1].split(',').map(function (x) { return parseFloat(x); }) : null;
    }
    function sameColor(a, b) {
      var x = rgba(a), y = rgba(b);
      if (!x || !y || x.length !== y.length) return false;
      return x.every(function (v, i) { return Math.abs(v - y[i]) < 1e-6; });
    }

    var b = makeBoard({ targets: {} });
    // A knight move, so dx and dy differ and every term in the geometry is exercised.
    var cases = [[E2, E4, false], [0, 17, false], [E2, E4, true], [D2, E3, false]];
    cases.forEach(function (t) {
      b.flipped = t[2];
      b.arrows = [{ from: t[0], to: t[1], rank: 0 }];
      var want = MET.arrowGeometry(t[0], t[1], 1, t[2]);
      var line = b._overlayEl.children[0], head = b._overlayEl.children[1];
      var tag = t[0] + '->' + t[1] + (t[2] ? ' flipped' : '');
      near(+line.getAttribute('x1'), want.start.x, tag + ' start.x');
      near(+line.getAttribute('y1'), want.start.y, tag + ' start.y');
      near(+line.getAttribute('x2'), want.end.x, tag + ' end.x');
      near(+line.getAttribute('y2'), want.end.y, tag + ' end.y');
      near(+line.getAttribute('stroke-width'), want.strokeWidth, tag + ' stroke width');
      var pts = head.getAttribute('points').split(' ').map(function (p) {
        return p.split(',').map(Number);
      });
      near(pts[0][0], want.tip.x, tag + ' tip.x');
      near(pts[0][1], want.tip.y, tag + ' tip.y');
      near(pts[1][0], want.left.x, tag + ' left.x');
      near(pts[1][1], want.left.y, tag + ' left.y');
      near(pts[2][0], want.right.x, tag + ' right.x');
      near(pts[2][1], want.right.y, tag + ' right.y');
    });
    b.flipped = false;
    [0, 1, 2].forEach(function (rank) {
      b.arrows = [{ from: E2, to: E4, rank: rank }];
      check(sameColor(b._overlayEl.children[0].getAttribute('stroke'), MET.arrowColor(rank)),
        'rank ' + rank + ' colour matches the metrics layer, got '
        + b._overlayEl.children[0].getAttribute('stroke'));
    });
  })();

  // -- 6. properties set before the element is connected ----------------------
  // app.js assigns properties then appends, and attributeChangedCallback early-returns while
  // !_built — so connectedCallback has to pick both of these up.
  (function () {
    var b = new Board();
    b.rules = { legalMovesFrom: function (f, sq) { return sq === E2 ? [{ to: E4, promotion: null }] : []; } };
    b.draggablePieces = true;
    b.arrows = [{ from: E2, to: E4, rank: 0 }];
    check(b._built === false, 'nothing is built before connection');
    b.connectedCallback();
    b._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
    b.setPosition(START, { animate: false });
    check(b._boardEl.classList.contains('draggable'), 'a pre-connect draggablePieces is honoured');
    check(b._overlayEl.children.length === 2, 'pre-connect arrows are drawn once the overlay exists');
  })();

  function report() {
    if (extra > 0) failures.push('… and ' + extra + ' more failures');
    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'Board component: ' + passed + ' assertions passed'
        : 'Board component: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }
  return report();
}

module.exports = { selfTest: selfTest };

if (require.main === module) {
  var r = selfTest();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
