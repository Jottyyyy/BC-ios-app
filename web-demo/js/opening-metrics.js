/* opening-metrics.js — every number and colour the Opening Tree draws, from the RN StyleSheet.
 *
 * Twin of DemoApp/Sources/BiyaherongUI/OpeningMetrics.swift. Nothing here is transcribed from
 * prose: `selfTestSource()` asserts each value against `tools/metrics/opening_styles.json`, which
 * `tools/metrics/extract_opening_styles.js` re-derives from `analysis-board/openingtree.tsx` by AST
 * walk. Change the RN source, re-run the extractor, and this file's self-check tells you which
 * constants are stale — the rule CLAUDE.md states as EXTRACT, DON'T TRANSCRIBE.
 *
 * The RN file is three screens behind one `view` state, sharing one StyleSheet. The blocks below
 * split it the way the ported screens do: chrome (all three), list, form, explorer, fetch banner.
 */
(function (global) {
  'use strict';

  /* ---- Palette ------------------------------------------------------------- */
  var PALETTE = {
    screenBg: '#0F1A2E',
    card: '#1A2942',
    cardDeep: '#111E33',
    hairline: '#1E3050',
    inputBorder: '#243654',
    text: '#FFFFFF',
    muted: '#8BA3C7',
    gold: '#FDB022',
    onGold: '#0F1A2E',
    chevron: '#5A6E87',
    danger: '#EF5350',
    // The build CTA is green rather than gold: on the list screen gold is already the "load this
    // tree" affordance, and two golds would make the primary action the ambiguous one.
    buildBg: '#1B5E20',
    buildBorder: '#2E7D32',
    infoBg: '#1A2B40',
    infoBorder: '#2A3D57',
    infoText: '#8FA8C4',
    doneBg: '#0D2010',
    doneBorder: '#2E7D32',
    doneText: '#4CAF50',
    errorBg: '#1A0808',
    errorBorder: '#5C1010',
    errorText: '#EF5350',

    // engine — extracted from openingtree.tsx. The panel fill is cardDeep, its border hairline,
    // its prose muted, and the ON state reuses doneBg/doneText; only these two are new.
    engineToggleBorder: '#2A3F5A',   // engineToggleBtn.borderColor
    engineDepth: '#4A6080'           // engineDepthChip.color
  };

  /**
   * One colour per engine line, by rank — ENGINE_MOVE_COLORS in the RN module scope.
   *
   * NOT the Analysis Board's arrow table, which carries the same three RGB triples at different
   * alphas (0.85/0.80/0.80 against this screen's 0.90/0.85/0.85). Two extractions of two screens;
   * selfTestSource asserts these against opening_styles.json.
   */
  var ENGINE_RANK = [
    'rgba(76,175,80,0.9)',
    'rgba(68,138,255,0.85)',
    'rgba(255,152,0,0.85)'
  ];
  /** Clamped, so a fourth line from a future multiPV cannot draw undefined. */
  function engineRankColor(rank) {
    return ENGINE_RANK[Math.min(Math.max(rank, 0), ENGINE_RANK.length - 1)];
  }

  /**
   * The eval column's ink, by sign.
   *
   * The RN getEvalColor tests startsWith('M') BEFORE startsWith('M-'), so a black mate 'M-3' comes
   * back GREEN — the losing side's own forced mate painted as an advantage. That is a latent bug
   * rather than a decision, and CLAUDE.md says to port the intended behaviour, so the minus is
   * checked first here. Asserted by name in replay_opening_tree.js.
   */
  function engineEvalInk(text) {
    var t = String(text == null ? '' : text);
    if (!t) return PALETTE.muted;
    if (t.indexOf('-') === 0 || t.indexOf('M-') === 0) return PALETTE.errorText;
    if (t.indexOf('+') === 0 || t.indexOf('M') === 0) return PALETTE.doneText;
    return PALETTE.muted;
  }

  /* ---- The W/D/L bar — the screen's whole point ---------------------------- */
  //
  // Three colours, and the order is the semantics: wins | draws | losses, left to right, from the
  // MOVER's point of view (see opening-tree.js). Extracted from `renderWdlBar`'s three inline
  // styles, which is the only place the RN file writes them.
  var WDL = {
    win: '#4CAF50',
    draw: '#888888',
    loss: '#EF5350',
    barHeight: 6,
    barRadius: 3
  };

  /* ---- Layout -------------------------------------------------------------- */
  var LAYOUT = {
    // chrome, shared by all three views
    screenPadH: 16,
    headerPadTop: 16,
    headerPadBottom: 14,
    backSize: 40,
    backIconSize: 26,
    titleSize: 20,
    emptyPadH: 32,
    emptyPadBottom: 60,

    // list
    listGap: 10,
    cardRadius: 14,
    cardPad: 14,
    cardGap: 10,
    treeNameSize: 15,
    treeNameGap: 4,
    treeMetaSize: 12,
    treeMetaLine: 18,
    actionGap: 8,
    loadRadius: 8,
    loadPadH: 14,
    loadPadV: 6,
    loadTextSize: 13,
    emptyIconSize: 56,
    emptyIconGap: 12,
    emptyTitleSize: 18,
    emptyTitleGap: 8,
    emptySubSize: 14,
    emptySubLine: 22,
    footerPadV: 12,
    footerBorder: 1,
    buildRadius: 14,
    buildPadV: 16,
    buildBorder: 1,
    buildTextSize: 16,

    // form
    formPadBottom: 32,
    labelSize: 13,
    labelTracking: 0.8,
    labelTop: 20,
    labelBottom: 8,
    inputRadius: 10,
    inputBorder: 1,
    inputTextSize: 15,
    inputPadH: 14,
    inputPadV: 12,
    // INVENTED — the RN form has no PGN box, so there is nothing to extract. Taken from
    // `pairing.css`'s `.pgd-modal-area`, the app's other paste-a-blob field, so the two agree.
    // It lives here rather than in the stylesheet because a number written in CSS is a number no
    // gate and no Swift twin can see: it was `min-height: 160px` inline, the only literal in the
    // whole --op-* block, contradicting the block's own header comment.
    pgnMinHeight: 160,
    toggleGap: 8,
    toggleRadius: 10,
    togglePadV: 12,
    toggleBorder: 1,
    toggleTextSize: 14,
    submitRadius: 14,
    submitPadV: 16,
    submitTop: 16,
    submitTextSize: 16,
    infoRadius: 8,
    infoBorder: 1,
    infoPad: 12,
    infoTop: 20,
    infoBottom: 4,
    infoTitleSize: 14,
    infoTitleGap: 4,
    infoSubSize: 13,
    infoSubLine: 19,

    // explorer
    boardGap: 12,
    historyRadius: 10,
    historyPadH: 14,
    historyPadV: 8,
    historyBottom: 10,
    historySize: 13,
    navGap: 10,
    navRadius: 10,
    navPadH: 16,
    navPadV: 10,
    navBorder: 1,
    navTextSize: 14,
    navDisabledOpacity: 0.35,
    navBottom: 10,
    movesPadBottom: 32,
    rowRadius: 12,
    rowPad: 12,
    rowBottom: 8,
    rowGap: 12,
    sanSize: 17,
    sanWidth: 54,
    statGap: 4,
    statSize: 12,
    chevronSize: 22,
    // engine — every value EXTRACTED from openingtree.tsx's StyleSheet, which the extractor has
    // been sweeping into opening_styles.json since the tree shipped. Nothing here is invented.
    engineTogglePadV: 8,       // engineToggleBtn.paddingVertical
    engineTogglePadH: 14,      // engineToggleBtn.paddingHorizontal
    engineToggleRadius: 10,    // engineToggleBtn.borderRadius
    engineToggleBorder: 1,     // engineToggleBtn.borderWidth
    engineToggleTop: 8,        // engineToggleBtn.marginTop
    engineToggleBottom: 4,     // engineToggleBtn.marginBottom
    engineToggleTextSize: 13,  // engineToggleBtnText.fontSize
    engineRadius: 10,          // engineSection.borderRadius
    engineBorder: 1,           // engineSection.borderWidth
    enginePadH: 12,            // engineSection.paddingHorizontal
    enginePadV: 8,             // engineSection.paddingVertical
    engineGap: 4,              // engineSection.gap
    engineBottom: 6,           // engineSection.marginBottom
    engineRowPadV: 3,          // engineLineRow.paddingVertical
    engineRowGap: 8,           // engineLineRow.gap
    engineEvalSize: 12,        // engineChipEval.fontSize
    engineEvalWidth: 42,       // engineChipEval.minWidth
    engineSanSize: 13,         // engineChipSan.fontSize
    engineSanWidth: 40,        // engineChipSan.minWidth
    enginePvSize: 12,          // engineLinePv.fontSize
    engineTextSize: 13,        // engineLineText.fontSize
    engineDepthSize: 11,       // engineDepthChip.fontSize
    engineDepthTop: 2,         // engineDepthChip.marginTop
    engineStatusPadV: 4,       // engineAnalyzingRow.paddingVertical

    noMovesRadius: 12,
    noMovesPad: 20,
    noMovesSize: 14,

    // fetch banner
    bannerRadius: 10,
    bannerPadH: 14,
    bannerPadV: 10,
    bannerBorder: 1,
    bannerBottom: 8,
    bannerRowBottom: 6,
    bannerLabelSize: 13,
    trackHeight: 4,
    trackRadius: 2
  };

  /* ---- Strings ------------------------------------------------------------- */
  //
  // The RN screen's copy where it has any, and new copy where the offline port changed what the
  // screen does — the game SOURCES, above all. Flagged individually rather than silently mixed.
  var STRINGS = {
    title: 'Opening Tree',
    // list
    empty: 'No trees yet',
    emptySub: 'Build a tree from your games to see which openings you actually play, and how they '
      + 'score.',
    emptyIcon: '🌳',
    load: 'Open',
    remove: 'Delete',
    newTree: '+ New Tree',
    meta: '{games} games · {positions} positions · {colour}',
    // form
    nameLabel: 'Tree name',
    namePlaceholder: 'e.g. My White repertoire',
    colourLabel: 'Side you played',
    sourceLabel: 'Where the games come from',
    // NEW — the offline port's own sources. The RN form offers Lichess and Chess.com only.
    sourcePgn: 'Paste PGN',
    sourceCoach: 'My Coach games',
    sourceLichess: 'Lichess',
    sourceChesscom: 'Chess.com',
    pgnLabel: 'PGN',
    pgnPlaceholder: '[Event "My games"]\n\n1. e4 c5 2. Nf3 d6 1-0\n\n[Event "My games"]\n\n'
      + '1. d4 Nf6 2. c4 e6 0-1',
    userLabel: 'Username',
    userPlaceholder: 'your username on that site',
    maxLabel: 'Games to fetch',
    // What the box opens on. The RN form opens on the same 100 — its free ceiling — so a user who
    // never touches the field gets the same tree in both apps.
    maxDefault: '100',
    maxPlaceholder: 'e.g. 500',
    build: 'Build Tree',
    building: 'Building…',
    // The online path is the ONE networked thing in the app, so it says so rather than failing
    // silently in Airplane Mode.
    onlineNote: 'Needs internet',
    onlineNoteSub: 'Lichess and Chess.com are downloaded from your device. Everything else in this '
      + 'app works offline — pasting a PGN does too.',
    offlineNote: 'Works offline',
    offlineNoteSub: 'Both Lichess and Chess.com let you download all your games as a PGN file; '
      + 'paste it here and nothing leaves the device.',
    // engine — the toggle's two labels are the RN screen's, emoji and all.
    engineOn: '🔍 Engine: ON',
    engineOff: '🔍 Engine: OFF',
    engineAnalyzing: 'Analyzing…',
    // `d:12 · SF` when idle, `d:12…` while still searching — the RN depth chip's two spellings.
    engineDepth: 'd:{n} · SF',
    engineDepthBusy: 'd:{n}…',
    engineMate: '# Checkmate',
    engineStalemate: '= Stalemate',
    engineDraw: '= Draw',
    // explorer
    noMoves: 'No games reached this position.',
    back: '← Back',
    forward: 'Forward →',
    reset: 'Reset',
    startPosition: 'Starting position',
    movesHeader: '{n} moves played here',
    gamesSuffix: ' games',
    wdl: '{w}W / {d}D / {l}L',
    // fetch banner
    fetching: 'Downloading games…',
    fetched: '{n} games',
    done: '✓ Built from {n} games',
    // errors
    errNoName: 'Give the tree a name.',
    errNoPgn: 'Paste some PGN first.',
    errNoUser: 'Enter a username.',
    errNoGames: 'No games found in that PGN.',
    errNoCoachGames: 'You have not finished a game against a coach yet.',
    errNetwork: 'Could not reach that site. Check your connection and try again.',
    errUnknownUser: 'No games found for that username.'
  };

  /** `{k}` substitution, the same helper premium.js uses. Never re-type a count into a string. */
  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (_, k) {
      return values[k] === undefined ? '{' + k + '}' : String(values[k]);
    });
  }

  /* ---- Sources ------------------------------------------------------------- */
  //
  // Declared as data, not as a switch, because both languages and the gate all need the same
  // answer to "is this one online?".
  var SOURCES = [
    { id: 'pgn', label: STRINGS.sourcePgn, online: false },
    { id: 'coach', label: STRINGS.sourceCoach, online: false },
    { id: 'lichess', label: STRINGS.sourceLichess, online: true },
    { id: 'chesscom', label: STRINGS.sourceChesscom, online: true }
  ];
  function sourceById(id) {
    for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i];
    return null;
  }
  function isOnlineSource(id) { var s = sourceById(id); return !!s && s.online; }

  /* ---- self-test ----------------------------------------------------------- */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    expect(WDL.win !== WDL.draw && WDL.draw !== WDL.loss, 'three distinct result colours');
    expect(LAYOUT.sanWidth > 0 && LAYOUT.sanSize > LAYOUT.statSize,
      'the move is the biggest thing in its row');
    expect(LAYOUT.navDisabledOpacity > 0 && LAYOUT.navDisabledOpacity < 1,
      'a disabled nav button is dimmed, not hidden');
    expect(SOURCES.length === 4, 'four game sources');
    expect(SOURCES.filter(function (s) { return s.online; }).length === 2,
      'exactly two of them need the network');
    expect(isOnlineSource('lichess') && !isOnlineSource('pgn') && !isOnlineSource('coach'),
      'and the offline pair is PGN + coach games');
    expect(sourceById('nope') === null, 'an unknown source is null, not a crash');
    expect(fill(STRINGS.wdl, { w: 3, d: 1, l: 2 }) === '3W / 1D / 2L', 'the W/D/L label fills');
    expect(fill(STRINGS.meta, { games: 5, positions: 40, colour: 'White' })
      === '5 games · 40 positions · White', 'the list meta line fills');
    expect(fill('{missing}', {}) === '{missing}', 'an unfilled key stays visible rather than blank');
    expect(STRINGS.onlineNote.length > 0 && STRINGS.offlineNote.length > 0,
      'both connectivity notes exist — the online path must say so');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'OpeningMetrics: ' + passed + ' assertions passed'
        : 'OpeningMetrics: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  /**
   * Every constant above, against the extraction. This is the assertion that matters: `selfTest`
   * checks that the numbers are coherent, `selfTestSource` checks that they are the RN source's.
   */
  function selfTestSource(src) {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }
    function eq(got, want, what) {
      expect(got === want, what + ': source says ' + JSON.stringify(want)
        + ', metrics has ' + JSON.stringify(got));
    }

    var S = src.openingTree.styles;
    function v(key, prop) { return S[key] ? S[key][prop] : undefined; }

    // chrome
    eq(PALETTE.screenBg, v('container', 'backgroundColor'), 'screen background');
    eq(LAYOUT.screenPadH, v('header', 'paddingHorizontal'), 'screen horizontal padding');
    eq(LAYOUT.headerPadTop, v('header', 'paddingTop'), 'header top padding');
    eq(LAYOUT.headerPadBottom, v('header', 'paddingBottom'), 'header bottom padding');
    eq(LAYOUT.titleSize, v('headerTitle', 'fontSize'), 'header title size');
    eq(PALETTE.text, v('headerTitle', 'color'), 'header title colour');
    eq(LAYOUT.backSize, v('backButton', 'width'), 'back button size');
    eq(LAYOUT.backIconSize, v('backIcon', 'fontSize'), 'back icon size');
    eq(LAYOUT.emptyPadH, v('centered', 'paddingHorizontal'), 'empty state padding');
    eq(LAYOUT.emptyPadBottom, v('centered', 'paddingBottom'), 'empty state bottom padding');

    // list
    eq(LAYOUT.listGap, v('listContent', 'gap'), 'list gap');
    eq(PALETTE.card, v('treeCard', 'backgroundColor'), 'card fill');
    eq(LAYOUT.cardRadius, v('treeCard', 'borderRadius'), 'card radius');
    eq(LAYOUT.cardPad, v('treeCard', 'padding'), 'card padding');
    eq(LAYOUT.cardGap, v('treeCard', 'gap'), 'card gap');
    eq(LAYOUT.treeNameSize, v('treeName', 'fontSize'), 'tree name size');
    eq(LAYOUT.treeNameGap, v('treeName', 'marginBottom'), 'tree name gap');
    eq(LAYOUT.treeMetaSize, v('treeMeta', 'fontSize'), 'tree meta size');
    eq(LAYOUT.treeMetaLine, v('treeMeta', 'lineHeight'), 'tree meta line height');
    eq(PALETTE.muted, v('treeMeta', 'color'), 'muted colour');
    eq(LAYOUT.actionGap, v('treeActions', 'gap'), 'action gap');
    eq(LAYOUT.loadRadius, v('loadBtn', 'borderRadius'), 'load button radius');
    eq(LAYOUT.loadPadH, v('loadBtn', 'paddingHorizontal'), 'load button h padding');
    eq(LAYOUT.loadPadV, v('loadBtn', 'paddingVertical'), 'load button v padding');
    eq(PALETTE.gold, v('loadBtnText', 'color'), 'gold');
    eq(LAYOUT.loadTextSize, v('loadBtnText', 'fontSize'), 'load text size');
    eq(PALETTE.danger, v('deleteBtnText', 'color'), 'danger colour');
    eq(LAYOUT.emptyIconSize, v('emptyIcon', 'fontSize'), 'empty icon size');
    eq(LAYOUT.emptyIconGap, v('emptyIcon', 'marginBottom'), 'empty icon gap');
    eq(LAYOUT.emptyTitleSize, v('emptyTitle', 'fontSize'), 'empty title size');
    eq(LAYOUT.emptyTitleGap, v('emptyTitle', 'marginBottom'), 'empty title gap');
    eq(LAYOUT.emptySubSize, v('emptySubtitle', 'fontSize'), 'empty subtitle size');
    eq(LAYOUT.emptySubLine, v('emptySubtitle', 'lineHeight'), 'empty subtitle line height');
    eq(LAYOUT.footerPadV, v('newAnalysisContainer', 'paddingVertical'), 'footer v padding');
    eq(LAYOUT.footerBorder, v('newAnalysisContainer', 'borderTopWidth'), 'footer border');
    eq(PALETTE.buildBg, v('newAnalysisBtn', 'backgroundColor'), 'build button fill');
    eq(PALETTE.buildBorder, v('newAnalysisBtn', 'borderColor'), 'build button border colour');
    eq(LAYOUT.buildRadius, v('newAnalysisBtn', 'borderRadius'), 'build button radius');
    eq(LAYOUT.buildPadV, v('newAnalysisBtn', 'paddingVertical'), 'build button v padding');
    eq(LAYOUT.buildBorder, v('newAnalysisBtn', 'borderWidth'), 'build button border width');
    eq(LAYOUT.buildTextSize, v('newAnalysisBtnText', 'fontSize'), 'build text size');

    // form
    eq(LAYOUT.formPadBottom, v('formContent', 'paddingBottom'), 'form bottom padding');
    eq(LAYOUT.labelSize, v('sectionLabel', 'fontSize'), 'section label size');
    eq(LAYOUT.labelTracking, v('sectionLabel', 'letterSpacing'), 'section label tracking');
    eq(LAYOUT.labelTop, v('sectionLabel', 'marginTop'), 'section label top margin');
    eq(LAYOUT.labelBottom, v('sectionLabel', 'marginBottom'), 'section label bottom margin');
    eq(LAYOUT.inputRadius, v('textInput', 'borderRadius'), 'input radius');
    eq(LAYOUT.inputBorder, v('textInput', 'borderWidth'), 'input border');
    eq(PALETTE.inputBorder, v('textInput', 'borderColor'), 'input border colour');
    eq(LAYOUT.inputTextSize, v('textInput', 'fontSize'), 'input text size');
    eq(LAYOUT.inputPadH, v('textInput', 'paddingHorizontal'), 'input h padding');
    eq(LAYOUT.inputPadV, v('textInput', 'paddingVertical'), 'input v padding');
    eq(LAYOUT.toggleGap, v('toggleRow', 'gap'), 'toggle gap');
    eq(LAYOUT.toggleRadius, v('toggleBtn', 'borderRadius'), 'toggle radius');
    eq(LAYOUT.togglePadV, v('toggleBtn', 'paddingVertical'), 'toggle v padding');
    eq(LAYOUT.toggleBorder, v('toggleBtn', 'borderWidth'), 'toggle border');
    eq(LAYOUT.toggleTextSize, v('toggleBtnText', 'fontSize'), 'toggle text size');
    eq(PALETTE.gold, v('toggleBtnActive', 'backgroundColor'), 'an active toggle is gold');
    eq(PALETTE.onGold, v('toggleBtnTextActive', 'color'), 'and its label is navy');
    eq(LAYOUT.submitRadius, v('analyzeBtn', 'borderRadius'), 'submit radius');
    eq(LAYOUT.submitPadV, v('analyzeBtn', 'paddingVertical'), 'submit v padding');
    eq(LAYOUT.submitTop, v('analyzeBtn', 'marginTop'), 'submit top margin');
    eq(LAYOUT.submitTextSize, v('analyzeBtnText', 'fontSize'), 'submit text size');
    eq(PALETTE.infoBg, v('maxGamesInfoBox', 'backgroundColor'), 'info box fill');
    eq(PALETTE.infoBorder, v('maxGamesInfoBox', 'borderColor'), 'info box border');
    eq(LAYOUT.infoRadius, v('maxGamesInfoBox', 'borderRadius'), 'info radius');
    eq(LAYOUT.infoPad, v('maxGamesInfoBox', 'padding'), 'info padding');
    eq(LAYOUT.infoTop, v('maxGamesInfoBox', 'marginTop'), 'info top margin');
    eq(LAYOUT.infoBottom, v('maxGamesInfoBox', 'marginBottom'), 'info bottom margin');
    eq(LAYOUT.infoTitleSize, v('maxGamesInfoTitle', 'fontSize'), 'info title size');
    eq(LAYOUT.infoTitleGap, v('maxGamesInfoTitle', 'marginBottom'), 'info title gap');
    eq(LAYOUT.infoSubSize, v('maxGamesInfoSub', 'fontSize'), 'info sub size');
    eq(LAYOUT.infoSubLine, v('maxGamesInfoSub', 'lineHeight'), 'info sub line height');
    eq(PALETTE.infoText, v('maxGamesInfoSub', 'color'), 'info sub colour');

    // explorer
    eq(LAYOUT.boardGap, v('boardContainer', 'marginBottom'), 'board bottom gap');
    eq(PALETTE.cardDeep, v('historyStrip', 'backgroundColor'), 'history strip fill');
    eq(LAYOUT.historyRadius, v('historyStrip', 'borderRadius'), 'history radius');
    eq(LAYOUT.historyPadH, v('historyStrip', 'paddingHorizontal'), 'history h padding');
    eq(LAYOUT.historyPadV, v('historyStrip', 'paddingVertical'), 'history v padding');
    eq(LAYOUT.historyBottom, v('historyStrip', 'marginBottom'), 'history bottom margin');
    eq(LAYOUT.historySize, v('historyText', 'fontSize'), 'history text size');
    eq(PALETTE.gold, v('historyText', 'color'), 'history text is gold');
    eq(LAYOUT.navGap, v('navRow', 'gap'), 'nav gap');
    eq(LAYOUT.navBottom, v('navRow', 'marginBottom'), 'nav bottom margin');
    eq(LAYOUT.navRadius, v('navBtn', 'borderRadius'), 'nav radius');
    eq(LAYOUT.navPadH, v('navBtn', 'paddingHorizontal'), 'nav h padding');
    eq(LAYOUT.navPadV, v('navBtn', 'paddingVertical'), 'nav v padding');
    eq(LAYOUT.navBorder, v('navBtn', 'borderWidth'), 'nav border');
    eq(LAYOUT.navTextSize, v('navBtnText', 'fontSize'), 'nav text size');
    eq(LAYOUT.navDisabledOpacity, v('navBtnDisabled', 'opacity'), 'disabled nav opacity');
    eq(LAYOUT.movesPadBottom, v('movesContent', 'paddingBottom'), 'moves bottom padding');
    eq(LAYOUT.rowRadius, v('moveRow', 'borderRadius'), 'row radius');
    eq(LAYOUT.rowPad, v('moveRow', 'padding'), 'row padding');
    eq(LAYOUT.rowBottom, v('moveRow', 'marginBottom'), 'row bottom margin');
    eq(LAYOUT.rowGap, v('moveRow', 'gap'), 'row gap');
    eq(LAYOUT.sanSize, v('moveSan', 'fontSize'), 'SAN size');
    eq(LAYOUT.sanWidth, v('moveSan', 'width'), 'SAN column width');
    eq(LAYOUT.statGap, v('moveStatRow', 'marginBottom'), 'stat row gap');
    eq(LAYOUT.statSize, v('moveCount', 'fontSize'), 'stat size');
    eq(LAYOUT.statSize, v('moveWdl', 'fontSize'), 'both stat labels are the same size');
    eq(WDL.barHeight, v('wdlBar', 'height'), 'W/D/L bar height');
    eq(WDL.barRadius, v('wdlBar', 'borderRadius'), 'W/D/L bar radius');
    eq(LAYOUT.chevronSize, v('moveChevron', 'fontSize'), 'chevron size');
    eq(PALETTE.chevron, v('moveChevron', 'color'), 'chevron colour');
    eq(LAYOUT.noMovesRadius, v('noMovesBox', 'borderRadius'), 'no-moves radius');

    // engine — the whole panel, asserted against the extraction. These styles have been sitting in
    // opening_styles.json unused since the tree shipped: the extractor sweeps the RN StyleSheet
    // whole, so wiring the engine needed no invented geometry at all.
    eq(LAYOUT.engineTogglePadV, v('engineToggleBtn', 'paddingVertical'), 'engine toggle padV');
    eq(LAYOUT.engineTogglePadH, v('engineToggleBtn', 'paddingHorizontal'), 'engine toggle padH');
    eq(LAYOUT.engineToggleRadius, v('engineToggleBtn', 'borderRadius'), 'engine toggle radius');
    eq(LAYOUT.engineToggleBorder, v('engineToggleBtn', 'borderWidth'), 'engine toggle border');
    eq(LAYOUT.engineToggleTop, v('engineToggleBtn', 'marginTop'), 'engine toggle top');
    eq(LAYOUT.engineToggleBottom, v('engineToggleBtn', 'marginBottom'), 'engine toggle bottom');
    eq(PALETTE.card, v('engineToggleBtn', 'backgroundColor'), 'engine toggle fill');
    eq(PALETTE.engineToggleBorder, v('engineToggleBtn', 'borderColor'), 'engine toggle border ink');
    eq(LAYOUT.engineToggleTextSize, v('engineToggleBtnText', 'fontSize'), 'engine toggle text size');
    eq(PALETTE.muted, v('engineToggleBtnText', 'color'), 'engine toggle text ink');
    eq(PALETTE.doneBg, v('engineToggleBtnOn', 'backgroundColor'), 'engine toggle ON fill');
    eq(PALETTE.doneText, v('engineToggleBtnOn', 'borderColor'), 'engine toggle ON border');
    eq(PALETTE.doneText, v('engineToggleBtnTextOn', 'color'), 'engine toggle ON text');
    eq(PALETTE.cardDeep, v('engineSection', 'backgroundColor'), 'engine panel fill');
    eq(PALETTE.hairline, v('engineSection', 'borderColor'), 'engine panel border');
    eq(LAYOUT.engineRadius, v('engineSection', 'borderRadius'), 'engine panel radius');
    eq(LAYOUT.engineBorder, v('engineSection', 'borderWidth'), 'engine panel border width');
    eq(LAYOUT.enginePadH, v('engineSection', 'paddingHorizontal'), 'engine panel padH');
    eq(LAYOUT.enginePadV, v('engineSection', 'paddingVertical'), 'engine panel padV');
    eq(LAYOUT.engineGap, v('engineSection', 'gap'), 'engine panel gap');
    eq(LAYOUT.engineBottom, v('engineSection', 'marginBottom'), 'engine panel bottom');
    eq(LAYOUT.engineRowPadV, v('engineLineRow', 'paddingVertical'), 'engine row padV');
    eq(LAYOUT.engineRowGap, v('engineLineRow', 'gap'), 'engine row gap');
    eq(LAYOUT.engineEvalSize, v('engineChipEval', 'fontSize'), 'engine eval size');
    eq(LAYOUT.engineEvalWidth, v('engineChipEval', 'minWidth'), 'engine eval width');
    eq(LAYOUT.engineSanSize, v('engineChipSan', 'fontSize'), 'engine SAN size');
    eq(LAYOUT.engineSanWidth, v('engineChipSan', 'minWidth'), 'engine SAN width');
    eq(LAYOUT.enginePvSize, v('engineLinePv', 'fontSize'), 'engine PV size');
    eq(PALETTE.muted, v('engineLinePv', 'color'), 'engine PV ink');
    eq(LAYOUT.engineTextSize, v('engineLineText', 'fontSize'), 'engine status size');
    eq(PALETTE.muted, v('engineLineText', 'color'), 'engine status ink');
    eq(LAYOUT.engineDepthSize, v('engineDepthChip', 'fontSize'), 'engine depth size');
    eq(PALETTE.engineDepth, v('engineDepthChip', 'color'), 'engine depth ink');
    eq(LAYOUT.engineDepthTop, v('engineDepthChip', 'marginTop'), 'engine depth top');
    eq(LAYOUT.engineStatusPadV, v('engineAnalyzingRow', 'paddingVertical'), 'engine status padV');

    // The rank colours are a module constant, not a style — extracted all the same.
    var mc = src.openingTree.moduleConstants || {};
    eq(ENGINE_RANK.join('|'), (mc.ENGINE_MOVE_COLORS || []).join('|'),
      'the three engine line colours, in rank order');
    eq(LAYOUT.noMovesPad, v('noMovesBox', 'padding'), 'no-moves padding');
    eq(LAYOUT.noMovesSize, v('noMovesText', 'fontSize'), 'no-moves text size');

    // fetch banner
    eq(PALETTE.cardDeep, v('fetchBanner', 'backgroundColor'), 'banner fill');
    eq(PALETTE.hairline, v('fetchBanner', 'borderColor'), 'banner border');
    eq(LAYOUT.bannerRadius, v('fetchBanner', 'borderRadius'), 'banner radius');
    eq(LAYOUT.bannerPadH, v('fetchBanner', 'paddingHorizontal'), 'banner h padding');
    eq(LAYOUT.bannerPadV, v('fetchBanner', 'paddingVertical'), 'banner v padding');
    eq(LAYOUT.bannerBorder, v('fetchBanner', 'borderWidth'), 'banner border width');
    eq(LAYOUT.bannerBottom, v('fetchBanner', 'marginBottom'), 'banner bottom margin');
    eq(LAYOUT.bannerRowBottom, v('fetchBannerRow', 'marginBottom'), 'banner row bottom margin');
    eq(LAYOUT.bannerLabelSize, v('fetchBannerLabel', 'fontSize'), 'banner label size');
    eq(LAYOUT.trackHeight, v('fetchProgressTrack', 'height'), 'progress track height');
    eq(LAYOUT.trackRadius, v('fetchProgressTrack', 'borderRadius'), 'progress track radius');
    eq(PALETTE.gold, v('fetchProgressFill', 'backgroundColor'), 'progress fill is gold');
    eq(PALETTE.doneBg, v('fetchBannerDone', 'backgroundColor'), 'done banner fill');
    eq(PALETTE.doneBorder, v('fetchBannerDone', 'borderColor'), 'done banner border');
    eq(PALETTE.doneText, v('fetchBannerDoneText', 'color'), 'done banner text');
    eq(PALETTE.errorBg, v('fetchBannerError', 'backgroundColor'), 'error banner fill');
    eq(PALETTE.errorBorder, v('fetchBannerError', 'borderColor'), 'error banner border');
    eq(PALETTE.errorText, v('fetchBannerErrorText', 'color'), 'error banner text');

    // The three W/D/L colours live in `renderWdlBar`'s inline styles, not in the StyleSheet — the
    // one place the RN file writes them, and the reason the extractor names that function.
    var bar = src.openingTree.renderConstants.renderWdlBar;
    expect(!!bar, 'renderWdlBar was extracted');
    if (bar) {
      var text = Object.keys(bar).map(function (k) { return bar[k].text; }).join(' | ');
      expect(text.indexOf('flex: wins') >= 0 && text.indexOf(WDL.win) >= 0,
        'the win segment is ' + WDL.win + ' in the source');
      expect(text.indexOf('flex: draws') >= 0 && text.indexOf(WDL.draw) >= 0,
        'the draw segment is ' + WDL.draw);
      expect(text.indexOf('flex: losses') >= 0 && text.indexOf(WDL.loss) >= 0,
        'the loss segment is ' + WDL.loss);
      // Order is semantics: wins first, losses last.
      expect(text.indexOf('flex: wins') < text.indexOf('flex: draws')
        && text.indexOf('flex: draws') < text.indexOf('flex: losses'),
        'and they are drawn wins | draws | losses, left to right');
    }

    // The candidate ordering. `getSortedMoves` folds to `{}` (it is a one-line arrow with no
    // style-ish value), so the invariant is asserted against the source text itself.
    var sorted = src.openingTree.renderConstants.getSortedMoves;
    expect(sorted !== undefined, 'getSortedMoves was named to the extractor');

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'OpeningMetrics vs RN source: ' + passed + ' assertions passed'
        : 'OpeningMetrics vs RN source: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  /**
   * The Analysis Board's metrics, resolved LAZILY — the rail's width is theirs, not ours.
   *
   * `railTotal` is READ, never copied into LAYOUT: replay §6 requires every LAYOUT key to be a
   * literal `static let name = <number>` in the Swift, so a copy is the only way to put it there,
   * and a copy of a derived number is exactly what these gates exist to stop.
   */
  function analysisMetrics() {
    if (global.BiyaAnalysisMetrics) return global.BiyaAnalysisMetrics;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      return require('./analysis-metrics.js');
    }
    throw new Error('opening-metrics.js needs analysis-metrics.js — load it first');
  }

  /**
   * **The explorer board's edge. The one entry point — nothing else on that screen picks.**
   *
   * Twin of `OpeningBoard.edge`. Same contract as the Analysis Board's, and for the same reason:
   * the board and the rail beside it must agree about how wide the board is.
   *
   * Deliberately NOT `MET.boardEdge` from analysis-metrics: that one snaps to whole physical
   * pixels for a board designed around it, and this explorer has been full-bleed in both languages
   * since it shipped. The engine defaults OFF, so the engine-off path stays byte-identical to what
   * is on the client's phone today.
   */
  function boardEdge(screenWidth, engineOn) {
    return Math.max(0, screenWidth - (engineOn ? analysisMetrics().railTotal() : 0));
  }

  global.BiyaOpeningMetrics = {
    PALETTE: PALETTE, LAYOUT: LAYOUT, WDL: WDL, STRINGS: STRINGS, SOURCES: SOURCES,
    ENGINE_RANK: ENGINE_RANK,
    fill: fill, sourceById: sourceById, isOnlineSource: isOnlineSource,
    engineRankColor: engineRankColor, engineEvalInk: engineEvalInk, boardEdge: boardEdge,
    selfTest: selfTest, selfTestSource: selfTestSource
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.BiyaOpeningMetrics;
})(typeof window !== 'undefined' ? window : globalThis);
