import SwiftUI

// What the assistant did, drawn (as on the desktop, ResultCard.qml): an alarm is
// a clock face showing its time, a timer a ring counting down, an event a
// calendar page (a cake for a birthday) with the days to go, a day its timeline.
// The server writes every card's text (server/cards.js); this only draws.
struct ResultCard: View {
    let info: [String: Any]
    let now: Date
    @State private var appeared = false
    @State private var badgeIn = false
    @State private var sweep: Double = 0

    private var kind: String { info["kind"] as? String ?? "" }
    private var st: String { info["state"] as? String ?? "" }
    private var gone: Bool { ["removed", "stopped", "off"].contains(st) }
    private var accent: Color {
        switch kind {
        case "alarm": return H.accent
        case "timer": return H.teal
        case "event": return (info["birthday"] as? Bool ?? false) ? H.gold : H.orange
        default: return H.teal
        }
    }
    private var secsLeft: Int {
        guard kind == "timer", let end = info["ends_at"] as? Double, end > 0 else { return 0 }
        return max(0, Int(ceil((end - now.timeIntervalSince1970 * 1000) / 1000)))
    }
    private var minutes: Double { (info["minutes"] as? Double) ?? Double(info["minutes"] as? Int ?? 0) }

    private func countdown(_ s: Int) -> String {
        let h = s / 3600, m = (s % 3600) / 60, x = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, x) : String(format: "%d:%02d", m, x)
    }
    private var badge: (String, Color)? {
        switch true {
        case st == "removed": return ("REMOVED", H.muted)
        case st == "stopped": return ("STOPPED", H.muted)
        case st == "off": return ("OFF", H.muted)
        case st == "on": return ("ON", H.teal)
        case st == "added": return ("ADDED", H.teal)
        case st == "changed": return ("CHANGED", H.teal)
        case kind == "alarm" && st == "set": return ("SET", H.teal)
        case kind == "timer" && st == "running": return (secsLeft > 0 ? "RUNNING" : "DONE", H.teal)
        default: return nil
        }
    }

    var body: some View {
        Group {
            if kind == "day" { day } else { row }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(H.surface)
        .overlay(Rectangle().stroke(gone ? H.border : accent.opacity(0.55), lineWidth: 1))
        .opacity((appeared ? 1 : 0) * (gone ? 0.75 : 1))
        .scaleEffect(appeared ? 1 : 0.92)
        .onAppear {
            // It pops in once: a little rise and settle; the alarm's hands sweep round to the time.
            sweep = minutes - 120
            withAnimation(.spring(response: 0.38, dampingFraction: 0.6)) { appeared = true }
            withAnimation(.easeOut(duration: 0.75)) { sweep = minutes }
            withAnimation(.spring(response: 0.32, dampingFraction: 0.45).delay(0.26)) { badgeIn = true }
        }
    }

    private var row: some View {
        HStack(spacing: 14) {
            art.frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text(kind == "alarm" ? (info["time"] as? String ?? "") : kind == "timer" ? ((info["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Timer") : (info["label"] as? String ?? ""))
                        .font(H.mono(kind == "alarm" ? 22 : 15, bold: true)).foregroundStyle(H.fg).lineLimit(1)
                        .strikethrough(st == "removed")
                    if let b = badge {
                        HStack(spacing: 3) {
                            if b.0 == "SET" || b.0 == "ADDED" { Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)) }
                            Text(b.0).font(H.mono(10, bold: true)).tracking(1)
                        }
                        .foregroundStyle(b.1).padding(.horizontal, 6).padding(.vertical, 2).background(b.1.opacity(0.2))
                        .scaleEffect(badgeIn ? 1 : 0.01)
                    }
                }
                T(subtitle, 13, H.muted, lines: 1)
                if !third.isEmpty { T(third, 12, thirdColor, lines: 1) }
            }
        }
    }

    private var subtitle: String {
        switch kind {
        case "alarm": return (info["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Alarm"
        case "timer": return st == "running" ? (secsLeft > 0 ? "rings in \(countdown(secsLeft))" : "rang") : "stopped"
        case "event": return [info["when"] as? String ?? "", info["time"] as? String ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        case "note": return (info["course"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (st == "added" ? "New note" : "Note")
        default: return info["value"] as? String ?? ""
        }
    }
    private var daysUntil: Int? { info["days_until"] as? Int }
    private var third: String {
        if kind == "alarm" { return info["when"] as? String ?? "" }
        guard kind == "event" else { return "" }
        let rep = info["repeats"] as? String ?? ""
        switch daysUntil {
        case let d? where d > 1: return "in \(d) days" + (rep.isEmpty ? "" : " · \(rep)")
        case 1: return "tomorrow"
        case 0: return "today!"
        default: return rep
        }
    }
    private var thirdColor: Color { kind == "event" && (daysUntil ?? 99) <= 7 ? accent : H.faint }

    @ViewBuilder private var art: some View {
        switch kind {
        case "alarm": ClockFace(minutes: sweep, gone: gone)
        case "timer":
            ZStack {
                Circle().stroke(H.surface2, lineWidth: 6).padding(5)
                Circle().trim(from: 0, to: st == "running" ? min(1, CGFloat(secsLeft) / CGFloat(max(1, info["duration_s"] as? Int ?? 1))) : 0)
                    .stroke(H.teal, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90)).padding(5)
                    .animation(.linear(duration: 1), value: secsLeft)
                Text(st == "running" ? countdown(secsLeft) : "–").font(H.mono(secsLeft >= 3600 ? 10 : 12, bold: true)).foregroundStyle(H.fg)
            }
        case "event":
            let parts = (info["when"] as? String ?? "").split(separator: " ").map(String.init)
            VStack(spacing: 0) {
                Text((parts.count >= 3 ? parts[2] : (info["when"] as? String ?? "")).uppercased())
                    .font(H.mono(10, bold: true)).foregroundStyle(Color(hex: "#121212")).lineLimit(1)
                    .frame(maxWidth: .infinity).frame(height: 18).background(accent)
                ZStack {
                    if info["birthday"] as? Bool ?? false {
                        Cake().padding(4)
                    } else {
                        Text(parts.count >= 2 ? parts[1] : (daysUntil == 0 ? "★" : "")).font(H.mono(24, bold: true)).foregroundStyle(H.fg)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(H.bg).overlay(Rectangle().stroke(accent, lineWidth: 2))
        default:
            Image(systemName: kind == "note" ? "note.text" : "checkmark").font(.system(size: 24)).foregroundStyle(H.teal)
                .frame(maxWidth: .infinity, maxHeight: .infinity).background(H.bg).overlay(Rectangle().stroke(H.border, lineWidth: 1))
        }
    }

    // A day: its timeline, then the list.
    private var day: some View {
        let items = info["items"] as? [[String: Any]] ?? []
        let from = items.compactMap { $0["from"] as? Int }.min() ?? 8 * 60
        let to = items.compactMap { $0["to"] as? Int }.max() ?? 18 * 60
        let span = Double(max(1, to - from))
        return VStack(alignment: .leading, spacing: 8) {
            Text((info["label"] as? String ?? "").uppercased()).font(H.mono(11, bold: true)).tracking(1.5).foregroundStyle(H.muted)
            if items.isEmpty { T("Nothing on.", 14) } else {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(H.surface2)
                        ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                            let a = Double((it["from"] as? Int ?? from) - from) / span, b = Double((it["to"] as? Int ?? from) - from) / span
                            Rectangle().fill(Color(hex: (it["color"] as? String) ?? "#4A8B8B"))
                                .frame(width: max(4, (b - a) * g.size.width - 2)).offset(x: a * g.size.width)
                        }
                    }
                }.frame(height: 14)
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    HStack(spacing: 8) {
                        Rectangle().fill(Color(hex: (it["color"] as? String) ?? "#4A8B8B")).frame(width: 8, height: 8)
                        T("\(it["start"] as? String ?? "")–\(it["end"] as? String ?? "")", 12, H.muted)
                        T((it["title"] as? String ?? "") + ((it["location"] as? String).flatMap { $0.isEmpty ? nil : "  " + $0 } ?? ""), 13, lines: 1)
                    }
                }
            }
        }
    }
}

private struct ClockFace: View, Animatable {
    var minutes: Double
    let gone: Bool
    var animatableData: Double { get { minutes } set { minutes = newValue } }
    var body: some View {
        Canvas { c, size in
            let r = min(size.width, size.height) / 2 - 3, cx = size.width / 2, cy = size.height / 2
            let circle = Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
            c.fill(circle, with: .color(H.bg))
            c.stroke(circle, with: .color(gone ? H.muted : H.accent), lineWidth: 2)
            for i in 0..<12 {
                let a = Double(i) * .pi / 6, inner = i % 3 == 0 ? r - 8 : r - 5
                var p = Path()
                p.move(to: CGPoint(x: cx + sin(a) * inner, y: cy - cos(a) * inner))
                p.addLine(to: CGPoint(x: cx + sin(a) * (r - 2), y: cy - cos(a) * (r - 2)))
                c.stroke(p, with: .color(H.muted), lineWidth: i % 3 == 0 ? 2 : 1)
            }
            let ha = (minutes / 60).truncatingRemainder(dividingBy: 12) * .pi / 6, ma = minutes.truncatingRemainder(dividingBy: 60) * .pi / 30
            var hour = Path(); hour.move(to: CGPoint(x: cx, y: cy)); hour.addLine(to: CGPoint(x: cx + sin(ha) * r * 0.5, y: cy - cos(ha) * r * 0.5))
            var minute = Path(); minute.move(to: CGPoint(x: cx, y: cy)); minute.addLine(to: CGPoint(x: cx + sin(ma) * r * 0.78, y: cy - cos(ma) * r * 0.78))
            c.stroke(hour, with: .color(H.fg), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            c.stroke(minute, with: .color(H.fg), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            c.fill(Path(ellipseIn: CGRect(x: cx - 3, y: cy - 3, width: 6, height: 6)), with: .color(gone ? H.muted : H.accent))
        }
    }
}

private struct Cake: View {
    var body: some View {
        Canvas { c, s in
            let w = s.width, h = s.height
            c.fill(Path(CGRect(x: w * 0.18, y: h * 0.55, width: w * 0.64, height: h * 0.4)), with: .color(H.gold))
            c.fill(Path(CGRect(x: w * 0.18, y: h * 0.55, width: w * 0.64, height: h * 0.1)), with: .color(H.accent))
            c.fill(Path(CGRect(x: w * 0.47, y: h * 0.25, width: w * 0.06, height: h * 0.3)), with: .color(H.fg))
            c.fill(Path(ellipseIn: CGRect(x: w * 0.44, y: h * 0.06, width: w * 0.12, height: h * 0.2)), with: .color(H.orange))
        }
    }
}

// What the assistant is doing or did, one line per step, with the time since
// the message started: "+0.0 s Asking big-pickle (free)…", "+7.0 s Set an alarm".
struct StepList: View {
    let steps: [[String: Any]]
    private func at(_ s: [String: Any]) -> Double { (s["at"] as? Double) ?? Double(s["at"] as? Int ?? 0) }
    var body: some View {
        let start = steps.first.map(at) ?? 0
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(steps.enumerated()), id: \.offset) { _, s in
                let text = s["text"] as? String ?? ""
                HStack(alignment: .top, spacing: 8) {
                    Text(String(format: "+%.1f s", (at(s) - start) / 1000)).font(H.mono(11)).foregroundStyle(H.faint).frame(width: 58, alignment: .trailing)
                    Text(text).font(H.mono(12)).italic(text.hasPrefix("Thinking"))
                        .foregroundStyle(text.range(of: "went quiet|failed|stalled|not connected", options: .regularExpression) != nil ? H.accent : text.hasPrefix("Thinking") ? H.faint : H.muted)
                }
            }
        }
    }
}
