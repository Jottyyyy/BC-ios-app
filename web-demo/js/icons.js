/* icons.js — the app's navigation icons, drawn as vectors in one place.
 *
 * The browser twin of DemoApp/Sources/BiyaherongUI/NavIcons.swift. Both draw from the SAME numbers
 * (`GEO` below ↔ `NavIcon` in Theme.swift), and `tools/qa/nav_icons_check.js` asserts they agree.
 *
 * Why this file exists. Back and menu were TEXT GLYPHS — `←` (U+2190) and `☰` (U+2630) — drawn at
 * 22px in Nunito, a font that has neither, so each fell back to whatever the platform picked. `☰`
 * is the I Ching trigram for heaven, not a hamburger: thin bars, uneven gaps. `CoachLayout.swift`
 * said it out loud: "icons that happen to be characters."
 *
 * And the two languages had already drifted. Swift drew `Image(systemName: "chevron.left")` on the
 * puzzle screens and the paywall while this side drew `←` on the same screens, with no gate to
 * notice. One drawing, from one set of numbers, is the fix for both problems at once.
 *
 * `stroke="currentColor"` is load-bearing: every screen keeps its OWN colour rule — pairing's gold,
 * coach's white, analysis's off-white — and nothing here has to know about any of them.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaIcons = (function () {
  'use strict';

  /**
   * The one geometry, in a 24×24 box. Mirrored by `NavIcon` in Theme.swift.
   *
   * `stroke` 2 with round caps and joins is the weight the rest of the app's line art already uses
   * (`app.js`'s undo/flip icons); at 24px it reads crisp on a 3x phone without going spindly.
   */
  var GEO = {
    box: 24,
    stroke: 2,
    // The chevron: a two-segment polyline from top-right, in to the left, back out to bottom-right.
    // Inset 8/6 keeps it optically centred — a chevron's visual mass sits at its apex, not its box
    // centre, so equal insets would look shifted right.
    chevronX: 9, chevronTop: 5, chevronBottom: 19, chevronApex: 15,
    // Three bars, evenly spaced. `barInset` from each side, `barGap` between them. A real
    // hamburger, not a trigram: equal weight, equal gaps.
    barInset: 4, barTop: 7, barGap: 5
  };

  function svg(size, body) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + GEO.box + ' ' + GEO.box
      + '" fill="none" stroke="currentColor" stroke-width="' + GEO.stroke
      + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /** `‹` — the iOS convention for back, and what Swift already drew on four screens. */
  function back(size) {
    var d = 'M' + GEO.chevronApex + ' ' + GEO.chevronTop
      + ' L' + GEO.chevronX + ' ' + (GEO.box / 2)
      + ' L' + GEO.chevronApex + ' ' + GEO.chevronBottom;
    return svg(size || GEO.box, '<path d="' + d + '"/>');
  }

  /** Three even bars. */
  function menu(size) {
    var x1 = GEO.barInset, x2 = GEO.box - GEO.barInset, out = '';
    for (var i = 0; i < 3; i++) {
      var y = GEO.barTop + i * GEO.barGap;
      out += '<path d="M' + x1 + ' ' + y + ' H' + x2 + '"/>';
    }
    return svg(size || GEO.box, out);
  }

  /**
   * The brand mark, in the gold ring every screen header carries.
   *
   * `tools/metrics/puzzle_styles.json` -> `shared.logo._source` is `components/AppLogo.tsx`: a View
   * with a 2px gold border, a radius of half its size, and `overflow: hidden` — a ring **around an
   * image**. The browser ported the ring to nine headers and never the image, so every one of them
   * has been drawing an empty gold circle. This is the image.
   *
   * One function rather than nine `<img>` strings, so the asset path exists once. The wrapper keeps
   * whichever `*-logo` class its screen already styles; only the `img` inside is new.
   */
  var BRAND_SRC = 'assets/images/brand-logo.png';
  function brandLogoEl(cls) {
    var d = document.createElement('div');
    d.className = cls;
    d.innerHTML = '<img src="' + BRAND_SRC + '" alt="">';
    return d;
  }

  var API = { GEO: GEO, back: back, menu: menu, BRAND_SRC: BRAND_SRC, brandLogoEl: brandLogoEl };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  return API;
})();
