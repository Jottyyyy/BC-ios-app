# Stockfish, embedded

The Analysis Board and Game Review run **Stockfish 17.1**, compiled into the app and evaluating with
its own neural networks. No server, no radio, no subprocess. `LocalEngine` — the hand-written
negamax that carried this screen until now — is still here, and still the fallback.

This is decision #2 in `PORTING_NOTES.md`, taken at the start of the port and carried out on
2026-08-25. It is also the reason the app is GPLv3.

---

## Why it was needed

The client's complaint was that the engine was weak, and the honest answer was that it was two
different things at once. One was a pair of real bugs, fixed separately (`CHANGELOG.md`,
2026-08-25 — quiescence never ran, and the pawn shield fined `1.e4`). The other was the ceiling:
`LocalEngine` searches ~60k nodes/sec and reaches a mean depth of about 5 in 1.2 seconds. Stockfish
is a different category of thing. At the same 1.2 seconds on a phone it reaches depth 20+ with an
NNUE evaluation trained on hundreds of millions of positions.

There was also a second problem, which was ours: `docs/specs/BIYAHERONG-PORT-SPEC.md` claimed in five
places that an embedded Stockfish already existed. It never had. That is what the client had been
told, and it is now true instead of corrected.

## The licence, first, because it is not optional

Stockfish is GPLv3. GPLv3 section 5 requires the combined work to be licensed under the GPL as a
whole. So:

- [`LICENSE`](../LICENSE) is the GPL. It replaced a proprietary "all rights reserved" notice.
- **The grant is irrevocable.** Anyone who receives a copy keeps those freedoms for that copy
  regardless of what a later version of that file says.
- The corresponding source is published in full.
- Apple's device limits are an "additional restriction" of the kind GPLv3 §10 forbids — the VLC
  precedent. It is not a problem here for the same reason it is not for Lichess, which ships
  Stockfish in its own GPLv3 iOS app: only the copyright holders can raise it, and they are the ones
  publishing it there on purpose.

`tools/qa/stockfish_vendor_check.js` fails the gate if `LICENSE` stops being the GPL while Stockfish
is still vendored.

## How it is put together

```
Engine/                                   a third SwiftPM package
  Sources/CStockfish/
    include/biya_stockfish.h              pure-C public header  ← Swift imports this
    biya_stockfish.cpp                    the whole C++ surface of this app, ~330 lines
    sfconfig.h                            the build switches the Makefile would have set
    sf/                                   Stockfish 17.1, vendored, one patched line
  Sources/StockfishEngine/
    StockfishBridge.swift                 every DECISION, pure, mirrored in JS
    StockfishEngine.swift                 conforms to Core's AnalysisEngine
    Nets/                                 nn-1c0000000000.nnue (71.4 MiB) + nn-37f18f62d772.nnue
```

Three things about that shape are deliberate.

**No pipes, no stdout hijack.** The usual way to embed Stockfish is to keep `UCIEngine::loop()`,
`dup2()` the process's stdin and stdout onto pipes, and talk to it in text on a background thread.
Since Stockfish 16.1 there has been a public `Engine` class with `set_position`, `go`, `stop` and
`set_on_update_full` — structured callbacks carrying depth, score, nodes and PV as fields. Using it
directly means no text parsing, no reader thread, no custom `streambuf`, and no seizing the whole
app's standard output. `biya_stockfish.cpp` is one file with one lock.

**The public header is C, not C++.** Swift can import a target whose sources are C++ as long as its
public header is C, which keeps `.interoperabilityMode(.Cxx)` — and its coupling to one Swift
toolchain version — out of the package entirely.

**Every judgement call is in Swift, not C.** Nothing on the Windows checkout can compile C++, so the
C layer only marshals. The score sign flip, `mate 0`, which of two reports for a rank wins, when an
iteration counts as finished, where a PV stops — all of it lives in `StockfishBridge.swift`, which
`tools/qa/stockfish_bridge_twin.js` mirrors and `tools/qa/replay_stockfish.js` replays in both
languages.

## Four things that would have shipped badly

**`exit(EXIT_FAILURE)`.** `sf/nnue/network.cpp:267` terminates the process when the net it was asked
for is not the net that loaded. Fine in a command-line engine; in an iOS app the process simply
vanishes, with no exception and nothing in the crash log that reads like a crash. Worse,
`Engine::go()` is what calls `verify_networks()`, so the trigger is the user's *first analysis*, not
launch. `biya_sf_start` now opens both files itself before Stockfish sees them, and installs an
`on_verify_networks` listener that throws — the unwind beats the `exit()` — so the failure is an
error code at startup instead.

**Silent scalar NNUE.** SwiftPM never runs Stockfish's Makefile, and Stockfish auto-detects none of
the switches that Makefile sets: `nnue/simd.h:34` keys off `USE_NEON`, never off `__ARM_NEON`.
Without them the app compiles, links, ships, plays correct chess, and evaluates several times
slower with nothing anywhere reporting a problem. `sfconfig.h` sets them from the preprocessor's own
architecture macros — which has to be C, because SwiftPM's `.define(.when(platforms:))` filters by
platform and there is no architecture filter, and `USE_NEON` on an x86_64 host makes the build fail.

**GitHub's 100 MiB wall.** Stockfish 18's big net is 103.9 MiB — over the limit, unpushable without
Git LFS. 17.1's is 71.4 MiB. That is the entire reason this repository vendors 17.1, it appears
nowhere in the source, and it would be rediscovered at push time by whoever upgrades next; the
vendor check asserts it.

**`-march=armv8.2-a+dotprod`.** Stockfish's Makefile pairs `USE_NEON_DOTPROD` with that flag, which
on SwiftPM means `.unsafeFlags` — banned outright in a package consumed as a dependency, and
untestable here. Dotprod is worth roughly 10-20% on NNUE; NEON versus scalar is worth several times
that. Only the safe multiple is taken.

## Settings, and what the presets now mean

Nothing in `EngineSettings` changed. The preset table (`docs/engine-settings.md`) still owns think
time, line count and review budget, and Balanced is still 1.2 s / 3 lines. The DEPTH CEILINGS were
raised on 2026-08-26 and the clocks were not — see `docs/engine-settings.md`. They had been chosen
against `LocalEngine`, which never reached them; Stockfish did, in a fraction of the budget, so the
ceiling had quietly become the binding limit instead of the clock.

The deadline is handed to Stockfish as `movetime` **as well as** being polled through
`shouldCancel`. `AnalysisEngine`'s limits are deliberately depth and nodes only, so that a result
stays reproducible in a test — but `shouldCancel` is consulted only when Stockfish reports, and at
depth 20 that can be seconds apart. `movetime` keeps a preset's "1.2 seconds" meaning 1.2 seconds;
`shouldCancel` keeps a user-initiated stop immediate. Infinite passes no `movetime` at all, and the
cancel token stays the only clock.

Threads are fixed at 2 and the hash at 32 MiB. A phone will hand out efficiency cores and then
thermally throttle, and the big net is already ~71 MB resident — iOS terminates a foreground app
that grows without the user seeing why.

## How to tell which engine is actually running

The Engine panel names it: **Stockfish 17.1**, or **Built-in engine** with a line underneath saying
Stockfish could not load.

That line exists because the fallback below is *silent*. If the NNUE resources ever go missing the
Analysis Board keeps working, the presets keep meaning what they say, and nothing anywhere reports a
problem — the only other symptom is a depth chip that stops climbing, which reads as "the engine is
a bit weak" rather than "a resource is missing from the bundle". On a TestFlight build handed to
someone else, that difference is the whole diagnosis.

The strings come from `StockfishBridge.engineLabel(available:)`, keyed on
`StockfishRuntime.isStarted` — whether the engine really **started**, not whether it was compiled in.
They are deliberately outside `EngineSettings.panelModel`: that lives in the Parity Core, which has
to stay engine-agnostic, and this is a runtime fact rather than a setting.

## What LocalEngine is still for

- **The fallback.** If the NNUE resources ever fail to load, `AnalysisVM` uses `LocalEngine` and the
  board keeps working instead of showing an empty panel. `StockfishRuntime.isStarted` is the switch,
  checked once per search.
- **The web demo.** `web-demo/` runs `LocalEngine` and always will. A 71 MB network and a WASM engine
  cannot be carried by a preview that opens from `file://` with no install step. This is the one
  user-facing feature in the repository that is **not** mirrored into the demo, and it is the reason
  the JS twin lives in `tools/qa/` rather than `web-demo/js/` — a twin with no demo behind it is a
  test fixture, and `web_shell_check.js` §2 is right to refuse it.
- **The parity suite.** `ParityRunner` and every golden vector still run against `LocalEngine`. The
  Parity Core stays Foundation-only and engine-agnostic, exactly as `CLAUDE.md` requires; nothing
  about Stockfish leaks into `Sources/BiyaherongCoachCore/`.

## Known deviations

**Repetition history does not reach Stockfish.** `AnalysisEngine.analyze` carries `historyKeys` —
position *keys* — and UCI wants the *moves* that produced them (`position fen … moves …`), which is
how Stockfish learns a line repeats something played before the search began. Repetitions inside the
search are still found, and `ChessRules` has already ruled on the root, so what is lost is a line
that walks back into a position from before the root not being scored as a draw. Recorded in
`PORTING_NOTES.md`.

**The closures are called on Stockfish's search thread**, not the caller's. `LocalEngine` calls them
inline. It is safe at the call site that exists — `AnalysisVM.runAnalysis` reads a `CancelToken` and
a `Date` in `shouldCancel`, and hops to `@MainActor` inside `onProgress` — and any new caller has to
hold to the same rule.

**Old game reviews are stale.** `AnalysisEngine.identifier` went from `local-negamax-v2` to
`stockfish-17.1`, so a review saved before this change was computed by a different engine and its
centipawn-loss numbers are not comparable. Nothing reads `identifier` to invalidate them yet.

## Key files

| File | What it holds |
|---|---|
| `Engine/Package.swift` | the two targets, the excludes, `gnucxx17`, and no `unsafeFlags` |
| `Engine/Sources/CStockfish/include/biya_stockfish.h` | the pure-C contract, and the `exit()` hazard in full |
| `Engine/Sources/CStockfish/biya_stockfish.cpp` | the entire C++ surface: lifecycle, one lock, score marshalling |
| `Engine/Sources/CStockfish/sfconfig.h` | `USE_NEON`, `IS_64BIT`, `NNUE_EMBEDDING_OFF`, and why each |
| `Engine/Sources/CStockfish/sf/types.h` | the one patched line in the vendored tree |
| `Engine/Sources/StockfishEngine/StockfishBridge.swift` | every decision, pure and testable |
| `Engine/Sources/StockfishEngine/StockfishEngine.swift` | `AnalysisEngine` conformance, `Relay`, the C callback |
| `DemoApp/Sources/BiyaherongUI/BuildMode.swift` | `warmUpEngine()` — the launch-time start |
| `DemoApp/Sources/BiyaherongUI/AnalysisVM.swift` | the two call sites and the `LocalEngine` fallback |
| `tools/qa/stockfish_bridge_twin.js` | the JS twin |
| `tools/qa/replay_stockfish.js` | Swift ↔ JS parity |
| `tools/qa/stockfish_vendor_check.js` | the vendored tree, the patch, the nets, the licence |

## How to test

```bash
# The decisions, in Node — this is the part that can actually be run on Windows
node tools/qa/stockfish_bridge_twin.js 2>/dev/null || \
  node -e "console.log(require('./tools/qa/stockfish_bridge_twin.js').selfTest().summary)"

# Swift says what the JS says
node tools/qa/replay_stockfish.js

# The vendored tree is still what the build assumes
node tools/qa/stockfish_vendor_check.js

# Everything
node tools/qa/js_goldens.js
node tools/qa/swift_lint.js && node tools/qa/swift_symbol_check.js
```

**On a Mac, which is the only place any of the C++ has ever been compiled:**

```bash
cd DemoApp && swift build          # compiles Stockfish too, first time is slow
swift run DemoApp                  # Analysis Board -> the depth chip should pass 15 in a second
cd .. && swift run ParityRunner    # still LocalEngine, still must exit 0
```

What to look for in the demo: the depth climbing past anything `LocalEngine` reached, `1.e4` and
`1.d4` among the top lines from the start position, and a score that settles rather than lurching
between depths. If the panel shows nothing at all, the nets did not load — `StockfishRuntime.start()`
returns the reason, and `biya_sf_last_error()` carries Stockfish's own message.
