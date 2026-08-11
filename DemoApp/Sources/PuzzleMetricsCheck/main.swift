import Foundation
import BiyaherongUI

// `swift run PuzzleMetricsCheck` — asserts the Puzzle Hub's presentation layer: the derived bottom
// panel and info strip, which screens have an engine panel or a Save sheet, both clock formatters,
// the Turbo colour bands, the feedback dot's signed geometry, the sound tables and the two
// promotion dialogs. Exits non-zero on failure.
//
// It deliberately does NOT re-check the ~1,000 raw constants: `tools/qa/replay_puzzle_core.js`
// already compares those with the JS twin, which is itself asserted against puzzle_styles.json.
let result = biyaherongPuzzleMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
