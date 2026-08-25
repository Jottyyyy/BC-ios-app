# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Native, **~90% offline** Swift rebuild of **Biyaherong Chess Coach** (originally Laravel 12 + React/Inertia
+ a Sanctum mobile API). The state is a **Parity Core** — a pure-Swift domain layer pinned to the original
backend by a golden-vector parity harness — plus two user-facing screens built on it: the **Home dashboard**
and the **Analysis Board** (the app's most complex screen, and complete).

**"90% offline", not 100%, and the number is the client's own.** Spec §0.1 always drew an online half
(Opening Trainer packs, Tutorial Videos); the Opening Tree's Lichess/Chess.com download is the first part
of it to ship. Three things need the radio — Sign in with Apple, that download, and Videos when they land
— and **everything else works in Airplane Mode forever**. All app networking lives in exactly one file per
language (`OpeningDownloader.swift` / `web-demo/js/opening-download.js`), and `replay_opening_tree.js` §12
fails the gate if a second one appears.

**Ground truth for every ported algorithm is the real Laravel backend at `../BYAHERONG-COACH-LARAVEL`**
(a sibling repo, *not* in this tree) — the actual PHP controller behavior, not prose. The proposal
`BIYAHERONG-OFFLINE-APP-PROPOSAL.pdf` (§0) governs product direction; its appendices are the algorithm/
constant reference. `PORTING_NOTES.md` records every resolved decision and deviation.

No Cursor/Copilot rule files exist in this repo — this is the only assistant guide.

## Workflow (follow for every change)

**`main` is not a workbench.** Every bug fix and every feature is done on a branch in its own git worktree
and lands on `main` through a pull request; commit to `main` only when the user explicitly says to.
Read-only work — questions, reviews, explaining code — needs no worktree.

1. **Read `CHANGELOG.md` first.** It is newest-first and 2500+ lines — read the entries at the **top**, not
   the whole file, then grep it for the area you are about to touch. It is the record of *why* the code
   looks the way it does, and it names the doc you need next. Then read `docs/README.md` + the relevant
   `docs/<area>.md`; for engine/parity work also read `PORTING_NOTES.md`. Understand before you touch.
2. **Open a worktree** — one task per worktree, all work inside it, on a branch named `fix/<slug>`,
   `feat/<slug>` or `docs/<slug>`. This instruction authorises the `EnterWorktree` tool. Runbook and exact
   commands: **`docs/git-workflow.md`**. Branches are cut from `origin/main`, so push `main` first if it has
   local commits. A fresh worktree has **no gitignored artifacts** — `Goldens/` and `.build/` are absent, so
   regenerate goldens (`php tools/oracle/generate_goldens.php`) before trusting a parity run; an
   unregenerated one is vacuous, not green. `puzzles.sqlite` is committed and comes along.
3. **Log the change in `CHANGELOG.md`** — a new entry at the **top**, under `## [Unreleased]`, shaped
   `### YYYY-MM-DD (added|changed|fixed|docs) — Title` (those four tags only; older entries drift). Say what
   changed, **why**, and whether `web-demo/` was updated.
4. **Every new feature gets a doc** at `docs/<feature>.md` (what it does · key files · how to test), listed
   in `docs/README.md`. Update the doc — in the same commit — whenever behavior changes.
5. **Mirror user-facing features into `web-demo/`** so they are visible on Windows (the user tests there). If
   a feature genuinely can't be mirrored, say why in the CHANGELOG.
6. **Run the gate before you land.** On this Windows checkout that is `node tools/qa/js_goldens.js`,
   `swift_lint.js` and `swift_symbol_check.js`; where Swift exists, `swift run ParityRunner` must exit 0.
   **CI builds the iOS app and runs none of this** — a red gate merged is a regression shipped.
7. **Commit messages say what and why** — `fix:`/`feat:`/`docs:` + an imperative subject, one logical change
   per commit. Never `push` as a message. Never force-push a branch anyone else may have pulled.
8. **Land via PR**, never by pushing `main`. Push the branch, hand the user the compare link, and let them
   merge; the CHANGELOG entry is the PR body. Pushing `main` from two machines is exactly where this
   history's four `Merge origin/main` commits came from.
9. **Clean up after the merge** — remove the worktree and delete the branch. A stale worktree holds stale
   `Goldens/` and gets edited by mistake.
10. Keep this file **under 200 lines**.

## Commands

Toolchain: **Swift 6.3 CLI** (standalone — no Xcode, no iOS SDK, **no XCTest/Testing module**), **PHP 8.4**,
**python3**. The `.sh` scripts are bash (use Git Bash/WSL on Windows). This checkout is on **Windows**;
several Python/shell tools assume a macOS layout (see warnings below) — prefer the direct `swift`/`php`
invocations and the `web-demo/` for visual testing.

```bash
# --- Parity core (the "tests") ---
swift build                                   # compile the domain lib + ParityRunner
swift run ParityRunner                        # run the parity suite; exit 0 = all pass, 1 = failure
tools/oracle/run.sh                           # regenerate goldens from PHP, THEN run the suite
php tools/oracle/generate_goldens.php         # goldens only -> Goldens/*.json  (Goldens/ is gitignored)
python3 tools/qa/mutation_test.py             # mutation testing (proves the suite catches regressions)

# --- the JavaScript gate: the ONE full suite that runs on this Windows checkout ---
node tools/qa/js_goldens.js                   # every JS suite + the oracle replays + the Swift cross-checks
node tools/qa/swift_lint.js                   # brackets + public-exposes-internal, for uncompilable Swift
node tools/qa/swift_symbol_check.js           # every Namespace.member and Puzzle*/Analysis* type resolves
node tools/qa/swift_enum_payload_check.js     # `.premium` where the case is `premium(trial:)` — a type error
node tools/qa/replay_puzzle_vm.js             # the Swift screens BRANCHES, replayed against the JS twin
# ^ run these two with NO arguments: narrowing degrades them (swift_lint warns when it happens)
node tools/metrics/extract_board_styles.js    # re-derive board_styles.json from the RN source (committed)

# --- macOS demo app (BiyaherongUI package) ---
DemoApp/run-demo.sh                           # build (release) + bundle + launch BiyaherongCoachDemo.app
cd DemoApp && swift run DemoApp               # run the demo executable directly (faster dev loop)
cd DemoApp && swift run PieceArtCheck         # 99-assertion SVG piece-renderer self-check

# --- Puzzle bank (repo-relative defaults; ~9s) ---
python3 tools/puzzlebank/build_puzzles.py     # 550k-row CSV -> curated 93k puzzles.sqlite + web slice
node tools/qa/puzzle_corpus_check.js          # quotas, indexes, every line replayed through the engine
python3 tools/qa/corpus_mutation_test.py      # proves that gate is not vacuous
node tools/qa/puzzle_core_mutation_test.js    # ditto for the session/selection/progress suite

# --- iOS app + shipping to TestFlight (macOS + Xcode only) ---
cd ios && xcodegen generate && open Biyaherong.xcodeproj          # Xcode MUST be closed for xcodegen
tools/ship/ship_testflight.sh --dry-run       # build + verify entitlements + validate, NO upload
tools/ship/ship_testflight.sh                 # ...and ship it: bumps the build number, uploads

# --- web-demo (Windows browser preview, no install) ---
# open web-demo/index.html  (or  web-demo/index.html?selftest  for the engine perft check)
```

- **The primary test command is `swift run ParityRunner`** — exit code 0 means parity holds. Run it after
  any change to `Sources/BiyaherongCoachCore/`.
- **Running a single test/group is not supported by any flag.** `ParityRunner` always runs all groups; its
  only optional argument is an alternate goldens directory (`swift run ParityRunner /path/to/Goldens`). To
  narrow scope, edit `Sources/ParityRunner/main.swift`.
- ⚠ **`tools/qa/mutation_test.py`** still contains **hardcoded macOS paths** (`/Users/…`). Edit `ROOT`
  before running it on this Windows checkout. (`tools/puzzlebank/build_puzzles.py` and
  `tools/qa/corpus_mutation_test.py` are now repo-relative.)
- **`DemoApp/Sources/BiyaherongUI/puzzles.sqlite` is generated but deliberately COMMITTED** — CI clones
  this repo alone and never sees the source CSV in the sibling Laravel repo. The build is deterministic,
  so an unchanged corpus produces no diff.
- **CI (`codemagic.yaml`)** only builds/ships the iOS app (workflows `ios-free-unsigned`, `ios-testflight`).
  **It does not run the parity or mutation suites** — those are local/dev gates.

## Architecture

Layered, parity-driven design:

**Parity Core** (pure-Swift domain) ⇐ verified by **ParityRunner** ⇐ against **goldens generated by the
PHP oracle from the real Laravel controllers**. `DemoApp/` (macOS SwiftUI) and `ios/` are thin shells that
wrap the Core; `web-demo/` is a separate JavaScript reimplementation for Windows preview.

- **`Sources/BiyaherongCoachCore/`** — the domain engines and *test oracle*. **Foundation only** (no
  UIKit/SwiftUI/SwiftData). Engines: `ChessBoard` (FEN + legal moves + SAN, perft-verified), `ChessAI`
  (negamax + PST eval + 5 coach personas), `Rating` (ELO K=32/floor 400 + tiers), `Streak`,
  `PuzzleServing`, `DailyLimits`, `DailyGoal`, `PuzzleRush`, `PuzzleSession` (the one solver core all
  five puzzle modes configure), `PuzzleSelection` (the ladders over an abstract pool),
  `PuzzleProgress`, `GameReview`, `Tournament` (Swiss/Round-Robin
  + Buchholz/SB/direct-encounter tiebreaks), `PHPCompat`. The Analysis Board adds `ChessNotation`
  (SAN/UCI *parsing*), `ChessRules`, `MoveTree`, `PGN`, `AnalysisEngine` + `LocalEngine`, `OpeningBook`,
  `ReviewAnnotator`, `AnalysisSession`, `AnalysisStore` and `PositionEditor` — all Foundation-only, all
  asserted; see `docs/analysis-board.md`.
- **`Sources/ParityRunner/main.swift`** — the in-house assertion harness (no XCTest); hosts
  `requireMinCounts` (per-group assertion floors).
- **`DemoApp/`** — its own SwiftPM package: `BiyaherongUI` (SwiftUI + `SVGVector.swift` renderer +
  `PuzzleStore` + `*View.swift`) and the `DemoApp`/`PieceArtCheck` executables. Fonts, sounds, coach art,
  and the puzzle DB ship **inside** this package and load via `Bundle.module`.
- **`Engine/`** — own package, the **only C++ here**: Stockfish 17.1 vendored (one patched line) + an
  `extern "C"` shim + `StockfishEngine`. **Nothing here compiles it** — read `docs/stockfish.md` first.
- **`ios/`** — XcodeGen-driven app shell (`project.yml` → `Biyaherong.xcodeproj`); portrait-only; depends on
  `DemoApp` for `BiyaherongUI`. Build/signing runbook: `ios/BUILD-iOS.md`.
- **`tools/`** — `oracle` (PHP → golden JSON), `eco` (CC0 TSVs → the bundled opening book), `metrics`
  (TypeScript AST walk over the RN source → the committed `board_styles.json`), `qa` (the JS gate, mutation
  testing, and the checks that stand in for a Swift compiler), `puzzlebank` (CSV → SQLite).
- **`web-demo/`** — browser rebuild for Windows (`js/engine.js`, `js/ai.js`, `js/rating.js`, a reusable
  `<chess-board>` Web Component, etc.). **Preview only — NOT parity-tested** — but its self-tests *are* the
  gate for anything Swift cannot compile here.

## The parity contract (rules that cause real breakage if ignored)

- **"Correct" = differentially matches the real PHP output**, not the appendix text. When porting or fixing
  an algorithm, verify against `../BYAHERONG-COACH-LARAVEL` via the golden oracle.
- **Keep the Parity Core Foundation-only and engine-agnostic** — never import a UI framework there, and don't
  leak the Stockfish integration into it — it lives in the separate `Engine/` package.
- **Goldens are generated and gitignored** — never hand-edit `Goldens/*.json`; regenerate via the oracle.
- After changing an engine, **`swift run ParityRunner` must exit 0.** If you intentionally add cases, **raise**
  that group's `requireMinCounts` floor — **never lower a floor to make a run pass** (the floor guards against
  vacuous and truncated goldens).
- **Record every deviation, resolved decision, and invented constant in `PORTING_NOTES.md`** (hard rule).
  Sanctioned, already-documented deviations from PHP: UTC-vs-device-local day key, numeric score-group
  ordering, id-ascending standings tie-break, PHP-truthiness reproductions. **Do not reproduce latent server
  bugs** (e.g. an undefined-constant HTTP 500) — port the *intended* behavior.
- **PHP-compat semantics are load-bearing** (`PHPCompat.swift`): `phpRegularCompare` (numeric if both strings
  are numeric, else byte-wise UTF-8 `strcmp` — matters for accented Filipino names), `phpStringIsTruthy`
  (falsy only for `""`/`"0"`), `null`→`0` coercion. **Swift `sort` is not stable**, so every ported sort
  tie-breaks by original input index. Getting these wrong silently breaks tournament pairing/standings parity.
- **Model non-deterministic PHP** (`inRandomOrder()`) as an **injected picker**, not reproduced RNG, so the
  deterministic parts stay golden-testable.
- **SVG piece art is deliberately all-or-nothing**: `SVGVector.swift` fails the whole file on anything it
  can't reproduce faithfully → falls back to a complete Unicode glyph. Run `PieceArtCheck` after touching art
  or the renderer. A drop-in set uses the same `<kind>-<w|b>.svg` names in `Pieces/`.
- **Mutation suite:** 40/41 killed, 1 documented-equivalent survivor (`dailygoal_gap_branch`). A surviving
  *non-equivalent* mutant is a coverage hole — close it with a new golden.
- **EXTRACT, DON'T TRANSCRIBE — and that includes signs.** Every number the Analysis Board draws comes from
  `tools/metrics/board_styles.json`, re-derived from the RN source on every run. Two hand-typed copies
  agreeing with each other is *not* verification: the annotation badge shipped in the wrong corner in both
  languages because a `+` had been transcribed as a `-`. Render-function geometry is now extracted as
  **signed terms** (`renderConstants`), and `tools/qa/metrics_key_check.js` + `swift_source_keys.js` check
  that every constant reference and every source lookup resolves — in Swift as well as JS, because there is
  no compiler here to do it.
- **Shipping is one command — `tools/ship/ship_testflight.sh`** (runbook: `docs/shipping-to-testflight.md`).
  **On this pipeline an exit code is not evidence** — `xcodebuild` prints `EXPORT SUCCEEDED` while
  dropping an entitlement the profile lacks, and Apple's API returns 201 for a capability it never
  persisted. Only decoding the artifact catches it (`codesign -d --entitlements :- <app>`); the script
  does, and refuses to upload if anything in `ios/Biyaherong.entitlements` is missing. Three rules fall
  out, each of which cost a session: an **unsigned archive cannot carry an entitlement** (so it is signed
  now, signing settings TARGET-scoped — as `xcodebuild` overrides they break SwiftPM's resource bundle);
  a **profile snapshots the App ID's capabilities when minted**, so enabling one means delete-and-recreate,
  never refresh; and `manageAppVersionAndBuildNumber` **defaults to true**, rewriting the build number at
  export, so `ExportOptions.plist` pins it false.
- **Licensing:** the app is **GPLv3** (Stockfish is embedded; the grant is irrevocable, source published).
  Piece art is CC BY-SA, Nunito is SIL OFL — keep attributions intact.

## Notes

- **Assertion counts in prose are informational.** They drift; the real invariants are **exit 0** and the
  `requireMinCounts` floors in `Sources/ParityRunner/main.swift`, plus a green `node tools/qa/js_goldens.js`.
- **`swift` is not on PATH on the Windows checkout.** Everything in `Sources/` since the notation core has
  been written blind and is verified three ways instead: the JS twin runs the same algorithm, the
  hand-authored Swift tables are replayed through that twin
  (`tools/qa/replay_position_editor.js`), and `swift_lint.js` catches the structural errors. `swift build`
  remains the last gate, on a Mac.
- Locked decisions: the full **550,000-puzzle** bank (~100 MB) is built to `puzzles.sqlite` at build time.
  The engine is **Stockfish 17.1 (GPL)**, embedded 2026-08-25, app source published — `docs/stockfish.md`.
