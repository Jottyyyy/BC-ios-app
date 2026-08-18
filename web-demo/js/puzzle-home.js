/* puzzle-home.js — Play Puzzles Home (spec Part 10.1).
 *
 * Browser mirror of `PuzzlePlayHomeScreen.swift`.
 *
 * The original was a leaderboard with a Play button. Offline there are no other players, so Part
 * 10.1 replaces it with the user's own statistics — strictly more useful, and computed from data
 * that already exists. Every one of those statistics is a pure function in `puzzle-stats.js`; this
 * file only draws them.
 *
 * Day one shows the rating card and one invitation instead of four blank charts. That is a
 * decision, not an omission: a fresh profile has zero attempts, and an empty sparkline over a 0.0%
 * accuracy over seven flat bars reads as a broken dashboard rather than a new one.
 */
'use strict';

var BiyaPuzzleHome = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET   = isNode ? require('./puzzle-metrics.js') : BiyaPuzzleMetrics;
  var STATS = isNode ? require('./puzzle-stats.js')   : BiyaPuzzleStats;
  var APP   = isNode ? require('./puzzle-app.js')     : BiyaPuzzleApp;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    var P = MET.PALETTE, H = MET.PLAY_HOME, S = MET.STATS, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card); set('--pz-card-alt', P.cardAlt);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary); set('--pz-gold', P.gold);
    set('--pzp-pad-h', H.headerPaddingH + 'px'); set('--pzp-pad-t', H.headerPaddingTop + 'px');
    set('--pzp-pad-b', H.headerPaddingBottom + 'px');
    set('--pzp-title-fs', T.homeTitle + 'px');
    set('--pzp-badge-fill', H.badgeFill); set('--pzp-badge-ph', H.badgePaddingH + 'px');
    set('--pzp-badge-pv', H.badgePaddingV + 'px'); set('--pzp-badge-r', H.badgeRadius + 'px');
    set('--pzp-badge-fs', T.homeBadge + 'px');
    set('--pzp-top-ph', H.topPaddingH + 'px'); set('--pzp-top-gap', H.topGap + 'px');
    set('--pzp-hero-r', H.heroRadius + 'px'); set('--pzp-hero-ph', H.heroPaddingH + 'px');
    set('--pzp-hero-pv', H.heroPaddingV + 'px'); set('--pzp-hero-gap', H.heroGap + 'px');
    set('--pzp-hero-border', H.heroBorderColor);
    set('--pzp-hero-emoji', T.homeHeroEmoji + 'px');
    set('--pzp-hero-title-fs', T.homeHeroTitle + 'px');
    set('--pzp-hero-sub-fs', T.homeHeroSub + 'px'); set('--pzp-hero-sub-mt', H.heroSubMarginTop + 'px');
    set('--pzp-statrow-fill', H.statRowFill); set('--pzp-statrow-r', H.statRowRadius + 'px');
    set('--pzp-statrow-ph', H.statRowPaddingH + 'px');
    set('--pzp-statrow-pv', H.statRowPaddingV + 'px');
    set('--pzp-stat-ph', H.statPaddingH + 'px'); set('--pzp-stat-icon', T.homeStatIcon + 'px');
    set('--pzp-stat-label', T.homeStatLabel + 'px'); set('--pzp-stat-mt', H.statLabelMarginTop + 'px');
    set('--pzp-div-w', H.dividerW + 'px'); set('--pzp-div-h', H.dividerH + 'px');
    set('--pzp-div-c', H.dividerColor);
    set('--pzp-bot-ph', H.bottomPaddingH + 'px'); set('--pzp-bot-pb', H.bottomPaddingBottom + 'px');
    set('--pzp-bot-pt', H.bottomPaddingTop + 'px'); set('--pzp-bot-gap', H.bottomGap + 'px');
    set('--pzp-info-fill', H.infoFill); set('--pzp-info-r', H.infoRadius + 'px');
    set('--pzp-info-ph', H.infoPaddingH + 'px'); set('--pzp-info-pv', H.infoPaddingV + 'px');
    set('--pzp-info-border', H.infoBorderColor); set('--pzp-info-fs', T.homeInfo + 'px');
    set('--pzp-info-lh', H.infoLineHeight + 'px');
    set('--pzp-share-fill', H.shareFill); set('--pzp-share-r', H.shareRadius + 'px');
    set('--pzp-share-pv', H.sharePaddingV + 'px'); set('--pzp-share-fs', T.homeShare + 'px');
    set('--pzp-play-fill', H.playFill); set('--pzp-play-r', H.playRadius + 'px');
    set('--pzp-play-pv', H.playPaddingV + 'px'); set('--pzp-play-fs', T.homePlay + 'px');
    set('--pzp-play-shadow', '0 ' + H.playShadowY + 'px ' + H.playShadowRadius + 'px rgba(92,194,100,'
      + H.playShadowOpacity + ')');
    set('--pzs-card-r', S.cardRadius + 'px'); set('--pzs-card-pad', S.cardPadding + 'px');
    set('--pzs-card-mb', S.cardMarginBottom + 'px');
    set('--pzs-section-fs', S.sectionTitleSize + 'px');
    set('--pzs-rating-fs', S.ratingSize + 'px'); set('--pzs-rating-label-fs', S.ratingLabelSize + 'px');
    set('--pzs-best-fs', S.bestSize + 'px'); set('--pzs-delta-fs', S.deltaSize + 'px');
    set('--pzs-spark-h', S.sparkHeight + 'px'); set('--pzs-spark-r', S.sparkRadius + 'px');
    set('--pzs-acc-fs', S.accuracySize + 'px'); set('--pzs-acc-sub-fs', S.accuracySubSize + 'px');
    set('--pzs-bar-h', S.barMaxHeight + 'px'); set('--pzs-bar-w', S.barWidth + 'px');
    set('--pzs-bar-r', S.barRadius + 'px'); set('--pzs-bar-count-h', S.barCountHeight + 'px');
    set('--pzs-bar-count-fs', S.barCountSize + 'px'); set('--pzs-bar-day-fs', S.barDaySize + 'px');
    set('--pzs-bar-empty', S.barEmptyFill); set('--pzs-bar-row-mt', S.barRowMarginTop + 'px');
    set('--pzs-theme-fs', S.themeNameSize + 'px'); set('--pzs-track-h', S.themeTrackHeight + 'px');
    set('--pzs-track-r', S.themeTrackRadius + 'px'); set('--pzs-track-fill', S.themeTrackFill);
    set('--pzs-pct-fs', S.themePctSize + 'px'); set('--pzs-pct-w', S.themePctMinWidth + 'px');
    set('--pzs-empty-fs', T.homeEmpty + 'px');
  }

  function card(titleText) {
    var c = el('div', 'pzs-card');
    if (titleText) c.appendChild(el('div', 'pzs-section', titleText));
    return c;
  }

  function ratingCard(sum) {
    var T = MET.STR;
    var c = card(null);
    var row = el('div', 'pzs-rating-row');
    var left = el('div', 'pzs-rating-left');
    left.appendChild(el('div', 'pzs-rating', String(sum.rating)));
    left.appendChild(el('div', 'pzs-rating-label', T.currentRating));
    row.appendChild(left);
    var right = el('div', 'pzs-rating-right');
    right.appendChild(el('div', 'pzs-rating-label', T.best));
    right.appendChild(el('div', 'pzs-best', String(sum.best)));
    row.appendChild(right);
    c.appendChild(row);
    var d = MET.deltaStyle(sum.weekDelta);
    var delta = el('div', 'pzs-delta', d ? d.text : '—');
    delta.style.color = d ? d.color : MET.PALETTE.textSecondary;
    c.appendChild(delta);
    return c;
  }

  function sparkCard(sum, width) {
    var S = MET.STATS;
    var spark = STATS.sparkline(APP.state(), width - S.sparkPadding, S.sparkHeight);
    if (!spark) return null;                       // fewer than two points draws nothing at all
    var c = card(null);
    var box = el('div', 'pzs-spark');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (width - S.sparkPadding) + ' ' + S.sparkHeight);
    svg.setAttribute('preserveAspectRatio', 'none');
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', spark.points.map(function (p) {
      return p.x.toFixed(2) + ',' + p.y.toFixed(2);
    }).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', S.sparkStroke);
    line.setAttribute('stroke-width', S.sparkStrokeWidth);
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    box.appendChild(svg);
    c.appendChild(box);
    return c;
  }

  function accuracyCard(sum) {
    if (!sum.accuracy) return null;
    var T = MET.STR;
    var c = card(T.accuracy);
    var big = el('div', 'pzs-acc', sum.accuracy.pct.toFixed(1) + '%');
    big.style.color = sum.accuracy.color;
    c.appendChild(big);
    c.appendChild(el('div', 'pzs-acc-sub',
      T.solvedOf(sum.accuracy.solved, sum.accuracy.attempted)));
    return c;
  }

  function activityCard(sum) {
    var T = MET.STR;
    var c = card(T.activity);
    var row = el('div', 'pzs-bars');
    sum.activity.forEach(function (d) {
      var col = el('div', 'pzs-bar-col');
      col.appendChild(el('div', 'pzs-bar-count', d.count > 0 ? String(d.count) : ''));
      var track = el('div', 'pzs-bar-track');
      var fill = el('div', 'pzs-bar-fill');
      fill.style.height = d.height + 'px';
      if (!d.filled) fill.classList.add('pzs-bar-empty');
      track.appendChild(fill);
      col.appendChild(track);
      // The first character of the localized short weekday, per Part 10.1.
      var parts = d.key.split('-');
      var dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
      var short = dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
      col.appendChild(el('div', 'pzs-bar-day', short.charAt(0)));
      row.appendChild(col);
    });
    c.appendChild(row);
    return c;
  }

  function themeCard(sum) {
    if (!sum.themes.length) return null;
    var c = card(MET.STR.themePerformance);
    sum.themes.forEach(function (t) {
      var row = el('div', 'pzs-theme-row');
      row.appendChild(el('div', 'pzs-theme-name', t.theme));
      var track = el('div', 'pzs-theme-track');
      var fill = el('div', 'pzs-theme-fill');
      fill.style.width = t.pct + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'pzs-theme-pct', t.pct + '%'));
      c.appendChild(row);
    });
    return c;
  }

  function render(view, onPlay, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var T = MET.STR;
    var root = el('div', 'pzp-view');
    applyMetrics(root);

    var header = el('div', 'pzp-header');
    var back = el('button', 'pzp-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzp-title', T.homeTitle));
    header.appendChild(el('div', 'pzp-badge', T.homeBadge));
    root.appendChild(header);

    var top = el('div', 'pzp-top');
    var hero = el('div', 'pzp-hero');
    hero.appendChild(el('div', 'pzp-hero-emoji', '♟️'));
    var htext = el('div', 'pzp-hero-text');
    htext.appendChild(el('div', 'pzp-hero-title', T.homeHeroTitle));
    htext.appendChild(el('div', 'pzp-hero-sub', T.homeHeroSub));
    hero.appendChild(htext);
    top.appendChild(hero);
    var statRow = el('div', 'pzp-statrow');
    T.homeStats.forEach(function (s, i) {
      if (i > 0) statRow.appendChild(el('div', 'pzp-divider'));
      var col = el('div', 'pzp-stat');
      col.appendChild(el('div', 'pzp-stat-icon', s.icon));
      col.appendChild(el('div', 'pzp-stat-label', s.label));
      statRow.appendChild(col);
    });
    top.appendChild(statRow);
    root.appendChild(top);

    // The stats band, scrollable.
    var body = el('div', 'pzp-body');
    var width = 360;   // the phone frame's content width; the sparkline is the only user
    var sum = STATS.summary(APP.state(), Date.now(), width - MET.STATS.sparkPadding,
                            MET.STATS.sparkHeight);
    body.appendChild(ratingCard(sum));
    if (sum.empty) {
      var empty = card(null);
      empty.appendChild(el('div', 'pzs-empty', T.statsEmpty));
      body.appendChild(empty);
    } else {
      [sparkCard(sum, width), accuracyCard(sum), activityCard(sum), themeCard(sum)]
        .filter(Boolean).forEach(function (c) { body.appendChild(c); });
    }
    root.appendChild(body);

    var bottom = el('div', 'pzp-bottom');
    bottom.appendChild(el('div', 'pzp-info', T.homeInfo));
    var share = el('button', 'pzp-share', T.homeShare);
    share.onclick = function () {
      // No URL: the hosted /share endpoints are gone (Part 21). The text is the whole payload.
      var text = T.shareText(APP.state().profile.rating);
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
    };
    bottom.appendChild(share);
    var play = el('button', 'pzp-play', T.homePlay);
    play.onclick = function () { if (onPlay) onPlay(); };
    bottom.appendChild(play);
    root.appendChild(bottom);

    view.appendChild(root);
  }

  return { render: render, applyMetrics: applyMetrics };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleHome; }
