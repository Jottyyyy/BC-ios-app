/* pairing-metrics.js — the Pairing Manager's pure presentation layer.
 *
 *     node -e "console.log(require('./web-demo/js/pairing-metrics.js').selfTest().summary)"
 *
 * Twin of `DemoApp/Sources/BiyaherongUI/PairingMetrics.swift`. Every number the three screens draw
 * lives here, and every one is asserted against `tools/metrics/tournament_styles.json` by
 * `selfTestSource()` — which is re-derived from the React Native source on every run of
 * `tools/metrics/extract_tournament_styles.js`. Nothing here is transcribed from the spec's prose.
 *
 * Consequently the screens contain NO numeric literal and NO arithmetic in a render body. Break
 * that and the coverage drains out silently: an inlined number is a number no check can see.
 *
 * The four style blocks below are EMITTED by `tools/metrics/gen_pairing_metrics.js`, which writes
 * the Swift twin from the same JSON in the same pass. Do not hand-edit anything between the
 * GENERATED markers; re-run the generator. (The values are inlined here at all because the browser
 * cannot `require` the JSON — web-demo runs from `file://` with plain script tags.)
 *
 * `selfTestSource` still compares every one of the ~750 properties back to the extraction, so a
 * hand-edit inside the region, or an extraction that has moved on, fails the gate.
 *
 * The one thing NOT extracted is `STR`: copy is copy. It is transcribed verbatim from spec §1.11,
 * and `tools/qa/replay_pairing.js` asserts the JS and Swift tables hold the same keys.
 */
'use strict';

var BiyaPairingMetrics = (function () {

  // ---- Extracted geometry ---------------------------------------------------------------------
  //
  // One object per React Native StyleSheet, key-for-key. `SHARE` is the detail screen's SECOND
  // StyleSheet (`shareStyles`) — the off-screen card is a separate design at ~90 % scale, and
  // merging it into `DETAIL` would silently overwrite half of each.

  // GENERATED-BEGIN geometry
  var LIST = {
      container: { flex: 1, backgroundColor: '#0F1A2E' },
      header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(253,176,34,0.08)' },
      backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
      backArrow: { fontSize: 22, color: '#FDB022', fontWeight: '600' },
      headerCenter: { flex: 1, alignItems: 'center' },
      headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
      headerSub: { fontSize: 11, color: '#8BA3C7', marginTop: 2, letterSpacing: 0.3 },
      center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
      emptyIcon: { fontSize: 64, color: '#253552', marginBottom: 12 },
      emptyTitle: { fontSize: 18, fontWeight: '700', color: '#5BA3F5', marginBottom: 4 },
      emptySub: { fontSize: 13, color: '#8BA3C7' },
      list: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 90 },
      card: { backgroundColor: '#1A2942', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(91,163,245,0.08)' },
      cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
      cardChevron: { fontSize: 20, color: '#5A7090', marginLeft: 'auto' },
      typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
      typeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
      statusDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 4, marginRight: 2 },
      statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
      cardName: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 10 },
      cardStats: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F1A2E', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4 },
      stat: { flex: 1, alignItems: 'center' },
      statValue: { fontSize: 14, fontWeight: '800', color: '#FDB022' },
      statLabel: { fontSize: 10, color: '#8BA3C7', marginTop: 2, fontWeight: '500' },
      statDivider: { width: 1, height: 24, backgroundColor: '#253552' },
      fab: { position: 'absolute', left: 14, right: 14, backgroundColor: '#FDB022', borderRadius: 14, paddingVertical: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, elevation: 8, shadowColor: '#FDB022', shadowOffset: {"width":0,"height":4}, shadowOpacity: 0.35, shadowRadius: 8 },
      fabIcon: { fontSize: 22, fontWeight: '800', color: '#0F1A2E' },
      fabText: { fontSize: 15, fontWeight: '800', color: '#0F1A2E', letterSpacing: 0.5 },
      hintText: { fontSize: 11, color: '#3A5070', textAlign: 'center', paddingBottom: 8, fontStyle: 'italic' },
      freeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(253,176,34,0.08)', borderRadius: 10, marginHorizontal: 14, marginTop: 8, marginBottom: 2, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(253,176,34,0.25)' },
      freeBannerText: { fontSize: 12, color: '#FDB022', fontWeight: '600', flex: 1 },
      freeBannerCta: { fontSize: 13, color: '#FDB022', fontWeight: '800', marginLeft: 8 },
    };

  var CREATE = {
      container: { flex: 1, backgroundColor: '#0F1A2E' },
      header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(253,176,34,0.08)' },
      backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
      backArrow: { fontSize: 22, color: '#FDB022', fontWeight: '600' },
      headerTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
      body: { flex: 1 },
      bodyContent: { padding: 16 },
      label: { fontSize: 12, fontWeight: '700', color: '#8BA3C7', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
      input: { backgroundColor: '#1A2942', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(91,163,245,0.12)' },
      typeRow: { flexDirection: 'row', gap: 10 },
      typeCard: { flex: 1, backgroundColor: '#1A2942', borderRadius: 14, padding: 14, borderWidth: 2, borderColor: 'transparent' },
      typeCardActive: { borderColor: '#00BFA5', backgroundColor: 'rgba(0,191,165,0.06)' },
      typeCardActiveRR: { borderColor: '#FF8F00', backgroundColor: 'rgba(255,143,0,0.06)' },
      typeIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
      typeIconText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
      typeName: { fontSize: 15, fontWeight: '800', color: '#8BA3C7', marginBottom: 4 },
      typeNameActive: { color: '#00BFA5' },
      typeNameActiveRR: { color: '#FF8F00' },
      typeDesc: { fontSize: 11, color: '#5A7090', lineHeight: 15 },
      roundsRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
      roundBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#1A2942', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(91,163,245,0.1)' },
      roundBtnActive: { backgroundColor: '#00BFA5', borderColor: '#00BFA5' },
      roundBtnText: { fontSize: 16, fontWeight: '800', color: '#8BA3C7' },
      roundBtnTextActive: { color: '#FFFFFF' },
      roundInput: { flex: 1, backgroundColor: '#1A2942', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: '#FFFFFF', textAlign: 'center', borderWidth: 1, borderColor: 'rgba(91,163,245,0.12)' },
      hint: { fontSize: 11, color: '#5A7090', marginTop: 8 },
      rrNote: { marginTop: 20, backgroundColor: 'rgba(255,143,0,0.08)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255,143,0,0.2)' },
      rrNoteText: { fontSize: 12, color: '#FF8F00', lineHeight: 18 },
      footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(91,163,245,0.08)' },
      createBtn: { backgroundColor: '#FDB022', borderRadius: 14, paddingVertical: 15, alignItems: 'center', elevation: 4, shadowColor: '#FDB022', shadowOffset: {"width":0,"height":3}, shadowOpacity: 0.3, shadowRadius: 6 },
      createBtnDisabled: { opacity: 0.6 },
      createBtnText: { fontSize: 16, fontWeight: '800', color: '#0F1A2E', letterSpacing: 0.5 },
    };

  var DETAIL = {
      container: { flex: 1, backgroundColor: '#0F1A2E' },
      center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
      header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(253,176,34,0.08)' },
      backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
      backArrow: { fontSize: 22, color: '#FDB022', fontWeight: '600' },
      headerCenter: { flex: 1, alignItems: 'center' },
      headerTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
      headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
      headerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
      headerBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
      headerRounds: { fontSize: 11, color: '#8BA3C7', fontWeight: '700' },
      tabs: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, gap: 4 },
      tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: '#1A2942' },
      tabActive: { backgroundColor: '#FDB022' },
      tabText: { fontSize: 12, fontWeight: '700', color: '#8BA3C7' },
      tabTextActive: { color: '#0F1A2E' },
      tabBody: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 100 },
      playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A2942', borderRadius: 10, padding: 10, marginBottom: 6 },
      playerSeed: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#253552', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
      playerSeedText: { fontSize: 12, fontWeight: '800', color: '#8BA3C7' },
      playerInfo: { flex: 1 },
      playerName: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
      playerRating: { fontSize: 11, color: '#FDB022', fontWeight: '600', marginTop: 1 },
      playerScore: { fontSize: 16, fontWeight: '800', color: '#FDB022', marginLeft: 8 },
      removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(211,47,47,0.15)', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
      removeBtnText: { fontSize: 14, fontWeight: '700', color: '#D32F2F' },
      playerActions: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(91,163,245,0.08)' },
      actionBtn: { flex: 1, backgroundColor: '#FDB022', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
      actionBtnText: { fontSize: 14, fontWeight: '800', color: '#0F1A2E' },
      actionBtnSecondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FDB022' },
      actionBtnSecondaryText: { fontSize: 14, fontWeight: '800', color: '#FDB022' },
      roundSelector: { maxHeight: 44, marginBottom: 4, marginTop: 4 },
      roundTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1A2942', alignItems: 'center', flexDirection: 'row', gap: 5 },
      roundTabActive: { backgroundColor: '#FDB022' },
      roundTabCompleted: { borderWidth: 1, borderColor: 'rgba(0,191,165,0.3)' },
      roundTabText: { fontSize: 13, fontWeight: '800', color: '#8BA3C7' },
      roundTabTextActive: { color: '#0F1A2E' },
      roundCompleteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00BFA5' },
      roundShareBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1E88E5', alignItems: 'center', justifyContent: 'center' },
      roundShareBtnText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
      pairingCard: { backgroundColor: '#1A2942', borderRadius: 12, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
      boardNum: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#253552', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
      boardNumText: { fontSize: 12, fontWeight: '800', color: '#8BA3C7' },
      pairingPlayers: { flex: 1, flexDirection: 'row', alignItems: 'center' },
      pairingPlayer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
      colorDot: { width: 10, height: 10, borderRadius: 5 },
      pairingPlayerName: { flex: 1, fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
      pairingScore: { fontSize: 12, fontWeight: '800', color: '#FDB022', minWidth: 20, textAlign: 'center', flexShrink: 0 },
      winnerName: { color: '#FDB022', fontWeight: '800' },
      resultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginHorizontal: 6, minWidth: 44, alignItems: 'center' },
      resultPending: { backgroundColor: '#253552' },
      resultDone: { backgroundColor: 'rgba(253,176,34,0.12)' },
      resultText: { fontSize: 11, fontWeight: '800' },
      resultTextPending: { color: '#5A7090' },
      resultTextDone: { color: '#FDB022' },
      byeText: { fontSize: 13, fontWeight: '600', color: '#8BA3C7', fontStyle: 'italic' },
      generateWrap: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: 'rgba(91,163,245,0.08)' },
      generateBtn: { backgroundColor: '#00BFA5', borderRadius: 12, paddingVertical: 14, alignItems: 'center', elevation: 4, shadowColor: '#00BFA5', shadowOffset: {"width":0,"height":3}, shadowOpacity: 0.3, shadowRadius: 6 },
      generateBtnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
      finishedBanner: { marginHorizontal: 14, marginBottom: 16, backgroundColor: 'rgba(253,176,34,0.1)', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(253,176,34,0.2)' },
      finishedText: { fontSize: 14, fontWeight: '800', color: '#FDB022', letterSpacing: 0.5 },
      standingsHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#253552', marginBottom: 4 },
      shCol: { fontSize: 10, fontWeight: '700', color: '#5A7090', letterSpacing: 0.5 },
      standingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8 },
      standingsRowAlt: { backgroundColor: 'rgba(26,41,66,0.5)' },
      standingsRowFirst: { backgroundColor: 'rgba(253,176,34,0.06)' },
      rankCol: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#253552', justifyContent: 'center', alignItems: 'center' },
      rankColFirst: { backgroundColor: '#FDB022' },
      rankText: { fontSize: 12, fontWeight: '800', color: '#8BA3C7' },
      rankTextFirst: { color: '#0F1A2E' },
      standingsName: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
      standingsRating: { fontSize: 10, color: '#5A7090', marginTop: 1 },
      standingsVal: { width: 42, fontSize: 13, fontWeight: '700', color: '#8BA3C7', textAlign: 'center' },
      standingsPts: { color: '#FDB022', fontWeight: '800' },
      standingsShareBtn: { backgroundColor: '#1E88E5', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
      standingsShareBtnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
      emptyTab: { paddingVertical: 40, alignItems: 'center' },
      emptyTabText: { fontSize: 13, color: '#5A7090', textAlign: 'center' },
      modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 20 },
      modalCard: { backgroundColor: '#1A2942', borderRadius: 18, padding: 20, borderWidth: 1, borderColor: 'rgba(253,176,34,0.1)' },
      modalTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
      modalSub: { fontSize: 12, color: '#8BA3C7', marginBottom: 16 },
      modalLabel: { fontSize: 11, fontWeight: '700', color: '#5A7090', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 },
      modalInput: { backgroundColor: '#0F1A2E', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(91,163,245,0.1)' },
      modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
      modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#5A7090', alignItems: 'center' },
      modalCancelText: { fontSize: 14, fontWeight: '700', color: '#8BA3C7' },
      modalConfirm: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#FDB022', alignItems: 'center' },
      modalConfirmText: { fontSize: 14, fontWeight: '800', color: '#0F1A2E' },
      resultPlayers: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 20 },
      resultPlayerWhite: { flex: 1, fontSize: 15, fontWeight: '700', color: '#FFFFFF', textAlign: 'right' },
      resultVs: { fontSize: 12, fontWeight: '600', color: '#5A7090' },
      resultPlayerBlack: { flex: 1, fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
      resultButtons: { gap: 8 },
      resultBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
      resultBtnWhite: { backgroundColor: '#FAFAFA' },
      resultBtnDraw: { backgroundColor: '#253552' },
      resultBtnBlack: { backgroundColor: '#1A1A2E' },
      resultBtnTextDark: { fontSize: 18, fontWeight: '900', color: '#0F1A2E' },
      resultBtnTextLight: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
      resultBtnSub: { fontSize: 11, color: '#5A7090', marginTop: 2, fontWeight: '600' },
      resultCancelBtn: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
      resultCancelText: { fontSize: 14, fontWeight: '700', color: '#5A7090' },
    };

  var SHARE = {
      offscreen: { position: 'absolute', left: -9999, top: 0 },
      card: { width: 360, backgroundColor: '#0F1A2E', borderRadius: 16, overflow: 'hidden', padding: 20 },
      cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
      cardLogo: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#FDB022' },
      cardBrand: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1 },
      goldLine: { height: 2, backgroundColor: '#FDB022', borderRadius: 1, marginBottom: 14 },
      cardTournament: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
      cardSubtitle: { fontSize: 12, color: '#8BA3C7', fontWeight: '600', marginBottom: 14 },
      cardBody: { gap: 4 },
      pairingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A2942', borderRadius: 8, padding: 8 },
      pairingBoard: { width: 24, height: 24, borderRadius: 6, backgroundColor: '#253552', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
      pairingBoardText: { fontSize: 11, fontWeight: '800', color: '#8BA3C7' },
      pairingContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
      pairingLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
      pairingRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
      colorDot: { width: 8, height: 8, borderRadius: 4 },
      pairingName: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', flexShrink: 1 },
      winnerText: { color: '#FDB022', fontWeight: '800' },
      byeText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#8BA3C7', fontStyle: 'italic' },
      resultBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginHorizontal: 4, minWidth: 38, alignItems: 'center' },
      resultPending: { backgroundColor: '#253552' },
      resultDone: { backgroundColor: 'rgba(253,176,34,0.12)' },
      resultText: { fontSize: 10, fontWeight: '800' },
      resultTextPending: { color: '#5A7090' },
      resultTextDone: { color: '#FDB022' },
      tableHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#253552', marginBottom: 2 },
      thText: { fontSize: 9, fontWeight: '700', color: '#5A7090', letterSpacing: 0.5 },
      tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
      tableRowAlt: { backgroundColor: 'rgba(26,41,66,0.5)' },
      rankBadge: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#253552', justifyContent: 'center', alignItems: 'center', marginRight: 4 },
      rankBadgeFirst: { backgroundColor: '#FDB022' },
      rankText: { fontSize: 10, fontWeight: '800', color: '#8BA3C7' },
      rankTextFirst: { color: '#0F1A2E' },
      tdName: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', paddingRight: 4 },
      tdVal: { fontSize: 12, fontWeight: '700', color: '#8BA3C7', textAlign: 'center' },
      tdPts: { color: '#FDB022', fontWeight: '800' },
      cardFooter: { marginTop: 14, alignItems: 'center', gap: 2 },
      footerHashtags: { fontSize: 10, fontWeight: '700', color: '#5A7090', letterSpacing: 0.5 },
      footerUrl: { fontSize: 10, fontWeight: '600', color: '#8BA3C7' },
    };
  // GENERATED-END geometry

  // ---- The colour maps ------------------------------------------------------------------------
  //
  // Extracted as ordered `when -> value` lists (`colorMaps` in the JSON) because they are if-chains
  // and ternaries where the order IS the semantics: anything that is neither ongoing nor finished
  // is gold. The detail screen writes its own copy of the type mapping as a plain ternary
  // (`[id].tsx:400`); `selfTestSource` asserts the two copies agree rather than assuming it.

  var TYPE_SWISS = 'swiss';
  var TYPE_ROUND_ROBIN = 'round_robin';

  var COLORS = {
    swiss:      '#00BFA5',
    roundRobin: '#FF8F00',
    ongoing:    '#00BFA5',
    finished:   '#8BA3C7',
    setup:      '#FDB022',
  };

  /** The badge fill is `typeColor + '22'` — hex alpha by string CONCATENATION, not a percentage. */
  var TINT_BYTE = '22';

  function typeColor(type)   { return type === TYPE_SWISS ? COLORS.swiss : COLORS.roundRobin; }
  function typeLabel(type)   { return type === TYPE_SWISS ? STR.swissBadge : STR.roundRobinBadge; }
  function statusColor(st)   {
    if (st === 'ongoing')  return COLORS.ongoing;
    if (st === 'finished') return COLORS.finished;
    return COLORS.setup;                        // the fallback stays last, as in the source
  }
  function tint(hex, byte)   { return hex + byte; }

  // ---- Invented, and marked as such -----------------------------------------------------------
  //
  // Recorded in PORTING_NOTES.md. Nothing below is in the RN source, so `selfTestSource` skips it
  // deliberately rather than by omission.

  /**
   * The standings column widths, which are INLINE styles rather than StyleSheet entries.
   *
   * `[id].tsx` writes them as `style={[styles.standingsVal, { width: 30 }]}` per column, so they
   * never reach a StyleSheet and the block walker cannot see them — `standingsVal.width` is 42 for
   * every column, which is simply wrong for five of the six. They are asserted against the
   * extractor's `inlineStyles` instead, where they DO appear.
   *
   * `sb` is the exception and is invented: spec 1.4 adds a Sonneborn-Berger column the RN table
   * never had. It mirrors `bch`, the other tie-break beside it.
   */
  var COLS = { rank: 28, pts: 42, wdl: 30, bch: 36, sb: 36 };

  /**
   * The few layout values with no RN counterpart at all.
   *
   * `roundSelectorGap` lives in a `contentContainerStyle` prop, which the AST walker does not
   * collect — recorded here as invented rather than pretended to be extracted.
   */
  var LAYOUT = { roundSelectorGap: 6 };

  var SHARE_CARD = { width: 360 };              // [id].tsx:1384, via the extractor's shareCard block
  var DELAYS = { shareCapture: 150 };           // [id].tsx:326 and :370, both pre-capture waits
  var LIMITS = { nameMax: 100, ratingMin: 0, ratingMax: 3000, roundsMin: 1, roundsMax: 30,
                 // Long-press to delete (spec 1.2). No RN counterpart — React Native's
                 // `onLongPress` uses its own platform default, which is not a number
                 // anywhere in the source. 500 ms is the iOS convention.
                 longPressMs: 500 };


  // ---- Strings (spec 1.11), verbatim -----------------------------------------------------------
  //
  // Every network-error string in the RN app is deliberately ABSENT: there is no network. So are the
  // free-plan limit messages — the one-time purchase removes the cap entirely.

  var STR = {
    // 1.2 List
    // `back` used to be here, as the character `←`. It is a VECTOR now (js/icons.js /
    // NavIcons.swift), so it is no longer a string and no longer generated into
    // PairingStrings.swift. nav_icons_check.js asserts it does not come back.
    tournaments: 'Tournaments',
    listSub: 'Swiss & Round Robin Manager',
    emptyGlyph: '\u265E',
    emptyTitle: 'No Tournaments Yet',
    emptySub: 'Create your first chess tournament',
    players: 'Players',
    rounds: 'Rounds',
    created: 'Created',
    // The Swift twin's DateFormatter pattern. The browser uses toLocaleDateString instead, which is
    // locale-aware and needs no pattern — but the key lives in both tables so they stay in parity,
    // exactly as PuzzleStrings.runDateFormat does.
    createdDateFormat: 'MMM d',
    longPressHint: 'Long press a card to delete',
    fabPlus: '+',
    newTournament: 'New Tournament',
    deleteTitle: 'Delete Tournament',
    deleteBody: function (name) { return 'Delete "' + name + '"? This cannot be undone.'; },
    cancel: 'Cancel',
    deleteAction: 'Delete',
    swissBadge: 'SWISS',
    roundRobinBadge: 'ROUND ROBIN',
    statusSetup: 'SETUP',
    statusOngoing: 'ONGOING',
    statusFinished: 'FINISHED',
    chevron: '\u203A',

    // 1.3 Create
    nameLabel: 'Tournament Name',
    namePlaceholder: 'e.g. Manila Open 2026',
    formatLabel: 'Tournament Format',
    swiss: 'Swiss',
    roundRobin: 'Round Robin',
    swissDesc: 'Best for large events. Players face opponents with similar scores.',
    roundRobinDesc: 'Everyone plays everyone. Best for smaller groups.',
    roundsLabel: 'Number of Rounds',
    recommended: function (n, r) {
      return 'Recommended for ' + n + ' players: ' + r + ' rounds';
    },
    roundsPlaceholder: '#',
    rrNote: 'Rounds are automatically determined by the number of players. '
          + 'Add players after creating the tournament.',
    createTournament: 'Create Tournament',
    required: 'Required',
    enterName: 'Enter a tournament name',
    swissGlyph: 'S',
    roundRobinGlyph: 'R',

    // 1.4 Detail
    playersTab: function (n) { return 'Players (' + n + ')'; },
    roundsTab: 'Rounds',
    standingsTab: 'Standings',
    roundsMeta: function (cur, total) { return 'R' + cur + '/' + total; },
    noPlayers: 'No players yet. Add players to get started.',
    ncfp: function (r) { return 'NCFP ' + r; },
    bulkAdd: 'Bulk Add',
    addPlayerBtn: '+ Add Player',
    removeTitle: 'Remove Player',
    removeBody: function (name) { return 'Remove ' + name + '?'; },
    remove: 'Remove',
    removeGlyph: '×',
    lockedTitle: 'Players Locked',
    lockedBody: 'Players can only be changed while the tournament is in setup.',
    share: 'Share',
    roundChip: function (n) { return 'R' + n; },
    byeLine: function (name) { return name + ' \u2014 BYE (1 pt)'; },
    vs: 'vs',
    resultWhite: '1-0',
    resultBlack: '0-1',
    resultDraw: '\u00BD-\u00BD',
    needTwoPlayers: 'Add at least 2 players first',
    generateToStart: 'Generate pairings to start the round',
    generateRound: function (n) { return 'Generate Round ' + n + ' Pairings'; },
    generateSchedule: 'Generate Full Schedule',
    tournamentComplete: 'Tournament Complete',
    colRank: '#',
    colPlayer: 'Player',
    colPts: 'Pts',
    colW: 'W',
    colD: 'D',
    colL: 'L',
    colBch: 'Bch',
    colSB: 'SB',
    shareStandings: 'Share Standings',
    noPlayersToDisplay: 'No players to display',
    deletedTitle: 'Tournament Not Found',
    deletedBody: 'This tournament has been deleted.',

    // 1.5 Modals
    addPlayer: 'Add Player',
    nameRequired: 'Name *',
    fullName: 'Full Name',
    ncfpRating: 'NCFP Rating',
    playerNamePlaceholder: 'Player name',
    optional: 'Optional',
    add: 'Add',
    bulkAddTitle: 'Bulk Add Players',
    bulkAddSub: 'One player per line. Add rating after name (optional).',
    bulkPlaceholder: 'Juan Dela Cruz\nMaria Santos 1500\nPedro Reyes 1200',
    addNPlayers: function (n) { return 'Add ' + n + ' Players'; },
    enterResult: 'Enter Result',
    board: function (n) { return 'Board ' + n; },
    resultWhiteBig: '1 - 0',
    resultWhiteSub: 'White Wins',
    resultDrawBig: '\u00BD - \u00BD',
    resultDrawSub: 'Draw',
    resultBlackBig: '0 - 1',
    resultBlackSub: 'Black Wins',
    clearResult: 'Clear Result',

    // 1.7 warnings, surfaced on the Rounds tab
    pairingNotes: '\u26A0 Pairing Notes',
    warnRepeat: function (a, b) {
      return a + ' vs ' + b + ' \u2014 repeat pairing (no legal alternative)';
    },
    warnColor: function (name) { return name + ' \u2014 colour preference not met'; },
    warnBye: function (name) { return name + ' \u2014 second bye awarded'; },

    // 1.6 Share cards
    brand: 'BIYAHERONG CHESS COACH',
    shareStandingsTitle: function (name) { return name + ' \u2014 Standings'; },
    shareSubtitle: function (n, total, type) {
      return 'Round ' + n + ' of ' + total + ' \u2022 ' + type;
    },
    hashtags: '#BiyaherongChess  #ChessPH',      // two spaces, deliberately
    siteUrl: 'biyaherongchesscoach.com',
    textBrand: '\u265F\uFE0F Biyaherong Chess Coach',
    textRule: '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501'
            + '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',   // 21
    textTrophy: '\uD83C\uDFC6 ',
    textClipboard: '\uD83D\uDCCB ',
    textBoard: function (n) { return 'Bd ' + n + ': '; },
    textBye: ' \u2014 BYE',
  };

  // ---- Pushing the extracted geometry into CSS -------------------------------------------------
  //
  // The puzzle layer hand-writes one `set('--pzh-card-r', H.cardRadius + 'px')` per value. That is
  // fine for one screen; across these four blocks it would be 748 lines and 748 chances to omit one
  // silently — and an omitted line is invisible, because the CSS just falls back to nothing.
  //
  // So a whole block is converted MECHANICALLY to `--<prefix>-<block>-<prop>`, kebab-cased. Nothing
  // can be forgotten, because nothing is chosen.
  //
  // This changes what the coverage audit can say, and the change is worth stating. The puzzle
  // screen test checks its `--pz*` vars in BOTH directions, because with a hand-written push an
  // unread var usually means a stale line and an unset one means a forgotten line. Here the push is
  // total, so "set but never read" is the normal case for most of the 748 and carries no
  // information. The pairing suite therefore checks the direction that still does: every
  // `var(--pg…)` the stylesheet reads must actually be set.

  // Properties that must NOT get a `px` suffix. React Native takes plain numbers for all of these;
  // CSS would either ignore the unit or, for line-height, silently change meaning.
  var UNITLESS = {
    flex: 1, flexGrow: 1, flexShrink: 1, fontWeight: 1, opacity: 1, zIndex: 1,
    aspectRatio: 1, shadowOpacity: 1, elevation: 1,
  };

  function kebab(s) { return s.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }

  function cssVarName(prefix, block, prop) {
    return '--' + prefix + '-' + kebab(block) + '-' + kebab(prop);
  }

  function cssValue(prop, v) {
    if (typeof v === 'number') return UNITLESS[prop] ? String(v) : v + 'px';
    return String(v);
  }

  /**
   * Push every scalar property of every block onto `node` as a custom property.
   *
   * Objects (`shadowOffset: {width, height}`) are skipped: a shadow has to be composed into a
   * single CSS `box-shadow` string, which is a decision, not a translation. The screens do that
   * explicitly so it stays visible.
   */
  function applyAll(node, prefix, blocks) {
    Object.keys(blocks).forEach(function (block) {
      var b = blocks[block];
      if (!b) return;
      Object.keys(b).forEach(function (prop) {
        var v = b[prop];
        if (v === null || typeof v === 'object') return;
        node.style.setProperty(cssVarName(prefix, block, prop), cssValue(prop, v));
      });
    });
  }

  /** `0 4px 8px rgba(...)` from the RN quartet, which CSS has no direct equivalent for. */
  function shadow(block, color) {
    var off = block.shadowOffset || { width: 0, height: 0 };
    return off.width + 'px ' + off.height + 'px ' + (block.shadowRadius || 0) + 'px ' + color;
  }

  // ---- Self-tests --------------------------------------------------------------------------

  function harness() {
    var passed = 0, failures = [];
    return {
      expect: function (c, what) { if (c) passed++; else failures.push(what); },
      done: function (label) {
        return {
          passed: passed, failures: failures, ok: failures.length === 0,
          summary: failures.length === 0
            ? label + ': ' + passed + ' assertions passed'
            : label + ': ' + passed + ' passed, ' + failures.length + ' FAILED\n'
              + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
        };
      },
    };
  }

  /** Behaviour of the derived functions — the part with logic in it. */
  function selfTest() {
    var h = harness(), eq = function (got, want, what) {
      h.expect(got === want, what + ': got ' + JSON.stringify(got)
                             + ', want ' + JSON.stringify(want));
    };

    eq(typeColor(TYPE_SWISS), '#00BFA5', 'Swiss is teal');
    eq(typeColor(TYPE_ROUND_ROBIN), '#FF8F00', 'Round Robin is orange');
    eq(typeColor('anything else'), '#FF8F00', 'the type fallback is Round Robin, as in the source');
    eq(typeLabel(TYPE_SWISS), 'SWISS', 'Swiss label');
    eq(typeLabel(TYPE_ROUND_ROBIN), 'ROUND ROBIN', 'Round Robin label');

    eq(statusColor('ongoing'), '#00BFA5', 'ongoing is teal');
    eq(statusColor('finished'), '#8BA3C7', 'finished is muted');
    eq(statusColor('setup'), '#FDB022', 'setup is gold');
    // The fallback is load-bearing: the source returns gold for ANY unrecognised status, and a
    // switch that returned undefined instead would render an invisible dot.
    eq(statusColor('nonsense'), '#FDB022', 'an unknown status still gets a colour');

    eq(tint('#00BFA5', TINT_BYTE), '#00BFA522', 'the badge fill concatenates a hex alpha BYTE');
    eq(TINT_BYTE.length, 2, 'and it is two hex digits, not a percentage');

    // 16 = the length of '#BiyaherongChess'. Asserting the INDEX rather than a boolean means a
    // single-space regression fails here instead of rendering a subtly wrong share card.
    eq(STR.hashtags.indexOf('  '), 16, 'the hashtag line keeps its two spaces');
    eq(STR.textRule.length, 21, 'the plain-text rule is 21 heavy horizontals');
    eq(STR.deleteBody('Manila Open'), 'Delete "Manila Open"? This cannot be undone.',
       'the delete prompt quotes the name');
    eq(STR.recommended(12, 4), 'Recommended for 12 players: 4 rounds', 'the live recommendation');
    eq(STR.byeLine('Ana'), 'Ana \u2014 BYE (1 pt)', 'the bye line');
    eq(STR.shareSubtitle(2, 5, 'Swiss'), 'Round 2 of 5 \u2022 Swiss', 'the share subtitle');

    // --- the CSS-var pusher ---
    eq(cssVarName('pgl', 'cardStats', 'paddingHorizontal'), '--pgl-card-stats-padding-horizontal',
       'block and property are both kebab-cased');
    eq(cssValue('padding', 14), '14px', 'a length gets px');
    eq(cssValue('fontWeight', 800), '800', 'a weight does not');
    eq(cssValue('flex', 1), '1', 'nor does flex');
    eq(cssValue('opacity', 0.85), '0.85', 'nor opacity');
    eq(cssValue('backgroundColor', '#1A2942'), '#1A2942', 'a colour passes through');
    // line-height is the one that would break QUIETLY: unitless in CSS means a multiplier, so a
    // missing px turns 15 into fifteen times the font size.
    eq(cssValue('lineHeight', 15), '15px', 'line-height keeps its unit');

    var fake = { _p: {}, style: { setProperty: function (k, v) { fake._p[k] = v; } } };
    applyAll(fake, 'pgl', { card: LIST.card, fab: LIST.fab });
    eq(fake._p['--pgl-card-border-radius'], '14px', 'the pusher writes a real extracted value');
    eq(fake._p['--pgl-card-background-color'], '#1A2942', 'and a real extracted colour');
    h.expect(fake._p['--pgl-fab-shadow-offset'] === undefined,
             'objects are skipped rather than stringified to [object Object]');
    eq(shadow(LIST.fab, 'rgba(253,176,34,0.35)'), '0px 4px 8px rgba(253,176,34,0.35)',
       'the shadow quartet composes into one CSS value');

    return h.done('pairing-metrics');
  }

  /**
   * Every extracted constant, against the extraction it came from.
   *
   * This is the assertion that makes the generated blocks above trustworthy: they were produced
   * mechanically once, and from here on they are compared property-by-property to a JSON that is
   * re-derived from the React Native source on every extractor run. A drift in either direction
   * fails.
   */
  function selfTestSource(src) {
    var h = harness();
    // Deep, not identity: a handful of RN properties are objects (`shadowOffset: {width, height}`)
    // and `===` on those compares references, so three real matches were reported as failures with
    // identical text on both sides. Comparing the serialisation is enough for plain style data.
    var same = function (a, b) {
      if (a !== null && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
      return a === b;
    };
    var eq = function (got, want, what) {
      h.expect(same(got, want), what + ': metrics have ' + JSON.stringify(got)
                                + ', the RN source has ' + JSON.stringify(want));
    };

    var pairs = [
      ['LIST',   LIST,   src.screens.list.styles],
      ['CREATE', CREATE, src.screens.create.styles],
      ['DETAIL', DETAIL, src.screens.detail.styles],
      ['SHARE',  SHARE,  src.screens.detail.shareStyles],
    ];
    var compared = 0;
    pairs.forEach(function (p) {
      var name = p[0], mine = p[1], theirs = p[2];
      Object.keys(theirs).forEach(function (block) {
        h.expect(mine[block] != null, name + '.' + block + ' is missing from the metrics layer');
        if (!mine[block]) return;
        Object.keys(theirs[block]).forEach(function (prop) {
          eq(mine[block][prop], theirs[block][prop], name + '.' + block + '.' + prop);
          compared++;
        });
      });
      Object.keys(mine).forEach(function (block) {
        h.expect(theirs[block] != null,
                 name + '.' + block + ' is in the metrics layer but not in the RN source');
      });
    });

    // The colour maps, in the order the source declares them.
    var cm = src.screens.list.colorMaps;
    eq(cm.getTypeColor[0].value, COLORS.swiss, 'getTypeColor case 1');
    eq(cm.getTypeColor[1].value, COLORS.roundRobin, 'getTypeColor fallback');
    eq(cm.getStatusColor[0].value, COLORS.ongoing, 'getStatusColor case 1');
    eq(cm.getStatusColor[1].value, COLORS.finished, 'getStatusColor case 2');
    eq(cm.getStatusColor[2].value, COLORS.setup, 'getStatusColor fallback');
    eq(cm.getTypeLabel[0].value, STR.swissBadge, 'getTypeLabel case 1');
    eq(cm.getTypeLabel[1].value, STR.roundRobinBadge, 'getTypeLabel fallback');

    // The detail screen keeps its OWN copy of the type mapping. Assert the two agree rather than
    // assuming they do — a divergence here is exactly the kind of thing nobody notices.
    var dm = src.screens.detail.colorMaps.typeColor;
    eq(dm[0].value, cm.getTypeColor[0].value, 'the detail screen agrees with the list on Swiss');
    eq(dm[1].value, cm.getTypeColor[1].value, 'and on Round Robin');

    // The column widths, read back out of the inline styles where they actually live.
    var inline = src.screens.detail.inlineStyles;
    var widths = Object.keys(inline)
      .filter(function (k) { return /^Text\[\d+\]\.width$/.test(k); })
      .map(function (k) { return inline[k].terms[0].value; });
    h.expect(widths.length >= 6, 'found ' + widths.length + ' inline column widths, expected 6+');
    eq(widths.indexOf(COLS.rank) >= 0, true, 'the rank width is one the source actually uses');
    eq(widths.indexOf(COLS.pts) >= 0, true, 'and the Pts width');
    eq(widths.indexOf(COLS.wdl) >= 0, true, 'and the W/D/L width');
    eq(widths.indexOf(COLS.bch) >= 0, true, 'and the Buchholz width');
    eq(COLS.sb, COLS.bch, 'the invented SB column mirrors the Buchholz one beside it');

    eq(SHARE_CARD.width, src.shareCard.width, 'the share card width');
    eq(DELAYS.shareCapture, src.delays.byScreen.detail[0].ms, 'the pre-capture wait');

    // The tint byte, read back out of the inline style that concatenates it.
    var badge = src.screens.list.inlineStyles['View[1].backgroundColor'];
    eq(badge.terms[1].text, "'" + TINT_BYTE + "'", 'the badge tint byte, as written in the source');

    // Anti-vacuity: a renamed block would otherwise make this suite silently compare nothing.
    h.expect(compared > 600,
             'only ' + compared + ' properties compared — the extraction probably moved');
    return h.done('pairing-metrics vs RN source');
  }

  return {
    LIST: LIST, CREATE: CREATE, DETAIL: DETAIL, SHARE: SHARE,
    COLORS: COLORS, TINT_BYTE: TINT_BYTE,
    TYPE_SWISS: TYPE_SWISS, TYPE_ROUND_ROBIN: TYPE_ROUND_ROBIN,
    SHARE_CARD: SHARE_CARD, DELAYS: DELAYS, LIMITS: LIMITS,
    COLS: COLS, LAYOUT: LAYOUT,
    STR: STR,
    typeColor: typeColor, typeLabel: typeLabel, statusColor: statusColor, tint: tint,
    cssVarName: cssVarName, cssValue: cssValue, applyAll: applyAll, shadow: shadow,
    selfTest: selfTest, selfTestSource: selfTestSource,
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPairingMetrics; }
