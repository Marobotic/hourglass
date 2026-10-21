import QuickLook
import SwiftUI

struct FileVersion: Codable, Identifiable, Hashable {
    let id: String
    let at: Int64
    let size: Int64
    let by: String?
    let device: String?
    let restored_from: String?
}
struct FileVersions: Codable {
    struct Now: Codable { let at: Int64?; let size: Int64; let by: String?; let device: String?; let restored_from: String? }
    let current: Now
    let versions: [FileVersion]
    let text: Bool
    let picture: Bool
}
struct VersionDiff: Codable {
    struct Line: Codable, Hashable { let op: String; let text: String?; let count: Int? }
    let kind: String
    let before: Int64?
    let after: Int64?
    let tooBig: Bool?
    let added: Int?
    let removed: Int?
    let lines: [Line]?
}

// A Drive file's versions: every time its contents were replaced (an edit
// saved on a device, a restore) the copy before was kept, with who, which
// device and when. Each can be compared with now (line by line for text, side
// by side for pictures), opened or shared as a copy, or put back (what's there
// now is kept as a version too).
struct VersionsSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let file: DriveFile
    @State private var data: FileVersions?
    @State private var problem: String?
    @State private var open: String? // the version whose changes are showing
    @State private var looking: URL? // a version opened with Quick Look

    private func when(_ ms: Int64?) -> String { guard let ms, ms > 0 else { return "" }; return "\(Dates.short(Dates.dayOf(ms)))  \(Dates.clock(ms))" }
    private func who(_ device: String?, _ by: String?) -> String { [device, by].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ").ifEmpty("unknown device") }
    private func load() async {
        do { data = try await store.versions(file); problem = nil } catch { problem = error.localizedDescription }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    T("Each time it's saved, the copy before is kept (the last 20).", 12, H.muted)
                    if let problem { T(problem, 13, H.accent) }
                    if let d = data {
                        HStack(alignment: .top, spacing: 10) {
                            T("NOW", 11, H.teal, bold: true).padding(.horizontal, 6).padding(.vertical, 2).background(H.teal.opacity(0.18))
                            VStack(alignment: .leading, spacing: 2) {
                                T("\(when(d.current.at))   \(fmtBytes(d.current.size))", 13)
                                T(who(d.current.device, d.current.by) + (d.current.restored_from != nil ? "  ·  put back from an older version" : ""), 12, H.muted, lines: 1)
                            }
                        }
                        if d.versions.isEmpty { T("No older versions yet. When this file is edited and saved again, the copy before is kept here.", 13, H.faint) }
                        ForEach(d.versions) { v in row(v, d) }
                    } else if problem == nil {
                        T("Reading the versions…", 13, H.muted)
                    }
                }
                .padding(16)
            }
            .background(H.bg)
            .navigationTitle(file.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await load() }
            .quickLookPreview($looking)
        }
    }

    private func row(_ v: FileVersion, _ d: FileVersions) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            T("\(when(v.at))   \(fmtBytes(v.size))", 13)
            T(who(v.device, v.by) + (v.restored_from != nil ? "  ·  put back from an older version" : ""), 12, H.muted, lines: 1)
            HStack(spacing: 8) {
                HButton(open == v.id ? "Hide changes" : "What changed") { open = open == v.id ? nil : v.id }
                HButton("Open") { Task { do { looking = try await store.versionFile(file, v.id) } catch { problem = error.localizedDescription } } }
                HButton("Restore", primary: true) {
                    Task {
                        do { try await store.restoreVersion(file, v.id); open = nil; await load() } catch { problem = error.localizedDescription }
                    }
                }
            }
            if open == v.id {
                if d.picture { PicturesThenNow(file: file, vid: v.id) } else { Changes(file: file, vid: v.id) }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().stroke(H.border, lineWidth: 1))
    }
}

private extension String {
    func ifEmpty(_ other: String) -> String { isEmpty ? other : self }
}

private struct Changes: View {
    @EnvironmentObject var store: Store
    let file: DriveFile
    let vid: String
    @State private var diff: VersionDiff?
    @State private var failed: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let failed { T(failed, 12, H.accent) }
            else if let d = diff {
                if d.kind != "text" {
                    T("This kind of file can't be compared line by line. Then: \(fmtBytes(d.before ?? 0)), now: \(fmtBytes(d.after ?? 0)).", 12, H.muted)
                } else if d.tooBig == true {
                    T("Too many changes to show here (\(d.added ?? 0) lines in, \(d.removed ?? 0) out).", 12, H.muted)
                } else {
                    T("+\(d.added ?? 0) lines   −\(d.removed ?? 0) lines", 11, H.muted).padding(.bottom, 4)
                    ForEach(Array((d.lines ?? []).prefix(400).enumerated()), id: \.offset) { _, l in
                        Text(l.op == "skip" ? "⋯ \(l.count ?? 0) lines the same" : (l.op == "add" ? "+ " : l.op == "del" ? "− " : "  ") + (l.text ?? ""))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(l.op == "skip" ? H.faint : H.fg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                            .background(l.op == "add" ? H.teal.opacity(0.2) : l.op == "del" ? H.accent.opacity(0.2) : .clear)
                    }
                }
            } else {
                T("Comparing…", 12, H.muted)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(H.bg)
        .overlay(Rectangle().stroke(H.border, lineWidth: 1))
        .task(id: vid) {
            do { diff = try await store.versionDiff(file, vid) } catch { failed = error.localizedDescription }
        }
    }
}

private struct PicturesThenNow: View {
    @EnvironmentObject var store: Store
    let file: DriveFile
    let vid: String
    @State private var then: UIImage?
    @State private var now: UIImage?
    var body: some View {
        HStack(spacing: 8) {
            ForEach([("THEN", then), ("NOW", now)], id: \.0) { label, img in
                VStack(alignment: .leading, spacing: 4) {
                    T(label, 11, H.muted, bold: true)
                    ZStack {
                        H.bg
                        if let img { Image(uiImage: img).resizable().scaledToFit() } else { ProgressView().tint(H.accent) }
                    }
                    .frame(height: 160)
                }
            }
        }
        .task(id: vid) {
            if let u = try? await store.versionFile(file, vid) { then = UIImage(contentsOfFile: u.path) }
            if let u = try? await store.download(file) { now = UIImage(contentsOfFile: u.path) }
        }
    }
}
