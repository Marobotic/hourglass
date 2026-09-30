import SwiftUI

// Hourglass palette, from the dotrb Omarchy theme.
enum H {
    static let bg = Color(hex: "#121212")
    static let surface = Color(hex: "#1B1B1B")
    static let surface2 = Color(hex: "#242424")
    static let border = Color(hex: "#2E2E2E")
    static let fg = Color(hex: "#F5F5F5")
    static let muted = Color(hex: "#A3A3A3")
    static let faint = Color(hex: "#6B6B6B")
    static let accent = Color(hex: "#B14242")
    static let orange = Color(hex: "#D66E36")
    static let gold = Color(hex: "#F0BE66")
    static let teal = Color(hex: "#4A8B8B")

    static func mono(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "JetBrainsMonoNF-Bold" : "JetBrainsMonoNF-Regular", size: size)
    }
}

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

struct T: View {
    let text: String
    var size: CGFloat = 14
    var color: Color = H.fg
    var bold = false
    var lines: Int? = nil
    init(_ text: String, _ size: CGFloat = 14, _ color: Color = H.fg, bold: Bool = false, lines: Int? = nil) {
        self.text = text; self.size = size; self.color = color; self.bold = bold; self.lines = lines
    }
    var body: some View { Text(text).font(H.mono(size, bold: bold)).foregroundStyle(color).lineLimit(lines) }
}

struct Card<Content: View>: View {
    var stripe: Color? = nil
    @ViewBuilder var content: () -> Content
    var body: some View {
        HStack(spacing: 0) {
            if let stripe { Rectangle().fill(stripe).frame(width: 4) }
            VStack(alignment: .leading, spacing: 0, content: content)
                .padding(.vertical, 14).padding(.leading, stripe == nil ? 14 : 16).padding(.trailing, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(H.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(H.border, lineWidth: 1))
    }
}

struct HButton: View {
    let title: String
    var icon: String? = nil
    var primary = false
    var danger = false
    var enabled = true
    let action: () -> Void
    init(_ title: String, icon: String? = nil, primary: Bool = false, danger: Bool = false, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.primary = primary; self.danger = danger; self.enabled = enabled; self.action = action
    }
    var body: some View {
        let ink: Color = primary ? .white : danger ? H.accent : H.fg
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).font(.system(size: 15, weight: .medium)) }
                if !title.isEmpty { Text(title).font(H.mono(14, bold: primary)) }
            }
            .foregroundStyle(ink.opacity(enabled ? 1 : 0.4))
            .padding(.horizontal, 16).frame(minHeight: 44)
            .background(primary ? H.accent : danger ? H.accent.opacity(0.14) : .clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(primary || danger ? .clear : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

struct Chip: View {
    let text: String
    let tint: Color
    var body: some View {
        Text(text.uppercased()).font(H.mono(10, bold: true)).tracking(0.8).foregroundStyle(tint)
            .padding(.horizontal, 7).padding(.vertical, 3).background(tint.opacity(0.18)).clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

struct SectionLabel: View {
    let text: String
    var detail: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            Text(text.uppercased()).font(H.mono(11, bold: true)).tracking(1.4).foregroundStyle(H.muted)
            if let detail { T(detail, 11, H.faint) }
            Rectangle().fill(H.border).frame(height: 1)
        }
        .padding(.top, 8).padding(.bottom, 2)
    }
}

struct PixelLogo: View {
    var cell: CGFloat = 3
    static let rows = ["#########", ".#.....#.", ".#ooooo#.", "..#ooo#..", "...#o#...", "...#o#...", "..#.o.#..", ".#.ooo.#.", ".#ooooo#.", "#########"]
    var body: some View {
        Canvas { ctx, _ in
            for (r, row) in PixelLogo.rows.enumerated() {
                for (k, ch) in row.enumerated() where ch != "." {
                    ctx.fill(Path(CGRect(x: CGFloat(k) * cell, y: CGFloat(r) * cell, width: cell + 0.5, height: cell + 0.5)), with: .color(ch == "o" ? H.gold : H.accent))
                }
            }
        }
        .frame(width: cell * 9, height: cell * 10)
    }
}

struct DayToggles: View {
    @Binding var days: [Int]
    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...7, id: \.self) { d in
                let on = days.contains(d)
                Button { if on { days.removeAll { $0 == d } } else { days = (days + [d]).sorted() } } label: {
                    Text(String(Array("MTWTFSS")[d - 1])).font(H.mono(13, bold: true))
                        .foregroundStyle(on ? .white : H.muted).frame(width: 38, height: 38)
                        .background(on ? H.accent : H.bg).clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(on ? H.accent : H.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct Segmented<V: Hashable>: View {
    let options: [(String, V)]
    @Binding var value: V
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options.indices, id: \.self) { i in
                    let on = options[i].1 == value
                    Button { value = options[i].1 } label: {
                        T(options[i].0, 13, on ? H.fg : H.muted)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(on ? H.surface2 : .clear).clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(on ? H.faint : H.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct Field: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            T(label.uppercased(), 11, H.muted)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(H.faint))
                .font(H.mono(15)).foregroundStyle(H.fg).tint(H.accent)
                .padding(.horizontal, 12).frame(minHeight: 46)
                .background(H.bg).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(H.border, lineWidth: 1))
        }
    }
}

// "HH:MM" string <-> native wheel picker.
struct TimeField: View {
    let label: String
    @Binding var value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            T(label.uppercased(), 11, H.muted)
            DatePicker("", selection: Binding(
                get: { Calendar.current.date(bySettingHour: Dates.minutes(value) / 60, minute: Dates.minutes(value) % 60, second: 0, of: Date()) ?? Date() },
                set: { let c = Calendar.current.dateComponents([.hour, .minute], from: $0); value = String(format: "%02ld:%02ld", c.hour ?? 0, c.minute ?? 0) }
            ), displayedComponents: .hourAndMinute)
            .labelsHidden().environment(\.locale, Locale(identifier: "en_GB")).tint(H.accent)
        }
    }
}

struct DateField: View {
    let label: String
    @Binding var value: String?
    var clearable = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            T(label.uppercased(), 11, H.muted)
            HStack {
                if let v = value {
                    DatePicker("", selection: Binding(get: { Dates.date(v) }, set: { value = Dates.format($0) }), displayedComponents: .date)
                        .labelsHidden().environment(\.timeZone, TimeZone(identifier: "UTC")!).tint(H.accent)
                    if clearable { Button { value = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(H.faint) } }
                } else {
                    HButton("Set date") { value = Dates.today() }
                }
            }
        }
    }
}

func kindLabel(_ k: String) -> String { k.prefix(1).uppercased() + k.dropFirst() }

struct NoteRow: View {
    let note: Note
    var body: some View {
        Card {
            HStack(spacing: 8) {
                Image(systemName: note.pinned == 1 ? "pin.fill" : "note.text").font(.system(size: 13)).foregroundStyle(note.pinned == 1 ? H.gold : H.muted)
                T(note.title.isEmpty ? "Untitled" : note.title, 15, bold: true, lines: 1)
            }
            let preview = note.body.replacingOccurrences(of: "[#>*_`\\[\\]-]", with: "", options: .regularExpression)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
            if !preview.isEmpty { T(preview, 13, H.muted, lines: 2).padding(.top, 4) }
        }
    }
}
