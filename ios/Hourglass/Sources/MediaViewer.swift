import AVKit
import ImageIO
import SwiftUI

// Pictures and videos from the Drive, full screen: swipe for the next one in
// the same list. A picture is downloaded once (kept on the phone); a video
// plays while it streams from the server. "Open in app" shows it with Quick
// Look, whose Share button sends it anywhere.
struct MediaViewer: View {
    @EnvironmentObject var store: Store
    let set: MediaSet
    let opener: FileOpener
    @Environment(\.dismiss) private var dismiss
    @State private var index = 0

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(set.files.enumerated()), id: \.element.id) { i, f in
                    Group {
                        if f.mime.hasPrefix("video/") { VideoPage(file: f, playing: index == i) } else { PicturePage(file: f) }
                    }
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            if let f = set.files[safe: index] {
                HStack(spacing: 4) {
                    VStack(alignment: .leading, spacing: 2) {
                        T(f.name, 14, .white, lines: 1)
                        T(fmtBytes(f.size) + (set.files.count > 1 ? "  ·  \(index + 1) of \(set.files.count)" : ""), 11, .white.opacity(0.7))
                    }
                    Spacer(minLength: 0)
                    Button { dismiss(); opener.quickLook(f, store) } label: {
                        Image(systemName: "square.and.arrow.up").foregroundStyle(.white).frame(width: 44, height: 44)
                    }
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").foregroundStyle(.white).frame(width: 44, height: 44)
                    }
                }
                .padding(.leading, 16).padding(.trailing, 4)
                .background(Color.black.opacity(0.55))
            }
        }
        .onAppear { index = set.start }
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

private struct PicturePage: View {
    @EnvironmentObject var store: Store
    let file: DriveFile
    @State private var image: UIImage?
    @State private var failed: String?
    var body: some View {
        ZStack {
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if let failed { T(failed, 13, .white.opacity(0.7)).padding(24) }
            else { ProgressView().tint(H.accent) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: file.id) {
            do {
                let url = try await store.download(file)
                image = downsample(url, to: 2048)
                if image == nil { failed = "Could not show this picture." }
            } catch { failed = error.localizedDescription }
        }
    }
    // A big photo decoded at screen size, not at full size.
    private func downsample(_ url: URL, to side: Int) -> UIImage? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: side] as CFDictionary)
        else { return nil }
        return UIImage(cgImage: cg)
    }
}

private struct VideoPage: View {
    @EnvironmentObject var store: Store
    let file: DriveFile
    let playing: Bool
    @State private var player: AVPlayer?
    var body: some View {
        ZStack {
            if let player { VideoPlayer(player: player) } else { ProgressView().tint(H.accent) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            guard player == nil, let url = store.stream(file) else { return }
            let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": store.authHeaders])
            player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            if playing { player?.play() }
        }
        // Only the one on screen plays.
        .onChange(of: playing) { _, now in if now { player?.play() } else { player?.pause() } }
        .onDisappear { player?.pause() }
    }
}
