# Tutorial Videos

**Home → Tutorial Videos.** A catalogue of coaching videos, grouped by phase of the game, listed
from a public Laravel route and streamed from the content bucket. Premium only, and **the one screen
in this app that does not work offline**.

It is the last Home tile to get a destination — `onVideos` was the only callback left unwired.

---

## The two things a user is told

The client asked for both by name.

**It costs money.** A user without a subscription gets the RN's own paywall — 🔒, *"Premium
Feature"*, *"Mag-subscribe muna para ma-access ang tutorial videos."* — and a **Subscribe Now**
button that opens the real paywall.

**It needs a connection.** The list carries a standing note, *"Kailangan ng internet — nagsi-stream
ang mga video na ito"*, even when everything loaded: every other screen in this app works in
Airplane Mode, so one that quietly does not is a surprise worth pre-empting. Open it with no
connection and the screen says **Online Feature** and offers **Try Again**.

## The order the refusals are tested in, which is the product decision

```
not premium     ->  paywall
not configured  ->  "Videos are not published yet"
offline         ->  "Online Feature"
loading / failed / empty / list
```

**Premium is tested first, deliberately.** A user who is offline *and* has no subscription sees the
paywall. The entitlement is decided on-device by StoreKit and is knowable with the radio off, so it
is the answer we are certain of — and sending somebody to find wifi for a screen they could not open
with wifi would be a wasted trip.

**"Not published" is not a connection error**, and that separation is load-bearing. When the app has
nowhere to look, telling the user to check their wifi sends them to fix the one thing that is
working. `replay_videos.js` asserts that the unpublished copy contains no mention of internet or
wifi, so a future rewording cannot blur the two.

## Where the list comes from, and why not the API

The RN app reads the same rows from `GET /api/tutorial-videos`, which sits inside
`Route::middleware('auth:sanctum')` and needs a Sanctum token. **This app has no account and no
token, by design.** It signs in with Apple on the device, never talks to the Laravel backend, and
there is no `/api/auth/apple` endpoint that could mint one. Wiring the screen to that endpoint would
produce a permanent 401 that looks exactly like a broken feature.

So Laravel serves the same catalogue through a second door, one that takes a **receipt** instead
of a token:

```
POST https://biyaherongchesscoach.com/api/content/tutorial-videos
{ "jws": "<StoreKit signed transaction>" }
```

One controller, one shared query, two doors — `TutorialVideoController::catalogue()` feeds both, so
they cannot describe different shelves. Spec §0.1 said *"Content = static files on R2/S3. **No API.
No accounts. No sync.**"* and this is a deviation from it, taken with the client and written up in
`PORTING_NOTES.md`: the spec's objection was to accounts and sync, and this route has neither.

### The receipt is the identity

The app has no account, so there is nothing to authorise — except that StoreKit already hands it
something Apple signed. `PremiumStore.currentReceipt()` returns the newest
`Transaction.jwsRepresentation` for one of our products; `ContentClient` posts it; and
`App\Services\AppleTransactionVerifier` on the backend checks the signature against **Apple's root
CA, pinned by SHA-256 fingerprint**, then checks the payload is for this bundle, one of our two
products, unrevoked and unexpired. No account, no token, no session, and no call to Apple.

It is a POST for a read, deliberately: the receipt is a few kilobytes of certificate chain, which is
a body's job. nginx's default header buffers are not generous enough to make a header a safe habit.

**A 401 is not a broken catalogue.** It means the server read a receipt and said no — lapsed,
refunded, or never bought — while the device believed otherwise, which is possible because StoreKit
is a cache. `ContentClient.Failure.notSubscribed` keeps that separate from `offline` and
`unreadable`, and both screens send it to the **paywall**: the server holds the content, so when the
two disagree the server wins, and "check your connection" would be the wrong instruction twice over.

### What this does and does not protect

**It closes catalogue enumeration.** One `curl` used to return every video URL. Now it returns 401.

**It does not yet protect the files.** The bucket is still public, because the Android app reads the
same `video_url` columns and making the bucket private would break it. A link that leaks still
plays, forever. Closing that is a small follow-up once the Android side is in scope: make the bucket
private and return `Storage::disk('s3')->temporaryUrl(...)` built from the `video_path` column that
is already there. The verification half — the hard half — is done.

Either way the bytes are the same:

```json
{ "videos": [
  { "id": 1, "title": "The Ruy Lopez", "description": "…", "category": "Opening",
    "thumbnail_url": "https://…/thumb.jpg", "video_url": "https://…/ruy.mp4",
    "created_at": "2026-08-01T09:00:00Z" }
] }
```

`VideoLibrary.parse` also accepts a bare `[…]`, because a hand-published file is very likely to be
the array on its own and refusing it would be pedantry with a blank screen attached.

## Turning it on

**Two steps, and there is no publish step among them.**

1. Upload videos at `/admin/dashboard` and **toggle each one visible**. The column defaults to
   `false` (`DashboardController::store` — `boolean('is_visible', false)`) and the manifest query
   filters on it, so an uploaded-but-not-toggled video is missing from the app with nothing anywhere
   saying why. This is the single most likely cause of an empty catalogue.
2. Deploy the Laravel side. `/api/content/tutorial-videos` is a route, so it exists only once the
   backend carrying it is live. Before that the app gets a 404 and says *"Could not load videos"* —
   honest, and deliberately not the *"not published yet"* state.

That is all. Upload a video, toggle it visible, and it is in the app.

### Serving it from a bucket instead

If you would rather keep the app server out of the path:

```bash
LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL php tools/content/generate_video_manifest.php
# -> build/tutorial-videos.json
```

Run it **on a machine whose `.env` points at the production database** — it reads the DB through
Laravel, so a local checkout with an empty `tutorial_videos` writes an empty manifest. Upload the
file publicly, then put its URL in **two** places: `ContentClient.manifestURL` (Swift) and
`MANIFEST_URL` in `web-demo/js/content-client.js`. `replay_videos.js` asserts the two match and that
whichever URL is there is `https://`.

The cost is that this one goes stale silently: re-run and re-upload after **every** change in the
admin panel, or the app shows a catalogue that stopped matching the shelf and looks fine doing it.

## Seeing it work on Windows

The demo fetches the real catalogue, so with the backend deployed you see your actual videos. Two
things still leave you looking at a notice: a checkout whose Laravel side is not deployed yet (404),
and a machine with no connection. A notice looks the same whether the screen works or not.

So the not-published **and** could-not-load notices both carry a **Load sample catalogue** button,
in the browser demo only. It loads
`web-demo/js/video-sample.js` **through the real parser**, so what appears is the actual screen
rather than a mock of it — sections in category order, chips, thumbnails, and a card that really
plays when you click it. One of the four rows is deliberately categorised `"Tactics"`, which is not
one of the five, so the deviation below is something you can see rather than only read about.

The app has no such button. `ContentClient.manifestURL` names the real route in both languages and
`replay_videos.js` asserts they match; nothing in the sample is reachable from Swift.

The media are Blender Foundation open movies (CC BY 3.0) — the standard public test streams, used as
placeholder content, credited in the fixture itself.

## Deviations from the RN, both deliberate

**An unknown category is visible.** The RN groups by category and then renders
`CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0)`, so a video whose category is not one of
the five — `"Tactics"`, a typo, a category added in the admin panel later — is **silently dropped**.
The admin sees it saved and visible; the app shows a catalogue missing it, with nothing anywhere
saying why. Both ports fold the unknown into **Uncategorized**, so a mis-categorised video is in the
wrong section rather than in none.

**The player is `AVPlayerViewController`.** The RN builds its own transport — 21 style keys of
scrubber, timestamps, a hide timer and a seek strip — because `expo-av` gave it no controls worth
using. The system player already has all of that, plus AirPlay, Picture in Picture, the lock screen,
background audio and every accessibility affordance the OS knows. Rebuilding it would be a week of
work to arrive somewhere worse.

## The transport, and the rule it lives under

`ContentClient.swift` is the **second of exactly two** files in the app allowed to open a
connection; `OpeningDownloader.swift` is the first. Spec §0.1 names both, and
`tools/qa/replay_opening_tree.js` §12 holds each language to an exact pair of names — not a ceiling
of two, because a ceiling would let a third arrive by having one of these deleted.

That sweep had a hole this feature found: it looked for a literal `fetch(`, and the first draft of
`content-client.js` called the function through a local alias, so a file that genuinely opened a
connection was invisible to the rule whose whole job is to count them. It now matches the
identifier, with strings stripped — the looser pattern immediately named `opening-metrics.js`, whose
crime was the label `'Games to fetch'`.

## Key files

| File | What it holds |
|---|---|
| `Sources/BiyaherongCoachCore/VideoLibrary.swift` | the model, the manifest parser, the grouping — Foundation only |
| `DemoApp/…/ContentClient.swift` | the transport, and the `manifestURL` that has to be filled in |
| `DemoApp/…/VideoScreens.swift` | the catalogue, the four refusals, and the player |
| `DemoApp/…/VideoStrings.swift` | every word, hand-written and pinned |
| `DemoApp/…/VideoMetrics.swift` | **generated** — every number, colour and category glyph |
| `tools/metrics/extract_video_styles.js` | RN source → `video_styles.json` (committed) |
| `tools/metrics/gen_video_metrics.js` | that JSON → both languages |
| `tools/content/generate_video_manifest.php` | the Laravel DB → the manifest to upload |
| `web-demo/js/{video-library,video-strings,content-client,videos}.js` | the browser twins |
| `tools/qa/replay_videos.js` | the parity gate, including the refusal ORDER |

## How to test

```bash
# The parser and the transport, in Node
node -e "console.log(require('./web-demo/js/video-library.js').selfTest().summary)"
node -e "console.log(require('./web-demo/js/content-client.js').selfTest().summary)"

# Does the Swift decide what the JS decides
node tools/qa/replay_videos.js

# Is ContentClient still one of exactly two transports
node tools/qa/replay_opening_tree.js

# Re-derive the layout from the RN source, then re-emit both languages
FRONTEND_ROOT=/path/to/BYAHERONG-COACH-FRONTEND node tools/metrics/extract_video_styles.js
node tools/metrics/gen_video_metrics.js

# Everything
node tools/qa/js_goldens.js
node tools/qa/swift_lint.js && node tools/qa/swift_symbol_check.js
```

In the browser: open `web-demo/index.html`, **Home → Tutorial Videos**. A browser has no StoreKit
and therefore no receipt, so the real catalogue is **not reachable from the demo at all** — that is
the feature working, not a bug. You get *"Could not load videos"* and a **Load sample catalogue**
button; press it to see the screen itself, sections, thumbnails and a card that really plays.
Switch to a free account and the same tile shows the paywall instead.

(`videos.js` is faithful and routes a refused receipt to the paywall like the app does. The demo
shell translates it to could-not-load first, because in a browser "no receipt" is true of every
visitor and says nothing about the screen. The translation is in `app.js`, where the sample button
already lives.)

On a Mac: `cd DemoApp && swift build`, then run the demo and open the tile.
