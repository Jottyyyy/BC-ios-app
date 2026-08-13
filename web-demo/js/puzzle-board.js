/* puzzle-board.js — the solver plumbing every mode shares, as a factory.
 *
 * Part 1 of the spec: *"Every solver screen shares the same board, the same move-validation core,
 * and the same promotion dialog. Build that core once and configure it per mode — do not write
 * five solvers."*
 *
 * The validation core already is once — `puzzle-session.js`. What was still duplicated is the
 * SCREEN plumbing: owning the `<chess-board>`, feeding it a rules adapter, running the mount
 * sequence with the mode's opponent delay, pumping submit → opponent reply → finish, and driving
 * the engine. This file is that, and nothing else.
 *
 * ── A factory, not a singleton ───────────────────────────────────────────────
 * `puzzle-solver.js` was written as an IIFE with twelve module-level variables. That is fine for
 * one screen and wrong for five: two solvers alive at once (a Turbo run behind a results overlay,
 * say) would share `session`, `timers` and `engineToken`. Each `create()` here owns its own.
 *
 * ── What it deliberately does NOT own ────────────────────────────────────────
 * Chrome. No header, no stats row, no banner, no result overlay, no buttons — those are what
 * genuinely differ between the five modes, and the RN source has five separate solver files for
 * exactly that reason. The host supplies them and receives callbacks.
 *
 * Promotion is not here either: `<chess-board>` owns that dialog and fires `move` only after the
 * piece has been chosen.
 */
'use strict';

var BiyaPuzzleBoard = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var E    = isNode ? require('./engine.js')           : Engine;
  var S    = isNode ? require('./puzzle-session.js')   : BiyaPuzzleSession;
  var MET  = isNode ? require('./puzzle-metrics.js')   : BiyaPuzzleMetrics;
  var AMET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;
  var HOST = isNode ? require('./engine-host.js')      : BiyaEngineHost;
  var AN   = isNode ? require('./analysis-engine.js')  : BiyaAnalysis;

  /**
   * The rules adapter `<chess-board>` needs to show legal targets. Shared by every mode.
   *
   * ## Indices in, indices out
   * The board speaks square INDICES — `e2` is `12` — and so does the engine. This adapter used to
   * do the opposite on every count, and the result was that **no puzzle mode ever accepted a
   * move**: it called `E.sqIndex(sq)` on a value that was already an index (which returns `null`),
   * filtered `m.from === null`, and so reported zero legal targets for every square. A square with
   * no targets cannot be tapped and cannot be dragged.
   *
   * It then returned `to` as a NAME where the board compares indices, so even a corrected filter
   * would have marked nothing.
   *
   * Deliberately the same shape as `analysis.js`'s adapter, which has always worked. One
   * convention, demonstrated by a screen that is known good, rather than a third invention.
   */
  function rulesAdapter() {
    return {
      legalMovesFrom: function (fen, sq) {
        var pos = E.fromFEN(fen);
        if (!pos) return [];
        return E.legalMovesFrom(pos, sq).map(function (m) {
          return { to: m.to, promotion: m.promotion };
        });
      },
    };
  }

  /**
   * The board's `move` event carries indices and a numeric promotion kind; `PuzzleSession.submit`
   * takes square NAMES and a promotion letter, because it builds a UCI string from them.
   *
   * That conversion has to happen exactly once, here at the boundary. Handing the indices straight
   * through made `submit` compute `12 + 28` as arithmetic and call the result a move.
   */
  function moveFromEvent(detail) {
    return {
      from: E.sqName(detail.from),
      to: E.sqName(detail.to),
      promotion: detail.promotion == null ? null
                                          : E.SAN_LETTER[detail.promotion].toLowerCase(),
    };
  }

  /**
   * A solver instance.
   *
   * `opts`:
   *   mode        one of `PuzzleSession.MODES`
   *   sound(name) optional
   *   onPhase()   called whenever the session's phase or position changes, so the host repaints
   *   onCorrect(outcome)  a correct move landed (not necessarily the last one)
   *   onSolved(outcome)   the puzzle is finished
   *   onWrong(outcome)    a wrong move landed; `outcome` carries the mode's policy verbatim
   *   onEngine(lines)     engine progress, when the host asked for it
   */
  function create(opts) {
    var mode = opts.mode;
    var sound = opts.sound || function () {};
    var fire = function (name, arg) { if (opts[name]) opts[name](arg); };

    var self = {
      mode: mode,
      session: null,
      puzzle: null,
      el: null,
      engineLines: null,
      engineBusy: false,
      _timers: [],
      _engineToken: 0,
      _alive: true,
    };

    function later(fn, ms) {
      var t = setTimeout(function () { if (self._alive) fn(); }, ms);
      self._timers.push(t);
      return t;
    }

    /** Every mode's mount is identical (Part 5.3); only the delay differs. */
    self.mount = function (puzzle) {
      self.cancel();
      self._alive = true;
      self.puzzle = puzzle;
      self.session = S.create(puzzle, mode);
      self.engineLines = null;
      self.engineBusy = false;
      sound('game-start');
      self.paint();
      fire('onPhase');
      later(function () {
        var r = S.applySetupMove(self.session);
        sound(r.sound);
        self.paint();
        fire('onMounted', r);
        fire('onPhase');
      }, S.opponentDelayMs(mode));
    };

    /** Part 5.4, pumped. The host never sees a raw move — only the outcome. */
    self.submit = function (from, to, promotion) {
      if (!self.session) return { kind: 'ignored' };
      var out = S.submit(self.session, from, to, promotion);
      if (out.kind === 'illegal') { self.paint(); return out; }
      if (out.kind === 'freePlay') { sound(out.sound); self.paint(); fire('onPhase'); return out; }

      if (out.kind === 'correct') {
        sound(out.sound);
        self.paint();
        fire('onCorrect', out);
        fire('onPhase');
        if (out.solved) { fire('onSolved', out); return out; }
        later(function () {
          var r = S.applyOpponentReply(self.session);
          sound(r.sound);
          self.paint();
          fire('onPhase');
          if (r.solved) later(function () { fire('onSolved', out); }, r.solvedAfterMs);
        }, out.opponentReplyAfterMs);
        return out;
      }

      // Wrong. The policy travels with the outcome — the host decides what to draw, but it does
      // not decide the RULES: whether the board snaps back, whether the run ends, whether a life
      // is spent and how long the banner lives all come from `WRONG_POLICY`.
      if (out.sound) sound(out.sound);
      self.paint();
      fire('onWrong', out);
      fire('onPhase');
      return out;
    };

    self.retry = function () {
      var r = S.retry(self.session);
      self.cancel();
      self._alive = true;
      sound(r.sound);
      self.paint();
      fire('onPhase');
      later(function () {
        var s = S.applySetupMove(self.session);
        sound(s.sound);
        self.paint();
        fire('onPhase');
      }, r.setupAfterMs);
      return r;
    };

    self.reveal = function () {
      var r = S.revealSolution(self.session);
      self.paint();
      fire('onPhase');
      if (MET.hasEnginePanel(mode)) self.runEngine();
      return r;
    };

    // ---- the board element ------------------------------------------------------------
    self.attach = function (parent) {
      self.el = document.createElement('chess-board');
      self.el.setAttribute('draggable-pieces', '');
      // The puzzle hub's dialog is the labelled-list one; `board.tsx`'s row of tiles stays the
      // default for Play and the Analysis Board. Set here, once, rather than in five screens.
      self.el.promotionLayout = 'list';
      self.el.rules = rulesAdapter();
      self.el.addEventListener('move', function (ev) {
        var m = moveFromEvent(ev.detail);
        self.submit(m.from, m.to, m.promotion);
      });
      parent.appendChild(self.el);
      return self.el;
    };

    self.paint = function () {
      if (!self.el || !self.session) return;
      var s = self.session;
      self.el.flipped = s.flipped;
      self.el.setPosition(E.toFEN(s.position), { animate: true, lastMove: s.lastMove || null });
      // Locked to the solver's colour while playing; unlocked for two-sided play once the answer
      // is out (Part 6.5).
      self.el.interactive = s.phase === 'playing' || s.phase === 'reviewing';
      var showArrows = s.phase === 'reviewing' || s.phase === 'solved';
      self.el.arrows = (showArrows && self.engineLines)
        ? self.engineLines.slice(0, MET.engineLineCount(mode))
            .filter(function (l) { return l.from && l.to; })
            .map(function (l, i) { return { from: l.from, to: l.to, rank: i }; })
        : [];
    };

    /**
     * Part 13.3's solution strip highlights the answer without playing it.
     *
     * Its own two-toned channel, not `highlightLastMove`: the reveal has to read as a *direction*
     * (from is dimmer than to), and it must not be wiped by the next `paint()`, which sets the
     * last-move squares from the session every time.
     *
     * Pass `null` to clear.
     */
    self.highlightSolution = function (uci) {
      if (!self.el) return;
      if (!uci) { self.el.highlightSolution(null); return; }
      self.el.highlightSolution(uci.slice(0, 2), uci.slice(2, 4));
    };

    // ---- the engine (Part 18) -----------------------------------------------------------
    self.runEngine = function () {
      if (!self.session) return;
      var token = ++self._engineToken;
      self.engineBusy = true;
      self.engineLines = null;
      fire('onEngine', null);
      HOST.analyzeProgressive(self.session.position, {
        maxDepth: AMET.ENGINE_LIMITS.maxDepth,
        multiPV: AMET.ENGINE_LIMITS.multiPV,
        deadlineMs: AMET.TIMINGS.engineDeadline,
        shouldCancel: function () { return token !== self._engineToken || !self._alive; },
        onDepth: function (snap) {
          if (token !== self._engineToken) return;
          self.engineLines = rowsOf(snap);
          fire('onEngine', self.engineLines);
        },
      }).then(function (snap) {
        if (token !== self._engineToken) return;
        self.engineBusy = false;
        if (snap) self.engineLines = rowsOf(snap);
        fire('onEngine', self.engineLines);
        self.paint();
      });
    };

    function rowsOf(snap) {
      if (!snap || !snap.lines) return [];
      return snap.lines.map(function (ln, i) {
        var first = ln.pv && ln.pv.length ? ln.pv[0] : null;
        return {
          rank: i,
          san: (ln.pvSAN && ln.pvSAN[0]) || '',
          evalText: AN.formatScore(ln.score),
          continuation: (ln.pvSAN || []).slice(MET.ENGINE.pvFrom, MET.ENGINE.pvTo).join(' '),
          from: first ? E.sqName(first.from) : null,
          to: first ? E.sqName(first.to) : null,
        };
      });
    }

    /**
     * Schedule work on the solver's OWN cancellable timer list.
     *
     * Exposed because Turbo's `advanceMs` is returned in the wrong-move outcome but scheduled by
     * the screen, not the factory. A screen-owned `setTimeout` would survive `destroy()`, so a
     * stray advance could mount the next puzzle behind an already-showing results overlay.
     */
    self.schedule = function (fn, ms) { return later(fn, ms); };

    /** Cancel every timer and abandon any search. Called on leave, on retry, and on remount. */
    self.cancel = function () {
      self._timers.forEach(clearTimeout);
      self._timers = [];
      self._engineToken += 1;
    };

    /** Cancel, and refuse to fire anything further — a solver that has left the screen. */
    self.destroy = function () {
      self._alive = false;
      self.cancel();
    };

    /** The hint line every mode words slightly differently but derives identically. */
    self.userIsWhite = function () {
      return self.session ? self.session.userColor === E.WHITE : true;
    };

    return self;
  }

  return { create: create, rulesAdapter: rulesAdapter, moveFromEvent: moveFromEvent };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleBoard; }
