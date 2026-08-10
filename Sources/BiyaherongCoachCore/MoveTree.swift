import Foundation

/// The analysis move tree, with variations (Analysis Board).
///
/// Every position the user reaches is a node; `children[0]` **is** the main line at that point, and
/// every other child is a variation. This is the single data structure the whole Analysis Board is
/// a view over.
///
/// The pure payoff is `flatten()`: it turns the tree into a flat array of plain value rows, which is
/// what the views actually render. Keeping the traversal, the move numbering and the variation
/// nesting inside one pure function is what lets the parity suite assert tree semantics without a
/// renderer — and what lets Swift and JavaScript be checked against each other row for row.
///
/// Transliterated from `web-demo/js/movetree.js`, which is proven by its own 59-assertion suite.
///
/// Nodes hold a `weak` reference to their parent, so the graph does not leak; a tree is kept alive
/// by holding its `MoveTree`.

// MARK: - Node

public final class MoveNode {
    public let id: Int
    public weak var parent: MoveNode?
    /// `children[0]` is the main line. Deliberately a plain `var`: a `private(set)` setter would be
    /// unreachable from `MoveTree`, which is a sibling type rather than an extension.
    public var children: [MoveNode] = []

    /// `nil` only at the root.
    public let move: Move?
    public let san: String
    public let uci: String
    /// The full-move number of the position *before* this move.
    public let moveNumber: Int
    /// The side that played this move.
    public let color: PieceColor
    /// Half-moves from the root; the root is 0.
    public let ply: Int
    public let fenAfter: String
    public let key: String

    public var nag: Int = 0
    public var comment: String = ""

    init(id: Int, parent: MoveNode?, move: Move?, san: String, uci: String,
         moveNumber: Int, color: PieceColor, ply: Int, fenAfter: String, key: String) {
        self.id = id
        self.parent = parent
        self.move = move
        self.san = san
        self.uci = uci
        self.moveNumber = moveNumber
        self.color = color
        self.ply = ply
        self.fenAfter = fenAfter
        self.key = key
    }

    /// The parsed position *after* this node's move.
    public var position: ChessPosition? { ChessPosition(fen: fenAfter) }
}

// MARK: - Render model

/// One row of the flattened tree — a plain value, so the views can diff it and the two languages can
/// be compared row for row. It holds no node references.
public struct TreeRow: Equatable, Sendable {
    public var id: Int
    public var parentID: Int?
    public var depth: Int
    public var ply: Int
    public var moveNumber: Int
    public var color: PieceColor
    public var numberText: String
    public var san: String
    public var uci: String
    public var nag: Int
    public var comment: String
    public var fenAfter: String
    public var key: String
    public var isMainline: Bool
    public var isCurrent: Bool
    public var isOnPath: Bool
}

// MARK: - Tree

public final class MoveTree {
    public let root: MoveNode
    public var current: MoveNode
    public let initialFEN: String
    private var nextId: Int

    /// `nil` if `fen` does not parse.
    public init?(initialFEN fen: String = ChessPosition.startFEN) {
        guard let pos = ChessPosition(fen: fen) else { return nil }
        let normalised = pos.fen
        root = MoveNode(id: 0, parent: nil, move: nil, san: "", uci: "",
                        moveNumber: pos.fullmove, color: pos.sideToMove, ply: 0,
                        fenAfter: normalised, key: pos.positionKey)
        current = root
        initialFEN = normalised
        nextId = 1
    }

    // MARK: Adding moves

    /// The outcome of playing a move: the node landed on, and whether it had to be created.
    public struct AddResult {
        public let node: MoveNode
        public let created: Bool
    }

    /// Play `move` from the current node.
    ///
    /// Replaying a move that already exists **navigates into it** rather than duplicating the node —
    /// the rule the board depends on so that repeating a line never forks it. Returns `nil` if the
    /// move is not legal here.
    @discardableResult
    public func add(move: Move) -> AddResult? {
        let cur = current
        for child in cur.children where child.move == move {
            current = child
            return AddResult(node: child, created: false)
        }
        guard let pos = cur.position else { return nil }
        guard pos.legalMoves().contains(move) else { return nil }

        let after = pos.makeMove(move)
        let node = MoveNode(id: nextId, parent: cur, move: move,
                            san: pos.san(for: move), uci: move.uci,
                            moveNumber: pos.fullmove, color: pos.sideToMove, ply: cur.ply + 1,
                            fenAfter: after.fen, key: after.positionKey)
        nextId += 1
        cur.children.append(node)
        current = node
        return AddResult(node: node, created: true)
    }

    /// Play a SAN move from the current node.
    @discardableResult
    public func add(san: String) -> AddResult? {
        guard let pos = current.position, let m = pos.move(forSAN: san) else { return nil }
        return add(move: m)
    }

    /// Play a UCI move from the current node.
    @discardableResult
    public func add(uci: String) -> AddResult? {
        guard let pos = current.position, let m = pos.move(forUCI: uci) else { return nil }
        return add(move: m)
    }

    // MARK: Navigation

    @discardableResult public func goTo(_ node: MoveNode) -> MoveNode { current = node; return node }
    @discardableResult public func goToStart() -> MoveNode { current = root; return root }

    @discardableResult
    public func goBack() -> MoveNode {
        if let p = current.parent { current = p }
        return current
    }

    /// The continuations available from the current node — more than one means the UI must ask.
    public func forwardOptions() -> [MoveNode] { current.children }

    @discardableResult
    public func goForward(_ index: Int = 0) -> MoveNode {
        let kids = current.children
        guard !kids.isEmpty else { return current }
        current = (index >= 0 && index < kids.count) ? kids[index] : kids[0]
        return current
    }

    /// Follow `children[0]` to the end of the line the current node sits on.
    @discardableResult
    public func goToEnd() -> MoveNode {
        while let first = current.children.first { current = first }
        return current
    }

    // MARK: Paths

    /// Child indices from the root down to `node` — the cursor format drafts persist.
    public static func path(to node: MoveNode) -> [Int] {
        var path: [Int] = []
        var n: MoveNode? = node
        while let cur = n, let parent = cur.parent {
            if let i = parent.children.firstIndex(where: { $0 === cur }) { path.insert(i, at: 0) }
            n = parent
        }
        return path
    }

    /// Resolve a child-index path. `nil` if it does not exist.
    public func node(atPath path: [Int]) -> MoveNode? {
        var n = root
        for i in path {
            guard i >= 0, i < n.children.count else { return nil }
            n = n.children[i]
        }
        return n
    }

    /// Root to `node`, inclusive.
    public static func line(to node: MoveNode) -> [MoveNode] {
        var out: [MoveNode] = []
        var n: MoveNode? = node
        while let cur = n { out.insert(cur, at: 0); n = cur.parent }
        return out
    }

    /// Every position key from the root to `node` inclusive — the input `drawReason` expects.
    public static func historyKeys(to node: MoveNode) -> [String] {
        line(to: node).map { $0.key }
    }

    /// The main line from the root: follow `children[0]` to the end.
    public func mainline() -> [MoveNode] {
        var out: [MoveNode] = []
        var n = root
        while let first = n.children.first { out.append(first); n = first }
        return out
    }

    public func mainlineSANs() -> [String] { mainline().map { $0.san } }

    // MARK: Editing

    /// Make `node` its parent's main line by swapping it with `children[0]`.
    @discardableResult
    public func promote(_ node: MoveNode) -> Bool {
        guard let p = node.parent,
              let i = p.children.firstIndex(where: { $0 === node }), i > 0 else { return false }
        p.children.swapAt(0, i)
        return true
    }

    /// Promote `node` and every ancestor, so the whole line becomes the main line.
    @discardableResult
    public func promoteFully(_ node: MoveNode) -> Bool {
        var changed = false
        var n: MoveNode? = node
        while let cur = n, cur.parent != nil {
            if promote(cur) { changed = true }
            n = cur.parent
        }
        return changed
    }

    public static func isDescendant(_ node: MoveNode, of ancestor: MoveNode) -> Bool {
        var n: MoveNode? = node
        while let cur = n {
            if cur === ancestor { return true }
            n = cur.parent
        }
        return false
    }

    public static func subtreeCount(_ node: MoveNode) -> Int {
        var n = 1
        for c in node.children { n += subtreeCount(c) }
        return n
    }

    /// Delete `node` and everything below it, returning the number of nodes removed. If the cursor
    /// was inside the deleted subtree it moves to the parent, so `current` is never left dangling.
    @discardableResult
    public func remove(_ node: MoveNode) -> Int {
        guard let p = node.parent,
              let i = p.children.firstIndex(where: { $0 === node }) else { return 0 }
        let n = MoveTree.subtreeCount(node)
        p.children.remove(at: i)
        if MoveTree.isDescendant(current, of: node) { current = p }
        return n
    }

    /// Truncate: drop every continuation after `node`.
    @discardableResult
    public func removeContinuations(after node: MoveNode) -> Int {
        var n = 0
        while let first = node.children.first { n += remove(first) }
        return n
    }

    // MARK: Flatten — the pure render model

    /// A pre-order walk in PGN reading order: each move, then any alternatives to the move that
    /// *follows* it as nested lines, then the main line continues.
    public func flatten() -> [TreeRow] {
        var rows: [TreeRow] = []
        MoveTree.emit(from: root, depth: 0, into: &rows)

        // A white move always shows "12."; a black move shows "12..." only when it does not directly
        // follow its own parent — i.e. at the start of a line or after an interposed variation.
        // This is exactly PGN's rule, and it is why numbering lives here and not in a view.
        for i in rows.indices {
            if rows[i].color == .white {
                rows[i].numberText = "\(rows[i].moveNumber)."
            } else if i == 0 || rows[i - 1].id != rows[i].parentID {
                rows[i].numberText = "\(rows[i].moveNumber)..."
            } else {
                rows[i].numberText = ""
            }
        }

        var onPath = Set<Int>()
        var n: MoveNode? = current
        while let cur = n { onPath.insert(cur.id); n = cur.parent }
        for i in rows.indices {
            rows[i].isCurrent = rows[i].id == current.id
            rows[i].isOnPath = onPath.contains(rows[i].id)
        }
        return rows
    }

    private static func row(_ node: MoveNode, depth: Int) -> TreeRow {
        TreeRow(id: node.id, parentID: node.parent?.id, depth: depth,
                ply: node.ply, moveNumber: node.moveNumber, color: node.color,
                numberText: "", san: node.san, uci: node.uci,
                nag: node.nag, comment: node.comment,
                fenAfter: node.fenAfter, key: node.key,
                isMainline: depth == 0, isCurrent: false, isOnPath: false)
    }

    /// Iterative along the main line (a long game must not recurse per ply); recursive only into
    /// variations, whose depth the PGN parser caps.
    private static func emit(from parent: MoveNode, depth: Int, into rows: inout [TreeRow]) {
        var p = parent
        while let main = p.children.first {
            rows.append(row(main, depth: depth))
            // `first` was non-nil, so count >= 1 and `1 ..< count` is always a valid (possibly
            // empty) range — it can never trap here.
            for i in 1 ..< p.children.count {
                rows.append(row(p.children[i], depth: depth + 1))
                emit(from: p.children[i], depth: depth + 1, into: &rows)
            }
            p = main
        }
    }
}
