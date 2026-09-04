# The 2.1(a) rejection of 1.0.7 (51), and the reply to it

**Submission ID `aaf81c76-d222-412c-a78c-d70a1e1d0457`, reviewed 2026-09-02.** Guideline 2.1(a) —
Performance — App Completeness. *"The app displays error upon login."* iPhone 17 Pro Max and iPad
Air 11-inch (M3), iOS/iPadOS 26.6, internet connection active.

The screenshot shows a system alert — **"Could Not Connect" / "Make sure you are connected to Wi-Fi
or your mobile network."** — over Apple's own Sign in with Apple sheet.

## What it was

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

## What changed in 1.0.8

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

## The reply to paste into App Store Connect

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

## App Review Notes for the submission form

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

## How to test

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
