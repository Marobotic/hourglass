import SwiftUI

// Hourglass tokens, round 5 (desktop/ui/css/tokens.css): the same numbers as the desktop window and Android.
// Surfaces and inks are the desktop's mixes of fg (#f5f5f5) into bg (#121212): surface 2.6 %, surface2 5.3 %,
// surface3 8.8 %, surface4 12.3 %, border 10.6 %, border2 16.7 %, faint 36 %, muted 58 %, soft 78 %.
// Marochy: square corners (menus 4), 1 pt lines, Reddit Sans for the UI, Noto Sans for note prose, red as the only
// accent. Type: 12 tiny meta, 13 secondary, 14 body and controls, 16 titles, 18 headings, 20+ page titles; whole
// points only.
enum H {
    static let bg = Color(hex: "#121212")
    static let surface = Color(hex: "#181818")
    static let surface2 = Color(hex: "#1E1E1E")
    static let surface3 = Color(hex: "#262626")
    static let surface4 = Color(hex: "#2E2E2E")
    static let border = Color(hex: "#2A2A2A")
    static let border2 = Color(hex: "#383838")
    static let fg = Color(hex: "#F5F5F5")
    static let soft = Color(hex: "#C3C3C3")
    static let muted = Color(hex: "#969696")
    static let faint = Color(hex: "#646464")
    static let accent = Color(hex: "#B14242")
    // Red text on a dark screen: lighter, so small text stays readable. Fills keep the identity red.
    static let accentInk = Color(hex: "#E48C8C")
    static let accentHi = Color(hex: "#BA5959")
    static let glowHot = Color(hex: "#FF7878")
    static let orange = Color(hex: "#D66E36")
    static let gold = Color(hex: "#F0BE66")
    static let onGold = Color(hex: "#1A1406")
    static let teal = Color(hex: "#4A8B8B")
    static let tealInk = Color(hex: "#74B6B6")
    static let green = Color(hex: "#5B8C4A")
    // The 1 pt top highlight on raised surfaces (--hi).
    static let hi = Color.white.opacity(0.045)

    enum W { case regular, medium, semibold, bold }

    // The UI font: Reddit Sans at a fixed whole size, with tabular figures (the desktop sets them on the body).
    static func ui(_ size: CGFloat, _ w: W = .regular) -> Font {
        let name: String
        switch w {
        case .regular: name = "RedditSans-Regular"
        case .medium: name = "RedditSans-Medium"
        case .semibold: name = "RedditSans-SemiBold"
        case .bold: name = "RedditSans-Bold"
        }
        return Font.custom(name, fixedSize: size.rounded()).monospacedDigit()
    }
    static func ui(_ size: CGFloat, bold: Bool) -> Font { ui(size, bold ? .bold : .regular) }
    // Note prose (previews, assistant replies): Noto Sans.
    static func prose(_ size: CGFloat, bold: Bool = false) -> Font {
        Font.custom(bold ? "NotoSans-Bold" : "NotoSans-Regular", fixedSize: size.rounded())
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
    var weight: H.W = .regular
    var lines: Int? = nil
    init(_ text: String, _ size: CGFloat = 14, _ color: Color = H.fg, bold: Bool = false, lines: Int? = nil) {
        self.text = text; self.size = size; self.color = color; self.weight = bold ? .bold : .regular; self.lines = lines
    }
    init(_ text: String, _ size: CGFloat, _ color: Color = H.fg, weight: H.W, lines: Int? = nil) {
        self.text = text; self.size = size; self.color = color; self.weight = weight; self.lines = lines
    }
    var body: some View { Text(text).font(H.ui(size, weight)).foregroundStyle(color).lineLimit(lines) }
}

// A raised surface: s1 with a hairline and the top highlight; an optional course edge (3 pt) down the left.
struct Card<Content: View>: View {
    var stripe: Color? = nil
    var live: (String, String)? = nil // key and content signature: pops in, glows on outside changes
    var pad: CGFloat = 16
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.vertical, pad).padding(.leading, stripe == nil ? pad : pad + 3).padding(.trailing, pad)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(H.surface)
            .overlay(alignment: .top) { H.hi.frame(height: 1) }
            .overlay(alignment: .leading) { if let stripe { stripe.frame(width: 3) } }
            .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
            .lively(live?.0 ?? "", live?.1 ?? "")
    }
}

// Buttons (kit.css .btn): 44 tall on a phone (compact 36), Reddit Sans 14 bold. Default is raised surface3 with a
// border2 line; primary the red gradient with a soft glow; ghost a line only; subtle text only; danger a red tint.
struct HButton: View {
    enum Kind { case normal, primary, ghost, subtle, danger }
    let title: String
    var icon: String? = nil
    var kind: Kind = .normal
    var compact = false
    var enabled = true
    let action: () -> Void
    init(_ title: String, icon: String? = nil, primary: Bool = false, danger: Bool = false, ghost: Bool = false, subtle: Bool = false, compact: Bool = false, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title; self.icon = icon; self.compact = compact; self.enabled = enabled; self.action = action
        self.kind = primary ? .primary : danger ? .danger : ghost ? .ghost : subtle ? .subtle : .normal
    }
    var body: some View {
        let ink: Color = kind == .primary ? .white : kind == .danger ? H.accentInk : kind == .ghost ? H.soft : kind == .subtle ? H.muted : H.fg
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).font(.system(size: 16, weight: .medium)).frame(width: 16, height: 16) }
                if !title.isEmpty { Text(title).font(H.ui(compact ? 13 : 14, kind == .subtle ? .medium : .bold)).lineLimit(1) }
            }
            .foregroundStyle(ink)
            .padding(.horizontal, title.isEmpty ? 0 : (compact ? 12 : 16))
            .frame(minWidth: compact ? 36 : 44, minHeight: compact ? 36 : 44)
            .background { fillView }
            .overlay(alignment: .top) { if kind == .normal || kind == .primary { Color.white.opacity(kind == .primary ? 0.14 : 0.045).frame(height: 1) } }
            .overlay { lineView }
            .contentShape(Rectangle())
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
    }
    @ViewBuilder private var fillView: some View {
        switch kind {
        case .primary: LinearGradient(colors: [H.accentHi, H.accent], startPoint: .top, endPoint: .bottom).shadow(color: H.accent.opacity(0.45), radius: 10, y: 6)
        case .normal: H.surface3
        case .danger: H.accent.opacity(0.14)
        default: Color.clear
        }
    }
    @ViewBuilder private var lineView: some View {
        switch kind {
        case .normal, .ghost: Rectangle().strokeBorder(H.border2, lineWidth: 1)
        case .danger: Rectangle().strokeBorder(H.accent.opacity(0.3), lineWidth: 1)
        default: EmptyView()
        }
    }
}

// Every press squishes to .975 in 80 ms (REDESIGN §4).
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.975 : 1).animation(HMotion.on(HMotion.press), value: configuration.isPressed)
    }
}

// Tags (kit.css .chip): 20 tall, 12 bold uppercase. tint: the colour over surface3; solid: filled; line: a hairline
// only; live: white on red with a pulsing square.
struct Chip: View {
    enum Style { case tint, solid, line, live }
    let text: String
    var tint: Color = H.muted
    var style: Style = .tint
    @State private var pulse = false
    var body: some View {
        HStack(spacing: 6) {
            if style == .live {
                Rectangle().fill(Color.white).frame(width: 6, height: 6).opacity(pulse ? 0.35 : 1)
                    .onAppear { if HMotion.allowed { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true } } }
            }
            Text(text.uppercased()).font(H.ui(12, .bold)).tracking(1).lineLimit(1)
        }
        .foregroundStyle(style == .live || style == .solid ? (tint == H.gold ? H.onGold : .white) : style == .line ? H.muted : tint)
        .padding(.horizontal, 8).frame(height: 20)
        .background(style == .live ? H.accent : style == .solid ? tint : style == .line ? Color.clear : tint.opacity(0.14))
        .background(style == .tint ? H.surface3 : Color.clear)
        .overlay { if style == .line { Rectangle().strokeBorder(H.border2, lineWidth: 1) } }
        .fixedSize()
    }
}

// Section label (kit.css .section): caps 13 bold, a count, a line that fades out, an optional link on the right.
struct SectionLabel: View {
    let text: String
    var detail: String? = nil
    var link: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        HStack(spacing: 12) {
            Text(text.uppercased()).font(H.ui(13, .bold)).tracking(1).foregroundStyle(H.muted).lineLimit(1)
            if let detail { T(detail, 13, H.faint, weight: .medium, lines: 1) }
            LinearGradient(colors: [H.border, H.border.opacity(0)], startPoint: .leading, endPoint: .trailing).frame(height: 1)
            if let link, let action {
                Button(action: action) { T(link, 13, H.accentInk, weight: .medium, lines: 1) }.buttonStyle(.plain)
            }
        }
        .padding(.bottom, 4)
    }
}

// The page header every screen draws (REDESIGN §3 Phones): 56 tall, the logo and "Hourglass" with the version (or
// a back arrow and a title), actions on the right, a hairline under it. Same component on Android.
struct PageHeader<Actions: View>: View {
    let title: String
    var logo = false
    var subtitle: String? = nil
    var back: (() -> Void)? = nil
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if let back {
                    Button(action: back) { Image(systemName: "arrow.left").font(.system(size: 18, weight: .medium)).foregroundStyle(H.fg).frame(width: 44, height: 44).contentShape(Rectangle()) }
                        .buttonStyle(PressStyle())
                }
                if logo { PixelLogo(cell: 3, alive: true) }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        T(title, 18, bold: true, lines: 1)
                        if logo { T(AppInfo.version, 12, H.faint, lines: 1) }
                    }
                    if let subtitle { T(subtitle, 12, H.muted, lines: 1) }
                }
                .layoutPriority(1)
                Spacer(minLength: 0)
                actions()
            }
            .padding(.leading, back == nil ? 16 : 4).padding(.trailing, 4)
            .frame(height: 56)
            Rectangle().fill(H.border).frame(height: 1)
        }
    }
}

// A square icon button for headers: 44 touch target, the glyph at 20.
struct HeaderIcon: View {
    let icon: String
    var tint: Color = H.muted
    var badge = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .regular)).foregroundStyle(tint)
                .frame(width: 44, height: 44).contentShape(Rectangle())
                .overlay(alignment: .topTrailing) { if badge { Rectangle().fill(H.accent).frame(width: 8, height: 8).padding(9) } }
        }
        .buttonStyle(PressStyle())
    }
}

enum AppInfo {
    // The build's own version (CFBundleShortVersionString), never a hard-coded string.
    static let version: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    static let build: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
}

struct PixelLogo: View {
    var cell: CGFloat = 3
    var alive = false // a grain of sand keeps falling through the neck, and a tap turns the glass over
    @State private var turns = 0
    static let rows = ["#########", ".#.....#.", ".#ooooo#.", "..#ooo#..", "...#o#...", "...#o#...", "..#.o.#..", ".#.ooo.#.", ".#ooooo#.", "#########"]
    var body: some View {
        TimelineView(.animation(paused: !alive || !HMotion.allowed)) { tl in
            Canvas { ctx, _ in
                for (r, row) in PixelLogo.rows.enumerated() {
                    for (k, ch) in row.enumerated() where ch != "." {
                        ctx.fill(Path(CGRect(x: CGFloat(k) * cell, y: CGFloat(r) * cell, width: cell, height: cell)), with: .color(ch == "o" ? H.gold : H.accent))
                    }
                }
                // The falling grain: from the neck to the pile, then again.
                if alive && HMotion.allowed {
                    let f = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.4) / 1.4
                    ctx.fill(Path(CGRect(x: 4 * cell, y: CGFloat(Int(4.5 + f * 3)) * cell, width: cell, height: cell)), with: .color(H.gold))
                }
            }
        }
        .frame(width: cell * 9, height: cell * 10)
        .rotationEffect(.degrees(Double(turns) * 180))
        .animation(HMotion.on(.spring(response: 0.6, dampingFraction: 0.8)), value: turns)
        .onTapGesture { if alive { turns += 1 } }
    }
}

// Seven day squares (kit.css .days): the chosen ones raised with a red foot. size 40 to edit; small read-only rows
// use 22.
struct DayToggles: View {
    @Binding var days: [Int]
    var size: CGFloat = 40
    var body: some View {
        HStack(spacing: 4) {
            ForEach(1...7, id: \.self) { d in
                let on = days.contains(d)
                Button { if on { days.removeAll { $0 == d } } else { days = (days + [d]).sorted() } } label: {
                    DayBox(letter: String(Array("MTWTFSS")[d - 1]), on: on, size: size)
                }
                .buttonStyle(PressStyle())
            }
        }
    }
}

struct DayBox: View {
    let letter: String
    let on: Bool
    var size: CGFloat = 22
    var body: some View {
        Text(letter).font(H.ui(size >= 30 ? 14 : 12, .bold))
            .foregroundStyle(on ? H.fg : H.faint).frame(width: size, height: size)
            .background(on ? H.surface4 : H.surface2)
            .overlay(alignment: .bottom) { if on { H.accent.frame(height: 2) } }
            .animation(HMotion.on(HMotion.quick), value: on)
    }
}

// Segmented (kit.css .seg): a dark well, the selection raised. Scrolls sideways when wider than the screen.
struct Segmented<V: Hashable>: View {
    let options: [(String, V)]
    @Binding var value: V
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(options.indices, id: \.self) { i in
                    let on = options[i].1 == value
                    Button { value = options[i].1 } label: {
                        T(options[i].0, 14, on ? H.fg : H.muted, weight: on ? .bold : .medium, lines: 1)
                            .padding(.horizontal, 14).frame(height: 36)
                            .background(on ? H.surface3 : .clear)
                            .overlay(alignment: .top) { if on { H.hi.frame(height: 1) } }
                            .overlay { if on { Rectangle().strokeBorder(H.border2, lineWidth: 1) } }
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .animation(HMotion.on(HMotion.sheet), value: on)
                }
            }
            .padding(2)
            .background(H.bg)
            .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

// A label over a control (kit.css .label): 12 bold caps, muted.
struct FieldLabel: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.muted) }
}

struct Field: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    @FocusState private var focused: Bool
    init(label: String, text: Binding<String>, placeholder: String = "") {
        self.label = label; self._text = text; self.placeholder = placeholder
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !label.isEmpty { FieldLabel(text: label) }
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(H.faint))
                .font(H.ui(14)).foregroundStyle(H.fg).tint(H.accent)
                .focused($focused)
                .padding(.horizontal, 12).frame(minHeight: 44)
                .background(H.bg)
                .overlay(Rectangle().strokeBorder(focused ? H.faint : H.border, lineWidth: 1))
                .animation(HMotion.on(HMotion.quick), value: focused)
        }
    }
}

// "HH:MM" string <-> native wheel picker.
struct TimeField: View {
    let label: String
    @Binding var value: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            FieldLabel(text: label)
            DatePicker("", selection: Binding(
                get: { Calendar.current.date(bySettingHour: Dates.minutes(value) / 60, minute: Dates.minutes(value) % 60, second: 0, of: Date()) ?? Date() },
                set: { let c = Calendar.current.dateComponents([.hour, .minute], from: $0); value = String(format: "%02ld:%02ld", c.hour ?? 0, c.minute ?? 0) }
            ), displayedComponents: .hourAndMinute)
            .labelsHidden().environment(\.locale, Locale(identifier: Dates.h24 ? "en_GB" : "en_US")).tint(H.accent)
        }
    }
}

struct DateField: View {
    let label: String
    @Binding var value: String?
    var clearable = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !label.isEmpty { FieldLabel(text: label) }
            HStack {
                if let v = value {
                    DatePicker("", selection: Binding(get: { Dates.date(v) }, set: { value = Dates.format($0) }), displayedComponents: .date)
                        .labelsHidden().environment(\.timeZone, TimeZone(identifier: "UTC")!).tint(H.accent)
                    if clearable { Button { value = nil } label: { Image(systemName: "xmark").font(.system(size: 14, weight: .medium)).foregroundStyle(H.faint).frame(width: 44, height: 44) } }
                } else {
                    HButton("Set date", icon: "calendar", compact: true) { value = Dates.today() }
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
                T(note.title.isEmpty ? "Untitled" : note.title, 16, bold: true, lines: 1)
                Spacer(minLength: 0)
                if note.pinned == 1 { Image(systemName: "pin").font(.system(size: 14)).foregroundStyle(H.gold) }
            }
            let preview = NoteFormat.preview(note.body, max: 400)
            if !preview.isEmpty { Text(preview).font(H.prose(14)).foregroundStyle(H.soft).lineLimit(2).padding(.top, 8) }
        }
    }
}

// Square on/off switch (kit.css .switch; the system Toggle is a pill): red with a glow when on.
struct SquareToggle: View {
    let on: Bool
    let change: (Bool) -> Void
    var body: some View {
        Button { change(!on) } label: {
            ZStack(alignment: .leading) {
                Rectangle().fill(on ? H.accent : H.surface4).frame(width: 44, height: 24)
                    .overlay { if !on { Rectangle().strokeBorder(H.border2, lineWidth: 1) } }
                    .shadow(color: on ? H.accent.opacity(0.6) : .clear, radius: 7)
                Rectangle().fill(on ? Color.white : H.muted).frame(width: 16, height: 16).offset(x: on ? 24 : 4)
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .animation(HMotion.on(HMotion.sheet), value: on)
        }
        .buttonStyle(.plain)
    }
}

// The 0.3.4 to-do box (Maro's chosen design, 2026-11-20, same as the note editor in RichNote.swift, the desktop and
// Android): a 16 pt square with 5 pt corners, a 1.5 pt muted ring when open; a tick floods the red in from the ring
// (0.24 s), then the white tick draws itself (0.17 s in, 0.22 s long). Do not restyle it without his OK.
struct TodoBox: View {
    let done: Bool
    var animated = false
    @State private var ring: CGFloat
    @State private var tick: CGFloat
    init(done: Bool, animated: Bool = false) {
        self.done = done; self.animated = animated
        _ring = State(initialValue: done ? 8 : 1.5)
        _tick = State(initialValue: done ? 1 : 0)
    }
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 5).strokeBorder(done ? H.accent : H.muted, lineWidth: ring)
            TickShape().trim(from: 0, to: tick).stroke(Color.white, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .opacity(done ? 1 : 0)
        }
        .frame(width: 16, height: 16)
        .onChange(of: done) { _, d in
            if d && animated && HMotion.allowed {
                ring = 1.5; tick = 0
                withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 0.24)) { ring = 8 }
                withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 0.22).delay(0.17)) { tick = 1 }
            } else { ring = d ? 8 : 1.5; tick = d ? 1 : 0 }
        }
    }
}

struct TickShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let s = r.width / 16
        p.move(to: CGPoint(x: 4.5 * s, y: 8.15 * s)); p.addLine(to: CGPoint(x: 7 * s, y: 10.75 * s)); p.addLine(to: CGPoint(x: 11.5 * s, y: 5.25 * s))
        return p
    }
}

// A session in the Schedule (round 5): the course edge, start over end on the left, title and kind · teacher, the
// room on the right; while it runs a red wash, time left in red and the now line across at the right height.
struct BlockCard: View {
    let b: Block
    let clock: Int64
    var body: some View {
        let o = b.first
        let live = clock >= b.startMs && clock < b.endMs
        let past = clock >= b.endMs
        let color = Color(hex: o.color)
        let frac: CGFloat = live ? CGFloat(clock - b.startMs) / CGFloat(max(1, b.endMs - b.startMs)) : 0
        let sub = [b.parts.map { kindLabel($0.kind) }.joined(separator: " + "), o.teacher.map { String($0.split(separator: ",").first ?? "") }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                T(Dates.t(b.start), 16, bold: true, lines: 1)
                T(Dates.t(b.end), 13, H.faint, lines: 1)
            }
            .fixedSize()
            VStack(alignment: .leading, spacing: 4) {
                T(o.title, 16, bold: true, lines: 2)
                if !sub.isEmpty { T(sub, 13, H.muted, lines: 1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 4) {
                if let l = o.location { T(l, 14, H.soft, lines: 1) }
                if live { T(Dates.left((b.endMs - clock + 59_999) / 60_000), 13, H.accentInk, bold: true, lines: 1) }
            }
            .fixedSize()
        }
        .padding(.vertical, 16).padding(.leading, 19).padding(.trailing, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(live ? AnyShapeStyle(LinearGradient(colors: [H.accent.opacity(0.22), H.accent.opacity(0.08)], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(H.surface))
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(alignment: .leading) { (live ? H.accent : color).frame(width: 3).shadow(color: live ? H.accent.opacity(0.8) : .clear, radius: 6) }
        .overlay(Rectangle().strokeBorder(live ? H.accent.opacity(0.45) : H.border, lineWidth: 1))
        .overlay(alignment: .topLeading) {
            if live {
                GeometryReader { g in
                    Rectangle().fill(H.accent).frame(height: 1).shadow(color: H.glowHot.opacity(0.8), radius: 4)
                        .offset(y: (g.size.height * frac).rounded())
                }
                .allowsHitTesting(false)
            }
        }
        .opacity(past ? 0.6 : 1)
        .contentShape(Rectangle())
    }
}
