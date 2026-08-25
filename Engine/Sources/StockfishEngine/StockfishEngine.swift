import Foundation
import CStockfish
import BiyaherongCoachCore

// MARK: - Runtime

/// Starting, stopping and reporting on the one Stockfish in the process.
///
/// Stockfish keeps process-wide state — precomputed attack tables, a thread pool, a transposition
/// table — so there is exactly one engine, started once, and `StockfishEngine` values are handles
/// onto it rather than engines of their own. `biya_stockfish.cpp` serialises every entry point, so
/// two concurrent `analyze` calls are safe but will queue.
public enum StockfishRuntime {

    public enum StartFailure: Error, Equatable, Sendable {
        /// The bundled `.nnue` resources are not where `Bundle.module` says they should be. In
        /// practice: a `.process` slipped into `Package.swift` where a `.copy` was needed, or a CI
        /// step stripped the resource bundle.
        case netsMissing(String)
        /// The files are there and Stockfish will not have them. A truncated download, or nets from
        /// a different Stockfish than the one vendored.
        case netsInvalid(String)
        case internalFailure(String)

        public var message: String {
            switch self {
            case .netsMissing(let m), .netsInvalid(let m), .internalFailure(let m): return m
            }
        }
    }

    /// Search threads. Two, and not more.
    ///
    /// A phone has efficiency cores it will happily hand out and then thermally throttle, and the
    /// Analysis Board is running while the user is reading the board rather than waiting on a clock.
    /// The second thread is worth roughly 60% of a first; the third and fourth are worth heat.
    public static let threads = 2

    /// Transposition table, in MiB.
    ///
    /// Small on purpose. The big net is already ~71 MB resident, and iOS terminates a foreground app
    /// that grows without the user seeing why. 32 MiB is several million entries — far past the
    /// point where a one-second search on a phone can fill it.
    public static let hashMB = 32

    /// Where the two `.nnue` files live inside the package's resource bundle.
    public static var netsDirectory: URL? {
        Bundle.module.resourceURL?.appendingPathComponent("Nets", isDirectory: true)
    }

    public static var isStarted: Bool { biya_sf_is_started() != 0 }

    /// Stockfish's own banner, e.g. `"Stockfish 17.1"`. Empty before `start()`.
    public static var versionBanner: String {
        String(cString: biya_sf_version())
    }

    /// Start the engine. Idempotent — a second call while running is a no-op, not a failure.
    ///
    /// **Call this off the main thread.** It reads a 71 MB network file and lays out the
    /// transposition table.
    @discardableResult
    public static func start() -> Result<Void, StartFailure> {
        if isStarted { return .success(()) }

        guard let directory = netsDirectory else {
            return .failure(.netsMissing("Bundle.module has no resource directory"))
        }

        let status = directory.path.withCString {
            biya_sf_start($0, Int32(threads), Int32(hashMB))
        }
        if status == BIYA_SF_OK || status == BIYA_SF_ERR_ALREADY_STARTED { return .success(()) }

        let detail = String(cString: biya_sf_last_error())
        switch status {
        case BIYA_SF_ERR_NET_MISSING: return .failure(.netsMissing(detail))
        case BIYA_SF_ERR_NET_INVALID: return .failure(.netsInvalid(detail))
        default: return .failure(.internalFailure(detail))
        }
    }

    public static func shutdown() { biya_sf_shutdown() }

    /// Drop the transposition table between unrelated positions, so a result depends only on the
    /// request. `AnalysisEngine.swift` promises the same request twice returns the same lines.
    public static func newGame() { biya_sf_new_game() }
}

// MARK: - The engine

/// Stockfish behind Core's `AnalysisEngine`.
///
/// Everything interesting is in `StockfishBridge`; this type is the plumbing between it and
/// `biya_stockfish.h`.
///
/// ## Two contract notes worth knowing before you read the code
///
/// **The closures are called on Stockfish's search thread**, not the caller's. `LocalEngine` calls
/// them inline, so this is a real difference. It is safe at the call site that exists —
/// `AnalysisVM.runAnalysis` reads a `CancelToken` and a `Date` in `shouldCancel`, and hops to
/// `@MainActor` inside `onProgress` — and any new caller has to hold to the same rule.
///
/// **`historyKeys` cannot reach Stockfish.** The protocol carries position KEYS, and UCI wants the
/// MOVES that produced them (`position fen … moves …`), which is how Stockfish learns a line repeats
/// something played before the search began. Repetitions *inside* the search are still found; a line
/// that walks back into a position from before the root is not scored as a draw. `ChessRules` has
/// already ruled on the root itself, so what is lost is narrow. Recorded in `PORTING_NOTES.md`.
public struct StockfishEngine: AnalysisEngine {

    /// Bumped whenever the engine or its net changes, so a review cached by an older build is not
    /// mixed with numbers from this one.
    public let identifier = "stockfish-17.1"

    /// Wall-clock budget handed to Stockfish as `movetime`.
    ///
    /// `SearchLimits` deliberately carries no clock, and `shouldCancel` is only consulted when
    /// Stockfish reports — which at depth 20 can be seconds apart. Passing the deadline down as well
    /// is what keeps a preset's "1.2 seconds" mean 1.2 seconds. `nil` leaves the search bounded by
    /// depth and nodes alone.
    public let movetimeMs: Int?

    public init(movetimeMs: Int? = nil) {
        self.movetimeMs = movetimeMs
    }

    public func analyze(_ position: ChessPosition,
                        limits: SearchLimits,
                        historyKeys: [String],
                        shouldCancel: () -> Bool,
                        onProgress: (AnalysisSnapshot) -> Void) -> AnalysisSnapshot {

        // Same short-circuit as LocalEngine, and for the same reason: `EngineScore.mate` promises it
        // is never zero, which only holds if an already-finished game never reaches a search.
        let outcome = position.terminalOutcome(historyKeys: historyKeys)
        if outcome.kind != .ongoing {
            let snap = AnalysisSnapshot(fen: position.fen, depth: 0, nodes: 0, lines: [],
                                        isFinal: true, terminal: outcome)
            onProgress(snap)
            return snap
        }

        let resolved = StockfishBridge.resolve(limits, movetimeMs: movetimeMs)
        let legalMoves = position.legalMoves().count

        // Both return types are written out. Nested `withoutActuallyEscaping` is a known place for
        // Swift's inference to give up, and the error it gives up with points at the wrong line.
        return withoutActuallyEscaping(shouldCancel) { cancel -> AnalysisSnapshot in
            withoutActuallyEscaping(onProgress) { progress -> AnalysisSnapshot in
                let relay = Relay(position: position,
                                  multiPV: resolved.multiPV,
                                  legalMoves: legalMoves,
                                  cancel: cancel,
                                  progress: progress)

                let box = Unmanaged.passUnretained(relay).toOpaque()
                let status = position.fen.withCString { fen in
                    biya_sf_search(fen, nil, 0,
                                   Int32(resolved.depth),
                                   Int32(resolved.multiPV),
                                   Int64(resolved.movetimeMs),
                                   Int64(resolved.nodes),
                                   box,
                                   stockfishInfoCallback)
                }

                return relay.finish(engineFailed: status != BIYA_SF_OK)
            }
        }
    }
}

// MARK: - Relay

/// Accumulator shared with the C callback for the duration of one search.
///
/// A class, because the callback reaches it through an opaque pointer. Not `Sendable`, and it does
/// not need to be: `biya_sf_search` blocks until the search is over, so the only thread touching it
/// during that window is Stockfish's, and the only one afterwards is ours.
private final class Relay {
    let position: ChessPosition
    let multiPV: Int
    let legalMoves: Int
    let cancel: () -> Bool
    let progress: (AnalysisSnapshot) -> Void

    /// Reports for the depth currently being built, by 1-based multi-PV rank.
    var store: [Int: StockfishBridge.RawLine] = [:]
    var depth = 0
    var nodes = 0
    /// The last iteration that reported every line it owed. See `StockfishBridge.isComplete`.
    var lastComplete: AnalysisSnapshot?

    init(position: ChessPosition, multiPV: Int, legalMoves: Int,
         cancel: @escaping () -> Bool, progress: @escaping (AnalysisSnapshot) -> Void) {
        self.position = position
        self.multiPV = multiPV
        self.legalMoves = legalMoves
        self.cancel = cancel
        self.progress = progress
    }

    /// One `info` report. Returns true to ask the search to stop.
    func accept(_ line: StockfishBridge.RawLine) -> Bool {
        if line.depth != depth {
            flushIteration()
            depth = line.depth
            store = [:]
        }
        StockfishBridge.merge(line, into: &store)
        nodes = max(nodes, line.nodes)
        return cancel()
    }

    /// Publish the iteration just finished, if it finished.
    private func flushIteration() {
        guard depth > 0, !store.isEmpty else { return }
        guard StockfishBridge.isComplete(store: store, multiPV: multiPV, legalMoves: legalMoves)
        else { return }
        let snap = StockfishBridge.snapshot(position: position, depth: depth, nodes: nodes,
                                            store: store, isFinal: false)
        lastComplete = snap
        progress(snap)
    }

    /// Build the result after `biya_sf_search` returns.
    func finish(engineFailed: Bool) -> AnalysisSnapshot {
        if !engineFailed { flushIteration() }

        guard let complete = lastComplete else {
            // Nothing ever completed: the deadline landed inside the first iteration, or the engine
            // failed outright. An empty, final snapshot is honest — `AnalysisSession` shows no lines
            // rather than a line the search does not stand behind.
            return AnalysisSnapshot(fen: position.fen, depth: 0, nodes: nodes, lines: [],
                                    isFinal: true, terminal: nil)
        }
        return AnalysisSnapshot(fen: complete.fen, depth: complete.depth, nodes: complete.nodes,
                                lines: complete.lines, isFinal: true, terminal: nil)
    }
}

/// The `@convention(c)` entry point Stockfish calls.
///
/// Kept to unpacking and forwarding. Anything that can fail interestingly belongs in `Relay` or
/// `StockfishBridge`, where it can be reached by a test.
private let stockfishInfoCallback: biya_sf_info_cb = { context, info in
    guard let context, let info else { return 0 }
    let relay = Unmanaged<Relay>.fromOpaque(context).takeUnretainedValue()
    let report = info.pointee

    let line = StockfishBridge.RawLine(
        depth: Int(report.depth),
        selDepth: Int(report.sel_depth),
        multiPV: Int(report.multi_pv),
        isMate: report.score_kind == BIYA_SF_SCORE_MATE,
        value: Int(report.score_value),
        isLowerBound: report.is_lower_bound != 0,
        isUpperBound: report.is_upper_bound != 0,
        nodes: Int(report.nodes),
        timeMs: Int(report.time_ms),
        pv: report.pv.map { String(cString: $0) } ?? "")

    return relay.accept(line) ? 1 : 0
}
