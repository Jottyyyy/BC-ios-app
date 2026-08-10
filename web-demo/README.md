# Biyaherong Chess Coach — Web Demo (para sa Windows) ♟️

Isang **browser-based na rebuild** ng Biyaherong Chess Coach na tumatakbo sa Windows mo —
**walang install, dodoble-click mo lang**. Ginawa ito para makita, ma-test, at mabago mo ang app
sa PC (hindi kayang patakbuhin ang tunay na iOS app sa Windows — walang iOS emulator para sa Windows,
Apple-only ang SwiftUI). Faithful na kopya ito: parehong **navy + gold theme**, tunay na **SVG pieces**
at **sounds**, at ang **chess engine + coach AI** ay direktang na-port mula sa Swift source ng project.

---

## ▶️ Paano patakbuhin

**Option 1 — Double-click (pinakamabilis):**
Buksan ang `index.html` sa Chrome o Edge. Tumatakbo agad. ✅

**Option 2 — VS Code Live Server (RECOMMENDED):**
Mas maganda ang experience (siguradong mag-load ang Nunito fonts, walgang `file://` quirks).
1. Sa VS Code, i-install ang **"Live Server"** extension (Ritwick Dey).
2. Right-click ang `web-demo/index.html` → **"Open with Live Server"**.

> **Bakit mas maganda ang Live Server:** kapag naka-serve ang page, tumatakbo ang chess engine sa
> sarili nitong **Worker thread**, kaya hindi kailanman humihinto ang animation habang nag-iisip ito.
> Sa double-click (`file://`) ay hindi kayang gumawa ng Worker ang browser, kaya sa main thread pa
> rin ito — pero hinati-hati na sa 80ms na piraso, kaya wala nang malaking freeze. Mababaw lang ang
> iisipin ng engine doon.

> Kung sa double-click ay mukhang ibang font (Segoe UI imbes na Nunito), normal lang 'yan — hina-harang
> ng ilang browser ang font files sa `file://`. Gamitin ang Live Server para maayos ito. Gumagana pa rin
> ang buong app kahit alin.

**Self-test:** buksan ang `index.html?selftest` → may lalabas na berdeng banner + console log na
nagpapatunay na tama ang move-generation (perft: 8902 / 197,281 / 97,862...) at ang home, engine
notation, move-tree at PGN na mga suite. Patakbuhin ito tuwing babaguhin mo ang `js/engine.js`,
`js/movetree.js`, `js/pgn.js`, `js/analysis-engine.js`, `js/review.js`, `js/opening-book.js`,
`js/analysis-metrics.js`, `js/analysis.js`, `js/analysis-store.js`, `js/position-editor.js`,
`js/chess-board.js` o `js/home.js`.

**Analysis Board:** pindutin ang **Analysis Board** tile sa Home. May live engine (3 linya + arrows),
move tree na may variations, ECO opening book, at autoplay. Hindi ito tab — tinatakpan nito ang tab
bar, at ang `←` ang babalik sa Home.

**Game review:** pindutin ang 🔬. Susuriin nito bawat posisyon ng main line (~200ms bawat isa) at
ipapakita ang accuracy ng White at Black, ang eval graph, at ang talaan ng klasipikasyon. May
progress bar at gumagana ang **Skip Analysis**. Pagkatapos, may maliit na simbolo (`!!`, `★`, `B`,
`??`…) ang bawat move sa move strip.

**I-save ang laro:** pindutin ang 💾 → lagyan ng title, players, event, ECO at folder → **Save**. Ang 📁
ang bubuksan ang library: may search, folder chips, at pwedeng gumawa/mag-delete ng folder. Kapag
dinelete mo ang isang folder, **hindi nawawala** ang mga laro nito — nagiging *Unfiled* lang. Tatlong
default folder (Opening Repertoire · Setup Position · My Games) ang awtomatikong ginagawa, at hindi
sila pwedeng palitan ng pangalan o burahin.

**☰ menu:** apat na seksyon — **Game** (New Game · Edit Board · Import PGN · Analyze Game), **File**
(Save · Load), **Share** (Copy PGN · Export PGN), **Settings** (Engine Arrows · Autoplay Speed · Board
Theme).

**Setup Position:** ☰ → **Edit Board**. May palette ng piyesa (pindutin ang piyesa, tapos ang square),
🗑️ Erase, 🧹 Clear, pampalit ng turn, at apat na castling chip. **Doble-tap** ang isang piyesa para alisin.
Kapag may mali sa posisyon — walang hari, magkatabi ang mga hari, may peon sa rank 1 o 8 — sasabihin sa iyo
bago ka makapag-**Apply Position**. Pwede ka ring mag-paste ng FEN at pindutin ang **Load**.

**PGN:** ☰ → **Import PGN** para mag-paste o pumili ng file — kasama ang mga variation at NAG. Ang mga
header (White, Black, Event, ECO…) ay awtomatikong pumupuno sa save form. ☰ → **Copy PGN** / **Export PGN**
para ilabas ito; eksakto ang round trip.

**Annotation:** pindutin nang matagal (400 ms) ang isang move sa strip → lalabas ang picker (`!!`, `?`,
`±`…). May maliit na bilog sa **kanang-baba** ng destination square para sa move-quality na annotation.
Pindutin nang matagal ang isang **branch chip** at ibang card ang lalabas: **Set as Main Line** o
**Delete Branch** (may kumpirmasyon).

**Draft (autosave):** kapag may nagalaw ka at umalis sa screen, awtomatikong nase-save ang draft
(800 ms pagkatapos ng huling galaw) at tahimik itong babalik pagbalik mo — walang tanong. Mag-e-expire
ito pagkatapos ng **24 oras**. Naka-imbak lahat sa `localStorage` (`biya.analysis.v1`).

---

## 🗂️ Ano ang laman

4-tab na phone app (tulad ng tunay):

- **Home** — ang landing dashboard: header, 3×2 grid ng anim na card, hourly na Taglish quote, at ang
  Donate / Membership banners. May Sky / Colorful na tema (pumili sa itaas ng phone).
- **Puzzles** — 10 verified na sample mate puzzles na may ELO rating (K=32, floor 400).
- **Play** ⭐ — 5 coach opponents (Jaden Pogi 650 → Coach Pogi 2250). Tap-tap na paggalaw, promotion
  picker, undo, flip, sounds, spring animations, eval bar, at "pass & play" para 2-player.
- **Profile** — rating, tier, stats, at ang 5 coaches. Naka-save sa `localStorage`.

---

## 🔧 Saan baguhin ang bawat bagay

| Gusto mong baguhin | I-edit ang file |
|---|---|
| **Kulay / tema** (navy, gold, board colors) | `css/theme.css` (mga CSS variable sa taas) |
| **Laki ng board** | `css/theme.css` → `--board-max`.  **Laki ng app column** → `--app-max` |
| **Ang chessboard mismo** (hitsura, galaw, animation) | `js/chess-board.js` — ang `<chess-board>` component |
| **Lakas / pangalan ng coaches** | `js/ai.js` → ang `COACHES` array (depth / blunderChance / randomness) |
| **Mga puzzle** | `js/puzzles.js` (tingnan ang format sa baba) |
| **Piece artwork** | palitan ang mga `.svg` sa `assets/pieces/`, o gamitin ang `piece-path` attribute |
| **Chess rules** (move gen, SAN, atbp.) | `js/engine.js` — tapos patakbuhin ang `?selftest` |
| **App layout / mga tab** | `js/app.js` + `css/app.css` |

---

## ⭐ Ang reusable component: `<chess-board>`

Ito ang hiniling mong **reusable na chessboard na may piece**. Isang standalone Web Component
(Shadow DOM) — pwede mong i-drop kahit saang HTML page:

```html
<chess-board fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"></chess-board>
```

Isa itong **view + interaction layer lang** — hindi nito binabago ang game state. Bigyan mo ito ng
`rules` object para malaman ang legal moves; kapag tapos ang isang galaw, magpi-**fire** ito ng `move`
event, at ang app ang mag-a-apply nito sa tunay na engine at tatawag ng `setPosition()` pabalik.

**Attributes:** `fen` · `flipped` · `interactive` (default true) · `coordinates` (default true) ·
`piece-path` (default `assets/pieces`) · `draggable-pieces` (default false)

**Properties:** `.rules = { legalMovesFrom(fen, sq) → [{to, promotion|null}] }` · `.fen` · `.flipped` ·
`.interactive` · `.draggablePieces` · `.arrows`

**Drag at arrows** (parehong naka-off by default, kaya walang nagbago sa Play at Puzzles):

```js
b.draggablePieces = true;                              // drag bukod sa tap-to-move
b.arrows = [{ from: 12, to: 28, rank: 0 }];            // rank 0/1/2 = green / blue / orange
b.arrows = [];                                         // burahin
```

Ang drag ay dumadaan sa **parehong** `move` event ng tap, kaya walang babaguhin sa caller. Kung hindi
umabot sa 4 px ang galaw, tap pa rin ito.

**Methods:** `setPosition(fen, { animate, lastMove:{from,to}, check:sq })` · `getPosition()` ·
`flip()` · `clearSelection()` · `highlightLastMove(from,to)` · `setCheck(sq|null)` · `showLegalTargets([sq])`

**Events:** `move` → `{ from, to, promotion, uci }` · `square-select` → `{ square }`

**Theming** (CSS variables, tumatagos sa Shadow DOM): `--board-light` `--board-dark` `--hl-last`
`--hl-select` `--hl-check` `--dot-color` `--ring-color` `--board-max` `--board-radius`

Minimal na halimbawa (playable board sa sariling page):
```html
<script src="js/engine.js"></script>
<script src="js/chess-board.js"></script>
<chess-board id="b"></chess-board>
<script>
  const b = document.getElementById('b');
  let pos = Engine.start();
  b.rules = { legalMovesFrom: (fen, sq) =>
    Engine.legalMovesFrom(Engine.fromFEN(fen), sq).map(m => ({ to: m.to, promotion: m.promotion })) };
  b.setPosition(Engine.toFEN(pos), { animate: false });
  b.addEventListener('move', e => {
    const m = Engine.legalMoves(pos).find(x =>
      x.from === e.detail.from && x.to === e.detail.to && (x.promotion ?? null) === e.detail.promotion);
    pos = Engine.makeMove(pos, m);
    b.setPosition(Engine.toFEN(pos), { lastMove: { from: m.from, to: m.to } });
  });
</script>
```

---

## 🧩 Magdagdag ng puzzle

Sa `js/puzzles.js`, mag-append sa `SAMPLE_PUZZLES`. Ang solver ay kung sino ang naka-move sa `fen`.
Ang `solution` ay UCI moves na **kahalili** (ikaw, kalaban, ikaw, ...):

```js
{ id: 'my-puzzle', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
  solution: ['a1a8'],              // mate-in-1 = isang move. Mate-in-2 = ['ikaw','sagot','ikaw']
  theme: 'Back-rank mate', objective: 'White to play, mate in 1', rating: 900 }
```
Pagkatapos, buksan ang `index.html?selftest`... (o i-verify na tama). Lahat ng kasamang puzzle ay
sinuri sa engine na tunay na checkmate.

---

## 📁 Files

```
web-demo/
  index.html            entry point
  css/theme.css         design tokens + Nunito fonts
  css/app.css           app shell + components
  js/engine.js          chess rules + SAN/UCI parsing + draw rules  (port ng ChessBoard.swift)
  js/ai.js              coach AI + 5 personas  (port ng ChessAI.swift)
  js/rating.js          ELO + tiers  (port ng Rating.swift)
  js/sound.js           event → mp3
  js/chess-board.js     ⭐ ang <chess-board> reusable component
  js/puzzles.js         sample puzzles
  js/home.js            home dashboard + pure metrics layer  (port ng HomeMetrics.swift)
  js/eco-data.js        ECO opening book, 7,854 posisyon  (GENERATED — build_eco.php)
  js/movetree.js        analysis move tree + variations  (port ng MoveTree.swift)
  js/pgn.js             PGN import/export  (port ng PGN.swift)
  js/analysis-engine.js analysis search: mates, PV, MultiPV  (port ng LocalEngine.swift)
  js/review.js          game review: classification + accuracy  (port ng GameReview.swift)
  js/opening-book.js    ECO lookup: pangalan ng opening, transpositions
  js/analysis-metrics.js  lahat ng numero ng Analysis Board  (port ng AnalysisMetrics.swift)
  js/analysis-store.js  ang library ng naka-save na laro  (port ng AnalysisStore.swift)
  js/position-editor.js Setup Position: paglalagay ng piyesa + validation  (port ng PositionEditor.swift)
  js/engine-host.js     kung saan tumatakbo ang engine: Worker kung naka-serve, in-thread kung file://
  js/analysis-worker.js ang engine sa sariling thread — kaya hindi na nagla-lag ang paggalaw
  js/analysis.js        ⭐ ang Analysis Board: pure session layer + ang buong screen
                          (port ng AnalysisSession.swift + AnalysisBoardScreen.swift)
  js/app.js             4-tab app shell + ang Analysis Board (galing sa Home tile)
  js/device.js          iPhone model picker (page chrome lang)
  assets/               tunay na pieces, sounds, coach avatars, fonts (kopya)
```

## 📜 Credits
- **Piece art** — Uray M. János / Cburnett (Wikipedia set), **CC BY-SA**.
- **Nunito** font — SIL Open Font License.
- Engine, AI, rating, at UI — na-port/ginaya mula sa Swift source ng proyekto (`Sources/`, `DemoApp/`).

> Tandaan: **preview** ito para sa Windows — faithful sa hitsura at galaw, pero ang production/parity-tested
> na engine ay ang Swift na code pa rin sa `Sources/BiyaherongCoachCore/`.
