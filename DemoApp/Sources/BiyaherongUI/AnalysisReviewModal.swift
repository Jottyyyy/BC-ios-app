import SwiftUI
import BiyaherongCoachCore

// The accuracy modal and the eval graph (board.tsx:3809-3936, components/EvalGraph.tsx).
//
// An `.overlay` rather than a `.sheet`: this module has no sheet anywhere, and `.fullScreenCover`
// does not exist on macOS, which the demo builds for. `PromotionOverlay` set the precedent.
//
// Three states, matching the source: running (spinner + progress + Skip), results (accuracy pair,
// eval graph, count table), and a too-short guard. The source's fourth state — "Analysis
// unavailable", for a 503/429/network failure — has no offline counterpart and is dropped.
//
// Every number comes from `AnalysisReview` / `AnalysisGraphStyle`, both pinned to the extracted
// StyleSheet. No numeric literal or arithmetic belongs in a view body.

struct AnalysisReviewModal: View {
    enum State: Equatable {
        case running(completed: Int, total: Int)
        case results
        case tooShort
        /// The free tier's daily Game Review allowance is spent. Sits beside `.tooShort` because it
        /// is the same shape of answer: the review cannot start, and here is why.
        case capped
    }

    let state: State
    let summary: ReviewSummary?
    let onCancel: () -> Void
    let onClose: () -> Void
    /// Shown only in the `.capped` state. Defaulted, so every existing call site is unchanged.
    var onUpgrade: (() -> Void)?
    /// The subscription's terms, for the `.capped` state — `PremiumStore.offerNote`, composed by
    /// the host. This overlay is an upsell and named neither the trial nor the price.
    var offerNote: String?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                AnalysisReview.scrim
                    .onTapGesture { if !isRunning { onClose() } }
                card
                    .frame(maxHeight: AnalysisReview.cardMaxHeight(viewportHeight: geo.size.height))
                    .padding(.horizontal, AnalysisReview.overlayPaddingH)
                    .padding(.vertical, AnalysisReview.overlayPaddingV)
            }
        }
    }

    private var isRunning: Bool {
        if case .running = state { return true }
        return false
    }

    private var card: some View {
        VStack(spacing: 0) {
            header
            switch state {
            case .running(let completed, let total):
                runningBody(completed: completed, total: total)
            case .results:
                if let summary {
                    resultsBody(summary)
                    footer
                } else {
                    message("No result", "The review produced nothing to show.")
                }
            case .tooShort:
                message("Not enough moves", "Play or import at least two moves before reviewing.")
            case .capped:
                cappedBody
            }
        }
        .background(AnalysisPalette.reviewCard,
                    in: RoundedRectangle(cornerRadius: AnalysisReview.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: AnalysisReview.cardRadius, style: .continuous)
                .stroke(AnalysisReview.cardBorderColor, lineWidth: AnalysisReview.cardBorder))
    }

    // MARK: - Header

    private var header: some View {
        Text("Game Analysis")
            .font(Theme.nunito(AnalysisReview.titleSize, .extraBold))
            .tracking(AnalysisReview.titleTracking)
            .textCase(.uppercase)
            .foregroundStyle(AnalysisPalette.gold)
            .frame(maxWidth: .infinity)
            .padding(.top, AnalysisReview.headerPaddingTop)
            .padding(.bottom, AnalysisReview.headerPaddingBottom)
            .padding(.horizontal, AnalysisReview.headerPaddingH)
            .overlay(alignment: .bottom) {
                Rectangle().fill(AnalysisReview.hairlineColor).frame(height: AnalysisReview.hairline)
            }
    }

    // MARK: - Running

    private func runningBody(completed: Int, total: Int) -> some View {
        VStack(spacing: AnalysisReview.loadingGap) {
            ProgressView()
                .controlSize(.large)
                .tint(AnalysisPalette.gold)
                .padding(.bottom, AnalysisReview.spinnerGap)
            Text("Analyzing game…")
                .font(Theme.nunito(AnalysisReview.loadingTextSize, .semiBold))
                .foregroundStyle(AnalysisReview.loadingTextColor)
            // The source promises "20-30 seconds" with a server-side engine; we can do better than
            // a static string, because the local one reports real progress.
            Text("\(completed) / \(total) positions")
                .font(Theme.nunito(AnalysisReview.hintSize))
                .foregroundStyle(AnalysisReview.hintColor)
            ProgressView(value: fraction(completed, total))
                .tint(AnalysisPalette.gold)
            Button(action: onCancel) {
                Text("Skip Analysis")
                    .font(Theme.nunito(AnalysisReview.skipTextSize, .semiBold))
                    .foregroundStyle(AnalysisReview.skipTextColor)
                    .padding(.vertical, AnalysisReview.skipPaddingV)
                    .padding(.horizontal, AnalysisReview.skipPaddingH)
                    .overlay(
                        RoundedRectangle(cornerRadius: AnalysisReview.skipRadius, style: .continuous)
                            .stroke(AnalysisReview.skipBorderColor, lineWidth: AnalysisReview.cardBorder))
            }
            .buttonStyle(.plain)
            .padding(.top, AnalysisReview.skipMarginTop)
        }
        .padding(.vertical, AnalysisReview.loadingPaddingV)
        .padding(.horizontal, AnalysisReview.loadingPaddingH)
    }

    /// Pure, so no view body divides.
    private func fraction(_ completed: Int, _ total: Int) -> Double {
        total > 0 ? Double(completed) / Double(total) : 0
    }

    // MARK: - Results

    private func resultsBody(_ summary: ReviewSummary) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                scores(summary)
                if summary.graph.count > AnalysisLayout.singleLine {
                    EvalGraphView(points: summary.graph)
                        .frame(height: AnalysisGraph.height)
                        .background(AnalysisGraphStyle.wrapBackground)
                        .clipShape(RoundedRectangle(cornerRadius: AnalysisGraphStyle.wrapRadius,
                                                    style: .continuous))
                        .padding(.bottom, AnalysisReview.sectionGap)
                }
                tableHeader
                ForEach(summary.rows, id: \.key) { row in
                    countRow(row)
                }
            }
            .padding(.horizontal, AnalysisReview.contentPaddingH)
            .padding(.top, AnalysisReview.contentPaddingTop)
            .padding(.bottom, AnalysisReview.contentPaddingBottom)
        }
    }

    private func scores(_ summary: ReviewSummary) -> some View {
        HStack(spacing: 0) {
            scoreColumn("White", summary.whiteAccuracy)
            Rectangle()
                .fill(AnalysisReview.dividerColor)
                .frame(width: AnalysisReview.dividerWidth, height: AnalysisReview.dividerHeight)
                .padding(.horizontal, AnalysisReview.dividerMarginH)
            scoreColumn("Black", summary.blackAccuracy)
        }
        .padding(.bottom, AnalysisReview.sectionGap)
    }

    private func scoreColumn(_ name: String, _ pct: Double) -> some View {
        VStack(spacing: 0) {
            Text(name)
                .font(Theme.nunito(AnalysisReview.playerNameSize, .bold))
                .foregroundStyle(AnalysisReview.playerNameColor)
                .padding(.bottom, AnalysisReview.playerNameGap)
            Text(AnalysisTables.accuracyText(pct))
                .font(Theme.nunito(AnalysisReview.scoreSize, .extraBold))
                .foregroundStyle(AnalysisReview.accuracyColor(pct))
            Text("Accuracy")
                .font(Theme.nunito(AnalysisReview.scoreLabelSize, .semiBold))
                .tracking(AnalysisReview.scoreLabelTracking)
                .textCase(.uppercase)
                .foregroundStyle(AnalysisReview.scoreLabelColor)
                .padding(.top, AnalysisReview.scoreLabelGap)
        }
        .frame(maxWidth: .infinity)
    }

    private var tableHeader: some View {
        HStack(spacing: 0) {
            Text("White")
                .frame(width: AnalysisReview.sideColumnWidth)
            Spacer(minLength: 0)
            Text("Black")
                .frame(width: AnalysisReview.sideColumnWidth)
        }
        .font(Theme.nunito(AnalysisReview.sideLabelSize, .bold))
        .foregroundStyle(AnalysisReview.sideLabelColor)
        .padding(.bottom, AnalysisReview.tableHeaderPaddingBottom)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AnalysisReview.hairlineColor).frame(height: AnalysisReview.hairline)
        }
    }

    @ViewBuilder
    private func countRow(_ row: ReviewCountRow) -> some View {
        let style = AnalysisTables.classification(row.key)
        HStack(spacing: 0) {
            Text("\(row.white)")
                .font(Theme.nunito(AnalysisReview.countSize, .extraBold))
                .foregroundStyle(style?.color ?? AnalysisPalette.textPrimary)
                .frame(width: AnalysisReview.sideColumnWidth)
            HStack(spacing: AnalysisReview.centreGap) {
                Circle()
                    .fill(style?.color ?? AnalysisPalette.textPrimary)
                    .frame(width: AnalysisReview.dotSize, height: AnalysisReview.dotSize)
                // `good` has an empty symbol on purpose, so guard on the string, not the key.
                Text(AnalysisTables.classificationText(row.key))
                    .font(Theme.nunito(AnalysisReview.nameSize, .semiBold))
                    .foregroundStyle(AnalysisReview.nameColor)
            }
            .frame(maxWidth: .infinity)
            Text("\(row.black)")
                .font(Theme.nunito(AnalysisReview.countSize, .extraBold))
                .foregroundStyle(style?.color ?? AnalysisPalette.textPrimary)
                .frame(width: AnalysisReview.sideColumnWidth)
        }
        .padding(.vertical, AnalysisReview.rowPaddingV)
        .overlay(alignment: .bottom) {
            Rectangle().fill(AnalysisReview.rowRuleColor).frame(height: AnalysisReview.hairline)
        }
    }

    private var footer: some View {
        Button(action: onClose) {
            Text("Done")
                .font(Theme.nunito(AnalysisReview.buttonTextSize, .extraBold))
                .tracking(AnalysisReview.buttonTextTracking)
                .foregroundStyle(AnalysisPalette.onGold)
                .frame(maxWidth: .infinity)
                .padding(.vertical, AnalysisReview.buttonPaddingV)
                .background(AnalysisPalette.gold,
                            in: RoundedRectangle(cornerRadius: AnalysisReview.buttonRadius,
                                                 style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(AnalysisReview.footerPadding)
        .overlay(alignment: .top) {
            Rectangle().fill(AnalysisReview.hairlineColor).frame(height: AnalysisReview.hairline)
        }
    }

    /// The free tier's Game Review allowance is spent. Copy from `UpgradePrompt.tsx`, with the cap
    /// substituted rather than re-typed — and the reset note, because this limit *does* reset.
    private var cappedBody: some View {
        VStack(spacing: AnalysisReview.loadingGap) {
            Text(PaywallStrings.lockTitle)
                .font(Theme.nunito(AnalysisReview.loadingTextSize, .semiBold))
                .foregroundStyle(AnalysisPalette.gold)
            Text(PaywallStrings.fill(PaywallStrings.reviewCap,
                                     ["limit": String(Entitlement.reviewsPerDay)]))
                .font(Theme.nunito(AnalysisReview.hintSize))
                .foregroundStyle(AnalysisReview.hintColor)
                .multilineTextAlignment(.center)
            Text(PaywallStrings.resetsNote)
                .font(Theme.nunito(AnalysisReview.hintSize))
                .foregroundStyle(AnalysisReview.hintColor)
            if let onUpgrade {
                Button(action: onUpgrade) {
                    Text(PaywallStrings.lockCta)
                        .font(Theme.nunito(AnalysisReview.skipTextSize, .semiBold))
                        .foregroundStyle(PaywallPalette.ctaInk)
                        .padding(.vertical, AnalysisReview.skipPaddingV)
                        .padding(.horizontal, AnalysisReview.skipPaddingH)
                        .background(PaywallPalette.cta,
                                    in: RoundedRectangle(cornerRadius: AnalysisReview.skipRadius,
                                                         style: .continuous))
                }
                .buttonStyle(.plain)
                // Under the button, the terms of what it starts — the same sentence the paywall's
                // CTA and every other lock card carry.
                if let offerNote {
                    Text(offerNote)
                        .font(Theme.nunito(AnalysisReview.hintSize))
                        .foregroundStyle(AnalysisReview.hintColor)
                        .multilineTextAlignment(.center)
                }
            }
            Button(action: onClose) {
                Text("Close")
                    .font(Theme.nunito(AnalysisReview.skipTextSize, .semiBold))
                    .foregroundStyle(AnalysisReview.skipTextColor)
                    .padding(.vertical, AnalysisReview.skipPaddingV)
                    .padding(.horizontal, AnalysisReview.skipPaddingH)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, AnalysisReview.loadingPaddingV)
        .padding(.horizontal, AnalysisReview.loadingPaddingH)
    }

    private func message(_ title: String, _ hint: String) -> some View {
        VStack(spacing: AnalysisReview.loadingGap) {
            Text(title)
                .font(Theme.nunito(AnalysisReview.loadingTextSize, .semiBold))
                .foregroundStyle(AnalysisReview.loadingTextColor)
            Text(hint)
                .font(Theme.nunito(AnalysisReview.hintSize))
                .foregroundStyle(AnalysisReview.hintColor)
                .multilineTextAlignment(.center)
            Button(action: onClose) {
                Text("Close")
                    .font(Theme.nunito(AnalysisReview.skipTextSize, .semiBold))
                    .foregroundStyle(AnalysisReview.skipTextColor)
                    .padding(.vertical, AnalysisReview.skipPaddingV)
                    .padding(.horizontal, AnalysisReview.skipPaddingH)
                    .overlay(
                        RoundedRectangle(cornerRadius: AnalysisReview.skipRadius, style: .continuous)
                            .stroke(AnalysisReview.skipBorderColor, lineWidth: AnalysisReview.cardBorder))
            }
            .buttonStyle(.plain)
            .padding(.top, AnalysisReview.skipMarginTop)
        }
        .padding(.vertical, AnalysisReview.loadingPaddingV)
        .padding(.horizontal, AnalysisReview.loadingPaddingH)
    }
}

// MARK: - The eval graph

/// The eval curve with its two advantage fills (`components/EvalGraph.tsx`).
///
/// Both fills are closed polygons clipped at the midline — white above, black below — drawn under
/// the curve. x is **index-based**, not `moveIndex`-based, so an evaluation array with gaps still
/// spans the full width.
struct EvalGraphView: View {
    let points: [ReviewGraphPoint]

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let mid = size.height / 2
            let pts = points.enumerated().map { i, p in
                AnalysisGraph.point(cp: p.cp, mate: p.mate, index: i, count: points.count,
                                    width: size.width, height: size.height)
            }
            ZStack {
                AnalysisGraphStyle.background
                if pts.count > AnalysisLayout.singleLine {
                    fill(pts, mid: mid, width: size.width, above: true)
                        .fill(AnalysisGraphStyle.whiteFill)
                    fill(pts, mid: mid, width: size.width, above: false)
                        .fill(AnalysisGraphStyle.blackFill)
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: mid))
                        p.addLine(to: CGPoint(x: size.width, y: mid))
                    }
                    .stroke(AnalysisGraphStyle.midLine, lineWidth: AnalysisGraphStyle.midLineWidth)
                    Path { p in
                        p.move(to: pts[0])
                        for q in pts.dropFirst() { p.addLine(to: q) }
                    }
                    .stroke(AnalysisGraphStyle.curve,
                            style: StrokeStyle(lineWidth: AnalysisGraph.lineWidth, lineJoin: .round))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: AnalysisGraphStyle.backgroundRadius,
                                        style: .continuous))
        }
    }

    private func fill(_ pts: [CGPoint], mid: CGFloat, width: CGFloat, above: Bool) -> Path {
        Path { p in
            p.move(to: CGPoint(x: 0, y: mid))
            for q in pts {
                p.addLine(to: CGPoint(x: q.x, y: above ? min(q.y, mid) : max(q.y, mid)))
            }
            p.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: mid))
            p.closeSubpath()
        }
    }
}
