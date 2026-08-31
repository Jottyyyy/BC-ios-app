# App Store readiness

What the submission needs that is not a feature: the privacy manifest, the entitlement, and the
licence. Plus the list of things that **cannot be done from this repo** — which is where the largest
remaining risk lives.

## The privacy manifest

`ios/App/PrivacyInfo.xcprivacy`. Apple has required one since May 2024 for any app calling a
"required reason" API, and App Store Connect's binary scan flags the upload without it. There was
none.

Exactly one of Apple's five categories applies. Checked against the source, not assumed:

| Category | Applies? | Why |
|---|---|---|
| `UserDefaults` | **yes** | `EngineSettings`, `CoachStore`, `LoginStore`, `OpeningTreeStore`, `AnalysisEngineSettings`, `KeychainStorage` |
| FileTimestamp | no | nothing reads `creationDate` / `modificationDate` |
| DiskSpace | no | nothing reads `volumeAvailableCapacity`. `Diagnostics.swift` reads `.fileSizeKey` on one bundled file — the size of a known file, not free space, and not on Apple's list |
| SystemBootTime | no | — |
| ActiveKeyboards | no | — |

Reason code **`CA92.1`** — *"access info from the app itself"*. Every read and write is the app's own
settings, own saved games, own session key. There is no app group, no third-party SDK reading it.

`NSPrivacyCollectedDataTypes` is an **empty array, not an omitted key**: empty is the affirmative
"collects nothing", omitted reads as "not declared". It is true because nothing leaves the device —
and it stays true only because Sign in with Apple asks for **no scopes** (see `docs/account.md`).

**Placement is the app target, not the package.** `BiyaherongUI` is declared as a plain `.library`,
so SwiftPM links it statically and every required-reason call ends up in the app binary the scanner
reads. A per-package manifest is for *distributed third-party* SDKs. `ios/project.yml`'s
`sources: - path: App` already sweeps the file, and XcodeGen files a non-compilable type into Copy
Bundle Resources — but that is **inference**, so the archive must be checked (below).

## The entitlement

`ios/Biyaherong.entitlements` — `com.apple.developer.applesignin`. It sits beside
`Biyaherong.storekit` rather than under `App/`, because everything in `App/` is swept into the target
and an entitlements plist does not belong in the bundle; both get `buildPhase: none`.

**This file alone is not enough, and the way it fails is quiet.** Three things must be true:

1. `CODE_SIGN_ENTITLEMENTS` in `ios/project.yml` — done.
2. **The capability enabled for the App ID in the Apple Developer portal**, and the provisioning
   profile regenerated afterwards.
3. The build actually signed with that profile.

**Correction to what this doc first said:** step 2 does *not* make signing fail. Codesign takes the
entitlements the **profile** allows and silently drops the rest, so the build succeeds, installs, and
looks fine — and then Apple's sheet runs to the very end and stops on **"Sign Up Not Completed"**.
That is what happened on build 43: *"the signed .ipa loses `com.apple.developer.applesignin` because
the provisioning profile does not carry it."* There is no compile error and no runtime crash to
follow; the only symptom is the sheet refusing at the last step.

To check a build before shipping it:

```bash
codesign -d --entitlements :- Payload/Biyaherong.app | grep applesignin
```

Nothing printed means the entitlement was dropped and the sign-in cannot work.

**The free path can never carry it.** `ios-free-unsigned` archives with `CODE_SIGNING_ALLOWED=NO` and
is signed afterwards by Sideloadly with a free provisioning profile, which does not support Sign in
with Apple at all.

That is why the app's **default** is a test build — no login screen, no paywall — rather than
something a workflow has to switch on. See [`account.md`](account.md).

## The licence

The bundled Terms sheet told every user *"the app itself is GPL"* while the repo had **no LICENSE
file at all** — a licence claim with nothing behind it.

The GPL plan belongs to Stockfish, which `README.md` and `CLAUDE.md` record as a locked decision for
a later phase and which **is not in this repo** (no `.cpp`, no NNUE, no submodule, no dependency —
the engine that ships is original work). So the sentence described a build that does not exist.

Fixed by making the text true rather than making the app GPL:

- `LICENSE` — proprietary, with a note recording what changes when Stockfish lands. **Adding the GPL
  now would be the wrong reflex**: GPLv3's anti-additional-restriction terms conflict with the App
  Store's, which is why VLC was pulled. That is a real problem to solve when Stockfish arrives, not
  paperwork to pre-commit to.
- `THIRD-PARTY-NOTICES.md` — the obligations that *are* owed today: piece art (CC BY-SA, copyleft,
  attribution required), Nunito (SIL OFL), ECO names and the puzzle corpus (CC0).
- The in-app Terms now names those three and drops the GPL sentence, in both languages —
  `replay_login.js` compares the legal bodies in full, so it could not have been changed in one.

## Submit only from `ios-appstore`

There are three workflows. **Neither test path sets anything** — the app's default is the testable
one, so no build setting has to arrive anywhere for a tester to get in. `ios-appstore` is the only
workflow that opts into the real sign-in and real StoreKit, and the only one whose build may go to
review.

It opts in by rewriting `ios/project.yml` before `xcodegen generate` — the same mechanism it already
uses for `CURRENT_PROJECT_VERSION`, and the only one this repo has proved works. Passing a build
setting through the Codemagic CLI does not, and a `#if` inside the `BiyaherongUI` package would be
inert whatever CI passed. See [`account.md`](account.md).

It enforces that itself rather than relying on anyone remembering: it refuses to build if the flag
is in the effective build settings, and after signing it checks that
`com.apple.developer.applesignin` is really in the `.ipa`. See [`account.md`](account.md).

## What only App Store Connect can do

`docs/subscription.md` has listed these since the paywall landed. None can be done from this repo,
and **this is the highest-risk item after the fake login**:

1. Create the subscription group and **both** products, IDs matching `PremiumStore.Plan` exactly:
   `…plus.monthly` ($1.99) and `…plus.yearly` ($19.99), USD base, Apple converting per storefront.
2. Add the **7-day free trial** introductory offer.
3. Set the price.
4. Enable the **billing grace period**.
5. Enable **Sign in with Apple** for the App ID (Developer portal, not ASC), **then regenerate the
   provisioning profile** — an existing profile does not gain the entitlement on its own, and a
   build signed with the stale one fails at "Sign Up Not Completed" with no other symptom.
6. Submit the IAP for review **alongside** the build.
7. Bump `CURRENT_PROJECT_VERSION` past 41 for a manual upload (CI auto-stamps it).

The trial gate means nothing in the app opens without a subscription. So if the product is not
configured, `Product.products(for:)` returns empty, the reviewer sees "Store Unavailable", and there
is literally nothing else for them to look at. That is a rejection with no code involved.

## What is genuinely already right

Worth knowing, because it is unusual: the StoreKit 2 integration is real and careful — verified
transactions only, fail-closed entitlement resolution, a documented grace window, a clock-rollback
mitigation, Restore Purchases wired to `AppStore.sync()`, native subscription management, and prices
only from `Product.displayPrice`. The paywall carries exactly the two URLs Apple requires, enforced
by an allowlist gate. The offline claim is enforced by tests rather than asserted. And the app is
feature-complete — no stub screens.

## How to test

```bash
node tools/qa/replay_login.js      # the licence copy, both languages
node tools/qa/replay_premium.js    # the paywall's URL allowlist and the single StoreKit importer
node tools/qa/js_goldens.js
python -c "import plistlib; plistlib.load(open('ios/App/PrivacyInfo.xcprivacy','rb'))"
python -c "import plistlib; plistlib.load(open('ios/Biyaherong.entitlements','rb'))"
```

**On a Mac.** No gate on Windows can see any of this:

```bash
cd ios && xcodegen generate          # does .xcprivacy land in Resources, not Compile Sources?
# archive, then confirm the file is actually in the product:
ls Biyaherong.xcarchive/Products/Applications/Biyaherong.app/PrivacyInfo.xcprivacy
```

The same paranoia the app-icon catalog earned in `ios/project.yml`: a build with the setting but no
file still succeeds, and ships wrong.
