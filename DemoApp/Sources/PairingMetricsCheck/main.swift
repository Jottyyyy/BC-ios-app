import Foundation
import BiyaherongUI

// `swift run PairingMetricsCheck` — asserts the Pairing Manager's derived layer: the type and status
// colour maps including their fallbacks, the chess-notation score formatter, the badge tint byte and
// the standings comparator. Exits non-zero on failure.
//
// It deliberately does NOT re-check the 774 raw constants. `tools/metrics/gen_pairing_metrics.js`
// emits `PairingMetrics.swift` and the JS twin from the same extraction in the same pass, so there
// is no transcription step between them for a typo to live in.
let result = biyaherongPairingMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
