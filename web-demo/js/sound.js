/* =============================================================================
 * sound.js — Sound effects
 * Port of Sound.swift's event mapping. Plays the app's real .mp3 files.
 *
 * Priority for a move sound (matches SoundManager.playMove), highest first:
 *   checkmate → game-over ·  check → check ·  castle → castling ·
 *   capture → capture ·  else → move
 * (A capture that gives check plays "check"; checkmate plays "game-over".)
 *
 * Exposes window.SoundManager. Classic <script>, no modules.
 * ========================================================================== */
(function (global) {
  'use strict';

  var BASE = 'assets/sounds/';
  var NAMES = ['move', 'capture', 'castling', 'check', 'game-over', 'game-start'];
  var LS_KEY = 'biya.soundEnabled';

  var audio = {};
  function preload() {
    for (var i = 0; i < NAMES.length; i++) {
      var a = new Audio(BASE + NAMES[i] + '.mp3');
      a.preload = 'auto';
      audio[NAMES[i]] = a;
    }
  }

  var enabled = true;
  try { enabled = global.localStorage.getItem(LS_KEY) !== '0'; } catch (e) { /* ignore */ }

  function play(name) {
    if (!enabled) return;
    var a = audio[name];
    if (!a) return;
    try {
      // clone so rapid consecutive sounds don't cut each other off
      var node = a.cloneNode(true);
      node.volume = 0.85;
      var pr = node.play();
      if (pr && pr.catch) pr.catch(function () {}); // ignore autoplay-policy rejections
    } catch (e) { /* ignore */ }
  }

  function playForMove(info) {
    // info: { status:'ongoing'|'check'|'checkmate'|'stalemate', capture:bool, castle:bool }
    var name;
    if (info.status === 'checkmate') name = 'game-over';
    else if (info.status === 'check') name = 'check';
    else if (info.castle) name = 'castling';
    else if (info.capture) name = 'capture';
    else name = 'move';
    play(name);
  }

  function playGameStart() { play('game-start'); }

  function setEnabled(v) {
    enabled = !!v;
    try { global.localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  function isEnabled() { return enabled; }

  preload();

  global.SoundManager = {
    play: play, playForMove: playForMove, playGameStart: playGameStart,
    setEnabled: setEnabled, isEnabled: isEnabled
  };
})(typeof window !== 'undefined' ? window : globalThis);
