import Foundation
import BiyaherongUI

// `swift run HomeMetricsCheck` — asserts the home screen's pure layer: the responsive scale and
// every derived size, the tile identity behind the six equal cards, the icon clamp, the hourly
// quote rotation, expiry formatting and the premium-outranks-colorful rule. Exits non-zero on
// failure.
let result = biyaherongHomeMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
