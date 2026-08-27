# Pairing Manager (Book Two, spec §1.1–1.6, §1.10)

The offline tournament manager: create a Swiss or Round Robin event, add players, generate pairings,
enter results, read standings, share them. The **pairing algorithm** lives next door in
[`pairing-engine.md`](pairing-engine.md); this document covers the document model, the presentation
layer and the screens.

## Status

| Layer | State |
|---|---|
| Pairing engine (§1.7–1.9) | **done** — see [`pairing-engine.md`](pairing-engine.md) |
| Style extraction (§1.2–1.6) | **done** — `tournament_styles.json`, re-derived from the RN source |
| Metrics layer, JavaScript | **done** — 28 + 1,202 assertions |
| Document store, JavaScript | **done** — 72 assertions, 10 mutants |
| The three screens, web-demo | **done** — 120 assertions, 10 mutants; reachable from the Home tile |
| Metrics layer, Swift | **done** — generated; 774 constants + 110 strings |
| `PairingEngine.swift` | **done** — 1,030 expectations confirmed by `replay_pairing.js` |
| `PairingDocument.swift` (Core store) | **done** — document shape verified against the JS both ways |
| Acceptance criterion 4 (published FIDE example) | **done** — both published cases match exactly |
| The three screens, SwiftUI + `PhoneView` wiring | **done** — branch-verified; 122/122 mutants |
| §1.6 `ImageRenderer` share card | deferred — the plain-text share ships |

## What exists

### `tools/metrics/extract_tournament_styles.js` → `tournament_styles.json`

An AST walk over the three real React Native screens
(`../BYAHERONG-COACH-FRONTEND/app/(app)/user/tournaments/{index,create,[id]}.tsx`), producing 196
style blocks / 748 properties with **zero unresolved values**. Two capabilities the puzzle extractor
does not have:

- **Two StyleSheets per file.** `[id].tsx` declares `styles` and `shareStyles`; the share card is a
  separate design at ~90 % scale and merging them would silently overwrite half of each.
- **A colour-map walker.** `getTypeColor`/`getStatusColor`/`getTypeLabel` are pure
  `condition → string literal` maps, so the style-oriented walker returns `{}` for them. Without
  this, the six colours behind every badge and status dot would have been the only hand-typed
  numbers in the feature. They are recorded as **ordered** `when → value` lists because the order is
  the semantics — any status that is neither ongoing nor finished is gold.

### `web-demo/js/pairing-metrics.js`

Every number the screens draw. The four style blocks were generated from the extraction rather than
retyped, and `selfTestSource()` re-reads the JSON and compares all ~1,200 properties, so a drift in
either direction fails the gate. `STR` is the exception — copy is transcribed verbatim from §1.11.

### `web-demo/js/pairing-store.js`

The document and every mutation of it. Pure: storage is injected, so the whole layer runs in Node.

**The one decision worth knowing: aggregates are recomputed from the rounds after every mutation,
never patched.** The server incremented counters on a result and decremented them on an edit, and
three of the §7 defects are that pair drifting apart — bye points awarded after the tie-break pass
(#12), tie-breaks refreshed only when a round happened to complete (#11), results still editable
after the tournament ended (#17). Recomputation deletes the second representation, which is also why
Clear Result (#23) is the same code path as entering one.

## Key files

| Path | Role |
|---|---|
| `tools/metrics/extract_tournament_styles.js` | the AST walk |
| `tools/metrics/tournament_styles.json` | its committed output |
| `web-demo/js/pairing-metrics.js` | the presentation layer + `STR` |
| `web-demo/js/pairing-store.js` | the document, status, results, standings |
| `web-demo/js/pairing-engine.js` | pairing, Berger, tie-breaks |
| `web-demo/js/pairing-{list,create,detail}.js` | the three screens |
| `web-demo/css/pairing.css` | the stylesheet, entirely `var(--pg…)` |
| `tools/qa/pairing_screen_test.js` | the screens in a headless DOM |
| `tools/metrics/gen_pairing_metrics.js` | emits the Swift metrics + strings AND the JS geometry |
| `Sources/BiyaherongCoachCore/PairingEngine.swift` | the Foundation-only engine twin |
| `tools/qa/replay_pairing.js` | that Swift source vs the JS that ran |

## How to test

```bash
node tools/metrics/extract_tournament_styles.js    # re-derive from the RN source
node -e "console.log(require('./web-demo/js/pairing-store.js').selfTest().summary)"
node tools/qa/js_goldens.js                        # the full gate, all of the above registered
node tools/qa/pairing_screen_test.js               # the three screens in a headless DOM
node tools/qa/puzzle_core_mutation_test.js         # 110/110, including 29 pairing mutants
```

## The §7 defects, and where each is answered

| # | Defect | Where |
|---|---|---|
| 1 | duplicate seeds after a removal | `removePlayer` renumbers densely; 2 mutants |
| 2 / 3 | Buchholz/SB in integer columns, `score` as `decimal:1` | `Double` throughout; `formatScore` gives `1` / `1½` |
| 4, 5, 6, 8, 9, 10, 11, 13 | the pairing algorithm itself | the engine — see `pairing-engine.md` |
| 7 | bye on board 1 from round 2 | always the last board; mutant |
| 12 | bye points awarded after the tie-break pass | decided at generation; 2 mutants |
| 17 | results editable after `finished` | status computed; lock + the clearing exception |
| 23 | no way to clear a mistaken result | `clearResult`, same path as `setResult` |
| 14 | rank-1 gold defined but never applied on screen | applied in both; mutant |
| 15 | the players tab showed the row index as the seed | shows `player.seed`; mutant |
| 16 | `sort()` mutated React state during render | sorted copies (see the note below) |
| 18 | delete responses never checked | confirm first, then mutate; mutant |
| 19 | a failed fetch left a permanent spinner | empty state for a deleted tournament; mutant |
| 20 | the result badge fell through to `½-½` | exhaustive; unrecognised returns `null`; mutant |
| 21 | `created_at` rendered UTC through a local formatter | epoch ms + the device calendar |
| 22 | the share text embedded an ngrok URL | no URL anywhere in either share text; mutant |

## Deviations

Two, both recorded in `PORTING_NOTES.md`: SwiftData `@Model` becomes plain `Codable`, and "results
are locked when finished" admits **clearing** as its one exception — taken literally, the lock and
the new Clear Result button cannot both exist, because finishing is caused by the last result being
entered.

## Three things the checks caught that review had not

Worth keeping, because each is a class of mistake rather than a one-off.

1. **Three CSS vars I invented.** The `--pg` audit rejects any `var(--pg…)` the metrics layer does
   not push. It found that the gap between two players on a pairing row is on `pairingPlayer`, not
   `pairingPlayers`; that `standingsPts` inherits its size from `standingsVal`; and that the
   **standings column widths are inline styles**, invisible to the block walker — `standingsVal.width`
   is 42 for every column, which is wrong for five of the six. They are extracted from `inlineStyles`
   now and asserted there.

2. **The seed mutant survived, correctly.** Fix #15 says show `player.seed`, not the row index. While
   the list is in seed order with dense seeds those are the same number, so the fix was
   unobservable and the mutant could not die. The players tab now sorts by score once play starts —
   what the RN screen did, and the situation the bug shipped in — and the two diverge.

3. **Two survivors were unfalsifiable, not uncovered.** Sorting a freshly-parsed array in place
   changes nothing observable, because the screen re-reads the document on every paint. And the
   blank-name path is guarded twice, independently, so deleting either guard changes nothing. Both
   are documented in the mutant table rather than left as false survivors — and the second pointed
   at a real hole, since the store's own guard had no test until it did.

## How a tournament is deleted, and how that hid

**Long-press a card**, then confirm. The list footer says so: `"Long press a card to delete"`, which
is what `tournaments/index.tsx:174` shows as the `FlatList`'s `ListFooterComponent`. Nothing is
removed until the modal is confirmed — spec 7 #18, because the RN fired the request and dropped the
row without reading the response, so a 422 looked like success.

A client reported that there was **no way to delete a tournament**. There was, and it had been ported
whole — store, modal, gesture, hint. What was missing was one modifier: `list` in the RN is
`{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 90 }`, and the Swift applied the first two.

That 90 is not decoration. The list and the "New Tournament" button share a `ZStack`, so the button
floats *over* the scroll content, and 90pt of bottom padding is what keeps the content clear of it.
Without it the last element in the ScrollView sits underneath the button — and the last element is
the hint. The delete gesture had no discoverable documentation, which is indistinguishable from not
existing.

The browser never had the bug: `.pgl-list` is a three-value `padding` shorthand, so `web-demo/`
showed the hint from the start. That is the recurring shape on this checkout — **the JS twin being
right is not evidence about the Swift**, and no gate read the Swift closely enough to disagree.
`tools/qa/swift_padding_check.js` now does: a block the Swift renders may not have lost one of its
extracted padding sides.

## Acceptance criterion 4 — met

The official handbook chapter C.04.3 is **purely normative and contains no worked example**
(checked directly), so the corpus comes from `bbpPairings` (Apache-2.0) instead — `dutch_2025_C5`
and `dutch_2025_C9`, named for the C.04.3 criteria they exercise.

Both match **exactly**, board for board and colour for colour, with no warnings. That was not a
foregone conclusion: this engine prices FIDE's rules as costs and solves for the cheapest whole
round, where FIDE's text walks a specific transposition/exchange order, and the two are not
guaranteed to agree. On these cases they do — including one where the nominal Dutch pairing is
blocked by a rematch, and one where the bye must skip a player who already had one.

See `tools/qa/fide_dutch_test.js`; each source TRF is quoted there so the reconstruction is
auditable.

**The one thing the engine cannot express.** Both TRFs use `0000 - Z`, a pre-assigned ZERO-POINT bye
for a player unavailable that round. This engine has no concept of one: it allocates a bye itself,
always worth a full point, with no way to mark a player unavailable or score a bye at zero. The
fixtures encode the Z faithfully for these positions, but the general feature is genuinely missing.
