import Foundation

/// The one solver core all five puzzle modes configure (Puzzle Hub spec, Part 5).
///
/// Twin of `web-demo/js/puzzle-session.js`, which is where this logic was written and proven —
/// `swift` is not on PATH on the authoring checkout, so the JS half runs and this half is checked
/// against it by `tools/qa/replay_puzzle_core.js` until it reaches a Mac.
///
/// ## The shape, and why
/// Pure. No timers, no sounds, no database, no view. Every operation is a synchronous state
/// transition that *returns* what should happen next — "play the capture sound", "let the opponent
/// reply in 500 ms", "the run is over" — and the caller owns the clock. The spec writes its
/// algorithm with `after(opponentDelay) { … }` closures; here those become returned numbers, which
/// is what makes all five modes assertable with no test doubles.
///
/// ## The move convention (5.1)
/// `moves[0]` belongs to the **opponent**, so the FEN's side-to-move field names the opponent and
/// the solver is the other colour. `moveIndex` starts at 1 and advances by 2. Every puzzle in the
/// bundle has an even move count — asserted corpus-wide by `tools/qa/puzzle_corpus_check.js` — so
/// the last move in the list is always the solver's.
///
/// ## Never call `PuzzleRatingEngine.compareMoves` from here
/// It is a faithful port of the server's `compareMoves`, which compares the user's move against
/// `moves[0]` — the *opponent's* move — and is spec fix #10. It survives only because the golden
/// vectors pin it. `submit(from:to:promotion:)` validates the real line instead.
public enum PuzzleSession {

    // MARK: - Mode

    public enum Mode: String, Equatable, Codable, Sendable, CaseIterable {
        case play, daily, thematic, streak, turbo
    }

    // MARK: - Timings (Part 17, the Master Timing Table)

    /// Part 17 disagrees with Part 5.3, which says "500 ms everywhere except Puzzle Turbo".
    /// Part 17 gives Daily 400 ms and is the table titled *master*, so it wins.
    /// Recorded in PORTING_NOTES.md.
    public enum Timing {
        public static func opponentDelayMs(_ mode: Mode) -> Int {
            switch mode {
            case .play, .thematic, .streak: return 500
            case .daily: return 400
            case .turbo: return 300
            }
        }
        /// Next puzzle after a Turbo solve or mistake.
        public static let turboAdvanceMs = 500
        /// Lifetime of Turbo's ✓/✕ feedback dot.
        public static let turboFeedbackMs = 500
        /// Lifetime of Daily's wrong-answer banner.
        public static let dailyWrongBannerMs = 1300
        /// Rated timer / Turbo clock tick.
        public static let tickMs = 1000
        /// Daily-goal ring sweep.
        public static let goalRingMs = 400
        /// Draft time-to-live, rated and infinite-Turbo alike.
        public static let draftTTLMs = 24 * 60 * 60 * 1000
        /// Turbo's timed modes, in seconds. Mode 0 is infinite.
        public static func turboSeconds(_ mode: Int) -> Int {
            switch mode {
            case 3: return 180
            case 5: return 300
            default: return 0
            }
        }
    }

    // MARK: - Wrong-move policy (Part 5.5)

    /// The one place the modes genuinely differ. Held as data so the spec's table can be read off
    /// it line for line, rather than as five branches inside `submit`.
    public struct WrongPolicy: Equatable, Sendable {
        /// Does the wrong move get taken back?
        public let undo: Bool
        /// Can the user simply keep trying, with no explicit Retry?
        public let staysPlayable: Bool
        /// Does the whole run end here?
        public let endsRun: Bool
        /// Does it consume one of Turbo's three lives?
        public let costsALife: Bool
        /// Lifetime of the "wrong" banner; `nil` means no timed banner.
        public let bannerMs: Int?
        /// Auto-advance to the next puzzle after this long; `nil` means wait for the user.
        public let advanceMs: Int?
        /// Play the game-over sound.
        public let gameOverSound: Bool
        /// Offer the Retry / Solution buttons.
        public let offersRetry: Bool
    }

    public static func wrongPolicy(_ mode: Mode) -> WrongPolicy {
        switch mode {
        case .play:
            return WrongPolicy(undo: true, staysPlayable: false, endsRun: false, costsALife: false,
                               bannerMs: nil, advanceMs: nil, gameOverSound: false, offersRetry: true)
        case .daily:
            return WrongPolicy(undo: true, staysPlayable: true, endsRun: false, costsALife: false,
                               bannerMs: Timing.dailyWrongBannerMs, advanceMs: nil,
                               gameOverSound: false, offersRetry: true)
        case .thematic:
            return WrongPolicy(undo: true, staysPlayable: false, endsRun: false, costsALife: false,
                               bannerMs: nil, advanceMs: nil, gameOverSound: false, offersRetry: true)
        case .streak:
            return WrongPolicy(undo: true, staysPlayable: false, endsRun: true, costsALife: false,
                               bannerMs: nil, advanceMs: nil, gameOverSound: true, offersRetry: false)
        case .turbo:
            // Turbo does NOT undo: the piece stays on the wrong square under a red ✕ and the next
            // puzzle mounts 500 ms later. Deliberately brutal in the original; kept.
            return WrongPolicy(undo: false, staysPlayable: false, endsRun: false, costsALife: true,
                               bannerMs: nil, advanceMs: Timing.turboAdvanceMs,
                               gameOverSound: false, offersRetry: false)
        }
    }

    /// Part 15.1 — the single predicate, in a single place, so "does Turbo count?" is one edit.
    /// A 3-minute Turbo run can produce 30 solves and would make a 10-a-day goal meaningless.
    public static func countsTowardDailyGoal(_ mode: Mode) -> Bool { mode != .turbo }

    // MARK: - The puzzle

    public struct Puzzle: Equatable, Codable, Sendable {
        public let id: Int
        public let fen: String
        public let moves: [String]
        public let rating: Int
        public let themes: [String]
        public let openingTags: [String]
        public init(id: Int, fen: String, moves: [String], rating: Int,
                    themes: [String] = [], openingTags: [String] = []) {
            self.id = id; self.fen = fen; self.moves = moves
            self.rating = rating; self.themes = themes; self.openingTags = openingTags
        }
    }

    public enum Phase: String, Equatable, Codable, Sendable {
        case loading, playing, solved, failed, reviewing
    }

    public enum Sound: String, Equatable, Codable, Sendable {
        case move, capture, gameStart = "game-start", gameOver = "game-over"
    }

    // MARK: - Outcomes

    public struct SetupResult: Equatable, Sendable {
        public let applied: Bool
        public let sound: Sound?
        public let uci: String?
    }

    public enum Outcome: Equatable, Sendable {
        /// Not a legal move: a silent no-op. No sound, no penalty, no state change.
        case illegal
        /// Submitted while the session was not accepting answers.
        case ignored(Phase)
        /// The board is unlocked after a Solution reveal; nothing is judged.
        case freePlay(sound: Sound, played: String)
        /// The expected move, or any move delivering immediate checkmate.
        case correct(Correct)
        /// Anything else. `policy` is the mode's row from Part 5.5.
        case wrong(Wrong)
    }

    public struct Correct: Equatable, Sendable {
        public let solved: Bool
        public let byCheckmate: Bool
        public let sound: Sound
        public let played: String
        /// Set when the puzzle continues: how long to wait before `applyOpponentReply`.
        public let opponentReplyAfterMs: Int?
    }

    public struct Wrong: Equatable, Sendable {
        public let played: String
        public let expected: String
        public let policy: WrongPolicy
        public let sound: Sound?
        public let mistakes: Int
    }

    public struct ReplyResult: Equatable, Sendable {
        public let applied: Bool
        public let sound: Sound?
        public let uci: String?
        public let solved: Bool
        public let solvedAfterMs: Int?
    }

    public struct RetryResult: Equatable, Sendable {
        public let restartClock: Bool
        public let sound: Sound
        public let setupAfterMs: Int
        public let submitsRating: Bool
    }

    public struct RevealResult: Equatable, Sendable {
        public let runEngine: Bool
        public let maxArrows: Int
        public let remaining: [String]
    }

    // MARK: - The session

    /// A value type: every transition is `mutating`, so a view can hold one and SwiftUI sees the
    /// change without the core knowing SwiftUI exists.
    public struct State: Equatable, Sendable {
        public let puzzle: Puzzle
        public let mode: Mode
        public let userColor: PieceColor
        /// The board is flipped when the solver plays Black, so the solver is always at the bottom.
        public let flipped: Bool
        public private(set) var position: ChessPosition
        public private(set) var moveIndex: Int
        public private(set) var phase: Phase
        public private(set) var lastMove: (from: String, to: String)?
        public private(set) var pendingOpponentIndex: Int?
        public private(set) var mistakes: Int
        public private(set) var solvedByCheckmate: Bool

        public static func == (a: State, b: State) -> Bool {
            a.puzzle == b.puzzle && a.mode == b.mode && a.userColor == b.userColor
                && a.flipped == b.flipped && a.position == b.position
                && a.moveIndex == b.moveIndex && a.phase == b.phase
                && a.lastMove?.from == b.lastMove?.from && a.lastMove?.to == b.lastMove?.to
                && a.pendingOpponentIndex == b.pendingOpponentIndex
                && a.mistakes == b.mistakes && a.solvedByCheckmate == b.solvedByCheckmate
        }

        fileprivate init(puzzle: Puzzle, mode: Mode, position: ChessPosition) {
            self.puzzle = puzzle
            self.mode = mode
            self.position = position
            self.userColor = position.sideToMove.opponent
            self.flipped = position.sideToMove.opponent == .black
            self.moveIndex = 1              // 5.1: index 0 is the opponent's
            self.phase = .loading
            self.lastMove = nil
            self.pendingOpponentIndex = nil
            self.mistakes = 0
            self.solvedByCheckmate = false
        }

        // MARK: Transitions

        /// Part 5.3 step 5 — apply `moves[0]`. Returns the sound the caller should play.
        public mutating func applySetupMove() -> SetupResult {
            guard phase == .loading, let uci = puzzle.moves.first,
                  let m = position.move(forUCI: uci) else {
                return SetupResult(applied: false, sound: nil, uci: nil)
            }
            let captured = PuzzleSession.isCapture(position, m)
            position = position.makeMove(m)
            lastMove = (Square.name(m.from), Square.name(m.to))
            phase = .playing
            return SetupResult(applied: true, sound: captured ? .capture : .move, uci: uci)
        }

        /// Part 5.4 — the one validation algorithm, shared by all five modes.
        public mutating func submit(from: String, to: String, promotion: PieceKind? = nil) -> Outcome {
            if phase == .reviewing { return freePlay(from: from, to: to, promotion: promotion) }
            guard phase == .playing else { return .ignored(phase) }
            guard let m = resolve(from: from, to: to, promotion: promotion) else { return .illegal }

            let next = position.makeMove(m)
            let captured = PuzzleSession.isCapture(position, m)
            let played = m.uci

            // Rule 1 — ANY move that delivers immediate checkmate is correct, even off-book.
            // Present in all five original screens, and checked BEFORE the string comparison: it
            // prevents the "I mated him but the app said wrong" bug when the stored line mates a
            // different way.
            if next.status() == .checkmate {
                commit(next, m)
                phase = .solved
                solvedByCheckmate = true
                return .correct(Correct(solved: true, byCheckmate: true,
                                        sound: captured ? .capture : .move, played: played,
                                        opponentReplyAfterMs: nil))
            }

            guard moveIndex < puzzle.moves.count else { return .illegal }
            if played == puzzle.moves[moveIndex] {
                commit(next, m)
                if moveIndex >= puzzle.moves.count - 1 {
                    phase = .solved
                    return .correct(Correct(solved: true, byCheckmate: false,
                                            sound: captured ? .capture : .move, played: played,
                                            opponentReplyAfterMs: nil))
                }
                pendingOpponentIndex = moveIndex + 1
                return .correct(Correct(solved: false, byCheckmate: false,
                                        sound: captured ? .capture : .move, played: played,
                                        opponentReplyAfterMs: Timing.opponentDelayMs(mode)))
            }
            return handleWrong(next, m, played: played)
        }

        /// Part 5.6 — a pawn landing on the far rank, asked *before* the move is applied because
        /// the promotion piece is an input to the move rather than a follow-up to it.
        public func needsPromotion(from: String, to: String) -> Bool {
            guard let f = Square.index(from), let t = Square.index(to),
                  let p = position.squares[f], p.kind == .pawn else { return false }
            let rank = Square.rank(t)
            return (p.color == .white && rank == 7) || (p.color == .black && rank == 0)
        }

        /// The queued opponent reply from a `correct(solved: false)` outcome.
        public mutating func applyOpponentReply() -> ReplyResult {
            guard let i = pendingOpponentIndex, i < puzzle.moves.count,
                  let m = position.move(forUCI: puzzle.moves[i]) else {
                return ReplyResult(applied: false, sound: nil, uci: nil,
                                   solved: false, solvedAfterMs: nil)
            }
            let captured = PuzzleSession.isCapture(position, m)
            commit(position.makeMove(m), m)
            moveIndex = i + 1
            pendingOpponentIndex = nil
            // Faithful port of the inner branch in 5.4. It is UNREACHABLE for a well-formed
            // puzzle: the opponent's index is always even and `moves.count - 1` is always odd,
            // because every puzzle has an even move count. Kept so the core still terminates
            // rather than hanging if a malformed puzzle ever reaches it.
            if i >= puzzle.moves.count - 1 {
                phase = .solved
                return ReplyResult(applied: true, sound: captured ? .capture : .move,
                                   uci: puzzle.moves[i], solved: true,
                                   solvedAfterMs: Timing.opponentDelayMs(mode))
            }
            return ReplyResult(applied: true, sound: captured ? .capture : .move,
                               uci: puzzle.moves[i], solved: false, solvedAfterMs: nil)
        }

        /// Part 10.3 Retry — back to the mounted-but-not-yet-set-up state.
        ///
        /// Two of the three retry bugs are fixed structurally: the caller receives `restartClock`
        /// and `sound: .gameStart` in the return value, so it cannot forget either the way the
        /// original did (it never reset `startTime`, so a post-retry solve reported time since the
        /// *first* attempt, and it skipped the game-start sound). The third fix — that the rating
        /// delta must survive — is the caller's, because rating is submitted once per puzzle and
        /// this core never touches Elo.
        public mutating func retry() -> RetryResult {
            position = ChessPosition(fen: puzzle.fen) ?? position
            moveIndex = 1
            phase = .loading
            lastMove = nil
            pendingOpponentIndex = nil
            solvedByCheckmate = false
            return RetryResult(restartClock: true, sound: .gameStart,
                               setupAfterMs: Timing.opponentDelayMs(mode), submitsRating: false)
        }

        /// Part 10.3 Solution reveal. Unlocks the board and asks for the engine. It does **not**
        /// auto-play the line, and there is no hint feature.
        public mutating func revealSolution() -> RevealResult {
            phase = .reviewing
            pendingOpponentIndex = nil
            return RevealResult(runEngine: true, maxArrows: 3, remaining: remainingSolution)
        }

        /// The moves the solver has not yet found, from `moveIndex` on.
        public var remainingSolution: [String] {
            moveIndex < puzzle.moves.count ? Array(puzzle.moves[moveIndex...]) : []
        }

        // MARK: Internals

        private mutating func commit(_ next: ChessPosition, _ m: Move) {
            position = next
            lastMove = (Square.name(m.from), Square.name(m.to))
        }

        /// 5.1: `promotion = uci[4]`, defaulting to queen when absent.
        private func resolve(from: String, to: String, promotion: PieceKind?) -> Move? {
            let letter = promotion.map { $0.sanLetter.lowercased() } ?? ""
            if let m = position.move(forUCI: from + to + letter) { return m }
            if promotion == nil { return position.move(forUCI: from + to + "q") }
            return nil
        }

        private mutating func handleWrong(_ next: ChessPosition, _ m: Move,
                                          played: String) -> Outcome {
            let p = PuzzleSession.wrongPolicy(mode)
            if !p.undo { commit(next, m) }          // Turbo: the piece stays where it landed
            mistakes += 1
            pendingOpponentIndex = nil
            // Daily is the only mode that returns to `playing` by itself, once its banner expires;
            // every other mode needs an explicit Retry, a new puzzle, or has ended.
            phase = p.staysPlayable ? .playing : .failed
            let expected = moveIndex < puzzle.moves.count ? puzzle.moves[moveIndex] : ""
            return .wrong(Wrong(played: played, expected: expected, policy: p,
                                sound: p.gameOverSound ? .gameOver : nil, mistakes: mistakes))
        }

        private mutating func freePlay(from: String, to: String,
                                       promotion: PieceKind?) -> Outcome {
            guard let m = resolve(from: from, to: to, promotion: promotion) else { return .illegal }
            let captured = PuzzleSession.isCapture(position, m)
            commit(position.makeMove(m), m)
            return .freePlay(sound: captured ? .capture : .move, played: m.uci)
        }
    }

    // MARK: - Construction

    /// A new session, in `loading`. The caller then plays the game-start sound and calls
    /// `applySetupMove()` after `Timing.opponentDelayMs(mode)` — Part 5.3 steps 4 and 5.
    /// Returns `nil` for an unparseable FEN rather than trapping: the bundle is verified, but a
    /// draft restored from disk is not.
    public static func create(puzzle: Puzzle, mode: Mode) -> State? {
        guard let pos = ChessPosition(fen: puzzle.fen) else { return nil }
        return State(puzzle: puzzle, mode: mode, position: pos)
    }

    /// The solver's colour: the OPPOSITE of the FEN's side to move (5.1).
    public static func userColor(fen: String) -> PieceColor? {
        ChessPosition(fen: fen).map { $0.sideToMove.opponent }
    }

    static func isCapture(_ pos: ChessPosition, _ m: Move) -> Bool {
        if pos.squares[m.to] != nil { return true }
        return pos.squares[m.from]?.kind == .pawn && m.to == pos.enPassant
    }

    // MARK: - Save Puzzle (Part 10.3)

    /// Replay `moves` from `fen` and emit SAN as `1. e4 e5 2. Nf3 …`, terminated by ` *`.
    ///
    /// No `[FEN]` header: the FEN goes in the session's `initialFEN` field, which is how the
    /// Analysis Board already stores a non-standard start. Numbering follows the FEN's own move
    /// counter and side, so a puzzle beginning on Black's move opens `23... Nf6` rather than
    /// silently renumbering from 1.
    public static func solutionPGN(_ puzzle: Puzzle) -> String {
        guard var pos = ChessPosition(fen: puzzle.fen) else { return "" }
        var out: [String] = []
        out.append(pos.sideToMove == .black ? "\(pos.fullmove)..." : "\(pos.fullmove).")
        for (i, uci) in puzzle.moves.enumerated() {
            guard let m = pos.move(forUCI: uci) else { break }
            if i > 0 && pos.sideToMove == .white { out.append("\(pos.fullmove).") }
            out.append(pos.san(for: m))
            pos = pos.makeMove(m)
        }
        return out.joined(separator: " ") + " *"
    }

    /// The Save Puzzle sheet's prefilled notes: the non-empty lines only.
    public static func savePuzzleNotes(_ puzzle: Puzzle) -> String {
        var lines: [String] = ["Rating: \(puzzle.rating)"]
        if !puzzle.themes.isEmpty { lines.append("Themes: " + puzzle.themes.joined(separator: ", ")) }
        if !puzzle.openingTags.isEmpty {
            lines.append("Opening: " + puzzle.openingTags.joined(separator: ", "))
        }
        return lines.joined(separator: "\n")
    }

    public static func savePuzzleName(_ puzzle: Puzzle) -> String { "Puzzle #\(puzzle.id)" }
}
