import SwiftUI
import UIKit
import UniformTypeIdentifiers

// "Share to Hourglass": files, photos and videos go to the Drive (pick a folder,
// then upload), text and links become a note. It talks to the server itself
// with the session the app left in the app group (SharedBox).
final class ShareViewController: UIViewController {
    private var model: ShareModel!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.07, alpha: 1)
        model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

// MARK: - colours (Hourglass's)

private enum C {
    static let bg = Color(red: 0.07, green: 0.07, blue: 0.07)
    static let surface = Color(red: 0.106, green: 0.106, blue: 0.106)
    static let surface2 = Color(red: 0.141, green: 0.141, blue: 0.141)
    static let border = Color(red: 0.18, green: 0.18, blue: 0.18)
    static let fg = Color(red: 0.96, green: 0.96, blue: 0.96)
    static let muted = Color(red: 0.64, green: 0.64, blue: 0.64)
    static let faint = Color(red: 0.42, green: 0.42, blue: 0.42)
    static let accent = Color(red: 0.694, green: 0.259, blue: 0.259)
    static let gold = Color(red: 0.941, green: 0.745, blue: 0.4)
    static func hex(_ s: String?) -> Color {
        guard let s, s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) else { return Color(red: 0.29, green: 0.545, blue: 0.545) }
        return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
}

private func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .monospaced) }

// MARK: - model

struct Picked: Identifiable { let id = UUID(); let url: URL; let name: String; let size: Int64 }
struct Entry: Identifiable, Hashable { let id: String; let name: String; let detail: String; let color: String?; let isCourse: Bool }

@MainActor
final class ShareModel: ObservableObject {
    private let context: NSExtensionContext?
    let server = SharedBox.server ?? ""
    let session = SharedBox.session ?? ""
    var signedIn: Bool { !server.isEmpty && !session.isEmpty }

    @Published var loaded = false
    @Published var files: [Picked] = []
    @Published var text = ""
    @Published var subject = ""

    // Where the files go: nil = the top, else a folder or a course.
    @Published var folderId: String?
    @Published var courseId: String?
    @Published var path: [(id: String, name: String)] = []
    @Published var courseName = ""
    @Published var entries: [Entry] = []
    @Published var otherFiles: [String] = []
    @Published var listing = false

    @Published var phase = "pick" // pick | uploading | done
    @Published var current = 0
    @Published var errors: [String] = []
    @Published var problem: String?

    @Published var courses: [Entry] = []

    init(context: NSExtensionContext?) { self.context = context }

    var placeName: String { courseId != nil ? courseName : path.last?.name ?? "Drive" }

    func close() { context?.completeRequest(returningItems: nil) }
    func cancel() { context?.cancelRequest(withError: NSError(domain: "hourglass", code: 0)) }

    // What was shared: files (copied out, they vanish after the callback), text and links.
    func load() async {
        let items = (context?.inputItems as? [NSExtensionItem]) ?? []
        subject = items.compactMap { $0.attributedContentText?.string }.first { !$0.isEmpty } ?? ""
        var texts: [String] = []
        for item in items {
            for p in item.attachments ?? [] {
                if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), !p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    if let s = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String { texts.append(s) }
                } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier), !p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    if let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL { texts.append(u.absoluteString) }
                } else if let f = await copyFile(p) {
                    files.append(f)
                }
            }
        }
        text = texts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        // A link shared with its page title: the title is the subject, not the body.
        if subject == text { subject = "" }
        loaded = true
        if signedIn {
            if files.isEmpty { await loadCourses() } else { await list() }
        }
    }

    private func copyFile(_ p: NSItemProvider) async -> Picked? {
        let type = p.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true || UTType($0)?.conforms(to: .item) == true } ?? UTType.data.identifier
        return await withCheckedContinuation { cont in
            _ = p.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else { return cont.resume(returning: nil) }
                let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var name = p.suggestedName ?? url.deletingPathExtension().lastPathComponent
                if (name as NSString).pathExtension.isEmpty, !url.pathExtension.isEmpty { name += "." + url.pathExtension }
                let dest = dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "_"))
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    let size = ((try? FileManager.default.attributesOfItem(atPath: dest.path))?[.size] as? NSNumber)?.int64Value ?? 0
                    cont.resume(returning: Picked(url: dest, name: dest.lastPathComponent, size: size))
                } catch { cont.resume(returning: nil) }
            }
        }
    }

    // MARK: server

    private func request(_ path: String, query: [URLQueryItem] = []) -> URLRequest {
        var comps = URLComponents(string: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + path)!
        if !query.isEmpty { comps.queryItems = query }
        var r = URLRequest(url: comps.url!, timeoutInterval: 20)
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        return r
    }

    private func action(_ name: String, _ args: [String: Any]) async throws -> Any {
        var r = request("api/actions/" + name)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: args)
        let (d, res) = try await URLSession.shared.data(for: r)
        try check(d, res)
        return try JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed])
    }

    private func check(_ d: Data, _ res: URLResponse) throws {
        guard let h = res as? HTTPURLResponse, !(200..<300).contains(h.statusCode) else { return }
        let msg = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["error"] as? String
        throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: h.statusCode == 401 ? "Signed out. Open Hourglass and sign in again." : msg ?? "HTTP \(h.statusCode)"])
    }

    func list() async {
        listing = true
        defer { listing = false }
        var args: [String: Any] = [:]
        if let courseId { args["course_id"] = courseId } else if let folderId { args["folder_id"] = folderId }
        do {
            let r = try await action("list_drive", args) as? [String: Any] ?? [:]
            let courses = (r["courses"] as? [[String: Any]] ?? []).map { c in
                Entry(id: c["id"] as? String ?? "", name: c["name"] as? String ?? "", detail: count(c["items"], "file"), color: c["color"] as? String, isCourse: true)
            }
            let folders = (r["folders"] as? [[String: Any]] ?? []).map { f in
                Entry(id: f["id"] as? String ?? "", name: f["name"] as? String ?? "", detail: count(f["items"], "item"), color: nil, isCourse: false)
            }
            entries = courses + folders
            otherFiles = (r["files"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
            if courseId == nil {
                path = (r["path"] as? [[String: Any]] ?? []).map { (id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "") }
            }
            problem = nil
        } catch { problem = error.localizedDescription }
    }

    private func count(_ v: Any?, _ word: String) -> String {
        let n = (v as? Int) ?? 0
        return "\(n) \(word)\(n == 1 ? "" : "s")"
    }

    func open(_ e: Entry) async {
        if e.isCourse { courseId = e.id; courseName = e.name; folderId = nil } else { folderId = e.id; courseId = nil }
        await list()
    }

    func up() async {
        if courseId != nil { courseId = nil; folderId = nil } else { folderId = path.dropLast().last?.id }
        await list()
    }

    func top() async { courseId = nil; folderId = nil; await list() }
    func go(_ id: String) async { courseId = nil; folderId = id; await list() }

    func newFolder(_ name: String) async {
        do {
            var args: [String: Any] = ["name": name]
            if let folderId { args["parent_id"] = folderId }
            let r = try await action("add_folder", args) as? [String: Any]
            if let id = r?["id"] as? String { folderId = id }
            await list()
        } catch { problem = error.localizedDescription }
    }

    func uploadAll() async {
        phase = "uploading"
        errors = []
        for (i, f) in files.enumerated() {
            current = i
            do {
                var q = [URLQueryItem(name: "name", value: f.name), URLQueryItem(name: "mime", value: UTType(filenameExtension: f.url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")]
                if let courseId { q.append(URLQueryItem(name: "course", value: courseId)) } else if let folderId { q.append(URLQueryItem(name: "folder", value: folderId)) }
                var r = request("api/files/upload", query: q)
                r.httpMethod = "POST"
                r.timeoutInterval = 900
                let (d, res) = try await URLSession.shared.upload(for: r, fromFile: f.url)
                try check(d, res)
            } catch { errors.append("\(f.name): \(error.localizedDescription)") }
        }
        current = files.count
        phase = "done"
    }

    func loadCourses() async {
        guard let list = try? await action("list_courses", [:]) as? [[String: Any]] else { return }
        courses = list.map { Entry(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "", detail: "", color: $0["color"] as? String, isCourse: true) }
    }

    func saveNote(title: String, body: String, course: String?) async -> Bool {
        var args: [String: Any] = ["body": body]
        if !title.isEmpty { args["title"] = title }
        if let course { args["course"] = course }
        do { _ = try await action("add_note", args); return true } catch { problem = error.localizedDescription; return false }
    }
}

// MARK: - views

struct ShareView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: model.files.isEmpty ? "note.text" : "folder").foregroundStyle(C.gold)
                Text(model.files.isEmpty ? "Save as a note" : "Save to Drive").font(mono(18, .bold)).foregroundStyle(C.fg)
                Spacer()
                Button { model.cancel() } label: { Image(systemName: "xmark").foregroundStyle(C.muted).padding(10) }
            }
            .padding(.horizontal, 18).padding(.top, 14)

            if !model.loaded {
                Spacer(); ProgressView().tint(C.muted); Spacer()
            } else if !model.signedIn {
                Message(text: "Open Hourglass and sign in, then share again.", button: "Close") { model.cancel() }
            } else if !model.files.isEmpty {
                UploadView(model: model)
            } else if !model.text.isEmpty {
                NoteView(model: model)
            } else {
                Message(text: "There was nothing to save in what was shared.", button: "Close") { model.cancel() }
            }
        }
        .background(C.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}

private struct Message: View {
    let text: String
    let button: String
    let action: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Text(text).font(mono(15)).foregroundStyle(C.muted).multilineTextAlignment(.center)
            PrimaryButton(title: button, action: action)
            Spacer()
        }.padding(24)
    }
}

private struct PrimaryButton: View {
    let title: String
    var primary = true
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(mono(14, primary ? .bold : .regular)).foregroundStyle(primary ? .white : C.fg)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(primary ? C.accent : Color.clear)
                .overlay(Rectangle().stroke(primary ? Color.clear : C.border, lineWidth: 1))
        }
        .disabled(!enabled).opacity(enabled ? 1 : 0.4)
    }
}

private struct UploadView: View {
    @ObservedObject var model: ShareModel
    @State private var naming = false
    @State private var newName = ""

    var total: Int64 { model.files.reduce(0) { $0 + $1.size } }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(model.files.count == 1 ? model.files[0].name : "\(model.files.count) files").font(mono(14)).foregroundStyle(C.fg).lineLimit(1)
                Text((total > 0 ? ByteCountFormatter.string(fromByteCount: total, countStyle: .file) + "  ·  " : "") + "choose where they go").font(mono(12)).foregroundStyle(C.muted)
            }.padding(.horizontal, 18).padding(.vertical, 8)

            switch model.phase {
            case "pick": picker
            case "uploading": uploading
            default: done
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.phase)
        .alert("New folder", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Make it") { let n = newName.trimmingCharacters(in: .whitespaces); newName = ""; if !n.isEmpty { Task { await model.newFolder(n) } } }
            Button("Cancel", role: .cancel) { newName = "" }
        }
    }

    private var picker: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if model.folderId != nil || model.courseId != nil {
                        Button { Task { await model.up() } } label: { Image(systemName: "chevron.left").foregroundStyle(C.fg).padding(.trailing, 6) }
                    }
                    crumb("Drive", current: model.folderId == nil && model.courseId == nil) { await model.top() }
                    if model.courseId != nil { slash; crumb(model.courseName, current: true) {} }
                    ForEach(Array(model.path.enumerated()), id: \.offset) { i, p in
                        slash
                        crumb(p.name, current: i == model.path.count - 1) { await model.go(p.id) }
                    }
                }.padding(.horizontal, 18).padding(.vertical, 8)
            }
            List {
                ForEach(model.entries) { e in
                    Button { Task { await model.open(e) } } label: {
                        HStack(spacing: 14) {
                            Image(systemName: e.isCourse ? "graduationcap" : "folder.fill").foregroundStyle(e.isCourse ? C.hex(e.color) : C.gold).frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.name).font(mono(15)).foregroundStyle(C.fg).lineLimit(1)
                                Text(e.detail).font(mono(12)).foregroundStyle(C.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(C.faint)
                        }.padding(.vertical, 6)
                    }
                    .listRowBackground(C.bg)
                }
                ForEach(model.otherFiles, id: \.self) { n in
                    HStack(spacing: 14) {
                        Image(systemName: "doc").foregroundStyle(C.faint).frame(width: 24)
                        Text(n).font(mono(13)).foregroundStyle(C.faint).lineLimit(1)
                    }.listRowBackground(C.bg)
                }
                if model.entries.isEmpty && model.otherFiles.isEmpty && !model.listing {
                    Text("Empty. Upload here, or make a folder.").font(mono(13)).foregroundStyle(C.faint).listRowBackground(C.bg)
                }
                if let p = model.problem { Text(p).font(mono(12)).foregroundStyle(C.accent).listRowBackground(C.bg) }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .overlay { if model.listing && model.entries.isEmpty { ProgressView().tint(C.muted) } }
            .animation(.easeOut(duration: 0.18), value: model.entries)

            HStack {
                if model.courseId == nil { PrimaryButton(title: "New folder", primary: false) { naming = true } }
                Spacer()
                PrimaryButton(title: model.files.count == 1 ? "Upload to \(model.placeName)" : "Upload \(model.files.count) to \(model.placeName)") {
                    Task { await model.uploadAll() }
                }
            }
            .padding(12).background(C.surface)
        }
    }

    private var slash: some View { Text("/").font(mono(13)).foregroundStyle(C.faint) }

    private func crumb(_ t: String, current: Bool, _ go: @escaping () async -> Void) -> some View {
        Button { Task { await go() } } label: {
            Text(t).font(mono(14, current ? .bold : .regular)).foregroundStyle(current ? C.fg : C.muted).lineLimit(1)
        }.disabled(current)
    }

    private var uploading: some View {
        VStack(spacing: 14) {
            Spacer()
            Text("Uploading to \(model.placeName)").font(mono(16, .bold)).foregroundStyle(C.fg)
            Text(model.current < model.files.count ? "\(model.current + 1) of \(model.files.count)  ·  \(model.files[model.current].name)" : "Finishing…")
                .font(mono(13)).foregroundStyle(C.muted).lineLimit(1)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Rectangle().fill(C.surface2)
                    Rectangle().fill(C.accent).frame(width: max(8, g.size.width * CGFloat(model.current) / CGFloat(max(1, model.files.count))))
                        .animation(.easeOut(duration: 0.4), value: model.current)
                }
            }.frame(height: 4)
            Spacer()
        }.padding(24)
    }

    private var done: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: model.errors.isEmpty ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 40)).foregroundStyle(model.errors.isEmpty ? C.gold : C.accent)
                .symbolEffect(.bounce, value: model.phase)
            Text(model.errors.isEmpty ? "Saved to \(model.placeName)" : "\(model.files.count - model.errors.count) of \(model.files.count) saved")
                .font(mono(18, .bold)).foregroundStyle(C.fg)
            if model.errors.isEmpty { Text("It's in your Drive on every device.").font(mono(13)).foregroundStyle(C.muted) }
            ForEach(model.errors, id: \.self) { Text($0).font(mono(12)).foregroundStyle(C.accent) }
            PrimaryButton(title: "Done") { model.close() }.padding(.top, 12)
            Spacer()
        }.frame(maxWidth: .infinity).padding(24)
    }
}

private struct NoteView: View {
    @ObservedObject var model: ShareModel
    @State private var title = ""
    @State private var body_ = ""
    @State private var course: String?
    @State private var saving = false
    @State private var saved = false
    @State private var ready = false

    var body: some View {
        Group {
            if saved {
                VStack(spacing: 10) {
                    Spacer()
                    Image(systemName: "note.text").font(.system(size: 40)).foregroundStyle(C.gold).symbolEffect(.bounce, value: saved)
                    Text("Saved to Notes").font(mono(18, .bold)).foregroundStyle(C.fg)
                    PrimaryButton(title: "Done") { model.close() }.padding(.top, 12)
                    Spacer()
                }.frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            label("TITLE")
                            TextField("", text: $title).font(mono(15)).foregroundStyle(C.fg).padding(10).background(C.surface).overlay(Rectangle().stroke(C.border))
                            label("NOTE")
                            TextEditor(text: $body_).font(mono(14)).foregroundStyle(C.fg).scrollContentBackground(.hidden)
                                .frame(minHeight: 200).padding(6).background(C.surface).overlay(Rectangle().stroke(C.border))
                            if !model.courses.isEmpty {
                                label("COURSE")
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        pill("None", C.muted, course == nil) { course = nil }
                                        ForEach(model.courses) { c in pill(c.name, C.hex(c.color), course == c.id) { course = c.id } }
                                    }
                                }
                            }
                            if let p = model.problem { Text(p).font(mono(12)).foregroundStyle(C.accent) }
                        }.padding(18)
                    }
                    HStack {
                        Spacer()
                        PrimaryButton(title: saving ? "Saving…" : "Save note", enabled: !saving && !(title.isEmpty && body_.isEmpty)) {
                            saving = true
                            Task {
                                if await model.saveNote(title: title.trimmingCharacters(in: .whitespaces), body: body_.trimmingCharacters(in: .whitespacesAndNewlines), course: course) {
                                    withAnimation(.easeOut(duration: 0.2)) { saved = true }
                                }
                                saving = false
                            }
                        }
                    }.padding(12).background(C.surface)
                }
            }
        }
        .onAppear {
            guard !ready else { return }
            ready = true
            // A title from the subject (a page's title), else a short first line.
            let lines = model.text.components(separatedBy: .newlines)
            let first = lines.first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
            if !model.subject.isEmpty { title = model.subject; body_ = model.text }
            else if first.count <= 60 && lines.count > 1 { title = first; body_ = model.text.replacingOccurrences(of: first, with: "", options: [], range: model.text.range(of: first)).trimmingCharacters(in: .whitespacesAndNewlines) }
            else { title = String(first.prefix(60)); body_ = model.text }
        }
    }

    private func label(_ t: String) -> some View { Text(t).font(mono(11, .bold)).tracking(1.5).foregroundStyle(C.muted) }

    private func pill(_ name: String, _ tint: Color, _ on: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(name).font(mono(13)).foregroundStyle(on ? C.fg : C.muted).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(on ? tint.opacity(0.2) : Color.clear)
                .overlay(Rectangle().stroke(on ? tint : C.border, lineWidth: 1))
        }
    }
}
