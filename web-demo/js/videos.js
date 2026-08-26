/* videos.js — Tutorial Videos, the browser twin of DemoApp/Sources/BiyaherongUI/VideoScreens.swift.
 *
 * Every number and colour comes from video-metrics.js, which gen_video_metrics.js emits from the
 * extraction; every word comes from video-strings.js. Nothing here is typed twice.
 *
 * The screen has FIVE states and the ORDER they are tested in is the product decision:
 *
 *     not premium    -> paywall            (an entitlement, and it is knowable offline)
 *     not configured -> "not published"    (we have nowhere to look; not the user's connection)
 *     offline        -> "Online Feature"
 *     loading / failed / empty / list
 *
 * Premium is tested FIRST, deliberately. The entitlement is decided on-device and is knowable with
 * the radio off, so it is the answer we are certain of -- and telling somebody to find wifi for a
 * screen they could not open with wifi would be a wasted trip.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
(function (global) {
  'use strict';

  var MET = global.BiyaVideoMetrics;
  var STR = global.BiyaVideoStrings;
  var LIB = global.BiyaVideoLibrary;
  var CC = global.BiyaContentClient;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Push every extracted number onto the root as a `--vid-*` custom property, so the CSS reads
      the same values the Swift does rather than a second copy of them. */
  function applyVars(node) {
    function set(prefix, block) {
      for (var key in block) {
        if (!Object.prototype.hasOwnProperty.call(block, key)) continue;
        for (var prop in block[key]) {
          if (!Object.prototype.hasOwnProperty.call(block[key], prop)) continue;
          var v = block[key][prop];
          if (typeof v !== 'number' && typeof v !== 'string') continue;
          var name = '--' + prefix + '-' + kebab(key) + '-' + kebab(prop);
          node.style.setProperty(name, typeof v === 'number' ? v + 'px' : String(v));
        }
      }
    }
    set('vid', MET.LIST);
    node.style.setProperty('--vid-thumb-w', MET.THUMB_W + 'px');
    node.style.setProperty('--vid-thumb-h', MET.THUMB_H + 'px');
  }

  function kebab(s) { return String(s).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }

  /* -- States ---------------------------------------------------------------- */

  function header(title, onBack) {
    var h = el('div', 'vid-header');
    // `nav-icon` is not decoration: it carries the shared icon size AND Apple's 44px minimum
    // hit width. `el`'s third argument is textContent, so the markup is set explicitly — an SVG
    // string assigned as text draws nothing at all.
    var back = el('button', 'vid-back nav-icon');
    back.innerHTML = BiyaIcons.back();
    back.onclick = onBack;
    h.appendChild(back);
    h.appendChild(el('div', 'vid-title', title));
    h.appendChild(el('div', 'vid-logo'));
    return h;
  }

  /* The empty, offline, failed and unpublished states -- one shape, four sets of words. Written once
     because they differ only in copy: four near-identical blocks is how one of them ends up with a
     different font size and nobody notices for a release. */
  function notice(glyph, title, message, sub, retryLabel, onRetry) {
    var box = el('div', 'vid-notice');
    box.appendChild(el('div', 'vid-notice-glyph', glyph));
    box.appendChild(el('div', 'vid-notice-title', title));
    box.appendChild(el('div', 'vid-notice-body', message));
    if (sub) box.appendChild(el('div', 'vid-notice-body', sub));
    if (retryLabel && onRetry) {
      var b = el('button', 'vid-cta', retryLabel);
      b.onclick = onRetry;
      box.appendChild(b);
    }
    return box;
  }

  function paywall(onSubscribe) {
    var box = el('div', 'vid-notice');
    box.appendChild(el('div', 'vid-notice-glyph', STR.STR.lockGlyph));
    box.appendChild(el('div', 'vid-notice-title', STR.STR.paywallLabel));
    box.appendChild(el('div', 'vid-notice-body', STR.STR.paywallMessage));
    box.appendChild(el('div', 'vid-notice-body', STR.STR.paywallSubtext));
    var b = el('button', 'vid-cta', STR.STR.subscribe);
    b.onclick = onSubscribe;
    box.appendChild(b);
    return box;
  }

  /* -- The list -------------------------------------------------------------- */

  function card(video, onPlay) {
    var meta = MET.categoryMeta(video.category);
    var b = el('button', 'vid-card');

    var thumb = el('div', 'vid-thumb');
    thumb.style.background = meta.chipBackground;
    if (video.thumbnailURL) {
      thumb.style.backgroundImage = 'url("' + video.thumbnailURL.replace(/"/g, '%22') + '")';
      thumb.style.backgroundSize = 'cover';
      thumb.style.backgroundPosition = 'center';
    }
    thumb.appendChild(el('div', 'vid-play', STR.STR.playGlyph));
    b.appendChild(thumb);

    var info = el('div', 'vid-info');
    var chip = el('div', 'vid-chip', meta.glyph + ' ' + video.category);
    chip.style.color = meta.accent;
    chip.style.background = meta.chipBackground;
    info.appendChild(chip);
    info.appendChild(el('div', 'vid-card-title', video.title));
    if (video.description) info.appendChild(el('div', 'vid-card-desc', video.description));
    b.appendChild(info);

    b.onclick = function () { onPlay(video); };
    return b;
  }

  function sectionHeader(section) {
    var meta = MET.categoryMeta(section.title);
    var h = el('div', 'vid-section');
    var accent = el('div', 'vid-accent');
    accent.style.background = meta.accent;
    h.appendChild(accent);
    // The StyleSheet gives the title no colour: index.tsx:176 sets it inline from the section
    // accent. Reading it from `meta` is that inline style, not an invention.
    var t = el('div', 'vid-section-title', meta.glyph + ' ' + section.title);
    t.style.color = meta.accent;
    h.appendChild(t);
    h.appendChild(el('div', 'vid-section-count', STR.count(section.videos.length)));
    return h;
  }

  /* -- Render ---------------------------------------------------------------- */

  /**
   * `state` is owned by the router, exactly as `openingForm` is: this module renders and reports,
   * and never decides when to fetch.
   */
  function render(view, state, cb) {
    view.innerHTML = '';
    var root = el('div', 'vid-root');
    applyVars(root);
    root.appendChild(header(STR.STR.title, cb.onExit));

    var body = el('div', 'vid-body');

    if (!state.isPremium) {
      body.appendChild(paywall(cb.onPaywall));
    } else if (!CC.isConfigured()) {
      body.appendChild(notice(STR.STR.emptyGlyph, STR.STR.notConfiguredTitle,
                              STR.STR.notConfiguredBody));
    } else if (state.error === CC.FAILURE.offline) {
      body.appendChild(notice(STR.STR.onlineGlyph, STR.STR.onlineTitle, STR.STR.offlineBody,
                              STR.STR.offlineSub, STR.STR.retry, cb.onRetry));
    } else if (state.error) {
      body.appendChild(notice(STR.STR.emptyGlyph, STR.STR.errorTitle, STR.STR.errorBody,
                              null, STR.STR.retry, cb.onRetry));
    } else if (state.loading) {
      body.appendChild(el('div', 'vid-notice-body', STR.STR.loading));
    } else if (!state.videos || !state.videos.length) {
      body.appendChild(notice(STR.STR.emptyGlyph, STR.STR.emptyTitle, STR.STR.emptySub));
    } else {
      // The standing note, shown even on the happy path: every other screen in this app works in
      // Airplane Mode, so one that quietly needs a connection is a surprise.
      body.appendChild(el('div', 'vid-online-note', STR.STR.onlineNote));
      LIB.sections(state.videos).forEach(function (section) {
        body.appendChild(sectionHeader(section));
        section.videos.forEach(function (v) { body.appendChild(card(v, cb.onPlay)); });
      });
    }

    root.appendChild(body);
    view.appendChild(root);
  }

  function emptyState() {
    return { isPremium: false, loading: false, loaded: false, error: null, videos: [] };
  }

  var API = { render: render, emptyState: emptyState };

  global.BiyaVideos = API;
  if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : globalThis);
