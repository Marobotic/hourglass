import SwiftUI
import PhotosUI
import UIKit

// Talk to Hourglass: the assistant runs on the server (opencode) and works on
// this account's notes, schedule, alarms and timers. Each tool it uses shows as
// a line ("Set an alarm"); when it finishes, the phone syncs the changes in.
// Common requests (an alarm, a timer, a birthday) come back at once: the
// server answers those itself. The paperclip attaches pictures and files (they
// go to the Drive's "Assistant" folder).
struct Attachment: Identifiable { let id = UUID(); let name: String; let mime: String; var fileId: String?; var error: String? }
struct AssistantView: View {
    // In the Ask tab there is no back arrow and the tab bar keeps the bottom inset.
    var inTab = false
    init(inTab: Bool = false) { self.inTab = inTab }
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
    @State private var modelOpen = false
    @State private var driveOpen = false
    @State private var driveItems: [[String: Any]] = []
    @State private var driveFolder = ""
    @State private var driveCourse = ""
    @State private var mode = "auto"
    @State private var showSteps = true              // "What it's doing" under Working
    @State private var openSteps: Set<String> = []   // finished answers whose steps are shown
    @State private var now = Date()
    @State private var seen: Set<String> = []        // on screen once: later messages rise in
    @State private var ready = false
    @State private var live = false                  // the event stream is connected: no polling
    @State private var reloading = false
    @State private var editing: String?              // id of the user message being edited
    @State private var usageOpen = false
    @State private var notice: String?
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
        case "openai": return (chat["engine_name"] as? String ?? "API") + " · " + (m.isEmpty ? "pick a model" : m)
        default: return "Free · " + (short.isEmpty ? "auto" : short)
        }
    }
    private var serverBusy: Bool { chat["busy"] as? Bool ?? false }
    // The draft is kept per account, so it survives view switches and restarts.
    private var draftKey: String { "assistant_draft_" + (store.account ?? "") }
    // One cover at a time: the picker closes, then the settings open.
    private func openSettingsAfterPicker() {
        modelOpen = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { settingsOpen = true }
    }
    private func quote(_ text: String) {
        let quoted: String = text.components(separatedBy: "\n").map { "> " + $0 }.joined(separator: "\n")
        input = quoted + "\n\n" + input
        typing = true
    }
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
            if let value = c["mode"] as? String { mode = value }
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
        guard !t.isEmpty, !sending, !uploading, enabled else { return }
        // While a reply runs the message waits in the queue instead (no pending bubble).
        let wasIdle: Bool = !serverBusy
        let editId: String? = editing
        if wasIdle { pending = t; wasBusy = true }
        sending = true; editing = nil; input = ""; attachments = []
        Task {
            do {
                var result: [String: Any] = [:]
                if let editId {
                    result = try await store.assistant("POST", "/edit", ["message_id": editId, "text": t, "files": files])
                } else {
                    result = try await store.assistant("POST", "/message", ["text": t, "files": files, "mode": mode])
                }
                if (result["queued"] as? Bool) == true || (result["steer"] as? Bool) == true { pending = nil }
                if (result["quick"] as? Bool) == true { pending = nil }
            } catch { pending = nil; editing = editId; input = text; attachments = kept; problem = error.localizedDescription }
            sending = false
            await load()
        }
    }

    // Retry / Undo: one POST, then the chat is read again.
    private func act(_ path: String, _ body: [String: Any] = [:]) {
        notice = nil
        Task {
            do {
                let r = try await store.assistant("POST", path, body)
                problem = nil
                if path == "/undo" {
                    let name: String = r["name"] as? String ?? "the file"
                    notice = (r["action"] as? String) == "deleted" ? "Removed " + name : "Restored " + name
                    await store.sync()
                } else { wasBusy = true }
            } catch { problem = error.localizedDescription }
            await load()
        }
    }
    private func startEdit(_ id: String, _ text: String) {
        editing = id; input = text; typing = true
    }
    private func cancelQueued(_ id: String) {
        Task {
            do { _ = try await store.assistant("POST", "/queue/" + id, [:]) } catch { problem = error.localizedDescription }
            await load()
        }
    }

    // One stream event from the server: edit the chat, fetch the snapshot when asked.
    private func handle(_ event: String, _ data: [String: Any]) {
        if event == "state" && (data["busy"] as? Bool) == true { wasBusy = true }
        var next: [String: Any] = chat
        let needsLoad: Bool = AssistantLive.apply(event, data, to: &next)
        chat = next
        if needsLoad && !reloading {
            reloading = true
            Task { await load(); reloading = false }
        }
    }
    private func streamConnected(_ on: Bool) {
        let changed: Bool = live != on
        live = on
        if changed { Task { await load() } }
    }
    private var contextPercent: Double? {
        if let u = chat["live_usage"] as? [String: Any], let p = assistantNumber(u["context_percent"]) { return p }
        for m in messages(chat).reversed() {
            if let u = m["usage"] as? [String: Any], let p = assistantNumber(u["context_percent"]) { return p }
        }
        return nil
    }
    private var quota: [String: Any]? { chat["quota"] as? [String: Any] }
    private var queued: [[String: Any]] { chat["queue"] as? [[String: Any]] ?? [] }

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

    private func setMode(_ value: String) {
        Task { do { let d = try await store.assistantMode(value); mode = d["mode"] as? String ?? value; await load() }
            catch { problem = error.localizedDescription } }
    }
    private func loadDrive(_ folder: String = "", _ course: String = "") {
        driveFolder = folder; driveCourse = course
        var args: [String: Any] = [:]
        if !course.isEmpty { args["course_id"] = course } else if !folder.isEmpty { args["folder_id"] = folder }
        Task { do {
            let d = try await store.assistantAction("list_drive", args)
            // Typed one list at a time: as one expression it is too slow for the type checker.
            let courses: [[String: Any]] = (d["courses"] as? [[String: Any]] ?? []).map { ["kind": "course", "id": $0["id"] ?? "", "name": $0["name"] ?? ""] }
            let folders: [[String: Any]] = (d["folders"] as? [[String: Any]] ?? []).map { ["kind": "folder", "id": $0["id"] ?? "", "name": $0["name"] ?? ""] }
            let files: [[String: Any]] = (d["files"] as? [[String: Any]] ?? []).map { ["kind": "file", "id": $0["id"] ?? "", "name": $0["name"] ?? "file", "mime": $0["mime"] ?? ""] }
            driveItems = courses + folders + files
        } catch { problem = error.localizedDescription } }
    }
    private func attachDrive(_ item: [String: Any]) {
        guard let id = item["id"] as? String, !attachments.contains(where: { $0.fileId == id }) else { return }
        attachments.append(Attachment(name: item["name"] as? String ?? "file", mime: item["mime"] as? String ?? "", fileId: id))
        driveOpen = false
    }

    // Retry / Edit / Undo in the long-press menu: only when no reply is running.
    private func actions(for i: Int, _ m: [String: Any]) -> MessageActions {
        var a = MessageActions()
        let id: String = m["id"] as? String ?? ""
        let list: [[String: Any]] = messages(chat)
        guard !serverBusy, id != "pending", i < list.count else { return a }
        if m["role"] as? String == "user" {
            let text: String = m["text"] as? String ?? ""
            a.canEdit = true
            a.onEdit = { startEdit(id, text) }
        } else if i == list.count - 1 {
            let cards: [[String: Any]] = m["cards"] as? [[String: Any]] ?? []
            a.canRetry = true
            a.onRetry = { act("/retry", ["message_id": id]) }
            a.canUndo = cards.contains { ($0["kind"] as? String) == "file" && !["read", "undone"].contains($0["state"] as? String ?? "") }
            a.onUndo = { act("/undo") }
        }
        return a
    }

    // Messages waiting for the running reply: greyed, with a cancel.
    @ViewBuilder private var queueRows: some View {
        ForEach(0..<queued.count, id: \.self) { i in queueRow(queued[i]) }
    }
    private func queueRow(_ q: [String: Any]) -> some View {
        let id: String = q["id"] as? String ?? ""
        let text: String = q["text"] as? String ?? ""
        let steer: Bool = ["anthropic", "openai"].contains(chat["engine"] as? String ?? "")
        return VStack(alignment: .trailing, spacing: 6) {
            HStack(spacing: 0) {
                Spacer(minLength: 60)
                T(text, 14, H.muted)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(H.surface).overlay(Rectangle().strokeBorder(H.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            // Metro's tag: gold "Queued · after this reply", Send now (engines that take a steer), and a cancel.
            HStack(spacing: 8) {
                T("Queued · after this reply", 12, H.gold)
                if steer {
                    Button {
                        cancelQueued(id)
                        Task { _ = try? await store.assistant("POST", "/message", ["text": text, "steer": true]); await load() }
                    } label: {
                        T("Send now", 12, H.fg).padding(.horizontal, 8).padding(.vertical, 2)
                            .background(H.accent.opacity(0.14)).overlay(Rectangle().strokeBorder(H.accent.opacity(0.6), lineWidth: 1))
                    }.buttonStyle(.plain)
                }
                Button { cancelQueued(id) } label: {
                    Image(systemName: "xmark").font(.system(size: 10)).foregroundStyle(H.muted).frame(width: 24, height: 24)
                }.buttonStyle(.plain)
            }
            .padding(.leading, 8)
            .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private static let modes: [(String, String)] = [("ask", "Ask"), ("auto", "Auto"), ("plan", "Plan"), ("dangerous", "Dangerous")]
    private var effortSuffix: String { (chat["effort"] as? String).map { " · " + $0 } ?? "" }

    // The model chip and the permission modes (as on the desktop assistant).
    private var modeBar: some View {
        let modeInk: Color = mode == "dangerous" ? H.accentInk : mode == "plan" ? H.teal : H.muted
        let modelName: String = engineLabel.components(separatedBy: " · ").last ?? engineLabel
        return HStack(spacing: 8) {
            if mode == "dangerous" { T("Changes apply without asking", 12, H.accentInk, lines: 1) }
            else if mode == "plan" { T("Reads and plans, changes nothing", 12, H.teal, lines: 1) }
            else if let p = contextPercent { Button { usageOpen = true } label: { ContextMeter(percent: p) }.buttonStyle(.plain) }
            Spacer(minLength: 0)
            Button { modelOpen = true } label: {
                HStack(spacing: 6) { T(modelName + effortSuffix, 13, H.soft, weight: .medium, lines: 1); Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(H.muted) }
                    .padding(.horizontal, 10).frame(height: 36).background(H.bg).overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
            }.buttonStyle(PressStyle())
            Menu {
                ForEach(Self.modes, id: \.0) { pair in
                    Button { setMode(pair.0) } label: { if mode == pair.0 { Label(pair.1, systemImage: "checkmark") } else { Text(pair.1) } }
                }
            } label: {
                HStack(spacing: 6) { T(mode.capitalized, 13, modeInk, weight: .medium, lines: 1); Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(H.muted) }
                    .padding(.horizontal, 10).frame(height: 36).background(H.bg).overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
            }
            .disabled(serverBusy)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }
    private func modeChip(_ value: String, _ title: String) -> some View {
        let on: Bool = mode == value
        let danger: Bool = value == "dangerous"
        let ink: Color = on && danger ? Color.white : on ? H.accent : H.muted
        let fill: Color = on && danger ? H.accent : Color.clear
        return Button { setMode(value) } label: {
            T(title, 12, ink, bold: on)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(fill)
                .overlay(Rectangle().strokeBorder(on ? H.accent : H.border, lineWidth: 1))
        }.disabled(serverBusy)
    }

    private var editBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "pencil").font(.system(size: 12)).foregroundStyle(H.accent)
            T("Editing a message: sending reruns the chat from here", 12, H.muted, lines: 1)
            Spacer(minLength: 0)
            Button { editing = nil; input = "" } label: { Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(H.muted) }
        }.padding(.horizontal, 14).padding(.top, 4)
    }

    // The message box stays usable while a reply runs: what is sent then is queued.
    private var composerPrompt: String {
        if !enabled { return "The assistant is off" }
        if serverBusy { return ["anthropic", "openai"].contains(chat["engine"] as? String ?? "") ? "Steer the running answer…" : "Queue a message for after this reply…" }
        return "Ask Hourglass…"
    }
    // The composer (Metro): one surface box with + (files, photos, Drive), the text, and a 42 square send that
    // becomes Stop while it works.
    private var composer: some View {
        HStack(alignment: .bottom, spacing: 6) {
            Menu {
                Button { importing = true } label: { Label("Files", systemImage: "doc") }
                PhotosPicker(selection: $photoItems, matching: .images) { Label("Photos", systemImage: "photo") }
                Button { driveOpen = true; loadDrive() } label: { Label("From your Drive", systemImage: "externaldrive") }
            } label: { Image(systemName: "plus").font(.system(size: 18)).foregroundStyle(H.muted).frame(width: 36, height: 42) }
            .disabled(!enabled)
            TextField("", text: $input, prompt: Text(composerPrompt).foregroundStyle(H.faint), axis: .vertical)
                .lineLimit(1...6)
                .focused($typing)
                .font(H.ui(14)).foregroundStyle(H.fg).tint(H.accent)
                .padding(.horizontal, 4).padding(.vertical, 10)
                .disabled(!enabled)
            actionButton
        }
        .padding(6)
        .background(H.surface).overlay(Rectangle().strokeBorder(typing ? H.faint : H.border, lineWidth: 1))
        .padding(.horizontal, 16).padding(.top, 8)
    }
    @ViewBuilder private var actionButton: some View {
        let hasContent: Bool = !input.trimmingCharacters(in: .whitespaces).isEmpty || attachments.contains { $0.fileId != nil }
        let stopping: Bool = serverBusy && !hasContent
        let canSend: Bool = enabled && !uploading && !sending && hasContent
        Button {
            if stopping { Task { _ = try? await store.assistant("POST", "/stop"); await load() } } else { send(input) }
        } label: {
            Image(systemName: stopping ? "stop.fill" : "arrow.right").font(.system(size: 15, weight: .semibold)).foregroundStyle(H.fg)
                .frame(width: 42, height: 42)
                .background(stopping ? H.surface3 : H.accent.opacity(canSend ? 1 : 0.45))
                .overlay(Rectangle().strokeBorder(stopping ? H.faint : Color.clear, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
        .disabled(!stopping && !canSend)
    }

    // Metro's chat head: the glyph, "Assistant", engine · model · effort (never just the model), a state chip.
    private var stateWord: String {
        if !enabled { return "off" }
        if serverBusy { return "working" }
        if !((chat["queue"] as? [Any]) ?? []).isEmpty { return "queued" }
        if quota != nil { return "limit" }
        return "idle"
    }
    private var chatHead: some View {
        let st: String = stateWord
        let ink: Color = st == "working" ? H.accentInk : (st == "queued" || st == "limit") ? H.gold : H.muted
        let canNew: Bool = !shown.isEmpty && !busy
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                if !inTab {
                    Button { dismiss() } label: { Image(systemName: "arrow.left").font(.system(size: 18, weight: .medium)).foregroundStyle(H.fg).frame(width: 44, height: 44).contentShape(Rectangle()) }
                        .buttonStyle(PressStyle())
                }
                Button { settingsOpen = true } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        T("Assistant", 18, bold: true, lines: 1)
                        T(engineLabel + effortSuffix + " · " + mode, 12, H.muted, lines: 1)
                    }
                }
                .buttonStyle(.plain)
                .layoutPriority(1)
                Spacer(minLength: 0)
                // Puts the keyboard away (dragging the list down does too).
                if typing {
                    Button { typing = false } label: { Image(systemName: "keyboard.chevron.compact.down").font(.system(size: 16)).foregroundStyle(H.muted).frame(width: 44, height: 44) }
                }
                HStack(spacing: 6) {
                    if st == "working" { Rectangle().fill(H.accentInk).frame(width: 6, height: 6) }
                    Text(st.uppercased()).font(H.ui(12, .bold)).tracking(1).lineLimit(1)
                }
                .foregroundStyle(ink)
                .padding(.horizontal, 8).frame(height: 20)
                .background(st == "working" ? H.accent.opacity(0.18) : H.surface3)
                .fixedSize()
                Menu {
                    Button { Task { _ = try? await store.assistant("POST", "/new"); pending = nil; await load() } } label: { Label("New chat", systemImage: "plus") }
                        .disabled(!canNew)
                    Button { settingsOpen = true } label: { Label("Assistant settings", systemImage: "gearshape") }
                    Button { usageOpen = true } label: { Label("Usage", systemImage: "chart.bar") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium)).foregroundStyle(H.muted).frame(width: 44, height: 44).contentShape(Rectangle())
                }
            }
            .padding(.leading, inTab ? 16 : 4).padding(.trailing, 4).frame(height: 56)
            Rectangle().fill(H.border).frame(height: 1)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            chatHead

            if shown.isEmpty {
                // Scrolls when the keyboard leaves less room than it needs; otherwise
                // centred. Without this the page overflowed with the keyboard up: the
                // header went off the top and the message box under the keyboard.
                GeometryReader { geo in
                ScrollView {
                VStack(spacing: 12) {
                    PixelLogo(cell: 5)
                    T(enabled ? "Ask Hourglass to do it for you" : (chat["reason"] as? String ?? "The assistant is not available."), 18, bold: true)
                        .multilineTextAlignment(.center)
                    if enabled {
                        T("It can read and change your notes, schedule, alarms, timers and Drive.", 13, H.muted).multilineTextAlignment(.center)
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                            ForEach(Self.suggestions, id: \.self) { s in
                                Button { send(s) } label: {
                                    T(s, 13, lines: 2).multilineTextAlignment(.leading).frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                                        .padding(.horizontal, 12).overlay(Rectangle().strokeBorder(H.border, lineWidth: 1)).contentShape(Rectangle())
                                }.buttonStyle(PressStyle())
                            }
                        }.padding(.top, 8)
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
                                        onAction: { id, decision in Task { do { _ = try await store.assistantActionDecision(id, decision); await load() } catch { problem = error.localizedDescription } } },
                                        onToggleSteps: { withAnimation(.easeOut(duration: 0.2)) { if openSteps.contains(k) { openSteps.remove(k) } else { openSteps.insert(k) } } },
                                        onQuote: quote, actions: actions(for: i, m))
                                    .modifier(Rise(animate: ready && !seen.contains(k)))
                                    .onAppear { seen.insert(k) }
                                    .id(k)
                            }
                            queueRows
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
            if let notice { T(notice, 12, H.teal).padding(.horizontal, 16).padding(.vertical, 2) }
            if let quota { T(quotaLine(quota), 12, H.faint).padding(.horizontal, 16).padding(.vertical, 2) }

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

            if editing != nil { editBar }
            composer
            modeBar
        }
        .background(H.bg)
        .toolbar(.hidden, for: .navigationBar)
        .quickLookPreview($opener.url)
        .fullScreenCover(item: $opener.viewing) { set in MediaViewer(set: set, opener: opener).environmentObject(store) }
        .fullScreenCover(isPresented: $settingsOpen) { AssistantSettingsSheet(onSaved: { Task { await load() } }).environmentObject(store) }
        .modifier(PickerAndDraft(modelOpen: $modelOpen, usageOpen: $usageOpen, input: $input, draftKey: draftKey,
                                 onPicked: { Task { await load() } }, onChangeAI: openSettingsAfterPicker))
        .sheet(isPresented: $driveOpen) {
            NavigationStack {
                List {
                    if !driveFolder.isEmpty || !driveCourse.isEmpty { Button("← Drive root") { loadDrive() } }
                    ForEach(Array(driveItems.enumerated()), id: \.offset) { _, item in
                        Button { let kind = item["kind"] as? String ?? "file"; if kind == "file" { attachDrive(item) } else if kind == "course" { loadDrive("", item["id"] as? String ?? "") } else { loadDrive(item["id"] as? String ?? "", "") } } label: {
                            Label(item["name"] as? String ?? "File", systemImage: (item["kind"] as? String) == "file" ? "doc" : "folder")
                        }
                    }
                }.navigationTitle(driveCourse.isEmpty ? "Choose a Drive file" : "Course Drive")
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { driveOpen = false } } }
            }.preferredColorScheme(.dark)
        }
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
        // Poll quickly while it works, slowly otherwise; not at all while the stream is connected.
        .task(id: busy) {
            while !Task.isCancelled {
                if !live { await load() }
                try? await Task.sleep(nanoseconds: busy ? 900_000_000 : 15_000_000_000)
            }
        }
        .modifier(LiveStream(onConnected: { on in streamConnected(on) }, onEvent: { name, data in handle(name, data) }))
    }
}

// What the long-press menu of one message offers besides Copy.
private struct MessageActions {
    var canRetry = false
    var canEdit = false
    var canUndo = false
    var onRetry: () -> Void = {}
    var onEdit: () -> Void = {}
    var onUndo: () -> Void = {}
}

private struct Message: View {
    @EnvironmentObject var store: Store
    let m: [String: Any]
    let opener: FileOpener
    let now: Date
    let stepsShown: Bool
    let canShowSteps: Bool
    let onAction: (String, String) -> Void
    let onToggleSteps: () -> Void
    let onQuote: (String) -> Void
    let actions: MessageActions

    // The text without Markdown marks, for a plain Copy.
    static func plain(_ text: String) -> String {
        var out = text
        let rules: [(String, String)] = [
            (#"(?m)^\s*```.*\n?"#, ""),
            (#"\*\*(.+?)\*\*"#, "$1"),
            (#"~~(.+?)~~"#, "$1"),
            (#"</?u>"#, ""),
            (#"(?m)^#{1,6} "#, ""),
            (#"\[([^\]]+)\]\([^)]+\)"#, "$1"),
        ]
        for (pattern, template) in rules {
            out = out.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Long-press menu on a message.
    @ViewBuilder private func copyMenu(_ text: String) -> some View {
        Button { UIPasteboard.general.string = Self.plain(text) } label: { Label("Copy", systemImage: "doc.on.doc") }
        Button { UIPasteboard.general.string = text } label: { Label("Copy as Markdown", systemImage: "text.alignleft") }
        Button { onQuote(text) } label: { Label("Quote in reply", systemImage: "arrowshape.turn.up.left") }
        if actions.canEdit { Button { actions.onEdit() } label: { Label("Edit and resend", systemImage: "pencil") } }
        if actions.canRetry { Button { actions.onRetry() } label: { Label("Retry", systemImage: "arrow.clockwise") } }
        if actions.canUndo { Button { actions.onUndo() } label: { Label("Undo last file change", systemImage: "arrow.uturn.backward") } }
    }

    // "120 in · 45 out  ·  300 cached  ·  $0.0012  ·  3.5% context"; "" when there is nothing to say.
    static func usageCaption(_ usage: [String: Any]) -> String {
        let input = usage["input_tokens"] as? Int
        let output = usage["output_tokens"] as? Int
        let cached = (usage["cache_read_input_tokens"] as? Int ?? 0) + (usage["cache_creation_input_tokens"] as? Int ?? 0)
        var parts: [String] = []
        if input != nil || output != nil { parts.append("\(input ?? 0) in · \(output ?? 0) out") }
        if cached > 0 { parts.append("\(cached) cached") }
        if let cost = usage["cost"] as? Double { parts.append(String(format: "$%.4f", cost)) }
        if let percent = usage["context_percent"] as? Double { parts.append(String(format: "%.1f", percent).replacingOccurrences(of: "\\.0$", with: "", options: .regularExpression) + "% context") }
        return parts.joined(separator: "  ·  ")
    }

    var body: some View {
        let text = m["text"] as? String ?? ""
        if m["role"] as? String == "user" {
            VStack(alignment: .trailing, spacing: 6) {
                ForEach(Array((m["files"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, f in
                    AttachmentChip(name: f["name"] as? String ?? "file", mime: f["mime"] as? String ?? "", note: nil, onRemove: nil)
                        .onTapGesture { if let id = f["id"] as? String, let row = store.file(id) { opener.open(row, store) } }
                }
                HStack {
                    Spacer(minLength: 60)
                    T(text, 14)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(H.surface3).overlay(alignment: .top) { H.hi.frame(height: 1) }.overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
                        .contextMenu { copyMenu(text) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array((m["tools"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, t in
                        ToolRow(tool: t)
                    }
                    // What it did, drawn.
                    ForEach(Array((m["cards"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, c in
                        let kind = c["kind"] as? String ?? ""
                        if kind == "action" { AssistantActionCard(info: c, onAction: onAction) }
                        else if kind == "file" { AssistantFileCard(info: c) }
                        else { ResultCard(info: c, now: now) }
                    }
                    if !text.isEmpty { NoteBodyView(text: text, open: { opener.open($0, store) }) }
                    if let usage = m["usage"] as? [String: Any], !Self.usageCaption(usage).isEmpty {
                        T(Self.usageCaption(usage), 12, H.faint)
                    }
                    if let e = m["error"] as? String, !e.isEmpty { T(e, 13, H.accent) }
                    // How it got there.
                    if canShowSteps, let steps = m["steps"] as? [[String: Any]], !steps.isEmpty {
                        let model = (m["model"] as? String).map { " · " + $0.replacingOccurrences(of: "opencode/", with: "") } ?? ""
                        Button(action: onToggleSteps) { T((stepsShown ? "▾ " : "▸ ") + "Thought it through" + model, 12, H.muted) }
                        if stepsShown { StepList(steps: steps).transition(.opacity.combined(with: .move(edge: .top))) }
                    }
                }
                .padding(.vertical, 4)
                .contextMenu { if !text.isEmpty || actions.canUndo { copyMenu(text) } }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// Kept out of AssistantView.body so the compiler can type-check that chain in time.
private struct PickerAndDraft: ViewModifier {
    @EnvironmentObject var store: Store
    @Binding var modelOpen: Bool
    @Binding var usageOpen: Bool
    @Binding var input: String
    let draftKey: String
    let onPicked: () -> Void
    let onChangeAI: () -> Void

    func body(content: Content) -> some View {
        content
            .fullScreenCover(isPresented: $modelOpen) {
                ModelPickerSheet(onPicked: onPicked, onChangeAI: onChangeAI).environmentObject(store)
            }
            .fullScreenCover(isPresented: $usageOpen) { AssistantUsageSheet().environmentObject(store) }
            .onAppear { if input.isEmpty { input = UserDefaults.standard.string(forKey: draftKey) ?? "" } }
            .onChange(of: input) { _, value in
                if value.isEmpty { UserDefaults.standard.removeObject(forKey: draftKey) } else { UserDefaults.standard.set(value, forKey: draftKey) }
            }
    }
}

// The live stream while the app is in front; it reconnects by itself with a
// growing wait, and polling in AssistantView stops while it is connected.
private struct LiveStream: ViewModifier {
    @EnvironmentObject var store: Store
    @Environment(\.scenePhase) private var scenePhase
    let onConnected: @MainActor (Bool) -> Void
    let onEvent: @MainActor (String, [String: Any]) -> Void

    func body(content: Content) -> some View {
        content.task(id: scenePhase) {
            if scenePhase == .active {
                await runAssistantStream(store: store, connected: onConnected, event: onEvent)
            } else {
                onConnected(false)
            }
        }
    }
}

// The model chip's page: pick the model for the current engine without going
// into the AI settings. Same lists as there (GET /models for the engine).
private struct ModelPickerSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let onPicked: () -> Void
    let onChangeAI: () -> Void

    @State private var settings: [String: Any] = [:]
    @State private var choices: [[String: Any]] = []
    @State private var problem = ""
    @State private var query = ""
    @State private var loading = true
    @State private var saving = false

    private var engine: String { settings["engine"] as? String ?? "free" }
    private var currentModel: String { settings["model"] as? String ?? "" }
    // The efforts the selected model takes (empty when it cannot take one) and the saved one.
    private var efforts: [String] {
        let match: [String: Any]? = choices.first { ($0["id"] as? String) == currentModel }
        return match?["efforts"] as? [String] ?? []
    }
    private var currentEffort: String { settings["effort"] as? String ?? "" }
    private var filtered: [[String: Any]] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return choices }
        return choices.filter { c in
            let name: String = (c["name"] as? String ?? "").lowercased()
            let id: String = (c["id"] as? String ?? "").lowercased()
            return name.contains(q) || id.contains(q)
        }
    }

    private func load() async {
        loading = true
        do {
            let cfg = try await store.assistant("GET", "/settings")
            let kind: String = cfg["engine"] as? String ?? "free"
            let base: String = (cfg["base_url"] as? String ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            let suffix: String = kind == "openai" ? "?base_url=" + base : "?engine=" + kind
            let result = try await store.assistant("GET", "/models" + suffix)
            settings = cfg
            choices = result["models"] as? [[String: Any]] ?? []
            problem = result["error"] as? String ?? ""
        } catch { problem = error.localizedDescription }
        loading = false
    }

    private func save(_ changes: [String: Any], thenClose: Bool) {
        var body: [String: Any] = ["engine": engine]
        if engine == "openai" { body["base_url"] = settings["base_url"] ?? "" }
        for (k, v) in changes { body[k] = v }
        saving = true
        Task {
            do {
                _ = try await store.assistant("POST", "/settings", body)
                onPicked()
                await load()
                // A model with efforts stays open so its effort can be chosen.
                if thenClose && efforts.isEmpty { dismiss() }
            } catch { problem = error.localizedDescription }
            saving = false
        }
    }
    private func pick(_ id: String) { save(["model": id], thenClose: true) }
    private func pickEffort(_ level: String) { save(["model": currentModel, "effort": level], thenClose: false) }

    private var effortBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("EFFORT").font(H.ui(12)).tracking(1).foregroundStyle(H.muted)
            HStack(spacing: 6) {
                ForEach(efforts, id: \.self) { level in effortChip(level) }
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 6)
    }
    private func effortChip(_ level: String) -> some View {
        let on: Bool = level == currentEffort
        return Button { pickEffort(level) } label: {
            T(level.capitalized, 12, on ? H.accent : H.muted, bold: on)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(on ? H.surface2 : Color.clear)
                .overlay(Rectangle().strokeBorder(on ? H.accent : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    private func row(_ choice: [String: Any]) -> some View {
        let id: String = choice["id"] as? String ?? ""
        let name: String = choice["name"] as? String ?? id
        let on: Bool = id == currentModel
        return Button { pick(id) } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 1) {
                    T(name, 14, on ? H.accent : H.fg, bold: on, lines: 1)
                    if name != id { T(id, 12, H.faint, lines: 1) }
                }
                Spacer(minLength: 0)
                if on { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(H.accent) }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(on ? H.surface2 : Color.clear)
            .overlay(Rectangle().strokeBorder(on ? H.accent : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    private var searchBox: some View {
        TextField("", text: $query, prompt: Text("Search models").foregroundStyle(H.faint))
            .font(H.ui(14)).foregroundStyle(H.fg).tint(H.accent)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(10).background(H.surface).overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    searchBox
                    if !efforts.isEmpty { effortBar }
                    if !problem.isEmpty { T(problem, 12, H.accent) }
                    if loading && choices.isEmpty { T("Loading models…", 13, H.muted) }
                    if !loading && filtered.isEmpty && problem.isEmpty { T("No models match.", 13, H.muted) }
                    ForEach(filtered.indices, id: \.self) { i in row(filtered[i]) }
                    HButton("Change AI…") { onChangeAI() }.padding(.top, 8)
                }
                .padding(18)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(H.bg)
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("← Back") { dismiss() }.keyboardShortcut(.cancelAction).foregroundStyle(H.muted) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(loading).foregroundStyle(H.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }
}

private struct AssistantActionCard: View {
    let info: [String: Any]
    let onAction: (String, String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            T(info["summary"] as? String ?? "Action", 12, H.fg)
            if (info["status"] as? String) == "pending" {
                HStack(spacing: 8) {
                    HButton("Apply", primary: true) { onAction(info["id"] as? String ?? "", "apply") }
                    HButton("Skip") { onAction(info["id"] as? String ?? "", "skip") }
                }
            } else { T((info["status"] as? String ?? "").uppercased(), 12, H.muted) }
        }.padding(10).background(H.surface).overlay(Rectangle().strokeBorder((info["status"] as? String) == "pending" ? H.accent : H.border, lineWidth: 1))
    }
}

private struct AssistantFileCard: View {
    let info: [String: Any]
    var body: some View {
        let state = info["state"] as? String ?? "changed"
        let label = info["label"] as? String ?? "Drive file"
        let title = state == "read" ? "Read" : state == "created" ? "Created" : state == "deleted" ? "Deleted" : "Changed"
        AttachmentChip(name: label, mime: "application/octet-stream", note: title + " · " + fmtBytes(info["size"]), onRemove: nil)
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
                if let note { T(note, 12, note == "Uploading…" ? H.muted : H.accent, lines: 1) }
            }
            if let onRemove { Button(action: onRemove) { Image(systemName: "xmark").font(.system(size: 12)).foregroundStyle(H.muted) } }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: 260, alignment: .leading)
        .background(H.surface2)
        .overlay(Rectangle().strokeBorder(note != nil && note != "Uploading…" ? H.accent : H.border, lineWidth: 1))
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
struct ToolLine: View {
    let label: String
    let status: String
    @State private var pulse = false
    var body: some View {
        let done: Bool = status == "completed" || status == "error"
        HStack(spacing: 8) {
            Text(status == "completed" ? "✓" : status == "error" ? "✕" : "●")
                .font(H.ui(13, bold: true))
                .foregroundStyle(status == "completed" ? H.teal : H.accentInk)
                .frame(width: 14)
                .opacity(!done && pulse ? 0.35 : 1)
                .animation(done || !HMotion.allowed ? nil : .easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulse)
            T(label, 13, status == "error" ? H.accentInk : H.fg, lines: 1)
        }
        .onAppear { pulse = true }
    }
}

// While it works: three dots bouncing in turn, the seconds, and its steps live.
private struct Working: View {
    let current: [String: Any]?
    let now: Date
    @Binding var showSteps: Bool
    var body: some View {
        let tools = current?["tools"] as? [[String: Any]] ?? []
        let running = tools.reversed().first { ($0["status"] as? String) == "running" }
        let toolName = (running?["tool"] as? String ?? "").lowercased()
        let verb = toolName.range(of: "read|get|list", options: .regularExpression) != nil ? "Reading" : toolName.range(of: "search|find", options: .regularExpression) != nil ? "Searching" : toolName.range(of: "edit|write|move|add|update|set|remove|delete|restore", options: .regularExpression) != nil ? "Editing" : running == nil ? "Simmering" : "Running"
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Spark()
                let secs: String = {
                    guard let started = (current?["time"] as? Double) ?? (current?["time"] as? Int).map(Double.init), started > 0 else { return "" }
                    return " \(max(0, Int((now.timeIntervalSince1970 * 1000 - started) / 1000))) s"
                }()
                T(verb + "…", 13, H.accentInk)
                if !secs.isEmpty { T(secs.trimmingCharacters(in: .whitespaces), 12, H.faint) }
                if current != nil {
                    Button { withAnimation(.easeOut(duration: 0.2)) { showSteps.toggle() } } label: { T(showSteps ? "▾ Hide steps" : "▸ What it's doing", 12, H.faint) }
                }
            }
            if showSteps, let steps = current?["steps"] as? [[String: Any]], !steps.isEmpty { StepList(steps: steps) }
        }
    }
}

// Metro's spark: the glyph steps through its frames and shimmers while a turn runs (still under Reduce Motion).
struct Spark: View {
    private static let frames = ["·", "✢", "✳", "✶", "✻", "✽", "✻"]
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.17)) { tl in
            let t: Double = tl.date.timeIntervalSinceReferenceDate
            let i: Int = HMotion.allowed ? Int(t / 0.17) % Self.frames.count : 4
            let glow: Double = HMotion.allowed ? (sin(t * .pi) + 1) / 2 : 0
            Text(Self.frames[i]).font(H.ui(13, bold: true)).foregroundStyle(H.accentInk.opacity(1 - glow * 0.35)).frame(width: 14)
        }
    }
}
