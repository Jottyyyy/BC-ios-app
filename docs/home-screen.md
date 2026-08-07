# home-screen — the app's landing dashboard

A dark-navy, **never-scrolling**, single-viewport dashboard: a header, a 3×2 grid of six equal cards, an
hourly-rotating Taglish quote, and two bottom banners. It is the first tab of the phone app.

It is **presentation only** — no networking, no persistence, no navigation. Every dynamic value is a view
input and every tap is a closure the caller supplies, so the screen is a pure function of its arguments.

Ported from the React Native app's `app/(app)/user/home.tsx` in the sibling
`../BYAHERONG-COACH-FRONTEND` repo — from its real StyleSheet numbers, not from prose.

- **Run it (Windows):** open `web-demo/index.html`. Home is the default tab. The hero bar above the phone
  has **Device**, **Home theme** (Sky / Colorful) and **Membership** (Free / Premium) pickers.
- **Run it (macOS):** `cd DemoApp && swift run DemoApp` → the **Phone UI** panel. The Sky/Colorful picker
  sits above the phone frame.
- **Assertions:** `cd DemoApp && swift run HomeMetricsCheck` (macOS) or
  `node -e "console.log(require('./web-demo/js/home.js').selfTest().summary)"` (anywhere).

## The four bands

```
┌──────────────────────────────────────┐
│  avatar · logo · search              │  fixed height
├──────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐          │
│  │  card 1  │  │  card 2  │          │  ← row 1
│  ├──────────┤  ├──────────┤          │
│  │  card 3  │  │  card 4  │          │  ← row 2   GRID: takes ALL
│  ├──────────┤  ├──────────┤          │            remaining height
│  │  card 5  │  │  card 6  │          │  ← row 3
│  └──────────┘  └──────────┘          │
├──────────────────────────────────────┤
│  " quote of the hour "     — Coach   │  fixed height
├──────────────────────────────────────┤
│  [ ♟️ Donate ]      [ ⭐ Premium ]    │  fixed height
└──────────────────────────────────────┘
```

The header, quote strip and banner row are **fixed heights computed up front**; the grid is the only
flexible band. It takes exactly the leftover, then splits it into three equal rows of two equal tiles.

Two things about that are worth knowing before touching the layout:

- **The tiles carry an explicit `.frame(width:height:)`, not `.frame(maxHeight: .infinity)`.** A flexible
  frame lets a child return *more* than the height proposed to it, so one card whose intrinsic content
  exceeded its third would overflow the stack and quietly steal height from the other two rows. All six
  tiles are built from one `HomeTileSize` value, which is what makes "six pixel-identical cards" true by
  construction rather than by inspection. `3·h + 2·gap == gridHeight` is an exact identity the self-check
  asserts.
- **The quote strip is pinned to its two-line height, not hugging.** The quote rotates hourly and the lines
  differ in length, so a hugging strip would be one line tall for some quotes and two for others — which
  would change the grid's leftover and silently resize all six tiles at the top of an hour.

### When the design does not fit

**The design is over-constrained inside a tab bar, on every device — not just small ones.** The original RN
home screen is a full-height Stack screen with no tab bar; hosting it as tab 0 here costs ~74 pt, which
comes straight out of the grid. A 4.7" phone ends up with ~74–93 pt per row against the ~115 pt the full
card content wants, and even a 6.7" phone is short of the design's 72 pt icon.

Something has to give, and the order is deliberate: **the icon slot shrinks first, the card's internal gap
second, and text is never clipped.** In practice the artwork renders at roughly 50–75% of its nominal
`iconSize` — smallest on the two cards with hard-broken two-line titles (Play with Coach, Pairing Manager),
largest on the four standard cards. Everything else — type sizes, padding, gutters, the grid — is exactly
the spec.

Verified across 7 devices × 2 themes: no title, subtitle or CTA is ever cut off, the six tiles stay
identical to within 0.016 px, row pitch stays equal, and nothing scrolls.

If full-size icons matter more than the tab bar, the fix is structural rather than a tweak: make the home
screen the app root without a tab bar, as the original does. That would need a way back from the six
destinations, which this screen deliberately does not have.

## The two themes

One boolean, `isColorful`. It changes **only** fills, borders and the icon treatment — never the geometry.

| | Sky (default) | Colorful |
|---|---|---|
| Card fill | `#162D4A` for all six | per-card saturated fill |
| Card border | 1 pt `rgba(74,159,232,.12)` | removed (a hairline on a saturated fill reads as a dirty edge) |
| Icon | inside a circular backdrop, drawn at 67% | bare, drawn at 100% |
| Subtitles | `#8BA3C7` | `rgba(255,255,255,.88)` — the muted blue-gray disappears on green/orange/pink/teal |

Toggling causes **zero layout shift**. Two mechanisms do that: the icon lives in a slot that is explicitly
framed to the same size in both themes (so the larger bare icon cannot grow it), and the border is an
`.overlay(...)` toggled with `Color.clear` rather than a layout-participating inset.

**One documented exception (§6c):** in Sky, the Pairing card's icon backdrop is solid teal `#00BFA5` instead
of the standard translucent blue — the swiss artwork is otherwise too low-contrast to read.

**One precedence rule that must not be violated:** a premium user's gold banner **always** outranks the
Colorful purple, in both themes. The gold state is the reward and it always wins.

## Key files

| File | Role |
|---|---|
| `DemoApp/Sources/BiyaherongUI/HomeMetrics.swift` | **The pure layer** — responsive scale, band heights, tile geometry, palette, card matrix, quote rotation, expiry formatting, banner precedence. No view code. |
| `DemoApp/Sources/BiyaherongUI/HomeScreen.swift` | The screen: four bands, the grid, one tile, the bespoke Play-with-Coach card. |
| `DemoApp/Sources/BiyaherongUI/HomeParts.swift` | Header trio, quote strip, banners, the press-feedback `ButtonStyle`. |
| `DemoApp/Sources/BiyaherongUI/HomeArt.swift` | Bundled card artwork loader + `HomeCardIcon` / `HomeAppIcon`. |
| `DemoApp/Sources/BiyaherongUI/HomeMetricsCheck.swift` | The runnable self-check (no XCTest in this toolchain). |
| `DemoApp/Sources/BiyaherongUI/Images/` | The six art assets. Declared `.copy` in `Package.swift`, so **every lookup passes `subdirectory: "Images"`**. |
| `DemoApp/Sources/BiyaherongUI/PhoneView.swift` | Hosts it as tab 0 and supplies the scale basis. |
| `web-demo/js/home.js` | The browser mirror. Its top half is a line-for-line port of the pure layer. |
| `web-demo/css/app.css` (`---- Home ----`) | The mirror's styling, on `css/theme.css` tokens. |

## Inputs

| Input | Drives |
|---|---|
| `userName` | The avatar's fallback initial (`?` when empty) |
| `profileImage` | The avatar; when nil → a gold circle with the initial in navy |
| `isPremium` | The avatar's ✈️ badge and the membership banner's state |
| `subscriptionEndsAt` | The membership subtitle; when nil while premium → `Active subscription` |
| `isColorful` | Which theme renders |
| `scaleBasis` | The size the responsive scalar derives from — see below |

Plus ten tap callbacks (avatar, search, six cards, two banners), all defaulting to `{}`.

**`scaleBasis` is not cosmetic.** The host passes the whole phone shell, matching the original's
`Dimensions.get('window')`. Deriving the scalar from the screen's own box instead would make every icon and
font ~19% smaller than the design, because that box is already inset by the safe areas and the tab bar. The
*layout* still uses the real container — only the scalar differs.

The empty/loading appearance is the correct first paint, not an error state: `?` on gold, no badge,
`Go Premium / Unlock everything`, and the quote and all six cards rendering normally. No spinners, no
skeletons, no shimmer anywhere on this screen.

## The quote of the hour

`index = floor(epochSeconds / 3600) % 20` over 20 Taglish one-liners. Not random, and all three consequences
are intended: it is identical for every user in the same hour, stable across re-renders so it never re-rolls
on redraw, and it advances by exactly one on the hour. Rotation keys off **UTC** hour boundaries, matching
the original's `Date.now() / 3_600_000` — in a half-hour-offset zone like IST it turns over at :30.

**Deliberate deviation:** the refresh is aligned to the hour boundary (`TimelineView(.periodic(from:
hourStart, by: 3600))`) rather than the original's naive `setInterval(…, 3_600_000)` on focus. Because the
index only changes *on* a boundary, a timer at an arbitrary phase leaves the displayed quote up to 59
minutes stale relative to its own definition. The quote is derived from the tick's date, never a counter, so
a late tick can only delay when the change is noticed — it can never desynchronise the text from the hour.

## Gotchas

- **The "SVG" icons were never vectors.** In the RN app, `analysis.svg` and `video_icon.svg` were each a
  three-line `<svg>` wrapping a base64 `<image>`, so the `fill="#FFFFFF"` passed to them was already a
  no-op. `SVGVector` rejects `<image>` outright, so those payloads were decoded back to the PNGs they always
  were. Do not "restore" them to SVG.
- **`opening_book.svg` has its alpha baked into 8-digit hex.** `SVGVector` only reads `fill`, `stroke`,
  `stroke-width`, `stroke-linecap` and `stroke-linejoin` — `opacity`, `fill-opacity` and `stroke-opacity`
  are never read. A verbatim copy of the RN file parses "successfully" but paints a solid-black knight.
- **`.italic()` is a silent no-op on Nunito** — no italic face ships, so the quote uses
  `Theme.nunitoItalic`, a real synthetic oblique via a CTFont matrix.
- **No numeric literal or arithmetic belongs in a view body.** Every number is a stored property or a pure
  function from `HomeMetrics.swift`. That rule is the only reason `HomeMetricsCheck` can assert the layout
  without a renderer — break it and coverage drains out silently.
- **Adding art** means dropping the file in `Images/` **and** keeping the count check in
  `Diagnostics.swift` honest. A missing `Package.swift` resource entry fails silently at runtime and only
  inside a packaged app; `BIYA_DIAG=1` is what catches it.

After any change here, log it in [`../CHANGELOG.md`](../CHANGELOG.md) and keep `web-demo/js/home.js` in
lockstep — a divergence between the two pure layers is exactly what the mirror exists to catch.
