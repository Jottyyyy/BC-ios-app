import Foundation
import Security
import BiyaherongCoachCore

/// `CoachGame.Storage` backed by the keychain — the first keychain use in the repo.
///
/// The entitlement snapshot lives here rather than in `UserDefaults` or a JSON file for two
/// reasons: it survives a delete-and-reinstall, so a subscriber who reinstalls offline is not
/// locked out until they can reach the App Store; and it is meaningfully harder to hand-edit than
/// a plist, which matters for the one value in the app that decides whether the user has paid.
///
/// It is still not tamper-*proof* — nothing that runs on hardware the attacker owns can be. It is a
/// higher wall, and the honest limits are recorded in PORTING_NOTES.md.
///
/// `kSecAttrAccessibleAfterFirstUnlock` rather than `WhenUnlocked`: the entitlement is read at
/// launch and on foreground, and a launch triggered while the phone is still locked must not read
/// an empty keychain and conclude the user is not subscribed.
struct KeychainStorage: CoachGame.Storage {
    let service: String

    init(service: String = "com.biyaherong.entitlement") { self.service = service }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func set(_ key: String, _ value: String) {
        let data = Data(value.utf8)
        let q = query(key)
        // Update first: `SecItemAdd` on an existing account returns `errSecDuplicateItem` and
        // writes nothing, which would silently freeze the snapshot at its first value.
        let updated = SecItemUpdate(q as CFDictionary,
                                    [kSecValueData as String: data] as CFDictionary)
        if updated == errSecSuccess { return }
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        _ = SecItemAdd(add as CFDictionary, nil)
    }

    func remove(_ key: String) {
        _ = SecItemDelete(query(key) as CFDictionary)
    }
}

/// Where the entitlement is persisted, per platform.
enum SecureStorage {
    static func make() -> CoachGame.Storage {
        #if os(iOS)
        return KeychainStorage()
        #else
        // macOS: the demo app is built unsigned (`DemoApp/run-demo.sh`), and `SecItem` from an
        // unsigned binary raises a system permission dialog — which would hang the desktop preview
        // behind a modal nobody expects. The Mac shell is a preview harness where nobody
        // subscribes, so `UserDefaults` is the right trade there.
        return CoachDefaultsStorage()
        #endif
    }
}
