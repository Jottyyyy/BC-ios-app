/* analysis-metrics.js — the Analysis Board's PURE layer
 *
 * The browser mirror of DemoApp/Sources/BiyaherongUI/AnalysisMetrics.swift.
 *
 *     node -e "console.log(require('./web-demo/js/analysis-metrics.js').selfTest().summary)"
 *
 * Nothing here draws anything. That is the point: the same rule the home screen established —
 * **no numeric literal and no arithmetic in any view body** — is what lets a self-check assert the
 * whole layout without a renderer. Break it and coverage drains away silently.
 *
 * Where the numbers come from. Most are extracted mechanically from the React Native source by
 * `tools/metrics/extract_board_styles.js` into `tools/metrics/board_styles.json` — 328 style keys,
 * 1,355 properties, zero unresolved. `selfTestSource()` asserts the values encoded here against that
 * file, so a typo fails rather than ships. This matters: the prose spec says "eval bar height 3",
 * but the source has TWO bars — the main one is 8 and only the per-line micro bar is 3.
 *
 * Deliberate deviations from the RN source are marked DEVIATION and excluded from that comparison.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaAnalysisMetrics = (function () {
  'use strict';

  // ---- Board geometry -------------------------------------------------------
  // From components/DragDropChessBoard.tsx: snap the PHYSICAL pixel width down to a multiple of 8
  // before dividing, so squares land on whole pixels and no seam appears at 2x/3x.
  function boardSize(screenWidth, pixelRatio) {
    var r = pixelRatio || 1;
    return (Math.floor(Math.round(screenWidth * r) / 8) * 8) / r;
  }
  function squareSize(screenWidth, pixelRatio) { return boardSize(screenWidth, pixelRatio) / 8; }
  var PIECE_RATIO = 0.95;                     // spec 3.1: piece is 95% of a square
  function pieceSize(square) { return square * PIECE_RATIO; }

  /** Logical square -> visual (col,row), origin top-left, honouring board flip. */
  function visual(sq, flipped) {
    var file = sq & 7, rank = sq >> 3;
    return { col: flipped ? 7 - file : file, row: flipped ? rank : 7 - rank };
  }
  /** Centre of a square in board-local points. */
  function squareCenter(sq, square, flipped) {
    var v = visual(sq, flipped);
    return { x: (v.col + 0.5) * square, y: (v.row + 0.5) * square };
  }
  /** Light-square test in LOGICAL coordinates (a1 = 0), matching BoardView.cell. */
  function isLightSquare(sq) { return (((sq & 7) + (sq >> 3)) % 2) === 1; }

  // ---- Palette --------------------------------------------------------------
  // Screen-local, exactly as HomePalette is: these greys belong to this screen, not to the global
  // design system. Every value is the real one from board.tsx.
  var PALETTE = {
    screenBg: '#263238',        // the board screen is a warmer blue-grey than the app's navy
    surface: '#1B2631',         // header, status bar, move strip, engine strip, panels, sheets
    surfaceAlt: '#37474F',      // buttons, chips, inputs, autoplay bar, promotion tiles
    surfaceAlt2: '#2D3E49',     // rows inside panels
    sheetChrome: '#263040',
    promoTile: '#455A64',
    divider: '#37474F',
    dividerDark: '#263040',
    gold: '#FDB022',
    onGold: '#0F1A2E',
    textPrimary: '#ECEFF1',
    textSecondary: '#90A4AE',
    textSecondaryAlt: '#8BA3C7',
    textMuted: '#546E7A',
    textMutedAlt: '#5A6E87',
    success: '#4CAF50',
    danger: '#F44336',
    spinner: '#90CAF9',         // the engine "analyzing" indicator, distinct from the gold one
    evalTrack: '#2A3540',
    evalFill: '#DEDEDE',
    editLight: '#E8D5B0',       // edit mode uses its own board colours so it reads as "editing"
    editDark: '#A87E5A',
    reviewCard: '#151E2A',
    graphBg: '#0F1A2E'
  };

  // ---- Board themes (spec 3.2) ----------------------------------------------
  // DEVIATION: the RN board had a single colour pair. Three user-selectable themes are new.
  var BOARD_THEMES = {
    classic: { label: 'Classic Brown', light: '#F0D9B5', dark: '#B58863' },
    green: { label: 'Tournament Green', light: '#EEEED2', dark: '#769656' },
    blue: { label: 'Blue', light: '#BFD4E0', dark: '#6B8FA8' }
  };
  var DEFAULT_BOARD_THEME = 'classic';

  // ---- Square highlights (spec 3.3) -----------------------------------------
  // These REPLACE the square fill rather than tinting over it, which is why the fill is resolved by
  // one function with an explicit precedence rather than by stacked translucent layers.
  var HIGHLIGHT = { selected: '#F6F669', lastMove: '#CDD26A' };

  /**
   * Square fill, strict precedence: selected/drag-origin > custom (engine preview) > last move >
   * the theme colour.
   */
  function squareFill(sq, opts) {
    var o = opts || {};
    if (o.selected === sq || o.dragOrigin === sq) return HIGHLIGHT.selected;
    if (o.custom && o.custom[sq]) return o.custom[sq];
    if (o.lastMove && (o.lastMove.from === sq || o.lastMove.to === sq)) return HIGHLIGHT.lastMove;
    var theme = BOARD_THEMES[o.theme || DEFAULT_BOARD_THEME];
    return isLightSquare(sq) ? theme.light : theme.dark;
  }

  // ---- Legal-move indicators (spec 3.7) --------------------------------------
  var INDICATOR = {
    dotRatio: 0.3, dotFill: 'rgba(0,0,0,0.2)',
    ringRatio: 0.85, ringStrokeRatio: 0.08, ringStroke: 'rgba(0,0,0,0.25)'
  };
  function dotSize(square) { return square * INDICATOR.dotRatio; }
  function ringSize(square) { return square * INDICATOR.ringRatio; }
  function ringStrokeWidth(square) { return square * INDICATOR.ringStrokeRatio; }

  // ---- Arrows (spec 3.9; multipliers from renderArrowsOverlay) ---------------
  var ARROW_COLORS = ['rgba(76, 175, 80, 0.85)', 'rgba(68, 138, 255, 0.80)', 'rgba(255, 152, 0, 0.80)'];
  var ARROW = { strokeRatio: 0.18, headRatio: 0.35, shortenRatio: 0.7, headHalfWidthRatio: 0.6 };

  /**
   * Everything a renderer needs for one engine arrow. The line stops short of the destination by
   * `head * shorten` so the shaft does not poke through the arrowhead.
   */
  function arrowGeometry(from, to, square, flipped) {
    var a = squareCenter(from, square, flipped);
    var b = squareCenter(to, square, flipped);
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    var ux = len > 0 ? dx / len : 0, uy = len > 0 ? dy / len : 0;
    var head = square * ARROW.headRatio;
    var shorten = head * ARROW.shortenRatio;
    var half = head * ARROW.headHalfWidthRatio;
    return {
      start: a,
      end: { x: b.x - ux * shorten, y: b.y - uy * shorten },
      tip: b,
      left: { x: b.x - ux * head - (-uy) * half, y: b.y - uy * head - ux * half },
      right: { x: b.x - ux * head + (-uy) * half, y: b.y - uy * head + ux * half },
      strokeWidth: square * ARROW.strokeRatio,
      headSize: head
    };
  }
  function arrowColor(rank) { return ARROW_COLORS[rank] || ARROW_COLORS[ARROW_COLORS.length - 1]; }

  // ---- Annotation badge (spec 3.10; from renderAnnotationOverlay) ------------
  var BADGE = {
    radiusRatio: 0.21, offsetRatio: 0.29, shadowOffset: 1.5, ringExtra: 1.5,
    fontRatioShort: 1.1, fontRatioLong: 0.88, baselineRatio: 0.37
  };
  function badgeGeometry(sq, square, flipped, symbolLength) {
    var c = squareCenter(sq, square, flipped);
    var r = square * BADGE.radiusRatio;
    // BOTTOM-right. `squareToPixel` returns the square CENTRE and renderAnnotationOverlay adds
    // `+ SQUARE_SIZE * 0.29` to BOTH axes (board.tsx:2676-2678). This read `- offsetRatio` until
    // Phase 11 — see renderConstants in board_styles.json, which now pins the sign.
    var cx = c.x + square * BADGE.offsetRatio;
    var cy = c.y + square * BADGE.offsetRatio;
    var font = r * (symbolLength > 1 ? BADGE.fontRatioLong : BADGE.fontRatioShort);
    return {
      center: { x: cx, y: cy },
      radius: r,
      ringRadius: r + BADGE.ringExtra,
      shadowCenter: { x: cx + BADGE.shadowOffset, y: cy + BADGE.shadowOffset },
      fontSize: font,
      textBaseline: cy + font * BADGE.baselineRatio
    };
  }

  // ---- Bands (spec 1.2) — real values from board.tsx -------------------------
  // DEVIATION: the spec lists seven literal heights, which overflow a 375x667 screen. Fixed bands
  // keep their source values; the panels band flexes down from its max and the board absorbs slack.
  var BANDS = {
    headerPaddingH: 8, headerPaddingV: 6, headerBtnW: 40, headerBtnH: 36, headerBorder: 1,
    boardPaddingTop: 4,
    statusMinHeight: 38, statusPaddingLeft: 8, statusBorder: 1,
    // The status text gets its OWN row here, not the left half of the toolbar row. These are the
    // source's own numbers for exactly that: `styles.statusLine` is declared with a standalone
    // row's metrics and then never rendered — dead, like `renderEvalBar` and `menuContainer`. Nine
    // emoji buttons measure 346px in a 365px card, so the combined row leaves the status ~19px and
    // it vanishes; RN's icon glyphs are narrower than emoji, which is why the source got away with
    // it. Deviation recorded in PORTING_NOTES.
    statusLineMinHeight: 36, statusLinePaddingH: 12, statusLinePaddingV: 6,
    toolBtnPaddingH: 8, toolBtnPaddingV: 6, toolBtnRadius: 6, toolBtnMinWidth: 36,
    navBtnPaddingH: 5, navBtnPaddingV: 6, navBtnRadius: 6, navBtnMinWidth: 30,
    autoplayPaddingV: 6,
    stripMaxHeight: 44, stripPaddingH: 8, stripPaddingV: 6, stripGap: 2,
    panelsMaxHeight: 230, panelsPaddingH: 8,
    enginePaddingH: 6, enginePaddingTop: 3, enginePaddingBottom: 4,
    // What the engine band typically occupies, for the budget below. Not a height — the panel is
    // content-sized and claims the leftover itself. Was 60, for three single-line rows of 9-10pt
    // type; at 13pt with the continuation allowed to wrap it is ~102.
    engineStripEstimate: 102,
    // The opening book when there IS one — a single row of chips, not the 230pt panel it used to
    // be. Zero when out of book: the strip is simply not built.
    bookStripHeight: 44, bookChipGap: 5,
    engineMaxRows: 5, engineLineLimit: 2,
    // Move-strip tokens and branch chips — real values (movesStripMove, altChip).
    tokenPaddingH: 5, tokenPaddingV: 2, tokenRadius: 3, chipPaddingH: 8, chipPaddingV: 4,
    // Engine rows — real values (engineChipEval.width, engineLineRow).
    // DEVIATION on engineEvalWidth: source 36, sized for the 9pt eval it used to hold. At 13pt a
    // mate score (M-3) or a two-digit eval (+10.5) clips, so the column grows with the type.
    engineEvalWidth: 44, engineRowGap: 4, engineRowPaddingV: 1, engineRowPaddingH: 2,
    // Chrome this port introduces (the ECO panel and the branch picker replace a network panel and
    // a native modal). Small, local, and asserted so they cannot drift between the two languages.
    toolGap: 2, statusLineLimit: 2, singleLine: 1,
    rowGap: 3, rowSpacing: 6, rowPaddingH: 8, rowPaddingV: 5,
    // engineSanWidth grown with the type too — O-O-O and Qxd5+ are five glyphs.
    bookSanWidth: 46, engineSanWidth: 46,
    // The line-preview bar, which takes the STATUS LINE's row while an engine line is being walked
    // — so it borrows that row's paddings and minimum height and the band never jumps. Only the gap
    // and the two action buttons are its own.
    previewGap: 4, previewBtnPaddingH: 7, previewBtnPaddingV: 3, previewBtnRadius: 5,
    scrimOpacity: 0.55, sheetPadding: 10, sheetRadius: 12, sheetMaxWidth: 280
  };

  /**
   * Bands are (fixed, flexible) pairs: the panels band gives way first, then the board.
   *
   * The book strip counts as fixed now. It used to be the flexible band — a 230px ceiling on a
   * scrolling box, so it drew 230px to hold one line of "out of book" text while the engine rows
   * were squeezed to 9px beneath it. It is 44px with a book and NOTHING without one; the engine
   * panel claims the slack it used to hoard.
   *
   * `panels` is the EDIT-mode panel's budget now — the only thing still using that container.
   */
  function bandLayout(viewportHeight, boardEdge, inBook) {
    var book = (inBook === false) ? 0 : BANDS.bookStripHeight;
    var fixed = BANDS.headerBtnH + BANDS.statusMinHeight + BANDS.stripMaxHeight
      + BANDS.engineStripEstimate + book;
    var board = Math.min(boardEdge, Math.max(0, viewportHeight - fixed));
    var panels = Math.max(0, Math.min(BANDS.panelsMaxHeight, viewportHeight - fixed - board));
    return { fixed: fixed, board: board, panels: panels,
             total: fixed + board + panels, fits: fixed + board + panels <= viewportHeight };
  }

  /** Nunito's line height — what the rest of the app measures with; the mono face is close enough. */
  var ENGINE_LINE_RATIO = 1.364;

  /** Everything in the engine panel that is NOT a row: micro bar + margin, info row, padding. */
  function engineChromeHeight() {
    return EVAL_BAR.microHeight + EVAL_BAR.microMarginBottom
      + TYPE.engineDepth * ENGINE_LINE_RATIO + BANDS.chipPaddingV * 2
      + BANDS.enginePaddingTop + BANDS.enginePaddingBottom;
  }
  function engineRowHeight(lines) {
    return lines * TYPE.enginePv * ENGINE_LINE_RATIO + BANDS.rowGap;
  }
  /** How many rows of `lines` lines each survive in `available` pixels. */
  function engineRowsThatFit(available, lines) {
    var perRow = engineRowHeight(lines);
    if (perRow <= 0) return 0;
    return Math.max(0, Math.floor((available - engineChromeHeight()) / perRow));
  }
  /**
   * How many rows to draw, and how many lines each may wrap to.
   *
   * **Rows beat wrapping.** On a 375x667 SE three wrapped rows need 113px in a 61px band and the
   * clip would hide one and a half of them; three SINGLE-line rows fit exactly. Seeing every move
   * the engine considered, each truncated, beats seeing one and a half in full.
   *
   * A budget, not a measurement, so it can be a pixel or two out. That is safe: `.an-rows` clips, so
   * a wrong answer costs a hidden row, never an overdrawn move strip.
   */
  function enginePlan(available, wanted) {
    var want = Math.max(0, Math.min(wanted, BANDS.engineMaxRows));
    if (!want) return { rows: 0, lines: BANDS.engineLineLimit };
    if (engineRowsThatFit(available, BANDS.engineLineLimit) >= want) {
      return { rows: want, lines: BANDS.engineLineLimit };
    }
    var single = engineRowsThatFit(available, 1);
    return { rows: Math.max(1, Math.min(single, want)), lines: 1 };
  }

  // ---- Eval bar (spec 7.2) ---------------------------------------------------
  var EVAL_BAR = { mainHeight: 8, mainRadius: 4, microHeight: 3, microRadius: 1, microMarginBottom: 4 };
  var EVAL_CLAMP = 500;

  /** White's share of the bar, 0..1. A mate pins to 0.95 / 0.05 rather than the full end. */
  function evalBarFraction(cp, mate) {
    if (mate !== null && mate !== undefined) return mate > 0 ? 0.95 : 0.05;
    if (cp === null || cp === undefined) return 0.5;
    return 0.5 + Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, cp)) / (EVAL_CLAMP * 2);
  }

  // ---- Eval graph (spec 10) --------------------------------------------------
  var GRAPH = { height: 52, radius: 6, clamp: 500, lineWidth: 1.5 };
  function graphPoint(cp, mate, index, count, width, height) {
    var v = (mate !== null && mate !== undefined) ? (mate > 0 ? GRAPH.clamp : -GRAPH.clamp) : (cp || 0);
    var c = Math.max(-GRAPH.clamp, Math.min(GRAPH.clamp, v));
    return {
      x: count > 1 ? index * (width / (count - 1)) : 0,
      y: ((GRAPH.clamp - c) / (GRAPH.clamp * 2)) * height
    };
  }

  // ---- Game review: the accuracy modal + the eval graph (spec 9) ---------------
  // Real StyleSheet numbers from accModalStyles (29 keys) plus components/EvalGraph.tsx.
  // Everything here is pinned to board_styles.json in selfTestSource.
  var REVIEW = {
    scrim: 'rgba(0,0,0,0.92)', overlayPaddingH: 16, overlayPaddingV: 24,
    cardRadius: 18, cardBorder: 1, cardBorderColor: 'rgba(253,176,34,0.20)',
    // DEVICE-DERIVED: the source is `screenHeight * 0.80`; the extractor folds that to 675.2
    // against its 390x844 reference. Encode the RATIO — the literal is wrong on every other
    // screen. board_styles.json's _deviceDerived lists all three values of this shape.
    cardMaxHeightRatio: 0.80,
    headerPaddingTop: 20, headerPaddingBottom: 14, headerPaddingH: 20,
    hairline: 1, hairlineColor: 'rgba(255,255,255,0.07)',
    titleSize: 13, titleTracking: 2.5,
    loadingPaddingV: 36, loadingPaddingH: 24,
    loadingTextSize: 16, loadingTextColor: '#E0E0E0', loadingGap: 6,
    hintSize: 12, hintColor: 'rgba(255,255,255,0.35)', spinnerGap: 14,
    skipMarginTop: 20, skipPaddingV: 10, skipPaddingH: 28, skipRadius: 8,
    skipBorderColor: 'rgba(255,255,255,0.18)', skipTextSize: 13,
    skipTextColor: 'rgba(255,255,255,0.45)',
    contentPaddingH: 20, contentPaddingTop: 18, contentPaddingBottom: 4, sectionGap: 18,
    playerNameSize: 12, playerNameColor: 'rgba(255,255,255,0.45)', playerNameGap: 4,
    scoreSize: 36, scoreLineHeight: 40,
    scoreLabelSize: 10, scoreLabelColor: 'rgba(255,255,255,0.25)',
    scoreLabelTracking: 1.5, scoreLabelGap: 2,
    dividerWidth: 1, dividerHeight: 64, dividerColor: 'rgba(255,255,255,0.10)', dividerMarginH: 12,
    tableHeaderPaddingBottom: 6, tableHeaderGap: 2,
    sideColumnWidth: 36, sideLabelSize: 10, sideLabelColor: 'rgba(255,255,255,0.3)',
    rowPaddingV: 7, rowRuleColor: 'rgba(255,255,255,0.04)',
    countSize: 15, centreGap: 7, dotSize: 9, dotRadius: 5,
    nameSize: 13, nameColor: 'rgba(255,255,255,0.75)',
    footerPadding: 16, buttonRadius: 12, buttonPaddingV: 14,
    buttonTextSize: 15, buttonTextTracking: 0.3,
    graphInset: 64
  };
  function cardMaxHeight(viewportHeight) { return viewportHeight * REVIEW.cardMaxHeightRatio; }

  /**
   * `"Book B"` / `"Good"` — the label with its symbol, when it has one. `good`'s symbol is empty on
   * purpose, so the guard is on the string and not on the key (board.tsx:3896 does the same).
   */
  function classificationText(key) {
    var s = CLASSIFICATIONS[key];
    if (!s) return key;
    return s.symbol ? s.label + ' ' + s.symbol : s.label;
  }

  /** `"89.9%"` — one decimal, as toFixed(1) gives (board.tsx:3851). */
  function accuracyText(pct) { return pct.toFixed(1) + '%'; }

  /** The accuracy number's colour band (board.tsx:252-257). */
  function accuracyColor(pct) {
    if (pct >= 80) return '#4CAF50';
    if (pct >= 60) return '#FFC107';
    if (pct >= 40) return '#FF9800';
    return '#F44336';
  }

  /**
   * The eval graph's own colours, from components/EvalGraph.tsx — a different file from the modal.
   * It paints its OWN background (#1A2740) inside a wrapper that is already #0F1A2E (graphWrap).
   * Two different colours; missing that leaves the graph the wrong shade.
   */
  var GRAPH_STYLE = {
    wrapRadius: 8, wrapBackground: '#0F1A2E',
    background: '#1A2740', backgroundRadius: 6,
    whiteFill: 'rgba(255,255,255,0.25)', blackFill: 'rgba(0,0,0,0.35)',
    midLine: 'rgba(255,255,255,0.15)', midLineWidth: 1,
    curve: '#FDB022'
  };

  // ---- Persistence: the save form and the library (spec 10) --------------------
  // Real values from saveModalStyles (13 keys), loadModalStyles (5), and the bottom-sheet /
  // folder-chip keys in the main `styles` block. All pinned in selfTestSource.
  // ---- The ☰ sidebar menu (sidebarStyles, 12 keys; renderMenu:4489) ----------
  // NOTE the trap: `styles.menuContainer` (W * 0.65) belongs to a DEAD menu. renderMenu:4526 uses
  // `sidebarStyles.container` — W * 0.68 — and that is the one to encode. Both are flagged in
  // board_styles.json's _deviceDerived for exactly this reason.
  var MENU = {
    scrim: 'rgba(0,0,0,0.55)',
    widthRatio: 0.68,                       // NOT the literal 265.2 — that is one device's answer
    bg: '#1B2631', borderColor: '#263040', borderWidth: 1,
    headerPaddingH: 20, headerPaddingTop: 56, headerPaddingBottom: 16,
    titleSize: 20, titleColor: '#FFFFFF', titleTracking: 0.5,
    closeSize: 32, closeRadius: 16, closeBg: '#263040', closeGlyphSize: 16,
    sectionSize: 11, sectionColor: '#5A6E87', sectionTracking: 1.2,
    sectionPaddingH: 20, sectionPaddingTop: 18, sectionPaddingBottom: 6,
    itemPaddingV: 13, itemPaddingH: 20,
    iconSize: 18, iconWidth: 30,
    labelSize: 15, labelColor: '#E0E0E0',
    dotSize: 10, dotRadius: 5, dotIdle: '#455A64', dotActive: '#4CAF50'
  };
  /** The sidebar's width on a given screen. Encoded as a ratio, so it is right on every device. */
  function menuWidth(screenWidth) { return screenWidth * MENU.widthRatio; }

  // ---- Setup Position (the 28 `edit*` keys; renderEditPositionPanel:3615) -----
  var EDIT = {
    panelBg: '#1B2631', panelRadius: 9, panelPadding: 8,
    titleSize: 13, titleColor: '#ECEFF1', hintSize: 10, hintColor: '#546E7A',
    titleRowGap: 5,
    paletteGap: 4, paletteRowGap: 4,
    pieceBtn: 36, pieceBtnRadius: 5, piece: 26,
    lightSquare: '#E8D5B0', darkSquare: '#A87E5A',
    activeBorder: 2.5, activeBorderColor: '#FDB022', activeFill: 'rgba(253, 176, 34, 0.25)',
    actionGap: 5, actionPaddingV: 6, actionRadius: 7,
    actionBg: '#37474F', actionSize: 11, actionColor: '#90A4AE',
    eraseActiveBg: '#C62828', eraseActiveText: '#FFCDD2',
    turnDarkBg: '#3A3A3A', turnDarkText: '#E0E0E0', turnLightText: '#1A1A1A',
    castlingLabelSize: 10, castlingLabelColor: '#78909C', castlingTracking: 0.5,
    castlingGap: 5, castlingPaddingV: 6, castlingRadius: 7,
    castlingBg: '#37474F', castlingSize: 11, castlingColor: '#546E7A',
    castlingOnBg: '#1B3A1E', castlingOnBorder: '#4CAF50', castlingOnColor: '#4CAF50',
    errorColor: '#F44336', errorSize: 11,
    doneBg: '#FDB022', donePaddingV: 8, doneRadius: 9,
    doneColor: '#0F1A2E', doneSize: 13, doneTracking: 0.3,
    fenGap: 5, fenBg: '#37474F', fenRadius: 7, fenPaddingH: 10, fenPaddingV: 5,
    fenColor: '#ECEFF1', fenSize: 12,
    loadBorder: '#FDB022', loadColor: '#FDB022', loadPaddingH: 12, loadSize: 12,
    boardBorder: 1, boardBorderColor: '#37474F'
  };

  // ---- The remaining modals: PGN import, branch picker, variation card --------
  var MODALS = {
    // Import PGN (renderPgnModal:3757)
    pgnScrim: 'rgba(0,0,0,0.72)', pgnBg: '#1B2631', pgnRadius: 20, pgnPadding: 20,
    pgnInputBg: '#37474F', pgnInputRadius: 10, pgnInputMinHeight: 120, pgnInputMaxHeight: 220,
    pgnInputSize: 14, pgnInputColor: '#ECEFF1', pgnInputPadding: 14,
    // Choose Continuation (renderBranchSelectionModal:4311)
    branchBg: '#1B2631', branchRadius: 16, branchPadding: 20, branchWidth: 350,
    branchTitleSize: 17, branchSubSize: 12,
    optionBg: '#37474F', optionRadius: 10, optionPaddingV: 12, optionPaddingH: 14,
    optionBorderWidth: 3, optionBorderColor: '#546E7A', optionMainBorder: '#FDB022',
    optionMainBg: 'rgba(253,176,34,0.10)', optionMoveSize: 15, optionPreviewSize: 12,
    // Variation card (renderVariationModal:4357)
    varSheetBg: '#1A2634', varSheetRadius: 20, varHandleW: 36, varHandleH: 4,
    varMainColor: '#FDB022', varSubColor: '#78909C',
    varMainBg: 'rgba(253,176,34,0.12)', varSubBg: 'rgba(120,144,156,0.12)',
    varDeleteColor: '#EF5350', varDeleteBg: 'rgba(239,83,80,0.12)',
    varActionPaddingV: 12, varActionRadius: 12, varActionGap: 14,
    varTitleSize: 15, varSubtitleSize: 12,
    // Annotation picker (renderAnnotationPicker:3257)
    pickerBg: '#1B2631', pickerRadius: 16, pickerPadding: 20, pickerWidth: 350,
    gridGap: 8, gridMarginBottom: 16,
    btnW: 70, btnH: 60, btnRadius: 10, btnBg: '#37474F',
    labelColor: '#8BA3C7', labelGap: 4,
    clearBg: '#37474F', clearRadius: 10, clearPaddingV: 10, clearColor: '#F44336', clearSize: 14,
    sectionColor: '#5A6E87', sectionTracking: 1, sectionMarginTop: 12, sectionMarginBottom: 6
  };

  var LIBRARY = {
    // bottom sheet
    scrim: 'rgba(0,0,0,0.7)', sheetBg: '#1B2631', sheetRadius: 20, sheetPadding: 20,
    headerGap: 4, titleSize: 12, closeSize: 14,
    // form fields
    fieldGap: 8, fieldBg: '#37474F', fieldRadius: 10,
    fieldPaddingH: 14, fieldPaddingV: 12, fieldSize: 14,
    // result chips
    resultGap: 8, resultMarginBottom: 10, resultMarginTop: 2,
    resultPaddingV: 10, resultRadius: 10, resultSize: 13,
    resultIdle: '#8BA3C7', resultActiveBg: '#FDB022', resultActiveText: '#0F1A2E',
    // folder chips
    chipPaddingH: 14, chipPaddingV: 8, chipRadius: 16, chipGap: 8,
    chipSize: 13, chipIdle: '#90A4AE', chipActiveBg: '#FDB022', chipActiveText: '#0F1A2E',
    // footer buttons
    buttonGap: 10, buttonMarginTop: 12, buttonPaddingV: 14, buttonRadius: 12,
    buttonSize: 16, cancelBg: '#37474F', saveBg: '#4CAF50',
    // library rows
    cardBg: '#263040', cardRadius: 12, cardPadding: 14, cardGap: 8,
    primarySize: 14, primaryGap: 3, pgnSize: 12, pgnColor: '#6B7B8D',
    metaSize: 11, metaColor: '#5A6E87', metaGap: 4,
    actionSize: 34, actionRadius: 8, actionBg: '#1B2631'
  };
  /** The four result options, in the source's order (board.tsx:3941). */
  var RESULT_OPTIONS = ['*', '1-0', '0-1', '1/2-1/2'];
  /** `*` renders as this in the picker (board.tsx:4003-4022). */
  function resultLabel(r) { return r === '*' ? 'No Result (*)' : r; }

  // ---- Tables ----------------------------------------------------------------
  var CLASSIFICATIONS = {
    brilliant: { label: 'Brilliant', symbol: '!!', color: '#00BCD4' },
    great: { label: 'Great', symbol: '!', color: '#4CAF50' },
    book: { label: 'Book', symbol: 'B', color: '#9C27B0' },
    best: { label: 'Best', symbol: '★', color: '#66BB6A' },
    excellent: { label: 'Excellent', symbol: '✓', color: '#8BC34A' },
    good: { label: 'Good', symbol: '', color: '#AED581' },
    inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#FFC107' },
    mistake: { label: 'Mistake', symbol: '?', color: '#FF9800' },
    miss: { label: 'Miss', symbol: '↗', color: '#FF5722' },
    blunder: { label: 'Blunder', symbol: '??', color: '#F44336' }
  };
  // Ten tiers, `book` after `great`. The RN CLASSIFICATION_ORDER had only nine — it omitted `book`,
  // so book moves were counted and never displayed.
  var CLASSIFICATION_ORDER = ['brilliant', 'great', 'book', 'best', 'excellent', 'good',
                              'inaccuracy', 'mistake', 'miss', 'blunder'];

  var MOVE_ANNOTATIONS = [
    { symbol: '!!', label: 'Brilliant', color: '#00BCD4' },
    { symbol: '!', label: 'Good', color: '#4CAF50' },
    { symbol: '!?', label: 'Interesting', color: '#8BC34A' },
    { symbol: '?!', label: 'Dubious', color: '#FF9800' },
    { symbol: '?', label: 'Mistake', color: '#F44336' },
    { symbol: '??', label: 'Blunder', color: '#D32F2F' }
  ];

  // DEVIATION — the ⩲ / ⩱ correction. The RN source labels ⩱ "Slight advantage White" and ⩲
  // "Slight advantage Black". Standard chess notation is the exact opposite: ⩲ is White slightly
  // better, ⩱ is Black slightly better. Corrected here and in EVAL_SYMBOLS.
  var POSITION_ANNOTATIONS = [
    { symbol: '+-', label: 'White is winning', color: '#FFFFFF' },
    { symbol: '±', label: 'White is better', color: '#E0E0E0' },
    { symbol: '⩲', label: 'White is slightly better', color: '#B0BEC5' },
    { symbol: '=', label: 'Equal', color: '#8BA3C7' },
    { symbol: '⩱', label: 'Black is slightly better', color: '#B0BEC5' },
    { symbol: '∓', label: 'Black is better', color: '#E0E0E0' },
    { symbol: '-+', label: 'Black is winning', color: '#FFFFFF' }
  ];

  // Ranges are the RN source's; only the two slight-advantage SYMBOLS are swapped.
  var EVAL_SYMBOLS = [
    { symbol: '+-', minCp: 300, maxCp: 9999, color: '#4CAF50' },
    { symbol: '±', minCp: 150, maxCp: 300, color: '#4CAF50' },
    { symbol: '⩲', minCp: 50, maxCp: 150, color: '#4CAF50' },
    { symbol: '=', minCp: -50, maxCp: 50, color: '#8BA3C7' },
    { symbol: '⩱', minCp: -150, maxCp: -50, color: '#F44336' },
    { symbol: '∓', minCp: -300, maxCp: -150, color: '#F44336' },
    { symbol: '-+', minCp: -9999, maxCp: -300, color: '#F44336' }
  ];

  /** White-relative centipawns -> the notation symbol. Mate pins to the decisive symbols. */
  function evalSymbol(cp, mate) {
    if (mate !== null && mate !== undefined) return mate > 0 ? '+-' : '-+';
    if (cp === null || cp === undefined) return '=';
    for (var i = 0; i < EVAL_SYMBOLS.length; i++) {
      var e = EVAL_SYMBOLS[i];
      if (cp > e.minCp && cp <= e.maxCp) return e.symbol;
    }
    return cp > 0 ? '+-' : '-+';
  }

  var AUTOPLAY_SPEEDS = [
    { label: '0.5s', value: 500 }, { label: '1s', value: 1000 }, { label: '1.5s', value: 1500 },
    { label: '2s', value: 2000 }, { label: '3s', value: 3000 }
  ];
  var DEFAULT_AUTOPLAY_SPEED = 1500;

  // ---- Timings (spec 20; real values from board.tsx) -------------------------
  var TIMINGS = {
    analysisDebounce: 300,      // after a position change, before asking the engine
    draftAutosave: 800,         // debounced draft write
    evalBarAnimation: 400,
    doubleTapWindow: 350,       // edit mode: remove a piece
    longPressDelay: 400,        // move token / engine row
    draftTTLHours: 24,
    uiCoalesce: 100,            // INVENTED: max one engine-progress UI update per 100ms
    // INVENTED: wall-clock budget for one interactive search, enforced through the engine's
    // `shouldCancel`. A depth cap is the wrong control — measured cost is ~6x per ply and varies
    // 15x across position types (endgame d4 = 173ms, midgame d4 = 2794ms), so a fixed depth is
    // either too slow somewhere or too shallow everywhere. A deadline gives depth 4+ in quiet
    // positions and stops at 3 in sharp ones, and bounds total wall time to within ~15ms.
    // These two are now the BALANCED preset's numbers rather than the only numbers: the user picks
    // a preset in ☰ > Engine and `engine-settings.js` resolves it. They stay here as the defaults an
    // untouched install runs on, and `selfTest` asserts they still equal that preset, so the two
    // files cannot drift apart.
    engineDeadline: 1200,
    // INVENTED: wall-clock budget for ONE position of a game review. At 200ms a 40-move game takes
    // ~9s in Node and ~18s in the browser, which lands inside the original's own "This may take
    // 20-30 seconds" promise (board.tsx:3831) — with a real progress bar and a working Cancel.
    // Measured alternatives: 100ms is ~5s but mostly depth 1-2; 400ms is ~17s for depth 3.
    reviewDeadline: 200,
    // INVENTED: how long a piece takes to slide to its square. The RN board animates with a
    // Reanimated spring, which has no extractable duration, so there is nothing to port. 170ms with
    // an ease-out and NO overshoot is between lichess (~200) and chess.com (~150); the old value was
    // 330ms on a springy `cubic-bezier(.34,1.15,.64,1)`, which read as sluggish.
    pieceAnimation: 170,
    // INVENTED: the ceiling on ONE synchronous chunk of search when the engine cannot be put in a
    // Worker (i.e. opened from file://, where the opaque origin makes `new Worker` throw).
    //
    // This is the constant that fixes the reported "delay". The search used to run one whole depth
    // per uninterrupted block: measured on a midgame position, depth 3 = 624ms and depth 4 = 2885ms,
    // i.e. 37 and 173 dropped frames with nothing on screen able to move. Passing this as each
    // depth's own `shouldCancel` deadline cuts the block from the INSIDE — the search polls every
    // 2048 nodes — so no chunk can overrun. Measured with an 80ms slice: worst block 94ms, and the
    // search still reaches depth 2 in sharp midgames and depth 5 in quiet endgames.
    inlineSearchBudget: 80
  };
  /**
   * Default search limits for the live board — the Balanced preset, for an install where nobody has
   * opened ☰ > Engine. `maxDepth` is a ceiling; the deadline is what usually binds, and only a
   * nearly-empty board ever reaches the ceiling at all.
   *
   * The ceiling used to be 6, which the search hit in three of the six benchmark positions once it
   * grew a transposition table. A ceiling the engine reaches is a ceiling that is doing the
   * budgeting, which is exactly what the deadline is for.
   */
  var ENGINE_LIMITS = { maxDepth: 12, multiPV: 3 };

  // ---- The Engine Settings panel ---------------------------------------------
  // INVENTED, all of it: nothing in the RN source has this screen. Laid out like the Autoplay Speed
  // sheet it sits beside in the same ☰ section, so there is one bottom-sheet idiom, not two.
  var ENGINE_PANEL = {
    rowHeight: 52,          // one preset row: name on top, summary under it
    rowGap: 8,
    rowRadius: 10,
    rowPaddingH: 12,
    dotSize: 16,            // the selected-preset radio
    dotInset: 10,
    nameSize: 15,
    summarySize: 12,
    warningSize: 12,
    warningGap: 10,
    sectionGap: 14,
    advancedRowHeight: 44,  // one Advanced control: label left, value right, track under
    advancedLabelSize: 13,
    advancedValueSize: 13,
    // The height reserved for the slider row. Both platforms use the NATIVE range control, which
    // draws its own track — so there is no track height or radius here, because nothing would read
    // one. (There was, briefly; `board_layout_check.js` caught them as dead on the first run.)
    thumbSize: 18,
    segmentHeight: 30,      // the Lines picker, which is buttons rather than a track
    segmentGap: 6,
    segmentRadius: 8
  };

  // ---- Typography (the real StyleSheet sizes, not eyeballed) -------------------
  // Every one of these is asserted against board_styles.json in selfTestSource, which is the whole
  // reason to have them here rather than as literals in a view body or a stylesheet.
  var TYPE = {
    // 16, not 20: `sidebarStyles` also declares a `headerTitle` (20) and it is NOT this screen's.
    // Caught by selfTestSource, which pins every key to the `styles` block specifically.
    headerTitle: 16, headerBtn: 22,
    status: 12,
    toolBtn: 20, navBtn: 18,
    autoplayBar: 12,
    stripNum: 12, stripMove: 13, altChip: 12,
    // DEVIATION — the engine panel is drawn at the MOVE STRIP's size (13), not the source's
    // 9/10/8. The ported values are real and also unreadable on a real phone; the client asked for
    // "kasing laki ng chess notation". The SOURCE values are still asserted, inverted, in
    // selfTestSource, so the divergence stays visible and an accidental drift is still caught.
    engineEval: 13, engineSan: 13, enginePv: 13, engineText: 13,
    engineDepth: 11, engineOpening: 12,
    // The line-preview bar. Its plies read at the move strip's size because it IS a move strip —
    // for a line nobody has played yet. Its two action buttons take the branch-chip size.
    previewPly: 13, previewBtn: 12,
    // Phase 11 — the annotation picker and the sidebar's own scale.
    annotationPickerTitle: 16, annotationSymbol: 20, annotationLabel: 10, annotationSection: 11
  };

  // ---- Self-test --------------------------------------------------------------
  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }
    function expectNear(a, b, what, tol) { expect(near(a, b, tol), what + ': got ' + a + ', expected ' + b); }

    // 1. Board geometry snaps to a multiple of 8 physical pixels.
    expectNear(boardSize(390, 3), 389.3333333333333, 'boardSize at 390@3x', 1e-9);
    expectNear(squareSize(390, 3), 48.666666666666664, 'squareSize at 390@3x', 1e-9);
    expect(Number.isInteger(Math.round(boardSize(390, 3) * 3)) &&
           (Math.round(boardSize(390, 3) * 3)) % 8 === 0, 'physical board width is a multiple of 8');
    // 375@2x is 750 physical px; 750 does not divide by 8, so it snaps DOWN to 744 -> 372pt. The
    // board being a few points narrower than the screen is exactly what the rule buys.
    expectNear(boardSize(375, 2), 372, 'boardSize at 375@2x snaps down', 1e-9);
    expect(boardSize(375, 2) < 375, 'snapping makes the board narrower, never wider');
    expect(boardSize(390, 3) <= 390, 'the board never exceeds the screen width');
    expectNear(pieceSize(48), 45.6, 'piece is 95% of a square', 1e-9);

    // 2. Coordinates and the flip.
    var s = 40;
    expectNear(squareCenter(0, s, false).x, 20, 'a1 x unflipped');
    expectNear(squareCenter(0, s, false).y, 300, 'a1 y unflipped (bottom-left)');
    expectNear(squareCenter(0, s, true).x, 300, 'a1 x flipped');
    expectNear(squareCenter(0, s, true).y, 20, 'a1 y flipped');
    expectNear(squareCenter(63, s, false).x, 300, 'h8 x unflipped');
    expectNear(squareCenter(63, s, false).y, 20, 'h8 y unflipped (top-right)');
    expect(isLightSquare(0) === false, 'a1 is dark');
    expect(isLightSquare(63) === false, 'h8 is dark');
    expect(isLightSquare(7) === true, 'h1 is light');

    // 3. Square fill precedence — selected beats custom beats last-move beats the theme.
    var lm = { from: 12, to: 28 };
    expect(squareFill(12, { selected: 12, lastMove: lm }) === HIGHLIGHT.selected, 'selected wins');
    expect(squareFill(12, { dragOrigin: 12, lastMove: lm }) === HIGHLIGHT.selected, 'drag origin counts as selected');
    expect(squareFill(28, { custom: { 28: '#123456' }, lastMove: lm }) === '#123456', 'custom beats last move');
    expect(squareFill(28, { lastMove: lm }) === HIGHLIGHT.lastMove, 'last move beats the theme');
    expect(squareFill(0, {}) === BOARD_THEMES.classic.dark, 'a1 falls through to the dark theme colour');
    expect(squareFill(7, { theme: 'green' }) === BOARD_THEMES.green.light, 'the theme is honoured');

    // 4. Indicators.
    expectNear(dotSize(40), 12, 'dot is 30% of a square');
    expectNear(ringSize(40), 34, 'ring is 85% of a square');
    expectNear(ringStrokeWidth(40), 3.2, 'ring stroke is 8% of a square');

    // 5. Arrows. The shaft stops short of the tip so it does not pierce the head.
    var g = arrowGeometry(0, 56, 40, false);   // a1 -> a8, straight up
    expectNear(g.start.x, 20, 'arrow starts at the origin centre');
    expectNear(g.start.y, 300, 'arrow start y');
    expectNear(g.tip.x, 20, 'arrow tip x');
    expectNear(g.tip.y, 20, 'arrow tip y');
    expect(g.end.y > g.tip.y, 'the shaft stops short of the tip');
    // a1 -> a8 travels UP the screen, so the shortened end sits below the tip. Compare distance.
    expectNear(Math.abs(g.end.y - g.tip.y), 40 * 0.35 * 0.7, 'shortening is head * 0.7');
    expectNear(g.strokeWidth, 7.2, 'arrow stroke is 18% of a square');
    expectNear(g.headSize, 14, 'arrow head is 35% of a square');
    var halfW = Math.abs(g.left.x - g.right.x) / 2;
    expectNear(halfW, 14 * 0.6, 'head half-width is head * 0.6');
    expect(arrowColor(0) === ARROW_COLORS[0] && arrowColor(2) === ARROW_COLORS[2], 'arrow colours by rank');
    expect(arrowColor(9) === ARROW_COLORS[2], 'a rank past the end clamps to the last colour');
    // A knight move is drawn as a straight diagonal, not an L.
    var kn = arrowGeometry(0, 17, 40, false);
    expect(kn.start.x !== kn.tip.x && kn.start.y !== kn.tip.y, 'a knight arrow is a straight line');

    // 6. Badge.
    var b = badgeGeometry(0, 40, false, 1);
    expectNear(b.radius, 8.4, 'badge radius is 21% of a square');
    expectNear(b.center.x, 20 + 40 * 0.29, 'badge sits right of the square centre');
    expectNear(b.center.y, 300 + 40 * 0.29, 'badge sits BELOW the square centre (bottom-right)');
    expectNear(b.ringRadius, 8.4 + 1.5, 'the white ring is radius + 1.5');
    expectNear(b.shadowCenter.x - b.center.x, 1.5, 'the shadow is offset 1.5');
    expectNear(b.fontSize, 8.4 * 1.1, 'a one-character symbol uses r * 1.1');
    expectNear(badgeGeometry(0, 40, false, 2).fontSize, 8.4 * 0.88, 'a two-character symbol uses r * 0.88');
    expectNear(b.textBaseline - b.center.y, b.fontSize * 0.37, 'the glyph baseline drops fontSize * 0.37');

    // 7. Eval bar.
    expectNear(evalBarFraction(0, null), 0.5, 'an equal position is half');
    expectNear(evalBarFraction(500, null), 1.0, 'clamped at +500');
    expectNear(evalBarFraction(-500, null), 0.0, 'clamped at -500');
    expectNear(evalBarFraction(5000, null), 1.0, 'beyond the clamp stays clamped');
    expectNear(evalBarFraction(null, 3), 0.95, 'mate for White pins to 0.95');
    expectNear(evalBarFraction(null, -3), 0.05, 'mate for Black pins to 0.05');
    expectNear(evalBarFraction(null, null), 0.5, 'no eval is half');
    expect(EVAL_BAR.mainHeight === 8 && EVAL_BAR.microHeight === 3,
      'the MAIN eval bar is 8 and only the per-line micro bar is 3');

    // 8. Eval graph: y is flipped so +500 is at the top.
    var top = graphPoint(500, null, 0, 2, 100, 52);
    var bot = graphPoint(-500, null, 1, 2, 100, 52);
    var mid = graphPoint(0, null, 0, 2, 100, 52);
    expectNear(top.y, 0, '+500 is at the top');
    expectNear(bot.y, 52, '-500 is at the bottom');
    expectNear(mid.y, 26, 'equal is the midline');
    expectNear(bot.x, 100, 'the last point is at the right edge');
    expectNear(graphPoint(0, 5, 0, 2, 100, 52).y, 0, 'mate saturates the graph');
    expectNear(graphPoint(0, null, 0, 1, 100, 52).x, 0, 'a single point sits at x=0 without dividing by zero');

    // 9. Tables.
    expect(CLASSIFICATION_ORDER.length === 10, 'ten classification tiers');
    expect(CLASSIFICATION_ORDER[2] === 'book', 'book sits after great');
    CLASSIFICATION_ORDER.forEach(function (k) {
      expect(!!CLASSIFICATIONS[k], 'classification "' + k + '" has a row');
    });
    expect(CLASSIFICATIONS.good.symbol === '', 'good has no badge symbol');
    expect(MOVE_ANNOTATIONS.length === 6, 'six move-quality annotations');
    expect(POSITION_ANNOTATIONS.length === 7, 'seven position annotations');
    // The correction, asserted explicitly in both directions.
    var slightWhite = POSITION_ANNOTATIONS.filter(function (a) { return a.symbol === '⩲'; })[0];
    var slightBlack = POSITION_ANNOTATIONS.filter(function (a) { return a.symbol === '⩱'; })[0];
    expect(/White/.test(slightWhite.label), '⩲ means WHITE is slightly better (RN had this backwards)');
    expect(/Black/.test(slightBlack.label), '⩱ means BLACK is slightly better (RN had this backwards)');
    expect(evalSymbol(100, null) === '⩲', '+100cp is ⩲');
    expect(evalSymbol(-100, null) === '⩱', '-100cp is ⩱');
    expect(evalSymbol(0, null) === '=', 'level is =');
    expect(evalSymbol(200, null) === '±', '+200cp is ±');
    expect(evalSymbol(-200, null) === '∓', '-200cp is ∓');
    expect(evalSymbol(400, null) === '+-', '+400cp is +-');
    expect(evalSymbol(-400, null) === '-+', '-400cp is -+');
    expect(evalSymbol(null, 2) === '+-', 'mate for White is +-');
    expect(evalSymbol(null, -2) === '-+', 'mate for Black is -+');
    expect(evalSymbol(50, null) === '=', '+50cp is still equal (boundary is exclusive below)');
    expect(evalSymbol(51, null) === '⩲', '+51cp tips to ⩲');
    expect(AUTOPLAY_SPEEDS.length === 5 && AUTOPLAY_SPEEDS[2].value === DEFAULT_AUTOPLAY_SPEED,
      'five autoplay speeds, 1.5s default');

    // 10. Bands fit on the smallest supported screen.
    [[375, 667], [390, 844], [430, 932]].forEach(function (d) {
      var l = bandLayout(d[1], boardSize(d[0], 3));
      expect(l.fits, 'bands fit at ' + d[0] + 'x' + d[1] + ' (total ' + l.total.toFixed(1) + ')');
      expect(l.board > 0, 'the board band is non-zero at ' + d[0] + 'x' + d[1]);
      expect(l.panels <= BANDS.panelsMaxHeight, 'the panels band never exceeds its max at ' + d[0]);
    });

    // 10b. THE BOARD IS A FUNCTION OF WIDTH ALONE.
    //
    // This is the regression test for a real, reported bug: the browser sized the board with
    // `min(100cqw, calc(100cqh - …))` inside a `flex: 1 1 auto` band, so its WIDTH tracked the
    // leftover HEIGHT. The ECO panel and the engine panel both change height on every move (rows
    // appear and vanish), so the board grew and shrank as you played — and, height being the
    // binding constraint, it never filled the screen either. One cause, both symptoms.
    //
    // The invariant that makes it impossible: for a given width, the board edge does not depend on
    // the viewport height at all.
    [375, 390, 430].forEach(function (w) {
      var edge = boardSize(w, 3);
      [500, 667, 844, 932, 1200].forEach(function (h) {
        expect(boardSize(w, 3) === edge, 'boardSize(' + w + ') ignores a ' + h + 'px viewport');
      });
      // And on any phone tall enough, bandLayout hands back that full edge — the board is capped
      // only by a genuinely short screen, never by what the panels below happen to contain.
      expect(bandLayout(844, edge).board === edge, 'the board is not height-capped at ' + w + 'x844');
      expect(bandLayout(932, edge).board === edge, 'nor at ' + w + 'x932');
    });
    // The one screen where it IS capped, and it must still be usable.
    var se = bandLayout(667, boardSize(375, 3));
    expect(se.board > 0 && se.board <= boardSize(375, 3), 'a 375x667 SE caps the board but keeps it');
    expect(se.panels < BANDS.panelsMaxHeight, 'and the PANELS band is what gave way, not the board');
    // The board fills the width it is given, to within one snapped pixel step.
    [375, 390, 430].forEach(function (w) {
      expect(w - boardSize(w, 3) < 8 / 3 + 1e-9, 'the board is edge-to-edge at ' + w + ' (snap only)');
    });

    // 10c. The book strip costs height only when there IS a book.
    var inBook = bandLayout(667, boardSize(375, 3), true);
    var outOfBook = bandLayout(667, boardSize(375, 3), false);
    expect(outOfBook.fixed === inBook.fixed - BANDS.bookStripHeight,
      'out of book the strip costs nothing at all — it is not built, not emptied');
    expect(outOfBook.board >= inBook.board,
      'and the height it gives back goes to the board first on a short screen');
    expect(BANDS.bookStripHeight * 4 < BANDS.panelsMaxHeight,
      'the strip is a fraction of the 230pt panel it replaced (' + BANDS.bookStripHeight + ')');

    // 10d. How much engine panel actually fits, per phone.
    //
    // The panel is the flexible band, so it can never overflow — the rows box CLIPS, and rows that
    // do not fit are simply not drawn (`.an-rows`, and `rowsBox` in the Swift). These pin how many
    // survive, which differs by device: a 375x667 SE spends 56% of its height on the board alone,
    // so it gets fewer rows than a Pro Max. That is a fact about the screen, not something to
    // assert away. Mirrors AnalysisMetricsCheck.swift §10d.
    function engineRowsThatFit(available, lines) {
      var lineH = TYPE.enginePv * 1.35;
      var chrome = EVAL_BAR.microHeight + EVAL_BAR.microMarginBottom
        + TYPE.engineDepth * 1.35 + BANDS.chipPaddingV * 2
        + BANDS.enginePaddingTop + BANDS.enginePaddingBottom;
      var perRow = lines * lineH + BANDS.rowGap;
      if (perRow <= 0) return 0;
      return Math.max(0, Math.floor((available - chrome) / perRow));
    }
    [[375, 667, 3, 1], [390, 844, 5, 3], [430, 932, 5, 5]].forEach(function (d) {
      var edge = boardSize(d[0], 3);
      var fixedNoEngine = BANDS.headerBtnH + BANDS.statusMinHeight + BANDS.stripMaxHeight
        + BANDS.bookStripHeight;
      var available = d[1] - fixedNoEngine - edge;
      expect(available > 0, 'there is room for an engine panel at ' + d[0] + 'x' + d[1]);
      expect(engineRowsThatFit(available, 1) >= d[2],
        'at ' + d[0] + 'x' + d[1] + ', in book, at least ' + d[2] + ' single-line engine rows fit '
        + '(got ' + engineRowsThatFit(available, 1) + ')');
      expect(engineRowsThatFit(available, BANDS.engineLineLimit) >= d[3],
        'and at least ' + d[3] + ' WRAPPED rows (got '
        + engineRowsThatFit(available, BANDS.engineLineLimit) + ')');
    });
    var seEdge = boardSize(375, 3);
    var seFixedNoEngine = BANDS.headerBtnH + BANDS.statusMinHeight + BANDS.stripMaxHeight
      + BANDS.bookStripHeight;
    expect(engineRowsThatFit(667 - seFixedNoEngine - seEdge, 1) >= ENGINE_LIMITS.multiPV,
      'even a 375x667 SE shows every line the DEFAULT preset produces');
    expect(engineRowsThatFit(667 - seFixedNoEngine - seEdge + BANDS.bookStripHeight, 1)
      > engineRowsThatFit(667 - seFixedNoEngine - seEdge, 1),
      'dropping the book strip buys the SE at least one more engine row');
    expect(BANDS.engineMaxRows >= ENGINE_LIMITS.multiPV,
      'and the row cap never hides a line the default preset produced');

    // 11. Timings.
    expect(TIMINGS.analysisDebounce === 300, 'analysis debounce is 300ms');
    expect(TIMINGS.draftAutosave === 800, 'draft autosave is 800ms');
    expect(TIMINGS.doubleTapWindow === 350, 'double-tap window is 350ms');
    expect(TIMINGS.draftTTLHours === 24, 'drafts expire after 24 hours');
    expect(TIMINGS.pieceAnimation === 170, 'a piece slides in 170ms');
    expect(TIMINGS.pieceAnimation < TIMINGS.analysisDebounce,
      'and lands before the engine is even scheduled, so a search can never start mid-slide');
    expect(TIMINGS.inlineSearchBudget === 80, 'one in-thread search chunk is capped at 80ms');
    expect(TIMINGS.inlineSearchBudget * 2 < TIMINGS.engineDeadline,
      'the per-chunk slice is well under the whole-search deadline, or slicing would do nothing');
    expect(TIMINGS.longPressDelay === 400, 'long-press delay is 400ms');
    expect(TIMINGS.uiCoalesce === 100, 'engine progress coalesces to 100ms');
    expect(TIMINGS.engineDeadline === 1200, 'one interactive search gets 1200ms by default');
    expect(TIMINGS.reviewDeadline === 200, 'one reviewed position gets 200ms by default');

    // 12. The review modal's two pure functions
    expect(accuracyColor(100) === '#4CAF50', 'a perfect game is green');
    expect(accuracyColor(80) === '#4CAF50', '80 is the green boundary (inclusive)');
    expect(accuracyColor(79.9) === '#FFC107', 'just under 80 is amber');
    expect(accuracyColor(60) === '#FFC107', '60 is the amber boundary');
    expect(accuracyColor(59.9) === '#FF9800', 'just under 60 is orange');
    expect(accuracyColor(40) === '#FF9800', '40 is the orange boundary');
    expect(accuracyColor(39.9) === '#F44336', 'below 40 is red');
    expect(accuracyColor(0) === '#F44336', 'zero is red');
    expectNear(cardMaxHeight(844), 675.2, 'the card is 80% of an 844pt screen');
    expectNear(cardMaxHeight(667), 533.6, 'and 80% of a 667pt one — the reason it is a ratio');
    expect(accuracyText(89.9) === '89.9%', 'accuracy renders with one decimal');
    expect(accuracyText(100) === '100.0%', 'including a whole number');
    expect(classificationText('book') === 'Book B', 'a tier shows label + symbol');
    expect(classificationText('good') === 'Good', 'but `good` has no symbol, so no trailing space');
    expect(classificationText('blunder') === 'Blunder ??', 'two-character symbols work too');
    expect(RESULT_OPTIONS.join(' ') === '* 1-0 0-1 1/2-1/2', 'the four result options, in order');
    expect(resultLabel('*') === 'No Result (*)', 'the star renders as "No Result (*)"');
    expect(resultLabel('1-0') === '1-0', 'the others render as themselves');
    expect(ENGINE_LIMITS.multiPV === 3, 'the board shows three engine lines by default');
    expect(ENGINE_LIMITS.maxDepth === 12, 'depth 12 is the default ceiling the deadline rarely reaches');

    // 11b. The defaults above ARE the Balanced preset. Two files carrying the same four numbers is
    // exactly how they drift, so the agreement is asserted rather than assumed. Resolved lazily:
    // engine-settings.js loads after this file in the browser, and neither needs the other at load.
    var ES = (typeof module !== 'undefined' && module.exports)
      ? require('./engine-settings.js')
      : (typeof BiyaEngineSettings !== 'undefined' ? BiyaEngineSettings : null);
    if (ES) {
      var balanced = ES.resolve(ES.defaults());
      expect(balanced.thinkMs === TIMINGS.engineDeadline,
        'the default deadline is the Balanced preset\'s think time');
      expect(balanced.reviewMs === TIMINGS.reviewDeadline,
        'the default review budget is the Balanced preset\'s');
      expect(balanced.maxDepth === ENGINE_LIMITS.maxDepth,
        'the default ceiling is the Balanced preset\'s');
      expect(balanced.multiPV === ENGINE_LIMITS.multiPV,
        'the default line count is the Balanced preset\'s');
      expect(TIMINGS.inlineSearchBudget * 2 < ES.preset('saver').thinkMs,
        'even the coolest preset leaves room for more than one in-thread slice');
    } else {
      failures.push('engine-settings.js was not loaded, so the defaults could not be cross-checked');
    }

    // 11c. The Engine Settings panel.
    expect(ENGINE_PANEL.rowHeight > ENGINE_PANEL.advancedRowHeight,
      'a preset row is taller than an Advanced row — it carries two lines of text');
    expect(ENGINE_PANEL.nameSize > ENGINE_PANEL.summarySize, 'the preset name outranks its summary');
    expect(ENGINE_PANEL.thumbSize <= ENGINE_PANEL.advancedRowHeight,
      'the slider fits inside the row that holds it');
    expect(ENGINE_PANEL.dotSize < ENGINE_PANEL.rowHeight, 'the radio dot fits inside its row');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisMetricsSelfTest: ' + passed + ' assertions passed'
        : 'AnalysisMetricsSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  /**
   * Assert the encoded constants against the values extracted from the real RN source. This is what
   * makes the metrics layer oracle-tested: a mistyped padding fails here rather than shipping.
   * Node-only — `board_styles.json` is a build product of the sibling repo.
   */
  function selfTestSource(src) {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    var S = src.stylesheets.styles;

    /**
     * A value we DELIBERATELY do not take from the source. Both halves are asserted: the source
     * still holds what it always held (so an extraction change is still caught), and ours differs
     * in the intended direction. Same shape as the ⩲/⩱ correction below — a deviation is declared,
     * never smuggled by deleting the assertion.
     */
    function deviates(styleKey, prop, mine, source, why) {
      var real = S[styleKey] ? S[styleKey][prop] : undefined;
      expect(real === source, styleKey + '.' + prop + ': the RN source should still be ' + source
        + ', got ' + real + ' — if the source really changed, revisit the deviation');
      expect(mine > real, styleKey + '.' + prop + ': ' + why + ' (' + mine + ' > ' + real + ')');
    }

    function same(styleKey, prop, mine, label) {
      var real = S[styleKey] ? S[styleKey][prop] : undefined;
      expect(real === mine, (label || styleKey + '.' + prop) + ': encoded ' + mine + ' != source ' + real);
    }

    // Palette
    same('container', 'backgroundColor', PALETTE.screenBg, 'screen background');
    same('header', 'backgroundColor', PALETTE.surface, 'surface');
    same('header', 'borderBottomColor', PALETTE.divider, 'divider');
    same('toolBtn', 'backgroundColor', undefined, 'toolBtn has no fill of its own');

    // Bands
    same('header', 'paddingHorizontal', BANDS.headerPaddingH);
    same('header', 'paddingVertical', BANDS.headerPaddingV);
    same('headerBtn', 'width', BANDS.headerBtnW);
    same('headerBtn', 'height', BANDS.headerBtnH);
    same('boardSection', 'paddingTop', BANDS.boardPaddingTop);
    same('statusToolbarRow', 'minHeight', BANDS.statusMinHeight);
    // The status line's own row uses the source's own (dead) `statusLine` block, not invented values.
    same('statusLine', 'minHeight', BANDS.statusLineMinHeight);
    same('statusLine', 'paddingHorizontal', BANDS.statusLinePaddingH);
    same('statusLine', 'paddingVertical', BANDS.statusLinePaddingV);
    expect(S.statusLine.minHeight !== S.statusToolbarRow.minHeight,
      'the standalone status row and the combined row really are different heights in the source');
    same('statusToolbarRow', 'paddingLeft', BANDS.statusPaddingLeft);
    same('toolBtn', 'paddingHorizontal', BANDS.toolBtnPaddingH);
    same('toolBtn', 'paddingVertical', BANDS.toolBtnPaddingV);
    same('toolBtn', 'borderRadius', BANDS.toolBtnRadius);
    same('toolBtn', 'minWidth', BANDS.toolBtnMinWidth);
    same('navBtn', 'paddingHorizontal', BANDS.navBtnPaddingH);
    same('navBtn', 'minWidth', BANDS.navBtnMinWidth);

    // Typography — every size against the real StyleSheet
    same('headerTitle', 'fontSize', TYPE.headerTitle);
    same('headerBtnText', 'fontSize', TYPE.headerBtn);
    same('statusText', 'fontSize', TYPE.status);
    same('toolBtnText', 'fontSize', TYPE.toolBtn);
    same('navBtnText', 'fontSize', TYPE.navBtn);
    same('autoplayBarText', 'fontSize', TYPE.autoplayBar);
    same('movesStripNum', 'fontSize', TYPE.stripNum);
    same('movesStripMove', 'fontSize', TYPE.stripMove);
    same('altChipText', 'fontSize', TYPE.altChip);
    // DEVIATION — the engine panel is drawn at the move strip's size. The ported 9/10/8 are real
    // and also unreadable on a real phone; see PORTING_NOTES.md.
    var BIGGER = 'deliberately drawn larger than the source, to match the move strip';
    deviates('engineChipEval', 'fontSize', TYPE.engineEval, 9, BIGGER);
    deviates('engineChipSan', 'fontSize', TYPE.engineSan, 10, BIGGER);
    deviates('engineLinePv', 'fontSize', TYPE.enginePv, 9, BIGGER);
    deviates('engineLineText', 'fontSize', TYPE.engineText, 9, BIGGER);
    deviates('engineDepthChip', 'fontSize', TYPE.engineDepth, 8, BIGGER);
    deviates('engineOpeningChip', 'fontSize', TYPE.engineOpening, 9, BIGGER);
    // …and the direction is not merely "bigger", it is exactly the notation's size, which is the
    // thing that was actually asked for. Derived in Swift, asserted here.
    ['engineEval', 'engineSan', 'enginePv', 'engineText'].forEach(function (k) {
      expect(TYPE[k] === TYPE.stripMove,
        'TYPE.' + k + ' matches the move strip (' + TYPE[k] + ' vs ' + TYPE.stripMove + ')');
    });
    expect(TYPE.engineOpening === TYPE.altChip, 'the opening name matches the branch chips');
    expect(TYPE.engineDepth < TYPE.enginePv, 'the depth chip stays quieter than the moves');

    // Token, chip and engine-row geometry — also real StyleSheet values, not invented ones
    same('movesStripMove', 'paddingHorizontal', BANDS.tokenPaddingH);
    same('movesStripMove', 'paddingVertical', BANDS.tokenPaddingV);
    same('movesStripMove', 'borderRadius', BANDS.tokenRadius);
    same('altChip', 'paddingHorizontal', BANDS.chipPaddingH);
    same('altChip', 'paddingVertical', BANDS.chipPaddingV);
    deviates('engineChipEval', 'width', BANDS.engineEvalWidth, 36,
             'widened with the type, or a mate score clips');
    same('engineLineRow', 'gap', BANDS.engineRowGap);
    same('engineLineRow', 'paddingVertical', BANDS.engineRowPaddingV);
    same('engineLineRow', 'paddingHorizontal', BANDS.engineRowPaddingH);

    // ---- The accuracy modal, against its own StyleSheet block --------------------
    var A = src.stylesheets.accModalStyles;
    function acc(styleKey, prop, mine, label) {
      var real = A[styleKey] ? A[styleKey][prop] : undefined;
      expect(real === mine,
        (label || 'accModalStyles.' + styleKey + '.' + prop) + ': encoded ' + mine + ' != source ' + real);
    }
    acc('overlay', 'backgroundColor', REVIEW.scrim);
    acc('overlay', 'paddingHorizontal', REVIEW.overlayPaddingH);
    acc('overlay', 'paddingVertical', REVIEW.overlayPaddingV);
    acc('card', 'backgroundColor', PALETTE.reviewCard, 'the card reuses the reviewCard palette entry');
    acc('card', 'borderRadius', REVIEW.cardRadius);
    acc('card', 'borderWidth', REVIEW.cardBorder);
    acc('card', 'borderColor', REVIEW.cardBorderColor);
    acc('header', 'paddingTop', REVIEW.headerPaddingTop);
    acc('header', 'paddingBottom', REVIEW.headerPaddingBottom);
    acc('header', 'paddingHorizontal', REVIEW.headerPaddingH);
    acc('header', 'borderBottomColor', REVIEW.hairlineColor);
    acc('title', 'fontSize', REVIEW.titleSize);
    acc('title', 'letterSpacing', REVIEW.titleTracking);
    acc('loadingBody', 'paddingVertical', REVIEW.loadingPaddingV);
    acc('loadingBody', 'paddingHorizontal', REVIEW.loadingPaddingH);
    acc('loadingText', 'fontSize', REVIEW.loadingTextSize);
    acc('loadingText', 'color', REVIEW.loadingTextColor);
    acc('loadingText', 'marginBottom', REVIEW.loadingGap);
    acc('loadingHint', 'fontSize', REVIEW.hintSize);
    acc('loadingHint', 'color', REVIEW.hintColor);
    acc('skipBtn', 'marginTop', REVIEW.skipMarginTop);
    acc('skipBtn', 'paddingVertical', REVIEW.skipPaddingV);
    acc('skipBtn', 'paddingHorizontal', REVIEW.skipPaddingH);
    acc('skipBtn', 'borderRadius', REVIEW.skipRadius);
    acc('skipBtn', 'borderColor', REVIEW.skipBorderColor);
    acc('skipBtnText', 'fontSize', REVIEW.skipTextSize);
    acc('skipBtnText', 'color', REVIEW.skipTextColor);
    acc('scrollContent', 'paddingHorizontal', REVIEW.contentPaddingH);
    acc('scrollContent', 'paddingTop', REVIEW.contentPaddingTop);
    acc('scrollContent', 'paddingBottom', REVIEW.contentPaddingBottom);
    acc('scoresRow', 'marginBottom', REVIEW.sectionGap);
    acc('playerName', 'fontSize', REVIEW.playerNameSize);
    acc('playerName', 'color', REVIEW.playerNameColor);
    acc('playerName', 'marginBottom', REVIEW.playerNameGap);
    acc('scoreValue', 'fontSize', REVIEW.scoreSize);
    acc('scoreValue', 'lineHeight', REVIEW.scoreLineHeight);
    acc('scoreLabel', 'fontSize', REVIEW.scoreLabelSize);
    acc('scoreLabel', 'color', REVIEW.scoreLabelColor);
    acc('scoreLabel', 'letterSpacing', REVIEW.scoreLabelTracking);
    acc('scoresDivider', 'height', REVIEW.dividerHeight);
    acc('scoresDivider', 'backgroundColor', REVIEW.dividerColor);
    acc('scoresDivider', 'marginHorizontal', REVIEW.dividerMarginH);
    acc('graphWrap', 'borderRadius', GRAPH_STYLE.wrapRadius);
    acc('graphWrap', 'backgroundColor', GRAPH_STYLE.wrapBackground);
    acc('graphWrap', 'marginBottom', REVIEW.sectionGap);
    acc('classTableHeader', 'paddingBottom', REVIEW.tableHeaderPaddingBottom);
    acc('classTableSide', 'width', REVIEW.sideColumnWidth);
    acc('classTableSide', 'fontSize', REVIEW.sideLabelSize);
    acc('classTableSide', 'color', REVIEW.sideLabelColor);
    acc('classRow', 'paddingVertical', REVIEW.rowPaddingV);
    acc('classRow', 'borderBottomColor', REVIEW.rowRuleColor);
    acc('classCount', 'width', REVIEW.sideColumnWidth);
    acc('classCount', 'fontSize', REVIEW.countSize);
    acc('classCenter', 'gap', REVIEW.centreGap);
    acc('classDot', 'width', REVIEW.dotSize);
    acc('classDot', 'borderRadius', REVIEW.dotRadius);
    acc('className', 'fontSize', REVIEW.nameSize);
    acc('className', 'color', REVIEW.nameColor);
    acc('footer', 'padding', REVIEW.footerPadding);
    acc('loadBtn', 'backgroundColor', PALETTE.gold, 'the primary button is gold');
    acc('loadBtn', 'borderRadius', REVIEW.buttonRadius);
    acc('loadBtn', 'paddingVertical', REVIEW.buttonPaddingV);
    acc('loadBtnText', 'fontSize', REVIEW.buttonTextSize);
    acc('loadBtnText', 'color', PALETTE.onGold);

    // The one value that must NOT be copied literally: the source folds `screenHeight * 0.80`
    // against its reference device, so the JSON holds 675.2. Assert the RATIO reproduces it.
    var refH = src.geometry.referenceDevice.height;
    expect(Math.abs(cardMaxHeight(refH) - A.card.maxHeight) < 1e-9,
      'card.maxHeight: ratio ' + REVIEW.cardMaxHeightRatio + ' x ' + refH + ' = '
      + cardMaxHeight(refH) + ', source ' + A.card.maxHeight);
    expect(src._deviceDerived.values['accModalStyles.card.maxHeight'] !== undefined,
      'the extractor flags card.maxHeight as device-derived');

    // ---- The eval graph, against EvalGraph.tsx -----------------------------------
    // These live in JSX attributes, not a StyleSheet, so the extractor scans for them separately.
    // Without this the graph's own #1A2740 background is unassertable — and it is precisely the
    // value that is easy to conflate with the wrapper's #0F1A2E.
    var G = src.evalGraph;
    function gr(prop, mine) {
      expect(G[prop] === mine, 'evalGraph.' + prop + ': encoded ' + mine + ' != source ' + G[prop]);
    }
    gr('background', GRAPH_STYLE.background);
    gr('backgroundRadius', GRAPH_STYLE.backgroundRadius);
    gr('whiteFill', GRAPH_STYLE.whiteFill);
    gr('blackFill', GRAPH_STYLE.blackFill);
    gr('midLine', GRAPH_STYLE.midLine);
    gr('midLineWidth', GRAPH_STYLE.midLineWidth);
    gr('curve', GRAPH_STYLE.curve);
    gr('curveWidth', GRAPH.lineWidth);
    gr('clamp', GRAPH.clamp);
    expect(G.background !== GRAPH_STYLE.wrapBackground,
      'the graph background and its wrapper are genuinely different colours');

    // ---- The ☰ sidebar, Setup Position, and the remaining modals -----------------
    var SB = src.stylesheets.sidebarStyles;
    function sb(styleKey, prop, mine, label) {
      var real = SB[styleKey] ? SB[styleKey][prop] : undefined;
      expect(real === mine, (label || 'sidebarStyles.' + styleKey + '.' + prop)
        + ': encoded ' + mine + ' != source ' + real);
    }
    sb('overlay', 'backgroundColor', MENU.scrim);
    sb('container', 'backgroundColor', MENU.bg);
    sb('container', 'borderRightColor', MENU.borderColor);
    sb('container', 'borderRightWidth', MENU.borderWidth);
    sb('header', 'paddingHorizontal', MENU.headerPaddingH);
    sb('header', 'paddingTop', MENU.headerPaddingTop);
    sb('header', 'paddingBottom', MENU.headerPaddingBottom);
    sb('headerTitle', 'fontSize', MENU.titleSize);
    sb('headerTitle', 'color', MENU.titleColor);
    sb('headerTitle', 'letterSpacing', MENU.titleTracking);
    sb('closeBtn', 'width', MENU.closeSize);
    sb('closeBtn', 'borderRadius', MENU.closeRadius);
    sb('closeBtn', 'backgroundColor', MENU.closeBg);
    sb('closeBtnText', 'fontSize', MENU.closeGlyphSize);
    sb('sectionTitle', 'fontSize', MENU.sectionSize);
    sb('sectionTitle', 'color', MENU.sectionColor);
    sb('sectionTitle', 'letterSpacing', MENU.sectionTracking);
    sb('sectionTitle', 'paddingTop', MENU.sectionPaddingTop);
    sb('sectionTitle', 'paddingBottom', MENU.sectionPaddingBottom);
    sb('menuItem', 'paddingVertical', MENU.itemPaddingV);
    sb('menuItem', 'paddingHorizontal', MENU.itemPaddingH);
    sb('menuIcon', 'fontSize', MENU.iconSize);
    sb('menuIcon', 'width', MENU.iconWidth);
    sb('menuLabel', 'fontSize', MENU.labelSize);
    sb('menuLabel', 'color', MENU.labelColor);
    sb('toggleDot', 'width', MENU.dotSize);
    sb('toggleDot', 'borderRadius', MENU.dotRadius);
    sb('toggleDot', 'backgroundColor', MENU.dotIdle);
    sb('toggleDotActive', 'backgroundColor', MENU.dotActive);
    // The width is device-derived: encode the RATIO and reproduce the source's literal from it.
    var sbDerived = src._deviceDerived.values['sidebarStyles.container.width'];
    expect(sbDerived !== undefined && sbDerived.widthRatio === MENU.widthRatio,
      'the sidebar width is W * ' + MENU.widthRatio + ', not a literal');
    expect(Math.abs(menuWidth(src.geometry.referenceDevice.width) - SB.container.width) < 1e-9,
      'and the ratio reproduces the source value on the reference device');
    // The trap: styles.menuContainer is a DEAD menu at a DIFFERENT ratio. Never encode that one.
    expect(src.stylesheets.styles.menuContainer.width !== SB.container.width,
      'the dead styles.menuContainer really is a different width from the live sidebar');

    // Setup Position
    same('editPanelCompact', 'backgroundColor', EDIT.panelBg);
    same('editPanelCompact', 'borderRadius', EDIT.panelRadius);
    same('editPanelCompact', 'padding', EDIT.panelPadding);
    same('editPanelTitle', 'fontSize', EDIT.titleSize);
    same('editPanelTitle', 'color', EDIT.titleColor);
    same('editPanelHint', 'fontSize', EDIT.hintSize);
    same('editPanelHint', 'color', EDIT.hintColor);
    same('editPanelTitleRow', 'marginBottom', EDIT.titleRowGap);
    same('editPaletteRowCompact', 'gap', EDIT.paletteGap);
    same('editPaletteRowCompact', 'marginBottom', EDIT.paletteRowGap);
    same('editPieceBtnCompact', 'width', EDIT.pieceBtn);
    same('editPieceBtnCompact', 'height', EDIT.pieceBtn);
    same('editPieceBtnCompact', 'borderRadius', EDIT.pieceBtnRadius);
    same('editPieceBtnActive', 'borderWidth', EDIT.activeBorder);
    same('editPieceBtnActive', 'borderColor', EDIT.activeBorderColor);
    same('editPieceBtnActive', 'backgroundColor', EDIT.activeFill);
    same('editActionsRow', 'gap', EDIT.actionGap);
    same('editActionBtn', 'paddingVertical', EDIT.actionPaddingV);
    same('editActionBtn', 'borderRadius', EDIT.actionRadius);
    same('editActionBtn', 'backgroundColor', EDIT.actionBg);
    same('editActionBtnText', 'fontSize', EDIT.actionSize);
    same('editActionBtnText', 'color', EDIT.actionColor);
    same('editCastlingLabel', 'fontSize', EDIT.castlingLabelSize);
    same('editCastlingLabel', 'color', EDIT.castlingLabelColor);
    same('editCastlingLabel', 'letterSpacing', EDIT.castlingTracking);
    same('editCastlingRow', 'gap', EDIT.castlingGap);
    same('editCastlingBtn', 'paddingVertical', EDIT.castlingPaddingV);
    same('editCastlingBtn', 'borderRadius', EDIT.castlingRadius);
    same('editCastlingBtn', 'backgroundColor', EDIT.castlingBg);
    same('editCastlingBtnText', 'fontSize', EDIT.castlingSize);
    same('editCastlingBtnText', 'color', EDIT.castlingColor);
    same('editCastlingBtnOn', 'backgroundColor', EDIT.castlingOnBg);
    same('editCastlingBtnOn', 'borderColor', EDIT.castlingOnBorder);
    same('editCastlingBtnTextOn', 'color', EDIT.castlingOnColor);
    same('editValidationError', 'color', EDIT.errorColor);
    same('editValidationError', 'fontSize', EDIT.errorSize);
    same('editDoneBtnCompact', 'backgroundColor', EDIT.doneBg);
    same('editDoneBtnCompact', 'paddingVertical', EDIT.donePaddingV);
    same('editDoneBtnCompact', 'borderRadius', EDIT.doneRadius);
    same('editDoneBtnCompactText', 'color', EDIT.doneColor);
    same('editDoneBtnCompactText', 'fontSize', EDIT.doneSize);
    same('editDoneBtnCompactText', 'letterSpacing', EDIT.doneTracking);
    same('editFenRow', 'gap', EDIT.fenGap);
    same('editFenInput', 'backgroundColor', EDIT.fenBg);
    same('editFenInput', 'borderRadius', EDIT.fenRadius);
    same('editFenInput', 'paddingHorizontal', EDIT.fenPaddingH);
    same('editFenInput', 'paddingVertical', EDIT.fenPaddingV);
    same('editFenInput', 'color', EDIT.fenColor);
    same('editFenInput', 'fontSize', EDIT.fenSize);
    same('editFenLoadBtn', 'borderColor', EDIT.loadBorder);
    same('editFenLoadBtn', 'paddingHorizontal', EDIT.loadPaddingH);
    same('editFenLoadBtnText', 'color', EDIT.loadColor);
    same('editFenLoadBtnText', 'fontSize', EDIT.loadSize);
    same('editBoard', 'borderWidth', EDIT.boardBorder);
    same('editBoard', 'borderColor', EDIT.boardBorderColor);
    // The palette square colours are inline JSX (board.tsx:3634, :3654), not StyleSheet keys, so
    // they cannot be pinned that way — but the edit BOARD paints the same pair in renderEditSquare,
    // and that expression is extracted, so the pair is still checked against the source.
    var editSq = src.renderConstants && src.renderConstants.renderEditSquare;
    if (editSq) {
      var bg = editSq.bgColor;
      expect(!!bg && bg.text.indexOf(EDIT.lightSquare) >= 0 && bg.text.indexOf(EDIT.darkSquare) >= 0,
        'the two palette colours are the ones renderEditSquare paints');
    } else {
      expect(false, 'renderConstants is missing renderEditSquare — re-run the extractor');
    }
    expect(EDIT.lightSquare !== EDIT.darkSquare, 'and they are different from each other');
    expect(src.moduleConstants.WHITE_PIECE_KEYS.join('') === 'KQRBNP',
      'the white palette order matches the source');
    expect(src.moduleConstants.BLACK_PIECE_KEYS.join('') === 'kqrbnp',
      'and the black palette order');
    expect(src.moduleConstants.EDIT_PALETTE_PIECE_SIZE === EDIT.piece,
      'EDIT_PALETTE_PIECE_SIZE: encoded ' + EDIT.piece
        + ' != source ' + src.moduleConstants.EDIT_PALETTE_PIECE_SIZE);

    // The remaining modals
    same('pgnModalOverlay', 'backgroundColor', MODALS.pgnScrim);
    same('pgnModalContent', 'backgroundColor', MODALS.pgnBg);
    same('pgnModalContent', 'borderRadius', MODALS.pgnRadius);
    same('pgnModalContent', 'padding', MODALS.pgnPadding);
    same('pgnTextInput', 'backgroundColor', MODALS.pgnInputBg);
    same('pgnTextInput', 'borderRadius', MODALS.pgnInputRadius);
    same('pgnTextInput', 'minHeight', MODALS.pgnInputMinHeight);
    same('pgnTextInput', 'maxHeight', MODALS.pgnInputMaxHeight);
    same('pgnTextInput', 'fontSize', MODALS.pgnInputSize);
    same('pgnTextInput', 'color', MODALS.pgnInputColor);
    same('pgnTextInput', 'padding', MODALS.pgnInputPadding);
    same('branchModal', 'backgroundColor', MODALS.branchBg);
    same('branchModal', 'borderRadius', MODALS.branchRadius);
    same('branchModal', 'padding', MODALS.branchPadding);
    same('branchModal', 'width', MODALS.branchWidth);
    same('branchModalTitle', 'fontSize', MODALS.branchTitleSize);
    same('branchModalSub', 'fontSize', MODALS.branchSubSize);
    same('branchOption', 'backgroundColor', MODALS.optionBg);
    same('branchOption', 'borderRadius', MODALS.optionRadius);
    same('branchOption', 'paddingVertical', MODALS.optionPaddingV);
    same('branchOption', 'paddingHorizontal', MODALS.optionPaddingH);
    same('branchOption', 'borderLeftWidth', MODALS.optionBorderWidth);
    same('branchOption', 'borderLeftColor', MODALS.optionBorderColor);
    same('branchOptionMain', 'borderLeftColor', MODALS.optionMainBorder);
    same('branchOptionMain', 'backgroundColor', MODALS.optionMainBg);
    same('branchOptionMove', 'fontSize', MODALS.optionMoveSize);
    same('branchOptionPreview', 'fontSize', MODALS.optionPreviewSize);
    same('varModalSheet', 'backgroundColor', MODALS.varSheetBg);
    same('varModalSheet', 'borderTopLeftRadius', MODALS.varSheetRadius);
    same('varModalHandle', 'width', MODALS.varHandleW);
    same('varModalHandle', 'height', MODALS.varHandleH);
    same('varActionRow', 'paddingVertical', MODALS.varActionPaddingV);
    same('varActionRow', 'borderRadius', MODALS.varActionRadius);
    same('varActionRow', 'gap', MODALS.varActionGap);
    same('varActionTitle', 'fontSize', MODALS.varTitleSize);
    same('varActionSub', 'fontSize', MODALS.varSubtitleSize);
    // The annotation picker
    same('annotationPicker', 'backgroundColor', MODALS.pickerBg);
    same('annotationPicker', 'borderRadius', MODALS.pickerRadius);
    same('annotationPicker', 'padding', MODALS.pickerPadding);
    same('annotationPicker', 'width', MODALS.pickerWidth);
    same('annotationPickerTitle', 'fontSize', TYPE.annotationPickerTitle);
    same('annotationGrid', 'gap', MODALS.gridGap);
    same('annotationGrid', 'marginBottom', MODALS.gridMarginBottom);
    same('annotationBtn', 'width', MODALS.btnW);
    same('annotationBtn', 'height', MODALS.btnH);
    same('annotationBtn', 'borderRadius', MODALS.btnRadius);
    same('annotationBtn', 'backgroundColor', MODALS.btnBg);
    same('annotationBtnSymbol', 'fontSize', TYPE.annotationSymbol);
    same('annotationBtnLabel', 'fontSize', TYPE.annotationLabel);
    same('annotationBtnLabel', 'color', MODALS.labelColor);
    same('annotationBtnLabel', 'marginTop', MODALS.labelGap);
    same('annotationClearBtn', 'backgroundColor', MODALS.clearBg);
    same('annotationClearBtn', 'borderRadius', MODALS.clearRadius);
    same('annotationClearBtn', 'paddingVertical', MODALS.clearPaddingV);
    same('annotationClearBtnText', 'color', MODALS.clearColor);
    same('annotationClearBtnText', 'fontSize', MODALS.clearSize);
    // annotPickerStyles is its own one-key block — the section headings.
    var AP = src.stylesheets.annotPickerStyles;
    function ap(prop, mine) {
      var real = AP.sectionLabel ? AP.sectionLabel[prop] : undefined;
      expect(real === mine, 'annotPickerStyles.sectionLabel.' + prop
        + ': encoded ' + mine + ' != source ' + real);
    }
    ap('fontSize', TYPE.annotationSection);
    ap('color', MODALS.sectionColor);
    ap('letterSpacing', MODALS.sectionTracking);
    ap('marginTop', MODALS.sectionMarginTop);
    ap('marginBottom', MODALS.sectionMarginBottom);

    // ---- Arrow + badge geometry, against the render functions --------------------
    // These live INSIDE a render function, so no StyleSheet holds them and they were transcribed
    // by hand. That is how the badge ended up in the wrong corner in BOTH languages, each asserting
    // the other's mistake. The extractor now flattens every such expression into signed terms, so
    // the DIRECTION of an offset is checked, not merely its magnitude.
    var RC = src.renderConstants || {};
    expect(src.renderConstants !== undefined,
      'board_styles.json has renderConstants — re-run tools/metrics/extract_board_styles.js');
    function expr(fn, name) {
      var e = RC[fn] && RC[fn][name];
      expect(e !== undefined, 'renderConstants.' + fn + '.' + name + ' was extracted');
      return e || { terms: [] };
    }
    /** The signed multiple of `ref` in an extracted expression; null when absent. */
    function ratioOf(e, ref) {
      if (!e) return null;
      for (var i = 0; i < (e.terms || []).length; i++) {
        var t = e.terms[i];
        if (t.ref === ref) return t.sign * t.ratio;
      }
      return null;
    }
    function ratio(fn, name, ref, mine, label) {
      var got = ratioOf(expr(fn, name), ref);
      expect(got === mine, (label || fn + '.' + name) + ': encoded ' + mine + ' != source ' + got);
    }
    /** The literal value of the i-th additive term, or null. */
    function constTerm(e, i) {
      var t = e && e.terms && e.terms[i];
      return t && t.value !== undefined ? t.sign * t.value : null;
    }
    function textOf(e) { return (e && e.text) || ''; }

    // The anchor every offset below is measured from: squareToPixel returns the square CENTRE.
    ratio('squareToPixel', 'return.x', 'SQUARE_SIZE', 0.5, 'squareToPixel anchors at the centre (x)');
    ratio('squareToPixel', 'return.y', 'SQUARE_SIZE', 0.5, 'squareToPixel anchors at the centre (y)');

    // Arrows
    ratio('renderArrowsOverlay', 'arrowWidth', 'SQUARE_SIZE', ARROW.strokeRatio);
    ratio('renderArrowsOverlay', 'headSize', 'SQUARE_SIZE', ARROW.headRatio);
    ratio('renderArrowsOverlay', 'shortenEnd', 'headSize', ARROW.shortenRatio);
    expect(/headSize \* 0\.6/.test(textOf(expr('renderArrowsOverlay', 'leftX'))),
      'the arrowhead half-width is 0.6 of the head, as encoded');

    // Badge — the sign on cy is the whole point of this block.
    ratio('renderAnnotationOverlay', 'r', 'SQUARE_SIZE', BADGE.radiusRatio);
    ratio('renderAnnotationOverlay', 'cx', 'SQUARE_SIZE', BADGE.offsetRatio, 'badge x offset');
    ratio('renderAnnotationOverlay', 'cy', 'SQUARE_SIZE', BADGE.offsetRatio, 'badge y offset');
    expect(ratioOf(expr('renderAnnotationOverlay', 'cy'), 'SQUARE_SIZE') > 0,
      'the badge sits BELOW the square centre — bottom-right, not upper-right');
    expect(ratioOf(expr('renderAnnotationOverlay', 'cx'), 'pos.x') === 1
        && ratioOf(expr('renderAnnotationOverlay', 'cy'), 'pos.y') === 1,
      'and it is offset from the centre the anchor returned, not from a corner');
    var fs_ = expr('renderAnnotationOverlay', 'fontSize');
    expect(ratioOf(fs_.whenTrue, 'r') === BADGE.fontRatioLong, 'a two-character symbol uses r * 0.88');
    expect(ratioOf(fs_.whenFalse, 'r') === BADGE.fontRatioShort, 'a one-character symbol uses r * 1.1');
    expect(ratioOf(expr('renderAnnotationOverlay', 'Circle[0].cx'), 'cx') === 1
        && constTerm(expr('renderAnnotationOverlay', 'Circle[0].cx'), 1) === BADGE.shadowOffset
        && constTerm(expr('renderAnnotationOverlay', 'Circle[0].cy'), 1) === BADGE.shadowOffset,
      'the drop shadow is offset by +1.5 on both axes');
    expect(constTerm(expr('renderAnnotationOverlay', 'Circle[1].r'), 1) === BADGE.ringExtra,
      'the white ring is r + 1.5');
    ratio('renderAnnotationOverlay', 'SvgText[0].y', 'fontSize', BADGE.baselineRatio,
      'the text baseline is cy + fontSize * 0.37');
    expect(ratioOf(expr('renderAnnotationOverlay', 'SvgText[0].y'), 'cy') === 1,
      'and it is measured from the badge centre');

    // ---- The save form and the library ------------------------------------------
    var SV = src.stylesheets.saveModalStyles, LD = src.stylesheets.loadModalStyles;
    function pin(block, styleKey, prop, mine, label) {
      var real = block[styleKey] ? block[styleKey][prop] : undefined;
      expect(real === mine, (label || styleKey + '.' + prop)
        + ': encoded ' + mine + ' != source ' + real);
    }
    // bottom sheet + chips live in the main `styles` block
    same('bottomModalOverlay', 'backgroundColor', LIBRARY.scrim);
    same('bottomModalContent', 'backgroundColor', LIBRARY.sheetBg);
    same('bottomModalContent', 'borderTopLeftRadius', LIBRARY.sheetRadius);
    same('bottomModalContent', 'padding', LIBRARY.sheetPadding);
    same('panelHeader', 'marginBottom', LIBRARY.headerGap);
    same('panelTitle', 'fontSize', LIBRARY.titleSize);
    same('panelClose', 'fontSize', LIBRARY.closeSize);
    same('folderChip', 'paddingHorizontal', LIBRARY.chipPaddingH);
    same('folderChip', 'paddingVertical', LIBRARY.chipPaddingV);
    same('folderChip', 'borderRadius', LIBRARY.chipRadius);
    same('folderChip', 'marginRight', LIBRARY.chipGap);
    same('folderChipText', 'fontSize', LIBRARY.chipSize);
    same('folderChipText', 'color', LIBRARY.chipIdle);
    same('folderChipActive', 'backgroundColor', LIBRARY.chipActiveBg);
    same('folderChipTextActive', 'color', LIBRARY.chipActiveText);
    // the save form
    pin(SV, 'fieldRow', 'gap', LIBRARY.fieldGap);
    pin(SV, 'fieldInput', 'backgroundColor', LIBRARY.fieldBg);
    pin(SV, 'fieldInput', 'borderRadius', LIBRARY.fieldRadius);
    pin(SV, 'fieldInput', 'paddingHorizontal', LIBRARY.fieldPaddingH);
    pin(SV, 'fieldInput', 'paddingVertical', LIBRARY.fieldPaddingV);
    pin(SV, 'fieldInput', 'fontSize', LIBRARY.fieldSize);
    pin(SV, 'resultRow', 'gap', LIBRARY.resultGap);
    pin(SV, 'resultRow', 'marginBottom', LIBRARY.resultMarginBottom);
    pin(SV, 'resultChip', 'paddingVertical', LIBRARY.resultPaddingV);
    pin(SV, 'resultChip', 'borderRadius', LIBRARY.resultRadius);
    pin(SV, 'resultChipText', 'fontSize', LIBRARY.resultSize);
    pin(SV, 'resultChipText', 'color', LIBRARY.resultIdle);
    pin(SV, 'resultChipActive', 'backgroundColor', LIBRARY.resultActiveBg);
    pin(SV, 'resultChipTextActive', 'color', LIBRARY.resultActiveText);
    pin(SV, 'bottomRow', 'gap', LIBRARY.buttonGap);
    pin(SV, 'bottomRow', 'marginTop', LIBRARY.buttonMarginTop);
    pin(SV, 'saveBtn', 'paddingVertical', LIBRARY.buttonPaddingV);
    pin(SV, 'saveBtn', 'borderRadius', LIBRARY.buttonRadius);
    pin(SV, 'saveBtn', 'backgroundColor', LIBRARY.saveBg);
    pin(SV, 'saveBtnText', 'fontSize', LIBRARY.buttonSize);
    pin(SV, 'cancelBtn', 'backgroundColor', LIBRARY.cancelBg);
    // the library rows
    pin(LD, 'sessionCard', 'backgroundColor', LIBRARY.cardBg);
    pin(LD, 'sessionCard', 'borderRadius', LIBRARY.cardRadius);
    pin(LD, 'sessionCard', 'padding', LIBRARY.cardPadding);
    pin(LD, 'sessionCard', 'marginBottom', LIBRARY.cardGap);
    pin(LD, 'sessionPrimary', 'fontSize', LIBRARY.primarySize);
    pin(LD, 'sessionPrimary', 'marginBottom', LIBRARY.primaryGap);
    pin(LD, 'sessionPgn', 'fontSize', LIBRARY.pgnSize);
    pin(LD, 'sessionPgn', 'color', LIBRARY.pgnColor);
    pin(LD, 'sessionMeta', 'fontSize', LIBRARY.metaSize);
    pin(LD, 'sessionMeta', 'color', LIBRARY.metaColor);
    pin(LD, 'sessionMeta', 'marginTop', LIBRARY.metaGap);
    pin(LD, 'actionBtn', 'width', LIBRARY.actionSize);
    pin(LD, 'actionBtn', 'borderRadius', LIBRARY.actionRadius);
    pin(LD, 'actionBtn', 'backgroundColor', LIBRARY.actionBg);

    // The eval bars — the case prose got ambiguous.
    same('evalBarTrack', 'height', EVAL_BAR.mainHeight, 'MAIN eval bar height');
    same('evalBarTrack', 'borderRadius', EVAL_BAR.mainRadius);
    same('engineEvalBarTrack', 'height', EVAL_BAR.microHeight, 'MICRO eval bar height');
    same('engineEvalBarTrack', 'borderRadius', EVAL_BAR.microRadius);

    // Module constants
    var c = src.moduleConstants;
    expect(JSON.stringify(c.ARROW_COLORS) === JSON.stringify(ARROW_COLORS), 'arrow colours match the source');
    expect(JSON.stringify(c.AUTOPLAY_SPEEDS) === JSON.stringify(AUTOPLAY_SPEEDS), 'autoplay speeds match the source');
    expect(JSON.stringify(c.MOVE_ANNOTATIONS) === JSON.stringify(MOVE_ANNOTATIONS), 'move annotations match the source');

    // Geometry formula
    expect(Math.abs(src.geometry.BOARD_SIZE - boardSize(src.geometry.referenceDevice.width,
                                                        src.geometry.referenceDevice.pixelRatio)) < 1e-9,
      'the board formula reproduces the source geometry');

    // The DELIBERATE deviations: assert we differ, and in the intended direction.
    var srcSlightWhite = c.POSITION_ANNOTATIONS.filter(function (a) { return a.symbol === '⩱'; })[0];
    expect(/White/.test(srcSlightWhite.label),
      'the RN source really does label ⩱ as White (the bug we are fixing)');
    var mineSlightWhite = POSITION_ANNOTATIONS.filter(function (a) { return a.symbol === '⩱'; })[0];
    expect(/Black/.test(mineSlightWhite.label), 'and we deliberately differ');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'AnalysisMetricsSource: ' + passed + ' assertions passed against the RN source'
        : 'AnalysisMetricsSource: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (x) { return '  ✗ ' + x; }).join('\n')
    };
  }

  return {
    boardSize: boardSize, squareSize: squareSize, pieceSize: pieceSize, PIECE_RATIO: PIECE_RATIO,
    visual: visual, squareCenter: squareCenter, isLightSquare: isLightSquare,
    PALETTE: PALETTE, BOARD_THEMES: BOARD_THEMES, DEFAULT_BOARD_THEME: DEFAULT_BOARD_THEME,
    HIGHLIGHT: HIGHLIGHT, squareFill: squareFill,
    INDICATOR: INDICATOR, dotSize: dotSize, ringSize: ringSize, ringStrokeWidth: ringStrokeWidth,
    ARROW: ARROW, ARROW_COLORS: ARROW_COLORS, arrowGeometry: arrowGeometry, arrowColor: arrowColor,
    BADGE: BADGE, badgeGeometry: badgeGeometry,
    BANDS: BANDS, bandLayout: bandLayout,
    engineRowsThatFit: engineRowsThatFit, enginePlan: enginePlan,
    engineRowHeight: engineRowHeight, engineChromeHeight: engineChromeHeight,
    EVAL_BAR: EVAL_BAR, EVAL_CLAMP: EVAL_CLAMP, evalBarFraction: evalBarFraction,
    GRAPH: GRAPH, graphPoint: graphPoint,
    CLASSIFICATIONS: CLASSIFICATIONS, CLASSIFICATION_ORDER: CLASSIFICATION_ORDER,
    MOVE_ANNOTATIONS: MOVE_ANNOTATIONS, POSITION_ANNOTATIONS: POSITION_ANNOTATIONS,
    EVAL_SYMBOLS: EVAL_SYMBOLS, evalSymbol: evalSymbol,
    AUTOPLAY_SPEEDS: AUTOPLAY_SPEEDS, DEFAULT_AUTOPLAY_SPEED: DEFAULT_AUTOPLAY_SPEED,
    TIMINGS: TIMINGS, ENGINE_LIMITS: ENGINE_LIMITS, ENGINE_PANEL: ENGINE_PANEL, TYPE: TYPE,
    REVIEW: REVIEW, GRAPH_STYLE: GRAPH_STYLE,
    LIBRARY: LIBRARY, RESULT_OPTIONS: RESULT_OPTIONS, resultLabel: resultLabel,
    MENU: MENU, menuWidth: menuWidth, EDIT: EDIT, MODALS: MODALS,
    cardMaxHeight: cardMaxHeight, accuracyColor: accuracyColor,
    classificationText: classificationText, accuracyText: accuracyText,
    selfTest: selfTest, selfTestSource: selfTestSource
  };
})();

/* Makes the metrics runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaAnalysisMetrics; }
