# opening-tree — which openings you actually play, and how they score

A move tree built from your own games, walked on a board, with **games played** and a **win / draw /
loss bar** on every candidate move. It is what <https://www.openingtree.com> does, and it is a port
of the RN app's own rebuild of that site — `analysis-board/openingtree.tsx`, 1,457 lines, three
screens behind one `view` state.

It is the destination the **Opening Tree** Home tile has been waiting for. That tile has existed
since the Home screen was written and its tap did *nothing*: `HomeScreen.onOpeningTrainer` defaulted
to `{}`, `PhoneView.home(basis:)` never passed it, and `app.js`'s Home handler had no branch for the
`'openingTrainer'` action it has always emitted. Not a bug, not a gate — the screen did not exist.

- **Run it (Windows):** open `web-demo/index.html` → **Opening Tree** on the Home grid. It is behind
  the trial gate, so set the **Subscription** picker above the phone to Trial or Active first.
- **Run it (macOS):** `cd DemoApp && swift run DemoApp` → the **Phone UI** panel.
- **Assertions:** `node tools/qa/replay_opening_tree.js` (the Swift-vs-JS replay — the real gate on
  Windows) · `node tools/qa/js_goldens.js` runs that plus four `selfTest`s and the RN-source check ·
  `swift run ParityRunner` runs the `opening_tree` group on a Mac.

## The two rules the whole feature turns on

**1 · A node's statistics belong to the MOVER, not to you.**

`wins`/`draws`/`losses` on a move describe how the side that *played* it fared. So when you walk
into Black's replies the numbers keep reading "how did this move do for whoever chose it" — which is
what makes a two-colour tree legible, and is openingtree.com's own convention. `OpeningTree.insert`
flips the sign on the opponent's plies:

```swift
let ownerScore = outcome.score(forWhite: game.userIsWhite)
let moverIsOwner = (step.moverIsWhite == game.userIsWhite)
let moverScore = moverIsOwner ? ownerScore : -ownerScore
```

Backwards, every second row of the move list is exactly wrong in a way that looks entirely
plausible — Black's replies would read as *your* results. Only a hand-checked game would show it,
which is why both the parity group and the replay assert it by name.

**2 · The candidate sort ties by SAN.**

Count descending, and equal counts break by SAN ascending. Not decoration: `Dictionary` iteration
order is unspecified in Swift, `sort` is not stable (`CLAUDE.md`), and without the tie-break the
same tree renders in a different order on every run *and* in a different order from the browser —
at which point no replay can compare the two.

## The tree's shape

SAN-keyed and recursive, which is the RN original's `Record<string, TreeNode>`:

```swift
public struct Node {
    public var count = 0, wins = 0, draws = 0, losses = 0
    public var children: [String: Node] = [:]
}
```

**Keyed by move, not by FEN, on purpose.** A SAN path is *the line you played*, so `1.e4 c5 2.Nf3`
and `1.Nf3 c5 2.e4` stay separate branches even though they transpose. Merging them is right for an
opening **book** — `OpeningBook` keys by `positionKey` and deliberately collapses transpositions —
and wrong for "show me how I actually play".

Two things the walk does that look like bugs and are not, both faithful to `addGamesToTree`:

- **An unparseable move truncates the game rather than dropping it.** Everything before the bad
  token is real data. Real PGN carries null moves, `Z0` and exporter quirks, and discarding a
  30-move game over ply 31 loses the opening it was imported for. A game whose *first* move will not
  parse is a different thing and is counted in `rejectedCount`.
- **Legality is judged by the position, not the string.** SAN is re-generated from the parsed move
  via `san(for:)`, so `Qxf7`, `Qxf7#` and an over-disambiguated spelling all collapse to one key,
  and two exports of the same game land on the same branch.

## Where the games come from

| Source | Network | Status |
|---|---|---|
| **Paste PGN** | none | live — both sites let you export all your games as a PGN |
| **My Coach games** | none | declared, not yet wired to `CoachStore` |
| **Lichess** | needs internet | **live** — NDJSON stream, newest games first |
| **Chess.com** | needs internet | **live** — monthly archives, newest month first |

`OpeningSource.isOnline` is the single source of truth for which is which, in both languages, and
`replay_opening_tree.js` §7 asserts the two sets are identical.

## The download, and the bug it fixes

The two online sources were **drawn but never wired**. Picking one validated the username and then
set `errNetwork` — *"Could not reach that site. Check your connection and try again."* The client
reported it as *"hindi nag-oopening tree"*, and the reason it survived a green suite and TestFlight
is that **the message it produced was indistinguishable from a real outage**: a user has no way to
tell a missing feature from a missing signal, so they check their wifi and report the app.

Worse, the suite *pinned* it — `openings.js`'s own selfTest asserted the refusal in as many words
(*"and then says the download is not wired"*). A test that pins a bug is worse than no test, because
it makes the bug look decided. That assertion is now the opposite one.

| | Endpoint | Order |
|---|---|---|
| Lichess | `GET /api/games/user/{u}?pgnInJson=true&max={n}`, `Accept: application/x-ndjson` | newest first, streamed line by line |
| Chess.com | `GET /pub/player/{u}/games/archives`, then each month | archives **reversed** — newest month first |

Chess.com's reversal is not cosmetic: the walk stops at the ceiling, so the order decides *which*
games a 100-game tree is built from. Oldest-first would build every user a tree of the games they
played when they signed up, which is the opposite of what an opening tree is for.

**The split is the design.** Everything that decides anything — the URLs, the NDJSON parse, the
colour rule, what a status means, the ceiling — is in `OpeningDownload.swift`, in the parity core,
where the Windows gate and `ParityRunner` can both reach it. `OpeningDownloader.swift` is forty
lines of `await` and the app's only `URLSession`; `opening-download.js` is its twin and `web-demo/`'s
only `fetch`. §12 of the replay fails if a second file in either language opens one.

### Three places this is deliberately not the RN app

1. **An aborted game has no result.** The RN mapping is
   `winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '1/2-1/2'`, so a game with no winner —
   very often the first in a stream — scores as a draw for **both** sides. `OpeningTree.Outcome`
   already decided the other way for pasted PGN, and two import paths disagreeing about the same
   game is worse than the bug being fixed. `lichessUnfinishedStatuses` is the list.
2. **The colour comes off the game, not the picker.** `addGamesToTree` takes the White/Black picker
   as the answer whenever it is not "both", so an RN tree built as "White" labels every game White —
   including the ones the user had Black in, whose results then land inverted. The username is known
   for every online game, so the real colour is read and the picker **filters**, exactly as on the
   paste path.
3. **Nothing is saved until the download finishes.** The RN screen jumps to the explorer with an
   empty tree and grows it live; it pays for that with a half-built tree left saved whenever a
   download fails, indistinguishable from a real one once the banner is gone. Here a failure leaves
   the form open with the reason on it and the list exactly as it was. The counter still moves.

### Limits

`OpeningDownload.resolvedMax(isPremium:requested:)`: free is a flat 100, premium clamps the box to
`1...1000`. **1000, not 2000** — `OpeningTree.maxGamesLimit` used to carry 2000 described as "the
download ceiling the RN form offers", and the RN form clamps at 1000 in both of its two places
(`openingtree.tsx:479` and `:917`). The parity check read that constant back to itself, so the wrong
number was asserted against the right prose. The constant is gone rather than corrected; the limits
belong to the download.

### Cancellation

Swift cancels the `Task` from `.onDisappear`, so leaving the form stops the download. The browser
cannot un-send a `fetch` without an `AbortController`, so `app.js` compares the captured form by
identity on the way out and drops an answer that arrives into a screen the user has left.

## Key files

| File | Role |
|---|---|
| `Sources/BiyaherongCoachCore/OpeningTree.swift` | **The whole algorithm** — the tree, the inversion, the sort, PGN → games, `Codable` persistence. Foundation-only. |
| `web-demo/js/opening-tree.js` | The JS twin, and the half that actually runs on Windows. |
| `Sources/BiyaherongCoachCore/OpeningDownload.swift` | **The wire formats** — URLs, the NDJSON parse, the archive order, the limits, the colour rule. Pure; opens no socket. |
| `DemoApp/Sources/BiyaherongUI/OpeningDownloader.swift` | The transport. **The app's only `URLSession`.** |
| `web-demo/js/opening-download.js` | Both of those, in the browser. **`web-demo/`'s only `fetch`.** |
| `DemoApp/Sources/BiyaherongUI/OpeningMetrics.swift` | Every number and colour, mirrored by `web-demo/js/opening-metrics.js`. Includes `pgnMinHeight` — INVENTED (the RN form has no PGN box), taken from `pairing.css`'s `.pgd-modal-area` so the app's two paste-a-blob fields agree. |
| `tools/metrics/extract_opening_styles.js` → `opening_styles.json` | The AST walk over `openingtree.tsx` that both metrics files are asserted against. **Committed.** |
| `DemoApp/Sources/BiyaherongUI/OpeningTreeStore.swift` | `openings.json` in Application Support, plus the navigation state. |
| `DemoApp/Sources/BiyaherongUI/OpeningTreeScreens.swift` | The three screens. |
| `web-demo/js/opening-store.js`, `openings.js` | Their browser twins. |
| `tools/qa/replay_opening_tree.js` | The cross-language gate. |
| `Sources/ParityRunner/main.swift` (`opening_tree`) | The Swift half, run on a Mac. |

**There is no golden file**, and that is the one departure from every other Core module: the source
is TypeScript, not a Laravel controller, so there is no PHP oracle to generate one. The differential
partner is the JS twin instead — the same standing-in the notation core uses.

## The PGN box

One field on the form has a minimum height, and both languages have to agree on it: a name and a
username are one line, but a PGN that opens one line tall reads as a text input rather than as
somewhere to paste four games. `OpeningLayout.pgnMinHeight` is that number — `--op-pgnMinHeight` in
the browser, `field(_:placeholder:minHeight:)` in Swift, where `TextField(axis: .vertical)` grows
from a single line and would otherwise be a quarter the size of its twin.

It carries **no `resize`**. iOS has no resize handle, so the grip the browser used to draw was a
control the app could not have — and inside `.op-form`, which scrolls, it put a second scrollbar
hard against the first. See the shell rules in [`web-demo.md`](web-demo.md).

## How to test

```bash
node tools/qa/replay_opening_tree.js       # 344 Swift expectations against the JS
node tools/qa/js_goldens.js                # + opening-tree/metrics/store/screens selfTests
node tools/metrics/extract_opening_styles.js   # re-derive the JSON; needs the sibling RN repo
node tools/qa/swift_lint.js                # no arguments
node tools/qa/swift_symbol_check.js        # no arguments
swift run ParityRunner                     # macOS; the `opening_tree` group must pass its floor
```

From a **worktree**, the extractor needs `FRONTEND_ROOT` — a worktree sits three levels deep, so its
relative lookup for the sibling repo resolves inside `.claude/worktrees/`:

```bash
FRONTEND_ROOT="…/BYAHERONG-COACH-FRONTEND" node tools/metrics/extract_opening_styles.js
```

The other four extractors still hardcode that path and fail there; only this one takes the override.

Visually, in `web-demo/index.html` at an iPhone size, with the Subscription picker on **Trial**:

1. **Home → Opening Tree** opens the (empty) list. It used to do nothing at all.
2. **+ New Tree** → name it, leave the source on **Paste PGN**, paste two games, **Build Tree**.
3. The explorer opens: board on top, `Starting position`, then one row per first move with
   `n games`, `W / D / L` and a three-segment bar.
4. Tap a move — the board advances, the strip reads `1. e4`, and the list becomes the replies.
   **Back**, **Reset** and **Forward** (which plays the most-played child) all work; Back and Reset
   are dimmed at the root.
5. Switch the source to **Lichess**: the note flips to "Needs internet" and a **Games to fetch**
   box appears. Type a real Lichess username, tap **Build Tree** — the button reads "Building…",
   the banner counts games as they stream in, and the explorer opens on the finished tree.
   A username that does not exist comes back as *"No games found for that username."*, not as a
   connection error; a genuinely dead connection is the one thing that still says *"Could not reach
   that site."*
6. **Chess.com** the same way. It arrives a month at a time rather than a game at a time, so the
   counter steps rather than ticks.
