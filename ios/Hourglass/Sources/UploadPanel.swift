import SwiftUI

/// One upload for the upload panel: sending, done, failed or cancelled.
struct UploadItem: Identifiable, Equatable {
    let id: String
    let name: String
    let size: Int64
    var sent: Int64 = 0
    var speed: Int64 = 0 // bytes a second
    var state = "sending"
    var error: String?
    var at = Date()
}

/// Counts what an upload has sent and how fast (over the last three seconds,
/// none in the first one while buffers fill); reports four times a second.
final class UploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let report: (Int64, Int64) -> Void
    private var samples: [(Date, Int64)] = []
    private var shown = Date.distantPast
    private let started = Date()
    private let lock = NSLock()
    init(_ report: @escaping (Int64, Int64) -> Void) { self.report = report }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        lock.lock(); defer { lock.unlock() }
        let now = Date()
        samples.append((now, totalBytesSent))
        while samples.count > 2, now.timeIntervalSince(samples[0].0) > 3 { samples.removeFirst() }
        guard now.timeIntervalSince(shown) > 0.25 || totalBytesSent == totalBytesExpectedToSend else { return }
        shown = now
        let dt = now.timeIntervalSince(samples[0].0)
        let speed = dt > 0 && now.timeIntervalSince(started) > 1 ? Int64(Double(totalBytesSent - samples[0].1) / dt) : 0
        report(totalBytesSent, speed)
    }
}

// Uploads, like Google Drive's: a box at the bottom while files go up, one row
// per file with its name, a progress bar, how much has gone and how fast. A
// file can be cancelled while it goes; the box folds down to its header and
// closes once everything is done. Any upload shows here: the Drive's, a
// note's pictures, the assistant's attachments.
struct UploadPanel: View {
    @EnvironmentObject var store: Store
    @State private var folded = false
    @State private var closed = true

    var body: some View {
        let items = store.uploads
        let sending = items.filter { $0.state == "sending" }
        Group {
            if !closed && !items.isEmpty {
                VStack(spacing: 0) {
                    header(items, sending)
                    if !folded {
                        ScrollView {
                            VStack(spacing: 0) { ForEach(items) { u in row(u) } }
                        }
                        .frame(maxHeight: 260)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .background(H.surface)
                .overlay(Rectangle().stroke(H.border, lineWidth: 1))
                .padding(.horizontal, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: closed)
        .animation(.easeOut(duration: 0.2), value: folded)
        // A new upload opens the box again.
        .onChange(of: sending.count) { _, n in if n > 0 { closed = false } }
    }

    private func header(_ items: [UploadItem], _ sending: [UploadItem]) -> some View {
        let done = items.filter { $0.state == "done" }.count
        let bad = items.count - done - sending.count
        let title = !sending.isEmpty ? "Uploading \(sending.count) \(sending.count == 1 ? "file" : "files")"
            : [done > 0 ? "\(done) \(done == 1 ? "upload" : "uploads") complete" : nil, bad > 0 ? "\(bad) not uploaded" : nil].compactMap { $0 }.joined(separator: " · ")
        let all = max(1, sending.reduce(Int64(0)) { $0 + $1.size })
        return VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: sending.isEmpty ? "checkmark" : "icloud.and.arrow.up").font(.system(size: 15)).foregroundStyle(sending.isEmpty ? H.teal : H.accent)
                T(title, 14, bold: true, lines: 1)
                Spacer(minLength: 0)
                Button { folded.toggle() } label: {
                    Image(systemName: folded ? "chevron.up" : "chevron.down").font(.system(size: 14)).foregroundStyle(H.muted).frame(width: 40, height: 44)
                }
                if sending.isEmpty {
                    Button { closed = true; store.clearUploads() } label: {
                        Image(systemName: "xmark").font(.system(size: 14)).foregroundStyle(H.muted).frame(width: 40, height: 44)
                    }
                }
            }
            .padding(.leading, 14)
            .contentShape(Rectangle())
            .onTapGesture { folded.toggle() }
            // All the files still going: one bar for the header.
            if !sending.isEmpty { bar(Double(sending.reduce(Int64(0)) { $0 + $1.sent }) / Double(all), H.accent, height: 2) }
        }
        .background(H.surface2)
    }

    private func row(_ u: UploadItem) -> some View {
        let going = u.state == "sending"
        let picture = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic"].contains((u.name as NSString).pathExtension.lowercased())
        let part = u.state == "done" ? 1 : u.size > 0 ? min(1, Double(u.sent) / Double(u.size)) : 0
        let detail: String = {
            if going && u.size > 0 && u.sent >= u.size { return "\(fmtBytes(u.size))  ·  finishing…" }
            if going { return (u.size > 0 ? "\(fmtBytes(u.sent)) of \(fmtBytes(u.size))" : fmtBytes(u.sent)) + (u.speed > 0 ? "  ·  \(fmtBytes(u.speed))/s" : "") }
            if u.state == "done" { return "\(fmtBytes(max(u.size, u.sent)))  ·  uploaded" }
            if u.state == "cancelled" { return "Cancelled" }
            return u.error ?? "Not uploaded"
        }()
        return HStack(spacing: 12) {
            Image(systemName: picture ? "photo" : "doc").font(.system(size: 16)).foregroundStyle(H.muted).frame(width: 20)
            VStack(alignment: .leading, spacing: 6) {
                T(u.name, 13, lines: 1)
                bar(part, u.state == "done" ? H.teal : going ? H.accent : H.faint, height: 3)
                T(detail, 11, u.state == "failed" ? H.accent : H.muted, lines: 1)
            }
            Group {
                if going {
                    Button { store.cancelUpload(u.id) } label: {
                        Image(systemName: "xmark").font(.system(size: 13)).foregroundStyle(H.muted).frame(width: 40, height: 40)
                    }
                } else if u.state == "done" {
                    Image(systemName: "checkmark").font(.system(size: 14)).foregroundStyle(H.teal).frame(width: 40, height: 40)
                } else {
                    Color.clear.frame(width: 40, height: 40)
                }
            }
        }
        .padding(.leading, 14).padding(.trailing, 4).padding(.vertical, 8)
        .overlay(alignment: .top) { Rectangle().fill(H.border).frame(height: 1) }
    }

    // A thin progress bar that slides to its new length.
    private func bar(_ part: Double, _ color: Color, height: CGFloat) -> some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Rectangle().fill(H.surface2)
                Rectangle().fill(color).frame(width: g.size.width * part).animation(.easeOut(duration: 0.35), value: part)
            }
        }
        .frame(height: height)
    }
}
