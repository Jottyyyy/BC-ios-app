# subscription — one monthly plan, a 7-day trial, and no server

A single auto-renewing **monthly** subscription with a **7-day free trial**, verified entirely
**on-device by StoreKit 2**. No backend, no accounts, no receipt POST. Below it sits a genuinely
playable **free tier**, and the paywall is reached **on demand** — the "⭐ Go Premium" banner, or a
cap the user just hit — never as a wall in front of a new install.

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

## Free vs premium

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
  prices in one session.
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

## Before this can ship

Four things must happen in **App Store Connect**, and none of them can be done from this repo:

1. Create the subscription group and the monthly product, with the product ID matching
   `PremiumStore.monthlyProductID` **exactly** — it is namespaced under the app record.
2. Add the **7-day free trial** introductory offer.
3. Set the price.
4. **Enable the billing grace period**, so a card that fails does not end the subscription instantly.

The IAP must also be submitted for review alongside the first build that contains it.
