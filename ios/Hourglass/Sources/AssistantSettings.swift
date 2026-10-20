import SwiftUI

// Which AI answers in the assistant (as on the desktop, AssistantSettings.qml):
// opencode's free models, Claude with the user's plan or API key, or another
// OpenAI-compatible API. A key goes to the server once, stored encrypted there.
struct AssistantSettingsSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    var onSaved: () -> Void

    @State private var s: [String: Any]?
    @State private var engine = "free"
    @State private var model = ""
    @State private var baseUrl = ""
    @State private var apiModels: [String] = []
    @State private var key = ""
    @State private var code = ""
    @State private var signin = "" // "", starting, waiting, finishing
    @State private var pasteToken = false
    @State private var error = ""
    @State private var note = ""
    @State private var saving = false

    private func list(_ k: String) -> [[String: Any]] { s?[k] as? [[String: Any]] ?? [] }
    private var hasKey: Bool { ((s?["has_key"] as? [String: Any])?[engine == "openai" ? "openai:" + baseUrl : engine] as? Bool) ?? false }
    private var claudeReady: Bool { s?["claude_ready"] as? Bool ?? false }
    private var options: [(String, String)] {
        switch engine {
        case "free": return list("free_models").map { ($0["name"] as? String ?? "", $0["id"] as? String ?? "") }
        case "anthropic", "claude": return list("claude_models").map { ("\($0["name"] as? String ?? "")  · \($0["note"] as? String ?? "")", $0["id"] as? String ?? "") }
        default: return apiModels.map { ($0, $0) }
        }
    }
    private var current: String { model.isEmpty ? (options.first?.1 ?? "") : model }

    private func load() async {
        do {
            let d = try await store.assistant("GET", "/settings")
            s = d
            engine = d["engine"] as? String ?? "free"
            model = d["model"] as? String ?? ""
            baseUrl = (d["base_url"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (list("presets").first?["base_url"] as? String ?? "")
            if engine == "openai" { await loadModels() }
        } catch { self.error = error.localizedDescription }
    }
    private func loadModels() async {
        apiModels = []
        let enc = baseUrl.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        if let d = try? await store.assistant("GET", "/models?base_url=" + enc) {
            apiModels = (d["models"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String }
            if let e = d["error"] as? String, !e.isEmpty, hasKey { note = e }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    T("Pick who answers. Keys are stored encrypted on your account.", 12, H.muted)
                    ForEach(Array(list("engines").enumerated()), id: \.offset) { _, e in
                        let id = e["id"] as? String ?? ""
                        let on = engine == id
                        Button {
                            guard !on else { return }
                            engine = id; model = ""; error = ""; note = ""; key = ""
                            if id == "openai" { Task { await loadModels() } }
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    Rectangle().stroke(on ? H.accent : H.muted, lineWidth: 2).frame(width: 14, height: 14)
                                    if on { Rectangle().fill(H.accent).frame(width: 6, height: 6) }
                                }
                                VStack(alignment: .leading, spacing: 1) {
                                    T(e["name"] as? String ?? "", 14, bold: on)
                                    T(e["note"] as? String ?? "", 12, H.muted)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(on ? H.surface2 : .clear)
                            .overlay(Rectangle().stroke(on ? H.accent : H.border, lineWidth: 1))
                        }
                        .animation(.easeOut(duration: 0.15), value: engine)
                    }

                    if engine == "openai" {
                        label("API")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(Array(list("presets").enumerated()), id: \.offset) { _, p in
                                    let url = p["base_url"] as? String ?? ""
                                    Button { baseUrl = url; model = ""; Task { await loadModels() } } label: {
                                        T(p["name"] as? String ?? "", 12, baseUrl == url ? H.fg : H.muted)
                                            .padding(.horizontal, 10).padding(.vertical, 6)
                                            .overlay(Rectangle().stroke(baseUrl == url ? H.accent : H.border, lineWidth: 1))
                                    }
                                }
                            }
                        }
                        field("https://…/v1", text: $baseUrl).onSubmit { model = ""; Task { await loadModels() } }
                    }

                    if engine == "claude" {
                        HStack(spacing: 10) {
                            HButton(signin == "starting" ? "Opening…" : hasKey ? "Sign in again" : "Sign in with Claude", primary: !hasKey, enabled: signin.isEmpty && claudeReady) {
                                error = ""; note = ""; signin = "starting"
                                Task {
                                    do {
                                        let d = try await store.assistant("POST", "/claude/login")
                                        signin = "waiting"
                                        if let u = URL(string: d["url"] as? String ?? "") { openURL(u) }
                                    } catch { signin = ""; self.error = error.localizedDescription }
                                }
                            }
                            if hasKey && signin.isEmpty { T("✓ Connected", 12, H.teal) }
                        }
                        if signin == "waiting" || signin == "finishing" {
                            T("Sign in on the page that opened and press Authorize. Claude then shows a code: copy it and paste it here.", 12, H.muted)
                            field("Paste the code from claude.com", text: $code)
                            HButton(signin == "finishing" ? "Finishing…" : "Finish", primary: true, enabled: signin == "waiting" && !code.trimmingCharacters(in: .whitespaces).isEmpty) {
                                error = ""; signin = "finishing"
                                Task {
                                    do {
                                        let d = try await store.assistant("POST", "/claude/login/code", ["code": code.trimmingCharacters(in: .whitespaces)])
                                        signin = ""; code = ""
                                        s?["has_key"] = d["has_key"]
                                        note = "Signed in with your Claude account ✓"
                                    } catch { signin = ""; self.error = error.localizedDescription }
                                }
                            }
                        }
                        if signin.isEmpty {
                            Button { pasteToken.toggle() } label: { T(pasteToken ? "▴ Paste a token instead" : "▾ Or paste a token from claude setup-token", 11, H.faint) }
                        }
                        if !claudeReady { T("Claude Code isn't installed on the server yet: this choice will work once it is.", 12, H.gold) }
                    }

                    if engine != "free" && (engine != "claude" || pasteToken) {
                        label(engine == "claude" ? "CLAUDE TOKEN" : "API KEY")
                        SecureField("", text: $key, prompt: Text(hasKey ? "Saved ✓ (paste a new one to replace it)" : engine == "anthropic" ? "sk-ant-api…" : engine == "claude" ? "sk-ant-oat…" : "Your API key").foregroundStyle(H.faint))
                            .font(H.mono(14)).foregroundStyle(H.fg).padding(10).background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    }

                    label("MODEL")
                    Menu {
                        ForEach(options.indices, id: \.self) { i in Button(options[i].0) { model = options[i].1 } }
                    } label: {
                        HStack {
                            T(options.first { $0.1 == current }?.0 ?? (engine == "openai" ? (hasKey ? "Loading this API's models…" : "Save your key first, then pick a model.") : "—"), 13, lines: 1)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(H.muted)
                        }
                        .padding(12).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    }
                    .disabled(options.isEmpty)

                    if !note.isEmpty { T(note, 12, H.muted) }
                    if !error.isEmpty { T(error, 13, H.accent) }
                }
                .padding(18)
            }
            .background(H.bg)
            .navigationTitle("Assistant AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(H.muted) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Checking…" : "Save") {
                        error = ""; saving = true
                        var body: [String: Any] = ["engine": engine, "model": current]
                        if engine == "openai" { body["base_url"] = baseUrl }
                        let k = key.trimmingCharacters(in: .whitespaces)
                        if !k.isEmpty { body["key"] = k }
                        Task {
                            do { _ = try await store.assistant("POST", "/settings", body); onSaved(); dismiss() }
                            catch { self.error = error.localizedDescription }
                            saving = false
                        }
                    }
                    .disabled(saving || s == nil || !(engine == "free" || hasKey || !key.trimmingCharacters(in: .whitespaces).isEmpty))
                    .foregroundStyle(H.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
        .onDisappear { if !signin.isEmpty { Task { _ = try? await store.assistant("POST", "/claude/login/cancel") } } }
    }

    private func label(_ t: String) -> some View { Text(t).font(H.mono(11)).tracking(1).foregroundStyle(H.muted) }
    private func field(_ placeholder: String, text: Binding<String>) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundStyle(H.faint))
            .font(H.mono(14)).foregroundStyle(H.fg).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(10).background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
    }
}
