import SwiftUI
import BiyaherongUI

// iPhone / iPad entry point.
// All UI, engine and resources come from the BiyaherongUI package library, so this
// file stays tiny — it just shows the phone root full-screen.
@main
struct BiyaherongApp: App {
    var body: some Scene {
        WindowGroup {
            BiyaherongPhoneRoot()
        }
    }
}
