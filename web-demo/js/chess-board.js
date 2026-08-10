/* =============================================================================
 * chess-board.js — <chess-board> reusable Web Component  ⭐
 *
 * A self-contained, responsive chessboard custom element (Shadow DOM). Drop it
 * anywhere:  <chess-board fen="…"></chess-board>
 *
 * It is a VIEW + INTERACTION layer only — it never mutates game state. Give it a
 * `rules` object (an engine adapter) so it knows legal moves; when the user
 * completes a move it fires a `move` event, and the app applies that move to the
 * real engine and calls setPosition() back. Single source of truth stays outside.
 *
 * ── Attributes ────────────────────────────────────────────────────────────
 *   fen           position to render
 *   flipped       boolean — black at the bottom
 *   interactive   boolean (default true) — allow tap-tap input
 *   coordinates   boolean (default true) — show a–h / 1–8 labels
 *   piece-path    folder of <kind>-<w|b>.svg art (default "assets/pieces")
 *   draggable-pieces  boolean (default false) — drag as well as tap
 *
 * ── Properties ────────────────────────────────────────────────────────────
 *   .rules = { legalMovesFrom(fen, sq) -> [{to, promotion|null}] }
 *   .fen  .flipped  .interactive  .draggablePieces
 *   .arrows = [{from, to, rank}]   rank 0 = best line (green / blue / orange)
 *
 * ── Methods ───────────────────────────────────────────────────────────────
 *   setPosition(fen, { animate=true, lastMove:{from,to}|null, check:sq|null })
 *   getPosition()   flip()   clearSelection()
 *   highlightLastMove(from,to)   setCheck(sq|null)   showLegalTargets([sq])
 *
 * ── Events ────────────────────────────────────────────────────────────────
 *   'move'          detail { from, to, promotion, uci }  (after promotion pick)
 *   'square-select' detail { square }
 *
 * ── Theming (CSS custom properties; pierce the Shadow DOM) ─────────────────
 *   --board-light --board-dark --hl-last --hl-select --hl-check
 *   --dot-color --ring-color --board-max --board-radius --coord-color
 *
 * Classic <script>, no modules — runs from file:// on Windows.
 * ⇢ This is the component the user will restyle/extend most; edit freely.
 * ========================================================================== */
(function () {
  'use strict';

  var WHITE = 0, BLACK = 1;
  var KIND_NAME = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  var GLYPH = ['♟', '♞', '♝', '♜', '♛', '♚']; // pawn…king (solid)
  // Below this many CSS px a press is still a tap, so tap-to-move keeps working.
  var DRAG_THRESHOLD = 4;

  // Minimal FEN → 64-array of {color,kind}|null. (Board is view-only; it does not
  // need full engine rules, just enough to place pieces.)
  function boardFromFEN(fen) {
    var board = new Array(64).fill(null);
    var field = (fen || '').split(/\s+/)[0] || '';
    var ranks = field.split('/');
    if (ranks.length !== 8) return board;
    for (var i = 0; i < 8; i++) {
      var rank = 7 - i, file = 0, s = ranks[i];
      for (var c = 0; c < s.length; c++) {
        var ch = s[c], d = '12345678'.indexOf(ch);
        if (d >= 0) { file += d + 1; continue; }
        var color = (ch >= 'A' && ch <= 'Z') ? WHITE : BLACK;
        var kind = 'pnbrqk'.indexOf(ch.toLowerCase());
        if (kind >= 0 && file < 8) board[rank * 8 + file] = { color: color, kind: kind };
        file += 1;
      }
    }
    return board;
  }
  function samePiece(a, b) { return !!a && !!b && a.color === b.color && a.kind === b.kind; }

  var STYLE = [
    ':host{display:block;--_max:var(--board-max,640px);--_light:var(--board-light,#5BA3F5);--_dark:var(--board-dark,#2C4A73);',
    '--_last:var(--hl-last,rgba(253,176,34,.32));--_sel:var(--hl-select,rgba(253,176,34,.55));--_check:var(--hl-check,rgba(255,107,107,.5));',
    '--_dot:var(--dot-color,rgba(255,255,255,.22));--_ring:var(--ring-color,rgba(255,255,255,.30));--_coord:var(--coord-color,#8BA3C7);}',
    '.board{position:relative;width:100%;max-width:var(--_max);margin:0 auto;aspect-ratio:1/1;border-radius:var(--board-radius,12px);overflow:hidden;',
    'box-shadow:0 8px 22px rgba(0,0,0,.30);touch-action:manipulation;user-select:none;-webkit-user-select:none;}',
    '.squares{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);}',
    '.sq{position:relative;}',
    '.sq.light{background:var(--_light);}.sq.dark{background:var(--_dark);}',
    '.sq::before{content:"";position:absolute;inset:0;background:transparent;pointer-events:none;transition:background .12s ease;}',
    '.sq.last::before{background:var(--_last);}',
    '.sq.sel::before{background:var(--_sel);}',
    '.sq.check::before{background:radial-gradient(circle,var(--_check) 0%,var(--_check) 42%,transparent 74%);}',
    '.sq::after{content:"";position:absolute;pointer-events:none;opacity:0;transition:opacity .1s ease;}',
    '.sq.dot::after{opacity:1;left:34%;top:34%;width:32%;height:32%;border-radius:50%;background:var(--_dot);}',
    '.sq.cap::after{opacity:1;inset:5%;border-radius:50%;border:6px solid var(--_ring);box-sizing:border-box;}',
    '.sq .cf,.sq .cr{position:absolute;font:600 clamp(7px,2.1cqw,12px)/1 var(--coord-font,inherit);color:var(--_coord);opacity:.9;pointer-events:none;}',
    '.sq .cf{right:3%;bottom:1%;}.sq .cr{left:4%;top:1%;}',
    '.pieces{position:absolute;inset:0;pointer-events:none;}',
    // Arrow overlay. MUST stay pointer-events:none: the tap path is a delegated click on
    // .squares, and any interactive layer stacked above it silently kills tap-to-move.
    '.overlay{position:absolute;inset:0;pointer-events:none;z-index:5;}',
    // A dragged piece follows the pointer, so its slide transition has to be off or it lags
    // a third of a second behind the finger.
    '.piece.dragging{transition:none;z-index:8;}',
    '.piece.dragging .inner{transform:scale(1.15);filter:drop-shadow(0 8px 12px rgba(0,0,0,.45));}',
    '.sq.drophover::before{background:rgba(20,85,30,.5);}',
    // Only while drag is enabled: "manipulation" still lets the browser claim a vertical swipe
    // as a scroll and fire pointercancel mid-drag. Boards without drag keep scrolling normally.
    '.board.draggable{touch-action:none;}',
    '.piece{position:absolute;left:0;top:0;width:12.5%;height:12.5%;will-change:transform;',
    'transition:transform .33s cubic-bezier(.34,1.15,.64,1);}',
    '.piece .inner{width:100%;height:100%;transition:transform .2s ease,opacity .2s ease;filter:drop-shadow(0 2px 2px rgba(0,0,0,.34));}',
    '.piece .inner img,.piece .inner svg{width:100%;height:100%;display:block;}',
    '.piece.spawn .inner,.piece.dying .inner{transform:scale(.4);opacity:0;}',
    '.promo{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(6,12,24,.55);z-index:9;}',
    '.promo.on{display:flex;}',
    '.promo .card{background:rgba(26,41,66,.98);border:1px solid rgba(74,159,232,.30);border-radius:14px;padding:12px;box-shadow:0 18px 40px rgba(0,0,0,.5);',
    'display:flex;gap:8px;}',
    '.promo .opt{width:15%;min-width:44px;aspect-ratio:1/1;background:var(--_light);border-radius:8px;cursor:pointer;padding:4%;box-sizing:border-box;border:0;}',
    '.promo .opt img,.promo .opt svg{width:100%;height:100%;}',
    '.promo .opt:hover{outline:2px solid var(--hl-select,#FDB022);}'
  ].join('');

  function glyphSVG(piece) {
    var fill = piece.color === WHITE ? '#f6f7f8' : '#1b1b1b';
    return '<svg viewBox="0 0 45 45" width="100%" height="100%"><text x="22.5" y="35" font-size="40" text-anchor="middle"'
      + ' fill="' + fill + '" stroke="rgba(0,0,0,.55)" stroke-width="0.6">' + GLYPH[piece.kind] + '</text></svg>';
  }

  class ChessBoardEl extends HTMLElement {
    static get observedAttributes() { return ['fen', 'flipped', 'interactive', 'coordinates', 'piece-path', 'draggable-pieces']; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._fen = null;
      this._board = new Array(64).fill(null);
      this._flipped = false;
      this._interactive = true;
      this._coords = true;
      this._piecePath = 'assets/pieces';
      this._rules = null;
      this._els = new Map();          // sq -> {el, piece}
      this._cellBySq = new Map();     // sq -> cell element
      this._selected = null;
      this._legalTargets = [];        // [{to, promotion|null}]
      this._lastMove = null;          // {from, to}
      this._checkSq = null;
      this._pendingPromo = null;      // {from, to, color}
      this._built = false;
      this._hasRendered = false;
      this._arrows = [];              // [{from, to, rank}]
      this._dragEnabled = false;
      this._drag = null;              // {from, el, pointerId, x0, y0, moved, targets}
      this._dragHandlers = null;
      this._suppressClick = false;
    }

    // ---- lifecycle ----------------------------------------------------------
    connectedCallback() {
      if (!this._built) this._build();
      if (this.hasAttribute('flipped')) this._flipped = this.getAttribute('flipped') !== 'false';
      if (this.hasAttribute('interactive')) this._interactive = this.getAttribute('interactive') !== 'false';
      if (this.hasAttribute('coordinates')) this._coords = this.getAttribute('coordinates') !== 'false';
      if (this.hasAttribute('piece-path')) this._piecePath = this.getAttribute('piece-path');
      if (this.hasAttribute('draggable-pieces')) this._dragEnabled = this.getAttribute('draggable-pieces') !== 'false';
      // The property may also have been set before appendChild, when _attachDrag could not run yet.
      if (this._dragEnabled) this._attachDrag();
      this._layoutCells();
      var fen = this.getAttribute('fen') || this._fen;
      if (fen) this.setPosition(fen, { animate: false });
    }

    attributeChangedCallback(name, _old, val) {
      if (!this._built) return;
      if (name === 'fen' && val && val !== this._fen) this.setPosition(val, { animate: false });
      else if (name === 'flipped') { this._flipped = val !== null && val !== 'false'; this._relayout(); }
      else if (name === 'interactive') { this._interactive = val !== 'false'; if (!this._interactive) this.clearSelection(); }
      else if (name === 'coordinates') { this._coords = val !== 'false'; this._layoutCells(); }
      else if (name === 'piece-path') { this._piecePath = val || 'assets/pieces'; this._refreshArt(); }
      else if (name === 'draggable-pieces') { this.draggablePieces = val !== null && val !== 'false'; }
    }

    // ---- public properties --------------------------------------------------
    get fen() { return this._fen; }
    set fen(v) { this.setPosition(v, { animate: false }); }
    get flipped() { return this._flipped; }
    set flipped(v) { this._flipped = !!v; this._relayout(); }
    get interactive() { return this._interactive; }
    set interactive(v) { this._interactive = !!v; if (!v) this.clearSelection(); }
    get rules() { return this._rules; }
    set rules(v) { this._rules = v; }

    // ---- DOM build ----------------------------------------------------------
    _build() {
      var style = document.createElement('style'); style.textContent = STYLE;
      this._boardEl = document.createElement('div'); this._boardEl.className = 'board';
      this._squaresEl = document.createElement('div'); this._squaresEl.className = 'squares';
      this._piecesEl = document.createElement('div'); this._piecesEl.className = 'pieces';
      this._promoEl = document.createElement('div'); this._promoEl.className = 'promo';
      // 64 cells
      this._cells = [];
      for (var k = 0; k < 64; k++) {
        var cell = document.createElement('div'); cell.className = 'sq';
        this._squaresEl.appendChild(cell); this._cells.push(cell);
      }
      this._overlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this._overlayEl.setAttribute('class', 'overlay');
      this._overlayEl.setAttribute('viewBox', '0 0 8 8');
      this._overlayEl.setAttribute('preserveAspectRatio', 'none');
      this._boardEl.appendChild(this._squaresEl);
      this._boardEl.appendChild(this._piecesEl);
      this._boardEl.appendChild(this._overlayEl);
      this._boardEl.appendChild(this._promoEl);
      this._root.appendChild(style);
      this._root.appendChild(this._boardEl);
      // container queries for coord sizing
      this._boardEl.style.containerType = 'inline-size';
      // one delegated click handler
      var self = this;
      this._squaresEl.addEventListener('click', function (e) {
        var cell = e.target.closest ? e.target.closest('.sq') : null;
        if (!cell || cell.dataset.sq === undefined) return;
        self._onSquareClick(parseInt(cell.dataset.sq, 10));
      });
      this._built = true;
    }

    _visual(sq) {
      var file = sq & 7, rank = sq >> 3;
      return { col: this._flipped ? 7 - file : file, row: this._flipped ? rank : 7 - rank };
    }

    // Assign each grid cell the square it currently represents (depends on flip),
    // its light/dark colour, and optional coordinate labels.
    _layoutCells() {
      this._cellBySq.clear();
      for (var k = 0; k < 64; k++) {
        var vrow = Math.floor(k / 8), vcol = k % 8;
        var file = this._flipped ? 7 - vcol : vcol;
        var rank = this._flipped ? vrow : 7 - vrow;
        var sq = rank * 8 + file;
        var cell = this._cells[k];
        cell.dataset.sq = sq;
        cell.className = 'sq ' + (((file + rank) % 2 === 1) ? 'light' : 'dark');
        cell.innerHTML = '';
        if (this._coords) {
          if (vrow === 7) { var cf = document.createElement('span'); cf.className = 'cf'; cf.textContent = String.fromCharCode(97 + file); cell.appendChild(cf); }
          if (vcol === 0) { var cr = document.createElement('span'); cr.className = 'cr'; cr.textContent = (rank + 1); cell.appendChild(cr); }
        }
        this._cellBySq.set(sq, cell);
      }
      this._applyMarks();
      this._drawArrows();     // the viewBox is fixed, but a flip moves every endpoint
    }

    _relayout() {
      if (!this._built) return;         // property set before connection — connectedCallback will render
      this._layoutCells();
      // snap every piece to its new visual position
      var self = this;
      this._els.forEach(function (rec, sq) { self._placePiece(rec.el, sq, false); });
    }

    // ---- piece elements -----------------------------------------------------
    _makePieceEl(piece) {
      var el = document.createElement('div'); el.className = 'piece';
      var inner = document.createElement('div'); inner.className = 'inner';
      el.appendChild(inner);
      this._setPieceContent(inner, piece);
      return el;
    }
    _setPieceContent(inner, piece) {
      var src = this._piecePath + '/' + KIND_NAME[piece.kind] + '-' + (piece.color === WHITE ? 'w' : 'b') + '.svg';
      inner.innerHTML = '';
      var img = document.createElement('img');
      img.alt = ''; img.draggable = false; img.src = src;
      img.onerror = function () { inner.innerHTML = glyphSVG(piece); };
      inner.appendChild(img);
    }
    _setPieceEl(el, piece) { this._setPieceContent(el.querySelector('.inner'), piece); }
    _refreshArt() {
      var self = this;
      this._els.forEach(function (rec) { self._setPieceEl(rec.el, rec.piece); });
      // refresh promo art if open
      if (this._pendingPromo) this._openPromo(this._pendingPromo.color);
    }

    _placePiece(el, sq, animate) {
      var v = this._visual(sq);
      var t = 'translate(' + (v.col * 100) + '%,' + (v.row * 100) + '%)';
      if (!animate) {
        var prev = el.style.transition;
        el.style.transition = 'none';
        el.style.transform = t;
        void el.offsetWidth;               // force reflow so the snap isn't animated
        el.style.transition = prev || '';
      } else {
        el.style.transform = t;
      }
      el.dataset.sq = sq;
    }
    _fadeIn(el) {
      el.classList.add('spawn');
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove('spawn'); }); });
    }
    _fadeOut(el) {
      el.classList.add('dying');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }

    // ---- position / render --------------------------------------------------
    getPosition() { return this._fen; }

    setPosition(fen, opts) {
      opts = opts || {};
      this._fen = fen;
      this._board = boardFromFEN(fen);
      this._lastMove = (opts.lastMove !== undefined) ? opts.lastMove : this._lastMove;
      if (opts.check !== undefined) this._checkSq = opts.check;
      this.clearSelection(true);        // stale after a position change
      if (!this._built) return;         // set before connection — connectedCallback re-runs this
      var animate = opts.animate !== false && this._hasRendered;
      this._render(this._board, animate, this._lastMove);
      this._applyMarks();
      this._hasRendered = true;
    }

    // Reconcile old vs new pieces. The moved piece (lastMove) slides; other
    // appeared pieces are matched to vanished ones of the same identity (this
    // makes the castling rook slide too); leftovers fade in/out. Handles
    // captures, en passant, castling and promotion generically.
    _render(newBoard, animate, lastMove) {
      var oldEls = this._els;
      var newMap = new Map();
      for (var sq = 0; sq < 64; sq++) if (newBoard[sq]) newMap.set(sq, newBoard[sq]);

      var nextEls = new Map();
      var vanished = [];
      oldEls.forEach(function (rec, s) {
        var np = newMap.get(s);
        if (np && samePiece(np, rec.piece)) { nextEls.set(s, rec); newMap.delete(s); }
        else vanished.push({ sq: s, piece: rec.piece, el: rec.el });
      });
      var appeared = [];
      newMap.forEach(function (piece, s) { appeared.push({ sq: s, piece: piece }); });

      function take(pred) { for (var i = 0; i < vanished.length; i++) if (pred(vanished[i])) return vanished.splice(i, 1)[0]; return null; }

      var self = this, slides = [];
      appeared.forEach(function (ap) {
        var src = null;
        if (lastMove && ap.sq === lastMove.to) src = take(function (v) { return v.sq === lastMove.from; });
        if (!src) src = take(function (v) { return v.piece.color === ap.piece.color && v.piece.kind === ap.piece.kind; });
        if (src) {
          if (!samePiece(src.piece, ap.piece)) self._setPieceEl(src.el, ap.piece); // promotion
          slides.push({ el: src.el, to: ap.sq });
          nextEls.set(ap.sq, { el: src.el, piece: ap.piece });
        } else {
          var el = self._makePieceEl(ap.piece);
          self._piecesEl.appendChild(el);
          self._placePiece(el, ap.sq, false);
          if (animate) self._fadeIn(el);
          nextEls.set(ap.sq, { el: el, piece: ap.piece });
        }
      });
      vanished.forEach(function (v) { if (animate) self._fadeOut(v.el); else if (v.el.parentNode) v.el.parentNode.removeChild(v.el); });
      slides.forEach(function (s) { s.el.style.zIndex = '2'; self._placePiece(s.el, s.to, animate); });

      this._els = nextEls;
    }

    // ---- highlights / marks -------------------------------------------------
    _clearMarks() {
      for (var k = 0; k < this._cells.length; k++) this._cells[k].classList.remove('last', 'sel', 'check', 'dot', 'cap');
    }
    _applyMarks() {
      if (!this._built) return;
      this._clearMarks();
      var cell;
      if (this._lastMove) {
        if ((cell = this._cellBySq.get(this._lastMove.from))) cell.classList.add('last');
        if ((cell = this._cellBySq.get(this._lastMove.to))) cell.classList.add('last');
      }
      if (this._checkSq != null && (cell = this._cellBySq.get(this._checkSq))) cell.classList.add('check');
      if (this._selected != null && (cell = this._cellBySq.get(this._selected))) cell.classList.add('sel');
      var self = this;
      this._legalTargets.forEach(function (t) {
        var c = self._cellBySq.get(t.to); if (!c) return;
        c.classList.add(self._board[t.to] ? 'cap' : 'dot');
      });
    }
    highlightLastMove(from, to) { this._lastMove = (from == null ? null : { from: from, to: to }); this._applyMarks(); }
    setCheck(sq) { this._checkSq = (sq == null ? null : sq); this._applyMarks(); }

    // ---- interaction --------------------------------------------------------
    _targetsFrom(sq) {
      if (!this._rules || typeof this._rules.legalMovesFrom !== 'function') return [];
      try { return this._rules.legalMovesFrom(this._fen, sq) || []; } catch (e) { return []; }
    }
    // Controlled mode: let the app supply targets directly.
    showLegalTargets(list) {
      this._legalTargets = (list || []).map(function (t) { return (typeof t === 'number') ? { to: t, promotion: null } : t; });
      this._applyMarks();
    }

    _select(sq, targets) {
      this._selected = sq;
      this._legalTargets = targets;
      this._applyMarks();
      this.dispatchEvent(new CustomEvent('square-select', { detail: { square: sq }, bubbles: true, composed: true }));
    }
    clearSelection(silent) {
      this._selected = null;
      this._legalTargets = [];
      if (!silent) this._applyMarks();
    }

    _onSquareClick(sq) {
      // A completed drag also produces a click on the drop square; swallow exactly one.
      if (this._suppressClick) { this._suppressClick = false; return; }
      // Every tap, before any selection logic and regardless of `interactive`. The Analysis Board's
      // Setup Position needs "which square did you touch" with no notion of a legal move; going
      // through `square-select` would not do, because that only fires when a square has targets.
      // Purely additive — nothing else in the demo listens for `tap`.
      this.dispatchEvent(new CustomEvent('tap', {
        detail: { square: sq }, bubbles: true, composed: true
      }));
      if (!this._interactive || this._pendingPromo) return;
      if (this._selected == null) {
        var t = this._targetsFrom(sq);
        if (t.length) this._select(sq, t);
        return;
      }
      if (sq === this._selected) { this.clearSelection(); return; }
      var hit = this._legalTargets.filter(function (x) { return x.to === sq; });
      if (hit.length) {
        var promo = hit.filter(function (x) { return x.promotion != null; });
        if (promo.length) { this._askPromotion(this._selected, sq); }
        else { this._commit(this._selected, sq, null); }
        return;
      }
      // tap another own piece → reselect; else deselect
      var t2 = this._targetsFrom(sq);
      if (t2.length) this._select(sq, t2); else this.clearSelection();
    }

    _commit(from, to, promotion) {
      var uci = String.fromCharCode(97 + (from & 7)) + ((from >> 3) + 1) +
        String.fromCharCode(97 + (to & 7)) + ((to >> 3) + 1) +
        (promotion != null ? 'nbrq'[promotion - 1] : '');
      this.clearSelection();
      this.dispatchEvent(new CustomEvent('move', {
        detail: { from: from, to: to, promotion: promotion, uci: uci }, bubbles: true, composed: true
      }));
    }

    // ---- arrow overlay ------------------------------------------------------
    // Drawn in an 8x8 viewBox, so every coordinate is "in squares" and nothing depends on the
    // board's pixel size. That survives resize, container queries and flipping for free.

    /** `[{from, to, rank}]`, rank 0 = the engine's best line. */
    set arrows(list) { this._arrows = Array.isArray(list) ? list.slice() : []; this._drawArrows(); }
    get arrows() { return this._arrows.slice(); }

    _drawArrows() {
      if (!this._built) return;
      var svg = this._overlayEl;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (!this._arrows.length) return;

      var COLORS = ['rgba(76,175,80,.85)', 'rgba(68,138,255,.80)', 'rgba(255,152,0,.80)'];
      var STROKE = 0.18, HEAD = 0.35, SHORTEN = 0.7, HALF = 0.6;   // in squares — spec 3.9
      var self = this;
      // Weakest first so the best line ends up on top.
      this._arrows.slice().sort(function (a, b) { return (b.rank || 0) - (a.rank || 0); })
        .forEach(function (arrow) {
          var a = self._visual(arrow.from), b = self._visual(arrow.to);
          var ax = a.col + 0.5, ay = a.row + 0.5, bx = b.col + 0.5, by = b.row + 0.5;
          var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy) || 1;
          var ux = dx / len, uy = dy / len;
          var color = COLORS[Math.min(Math.max(arrow.rank || 0, 0), COLORS.length - 1)];

          var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', ax); line.setAttribute('y1', ay);
          line.setAttribute('x2', bx - ux * HEAD * SHORTEN);
          line.setAttribute('y2', by - uy * HEAD * SHORTEN);
          line.setAttribute('stroke', color);
          line.setAttribute('stroke-width', STROKE);
          line.setAttribute('stroke-linecap', 'round');
          svg.appendChild(line);

          var lx = bx - ux * HEAD - (-uy) * HEAD * HALF, ly = by - uy * HEAD - ux * HEAD * HALF;
          var rx = bx - ux * HEAD + (-uy) * HEAD * HALF, ry = by - uy * HEAD + ux * HEAD * HALF;
          var head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          head.setAttribute('points', bx + ',' + by + ' ' + lx + ',' + ly + ' ' + rx + ',' + ry);
          head.setAttribute('fill', color);
          svg.appendChild(head);
        });
    }

    // ---- drag and drop --------------------------------------------------------
    // Pointer events on the BOARD, not on pieces: `.pieces` is pointer-events:none, and giving it
    // hit-testing would make `closest('.sq')` return null and silently kill tap-to-move. A drag
    // below the threshold never starts, so taps still reach the delegated click handler.

    set draggablePieces(on) {
      var want = !!on;
      if (want === this._dragEnabled) return;
      this._dragEnabled = want;
      if (this._built) want ? this._attachDrag() : this._detachDrag();
    }
    get draggablePieces() { return this._dragEnabled; }

    _attachDrag() {
      if (this._dragHandlers || !this._built) return;
      var self = this;
      this._dragHandlers = {
        down: function (e) { self._onPointerDown(e); },
        move: function (e) { self._onPointerMove(e); },
        up: function (e) { self._onPointerUp(e); }
      };
      this._boardEl.addEventListener('pointerdown', this._dragHandlers.down);
      this._boardEl.addEventListener('pointermove', this._dragHandlers.move);
      this._boardEl.addEventListener('pointerup', this._dragHandlers.up);
      this._boardEl.addEventListener('pointercancel', this._dragHandlers.up);
      this._boardEl.classList.add('draggable');
    }
    _detachDrag() {
      if (!this._dragHandlers) return;
      this._boardEl.removeEventListener('pointerdown', this._dragHandlers.down);
      this._boardEl.removeEventListener('pointermove', this._dragHandlers.move);
      this._boardEl.removeEventListener('pointerup', this._dragHandlers.up);
      this._boardEl.removeEventListener('pointercancel', this._dragHandlers.up);
      this._boardEl.classList.remove('draggable');
      this._dragHandlers = null;
    }

    /** Client point -> logical square, or null outside the board. */
    _squareAtPoint(clientX, clientY) {
      var r = this._boardEl.getBoundingClientRect();
      if (r.width <= 0) return null;
      var s = r.width / 8;
      var vcol = Math.floor((clientX - r.left) / s), vrow = Math.floor((clientY - r.top) / s);
      if (vcol < 0 || vcol > 7 || vrow < 0 || vrow > 7) return null;
      var file = this._flipped ? 7 - vcol : vcol;
      var rank = this._flipped ? vrow : 7 - vrow;
      return rank * 8 + file;
    }

    _onPointerDown(e) {
      if (!this._interactive || this._pendingPromo || this._drag) return;
      var sq = this._squareAtPoint(e.clientX, e.clientY);
      if (sq == null) return;
      var targets = this._targetsFrom(sq);
      if (!targets.length) return;                 // nothing draggable here — let the tap path run
      var rec = this._els.get(sq);
      if (!rec) return;
      this._drag = {
        from: sq, el: rec.el, pointerId: e.pointerId, moved: false, targets: targets,
        x0: e.clientX, y0: e.clientY
      };
      // Keep receiving moves even if the finger leaves the element the press started on.
      if (this._boardEl.setPointerCapture) {
        try { this._boardEl.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      }
    }

    _onPointerMove(e) {
      var d = this._drag;
      if (!d || e.pointerId !== d.pointerId) return;
      var r = this._boardEl.getBoundingClientRect();
      var s = r.width / 8;
      if (!d.moved) {
        // Below the threshold this is still a tap; do not hijack it.
        var dx0 = e.clientX - d.x0, dy0 = e.clientY - d.y0;
        if (dx0 * dx0 + dy0 * dy0 < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        d.moved = true;
        d.el.classList.add('dragging');
        this._select(d.from, d.targets);
      }
      e.preventDefault();
      // Lift the piece clear of the fingertip (spec 3.5) and follow the pointer.
      var x = (e.clientX - r.left) / s - 0.5;
      var y = (e.clientY - r.top) / s - 0.5 - 0.35;
      d.el.style.transform = 'translate(' + (x * 100) + '%,' + (y * 100) + '%)';
      var over = this._squareAtPoint(e.clientX, e.clientY);
      this._cells.forEach(function (c) { c.classList.remove('drophover'); });
      if (over != null) {
        var cell = this._cellBySq.get(over);
        if (cell) cell.classList.add('drophover');
      }
    }

    _onPointerUp(e) {
      var d = this._drag;
      if (!d || e.pointerId !== d.pointerId) return;
      this._drag = null;
      if (this._boardEl.releasePointerCapture) {
        try { this._boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      }
      this._cells.forEach(function (c) { c.classList.remove('drophover'); });
      d.el.classList.remove('dragging');
      if (!d.moved) return;                        // never became a drag; the click handler has it
      this._suppressClick = true;
      this._placePiece(d.el, d.from, false);       // snap home; the caller repaints on a real move
      var to = this._squareAtPoint(e.clientX, e.clientY);
      if (to == null || to === d.from) { this.clearSelection(); return; }
      var hit = d.targets.filter(function (x) { return x.to === to; });
      if (!hit.length) { this.clearSelection(); return; }
      var promo = hit.filter(function (x) { return x.promotion != null; });
      // Funnel through the same paths the tap route uses, so `move` events stay identical and
      // app.js's handlers keep working untouched.
      if (promo.length) this._askPromotion(d.from, to);
      else this._commit(d.from, to, null);
    }

    // ---- promotion overlay --------------------------------------------------
    _askPromotion(from, to) {
      var color = this._board[from] ? this._board[from].color : WHITE;
      this._pendingPromo = { from: from, to: to, color: color };
      this._openPromo(color);
    }
    _openPromo(color) {
      var kinds = [4, 3, 2, 1]; // Queen, Rook, Bishop, Knight
      var self = this;
      this._promoEl.innerHTML = '';
      var card = document.createElement('div'); card.className = 'card';
      kinds.forEach(function (kind) {
        var btn = document.createElement('button'); btn.className = 'opt'; btn.type = 'button';
        var inner = document.createElement('div'); inner.style.width = '100%'; inner.style.height = '100%';
        self._setPieceContent(inner, { color: color, kind: kind });
        btn.appendChild(inner);
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var p = self._pendingPromo; self._closePromo();
          if (p) self._commit(p.from, p.to, kind);
        });
        card.appendChild(btn);
      });
      this._promoEl.appendChild(card);
      this._promoEl.classList.add('on');
    }
    _closePromo() { this._pendingPromo = null; this._promoEl.classList.remove('on'); this._promoEl.innerHTML = ''; }

    flip() { this.flipped = !this._flipped; }
  }

  if (!customElements.get('chess-board')) customElements.define('chess-board', ChessBoardEl);
})();
