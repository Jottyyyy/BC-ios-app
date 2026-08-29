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

  /* Where the manifest lives. Must stay byte-identical to ContentClient.swift's manifestURL --
   * replay_videos.js asserts it.
   *
   * The PUBLIC Laravel route, not /api/tutorial-videos: that one is inside auth:sanctum and this
   * app holds no token, so it would 401 forever. Both are served by TutorialVideoController off one
   * shared query, so the two doors cannot describe different catalogues.
   *
   * A deviation from spec §0.1 ("static files on R2/S3. No API."), recorded in PORTING_NOTES.md.
   * tools/content/generate_video_manifest.php still writes the static file if you would rather
   * serve it from a bucket -- point this there instead and nothing else changes.
   */
  var MANIFEST_URL = 'https://biyaherongchesscoach.com/api/content/tutorial-videos';

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

    expect(isConfigured(), 'the manifest has an address, so the screen fetches instead of '
      + 'reporting that nothing is published');
    expect(/^https:\/\/[^\/]+\/api\/content\/tutorial-videos$/.test(MANIFEST_URL),
      'and it is the PUBLIC route over TLS — /api/tutorial-videos is behind auth:sanctum and this '
      + 'app holds no token, so that path would 401 forever');

    // Exercised through an INJECTED transport, never the real `fetch`. Node has a global one, so
    // now that a URL is configured this line would otherwise put a live HTTP request inside the
    // gate — which fails on a plane and passes for the wrong reason everywhere else. selfTest()
    // returns synchronously and this resolves in a microtask, so it is a smoke path, not an
    // assertion; the parse behaviour it would check is asserted directly below.
    var done = [];
    videos(function () {
      return Promise.resolve({
        ok: true,
        text: function () { return Promise.resolve('{"videos":[]}'); }
      });
    }).then(function (r) { done.push(r); });

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
