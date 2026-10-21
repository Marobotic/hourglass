import SwiftUI
import PhotosUI
import QuickLook
import UniformTypeIdentifiers

// MARK: - Now

// An overview, not a dashboard: the one thing on or next, the few after it,
// and one line for the next alarm and any running timer.
struct NowView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]

    var body: some View {
        Ticking { clock in
            let today = Dates.dayOf(clock)
            // Today only: what is on and what starts in the next 12 hours; a
            // session marked off is not happening.
            let window = merge(store.occurrences(today, Dates.add(today, 1)).filter { $0.mark != "off" })
                .filter { $0.endMs > clock && ($0.first.date == today || $0.startMs - clock <= Now.ahead) }
            let current = window.first
            let later = Array(window.dropFirst())
            let todays = todayNotes(today, current)
            let alarm = store.alarms.compactMap { a in Alarms.next(a, store.db.courses, store.db.events, clock).map { (a, $0) } }.min { $0.1 < $1.1 }
            let timer = store.timers.first { $0.state != "idle" }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 0) {
                        T(Dates.long(today), 14, H.muted)
                        T(Dates.clock(clock), 42, bold: true)
                    }
                    hero(current, today, clock)
                    if !later.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("COMING UP").font(H.mono(12, bold: true)).tracking(2).foregroundStyle(H.muted)
                            ForEach(later) { b in TimelineRow(o: b.first, clock: clock, end: b.end).onTapGesture { sheets.session = b.first } }
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("NOTES FOR TODAY").font(H.mono(12, bold: true)).tracking(2).foregroundStyle(H.muted)
                        if todays.isEmpty { T("Nothing yet. Notes you take in class show up here.", 13, H.faint) }
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 8) {
                            ForEach(todays) { n in noteCard(n, today).lively("note:\(n.id)", "\(n.updated_at)") }
                        }
                    }
                    if let al = alarm {
                        let a = al.0, at = al.1
                        HStack(spacing: 8) {
                            Image(systemName: "alarm").foregroundStyle(H.muted)
                            T(Dates.clock(at) + (Dates.dayOf(at) == today ? "" : " " + Dates.weekdays[Dates.iso(Dates.dayOf(at)) - 1]), 14, bold: true)
                            T(a.label, 13, H.muted, lines: 1)
                        }
                    }
                    if let t = timer {
                        let remain = store.timerLeft(t, clock)
                        HStack(spacing: 8) { Image(systemName: "timer").foregroundStyle(H.accent); T(Dates.countdown(remain) + "  " + t.label, 14) }
                    }
                }
                .padding(20)
            }
            .background(H.bg)
        }
    }

    // Notes dated today, then the class's: this session's, else the last one's.
    private func todayNotes(_ today: String, _ b: Block?) -> [Note] {
        var out = store.notes.filter { $0.session_date == today }
        if let cid = b?.first.course_id, let day = b?.first.session {
            let mine = store.notes.filter { $0.course_id == cid && ($0.session_date ?? "~") <= day }
            let last = mine.compactMap(\.session_date).max()
            for n in mine where n.session_date == last && !out.contains(where: { $0.id == n.id }) { out.append(n) }
        }
        return Array(out.sorted { ($0.pinned, $0.updated_at) > ($1.pinned, $1.updated_at) }.prefix(6))
    }

    private func noteCard(_ n: Note, _ today: String) -> some View {
        let c = store.course(n.course_id)
        let tint = c.map { Color(hex: $0.color) }
        let foot = [c.map { $0.name }, n.session_date == today ? "Today" : n.session_date.map { "Last class · " + Dates.short($0) }].compactMap { $0 }
        return VStack(alignment: .leading, spacing: 4) {
            if !n.title.isEmpty { T(n.title, 14, bold: true, lines: 1) }
            if !n.body.isEmpty { Text(NoteFormat.plainText(n.body)).font(.system(size: 13)).foregroundStyle(H.fg.opacity(0.85)).lineLimit(4) }
            Text(foot.joined(separator: "  ·  ")).font(H.mono(11, bold: true)).foregroundStyle(tint ?? H.muted).lineLimit(1)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(tint.map { $0.opacity(0.14) } ?? H.surface)
        .overlay(Rectangle().stroke(tint?.opacity(0.45) ?? H.border, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { path.append(.note(n.id)) }
    }

    @ViewBuilder
    private func hero(_ b: Block?, _ today: String, _ clock: Int64) -> some View {
        let live = b.map { clock >= $0.startMs } ?? false
        Card(stripe: b.map { Color(hex: $0.first.color) } ?? H.border) {
            Text(b == nil ? "DAY OFF" : live ? "NOW" : b!.first.date == today ? "NEXT" : "NEXT · " + Dates.short(b!.first.date).uppercased())
                .font(H.mono(12, bold: true)).tracking(2).foregroundStyle(live ? H.accent : H.muted)
            T(b?.first.title ?? "Heyyy, your day is off!", 26, bold: true).padding(.top, 8)
            if b == nil && !store.courses.isEmpty { T("Nothing on today or in the next 12 hours.", 14, H.muted) }
            if let b {
                T(Dates.range(b.start, b.end) + (b.first.location.map { "   \($0)" } ?? ""), 18, bold: true).padding(.top, 6)
                if let t = b.first.teacher { T(String(t.split(separator: ",").first ?? ""), 14, H.muted) }
                T(live ? Dates.left((b.endMs - clock + 59_999) / 60_000) : "Starts " + Dates.relative((b.startMs - clock + 59_999) / 60_000), 14, live ? H.accent : H.muted).padding(.top, 4)
                if b.first.course_id != nil {
                    HButton("Notes for this class", icon: "square.and.pencil", primary: true) {
                        // This session's note when there is one, so a tap never makes a second.
                        if let n = Now.sessionNotes(store.notes, b.first).session.first { path.append(.note(n.id)) }
                        else { path.append(.note(store.addNote(course: b.first.course_id, date: b.first.session, event: b.first.event_id).id)) }
                    }
                    .padding(.top, 12)
                }
            } else if store.courses.isEmpty {
                HButton("Add a course", icon: "plus", primary: true) { sheets.course = CourseDraft() }.padding(.top, 12)
            }
        }
    }
}

struct TimelineRow: View {
    let o: Occ
    let clock: Int64
    var end: String? = nil
    var body: some View {
        let past = clock >= o.end_ms
        let live = clock >= o.start_ms && !past
        let color = Color(hex: o.color)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) { T(Dates.t(o.start_time), 14, bold: true); T(Dates.t(end ?? o.end_time), 11, H.faint) }.frame(width: 76, alignment: .leading)
            Rectangle().fill(color).frame(width: 3, height: 34)
            VStack(alignment: .leading, spacing: 1) {
                T(o.title, 14, lines: 1)
                T([o.location.map { String($0.components(separatedBy: " · ")[0]) }, kindLabel(o.kind), o.code].compactMap { $0 }.joined(separator: " · "), 12, H.muted, lines: 1)
            }
            Spacer()
            if live { Rectangle().fill(H.accent).frame(width: 8, height: 8) }
        }
        .padding(10)
        .background(live ? color.opacity(0.14) : .clear)
        .clipShape(Rectangle())
        .opacity(past ? 0.5 : 1)
        .contentShape(Rectangle())
    }
}

struct TimerCard: View {
    @EnvironmentObject var store: Store
    let t: HTimer
    let clock: Int64
    var big = false
    @State private var playFrame = CGRect.zero
    var body: some View {
        let running = t.state == "running"
        let remain = store.timerLeft(t, clock)
        Card(stripe: big ? (running ? H.accent : H.faint) : nil, live: ("timer:\(t.id)", "\(t.updated_at)")) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    T(Dates.countdown(remain), big ? 34 : 22, running ? H.fg : H.muted, bold: true)
                    T(t.label + (running ? "" : "  ·  paused"), 12, H.muted, lines: 1)
                }
                Spacer()
                // Starting it again: a little burst.
                Button { if running { store.pause(t) } else { store.resume(t); Motion.shared.burst(in: playFrame) } } label: { Image(systemName: running ? "pause.fill" : "play.fill").foregroundStyle(H.fg).frame(width: 40, height: 40) }
                    .burstAnchor($playFrame)
                Button { store.stop(t) } label: { Image(systemName: "xmark").foregroundStyle(H.muted).frame(width: 40, height: 40) }
            }
            if big {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(H.surface2)
                        Rectangle().fill(H.accent).frame(width: g.size.width * min(1, max(0, Double(remain) / Double(max(1, t.duration_s)))))
                    }
                }
                .frame(height: 4).padding(.top, 8)
            }
        }
    }
}

// MARK: - Schedule

// Week: each day's merged blocks. Month: a grid; tap a day for its list.
struct ScheduleView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @State private var month = false
    @State private var anchor = Dates.today()
    @State private var picked = Dates.today()

    var body: some View {
        Ticking { clock in
            let today = Dates.today()
            let ws = Dates.displayWeekStart(anchor)
            let first = String(anchor.prefix(8)) + "01"
            let gridStart = Dates.displayWeekStart(first)
            let (y, m, _) = Dates.parts(first)
            let lastDay = Dates.format(Dates.utc.date(from: DateComponents(year: y, month: m + 1, day: 0))!)
            let weeks = (Dates.between(gridStart, lastDay) + 7) / 7
            let from = month ? gridStart : ws
            let to = month ? Dates.add(gridStart, weeks * 7 - 1) : Dates.add(ws, 6)
            let blocks = merge(store.occurrences(from, to))
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        HStack {
                            T(month ? "\(Dates.longMonths[m - 1]) \(y)" : "\(Dates.short(ws)) – \(Dates.short(Dates.add(ws, 6)))", 18, bold: true, lines: 1)
                            Spacer()
                            Button { anchor = month ? Dates.format(Dates.utc.date(from: DateComponents(year: y, month: m - 1, day: 1))!) : Dates.add(ws, -7) } label: { Image(systemName: "chevron.left").foregroundStyle(H.fg).frame(width: 36, height: 36) }
                            Button { anchor = month ? Dates.format(Dates.utc.date(from: DateComponents(year: y, month: m + 1, day: 1))!) : Dates.add(ws, 7) } label: { Image(systemName: "chevron.right").foregroundStyle(H.fg).frame(width: 36, height: 36) }
                        }
                        HStack(spacing: 6) {
                            tab("Week", !month) { month = false }
                            tab("Month", month) { month = true }
                            Spacer()
                            tab("Today", false) { anchor = today; picked = today }
                        }
                        if !month {
                            ForEach(0..<7, id: \.self) { i in
                                let d = Dates.add(ws, i)
                                let list = blocks.filter { $0.first.date == d }
                                SectionLabel(text: (d == today ? "Today · " : "") + Dates.long(d))
                                if list.isEmpty { T("Free", 13, H.faint) }
                                ForEach(list) { b in BlockCard(b: b, clock: clock).onTapGesture { sheets.session = b.first } }
                            }
                        } else {
                            HStack(spacing: 0) { ForEach(0..<7, id: \.self) { i in T(String(Dates.weekdays[Dates.iso(Dates.add(gridStart, i)) - 1].prefix(2)), 12, H.muted).frame(maxWidth: .infinity) } }
                            VStack(spacing: 0) {
                                ForEach(0..<weeks, id: \.self) { w in
                                    HStack(spacing: 0) {
                                        ForEach(0..<7, id: \.self) { i in
                                            let d = Dates.add(gridStart, w * 7 + i)
                                            let list = blocks.filter { $0.first.date == d }
                                            VStack(alignment: .leading, spacing: 3) {
                                                T("\(Dates.parts(d).2)", 14, d == today ? H.accent : d.hasPrefix(String(first.prefix(7))) ? H.fg : H.faint, bold: d == today)
                                                ForEach(list.prefix(3)) { b in Rectangle().fill(Color(hex: b.first.color)).frame(height: 5) }
                                                Spacer(minLength: 0)
                                            }
                                            .padding(4)
                                            .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
                                            .background(d == picked ? H.surface2 : .clear)
                                            .overlay(Rectangle().stroke(H.border, lineWidth: 0.5))
                                            .contentShape(Rectangle())
                                            .onTapGesture { picked = d }
                                        }
                                    }
                                }
                            }
                            let list = blocks.filter { $0.first.date == picked }
                            SectionLabel(text: (picked == today ? "Today · " : "") + Dates.long(picked))
                            if list.isEmpty { T("Free", 13, H.faint) }
                            ForEach(list) { b in BlockCard(b: b, clock: clock).onTapGesture { sheets.session = b.first } }
                        }
                        Spacer(minLength: 72)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                }
                Fab(icon: "plus") { sheets.event = EventDraft(date: month ? picked : today) }
            }
            .background(H.bg)
        }
    }

    private func tab(_ label: String, _ on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            T(label, 14, on ? H.fg : H.muted, bold: on).padding(.horizontal, 14).padding(.vertical, 8)
                .background(on ? H.surface2 : .clear).overlay(Rectangle().stroke(on ? H.faint : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct Fab: View {
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 56, height: 56).background(H.accent)
        }
        .padding(18)
    }
}

// MARK: - Notes

// Every note in one place: All, No course, or one course (with its lecturers
// and weekly times), grouped by the day each note belongs to.
// Notes like Google Keep: course chips, a "Take a note" bar, and a two-column
// staggered grid of cards tinted with the course colour.
struct NotesView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]
    @State var sel = "all"
    @State private var query = ""
    @State private var searching = false

    var body: some View {
        let course = store.courses.first { $0.id == sel }
        let words = query.lowercased().split(separator: " ").map(String.init)
        let list = store.notes
            .filter { sel == "all" ? true : sel == "inbox" ? $0.course_id == nil : $0.course_id == sel }
            .filter { n in words.isEmpty || words.allSatisfy { (n.title + "\n" + NoteFormat.plainText(n.body)).lowercased().contains($0) } }
            .sorted { ($0.pinned, $0.updated_at) > ($1.pinned, $1.updated_at) }
        let cols = columns(list)
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    T("Notes", 22, bold: true)
                    Spacer()
                    Button { searching.toggle(); if !searching { query = "" } } label: { Image(systemName: searching ? "xmark" : "magnifyingglass").foregroundStyle(H.muted).frame(width: 36, height: 36) }
                }
                if searching { Field(label: "Search", text: $query) }
                // "All" first, then each subject: one dropdown.
                Menu {
                    Button { sel = "all" } label: { Label("All notes", systemImage: sel == "all" ? "checkmark" : "") }
                    ForEach(store.courses) { c in Button { sel = c.id } label: { Label(c.name, systemImage: sel == c.id ? "checkmark" : "") } }
                    Button { sel = "inbox" } label: { Label("No course", systemImage: sel == "inbox" ? "checkmark" : "") }
                    Divider()
                    Button { sheets.course = CourseDraft() } label: { Label("New course", systemImage: "plus") }
                } label: {
                    HStack(spacing: 10) {
                        if let c = course { Rectangle().fill(Color(hex: c.color)).frame(width: 10, height: 10) }
                        T(sel == "all" ? "All notes" : sel == "inbox" ? "No course" : course?.name ?? "All notes", 15, bold: true, lines: 1)
                        Spacer()
                        Image(systemName: "chevron.down").foregroundStyle(H.muted)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                }
                if let c = course {
                    T([c.name, c.location, c.teacher.map { String($0.split(separator: ",").first ?? "") }].compactMap { $0 }.joined(separator: "  ·  "), 13, H.muted, lines: 2)
                        .onTapGesture { sheets.course = CourseDraft(course: c) }
                }
                Button { path.append(.note(store.addNote(course: course?.id, date: Dates.today(), event: nil).id)) } label: {
                    HStack {
                        T(course.map { "Take a note for \($0.name)…" } ?? "Take a note…", 15, H.muted)
                        Spacer()
                        Image(systemName: "square.and.pencil").foregroundStyle(H.muted)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(H.surface).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                }
                .buttonStyle(.plain)
                HStack(alignment: .top, spacing: 8) {
                    ForEach(0..<2, id: \.self) { k in
                        VStack(spacing: 8) { ForEach(cols[k]) { n in keepCard(n).lively("note:\(n.id)", "\(n.updated_at)") } }.frame(maxWidth: .infinity, alignment: .top)
                    }
                }
                if list.isEmpty { T(query.isEmpty ? "Notes you take will show up here." : "No notes match.", 14, H.faint).padding(.top, 16) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .background(H.bg)
    }

    // Two columns; each card goes to the currently shorter one.
    private func columns(_ list: [Note]) -> [[Note]] {
        var c: [[Note]] = [[], []]
        var h = [0, 0]
        for n in list {
            let k = h[0] <= h[1] ? 0 : 1
            c[k].append(n)
            h[k] += 60 + min(10, n.body.count / 22 + 1) * 18
        }
        return c
    }

    private func keepCard(_ n: Note) -> some View {
        let c = store.course(n.course_id)
        let tint = c.map { Color(hex: $0.color) }
        let name = sel == "all" ? c?.name : nil
        let day = n.session_date.map(Dates.short)
        return VStack(alignment: .leading, spacing: 6) {
            if !n.title.isEmpty {
                HStack(alignment: .top) {
                    T(n.title, 15, bold: true)
                    Spacer(minLength: 0)
                    if n.pinned == 1 { Image(systemName: "pin.fill").font(.system(size: 11)).foregroundStyle(H.gold) }
                }
            }
            if !n.body.isEmpty { Text(NoteFormat.plainText(n.body)).font(.system(size: 14)).foregroundStyle(H.fg.opacity(0.85)).lineLimit(10) }
            // Course and day on one line: a long course name shortens with "…"; the day always shows.
            if name != nil || day != nil {
                HStack(spacing: 8) {
                    if let name { Text(name).font(H.mono(11, bold: true)).foregroundStyle(tint ?? H.muted).lineLimit(1).truncationMode(.tail) }
                    if let day { Text(day).font(H.mono(11)).foregroundStyle(H.muted).lineLimit(1).fixedSize() }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.map { $0.opacity(0.14) } ?? H.surface)
        .background(H.bg)
        .overlay(Rectangle().stroke(tint?.opacity(0.45) ?? H.border, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { path.append(.note(n.id)) }
    }

    private func folder(_ label: String, _ swatch: Color?, _ key: String) -> some View {
        let on = sel == key
        return Button { sel = key } label: {
            HStack(spacing: 8) {
                if let swatch { Rectangle().fill(swatch).frame(width: 10, height: 10) }
                T(label, 14, on ? H.fg : H.muted, bold: on)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(on ? H.surface2 : .clear)
            .overlay(Rectangle().stroke(on ? H.faint : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

func ordinal(_ n: Int) -> String {
    let v = n % 100
    return "\(n)" + ((11...13).contains(v) ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0])
}

// "Every Tue, Thu", "Daily", "Monthly on the 15th", "Yearly on 2 Nov", "... until Fri 3 Jul 2027"
func repeatText(_ e: Event) -> String {
    guard let r = e.repeat else { return "Once, " + Dates.short(e.start_date) }
    let n = r.interval ?? 1
    let (_, m, d) = Dates.parts(e.start_date)
    var s: String
    switch r.freq {
    case "daily": s = n > 1 ? "Every \(n) days" : "Daily"
    case "monthly": s = (n > 1 ? "Every \(n) months" : "Monthly") + " on the " + ordinal(d)
    case "yearly": s = (n > 1 ? "Every \(n) years" : "Yearly") + " on \(d) " + Dates.months[m - 1]
    default: s = (n > 1 ? "Every \(n) weeks on " : "Every ") + ((r.days?.isEmpty ?? true) ? [Dates.iso(e.start_date)] : r.days!).map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
    }
    if let u = r.until {
        s += " until " + Dates.short(u)
        if r.freq == "monthly" || r.freq == "yearly" { s += " " + String(u.prefix(4)) }
    }
    return s
}

// MARK: - Time

struct TimeView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets

    var body: some View {
        Ticking { clock in
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        let alarms = store.alarms.map { ($0, Alarms.next($0, store.db.courses, store.db.events, clock)) }.sorted { ($0.1 ?? Int64.max) < ($1.1 ?? Int64.max) }
                        if alarms.isEmpty { T("No alarms yet. Tap the alarm button to add one, at a time or before a course.", 13, H.muted) }
                        ForEach(alarms, id: \.0.id) { item in
                            let a = item.0
                            let next = item.1
                            Card(live: ("alarm:\(a.id)", "\(a.updated_at)")) {
                                HStack(spacing: 12) {
                                    T(a.time.map(Dates.t) ?? next.map(Dates.clock) ?? "—", 24, bold: true).frame(width: 128, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 2) {
                                        T(a.label, 14, lines: 1)
                                        T(alarmSub(a) + (next.map { "  ·  next " + Dates.short(Dates.dayOf($0)) + " " + Dates.clock($0) } ?? ""), 11, H.muted, lines: 2)
                                    }
                                    Spacer()
                                    BurstToggle(on: a.enabled == 1) { store.setEnabled(a, $0) }
                                    Button { store.removeAlarm(a) } label: { Image(systemName: "trash").foregroundStyle(H.muted) }
                                }
                            }
                            .opacity(a.enabled == 1 ? 1 : 0.55)
                        }
                        Spacer(minLength: 72)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                }
                Fab(icon: "alarm") { sheets.alarm = true }
            }
            .background(H.bg)
        }
    }

    private func alarmSub(_ a: Alarm) -> String {
        if a.lead_course_id != nil || a.lead_event_id != nil { return "Rings \(a.lead_minutes ?? 10) min before the lecture" }
        if let d = a.date { return "Once, " + Dates.short(d) }
        if a.days.isEmpty { return "Every day" }
        if a.days == [1, 2, 3, 4, 5] { return "Weekdays" }
        return a.days.map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
    }
}

// MARK: - Timers

// One big number with Start / Stop. Tap the number to change the length;
// + schedules one for later, listed under the buttons.
struct TimersView: View {
    @EnvironmentObject var store: Store
    @AppStorage("timer_length") private var length = 25
    @State private var dialog: Bool? // false: length, true: for later
    @State private var mins = ""
    @State private var label = ""
    @State private var at = Date().addingTimeInterval(3600)

    var body: some View {
        Ticking { clock in
            let current = store.timers.filter { ($0.state == "running" && ($0.start_at ?? 0) <= clock) || $0.state == "paused" }.min { ($0.ends_at ?? 0) < ($1.ends_at ?? 0) }
            let upcoming = store.timers.filter { $0.state == "running" && ($0.start_at ?? 0) > clock }.sorted { ($0.start_at ?? 0) < ($1.start_at ?? 0) }
            ScrollView {
                VStack(spacing: 14) {
                    T(current?.label ?? "Tap the time to change it", 14, H.muted).padding(.top, 48)
                    T(Dates.countdown(current.map { store.timerLeft($0, clock) } ?? Int64(length * 60)), 72, current == nil ? H.muted : H.fg, bold: true)
                        .onTapGesture { if current == nil { open(false) } }
                    HStack(spacing: 10) {
                        HButton(current == nil ? "Start timer" : "Stop timer", icon: current == nil ? "play.fill" : "stop.fill", primary: true) {
                            if let c = current { store.stop(c) } else { store.startTimer(seconds: length * 60, label: "") }
                        }
                        .frame(width: 200)
                        HButton("", icon: "plus") { open(true) }
                    }
                    if !upcoming.isEmpty {
                        SectionLabel(text: "Upcoming").padding(.top, 20)
                        ForEach(upcoming) { t in
                            HStack {
                                T(Dates.clock(t.start_at ?? 0), 16, bold: true).frame(width: 110, alignment: .leading)
                                T(t.label, 13, H.muted, lines: 1)
                                Spacer()
                                Button { store.stop(t) } label: { Image(systemName: "trash").foregroundStyle(H.muted).frame(width: 36, height: 36) }
                            }
                        }
                    }
                }
                .padding(.horizontal, 18)
            }
            .background(H.bg)
        }
        .onAppear { store.sweepTimers() }
        .sheet(isPresented: Binding(get: { dialog != nil }, set: { if !$0 { dialog = nil } })) {
            let later = dialog ?? false
            SheetFrame(title: later ? "Timer for later" : "Timer length") {
                Field(label: "Minutes", text: $mins).keyboardType(.numberPad)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { ForEach([5, 10, 15, 25, 30, 45, 60], id: \.self) { m in HButton("\(m)") { mins = String(m) } } }
                }
                if later {
                    HStack { T("STARTS AT", 11, H.muted); Spacer(); DatePicker("", selection: $at, displayedComponents: .hourAndMinute).labelsHidden().colorScheme(.dark) }
                    Field(label: "Label (optional)", text: $label)
                }
                HButton(later ? "Schedule" : "Set", primary: true, enabled: (Int(mins) ?? 0) > 0) { submit(later) }
            }
            .presentationDetents([.medium])
        }
    }

    private func open(_ later: Bool) {
        mins = String(length); label = ""; at = Date().addingTimeInterval(3600)
        dialog = later
    }

    private func submit(_ later: Bool) {
        guard let m = Int(mins), m > 0 else { return }
        if later {
            var cal = Calendar(identifier: .gregorian); cal.timeZone = Dates.zone
            let hm = Calendar.current.dateComponents([.hour, .minute], from: at)
            if var d = cal.date(bySettingHour: hm.hour ?? 0, minute: hm.minute ?? 0, second: 0, of: Date()) {
                if d <= Date() { d = d.addingTimeInterval(86400) }
                store.startTimer(seconds: m * 60, label: label, startAt: Int64(d.timeIntervalSince1970 * 1000))
            }
        } else { length = m }
        dialog = nil
    }
}

// MARK: - Note editor

// A note, written like a word processor: what you see is the note. Select
// text, then the toolbar: font, size, bold, italic, underline, strike,
// headings, lists, to-dos (tap a box to tick it), pictures and files (shown in
// place). Saves by itself 700 ms after the last change, and on the way out.
struct NoteView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var title = ""
    @State private var savedBody = ""
    @State private var loaded = false
    @State private var dirty = false
    @State private var edits = 0 // every change; the save waits for a quiet moment
    @State private var confirmDelete = false
    @State private var restoreChoice: NoteVersion?
    @State private var uploading: String?
    @State private var importing = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pictures: [String: UIImage] = [:]
    @StateObject private var opener = FileOpener()
    @StateObject private var rich = RichNoteController()

    private func edited() { if loaded { dirty = true; edits += 1 } }

    // Each picture in the note, from this phone's copy (downloaded once).
    private func loadPictures(_ md: String) {
        for l in NoteFormat.parse(md) where l.kind == "image" {
            guard let fid = l.fileId, pictures[fid] == nil, let f = store.file(fid) else { continue }
            Task {
                guard let url = try? await store.download(f), let img = UIImage(contentsOfFile: url.path) else { return }
                let scaled = img.preparingThumbnail(of: CGSize(width: 1600, height: 1600 * img.size.height / max(1, img.size.width))) ?? img
                pictures[fid] = scaled
                rich.pictureLoaded(fid)
            }
        }
    }

    // Pictures and files: uploaded to the Drive (the note's course folder, or
    // "Note attachments"), then shown in the note after the cursor's line.
    private func attach(_ files: [(URL, String?)]) {
        guard !files.isEmpty else { return }
        let course = store.notes.first { $0.id == id }?.course_id
        uploading = files.count > 1 ? "Uploading \(files.count) files…" : "Uploading…"
        Task {
            var failed: String?
            for (url, name) in files {
                do {
                    let f = try await store.upload(url, name: name, folder: nil, course: course, note: id)
                    let picture = f.mime.hasPrefix("image/")
                    if picture, let img = UIImage(contentsOfFile: url.path) { pictures[f.id] = img.preparingThumbnail(of: CGSize(width: 1600, height: 1600 * img.size.height / max(1, img.size.width))) ?? img }
                    rich.insertFile(NoteLine(kind: picture ? "image" : "file", fileId: f.id, fileName: f.name))
                } catch { failed = error.localizedDescription }
            }
            uploading = failed.map { "Upload failed: \($0)" }
        }
    }

    private func stamp(_ ms: Int64) -> String {
        let d = Dates.dayOf(ms)
        return Dates.short(d) + " " + Dates.clock(ms)
    }

    @ViewBuilder private func tool(_ icon: String, _ on: Bool = false, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Image(systemName: icon).foregroundStyle(on ? H.fg : H.muted).frame(width: 36, height: 34).background(on ? H.surface2 : Color.clear)
        }
    }

    var body: some View {
        let note = store.notes.first { $0.id == id }
        VStack(alignment: .leading, spacing: 8) {
            // Which course and day this note belongs to; changes save at once.
            Segmented(options: [("No course", String?.none)] + store.courses.map { ($0.name, Optional($0.id)) },
                      value: Binding(get: { note?.course_id }, set: { v in if var n = note { save(); n = store.notes.first { $0.id == id } ?? n; n.course_id = v; store.save(n) } }))
            DateField(label: "Date", value: Binding(get: { note?.session_date }, set: { v in if var n = note { save(); n = store.notes.first { $0.id == id } ?? n; n.session_date = v; store.save(n) } }), clearable: true)
            TextField("", text: $title, prompt: Text("Title").foregroundStyle(H.faint))
                .font(H.mono(26, bold: true)).foregroundStyle(H.fg).tint(H.accent)
                .onChange(of: title) { _, _ in edited() }
            Rectangle().fill(H.border).frame(height: 1)
            // The toolbar: always there, it works on the selection (or on what is typed next).
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    Menu {
                        ForEach(NoteFormat.fonts, id: \.self) { f in Button(f) { rich.setFont(f) } }
                    } label: {
                        Text(rich.here.font ?? NoteFormat.fonts[0]).font(NoteFonts.swiftUI(rich.here.font ?? NoteFormat.fonts[0], size: 13)).foregroundStyle(H.fg)
                            .lineLimit(1).padding(.horizontal, 8).frame(height: 30).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    }
                    Menu {
                        ForEach(NoteFormat.sizes, id: \.self) { z in Button("\(z)") { rich.setSize(z) } }
                    } label: {
                        Text("\(rich.here.size ?? NoteFormat.defaultSize)").font(H.mono(13)).foregroundStyle(H.fg)
                            .padding(.horizontal, 8).frame(height: 30).overlay(Rectangle().stroke(H.border, lineWidth: 1))
                    }
                    tool("bold", rich.here.b) { rich.toggle("b") }
                    tool("italic", rich.here.i) { rich.toggle("i") }
                    tool("underline", rich.here.u) { rich.toggle("u") }
                    tool("strikethrough", rich.here.s) { rich.toggle("s") }
                    tool("textformat.size") { rich.setHeading(2) }
                    tool("list.bullet") { rich.setList("ul") }
                    tool("list.number") { rich.setList("ol") }
                    tool("checklist") { rich.setList("todo") }
                    Rectangle().fill(H.border).frame(width: 1, height: 22)
                    PhotosPicker(selection: $photoItems, matching: .images) {
                        Image(systemName: "photo").foregroundStyle(H.muted).frame(width: 36, height: 34)
                    }
                    Button { importing = true } label: { Image(systemName: "paperclip").foregroundStyle(H.muted).frame(width: 36, height: 34) }
                }
            }
            Rectangle().fill(H.border).frame(height: 1)
            RichNoteEditor(controller: rich)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, 20)
        .background(H.bg)
        .onAppear {
            guard let note, !loaded else { return }
            rich.onEdited = { edited() }
            rich.onOpenFile = { fid in if let f = store.file(fid) { opener.open(f, store) } }
            rich.imageFor = { fid in pictures[fid] }
            title = note.title
            savedBody = note.body
            rich.load(note.body)
            loadPictures(note.body)
            loaded = true
        }
        // 700 ms after the last change; a change cancels the wait, not starts a save.
        .task(id: edits) {
            guard dirty else { return }
            do { try await Task.sleep(nanoseconds: 700_000_000) } catch { return }
            save()
        }
        .onDisappear { save() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r else { return }
            // Copied out first: a picked file is only readable while in scope.
            let copies: [(URL, String?)] = urls.compactMap { u in
                let scoped = u.startAccessingSecurityScopedResource()
                defer { if scoped { u.stopAccessingSecurityScopedResource() } }
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + u.lastPathComponent)
                return (try? FileManager.default.copyItem(at: u, to: dest)) != nil ? (dest, u.lastPathComponent) : nil
            }
            attach(copies)
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            photoItems = []
            Task {
                var out: [(URL, String?)] = []
                for (i, item) in items.enumerated() {
                    guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                    let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                    let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                    if (try? data.write(to: dest)) != nil { out.append((dest, "Photo \(Dates.today()) \(i + 1).\(ext)")) }
                }
                attach(out)
            }
        }
        .quickLookPreview($opener.url)
        .fullScreenCover(item: $opener.viewing) { set in MediaViewer(set: set, opener: opener).environmentObject(store) }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                T(uploading ?? (dirty ? "Edited" : "Saved"), 11, uploading != nil ? H.gold : H.faint)
                Button { if var n = note { n.pinned = n.pinned == 1 ? 0 : 1; store.save(n) } } label: {
                    Image(systemName: note?.pinned == 1 ? "pin.fill" : "pin").foregroundStyle(note?.pinned == 1 ? H.gold : H.muted)
                }
                Button { confirmDelete = true } label: { Image(systemName: "trash").foregroundStyle(H.muted) }
                Menu {
                    let versions = store.versions(id)
                    Section(versions.isEmpty ? "No older versions yet" : "Versions") {
                        ForEach(versions) { v in
                            Button { save(); restoreChoice = v } label: {
                                Text(stamp(v.saved_at ?? 0) + (v.reason == "conflict" ? " · other device" : v.reason == "restore" ? " · before a restore" : ""))
                                Text(NoteFormat.preview(v.body, max: 60))
                            }
                        }
                    }
                } label: { Image(systemName: "ellipsis.circle").foregroundStyle(H.muted) }
            }
        }
        .confirmationDialog("Restore this version?", isPresented: Binding(get: { restoreChoice != nil }, set: { if !$0 { restoreChoice = nil } }), titleVisibility: .visible) {
            Button("Restore") {
                if let v = restoreChoice {
                    store.restore(v)
                    title = v.title; savedBody = v.body
                    rich.load(v.body); loadPictures(v.body)
                    dirty = false
                }
                restoreChoice = nil
            }
        } message: { Text("The note goes back to that text. What it says now is kept as a version too.") }
        .confirmationDialog("Delete note?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { dirty = false; store.deleteNote(id); dismiss() }
        } message: { Text("\"\(title.isEmpty ? "Untitled" : title)\" will be removed from every device.") }
    }

    private func save() {
        guard dirty, var n = store.notes.first(where: { $0.id == id }) else { return }
        let md = rich.markdown()
        n.title = title
        n.body = md
        savedBody = md
        store.save(n)
        dirty = false
    }
}

// World clock tab: cities, and which one is the app's time zone (synced).
struct ClockView: View {
    @EnvironmentObject var store: Store
    @State private var query = ""

    var body: some View {
        Ticking { clock in
            let now = Date(timeIntervalSince1970: Double(clock) / 1000)
            let home = Dates.zone
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        T("Hourglass runs on \(city(home.identifier)) time", 13, H.muted)
                    }
                    Field(label: "Add a city", text: $query, placeholder: "e.g. Tokyo")
                    let q = query.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: " ", with: "_")
                    let hits = q.isEmpty ? [] : Array(TimeZone.knownTimeZoneIdentifiers.filter { $0.contains("/") && $0.lowercased().contains(q) }.prefix(8))
                    if !hits.isEmpty {
                        // Matches drop down under the field.
                        VStack(spacing: 0) {
                            ForEach(Array(hits.enumerated()), id: \.element) { i, z in
                                if i > 0 { Rectangle().fill(H.border).frame(height: 1) }
                                Button { store.addClock(z); query = "" } label: {
                                    HStack(spacing: 8) {
                                        T(city(z), 15)
                                        T(z.components(separatedBy: "/")[0].replacingOccurrences(of: "_", with: " "), 12, H.faint)
                                        Spacer()
                                        T(time(now, TimeZone(identifier: z)!), 15, H.muted)
                                    }
                                    .padding(.horizontal, 14).padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(H.surface)
                        .overlay(Rectangle().stroke(H.faint, lineWidth: 1))
                        .padding(.top, -6)
                    }
                    ForEach(store.clocks) { c in
                        if let z = TimeZone(identifier: c.zone) {
                            let isHome = z.identifier == home.identifier
                            let diff = (z.secondsFromGMT(for: now) - home.secondsFromGMT(for: now)) / 60
                            Card(stripe: isHome ? H.accent : nil) {
                                HStack {
                                    T(c.label, 16, bold: true)
                                    Spacer()
                                    if isHome { Chip(text: "App time", tint: H.accent) }
                                    else { Button { store.removeClock(c) } label: { Image(systemName: "xmark").foregroundStyle(H.faint).frame(width: 32, height: 32) } }
                                }
                                T(time(now, z), 34, bold: true)
                                T(day(now, z, home) + (isHome ? "" : "  ·  " + diffText(diff)), 14, H.muted)
                                if !isHome { HButton("Use as app time") { store.setHome(c) }.padding(.top, 8) }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .background(H.bg)
        }
    }

    private func city(_ z: String) -> String { z.components(separatedBy: "/").last!.replacingOccurrences(of: "_", with: " ") }
    private func time(_ now: Date, _ z: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = z
        let c = cal.dateComponents([.hour, .minute], from: now)
        return Dates.t(String(format: "%02ld:%02ld", c.hour!, c.minute!))
    }
    private func day(_ now: Date, _ z: TimeZone, _ home: TimeZone) -> String {
        var a = Calendar(identifier: .gregorian); a.timeZone = z
        var b = Calendar(identifier: .gregorian); b.timeZone = home
        let da = a.dateComponents([.year, .month, .day], from: now), db = b.dateComponents([.year, .month, .day], from: now)
        if da == db { return "Today" }
        return (da.year!, da.month!, da.day!) > (db.year!, db.month!, db.day!) ? "Tomorrow" : "Yesterday"
    }
    private func diffText(_ min: Int) -> String {
        if min == 0 { return "same time" }
        let h = abs(min) / 60, m = abs(min) % 60
        return (min > 0 ? "+" : "−") + "\(h)" + (m > 0 ? String(format: ":%02d", m) : "") + " h"
    }
}
