import SwiftUI

// A small bar and a percentage in the header: how much of the model's context
// window the conversation uses (from the usage events).
struct ContextMeter: View {
    let percent: Double
    var body: some View {
        let clamped: Double = min(max(percent, 0), 100)
        let color: Color = clamped >= 90 ? H.accent : clamped >= 70 ? H.gold : H.teal
        HStack(spacing: 5) {
            ZStack(alignment: .leading) {
                Rectangle().fill(H.surface2).frame(width: 30, height: 5)
                Rectangle().fill(color).frame(width: 30 * clamped / 100, height: 5)
            }
            .overlay(Rectangle().stroke(H.border, lineWidth: 1))
            T(String(format: "%.0f%%", clamped), 11, H.muted)
        }
        .padding(.horizontal, 6).frame(height: 44)
    }
}

// "Limit reached, continues at 14:30": a quiet line from the quota events.
func quotaLine(_ quota: [String: Any]) -> String {
    guard let ms = assistantNumber(quota["resets_at"]), ms > 0 else { return "Limit reached. Try again a little later." }
    let date = Date(timeIntervalSince1970: ms / 1000)
    let f = DateFormatter()
    f.locale = Locale.current
    if Calendar.current.isDateInToday(date) { f.dateStyle = .none; f.timeStyle = .short }
    else { f.dateStyle = .medium; f.timeStyle = .short }
    return "Limit reached, continues at " + f.string(from: date)
}

// What the assistant costs and what is left (GET /api/assistant/usage), as a full page.
struct AssistantUsageSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var usage: [String: Any] = [:]
    @State private var problem = ""
    @State private var loading = true

    private func dict(_ key: String) -> [String: Any] { usage[key] as? [String: Any] ?? [:] }
    private func list(_ key: String) -> [[String: Any]] { usage[key] as? [[String: Any]] ?? [] }

    private func load() async {
        loading = true
        do { usage = try await store.assistant("GET", "/usage?days=14"); problem = "" }
        catch { problem = error.localizedDescription }
        loading = false
    }

    private func tokens(_ v: Any?) -> String {
        let n: Double = assistantNumber(v) ?? 0
        if n >= 1_000_000 { return String(format: "%.1fM", n / 1_000_000) }
        if n >= 1000 { return String(format: "%.1fk", n / 1000) }
        return String(format: "%.0f", n)
    }
    private func cost(_ block: [String: Any]) -> String {
        guard let c = assistantNumber(block["cost"]) else { return "—" }
        let unpriced: Int = Int(assistantNumber(block["unpriced_runs"]) ?? 0)
        return String(format: "$%.4f", c) + (unpriced > 0 ? " + \(unpriced) unpriced" : "")
    }
    private func line(_ left: String, _ right: String) -> some View {
        HStack {
            T(left, 13, H.muted)
            Spacer(minLength: 8)
            T(right, 13)
        }
    }
    private func section(_ title: String) -> some View {
        Text(title).font(H.mono(11)).tracking(1).foregroundStyle(H.muted).padding(.top, 8)
    }

    private var contextBlock: some View {
        let context = dict("context")
        let percent: Double = assistantNumber(context["percent"]) ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            section("CONTEXT")
            ContextMeter(percent: percent).frame(height: 24)
            line("Window", tokens(context["window"]) + " tokens")
            line("Input now", tokens(context["input_tokens"]))
            line("Cached", tokens(context["cache_read_input_tokens"]))
        }
    }

    private var totalsBlock: some View {
        let today = dict("today")
        let totals = dict("totals")
        return VStack(alignment: .leading, spacing: 6) {
            section("TODAY")
            line("Runs", tokens(today["runs"]))
            line("Tokens", tokens(today["tokens"]))
            line("Cost", cost(today))
            section("LAST 14 DAYS")
            line("Runs", tokens(totals["runs"]))
            line("Tokens", tokens(totals["tokens"]))
            line("Cost", cost(totals))
        }
    }

    private var limitsBlock: some View {
        let limits = dict("limits")
        let hourly: Int = Int(assistantNumber(limits["messages_per_hour"]) ?? 0)
        let queued: Int = Int(assistantNumber(limits["max_queued"]) ?? 0)
        return VStack(alignment: .leading, spacing: 6) {
            section("LIMITS")
            if hourly > 0 { line("Messages per hour", "\(hourly)") }
            if queued > 0 { line("Messages waiting at once", "\(queued)") }
            if let plan = limits["plan"] as? String { line("Plan", plan) }
            ForEach(0..<list("quotas").count, id: \.self) { i in
                T(quotaLine(list("quotas")[i]), 12, H.gold)
            }
            if let ds = dict("deepseek")["line"] as? String, !ds.isEmpty { T("DeepSeek: " + ds, 12, H.faint) }
        }
    }

    private var daysBlock: some View {
        let days: [[String: Any]] = Array(list("days").reversed().prefix(14))
        return VStack(alignment: .leading, spacing: 4) {
            section("PER DAY")
            ForEach(0..<days.count, id: \.self) { i in
                let day = days[i]
                HStack {
                    T(day["date"] as? String ?? "", 12, H.muted)
                    Spacer()
                    T("\(tokens(day["runs"])) runs · \(tokens(day["tokens"])) tokens", 12, H.fg)
                }
            }
        }
    }

    private var enginesBlock: some View {
        let engines: [[String: Any]] = list("engines")
        return VStack(alignment: .leading, spacing: 4) {
            section("BY ENGINE")
            ForEach(0..<engines.count, id: \.self) { i in
                line(engines[i]["engine"] as? String ?? "", "\(tokens(engines[i]["tokens"])) tokens · \(cost(engines[i]))")
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if loading && usage.isEmpty { T("Loading…", 13, H.muted) }
                    if !problem.isEmpty { T(problem, 12, H.accent) }
                    if !usage.isEmpty {
                        T((usage["engine_name"] as? String ?? "") + " · " + (usage["model"] as? String ?? ""), 13, H.fg, lines: 1)
                        contextBlock
                        totalsBlock
                        limitsBlock
                        enginesBlock
                        daysBlock
                    }
                }
                .padding(18)
            }
            .background(H.bg)
            .navigationTitle("Usage")
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
