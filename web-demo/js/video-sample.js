/* video-sample.js — a sample catalogue, for the BROWSER DEMO ONLY.
 *
 * ## Why this exists
 *
 * The real catalogue is a manifest published to the content bucket, and there is not one yet:
 * `AWS_BUCKET` is empty in the Laravel `.env` and `tutorial_videos` has zero rows. So the screen's
 * honest state today is "Videos are not published yet", which is correct and completely
 * undemonstrable — you cannot tell a working screen from a broken one when both show a notice.
 *
 * This checkout is tested in a browser on Windows. So the not-published notice offers a **Load
 * sample catalogue** button, and this is what it loads: four rows in exactly the manifest shape,
 * pointing at real files that really stream. Clicking one really plays it.
 *
 * ## What it is NOT
 *
 * It is not a fallback, and it is not in the app. `ContentClient.manifestURL` is empty in BOTH
 * languages and `replay_videos.js` asserts they match; nothing here is reachable from Swift, and
 * nothing here loads unless somebody presses that button. The default state stays the true one.
 *
 * ## Attribution
 *
 * Big Buck Bunny and its siblings are (c) Blender Foundation, released under CC BY 3.0
 * (https://peach.blender.org). They are the standard public test streams and are used here as
 * placeholder media, not as chess content. Nothing in this file ships in the app, so it is not in
 * THIRD-PARTY-NOTICES.md — but it is credited here, which is the obligation either way.
 */
(function (global) {
  'use strict';

  var BASE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/';

  /* Deliberately in the manifest's own shape -- snake_case keys, `videos` wrapper -- so this goes
     through `VideoLibrary.parse` exactly as a real download would. A fixture that skipped the
     parser would demonstrate a screen the app does not have. */
  var SAMPLE = {
    videos: [
      {
        id: 1,
        title: 'The Ruy Lopez, move by move',
        description: 'Why 3.Bb5 is the oldest good idea in chess.',
        category: 'Opening',
        thumbnail_url: BASE + 'images/BigBuckBunny.jpg',
        video_url: BASE + 'BigBuckBunny.mp4',
        created_at: '2026-08-01T09:00:00Z'
      },
      {
        id: 2,
        title: 'Rook endings: the Lucena position',
        description: 'Building the bridge, one move at a time.',
        category: 'Endgame',
        thumbnail_url: BASE + 'images/ElephantsDream.jpg',
        video_url: BASE + 'ElephantsDream.mp4',
        created_at: '2026-07-20T09:00:00Z'
      },
      {
        id: 3,
        title: 'Attacking the castled king',
        description: null,
        category: 'Middlegame',
        thumbnail_url: BASE + 'images/ForBiggerBlazes.jpg',
        video_url: BASE + 'ForBiggerBlazes.mp4',
        created_at: '2026-07-02T09:00:00Z'
      },
      {
        /* Category "Tactics" is NOT one of the five the RN knows. The RN drops such a video from the
           list entirely; both ports fold it into Uncategorized. It is in the sample precisely so
           that deviation is something you can SEE rather than only read about. */
        id: 4,
        title: 'Forks, pins and skewers',
        description: 'A category the RN would have hidden.',
        category: 'Tactics',
        thumbnail_url: null,
        video_url: BASE + 'ForBiggerEscapes.mp4',
        created_at: '2026-06-11T09:00:00Z'
      }
    ]
  };

  /** The bytes, exactly as the bucket would serve them. */
  function manifestText() { return JSON.stringify(SAMPLE); }

  var API = { SAMPLE: SAMPLE, manifestText: manifestText };

  global.BiyaVideoSample = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
