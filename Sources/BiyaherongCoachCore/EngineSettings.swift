import Foundation

/// How hard the analysis engine is allowed to work — and everything the Engine panel draws.
///
/// Twin of `web-demo/js/engine-settings.js`; `tools/qa/replay_engine_settings.js` checks this source
/// against it. Foundation only and pure: storage arrives as a protocol, exactly as `CoachGame.Storage`
/// does, so the Core stays testable and the `UserDefaults` adapter lives in the UI layer.
///
/// ## What this is for
///
/// Strength costs time, and time costs battery and heat. Which trade to make is the user's call, not
/// ours, so it is a setting: five presets from Battery Saver to Infinite, plus raw controls for
/// anyone who wants to name the numbers themselves.
///
/// ## Why the deadline is the real knob, and depth is only a ceiling
///
/// Search cost is about 6× per ply and varies ~15× by position type. Measured on this engine over
/// the six positions `tools/qa/engine_budget_check.js` uses:
///
///     budget    depths reached          mean
///     500ms     5 4 4 8 7 3             5.17
///     1200ms    6 4 4 12 8 4            6.33
///     3000ms    7 5 5 18 10 5           8.33
///     8000ms    7 6 6 22 11 6           9.67
///
/// A fixed depth would be far too slow in the sharp midgame and far too shallow in the quiet
/// endgame — note that only the quiet endgame ever reaches its ceiling. So every preset is a
/// DEADLINE, and `maxDepth` exists to stop a nearly-empty board spinning forever.
///
/// ## Infinite
///
/// `thinkMs == 0` means no deadline: the search keeps deepening until the position changes, the user
/// stops it, or it hits `maxDepth` — which is what guarantees it terminates at all. **Infinite
/// deliberately does not apply to Analyze Game**: a 41-position review cannot be unbounded, so the
/// review budget saturates at `reviewMax` instead.
public enum EngineSettings {

    /// Where a chosen setting is kept. Same shape as `CoachGame.Storage`, and for the same reason:
    /// `UserDefaults` is a UI-layer concern and the Core must stay Foundation-only and injectable.
    public protocol Storage {
        func get(_ key: String) -> String?
        func set(_ key: String, _ value: String)
        func remove(_ key: String)
    }

    // MARK: - Presets

    public struct Preset: Equatable, Sendable {
        public let id: String
        public let label: String
        /// `0` means no deadline at all.
        public let thinkMs: Int
        public let maxDepth: Int
        public let multiPV: Int
        /// 0–4. Drives nothing but the warning the panel shows; here rather than in the view so both
        /// languages agree on which presets are the expensive ones.
        public let heat: Int
    }

    /// Weakest and coolest first.
    ///
    /// **The ceilings were raised on 2026-08-26, and the clocks were not touched.** They were chosen
    /// against `LocalEngine`, which reached a mean depth of about 5 in 1.2 seconds — so a ceiling of
    /// 12 was never the thing that stopped a search, and `docs/engine-settings.md` could truthfully
    /// say "only the quiet endgame ever reaches its ceiling". Stockfish reaches 12 in a fraction of
    /// that budget, which inverted the design: the ceiling became the binding limit and the engine
    /// stopped early with time left on its own clock.
    ///
    /// Raising them is close to free, and that asymmetry is the whole reason this was safe to change
    /// without re-tuning anything else: **`thinkMs` is what costs battery, heat and the delay before
    /// the board settles; `maxDepth` costs nothing until it binds.** Every preset therefore searches
    /// deeper at exactly the same power draw and the same responsiveness as before.
    ///
    /// The ceiling still has a job — `Infinite` has no clock, so 30 is the only thing guaranteeing
    /// it terminates on a nearly-empty board. That is also why the ladder stays STRICTLY increasing
    /// and `Maximum` stops at 28: `selfTest` asserts "infinite searches deeper than maximum", and a
    /// preset list where the strongest two share a ceiling makes the top of the ladder a lie.
    public static let presets: [Preset] = [
        Preset(id: "saver", label: "Battery Saver", thinkMs: 500, maxDepth: 16, multiPV: 2, heat: 0),
        Preset(id: "balanced", label: "Balanced", thinkMs: 1200, maxDepth: 22, multiPV: 3, heat: 1),
        Preset(id: "strong", label: "Strong", thinkMs: 3000, maxDepth: 26, multiPV: 3, heat: 2),
        Preset(id: "maximum", label: "Maximum", thinkMs: 8000, maxDepth: 28, multiPV: 4, heat: 3),
        Preset(id: "infinite", label: "Infinite", thinkMs: 0, maxDepth: 30, multiPV: 4, heat: 4)
    ]
    public static let defaultPreset = "balanced"

    /// Advanced-mode ranges. Every value that reaches the engine passes through `clamp`.
    public static let linesMin = 1, linesMax = 5
    public static let depthMin = 2, depthMax = 30
    public static let thinkMin = 200, thinkMax = 30000
    /// The one legal value below `thinkMin`, and the only way to ask for no deadline at all.
    public static let thinkInfinite = 0

    /// The per-position budget for Analyze Game is DERIVED from the interactive one, not a sixth
    /// column in the table above. A review is ~41 positions where a live search is one, so it gets a
    /// fraction of the time with a floor and a ceiling around it. Deriving rather than listing is
    /// what stops the two drifting; the JS twin's self-test pins the five values this produces.
    public static let reviewDivisor = 6, reviewMin = 120, reviewMax = 1200

    public static let storageKey = "biya.analysis.engine.v1"
    /// Bumped only if the encoded shape changes; an unknown version decodes to the defaults.
    public static let encodingVersion = "v1"

    public static let heatWarningMin = 2
    public static let warningText = "Stronger, but the phone runs hotter and each move takes longer."
    public static let infiniteWarningText =
        "Runs until you stop it. Tap the engine button to stop. Analyze Game stays time-limited."

    public static func presetIDs() -> [String] { presets.map(\.id) }

    /// Unknown ids fall back to the default rather than trapping — a stored id can outlive a rename.
    public static func preset(_ id: String) -> Preset {
        presets.first { $0.id == id } ?? presets.first { $0.id == defaultPreset }!
    }

    // MARK: - The stored value

    public struct Value: Equatable, Sendable {
        public var preset: String
        public var custom: Bool
        public var multiPV: Int
        public var maxDepth: Int
        public var thinkMs: Int

        public init(preset: String, custom: Bool, multiPV: Int, maxDepth: Int, thinkMs: Int) {
            self.preset = preset; self.custom = custom
            self.multiPV = multiPV; self.maxDepth = maxDepth; self.thinkMs = thinkMs
        }
    }

    public static func defaults() -> Value {
        let p = preset(defaultPreset)
        return Value(preset: defaultPreset, custom: false,
                     multiPV: p.multiPV, maxDepth: p.maxDepth, thinkMs: p.thinkMs)
    }

    static func clampInt(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, v)) }

    /// Every field forced into range. The only way settings reach the engine.
    public static func clamp(_ v: Value) -> Value {
        let id = presetIDs().contains(v.preset) ? v.preset : defaultPreset
        let think = v.thinkMs == thinkInfinite ? thinkInfinite : clampInt(v.thinkMs, thinkMin, thinkMax)
        return Value(preset: id,
                     custom: v.custom,
                     multiPV: clampInt(v.multiPV, linesMin, linesMax),
                     maxDepth: clampInt(v.maxDepth, depthMin, depthMax),
                     thinkMs: think)
    }

    /// Interactive budget → per-position review budget. See `reviewDivisor` above.
    public static func reviewBudget(_ thinkMs: Int) -> Int {
        if thinkMs == thinkInfinite { return reviewMax }     // a review is never unbounded
        return clampInt(Int((Double(thinkMs) / Double(reviewDivisor)).rounded()), reviewMin, reviewMax)
    }

    // MARK: - Resolved

    /// What the engine actually gets.
    ///
    /// `infinite` is its own flag rather than "thinkMs happens to be 0", because every call site has
    /// to branch on it — the deadline closure, the status line and the stop button all behave
    /// differently — and a magic zero read three ways is a bug waiting to happen.
    public struct Resolved: Equatable, Sendable {
        public let label: String
        public let multiPV: Int
        public let maxDepth: Int
        public let thinkMs: Int
        public let infinite: Bool
        public let reviewMs: Int
        public let heat: Int

        /// The `SearchLimits` the Core's engine protocol takes.
        public var searchLimits: SearchLimits {
            SearchLimits(maxDepth: maxDepth, maxNodes: 0, multiPV: multiPV)
        }

        /// Review runs one line and its own per-position budget; the depth ceiling is shared.
        public var reviewLimits: SearchLimits {
            SearchLimits(maxDepth: maxDepth, maxNodes: 0, multiPV: 1)
        }
    }

    public static func resolve(_ value: Value) -> Resolved {
        let c = clamp(value)
        let p = preset(c.preset)
        let multiPV = c.custom ? c.multiPV : p.multiPV
        let maxDepth = c.custom ? c.maxDepth : p.maxDepth
        let thinkMs = c.custom ? c.thinkMs : p.thinkMs
        return Resolved(label: c.custom ? "Custom" : p.label,
                        multiPV: multiPV,
                        maxDepth: maxDepth,
                        thinkMs: thinkMs,
                        infinite: thinkMs == thinkInfinite,
                        reviewMs: reviewBudget(thinkMs),
                        heat: c.custom ? heatForCustom(thinkMs) : p.heat)
    }

    /// Custom settings still need a heat level, and time is what generates the heat.
    public static func heatForCustom(_ thinkMs: Int) -> Int {
        if thinkMs == thinkInfinite { return 4 }
        var best = 0
        for p in presets where p.thinkMs != thinkInfinite && thinkMs >= p.thinkMs { best = p.heat }
        return best
    }

    // MARK: - Display

    /// `"1.2s"` / `"0.5s"` / `"∞"`. Seconds, because milliseconds mean nothing to a reader.
    public static func timeText(_ thinkMs: Int) -> String {
        if thinkMs == thinkInfinite { return "∞" }
        let s = String(format: "%.1f", Double(thinkMs) / 1000)
        return (s.hasSuffix(".0") ? String(s.dropLast(2)) : s) + "s"
    }

    /// The one-line description under a preset name: `"1.2s · depth 22 · 3 lines"`.
    public static func summary(_ r: Resolved) -> String {
        "\(timeText(r.thinkMs)) · depth \(r.maxDepth) · \(r.multiPV) \(r.multiPV == 1 ? "line" : "lines")"
    }

    public static func presetSummary(_ id: String) -> String {
        summary(resolve(Value(preset: id, custom: false, multiPV: 0, maxDepth: 0, thinkMs: 0)))
    }

    /// The warning under the list, or nil when there is nothing worth warning about.
    public static func warning(_ v: Value) -> String? {
        let r = resolve(v)
        if r.infinite { return infiniteWarningText }
        return r.heat >= heatWarningMin ? warningText : nil
    }

    // MARK: - The panel, as data
    //
    // Which rows exist, what they say, which is selected, which controls Advanced shows and what
    // each one's range is — decided here rather than in a view body. Two reasons, and the second is
    // the one that matters:
    //
    //  1. `AnalysisBoardScreen.swift` forbids numeric literals and arithmetic in view bodies, and
    //     there is no compiler on this checkout to catch a view that got it wrong anyway.
    //  2. The SwiftUI panel and the web one must be the same panel. Sharing the model rather than
    //     the screenshot is what makes that true by construction instead of by proofreading.

    public static let controlLines = "multiPV"
    public static let controlDepth = "maxDepth"
    public static let controlThink = "thinkMs"

    /// The Think time control folds "no deadline" into the bottom of its own range: one step below
    /// `thinkMin` means Infinite. A slider plus a separate Infinite toggle would let the two
    /// disagree (what does a 5 s infinite search mean?); one control cannot.
    public static let thinkStep = 100
    public static var thinkSliderMin: Int { thinkMin - thinkStep }

    public enum ControlKind: String, Equatable, Sendable { case segment, slider }

    public struct Control: Equatable, Sendable, Identifiable {
        public let key: String
        public let kind: ControlKind
        public let label: String
        public let value: Int
        public let valueText: String
        public let min: Int
        public let max: Int
        public let step: Int
        /// Non-empty only for `.segment`.
        public let options: [Int]

        public var id: String { key }
    }

    public struct PresetRow: Equatable, Sendable, Identifiable {
        public let id: String
        public let label: String
        public let summary: String
        public let active: Bool
    }

    public struct PanelModel: Equatable, Sendable {
        public let title: String
        public let presets: [PresetRow]
        public let warning: String?
        public let advancedOpen: Bool
        public let advancedLabel: String
        public let advancedState: String
        public let controls: [Control]
        public let resolved: Resolved
    }

    static func controls(for r: Resolved) -> [Control] {
        [
            Control(key: controlLines, kind: .segment, label: "Lines",
                    value: r.multiPV, valueText: String(r.multiPV),
                    min: linesMin, max: linesMax, step: 1, options: [1, 2, 3, 4, 5]),
            Control(key: controlDepth, kind: .slider, label: "Max depth",
                    value: r.maxDepth, valueText: String(r.maxDepth),
                    min: depthMin, max: depthMax, step: 1, options: []),
            Control(key: controlThink, kind: .slider, label: "Think time",
                    value: r.infinite ? thinkSliderMin : r.thinkMs, valueText: timeText(r.thinkMs),
                    min: thinkSliderMin, max: thinkMax, step: thinkStep, options: [])
        ]
    }

    /// Everything the Engine panel draws, for a given stored setting.
    public static func panelModel(_ value: Value, advancedOpen: Bool) -> PanelModel {
        let c = clamp(value)
        let r = resolve(c)
        return PanelModel(
            title: "Engine",
            presets: presets.map { p in
                PresetRow(id: p.id, label: p.label, summary: presetSummary(p.id),
                          active: !c.custom && c.preset == p.id)
            },
            warning: warning(c),
            advancedOpen: advancedOpen || c.custom,
            advancedLabel: "Advanced",
            advancedState: c.custom ? "ON" : "OFF",
            controls: controls(for: r),
            resolved: r)
    }

    /// Picking a preset also seeds the Advanced fields, so opening it starts from what was chosen.
    public static func selectPreset(_ value: Value, _ id: String) -> Value {
        let p = preset(id)
        return clamp(Value(preset: p.id, custom: false,
                           multiPV: p.multiPV, maxDepth: p.maxDepth, thinkMs: p.thinkMs))
    }

    /// Apply one Advanced control's new value.
    ///
    /// Always switches Advanced ON: editing a control that then did nothing because a preset was
    /// still selected would be the panel lying about what it does.
    public static func applyControl(_ value: Value, _ key: String, _ newValue: Int) -> Value {
        let c = clamp(value)
        let r = resolve(c)
        var next = Value(preset: c.preset, custom: true,
                         multiPV: r.multiPV, maxDepth: r.maxDepth, thinkMs: r.thinkMs)
        if key == controlThink {
            next.thinkMs = newValue < thinkMin ? thinkInfinite : newValue
        } else if key == controlLines {
            next.multiPV = newValue
        } else if key == controlDepth {
            next.maxDepth = newValue
        }
        return clamp(next)
    }

    // MARK: - Persistence
    //
    // A pipe-delimited line rather than JSON: the same handful of characters in both languages with
    // no encoder to agree on, readable in a storage inspector, and a corrupt or truncated one
    // decodes to the defaults instead of throwing.

    public static func encode(_ value: Value) -> String {
        let c = clamp(value)
        return [encodingVersion, c.preset, c.custom ? "1" : "0",
                String(c.multiPV), String(c.maxDepth), String(c.thinkMs)].joined(separator: "|")
    }

    public static func decode(_ text: String?) -> Value {
        guard let text, !text.isEmpty else { return defaults() }
        let parts = text.components(separatedBy: "|")
        guard parts.count == 6, parts[0] == encodingVersion else { return defaults() }
        let d = defaults()
        let think = parts[5] == "0" ? thinkInfinite : (Int(parts[5]) ?? d.thinkMs)
        return clamp(Value(preset: parts[1],
                           custom: parts[2] == "1",
                           multiPV: Int(parts[3]) ?? d.multiPV,
                           maxDepth: Int(parts[4]) ?? d.maxDepth,
                           thinkMs: think))
    }

    public static func load(_ storage: Storage) -> Value { decode(storage.get(storageKey)) }

    public static func save(_ value: Value, _ storage: Storage) {
        storage.set(storageKey, encode(value))
    }
}
