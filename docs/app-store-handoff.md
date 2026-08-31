# App Store handoff

**For whoever has the Mac and the App Store Connect login.** The code is finished, merged and the
backend is deployed. What is left is the subscription setup in App Store Connect and a build.

This is the operational companion to [`app-store-readiness.md`](app-store-readiness.md) (what the
submission needs that is not a feature), [`subscription.md`](subscription.md) (how the paywall
works) and [`shipping-to-testflight.md`](shipping-to-testflight.md) (the ship script and its traps).
Read those for the *why*; this page is the *what to do, in what order*.

---

## Fixed values

These must match **exactly**. They are not preferences.

| | |
|---|---|
| Bundle ID — **never change** | `com.prince24pogi.biyaherongchessapp` |
| Team | `3C29G97AU5` |
| Provisioning profile | `Biyaherong App Store` |
| App Store Connect record | *Biyaherong Chess Coach*, Apple ID `6762338466` |
| Subscription group | `Biyaherong Plus` |
| Monthly product ID | `com.prince24pogi.biyaherongchessapp.plus.monthly` — USD **1.99** |
| Yearly product ID | `com.prince24pogi.biyaherongchessapp.plus.yearly` — USD **19.99** |
| Free trial | **7 days, on both products** |
| Billing grace period | **On** |

The product IDs come from `PremiumStore.Plan` and the bundle ID from `ios/project.yml`.
`tools/qa/replay_premium.js` checks them against `ios/Biyaherong.storekit`, but nothing in this repo
can see App Store Connect — that half is on you.

**Price in USD and let Apple convert.** In the Philippines that lands near ₱119 and ₱1,190, above
the ₱99 the old RN app charged. That is a product decision, already reflected on the website and in
the Terms of Service; a peso figure entered by hand would contradict them on the next rate move.

---

## Already done — do not go looking for it

Both repositories are merged, and the backend is live. Verified against production on 2026-08-31:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://biyaherongchesscoach.com/api/content/tutorial-videos
# 405  = correct. The catalogue takes a POST with an App Store receipt.
# 200  = the backend has been rolled back. Stop and say so.
```

A `POST` with no receipt returns `401`, and so does a forged one.

---

## The order

### 1. Enable In-App Purchase, then remake the profile

Apple Developer portal → **Identifiers** → the App ID above → enable **In-App Purchase**. Confirm
**Sign in with Apple** is on as well.

> **Then delete the `Biyaherong App Store` provisioning profile and create a new one.** A profile
> snapshots the App ID's capabilities at the moment it is minted and cannot be refreshed into having
> a new one. Skip this and the entitlement is dropped at signing time — the sign-in then fails on
> device with no other symptom. That failure has already cost this project several builds; see
> `shipping-to-testflight.md`.

### 2. Create the two subscriptions

App Store Connect → **Subscriptions** → one group, both products, from the table above.

The trial goes on **both**. Introductory-offer eligibility belongs to the subscription *group*, not
to a product, and the paywall offers it on whichever plan the user selects — a trial on only one of
them is a row promising something the App Store will not honour.

### 3. Build

**Easiest, and needs no Mac:** run the **`ios-appstore`** workflow in Codemagic. It refuses to build
if the test-build flag reached the compiler, which is the check that stops a
free-subscription build reaching Apple.

**On a Mac,** with Xcode closed:

```bash
brew install xcodegen
cd ios && xcodegen generate
cd .. && tools/ship/ship_testflight.sh --dry-run
```

`--dry-run` builds, decodes the signed binary to confirm the entitlements survived, and validates
with Apple **without uploading**. Run it again without the flag when it comes back clean.

The Mac needs the `Apple Distribution: Deniel Causo (3C29G97AU5)` certificate in its keychain, and an
App Store Connect API key created as a **Team key with Admin access** — an Individual key cannot
call the provisioning endpoints. Put the `.p8` in `~/.appstoreconnect/private_keys/` (chmod 600) and
`ASC_KEY_ID` / `ASC_ISSUER_ID` in `~/.appstoreconnect/asc.env`. **The `.p8` never enters the repo**;
`*.p8` is gitignored because one landed in the project root once already.

### 4. Sandbox test

Sign in with a sandbox Apple Account and check every one of these:

- the paywall lists **both** plans, with real prices from the App Store
- the yearly row shows **BEST VALUE** and a saving computed from the two prices
- the trial line states its duration and what it converts to
- purchasing unlocks the app, and **Restore Purchases** brings it back
- both legal links open — Terms of Use and Privacy Policy
- Tutorial Videos loads the real catalogue

### 5. Submit

**Submit both in-app purchases together with the build**, not afterwards.

Review notes should say: the app is subscription-only, a sandbox account is required, and Sign in
with Apple is the only sign-in method.

---

## Why the product IDs matter more than the prices

Every screen in this app is behind the paywall — `PhoneView.locked` gates every Home tile, and only
Home and Profile stay open. If a product ID is wrong, or the IAP is not submitted alongside the
build, `Product.products(for:)` returns an empty list, the paywall can only render *"Store
Unavailable"*, and **there is nothing else in the app for a reviewer to look at.**

That is a rejection with no code involved, and it is the highest-risk item in the whole submission.
A wrong price is a support ticket; a wrong product ID is a rejection.

---

## Traps this project has already paid for

- **Never run `xcodegen generate` with Xcode open.**
- **Never change `PRODUCT_BUNDLE_IDENTIFIER`.** It is the namespace for the product IDs — change it
  and every subscription is orphaned and the paywall says "Store Unavailable" forever.
- **An unsigned archive cannot carry an entitlement.** Builds 38–42 printed `EXPORT SUCCEEDED` while
  silently dropping Sign in with Apple. The ship script now decodes the artifact and refuses to
  upload if anything declared in `ios/Biyaherong.entitlements` is missing.
- **Never pass the signing settings on the `xcodebuild` command line.** They are target-scoped in
  `ios/project.yml` on purpose; as overrides they break SwiftPM's resource bundle.
- **Do not bump the build number by hand.** The ship script and CI manage it, and
  `ExportOptions.plist` pins `manageAppVersionAndBuildNumber` to false because export otherwise
  rewrites it.

---

## Hand this to an assistant

Everything above, as one message. It assumes the repo has been cloned.

```text
I'm shipping the Biyaherong Chess Coach iOS app to the App Store. I have a Mac with
Xcode and admin access to App Store Connect. The code is finished and merged, and the
backend is already deployed — nothing needs to be written. I need help getting it
built and submitted.

Repo: https://github.com/Jottyyyy/BC-ios-app  (read docs/app-store-handoff.md first,
then CLAUDE.md, docs/subscription.md, docs/app-store-readiness.md and
docs/shipping-to-testflight.md — they cover all of this and record traps this project
has already hit.)

FIXED VALUES — must match exactly:
  Bundle ID (NEVER change): com.prince24pogi.biyaherongchessapp
  Team: 3C29G97AU5
  Provisioning profile: "Biyaherong App Store"
  App Store Connect record: "Biyaherong Chess Coach", Apple ID 6762338466

  Subscription group: Biyaherong Plus
    com.prince24pogi.biyaherongchessapp.plus.monthly   USD 1.99
    com.prince24pogi.biyaherongchessapp.plus.yearly    USD 19.99
    7-day free trial on BOTH products
    Billing grace period: ON
    Price in USD; let Apple convert per storefront (PH lands near P119 / P1,190)

ALREADY DONE — the backend is deployed and verified:
  GET  https://biyaherongchesscoach.com/api/content/tutorial-videos  -> 405
  POST (no receipt)                                                  -> 401
  If that GET ever returns 200 again, the backend was rolled back — tell me.

WHAT I NEED, IN THIS ORDER:

1. Apple Developer portal -> Identifiers -> the App ID above: enable In-App
   Purchase. Confirm Sign in with Apple is also enabled.

2. DELETE the "Biyaherong App Store" provisioning profile and CREATE A NEW ONE.
   A profile snapshots the App ID's capabilities when it is minted and cannot be
   refreshed into having a new one. Skipping this drops the entitlement at signing
   time and the sign-in then fails on device with no other symptom.

3. App Store Connect -> Subscriptions: create the group and both products above.

4. Build. Two options — tell me which you recommend:
   a) Codemagic workflow "ios-appstore" (builds on Codemagic's Mac, no local setup)
   b) Locally:
        brew install xcodegen
        cd ios && xcodegen generate     # Xcode MUST be closed
        cd .. && tools/ship/ship_testflight.sh --dry-run
      --dry-run builds, verifies the entitlements survived signing, and validates
      with Apple WITHOUT uploading. When clean, run again without the flag.
      I'll need the Apple Distribution cert in my keychain, and an App Store Connect
      API key created as a TEAM key with ADMIN access (an Individual key cannot call
      the provisioning endpoints), stored at
      ~/.appstoreconnect/private_keys/AuthKey_XXXX.p8 (chmod 600) plus
      ~/.appstoreconnect/asc.env with ASC_KEY_ID and ASC_ISSUER_ID.

5. Sandbox test before submitting:
   - the paywall lists BOTH plans with real App Store prices
   - the yearly row shows "BEST VALUE" and a computed saving
   - the trial line states the duration and what it converts to
   - purchase unlocks the app, and Restore Purchases brings it back
   - both legal links open (Terms of Use, Privacy Policy)
   - Tutorial Videos loads the real catalogue

6. Submit BOTH in-app purchases together with the build, not afterwards.
   Review notes: the app is subscription-only, a sandbox account is required, and
   Sign in with Apple is the only sign-in method.

WHY THE PRODUCT IDs MATTER MORE THAN THE PRICES:
Every screen is behind the paywall. If a product ID is wrong or the IAP isn't
submitted with the build, Product.products(for:) returns empty, the reviewer sees
"Store Unavailable", and there is nothing else in the app to look at. That's an
automatic rejection with no code involved.

TRAPS ALREADY RECORDED IN THIS REPO:
- Never run `xcodegen generate` with Xcode open.
- Never change PRODUCT_BUNDLE_IDENTIFIER — it namespaces the product IDs.
- Never pass signing settings on the xcodebuild command line; they're set in the
  project on purpose and overriding them breaks the SwiftPM resource bundle.
- An unsigned archive cannot carry an entitlement. Builds 38-42 printed
  "EXPORT SUCCEEDED" while silently dropping Sign in with Apple.
- Don't bump the build number by hand — the script and CI manage it.
- The .p8 must never be committed (*.p8 is gitignored for a reason).

Please start by reading the repo docs, then walk me through step 1.
```

---

## How to test

Nothing here is code, so nothing here has a gate. The two things worth re-running before you start:

```bash
# 1. Is the backend still deployed? Must be 405.
curl -s -o /dev/null -w "%{http_code}\n" \
  https://biyaherongchesscoach.com/api/content/tutorial-videos

# 2. Do the product IDs in the repo still agree with each other?
node tools/qa/replay_premium.js
```

If the second one fails, the table at the top of this page is out of date and App Store Connect must
be changed to match the code — not the other way round.
