/* puzzle-app.js — the Puzzle Hub's app-level glue: one progress state, one store, shared.
 *
 * The pure layers (`puzzle-session`, `puzzle-store`, `puzzle-progress`, `puzzle-metrics`) know
 * nothing about storage or about each other's lifetime. Something has to own the single loaded
 * progress record and the single store over the corpus, or the hub, the home and the solver each
 * end up with their own copy and the seen-set silently forks.
 *
 * Small on purpose. It holds no view state and makes no decisions the pure layer could make.
 *
 * Mirrors what `PuzzleProgressFile` + a `@StateObject` owner do on the Swift side.
 */
'use strict';

var BiyaPuzzleApp = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var PROG = isNode ? require('./puzzle-progress.js') : BiyaPuzzleProgress;
  var STORE = isNode ? require('./puzzle-store.js') : BiyaPuzzleStore;
  var DATA = isNode ? require('./puzzle-data.js') : BiyaPuzzleData;

  var _state = null;
  var _store = null;

  function now() { return Date.now(); }

  /** The single loaded progress record. Seeded on first use. */
  function state() {
    if (!_state) _state = PROG.load(now());
    return _state;
  }

  function persist() { if (_state) PROG.save(_state); }

  /**
   * The single store over the browser's corpus slice.
   *
   * The seen set is the SAME Set object the store mutates, so a serve is reflected in the progress
   * record without a copy step — `commitSeen` then flattens it back to a sorted array for the file.
   */
  function store() {
    if (!_store) {
      _store = STORE.create(STORE.arraySource(DATA.puzzles), {
        seen: PROG.seenSet(state()),
        daily: DATA.dailyPool,
      });
    }
    return _store;
  }

  /** Serve, remember, and persist in one step, so no caller can forget the middle one. */
  function serveRated() {
    var r = store().nextRated(state().profile.rating);
    PROG.commitSeen(state(), store().seen);
    persist();
    return r;
  }

  /**
   * Streak / Turbo. The window is +-50 around an explicit target, with the warmup theme when one
   * is in force. Wrapped for the same reason as `serveRated`: a screen calling
   * `store().nextStreak(...)` directly would mutate the store's seen set and never write it back,
   * so the persisted record would fork from the live one.
   */
  function serveStreak(targetRating, theme) {
    var r = store().nextStreak(targetRating, theme || null);
    PROG.commitSeen(state(), store().seen);
    persist();
    return r;
  }

  /** Thematic. Window +-200, theme mandatory. */
  function serveThematic(theme) {
    var r = store().nextThematic(state().profile.rating, theme);
    PROG.commitSeen(state(), store().seen);
    persist();
    return r;
  }

  function dailyPuzzle(date) { return store().daily(date || new Date()); }

  /** Reset everything — the demo needs a way back to day one to check the empty states. */
  function reset() {
    _state = PROG.seed(now());
    _store = null;
    persist();
    return _state;
  }

  return {
    state: state, persist: persist, store: store,
    serveRated: serveRated, serveStreak: serveStreak, serveThematic: serveThematic,
    dailyPuzzle: dailyPuzzle, reset: reset,
    // Exposed for the screens, so they never reach for the globals themselves and a missing
    // <script> tag fails at load rather than inside a click handler.
    PROG: PROG, STORE: STORE, DATA: DATA,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleApp; }
