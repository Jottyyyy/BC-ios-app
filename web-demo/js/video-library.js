/* video-library.js — the JS twin of Sources/BiyaherongCoachCore/VideoLibrary.swift.
 *
 *     node -e "console.log(require('./web-demo/js/video-library.js').selfTest().summary)"
 *
 * Parses the Tutorial Videos manifest and groups it into sections. No transport: this reads bytes
 * somebody else fetched, exactly as the Swift does, and `web-demo/js/content-client.js` is the one
 * file allowed to open the connection.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
(function (global) {
  'use strict';

  /** The order the sections appear in — `tutorial-videos/index.tsx:28`. */
  var CATEGORY_ORDER = ['Opening', 'Middlegame', 'Endgame', 'General', 'Uncategorized'];
  var UNCATEGORIZED = 'Uncategorized';

  /* Normalise a raw category into one of CATEGORY_ORDER.
   *
   * DEVIATION, deliberate. The RN builds sections as
   * `CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0)`, so a video whose category is not in
   * that list -- 'Tactics', a typo, a category added in the admin panel later -- is grouped and then
   * silently dropped. It appears nowhere, and nothing says so: the admin sees it saved and visible,
   * the app shows a catalogue missing it. Folding the unknown into Uncategorized puts a
   * mis-categorised video in the wrong section rather than in none. */
  function categoryKey(raw) {
    var t = String(raw == null ? '' : raw).trim();
    if (!t) return UNCATEGORIZED;
    return CATEGORY_ORDER.indexOf(t) >= 0 ? t : UNCATEGORIZED;
  }

  function stringValue(v) {
    if (typeof v === 'string') { var t = v.trim(); return t === '' ? null : t; }
    if (typeof v === 'number' && isFinite(v)) return String(v);
    return null;
  }

  function intValue(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string') {
      var t = v.trim();
      if (!/^-?\d+$/.test(t)) return null;
      return parseInt(t, 10);
    }
    return null;
  }

  /* Accepts `{videos: [...]}` -- the shape TutorialVideoController@index returns and the manifest
     copies -- or a bare `[...]`, because a hand-published file is very likely to be the array on its
     own and refusing it would be pedantry with a blank screen attached.

     A row with no usable id, title or video_url is skipped: a card that cannot play is worse than a
     card that is not there, because it looks like the feature is broken rather than like the
     catalogue is short. */
  function parse(text) {
    var root;
    try { root = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return []; }
    var rows;
    if (root && typeof root === 'object' && Array.isArray(root.videos)) rows = root.videos;
    else if (Array.isArray(root)) rows = root;
    else return [];

    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== 'object') continue;
      var id = intValue(row.id);
      if (id == null) continue;
      var title = stringValue(row.title);
      if (!title) continue;
      var url = stringValue(row.video_url);
      if (!url) continue;
      out.push({
        id: id,
        title: title,
        description: stringValue(row.description),
        category: categoryKey(stringValue(row.category)),
        videoURL: url,
        thumbnailURL: stringValue(row.thumbnail_url),
        createdAt: stringValue(row.created_at) || ''
      });
    }
    return out;
  }

  /* Order WITHIN a section is the manifest's own -- sort_order, then newest first, which is what the
     controller emits. Re-sorting here would quietly overrule whoever set sort_order in the admin. */
  function sections(videos) {
    var out = [];
    for (var i = 0; i < CATEGORY_ORDER.length; i++) {
      var cat = CATEGORY_ORDER[i];
      var matching = videos.filter(function (v) { return v.category === cat; });
      if (matching.length) out.push({ title: cat, videos: matching });
    }
    return out;
  }

  /* -- Self-test ------------------------------------------------------------- */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, w) { c ? passed++ : failures.push(w); }
    function eq(a, b, w) { expect(a === b, w + ': got ' + JSON.stringify(a)); }

    /* 1. The wrapped shape and the bare array are the same catalogue. */
    var one = '{"videos":[{"id":1,"title":"Ruy Lopez","category":"Opening","video_url":"a.mp4"}]}';
    var bare = '[{"id":1,"title":"Ruy Lopez","category":"Opening","video_url":"a.mp4"}]';
    eq(parse(one).length, 1, 'the wrapped shape parses');
    eq(parse(bare).length, 1, 'and so does a bare array');
    eq(parse(one)[0].title, 'Ruy Lopez', 'with the title');
    eq(parse(one)[0].videoURL, 'a.mp4', 'and the URL');

    /* 2. Nothing unplayable is ever shown. */
    eq(parse('[{"id":1,"title":"No URL"}]').length, 0, 'a row with no video_url is dropped');
    eq(parse('[{"id":1,"video_url":"a.mp4"}]').length, 0, 'so is one with no title');
    eq(parse('[{"title":"x","video_url":"a.mp4"}]').length, 0, 'and one with no id');
    eq(parse('[{"id":1,"title":"  ","video_url":"a.mp4"}]').length, 0,
      'a blank title is not a title');

    /* 3. Garbage in is an empty catalogue, never a throw. */
    eq(parse('not json').length, 0, 'unparseable text yields nothing');
    eq(parse('{"videos":"nope"}').length, 0, 'a non-array videos key yields nothing');
    eq(parse('null').length, 0, 'null yields nothing');
    eq(parse('[null,3,"x"]').length, 0, 'and rows that are not objects are skipped');

    /* 4. Tolerant readers — a manifest is published by hand or by a script that may change. */
    eq(parse('[{"id":"7","title":"x","video_url":"a.mp4"}]')[0].id, 7, 'a string id is an id');
    eq(parse('[{"id":1,"title":2,"video_url":"a.mp4"}]')[0].title, '2', 'a numeric title is text');
    eq(parse('[{"id":1,"title":"x","video_url":"a.mp4","description":null}]')[0].description, null,
      'a null description stays null');
    eq(parse('[{"id":1,"title":"x","video_url":"a.mp4","description":"  "}]')[0].description, null,
      'and so does a blank one');

    /* 5. Categories. The deviation is the fourth line and it is the point. */
    eq(categoryKey('Opening'), 'Opening', 'a known category is kept');
    eq(categoryKey(null), UNCATEGORIZED, 'a missing one is Uncategorized');
    eq(categoryKey('   '), UNCATEGORIZED, 'so is a blank one');
    eq(categoryKey('Tactics'), UNCATEGORIZED,
      'and an UNKNOWN one, which the RN drops from the list entirely');
    eq(categoryKey('opening'), UNCATEGORIZED, 'the match is exact — case is not guessed at');

    /* 6. Sections follow CATEGORY_ORDER, not the manifest, and empty ones vanish. */
    var many = parse(JSON.stringify({ videos: [
      { id: 1, title: 'E', category: 'Endgame', video_url: 'e.mp4' },
      { id: 2, title: 'O', category: 'Opening', video_url: 'o.mp4' },
      { id: 3, title: 'T', category: 'Tactics', video_url: 't.mp4' },
      { id: 4, title: 'O2', category: 'Opening', video_url: 'o2.mp4' }
    ] }));
    var secs = sections(many);
    eq(secs.map(function (s) { return s.title; }).join(','), 'Opening,Endgame,Uncategorized',
      'sections are ordered by CATEGORY_ORDER and Middlegame/General are absent');
    eq(secs[0].videos.length, 2, 'Opening holds both of its videos');
    eq(secs[0].videos.map(function (v) { return v.title; }).join(','), 'O,O2',
      'in the order the manifest gave them, never re-sorted');
    eq(secs[2].videos[0].title, 'T',
      'and the unknown category is VISIBLE under Uncategorized rather than dropped');
    eq(sections([]).length, 0, 'an empty catalogue has no sections');

    /* 7. Every video in equals every video out — nothing is lost between the two. */
    var total = secs.reduce(function (n, s) { return n + s.videos.length; }, 0);
    eq(total, many.length, 'grouping never loses a video');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'VideoLibrary: ' + passed + ' assertions passed'
        : 'VideoLibrary: ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  x ' + f; }).join('\n')
    };
  }

  var API = {
    CATEGORY_ORDER: CATEGORY_ORDER,
    UNCATEGORIZED: UNCATEGORIZED,
    categoryKey: categoryKey,
    parse: parse,
    sections: sections,
    selfTest: selfTest
  };

  global.BiyaVideoLibrary = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
