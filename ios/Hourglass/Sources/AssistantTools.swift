import SwiftUI

// One tool call in an answer. Tap the line to see what went in and came out
// (the server trims both to 2000 characters), how long it took, and, for a
// file edit, the changed lines.
struct ToolRow: View {
    let tool: [String: Any]
    @State private var open = false

    private var hasDetail: Bool {
        let input: String = tool["input"] as? String ?? ""
        let output: String = tool["output"] as? String ?? ""
        return !input.isEmpty || !output.isEmpty || tool["diff"] is [String: Any]
    }
    private var duration: String {
        guard let ms = assistantNumber(tool["duration_ms"]) else { return "" }
        return ms >= 1000 ? String(format: "%.1f s", ms / 1000) : String(format: "%.0f ms", ms)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button { if hasDetail { withAnimation(.easeOut(duration: 0.18)) { open.toggle() } } } label: {
                header
            }
            .buttonStyle(.plain)
            if open { detail.transition(.opacity) }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            ToolLine(label: tool["label"] as? String ?? tool["tool"] as? String ?? "", status: tool["status"] as? String ?? "")
            if !duration.isEmpty { T(duration, 12, H.faint) }
            if hasDetail { Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 9)).foregroundStyle(H.faint) }
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let diff = tool["diff"] as? [String: Any] { DiffLines(diff: diff) }
            ToolText(title: "INPUT", text: tool["input"] as? String ?? "")
            ToolText(title: "OUTPUT", text: tool["output"] as? String ?? "")
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(H.surface)
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }
}

private struct ToolText: View {
    let title: String
    let text: String
    var body: some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                T(title, 12, H.faint)
                Text(text).font(H.ui(12)).foregroundStyle(H.muted).textSelection(.enabled)
            }
        }
    }
}

// The line diff the server attaches to a file edit: lines with op
// same / add / del, or a skip with a count of folded lines.
struct DiffLines: View {
    let diff: [String: Any]
    private static let cap = 80

    private var lines: [[String: Any]] { diff["lines"] as? [[String: Any]] ?? [] }
    private var summary: String {
        let added: Int = Int(assistantNumber(diff["added"]) ?? 0)
        let removed: Int = Int(assistantNumber(diff["removed"]) ?? 0)
        return "+\(added) −\(removed)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            T(summary, 12, H.teal)
            if (diff["tooBig"] as? Bool) == true {
                T("Too many changes to show here.", 12, H.faint)
            } else {
                ForEach(0..<min(lines.count, Self.cap), id: \.self) { i in row(lines[i]) }
                if lines.count > Self.cap { T("… \(lines.count - Self.cap) more lines", 12, H.faint) }
            }
        }
    }

    private func row(_ line: [String: Any]) -> some View {
        let op: String = line["op"] as? String ?? "same"
        let text: String = line["text"] as? String ?? ""
        let mark: String = op == "add" ? "+ " : op == "del" ? "− " : "  "
        let color: Color = op == "add" ? H.teal : op == "del" ? H.accent : H.faint
        if op == "skip" {
            return AnyView(T("  … \(Int(assistantNumber(line["count"]) ?? 0)) unchanged lines", 12, H.faint))
        }
        return AnyView(Text(mark + text).font(H.ui(12)).foregroundStyle(color).lineLimit(2))
    }
}
