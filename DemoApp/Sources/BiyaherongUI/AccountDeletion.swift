import Foundation
import BiyaherongCoachCore

/// Erases the account's data from this device.
///
/// Apple Guideline 5.1.1(v): an app that offers account creation must offer account DELETION from
/// inside the app. Sign in with Apple is real now (`LoginAppleAuth.swift`), so this is required in
/// the **same submission** — shipping one without the other trades one rejection for another.
///
/// There is no server, so "delete" means erasing what the account produced locally.
/// `LoginAccountData` holds both the erase list and — just as importantly — the keep list.
///
/// Deliberately does **not** `import StoreKit`. `tools/qa/replay_premium.js` asserts that exactly
/// one file in this package imports it, and that file is `PremiumStore.swift`. Nothing here needs
/// it: the subscription is untouched on purpose, which is itself an Apple requirement.
enum AccountDeletion {

    /// `~/Library/Application Support/Biyaherong/` — the folder `OpeningLibraryFile` and its three
    /// siblings each derive independently, reproduced here rather than reached for, because none of
    /// them exposes the directory on its own.
    static func supportDirectory(_ files: FileManager = .default) -> URL {
        let base = files.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("Biyaherong", isDirectory: true)
    }

    /// `keyNames` is only used to ENUMERATE — the saved coach games are one key each, so a prefix
    /// is the only way to find them. Every actual removal goes through `storage`, so the in-memory
    /// double a self-check injects sees all of them.
    static func erase(storage: CoachGame.Storage,
                      keyNames: [String],
                      files: FileManager = .default) {
        for key in LoginAccountData.erasedKeys { storage.remove(key) }
        for prefix in LoginAccountData.erasedKeyPrefixes {
            for key in keyNames where key.hasPrefix(prefix) { storage.remove(key) }
        }
        let dir = supportDirectory(files)
        for name in LoginAccountData.erasedFiles {
            try? files.removeItem(at: dir.appendingPathComponent(name))
        }
    }

    /// What the app calls: the real defaults supply the key names.
    static func eraseAll(storage: CoachGame.Storage = CoachDefaultsStorage(),
                         defaults: UserDefaults = .standard,
                         files: FileManager = .default) {
        erase(storage: storage,
              keyNames: Array(defaults.dictionaryRepresentation().keys),
              files: files)
    }
}
