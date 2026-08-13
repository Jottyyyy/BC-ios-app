import Foundation

/// Whose turn it is, the premove, the review nav rules — and the generation counter that makes four
/// of spec §7's concurrency defects one fix (§2.7, §2.8, §2.12).
///
/// Twin of `web-demo/js/coach-turn.js`; `tools/qa/replay_coach.js` checks this source against it.
///
/// ## One counter, not four flags
///
/// Every asynchronous reply carries the generation it was started in and is dropped unless that
/// generation still matches. Resign, New Game, take-back and entering review all bump the counter,
/// so §7 **#25** (a ghost move on a resigned board), **#26** (uncleared timers), **#27** (the engine
/// moving underneath a review) and **#29** (the resign / new-game race) stop being four separate
/// things to remember. Anything else — a flag that was supposed to be cleared, a timer that was
/// supposed to be cancelled — is a second source of truth, and the second source is the bug.
public enum CoachTurn {

    /// A queued premove, in the algebraic form `consumePremove` reassembles into a UCI string.
    public struct Premove: Equatable, Sendable {
        public let from: String
        public let to: String
        /// Explicit and optional. The RN premove always auto-queened (§7 #32), which loses every
        /// underpromotion; carrying it means the caller can ask.
        public let promotion: String?
    }

    public struct Controller: Equatable, Sendable {
        public var generation: Int = 0
        public var premove: Premove?
        /// True between asking for a reply and it landing, purely so the UI can show a spinner.
        public var thinking: Bool = false

        public init() {}
    }

    public static func create() -> Controller { Controller() }

    /// Invalidate everything in flight.
    ///
    /// Returns the new generation so the caller can hold it if it wants to start something
    /// immediately afterwards.
    @discardableResult
    public static func invalidate(_ c: inout Controller) -> Int {
        c.generation += 1
        c.thinking = false
        // A premove belongs to the position it was made in. Surviving a take-back or a new game is
        // how it would end up applied to a board it was never meant for.
        c.premove = nil
        return c.generation
    }

    /// Stamp a reply that is about to be started.
    @discardableResult
    public static func begin(_ c: inout Controller) -> Int {
        c.thinking = true
        return c.generation
    }

    /// May a reply stamped `token` still be applied? The one question this file exists to answer.
    public static func accepts(_ c: Controller, token: Int) -> Bool { token == c.generation }

    @discardableResult
    public static func settle(_ c: inout Controller, token: Int) -> Bool {
        guard accepts(c, token: token) else { return false }
        c.thinking = false
        return true
    }

    // MARK: - Whose turn

    /// Should the coach be asked to move right now?
    ///
    /// Reviewing counts as "no" (§7 #27). The RN app kept playing underneath a review, so you would
    /// look up from move 6 to find the game three moves further on and the board no longer the one
    /// you were reading.
    public static func shouldCoachMove(_ g: CoachGame.Game, _ c: Controller) -> Bool {
        if CoachGame.isOver(g) { return false }
        if !CoachGame.isLive(g) { return false }
        if c.thinking { return false }
        return !CoachGame.isUserTurn(g)
    }

    /// May the user move a piece right now?
    public static func canUserMove(_ g: CoachGame.Game, _ c: Controller) -> Bool {
        if CoachGame.isOver(g) { return false }
        if !CoachGame.isLive(g) { return false }
        // While the coach is thinking the user may still PREMOVE, but not move.
        if c.thinking { return false }
        return CoachGame.isUserTurn(g)
    }

    // MARK: - Premove (§2.8)

    /// Queue a premove. Only while the coach is thinking, and only one at a time — a second replaces
    /// the first rather than stacking.
    @discardableResult
    public static func setPremove(_ c: inout Controller, game: CoachGame.Game,
                                  from: String, to: String, promotion: String?) -> Bool {
        if CoachGame.isOver(game) { return false }
        if !c.thinking { return false }
        c.premove = Premove(from: from, to: to, promotion: promotion)
        return true
    }

    @discardableResult
    public static func clearPremove(_ c: inout Controller) -> Bool {
        let had = c.premove != nil
        c.premove = nil
        return had
    }

    /// Take the queued premove, if it is still legal in the position that has arrived.
    ///
    /// Always CONSUMES it either way: a premove that turned out to be illegal has been spent, and
    /// leaving it queued would fire it at the *next* position instead — the same class of bug as the
    /// ghost move.
    public static func consumePremove(_ c: inout Controller, game: CoachGame.Game,
                                      isLegal: ((String) -> Bool)? = nil) -> String? {
        let p = c.premove
        c.premove = nil
        guard let p = p else { return nil }
        if CoachGame.isOver(game) { return nil }
        let uci = p.from + p.to + (p.promotion ?? "")
        if let isLegal = isLegal, !isLegal(uci) { return nil }
        return uci
    }

    // MARK: - Review navigation (§2.7)

    public struct NavState: Equatable, Sendable {
        public let index: Int
        public let last: Int
        public let canFirst: Bool
        public let canPrev: Bool
        public let canNext: Bool
        public let canLast: Bool
        public let canLive: Bool
    }

    /// What the four nav buttons and the Live button allow.
    ///
    /// `⏮` and `◀` share ONE rule (§7 #37): both mean "there is something earlier than what I am
    /// looking at". The RN app disabled them on different conditions, so at move 1 one was live and
    /// the other dead — which reads as a bug even when it is only an inconsistency.
    public static func navState(_ g: CoachGame.Game) -> NavState {
        let last = g.moveRecords.count - 1
        let at = CoachGame.isLive(g) ? last : (g.reviewIndex ?? last)
        let hasEarlier = at > 0
        return NavState(index: at,
                        last: last,
                        canFirst: hasEarlier,
                        canPrev: hasEarlier,
                        canNext: at < last,
                        canLast: at < last,
                        // Only meaningful when you are not already live.
                        canLive: !CoachGame.isLive(g))
    }

    /// Take-back removes the last full move pair, and invalidates anything in flight.
    @discardableResult
    public static func takeBack(_ g: inout CoachGame.Game, _ c: inout Controller,
                                allowed: Bool) -> Bool {
        guard allowed else { return false }
        if CoachGame.isOver(g) { return false }
        // Both halves, so the user is on move again rather than staring at the coach's reply.
        var removed = 0
        while g.moveRecords.count > 1 && removed < 2 {
            g.moveRecords.removeLast()
            removed += 1
            if CoachGame.isUserTurn(g) { break }
        }
        if removed == 0 { return false }
        g.reviewIndex = nil
        invalidate(&c)
        return true
    }
}
