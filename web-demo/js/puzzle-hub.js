/* puzzle-hub.js — the Puzzle Hub menu (spec Part 9) and the daily-goal strip (Part 15.2).
 *
 * Browser mirror of `PuzzleHubScreen.swift`. Stateless in the `HomeScreen.swift` sense: it takes a
 * routing closure and draws, and holds no state of its own — the counters come from
 * `puzzle-progress` through `puzzle-app`, and every number comes from `puzzle-metrics`.
 *
 * The goal strip is exported separately because Part 9.3 puts it on the hub but nothing stops a
 * later screen wanting it, and it is the one piece here with an animation.
 */
'use strict';

var BiyaPuzzleHub = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);
  var MET  = isNode ? require('./puzzle-metrics.js') : BiyaPuzzleMetrics;
  var APP  = isNode ? require('./puzzle-app.js')     : BiyaPuzzleApp;
  var PROG = APP.PROG;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function applyMetrics(node) {
    var P = MET.PALETTE, H = MET.HUB, G = MET.GOAL, T = MET.TYPE;
    var set = function (k, v) { node.style.setProperty(k, v); };
    set('--pz-bg', P.screenBg); set('--pz-card', P.card);
    set('--pz-text', P.textPrimary); set('--pz-text-2', P.textSecondary);
    set('--pz-gold', P.gold);
    set('--pzh-pad-h', H.headerPaddingH + 'px'); set('--pzh-pad-v', H.headerPaddingV + 'px');
    set('--pzh-back-w', H.backBtnW + 'px'); set('--pzh-back-h', H.backBtnH + 'px');
    set('--pzh-back-fs', T.hubBackIcon + 'px'); set('--pzh-title-fs', T.hubTitle + 'px');
    set('--pzh-hero-pt', H.heroPaddingTop + 'px');
    set('--pzh-hero-pb', H.heroPaddingBottom + 'px');
    set('--pzh-hero-gap', H.heroGap + 'px');
    set('--pzh-glow', H.heroGlowSize + 'px'); set('--pzh-glow-r', H.heroGlowRadius + 'px');
    set('--pzh-glow-fill', H.heroGlowFill); set('--pzh-glow-border', H.heroGlowBorderColor);
    set('--pzh-glow-bw', H.heroGlowBorder + 'px'); set('--pzh-glow-mb', H.heroGlowMarginBottom + 'px');
    set('--pzh-hero-title-fs', T.hubHeroTitle + 'px');
    set('--pzh-hero-sub-fs', T.hubHeroSub + 'px');
    set('--pzh-cards-pad-h', H.cardsPaddingH + 'px');
    set('--pzh-cards-pad-b', H.cardsPaddingBottom + 'px');
    set('--pzh-card-r', H.cardRadius + 'px'); set('--pzh-card-pv', H.cardPaddingV + 'px');
    set('--pzh-card-ph', H.cardPaddingH + 'px'); set('--pzh-card-bl', H.cardBorderLeft + 'px');
    set('--pzh-card-gap', H.cardGap + 'px');
    set('--pzh-card-shadow', '0 ' + H.cardShadowY + 'px ' + H.cardShadowRadius
      + 'px rgba(0,0,0,' + H.cardShadowOpacity + ')');
    set('--pzh-tile', H.tileSize + 'px'); set('--pzh-tile-r', H.tileRadius + 'px');
    set('--pzh-tile-bw', H.tileBorder + 'px'); set('--pzh-emoji-fs', T.hubEmoji + 'px');
    set('--pzh-card-title-fs', T.hubCardTitle + 'px');
    set('--pzh-card-title-mb', H.titleMarginBottom + 'px');
    set('--pzh-card-sub-fs', T.hubCardSub + 'px');
    set('--pzh-badge-ph', H.badgePaddingH + 'px'); set('--pzh-badge-pv', H.badgePaddingV + 'px');
    set('--pzh-badge-r', H.badgeRadius + 'px'); set('--pzh-badge-fs', T.hubBadge + 'px');
    set('--pzh-badge-ls', H.badgeLetterSpacing + 'px');
    set('--pzh-chev-fs', T.hubChevron + 'px'); set('--pzh-chev-lh', H.chevronLineHeight + 'px');
    set('--pzh-press', String(H.pressOpacity));
    // goal strip
    set('--pzg-r', G.radius + 'px'); set('--pzg-ph', G.paddingH + 'px');
    set('--pzg-pv', G.paddingV + 'px'); set('--pzg-border', G.borderColor);
    set('--pzg-mh', G.marginH + 'px'); set('--pzg-mb', G.marginBottom + 'px');
    set('--pzg-gap', G.rowGap + 'px'); set('--pzg-ring', G.ringSize + 'px');
    // No `--pzg-track`: the ring hands `G.ringTrack` straight to the circle's `stroke`
    // attribute below, so a CSS property for it was a second, unread copy of the same value.
    set('--pzg-label-fs', G.ringLabelSize + 'px');
    set('--pzg-title-fs', G.titleSize + 'px'); set('--pzg-sub-fs', G.subSize + 'px');
    set('--pzg-pill-fill', G.pillFill); set('--pzg-pill-r', G.pillRadius + 'px');
    set('--pzg-pill-ph', G.pillPaddingH + 'px'); set('--pzg-pill-pv', G.pillPaddingV + 'px');
    set('--pzg-pill-border', G.pillBorder); set('--pzg-pill-fs', G.pillTextSize + 'px');
    set('--pzg-anim', MET.STR ? '400ms' : '400ms');
  }

  /**
   * The daily-goal strip. An SVG ring rather than a conic gradient so the 400 ms sweep is a single
   * `stroke-dashoffset` transition, which animates on every browser and needs no repaint loop.
   */
  function goalStrip(status) {
    var G = MET.GOAL, T = MET.STR;
    var wrap = el('div', 'pzg');
    var size = G.ringSize, sw = G.ringStroke, r = (size - sw) / 2, c = 2 * Math.PI * r;
    var done = status.complete;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pzg-ring');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    function circle(color, offset) {
      var el2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      el2.setAttribute('cx', size / 2); el2.setAttribute('cy', size / 2); el2.setAttribute('r', r);
      el2.setAttribute('fill', 'none'); el2.setAttribute('stroke', color);
      el2.setAttribute('stroke-width', sw); el2.setAttribute('stroke-linecap', 'round');
      if (offset != null) {
        el2.setAttribute('stroke-dasharray', c);
        el2.setAttribute('stroke-dashoffset', offset);
        // Start at 12 o'clock, sweeping clockwise.
        el2.setAttribute('transform', 'rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')');
      }
      return el2;
    }
    svg.appendChild(circle(G.ringTrack, null));
    svg.appendChild(circle(done ? G.ringDoneColor : G.ringColor, c * (1 - status.progress)));

    var ring = el('div', 'pzg-ringwrap');
    ring.appendChild(svg);
    ring.appendChild(el('div', 'pzg-ringlabel' + (done ? ' pzg-done' : ''),
      done ? '✅' : String(status.solvedToday)));
    wrap.appendChild(ring);

    var col = el('div', 'pzg-col');
    col.appendChild(el('div', 'pzg-title', T.goalTitle));
    col.appendChild(el('div', 'pzg-sub',
      done ? T.goalComplete : T.goalProgress(status.solvedToday)));
    wrap.appendChild(col);

    if (status.goalStreak > 0) {
      wrap.appendChild(el('div', 'pzg-pill', T.goalStreak(status.goalStreak)));
    }
    return wrap;
  }

  /**
   * `onOpen(modeId)` receives one of the five ids. Only `play` is wired for now; the rest land in
   * phases D and E and route to a placeholder until they do, rather than doing nothing silently.
   */
  function render(view, onOpen, onExit) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');

    var root = el('div', 'pzh-view');
    applyMetrics(root);

    var header = el('div', 'pzh-header');
    var back = el('button', 'pzh-back nav-icon');
    // `el`'s third argument is textContent in most of
    // these files, so the markup has to be set explicitly.
    back.innerHTML = BiyaIcons.back();
    back.onclick = function () { if (onExit) onExit(); };
    header.appendChild(back);
    header.appendChild(el('div', 'pzh-title', MET.STR.hubTitle));
    header.appendChild(BiyaIcons.brandLogoEl('pzh-logo'));
    root.appendChild(header);

    var hero = el('div', 'pzh-hero');
    var glow = el('div', 'pzh-glow', MET.STR.hubHeroGlyph);
    hero.appendChild(glow);
    hero.appendChild(el('div', 'pzh-hero-title', MET.STR.hubHeroTitle));
    hero.appendChild(el('div', 'pzh-hero-sub', MET.STR.hubHeroSub));
    root.appendChild(hero);

    root.appendChild(goalStrip(PROG.dailyGoalStatus(APP.state(), Date.now())));

    var list = el('div', 'pzh-cards');
    MET.HUB_MODES.forEach(function (m) {
      var card = el('button', 'pzh-card');
      card.style.borderLeftColor = m.color;
      var tile = el('div', 'pzh-tile', m.emoji);
      // Hex alpha by byte concatenation, exactly as the source writes it — not a rounded percent.
      tile.style.background = MET.tint(m.color, MET.TINT_FILL);
      tile.style.borderColor = MET.tint(m.color, MET.TINT_BORDER);
      card.appendChild(tile);
      var info = el('div', 'pzh-info');
      info.appendChild(el('div', 'pzh-card-title', m.title));
      info.appendChild(el('div', 'pzh-card-sub', m.subtitle));
      card.appendChild(info);
      var right = el('div', 'pzh-right');
      var badge = el('div', 'pzh-badge', m.badge);
      badge.style.background = m.color;
      right.appendChild(badge);
      var chev = el('div', 'pzh-chev', '›');
      chev.style.color = m.color;
      right.appendChild(chev);
      card.appendChild(right);
      card.onclick = function () { if (onOpen) onOpen(m.id); };
      list.appendChild(card);
    });
    root.appendChild(list);

    view.appendChild(root);
  }

  return { render: render, goalStrip: goalStrip, applyMetrics: applyMetrics };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaPuzzleHub; }
