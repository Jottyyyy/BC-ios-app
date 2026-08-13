# Biyaherong Chess Coach — Native iOS Port Specification

One document, two books. Everything below is written to be copied straight into a coding agent.

| Book | Modules | Connectivity | Gate |
|---|---|---|---|
| **BOOK ONE — Puzzle Hub** | Play Puzzles · Daily Puzzle · Thematic · Puzzle Streak · Puzzle Turbo | 100% offline | one-time purchase |
| **BOOK TWO — Pairing Manager · Play vs Coach · Opening Trainer · Tutorial Videos** | four modules, phases 0–9 | first two offline, last two online | one-time purchase + subscription |

**How to use this file.** You do not have to paste all of it at once. Each book stands alone, and
inside Book Two each PHASE stands alone — hand your agent one phase at a time and it has
everything it needs for that screen. Paste the whole document only when you want the agent to see
the shared design tokens and the cross-module decisions together.

**Already built** (see the sibling `docs/*.md`): Home screen, Analysis Board, and Puzzle Hub
phases A–D. Book One remains the reference for Puzzle Hub phases E–G. Book Two is entirely new work.

**Ground truth** for every number in here is the real React Native source in
`../BYAHERONG-COACH-FRONTEND` and the Laravel controllers in `../BYAHERONG-COACH-LARAVEL`. Where
this document deviates from them it says so explicitly and gives the reason — those deviations are
decisions, not drift.

---

# BOOK ONE — Puzzle Hub

# Context

The user is rebuilding **Biyaherong Chess Coach** as a 100% offline native iOS/Swift app with no
paid server and a one-time purchase. The Analysis Board spec was delivered in a previous turn
(this file previously held it — it has been replaced; recover it from the session transcript if
needed).

This request: a **complete, copy-paste prompt for the entire Puzzle Hub** — all five puzzle modes
plus the hub itself — as a fully offline feature with a local database.

Confirmed decisions: **whole Puzzle Hub** (Play Puzzles, Daily Puzzle, Thematic, Puzzle Turbo,
Puzzle Streak), **~100k curated rating-balanced bundled puzzle database**, **no daily caps**
(one-time purchase unlocks everything) but **keep the daily goal** as motivation.

Source of truth for every number below: `play-puzzle/index.tsx` (1,261 lines),
`play-puzzle/leaderboard.tsx` (332), `puzzle-streak/{index,puzzle}.tsx` (407 + 707),
`puzzle-rush/{index,rush-game}.tsx` (457 + 840), `thematic/{index,puzzle}.tsx` (209 + 627),
`daily-puzzle/{index,puzzle}.tsx` (153 + 422), `puzzle-hub/index.tsx` (179),
`DragDropChessBoard.tsx` (648), `usageLimits.ts`, `puzzleCache.ts`, `UpgradePrompt.tsx`,
plus `PuzzleController.php`, `StreakController.php`, `PuzzleRushController.php`,
`DailyGoalController.php`, `ChecksDailyLimits.php`, and the migrations.

This file *is* the deliverable — the prompt below is written to be copied out whole.

---

---

# PROMPT: Build the Offline Puzzle Hub — Biyaherong Chess Coach (SwiftUI + bundled puzzle DB)

## PART 0 — Objective & Hard Constraints

Build the **Puzzle Hub**: six screens covering five puzzle modes — rated Play Puzzles, Daily
Puzzle, Thematic Puzzles, Puzzle Turbo (rush), and Puzzle Streak — plus the hub menu that
launches them.

**This feature must work with the device in Airplane Mode, permanently.** There is no server, no
API, no account, no sync, no leaderboard. Every puzzle, every rating calculation, and every
statistic is computed on-device or read from a bundled asset.

- Platform: **SwiftUI, iOS 17+**, portrait only
- Persistence: **SwiftData** for user state; **read-only SQLite** in the app bundle for puzzles
- Puzzle corpus: **~100,000 curated Lichess puzzles**, shipped inside the app
- Engine (for solution hints only): **the embedded Stockfish actor** already built for the
  Analysis Board
- All dimensions are in **points**. Colors are exact — do not substitute.
- No `URLSession` anywhere in this feature. If you find yourself writing one, you have
  misunderstood the requirement.
- **Typography:** the React Native original loads Nunito but never applies it on any puzzle
  screen — every puzzle screen renders in the platform system font. In Swift that means **SF Pro
  (the default)**. Do not reach for a custom font here. The one exception: the Puzzle Turbo timer
  needs `.monospacedDigit()` or it will jitter every second.

---

## PART 1 — Screen Map

Six screens, all drawing their own header (no system nav bar), all on background `#0F1A2E`,
all light status-bar content.

| Screen | Role |
|---|---|
| **Puzzle Hub** | Menu — 5 cards, one per mode |
| **Play Puzzles Home** | Rated-mode landing: your stats + Play button |
| **Play Puzzles Solver** | The rated solving screen (the most feature-rich of the five) |
| **Daily Puzzle** | Home (streak + total) → solver |
| **Thematic** | Theme grid (12 themes) → solver |
| **Puzzle Turbo** | Mode select (∞ / 3 min / 5 min) → timed run → results |
| **Puzzle Streak** | Home (current/best) → sudden-death run |

Every solver screen shares the same board, the same move-validation core, and the same promotion
dialog. Build that core **once** (Part 5) and configure it per mode — do not write five solvers.

### Standard header

Used by every screen in this feature, with per-screen variations noted later:

```
row, alignItems: center, justifyContent: spaceBetween
paddingHorizontal 16, paddingTop 10, paddingBottom 6
├─ back button   40×40 tap target, glyph "←" 24pt #FFFFFF
├─ title         18pt bold #FFFFFF
└─ trailing      either a mode badge pill or the app logo (30pt)
```

**App logo** (30pt): circle, `borderRadius = size/2`, 2pt border `#FDB022`, clipped, gold glow —
shadow color `#FDB022`, offset (0,0), opacity 0.6, radius 6.

---

## PART 2 — Design Tokens

```swift
// Surfaces
screenBg      #0F1A2E   // every screen in this feature
card          #1A2942   // cards, stats bars, modals, panels, result boxes
cardAlt       #253552   // inputs, secondary buttons, unselected tabs
cardAlt2      #1E3A5F   // solution-strip "Menu" button
divider       rgba(255,255,255,0.06)
rowAlt        rgba(255,255,255,0.03)

// Mode accents  (screen accent — see Part 9.2 about the hub's divergent set)
ratedGreen    #5CC264   // Play Puzzles
dailyGreen    #7CB342   // Daily Puzzle
thematicPurple #8E24AA  // Thematic
turboBlue     #1E88E5   // Puzzle Turbo
streakOrange  #F4511E   // Puzzle Streak

// Gold + text
gold          #FDB022
onGold        #0F1A2E
textPrimary   #FFFFFF
textSecondary #8BA3C7
textMuted     #5A7090   #6B7B8D   #4A6080

// Semantic
correct       #43D97C
wrong         #FF6B6B   #FF4444
danger        #E53935
offlineBadge  #E65100
shareBlue     #1E88E5
engineEval    #90CAF9
warmAmber     #FFAA55   // "Correct move:" label

// Board (identical to the Analysis Board)
selectedSq    #F6F669
lastMoveSq    #CDD26A
hoverSq       rgba(20,85,30,0.5)
classicLight  #F0D9B5   classicDark  #B58863    // default
greenLight    #EEEED2   greenDark    #769656
blueLight     #BFD4E0   blueDark     #6B8FA8

// Feedback dots (Puzzle Turbo only)
dotCorrect    rgba(43,196,110,0.96)
dotWrong      rgba(220,50,47,0.96)

// Arrows (solution engine lines) — index 0,1,2
arrow0 rgba(76,175,80,0.85)   arrow1 rgba(68,138,255,0.80)   arrow2 rgba(255,152,0,0.80)
```

**Scrim opacities** — keep them distinct: quit modal `0.70` · streak result `0.78` ·
promotion `0.80` (play/daily/thematic) and `0.82` (streak/turbo) · save-puzzle sheet `0.60`.

Corner radii in use: 6, 8, 10, 12, 14, 16, 20, 24. Font sizes: 9, 10, 11, 12, 13, 14, 15, 16,
18, 19, 20, 22, 24, 28, 32, 34, 46, 56, 64, 72.

---

## PART 3 — The Bundled Puzzle Database

This is the foundation. Build it before any UI.

### 3.1 Source

The repo already contains the full source corpus:

```
BYAHERONG-COACH-LARAVEL/database/seeders/data/byahero_puzzle.csv
   ~96 MB · 550,001 lines (1 header + 550,000 puzzles) · a Lichess puzzle DB export
   Header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
```

Verified properties of the corpus:
- Rating range **399 – 3195**, mean 1487.5
- **Every row has an even move count** (2 … 30 plies) — the convention in Part 5.1 is structural,
  not incidental
- 62 distinct theme strings
- `OpeningTags` is empty for 438,096 / 550,000 rows (79.7%)

> The old Laravel seeder threw away `PuzzleId`, `RatingDeviation`, `Popularity`, `NbPlays`, and
> `GameUrl`. **You are rebuilding from the CSV, so keep them** — `Popularity` and `NbPlays` are
> exactly what you need to pick the *good* 100k out of 550k, and they cost a few bytes per row.

### 3.2 Build-time pipeline (a script, run once, not app code)

Write a small script (Swift CLI, Python, whatever) that reads the CSV and emits
`puzzles.sqlite` into the app bundle. It must be deterministic — same input, same output.

**Schema:**

```sql
CREATE TABLE puzzles (
    id           INTEGER PRIMARY KEY,   -- dense 1..N, assigned at build time
    lichess_id   TEXT    NOT NULL,      -- e.g. "00sHx"
    fen          TEXT    NOT NULL,      -- 6-field FEN, position BEFORE the opponent's setup move
    moves        TEXT    NOT NULL,      -- space-separated UCI, e.g. "d7b6 d5f7"
    rating       INTEGER NOT NULL,
    popularity   INTEGER NOT NULL,
    nb_plays     INTEGER NOT NULL,
    opening_tags TEXT                   -- space-separated, NULL when empty
);
CREATE INDEX idx_puzzles_rating ON puzzles(rating);

CREATE TABLE puzzle_themes (
    puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
    theme     TEXT    NOT NULL
);
CREATE INDEX idx_themes_theme_rating ON puzzle_themes(theme, puzzle_id);
CREATE INDEX idx_themes_puzzle       ON puzzle_themes(puzzle_id);

-- Denormalized helper so the hot query never joins:
CREATE TABLE theme_rating_index (
    theme     TEXT    NOT NULL,
    rating    INTEGER NOT NULL,
    puzzle_id INTEGER NOT NULL
);
CREATE INDEX idx_tri ON theme_rating_index(theme, rating);

CREATE TABLE daily_pool (           -- see Part 11
    day_index INTEGER PRIMARY KEY,  -- 0..N-1, stable forever
    puzzle_id INTEGER NOT NULL
);
```

> The old Postgres schema stored themes as a JSON array **with no index**, so every thematic
> query sequentially scanned 550k rows. The join table plus `theme_rating_index` above turns that
> into an index seek. Do not port the JSON-blob approach.

**Selection rule — how to get from 550,000 to ~100,000:**

1. **Drop** rows with `nb_plays < 50` (statistically unsettled ratings) and rows with
   `rating < 400` or `rating > 2800` (the 400+ tails are unusable for a coaching app: 131 rows
   above 3000, 457 below 400).
2. **Stratify into 100-point rating bands** from 400 to 2600 → 22 bands. From each band take the
   top **4,000** by a quality score, breaking ties by `lichess_id` ascending for determinism:
   ```
   quality = popularity * log10(max(nb_plays, 10))
   ```
   That yields ≈ 88,000. Bands that hold fewer than 4,000 eligible rows contribute everything
   they have.
3. **Theme quotas — top up after step 2.** For each of the 12 UI themes (Part 12.1), ensure at
   least **3,000** puzzles survive, spread across bands; pull the highest-quality missing ones in.
4. **Warmup quota — non-negotiable.** Both Streak and Turbo open with mate-in-1s at rating
   600 ± 50. That intersection is thin in the raw corpus. Guarantee at least **2,000** puzzles
   matching `theme = 'mateIn1' AND rating BETWEEN 500 AND 700`, taking every one that exists if
   fewer.
5. **Rare-theme sweep.** For any theme with fewer than 1,000 rows in the whole corpus
   (`enPassant` 763, `arabianMate` 653, `hookMate` 895, `killBoxMate` 382, `bodenMate` 333,
   `vukovicMate` 183, `dovetailMate` 348, `doubleBishopMate` 323, `castling` 240,
   `underPromotion` 101, `mateIn5` 535, `superGM` 310), **include all of them** — they cost
   nothing and make the corpus feel complete.
6. Renumber `id` densely from 1, build all indexes, `VACUUM`, `ANALYZE`.

Expected result: **95,000 – 105,000 puzzles, 25–35 MB** on disk. Log the final per-band and
per-theme counts as build output so regressions are visible.

### 3.3 Runtime access

- Open the bundle DB **read-only**, one shared connection, off the main actor.
- Never copy it to Documents — it is immutable and already local.
- Wrap it in a `PuzzleStore` actor exposing only the queries in Part 7. No SQL anywhere else.
- Cold-open cost must be under 50 ms; if it is not, your indexes are wrong.

---

## PART 4 — Local Data Model (SwiftData)

Everything the user *does* lives here. Everything the user *solves* lives in the bundle.

```swift
@Model final class PuzzleProfile {          // exactly one row
    var rating: Int = 1200                  // the rated-mode Elo; floor 400, no ceiling
    var highestRating: Int = 1200
    var createdAt: Date
}

@Model final class PuzzleAttempt {          // the rating ledger — rated mode only
    var puzzleId: Int
    var isCorrect: Bool
    var ratingChange: Int
    var ratingBefore: Int
    var ratingAfter: Int
    var solveTimeSeconds: Int?
    var solvedAt: Date
    // Unique on puzzleId — one *rated* attempt per puzzle, ever.
}

@Model final class SeenPuzzle {             // non-repetition set, all modes
    var puzzleId: Int
    var seenAt: Date
    // Unique on puzzleId.
}

@Model final class StreakState {            // exactly one row
    var currentStreak: Int = 0
    var bestStreak: Int = 0
    var puzzleRating: Int = 600             // the difficulty ramp
    var pendingPuzzleId: Int?               // the anti-reroll lock
}

@Model final class StreakRun {              // history — replaces the online leaderboard
    var length: Int
    var endedAt: Date
}

@Model final class RushBest {               // one row per mode
    var mode: Int                           // 0 = infinite, 3, 5
    var bestScore: Int = 0
}

@Model final class RushRun {                // history — replaces the online leaderboard
    var mode: Int
    var score: Int
    var mistakes: Int
    var endedAt: Date
}

@Model final class RushDraft {              // infinite-mode resume, one row
    var score: Int
    var mistakes: Int
    var targetRating: Int
    var puzzlesServed: Int
    var savedAt: Date
}

@Model final class DailyPuzzleState {       // exactly one row
    var streak: Int = 0
    var totalSolved: Int = 0
    var lastSolvedDay: Date?                // start-of-day, LOCAL calendar
}

@Model final class PlayPuzzleDraft {        // rated-mode resume, one row
    var puzzleId: Int
    var savedAt: Date
}

@Model final class ThemeStat {              // one row per theme the user has touched
    var theme: String
    var attempted: Int = 0
    var solved: Int = 0
}
```

**Seeding:** on first launch create `PuzzleProfile`, `StreakState`, `DailyPuzzleState`, and three
`RushBest` rows (modes 0, 3, 5). Nothing else.

**What is deliberately gone from the server schema:** `user_id` on every table (single-user
device), `user_daily_puzzle_limits` (no caps), all leaderboard queries, and
`user_puzzle_streaks.pending_puzzle_id`'s foreign key (a plain `Int?` is enough).

---

## PART 5 — The Shared Puzzle Core

### 5.1 The move convention — read this twice

A puzzle is `fen` plus a UCI move list. **`moves[0]` belongs to the opponent.** The FEN's
side-to-move field names the *opponent*, not the solver.

```
moves[0]  opponent's setup move — auto-played after the board appears
moves[1]  the solver's first expected move
moves[2]  opponent's reply — auto-played
moves[3]  the solver's second expected move
...
```

Therefore:
- `userColor = (Chess(fen).turn == .white) ? .black : .white`
- The board is flipped when `userColor == .black`
- `currentMoveIndex` starts at **1** and advances by **2**
- Solved when `currentMoveIndex >= moves.count - 1`
- Every puzzle has an even move count, so the last move in the list is always the solver's

UCI parsing: `from = uci[0..<2]`, `to = uci[2..<4]`, `promotion = uci[4]` (default `q` when
absent).

### 5.2 The state machine

```swift
enum PuzzlePhase { case loading, playing, solved, failed, reviewing }

@Observable final class PuzzleSession {
    let puzzle: Puzzle
    private(set) var chess: ChessPosition
    private(set) var currentMoveIndex = 1
    private(set) var phase: PuzzlePhase = .loading
    private(set) var lastMove: (from: String, to: String)?
    var selectedSquare: String?
    var userColor: PieceColor
}
```

### 5.3 Mounting a puzzle — identical in all five modes

1. Build the position from `puzzle.fen`.
2. Derive `userColor` (5.1) and flip the board accordingly.
3. Reset `currentMoveIndex = 1`, clear `lastMove`, clear selection.
4. Play the **game-start** sound.
5. After the mode's **opponent delay** (500 ms everywhere except Puzzle Turbo, which uses
   300 ms), apply `moves[0]`, set `lastMove`, play the move/capture sound.
6. Mode-specific extras (start the rated timer; start the Turbo clock on the *first* puzzle only).

### 5.4 Validating a user move — the one algorithm

```swift
func submit(from: String, to: String, promotion: PieceType = .queen) {
    guard let move = chess.move(from: from, to: to, promotion: promotion) else {
        selectedSquare = nil; return          // illegal → silent no-op, no sound, no penalty
    }

    // Rule 1 — ANY move that delivers immediate checkmate is correct, even off-book.
    if chess.isCheckmate {
        commitCorrect(move); finish(correct: true); return
    }

    let played   = move.from + move.to + (move.promotionLetter ?? "")
    let expected = puzzle.moves[currentMoveIndex]

    if played == expected {
        commitCorrect(move)
        let opponentIndex = currentMoveIndex + 1
        if currentMoveIndex >= puzzle.moves.count - 1 {
            finish(correct: true)
        } else {
            after(opponentDelay) {
                apply(puzzle.moves[opponentIndex])          // opponent replies
                currentMoveIndex = opponentIndex + 1
                if opponentIndex >= puzzle.moves.count - 1 {
                    after(opponentDelay) { finish(correct: true) }
                }
            }
        }
    } else {
        handleWrong(move)                                    // mode-specific — see 5.5
    }
    selectedSquare = nil
}
```

The checkmate short-circuit at the top is in **all five** original screens. Keep it — it prevents
the maddening "I mated him but the app said wrong" bug when the stored line mates a different way.

### 5.5 Wrong-move handling — the one place modes genuinely differ

| Mode | Behavior |
|---|---|
| Play Puzzles | Undo the move (position snaps back). No sound. Strip turns red. Retry / Solution / Next offered. |
| Daily Puzzle | Undo. Show the "wrong" banner for **1300 ms**, then let the user try again. Unlimited retries; the streak is only awarded on solve. |
| Thematic | Undo. Show the wrong banner and the Retry / Solution buttons. **No rating penalty** — thematic never touches Elo. |
| Puzzle Streak | Undo. **The run ends immediately.** Play the game-over sound. |
| Puzzle Turbo | **Do NOT undo** — the piece stays on the wrong square, a red ✕ dot appears for 500 ms, and the next puzzle mounts 500 ms later. Costs one of three lives. |

The Turbo divergence is intentional in the original and reads as deliberately brutal. Keep it.

### 5.6 Promotion dialog

Triggered when the moving piece is a pawn landing on rank 8 (white) or 1 (black). Detected in
both the tap and drag paths *before* the move is applied.

Full-screen absolute overlay (**not** a sheet), scrim `rgba(0,0,0,0.80)` — Streak and Turbo use
`0.82`. Centered dialog: fill `#1A2942`, radius 20, padding 24, **fixed width 280**.
Title **"Choose Promotion"** 18pt bold `#FFFFFF`, centered, bottom margin 16.
Four full-width rows, `gap 10`, each radius 12, padding 14, row layout centered with `gap 12`,
containing a **36×36** piece glyph plus a 16pt bold `#FFFFFF` label.
Order **q, r, b, n** → **Queen, Rook, Bishop, Knight**. **No cancel** — one must be chosen.

Row fill = the screen's accent color:

| Screen | Row fill |
|---|---|
| Play Puzzles | `#4A90E2` |
| Daily Puzzle | `#7CB342` |
| Thematic | `#4A90E2` |
| Puzzle Streak | `#F4511E` |
| Puzzle Turbo | `#1E88E5` |

The piece glyph is drawn in **`userColor`**, not in the moving piece's color — they are the same
thing in every reachable case.

---

## PART 6 — The Board View

The same board component as the Analysis Board. Restated here so this document stands alone.

### 6.1 Geometry

```
boardSize  = floor(screenWidthInPixels / 8) * 8 / screenScale   // full width, snapped
squareSize = boardSize / 8
pieceSize  = squareSize * 0.95
```

Snapping the pixel width down to a multiple of 8 before dividing kills sub-pixel seams on 2x/3x
displays. No border, no corner radius, no horizontal padding — the board is edge-to-edge and
**left-aligned at x = 0** on every puzzle screen.

### 6.2 Square fill precedence — strict order

1. Selected square **or** drag origin → `#F6F669`
2. Custom highlight (solution reveal) → that color
3. Last move (from **and** to) → `#CDD26A`
4. Theme light / dark

Light test: `(row + col) % 2 == 0` in logical coordinates (a8 = row 0, col 0 = light).
Themes: **classic** `#F0D9B5`/`#B58863` (default), **green** `#EEEED2`/`#769656`,
**blue** `#BFD4E0`/`#6B8FA8`. Persist the choice; it is shared with the Analysis Board.

### 6.3 Coordinate labels

Rank digits on the leftmost visual column only, `bottom 2 / left 3`. File letters on the bottom
visual row only, `bottom 1 / right 2`. Both 9pt bold, colored the **opposite** square color.
Derive from the square name so flipping stays correct automatically.

### 6.4 Legal move indicators

- Empty destination → dot: diameter `squareSize * 0.3`, fill `rgba(0,0,0,0.2)`
- Capture → ring: diameter `squareSize * 0.85`, stroke width `squareSize * 0.08`,
  stroke `rgba(0,0,0,0.25)`, no fill

Computed once on selection/drag-start and cached. Beneath the piece, centered, non-interactive.

### 6.5 Drag and drop

- Pan gesture, `minDistance 4`, 4pt hit slop on all sides
- Eligibility: a piece exists **and** its color equals the side to move. In puzzle modes the
  solver may only move their own color — except after a solve or a solution reveal, when the
  board unlocks for free two-sided analysis
- On drag start: cache legal destinations, fire a **light haptic** (the only haptic in the entire
  feature)
- Floating piece: container `squareSize * 1.4`, glyph `squareSize * 1.3`; positioned
  `x = touch.x - floatSize * 0.5`, `y = touch.y - floatSize * 0.82`. Shadow: black, offset (0,8),
  opacity 0.45, radius 12. Spring in: stiffness 600, damping 28, mass 0.6, overshoot clamped.
  Spring out: stiffness 500, same otherwise
- Origin square's piece renders at **0.3 opacity** while dragging
- Hover highlight: full square tinted `rgba(20,85,30,0.5)` under the piece's visual center
  (`touch.y - squareSize * 0.45`), clamped to the board
- Drop: apply the same `-squareSize * 0.45` Y correction, then center-bias — if the point lands
  within `squareSize * 0.15` of an edge and the neighbour's center is nearer, snap there. Reject
  if outside the board, same as origin, or not in the cached legal list

### 6.6 Tap-to-move

First tap selects (square turns `#F6F669`, indicators appear), second tap moves. Tapping the
selected square deselects. Tapping another own piece re-selects.

---

## PART 7 — Puzzle Selection (offline)

Four selectors, one shared 3-tier fallback shape. All of them mark the chosen puzzle as seen.

### 7.1 The universal fallback pattern

```
Tier 1: unseen, inside the rating window, matching the theme filter → random
Tier 2: unseen, matching the theme filter, ordered by ABS(rating - target) → nearest
Tier 3: clear the seen set FOR THIS FILTER, then repeat Tier 2
```

> **Fix a real bug from the server here.** The Laravel version wiped the user's *entire*
> `user_seen_puzzles` table whenever any single mode ran dry — so exhausting one narrow theme
> reset non-repetition for every mode at once. Scope the Tier-3 wipe to the rows the current
> query could match (that theme, or that rating band). Only wipe globally if the unscoped pool is
> genuinely exhausted.

### 7.2 Rated mode (Play Puzzles)

Window **±100** around `profile.rating`.

```sql
SELECT p.* FROM puzzles p
WHERE p.rating BETWEEN :r - 100 AND :r + 100
  AND p.id NOT IN (SELECT puzzle_id FROM seen)
ORDER BY RANDOM() LIMIT 1;
```

### 7.3 Streak / Turbo mode

Window **±50** around an explicit target rating, with an optional theme filter (`mateIn1` during
warmup).

### 7.4 Thematic mode

Window **±200** around `profile.rating`, theme filter mandatory.

### 7.5 Daily mode

Fully deterministic — see Part 11.1. Not a query.

### 7.6 Prefetching

The original prefetched aggressively (a 20-deep buffer in rated mode, a 12-deep buffer with 6
parallel HTTP fetches in Turbo) purely to hide network latency. **A local SQLite read is sub-
millisecond. Delete all of it.** Keep exactly one lookahead in Puzzle Turbo — fetch the next
puzzle while the current one is on screen — so the 300 ms transition never stalls. Nothing else.

---

## PART 8 — Rating (Elo)

The one place `PuzzleProfile.rating` changes. **Rated mode only** — Daily, Thematic, Streak, and
Turbo never touch it.

```swift
func applyResult(isCorrect: Bool, puzzleRating: Int) -> (change: Int, newRating: Int) {
    let expected = 1.0 / (1.0 + pow(10.0, Double(puzzleRating - rating) / 400.0))
    let actual   = isCorrect ? 1.0 : 0.0
    let k        = 32.0
    let change   = Int((k * (actual - expected)).rounded())    // half-up
    let newRating = max(400, rating + change)
    return (change, newRating)
}
```

- **K = 32**, base 10, divisor 400, binary score, no partial credit, no time bonus
- **Floor 400**, no ceiling
- **Rating moves on wrong answers too** — that is the point of a rating
- **Puzzle ratings are immutable.** The bundle is read-only; a one-way Elo is all you need
- Write one `PuzzleAttempt` row per puzzle, **first rated attempt only**. Replaying a puzzle later
  is allowed but must not move the rating or write a second row
- Update `highestRating` whenever `newRating` exceeds it
- Update the matching `ThemeStat` rows (attempted +1 always, solved +1 when correct) for every
  theme on the puzzle — this feeds the stats screen in Part 10.1

---

## PART 9 — Screen: Puzzle Hub

Entry point from the app's home screen. Background `#0F1A2E`. No scroll view.

### 9.1 Layout

**Band 1 — Header** (`paddingHorizontal 16`, `paddingVertical 10`): back `←` 24pt `#FFFFFF` in a
40×40 box · title **"Puzzle Hub"** 18pt bold `#FFFFFF` · app logo 30pt.

**Band 2 — Hero** (`alignItems center`, `paddingTop 6`, `paddingBottom 10`, `gap 4`):
- Glow circle **68×68**, radius 34, fill `rgba(253,176,34,0.12)`, 2pt border
  `rgba(253,176,34,0.35)`, bottom margin 4, containing the knight artwork at **52×52**
- **"Choose Your Mode!"** 19pt bold `#FFFFFF`
- **"Train your tactics your way 💪"** 13pt `#8BA3C7`

**Band 3 — Cards** (`flex 1`, `paddingHorizontal 14`, `paddingBottom 10`,
`justifyContent spaceEvenly`): five cards distributed evenly into the remaining height — **no
fixed gap**, the spacing grows with the screen.

**Card shell:** row, fill `#1A2942`, radius 14, `paddingVertical 13`, `paddingHorizontal 14`,
**4pt left border in the mode color**, `gap 12`, shadow black offset (0,2) opacity 0.25 radius 4.
Press opacity 0.72.
- Emoji tile **44×44**, radius 12, 1.5pt border, fill = mode color at **13% alpha**, border =
  mode color at **33% alpha**, glyph 22pt
- Info column (`flex 1`): title 14pt bold `#FFFFFF` (bottom margin 2); subtitle 11pt `#8BA3C7`,
  single line
- Trailing column (`alignItems center`, `gap 4`): badge pill — `paddingHorizontal 8`,
  `paddingVertical 3`, radius 20, fill = mode color, text 9pt bold `#FFFFFF` letter-spacing 0.5;
  then chevron `›` 22pt bold, line height 24, in the mode color

### 9.2 The five cards

| # | Emoji | Title | Subtitle | Color | Badge |
|---|---|---|---|---|---|
| 1 | ♟️ | Play Puzzles | Solve rated puzzles & level up | `#5CC264` | `RATED` |
| 2 | 📅 | Daily Puzzle | Today's special challenge awaits | `#FDB022` | `DAILY` |
| 3 | 🎯 | Thematic Puzzles | Master specific tactics & patterns | `#A855F7` | `THEMES` |
| 4 | ⚡ | Puzzle Turbo | Race against the clock! | `#4A90E2` | `RUSH` |
| 5 | 🔥 | Puzzle Streak | One mistake and it's over — keep going! | `#FF6B35` | `STREAK` |

> **Two inconsistencies to fix while porting.** (a) The hub's accents for Thematic (`#A855F7`),
> Turbo (`#4A90E2`), and Streak (`#FF6B35`) do not match those screens' own accents (`#8E24AA`,
> `#1E88E5`, `#F4511E`) — unify on the **screen** colors so a tapped card flows into a matching
> screen. (b) The card titled "Puzzle Turbo" routes to a folder named `puzzle-rush`; the
> user-facing name is **Puzzle Turbo** everywhere, so name the Swift types `Turbo…` and stop
> carrying "rush" into the UI.

### 9.3 Daily goal strip — NEW

Insert between the hero and the cards: `paddingHorizontal 14`, bottom margin 10. See Part 15 for
the full spec. The hub is static in the original; here it reads two counters from SwiftData.

---

## PART 10 — Mode 1: Play Puzzles (rated)

### 10.1 Play Puzzles Home

The original screen was a leaderboard with a Play button. **Offline there are no other players**,
so the leaderboard is replaced by the user's own statistics — which is strictly more useful and
uses data you already have.

Background `#0F1A2E`.

**Band 1 — Header** (`paddingHorizontal 16`, `paddingTop 10`, `paddingBottom 6`): back `←` 24pt ·
**"Play Puzzles"** 18pt bold `#FFFFFF` · badge pill fill `#5CC264`, `paddingHorizontal 10`,
`paddingVertical 4`, radius 12, text **"♟️ RATED"** 11pt bold `#FFFFFF`.

**Band 2 — Top section** (`paddingHorizontal 16`, `gap 8`):

*Hero card* — fill `#1A2942`, radius 14, `paddingHorizontal 12`, `paddingVertical 10`, row,
`gap 10`, 1pt border `rgba(92,194,100,0.3)`:
- `♟️` 28pt
- Column (`flex 1`): **"Rated Puzzle Mode"** 14pt bold `#FFFFFF`;
  **"Solve puzzles · Earn ELO · Climb the ranks"** 11pt `#8BA3C7` top margin 2
- Stat row: fill `rgba(92,194,100,0.07)`, radius 8, `paddingHorizontal 8`, `paddingVertical 6` —
  three mini stats (`⭐`/`ELO`, `🧩`/`Rated`, `📈`/`Track`), icons 14pt, labels 9pt `#8BA3C7`
  weight 600 top margin 1, `paddingHorizontal 6` each, separated by 1×20 dividers
  `rgba(255,255,255,0.08)`

**Band 3 — Your stats** (scrollable, `flex 1`, `paddingHorizontal 16`, `paddingTop 8`) — this is
the replacement for the leaderboard. Four cards, each fill `#1A2942`, radius 16, padding 16,
bottom margin 12; section titles 16pt bold `#FFFFFF`:

1. **Rating card** — current rating **32pt bold `#FDB022`**, label "Current Rating" 12pt
   `#8BA3C7`; to the right, "Best" `highestRating` 20pt bold `#FFFFFF`; below, a 7-day delta
   (`+38` in `#43D97C`, `-12` in `#FF6B6B`, `—` in `#8BA3C7` when there is no history).
2. **Rating history sparkline** — width = card width − 32, **height 52**, radius 6, background
   `#0F1A2E`. Plot the last **30** rated attempts' `ratingAfter` as a polyline, stroke `#FDB022`
   width 1.5, round joins, no fill, no axes, no labels. Y-range = `[min - 25, max + 25]` of the
   window. Render nothing with fewer than 2 points.
   *(The server's version of this list was accidentally the **oldest** 30 rows — `orderBy asc,
   take 30`. Use the newest 30.)*
3. **Accuracy card** — `solved / attempted` as a percentage, 1 decimal, 28pt bold; color
   `≥80 #43D97C · ≥60 #FDB022 · else #FF6B6B`. Sub-line `"{solved} of {attempted} solved"` 12pt
   `#8BA3C7`.
4. **Activity — Last 7 Days** — a bar chart, ported from the profile screen exactly:
   ```
   maxVal    = max(counts.max() ?? 1, 1)
   barHeight = max(count / maxVal * 80, 4)
   ```
   Row, `justifyContent spaceBetween`, `alignItems flexEnd`, top margin 12. Each column: count
   label 10pt `#FDB022` weight 700 fixed **height 14** (blank when 0); track **width 28, height
   80** aligned to the bottom; fill full width, radius 4, `#FDB022` when count > 0 else `#253552`;
   day letter 11pt `#8BA3C7` weight 600 = first character of the localized short weekday.
5. **Theme performance** — up to 6 rows sorted by `attempted` desc: theme display name 13pt
   `#FFFFFF` (`flex 1`), a horizontal track `height 6` radius 3 fill `#253552` with a `#FDB022`
   fill at `accuracy%`, and the percentage 12pt bold `#FDB022` `minWidth 44` right-aligned.

**Band 4 — Bottom** (`paddingHorizontal 16`, `paddingBottom 10`, `paddingTop 6`, `gap 8`):
- Info strip: fill `rgba(92,194,100,0.07)`, radius 10, `paddingHorizontal 12`,
  `paddingVertical 8`, 1pt border `rgba(92,194,100,0.18)`; text 11pt `#8BA3C7`, centered, line
  height 16: **"Correct solve = +ELO · Wrong move = −ELO · Rating range: ±100"**
- Share button: fill `#1E88E5`, radius 14, `paddingVertical 11`, text **"📤 Share My Rating"**
  14pt bold `#FFFFFF`
- Play button: fill `#5CC264`, radius 14, `paddingVertical 14`, shadow `#5CC264` offset (0,4)
  opacity 0.35 radius 8; text **"♟️ Play Puzzles"** 17pt bold `#FFFFFF`

**Share text** (native share sheet, no URL — see Part 21):
```
Check out my chess puzzle stats on Biyaherong Chess Coach! ♟️
My puzzle rating: ⭐ {rating}
#BiyaherongChess #ChessPH
```

### 10.2 Play Puzzles Solver — layout

Loading state: centered, large spinner `#FDB022`, **"Loading puzzle..."** `#8BA3C7` 16pt, top
margin 12.

**Band 1 — Header** (`paddingHorizontal 16`, `paddingVertical 8`, height **56**): back `←` 24pt
`#FFFFFF` in a 40×40 box · app logo **40pt** · a 40pt spacer so the logo stays centered.

**Band 2 — Info strip** — fixed **height 34**, row, `paddingHorizontal 12`, fill `#1A2942`.
Left text 13pt weight 600, one of:

| State | Text | Color |
|---|---|---|
| playing | `♙ White to Move` / `♟ Black to Move` | `#8BA3C7` |
| solved | `✅ Solved!` + `"  ⏱ MM:SS"` when a solve time exists (**two spaces**) | `#43D97C` |
| wrong, no solution shown | `❌ Wrong move!` | `#FF6B6B` |
| solution shown | `💡 Viewing Solution` | `#FDB022` |

> In the original these are four independent conditions, so "✅ Solved!" and "💡 Viewing
> Solution" can render simultaneously inside a 34pt strip. **Make it a single enum** — one state,
> one string.

The `📵 Offline Mode` badge that appeared here is deleted: offline is now the only mode.

**Band 3 — Board** — full width, left-aligned, no padding. When solved or viewing the solution,
the engine arrow overlay draws on top (Part 18).

**Band 4 — Stats row** — row, `justifyContent spaceAround`, `paddingVertical 10`,
`paddingHorizontal 12`, fill `#1A2942`. Three items, each centered:

| Item | Label (11pt `#8BA3C7` weight 500, bottom margin 2) | Value (16pt bold `#FDB022`) |
|---|---|---|
| 1 | `Your Rating` | `{rating}` + delta line |
| 2 | `⏱` | `MM:SS`, or `--:--` before the clock starts — **white**, `.monospacedDigit()` |
| 3 | `Puzzle` | `{puzzle.rating}` |

Rating delta (only after a rated result): 11pt weight 700, top margin 1, `+14` in `#43D97C` /
`-11` in `#FF6B6B`.

`formatTime` = `MM:SS`, zero-padded, minutes uncapped.

**Band 5 — Bottom panel** (`flex 1`, `paddingHorizontal 12`, `paddingTop 8`) — four states:

- **Playing** → *empty*. No buttons at all while solving. This is deliberate.
- **Solved** → **"Solution"** button (fill `#FDB022`, radius 10, `paddingVertical 12`, text 15pt
  bold `#0F1A2E`), then **"Next Puzzle →"** (fill `#FDB022`, radius 10, `paddingHorizontal 24`,
  `paddingVertical 10`, top margin 8).
- **Wrong** → a row (`gap 12`) of **"🔄 Retry"** (`flex 1`, fill `#253552`, radius 10,
  `paddingVertical 12`, 1pt border `rgba(255,255,255,0.15)`, text 15pt bold `#FFFFFF`) and
  **"💡 Solution"** (`flex 1`, fill `#FDB022`, text 15pt bold `#0F1A2E`); then **"Next Puzzle →"**
  with top margin 8.
  *(The original hid the Solution button when offline, because the engine lived on the server.
  Your engine is embedded — always show it.)*
- **Viewing solution** → the engine panel (Part 18), then **"💾 Save Puzzle"**, then
  **"Next Puzzle →"**.

### 10.3 Play Puzzles Solver — behavior

**Timer.** Starts immediately after the opponent's setup move. Ticks every **1000 ms** but the
displayed value is derived from wall-clock (`now - startTime`), so a dropped tick never drifts.
Stops on solve or on a wrong answer; the final value is shown in the info strip.

**Retry.** Rebuilds the position from `puzzle.fen`, resets `currentMoveIndex = 1`, clears the
solution/analysis state, and replays the opponent's setup move after **500 ms**.

> **Fix three retry bugs from the original:** (a) the clock was never restarted and `startTime`
> was never reset, so a post-retry solve reported time since the *first* attempt — restart the
> clock; (b) the game-start sound was skipped on retry — play it; (c) the rating delta was
> cleared, so it vanished permanently. Rating is still submitted only **once** per puzzle (the
> first attempt decides it) — that part is correct, keep it.

**Rating submission.** On the first `finish()` for a puzzle, apply Part 8, write the
`PuzzleAttempt`, update `ThemeStat`s, and update the daily-goal counter (Part 15) when correct.
Retries never re-submit.

**Draft / resume.** Save `PlayPuzzleDraft` when leaving the screen with an unsolved puzzle; clear
it on solve and on Next. Restore silently on entry if it is under **24 hours** old — no prompt.

**Solution reveal.** Sets the phase to `.reviewing`, which:
1. Turns the info strip gold
2. Unlocks the board for free two-sided play (either color may move)
3. Runs the engine on the current position and draws up to **3** arrows plus the engine panel

It does **not** auto-play the solution line. There is no hint feature — do not invent one.

**Save Puzzle.** Opens a bottom sheet that writes an `AnalysisSession` (the Analysis Board's
SwiftData model), so the puzzle lands in the Analysis Board's saved list.

Sheet: `justifyContent flexEnd`, scrim `rgba(0,0,0,0.6)`. Card fill `#1A2942`, top corners radius
20, padding 20, bottom padding 36. Title **"💾 Save Puzzle"** 16pt weight 800 `#FDB022`, bottom
margin 16. Field label 12pt weight 600 `#8BA3C7` bottom margin 4; field fill `#253552`, radius 8,
`paddingHorizontal 12`, `paddingVertical 10`, 14pt `#FFFFFF`, 1pt border `rgba(255,255,255,0.1)`,
bottom margin 12, placeholder color `#6B7B8D`.
- **"Name"** → placeholder `Puzzle name...`, max 120, prefilled `Puzzle #{id}`
- **"Notes (optional)"** → placeholder `Themes, rating, notes...`, multiline, `minHeight 70`,
  top-aligned, prefilled with the non-empty lines of:
  ```
  Rating: {rating}
  Themes: {themes joined by ", "}
  Opening: {openingTags joined by ", "}
  ```
- Footer row (`gap 10`, top margin 4): **Cancel** (`flex 1`, fill `#253552`, radius 10,
  `paddingVertical 12`, 1pt border `rgba(255,255,255,0.15)`, text 15pt weight 700 `#FFFFFF`) and
  **Save** (`flex 1`, fill `#FDB022`, text 15pt weight 700 `#0F1A2E`; 0.6 opacity + spinner while
  writing)

The saved PGN is built by replaying `puzzle.moves` from `puzzle.fen` and emitting SAN as
`1. e4 e5 2. Nf3 …` terminated by ` *`, with no `[FEN]` header — the FEN goes into the session's
`initialFen` field instead. On success the button becomes **"✅ Saved to Analysis Board"** with a
`rgba(67,217,124,0.4)` border and is disabled.

---

## PART 11 — Mode 2: Daily Puzzle

The original fetched `https://api.chess.com/pub/puzzle`. **That is the only genuinely
network-dependent mode**, and it needs a real offline replacement, not a removal.

### 11.1 Deterministic daily selection

At build time, populate `daily_pool` with a curated subset of the bundle:

- rating **1200 – 1900** (challenging but solvable for a typical user)
- `nb_plays >= 500` and `popularity >= 90` — the crowd-approved ones
- move count **≤ 6** so it stays a coffee-break puzzle
- shuffled once with a **fixed seed**, then numbered `day_index = 0 … N-1`
- target size **≥ 3,000** (over 8 years of daily puzzles before the first repeat)

At runtime:

```swift
let day   = Calendar.current.startOfDay(for: Date())
let epoch = Calendar.current.date(from: DateComponents(year: 2026, month: 1, day: 1))!
let n     = Calendar.current.dateComponents([.day], from: epoch, to: day).day ?? 0
let index = ((n % poolCount) + poolCount) % poolCount     // safe for dates before the epoch
```

This gives every device the same puzzle on the same calendar date with zero communication, which
keeps "today's puzzle" meaningful if two users compare notes.

> **Use the LOCAL calendar, not UTC.** The original computed dates with
> `new Date().toISOString().split('T')[0]`, so in Manila (UTC+8) the "daily" puzzle and every
> daily counter rolled over at **8 a.m. local**, not midnight — while the UI said "resets at
> midnight". Use `Calendar.current.startOfDay(for:)` everywhere in this feature.

### 11.2 Daily Puzzle Home

Header: `paddingHorizontal 20`, `paddingTop 16`, `paddingBottom 12` — back `←` **24pt** in a 40×40
box · **"Daily Puzzle"** 20pt bold · app logo 30pt.
Scroll content: `paddingHorizontal 20`, `paddingBottom 40`.

1. **Hero** — fill `#1A2942`, radius 20, padding 28, centered, bottom margin 20, 1pt border
   `rgba(124,179,66,0.3)`: `📅` 56pt (bottom margin 12) · **"Today's Challenge"** 20pt bold
   `#FFFFFF` (bottom margin 6) · subtitle 13pt `#8BA3C7`, centered.
   **Change the subtitle** — the original reads "A new puzzle every day — powered by Chess.com",
   which is now false. Use **"A new puzzle every day — always offline"**.
2. **Stats row** — row `gap 12`, bottom margin 16. Two cards, each `flex 1`, fill `#1A2942`,
   radius 16, padding 20, centered, `gap 4`, 1pt border `rgba(253,176,34,0.15)`: emoji 28pt,
   value **32pt bold `#FDB022`**, label 12pt `#8BA3C7` weight 600.
   Card 1 = `🔥` / `{streak}` / **"Day Streak"**. Card 2 = `📅` / `{totalSolved}` /
   **"Total Solved"**.
3. **Info card** — fill `#1A2942`, radius 16, padding 20, bottom margin 20, 1pt border
   `rgba(124,179,66,0.15)`: title **"How it works"** 15pt bold `#7CB342` (bottom margin 8); body
   14pt `#8BA3C7` line height 22:
   **"Solve today's puzzle to keep your streak alive. Miss a day and it resets to zero. Come back
   every day to build your longest streak!"**
4. **CTA** — if not yet solved today: fill `#7CB342`, radius 16, `paddingVertical 18`, shadow
   black offset (0,4) opacity 0.3 radius 8; text **"🧩 Solve Today's Puzzle"** 18pt bold
   `#FFFFFF`.
   If already solved: a card fill `#1A2942`, radius 16, padding 28, centered, `gap 8`, 1pt border
   `rgba(92,194,100,0.3)` — `✅` 48pt · **"Puzzle Solved!"** 20pt bold `#5CC264` ·
   **"Come back tomorrow — today's puzzle is already solved."** 14pt `#8BA3C7`, centered, line
   height 22.

### 11.3 Daily Puzzle Solver

Header: `paddingHorizontal 20`, `paddingVertical 12` — back · a centered column with
**"Daily Puzzle"** 18pt bold `#FFFFFF` and, under it, the puzzle's theme summary 12pt `#8BA3C7`
top margin 2, `maxWidth 200`, single line (the original showed Chess.com's puzzle title here;
offline, use the primary theme's display name) · app logo 30pt.

Then: the board · feedback banner · instruction line · Done button.

- **Feedback banner** — `marginHorizontal 16`, radius 12, padding 16, row centered, `gap 8`,
  top margin 12. Solved: fill `rgba(92,194,100,0.2)`, 1pt border `#5CC264`, `🏆` 24pt,
  **"Puzzle Solved! Streak updated!"** 16pt bold `#FFFFFF`. Wrong: fill `rgba(255,68,68,0.2)`,
  1pt border `#FF4444`, `✗` 24pt, **"Not the right move — try again!"**, auto-hiding after
  **1300 ms**.
- **Instruction line** (hidden once solved) — centered, `paddingVertical 12`, text 15pt `#8BA3C7`
  weight 600: **"White ♙ to move"** / **"Black ♟ to move"**.
- **Done button** (after solving) — `marginHorizontal 16`, fill `#7CB342`, radius 16,
  `paddingVertical 16`, top margin 12; text **"← Back to Daily Puzzle"** 16pt bold `#FFFFFF`.
- Delete the **"Powered by Chess.com ♟"** credit link entirely.

**Streak rule** (unchanged, but on the local calendar):
```
if lastSolvedDay == today      → no-op (already counted)
else if lastSolvedDay == yesterday → streak += 1
else                          → streak = 1
totalSolved += 1;  lastSolvedDay = today
```
Opponent reply delay **400 ms**; the final auto-solve fires **400 ms** after that. (Daily uses
400, not 500 — a small original inconsistency that is fine to keep, or unify to 500. Pick one and
be consistent.)

---

## PART 12 — Mode 3: Thematic Puzzles

Premium-gated in the original. **The offline app is a one-time purchase, so the gate is gone** —
delete the lock overlay, the dimming, the `👑 PREMIUM` badge, the disabled start button, and the
upgrade modal.

### 12.1 The 12 themes — verbatim

The emoji is baked into the label string. There is no separate icon or description field.

| id | label | tile color |
|---|---|---|
| `hangingPiece` | `🎯 Hanging Piece` | `#8E24AA` |
| `crushing` | `💥 Crushing` | `#7B1FA2` |
| `fork` | `⚔️ Fork` | `#6A1B9A` |
| `pin` | `📌 Pin` | `#4A148C` |
| `skewer` | `🗡️ Skewer` | `#880E4F` |
| `discoveredAttack` | `🔍 Discovered Attack` | `#1565C0` |
| `advantage` | `📈 Advantage` | `#0D47A1` |
| `endgame` | `🏁 Endgame` | `#1B5E20` |
| `backRankMate` | `🏰 Back Rank Mate` | `#BF360C` |
| `mateIn1` | `♟️ Mate in 1` | `#B71C1C` |
| `mateIn2` | `♚ Mate in 2` | `#C62828` |
| `middlegame` | `⚙️ Middlegame` | `#37474F` |

Copy the code points exactly: `⚔️`, `🗡️`, `♟️`, `⚙️` carry U+FE0F variation selectors; `♚` does
not.

### 12.2 Theme grid screen

Background `#0F1A2E`, **no scroll view** — the grid fills the available height.

1. Header (`paddingHorizontal 20`, `paddingVertical 8`): back · **"Thematic Puzzles"** 20pt bold ·
   app logo 30pt.
2. Badge row — centered, `gap 8`, bottom margin 10: pill fill `#8E24AA`, `paddingHorizontal 16`,
   `paddingVertical 6`, radius 20, text **"🎯 THEMED TRAINING"** 13pt bold `#FFFFFF`
   letter-spacing 1. *(The second, gold `👑 PREMIUM` pill is deleted.)*
3. **"Choose a Theme"** 14pt weight 600 `#8BA3C7`, bottom margin 8, `paddingHorizontal 16`.
4. Grid — `flex 1`, `paddingHorizontal 12`, `paddingBottom 8`, row gap 8. **3 columns × 4 rows**,
   filled left→right, top→bottom in the table order. Each row `flex 1`, `gap 8`; each card
   `flex 1`, radius 12, **1.5pt border in the theme color**, fill `#1A2942`, centered, padding 6.
   Selected → fill becomes the theme color. Label 13pt weight 600 `#FFFFFF`, centered, 2 lines
   max, auto-shrinking to a 0.7 minimum scale (≈9.1pt floor). Press opacity 0.8.
   Tapping the selected card **deselects** it.
5. Start button — fill `#8E24AA`, radius 16, `paddingVertical 16`, `marginHorizontal 12`,
   `marginBottom 8`, centered; text 16pt bold `#FFFFFF`. Label: **"Select a Theme"** when nothing
   is chosen (disabled: fill `#3A2A4A`, opacity 0.6), otherwise **`Start {label} Puzzles`** —
   e.g. "Start 📌 Pin Puzzles".

### 12.3 Thematic solver

Header: back · centered column with the theme label 18pt bold `#FFFFFF` and **`Solved: {n}`**
12pt `#8BA3C7` top margin 2 (a session-only counter) · app logo 30pt.

Scroll content (`paddingBottom 24`):
1. Board (+ arrow overlay once solved or the solution is shown)
2. **Stats bar** — row `justifyContent spaceAround`, fill `#1A2942`, radius 16, padding 16,
   `marginHorizontal 8`, top margin 8, bottom margin 12, shadow black offset (0,2) opacity 0.15
   radius 8. One stat only: label **"Puzzle Rating"** 13pt `#8BA3C7` weight 500 letter-spacing
   0.3 bottom margin 4; value 28pt bold `#FDB022` with a `rgba(253,176,34,0.4)` text shadow,
   offset (0,2), radius 6.
3. Hint line (while unsolved) — `marginHorizontal 8`, centered, `paddingVertical 12`, 14pt
   `#8BA3C7` weight 500: **"♙ You play White — Find the best move!"** /
   **"♟ You play Black — Find the best move!"** (em-dash; the `♙`/`♟` glyphs here carry no
   variation selector).
4. Feedback block — `marginHorizontal 8`, radius 12, padding 16, centered, bottom margin 12,
   `gap 12`. Correct: fill `rgba(67,217,124,0.2)`, 1pt border `#43D97C`, text
   **"✅ Puzzle Solved!"**. Wrong: fill `rgba(255,68,68,0.2)`, 1pt border `#FF4444`,
   **"❌ Wrong move!"**. Text 16pt bold `#FFFFFF`.
5. Wrong-state buttons — row `gap 12`, full width: **"🔄 Retry"** (`flex 1`, fill `#253552`,
   radius 10, `paddingVertical 12`, 1pt border `rgba(255,255,255,0.15)`, 15pt bold `#FFFFFF`) and
   **"💡 Solution"** (`flex 1`, fill `#FDB022`, 15pt bold `#0F1A2E`).
6. **"Next Puzzle →"** — fill `#FDB022`, radius 10, `paddingHorizontal 24`, `paddingVertical 10`,
   self-centered, top margin 10, 15pt bold `#0F1A2E`.
7. Engine panel once solved / revealed (Part 18).

Thematic **never touches the rating** — no Elo, no `PuzzleAttempt` row, no rating display. It
does update `ThemeStat` (attempted/solved) so the stats screen reflects thematic practice.
Opponent delay **500 ms**. When a theme runs dry: alert **"All puzzles solved for this theme!"**
then pop back — though with the Part 7.1 scoped-wipe fix this should be unreachable.

---

## PART 13 — Mode 4: Puzzle Streak

Sudden death. One wrong move ends the run.

### 13.1 Streak Home

1. Header: back · **"Puzzle Streak"** 18pt bold · badge pill fill `#F4511E`,
   `paddingHorizontal 10`, `paddingVertical 4`, radius 12, text **"🔥 STREAK"** 11pt bold
   `#FFFFFF`.
2. Top section (`paddingHorizontal 16`, `gap 8`):
   - **Streak display card** — fill `#1A2942`, radius 16, padding 14, centered, 1pt border
     `rgba(244,81,30,0.3)`, **minHeight 86**: number **46pt bold `#F4511E`, line height 52** ·
     **"Current Streak"** 14pt bold `#FFFFFF` top margin 2 · **"One mistake ends it!"** 11pt
     `#8BA3C7` top margin 2.
   - **Stats row** — row `gap 8`, three cards each `flex 1`, fill `#1A2942`, radius 14,
     `paddingVertical 10`, centered, `gap 2`, 1pt border `rgba(244,81,30,0.15)`: emoji 18pt,
     value 20pt bold `#FDB022`, label 10pt `#8BA3C7` weight 600.
     `🏆`/`{best}`/**"Best"** · `🔥`/`{current}`/**"Current"** · `♟`/`∞`/**"No Timer"**.
3. **Streak History** (replaces the leaderboard) — section header **"🔥 Recent Runs"** 13pt bold
   `#FDB022`, then a list (`flex 1`, `paddingHorizontal 16`, `paddingTop 8`) of the last 10
   `StreakRun`s, newest first. Row: fill `#1A2942`, radius 12, `paddingHorizontal 12`,
   `paddingVertical 10`, bottom margin 6, row layout — `🔥 {length}` 15pt bold `#F4511E`
   (`minWidth 60`), a relative date ("Today", "Yesterday", "Mar 12") 13pt `#8BA3C7` (`flex 1`,
   right-aligned), and a `🏆` suffix on any run that equalled the all-time best.
   Empty state: centered, **"No runs yet — start your first streak! 🔥"** 13pt `#8BA3C7`.
4. Bottom (`paddingHorizontal 16`, `paddingBottom 10`, `paddingTop 6`, `gap 8`): share button
   (fill `#1E88E5`, radius 14, `paddingVertical 11`, **"📤 Share"** 14pt bold `#FFFFFF`) and the
   start button (fill `#F4511E`, radius 14, `paddingVertical 14`, 16pt bold `#FFFFFF`).
   Start label: **"🔥 Resume / New Streak"** when `currentStreak > 0`, else **"🔥 Start Streak"**.
   Delete the `1 attempt used today · Resets at midnight` line and the disabled/locked variant.

**Resume alert** (only when `currentStreak > 0`):
- Title **"Resume Session?"**
- Body **`You have an unfinished streak (🔥 {current} solved). Continue where you left off or start
  fresh?`**
- **"New Game"** (destructive) → reset the streak state, then open the solver
- **"Continue"** → open the solver (the pending lock hands back the same puzzle)

### 13.2 Streak rules — port these constants exactly

```swift
let INITIAL_RATING = 600
let RATING_STEP    = 50
let RATING_MAX     = 2500
let WARMUP_COUNT   = 10
```

- **Warmup:** while `currentStreak < 10`, force target rating **600** and theme **`mateIn1`**.
  After 10 solves, use the stored `puzzleRating` with no theme filter.
- **Escalation:** on every solve, `puzzleRating = min(2500, puzzleRating + 50)`. This ramps from
  puzzle #1 *including during warmup*, so the moment warmup ends the target is already
  600 + 10×50 = **1100**. That is intentional — the difficulty cliff at puzzle 11 is the mode's
  signature.
- **Failure:** `currentStreak = 0`, `puzzleRating = 600`, `pendingPuzzleId = nil`. **`bestStreak`
  is preserved.** Append a `StreakRun`.
- **The pending lock (anti-reroll):** `pendingPuzzleId` is assigned when a puzzle is served and
  cleared only on solve or failure. Backing out of the screen and re-entering **must** return the
  identical puzzle. This is the whole reason the field exists — without it a user can reroll a
  hard puzzle by leaving and coming back.
- Selection: Part 7.3 with the tier fallback.

### 13.3 Streak solver

1. Header (`paddingHorizontal 20`, `paddingVertical 6`): back — a **44×44** target with `←`
   **28pt bold** `#FFFFFF` · the live counter **`🔥 {current}`** 34pt bold `#F4511E` · app logo
   30pt.
2. Stats bar — row `justifyContent spaceAround`, fill `#1A2942`, radius 16, `paddingVertical 8`,
   `paddingHorizontal 16`, `marginHorizontal 8`, bottom margin 6, shadow black offset (0,2)
   opacity 0.15 radius 6. Three children: `Streak`/`{current}`, a `🔥` divider glyph 20pt,
   `Best`/`{best}`. Labels 11pt `#8BA3C7` weight 500 bottom margin 2; values 22pt bold `#FDB022`.
3. Board (full width, flush left).
4. Bottom area — `flex 1`, centered both axes, `paddingHorizontal 16`, `gap 10`. Hint text 14pt
   `#8BA3C7` weight 500: **"♙ You play White — Find the best move!"** / black equivalent.

**Loading:** centered, `gap 16`, spinner `#F4511E`, **"Loading puzzle..."** `#8BA3C7` 15pt weight
500.

**Result overlay** (on failure) — absolute, inset 0, scrim `rgba(0,0,0,0.78)`, centered,
`paddingHorizontal 20`. Card fill `#1A2942`, radius 24, padding 28, full width, centered,
`gap 12`, 1pt border `rgba(244,81,30,0.3)`:
- **"Game Over"** 22pt bold `#FF4444`
- **`🔥 {finalStreak}`** 56pt bold `#F4511E`, line height 64
- **`Best: {best}`** 14pt `#8BA3C7` weight 600
- **New-best badge** when `finalStreak > 0 && finalStreak >= best`: fill `rgba(253,176,34,0.15)`,
  radius 12, `paddingHorizontal 16`, `paddingVertical 6`, 1.5pt border `#FDB022`, text
  **"🏆 NEW BEST!"** 16pt bold `#FDB022`
- **"💡 Show Solution"** — fill `#FDB022`, radius 12, `paddingVertical 11`,
  `paddingHorizontal 32`, full width, 15pt weight 700 `#0F1A2E`
- **"📤 Share Result"** — fill `#1E88E5`, same metrics, 15pt weight 700 `#FFFFFF`
- **"🔄 Play Again"** — fill `#F4511E`, radius 14, `paddingVertical 13`, `paddingHorizontal 40`,
  15pt bold `#FFFFFF`
- **"← Back to Menu"** — top margin 4, `paddingVertical 10`, 14pt `#8BA3C7` weight 600,
  underlined

> The original computes an `isNewBest` state variable and then never reads it — the badge is
> gated by an inline expression instead. Keep one source of truth.

**Solution strip.** Pressing "💡 Show Solution" **hides the overlay entirely** and reveals the
board with the correct move highlighted — from-square `rgba(253,176,34,0.65)`, to-square
`rgba(253,176,34,0.95)` — plus a strip in the bottom area: full width, centered, `gap 10`,
`paddingHorizontal 16`, `paddingVertical 12`, fill `#1A2942`, radius 16, 1pt border
`rgba(253,176,34,0.25)`.
- Label **"Correct move:"** 11pt `#FFAA55` weight 600 letter-spacing 0.5
- Move text 24pt bold `#FDB022` letter-spacing 1, formatted **`E2 → E4`** (uppercased, spaced
  arrow), with **` (=Q)`** appended when the UCI carries a promotion letter
- Button row `gap 8`, three `flex 1` buttons, radius 10, `paddingVertical 11`, 14pt weight 700:
  **"Menu"** (fill `#1E3A5F`, 1pt border `rgba(139,163,199,0.3)`, text `#8BA3C7`),
  **"Share"** (fill `#1E88E5`, `#FFFFFF`), **"Play Again"** (fill `#F4511E`, `#FFFFFF`)

**Sounds:** game-start on every mount; move/capture on every move; **game-over on failure**.
There is deliberately **no sound on a correct solve** — in a streak the reward is the next puzzle
appearing.

**Android-back equivalent:** the original registers a hardware-back handler that pops
immediately, with no confirmation. On iOS, the swipe-back gesture is the analogue — allow it, but
the pending lock means nothing is lost.

**Share text** (no URL):
```
I just completed a 🔥 {finalStreak} puzzle streak on Biyaherong Chess Coach! Best: {best} Can you beat me? #BiyaherongChess #ChessPH
```

---

## PART 14 — Mode 5: Puzzle Turbo (rush)

Three modes, three lives, one clock.

### 14.1 Mode select screen

```swift
let TIME_OPTIONS = [ (minutes: 0, label: "∞ Infinite", color: "#9C27B0"),
                     (minutes: 3, label: "3 min",      color: "#1E88E5"),
                     (minutes: 5, label: "5 min",      color: "#43A047") ]
```
Default selection **3**. `0` is the infinite sentinel (no clock). **There is no survival mode.**

1. Header: back · **"Puzzle Turbo"** 18pt bold · badge pill fill `#1E88E5`, radius 12,
   `paddingHorizontal 10`, `paddingVertical 4`, text **"⚡ RUSH"** 11pt bold `#FFFFFF`.
2. Top section (`paddingHorizontal 16`, `gap 8`):
   - **Info bar** — row `justifyContent spaceBetween`, fill `#1A2942`, radius 12,
     `paddingHorizontal 12`, `paddingVertical 9`, 1pt border `rgba(30,136,229,0.25)`. Left:
     **"Solve as many puzzles as you can!"** 12pt `#FFFFFF` weight 600, `flex 1`. Right: badge
     fill `rgba(229,57,53,0.15)`, radius 8, `paddingHorizontal 8`, `paddingVertical 4`, 1pt border
     `rgba(229,57,53,0.35)`, text **"3 mistakes = game over"** 10pt `#EF9A9A` weight 600.
   - **Mode card** — fill `#1A2942`, radius 14, `paddingHorizontal 12`, `paddingVertical 10`, 1pt
     border `rgba(30,136,229,0.2)`. Label **"SELECT MODE"** 10pt weight 800 `#5A7090`
     letter-spacing 0.8, bottom margin 8. Row of three tabs, `gap 8`; each `flex 1`,
     `paddingVertical 8`, `paddingHorizontal 4`, radius 12, centered, `gap 2`, fill `#253552`,
     1.5pt border `rgba(255,255,255,0.1)`. Selected: **both** fill and border become the mode
     color. Tab text 12pt weight 700 `#8BA3C7` → `#FFFFFF` when selected; sub-line
     **`Best: {bestScore}`** 10pt `#5A7090` weight 600 → `rgba(255,255,255,0.85)` when selected.
3. **Recent Runs** (replaces the leaderboard) — header **`🏆 {modeLabel} Runs`** 13pt bold
   `#FDB022`. List the last 10 `RushRun`s **for the selected mode**, newest first: fill `#1A2942`,
   radius 12, `paddingHorizontal 12`, `paddingVertical 10`, bottom margin 6 — `⚡ {score}` 15pt
   bold in the mode color (`minWidth 52`), `❌ {mistakes}` 12pt `#8BA3C7`, and a relative date
   13pt `#8BA3C7` right-aligned. Empty: **"No runs yet — be the first! ⚡"** 13pt `#8BA3C7`.
   Switching modes re-filters this list (it does not refetch anything).
4. Bottom (`paddingHorizontal 16`, `paddingBottom 10`, `paddingTop 6`, `gap 8`): share button
   (fill `#1E88E5`, radius 14, `paddingVertical 11`, **"📤 Share"**) and the start button —
   radius 14, `paddingVertical 14`, fill = the selected mode's color, shadow black offset (0,3)
   opacity 0.25 radius 6; text 16pt bold `#FFFFFF`, reading **"⚡ Start Rush (Infinite)"** for
   mode 0 or **`⚡ Start Rush ({n} min)`** otherwise. Delete the locked/disabled variant and the
   daily-tries line.

**Resume prompt (infinite only).** If a `RushDraft` exists, is under **24 hours** old, and has
`score > 0`:
- Title **"Resume Session?"**
- Body **`You have a previous session (Score: {score}, Mistakes: {mistakes}/3). Resume or start
  fresh?`**
- **"New Session"** (destructive) → delete the draft, start fresh
- **"Resume"** → restore `score`, `mistakes`, `targetRating`, `puzzlesServed`

Stale or scoreless drafts are deleted silently. Timed modes never prompt.

### 14.2 Turbo constants — port verbatim

```swift
let MAX_MISTAKES            = 3
let RUSH_WARMUP_COUNT       = 5        // note: Streak uses 10
let WARMUP_RATING           = 600
let DIFFICULTY_START_MAX    = 800
let DIFFICULTY_STEP_CORRECT = 50
let DIFFICULTY_STEP_WRONG   = 10       // note: still goes UP after a mistake
let DIFFICULTY_MAX          = 2500
let COMPUTER_MOVE_DELAY     = 300      // note: Streak uses 500
```

- **Starting target:** `min(800, max(400, profile.rating - 500))` → **700** for a default 1200
  player.
- **Warmup:** the first **5** puzzles are `mateIn1` at rating **600**.
- **After warmup:** target starts from the running value; correct → `+50`, wrong → `+10`, capped
  at 2500.
- **Timer:** `totalSeconds = minutes * 60` → 3 min = **180 s**, 5 min = **300 s**. Ticks every
  **1000 ms**. Starts only once, when the **first** puzzle appears — not during loading. Infinite
  mode has no clock.
- **No time bonus and no time penalty exists anywhere.** Solves do not add time; mistakes cost a
  life, not seconds.

### 14.3 Turbo run screen

1. Header (`paddingHorizontal 20`, `paddingVertical 6`): **"Quit"** button — a 52×40 box, text
   15pt `#8BA3C7` weight 600, left-aligned · the timer, **34pt bold**, `.monospacedDigit()`,
   formatted `M:SS` (e.g. `3:00`, `0:07`) or the literal **`∞`** · app logo 30pt.
   **Timer color:** infinite → `#9C27B0`; `timeLeft <= 10` → `#FF4444`; `timeLeft <= 30` →
   `#FDB022`; otherwise `#43D97C`.
2. Stats bar — identical metrics to the Streak bar (fill `#1A2942`, radius 16,
   `paddingVertical 8`, `paddingHorizontal 16`, `marginHorizontal 8`, bottom margin 6, shadow
   (0,2)/0.15/6). Left: **"Score"** / `{score}` 22pt bold `#FDB022`. Center: three `❌` glyphs
   16pt with `gap 4`, opacity **1.0** for used lives and **0.2** for remaining. Right: **"Mode"** /
   `∞` or `{n}m`.
3. Board, in a relatively-positioned container (it hosts the feedback dot).
4. Bottom area — `flex 1`, centered, `paddingHorizontal 16`; hint text
   **"♙ White to move"** / **"♟ Black to move"** 14pt `#8BA3C7` weight 500, hidden once the
   current puzzle is solved.

**Loading:** centered, `gap 16`, spinner **`#4A90E2`**, **"Loading puzzles..."** `#8BA3C7` 15pt
weight 500.

**Move feedback dot** — Turbo only, drawn over the destination square:
```
r    = squareSize * 0.21
left = (col + 1) * squareSize - r * 1.4
top  =  row      * squareSize + r * 0.4
size = 2r,  cornerRadius = r,  1.5pt white border,  non-interactive
```
Correct → fill `rgba(43,196,110,0.96)`, glyph `✓`. Wrong → `rgba(220,50,47,0.96)`, glyph `✕`.
Glyph `#FFFFFF`, size `r * 0.95`, bold. Auto-clears after **500 ms**. Column/row must account for
the board flip.

**Loop timing:** correct → dot, then the next puzzle mounts after **500 ms**. Wrong → the piece
**stays**, dot shows, and after **500 ms** either the next puzzle mounts or the game ends.

### 14.4 Ending a run

Triggers: 3 mistakes · the clock reaching 0 (timed only) · Quit (confirmed).

On end: play game-over, stop the clock, delete the infinite draft, update `RushBest` if beaten
(setting a new-best flag), and append a `RushRun` with score, mistakes, mode, and timestamp.

> **Fix two original bugs.** (a) Backgrounding a *timed* run silently set the phase to finished
> **without** running the end-of-game path — no best-score save, no history row, no sound. Route
> every ending through one `endGame()` function. (b) The results screen always reads
> **"Time's Up!"**, even when the run ended on 3 mistakes or in Infinite mode. Use the real
> reason.

**Results screen** — `flex 1`, centered, padding 40:
1. Icon `isNewBest ? "🏆" : "⏱️"` — 64pt, bottom margin 16
2. Title 24pt bold `#FFFFFF`, bottom margin 24 — **"New Best Score!"** on a new best, else
   **"Time's Up!"** (timer expiry) / **"Out of Lives!"** (3 mistakes) / **"Run Ended"** (quit)
3. Score `{score}` — **72pt bold `#FDB022`**
4. **"Puzzles Solved"** 16pt `#8BA3C7`, bottom margin 24
5. Stats block `gap 8`, bottom margin 24, each 16pt `#8BA3C7` centered:
   `❌ {n} mistake` / `mistakes` (correct singular/plural) and
   `∞ Infinite mode` / `⏱️ {n} min mode`
6. **"📤 Share Result"** — fill `#1E88E5`, radius 14, `paddingVertical 13`,
   `paddingHorizontal 32`, bottom margin 12, 15pt bold `#FFFFFF`
7. **"← Back to Puzzle Turbo"** — fill `#4A90E2`, radius 16, `paddingVertical 16`,
   `paddingHorizontal 32`, 16pt bold `#FFFFFF`

No accuracy, no rating delta, no per-puzzle list. Score, mistakes, mode.

**Quit modal** — a real modal with a fade transition. Backdrop `rgba(0,0,0,0.7)`, centered. Box
fill `#1A2942`, radius 20, padding 24, **width 300**, 1pt border `rgba(255,255,255,0.1)`.
Title **"Quit Puzzle Turbo?"** 18pt bold `#FFFFFF`, bottom margin 10. Body
**"Your current run will be lost."** 14pt `#8BA3C7`, line height 20, bottom margin 20. Buttons
row `gap 12`, both `flex 1`, radius 12, `paddingVertical 12`, 14pt weight 700 `#FFFFFF`:
**"Keep Playing"** (fill `#253552`, 1pt border `rgba(255,255,255,0.15)`) and **"Quit"** (fill
`#E53935`).

> The original discards the score on quit. Since you now keep run history locally, **save the run
> before leaving** — the warning text stays honest ("your current run will be lost" = the run
> stops), and the user still sees it in Recent Runs.

**Infinite draft** is written after every solve, after every mistake, and on backgrounding:
`{score, mistakes, targetRating, puzzlesServed, savedAt}`. Deleted on game end and on
"New Session".

**Share text:**
```
I scored {score} in Puzzle Turbo ({modeLabel}) mode! Can you beat me on Biyaherong Chess Coach? #BiyaherongChess #ChessPH
```

---

## PART 15 — Daily Goal (new — design, not port)

The Laravel backend has `GET /api/daily-goal` returning `solved_today`, `daily_target: 10`, and
`streak_days`. **The mobile app never called it — there is no daily-goal UI anywhere in the
original.** You are designing this surface, not porting it. Keep it small.

### 15.1 The rules

- **Target: 10 solves per day** (the server's hardcoded literal — keep it).
- **What counts:** a *correct* solve in **Play Puzzles, Daily Puzzle, Thematic, or Puzzle
  Streak**. **Puzzle Turbo is excluded** — a 3-minute run can produce 30 solves and would make
  the goal meaningless. Implement it as one predicate in one place so the decision is easy to
  revisit.
- **Day boundary:** `Calendar.current.startOfDay(for:)` — local, not UTC.
- **Goal streak:** consecutive local calendar days with **≥1** counting solve, anchored to
  **today or yesterday** (so the streak survives until the end of the following day), with a
  365-day lookback cap. This mirrors the server's `calculateStreak`.

Store it as a tiny append-only table (`DailySolveCount { day: Date, count: Int }`) rather than
deriving it from `PuzzleAttempt` — attempts only cover rated mode.

### 15.2 The strip (on the Puzzle Hub, between hero and cards)

Fill `#1A2942`, radius 14, `paddingHorizontal 14`, `paddingVertical 12`, 1pt border
`rgba(253,176,34,0.2)`, `marginHorizontal 14`, bottom margin 10. Row, `gap 14`:

- **Progress ring** — 44×44. Track: 5pt stroke `#253552`. Progress: 5pt stroke `#FDB022`, round
  cap, starting at 12 o'clock, sweeping `min(solvedToday / 10, 1)`. Center label
  **`{solvedToday}`** 15pt bold `#FDB022`. On completion, swap the center label for `✅` and the
  ring color for `#43D97C`.
- **Text column** (`flex 1`): title **"Daily Goal"** 14pt bold `#FFFFFF`; sub-line 12pt `#8BA3C7`
  — **`{solved} of 10 solved today`**, or **"Goal complete — nice work! 🎉"** when done.
- **Streak pill** (only when `goalStreak > 0`): fill `rgba(253,176,34,0.12)`, radius 20,
  `paddingHorizontal 10`, `paddingVertical 5`, 1pt border `rgba(253,176,34,0.3)`, text
  **`🔥 {goalStreak}d`** 12pt bold `#FDB022`.

Animate the ring sweep over **400 ms** when the value changes. Nothing else moves.

---

## PART 16 — Sound & Haptics

Four sounds, bundled as local audio files:

| Key | File | When |
|---|---|---|
| `gameStart` | `game-start.mp3` | every puzzle mount (including Turbo's rapid-fire mounts) |
| `move` | `move.mp3` | any non-capture move, user or opponent |
| `capture` | `capture.mp3` | any capture or en-passant |
| `gameOver` | `game-over.mp3` | rated solve · daily solve · streak failure · Turbo run end |

Selection rule: a move plays `capture` when its flags include capture or en-passant, otherwise
`move`. **The puzzle modes deliberately do not use `check.mp3` or `castling.mp3`**, even though
those files exist and the Analysis Board uses them. If you want the richer 5-way ladder
(gameOver → check → castling → capture → move), apply it consistently across all five modes — do
not do it in only one.

Load all four once at screen appear, play with a restart-from-zero call, release on disappear.

**Haptics: exactly one.** A light impact when a drag successfully picks up a piece. Nothing on
correct, wrong, solve, game over, or button presses. Resist the urge to add more — a rush run
would buzz thirty times a minute.

**Notable gap in the original, your call:** a wrong answer plays no sound at all (the rejected
move's own move-sound fires before the undo). A short, distinct error tone would help, especially
in Turbo where the red ✕ is only on screen for 500 ms.

---

## PART 17 — Master Timing Table

| Behavior | Value |
|---|---|
| Opponent setup/reply move — Play, Thematic, Streak | **500 ms** |
| Opponent setup/reply move — Daily Puzzle | **400 ms** |
| Opponent setup/reply move — Puzzle Turbo | **300 ms** |
| Turbo: next puzzle after a correct solve | **500 ms** |
| Turbo: next puzzle after a mistake | **500 ms** |
| Turbo: ✓/✕ feedback dot lifetime | **500 ms** |
| Daily: wrong-answer banner lifetime | **1300 ms** |
| Rated timer tick / Turbo clock tick | **1000 ms** |
| Daily-goal ring animation | **400 ms** |
| Draft time-to-live (rated draft, infinite draft) | **24 hours** |
| Turbo timed modes | 3 min = **180 s**, 5 min = **300 s** |

Every network timeout from the original (8000 ms puzzle fetch, 8000 ms submit, 10000 ms analyze)
is **deleted** — there is nothing to time out.

---

## PART 18 — Engine Panel (solution hints)

Play Puzzles and Thematic show engine suggestions after a solve or a solution reveal. Offline
this runs on the **embedded Stockfish actor** from the Analysis Board, not on a server.

Search limits: **depth ceiling 20, 1000 ms, MultiPV 3** — the same interactive profile as the
Analysis Board. Cancel any in-flight search when the position changes.

**Arrow overlay** — top 3 moves, drawn over the board:
```
strokeWidth = squareSize * 0.18
headSize    = squareSize * 0.35
shaft shortened at the destination by headSize * 0.7
head half-width = headSize * 0.6
colors = [ rgba(76,175,80,0.85), rgba(68,138,255,0.80), rgba(255,152,0,0.80) ]
```
Straight lines with round caps (knight moves are diagonals, not L-shapes). The overlay must be
**left-aligned to match the board** — in the original the board sits at x = 0 while the overlay
is centered, so they disagree by up to ~3.5 px.

**Engine panel** — fill `#1A2942`, radius 12, padding 8 (Play) or 12 (Thematic), 1pt border
`rgba(253,176,34,0.2)`:
- Header row, `justifyContent spaceBetween`, bottom margin 6: title `#FDB022` weight 700 13pt —
  **"⏳ Analyzing..."** while searching, **"💡 Engine Suggestions"** when settled; refresh glyph
  **"↻"** 18pt `#8BA3C7`
- Line rows — `paddingVertical 3` (Play) / 5 (Thematic), `gap 8`, 1pt bottom border
  `rgba(255,255,255,0.05)`:
  - dot `●` 10pt, `width 12`, colored by index
  - SAN `#FFFFFF` weight 700 13pt, `width 48`
  - eval `#90CAF9` 12pt, `width 44`
  - PV `#8BA3C7` 11pt, `flex 1`, single line — **`pv[1..<6]` joined by spaces** (the first move is
    omitted; it is already in the SAN column)
- Play Puzzles shows the **top 2** lines; Thematic shows up to **3**

> **The `↻` refresh button is a no-op in the original** — it clears the analysis and then the
> stale-FEN guard cancels the re-request, so the panel empties and never refills. Make it
> genuinely re-run the search (or delete the button).

---

## PART 19 — String Catalog

Every user-facing string, so nothing gets paraphrased in translation.

**Hub:** `Puzzle Hub` · `Choose Your Mode!` · `Train your tactics your way 💪` · the 5 card
titles/subtitles/badges from Part 9.2 · `Daily Goal` · `{n} of 10 solved today` ·
`Goal complete — nice work! 🎉`

**Play Puzzles:** `Play Puzzles` · `♟️ RATED` · `Rated Puzzle Mode` ·
`Solve puzzles · Earn ELO · Climb the ranks` · `⭐`/`ELO` · `🧩`/`Rated` · `📈`/`Track` ·
`Correct solve = +ELO · Wrong move = −ELO · Rating range: ±100` · `📤 Share My Rating` ·
`♟️ Play Puzzles` · `Loading puzzle...` · `♙ White to Move` · `♟ Black to Move` · `✅ Solved!` ·
`❌ Wrong move!` · `💡 Viewing Solution` · `Your Rating` · `⏱` · `Puzzle` · `--:--` · `Solution` ·
`Next Puzzle →` · `🔄 Retry` · `💡 Solution` · `⏳ Analyzing...` · `💡 Engine Suggestions` · `↻` ·
`💾 Save Puzzle` · `✅ Saved to Analysis Board` · `Choose Promotion` ·
`Queen`/`Rook`/`Bishop`/`Knight` · `Name` · `Puzzle name...` · `Notes (optional)` ·
`Themes, rating, notes...` · `Cancel` · `Save` · `Puzzle #{id}` · `Rating: {n}` ·
`Themes: {list}` · `Opening: {list}` · new stats strings: `Current Rating`, `Best`, `Accuracy`,
`{solved} of {attempted} solved`, `Activity — Last 7 Days`, `Theme Performance`

**Daily:** `Daily Puzzle` · `Today's Challenge` · `A new puzzle every day — always offline` ·
`🔥`/`Day Streak` · `📅`/`Total Solved` · `How it works` · `Solve today's puzzle to keep your
streak alive. Miss a day and it resets to zero. Come back every day to build your longest
streak!` · `🧩 Solve Today's Puzzle` · `✅`/`Puzzle Solved!` ·
`Come back tomorrow — today's puzzle is already solved.` · `Loading today's puzzle...` ·
`🏆 Puzzle Solved! Streak updated!` · `✗ Not the right move — try again!` · `White ♙ to move` ·
`Black ♟ to move` · `← Back to Daily Puzzle` · `Already Solved!`

**Thematic:** `Thematic Puzzles` · `🎯 THEMED TRAINING` · `Choose a Theme` · the 12 labels ·
`Select a Theme` · `Start {label} Puzzles` · `Loading puzzle...` · `Solved: {n}` ·
`Puzzle Rating` · `♙ You play White — Find the best move!` ·
`♟ You play Black — Find the best move!` · `✅ Puzzle Solved!` · `❌ Wrong move!` · `🔄 Retry` ·
`💡 Solution` · `Next Puzzle →` · `All puzzles solved for this theme!`

**Streak:** `Puzzle Streak` · `🔥 STREAK` · `Current Streak` · `One mistake ends it!` ·
`🏆`/`Best` · `🔥`/`Current` · `♟`/`∞`/`No Timer` · `🔥 Recent Runs` ·
`No runs yet — start your first streak! 🔥` · `📤 Share` · `🔥 Start Streak` ·
`🔥 Resume / New Streak` · `Resume Session?` ·
`You have an unfinished streak (🔥 {n} solved). Continue where you left off or start fresh?` ·
`New Game` · `Continue` · `Loading puzzle...` · `Streak` · `Best` · `Game Over` · `Best: {n}` ·
`🏆 NEW BEST!` · `💡 Show Solution` · `📤 Share Result` · `🔄 Play Again` · `← Back to Menu` ·
`Correct move:` · `Menu` · `Share` · `Play Again`

**Turbo:** `Puzzle Turbo` · `⚡ RUSH` · `Solve as many puzzles as you can!` ·
`3 mistakes = game over` · `SELECT MODE` · `∞ Infinite` · `3 min` · `5 min` · `Best: {n}` ·
`🏆 {mode} Runs` · `No runs yet — be the first! ⚡` · `📤 Share` · `⚡ Start Rush (Infinite)` ·
`⚡ Start Rush ({n} min)` · `Resume Session?` ·
`You have a previous session (Score: {n}, Mistakes: {m}/3). Resume or start fresh?` ·
`New Session` · `Resume` · `Loading puzzles...` · `Quit` · `Score` · `Mode` ·
`♙ White to move` · `♟ Black to move` · `New Best Score!` · `Time's Up!` · `Out of Lives!` ·
`Run Ended` · `Puzzles Solved` · `❌ {n} mistake(s)` · `∞ Infinite mode` · `⏱️ {n} min mode` ·
`📤 Share Result` · `← Back to Puzzle Turbo` · `Quit Puzzle Turbo?` ·
`Your current run will be lost.` · `Keep Playing`

**Deleted entirely:** every "Upgrade to Premium" string, every daily-limit string
(`Daily Puzzle Limit Reached`, `Daily Streak Limit Reached`, `Daily Rush Limit Reached`,
`🔄 Free limits reset daily at midnight`, `1 attempt used today · Resets at midnight`,
`1/1 tries used today for this mode · Resets at midnight`, `🔒 Upgrade for More Attempts`,
`🔒 Upgrade for More Tries`, `👑 Upgrade to Access Thematic Puzzles`, `Premium Feature`,
`Maybe Later`, `Upgrade to Premium — ₱99`), every network error
(`Session expired. Please login again.`, `No internet connection and no cached puzzles
available. Please connect and try again.`, `Error loading puzzle. Please try again.`,
`Connection Error`, `Could not connect to the server.`, `📵 Offline Mode`,
`Failed to save puzzle. Check your connection.`), every leaderboard string
(`🏆 Rating Leaderboard`, `🏆 Streak Leaderboard`, `{n} players`, `1st`/`2nd`/`3rd`,
`No ranked players yet — be the first! ♟️`, `No entries yet — be the first! 🔥`,
`No scores yet — be the first! ⚡`), and `Powered by Chess.com ♟`.

---

## PART 20 — Deliberate Fixes

Bugs found in the original. Each is a decision, not an accident — implement the fix.

| # | Bug | Fix |
|---|---|---|
| 1 | All date math used `toISOString()` → UTC, so daily rollover happened at 8 a.m. in Manila while the UI said "midnight" | Use `Calendar.current.startOfDay(for:)` everywhere |
| 2 | Rated retry never restarted the clock and never reset the start time — a post-retry solve reported cumulative time | Restart the clock on retry |
| 3 | Rated retry skipped the game-start sound | Play it |
| 4 | The `↻` engine-refresh button clears the panel and never refills it (stale-FEN guard) | Make it re-run, or delete it |
| 5 | Backgrounding a *timed* Turbo run finished it without saving the best score, writing history, or playing the sound | Route every ending through one `endGame()` |
| 6 | Turbo results always say "Time's Up!", even on 3 mistakes or in Infinite mode | Use the real end reason |
| 7 | Exhausting one narrow query wiped the **entire** seen-puzzle set for every mode | Scope the Tier-3 wipe to the current filter |
| 8 | Streak's `isNewBest` state is computed and never read; the badge uses a separate inline expression | One source of truth |
| 9 | The rating-history query took the **oldest** 30 rows (`orderBy asc, take 30`) instead of the newest | Take the newest 30 |
| 10 | The server's `compareMoves` fallback compared the user's move against `moves[0]` — the *opponent's* move | Validate the full line (Part 5.4); never port that comparator |
| 11 | Rated info-strip states are independent booleans, so "✅ Solved!" and "💡 Viewing Solution" can render together in a 34pt strip | Single enum |
| 12 | Turbo's arrow overlay is centered while the board is left-aligned | Align both to x = 0 |
| 13 | Quitting a Turbo run discarded the score entirely | Save the run to history before leaving |
| 14 | The board's memoization comparator ignores the tap closure, so a square can hold a stale handler | Bind handlers to identity, not closure capture |
| 15 | Themes were stored as an unindexed JSON blob — every thematic query scanned 550k rows | Join table + `(theme, rating)` index (Part 3.2) |

---

## PART 21 — Explicitly Removed (and why)

| Removed | Reason |
|---|---|
| All four leaderboards (rating, streak, rush ×3 modes) | Require other users and a server. Replaced by personal stats and run history. |
| Avatars, podium rows, rank rows, the `✈️` premium suffix | Leaderboard-only UI |
| Premium gate on Thematic + all `UpgradePrompt` modals | One-time purchase unlocks everything |
| Daily limits (5 rated/day, 1 streak/day, 1 rush/day per mode) and `user_daily_puzzle_limits` | Same |
| `@usage_limits`, `@is_premium`, `syncPremiumFromServer` | Same |
| `Chess.com` daily-puzzle API | Replaced by the deterministic local pool (Part 11.1) |
| `@offline_puzzle_cache`, `@pending_puzzle_submits`, `drainPendingSubmits`, the 20-deep and 12-deep prefetch buffers | The whole corpus is local; there is nothing to cache or queue |
| Share **URLs** (`/share/rating`, `/share/streak`, `/share/rush`) | Hosted endpoints. Keep the share text; drop the URL or point at the App Store listing. |
| Accounts, bearer tokens, 401 handling, device-session locking | Single-user device |
| Every network timeout, abort controller, and connection-error alert | Unreachable offline |
| `📵 Offline Mode` badge | Offline is the only mode |
| `solve_time` transmission | It was validated server-side and then thrown away. Keep it **locally** — it drives the rated timer and is worth storing. |

**Kept but re-sourced:** puzzles (HTTP → bundled SQLite), engine hints (HTTP proxy → embedded
Stockfish), rating (server Elo → identical local Elo), streak/rush difficulty ramps (server/client
mix → all local), Save Puzzle (HTTP POST → SwiftData `AnalysisSession`).

---

## PART 22 — Acceptance Criteria

1. **Airplane Mode is indistinguishable from normal operation.** All five modes, the stats
   screens, the engine hints, and the daily puzzle all work with the radio off, forever.
2. There is not a single `URLSession`, `URLRequest`, or hostname anywhere in the feature.
3. Opening a puzzle takes under 100 ms from tap to board — no spinner is visible in practice.
4. `moves[0]` is always auto-played by the app, never expected from the user, and the board is
   flipped so the solver's pieces are at the bottom in every mode.
5. A move that delivers checkmate is accepted as correct in all five modes, even when it differs
   from the stored line.
6. Puzzle Streak returns the **identical** puzzle after leaving and re-entering the screen, until
   it is solved or failed.
7. Streak difficulty follows the specified curve exactly: 10 warmup mate-in-1s at 600, then a
   jump to ~1100, then +50 per solve to a 2500 ceiling.
8. Puzzle Turbo: 3 mistakes ends the run in every mode; the clock only runs in timed modes; the
   wrong-move piece stays on the board with a red ✕ for 500 ms; backgrounding and returning never
   loses a recorded run.
9. Rated Elo matches the K=32 formula to the integer, moves on wrong answers, floors at 400, and
   never changes on a replayed puzzle.
10. The daily puzzle is the same on a given calendar date across reinstalls, rolls over at local
    midnight, and the day-streak survives exactly one missed day boundary before resetting.
11. Playing 200 puzzles in one mode never repeats a puzzle, and exhausting one theme does not
    reset non-repetition for the other modes.
12. The bundled DB adds 25–35 MB to the app and opens in under 50 ms.

---

## PART 23 — Build Order

1. **The build script and the bundled DB** (Part 3) — everything else depends on the corpus
   existing. Verify the per-band and per-theme counts before writing any UI.
2. `PuzzleStore` actor + the four selectors + the seen-set logic (Part 7), with unit tests for the
   three-tier fallback and the scoped wipe.
3. The `PuzzleSession` core: move convention, validation, promotion, checkmate short-circuit
   (Part 5) — **with unit tests** against real puzzles from the bundle.
4. The board view (Part 6) — reuse the Analysis Board's component if it is already built.
5. SwiftData models + first-launch seeding (Part 4).
6. Elo service (Part 8).
7. **Play Puzzles solver** — the richest screen; getting it right makes the other four fall out.
8. Play Puzzles Home with the stats cards.
9. Puzzle Hub + the daily-goal strip (Parts 9, 15).
10. Daily Puzzle (Part 11) — home, deterministic selection, solver, streak rules.
11. Thematic (Part 12) — grid + solver.
12. Puzzle Streak (Part 13) — home, pending lock, ramp, result overlay, solution strip.
13. Puzzle Turbo (Part 14) — mode select, clock, lives, feedback dot, draft/resume, results.
14. Engine panel + arrows (Part 18), wired to the existing Stockfish actor.
15. Sounds, haptics, and a final pass over the Part 17 timing table.

---

# Verification

There is no code to run — this deliverable is the prompt document above. To verify it before
using it:

1. **Cross-check the numbers** against their sources:
   `BYAHERONG-COACH-FRONTEND\app\(app)\user\play-puzzle\{index,leaderboard}.tsx`,
   `…\puzzle-streak\{index,puzzle}.tsx`, `…\puzzle-rush\{index,rush-game}.tsx`,
   `…\thematic\{index,puzzle}.tsx`, `…\daily-puzzle\{index,puzzle}.tsx`,
   `…\puzzle-hub\index.tsx`, `components\DragDropChessBoard.tsx`,
   `BYAHERONG-COACH-LARAVEL\app\Http\Controllers\{Puzzle,Streak,PuzzleRush,DailyGoal}Controller.php`,
   `app\Traits\ChecksDailyLimits.php`.
2. **Confirm the corpus facts** before running the build script:
   `database\seeders\data\byahero_puzzle.csv` should be 550,001 lines with the header
   `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags`,
   and every row's `Moves` field should contain an even number of space-separated UCI moves.
3. **Confirm the "no daily-goal UI" finding** — grep the frontend for
   `daily-goal|dailyGoal|daily_goal`; the only hit should be the documentation line in
   `BYAHERONG-COACH-FRONTEND\CLAUDE.md`. Part 15 is therefore new design, not a port.
4. When the Swift build exists, the real end-to-end test is **Acceptance Criterion 1**: enable
   Airplane Mode and exercise all five modes in Part 22.


---
---
---

# BOOK TWO — Pairing Manager · Play vs Coach · Opening Trainer · Tutorial Videos

# Context

Same rebuild, next four modules, requested as **one document split by phase**:

| Module | Connectivity | Gate |
|---|---|---|
| **Pairing Manager** (tournaments) | 100% offline | one-time purchase |
| **Play vs Coach** | 100% offline | one-time purchase |
| **Opening Trainer** | online (downloads content) | **subscription** |
| **Tutorial Videos** | online (streams) | **subscription** |

Decisions locked with the user before writing:
1. **No app server.** Online content lives as static files in an object store (Cloudflare R2 / S3).
   Entitlement is verified **on-device by StoreKit 2**. No accounts, no login, no API, no
   progress sync. Opening Trainer downloads a repertoire pack once and then trains offline;
   Tutorial Videos stream.
2. **One-time purchase** unlocks every offline module (Puzzle Hub, Analysis Board, Pairing
   Manager, Play vs Coach — all five coaches). A **separate auto-renewing subscription** unlocks
   Opening Trainer + Tutorial Videos.
3. **The Swiss pairing engine is rewritten to proper FIDE Dutch**, not ported. The shipping
   implementation pairs adjacent players in the global ranking rather than top-half-vs-bottom-half
   inside score groups, has no float bookkeeping, silently repeats pairings when it runs out of
   legal opponents, truncates Buchholz to an integer, and alternates round-robin colours on board 1
   only. All of that is fixed here.

Sources of truth: `tournaments/{index,create,[id]}.tsx` (275 + 293 + 1,588),
`TournamentController.php` (931) + 4 models + 2 migrations; `play-coach/{index,play}.tsx`
(499 + **3,082**); `openings/{index,upload}.tsx` + `openings/trainer/[id]/{index,train}.tsx`,
`OpeningTrainerController.php`, `OpeningTrainerService.php`, `PgnImportService.php`,
`ChessEngine.php`, `OpeningRepertoireSeeder.php` (22 openings) + 6 migrations;
`tutorial-videos/{index,play}.tsx` + `TutorialVideoController.php`;
`SubscriptionApiController.php` (26 KB), `utils/billing.ts`, `premium/index.tsx` (39 KB),
`components/UpgradePrompt.tsx`.

---

# PROMPT: Pairing Manager + Play vs Coach + Opening Trainer + Tutorial Videos

*(Biyaherong Chess Coach — native iOS rebuild. Copy from PHASE 0 onward.)*

## PHASE 0 — Architecture, Entitlement, Shared Foundations

### 0.1 The two halves of the app

```
┌─ OFFLINE HALF ─ one-time purchase ────────────────────────────────────┐
│  Puzzle Hub · Analysis Board · Pairing Manager · Play vs Coach        │
│  Zero network. Works in Airplane Mode forever. Bundled assets only.   │
└───────────────────────────────────────────────────────────────────────┘
┌─ ONLINE HALF ─ auto-renewing subscription ────────────────────────────┐
│  Opening Trainer  → downloads a repertoire pack, then trains offline  │
│  Tutorial Videos  → streams from the bucket, optional offline save    │
│  Content = static files on R2/S3. No API. No accounts. No sync.       │
└───────────────────────────────────────────────────────────────────────┘
```

**Rule:** the only `URLSession` calls in the entire app live in `ContentClient` (Phase 4.2) and
`VideoPlayer` (Phase 5.3). If you find yourself writing one anywhere else, you have misunderstood
the requirement.

### 0.2 Entitlement — StoreKit 2, on-device

```swift
@Observable final class Entitlements {
    private(set) var ownsApp = false        // one-time purchase (non-consumable)
    private(set) var isSubscribed = false   // auto-renewing subscription
    private(set) var subscriptionExpiry: Date?
    private(set) var autoRenews = false
    private(set) var lastVerified: Date?
}
```

- Source of truth is `Transaction.currentEntitlements`, iterated at launch, on `Transaction.updates`,
  and on foreground. Nothing is trusted from a cached boolean the way the RN app trusted
  `@is_premium` in AsyncStorage.
- **Offline grace.** `currentEntitlements` is served from the on-device receipt and works without
  network, so a subscriber stays unlocked in Airplane Mode. If the receipt cannot be read at all
  (fresh install, no network), keep the last-known state for **14 days** from `lastVerified`, then
  lock. Never lock a paying user because the radio is off.
- **No server verification, ever.** No receipt POST, no shared secret, no `base_plan_id` in a
  request body. This single change removes four real vulnerabilities from the current backend:
  a client-chosen `base_plan_id` that let a monthly purchase claim a year of premium; a
  `transaction_id` never cross-checked against the receipt; a receipt whose `bundle_id` was never
  validated; and two restore endpoints that reassigned another account's purchase to the caller.
- Delete entirely: `users.is_premium`, `isActivePremium()`, `subscriptions:expire`,
  `subscriptions:verify-google-play`, `subscription_codes` (its redeem route never existed
  anyway), Google Play billing, and the legacy "premium with zero subscription rows = premium
  forever" trust path.

### 0.3 Products

| Kind | Suggested ID | Unlocks |
|---|---|---|
| Non-consumable | `com.biyaherong.chess.fullapp` | Puzzle Hub, Analysis Board, Pairing Manager, Play vs Coach |
| Auto-renewable (monthly) | `com.biyaherong.chess.plus.monthly` | Opening Trainer + Tutorial Videos |
| Auto-renewable (yearly) | `com.biyaherong.chess.plus.yearly` | same, discounted |

Put both subscriptions in **one subscription group** so upgrade/downgrade/crossgrade is handled by
StoreKit. Prices come from `Product.displayPrice` — never hard-code them. The RN app showed
**three different prices in one session** (`₱99` in the upgrade modal, `₱110/₱1,100` Android
fallback, `₱199/₱1,990` iOS fallback); with `displayPrice` that class of bug cannot recur.

### 0.4 Design tokens (shared by all four modules)

```swift
// Surfaces
screenBg     #0F1A2E     card       #1A2942     cardAlt   #253552
cardDeep     #162136     inputBg    #0F1A2E     playBg    #07111F   // Play vs Coach only
divider      #253552     hairline   rgba(255,255,255,0.06)

// Brand
gold         #FDB022     onGold     #0F1A2E
textPrimary  #FFFFFF     textSecondary #8BA3C7  textMuted #5A7090   textDim #3A5070

// Module accents
swissTeal    #00BFA5     roundRobinAmber #FF8F00
shareBlue    #1E88E5     danger     #D32F2F     dangerSoft #F87171
success      #4CAF50     info       #2196F3     purple    #A78BFA

// Coach accents (Play vs Coach — one per persona)
jaden #4CAF50   jade #E91E8C   jude #FF6B35   julie #FF9BC4   pogi #FDB022

// Board (identical to Analysis Board and Puzzle Hub)
classicLight #F0D9B5  classicDark #B58863   // default
greenLight   #EEEED2  greenDark   #769656
blueLight    #BFD4E0  blueDark    #6B8FA8
selectedSq   #F6F669  lastMoveSq  #CDD26A
premoveFrom  rgba(255,193,7,0.35)  premoveTo rgba(255,193,7,0.45)
premoveArrow rgba(255,193,7,0.75)
```

**Typography:** SF Pro throughout (the RN app loads Nunito but never applies it on any of these
screens). Monospace (`.monospaced`) only for: the move strip, PGN/move-sequence previews, and the
video timecodes. Timers and clocks get `.monospacedDigit()`.

### 0.5 Shared components

**AppLogo(size:)** — circle, `cornerRadius = size/2`, 2pt border `#FDB022`, clipped, gold glow
(shadow `#FDB022`, offset `(0,0)`, opacity 0.6, radius 6). Used at 30pt everywhere.

**Standard header** — row, `padding(.horizontal, 16)`, `.vertical(10–12)`, optional 1pt bottom
border `rgba(253,176,34,0.08)`:
`back "←" 22–26pt` in a 40×40 target · title 18–20pt bold `#FFFFFF` · trailing `AppLogo(30)` or a
badge pill or a 40pt spacer to keep the title centred.

**ChessBoardView** — the same component built for the Analysis Board and Puzzle Hub. Geometry:
`boardSize = floor(screenWidthPx / 8) * 8 / scale`, `squareSize = boardSize / 8`,
`pieceSize = squareSize * 0.95`. Square-fill precedence: selected/drag-origin → custom highlight →
last move (from **and** to) → theme colour. Legal-move dot `squareSize * 0.3` fill
`rgba(0,0,0,0.2)`; capture ring `squareSize * 0.85`, stroke `squareSize * 0.08`,
`rgba(0,0,0,0.25)`. Drag: floating piece container `squareSize * 1.4`, glyph `squareSize * 1.3`,
positioned `x - float*0.5`, `y - float*0.82`, shadow black `(0,8)` opacity 0.45 radius 12,
spring in `stiffness 600 / damping 28 / mass 0.6`, out `stiffness 500`; origin piece drops to 0.3
opacity; drop point corrected by `-squareSize * 0.45` on Y then centre-biased within
`squareSize * 0.15` of an edge. One light haptic on successful pick-up — the only haptic in these
four modules.

**Board theme** is a single app-wide preference (`classic` default) shared with the Analysis Board
and Puzzle Hub. Persist it once, read it everywhere.

### 0.6 Persistence

Everything is **SwiftData**, one store, no iCloud sync (single-device by design). Bundled assets
are read-only files in the app bundle. Downloaded content lives in
`Application Support/Content/` and is excluded from iCloud backup
(`URLResourceValues.isExcludedFromBackup = true`).

---

## PHASE 1 — Pairing Manager (100% offline)

Three screens: **Tournament List → Create → Detail (3 tabs)**. Everything the RN app fetched from
`/api/tournaments/*` is now a local SwiftData query. The screen background is `#0F1A2E` throughout.

### 1.1 Data model

```swift
@Model final class Tournament {
    var name: String
    var type: TournamentType          // .swiss | .roundRobin
    var status: TournamentStatus      // .setup | .ongoing | .finished
    var totalRounds: Int = 0
    var currentRound: Int = 0
    var createdAt: Date
    var updatedAt: Date
    @Relationship(deleteRule: .cascade) var players: [TournamentPlayer]
    @Relationship(deleteRule: .cascade) var rounds: [TournamentRound]
}

@Model final class TournamentPlayer {
    var name: String                  // required, max 255
    var fullName: String?
    var rating: Int?                  // "NCFP rating", 0…3000
    var dateOfBirth: Date?
    var fideId: String?               // schema-only in the RN app — surface it or drop it
    var federation: String?           // same
    var seed: Int                     // 1-based, STABLE — see fix #1
    var score: Double = 0             // Double, not decimal-as-string
    var buchholz: Double = 0          // Double, not truncated Int — see fix #2
    var sonnebornBerger: Double = 0
    var directEncounter: Double = 0
    var wins = 0, draws = 0, losses = 0, byes = 0
    var whiteGames = 0, blackGames = 0
    var colorHistory: [PieceColor?] = []   // NEW — index = round-1, nil = bye. Required by Dutch.
    var floatHistory: [Float3] = []        // NEW — .up/.down/.none per round. Required by Dutch.
    var opponentIds: [UUID] = []           // NEW — denormalised, O(1) "have they met?"
}

@Model final class TournamentRound {
    var roundNumber: Int
    var status: RoundStatus           // .pending | .ongoing | .completed
    @Relationship(deleteRule: .cascade) var pairings: [TournamentPairing]
}

@Model final class TournamentPairing {
    var boardNumber: Int
    var whitePlayerId: UUID?
    var blackPlayerId: UUID?
    var result: PairingResult         // .pending | .whiteWin | .blackWin | .draw | .bye
    var isBye: Bool = false
}
```

Four changes from the server schema, all load-bearing:
- **`colorHistory` and `floatHistory` are new.** Proper Dutch pairing cannot be implemented from
  `whiteGames`/`blackGames` counters alone — it needs to know the colour of the *last* game and
  whether a player floated down recently.
- **`opponentIds` is new**, so "have these two met?" is a set lookup instead of re-scanning every
  pairing in the tournament.
- **`buchholz`/`sonnebornBerger` are `Double`.** The server stored them in integer columns, so a
  Buchholz of 7.5 was written as 8 and tie-breaks silently collided.
- **`score` is `Double`.** The server cast it `decimal:1`, so the API returned the string `"1.0"`
  while the TypeScript interface declared `number` — which is why the plain-text standings share
  printed `1.0.0` for every whole-number score.

**Limits:** none. The one-time purchase removes the 10-player / 3-round free cap, the
`Player limit reached (10)…` error, the `🔒 Free Plan: max 10 players • max 3 rounds` banner, and
the `Upgrade ›` link. Premium was capped at 999 players anyway, despite the message saying
"unlimited".

### 1.2 Screen — Tournament List

**Header** (`h 16 / v 12`, 1pt bottom border `rgba(253,176,34,0.08)`): back `←` 22pt `#FDB022` in
a 40×40 target · centre column: **"Tournaments"** 18pt weight 800 `#FFFFFF` letter-spacing 0.5,
under it **"Swiss & Round Robin Manager"** 11pt `#8BA3C7` top margin 2 letter-spacing 0.3 ·
`AppLogo(30)`.

**Empty state** (centred, bottom padding 80): glyph **♞** 64pt `#253552` bottom margin 12 ·
**"No Tournaments Yet"** 18pt weight 700 `#5BA3F5` bottom margin 4 ·
**"Create your first chess tournament"** 13pt `#8BA3C7`.

**List** (`h 14`, top 10, bottom 90). Card: fill `#1A2942`, radius 14, padding 14, bottom margin 10,
1pt border `rgba(91,163,245,0.08)`, press opacity 0.85.
- Header row (bottom margin 8, gap 6): type badge — `h 8 / v 3`, radius 6, 1pt border, fill =
  `typeColor + 13% alpha`, border = typeColor, text 10pt weight 800 letter-spacing 1 in typeColor:
  **`SWISS`** (`#00BFA5`) or **`ROUND ROBIN`** (`#FF8F00`). Then a 7×7 status dot (radius 4,
  margins left 4 / right 2) and the status word uppercased 10pt weight 700 letter-spacing 0.5 —
  `SETUP` `#FDB022`, `ONGOING` `#00BFA5`, `FINISHED` `#8BA3C7`. Chevron `›` 20pt `#5A7090` pushed
  right.
- Name 16pt weight 700 `#FFFFFF`, bottom margin 10, one line.
- Stats strip: fill `#0F1A2E`, radius 10, `v 8 / h 4`, three equal cells split by two 1×24
  dividers `#253552`. Values 14pt weight 800 `#FDB022`; labels 10pt `#8BA3C7` weight 500 top
  margin 2. Cells: `{players.count}` / **"Players"** · `{currentRound}/{totalRounds}` /
  **"Rounds"** · date / **"Created"**.
- Footer hint when the list is non-empty: **"Long press a card to delete"** 11pt `#3A5070`
  italic centred bottom padding 8.

> **Date fix.** The RN app rendered `created_at` (a UTC ISO string) through
> `toLocaleDateString('en-PH', …)`, so a tournament created at 06:00 Manila time displayed the
> previous day. Store and format `createdAt` with `Calendar.current` — `.dateTime.month(.abbreviated).day()`.

**FAB** — pinned, `leading/trailing 14`, `bottom = safeArea + 16`, fill `#FDB022`, radius 14,
`v 14`, row centred gap 8, shadow `#FDB022` `(0,4)` opacity 0.35 radius 8: **`+`** 22pt weight 800
`#0F1A2E` + **"New Tournament"** 15pt weight 800 `#0F1A2E` letter-spacing 0.5.

**Long-press delete** — confirmation dialog, title **"Delete Tournament"**, body
**`Delete "{name}"? This cannot be undone.`**, buttons **"Cancel"** / **"Delete"** (destructive).
Unlike the RN version, only remove the row *after* the delete succeeds.

### 1.3 Screen — Create Tournament

Header: back `←` · **"New Tournament"** 18pt weight 800 centred · `AppLogo(30)`. Body padding 16.
Section labels: 12pt weight 700 `#8BA3C7` letter-spacing 1 **uppercase**, bottom margin 8.

1. **"Tournament Name"** → text field, fill `#1A2942`, radius 12, `h 14 / v 13`, 16pt `#FFFFFF`,
   1pt border `rgba(91,163,245,0.12)`, placeholder **`e.g. Manila Open 2026`** in `#5A7090`,
   max 100 chars, focused on appear.
2. **"Tournament Format"** (top margin 20) → two cards in a row, gap 10, each `flex 1`, fill
   `#1A2942`, radius 14, padding 14, **2pt border** transparent → `#00BFA5` (Swiss selected, fill
   `rgba(0,191,165,0.06)`) or `#FF8F00` (Round Robin selected, fill `rgba(255,143,0,0.06)`).
   Icon square 36×36 radius 10 bottom margin 10, fill = accent when selected else `#253552`,
   glyph **`S`** / **`R`** 18pt weight 900 `#FFFFFF`. Name 15pt weight 800 (`#8BA3C7` inactive →
   accent active) bottom margin 4. Description 11pt `#5A7090` line-height 15:
   - Swiss: **"Best for large events. Players face opponents with similar scores."**
   - Round Robin: **"Everyone plays everyone. Best for smaller groups."**
3. **Swiss only — "Number of Rounds"** (top margin 20): row gap 8 of four 44×44 presets
   `3 / 5 / 7 / 9` (radius 12, fill `#1A2942`, 1pt border `rgba(91,163,245,0.1)`; selected → fill
   and border `#00BFA5`; text 16pt weight 800 `#8BA3C7` → `#FFFFFF`) plus a free-entry numeric
   field (`flex 1`, same chrome, centred, max 2 digits, placeholder **`#`**).
   Replace the old hint **"Free: max 3 rounds. Premium: unlimited."** with a live recommendation:
   **`Recommended for {n} players: {ceil(log2(n))} rounds`**, computed as soon as the count is
   known — the standard Swiss guidance, and far more useful than a limit notice.
4. **Round Robin only** — note box, top margin 20, fill `rgba(255,143,0,0.08)`, radius 12,
   padding 14, 1pt border `rgba(255,143,0,0.2)`, text 12pt `#FF8F00` line-height 18:
   **"Rounds are automatically determined by the number of players. Add players after creating the tournament."**

**Footer** (`h 16`, top 12, 1pt top border `rgba(91,163,245,0.08)`, bottom = safeArea + 16):
button fill `#FDB022`, radius 14, `v 15`, shadow `#FDB022` `(0,3)` 0.3/6, disabled → opacity 0.6;
label **"Create Tournament"** 16pt weight 800 `#0F1A2E` letter-spacing 0.5.

Validation: empty name → alert **"Required"** / **"Enter a tournament name"**. Rounds default to 3
when blank; clamp to `1…30`. (The RN screen turned a typed `0` into 3 silently and let `99`
through to a server 422.)

### 1.4 Screen — Tournament Detail

**Header** (`h 16 / v 10`, 1pt bottom border `rgba(253,176,34,0.08)`): back `←` · centre column
with the name 16pt weight 800 one line and a meta row (gap 8, top margin 3) containing the type
badge (`h 6 / v 2`, radius 4, 1pt border in typeColor, text 9pt weight 800 letter-spacing 0.8) and
**`R{current}/{total}`** 11pt weight 700 `#8BA3C7` · `AppLogo(30)`.

**Tabs** (`h 14`, top 10, bottom 6, gap 4): three equal buttons, `v 8`, radius 10, fill `#1A2942`;
selected fill `#FDB022`. Text 12pt weight 700 `#8BA3C7` → `#0F1A2E`. Labels
**`Players ({n})`** · **`Rounds`** · **`Standings`**. Default tab: Players.
Shared body padding: `h 14`, top 8, bottom 100.

#### Tab A — Players
Row: fill `#1A2942`, radius 10, padding 10, bottom margin 6.
- Seed chip 28×28 radius 8 fill `#253552` right margin 10, text 12pt weight 800 `#8BA3C7`.
  **Show `player.seed`, not the row index.** The RN app printed the display position of a
  score-sorted list, so the numbers shown were never the seeds the round-robin schedule actually
  used.
- Info column: name 14pt weight 700 `#FFFFFF`; if rated, **`NCFP {rating}`** 11pt weight 600
  `#FDB022` top margin 1.
- Trailing: in `.setup`, a 28×28 remove button (radius 14, fill `rgba(211,47,47,0.15)`, glyph
  **`×`** 14pt weight 700 `#D32F2F`); otherwise the score 16pt weight 800 `#FDB022`, formatted
  `1`, `1½`, `½` — chess notation, not `1.0`/`0.5`.
- Empty: **"No players yet. Add players to get started."** 13pt `#5A7090` centred, vertical
  padding 40.

Footer (only in `.setup`; row, `h 14`, top 10, bottom 16, gap 8, 1pt top border
`rgba(91,163,245,0.08)`): **"Bulk Add"** (`flex 1`, radius 12, `v 13`, clear fill, 1.5pt border
`#FDB022`, text 14pt weight 800 `#FDB022`) and **"+ Add Player"** (`flex 1`, radius 12, `v 13`,
fill `#FDB022`, text 14pt weight 800 `#0F1A2E`).

Remove confirmation: **"Remove Player"** / **`Remove {name}?`** / **"Cancel"** · **"Remove"**
(destructive). Blocked outside `.setup` — and unlike the RN app, say so instead of silently
refetching.

#### Tab B — Rounds
1. **Round selector** — horizontal scroll, `maxHeight 44`, margins 4/4, content `h 14`, gap 6.
   Chip `h 16 / v 8`, radius 10, fill `#1A2942`; selected fill `#FDB022`; completed rounds add a
   1pt border `rgba(0,191,165,0.3)` and a 6×6 dot radius 3 `#00BFA5`. Text **`R{n}`** 13pt
   weight 800 `#8BA3C7` → `#0F1A2E`. Trailing **"Share"** button `h 14 / v 8`, radius 10, fill
   `#1E88E5`, text 13pt weight 800 `#FFFFFF`.
2. **Pairing rows**, ordered by board number. Card fill `#1A2942`, radius 12, padding 12, bottom
   margin 6, row. Tappable only when not a bye and the tournament is not finished.
   - Board chip 28×28 radius 8 fill `#253552` right margin 10, 12pt weight 800 `#8BA3C7`.
   - Bye row: one italic line 13pt weight 600 `#8BA3C7`: **`{name} — BYE (1 pt)`**.
   - Normal row: left group (`flex 1`, gap 6) = white dot 10×10 radius 5 `#FAFAFA`, name
     (`flex 1`, 13pt weight 600 `#FFFFFF`; winner → `#FDB022` weight 800), score 12pt weight 800
     `#FDB022` min-width 20. Centre badge `h 10 / v 4`, radius 8, margins 6, min-width 44 —
     pending: fill `#253552` text `#5A7090` **`vs`**; decided: fill `rgba(253,176,34,0.12)` text
     `#FDB022` **`1-0`** / **`0-1`** / **`½-½`**. Right group mirrors the left, name right-aligned,
     black dot 10×10 fill `#1A2942` with a 1pt `#5A7090` border.
     *(Render the badge from an exhaustive switch. The RN code fell through to `½-½` for any
     unrecognised value, so a corrupt result silently displayed as a draw.)*
   - No round yet: **"Add at least 2 players first"** (< 2 players) or
     **"Generate pairings to start the round"**.
3. **Generate button** (`h 14`, top 10, bottom 16, 1pt top border): fill `#00BFA5`, radius 12,
   `v 14`, shadow `#00BFA5` `(0,3)` 0.3/6; label 14pt weight 800 `#FFFFFF` letter-spacing 0.3 —
   **`Generate Round {n} Pairings`** (Swiss) or **`Generate Full Schedule`** (Round Robin, shown
   only while `currentRound == 0`). Enabled when: players ≥ 2, `currentRound < totalRounds`, the
   previous round has no pending results, and the tournament is not finished.
4. **Finished banner**: margins `h 14 / bottom 16`, fill `rgba(253,176,34,0.1)`, radius 12,
   `v 14`, 1pt border `rgba(253,176,34,0.2)`, text **"Tournament Complete"** 14pt weight 800
   `#FDB022` letter-spacing 0.5.

#### Tab C — Standings
Header row `v 8 / h 4`, 1pt bottom border `#253552`, bottom margin 4; column labels 10pt weight 700
`#5A7090` letter-spacing 0.5. Columns and widths: **`#`** 28 · **`Player`** flex · **`Pts`** 42 ·
**`W`** 30 · **`D`** 30 · **`L`** 30 · **`Bch`** 36 · **`SB`** 36 (new — the tie-break is
computed and never shown in the RN app).
Rows `v 8 / h 4`, radius 8; even indices get `rgba(26,41,66,0.5)`. Rank chip 28×28 radius 8 fill
`#253552`, 12pt weight 800 `#8BA3C7` — **and rank 1 gets fill `#FDB022` with `#0F1A2E` text.**
(The styles for this exist in the RN file but were never applied, so the share image highlighted
the leader in gold and the in-app table did not.) Name 13pt weight 700; sub-line **`NCFP {r}`**
10pt `#5A7090`. Values 13pt weight 700 `#8BA3C7` centred; **Pts** is `#FDB022` weight 800 and uses
`1½` notation.

**Sort order — one implementation, used by the table, the share image and the share text:**
`score ↓, directEncounter ↓, buchholz ↓, sonnebornBerger ↓, wins ↓, rating ↓, name ↑`.
The RN app had *three different orderings* for the same table (server `/standings` used 5 keys
including direct encounter, the `show()` payload sorted by score+buchholz only, and the client
sorted by 4 keys ignoring direct encounter).

Share button when players exist: fill `#1E88E5`, radius 12, `v 12`, top margin 16, label
**"Share Standings"** 14pt weight 800 `#FFFFFF`.

### 1.5 Modals

**Add Player** — sheet or centred card, scrim `rgba(0,0,0,0.7)`, card fill `#1A2942`, radius 18,
padding 20, 1pt border `rgba(253,176,34,0.1)`. Title **"Add Player"** 18pt weight 800 bottom
margin 4. Field labels 11pt weight 700 `#5A7090` letter-spacing 0.5 uppercase, bottom margin 6,
top margin 12: **"Name *"**, **"Full Name"**, **"NCFP Rating"**. Fields fill `#0F1A2E`, radius 10,
`h 14 / v 12`, 15pt `#FFFFFF`, 1pt border `rgba(91,163,245,0.1)`, placeholders **`Player name`** /
**`Optional`** / **`Optional`** (numeric). Actions row gap 10 top margin 20: **"Cancel"**
(`flex 1`, `v 13`, radius 12, 1.5pt border `#5A7090`, 14pt weight 700 `#8BA3C7`) and **"Add"**
(`flex 1`, fill `#FDB022`, 14pt weight 800 `#0F1A2E`).

**Bulk Add** — same chrome. Title **"Bulk Add Players"**; sub **"One player per line. Add rating
after name (optional)."** 12pt `#8BA3C7` bottom margin 16. Text editor height 160, top-aligned,
placeholder:
```
Juan Dela Cruz
Maria Santos 1500
Pedro Reyes 1200
```
Parse rule (port exactly): trim; split on whitespace; if there are ≥ 2 tokens and the last token is
an integer in `0…3000` **whose string form round-trips** (so `007`, `15.5`, `1500abc` are rejected),
treat it as the rating and join the rest as the name; otherwise the whole line is the name.
Confirm label is live: **`Add {n} Players`**.

**Enter Result** — scrim `rgba(0,0,0,0.7)`, card as above. Title **"Enter Result"**, sub
**`Board {n}`**. Players row (gap 12, bottom margin 20): white name right-aligned `flex 1` 15pt
weight 700, **`vs`** 12pt weight 600 `#5A7090`, black name left-aligned `flex 1`.
Three buttons, gap 8, each radius 12 `v 14` centred:
| Fill | Main | Sub |
|---|---|---|
| `#FAFAFA` | **`1 - 0`** 18pt weight 900 `#0F1A2E` | **"White Wins"** 11pt weight 600 `#5A7090` |
| `#253552` | **`½ - ½`** 18pt weight 900 `#FFFFFF` | **"Draw"** 11pt weight 600 `#8BA3C7` |
| `#1A1A2E` | **`0 - 1`** 18pt weight 900 `#FFFFFF` | **"Black Wins"** 11pt weight 600 `#8BA3C7` |
Then **"Cancel"** text button, top margin 12, `v 12`, 14pt weight 700 `#5A7090`.
**Add a fourth option the RN app lacks: "Clear Result"** (only shown when a result already exists)
— reverses the score/colour counters and returns the pairing to `.pending`.

### 1.6 Share cards

Rendered off-screen with `ImageRenderer` at `displayScale`, width **360**, fill `#0F1A2E`,
radius 16, padding 20, then presented in a share sheet as PNG.
- Header row gap 10 bottom margin 10: logo image 32×32 radius 16 2pt border `#FDB022`; brand
  **"BIYAHERONG CHESS COACH"** 13pt weight 800 `#FFFFFF` letter-spacing 1.
- Gold rule height 2 `#FDB022` radius 1 bottom margin 14.
- Title 16pt weight 800 bottom margin 4, ≤ 2 lines: `{name}` or **`{name} — Standings`**.
- Subtitle 12pt weight 600 `#8BA3C7` bottom margin 14: **`Round {n} of {total} • Swiss`** /
  **`• Round Robin`**.
- Body rows as in the on-screen tables at 90 % scale (board chip 24×24, dots 8×8, badge min-width
  38, standings widths `#`26 / Pts 36 / W,D,L 26 / Bch 32).
- Footer top margin 14 centred gap 2: **`#BiyaherongChess  #ChessPH`** (two spaces) 10pt weight
  700 `#5A7090` letter-spacing 0.5 and **`biyaherongchesscoach.com`** 10pt weight 600 `#8BA3C7`.

Plain-text fallback (share sheet, no URL — the RN version pasted the ngrok tunnel URL into every
shared message):
```
♟️ Biyaherong Chess Coach
━━━━━━━━━━━━━━━━━━━━━
🏆 {name}
📋 Round {n} of {total} ({Swiss|Round Robin})

Bd 1: {white}  1-0  {black}
Bd 2: {white}  ½-½  {black}
Bd 3: {white}  — BYE

#BiyaherongChess #ChessPH
```
(21 × U+2501 in the rule.) Standings text rows: **`{rank}. {name}  {score}  {w}W {d}D {l}L`** with
the rank right-padded to 2 characters.

### 1.7 The Swiss pairing engine — FIDE Dutch

**This is a rewrite, not a port.** Build it as a pure, dependency-free struct with no SwiftData
imports so it can be unit-tested against published FIDE examples.

```swift
struct PairingEngine {
    static func pairRound(_ players: [PlayerState], round: Int) -> PairingResult
}
struct PlayerState {           // a value snapshot, not the @Model
    let id: UUID, name: String, rating: Int?, seed: Int
    let score: Double
    let opponents: Set<UUID>
    let colors: [PieceColor?]  // index 0 = round 1; nil = bye
    let floats: [Float3]
    let hadBye: Bool
}
struct PairingResult {
    let pairs: [(white: UUID, black: UUID)]
    let bye: UUID?
    let warnings: [PairingWarning]   // surfaced in the UI — never silent
}
```

#### 1.7.1 Colour preference

```
colorDiff(p)  = whites - blacks
lastColor(p)  = last non-nil entry in p.colors

preference(p):
  |colorDiff| >= 2                              -> .absolute(opposite of the majority)
  last two played colors are identical          -> .absolute(opposite of that color)
  colorDiff != 0                                -> .strong(opposite of the majority)
  colorDiff == 0 && lastColor != nil            -> .mild(opposite of lastColor)
  no games played                               -> .none
```

Round 1 has no history, so every player is `.none`; see 1.7.5.

#### 1.7.2 Ordering

Sort once, use everywhere. **This ranking is the pairing order and is not the standings order** —
it deliberately excludes direct encounter:

```
score ↓, rating ↓ (nil == 0, so unrated sink), name ↑, seed ↑
```

Rank number = index + 1. Ties broken by `seed` guarantee determinism: identical input always
produces identical pairings, which matters when an arbiter regenerates a round.

#### 1.7.3 The bye

Assign **before** bracket processing, when the player count is odd.
- Candidates: every player who has **not** had a bye.
- Choose the **lowest-ranked** candidate **in the lowest score bracket**. The RN implementation
  scanned the whole ordered list from the bottom, so a player from a *higher* score group could
  receive the bye once everyone beneath them already had one.
- If every player has had a bye, allow a second one, again lowest-ranked in the lowest bracket,
  and emit `.repeatBye(playerId)`.
- Bye = **1 point**, `byes += 1`, **no colour recorded** (append `nil` to `colorHistory`), and it
  does **not** increment `wins`. Ported deliberately — but note that this makes the `W` column and
  the wins tie-break under-count bye recipients, so say so in a tooltip.
- Bye pairing is written on the **last** board, in every round. The RN app put it on the last
  board in round 1 and on **board 1** from round 2 onward.

#### 1.7.4 Bracket processing

```
brackets = players grouped by score, highest score first
downfloaters = []
for bracket in brackets:
    pool = downfloaters + bracket            // floaters sit at the TOP of the pool
    downfloaters = []
    if pool.count is odd (and this is not the last bracket):
        move one player down -> see 1.7.6
    result = pairBracket(pool)
    if result == nil:                        // no legal pairing exists in this pool
        relax constraints in the order of 1.7.7 and retry
    pairs += result.pairs
    downfloaters = result.unpaired
if downfloaters is non-empty after the last bracket:
    merge them into the last bracket and re-pair the combined pool (the last bracket
    must always be paired completely)
```

`pairBracket(pool)`:
1. Split into **S1 = top half**, **S2 = bottom half** (`S1.count == pool.count / 2`; with an odd
   pool after floating, S1 gets the extra player only in the final bracket).
2. Candidate pairing: `S1[i]` vs `S2[i]` for every `i`.
3. Legal if **no pair has met before** and no pair violates two absolute colour preferences that
   cannot both be satisfied.
4. If illegal, **transpose S2** — enumerate permutations of S2 in lexicographic order of the
   original ranking, taking the first legal one. Cap the search: for `|S2| ≤ 8` enumerate fully;
   above that, use a backtracking search with the constraint "prefer the smallest index change".
5. If no transposition works, **exchange** the lowest player of S1 with the highest of S2 and
   restart from step 2. Try exchanges in increasing order of rank distance.
6. If nothing works, return `nil` and let the caller relax (1.7.7).

For pools of any realistic size (an arbiter tournament is tens, not thousands, of players), an
alternative that is easier to get right and provably optimal: model the bracket as a
**minimum-penalty perfect matching** and solve it by branch-and-bound with the penalties in 1.7.7.
Use S1/S2-plus-transposition for pools ≤ 20 and the matching solver above that; both must satisfy
the same acceptance tests.

#### 1.7.5 Round 1

No history exists, so brackets are meaningless. Rank by rating (unrated last, then by name), split
into halves, and pair `top[i]` vs `bottom[i]`. Colours alternate by board: board 1 gives White to
the top-half player, board 2 gives White to the bottom-half player, and so on — the
`i % 2 == 0` rule from the current app is already correct and should be kept.

> **Fix the trigger.** The RN code took the rated path whenever *any single player* had a rating,
> so a 20-player unrated field with one rated entrant was paired as if fully rated and the bye went
> to an unrated player treated as rating 0. Use the rated path only when **at least half** the
> field is rated; otherwise use the alphabetical fold (`A vs Z, B vs Y`) with the **middle** player
> taking the bye, which the RN app already does correctly.

#### 1.7.6 Choosing a downfloater

From the bottom of the pool upward, pick the first player who:
1. has not floated **down** in the previous round, and
2. has not floated down in the round before that,
3. and, all else equal, has the fewest downfloats overall.

If no candidate satisfies (1), relax to (2), then to "lowest-ranked". Record the choice in
`floatHistory` for that round — this is exactly the bookkeeping the current implementation has
none of, which is why a player there can float down in three consecutive rounds.

#### 1.7.7 Relaxation ladder — and never a silent repeat

When a bracket cannot be paired, relax **in this order**, emitting a warning at each step:

| Step | Relaxation | Warning |
|---|---|---|
| 1 | Allow a mild colour preference to be violated | none (normal) |
| 2 | Allow a strong colour preference to be violated | `.colorPreferenceViolated` |
| 3 | Increase the number of downfloaters by one and retry | none (normal) |
| 4 | Allow an absolute colour preference to be violated | `.absoluteColorViolated` |
| 5 | **Only if the round is otherwise unpairable:** allow one repeat pairing | `.repeatPairing(a,b)` |

Step 5 must be genuinely last, must repeat the *fewest* possible pairs, and must surface in the
UI. The current implementation reaches for a repeat immediately — `if (!bestMatch) bestMatch =
$unpaired[0]` — with no error, no warning, and no indication in the API response.

**Warning banner** (Rounds tab, above the pairing list, when `warnings` is non-empty): margins
`h 14 / bottom 8`, fill `rgba(255,143,0,0.1)`, radius 12, padding 12, 1pt border
`rgba(255,143,0,0.35)`, title **"⚠ Pairing Notes"** 12pt weight 800 `#FF8F00`, then one 11pt
`#FFD9A0` line per warning:
- **`{A} vs {B} — repeat pairing (no legal alternative)`**
- **`{name} — colour preference not met`**
- **`{name} — second bye awarded`**

### 1.8 Round Robin — Berger tables

Rounds: `n` even → `n - 1`; `n` odd → `n` (a dummy makes the odd player's opponent the bye).
Generate the whole schedule in one action while `currentRound == 0`.

Use the **standard Berger table**, not the current single-board alternation. Whatever generation
scheme you implement must satisfy this test, which is the actual requirement:

> After the full schedule is generated, **every player's `|whites − blacks| ≤ 1`**, and no player
> ever has the same colour three rounds in a row.

The shipping code fails this badly: it alternates colours only on board 1
(`$roundNumber % 2 === 0 && $i === 0`), so in an 8-player round robin most players get the same
colour in nearly every game.

Seeds must be **stable and unique**. The RN backend assigned `seed = currentCount + 1` and never
re-seeded on removal, so adding A, B, C then deleting B and adding D produced two players with
seed 3 — and the circle algorithm sorts by seed, so the schedule silently degraded. Assign seeds
as a monotonically increasing counter per tournament and renumber densely whenever a player is
removed during `.setup`.

BYE handling: with an odd count, append a dummy; whichever real player meets it that round gets
`isBye = true`, `whitePlayerId = <player>`, `blackPlayerId = nil`, `result = .bye`, on the last
board, and is awarded the point **at generation time for that round**, not deferred. In the RN
implementation later rounds' bye points were awarded *after* `recalculateTiebreakers` ran, so the
tie-breaks for that update used a stale score.

### 1.9 Scoring and tie-breaks

| Outcome | Score | Counters |
|---|---|---|
| Win | +1 | `wins += 1`, `whiteGames`/`blackGames += 1`, `colorHistory[round] = colour`, `opponentIds += opp` |
| Draw | +0.5 each | `draws += 1`, same colour/opponent updates |
| Loss | +0 | `losses += 1`, same colour/opponent updates |
| Bye | +1 | `byes += 1`, `colorHistory[round] = nil`, **no** `wins`, no opponent |

Editing a result reverses every counter before applying the new one — including
`whiteGames`/`blackGames`, `colorHistory` and `opponentIds`. Add the **"Clear Result"** path
(1.5) using the same reversal.

Recalculate tie-breaks **after every result**, not only when a round completes:

```
Buchholz(p)          = Σ score(opponent) over real games            // byes excluded
BuchholzCut1(p)      = Buchholz − min(opponent scores)              // NEW, standard
SonnebornBerger(p)   = Σ [ score(opp) × (1 for a win, 0.5 for a draw, 0 for a loss) ]
DirectEncounter(p)   = points scored against opponents on the SAME current score
```
All four are `Double`. Round only for display (`1½`, `7½`), never in storage.

> **Critical fix for round robin.** The RN `recalculateTiebreakers` iterated *every* pairing in the
> tournament with no result filter. Because a round robin creates the entire schedule upfront, that
> included **unplayed future rounds**, inflating everyone's Buchholz from round 1. Only count
> pairings whose result is decided.

### 1.10 State machine

`.setup → .ongoing → .finished`. Transitions: creating gives `.setup`; the first successful
pairing generation sets `.ongoing` and `currentRound = nextRound`; entering the final pending
result of the final round sets `.finished`.

| Status | Allowed |
|---|---|
| `.setup` | add / bulk-add / remove / reorder players; generate round 1 |
| `.ongoing` | enter and edit results; generate the next round once the current one is complete |
| `.finished` | view and share; **results are locked** |

The RN backend let results be edited after `finished`, let `total_rounds` be lowered below
`current_round` (stranding the tournament in `ongoing` forever), and never returned `finished` to
`ongoing` when rounds were added. Make status a computed consequence of the data: recompute it
after every mutation instead of storing transitions.

A round is `.completed` when it has no pending pairings — there is no explicit "finalize" action,
and none should be added.

### 1.11 Strings — Pairing Manager

`Tournaments` · `Swiss & Round Robin Manager` · `No Tournaments Yet` ·
`Create your first chess tournament` · `Players` · `Rounds` · `Created` ·
`Long press a card to delete` · `+` · `New Tournament` · `Delete Tournament` ·
`Delete "{name}"? This cannot be undone.` · `Cancel` · `Delete` · `SWISS` · `ROUND ROBIN` ·
`SETUP` · `ONGOING` · `FINISHED` · `Tournament Name` · `e.g. Manila Open 2026` ·
`Tournament Format` · `Swiss` · `Round Robin` ·
`Best for large events. Players face opponents with similar scores.` ·
`Everyone plays everyone. Best for smaller groups.` · `Number of Rounds` ·
`Recommended for {n} players: {r} rounds` ·
`Rounds are automatically determined by the number of players. Add players after creating the tournament.` ·
`Create Tournament` · `Required` · `Enter a tournament name` · `Players ({n})` · `Standings` ·
`No players yet. Add players to get started.` · `NCFP {rating}` · `Bulk Add` · `+ Add Player` ·
`Remove Player` · `Remove {name}?` · `Remove` · `Add Player` · `Name *` · `Full Name` ·
`NCFP Rating` · `Player name` · `Optional` · `Add` · `Bulk Add Players` ·
`One player per line. Add rating after name (optional).` · `Add {n} Players` · `Share` ·
`R{n}` · `{name} — BYE (1 pt)` · `vs` · `1-0` · `0-1` · `½-½` · `Add at least 2 players first` ·
`Generate pairings to start the round` · `Generate Round {n} Pairings` ·
`Generate Full Schedule` · `Tournament Complete` · `#` · `Player` · `Pts` · `W` · `D` · `L` ·
`Bch` · `SB` · `Share Standings` · `No players to display` · `Enter Result` · `Board {n}` ·
`1 - 0` · `White Wins` · `½ - ½` · `Draw` · `0 - 1` · `Black Wins` · `Clear Result` ·
`⚠ Pairing Notes` · `{A} vs {B} — repeat pairing (no legal alternative)` ·
`{name} — colour preference not met` · `{name} — second bye awarded` ·
`BIYAHERONG CHESS COACH` · `{name} — Standings` · `Round {n} of {total} • {type}` ·
`#BiyaherongChess  #ChessPH` · `biyaherongchesscoach.com`

**Deleted:** `🔒 Free Plan: max 10 players • max 3 rounds` · `Upgrade ›` ·
`Player limit reached ({n}). Upgrade to Premium for unlimited players.` · `Player Limit` ·
`Limit Reached` · `Added {n} players. Some were skipped due to free plan limit.` · `Limit` ·
`Free users can create up to {n} rounds. Upgrade to Premium for more.` · `Free: max 3 rounds.
Premium: unlimited.` · `Error` / `Network error` / `Failed to create tournament` /
`Failed to delete tournament` / `Failed to remove player` / `Failed to submit result` — every
network error string, since there is no network.

---

## PHASE 2 — Play vs Coach (100% offline)

Two screens plus a color-selection phase: **Coach Select → Color Select → Game**. The source file
is 3,082 lines and is the most feature-dense screen in the app.

### 2.1 The five coaches — verbatim

Avatars are photo assets (`level-1.webp` … `level-5.webp`), **not emoji**.

```swift
struct Coach {
    let id: Int, name, role, tagline, intro: String
    let thinkingMsg, yourTurnMsg, winMsg, loseMsg: String
    let accent: Color, rating: Int, image: ImageResource
}
```

| id | name | role | rating | accent |
|---|---|---|---|---|
| 1 | Jaden Pogi | Young Pawn Hero | 800 | `#4CAF50` |
| 2 | Pretty Jade | Little Princess Gambit | 1500 | `#E91E8C` |
| 3 | Handsome Jude | Kuya Tactician | 1800 | `#FF6B35` |
| 4 | Mommy Julie | Mommy Strategist | 2000 | `#FF9BC4` |
| 5 | Coach Pogi | The Master Trainer | 2500 | `#FDB022` |

Dialogue, exactly as written (the Taglish is deliberate — do not "clean it up"):

**1 — Jaden Pogi**
- tagline `Friendly • Casual • Just having fun`
- intro `Hey! I'm Jaden Pogi. I'm still learning too — but I'll give it my best shot! Let's go! 😄`
- thinking `Umm... let me think for a sec... 🤔`
- yourTurn `Your move! I'll try to keep up! 😅`
- win `Hehe, I got you! Don't worry — you'll beat me next time! 😄`
- lose `You won! Wow, you're so strong! 🎉 I still have a lot to learn!`

**2 — Pretty Jade**
- tagline `Tricky • Unpredictable • Surprising`
- intro `Hi! I'm Pretty Jade ✨ I love sneaky moves — can you keep up with me? Hehe~`
- thinking `Planning something sneaky... ✨`
- yourTurn `Your move~ don't fall into my trap! 💅`
- win `Hehe~ my trap worked perfectly! Better luck next time! 💅`
- lose `Oh no! You beat me! You're really good! ✨`

**3 — Handsome Jude**
- tagline `Sharp • Aggressive • Tactical`
- intro `I'm Handsome Jude. My tactics are sharp and aggressive — ready for battle? ⚔️`
- thinking `Calculating the sharpest line... ⚔️`
- yourTurn `Your move. Don't blunder — I'll punish it. 😤`
- win `Tactics win games! You'll need to sharpen your calculation! ⚔️`
- lose `You outplayed me! Respect — that was genuinely sharp. 👊`

**4 — Mommy Julie**
- tagline `Calm • Positional • Patient`
- intro `Hello! I'm Mommy Julie. Good chess is about patience and solid positions. Let's play! 🌸`
- thinking `Finding the best positional move... 🌸`
- yourTurn `Take your time, anak. Good moves need patience. 🌸`
- win `Patience wins every time! Keep studying positions, anak! 🌸`
- lose `Well played! You showed such great patience today. I'm proud! 🌸`

**5 — Coach Pogi**
- tagline `Maximum strength • Full power • Unrelenting`
- intro `I'm Coach Pogi. I've mastered every position on this board. Show me what you've got. 👑`
- thinking `Analyzing at full depth... every line accounted for. 👑`
- yourTurn `Your move. Every tempo matters at this level. 👑`
- win `That's the gap in preparation. Study harder — I'll be here. 👑`
- lose `You defeated me. Truly exceptional play today. 👑`

**All five are unlocked by the one-time purchase.** The RN app locked levels 3–5 behind premium
(`locked = !isPremium && id > 2`); delete the lock overlay, the `🔒` badge, the `Premium` pill and
the redirect to the paywall.

### 2.2 Engine strength — embedded Stockfish

Strength comes from three things only: search depth, MultiPV width, and a client-side randomiser.
There is no Skill Level, no UCI_LimitStrength, no Elo cap, and no explicit blunder chance.

```swift
let LEVEL_CONFIG: [Int: (depth: Int, numMoves: Int)] = [
    1: (2,  3),   2: (4,  3),   3: (7,  2),   4: (10, 1),   5: (15, 1),
]

func pickMove(_ top: [EngineLine], level: Int) -> EngineLine {
    let n = top.count
    if n == 1 { return top[0] }
    switch level {
    case 1: return top[Int.random(in: 0..<n)]                                  // uniform
    case 2: return top[Double.random(in: 0..<1) < 0.4 ? 0 : Int.random(in: 0..<n)]
    case 3: return top[Double.random(in: 0..<1) < 0.7 ? 0 : min(1, n - 1)]
    default: return top[0]
    }
}
```

Effective behaviour: **L1** picks uniformly among 3 lines at depth 2 (this *is* the blunder
injection). **L2** plays best ≈ 60 % of the time. **L3** plays best 70 %, second 30 %. **L4/L5**
always play best, at depth 10 and 15.

Engine call: `MultiPV = numMoves`, `depth = config.depth`, **movetime cap 1000 ms** (the Python
service capped every interactive search at `ENGINE_TIMEOUT = 1.0 s`, so keeping the cap preserves
the bots' real strength). Cancel any in-flight search when the game resets.

> **New, and required.** On-device the engine answers in milliseconds, whereas the RN bots were
> paced by network latency. Without a delay the coach replies instantly and the game feels broken.
> Add a randomised think time, awaited in parallel with the search:
>
> | Level | Think time |
> |---|---|
> | 1 | 300–700 ms |
> | 2 | 400–900 ms |
> | 3 | 600–1,300 ms |
> | 4 | 800–1,700 ms |
> | 5 | 1,000–2,200 ms |
>
> Scale the upper bound down by 40 % when the position has fewer than 8 pieces, so endgames do not
> drag.

### 2.3 The opening book

A hard-coded, per-persona book that overrides the engine while `sanHistory.count < 14` (the first
7 moves per side), returning `nil` to fall through. This is what gives each bot a recognisable
style, and it is 100 % offline already.

Encode it declaratively rather than as the nested `if` chain in the source:

```swift
struct BookRule { let level: Int; let side: PieceColor; let history: [String]; let move: String }
// history is an EXACT prefix match on the SAN list; move is UCI.
```

**Level 1 — Jaden: deliberate junk.** Random from a pool on move 1 only.
- As White (`history == []`), pick uniformly from:
  `f2f3` Barnes · `g2g4` Grob · `b2b4` Polish · `a2a3` Anderssen · `h2h3` Clemenz · `b1a3` Sodium.
- As Black (`history == ["<any>"]`), pick uniformly from:
  `f7f6` Barnes Defense · `a7a6` St. George · `h7h6` Carr · `g7g5` Grob Defense · `b8a6`.
- Nothing after move 1 — the engine takes over at depth 2.

**Level 2 — Jade: King's Gambit / Latvian / Budapest.**
White: `e2e4` always → after `1.e4 e5` play `f2f4`; after `1.e4 e5 2.f4 exf4` play `g1f3`; after
`1.e4 e5 2.f4` (any) play `g1f3`; vs `1…c5` play `d2d4`; vs `1…e6` or `1…d6` play `d2d4`.
Black: vs `1.e4` play `e7e5`; after `1.e4 e5 2.Nf3` play `f7f5` (Latvian); vs `1.d4` play `g8f6`;
after `1.d4 Nf6 2.c4` play `e7e5` (Budapest).

**Level 3 — Jude: Italian / Najdorf.**
White: `e2e4` → `1.e4 e5` `g1f3` → `2…Nc6` `f1c4` (Italian) → `3…Bc5` `c2c3`; vs Petrov `2…Nf6`
play `f3e5`.
Black: vs `1.e4` `c7c5` (Sicilian) → `2.Nf3` `d7d6` → `3.d4` `c5d4` → `4.Nxd4` `g8f6` →
`5.Nc3` `a7a6` (Najdorf); vs Alapin `2.c3` `d7d5`; vs `2.d4` `c5d4`; vs `1.d4` `g8f6` →
`2.c4` `c7c5` (Benoni) → `3.d5` `e7e6` → `4.Nc3` `e6d5`; after `1.d4 Nf6 2.Nf3` `g7g6`.

**Level 4 — Julie: London / French / Nimzo-Indian.**
White (London, gated on exact history length 0, 2, 4, 6, 8, 10):
`d2d4` → `g1f3` → `c1f4` → `e2e3` → `c2c3` → `f1d3`.
Black: vs `1.e4` `e7e6` → `d7d5`; vs Advance `3.e5` `c7c5`; vs Classical `3.Nc3` `g8f6`; vs
Tarrasch `3.Nd2` `g8f6`. Vs `1.d4` `g8f6` → `e7e6` → after `3.Nc3` `f8b4` (Nimzo) → after `4.Nf3`
`b7b6`; after `1.d4 Nf6 2.Nf3` play `e7e6`.

**Level 5 — Coach Pogi: Smith-Morra / Ruy Lopez / Scandinavian / Slav.**
White: `e2e4`; vs Sicilian → Smith-Morra `d2d4` → `c2c3` → `b1c3` → `g1f3` → `f1c4` (gated on
history lengths 2/4/6/8/10 with exact SAN gates `cxd4`, `dxc3`, `Nxc3`, `Nf3`); vs `1…e5` Ruy
Lopez `g1f3` then `f1b5`; vs Petrov `f3e5`.
Black: Scandinavian `d7d5` → `d8d5` → `d5a5` (Mieses-Kotrč) → `g8f6`; vs Advance `3.e5` `c7c5`;
vs `1.d4` Slav `d7d5` → `c7c6` → `g8f6` after `Nf3` or `Nc3`; after `2.Nf3` `g8f6`; after
`2.Bf4` `c7c6`.

Rules for all levels: if the book move is illegal in the actual position, **fall through to the
engine silently** — never crash, never pass.

### 2.4 Game state

```swift
enum Phase { case coachSelect, colorSelect, playing }

struct MoveRecord {
    let san: String?          // nil only for index 0, the start sentinel
    let fen: String           // position AFTER the move
    let from: String?, to: String?
    let color: PieceColor?
}
```

- `moveRecords[0]` is always the start sentinel `{san: nil, fen: startFEN, …}`.
- `reviewIndex: Int?` — `nil` means LIVE. `n` shows `moveRecords[n]`; index 0 is the start
  position. Jumping to the newest index sets it back to `nil` so the board is live again.
- `displayPosition` is derived: LIVE → the live board; otherwise rebuild a position from
  `moveRecords[reviewIndex].fen`, with `lastMove` taken from that record's own `from`/`to`.
- `isFlipped = userColor == .black`, fixed for the whole game.
- Drop `fullMoveNumber` from the record — the RN struct writes it on every move and nothing ever
  reads it; the move strip recomputes pairs from the array index.

**Threefold repetition** is tracked locally: key = the **first three** FEN fields
(pieces, side to move, castling). Count every recorded position; ≥ 3 is a draw.

> **Fix:** the RN key used the first **four** fields, including the en-passant target. chess.js
> emits an ep square after any double pawn push whether or not a capture is legal, so genuinely
> identical positions hashed differently and real threefolds were missed. Three fields is correct
> for practical purposes; four fields plus an "is ep actually available" normalisation is
> strictly correct if you want it.

**Game over**, evaluated after every half-move (user, book and engine paths alike):
| Condition | `gameResult` | outcome |
|---|---|---|
| Checkmate | `coach.winMsg` if the user is mated, else `coach.loseMsg` | `.loss` / `.win` |
| Threefold (local counter) | `Draw by threefold repetition!` | `.draw` |
| Stalemate | `Stalemate — It's a draw!` | `.draw` |
| 50-move rule | **`Draw by the fifty-move rule.`** — new | `.draw` |
| Insufficient material | **`Draw — not enough material to mate.`** — new | `.draw` |
| Resign | `You resigned. {coach.name} wins this round!` | `.loss` |

The last two are new strings. The RN app collapsed both into the generic
`Draw! A well-balanced battle.`, which is now the fallback for any other drawn ending.

### 2.5 Screen — Coach Select

Background `#070E20`. Two decorative glow orbs, `ORB = screenWidth * 1.5`:
`bgGlowA` — `ORB × ORB`, radius `ORB/2`, fill `rgba(0,80,200,0.16)`, `bottom -ORB*0.48`,
`leading -(ORB - screenWidth)/2`. `bgGlowB` — `ORB*0.65` square, fill `rgba(0,140,255,0.1)`,
`bottom -ORB*0.22`, centred.

1. Back button, top margin 8, leading 10.
2. Title block (centred, `h 24`, top 4, bottom 22): row **`♞`** 16pt `#FFFFFF` opacity 0.85 +
   **`" PLAY AGAINST THE "`** 12pt weight 700 letter-spacing 2 + **`♞`**, bottom margin 4; then
   **`BIYAHERONG COACH\nFAMILY BOTS`** 30pt weight 900 `#FDB022` centred line-height 35
   letter-spacing 0.8 uppercase; then **`♟`** 22pt `#FDB022`; then
   **"Train your chess skills with fun AI opponents."** 13pt `rgba(255,255,255,0.85)` top margin 6
   line-height 18 centred.
3. **Row 1** — space-around, bottom-aligned, `h 4`, bottom margin 6: **Mommy Julie · Coach Pogi
   (featured, centre) · Handsome Jude**.
4. **Row 2** — centred, bottom-aligned, `h = screenWidth * 0.08`, gap 16, bottom margin 22:
   **Jaden Pogi · Pretty Jade**.
   Card: `flex 1` (featured `1.15`), centred, `h 4`, bottom 4, press opacity 0.75.
   Avatar 80pt (featured 108). `ring = avatar + 6`, `halo = ring + 10`.
   - Halo: fill `rgba(0,160,255,0.07)` (featured `rgba(0,200,255,0.1)`), circular, bottom margin 8.
   - Ring: 2.5pt border `rgba(0,220,255,0.95)`, fill `rgba(4,20,60,0.5)`, shadow `#00CFFF`
     `(0,0)` opacity 0.9 radius 8. Featured: 3pt `#00E5FF`, shadow radius 14 opacity 1.
   - Image circular, `.scaledToFill()`.
   - Name 13pt weight 700 `#FFFFFF` (featured 16pt weight 900), bottom margin 1.
   - Role 10pt weight 600 `#FDB022` (featured 12pt).
   - **`ELO {rating}`** 10pt weight 700 `#8BA3C7` (featured 12pt `#FDB022`), top margin 1.
   - Description 9pt `rgba(255,255,255,0.55)` top margin 1 — Jaden `Beginner friendly bot`,
     Jade `Tricky and unpredictable`, Jude `Sharp attacking style`, Julie
     `Calm positional player`, Coach Pogi has none.
5. **Settings row**: **"Allow Take Back"** 14pt weight 700 `#FFFFFF` + a toggle (tint `#FDB022`).
   Container: space-between, `h 24`, bottom margin 18, fill `rgba(255,255,255,0.06)`, radius 14,
   `h 18 / v 12`, 1pt border `rgba(255,255,255,0.08)`. Default **on**.
   **Persist it** — the RN version kept it in local state and forgot the choice every launch.
6. **Footer**: **"Kabyahe mo sa pag improve!!"** 21pt weight 900 `#FDB022` centred bottom margin 5;
   **"Train • Improve • Have Fun"** 12pt `rgba(255,255,255,0.65)` italic letter-spacing 1.5.

### 2.6 Screen — Color Select

Derived: `accentFaint = accent @ 13 % alpha`, `accentMid = accent @ 25 % alpha`.

1. **Top glow** — pinned top, `height = screenWidth * 1.1`, bottom corners rounded
   `screenWidth * 0.55`, fill `accentFaint`.
2. Back button → leaves the feature.
3. **Intro block** (centred, `h 24`, top 4, bottom 18):
   - Halo 136×136 radius 68 fill `rgba(0,0,0,0.15)`, shadow accent `(0,0)` opacity 0.45 radius 22,
     bottom margin 10.
   - Ring 120×120 radius 60, 3pt border accent, fill `rgba(4,16,48,0.65)`, shadow accent radius 14.
   - Avatar 112×112 radius 56, `.scaledToFill()`.
   - Stars: five **`★`** 22pt, gap 5, bottom margin 8 — `#FDB022` for `i < level`, otherwise
     `rgba(255,255,255,0.1)`.
   - Name 27pt weight 900 `#FFFFFF` bottom margin 3 · Role 14pt weight 700 accent bottom margin 4 ·
     Tagline 11pt `rgba(255,255,255,0.4)` letter-spacing 0.3 bottom margin 10.
   - ELO badge: row gap 6, fill `rgba(255,255,255,0.06)`, radius 12, `h 14 / v 5`, 1pt border
     `rgba(255,255,255,0.1)`, bottom margin 14 — label **`ELO`** 11pt weight 700
     `rgba(255,255,255,0.45)` letter-spacing 1, value 16pt weight 900 accent letter-spacing 0.5.
   - Speech bubble: a triangle (11pt half-width, 14pt tall, fill `rgba(8,20,50,0.97)`) above a
     full-width bubble — fill `rgba(8,20,50,0.97)`, radius 18, 1pt border `accentMid`,
     `h 20 / v 16`; text is the intro **wrapped in literal ASCII double quotes**, 13pt `#D4E8F8`
     line-height 21 italic centred.
4. **Color section** (`h 20`, bottom 16, gap 14): label **`♟ Choose Your Side ♟`** 14pt weight 700
   `#FFFFFF` centred letter-spacing 1 opacity 0.9. Two cards, gap 12, each `flex 1`, radius 20,
   `v 24`, centred, gap 6, 2pt border:
   - White: fill `#EFF3F8`, border `#CBD5E1`, **`♔`** 44pt `#1E293B`, **"White"** 17pt weight 800
     `#1E293B`, **"You move first"** 11pt `#64748B`.
   - Black: fill `#0F1520`, border `#2C3A50`, **`♚`** 44pt `#FFFFFF`, **"Black"** 17pt weight 800
     `#FFFFFF`, **`{coach.name} goes first`** 11pt `#94A3B8`.
5. **Saved-game banner** (when an unfinished game exists in memory or on disk): `h 20`, top 4,
   bottom 8, row gap 8, fill `rgba(253,176,34,0.1)`, radius 12, 1pt border
   `rgba(253,176,34,0.35)`, `h 14 / v 10`. Icon **`⏸`** 16pt; text **`Unfinished game · {n}
   move{s} as {White|Black}`** `flex 1` 12pt weight 600 `rgba(253,176,34,0.9)`.

**Continue / New Game dialog** — title **"Continue Previous Game?"**, body
**`You have an unfinished game — {n} move{s} played as {White|Black}.\n\nWould you like to continue
or start fresh?`**, buttons **"New Game"** (destructive) then **"Continue"**, dismissible.
`{n}` counts half-moves (`moveRecords.count - 1`), pluralised on `n != 1`.

> **Fix:** in the RN app, "Continue" on an in-memory game **ignores the colour card you just
> tapped** — you press White, choose Continue, and resume as Black. Either resume with the saved
> colour and say so in the body text, or (better) only offer Continue when the tapped colour
> matches the saved one, and offer New Game otherwise.

### 2.7 Screen — Game

Container fill `#07111F`.

**Band 1 — Header** (`h 10 / v 6`): back `←` → returns to Color Select **without ending the
game** · centre (`flex 1`, row, gap 10): avatar ring 42×42 radius 21 2pt border accent containing a
38×38 image, then a column with the name 15pt weight 800 `#FFFFFF` and the role 11pt weight 600
accent · trailing colour badge `h 10 / v 5`, radius 12, min-width 74 — White: fill
`rgba(255,255,255,0.1)`, 1pt border `rgba(255,255,255,0.28)`, text **`⬜ White`**; Black: fill
`rgba(0,0,0,0.3)`, 1pt border `rgba(255,255,255,0.15)`, text **`⬛ Black`**; 11pt weight 600
`#FFFFFF`.

**Band 2 — Coach talk strip** (always present): row, fill `rgba(255,255,255,0.04)`, `h 12` margins,
bottom 4, radius 14, `h 12 / v 8`, 1pt border `accent @ 19 %` (`accent @ 31 %` when the game is
over), gap 10, **min-height 50**.
- Avatar ring 40×40 radius 20 2pt border accent, 36×36 image, non-shrinking.
- Right group (`flex 1`, row, gap 8): a small spinner in accent while the coach is thinking, then
  the text — 12pt `rgba(255,255,255,0.78)` italic line-height 18, max 2 lines:
  game over → **`Game over — You won!`** / **`Game over`** / **`Game over — Draw`**; else
  reviewing → **`Reviewing game...`**; else the coach's thinking or your-turn line.
- **Premove chip** when a premove is queued and the game is live: fill `rgba(255,193,7,0.2)`,
  radius 8, `h 8 / v 4`, 1pt border `rgba(255,193,7,0.5)`, text **`⚡ {from}→{to}`** 10pt weight
  700 `#FDB022`.
- **Results chip** when the game is over and the modal is dismissed: `h 12 / v 6`, radius 10, fill
  accent, text **"Results"** 11pt weight 800 `#FFFFFF`.

**Band 3 — Move strip** (only when moves exist): horizontal scroll, max height 36, `h 12` margins,
bottom 4, content centred, `h 4`, gap 2.
- Per move pair: a group (row, gap 1) whose x-offset and width are recorded for auto-scroll.
- Pair number **`{n}.`** 11pt `rgba(255,255,255,0.3)`, `h 3`, monospaced.
- Move token: `h 6 / v 4`, radius 6, clear; **active** → fill `#FDB022`. Text 12pt
  `rgba(255,255,255,0.65)` monospaced; active → `#07111F` weight 700. Tap jumps to that index.
- Optional classification superscript after the SAN once a review has run: 9pt weight 700 in the
  classification colour, leading margin 1, glyph from `!! · ! · B · ★ · ✓ · (none) · ?! · ? · ↗ · ??`.

Auto-scroll: on any change to the active index, centre that move's **pair** —
`scrollX = max(0, pair.x + pair.width/2 - screenWidth/2)`, animated. In SwiftUI use
`ScrollViewReader.scrollTo(pairID, anchor: .center)`, which sidesteps two RN bugs at once: the
layout cache was never cleared between games (stale offsets after a take-back), and the scroll
effect ran on the same commit that created the new pair, so the newest move never scrolled into
view until the move after it.

**Band 4 — Board**, centred, with the SVG overlay above it (premove squares + arrow).
Board props: `disabled = isReviewing`, `showLegalMoves = !isReviewing`, `dragEnabled =
!isReviewing`, `selectedSquare = isReviewing ? nil : selected`, `lastMove = displayPosition.lastMove`.
Only the user's own colour is draggable.
Premove overlay: from-square `rgba(255,193,7,0.35)`, to-square `rgba(255,193,7,0.45)`, arrow
`rgba(255,193,7,0.75)` — stroke `squareSize * 0.18` round-capped, head `squareSize * 0.35`, shaft
stopping `head * 0.7` short of the tip, head half-width `head * 0.6`.

**Band 5 — Nav bar** (row, centred, `h 12 / v 6`, gap 4). Buttons 44×34, radius 8, fill
`rgba(255,255,255,0.08)`, glyph 16pt `#FFFFFF`; disabled → opacity 0.3.

| Control | Action | Disabled when |
|---|---|---|
| **`⏮`** | jump to index 0 | not reviewing **and** ≤ 1 record |
| **`◀`** | previous (from LIVE → `count - 2`) | ≤ 1 record |
| centre | see below | — |
| **`▶`** | next (past the end → LIVE) | not reviewing |
| **`⏭`** | jump to LIVE | not reviewing |

Centre: LIVE → `flex 1`, height 34, radius 8, fill `rgba(255,255,255,0.04)`, margins 4, row gap 5,
a 7×7 dot radius 4 `#4CAF50` + **`LIVE`** 10pt weight 700 `#4CAF50` letter-spacing 1. Reviewing →
tappable, fill `#1A3560`, text **`▶ Live`** 12pt weight 700 `#FDB022`.

> Make the `⏮` disabled rule match `◀` (`records.count <= 1`); the RN pair was inconsistent, so at
> the start position in review mode `⏮` stayed enabled and did nothing.

**Band 6 — Bottom bar** (row, `h 12`, bottom 8, top 4, gap 8). Shared: `v 10`, radius 12, centred,
min-width 44; disabled → opacity 0.4.
1. **Resign** — `flex 1`, fill `#7F1D1D`, 1pt border `rgba(255,80,80,0.3)`, label **"Resign"**
   13pt weight 700 `#FFCDD2`. **Add the confirmation the RN app lacks** — one tap currently ends
   the game instantly: **"Resign?"** / **`{coach.name} will win this game.`** /
   **"Keep Playing"** · **"Resign"** (destructive).
2. **Take Back** — only when enabled in settings; `flex 1`, fill `#78350F`, 1pt border
   `rgba(253,176,34,0.3)`, label **`↩ Take Back`** 12pt weight 700 `#FDE68A`. Disabled while the
   game is over, the coach is thinking, you are reviewing, or fewer than 3 records exist. Removes
   the last **two** records, rebuilds the position and the repetition counter, clears the premove
   and the selection.
3. **New Game** — `flex 1`, fill `#1B3050`, 1pt border `rgba(255,255,255,0.15)`, label
   **"New Game"** 13pt weight 700 `#FFFFFF` → back to Color Select (the in-memory game survives
   and triggers the Continue dialog).

**Promotion dialog** — full-screen overlay, scrim `rgba(0,0,0,0.8)`, card fill `#1A2942`,
radius 20, padding 24, **width 280**. Title **"Choose Promotion"** 18pt bold centred bottom
margin 16. Four rows, gap 10, each fill `#4A90E2`, radius 12, padding 14, row centred gap 12, with
a 36×36 piece glyph drawn in the user's colour and a 16pt bold `#FFFFFF` label. Order
**Queen · Rook · Bishop · Knight**. No cancel.

**End-of-game modal** — scrim `rgba(0,0,0,0.7)`, tap-outside dismisses (leaving the Results chip).
Card fill `#0D1B30`, radius 22, `v 24 / h 28`, centred, `width = screenWidth - 56`, 1pt border
`accent @ 25 %`, gap 6:
avatar ring 68×68 radius 34 3pt border accent (60×60 image) bottom margin 4 · outcome emoji 32pt
(**🎉** win / **💪** loss / **🤝** draw) · outcome label 22pt weight 900 — **"You Won!"** `#4CAF50`
/ **"You Lost"** `#F44336` / **"Draw"** `#FFC107` · the result sentence 13pt weight 600 centred
line-height 20 opacity 0.85 in accent · actions row gap 10 top margin 10: **"Rematch"** (`h 24 /
v 11`, radius 14, min-width 100, fill accent, 14pt weight 800 `#FFFFFF`; restarts with the same
colour) and **"New Game"** (same metrics, clear fill, 1.5pt border `rgba(255,255,255,0.2)`) ·
**"Review Game"** (top margin 6, `h 28 / v 11`, radius 14, fill `rgba(255,255,255,0.08)`, 1pt
border `rgba(255,255,255,0.2)`, 14pt weight 700 `#D4E8F8`) when moves exist.

### 2.8 Premove

Queued only while the coach is thinking, the game is live, and you are not reviewing. Tap path:
first tap selects one of your pieces, second tap sets `{from, to}`. Drag path: any drag from your
own piece queues immediately. Only the origin piece's ownership is checked — legality is not.
One premove at a time; a new one replaces it.

Firing: after the coach's move lands and the game continues, clear the premove and apply it
**80 ms** later. If it turns out illegal it is dropped silently. Promotion is forced to Queen —
the dialog never appears for a premove.

**Three fixes to make:**
1. **Add a cancel affordance.** Today nothing clears a queued premove — tapping an empty square or
   an enemy piece only fiddles with the selection. Make a tap on the premove chip, or on either of
   the two highlighted squares, cancel it.
2. **Clear the premove when the game ends.** Both terminal branches leave `premoveRef` set, so it
   survives into the next screen state.
3. **Give failed premoves feedback** — a brief red flash on the origin square beats silence.

### 2.9 Draft persistence

Key: one draft per level. Payload: `{level, userColor, moveRecords, savedAt}` — the full record
array, not a PGN. Written after **every** half-move (yours and the coach's). Cleared on game over,
on New Game, and by the dialog's "New Game" button. Retention **7 days** (not the 24 hours used by
the other drafts in this app — keep 7 here, it is a full game, not a puzzle attempt).
Malformed data → delete the key.

Restoring rebuilds the position from the last record, rebuilds the repetition counter by replaying
every recorded FEN, and — if it is the coach's turn — starts the coach's move after 400 ms.
**Also reset the game-over/review modal state and play the game-start sound**, neither of which the
RN restore path does.

### 2.10 Game Review — offline

The RN screen posted every position to `/api/games/review` (rate-limited to 5 per hour, capped at
201 positions). Offline this runs on the embedded engine: **batch-analyse every position at depth
12**, then compute the same numbers with the same thresholds.

```
eval normalisation: mate in n  ->  ±10000 ∓ n*10
winPercent(cp)    =  50 + 50 * (2/(1 + pow(10, -cp/400)) - 1)
cpLoss            =  |eval(best) - eval(played)|, from the mover's side
```

| Classification | Rule |
|---|---|
| `brilliant` | reserved (never produced by these thresholds) |
| `great` | played the best move **and** cpLoss ≤ 5 |
| `best` | played the best move, or cpLoss ≤ 0 |
| `excellent` | cpLoss ≤ 15 |
| `good` | cpLoss ≤ 30 |
| `inaccuracy` | cpLoss ≤ 60 |
| `mistake` | cpLoss ≤ 120 |
| `miss` | cpLoss ≤ 200 |
| `blunder` | otherwise |

Accuracy per side = the mean win-percent retention across that side's moves.
Also include **`book`** in the display order — it is defined with a colour, symbol and label but
omitted from `CLASSIFICATION_ORDER`, so a book move would be counted and never shown.

**Review modal** — scrim `rgba(0,0,0,0.7)`, card fill `#0D1B30`, radius 22, `v 20 / h 20`,
`width = screenWidth - 40`, 1pt border `accent @ 19 %`, max height 85 %.
- Title **"GAME REVIEW"** 16pt weight 900 centred letter-spacing 2 bottom margin 14.
- Progress state (replacing the old spinner + `This may take 20-30 seconds`): a determinate bar,
  **`Analyzing… {done}/{total}`** — on-device you know the position count, so show real progress.
- Players row: two columns, each with a label 13pt weight 700 `rgba(255,255,255,0.7)`, the accuracy
  `{x.x}%` 28pt weight 900 coloured `≥80 #4CAF50 · ≥60 #FFC107 · ≥40 #FF9800 · else #F44336`, and
  **"Accuracy"** 10pt weight 600 `rgba(255,255,255,0.35)` letter-spacing 1 uppercase. Divider 1×50
  `rgba(255,255,255,0.12)` with 12pt horizontal margins.
  > **Fix:** make both halves use the same orientation. The RN modal ordered the accuracy columns
  > White-left/Black-right but the classification rows user-left/opponent-right, so playing Black
  > put the coach's accuracy above your own move counts.
- Eval graph when > 1 point: fill `#1A2740` radius 6, `width = screenWidth - 80`, height 60,
  clamp ±500 cp, white fill `rgba(255,255,255,0.25)` above the midline, black
  `rgba(0,0,0,0.35)` below, centre line `rgba(255,255,255,0.15)` 1pt, curve `#FDB022` 1.5pt.
- Classification rows (gap 5, bottom margin 16), skipping any with 0 on both sides: count 15pt
  weight 800 width 30 centred in the class colour · 8×8 dot radius 4 · label
  **`{LABEL} {symbol}`** 13pt weight 600 `rgba(255,255,255,0.7)` width 90 centred · dot · count.
- Actions gap 10: **"Start Review"** (`flex 1`, `v 13`, radius 14, fill accent, 15pt weight 900
  `#FFFFFF`) → hands the game to the Analysis Board; **"New Game"** (`flex 1`, fill
  `rgba(255,255,255,0.08)`, 1pt border `rgba(255,255,255,0.2)`, 15pt weight 800 `#FFFFFF`).

**Hand-off to the Analysis Board** — build the PGN from the record list and pass it together with
the starting FEN **and the per-move classifications**.
> **Fix:** the RN hand-off always shipped an empty `moveEvaluations` array. `handleGameReview` reads
> `reviewData` but its dependency list contains only `moveRecords`, so the memoised callback closes
> over `reviewData === null` forever and the Analysis Board never received a single classification.

### 2.11 Sounds

Six files: `game-start`, `move`, `capture`, `castling`, `check`, `game-over`. Priority, evaluated
in order:

```
game over  >  check  >  castling (king- or queen-side)  >  capture (incl. en passant)  >  move
```

`game-start` plays on a new game **and on a restored game**. `game-over` plays on every terminal
detection including resignation. Promotion has no distinct sound.
Configure the audio session explicitly — the RN screen never called
`Audio.setAudioModeAsync`, so the sounds obeyed the hardware silent switch and ducked nothing.
Use `.ambient` with `.mixWithOthers` so music keeps playing.

### 2.12 Concurrency — the four races to design out

The RN implementation has no cancellation anywhere, which produces four reproducible bugs. In
Swift, run the engine in a `Task` owned by the game session and cancel it on every state change:

1. **Resign while the coach is thinking** → the in-flight response still lands, mutates the
   position, appends a move and overwrites the status text. A ghost move appears on a resigned
   board.
2. **New Game while a request is in flight** → the stale closure holds the *old* position object
   and overwrites the new game's board with the previous game's position.
3. **Timers are never cleaned up** — the 300 ms, 400 ms and two 80 ms timers all survive
   navigation and fire on a dead screen.
4. **Reviewing does not pause the coach** — the engine keeps moving underneath you, and if you were
   at the newest index you silently end up reviewing an older position instead of being live.

Rule: one `Task`, cancelled in `deinit`, on resign, on new game, on take-back and on restore.
Check `Task.isCancelled` after the engine returns and before touching any state.

### 2.13 Timing table — Play vs Coach

| Behaviour | Value |
|---|---|
| Coach's first move when you pick Black | 300 ms + think time |
| Coach's move after restoring a draft | 400 ms + think time |
| Premove fires after the coach's move | 80 ms |
| Engine movetime cap | 1,000 ms |
| Think time (levels 1→5) | 300–700 / 400–900 / 600–1,300 / 800–1,700 / 1,000–2,200 ms |
| Opening-book cutoff | first 14 half-moves |
| Game-review analysis depth | 12 |
| Draft retention | 7 days |

### 2.14 Strings — Play vs Coach

`♞ PLAY AGAINST THE ♞` · `BIYAHERONG COACH FAMILY BOTS` ·
`Train your chess skills with fun AI opponents.` · `Allow Take Back` ·
`Kabyahe mo sa pag improve!!` · `Train • Improve • Have Fun` · `ELO {n}` ·
`Beginner friendly bot` · `Tricky and unpredictable` · `Sharp attacking style` ·
`Calm positional player` · `♟ Choose Your Side ♟` · `White` · `You move first` · `Black` ·
`{coach} goes first` · `Unfinished game · {n} moves as {colour}` · `Continue Previous Game?` ·
`You have an unfinished game — {n} moves played as {colour}.` ·
`Would you like to continue or start fresh?` · `New Game` · `Continue` · `⬜ White` · `⬛ Black` ·
`Game over — You won!` · `Game over` · `Game over — Draw` · `Reviewing game...` · `Results` ·
`⚡ {from}→{to}` · `LIVE` · `▶ Live` · `Resign` · `Resign?` · `{coach} will win this game.` ·
`Keep Playing` · `↩ Take Back` · `Choose Promotion` · `Queen` · `Rook` · `Bishop` · `Knight` ·
`You Won!` · `You Lost` · `Draw` · `Rematch` · `Review Game` · `GAME REVIEW` ·
`Analyzing… {done}/{total}` · `You` · `Accuracy` · `Start Review` ·
`Draw by threefold repetition!` · `Stalemate — It's a draw!` · `Draw by the fifty-move rule.` ·
`Draw — not enough material to mate.` · `Draw! A well-balanced battle.` ·
`You resigned. {coach} wins this round!` · plus the 5 × 6 persona lines in 2.1.

**Deleted:** `Engine unavailable — your turn` · `Could not load opening data. Please try again.` ·
`Could not load opening data. Check your connection.` · `Could not open game review.` ·
`Analysis Failed` · `Could not analyze the game. You can still review it manually.` ·
`Review Manually` · `Try Again` · `Close` · `Premium` (the coach lock badge) ·
`This may take 20-30 seconds`.

**Also removed:** the entire **Opening Explorer** panel. It is already unreachable in the shipping
build — `toggleOpeningPanel` is defined but never referenced, `showOpeningPanel` can only ever be
`false`, and ~300 lines of JSX and styles hang off it. It also required a Lichess round-trip.
Likewise the **annotate/draw** subsystem (`annotateMode`, `userArrows`, `userHighlights`,
`arrowStart`): `setAnnotateMode(true)` is never called anywhere, its button was deleted in commit
`02cc033`, and its styles were deleted with it while the Explorer's were left behind. Do not port
either; if you want arrows, the Analysis Board already has them.

---

## PHASE 3 — Store & Entitlement (StoreKit 2)

Build this **before** Phases 4 and 5 — both are gated by it.

### 3.1 The service

```swift
@Observable final class StoreService {
    private(set) var appProduct: Product?
    private(set) var subscriptions: [Product] = []   // monthly, yearly — one group
    private(set) var entitlements = Entitlements()
    private(set) var loadState: LoadState = .idle    // .idle | .loading | .loaded | .failed(String)

    func load() async                                // Product.products(for:)
    func purchase(_ product: Product) async throws -> PurchaseOutcome
    func restore() async throws -> RestoreOutcome    // AppStore.sync() then refresh
    func refreshEntitlements() async                 // Transaction.currentEntitlements
    func startObserving()                            // Transaction.updates, for the app's lifetime
}
```

- `refreshEntitlements()` runs at launch, on `.scenePhase == .active`, and on every
  `Transaction.updates` value. Always `await transaction.finish()`.
- Verify with `VerificationResult` — treat `.unverified` as not entitled.
- Persist `lastVerified` and the last-known booleans so the 14-day offline grace in 0.2 works on a
  cold launch with no network.

### 3.2 Paywall screen

Reachable from: the Openings hub, the Tutorial Videos list, and a Settings row. Background
`#0F1A2E`.

**Already subscribed** — header (back · **"Premium"** · a green pill fill `#4CAF50`, `h 12 / v 6`,
radius 20, text **"✓ Active"** 12pt bold `#FFFFFF`); body **👑** 64pt ·
**"You're all set!"** 24pt bold `#FDB022` · **"Opening Trainer and Tutorial Videos are unlocked."**
14pt `#8BA3C7`; then an info card fill `#1A2942`, radius 16, padding 20, 1pt border
`rgba(253,176,34,0.3)`:
- **`Your {Yearly|Monthly} Subscription`** 16pt bold `#FDB022`
- **`Active until {date}`** 20pt weight 800 `#FDB022` centred — formatted with
  `Calendar.current`, long month, day, year
- a pill fill `rgba(76,175,80,0.15)` with **`{n} days remaining`** 13pt bold `#4CAF50`
- **📅** row — **"Next Renewal Date"** when auto-renewing, else **"Expires On"**
- **🔄** row — **"Your subscription renews automatically via the App Store."** or
  **"Auto-renewal is off. Your access ends on the expiry date."**
- **⚙️** row — **"Manage Subscription"** →
  **"To cancel or change your plan, go to Settings → Apple ID → Subscriptions."**, with a button
  that opens `showManageSubscriptions(in:)`

> **Fix:** compute `daysRemaining` by rounding **up** over calendar days
> (`Calendar.current.dateComponents([.day], …)` on start-of-day boundaries). The server truncated a
> float toward zero, so 27.9 days displayed as "27 days remaining" and anything under 24 hours read
> "0 days remaining". Also format dates in the device's calendar — the RN screen rendered a UTC
> instant with a local formatter, so a subscription ending `2026-05-01T02:00:00Z` displayed as
> "April 30".

**Not subscribed** — header (back · **"Go Premium"** 20pt bold · `AppLogo(30)`):
1. Hero (`v 24`, centred): **👑** 64pt · **"Unlock Full Access"** 24pt bold `#FDB022` ·
   **"Train without limits. Get the most out of Biyaherong Chess Coach."** 14pt `#8BA3C7` centred
   line-height 22.
2. **What the subscription adds** — card fill `#1A2942`, radius 16, padding 20, 1pt border
   `rgba(253,176,34,0.2)`; title **"Biyaherong Plus"** 18pt bold `#FFFFFF`; rows of `✓` in
   `#FDB022` + emoji + 14pt `#FFFFFF`:
   - `📖 Opening Trainer — spaced repetition for 22 curated openings`
   - `📤 Upload your own PGN repertoires`
   - `🎬 Exclusive tutorial videos from FM Deniel`
   - `⬇️ Save videos for offline viewing`
3. **What you already own** — a quieter card listing the one-time-purchase modules so the value
   split is legible: `♟️ Puzzle Hub`, `🔍 Analysis Board`, `🏆 Pairing Manager`,
   `🤖 Play vs Coach — all 5 coaches`, each with a `✓` in `#4CAF50`. If the user does **not** own
   the app yet, this block becomes the one-time-purchase offer instead, with its own button.
4. Plan toggle, gap 12: each card fill `#1A2942`, radius 16, padding 16, 2pt border
   `rgba(253,176,34,0.2)`; selected → border `#FDB022`, fill `#1E3050`. Labels **"Monthly"** /
   **"Yearly"** 13pt weight 600 (`#FDB022` when selected); price 28pt bold from
   `product.displayPrice`; sub-line **"per month"** / **"per year"**; the yearly card carries a
   badge fill `rgba(253,176,34,0.15)`, radius 8, text **"BEST VALUE"** 10pt bold `#FDB022`, plus
   the computed saving **`Save {n}%`**. **Default selection: yearly.**
5. CTA — radius 16, `v 18`, fill `#FDB022`, shadow, gap 12, label
   **`Subscribe — {price}/{yr|mo}`** 16pt bold `#0F1A2E`. Loading → spinner + **"Loading..."**.
6. Failure card when products will not load: fill `rgba(253,176,34,0.08)`, radius 14, padding 16,
   1pt border `rgba(253,176,34,0.5)`; title **"Couldn't load subscriptions from the App Store"**;
   body **"Make sure you're signed in to the App Store under Settings → Apple ID, then retry."**;
   button **"Retry"**.
7. Disclosure card (required by App Review, only once prices are known): title
   **"Biyaherong Plus"**, lines **`Monthly — {price} per month`** and
   **`Yearly — {price} per year`**, then verbatim:
   **"Payment will be charged to your Apple ID account at confirmation of purchase. Subscription
   automatically renews unless auto-renew is turned off at least 24 hours before the end of the
   current period. Your account will be charged for renewal within 24 hours prior to the end of the
   current period at the same price. You can manage your subscriptions and turn off auto-renewal by
   going to your App Store account settings after purchase."**
   Links: **"Terms of Use (EULA)"** →
   `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/` · **"Privacy Policy"** →
   `https://biyaherongchesscoach.com/privacy`.
8. **"Restore Purchases"** — underlined text link 13pt `#8BA3C7`, and an outlined
   **"Already paid? Restore"** button (1.5pt border `#FDB022`, radius 14, `v 14`, min-height 50,
   14pt weight 600 `#FDB022`).

### 3.3 Gate presentation

When a locked feature is opened, do **not** show a modal over an empty screen. Show the feature's
own shell with a locked body:
card `margin 20`, fill `#1A2942`, radius 18, padding 28, centred, **2pt border `#FDB022`**:
**👑** 56pt bottom margin 12 · **"Premium Feature"** 20pt bold `#FDB022` bottom margin 10 · body
14pt `#B0C4DE` centred line-height 22 bottom margin 20 · button fill `#FDB022`, `h 24 / v 14`,
radius 12, **"See What You Get"** 15pt bold `#0F1A2E`.

Bodies:
- Opening Trainer: **"Opening Trainer uses Chessable-style spaced repetition to master openings
  like Caro-Kann, Sicilian, and 20+ more. Subscribe to unlock."**
- Tutorial Videos: **"Mag-subscribe muna para ma-access ang tutorial videos."** with the sub-line
  **"Unlock every lesson from FM Deniel."**

Delete the shared `UpgradePrompt` modal, its **"Upgrade to Premium — ₱99"** hard-coded price, its
**"🔄 Free limits reset daily at midnight"** note, and **"Maybe Later"**.

### 3.4 Alerts

| Trigger | Title | Body |
|---|---|---|
| Purchase succeeded | **"You're subscribed!"** | **"Opening Trainer and Tutorial Videos are now unlocked. Enjoy!"** |
| One-time purchase succeeded | **"Thank you!"** | **"The full app is unlocked on this Apple ID, forever."** |
| Purchase failed | **"Purchase Failed"** | the StoreKit error, else **"Something went wrong. Please try again."** |
| Restore found something | **"Restored!"** | **"Your purchases have been restored."** |
| Restore found nothing | **"Nothing to Restore"** | **"We couldn't find a purchase linked to this Apple ID."** |
| Products unavailable | **"Store Unavailable"** | **"We couldn't reach the App Store. Check your connection and try again."** |

User-cancelled purchases show **nothing** — no alert, no toast.

---

## PHASE 4 — Opening Trainer (subscription · online content, offline training)

Chessable-style spaced repetition. Content is downloaded from the bucket once per repertoire; all
scheduling, all progress and all training then run on-device.

### 4.1 Content pack format (what you publish to the bucket)

```
https://content.biyaherongchesscoach.com/
  openings/
    index.json                       ← the catalogue, ~8 KB
    caro-kann-classical.json         ← one pack per repertoire, 5–40 KB
    sicilian-najdorf.json
    …
```

`index.json`:
```json
{ "version": 3,
  "updated": "2026-08-11",
  "repertoires": [
    { "slug": "caro-kann-classical", "name": "Caro-Kann Defense: Classical",
      "eco": "B18", "color": "black", "coverColor": "#3F51B5",
      "description": "Solid Black defense against 1.e4. …",
      "variations": 1, "positions": 8, "bytes": 4120, "sha256": "…" } ] }
```

A pack:
```json
{ "slug": "caro-kann-classical", "version": 3,
  "lines": [ { "name": "Main Line", "moveSequence": "e4 c6 d4 d5 …", "plyCount": 16 } ],
  "positions": [
    { "id": 1, "fen": "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
      "fenHash": "…", "moveToPlayUci": "c7c6", "moveToPlaySan": "c6",
      "opponentReplyUci": "d2d4", "opponentReplySan": "d4",
      "nextPositionId": 2, "depth": 1, "comment": null } ] }
```

`fen` is the **4-field normalised FEN** (board, side to move, castling, en-passant) of the position
*before* the user's move, and `fenHash = sha256(fen)` — the dedup key within a repertoire.
`depth` is the 0-indexed ply of the user's move.

**Ship the 22 curated packs generated from the existing seeder**, plus `index.json`, and serve them
with a long `Cache-Control` and an ETag. Total size is a few hundred kilobytes; there is no reason
for an API.

### 4.2 Download & cache

```swift
actor ContentClient {
    func fetchIndex(force: Bool = false) async throws -> OpeningIndex
    func fetchPack(_ slug: String) async throws -> OpeningPack
}
```
- Cache `index.json` for **24 h**; refresh on pull-to-refresh or when a pack 404s.
- Store packs in `Application Support/Content/openings/{slug}.json`, excluded from backup.
- Verify `sha256` before accepting a pack; on mismatch, delete and retry once, then surface
  **"Couldn't verify the download. Please try again."**
- **A downloaded pack is permanently usable offline.** Only *acquiring* a new repertoire needs
  internet — which is exactly what was agreed.
- Show a download state per repertoire card: `.notDownloaded` → a `⬇` glyph; `.downloading` →
  a determinate ring; `.ready` → nothing; `.updateAvailable` (pack `version` bumped) → a small
  gold dot.

### 4.3 SwiftData models

```swift
@Model final class OpeningRepertoire {          // mirrors a downloaded pack
    var slug: String                            // unique
    var name: String, eco: String?, color: PieceColor
    var summary: String?
    var source: RepertoireSource                // .curated | .user
    var coverColor: String?
    var variationsCount = 0, totalPositions = 0
    var packVersion = 0
    var downloadedAt: Date?
    @Relationship(deleteRule: .cascade) var positions: [OpeningPosition]
    @Relationship(deleteRule: .cascade) var lines: [OpeningLine]
}
@Model final class OpeningPosition {
    var fen: String, fenHash: String            // unique within a repertoire
    var moveToPlayUci: String, moveToPlaySan: String
    var opponentReplyUci: String?, opponentReplySan: String?
    var nextPositionId: UUID?
    var depth: Int = 0
    var comment: String?
}
@Model final class OpeningProgress {            // one per (repertoire, position)
    var easeFactor: Double = 2.50
    var intervalDays = 0, repetitions = 0, lapses = 0
    var lastGrade: Int?
    var nextReviewAt: Date?, lastReviewedAt: Date?
    var status: CardStatus                      // .new | .learning | .review | .mastered
}
@Model final class OpeningSession {             // one per repertoire
    var pendingPositionId: UUID?
    var newCardsToday = 0
    var newCardsDate: Date?
}
```

`user_opening_progress`, `user_opening_sessions`, the `user_id` on everything, the
`opening_line_positions` join table and `parent_line_id` (never written by any code) all go away.

### 4.4 SM-2 — exact

```swift
let MAX_NEW_PER_DAY = 10
let FAST_THRESHOLD: TimeInterval = 8.0

func grade(correct: Bool, hintUsed: Bool, elapsed: TimeInterval?) -> Int {
    if !correct { return 1 }
    if hintUsed { return 3 }
    if let t = elapsed, t <= FAST_THRESHOLD { return 5 }
    return 4
}

func apply(_ p: inout OpeningProgress, quality q: Int) {
    let q = max(0, min(5, q))
    if q < 3 {                                   // FAIL
        p.repetitions = 0
        p.intervalDays = 0
        p.lapses += 1
        p.status = .learning
    } else {                                     // PASS
        p.repetitions += 1
        switch p.repetitions {
        case 1:  p.intervalDays = 1
        case 2:  p.intervalDays = 6
        default: p.intervalDays = Int(ceil(Double(p.intervalDays) * p.easeFactor)) // OLD ease
        }
        p.status = p.repetitions >= 4 ? .mastered : .review
    }
    // ease updated AFTER the interval, for BOTH branches
    let newEase = p.easeFactor + (0.1 - Double(5 - q) * (0.08 + Double(5 - q) * 0.02))
    p.easeFactor = max(1.30, (newEase * 100).rounded() / 100)

    p.nextReviewAt = q < 3
        ? Date().addingTimeInterval(10 * 60)
        : Calendar.current.date(byAdding: .day, value: max(1, p.intervalDays), to: Date())
    p.lastGrade = q
    p.lastReviewedAt = Date()
}
```

Ease deltas: **q5 → +0.10 · q4 → ±0.00 · q3 → −0.14 · q2 → −0.32 · q1 → −0.54 · q0 → −0.80.**
Floor 1.30, 2 decimal places, no ceiling. Initial ease 2.50.
Interval ladder for a perfect card: **1 d → 6 d → ceil(6 × EF) → ceil(prev × EF) …**
Status: `.new` on creation → `.review` after the first pass → `.mastered` at 4 consecutive passes.
A failure resets repetitions and interval to 0, sets `.learning`, and schedules **+10 minutes**.
Mastered cards still re-enter the due queue.

> **Two fixes.** (a) **Reset the attempt timer after a wrong answer.** The RN trainer only reset
> `positionStartedAt` when a *new* card was loaded, so every retry blew past the 8-second threshold
> and scored 4 instead of 5. (b) **Only grade the first attempt on a card per session.** Today every
> wrong guess re-runs `apply(1)` — `lapses += 1` and **−0.54 ease each time** — so three wrong
> guesses drop a card from 2.50 to the 1.30 floor permanently. Grade once, then let the user retry
> freely until they get it.
>
> Also: implement the **hint** path (grade 3). It exists in the algorithm and is unreachable in the
> app because the client hard-codes `hint_used: false`. A "Show me" button that reveals the piece
> to move (not the destination) is worth building.

### 4.5 Queue and the pending lock

```
nextCard(repertoire):
  1. due review  → OpeningProgress where status ∈ {learning, review, mastered}
                   and nextReviewAt <= now, ordered by nextReviewAt ascending, first
  2. else new    → reset the daily counter if the LOCAL calendar day rolled over;
                   if newCardsToday >= 10 → nil
                   else the lowest-`depth` position with no progress row
  3. else nil
```
`session.pendingPositionId` is set when a card is served and cleared **only on a correct answer**.
A wrong answer leaves the same card locked, so a hard position cannot be rerolled by leaving and
coming back. This is the same anti-reroll mechanism as the Puzzle Streak's pending puzzle.

The daily new-card budget is consumed when a progress row is first created, **not** at lock time.

> Use `Calendar.current.startOfDay(for:)` for the daily reset. The server used `Carbon::today()`
> with `app.timezone = 'UTC'`, so the "daily" new-card allowance reset at **08:00 Manila time**.

### 4.6 Screen — Openings hub

Header: back `←` 24pt · **"Openings"** 20pt bold · 40pt spacer.
Tab row (`h 16`, bottom 16, gap 8): two equal tabs, `v 12`, fill `#1A2942`, radius 12, 1pt border
transparent → `#FDB022` with fill `rgba(253,176,34,0.12)` when active; text 14pt weight 600
`#8BA3C7` → `#FDB022`. Labels **"Trainer"** and **"My Tree"** (the second hands off to the legacy
opening-tree screen).

Body states: **locked** (3.3) · **loading** (centred gold spinner) · **error** (text 14pt
`#F87171` — **"Couldn't load repertoires."** / **"Network error. Please try again."** — plus a
**"Retry"** button fill `#FDB022`, `h 18 / v 10`, radius 10, 14pt weight 700 `#0F1A2E`) ·
**catalogue**.

Catalogue (`h 16`, top 4, pull-to-refresh, tint `#FDB022`):
- Row above the list: **`{n} repertoires`** 13pt `#8BA3C7` on the left; on the right a button fill
  `#1A2942`, `h 14 / v 8`, radius 10, 1pt border `#FDB022`, **"+ Upload PGN"** 13pt weight 700
  `#FDB022`.
- Card: fill `#1A2942`, radius 14, padding 16, bottom margin 12, **4pt leading border** in
  `coverColor` (default `#00BFA5`).
  - Header row: name 16pt weight 700 `#FFFFFF`; a **"YOUR PGN"** badge for user packs — fill
    `rgba(0,191,165,0.15)`, `h 8 / v 2`, radius 6, 10pt weight 700 `#00BFA5` letter-spacing 0.5;
    trailing colour pill `h 10 / v 4`, radius 12 — white: fill `#F5F5F5`, text **`♔ White`** 11pt
    weight 700 `#1A1A1A`; black: fill `#2A2A2A`, text **`♚ Black`** 11pt weight 700 `#F5F5F5`.
  - **`ECO: {eco}`** 11pt weight 600 `#FDB022` letter-spacing 0.5 bottom margin 6.
  - Description, 2 lines, 13pt `#B0C4DE` line-height 18 bottom margin 10.
  - Progress strip fill `rgba(255,255,255,0.04)`, radius 8, `h 10 / v 6`, text 11pt `#8BA3C7`:
    **`✓ {mastered} mastered · 🔄 {due} due · {new} new`**.
  - Download affordance per 4.2.
- Empty: **"No repertoires available yet."** 13pt `#8BA3C7`.

> **Fix the free-user dead end.** The RN hub swallowed the server's 403 (`setRepertoires([])`, no
> error, no paywall) while the lock branch read a *stale cached* premium flag, so an expired
> subscriber saw "No repertoires available yet." with no explanation and no way to subscribe.
> With on-device entitlement there is one source of truth, so this state cannot occur — but make
> the locked branch key off `StoreService.entitlements`, never a cached copy.

### 4.7 Screen — Repertoire dashboard

Header: back `←` · the repertoire name, centred, 18pt bold, one line · 40pt spacer.
**Hero card** fill `#1A2942`, radius 14, padding 16, bottom margin 16, **4pt leading border in
`coverColor`** (the RN screen hard-coded `#00BFA5` here and ignored the pack's colour):
pill row (gap 8, wrapping, bottom margin 12) with the colour pill (12pt), an ECO pill fill
`rgba(253,176,34,0.15)` text **`ECO {eco}`** 11pt weight 700 `#FDB022`, and for user packs a pill
fill `rgba(0,191,165,0.15)` text **"YOUR UPLOAD"** 10pt weight 700 `#00BFA5`; then the description
14pt `#B0C4DE` line-height 21.

**Stats grid** — row, gap 8, bottom margin 20, four equal boxes radius 12 padding 14 centred;
value 22pt bold, label 11pt `#8BA3C7` top margin 4:

| Box | Fill | Value colour | Label |
|---|---|---|---|
| 1 | `rgba(76,175,80,0.12)` | `#4CAF50` | **"Mastered"** |
| 2 | `rgba(253,176,34,0.12)` | `#FDB022` | **"Due Today"** |
| 3 | `rgba(33,150,243,0.12)` | `#2196F3` | **"Learning"** |
| 4 | `rgba(139,163,199,0.12)` | `#8BA3C7` | **"New"** |

**CTA** fill `#FDB022`, `v 18`, radius 14, bottom margin 24, shadow `#FDB022` `(0,4)` 0.3/8,
label **"▶ Train Now"** 18pt bold `#0F1A2E`.

**Lines section**: title **`Lines ({n})`** 16pt weight 700 bottom margin 10; per line a card fill
`#1A2942`, radius 10, padding 12, bottom margin 8 — name 14pt weight 600 `#FFFFFF`, the move
sequence 12pt `#8BA3C7` monospaced max 3 lines, and **`{n} plies`** 11pt `#FDB022`.

**Delete** (user packs only): outlined button top margin 16, `v 14`, radius 12, 1pt border
`#F87171`, label **"Delete This Repertoire"** / **"Deleting…"** 14pt weight 600 `#F87171`.
Dialog: **"Delete Repertoire"** /
**`Permanently delete "{name}" and all your progress on it? This can't be undone.`** /
**"Cancel"** · **"Delete"** (destructive).
For curated packs, offer **"Remove Download"** instead — frees the disk, keeps the progress.

### 4.8 Screen — Trainer

`OPPONENT_DELAY = 600 ms`.

Header: back `←` · **"Train"** 18pt bold · a trailing stat 13pt weight 600 `#FDB022` min-width 60
right-aligned: **`✓{mastered}  🔄{due}`** (two spaces).

**Empty panel** (`flex 1`, centred, padding 32): **✓** 64pt `#4CAF50` bottom margin 16 ·
**"All done for now!"** 22pt bold `#FFFFFF` · message 14pt `#B0C4DE` centred line-height 22 bottom
margin 24 — either **`All caught up! Next review unlocks {relative time}.`** (use
`RelativeDateTimeFormatter` — "in 4 hours" beats a raw timestamp) or
**"All caught up! No new positions today (10/day cap reached)."** · button fill `#FDB022`,
`h 24 / v 14`, radius 12, **"Back to Repertoire"** 15pt bold `#0F1A2E`.

**Comment bar** when a position carries a comment: `h 16` margins, bottom 8, fill
`rgba(253,176,34,0.08)`, radius 10, padding 10, **3pt leading border `#FDB022`**, text 13pt
`#FDB022` line-height 18.
> This is dead UI today: `PgnImportService.tokenizeMoves` strips `{…}` comments *before* parsing
> and nothing ever writes the column, so `comment` is always null — while the upload screen tells
> users "Headers and comments are kept". **Keep the comments** during import (Phase 4.9) and this
> bar becomes the feature it was meant to be.

**Board**: `userColor = position.colorToMove`, disabled while submitting or after a correct answer.
Wrong-answer highlights: from-square `rgba(76,175,80,0.55)`, to-square `rgba(76,175,80,0.85)`.
The trainer draws **its own** promotion overlay: scrim `rgba(0,0,0,0.7)`, card fill `#1A2942`,
radius 18, padding 24, 2pt border `#FDB022`, title **"Promote to:"** 16pt weight 600 bottom margin
16, a row of four 56×56 buttons (fill `#0F1A2E`, radius 12) with glyphs **♕ ♖ ♗ ♘** 32pt `#FFFFFF`.
Use the shared board's promotion dialog instead and delete this duplicate.

**Bottom bar** (padding 20, centred):
- Idle: **`{White|Black} to move — make your move`** 14pt `#B0C4DE`.
- Correct: **`✓ Correct! {san}`** 16pt weight 700 `#4CAF50` centred bottom margin 12.
- Wrong: **`✗ Wrong — expected {san}`** 16pt weight 700 `#F87171`, then a button fill `#FDB022`,
  `h 32 / v 12`, radius 12, **"Try Again"** 15pt bold `#0F1A2E`.

**Flow:** apply the move locally; illegal → ignore silently. Correct with an opponent reply → play
the reply after **600 ms**, then load the next card **600 ms** later. Correct with no reply → next
card after **400 ms**. Wrong → undo after **800 ms**, card stays locked.

### 4.9 PGN import — on-device

Port `PgnImportService` and `ChessEngine` to Swift. Limits, kept as-is:
**max 256 KB · max 50 lines · max 500 positions · max depth 40 moves (80 plies).**

Tokenizer, in order: strip `{…}` comments → strip `(…)` variations, repeating until no parentheses
remain → strip `$n` NAGs → strip move numbers `\d+\.+` → strip results `1-0`, `0-1`, `1/2-1/2`,
`*` → split on whitespace. Line name = the `Variation` header, else `Opening`, else `Event`, else
`Main Line`, truncated to 160 characters.

Walk: for ply index `i` (0-based), the move is the user's when
`userIsWhite ? (i % 2 == 0) : (i % 2 == 1)`. Dedup key = `sha256(normalised FEN before the move)`
within the repertoire. First line to reach a position wins its stored move.

**Six fixes:**
1. **Keep comments** instead of discarding them, and store them on the position (4.8).
2. **Make the whole import atomic.** The repertoire row is created *outside* the transaction, so
   any validation failure leaves a permanent `totalPositions == 0` repertoire in the catalogue.
3. **Warn on transposition conflicts.** When two lines reach the same FEN with *different* user
   replies, the second is silently dropped. Report **`{n} conflicting positions were skipped`**.
4. Fix the message **`Repertoire exceeds {actualCount} positions (max 500)`** — it prints the count
   where the limit reads naturally.
5. Make the client and the parser agree on size. The RN screen measured UTF-16 length while the
   server measured bytes, so multi-byte annotations passed the client check and failed the import.
6. **Never surface a raw exception.** The controller returned `$e->getMessage()` straight to the
   client, leaking SQL, table names and file paths on something as ordinary as a slug collision.

**Also validate legality.** The PHP `ChessEngine` is pseudo-legal only: it never tests a
single-candidate move for self-check and **never validates castling at all** — `O-O` blindly moves
e1→g1 and h1→f1 regardless of rights, path or checks. Since you already have a real, tested move
generator for the Analysis Board, use it here and reject illegal PGN properly.

**Upload screen**: header back `←` · **"Upload PGN"** 18pt bold · 40pt spacer. Content padding 16.
Labels 14pt weight 600 `#FFFFFF` bottom margin 6 top margin 12.
- **"Repertoire Name"** → field fill `#1A2942`, radius 10, `h 14 / v 12`, 14pt `#FFFFFF`, 1pt
  border `rgba(253,176,34,0.1)`, placeholder **`e.g. My Caro-Kann Repertoire`** in `#5C7290`,
  max 120.
- **"Side You Play"** → two buttons (`flex 1`, `v 14`, radius 12, fill `#1A2942`, 2pt border
  transparent), **`♔ White`** / **`♚ Black`**; active white → border `#F5F5F5`, fill
  `rgba(245,245,245,0.08)`; active black → border `#FDB022`, fill `rgba(253,176,34,0.08)`.
  Default white.
- **"PGN"** → helper 12pt `#8BA3C7` line-height 18:
  **"Paste mainline PGN below. Comments are kept; variations and NAGs are skipped."**
  *(corrected — the original claimed comments were kept and then deleted them)*.
  Editor: same chrome, min-height 200, monospaced, top-aligned, placeholder:
  ```
  [Event "My Custom Caro-Kann"]

  1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 *
  ```
- Limits box fill `rgba(33,150,243,0.08)`, radius 10, padding 12, top margin 16, **3pt leading
  border `#2196F3`**; title **"Limits"** 12pt weight 700 `#2196F3`; lines 12pt `#8BA3C7`
  line-height 18: **"• Max file size: 256 KB"**, **"• Max positions: 500"**,
  **"• Max lines: 50"**, **"• Max depth: 40 moves"**. Drop **"• Rate limit: 5 uploads / hour"** —
  there is no server to rate-limit.
- Submit top margin 24, fill `#FDB022`, `v 16`, radius 14, **"Import Repertoire"** 16pt bold
  `#0F1A2E`; while working, opacity 0.6 + spinner.

Alerts: **"Missing Name"** / **"Please enter a name for your repertoire."** ·
**"Missing PGN"** / **"Please paste your PGN text."** ·
**"PGN Too Large"** / **"Maximum size is 256 KB."** ·
**"Import Failed"** / the parser's own message ·
**"Repertoire Imported!"** / **`"{name}" is ready to train.`** with a single
**"Start Training"** button.

### 4.10 The 22 curated repertoires

| # | slug | name | ECO | Side | Cover | Line | Moves |
|---|---|---|---|---|---|---|---|
| 1 | `caro-kann-classical` | Caro-Kann Defense: Classical | B18 | black | `#3F51B5` | Main Line | `1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 5.Ng3 Bg6 6.h4 h6 7.Nf3 Nd7 8.h5 Bh7` |
| 2 | `caro-kann-advance` | Caro-Kann Defense: Advance Variation | B12 | black | `#3F51B5` | Short System | `1.e4 c6 2.d4 d5 3.e5 Bf5 4.Nf3 e6 5.Be2 Nd7 6.O-O Ne7 7.c3` |
| 3 | `sicilian-najdorf` | Sicilian Defense: Najdorf Variation | B90 | black | `#D32F2F` | English Attack | `1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Be3 e5 7.Nb3 Be6 8.f3 Be7` |
| 4 | `sicilian-dragon` | Sicilian Defense: Dragon Variation | B70 | black | `#D32F2F` | Yugoslav Attack | `1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6 6.Be3 Bg7 7.f3 Nc6 8.Qd2 O-O` |
| 5 | `french-winawer` | French Defense: Winawer Variation | C15 | black | `#0288D1` | Main Line | `1.e4 e6 2.d4 d5 3.Nc3 Bb4 4.e5 c5 5.a3 Bxc3+ 6.bxc3 Ne7 7.Qg4 Qc7` |
| 6 | `ruy-lopez-berlin` | Ruy Lopez: Berlin Defense | C65 | black | `#388E3C` | Berlin Wall | `1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.O-O Nxe4 5.d4 Nd6 6.Bxc6 dxc6 7.dxe5 Nf5 8.Qxd8+ Kxd8` |
| 7 | `queens-gambit-declined` | Queen's Gambit Declined: Orthodox | D63 | black | `#7B1FA2` | Orthodox Defense | `1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Be7 5.e3 O-O 6.Nf3 Nbd7 7.Rc1 c6` |
| 8 | `kings-indian-defense` | King's Indian Defense: Classical | E97 | black | `#F57C00` | Mar del Plata | `1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 O-O 6.Be2 e5 7.O-O Nc6 8.d5 Ne7` |
| 9 | `scandinavian-defense` | Scandinavian Defense | B01 | black | `#0288D1` | Main Line | `1.e4 d5 2.exd5 Qxd5 3.Nc3 Qa5 4.d4 Nf6 5.Nf3 c6 6.Bc4 Bf5` |
| 10 | `pirc-defense` | Pirc Defense | B08 | black | `#5D4037` | Classical | `1.e4 d6 2.d4 Nf6 3.Nc3 g6 4.Nf3 Bg7 5.Be2 O-O 6.O-O` |
| 11 | `modern-defense` | Modern Defense | B06 | black | `#5D4037` | Austrian Attack | `1.e4 g6 2.d4 Bg7 3.Nc3 d6 4.f4 a6 5.Nf3 b5` |
| 12 | `alekhine-defense` | Alekhine's Defense | B04 | black | `#5D4037` | Modern | `1.e4 Nf6 2.e5 Nd5 3.d4 d6 4.Nf3 g6 5.Bc4 Nb6 6.Bb3 Bg7` |
| 13 | `nimzo-indian` | Nimzo-Indian Defense | E20 | black | `#7B1FA2` | Rubinstein | `1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.e3 O-O 5.Bd3 d5 6.Nf3 c5` |
| 14 | `slav-defense` | Slav Defense | D10 | black | `#7B1FA2` | Main Line | `1.d4 d5 2.c4 c6 3.Nc3 Nf6 4.Nf3 dxc4 5.a4 Bf5 6.e3 e6` |
| 15 | `grunfeld-defense` | Grünfeld Defense | D80 | black | `#7B1FA2` | Exchange | `1.d4 Nf6 2.c4 g6 3.Nc3 d5 4.cxd5 Nxd5 5.e4 Nxc3 6.bxc3 Bg7 7.Bc4 c5` |
| 16 | `bogo-indian` | Bogo-Indian Defense | E11 | black | `#7B1FA2` | Main Line | `1.d4 Nf6 2.c4 e6 3.Nf3 Bb4+ 4.Bd2 Qe7 5.g3 O-O` |
| 17 | `italian-giuoco-piano` | Italian Game: Giuoco Piano | C50 | white | `#388E3C` | Giuoco Pianissimo | `1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3 d6 6.O-O O-O 7.Re1` |
| 18 | `english-symmetrical` | English Opening: Symmetrical | A30 | white | `#00838F` | Double Fianchetto | `1.c4 c5 2.Nf3 Nf6 3.g3 g6 4.Bg2 Bg7 5.O-O O-O 6.Nc3 Nc6` |
| 19 | `london-system` | London System | D02 | white | `#1976D2` | Main Line | `1.d4 d5 2.Nf3 Nf6 3.Bf4 c5 4.e3 Nc6 5.c3 Qb6 6.Qb3` |
| 20 | `catalan-opening` | Catalan Opening | E00 | white | `#1976D2` | Closed | `1.d4 Nf6 2.c4 e6 3.g3 d5 4.Bg2 Be7 5.Nf3 O-O 6.O-O` |
| 21 | `vienna-game` | Vienna Game | C25 | white | `#388E3C` | Falkbeer | `1.e4 e5 2.Nc3 Nf6 3.Bc4 Nxe4 4.Qh5 Nd6 5.Bb3 Nc6 6.Nb5` |
| 22 | `bishops-opening` | Bishop's Opening | C24 | white | `#388E3C` | Classical | `1.e4 e5 2.Bc4 Nf6 3.d3 c6 4.Nf3 d5 5.Bb3` |

Descriptions, verbatim, in the same order:
1. "Solid Black defense against 1.e4. The classical line leads to a structurally sound position with the bishop developed actively."
2. "When White plays 3.e5, Black responds with the Short System, developing the light-square bishop outside the pawn chain."
3. "The most popular and theory-rich Sicilian variation. 5...a6 prepares ...e5 or ...b5 with great flexibility."
4. "Sharp, aggressive Sicilian with kingside fianchetto. The Dragon bishop on g7 supports a counterattack."
5. "The sharpest French line — Black pins the c3 knight and accepts doubled c-pawns for activity."
6. "Solid Black response to the Spanish — famous as Kramnik's weapon against Kasparov in 2000. Leads to the Berlin endgame."
7. "Classical, solid Black setup against 1.d4. The Orthodox is structurally safe with patient development."
8. "Dynamic counterattacking system. Black accepts a space disadvantage to launch a kingside attack."
9. "Immediate central challenge. Black trades queens early but gets a solid position with clear plans."
10. "Hypermodern setup: Black allows White a big center, planning to undermine it with ...c5 or ...e5."
11. "Flexible Black setup with kingside fianchetto. Delays committing the knights to allow flexible center play."
12. "Provocative — Black invites White to chase the knight, then attacks the over-extended pawns."
13. "One of the most respected Black openings against 1.d4. Pins the c3 knight to control the center."
14. "Solid alternative to the QGD. Black supports d5 with ...c6, keeping the light-square bishop active."
15. "Dynamic hypermodern defense. Black trades the d5 pawn for piece activity and pressure on White's center."
16. "Practical alternative to the Nimzo-Indian. Pins along the e1-a5 diagonal, often leading to a sound structure."
17. "\"Quiet game\" — classical Italian setup with c3 and d3, preparing slow but powerful kingside expansion."
18. "Flexible flank opening. Symmetrical setup can transpose to many structures including reversed Sicilians."
19. "Reliable system opening — White plays d4, Nf3, Bf4, e3, c3 against almost anything. Low theory burden."
20. "A queen's pawn opening with kingside fianchetto. The g2-bishop exerts long-term pressure on Black's queenside."
21. "Old but tricky opening — White develops the queenside knight before the kingside, opening attacking options."
22. "Develops the bishop first to dodge the Petroff Defense, often transposing into Italian Game territory."

**16 of 22 are Black repertoires and only 6 are White.** Worth rebalancing before you publish the
packs — a White-only player currently has almost nothing to train.

### 4.11 Strings — Opening Trainer

`Openings` · `Trainer` · `My Tree` · `{n} repertoires` · `+ Upload PGN` · `YOUR PGN` ·
`♔ White` · `♚ Black` · `ECO: {eco}` · `ECO {eco}` · `✓ {n} mastered · 🔄 {n} due · {n} new` ·
`No repertoires available yet.` · `Couldn't load repertoires.` · `Network error. Please try again.` ·
`Retry` · `YOUR UPLOAD` · `Mastered` · `Due Today` · `Learning` · `New` · `▶ Train Now` ·
`Lines ({n})` · `{n} plies` · `Delete This Repertoire` · `Deleting…` · `Remove Download` ·
`Delete Repertoire` · `Permanently delete "{name}" and all your progress on it? This can't be undone.` ·
`Cancel` · `Delete` · `Train` · `✓{n}  🔄{n}` · `All done for now!` ·
`All caught up! Next review unlocks {when}.` ·
`All caught up! No new positions today (10/day cap reached).` · `Back to Repertoire` ·
`{colour} to move — make your move` · `✓ Correct! {san}` · `✗ Wrong — expected {san}` ·
`Try Again` · `Promote to:` · `Upload PGN` · `Repertoire Name` · `e.g. My Caro-Kann Repertoire` ·
`Side You Play` · `PGN` · `Paste mainline PGN below. Comments are kept; variations and NAGs are skipped.` ·
`Limits` · `• Max file size: 256 KB` · `• Max positions: 500` · `• Max lines: 50` ·
`• Max depth: 40 moves` · `Import Repertoire` · `Missing Name` ·
`Please enter a name for your repertoire.` · `Missing PGN` · `Please paste your PGN text.` ·
`PGN Too Large` · `Maximum size is 256 KB.` · `Import Failed` · `Repertoire Imported!` ·
`"{name}" is ready to train.` · `Start Training` · `{n} conflicting positions were skipped` ·
`Couldn't verify the download. Please try again.`

**Deleted:** `Premium Required` · `Upgrade to Premium to upload custom repertoires.` ·
`Rate Limit` · `You can upload up to 5 PGN files per hour. Please wait and try again.` ·
`• Rate limit: 5 uploads / hour` · `Could not start training.` · `Could not load repertoire.` ·
`Could not submit move.` · `Submitted position does not match the locked card.` ·
`Position not found.` · `Repertoire not found.` · `Opening Trainer is a Premium feature.`

---

## PHASE 5 — Tutorial Videos (subscription · streaming)

### 5.1 Manifest

```
https://content.biyaherongchesscoach.com/videos/index.json
```
```json
{ "version": 12, "updated": "2026-08-11",
  "videos": [
    { "id": "e3f1", "title": "The London System in 10 Minutes",
      "description": "…", "category": "Opening", "sortOrder": 1,
      "durationSeconds": 612, "publishedAt": "2026-03-14",
      "hls": "https://…/e3f1/master.m3u8",
      "mp4": "https://…/e3f1/720p.mp4",
      "poster": "https://…/e3f1/poster.jpg" } ] }
```

Cache the manifest for 6 hours; refresh on pull-to-refresh.

**Two things the current setup gets wrong that you should fix while rebuilding:**
1. `GET /api/tutorial-videos` has **no premium check at all** — any authenticated free user
   receives the full list including the video URLs. The paywall is client-side only.
2. Videos are served as **permanent, unsigned public URLs** (`Storage::url()` over a public R2
   bucket), so a single leaked link is downloadable by anyone, forever, logged in or not, and
   nothing revokes access when a subscription lapses.

**Recommended:** serve the manifest and the media through **signed URLs with a short TTL**
(Cloudflare Signed URLs or CloudFront signed cookies), minted by a tiny edge worker that checks a
StoreKit **App Store Server API** transaction lookup. That is the one place a few lines of
server-side code genuinely earn their keep — it is stateless, free at this scale, and it is what
stops your paid content from being a public download.
If you want to ship without even that: gate on-device, use unguessable paths, and accept that a
determined user can share links. Say so explicitly in the decision log rather than discovering it
later.

**Encode HLS**, not progressive MP4. `AVPlayer` handles adaptive bitrate natively; the current
setup downloads a single-rate MP4 over plain HTTP, which is why buffering on Philippine mobile data
is rough. Keep an MP4 fallback in the manifest.

### 5.2 List screen

`THUMB_W = 90`, `THUMB_H = 160` (9:16).
`CATEGORY_ORDER = [Opening, Middlegame, Endgame, General, Uncategorized]`.

| Category | Accent | Chip fill | Icon |
|---|---|---|---|
| Opening | `#7BB3F0` | `#1D3461` | 📖 |
| Middlegame | `#A78BFA` | `#2D1B69` | ⚔️ |
| Endgame | `#FDB022` | `#3B2200` | 👑 |
| General | `#5CC264` | `#1A3320` | ♟️ |
| Uncategorized | `#8BA3C7` | `#1A2942` | 📂 |

> Fold **any** unrecognised category string into `Uncategorized`. The RN grouping filtered to the
> fixed list, so a legacy row with any other category vanished from the list entirely — only `null`
> became Uncategorized.

**Header** (row, space-between, `h 16 / v 12`, 1pt bottom border `#1A2942`): back `←` 26pt in a
40×40 target · **"Tutorial Videos"** 18pt bold · `AppLogo(30)`.

**Locked**: the Phase 3.3 card with the Tutorial Videos body.
**Loading**: gold spinner + **"Loading videos..."** 14pt `#8BA3C7` top margin 12.
**Empty**: **🎬** 48pt · **"No Videos Yet"** 22pt bold `#FFFFFF` ·
**"Tutorial videos will appear here once available."** 14pt `#8BA3C7` centred.

**List** (`h 16`, top 12, bottom 28, pull-to-refresh):
- Section header (row, top margin 20, bottom 10, gap 8): a 3×18 accent bar radius 2 · title
  **`{icon}  {Category}`** (two spaces) 15pt weight 700 in the accent · count **`{n} video`** /
  **`{n} videos`** 11pt weight 500 `#5A7A9A`.
- Card (row, fill `#162136`, radius 14, clipped, bottom margin 10, 1pt border
  `rgba(255,255,255,0.05)`, shadow black 0.2 `(0,2)` 4):
  - Thumb 90×160, fill `#0D1520`, poster image `.scaledToFill()`.
    **Never mount a video view as a poster fallback** — the RN list did exactly that for
    thumbnail-less rows, so memory and bandwidth grew with the list length. Use a placeholder
    glyph.
  - Play overlay: full-cover scrim `rgba(0,0,0,0.28)` with a 36×36 circle
    `rgba(253,176,34,0.92)` and **▶** 14pt `#FFFFFF` (leading margin 2).
  - Info (`flex 1`, padding 12, gap 6): category chip (`h 8 / v 3`, radius 6, meta fill, text
    **`{icon} {category}`** 10pt weight 700 letter-spacing 0.3 in the accent); title max 3 lines
    14pt weight 700 `#FFFFFF` line-height 19; description max 2 lines 12pt `#7A9AB8` line-height
    17; then a footer row with the duration **`{m}:{ss}`** and the date, 10pt `#4A6A8A` top
    margin 2, formatted with `Calendar.current`.
  - **Watch-progress bar** — new: a 3pt track at the bottom of the thumbnail, fill
    `rgba(255,255,255,0.2)`, with a `#FDB022` fill at `watched / duration`, plus a **✓** badge when
    the video is finished. The data already exists locally and is never surfaced.

### 5.3 Player screen

Root black. `AVPlayer` in an `AVPlayerViewController` (or `VideoPlayer`) — you get scrubbing,
AirPlay, PiP, background audio, captions and the Now Playing controls for free, all of which the
hand-rolled RN control bar lacks.

Keep the custom chrome only if you want the exact look:
- **Top bar**: `paddingTop = safeArea + 8`, `h 12`, bottom 12, gap 8, fill `rgba(0,0,0,0.55)`;
  back circle 40×40 radius 20 `rgba(255,255,255,0.15)` with `←` 22pt bold `#FFFFFF`; title
  `flex 1` 15pt weight 600 max 2 lines; fullscreen circle with `expand`/`contract`.
- **Bottom bar**: fill `rgba(15,26,46,0.92)`, `h 16`, top 12, `bottom = safeArea + 8`, gap 6, 1pt
  top border `rgba(255,255,255,0.08)`.
  - Seek row: left time 12pt `#8BA3C7` min-width 38, `M:SS`, monospaced digits; track height 4
    radius 2 `rgba(255,255,255,0.25)` with a `#FDB022` fill and a 14×14 radius 7 `#FDB022` thumb
    (shadow `#FDB022` 0.7 radius 4); right time right-aligned.
  - Buttons row (centred, gap 24, `v 4`): **⏪** 26pt with the label **"10s"** 11pt `#8BA3C7`, a
    56×56 radius 28 `#FDB022` play/pause circle with **⏸**/**▶** 24pt `#0F1A2E`, then **⏩** /
    **"10s"**. Seek ±10 s clamped to the duration.
- Controls auto-hide **2,000 ms** after the last interaction; fade out 350 ms, in 200 ms.

Orientation: portrait-locked by default; the fullscreen toggle switches to landscape and back.

**Add the three things the current player is missing:** an error state (a 403 or 404 currently
shows a black screen with working controls and a 0:00 duration), a playback-speed control
(0.75× / 1× / 1.25× / 1.5× — genuinely useful for lessons), and a **"Save for offline"** action.

### 5.4 Watch state

```swift
@Model final class VideoProgress {
    var videoId: String        // the manifest id — NOT the URL
    var positionSeconds: Double
    var completed: Bool
    var updatedAt: Date
}
```
- Adopt a saved position only when it is > 5 s and more than 10 s from the end; otherwise start
  fresh and clear it.
- Write every 5 s of playback, and on pause, background and dismissal.
- Mark `completed` at 95 % (not only on `didJustFinish`, which never fires if the user leaves at
  99 %).

> **Fix:** key on the stable `videoId`. The RN app keyed on the full video URL, so re-uploading a
> lesson produced a new S3 key, a new URL, and an orphaned progress entry that was never garbage
> collected. Prune rows whose id is absent from the manifest.

### 5.5 Offline downloads

`AVAssetDownloadTask` for HLS. Store under `Application Support/Videos/{id}/`, excluded from
backup. Per-video states: `.streaming` · `.downloading(progress)` · `.downloaded(bytes)`.
Show total usage and a **"Remove All Downloads"** action in Settings.
When the subscription lapses, keep the files but gate playback behind the paywall, and offer to
delete them.

### 5.6 Strings — Tutorial Videos

`Tutorial Videos` · `Loading videos...` · `No Videos Yet` ·
`Tutorial videos will appear here once available.` · `Opening` · `Middlegame` · `Endgame` ·
`General` · `Uncategorized` · `{n} video` · `{n} videos` · `10s` · `Save for offline` ·
`Downloading… {n}%` · `Downloaded` · `Remove Download` · `Remove All Downloads` ·
`Playback Speed` · `Video unavailable.` ·
`This video couldn't be played. Check your connection and try again.` ·
`Mag-subscribe muna para ma-access ang tutorial videos.` ·
`Unlock every lesson from FM Deniel.` · `Subscribe Now`

---

## PHASE 6 — Content publishing pipeline

A build step you run on your machine, not app code.

1. **Export the 22 curated packs.** Run the existing `OpeningRepertoireSeeder` PGN through the
   Swift importer (Phase 4.9) and emit one JSON pack per repertoire plus `index.json`. Log the
   position count per repertoire and diff it against the table in 4.10 — it is your regression
   test for the parser.
2. **Encode the videos** to HLS (1080p / 720p / 480p ladder + audio-only), generate 9:16 posters,
   and write `videos/index.json`.
3. **Upload** to R2/S3 with `Cache-Control: public, max-age=31536000, immutable` for the media and
   `max-age=300` for the two `index.json` files, so a content update is live within five minutes.
4. **Bump `version`** in each index on every publish. The app compares versions to show the
   "update available" dot on a downloaded pack.
5. **Never delete a pack that clients may have downloaded** — mark it `"retired": true` in the
   index instead, so existing owners keep training it.

---

## PHASE 7 — Deliberate fixes

Real defects found in the shipping app. Each is a decision, not an oversight — implement the fix.

### Pairing Manager
| # | Bug | Fix |
|---|---|---|
| 1 | `seed = currentCount + 1` and no re-seed on removal → duplicate seeds; the round-robin circle sorts by seed, so the schedule silently degrades | Monotonic counter, renumber densely on removal during setup |
| 2 | Buchholz / Sonneborn-Berger stored in **integer** columns → 7.5 written as 8, tie-breaks collide | Store as `Double`, round only for display |
| 3 | `score` cast `decimal:1` → JSON string vs a `number` TS interface → the standings share text printed **`1.0.0`** | `Double` everywhere; format as `1`, `1½` |
| 4 | Rounds 2+ pair adjacent players in the global ranking, not top-half vs bottom-half in each score group | Proper Dutch (1.7) |
| 5 | No float bookkeeping — a player can float down three rounds running | `floatHistory` + the rule in 1.7.6 |
| 6 | Out of legal opponents → `bestMatch = unpaired[0]`, a **silent repeat pairing** | Relaxation ladder; repeats are last and always warned (1.7.7) |
| 7 | Bye on the last board in round 1 and on **board 1** from round 2 | Always the last board |
| 8 | Bye can go to a player from a higher score group | Lowest-ranked bye-less player **in the lowest bracket** |
| 9 | `hasRatings` true if **one** player is rated → an unrated field paired as rated | Require ≥ 50 % rated |
| 10 | Round-robin colours alternate on **board 1 only** | Berger tables; test `|whites − blacks| ≤ 1` |
| 11 | `recalculateTiebreakers` scans **all** pairings including unplayed future rounds → round-robin Buchholz inflated from round 1 | Only decided results count |
| 12 | Round-robin bye points awarded **after** the tie-break pass → stale scores | Award at generation |
| 13 | Three different standings orderings (server 5 keys / payload 2 keys / client 4 keys ignoring direct encounter) | One comparator, used everywhere |
| 14 | Rank 1 gold styling defined and never applied on screen, but applied in the share image | Apply in both |
| 15 | Players tab shows the row index as the "seed" | Show `player.seed` |
| 16 | `sort()` mutates React state arrays in place during render | Sort copies |
| 17 | Results editable after `finished`; `total_rounds` settable below `current_round` | Status is computed, results lock when finished |
| 18 | Delete and remove-player responses never checked — a 422 silently "succeeded" | Confirm before mutating local state |
| 19 | A failed detail fetch leaves a permanent spinner: no error, no retry, no pull-to-refresh | N/A offline, but keep an empty-state for a deleted tournament |
| 20 | Result badge falls through to `½-½` for any unrecognised value | Exhaustive switch |
| 21 | `created_at` rendered from UTC with a local formatter → off-by-one day | Local calendar |
| 22 | Share text embeds `API_BASE_URL` — currently an **ngrok tunnel** | No URL in shared text |
| 23 | No way to clear a mistaken result | "Clear Result" (1.5) |

### Play vs Coach
| # | Bug | Fix |
|---|---|---|
| 24 | Resign has **no confirmation** — one tap ends the game | Confirmation dialog |
| 25 | Resigning or starting a new game does not cancel the in-flight engine request → a **ghost move on a resigned board**, or the old game's position overwriting the new one | One cancellable `Task` (2.12) |
| 26 | Four `setTimeout`s never cleared; they fire after navigation | Structured concurrency |
| 27 | Reviewing does not pause the coach — the engine moves underneath you and you silently end up reviewing an old position | Pause, or pin `reviewIndex` correctly |
| 28 | `handleGameReview`'s dependency list omits `reviewData`, so the Analysis Board **always** receives an empty classification array | Pass the real evaluations |
| 29 | Review modal orders accuracy White/Black but classifications user/opponent — mismatched when you play Black | One orientation |
| 30 | Threefold key includes the en-passant field → real repetitions missed | Three-field key |
| 31 | 50-move and insufficient material collapse into one generic draw string | Distinct strings |
| 32 | Premove: cannot be cancelled, survives game over, no feedback when illegal, always auto-queens | (2.8) |
| 33 | "Continue" with an in-memory game ignores the colour you tapped | (2.6) |
| 34 | `restoreGame` skips the game-start sound and leaves the modal state dirty | Reset fully |
| 35 | `parseInt(levelParam)` returns NaN for a non-numeric deep link → `COACH_DATA[NaN]` → white screen | Validate and default |
| 36 | Move-strip auto-scroll uses a layout cache that is never cleared between games, and runs before the new pair has laid out | `ScrollViewReader` |
| 37 | `⏮` and `◀` have inconsistent disabled rules | Same rule |
| 38 | No audio session configuration → sounds obey the silent switch and duck nothing | `.ambient` + `.mixWithOthers` |
| 39 | `Allow Take Back` is never persisted | Persist it |
| 40 | Engine failure leaves the game permanently stuck — the coach never moves and there is no retry | N/A offline; the engine is local |

### Opening Trainer
| # | Bug | Fix |
|---|---|---|
| 41 | The repertoire row is created **outside** the import transaction → orphaned empty repertoires on any failure | One atomic import |
| 42 | Comments are stripped before parsing, so `comment` is always null while the UI promises otherwise and renders a dead bar | Keep comments |
| 43 | Transposition conflicts silently discard the second line's move | Warn with a count |
| 44 | Every wrong attempt re-grades the card: `lapses += 1` and −0.54 ease each time → 2.50 to the 1.30 floor in three guesses | Grade the first attempt only |
| 45 | The attempt timer is never reset after a wrong answer → retries always score 4, never 5 | Reset on retry |
| 46 | `hint_used` is hard-coded `false`, so grade 3 is unreachable | Build the hint |
| 47 | Daily new-card reset uses UTC → resets at 08:00 Manila | `Calendar.current.startOfDay` |
| 48 | HTTP 403 swallowed into an empty catalogue with no paywall and no explanation | On-device entitlement, explicit lock state |
| 49 | Raw exception text (SQL, table names, paths) returned to the client on import failure | Never surface internals |
| 50 | `ChessEngine` is pseudo-legal: single-candidate moves are never tested for self-check and **castling is never validated at all** | Use the real move generator |
| 51 | `next_review_at` serialised three different ways; one form parses as `Invalid Date` on Hermes | Native `Date` |
| 52 | Client size check in UTF-16 units vs a byte check on the server | One measure |
| 53 | `N+1` — `statsForRepertoire` runs a full fetch per repertoire on the catalogue screen | One aggregate query |
| 54 | Duplicate promotion overlays (the board has one, the trainer draws another) | Use the board's |
| 55 | `stats!` force-unwrap on the empty branch can crash the header | Optional handling |
| 56 | Docs claim `chesslablab/php-chess` and `seeders/data/openings/*.pgn` — neither exists | N/A after the port |

### Tutorial Videos & Subscription
| # | Bug | Fix |
|---|---|---|
| 57 | `GET /api/tutorial-videos` has **no premium check** — free users get every video URL | Signed URLs + on-device gate (5.1) |
| 58 | Videos are permanent unsigned public URLs; nothing revokes access when a subscription lapses | Short-TTL signed URLs |
| 59 | `base_plan_id` is client-supplied with no whitelist → buy monthly, claim **a full year** | No server verification at all |
| 60 | The submitted `transaction_id` is never cross-checked against the receipt → one receipt replayed under many ids | Same |
| 61 | The receipt's `bundle_id` is never validated — **any** Apple receipt containing a product named `monthly`/`yearly_v2` passes | Same |
| 62 | Both restore endpoints `updateOrCreate` on the token/transaction **without an ownership check**, so a valid token transfers the subscription to the caller | Same |
| 63 | `is_premium = true` with zero subscription rows ⇒ premium forever, never re-verified | `Transaction.currentEntitlements` |
| 64 | Apple subscriptions are **never re-verified** — no equivalent of the Google command, no server notifications, no refund handling | StoreKit handles it |
| 65 | `ends_at` ignores the store's real expiry on first write → a monthly purchase one day before period end still grants 30 days | `expirationDate` from the transaction |
| 66 | `original_transaction_id` set to the *current* transaction id, so renewals never link | N/A |
| 67 | `days_remaining` truncates a float → 27.9 days shows "27", under 24 h shows "0" | Round up over calendar days |
| 68 | Dates rendered from UTC with a local formatter → expiry off by a day | Local calendar |
| 69 | Rate limiter counts attempts **before** success, so ten relaunches 429 a legitimate user | N/A |
| 70 | Three different prices shown in one session (₱99 / ₱110 / ₱199) | `Product.displayPrice` only |
| 71 | `POST /subscription/redeem` is referenced by the model, the admin generator, the status handler and both CLAUDE.md files — **and does not exist** | Drop the code system |
| 72 | Conditional hooks in the video player (early return before `useState`/`useEffect`) | N/A |
| 73 | The https-only guard computes `safeVideoUrl` and then plays the **raw** URL anyway | N/A |
| 74 | Watch progress keyed on the full URL → orphaned on re-upload, never pruned | Key on `videoId` |
| 75 | No `onError` on the player | Error state |
| 76 | Unrecognised categories vanish from the list entirely | Fold into Uncategorized |
| 77 | A full video view mounted per thumbnail-less card | Placeholder glyph |
| 78 | `config/api.ts` ships an **ngrok tunnel** as the base URL with production commented out | One content host constant |

---

## PHASE 8 — Acceptance criteria

**Offline half**
1. Pairing Manager and Play vs Coach work fully in Airplane Mode, forever, on a fresh install.
2. Neither module contains a `URLSession`, a `URLRequest`, or a hostname.
3. A Swiss tournament of 5, 6, 7, 12 and 30 players completes every round with **zero repeat
   pairings**, every player's `|whites − blacks| ≤ 1` at the end, no player floats down twice in a
   row, and at most one bye each.
4. Feed the engine a published FIDE Dutch example and match the official pairings.
5. Round robin with 6, 7 and 8 players: every pair meets exactly once, colours balance to ≤ 1, and
   the odd-player bye rotates.
6. Regenerating a round with unchanged data produces byte-identical pairings.
7. Buchholz, Sonneborn-Berger and direct encounter are half-point accurate and the standings sort
   is identical in the table, the share image and the share text.
8. Play vs Coach: each level reaches its configured depth, the randomiser's distribution over 200
   games matches the table in 2.2, and no coach ever replies in under 300 ms.
9. Resigning or starting a new game while the coach is thinking never produces a ghost move.
10. A game review of a 60-move game completes on-device and its classifications reach the Analysis
    Board **non-empty**.

**Online half**
11. With no subscription, Opening Trainer and Tutorial Videos show the lock card — never an empty
    list, never a spinner that never resolves.
12. With a subscription and the radio **off**, a previously downloaded repertoire trains normally,
    with correct SM-2 scheduling.
13. A subscriber who has been offline for 13 days is still unlocked; at 15 days they are asked to
    reconnect.
14. Cancelling in Settings keeps access until the period ends, then locks — with no server involved.
15. A wrong answer keeps the **same** card locked across an app relaunch.
16. Three wrong guesses on one card cost **one** lapse and **one** ease penalty, not three.
17. The daily new-card allowance resets at **local** midnight.
18. Importing the 22 seeder PGNs on-device reproduces the position counts in 4.10 exactly.
19. A video resumes at its saved position, marks complete at 95 %, and survives a re-upload of the
    same lesson.
20. Every price in the app comes from `Product.displayPrice`; no currency symbol is hard-coded.

---

## PHASE 9 — Build order

1. **Phase 3 first** — `StoreService`, `Entitlements`, the paywall, the lock card. Everything else
   depends on it, and StoreKit sandbox testing is slow, so start it early.
2. **`PairingEngine`** as a pure struct with unit tests, before any tournament UI exists. Test it
   against published FIDE examples and against criteria 3–6.
3. Pairing Manager UI: list → create → detail (players → rounds → standings) → modals → share.
4. **Play vs Coach engine layer**: level config, `pickMove`, the opening book, the think-time
   pacer, wired to the existing Stockfish actor.
5. Play vs Coach UI: coach select → colour select → game screen → premove → nav → modals.
6. Offline game review, reusing the Analysis Board's batch analysis.
7. **`ContentClient`** + the pack format + the download cache.
8. On-device PGN importer + move-legality validation (shared with the Analysis Board).
9. SM-2 service with unit tests: the interval ladder, the ease deltas, the 1.30 floor, `mastered`
   at 4, the +10-minute lapse.
10. Opening Trainer UI: hub → dashboard → trainer → upload.
11. Tutorial Videos: manifest → list → `AVPlayer` → watch state → offline downloads.
12. The content pipeline (Phase 6), then a full pass over Phase 7 and Phase 8.

---

# Verification

There is no code to run — this deliverable is the document above. Before using it:

1. **Cross-check the numbers** against their sources:
   `BYAHERONG-COACH-FRONTEND\app\(app)\user\tournaments\{index,create,[id]}.tsx`,
   `…\play-coach\{index,play}.tsx`, `…\openings\{index,upload}.tsx`,
   `…\openings\trainer\[id]\{index,train}.tsx`, `…\tutorial-videos\{index,play}.tsx`,
   `…\premium\index.tsx`, `components\{DragDropChessBoard,UpgradePrompt,EvalGraph}.tsx`,
   `constants\classifications.ts`, `utils\billing.ts`;
   `BYAHERONG-COACH-LARAVEL\app\Http\Controllers\{Tournament,OpeningTrainer,TutorialVideo,SubscriptionApi}Controller.php`,
   `app\Services\{OpeningTrainer,PgnImport,GooglePlay}Service.php`, `app\Services\ChessEngine.php`,
   `database\seeders\OpeningRepertoireSeeder.php`, and the migrations named in each phase.
2. **Confirm the two dead subsystems in `play.tsx`** before trusting Phase 2's removals — grep for
   `setAnnotateMode(true)` and for any JSX reference to `toggleOpeningPanel`. Both should return
   nothing, which is why the Opening Explorer and the annotate mode are dropped.
3. **Confirm `POST /subscription/redeem` does not exist** — grep `routes/api.php` for `redeem`.
   The model, the admin generator and both CLAUDE.md files describe it; the route does not.
4. **Verify the seeder counts** in 4.10 by running the importer over
   `OpeningRepertoireSeeder.php`'s inline PGN — the per-repertoire position count is the parser's
   regression test.
5. Once the Swift build exists, Phase 8 is the real test. Criteria 1–10 need only Airplane Mode;
   11–20 need a StoreKit sandbox subscription and the content bucket.
