/* =============================================================================
 * device.js — iPhone model picker for the phone frame
 *
 * Lets the viewer choose which iPhone to show; the frame takes that model's REAL
 * screen aspect ratio (logical points, verified against public device references)
 * and body width (mm) so each model looks true to size and shape:
 *   SE → short & squarer (home button) · 11–14 → notch · 15/16 → Dynamic Island.
 *
 * Page chrome only — independent of the app. Sets CSS vars on `.phone`:
 *   --sar  = screen width / height (drives .app-card aspect-ratio + fit)
 *   --pmm  = body width in mm (relative on-screen size)
 * and swaps the style class (s-island / s-notch / s-home). Classic <script>.
 * ========================================================================== */
(function () {
  'use strict';

  // Real logical-point screen sizes + body width (mm). Sources: public iPhone
  // viewport references (yesviz / Apple device specs).
  var MODELS = [
    { id: 'se', name: 'iPhone SE', w: 375, h: 667, mm: 67.3, style: 'home' },
    { id: '11', name: 'iPhone 11', w: 414, h: 896, mm: 75.7, style: 'notch' },
    { id: '14', name: 'iPhone 14', w: 390, h: 844, mm: 71.5, style: 'notch' },
    { id: '15', name: 'iPhone 15', w: 393, h: 852, mm: 71.6, style: 'island' },
    { id: '16pro', name: 'iPhone 16 Pro', w: 402, h: 874, mm: 71.5, style: 'island' },
    { id: '15promax', name: 'iPhone 15 Pro Max', w: 430, h: 932, mm: 76.7, style: 'island' },
    { id: '16promax', name: 'iPhone 16 Pro Max', w: 440, h: 956, mm: 77.6, style: 'island' }
  ];
  var DEFAULT_ID = '15';
  var KEY = 'biya.device';

  var sel = document.getElementById('device-select');
  var phone = document.querySelector('.phone');
  if (!sel || !phone) return;

  MODELS.forEach(function (m) {
    var o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name + '  ·  ' + m.w + '×' + m.h;
    sel.appendChild(o);
  });

  function find(id) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i]; return null; }

  function apply(m) {
    phone.style.setProperty('--sar', (m.w / m.h).toFixed(4));
    phone.style.setProperty('--pmm', String(m.mm));
    phone.className = 'phone s-' + m.style;   // base class + one style class
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
  var initial = find(saved) || find(DEFAULT_ID);
  sel.value = initial.id;
  apply(initial);

  sel.addEventListener('change', function () {
    var m = find(sel.value);
    if (!m) return;
    apply(m);
    try { localStorage.setItem(KEY, m.id); } catch (e) { /* ignore */ }
  });
})();
