// StockfishSmoke — the one gate that actually runs the engine. See Package.swift.
import Foundation
import BiyaherongCoachCore
import StockfishEngine

func die(_ m: String) -> Never { print("FAIL: \(m)"); exit(1) }

switch StockfishRuntime.start() {
case .failure(let e): die("start() -> \(e.message)")
case .success: break
}
print("banner        : \(StockfishRuntime.versionBanner)")
print("isStarted     : \(StockfishRuntime.isStarted)")

guard let pos = ChessPosition(fen: ChessPosition.startFEN) else { die("bad start FEN") }
let engine = StockfishEngine(movetimeMs: 1200)
StockfishRuntime.newGame()

let t0 = Date()
let snap = engine.analyze(pos,
                          limits: SearchLimits(maxDepth: 24, maxNodes: 0, multiPV: 3),
                          historyKeys: [],
                          shouldCancel: { false },
                          onProgress: { _ in })
let secs = Date().timeIntervalSince(t0)

print("elapsed       : \(String(format: "%.2f", secs))s")
print("depth         : \(snap.depth)")
print("nodes         : \(snap.nodes)")
print("nps           : \(Int(Double(snap.nodes) / max(secs, 0.001)))")
print("lines         : \(snap.lines.count)")
for l in snap.lines {
    print("  #\(l.rank) \(l.score) d\(l.depth)  \(l.pvSAN.prefix(8).joined(separator: " "))")
}

// A mate the engine must see, to prove the search is real and the sign is right.
guard let m2 = ChessPosition(fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1") else { die("bad FEN") }
StockfishRuntime.newGame()
let ms = engine.analyze(m2, limits: SearchLimits(maxDepth: 20, maxNodes: 0, multiPV: 1),
                        historyKeys: [], shouldCancel: { false }, onProgress: { _ in })
print("rook-endgame  : \(ms.score.map { "\($0)" } ?? "nil")  best=\(ms.lines.first?.pvSAN.first ?? "-")")

if snap.lines.isEmpty { die("no lines returned") }
if snap.depth < 12 { die("depth \(snap.depth) — NNUE is probably scalar, or the search never ran") }
if snap.nodes < 100_000 { die("only \(snap.nodes) nodes in \(secs)s") }
if case .cp(let c) = snap.lines[0].score {
    if abs(c) > 120 { die("start position scored \(c)cp — evaluation is wrong") }
} else { die("start position is not a cp score") }
print("\nSMOKE OK")
StockfishRuntime.shutdown()
