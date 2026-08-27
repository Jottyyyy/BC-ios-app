/* coach-strings.js — every string Play vs Coach shows (spec 2.14), verbatim.
 *
 *     node -e "console.log(require('./web-demo/js/coach-strings.js').selfTest().summary)"
 *
 * Copy is copy: it is transcribed from the spec rather than extracted, because there is nothing in
 * the RN StyleSheets to derive it from. `CoachStrings.swift` is emitted from THIS table by
 * `gen_coach_metrics.js`, so the two languages cannot hold different words — only the interpolating
 * ones are shaped by hand, and the generator fails if this file grows or loses one.
 *
 * ## The six game-over lines appear twice, deliberately
 *
 * `coach-game.js` owns them too. It is pure domain logic and must not depend on a presentation
 * layer — a state machine that imports a string table is a state machine you cannot test without
 * one. So the duplication stays, and `selfTest` asserts the two copies are IDENTICAL. Allow the
 * duplication, forbid the divergence; the same trade the `PairingStrings` key-parity block makes.
 *
 * ## What is NOT here
 *
 * Eleven network-error strings, and the `Premium` coach-lock badge. There is no network and no lock:
 * the one-time purchase covers the whole offline half. Their absence is the feature.
 */
'use strict';

var BiyaCoachStrings = (function () {
  var isNode = (typeof module !== 'undefined' && module.exports);

  var STR = {
    // --- Coach Select (2.5) ---
    selectHeader: '♞ PLAY AGAINST THE ♞',
    selectFamily: 'BIYAHERONG COACH FAMILY BOTS',
    selectBlurb: 'Train your chess skills with fun AI opponents.',
    allowTakeBack: 'Allow Take Back',
    tagline: 'Kabyahe mo sa pag improve!!',
    subTagline: 'Train • Improve • Have Fun',
    elo: function (n) { return 'ELO ' + n; },
    blurbBeginner: 'Beginner friendly bot',
    blurbTricky: 'Tricky and unpredictable',
    blurbSharp: 'Sharp attacking style',
    blurbCalm: 'Calm positional player',

    // --- Colour Select (2.6) ---
    chooseSide: '♟ Choose Your Side ♟',
    white: 'White',
    whiteSub: 'You move first',
    black: 'Black',
    blackSub: function (coach) { return coach + ' goes first'; },
    unfinished: function (n, colour) {
      return 'Unfinished game · ' + n + ' moves as ' + colour;
    },
    resumeTitle: 'Continue Previous Game?',
    resumeBody: function (n, colour) {
      return 'You have an unfinished game — ' + n + ' moves played as ' + colour + '.';
    },
    resumeAsk: 'Would you like to continue or start fresh?',
    newGame: 'New Game',
    continueGame: 'Continue',
    /* The big glyph at the top of each Choose Your Side card. `play.tsx:1524` is
       `<Text style={styles.kingW}>♔</Text>` — a KING, alone, at 44pt, with the colour's name on the
       line below it in `colorNameW`.

       These used to read '⬜ White' / '⬛ Black', which put the word on the card TWICE — once here at
       44pt and again underneath at 17pt — and dropped the king entirely. Both languages had it, so
       the twin agreed with itself and nothing failed; only the RN source disagreed. A client
       reported it as "2x nasabi black and white". The names now match the RN element they render
       (`kingW`/`kingB`), which is also what `CoachPlay.kingWFontSize` styles them with. */
    kingWhite: '♔',
    kingBlack: '♚',

    // --- Game (2.7) ---
    gameOverWon: 'Game over — You won!',
    gameOver: 'Game over',
    gameOverDraw: 'Game over — Draw',
    reviewing: 'Reviewing game...',
    results: 'Results',
    premove: function (from, to) { return '⚡ ' + from + '→' + to; },
    live: 'LIVE',
    liveButton: '▶ Live',
    resign: 'Resign',
    resignTitle: 'Resign?',
    resignBody: function (coach) { return coach + ' will win this game.'; },
    keepPlaying: 'Keep Playing',
    takeBack: '↩ Take Back',

    // --- Promotion (2.7) ---
    choosePromotion: 'Choose Promotion',
    queen: 'Queen',
    rook: 'Rook',
    bishop: 'Bishop',
    knight: 'Knight',

    // --- Result modal (2.7) ---
    youWon: 'You Won!',
    youLost: 'You Lost',
    draw: 'Draw',
    rematch: 'Rematch',
    reviewGame: 'Review Game',

    // --- Game review (2.10) ---
    gameReview: 'GAME REVIEW',
    analyzing: function (done, total) {
      return 'Analyzing… ' + done + '/' + total;
    },
    you: 'You',
    accuracy: 'Accuracy',
    startReview: 'Start Review',

    // --- Game over reasons (2.4) ---
    //
    // Also in `coach-game.js`, which owns the state machine and cannot depend on this file.
    // `selfTest` pins the two copies together.
    drawThreefold: 'Draw by threefold repetition!',
    drawStalemate: "Stalemate — It's a draw!",
    drawFiftyMove: 'Draw by the fifty-move rule.',
    drawInsufficient: 'Draw — not enough material to mate.',
    drawGeneric: 'Draw! A well-balanced battle.',
    resigned: function (coach) { return 'You resigned. ' + coach + ' wins this round!'; },
  };

  /**
   * Strings the RN app had and this app must NOT.
   *
   * Kept as data rather than deleted silently, because "we removed the network errors" is a claim
   * worth being able to check. `selfTest` asserts none of them has crept back in.
   */
  var DELETED = [
    'Engine unavailable — your turn',
    'Could not load opening data. Please try again.',
    'Could not load opening data. Check your connection.',
    'Could not open game review.',
    'Analysis Failed',
    'Could not analyze the game. You can still review it manually.',
    'Review Manually',
    'Try Again',
    'Close',
    'Premium',
    'This may take 20-30 seconds',
  ];

  function selfTest() {
    var passed = 0, failures = [];
    function expect(c, what) { if (c) passed++; else failures.push(what); }
    function eq(got, want, what) {
      expect(got === want, what + ': got ' + JSON.stringify(got)
                           + ', want ' + JSON.stringify(want));
    }

    // --- the interpolating ones actually interpolate ---
    eq(STR.elo(1450), 'ELO 1450', 'the ELO badge');
    eq(STR.blackSub('Coach Pogi'), 'Coach Pogi goes first', 'Black plays second');
    eq(STR.unfinished(12, 'White'), 'Unfinished game · 12 moves as White', 'the resume chip');
    eq(STR.resumeBody(12, 'White'),
       'You have an unfinished game — 12 moves played as White.', 'the resume prompt');
    eq(STR.premove('e2', 'e4'), '⚡ e2→e4', 'the premove badge');
    eq(STR.resignBody('Jade'), 'Jade will win this game.', 'the resign prompt');
    eq(STR.analyzing(7, 60), 'Analyzing… 7/60', 'the review progress');
    eq(STR.resigned('Jude'), 'You resigned. Jude wins this round!', 'the resign result');

    // --- the six shared with the state machine are IDENTICAL ---
    //
    // Not "similar", not "equivalent". A game that ends with one wording and reports another is two
    // features disagreeing about what just happened.
    if (isNode) {
      var GAME = require('./coach-game.js');
      eq(STR.drawThreefold, GAME.STR.threefold, 'the threefold line matches coach-game');
      eq(STR.drawStalemate, GAME.STR.stalemate, 'the stalemate line matches');
      eq(STR.drawFiftyMove, GAME.STR.fiftyMove, 'the fifty-move line matches');
      eq(STR.drawInsufficient, GAME.STR.insufficient, 'the insufficient-material line matches');
      eq(STR.drawGeneric, GAME.STR.genericDraw, 'the generic draw matches');
      eq(STR.resigned('X'), GAME.STR.resign('X'), 'and the resign line matches');
    }

    // --- the three new endings are distinct from the generic one ---
    //
    // The whole point of spec 7 #31: the RN app collapsed the fifty-move rule and insufficient
    // material into the generic draw, so the player never learned why the game ended.
    expect(STR.drawFiftyMove !== STR.drawGeneric, 'the fifty-move rule reads differently');
    expect(STR.drawInsufficient !== STR.drawGeneric, 'so does insufficient material');
    expect(STR.drawFiftyMove !== STR.drawInsufficient, 'and the two differ from each other');

    // --- nothing deleted has crept back ---
    var live = Object.keys(STR)
      .map(function (k) { return typeof STR[k] === 'function' ? STR[k]('X', 'Y') : STR[k]; });
    DELETED.forEach(function (gone) {
      expect(live.indexOf(gone) < 0, 'the deleted string "' + gone + '" is still gone');
    });
    // No network vocabulary at all: there is no network.
    live.forEach(function (v) {
      expect(!/connection|network|offline\b|server|try again/i.test(v),
             'no network wording in "' + v + '"');
    });

    // --- structure ---
    var keys = Object.keys(STR);
    expect(keys.length > 45, keys.length + ' strings, expected 45+');
    var funcs = keys.filter(function (k) { return typeof STR[k] === 'function'; });
    eq(funcs.length, 8, 'exactly eight strings interpolate');
    keys.forEach(function (k) {
      var v = STR[k];
      if (typeof v === 'function') return;
      expect(typeof v === 'string' && v.length > 0, k + ' is a non-empty string');
      expect(v === v.trim(), k + ' has no stray whitespace');
    });

    return {
      passed: passed, failures: failures, ok: failures.length === 0,
      summary: failures.length === 0
        ? 'coach-strings: ' + passed + ' assertions passed'
        : 'coach-strings: ' + passed + ' passed, ' + failures.length + ' FAILED\n'
          + failures.slice(0, 20).map(function (f) { return '  x ' + f; }).join('\n'),
    };
  }

  return { STR: STR, DELETED: DELETED, selfTest: selfTest };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = BiyaCoachStrings; }
