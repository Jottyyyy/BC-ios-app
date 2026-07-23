import Foundation

/// Helpers that reproduce PHP comparison/truthiness semantics exactly, so ports of Laravel
/// Collection sorts and PHP boolean guards match the server bit-for-bit.

/// PHP `is_numeric` (PHP 8 semantics): optional surrounding whitespace, optional sign,
/// integer/decimal/float with optional exponent. Hex strings are NOT numeric (since PHP 7).
func phpIsNumeric(_ s: String) -> Bool {
    s.range(of: #"^\s*[+-]?((\d+(\.\d*)?)|(\.\d+))([eE][+-]?\d+)?\s*$"#, options: .regularExpression) != nil
}

/// PHP `<=>` under SORT_REGULAR for two strings (as Laravel `sortBy`/`sortByDesc` uses):
/// if BOTH are numeric strings → numeric comparison; otherwise byte-wise `strcmp` on UTF-8.
/// Returns -1 / 0 / 1.
public func phpRegularCompare(_ a: String, _ b: String) -> Int {
    if phpIsNumeric(a) && phpIsNumeric(b) {
        let da = Double(a.trimmingCharacters(in: .whitespaces)) ?? 0
        let db = Double(b.trimmingCharacters(in: .whitespaces)) ?? 0
        if da < db { return -1 }
        if da > db { return 1 }
        return 0
    }
    // byte-wise strcmp on UTF-8 bytes (PHP string comparison is byte-oriented,
    // unlike Swift's Unicode-canonical String `<`).
    let ab = Array(a.utf8), bb = Array(b.utf8)
    var i = 0
    while i < ab.count && i < bb.count {
        if ab[i] != bb[i] { return ab[i] < bb[i] ? -1 : 1 }
        i += 1
    }
    if ab.count == bb.count { return 0 }
    return ab.count < bb.count ? -1 : 1
}

/// PHP string truthiness: a string is FALSE only when it is "" or "0"; every other string is true.
public func phpStringIsTruthy(_ s: String) -> Bool { !(s.isEmpty || s == "0") }
