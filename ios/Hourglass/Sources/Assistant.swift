import SwiftUI
import PhotosUI

// Talk to Hourglass: the assistant runs on the server (opencode) and works on
// this account's notes, schedule, alarms and timers. Each tool it uses shows as
// a line ("Set an alarm"); when it finishes, the phone syncs the changes in.
// Common requests (an alarm, a timer, a birthday) come back at once: the
// server answers those itself. The paperclip attaches pictures and files (they
// go to the Drive's "Assistant" folder).
struct Attachment: Identifiable { let id = UUID(); let name: String; let mime: String; var fileId: String?; var error: String? }
struct AssistantView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @StateObject private var opener = FileOpener()
    @State private var chat: [String: Any] = [:]
    @State private var pending: String?        // sent, not in the list yet
    @State private var sending = false
    @State private var wasBusy = false
    @State private var input = ""
    @State private var problem: String?
    @State private var attachments: [Attachment] = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var importing = false
    private var uploading: Bool { attachments.contains { $0.fileId == nil && $0.error == nil } }

    private static let suggestions = ["What's on today?", "Set an alarm in 30 minutes", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "Tidy up my latest note"]

    private var enabled: Bool { (chat["enabled"] as? Bool) ?? true }
    private var busy: Bool { sending || (chat["busy"] as? Bool ?? false) || pending != nil }
    private func messages(_ c: [String: Any]) -> [[String: Any]] { c["messages"] as? [[String: Any]] ?? [] }
    private var shown: [[String: Any]] {
        var list = messages(chat)
        if let p = pending, !list.contains(where: { $0["role"] as? String == "user" && $0["text"] as? String == p }) {
            list.append(["role": "user", "text": p])
        }
        return list
    }

    private func load() async {
        do {
            let c = try await store.assistant("GET")
            problem = nil
            chat = c
            if let p = pending, messages(c).contains(where: { $0["role"] as? String == "user" && $0["text"] as? String == p }) { pending = nil }
            let nowBusy = (c["busy"] as? Bool ?? false) || pending != nil
            // Finished: pull what the assistant changed.
            if wasBusy && !nowBusy { await store.sync() }
            wasBusy = nowBusy
        } catch { problem = error.localizedDescription }
    }

    private func send(_ text: String) {
        let files = attachments.compactMap(\.fileId)
        let kept = attachments
        // With only files, the server says what the message is.
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty && !files.isEmpty { t = "(see the attached file" + (files.count > 1 ? "s)" : ")") }
        guard !t.isEmpty, !busy, !uploading, enabled else { return }
        pending = t; sending = true; wasBusy = true; input = ""; attachments = []
        Task {
            do { _ = try await store.assistant("POST", "/message", ["text": t, "files": files]) }
            catch { pending = nil; input = text; attachments = kept; problem = error.localizedDescription }
            sending = false
            await load()
        }
    }

    // Picked pictures and files: uploaded to the Drive's "Assistant" folder now.
    private func attach(_ files: [(URL, String)]) {
        guard !files.isEmpty else { return }
        let added = files.map { (Attachment(name: $0.1, mime: mimeOf($0.1)), $0.0) }
        attachments += added.map(\.0)
        Task {
            let folder: String
            do { folder = try await store.assistantFolder() } catch {
                for (a, _) in added { set(a.id) { $0.error = error.localizedDescription } }
                return
            }
            for (a, url) in added {
                do { let f = try await store.upload(url, name: a.name, folder: folder, course: nil); set(a.id) { $0.fileId = f.id } }
                catch { set(a.id) { $0.error = error.localizedDescription } }
            }
        }
    }
    private func set(_ id: UUID, _ change: (inout Attachment) -> Void) {
        if let i = attachments.firstIndex(where: { $0.id == id }) { change(&attachments[i]) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                Button { dismiss() } label: { Image(systemName: "chevron.left").font(.system(size: 18, weight: .medium)).foregroundStyle(H.fg).frame(width: 44, height: 44) }
                T("Assistant", 18, bold: true)
                Spacer()
                if !shown.isEmpty && !busy {
                    HButton("New chat") { Task { _ = try? await store.assistant("POST", "/new"); pending = nil; await load() } }
                }
            }
            .padding(.horizontal, 8)

            if shown.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    PixelLogo(cell: 5)
                    T(enabled ? "Ask Hourglass to do it for you" : (chat["reason"] as? String ?? "The assistant is not available."), 17, bold: true)
                        .multilineTextAlignment(.center)
                    if enabled {
                        T("It can read and change your notes, schedule, alarms, timers and Drive.", 13, H.muted).multilineTextAlignment(.center)
                        ForEach(Self.suggestions, id: \.self) { s in HButton(s) { send(s) }.frame(maxWidth: .infinity) }
                    }
                }
                .padding(24)
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(shown.enumerated()), id: \.offset) { _, m in Message(m: m, opener: opener) }
                            if busy { T("Working…", 13, H.muted).padding(.leading, 14) }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                    .onChange(of: shown.count) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                    .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                }
            }

            if let problem { T(problem, 13, H.accent).padding(.horizontal, 16).padding(.vertical, 4) }

            // Attached, waiting to be sent
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(attachments) { a in
                            AttachmentChip(name: a.name, mime: a.mime, note: a.error ?? (a.fileId == nil ? "Uploading…" : nil)) { attachments.removeAll { $0.id == a.id } }
                        }
                    }
                    .padding(.horizontal, 12).padding(.top, 6)
                }
            }

            // The message box
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { importing = true } label: { Label("Files", systemImage: "doc") }
                    PhotosPicker(selection: $photoItems, matching: .images) { Label("Photos", systemImage: "photo") }
                } label: { Image(systemName: "paperclip").font(.system(size: 18)).foregroundStyle(H.muted).frame(width: 36, height: 44) }
                .disabled(!enabled || busy)
                TextField("", text: $input, prompt: Text(busy ? "Working on it…" : "Ask Hourglass…").foregroundStyle(H.faint), axis: .vertical)
                    .lineLimit(1...6)
                    .font(H.mono(15)).foregroundStyle(H.fg).tint(H.accent)
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    .disabled(!enabled)
                if busy {
                    HButton("", icon: "stop.fill") { Task { _ = try? await store.assistant("POST", "/stop"); await load() } }
                } else {
                    HButton("", icon: "paperplane.fill", primary: true, enabled: enabled && !uploading && (!input.trimmingCharacters(in: .whitespaces).isEmpty || attachments.contains { $0.fileId != nil })) { send(input) }
                }
            }
            .padding(12)
        }
        .background(H.bg)
        .toolbar(.hidden, for: .navigationBar)
        .quickLookPreview($opener.url)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r else { return }
            // Copied out first: a picked file is only readable while in scope.
            attach(urls.compactMap { u in
                let scoped = u.startAccessingSecurityScopedResource()
                defer { if scoped { u.stopAccessingSecurityScopedResource() } }
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + u.lastPathComponent)
                return (try? FileManager.default.copyItem(at: u, to: dest)) != nil ? (dest, u.lastPathComponent) : nil
            })
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task {
                var out: [(URL, String)] = []
                for (i, item) in items.enumerated() {
                    guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                    let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                    if (try? data.write(to: dest)) != nil { out.append((dest, "Photo \(Dates.today()) \(i + 1).\(ext)")) }
                }
                attach(out)
            }
        }
        // Poll quickly while it works, slowly otherwise.
        .task(id: busy) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: busy ? 900_000_000 : 15_000_000_000)
            }
        }
    }
}

private struct Message: View {
    @EnvironmentObject var store: Store
    let m: [String: Any]
    let opener: FileOpener

    var body: some View {
        let text = m["text"] as? String ?? ""
        if m["role"] as? String == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                ForEach(Array((m["files"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, f in
                    AttachmentChip(name: f["name"] as? String ?? "file", mime: f["mime"] as? String ?? "", note: nil, onRemove: nil)
                        .onTapGesture { if let id = f["id"] as? String, let row = store.file(id) { opener.open(row, store) } }
                }
                HStack {
                    Spacer(minLength: 48)
                    T(text, 15)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(H.surface2).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(H.accent).frame(width: 3)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array((m["tools"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, t in
                        let status = t["status"] as? String ?? ""
                        HStack(spacing: 8) {
                            Image(systemName: status == "completed" ? "checkmark" : status == "error" ? "xmark" : "arrow.triangle.2.circlepath")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(status == "completed" ? H.teal : status == "error" ? H.accent : H.muted)
                            T(t["label"] as? String ?? "", 13, H.muted)
                        }
                    }
                    if !text.isEmpty { NoteBodyView(text: text, open: { opener.open($0, store) }) }
                    if let e = m["error"] as? String, !e.isEmpty { T(e, 13, H.accent) }
                }
                .padding(.vertical, 4)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// A file on a message or waiting to be sent: its kind, its name, and a note
// ("Uploading…", an error). onRemove: an x to take it off.
struct AttachmentChip: View {
    let name: String
    let mime: String
    let note: String?
    let onRemove: (() -> Void)?
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: mime.hasPrefix("image/") ? "photo" : "doc").foregroundStyle(H.muted)
            VStack(alignment: .leading, spacing: 1) {
                T(name, 13, lines: 1)
                if let note { T(note, 11, note == "Uploading…" ? H.muted : H.accent, lines: 1) }
            }
            if let onRemove { Button(action: onRemove) { Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(H.muted) } }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: 260, alignment: .leading)
        .background(H.surface2)
        .overlay(Rectangle().stroke(note != nil && note != "Uploading…" ? H.accent : H.border, lineWidth: 1))
    }
}
