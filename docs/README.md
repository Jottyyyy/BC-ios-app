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
- **[`../web-demo/README.md`](../web-demo/README.md)** — end-user run steps for the Windows browser demo.

## Feature docs
- [`web-demo.md`](web-demo.md) — the browser rebuild that runs on Windows (Play / Puzzles / Profile + the
  reusable `<chess-board>` component).
- [`home-screen.md`](home-screen.md) — the landing dashboard: four bands, a never-scrolling 3×2 grid of six
  equal cards, the Sky/Colorful themes, and the hourly Taglish quote.
- [`analysis-board.md`](analysis-board.md) — the offline analysis screen: move tree, local engine, ECO book,
  game review, persistence, Setup Position, PGN import/export, and the pure metrics layer extracted from the
  real RN StyleSheet.
- [`puzzle-hub.md`](puzzle-hub.md) — the offline puzzle feature: the curated 93k-puzzle bundle and how it is
  built, the shared solver core, the selection ladders over SQLite, and the local progress store.
  Plus the style extraction, the metrics layer and the first three screens (Hub, Play Puzzles Home,
  Play Puzzles Solver). **Phases D–F — Daily, Thematic, Streak, Turbo and the final sweep — pending.**

_More docs get added here as features are built._
