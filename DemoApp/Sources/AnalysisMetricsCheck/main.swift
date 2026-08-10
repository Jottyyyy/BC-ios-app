import Foundation
import BiyaherongUI

// `swift run AnalysisMetricsCheck` — asserts the Analysis Board's pure layer: the board geometry and
// its pixel snapping, the coordinate flip, arrow and badge geometry, the eval bar and graph, the
// display tables, and that the seven bands fit on the smallest supported screen. It then checks
// those constants against tools/metrics/board_styles.json, extracted from the real React Native
// source. Exits non-zero on failure.
let result = biyaherongAnalysisMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
