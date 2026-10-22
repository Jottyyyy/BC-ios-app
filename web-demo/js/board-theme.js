/* board-theme.js — the one board theme every board draws (Profile → "♟️ Board Theme").
 *
 * Browser twin of `BoardThemeStore.swift`. Client round 3: "hindi mapalitan kulay sa chessboard ng
 * puzzle". The RN app has ONE theme, saved, chosen on its Profile screen under "Applies to all
 * chess boards" (`contexts/BoardThemeContext.tsx`). The port kept it inside the Analysis Board's ☰
 * menu, unsaved, and every other board drew Classic Brown.
 *
 * Every `<chess-board>` already reads `--board-light` / `--board-dark` by inheritance, so applying
 * the theme is two custom properties on the document root — no board needs to know this exists.
 * The themes themselves are `BiyaAnalysisMetrics.BOARD_THEMES`, the one table both screens share.
 */
'use strict';

var BiyaBoardTheme = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;

  /** `BoardThemeStore.storageKey`, and listed in `BiyaLogin.ACCOUNT_DATA.erasedKeys`. */
  var KEY = 'biya.board.theme.v1';

  // The Profile card's copy and geometry — RN `profile/index.tsx`, "Board Theme Settings",
  // extracted to `tools/metrics/board_styles.json` → `boardThemes`; board_theme_check.js compares.
  var PICKER = {
    title: '♟️ Board Theme', subtitle: 'Applies to all chess boards', check: '✓',
    cardFill: '#1A2942', cardRadius: 16, cardPadding: 16,
    titleSize: 16, titleColor: '#FFFFFF', titleMarginBottom: 4,
    subtitleSize: 12, subtitleColor: '#8BA3C7', subtitleMarginBottom: 12,
    optionGap: 14, optionPadding: 12, optionRadius: 12, optionMarginTop: 8,
    optionFill: '#253552', activeFill: '#1E3A5F', activeBorder: 1, activeBorderColor: '#FDB022',
    miniBoard: 40, miniRadius: 4, miniSquare: 10, miniCells: 4,
    labelSize: 15, labelColor: '#8BA3C7', labelActiveColor: '#FFFFFF',
    checkSize: 18, checkColor: '#FDB022'
  };

  /** `(r + c) % 2 === 0 ? t.light : t.dark` — the mini board's top-left square is light. */
  function isLight(row, col) { return (row + col) % 2 === 0; }

  /** The saved theme's key, or the default — an unknown or unreadable value never throws. */
  function get() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { v = null; }
    return MET.BOARD_THEMES[v] ? v : MET.DEFAULT_BOARD_THEME;
  }

  function colors(name) { return MET.BOARD_THEMES[name || get()]; }

  /** Paint the saved theme onto the document root, where every board inherits it. */
  function apply() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var t = colors();
    document.documentElement.style.setProperty('--board-light', t.light);
    document.documentElement.style.setProperty('--board-dark', t.dark);
  }

  function set(name) {
    if (!MET.BOARD_THEMES[name]) return;
    try { localStorage.setItem(KEY, name); } catch (e) { /* private window: this tab only */ }
    apply();
  }

  /** The next theme in order — the Analysis Board's ☰ shortcut. */
  function cycle() {
    var keys = Object.keys(MET.BOARD_THEMES);
    set(keys[(keys.indexOf(get()) + 1) % keys.length]);
  }

  /** Delete-account: the key is erased with the rest; the boards go back to Classic Brown. */
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to forget */ }
    apply();
  }

  /** The Profile card. `onChange` lets the screen repaint its ✓ without owning the state. */
  function pickerCard(onChange) {
    var P = PICKER;
    var card = document.createElement('div');
    card.className = 'bt-card';
    var title = document.createElement('div');
    title.className = 'bt-title'; title.textContent = P.title;
    var sub = document.createElement('div');
    sub.className = 'bt-sub'; sub.textContent = P.subtitle;
    card.appendChild(title); card.appendChild(sub);
    var current = get();
    Object.keys(MET.BOARD_THEMES).forEach(function (key) {
      var t = MET.BOARD_THEMES[key];
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'bt-option' + (key === current ? ' bt-active' : '');
      row.setAttribute('aria-pressed', key === current ? 'true' : 'false');
      var mini = document.createElement('div');
      mini.className = 'bt-mini';
      for (var r = 0; r < P.miniCells; r++) {
        for (var c = 0; c < P.miniCells; c++) {
          var sq = document.createElement('span');
          sq.style.background = isLight(r, c) ? t.light : t.dark;
          mini.appendChild(sq);
        }
      }
      var label = document.createElement('span');
      label.className = 'bt-label'; label.textContent = t.swatch + ' ' + t.label;
      row.appendChild(mini); row.appendChild(label);
      if (key === current) {
        var check = document.createElement('span');
        check.className = 'bt-check'; check.textContent = P.check;
        row.appendChild(check);
      }
      row.onclick = function () { set(key); if (onChange) onChange(key); };
      card.appendChild(row);
    });
    return card;
  }

  /** Every PICKER number as a CSS custom property — the stylesheet carries none of its own. */
  function applyPickerMetrics(node) {
    var P = PICKER, px = function (n) { return n + 'px'; };
    var map = {
      '--bt-card-fill': P.cardFill, '--bt-card-r': px(P.cardRadius), '--bt-card-pad': px(P.cardPadding),
      '--bt-title-fs': px(P.titleSize), '--bt-title-color': P.titleColor,
      '--bt-title-mb': px(P.titleMarginBottom), '--bt-sub-fs': px(P.subtitleSize),
      '--bt-sub-color': P.subtitleColor, '--bt-sub-mb': px(P.subtitleMarginBottom),
      '--bt-gap': px(P.optionGap), '--bt-pad': px(P.optionPadding), '--bt-r': px(P.optionRadius),
      '--bt-mt': px(P.optionMarginTop), '--bt-fill': P.optionFill, '--bt-active-fill': P.activeFill,
      '--bt-active-border': px(P.activeBorder), '--bt-active-color': P.activeBorderColor,
      '--bt-mini': px(P.miniBoard), '--bt-mini-r': px(P.miniRadius), '--bt-mini-sq': px(P.miniSquare),
      '--bt-label-fs': px(P.labelSize), '--bt-label-color': P.labelColor,
      '--bt-label-active': P.labelActiveColor, '--bt-check-fs': px(P.checkSize),
      '--bt-check-color': P.checkColor
    };
    Object.keys(map).forEach(function (k) { node.style.setProperty(k, map[k]); });
  }

  // Applied at load, before any screen draws a board — otherwise the first paint after a reload
  // would flash Classic Brown and then repaint.
  apply();

  return {
    KEY: KEY, PICKER: PICKER, isLight: isLight,
    get: get, set: set, cycle: cycle, colors: colors, apply: apply, forget: forget,
    pickerCard: pickerCard, applyPickerMetrics: applyPickerMetrics
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaBoardTheme; }
