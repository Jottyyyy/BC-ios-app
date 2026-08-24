import Foundation
import SwiftUI
import BiyaherongCoachCore

/// The Opening Tree explorer's engine: the toggle, the eval and the three best lines.
///
/// The client asked for it after the download landed: *"sana lagyan mo din ng engine evaluation"*.
/// The RN screen has the same toggle and the same three lines (`openingtree.tsx:993-1039`); what it
/// does not have is a rail, which is this port's own addition and is recorded in PORTING_NOTES.
///
/// ## Why this is its own object and not part of `OpeningTreeStore`
///
/// `OpeningTreeStore` is the **document**: every mutation funnels through `flush()` into
/// `openings.json`. Engine state is ephemeral and has a cancellation lifecycle, and putting a
/// `@Published` snapshot next to `trees` invites a disk write on every depth hop. The store is also
/// shared by all three screens while the engine belongs to one, and its browser twin
/// (`opening-store.js`) is `require`d headlessly by `js_goldens.js`, where there is no Worker and no
/// DOM. `PuzzleSolverEngine` is the same split for the same reasons.
///
/// ## What is deliberately reused
///
/// All of it. `LocalEngine`, `AnalysisSnapshot`, `AnalysisSession.engineRows(from:)` (which was made
/// `static` precisely so a second screen could call it), `AnalysisSession.evalParts(from:)`,
/// `AnalysisEval.fraction(parts:)` and `EngineScore.displayText`. Nothing about an evaluation is
/// computed twice in this app.
///
/// The limits are `AnalysisEngineLimits`, **not** the Analysis Board's `EngineSettings` preset —
/// the rule `PuzzleSolverParts` states: *"that screen's setting, not this one's."*
@MainActor
final class OpeningEngineVM: ObservableObject {

    /// **OFF by default**, which is the client's own answer. This screen is a repertoire browser
    /// first, and a search firing on every step of a fast walk is not what it is for.
    @Published private(set) var engineOn = false
    @Published private(set) var rows: [EngineRow] = []
    @Published private(set) var analyzing = false
    @Published private(set) var evalFraction: CGFloat = AnalysisEval.fraction(cp: nil, mate: nil)
    @Published private(set) var evalLabel = ""

    /// The position the board is showing.
    ///
    /// Held here rather than reached for through the store, so `adopt` can run the same stale guard
    /// `AnalysisVM.adopt(_:for:)` does without knowing what a store is.
    private var current: ChessPosition?
    private var debounceTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var searchToken: CancelToken?

    /// How long one position may be searched. The same 3 s budget the puzzle hint panel gives
    /// itself, and for the same reason: a screen that is not the Analysis Board does not get to
    /// spend the Analysis Board's time.
    static let deadlineSeconds: Double = 3.0

    // MARK: - Input

    func toggle(position: ChessPosition?) {
        engineOn.toggle()
        current = position
        // Dropping the results is what makes the rail LEAVE the layout rather than sit at a dead
        // 50/50 with no number on it — the bug the Analysis Board's own toggle was fixed for.
        if !engineOn { clearResults() }
        schedule()
    }

    func positionChanged(to position: ChessPosition?) {
        current = position
        schedule()
    }

    /// Called from `.onDisappear`. A detached `Task` is not cancelled by `deinit`, so leaving the
    /// screen has to say so.
    func stop() {
        debounceTask?.cancel()
        searchToken?.cancel()
        searchTask?.cancel()
        debounceTask = nil
        searchTask = nil
        analyzing = false
    }

    // MARK: - The search

    private func clearResults() {
        rows = []
        evalLabel = ""
        evalFraction = AnalysisEval.fraction(cp: nil, mate: nil)
    }

    /// Cancel whatever is running, then start the debounce again.
    ///
    /// Walking the tree fast therefore searches nothing: each step cancels the in-flight token —
    /// the engine polls `shouldCancel` every 2048 nodes, so it stops in milliseconds — and restarts
    /// the 300 ms wait. Only a pause actually costs a search.
    private func schedule() {
        debounceTask?.cancel()
        searchToken?.cancel()
        searchTask?.cancel()
        analyzing = false
        guard engineOn, let position = current else { clearResults(); return }
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(AnalysisTiming.analysisDebounceMs)
                                  * OpeningEngineVM.nanosecondsPerMillisecond)
            guard !Task.isCancelled, let self else { return }
            self.run(position)
        }
    }

    private static let nanosecondsPerMillisecond: UInt64 = 1_000_000

    private func run(_ position: ChessPosition) {
        let token = CancelToken()
        searchToken = token
        let deadline = Date().addingTimeInterval(OpeningEngineVM.deadlineSeconds)
        analyzing = true
        // Detached for the reason `AnalysisVM` documents at its own call site: the engine blocks its
        // thread and never yields, so running it on the main actor would freeze the board. Progress
        // hops back per completed depth, so lines appear as they are found.
        searchTask = Task.detached(priority: .userInitiated) { [weak self] in
            let engine = LocalEngine()
            let result = engine.analyze(
                position,
                limits: SearchLimits(maxDepth: AnalysisEngineLimits.maxDepth,
                                     multiPV: AnalysisEngineLimits.multiPV),
                // No history: a tree path is bounded and a threefold repetition inside an opening
                // book is noise. Building the keys would mean a second full replay of the path on
                // every step, which is the cost this screen is most sensitive to.
                historyKeys: [],
                shouldCancel: { token.isCancelled || Date() > deadline },
                onProgress: { snapshot in
                    Task { @MainActor in
                        guard let self, !token.isCancelled else { return }
                        self.adopt(snapshot, for: position)
                    }
                })
            await MainActor.run {
                guard let self, !token.isCancelled else { return }
                self.analyzing = false
                self.adopt(result, for: position)
            }
        }
    }

    /// Accept a result only if the board still shows the position it was computed for.
    ///
    /// The token alone is not enough: it is checked when the hop is *scheduled*, and the board can
    /// move between then and the hop running. `AnalysisVM.adopt(_:for:)` carries the same pair for
    /// the same reason.
    private func adopt(_ snapshot: AnalysisSnapshot, for searched: ChessPosition) {
        guard engineOn, current == searched else { return }
        rows = AnalysisSession.engineRows(from: snapshot)
        evalFraction = AnalysisEval.fraction(parts: AnalysisSession.evalParts(from: snapshot))
        evalLabel = snapshot.score?.displayText ?? ""
    }
}
