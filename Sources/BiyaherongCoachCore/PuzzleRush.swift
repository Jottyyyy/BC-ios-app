import Foundation

/// Puzzle Turbo / Rush pure rules (Appendix C §6 — `PuzzleRushController`, `ShareController::rush`).
public enum PuzzleRush {

    /// Valid mode codes: 0 = Infinite, 3 = 3-minute, 5 = 5-minute.
    public static let modes = [0, 3, 5]

    /// Best-score upsert (`submitScore`): keep the max of `submitted` vs `stored` (nil → 0),
    /// persisting only on a STRICT improvement, and returning the resulting best.
    public static func bestScore(submitted: Int, stored: Int?) -> Int {
        submitted > (stored ?? 0) ? submitted : (stored ?? 0)
    }

    /// Human label for a mode (`ShareController::rush`). Fallback: "{mode}-minute".
    public static func modeLabel(_ mode: Int) -> String {
        switch mode {
        case 0: return "Infinite"
        case 3: return "3-minute"
        case 5: return "5-minute"
        default: return "\(mode)-minute"
        }
    }
}
