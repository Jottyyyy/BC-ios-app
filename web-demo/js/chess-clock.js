/* chess-clock.js — the Chess Clock (client round 3, 2026-10-22).
 *
 * Browser twin of `Sources/BiyaherongCoachCore/ChessClock.swift` (the pure core) and
 * `DemoApp/Sources/BiyaherongUI/ChessClockScreen.swift` + `ChessClockMetrics.swift` (the screen).
 *
 * The one feature in the port with no original: neither the RN app nor the Laravel backend has a
 * clock. So there is no oracle, and the two languages check each other instead —
 * `tools/qa/chess_clock_check.js` runs the Swift `chess_clock` group's scripts through CORE below,
 * and compares every constant, preset and string between the two files.
 *
 * Two halves facing each other, the top one turned 180° for the player across the table; a bar
 * between them with close · reset · pause · time control · sound. Tap your half after you move.
 */
'use strict';

var BiyaChessClock = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);

  // =========================================================================================
  // CORE — the state machine. Pure: no timers, no clock reads; `now` is passed in, in ms.
  // =========================================================================================

  var SIDES = ['top', 'bottom'];
  function other(side) { return side === 'top' ? 'bottom' : 'top'; }

  // INVENTED (PORTING_NOTES.md), and equal to the Swift by chess_clock_check.js.
  var LIMITS = {
    minSeconds: 1, maxSeconds: 9 * 3600 + 59 * 60 + 59, maxBonusSeconds: 60,
    estimateMoves: 40, blitzFromSeconds: 180, rapidFromSeconds: 480, classicalFromSeconds: 1500
  };
  var FORMAT = { tenthsBelowMs: 10000, lowAtMs: 30000, criticalAtMs: 10000 };
  var BONUSES = ['none', 'increment', 'delay'];
  var CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'];
  var CATEGORY_LABELS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical' };

  function control(topSeconds, bottomSeconds, bonus, bonusSeconds) {
    return { topSeconds: topSeconds, bottomSeconds: bottomSeconds,
             bonus: bonus || 'none', bonusSeconds: bonusSeconds || 0 };
  }
  function fromMinutes(minutes, increment) {
    return control(minutes * 60, minutes * 60, increment > 0 ? 'increment' : 'none', increment);
  }
  function seconds(c, side) { return side === 'top' ? c.topSeconds : c.bottomSeconds; }
  function isOdds(c) { return c.topSeconds !== c.bottomSeconds; }
  function effectiveBonusSeconds(c) { return c.bonus === 'none' ? 0 : c.bonusSeconds; }

  function clamp(c) {
    function s(v) { return Math.min(Math.max(v | 0, LIMITS.minSeconds), LIMITS.maxSeconds); }
    var b = Math.min(Math.max(c.bonusSeconds | 0, 0), LIMITS.maxBonusSeconds);
    var bonus = BONUSES.indexOf(c.bonus) >= 0 ? c.bonus : 'none';
    return control(s(c.topSeconds), s(c.bottomSeconds), b === 0 ? 'none' : bonus, b === 0 ? 0 : b);
  }
  function sameControl(a, b) {
    return a.topSeconds === b.topSeconds && a.bottomSeconds === b.bottomSeconds
      && a.bonus === b.bonus && a.bonusSeconds === b.bonusSeconds;
  }

  function category(c) {
    var estimate = Math.max(c.topSeconds, c.bottomSeconds)
      + LIMITS.estimateMoves * effectiveBonusSeconds(c);
    if (estimate < LIMITS.blitzFromSeconds) return 'bullet';
    if (estimate < LIMITS.rapidFromSeconds) return 'blitz';
    if (estimate < LIMITS.classicalFromSeconds) return 'rapid';
    return 'classical';
  }

  function baseText(s) { return s % 60 === 0 ? String(s / 60) : wholeSeconds(s); }

  /** `5 | 3`, `1:30 | 0`, `5 | d3` for a delay, `5 / 1 | 1` for odds (top first). */
  function label(c) {
    var base = isOdds(c) ? baseText(c.topSeconds) + ' / ' + baseText(c.bottomSeconds)
                         : baseText(c.topSeconds);
    var bonusText = c.bonus === 'delay' ? 'd' + c.bonusSeconds : String(c.bonusSeconds);
    return base + ' | ' + (effectiveBonusSeconds(c) === 0 ? '0' : bonusText);
  }

  var DEFAULT = fromMinutes(5, 3);
  var PRESETS = [
    fromMinutes(1, 0), fromMinutes(1, 1), fromMinutes(2, 1),
    fromMinutes(3, 0), fromMinutes(3, 2), fromMinutes(5, 0), fromMinutes(5, 3),
    fromMinutes(10, 0), fromMinutes(10, 5), fromMinutes(15, 10), fromMinutes(20, 0),
    fromMinutes(30, 0), fromMinutes(30, 20), fromMinutes(60, 30), fromMinutes(90, 30)
  ];

  /** A fresh clock on `c`. Field names match the Swift struct, so the two read alike. */
  function create(c) {
    var k = clamp(c || DEFAULT);
    return {
      control: k, status: 'ready', active: null, white: null, flagged: null,
      topMoves: 0, bottomMoves: 0, lastBonused: null,
      topBank: k.topSeconds * 1000, bottomBank: k.bottomSeconds * 1000,
      turnUsedMs: 0, segmentStart: null
    };
  }
  function moves(s, side) { return side === 'top' ? s.topMoves : s.bottomMoves; }
  function bank(s, side) { return side === 'top' ? s.topBank : s.bottomBank; }
  function setBank(s, side, ms) { if (side === 'top') s.topBank = ms; else s.bottomBank = ms; }
  function turnElapsedMs(s, now) {
    return s.turnUsedMs + (s.segmentStart == null ? 0 : Math.max(0, now - s.segmentStart));
  }
  function chargedMs(s, now) {
    var used = turnElapsedMs(s, now);
    if (s.control.bonus !== 'delay') return used;
    return Math.max(0, used - effectiveBonusSeconds(s.control) * 1000);
  }
  function remainingMs(s, side, now) {
    var b = bank(s, side);
    if (side !== s.active || (s.status !== 'running' && s.status !== 'paused')) return Math.max(0, b);
    return Math.max(0, b - chargedMs(s, now));
  }
  function delayLeftMs(s, now) {
    if (s.control.bonus !== 'delay' || (s.status !== 'running' && s.status !== 'paused')) return 0;
    return Math.max(0, effectiveBonusSeconds(s.control) * 1000 - turnElapsedMs(s, now));
  }

  /** True exactly when this call raised the flag. */
  function tick(s, now) {
    if (s.status !== 'running' || !s.active || remainingMs(s, s.active, now) > 0) return false;
    setBank(s, s.active, 0);
    s.status = 'flagged';
    s.flagged = s.active;
    s.segmentStart = null;
    s.lastBonused = null;
    return true;
  }

  /** A player taps their half. Returns whether anything happened. */
  function press(s, side, now) {
    if (s.status === 'ready') {
      s.active = other(side);
      s.white = other(side);
      s.status = 'running';
      s.turnUsedMs = 0;
      s.segmentStart = now;
      s.lastBonused = null;
      return true;
    }
    if (s.status !== 'running' || side !== s.active) return false;
    if (tick(s, now)) return false;
    var left = remainingMs(s, side, now);
    var bonus = s.control.bonus === 'increment' ? effectiveBonusSeconds(s.control) * 1000 : 0;
    setBank(s, side, left + bonus);
    if (side === 'top') s.topMoves += 1; else s.bottomMoves += 1;
    s.lastBonused = bonus > 0 ? side : null;
    s.active = other(side);
    s.turnUsedMs = 0;
    s.segmentStart = now;
    return true;
  }

  function pause(s, now) {
    if (s.status !== 'running' || tick(s, now) || s.segmentStart == null) return;
    s.turnUsedMs += Math.max(0, now - s.segmentStart);
    s.segmentStart = null;
    s.status = 'paused';
  }
  function resume(s, now) {
    if (s.status !== 'paused') return;
    s.segmentStart = now;
    s.status = 'running';
  }
  /** Back to the start of the same control — in place, so a screen's reference stays valid. */
  function reset(s) { var f = create(s.control); Object.keys(f).forEach(function (k) { s[k] = f[k]; }); }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function wholeSeconds(sec) {
    var s = Math.max(0, sec);
    if (s >= 3600) return Math.floor(s / 3600) + ':' + pad2(Math.floor(s % 3600 / 60)) + ':' + pad2(s % 60);
    return Math.floor(s / 60) + ':' + pad2(s % 60);
  }
  /** Rounded UP, so `0:00.0` appears only when the flag falls. */
  function display(ms) {
    var t = Math.max(0, ms);
    var tenths = Math.floor((t + 99) / 100);
    if (tenths < FORMAT.tenthsBelowMs / 100) {
      return '0:' + pad2(Math.floor(tenths / 10)) + '.' + (tenths % 10);
    }
    return wholeSeconds(Math.floor((t + 999) / 1000));
  }
  function level(ms) {
    if (ms <= FORMAT.criticalAtMs) return 'critical';
    if (ms <= FORMAT.lowAtMs) return 'low';
    return 'normal';
  }

  var CORE = {
    SIDES: SIDES, other: other, LIMITS: LIMITS, FORMAT: FORMAT, BONUSES: BONUSES,
    CATEGORIES: CATEGORIES, CATEGORY_LABELS: CATEGORY_LABELS,
    control: control, fromMinutes: fromMinutes, seconds: seconds, isOdds: isOdds,
    effectiveBonusSeconds: effectiveBonusSeconds, clamp: clamp, sameControl: sameControl,
    category: category, baseText: baseText, label: label, DEFAULT: DEFAULT, PRESETS: PRESETS,
    create: create, moves: moves, remainingMs: remainingMs, delayLeftMs: delayLeftMs,
    press: press, tick: tick, pause: pause, resume: resume, reset: reset,
    display: display, wholeSeconds: wholeSeconds, level: level
  };

  // =========================================================================================
  // THE SCREEN — strings, metrics, persistence and DOM. Every string and number is in STR / MET,
  // compared key for key with ChessClockMetrics.swift by chess_clock_check.js.
  // =========================================================================================

  var STR = {
    title: 'Chess Clock', tapToStart: 'Tap to start', moves: 'Moves', white: 'White', black: 'Black',
    timesUp: "Time's up", winsOnTime: 'Wins on time', paused: 'Paused',
    timeControl: 'Time Control', custom: 'Custom', timePerPlayer: 'Time per player',
    oddsToggle: 'Different time per player', topPlayer: 'Top player', bottomPlayer: 'Bottom player',
    bonus: 'Bonus', bonusNone: 'None', bonusIncrement: 'Increment', bonusDelay: 'Delay',
    incrementHelp: 'Added to your clock after every move.',
    delayHelp: 'Your clock waits this long before it starts each turn.',
    minutes: 'min', seconds: 'sec', bonusSecondsUnit: 's',
    start: 'Start', cancel: 'Cancel',
    resetTitle: 'Reset the clock?', resetBody: 'The game in progress will be lost.', resetConfirm: 'Reset',
    close: 'Close', reset: 'Reset', pause: 'Pause', resume: 'Resume', sound: 'Sound',
    flagGlyph: '⏱', trophyGlyph: '🏆', homeEmoji: '⏱️'
  };

  // INVENTED (PORTING_NOTES.md). The palette is the app's own: gold, navy, and the green the
  // Play buttons use; the low/critical pair is Puzzle Turbo's amber and red.
  var MET = {
    readyFill: '#253552', waitingFill: '#1A2942', activeFill: '#2E9E57', activeFillEnd: '#45BF6E',
    lowFill: '#FDB022', criticalFill: '#E5484D', flaggedFill: '#B3261E', winnerFill: '#1A2942',
    barFill: '#0F1A2E', readyText: '#FFFFFF', waitingText: '#8BA3C7', activeText: '#FFFFFF',
    lowText: '#0F1A2E', criticalText: '#FFFFFF', winnerText: '#FDB022',
    chipFill: 'rgba(15, 26, 46, 0.35)',
    chipText: '#FFFFFF', gold: '#FDB022', pausedScrim: 'rgba(15, 26, 46, 0.55)',
    timeSizeRatio: 0.26, timeMaxSize: 112, timeMinScale: 0.4,
    movesSize: 15, chipSize: 13, chipIconSize: 18, bonusSize: 20, chipPaddingH: 12, chipPaddingV: 5,
    halfPadding: 20, barHeight: 64, barIconSize: 24, barButton: 48, bonusFlashMs: 1200,
    tickMs: 100, halfRadius: 0, sheetRadius: 20, sheetPadding: 18, chipGap: 8, chipRadius: 12,
    chipMinWidth: 64, chipPaddingVSheet: 10, sectionGap: 16, stepperButton: 40, minuteStep: 1,
    secondStep: 5, maxMinutes: 599, pressedOpacity: 0.92
  };

  var STORAGE_KEY = 'biya.clock.v1';

  /** `{ control, sound }`, defaulted and clamped — a bad or missing record never throws. */
  function loadPrefs() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { raw = null; }
    var c = raw && raw.control ? clamp(raw.control) : DEFAULT;
    return { control: c, sound: !(raw && raw.sound === false) };
  }
  function savePrefs(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (e) { /* this tab only */ }
  }

  /** What the Home tile says under its title: "Blitz · 5 | 3". */
  function homeSubtitle(c) { return CATEGORY_LABELS[category(c)] + ' · ' + label(c); }

  // ---- DOM --------------------------------------------------------------------------------
  var ui = null, clk = null, prefs = null, loop = null, wake = null, onExitCb = null;
  var lastFlash = { side: null, at: 0 };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }
  function sound(name) {
    if (!prefs || !prefs.sound) return;
    if (typeof SoundManager !== 'undefined' && SoundManager.play) SoundManager.play(name);
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* none */ } }

  var ICON = {
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M10 2h4"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
  };

  function applyMetrics(node) {
    var px = function (n) { return n + 'px'; };
    var map = {
      '--clk-ready': MET.readyFill, '--clk-waiting': MET.waitingFill, '--clk-active': MET.activeFill,
      '--clk-active-end': MET.activeFillEnd, '--clk-low': MET.lowFill, '--clk-critical': MET.criticalFill,
      '--clk-flagged': MET.flaggedFill, '--clk-winner': MET.winnerFill, '--clk-bar': MET.barFill,
      '--clk-ready-text': MET.readyText, '--clk-waiting-text': MET.waitingText,
      '--clk-active-text': MET.activeText, '--clk-low-text': MET.lowText,
      '--clk-critical-text': MET.criticalText, '--clk-winner-text': MET.winnerText,
      '--clk-chip': MET.chipFill, '--clk-chip-text': MET.chipText, '--clk-pressed': String(MET.pressedOpacity),
      '--clk-gold': MET.gold, '--clk-scrim': MET.pausedScrim,
      '--clk-time-max': px(MET.timeMaxSize), '--clk-moves-fs': px(MET.movesSize),
      '--clk-chip-fs': px(MET.chipSize), '--clk-chip-icon': px(MET.chipIconSize),
      '--clk-bonus-fs': px(MET.bonusSize),
      '--clk-chip-ph': px(MET.chipPaddingH), '--clk-chip-pv': px(MET.chipPaddingV),
      '--clk-pad': px(MET.halfPadding), '--clk-bar-h': px(MET.barHeight),
      '--clk-icon': px(MET.barIconSize), '--clk-btn': px(MET.barButton),
      '--clk-sheet-r': px(MET.sheetRadius), '--clk-sheet-pad': px(MET.sheetPadding),
      '--clk-gap': px(MET.chipGap), '--clk-chip-r': px(MET.chipRadius),
      '--clk-chip-minw': px(MET.chipMinWidth), '--clk-chip-pvs': px(MET.chipPaddingVSheet),
      '--clk-section-gap': px(MET.sectionGap), '--clk-stepper': px(MET.stepperButton)
    };
    Object.keys(map).forEach(function (k) { node.style.setProperty(k, map[k]); });
  }

  function half(side) {
    var h = el('button', 'clk-half clk-' + side);
    h.type = 'button';
    var chip = el('span', 'clk-chip');
    // The board's own king, not a ♔ / ♚ glyph — the browser draws ♚ as an emoji.
    var king = el('img', 'clk-chip-king');
    king.alt = '';
    var chipText = el('span', 'clk-chip-text');
    chip.appendChild(king); chip.appendChild(chipText);
    var moves = el('span', 'clk-moves');
    var time = el('span', 'clk-time');
    var bonus = el('span', 'clk-bonus');
    h.appendChild(moves); h.appendChild(chip); h.appendChild(time); h.appendChild(bonus);
    h.onclick = function () { onPress(side); };
    return { root: h, chip: chip, king: king, chipText: chipText, moves: moves, time: time, bonus: bonus };
  }

  function barButton(icon, labelText, fn) {
    var b = el('button', 'clk-btn');
    b.type = 'button';
    b.innerHTML = icon;
    b.setAttribute('aria-label', labelText);
    b.onclick = fn;
    return b;
  }

  function render(view, onExit) {
    leave();
    onExitCb = onExit;
    prefs = loadPrefs();
    clk = create(prefs.control);
    view.scrollTop = 0;
    view.innerHTML = '';
    view.classList.add('flush');
    var root = el('div', 'clk-view');
    applyMetrics(root);
    ui = { root: root, top: half('top'), bottom: half('bottom') };
    var bar = el('div', 'clk-bar');
    ui.close = barButton(ICON.close, STR.close, function () { leave(); if (onExitCb) onExitCb(); });
    ui.reset = barButton(ICON.reset, STR.reset, askReset);
    ui.pause = barButton(ICON.pause, STR.pause, togglePause);
    ui.timer = barButton(ICON.timer, STR.timeControl, openSheet);
    ui.sound = barButton(prefs.sound ? ICON.soundOn : ICON.soundOff, STR.sound, toggleSound);
    [ui.close, ui.reset, ui.pause, ui.timer, ui.sound].forEach(function (b) { bar.appendChild(b); });
    root.appendChild(ui.top.root); root.appendChild(bar); root.appendChild(ui.bottom.root);
    view.appendChild(root);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', onVisibility);
    }
    paint();
  }

  function onPress(side) {
    var wasReady = clk.status === 'ready';
    if (!press(clk, side, now())) { paint(); return; }
    buzz();
    sound(wasReady ? 'game-start' : 'move');
    if (clk.lastBonused) lastFlash = { side: clk.lastBonused, at: now() };
    startLoop();
    paint();
  }

  function startLoop() {
    if (loop) return;
    loop = setInterval(function () {
      if (tick(clk, now())) { sound('game-over'); buzz(); stopLoop(); }
      paint();
    }, MET.tickMs);
    lockScreen(true);
  }
  function stopLoop() {
    if (loop) { clearInterval(loop); loop = null; }
    lockScreen(false);
  }
  /** Screen Wake Lock where the browser has it — the Swift twin's `isIdleTimerDisabled`. */
  function lockScreen(on) {
    try {
      if (on && !wake && typeof navigator !== 'undefined' && navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () {});
      } else if (!on && wake) { wake.release(); wake = null; }
    } catch (e) { wake = null; }
  }
  /** Leaving the tab pauses the game — a clock that kept running behind a phone call is a loss. */
  function onVisibility() {
    if (document.hidden && clk && clk.status === 'running') { pause(clk, now()); stopLoop(); paint(); }
  }

  function togglePause() {
    if (clk.status === 'running') { pause(clk, now()); stopLoop(); }
    else if (clk.status === 'paused') { resume(clk, now()); startLoop(); }
    paint();
  }
  function toggleSound() {
    prefs.sound = !prefs.sound;
    savePrefs(prefs);
    ui.sound.innerHTML = prefs.sound ? ICON.soundOn : ICON.soundOff;
  }

  /** Reset asks first when there is a game to lose — the Swift `.confirmationDialog`. */
  function askReset() {
    if (clk.status === 'ready') { paint(); return; }
    if (clk.status === 'running') { pause(clk, now()); stopLoop(); paint(); }
    var scrim = el('div', 'clk-modal');
    var box = el('div', 'clk-modal-box');
    box.appendChild(el('div', 'clk-modal-title', STR.resetTitle));
    box.appendChild(el('div', 'clk-modal-body', STR.resetBody));
    var row = el('div', 'clk-modal-row');
    var no = el('button', 'clk-modal-no', STR.cancel);
    var yes = el('button', 'clk-modal-yes', STR.resetConfirm);
    no.onclick = function () { scrim.remove(); };
    yes.onclick = function () { scrim.remove(); stopLoop(); reset(clk); paint(); };
    row.appendChild(no); row.appendChild(yes); box.appendChild(row);
    scrim.appendChild(box);
    ui.root.appendChild(scrim);
  }

  /** 'w' / 'b' for the king beside White / Black, or null — ChessClockStrings.chipKing. */
  function chipKing(side) {
    if (clk.status === 'ready' || clk.status === 'flagged') return null;
    if (clk.status === 'paused' && clk.active === side) return null;
    return clk.white === side ? 'w' : 'b';
  }

  function halfState(side, t) {
    if (clk.status === 'flagged') return clk.flagged === side ? 'flagged' : 'winner';
    if (clk.status === 'ready') return 'ready';
    if (clk.active !== side) return 'waiting';
    var lv = level(remainingMs(clk, side, t));
    return lv === 'normal' ? 'active' : lv;
  }

  function paint() {
    if (!ui || !clk) return;
    var t = now();
    SIDES.forEach(function (side) {
      var h = ui[side];
      var state = halfState(side, t);
      h.root.className = 'clk-half clk-' + side + ' is-' + state
        + (clk.status === 'paused' ? ' is-paused' : '');
      h.time.textContent = display(remainingMs(clk, side, t));
      h.moves.textContent = STR.moves + ': ' + moves(clk, side);
      var chip = '';
      if (clk.status === 'ready') chip = STR.tapToStart;
      else if (clk.status === 'flagged') {
        chip = clk.flagged === side ? STR.flagGlyph + ' ' + STR.timesUp : STR.trophyGlyph + ' ' + STR.winsOnTime;
      } else if (clk.status === 'paused' && clk.active === side) chip = STR.paused;
      else chip = clk.white === side ? STR.white : STR.black;
      h.chipText.textContent = chip;
      var king = chipKing(side);
      h.king.style.display = king ? '' : 'none';
      if (king) h.king.src = 'assets/pieces/king-' + king + '.svg';
      var flash = lastFlash.side === side && t - lastFlash.at < MET.bonusFlashMs;
      h.bonus.textContent = flash ? '+' + effectiveBonusSeconds(clk.control) + STR.bonusSecondsUnit : '';
      h.root.setAttribute('aria-label', (side === 'top' ? STR.topPlayer : STR.bottomPlayer) + ', '
        + display(remainingMs(clk, side, t)));
    });
    ui.pause.innerHTML = clk.status === 'paused' ? ICON.play : ICON.pause;
    ui.pause.setAttribute('aria-label', clk.status === 'paused' ? STR.resume : STR.pause);
    ui.pause.disabled = !(clk.status === 'running' || clk.status === 'paused');
  }

  // ---- the time-control sheet --------------------------------------------------------------
  function openSheet() {
    if (clk.status === 'running') { pause(clk, now()); stopLoop(); paint(); }
    var draft = clamp(prefs.control);
    var odds = isOdds(draft);
    var scrim = el('div', 'clk-sheet-scrim');
    var sheet = el('div', 'clk-sheet');
    scrim.appendChild(sheet);
    function close() { scrim.remove(); }
    scrim.onclick = function (e) { if (e.target === scrim) close(); };

    function build() {
      sheet.innerHTML = '';
      sheet.appendChild(el('div', 'clk-sheet-title', STR.timeControl));
      CATEGORIES.forEach(function (cat) {
        var list = PRESETS.filter(function (p) { return category(p) === cat; });
        sheet.appendChild(el('div', 'clk-sheet-section', CATEGORY_LABELS[cat]));
        var row = el('div', 'clk-presets');
        list.forEach(function (p) {
          var b = el('button', 'clk-preset' + (sameControl(p, draft) ? ' is-on' : ''), label(p));
          b.type = 'button';
          b.onclick = function () { draft = clamp(p); odds = false; build(); };
          row.appendChild(b);
        });
        sheet.appendChild(row);
      });
      sheet.appendChild(el('div', 'clk-sheet-section', STR.custom));
      var tog = el('label', 'clk-toggle');
      var box = el('input'); box.type = 'checkbox'; box.checked = odds;
      box.onchange = function () {
        odds = box.checked;
        if (!odds) draft = control(draft.topSeconds, draft.topSeconds, draft.bonus, draft.bonusSeconds);
        build();
      };
      tog.appendChild(box); tog.appendChild(el('span', null, STR.oddsToggle));
      sheet.appendChild(tog);
      (odds ? ['top', 'bottom'] : ['both']).forEach(function (who) {
        var name = who === 'top' ? STR.topPlayer : who === 'bottom' ? STR.bottomPlayer : STR.timePerPlayer;
        var secs = who === 'bottom' ? draft.bottomSeconds : draft.topSeconds;
        function setSecs(v) {
          var s = Math.min(Math.max(v, LIMITS.minSeconds), MET.maxMinutes * 60 + 59);
          if (who === 'bottom') draft.bottomSeconds = s;
          else if (who === 'top') draft.topSeconds = s;
          else { draft.topSeconds = s; draft.bottomSeconds = s; }
          build();
        }
        var line = el('div', 'clk-time-row');
        line.appendChild(el('span', 'clk-time-name', name));
        line.appendChild(stepper(Math.floor(secs / 60), STR.minutes, function (d) { setSecs(secs + d * 60); }, MET.minuteStep));
        line.appendChild(stepper(secs % 60, STR.seconds, function (d) { setSecs(secs + d); }, MET.secondStep));
        sheet.appendChild(line);
      });
      sheet.appendChild(el('div', 'clk-sheet-section', STR.bonus));
      var seg = el('div', 'clk-seg');
      [['none', STR.bonusNone], ['increment', STR.bonusIncrement], ['delay', STR.bonusDelay]]
        .forEach(function (pair) {
          var b = el('button', 'clk-seg-btn' + (draft.bonus === pair[0] ? ' is-on' : ''), pair[1]);
          b.type = 'button';
          b.onclick = function () {
            draft.bonus = pair[0];
            if (pair[0] === 'none') draft.bonusSeconds = 0;
            else if (!draft.bonusSeconds) draft.bonusSeconds = DEFAULT.bonusSeconds;
            build();
          };
          seg.appendChild(b);
        });
      sheet.appendChild(seg);
      if (draft.bonus !== 'none') {
        var bl = el('div', 'clk-time-row');
        bl.appendChild(stepper(draft.bonusSeconds, STR.bonusSecondsUnit, function (d) {
          draft.bonusSeconds = Math.min(Math.max(draft.bonusSeconds + d, 1), LIMITS.maxBonusSeconds);
          build();
        }, 1));
        sheet.appendChild(bl);
        sheet.appendChild(el('div', 'clk-help', draft.bonus === 'delay' ? STR.delayHelp : STR.incrementHelp));
      }
      var actions = el('div', 'clk-sheet-actions');
      var cancel = el('button', 'clk-sheet-cancel', STR.cancel);
      cancel.onclick = close;
      var start = el('button', 'clk-sheet-start', STR.start + ' · ' + label(clamp(draft)));
      start.onclick = function () {
        prefs.control = clamp(draft);
        savePrefs(prefs);
        stopLoop();
        clk = create(prefs.control);
        close();
        paint();
      };
      actions.appendChild(cancel); actions.appendChild(start);
      sheet.appendChild(actions);
    }
    function stepper(value, unit, onStep, step) {
      var w = el('span', 'clk-stepper');
      var minus = el('button', 'clk-step', '−'); minus.type = 'button';
      var plus = el('button', 'clk-step', '+'); plus.type = 'button';
      minus.onclick = function () { onStep(-step); };
      plus.onclick = function () { onStep(step); };
      w.appendChild(minus);
      w.appendChild(el('span', 'clk-step-value', value + ' ' + unit));
      w.appendChild(plus);
      return w;
    }
    build();
    ui.root.appendChild(scrim);
  }

  function leave() {
    stopLoop();
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  return {
    CORE: CORE, STR: STR, MET: MET, STORAGE_KEY: STORAGE_KEY,
    loadPrefs: loadPrefs, savePrefs: savePrefs, homeSubtitle: homeSubtitle,
    render: render, leave: leave
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaChessClock; }
