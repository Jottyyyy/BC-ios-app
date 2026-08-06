# web-demo — browser rebuild (Windows preview)

A zero-install rebuild of the app that runs in a browser, so changes are **visible on Windows** (the real
iOS/macOS app can't run there). It is faithful to the app's look and behavior, but it is a **preview only —
the parity-tested engine remains the Swift code in `Sources/`.** When you add a user-facing feature to the
app, **mirror it here** so the user can see it.

- **End-user run steps:** [`../web-demo/README.md`](../web-demo/README.md) — double-click
  `web-demo/index.html`, or use VS Code Live Server.
- **Engine self-test:** open `web-demo/index.html?selftest` → perft checks (8902 / 197,281 / 97,862) shown in
  a banner + console. Run it after editing `js/engine.js`.

## Page layout (site chrome)
`index.html` wraps the app in **website chrome**: a full-width top **banner** ("Biyaherong Chess App iOS"
branding, outside the app), a **hero** area, the app shown inside a **realistic phone frame**
(`.phone` bezel → `.statusbar` with a Dynamic-Island notch → `.app-card` screen → home indicator, correct
~390:844 proportions), and a **footer** with credits. Styled by the *Site chrome* section of `css/app.css`
(`.site-banner` / `.hero` / `.phone` / `.app-card` / `.statusbar` / `.site-footer`); fully responsive.
`app.js` still targets `#view`/`#tabbar`, so the app logic is independent of the surrounding page.

A **device picker** (`js/device.js`, dropdown in the hero) swaps the frame to any of several iPhones using
their **real screen dimensions** — iPhone SE (home button, short), 11/14 (notch), 15/16 (Dynamic Island).
It sets `--sar` (screen aspect) + `--pmm` (body width mm) on `.phone` and a style class; the choice persists
in `localStorage`. To add/adjust models, edit the `MODELS` array in `js/device.js`.

The **Puzzles tab is a fixed, non-scrolling** fill-height layout (`.puzzle-view` → compact rating card +
`.puz-board`): the board flexes to fill the leftover space and is sized with container-query units
(`min(100cqw, 100cqh)`) so it's the largest square that fits — edge-to-edge on tall phones, auto-shrunk &
centered on short ones. Keep it scroll-free when editing that tab.

The **chessboard renders edge-to-edge** (flush to the screen sides): `.board-row` / `.board-solo` use
`padding-inline: 0` and the board gets `--board-radius: 0` for square, flush corners.

## File map (`web-demo/`)

| File | Role | Ported from |
|---|---|---|
| `js/engine.js` | Chess rules: FEN, legal moves, castling/en-passant/promotion, SAN, check/mate, perft | `Sources/BiyaherongCoachCore/ChessBoard.swift` |
| `js/ai.js` | Coach AI: negamax + alpha-beta + PST eval + the 5 personas | `ChessAI.swift` |
| `js/rating.js` | ELO (K=32, floor 400), tiers, eval→win% | `Rating.swift`, `GameReview.swift` |
| `js/chess-board.js` | ⭐ the reusable `<chess-board>` Web Component (render + interaction + animation) | — (view layer) |
| `js/app.js` | 3-tab shell (Play / Puzzles / Profile); wires board ↔ engine ↔ AI; localStorage stats | mirrors `DemoApp` PhoneApp |
| `js/sound.js` | event → mp3 mapping | `Sound.swift` |
| `js/puzzles.js` | embedded sample puzzles (every one is an engine-verified mate) | — |
| `js/device.js` | iPhone model picker — sets the frame's real screen aspect ratio + bezel style | — (page chrome) |
| `css/theme.css`, `css/app.css` | design tokens + shell styling | `Theme.swift` |
| `assets/` | pieces, sounds, coach avatars, fonts (copied from the app) | — |

All scripts are classic `<script>` (no ES modules) and the AI runs on the main thread, so it works from
`file://` with no build step.

## The reusable `<chess-board>` component

View + interaction only — it **never mutates game state**. Give it a `rules` object; it fires a `move` event,
the app applies that move to the real engine, then calls `setPosition()` back (single source of truth stays
outside the component).

- **Attributes:** `fen` · `flipped` · `interactive` · `coordinates` · `piece-path`
- **Properties:** `.rules = { legalMovesFrom(fen, sq) → [{to, promotion|null}] }` · `.fen` · `.flipped` · `.interactive`
- **Methods:** `setPosition(fen, {animate, lastMove, check})` · `flip()` · `highlightLastMove(from,to)` ·
  `setCheck(sq|null)` · `showLegalTargets([sq])` · `clearSelection()`
- **Events:** `move` → `{from, to, promotion, uci}` · `square-select` → `{square}`
- **Theming (CSS vars, pierce the Shadow DOM):** `--board-light` `--board-dark` `--hl-last` `--hl-select`
  `--hl-check` `--board-max`

A full drop-in usage example is in [`../web-demo/README.md`](../web-demo/README.md).

## Adding to the demo

- **A gameplay/UI feature** → update `js/app.js` (+ `css/app.css`); reuse `<chess-board>` for anything with a
  board. If the *rules* changed in `Sources/`, port the same change into `js/engine.js` and re-run
  `index.html?selftest`.
- **View rendering contract:** each leaf renderer (`renderCoachSelect` / `renderGame` / `renderPuzzles` /
  `renderProfile`) clears `#view` at its start. Keep that when adding a screen — some transitions (start
  game, change opponent, next puzzle) call these directly and bypass `render()`; without the clear, the new
  screen stacks on top of the old one.
- **A new puzzle** → append to `js/puzzles.js` (`fen` + `solution` UCI line + `theme`/`rating`). Every
  committed puzzle must be a real, engine-legal line; mate puzzles must actually end in checkmate.
- **New piece art** → replace the SVGs in `assets/pieces/` (keep the `<kind>-<w|b>.svg` names) or set the
  `piece-path` attribute.
- After any change: open `index.html` to smoke-test (and `?selftest` if you touched `js/engine.js`), then log
  it in [`../CHANGELOG.md`](../CHANGELOG.md).
