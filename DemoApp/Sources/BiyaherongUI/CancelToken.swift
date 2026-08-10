import Foundation

/// A cancellation flag the main actor sets and a background search reads.
///
/// The engine's `shouldCancel` is a plain synchronous `() -> Bool` called on the search thread every
/// 2048 nodes, and Core is deliberately free of concurrency — `AnalysisEngine.swift:9-13` says the
/// wrapper belongs in the UI layer, which is here. A lock-guarded box is the smallest thing that
/// satisfies both, and `@unchecked Sendable` is honest: the lock is the checking.
///
/// One token per search. Cancelling is one-way; start a new token rather than resetting.
final class CancelToken: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}
