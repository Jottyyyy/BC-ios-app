import Foundation

/// How strong each coach plays, and how long it appears to think (spec §2.2).
///
/// Twin of `web-demo/js/coach-engine.js`; `tools/qa/replay_coach.js` checks this source against it.
/// Foundation only and pure by construction — the randomness is injected, never read.
///
/// ## This is not `ChessAI`
///
/// `ChessAI.swift` already holds five personas driven by `blunderChance` and `randomness` over a
/// negamax search. Spec §2.2 says that is not how the real app works:
///
///   "Strength comes from three things only: search depth, MultiPV width, and a client-side
///    randomiser. There is no Skill Level, no UCI_LimitStrength, no Elo cap, and no explicit
///    blunder chance."
///
/// So this sits BESIDE that one, exactly as `PairingEngine` sits beside `TournamentEngine`. Levels
/// 1–3 get their weakness from picking a worse line out of a MultiPV list rather than from a dice
/// roll against the best move — a different distribution, and the reason level 1 blunders in a
/// *plausible* way instead of a random one.
public enum CoachEngine {

    // MARK: - Level configuration (spec §2.2, verbatim)

    public struct Config: Equatable, Sendable {
        /// Search depth — a CEILING, not a target. At the ~60k nodes/sec this engine measures, a
        /// one-second search reaches depth 5-6 in a middlegame, so levels 4 and 5 never came near
        /// theirs. The clock below is what actually decides strength.
        public let depth: Int
        /// The MultiPV width to ask the engine for. This is what makes the weak levels weak: level
        /// 1 chooses uniformly among three lines at depth 2, so its mistakes are real moves a weak
        /// player might find, not noise.
        public let numMoves: Int
        /// How long this level may think, in milliseconds.
        public let movetimeMs: Int
    }

    /// ## Why the movetime is per level
    ///
    /// All five levels used to share one flat `movetimeCapMs = 1000`. Because `depth` is only a
    /// ceiling, the clock is what really sets strength — so a flat clock meant a flat ladder at the
    /// top. Measured over `engine_budget_check.js`'s six positions this engine reaches a mean depth
    /// of 6.33 at 1200 ms; levels 4 and 5 ask for 10 and 15 and got neither, which made "Coach
    /// Pogi" and "Mommy Julie" the same opponent in different art.
    ///
    /// **Level 3 still gets exactly 1000 ms**, so the middle of the ladder plays precisely as it
    /// always has and the change is anchored to the old behaviour at one point.
    ///
    /// ## How this composes with `thinkMs`, which is NOT the same knob
    ///
    /// `thinkMs` below is a **floor** on the reply, awaited in parallel with the search so a coach
    /// never answers instantly. This is a **ceiling** on the search. The reply therefore lands at
    /// `max(search, floor)`, and the two do not need to agree: a level whose search outruns its
    /// floor simply stops being paced, which is what happens at levels 4 and 5 now. Raising the
    /// floors to match would make *fast* positions — a book move, a forced recapture — artificially
    /// slow, which is the opposite of what the floor is for. They are deliberately left alone.
    ///
    /// **Endgames are bounded by `depth`, not by this clock.** `endgameScale` trims the think floor
    /// only, so nothing here scales down on a near-empty board — but nothing needs to: a sparse
    /// position reaches level 5's depth-15 ceiling long before 4 s, and terminating on the ceiling
    /// is precisely what `EngineSettings` says `maxDepth` exists for.
    ///
    /// A sanctioned DEVIATION from the Python service's flat cap — see PORTING_NOTES.md.
    public static let levelConfig: [Int: Config] = [
        1: Config(depth: 2, numMoves: 3, movetimeMs: 300),
        2: Config(depth: 4, numMoves: 3, movetimeMs: 600),
        3: Config(depth: 7, numMoves: 2, movetimeMs: 1000),
        4: Config(depth: 10, numMoves: 1, movetimeMs: 2000),
        5: Config(depth: 15, numMoves: 1, movetimeMs: 4000),
    ]

    public static let minLevel = 1
    public static let maxLevel = 5

    public static func config(level: Int) -> Config {
        levelConfig[clamp(level: level)] ?? Config(depth: 2, numMoves: 3, movetimeMs: 300)
    }

    /// Spec §7 #35: a deep link can arrive with a level that is not a level, and the RN app indexed
    /// `COACH_DATA[NaN]`. Clamping is the whole fix.
    public static func clamp(level: Int) -> Int {
        min(maxLevel, max(minLevel, level))
    }

    /// The string form, for a deep-link parameter.
    ///
    /// Matches JavaScript `parseInt(s, 10)`: leading digits win and trailing rubbish is ignored
    /// (`"3abc"` is 3), and anything with no leading integer at all falls to the minimum.
    public static func clamp(levelString s: String?) -> Int {
        guard let s = s else { return minLevel }
        let t = s.trimmingCharacters(in: .whitespaces)
        var digits = ""
        for (i, ch) in t.enumerated() {
            if i == 0, ch == "-" || ch == "+" { digits.append(ch); continue }
            guard ch.isNumber else { break }
            digits.append(ch)
        }
        guard let n = Int(digits) else { return minLevel }
        return clamp(level: n)
    }

    // MARK: - Move choice

    /// Which of the engine's lines the coach actually plays.
    ///
    /// `count` is the MultiPV list length, best first. `rng` returns [0,1).
    ///
    ///   L1  uniform over all lines            — this IS the blunder injection
    ///   L2  best 40 % of the time, else uniform over all lines (so best ends up ~60 %)
    ///   L3  best 70 %, otherwise the second line
    ///   L4  always best
    ///   L5  always best
    ///
    /// Returns the INDEX, not the line: the caller has the line, and an index is what a
    /// distribution test can count.
    public static func pickIndex(count: Int, level: Int, rng: () -> Double) -> Int {
        if count <= 1 { return 0 }
        switch clamp(level: level) {
        case 1:
            return Int(Double(count) * rng()) % count
        case 2:
            return rng() < 0.4 ? 0 : Int(Double(count) * rng()) % count
        case 3:
            return rng() < 0.7 ? 0 : Swift.min(1, count - 1)
        default:
            return 0
        }
    }

    public static func pickMove<Line>(_ top: [Line], level: Int, rng: () -> Double) -> Line? {
        guard !top.isEmpty else { return nil }
        return top[pickIndex(count: top.count, level: level, rng: rng)]
    }

    // MARK: - Think time
    //
    // New, and required. On-device the engine answers in milliseconds, where the RN bots were paced
    // by network latency. Without a delay the coach replies instantly and the game feels broken.

    public struct Band: Equatable, Sendable {
        public let min: Int
        public let max: Int
    }

    public static let thinkMs: [Int: Band] = [
        1: Band(min: 300, max: 700),
        2: Band(min: 400, max: 900),
        3: Band(min: 600, max: 1300),
        4: Band(min: 800, max: 1700),
        5: Band(min: 1000, max: 2200),
    ]

    /// Below this many pieces the upper bound is scaled down, so endgames do not drag.
    public static let endgamePieces = 8
    public static let endgameScale = 0.6        // "scale the upper bound down by 40 %"

    /// How long the coach should appear to think, in ms.
    ///
    /// Awaited in PARALLEL with the search, not after it — the point is a floor on the reply, not
    /// an added delay. Spec §2.13's "no coach ever replies in under 300 ms" is the same statement.
    public static func thinkTimeMs(level: Int, pieceCount: Int?, rng: () -> Double) -> Int {
        let band = thinkMs[clamp(level: level)] ?? Band(min: 300, max: 700)
        var upper = band.max
        if let pieces = pieceCount, pieces < endgamePieces {
            // JS `Math.round`, which is half-UP rather than Swift's half-to-even. Every product
            // here is an exact integer at .0 or .2, so the two agree — but the intent is the JS
            // rule, and a future band with a .5 product must follow it.
            upper = Int((Double(upper) * endgameScale).rounded(.toNearestOrAwayFromZero))
        }
        // The floor is never scaled: a fast reply is the thing being prevented.
        if upper < band.min { upper = band.min }
        return band.min + Int(rng() * Double(upper - band.min + 1))
    }

    // MARK: - Search limits

    public struct Limits: Equatable, Sendable {
        public let depth: Int
        public let multiPV: Int
        public let movetimeMs: Int
    }

    /// The limits to hand the engine for one reply.
    public static func searchLimits(level: Int) -> Limits {
        let c = config(level: level)
        return Limits(depth: c.depth, multiPV: c.numMoves, movetimeMs: c.movetimeMs)
    }
}
