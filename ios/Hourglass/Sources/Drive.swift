import SwiftUI
import QuickLook
import UniformTypeIdentifiers

// MARK: attendance

private func markTint(_ m: String?) -> Color { m == "attended" ? H.teal : m == "absent" ? H.accent : m == "off" ? H.muted : H.faint }
private func markBox(_ m: String?) -> String { m == "attended" ? "✓" : m == "absent" ? "✗" : m == "off" ? "–" : "" }

private struct MarkCell: View {
    let mark: String?
    var size: CGFloat = 34
    var body: some View {
        let tint = markTint(mark)
        ZStack {
            Rectangle().fill(mark != nil ? tint.opacity(0.25) : .clear)
            Rectangle().stroke(mark != nil ? tint : H.faint, lineWidth: 1)
            T(markBox(mark), size > 20 ? 17 : 12, tint, bold: true)
        }
        .frame(width: size, height: size)
    }
}

// Every subject with every session to the end of term: ✓ attended, ✗ absent,
// – off (no class), empty = not marked yet. Tap a box to change it; upcoming
// sessions are faded. Same page as the desktop's Attendance tab.
struct AttendanceView: View {
    @EnvironmentObject var store: Store

    var body: some View {
        let list = store.attendanceSessions()
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    ForEach([("attended", "attended"), ("absent", "absent"), ("off", "off"), ("", "not marked")], id: \.1) { m, label in
                        HStack(spacing: 6) { MarkCell(mark: m.isEmpty ? nil : m, size: 18); T(label, 12, H.muted) }
                    }
                }
                if list.isEmpty { T("No courses yet.", 14, H.faint) }
                ForEach(list, id: \.0.id) { course, sessions in CourseAttendance(course: course, sessions: sessions) }
            }
            .padding(18)
        }
        .background(H.bg)
    }
}

private struct CourseAttendance: View {
    @EnvironmentObject var store: Store
    let course: Course
    let sessions: [Store.Session]

    private func count(_ m: String?) -> Int { sessions.filter { $0.mark == m && (m != nil || !$0.future) }.count }

    var body: some View {
        let past = sessions.filter { !$0.future }.count
        let yes = count("attended"), no = count("absent"), off = count("off"), open = count(nil)
        let pct: Int? = yes + no > 0 ? Int((100.0 * Double(yes) / Double(yes + no)).rounded()) : nil
        Card(stripe: Color(hex: course.color)) {
            HStack {
                T(course.name, 17, bold: true, lines: 1)
                Spacer()
                T(pct.map { "\($0)%" } ?? "—", 20, (pct ?? 100) < 75 ? H.accent : H.teal, bold: true)
            }
            T("✓ \(yes)  ✗ \(no)  – \(off)" + (open > 0 ? "  · \(open) not marked" : "") + "  ·  \(past) so far, \(sessions.count - past) to come", 12, H.muted)
                .padding(.top, 4)
            if sessions.isEmpty { T("No sessions scheduled.", 13, H.faint).padding(.top, 10) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 40), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(sessions) { s in
                    VStack(spacing: 3) {
                        Button { store.cycleMark(s) } label: { MarkCell(mark: s.mark) }.buttonStyle(.plain)
                        T(Dates.short(s.date).split(separator: " ").dropFirst().joined(separator: " "), 10, H.faint)
                    }
                    .opacity(s.future && s.mark == nil ? 0.35 : 1)
                }
            }
            .padding(.top, 10)
            if open > 0 {
                HButton("Mark the \(open) unmarked as attended") {
                    for s in sessions where s.mark == nil && !s.future { store.setMark(s.occ, "attended") }
                }
                .padding(.top, 10)
            }
        }
    }
}

// MARK: drive

// Downloads a Drive file and shows it with Quick Look: pictures, video, PDFs
// and Office files preview here, with Share to open it in its own app.
@MainActor
final class FileOpener: ObservableObject {
    @Published var url: URL?
    @Published var busy: String?
    @Published var error: String?
    func open(_ f: DriveFile, _ store: Store) {
        busy = "Opening \(f.name)…"
        Task {
            do { url = try await store.download(f) } catch { self.error = error.localizedDescription }
            busy = nil
        }
    }
}

// A file sent to another app (the share sheet): Messages, Mail, WhatsApp…
struct SendItem: Identifiable { let id = UUID(); let url: URL }
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ c: UIActivityViewController, context: Context) {}
}

// What is being dragged in the Drive: "file:<id>" or "folder:<id>".
private func dragKey(_ table: String, _ id: String) -> String { "\(table):\(id)" }

// The Drive: every course has a folder for the files put there; then your own
// folders and files. Bytes live on the server; the rows sync to every device.
// Hold a file or folder and drag it onto a folder (or a course, for a file) to
// move it there; "Move to…" in its menu does the same. "Share link…" makes a
// link anyone can open; "Send file…" sends the file itself to another app.
struct DriveView: View {
    @EnvironmentObject var store: Store
    @StateObject private var opener = FileOpener()
    @State private var folderId: String?
    @State private var courseId: String?
    @State private var usage: [String: Int64]?
    @State private var status: String?
    @State private var importing = false
    @State private var naming: (String, (String) -> Void)?
    @State private var nameText = ""
    @State private var deleting: (String, () -> Void)?
    @State private var saving: URL? // "Download…": a copy waiting for the Files picker
    @State private var sending: SendItem?
    @State private var sharing: ShareTarget?
    @State private var shares: [String: [String: Any]] = [:]

    private func loadShares() {
        Task {
            guard let list = try? await store.shares() else { return }
            var m: [String: [String: Any]] = [:]
            for s in list { if let k = (s["file_id"] as? String) ?? (s["folder_id"] as? String) { m[k] = s } }
            shares = m
        }
    }

    // A dragged "file:<id>" / "folder:<id>" into a folder (nil = the top) or a course.
    private func drop(_ keys: [String], into folder: String?, course: String? = nil) -> Bool {
        var moved = false
        for k in keys {
            let p = k.split(separator: ":", maxSplits: 1).map(String.init)
            guard p.count == 2 else { continue }
            if p[0] == "file" {
                if let course { store.setFileCourse(p[1], course) } else { store.setFileFolder(p[1], folder) }
                moved = true
            } else if p[0] == "folder", course == nil {
                if p[1] == folder { continue }
                if store.moveFolder(p[1], into: folder) { moved = true } else { status = "A folder can't go inside itself." }
            }
        }
        return moved
    }

    private func send(_ f: DriveFile) {
        status = "Getting \(f.name) ready…"
        Task {
            do { sending = SendItem(url: try await store.download(f)); status = nil }
            catch { status = "Could not send it: \(error.localizedDescription)" }
        }
    }

    // "Move to…": every folder by its path, and the top.
    @ViewBuilder private func moveMenu(_ table: String, _ id: String, here: String?) -> some View {
        let byId = Dictionary(uniqueKeysWithValues: store.folders.map { ($0.id, $0) })
        let pathOf: (Folder) -> String = { f in
            var names: [String] = []; var x: Folder? = f; var n = 0
            while let cur = x, n < 20 { names.insert(cur.name, at: 0); x = cur.parent_id.flatMap { byId[$0] }; n += 1 }
            return names.joined(separator: " / ")
        }
        let inside: (Folder) -> Bool = { f in
            var x: Folder? = f; var n = 0
            while let cur = x, n < 20 { if cur.id == id { return true }; x = cur.parent_id.flatMap { byId[$0] }; n += 1 }
            return false
        }
        Menu("Move to…") {
            Button("Top of the Drive") { _ = drop([dragKey(table, id)], into: nil) }.disabled(here == nil)
            ForEach(store.folders.filter { !(table == "folder" && inside($0)) }.map { ($0.id, pathOf($0)) }.sorted { $0.1.lowercased() < $1.1.lowercased() }, id: \.0) { fid, path in
                Button(path) { _ = drop([dragKey(table, id)], into: fid) }.disabled(here == fid)
            }
        }
    }

    var body: some View {
        let view = store.drive(folderId, course: courseId)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                if folderId != nil || courseId != nil {
                    // Drop on the back arrow: one folder up.
                    Button { up(view) } label: { Image(systemName: "chevron.left").foregroundStyle(H.fg).frame(width: 40, height: 40) }
                        .dropDestination(for: String.self) { keys, _ in courseId == nil && drop(keys, into: view.path.dropLast().last?.id) }
                }
                T(view.course?.name ?? view.folder?.name ?? "Drive", 22, bold: true, lines: 1)
                Spacer()
                if courseId == nil {
                    Button { ask("New folder") { n in if !n.isEmpty { store.addFolder(n, parent: folderId) } } } label: {
                        Image(systemName: "folder.badge.plus").foregroundStyle(H.muted).frame(width: 40, height: 40)
                    }
                }
                Button { importing = true } label: { Image(systemName: "square.and.arrow.up").foregroundStyle(H.muted).frame(width: 40, height: 40) }
            }
            .padding(.horizontal, 12)
            if let u = usage, let total = u["total"], total > 0 {
                VStack(alignment: .leading, spacing: 4) {
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(H.surface2)
                            Rectangle().fill(H.teal).frame(width: g.size.width * CGFloat(min(1, Double(u["used"] ?? 0) / Double(total))))
                        }
                    }
                    .frame(height: 4)
                    T("\(fmtBytes(u["mine"] ?? 0)) yours  ·  \(fmtBytes(u["free"] ?? 0)) free of \(fmtBytes(total))", 11, H.muted)
                }
                .padding(.horizontal, 18)
            }
            if let s = status ?? opener.busy { T(s, 12, H.gold).padding(.horizontal, 18) }
            List {
                if view.courses.isEmpty && view.folders.isEmpty && view.files.isEmpty {
                    T(courseId != nil ? "Nothing in this course's folder yet. Upload files here, or attach them to its notes." : "Empty. Upload files or make a folder.", 13, H.faint)
                        .listRowBackground(H.bg)
                }
                ForEach(view.courses, id: \.0.id) { c, n in
                    row("graduationcap", c.name, "\(n) file\(n == 1 ? "" : "s")", Color(hex: c.color)) { courseId = c.id }
                        .dropDestination(for: String.self) { keys, _ in drop(keys.filter { $0.hasPrefix("file:") }, into: nil, course: c.id) }
                }
                ForEach(view.folders, id: \.0.id) { d, n in
                    row("folder", d.name, "\(n) item\(n == 1 ? "" : "s")", H.gold, shared: shares[d.id] != nil) { folderId = d.id }
                        .draggable(dragKey("folder", d.id))
                        .dropDestination(for: String.self) { keys, _ in drop(keys, into: d.id) }
                        .contextMenu {
                            Button(shares[d.id] != nil ? "Shared · link…" : "Share link…") { sharing = ShareTarget(table: "folders", id: d.id, name: d.name) }
                            moveMenu("folder", d.id, here: d.parent_id)
                            Button("Rename") { ask("Rename folder", d.name) { s in if !s.isEmpty { var d = d; d.name = s; store.save(d) } } }
                            Button("Delete", role: .destructive) { deleting = ("\"\(d.name)\" and everything in it will be removed from every device.", { store.removeFolder(d.id) }) }
                        }
                }
                ForEach(view.files) { f in
                    row(f.mime.hasPrefix("image/") ? "photo" : f.mime.hasPrefix("video/") ? "film" : "doc", f.name, fmtBytes(f.size), H.muted, shared: shares[f.id] != nil) { opener.open(f, store) }
                        .draggable(dragKey("file", f.id))
                        .contextMenu {
                            Button("Open") { opener.open(f, store) }
                            Button("Send file…") { send(f) }
                            Button(shares[f.id] != nil ? "Shared · link…" : "Share link…") { sharing = ShareTarget(table: "files", id: f.id, name: f.name) }
                            moveMenu("file", f.id, here: f.course_id == nil ? f.folder_id : "course")
                            Button("Download…") { download(f) }
                            Button("Rename") { ask("Rename file", f.name) { s in if !s.isEmpty { var f = f; f.name = s; store.save(f) } } }
                            Menu("Put in a course") {
                                ForEach(store.courses) { c in Button(c.name) { store.setFileCourse(f.id, c.id) } }
                            }
                            if f.course_id != nil || f.folder_id != nil { Button("Move to the top") { store.setFileFolder(f.id, nil) } }
                            Button("Delete", role: .destructive) { deleting = ("\"\(f.name)\" will be removed from every device.", { store.removeFile(f.id) }) }
                        }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
        .background(H.bg)
        // The server's disk barely moves: read it every minute (and the links with it).
        .task { while !Task.isCancelled { loadShares(); usage = await store.driveUsage(); try? await Task.sleep(nanoseconds: 60_000_000_000) } }
        .sheet(item: $sending) { item in ActivityView(items: [item.url]) }
        .sheet(item: $sharing, onDismiss: loadShares) { t in
            ShareSheet(target: t, existing: shares[t.id], onSendFile: { if let f = store.file(t.id) { sharing = nil; send(f) } }).environmentObject(store)
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r, !urls.isEmpty else { return }
            upload(urls)
        }
        .quickLookPreview($opener.url)
        .fileMover(isPresented: Binding(get: { saving != nil }, set: { if !$0 { saving = nil } }), file: saving) { r in
            switch r {
            case .success(let to): status = "Saved \(to.lastPathComponent)"
            case .failure(let e): status = "Download failed: \(e.localizedDescription)"
            }
        }
        .alert(naming?.0 ?? "", isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
            TextField("Name", text: $nameText)
            Button("Save") { naming?.1(nameText.trimmingCharacters(in: .whitespaces)); naming = nil }
            Button("Cancel", role: .cancel) { naming = nil }
        }
        .alert("Delete?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete", role: .destructive) { deleting?.1(); deleting = nil }
            Button("Cancel", role: .cancel) { deleting = nil }
        } message: { Text(deleting?.0 ?? "") }
        .alert("Could not open it", isPresented: Binding(get: { opener.error != nil }, set: { if !$0 { opener.error = nil } })) {
            Button("OK") { opener.error = nil }
        } message: { Text(opener.error ?? "") }
    }

    private func up(_ view: Store.DriveView) {
        if courseId != nil { courseId = nil } else { folderId = view.path.dropLast().last?.id }
    }

    private func ask(_ title: String, _ initial: String = "", _ done: @escaping (String) -> Void) {
        nameText = initial
        naming = (title, done)
    }

    // "Download…": fetch the file (or use this phone's copy), then let the
    // Files picker put a copy wherever the user chooses.
    private func download(_ f: DriveFile) {
        status = "Downloading \(f.name)…"
        Task {
            do {
                let src = try await store.download(f)
                let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let copy = dir.appendingPathComponent(f.name.isEmpty ? "file" : f.name)
                try FileManager.default.copyItem(at: src, to: copy)
                status = nil
                saving = copy
            } catch {
                status = "Download failed: \(error.localizedDescription)"
            }
        }
    }

    private func upload(_ urls: [URL]) {
        status = urls.count > 1 ? "Uploading \(urls.count) files…" : "Uploading…"
        let folder = folderId, course = courseId
        Task {
            var failed: String?
            for u in urls {
                let scoped = u.startAccessingSecurityScopedResource()
                defer { if scoped { u.stopAccessingSecurityScopedResource() } }
                do { _ = try await store.upload(u, folder: folder, course: course) } catch { failed = error.localizedDescription }
            }
            status = failed.map { "Upload failed: \($0)" }
        }
    }

    private func row(_ icon: String, _ name: String, _ detail: String, _ tint: Color, shared: Bool = false, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 20)).foregroundStyle(tint).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) { T(name, 15, lines: 1); T(detail, 12, H.muted) }
                Spacer(minLength: 0)
                if shared { Image(systemName: "link").foregroundStyle(H.teal) }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(H.bg)
    }
}

struct ShareTarget: Identifiable { let table: String; let id: String; let name: String }

// "Share link…": anyone with the link can view (or view and download) in a
// browser, no account needed. Same link when the access changes; "Stop
// sharing" turns it off.
struct ShareSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let target: ShareTarget
    let existing: [String: Any]?
    let onSendFile: () -> Void
    @State private var link: [String: Any]?
    @State private var access = "view"
    @State private var days = 0
    @State private var note: String?
    @State private var busy = false
    @State private var started = false

    private var url: String { link?["url"] as? String ?? "" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Anyone with the link can open it in a browser, no account needed.").font(.system(size: 13)).foregroundStyle(H.muted)
                }
                Section("Who can see it") {
                    Picker("Access", selection: $access) {
                        Text("Anyone with the link can view").tag("view")
                        Text("…can view and download").tag("download")
                    }.pickerStyle(.inline).labelsHidden()
                }
                Section("The link stops working") {
                    Picker("Ends", selection: $days) {
                        Text("Never").tag(0); Text("After 1 day").tag(1); Text("After 7 days").tag(7); Text("After 30 days").tag(30)
                    }
                }
                if link != nil {
                    Section("The link") {
                        Text(url).font(H.mono(13)).textSelection(.enabled)
                        Button("Copy") { UIPasteboard.general.string = url; note = "Link copied." }
                        if let u = URL(string: url) { ShareLink("Share link", item: u) }
                        Button("Stop sharing", role: .destructive) {
                            guard let t = link?["token"] as? String else { return }
                            Task {
                                do { try await store.unshare(t); link = nil; note = "Sharing stopped: the link no longer opens anything." }
                                catch { note = error.localizedDescription }
                            }
                        }
                    }
                }
                if let note { Section { Text(note).foregroundStyle(H.accent) } }
                if target.table == "files" { Section { Button("Send the file itself…") { onSendFile() } } }
            }
            .navigationTitle("Share \(target.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(link != nil ? "Save" : "Create link") {
                        busy = true
                        Task {
                            do {
                                let s = try await store.share(file: target.table == "files" ? target.id : nil, folder: target.table == "folders" ? target.id : nil, access: access, days: days)
                                link = s
                                UIPasteboard.general.string = s["url"] as? String
                                note = "Link copied."
                            } catch { note = error.localizedDescription }
                            busy = false
                        }
                    }.disabled(busy)
                }
            }
            .onAppear {
                guard !started else { return }
                started = true
                link = existing
                access = existing?["access"] as? String ?? "view"
            }
        }
        .presentationDetents([.medium, .large])
    }
}
