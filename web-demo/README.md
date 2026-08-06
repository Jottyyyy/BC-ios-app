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

> Kung sa double-click ay mukhang ibang font (Segoe UI imbes na Nunito), normal lang 'yan — hina-harang
> ng ilang browser ang font files sa `file://`. Gamitin ang Live Server para maayos ito. Gumagana pa rin
> ang buong app kahit alin.

**Engine self-test:** buksan ang `index.html?selftest` → may lalabas na berdeng banner + console log
na nagpapatunay na tama ang move-generation (perft: 8902 / 197,281 / 97,862...). Patakbuhin ito
tuwing babaguhin mo ang `js/engine.js`.

---

## 🗂️ Ano ang laman

3-tab na phone app (tulad ng tunay):

- **Play** ⭐ — 5 coach opponents (Jaden Pogi 650 → Coach Pogi 2250). Tap-tap na paggalaw, promotion
  picker, undo, flip, sounds, spring animations, eval bar, at "pass & play" para 2-player.
- **Puzzles** — 10 verified na sample mate puzzles na may ELO rating (K=32, floor 400).
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
`piece-path` (default `assets/pieces`)

**Properties:** `.rules = { legalMovesFrom(fen, sq) → [{to, promotion|null}] }` · `.fen` · `.flipped` · `.interactive`

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
  js/engine.js          chess rules  (port ng ChessBoard.swift)
  js/ai.js              coach AI + 5 personas  (port ng ChessAI.swift)
  js/rating.js          ELO + tiers  (port ng Rating.swift)
  js/sound.js           event → mp3
  js/chess-board.js     ⭐ ang <chess-board> reusable component
  js/puzzles.js         sample puzzles
  js/app.js             3-tab app shell
  assets/               tunay na pieces, sounds, coach avatars, fonts (kopya)
```

## 📜 Credits
- **Piece art** — Uray M. János / Cburnett (Wikipedia set), **CC BY-SA**.
- **Nunito** font — SIL Open Font License.
- Engine, AI, rating, at UI — na-port/ginaya mula sa Swift source ng proyekto (`Sources/`, `DemoApp/`).

> Tandaan: **preview** ito para sa Windows — faithful sa hitsura at galaw, pero ang production/parity-tested
> na engine ay ang Swift na code pa rin sa `Sources/BiyaherongCoachCore/`.
