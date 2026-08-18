import SwiftUI
import BiyaherongCoachCore

// The Analysis Board's view model — a thin shell over `AnalysisSession`.
//
// The session (Core) owns every decision: what the status line says, which opening we are in, which
// arrows to draw, whether the current analysis is stale. This file owns only the three things a
// pure value type cannot: threading, sound, and republishing into SwiftUI.
//
// Shape follows `ChessGameVM` (PlayView.swift:10-38) exactly — `@MainActor final class … :
// ObservableObject` with `@Published`, owner uses `@StateObject`, children `@ObservedObject`. The
// `@Observable` macro is deliberately not used: nothing in this module uses it, and this is not the
// place to introduce a second state-management idiom.

@MainActor
final class AnalysisVM: ObservableObject {

    // MARK: - Board inputs

    @Published private(set) var pieces: [BoardPiece] = []
    @Published var selected: Int?
    @Published private(set) var legalTargets: Set<Int> = []
    @Published var pendingPromotion: (from: Int, to: Int)?

    // MARK: - Republished session state
    //
    // Recomputed together in `refresh()`. Deriving them in the view bodies instead would re-walk the
    // tree on every SwiftUI invalidation, and `MoveNode.position` re-parses a FEN each time.

    @Published private(set) var statusText = ""
    @Published private(set) var stripTokens: [StripToken] = []
    @Published private(set) var engineRows: [EngineRow] = []
    @Published private(set) var boardArrows: [BoardArrow] = []
    @Published private(set) var openingText: String?
    @Published private(set) var evalFraction: CGFloat = 0.5
    @Published private(set) var evalSymbol: String?
    @Published private(set) var depth = 0
    @Published private(set) var analyzing = false
    @Published private(set) var lastMove: Move?
    @Published private(set) var checkSquare: Int?

    // MARK: - View-only state

    @Published var flipped = false { didSet { session.flipped = flipped } }
    @Published var theme: BoardTheme = .default
    @Published var autoAnalyze = true
    @Published var autoplaying = false
    @Published var autoplaySpeed = AnalysisTables.defaultAutoplaySpeed
    /// Non-empty while the branch picker is up (board.tsx:1506-1516).
    @Published var branchOptions: [MoveNode] = []

    /// How hard the engine may work (☰ > Engine).
    ///
    /// Unlike every view-state property above it this one PERSISTS: a preset is a deliberate choice
    /// about battery, and having to make it again after every launch would be its own bug. Written
    /// through on `didSet`, the same shape `CoachStore.allowTakeBack` uses.
    @Published var engineSettings: EngineSettings.Value {
        didSet {
            guard engineSettings != oldValue else { return }
            EngineSettings.save(engineSettings, engineStorage)
            scheduleAnalysis()          // show the new setting working, immediately
        }
    }
    /// Whether the Advanced disclosure is expanded. Not persisted — it is a disclosure, not a
    /// setting, and `EngineSettings.panelModel` forces it open whenever a custom value is in effect.
    @Published var engineAdvancedOpen = false
    private let engineStorage: EngineSettings.Storage

    // MARK: - Phase 11 view state

    /// The ☰ sidebar.
    @Published var menuOpen = false
    /// The Settings toggle (board.tsx:4517). Arrows are also hidden outright while editing.
    @Published var showArrows = true
    /// Setup Position is open.
    @Published private(set) var editing = false
    /// The board being built while it is. A value type, so undo would be a copy away.
    @Published var editor = PositionEditor()
    /// The palette selection: a piece key, `AnalysisEditPanel.eraser`, or nil.
    @Published var editorSelection: String?
    @Published var editorFEN = ""
    /// The PGN import text area.
    @Published var pgnText = ""
    /// The double-tap-to-remove gesture's last tap (350 ms window).
    private var lastEditTap: (square: Int, at: Date)?

    // MARK: - Review

    // MARK: - Persistence

    enum Sheet: Equatable {
        case save, library
        case notice(String, String)
        // phase 11
        case pgnImport
        case pgnExport(String)
        case annotate(nodeID: Int, san: String, nag: Int)
        case variation(AnalysisSession.VariationInfo)
        case autoplaySpeed
        case engineSettings
    }
    @Published var sheet: Sheet?
    @Published var saveFields = AnalysisSaveFields()
    @Published private(set) var library = AnalysisLibrary()
    @Published var libraryFilter: AnalysisStore.Filter = .all
    @Published var librarySearch = ""
    /// Set once a game has been saved; from then on Save updates rather than inserting.
    private var currentSessionID: Int?
    private var draftTask: Task<Void, Never>?

    @Published private(set) var reviewState: AnalysisReviewModal.State?
    @Published private(set) var reviewSummary: ReviewSummary?
    private var reviewTask: Task<Void, Never>?
    private var reviewToken: CancelToken?

    var style: BoardStyle { BoardStyle.analysis(theme: theme) }
    var position: ChessPosition { session.position }

    // MARK: - Engine plumbing

    private let session: AnalysisSession
    private var debounceTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var searchToken: CancelToken?
    private var autoplayTask: Task<Void, Never>?

    /// `storage` is injected so a harness can drive the engine settings without touching the real
    /// defaults — the same reason `CoachStore` takes one.
    init(engineStorage: EngineSettings.Storage = AnalysisDefaultsStorage()) {
        // `AnalysisSession.init?` fails only on an unparseable FEN, and this one is the library's
        // own constant. A precondition states that rather than papering over it with a fallback.
        guard let s = AnalysisSession(initialFEN: ChessPosition.startFEN,
                                      book: OpeningBookLoader.shared) else {
            preconditionFailure("ChessPosition.startFEN must parse")
        }
        session = s
        self.engineStorage = engineStorage
        // Assigned before any other work: `didSet` does not fire during initialisation, so loading
        // here cannot trigger the save-and-reanalyse that a later assignment would.
        self.engineSettings = EngineSettings.load(engineStorage)
        rebuildPieces()
        refresh()
        loadLibrary()
        restoreDraft()          // silent, and prunes a stale one
        scheduleAnalysis()
    }

    // MARK: - Refresh

    /// Pull everything the views read out of the session, once.
    private func refresh() {
        session.autoAnalyze = autoAnalyze
        session.autoplaying = autoplaying
        statusText = session.statusText
        stripTokens = session.stripTokens
        engineRows = session.engineRows
        boardArrows = (showArrows && !editing)
            ? session.arrows.map { BoardArrow(from: $0.from, to: $0.to, rank: $0.rank) }
            : []
        openingText = session.openingText
        lastMove = session.lastMove
        checkSquare = session.checkSquare
        depth = session.snapshot?.depth ?? 0
        analyzing = session.analyzing

        // While a line is being previewed the board shows THAT position. Everything else — the
        // strip, the engine rows, the book, the eval — still describes the real cursor, because
        // nothing has actually been played. Overriding here rather than in the view keeps the
        // board band unaware that previewing exists.
        if let state = previewState() {
            lastMove = state.last
            let status = state.pos.status()
            checkSquare = (status == .check || status == .checkmate)
                ? state.pos.kingSquare(state.pos.sideToMove) : nil
            boardArrows = []          // the arrows belong to the root position, not this one
            selected = nil
            legalTargets = []
        }

        // The one place the UI maps the session's raw score parts through the metrics tables.
        let parts = session.evalParts
        if let winner = parts.winner {
            evalFraction = winner == .white ? 1 : 0
            evalSymbol = nil
        } else if parts.cp == nil, parts.mate == nil {
            evalFraction = AnalysisEval.fraction(cp: nil, mate: nil)
            evalSymbol = nil
        } else {
            evalFraction = AnalysisEval.fraction(cp: parts.cp, mate: parts.mate)
            evalSymbol = AnalysisTables.evalSymbol(cp: parts.cp, mate: parts.mate)
        }
    }

    private func rebuildPieces() {
        rebuildPieces(of: previewState()?.pos ?? session.position)
    }

    private func rebuildPieces(of pos: ChessPosition) {
        pieces = (0..<64).compactMap { sq in
            pos.squares[sq].map { BoardPiece(id: UUID(), square: sq, piece: $0) }
        }
    }

    // MARK: - Line preview
    //
    // Tapping an engine line used to play its FIRST move into the tree and nothing else — you could
    // not see the variation the engine was actually recommending. Now the whole line walks on the
    // board, and the move tree is not touched until you ask for it with ＋.
    //
    // The state machine itself is `BiyaherongCoachCore.LinePreview` — pure, value-typed, and
    // asserted by ParityRunner. What is left here is what genuinely needs a screen: the published
    // property, the haptics, and the repaint.

    @Published private(set) var preview: LinePreview?

    var previewing: Bool { preview != nil }

    /// One cell of the preview bar. `LinePreview.Token` plus the `Identifiable` conformance
    /// `ForEach` wants — Core is Foundation-only and cannot know SwiftUI needs an id.
    struct PreviewToken: Identifiable, Equatable {
        var id: Int { token.ply }
        let token: LinePreview.Token
        var ply: Int { token.ply }
        var san: String { token.san }
        var played: Bool { token.played }
        var isCurrent: Bool { token.isCurrent }
    }

    var previewTokens: [PreviewToken] {
        (preview?.tokens ?? []).map { PreviewToken(token: $0) }
    }

    /// Which engine line is being walked, so the bar can borrow that line's arrow colour.
    var previewRank: Int { preview?.rank ?? 0 }
    var previewCanStepForward: Bool { preview?.canStepForward ?? false }

    /// The position the preview is showing, and the move that got there.
    private func previewState() -> (pos: ChessPosition, last: Move)? {
        guard let p = preview, let st = session.previewPosition(p) else { return nil }
        return (st.position, st.last)
    }

    /// Enter the preview on the line's first move. Refuses a line that will not play — a snapshot
    /// can outlive the position it was computed for.
    func previewLine(_ row: EngineRow) {
        guard session.canPreview(row), let p = LinePreview.start(row) else { return }
        preview = p
        Haptics.play(.pickUp)
        repaintPreview()
    }

    /// Step inside the line. Stepping off the FRONT exits, which is what the ◀ at ply 1 is for.
    func previewStep(_ delta: Int) {
        guard let p = preview else { return }
        guard let next = p.stepped(delta) else { previewExit(); return }
        guard next != p else { return }
        preview = next
        Haptics.play(.move)
        repaintPreview()
    }

    /// Jump straight to a ply by tapping its chip. Tapping the ply you are already on is a no-op
    /// rather than a wasted rebuild.
    func previewGo(to ply: Int) {
        guard let p = preview else { return }
        let next = p.jumped(to: ply)
        guard next != p else { return }
        preview = next
        Haptics.play(.move)
        repaintPreview()
    }

    /// Back to the game, exactly where it was. Nothing to undo — nothing was ever done.
    func previewExit() {
        guard preview != nil else { return }
        preview = nil
        repaintPreview()
    }

    /// Commit what is on screen into the move tree, as a real variation. `perform` already creates
    /// a branch when the move differs from the one on the main line, and the strip already draws
    /// branch chips, so there is nothing new downstream.
    func previewCommit() {
        guard let p = preview else { return }
        let moves = p.movesToCommit
        preview = nil
        for uci in moves {
            guard let m = session.position.move(forUCI: uci) else { break }
            perform(m)
        }
        Haptics.play(.success)
    }

    /// The board is the only band a preview changes, but the pieces have to be rebuilt rather than
    /// slid: a jump can land anywhere in the line, and a jump has no direction.
    private func repaintPreview() {
        rebuildPieces()
        refresh()
    }

    // MARK: - Interaction

    func tap(_ sq: Int) {
        if editing { editTap(sq); return }     // the editor owns the board while it is open
        // A tap on the board while a line is being previewed means "get me out of here": the pieces
        // under the finger are the previewed position's, and dragging one would be a lie.
        if previewing { previewExit(); return }
        let pos = session.position
        if let sel = selected {
            if sq == sel { deselect(); return }
            let moves = pos.legalMoves(from: sel).filter { $0.to == sq }
            if moves.count > 1 { pendingPromotion = (sel, sq); return }
            if let m = moves.first { perform(m); return }
            selectPiece(sq)
            return
        }
        selectPiece(sq)
    }

    /// Drag: the board hands over (from, to) and we look the move up. Unlike Play, ANY colour may
    /// move here — an analysis board is not a game.
    func drag(from: Int, to: Int) {
        if editing { return }                  // edit-mode input is taps, not drags
        // No dragging a piece out of a position that does not exist yet — tap ＋ first. The tap
        // path exits instead, because a tap is ambiguous and a drag is not.
        if previewing { return }
        let moves = session.position.legalMoves(from: from).filter { $0.to == to }
        if moves.count > 1 { pendingPromotion = (from, to); return }
        if let m = moves.first { perform(m) }
    }

    private func selectPiece(_ sq: Int) {
        let pos = session.position
        guard pos.squares[sq] != nil else { deselect(); return }
        let targets = pos.legalMoves(from: sq)
        guard !targets.isEmpty else { deselect(); return }
        selected = sq
        legalTargets = Set(targets.map { $0.to })
        // The one haptic the source actually has: a Light impact on picking a piece up
        // (DragDropChessBoard.tsx:351), after the same piece-exists and has-moves guards.
        Haptics.play(.pickUp)
    }
    private func deselect() { selected = nil; legalTargets = [] }

    func choosePromotion(_ kind: PieceKind) {
        guard let pp = pendingPromotion else { return }
        pendingPromotion = nil
        perform(Move(from: pp.from, to: pp.to, promotion: kind))
    }

    private func perform(_ m: Move) {
        let before = session.position
        guard let moving = before.squares[m.from] else { return }
        let isCastle = moving.kind == .king && abs(Square.file(m.to) - Square.file(m.from)) == 2
        let isCapture = moveIsCapture(before, m)
        guard session.play(m) != nil else { return }

        animate(m, from: before, moving: moving)
        SoundManager.shared.playMove(isCastle: isCastle, isCapture: isCapture,
                                     status: session.position.status())
        let after = session.position.status()
        Haptics.playForMove(capture: isCapture, check: after == .check || after == .checkmate)
        deselect()
        refresh()
        scheduleAnalysis()
        scheduleDraft()
    }

    /// Slide the moved piece instead of rebuilding the array, so SwiftUI keeps piece identity and
    /// animates. Copied from `ChessGameVM.perform` (PlayView.swift:111-124) — the two must not drift.
    private func animate(_ m: Move, from before: ChessPosition, moving: Piece) {
        let isEP = moving.kind == .pawn && m.to == before.enPassant && before.squares[m.to] == nil
        let capSq = isEP ? Square.make(file: Square.file(m.to), rank: Square.rank(m.from))
                         : (before.squares[m.to] != nil ? m.to : nil)
        withAnimation(AnalysisTiming.pieceMove) {
            if let cs = capSq { pieces.removeAll { $0.square == cs } }
            if let idx = pieces.firstIndex(where: { $0.square == m.from }) {
                if let promo = m.promotion { pieces[idx].piece = Piece(moving.color, promo) }
                pieces[idx].square = m.to
            }
            if moving.kind == .king, abs(Square.file(m.to) - Square.file(m.from)) == 2 {
                let rank = Square.rank(m.from)
                let (rf, rt) = Square.file(m.to) == 6
                    ? (Square.make(file: 7, rank: rank), Square.make(file: 5, rank: rank))
                    : (Square.make(file: 0, rank: rank), Square.make(file: 3, rank: rank))
                if let ri = pieces.firstIndex(where: { $0.square == rf }) { pieces[ri].square = rt }
            }
        }
    }

    // MARK: - Navigation
    //
    // A jump can land anywhere in the tree, so the piece array is rebuilt rather than slid. That
    // costs the slide animation on navigation and keeps it on played moves, which is the right way
    // round: a played move has a direction, a jump does not.

    private func afterNavigation() {
        // A jump anywhere in the tree ends the preview: the line belonged to the cursor we just left.
        preview = nil
        stopAutoplay()
        deselect()
        rebuildPieces()
        refresh()
        scheduleAnalysis()
        scheduleDraft()
    }

    func goToStart() { session.goToStart(); afterNavigation() }
    func goBack() { session.goBack(); afterNavigation() }
    func goToEnd() { session.goToEnd(); afterNavigation() }

    /// Forward with several children asks which; with one it just goes.
    func goForward() {
        let opts = session.forwardOptions()
        if opts.isEmpty { return }
        if opts.count > 1 { branchOptions = opts; return }
        session.goForward(0)
        afterNavigation()
    }
    func chooseBranch(_ index: Int) {
        branchOptions = []
        session.goForward(index)
        afterNavigation()
    }
    func cancelBranch() { branchOptions = [] }

    /// Jump to a move-strip token.
    func goTo(id: Int) {
        guard let node = session.node(id: id) else { return }
        session.goTo(node)
        afterNavigation()
    }


    // MARK: - Toggles

    func toggleEngine() {
        autoAnalyze.toggle()
        session.autoAnalyze = autoAnalyze
        if !autoAnalyze { session.snapshot = nil }
        refresh()
        scheduleAnalysis()
    }
    func flip() { flipped.toggle() }
    func cycleTheme() {
        let all = BoardTheme.allCases
        if let i = all.firstIndex(of: theme) { theme = all[(i + 1) % all.count] }
    }
    func cycleSpeed() {
        let vals = AnalysisTables.autoplaySpeeds.map { $0.value }
        if let i = vals.firstIndex(of: autoplaySpeed) { autoplaySpeed = vals[(i + 1) % vals.count] }
    }
    var autoplaySpeedLabel: String {
        AnalysisTables.autoplaySpeeds.first { $0.value == autoplaySpeed }?.label ?? ""
    }

    // MARK: - Autoplay

    func toggleAutoplay() {
        if autoplaying { stopAutoplay(); refresh(); return }
        autoplaying = true
        session.autoplaying = true
        refresh()
        autoplayTask = Task { [self] in
            while !Task.isCancelled, autoplaying {
                try? await Task.sleep(nanoseconds: UInt64(autoplaySpeed) * 1_000_000)
                if Task.isCancelled || !autoplaying { return }
                let opts = session.forwardOptions()
                if opts.isEmpty { stopAutoplay(); refresh(); scheduleAnalysis(); return }
                session.goForward(0)          // autoplay always follows the main line
                session.autoplaying = true    // goForward does not clear it, but be explicit
                rebuildPieces()
                refresh()
            }
        }
    }
    private func stopAutoplay() {
        autoplayTask?.cancel()
        autoplayTask = nil
        autoplaying = false
        session.autoplaying = false
    }

    // MARK: - Persistence
    //
    // Every rule lives in `AnalysisStore`, which is pure and parity-asserted. This owns only the
    // file round trip and the 800 ms debounce.

    var folders: [AnalysisFolderRecord] { AnalysisStore.folders(library) }
    var libraryRows: [AnalysisSessionRecord] {
        AnalysisStore.sessions(library, filter: libraryFilter, search: librarySearch)
    }
    var unfiledCount: Int { AnalysisStore.sessionCount(library, folderID: nil) }
    func count(inFolder id: Int) -> Int { AnalysisStore.sessionCount(library, folderID: id) }
    func folderName(_ id: Int) -> String? { AnalysisStore.folder(library, id: id)?.name }
    var isUpdatingSavedGame: Bool { currentSessionID != nil }

    private func loadLibrary() {
        library = AnalysisLibraryFile.load()
        AnalysisStore.seedDefaultFolders(&library, now: nowMs())
        AnalysisLibraryFile.save(library)
    }
    private func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    /// A full PGN — headers included, unlike the source's movetext-only `generatePgn()`, which is
    /// why a custom start position survives a round trip here.
    private func currentPGN() -> String {
        var game = PGN.Game(tree: session.tree)
        game.headers = pgnHeaders()
        game.result = saveFields.result
        game.initialFEN = session.tree.initialFEN
        game.moveCount = session.tree.mainline().count
        return PGN.serialize(game)
    }
    /// Only `title` and `notes` have no PGN tag of their own; everything else round-trips.
    private func pgnHeaders() -> [String: String] {
        var h: [String: String] = [:]
        if !saveFields.whitePlayer.isEmpty { h["White"] = saveFields.whitePlayer }
        if !saveFields.blackPlayer.isEmpty { h["Black"] = saveFields.blackPlayer }
        if !saveFields.eventName.isEmpty { h["Event"] = saveFields.eventName }
        if !saveFields.location.isEmpty { h["Site"] = saveFields.location }
        if !saveFields.gameDate.isEmpty {
            h["Date"] = saveFields.gameDate.replacingOccurrences(of: "-", with: ".")
        }
        if !saveFields.roundInfo.isEmpty { h["Round"] = saveFields.roundInfo }
        if saveFields.result != "*" { h["Result"] = saveFields.result }
        if !saveFields.whiteRating.isEmpty { h["WhiteElo"] = saveFields.whiteRating }
        if !saveFields.blackRating.isEmpty { h["BlackElo"] = saveFields.blackRating }
        if !saveFields.eco.isEmpty { h["ECO"] = saveFields.eco }
        if !saveFields.timeControl.isEmpty { h["TimeControl"] = saveFields.timeControl }
        return h
    }

    func openSaveSheet() {
        guard !session.tree.mainline().isEmpty else {
            sheet = .notice("No moves", "Play some moves before saving.")
            return
        }
        sheet = .save
    }
    func openLibrary() { sheet = .library }
    func closeSheet() { sheet = nil }

    func saveGame() {
        let fields = saveFields.storeFields(id: currentSessionID, pgn: currentPGN(),
                                            initialFEN: session.tree.initialFEN)
        guard let rec = AnalysisStore.save(&library, fields, now: nowMs()) else {
            sheet = .notice("Nothing to save", "The game has no moves.")
            return
        }
        currentSessionID = rec.id
        AnalysisStore.clearDraft(&library, mode: AnalysisStore.draftNew)
        AnalysisLibraryFile.save(library)
        sheet = .notice("Saved", "\(rec.title) is in your library.")
    }

    /// Drop the autosaved draft. Called on save and on New Game, as the source does.
    func clearDraft() {
        AnalysisStore.clearDraft(&library, mode: AnalysisStore.draftNew)
        AnalysisLibraryFile.save(library)
    }

    func openSavedGame(_ id: Int) {
        guard let rec = AnalysisStore.session(library, id: id),
              let game = PGN.parseFirst(rec.pgn) else {
            sheet = .notice("Could not open", "That PGN did not parse.")
            return
        }
        adopt(tree: game.tree)
        currentSessionID = rec.id
        saveFields = AnalysisSaveFields.from(rec)
        sheet = nil
    }

    func deleteSavedGame(_ id: Int) {
        guard AnalysisStore.deleteSession(&library, id: id) else { return }
        if currentSessionID == id { currentSessionID = nil }
        AnalysisLibraryFile.save(library)
    }

    func createFolder(_ name: String) {
        guard let f = AnalysisStore.createFolder(&library, name: name, now: nowMs()) else { return }
        saveFields.folderID = f.id
        AnalysisLibraryFile.save(library)
    }

    /// Deleting a folder UNFILES its games; it never deletes them.
    func deleteFolder(_ id: Int) {
        guard AnalysisStore.deleteFolder(&library, id: id) else { return }
        if libraryFilter == .folder(id) { libraryFilter = .all }
        AnalysisLibraryFile.save(library)
    }

    /// Replace the tree wholesale — a reopened game or a restored draft.
    private func adopt(tree: MoveTree) {
        session.replaceTree(tree)
        session.applyReview(nil, nodes: [])
        session.snapshot = nil
        reviewSummary = nil
        reviewState = nil
        deselect()
        rebuildPieces()
        refresh()
        scheduleAnalysis()
    }

    // -- drafts: 800 ms debounce, 24 h TTL, silent restore --------------------------

    func scheduleDraft() {
        draftTask?.cancel()
        draftTask = Task { [self] in
            try? await Task.sleep(nanoseconds: UInt64(AnalysisStore.draftDebounceMs) * 1_000_000)
            if Task.isCancelled { return }
            let pgn = session.tree.mainline().isEmpty ? "" : currentPGN()
            guard AnalysisStore.draftWorthKeeping(pgn: pgn,
                                                  initialFEN: session.tree.initialFEN) else { return }
            AnalysisStore.putDraft(&library, mode: AnalysisStore.draftNew,
                                   AnalysisDraft(pgn: pgn, initialFEN: session.tree.initialFEN,
                                                 timestamp: 0, sessionID: currentSessionID,
                                                 title: saveFields.title, notes: saveFields.notes,
                                                 folderID: saveFields.folderID),
                                   now: nowMs())
            AnalysisLibraryFile.save(library)
        }
    }

    /// Silent — no "restore?" prompt, as the source does (board.tsx:795).
    private func restoreDraft() {
        guard let d = AnalysisStore.draft(&library, mode: AnalysisStore.draftNew, now: nowMs()) else {
            AnalysisLibraryFile.save(library)      // reading a stale draft prunes it
            return
        }
        guard let game = PGN.parseFirst(d.pgn) else { return }
        adopt(tree: game.tree)
        currentSessionID = d.sessionID
        saveFields.title = d.title ?? ""
        saveFields.notes = d.notes ?? ""
        saveFields.folderID = d.folderID
    }

    // MARK: - Game review
    //
    // The original splits this across two half-featured paths: `runAccuracyAnalysis`
    // (board.tsx:2254) shows the modal but discards `move_evaluations`, so the strip stays blank;
    // `handleAnalyzeGame` (:1854) stamps the strip but shows only an Alert, with no graph and no
    // cancel. One action here does both — a deliberate deviation, recorded in PORTING_NOTES.

    /// The free tier's daily Game Review allowance, supplied by the host.
    ///
    /// Returns false when it is spent, and **consumes one when it returns true** — so it is called
    /// exactly once, at the top of `startReview()`, after the too-short guard so a review that was
    /// never going to run does not cost the user an allowance. `nil` means ungated, which is what
    /// the macOS demo panel gets.
    var reviewGate: (() -> Bool)?

    func startReview() {
        let plan = ReviewAnnotator.plan(session.tree)
        guard plan.positions.count >= AnalysisTables.minimumReviewPositions else {
            reviewState = .tooShort
            return
        }
        if let reviewGate, !reviewGate() {
            reviewState = .capped
            return
        }
        // A review and a live search would fight over the same cores. Stop the engine first.
        debounceTask?.cancel()
        searchToken?.cancel()
        searchTask?.cancel()
        session.analyzing = false
        analyzing = false

        cancelReviewTask()
        session.applyReview(nil, nodes: [])
        reviewSummary = nil
        refresh()

        let token = CancelToken()
        reviewToken = token
        reviewState = .running(completed: 0, total: plan.positions.count)

        // The preset scales the review too — it is where the heat actually is, since a 40-move game
        // is 41 searches rather than one. Infinite is the exception: `reviewMs` saturates instead,
        // because an unbounded per-position search over 41 positions would never finish.
        let resolved = EngineSettings.resolve(engineSettings)
        let limits = resolved.reviewLimits
        let budget = Double(resolved.reviewMs) / 1000
        let book = OpeningBookLoader.shared

        // Only value types cross: `Evaluator` is Sendable precisely so the whole walk can run off
        // the main actor. `plan` itself stays here — it carries MoveNodes, which cannot.
        let seed = ReviewAnnotator.Evaluator(plan: plan, limits: limits)

        reviewTask = Task { [weak self] in
            let walker = await Task.detached(priority: .userInitiated) {
                () -> ReviewAnnotator.Evaluator in
                var w = seed
                while !w.isFinished {
                    if token.isCancelled { break }
                    // The deadline is per position, inside the closure the Evaluator hands to the
                    // engine — so a sharp position stops shallow instead of blowing the budget.
                    let deadline = Date().addingTimeInterval(budget)
                    w.step(engine: LocalEngine(),
                           shouldCancel: { token.isCancelled || Date() > deadline })
                    let progress = (w.completed, w.total)
                    Task { @MainActor in
                        guard let self, !token.isCancelled else { return }
                        self.reviewState = .running(completed: progress.0, total: progress.1)
                    }
                }
                return w
            }.value

            guard let self, !token.isCancelled else { return }
            // A short array means cancelled, never a truncated game — so nothing is stamped.
            guard walker.isComplete else { self.reviewState = nil; return }
            let base = GameReview.review(evaluations: walker.evaluations, moves: plan.moves)
            let annotated = ReviewAnnotator.annotate(base, moves: plan.moves,
                                                     bookPlies: Set(book.bookPlies(plan.keys)))
            self.session.applyReview(annotated, nodes: plan.nodes)
            self.reviewSummary = self.session.reviewSummary
            self.reviewState = .results
            Haptics.play(.success)
            self.refresh()
            self.scheduleAnalysis()          // the live engine can resume now
        }
    }

    func cancelReview() {
        cancelReviewTask()
        session.applyReview(nil, nodes: [])
        reviewSummary = nil
        reviewState = nil
        refresh()
        scheduleAnalysis()
    }

    func dismissReview() { reviewState = nil }

    private func cancelReviewTask() {
        reviewToken?.cancel()
        reviewTask?.cancel()
        reviewTask = nil
        reviewToken = nil
    }

    // MARK: - The engine loop

    /// Abandon anything in flight and, if the position wants analysis, debounce a fresh search.
    ///
    /// The original dropped a position change that arrived mid-request (board.tsx:885) and the panel
    /// then showed stale lines forever. Our engine is cancellable, so a stale search is cancelled
    /// and replaced, never skipped.
    /// Abandon anything in flight without scheduling a replacement — what edit mode needs.
    func cancelAnalysis() {
        debounceTask?.cancel()
        searchToken?.cancel()
        searchTask?.cancel()
        session.analyzing = false
        analyzing = false
    }

    func scheduleAnalysis() {
        debounceTask?.cancel()
        searchToken?.cancel()
        searchTask?.cancel()
        session.analyzing = false
        analyzing = false
        guard session.wantsAnalysis else { refresh(); return }
        debounceTask = Task { [self] in
            try? await Task.sleep(nanoseconds: UInt64(AnalysisTiming.analysisDebounceMs) * 1_000_000)
            if Task.isCancelled { return }
            runAnalysis()
        }
    }

    private func runAnalysis() {
        let searchPosition = session.position          // value type, Sendable
        let keys = session.historyKeys
        let token = CancelToken()
        searchToken = token
        // The deadline is what actually bounds the search: measured cost is ~6x per ply and varies
        // 15x by position type, so a fixed depth is either too slow somewhere or too shallow
        // everywhere. `maxDepth` is only a ceiling. Both come from the user's chosen preset.
        let resolved = EngineSettings.resolve(engineSettings)
        let limits = resolved.searchLimits
        // Infinite has no deadline at all: only the token stops it, which the 💡 button, every
        // position change and leaving the screen all bump. `maxDepth` is then the sole guarantee
        // that the search terminates — which is why every preset still carries one.
        let deadline: Date? = resolved.infinite
            ? nil
            : Date().addingTimeInterval(Double(resolved.thinkMs) / 1000)
        session.analyzing = true
        analyzing = true

        // Capture shape copied verbatim from `ChessGameVM.maybeBotMove` (PlayView.swift:139-148):
        // `[weak self]` on the detached task, `guard let self` inside every main-actor hop. The
        // engine blocks its thread and never yields, which is exactly why it is detached.
        searchTask = Task.detached(priority: .userInitiated) { [weak self] in
            let engine = LocalEngine()
            let result = engine.analyze(
                searchPosition,
                limits: limits,
                historyKeys: keys,
                shouldCancel: {
                    if token.isCancelled { return true }
                    guard let deadline else { return false }     // Infinite: the token is the clock
                    return Date() > deadline
                },
                onProgress: { snap in
                    // One hop per completed depth, so lines appear as they are found rather than
                    // all at once when the deadline expires.
                    Task { @MainActor in
                        guard let self, !token.isCancelled else { return }
                        self.adopt(snap, for: searchPosition)
                    }
                })
            await MainActor.run {
                guard let self, !token.isCancelled else { return }
                self.session.analyzing = false
                self.adopt(result, for: searchPosition)
            }
        }
    }

    /// Accept an engine result only if the board still shows the position it was computed for —
    /// the same stale guard `ChessGameVM.maybeBotMove` uses (PlayView.swift:145).
    private func adopt(_ snapshot: AnalysisSnapshot, for searched: ChessPosition) {
        guard session.position == searched else { return }
        session.snapshot = snapshot
        refresh()
    }

    // MARK: - The ☰ menu

    /// The four sections, built fresh each time so the toggle labels and dots reflect the moment.
    /// Board Theme is the one row the source's menu does not have: offline there is no Master DB
    /// item to sit here, and the theme picker had nowhere else to live.
    func menuSections() -> [AnalysisMenuSection] {
        [
            AnalysisMenuSection(title: "Game", items: [
                AnalysisMenuItem("🔁", "New Game") { [weak self] in self?.newGame() },
                AnalysisMenuItem("✏️", editing ? "Leave Edit Board" : "Edit Board") { [weak self] in
                    self?.toggleEditMode()
                },
                AnalysisMenuItem("📥", "Import PGN") { [weak self] in self?.openPgnImport() },
                AnalysisMenuItem("🔬", "Analyze Game") { [weak self] in self?.startReview() },
            ]),
            AnalysisMenuSection(title: "File", items: [
                AnalysisMenuItem("💾", "Save Analysis") { [weak self] in self?.openSaveSheet() },
                AnalysisMenuItem("📂", "Load Analysis") { [weak self] in self?.openLibrary() },
            ]),
            AnalysisMenuSection(title: "Share", items: [
                AnalysisMenuItem("📋", "Copy PGN") { [weak self] in self?.copyPGN() },
                AnalysisMenuItem("📤", "Export PGN") { [weak self] in self?.openPgnExport() },
            ]),
            AnalysisMenuSection(title: "Settings", items: [
                AnalysisMenuItem("🏹", "Engine Arrows  " + (showArrows ? "ON" : "OFF"),
                                 toggle: showArrows) { [weak self] in
                    guard let self else { return }
                    self.showArrows.toggle()
                    self.refresh()
                },
                AnalysisMenuItem("⚙️", "Engine  " + EngineSettings.resolve(engineSettings).label) {
                    [weak self] in self?.sheet = .engineSettings
                },
                AnalysisMenuItem("⏱️", "Autoplay Speed") { [weak self] in self?.sheet = .autoplaySpeed },
                AnalysisMenuItem("🎨", "Board Theme  " + theme.label) { [weak self] in
                    self?.cycleTheme()
                },
            ]),
        ]
    }

    func openMenu() { menuOpen = true }
    func closeMenu() { menuOpen = false }

    // MARK: - ⚙️ Engine settings
    //
    // Three one-liners, because every decision — which rows exist, what they say, which control has
    // which range, what a new value does to the stored one — is in `EngineSettings`, where it can be
    // asserted in Node and shared with the browser twin. The panel that draws them is
    // `AnalysisEngineSettings.swift`.

    var enginePanel: EngineSettings.PanelModel {
        EngineSettings.panelModel(engineSettings, advancedOpen: engineAdvancedOpen)
    }

    func selectEnginePreset(_ id: String) {
        engineSettings = EngineSettings.selectPreset(engineSettings, id)
    }

    func setEngineControl(_ key: String, _ value: Int) {
        engineSettings = EngineSettings.applyControl(engineSettings, key, value)
    }

    func toggleEngineAdvanced() { engineAdvancedOpen = !enginePanel.advancedOpen }

    /// 🔁 New Game (handleReset:1526) — and it clears the draft, as the source does.
    func newGame() {
        if editing { leaveEditMode() }
        guard let fresh = MoveTree(initialFEN: ChessPosition.startFEN) else { return }
        currentSessionID = nil
        saveFields = AnalysisSaveFields()
        clearDraft()
        adopt(tree: fresh)
    }

    // MARK: - Setup Position

    func toggleEditMode() { editing ? leaveEditMode() : enterEditMode() }

    func enterEditMode() {
        stopAutoplay()
        cancelAnalysis()                  // the engine has nothing to say about a half-built board
        editor = PositionEditor(session.position)
        editorSelection = nil
        editorFEN = ""
        lastEditTap = nil
        editing = true
        refresh()
    }

    func leaveEditMode() {
        editing = false
        editorSelection = nil
        refresh()
        scheduleAnalysis()
    }

    /// A tap on the board while editing. Double-tapping an occupied square removes the piece — the
    /// source's own gesture, at its own 350 ms window.
    func editTap(_ sq: Int) {
        let now = Date()
        let isDoubleTap = lastEditTap.map { $0.square == sq
            && now.timeIntervalSince($0.at) * 1000 < Double(AnalysisTiming.doubleTapWindowMs) } ?? false
        lastEditTap = (square: sq, at: now)

        if isDoubleTap, editor.squares[sq] != nil {
            editor.remove(at: sq)
        } else if editorSelection == AnalysisEditPanel.eraser {
            editor.remove(at: sq)
        } else if let key = editorSelection {
            editor.put(key, at: sq)
        }
        rebuildEditPieces()
    }

    /// ✓ Apply Position. Refuses an illegal board and says why, as the source's Alert does.
    func applyEditedPosition() {
        if let issue = editor.firstIssueText {
            sheet = .notice("Invalid Position", issue)
            return
        }
        guard let pos = editor.apply(), let tree = MoveTree(initialFEN: pos.fen) else {
            sheet = .notice("Invalid Position", "The position on the board is not valid.")
            return
        }
        editing = false
        editorSelection = nil
        currentSessionID = nil            // a new position is a new game, not an edit of the old
        adopt(tree: tree)
        scheduleDraft()
    }

    func loadEditorFEN() {
        let text = editorFEN.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard editor.loadFEN(text) else {
            sheet = .notice("Invalid FEN", "Could not load FEN string.")
            return
        }
        editorFEN = ""
        rebuildEditPieces()
    }

    /// While editing, the board shows the EDITOR's squares, not the session's.
    private func rebuildEditPieces() {
        pieces = (0..<64).compactMap { sq in
            editor.squares[sq].map { BoardPiece(id: UUID(), square: sq, piece: $0) }
        }
        objectWillChange.send()
    }

    // MARK: - Annotations

    /// Whether the cursor is on the starting position — the source disables its ✏️ there.
    var isAtStart: Bool { session.tree.current === session.tree.root }

    /// One long-press handler for the whole move strip: a main-line move opens the annotation
    /// picker, a branch chip the variation card. Which one a token is, is a tree question, so the
    /// view does not have to know.
    func annotateOrManage(id: Int) {
        guard let node = session.node(id: id), node !== session.tree.root else { return }
        let siblings = node.parent?.children ?? []
        if siblings.count > 1 && siblings.first !== node {
            openVariationCard(nodeID: id)
        } else {
            openAnnotationPicker(nodeID: id)
        }
    }

    func openAnnotationPicker(nodeID: Int) {
        guard let node = session.node(id: nodeID), node !== session.tree.root else { return }
        sheet = .annotate(nodeID: nodeID, san: node.san, nag: node.nag)
    }

    /// The toolbar's ✏️ annotates the CURRENT move (board.tsx:4626) — Edit Board is a ☰ item.
    func openAnnotationPickerForCurrent() {
        openAnnotationPicker(nodeID: session.tree.current.id)
    }

    func setAnnotation(_ nag: Int, forNodeID id: Int) {
        // Tapping the option already set clears it, which is how a picker with no "off" behaves.
        let current = session.node(id: id)?.nag ?? 0
        session.setNAG(current == nag ? 0 : nag, forNodeID: id)
        sheet = nil
        refresh()
        scheduleDraft()
    }

    func clearAnnotation(forNodeID id: Int) {
        session.clearNAG(forNodeID: id)
        sheet = nil
        refresh()
        scheduleDraft()
    }

    /// What the board overlay draws, or nil. Move-quality annotations only — the source's rule.
    var annotationBadge: (square: Int, symbol: String, color: Color)? {
        guard !editing,
              let square = session.annotationSquare,
              let symbol = session.annotationSymbol(forNodeID: session.tree.current.id),
              let style = AnalysisTables.moveAnnotations.first(where: { $0.symbol == symbol })
        else { return nil }
        return (square: square, symbol: symbol, color: style.color)
    }

    // MARK: - Variations

    func openVariationCard(nodeID: Int) {
        guard let info = session.variationInfo(nodeID: nodeID) else { return }
        sheet = .variation(info)
    }

    func promoteVariation(nodeID: Int) {
        session.promote(nodeID: nodeID)
        sheet = nil
        refresh()
        scheduleAnalysis()
        scheduleDraft()
    }

    func deleteVariation(nodeID: Int) {
        session.deleteBranch(nodeID: nodeID)
        sheet = nil
        reviewSummary = nil               // the review's node ids may no longer exist
        rebuildPieces()
        refresh()
        scheduleAnalysis()
        scheduleDraft()
    }

    // MARK: - PGN in and out

    func openPgnImport() {
        pgnText = ""
        sheet = .pgnImport
    }

    func openPgnExport() {
        let text = session.exportPGN(headers: pgnHeaders(), result: saveFields.result)
        guard !text.isEmpty else {
            sheet = .notice("No moves", "Play some moves first.")
            return
        }
        sheet = .pgnExport(text)
    }

    func copyPGN() {
        let text = session.exportPGN(headers: pgnHeaders(), result: saveFields.result)
        guard !text.isEmpty else {
            sheet = .notice("No moves", "Play some moves first.")
            return
        }
        Clipboard.copy(text)
        sheet = .notice("Copied", "PGN copied to clipboard.")
    }

    func importPGN() {
        let text = pgnText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            sheet = .notice("Error", "Please enter PGN text.")
            return
        }
        let res = session.importPGN(text)
        guard res.ok else {
            sheet = .notice("Could not import", res.errors.isEmpty
                ? "That does not look like a PGN."
                : "No playable moves. First problem: \(res.errors[0].message)")
            return
        }
        fillSaveFields(from: res)
        currentSessionID = nil            // an imported game is not the saved one you had open
        sheet = nil
        // `importPGN` already replaced the tree; everything downstream still has to catch up.
        reviewSummary = nil
        reviewState = nil
        deselect()
        rebuildPieces()
        refresh()
        scheduleAnalysis()
        scheduleDraft()
        if res.gamesFound > 1 || !res.errors.isEmpty {
            var msg = "\(res.moveCount) moves"
            if res.gamesFound > 1 {
                msg += ". That file held \(res.gamesFound) games — the first was loaded."
            }
            if !res.errors.isEmpty { msg += " \(res.errors.count) token(s) were skipped." }
            sheet = .notice("Imported", msg)
        }
    }

    /// Pre-fill the save form from the PGN's headers, only where the field is still empty
    /// (handleImportPgn:2333-2349) — so an import never overwrites something already typed.
    private func fillSaveFields(from res: AnalysisSession.ImportResult) {
        func fill(_ field: inout String, _ value: String?) {
            if let v = value, !v.isEmpty, field.isEmpty { field = v }
        }
        let h = res.headers
        fill(&saveFields.whitePlayer, h["White"])
        fill(&saveFields.blackPlayer, h["Black"])
        fill(&saveFields.whiteRating, h["WhiteElo"])
        fill(&saveFields.blackRating, h["BlackElo"])
        fill(&saveFields.eventName, h["Event"])
        fill(&saveFields.location, h["Site"])
        fill(&saveFields.roundInfo, h["Round"])
        fill(&saveFields.eco, h["ECO"])
        fill(&saveFields.timeControl, h["TimeControl"])
        if let date = h["Date"], saveFields.gameDate.isEmpty {
            let iso = date.replacingOccurrences(of: ".", with: "-")
            if iso.count == 10, iso.allSatisfy({ $0.isNumber || $0 == "-" }) { saveFields.gameDate = iso }
        }
        if saveFields.result == "*", PGN.results.contains(res.result), res.result != "*" {
            saveFields.result = res.result
        }
        if saveFields.title.isEmpty, let w = h["White"], let b = h["Black"] {
            saveFields.title = "\(w) vs \(b)"
        }
    }

    /// A filename for the export sheet. Anything but letters, digits, dot and dash goes.
    var exportFilename: String {
        let base = saveFields.title.isEmpty ? "analysis" : saveFields.title
        let cleaned = base.map { ch -> Character in
            (ch.isLetter || ch.isNumber || ch == "." || ch == "-") ? ch : "_"
        }
        return String(cleaned)
    }

}
