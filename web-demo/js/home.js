/* Home screen — the browser mirror of DemoApp/Sources/BiyaherongUI/HomeScreen.swift
 *
 * A dark-navy, never-scrolling, single-viewport dashboard: header, a 3x2 grid of six equal cards,
 * an hourly-rotating Taglish quote, and two bottom banners.
 *
 * The top half of this file is the PURE layer and is a line-for-line mirror of HomeMetrics.swift —
 * the responsive scale, the tile identity, the quote rotation, expiry formatting and the
 * premium-outranks-colorful rule. `BiyaHome.selfTest()` asserts it, and because the file exports
 * itself under Node it can also be run headlessly:
 *
 *     node -e "console.log(require('./web-demo/js/home.js').selfTest().summary)"
 *
 * Keep the constants here and in HomeMetrics.swift in lockstep — a divergence between them is
 * exactly the drift this mirror exists to catch.
 *
 * Classic script, no ES modules, so it runs from file:// on Windows.
 */
var BiyaHome = (function () {
  'use strict';

  /* ===================== pure layer (mirrors HomeMetrics.swift) ===================== */

  var BASE_W = 375, BASE_H = 812, MIN_SCALE = 0.75, MAX_SCALE = 1.7;
  var INNER_ICON_RATIO = 0.67;

  /** clamp(min(w/375, h/812), 0.75, 1.7) — the smaller ratio so nothing overflows. */
  function scaleFor(size) {
    if (!size || !isFinite(size.width) || !isFinite(size.height) || size.width <= 0 || size.height <= 0) return 1;
    return Math.min(Math.max(Math.min(size.width / BASE_W, size.height / BASE_H), MIN_SCALE), MAX_SCALE);
  }

  /** Every card-interior size. NOTE the chain: iconCircle rounds the ALREADY-ROUNDED iconSize. */
  function metricsFor(scale) {
    var iconSize = Math.round(72 * scale);
    return {
      scale: scale,
      iconSize: iconSize,
      iconCircle: Math.round(iconSize * 0.85),
      iconInCircle: iconSize * INNER_ICON_RATIO,   // deliberately NOT rounded
      logoSize: Math.round(54 * scale),
      cardTitleSize: Math.round(15.5 * scale),
      cardSubSize: Math.round(11.5 * scale),
      cardGap: Math.round(10 * scale),
      cardPadding: Math.round(12 * scale),
      coachRingRadius: Math.round(16 * scale),
      ctaPaddingH: Math.round(10 * scale),
      ctaPaddingV: Math.round(4 * scale),
      ctaTextSize: Math.round(10 * scale)
    };
  }

  function metrics(size) { return metricsFor(scaleFor(size)); }

  /** The gap is the second thing to give way after the icon slot, on a tile too short for the full
   *  design. A no-op wherever there is room. Mirrors HomeScreenMetrics.cardGap(rowHeight:). */
  var GAP_TILE_FRACTION = 0.08;
  function cardGapFor(m, rowHeight) {
    return rowHeight > 0 ? Math.min(m.cardGap, rowHeight * GAP_TILE_FRACTION) : m.cardGap;
  }

  /** 3*h + 2*gap == content.height and 2*w + gap == content.width, exactly. Never rounded. */
  function tile(m, content) {
    return {
      width: Math.max(0, (content.width - m.cardGap) / 2),
      height: Math.max(0, (content.height - m.cardGap * 2) / 3)
    };
  }

  var HOUR = 3600;

  var QUOTES = [
    'Best move ko today… ikaw. ♟️',
    'Checkmate na sana… kaso ikaw iniisip ko.',
    'Kung chess tayo… ikaw yung queen ko.',
    'Hindi ko mahanap best move… kasi ikaw na yun.',
    'Opening ko today… usap tayo?',
    'Checkmate kita… pero sa puso.',
    'Focus sana sa board… pero ikaw lumalabas.',
    'Strategic move ko… kausapin ka.',
    'Kung puzzle ka… gusto kitang ma-solve.',
    'Blunder man move ko… ikaw pa rin goal ko.',
    'Knight move ako papunta sayo.',
    'Sa chess maraming queen… pero isa lang gusto ko.',
    'Checkmate na sana… pero napangiti mo ko.',
    'Hindi lang chess gusto kong ma-master… pati puso mo.',
    'Kung opening theory ka… aaralin kita buong araw.',
    'Kung ikaw puzzle… hindi ako susuko.',
    'Checkmate later… date muna.',
    'Best strategy… makilala ka.',
    'Kung move kita… di kita bibitawan.',
    'Sa chess may king… pero ikaw boss.'
  ];
  var ATTRIBUTION = '— Biyaherong Coach';

  /** Whole hours since the epoch, mod 20. Identical for every user in the same hour, stable across
   *  re-renders, advances by exactly one on the hour. Floor-mod so pre-1970 clocks stay in range. */
  function quoteIndex(epochSeconds) {
    var hours = Math.floor(epochSeconds / HOUR);
    var n = QUOTES.length;
    return ((hours % n) + n) % n;
  }
  function quoteText(epochSeconds) { return QUOTES[quoteIndex(epochSeconds)]; }
  function hourStart(epochSeconds) { return Math.floor(epochSeconds / HOUR) * HOUR; }
  function nextBoundary(epochSeconds) { return hourStart(epochSeconds) + HOUR; }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "Expires Sep 12, 2026". Built from a frozen table, not toLocaleDateString: modern CLDR spells
   *  English abbreviated September "Sept", and the design says "Sep". */
  function expiryText(date) {
    return 'Expires ' + MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  /** Premium's gold skin ALWAYS outranks the colorful purple — in both themes. */
  function membershipStyle(isPremium, isColorful) {
    if (isPremium) return 'premiumGold';
    return isColorful ? 'colorful' : 'standard';
  }
  function membershipTitle(isPremium) { return isPremium ? 'Premium Active' : 'Go Premium'; }
  function membershipEmoji(isPremium) { return isPremium ? '✈️' : '⭐'; }
  function membershipSubtitle(isPremium, endsAt) {
    if (!isPremium) return 'Unlock everything';
    if (!endsAt) return 'Active subscription';
    return expiryText(endsAt);
  }

  /* The six tiles, in reading order. `\n` is a hard break so two-word labels stay balanced. */
  var CARDS = [
    { id: 'puzzles', title: 'Play Puzzles', sub: 'Train Your Tactics', art: 'puzzle_knight.png', fill: '#4CAF50' },
    { id: 'analysis', title: 'Analysis Board', sub: 'Analyze Games', art: 'analysis.png', fill: '#FF9800' },
    { id: 'videos', title: 'Tutorial Videos', sub: 'Learn From FM Deniel', art: 'video_icon.png', fill: '#E91E63' },
    { id: 'openingTrainer', title: 'Opening Trainer', sub: 'Master Your Repertoire', art: 'opening_book.svg', fill: '#00BFA5' },
    { id: 'playCoach', title: 'Play with\nCoach', sub: null, art: 'app-icon.png', fill: '#1B1050' },
    { id: 'pairing', title: 'Pairing\nManager', sub: 'Tournaments', art: 'swiss.png', fill: '#0D2137' }
  ];
  /* Sky theme, Pairing only: the swiss art is too low-contrast on the translucent-blue backdrop. */
  var SWISS_ICON_BACKDROP = '#00BFA5';

  var DONATE = { emoji: '♟️', title: 'Donate', sub: 'Help sponsor\na student · ₱99' };

  /* ============================== self-check ============================== */

  function selfTest() {
    var passed = 0, failures = [];
    function expect(cond, what) { cond ? passed++ : failures.push(what); }
    function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.01 : tol); }
    function expectNear(a, b, what, tol) { expect(near(a, b, tol), what + ': got ' + a + ', expected ' + b); }

    // 1. scale + clamp
    expectNear(scaleFor({ width: 375, height: 812 }), 1.0, 'scale at the 375x812 baseline');
    expectNear(scaleFor({ width: 375, height: 667 }), 0.8214, 'scale on a 375x667 window');
    expectNear(scaleFor({ width: 320, height: 480 }), 0.75, 'scale clamps up to the floor');
    expectNear(scaleFor({ width: 1200, height: 1600 }), 1.7, 'scale clamps down to the ceiling');
    expectNear(scaleFor({ width: 1024, height: 1366 }), 1.6823, 'a 12.9" iPad is below the ceiling');
    expectNear(scaleFor({ width: 0, height: 0 }), 1.0, 'scale falls back to baseline on a zero container');
    expect(isFinite(scaleFor({ width: NaN, height: NaN })), 'scale is finite for NaN');

    // 2. derived metrics — the half-point cases are the ones that matter
    var table = [
      [0.75, { icon: 54, circle: 46, logo: 41, title: 12, sub: 9, gap: 8, pad: 9 }],
      [1.00, { icon: 72, circle: 61, logo: 54, title: 16, sub: 12, gap: 10, pad: 12 }],
      [1.70, { icon: 122, circle: 104, logo: 92, title: 26, sub: 20, gap: 17, pad: 20 }]
    ];
    table.forEach(function (row) {
      var m = metricsFor(row[0]), w = row[1], s = row[0];
      expectNear(m.iconSize, w.icon, 'iconSize at scale ' + s);
      expectNear(m.iconCircle, w.circle, 'iconCircle at scale ' + s);
      expectNear(m.logoSize, w.logo, 'logoSize at scale ' + s);
      expectNear(m.cardTitleSize, w.title, 'cardTitleSize at scale ' + s);
      expectNear(m.cardSubSize, w.sub, 'cardSubSize at scale ' + s);
      expectNear(m.cardGap, w.gap, 'cardGap at scale ' + s);
      expectNear(m.cardPadding, w.pad, 'cardPadding at scale ' + s);
    });
    expectNear(metricsFor(1.7).iconCircle, 104, 'iconCircle rounds the rounded iconSize');
    expectNear(metricsFor(0.75).iconInCircle, 36.18, 'iconInCircle is NOT rounded');
    expectNear(metricsFor(1.0).iconInCircle, 48.24, 'iconInCircle at scale 1');

    // 3. tile identity — six equal cards
    [{ width: 400, height: 300 }, { width: 347, height: 511.5 }, { width: 996, height: 1180 }].forEach(function (c) {
      [0.75, 1.0, 1.7].forEach(function (s) {
        var m = metricsFor(s), t = tile(m, c);
        expectNear(t.height * 3 + m.cardGap * 2, c.height, '3 rows + 2 gaps == grid height (' + c.width + 'x' + c.height + ' @' + s + ')', 1e-6);
        expectNear(t.width * 2 + m.cardGap, c.width, '2 cols + 1 gap == grid width (' + c.width + 'x' + c.height + ' @' + s + ')', 1e-6);
        expect(t.width > 0 && t.height > 0, 'tile is positive (' + c.width + 'x' + c.height + ' @' + s + ')');
      });
    });
    var tiny = tile(metricsFor(1.7), { width: 10, height: 10 });
    expect(tiny.width === 0 && tiny.height === 0, 'tile clamps to zero, never negative');

    // 3b. the gap gives way only on a tile too short for the design
    var roomy = metricsFor(1.0);
    expectNear(cardGapFor(roomy, 400), roomy.cardGap, 'innerGap is a no-op when there is room');
    expect(cardGapFor(roomy, 74) < roomy.cardGap, 'innerGap tightens on a very short tile');
    expectNear(cardGapFor(roomy, 0), roomy.cardGap, 'innerGap falls back to cardGap for a zero row');

    // 4. quote rotation
    expect(QUOTES.length === 20, 'there are exactly 20 quotes');
    expect(QUOTES.filter(function (q) { return !q; }).length === 0, 'no quote is empty');
    expect(new Set(QUOTES).size === 20, 'no quote is duplicated');
    expect(QUOTES[0].indexOf('♟') >= 0, 'quote 1 carries the pawn emoji');
    expect(QUOTES.filter(function (q) { return q.indexOf('...') >= 0; }).length === 0, 'quotes use the single-character ellipsis');
    expect(quoteIndex(0) === 0, 'index at the epoch is 0');
    expect(quoteIndex(3599) === 0, 'index is stable up to the boundary');
    expect(quoteIndex(3600) === 1, 'index advances exactly on the hour');
    expect(quoteIndex(20 * 3600 - 1) === 19, 'index reaches 19 before wrapping');
    expect(quoteIndex(20 * 3600) === 0, 'index wraps after 20 hours');
    expect(quoteIndex(-1) === 19, 'index floor-mods for pre-1970 instants');
    var stable = true, b = hourStart(1700000000);
    for (var o = 0; o < 3600; o += 137) { if (quoteIndex(b + o) !== quoteIndex(b)) stable = false; }
    expect(stable, 'the quote is constant within its hour');
    expect(hourStart(3659) === 3600, 'hourStart floors to the hour');
    expect(nextBoundary(3600) === 7200, 'nextBoundary is strictly after an exact boundary');

    // 5. expiry — local-time construction, so this is timezone-independent
    expect(expiryText(new Date(2026, 8, 12)) === 'Expires Sep 12, 2026', "expiry renders as 'Expires Sep 12, 2026'");
    expect(expiryText(new Date(2026, 0, 1)) === 'Expires Jan 1, 2026', 'expiry has no leading zero on the day');
    expect(MONTHS[8] === 'Sep', "September abbreviates to 'Sep', not 'Sept'");
    expect(membershipSubtitle(true, null) === 'Active subscription', 'premium with no expiry falls back');
    expect(membershipSubtitle(false, new Date(2026, 8, 12)) === 'Unlock everything', 'a free user never sees an expiry');

    // 6. premium outranks colorful — in BOTH themes
    expect(membershipStyle(true, true) === 'premiumGold', 'premium wins over colorful');
    expect(membershipStyle(true, false) === 'premiumGold', 'premium wins in the sky theme');
    expect(membershipStyle(false, true) === 'colorful', 'a free user in colorful gets purple');
    expect(membershipStyle(false, false) === 'standard', 'a free user in sky gets the standard banner');
    expect(membershipTitle(true) === 'Premium Active' && membershipEmoji(true) === '✈️', 'premium banner copy');
    expect(membershipTitle(false) === 'Go Premium' && membershipEmoji(false) === '⭐', 'free banner copy');

    // 7. the card matrix
    expect(CARDS.length === 6, 'there are exactly 6 cards');
    expect(CARDS[4].id === 'playCoach', 'Play with Coach is grid index 4');
    expect(CARDS[4].sub === null, 'the coach card has no subtitle — it has the CTA pill');
    expect(CARDS[4].title.indexOf('\n') > 0 && CARDS[5].title.indexOf('\n') > 0, 'the two hard-broken titles');
    expect(new Set(CARDS.map(function (c) { return c.fill; })).size === 6, 'every card has a distinct colorful fill');

    return {
      passed: passed,
      failures: failures,
      ok: failures.length === 0,
      summary: failures.length === 0
        ? 'HomeSelfTest: ' + passed + ' assertions passed'
        : 'HomeSelfTest: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.map(function (f) { return '  ✗ ' + f; }).join('\n')
    };
  }

  /* ============================== rendering ============================== */

  var ART = 'assets/images/';
  var state = { isColorful: false, isPremium: false, subscriptionEndsAt: null, userName: '' };
  var timer = null;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined && html !== null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /** Title/subtitle strings carry hard `\n` breaks. */
  function multiline(s) { return esc(s).replace(/\n/g, '<br>'); }

  /** The device screen — the basis for `scale`, mirroring the Swift host passing the phone shell. */
  function basisSize() {
    var card = document.querySelector('.app-card');
    if (!card) return { width: BASE_W, height: BASE_H };
    return { width: card.clientWidth, height: card.clientHeight };
  }

  function applyMetrics(root) {
    var m = metrics(basisSize());
    root.style.setProperty('--h-gap', m.cardGap + 'px');
    root.style.setProperty('--h-pad', m.cardPadding + 'px');
    root.style.setProperty('--h-icon', m.iconSize + 'px');
    root.style.setProperty('--h-icon-circle', m.iconCircle + 'px');
    root.style.setProperty('--h-icon-inner', m.iconInCircle + 'px');
    // Percentages, not pixels, for everything INSIDE the icon slot: the slot is allowed to shrink
    // when a row is too short for the full design (see the clamp note in css/app.css), and the
    // backdrop and artwork have to shrink with it. Mirrors HomeScreenMetrics.circleRatio.
    root.style.setProperty('--h-circle-pct', (m.iconCircle / m.iconSize * 100).toFixed(3) + '%');
    root.style.setProperty('--h-inner-pct', (INNER_ICON_RATIO * 100) + '%');
    root.style.setProperty('--h-logo', m.logoSize + 'px');
    root.style.setProperty('--h-title', m.cardTitleSize + 'px');
    root.style.setProperty('--h-sub', m.cardSubSize + 'px');
    root.style.setProperty('--h-ring-radius', m.coachRingRadius + 'px');
    root.style.setProperty('--h-cta-ph', m.ctaPaddingH + 'px');
    root.style.setProperty('--h-cta-pv', m.ctaPaddingV + 'px');
    root.style.setProperty('--h-cta-size', m.ctaTextSize + 'px');
    return m;
  }

  function cardIcon(card, isColorful) {
    var img = '<img src="' + ART + card.art + '" alt="">';
    if (isColorful) return '<span class="hc-icon bare">' + img + '</span>';
    var backdrop = card.id === 'pairing' ? ' style="background:' + SWISS_ICON_BACKDROP + '"' : '';
    return '<span class="hc-icon"><span class="hc-circle"' + backdrop + '></span>' + img + '</span>';
  }

  function buildCard(card, isColorful, onTap) {
    var b = el('button', 'home-card' + (isColorful ? ' colorful c-' + card.id : ''));
    if (card.id === 'playCoach') {
      // The ring sits in the SAME icon slot as the other five cards, so its title baseline lines
      // up with theirs — matching HomeCardView.coachRing.
      b.innerHTML =
        '<span class="hc-icon coach"><span class="hc-ring"><img src="' + ART + card.art + '" alt=""></span></span>' +
        '<span class="hc-title">' + multiline(card.title) + '</span>' +
        '<span class="hc-cta">PLAY NOW →</span>';
    } else {
      b.innerHTML =
        cardIcon(card, isColorful) +
        '<span class="hc-title">' + multiline(card.title) + '</span>' +
        '<span class="hc-sub">' + multiline(card.sub) + '</span>';
    }
    b.onclick = function () { if (onTap) onTap(card.id); };
    return b;
  }

  function buildBanner(opts) {
    var b = el('button', 'home-banner' + (opts.skin ? ' ' + opts.skin : ''));
    b.innerHTML =
      '<span class="hb-emoji">' + opts.emoji + '</span>' +
      '<span class="hb-title">' + esc(opts.title) + '</span>' +
      '<span class="hb-sub">' + multiline(opts.sub) + '</span>';
    b.onclick = function () { if (opts.onTap) opts.onTap(); };
    return b;
  }

  function paintQuote(root) {
    var now = Date.now() / 1000;
    var t = root.querySelector('.hq-text');
    if (t) t.textContent = quoteText(now);
  }

  /** Leaf renderer: owns its own clear of #view, per the contract in docs/web-demo.md. */
  function render(view, onTap) {
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');            // this screen never scrolls; kill .view's padding

    var root = el('div', 'home-view' + (state.isColorful ? ' colorful' : ''));
    applyMetrics(root);

    // Header — avatar | logo (centred) | search
    var header = el('div', 'home-header');
    var avatar = el('button', 'home-avatar');
    var initial = state.userName ? state.userName.trim().charAt(0).toUpperCase() : '?';
    avatar.innerHTML = '<span class="ha-initial">' + esc(initial) + '</span>' +
      (state.isPremium ? '<span class="ha-badge">✈️</span>' : '');
    avatar.onclick = function () { if (onTap) onTap('avatar'); };
    header.appendChild(avatar);
    header.appendChild(el('div', 'home-logo-wrap', '<span class="home-logo"><img src="' + ART + 'app-icon.png" alt=""></span>'));
    var search = el('button', 'home-search', '🔍');
    search.onclick = function () { if (onTap) onTap('search'); };
    header.appendChild(search);
    root.appendChild(header);

    // Grid — three equal rows of two equal tiles
    var grid = el('div', 'home-grid');
    for (var r = 0; r < 3; r++) {
      var row = el('div', 'home-row');
      for (var c = 0; c < 2; c++) row.appendChild(buildCard(CARDS[r * 2 + c], state.isColorful, onTap));
      grid.appendChild(row);
    }
    root.appendChild(grid);

    // Quote strip
    root.appendChild(el('div', 'home-quote',
      '<div class="hq-text"></div><div class="hq-attrib">' + esc(ATTRIBUTION) + '</div>'));

    // Bottom banners
    var banners = el('div', 'home-banners');
    banners.appendChild(buildBanner({
      emoji: DONATE.emoji, title: DONATE.title, sub: DONATE.sub,
      skin: state.isColorful ? 'sponsor' : '',
      onTap: function () { if (onTap) onTap('donate'); }
    }));
    var style = membershipStyle(state.isPremium, state.isColorful);
    banners.appendChild(buildBanner({
      emoji: membershipEmoji(state.isPremium),
      title: membershipTitle(state.isPremium),
      sub: membershipSubtitle(state.isPremium, state.subscriptionEndsAt),
      skin: style === 'premiumGold' ? 'premium' : (style === 'colorful' ? 'membership' : ''),
      onTap: function () { if (onTap) onTap('membership'); }
    }));
    root.appendChild(banners);

    view.appendChild(root);
    paintQuote(root);

    // Recompute the scalar when the device picker swaps the frame.
    if (window.ResizeObserver) {
      var card = document.querySelector('.app-card');
      if (card) {
        var ro = new ResizeObserver(function () { applyMetrics(root); });
        ro.observe(card);
      }
    }

    // Align the refresh to the hour boundary the index actually changes on, rather than firing an
    // hour after the screen happened to open (which would leave the quote up to 59 min stale).
    if (timer) { clearTimeout(timer); timer = null; }
    function schedule() {
      var now = Date.now() / 1000;
      timer = setTimeout(function () {
        if (!document.body.contains(root)) { timer = null; return; }   // screen left; stop
        paintQuote(root);
        schedule();
      }, Math.max(1000, (nextBoundary(now) - now) * 1000));
    }
    schedule();

    return root;
  }

  function setColorful(v) { state.isColorful = !!v; }
  function setPremium(v, endsAt) { state.isPremium = !!v; state.subscriptionEndsAt = endsAt || null; }

  return {
    // pure
    scaleFor: scaleFor, metricsFor: metricsFor, metrics: metrics, tile: tile, cardGapFor: cardGapFor,
    QUOTES: QUOTES, ATTRIBUTION: ATTRIBUTION, CARDS: CARDS,
    quoteIndex: quoteIndex, quoteText: quoteText, hourStart: hourStart, nextBoundary: nextBoundary,
    expiryText: expiryText, membershipStyle: membershipStyle,
    membershipTitle: membershipTitle, membershipEmoji: membershipEmoji, membershipSubtitle: membershipSubtitle,
    selfTest: selfTest,
    // view
    render: render, state: state, setColorful: setColorful, setPremium: setPremium
  };
})();

/* Makes the pure layer runnable headlessly under Node without changing the browser behaviour. */
if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaHome; }
