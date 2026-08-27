/* video-strings.js — the JS twin of DemoApp/Sources/BiyaherongUI/VideoStrings.swift.
 *
 * Hand-written in both languages and pinned by tools/qa/replay_videos.js, unlike video-metrics.js
 * which is generated: the RN keeps its copy inline in JSX rather than in a table, so there is
 * nothing to extract from, and this app has to say things the RN never had to.
 *
 * The RN screen assumes a server is reachable, because it only ever ran with one. This one can be in
 * Airplane Mode, so it has words for that -- and it has to say them without making the user feel the
 * app is broken.
 */
(function (global) {
  'use strict';

  var STR = {
    // ---- Chrome, verbatim from tutorial-videos/index.tsx ----
    title: 'Tutorial Videos',
    loading: 'Loading videos...',
    emptyGlyph: '🎬',
    emptyTitle: 'No Videos Yet',
    emptySub: 'Tutorial videos will appear here once available.',
    playGlyph: '▶',

    // ---- The paywall, verbatim ----
    lockGlyph: '🔒',
    paywallLabel: 'Premium Feature',
    paywallMessage: 'Mag-subscribe muna para ma-access ang tutorial videos.',
    paywallSubtext: 'Unlock unlimited videos, puzzles, at coach chats.',
    subscribe: 'Subscribe Now',

    // ---- Being offline, which the RN never had to describe ----
    onlineGlyph: '📶',
    onlineTitle: 'Online Feature',
    /* Taglish, matching the paywall copy above -- that is the voice this feature already speaks in,
       and switching to English for the error would read as a different app. */
    offlineBody: 'Kailangan ng internet para mapanood ang tutorial videos.',
    offlineSub: 'Mag-connect sa wifi o data, tapos subukan ulit.',
    /* The standing note, shown even when the videos loaded. The rest of this app works in Airplane
       Mode, so a screen that quietly needs a connection is a surprise. */
    onlineNote: 'Kailangan ng internet — nagsi-stream ang mga video na ito.',
    retry: 'Try Again',

    // ---- Failures the user can act on ----
    errorTitle: 'Could not load videos',
    errorBody: 'Check your connection and try again.',
    /* Deliberately NOT phrased as a connection problem: telling a user to check their wifi when the
       app has nowhere to look would send them to fix the one thing that is working. */
    notConfiguredTitle: 'Videos are not published yet',
    notConfiguredBody: 'The catalogue has not been set up. Please check back after the next update.'
  };

  /** `12 videos` / `1 video`. The RN inlines the same ternary at index.tsx:180. */
  function count(n) { return n + ' ' + (n === 1 ? 'video' : 'videos'); }

  var API = { STR: STR, count: count };

  global.BiyaVideoStrings = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
