# Shipping a build to TestFlight

**One command, on a Mac with Xcode:**

```bash
tools/ship/ship_testflight.sh              # auto-bump the build number, then ship
tools/ship/ship_testflight.sh 44           # ship as build 44 exactly
tools/ship/ship_testflight.sh --dry-run    # build + verify + validate, but DO NOT upload
```

It bumps `CURRENT_PROJECT_VERSION`, regenerates the Xcode project, archives **signed**, verifies the
entitlements, exports, verifies them **again in the signed `.ipa`**, validates with Apple, and uploads.
It refuses to upload if anything declared in `ios/Biyaherong.entitlements` is missing from the binary.

Use `--dry-run` whenever you just want to know the build is sound; it consumes nothing.

---

## One-time setup

Everything below is already done on Joshua's Mac. This is for a fresh machine.

1. **Xcode** + `brew install xcodegen`.
2. **The signing identity.** `Apple Distribution: Deniel Causo (3C29G97AU5)` must be in the keychain.
   Backups (key, `.p12`, its password, cert) are in `~/BiyaherongSigning/`; re-import the `.p12` if
   the keychain is ever reset. **Never revoke the older *iOS Distribution* cert — it belongs to
   Prince's Expo pipeline.**
3. **An App Store Connect API key**, which needs App Store Connect **Admin**:
   Users and Access ▸ Integrations ▸ App Store Connect API ▸ **Team Keys** ▸ + ▸ Access **Admin**.
   Download the `.p8` — Apple allows that exactly once.
   ```bash
   mkdir -p ~/.appstoreconnect/private_keys
   mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.appstoreconnect/private_keys/
   chmod 600 ~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
   cat > ~/.appstoreconnect/asc.env <<'EOF'
   export ASC_KEY_ID=XXXXXXXXXX
   export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   EOF
   chmod 600 ~/.appstoreconnect/asc.env
   ```
   ⚠️ **A `.p8` is a private key. It must never enter this repo** — `*.p8` is gitignored because one
   once landed in the project root, untracked but un-ignored, one `git add -A` from being published.

A **Team Key** can call Apple's Provisioning endpoints (bundle IDs, capabilities, profiles) even
though this is an *Individual* enrollment where no human but the Account Holder can reach
`developer.apple.com` ▸ Certificates, Identifiers & Profiles. An *Individual Key* cannot. That
distinction is the whole reason capability changes are possible from here at all.

---

## After it uploads

1. Record the **delivery UUID** in `CHANGELOG.md` and commit the build-number bump. The number in
   `project.yml` is the record of what shipped; it is worthless if it drifts.
2. TestFlight shows the build in a few minutes under its version heading. **Internal** groups get it
   with no review. **External** testing needs Beta App Review.

---

## The traps, all of which report success

Apple's tooling says `SUCCEEDED` while doing nothing, repeatedly. **An exit code is not evidence here —
decode the artifact and read it back.** That is what the script does, and it is the only check that has
ever caught any of these.

### An unsigned archive cannot carry an entitlement

Builds 38–42 archived with `CODE_SIGNING_ALLOWED=NO` and let `-exportArchive` do the signing. That
works **only for an app with no entitlements**. An unsigned archive never runs
`ProcessProductPackaging`, emits no `.xcent`, and export then signs with the provisioning profile's
baseline set — while printing `EXPORT SUCCEEDED`. `codesign -d --entitlements` on such an archive
reports *"code object is not signed at all"*.

Since 1.0.6 the archive is **signed**, via target-scoped settings in `project.yml`:
`CODE_SIGN_STYLE: Manual`, `DEVELOPMENT_TEAM`, `CODE_SIGN_IDENTITY`, `PROVISIONING_PROFILE_SPECIFIER`.

**Never pass those four on the `xcodebuild` command line.** Command-line settings apply to *every*
target, including SwiftPM's generated `BiyaherongUI_BiyaherongUI` resource bundle, which fails with
*"does not support provisioning profiles."* `CURRENT_PROJECT_VERSION` as an override is fine — it is
a plain setting, not a signing one.

### A profile is a snapshot, not a live view

A provisioning profile freezes the App ID's capabilities **at the moment it is generated**. Enable a
capability and every existing profile becomes invalid; there is no refresh. The profile must be
**deleted and recreated**, *after* the capability is on. Doing both in one script run is how 1.0.6
first shipped an empty profile — the create raced the enable.

### Sign in with Apple needs a settings payload

`POST /v1/bundleIdCapabilities` with a bare `{"capabilityType": "APPLE_ID_AUTH"}` returns **409
"Please select at least one configuration for Sign In with Apple."** The form that works:

```json
{"capabilityType": "APPLE_ID_AUTH",
 "settings": [{"key": "APPLE_ID_AUTH_APP_CONSENT",
               "options": [{"key": "PRIMARY_APP_CONSENT"}]}]}
```

Also: `GET /v1/bundleIds/<id>/bundleIdCapabilities` **rejects a `limit` parameter with HTTP 400**.
Pass none — a status-blind reader otherwise reports "no capabilities" on a perfectly healthy App ID,
which is exactly how a successful 201 was misread as a failure.

### Export silently rewrites the build number

`manageAppVersionAndBuildNumber` **defaults to true**, and Xcode uses it to step the build number past
whatever App Store Connect already holds. An archive built at 43 exported as an `.ipa` reading **44**,
purely because 43 had just been delivered. `ios/ExportOptions.plist` now pins it to `false`, so the
number in the repo is the number that ships.

### Other standing gotchas

- **Never run `xcodegen generate` while Xcode has the project open** — it rewrites the `.xcodeproj`
  underneath Xcode, which then reports a bogus *"Missing package product 'BiyaherongCoachCore'"*.
  The script refuses to run if Xcode is open.
- **Never change `PRODUCT_BUNDLE_IDENTIFIER`.** It belongs to App Store Connect record 6762338466;
  changing it uploads a brand-new app and orphans the subscription's StoreKit product IDs.
- **`CFBundleIconName` is nested** at `CFBundleIcons ▸ CFBundlePrimaryIcon ▸ CFBundleIconName`.
  `PlistBuddy -c "Print :CFBundleIconName"` prints *"Does Not Exist"* on a perfectly good archive —
  a false alarm, not ITMS-90713. Use `plutil -p`.
- **`altool --store-password-in-keychain-item` is broken in Xcode 26.6.** Moot now: the API key
  replaces the app-specific-password flow entirely.

---

## Doing it by hand

If the script is unavailable, this is what it runs:

```bash
cd ios && xcodegen generate                              # Xcode must be CLOSED
xcodebuild -project Biyaherong.xcodeproj -scheme Biyaherong -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -archivePath <path>.xcarchive archive
xcodebuild -exportArchive -archivePath <path>.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath <dir>

# THE CHECK THAT MATTERS - never skip it
unzip -q <dir>/Biyaherong.ipa -d <dir>/x
codesign -d --entitlements :- <dir>/x/Payload/Biyaherong.app

xcrun altool --validate-app -f <dir>/Biyaherong.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
xcrun altool --upload-app   -f <dir>/Biyaherong.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
```

## Key files

| File | What it is |
|---|---|
| `tools/ship/ship_testflight.sh` | the one command; verification is the point of it |
| `ios/project.yml` | version, build number, **signing** — the source of truth; `.xcodeproj` is generated |
| `ios/ExportOptions.plist` | how the archive is signed at export; build number pinned here |
| `ios/Biyaherong.entitlements` | what the app requests; the script checks every key reaches the binary |
| `~/.appstoreconnect/` | API key + ids, **outside the repo** |
| `~/BiyaherongBuilds/` | archives and `.ipa`s that were actually shipped |
