import Foundation
import BiyaherongUI

// `swift run PieceArtCheck` — asserts the SVG piece renderer against the twelve
// bundled files plus the grammar/paint/transform edge cases. Exits non-zero on failure.
let result = biyaherongPieceArtCheck()
print(result.summary)
exit(result.ok ? 0 : 1)
