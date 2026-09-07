# App Review rejections, and the replies to them

**Newest first.** Two so far, with nothing in common: the first was about the binary, the second
about nothing but the product page.

---

## 1.0.8 (52) — Guidelines 2.3.2 and 2.3.4, metadata only

**Submission ID `a037695f-351d-4397-8412-83cf612b0bbe`, reviewed 2026-09-06** on an iPad Air 11-inch
(M3). Two citations, **neither of them the binary** — build 52 was resubmitted unchanged. The rules
nobody had written down are now in [`app-store-assets.md`](app-store-assets.md).

### 2.3.2 — the in-app-purchase promotional image

Apple: *"You submitted duplicate or identical promotional images for different promoted In-App
Purchase products"* and *"Your promotional image is a screenshot taken from the app."* Both were
true. One file was uploaded against `…plus.monthly` and `…plus.yearly` alike, and it was a square
crop of the **Go Premium** screen — caught, as it happens, in its store-failure state
(*"Couldn't load subscriptions from App Store"*).

A promotional image is only used when the subscription is *promoted* on the App Store, which this
app does not do, so both were deleted. Apple's own message offers that as a resolution.

### 2.3.4 — the app preview

Apple: *"Includes device images and/or device frames."* The preview was a screen recording
composited inside a **white tablet mockup**, letterboxed onto the 886×1920 canvas, with the app
covering about a third of the frame.

Three things Apple did *not* cite were wrong in the same file:

| | |
|---|---|
| **It was not this app** | The status bar reads `17:37 Fri 17 Apr` — time *and* date on the left, which iOS never shows — and the "Continue Previous Game?" alert is a Material dialog with borderless ALL-CAPS `NEW GAME` / `CONTINUE`. That is the React Native Android build. |
| **A notification shade is open at ~19 s** | Two Messenger notifications, a Gmail "1 new message" and an Android "Notification settings" button, all headed for the public product page. |
| **It predates the app** | That status bar dates the capture to 17 April 2026. Stockfish was not embedded in this repo until 2026-08-25. |

It was also the wrong shape for the product: `ios/project.yml` makes this app iPhone-only and
portrait-only, so a tablet mockup was never going to be right.

All three previews were deleted — a preview is optional, a screenshot is not. Replacements go
through [`app-store-assets.md`](app-store-assets.md) and the border check in
`tools/ship/make_app_preview.sh`, which fails on the rejected file and passes a full-bleed capture.

### The reply to paste into App Store Connect

> Thank you. Both issues were in our product page assets rather than the app, so build 52 is
> resubmitted unchanged.
>
> **2.3.2** — We have deleted the promotional images from both subscriptions. We do not promote our
> in-app purchases on the App Store, so the images served no purpose, and your message notes that
> removing them resolves this. Your findings were both correct: the same file had been uploaded for
> the monthly and the yearly product, and it was a screenshot of the app rather than a designed
> image.
>
> **2.3.4** — We have removed the app previews. They were built by compositing a screen recording
> inside a tablet mockup, which is exactly the device frame you identified, and the footage was not
> from this build either. Rather than upload a corrected version under time pressure, we have
> removed them and will submit proper full-screen captures in a later update. The screenshots on
> the page are unchanged.
>
> Nothing in the binary changed for this resubmission.

### App Review Notes for the submission form

Unchanged from 1.0.7 (51) — reuse the block further down this page. No app behaviour changed
between the two builds.

---

## 1.0.7 (51) — Guideline 2.1(a), "the app displays error upon login"

**Submission ID `aaf81c76-d222-412c-a78c-d70a1e1d0457`, reviewed 2026-09-02.** Guideline 2.1(a) —
Performance — App Completeness. *"The app displays error upon login."* iPhone 17 Pro Max and iPad
Air 11-inch (M3), iOS/iPadOS 26.6, internet connection active.

The screenshot shows a system alert — **"Could Not Connect" / "Make sure you are connected to Wi-Fi
or your mobile network."** — over Apple's own Sign in with Apple sheet.

### What it was

**That alert is not ours.** Neither string exists anywhere in this repository — not in Swift, not in
JavaScript, and there are no `.strings`, `.xcstrings` or `.lproj` files at all. Three independent
things say so:

- Every string on the login path is Taglish. Ours for a failed sign-in is
  `LoginStrings.authFailed` — *"Hindi natuloy ang sign in. Subukan ulit."*
- The whole app has **two** `.alert(` call sites and no `UIAlertController`, and one of them is the
  delete-account confirmation.
- `tools/qa/replay_login.js` §10 fails the build if any login file so much as contains the token
  `URLSession`. The login screen cannot open a connection, so it cannot report one failing.

It is AuthenticationServices/AuthKit reporting a failure from Apple's own identity service, which
runs in another process. It is also [widely
reported](https://developer.apple.com/forums/thread/808187) and
[unreproducible](https://developer.apple.com/forums/thread/804240) by developers on iOS/iPadOS 26
review devices, including on the same iPad Air the reviewer used.

**So we did not try to fix Apple's side. We removed our dependence on it** — and on two other
things the app could not control either.

### What changed in 1.0.8

| | Before | Now |
|---|---|---|
| Sign in with Apple fails | the app is over — no other way in | **"Continue without an account"**, on the screen and in the failure alert |
| The subscription cannot be bought | "Store Unavailable", every screen walled | the free tier opens; nothing is a dead end |
| Analysis Board | behind the paywall | **free for everyone**, account or not |
| A failed sign-in | one button, leading back to the same wall | the code Apple reported, and a way in |

Requiring the login was a **Guideline 5.1.1(v)** problem in its own right, and that is the honest
framing of the fix rather than a workaround for the alert: *"If your app doesn't include significant
account-based features, let people use it without a login."* This app has no account server. There
is nothing to sign in **to** — `LoginStore.signIn(_:)` writes one string to `UserDefaults` — so the
sheet was gating a local flag.

Two smaller hardenings, in case any part of it was ours after all:

- **The presentation anchor.** `ASPresentationAnchor()` — the old fallback — is a `UIWindow` with no
  `windowScene`, and it was one `isKeyWindow` miss away from being used. It is now the last rung of
  a ladder that prefers a window from a `.foregroundActive` scene.
- **The error is no longer discarded.** `didCompleteWithError` tested for `.canceled` and threw the
  rest of the `NSError` away, which is precisely why this rejection could not be diagnosed. The
  alert now carries the domain and code.

### The reply to paste into App Store Connect

> Thank you for the detailed report — the screenshot was what let us identify this.
>
> The alert shown ("Could Not Connect / Make sure you are connected to Wi-Fi or your mobile
> network.") is not produced by our app. That text does not exist anywhere in our binary or source;
> all of our own sign-in messages are in Taglish, and our login screen makes no network requests at
> all — it is covered by an automated check that fails our build if any networking API appears in
> those files. The alert comes from the Sign in with Apple flow itself, which runs outside our
> process. We were unable to reproduce it on iOS 26.6 devices, on iPadOS 26.6, or through TestFlight.
>
> Rather than ask you to retest the same flow, we have removed the app's dependence on it entirely
> in this build:
>
> 1. **Signing in is now optional.** The first screen carries "Continue without an account" directly
>    beneath the Apple button, and the sign-in failure alert now offers the same action as its first
>    button. The app has no account server and creates no account anywhere but on the device, so
>    under Guideline 5.1.1(v) it should not have required a login in the first place. No demo
>    account is needed to review this build.
> 2. **The Analysis Board is now free for all users** — the full chess analysis screen with the
>    embedded engine, move tree, opening book, PGN import/export and position editor. It needs no
>    account and no subscription, and it works with no network connection.
> 3. **If the App Store cannot be reached, nothing is locked.** Previously an unavailable in-app
>    purchase left every screen inaccessible. The app now falls back to its free tier.
>
> The in-app purchases are submitted together with this build. The subscription is $1.99/month or
> $19.99/year with a 7-day free trial, and this build also states the trial length, the price it
> converts to, and the date of the first charge on every screen that offers it.
>
> We have also added diagnostic detail to that alert, so if anything similar occurs again the error
> code will be visible in the screenshot.

### App Review Notes for the submission form

> No demo account is required — signing in is optional. Tap "Continue without an account" on the
> first screen to use the app.
>
> Sign in with Apple is the only sign-in method offered, and it is optional. The app has no account
> server; nothing is stored off the device.
>
> The Analysis Board (Home > Analysis) is free for all users and requires no account, no
> subscription and no network connection. Everything else is behind an auto-renewing subscription
> with a 7-day free trial; a sandbox Apple Account is needed to exercise it. Both in-app purchases
> are submitted with this build.
>
> The app works in Airplane Mode apart from three features: Sign in with Apple, the Opening Tree's
> Lichess/Chess.com game download, and Tutorial Videos.

### How to test

```bash
node tools/qa/replay_login.js       # the guest door, both languages, the anchor ladder
node tools/qa/trial_gate_check.js   # the open set, and the store-failure term in `locked`
node tools/qa/replay_premium.js     # the trial copy, on every upsell surface
node tools/qa/js_goldens.js
```

In `web-demo/index.html`: **Continue without an account** must reach Home; with the Subscription
picker on **Free**, the Analysis tile must open the board while every other tile lands on the
paywall; and `?storefail` must open the free tier rather than a wall.

Before submitting, the checklist in [`app-store-handoff.md`](app-store-handoff.md) still applies in
full — most of all that both in-app purchases are submitted **with** the build.
