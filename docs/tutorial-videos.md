# Tutorial Videos

**Home → Tutorial Videos.** A catalogue of coaching videos, grouped by phase of the game, streamed
from the content bucket. Premium only, and **the one screen in this app that does not work offline**.

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

Spec §0.1: *"Content = static files on R2/S3. **No API. No accounts. No sync.**"*

The RN app reads the same rows from `GET /api/tutorial-videos`, which sits inside
`Route::middleware('auth:sanctum')` and needs a Sanctum token. **This app has no account and no
token, by design.** It signs in with Apple on the device, never talks to the Laravel backend, and
there is no `/api/auth/apple` endpoint that could mint one. Wiring the screen to that endpoint would
produce a permanent 401 that looks exactly like a broken feature.

So the catalogue is a **published JSON file** on the content bucket:

```json
{ "videos": [
  { "id": 1, "title": "The Ruy Lopez", "description": "…", "category": "Opening",
    "thumbnail_url": "https://…/thumb.jpg", "video_url": "https://…/ruy.mp4",
    "created_at": "2026-08-01T09:00:00Z" }
] }
```

`VideoLibrary.parse` also accepts a bare `[…]`, because a hand-published file is very likely to be
the array on its own and refusing it would be pedantry with a blank screen attached.

## Turning it on — three steps, and none of them are done yet

```bash
LARAVEL_ROOT=/path/to/BYAHERONG-COACH-LARAVEL php tools/content/generate_video_manifest.php
# -> build/tutorial-videos.json
```

1. Run that. It executes **the same query** `TutorialVideoController@index` runs — same scope, same
   order, same columns — so the manifest and the API can never describe different catalogues. It
   reports the per-category counts and names anything it skipped.
2. Upload `build/tutorial-videos.json` to the content bucket, publicly readable.
3. Put its URL in **two** places: `ContentClient.manifestURL` (Swift) and `MANIFEST_URL` in
   `web-demo/js/content-client.js`. `replay_videos.js` asserts the two match.

**Neither prerequisite exists today**, and the code says so rather than pretending:

- `AWS_BUCKET` is **empty** in the Laravel `.env` and `.env.example`, and `CLOUDFLARE_R2_PUBLIC_URL`
  is unset — there is no bucket to publish to.
- `tutorial_videos` has **0 rows**. Nobody has uploaded a video in the admin panel.

Until then the screen says *"Videos are not published yet."* — which is true, and is not a network
error.

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

In the browser: open `web-demo/index.html`, **Home → Tutorial Videos**. With no manifest published
you should see *"Videos are not published yet"* — that is the correct state today, not a failure.
Sign out to a free account and the same tile shows the paywall instead.

On a Mac: `cd DemoApp && swift build`, then run the demo and open the tile.
