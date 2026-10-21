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

// Pictures and videos open full screen and swipe to the others in the same
// list (among); anything else is downloaded and shown with Quick Look (PDFs,
// Office files...), with Share to open it in its own app.
struct MediaSet: Identifiable { let id = UUID(); let files: [DriveFile]; let start: Int }

@MainActor
final class FileOpener: ObservableObject {
    @Published var url: URL?
    @Published var busy: String?
    @Published var error: String?
    @Published var viewing: MediaSet?
    static func isMedia(_ f: DriveFile) -> Bool { (f.mime.hasPrefix("image/") && !f.mime.contains("svg")) || f.mime.hasPrefix("video/") }
    func open(_ f: DriveFile, _ store: Store, among: [DriveFile] = []) {
        if FileOpener.isMedia(f) {
            let list = among.filter(FileOpener.isMedia)
            let files = list.contains(where: { $0.id == f.id }) ? list : [f]
            viewing = MediaSet(files: files, start: files.firstIndex { $0.id == f.id } ?? 0)
            return
        }
        quickLook(f, store)
    }
    func quickLook(_ f: DriveFile, _ store: Store) {
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
    @State private var dropping = false // files from another app over the page
    @State private var versionsOf: DriveFile?
    // How the files look, kept on this phone: icons (a grid), details (a list),
    // gallery (big pictures). Sorting is the same in every view.
    @AppStorage("drive_view") private var mode = "details"
    @AppStorage("drive_sort") private var sortBy = "name"
    @AppStorage("drive_desc") private var sortDesc = false
    private static let sorts = [("name", "Name"), ("date", "Modified"), ("type", "Type"), ("size", "Size")]

    private func loadShares() {
        Task {
            guard let list = try? await store.shares() else { return }
            var m: [String: [String: Any]] = [:]
            for s in list { if let k = (s["file_id"] as? String) ?? (s["folder_id"] as? String) { m[k] = s } }
            shares = m
        }
    }

    // Files dragged in from another app (Photos, Files, Safari...): uploaded
    // into the folder or course shown. Our own drags (text) are not files.
    private func dropFiles(_ providers: [NSItemProvider]) -> Bool {
        let files = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || !$0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }
        guard !files.isEmpty else { return false }
        let folder = folderId, course = courseId, store = store
        for p in files {
            let type = p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true } ?? UTType.data.identifier
            let suggested = p.suggestedName
            _ = p.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else { return }
                // The system deletes it when this returns: a copy is what goes up.
                let ext = url.pathExtension
                var name = suggested ?? url.lastPathComponent
                if !ext.isEmpty && !name.lowercased().hasSuffix("." + ext.lowercased()) { name += "." + ext }
                let copy = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(name)
                try? FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
                guard (try? FileManager.default.copyItem(at: url, to: copy)) != nil else { return }
                Task { @MainActor in _ = try? await store.upload(copy, folder: folder, course: course) }
            }
        }
        return true
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
        attach(VStack(alignment: .leading, spacing: 6) {
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
            HStack(spacing: 2) {
                ForEach([("icons", "square.grid.3x3"), ("details", "list.bullet"), ("gallery", "photo.on.rectangle")], id: \.0) { key, icon in
                    Button { mode = key } label: {
                        Image(systemName: icon).font(.system(size: 15)).foregroundStyle(mode == key ? H.fg : H.muted).frame(width: 38, height: 34)
                            .background(mode == key ? H.surface2 : .clear)
                    }
                }
                Spacer()
                Menu {
                    ForEach(DriveView.sorts, id: \.0) { key, label in
                        Button(label + (key == sortBy ? (sortDesc ? "  ↓" : "  ↑") : "")) {
                            // Again on the same one: the other way. Dates and sizes start newest / biggest.
                            if key == sortBy { sortDesc.toggle() } else { sortBy = key; sortDesc = key == "date" || key == "size" }
                        }
                    }
                } label: {
                    T("\(DriveView.sorts.first { $0.0 == sortBy }?.1 ?? "Name") \(sortDesc ? "↓" : "↑")", 13, H.muted).padding(.horizontal, 8).frame(height: 34)
                }
            }
            .padding(.horizontal, 12)
            if mode == "details" { detailsList(view) } else { grid(view) }
        }
        .background(H.bg)
        .onDrop(of: [.item], delegate: FilesFromOutside(over: $dropping, drop: dropFiles))
        .overlay {
            if dropping {
                ZStack {
                    H.accent.opacity(0.12)
                    T("Drop to upload here", 18, bold: true)
                }
                .overlay(Rectangle().stroke(H.accent, lineWidth: 2))
                .allowsHitTesting(false)
            }
        })
    }

    private func sorted<T>(_ rows: [T], _ name: (T) -> String, date: (T) -> Int64, size: (T) -> Int64, type: (T) -> String) -> [T] {
        rows.sorted { a, b in
            let order: ComparisonResult
            switch sortBy {
            case "date": order = date(a) == date(b) ? .orderedSame : date(a) < date(b) ? .orderedAscending : .orderedDescending
            case "size": order = size(a) == size(b) ? .orderedSame : size(a) < size(b) ? .orderedAscending : .orderedDescending
            case "type": order = type(a).localizedCaseInsensitiveCompare(type(b))
            default: order = name(a).localizedCaseInsensitiveCompare(name(b))
            }
            if order == .orderedSame { return name(a).localizedCaseInsensitiveCompare(name(b)) == .orderedAscending }
            return sortDesc ? order == .orderedDescending : order == .orderedAscending
        }
    }
    private func typeOf(_ f: DriveFile) -> String {
        if f.mime.hasPrefix("image/") { return "Picture" }
        if f.mime.hasPrefix("video/") { return "Video" }
        let ext = (f.name as NSString).pathExtension
        return ext.isEmpty ? "File" : ext.uppercased()
    }
    private func folders(_ view: Store.DriveView) -> [(Folder, Int)] {
        sorted(view.folders, { $0.0.name }, date: { $0.0.updated_at }, size: { Int64($0.1) }, type: { _ in "Folder" })
    }
    private func files(_ view: Store.DriveView) -> [DriveFile] {
        sorted(view.files, { $0.name }, date: { $0.updated_at }, size: { $0.size }, type: typeOf)
    }
    private func hasPreview(_ f: DriveFile) -> Bool { (f.mime.hasPrefix("image/") && !f.mime.contains("svg")) || f.mime.hasPrefix("video/") }
    private func icon(_ f: DriveFile) -> String { f.mime.hasPrefix("image/") ? "photo" : f.mime.hasPrefix("video/") ? "film" : "doc" }

    @ViewBuilder private func folderMenu(_ d: Folder) -> some View {
        Button(shares[d.id] != nil ? "Shared · link…" : "Share link…") { sharing = ShareTarget(table: "folders", id: d.id, name: d.name) }
        moveMenu("folder", d.id, here: d.parent_id)
        Button("Rename") { ask("Rename folder", d.name) { s in if !s.isEmpty { var d = d; d.name = s; store.save(d) } } }
        Button("Delete", role: .destructive) { deleting = ("\"\(d.name)\" and everything in it will be removed from every device.", { store.removeFolder(d.id) }) }
    }
    @ViewBuilder private func fileMenu(_ f: DriveFile) -> some View {
        Button("Open") { opener.open(f, store, among: files(store.drive(folderId, course: courseId))) }
        Button("Send file…") { send(f) }
        Button(shares[f.id] != nil ? "Shared · link…" : "Share link…") { sharing = ShareTarget(table: "files", id: f.id, name: f.name) }
        moveMenu("file", f.id, here: f.course_id == nil ? f.folder_id : "course")
        Button("Download…") { download(f) }
        Button("Versions…") { versionsOf = f }
        Button("Rename") { ask("Rename file", f.name) { s in if !s.isEmpty { var f = f; f.name = s; store.save(f) } } }
        Menu("Put in a course") {
            ForEach(store.courses) { c in Button(c.name) { store.setFileCourse(f.id, c.id) } }
        }
        if f.course_id != nil || f.folder_id != nil { Button("Move to the top") { store.setFileFolder(f.id, nil) } }
        Button("Delete", role: .destructive) { deleting = ("\"\(f.name)\" will be removed from every device.", { store.removeFile(f.id) }) }
    }

    // Icons and gallery: a grid of tiles; courses stay rows on top.
    private func grid(_ view: Store.DriveView) -> some View {
        let gallery = mode == "gallery"
        let cols = gallery ? [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)] : [GridItem(.adaptive(minimum: 100), spacing: 8)]
        let fs = files(view), ds = folders(view)
        return ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if view.courses.isEmpty && view.folders.isEmpty && view.files.isEmpty {
                    T(courseId != nil ? "Nothing in this course's folder yet. Upload files here, or attach them to its notes." : "Empty. Upload files or make a folder.", 13, H.faint)
                }
                ForEach(view.courses, id: \.0.id) { c, n in
                    row("graduationcap", c.name, "\(n) file\(n == 1 ? "" : "s")", Color(hex: c.color)) { courseId = c.id }
                        .dropDestination(for: String.self) { keys, _ in drop(keys.filter { $0.hasPrefix("file:") }, into: nil, course: c.id) }
                }
                LazyVGrid(columns: cols, spacing: 8) {
                    ForEach(ds, id: \.0.id) { d, n in
                        Button { folderId = d.id } label: {
                            if gallery {
                                HStack(spacing: 10) {
                                    Image(systemName: "folder").foregroundStyle(H.gold)
                                    T(d.name, 13, lines: 1)
                                    Spacer(minLength: 0)
                                    if shares[d.id] != nil { Image(systemName: "link").font(.system(size: 12)).foregroundStyle(H.teal) }
                                }
                                .padding(.horizontal, 12).frame(height: 48).background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                            } else {
                                tile(icon: "folder", tint: H.gold, name: d.name, shared: shares[d.id] != nil, picture: nil)
                            }
                        }
                        .buttonStyle(.plain)
                        .draggable(dragKey("folder", d.id))
                        .dropDestination(for: String.self) { keys, _ in drop(keys, into: d.id) }
                        .contextMenu { folderMenu(d) }
                    }
                }
                LazyVGrid(columns: cols, spacing: 8) {
                    ForEach(fs) { f in
                        Button { opener.open(f, store, among: fs) } label: {
                            if gallery {
                                VStack(spacing: 0) {
                                    Color.clear.aspectRatio(4.0 / 3.0, contentMode: .fit)
                                        .overlay { DriveThumb(file: f, big: true, icon: icon(f), show: hasPreview(f)) }
                                        .clipped()
                                    HStack(spacing: 6) {
                                        if shares[f.id] != nil { Image(systemName: "link").font(.system(size: 11)).foregroundStyle(H.teal) }
                                        T(f.name, 12, lines: 1)
                                        Spacer(minLength: 0)
                                    }
                                    .padding(.horizontal, 10).frame(height: 34)
                                }
                                .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                            } else {
                                tile(icon: icon(f), tint: H.muted, name: f.name, shared: shares[f.id] != nil, picture: hasPreview(f) ? f : nil)
                            }
                        }
                        .buttonStyle(.plain)
                        .draggable(dragKey("file", f.id))
                        .contextMenu { fileMenu(f) }
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .padding(.bottom, 60)
        }
    }

    // An icon-view tile: a big icon or the picture, the name under it.
    private func tile(icon: String, tint: Color, name: String, shared: Bool, picture: DriveFile?) -> some View {
        VStack(spacing: 8) {
            Group {
                if let f = picture { DriveThumb(file: f, big: false, icon: icon, show: true) }
                else { Image(systemName: icon).font(.system(size: 38)).foregroundStyle(tint) }
            }
            .frame(width: 60, height: 60).clipped()
            Text(name).font(H.mono(11)).foregroundStyle(H.fg).lineLimit(2).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 6).padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 124, alignment: .top)
        .background(H.surface)
        .overlay(Rectangle().stroke(H.border, lineWidth: 1))
        .overlay(alignment: .topLeading) { if shared { Image(systemName: "link").font(.system(size: 11)).foregroundStyle(H.teal).padding(6) } }
    }

    // Details: the list, each file with its small preview, size and date.
    private func detailsList(_ view: Store.DriveView) -> some View {
            List {
                if view.courses.isEmpty && view.folders.isEmpty && view.files.isEmpty {
                    T(courseId != nil ? "Nothing in this course's folder yet. Upload files here, or attach them to its notes." : "Empty. Upload files or make a folder.", 13, H.faint)
                        .listRowBackground(H.bg)
                }
                ForEach(view.courses, id: \.0.id) { c, n in
                    row("graduationcap", c.name, "\(n) file\(n == 1 ? "" : "s")", Color(hex: c.color)) { courseId = c.id }
                        .dropDestination(for: String.self) { keys, _ in drop(keys.filter { $0.hasPrefix("file:") }, into: nil, course: c.id) }
                }
                ForEach(folders(view), id: \.0.id) { d, n in
                    row("folder", d.name, "\(n) item\(n == 1 ? "" : "s")", H.gold, shared: shares[d.id] != nil) { folderId = d.id }
                        .draggable(dragKey("folder", d.id))
                        .dropDestination(for: String.self) { keys, _ in drop(keys, into: d.id) }
                        .contextMenu { folderMenu(d) }
                }
                ForEach(files(view)) { f in
                    row(icon(f), f.name, fmtBytes(f.size) + (f.updated_at > 0 ? "  ·  " + Dates.short(Dates.dayOf(f.updated_at)) : ""), H.muted, shared: shares[f.id] != nil, picture: hasPreview(f) ? f : nil) { opener.open(f, store, among: files(view)) }
                        .draggable(dragKey("file", f.id))
                        .contextMenu { fileMenu(f) }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
    }
}

// The Drive's sheets, alerts and pickers, around whichever view it shows.
extension DriveView {
    fileprivate func attach(_ content: some View) -> some View {
        content
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
        .fullScreenCover(item: $opener.viewing) { set in MediaViewer(set: set, opener: opener).environmentObject(store) }
        .sheet(item: $versionsOf) { f in VersionsSheet(file: f).environmentObject(store) }
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

    // The upload panel shows each file going up.
    private func upload(_ urls: [URL]) {
        let folder = folderId, course = courseId
        Task {
            for u in urls {
                let scoped = u.startAccessingSecurityScopedResource()
                defer { if scoped { u.stopAccessingSecurityScopedResource() } }
                _ = try? await store.upload(u, folder: folder, course: course)
            }
        }
    }

    private func row(_ icon: String, _ name: String, _ detail: String, _ tint: Color, shared: Bool = false, picture: DriveFile? = nil, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                if let f = picture { DriveThumb(file: f, big: false, icon: icon, show: true).frame(width: 34, height: 34).clipped() }
                else { Image(systemName: icon).font(.system(size: 20)).foregroundStyle(tint).frame(width: 26) }
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

// A Drive file's preview from the server (big: the gallery's 480 px one); its
// icon until it arrives, or when it has none. A video's says it plays.
struct DriveThumb: View {
    @EnvironmentObject var store: Store
    let file: DriveFile
    let big: Bool
    let icon: String
    let show: Bool
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            H.bg
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
                if file.mime.hasPrefix("video/") { Image(systemName: "play.circle.fill").font(.system(size: big ? 30 : 16)).foregroundStyle(.white.opacity(0.9)) }
            } else {
                Image(systemName: icon).font(.system(size: big ? 34 : 16)).foregroundStyle(H.faint)
            }
        }
        .task(id: "\(file.id).\(file.updated_at).\(big)") { if show { image = await store.thumb(file, big: big) } }
    }
}

// A drop on the Drive page: files from another app (not our own drags, which
// carry text) light the page up and are uploaded.
private struct FilesFromOutside: DropDelegate {
    @Binding var over: Bool
    let drop: ([NSItemProvider]) -> Bool
    private func outside(_ info: DropInfo) -> Bool { info.hasItemsConforming(to: [.fileURL]) || !info.hasItemsConforming(to: [.plainText]) }
    func validateDrop(info: DropInfo) -> Bool { outside(info) }
    func dropEntered(info: DropInfo) { over = outside(info) }
    func dropExited(info: DropInfo) { over = false }
    func performDrop(info: DropInfo) -> Bool {
        over = false
        return drop(info.itemProviders(for: [.item]))
    }
}
