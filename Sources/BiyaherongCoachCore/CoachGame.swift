import Foundation

/// One game against a coach: the record, the result, and the resumable draft (spec §2.4, §2.9).
///
/// Twin of `web-demo/js/coach-game.js`; `tools/qa/replay_coach.js` checks this source against it.
/// Foundation only. Storage is injected, so nothing here reads a clock or a disk of its own.
public enum CoachGame {

    // MARK: - Values

    /// The persisted colour form.
    ///
    /// `"w"` / `"b"` is what goes in the draft JSON, and what `PairingEngine.Color` already uses, so
    /// one document describes both. The board speaks `PieceColor`, so every crossing goes through
    /// the two converters below rather than an implicit comparison — comparing the two forms
    /// directly is exactly how the JS version first decided that a **mated user had won**.
    public enum Side: String, Equatable, Codable, Sendable {
        case white = "w"
        case black = "b"

        public var engine: PieceColor { self == .black ? .black : .white }
        public static func from(_ c: PieceColor) -> Side { c == .black ? .black : .white }
    }

    public enum Outcome: String, Equatable, Codable, Sendable {
        case win, loss, draw
    }

    public enum Phase: String, Equatable, Sendable {
        case coachSelect, colorSelect, playing
    }

    /// One half-move, or — at index 0 — the start sentinel with a nil `san`.
    ///
    /// `fullMoveNumber` is deliberately absent: the RN struct writes it on every move and nothing
    /// ever reads it. The move strip recomputes pairs from the array index, which is the only
    /// reason dropping it was safe.
    public struct Record: Equatable, Codable, Sendable {
        public var san: String?
        public var fen: String
        public var from: String?
        public var to: String?
        public var color: Side?

        public init(san: String?, fen: String, from: String?, to: String?, color: Side?) {
            self.san = san; self.fen = fen; self.from = from; self.to = to; self.color = color
        }

        public static func start(fen: String = ChessPosition.startFEN) -> Record {
            Record(san: nil, fen: fen, from: nil, to: nil, color: nil)
        }
    }

    public struct Game: Equatable, Sendable {
        public var level: Int
        public var userColor: Side
        public var moveRecords: [Record]
        /// `nil` means LIVE.
        public var reviewIndex: Int?
        public var result: String?
        public var outcome: Outcome?
        public var resigned: Bool

        public init(level: Int, userColor: Side) {
            self.level = level
            self.userColor = userColor
            self.moveRecords = [Record.start()]
            self.reviewIndex = nil
            self.result = nil
            self.outcome = nil
            self.resigned = false
        }
    }

    public static func newGame(level: Int, userColor: Side) -> Game {
        Game(level: level, userColor: userColor)
    }

    // MARK: - Reading the record

    /// Fixed for the whole game — the board does not flip when the coach moves.
    public static func isFlipped(_ g: Game) -> Bool { g.userColor == .black }

    public static func liveFen(_ g: Game) -> String { g.moveRecords[g.moveRecords.count - 1].fen }

    public struct Shown: Equatable, Sendable {
        public let fen: String
        public let from: String?
        public let to: String?
        public let live: Bool
        public let index: Int
    }

    /// What the board should show.
    ///
    /// LIVE is the newest record; otherwise the record at `reviewIndex`, with the highlight taken
    /// from **that record's** own from/to — reviewing move 4 must highlight move 4, not whatever was
    /// played last.
    public static func displayPosition(_ g: Game) -> Shown {
        let idx = g.reviewIndex ?? (g.moveRecords.count - 1)
        let rec = g.moveRecords[idx]
        return Shown(fen: rec.fen, from: rec.from, to: rec.to, live: g.reviewIndex == nil, index: idx)
    }

    /// Jumping to the newest index returns to LIVE, rather than pinning to the last record.
    public static func setReviewIndex(_ g: inout Game, _ index: Int?) {
        guard let i = index, i < g.moveRecords.count - 1 else { g.reviewIndex = nil; return }
        g.reviewIndex = Swift.max(0, i)
    }

    public static func isLive(_ g: Game) -> Bool { g.reviewIndex == nil }

    // MARK: - Repetition

    /// The first THREE FEN fields — pieces, side to move, castling.
    ///
    /// The RN key used four, including the en-passant target, and an ep square is emitted after any
    /// double pawn push whether or not a capture is legal. Identical positions therefore hashed
    /// differently and real threefolds were missed (spec §7 #30).
    public static func repetitionKey(_ fen: String) -> String {
        fen.split(separator: " ", omittingEmptySubsequences: false).prefix(3).joined(separator: " ")
    }

    public static func repetitionCount(_ g: Game, fen: String? = nil) -> Int {
        let key = repetitionKey(fen ?? liveFen(g))
        return g.moveRecords.reduce(0) { $0 + (repetitionKey($1.fen) == key ? 1 : 0) }
    }

    public static func isThreefold(_ g: Game) -> Bool { repetitionCount(g) >= 3 }

    // MARK: - Game over

    /// The six result lines.
    ///
    /// Duplicated in `CoachStrings` on purpose — this layer is pure domain logic and must not import
    /// a presentation layer — and `replay_coach.js` pins the two copies identical. Allow the
    /// duplication, forbid the divergence.
    public enum Str {
        public static let threefold = "Draw by threefold repetition!"
        public static let stalemate = "Stalemate \u{2014} It's a draw!"
        public static let fiftyMove = "Draw by the fifty-move rule."
        public static let insufficient = "Draw \u{2014} not enough material to mate."
        public static let genericDraw = "Draw! A well-balanced battle."
        public static func resign(_ coachName: String) -> String {
            "You resigned. \(coachName) wins this round!"
        }
    }

    public struct Over: Equatable, Sendable {
        public let result: String
        public let outcome: Outcome
    }

    /// What the coach contributes to a result line.
    public struct CoachVoice: Equatable, Sendable {
        public let name: String
        /// Shown when the USER is mated.
        public let winMsg: String
        public let loseMsg: String

        public init(name: String, winMsg: String, loseMsg: String) {
            self.name = name; self.winMsg = winMsg; self.loseMsg = loseMsg
        }
    }

    /// Evaluated after EVERY half-move — the user's, the book's and the engine's alike. A game that
    /// only checks after the user moves is a game that lets the coach deliver mate and carry on.
    public static func evaluate(_ g: Game, coach: CoachVoice?) -> Over? {
        if g.resigned {
            return Over(result: Str.resign(coach?.name ?? ""), outcome: .loss)
        }
        guard let pos = ChessPosition(fen: liveFen(g)) else { return nil }
        let status = pos.status()

        if status == .checkmate {
            // The side to move is mated. If that is the user, they lost.
            let userMated = Side.from(pos.sideToMove) == g.userColor
            return Over(result: userMated ? (coach?.winMsg ?? "") : (coach?.loseMsg ?? ""),
                        outcome: userMated ? .loss : .win)
        }
        // Threefold before stalemate: both are draws, but the reason shown should be the one that
        // actually happened, and a repeated position can also be stalemate.
        if isThreefold(g) { return Over(result: Str.threefold, outcome: .draw) }
        if status == .stalemate { return Over(result: Str.stalemate, outcome: .draw) }
        if isFiftyMove(pos) { return Over(result: Str.fiftyMove, outcome: .draw) }
        // The board has no insufficient-material test of its own, so it is computed here: spec §7
        // #31 wants this ending named rather than folded into the generic draw, which means it has
        // to be detectable, and `status()` reports only stalemate and checkmate.
        if isInsufficientMaterial(pos) { return Over(result: Str.insufficient, outcome: .draw) }
        return nil
    }

    public static func isFiftyMove(_ pos: ChessPosition) -> Bool { pos.halfmove >= 100 }

    /// K vs K, K+minor vs K, and K+B vs K+B with every bishop on one colour.
    ///
    /// Anything with a pawn, rook or queen can still mate, and two knights cannot *force* mate but
    /// the position is not dead, so FIDE does not call it a draw either.
    public static func isInsufficientMaterial(_ pos: ChessPosition) -> Bool {
        var bishopColors: [Int] = []
        var knights = 0
        var others = 0
        for sq in 0..<64 {
            guard let p = pos.squares[sq] else { continue }
            if p.kind == .king { continue }
            if p.kind == .bishop {
                // Light or dark square, so bishops on one colour can be told from a real pair.
                bishopColors.append(((sq / 8) + (sq % 8)) % 2)
                continue
            }
            if p.kind == .knight { knights += 1; continue }
            others += 1
        }
        if others > 0 { return false }
        if knights == 0 && bishopColors.isEmpty { return true }             // K vs K
        if knights + bishopColors.count == 1 { return true }                // K + one minor
        if knights == 0 && bishopColors.count >= 2 {
            return bishopColors.allSatisfy { $0 == bishopColors[0] }
        }
        return false
    }

    @discardableResult
    public static func applyEvaluation(_ g: inout Game, coach: CoachVoice?) -> Over? {
        guard let over = evaluate(g, coach: coach) else { return nil }
        g.result = over.result
        g.outcome = over.outcome
        return over
    }

    public static func isOver(_ g: Game) -> Bool { g.outcome != nil }

    // MARK: - Moves

    /// Record a move. Returns the new record, or nil if it is not legal here.
    ///
    /// Recording appends and returns the board to LIVE: making a move while reviewing an earlier
    /// position must not leave the player looking at history.
    @discardableResult
    public static func record(_ g: inout Game, uci: String) -> Record? {
        if isOver(g) { return nil }
        guard let pos = ChessPosition(fen: liveFen(g)),
              let move = pos.move(forUCI: uci) else { return nil }
        let san = pos.san(for: move)
        let next = pos.makeMove(move)
        let rec = Record(san: san,
                         fen: next.fen,
                         from: String(uci.prefix(2)),
                         to: String(uci.dropFirst(2).prefix(2)),
                         color: Side.from(pos.sideToMove))
        g.moveRecords.append(rec)
        g.reviewIndex = nil
        return rec
    }

    @discardableResult
    public static func resign(_ g: inout Game, coach: CoachVoice?) -> Over? {
        g.resigned = true
        return applyEvaluation(&g, coach: coach)
    }

    /// Whose turn it is, from the live position rather than a counter that can drift.
    public static func sideToMove(_ g: Game) -> Side {
        guard let pos = ChessPosition(fen: liveFen(g)) else { return .white }
        return Side.from(pos.sideToMove)
    }

    public static func isUserTurn(_ g: Game) -> Bool { sideToMove(g) == g.userColor }

    /// The SAN list the opening book matches against. The sentinel has no SAN, so it is skipped.
    public static func sanHistory(_ g: Game) -> [String] {
        g.moveRecords.dropFirst().compactMap { $0.san }
    }

    // MARK: - Draft (spec §2.9)

    public static let draftKeyPrefix = "biya.coach.draft.v1."
    /// Seven days, not the 24 hours the puzzle drafts use: this is a full game, not an attempt.
    public static let draftTTLms = 7 * 24 * 60 * 60 * 1000

    public static func draftKey(level: Int) -> String { "\(draftKeyPrefix)\(level)" }

    /// The persisted shape. Deliberately not `Game`: the result, the outcome and the review index
    /// are all session state, and a draft that restored them would restore a modal too (§7 #34).
    public struct Draft: Codable, Equatable, Sendable {
        public var level: Int
        public var userColor: Side
        public var moveRecords: [Record]
        public var savedAt: Int
    }

    /// Anything that can hold a string by key. The store injects the real one.
    public protocol Storage {
        func get(_ key: String) -> String?
        func set(_ key: String, _ value: String)
        func remove(_ key: String)
    }

    @discardableResult
    public static func saveDraft(_ g: Game, storage: Storage, now: Int) -> Bool {
        // A finished game has nothing to resume.
        if isOver(g) { clearDraft(level: g.level, storage: storage); return false }
        let payload = Draft(level: g.level, userColor: g.userColor,
                            moveRecords: g.moveRecords, savedAt: now)
        guard let data = try? JSONEncoder().encode(payload),
              let text = String(data: data, encoding: .utf8) else { return false }
        storage.set(draftKey(level: g.level), text)
        return true
    }

    public static func clearDraft(level: Int, storage: Storage) {
        storage.remove(draftKey(level: level))
    }

    /// Restore, or nil.
    ///
    /// Anything malformed DELETES the key rather than being repaired or ignored: a draft that cannot
    /// be read will fail again on the next launch, and leaving it there turns one bad save into a
    /// permanently broken Resume button.
    public static func loadDraft(level: Int, storage: Storage, now: Int) -> Game? {
        guard let raw = storage.get(draftKey(level: level)), !raw.isEmpty else { return nil }
        guard let data = raw.data(using: .utf8),
              let d = try? JSONDecoder().decode(Draft.self, from: data),
              !d.moveRecords.isEmpty else {
            clearDraft(level: level, storage: storage)
            return nil
        }
        if now - d.savedAt > draftTTLms {
            clearDraft(level: level, storage: storage)
            return nil
        }
        // Every record must carry a FEN the board can actually read, or the game cannot be rebuilt.
        for r in d.moveRecords where ChessPosition(fen: r.fen) == nil {
            clearDraft(level: level, storage: storage)
            return nil
        }
        var g = newGame(level: d.level, userColor: d.userColor)
        g.moveRecords = d.moveRecords
        return g
    }
}
