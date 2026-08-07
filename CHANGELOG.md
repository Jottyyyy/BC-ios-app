# Changelog

All notable changes to this project are logged here, **newest first**. Dates are absolute (`YYYY-MM-DD`).
Loosely follows [Keep a Changelog](https://keepachangelog.com). **Every change should add an entry** — see
the **Workflow** section in [`CLAUDE.md`](CLAUDE.md).

Tags: **Added** (new feature) · **Changed** (behavior/refactor) · **Fixed** (bug) · **Docs**.
Each entry notes whether `web-demo/` was updated.

## [Unreleased]

### 2026-08-06

- **Added** — the **home screen**, the app's landing dashboard, ported from the React Native app's
  `app/(app)/user/home.tsx` (its real StyleSheet numbers, not prose). A dark-navy, never-scrolling,
  single-viewport screen: header (avatar · logo · search), a 3×2 grid of six equal cards, an
  hourly-rotating Taglish quote, and Donate / Membership banners. Presentation only — no networking, no
  persistence, no navigation; every value is a view input and every tap a caller-supplied closure. Wired
  as **tab 0** of `PhoneApp`; only the three callbacks with a real destination today (Puzzles, Play,
  Profile) are connected, the other seven stay empty. Files: `DemoApp/Sources/BiyaherongUI/{HomeMetrics,
  HomeScreen,HomeParts,HomeArt,HomeMetricsCheck}.swift`, `DemoApp/Sources/HomeMetricsCheck/main.swift`,
  `DemoApp/Sources/BiyaherongUI/Images/`, `DemoApp/Package.swift`, `PhoneView.swift`, `Theme.swift`,
  `Diagnostics.swift`, `docs/home-screen.md`. _(web-demo: mirrored — new `js/home.js`, a `---- Home ----`
  section in `css/app.css`, the Colorful fills in `css/theme.css`, and Device / Home-theme / Membership
  pickers in the hero.)_
- **Added** — `HomeMetricsCheck`, a runnable self-check executable for the home screen's pure layer
  (responsive scale and every derived size, the tile identity behind the six equal cards, the fit clamps,
  the quote rotation, expiry formatting, the premium-outranks-colorful rule, and that the bundled art
  resolves). Follows the `PieceArtCheck` precedent since this toolchain has no XCTest. Its JS twin,
  `BiyaHome.selfTest()`, runs anywhere — **92 assertions, all passing** — and is folded into
  `web-demo/index.html?selftest`. This is only possible because no view body contains a numeric literal or
  arithmetic; every number is a pure function in `HomeMetrics.swift`. _(web-demo: `js/home.js`, `js/app.js`.)_
- **Added** — the six home art assets under `DemoApp/Sources/BiyaherongUI/Images/` (`.copy`, so every
  lookup passes `subdirectory:`), mirrored into `web-demo/assets/images/`. Two of them needed work: the
  RN app's `analysis.svg` and `video_icon.svg` were **not vectors** — each was a three-line `<svg>`
  wrapping a base64 `<image>`, which `SVGVector` rejects outright (`SVGVector.swift:311`), and whose
  `fill="#FFFFFF"` prop was already a no-op in RN — so their payloads were decoded back to the PNGs they
  always were. `opening_book.svg` was ported from the RN repo with its alpha **baked into 8-digit hex**,
  because `SVGState.inheritable` never reads `opacity`/`fill-opacity`/`stroke-opacity` and a verbatim copy
  would paint a solid-black knight. `Diagnostics.swift` now counts them so a missing `Package.swift`
  resource entry fails loudly instead of rendering blank cards.
- **Added** — `Theme.nunitoItalic`. SwiftUI's `.italic()` is a **silent no-op** on a family with no italic
  face — it requests the symbolic trait, CoreText finds no match, and the text renders upright — and Nunito
  ships only Regular…ExtraBold. The quote strip is specified italic, so this shears the real face via a
  CTFont matrix. `Theme.c(_:_:)` was also de-privatised so `HomePalette` builds its colours through the
  same helper instead of duplicating the sRGB construction. _(web-demo: n/a — CSS synthesises obliques.)_
- **Changed** — the grid's tiles use an explicit `.frame(width:height:)` rather than
  `.frame(maxHeight: .infinity)`. A flexible frame lets a child return *more* than the height proposed to
  it, so one card whose content exceeded its third would overflow the stack and quietly steal height from
  the other two rows; all six tiles now come from one `HomeTileSize`, making "six pixel-identical cards" a
  property of the construction. Likewise the quote strip is pinned to its two-line height instead of
  hugging — a hugging strip would be one line tall for some quotes and two for others, resizing all six
  tiles at the top of every hour. _(web-demo: same two fixes in `css/app.css`.)_
- **Fixed** — the design is over-constrained inside a tab bar on **every** device, not just small ones: the
  original home is a full-height Stack screen with no tab bar, so hosting it as tab 0 costs ~74 pt straight
  out of the grid (a 4.7" phone gets ~74–93 pt per row against the ~115 pt the full card content wants).
  Rather than clip a label, the icon slot now shrinks first and the card's internal gap second
  (`HomeScreenMetrics.iconBox` / `.innerGap`, mirrored by `flex: 0 1` and `gap: min(var(--h-gap), 8%)` in
  CSS), so artwork renders at roughly 50–75% of its nominal size while every other metric stays exactly the
  spec. Verified with headless-Chrome measurements across **7 devices × 2 themes = 14 combos**: no title,
  subtitle or CTA clipped anywhere, six tiles identical to within 0.016 px (sub-pixel flex rounding), equal
  row pitch, and zero scroll overflow. Full-size icons would require making home the app root without a tab
  bar — a structural change, noted in `docs/home-screen.md`. _(web-demo: this is where it was measured.)_

- **Note** — the Swift side is **unverified by compilation**: there is no Swift toolchain on this Windows
  checkout (`swift` is not on PATH), so `swift build`, `swift run ParityRunner`, `PieceArtCheck`,
  `HomeMetricsCheck` and `BIYA_DIAG=1` could not be run here and must be run on a Mac before shipping.
  Nothing under `Sources/BiyaherongCoachCore/`, `Sources/ParityRunner/` or `Goldens/` was touched, so the
  parity suite is unaffected by construction. The algorithms themselves ARE verified: `web-demo/js/home.js`
  is a line-for-line port of the same pure layer and its 92 assertions pass under Node, including the exact
  derived-metric table the Swift check asserts.

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
