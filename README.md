# Biyaherong Chess Coach — Offline iOS/iPadOS Rebuild

Native, **100% offline** rebuild of Biyaherong Chess Coach (was Laravel 12 + React/Inertia +
Sanctum mobile API) as a universal iPhone/iPad app in Swift. Product direction: the boss's July 2026
proposal ("goes fully offline"). Ground truth for every ported algorithm: the Laravel backend at
`../BYAHERONG-COACH-LARAVEL`.

> Governance: `PORTING_NOTES.md` records every resolved decision and deviation. §0 of the migration
> brief (the proposal) governs product; the appendices are the reference for algorithms/constants.

## Current state — Parity Core (this package)

This SwiftPM package is the **pure-Swift domain layer**, ported faithfully from the real Laravel
controllers and pinned to the source with a **golden-vector parity harness**. It is the "test oracle"
the rest of the app is built on.

### Layout
```
Package.swift
Sources/BiyaherongCoachCore/     # domain engines (Foundation only — no UIKit/SwiftUI)
  Rating.swift                   # ELO (K=32, floor 400) + compareMoves + RatingTier [Puzzle/ShareController]
  PuzzleRush.swift               # rush best-score upsert + mode labels           [PuzzleRush/ShareController]
  Streak.swift                   # streak progression 600/+50/2500, warmup=10     [StreakController]
  PuzzleServing.swift            # ±window serving ladders (injected randomness)   [Puzzle/StreakController]
  DailyLimits.swift              # 5/1/2/1 caps, premium bypass, local day key     [ChecksDailyLimits]
  DailyGoal.swift                # solving-streak days, target 10                  [DailyGoalController]
  GameReview.swift               # move classification + accuracy + eval graph     [GameReviewController]
  Tournament.swift               # Swiss + Round-Robin + Buchholz/SB/direct-enc    [TournamentController]
  ChessBoard.swift               # FEN + legal move generation + SAN (perft-verified) [Chess primitives §11]
  ChessAI.swift                  # negamax + alpha-beta + PST eval; 5 coach personas [Play vs Coach §8.1]
  PHPCompat.swift                # exact PHP <=> / truthiness semantics
  # --- the Analysis Board (see docs/analysis-board.md) ---
  ChessNotation.swift            # SAN + UCI PARSING (the inverse of ChessBoard's generator)
  ChessRules.swift               # position key, insufficient material, fifty-move, threefold
  MoveTree.swift                 # the move tree with variations + a pure flatten() render model
  PGN.swift                      # parse + serialize: RAVs, NAGs, comments — the persistence format
  AnalysisEngine.swift           # the engine protocol and its score types (Stockfish drops in here)
  LocalEngine.swift              # the interim search: iterative deepening, quiescence, MultiPV, PV
  OpeningBook.swift              # ECO lookup over the bundled 7,854-row book
  ReviewAnnotator.swift          # drives the engine over a game; layers `book` on top of GameReview
  AnalysisSession.swift          # the screen's behaviour, with no screen attached
  AnalysisStore.swift            # the saved-game library (pure Codable records; no I/O, no clock)
  PositionEditor.swift           # Setup Position: placement, castling normalisation, validation
DemoApp/                         # native macOS SwiftUI app wrapping the engines (interactive board + panels)
Sources/ParityRunner/main.swift  # in-house parity harness (no XCTest in the CLI toolchain)
tools/oracle/generate_goldens.php# real PHP function bodies → golden JSON
tools/eco/build_eco.php          # vendored CC0 opening TSVs → the bundled ECO book
tools/metrics/extract_board_styles.js # TS AST walk over the RN source → board_styles.json
tools/qa/js_goldens.js           # the JavaScript gate — the one that runs on the Windows checkout
tools/qa/mutation_test.py        # mutation testing (proves the suite catches bugs)
tools/puzzlebank/build_puzzles.py# 550k-row Lichess CSV → the curated 93k puzzles.sqlite (deterministic)
Goldens/*.json                   # generated golden vectors (curated + randomized)
PORTING_NOTES.md                 # decisions & deviations
```

### Verify parity
```bash
tools/oracle/run.sh              # regenerate goldens from PHP, then run the Swift suite
# or:
php tools/oracle/generate_goldens.php
swift run ParityRunner
```
Exit code 0 = every parity check passed. The suite has grown a great deal with the Analysis Board; the
`requireMinCounts` floors in `Sources/ParityRunner/main.swift` are the authoritative figure, and the run
prints its own total. It includes
a **perft** move-generation suite (startpos depth 4 = 197,281 nodes; Kiwipete depth 3 = 97,862), and
3,000 randomized ELO cases, 500 daily-goal, 300 game reviews, 270 full randomized tournaments, a 1,156-pair
`<=>` differential, and a classification-boundary grid — all differentially matched against the real PHP.
The harness fails if any mandatory group falls below its expected assertion floor (`requireMinCounts`
guards against vacuous *and* truncated goldens).

### QA — mutation testing
```bash
python3 tools/qa/mutation_test.py   # inject faults, confirm the suite catches each one
```
Injects ~41 deliberate faults into the engines one at a time and confirms the suite goes RED for each.
Current mutation score: **40/41 killed; the 1 survivor is a provably-equivalent mutant** (documented in
the script's `EQUIVALENT` set). A surviving non-equivalent mutant = a coverage hole.

### Interactive demo (native macOS app)
```bash
DemoApp/run-demo.sh      # builds + launches a macOS SwiftUI app wrapping the real engines
```
Panels: an **interactive chessboard** with **sliding animations** and a **coach bot to play against**
(5 personas, Jaden Pogi → Coach Pogi, via `ChessAI`) — legal moves enforced by the perft-verified engine
(castling, en passant, promotion, check/mate); plus live Puzzle-Rating, Game-Review, Tournament, and
Streak/Rush demos. (No iOS simulator exists in this toolchain; this runs the identical engine code on macOS.)

### Why an executable harness (not XCTest)?
The dev toolchain here is a bare Swift 6.3 CLI with no `XCTest`/`Testing` module. `ParityRunner` is a
self-contained harness that loads the golden JSON and asserts. When the project is opened in Xcode,
wrap the same `Goldens/*.json` in XCTest/swift-testing targets — no logic changes needed.

### Piece artwork
Boards draw the SVG piece set in `assets/images/chess-pieces/` (mirrored into
`DemoApp/Sources/BiyaherongUI/Pieces/` so SwiftPM bundles it, the same way `assets/sounds` is
mirrored into `Sources/BiyaherongUI/Sounds`). `SVGVector.swift` is a small SVG-subset renderer —
the art stays vector, so one file serves a 41 pt phone square, a 60 pt desktop square and a
promotion button with no `@2x`/`@3x` rasters. Dropping a differently-styled set into
`Pieces/` with the same `<kind>-<w|b>.svg` names swaps the whole board.

Parsing is deliberately all-or-nothing: anything the renderer can't reproduce faithfully
(a malformed path, `fill="currentColor"`, an unknown `transform`, truncated XML) fails the whole
file so the board falls back to a complete Unicode glyph. Half-parsed art — a headless king — or
silently wrong art — a white piece painted black — are both worse than an honest fallback.

```bash
cd DemoApp && swift run PieceArtCheck   # 99 assertions: the 12 files + grammar/arc/transform/paint edges
```

## Third-party assets
- **Piece artwork** — Uray M. János (2013–2018), derived from the Wikipedia chess set,
  **CC BY-SA**. Files: `assets/images/chess-pieces/*.svg`.
- **Nunito** — SIL Open Font License. Files: `DemoApp/Sources/BiyaherongUI/Fonts/*.ttf`.
- **ECO opening names** — [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  **CC0 1.0** (public domain dedication). Inputs: `tools/eco/data/*.tsv` (+ `COPYING.txt`); built product:
  `DemoApp/Sources/BiyaherongUI/ECO/eco.tsv` via `php tools/eco/build_eco.php`.

## Decisions locked (see PORTING_NOTES.md)
- **Puzzle bank:** full **550,000** puzzles (~100 MB) → build-time `puzzles.sqlite` (later phase).
- **Engine:** **Stockfish (GPL)** + publish the app source openly (later `Engine/` phase).

## Next phases (not yet built)
Foundations (SwiftData models + CloudKit, chess primitives) → on-device Stockfish → Puzzle Hub +
Play-vs-Coach → Analysis/Review/Openings/Tournaments UI → Profile + StoreKit one-time purchase +
TestFlight. See the migration brief §13.
