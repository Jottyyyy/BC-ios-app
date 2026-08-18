# Docs

Feature- and subsystem-level documentation for this repo.

**Read the relevant doc before adding a feature or fixing a bug** (see the *Workflow* section in
[`../CLAUDE.md`](../CLAUDE.md)), and **add or update a doc whenever you add or change a feature.**

## How this works
- One doc per feature/subsystem: `docs/<feature>.md` — *what it does*, its *key files*, and *how to test it*.
- Keep docs short and current; update the doc in the same change that changes behavior.
- Log the change in [`../CHANGELOG.md`](../CHANGELOG.md).

## Authoritative references (don't duplicate these — link to them)
- **[`../README.md`](../README.md)** — project overview, the parity harness, and how to run the suites.
- **[`../PORTING_NOTES.md`](../PORTING_NOTES.md)** — the engine/parity **ground truth**: every ported
  algorithm's rules, the documented deviations from the real PHP backend, and invented constants.
  **Read this for any `Sources/` (engine) work.**
- **[`../ios/BUILD-iOS.md`](../ios/BUILD-iOS.md)** — iOS build / signing / TestFlight / sideload runbook.
- **[`git-workflow.md`](git-workflow.md)** — the git runbook: a worktree per task, setting a fresh one up,
  the pre-land gate, landing via PR, and cleanup. **Read this before starting any fix or feature.**
- **[`../web-demo/README.md`](../web-demo/README.md)** — end-user run steps for the Windows browser demo.

## Feature docs
- [`chessboard.md`](chessboard.md) — the one board renderer per language, the sizing rule every screen
  obeys (a fixed square from the WIDTH — never `min(w, h)`), coordinates, and the gate that fails when
  either is reinvented. **Read this before touching any screen that shows a board.**
- [`web-demo.md`](web-demo.md) — the browser rebuild that runs on Windows (Play / Puzzles / Profile + the
  reusable `<chess-board>` component).
- [`subscription.md`](subscription.md) — one monthly plan with a 7-day trial, verified **on-device by
  StoreKit 2 with no server**: the trial/expiry/grace state machine, the free tier's daily caps, the
  paywall, and the two holes (refunds, clock rollback) that are accepted rather than defended.
- [`login.md`](login.md) — the app's first screen: the brand hero, one **simulated** "Continue with Apple"
  button, a persisted fail-closed session, and the bundled Privacy · Terms sheet. **The sign-in performs no
  Apple authentication and no network call** — read this before wiring a real one.
- [`home-screen.md`](home-screen.md) — the landing dashboard: four bands, a never-scrolling 3×2 grid of six
  equal cards, the Sky/Colorful themes, and the hourly Taglish quote.
- [`analysis-board.md`](analysis-board.md) — the offline analysis screen: move tree, local engine, ECO book,
  game review, persistence, Setup Position, PGN import/export, and the pure metrics layer extracted from the
  real RN StyleSheet.
- [`engine-settings.md`](engine-settings.md) — ☰ > Engine: five presets from Battery Saver to
  Infinite plus Advanced controls, and the search behind them — the analysis-only evaluation
  (tapered phase, pawn structure, king safety, mobility) and the accelerated search (transposition
  table, PVS, extensions, null-move, LMR) that took mean depth from 3.83 to 5.00 at the same budget
  and corpus tactics from 87.5% to 95.8%.
- [`puzzle-hub.md`](puzzle-hub.md) — the offline puzzle feature: the curated 93k-puzzle bundle and how it is
  built, the shared solver core, the selection ladders over SQLite, and the local progress store.
  Plus the style extraction, the metrics layer and all eleven screens — Hub, Play Puzzles, Daily,
  Thematic, Streak and Turbo — in both languages. **Complete (phases A–G).**
- [`pairing-engine.md`](pairing-engine.md) — Swiss pairing (FIDE Dutch), Berger round-robin schedules
  and the four tie-breaks, as one pure module: the priority ladder that replaces the server's silent
  repeat pairing, and the property tests over whole simulated tournaments that prove it.
  **Engine + tests only — the Swift twin and the Pairing Manager screens are still to come.**
- [`pairing-manager.md`](pairing-manager.md) — the offline tournament manager built on that engine:
  the style extraction from the real RN screens, the metrics layer, and the document store (seeds,
  results, computed status, standings). **Screens and the Swift half still to come — the doc opens
  with a status table.**
- [`play-vs-coach.md`](play-vs-coach.md) — five offline coaches: the strength layer (depth + MultiPV
  + a client-side randomiser, no Elo cap), the per-persona opening book, the game record with its
  per-level draft, the three screens in both languages with the generation counter that makes four
  §7 concurrency defects one fix, and the offline game review over the Analysis Board's own
  classification maths. **Complete (spec §2.1–2.14, and every §7 fix from #24 to #40).**

_More docs get added here as features are built._

## Specs (`specs/`) — the source prompts, not implementation docs

Full port specifications derived from the real RN screens + Laravel controllers: every colour,
size, string, constant and algorithm, plus the deliberate deviations from the original. Read the
spec **before** building a screen in that area; the feature docs above record what was actually
built.

- [`specs/BIYAHERONG-PORT-SPEC.md`](specs/BIYAHERONG-PORT-SPEC.md) — one document, two books.
  **Book One (Parts 0–23)** — the Puzzle Hub: five modes, the curated bundled corpus and its build
  pipeline, the shared solver core, the selection ladders, Elo, and the daily goal.
  **Book Two (Phases 0–9)** — **Pairing Manager** (offline, FIDE Dutch rewrite), **Play vs Coach**
  (offline, embedded engine), **Opening Trainer** and **Tutorial Videos** (subscription,
  static-bucket content + on-device StoreKit entitlement).
  Each book stands alone, and each Part/Phase can be handed over on its own.
