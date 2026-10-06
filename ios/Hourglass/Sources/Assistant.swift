import SwiftUI

// Talk to Hourglass: the assistant runs on the server (opencode) and works on
// this account's notes, schedule, alarms and timers. Each tool it uses shows as
// a line ("Set an alarm"); when it finishes, the phone syncs the changes in.
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

    private static let suggestions = ["What's on today?", "Tidy up my latest note", "Wake me at 7:30 on weekdays", "Start a 25 minute timer"]

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
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !busy, enabled else { return }
        pending = t; sending = true; wasBusy = true; input = ""
        Task {
            do { _ = try await store.assistant("POST", "/message", ["text": t]) }
            catch { pending = nil; input = t; problem = error.localizedDescription }
            sending = false
            await load()
        }
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

            // The message box
            HStack(alignment: .bottom, spacing: 8) {
                TextField("", text: $input, prompt: Text(busy ? "Working on it…" : "Ask Hourglass…").foregroundStyle(H.faint), axis: .vertical)
                    .lineLimit(1...6)
                    .font(H.mono(15)).foregroundStyle(H.fg).tint(H.accent)
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    .disabled(!enabled)
                if busy {
                    HButton("", icon: "stop.fill") { Task { _ = try? await store.assistant("POST", "/stop"); await load() } }
                } else {
                    HButton("", icon: "paperplane.fill", primary: true, enabled: enabled && !input.trimmingCharacters(in: .whitespaces).isEmpty) { send(input) }
                }
            }
            .padding(12)
        }
        .background(H.bg)
        .toolbar(.hidden, for: .navigationBar)
        .quickLookPreview($opener.url)
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
            HStack {
                Spacer(minLength: 48)
                T(text, 15)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(H.surface2).overlay(Rectangle().stroke(H.border, lineWidth: 1))
            }
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
