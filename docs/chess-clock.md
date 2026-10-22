# Chess Clock

A two-player clock for over-the-board games: two halves facing each other, the top one turned 180°
for the player across the table, and a bar between them. Tap your own half after you move. **Free
for everyone**, works in Airplane Mode, and reached from the Home screen's bottom band.

Added in client round 3 (2026-10-22, version 1.0.11). It is the one feature in the port with **no
original**: the RN app and the Laravel backend have no clock, so there is nothing to extract and no
PHP oracle. The two languages check each other instead (see *How it is tested*).

## What it does

| | |
|---|---|
| **Start** | Before the first press both halves say *Tap to start*. Whoever taps first has just "moved": the **other** clock starts, and that side is White. A chip with the board's own king art and *White* / *Black* appears on each half — not a ♔/♚ font glyph, which the browser drew as an emoji. |
| **Play** | Tap your half after your move. Only the half whose clock is running can end its turn — the waiting half ignores taps, so a double-tap or the opponent's hand cannot end your turn for you. |
| **Moves** | `Moves: N` in each half's corner. The starting tap is not a move. |
| **Bonus** | **Increment** (Fischer) adds N s to the mover after every move and shows `+3s` for 1.2 s. **Delay** (simple / US) does not charge a turn's first N s; unused delay is lost, and a pause does not hand out a fresh one. |
| **Running low** | The running half is green, **amber at 30 s, red at 10 s** — the same thresholds as Puzzle Turbo — and shows tenths (`0:09.8`) for the last ten seconds. It never reads `0:00` with time left: the display rounds up. |
| **Flag** | At zero the half turns red with *⏱ Time's up*; the other shows *🏆 Wins on time*. Taps do nothing until a reset. |
| **Bar** | ✕ close · ↺ reset (asks first if a game is in progress) · ⏸/▶ pause · ⏱ time control · 🔊/🔇 sound. |
| **Time control** | Presets by speed — **Bullet** 1\|0 1\|1 2\|1 · **Blitz** 3\|0 3\|2 5\|0 5\|3 · **Rapid** 10\|0 10\|5 15\|10 20\|0 · **Classical** 30\|0 30\|20 60\|30 90\|30 — or **Custom**: minutes and seconds per player, *Different time per player* for a coach giving odds, and None / Increment / Delay with 1–60 s. *Start* begins a new game on it. |
| **Remembered** | The last control and the sound switch (`biya.clock.v1`). The Home tile names it: *Blitz · 5 \| 3*. Delete-account erases it. |
| **Device** | The screen does not dim while the clock runs, and may again the moment it stops. Leaving the app **pauses** the game. Each tap buzzes and clicks; the start and the flag have their own sounds. |

The speed bands are lichess's: estimated length = base + 40 × bonus; under 3 min is Bullet, under 8
Blitz, under 25 Rapid, the rest Classical. Every preset sits in its own band — that is asserted.

## Where it is on Home

The bottom band is `[⏱️ Chess Clock | ✈️ Premium]`. That band was always built as a pair — Donate on
the left, Membership on the right — and kept Donate's height after Donate was removed (Apple does not
let an app collect donations). The clock takes the empty half, so **the six grid cards keep their
exact size on every device and Home still does not scroll**. A fourth grid row would have cut every
card by ~19% on an iPhone SE and left the coach card's icon almost nothing.

## Key files

| File | What |
|---|---|
| `Sources/BiyaherongCoachCore/ChessClock.swift` | The state machine (`ChessClock`), `TimeControl` (presets, bands, labels, limits), `ClockFormat`. Foundation-only and deterministic: every call takes `now` in ms. |
| `DemoApp/Sources/BiyaherongUI/ChessClockScreen.swift` | The screen, the time-control sheet, `ChessClockIdle` (the idle timer). |
| `DemoApp/Sources/BiyaherongUI/ChessClockMetrics.swift` | Every string and number (`ChessClockStrings`, `ChessClockMetrics`), the half-state decision, and `ChessClockPrefs`. |
| `DemoApp/Sources/BiyaherongUI/HomeParts.swift` | `HomeBannerRow` — the clock's half of the bottom band. |
| `DemoApp/Sources/BiyaherongUI/PhoneView.swift` | `showClock`, ungated `onClock`, the tile's subtitle, delete-account. |
| `web-demo/js/chess-clock.js` | The browser twin: the same core, and the screen. |
| `tools/qa/chess_clock_check.js` | The gate. |

Decisions a compiler cannot check, each pinned by the gate:

- **Portrait, rotated — not landscape.** `.rotationEffect(.degrees(180))` on the top half, so
  `OrientationGate` keeps the video player as its only writer.
- **The tick publisher is `@State`** (the 1.0.10 Turbo lesson), and time is
  `ProcessInfo.systemUptime` — monotonic, so a wall-clock jump is never charged to a player.
- **`isIdleTimerDisabled` is app-wide,** so whoever sets it owns clearing it: on any status but
  running, and on leaving the screen. iOS only — the macOS demo keeps building.
- **No layout literal** in the screen; every number is a `ChessClockMetrics` constant.

## How it is tested

`swift` is not on PATH on the Windows checkout, so the Swift is written blind and checked three ways:

1. **One table, two interpreters.** The ParityRunner `chess_clock` group is written as **scripts**
   in a small step language (`press bottom @1000`, `left top 179000 @2000`, …). `chess_clock_check.js`
   §1 pulls them out of `main.swift` and runs every step through the JS core, so each expectation
   has been executed, not just typed. It also asserts the group's `requireMinCounts` floor equals the
   number of checks the table makes (221) — the floor cannot be hand-set.
2. **Swift text == JS values** for every constant, preset, string and metric (§2–§3), and the
   decisions above (§4–§5).
3. **The browser screen, driven** on a fake DOM and a fake clock (§6): start, a move with its
   increment, pause, the flag, sound, reset, a new preset, and a corrupt saved record.

18 mutants in `puzzle_core_mutation_test.js` put a bug back in each place; all die.

```bash
node tools/qa/chess_clock_check.js        # this feature
node tools/qa/js_goldens.js               # everything, including it
swift run ParityRunner                    # on a Mac: runs the same scripts in Swift
```

**Device checks** (nothing here can see them): the top half reads correctly from across a table ·
the screen stays lit through a long think · background the app mid-game — it comes back paused ·
the sound with the mute switch on and off · the halves respond instantly to a fast tap.
