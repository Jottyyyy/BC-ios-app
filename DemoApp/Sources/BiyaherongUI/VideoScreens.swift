import SwiftUI
import AVKit
import BiyaherongCoachCore

// Tutorial Videos — the catalogue and the player (spec BOOK TWO).
//
// Every number and colour is a constant from the GENERATED `VideoMetrics.swift`; there is no numeric
// literal or arithmetic in any body below, which is what lets the metrics checks see the layout with
// no renderer. Twin of `web-demo/js/videos.js`.
//
// The screen has FIVE states and the order they are tested in is the product decision:
//
//     not premium  ->  paywall            (an entitlement, and it is knowable offline)
//     not configured -> "not published"   (we have nowhere to look; not the user's connection)
//     offline      ->  "Online Feature"
//     loading / failed / empty / list
//
// Premium is tested FIRST, deliberately. The entitlement is decided on-device by StoreKit and is
// knowable with the radio off, so it is the answer we are certain of — and telling somebody to find
// wifi for a screen they could not open with wifi would be a wasted trip.

// MARK: - Root

struct VideoLibraryScreen: View {
    @ObservedObject var premium: PremiumStore
    let onExit: () -> Void
    let onPaywall: () -> Void

    @State private var videos: [VideoLibrary.Video] = []
    @State private var failure: ContentClient.Failure?
    @State private var loading = false
    @State private var loaded = false
    @State private var playing: VideoLibrary.Video?
    /// Held so leaving the screen tears the fetch down — a user who backs out is not still pulling.
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            VideoHeader(title: VideoStrings.title, onBack: onExit)
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(VideoList.containerBackgroundColor.ignoresSafeArea())
        .task { await loadIfNeeded() }
        .onDisappear { task?.cancel(); task = nil }
        .fullScreenCover(item: $playing) { video in
            VideoPlayerScreen(video: video, onExit: { playing = nil })
        }
    }

    @ViewBuilder
    private var content: some View {
        if !premium.isPremium {
            VideoPaywall(onSubscribe: onPaywall)
        } else if !ContentClient.isConfigured {
            VideoNotice(glyph: VideoStrings.emptyGlyph,
                        title: VideoStrings.notConfiguredTitle,
                        message: VideoStrings.notConfiguredBody,
                        retry: nil)
        } else if let failure, failure.isOffline {
            VideoNotice(glyph: VideoStrings.onlineGlyph,
                        title: VideoStrings.onlineTitle,
                        message: VideoStrings.offlineBody,
                        sub: VideoStrings.offlineSub,
                        retry: VideoStrings.retry) { retry() }
        } else if failure != nil {
            VideoNotice(glyph: VideoStrings.emptyGlyph,
                        title: VideoStrings.errorTitle,
                        message: VideoStrings.errorBody,
                        retry: VideoStrings.retry) { retry() }
        } else if loading {
            VideoLoading()
        } else if videos.isEmpty {
            VideoNotice(glyph: VideoStrings.emptyGlyph,
                        title: VideoStrings.emptyTitle,
                        message: VideoStrings.emptySub,
                        retry: nil)
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // The standing note. Shown even on the happy path: every other screen in this app
                // works in Airplane Mode, so one that quietly needs a connection is a surprise, and
                // saying so once here is cheaper than the user finding out on a plane.
                Text(VideoStrings.onlineNote)
                    .font(Theme.nunito(VideoList.loadingTextFontSize))
                    .foregroundStyle(VideoList.loadingTextColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, VideoList.sectionHeaderMarginBottom)

                ForEach(VideoLibrary.sections(videos)) { section in
                    VideoSectionHeader(section: section)
                    ForEach(section.videos) { video in
                        Button { playing = video } label: { VideoCard(video: video) }
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, VideoList.listContentPaddingHorizontal)
            .padding(.top, VideoList.listContentPaddingTop)
            .padding(.bottom, VideoList.listContentPaddingBottom)
        }
    }

    private func retry() {
        loaded = false
        failure = nil
        task?.cancel()
        task = Task { await loadIfNeeded() }
    }

    /// Fetch once per visit. The catalogue changes when somebody publishes a new manifest, not while
    /// the user is looking at it, so re-fetching on every redraw would be a request per keystroke of
    /// SwiftUI invalidation.
    private func loadIfNeeded() async {
        guard premium.isPremium, ContentClient.isConfigured, !loaded, !loading else { return }
        loading = true
        defer { loading = false; loaded = true }
        do {
            videos = try await ContentClient.videos()
            failure = nil
        } catch is CancellationError {
            // The user left. Nothing to say and nowhere to say it.
            loaded = false
        } catch let f as ContentClient.Failure {
            failure = f
        } catch {
            failure = .offline
        }
    }
}

// MARK: - Header

struct VideoHeader: View {
    let title: String
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // The one shared back vector — never a `←` character, which Nunito does not have.
            NavIconButton(.back, size: VideoList.backIconFontSize,
                          tint: VideoList.backIconColor, action: onBack)
                .frame(width: VideoList.backButtonWidth, height: VideoList.backButtonHeight)
            Text(title)
                .font(Theme.nunito(VideoList.headerTitleFontSize, .bold))
                .foregroundStyle(VideoList.headerTitleColor)
                .frame(maxWidth: .infinity)
            HomeLogo(size: VideoList.backButtonWidth)
        }
        .padding(.horizontal, VideoList.headerPaddingHorizontal)
        .padding(.vertical, VideoList.headerPaddingVertical)
    }
}

// MARK: - States

struct VideoLoading: View {
    var body: some View {
        VStack(spacing: 0) {
            ProgressView()
            Text(VideoStrings.loading)
                .font(Theme.nunito(VideoList.loadingTextFontSize))
                .foregroundStyle(VideoList.loadingTextColor)
                .padding(.top, VideoList.loadingTextMarginTop)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The empty, offline, failed and unpublished states — one shape, four sets of words.
///
/// Written once because they differ only in copy: four near-identical views is how one of them ends
/// up with a different font size and nobody notices for a release.
struct VideoNotice: View {
    let glyph: String
    let title: String
    /// Not called `body`: that is `View`'s own requirement, and a stored property of the same name
    /// shadows it into a compile error that names the wrong line.
    let message: String
    var sub: String?
    var retry: String?
    var onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            Text(glyph)
                .font(.system(size: VideoList.emptyIconFontSize))
            Text(title)
                .font(Theme.nunito(VideoList.emptyTitleFontSize, .bold))
                .foregroundStyle(VideoList.emptyTitleColor)
                .padding(.top, VideoList.emptyTitleMarginBottom)
            Text(message)
                .font(Theme.nunito(VideoList.emptySubtitleFontSize))
                .foregroundStyle(VideoList.emptySubtitleColor)
                .multilineTextAlignment(.center)
                .padding(.top, VideoList.emptyTitleMarginBottom)
            if let sub {
                Text(sub)
                    .font(Theme.nunito(VideoList.emptySubtitleFontSize))
                    .foregroundStyle(VideoList.emptySubtitleColor)
                    .multilineTextAlignment(.center)
            }
            if let retry, let onRetry {
                Button(action: onRetry) {
                    Text(retry)
                        .font(Theme.nunito(VideoList.subscribeButtonTextFontSize, .bold))
                        .foregroundStyle(VideoList.subscribeButtonTextColor)
                        .padding(.horizontal, VideoList.subscribeButtonPaddingHorizontal)
                        .padding(.vertical, VideoList.subscribeButtonPaddingVertical)
                        .background(VideoList.subscribeButtonBackgroundColor,
                                    in: RoundedRectangle(cornerRadius: VideoList.subscribeButtonBorderRadius))
                }
                .buttonStyle(.plain)
                .padding(.top, VideoList.paywallSubtextMarginBottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, VideoList.paywallContainerPaddingHorizontal)
    }
}

/// The RN paywall, verbatim (`index.tsx:203-232`).
struct VideoPaywall: View {
    let onSubscribe: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text(VideoStrings.lockGlyph)
                .font(.system(size: VideoList.paywallIconFontSize))
                .padding(.bottom, VideoList.paywallIconMarginBottom)
            Text(VideoStrings.paywallLabel)
                .font(Theme.nunito(VideoList.paywallLabelFontSize, .bold))
                .foregroundStyle(VideoList.paywallLabelColor)
                .padding(.bottom, VideoList.paywallLabelMarginBottom)
            Text(VideoStrings.paywallMessage)
                .font(Theme.nunito(VideoList.paywallMessageFontSize))
                .foregroundStyle(VideoList.paywallMessageColor)
                .multilineTextAlignment(.center)
                .padding(.bottom, VideoList.paywallMessageMarginBottom)
            Text(VideoStrings.paywallSubtext)
                .font(Theme.nunito(VideoList.paywallSubtextFontSize))
                .foregroundStyle(VideoList.paywallSubtextColor)
                .multilineTextAlignment(.center)
                .padding(.bottom, VideoList.paywallSubtextMarginBottom)
            Button(action: onSubscribe) {
                Text(VideoStrings.subscribe)
                    .font(Theme.nunito(VideoList.subscribeButtonTextFontSize, .bold))
                    .foregroundStyle(VideoList.subscribeButtonTextColor)
                    .padding(.horizontal, VideoList.subscribeButtonPaddingHorizontal)
                    .padding(.vertical, VideoList.subscribeButtonPaddingVertical)
                    .background(VideoList.subscribeButtonBackgroundColor,
                                in: RoundedRectangle(cornerRadius: VideoList.subscribeButtonBorderRadius))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, VideoList.paywallContainerPaddingHorizontal)
    }
}

// MARK: - The list

struct VideoSectionHeader: View {
    let section: VideoLibrary.Section

    var body: some View {
        let meta = VideoCategoryStyle.meta(section.title)
        return HStack(spacing: 0) {
            Rectangle()
                .fill(meta.accent)
                .frame(width: VideoList.sectionAccentWidth, height: VideoList.sectionAccentHeight)
                .clipShape(RoundedRectangle(cornerRadius: VideoList.sectionAccentBorderRadius))
                .padding(.trailing, VideoList.sectionHeaderGap)
            Text(meta.glyph + " " + section.title)
                .font(Theme.nunito(VideoList.sectionTitleFontSize, .bold))
                // The StyleSheet gives this no colour: `index.tsx:176` sets it inline from the
                // section accent. Reading it from `meta` is that inline style, not an invention.
                .foregroundStyle(meta.accent)
            Spacer()
            Text(VideoStrings.count(section.videos.count))
                .font(Theme.nunito(VideoList.sectionCountFontSize))
                .foregroundStyle(VideoList.sectionCountColor)
        }
        .padding(.top, VideoList.sectionHeaderMarginTop)
        .padding(.bottom, VideoList.sectionHeaderMarginBottom)
    }
}

struct VideoCard: View {
    let video: VideoLibrary.Video

    var body: some View {
        let meta = VideoCategoryStyle.meta(video.category)
        return HStack(spacing: 0) {
            thumbnail
            VStack(alignment: .leading, spacing: 0) {
                Text(meta.glyph + " " + video.category)
                    .font(Theme.nunito(VideoList.catChipTextFontSize, .bold))
                    .foregroundStyle(meta.accent)
                    .padding(.horizontal, VideoList.catChipPaddingHorizontal)
                    .padding(.vertical, VideoList.catChipPaddingVertical)
                    .background(meta.chipBackground,
                                in: RoundedRectangle(cornerRadius: VideoList.catChipBorderRadius))
                    .padding(.bottom, VideoList.cardInfoGap)
                Text(video.title)
                    .font(Theme.nunito(VideoList.cardTitleFontSize, .bold))
                    .foregroundStyle(VideoList.cardTitleColor)
                    .lineLimit(2)
                if let description = video.description {
                    Text(description)
                        .font(Theme.nunito(VideoList.cardDescFontSize))
                        .foregroundStyle(VideoList.cardDescColor)
                        .lineLimit(2)
                        .padding(.top, VideoList.cardInfoGap)
                }
                Spacer(minLength: .zero)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(VideoList.cardInfoPadding)
        }
        .frame(height: VideoThumb.height)
        .background(VideoList.videoCardBackgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: VideoList.videoCardBorderRadius))
        .overlay(RoundedRectangle(cornerRadius: VideoList.videoCardBorderRadius)
            .strokeBorder(VideoList.videoCardBorderColor,
                          lineWidth: VideoList.videoCardBorderWidth))
        .padding(.bottom, VideoList.videoCardMarginBottom)
    }

    /// The thumbnail, with the play badge over it.
    ///
    /// `AsyncImage` rather than a bundled asset: these live on the content bucket beside the videos.
    /// It is NOT a second networked file — `URLSession` appears nowhere here, and the allow-list in
    /// `replay_opening_tree.js` §12 is about who opens a connection in code, not about SwiftUI
    /// loading an image. A missing thumbnail falls back to the category colour rather than to a
    /// broken-image box.
    private var thumbnail: some View {
        ZStack {
            if let raw = video.thumbnailURL, let url = URL(string: raw) {
                AsyncImage(url: url) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    VideoCategoryStyle.meta(video.category).chipBackground
                }
            } else {
                VideoCategoryStyle.meta(video.category).chipBackground
            }
            Text(VideoStrings.playGlyph)
                .font(.system(size: VideoList.playBtnIconFontSize))
                .foregroundStyle(VideoList.playBtnIconColor)
                .frame(width: VideoList.playBtnWidth, height: VideoList.playBtnHeight)
                .background(VideoList.playBtnBackgroundColor, in: Circle())
        }
        .frame(width: VideoThumb.width, height: VideoThumb.height)
        .clipped()
    }
}

// MARK: - The player

/// A system player.
///
/// **DEVIATION, deliberate.** The RN screen builds its own transport — 21 style keys of scrubber,
/// timestamps, a hide timer and a seek strip — because `expo-av` gave it no controls worth using.
/// `AVPlayerViewController` already has all of that, plus AirPlay, Picture in Picture, the lock
/// screen, background audio and every accessibility affordance the system knows about. Rebuilding
/// it would be a week of work to arrive somewhere worse, and `PORTING_NOTES.md` records it.
struct VideoPlayerScreen: View {
    let video: VideoLibrary.Video
    let onExit: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VideoHeader(title: video.title, onBack: onExit)
            if let url = URL(string: video.videoURL) {
                VideoPlayer(player: AVPlayer(url: url))
            } else {
                // `VideoLibrary.parse` drops a row with no URL, so this is unreachable from a
                // manifest — but a `String` that is not a `URL` is not the same check, and a blank
                // screen with no explanation is the worst possible answer.
                VideoNotice(glyph: VideoStrings.emptyGlyph,
                            title: VideoStrings.errorTitle,
                            message: VideoStrings.errorBody,
                            retry: nil)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(VideoPlay.rootBackgroundColor.ignoresSafeArea())
    }
}
