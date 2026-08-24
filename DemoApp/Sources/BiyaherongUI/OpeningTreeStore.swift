import Foundation
import BiyaherongCoachCore

/// Persistence for the Opening Tree: the file, and the observable object around it.
///
/// Both live here rather than in two files, the same split `PairingStore` uses and for the same
/// reason — everything that decides anything is in `OpeningTree`, which is pure and checked against
/// the JS twin by `tools/qa/replay_opening_tree.js`. What is left here is ten lines of IO.
///
/// A **file**, not `UserDefaults`, unlike the coach draft and the login session. A tree built from
/// the download's 1,000-game ceiling is megabytes of JSON; `UserDefaults` is a plist loaded whole at
/// launch and is the wrong place for it. Same reasoning as `pairing.json` and the analysis library.

/// One saved tree: the statistics, plus what it was built from.
///
/// The provenance is not decoration — a tree is a snapshot, and "40 of my Lichess games as White,
/// last June" is the only thing that makes two of them distinguishable in a list.
struct SavedOpeningTree: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var colour: OpeningTree.Colour
    var source: OpeningSource
    var username: String
    /// Games actually walked into the tree, i.e. `tree.gameCount` at build time.
    var gameCount: Int
    var createdAtMs: Double
    var tree: OpeningTree

    /// Positions in the tree. Stored rather than recomputed: `OpeningTree.nodeCount` walks the
    /// whole tree, and the list draws this line for every row on every render.
    var positionCount: Int

    init(id: String = UUID().uuidString,
         name: String,
         colour: OpeningTree.Colour,
         source: OpeningSource,
         username: String = "",
         createdAtMs: Double,
         tree: OpeningTree) {
        self.id = id
        self.name = name
        self.colour = colour
        self.source = source
        self.username = username
        self.createdAtMs = createdAtMs
        self.tree = tree
        self.gameCount = tree.gameCount
        self.positionCount = tree.nodeCount
    }

    /// `12 games · 84 positions · White` — filled, never re-typed.
    var metaLine: String {
        OpeningStrings.fill(OpeningStrings.meta,
                            ["games": String(gameCount),
                             "positions": String(positionCount),
                             "colour": colour.label])
    }
}

/// The document: every saved tree, newest first.
struct OpeningTreeDocument: Codable, Equatable {
    var trees: [SavedOpeningTree] = []
}

/// The only impure part: read and write `openings.json`. Mirrors `PairingLibraryFile`.
enum OpeningLibraryFile {

    /// `~/Library/Application Support/Biyaherong/openings.json` on both platforms.
    /// Application Support rather than Documents: this is app state the user never browses.
    static var url: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Biyaherong", isDirectory: true)
        return dir.appendingPathComponent("openings.json")
    }

    /// A missing or corrupt file yields an EMPTY document rather than throwing.
    ///
    /// Losing a tree is bad; a screen that will not open at all is worse — and it is the same
    /// degradation `PairingLibraryFile` and the browser twin choose, so all three behave alike.
    static func load() -> OpeningTreeDocument {
        guard let data = try? Data(contentsOf: url),
              let doc = try? JSONDecoder().decode(OpeningTreeDocument.self, from: data) else {
            return OpeningTreeDocument()
        }
        return doc
    }

    /// Atomic: a crash mid-write leaves the previous document intact rather than a truncated one.
    @discardableResult
    static func save(_ doc: OpeningTreeDocument) -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(doc) else { return false }
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

/// The screens' state. Nothing here decides anything a test would want to pin — the tree maths is
/// `OpeningTree`'s and the layout is `OpeningMetrics`'.
@MainActor
final class OpeningTreeStore: ObservableObject {
    @Published private(set) var trees: [SavedOpeningTree] = []
    /// The tree the explorer is showing, and the SAN path walked into it.
    @Published var openID: String?
    @Published var path: [String] = []

    private let load: () -> OpeningTreeDocument
    private let persist: (OpeningTreeDocument) -> Bool

    /// Injected so a test — and the macOS demo, which must not touch the user's real library —
    /// can run against memory. Same seam `PairingStore` and `CoachStore` take.
    init(load: @escaping () -> OpeningTreeDocument = OpeningLibraryFile.load,
         persist: @escaping (OpeningTreeDocument) -> Bool = OpeningLibraryFile.save) {
        self.load = load
        self.persist = persist
        self.trees = load().trees
    }

    var open: SavedOpeningTree? { trees.first { $0.id == openID } }

    /// The candidate list at the current path, or empty when nothing is open.
    var candidates: [OpeningTree.Candidate] {
        open?.tree.sortedMoves(at: path) ?? []
    }

    /// The position `path` reaches, replayed from the start.
    ///
    /// Replayed rather than stored beside the path for the same reason `MoveTree` stores keys and
    /// not boards: a cached FEN and a path are two representations of one thing, and they drift.
    /// The walk is bounded by `OpeningTree.defaultMaxPlies`, so it is 40 `makeMove`s at worst —
    /// cheaper than the candidate list it is drawn beside.
    /// Optional for the same reason every other caller of `ChessPosition(fen:)` is: the initialiser
    /// is failable and nothing here is allowed to force-unwrap. `CoachScreens` handles the nil the
    /// same way — `pos.map(piecesFrom) ?? []` draws an empty board rather than crashing.
    var position: ChessPosition? {
        guard var pos = ChessPosition(fen: ChessPosition.startFEN) else { return nil }
        for san in path {
            guard let m = pos.move(forSAN: san) else { break }
            pos = pos.makeMove(m)
        }
        return pos
    }

    /// The move that reached the current position, for the board's last-move highlight.
    var lastMove: Move? {
        guard let san = path.last,
              var pos = ChessPosition(fen: ChessPosition.startFEN) else { return nil }
        for s in path.dropLast() {
            guard let m = pos.move(forSAN: s) else { return nil }
            pos = pos.makeMove(m)
        }
        return pos.move(forSAN: san)
    }

    /// `1. e4 c5 2. Nf3` — the history strip. Numbered here rather than in the view body, which
    /// `swift_layout_check.js` allows no arithmetic in.
    var historyText: String {
        guard !path.isEmpty else { return OpeningStrings.startPosition }
        var out: [String] = []
        for (i, san) in path.enumerated() {
            if i % 2 == 0 { out.append("\(i / 2 + 1).") }
            out.append(san)
        }
        return out.joined(separator: " ")
    }

    func add(_ tree: SavedOpeningTree) {
        trees.insert(tree, at: 0)
        flush()
    }

    func remove(id: String) {
        trees.removeAll { $0.id == id }
        if openID == id { openID = nil; path = [] }
        flush()
    }

    func openTree(id: String) {
        openID = id
        path = []
    }

    func closeTree() {
        openID = nil
        path = []
    }

    // MARK: Navigation
    //
    // Deliberately on the store rather than in the view: the explorer is redrawn on every step, so
    // a `@State` path inside the screen would be reset by any parent repaint — the same reason
    // `app.js` keeps `pairingOpenId` router-scoped.

    func play(_ san: String) { path.append(san) }
    func stepBack() { if !path.isEmpty { path.removeLast() } }
    func reset() { path.removeAll() }

    /// Forward plays the **most-played** continuation, matching the RN screen's `handleForward`.
    func stepForward() {
        guard let next = open?.tree.mostPlayed(at: path) else { return }
        path.append(next)
    }

    var canStepBack: Bool { !path.isEmpty }
    var canStepForward: Bool { open?.mostPlayedExists(at: path) ?? false }

    private func flush() { _ = persist(OpeningTreeDocument(trees: trees)) }
}

private extension SavedOpeningTree {
    func mostPlayedExists(at path: [String]) -> Bool { tree.mostPlayed(at: path) != nil }
}
