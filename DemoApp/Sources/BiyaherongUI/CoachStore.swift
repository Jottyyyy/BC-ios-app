import Foundation
import BiyaherongCoachCore

/// Play vs Coach: the observable game, its storage, and the reply loop.
///
/// Twin of the `coachTab` section of `web-demo/js/app.js`. Everything that decides anything is in
/// `CoachGame` / `CoachTurn` / `CoachEngine` / `CoachBook`, which are pure and checked against the
/// JS by `tools/qa/replay_coach.js`. What is here is the joining: ask the coach, wait, apply,
/// publish.
///
/// ## The generation counter cancels the search itself
///
/// `CoachTurn` hands out a token; every continuation is dropped unless the token still matches. The
/// same token also drives the engine's `shouldCancel`, so resigning mid-search stops the *search*
/// rather than merely discarding its answer — spec §7 #25/#26/#27/#29 as one mechanism.

/// `UserDefaults` behind `CoachGame.Storage`, so the Core stays Foundation-only and testable.
struct CoachDefaultsStorage: CoachGame.Storage {
    let defaults: UserDefaults

    init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    func get(_ key: String) -> String? { defaults.string(forKey: key) }
    func set(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
    func remove(_ key: String) { defaults.removeObject(forKey: key) }
}

@MainActor
final class CoachStore: ObservableObject {

    /// Which of the three screens is showing.
    enum Screen: Equatable {
        case select
        case colour(level: Int)
        case game
    }

    @Published private(set) var screen: Screen = .select
    @Published private(set) var game: CoachGame.Game?
    @Published private(set) var controller = CoachTurn.create()
    /// The Game Review (spec §2.10). `nil` when the modal is closed.
    @Published private(set) var review: ReviewState?
    /// Raised by the game screen; the host presents the prompt (spec §7 #24).
    @Published var confirmingResign = false
    /// True when a review was refused because the free tier's daily allowance is spent. The screen
    /// shows the cap message and the upgrade route; the store does not know what a paywall is.
    @Published var reviewBlocked = false

    /// The free tier's daily Game Review allowance, supplied by the host. Returns false when it is
    /// spent and **consumes one when it returns true**. `nil` means ungated.
    var reviewGate: (() -> Bool)?

    /// Spec §7 #39: the RN switch was never written anywhere, so it reset on every launch.
    @Published var allowTakeBack: Bool {
        didSet { storage.set(Self.takeBackKey, allowTakeBack ? "1" : "0") }
    }

    /// Running and finished are one type because they are one modal: the progress bar is replaced
    /// in place, so a review that finishes does not flash a second card.
    enum ReviewState: Equatable {
        case running(done: Int, total: Int)
        case done(CoachReview.Summary)
    }

    static let takeBackKey = "biya.coach.takeback.v1"

    private let storage: CoachGame.Storage
    private var replyTask: Task<Void, Never>?

    var profile: CoachProfile {
        CoachRoster.of(level: game?.level ?? 1)
    }

    init(storage: CoachGame.Storage = CoachDefaultsStorage()) {
        self.storage = storage
        self.allowTakeBack = storage.get(Self.takeBackKey) == "1"
    }

    static func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    // MARK: - Navigation

    func pick(level: Int) { screen = .colour(level: CoachEngine.clamp(level: level)) }

    func backToSelect() {
        cancelInFlight()
        screen = .select
    }

    /// The draft for a level, or nil — what the colour screen offers **Continue** for.
    func draft(level: Int) -> CoachGame.Game? {
        guard let g = CoachGame.loadDraft(level: level, storage: storage, now: Self.nowMs()) else {
            return nil
        }
        // A draft with no moves in it is not an unfinished game, it is a game that never started.
        return g.moveRecords.count > 1 ? g : nil
    }

    /// Spec §7 #33: Continue honours the colour you tapped, not the colour of the saved game.
    /// The decision itself is `resolveStart` in the JS twin; here the caller has already made it.
    func start(level: Int, userColor: CoachGame.Side, resume: CoachGame.Game?) {
        cancelInFlight()
        var g = resume ?? CoachGame.newGame(level: level, userColor: userColor)
        // Restoring re-evaluates rather than trusting the draft: the draft stores no result, so a
        // game that ended while the app was away would otherwise come back playable.
        CoachGame.applyEvaluation(&g, coach: voice(level: level))
        game = g
        controller = CoachTurn.create()
        screen = .game
        // Spec §7 #34: a restored game starts as a game — sound and all — with no modal left over.
        confirmingResign = false
        SoundManager.shared.gameStart()
        askCoach()
    }

    func exitGame() {
        cancelInFlight()
        review = nil
        screen = .select
    }

    // MARK: - The user's move

    func userMove(uci: String) {
        guard var g = game, CoachTurn.canUserMove(g, controller) else { return }
        guard apply(&g, uci: uci) else { return }
        game = g
        if CoachGame.isOver(g) { return }
        askCoach()
    }

    /// Record one half-move, sound it, evaluate and persist. False if it was not legal here.
    private func apply(_ g: inout CoachGame.Game, uci: String) -> Bool {
        guard let before = ChessPosition(fen: CoachGame.liveFen(g)),
              let move = before.move(forUCI: uci),
              CoachGame.record(&g, uci: uci) != nil else { return false }
        soundFor(move: move, before: before, after: CoachGame.liveFen(g))
        CoachGame.applyEvaluation(&g, coach: voice(level: g.level))
        CoachGame.saveDraft(g, storage: storage, now: Self.nowMs())
        return true
    }

    /// `moveIsCastle` / `moveIsCapture` are the classifiers the Analysis Board already uses — they
    /// read the move against the position it was made in, and `moveIsCapture` knows about en
    /// passant. Reimplementing them here would have been a second answer to a settled question.
    private func soundFor(move: Move, before: ChessPosition, after fen: String) {
        SoundManager.shared.playMove(isCastle: moveIsCastle(before, move),
                                     isCapture: moveIsCapture(before, move),
                                     status: ChessPosition(fen: fen)?.status() ?? .ongoing)
    }

    // MARK: - The coach's reply

    /// Ask the coach for a move, if it is the coach's move to make.
    ///
    /// The book is consulted first and falls through **silently** when it has nothing legal to
    /// offer (spec §2.3).
    func askCoach() {
        guard let g = game, CoachTurn.shouldCoachMove(g, controller) else { return }
        guard let pos = ChessPosition(fen: CoachGame.liveFen(g)) else { return }

        let token = CoachTurn.begin(&controller)
        let level = g.level
        let history = CoachGame.sanHistory(g)
        let limits = CoachEngine.searchLimits(level: level)
        let think = CoachEngine.thinkTimeMs(level: level,
                                            pieceCount: pieceCount(pos),
                                            rng: { Double.random(in: 0..<1) })
        let book = CoachBook.bookMove(level: level, sanHistory: history,
                                      isLegal: { pos.move(forUCI: $0) != nil },
                                      rng: { Double.random(in: 0..<1) })
        let cancel = CancelToken()
        let started = Date()

        replyTask?.cancel()
        replyTask = Task { [weak self] in
            var chosen = book
            if chosen == nil {
                // Off the main actor: only value types cross, and the token is what lets a resign
                // stop the search rather than wait it out.
                let search = SearchLimits(maxDepth: limits.depth, multiPV: limits.multiPV)
                let deadline = started.addingTimeInterval(Double(limits.movetimeMs) / 1000)
                let snapshot = await Task.detached(priority: .userInitiated) {
                    LocalEngine().analyze(pos, limits: search,
                                          shouldCancel: {
                                              cancel.isCancelled || Date() > deadline
                                          })
                }.value
                if let line = CoachEngine.pickMove(snapshot.lines, level: level,
                                                   rng: { Double.random(in: 0..<1) }),
                   let first = line.pv.first {
                    chosen = first.uci
                }
            }
            guard let self else { return }
            // The reply is paced, not delayed: the wait runs down whatever the search already
            // spent, so §2.13's 300 ms floor is a floor and not an addition.
            let spent = Date().timeIntervalSince(started)
            let remaining = Double(think) / 1000 - spent
            if remaining > 0 {
                try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            }
            await self.landReply(token: token, uci: chosen)
        }
        // Held so `cancelInFlight` can reach the search as well as the task.
        inFlight = cancel
    }

    private var inFlight: CancelToken?

    private func landReply(token: Int, uci: String?) {
        guard CoachTurn.settle(&controller, token: token) else { return }   // resigned, restarted…
        guard var g = game else { return }
        if let uci = uci { _ = apply(&g, uci: uci) }
        // The premove, if one is queued and still legal in the position that actually arrived.
        let pos = ChessPosition(fen: CoachGame.liveFen(g))
        let queued = CoachTurn.consumePremove(&controller, game: g,
                                              isLegal: { pos?.move(forUCI: $0) != nil })
        if let queued = queued, apply(&g, uci: queued) {
            game = g
            askCoach()
            return
        }
        game = g
    }

    private func cancelInFlight() {
        reviewCancel?.cancel()
        reviewCancel = nil
        reviewTask?.cancel()
        reviewTask = nil
        inFlight?.cancel()
        inFlight = nil
        replyTask?.cancel()
        replyTask = nil
        CoachTurn.invalidate(&controller)
    }

    private func pieceCount(_ pos: ChessPosition) -> Int {
        pos.squares.reduce(0) { $0 + ($1 == nil ? 0 : 1) }
    }

    private func voice(level: Int) -> CoachGame.CoachVoice {
        let p = CoachRoster.of(level: level)
        return CoachGame.CoachVoice(name: p.name, winMsg: p.winMsg, loseMsg: p.loseMsg)
    }

    // MARK: - Game Review (spec §2.10)

    /// Analyse every position at depth 12, then classify.
    ///
    /// The generation counter guards this too: a review abandoned by resigning or starting a new
    /// game must not paint its result over whatever is on screen by then. The engine's
    /// `shouldCancel` reads the same token, so cancelling stops the search rather than its answer.
    func startReview() {
        guard let g = game, CoachReview.isReviewable(g) else { return }
        // Checked AFTER `isReviewable`, so a review that was never going to run does not cost the
        // user one of their three.
        if let reviewGate, !reviewGate() {
            reviewBlocked = true
            return
        }
        cancelInFlight()
        let token = controller.generation
        let plan = CoachReview.plan(from: g)
        review = .running(done: 0, total: plan.positions.count)

        let cancel = CancelToken()
        reviewCancel = cancel
        let limits = SearchLimits(maxDepth: CoachReview.reviewDepth, multiPV: 1)
        let seed = ReviewAnnotator.Evaluator(plan: plan, limits: limits)
        let keys = plan.keys
        let book = OpeningBookLoader.shared

        reviewTask?.cancel()
        reviewTask = Task { [weak self] in
            let walker = await Task.detached(priority: .userInitiated) {
                () -> ReviewAnnotator.Evaluator in
                var w = seed
                while !w.isFinished {
                    if cancel.isCancelled { break }
                    w.step(engine: LocalEngine(), shouldCancel: { cancel.isCancelled })
                    let progress = (w.completed, w.total)
                    Task { @MainActor in
                        guard let self, !cancel.isCancelled else { return }
                        if case .running = self.review {
                            self.review = .running(done: progress.0, total: progress.1)
                        }
                    }
                }
                return w
            }.value
            guard let self, !cancel.isCancelled,
                  CoachTurn.accepts(self.controller, token: token) else { return }
            // `isComplete`, not `isFinished`: a cancelled walk is finished and SHORT, and a
            // truncated review would report an accuracy computed over half a game.
            guard walker.isComplete else {
                await MainActor.run { self.review = nil }
                return
            }
            let base = GameReview.review(evaluations: walker.evaluations, moves: plan.moves)
            let annotated = ReviewAnnotator.annotate(base, moves: plan.moves,
                                                     bookPlies: Set(book.bookPlies(keys)))
            await MainActor.run {
                self.review = .done(CoachReview.Summary(
                    whiteAccuracy: base.whiteAccuracy,
                    blackAccuracy: base.blackAccuracy,
                    whiteClassifications: annotated.whiteClassifications,
                    blackClassifications: annotated.blackClassifications,
                    moveEvaluations: annotated.moveEvaluations,
                    evalGraph: base.evalGraph,
                    displayOrder: ReviewAnnotator.displayOrder,
                    total: plan.positions.count))
            }
        }
    }

    func cancelReview() {
        reviewCancel?.cancel()
        reviewCancel = nil
        reviewTask?.cancel()
        reviewTask = nil
        review = nil
    }

    /// Hand the reviewed game over, and close the modal.
    ///
    /// The payload is READ FROM THE STATE at the moment of the tap. That is the whole of §7 #28:
    /// the RN version captured `reviewData` in a memoised callback whose dependency list omitted
    /// it, so it handed over `nil`'s empty array every time.
    @discardableResult
    func handOffReview() -> CoachReview.Handoff? {
        let payload = reviewHandoff()
        review = nil
        pendingHandoff = payload
        return payload
    }

    /// Set by `handOffReview`, consumed by whatever presents the Analysis Board.
    @Published var pendingHandoff: CoachReview.Handoff?

    /// The payload for the Analysis Board. Nil rather than an empty hand-off (spec §7 #28).
    func reviewHandoff() -> CoachReview.Handoff? {
        guard let g = game, case .done(let summary) = review else { return nil }
        return CoachReview.handoff(g, summary: summary)
    }

    private var reviewTask: Task<Void, Never>?
    private var reviewCancel: CancelToken?

    // MARK: - The buttons

    /// Reviewing pauses the coach (spec §7 #27) — invalidating is what pauses it.
    func seek(_ index: Int?) {
        guard var g = game else { return }
        CoachGame.setReviewIndex(&g, index)
        game = g
        if !CoachGame.isLive(g) { cancelInFlight(); return }
        askCoach()
    }

    func resignConfirmed() {
        cancelInFlight()
        guard var g = game else { return }
        CoachGame.resign(&g, coach: voice(level: g.level))
        CoachGame.saveDraft(g, storage: storage, now: Self.nowMs())
        game = g
        confirmingResign = false
    }

    func takeBack() {
        guard var g = game else { return }
        guard CoachTurn.takeBack(&g, &controller, allowed: allowTakeBack) else { return }
        inFlight?.cancel()
        replyTask?.cancel()
        CoachGame.saveDraft(g, storage: storage, now: Self.nowMs())
        game = g
        askCoach()
    }

    func rematch() {
        guard let g = game else { return }
        cancelInFlight()
        review = nil
        CoachGame.clearDraft(level: g.level, storage: storage)
        start(level: g.level, userColor: g.userColor, resume: nil)
    }

    // MARK: - Premove (§2.8)

    func premove(from: String, to: String, promotion: String?) {
        guard let g = game else { return }
        CoachTurn.setPremove(&controller, game: g, from: from, to: to, promotion: promotion)
    }

    func clearPremove() { CoachTurn.clearPremove(&controller) }
}
