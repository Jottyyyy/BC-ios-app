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

## The test-build escape hatch, and the failure it exists for

**Symptom:** Apple's sheet appears, the user picks their Apple Account, and it ends on **"Sign Up Not
Completed"**. No compile error, no crash. Because the login gate is the last ZStack sibling and covers
everything, the whole app is unreachable.

**Cause:** `com.apple.developer.applesignin` has to be in the **provisioning profile**, not just in
`ios/Biyaherong.entitlements`. Codesign keeps only the entitlements the profile allows and drops the
rest silently. The profile carries it only after the capability is enabled for the App ID in the Apple
Developer portal *and* the profile is regenerated. The free/sideload path cannot carry it at all — a
free provisioning profile does not support Sign in with Apple.

**The real fix** is the portal. **The stopgap** is `BIYA_TEST_BUILD`, a Swift compilation
condition that makes `start(onSuccess:)` open the session directly:

`BIYA_TEST_BUILD` covers **two** things, because either one alone still leaves the app unusable:
the sign-in opens the session directly, **and** the subscription is granted. There is no product in
App Store Connect yet, so `Product.products(for:)` comes back empty and the paywall can only say
"Store Unavailable" — and the trial gate stands in front of every route. A tester who gets past the
login screen and straight into a paywall they cannot buy is no better off than one who cannot sign
in. One flag for both, so the two halves can never disagree about whether this is a test build.

| Workflow | `BIYA_TEST_BUILD` | Sign-in | Subscription | Use it for |
|---|---|---|---|---|
| `ios-free-unsigned` | **set** | opens directly | granted | sideload testing (Sideloadly) |
| `ios-testflight` | **set** | opens directly | granted | handing a build to testers |
| **`ios-appstore`** | never | real `ASAuthorizationController` | real StoreKit | **the only build you submit** |

**Both test paths simulate.** A build whose login gate cannot be passed cannot be tested at all — the
gate is the last ZStack sibling and covers every route — so a TestFlight build that fails the sign-in
is not a degraded build, it is an unopenable one.

**The submission path is a separate workflow, not a note.** "Remember to remove the flag before
submitting" is not a safeguard. `ios-appstore` never sets it and **refuses to build** if it finds it
in the effective build settings, which catches it however it got there — including from a stray value
committed into `project.yml`. It also verifies, after signing, that
`com.apple.developer.applesignin` actually survived into the `.ipa`, because that failure has no
other symptom.

The grant sits in `PremiumStore.recompute()` — the one funnel every path already goes through —
rather than in a forged `Snapshot`. Everything below it (the trust floor, the grace window, the
expiry maths) is therefore neither edited nor bypassed; in a build with no store to consult, it is
simply not consulted.

`tools/qa/replay_login.js` pins the whole split: the real call is still the branch every non-flagged
build takes, `access` has exactly two writers (the test grant and the real resolve), both test
workflows set the flag, `ios-appstore` does not, and its refusal guard exists.
Note the gate looks for the **assignment**, not the string — `ios-appstore` names the flag inside the
guard that rejects it. Mutation-checked three ways: the flag leaking into the submission workflow,
TestFlight silently ceasing to simulate, and the guard being deleted.

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
| `codemagic.yaml` | sets `BIYA_TEST_BUILD` in the free workflow, and only there |
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
