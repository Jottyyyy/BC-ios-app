import Foundation
import BiyaherongUI

// `swift run LoginMetricsCheck` — asserts the login screen's pure layer: the band budget against
// the shortest supported phone, the drift field's keep-out zones, the two colours of Apple's button
// that must never be retinted, the copy, and the whole session state machine (including its
// fail-closed branch) driven through an in-memory storage. Exits non-zero on failure.
let result = biyaherongLoginMetricsCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
