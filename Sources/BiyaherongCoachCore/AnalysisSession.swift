import Foundation

// The Analysis Board's behaviour, with no screen attached.
//
// Everything the board DOES — what the status line says, which opening you are in, which arrows to
// draw, what the engine rows read, whether the current analysis is stale, and what the move strip's
// tokens are — is a pure function of state. None of it needs a renderer, so none of it lives in the
// view model.
//
// That is the same trade `AnalysisMetrics` made for numbers, applied to state, and it is what lets
// ParityRunner's `analysis_session` group assert the screen's behaviour on a machine with no UI.
// `AnalysisVM` (BiyaherongUI) and `web-demo/js/analysis.js`'s view half are thin shells over this:
// they own threading, I/O and pixels, nothing else.
//
// Ported from ../BYAHERONG-COACH-FRONTEND/app/(app)/user/analysis-board/board.tsx. Line references
// below point at that file. Deviations are marked DEVIATION and recorded in PORTING_NOTES.
//
// Mirrored line-for-line by web-demo/js/analysis.js's pure layer.
//
// NOT `Sendable`: it owns a `MoveTree`, which is a reference graph. Keep it in one isolation domain
// (`@MainActor` in the UI) and hand the background only `ChessPosition` / `SearchLimits`, which are.

/// One engine arrow: a move plus its rank in the line list (0 = best).
public struct ArrowSpec: Equatable, Sendable {
    public let from: Int
    public let to: Int
    public let rank: Int
    public init(from: Int, to: Int, rank: Int) {
        self.from = from; self.to = to; self.rank = rank
    }
}

/// One row of the engine panel: eval · SAN · continuation (board.tsx:2807-2831).
public struct EngineRow: Equatable, Sendable {
    public let rank: Int
    public let evalText: String
    public let san: String
    public let continuation: String
    public let uci: String
    public let from: Int
    public let to: Int
    public let depth: Int
    public init(rank: Int, evalText: String, san: String, continuation: String,
                uci: String, from: Int, to: Int, depth: Int) {
        self.rank = rank; self.evalText = evalText; self.san = san
        self.continuation = continuation; self.uci = uci
        self.from = from; self.to = to; self.depth = depth
    }
}

/// One row of the accuracy modal's count table.
public struct ReviewCountRow: Equatable, Sendable {
    public let key: String
    public let white: Int
    public let black: Int
    public init(key: String, white: Int, black: Int) {
        self.key = key; self.white = white; self.black = black
    }
}

/// One point of the eval graph, white-relative.
public struct ReviewGraphPoint: Equatable, Sendable {
    public let cp: Int?
    public let mate: Int?
    public init(cp: Int?, mate: Int?) { self.cp = cp; self.mate = mate }
}

/// What the accuracy modal renders.
///
/// Labels, symbols and colours are deliberately absent: they need the metrics tables, which live in
/// the UI module and cannot be reached from a Foundation-only Core. Same boundary `EvalParts` draws.
public struct ReviewSummary: Equatable, Sendable {
    public let whiteAccuracy: Double
    public let blackAccuracy: Double
    /// In `displayOrder`, with tiers that are zero on BOTH sides dropped (board.tsx:3887).
    public let rows: [ReviewCountRow]
    public let graph: [ReviewGraphPoint]
    public init(whiteAccuracy: Double, blackAccuracy: Double,
                rows: [ReviewCountRow], graph: [ReviewGraphPoint]) {
        self.whiteAccuracy = whiteAccuracy; self.blackAccuracy = blackAccuracy
        self.rows = rows; self.graph = graph
    }
}

/// One token of the horizontal move strip (board.tsx:3049-3120).
public struct StripToken: Equatable, Sendable {
    /// Raw values match the JS twin's strings so the two tables can be diffed by eye.
    public enum Kind: String, Sendable, Equatable {
        case number = "num"
        case move
        case alternative = "alt"
    }
    public let kind: Kind
    /// The node this token navigates to; 0 for a move-number token.
    public let id: Int
    public let text: String
    public let isCurrent: Bool
    public let isOnPath: Bool
    /// The review tier for this move, or nil. Always nil for number tokens and branch chips —
    /// review walks the main line only, and the source's chip renderer ignores it too.
    public let classification: String?
    public init(kind: Kind, id: Int, text: String, isCurrent: Bool, isOnPath: Bool,
                classification: String? = nil) {
        self.kind = kind; self.id = id; self.text = text
        self.isCurrent = isCurrent; self.isOnPath = isOnPath
        self.classification = classification
    }
}

/// The white-relative score split into the raw parts a presentation layer needs.
///
/// This is the boundary between the shared session layer and the per-platform UI: turning a score
/// into a bar fraction or a ⩲ symbol needs the metrics tables, which live in the UI module and are
/// unreachable from a Foundation-only Core. The session publishes numbers; each platform maps them
/// with the same table.
public struct EvalParts: Equatable, Sendable {
    public let cp: Int?
    public let mate: Int?
    /// Set only when the game is already over; names the side that delivered mate.
    public let winner: PieceColor?
    public init(cp: Int?, mate: Int?, winner: PieceColor?) {
        self.cp = cp; self.mate = mate; self.winner = winner
    }
}

public final class AnalysisSession {

    // MARK: - State

    /// `private(set)`: reads are free, but only `replaceTree` may swap it, because every derived
    /// cache and the review have to be dropped at the same moment.
    public private(set) var tree: MoveTree
    public var book: OpeningBook?
    /// The latest engine result, or nil when nothing has been searched for this position.
    public var snapshot: AnalysisSnapshot?
    /// A search is in flight right now.
    public var analyzing = false
    public var autoAnalyze = true
    public var autoplaying = false
    public var flipped = false
    public var selected: Int?

    /// The completed review, or nil when the game has not been reviewed.
    public private(set) var review: ReviewAnnotator.Annotated?
    /// node id -> classification key, built once when a review lands.
    private var reviewByNodeID: [Int: String] = [:]
    /// `(completed, total)` while a review is running.
    public var reviewProgress: (completed: Int, total: Int)?

    /// `MoveNode.position` re-parses a FEN on every access, and half a dozen derived properties
    /// need it, so it is parsed once per cursor position and cached.
    private var cachedPosition: ChessPosition
    private var cachedForNodeID: Int

    public init?(initialFEN: String = ChessPosition.startFEN, book: OpeningBook? = nil) {
        guard let tree = MoveTree(initialFEN: initialFEN),
              let pos = tree.current.position else { return nil }
        self.tree = tree
        self.book = book
        self.cachedPosition = pos
        self.cachedForNodeID = tree.current.id
    }

    // MARK: - Derived state (all pure)

    public var position: ChessPosition {
        if cachedForNodeID != tree.current.id, let p = tree.current.position {
            cachedPosition = p
            cachedForNodeID = tree.current.id
        }
        return cachedPosition
    }

    /// Root-to-cursor position keys — what `drawReason` and `terminalOutcome` need.
    public var historyKeys: [String] { MoveTree.historyKeys(to: tree.current) }

    public var outcome: TerminalOutcome { position.terminalOutcome(historyKeys: historyKeys) }

    /// The status line (board.tsx:2853-2871).
    ///
    /// TWO DELIBERATE DEVIATIONS from that source, both recorded in PORTING_NOTES:
    ///
    ///  1. The move number. The original computes `floor(node.halfMoveIndex / 2) + 1` — the number
    ///     of the move just PLAYED — so after 1.e4 e5 it reads "1. White's move" when the next move
    ///     is 2. We use the position's own `fullmove`, which is what a chess player reads. This is a
    ///     UI port, not a golden-tested algorithm, so no parity contract is broken.
    ///  2. "(analyzing)" is appended on `isAnalyzing || autoAnalyze` in the original, so it shows
    ///     permanently whenever auto-analyse is on, idle or not. Here it tracks a real search.
    public var statusText: String {
        if autoplaying { return "▶ Autoplay..." }
        let pos = position
        let o = pos.terminalOutcome(historyKeys: historyKeys)
        if o.kind == .checkmate { return "Checkmate!" }
        if o.kind == .draw { return o.reason == .stalemate ? "Stalemate" : "Draw" }

        let white = pos.sideToMove == .white
        var text = "\(pos.fullmove)\(white ? "." : "...") \(white ? "White's move" : "Black's move")"
        if analyzing { text += "\n(analyzing)" }
        if pos.status() == .check { text += " +" }
        return text
    }

    /// The opening at the cursor. Walks root→cursor so a position that is in book but unnamed keeps
    /// the last named line — twenty moves into the Najdorf still reads "Najdorf" (spec 12.2).
    public var openingEntry: OpeningBook.Entry? {
        guard let book else { return nil }
        var last: OpeningBook.Entry?
        for node in MoveTree.line(to: tree.current) {
            last = book.nameFor(node.key, lastKnown: last)
        }
        return last
    }

    /// `ECO: Name`, or nil when nothing along the line has ever been named.
    public var openingText: String? {
        guard let e = openingEntry else { return nil }
        return "\(e.eco): \(e.name)"
    }

    /// Book continuations from the cursor — the ECO panel's rows, replacing the masters explorer.
    public var bookContinuations: [OpeningBook.Continuation] {
        book?.continuations(from: position) ?? []
    }

    /// One arrow per engine line, rank 0 = best. Drawn straight from the PV's first move.
    public var arrows: [ArrowSpec] {
        guard let lines = snapshot?.lines else { return [] }
        var out: [ArrowSpec] = []
        for (i, line) in lines.enumerated() {
            guard let first = line.pv.first else { continue }
            out.append(ArrowSpec(from: first.from, to: first.to, rank: i))
        }
        return out
    }

    /// How many PV plies an engine row shows after the move itself (board.tsx:2827).
    public static let pvPreview = 6

    public var engineRows: [EngineRow] { AnalysisSession.engineRows(from: snapshot) }

    /// The same rows, from a snapshot alone.
    ///
    /// Static because the puzzle hub's suggestions panel is the *same panel* — eval, SAN and the
    /// PV preview — and it has no `AnalysisSession` to hang off. Duplicating six lines of
    /// formatting there would have meant two places to get `pvPreview` and `displayText` right.
    public static func engineRows(from snapshot: AnalysisSnapshot?) -> [EngineRow] {
        guard let lines = snapshot?.lines else { return [] }
        // A plain loop rather than `enumerated().map { i, line in … }`: this module is written
        // without a compiler, and closure-over-tuple destructuring is the kind of thing that is
        // easy to get subtly wrong. Nothing is gained by the shorter form.
        var out: [EngineRow] = []
        out.reserveCapacity(lines.count)
        for (i, line) in lines.enumerated() {
            let first = line.pv.first
            var tail: [String] = []
            if line.pvSAN.count > 1 {
                let end = min(line.pvSAN.count, 1 + AnalysisSession.pvPreview)
                tail = Array(line.pvSAN[1..<end])
            }
            out.append(EngineRow(rank: i,
                                 evalText: line.score.displayText,
                                 san: line.pvSAN.first ?? "",
                                 continuation: tail.joined(separator: " "),
                                 uci: first?.uci ?? "",
                                 from: first?.from ?? -1,
                                 to: first?.to ?? -1,
                                 depth: line.depth))
        }
        return out
    }

    public var evalParts: EvalParts {
        guard let score = snapshot?.score else { return EvalParts(cp: nil, mate: nil, winner: nil) }
        switch score {
        case .cp(let c): return EvalParts(cp: c, mate: nil, winner: nil)
        case .mate(let m): return EvalParts(cp: nil, mate: m, winner: nil)
        case .terminal(let t):
            return EvalParts(cp: nil, mate: nil, winner: t.kind == .checkmate ? t.winner : nil)
        }
    }

    /// Does the snapshot describe some OTHER position than the one we are looking at?
    ///
    /// This is the whole restart policy. The original guarded with
    /// `if (isAnalyzing || fen === lastAnalyzedFen) return;` (board.tsx:885) — and because its fetch
    /// could not be cancelled, moving during a request silently dropped the new position and the
    /// panel kept showing stale lines forever. Our engine IS cancellable, so staleness means
    /// "cancel and restart", never "skip".
    public var isStale: Bool {
        guard let snapshot else { return true }
        return snapshot.fen != position.fen
    }

    /// Should a search start right now?
    public var wantsAnalysis: Bool {
        autoAnalyze && !autoplaying && isStale && outcome.kind == .ongoing
    }

    // MARK: - Annotations
    //
    // The source stores a SYMBOL string on the node (`node.annotation`). We store the NAG code,
    // because `MoveNode.nag` already exists, `PGN` already round-trips `$n`, and a symbol string
    // would be a second encoding of the same fact — the drift this repo keeps catching.

    /// NAG code → the symbol shown after the SAN. `nag(forSymbol:)` is the exact inverse.
    ///
    /// The six move-quality codes are the source's suffixes; the position codes are standard PGN.
    /// `$13` (∞) is display-only: it can arrive in an imported PGN, but the source's picker has no
    /// button for it, so ours does not either.
    public static let nagSymbols: [Int: String] = [
        1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!",
        10: "=", 13: "∞", 14: "⩲", 15: "⩱", 16: "±", 17: "∓", 18: "+-", 19: "-+",
    ]

    public static func nagText(_ nag: Int) -> String { nagSymbols[nag] ?? "" }

    /// Symbol → NAG, derived from the table so the two can never disagree. 0 means "no annotation".
    public static func nag(forSymbol symbol: String) -> Int {
        for (code, sym) in nagSymbols where sym == symbol { return code }
        return 0
    }

    /// Attach (or with `nag: 0`, remove) an annotation. Mirrors `setMoveAnnotation:2552`.
    @discardableResult
    public func setNAG(_ nag: Int, forNodeID nodeID: Int) -> Bool {
        guard let n = node(id: nodeID), n !== tree.root else { return false }
        n.nag = nag
        return true
    }

    @discardableResult
    public func clearNAG(forNodeID nodeID: Int) -> Bool { setNAG(0, forNodeID: nodeID) }

    /// The glyph the board overlay draws for a node, or nil.
    ///
    /// Deliberately the MANUAL annotation only. `renderAnnotationOverlay:2666` reads
    /// `currentNode.annotation` and never touches `reviewClassification`, and it looks the symbol up
    /// in `MOVE_ANNOTATIONS` alone — so a *position* annotation like `±` shows in the strip but
    /// draws no badge. Both details are ported as they are.
    public func annotationSymbol(forNodeID nodeID: Int) -> String? {
        guard let n = node(id: nodeID), n.nag != 0,
              let sym = AnalysisSession.nagSymbols[n.nag],
              (1...6).contains(n.nag) else { return nil }
        return sym
    }

    /// The square the badge sits on: where the current move landed. nil at the root.
    public var annotationSquare: Int? { tree.current.move?.to }

    /// The horizontal move strip (board.tsx:3049-3120): the MAIN LINE as a flat token run, with each
    /// position's alternatives inserted inline as chips right after the main move they branch from.
    /// It is not a nested tree — that is what makes one horizontal scroller enough.
    public var stripTokens: [StripToken] {
        let main = tree.mainline()
        if main.isEmpty { return [] }
        var onPath = Set<Int>()
        for n in MoveTree.line(to: tree.current) { onPath.insert(n.id) }
        let curID = tree.current.id
        var out: [StripToken] = []

        for node in main {
            if node.color == .white {
                out.append(StripToken(kind: .number, id: 0, text: "\(node.moveNumber).",
                                      isCurrent: false, isOnPath: false))
            }
            out.append(StripToken(kind: .move, id: node.id,
                                  text: node.san + AnalysisSession.nagText(node.nag),
                                  isCurrent: node.id == curID, isOnPath: onPath.contains(node.id),
                                  classification: reviewByNodeID[node.id]))
            for alt in node.parent?.children ?? [] where alt.id != node.id {
                let prefix = "\(alt.moveNumber)" + (alt.color == .white ? "." : "...")
                out.append(StripToken(kind: .alternative, id: alt.id,
                                      text: prefix + alt.san + AnalysisSession.nagText(alt.nag),
                                      isCurrent: alt.id == curID,
                                      isOnPath: onPath.contains(alt.id)))
            }
        }
        return out
    }

    /// Load a different game into this session — opening a saved one, or restoring a draft.
    ///
    /// Everything derived from the old tree goes with it: the engine snapshot describes a position
    /// that is no longer on the board, and the review's node ids belong to nodes that no longer
    /// exist. Dropping them here rather than at the call site is what stops a stale classification
    /// reappearing on an unrelated move.
    public func replaceTree(_ newTree: MoveTree) {
        tree = newTree
        if let p = newTree.current.position { cachedPosition = p }
        cachedForNodeID = newTree.current.id
        snapshot = nil
        selected = nil
        autoplaying = false      // the old game's playback has nothing to walk through any more
        applyReview(nil, nodes: [])
    }

    // MARK: - Review

    /// Stamp a completed review onto the session, or pass `nil` to clear it.
    ///
    /// The index rule is the trap: `moveIndex` is **1-based** (0 is the starting position) while the
    /// plan's nodes are 0-based, so the node for an evaluation is `nodes[moveIndex - 1]`. The RN
    /// source does the same `- 1` (`applyClassificationsToTree`, board.tsx:1827). Main line only.
    public func applyReview(_ annotated: ReviewAnnotator.Annotated?, nodes: [MoveNode]) {
        reviewProgress = nil
        guard let annotated else {
            review = nil
            reviewByNodeID = [:]
            return
        }
        var byID: [Int: String] = [:]
        for me in annotated.moveEvaluations {
            let i = me.moveIndex - 1
            guard i >= 0, i < nodes.count else { continue }
            byID[nodes[i].id] = me.classification
        }
        review = annotated
        reviewByNodeID = byID
    }

    /// The classification of the move that reached `nodeID`, or nil.
    public func classification(forNodeID nodeID: Int) -> String? { reviewByNodeID[nodeID] }

    public var reviewSummary: ReviewSummary? {
        guard let review else { return nil }
        var rows: [ReviewCountRow] = []
        for key in ReviewAnnotator.displayOrder {
            let w = review.whiteClassifications[key] ?? 0
            let b = review.blackClassifications[key] ?? 0
            if w == 0 && b == 0 { continue }
            rows.append(ReviewCountRow(key: key, white: w, black: b))
        }
        return ReviewSummary(
            whiteAccuracy: review.base.whiteAccuracy,
            blackAccuracy: review.base.blackAccuracy,
            rows: rows,
            graph: review.base.evalGraph.map { ReviewGraphPoint(cp: $0.evalCp, mate: $0.evalMate) })
    }

    /// The last move played on the way to the cursor — what the board highlights.
    public var lastMove: Move? { tree.current.move }

    /// The king square to flash, or nil.
    public var checkSquare: Int? {
        let pos = position
        let st = pos.status()
        guard st == .check || st == .checkmate else { return nil }
        return pos.kingSquare(pos.sideToMove)
    }

    // MARK: - Mutations
    //
    // Every one of these clears the snapshot and the selection, exactly as goToNode does
    // (board.tsx:1457-1470). A snapshot describes one position; moving invalidates it.

    private func invalidate() { snapshot = nil; selected = nil }

    @discardableResult
    public func play(_ move: Move) -> MoveTree.AddResult? {
        let r = tree.add(move: move)
        if r != nil { invalidate() }
        return r
    }
    @discardableResult
    public func play(san: String) -> MoveTree.AddResult? {
        let r = tree.add(san: san)
        if r != nil { invalidate() }
        return r
    }
    @discardableResult
    public func play(uci: String) -> MoveTree.AddResult? {
        let r = tree.add(uci: uci)
        if r != nil { invalidate() }
        return r
    }

    @discardableResult
    public func goTo(_ node: MoveNode) -> MoveNode {
        tree.goTo(node); invalidate(); return tree.current
    }
    @discardableResult
    public func goToStart() -> MoveNode {
        autoplaying = false; tree.goToStart(); invalidate(); return tree.current
    }
    @discardableResult
    public func goBack() -> MoveNode {
        autoplaying = false; tree.goBack(); invalidate(); return tree.current
    }
    @discardableResult
    public func goToEnd() -> MoveNode {
        autoplaying = false; tree.goToEnd(); invalidate(); return tree.current
    }

    /// The children available from the cursor — more than one means the UI must ask which.
    public func forwardOptions() -> [MoveNode] { tree.forwardOptions() }

    /// Step forward into `index`. Returns nil when there is nowhere to go.
    @discardableResult
    public func goForward(_ index: Int = 0) -> MoveNode? {
        guard !forwardOptions().isEmpty else { return nil }
        tree.goForward(index)
        invalidate()
        return tree.current
    }

    /// Find a node by id — what a tapped move-strip token carries.
    public func node(id: Int) -> MoveNode? {
        func walk(_ n: MoveNode) -> MoveNode? {
            if n.id == id { return n }
            for c in n.children { if let hit = walk(c) { return hit } }
            return nil
        }
        return walk(tree.root)
    }

    // MARK: - Variations

    /// What the variation card shows about a node (`renderVariationModal:4357-4372`).
    ///
    /// The source's third type, GM REFERENCE, is dropped: it keys off `node.isGmGame`, which only
    /// the Lichess masters explorer ever set, and that panel became the bundled ECO book in Phase 8.
    public struct VariationInfo: Equatable, Sendable {
        public let id: Int
        public let san: String
        public let nagText: String
        public let movePrefix: String
        public let isMainline: Bool
        public let typeLabel: String
        public let siblingCount: Int
        public let subtreeCount: Int
        public let canPromote: Bool

        public init(id: Int, san: String, nagText: String, movePrefix: String, isMainline: Bool,
                    typeLabel: String, siblingCount: Int, subtreeCount: Int, canPromote: Bool) {
            self.id = id; self.san = san; self.nagText = nagText; self.movePrefix = movePrefix
            self.isMainline = isMainline; self.typeLabel = typeLabel
            self.siblingCount = siblingCount; self.subtreeCount = subtreeCount
            self.canPromote = canPromote
        }
    }

    public func variationInfo(nodeID: Int) -> VariationInfo? {
        guard let n = node(id: nodeID), n !== tree.root else { return nil }
        let siblings = n.parent?.children ?? []
        let isMainline = siblings.first === n
        return VariationInfo(
            id: n.id,
            san: n.san,
            nagText: AnalysisSession.nagText(n.nag),
            movePrefix: "\(n.moveNumber)" + (n.color == .white ? "." : "..."),
            isMainline: isMainline,
            typeLabel: isMainline ? "MAIN LINE" : "SUB-VARIATION",
            siblingCount: siblings.count,
            subtreeCount: MoveTree.subtreeCount(n),
            canPromote: !isMainline)
    }

    /// ⭐ Set as Main Line (`:4419`). Promotes the whole line, not just one ply.
    @discardableResult
    public func promote(nodeID: Int) -> Bool {
        guard let n = node(id: nodeID), n !== tree.root else { return false }
        let changed = tree.promoteFully(n)
        if changed { invalidate() }
        return changed
    }

    /// 🗑 Delete Branch (`:4469`). Returns how many nodes went.
    ///
    /// `MoveTree.remove` already walks the cursor back to the parent when it was inside the
    /// subtree; the review has to be dropped too, since its node ids may no longer exist.
    @discardableResult
    public func deleteBranch(nodeID: Int) -> Int {
        guard let n = node(id: nodeID), n !== tree.root else { return 0 }
        let gone = tree.remove(n)
        if gone > 0 {
            invalidate()
            applyReview(nil, nodes: [])
        }
        return gone
    }

    // MARK: - PGN in and out

    /// What an import found, so the caller can pre-fill the save form from the headers exactly as
    /// the source does (`handleImportPgn:2333-2349`).
    public struct ImportResult: Equatable, Sendable {
        public let ok: Bool
        public let gamesFound: Int
        public let moveCount: Int
        public let errors: [PGN.ParseError]
        public let headers: [String: String]
        public let result: String
        public let initialFEN: String

        public init(ok: Bool, gamesFound: Int, moveCount: Int, errors: [PGN.ParseError],
                    headers: [String: String], result: String, initialFEN: String) {
            self.ok = ok; self.gamesFound = gamesFound; self.moveCount = moveCount
            self.errors = errors; self.headers = headers; self.result = result
            self.initialFEN = initialFEN
        }
    }

    /// Import (`handleImportPgn:2326`). Replaces the tree wholesale.
    ///
    /// ASSUMPTION, recorded: a multi-game PGN loads its FIRST game and says how many it saw. The
    /// source does the same thing silently.
    ///
    /// `PGN.parse` is deliberately tolerant — it hands back a zero-move game full of parse errors
    /// rather than refuse. That is right for a parser and wrong for an import: wiping the board
    /// because someone pasted a paragraph is destructive. An import counts only if it produced at
    /// least one move, or a custom start position (a setup-only PGN is legitimate).
    @discardableResult
    public func importPGN(_ text: String) -> ImportResult {
        let games = PGN.parse(text)
        guard let g = games.first else {
            return ImportResult(ok: false, gamesFound: 0, moveCount: 0, errors: [], headers: [:],
                                result: "*", initialFEN: ChessPosition.startFEN)
        }
        let moves = g.tree.mainline().count
        let custom = g.initialFEN != ChessPosition.startFEN
        guard moves > 0 || custom else {
            return ImportResult(ok: false, gamesFound: games.count, moveCount: 0, errors: g.errors,
                                headers: [:], result: "*", initialFEN: ChessPosition.startFEN)
        }
        // No reposition needed: PGN.parse restores the cursor after every RAV, so it already sits
        // on the last move of the main line — where loadPgnMoves leaves it too.
        replaceTree(g.tree)
        return ImportResult(ok: true, gamesFound: games.count, moveCount: moves, errors: g.errors,
                            headers: g.headers, result: g.result, initialFEN: g.initialFEN)
    }

    /// Export (`handleCopyPgn:2373`). Empty string when there is nothing to share.
    public func exportPGN(headers: [String: String] = [:], result: String = "*") -> String {
        let moves = tree.mainline()
        if moves.isEmpty && tree.initialFEN == ChessPosition.startFEN { return "" }
        let game = PGN.Game(tree: tree, headers: headers, result: result, errors: [],
                            moveCount: moves.count, preComment: "", initialFEN: tree.initialFEN)
        return PGN.serialize(game)
    }

    /// ✓ Apply Position (`toggleEditMode:2438`). The edited board becomes a brand-new tree.
    @discardableResult
    public func applyEditedPosition(_ position: ChessPosition) -> Bool {
        guard let newTree = MoveTree(initialFEN: position.fen) else { return false }
        replaceTree(newTree)
        return true
    }
}
