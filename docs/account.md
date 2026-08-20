# Account — Sign in with Apple, and deleting it

The login gate and the Account card in Profile. One feature, because Apple treats them as one: an
app that offers account creation must offer account deletion, so the two ship together or neither
does.

## What it does

**Sign in with Apple is real.** It used to be simulated — `LoginStore.signIn(_:)` wrote a string and
published, with no `AuthenticationServices` call anywhere. The repo knew: `PORTING_NOTES.md` recorded
it as *"an App Store rejection… a development state, not a shippable one."* It now raises Apple's own
sheet through `ASAuthorizationController`, and only a genuine success opens the session.

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

**Every build is a test build unless the app target says otherwise.** `BiyaherongBuild.isTestBuild`
defaults to `true`, and in that mode:

- `LoginStore.init` opens a session at launch, so **the login screen never appears** — the app boots
  straight to Home;
- `LoginAppleAuth.start` opens the session directly rather than calling Apple, so a signed-out
  tester gets back in with one tap;
- `PremiumStore.recompute` grants `.premium(trial: false)`, so **the paywall never appears** and
  every daily cap lifts (`DailyLimits.isAtDailyLimit` returns `false` on its first line for premium).

All three are needed together. There is no Sign in with Apple capability on the App ID yet and no
subscription product in App Store Connect, so any one of them alone still leaves a wall.

`ios-appstore` sets `BIYA_APPSTORE`, which turns all three back into the real thing.

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
`tools/qa/replay_login.js` asserts that **no file in the package branches on `BIYA_APPSTORE`**, so
the inert form cannot come back.

### Why the default is "testable"

The two failure directions are not symmetric:

- **Default testable** → a submission build that forgot to opt in. Caught loudly: `ios-appstore`
  reads the effective build settings and **refuses to build** unless `BIYA_APPSTORE` really reached
  the compiler, before anything is signed or uploaded.
- **Default real** → a test build nobody can open, with no error to explain it. That has now
  happened three times and cost three days.

A loud failure in the rare workflow beats a silent one in the daily workflow.

| Workflow | `BIYA_APPSTORE` | Login | Subscription |
|---|---|---|---|
| `ios-free-unsigned` | no | skipped | granted |
| `ios-testflight` | no | skipped | granted |
| **`ios-appstore`** | **sed into `project.yml` before `xcodegen`** | real Apple sheet | real StoreKit |

## The thing that changed about "100% offline"

The app is still offline — it makes no network call of its own, and `replay_login.js` /
`replay_premium.js` both fail the build on a `URLSession` or an extra URL. But Apple's servers answer
the sign-in, so **the first launch needs a connection**. The in-app privacy sheet was reworded from
"works 100% offline" to say so, in both languages.

The export-compliance `NO` in `ios/project.yml` is unaffected: `AuthenticationServices` is a second
Apple framework over OS-provided TLS, the same reasoning already written there for StoreKit.

## Key files

| File | What it holds |
|---|---|
| `DemoApp/…/LoginAppleAuth.swift` | the real `ASAuthorizationController` call — **the only file in the package that imports `AuthenticationServices`** |
| `DemoApp/…/AccountDeletion.swift` | the eraser. Deliberately does **not** import StoreKit |
| `DemoApp/…/LoginMetrics.swift` | the pure layer: `LoginAuth` (the state machine), `LoginAccountData` (both lists), the copy |
| `DemoApp/…/LoginStore.swift` | unchanged — the session, the persistence and the fail-closed read |
| `DemoApp/…/LoginScreen.swift` | raises the request; the failure alert |
| `DemoApp/…/PhoneView.swift` | `ProfilePhone`'s Account card and the confirm |
| `ios/Biyaherong.entitlements` | `com.apple.developer.applesignin` |
| `DemoApp/…/BuildMode.swift` | `BiyaherongBuild.isTestBuild` — the switch, defaulting to `true` |
| `ios/App/BiyaherongApp.swift` | the **only** `#if BIYA_APPSTORE`, in a real Xcode target |
| `codemagic.yaml` | `ios-appstore` seds the flag into `project.yml`, and refuses to build without it |
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
