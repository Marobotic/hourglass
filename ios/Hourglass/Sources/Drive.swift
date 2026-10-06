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

// The Drive: every course has a folder for the files put there; then your own
// folders and files. Bytes live on the server; the rows sync to every device.
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

    var body: some View {
        let view = store.drive(folderId, course: courseId)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                if folderId != nil || courseId != nil {
                    Button { up(view) } label: { Image(systemName: "chevron.left").foregroundStyle(H.fg).frame(width: 40, height: 40) }
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
                }
                ForEach(view.folders, id: \.0.id) { d, n in
                    row("folder", d.name, "\(n) item\(n == 1 ? "" : "s")", H.gold) { folderId = d.id }
                        .contextMenu {
                            Button("Rename") { ask("Rename folder", d.name) { s in if !s.isEmpty { var d = d; d.name = s; store.save(d) } } }
                            Button("Delete", role: .destructive) { deleting = ("\"\(d.name)\" and everything in it will be removed from every device.", { store.removeFolder(d.id) }) }
                        }
                }
                ForEach(view.files) { f in
                    row(f.mime.hasPrefix("image/") ? "photo" : f.mime.hasPrefix("video/") ? "film" : "doc", f.name, fmtBytes(f.size), H.muted) { opener.open(f, store) }
                        .contextMenu {
                            Button("Open") { opener.open(f, store) }
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
        .task { while !Task.isCancelled { usage = await store.driveUsage(); try? await Task.sleep(nanoseconds: 5_000_000_000) } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r, !urls.isEmpty else { return }
            upload(urls)
        }
        .quickLookPreview($opener.url)
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

    private func row(_ icon: String, _ name: String, _ detail: String, _ tint: Color, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 20)).foregroundStyle(tint).frame(width: 26)
                VStack(alignment: .leading, spacing: 2) { T(name, 15, lines: 1); T(detail, 12, H.muted) }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(H.bg)
    }
}
