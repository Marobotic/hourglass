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
    @State private var settingsOpen = false
    @State private var showSteps = true              // "What it's doing" under Working
    @State private var openSteps: Set<String> = []   // finished answers whose steps are shown
    @State private var now = Date()
    @State private var seen: Set<String> = []        // on screen once: later messages rise in
    @State private var ready = false
    @FocusState private var typing: Bool              // the message box has the keyboard
    private var uploading: Bool { attachments.contains { $0.fileId == nil && $0.error == nil } }

    private static let suggestions = ["What's on today?", "Set my alarm in 1 hour", "Wake me at 7:30 on weekdays", "Start a 25 minute timer", "Upcoming birthdays", "Tidy up my latest note"]

    // "Free · big-pickle", "Claude plan · haiku 5.5", "API · gpt-5-mini" (as on the desktop).
    private var engineLabel: String {
        let m = chat["model"] as? String ?? ""
        var short = m.replacingOccurrences(of: "opencode/", with: "").replacingOccurrences(of: "claude-", with: "")
        short = short.replacingOccurrences(of: "-(\\d+)-(\\d+)$", with: " $1.$2", options: .regularExpression)
        short = short.prefix(1).uppercased() + short.dropFirst()
        switch chat["engine"] as? String {
        case "anthropic": return "Claude API · " + short
        case "claude": return "Claude plan · " + short
        case "openai": return "API · " + (m.isEmpty ? "pick a model" : m)
        default: return "Free · " + (short.isEmpty ? "auto" : short)
        }
    }
    private var serverBusy: Bool { chat["busy"] as? Bool ?? false }
    // The answer being worked on: its steps show live under Working.
    private var current: [String: Any]? {
        guard serverBusy, let last = messages(chat).last, last["role"] as? String == "assistant" else { return nil }
        return last
    }
    private func key(_ m: [String: Any]) -> String { (m["id"] as? String) ?? (m["text"] as? String ?? "") }

    private var enabled: Bool { (chat["enabled"] as? Bool) ?? true }
    private var busy: Bool { sending || (chat["busy"] as? Bool ?? false) || pending != nil }
    private func messages(_ c: [String: Any]) -> [[String: Any]] { c["messages"] as? [[String: Any]] ?? [] }
    private var shown: [[String: Any]] {
        var list = messages(chat)
        if let p = pending, !list.contains(where: { $0["role"] as? String == "user" && $0["text"] as? String == p }) {
            list.append(["id": "pending", "role": "user", "text": p])
        }
        return list
    }

    private func load() async {
        do {
            let c = try await store.assistant("GET")
            problem = nil
            withAnimation(.easeOut(duration: 0.22)) { chat = c }
            if !ready {
                seen = Set(messages(c).map(key))
                ready = true
            }
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
                // Puts the keyboard away (dragging the list down does too).
                if typing {
                    Button { typing = false } label: { Image(systemName: "keyboard.chevron.compact.down").font(.system(size: 17)).foregroundStyle(H.muted).frame(width: 40, height: 44) }
                }
                // Who answers: opens the AI settings.
                Button { settingsOpen = true } label: {
                    HStack(spacing: 3) {
                        T(engineLabel, 12, H.muted, lines: 1).frame(maxWidth: 150, alignment: .trailing)
                        Image(systemName: "chevron.down").font(.system(size: 10)).foregroundStyle(H.muted)
                    }.padding(.horizontal, 6).frame(height: 44)
                }
                if !shown.isEmpty && !busy {
                    HButton("New") { Task { _ = try? await store.assistant("POST", "/new"); pending = nil; await load() } }
                }
            }
            .padding(.horizontal, 8)

            if shown.isEmpty {
                // Scrolls when the keyboard leaves less room than it needs; otherwise
                // centred. Without this the page overflowed with the keyboard up: the
                // header went off the top and the message box under the keyboard.
                GeometryReader { geo in
                ScrollView {
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
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
                }
                .scrollDismissesKeyboard(.interactively)
                }
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(shown.indices, id: \.self) { i in
                                let m = shown[i]
                                let k = key(m)
                                Message(m: m, opener: opener, now: now, stepsShown: openSteps.contains(k),
                                        canShowSteps: !(serverBusy && i == messages(chat).count - 1),
                                        onToggleSteps: { withAnimation(.easeOut(duration: 0.2)) { if openSteps.contains(k) { openSteps.remove(k) } else { openSteps.insert(k) } } })
                                    .modifier(Rise(animate: ready && !seen.contains(k)))
                                    .onAppear { seen.insert(k) }
                                    .id(k)
                            }
                            if busy { Working(current: current, now: now, showSteps: $showSteps).transition(.opacity.combined(with: .move(edge: .bottom))) }
                            Color.clear.frame(height: 1).id("end")
                        }
                        .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: shown.count) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                    .onChange(of: ((shown.last?["text"] as? String)?.count ?? 0) + ((current?["steps"] as? [Any])?.count ?? 0)) { _, _ in withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
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
                    .focused($typing)
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
        .fullScreenCover(item: $opener.viewing) { set in MediaViewer(set: set, opener: opener).environmentObject(store) }
        .sheet(isPresented: $settingsOpen) { AssistantSettingsSheet(onSaved: { Task { await load() } }).environmentObject(store) }
        // A clock for timer cards and "Working N s".
        .task { while !Task.isCancelled { try? await Task.sleep(nanoseconds: 1_000_000_000); now = Date() } }
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
    let now: Date
    let stepsShown: Bool
    let canShowSteps: Bool
    let onToggleSteps: () -> Void

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
                        ToolLine(label: t["label"] as? String ?? "", status: t["status"] as? String ?? "")
                    }
                    // What it did, drawn.
                    ForEach(Array((m["cards"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, c in ResultCard(info: c, now: now) }
                    if !text.isEmpty { NoteBodyView(text: text, open: { opener.open($0, store) }) }
                    if let e = m["error"] as? String, !e.isEmpty { T(e, 13, H.accent) }
                    // How it got there.
                    if canShowSteps, let steps = m["steps"] as? [[String: Any]], !steps.isEmpty {
                        let model = (m["model"] as? String).map { " · " + $0.replacingOccurrences(of: "opencode/", with: "") } ?? ""
                        Button(action: onToggleSteps) { T((stepsShown ? "▴" : "▾") + " Steps" + model, 11, H.faint) }
                        if stepsShown { StepList(steps: steps).transition(.opacity.combined(with: .move(edge: .top))) }
                    }
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

// A message new on screen rises in, once.
private struct Rise: ViewModifier {
    let animate: Bool
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(animate && !shown ? 0 : 1)
            .offset(y: animate && !shown ? 16 : 0)
            .onAppear { if animate { withAnimation(.easeOut(duration: 0.3)) { shown = true } } }
    }
}

// One thing the assistant did: a spinner while it works, then a tick that pops in.
private struct ToolLine: View {
    let label: String
    let status: String
    @State private var spin = false
    var body: some View {
        let done = status == "completed" || status == "error"
        HStack(spacing: 8) {
            Image(systemName: status == "completed" ? "checkmark" : status == "error" ? "xmark" : "arrow.triangle.2.circlepath")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(status == "completed" ? H.teal : status == "error" ? H.accent : H.muted)
                .rotationEffect(.degrees(!done && spin ? 360 : 0))
                .animation(done ? .default : .linear(duration: 1.2).repeatForever(autoreverses: false), value: spin)
                .contentTransition(.symbolEffect(.replace))
                .symbolEffect(.bounce, value: done)
            T(label, 13, H.muted)
        }
        .onAppear { spin = true }
    }
}

// While it works: three dots bouncing in turn, the seconds, and its steps live.
private struct Working: View {
    let current: [String: Any]?
    let now: Date
    @Binding var showSteps: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                TimelineView(.animation) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate
                    HStack(spacing: 5) {
                        ForEach(0..<3, id: \.self) { i in
                            let phase = (t - Double(i) * 0.14).truncatingRemainder(dividingBy: 1.2)
                            let y = phase < 0.22 ? -6 * phase / 0.22 : phase < 0.48 ? -6 * (1 - (phase - 0.22) / 0.26) : 0
                            Circle().fill([H.accent, H.orange, H.gold][i]).frame(width: 7, height: 7).offset(y: y)
                        }
                    }.frame(height: 14)
                }
                let secs: String = {
                    guard let started = (current?["time"] as? Double) ?? (current?["time"] as? Int).map(Double.init), started > 0 else { return "" }
                    return " \(max(0, Int((now.timeIntervalSince1970 * 1000 - started) / 1000))) s"
                }()
                T("Working" + secs, 13, H.muted)
                if current != nil {
                    Button { withAnimation(.easeOut(duration: 0.2)) { showSteps.toggle() } } label: { T((showSteps ? "▴" : "▾") + " What it's doing", 12, H.faint) }
                }
            }
            if showSteps, let steps = current?["steps"] as? [[String: Any]], !steps.isEmpty { StepList(steps: steps) }
        }
        .padding(.leading, 14)
    }
}
