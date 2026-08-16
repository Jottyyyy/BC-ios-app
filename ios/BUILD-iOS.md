# Building & installing Biyaherong on iPhone / iPad

This turns the app into a real iOS/iPadOS build you can install. Everything here happens
**on your Mac in Xcode** — the `.ipa` (the installable file) can only be produced and signed
by Xcode, not by this repo alone.

> **Read this first — iOS is not Android.**
> You can't just build one `.ipa`, drop it on Google Drive, and have anyone install it by
> tapping it. Apple blocks that. How the app reaches a phone depends on your Apple account —
> see **Step 4: Getting it onto phones** below. Short version:
> - **Your own iPhone** → free, works today, but the app stops working after **7 days** (re-install to renew).
> - **Other people's iPhones, the easy way** → needs a **paid Apple Developer account ($99/yr)** + **TestFlight** (send a link).
> - **Other people's iPhones, free-ish** → each person installs the `.ipa` themselves with **AltStore/Sideloadly** (also 7-day expiry).

---

## What you need
- A **Mac** with **Xcode** installed (free, ~7 GB, from the Mac App Store). Xcode 16 or newer.
- An **Apple ID** (any free one works for your own phone). A **paid Apple Developer** membership
  is only needed to put it on *other* people's phones via TestFlight or ad-hoc.
- This repo on the Mac. The app pulls in the `BiyaherongUI` package (UI + engine + the 550k-puzzle
  DB), so the app itself is tiny — the package does the work.

---

## Step 1 — Create the Xcode project

You have two ways. **Path A (XcodeGen)** is one command and fully reproducible. **Path B (manual)**
uses only Xcode if you'd rather not install a tool.

### Path A — XcodeGen (recommended, ~1 min)
```bash
brew install xcodegen            # one time
cd ios
xcodegen generate               # reads project.yml → creates Biyaherong.xcodeproj
open Biyaherong.xcodeproj
```
Skip to **Step 2**.

### Path B — manual, in Xcode
1. **File ▸ New ▸ Project… ▸ iOS ▸ App**, Next.
2. Product Name: `Biyaherong` · Interface: **SwiftUI** · Language: **Swift**. Save it somewhere
   (e.g. next to this repo). This makes a starter app with its own `…App.swift` and
   `ContentView.swift`.
3. **Delete** the generated `ContentView.swift`, and **replace** the generated `BiyaherongApp.swift`
   with the one in **`ios/App/BiyaherongApp.swift`** (drag it in, or copy its contents). It just shows
   `BiyaherongPhoneRoot()`.
4. Add the engine/UI package: **File ▸ Add Package Dependencies… ▸ Add Local…**, choose the
   **`DemoApp`** folder in this repo (it contains `Package.swift` for the `BiyaherongUI` product),
   Add Package, and tick the **BiyaherongUI** library for the `Biyaherong` target.
5. Target settings ▸ **General**: set **Minimum Deployments = iOS 17**, and under
   **Supported Destinations** keep iPhone (add iPad if you want).

> The fonts, sounds, coach art and puzzle database ship *inside* the `BiyaherongUI` package and load
> via `Bundle.module` — you do **not** add them to the app target or edit Info.plist for fonts.

---

## Step 2 — Sign it (needed for any real device)

1. Select the **Biyaherong** target ▸ **Signing & Capabilities**.
2. Tick **Automatically manage signing**.
3. **Team**: pick your Apple ID (click *Add an Account…* if it's not listed — a free Apple ID is fine
   for your own phone). If you see a red "bundle identifier is not available" error, change
   **Bundle Identifier** to something unique, e.g. `com.<yourname>.biyaherong`.

   ⚠️ **Only for a personal sideload.** StoreKit product IDs are namespaced per App Store Connect
   record, so changing the bundle identifier orphans the subscription — `Product.products(for:)`
   comes back empty and the paywall shows "Store Unavailable" forever. Never change it on a build
   headed for TestFlight or the App Store; the shipping value lives in `project.yml` and must stay
   in step with `codemagic.yaml`. See [`../docs/subscription.md`](../docs/subscription.md).

---

## Step 3 — Run it on your own iPhone (works today, free)

1. Plug the iPhone into the Mac with a cable. Unlock it and tap **Trust** if asked.
2. In Xcode's top bar, pick your iPhone as the **run destination** (instead of a simulator).
3. Press **▶ Run**. First time, the phone will refuse to open it until you trust the developer:
   on the iPhone go to **Settings ▸ General ▸ VPN & Device Management ▸ [your Apple ID] ▸ Trust**.
4. The app launches. ✅

**Free-account limits:** the app **expires after 7 days** (just press Run again to renew), you can
have at most 3 sideloaded apps, and it only installs on devices signed in to *your* development setup.

---

## Step 4 — Getting it onto OTHER people's phones

Pick the route that matches your account:

### Option 1 — TestFlight (best for sharing; needs paid $99/yr account)
1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs) ($99/yr).
2. In Xcode: **Product ▸ Archive** (set the destination to *Any iOS Device* first).
3. In the Organizer window that opens: **Distribute App ▸ TestFlight & App Store Connect ▸ Upload**.
4. On [App Store Connect](https://appstoreconnect.apple.com), open the app ▸ **TestFlight**, add
   testers by email (or make a public link). They install the free **TestFlight** app and tap your
   link. Builds last 90 days; up to 10,000 testers. *(An app icon is required for TestFlight — add an
   `AppIcon` to Assets first.)*

### Option 2 — AltStore / Sideloadly (free-ish, closest to "send them the file")
1. In Xcode: **Product ▸ Archive ▸ Distribute App ▸ Custom ▸ Development** (or *Ad Hoc*), Export → gives
   you a **`.ipa`** file. Share that `.ipa` (Drive, AirDrop, etc.).
2. **Each recipient** installs [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io)
   on their own computer, plugs in their iPhone, and installs your `.ipa` **signed with their own
   Apple ID**. Same 7-day expiry on free Apple IDs (AltStore can auto-refresh over Wi-Fi).
   This is the only "pass the file around" route that doesn't need you to pay.

### Option 3 — Ad-hoc `.ipa` (paid account, specific phones)
1. Collect each phone's **UDID** and register them at developer.apple.com (max 100/year).
2. **Archive ▸ Distribute ▸ Ad Hoc ▸ Export** → `.ipa` that installs on exactly those registered
   phones (via Apple Configurator, or drag onto the device in Finder). No 7-day expiry.

| Route | Cost | Other phones? | Expiry | Effort |
|-------|------|---------------|--------|--------|
| Own phone (Step 3) | Free | No | 7 days | Lowest |
| AltStore/Sideloadly | Free | Yes (they install it) | 7 days | Medium, per person |
| Ad-hoc `.ipa` | $99/yr | Yes (registered UDIDs) | 1 year | Medium |
| **TestFlight** | $99/yr | **Yes (just a link)** | 90 days | **Lowest for sharing** |

---

## Notes
- **App size** ≈ 100 MB — the 550,000-puzzle SQLite DB is bundled offline. That's expected.
- **Portrait only** — the phone UI is designed for portrait; the project.yml locks it there.
- **Orientation / iPad** — it runs on iPad but shows the iPhone-sized layout; iPad-specific polish is future work.
- **Almost no internet needed** — the engine, puzzles, coaches and sounds all run fully
  offline. The one exception is StoreKit: buying or restoring the subscription needs a
  connection, and so does the periodic entitlement refresh. Everything already bought keeps
  working offline, and a lapse drops to the free tier rather than a dead app. See
  [`../docs/subscription.md`](../docs/subscription.md).
- If a build ever fails on *"Bundle.module"* or missing resources, make sure the app is linking the
  **BiyaherongUI package library** (Step 1), not copies of the Swift files.
