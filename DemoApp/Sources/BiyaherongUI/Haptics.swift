import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// Haptic feedback.
//
// ── What the source actually does ─────────────────────────────────────────────
// `board.tsx` has ZERO haptics. But it renders `DragDropChessBoard`, and that component fires
// `Haptics.impactAsync(ImpactFeedbackStyle.Light)` on **drag pickup**
// (components/DragDropChessBoard.tsx:351), after its piece-exists and correct-colour guards. So
// `.pickUp` is a port; the other three are ADDITIONS, chosen with the user and recorded in
// PORTING_NOTES:
//
//   .move     — a soft tap when a move lands
//   .capture  — a heavier one for a capture or a check, so the board feels different when
//               something happened
//   .success  — a notification when a game review finishes, because that is the one action here
//               long enough that you look away from the screen
//
// Nothing else vibrates. Navigation, menu items and modals are deliberately silent: a haptic on
// every tap is noise, and the source has none of them either.
//
// macOS is a no-op — `UIImpactFeedbackGenerator` is UIKit-only, and the demo app must keep building.
// That is also why this is the UI layer's problem and not Core's: Core is Foundation-only.

enum Haptics {
    enum Kind {
        case pickUp      // ported: DragDropChessBoard.tsx:351
        case move        // addition
        case capture     // addition
        case success     // addition
    }

    /// Whether haptics fire at all. A stored flag rather than a `#if` at every call site, so the
    /// call sites read the same on both platforms and a future settings toggle has somewhere to go.
    @MainActor static var enabled = true

    @MainActor
    static func play(_ kind: Kind) {
        guard enabled else { return }
        #if canImport(UIKit)
        switch kind {
        case .pickUp:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .move:
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        case .capture:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .success:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
        #endif
    }

    /// The move-commit haptic, picking the weight from what the move did. One call site instead of
    /// an `if` in the view model.
    @MainActor
    static func playForMove(capture: Bool, check: Bool) {
        play(capture || check ? .capture : .move)
    }
}
