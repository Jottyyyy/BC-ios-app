# PORTING_NOTES.md — Biyaherong Chess Coach → Native Offline iOS

This file records every deviation from the source system, every resolved decision,
and every invented constant, as required by the migration brief (§12 deliverable 10).

---

## The 2.1(a) rejection of 1.0.7 (51), and what it changed (2026-09-04)

Full account and the reply to Apple: `docs/app-review-response.md`. Recorded here are only the
deviations and invented values.

### DEVIATION: signing in is OPTIONAL, and a guest session is a real session

**Original:** the RN app's `(auth)/login.tsx` is a username/password form against a Laravel API, and
signing in is mandatory because the whole app is server-backed. This port kept the mandatory shape
long after the server went away.

**Here:** `LoginSession.guestProvider = "guest"` joins `"apple"` in `providers`, so a guest session
satisfies `isSignedIn` and **nothing downstream learns a third state**. `LoginGuestButton` sits under
Apple's on the login screen, and the sign-in failure alert offers the same action as its first
button.

**Why.** Two reasons, and the guideline one is the stronger:

1. **Guideline 5.1.1(v)** — *"If your app doesn't include significant account-based features, let
   people use it without a login."* This app has no account server. `LoginStore.signIn(_:)` writes
   one string to `UserDefaults`; there was nothing to sign in **to**.
2. Build 1.0.7 (51) was rejected under **2.1(a)** when Apple's own sign-in service failed on the
   reviewer's device — an alert (*"Could Not Connect"*) whose text exists nowhere in this repo — and
   the app had no other way in.

**Consequence for the offline claim:** the first launch no longer needs a connection. The privacy
sheet was reworded again, in both languages, to say sign-in is optional. `~90% offline` is unchanged
as a claim; what changed is that the one unavoidable online moment became avoidable.

### DEVIATION: a store that cannot be reached does not wall the app

**Original:** the PHP backend decided entitlement, so "the store is unreachable" had no analogue.

**Here:** `PhoneApp.locked` gained a third term, `!premium.storeUnavailable` (`loadState == .failed`).
A user whose `Product.products(for:)` came back empty **cannot buy**, and a paywall in front of
somebody who cannot buy is a dead app rather than a business model. They drop to the **free tier** —
every `DailyLimits` cap and every per-feature gate still in force — not to everything.

`.idle` and `.loading` deliberately still lock (they mean *not asked yet*), which is why `PhoneApp`
now calls `load()` at launch rather than only when the paywall opens.

**Accepted cost:** a non-subscriber who blocks the App Store gets the free tier instead of a wall.
That is a smaller hole than the two already accepted below (refunds, clock rollback): the free tier
is capped, and a real subscriber is unaffected either way because entitlements resolve from the
device's own transaction cache.

### DEVIATION: the Analysis Board is ungated

`docs/subscription.md`'s free-vs-premium table has listed *"Analysis Board · engine · move tree · PGN
· book"* as free since the paywall landed. The round-4 trial gate walled it anyway, so the table and
the app disagreed; the client's ruling is that the table was right. **Game Review keeps its 3/day
free allowance.**

### INVENTED: the guest button's four numbers, and its copy

No RN counterpart exists — the original had no guest path. Invented, and asserted in
`tools/qa/replay_login.js` in both languages:

| Constant | Value | Reason |
|---|---|---|
| `LoginLayout.guestButtonHeight` | 44 | Apple's minimum target. A way past a broken sign-in that is hard to hit is not one. |
| `LoginLayout.guestTopGap` | 12 | Close enough to read as the same band as Apple's button. |
| `LoginLayout.guestBorderWidth` | 1 | An outline, not a fill, so Apple's stays the loudest control. |
| `LoginType.guestLabelSize` | 15 | Below the 17 of Apple's label, above the 13 of the reassurance line. |

Its two colours are **not** invented: `LoginPalette.guestLabel` and `guestBorder` alias
`Theme.mutedForeground` and `Theme.border`.

`LoginStrings.guestButton` is **English** — "Continue without an account" — like every other button
in this app (`Sign out`, `Delete account`, `Restore Purchases`). Taglish is the voice of its
sentences, not of its controls, and this control is the one an App Store reviewer has to find.

### The trial length stopped being a constant in a sentence

`Entitlement.trialDays = 7` remains, as the fallback and as the value before the store answers, but
the copy no longer contains a 7. `PremiumStore.trialDays` derives from the loaded product's
`introductoryOffer.period` (`P1W` → 7). The month and year figures in that conversion (30, 365) are
Apple's billing conventions and appear in exactly one function.

**Why it matters:** a hardcoded duration that stops matching App Store Connect is not a rounding
error, it is a Guideline 3.1.2 misrepresentation — *"clearly indicate how long the free trial lasts
and the price billed once the free trial is over."* Same rule prices have always followed.

---

## Resolved decisions (July 2026)

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| **1** | App download size / puzzle-bank size | **Full 550,000 puzzles (~100 MB)** | The build-time puzzle tool must convert the entire `byahero_puzzle.csv` (96 MB on disk) into an indexed read-only `puzzles.sqlite`. Apple shows a cellular-download warning at this size — accepted. Does **not** affect the parity core. |
| **2** | Chess engine | **Stockfish (GPL) + publish the app's source openly** — **CARRIED OUT 2026-08-25** | Done: Stockfish 17.1 is vendored at `Engine/Sources/CStockfish/sf/`, `LICENSE` is the GPL, and the grant is irrevocable. Not an xcframework and not a UCI text bridge — the public `Engine` C++ class with structured callbacks, behind a pure-C header. The parity core is untouched and still engine-agnostic. See `docs/stockfish.md`. |
| First build target | What to build first | **Parity core + tests** | This package: pure-Swift domain engines + a golden-vector parity harness, verified against the real Laravel source. |

## Tutorial Videos (2026-08-26)

The last unwired Home tile. Full write-up in `docs/tutorial-videos.md`; this records only what
deviates or was decided.

### DECISION: a public Laravel route, not the authenticated API — and not a bucket file

`GET /api/tutorial-videos` sits inside `Route::middleware('auth:sanctum')`. **This app has no
account and no token, by design** — it signs in with Apple on the device, never talks to the Laravel
backend, and there is no `/api/auth/apple` endpoint that could mint one. Wiring the screen to that
endpoint would produce a permanent 401 indistinguishable from a broken feature.

The catalogue is read from `GET /api/content/tutorial-videos` instead: the same controller, the same
shared query, no auth at all.

### DEVIATION: this is not the static file spec §0.1 asked for

Spec §0.1 says *"Content = static files on R2/S3. **No API. No accounts. No sync.**"*, and the first
implementation obeyed it: `tools/content/generate_video_manifest.php` writes the manifest, somebody
uploads it, `manifestURL` points at it. That still works and the script is still here.

It was replaced as the default for one reason, and it is an operational one rather than a technical
one. **The file has to be regenerated and re-uploaded by hand after every upload in the admin
panel.** Miss that step and the app shows a catalogue that stopped matching the shelf — and it looks
completely fine doing it, which is the worst shape a bug can take. A route cannot go stale.

The spec's objection was to *accounts and sync*, both of which this route is free of: no token, no
session, no write path, no state on the device. What survives of §0.1 is the property that mattered
— the app still holds no account and still talks to nothing that could reject it.

Checked, not assumed, at the time of the change: production had 5 visible videos and a working
bucket (thumbnails served), the local dev database had 0 rows, and `/api/content/tutorial-videos`
returned 404 until the backend change was deployed.

Two things came out of building it that are worth keeping:

- **`Access-Control-Allow-Origin` set on the response does not survive.** Laravel's `HandleCors` is
  global middleware, so its response pass runs after every route middleware and overwrites the
  header. With exactly one configured origin and no patterns, php-cors stamps that origin onto every
  `api/*` response regardless of who asked. The browser preview is allowed by an origin pattern in
  `config/cors.php`, which is the only place that can decide it.
- **`is_visible` defaults to `false`.** `DashboardController::store` writes
  `boolean('is_visible', false)` and the manifest query filters on it, so a video that was uploaded
  but never toggled is absent from the app with nothing anywhere explaining why.

### DECISION: the receipt is the identity

The catalogue route was public, and one `curl` returned every video URL in it. The app has no
account and no Sanctum token — that is the whole architecture — so there was nothing to authorise
against and nothing to check.

Except there was. StoreKit hands the app a `Transaction.jwsRepresentation`: the transaction, signed
by Apple, carrying the certificate chain that proves it. `AppleTransactionVerifier` checks that
signature against **Apple Root CA - G3, pinned by SHA-256 fingerprint**, then checks the payload is
for this bundle, one of our products, unrevoked and unexpired. No account, no session, no secret on
the server, and no call to Apple.

The fingerprint was **extracted, not transcribed** — downloaded from
`https://www.apple.com/certificateauthority/AppleRootCA-G3.cer`, hashed, and confirmed self-signed
with CN "Apple Root CA - G3". The certificate is committed as a test fixture and
`AppleTransactionVerifierTest` recomputes the hash from it, so a typo in that hex string is a
failing test rather than a server that trusts the wrong root — or none.

**Why not the App Store Server API.** `Get Transaction Info` answers the same question
authoritatively and needs an issuer ID, a key ID and a `.p8` on the server: three secrets to
provision, rotate and leak, for a question the JWS already answers. The trade-off is that a JWS is
a **snapshot** — a refund after it was issued is invisible until the device sends a newer one, which
StoreKit does on renewal and revocation. For a catalogue read that is the right trade, and the
Server API can be added on top later without changing anything here.

**POST for a read.** The receipt is kilobytes of certificate chain, which is a body's job; nginx's
default header buffers are not generous enough to make a header a safe habit, and a URL is worse.

### DEVIATION: half of the protection, and it is written down as half

The client chose to leave the Android app untouched for now. Android reads the same `video_url`
columns from the public bucket, so the bucket stays public — which means **a leaked link still
plays, forever**. What this change closes is *enumeration*: the list is no longer free.

That is a real improvement and an incomplete one, and it is recorded as incomplete rather than
described as "video protection". Finishing it is small once Android is in scope: make the bucket
private and return `Storage::disk('s3')->temporaryUrl(...)` from the `video_path` column that
already exists. The verification half — the half with the cryptography in it — is done.

### DEVIATION: an unknown category is visible

The RN renders `CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0)`, so a video whose category
is not one of the five is grouped and then **silently dropped**: the admin sees it saved and visible,
the app shows a catalogue missing it, and nothing anywhere says why. Both ports fold the unknown into
`Uncategorized`. **Wrong section beats no section**, and this is the "do not reproduce a latent bug —
port the intent" rule applied to a client, not a server.

### DEVIATION: no `VideoPlayer`

Spec §0.1 names `VideoPlayer` as the second of two files allowed to open a connection. It will never
be written: `AVPlayerViewController` streams the media itself, so the app never writes that request,
and it arrives with AirPlay, Picture in Picture, the lock screen and the accessibility stack. The RN
built 21 style keys of custom transport because `expo-av` gave it nothing usable; that is a week of
work to arrive somewhere worse. The spec is amended in place.

### The networking allow-list is an EXACT pair, not a ceiling

§12 now holds each language to two names rather than to a count. "At most two" would let a third
arrive by having one of the two deleted — accounting that passes while the property it protects is
gone. Adding one is an edit to that line, on purpose, with the spec updated beside it.

### The §12 sweep was fooled by an alias

It matched a literal `fetch(`. The first draft of `content-client.js` called the function through a
local variable, so **a file that genuinely opened a connection was invisible to the rule whose whole
job is to count them** — the gate reported one transport while there were two. It matches the
identifier now, with string literals stripped as well as comments: the looser pattern immediately
named `opening-metrics.js`, whose only crime was the label `'Games to fetch'`.

Worth keeping as a shape: **a sweep that looks for a call site can be defeated by one indirection.**
Look for the name.

### Everything else is generated

`extract_video_styles.js` (sixth extractor, same `rn_ast.js` machine) and `gen_video_metrics.js`
emit 214 Swift constants and 5 category styles from the RN source. After `"⬜ White"` and the
unapplied 90pt padding both shipped from transcriptions on this same day, hand-typing 56 style blocks
was not defensible.

## DEVIATION REMOVED: the Tree name field the RN never had (2026-08-26)

The build form carried a **TREE NAME** text box and refused to build without it (`errNoName`). The RN
form has no such field: it names the tree and saves, at `analysis-board/openingtree.tsx:531`,

```js
const name = `${username} · ${playerColor}`;
```

So this was an **invented** control that made the user label a thing that already had a label. Both
languages now build the same string; `nameLabel`, `namePlaceholder` and `errNoName` are gone.

Recorded here because of how it got in: nothing was wrong with the field, it passed every gate, and
the JS twin agreed with the Swift throughout — the two were faithful to each other and neither was
faithful to the RN. Extraction could not catch it either, since `extract_opening_styles.js` walks
StyleSheets, not JSX. **An invented control is invisible to a parity harness that only compares the
two ports.** The client noticed in a minute.

### INVENTED: `Pasted games` for the sources the RN does not have

Paste PGN and My Coach games are the offline port's own, so there is no account to name them after.
They read `Pasted games · both`.

Deriving the name from the PGN's `[White]`/`[Black]` headers was considered and rejected. It is a
guess; it is wrong the moment a PGN holds more than one player's games; and nothing downstream would
use it — `OpeningTree.games(fromPGN:userName:)` is already called with `nil`, so the colour filter
falls back to the picker rather than to any derived identity. Naming a tree for something not in it
is worse than naming it plainly.

### The colour belongs in the name

Not only in the meta line beneath it: two trees for one account, one per side, would otherwise be
indistinguishable in the list. The RN reached the same conclusion. Asserted as a property —
`autoName('a', 'white') != autoName('a', 'black')` — rather than as a literal, so the reason survives
a copy change.

### The guard worth having

A user who types a username for Lichess and switches to Paste PGN leaves the username in the form.
The name reads it only when `source.needsUsername`, so a pasted tree is never labelled with an
account whose games it does not contain. Mutation-tested; removing the guard fails the gate.

## An extracted constant that was never applied (2026-08-26)

### The bug

`PairingList.listPaddingBottom = 90` was extracted from the RN, generated into both languages, and
never applied in the Swift. The Tournaments list and the "New Tournament" button share a `ZStack`,
so that 90pt is what holds the scroll content clear of the button floating over it. Without it the
last element in the ScrollView sits under the button — and the last element is the hint reading
*"Long press a card to delete"*, the only documentation of the only delete gesture.

The client reported it as "walang way na mag delete ng tournament". Everything was ported; one
modifier was missing, and it happened to be the one that made the instructions visible.

Two more of the same defect: `PairingDetail.playerActions` lost its horizontal padding and
`generateWrap` lost horizontal and bottom.

### Why the existing checks could not see it

- **The browser was right.** `.pgl-list` is a three-value `padding` shorthand, so `web-demo/` showed
  the hint. A correct twin is not evidence about the Swift — the third time this exact shape has
  cost something on this checkout.
- **`metrics_key_check.js` / `swift_source_keys.js` check the wrong direction.** They prove every
  constant REFERENCE resolves. A constant nobody references is invisible to both.
- **An unused-constant census is unusable as a rule here.** 99 layout constants are unused in the
  pairing metrics alone, nearly all legitimately: the share card and the free-tier banner were never
  ported. Enforcing "unused is a bug" would have to be silenced immediately, and a silenced rule is
  worse than no rule.

### The rule that works, and why

`tools/qa/swift_padding_check.js`: **if the Swift applies ANY of a block's `*Padding<Side>`
constants, it must apply ALL of them.**

Referencing one is the proof the block is rendered — which is exactly what a census cannot
establish. An unported block is silent by construction; a rendered block that quietly lost a side
fails. 62 rendered blocks across seven metrics files, 0 violations after the three fixes,
mutation-tested 3/3.

**Match the ENUM-QUALIFIED name.** The first draft searched for `.listPaddingBottom` and passed while
the bug was in the tree, because `PuzzleStreakHome.listPaddingBottom` also exists. Block names repeat
across screens; only `Enum.member` identifies one. A gate that reports a member as "used" because a
different screen uses a same-named one is worse than absent.

### Deliberately out of scope

Borders and margins. A margin usually becomes padding on a neighbour in SwiftUI, so "unapplied" says
nothing there. One known consequence: `generateWrapBorderTopWidth`/`BorderTopColor` are extracted
and unapplied, so the Generate Round footer is missing the 1px divider the RN draws above it.

## A generated Swift string that was valid and wrong (2026-08-26)

### The bug

All eight interpolating functions in the generated `CoachStrings.swift` shipped as literals —
`"ELO (n)"`, `"(coach) goes first"`, `"Analyzing… (done)/(total)"`. `tools/metrics/
gen_coach_metrics.js` held the Swift as source inside JavaScript string literals (`'"ELO \(n)"'`),
and `\(` is not a recognised JS escape, so the parser silently dropped the backslash. The same trap
ran the other way for `'\u{00B7}'`, which IS valid JS, so `·` entered the file as a raw character
and broke the 7-bit rule `swiftString` exists to enforce.

### Why every gate was blind to it, which is the transferable part

- **The JS twin was correct.** `web-demo/` rendered `ELO 2500`, and the browser is where this
  checkout tests. A correct twin does not imply a correct Swift when the two are not generated from
  one another in the direction being checked.
- **Swift compiles it.** `"ELO (n)"` is a valid string literal. There is no compiler error to find,
  even on a Mac.
- **No gate reads inside a string literal.** `swift_lint.js` matches brackets;
  `swift_symbol_check.js` resolves `Namespace.member`. Both treat a literal as opaque.

The near-twin `gen_pairing_metrics.js` writes `'"Board \\(n)"'` with the escape doubled and has
always been right, so a working example sat beside the broken one the entire time. **Two generators
that look alike are not evidence about each other.**

### The fix, and the rule

The table no longer contains Swift. It contains the message with real characters and `{name}`
placeholders — neither of which JavaScript can reinterpret — and `swiftInterpolation` builds the
literal. **Do not embed one language's source inside another language's string literal when a
template will do.**

Two checks, deliberately at different times:

- `checkAgainstJS` evaluates the generator's OWN OUTPUT (`\u{XX}` back to characters, `\(name)` to
  distinctive samples) and refuses to write unless it renders what the JS twin renders. Testing the
  artifact rather than the template is the point: the intent was never wrong.
- `replay_coach.js` repeats it against the **committed** file, because a generator only runs when
  someone runs it, and the file is what ships.

Mutation-tested 5/5, including one that renders identically and only breaks the 7-bit rule — that
one needed its own assertion, because a render comparison cannot see it.

### Also: the generator had drifted from the file it generates

Regenerating dropped `Sendable` from `CoachProfile`, which the committed file carried. Anyone who
ran the generator would have silently broken Swift 6 strict concurrency in a file whose header says
DO NOT HAND-EDIT. The generator now emits it. **A generated file that no longer matches its
generator is a trap armed for whoever runs it next.**

## The ceilings, and naming the engine (2026-08-26)

### INVENTED: the depth ceilings moved, and the clocks did not

`EngineSettings.presets` is invented — nothing in the RN source has this panel — so its numbers have
always been ours. They went 8/12/18/22/30 → 16/22/26/28/30.

The reason is worth keeping because it is a *category* of mistake rather than a wrong number:
**a constant tuned against one engine became wrong when the engine changed, without anything
failing.** The ceilings were sized so `LocalEngine` never reached them, which made the deadline the
real budget — the design `docs/engine-settings.md` describes. Stockfish reaches 12 in a fraction of
1.2 s, so the ceiling silently became the limit and the engine stopped with time left on its clock.

Raising them is close to free, and the asymmetry is the whole justification: **`thinkMs` buys depth
with battery, heat and latency; `maxDepth` costs nothing until it binds.** No clock, line count or
review budget changed.

`Maximum` is 28 rather than 30 so the ladder stays strictly increasing. The first draft used 30 for
both `Maximum` and `Infinite` and the JS self-test caught it — *"infinite searches deeper than
maximum"* was already an assertion. Left as evidence that the preset ladder is a monotone sequence,
not five independent rows.

### INVENTED: the Engine panel names the engine

`StockfishBridge.engineLabel(available:)` / `engineNote(available:)` — `"Stockfish 17.1"` or
`"Built-in engine"` plus a line saying why.

These exist because the `LocalEngine` fallback is **silent**. That is right for the user, and it
means a build whose NNUE resources failed to load is indistinguishable from a working one except by
a depth chip that stops climbing — which nobody would read as a resource failure.

Deliberately **not** part of `EngineSettings.panelModel`, which lives in the Parity Core and is
required to stay engine-agnostic. It is also not a setting: the same stored value yields a different
name depending on whether the resources loaded. The strings are in the engine package, the view is
handed them, and the web demo (which has no Stockfish and never will) carries the unavailable string
as a literal that `replay_stockfish.js` pins to the twin.

### The gate that transcribed instead of extracting

`replay_engine_settings.js` rebuilt the canonical default document as
`${version}|${preset}|0|3|12|1200` — a hand-typed third copy of the Balanced row, in the gate whose
whole job is to stop the other two copies drifting. Changing the ceiling in both languages still
failed there, with a message blaming the Swift for a number the Swift no longer contained. It now
reads the default row out of the preset table it already parses twenty lines above. Same lesson as
the annotation badge's transcribed sign, in a new place: **EXTRACT, DON'T TRANSCRIBE — including
inside the gates.**

## Stockfish, embedded (2026-08-25)

Decision #2 above, carried out. Full write-up in `docs/stockfish.md`; this section records only what
deviates or was invented.

### The licence is no longer a plan

`LICENSE` was "proprietary, all rights reserved" with a note saying not to make the GPL grant early,
because it cannot be withdrawn. Stockfish is now linked in, GPLv3 §5 applies to the combined work,
and `LICENSE` is the GPL. **That grant is irrevocable and this file should not describe it as
reversible.** `THIRD-PARTY-NOTICES.md`'s "Stockfish is not in this application" section is gone; the
Terms sheet's older claim that "the app itself is GPL", corrected on 2026-08-18 for being untrue, is
true again.

### DEVIATION: repetition history does not reach the engine

`AnalysisEngine.analyze` carries `historyKeys` — position *keys*. UCI wants the *moves*
(`position fen … moves …`), which is how Stockfish learns that a line repeats something played before
the search began. We do not have them at that boundary and the protocol is not being widened for one
engine.

Consequence, stated precisely: repetitions **inside** the search are found normally, and
`ChessRules.terminalOutcome` has already ruled on the root before the engine is called. What is lost
is a line that walks back into a position seen before the root being scored as a draw. `LocalEngine`
does use the keys, so the two engines genuinely differ here.

### DEVIATION: the caller's closures run on the engine's thread

`LocalEngine` calls `shouldCancel` and `onProgress` inline on the caller's thread.
`StockfishEngine` cannot: Stockfish delivers `info` from its own search thread, and the alternative
is a queue that would delay cancellation by an entire iteration. Safe at the one call site that
exists — `AnalysisVM.runAnalysis` reads a `CancelToken` and a `Date` in `shouldCancel` and hops to
`@MainActor` inside `onProgress` — and `docs/stockfish.md` states it as a contract for new callers.

### INVENTED: `mate 0` maps to a mate against the side to move

Stockfish rounds mate distance as `(plies + 1) / 2` winning and `plies / 2` losing, truncating toward
zero, so a side mated one ply from now reports `mate 0`. `EngineScore.mate` documents itself as never
zero. A *winning* side cannot report 0 — a positive `plies` of 0 would mean mate is already on the
board and no search would have run — so a zero is always the side to move being mated, and is mapped
to a mate of magnitude 1 against them. Derived, not guessed, and asserted in both languages.

### INVENTED: an exact score is never replaced by a bound

Stockfish emits `lowerbound`/`upperbound` while an aspiration window fails, and those numbers sit
whole pawns from what the same depth settles on moments later. `StockfishBridge.merge` keeps an exact
score over a bound at the same rank. Without it the eval bar lurches on every re-search — visible,
wrong, and almost impossible to attribute once shipped.

### INVENTED: an incomplete iteration is not published

A search stopped mid-iteration leaves rank 1 a ply deeper than ranks 2 and 3 — a snapshot that never
existed, orderable into a sequence Stockfish never believed. `StockfishBridge.isComplete` requires
`min(multiPV, max(legalMoves, 1))` ranks before an iteration is published, and the last complete one
is returned otherwise. `AnalysisSnapshot` documents itself as one completed iteration; this is what
makes that true.

### Stockfish 17.1, not 18, and the reason is GitHub

Stockfish 18's big net is 103.9 MiB. **GitHub refuses any file over 100 MiB.** 17.1's is 71.4 MiB.
Git LFS was the alternative and was rejected: a free plan's 1 GB/month bandwidth against a 104 MB
file fetched by every CI build, and a `git lfs pull` that CI can silently skip — leaving a 130-byte
pointer file where the network should be. The Elo difference between 17.1 and 18 is irrelevant at the
depth a phone reaches in one second. `tools/qa/stockfish_vendor_check.js` asserts the limit so the
next person to upgrade finds out here rather than at push time.

### The one patch to the vendored tree

`sf/types.h` gains `#include "../sfconfig.h"`. SwiftPM never runs Stockfish's Makefile and Stockfish
auto-detects none of the switches it sets — `nnue/simd.h:34` keys off `USE_NEON`, never
`__ARM_NEON`. Without them the NNUE runs its scalar fallback: correct chess, several times slower,
nothing reporting a problem. It has to be a C header rather than SwiftPM `.define`s because
`.when(platforms:)` filters by platform and there is no architecture filter, and `USE_NEON` on an
x86_64 host fails the build outright.

`USE_NEON_DOTPROD` is deliberately **not** enabled: its `-march=armv8.2-a+dotprod` means
`.unsafeFlags`, which SwiftPM bans in a package consumed as a dependency and which nothing here can
compile-test. Worth 10-20%; NEON versus scalar is worth several times that.

### Stockfish calls `exit(EXIT_FAILURE)`, and `Engine::go()` is what reaches it

`sf/nnue/network.cpp:267` terminates the process when the requested net is not the loaded one. In a
CLI that is reasonable. In an iOS app the process vanishes with no exception and nothing in the crash
log that reads like a crash — and because the call sits inside `Engine::go()`, the trigger is the
user's *first analysis*, not launch.

Handled without patching Stockfish: `biya_sf_start` opens both files itself first, and installs an
`on_verify_networks` listener that throws on a message beginning `"ERROR:"`. `f(msg)` runs one line
before `exit()`, so the unwind wins. `verify_networks()` is then called at startup rather than left
to the first search. This is the second time this port has hit "a library's idea of a fatal error is
an app's idea of a disappearance" — see also the undefined-constant HTTP 500 rule at the top of this
file: **do not reproduce a host's crash semantics; port the intent.**

### The web demo is not mirrored, and that is a first

`CLAUDE.md` step 5 requires user-facing features to be mirrored into `web-demo/`. This one cannot be:
a 71 MB network and a WASM engine cannot be carried by a preview that opens from `file://` with no
install step. The demo keeps `LocalEngine`, which is also the app's fallback, so the demo is showing
a real code path rather than a stub. The consequence for the gate is that the JS twin has no demo
behind it, which is why it lives at `tools/qa/stockfish_bridge_twin.js` — `web_shell_check.js` §2
correctly refuses a module in `web-demo/js/` that nothing loads.

## Resolved decisions (August 2026 — Analysis Board)

| # | Decision | Choice | Consequence |
|---|----------|--------|-------------|
| **3** | How the Analysis Board gets evaluations, given Stockfish is still unbuilt | **An engine-agnostic `AnalysisEngine` protocol, backed now by an in-repo search over the existing negamax** | Every engine-dependent surface (live lines, arrows, eval bar, game review) becomes real and testable now; the Stockfish adapter later conforms to the same protocol with no UI change. The protocol names no UCI concept, so it *prevents* rather than causes the leak `CLAUDE.md` forbids. |
| **4** | Accuracy & move classification for the offline review | **Exact parity — `GameReview.swift` is not modified** | The ~300 golden game reviews stay green. The spec's suggested switch to the Lichess accuracy model was declined: it would require regenerating or retiring that group. Book moves therefore still count toward accuracy (chess.com excludes them; we do not). |
| **5** | The `book` classification tier, which the server could never produce | **A post-processing layer over `GameReview.Result`, never a tenth branch inside the pinned `classifyMove`** | `emptyClassifications` keeps exactly its 9 keys. The wrapper relabels in-book plies and recomputes the two count dictionaries with a tenth key, leaving accuracy untouched. Locked by the assertion `annotate(r, bookPlies: []).base == r`. |
| **6** | Offline opening names, replacing the Lichess masters explorer | **A bundled ECO book built from `lichess-org/chess-openings` (CC0)** | 7,854 position-keyed rows shipped in the app bundle. The dataset is fetched at development time only; the app makes no network requests. Attribution sits beside the piece art and Nunito entries. |
| **7** | Where the Analysis Board's pixel constants come from | **Extracted from the real `board.tsx` StyleSheet by AST walk, not transcribed from the written spec** | `tools/metrics/board_styles.json` (committed) is a shared oracle both the Swift check and the JS twin assert against, so it catches transcription errors from the source rather than mere drift between two hand-typed copies. Deliberate deviations are enumerated and excluded from the comparison. |
| **8** | How the board gains arrows and drag without endangering Play and Puzzles | **Extend the one shared `BoardView` / `<chess-board>` with defaulted, off-by-default options — never fork it** | Duplicating the sliding-piece identity logic would drift. The cost is that a mistake here breaks three screens, so the defaults are asserted to reproduce today's rendering exactly and a tap-to-move round trip runs with drag enabled in both the headless suite and the browser. |

## Environment reality (session that produced the parity core)

- Toolchain: **Swift 6.3.3** standalone (no full Xcode, no iOS SDK, no `XCTest`/`Testing` modules).
- Therefore the parity suite is an **executable target** (`ParityRunner`) with an in-house
  assertion harness, run via `swift run ParityRunner`. When the project is opened in Xcode,
  the same golden JSON vectors should be wrapped in XCTest or swift-testing targets.
- **PHP 8.4.10** is available and the **real Laravel backend** lives at
  `../BYAHERONG-COACH-LARAVEL`. Golden vectors are generated by standalone PHP scripts
  (`tools/oracle/*.php`) that re-implement the exact controller functions, so tests pin
  the Swift to true behavioral parity with the real code — not just the appendix prose.

---

## Ported-algorithm parity notes & deliberate deviations

### DELIBERATE DEVIATION — the Streak and Turbo share buttons are removed, not ported (2026-08-25)

Spec 13.1 / 13.3 / 14.1 / 14.4 describe **five** share buttons: the Streak lobby, its results
overlay and its solution strip; the Turbo lobby and its run results. All five shipped in Swift as
`Button { }` / `overlayButton(…, fill) { }` — **real chrome wired to an empty closure.** They
rendered, they pressed, and they did nothing, for three phases. The browser twin was live
(`navigator.share`, falling back to the clipboard), which is exactly why nobody noticed: the demo
worked and the app did not.

The client found the Turbo one and asked for it removed. Offered the alternative of wiring all five
up to a real `ShareLink` — the Pairing module already does that and the share-text builders already
existed — they chose removal. So they are gone rather than implemented.

The RN source's share targeted the hosted `/share/streak` and `/share/rush` endpoints, which Part 21
had already deleted, leaving a text-only payload; that is the context in which they were ported as
stubs in the first place.

**Kept:** Play Home's `📤 Share My Rating` (Part 10.1) — a live JS button the client did not ask
about, and Swift never had one for it at all. The Pairing module's `ShareLink` — genuinely
functional, separate namespace, its own gates.

**`PuzzlePalette.shareBlue` stays** even though it now has **zero Swift references**.
`replay_puzzle_core.js`'s palette loop asserts the declaration by name, and its JS twin is still
live via `PLAY_HOME.shareFill` → `--pzp-share-fill` → `.pzp-share`. A comment on the declaration
records this so nobody tidies it away and reds the gate.

**The containers and their `gap`s stay too.** The two lobby bands drop to one child, so `bottomGap`
stops having any effect — but removing the CSS `gap` makes `--pz*-bot-gap` a property nobody reads
and fails the `--pz*` audit's second direction, and removing the setter as well cascades into
deleting an *extracted* RN constant from two metrics tables and two parity lists, for zero pixels.

**Two new rules**, because nothing in 35,000 assertions would have noticed a share button returning:
`puzzle_screen_test.js` §3j (set equality over the hub's share classes, CSS classes and strings) and
`replay_puzzle_vm.js` §9. The second lives there rather than in `replay_puzzle_core.js` because the
mutation harness's `RUN_ALL` omits that file — an assertion there is invisible to mutation, so a
Swift mutant re-adding a button would report SURVIVED.

§9's second half is the **general** rule, and it is the one that would have caught all five the day
they were written: *no puzzle screen may declare a button wired to an empty closure.* Its first
draft anchored `label:` to end-of-line and therefore matched nothing at all — vacuous from birth,
and the new mutant is what said so. Verified after fixing against the pre-deletion source: it finds
exactly the original five.

**One real pixel change:** the Streak solution strip goes 3 → 2 buttons, and they are `flex: 1` /
`maxWidth: .infinity`, so Menu and Play Again grow from a third to half the width each.
### Quiescence never ran, and the pawn shield fined 1.e4 (2026-08-25)

Two bugs in the analysis search, both found from a client screenshot, both reproduced here to the
centipawn.

**Quiescence was disabled at every depth the app ships.** `negamax` called
`quiesce(pos, alpha, beta, ply)` and `quiesce`'s fourth parameter was doing two incompatible jobs:
mate-distance scoring wants the distance from the **root**, the `maxQDepth` budget wants a counter
that **restarts at each leaf**. `maxQDepth` is 6 and every preset is depth 8/12/18/22/30, so the
budget was spent on entry and quiescence returned its stand-pat having examined not one capture.

`maxQDepth = 6` was never wrong. Its **caller** was. The note in the invented-constants table
saying *"without quiescence, depth-3 lines are noise"* turned out to describe the shipping engine at
every depth.

Fixed by splitting the parameter in two. **The mate terms keep the root distance** — leaving them on
the leaf-local counter is a fix that looks right, passes everything else, and reports a three-ply
mate as **M1**, because mates delivered by a capture are found inside quiescence. There is now a
test that walks a mate's own PV and checks the claim.

Also: the `qdepth >= maxQDepth` cap sat **inside** the `!inCheck` branch, which a checking node
never reaches — in-check quiescence had no bound at all and terminated only incidentally. It is
bounded by `maxPly` now, the same ceiling the check extension uses. Bounding it with `maxQDepth`
instead would truncate forced checking sequences, which is the one thing quiescence exists to
follow. Behaviour-identical today (measured: same node counts, same lines), so it is a safety net
with no mutant — pinned by source text instead.

**DELIBERATE DEVIATION — the pawn shield is gated on castling rights.** The term applied to an
uncastled king on e1, whose shield files are d/e/f: exactly the files White must push. `1.e4` and
`1.d4` were fined 18cp each, `1.e3`/`1.d3` ten, and `1.Nc3`/`1.Nf3` nothing — so the engine's whole
opening repertoire became `Nc3, Nf3, e3, d3` and `e4` fell out of the top four entirely.

Gated on **rights**, not on the king's square, for two reasons. It still fires for a king sitting on
e1 whose rooks have both moved — genuinely stuck in the middle, which is what the term is *for*. And
rights are already part of the Zobrist key, so the transposition table cannot hand back a score
computed under a different evaluation for the same key. **A guard on anything not in that key — a
move number, a search-local flag — would do exactly that, silently, and would present as
non-determinism.**

The **open-file** term is deliberately left ungated: an open file beside an uncastled king is a
highway either way, and it is the only term still punishing a king left in the centre.

**Known, deferred, and now pinned: `queenProximity`.** A flat `-4 * (7 - kingDistance)` with no
attacker count and no shelter test, i.e. a standing bonus for parking a queen near the enemy king on
move 2 — which is why `Qg5`/`Qh5`/`Qd3` littered the principal variations. Most of that symptom was
bug 1 (the search could not see the sorties refuted) and is gone. The term is still wrong; the right
fix is a king-zone attack-unit table, not a tweak, and `AnalysisEval` already records that an
`isAttacked` sweep at every leaf measured too expensive. Its own follow-up, with its own before/after.

**Two gates were structurally blind, and that is the real finding.** The suite's only quiescence
assertion ran at `maxDepth: 2` — the single band in which quiescence still worked. `engine_strength_check`
scored 115/120 throughout, because its node budget caps most corpus positions at depth 5-6, again
below `maxQDepth`. `replay_engine_settings` stayed green too: it pins constants, and neither bug was
a constant. A green gate is not evidence the search is right.

**One thing nobody would ever have found:** `extendTail` calls `negamax` with `ply: 0`, so its
probes entered quiescence with a fresh budget and quiescence *worked there*. Users were shown a PV
whose head came from a search without quiescence and whose tail came from one with it — which is why
displayed lines sometimes appeared to change their mind after the extension. The two agree now.

### ELO / rating (Appendix C §2 — `PuzzleController::submitAnswer`, verified against source)
- K = 32, divisor 400, floor `max(400, …)`, no upper cap.
- `ratingChange = (int) round(32 * (actual - expected))`. PHP `round()` is
  half-away-from-zero → Swift `.rounded(.toNearestOrAwayFromZero)`.
- `compareMoves`: only the **first** move is compared (`user[0] == correct[0]`).

### Streak (Appendix C §5 — `StreakController`, verified)
- `INITIAL_RATING=600, RATING_STEP=50, RATING_MAX=2500, WARMUP_COUNT=10`.
- Warmup = `current_streak < 10` → target 600, theme `mateIn1`.
- increment: `current+=1`, `best=max(best,current)`, `puzzle_rating=min(2500, pr+50)`.
- reset: `current=0`, `puzzle_rating=600`, `pending=nil` (best untouched).

### Puzzle serving windows (Appendix C §4, verified)
- regular ±100, streak ±50, thematic ±200. `whereBetween` is **inclusive** on both ends.
- The `inRandomOrder()` primitive is non-deterministic and cannot be golden-matched; it is
  modelled as an **injected picker** so the app supplies randomness while the deterministic
  parts (window predicate, closest-by-ABS ordering, fallback-ladder stage transitions) are
  pinned by tests. `orderByRaw('ABS(rating - ?)')` ties break by ascending id (DB natural order).

### Daily limits (Appendix C §7 — `ChecksDailyLimits`, verified)
- Caps: `regular=5, streak=1, coach=2`, any `rush_*`=1, unknown mode → 1.
- `isAtDailyLimit` = premium ? false : `count >= max` (note **>=**).
- **DELIBERATE DEVIATION (§6 #5):** the server keys "today" by **UTC** (`Carbon::today()`);
  the app keys it by the **device-local `startOfDay`**. The pure limit function takes the
  count as input (day resolution injected), so this deviation lives only at the storage layer.
- The server's `self::DAILY_LIMITS['regular']` reference is a **latent bug** (undefined constant
  → HTTP 500). We reproduce the *intended* value 5 and never the bug.

### Daily goal (Appendix C §9 — `DailyGoalController`, verified)
- `daily_target = 10` (hard-coded literal).
- `calculateStreak`: consecutive days ending today (or yesterday if today unsolved),
  365-day lookback, ported verbatim including the `date < checkDate → break` gap rule.

### Tournaments (Appendix D — `TournamentController`, verified)
- **The entire Swiss + Round-Robin algorithm is deterministic** — the "random" mentioned in
  comments never fires — so it is golden-tested end-to-end against PHP.
- Swiss R1: rating-sort (nulls last) top-vs-bottom split with color alternation, else
  alphabetical fold; R≥2: score groups (numeric desc) → Buchholz then rating → BYE to lowest
  scorer without a prior BYE → greedy first-fit rematch avoidance → single color-swap pass.
- **Sorting parity:** Laravel Collection sorts are **stable** (PHP 8) and compare numeric
  strings **numerically** (SORT_REGULAR). Swift `sort` is **not** stable, so every sort here
  tie-breaks by original input index to reproduce Laravel order exactly.
- **DELIBERATE DEVIATION (sanctioned by Appendix D):** score-group keys are ordered
  **numerically**, not by string. Under SORT_REGULAR the server is also numeric for realistic
  scores, so this matches the server and avoids the theoretical ≥10-point string-sort bug.
- Scoring: win +1, draw +0.5, BYE +1 (& `byes++`). `applyResult`/`reverseResult` are exact inverses.
- Tiebreaks: `direct_encounter` (points vs equal-scored opponents, ε=0.01, `round(_,1)`),
  `buchholz = (int)round(Σ opp score)`, `sonneborn_berger = (int)round(Σ full/half opp score)`.
- Standings order: score → direct_encounter → buchholz → sonneborn_berger → wins (all desc),
  final tie-break by id asc.
- Limits: FREE_MAX_PLAYERS=10, FREE_MAX_ROUNDS=3; premium 999 players / 30 rounds.

### Position key / transposition hashing (Analysis Board — `ChessEngine::fenNormalized`, deviates)
- The canonical key is the **4-field FEN with a dead en-passant square cleared**
  (`oracle_position_key` in `tools/oracle/chess_oracle.php`; mirrored by `ChessPosition.positionKey`
  in Swift and `Engine.positionKey` in JS — all three must agree byte for byte). It keys the ECO
  book **and** threefold repetition.
- **DELIBERATE DEVIATION (analysis board):** the server's `fenNormalized()` keeps the ep square after
  *any* double pawn push, so `1. e4 e5 2. Nf3` and `1. Nf3 e5 2. e4` hash differently despite being
  the same position. That was measured, not theorised — all three of the most common transpositions
  in chess failed on the first build. Clearing a dead ep square is the standard EPD/X-FEN convention
  (what Lichess and Polyglot books do), it is required by the spec's acceptance criterion 8, and it
  also makes threefold repetition FIDE-correct instead of off by one occurrence. 73 ECO positions
  merged as a result; live ep squares are still preserved (`1. e4 c5 2. e5 d5` keeps `d6`).
- The availability test is the **presence of a capturing pawn (pseudo-legal)**, not full legality: a
  pawn pinned against its own king still counts. Chosen so the rule is trivially identical in PHP,
  Swift and JavaScript; the pinned-pawn case cannot change an opening name.

### The `book` classification tier (Analysis Board — `ReviewAnnotator.swift`, no server counterpart)
- **The server could never produce `book`** — it had no opening database, so `classifyMove` has nine tiers
  and `emptyClassifications` nine keys. The offline app has a bundled ECO book, so the tier finally becomes
  meaningful. It is applied as a **post-layer**: `GameReview.swift` is untouched, and `annotate` relabels
  in-book plies and recomputes the two count dictionaries with a tenth key.
- **Accuracy is never recomputed.** Book moves still count toward it. Chess.com excludes them; the server
  did not, and behavioural parity was the locked decision.
- **DELIBERATE DEVIATION (client bug fixed):** the React Native `CLASSIFICATION_ORDER`
  (`constants/classifications.ts`) has only **nine** entries — `book` is missing — while the three
  `Record<MoveClassification, …>` maps beside it have ten. Since `board.tsx` and `play.tsx` iterate that
  order to build the summary table, book moves were counted and then **never displayed**.
  `ReviewAnnotator.displayOrder` inserts `book` after `great`, per the spec.
- A ply is `book` iff the position **after** it is in the book — `positions[i].positionKey`.
- Locked by `review_book`, which reuses the 303 `game_review*` golden cases: an empty book must leave
  `moveEvaluations` and every count untouched (plus `book: 0`), counts must sum to the classified plies, and
  one book ply must move exactly one count out of its tier.

### Opening book (Analysis Board — `OpeningBook.swift`, replaces the Lichess masters explorer)
- Keyed by `positionKey`, so transpositions resolve. Two row kinds: **named** (an ECO line ends there) and
  **pass-through** (a line traverses it, empty name). Both are "in book"; only named rows change the
  displayed opening, and a miss keeps the **last known** name (spec Part 12.2).
- **Pure, no file IO.** Giving the Parity Core a resource would create a `Bundle.module` in a manifest that
  cannot be compile-verified on the development machine, so the caller supplies the TSV text.
- The TSV's pass-through rows end in a trailing tab with an empty name, so the split must keep the empty
  final field — `omittingEmptySubsequences: false`.
- `ParityRunner` reads `Goldens/eco_book.tsv`, a byte copy of the shipped book made by `build_eco.php`, so
  the group exercises the real parser on the real file. (`build_eco.php` had advertised a ParityRunner `eco`
  group since phase 0; none existed until now.)

### Analysis search (Analysis Board — `LocalEngine.swift`, no server counterpart)
- The server's engine was Stockfish behind an HTTP service; there is nothing to port. `LocalEngine` is a
  **new** interim search built on `ChessAI`'s reusable leaf pieces (`mate`, `material`, `evaluate`,
  `ordered` — all `internal`, none modified). `ChessAI.negamax` returns only an `Int` with no hook for a
  best move, so the recursion is reimplemented: a principal variation cannot be recovered from it.
- **DELIBERATE DEVIATION (API shape):** the engine protocol is **synchronous**, not `actor` +
  `AsyncThrowingStream`. Core contains no other concurrency, the package builds in Swift 6 language mode
  with complete strict concurrency (module-level mutable state is a compile error), and `ParityRunner` is
  synchronous top-level code — so a synchronous engine is the one the parity suite can assert. Cancellation
  and progress are closures, following the `PuzzleServing.Picker` precedent. The `actor` wrapper belongs in
  the UI layer.
- **Limits are depth and nodes, never wall-clock time**, so results are reproducible in a test. A caller
  wanting a deadline implements it inside `shouldCancel`.
- **MultiPV needs no root exclusion.** `ChessAI.bestMove` already searches each root move with a fresh full
  window and no alpha propagation, so every root move gets an exact score rather than a bound; the top-k
  lines fall out of sorting one pass. Only root-level cutoffs are forfeited.
- Deliberately absent: transposition table, killers, history, aspiration windows, null-move, LMR. Dropping
  the table also makes determinism true by construction rather than by a flag.
- **`ChessAI.captureScore` must not be reused as a quiescence filter.** It detects a capture purely by "is
  there a piece on `m.to`", so it scores en-passant captures *and* promotions as quiet. `LocalEngine`
  carries its own `isTactical`. It also force-unwraps `pos.squares[m.from]!`, so it must never be handed a
  move from a different position.
- `ChessAI.negamax`'s depth guard is `== 0` and would recurse forever on a negative depth (safe only
  because its single caller cannot pass one). `LocalEngine` uses `<= 0`.
- **The `evalMate: 0` guard.** A terminal checkmate converts to `evalCp: ±10000` with `evalMate: nil`,
  never `evalMate: 0`. The Python service emits 0 for a mated position and PHP's `normalizeEval` prefers
  `eval_mate`, so it returns `-10000` no matter who delivered mate. Routing through `evalCp` produces the
  value the PHP *intended*. Standing rule: do not reproduce latent server bugs. Locked by a named assertion
  in the `search` group.
- **The `search` and `movetree` mate/flatten tables are hand-authored** — no oracle exists. Mate
  expectations came from an *independent brute-force checker*, not from the search itself; deriving rather
  than guessing corrected four wrong entries on the first attempt.

### PGN (Analysis Board — `PGN.swift`, partly oracle-verified)
- PGN is the **persistence format**, mirroring `analysis_sessions.pgn`, so the round trip must be exact and
  variations must survive it.
- `splitGames` and the tokeniser strip pipeline are pinned by the oracle-derived `pgn_split` / `pgn_tokens`
  goldens. **RAV structure has no oracle** — `PgnImportService::tokenizeMoves` discards variations — so it
  is covered by round-trip fixpoint plus a canonical-output corpus shared with the JS twin.
- Canonical output hugs parentheses (`(1... c5 2. Nf3)`). The earlier spaced form round-tripped correctly,
  which is why only deriving the expected output caught it.
- Nested variations are re-nested flat on output when they are siblings: `1. e4 e5 (1... c5 (1... e6 2. d4)
  2. Nf3)` serialises as `1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4)`. Semantically identical — both are
  alternatives to `1... e5` — and a fixpoint.
- A parse error keeps the **partial** tree and reports the failing ply, so an import can say "34 of 41".
  Null moves (`--`, `Z0`) are rejected deliberately.

### SAN / UCI parsing (Analysis Board — `ChessNotation.swift`, oracle-verified)
- **Two tiers, both load-bearing.** Tier 1 generates SAN for every legal move with `san(for:)` — the
  very generator being inverted — and compares. That makes the inverse correct *by construction*, so
  parser and generator cannot drift; it resolves all 3,105 golden cases on its own. Tier 2 is a
  tolerant structural re-read for spellings real PGN exporters emit but we never produce. It is not
  speculative: tier 1 was measured against `Nbd2`, `N1d2`, `Nb1d2`, `Nb1-d2`, `ed5`, `e4xd5`, `a8Q`
  and `a8(Q)` and misses **every** one.
- **DELIBERATE DEVIATION (mechanism, not semantics):** the JavaScript twin implements tier 2 with a
  regex; the Swift uses a hand-rolled character scanner over `Array(san)`. Written on a machine with
  no Swift toolchain, ~30 extra lines were worth removing every question about `Regex` literal
  availability, `NSRegularExpression` off-Darwin, and `String.Index` arithmetic. The grammar is
  identical and both are pinned by the same goldens.
- An unspecified promotion defaults to **queen** (`a8` ≡ `a8=Q`), the universal convention.
  `k`/`K` is rejected as a promotion target in both parsers.
- Parsing returns `nil`, never throws — Core contains no `throws` anywhere.
- **`ChessPosition.Status` is deliberately NOT widened** with draw cases. It is a four-case enum
  switched on exhaustively by `SoundManager.playMove` and the Play/Puzzle views; widening it would
  be a source-breaking change to a module the parity suite cannot compile. Draws live in the
  parallel `drawReason` / `terminalOutcome` API on both sides.
- **`draw_rules` and `notation_extra` have no server counterpart.** `ChessEngine.php` states plainly
  that it skips check/checkmate/stalemate/50-move/repetition. Both groups are therefore hardcoded
  tables, following the `perft` and `chess_ai` precedent. Their expected values are hand-reasoned
  rather than captured from the JS twin's output, so the two languages assert *independent*
  expectations of the same chess facts; the labels are kept identical so the tables can be diffed by
  eye. (The 58 Swift-side expectations were separately replayed through the twin before shipping.)
- **K+N+N vs K is NOT treated as insufficient material** — mate is unforceable but not impossible,
  and FIDE keeps the game live. K/K, K+B/K, K+N/K and any single-colour-complex bishop set are.

### SAN parsing oracle (Analysis Board — the real `App\Services\ChessEngine`, verified)
- `tools/oracle/chess_oracle.php` loads the **actual** Laravel class rather than extracting it. It is
  framework-free, so this is strictly more faithful, and it makes the `san_parse` goldens and the ECO
  book keys consistent by construction. All 3,810 ECO lines (~30,000 plies) replay through it cleanly.
- **Oracle limits — do not copy these into the port:**
  - `applyMoveSan` strips `+ # ! ?` without validating them, so it cannot pin check/mate suffixes.
  - It returns `'san' => $original`, echoing its input, so it is **not** an oracle for SAN
    *generation* — `ChessBoard.san(for:)` owns that. The third golden assertion is therefore a
    generate→parse **round-trip**, not string equality; the corpus may legitimately spell a
    disambiguation less minimally than Swift generates it.
  - `wouldLeaveKingInCheck` does not remove the en-passant-captured pawn, so an ep-pin edge case can
    resolve wrongly. It only bites when two candidates remain and one is an ep capture; no such
    position exists in the corpus.
  - It assumes input legality (no check/stalemate/50-move/repetition rules at all).
- `PgnImportService::tokenizeMoves` **discards** `( … )` variations, so `pgn_tokens` pins mainline
  extraction only. RAV structure has no oracle and is covered by round-trip properties instead. The
  tokeniser also leaves `!`/`?` attached to SAN tokens — stripping them is the SAN parser's job.

### Game review (Appendix E §4 — `GameReviewController`, verified)
- `normalizeEval` mate folding: White `10000 - mate*10`, Black `-10000 - mate*10`.
- `classifyMove` ladder (brilliant/great/best/excellent/good/inaccuracy/mistake/miss/blunder)
  ported top-to-bottom, first match wins.
- `isBrilliantMove`: SAN contains `x` AND improvement ≥ 150 (matches code, not the docstring).
- `evalToWinPct`: `50 + 50*(2/(1+10^(-eval/400)) - 1)`; accuracy = `round(mean, 1)`.

### Analysis Board metrics (Analysis Board — `AnalysisMetrics.swift`, extracted from the RN source)
- **Ground truth is `board.tsx`'s StyleSheet, not the written spec.** `tools/metrics/extract_board_styles.js`
  walks the TypeScript AST and emits `tools/metrics/board_styles.json` — 7 blocks, 328 keys, 1,355 property
  values, **zero unresolved**. Both the Swift check and the JS suite assert against that file.
- Why: the spec says "eval bar height 3", but the source has **two** eval bars — `evalBarTrack.height = 8`
  (under the board) and `engineEvalBarTrack.height = 3` (per engine line). Prose had already lost the
  distinction.
- `board_styles.json` is **committed**, unlike `Goldens/`, because it derives from a sibling repo the reader
  may not have — the same reasoning that commits `eco.tsv`.
- **DELIBERATE DEVIATION — band heights are flexible, not seven fixed literals.** Seven fixed heights
  overflow a 375×667 SE. The panels band flexes down from its 230 max and the board band absorbs the slack;
  the sum is asserted at 375×667, 390×844 and 430×932.
- **DELIBERATE DEVIATION — the ⩲/⩱ eval symbols are swapped in the original.** `board.tsx:221-222` maps
  `⩱`→"Slight advantage White" and `⩲`→"Slight advantage Black", backwards from standard notation. The port
  uses the standard meanings and excludes those two rows from the `board_styles.json` comparison.
- **DELIBERATE DEVIATION — `CLASSIFICATION_ORDER` gains `book`.** The original array has 9 entries against a
  10-key table, so `book` moves were counted and then never displayed.
- The ~15 render-function multipliers (arrow shaft `0.18` / head `0.35` / shorten `0.7` / head half-width
  `0.6`; badge radius `0.21`, offset `0.29`, shadow `+1.5`, ring `+1.5`, baseline `0.37`) are hand-transcribed
  with line numbers, because they live in render functions rather than a StyleSheet. Note `delayLongPress={400}`
  appears six times as a JSX prop — a bare `400` grep conflates it with the animation duration.

### Analysis session (Analysis Board — `AnalysisSession.swift`, no server counterpart)
- **The screen's behaviour lives in Core, not the view model.** `statusText`, opening tracking, arrows,
  engine rows, the move-strip tokens and the staleness rule are pure functions of state, so they are
  asserted by `ParityRunner`'s `analysis_session` group (95 assertions, floor 80) *and* by the JS twin —
  leaving only SwiftUI's rendering unverifiable. Hand-authored on both sides like `draw_rules`, with
  expectations derived from the RN source's line numbers; there is no PHP oracle for a screen.
- **DELIBERATE DEVIATION — cancel-and-restart, not skip.** `analyzePosition` guards with
  `if (isAnalyzing || fen === lastAnalyzedFen) return;` (`board.tsx:885`). Its fetch could not be
  cancelled, so a position change mid-request was silently dropped and the panel showed stale lines
  forever. Our engine is cancellable, so `isStale` triggers a restart. Same rule as the `evalMate: 0`
  case: port the intended behaviour, not the accident.
- **DELIBERATE DEVIATION — the status line's move number** comes from the position's `fullmove`, not
  `floor(node.halfMoveIndex / 2) + 1` (`board.tsx:2861`). The original shows the number of the move just
  *played*, so after 1.e4 e5 it reads "1." when the next move is 2.
- **DELIBERATE DEVIATION — "(analyzing)"** tracks a real in-flight search. The original appends it on
  `isAnalyzing || autoAnalyze` (`board.tsx:2868`), so it shows permanently whenever auto-analyse is on.
- **DELIBERATE DEVIATION — the masters panel becomes the ECO explorer.** `renderMasterDB` was a Lichess
  call; band 6 now lists `OpeningBook.continuations(from:)`.
- `evalParts` is the Core/UI boundary: mapping a score to a bar fraction or a ⩲ symbol needs the metrics
  tables, which live in the UI module and cannot be reached from a Foundation-only Core. The session
  publishes raw numbers and each platform maps them with the same table.
- `AnalysisSession` is **not `Sendable`** (it owns a `MoveTree`), so it stays `@MainActor`; only
  `ChessPosition` / `SearchLimits` / `AnalysisSnapshot` cross to the background search.

### Game review UI (Analysis Board — `ReviewAnnotator.Evaluator`, no server counterpart)
- **Stepping, not one blocking loop.** A 40-move game costs **28 s at a fixed depth 3**, so
  `Evaluator` (and `BiyaReview.reviewSteps`) evaluate one position per call. That lets the caller give
  each position a **200 ms** wall-clock budget through `shouldCancel` and yield between steps, so the
  UI paints and Cancel lands at once. `evaluate(_:engine:limits:)` is untouched — `review_book` and
  `review_demo.js` still use it.
- `Evaluator` holds `[ChessPosition]`, **not** the whole `Plan`: a `Plan` carries `[MoveNode]`, a
  reference graph that is not `Sendable`, which would pin the walk to one isolation domain.
- **`GameReview.Evaluation` gained `Sendable`.** A three-field value type of `Int?`/`String?`; the
  conformance is behaviour-free, no golden is affected, and it is what lets a review run off the main
  actor. Public structs do not get it implicitly.
- **The index rule.** `moveEvaluations[].moveIndex` is 1-based (0 = the starting position) while the
  plan's nodes are 0-based, so the node is `nodes[moveIndex - 1]` — the same `- 1` at
  `applyClassificationsToTree` (board.tsx:1827). Main line only; variations stay unclassified. Both
  suites assert it with a hand-built result rather than an engine's.
- A cancelled run leaves the evaluations **short**; `isComplete` is the guard that stops a caller
  mistaking that for a truncated game. Nothing is stamped on a cancel.
- **DELIBERATE DEVIATION — one action does both halves.** The original splits review across two
  incomplete paths: `runAccuracyAnalysis` (board.tsx:2254) shows the modal but *discards*
  `move_evaluations`, so the strip stays blank; `handleAnalyzeGame` (:1854) stamps the strip but shows
  only an `Alert` — no modal, no graph, no cancel. Ours does both from one run.
- **DELIBERATE DEVIATION — no classification badge on the board.** `renderAnnotationOverlay` (:2661)
  draws the *manual* PGN glyph for the selected node and never reads `reviewClassification`;
  classifications appear only in the move strip. `AnalysisBadge` stays unused until Phase 11 wires it
  to the annotation picker it was written for.
- **DELIBERATE DEVIATION — the third modal state is "Not enough moves".** Offline the engine cannot be
  unreachable, so the source's "Analysis unavailable" (429/503/network) has no counterpart. The
  minimum-3-positions guard (:2256) is kept; there is no maximum, as in the source.
- Classification quality at depth 2–3 is coarse: `classifyMove`'s thresholds were written for a
  depth-12 Stockfish. A property of the interim engine, not the port.

### Persistence (Analysis Board — `AnalysisStore.swift`, mirrors the Laravel schema)
- **RESOLVED DECISION — plain `Codable` JSON, not SwiftData.** This is the app's first writable
  persistence, so it sets the idiom. Codable is already the house style across Core; it carries no
  macro risk on a checkout with no compiler; and because the browser mirror stores localStorage JSON,
  **both languages can assert one canonical library document**, which a `ModelContainer` could never
  be. The record shapes are unchanged by a later SwiftData port, so the swap is mechanical.
- Records mirror `analysis_sessions` / `analysis_folders` so a future sync stays possible. The field
  limits are the **controller's `validate()` rules**, not the column widths — they are tighter
  (`white_player` is varchar(255), validated `max:100`), so they are the contract.
- **Deleting a folder UNFILES its sessions** (`nullOnDelete`, plus an explicit null pass at
  `AnalysisSessionController:417`). Default folders refuse rename and delete (403). Three defaults
  are seeded lazily with the controller's exact names, colours and sort order.
- Time is an **injected parameter**, never `Date()` inside the logic — the `PuzzleServing.Picker`
  precedent, and what makes the 24-hour draft TTL assertable.
- **DELIBERATE DEVIATION — three source bugs not reproduced.** `initial_fen` is never sent on save
  (board.tsx:1026-1043) and `generatePgn()` emits no `[FEN]`, so a custom-setup game does not survive
  a round trip there; `@biyaherong_openfile_draft` is written (:840) and read nowhere, losing unsaved
  edits to an opened game; and the save modal has no Title field although the column is NOT NULL.
- **DELIBERATE DEVIATION — no free-session cap** (the server allows 3 for non-premium; offline there
  are no accounts), **no `share_token`/`is_shared`**, and **no `move_annotations`** — the server needs
  that column because its client serialises movetext only, while ours emits NAG suffixes inline, so
  it would be a second copy of what the PGN already carries. A sync layer can derive it.
- **DELIBERATE DEVIATION — search is in the library sheet.** The original has it only on the sibling
  `saved.tsx` browser; this rebuild has one screen.
- Byte-identical re-encoding is **not** claimed across languages: `JSONEncoder(.sortedKeys)` sorts
  keys and `JSON.stringify` does not. Each side asserts its own fixpoint; the shared claim is the
  decoded values, guarded by `tools/qa/canonical_library_check.js`.

### Setup Position (Analysis Board — `PositionEditor.swift`, partly no server counterpart)

The original validates a hand-built board in two places: `validateKingPositions:334` checks for a missing
king and for adjacent kings, and `toggleEditMode:2448` hands the FEN to `new Chess(fen)` and catches the
throw. **There is no chess.js offline**, so the second half had to be written down rather than inherited.

**RESOLVED DECISION — the validator carries five rules, not two.** `PositionEditor.validate()` refuses a
missing king, two kings of one colour, adjacent kings, a pawn on rank 1 or 8, and the side *not* to move
already being in check. That is the set `new Chess(fen)` would have rejected, so behaviour matches the
original without the dependency. The first two messages are the source's strings verbatim; the rest are
new. Issues come back in a fixed order so the banner does not flicker.

- **DELIBERATE DEVIATION — castling rights are normalised silently.** A right whose king or rook is not on
  its home square is dropped when the FEN is emitted (the X-FEN convention), not reported as an error.
  Ticking `⬜K` on a board with no h1 rook is a statement of intent; refusing would be a dead end with no
  obvious fix, and the source's chess.js is lenient here too.
- The editor never emits an en-passant square and always emits fresh clocks (`0 1`), matching what
  `new Chess(fen)` produces for a position it did not reach by playing moves.
- **The adjacency test walks every king pair**, not just the first of each colour: on a board that already
  has a duplicate king, checking only `whiteKings[0]` would let a real adjacency hide behind the count
  error. Asserted in both languages.
- **The `.trim()` in `loadFEN` is load-bearing in Swift only.** `ChessPosition(fen:)` splits on the space
  character alone, so a FEN pasted from a web page with a leading tab would be refused; `engine.js` splits
  on `/\s+/` and does not care. Removing it is therefore an **equivalent mutant in JavaScript** — recorded
  here because the JS mutation suite reports it as a survivor, and it is not a coverage hole. The
  assertion that kills it lives in the Swift `position_editor` group.

### Annotations and the badge (Analysis Board — `AnalysisSession`, no server counterpart)

**RESOLVED DECISION — annotations are stored as NAG codes, not symbol strings.** The source keeps
`node.annotation = "!!"`. `MoveNode.nag: Int` already existed and `PGN` already round-trips `$n`, so a
symbol string would be a second encoding of the same fact. `AnalysisSession.nagSymbols` is the single
table and `nag(forSymbol:)` is derived from it, so the two directions cannot disagree.

- **DELIBERATE DEVIATION — the ⩲/⩱ inversion is corrected in `POSITION_ANNOTATIONS` too.** The source
  labels `⩱` "Slight edge White" and `⩲` "Slight edge Black" (`board.tsx:231-239`), backwards from
  standard notation — the same swap already recorded for `EVAL_SYMBOLS`. It matters more here: the picker
  writes NAGs into the exported PGN, so shipping the swap would emit `$15` where `$14` is meant and every
  other chess program would read the position backwards. Asserted in both languages, and the
  extracted-source check asserts that the *source* really does have it that way.
- `$13` (∞) is display-only: it can arrive in an imported PGN, but the source's picker has no button for
  it, so ours does not either.
- **Ported as-is, not "fixed":** the badge draws for **move-quality annotations only** — the overlay looks
  the symbol up in `MOVE_ANNOTATIONS` alone, so `±` shows in the move strip and nothing on the board. And
  it reads the **manual** annotation, never the review classification.

**BUG IN THIS REBUILD, now fixed and structurally prevented.** The badge was drawn upper-right. The source
puts it bottom-right: `squareToPixel` returns the square's **centre** and `renderAnnotationOverlay`
adds `+ SQUARE_SIZE * 0.29` to both axes. Swift and JavaScript had the same wrong sign and each asserted
the other's answer — two hand-typed copies agreeing is not verification. Prevented rather than merely
corrected: `extract_board_styles.js` gained a **`renderConstants`** section that flattens every
`const NAME = <expr>` and braced JSX attribute in the four geometry render functions into *signed* additive
terms, so both harnesses assert the direction of an offset and not only its magnitude. That retires the
last hand-transcribed set of constants in this feature.

### Variations and PGN I/O (Analysis Board — no server counterpart)

- **DELIBERATE DEVIATION — the variation card has two types, not three.** The source's third,
  `GM REFERENCE`, keys off `node.isGmGame`, which only the Lichess masters explorer ever set; that panel
  became the bundled ECO book in Phase 8, so nothing can produce the flag.
- **ASSUMPTION (recorded) — a multi-game PGN loads its first game** and reports how many it found. The
  source does the same thing silently.
- **DELIBERATE DEVIATION — an import that yields nothing does not touch the board.** `PGN.parse` is
  tolerant by design: hand it a paragraph and it returns a zero-move game full of parse errors rather than
  refusing. That is right for a parser and wrong for an import, so `importPGN` counts a game only if it
  produced at least one move **or** a custom start position. A setup-only PGN is a legitimate import.
- **DELIBERATE DEVIATION — export replaces the OS share sheet.** The source calls `Share.share`, which has
  no offline counterpart; ours shows the text to copy and offers `.fileExporter` (a `.pgn` download in the
  browser). Same intent.
- Long-pressing a **branch chip** opens the variation card rather than the annotation picker. The source
  reaches the card from a separate `varManageBtn`; folding it into the same gesture is an addition, and it
  is the useful action on a chip.

### Where the engine runs (web-demo — REVERSES the Phase 4 "no Web Workers" decision)

**RESOLVED DECISION, CHANGED.** Phase 4 ruled Web Workers out entirely: on `file://` a document has
an opaque origin, `new Worker` throws, and the blob-URL and `data:` workarounds inherit the same
origin and fail identically. That reasoning was correct and still is. Treating it as a *blanket* rule
was not, and a user reported the cost: the search ran on the main thread one whole depth per
uninterrupted block — measured at **624 ms (depth 3) and 2,885 ms (depth 4)** on a midgame position,
during which no piece could slide, no drag could track and no click could register.

`web-demo/js/engine-host.js` now picks per page: a real Worker when the page is served (the path the
README recommends first), the in-thread engine when `new Worker` throws. The `file://` promise is
kept exactly as Phase 4 wanted; what changed is that a served page is no longer punished for it.

- **The in-thread path is sliced.** Each depth gets its own deadline (`inlineSearchBudgetMs = 80`),
  passed to the search's `shouldCancel`, which the engine polls every 2048 nodes — so the block is
  cut from the INSIDE and cannot overrun. Worst measured chunk: **94 ms**, still reaching depth 2 in
  a sharp midgame and depth 5 in a quiet endgame. `analyzeProgressive` could not do this: it builds
  its cancel closure once, so `engine-host` drives `analyzeSteps` directly to reset the deadline.
- **No engine file was modified.** `engine.js` closes over
  `typeof window !== 'undefined' ? window : globalThis` — the worker's `self` — and `ai.js` and
  `analysis-engine.js` declare bare globals. `importScripts` therefore just works, and the worker
  thread runs code byte-identical to what the golden suite proves. `worker_protocol_check.js`
  asserts the two paths return the same ranked moves, so they cannot drift into a split brain.
- **Import ORDER is load-bearing:** `analysis-engine.js` reads `CoachAI` at load, so `ai.js` must
  come first. Getting it wrong throws at worker startup, `engine-host` degrades silently, and the
  page keeps the slow path with no visible error. That is exactly the bug
  `worker_protocol_check.js` caught on its first run, and why that check exists.
- **Play goes through the host too.** `CoachAI.bestMoveAsync` was `setTimeout(0)` plus a fully
  synchronous search, so its "async" bought nothing.

### Piece animation (web-demo + Swift — no server counterpart)

**DELIBERATE DEVIATION.** The RN board animates with a Reanimated spring, which has no extractable
duration, so there is nothing to port and the number is invented: **170 ms, ease-out, no overshoot**
— between lichess (~200) and chess.com (~150). This rebuild had `.33s cubic-bezier(.34,1.15,.64,1)`,
a springy third of a second, and the bounce was most of what read as sluggish. Exposed as
`--piece-anim` so `<chess-board>` stays a themeable drop-in; Swift shares one
`AnalysisTiming.pieceMove` across the three boards that previously each had their own spring.

**A drop lands where it was released.** The board used to snap the piece home on `pointerup` and then
slide it to the target once the app repainted, so a drag ended with the piece jumping back and
travelling. chess.com and lichess leave it. Ported as behaviour, not as a source detail — the RN
board's drag is `DragDropChessBoard`, which we replaced wholesale.

### The eval bar is VERTICAL and beside the board (Analysis Board — building the source's comment)

**DELIBERATE DEVIATION — and the smallest one available.** The client asked for the eval bar on the
side, *"tulad lichess or chesscom"*. The RN source's `renderEvalBar` settles what "correct" means
here, because it points both ways at once:

```
board.tsx:2738-2741
  // ══════════════════════════════════════════════
  // RENDER EVAL BAR (vertical, DroidFish-style)
  // ══════════════════════════════════════════════
  const renderEvalBar = () => {
```

The comment says **vertical**. The style beneath it says `evalBarContainer { flexDirection: 'row' }`,
with `evalBarTrack { flex: 1, height: 8 }` and `evalBarWhite` animated on **width** — horizontal.
And `grep -n renderEvalBar board.tsx` returns exactly **one** hit, the declaration: it is never
called, so the RN app renders no eval bar at all. Dead, like `styles.statusLine` and
`styles.menuContainer`.

So there is no shipped behaviour to be differentially correct against, and the two halves of the
source disagree. We build **the comment**: a vertical rail, left, fixed.

**The numbers are not invented.** All five come from that same abandoned `evalBar*` block, which
means every one is pinned by `matches(...)` in `AnalysisMetricsCheck` and `same(...)` in
`analysis-metrics.js`, and resolves in `swift_source_keys.js` with no change to that gate:

| rail property | source key | value |
|---|---|---|
| track | `evalBarTrack.height` | 8 |
| padding either side | `evalBarContainer.paddingHorizontal` | 6 |
| **width** = track + 2 × padding | *derived from the two above* | **20** |
| gap to the board | `evalBarContainer.gap` | 5 |
| corner radius | `evalBarTrack.borderRadius` | 4 |
| label inset | `evalBarContainer.paddingVertical` | 2 |
| label face (the CAP) | `evalBarText.fontSize` / `fontWeight` / `fontFamily` | 11 · 800 · Menlo |

**The width is the source component's own cross-axis thickness, stood on end.** `evalBarContainer`
is a row holding an 8pt track with 6pt of padding either side, so the thing is 20pt thick. Rotate
it and that is the rail.

It shipped at **32** for one round — `evalBarText.minWidth`, which is the source's minimum for the
**label**, not for the bar — and the client's answer was *"panipisan lang ng konti masyado ata
makapal"*. Sizing a bar to its own caption is the error; 32 is still the right number for the text
and the wrong one for the rail. Recorded because the wrong reading was defensible: both numbers sit
in the same block, and `minWidth: 32` is the more obvious one to reach for.

**The label is fitted to the rail, not the other way round.** `labelFontSize` is whatever fits four
glyphs across the rail, capped at the source's 11; on a 20pt rail the budget binds and it draws at
8⅓pt (4 × 8⅓ × 0.6 = 20.0 exactly). Four glyphs covers `+0.5`, `-0.3`, `M-3`, `1-0`, `½-½` —
everything a real game produces short of a ten-pawn rout, and `+10.5` shrinks 4/5 rather than
clipping.

That number is **shared between the two renderers on purpose**. CSS has no `minimumScaleFactor`:
hand the browser the source's 11px and it clips `-0.3` inside a 20px rail while SwiftUI quietly
shrinks it — the two screens disagreeing with every metrics assertion still green. Both gates pin
it (`board_layout_check.js` §2d, `swift_layout_check.js` §4d) and three mutants prove they bite.

**A DECLARED deviation, not a derived one:** the rail is narrower than `evalBarText.minWidth`
(20 < 32). The source value is still asserted, next to `railWidth < 32` and
`labelFontSize < evalBarText.fontSize`, so the gap stays visible and an accidental drift is still
caught. This is the `deviates()` precedent, written out longhand because that helper only expresses
"bigger than the source" and this one is smaller.

**What is deliberately NOT taken from the source:** the axis (row → column, above), and the fill
colours. `AnalysisPalette.evalTrack` / `evalFill` are `#2A3540` / `#DEDEDE` where the source says
`#333333` / `#F5F5F5`; those two were already invented before this change and still carry no
`same()` assertion. Left as they were — re-colouring the bar was not what was asked for.

**Consequences that are decisions, not accidents:**

- **The side is FIXED.** Flipping the board does not move the rail, and White always fills from the
  bottom. Lichess mirrors its bar; Chess.com does not; we do not. `EngineScore` is documented
  "Always White-relative", so nothing connects the flip to the rail and the gate asserts nothing
  will. With Black at the bottom, the white block is still at the bottom — intended.
- **`AnalysisEval.mainHeight` (8) is load-bearing** — it is the track inside the rail, and
  `railWidth` is built from it. For one round it was retired-but-kept, on the argument that
  `matches("evalBarTrack", "height", …)` is the only pin on `evalBarTrack` and deleting the
  constant would delete that assertion on the very change that started reading the block. Keeping
  it is what made the 20pt derivation available a round later: the case for not deleting an
  assertion to make a change fit, paying for itself.
- **The board is narrower and the engine panel is taller.** 25pt off the width (389.33 → 362.67 at
  390@3x; squares 48.67 → 45.33, 6.9%), and the §10d row floors were **raised** to match — a
  375×667 SE goes from 4 single-line engine rows to 5 and from 2 wrapped to 3, met exactly.
- **…and only while the engine is ON.** `toggleEngine` drops the snapshot when it switches the
  engine off, so the rail would show a dead 50/50 track with no number; the client asked for it to
  go and for the board to take the space. `AnalysisBoard.edge(screenWidth:pixelRatio:engineOn:)` is
  the single chooser and **both** the board band and `enginePlan` call it — two call sites picking
  the branch for themselves is how the engine panel ends up budgeted against a board that is not on
  screen, which shows up as a missing engine row and nothing else. In the browser the rail is
  `display: none` and never `visibility`: a hidden-but-present rail keeps its 20px *and*
  `.an-board`'s 5px gap, so the board gains nothing and the row sits off-centre by half of both.

### The status line's own row (Analysis Board — deviation from `statusToolbarRow`)

**DELIBERATE DEVIATION.** The source puts the status text and the toolbar on one row
(`styles.statusToolbarRow`, `board.tsx:4617`). This rebuild gives the status text a row of its own.

The reason is measured, not aesthetic: nine emoji buttons come to **346 pt inside a 365 pt card**,
leaving the status ~19 pt, and it disappears completely — a user reported the screen with no status
text at all. RN's icon glyphs are narrower than the emoji this port uses for the same buttons, which
is why one row works there and not here.

The numbers are **not invented**. `styles.statusLine` is a block the source declares for exactly this
standalone row — `minHeight: 36`, `paddingHorizontal: 12`, `paddingVertical: 6`, its own top border —
and then never renders: dead, like `renderEvalBar:2741` and `styles.menuContainer`. So the layout is
the original's own abandoned one, restored with its own values and pinned to `board_styles.json` like
every other constant. The metrics check also asserts that the two rows really do differ in the source
(36 vs 38), so the two blocks cannot be conflated later.

### Band flexing (Analysis Board — a bug in this rebuild, now guarded)

**BUG IN THIS REBUILD, fixed and structurally prevented.** The board must be a fixed square derived
from the screen's **width**, and the ECO panel must be the band that absorbs slack. It was the other
way round, and the screen visibly broke: the browser sized the board
`min(100cqw, calc(100cqh - …))` inside a `flex: 1 1 auto` band, so its width tracked the leftover
height — and bands 6 and 7 change height on every move as ECO and engine rows appear. The board grew
and shrank as you played, and never filled the card. The Swift screen had a milder form: the board
band claimed `maxHeight: .infinity` while the opening panel was capped.

`AnalysisLayout.bands(viewportHeight:boardEdge:)` / `MET.bandLayout(...)` already encoded the correct
rule and was already asserted at three screen sizes — **neither renderer called it.** That is the
lesson worth keeping: a pure function that nothing calls is not a guarantee, it is documentation.

Guarded three ways now: the metrics suites assert the board edge is a pure function of width
(identical at five viewport heights) and that a short screen caps the *panels* band rather than the
board; and `tools/qa/board_layout_check.js` asserts the CSS itself — `flex: none`, no
`container-type`, no surviving `cq` unit, and `.an-panels` genuinely shrinkable. Reintroducing the
original two declarations trips five of those assertions. Before it existed, every suite in the repo
was green while the screen was wrong, because nothing looked at a stylesheet.

### The toolbar row (Analysis Board — `AnalysisBoardScreen.swift`)

**DELIBERATE DEVIATION, then reverted.** Phases 9 and 10 added 💾 🔬 📂 to the toolbar because the ☰ menu
was still a stand-in. Once the real menu existed, eleven buttons measured **437 pt inside a 365 pt card** —
overflowing by 72 and squeezing the status line into three wrapped lines that collided with them. The row
is now the source's nine, with Save, Load and Analyze Game in ☰ where the source keeps them.

The toolbar's ✏️ is the source's: it opens the **annotation picker for the current move**
(`board.tsx:4626`) and is disabled at the root. Edit Board is a ☰ item only.

Edit mode hides the status row, the strip, the autoplay bar and the engine lines, following
`board.tsx:4616` ("to maximise board space"), and the board takes the fixed `BOARD_SIZE` square its
`editBoard` style specifies.

### Haptics (Analysis Board — `Haptics.swift`)

`board.tsx` contains no haptics. But it renders `DragDropChessBoard`, which fires
`Haptics.impactAsync(ImpactFeedbackStyle.Light)` on **drag pickup** (`DragDropChessBoard.tsx:351`) after
its piece-exists and correct-colour guards — so the analysis board has exactly one, by inheritance.

- **PORTED:** `.pickUp` — a Light impact when a piece is picked up.
- **ADDITIONS (agreed with the user):** `.move` (soft, on a quiet move), `.capture` (medium, on a capture
  or a check), `.success` (a notification when a game review finishes).

Nothing else fires. Navigation, menu items and modals are deliberately silent: a haptic on every tap is
noise, and the source has none of them either. macOS is a no-op, which is why this is in the UI layer and
not in Core.

### The `tap` event on `<chess-board>` (web-demo only)

Setup Position needs "which square did you touch" with no notion of a legal move, and `square-select` only
fires when a square has targets. So the component gained a `tap` event that fires for **every** square,
before any selection logic and regardless of `interactive`. Purely additive — nothing else listens for it,
so Play and Puzzles cannot change behaviour — and the component suite covers empty squares, a
non-interactive board, and the fact that the click a completed drag leaves behind fires no phantom tap.

### Extracted-metrics traps (`board_styles.json`)
- **Folded screen dimensions.** The extractor evaluates `Dimensions.get()` against a 390×844
  reference, so `screenHeight * 0.80` lands as the literal `675.2` — right on one phone and wrong on
  every other, and indistinguishable from an ordinary constant. It now emits **`_deviceDerived`**
  listing every value that is a tidy multiple of the reference. Three exist:
  `accModalStyles.card.maxHeight` (H×0.8), `styles.menuContainer.width` (W×0.65, Phase 11) and
  `sidebarStyles.container.width` (W×0.68). **Encode the ratio**, and assert it by reproducing the
  literal at the reference height.
- **Values outside a StyleSheet are invisible to the AST walk.** `components/EvalGraph.tsx` draws its
  own SVG, so its colours live in JSX attributes. A mutation test caught the gap — changing the
  graph's background to the wrapper's colour survived every assertion. The graph paints `#1A2740`
  inside a wrapper already painted `#0F1A2E`; the extractor now scans that file too.
- **A merged lookup can shadow.** The header title was transcribed as 20, which is
  `sidebarStyles.headerTitle`; this screen's `styles.headerTitle` is 16. Every typography key is now
  pinned to the `styles` block specifically.
- **Geometry inside a render function was invisible too, and that one actually shipped wrong.** The
  annotation badge's radius and corner offsets live in `renderAnnotationOverlay`, not in any
  StyleSheet, so they were hand-transcribed — and the y offset was transcribed with the wrong SIGN in
  both languages, each asserting the other's answer. `renderConstants` now flattens every
  `const NAME = <expr>` and braced JSX attribute in `squareToPixel`, `renderArrowsOverlay`,
  `renderAnnotationOverlay` and `renderEditSquare` into **signed additive terms**, so a consumer
  asserts the direction of an offset and not merely its size. `squareToPixel` is extracted alongside
  them because it defines the anchor every one of those offsets is measured from — it returns the
  square's CENTRE, which is the fact the wrong sign came from missing.
- **Bare module constants were unpinned.** The walk only captured ALL-CAPS arrays and objects, so
  `EDIT_PALETTE_PIECE_SIZE = 26` was as mistypeable as any StyleSheet value. Numbers and strings are
  captured now too.

### Analysis screen presentation (Analysis Board — `PhoneView.swift`, no server counterpart)
- **`.fullScreenCover` does not exist on macOS**, and `PhoneApp` renders inside the macOS demo
  (`AppShell.swift:46`). The screen is a **`ZStack` sibling** over the existing `VStack`, which also
  covers `PhoneTabBar` — a plain VStack sibling, not a real `TabView`. Using the iOS-only API would
  have broken the `swift build` this work is verified by.
- The web mirror matches: `current = 'analysis'` renders into `#view` (so teardown stays automatic) and
  `.app-card.an-mode` hides the tab bar.
- **`PGN.tokenize` was `public` while `PGN.Token` is internal** — a hard compile error that meant the Core
  module had never compiled. Fixed by making `tokenize` internal, and `tools/qa/swift_lint.js` now flags
  the whole class of error.

### Board view extension (Analysis Board — `BoardView` in `PlayView.swift`, no server counterpart)
- **`BoardView` is extended, not forked.** All four call sites pass every argument by label ending at
  `onTap:`, never as a trailing closure, so appending defaulted parameters is source-compatible.
  `phoneBoard(_ board: BoardView, …)` takes the **concrete** type, so stored properties are fine but a
  generic parameter would break it.
- **New stored properties are never `private`.** `private let x = <value>` is omitted from the memberwise
  initializer (SE-0242) and so does not downgrade its access — which is why the two colour constants could be
  private. A **`private var`** *is* included, would make the init private, and would break the cross-file call
  sites in `PhoneView.swift` and `PuzzleView.swift`.
- **Drag attaches to the board-level `ZStack`, never to pieces** — `pieceLayer` is `allowsHitTesting(false)`,
  so a piece gesture never fires. It is disabled via
  `.gesture(dragGesture, including: onDragMove == nil ? .subviews : .all)`; a plain `if` would change the
  body's return type and need an `AnyView` box.
- **`BoardStyle` carries a fill mode, not just colours.** The spec's highlights *replace* the square fill;
  today's board *overlays* translucent rectangles. `replacesFill` picks between two models. Its defaults
  reproduce today's exact inline values, so Play and Puzzles render identically.
- **JS (`<chess-board>`) — three hazards, all confirmed by measurement:** the tap path is a delegated `click`
  on `.squares`, so any layer above it must be `pointer-events:none`; `.piece` has `transition:transform .33s`,
  so the drag ghost needs `transition:none`; and `attributeChangedCallback` early-returns while `!_built`
  while `app.js` sets properties *before* `appendChild`, so new attributes must also be read in
  `connectedCallback`.
- The arrow overlay uses `viewBox="0 0 8 8"` — one unit per square — so geometry is resolution-independent and
  survives resize and flip with no `getBoundingClientRect`. `chess-board.js` deliberately does **not** depend
  on `analysis-metrics.js` (the component must stand alone); the duplicated ratios and colours are asserted
  equal in `tools/qa/board_component_test.js`.

---

## Adversarial audit outcomes (7-agent independent source comparison)

A parallel audit read the real Laravel controllers against each Swift port. The arithmetic
engines (ELO, streak, daily limits/goal) verified MATCH with no divergences. Four reachable
divergences were found and **fixed**, then locked with golden tests derived from real PHP:

1. **Swiss R1 rating sort — `null` vs `0`.** `sortByDesc('ncfp_rating')` under SORT_REGULAR treats
   `null` as EQUAL to `0` (both coerce to 0), stable. The port had ranked explicit `0` before `null`.
   Fixed to `(rating ?? 0)` in `Tournament.swift` + oracle. Locked by `r1_rated_null_zero`.
   (Reachable: `ncfp_rating` validates `min:0`, so `0` is a legal rating.)
2. **Swiss R1 name sort — SORT_REGULAR vs Swift `<`.** Laravel `sortBy('name')` compares numeric-string
   names numerically (`"9" < "10"`) and other names **byte-wise** (not Unicode-canonical, which matters
   for accented Filipino names). Implemented `phpRegularCompare` in `PHPCompat.swift`. Locked by
   `r1_unrated_numeric_names` and `r1_unrated_accented`.
3. **Thematic serving ladder is a hybrid.** `getThematicPuzzle` is window-random → any-unseen-random →
   reset-**closest-by-ABS** (deterministic), matching neither prior Swift method. Added
   `PuzzleServing.serveThematic`. Locked by the `serving` golden set (`thematic_*`).
4. **Game-review `san == "0"` truthiness + terminal `didReset`.** PHP `if(!$color || !$san) continue`
   treats the string `"0"` as falsy (SAN is never literally "0", but reproduced for exactness); and the
   stage-3 seen-reset is UNCONDITIONAL, so `didReset` is true even on an empty pool. Fixed via
   `phpStringIsTruthy` and terminal `didReset: true`. Locked by game-review case C and `serving` `*_none`.

**Documented deviations (deliberate, not bugs):**
- **Standings full-tie order.** The server SQL has no tie-break beyond the 5 keys, so MySQL returns
  fully-tied rows in an undefined (non-deterministic) order. The Swift `standingsSorted` appends a
  final **id-ascending** tie-break for a stable, deterministic ordering — an intentional improvement.
- **`recalculateTiebreakers` caller contract.** Buchholz depends on being fed EVERY non-bye pairing,
  including still-pending future rounds (the server loads all pairings; round-robin generates the full
  schedule up front). The offline caller MUST pass all persisted pairings for parity.
- **Player-id / rating assumptions.** Player ids are ≥1 (SwiftData/DB PKs), so PHP's `!$oppId`
  (skips id 0) and the input-order-is-id-order assumption hold. `generateRoundRobinPairings` also
  guards against an empty player list (the controller returns 422 before ever calling it).

## QA pass (quality assurance of the parity core)

A dedicated QA pass validated not just the ports but the *verification itself*:

- **Harness integrity.** Added per-group assertion tracking and `requireMinCounts` — the suite
  now fails if any mandatory group falls below its expected assertion floor, guarding against
  both empty and *truncated* goldens (a whole batch silently contributing too few checks). Every
  `zip` is preceded by a count assertion; the `tiebreakers` loop gained a count check + a
  nil-guarded lookup; the daily-goal date parser uses `en_US_POSIX` and asserts no date was
  silently dropped.
- **Mutation testing** (`tools/qa/mutation_test.py`). 41 deliberate faults injected one at a time;
  **40 killed, 1 provably-equivalent survivor** (`dailygoal_gap_branch`: the `== checkDate` branch
  makes `<=` identical to `<`). Two real coverage holes were found (classifier `great`/`blunder`
  boundaries) and closed with a full `classifyMove` boundary grid.
- **Coverage gaps closed.** `reverseResult` (previously never exercised — scenarios only apply,
  never edit a result), `roundRobinRounds`, `swissTotalRounds`, `dayKey`, and `dailyTarget` are
  now tested (groups `scoring` / `misc`).
- **New pure functions ported** (found un-ported by the coverage audit; all offline-computable and
  user-facing): `RatingTier.classify` (Expert/Advanced/Intermediate/Beginner/Novice at
  2000/1600/1200/800, from `ShareController::rating`); `PuzzleRush.bestScore` (strict-greater,
  nil→0) + `PuzzleRush.modeLabel` (0→Infinite/3→3-minute/5→5-minute); `TournamentEngine.swissTotalRounds`.
- **Oracle integrity: CLEAN.** An independent audit confirmed the PHP golden generator does not
  drift from the real controllers (bye-scoring timing, recalc-all-pairings, score-group ordering,
  serving stage order all faithful).
- **Build hygiene.** Clean build, zero warnings; removed dead code (unused `StreakEngine.servingWindow`,
  a no-op line in `DailyLimits.dayKey`).

Suite total after QA: **30,258 assertions across 27 groups**, all green.

## Invented tuning constants (new §8 features)

These have **no server counterpart** — nothing in `../BYAHERONG-COACH-LARAVEL` or the Python Stockfish
service produces them, so they cannot be oracle-verified. They are recorded here rather than left as bare
literals. Changing one changes behaviour but breaks no parity group.

### Analysis search (`LocalEngine.swift` / `AnalysisEngine.swift`)

| Constant | Value | Why |
|---|---|---|
| `SearchLimits.maxDepth` default | `4` | a depth the interim negamax reaches interactively; the review path overrides it |
| `SearchLimits.multiPV` default | `1` | degrades to plain alpha-beta, which is what the 121-position review path wants |
| `LocalEngine.maxQDepth` | `6` | caps the quiescence search; without quiescence, depth-3 lines are noise |
| `LocalEngine.deltaMargin` | `200` cp | delta (futility) pruning margin inside quiescence |
| node-check interval | 2048 nodes | how often cancellation and the node budget are tested |

Deliberately **not** implemented: aspiration windows, null-move, LMR, bitboards, make/unmake, and a
transposition table. They are performance, not correctness; on code that cannot be compiled or profiled here,
the simplest correct search is the right trade. Dropping the TT also makes determinism true by construction
rather than by a flag.

### Analysis Board timings (`AnalysisMetrics.swift` → `AnalysisTiming`)

| Constant | Value | Source |
|---|---|---|
| `analysisDebounceMs` | `300` | from the RN source |
| `draftAutosaveMs` | `800` | from the RN source |
| `evalBarAnimationMs` | `400` | from the RN source |
| `doubleTapWindowMs` | `350` | from the RN source |
| `longPressDelayMs` | `400` | from the RN source (`delayLongPress`, six JSX sites — not the same 400 as the animation) |
| `draftTTLHours` | `24` | **invented** — how long an unsaved draft survives |
| `uiCoalesceMs` | `100` | **invented** — at most one engine-progress UI update per interval, so a fast search does not thrash SwiftUI |
| `engineDeadlineMs` | `1200` | **invented** — wall-clock budget for one interactive search, enforced inside `shouldCancel` (see below) |
| `reviewDeadlineMs` | `200` | **invented** — wall-clock budget for ONE position of a game review (see below) |
| `screenPresentMs` | `250` | **invented** — the slide-up when the Analysis Board covers the tab bar |

**Why the engine is bounded by a deadline and not a depth cap.** Measured in the browser with the
in-repo search at multiPV 3: depth 4 costs **173 ms** in an endgame and **2794 ms** in a midgame — a
15× spread, on top of ~6× per ply. Any fixed `maxDepth` is therefore either unusably slow in sharp
positions or needlessly shallow in quiet ones. A deadline inside `shouldCancel` (polled every 2048
nodes) reaches depth 4+ where it is cheap, stops at 3 where it is not, and holds total wall time to
within ~15 ms of the budget. `AnalysisEngineLimits.maxDepth` is only a ceiling.

**Those two are now the BALANCED preset, not the only setting** (2026-08-13). `EngineSettings`
introduces five presets and an Advanced section; `engineDeadlineMs` / `reviewDeadlineMs` /
`AnalysisEngineLimits` remain as the defaults an untouched install runs on, and
`AnalysisMetricsCheck` asserts they still equal `EngineSettings.resolve(EngineSettings.defaults())`
so the two files cannot drift. The invented constants that came with it:

| Constant | Value | Why |
|---|---|---|
| the five presets | 0.5 / 1.2 / 3 / 8 s and ∞ | **invented** — measured depths in `docs/engine-settings.md`; Balanced reproduces the old behaviour exactly |
| `maxDepth` ceilings | `8 / 12 / 18 / 22 / 30` | **invented** — each set just above the depth its own budget reaches, so the ceiling binds only in cheap endgames |
| `reviewDivisor` = 6, floor 120, ceiling 1200 | — | **invented** — the per-position review budget is DERIVED from the interactive one rather than listed, and the derivation reproduces all five intended values |
| `thinkInfinite` = `0` | — | **invented** — no deadline at all. The depth ceiling is then the only thing that terminates the search, which is why every preset still carries one |
| `linesMin/Max` 1–5, `depthMin/Max` 2–30, `thinkMin/Max` 0.2–30 s | — | **invented** — the Advanced ranges |
| `thinkStep` = 100 ms, slider min = `thinkMin - thinkStep` | — | **invented** — Infinite is the bottom step of the Think time slider, so a slider and a separate Infinite toggle cannot disagree |
| `biya.analysis.engine.v1` | — | **invented** — the storage key, versioned like `biya.coach.takeback.v1` |
| `AnalysisEngineStyle.*` | — | **invented** — the panel's geometry. Named `…Style` and not `…Panel` because `AnalysisEnginePanel` is already the engine-LINES band on the board |

**DELIBERATE DEVIATION — Infinite does not apply to Analyze Game.** A 41-position review with no
per-position deadline would never finish, so `reviewBudget(0)` saturates at `reviewMax` (1200 ms)
instead. The panel says so in its own warning text rather than leaving it to be discovered.

**DELIBERATE DEVIATION — the analysis engine has its own evaluation.** `AnalysisEval` (tapered
mid/endgame scoring, pawn structure, king safety, mobility, bishop pair, rook files, tempo) sits
**beside** `ChessAI.evaluate`, exactly as `CoachEngine` sits beside `ChessAI`. `ChessAI.evaluate` is
parity-pinned to the five coach personas and is **not modified**: it is still material plus one
piece-square table, and the coaches play exactly as they did. `AnalysisEval` reuses `ChessAI`'s
material values and midgame tables *by reference* rather than copying them, so the shared half
cannot drift. Units and sign convention are unchanged (pawn = 100, side-to-move relative), which is
what lets the eval bar, `classifyMove`'s thresholds and `ReviewAnnotator` keep working untouched.

**The engine identifier moved to `local-negamax-v2`.** The search gained a transposition table,
killers and history, principal-variation search, check extensions, null-move pruning and late move
reductions. It is still deterministic — the table is per-search and cleared by size, never by clock —
and `engine_strength_check.js` asserts both that and a solve-rate floor over the puzzle corpus,
because null-move and LMR are the two features that can silently lose a tactic without failing any
structural assertion.

**Zobrist keys differ between the two languages, on purpose.** The JS twin splits every key into two
32-bit halves because JavaScript's bitwise operators truncate to 32 bits; Swift uses one `UInt64`
from SplitMix64. The table is a per-search accelerator that never reaches any output, so nothing
compares the two, and forcing them to agree would buy nothing.

**Why the review budget is 200 ms.** Same argument, per position. Measured on a 40-move game
(41 positions) in Node: a fixed depth 3 costs **28 s**; with a per-position deadline, 100 ms gives
5.0 s at mostly depth 2, **200 ms gives ~9 s at depth 2–3**, and 400 ms gives 17.4 s at mostly
depth 3. In the browser the stepper measures 207–232 ms per position, so a 40-move game takes ~18 s —
inside the original's own "This may take 20–30 seconds" promise (board.tsx:3831), and now with a real
progress bar rather than a static string.

### Board interaction (`chess-board.js`, `BoardView`)

| Constant | Value | Why |
|---|---|---|
| drag threshold | `4` px | below this a press stays a tap, so tap-to-move is never hijacked; the same value in both languages |
| review position guard | ~400 plies | the original's 200-position server cap is gone, so an absurd PGN still needs a bound |

---

## Puzzle Hub (spec Parts 3–5, 7, 11, 15, 17)

### Resolved decisions

| Decision | Why |
|---|---|
| **Codable + JSON, not SwiftData** for Part 4's records | The record *shapes* are the spec's, field for field; only the mechanism differs. The app already persists the Analysis Board's library as Codable + JSON (`AnalysisStore` + `AnalysisLibraryFile`) and a second persistence stack would buy nothing — and would put the Parity Core one import away from a framework it is not allowed to have. |
| **`WITHOUT ROWID`** on `puzzle_themes` and `theme_rating_index` | A storage class, not a schema change: columns, constraints and every Part 7 query are identical. It is the whole difference between the spec's literal schema at **50 MB** and the **33 MB** that fits its own stated 25–35 MB budget. Both composite keys are genuinely unique (432,507 rows, 432,507 distinct). Two of the spec's four declared indexes are now those primary keys and are not restated. |
| **The corpus lands at 92,976**, not the spec's estimated 95,000–105,000 | The spec's own step-2 arithmetic fixes the base at 22 × 4,000 = 88,000, and every later step (theme quotas, warmup, rare sweep) is a *floor*, not a target. The rules were implemented as written; the prose was an over-estimate. |
| **The rare-theme set is computed, not read from the spec's list** | The rule is "fewer than 1,000 rows in the raw corpus". `anastasiaMate` (636) satisfies it and is absent from the spec's hand-written list of twelve. The build prints a note whenever the computed set and the documented list disagree. |
| **The 2600–2800 tail is not a band** | The spec fixes both "22 bands" (400–2600) and a 2800 rating ceiling. They only reconcile if the tail enters through the theme quotas and the rare sweep, which is what it does — 195 puzzles, enough that a 2700-rated user's ±100 window is not void. |
| **`Rating.compareMoves` stays, and is never called** | It is a faithful port of the server's first-move-only comparator and is pinned by the `compare_moves` goldens. It is also spec fix #10. Keeping it preserves parity; calling it would reintroduce the bug. Enforced by assertions in `replay_puzzle_core.js` and `puzzle_core_test.js`. |
| **Spec fix #7 (scope the Tier-3 wipe) lives in the caller** | `PuzzleServing` never wiped anything: it takes `seen` as an argument and *reports* `didReset` as a flag. Scoping in `PuzzleSelection.scopeForReset` leaves the golden-pinned ladder byte-identical. |
| **Part 17 beats Part 5.3 on the Daily opponent delay** | 5.3 says "500 ms everywhere except Puzzle Turbo"; Part 17's table gives Daily **400 ms**. The table titled *master* wins. |
| **There is no embedded Stockfish** | Parts 0 and 18 assume one exists from the Analysis Board. It does not — no `.cpp`, `.xcframework` or NNUE anywhere in the tree. The engine panel will use `LocalEngine`/`AnalysisEngine` with the Analysis Board's measured limits, not Part 18's depth-20 / 1000 ms. |
| **A replay earns no daily-goal credit** | Part 8 bundles the ledger row, the Elo, the `ThemeStat` bump and the goal counter under "on the first `finish()` for a puzzle". The alternative would let a user farm a 10-a-day goal by replaying one puzzle. |
| **The daily puzzle is not marked seen** | It is a pure function of the date, and marking it would make today's puzzle unavailable to whichever other mode had not served it yet. |
| **SQL tier-1/tier-2 return a bounded sample (256 rows)** | `ArrayPool` hands the picker every eligible candidate; a 93k corpus cannot. `ORDER BY RANDOM() LIMIT n` is a uniform random subset, so a uniform pick from it is uniform overall — and emptiness, the only thing the ladder branches on, is preserved exactly. |

### Invented constants

| Constant | Value | Why |
|---|---|---|
| `MIN_NB_PLAYS` | `50` | Below this a Lichess puzzle's rating has not settled. Spec Part 3.2. |
| `PER_BAND` | `4000` | Spec Part 3.2. All 22 bands hold more than this, so the base is exactly 88,000. |
| `quality` | `popularity × log10(max(nb_plays, 10))` | Spec Part 3.2. **Quantised to an integer (×10⁶) before it is used as a sort key** — `log10` is the one place a platform's libm could differ in the last ULP and silently reorder two rows across machines. |
| `DAILY_SHUFFLE_SEED` | `0x81723F5A0C219E4D` | Invented, and fixed forever: changing it reshuffles every past and future date. Consumed by a splitmix64 Fisher–Yates written out in the build script rather than `random.shuffle`, so the pool does not depend on the CPython version. |
| `dailyEpoch` | `2026-01-01`, **local** | Spec Part 11.1. Fixed forever for the same reason. |
| `sampleLimit` | `256` | Invented — how many rows a SQL tier query materialises before the picker chooses. See the decision above. |
| slice sizes | 60/band, 80/theme, 120 warmup, 400 daily | Invented — the browser demo's corpus slice. 400 daily entries so the demo's Daily mode covers a year without wrapping. |

### Deviations from the corpus's own convention

The bundled corpus follows Lichess: **`moves[0]` belongs to the opponent**. The demo's older
`web-demo/js/puzzles.js` sample set uses the opposite convention (`solution[0]` is the solver's).
The two are not interchangeable; the Puzzle Hub reads only `puzzle-data.js`.

### Puzzle Hub screens (spec Parts 9, 10, 15, 18, 19)

Every screen number comes from `tools/metrics/extract_puzzle_styles.js` walking the eleven RN
puzzle screens into `tools/metrics/puzzle_styles.json`, exactly as the Analysis Board's numbers come
from `board_styles.json`. Where the spec's prose and the source disagree, **the source wins** and
the disagreement is recorded here.

| Spec says | The source says | Resolution |
|---|---|---|
| Part 1: one "standard header", `paddingTop 10, paddingBottom 6` | Eight distinct header shapes across eleven screens. Hub `paddingVertical 10`; rated solver `paddingVertical 8`; Play Puzzles home `paddingTop 10 / paddingBottom 6` | Encoded **per screen**. `replay_puzzle_core.js` asserts the hub and solver stay different, so the three cannot be folded into one constant later |
| Part 10.3: "Next Puzzle →" has top margin 8 | `marginBottom: 8` in the StyleSheet **and** an inline `marginTop: 8` at three call sites | Both encoded (`nextMarginTop`, `nextMarginBottom`) |
| Part 9.2: mode tiles at "13% alpha" / "33% alpha" | `mode.color + '22'` / `+ '55'` — hex bytes, i.e. 13.33% / 33.33% | The bytes are encoded, not the rounded percentages |
| Part 9.2: hub accents `#A855F7` / `#4A90E2` / `#FF6B35` for Thematic / Turbo / Streak | The screens themselves use `#8E24AA` / `#1E88E5` / `#F4511E` | **Unified onto the screen colours** (the spec's own fix 9.2a). `PuzzleHub.sourceHex` keeps what the source had so the deviation stays checkable |
| Part 9.2: the folder is `puzzle-rush` | The user-facing name is Puzzle Turbo | Swift types are `Turbo…`; "rush" never appears in UI copy |
| Part 18: depth 20 / 1000 ms Stockfish | There is no Stockfish in this repo | `LocalEngine` through `engine-host`, at the Analysis Board's measured limits |
| Part 0: typography | The RN original loads Nunito but never applies it on a puzzle screen | These screens use the **system font**, not `Theme.nunito` |

### Invented constants — Puzzle Hub screens

Nothing below has an RN source, so `selfTestSource` cannot assert it. Each is either new design in
the spec or a browser-only necessity.

| Constant | Value | Why |
|---|---|---|
| `PuzzleGoalStrip.*` | radius 14, ring 44/5, pill 20/10/5, … | Part 15.2 is **new design** — the server had a `/api/daily-goal` endpoint the mobile app never called, so there is no StyleSheet to extract |
| `PuzzleStatsStyle.*` | card 16/16/12, spark 52, bars 80/4/28, … | Part 10.1's stats **replace** the leaderboard, so the source's geometry is for a different screen |
| `PuzzleStats.sparkYMargin` | `25` | Spec Part 10.1. Without it a flat rating history clips to both edges of the box |
| `PuzzleStats.sparkMinPoints` | `2` | **Invented.** A one-point polyline is an invisible dot that reads as a bug, so fewer than two points renders nothing |
| `statsEmpty` copy | "Solve your first puzzle to start tracking your stats." | **Invented**, agreed with the user: on day one the rating card renders and the four data-driven cards collapse to one line, rather than showing four blank charts |
| `PuzzleStore.sampleLimit` | `256` | See the Phase A table — the SQL pool materialises a bounded uniform sample rather than the whole match set |

### The layering boundary for `PuzzleStats`

`PuzzleStats` is in Core and is Foundation-only, so it holds no presentation constants: the two
functions that produce geometry (`sparkline`, `activity`) take their pixel sizes as **parameters**
and the UI passes them from `PuzzleStatsStyle`. What stays in Core are the domain numbers — how
many attempts a sparkline looks back over, how many theme rows there is room for. Same boundary
`AnalysisSession` draws when it publishes raw numbers for each platform's metrics table to map.
`replay_puzzle_core.js` asserts that no `Color(` and no pixel constant appears in the file.

### Puzzle Hub — Daily and Thematic (spec Parts 11, 12)

| Spec says | The source says | Resolution |
|---|---|---|
| Part 11.2: hero subtitle "A new puzzle every day — powered by Chess.com" | the same, plus a `CHESSCOM_API` constant and a credit link | Subtitle changed to **"always offline"**; the credit link and the hostname are deleted. Part 22.2 forbids any hostname in this feature, and the metrics suite asserts the source HAD one so the deletion stays recorded |
| Part 11.3: Daily's opponent delay is 400 ms, "a small original inconsistency — pick one and be consistent" | `dailySolver` has no `COMPUTER_MOVE_DELAY`; Part 17 gives Daily 400 | **400**, per Part 17, already encoded in `PuzzleSession.Timing` since Phase A |
| Part 12: Thematic is premium-gated | `thematicGrid` has `lockOverlay`, `lockIcon`, `lockTitle`, `lockSub`, `gridLocked`, `premiumBadge` | All deleted (one-time purchase). Asserted that they were present, so the removal is a decision on record |
| Part 12.1: the twelve theme labels | `thematicGrid.THEMES`, with labels **and** tile colours | Extracted, not typed. The emoji in Fork, Skewer, Mate in 1 and Middlegame carry U+FE0F and the one in Mate in 2 does not; both languages assert that |
| Part 18: one engine panel | `thematicSolver` has `padding: 12` and `engineLineRow.paddingVertical: 5` where `playSolver` has 8 and 3 | Encoded separately, with an assertion that they really differ — sharing one set of numbers is the obvious shortcut and it would be wrong |

### Invented constants — Daily and Thematic

None. Every number on these four screens came out of `puzzle_styles.json`.

### Decisions

| Decision | Why |
|---|---|
| `puzzle-board.js` is a **factory**, not a singleton | `puzzle-solver.js` is an IIFE with twelve module-level variables. Two solvers alive at once — a Turbo run behind a results overlay, say — would share `session`, `timers` and `engineToken` |
| Each mode keeps its own chrome | Part 1 says build the *core* once, and `PuzzleSession` is that. The RN source has four separate solver files because the chrome is genuinely all that differs: Daily a banner, Thematic a stats bar, Streak a result overlay, Turbo a clock and lives |
| `bottomPanel` takes a mode and DERIVES from `WRONG_POLICY` | It was written phase-only for Play and offered Streak and Turbo a Retry their own policy forbids. Restating a fact that already has a home is how the two came to disagree |
| `hasEnginePanel` / `hasSaveSheet` are facts, not preferences | `puzzle_styles.json` carries `enginePanel*` only on `playSolver` and `thematicSolver`, and `savePuzzle*` only on `playSolver`. Offering those buttons elsewhere would be inventing UI |
| `rushBest` is keyed by **String** in both languages | JSON object keys are strings, so a numeric key in JS round-tripped to a string and the two sides disagreed about whether `rushBest[3]` and `rushBest["3"]` were the same slot |
| `RushEndReason` is enumerated in JS too | Swift's is an enum, so a typo there is a compile error. `'timesUp'` for `'timeUp'` would have passed silently and reached the results screen |
| The mutation harness runs **every** pure suite | Six mutants survived its first Phase-D run purely because it executed only `puzzle_core_test.js` while their assertions lived elsewhere. The tests were there; the harness was the gap |
| `TurboRun` is a **new** engine, not part of `PuzzleRush` | `PuzzleRush` is presentation (`modes`, `bestScore`, `modeLabel`). Turbo's lives, target rating and score span a whole run, and `PuzzleSession` resets per puzzle — so the whole of Part 14.2 lived nowhere |
| Turbo's warmup is **5**, Streak's is **10** | Both extracted from the RN source (`turboRun.moduleConstants.RUSH_WARMUP_COUNT` vs `StreakEngine.warmupCount`). They look like the same constant and are not |
| A wrong Turbo answer raises the target by **10** | `DIFFICULTY_STEP_WRONG` is positive in the source. A rush gets harder whatever you do; missing only slows the climb |
| Turbo's clock is derived from `startedAt`, never accumulated | Same rule as the rated timer. A delayed or dropped tick cannot drift a clock that is recomputed from a timestamp |
| `TurboRun.formatClock` is separate from `PuzzleDisplay.formatTime` | Turbo prints `3:00`, the rated screen prints `03:00`. Sharing one function would silently restyle one of them |
| `served()` guards on `startedAt == nil` **only** | The extra `puzzlesServed == 1` was redundant on a fresh run and wrong on a resumed one, where the count picks up mid-run. Caught by a *surviving* mutant — the suite saying the clause does nothing |
| `endStreakRun` **requires** `bestBefore` | `StreakEngine.increment` raises `bestStreak` during the run, so comparing at the end made `isNewBest` unreachable-false and the 🏆 badge dead. Passing it is now mandatory in both languages; omitting it throws |
| A scoreless rush run writes no history row | The rule `endStreakRun` already applied to a zero-length streak. An instant quit was polluting the mode-select screen's last-ten list |
| `highlightSolution` is its own board channel | Part 13.3 needs two tints so the reveal reads as a direction, and it must survive the next `paint()`, which rewrites the last-move squares from the session every time |
| The feedback dot's geometry is stored as **signed terms** | `left` subtracts its radius term and `top` adds its own. Two hand-typed copies agreeing with each other is not verification — this is the exact shape of the bug that shipped the annotation badge in the wrong corner in both languages |
| The board flip is **asymmetric** | `col = black ? 7 - file : file` but `row = black ? rank : 7 - rank`. Extracted, not reasoned about |
| Turbo owns the `pzr-` / `pzrr-` CSS prefix | Thematic already had `pzt-`; `.pzt-title` and `.pzt-card` would have been shared between two unrelated screens |
| The Part 22.2 offline scan excludes the SVG namespace and the metrics self-test | `createElementNS` needs `http://www.w3.org/2000/svg`, which is an XML identifier and not an address, and `puzzle-metrics.js` quotes the source's `api.chess.com` in order to prove the port dropped it. Asserting a URL is absent is not calling it |
| The puzzle path has **four** sounds, not six | `hooks/usePuzzleSound.ts` loads `gameStart`/`move`/`capture`/`gameOver` and nothing else, and `playMoveSound` is capture-or-move. `check.mp3` and `castling.mp3` ship and the hub never reaches them — the fuller chain is the Play screen's `SoundManager`. Pinned so it is not "fixed" |
| Sound names and delays are **extracted**, like every other constant | They were the last hand-typed values in the port, and three of the five screens had the sound wiring wrong precisely because nothing compared them to the source. `rn_ast.js` now collects `playSound`/`playMoveSound` calls with their enclosing function, and every `setTimeout` delay |
| A named delay that cannot be resolved is **fatal** | `setTimeout(fn, COMPUTER_MOVE_DELAY)` is an identifier, not a literal. Matching only literals silently dropped Streak entirely — a missing delay is invisible downstream, so the extractor exits rather than skipping |
| Streak and Turbo do not chime on a correct solve | Their `gameOver` marks a **run** ending (`endGame()` in Turbo, the failure branch in Streak). Play, Daily and Thematic are one-puzzle-at-a-time, so finishing *is* the event and they do chime |
| `endStreakRun` compares with `>=`, so a TIE shows 🏆 NEW BEST | Deliberate parity: the RN screen ends a run on `currentStreak >= bestStreak`. Its `>=` compensated for the server bumping the row mid-run; `bestBefore` removes the need for that, but the user-visible rule — matching your record is celebrated — is what the app does |
| `bestBefore` is kept even though `>=` makes it redundant | With `>=`, reading the live `bestStreak` is provably equivalent: `length >= max(b, length)` iff `length >= b`. `bestBefore` is kept because it does not depend on `increment` raising the best to exactly that maximum, so it survives a change to the ramp that the live read would not. The corresponding mutant was removed rather than left as a false coverage hole |
| One haptic, on **pickup**, in the shared board | `DragDropChessBoard.tsx:351` fires a single `ImpactFeedbackStyle.Light` after three guards — the square holds a piece, it belongs to the side to move, it passes the colour filter. `_targetsFrom()` is those three rolled into one. Never on drop, never on a right or wrong answer, and not per-screen |
| `navigator.vibrate` is a no-op on desktop and iOS Safari | Expected, not a gap. The web mirror exists so the call **site** is defined and asserted; `ios/` reaches the same decision through `PuzzleHaptics.onPickup`, and Android does feel it |
| Six CSS custom properties were deleted rather than wired | Each was computed from the extraction and written to a property nothing read — the goal ring already passes its track colour to the SVG `stroke` attribute, the banner uses per-state fills, no screen renders a loading state, and a one-line row has no gap. Styling a state that cannot appear would be inventing UI |
| The two promotion dialogs are **two views**, not one | `board.tsx` shows a horizontal row of unlabelled 60pt tiles over a 0.7 scrim titled "Promote to:"; the puzzle screens show a vertical list of labelled accent rows over 0.80/0.82 titled "Choose Promotion". Every extracted property differs. `AnalysisPromotion` and `PuzzlePromotion`, `PromotionOverlay` and `PuzzlePromotionOverlay`, and a `promotionLayout` on `<chess-board>` |
| `PuzzleHaptics` was deleted, not kept | `Haptics.swift` already ports the same `DragDropChessBoard.tsx:351` decision. Two sources of truth for one fact is the failure this project keeps hitting |
| `PuzzleHubStore` is internal, like every view in the package | Only `Roots.swift` is public. Declaring it public was also a compile error: `PuzzleStore.Puzzle` is internal and a public signature cannot name it |
| The Swift screens serve **only** through the store | `serve*` commits `seen` and persists in one step. A screen reaching the pool directly would mutate the in-memory set and never write it back, so the saved file would fork from the live one |
| The old sample puzzles live on at a **dev** entry | `AppShell`'s `Dev · Sample Puzzles`, mirroring `?dev=samples` in `web-demo`. They use the opposite move convention (`solution[0]` is the solver's, the corpus has `moves[0]` belonging to the opponent), so they cannot share the hub's solver. `PuzzlesPhone` was deleted outright — a second unreachable copy is one too many |
| The hub hero is a **glyph** standing in for an image | The source renders `PuzzleKnightImg`. Both twins substitute `♞`; it was briefly a puzzle piece in Swift and a knight in JS, which the string-parity check caught the moment it existed |
| `AnalysisSession.engineRows` is also a static | The puzzle suggestions panel is the same panel, and it has no session to hang off. Duplicating the formatting would mean two places to get `pvPreview` and `displayText` right |
| A mutation harness spanning two languages needs a **two-directory restore** | The per-mutant restore said `JS` after Swift files were added, so every Swift mutant was written into `web-demo/js/` as a stray while the real file kept its mutation. Four unrelated mutants then reported the same leaked failure. A restore that restores the wrong file reports kills that never happened |
| A positional check is not a semantic one | The lock-ordering assertion passed a mutant that disabled the guard with `if false`, because the text order was unchanged. The replay now asserts the condition itself |
| `<chess-board>` speaks square **indices**, everywhere | The engine does too. The puzzle rules adapter treated them as names — `E.sqIndex(12)` is `null` — so every square reported zero legal targets and **no puzzle mode accepted a move for five phases**. It now matches `analysis.js`'s adapter rather than inventing a third convention |
| Indices become names at **one** boundary | `PuzzleSession.submit` builds a UCI by string concatenation, so handing it indices computed `12 + 28` as arithmetic. `BiyaPuzzleBoard.moveFromEvent` converts once, in the listener, and `puzzle-solver.js` uses it rather than its own copy |
| A test that skips the component tests nothing | `board_component_test.js` drove the board with its *own* correct adapter and `puzzle_screen_test.js` called `submit()` with names directly, so both stayed green while the feature was dead. The end-to-end path — pointer → board → adapter → event → session — is now driven in `board_component_test.js`, which is where the real element lives |
| Tap-to-move is not optional on a phone | `PuzzleBoardBand` shipped with `onTap: { _ in }`, `legalTargets: []` and `lastMove: nil`: drag worked and tapping did nothing. The mirror of the web bug, in the other language |
| Selection clears on mount, retry and every submit | A stale selection ring would let the next tap submit from a square whose piece has already moved |
| Polish lives in a `--pzx-*` namespace | Transitions, press states and focus rings are not in the RN StyleSheets — React Native gets them from its components — so they are ours to choose. Keeping them out of `--pz*` means the CSS-var coverage check still treats the extracted properties as extracted |
| `PuzzleHub.pressOpacity` is finally read | Extracted in Phase C and unused until now, in both languages. The dim on press is the source's value; the scale alongside it is motion, which the extraction cannot express |
| `prefers-reduced-motion` is honoured | Every animation added is decoration, and someone who has asked the OS for less movement should get none of it |
| No loading state, again | The plan called for one and it was dropped on inspection: serving is synchronous from the bundled corpus, so the state cannot occur. Building it would be inventing UI for something no user can see — the same reason `--pz-loading-*` were deleted in Phase F |

## Pairing engine (Book Two, spec 1.7–1.9)

### Deviations from the spec's acceptance criteria

Both are deliberate, and both are because the criterion as written is **stricter than FIDE and not
satisfiable by any conforming engine**. See `docs/pairing-engine.md` for the worked reasoning.

- **Criterion 5, `|whites − blacks| ≤ 1` at the end of a Swiss.** Asserted as FIDE C.04.1 actually
  requires it: spread `≤ 2`, and never three of the same colour in a row. After round 1 of a
  12-player event where every White wins, six players share the history `[White]` and are each
  other's only same-score opponents — three of them must take White again no matter how they are
  paired. The Berger round robin *does* meet `≤ 1`, and is asserted at that strength.
- **Criterion 6, "no player floats down twice running."** FIDE relaxes this when no candidate
  satisfies it, and spec 1.7.6 says so itself. Asserted for fields of ten or more, at most one
  unavoidable occurrence per tournament, plus direct unit tests on `chooseFloater` and on the cost
  ordering `refloat > score` that produces the preference.

### Invented constants — the priority ladder

No PHP counterpart exists (the server has no cost function). The **ordering** is FIDE's; the values
are chosen only to separate the terms, and are exported as `P.costs` so the tests assert the order.

| Constant | Value | Rule it encodes |
|---|---|---|
| `COST_REPEAT` | `1e7` | never re-pair two players while any alternative exists |
| `COST_COLOR_ABSOLUTE` | `5e4` | C.04.1 absolute: spread past ±2, or a third colour running |
| `COST_REFLOAT` | `1.2e4` | above a score point — pair out of bracket rather than float twice |
| `COST_SCORE` | `1e4` | per point of score difference between the two players |
| `COST_COLOR_UNIT` | `1e2` | per unit of leftover colour imbalance |
| `NODE_BUDGET` | `200000` | branch-and-bound cutoff; above it the search returns its best so far |

### Decisions

- **Colour is priced on the imbalance a pairing LEAVES BEHIND, not on preference.** Preference is
  only ever a proxy for balance; matching on the proxy while assigning colours on the real thing is
  how the two came to disagree during development. One function, `bestOrientation`, is used by both.
- **Berger colours are assigned by a balancing pass, not derived from the rotation index.** Deriving
  them from the index is what the PHP does on board 1 and it does not balance — it handed one player
  White in all six games of a 7-player event. Ties in the pass go to whoever had Black last, then to
  id, so a schedule is reproducible.
- **Warnings are read off the result, not recorded during the search**, so a warning can never
  describe a pairing the engine did not actually make.
- **`chooseBye`'s bottom-bracket filter is provably a no-op** given the current score-descending
  ordering (brute-forced over 287,712 cases). Kept because it states the rule and stops being a
  no-op if the ordering changes; its mutant was removed rather than left as a false survivor.

## Pairing Manager — store and metrics (spec §1.1–1.6, §1.10)

### Deviations

- **SwiftData `@Model` → plain `Codable`.** Spec §1.1 declares four `@Model` classes. There is no
  SwiftData anywhere in this repo, and a `ModelContainer` is unreachable from every harness on this
  checkout, so the document is plain `Codable` JSON — the same decision already recorded for
  `AnalysisStore`/`AnalysisLibraryFile`. It is what lets the browser twin hold the identical shape
  in `localStorage` and both languages assert one canonical document.
- **"Results are locked when finished" admits one exception: clearing.** §1.10 says finished
  tournaments lock, and §1.5/§7 #23 add a Clear Result action. Taken literally the two cannot both
  hold: finishing is *caused* by the last result being entered, so a typo on the deciding board
  would lock instantly and Clear Result could never reach it. Implemented as: once finished, a
  result may not be **changed** to a different result, but it may be **cleared**, which returns the
  tournament to `.ongoing` and restores ordinary editing. Clearing is the deliberate "I got that
  wrong" action, so it is precisely the one that should survive the lock.
- **Aggregates are recomputed, never patched.** The server incremented counters in `applyResult`
  and decremented them in `reverseResult`. Three of the §7 defects (#11, #12, #17) are that pair
  drifting apart. `pairing-store.js` rebuilds every derived field from the rounds after each
  mutation, so there is no second representation to disagree — which is also why `clearResult` is
  the same code path as `setResult` with `'pending'`.
- **Status is computed, never stored** (§1.10 asks for this explicitly).

### Invented constants

| Constant | Value | Why |
|---|---|---|
| `LIMITS.nameMax` | 100 | §1.3 caps the name field; no RN counterpart (the server truncated at 255) |
| `LIMITS.roundsMin/Max` | 1 / 30 | §1.3's clamp. The RN screen turned a typed `0` into 3 silently and let `99` reach a 422 |
| `LIMITS.ratingMin/Max` | 0 / 3000 | the range the bulk parser already enforced (`[id].tsx:173`) |
| `STR.lockedTitle` / `lockedBody` | — | §1.4 says to *say* players are locked instead of silently refetching; no source string existed |
| `STR.deletedTitle` / `deletedBody` | — | §7 #19's empty state for a deleted tournament |

### Extraction notes

- `tools/metrics/extract_tournament_styles.js` needed two capabilities the puzzle extractor lacks:
  **two StyleSheets per file** (`[id].tsx` has `styles` + `shareStyles`, and the puzzle version
  hard-exits on anything but one), and a **colour-map walker**. The latter matters —
  `collectRenderFunction` returns `{}` for `getTypeColor`/`getStatusColor` because they are pure
  `condition → string literal` maps with no style values in them, so the six colours that decide
  what a SWISS badge and an ONGOING dot look like would otherwise have been the only hand-typed
  numbers in the feature. They are now extracted as ordered `when → value` lists, because the order
  is the semantics: any status that is neither ongoing nor finished is gold.
- The detail screen keeps its **own** copy of the type→colour mapping as a plain ternary
  (`[id].tsx:400`). Both copies are extracted and `selfTestSource` asserts they agree, rather than
  assuming it.
- Confirmed mechanically: there is **no shared header** — 2 distinct shapes across the 3 screens
  (`paddingVertical` 12 / 12 / 10), matching the same finding in the puzzle port.

## Pairing Manager — the Swift half

### The metrics are generated, not transcribed

`tools/metrics/gen_pairing_metrics.js` emits `PairingMetrics.swift`, `PairingStrings.swift` and the
JS geometry region from one source in one pass. This departs from the puzzle layer, which
hand-writes its Swift constants and relies on `replay_puzzle_core.js` to notice drift. Both are
defensible; the generator is better here because it removes the transcription step entirely rather
than checking it afterwards, and `replay_pairing.js` becomes a second opinion — which is what caught
nothing this time but is exactly what would catch a generator bug.

The generator is a **gate, not a convenience**: it exits non-zero if the list and detail screens
disagree about the type colours, if an inline standings width is absent from the source, or if the
JS grows an interpolating string it has no Swift shape for.

### Swift's unstable sort — one site, not four

Recorded because the earlier note in this file overstated it. Four JS comparators were flagged as
relying on V8's stable sort. Three of them are already total orders:

| Site | Final key | Verdict |
|---|---|---|
| `pairingOrder` | `seed`, which is unique | total — no tie-break needed |
| the two round-1 folds | `seed` | total |
| `finish`'s board ordering | `min(rank)` of the pair; ranks unique, no shared players | total |
| **`bergerSchedule`'s board sort** | **a bye flag — every non-bye board ties** | **needs an explicit index tie-break** |

Only the last one has one, and the reason is written beside it. Adding tie-breaks to the other three
would have been dead code that looked like diligence.

### `AppLogo` was never needed

Spec 1.2–1.4 call for `AppLogo(30)` and this was planned as a new component. `HomeLogo(size:)`
(`HomeParts.swift:90`) already is it: circular, gold `strokeBorder` (not `stroke` — RN and CSS draw
borders inside the box), glow applied after the clip so it is not clipped away.

### Invented constants — Swift side

All mirror the JS and are asserted equal by `replay_pairing.js`: `PairingLimits.longPressMs` (500,
the iOS convention; RN's `onLongPress` default is not a number anywhere in the source),
`PairingLimits.roundSelectorGap` (6, lives in a `contentContainerStyle` the AST walker does not
collect), and `PairingCols.sb` (mirrors `bch`; spec 1.4 adds a Sonneborn-Berger column the RN table
never had).

### The offline guarantee is now checked

`replay_pairing.js` greps every `Pairing*.swift` for `URLSession`, `URLRequest` and any `http(s)://`.
Book Two §0.1 and Phase 8 criterion 2 both state this as a rule; it costs three lines to make it a
test instead of a promise.

## Pairing Manager — the Core document, and one thing the engine cannot do

### Zero-point byes are not modelled

Both published FIDE fixtures (`tools/qa/fide_dutch_test.js`) use TRF's `0000 - Z`: a pre-assigned
**zero-point bye**, awarded to a player who is unavailable for a round. This engine has no concept
of one. It allocates a bye itself, always worth a full point, and offers no way to mark a player
unavailable, to request a bye in advance, or to score one at zero.

The fixtures encode the Z the only way they can — in C5 by leaving that player out of the round, in
C9 by carrying the round as a `nil` colour plus an already-had-a-bye flag. Both are faithful to what
the Z means for those positions, and both pass. But the general feature is missing, and a real
arbiter would eventually want it.

### The document is one shape described twice, and that is checked

`PairingDocument.State` and the JS `pairing-store.js` document must agree key-for-key, because the
claim is that the browser's localStorage document and the app's `pairing.json` are the same
document. `replay_pairing.js` builds a populated document in JS, reads the Swift `CodingKeys` out of
the source, and compares both directions.

This is checked rather than trusted because the failure is silent: `JSONDecoder` drops an unknown key
and defaults a missing one, so a drifted document decodes to something plausible and wrong.

Two consequences worth keeping:

- **`Round.floats` is `[String: Float3]`, not `[Int: Float3]`.** `JSONEncoder` writes an Int-keyed
  dictionary as a flat *array* of alternating keys and values, not as an object, so the Int-keyed
  version would emit a document the JS twin cannot read. `RoundResult.floats` stays Int-keyed
  because it never leaves memory.
- Swift's `...ID` spelling maps to the JSON's `...Id` (`nextID` → `nextId`,
  `opponentIDs` → `opponentIds`), matching `AnalysisLibrary`'s convention and the JS keys.

## Pairing Manager — the SwiftUI screens

### Deferred: the ImageRenderer share card (spec §1.6)

§1.6 defines two things — a rendered card at width 360, and a plain-text fallback. The text ships;
the image does not. It needs its own off-screen render path and consumes the ~39 `PairingShare`
constants, which are extracted and generated but not yet read by anything. It is also the one part
of this feature whose output nothing on this checkout can look at, which is why it went last and
then did not fit. Recorded as remaining spec, not as a decision.

### Invented, Swift side

- `PairingLimits.bulkEditorHeight = 160` — spec §1.5 gives the bulk-add editor this height, but the
  RN screen uses a plain multiline `TextInput` with no height in its StyleSheet. Genuinely invented.
- The presentation timing for the Pairing overlay reuses `AnalysisTiming.screenPresentSeconds`, and
  its background reuses the extracted `PairingList.containerBackgroundColor`. Neither
  `PairingTiming` nor `PairingPalette.screenBg` exists, and inventing two constants to avoid sharing
  two would have been worse.

### Extracted after all: the white piece dot

`colorDot` in the RN StyleSheet carries only geometry — the fill is applied per side at the call
site as an inline style. Rather than retype `#FAFAFA`, `gen_pairing_metrics.js` reads it out of
`inlineStyles` and **fails if it is not there**, emitting `PairingDots.white`.

## Play vs Coach — the browser screens

### The extractor could not see a function declaration

`RN.findNamedFunctions` matched only `const f = (…) => …`. `CoachCard` in `play-coach/index.tsx` is
a function **declaration**, so its avatar geometry — `avatarSize`, `ringSize = avatarSize + 6`,
`haloSize = ringSize + 10` — was never collected and `renderConstants` came back `{}` for that
screen. Nothing failed: the numbers were simply absent, and the stylesheet reached for hand-typed
pixels instead. The walker now handles both forms, and `gen_coach_metrics.js` folds the extracted
signed terms into six `cardSize` constants rather than restating the arithmetic.

This is the same failure the *unresolved gate* exists to prevent, one level up: the gate catches a
value the evaluator cannot fold, but not a function it never looked inside.

### The roster is extracted, not transcribed — because the transcription was wrong

`coach-select.js` first carried a hand-typed roster: `Jaden/Jade/Jude/Julie` at 800/1200/1600/2000/
2400. The real `COACH_DATA` — and spec §2.14's own table, which agrees with it — is
`Jaden Pogi/Pretty Jade/Handsome Jude/Mommy Julie/Coach Pogi` at 800/1500/1800/2000/2500. Four names
and three ratings wrong, in a file that had passed review, because the two correct sources were
never compared to the incorrect one.

`gen_coach_metrics.js` now emits the whole roster (`MET.COACHES`, `CoachRoster`/`CoachProfile`),
including `winMsg`/`loseMsg`, which are not decoration: `coach-game.js`'s `evaluate` puts them
straight into the result card. The JS suite pins the roster against the **spec table** and the
generator pins it field-by-field against the **extraction** — two independent transcriptions of one
source, checked against each other.

### `modalBtn` has no background, and that is correct

`play.tsx` writes `[styles.modalBtn, { backgroundColor: coach.accentColor }]`. The five accent
colours are emitted as `MET.ACCENTS` / `CoachAccent` and applied inline, the same way. A background
in the stylesheet would have been an invention that also happened to be wrong for four coaches.

### Deferred: the Review button (spec §2.10)

`resultCard` renders **Review** only when its host passes `onReview`. The offline review is a screen
of its own and is not built; §2.14 has its copy (`gameReview`, `startReview`, `analyzing`,
`accuracy`, `results`) but not a placeholder, and inventing one to fill an inert button would have
put words in the app that the spec does not contain. Recorded as remaining spec, not as a decision.

### Deleted: the sample Play tab

The pre-port demo had its own Play screen with its own coach table (`js/ai.js` `Coaches`), its own
undo and its own game state. It was **removed**, not left unreachable — two Play tabs disagreeing
about who the coaches are is precisely what the extraction exists to prevent. `js/ai.js` itself
stays: `CoachAI.evaluate` is still used by the Analysis Board, and `Coaches` still decorates the
Profile tab's avatar row.

## Play vs Coach — the Swift half

### A duplicate type had been sitting in the repo, uncompiled

`gen_coach_metrics.js` emits `public enum CoachSelect`. `CoachSelect.swift` declared
`struct CoachSelect: View` — the pre-port sample screen. Two top-level types of one name in one
module is a redeclaration error, and nothing caught it because `swift build` runs on a Mac and this
checkout has no compiler.

The view is renamed `LegacyCoachSelect` rather than the generated enum, so the metrics keep the
symmetric `CoachSelect` / `CoachPlay` naming the docs and the generator use. `swift_symbol_check.js`
now reports duplicate top-level types, which is the real fix: the rename is one instance, the check
is the class.

### The sample Play tab is NOT retired on the Swift side

The browser twin deleted its equivalent outright. Swift cannot yet, because `BoardView` — the board
every screen in the app renders — lives in `PlayView.swift` alongside the retired screen, and
`LegacyCoachSelect` is still reached from `PlayView` and `PhoneView`. Retiring the pair means
extracting `BoardView` into its own file first, which is a refactor that wants a compiler. The new
flow is therefore an overlay reached from the Home tile, exactly as the Pairing Manager is.

### Invented, Swift side

All in `CoachLayout.swift`, and asserted by `CoachMetricsCheck` + `replay_coach.js` so the list
cannot grow silently. Four are DERIVED from extracted constants rather than chosen —
`sectionGap` (`titleSub.marginTop`), `stripGap` (`moveStripContent.gap`), `disabledOpacity`
(`navBtnDisabled.opacity`) and `premoveChipInset` (`premoveChip.paddingHorizontal`) — and the replay
pins each derivation, so replacing one with a bare number fails.

Genuinely invented:

- `rosterColumns` — three flexible grid columns. RN lays the five cards out as two explicit rows
  (`row1`, `row2`); a `LazyVGrid` reproduces that without hard-coding which coach sits where.
- `boardAspect = 1` — the board is square. RN derives it from `BOARD_SIZE`; stating the ratio lets
  it track the device instead of the reference width.
- `oneStep = 1`, `lastRankWhite = 7`, `lastRankBlack = 0` — named only so no view body contains a
  bare number for the metrics check to trip over.
- `enabledOpacity = 1`.
- `scrimOpacity = 0.55` — RN renders a `Modal` with its own dimming, so there is nothing to extract.
  Matches the value the Puzzle Hub's prompts already use rather than being a second opinion.
- `defaultPromotion = "q"` — spec §7 #32 is that the RN premove ALWAYS auto-queened. A tap on a
  promotion square still defaults to a queen, but the value is carried through
  `CoachTurn.Premove.promotion` explicitly, so a picker can be added without touching the mechanism.
- `CoachGlyph`'s five characters — icons that happen to be characters, kept out of `CoachStrings`
  because that file is generated from §2.14, which is copy. The browser twin writes the same five
  as literals.

### The reply is paced, not delayed

`CoachStore.askCoach` waits `think - alreadySpent`, not `think`. Written the other way the think
time is ADDED to the search and every coach becomes slower than the spec says; the JS twin does the
same subtraction, and a mutant pins it in both.

## Play vs Coach — the game review (§2.10)

### Four things this feature nearly reimplemented

The accuracy bands, the one-decimal accuracy format, the ten classification colours and their
symbol-bearing labels all already existed in `analysis-metrics.js` and
`AnalysisReview` / `AnalysisTables`, in both languages, because the Analysis Board has its own
review rows. The first draft of `coach-review.js` wrote all four again — the colours as ten hex
values typed into `coach.css`. They are delegated now.

Worth stating as a rule: when a new screen needs a table, look for it in the screen that already
shows the same data. Two copies of the classification colours would have diverged the first time
one was tuned.

### The eval graph came from a third file

Spec §2.10 states the graph's fill (`#1A2740`), radius, the two advantage fills, the centre line and
the curve in prose. All of them are literals on SVG attributes in `components/EvalGraph.tsx` — not a
StyleSheet, so `collectInlineStyles` could not see them. `collectSvgAttrs` was added for exactly
this, and the extractor now walks that file plus the `height={60}` at the call site in `play.tsx`.
`CLAMP = 500` is read as well, so `coach-review.js` no longer restates it.

### The review card border is a hex alpha BYTE

`play.tsx`: `[styles.reviewModalCard, { borderColor: coach.accentColor + '30' }]`. `'30'` is
appended to a hex string, so it is 0x30/255 ≈ 19 % — which is what the spec's "accent @ 19 %" means.
Read as "30 %" the border is nearly twice as strong. The Pairing Manager already shipped this exact
confusion once in a badge tint, so both languages keep the byte and divide:
`CoachLayout.accentBorderAlphaByte = 0x30`.

### The hand-off is an argument, not a capture

§7 #28 is not a typo, it is a shape. The RN `handleGameReview` was a `useCallback` whose dependency
list named `moveRecords` but not `reviewData`, so the closure kept the `null` it was created with
and the Analysis Board received an empty classification array on every hand-off ever made.
`handoff(game, summary)` takes the summary as a parameter; there is nothing to capture, and it
returns nil rather than an empty payload when the summary is missing. Two mutants keep it that way.

### A cancelled review is discarded, never shortened

`reviewSteps` / `ReviewAnnotator.Evaluator` leave their evaluations SHORT when cancelled, and
`isFinished` is true for a cancelled walk. Both languages therefore guard on `isComplete` /
`res.complete` and close the modal: a partial review would report an accuracy computed over half a
game, and nothing on screen would say so.


---

## Login screen — a simulated sign-in, and a reversed spec decision

### It reverses a locked decision, deliberately

`docs/specs/BIYAHERONG-PORT-SPEC.md:1348-1352` is explicit: *"**No app server.** … Entitlement is
verified **on-device by StoreKit 2**. **No accounts, no login, no API, no progress sync.**"* The app
now opens on a login screen anyway, because that is what was asked for. Recorded here rather than
argued: the spec is the ground truth for *ported* behaviour, and this screen is not a port.

Two things that decision does NOT change, and both are now tests rather than promises:

- **The app is still 100% offline.** `ios/project.yml:69-71` justifies its export-compliance `NO`
  with "no URLSession/Network anywhere". `tools/qa/replay_login.js` fails on `URLSession`,
  `URLRequest`, `fetch(`, `XMLHttpRequest`, `ASAuthorization` or any `http(s)://` in
  `LoginMetrics.swift`, `LoginStore.swift`, `LoginScreen.swift`, `LoginMetricsCheck.swift` or
  `web-demo/js/login.js`. The same shape as the Pairing Manager's offline grep.
- **There is still no account and no sync.** The "session" is one string naming a provider, on this
  device. Nothing is uploaded, nothing is fetched, and no progress moves anywhere.

### The Apple sign-in is simulated, and that will not ship

`LoginStore.signIn(_:)` writes a string and publishes. There is no `AuthenticationServices` call.
**A "Continue with Apple" button that performs no Apple authentication is an App Store rejection**,
so this is a development state, not a shippable one. It is written so that the fix is local:

```swift
// today
private func signIn() { Haptics.play(.success); onSignedIn() }
// real: call ASAuthorizationController from the button action, then on success
loginStore.signIn(LoginSession.appleProvider)
```

The store, the persistence, the gate in `PhoneApp` and the Profile tab's Sign out do not change.
What does: `ios/project.yml` needs the `com.apple.developer.applesignin` entitlement, and the
export-compliance justification above needs re-reading — Sign in with Apple itself talks to Apple.

### The screen is INVENTED, not extracted

There is no RN counterpart. `(auth)/login.tsx` is a username/password form against a Laravel API
with a Demo Login button, a Forgot Password link and a register link; this is one Apple button on an
offline app. So the usual rule — extract, don't transcribe — has almost nothing to extract from, and
the honest thing is to say which values came from the source and which did not.

**Taken from `(auth)/login.tsx`:**

| Value | Where |
|---|---|
| `LoginPalette.legal` = `#3A5070` | its `legalLink` / `legalSep` colour |
| `LoginLayout.screenPaddingH` = 24 | its `screen.paddingHorizontal` |
| `LoginType.titleTracking` = 0.5 | its `appName.letterSpacing` |
| `LoginStrings.title` / `.tagline` | its hero copy, verbatim |
| the rest of the palette | via `Theme`, which is already a 1:1 copy of `constants/theme.ts` |

**Invented constants:**

| Constant | Value | Why |
|---|---|---|
| `LoginLayout.logoSize` / `logoRadius` | 124 / 30 | The RN hero is a 76pt wrapper holding a 100pt image — it overflows its own box, which is a bug, not a measurement to port. A squircle rather than `HomeLogo`'s circle because a circle crops the "APP" badge off the brand mark |
| `LoginLayout.buttonHeight` | 54 | Apple's minimum is 44; 54 is a comfortable target for a child's thumb and balances the 124pt hero |
| `LoginLayout.heroTopPadding` / `heroSpacing` / the gaps | 64 / 18 / … | No source; chosen so the band budget below holds |
| `LoginLayout.minSpacer` | 24 | The floor that makes "never scrolls" checkable instead of hoped-for |
| `LoginLayout.shortestSupportedHeight` | 667 | iPhone SE 2nd/3rd gen, the shortest device the app targets |
| `LoginDrift.specs` | 8 hand-placed pieces | No source at all. Fixed, never randomised — see below |
| `LoginTiming.*` | 0.05 / 0.18 / 0.30 / 0.35 s | The stagger and the cross-fade. The sign-in fade is capped at 0.5 s by an assertion, because "immediate" was the requirement |
| `LoginStrings.reassurance` / `.sheetClose` | — | No source string existed; Taglish, matching the app's voice |
| `LoginStrings.privacyBody` / `.termsBody` | — | Written for this app. Bundled text, never a URL: the app has no network |
| `LoginSession.storageKey` | `biya.auth.session.v1` | Same shape as `biya.coach.takeback.v1` and `biya.analysis.engine.v1` |

### The one typography exception in the app

Every other label in every other screen is Nunito, and a screen that declared `-apple-system` was
treated as a bug once already. The Apple button's label is the **system font** in both languages, on
purpose: the real `ASAuthorizationAppleIDButton` renders in San Francisco, so matching it now means
the control does not change size when the simulation goes away. It is the label only — the tagline,
the reassurance line and the legal footer beside it are all Nunito.

The button is Apple's **white** variant, which is their guidance for a dark background, and the mark
is pure black on pure white. Both self-checks assert those two colours as **absolutes**, not as a
Swift-versus-JS match: two languages agreeing the Apple button is gold would still be wrong.

### The drift field is a table, not a random seed

Eight pieces at fixed fractional positions. `inRandomOrder()`-style non-determinism is modelled in
this repo as injected data and never as reproduced RNG, and a background that differs run to run
cannot be asserted at all. Both self-checks hold it to four invariants: every opacity ≤ 0.08 (faint,
or it competes with the hero it sits behind), every `x` outside `[0.30, 0.70]` (clear of the logo and
title column), every `y` < 0.80 (clear of the button band), and no two pieces sharing a point. The
art is the same bundled piece SVGs the boards draw — no new asset, and no emoji.

Under Reduce Motion the pieces are still **drawn** and simply stop moving. Removing them would take
the texture away too, which is not what the setting asks for.

### The session fails closed, and signing out removes the key

`LoginSession.isSignedIn(_:)` recognises only the values in `LoginSession.providers`. `nil`, `""`,
`"0"`, `"APPLE"`, `" apple"` and every unknown provider read as signed out; `LoginStore` refuses to
persist a provider the predicate does not know. A half-written or hand-edited key therefore shows the
login screen instead of being the thing that lets someone past the gate.

`signOut()` **removes** the key rather than writing `""`, so a later read is a clean miss and not a
value the predicate has to special-case. Both mutations are idempotent, asserted by write and removal
count through an in-memory storage double in Swift and its twin in JS.

The storage protocol is `CoachGame.Storage`, **reused rather than re-declared**. It is already the
repo's "anything that can hold a string by key", it already has a `UserDefaults` adapter in
`CoachStore.swift`, and a third identical protocol would only be a third thing to keep in sync. The
JS half wraps every access in `try/catch`: `localStorage` throws on some `file://` configurations, and
a login screen that cannot read a key must still open — asserted with a storage double that throws on
every call.

### `HomeAppIcon` was generalised, not duplicated

The login hero needed the same "bundled square mark, aspect-filled, clipped to a shape, with a
fallback" that `HomeLogo` already had, but with a different asset. `HomeAppIcon` gained a defaulted
`asset:` parameter declared last, so both existing call sites are untouched. The alternative — a
second near-identical view — is the mistake `docs/play-vs-coach.md` records under "a duplicate type
had been sitting in the repo, uncompiled".

The mark itself is a **second** brand asset, not a replacement: `Images/app-icon.png` is the gold
knight (the iOS app icon, the Home header logo, the Play-with-Coach ring) and `Images/brand-logo.png`
is the photo collage the RN app uses everywhere. `Diagnostics.swift` hard-counts the PNGs in
`Images/`, so it now expects 6.

### Two false negatives the symbol checker had all along

Widening `swift_symbol_check.js`'s `CHECKED` regex to cover `Login*` — and, while there, `Home*` —
immediately reported three "unresolved" references that all existed:

```
UNKNOWN  Diagnostics.swift:48        HomeArt.diagnosticsSummary
UNKNOWN  HomeMetricsCheck.swift:112  HomeCard.allCases
UNKNOWN  LoginMetricsCheck.swift:245 LoginLegalTopic.allCases
```

Its member regex had no `nonisolated` in its modifier alternation, so a `nonisolated static func` was
invisible; and `allCases` is synthesized by `CaseIterable` and never appears in source at all. Both
are now read off the declaration rather than allow-listed by name — the modifier list gained the
seven Swift modifiers it was missing, and a type whose inheritance clause names `CaseIterable` gets
`allCases` (a raw-value enum likewise gets `rawValue`). Coverage went from 3,038 references and 136
types to 3,336 and 147.

This is worth recording because it is the failure mode the checker exists to prevent, in the checker:
a name check that silently does not check a namespace looks exactly like a passing one.

---

## Subscription — a monthly plan enforced on-device, and six departures from the spec

### The decisions, and what they reverse

The user asked for one **monthly** auto-renewing subscription with a **7-day free trial**, gating the
whole app, with a playable free tier under it and **no server at all**. `docs/specs/` is a source
prompt, not an implementation doc (`docs/README.md:57`), so it is not edited; the departures are
recorded here, the same way the login screen's reversal was.

| Spec | This build | Why |
|---|---|---|
| One-time purchase for the offline core + subscription for the online modules (`:1676-1690`) | Subscription gates everything | Recurring revenue was the requirement |
| Monthly **+ yearly** in one group, yearly the default (`:1764-1771`, `:3038-3043`) | Monthly only | Deletes the plan toggle, `BEST VALUE`, `Save {n}%` and half the disclosure card |
| No trial anywhere in the spec or the RN app | 7-day introductory offer | Needs its own CTA label, price note and eligibility check — all invented |
| 14-day grace, pinned by acceptance criterion 13 (`:1748`, `:3835`) | **7 days** | 14 is half a monthly billing cycle: cancelling would buy a free fortnight |
| Grace keyed on "the receipt cannot be read at all" (`:1746`) | Keyed on the cached **expiry** | The renewal-day subscriber has a perfectly readable receipt saying *expired yesterday*. The spec's rule would drop them instantly — which is the exact failure grace exists to prevent |
| "no daily caps" (`:37-39`), Thematic unlocked (`:977-981`), coaches 3-5 unlocked (`:2472`), tournament caps deleted (`:1906`) | All restored as the free tier | They are the free tier |

Acceptance criterion 13 ("offline 13 days = unlocked, 15 = reconnect") is therefore superseded by
7 days. Criteria 14 and 20 still hold and are asserted.

### The two holes that are not defended

Neither is fixable without the server the user ruled out, and both are cheaper than the server:

1. **Refunds.** A refunded transaction carries a `revocationDate`, and `PremiumStore` skips it — but
   an offline device does not learn about it until it next syncs. On a monthly product the exposure
   is bounded.
2. **Clock rollback.** Airplane Mode plus a back-dated clock extends access. `Entitlement.trustedNow`
   floors the clock at the highest Apple-signed `signedDate` ever observed, kept in the keychain, so
   the device clock can never resolve earlier than a timestamp Apple itself signed. That is a much
   higher wall, not a closed one — a jailbroken device defeats it.

A clock moved *forward* is not defended either: it expires the subscription sooner and hands out a
few extra free-tier puzzles by rolling the day key. Not worth the machinery.

**On-device enforcement is a speed bump, not a lock.** Nothing that runs on hardware the attacker
owns can be otherwise. The judgement recorded here is that for a consumer chess app the marginal
pirate was never going to subscribe, and the offline-first property is worth more than the leak.

### The fail-open hole the test found

`resolve` originally honoured `isSubscribed` even when `expiresAtMs` was nil, on the theory that a
missing date meant "non-expiring". Writing the JS self-test surfaced what that actually meant:

```
localStorage['biya.store.subscription.v1'] = '{"isSubscribed":true}'   // permanent premium
```

Two words. An auto-renewable subscription **always** carries an expiry, so a snapshot without one was
never produced by StoreKit — it is a fresh install, a half-written file, or a hand-edit. Both
languages now **fail closed**, with an assertion each and a mutation test proving the assertion bites.
This is the same principle `LoginSession.isSignedIn` follows for the session string.

### Grace is keyed on auto-renew, not just on the date

A lapsed entitlement gets the 7-day window **only if auto-renew was ON at the last successful
refresh**. Someone who turned it off in Settings knew the date was coming; giving them a free week is
not protecting anyone, it is just a week. The renewal-day subscriber — auto-renew on, card charged,
phone offline — is the case grace exists for, and is asserted by name in both self-checks.

When a refresh finds no entitlement, `PremiumStore` sets `isSubscribed = false` but **deliberately
keeps `expiresAtMs`**: it is what the grace window runs from, and clearing it would drop exactly the
user grace was built for. `replay_premium.js` asserts the store never nils it.

### Invented constants

| Constant | Value | Why |
|---|---|---|
| `Entitlement.graceDays` | 7 | Half of the spec's 14, because the product is monthly. No source |
| `Entitlement.trialDays` | 7 | The user's choice. StoreKit is the authority on eligibility; this is only for the copy |
| `Entitlement.reviewsPerDay` | 3 | **Borrowed, not guessed**: the RN app gated the Analysis Board at 3 saved sessions and 3 pinned GM games (`board.tsx:1059`, `:1981`), and `PORTING_NOTES.md:334-337` records the port dropping both. Different unit, same ceiling. The *per-day* framing is the invented part |
| `PaywallStrings.graceTitle` / `.graceBody` | — | No RN counterpart: the state could not exist when a server answered the question |
| `PaywallStrings.trialCta` / `.trialNote` | — | No RN counterpart: there was no trial |
| `PaywallStrings.allSetBody` | — | Rewritten: the spec's names two modules that do not exist here yet |
| `PaywallLayout.*` beyond §3.2 | `warnRadius`, `warnPadding`, `scrim`, `headerHeight` | The grace card and the lock scrim have no extracted geometry |
| `PremiumStore.subscriptionGroupID` | `biyaherong.plus` | Must match App Store Connect; nothing to extract from |

**Extracted, not invented:** the entire §3.2 paywall geometry and palette; the cap and lock copy from
`components/UpgradePrompt.tsx:26-50` (minus its stale hard-coded `₱99`); the `#4CAF50` Active pill;
the caps themselves, which were already ported and golden-tested.

### `DailyLimits` is not allowed to grow

The caps table is pinned to the PHP oracle by 168 golden assertions. Adding the invented `review`
mode to it would make the Swift map diverge from the backend it was verified against — the table
would still "work" and would no longer be a port. The invented cap lives in `Entitlement.maxUses`,
which delegates to `DailyLimits` for everything else, and `replay_premium.js` fails if the string
`"review"` ever appears in `DailyLimits.swift` or its JS twin.

Related: `web-demo/js/daily-limits.js` did not exist. `DailyLimits` was a fully-ported Swift island
with no mirror and no cross-check, reachable only from a macOS dev panel. It has both now.

### Turbo is per mode, and the counter counts starts

Two readings of the original that are easy to get wrong, and are now asserted in four places each:

- `puzzleRushAttempts: Record<string, number>` (`usageLimits.ts:21-33`) is **keyed by mode**. One free
  run of the ∞, the 3-minute and the 5-minute board each per day — not one run in total.
- Every RN counter was bumped **after the puzzle was fetched / the run began**
  (`play-puzzle/index.tsx:787`, `puzzle-streak:166`, `puzzle-rush:195`), never on a correct answer.
  A failed attempt still costs a use. This is also why `PuzzleProgress.dailySolves` cannot double as
  the counter: it counts correct solves, for the daily-goal ring.

Resuming a Turbo draft is explicitly exempt — it is the same run continued and already paid.

### Both Game Review entry points share one allowance

`AnalysisVM.startReview()` and `CoachStore.startReview()` produce the same review. Capping the first
alone would have left the second as a free bypass, so both call one `PremiumStore.consumeReview()`,
and `replay_premium.js` asserts all three facts. Each gate sits **after** the existing
`minimumReviewPositions` / `isReviewable` guard, so a review that was never going to run does not
cost the user one of their three.

### The counters are NOT in `PuzzleProgressState`

`PuzzleHubStore.swift:152` decodes it with a bare `try? JSONDecoder().decode(...)` and the struct has
synthesized `Codable` — no `CodingKeys`, no `decodeIfPresent`, no migration. Adding a non-optional
field would make every existing save file fail to decode, `try?` would swallow it, and the user's
rating, attempt history, streak runs and Turbo bests would silently reset to zero. `Entitlement.Usage`
is therefore its own persisted value, which is the right split anyway: these counters are about
billing, not progress.

### The only two URLs in the app

App Review requires the Apple standard EULA and a privacy-policy link on any auto-renewing
subscription paywall. The repo's offline greps ban URLs outright, so this is a deliberate, bounded
exception: `replay_premium.js` allowlists exactly the two in `PaywallLinks.all` and fails on a third,
in Swift and JS alike. Nothing in the app fetches them — they open in Safari.

`ITSAppUsesNonExemptEncryption: NO` stays correct: StoreKit's transport is OS-provided TLS, which is
exempt. Only the comment beside it needed rewriting.

### One file imports StoreKit, and the Core does not

`Entitlement.swift` is Foundation-only, per the parity contract — every rule lives there and is
assertable with no device, no network and no sandbox account. `PremiumStore.swift` is the single
translation layer, and `replay_premium.js` asserts by enumeration that it is the *only* file in the
UI target with `import StoreKit`.

### Keychain, and why macOS does not get it

The entitlement snapshot and the clock floor live in the keychain on iOS: they survive a
delete-and-reinstall, so a subscriber who reinstalls offline is not locked out, and they are harder
to hand-edit than a plist. `kSecAttrAccessibleAfterFirstUnlock`, not `WhenUnlocked` — a launch while
the phone is still locked must not read an empty keychain and conclude nobody has paid.

macOS falls back to `UserDefaults`. `DemoApp/run-demo.sh` builds unsigned, and `SecItem` from an
unsigned binary raises a system permission dialog that would hang the desktop preview behind a modal
nobody expects. The Mac shell is a preview harness where nobody subscribes.

### The bundle identifier did not match itself

`ios/project.yml:39` said `com.prince24pogi.biyaherongchessapp` — tied to the live App Store Connect
record — while `codemagic.yaml:66` said `com.biyaherong.coach`, with a comment claiming the two
matched. StoreKit product IDs are namespaced per app record, so sandbox purchases would have failed
against the wrong one. Reconciled onto the `project.yml` value, and `ios/BUILD-iOS.md`'s advice to
"just change the bundle identifier" if signing complains is now marked as personal-sideload-only,
because on a TestFlight build it orphans every product ID.

### `ios-free-unsigned` can no longer validate the store

It archives with `CODE_SIGNING_ALLOWED=NO`, so there is no App ID with In-App Purchase and
`Product.products(for:)` returns empty — testers on that path see the "Store Unavailable" card
permanently, which is why that card is a first-class state in both languages and reachable in the
browser with `?storefail`. `ios-testflight` is the only real store test path. Nothing in
`codemagic.yaml` runs any test suite, so every gate in this feature is local.

---

## Board squares — an extracted palette that nothing read (2026-08-18)

Client feedback: *"doon sa lahat ng board sa puzzle natin dapat ganto kulay ng chess board para mas
maliwanag at mas maaliwalas"*, attached to a screenshot of **this app's own Analysis Board** on its
default `classic` theme. Investigating why one screen already looked like the screenshot and the
others did not turned a colour request into a parity fix.

**The finding.** `tools/metrics/extract_puzzle_styles.js` has walked the real
`components/DragDropChessBoard.tsx` into `puzzle_styles.json` → `shared.board` since the puzzle
screens were ported, and it carries the source app's actual palette:

```json
"lightSquare": { "backgroundColor": "#F0D9B5" },  "darkSquare": { "backgroundColor": "#B58863" },
"selectedSquare": { "backgroundColor": "#F6F669" }, "lastMoveSquare": { "backgroundColor": "#CDD26A" }
```

`grep -r 'shared.board' --include=*.js --include=*.swift` returned **zero hits**. Both languages
independently hardcoded an invented `#5BA3F5` / `#2C4A73` blue instead — `BoardStyle`'s defaults in
`AnalysisMetrics.swift`, `--board-light` / `--board-dark` in `theme.css`, and a third copy as the
`var()` fallbacks inside `chess-board.js`'s `:host` block. So the five puzzle solvers, Play vs
Coach and the two macOS panels had drawn a colour the source app never had, for the whole life of
the port. The Analysis Board escaped only because `BoardTheme.default == .classic` happens to be
the extracted pair by another route.

**Why nothing caught it.** No suite anywhere asserted a square colour literal — the two Swift
assertions were *relative* (`plain.light == Theme.boardLight`), so they followed the wrong value
happily, and the JS twin compared against `BOARD_THEMES.classic`, a different constant. The two
languages agreed with each other, which `CLAUDE.md` names explicitly as the failure mode that
shipped the annotation badge in the wrong corner: **two hand-typed copies agreeing is not
verification.**

**The fix.** `BoardStyle`'s defaults become `BoardTheme.classic.light` / `.dark`; `theme.css` and
the `chess-board.js` fallbacks take the same hexes. `tools/qa/board_layout_check.js` gains §8, which
pins all five writers — in Swift as well as JS, read as text since there is no compiler here — to
`shared.board`, and bans the old blue from any of them. Both directions are mutation-checked.

**Deliberate deviations retained.**

- **The indicators stay gold.** `lastMove` / `selected` remain `Theme.accent` at 0.32 / 0.55 laid
  *over* the square (`replacesFill == false`), not the RN board's solid `#F6F669` / `#CDD26A`. The
  screenshot the client approved is the Analysis Board, which has always drawn gold on brown, and
  the solid pair would also collide with the Puzzle Streak's `--hl-sol-from` / `--hl-sol-to`
  solution highlights.
- **`Theme.boardLight` / `Theme.boardDark` survive.** They are no longer a board colour, but they
  are still real chrome — the level capsule in `PlayView`, the rating chip in `PuzzleView` — so they
  keep their values and gain a comment saying they must never be put back on a board.
- **The Analysis Board's three-theme picker is untouched.** `analysis.js` sets `--board-light` /
  `--board-dark` on its own root, so `classic` / `green` / `blue` still work; what changed is only
  what every *other* screen inherits.

## Analysis Board — client revision (2026-08-18): typography, bands, PV length, tap-to-play

Four asks from a TestFlight screenshot, and what each one cost in deviations.

### 1. The engine panel is drawn LARGER than the source — a declared deviation

| key | source (`board_styles.json`) | drawn | derived from |
|---|---|---|---|
| `engineEval` | 9 | **13** | `stripMove` |
| `engineSan` | 10 | **13** | `stripMove` |
| `enginePv` | 9 | **13** | `stripMove` |
| `engineText` | 9 | **13** | `stripMove` |
| `engineOpening` | 9 | **12** | `altChip` |
| `engineDepth` | 8 | **11** | — a depth chip as large as the moves would out-shout them |
| `engineEvalWidth` | 36 | **44** | — `M-3` / `+10.5` clip at 13 pt |
| `engineSanWidth` | 38 | **46** | — `O-O-O` / `Qxd5+` are five glyphs |

The client's words were *"pwede ba yung text sa engine analysis lakihan mo kasing laki ng chess
notation"*. The ported values are real and were extracted, not transcribed; they are also unreadable
on a phone.

**Mechanism: invert the assertion, never delete it** — the precedent is the ⩲/⩱ correction. A new
`deviates(key, prop, ours, source, why)` in `AnalysisMetricsCheck.swift` and `analysis-metrics.js`
asserts *both* halves: the RN source still holds its documented value, **and** ours differs in the
intended direction. Delete the source half and an accidental drift stops being caught; that is the
whole reason the helper exists rather than a bare `expect(TYPE.enginePv === 13)`.

The sizes are **derived** (`static let engineEval: CGFloat = stripMove`) rather than re-typed, so
"the same size as the notation" cannot drift apart later.

⚠ The Swift half of this cannot fail on the Windows checkout — `AnalysisMetricsCheck` runs only on a
Mac, and its constants are literals, not JSON reads. Both sides must move in the same commit or the
JS gate stays green while a teammate's first `swift run AnalysisMetricsCheck` fails.

### 2–3. The book panel became a strip, and the flexible band moved

The 230 pt "out of book" box was a **layout** fault, not a styling one: a `ScrollView` is greedy along
its axis, so `AnalysisOpeningPanel` drew its full 230 pt cap for one line of grey text — and being the
root `VStack`'s only `maxHeight: .infinity` child, it also hoarded every spare pixel while the engine
rows people read were content-sized at 9 pt.

Deviations recorded:

- **`AnalysisBookStrip` replaces `AnalysisOpeningPanel` on this screen.** Fixed `bookStripHeight = 44`,
  a horizontal row of `san · eco` chips, **no empty state** — out of book it is not built at all. The
  opening *name* is dropped from it; the engine panel's info row already names the opening.
- **The engine panel is the flexible band.** `.frame(maxHeight: .infinity, alignment: .bottom)` placed
  **after** `.background`, so it claims the band without painting it.
- **`bands(viewportHeight:boardEdge:inBook:)`** gained the book parameter, and `engineStripEstimate`
  went 60 → 102 (13 pt type, wrapped continuation, five rows).
- **`panelsMaxHeight` keeps its meaning** — the *edit-mode* panel still uses that container, and
  `AnalysisMetricsCheck`'s `se.panels < panelsMaxHeight` still has to hold. The strip got its own
  constant rather than reusing it.
- **`engineMaxRows = 5`**, **`engineLineLimit = 2`**. At 13 pt a one-line row fits *fewer* moves than
  the old 9 pt one did, so without wrapping "bigger text" and "more moves" cancel out.

**There must be exactly one flexible child**, and the two renderers fail *differently* when there is
not — SwiftUI's `.frame(width:height:)` centres the whole column (a navy gap above the header), flex
leaves the gap at the bottom. Both are now pinned: `swift_layout_check.js` rule 4b and
`board_layout_check.js` §3b. Neither substitutes for the other.

#### A short screen DROPS rows; it does not squash them

Making the panel flexible exposed the next fault. Flex shrinks a child while its *text* keeps its own
height, so on a 375-wide phone three wrapped rows (113 pt of content) were squeezed into a 61 pt band
and the overflow painted straight over the move strip. It was **measured in the browser, not
predicted** — `scrollHeight` on the panel did not reveal it, because the overflowing content belonged
to children that had themselves been shrunk.

- **The rows are their own clipped box.** `.an-rows { flex: 0 1 auto; min-height: 0; overflow: hidden }`
  and `rowsBox` + `.clipped()` in SwiftUI; `.an-erow { flex: none }` so a row is never squashed. It
  clips from the **bottom** — the third line is lost before the first. The info row sits outside, so
  the depth chip survives a short screen.
- **`enginePlan(available:wanted:)` decides rows and lines.** **Rows beat wrapping**: three
  single-line rows fit an SE where three wrapped rows do not, and seeing every move the engine
  considered, each truncated, beats seeing one and a half in full. It is a *budget*, not a
  measurement; the clip is what makes an approximate answer safe.
- **The two renderers obtain the input differently, deliberately.** The browser measures the sibling
  bands (all `flex: none`, so the sum is exact); SwiftUI computes it from
  `engineAvailable(viewportHeight:edge:inBook:autoplaying:)` because it has no DOM. They agree on the
  *decision* — one shared pure function, asserted in both metrics suites — not on the method.
- **`bands()`' `fixed` is not the honest total.** It predates the second status row and omits
  `statusLineMinHeight`, which is why the check's own §10d budget over-estimated an SE by ~50 pt and
  cheerfully claimed three wrapped rows would fit. `fixedWithoutEngine` is the complete figure and is
  what the plan uses. `bands()` is left alone: it governs the edit-mode panels band and its
  assertions are pinned to that meaning.

`board_layout_check.js`'s widened `--an-*` audit also caught two hardcoded column widths
(`.an-eeval { min-width: 40px }`, `.an-esan { min-width: 38px }`) that the typography step had left
behind — the metrics said 44/46 and the CSS said 40/38. Both now read `var(--an-eeval-w)` /
`var(--an-esan-w)`.

### 4. Longer lines — two mechanisms, and an honest account of the first

`AnalysisSession.pvPreview` 6 → 12 (source: 6, `board.tsx:2827`). **On its own this changes nothing at
the default preset**: a PV can never be longer than the search was deep, and 1.2 s reaches ~6 ply.
That is why the screenshot read `d:6` with six moves.

- **`Search.extendPV`** — walks the transposition table forward from the PV's end. Free. Also nearly
  useless alone: the PV's last position was reached at depth 0 and handed to `quiesce`, which stores
  no move, so the walk breaks on its first probe. **Measured: one line in twelve lengthened.** Kept,
  because a transposition does sometimes hand back a free ply, and it is the cheap half.
- **`Search.extendTail`** — searches shallowly from the leaf and appends the resulting PV. This is what
  delivers: **10–14 plies** where lines used to stop at 6.

Bounds, all deliberate, because the user's stated choice was *"no extra battery"*:

| bound | value | why |
|---|---|---|
| when | the **final** snapshot only | not once per iteration |
| which | only the lines that will be drawn | |
| `extendProbeDepth` | 2 | 2/3/4 all reach the limit; measured +21%/+6%/+5% vs +66%/+21%/+9% vs +99%/+31%/+13% |
| `extendProbeNodes` | 4000 **per line** | nodes not milliseconds — determinism is part of the engine's contract |
| `pvExtendLimit` | 14 | two above `pvPreview`, so the DISPLAY cap truncates, never the engine |

Net measured cost: **+5–18%** of search time. Stated plainly because it is not free, and the user
asked for no extra battery.

Two invariants the probe must hold, both asserted in both languages: every appended move is **legal**
in the position it is played from (the table is keyed on 32/64 bits, and a collision returns a move
from a different position), and the line never **revisits** a position (a table of exact scores will
walk a cycle forever).

Implementation deviations:

- The probe runs on a **scratch `Search`** — its own table, killers and history — so it cannot reach
  the real search's state and change a score.
- **The browser does one line per `next()`.** `engine_budget_check.js` measures the longest
  uninterrupted block on the in-thread (`file://`) path; the first unbounded version measured **2.9
  seconds** of frozen UI, and doing all three lines in one chunk still measured 324 ms. Shrinking the
  budget until that fit simply starved lines two and three — the first line ate it. Swift does the
  same work in one pass because its search is already off the main actor; **the results are
  identical**, which is what the twins must agree on.
- The stepper's contract changed: `analyzeSteps` now emits extra steps at the final depth, and
  `onProgress` fires once more with the longer lines. Three assertions were rewritten to describe
  that rather than the old one-step-per-depth shape.
- Probe nodes are **added to the reported count**. Under-reporting work the engine really did would
  make the node figure a lie and hide the cost from the budget gate.

### Tap an engine line to play it out (new feature, no source counterpart)

`LinePreview` lives in **Core**, not the view model. It began in `AnalysisVM`; moving it made the whole
interaction assertable by ParityRunner with no screen, which is the same trade `AnalysisMetrics` made
for numbers and `AnalysisSession` made for state.

Decisions worth recording:

- **It holds UCI strings, not `Move`s.** That is what `EngineRow` carries across the Core boundary, and
  re-resolving each one against the position it is played from *is* the staleness check — a snapshot
  can outlive its position, and such a line refuses both to start (`canPreview`) and to walk
  (`previewPosition`).
- **`sans` and `uci` are trimmed to a common length** at `start`. The continuation is capped at
  `pvPreview` SANs while `pvUCI` carries the engine's full line; a ply you cannot label is a ply you
  should not be able to step to.
- **The two ends are asymmetric, deliberately.** `stepped(_:)` returning `nil` means *leave the
  preview* — that is `◀` at ply 1 — while stepping past the end is a no-op, because there is somewhere
  to go back to and nowhere to go forward. `jumped(to:)` out of range is always a no-op, never an exit.
- **Only the board shows the previewed position.** The strip, engine rows, book and eval still describe
  the real cursor, because nothing has been played. Overriding in `refresh()` rather than in the view
  keeps the board band unaware that previewing exists.
- **Any navigation ends the preview**, as one line in each language's navigation funnel
  (`afterNavigation` / `afterMove`) rather than a guard at ten call sites. A board **tap** exits (a tap
  is ambiguous); a **drag** is refused outright (it is not).
- `＋` commits `movesToCommit` through the ordinary `perform`/`play` path, so `MoveTree` branches and
  the strip draws branch chips with nothing new downstream.

`EngineRow` gained `pvUCI`, defaulted to `[]` in the initialiser. An earlier version defaulted it to
`[uci]` when a row was hand-built; that was removed — nothing hand-builds a row any more, and it was a
Swift-only behaviour the JS twin did not have.

**Removed:** `AnalysisVM.playEngineRow` and the browser's `playUciMove`. Nothing plays just a line's
first move now, and dead code that looks live is worse than none.

---

## Home chrome — client revision (2026-08-18, fourth round)

Three asks, one screen: remove Donate, replace the header knight with the brand mark, remove the
search button. Each is a deletion, and in each case the *deletion* was the easy half.

### Donate: the height outlives the banner

Apple does not permit donation collection outside an approved non-profit flow, and this one had no
flow at all — `onDonate` defaulted to `{}` and no host ever passed it, in either language. Removing
the banner, `HomeDonate`, `HomePalette.sponsor`, `.home-banner.sponsor`, `--home-sponsor` and the
JS `DONATE` table is mechanical.

**`HomeScreenMetrics.bannerHeight` is deliberately NOT reduced.** It budgets
`naturalLineHeight(bannerSubSize) * 2` because Donate's `"Help sponsor\na student · ₱99"` was the
two-line subtitle and both banners were pinned to the taller one. The surviving Membership banner
has a one-line subtitle, so the obvious tidy-up is to drop the `* 2` — and it would be wrong.
`bannerHeight` feeds `fixedBandsHeight` → `gridHeight(container:)` → `tile(inGridContent:)`: the
grid is the only flexible band, so shrinking a fixed one grows all six cards, on every device, and
`3·h + 2·gap == gridHeight` is an exact identity the self-check pins. A colour request must not
change tile geometry. The comment now explains the coupling without naming a banner that no longer
exists, and `home_chrome_check.js` fails if the `* 2` is ever removed.

### The header mark: the asset was always there

`Images/brand-logo.png` — the "Byaherong COACH APP" collage — has shipped in the bundle since the
login screen landed, and only the login hero drew it. `Images/app-icon.png`'s gold knight is the
**app icon**, and it was standing in for the brand on the Home header. `HomeLogo` now passes
`asset: .brandLogo` through the `asset:` parameter `HomeAppIcon` gained for exactly this case, so
nothing new ships and `Diagnostics.swift`'s hard count of 6 PNGs + 1 SVG is untouched. The knight
keeps the Play-with-Coach ring and the iOS icon.

**The shape had to change with it.** The knight is a square field and reads fine in a `Circle()`;
the collage carries a wordmark across its bottom edge, which a circle crops off. So a squircle —
and its radius is **`LoginLayout.logoRadius / LoginLayout.logoSize`**, referenced rather than
re-typed. Same mark, same curve, both screens; a second hand-picked radius is precisely how two
copies of one brand drift apart.

It has to be a **ratio**, not a size: `logoSize` is `(54 * scale).rounded()` over a 0.75–1.7 scale
range, i.e. 41–92 pt. A fixed 13 pt radius would read as a near-circle on a small phone and a
near-square on an iPad. Radii land at 10 / 13 / 22 pt at the three reference scales, asserted in
`HomeMetricsCheck` §12.

The browser half cannot take the ratio by reference — `login.js` is a separate IIFE and `home.js`
has no load-order guarantee over it — so it restates `30 / 124` with a comment naming the source.
That restatement is exactly the "two hand-typed copies" risk `CLAUDE.md` warns about, so the new
gate reads both Swift login constants, both JS login constants and the JS fraction, and asserts all
four agree.

### The search button: deleting it is two changes, not one

`HomeSearchButton` was a 🔍 emoji in a 38 pt circle whose `onSearch` defaulted to `{}` and was never
passed. Removing it retires `HomeLayout.searchSize`, `searchEmojiSize` and `HomePalette.searchFill`
as well.

**The counterweight is the non-obvious half.** `HomeHeader` is `HStack(spacing: 0)` with the avatar,
then `HomeLogo(...).frame(maxWidth: .infinity)`, then the button. The logo is at true screen centre
*because* it is flanked by two equal-width controls; with one side gone it centres in an asymmetric
gap and lands 19 pt right. So the slot survives as `Color.clear.frame(width: HomeLayout.avatarSize)`
in Swift and `.home-header-balance` in CSS, and the gate asserts the CSS width equals the Swift
`avatarSize` — 38 in both — rather than trusting two literals.

Home's `🔍` had been on the documented "deliberate emoji, out of scope for vectorisation" list in
`docs/navigation-chrome.md` and above in this file; both now record that the button itself went, so
there is no glyph left to exempt.
## The trial gate — a reversed product decision (2026-08-18, fourth round)

Client, round 4: *"make sure hindi sila makakapaglaro ng kahit ano … kapag hindi sila naka 7-days
free trial … kada click lagi mong dalhin doon."* Nothing is usable until the trial is started.

**This is a deliberate reversal of a documented decision, not a refinement of one.** The
subscription was designed the other way round, in this file and in `docs/subscription.md`: a
genuinely playable free tier with the paywall reached on demand, and `Entitlement.Access.free`
carrying the comment *"Never a dead app — this is what makes the offline design safe."* Both now
record the reversal in place rather than being quietly rewritten.

### What did NOT change, and why that was the whole design question

The obvious implementation is to make `.free` mean "no access" in `Entitlement` — and it is wrong
on three counts:

1. `Entitlement`, `DailyLimits` and `Entitlement.Usage` are **parity-tested Core** with
   `requireMinCounts` floors, and `CLAUDE.md` forbids lowering a floor to make a run pass. Gutting
   them would mean either lowering floors or deleting goldens.
2. The caps are still **true of a lapsed subscriber**. Someone whose month runs out returns to
   `.free` with those exact allowances; a `.free` that means "nothing" would have to be a fourth
   state, which is more machine, not less.
3. `Entitlement.resolve` **already fails closed** — no `expiresAtMs` returns `.free` at line one.
   The Core was never the thing letting people in; the shell was.

So the change is one guard per language, at the router, and nothing else. `PhoneApp.locked`,
`openTabs`, `visibleTab`, `gatedTab`, `gated(_:)` in `PhoneView.swift`; `locked()`, `OPEN_ROUTES`,
`isOpenRoute()`, the tab-bar check and the `render()` backstop in `app.js`.

### The three non-obvious parts

**Gating the tiles gates the pushed routes.** `showAnalysis`, `showCoach` and `showPairing` are set
from Home tile closures and nowhere else, so four wrapped closures close three whole screens. That
is a property, not a coincidence, so `trial_gate_check.js` asserts each flag has at most one other
setter — a second entry point would be a silent bypass.

**Two exemptions, and exactly two.** `onAvatar` (Profile owns Sign out; walling it strands a user
who signed in with the wrong Apple Account, and Restore lives on the paywall they could then not
leave) and `onMembership` (it *is* the offer). The gate counts the ungated callbacks rather than
naming them, so a third exemption fails.

**A lapse can happen between taps.** `Transaction.updates` fires mid-session and the browser demo's
own entitlement picker does exactly this. A tap-time-only gate would leave a user playing on a tab
they no longer own, so both halves re-resolve on every paint: Swift through `visibleTab`, the
browser through a backstop ahead of its dispatch chain. The backstop forces `paywallReturn` to Home
— returning to the screen it just walled would bounce straight back into itself.

### A divergence this exposed

`app.js` gated **only** the four puzzle modes. Play vs Coach, the Analysis Board and the Swiss round
ceiling had no premium reference anywhere in the browser, while Swift gated all three via
`CoachScreens.isCoachLocked`, `consumeReview()` and `maxSwissRounds`. `replay_premium.js` asserts
the JS *puzzle* gates and the *Swift* coach/review gates as separate lists, so nothing compared the
two languages' coverage and the drift survived every green run. The client tests on Windows, so
what they had been looking at was an app with no locks on it at all.

One router guard closes it, and `trial_gate_check.js` now compares the two open sets directly —
mapping the Swift tab *indices* through the browser's tab table, so `[0, 3]` is verified to still
mean Home and Profile rather than assumed to.

### Consequence for shipping

The 7-day introductory offer still does not exist in App Store Connect. That was a to-do while the
free tier carried the app; now it is the only door in, and a CTA reading "Start Your 7-Day Free
Trial" against a product with no introductory offer promises something the store will not honour.
Listed in `docs/subscription.md` § *Before this can ship*.

## Opening Tree — the openingtree.com port (2026-08-18, fourth round)

Client: *"yung opening trainer pag cliniclick ko ayaw mabuksan … gusto ko mangyari dyan katulad dito
mismo https://www.openingtree.com/."*

The tile was a designed placeholder, not a bug: `HomeScreen.onOpeningTrainer` defaulted to `{}` and
no host ever passed it, in either language. What follows is what the screen behind it had to decide.

### Two features share one tile's name in the source app

The RN "Openings" hub is a **tab switch** between two unrelated things: a Chessable-style SM-2
**Trainer** over 22 curated repertoires (server-driven, `OpeningTrainerController` + `applySm2`), and
**My Tree**, the 1,457-line openingtree.com clone. `specs/BIYAHERONG-PORT-SPEC.md` §4 specs the
first in full — 440 lines including the SM-2 algorithm in Swift and all 22 repertoires — and never
specs the second, mentioning it only as *"hands off to the legacy opening-tree screen"*.

The client named openingtree.com, so **the tree is what was built**. The SM-2 trainer stays unbuilt
and §4 stands as its design. The tile's copy moved to "Opening Tree / Explore Your Openings" because
"Master Your Repertoire" describes the other one.

### SAN keys, not FEN keys — a deliberate divergence from `OpeningBook`

`OpeningTree.Node` is keyed by the SAN of the move that reaches it, so `1.e4 c5 2.Nf3` and
`1.Nf3 c5 2.e4` stay separate branches. That is the RN original's `Record<string, TreeNode>` and
openingtree.com's model, and it is the **opposite** of what `OpeningBook` does one file away, where
`positionKey` deliberately collapses transpositions — a fix `build_eco.php` had to make before the
book shipped. Both are correct: a book answers "is this theory", a tree answers "what do I play".
Written down because the two sitting side by side otherwise reads as an oversight.

### Stats are the mover's, and the inversion is the feature

`wins`/`draws`/`losses` describe how the side that PLAYED the move fared, so the sign flips on the
opponent's plies:

```swift
let moverScore = moverIsOwner ? ownerScore : -ownerScore
```

Reversed, every second row of the list is exactly wrong and entirely plausible-looking. Asserted by
name in `replay_opening_tree.js` §3 and in the `opening_tree` parity group, and mutation-checked.

### The sort tie-break is load-bearing

Count descending, ties by SAN ascending. `Dictionary` iteration order is unspecified in Swift and
`sort` is not stable (the rule `CLAUDE.md` states for every ported sort), so a comparator on `count`
alone gives a different order on every run and a different order from the JS twin — which would make
the replay itself meaningless.

### INVENTED constant: `defaultMaxPlies = 40`

The RN screen has **no** depth cap and walks every ply of every game. At its own 2,000-game download
ceiling that is a memory hazard — a 120-ply game contributes 120 nested dictionaries — and it is not
what an opening tree is for: past move 20 every count is 1 and the branch is a game record. 40 plies
is 20 full moves. `maxGamesLimit = 2000` is the RN form's own number, kept so the two agree.

### No golden file, and why that is not a gap

Every other Core module is pinned to a PHP oracle. This one cannot be: `openingtree.tsx` is
TypeScript in the RN app, not a Laravel controller, and the backend's `/api/openings` only **stores**
a `tree_data` blob the client built. The differential partner is `web-demo/js/opening-tree.js`
instead, compared source-to-source by `replay_opening_tree.js` and run by `js_goldens.js` — the same
standing-in the notation core uses, and the reason the `opening_tree` floor is a plain assertion
count rather than a golden-case count.

### Fixed on the way through

- **`mainlineTokens` is a tokenizer, not a validator.** `"not a game"` returns three move tokens, so
  the obvious `games.isEmpty` check passes and builds an empty tree. Both languages now validate on
  **positions**, after the replay.
- **A missing `Result` tag is read off the movetext, not off the tokens.** `mainlineTokens` drops
  result tokens by design, so the first draft's `tokens.last` fallback could never have matched —
  dead code that looked like a feature. Both halves now scan the raw movetext's last token.
- **`--op-*` collided with itself.** `buildBorder`, `inputBorder` and `infoBorder` each name a width
  in `LAYOUT` and a colour in `PALETTE`; one prefix let the colour overwrite the width, and three
  borders rendered with a hex string as their thickness. Split into `--op-*` (geometry) and
  `--opc-*` (colour), asserted by the replay.
- **The extractor could not run from a worktree.** A worktree sits three levels deep, so
  `ROOT/../BYAHERONG-COACH-FRONTEND` resolves inside `.claude/worktrees/`. This extractor takes a
  `FRONTEND_ROOT` override, as `tools/oracle` takes `LARAVEL_ROOT`; the other four still do not.

### The explorer's engine and its playable board (2026-08-24)

Client, after the download landed: *"sana lagyan mo din ng engine evaluation tapos pwede mag
interrupt yung user sa position"*. Both go **beyond** the RN screen, and both are recorded here
because neither is a port.

**INVENTED: the eval rail.** `openingtree.tsx` has the engine toggle and the three lines but **no
bar at all** — the rail lives in its sibling `board.tsx`. Rather than invent geometry, the explorer
reuses the Analysis Board's already-extracted `AnalysisEval.*` and its `.an-eval` CSS, and the body
was lifted into a shared `EvalRail` so there is one rail in the module rather than two. Its height
comes from `OpeningBoard.edge(screenWidth:engineOn:)`, a new one-entry-point function that
deliberately does **not** route through `AnalysisBoard.edge`: that snap-to-8 formula is pinned to
`DragDropChessBoard.tsx` and would have narrowed today's full-bleed board by 0.67 pt at 3× on a
screen nobody asked to change.

**INVENTED: `OpeningTree.maxFreePlies = 20`.** openingtree.com has no such limit and neither does
the RN screen, because in neither can you move a piece. It is not defensiveness: `position` and
`lastMove` replay the whole path on every SwiftUI `body` evaluation and `path` is `@Published`. It
also makes an existing comment true again — `position`'s doc claimed the walk was bounded by
`defaultMaxPlies`, which held only while the UI offered nothing but the tree's own moves.
Deliberately a second constant: `defaultMaxPlies` bounds how much of a GAME is worth recording, this
bounds how far a USER may wander, and one constant serving two meanings is how `maxGamesLimit` came
to be 2000.

**DEVIATION: the RN `getEvalColor` bug is not reproduced.** It tests `startsWith('M')` before
`startsWith('M-')` (`openingtree.tsx:600-605`, and the identical code at `board.tsx:940`), so a black
mate `M-3` returns green — the losing side's own forced mate painted as an advantage. `CLAUDE.md`
says to port the intended behaviour; the minus is checked first, in both languages, asserted by name.

**DEVIATION: the board is playable, and the RN one is locked.** `openingtree.tsx:950-965` passes
`disabled={true}`, `dragEnabled={false}` and no-op handlers. The old port matched it, on the stated
reasoning that navigation is the move LIST's job. That was right while the tree was the only thing
you could walk; playing your own move is the way you LEAVE it.

**DECISION: a transposition stays off book.** `bookDepth` walks SAN keys, so `1.Nf3 c5 2.e4` does not
rejoin `1.e4 c5 2.Nf3`. Detecting it would need a second, position-keyed index over the whole tree —
built per render or persisted, i.e. a document-format change — and the candidate counts it produced
would describe a different move order than the history strip above them shows. Asserted by name in
both gates so it reads as a decision rather than a gap.

**MOVED: `Square.isBackRank`.** `CoachLayout.lastRankWhite/lastRankBlack` existed because Play vs
Coach was the only board you could push a pawn on. The explorer is the second. A back rank is a fact
about chess rather than about either screen's layout, so it is in the Core; the alternative was a
second copy.

#### The gate rework, and why the floors had to change

Both drag rules floored on *"at least one display board exists"* and this screen was the last one in
each language. A floor over an empty set says nothing, so the exempt arm is now proved three ways
instead: the predicate is a **named function exercised on fixtures**, the census is stated **exactly**
(`display === 0` / `displayOnly === 0`) so it is falsifiable, and each rule gains a **mutant that
makes a real playable board display-shaped** — the only way that can move the census is for the
predicate to have matched, so a rotted predicate lets the mutant survive. That is precisely the
canary the floor used to be.

Two mutants had to be re-pointed. The JS one is the instructive failure: it would not merely have
stopped applying, it would have **applied and SURVIVED**, because `openings.js` now sets `.rules` and
the drag legitimately — reporting a dead rule as a live one.

**And the harness earned its keep.** On the first full run after the board became playable,
*"a board move is spelled instead of resolved"* **survived**: nothing exercised the function turning
the component's UCI into the store's SAN. Returning the UCI unresolved makes an on-book move read as
off book — the board advances, the list empties, nothing says why, and it looks exactly like the
feature working. It is asserted directly now, in both `openings.selfTest` and replay §16.

Finally, the rail's own five mutants were **hand-run prose in `CHANGELOG.md`** (*"21/21"*), which
held exactly as long as nobody moved the code. Extracting the rail moved it. They are in
`swift_layout_mutation_test.js` now, so they travel with the file.

### The one networked path — declared, not wired, then WIRED (2026-08-24)

`OpeningSource` has four cases and `isOnline` is the single source of truth for which two need the
radio. The form drew all four — hiding them would lie about what the feature is — and the online
pair *refused with a named message*, on the reasoning that the download belonged in `ContentClient`
(spec §0.1: the only `URLSession` sites in the app).

**That reasoning was right about where the code goes and wrong about what the user sees.** The named
message was `errNetwork` — *"Could not reach that site. Check your connection and try again."* — so
the app blamed the user's connection for a feature that did not exist. The client reported it as
*"hindi nag-oopening tree"*, and it survived a green suite and TestFlight because the two failures
are indistinguishable from the outside. `openings.js`'s selfTest had even pinned it in place
(*"and then says the download is not wired"*): **a test that asserts a bug makes the bug look
decided.**

The client's ruling on the trade-off, verbatim: *"dito kailangan ng internet kaya pwedeng hndi 100
percent offline 90 percent lang kasi ito kailangan online pati yung sa videos online din yun"*. So
the app is documented as **~90% offline** — Sign in with Apple, this download, and Videos when they
land — and `README.md`, `CLAUDE.md`, `ios/project.yml` and the in-app privacy sheet all say so.

**Spec §0.1 is honoured rather than excepted.** It already drew an ONLINE half (Opening Trainer
packs, Tutorial Videos); this is the first part of it to ship, so `OpeningDownloader.swift` is that
rule's first inhabitant and `ContentClient` will copy its shape. The rule is now a *test*:
`replay_opening_tree.js` §12 sweeps every file in `BiyaherongUI` and every file in `web-demo/js`
and fails if more than one of each opens a connection. Both sweeps assert their own file counts, so
a detector that stops matching cannot report a clean sweep of nothing.

#### Four deviations from the RN implementation, all deliberate

| # | RN behaviour | Ours | Why |
|---|---|---|---|
| 1 | A game with no `winner` is scored **1/2-1/2** | `nil` when `status` is unfinished (`aborted`, `noStart`, …) | The RN mapping gives an aborted game — often the first in a stream — half a point to both sides. `OpeningTree.Outcome` already decided that `*` contributes a count and no W/D/L for pasted PGN; two import paths disagreeing about one game is worse than the bug being fixed. |
| 2 | The White/Black picker **is** the colour whenever it is not "both" | The colour is read from the game; the picker **filters** | `addGamesToTree` labels every game in a "White" tree as White, so games the user had Black in land inverted. The username is known for every online game, so the truth is available. Same picker, same meaning, all three sources. |
| 3 | Jumps to the explorer and grows the tree **live** | Accumulates, builds once, saves only on success | The RN version leaves a half-built tree saved whenever a download fails — indistinguishable from a real one once the banner is gone. A failure here leaves the form open with the reason on it. The counter still moves. |
| 4 | `extractMovesFromPgn` + a `[Result "…"]` regex for Chess.com | `OpeningTree.games(fromPGN:)` | That parser is already pinned to the real `PgnImportService` by the `pgn_split`/`pgn_tokens` goldens, and Chess.com already writes `White`/`Black`/`Result` tags — so the colour match, the result and the RAV/NAG handling come for free and agree with the paste path. |

#### An invented constant, corrected rather than added

`OpeningTree.maxGamesLimit` was `2000`, documented as *"the download ceiling the RN form offers"*.
**The RN form's ceiling is 1000**, clamped in both of its two places (`openingtree.tsx:479` and
`:917`). The ParityRunner assertion read the constant back to itself, so a wrong number passed under
correct prose — the exact failure mode `CLAUDE.md`'s "EXTRACT, DON'T TRANSCRIBE" exists to prevent,
and the second one this repo has found after the annotation-badge sign. The constant is **deleted**,
not corrected: the limits belong to the download, so `OpeningDownload.premiumMaxGames` is the one
copy and §12 checks it against the RN source's real value.

#### One asymmetry between the two languages, on purpose

`opening-download.js` has a `lastCompleteLineEnd`; `OpeningDownload.swift` does not. A chunk
boundary falls anywhere, including inside a JSON object, so the RN `processBuffer` keeps a buffer
and cuts it at the last newline. Swift gets that from `URLSession.AsyncBytes.lines`, which splits
the *byte* stream and therefore handles UTF-8 boundaries a String-index version would have to
re-derive. The browser has no equivalent — `ReadableStream` hands back bytes and nothing else. Both
files say so, so the next reader does not "restore" the missing half.

#### The privacy sheet has now been narrowed twice

It opened with "100% offline" until Sign in with Apple became a real `ASAuthorizationController`
call. The replacement claimed the app *"does not collect, store, or send any personal information
anywhere"* — which this download makes false in the most literal way available: it sends **the
username the user typed** to a third party. The claim is narrowed rather than dropped (no account
server, no analytics, no tracking — all still true) and both exceptions are named, in both
languages. `replay_login.js` compares the two copies in full.

**Still open, and no gate here can see it:** the App Store Connect privacy answers were filled in
for an app that sent nothing. They need re-checking before the next submission. Noted in
`ios/project.yml` beside the export-compliance declaration, which does **not** change — the download
is OS-provided TLS with no cryptography of the app's own, so the standard-encryption exemption
still applies and `ITSAppUsesNonExemptEncryption: NO` stays correct.

## The web shell — two things that were never wired (2026-08-18, round-4 follow-up)

Both found by the client, both invisible to every suite, and both the same shape: something correct
on disk that never reaches the page.

### `coach.css` was never linked

`web-demo/index.html` listed `theme.css`, `app.css`, `pairing.css` — and not `coach.css`. Since
`bbb11ba`. The whole Play vs Coach family rendered with UA defaults the moment `app.js` started
routing Play to it.

**Why no gate caught it.** `docs/play-vs-coach.md` carried the caveat verbatim: *"the wiring has not
been exercised in a real browser … `auditAppWiring()` reads `app.js` as source instead … that
catches a control wired to nothing; it cannot catch a layout problem."* That was exactly right.
Worse, the bug had already been **noticed** a round earlier (`CHANGELOG.md:590`) and the guard
written for it — `replay_login.js:332-333` — asserts only that `app.css` is linked. A guard written
for one file, for a class of bug that is about *all* files.

The lesson is the one this repo keeps relearning in a new place: a check that reads the same source
the code reads cannot see a wiring gap. `tools/qa/web_shell_check.js` asks the page instead — every
stylesheet on disk is linked, every script is loaded or is a verified Worker.

### The scrollbar rule was documentation, not enforcement

`app.css:9`: *"Hide scrollbars everywhere for an app-like look (scrolling still works)"*, applied to
`html, body`. **`scrollbar-width` is not an inherited property**, and a `::-webkit-scrollbar`
pseudo-element matched on `html, body` does not cascade to descendants. Every nested scroll band has
to declare both halves itself. Thirteen did not.

Only the `.an-*` family had it right, because it is the most recently finished screen family and
copied its own neighbours. The Opening Tree, added in this same round, inherited the omission from
the puzzle screens it was modelled on.

### DEVIATION resolved: `resize` is banned outright

`resize: vertical` appeared on four textareas. **iOS has no resize handle**, so each one was an
affordance the browser offered and the Swift app could not — a divergence the mirror is supposed to
prevent, not create. `pairing.css`'s `.pgd-modal-area` already had `resize: none` and is where the
Opening Tree's box was copied from, with that single line flipped.

All five are `none`. The gate bans any other value, so the mirror cannot grow a control the app
cannot have.

### INVENTED constant: `OpeningLayout.pgnMinHeight = 160`

The RN form has no PGN box, so there is nothing to extract. Taken from `.pgd-modal-area`'s 160 px,
the app's other paste-a-blob field, so the two agree.

It had been living as `min-height: 160px` inline in `app.css` — the only numeric literal in the
`--op-*` block, contradicting the block's own header comment and `openings.js:8`. A number written
in a stylesheet is a number no gate and no Swift twin can see, which is precisely how the two
languages came to disagree: `TextField(axis: .vertical)` grows from **one line**, so the browser
showed a 160 pt paste target and the app a single-line input. Both take the metric now, and
`replay_opening_tree.js` compares it because it loops over every `LAYOUT` key.

## Home as the app root — the tab bar removed (2026-08-18)

Client: *"kailangan ko lang mga back button para makapag-back yung mga user sa home page."*

### The decision was already recorded, including its blocker

`docs/home-screen.md` had carried both halves for as long as the screen has existed: that hosting
Home inside a tab bar costs **~74 pt straight out of the grid** on every device, that the icon slot
is what gives way (artwork at 50–75 % of design size), and that the structural fix is to make Home
the app root — *"which would need a way back from the six destinations, which this screen
deliberately does not have."*

So this is not a new design. It is the recorded fix, plus the prerequisite the client asked for in
the same sentence.

### What the shape change actually is

`PhoneApp` had two navigation models at once: a four-index `switch` for Home/Puzzles/Play/Profile,
and a set of `show*` booleans raising Analysis, Pairing, Play vs Coach and Opening Tree as ZStack
siblings over it. The second model already had everything the first needed — a back button, a
`.transition`, full-screen coverage — so the change is not a new architecture but the deletion of
the older of the two. Puzzles and Profile become `show*` flags like the rest.

`OPEN_ROUTES` in the browser needed no edit at all, which is the tell: it had been keyed by route
name the whole time, and only Swift was thinking in indices.

### Two screens that were only reachable through the bar

- **`PlayPhone`** (+ `phoneBoard`, `PlayPhoneBoard`) — the pre-port sample play screen. Its browser
  twin was deleted a round earlier; this file recorded why the Swift one outlived it — `BoardView`
  lived inside `PlayView.swift` and had to be lifted first. It was, and the tab bar was the screen's
  last door. **`LegacyCoachSelect` is deliberately kept**: the macOS demo's `Panel.play` renders it
  through `PlayView`, which is the engine/board harness rather than a phone screen.
- **`LearnPhone`** — already unreachable before this change. No tab hosted it, nothing referenced
  it. Dead code that read as a screen.

### `an-mode` / `op-mode`: two classes whose only job was hiding the bar

21 `classList.add/remove` calls across the browser, and exactly two CSS rules —
`.app-card.an-mode .tabbar { display: none }` and its `op-mode` twin. Every pushed route dutifully
set a class that, without a tab bar, does nothing. All of it is gone. Worth recording because the
calls *looked* like a layout mechanism and were bookkeeping for a single `display: none`.

### DEVIATION recorded: `HomeMetricsCheck`'s container heights are no longer verified here

§4's five reference containers were "device minus safe areas minus the ~74pt tab bar". They grew by
that 74, written as `reclaimedFromTabBar` so §4 and §5 cannot drift apart.

§5 asserted, with a strict `<`, that the icon clamp **engages** on a 4.7" phone — a statement about
a shell that no longer exists, and one that removing the bar may well invert. Rather than weaken it
to a `<=` that would pass either way (a vacuous assertion this repo does not accept), it became two:

1. the clamp still engages when the grid really is that tight — the old SE box, kept precisely
   because it is the tight case;
2. the same phone *without* the bar gets a strictly larger `iconBox` than with it.

The second is monotonic and therefore true by construction, and it is the change expressed as
arithmetic rather than as prose. **Neither has been run**: `HomeMetricsCheck` is a macOS executable
and no JS gate carries those numbers. `swift run HomeMetricsCheck` on a Mac is the confirmation.

## Every logo slot holds the brand mark (2026-08-18)

Client: *"yang ganyang image palitan mo lahat ng Biyaherong Coach logo please, lahat."*

### The knight had three draw sites left, and one of them was a divergence

`HomeScreen.coachRing`, `home.js`'s `playCoach` card art, and `premium.js`'s `.pw-logo`. The last is
what the client screenshotted, and it was the only place in either language that clipped the knight
to a **true circle** — while `PaywallScreen.swift` had been drawing the collage in a squircle the
whole time. A cross-language divergence that no gate compared, because art is a file reference
rather than a value.

`HomeAppIcon`'s `asset:` parameter now defaults to `.brandLogo` rather than `.appIcon`. That is the
mechanism that let the coach ring keep the knight after the Home header moved on: it omitted the
argument, and the default was the wrong thing to inherit.

### Nine rings that were half a port

`tools/metrics/puzzle_styles.json` → `shared.logo._source = "components/AppLogo.tsx"`. The RN
component is a View with a 2 px gold border, `borderRadius: size / 2` and **`overflow: hidden`** —
that last property is only meaningful around a child, and the child is the app's logo. The browser
ported the ring to nine headers and never the image. Swift ported it to three (the pairing headers,
via `HomeLogo`), left an invisible `Color.clear` counterweight in two coach headers, drew an empty
`Circle()` in the Streak solver, and skipped the slot entirely in the rest.

Filled: all thirteen browser sites through one `BiyaIcons.brandLogoEl(cls)` helper, and the three
Swift sites where the replacement is footprint-identical.

**Known gap, deliberately not closed blind:** the Swift Puzzle Hub, solver, Daily and Thematic
headers, and the coach colour screen, have **no logo slot at all** — their browser twins do. Adding
one is a layout change, and there is no Swift compiler on this checkout; inventing five headers'
geometry blind is exactly what the extraction discipline exists to prevent. Recorded here rather
than half-done.

### DEVIATION: the rings are squircles, not circles

`AppLogo.tsx` uses `borderRadius: size / 2` — a circle. The ports use `--brand-radius: 24%`, the
login hero's 30/124 proportion.

The reason is the same one recorded for the Home header last round: the mark is a square collage
with a wordmark across its bottom edge, and a circular clip cuts the "APP" badge off. The RN app
crops it too; at 30 px the difference is between a legible mark and a blue disc. A percentage rather
than a length because the rings run 30–40 px and a fixed radius reads as a circle at one end and a
square at the other.

### The knight file is kept on purpose

`Images/app-icon.png` is byte-identical to `ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png`
(md5 `2d05a4c4…`): the shipped app icon and the bundled asset are one file. The client chose to keep
the knight there — a photo collage with a wordmark is unreadable at 60 px — so the asset stays, the
`HomeArt.Asset` case stays, and `Diagnostics.swift`'s count of 6 PNGs is unchanged. What changed is
that nothing inside the app draws it, and `home_chrome_check.js` §7 keeps it that way with two
named exemptions: the iOS icon, and `login.js`'s 404 fallback.

## App Store blockers, and a licence claim with nothing behind it (2026-08-18)

Client: *"make sure lang pag pinasa natin to 100 percent papasa."* Three blockers, all of them
already recorded in this file or in the source, plus a fourth found on the way.

### The simulated sign-in finally went away

`LoginStore.swift`'s doc comment and this file both said it: a "Continue with Apple" that performs no
Apple authentication is an App Store rejection. `LoginAppleAuth.swift` is the real
`ASAuthorizationController`, and it is the **only** file in the package permitted to import
`AuthenticationServices` — asserted positively (the call is there) and negatively (an exhaustive
directory scan finds no other importer).

**DEVIATION, and it is a product one:** `requestedScopes = []`. Apple can supply a name and an email;
the app asks for neither. It shows `LoginStrings.defaultDisplayName` and persists nothing but the
provider string, so collecting either would be data with no use — and would make the new privacy
manifest's empty `NSPrivacyCollectedDataTypes` false. The two decisions are load-bearing on each
other and must move together.

**Deliberately NOT done:** `getCredentialState(forUserID:)` at launch. It is Apple's advice for
server-backed apps; here it would add a launch-time round trip for a session that is purely local, and
would let a network hiccup sign a user out of an offline app.

**"100% offline" is now "offline after sign-in".** Apple's servers answer the sign-in, so a cold
install with no network cannot get past the gate — and the gate is the last ZStack sibling covering
the whole app. The export-compliance `NO` is untouched and still correct (a second Apple framework
over OS-provided TLS, exactly like StoreKit), but the *product* claim was reworded in both languages
rather than left standing. `replay_login.js` compares the legal bodies in full, so it could not have
been changed in one.

### The gate that was written to catch this, caught it

`replay_login.js` banned the token `ASAuthorization` in all five login files. That ban was the thing
keeping the simulation honest, and the correct response to it firing was **not** to delete it: it
became an allowlist of one, with the networking bans (`URLSession`, `URLRequest`, `fetch(`,
`XMLHttpRequest`, any URL) still applying to every file **including** the new one. Sign in with Apple
reaching Apple is not the app opening a connection.

**How the browser twin stays honest.** A browser has no `ASAuthorizationController`, so the mirror
does not pretend. The two languages share the *decision* half — a 12-entry transition table, compared
in full — and the branch that matters is that **a cancelled sign-in is not an error**. The asymmetry
is then asserted explicitly in four directions rather than papered over: Swift has the call, no other
Swift file imports the framework, the browser has neither, and the browser carries a `SIMULATED_AUTH`
flag the Swift must not.

### Account deletion: the keep list is the half that matters

Guideline 5.1.1(v) follows from a real Sign in with Apple, so it ships in the same build. With no
server, "delete" is local erasure — and two things are kept **on purpose**:

- `biya.store.subscription.v1`, StoreKit's entitlement snapshot. Apple requires that deleting an
  account not forfeit a paid subscription; `KeychainStorage` already outlives a delete-and-reinstall
  deliberately. The confirmation copy names Settings > Apple Account > Subscriptions, because Apple
  checks for exactly that.
- `biya.store.usage.v1`, the daily free-tier counters. Clearing them would make "delete account, sign
  in again" a free reset of every cap — a paywall bypass wearing a privacy feature's clothes.

`store.reset()` runs **before** the erase: the hub's progress is live in memory and would otherwise be
persisted back over the deleted file. The confirm is a **modal, not a route** — `trial_gate_check.js`
asserts `OPEN_ROUTES` is exactly `home/login/paywall/profile`, and a destructive confirm is not
somewhere you navigate to and press Back out of.

The erase list is literals rather than references: the keys are statics on `@MainActor` stores this
pure enum cannot reach. So `replay_login.js` reads both sides out of the source and asserts each copy
still matches its original — the same trade this repo makes everywhere it cannot reach a constant.

### DEVIATION: the app is not GPL, and the Terms sheet no longer says it is

`README.md` and `CLAUDE.md` record decision #2 as "Stockfish (GPL) + publish the app's source
openly". That decision has not been carried out — there is no `.cpp`, no NNUE, no submodule and no
dependency, and `LocalEngine` is original work — yet the bundled Terms sheet told every user *"the app
itself is GPL"*, with no LICENSE file in the repo at all.

Corrected in the direction of truth: a `LICENSE` describing what ships, a `THIRD-PARTY-NOTICES.md`
carrying the obligations actually owed (CC BY-SA piece art, which is copyleft; OFL Nunito; CC0 data),
and the sheet naming those instead.

**Adding a GPL LICENSE now would have been the wrong reflex.** GPLv3's anti-additional-restriction
terms conflict with the App Store's, which is the VLC precedent. That is a real problem to solve in
the commit that actually vendors Stockfish — and a licence grant, once published, cannot be
withdrawn. `LICENSE` carries that note so the next person does not re-litigate it.

## Five coaches, five clocks (2026-08-18)

### The docs were wrong about which engine the coach runs

`docs/engine-settings.md` said Play vs Coach "reads the same evaluation improvements only through
`ChessAI`, which is untouched". `CoachStore.swift` calls `LocalEngine().analyze(...)`. The coach has
been running the strong engine — transposition table, quiescence, null-move, LMR, PVS, `AnalysisEval`
— all along; `ChessAI` is reachable only from the macOS demo's `Panel.play` harness and the parity
tests. Corrected in both docs, and worth recording because it is the second time a prose claim about
this pair has drifted from the call site.

### DEVIATION: the flat 1 s movetime cap is gone

`CoachEngine.movetimeCapMs = 1000` reproduced the Python service's cap, and its comment argued the
case: *"the bots' real strength IS the strength of a 1-second search."* That was right about the
number and wrong about what it preserved. The Python service ran real Stockfish; this runs
`LocalEngine` at ~60k nodes/sec. Keeping the latency budget did not keep the strength — it flattened
the top of the ladder, because `depth` is only a ceiling and the engine reaches a mean depth of 6.33
at 1200 ms while levels 4 and 5 ask for 10 and 15.

Now per level: 300 / 600 / 1000 / 2000 / 4000 ms. **Level 3 keeps exactly 1000**, so the change is
anchored to the old behaviour at one point rather than being five new numbers at once.

**Two interactions, decided rather than discovered.** `thinkMs` is a *floor* on the reply awaited in
parallel with the search, so the reply is `max(search, floor)` and levels 4 and 5 simply stop being
paced; raising the floors to match would slow down *fast* positions, which is the opposite of a
floor's purpose. And `endgameScale` trims the floor only — nothing scales the search clock — but
nothing needs to, because a sparse board reaches level 5's depth-15 ceiling long before 4 s, which is
what `maxDepth` is for. Both are written beside the table.

**The Elo labels were NOT re-derived.** They are display-only, and the client chose to leave them.
Level 5 is labelled 2500; the honest estimate from depth and node rate is nearer 1700-2100. Recorded
so nobody later reads the label as a measurement.

### Two mutants went vacuous, and were re-pointed

Both anchors were strings this change edited: `public static let movetimeCapMs = 1000` (deleted) and
`3: Config(depth: 7, numMoves: 2),` (gained a field). A mutant whose anchor is gone never applies and
reads as a pass — the harness reports it as BROKEN, which is quieter than a failure and easy to scroll
past. Re-pointed, never deleted. The replacement for the first is a better mutant than the original:
it starves level 5 back to level 3's clock, which *is* the defect this change fixes.

`replay_coach.js`'s single `eq(MOVETIME_CAP_MS, movetimeCapMs)` became a per-level comparison plus a
monotonicity assertion. "Both languages agree it is 1000" was exactly what the old line could not
catch, and is why this survived as long as it did.

## The entitlement the profile did not carry (2026-08-19)

### A failure mode with no error

Sign in with Apple needs `com.apple.developer.applesignin` in the **provisioning profile**, not merely
in `ios/Biyaherong.entitlements`. Codesign takes the entitlements the profile allows and **drops the
rest without a word** — so the archive succeeds, validation passes, the app installs, and the only
symptom is Apple's own sheet stopping on "Sign Up Not Completed" after the user has already picked
their account.

`docs/app-store-readiness.md` originally said the missing capability makes *signing fail*. It does
not, and that wrong sentence is exactly why the symptom read as a code bug. Corrected, with the
pre-flight check that would have shown it:

```
codesign -d --entitlements :- Payload/Biyaherong.app | grep applesignin
```

### DECISION: the build flag fails CLOSED, and its sense is inverted

`BiyaherongBuild.isTestBuild` defaulted to `true`, so a build told nothing was an open one. The
argument was sound and is preserved verbatim in `docs/account.md`: the failure that kept recurring
was a build nobody could open, silently, and a loud failure in the rare workflow beats a silent one
in the daily workflow.

What it missed is that **`tools/ship/ship_testflight.sh` sets no build settings at all.** The repo's
documented one-command ship was therefore, every single time, uploading a build that granted the
subscription to everyone and performed no Apple authentication. Nothing looked wrong, because
nothing was wrong from the build's point of view.

So `#if BIYA_APPSTORE` became `#if BIYA_TESTBUILD`, the default became `false`, and the old
convenience moved to `configs: Debug` in `ios/project.yml` — Xcode Run is still fully open, every
archive is real. The asymmetry the original argument rested on is now handled by making **every**
path assert rather than assume: the two CI test workflows refuse when the flag is absent, and
`ios-appstore` and `ship_testflight.sh` refuse when it is present, all four reading the effective
build settings back rather than trusting their own `sed`.

Forgetting a flag should cost a tester an inconvenience. It should never cost the product its
revenue.

### DEVIATION: `Save {n}%` is rendered; the RN only rendered `BEST VALUE`

Spec §3.2 describes the yearly card as carrying the badge **"plus the computed saving `Save {n}%`"**.
`app/(app)/user/premium/index.tsx:646-651` renders only `BEST VALUE`; there is no saving anywhere in
that file. The two disagree, and the RN source wins on questions of fact — so this is recorded as a
deviation rather than dressed up as a port.

It is kept because the number is *derived*, not written down: `PremiumStore.yearlySavingsPercent`
computes it from the two real `Product.price` values and returns nil when either tier is missing or
the arithmetic would not be true, in which case the line simply does not appear. That satisfies the
rule the whole paywall is built around — no price on this screen is ever a literal.

While extracting the toggle back out of the RN we also caught a transcription risk in the spec's own
prose: the sub-line under each price is `planToggleSub` at **12pt**, not the 11pt of `planPriceSub`,
which is a different style on a different card. Two hand-typed copies agreeing with each other is
not verification.

### DEVIATION: the paywall's Privacy Policy link is `/privacy-policy`, not `/privacy`

The RN shipped `https://biyaherongchesscoach.com/privacy` and spec §3.2 wrote the same string down.
**Both are wrong.** The Laravel route is `/privacy-policy` (`routes/web.php`); `/privacy` returns
404, verified live. App Review clicks that link on every auto-renewing-subscription submission, so
this was a rejection sitting in the code waiting for a submission to happen.

This is the "do not reproduce a latent bug — port the intent" rule applied to a URL. A redirect from
`/privacy` is added on the Laravel side as well, because builds already in the wild carry the old
string and cannot be fixed from here.

### DEVIATION: yearly sits at a higher service level than monthly

`ios/Biyaherong.storekit` gives yearly `groupNumber: 1` and monthly `2`, so moving monthly → yearly
is an upgrade that takes effect immediately rather than a deferred crossgrade. The RN had no local
StoreKit configuration to copy, and App Store Connect must be set up to match.

Its `_storefront` also moved `PHL` → `USA`. The prices we control are the **USD base** ($1.99 /
$19.99); leaving the storefront on `PHL` would have rendered them as `₱1.99`, and the converted peso
figure is not something this repo can verify. Do not write down a number you cannot check.

### DEVIATION: a compile-time simulated sign-in, for one workflow only

The free path (`ios-free-unsigned`, signed afterwards with Sideloadly) can never carry that
entitlement — free provisioning profiles do not support Sign in with Apple. And because the login gate
is the last ZStack sibling, covering every route above it, a build that cannot sign in cannot be
opened **at all**. Not degraded: unusable.

`BIYA_TEST_BUILD` is therefore set by that one workflow, and `LoginAppleAuth.start` takes a
`finish(.succeeded)` branch ahead of the real call.

**This is the fake sign-in that was just removed as an App Store blocker, deliberately reintroduced
behind a build flag.** That is only defensible because it cannot reach a shipping build, so the guard
is the point rather than a formality: `replay_login.js` asserts the real `ASAuthorizationController`
is still the `#elseif os(iOS)` branch every other build takes, and that the flag appears nowhere in
the `ios-testflight` half of `codemagic.yaml`. Both directions are mutation-checked. A compile flag
was chosen over a runtime fallback on `ASAuthorizationError` precisely because a runtime fallback
would also fire on the reviewer's device.

### The app icon is the brand mark; the earlier decision was reversed

The client chose to keep the knight as the app icon when asked, on the argument that a photo collage
with a wordmark turns to mud at 60 px. They then saw it inside Apple's Sign in with Apple sheet, which
draws the app icon, and asked for the brand mark there too. Reversed on their instruction.

Rebuilt from `brand-logo.png` with a **palette → RGB conversion**: App Store Connect rejects an icon
carrying an alpha channel, and the source is a palette PNG. Checked first that it had no `tRNS` chunk
and that its alpha was uniformly opaque, so the conversion loses nothing.

`icon-1024.png` and `DemoApp/…/Images/app-icon.png` were byte-identical (md5 `2d05a4c4…`) — recorded
in this file as "the shipped app icon and the bundled asset are one file". **That is no longer true**,
and `home_chrome_check.js` asserts the inequality, which is both the cheapest check available without
an image library in Node and the exact thing a revert would undo. The knight file itself stays, drawn
nowhere; `ios/AppIcon.svg` is now the source art for a retired icon rather than the shipped one.

## A payload case built without its payload (2026-08-19)

`Entitlement.Access` is `case premium(trial: Bool)`. The test-build grant was written
`access = .premium`, which does not compile — that expression is a function, not an `Access`.

**The reason it is easy to write and impossible to see** is that pattern matching legitimately drops
the payload: `case .premium:` inside a `switch`, and `if case .premium = x`, are both correct, and
they are what most of this file's existing code looks like. Construction is the only context where
the argument list is mandatory, and nothing in the repo's toolchain looked at construction.

`swift_lint.js` checks brackets and `public`-exposes-`internal`. `swift_symbol_check.js` resolves
`Namespace.member` references and project types. Enum construction fell between them, and there is no
Swift compiler on this checkout — so the failure mode is a Mac build hours later, which is precisely
how build 43 lost a cycle to three other invisible errors.

`tools/qa/swift_enum_payload_check.js` closes it. Two design choices matter:

- **Only unambiguous names.** A case name is checked only when *every* declaration of it in the tree
  carries a payload. `.failed` is declared with no payload on `LoginAuthPhase`, so it is skipped
  even though some other enum might carry one. A gate that cries wolf gets ignored, and an ignored
  gate is worse than none.
- **Only construction sites.** `= .name` and `return .name`, never `case`/`if case`/`guard case`.

26 payload-carrying names across 119 files at the time of writing, with no second instance of the
bug — so the fix was the only one needed, which is itself worth knowing.

## The compilation condition that could never have worked (2026-08-20)

Three consecutive rounds set `BIYA_TEST_BUILD` in `codemagic.yaml` to make the app testable, and all
three produced builds that behaved exactly as before. The code was correct, merged, and gated.

### The mechanism

**`SWIFT_ACTIVE_COMPILATION_CONDITIONS` set at the Xcode project or target level does not propagate
into a local SwiftPM package's targets.** Both `#if` sites — `PremiumStore.recompute` and
`LoginAppleAuth.start` — are in `DemoApp/Sources/BiyaherongUI/`, which `ios/project.yml` consumes as
a package dependency. Neither `Package.swift` declares any `swiftSettings`/`.define`, so those
`#if`s were false in every build ever made, including the sideloaded one.

A second bug sat on top and looked like the whole story: `ios-testflight` passed the setting as
`xcode-project build-ipa … -- SETTING=value`, which the Codemagic CLI does not accept (it exposes
`--archive-xcargs`; argparse rejects unknown trailing tokens). **Fixing that alone would have fixed
nothing** — the correctly-formed override in `ios-free-unsigned` had been equally inert all along.

### What made it invisible

The gate asserted the *string* was in the right workflow block. That was true for three commits while
the built app never had the behaviour. **A test that reads the build file is not a test that reads
the build.** `replay_login.js` now asserts the thing that is actually load-bearing: that **no file in
the `BiyaherongUI` package branches on `BIYA_APPSTORE` at all**, because such a branch is inert by
construction.

### DEVIATION: a runtime Bool, and the default is the test behaviour

The `#if` lives in `ios/App/BiyaherongApp.swift` — a real Xcode target — and its `init()` hands the
value to `BiyaherongBuild.configure(isTestBuild:)` before the view tree exists. The package reads a
plain `@MainActor` static.

The default is `true`, i.e. testable, and the asymmetry is deliberate:

- **Default testable** fails as a submission build that forgot to opt in. `ios-appstore` reads the
  *effective* build settings and refuses to build unless `BIYA_APPSTORE` really reached the
  compiler — a loud failure, in the rare workflow, before anything is signed or uploaded.
- **Default real** fails as a build nobody can open, with no error to explain it. That is the exact
  failure this entry exists about, and it happened three times.

`ios-appstore` sets the flag by rewriting `ios/project.yml` before `xcodegen generate` — the same
mechanism it already uses for `CURRENT_PROJECT_VERSION`, and the only one this repo has evidence for.

Also recorded: the login SCREEN is skipped entirely in a test build (`LoginStore.init` opens a
session), not merely made one-tap. Asked for directly — the client is testing features, and a login
screen was still a wall.

## Analysis Board + navigation chrome — client revision (2026-08-18, second round)

Three asks, one round after the previous entry. The first of them removes something that entry had
just added, which is worth stating plainly rather than quietly reversing.

### 1. The opening-book band is gone entirely

*"Pwede ba remove mo na ito, siguro hindi na ito kailangan."*

Band 6 was the ECO explorer, then — one round ago — a 44 pt strip of `san · eco` chips. Now it is
nothing. What went, and what deliberately did not:

| Removed | Kept, and why |
|---|---|
| `AnalysisBookStrip`, `paintBookStrip`, `.an-bookstrip` / `.an-bchip` | `AnalysisSession.bookContinuations` — pure, parity-tested (`analysis_session` asserts it), and Opening Trainer is a future consumer. Only the UI went |
| `AnalysisVM.bookRows`, `playBookMove`, JS `bookContinuations` view helper + `playSanMove` | `openingEntry` / `openingText` — a **separate** code path through `book.nameFor`, and the opening name still shows in the engine info row |
| `bookStripHeight`, `bookChipGap`, `bookSanWidth` (the last already dead) | `OpeningBook` itself, also needed for Game Review's `book` tier via `bookPlies` |
| the dead `.an-brow` / `.an-bname` / `.an-panel-head` / `.an-panel-empty` leftovers | `.an-hidden`, which sat physically inside the deleted CSS block and is used by the preview bar, the status line and `.an-panels` |

**The band model lost its `inBook` axis.** `bands()`, `fixedWithoutEngine` and `engineAvailable`
dropped the parameter in both languages. Nothing about the layout depends on the book any more, and
the engine panel keeps the 44 pt on every in-book position.

**Assertions inverted, not deleted** — the same rule the typography deviation follows:

- §10c said *"the strip costs height only when there IS a book"*. It now says **no band varies with
  the book**, and that autoplay is the only conditional band left.
- `rowsThatFit(x + bookStripHeight) > rowsThatFit(x)` would have become `x > x` — a silent
  tautology. Replaced by a comparison against the OLD budget: `rowsThatFit(seAvailable) >
  rowsThatFit(seAvailable − 44)`, which states what the deletion actually bought and cannot decay.
- `swift_layout_check` rule 4b flipped from "the strip must be conditional" to "there is no book
  band at all", and the `book_strip_drawn_unconditionally` mutant became `book_band_reintroduced`.
- `board_layout_check` now asserts the eight book class names are **absent** from the stylesheet and
  that `analysis.js` no longer mentions them — while separately asserting `.an-hidden` survived.

**§10d was wrong before this, and is fixed by it.** Its local budget omitted the status LINE and the
board band's own chrome while adding the book strip; the two errors nearly cancelled, so it reported
believable numbers that were never real, and claimed three wrapped rows fit an SE when two do. It
now drives the SHIPPED `fixedWithoutEngine` / `engineRowsThatFit` / `enginePlan`, and the honest
figures are 4 single-line / 2 wrapped at 375×667.

**Three CSS variables were re-homed rather than deleted.** `--an-row-spacing`, `--an-chip-pad-h` and
`--an-chip-pad-v` were read only by the book chips; removing the rules would have orphaned them and
tripped the `--an-*` audit. Their natural readers were `.an-erow`'s `gap` and `.an-depth`'s
`padding`, both of which had been carrying hardcoded copies. The depth chip's copy was `3px 5px`
against the metrics' 4/8 — the browser chip was two pixels tighter than the app's *and* than
`engineChromeHeight()`'s own budget. Deleting a feature is how you find that.

### 2. Engine lines carry a rank badge in their arrow's colour

*"Lagyan mo ng numbering para alam kung anong number."*

The board draws up to three engine arrows coloured by rank; nothing said which row owned which
arrow. Each row now opens with a one-digit badge tinted `AnalysisArrow.color(rank:)`.

- **`EngineRow.rankLabel` does the `+ 1` in Core.** A view body may not contain arithmetic
  (`AnalysisBoardScreen.swift:16-18`, and `swift_layout_check` greps for it), and both languages
  must print the same thing. One `+ 1`, in the one place the two can be diffed.
- **The badge takes `engineDepth` (11), not the row's 13.** Every other engine cell is asserted equal
  to `stripMove`, so a new size would need its own `deviates(…)`; `engineDepth` is the existing chip
  size and already a declared deviation. A badge as large as the moves would also out-shout them.
- **`engineRankWidth = 16`, one digit.** `engineMaxRows` is 5, so a second digit can never be needed
  — and that is asserted, so the constant cannot be widened without someone noticing.
- **Width was the cost, and it is now pinned.** The 44 pt reclaimed in §1 pays for the badge
  vertically; horizontally it is a new column on a row that was already tight at 13 pt, and the
  previous round was specifically about fitting MORE moves. New §10e:
  `engineContinuationWidth(375)` = 239 pt = 30 characters a line = 60 across two, against the ~50 a
  12-ply continuation needs at ~4.2 characters a ply. Also asserted: the badge is the narrowest
  column, and the moves still get more of the row than all three fixed columns together.

### 3. Back and ☰ are hand-drawn vectors — and the two languages finally agree

Full write-up in `docs/navigation-chrome.md`. The deviations and decisions that belong here:

- **The glyphs were never icons.** `←` (U+2190) and `☰` (U+2630) drawn at 22 pt in Nunito, which has
  neither, so both fell back to whatever face the platform picked. `CoachLayout.swift` had said so
  in its own comment for as long as it existed.
- **This was a convergence bug, not only a beauty one.** Swift drew `Image(systemName:
  "chevron.left")` on the shared puzzle header, Puzzle Hub, Streak and the Paywall while the browser
  drew `←` on the same screens. **No assertion anywhere named a glyph, an icon or a button class** —
  the whole category was unguarded. `tools/qa/nav_icons_check.js` now covers it.
- **`Shape`, not an SVG asset.** `SVGVector.swift` deliberately rejects `currentColor`, and these
  icons must take each screen's own tint. Hand-built paths also let both languages compute from one
  geometry, which an asset could not guarantee. `BoardArrows.swift` is the precedent.
- **The 44 pt minimum is WIDTH only.** Apple's guideline is 44×44, but the Analysis header is 36 pt
  and a 44 pt-tall button spilled 4 pt over the board's top rank — it would have stolen taps from
  a8–h8. Measured in the browser twin; every screen's own frame is already 36–44 tall.
- **Extracted frames are untouched.** `CoachSelect.backBtnWidth` (44), `PairingList.backBtnWidth`
  (40) and the rest sit next to `backBtnJustifyContent` — extracted StyleSheet values. The component
  replaces the glyph *inside* the button, never the button's box.
- **Two glyph tables retired with inverted assertions.** `CoachGlyph.back` — `CoachMetricsCheck` and
  `replay_coach` now assert **four** transport glyphs and that `back` is not among them.
  `PairingStrings.back` — that file is generated by `tools/metrics/gen_pairing_metrics.js`, so it
  was removed from `pairing-metrics.js`'s `STR` and regenerated.
- ⚠ **`el()`'s third argument is `textContent` in every browser screen file except `analysis.js`.**
  An SVG string passed there is inserted as literal text and draws nothing. The first pass did
  exactly that on eighteen sites and every gate stayed green; only opening the browser caught it.
  Every site now assigns `innerHTML` explicitly, and `nav_icons_check.js` asserts the shape.

**Four latent bugs fixed on the way through**, all pre-existing and all inside the diff:
`.pzd-back` hardcoded `40px/40px/24px` with no variables across five screens; `.pzp-back` read
`--pzh-back-*` that its own screen never published; `PuzzleHubScreen` sized its back button from
`PuzzleHub.chevronLineHeight`, the **list-row** chevron's line height, while the browser fed
`--pzh-back-fs` from `PuzzleType.hubBackIcon` (both 24, so nothing moved — it just stopped being a
coincidence); and `coach-select.js` read an `STR.backArrow` that is undefined everywhere.

**Deliberately out of scope**, at the user's choice: the nine Analysis toolbar emoji, the four
transport arrows, and the ☰ menu's own `✕`. (Home's `🔍` was on this list until round 4, when the
client asked for the button itself — which had never been wired to anything — to be removed.)
