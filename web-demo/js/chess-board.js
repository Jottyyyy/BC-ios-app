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
 *
 * ── Properties ────────────────────────────────────────────────────────────
 *   .rules = { legalMovesFrom(fen, sq) -> [{to, promotion|null}] }
 *   .fen  .flipped  .interactive
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
    static get observedAttributes() { return ['fen', 'flipped', 'interactive', 'coordinates', 'piece-path']; }

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
    }

    // ---- lifecycle ----------------------------------------------------------
    connectedCallback() {
      if (!this._built) this._build();
      if (this.hasAttribute('flipped')) this._flipped = this.getAttribute('flipped') !== 'false';
      if (this.hasAttribute('interactive')) this._interactive = this.getAttribute('interactive') !== 'false';
      if (this.hasAttribute('coordinates')) this._coords = this.getAttribute('coordinates') !== 'false';
      if (this.hasAttribute('piece-path')) this._piecePath = this.getAttribute('piece-path');
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
      this._boardEl.appendChild(this._squaresEl);
      this._boardEl.appendChild(this._piecesEl);
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
