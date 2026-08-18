# Navigation chrome — one back icon, one menu icon, both languages

The back button and the hamburger, everywhere in the app. One drawing, one set of numbers, two
renderers.

- **Swift** — [`DemoApp/Sources/BiyaherongUI/NavIcons.swift`](../DemoApp/Sources/BiyaherongUI/NavIcons.swift)
- **Browser** — [`web-demo/js/icons.js`](../web-demo/js/icons.js) + `.nav-icon` in `web-demo/css/app.css`
- **Gate** — [`tools/qa/nav_icons_check.js`](../tools/qa/nav_icons_check.js)

## What it replaced, and why that mattered

Both icons were **text glyphs**: `←` (U+2190) and `☰` (U+2630), drawn at 22 pt in Nunito — a font
that contains neither, so each fell back silently to whatever face the platform picked. `☰` is the I
Ching trigram for heaven, not a hamburger: thin bars, uneven gaps. Neither had a tap surface or a
pressed state. `CoachLayout.swift` had been honest about it all along — *"icons that happen to be
characters"*.

The second problem was worse and nobody could see it. Swift drew `Image(systemName: "chevron.left")`
on the shared puzzle header, Puzzle Hub, Streak and the Paywall, while the browser drew `←` on those
same screens. **The two languages had visibly diverged and not one assertion anywhere named a glyph,
an icon or a button class.** Grepping `tools/qa/` for `hbtn`, `☰`, `←`, `headerBtn` or `backBtn`
turned up only numeric metric parity.

So the fix is not "swap 42 glyphs". It is: one component per language, drawn from one geometry,
adopted at every site, and pinned.

## The geometry

`NavIcon` (Swift) ↔ `GEO` (JS), in a 24×24 design box, asserted equal number for number:

| | value | why |
|---|---|---|
| `box` | 24 | the design box; every path scales out of it |
| `stroke` | 2 | round caps and joins, the weight `app.js`'s undo/flip icons already use |
| `chevronX` · `chevronApex` | 9 · 15 | **not** symmetric — a chevron's visual mass is at its apex, so equal insets read as shifted right |
| `chevronTop` · `chevronBottom` | 5 · 19 | straddles the vertical centre |
| `barInset` · `barTop` · `barGap` | 4 · 7 · 5 | three bars, equal weight, equal gaps — `barTop + barGap == 12`, so the middle bar sits exactly on the centre line, which is the thing `☰` never did |

## Two decisions worth knowing

**`Shape`, not an SVG asset.** `SVGVector.swift` already renders SVG for the piece art, but it
deliberately rejects `currentColor`, and these icons must take each screen's own tint — pairing's
gold, coach's white, analysis's off-white. Hand-built paths (the `BoardArrows.swift` precedent) also
mean both languages compute from the same constants, which an asset could not guarantee.

**The 44 pt minimum is applied to WIDTH only.** Apple's guideline is 44×44, but the Analysis header
is 36 pt tall and a 44 pt-tall button inside it spills 4 pt over the board's top rank — measured in
the browser, where it would have stolen taps from a8–h8. Every screen's own frame is already 36–44
tall; width is the axis that was actually cramped, with several buttons at 40.

## How each side uses it

```swift
NavIconButton(.back, size: CoachSelect.backIconFontSize,
              tint: CoachSelect.backIconColor, action: onExit)
    .frame(width: CoachSelect.backBtnWidth, height: CoachSelect.backBtnHeight)
```

```js
var back = el('button', 'cgs-back nav-icon');
back.innerHTML = BiyaIcons.back();
```

⚠ **`innerHTML`, never `el()`'s third argument.** In every browser screen file except `analysis.js`
that argument is assigned to `textContent`, so an SVG string passed there is inserted as literal
text and draws nothing at all. That is exactly what happened on the first pass; only the browser
caught it, and `nav_icons_check.js` now pins it.

**Every screen keeps its own frame.** `CoachSelect.backBtnWidth` (44), `PairingList.backBtnWidth`
(40) and the rest are extracted StyleSheet values sitting next to `backBtnJustifyContent` — the
component replaces the glyph *inside* the button and never the button's box. On the browser side
`stroke="currentColor"` means every existing per-class `color:` rule keeps working untouched.

## Scope

**In:** back, on all 20 Swift sites and all 24 browser sites — Profile joined both when the tab
bar was removed and it needed a way out — and the hamburger, which exists on
exactly one screen, the Analysis Board, in each language.

**Out, by explicit choice:** the nine Analysis toolbar emoji (📂 ✏️ 💡 🔄 ▶), the four transport
arrows (⏮ ◀ ▶ ⏭, still `CoachGlyph`), and the ☰ menu's own `✕`.

Home's `🔍` was on that list too, and is now moot: the client asked for the search button itself to
go, so there is no glyph left to vectorise. `tools/qa/home_chrome_check.js` bans it from returning.

Two glyph tables lost their `back` entry and were retired with inverted assertions:
`CoachGlyph.back` (`CoachMetricsCheck` now asserts **four** transport glyphs and that `back` is not
among them) and `PairingStrings.back`, which is *generated* from `pairing-metrics.js`'s `STR` by
`tools/metrics/gen_pairing_metrics.js` — removed at the source and regenerated.

## Four latent bugs fixed on the way through

All pre-existing, all inside the diff anyway:

- `.pzd-back` hardcoded `40px/40px/24px` with no CSS variables — across **five** screens.
- `.pzp-back` read `--pzh-back-*`, which its own screen never published; the button was unsized
  unless the Hub had rendered first.
- `PuzzleHubScreen` sized its back button from `PuzzleHub.chevronLineHeight` — the **list-row**
  chevron's line height — while the browser fed `--pzh-back-fs` from `PuzzleType.hubBackIcon`. Both
  are 24, so nothing moved; it just stopped being a coincidence.
- `coach-select.js` read `STR.backArrow`, undefined everywhere, and fell through to a literal.

The first two are fixed by construction: `.nav-icon` owns the box, the centring and the icon size.

## How to test

```bash
node tools/qa/nav_icons_check.js     # ~1000 invariants; also runs inside js_goldens.js
node tools/qa/js_goldens.js
```

Then open `web-demo/index.html` from a local server and walk every screen with a back button —
Analysis, Puzzle Hub, all five solvers, Play vs Coach (select / colour / play), Pairing list /
create / detail, Paywall. Each should show a crisp chevron in **that screen's** colour, centred in
its existing frame, dimming on press. The Analysis Board is the one screen that also shows the
hamburger.

On a Mac: `swift run DemoApp`, then the same walk.
