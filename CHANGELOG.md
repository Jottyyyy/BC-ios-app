# Changelog

All notable changes to this project are logged here, **newest first**. Dates are absolute (`YYYY-MM-DD`).
Loosely follows [Keep a Changelog](https://keepachangelog.com). **Every change should add an entry** — see
the **Workflow** section in [`CLAUDE.md`](CLAUDE.md).

Tags: **Added** (new feature) · **Changed** (behavior/refactor) · **Fixed** (bug) · **Docs**.
Each entry notes whether `web-demo/` was updated.

## [Unreleased]

### 2026-08-05

- **Changed** — `web-demo/`: the **Puzzles tab is now compact and never scrolls** (client preference). It's a
  fill-height flex layout: a compact one-row rating card (accuracy ring + rating + the puzzle's theme, merged
  from the old rating card + meta row + sparkline), and the board flexes to fill the leftover space — sized
  with container-query units (`min(100cqw, 100cqh)`) so it's the largest square that fits (edge-to-edge on
  tall phones, auto-shrunk & centered on short ones like the SE). 0px overflow on every device (iPhone 15 &
  SE screenshot-verified). Files: `web-demo/js/app.js`, `web-demo/css/app.css`. _(web-demo: this is the change.)_
- **Changed** — `web-demo/`: hid the scrollbars (the in-app `.view`, the move ribbon, and the page) for an
  app-like look — real iOS apps don't show a persistent scrollbar. Scrolling still works via
  wheel/trackpad/touch (verified: view still scrolls with the bar hidden, 0 page errors). File:
  `web-demo/css/app.css`. _(web-demo: updated — this is the change.)_
- **Fixed** — `web-demo/`: layout bugs the phone frame exposed ("text lagpas") — found & confirmed with
  **headless-Chrome screenshots**: (1) the view renderers (`renderGame` / `renderCoachSelect` /
  `renderPuzzles` / `renderProfile`) didn't clear `#view`, so starting a game / changing opponent **stacked**
  the new screen on top of the old one → overlapping text; they now clear `#view` first (some transitions
  call them directly, bypassing `render()`). (2) On short desktop windows the phone shrank to an unusably
  narrow strip (it was height-constrained); width is now driven by the real device size and the page scrolls
  instead. (3) Coach-card name/badge/rating overlapped at narrow widths → the header now wraps. (4) Profile
  "Your coaches" avatars overflowed the screen → responsive grid. Files: `web-demo/js/app.js`,
  `web-demo/css/app.css`. Added a "view cleared on game start" regression check (app boot now 20/20).
  _(web-demo: this is the fix.)_
- **Added** — `web-demo/`: an **iPhone model picker** (`js/device.js` + a dropdown in the hero). The phone
  frame now uses each model's **real screen dimensions** (verified against public iPhone viewport references)
  — iPhone SE (375×667, short, home button), iPhone 11/14 (notch), iPhone 15 / 16 Pro / Pro Max (Dynamic
  Island) — and remembers the choice in `localStorage`. This also fixes the "too tall" frame by letting you
  pick a shorter device. Files: `web-demo/index.html`, `web-demo/css/app.css`, `web-demo/js/device.js`.
  Verified: app boot 19/19 + picker 12/12 (jsdom). _(web-demo: updated — this is the change.)_
- **Changed** — `web-demo/`: the app now sits inside a **realistic phone frame** (bezel + Dynamic-Island
  notch + status bar + home indicator, correct ~390:844 proportions), and the **chessboard is edge-to-edge**
  (flush to the screen sides, square corners) in both Play and Puzzles. Files: `web-demo/index.html`,
  `web-demo/css/app.css`. jsdom smoke test green (19/19). _(web-demo: updated — this is the change.)_
- **Changed** — `web-demo/`: reworked from a centered phone column into a **website showcase** — a full-width
  top **banner** ("Biyaherong Chess App iOS", outside the app), a hero background, the app framed as a
  centered **device card**, and a footer with credits. Responsive; the in-app tabs/board are unchanged.
  Files: `web-demo/index.html`, `web-demo/css/app.css`. Verified: jsdom smoke test still green (19/19).
  _(web-demo: updated — this is the change.)_
- **Added** — `docs/` folder, this `CHANGELOG.md`, and a **Workflow** section in `CLAUDE.md` that codifies
  the process: read docs before working, log every change here, write a doc per feature under `docs/`, and
  mirror user-facing features into `web-demo/`. _(web-demo: n/a — process/docs only.)_
- **Added** — `CLAUDE.md`: first AI-assistant guide for the repo (commands, architecture, and the parity
  contract). _(web-demo: n/a.)_
- **Added** — `web-demo/`: a browser rebuild of the app that runs on **Windows with no install** — **Play**
  (5 coaches, tap-tap moves, promotion, undo/flip, sounds, animations, pass-and-play), **Puzzles** (10
  engine-verified mate puzzles + ELO rating), and **Profile** tabs; a reusable `<chess-board>` Web Component;
  and JavaScript ports of the Swift engine (`ChessBoard`), coach AI (`ChessAI`, 5 personas), and rating
  (`Rating`). Verified with perft (23 checks) + a headless jsdom integration pass. Docs:
  [`docs/web-demo.md`](docs/web-demo.md), [`web-demo/README.md`](web-demo/README.md).
  _(web-demo: this **is** the web-demo.)_
