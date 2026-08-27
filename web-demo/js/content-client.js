/* content-client.js — the JS twin of DemoApp/Sources/BiyaherongUI/ContentClient.swift.
 *
 * Fetches the Tutorial Videos manifest. THE SECOND of the two files in the browser demo allowed to
 * open a connection, the first being opening-download.js.
 *
 * Spec §0.1 names both: "the only URLSession calls in the entire app live in ContentClient and
 * VideoPlayer", and tools/qa/replay_opening_tree.js §12 holds the list to exactly those two names in
 * each language. Adding a third means editing that list on purpose, which is the point of having
 * one.
 *
 * A transport with no opinions, over a parser in the parity core: nothing here knows what a video
 * is. video-library.js does.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
(function (global) {
  'use strict';

  var LIB = (typeof module !== 'undefined' && module.exports)
    ? require('./video-library.js')
    : global.BiyaVideoLibrary;

  /* Where the manifest lives.
   *
   * EMPTY until somebody publishes one. AWS_BUCKET is unset in the Laravel .env and the
   * tutorial_videos table has no rows, so there is no address to hard-code and inventing one would
   * produce a screen that fails in a way nobody could diagnose. Empty is handled: the list says the
   * catalogue is not published yet, which is true, instead of blaming the network.
   *
   *   1. php tools/content/generate_video_manifest.php
   *   2. upload build/tutorial-videos.json to the content bucket, publicly readable
   *   3. put its URL here AND in ContentClient.swift
   */
  var MANIFEST_URL = '';

  var FAILURE = { notConfigured: 'notConfigured', offline: 'offline', unreadable: 'unreadable' };

  function isConfigured() { return String(MANIFEST_URL).trim() !== ''; }

  /* Did the server hand back something shaped like a manifest, even an empty one?
     Distinguishes "no videos published" from "the bucket returned an HTML 404 page", which
     otherwise both parse to zero videos and would tell the user the same wrong thing. */
  function looksLikeCatalogue(text) {
    var root;
    try { root = JSON.parse(text); } catch (e) { return false; }
    if (Array.isArray(root)) return true;
    return !!(root && typeof root === 'object' && Array.isArray(root.videos));
  }

  /* Resolves to { videos } or { error }. Never throws: the screen has a state for each error and
     none for an exception. */
  function videos(fetchImpl) {
    // Written as a literal `fetch(` call rather than passing the function along, because the
    // §12 sweep looks for that call and a file that reaches the network through an indirection is
    // one the allow-list cannot see. The injectable parameter is for the self-test.
    var doFetch = fetchImpl
      || (typeof fetch === 'function' ? function (u, opts) { return fetch(u, opts); } : null);
    if (!isConfigured()) return Promise.resolve({ error: FAILURE.notConfigured });
    if (!doFetch) return Promise.resolve({ error: FAILURE.offline });

    return doFetch(MANIFEST_URL, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return { error: FAILURE.unreadable };
      return res.text().then(function (text) {
        var list = LIB.parse(text);
        // An EMPTY catalogue is not a failure -- a published manifest with no rows is exactly what
        // the "No Videos Yet" state is for. Only bytes that were not a catalogue at all are.
        if (!list.length && !looksLikeCatalogue(text)) return { error: FAILURE.unreadable };
        return { videos: list };
      });
    }).catch(function () {
      // Every transport error is reported as offline, deliberately. A DNS failure, a timeout and a
      // refused connection are the same thing to somebody holding a phone, and the action is the
      // same: check your connection.
      return { error: FAILURE.offline };
    });
  }

  /* -- Self-test ------------------------------------------------------------- */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }

    expect(!isConfigured(), 'no manifest is published yet, and the code says so rather than '
      + 'pretending an address exists');
    expect(MANIFEST_URL === '', 'the URL is empty, not a placeholder that would 404 confusingly');

    var done = [];
    videos(null).then(function (r) { done.push(r); });

    // `looksLikeCatalogue` is the whole difference between "no videos" and "that was an error page".
    expect(looksLikeCatalogue('{"videos":[]}'), 'an empty wrapped catalogue IS a catalogue');
    expect(looksLikeCatalogue('[]'), 'so is an empty array');
    expect(!looksLikeCatalogue('<!doctype html><h1>404</h1>'), 'an HTML error page is not');
    expect(!looksLikeCatalogue('{"message":"Unauthenticated."}'),
      'and neither is a Laravel auth error, which is what the API would return without a token');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'ContentClient: ' + passed + ' assertions passed'
        : 'ContentClient: ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  var API = {
    MANIFEST_URL: MANIFEST_URL,
    FAILURE: FAILURE,
    isConfigured: isConfigured,
    looksLikeCatalogue: looksLikeCatalogue,
    videos: videos,
    selfTest: selfTest
  };

  global.BiyaContentClient = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
