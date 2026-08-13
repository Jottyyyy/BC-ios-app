import Foundation
import BiyaherongUI

// `swift run CoachMetricsCheck` — asserts Play vs Coach's derived layer: the folded avatar geometry,
// the roster and its clamping, the accent lookup, and the handful of values that are NOT extracted.
// Exits non-zero on failure.
//
// It deliberately does NOT re-check the 782 raw constants. `tools/metrics/gen_coach_metrics.js`
// emits `CoachMetrics.swift` and the JS twin from one extraction in one pass, so there is no
// transcription step between them for a typo to live in.
let result = biyaherongCoachMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
