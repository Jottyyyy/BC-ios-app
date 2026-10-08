import Foundation
import AVFoundation
import BiyaherongCoachCore

/// Who owns the process-wide audio category, and why it has to change for video.
///
/// ── The bug this exists to fix ────────────────────────────────────────────────
/// The client reported the tutorial videos play with no sound. They do — with the Ring/Silent
/// switch engaged, which is how most phones live. **`.ambient` is silenced by the mute switch.**
/// It was the only category this app ever set, from `SoundManager.init`, and it is right for chess
/// move effects: a game should not talk over the user's music, and a muted phone should stay muted.
/// It is wrong for a video the user has deliberately pressed play on.
///
/// Worse, the category is process-wide and was set lazily, so the symptom moved around: cold-launch
/// straight into Tutorial Videos and the session was still iOS's default `.soloAmbient`; play a
/// puzzle first and it was `.ambient`. Both are silent behind the mute switch, which is why it
/// looked intermittent.
///
/// ── Why the fix is scoped and not global ──────────────────────────────────────
/// Setting `.playback` once at launch would fix the video and break everything else: chess move
/// effects would then play through a user's silent switch, which is a worse bug reported by more
/// people. So the category follows the screen — `.playback` for exactly as long as the player is
/// on screen, `.ambient` the rest of the time.
///
/// ── The reference has the same bug, and cannot be copied ──────────────────────
/// The RN original sets no audio mode at all, and `expo-av` defaults to
/// `playsInSilentModeIOS: false` → `AVAudioSessionCategoryAmbient` (`EXAudioSessionManager.m:284`).
/// So the Android/Expo build is silenced by its mute switch too. This is a defect faithfully
/// reproduced from the source, not a regression introduced by the port — and the source is
/// therefore no guide to the fix.
enum AudioSession {

    /// The app's resting state: effects that mix with the user's music and respect the mute switch.
    static func ambient() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }

    /// For the video player only. `.playback` plays through the mute switch, which is what every
    /// video app does and what the user expects after pressing play.
    ///
    /// No `.mixWithOthers` here, deliberately: a tutorial video should interrupt the user's music
    /// rather than talk over it. That is the one behavioural difference from the effects category
    /// beyond the mute switch itself.
    static func videoPlayback() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }
}

/// Plays the bundled chess sounds for move / capture / castle / check / game start & end.
@MainActor
final class SoundManager {
    static let shared = SoundManager()
    var enabled = true
    private var players: [String: AVAudioPlayer] = [:]

    private init() { AudioSession.ambient() }

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
