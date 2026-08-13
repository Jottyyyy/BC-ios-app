import Foundation
import BiyaherongCoachCore

/// Persistence for the Pairing Manager: the file, and the observable object around it.
///
/// Both live here rather than in two files because the impure half is ten lines and splitting them
/// would put more ceremony on the page than code. Everything that decides anything is in
/// `PairingDocument`, which is pure and checked against the JS twin by `tools/qa/replay_pairing.js`.

/// The only impure part: read and write `pairing.json`. Mirrors `AnalysisLibraryFile`.
enum PairingLibraryFile {

    /// `~/Library/Application Support/Biyaherong/pairing.json` on both platforms.
    /// Application Support rather than Documents: this is app state the user never browses.
    static var url: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Biyaherong", isDirectory: true)
        return dir.appendingPathComponent("pairing.json")
    }

    /// A missing or corrupt file yields an EMPTY document rather than throwing.
    ///
    /// Losing a tournament list is bad; a screen that will not open at all is worse — and the same
    /// degradation is what `PairingDocument.decode` and the browser twin do, so all three behave
    /// alike.
    static func load() -> PairingDocument.State {
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            return PairingDocument.State()
        }
        return PairingDocument.decode(text)
    }

    /// Atomic: a crash mid-write leaves the previous document intact rather than a truncated one.
    @discardableResult
    static func save(_ state: PairingDocument.State) -> Bool {
        let text = PairingDocument.encode(state)
        guard let data = text.data(using: .utf8) else { return false }
        let target = url
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}

/// The document, observable.
///
/// Internal, like every other view and view-model in this package: only `Roots.swift` crosses the
/// module boundary. Declaring it public would also be a compile error, since a public signature
/// cannot name an internal type.
@MainActor
final class PairingStore: ObservableObject {

    /// Everything persisted. `@Published` so any screen observing the store repaints when a player
    /// is added, a result entered or a round generated — none of them has to know who else cares.
    @Published private(set) var state: PairingDocument.State

    init() {
        self.state = PairingLibraryFile.load()
    }

    /// Epoch milliseconds — the unit every Core function takes, matching `PuzzleHubStore`.
    static func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    // MARK: - Mutations
    //
    // One path in and out, so no screen holds `inout` access to the document and persistence cannot
    // be forgotten. Every helper below is a thin wrapper over the pure function of the same name.

    @discardableResult
    func mutate<T>(_ body: (inout PairingDocument.State) -> T) -> T {
        var s = state
        let out = body(&s)
        state = s
        PairingLibraryFile.save(s)
        return out
    }

    var tournaments: [PairingDocument.Tournament] { state.tournaments }

    func tournament(_ id: Int) -> PairingDocument.Tournament? {
        PairingDocument.tournament(state, id: id)
    }

    @discardableResult
    func create(name: String, type: PairingDocument.Kind, totalRounds: Int?) -> Int? {
        mutate { PairingDocument.create(&$0, name: name, type: type,
                                        totalRounds: totalRounds, now: PairingStore.nowMs()) }
    }

    @discardableResult
    func remove(_ id: Int) -> Bool {
        mutate { PairingDocument.remove(&$0, id: id) }
    }

    @discardableResult
    func addPlayer(_ id: Int, name: String, fullName: String?, rating: Int?) -> Int? {
        mutate { PairingDocument.addPlayer(&$0, tournamentID: id, name: name,
                                           fullName: fullName, rating: rating) }
    }

    @discardableResult
    func bulkAdd(_ id: Int, text: String) -> Int {
        mutate { PairingDocument.bulkAdd(&$0, tournamentID: id, text: text) }
    }

    @discardableResult
    func removePlayer(_ id: Int, playerID: Int) -> Bool {
        mutate { PairingDocument.removePlayer(&$0, tournamentID: id, playerID: playerID) }
    }

    @discardableResult
    func generate(_ id: Int) -> Bool {
        mutate { PairingDocument.generate(&$0, tournamentID: id, now: PairingStore.nowMs()) }
    }

    @discardableResult
    func setResult(_ id: Int, round: Int, board: Int,
                   result: PairingDocument.Result) -> Bool {
        mutate { PairingDocument.setResult(&$0, tournamentID: id, round: round, board: board,
                                           result: result, now: PairingStore.nowMs()) }
    }

    @discardableResult
    func clearResult(_ id: Int, round: Int, board: Int) -> Bool {
        mutate { PairingDocument.clearResult(&$0, tournamentID: id, round: round, board: board,
                                             now: PairingStore.nowMs()) }
    }
}
