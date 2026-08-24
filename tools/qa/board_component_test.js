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

  // ---- the two-toned solution highlight (Puzzle Streak, Part 13.3) ------------------
  // `highlightLastMove` paints both squares one colour. The streak solution strip shows the
  // correct move with a LIGHTER origin and a STRONGER destination, so the direction reads at a
  // glance — one class cannot express that.
  (function () {
    var b = makeBoard({});
    var from = b._cellBySq.get(E2), to = b._cellBySq.get(E4);

    check(!from.classList.contains('solfrom'), 'no solution highlight by default');
    b.highlightSolution(E2, E4);
    check(from.classList.contains('solfrom'), 'the origin gets its own class');
    check(to.classList.contains('solto'), 'and the destination a different one');
    check(!from.classList.contains('solto') && !to.classList.contains('solfrom'),
      'the two are not interchangeable — that is the whole point');
    b.highlightSolution(null);
    check(!from.classList.contains('solfrom') && !to.classList.contains('solto'),
      'passing null clears it');

    // Additive: it must not disturb the last-move highlight, and must win where they overlap.
    b.highlightLastMove(E2, E4);
    check(from.classList.contains('last'), 'the last move still marks its squares');
    b.highlightSolution(E2, E4);
    check(from.classList.contains('last') && from.classList.contains('solfrom'),
      'and a solution on the same square adds to it rather than replacing it');
    // Two distinct custom properties back them, or both would render identically.
    var src = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'web-demo', 'js', 'chess-board.js'), 'utf8');
    check(src.indexOf('--hl-sol-from') > 0 && src.indexOf('--hl-sol-to') > 0,
      'each tone has its own custom property');
    check(src.indexOf('.sq.solfrom::before') > 0 && src.indexOf('.sq.solto::before') > 0,
      'and its own rule');
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

  // ---- the pickup haptic ------------------------------------------------------------------
  //
  // `DragDropChessBoard.tsx:351` fires ONE light impact, on pickup, after three guards: the square
  // holds a piece, it belongs to the side to move, and it passes the colour filter. `_targetsFrom`
  // is those three conditions rolled into one — a square with no legal moves fails all of them —
  // so the assertion that matters is the negative one: an empty or enemy square must not buzz.
  {
    var buzzes = [];
    // The component runs inside the vm sandbox, so its `navigator` is the SANDBOX's, not Node's.
    // Stubbing global.navigator here would set a variable the component cannot see, and every
    // assertion below would pass for the wrong reason.
    function setNav(v) { dom.sandbox.navigator = v; }
    setNav({ vibrate: function (ms) { buzzes.push(ms); return true; } });
    try {
      var b = makeBoard({ draggable: true, targets: {} });
      pointer(b, 'pointerdown', E2);
      check(buzzes.length === 0, 'a square with no legal moves does not buzz');

      var d = makeBoard({ draggable: true, targets: { 12: [E4] } });
      pointer(d, 'pointerdown', E2);
      check(buzzes.length === 1, 'picking up a movable piece buzzes exactly once');
      check(buzzes[0] > 0, 'with a positive duration, got ' + buzzes[0]);

      // On DROP, never again — the source has no drop haptic.
      pointer(d, 'pointermove', E4);
      pointer(d, 'pointerup', E4);
      check(buzzes.length === 1, 'and completing the move does not buzz again');

      // Opt-out, so a screen can silence it without re-deriving the trigger somewhere else.
      var q = makeBoard({ draggable: true, targets: { 12: [E4] } });
      q.haptics = false;
      pointer(q, 'pointerdown', E2);
      check(buzzes.length === 1, 'and .haptics = false silences it');
      check(q.haptics === false, 'which the getter reports');

      // A browser without the API must not throw — desktop and iOS Safari have no vibrate.
      setNav({});
      var n = makeBoard({ draggable: true, targets: { 12: [E4] } });
      pointer(n, 'pointerdown', E2);
      check(!!n._drag, 'a browser with no vibrate() still starts the drag rather than throwing');
    } finally {
      delete dom.sandbox.navigator;
    }
  }


  // ---- the PUZZLE path, end to end ---------------------------------------------------------
  //
  // pointer -> board -> rules adapter -> `move` event -> index/name conversion -> PuzzleSession.
  //
  // This is the test whose absence let a real bug live through five phases: **no puzzle mode ever
  // accepted a move.** The adapter treated the board's square INDICES as names (`E.sqIndex(12)` is
  // `null`), so every square reported zero legal targets and nothing could be picked up; and the
  // `move` event's indices went straight into `submit`, which builds a UCI by string concatenation
  // and so computed `12 + 28`.
  //
  // Neither existing suite could see it. This file drove the board with its OWN correct adapter,
  // and `puzzle_screen_test.js` called `solver.submit('e2','e4')` directly with names, skipping the
  // board entirely. Two green suites, one dead feature. So this drives the real component through
  // the real adapter into a real session.
  {
    var PB = require(path.join(ROOT, 'web-demo', 'js', 'puzzle-board.js'));
    var PS = require(path.join(ROOT, 'web-demo', 'js', 'puzzle-session.js'));
    var ENG = require(path.join(ROOT, 'web-demo', 'js', 'engine.js'));

    // A real corpus puzzle. `moves[0]` is the OPPONENT's setup move (Part 5.1), so the solver's
    // first answer is `moves[1]`.
    var PUZ = {
      id: 1, fen: '7k/4R2p/1p2p2P/2pp1r2/8/P4p1K/1PP5/8 b - - 1 37',
      moves: ['f3f2', 'e7e8', 'f5f8', 'e8f8'], rating: 400, themes: ['endgame'], openingTags: [],
    };
    var session = PS.create(PUZ, 'play');
    PS.applySetupMove(session);                       // play moves[0]; now it is the solver's turn

    var board = new Board();
    board.rules = PB.rulesAdapter();                  // the SHARED adapter, not a local one
    board.setAttribute('draggable-pieces', '');
    board.connectedCallback();
    board._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
    board.setPosition(ENG.toFEN(session.position), { animate: false });

    var expected = PUZ.moves[1];                      // 'e7e8'
    var fromSq = ENG.sqIndex(expected.slice(0, 2));
    var toSq = ENG.sqIndex(expected.slice(2, 4));

    // 1. The adapter must actually report targets. Zero here IS the original bug.
    var targets = board.rules.legalMovesFrom(board.getPosition(), fromSq);
    check(targets.length > 0,
      'the shared adapter reports legal targets for the solver`s piece, got ' + targets.length);
    check(targets.every(function (t) { return typeof t.to === 'number'; }),
      'and reports them as INDICES, which is what the board compares');
    check(targets.some(function (t) { return t.to === toSq; }),
      'including the square the solution moves to');

    // 2. Tap-tap: selecting must mark the square, and the second tap must fire `move`.
    var moves = [];
    board.addEventListener('move', function (e) { moves.push(e.detail); });
    clickSquare(board, fromSq);
    check(board._selected === fromSq, 'tapping the piece selects it');
    check(board._legalTargets.length > 0, 'and its legal targets are marked on the board');
    clickSquare(board, toSq);
    check(moves.length === 1, 'tapping the target fires exactly one move event, got ' + moves.length);

    // 3. The conversion, then the session — the last link in the chain.
    //
    // Guarded: when the adapter is broken no move event fires at all, and a thrown TypeError here
    // would bury the assertion that actually explains why.
    var m = moves.length ? PB.moveFromEvent(moves[0]) : { from: '', to: '', promotion: null };
    check(m.from === expected.slice(0, 2) && m.to === expected.slice(2, 4),
      'moveFromEvent turns the indices into square names: ' + m.from + m.to);
    var out = PS.submit(session, m.from, m.to, m.promotion);
    check(out.kind === 'correct',
      'and the session accepts it as the solution, got "' + out.kind + '"');

    // 4. The same by DRAG, on a fresh board — the other input path shares the adapter but not the
    //    code path, and only one of the two was ever exercised.
    var s2 = PS.create(PUZ, 'play');
    PS.applySetupMove(s2);
    var d = new Board();
    d.rules = PB.rulesAdapter();
    d.setAttribute('draggable-pieces', '');
    d.connectedCallback();
    d._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
    d.setPosition(ENG.toFEN(s2.position), { animate: false });
    var dragged = [];
    d.addEventListener('move', function (e) { dragged.push(e.detail); });
    pointer(d, 'pointerdown', fromSq);
    check(!!d._drag, 'pointerdown on the solver`s piece arms a drag');
    pointer(d, 'pointermove', toSq);
    pointer(d, 'pointerup', toSq);
    check(dragged.length === 1, 'and dropping it fires one move, got ' + dragged.length);
    var dm = dragged.length ? PB.moveFromEvent(dragged[0])
                            : { from: '', to: '', promotion: null };
    check(PS.submit(s2, dm.from, dm.to, dm.promotion).kind === 'correct',
      'which the session also accepts');

    // 5. A WRONG move must reach the session as a wrong move, not as an illegal one — otherwise a
    //    mistake would silently do nothing instead of costing a life.
    var s3 = PS.create(PUZ, 'play');
    PS.applySetupMove(s3);
    var legal = ENG.legalMoves(s3.position).filter(function (mv) {
      return ENG.moveUci(mv) !== expected;
    });
    check(legal.length > 0, 'the position has another legal move to try');
    var bad = PB.moveFromEvent({ from: legal[0].from, to: legal[0].to,
                                 promotion: legal[0].promotion });
    check(PS.submit(s3, bad.from, bad.to, bad.promotion).kind === 'wrong',
      'a different legal move is WRONG, not illegal');

    // 6. Through the FACTORY's own listener, not just its helper.
    //
    // The steps above call `moveFromEvent` directly, which proves the conversion is right but not
    // that anything uses it — a mutant reverting `attach()` to pass `ev.detail` straight through
    // survived exactly that gap. So this drives `BiyaPuzzleBoard.create().attach()` and lets the
    // real listener carry the event into the real session.
    var madeBoard = null;
    var savedDoc = global.document;
    global.document = {
      createElement: function (tag) {
        if (tag !== 'chess-board') return { appendChild: function () {}, setAttribute: function () {} };
        madeBoard = new Board();
        madeBoard.connectedCallback();
        madeBoard._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
        return madeBoard;
      },
    };
    try {
      // `onCorrect` rather than moveIndex: a correct answer defers the opponent's reply behind a
      // timer, so the index does not move synchronously. The callback is the real proof that the
      // listener carried the event all the way into the session.
      var correct = [];
      var solver = PB.create({ mode: 'play',
                               onCorrect: function (o) { correct.push(o); } });
      solver.attach({ appendChild: function () {} });
      check(madeBoard !== null, 'the factory built a real <chess-board>');
      solver.mount(PUZ);
      // `mount` defers the opponent's setup move behind the mode's delay; apply it directly so the
      // test stays synchronous, then repaint so the board matches the session.
      PS.applySetupMove(solver.session);
      solver.paint();
      madeBoard.dispatchEvent(new CE('move', {
        bubbles: true, detail: { from: fromSq, to: toSq, promotion: null },
      }));
      check(correct.length === 1,
        'a move event on the factory`s own board reaches the session as CORRECT — the listener '
        + 'converts indices to names, got ' + correct.length + ' correct outcome(s)');
      solver.destroy();
    } finally {
      if (savedDoc === undefined) delete global.document; else global.document = savedDoc;
    }
  }

  // ---- the COACH path, end to end ------------------------------------------------------------
  //
  // pointer -> the SCREEN's own board element -> coach-play's rules adapter -> its `move` listener
  // -> the caller's `onMove` -> the game record.
  //
  // The Play vs Coach board shipped with DRAG DEAD for the whole life of the screen: `board()` set
  // `.rules` and never `.draggablePieces`, the component attaches no pointer handler until it is
  // asked to, and tap-to-move covered for it perfectly. It was reported from a phone, not by a
  // suite — `coach_screen_test.js` builds that screen against a STUB board, and this file only ever
  // drove a board it had wired correctly itself. Neither could see it.
  //
  // Two source gates now assert the wiring (`web_shell_check.js` §5, `swift_layout_check.js` §7).
  // This is the behavioural half, and it deliberately builds NOTHING by hand: `CPLAY.board()` makes
  // the element, sets its own properties in its own order, and installs its own listener.
  {
    var CPLAY = require(path.join(ROOT, 'web-demo', 'js', 'coach-play.js'));
    var CGAME = require(path.join(ROOT, 'web-demo', 'js', 'coach-game.js'));
    var CTURN = require(path.join(ROOT, 'web-demo', 'js', 'coach-turn.js'));

    var coachBoard = null;
    var savedDoc2 = global.document;
    // Only `chess-board` has to be real. Everything else `board()` creates is the wrap div and,
    // when there is a premove, the chip — and this controller has neither.
    global.document = {
      createElement: function (tag) {
        if (tag !== 'chess-board') {
          return { className: '', textContent: '', children: [], onclick: null,
                   appendChild: function (c) { this.children.push(c); return c; },
                   remove: function () {} };
        }
        coachBoard = new Board();
        return coachBoard;
      },
    };
    try {
      var cgame = CGAME.newGame(3, 'w');        // the user is White, and it is White to move
      var cctl = CTURN.create();
      var uciSeen = [];
      CPLAY.board(cgame, cctl, { onMove: function (u) { uciSeen.push(u); } });
      check(coachBoard !== null, 'the coach screen builds a real <chess-board>');

      // `board()` sets its properties BEFORE the element is appended, so `_attachDrag` cannot run
      // yet and `connectedCallback` has to do it. That ordering is the screen's, not this test's,
      // and it is the reason the property path needs asserting separately from the attribute one.
      check(coachBoard.draggablePieces === true, 'and tells it that pieces may be dragged');
      check(coachBoard._dragHandlers === null, 'the handlers cannot be attached before connection');
      coachBoard.connectedCallback();
      coachBoard._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
      check(coachBoard._dragHandlers !== null,
        'so connecting attaches them — a board with none silently swallows every drag');
      coachBoard.setPosition(CGAME.liveFen(cgame), { animate: false });

      // The coach's pieces are not draggable, and the SCREEN's own adapter is what enforces it.
      pointer(coachBoard, 'pointerdown', E7);
      check(coachBoard._drag === null,
        'pointerdown on a black pawn with White to move arms nothing');

      // The user's own pawn, dragged two squares and released on a legal one.
      pointer(coachBoard, 'pointerdown', E2);
      check(!!coachBoard._drag && coachBoard._drag.from === E2, 'pointerdown on e2 arms a drag');
      pointer(coachBoard, 'pointermove', E4);
      pointer(coachBoard, 'pointerup', E4);
      check(uciSeen.length === 1,
        'dropping it reaches the screen`s onMove exactly once, got ' + uciSeen.length);
      check(uciSeen[0] === 'e2e4',
        'as the UCI string e2e4, not a sum of square indexes: got ' + uciSeen[0]);

      // The last link: the record the rest of the screen reads.
      var crec = uciSeen.length ? CGAME.record(cgame, uciSeen[0]) : null;
      check(crec !== null, 'and the game accepts the move it produced');
      check(CGAME.liveFen(cgame).indexOf(' b ') > 0, 'leaving Black to move');

      // A drop that is not a legal target must produce nothing at all — the piece goes home and no
      // move is reported. Without this, "one move fired" above would also pass a board that fires
      // on every release.
      var before = uciSeen.length;
      pointer(coachBoard, 'pointerdown', E4);
      pointer(coachBoard, 'pointermove', E2);
      pointer(coachBoard, 'pointerup', E2);
      check(uciSeen.length === before, 'a drag backwards onto an illegal square reports nothing');
    } finally {
      if (savedDoc2 === undefined) delete global.document; else global.document = savedDoc2;
    }
  }

  // ---- the Opening Tree explorer, driven the same way ------------------------------------
  //
  // The explorer board was the demo's last READ-ONLY board until the client asked to be able to
  // step in at a position and play their own move. Everything else that checks it reads SOURCE, so
  // all of it would still pass a screen that switched the drag on and wired it wrongly — which is
  // the hole this file was extended to close for the coach, and it is open again for a new screen.
  //
  // The assertion that matters is the SAN one. The component reports UCI and the store's path is
  // SAN, so a screen that forwards the raw UCI still advances the board — and every on-book move
  // then reads as off book, with nothing anywhere to say why. `puzzle_core_mutation_test.js` found
  // exactly that by surviving.
  {
    var OPEN = require(path.join(ROOT, 'web-demo', 'js', 'openings.js'));
    var OSTORE = require(path.join(ROOT, 'web-demo', 'js', 'opening-store.js'));
    var OTREE = require(path.join(ROOT, 'web-demo', 'js', 'opening-tree.js'));

    var opBoard = null;
    var savedDoc3 = global.document;
    global.document = {
      createElement: function (tag) {
        if (tag !== 'chess-board') {
          return { className: '', textContent: '', children: [], onclick: null,
                   appendChild: function (c) { this.children.push(c); return c; },
                   remove: function () {} };
        }
        opBoard = new Board();
        return opBoard;
      },
    };
    try {
      function memStore() {
        var map = {};
        return { getItem: function (k) {
                   return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
                 setItem: function (k, v) { map[k] = String(v); },
                 removeItem: function (k) { delete map[k]; } };
      }
      var ostore = OSTORE.create(memStore());
      var otree = OSTORE.build({
        games: [{ sanMoves: ['e4', 'c5', 'Nf3'], userIsWhite: true,
                  outcome: OTREE.OUTCOMES.whiteWin }],
        name: 'Sicilian', colour: 'both', source: 'pgn', username: '', nowMs: 1 });
      ostore.add(otree);
      ostore.openTree(otree.id);

      var played = [];
      OPEN.board(ostore, function (san) { played.push(san); });
      check(opBoard !== null, 'the explorer screen builds a real <chess-board>');
      check(opBoard.draggablePieces === true,
        'and tells it that pieces may be dragged — it was a display board until free play');
      check(opBoard._dragHandlers === null, 'the handlers cannot be attached before connection');
      opBoard.connectedCallback();
      opBoard._boardEl._rect = { left: 0, top: 0, width: SIZE, height: SIZE };
      check(opBoard._dragHandlers !== null, 'so connecting attaches them');
      opBoard.setPosition(ostore.fen(), { animate: false });

      // White to move at the root: a black pawn arms nothing. The SCREEN's own rules adapter is
      // what enforces that, so this is testing the wiring rather than the component.
      pointer(opBoard, 'pointerdown', E7);
      check(opBoard._drag === null, 'pointerdown on a black pawn with White to move arms nothing');

      pointer(opBoard, 'pointerdown', E2);
      check(!!opBoard._drag && opBoard._drag.from === E2, 'pointerdown on e2 arms a drag');
      pointer(opBoard, 'pointermove', E4);
      pointer(opBoard, 'pointerup', E4);
      check(played.length === 1,
        'dropping it reaches the screen`s onPlay exactly once, got ' + played.length);
      // THE assertion. `'e4'`, not `'e2e4'` — the store's path is SAN, and the whole off-book
      // model reads as broken if a UCI ever lands on it.
      check(played[0] === 'e4',
        'as the SAN the tree is keyed by, NOT the component`s UCI: got ' + played[0]);

      // The move it produced is on book, which is the point of resolving it properly.
      ostore.play(played[0]);
      check(ostore.isOffBook() === false, 'and the move it produced is ON book');
      check(ostore.candidates().length > 0, 'with the tree`s continuations still there');

      // Now leave the book by playing something no game contains, and come back.
      opBoard.setPosition(ostore.fen(), { animate: false });
      var beforeOff = played.length;
      pointer(opBoard, 'pointerdown', E7);
      pointer(opBoard, 'pointermove', E5);
      pointer(opBoard, 'pointerup', E5);
      check(played.length === beforeOff + 1, 'a reply the tree never saw still plays');
      ostore.play(played[played.length - 1]);
      check(ostore.isOffBook(), 'and it is off book');
      check(ostore.candidates().length === 0 && !ostore.canStepForward(),
        'with no candidates and Forward dead');
      ostore.backToTree();
      check(!ostore.isOffBook() && ostore.path().join(' ') === 'e4',
        'and Back to tree returns in one step');

      // A drop that is not a legal target reports nothing at all — without this, "one move fired"
      // above would also pass a board that fires on every release.
      opBoard.setPosition(ostore.fen(), { animate: false });
      var beforeBad = played.length;
      pointer(opBoard, 'pointerdown', E4);
      pointer(opBoard, 'pointermove', E2);
      pointer(opBoard, 'pointerup', E2);
      check(played.length === beforeBad, 'a drag onto an illegal square reports nothing');
    } finally {
      if (savedDoc3 === undefined) delete global.document; else global.document = savedDoc3;
    }
  }

  return report();
}

module.exports = { selfTest: selfTest };

if (require.main === module) {
  var r = selfTest();
  console.log(r.summary);
  process.exit(r.ok ? 0 : 1);
}
