import Foundation
import AVFoundation
import BiyaherongCoachCore

/// Plays the bundled chess sounds for move / capture / castle / check / game start & end.
@MainActor
final class SoundManager {
    static let shared = SoundManager()
    var enabled = true
    private var players: [String: AVAudioPlayer] = [:]

    private init() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }

    private func player(_ name: String) -> AVAudioPlayer? {
        if let p = players[name] { return p }
        guard let url = Bundle.module.url(forResource: name, withExtension: "mp3", subdirectory: "Sounds"),
              let p = try? AVAudioPlayer(contentsOf: url) else { return nil }
        p.prepareToPlay()
        players[name] = p
        return p
    }

    func play(_ name: String) {
        guard enabled, let p = player(name) else { return }
        p.currentTime = 0
        p.play()
    }

    func gameStart() { play("game-start") }

    /// Pick the right sound for a played move, given its nature and the resulting position status.
    func playMove(isCastle: Bool, isCapture: Bool, status: ChessPosition.Status) {
        switch status {
        case .checkmate: play("game-over")
        case .check:     play("check")
        default:
            if isCastle { play("castling") }
            else if isCapture { play("capture") }
            else { play("move") }
        }
    }
}

/// Classify a move (before it is applied) for sound selection.
func moveIsCastle(_ pos: ChessPosition, _ m: Move) -> Bool {
    pos.squares[m.from]?.kind == .king && abs(Square.file(m.to) - Square.file(m.from)) == 2
}
func moveIsCapture(_ pos: ChessPosition, _ m: Move) -> Bool {
    if pos.squares[m.to] != nil { return true }
    // en passant
    return pos.squares[m.from]?.kind == .pawn && m.to == pos.enPassant
}
