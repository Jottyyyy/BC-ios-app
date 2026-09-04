# Account — Sign in with Apple, and deleting it

The login gate and the Account card in Profile. One feature, because Apple treats them as one: an
app that offers account creation must offer account deletion, so the two ship together or neither
does.

## What it does

**Sign in with Apple is real, and it is OPTIONAL.** It used to be simulated — `LoginStore.signIn(_:)`
wrote a string and published, with no `AuthenticationServices` call anywhere. The repo knew:
`PORTING_NOTES.md` recorded it as *"an App Store rejection… a development state, not a shippable
one."* It now raises Apple's own sheet through `ASAuthorizationController`, and only a genuine
success opens an Apple session.

### The second door, and why it had to exist

Build **1.0.7 (51)** was rejected under **Guideline 2.1(a)** — *"The app displays error upon login"* —
with a screenshot of **"Could Not Connect / Make sure you are connected to Wi-Fi or your mobile
network."** over Apple's own sheet. That string is nowhere in this repo (ours are Taglish, the app has
two `.alert(` sites, and `replay_login.js` bans `URLSession` in every login file), so it is AuthKit
reporting a failure from Apple's identity service — a widely reported, unreproducible one on iOS 26
review devices. Full account, and the reply to Apple: [`app-review-response.md`](app-review-response.md).

Apple's side is not ours to fix. The dependence on it was:

- `LoginSession.guestProvider` (`"guest"`) is a **real persisted session**, in `providers` beside
  `"apple"`, so nothing downstream learns a third state — the shell finds itself signed in, Profile
  shows **No account**, Sign out still works, and one tap comes back to the gate.
- `LoginGuestButton` sits **on the screen**, under Apple's: an outline rather than a fill, 44pt
  rather than 54, so it is quieter but never hidden.
- **The failure alert's first button is that same door.** Build 51's alert had one button and it led
  back to the same wall.

It is also what Guideline 5.1.1(v) asks for on its own terms — *"if your app doesn't include
significant account-based features, let people use it without a login"* — and this app has no
account server at all.

**Two hardenings shipped with it.** `LoginAppleAuth.presentationAnchor` now prefers a window from a
`.foregroundActive` scene; the old fallback, `ASPresentationAnchor()`, is a `UIWindow` with **no
`windowScene`** and was one `isKeyWindow` miss from being used — on an iPad, which is what App Review
tested. And `didCompleteWithError` no longer discards the `NSError`: it read `.canceled` and threw
the rest away, which is exactly why the rejection could not be diagnosed. `LoginAuth.failureMessage`
appends the domain and code, so the next screenshot carries the answer. A **cancel** still carries
none — backing out of Apple's sheet is not a fault.

**It asks for no scopes.** `requestedScopes = []`, deliberately. The app shows
`LoginStrings.defaultDisplayName` and persists nothing but the provider string, so a name or an email
would be data it has no use for — and would make the empty `NSPrivacyCollectedDataTypes` in
`ios/App/PrivacyInfo.xcprivacy` untrue.

**Delete account** sits on the same card as Sign out, behind a confirmation. There is no server, so
it erases what the account produced on this device — and deliberately keeps two things.

| | Keys |
|---|---|
| **Erased** | `biya.auth.session.v1`, `biya.coach.takeback.v1`, `biya.analysis.engine.v1`, every `biya.coach.draft.v1.*` |
| **Erased (files)** | `puzzle-progress.json`, `pairing.json`, `openings.json`, `analysis-library.json` in `Application Support/Biyaherong/` |
| **KEPT** | `biya.store.subscription.v1`, `biya.store.usage.v1` |

The keep list is the half that is easy to lose in a refactor, and both halves matter:

- **The entitlement snapshot** is StoreKit's device state, not user data. Apple requires that
  deleting an account does not forfeit a paid subscription — `KeychainStorage` already outlives a
  delete-and-reinstall on purpose — and the confirmation copy says so, naming Settings ▸ Apple
  Account ▸ Subscriptions. Apple checks for exactly that.
- **The daily counters** stay because clearing them would make "delete account, sign in again" a free
  reset of every free-tier cap — a paywall bypass wearing a privacy feature's clothes.

`store.reset()` runs **before** the erase: the hub's progress is live in memory, and a store that
persisted itself after its file had been removed would write the deleted progress straight back.

## Test builds: no login screen, no paywall

**Every build is a REAL build unless the app target opts out.** `BiyaherongBuild.isTestBuild`
defaults to `false`; `BIYA_TESTBUILD` turns it on, and in that mode:

- `LoginStore.init` opens a session at launch, so **the login screen never appears** — the app boots
  straight to Home;
- `LoginAppleAuth.start` opens the session directly rather than calling Apple, so a signed-out
  tester gets back in with one tap;
- `PremiumStore.recompute` grants `.premium(trial: false)`, so **the paywall never appears** and
  every daily cap lifts (`DailyLimits.isAtDailyLimit` returns `false` on its first line for premium).

All three are needed together. There is no Sign in with Apple capability on the App ID yet and no
subscription product in App Store Connect, so any one of them alone still leaves a wall.

`BIYA_TESTBUILD` is set in exactly two places: `configs: Debug` in `ios/project.yml`, so Xcode Run
stays openable, and the two CI **test** workflows. Every archive — Release — is the real thing.

### Why the switch is NOT a `#if` in this package

It was, twice, and **it never once took effect**. `SWIFT_ACTIVE_COMPILATION_CONDITIONS` set on the
Xcode project — in `ios/project.yml`, on the `xcodebuild` command line, anywhere at target level —
**does not reach a local SwiftPM package's targets.** Every file under
`DemoApp/Sources/BiyaherongUI/` belongs to the `BiyaherongUI` package, so a `#if` there compiles
identically in every build no matter what CI passes.

That is the whole explanation for three rounds of "the flag is set in `codemagic.yaml`" producing
three builds that behaved exactly the same, with no error anywhere. A second bug hid it: the
TestFlight workflow passed the setting as `xcode-project build-ipa … -- SETTING=value`, which is not
a Codemagic CLI feature either. Fixing only that would have changed nothing.

So the `#if` lives in **`ios/App/BiyaherongApp.swift`** — a real Xcode target, where the setting does
apply — and its `init()` hands a Bool to the package before any view exists.
`tools/qa/replay_login.js` asserts that **no file in the package branches on either condition**, so
the inert form cannot come back.

### Why the default is "real"

It was "testable", for a good reason that still holds: a build nobody can open, with no error to
explain it, had happened three times and cost three days. What changed is what "a build told
nothing" came to mean.

`tools/ship/ship_testflight.sh` — the documented one-command ship — sets **no build settings at
all**. Under the old sense that made the repo's flagship ship path produce a build with a granted
subscription and a sign-in performing no Apple authentication, silently, every time. Forgetting a
flag should cost a tester an inconvenience; it should never cost the product its revenue.

So the default flipped and the old convenience was kept where it was actually wanted — the Debug
configuration. And every path now **asserts instead of assuming**, reading the effective build
settings back rather than trusting its own `sed`:

| Workflow | `BIYA_TESTBUILD` | Login | Subscription | Refuses when |
|---|---|---|---|---|
| `ios-free-unsigned` | **sed in** before `xcodegen` | skipped | granted | it is absent |
| `ios-testflight` | **sed in** before `xcodegen` | skipped | granted | it is absent |
| **`ios-appstore`** | **nothing** — the default | real Apple sheet | real StoreKit | it is present |
| **`ship_testflight.sh`** | **nothing** — the default | real Apple sheet | real StoreKit | it is present |
| Xcode Run (Debug) | `configs: Debug` | skipped | granted | — |

## The thing that changed about "100% offline" — twice

**First:** Apple's servers answer the sign-in, so **the first launch needs a connection**. The
in-app privacy sheet was reworded from "works 100% offline" to say so, in both languages.

**Then (2026-08-24):** the Opening Tree's Lichess/Chess.com download shipped, and the app makes a
network call of its own for the first time. The sheet's replacement wording — the app *"does not
collect, store, or send any personal information anywhere"* — became false in the most literal way
available: the download **sends the username the user typed** to a third party. It is narrowed
again rather than dropped. No account server, no analytics, no tracking; two named exceptions.

The claim is now **~90% offline**, which is the client's own number. `replay_login.js` and
`replay_premium.js` still fail the build on a `URLSession` in the login or premium features, and
`replay_opening_tree.js` §12 fails it if any file besides `OpeningDownloader.swift` opens one.

The export-compliance `NO` in `ios/project.yml` is unaffected by either change: both are
OS-provided TLS with no cryptography of the app's own, so the standard-encryption exemption applies.
**What is NOT settled is the App Store Connect privacy answers** — they were filled in for an app
that sent nothing, and nothing in this repo can check them. See `PORTING_NOTES.md`.

## Key files

| File | What it holds |
|---|---|
| `DemoApp/…/LoginAppleAuth.swift` | the real `ASAuthorizationController` call — **the only file in the package that imports `AuthenticationServices`** — plus the anchor ladder and the captured error code |
| `DemoApp/…/AccountDeletion.swift` | the eraser. Deliberately does **not** import StoreKit |
| `DemoApp/…/LoginMetrics.swift` | the pure layer: `LoginAuth` (the state machine), `LoginAccountData` (both lists), the copy |
| `DemoApp/…/LoginStore.swift` | unchanged — the session, the persistence and the fail-closed read |
| `DemoApp/…/LoginScreen.swift` | raises the request; `LoginGuestButton`; the failure alert and its way out |
| `DemoApp/…/PhoneView.swift` | `ProfilePhone`'s Account card and the confirm |
| `ios/Biyaherong.entitlements` | `com.apple.developer.applesignin` |
| `DemoApp/…/BuildMode.swift` | `BiyaherongBuild.isTestBuild` — the switch, defaulting to `false` |
| `ios/App/BiyaherongApp.swift` | the **only** `#if BIYA_TESTBUILD`, in a real Xcode target |
| `codemagic.yaml` | the two test workflows sed the flag in; all three read the settings back |
| `tools/ship/ship_testflight.sh` | refuses to upload a build carrying the test flag |
| `web-demo/js/login.js` | the twin: same state machine, same lists, `SIMULATED_AUTH = true` |
| `web-demo/js/app.js` | `confirmDeleteAccount()` + `eraseAccountData()` |

## How the browser mirror stays honest

A browser cannot have an `ASAuthorizationController`, so the twin does **not** pretend to. What the
two languages share is the *decision* half — which event moves the screen where — and that half is
where the branch worth getting wrong lives: **a cancelled sign-in is not an error and must not show
one.** `replay_login.js` compares the full 12-entry transition table, then asserts the asymmetry
explicitly: the Swift file has the real call, no other Swift file imports the framework (an
exhaustive directory scan), the browser has neither, and the browser carries a `SIMULATED_AUTH` flag
that the Swift must not.

**The guest door needed no new state in that table** — it bypasses the Apple state machine entirely,
which is why adding it left all twelve transitions untouched. What the gate does compare is the
provider list, the label branch, and `LoginAuth.failureMessage(code:)`, whose one decision (append
the code only when Apple gave one) is composed in the shared half rather than at each call site.

That gate previously **banned** `ASAuthorization` outright — it was what kept the simulation honest.
It is an allowlist of one now. The networking bans were not weakened: they still apply to every login
file including the new one.

The deletion confirm is a **modal**, not a route, because `trial_gate_check.js` asserts `OPEN_ROUTES`
is exactly `home/login/paywall/profile` — and rightly: a destructive confirm is not somewhere you
navigate to and then press Back out of.

## How to test

```bash
node tools/qa/swift_enum_payload_check.js  # a payload case built with no payload does not compile
node tools/qa/replay_login.js       # the reducer, both lists, the allowlist of one, the flag split
node tools/qa/trial_gate_check.js   # the gate still opens only for the two open routes
node tools/qa/replay_premium.js     # still exactly one StoreKit importer
node tools/qa/js_goldens.js
```

In the browser (`web-demo/index.html`): sign in, open Profile from the Home avatar, press **Delete
account** — the confirm must appear and **Huwag na** must leave everything alone. Confirm, and the
app returns to the login gate.

**On a Mac, and only there:** `swift build`, then archive and confirm
`Biyaherong.app/PrivacyInfo.xcprivacy` exists in the product. Sign in with Apple itself needs a
*signed* build — `codemagic.yaml`'s `ios-free-unsigned` archives with `CODE_SIGNING_ALLOWED=NO`, so
entitlements are never applied there and the button cannot work in that `.ipa`. Use `ios-testflight`.
