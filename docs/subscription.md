# subscription — two plans, a 7-day trial, and no server

Two auto-renewing subscriptions in one group — **monthly** and **yearly**, `$1.99` and `$19.99` as
the USD base price Apple converts per storefront — each with a **7-day free trial**, verified
entirely **on-device by StoreKit 2**. No backend, no accounts, no receipt POST.

The trial requires a payment method and converts automatically: that is Apple's own behaviour for
an introductory offer, and it is the client's requirement met without a line of code. The app must
**not** collect card details itself — Guideline 3.1.1 forbids it for digital content.

**Nothing in the app is usable until that trial is started.** Home draws — the six cards, the
quote, the offer banner — so the user can see what they are buying, and every tile, every content
tile and every route beyond it lands on the paywall instead. Profile stays open, because it owns
Sign out. This is the round-4 client decision: *"kada click lagi mong dalhin doon na go for free
trial."*

> **This reverses what the rest of this document was written around.** Until round 4 there was a
> genuinely playable free tier and the paywall was reached on demand. The caps below are all still
> real code, still parity-tested, and still describe exactly what a **lapsed** subscriber returns
> to — they are simply no longer reachable by someone who has never subscribed. Nothing in
> `Entitlement`, `DailyLimits` or the per-feature gates changed; one guard was added at each
> language's router. See **The trial gate** below.

- **Run it (Windows):** open `web-demo/index.html`. The **Subscription** picker above the phone
  (Free · Trial · Active · Grace · Expired) drives a *simulated* store, so the whole lifecycle is
  walkable in seconds. `?storefail` shows the "couldn't reach the App Store" card.
- **Run it (macOS):** `cd DemoApp && swift run DemoApp` → the **Phone UI** panel. StoreKit resolves
  to nothing there, so it exercises the free tier — which is the half worth looking at.
- **Assertions:** `cd DemoApp && swift run PaywallMetricsCheck` (macOS) ·
  `node -e "console.log(require('./web-demo/js/premium.js').selfTest().summary)"` (anywhere) ·
  `node tools/qa/replay_premium.js` (the Swift-vs-JS replay — the real gate on Windows).

## Why an offline app can enforce a subscription at all

`Transaction.currentEntitlements` is served from the device's own transaction cache, and every
transaction in it is a JWS Apple already signed. Verification is local and cryptographic, so the
check works in Airplane Mode. Apple is the server; the app does not need one.

**The hard part is renewal, not verification.** Apple charges the card server-side and issues a new
transaction; an offline phone never sees it. So a cached entitlement can only ever *expire*, never
*renew*, and a naive check locks out the paying customer while barely inconveniencing anyone else.

Two mechanisms answer that:

1. **A 7-day grace window** from the cached expiry (`Entitlement.graceDays`). It applies only when
   auto-renew was ON at the last check — someone who deliberately cancelled knew the date was
   coming, and gets none.
2. **The free tier.** When grace lapses the user drops to the free tier, *not* to a dead app, and
   every puzzle rating, saved analysis and tournament stays on disk. This is what makes the whole
   no-server design safe: the worst case is an inconvenience, never a loss.

### What is deliberately not defended

- **Refunds** are invisible until the device next syncs.
- **Clock rollback** (airplane mode + a back-dated clock) extends access. `Entitlement.trustedNow`
  floors the clock at the newest Apple-signed `signedDate` ever seen, which raises the bar a long
  way without closing it.

Neither is fixable without a server, and both are recorded in [`../PORTING_NOTES.md`](../PORTING_NOTES.md).
On-device enforcement is a speed bump, not a lock — the question is only whether that costs real
money, and for a consumer chess app it does not.

## The trial gate

One guard per language, at the only place every route transition passes through.

| | Swift | Browser |
|---|---|---|
| The predicate | `PhoneApp.locked` — `loginStore.isSignedIn && !premium.isPremium` | `app.js` `locked()` — the same two calls |
| Left open | Home (the root everything is raised over) and Profile, raised from the avatar without `gated` | `OPEN_ROUTES` — plus `login` and `paywall`, which are the routes it sends people *to* |
| Every destination | a `show*` flag raised in exactly one place, inside `gated` | the Home tile handler |
| Home tiles | `gated { … }` around every wired destination | one check in `renderHome`'s handler |
| Mid-session lapse | `visibleTab` re-resolves on every render | `render()` re-checks before the dispatch chain |

Four things about it are deliberate:

- **It is at the router, not in the screens.** The pushed routes (Analysis, Play vs Coach, Pairing)
  are reachable *only* from Home tiles, so wrapping the tiles closes all three without a flag of
  their own — and a new screen is gated the moment it is routed to.
- **`onAvatar` and `onMembership` are exempt, and nothing else is.** One leads to Sign out; the
  other *is* the offer. Walling Profile would strand a user who signed in with the wrong Apple
  Account, and Restore Purchases lives on the paywall they would then be unable to leave.
- **The paywall stays dismissible.** Back returns to Home. A locked user can look at the app; they
  just cannot open any of it.
- **The lapse case is handled by re-resolving, not by remembering.** `Transaction.updates` can
  revoke an entitlement while the user is standing inside the Puzzle Hub, so both languages re-check
  on every paint rather than only at tap time.

`tools/qa/trial_gate_check.js` pins all of it. It used to map the Swift tab *indices* through the
browser's own tab table, because the two languages named the open set differently — `[0, 3]` against
`{ home, profile }`. With Home as the app root there are no indices: the gate now asserts that
neither language has a tab bar left, that every `show*` flag is raised in exactly one gated place,
and that Profile is the single ungated destination.

**It also closed a real hole.** Before this, `app.js` gated only the four puzzle modes — Play vs
Coach, the Analysis Board and the Swiss round ceiling had **no premium reference at all** in the
browser, while Swift gated all three. `replay_premium.js` asserts the JS *puzzle* gates and the
*Swift* coach/review gates separately, so the divergence passed every suite, and the client (who
tests on Windows) saw an app with no locks on it.

## Free vs premium

*What a lapsed subscriber returns to. Not reachable without ever having subscribed — see the gate
above.*

| | Free | Premium | Mode key |
|---|---|---|---|
| Rated puzzles | 5 / day | unlimited | `regular` |
| Streak run | 1 / day | unlimited | `streak` |
| Turbo run | **1 / day per mode** (∞ · 3 min · 5 min separately) | unlimited | `rush_0` `rush_3` `rush_5` |
| Daily puzzle · daily goal | ✓ always free | ✓ | — |
| Thematic puzzles | 🔒 hard gate | ✓ | — |
| Analysis Board · engine · move tree · PGN · book | ✓ unlimited | ✓ | — |
| Game Review (**both** entry points) | 3 / day | unlimited | `review` |
| Play vs Coach | Jaden (1), Jade (2) | all five | `id > 2` |
| Coach chats | 2 / day | unlimited | `coach` |
| Swiss rounds | 3 | 30 | — |

This is the RN original's split (`FRONTEND/utils/usageLimits.ts`), which is why every cap but the
review one was already ported and parity-tested. Four things are easy to get wrong:

- **Turbo is per mode.** Three keys, three allowances — not one shared counter.
- **The Daily puzzle was never gated**, and still is not.
- **Counts are of *starts*, not solves.** A failed attempt still spends a use, exactly as the
  original counted them. That is also why `PuzzleProgress.dailySolves` cannot double as the
  counter: it counts correct solves, for the goal ring.
- **Both Game Review entry points share one allowance.** The Analysis Board's ☰ menu and Play vs
  Coach's "Start Review" both go through `PremiumStore.consumeReview()`; capping one alone would be
  a free bypass of the other.

**Player count is deliberately uncapped.** `TournamentEngine.freeMaxPlayers = 10` exists but is read
nowhere — the RN client never enforced it, the PHP controller did, and there is no server here.

## Where the numbers live

- **`DailyLimits` is not touched.** It is pinned to the PHP oracle by 168 golden assertions; a mode
  added there would make it diverge from the backend it was verified against. `replay_premium.js`
  fails if `"review"` ever appears in it, in either language.
- **The invented cap (`reviewsPerDay = 3`) lives in `Entitlement`.** The number is borrowed, not
  guessed: the RN app gated the Analysis Board at 3 saved sessions and 3 pinned GM games.
- **Prices are never hard-coded.** `Product.displayPrice` only — the original showed three different
  prices in one session. The same rule covers the **`Save {n}%`** badge on the yearly row: it is
  computed from the two real `Product.price` values and simply does not render when either tier is
  missing. Spec §3.2 asks for that line; the RN never actually rendered it (only `BEST VALUE`), and
  `PORTING_NOTES.md` records the disagreement.
- **Trial eligibility is asked once, for the GROUP.** `isEligibleForIntroOffer` is a property of the
  subscription group, not of a product — someone who used the free trial on monthly cannot have it
  again on yearly. Asking per row would promise a second trial the App Store will not honour, and
  the user would discover that at the payment sheet.
- **`daysRemaining` rounds *up*** over calendar days: the server truncated a float, so 27.9 days
  read "27 days remaining" and anything inside the last day read "0".

## The state machine

`Entitlement.resolve(_:now:)` is the only place these rules exist. Four branches, each one the
difference between a paywall and a suggestion:

```
no expiry at all            → .free    ← FAIL CLOSED. An auto-renewable always has one, so a
                                         snapshot claiming a subscription without a date was not
                                         produced by StoreKit.
now < expiry                → .premium(trial:)
expired, auto-renew OFF     → .free    ← they cancelled; the date was expected
expired, auto-renew ON      → .grace(daysLeft:) for 7 days, then .free
```

`Access.isPremium` is true for `.premium` **and** `.grace`, so no gate has to remember to handle two
cases.

## Key files

| File | Role |
|---|---|
| `Sources/BiyaherongCoachCore/Entitlement.swift` | The pure layer — state machine, clock floor, day counters, every constant. **Foundation only; no StoreKit.** |
| `DemoApp/Sources/BiyaherongUI/PremiumStore.swift` | **The one file that imports StoreKit.** Turns what Apple says into an `Entitlement.Snapshot`. |
| `DemoApp/Sources/BiyaherongUI/KeychainStorage.swift` | `SecItem` behind `CoachGame.Storage`. iOS only — macOS falls back to `UserDefaults`, because `SecItem` from an unsigned binary raises a system dialog. |
| `DemoApp/Sources/BiyaherongUI/PaywallMetrics.swift` | Palette, geometry, type, timings, every string. No numeric literal in any view body. |
| `DemoApp/Sources/BiyaherongUI/PaywallScreen.swift` | The paywall (offer · subscribed · grace) and `PremiumLockCard`. |
| `DemoApp/Sources/BiyaherongUI/PaywallMetricsCheck.swift` | The runnable self-check. |
| `DemoApp/Sources/BiyaherongUI/PhoneView.swift` | Owns the store, the paywall route, and the Game Review gate. |
| `DemoApp/Sources/BiyaherongUI/PuzzleHubScreen.swift` | Every puzzle gate — the solvers know nothing about subscriptions. |
| `web-demo/js/daily-limits.js` | The JS twin of `DailyLimits`, which had none until now. |
| `web-demo/js/premium.js` | The JS twin of everything above, with a **simulated** store. |
| `web-demo/css/app.css` (`---- Paywall ----`) | Driven entirely by `--pw-*` properties the JS sets from the one table. |
| `tools/qa/replay_premium.js` | Swift vs JS, plus the offline / script-order / CSS-variable guards. |
| `ios/Biyaherong.storekit` | The local StoreKit configuration the Debug scheme runs against. |

### The gate's own files

| File | Role |
|---|---|
| `DemoApp/Sources/BiyaherongUI/PhoneView.swift` | `locked`, `openTabs`, `visibleTab`, `gatedTab`, `gated(_:)` — the whole Swift half |
| `web-demo/js/app.js` | `locked()`, `OPEN_ROUTES`, `isOpenRoute()`, the Home tile check, the `render()` backstop |
| `tools/qa/trial_gate_check.js` | The cross-language gate on both of the above |

## How to test

```bash
node tools/qa/replay_premium.js     # Swift vs JS, and the four wiring guards
node tools/qa/js_goldens.js         # the full suite; all four new suites are registered
node tools/qa/swift_lint.js         # no arguments
node tools/qa/swift_symbol_check.js
node tools/qa/swift_layout_check.js
```

Then open `web-demo/index.html` and walk the **Subscription** picker: Free → Trial → Active → Grace
→ Expired → Free. Check that the Home banner turns gold, the ✈️ avatar badge appears, each gate
raises the lock card rather than failing silently, and the free tier still has your rating and
history after grace lapses.

On a Mac: `swift run ParityRunner` (unchanged — no ported rule was touched), then
`cd DemoApp && swift run PaywallMetricsCheck`, then Xcode against `ios/Biyaherong.storekit` for the
real trial, renewal, expiry and billing-retry paths.

## Gotchas

- ⚠️ **Do not add a field to `PuzzleProgressState`.** `PuzzleHubStore.swift:152` decodes it with a
  bare `try?` and synthesized `Codable` — a new non-optional field makes every existing save file
  fail to decode and silently resets the user's rating, history and streaks. The usage counters are
  a **separate** persisted value for exactly this reason.
- **The paywall contains the only two URLs in the app** — Apple's standard EULA and the privacy
  policy, both required by App Review on an auto-renewing subscription. `replay_premium.js`
  allowlists exactly those two and fails on a third, so the exception cannot quietly widen.
- **`ios-free-unsigned` cannot transact.** It archives with signing off, so there is no App ID with
  In-App Purchase and `Product.products(for:)` returns empty — testers on that path see the "Store
  Unavailable" card permanently. `ios-testflight` is the only real store test path.
- **`--pw-` is this screen's CSS namespace.** `replay_premium.js` audits every one in both
  directions and rejects any that strays into another screen's prefix.

## Testing the gate

In `web-demo/index.html`, set the **Subscription** picker to **Free**:

- every Home tile lands on **"Start Your 7-Day Free Trial"**;
- Back from the paywall returns to Home;
- Profile still opens, and **Sign out** still works;
- switching the picker to **Trial**, **Active** or **Grace** opens everything normally;
- switching it back to **Free** *while standing inside the Puzzle Hub* bounces to the paywall on the
  next paint — that is the `render()` backstop, and it is the case a tap-time-only gate misses.

## Testing before the product exists

Until the four App Store Connect steps below are done, `Product.products(for:)` returns an empty
list, the paywall can only render "Store Unavailable", and — because nothing in the app opens
without an entitlement — there is no way for a tester to see any of it.

So `PremiumStore.recompute()` grants `.premium(trial: false)` whenever `BiyaherongBuild.isTestBuild`
— which is now **only** the Debug configuration and the two CI test workflows. The default is
`false`: an archive that is told nothing charges.

That default used to be the other way round, and the reason it changed is worth keeping.
`tools/ship/ship_testflight.sh` sets no build settings at all, so under the old sense the repo's
documented one-command ship uploaded a build with a granted subscription and a simulated sign-in,
silently, every time. Both ship paths now read the effective build settings back and **refuse** if
the test flag is present; the two test workflows refuse if it is absent. See
[`account.md`](account.md).

The switch is a runtime Bool handed down from the app target, not a `#if` in this package: a
compilation condition set on the Xcode project never reaches a SwiftPM package's targets, which is
why two earlier attempts at this had no effect on the device at all. See [`account.md`](account.md).

## Before this can ship

These must happen in **App Store Connect** and the Developer portal, and none of them can be done
from this repo:

1. **Enable In-App Purchase on the App ID**, then **delete and recreate the provisioning profile**.
   A profile snapshots the App ID's capabilities when it is minted; it cannot be refreshed into
   having a new one. Nothing in this repo verifies IAP is enabled, unlike the triple-checked Sign in
   with Apple entitlement.
2. Create the subscription group and **both** products, with IDs matching `PremiumStore.Plan`
   **exactly** — `…plus.monthly` and `…plus.yearly`, namespaced under the app record.
   `replay_premium.js` checks the local `Biyaherong.storekit` against the Swift, but nothing here
   can see App Store Connect.
3. Set the prices: **$1.99** and **$19.99** USD as the base, Apple converting per storefront. In the
   Philippines that lands near ₱119 and ₱1,190 — above the ₱99 the old RN app charged, which is a
   product decision, not an accident.
4. Add the **7-day free trial** introductory offer **to both products**.
5. **Enable the billing grace period**, so a card that fails does not end the subscription instantly.
   `Entitlement.graceDays = 7` assumes it.
6. **Submit both IAPs for review alongside the build that contains them** — not after. Because the
   app is fully gated, an unconfigured product means `Product.products(for:)` returns empty, the
   reviewer sees "Store Unavailable", and there is literally nothing else to look at. That is a
   rejection with no code involved.
7. **App Review notes**: say the app is subscription-only, that a sandbox account is needed, and
   that Sign in with Apple is the only sign-in.

### If the store will not load

`loadState == .failed` still renders the disclosure card and **Restore Purchases**, so both legal
links stay reachable and an existing subscriber can recover without a working product listing. It is
a bad screen, not a dead end.
