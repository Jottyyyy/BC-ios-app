# login — the app's first screen

A dark-navy, **never-scrolling**, single-viewport gate: the Biyaherong brand mark under a gold ring and
glow, the app name and tagline, one **Continue with Apple** button, and a bundled Privacy · Terms sheet.
Faint chess pieces drift behind it. It is the first thing the app shows, and after the first sign-in it is
never shown again until the user signs out from Profile.

**The Apple sign-in is SIMULATED.** There is no `AuthenticationServices` call, no `URLSession`, no network
of any kind — tapping the button writes one string and publishes. That is deliberate twice over: it is what
was asked for, and it keeps the "100% offline" claim in `ios/project.yml:69-71` (and the export-compliance
`NO` that rests on it) true. Everything a real Sign in with Apple needs sits behind one method,
`LoginStore.signIn(_:)`. See [`../PORTING_NOTES.md`](../PORTING_NOTES.md) for the App Store consequence.

This screen has **no counterpart in the React Native app** — the original's `(auth)/login.tsx` is a
username/password form against a Laravel API. So most of its numbers are invented, not extracted, and
`PORTING_NOTES.md` carries the table. What *is* taken from the source: the whole palette (via `Theme`), the
legal footer's `#3A5070`, the 24pt screen gutter, the hero copy verbatim, and the 0.5 title tracking.

- **Run it (Windows):** open `web-demo/index.html`. The login screen is the first thing you see. Tap
  **Continue with Apple** → the dashboard. Reload → straight to the dashboard (the session persisted).
  **Profile → Sign out** returns you here. Clear the key with
  `localStorage.removeItem('biya.auth.session.v1')` in the console to see it fresh again.
- **Run it (macOS):** `cd DemoApp && swift run DemoApp` → the **Phone UI** panel. The gate lives inside
  `PhoneApp`, so it shows in the desktop phone frame exactly as it does on device.
- **Assertions:** `cd DemoApp && swift run LoginMetricsCheck` (macOS) ·
  `node -e "console.log(require('./web-demo/js/login.js').selfTest().summary)"` (anywhere) ·
  `node tools/qa/replay_login.js` (the Swift-vs-JS replay, which is the real gate on Windows).

## The four bands

```
┌───────────────────────────────┐
│  ♟   ✦        ♞         ✦     │  DRIFT   8 faint real pieces, slow float,
│      ╔═══════════╗      ♜     │          frozen under Reduce Motion
│  ✦   ║   LOGO    ║            │  HERO    124pt squircle, gold ring + glow
│      ╚═══════════╝     ✦      │          64pt from the top
│      Biyaherong Coach         │          gold, Nunito ExtraBold 30
│   Kabiyahe mo sa pag improve! │          muted 14
│  ♜        ✦            ♟      │
│                               │  SPACER  the larger flexible band (floor 24pt)
│ ┌───────────────────────────┐ │  ACTION  white pill, 54pt, black  + label
│ │    Continue with Apple    │ │
│ └───────────────────────────┘ │
│  Walang password — i-tap lang!│          muted 13
│        Privacy · Terms        │  FOOTER  #3A5070, opens a bundled sheet
└───────────────────────────────┘
```

The bands are fixed heights adding to 413pt (`LoginLayout.fixedHeight()`); both self-checks assert that
413 plus the 24pt spacer floor still fits an iPhone SE's 667pt. **A login screen that scrolls is a bug,
not a layout.**

**The leftover is split 35 / 65, not all dumped below the hero.** `LoginLayout.spacerTopShare` sends 35%
of it *above* the hero, which is why the logo lands at ~32% of the screen on a 667pt phone and an 852pt
one alike. Pinning the hero to its 64pt floor instead — the first version — left ~400pt of nothing between
the tagline and the button on a tall phone, and read as two disconnected clusters. Swift computes the
split in `LoginLayout.heroTop(screenHeight:)`; the browser spells the identical rule as `flex-grow: 35`
and `65` over a zero basis. Both self-checks assert the two shares add back up to exactly the leftover.

## Three things worth knowing before touching it

- **The Apple button is the white variant, and it is never retinted.** White-on-dark is what Apple's
  guidance calls for on a dark background, and the mark stays pure black on pure white. Both self-checks
  assert those two colours as absolutes, not just as a Swift/JS match — "both languages agree it is gold"
  would still be wrong.
- **Its label is the system font, not Nunito.** The one typography exception in the app, in both languages.
  The real `ASAuthorizationAppleIDButton` that will replace this renders in San Francisco, so matching it
  now means the control does not visibly change size when the simulation goes away.
- **The gate is the LAST `ZStack` sibling in `PhoneApp`**, not a `.fullScreenCover` — that does not exist
  on macOS, and this view renders inside the desktop phone frame. Last, so it covers all
  three pushed routes (Analysis, Pairing, Play vs Coach).

## The session

One string under `biya.auth.session.v1`, holding the provider id (`"apple"`).

**It fails closed.** `LoginSession.isSignedIn(_:)` only recognises values in `LoginSession.providers`;
`nil`, `""`, `"0"`, `"APPLE"`, `" apple"` and anything else all read as signed out, and `LoginStore`
refuses to persist a provider the predicate does not know. A half-written or hand-edited key shows the
login screen rather than letting someone past it. Signing out **removes** the key rather than blanking it,
so a later read is a clean miss and not a value the predicate has to special-case. Both mutations are
idempotent, which the self-checks assert by write/removal count.

Storage is injected — `CoachGame.Storage` in Swift (reused, not re-declared: it is already the repo's
"anything that can hold a string by key"), a `getItem`/`setItem`/`removeItem` object in JS. That is what
makes the whole machine testable with no `UserDefaults` and no `localStorage`, and the JS wraps every
access in `try/catch` because `localStorage` throws on some `file://` configurations — a login screen that
cannot read a key must still open.

## Key files

| File | Role |
|---|---|
| `DemoApp/Sources/BiyaherongUI/LoginMetrics.swift` | The pure layer: band budget, palette, type scale, drift table, timings, copy, the session predicate. **Every number the screen draws.** |
| `DemoApp/Sources/BiyaherongUI/LoginScreen.swift` | The view — `LoginScreen`, `LoginAppleButton`, `LoginGlow`, `LoginDriftLayer`, `LoginLegalSheet`, and `LoginArt` (the string→`Piece` mapper). No numeric literal in any body. |
| `DemoApp/Sources/BiyaherongUI/LoginStore.swift` | The session, persisted behind an injected `CoachGame.Storage`. The one seam a real Apple sign-in replaces. |
| `DemoApp/Sources/BiyaherongUI/LoginMetricsCheck.swift` | The runnable self-check (no XCTest in this toolchain). |
| `DemoApp/Sources/LoginMetricsCheck/main.swift` | `swift run LoginMetricsCheck`. |
| `DemoApp/Sources/BiyaherongUI/PhoneView.swift` | The gate (`PhoneApp`, last ZStack sibling) and the Profile screen's **Account** card. |
| `DemoApp/Sources/BiyaherongUI/HomeArt.swift` | `HomeArt.Asset.brandLogo` and the generalised `HomeAppIcon(size:shape:asset:)`. |
| `DemoApp/Sources/BiyaherongUI/Images/brand-logo.png` | The brand mark, copied from the RN app's `assets/images/icon.png`. |
| `web-demo/js/login.js` | The browser twin — the same pure layer, the same store, plus the DOM renderer. |
| `web-demo/js/app.js` | The boot gate (`current = … ? 'home' : 'login'`), `renderLogin`, `finishSignIn`, `signOut`, and the Profile Account card. |
| `web-demo/css/app.css` (`---- Login ----`) | The styles, driven entirely by `--lg-*` custom properties the JS sets from the one table. |
| `tools/qa/replay_login.js` | Swift source vs the JS twin, plus the offline / script-order / stylesheet / CSS-variable guards. |

## How to test

```bash
node tools/qa/replay_login.js     # Swift vs JS, and the four wiring guards
node tools/qa/js_goldens.js       # the full suite; both login suites are registered in it
node tools/qa/swift_lint.js       # brackets + public-exposes-internal, no arguments
node tools/qa/swift_symbol_check.js
node tools/qa/swift_layout_check.js
# then open web-demo/index.html, and web-demo/index.html?selftest for the in-page run
```

On a Mac: `swift build && cd DemoApp && swift run LoginMetricsCheck`, then `swift run DemoApp`.

## Gotchas

- **`Diagnostics.swift` hard-counts the PNGs in `Images/`.** It expects **6** now. Adding or removing art
  there without updating that count makes the diagnostics warn on every launch — which is the point, but
  update it deliberately.
- **`--lg-` is this screen's CSS namespace.** `--pz*`, `--pg*`, `--cg*` and `--an-*` belong to other screens
  and have their own audits. `replay_login.js` asserts every `--lg-*` is both set by the JS and read by the
  CSS, in both directions.
- **The drift table is fixed, never randomised.** A background that differs run to run cannot be asserted
  at all, and this repo models non-determinism as injected data rather than reproduced RNG.
- **The legal sheets are bundled text, never links.** `replay_login.js` fails on any `http`/`https` in the
  feature, in either language.
- **At most one legal sheet, ever.** The Swift holds a single optional `legalTopic`, so tapping Terms over
  Privacy swaps it. The browser appends a node and *will* stack them without an explicit removal — it did,
  until a click-twice in a real browser found it. `legalSheet()` removes any open sheet first, and
  `replay_login.js` asserts both halves of that shape.
