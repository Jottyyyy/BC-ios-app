import Foundation
import BiyaherongUI

// `swift run PaywallMetricsCheck` — asserts the subscription's pure layer: the trial/expiry/grace
// state machine and every boundary in it, the monotonic clock floor, the round-UP day count, every
// free-tier cap (including that Puzzle Turbo is counted per mode), the store's fail-closed
// persistence, and the paywall copy App Review requires verbatim. Exits non-zero on failure.
let result = biyaherongPaywallMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
