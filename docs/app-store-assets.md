# App Store listing assets

**What it does.** Covers the part of the submission that is neither code nor product configuration:
the screenshots, app previews and in-app-purchase promotional images on the product page.
[`app-store-handoff.md`](app-store-handoff.md) stops at the subscriptions; this picks up there.

**Why it exists.** Build **1.0.8 (52)** was rejected on **2026-09-06** on nothing but these assets —
see [`app-review-response.md`](app-review-response.md) for the reply. Nobody had written down what
the rules were, so nobody could have followed them.

## The three kinds, and which are actually required

| Asset | Required? | Device frames? | Where in App Store Connect |
|---|---|---|---|
| **Screenshots** | **Yes** — at least one per size class | **Allowed** | Previews and Screenshots |
| **App previews** (video) | No | **Forbidden** | same section → *View All Sizes in Media Manager* |
| **IAP promotional image** | No | Forbidden, and never a screenshot | Subscriptions → the product → *App Store Promotion* |

**Both of the rejected assets were optional.** That is the fastest remedy for either citation and
Apple offers it in the rejection text itself — *"If you have no future plans on promoting this
In-App Purchase product, you can delete the associated promotional image."* A product page with ten
screenshots and no preview is a complete, submittable page.

The asymmetry in the middle column is the trap. A device frame is *fine* in a screenshot and
*fatal* in a preview, so the mockup template that produced a good screenshot produces a rejection
when the same treatment is applied to video.

## Sizes and formats

This app is **iPhone-only and portrait-only** — `ios/project.yml` sets `TARGETED_DEVICE_FAMILY: "1"`
and `INFOPLIST_KEY_UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait`. It installs on
iPad in compatibility mode, which is what the 1.0.8 reviewer used, but **no iPad assets are
required** and none should be uploaded.

| | Accepted |
|---|---|
| Preview, iPhone 6.5"/6.7"/6.9" portrait | **886 × 1920** or **1080 × 1920** |
| Preview length | **15–30 s** |
| Preview codec | H.264 (`yuv420p`) or ProRes 422 HQ, with an audio track present — silent is fine |
| Promotional image | **1024 × 1024**, no alpha channel |

*Media Manager states the requirement for whatever slot you are filling.* Trust it over this table
if the two ever disagree; Apple changes these.

## What a preview may not contain

Guideline 2.3.4. The preview must be a screen capture of the app running on the platform it is
submitted for. Text and voice overlays are allowed; the following are not:

- **device images or device frames** — no phone or tablet mockup, no bezel, no hand holding a device
- letterboxing or pillarboxing of any kind (a frame always leaves some)
- footage from another platform — an Android recording of the React Native app is not this app
- anything that is not the app: logo cards, marketing footage, a desk, a keyboard
- Control Center or Notification Center pulled down mid-take

The last two are not pedantic. The rejected file contained **both** a tablet mockup and, at ~19 s, a
pulled-down Android notification shade showing the recordist's personal Messenger and Gmail
notifications — which would have been on the public product page.

## The recording brief

*Written to be forwarded whole to whoever has the Mac.*

**Capture**

- **iOS only.** Real iPhone: connect it by cable, then QuickTime Player → *File → New Movie
  Recording* → choose the iPhone as the camera source. Or the Simulator:
  `xcrun simctl io booted recordVideo --codec h264 raw.mov`.
- **Do Not Disturb on.** Never open Control Center or Notification Center during a take.
- Portrait, full screen. **No mockup, no bezel, no hands, no black bars, no logo card.**
- Record longer than you need — 40 s of good footage beats 20 s you cannot trim.
- Turn HDR capture off. An HLG or PQ recording encoded as SDR looks washed out; the tool refuses
  one rather than ship it.

**What to show** — the free, strong parts, in this order:

1. Home → **Analysis**. Free for everyone since 1.0.8, no account, no network: engine lines, the
   move tree, the opening book.
2. A coach game — pick a persona, play two or three moves, let the coach answer.
3. A puzzle solved, and the daily-goal or streak tick.

**Do not film the paywall.** The promotional image that drew the 2.3.2 citation was a screenshot of
it, caught in its store-failure state.

**Poster frame:** pick one showing the board. Never a splash or loading screen.

## The tool

[`tools/ship/make_app_preview.sh`](../tools/ship/make_app_preview.sh) — ffmpeg + ffprobe, so unlike
`ship_testflight.sh` it runs on the Windows checkout too.

```bash
tools/ship/make_app_preview.sh export raw.mov preview_65.mov      # convert to App Store spec
tools/ship/make_app_preview.sh export raw.mov out.mov --start 12  # take the segment from 0:12
tools/ship/make_app_preview.sh check preview_65.mov               # validate before uploading
```

`export` picks 886×1920 or 1080×1920 from the **source aspect** rather than forcing one, so nothing
is stretched; caps the clip at 30 s; adds a silent stereo track when the source has none (Simulator
recordings do not); and then runs `check` against its own output, because an exit code is not
evidence. It refuses a landscape source, a source whose aspect is neither accepted shape, under 15 s
of footage, and an HDR source.

`check` is the half that matters. Alongside the dimensions, duration, codec and audio track it looks
for **black borders**, which is the measurable fingerprint of a device frame.

### Why the border check is not `cropdetect`

The obvious implementation does not work here, and both of the obvious thresholds are wrong:

- **`cropdetect` misses it.** It only trims a row when *every* pixel in that row falls under the
  limit, so a handful of compression-noise pixels defeat it. On the actual rejected file it reports
  a full 244×530 frame at `limit=8` and at `limit=16`, and finds the real 238×330 content box only
  at `limit=24` — one unit away from the app's own background colour.
- **An absolute luma threshold misses it too.** This app is *very* dark. `#0F1A2E`, its most common
  background, measures luma **8–10** through this pipeline; the bars on the rejected file measure
  **0–5**. A first attempt at a threshold of 12 flagged a full-bleed navy screen as letterboxed.

So the check averages a strip along each edge — averaging is stable where an all-pixels rule is not
— and calls an edge a border only when it is **both** near-black in absolute terms (≤ 24) **and at
least 4× darker than the whole frame**. The ratio is what does the work: a frame that is entirely
dark has a low average too, so a legitimately dark screen sits near 1× and passes, while the
rejected file averages 64 against a top edge of 5.

## Key files

- [`tools/ship/make_app_preview.sh`](../tools/ship/make_app_preview.sh) — the converter and the check.
- [`app-store-handoff.md`](app-store-handoff.md) — everything upstream of the assets. **Start there.**
- [`app-review-response.md`](app-review-response.md) — both rejections and the replies to paste.
- `ios/project.yml` — `TARGETED_DEVICE_FAMILY` and the orientation key that make this iPhone-only
  and portrait-only, and therefore fix which slots need filling.

## How to test

The guard has to be shown to catch the thing it was built for, and to leave a good file alone.
Apple returns the rejected asset with the message, so the negative case is a real artifact:

```bash
# 1. Must FAIL, on "black border on: top bottom right" - this is the file Apple rejected.
tools/ship/make_app_preview.sh check "<the .mov attached to the 2.3.4 rejection>"

# 2. Must PASS - a full-bleed clip in the app's DARKEST background is the false-positive case.
ffmpeg -y -f lavfi -i "color=c=0x0F1A2E:s=886x1920:r=30" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" -t 20 \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -c:a aac -ar 44100 -ac 2 pos.mov
tools/ship/make_app_preview.sh check pos.mov

# 3. Must FAIL - the same navy, letterboxed. Proves it is the border, not the darkness.
ffmpeg -y -f lavfi -i "color=c=0x0F1A2E:s=700x1400:r=30" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" -t 20 \
  -vf "pad=886:1920:(ow-iw)/2:(oh-ih)/2:black" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -c:a aac -ar 44100 -ac 2 neg.mov
tools/ship/make_app_preview.sh check neg.mov

# 4. Round trip: a 40s portrait source with no audio must come out 886x1920, 30s, with an
#    aac track, and pass its own check.
tools/ship/make_app_preview.sh export raw.mov preview_65.mov
```

`web-demo/` mirrors nothing here — these are store assets, not app behaviour.
