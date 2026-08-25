/* puzzle-metrics.js — the Puzzle Hub's pure presentation layer.
 *
 * Browser mirror of `DemoApp/Sources/BiyaherongUI/PuzzleMetrics.swift`.
 *
 *     node -e "console.log(require('./web-demo/js/puzzle-metrics.js').selfTest().summary)"
 *
 * Every number the puzzle screens draw lives here, and every one of them is asserted against
 * `tools/metrics/puzzle_styles.json` — the AST extraction of the real React Native StyleSheets —
 * by `selfTestSource()`. Nothing here is transcribed from the spec's prose. The rule exists
 * because two hand-typed copies of a number agreeing with each other is not verification: that is
 * how the Analysis Board's annotation badge shipped in the wrong corner in both languages.
 *
 * Consequently the screens contain NO numeric literal and NO arithmetic in a view body. Break that
 * and the coverage drains away silently, because there is nothing left for the source oracle to
 * check.
 *
 * ── Three things the extraction proved the spec got wrong ────────────────────
 *  1. Part 1 describes one "standard header" at `paddingTop 10, paddingBottom 6`. There is no
 *     shared header component: eight distinct header shapes across eleven screens, and the spec's
 *     numbers match only the Play Puzzles HOME. The hub is `paddingVertical 10`, the rated solver
 *     `paddingVertical 8`. Encoded per screen.
 *  2. Part 10.3 gives "Next Puzzle →" a top margin of 8. It has both — `marginTop: 8` inline at
 *     three call sites AND `marginBottom: 8` in the StyleSheet. The spec mentions only the first.
 *  3. Part 9.2's mode tiles are "13% alpha" and "33% alpha". The source concatenates hex bytes:
 *     `mode.color + '22'` and `+ '55'`, i.e. 13.33% and 33.33%. The bytes are what ship.
 *
 * ── Typography ───────────────────────────────────────────────────────────────
 * Part 0: the RN original loads Nunito but never applies it on any puzzle screen — they all render
 * in the platform system font. So these screens do NOT use `Theme.nunito`. The one exception is
 * the timer, which needs tabular figures or it jitters every second.
 */
'use strict';

var BiyaPuzzleMetrics = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  // The puzzle screens import the very same `DragDropChessBoard`, so the board geometry is not
  // re-derived here — it is the Analysis Board's, and the extraction confirms the formula matches.
  var AMET = isNode ? require('./analysis-metrics.js') : BiyaAnalysisMetrics;
  // The wrong-move policy is the session core's, and `bottomPanel` DERIVES from it rather than
  // restating it. Restating is exactly how the panel came to offer Streak and Turbo a Retry that
  // `WRONG_POLICY` forbids. `puzzle-session.js` depends on nothing here, so this cannot cycle.
  var SESSION = isNode ? require('./puzzle-session.js') : BiyaPuzzleSession;
  var WRONG_POLICY = SESSION.WRONG_POLICY;
  var MODES = SESSION.MODES;

  // ---- Board -------------------------------------------------------------------------
  // Re-exported rather than redefined: one formula, one place, and `puzzle_styles.json`'s
  // `geometry` block asserts it is the same component.
  var boardSize = AMET.boardSize;
  var squareSize = AMET.squareSize;
  var pieceSize = AMET.pieceSize;

  // ---- Palette (Part 2) ----------------------------------------------------------------
  var PALETTE = {
    screenBg: '#0F1A2E',
    card: '#1A2942',
    cardAlt: '#253552',
    textPrimary: '#FFFFFF',
    textSecondary: '#8BA3C7',
    gold: '#FDB022',
    onGold: '#0F1A2E',
    correct: '#43D97C',
    wrong: '#FF6B6B',
    engineEval: '#90CAF9',
    shareBlue: '#1E88E5',
    // Mode accents. Part 9.2 flags that the hub's own card colours for Thematic, Turbo and Streak
    // (#A855F7 / #4A90E2 / #FF6B35) differ from those screens' accents; the fix is to unify on the
    // SCREEN colours so a tapped card flows into a matching screen. `HUB_SOURCE_COLORS` below
    // keeps what the source actually had, so the deviation stays visible rather than lost.
    ratedGreen: '#5CC264',
    dailyGreen: '#7CB342',
    thematicPurple: '#8E24AA',
    turboBlue: '#1E88E5',
    streakOrange: '#F4511E',
  };

  /** Hex alpha the way the source writes it: `color + '22'`. Not a rounded percentage. */
  function tint(hex, byte) { return hex + byte; }
  var TINT_FILL = '22';      // 0x22/255 = 13.33%  (the spec says "13%")
  var TINT_BORDER = '55';    // 0x55/255 = 33.33%  (the spec says "33%")

  // ---- Hub (Part 9) ----------------------------------------------------------------------
  var HUB = {
    headerPaddingH: 16, headerPaddingV: 10,
    backBtnW: 40, backBtnH: 40,
    heroPaddingTop: 6, heroPaddingBottom: 10, heroGap: 4,
    heroGlowSize: 68, heroGlowRadius: 34, heroGlowBorder: 2, heroGlowMarginBottom: 4,
    heroGlowFill: 'rgba(253,176,34,0.12)', heroGlowBorderColor: 'rgba(253,176,34,0.35)',
    cardsPaddingH: 14, cardsPaddingBottom: 10,
    cardRadius: 14, cardPaddingV: 13, cardPaddingH: 14, cardBorderLeft: 4, cardGap: 12,
    cardShadowOpacity: 0.25, cardShadowRadius: 4, cardShadowY: 2,
    tileSize: 44, tileRadius: 12, tileBorder: 1.5,
    titleMarginBottom: 2,
    badgePaddingH: 8, badgePaddingV: 3, badgeRadius: 20, badgeLetterSpacing: 0.5,
    chevronLineHeight: 24,
    pressOpacity: 0.72,
  };

  /** The five cards, Part 9.2. `color` is the SCREEN accent (the unification fix). */
  var HUB_MODES = [
    { id: 'play',     emoji: '♟️', title: 'Play Puzzles',     subtitle: 'Solve rated puzzles & level up',        badge: 'RATED',  color: PALETTE.ratedGreen },
    { id: 'daily',    emoji: '📅', title: 'Daily Puzzle',     subtitle: "Today's special challenge awaits",      badge: 'DAILY',  color: PALETTE.gold },
    { id: 'thematic', emoji: '🎯', title: 'Thematic Puzzles', subtitle: 'Master specific tactics & patterns',    badge: 'THEMES', color: PALETTE.thematicPurple },
    { id: 'turbo',    emoji: '⚡', title: 'Puzzle Turbo',     subtitle: 'Race against the clock!',               badge: 'RUSH',   color: PALETTE.turboBlue },
    { id: 'streak',   emoji: '🔥', title: 'Puzzle Streak',    subtitle: "One mistake and it's over — keep going!", badge: 'STREAK', color: PALETTE.streakOrange },
  ];

  /** What the RN source actually used, kept so the Part 9.2 deviation is checkable, not folklore. */
  var HUB_SOURCE_COLORS = {
    play: '#5CC264', daily: '#FDB022', thematic: '#A855F7', turbo: '#4A90E2', streak: '#FF6B35',
  };

  // ---- Daily-goal strip (Part 15.2) --------------------------------------------------------
  // INVENTED — there is no RN source for this: the server had a /api/daily-goal endpoint that the
  // mobile app never called, so there is no StyleSheet to extract and `selfTestSource` cannot
  // assert these. Recorded in PORTING_NOTES.md.
  var GOAL = {
    fill: PALETTE.card, radius: 14, paddingH: 14, paddingV: 12,
    borderWidth: 1, borderColor: 'rgba(253,176,34,0.2)',
    marginH: 14, marginBottom: 10, rowGap: 14,
    ringSize: 44, ringStroke: 5, ringTrack: '#253552', ringColor: PALETTE.gold,
    ringDoneColor: PALETTE.correct, ringLabelSize: 15,
    titleSize: 14, subSize: 12,
    pillFill: 'rgba(253,176,34,0.12)', pillRadius: 20, pillPaddingH: 10, pillPaddingV: 5,
    pillBorder: 'rgba(253,176,34,0.3)', pillTextSize: 12,
  };

  // ---- Play Puzzles Home (Part 10.1) -------------------------------------------------------
  var PLAY_HOME = {
    headerPaddingH: 16, headerPaddingTop: 10, headerPaddingBottom: 6,
    badgeFill: PALETTE.ratedGreen, badgePaddingH: 10, badgePaddingV: 4, badgeRadius: 12,
    topPaddingH: 16, topGap: 8,
    heroFill: PALETTE.card, heroRadius: 14, heroPaddingH: 12, heroPaddingV: 10, heroGap: 10,
    heroBorder: 1, heroBorderColor: 'rgba(92,194,100,0.3)',
    heroEmojiSize: 28, heroSubMarginTop: 2,
    statRowFill: 'rgba(92,194,100,0.07)', statRowRadius: 8,
    statRowPaddingH: 8, statRowPaddingV: 6,
    statPaddingH: 6, statIconSize: 14, statLabelMarginTop: 1,
    dividerW: 1, dividerH: 20, dividerColor: 'rgba(255,255,255,0.08)',
    bottomPaddingH: 16, bottomPaddingBottom: 10, bottomPaddingTop: 6, bottomGap: 8,
    infoFill: 'rgba(92,194,100,0.07)', infoRadius: 10, infoPaddingH: 12, infoPaddingV: 8,
    infoBorder: 1, infoBorderColor: 'rgba(92,194,100,0.18)', infoLineHeight: 16,
    shareFill: PALETTE.shareBlue, shareRadius: 14, sharePaddingV: 11,
    playFill: PALETTE.ratedGreen, playRadius: 14, playPaddingV: 14,
    playShadowY: 4, playShadowOpacity: 0.35, playShadowRadius: 8,
  };

  // The five stats cards. INVENTED geometry (the source had a leaderboard here); the numbers come
  // from the spec's Part 10.1, which is itself new design. Recorded in PORTING_NOTES.md.
  var STATS = {
    cardFill: PALETTE.card, cardRadius: 16, cardPadding: 16, cardMarginBottom: 12,
    sectionTitleSize: 16,
    ratingSize: 32, ratingLabelSize: 12, bestSize: 20, deltaSize: 12,
    sparkHeight: 52, sparkRadius: 6, sparkBg: PALETTE.screenBg,
    sparkStroke: PALETTE.gold, sparkStrokeWidth: 1.5, sparkPadding: 32, sparkYMargin: 25,
    sparkMinPoints: 2, sparkWindow: 30,
    accuracySize: 28, accuracySubSize: 12,
    barMaxHeight: 80, barMinHeight: 4, barWidth: 28, barRadius: 4,
    barCountHeight: 14, barCountSize: 10, barDaySize: 11, barEmptyFill: PALETTE.cardAlt,
    barRowMarginTop: 12,
    themeRows: 6, themeNameSize: 13, themeTrackHeight: 6, themeTrackRadius: 3,
    themeTrackFill: PALETTE.cardAlt, themePctSize: 12, themePctMinWidth: 44,
    emptySize: 13,
  };

  /** Accuracy colour thresholds, Part 10.1. Descending so a boundary lands in the better band. */
  function accuracyColor(pct) {
    if (pct >= 80) return PALETTE.correct;
    if (pct >= 60) return PALETTE.gold;
    return PALETTE.wrong;
  }


  // ---- Daily Puzzle (Part 11) ----------------------------------------------------------
  var DAILY_HOME = {
    headerPaddingH: 20, headerPaddingTop: 16, headerPaddingBottom: 12,
    contentPaddingH: 20, contentPaddingBottom: 40,
    heroRadius: 20, heroPadding: 28, heroMarginBottom: 20,
    heroBorder: 1, heroBorderColor: 'rgba(124,179,66,0.3)',
    heroIconSize: 56, heroIconMarginBottom: 12, heroTitleMarginBottom: 6,
    statsGap: 12, statsMarginBottom: 16,
    statCardRadius: 16, statCardPadding: 20, statCardGap: 4,
    statCardBorder: 1, statCardBorderColor: 'rgba(253,176,34,0.15)',
    statEmojiSize: 28, statValueSize: 32, statLabelSize: 12,
    infoRadius: 16, infoPadding: 20, infoMarginBottom: 20,
    infoBorder: 1, infoBorderColor: 'rgba(124,179,66,0.15)',
    infoTitleSize: 15, infoTitleMarginBottom: 8, infoTextSize: 14, infoLineHeight: 22,
    startFill: PALETTE.dailyGreen, startRadius: 16, startPaddingV: 18,
    startShadowY: 4, startShadowOpacity: 0.3, startShadowRadius: 8,
    solvedRadius: 16, solvedPadding: 28, solvedGap: 8,
    solvedBorder: 1, solvedBorderColor: 'rgba(92,194,100,0.3)',
    solvedIconSize: 48, solvedSubLineHeight: 22,
  };

  var DAILY_SOLVER = {
    headerPaddingH: 20, headerPaddingV: 12,
    headerSubMarginTop: 2, headerSubMaxWidth: 200,
    feedbackMarginH: 16, feedbackRadius: 12, feedbackPadding: 16,
    feedbackMarginTop: 12, feedbackGap: 8, feedbackIconSize: 24,
    feedbackSolvedFill: 'rgba(92,194,100,0.2)', feedbackSolvedBorder: '#5CC264',
    feedbackWrongFill: 'rgba(255,68,68,0.2)', feedbackWrongBorder: '#FF4444',
    instructionPaddingV: 12,
    doneMarginH: 16, doneFill: PALETTE.dailyGreen, doneRadius: 16,
    donePaddingV: 16, doneMarginTop: 12,
    loadingMarginTop: 12,
  };

  // ---- Thematic (Part 12) --------------------------------------------------------------
  var THEMATIC_GRID = {
    headerPaddingH: 20, headerPaddingTop: 8, headerPaddingBottom: 8,
    badgeRowGap: 8, badgeRowMarginBottom: 10,
    badgeFill: PALETTE.thematicPurple, badgePaddingH: 16, badgePaddingV: 6,
    badgeRadius: 20, badgeLetterSpacing: 1,
    sectionLabelMarginBottom: 8, sectionLabelPaddingH: 16,
    gridPaddingH: 12, gridPaddingBottom: 8, gridGap: 8, gridRowGap: 8,
    cols: 3, rows: 4,
    cardRadius: 12, cardBorder: 1.5, cardPadding: 6,
    startFill: PALETTE.thematicPurple, startRadius: 16, startPaddingV: 16,
    startMarginH: 12, startMarginBottom: 8,
    startDisabledFill: '#3A2A4A', startDisabledOpacity: 0.6,
  };

  /**
   * The 12 themes, straight from the source's own `THEMES` array — labels, emoji and tile colours.
   *
   * Extracted rather than typed because the labels carry variation selectors: `⚔️`, `🗡️`, `♟️` and
   * `⚙️` are U+FE0F sequences and `♚` is not, which is exactly the kind of thing a hand copy
   * silently normalises away.
   */
  var THEMES = [
    { id: 'hangingPiece',     label: '🎯 Hanging Piece',     color: '#8E24AA' },
    { id: 'crushing',         label: '💥 Crushing',          color: '#7B1FA2' },
    { id: 'fork',             label: '⚔️ Fork',              color: '#6A1B9A' },
    { id: 'pin',              label: '📌 Pin',               color: '#4A148C' },
    { id: 'skewer',           label: '🗡️ Skewer',            color: '#880E4F' },
    { id: 'discoveredAttack', label: '🔍 Discovered Attack', color: '#1565C0' },
    { id: 'advantage',        label: '📈 Advantage',         color: '#0D47A1' },
    { id: 'endgame',          label: '🏁 Endgame',           color: '#1B5E20' },
    { id: 'backRankMate',     label: '🏰 Back Rank Mate',    color: '#BF360C' },
    { id: 'mateIn1',          label: '♟️ Mate in 1',         color: '#B71C1C' },
    { id: 'mateIn2',          label: '♚ Mate in 2',          color: '#C62828' },
    { id: 'middlegame',       label: '⚙️ Middlegame',        color: '#37474F' },
  ];

  var THEMATIC_SOLVER = {
    headerPaddingH: 16, headerPaddingV: 12, headerSubMarginTop: 2,
    statsRadius: 16, statsPadding: 16, statsMarginH: 8,
    statsMarginTop: 8, statsMarginBottom: 12,
    statsShadowY: 2, statsShadowOpacity: 0.15, statsShadowRadius: 8,
    statLabelSize: 13, statLabelMarginBottom: 4, statLabelLetterSpacing: 0.3,
    statValueSize: 28,
    feedbackMarginH: 8, feedbackRadius: 12, feedbackPadding: 16,
    feedbackMarginBottom: 12, feedbackGap: 12,
    feedbackCorrectFill: 'rgba(67, 217, 124, 0.2)', feedbackCorrectBorder: '#43D97C',
    feedbackWrongFill: 'rgba(255, 68, 68, 0.2)', feedbackWrongBorder: '#FF4444',
    feedbackTextSize: 16,
    wrongRowGap: 12,
    retryFill: PALETTE.cardAlt, retryRadius: 10, retryPaddingV: 12,
    retryBorder: 1, retryBorderColor: 'rgba(255,255,255,0.15)',
    solutionFill: PALETTE.gold, solutionRadius: 10, solutionPaddingV: 12,
    nextFill: PALETTE.gold, nextRadius: 10, nextPaddingH: 24, nextPaddingV: 10,
    nextMarginTop: 10,
    buttonTextSize: 15,
    // Thematic's engine panel is roomier than Play's: padding 12 vs 8, rows 5 vs 3.
    enginePadding: 12, engineMarginH: 8, engineMarginTop: 8,
    engineHeaderMarginBottom: 8, engineRowPaddingV: 5,
    hintMarginH: 8, hintPaddingV: 12, hintSize: 14,
    loadingMarginTop: 12,
  };

  // ---- Play Puzzles Solver (Part 10.2) ------------------------------------------------------
  var SOLVER = {
    headerPaddingH: 16, headerPaddingV: 8, headerHeight: 56,
    backBtnW: 40, backBtnH: 40, backIconSize: 24, logoSize: 40, spacerW: 40,
    infoStripHeight: 34, infoStripPaddingH: 12, infoStripFill: PALETTE.card,
    statsPaddingV: 10, statsPaddingH: 12, statsFill: PALETTE.card,
    statLabelMarginBottom: 2, ratingDeltaMarginTop: 1,
    bottomPaddingH: 12, bottomPaddingTop: 8,
    wrongRowGap: 12,
    retryFill: PALETTE.cardAlt, retryRadius: 10, retryPaddingV: 12,
    retryBorder: 1, retryBorderColor: 'rgba(255,255,255,0.15)',
    solutionFill: PALETTE.gold, solutionRadius: 10, solutionPaddingV: 12,
    // BOTH margins are real: the StyleSheet carries `marginBottom: 8` and three call sites add
    // `marginTop: 8` inline. The spec mentions only the top one.
    nextFill: PALETTE.gold, nextRadius: 10, nextPaddingH: 24, nextPaddingV: 10,
    nextMarginTop: 8, nextMarginBottom: 8,
    loadingTextSize: 16, loadingMarginTop: 12,
  };

  var ENGINE = {
    fill: PALETTE.card, radius: 12, padding: 8,
    borderWidth: 1, borderColor: 'rgba(253, 176, 34, 0.2)',
    headerMarginBottom: 6, titleSize: 13, refreshSize: 18,
    rowPaddingV: 3, rowGap: 8, rowBorderWidth: 1, rowBorderColor: 'rgba(255,255,255,0.05)',
    dotSize: 10, dotWidth: 12,
    sanSize: 13, sanWidth: 48,
    evalSize: 12, evalWidth: 44,
    pvSize: 11,
    /** Play Puzzles shows the top 2 lines; Thematic shows 3 (Part 18). */
    playLines: 2, thematicLines: 3,
    /** `pv[1..<6]` — the first move is omitted, it is already the SAN column. */
    pvFrom: 1, pvTo: 6,
  };

  var PROMOTION = {
    // Part 2 keeps these deliberately distinct, and the difference is real in the source:
    // Play/Daily/Thematic dim to 0.80, Streak and Turbo to 0.82. Encoding one value made the
    // comment the only record of the other.
    scrim: 'rgba(0,0,0,0.8)',
    scrimIntense: 'rgba(0,0,0,0.82)',
    dialogFill: PALETTE.card, dialogRadius: 20, dialogPadding: 24, dialogWidth: 280,
    titleSize: 18, titleMarginBottom: 16,
    optionsGap: 10, optionRadius: 12, optionPadding: 14, optionGap: 12,
    optionTextSize: 16, glyphSize: 36,
    /** Order is fixed and there is no cancel — one must be chosen (Part 5.6). */
    order: ['q', 'r', 'b', 'n'],
    labels: { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' },
    /** Row fill is the screen's accent. */
    accent: { play: '#4A90E2', daily: '#7CB342', thematic: '#4A90E2',
              streak: '#F4511E', turbo: '#1E88E5' },
    /** Streak and Turbo dim harder than the other three. */
    scrimFor: function (mode) {
      return (mode === 'streak' || mode === 'turbo') ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.8)';
    },
  };

  var SAVE_SHEET = {
    buttonFill: PALETTE.cardAlt, buttonRadius: 10, buttonPaddingV: 10, buttonMarginTop: 8,
    buttonBorder: 1, buttonBorderColor: 'rgba(253, 176, 34, 0.4)',
    savedBorderColor: 'rgba(67, 217, 124, 0.4)', buttonTextSize: 14,
    scrim: 'rgba(0,0,0,0.6)',
    cardFill: PALETTE.card, cardRadiusTop: 20, cardPadding: 20, cardPaddingBottom: 36,
    titleSize: 16, titleMarginBottom: 16,
    labelSize: 12, labelMarginBottom: 4,
    inputFill: PALETTE.cardAlt, inputRadius: 8, inputSize: 14,
    inputPaddingH: 12, inputPaddingV: 10, inputMarginBottom: 12,
    inputBorder: 1, inputBorderColor: 'rgba(255,255,255,0.1)',
    notesMinHeight: 70,
    rowGap: 10, rowMarginTop: 4,
    cancelFill: PALETTE.cardAlt, cancelRadius: 10, cancelPaddingV: 12,
    cancelBorder: 1, cancelBorderColor: 'rgba(255,255,255,0.15)',
    saveFill: PALETTE.gold, buttonRowTextSize: 15,
    nameMax: 120,
  };


  // ---- Puzzle Streak (Part 13) -----------------------------------------------------------
  var STREAK_HOME = {
    headerPaddingH: 16, headerPaddingTop: 10, headerPaddingBottom: 6,
    badgeFill: PALETTE.streakOrange, badgePaddingH: 10, badgePaddingV: 4, badgeRadius: 12,
    topPaddingH: 16, topGap: 8,
    displayRadius: 16, displayPadding: 14, displayMinHeight: 86,
    displayBorder: 1, displayBorderColor: 'rgba(244,81,30,0.3)',
    numberSize: 46, numberLineHeight: 52,
    labelSize: 14, labelMarginTop: 2, subSize: 11, subMarginTop: 2,
    statsGap: 8, statRadius: 14, statPaddingV: 10, statGap: 2,
    statBorder: 1, statBorderColor: 'rgba(244,81,30,0.15)',
    statEmojiSize: 18, statValueSize: 20, statLabelSize: 10,
    listTitleSize: 13, listPaddingH: 16, listPaddingTop: 8, listPaddingBottom: 4,
    countBadgeFill: 'rgba(253,176,34,0.12)', countBadgeRadius: 10,
    countBadgePaddingH: 8, countBadgePaddingV: 3, countBadgeBorder: 'rgba(253,176,34,0.3)',
    countBadgeSize: 10,
    // The run rows reuse the source's own podium metrics — the leaderboard is gone but its row
    // geometry is what Part 13.1 describes, down to the 60pt minWidth on the score.
    rowRadius: 14, rowPaddingH: 12, rowPaddingV: 10, rowMarginBottom: 6, rowGap: 10,
    rowScoreSize: 15, rowScoreMinWidth: 60, rowDateSize: 13,
    emptySize: 13,
    bottomPaddingH: 16, bottomPaddingBottom: 10, bottomPaddingTop: 6, bottomGap: 8,
    startFill: PALETTE.streakOrange, startRadius: 14, startPaddingV: 14, startSize: 16,
  };

  var STREAK_SOLVER = {
    headerPaddingH: 20, headerPaddingV: 6,
    backBtnW: 44, backBtnH: 44, backSize: 28,
    counterSize: 34,
    statsRadius: 16, statsPaddingV: 8, statsPaddingH: 16, statsMarginH: 8, statsMarginBottom: 6,
    statsShadowY: 2, statsShadowOpacity: 0.15, statsShadowRadius: 6,
    statLabelSize: 11, statLabelMarginBottom: 2, statValueSize: 22, statDividerSize: 20,
    bottomPaddingH: 16, bottomGap: 10, hintSize: 14,
    loadingGap: 16, loadingSize: 15, loadingMarginTop: 4,
    // Result overlay (Part 13.3)
    overlayScrim: 'rgba(0,0,0,0.78)', overlayPaddingH: 20,
    boxRadius: 24, boxPadding: 28, boxGap: 12,
    boxBorder: 1, boxBorderColor: 'rgba(244,81,30,0.3)',
    resultHeaderSize: 22, resultNumberSize: 56, resultNumberLineHeight: 64, resultBestSize: 14,
    newBestFill: 'rgba(253,176,34,0.15)', newBestRadius: 12,
    newBestPaddingH: 16, newBestPaddingV: 6, newBestBorder: 1.5, newBestSize: 16,
    btnRadius: 12, btnPaddingV: 11, btnPaddingH: 32, btnSize: 15,
    tryAgainRadius: 14, tryAgainPaddingV: 13, tryAgainPaddingH: 40,
    backToMenuMarginTop: 4, backToMenuPaddingV: 10, backToMenuSize: 14,
    // Solution strip
    stripGap: 10, stripPaddingH: 16, stripPaddingV: 12, stripRadius: 16,
    stripBorder: 1, stripBorderColor: 'rgba(253,176,34,0.25)',
    stripLabelSize: 11, stripLabelColor: '#FFAA55', stripLabelLetterSpacing: 0.5,
    stripMoveSize: 24, stripMoveLetterSpacing: 1,
    stripButtonsGap: 8, stripBtnRadius: 10, stripBtnPaddingV: 11, stripBtnSize: 14,
    stripMenuFill: '#1E3A5F', stripMenuBorder: 'rgba(139,163,199,0.3)',
    // The revealed move's two square tints (Part 13.3).
    solutionFromTint: 'rgba(253,176,34,0.65)', solutionToTint: 'rgba(253,176,34,0.95)',
  };

  // ---- Puzzle Turbo (Part 14) --------------------------------------------------------------
  var TURBO_HOME = {
    headerPaddingH: 16, headerPaddingTop: 10, headerPaddingBottom: 6,
    badgeFill: PALETTE.turboBlue, badgePaddingH: 10, badgePaddingV: 4, badgeRadius: 12,
    topPaddingH: 16, topGap: 8,
    infoRadius: 12, infoPaddingH: 12, infoPaddingV: 9,
    infoBorder: 1, infoBorderColor: 'rgba(30,136,229,0.25)', infoSize: 12,
    mistakeBadgeFill: 'rgba(229,57,53,0.15)', mistakeBadgeRadius: 8,
    mistakeBadgePaddingH: 8, mistakeBadgePaddingV: 4,
    mistakeBadgeBorder: 'rgba(229,57,53,0.35)', mistakeBadgeColor: '#EF9A9A',
    mistakeBadgeSize: 10,
    cardRadius: 14, cardPaddingH: 12, cardPaddingV: 10,
    cardBorder: 1, cardBorderColor: 'rgba(30,136,229,0.2)',
    cardLabelSize: 10, cardLabelMarginBottom: 8, cardLabelLetterSpacing: 0.8,
    cardLabelColor: '#5A7090',
    tabGap: 8, tabPaddingV: 8, tabPaddingH: 4, tabRadius: 12, tabGapInner: 2,
    tabFill: PALETTE.cardAlt, tabBorder: 1.5, tabBorderColor: 'rgba(255,255,255,0.1)',
    tabTextSize: 12, tabBestSize: 10, tabBestColor: '#5A7090',
    tabBestSelectedColor: 'rgba(255,255,255,0.85)',
    listTitleSize: 13, listPaddingH: 16, listPaddingTop: 8, listPaddingBottom: 4,
    rowRadius: 14, rowPaddingH: 12, rowPaddingV: 10, rowMarginBottom: 6, rowGap: 10,
    rowScoreSize: 15, rowScoreMinWidth: 60, rowMistakesSize: 12, rowDateSize: 13,
    emptySize: 13,
    bottomPaddingH: 16, bottomPaddingBottom: 10, bottomPaddingTop: 6, bottomGap: 8,
    // The start button has NO fill of its own in the source: it is set inline from the selected
    // mode's colour, which is why the extraction shows no `backgroundColor`.
    startRadius: 14, startPaddingV: 14, startSize: 16,
    startShadowY: 3, startShadowOpacity: 0.25, startShadowRadius: 6,
  };

  /** The three modes, from the source's own `TIME_OPTIONS`. */
  var TURBO_MODES = [
    { minutes: 0, label: '∞ Infinite', color: '#9C27B0' },
    { minutes: 3, label: '3 min', color: '#1E88E5' },
    { minutes: 5, label: '5 min', color: '#43A047' },
  ];
  /** Part 14.1: the default selection is 3, not infinite. */
  var TURBO_DEFAULT_MODE = 3;

  var TURBO_RUN = {
    headerPaddingH: 20, headerPaddingV: 6,
    quitBtnW: 52, quitBtnH: 40, quitSize: 15,
    timerSize: 34,
    statsRadius: 16, statsPaddingV: 8, statsPaddingH: 16, statsMarginH: 8, statsMarginBottom: 6,
    statsShadowY: 2, statsShadowOpacity: 0.15, statsShadowRadius: 6,
    statLabelSize: 11, statLabelMarginBottom: 2, statValueSize: 22,
    mistakesGap: 4, mistakeDotSize: 16,
    mistakeUsedOpacity: 1.0, mistakeLeftOpacity: 0.2,
    bottomPaddingH: 16, hintSize: 14,
    loadingGap: 16, loadingSize: 15,
    // Quit modal (Part 14.4)
    modalScrim: 'rgba(0,0,0,0.7)', modalRadius: 20, modalPadding: 24, modalWidth: 300,
    modalBorder: 1, modalBorderColor: 'rgba(255,255,255,0.1)',
    modalTitleSize: 18, modalTitleMarginBottom: 10,
    modalBodySize: 14, modalBodyMarginBottom: 20, modalBodyLineHeight: 20,
    modalButtonsGap: 12, modalBtnRadius: 12, modalBtnPaddingV: 12, modalBtnSize: 14,
    modalKeepFill: PALETTE.cardAlt, modalKeepBorder: 'rgba(255,255,255,0.15)',
    modalQuitFill: '#E53935',
    // Results (Part 14.4)
    finishedPadding: 40, finishedIconSize: 64, finishedIconMarginBottom: 16,
    finishedTitleSize: 24, finishedTitleMarginBottom: 24,
    finishedScoreSize: 72, finishedLabelSize: 16, finishedLabelMarginBottom: 24,
    finishedStatsGap: 8, finishedStatsMarginBottom: 24, finishedStatSize: 16,
    doneFill: '#4A90E2', doneRadius: 16, donePaddingV: 16, donePaddingH: 32, doneSize: 16,
  };


  /**
   * The ✓/✕ dot Turbo draws over the square that was played (Part 14.3).
   *
   * Held as **signed terms**, because this is exactly the shape of the bug that once shipped the
   * annotation badge in the wrong corner in both languages: `left` SUBTRACTS its radius term and
   * `top` ADDS its own. Two hand-typed copies agreeing with each other is not verification, so the
   * signs are separate fields and `selfTestSource` reads them back out of the extraction.
   *
   * The board flip is asymmetric too — the file mirrors for Black, the rank does not:
   *   col = black ? 7 - file : file
   *   row = black ? rank : 7 - rank
   */
  var TURBO_FEEDBACK = {
    radiusFactor: 0.21,
    colOffset: 1,
    leftSign: -1, leftFactor: 1.4,
    topSign: 1, topFactor: 0.4,
    glyphFactor: 0.95, glyphLineFactor: 1.3,
    borderWidth: 1.5, borderColor: '#FFFFFF', zIndex: 20,
    correctFill: 'rgba(43,196,110,0.96)', wrongFill: 'rgba(220,50,47,0.96)',
  };

  /**
   * The Turbo clock's four colour bands (Part 14.3).
   *
   * Ordered most-urgent first so a boundary lands in the more alarming band: at exactly 10 seconds
   * the clock is already red, not amber.
   */
  function turboTimerColor(secondsLeft) {
    if (secondsLeft == null) return '#9C27B0';      // infinite
    if (secondsLeft <= 10) return '#FF4444';
    if (secondsLeft <= 30) return PALETTE.gold;
    return PALETTE.correct;
  }


  /**
   * The puzzle path's entire sound vocabulary (Part 16).
   *
   * Extracted from `hooks/usePuzzleSound.ts`, and deliberately **narrower** than the Play screen's
   * `SoundManager`: four keys, and `playMoveSound` is capture-or-move with no check and no castle
   * case. Those two files exist and the puzzle screens never reach them — that is the source's
   * choice, not an omission, and `selfTestSource` pins it so nobody "fixes" it.
   *
   * `key` is the RN name; `file` is the mp3 the web player wants. Keeping both in one table is the
   * point: three screens shipped a sound name that matched neither, and nothing noticed, because
   * `SoundManager.play` returns silently for an unknown name.
   */
  var SOUNDS = {
    keys: ['gameStart', 'move', 'capture', 'gameOver'],
    file: { gameStart: 'game-start', move: 'move', capture: 'capture', gameOver: 'game-over' },
    /** `flags.includes('c') || flags.includes('e')` — capture or en passant. */
    captureFlags: ['c', 'e'],

    /**
     * Does a **correct solve** chime?
     *
     * Three modes yes, two no, and the split is not arbitrary: Play, Daily and Thematic are
     * one-puzzle-at-a-time, so finishing is the event. Streak and Turbo are runs — their
     * `gameOver` marks the run ending, so chiming on each solve would fire it dozens of times.
     */
    chimeOnSolve: { play: true, daily: true, thematic: true, streak: false, turbo: false },

    /** And when a run ends. The mirror of the above for the two run modes. */
    chimeOnRunEnd: { play: false, daily: false, thematic: false, streak: true, turbo: true },
  };

  /** The move sound, from whether the move captured. The whole of `playMoveSound`. */
  function soundForMove(captured) { return captured ? SOUNDS.file.capture : SOUNDS.file.move; }

  /** Is `name` one of the four real sounds? The guard against a fifth invented name. */
  function isRealSound(name) {
    for (var k in SOUNDS.file) { if (SOUNDS.file[k] === name) return true; }
    return false;
  }


  /**
   * Write the promotion dialog's properties onto a screen root.
   *
   * One helper rather than a copy in each of the five `applyMetrics` functions, which is how three
   * screens ended up setting five of the nine and two setting all nine — and all of them setting
   * properties that `<chess-board>` did not read at all until its dialog was rebuilt.
   *
   * `mode` picks the scrim (Streak and Turbo dim to 0.82, the rest to 0.80) and the accent, which
   * are the only two values that differ between screens.
   */
  function applyPromotion(node, mode) {
    var P = PROMOTION;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-promo-scrim', (mode === 'streak' || mode === 'turbo') ? P.scrimIntense : P.scrim);
    set('--pz-promo-accent', P.accent[mode] || P.accent.play);
    set('--pz-promo-w', P.dialogWidth + 'px');
    set('--pz-promo-r', P.dialogRadius + 'px');
    set('--pz-promo-pad', P.dialogPadding + 'px');
    set('--pz-promo-title-fs', P.titleSize + 'px');
    set('--pz-promo-title-mb', P.titleMarginBottom + 'px');
    set('--pz-promo-title-c', PALETTE.textPrimary);
    set('--pz-promo-gap', P.optionsGap + 'px');
    set('--pz-promo-opt-r', P.optionRadius + 'px');
    set('--pz-promo-opt-pad', P.optionPadding + 'px');
    set('--pz-promo-opt-gap', P.optionGap + 'px');
    set('--pz-promo-opt-fs', P.optionTextSize + 'px');
    set('--pz-promo-glyph', P.glyphSize + 'px');
  }

  // ---- Typography ---------------------------------------------------------------------------
  var TYPE = {
    hubTitle: 18, hubHeroTitle: 19, hubHeroSub: 13, hubBackIcon: 24,
    hubCardTitle: 14, hubCardSub: 11, hubBadge: 9, hubChevron: 22, hubEmoji: 22,
    homeTitle: 18, homeBadge: 11, homeHeroTitle: 14, homeHeroSub: 11,
    homeHeroEmoji: 28, homeStatIcon: 14, homeStatLabel: 9,
    homeInfo: 11, homeShare: 14, homePlay: 17, homeEmpty: 13,
    solverBackIcon: 24, solverInfoStrip: 13, solverStatLabel: 11, solverStatValue: 16,
    solverRatingDelta: 11, solverButton: 15, solverLoading: 16,
    dailyTitle: 20, dailyHeroTitle: 20, dailyHeroSub: 13, dailyStart: 18,
    dailySolvedTitle: 20, dailySolverTitle: 18, dailySolverSub: 12,
    dailyFeedback: 16, dailyInstruction: 15, dailyDone: 16,
    thematicTitle: 20, thematicBadge: 13, thematicSection: 14, thematicCard: 13,
    thematicStart: 16, thematicSolverTitle: 18, thematicSolverSub: 12,
    streakTitle: 18, streakBadge: 11, streakSolverBack: 28, streakCounter: 34,
    turboTitle: 18, turboBadge: 11, turboQuit: 15, turboTimer: 34,
  };

  // ---- Strings (Part 19) — verbatim, so nothing gets paraphrased -----------------------------
  var STR = {
    hubTitle: 'Puzzle Hub',
    turboBolt: '\u26A1',
    turboLifeSpent: '\u274C',
    turboLifeLeft: '\u26AA',
    turboFeedbackOk: '\u2713',
    turboFeedbackBad: '\u2715',

    // Glyphs and formatting shared by the run screens. Their Swift twins keep the view bodies
    // literal-free; here they keep the two tables the same shape, which the parity check requires.
    streakTrophy: '\u{1F3C6}',
    streakFlame: '\u{1F525}',
    streakPawn: '\u265F',
    infinity: '\u221E',
    streakRunScore: function (n) { return '\u{1F525} ' + n; },
    turboRunScore: function (n) { return '\u26A1 ' + n; },
    turboRunMistakes: function (n) { return '\u274C ' + n; },
    today: 'Today',
    yesterday: 'Yesterday',
    runDateFormat: 'MMM d',
    moveArrow: ' \u2192 ',
    promotionSuffixOpen: ' (=',
    promotionSuffixClose: ')',

    // The source draws a knight IMAGE here; both twins substitute the glyph.
    hubHeroGlyph: '♞',
    // <chess-board> keeps its own copy as a fallback because it is standalone and imports
    // nothing; `puzzle_screen_test.js` asserts the two agree.
    promotionTitle: 'Choose Promotion',
    hubHeroTitle: 'Choose Your Mode!',
    hubHeroSub: 'Train your tactics your way 💪',
    goalTitle: 'Daily Goal',
    goalProgress: function (n) { return n + ' of 10 solved today'; },
    goalComplete: 'Goal complete — nice work! 🎉',
    goalStreak: function (d) { return '🔥 ' + d + 'd'; },

    homeTitle: 'Play Puzzles',
    homeBadge: '♟️ RATED',
    homeHeroTitle: 'Rated Puzzle Mode',
    homeHeroSub: 'Solve puzzles · Earn ELO · Climb the ranks',
    homeStats: [{ icon: '⭐', label: 'ELO' }, { icon: '🧩', label: 'Rated' },
                { icon: '📈', label: 'Track' }],
    homeInfo: 'Correct solve = +ELO · Wrong move = −ELO · Rating range: ±100',
    homeShare: '📤 Share My Rating',
    homePlay: '♟️ Play Puzzles',
    currentRating: 'Current Rating', best: 'Best', accuracy: 'Accuracy',
    solvedOf: function (s, a) { return s + ' of ' + a + ' solved'; },
    activity: 'Activity — Last 7 Days', themePerformance: 'Theme Performance',
    // The day-one state, agreed rather than specified: the rating card always renders, and the
    // four data-driven cards collapse into this one line until there is something to show.
    statsEmpty: 'Solve your first puzzle to start tracking your stats.',
    shareText: function (rating) {
      return 'Check out my chess puzzle stats on Biyaherong Chess Coach! ♟️\n'
           + 'My puzzle rating: ⭐ ' + rating + '\n#BiyaherongChess #ChessPH';
    },

    loading: 'Loading puzzle...',
    whiteToMove: '♙ White to Move', blackToMove: '♟ Black to Move',
    solved: '✅ Solved!', wrongMove: '❌ Wrong move!', viewingSolution: '💡 Viewing Solution',
    yourRating: 'Your Rating', clock: '⏱', puzzle: 'Puzzle', noTime: '--:--',
    solution: 'Solution', nextPuzzle: 'Next Puzzle →', retry: '🔄 Retry',
    solutionBtn: '💡 Solution',
    analyzing: '⏳ Analyzing...', engineSuggestions: '💡 Engine Suggestions', refresh: '↻',
    savePuzzle: '💾 Save Puzzle', savedToBoard: '✅ Saved to Analysis Board',
    choosePromotion: 'Choose Promotion',
    saveName: 'Name', saveNamePlaceholder: 'Puzzle name...',
    saveNotes: 'Notes (optional)', saveNotesPlaceholder: 'Themes, rating, notes...',
    cancel: 'Cancel', save: 'Save',

    // Daily (Part 19)
    dailyTitle: 'Daily Puzzle',
    dailyHeroTitle: "Today's Challenge",
    // The original read "powered by Chess.com", which is now false.
    dailyHeroSub: 'A new puzzle every day — always offline',
    dailyStreakLabel: 'Day Streak', dailyTotalLabel: 'Total Solved',
    dailyHowTitle: 'How it works',
    dailyHowBody: "Solve today's puzzle to keep your streak alive. Miss a day and it resets to "
      + 'zero. Come back every day to build your longest streak!',
    dailyStart: "🧩 Solve Today's Puzzle",
    dailySolvedTitle: 'Puzzle Solved!',
    dailySolvedSub: "Come back tomorrow — today's puzzle is already solved.",
    dailyLoading: "Loading today's puzzle...",
    dailyWin: '🏆 Puzzle Solved! Streak updated!',
    dailyMiss: '✗ Not the right move — try again!',
    dailyWhite: 'White ♙ to move', dailyBlack: 'Black ♟ to move',
    dailyDone: '← Back to Daily Puzzle',

    // Thematic (Part 19)
    thematicTitle: 'Thematic Puzzles',
    thematicBadge: '🎯 THEMED TRAINING',
    thematicChoose: 'Choose a Theme',
    thematicSelectPrompt: 'Select a Theme',
    thematicStart: function (label) { return 'Start ' + label + ' Puzzles'; },
    thematicSolved: function (n) { return 'Solved: ' + n; },
    thematicRating: 'Puzzle Rating',
    thematicHintWhite: '♙ You play White — Find the best move!',
    thematicHintBlack: '♟ You play Black — Find the best move!',
    thematicWin: '✅ Puzzle Solved!',
    thematicMiss: '❌ Wrong move!',
    thematicDry: 'All puzzles solved for this theme!',

    // Streak (Part 19)
    streakTitle: 'Puzzle Streak',
    streakBadge: '🔥 STREAK',
    streakCurrent: 'Current Streak',
    streakOneMistake: 'One mistake ends it!',
    streakBest: 'Best', streakCurrentShort: 'Current', streakNoTimer: 'No Timer',
    streakRecent: '🔥 Recent Runs',
    streakEmpty: 'No runs yet — start your first streak! 🔥',
    streakStart: '🔥 Start Streak',
    streakResumeStart: '🔥 Resume / New Streak',
    streakResumeTitle: 'Resume Session?',
    streakResumeBody: function (n) {
      return 'You have an unfinished streak (🔥 ' + n
        + ' solved). Continue where you left off or start fresh?';
    },
    streakNewGame: 'New Game', streakContinue: 'Continue',
    streakLoading: 'Loading puzzle...',
    streakStatStreak: 'Streak', streakStatBest: 'Best',
    streakGameOver: 'Game Over',
    streakBestLine: function (n) { return 'Best: ' + n; },
    streakNewBest: '🏆 NEW BEST!',
    streakShowSolution: '💡 Show Solution',
    streakPlayAgain: '🔄 Play Again',
    streakBackToMenu: '← Back to Menu',
    streakCorrectMove: 'Correct move:',
    streakStripMenu: 'Menu', streakStripPlayAgain: 'Play Again',
    streakHint: function (white) {
      return white ? '♙ You play White — Find the best move!'
                   : '♟ You play Black — Find the best move!';
    },

    // Turbo (Part 19)
    turboTitle: 'Puzzle Turbo',
    turboBadge: '⚡ RUSH',
    turboInfo: 'Solve as many puzzles as you can!',
    turboMistakes: '3 mistakes = game over',
    turboSelectMode: 'SELECT MODE',
    turboBest: function (n) { return 'Best: ' + n; },
    turboRecent: function (label) { return '🏆 ' + label + ' Runs'; },
    turboEmpty: 'No runs yet — be the first! ⚡',
    turboStart: function (minutes) {
      return minutes === 0 ? '⚡ Start Rush (Infinite)' : '⚡ Start Rush (' + minutes + ' min)';
    },
    turboResumeTitle: 'Resume Session?',
    turboResumeBody: function (score, mistakes) {
      return 'You have a previous session (Score: ' + score + ', Mistakes: ' + mistakes
        + '/3). Resume or start fresh?';
    },
    turboNewSession: 'New Session', turboResume: 'Resume',
    turboLoading: 'Loading puzzles...',
    turboQuit: 'Quit', turboScore: 'Score', turboMode: 'Mode',
    turboWhite: '♙ White to move', turboBlack: '♟ Black to move',
    turboSolved: 'Puzzles Solved',
    turboMistakeCount: function (n) {
      return '❌ ' + n + ' mistake' + (n === 1 ? '' : 's');
    },
    turboModeLine: function (minutes) {
      return minutes === 0 ? '∞ Infinite mode' : '⏱️ ' + minutes + ' min mode';
    },
    turboBack: '← Back to Puzzle Turbo',
    turboQuitTitle: 'Quit Puzzle Turbo?',
    turboQuitBody: 'Your current run will be lost.',
    turboKeepPlaying: 'Keep Playing',
  };

  // ---- Derived, pure ---------------------------------------------------------------------
  /** `MM:SS`, zero-padded, minutes uncapped — the source's own `formatTime`. */
  function formatTime(seconds) {
    if (seconds == null || seconds < 0) return STR.noTime;
    var m = Math.floor(seconds / 60), s = seconds % 60;
    return (m < 10 ? '0' + m : String(m)) + ':' + (s < 10 ? '0' + s : String(s));
  }

  /**
   * The info strip as ONE state, not four booleans (spec fix #11).
   *
   * The original evaluates four independent conditions, so "✅ Solved!" and "💡 Viewing Solution"
   * can both render inside a 34pt strip. `phase` and `solutionShown` collapse to a single row.
   */
  function infoStrip(phase, opts) {
    opts = opts || {};
    if (phase === 'reviewing') {
      return { state: 'solution', text: STR.viewingSolution, color: PALETTE.gold };
    }
    if (phase === 'solved') {
      var t = STR.solved;
      // Two spaces before the clock — the source's own spacing.
      if (opts.solveTimeSeconds != null) t += '  ⏱ ' + formatTime(opts.solveTimeSeconds);
      return { state: 'solved', text: t, color: PALETTE.correct };
    }
    if (phase === 'failed') {
      return { state: 'wrong', text: STR.wrongMove, color: PALETTE.wrong };
    }
    return {
      state: 'playing',
      text: opts.userIsWhite ? STR.whiteToMove : STR.blackToMove,
      color: PALETTE.textSecondary,
    };
  }

  /**
   * The bottom-panel states (Part 10.2 band 5). Playing is deliberately empty.
   *
   * Takes the MODE, not just the phase. Written phase-only for Play, it returned
   * `['retry','solutionBtn','next']` on `failed` for every mode — which flatly contradicts
   * `WRONG_POLICY.streak.offersRetry === false` and `.turbo.offersRetry === false`. Streak ends
   * the run on a wrong move and Turbo moves straight to the next puzzle; neither offers a Retry.
   * Two sources of truth for the same fact, and the wrong one was the visible one.
   *
   * The wrong-move row is now derived from the policy rather than restated, so the two cannot
   * drift again.
   */
  function bottomPanel(phase, mode) {
    var policy = WRONG_POLICY[mode || 'play'];
    if (phase === 'solved') {
      // Only the modes with an engine panel offer to open it (Part 18: Play and Thematic).
      return { buttons: hasEnginePanel(mode) ? ['solution', 'next'] : ['next'], row: false };
    }
    if (phase === 'failed') {
      if (!policy.offersRetry) return { buttons: [], row: false };   // streak, turbo
      var btns = ['retry'];
      if (hasEnginePanel(mode)) btns.push('solutionBtn');
      btns.push('next');
      return { buttons: btns, row: btns.length > 2 };
    }
    if (phase === 'reviewing') {
      var r = ['engine'];
      if (hasSaveSheet(mode)) r.push('save');
      r.push('next');
      return { buttons: r, row: false };
    }
    return { buttons: [], row: false };
  }

  /**
   * Which screens have an engine panel and a Save sheet at all.
   *
   * Not a preference: `puzzle_styles.json` shows `enginePanel*` keys only on `playSolver` and
   * `thematicSolver`, and `savePuzzle*` only on `playSolver`. Daily, Streak and Turbo genuinely
   * do not have them, so offering the buttons would be inventing UI.
   */
  function hasEnginePanel(mode) { return mode === 'play' || mode === 'thematic' || mode == null; }
  function hasSaveSheet(mode) { return mode === 'play' || mode == null; }

  /** How many engine lines a mode shows (Part 18): Play 2, Thematic 3. */
  function engineLineCount(mode) {
    return mode === 'thematic' ? ENGINE.thematicLines : ENGINE.playLines;
  }

  /** A rating delta's colour and sign. */
  function deltaStyle(change) {
    if (change == null) return null;
    return {
      text: (change >= 0 ? '+' : '') + change,
      color: change >= 0 ? PALETTE.correct : PALETTE.wrong,
    };
  }

  // ---- Self-tests -------------------------------------------------------------------------

  function harness() {
    var passed = 0, failures = [];
    return {
      expect: function (c, w) { c ? passed++ : failures.push(w); },
      done: function (label) {
        return {
          passed: passed, failures: failures, ok: failures.length === 0,
          summary: failures.length === 0
            ? label + ': ' + passed + ' assertions passed'
            : label + ': ' + passed + ' passed, ' + failures.length + ' FAILED\n'
              + failures.map(function (x) { return '  ✗ ' + x; }).join('\n'),
        };
      },
    };
  }

  function selfTest() {
    var h = harness();
    var e = h.expect;

    // formatTime
    e(formatTime(0) === '00:00', 'zero is 00:00');
    e(formatTime(9) === '00:09', 'seconds pad');
    e(formatTime(59) === '00:59', '59s');
    e(formatTime(60) === '01:00', 'one minute');
    e(formatTime(605) === '10:05', 'ten minutes five');
    e(formatTime(3600) === '60:00', 'minutes are uncapped, not wrapped to hours');
    e(formatTime(null) === '--:--', 'no clock yet');
    e(formatTime(-1) === '--:--', 'a negative is not a time');

    // The info strip is one state
    e(infoStrip('playing', { userIsWhite: true }).text === STR.whiteToMove, 'white to move');
    e(infoStrip('playing', { userIsWhite: false }).text === STR.blackToMove, 'black to move');
    e(infoStrip('playing', {}).color === PALETTE.textSecondary, 'playing is muted');
    e(infoStrip('solved', {}).text === '✅ Solved!', 'solved with no time');
    e(infoStrip('solved', { solveTimeSeconds: 65 }).text === '✅ Solved!  ⏱ 01:05',
      'solved with a time, two spaces before the clock');
    e(infoStrip('solved', {}).color === PALETTE.correct, 'solved is green');
    e(infoStrip('failed', {}).text === STR.wrongMove, 'wrong');
    e(infoStrip('failed', {}).color === PALETTE.wrong, 'wrong is red');
    e(infoStrip('reviewing', {}).text === STR.viewingSolution, 'viewing solution');
    e(infoStrip('reviewing', {}).color === PALETTE.gold, 'solution is gold');
    // The fix itself: reviewing wins outright, so the two can never render together.
    e(infoStrip('reviewing', { solveTimeSeconds: 30 }).state === 'solution',
      'solution and solved cannot both render — spec fix #11');
    var states = ['playing', 'solved', 'failed', 'reviewing'].map(function (p) {
      return infoStrip(p, {}).state;
    });
    e(new Set(states).size === 4, 'every phase maps to a distinct strip state');

    // Bottom panel — per mode, and derived from the wrong-move policy rather than restated
    e(bottomPanel('playing', 'play').buttons.length === 0,
      'no buttons at all while solving — this is deliberate');
    e(bottomPanel('solved', 'play').buttons.join(',') === 'solution,next',
      'Play, solved: Solution + Next');
    e(bottomPanel('failed', 'play').row === true, 'Play, wrong: Retry and Solution in a row');
    e(bottomPanel('failed', 'play').buttons.indexOf('retry') === 0, 'Retry comes first');
    e(bottomPanel('reviewing', 'play').buttons.indexOf('engine') === 0,
      'reviewing leads with the engine');
    e(bottomPanel('reviewing', 'play').buttons.indexOf('save') > 0, 'and offers Save Puzzle');
    // The bug this signature exists to prevent: Streak and Turbo forbid a Retry, and the
    // phase-only version offered one to every mode.
    for (var _m = 0; _m < MODES.length; _m++) {
      var mm = MODES[_m];
      var wrongPlan = bottomPanel('failed', mm);
      e(wrongPlan.buttons.indexOf('retry') >= 0 === WRONG_POLICY[mm].offersRetry,
        '[' + mm + '] the wrong-move Retry matches WRONG_POLICY.offersRetry');
    }
    e(bottomPanel('failed', 'streak').buttons.length === 0,
      'Streak offers nothing on a wrong move — the run is over');
    e(bottomPanel('failed', 'turbo').buttons.length === 0,
      'Turbo offers nothing either — the next puzzle mounts in 500ms');
    e(bottomPanel('failed', 'daily').buttons.indexOf('retry') === 0,
      'Daily does offer Retry');
    // Only Play and Thematic have an engine panel at all; only Play has a Save sheet. Both are
    // facts about the extracted StyleSheets, not preferences.
    e(hasEnginePanel('play') && hasEnginePanel('thematic'), 'Play and Thematic have an engine panel');
    e(!hasEnginePanel('daily') && !hasEnginePanel('streak') && !hasEnginePanel('turbo'),
      'Daily, Streak and Turbo do not — their StyleSheets have no enginePanel keys');
    e(hasSaveSheet('play') && !hasSaveSheet('thematic'), 'only Play has the Save sheet');
    e(bottomPanel('failed', 'daily').buttons.indexOf('solutionBtn') < 0,
      'so Daily`s wrong state offers no Solution button');
    e(bottomPanel('solved', 'streak').buttons.join(',') === 'next',
      'and Streak`s solved state is just Next');
    e(engineLineCount('play') === 2 && engineLineCount('thematic') === 3,
      'Play shows 2 engine lines, Thematic 3');

    // The promotion scrim is not one value
    e(PROMOTION.scrimFor('play') === PROMOTION.scrim, 'Play dims to 0.80');
    e(PROMOTION.scrimFor('daily') === PROMOTION.scrim, 'so do Daily');
    e(PROMOTION.scrimFor('thematic') === PROMOTION.scrim, 'and Thematic');
    e(PROMOTION.scrimFor('streak') === PROMOTION.scrimIntense, 'Streak dims to 0.82');
    e(PROMOTION.scrimFor('turbo') === PROMOTION.scrimIntense, 'and so does Turbo');
    e(PROMOTION.scrim !== PROMOTION.scrimIntense, 'the two really are different');

    // Delta
    e(deltaStyle(14).text === '+14' && deltaStyle(14).color === PALETTE.correct, 'a gain is green');
    e(deltaStyle(-11).text === '-11' && deltaStyle(-11).color === PALETTE.wrong, 'a loss is red');
    e(deltaStyle(0).text === '+0' && deltaStyle(0).color === PALETTE.correct, 'zero reads as a gain');
    e(deltaStyle(null) === null, 'no result, no delta');

    // Accuracy thresholds — descending, so a boundary lands in the better band
    e(accuracyColor(100) === PALETTE.correct, '100% is green');
    e(accuracyColor(80) === PALETTE.correct, '80 exactly is green');
    e(accuracyColor(79.9) === PALETTE.gold, 'just under 80 is gold');
    e(accuracyColor(60) === PALETTE.gold, '60 exactly is gold');
    e(accuracyColor(59.9) === PALETTE.wrong, 'just under 60 is red');
    e(accuracyColor(0) === PALETTE.wrong, 'zero is red');

    // The hub's five cards
    e(HUB_MODES.length === 5, 'five hub cards');
    e(HUB_MODES.map(function (m) { return m.id; }).join(',') === 'play,daily,thematic,turbo,streak',
      'in Part 9.2 order');
    e(new Set(HUB_MODES.map(function (m) { return m.color; })).size === 5,
      'each card has its own accent');
    // The unification fix: three of them deliberately differ from what the source had.
    var differ = HUB_MODES.filter(function (m) { return HUB_SOURCE_COLORS[m.id] !== m.color; });
    e(differ.length === 3, 'exactly three accents are unified onto the screen colours');
    e(differ.map(function (m) { return m.id; }).sort().join(',') === 'streak,thematic,turbo',
      'and they are Thematic, Turbo and Streak — spec fix 9.2(a)');
    e(HUB_MODES[3].title === 'Puzzle Turbo',
      'the fourth card is Turbo, never "Rush" — spec fix 9.2(b)');
    e(STR.hubHeroSub.indexOf('💪') > 0, 'the hero subtitle keeps its emoji');

    // Alpha bytes, not rounded percentages
    e(tint('#8E24AA', TINT_FILL) === '#8E24AA22', 'the tile fill concatenates the alpha byte');
    e(tint('#8E24AA', TINT_BORDER) === '#8E24AA55', 'and so does the border');
    e(Math.round(0x22 / 255 * 1000) / 10 === 13.3, '0x22 is 13.3%, which the spec rounds to 13');
    e(Math.round(0x55 / 255 * 1000) / 10 === 33.3, '0x55 is 33.3%, which the spec rounds to 33');

    // Engine panel
    e(ENGINE.playLines === 2 && ENGINE.thematicLines === 3,
      'Play shows 2 engine lines, Thematic 3');
    e(ENGINE.pvFrom === 1, 'the PV omits its first move — it is already the SAN column');

    // Promotion
    e(PROMOTION.order.join('') === 'qrbn', 'promotion order is q r b n');
    e(Object.keys(PROMOTION.labels).length === 4, 'four labels');
    e(PROMOTION.dialogWidth === 280, 'the dialog is a fixed 280 wide');
    e(Object.keys(PROMOTION.accent).length === 5, 'one accent per mode');

    // The Turbo clock's four bands, most-urgent first so a boundary lands in the louder one.
    e(turboTimerColor(null) === '#9C27B0', 'infinite is purple');
    e(turboTimerColor(180) === PALETTE.correct, 'plenty of time is green');
    e(turboTimerColor(31) === PALETTE.correct, 'just over 30 is still green');
    e(turboTimerColor(30) === PALETTE.gold, '30 exactly is already gold');
    e(turboTimerColor(11) === PALETTE.gold, 'just over 10 is gold');
    e(turboTimerColor(10) === '#FF4444', '10 exactly is already red');
    e(turboTimerColor(0) === '#FF4444', 'and zero is red');
    e(new Set([turboTimerColor(null), turboTimerColor(180), turboTimerColor(20),
               turboTimerColor(5)]).size === 4, 'the four bands are four distinct colours');

    // The feedback dot's two signs, kept apart on purpose.
    e(TURBO_FEEDBACK.leftSign === -1, 'left SUBTRACTS its radius term');
    e(TURBO_FEEDBACK.topSign === 1, 'and top ADDS its own — the asymmetry is real');
    e(TURBO_FEEDBACK.leftSign !== TURBO_FEEDBACK.topSign, 'so the two signs differ');
    e(TURBO_FEEDBACK.leftFactor !== TURBO_FEEDBACK.topFactor, 'as do their factors');
    e(TURBO_FEEDBACK.correctFill !== TURBO_FEEDBACK.wrongFill, 'and the two fills');

    // The three Turbo modes
    e(TURBO_MODES.length === 3, 'three Turbo modes');
    e(TURBO_MODES.map(function (m) { return m.minutes; }).join(',') === '0,3,5',
      'infinite, 3 and 5');
    e(TURBO_DEFAULT_MODE === 3, 'the default selection is 3 — not infinite');
    e(new Set(TURBO_MODES.map(function (m) { return m.color; })).size === 3,
      'each has its own colour');

    // Streak's two solution tints really are different, which is the point of the board change.
    e(STREAK_SOLVER.solutionFromTint !== STREAK_SOLVER.solutionToTint,
      'the revealed move is two-toned, so its direction reads at a glance');

    // Strings that carry logic
    e(STR.goalProgress(3) === '3 of 10 solved today', 'goal progress copy');
    e(STR.solvedOf(4, 9) === '4 of 9 solved', 'accuracy sub-line');
    e(STR.shareText(1234).indexOf('http') < 0,
      'the share text carries no URL — the hosted endpoints are gone');
    e(STR.shareText(1234).indexOf('1234') > 0, 'and does carry the rating');
    e(STR.turboMistakeCount(1) === '❌ 1 mistake', 'one mistake is singular');
    e(STR.turboMistakeCount(2) === '❌ 2 mistakes', 'two are plural');
    e(STR.turboMistakeCount(0) === '❌ 0 mistakes', 'and zero is plural');
    e(STR.turboStart(0) === '⚡ Start Rush (Infinite)', 'the infinite start label');
    e(STR.turboStart(3) === '⚡ Start Rush (3 min)', 'and the timed one');
    e(STR.turboModeLine(0) === '∞ Infinite mode', 'the infinite results line');
    e(STR.turboModeLine(5) === '⏱️ 5 min mode', 'and the timed one');
    e(STR.streakResumeBody(7).indexOf('7') > 0, 'the resume prompt names the streak');
    e(STR.turboResumeBody(9, 2).indexOf('9') > 0 && STR.turboResumeBody(9, 2).indexOf('2/3') > 0,
      'and Turbo`s names the score and the lives spent');

    return h.done('PuzzleMetrics');
  }

  /**
   * Assert every encoded constant against the AST extraction of the real StyleSheets.
   *
   * This is the assertion that makes the layer oracle-tested rather than eyeballed. `GOAL` and
   * `STATS` are exempt and say so: they are new design with no RN source.
   */
  function selfTestSource(src) {
    var h = harness();
    var e = h.expect;
    var STORE_UI_THEMES = (isNode ? require('./puzzle-store.js') : BiyaPuzzleStore).UI_THEMES;

    function block(screen) { return src.screens[screen].styles; }
    function checker(screen) {
      var S = block(screen);
      return function (key, prop, mine, label) {
        var real = S[key] ? S[key][prop] : undefined;
        e(real === mine, (label || screen + '.' + key + '.' + prop)
          + ': encoded ' + JSON.stringify(mine) + ' != source ' + JSON.stringify(real));
      };
    }

    // ---- hub ------------------------------------------------------------------
    var hub = checker('hub');
    hub('container', 'backgroundColor', PALETTE.screenBg);
    hub('header', 'paddingHorizontal', HUB.headerPaddingH);
    hub('header', 'paddingVertical', HUB.headerPaddingV);
    hub('backButton', 'width', HUB.backBtnW);
    hub('backButton', 'height', HUB.backBtnH);
    hub('backIcon', 'fontSize', TYPE.hubBackIcon);
    hub('headerTitle', 'fontSize', TYPE.hubTitle);
    hub('hero', 'paddingTop', HUB.heroPaddingTop);
    hub('hero', 'paddingBottom', HUB.heroPaddingBottom);
    hub('hero', 'gap', HUB.heroGap);
    hub('heroGlow', 'width', HUB.heroGlowSize);
    hub('heroGlow', 'height', HUB.heroGlowSize);
    hub('heroGlow', 'borderRadius', HUB.heroGlowRadius);
    hub('heroGlow', 'borderWidth', HUB.heroGlowBorder);
    hub('heroGlow', 'backgroundColor', HUB.heroGlowFill);
    hub('heroGlow', 'borderColor', HUB.heroGlowBorderColor);
    hub('heroGlow', 'marginBottom', HUB.heroGlowMarginBottom);
    hub('heroTitle', 'fontSize', TYPE.hubHeroTitle);
    hub('heroSub', 'fontSize', TYPE.hubHeroSub);
    hub('heroSub', 'color', PALETTE.textSecondary);
    hub('cardsList', 'paddingHorizontal', HUB.cardsPaddingH);
    hub('cardsList', 'paddingBottom', HUB.cardsPaddingBottom);
    hub('cardsList', 'justifyContent', 'space-evenly');
    hub('modeCard', 'backgroundColor', PALETTE.card);
    hub('modeCard', 'borderRadius', HUB.cardRadius);
    hub('modeCard', 'paddingVertical', HUB.cardPaddingV);
    hub('modeCard', 'paddingHorizontal', HUB.cardPaddingH);
    hub('modeCard', 'borderLeftWidth', HUB.cardBorderLeft);
    hub('modeCard', 'gap', HUB.cardGap);
    hub('modeCard', 'shadowOpacity', HUB.cardShadowOpacity);
    hub('modeCard', 'shadowRadius', HUB.cardShadowRadius);
    hub('modeEmoji', 'width', HUB.tileSize);
    hub('modeEmoji', 'height', HUB.tileSize);
    hub('modeEmoji', 'borderRadius', HUB.tileRadius);
    hub('modeEmoji', 'borderWidth', HUB.tileBorder);
    hub('emojiText', 'fontSize', TYPE.hubEmoji);
    hub('modeTitle', 'fontSize', TYPE.hubCardTitle);
    hub('modeTitle', 'marginBottom', HUB.titleMarginBottom);
    hub('modeSubtitle', 'fontSize', TYPE.hubCardSub);
    hub('cardRight', 'gap', 4);
    hub('modeBadge', 'paddingHorizontal', HUB.badgePaddingH);
    hub('modeBadge', 'paddingVertical', HUB.badgePaddingV);
    hub('modeBadge', 'borderRadius', HUB.badgeRadius);
    hub('badgeText', 'fontSize', TYPE.hubBadge);
    hub('badgeText', 'letterSpacing', HUB.badgeLetterSpacing);
    hub('chevron', 'fontSize', TYPE.hubChevron);
    hub('chevron', 'lineHeight', HUB.chevronLineHeight);

    // The card copy and the SOURCE colours, from the module constant rather than from prose.
    var modes = src.screens.hub.moduleConstants.PUZZLE_MODES;
    e(Array.isArray(modes) && modes.length === 5, 'the source declares five modes');
    if (Array.isArray(modes)) {
      for (var i = 0; i < HUB_MODES.length; i++) {
        e(modes[i].title === HUB_MODES[i].title,
          'card ' + i + ' title: ' + HUB_MODES[i].title + ' != ' + modes[i].title);
        e(modes[i].subtitle === HUB_MODES[i].subtitle,
          'card ' + i + ' subtitle: ' + HUB_MODES[i].subtitle + ' != ' + modes[i].subtitle);
        e(modes[i].badge === HUB_MODES[i].badge,
          'card ' + i + ' badge: ' + HUB_MODES[i].badge + ' != ' + modes[i].badge);
        e(modes[i].emoji === HUB_MODES[i].emoji,
          'card ' + i + ' emoji: ' + HUB_MODES[i].emoji + ' != ' + modes[i].emoji);
        e(HUB_SOURCE_COLORS[HUB_MODES[i].id] === modes[i].color,
          'card ' + i + ' recorded source colour matches the source');
      }
    }
    // And the alpha-byte concat is really what the source does.
    var inl = src.screens.hub.inlineStyles;
    e(/\+ '22'/.test(inl["View[4].backgroundColor"] ? inl["View[4].backgroundColor"].text : ''),
      "the tile fill really is `mode.color + '22'`");
    e(/\+ '55'/.test(inl["View[4].borderColor"] ? inl["View[4].borderColor"].text : ''),
      "and the border really is `+ '55'`");

    // ---- play home -------------------------------------------------------------
    var home = checker('playHome');
    home('header', 'paddingHorizontal', PLAY_HOME.headerPaddingH);
    home('header', 'paddingTop', PLAY_HOME.headerPaddingTop);
    home('header', 'paddingBottom', PLAY_HOME.headerPaddingBottom);
    home('headerTitle', 'fontSize', TYPE.homeTitle);
    home('headerBadge', 'backgroundColor', PLAY_HOME.badgeFill);
    home('headerBadge', 'paddingHorizontal', PLAY_HOME.badgePaddingH);
    home('headerBadge', 'paddingVertical', PLAY_HOME.badgePaddingV);
    home('headerBadge', 'borderRadius', PLAY_HOME.badgeRadius);
    home('headerBadgeText', 'fontSize', TYPE.homeBadge);
    home('topSection', 'paddingHorizontal', PLAY_HOME.topPaddingH);
    home('topSection', 'gap', PLAY_HOME.topGap);
    home('hero', 'backgroundColor', PLAY_HOME.heroFill);
    home('hero', 'borderRadius', PLAY_HOME.heroRadius);
    home('hero', 'paddingHorizontal', PLAY_HOME.heroPaddingH);
    home('hero', 'paddingVertical', PLAY_HOME.heroPaddingV);
    home('hero', 'gap', PLAY_HOME.heroGap);
    home('hero', 'borderWidth', PLAY_HOME.heroBorder);
    home('hero', 'borderColor', PLAY_HOME.heroBorderColor);
    home('heroEmoji', 'fontSize', TYPE.homeHeroEmoji);
    home('heroTitle', 'fontSize', TYPE.homeHeroTitle);
    home('heroSub', 'fontSize', TYPE.homeHeroSub);
    home('heroSub', 'marginTop', PLAY_HOME.heroSubMarginTop);
    home('heroStatRow', 'backgroundColor', PLAY_HOME.statRowFill);
    home('heroStatRow', 'borderRadius', PLAY_HOME.statRowRadius);
    home('heroStatRow', 'paddingHorizontal', PLAY_HOME.statRowPaddingH);
    home('heroStatRow', 'paddingVertical', PLAY_HOME.statRowPaddingV);
    home('heroStat', 'paddingHorizontal', PLAY_HOME.statPaddingH);
    home('heroStatIcon', 'fontSize', TYPE.homeStatIcon);
    home('heroStatLabel', 'fontSize', TYPE.homeStatLabel);
    home('heroStatLabel', 'marginTop', PLAY_HOME.statLabelMarginTop);
    home('heroDivider', 'width', PLAY_HOME.dividerW);
    home('heroDivider', 'height', PLAY_HOME.dividerH);
    home('heroDivider', 'backgroundColor', PLAY_HOME.dividerColor);
    home('bottomSection', 'paddingHorizontal', PLAY_HOME.bottomPaddingH);
    home('bottomSection', 'paddingBottom', PLAY_HOME.bottomPaddingBottom);
    home('bottomSection', 'paddingTop', PLAY_HOME.bottomPaddingTop);
    home('bottomSection', 'gap', PLAY_HOME.bottomGap);
    home('infoStrip', 'backgroundColor', PLAY_HOME.infoFill);
    home('infoStrip', 'borderRadius', PLAY_HOME.infoRadius);
    home('infoStrip', 'paddingHorizontal', PLAY_HOME.infoPaddingH);
    home('infoStrip', 'paddingVertical', PLAY_HOME.infoPaddingV);
    home('infoStrip', 'borderColor', PLAY_HOME.infoBorderColor);
    home('infoText', 'fontSize', TYPE.homeInfo);
    home('infoText', 'lineHeight', PLAY_HOME.infoLineHeight);
    home('shareButton', 'backgroundColor', PLAY_HOME.shareFill);
    home('shareButton', 'borderRadius', PLAY_HOME.shareRadius);
    home('shareButton', 'paddingVertical', PLAY_HOME.sharePaddingV);
    home('shareButtonText', 'fontSize', TYPE.homeShare);
    home('playButton', 'backgroundColor', PLAY_HOME.playFill);
    home('playButton', 'borderRadius', PLAY_HOME.playRadius);
    home('playButton', 'paddingVertical', PLAY_HOME.playPaddingV);
    home('playButton', 'shadowOpacity', PLAY_HOME.playShadowOpacity);
    home('playButton', 'shadowRadius', PLAY_HOME.playShadowRadius);
    home('playButtonText', 'fontSize', TYPE.homePlay);
    home('emptyText', 'fontSize', TYPE.homeEmpty);

    // ---- solver ------------------------------------------------------------------
    var sol = checker('playSolver');
    sol('container', 'backgroundColor', PALETTE.screenBg);
    sol('header', 'paddingHorizontal', SOLVER.headerPaddingH);
    sol('header', 'paddingVertical', SOLVER.headerPaddingV);
    sol('backButton', 'width', SOLVER.backBtnW);
    sol('backButton', 'height', SOLVER.backBtnH);
    sol('backIcon', 'fontSize', SOLVER.backIconSize);
    sol('placeholder', 'width', SOLVER.spacerW);
    sol('loadingText', 'fontSize', TYPE.solverLoading);
    sol('loadingText', 'marginTop', SOLVER.loadingMarginTop);
    sol('infoStrip', 'height', SOLVER.infoStripHeight);
    sol('infoStrip', 'paddingHorizontal', SOLVER.infoStripPaddingH);
    sol('infoStrip', 'backgroundColor', SOLVER.infoStripFill);
    sol('infoStripText', 'fontSize', TYPE.solverInfoStrip);
    sol('infoStripActive', 'color', PALETTE.textSecondary);
    sol('infoStripCorrect', 'color', PALETTE.correct);
    sol('infoStripWrong', 'color', PALETTE.wrong);
    sol('infoStripSolution', 'color', PALETTE.gold);
    sol('statsRow', 'paddingVertical', SOLVER.statsPaddingV);
    sol('statsRow', 'paddingHorizontal', SOLVER.statsPaddingH);
    sol('statsRow', 'backgroundColor', SOLVER.statsFill);
    sol('statLabel', 'fontSize', TYPE.solverStatLabel);
    sol('statLabel', 'marginBottom', SOLVER.statLabelMarginBottom);
    sol('statValue', 'fontSize', TYPE.solverStatValue);
    sol('statValue', 'color', PALETTE.gold);
    sol('ratingDelta', 'fontSize', TYPE.solverRatingDelta);
    sol('ratingDelta', 'marginTop', SOLVER.ratingDeltaMarginTop);
    sol('timerValue', 'color', PALETTE.textPrimary);
    sol('bottomPanel', 'paddingHorizontal', SOLVER.bottomPaddingH);
    sol('bottomPanel', 'paddingTop', SOLVER.bottomPaddingTop);
    sol('wrongButtonRow', 'gap', SOLVER.wrongRowGap);
    sol('retryButton', 'backgroundColor', SOLVER.retryFill);
    sol('retryButton', 'borderRadius', SOLVER.retryRadius);
    sol('retryButton', 'paddingVertical', SOLVER.retryPaddingV);
    sol('retryButton', 'borderColor', SOLVER.retryBorderColor);
    sol('retryButtonText', 'fontSize', TYPE.solverButton);
    sol('solutionButton', 'backgroundColor', SOLVER.solutionFill);
    sol('solutionButton', 'borderRadius', SOLVER.solutionRadius);
    sol('solutionButton', 'paddingVertical', SOLVER.solutionPaddingV);
    sol('solutionButtonText', 'color', PALETTE.onGold);
    sol('nextPuzzleButton', 'backgroundColor', SOLVER.nextFill);
    sol('nextPuzzleButton', 'borderRadius', SOLVER.nextRadius);
    sol('nextPuzzleButton', 'paddingHorizontal', SOLVER.nextPaddingH);
    sol('nextPuzzleButton', 'paddingVertical', SOLVER.nextPaddingV);
    sol('nextPuzzleButton', 'marginBottom', SOLVER.nextMarginBottom);
    // ...and the inline top margin the spec DOES mention, which lives nowhere near the StyleSheet.
    var solInl = src.screens.playSolver.inlineStyles;
    var tops = Object.keys(solInl).filter(function (k) { return /\.marginTop$/.test(k); });
    e(tops.length === 3, 'three call sites add an inline top margin, got ' + tops.length);
    e(tops.every(function (k) {
      return (solInl[k].terms || []).some(function (t) { return t.value === SOLVER.nextMarginTop; });
    }), 'and each of them is ' + SOLVER.nextMarginTop);

    // Engine panel
    sol('enginePanel', 'backgroundColor', ENGINE.fill);
    sol('enginePanel', 'borderRadius', ENGINE.radius);
    sol('enginePanel', 'padding', ENGINE.padding);
    sol('enginePanel', 'borderColor', ENGINE.borderColor);
    sol('enginePanelHeader', 'marginBottom', ENGINE.headerMarginBottom);
    sol('enginePanelTitle', 'fontSize', ENGINE.titleSize);
    sol('enginePanelTitle', 'color', PALETTE.gold);
    sol('engineRefresh', 'fontSize', ENGINE.refreshSize);
    sol('engineLineRow', 'paddingVertical', ENGINE.rowPaddingV);
    sol('engineLineRow', 'gap', ENGINE.rowGap);
    sol('engineLineRow', 'borderBottomColor', ENGINE.rowBorderColor);
    sol('engineLineDot', 'fontSize', ENGINE.dotSize);
    sol('engineLineDot', 'width', ENGINE.dotWidth);
    sol('engineLineSan', 'fontSize', ENGINE.sanSize);
    sol('engineLineSan', 'width', ENGINE.sanWidth);
    sol('engineLineEval', 'fontSize', ENGINE.evalSize);
    sol('engineLineEval', 'width', ENGINE.evalWidth);
    sol('engineLineEval', 'color', PALETTE.engineEval);
    sol('engineLinePv', 'fontSize', ENGINE.pvSize);

    // Promotion
    sol('promotionOverlay', 'backgroundColor', PROMOTION.scrim);
    sol('promotionDialog', 'backgroundColor', PROMOTION.dialogFill);
    sol('promotionDialog', 'borderRadius', PROMOTION.dialogRadius);
    sol('promotionDialog', 'padding', PROMOTION.dialogPadding);
    sol('promotionDialog', 'width', PROMOTION.dialogWidth);
    sol('promotionTitle', 'fontSize', PROMOTION.titleSize);
    sol('promotionTitle', 'marginBottom', PROMOTION.titleMarginBottom);
    sol('promotionOptions', 'gap', PROMOTION.optionsGap);
    sol('promotionOption', 'backgroundColor', PROMOTION.accent.play);
    sol('promotionOption', 'borderRadius', PROMOTION.optionRadius);
    sol('promotionOption', 'padding', PROMOTION.optionPadding);
    sol('promotionOption', 'gap', PROMOTION.optionGap);
    sol('promotionOptionText', 'fontSize', PROMOTION.optionTextSize);

    // Save sheet
    sol('savePuzzleButton', 'backgroundColor', SAVE_SHEET.buttonFill);
    sol('savePuzzleButton', 'borderRadius', SAVE_SHEET.buttonRadius);
    sol('savePuzzleButton', 'paddingVertical', SAVE_SHEET.buttonPaddingV);
    sol('savePuzzleButton', 'marginTop', SAVE_SHEET.buttonMarginTop);
    sol('savePuzzleButton', 'borderColor', SAVE_SHEET.buttonBorderColor);
    sol('savePuzzleButtonSaved', 'borderColor', SAVE_SHEET.savedBorderColor);
    sol('savePuzzleButtonText', 'fontSize', SAVE_SHEET.buttonTextSize);
    sol('savePuzzleModal', 'backgroundColor', SAVE_SHEET.scrim);
    sol('savePuzzleModalCard', 'borderTopLeftRadius', SAVE_SHEET.cardRadiusTop);
    sol('savePuzzleModalCard', 'padding', SAVE_SHEET.cardPadding);
    sol('savePuzzleModalCard', 'paddingBottom', SAVE_SHEET.cardPaddingBottom);
    sol('savePuzzleModalTitle', 'fontSize', SAVE_SHEET.titleSize);
    sol('savePuzzleModalTitle', 'marginBottom', SAVE_SHEET.titleMarginBottom);
    sol('savePuzzleModalLabel', 'fontSize', SAVE_SHEET.labelSize);
    sol('savePuzzleModalLabel', 'marginBottom', SAVE_SHEET.labelMarginBottom);
    sol('savePuzzleModalInput', 'backgroundColor', SAVE_SHEET.inputFill);
    sol('savePuzzleModalInput', 'borderRadius', SAVE_SHEET.inputRadius);
    sol('savePuzzleModalInput', 'fontSize', SAVE_SHEET.inputSize);
    sol('savePuzzleModalInput', 'paddingHorizontal', SAVE_SHEET.inputPaddingH);
    sol('savePuzzleModalInput', 'paddingVertical', SAVE_SHEET.inputPaddingV);
    sol('savePuzzleModalRow', 'gap', SAVE_SHEET.rowGap);
    sol('savePuzzleModalRow', 'marginTop', SAVE_SHEET.rowMarginTop);
    sol('savePuzzleModalCancel', 'backgroundColor', SAVE_SHEET.cancelFill);
    sol('savePuzzleModalSave', 'backgroundColor', SAVE_SHEET.saveFill);
    sol('savePuzzleModalCancelText', 'fontSize', SAVE_SHEET.buttonRowTextSize);
    var minH = src.screens.playSolver.inlineStyles['TextInput[1].minHeight'];
    e(minH && (minH.terms || []).some(function (t) { return t.value === SAVE_SHEET.notesMinHeight; }),
      'the notes field really is minHeight ' + SAVE_SHEET.notesMinHeight);


    // ---- daily home ------------------------------------------------------------
    var dh = checker('dailyHome');
    dh('header', 'paddingHorizontal', DAILY_HOME.headerPaddingH);
    dh('header', 'paddingTop', DAILY_HOME.headerPaddingTop);
    dh('header', 'paddingBottom', DAILY_HOME.headerPaddingBottom);
    dh('headerTitle', 'fontSize', TYPE.dailyTitle);
    dh('content', 'paddingHorizontal', DAILY_HOME.contentPaddingH);
    dh('content', 'paddingBottom', DAILY_HOME.contentPaddingBottom);
    dh('hero', 'borderRadius', DAILY_HOME.heroRadius);
    dh('hero', 'padding', DAILY_HOME.heroPadding);
    dh('hero', 'marginBottom', DAILY_HOME.heroMarginBottom);
    dh('hero', 'borderColor', DAILY_HOME.heroBorderColor);
    dh('heroIcon', 'fontSize', DAILY_HOME.heroIconSize);
    dh('heroIcon', 'marginBottom', DAILY_HOME.heroIconMarginBottom);
    dh('heroTitle', 'fontSize', TYPE.dailyHeroTitle);
    dh('heroTitle', 'marginBottom', DAILY_HOME.heroTitleMarginBottom);
    dh('heroSub', 'fontSize', TYPE.dailyHeroSub);
    dh('statsRow', 'gap', DAILY_HOME.statsGap);
    dh('statsRow', 'marginBottom', DAILY_HOME.statsMarginBottom);
    dh('statCard', 'borderRadius', DAILY_HOME.statCardRadius);
    dh('statCard', 'padding', DAILY_HOME.statCardPadding);
    dh('statCard', 'gap', DAILY_HOME.statCardGap);
    dh('statCard', 'borderColor', DAILY_HOME.statCardBorderColor);
    dh('statEmoji', 'fontSize', DAILY_HOME.statEmojiSize);
    dh('statValue', 'fontSize', DAILY_HOME.statValueSize);
    dh('statLabel', 'fontSize', DAILY_HOME.statLabelSize);
    dh('infoCard', 'borderRadius', DAILY_HOME.infoRadius);
    dh('infoCard', 'padding', DAILY_HOME.infoPadding);
    dh('infoCard', 'marginBottom', DAILY_HOME.infoMarginBottom);
    dh('infoCard', 'borderColor', DAILY_HOME.infoBorderColor);
    dh('infoTitle', 'fontSize', DAILY_HOME.infoTitleSize);
    dh('infoTitle', 'color', PALETTE.dailyGreen);
    dh('infoTitle', 'marginBottom', DAILY_HOME.infoTitleMarginBottom);
    dh('infoText', 'fontSize', DAILY_HOME.infoTextSize);
    dh('infoText', 'lineHeight', DAILY_HOME.infoLineHeight);
    dh('startButton', 'backgroundColor', DAILY_HOME.startFill);
    dh('startButton', 'borderRadius', DAILY_HOME.startRadius);
    dh('startButton', 'paddingVertical', DAILY_HOME.startPaddingV);
    dh('startButton', 'shadowOpacity', DAILY_HOME.startShadowOpacity);
    dh('startButtonText', 'fontSize', TYPE.dailyStart);
    dh('solvedCard', 'borderRadius', DAILY_HOME.solvedRadius);
    dh('solvedCard', 'padding', DAILY_HOME.solvedPadding);
    dh('solvedCard', 'gap', DAILY_HOME.solvedGap);
    dh('solvedCard', 'borderColor', DAILY_HOME.solvedBorderColor);
    dh('solvedIcon', 'fontSize', DAILY_HOME.solvedIconSize);
    dh('solvedTitle', 'fontSize', TYPE.dailySolvedTitle);
    dh('solvedSub', 'lineHeight', DAILY_HOME.solvedSubLineHeight);

    // ---- daily solver ----------------------------------------------------------
    var ds = checker('dailySolver');
    ds('header', 'paddingHorizontal', DAILY_SOLVER.headerPaddingH);
    ds('header', 'paddingVertical', DAILY_SOLVER.headerPaddingV);
    ds('headerTitle', 'fontSize', TYPE.dailySolverTitle);
    ds('headerSub', 'fontSize', TYPE.dailySolverSub);
    ds('headerSub', 'marginTop', DAILY_SOLVER.headerSubMarginTop);
    ds('headerSub', 'maxWidth', DAILY_SOLVER.headerSubMaxWidth);
    ds('feedbackContainer', 'marginHorizontal', DAILY_SOLVER.feedbackMarginH);
    ds('feedbackContainer', 'borderRadius', DAILY_SOLVER.feedbackRadius);
    ds('feedbackContainer', 'padding', DAILY_SOLVER.feedbackPadding);
    ds('feedbackContainer', 'marginTop', DAILY_SOLVER.feedbackMarginTop);
    ds('feedbackContainer', 'gap', DAILY_SOLVER.feedbackGap);
    ds('feedbackSolved', 'backgroundColor', DAILY_SOLVER.feedbackSolvedFill);
    ds('feedbackSolved', 'borderColor', DAILY_SOLVER.feedbackSolvedBorder);
    ds('feedbackWrong', 'backgroundColor', DAILY_SOLVER.feedbackWrongFill);
    ds('feedbackWrong', 'borderColor', DAILY_SOLVER.feedbackWrongBorder);
    ds('feedbackIcon', 'fontSize', DAILY_SOLVER.feedbackIconSize);
    ds('feedbackText', 'fontSize', TYPE.dailyFeedback);
    ds('instructionContainer', 'paddingVertical', DAILY_SOLVER.instructionPaddingV);
    ds('instructionText', 'fontSize', TYPE.dailyInstruction);
    ds('doneButton', 'marginHorizontal', DAILY_SOLVER.doneMarginH);
    ds('doneButton', 'backgroundColor', DAILY_SOLVER.doneFill);
    ds('doneButton', 'borderRadius', DAILY_SOLVER.doneRadius);
    ds('doneButton', 'paddingVertical', DAILY_SOLVER.donePaddingV);
    ds('doneButton', 'marginTop', DAILY_SOLVER.doneMarginTop);
    ds('doneButtonText', 'fontSize', TYPE.dailyDone);
    ds('promotionOption', 'backgroundColor', PROMOTION.accent.daily);
    // The Chess.com credit link the spec deletes really is in the source; asserting it exists
    // keeps the deletion a decision rather than an oversight.
    e(src.screens.dailySolver.styles.creditText !== undefined,
      'the source has a Chess.com credit link, which Part 11.3 deletes');
    e(/api\.chess\.com/.test(src.screens.dailySolver.moduleConstants.CHESSCOM_API || ''),
      'and the hostname it pointed at, which Part 22.2 forbids anywhere in this feature');

    // ---- thematic grid ----------------------------------------------------------
    var tg = checker('thematicGrid');
    tg('header', 'paddingHorizontal', THEMATIC_GRID.headerPaddingH);
    tg('header', 'paddingTop', THEMATIC_GRID.headerPaddingTop);
    tg('header', 'paddingBottom', THEMATIC_GRID.headerPaddingBottom);
    tg('headerTitle', 'fontSize', TYPE.thematicTitle);
    tg('badgeRow', 'gap', THEMATIC_GRID.badgeRowGap);
    tg('badgeRow', 'marginBottom', THEMATIC_GRID.badgeRowMarginBottom);
    tg('badge', 'paddingHorizontal', THEMATIC_GRID.badgePaddingH);
    tg('badge', 'paddingVertical', THEMATIC_GRID.badgePaddingV);
    tg('badge', 'borderRadius', THEMATIC_GRID.badgeRadius);
    tg('badgeText', 'fontSize', TYPE.thematicBadge);
    tg('badgeText', 'letterSpacing', THEMATIC_GRID.badgeLetterSpacing);
    tg('sectionLabel', 'fontSize', TYPE.thematicSection);
    tg('sectionLabel', 'marginBottom', THEMATIC_GRID.sectionLabelMarginBottom);
    tg('sectionLabel', 'paddingHorizontal', THEMATIC_GRID.sectionLabelPaddingH);
    tg('grid', 'paddingHorizontal', THEMATIC_GRID.gridPaddingH);
    tg('grid', 'paddingBottom', THEMATIC_GRID.gridPaddingBottom);
    tg('grid', 'gap', THEMATIC_GRID.gridGap);
    tg('gridRow', 'gap', THEMATIC_GRID.gridRowGap);
    tg('themeCard', 'borderRadius', THEMATIC_GRID.cardRadius);
    tg('themeCard', 'borderWidth', THEMATIC_GRID.cardBorder);
    tg('themeCard', 'padding', THEMATIC_GRID.cardPadding);
    tg('themeLabel', 'fontSize', TYPE.thematicCard);
    tg('startButton', 'backgroundColor', THEMATIC_GRID.startFill);
    tg('startButton', 'borderRadius', THEMATIC_GRID.startRadius);
    tg('startButton', 'paddingVertical', THEMATIC_GRID.startPaddingV);
    tg('startButton', 'marginHorizontal', THEMATIC_GRID.startMarginH);
    tg('startButton', 'marginBottom', THEMATIC_GRID.startMarginBottom);
    tg('startButtonDisabled', 'backgroundColor', THEMATIC_GRID.startDisabledFill);
    tg('startButtonDisabled', 'opacity', THEMATIC_GRID.startDisabledOpacity);
    tg('startButtonText', 'fontSize', TYPE.thematicStart);
    // The premium gate the spec deletes is in the source; assert it was there, so the removal is
    // recorded rather than forgotten.
    e(src.screens.thematicGrid.styles.lockOverlay !== undefined,
      'the source has a premium lock overlay, which Part 12 deletes');

    // The twelve themes, from the source's own array — labels, code points and colours.
    var srcThemes = src.screens.thematicGrid.moduleConstants.THEMES;
    e(Array.isArray(srcThemes) && srcThemes.length === 12, 'the source declares twelve themes');
    if (Array.isArray(srcThemes)) {
      for (var ti = 0; ti < THEMES.length; ti++) {
        e(srcThemes[ti].id === THEMES[ti].id, 'theme ' + ti + ' id');
        e(srcThemes[ti].label === THEMES[ti].label,
          'theme ' + ti + ' label: ' + THEMES[ti].label + ' != ' + srcThemes[ti].label);
        e(srcThemes[ti].color === THEMES[ti].color, 'theme ' + ti + ' colour');
      }
      // The variation selectors the spec warns about, checked rather than trusted.
      e(THEMES[2].label.indexOf('️') > 0, '⚔️ Fork keeps its U+FE0F');
      e(THEMES[9].label.indexOf('️') > 0, '♟️ Mate in 1 keeps its U+FE0F');
      e(THEMES[10].label.indexOf('️') < 0, '♚ Mate in 2 has none, and must not gain one');
    }
    // The grid ids must be the same twelve the selector layer knows about.
    e(THEMES.map(function (t) { return t.id; }).join(',') === STORE_UI_THEMES.join(','),
      'the grid`s twelve ids match PuzzleSelection.uiThemes, in the same order');

    // ---- thematic solver ---------------------------------------------------------
    var ts = checker('thematicSolver');
    ts('header', 'paddingHorizontal', THEMATIC_SOLVER.headerPaddingH);
    ts('header', 'paddingVertical', THEMATIC_SOLVER.headerPaddingV);
    ts('headerTitle', 'fontSize', TYPE.thematicSolverTitle);
    ts('headerSub', 'fontSize', TYPE.thematicSolverSub);
    ts('headerSub', 'marginTop', THEMATIC_SOLVER.headerSubMarginTop);
    ts('statsBar', 'borderRadius', THEMATIC_SOLVER.statsRadius);
    ts('statsBar', 'padding', THEMATIC_SOLVER.statsPadding);
    ts('statsBar', 'marginHorizontal', THEMATIC_SOLVER.statsMarginH);
    ts('statsBar', 'marginTop', THEMATIC_SOLVER.statsMarginTop);
    ts('statsBar', 'marginBottom', THEMATIC_SOLVER.statsMarginBottom);
    ts('statsBar', 'shadowOpacity', THEMATIC_SOLVER.statsShadowOpacity);
    ts('statLabel', 'fontSize', THEMATIC_SOLVER.statLabelSize);
    ts('statLabel', 'marginBottom', THEMATIC_SOLVER.statLabelMarginBottom);
    ts('statLabel', 'letterSpacing', THEMATIC_SOLVER.statLabelLetterSpacing);
    ts('statValue', 'fontSize', THEMATIC_SOLVER.statValueSize);
    ts('feedbackContainer', 'marginHorizontal', THEMATIC_SOLVER.feedbackMarginH);
    ts('feedbackContainer', 'borderRadius', THEMATIC_SOLVER.feedbackRadius);
    ts('feedbackContainer', 'padding', THEMATIC_SOLVER.feedbackPadding);
    ts('feedbackContainer', 'marginBottom', THEMATIC_SOLVER.feedbackMarginBottom);
    ts('feedbackContainer', 'gap', THEMATIC_SOLVER.feedbackGap);
    ts('feedbackCorrect', 'backgroundColor', THEMATIC_SOLVER.feedbackCorrectFill);
    ts('feedbackCorrect', 'borderColor', THEMATIC_SOLVER.feedbackCorrectBorder);
    ts('feedbackWrong', 'backgroundColor', THEMATIC_SOLVER.feedbackWrongFill);
    ts('feedbackText', 'fontSize', THEMATIC_SOLVER.feedbackTextSize);
    ts('wrongButtonRow', 'gap', THEMATIC_SOLVER.wrongRowGap);
    ts('retryButton', 'backgroundColor', THEMATIC_SOLVER.retryFill);
    ts('retryButton', 'borderRadius', THEMATIC_SOLVER.retryRadius);
    ts('retryButton', 'paddingVertical', THEMATIC_SOLVER.retryPaddingV);
    ts('solutionButton', 'backgroundColor', THEMATIC_SOLVER.solutionFill);
    ts('nextPuzzleButton', 'marginTop', THEMATIC_SOLVER.nextMarginTop);
    ts('nextPuzzleButton', 'paddingHorizontal', THEMATIC_SOLVER.nextPaddingH);
    ts('retryButtonText', 'fontSize', THEMATIC_SOLVER.buttonTextSize);
    ts('enginePanel', 'padding', THEMATIC_SOLVER.enginePadding);
    ts('enginePanel', 'marginHorizontal', THEMATIC_SOLVER.engineMarginH);
    ts('enginePanel', 'marginTop', THEMATIC_SOLVER.engineMarginTop);
    ts('enginePanelHeader', 'marginBottom', THEMATIC_SOLVER.engineHeaderMarginBottom);
    ts('engineLineRow', 'paddingVertical', THEMATIC_SOLVER.engineRowPaddingV);
    ts('hintContainer', 'marginHorizontal', THEMATIC_SOLVER.hintMarginH);
    ts('hintContainer', 'paddingVertical', THEMATIC_SOLVER.hintPaddingV);
    ts('hintText', 'fontSize', THEMATIC_SOLVER.hintSize);
    ts('promotionOption', 'backgroundColor', PROMOTION.accent.thematic);
    // Thematic's engine panel really is roomier than Play's — asserted, because encoding one set
    // of numbers for both is the obvious shortcut and it would be wrong.
    e(src.screens.thematicSolver.styles.enginePanel.padding
        !== src.screens.playSolver.styles.enginePanel.padding,
      'Thematic`s engine panel has different padding from Play`s');
    e(src.screens.thematicSolver.styles.engineLineRow.paddingVertical
        !== src.screens.playSolver.styles.engineLineRow.paddingVertical,
      'and different row spacing');

    // ---- the header claim, disproven ----------------------------------------------
    // Part 1 says every screen shares one header. Assert the DISAGREEMENT, so that if someone
    // later "tidies" this into a single shared constant the suite objects.
    var hh = src.screens.hub.styles.header, sh = src.screens.playSolver.styles.header;
    var ph = src.screens.playHome.styles.header;
    e(hh.paddingVertical !== sh.paddingVertical,
      'the hub and the solver really do use different header padding');
    e(ph.paddingTop !== undefined && ph.paddingBottom !== undefined,
      'and the home uses asymmetric padding where the other two use one value');
    e(HUB.headerPaddingV !== SOLVER.headerPaddingV,
      'so the two are encoded separately, not as one "standard header"');

    // ---- the arrow overlay bug (spec fix #12) --------------------------------------
    // The source centres the overlay while the board is left-aligned. Pin the source's own text so
    // the fix stays traceable to the thing it fixes.
    var arrowWrap = src.screens.playSolver.renderConstants.renderArrowsOverlay;
    e(!!arrowWrap, 'the solver has a renderArrowsOverlay');
    if (arrowWrap && arrowWrap['View[0].style']) {
      e(/alignItems: 'center'/.test(arrowWrap['View[0].style'].text),
        'the source really does centre the arrow overlay — spec fix #12 aligns it to x = 0');
    }
    // ...and its geometry is the Analysis Board's, so BoardArrows is reusable rather than a copy.
    function ratio(name) {
      var d = arrowWrap && arrowWrap[name];
      var t = d && (d.terms || [])[0];
      return t ? t.ratio : undefined;
    }
    e(ratio('arrowWidth') === AMET.ARROW.strokeRatio,
      'the arrow stroke ratio matches the Analysis Board`s');
    e(ratio('headSize') === AMET.ARROW.headRatio, 'and so does the head ratio');

    // ---- the board is the same component --------------------------------------------
    e(src.geometry.BOARD_SIZE === AMET.boardSize(390, 3),
      'the puzzle screens size their board with the same formula');


    // ---- Sounds and delays, against the extraction (Part 16 / Part 17) --------------------
    //
    // These are behaviour rather than geometry, but they earn the same treatment for the same
    // reason: they were the last hand-typed values in the port, and three of the five screens had
    // the sound wiring wrong. `SoundManager.play` returns silently for an unknown name, so nothing
    // downstream can notice — the check has to be here, against the source.
    (function () {
      var snd = src.sound, hook = snd.hook;

      e(hook.keys.length === 4, 'the puzzle path has exactly four sounds, not six');
      e(SOUNDS.keys.join(',') === hook.keys.join(','),
        'the encoded keys are the source`s: ' + hook.keys.join(','));
      e(Object.keys(SOUNDS.file).join(',') === hook.keys.join(','),
        'and every key has an mp3 mapped');
      hook.keys.forEach(function (k) {
        e(!!hook.assets[SOUNDS.file[k]],
          k + ' maps to ' + SOUNDS.file[k] + '.mp3, which the hook really loads');
      });
      // Neither `check` nor `castling` is in the puzzle vocabulary. Both files exist and the Play
      // screen's SoundManager uses them, which is exactly why this needs saying out loud.
      e(hook.keys.indexOf('check') < 0 && hook.keys.indexOf('castling') < 0,
        'the puzzle path has no check or castle sound — that chain belongs to the Play screen');
      e(SOUNDS.captureFlags.join(',') === snd.hook.moveSoundFlags.join(','),
        'capture is flags c or e, verbatim');
      e(soundForMove(true) === 'capture' && soundForMove(false) === 'move',
        'and playMoveSound is exactly capture-or-move');

      // Every screen that makes a sound: the names it uses must all be real keys.
      var bs = snd.byScreen;
      Object.keys(bs).forEach(function (screen) {
        bs[screen].forEach(function (c) {
          if (c.call !== 'playSound') return;
          e(hook.keys.indexOf(c.key) >= 0,
            screen + ' plays "' + c.key + '", which is a real key');
        });
      });

      // Which modes chime on a SOLVE, read off the source rather than remembered.
      // The three one-puzzle modes each land their `gameOver` in a finish handler...
      var solveFn = { playSolver: 'handlePuzzleSolved', dailySolver: 'finishPuzzle' };
      Object.keys(solveFn).forEach(function (screen) {
        var got = bs[screen].filter(function (c) {
          return c.key === 'gameOver' && c.enclosing === solveFn[screen];
        });
        e(got.length === 1, screen + ' chimes on the solve, inside ' + solveFn[screen] + '()');
      });
      e(bs.thematicSolver.filter(function (c) { return c.key === 'gameOver'; }).length === 2,
        'thematic chimes from both of its solve branches — checkmate and last-move');

      // ...while Turbo's single `gameOver` is in the RUN-level handler, not a move handler. That
      // one line is the whole reason Turbo must not chime per puzzle.
      var turboOver = bs.turboRun.filter(function (c) { return c.key === 'gameOver'; });
      e(turboOver.length === 1 && turboOver[0].enclosing === 'endGame',
        'Turbo`s only gameOver is in endGame() — a run ending, not a solve');
      e(SOUNDS.chimeOnSolve.turbo === false && SOUNDS.chimeOnRunEnd.turbo === true,
        'which is what the encoded table says');
      // Streak's sits in `executeMove` like Turbo's move sounds do, so the enclosing name cannot
      // tell the branches apart. What IS mechanical: Streak has exactly one, and Play/Daily/
      // Thematic — the three that chime on a solve — each have theirs in a finish handler while
      // Streak's is not. The branch itself is recorded in PORTING_NOTES with a line reference.
      var streakOver = bs.streakSolver.filter(function (c) { return c.key === 'gameOver'; });
      e(streakOver.length === 1, 'Streak has exactly one gameOver');
      e(streakOver[0].enclosing !== 'handlePuzzleSolved'
        && streakOver[0].enclosing !== 'finishPuzzle',
        'and it is not in a solve handler');
      e(SOUNDS.chimeOnSolve.streak === false, 'so Streak does not chime on a solve');

      // Every mode starts with game-start. The one thing all five agree on.
      ['playSolver', 'dailySolver', 'thematicSolver', 'streakSolver', 'turboRun'].forEach(
        function (screen) {
          e(bs[screen].some(function (c) { return c.key === 'gameStart'; }),
            screen + ' plays gameStart on mount');
        });

      // ---- The timings (Part 17) -----------------------------------------------------------
      //
      // Asserted against the extracted call sites rather than merely written down. `msFor` looks
      // for a delay scheduling a given callee, so "the opponent replies after 500 ms" is checked
      // against the setTimeout that actually schedules the opponent.
      var TIMING = SESSION.TIMING;
      function msFor(screen, callee) {
        var rows = (src.delays.byScreen[screen] || []).filter(function (r) {
          return !r.abort && r.callee === callee;
        });
        e(rows.length > 0, screen + ' schedules ' + callee);
        var all = rows.map(function (r) { return r.ms; });
        e(new Set(all).size === 1,
          screen + '.' + callee + ' uses one delay throughout: ' + all.join('/'));
        return all[0];
      }
      var OPPONENT = { play: 'playSolver', daily: 'dailySolver', thematic: 'thematicSolver',
                       streak: 'streakSolver', turbo: 'turboRun' };
      Object.keys(OPPONENT).forEach(function (mode) {
        e(TIMING.opponentDelayMs[mode] === msFor(OPPONENT[mode], 'makeComputerMove'),
          mode + ' opponent reply: ' + TIMING.opponentDelayMs[mode] + 'ms');
      });
      // The two screens that also delay their FINISH do it by the same amount as their opponent
      // reply — which is why `solvedAfterMs` can reuse `opponentDelayMs` instead of a second table.
      e(msFor('playSolver', 'handlePuzzleSolved') === TIMING.opponentDelayMs.play,
        'play finishes after the same 500ms it uses for the opponent');
      e(msFor('dailySolver', 'finishPuzzle') === TIMING.opponentDelayMs.daily,
        'and daily after the same 400ms');
      e(TIMING.dailyWrongBannerMs === msFor('dailySolver', 'setShowFeedback'),
        'the daily banner lives 1300ms');
      e(TIMING.turboFeedbackMs === msFor('turboRun', 'setMoveResultFeedback'),
        'the Turbo feedback dot lives 500ms');
      e(TIMING.tickMs === msFor('turboRun', 'setTimeLeft'),
        'and the run clock ticks once a second');
      // Turbo advances on 500 and initial-loads on 300, both through `loadNextPuzzle`, so this one
      // cannot go through `msFor` — the two delays are genuinely different.
      var loads = src.delays.byScreen.turboRun.filter(function (r) {
        return r.callee === 'loadNextPuzzle';
      }).map(function (r) { return r.ms; });
      e(loads.indexOf(TIMING.turboAdvanceMs) >= 0,
        'Turbo advances to the next puzzle after ' + TIMING.turboAdvanceMs + 'ms');

      // No screen in the port may carry a network timeout, and the source has six.
      var aborts = 0;
      Object.keys(src.delays.byScreen).forEach(function (k) {
        aborts += src.delays.byScreen[k].filter(function (r) { return r.abort; }).length;
      });
      e(aborts > 0, 'the source has ' + aborts + ' network abort timeouts');
      e(TIMING.abortMs === undefined, 'and the port carries none of them');
    })();

    return h.done('PuzzleMetricsSource');
  }

  return {
    boardSize: boardSize, squareSize: squareSize, pieceSize: pieceSize,
    PALETTE: PALETTE, tint: tint, TINT_FILL: TINT_FILL, TINT_BORDER: TINT_BORDER,
    HUB: HUB, HUB_MODES: HUB_MODES, HUB_SOURCE_COLORS: HUB_SOURCE_COLORS,
    GOAL: GOAL, PLAY_HOME: PLAY_HOME, STATS: STATS, SOLVER: SOLVER,
    DAILY_HOME: DAILY_HOME, DAILY_SOLVER: DAILY_SOLVER,
    THEMATIC_GRID: THEMATIC_GRID, THEMATIC_SOLVER: THEMATIC_SOLVER, THEMES: THEMES,
    STREAK_HOME: STREAK_HOME, STREAK_SOLVER: STREAK_SOLVER,
    TURBO_HOME: TURBO_HOME, TURBO_RUN: TURBO_RUN, TURBO_MODES: TURBO_MODES,
    TURBO_DEFAULT_MODE: TURBO_DEFAULT_MODE, turboTimerColor: turboTimerColor,
    TURBO_FEEDBACK: TURBO_FEEDBACK,
    SOUNDS: SOUNDS, soundForMove: soundForMove, isRealSound: isRealSound,
    applyPromotion: applyPromotion,
    ENGINE: ENGINE, PROMOTION: PROMOTION, SAVE_SHEET: SAVE_SHEET,
    TYPE: TYPE, STR: STR,
    formatTime: formatTime, infoStrip: infoStrip, bottomPanel: bottomPanel,
    deltaStyle: deltaStyle, accuracyColor: accuracyColor,
    hasEnginePanel: hasEnginePanel, hasSaveSheet: hasSaveSheet,
    engineLineCount: engineLineCount,
    selfTest: selfTest, selfTestSource: selfTestSource,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleMetrics; }
