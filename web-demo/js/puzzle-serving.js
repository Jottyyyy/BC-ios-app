/* puzzle-serving.js — twin of `Sources/BiyaherongCoachCore/PuzzleServing.swift`.
 *
 * The three fallback ladders, ported from the Laravel `PuzzleController` / `StreakController` and
 * pinned by the `serving` golden group. Array-based and side-effect free: it takes a `seen` set as
 * an argument and never mutates anything, which is why the Tier-3 "reset" it reports is a FLAG
 * (`didReset`) and not an action. See `puzzle-store.js` for who acts on it — that separation is
 * what makes spec fix #7 (scope the wipe) a caller-side change with the pinned engine untouched.
 *
 * `inRandomOrder()` is modelled as an injected picker, exactly as in Swift, so the deterministic
 * parts of the ladder stay golden-testable.
 */
'use strict';

var BiyaPuzzleServing = (function () {

  var REGULAR_WINDOW = 100;    // Play Puzzles
  var STREAK_WINDOW = 50;      // Streak / Turbo
  var THEMATIC_WINDOW = 200;   // Thematic

  var STAGE = {
    windowUnseen: 'windowUnseen',
    anyUnseenRandom: 'anyUnseenRandom',
    anyUnseenClosest: 'anyUnseenClosest',
    afterResetRandom: 'afterResetRandom',
    afterResetClosest: 'afterResetClosest',
    none: 'none',
  };

  function hasTheme(c, theme) { return theme == null || c.themes.indexOf(theme) >= 0; }
  function isSeen(seen, id) { return seen && (seen.has ? seen.has(id) : seen.indexOf(id) >= 0); }

  /** `whereBetween('rating', [c-w, c+w])` — inclusive both ends — plus theme and unseen filters. */
  function eligibleInWindow(pool, center, window, theme, seen) {
    var lo = center - window, hi = center + window;
    return pool.filter(function (c) {
      return c.rating >= lo && c.rating <= hi && hasTheme(c, theme) && !isSeen(seen, c.id);
    });
  }

  /** Any unseen puzzle (optional theme filter), no rating window. */
  function eligibleUnseen(pool, theme, seen) {
    return pool.filter(function (c) { return hasTheme(c, theme) && !isSeen(seen, c.id); });
  }

  /**
   * `orderByRaw('ABS(rating - ?)')->first()` — nearest by absolute rating distance, ties broken by
   * ascending id (the DB's natural order). Ignores `seen` by design: this is the stage that runs
   * after the reset.
   */
  function closestByAbs(pool, center, theme) {
    var best = null, bd = 0;
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i];
      if (!hasTheme(c, theme)) continue;
      var d = Math.abs(c.rating - center);
      if (best === null || d < bd || (d === bd && c.id < best.id)) { best = c; bd = d; }
    }
    return best;
  }

  /** Deterministic picker (lowest id) — what the golden tests inject for `inRandomOrder()`. */
  function lowestIdPicker(list) {
    var best = null;
    for (var i = 0; i < list.length; i++) if (best === null || list[i].id < best.id) best = list[i];
    return best;
  }

  function sel(candidate, stage, didReset) {
    return { candidate: candidate, stage: stage, didReset: didReset };
  }

  /**
   * Streak / Turbo (`assignPuzzle`):
   *   1. unseen within ±window (random)   2. any unseen, CLOSEST by ABS   3. reset, CLOSEST by ABS
   *
   * The stage-3 reset is UNCONDITIONAL in PHP — the seen rows are deleted before the query runs —
   * so `didReset` is true whenever stages 1 and 2 both miss, even when the pool is empty.
   */
  function serveClosest(pool, center, window, theme, seen, pick) {
    pick = pick || lowestIdPicker;
    var hit = pick(eligibleInWindow(pool, center, window, theme, seen));
    if (hit) return sel(hit, STAGE.windowUnseen, false);
    var s2 = eligibleUnseen(pool, theme, seen);
    if (s2.length) {
      var near = closestByAbs(s2, center, theme);
      if (near) return sel(near, STAGE.anyUnseenClosest, false);
    }
    var after = closestByAbs(pool, center, theme);
    if (after) return sel(after, STAGE.afterResetClosest, true);
    return sel(null, STAGE.none, true);
  }

  /**
   * Play Puzzles (`getRandomPuzzle`, regular branch):
   *   1. unseen within ±100 (random)   2. any unseen (random)   3. reset, ±100 ?? any (random)
   */
  function serveRandom(pool, center, window, theme, seen, pick) {
    pick = pick || lowestIdPicker;
    var hit = pick(eligibleInWindow(pool, center, window, theme, seen));
    if (hit) return sel(hit, STAGE.windowUnseen, false);
    hit = pick(eligibleUnseen(pool, theme, seen));
    if (hit) return sel(hit, STAGE.anyUnseenRandom, false);
    hit = pick(eligibleInWindow(pool, center, window, theme, null));
    if (hit) return sel(hit, STAGE.afterResetRandom, true);
    hit = pick(eligibleUnseen(pool, theme, null));
    if (hit) return sel(hit, STAGE.afterResetRandom, true);
    return sel(null, STAGE.none, true);
  }

  /**
   * Thematic (`getThematicPuzzle`) — a HYBRID, distinct from both of the above:
   *   1. unseen within ±200 (random)   2. any unseen with the theme (random)
   *   3. reset, then CLOSEST by ABS (deterministic)
   */
  function serveThematic(pool, center, window, theme, seen, pick) {
    pick = pick || lowestIdPicker;
    if (window == null) window = THEMATIC_WINDOW;
    var hit = pick(eligibleInWindow(pool, center, window, theme, seen));
    if (hit) return sel(hit, STAGE.windowUnseen, false);
    hit = pick(eligibleUnseen(pool, theme, seen));
    if (hit) return sel(hit, STAGE.anyUnseenRandom, false);
    var after = closestByAbs(pool, center, theme);
    if (after) return sel(after, STAGE.afterResetClosest, true);
    return sel(null, STAGE.none, true);
  }

  return {
    REGULAR_WINDOW: REGULAR_WINDOW, STREAK_WINDOW: STREAK_WINDOW,
    THEMATIC_WINDOW: THEMATIC_WINDOW, STAGE: STAGE,
    eligibleInWindow: eligibleInWindow, eligibleUnseen: eligibleUnseen,
    closestByAbs: closestByAbs, lowestIdPicker: lowestIdPicker,
    serveClosest: serveClosest, serveRandom: serveRandom, serveThematic: serveThematic,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BiyaPuzzleServing;
