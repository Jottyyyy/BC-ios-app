import SwiftUI

// Public entry points for the app targets.
//
//  • BiyaherongPhoneRoot — the iPhone/iPad app: boots straight into the tab UI.
//  • BiyaherongMacRoot   — the macOS engine-demo shell (sidebar of panels).
//
// The `@main` App structs that show these live in the app targets (the DemoApp
// executable for macOS, the Xcode app for iOS) — a Swift library can't own `@main`.

/// Root view for the iPhone / iPad app.
public struct BiyaherongPhoneRoot: View {
    public init() {}
    public var body: some View {
        PhoneApp()
            .environment(\.font, Theme.nunito(15))
            .preferredColorScheme(.dark)
            .background(Theme.background.ignoresSafeArea())
            .tint(Theme.gold)
    }
}

/// Root view for the macOS engine demo.
public struct BiyaherongMacRoot: View {
    public init() {}
    public var body: some View {
        RootView()
    }
}
