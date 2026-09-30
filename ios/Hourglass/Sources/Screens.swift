import SwiftUI

// MARK: - Now

struct NowView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]

    var body: some View {
        Ticking { clock in
            let st = store.now(clock)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        T(Dates.long(st.today), 13, H.muted)
                        T(Dates.clock(clock), 40, bold: true)
                    }
                    if let f = st.focus { hero(f, st.notes.session, clock) } else { idleCard(st, clock) }
                    if st.focus != nil {
                        SectionLabel(text: "This session", detail: Dates.short(st.focus!.date))
                        if st.notes.session.isEmpty { T("No notes yet for this session.", 12, H.faint) }
                        ForEach(st.notes.session) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        if !st.notes.pinned.isEmpty {
                            SectionLabel(text: "Pinned")
                            ForEach(st.notes.pinned) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        if !st.notes.last.isEmpty {
                            SectionLabel(text: "Last time", detail: st.notes.lastDate.map(Dates.short))
                            ForEach(st.notes.last) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                    }
                    SectionLabel(text: "Today")
                    if st.todayList.isEmpty { T("Nothing scheduled today.", 12, H.faint) }
                    ForEach(st.todayList) { o in TimelineRow(o: o, clock: clock).onTapGesture { sheets.session = o } }
                    SectionLabel(text: "Timers")
                    ForEach(store.timers) { t in TimerCard(t: t, clock: clock) }
                    HStack(spacing: 8) {
                        ForEach([5, 10, 25, 50], id: \.self) { m in
                            HButton("\(m) min") { store.startTimer(seconds: m * 60, label: st.active?.state(clock) == "live" ? st.active!.title : "") }
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
            .background(H.bg)
        }
    }

    private func hero(_ f: Occ, _ session: [Note], _ clock: Int64) -> some View {
        let state = f.state(clock)
        let color = Color(hex: f.color)
        return Card(stripe: color) {
            HStack(spacing: 8) {
                if state == "live" { Circle().fill(H.accent).frame(width: 8, height: 8) }
                Text(state == "live" ? "LIVE NOW" : state == "ended" ? "JUST ENDED" : "UP NEXT").font(H.mono(11, bold: true)).tracking(1.6)
                    .foregroundStyle(state == "live" ? H.accent : H.muted)
                Chip(text: kindLabel(f.kind), tint: color)
                Spacer()
                T("\(f.start_time)–\(f.end_time)", 13, H.muted)
            }
            T(f.title, 28, bold: true).padding(.top, 8)
            HStack(spacing: 14) {
                if let l = f.location { Label { T(l, 13, H.muted) } icon: { Image(systemName: "mappin").foregroundStyle(H.muted) } }
                if let c = f.code { T(c, 13, H.faint) }
            }
            .padding(.top, 4)
            if let t = f.teacher {
                Label { T(t, 13, H.muted) } icon: { Image(systemName: "person").foregroundStyle(H.muted) }.padding(.top, 4)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(H.surface2)
                    Capsule().fill(color).frame(width: g.size.width * (state == "live" ? f.progress(clock) : 0))
                }
            }
            .frame(height: 6).padding(.top, 12)
            T(state == "live" ? Dates.left((f.end_ms - clock + 59_999) / 60_000) : state == "ended" ? "Ended \(f.end_time). Good time to tidy your notes." : "Starts " + Dates.relative((f.start_ms - clock + 59_999) / 60_000), 12, H.muted)
                .padding(.top, 6)
            HStack(spacing: 8) {
                HButton(session.isEmpty ? "Start today's note" : "Open today's note", icon: "square.and.pencil", primary: true) {
                    if let n = session.first { path.append(.note(n.id)) }
                    else { path.append(.note(store.addNote(course: f.course_id, date: f.date, event: f.event_id).id)) }
                }
                HButton("", icon: "folder") { sheets.session = f }
            }
            .padding(.top, 12)
        }
    }

    private func idleCard(_ st: NowState, _ clock: Int64) -> some View {
        Card {
            T(store.courses.isEmpty ? "Welcome to Hourglass" : "Nothing on right now", 20, bold: true)
            Group {
                if let nx = st.next {
                    T("Next: \(nx.title), \(Dates.short(nx.date)) at \(nx.start_time) (\(Dates.relative((nx.start_ms - clock) / 60_000)))", 13, H.muted)
                } else if store.courses.isEmpty {
                    T("Add your courses and their weekly times. During each lecture its notes open right here.", 13, H.muted)
                } else {
                    T("Nothing scheduled in the next 7 days.", 13, H.muted)
                }
            }
            .padding(.top, 6)
            HStack {
                if store.courses.isEmpty { HButton("Add a course", icon: "plus", primary: true) { sheets.course = CourseDraft() } }
                else if let nx = st.next { HButton("Open next session", icon: "folder") { sheets.session = nx } }
            }
            .padding(.top, 12)
        }
    }
}

struct TimelineRow: View {
    let o: Occ
    let clock: Int64
    var body: some View {
        let past = clock >= o.end_ms
        let live = clock >= o.start_ms && !past
        let color = Color(hex: o.color)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) { T(o.start_time, 14, bold: true); T(o.end_time, 11, H.faint) }.frame(width: 52, alignment: .leading)
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 3, height: 34)
            VStack(alignment: .leading, spacing: 1) {
                T(o.title, 14, lines: 1)
                T([o.location.map { String($0.components(separatedBy: " · ")[0]) }, kindLabel(o.kind), o.code].compactMap { $0 }.joined(separator: " · "), 12, H.muted, lines: 1)
            }
            Spacer()
            if live { Circle().fill(H.accent).frame(width: 8, height: 8) }
        }
        .padding(10)
        .background(live ? color.opacity(0.14) : .clear)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .opacity(past ? 0.5 : 1)
        .contentShape(Rectangle())
    }
}

struct TimerCard: View {
    @EnvironmentObject var store: Store
    let t: HTimer
    let clock: Int64
    var big = false
    var body: some View {
        let running = t.state == "running"
        let remain = running ? ((t.ends_at ?? 0) - clock + 999) / 1000 : Int64(t.remaining_s ?? 0)
        Card(stripe: big ? (running ? H.accent : H.faint) : nil) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    T(Dates.countdown(remain), big ? 34 : 22, running ? H.fg : H.muted, bold: true)
                    T(t.label + (running ? "" : "  ·  paused"), 12, H.muted, lines: 1)
                }
                Spacer()
                Button { running ? store.pause(t) : store.resume(t) } label: { Image(systemName: running ? "pause.fill" : "play.fill").foregroundStyle(H.fg).frame(width: 40, height: 40) }
                Button { store.stop(t) } label: { Image(systemName: "xmark").foregroundStyle(H.muted).frame(width: 40, height: 40) }
            }
            if big {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(H.surface2)
                        Capsule().fill(H.accent).frame(width: g.size.width * min(1, max(0, Double(remain) / Double(max(1, t.duration_s)))))
                    }
                }
                .frame(height: 4).padding(.top, 8)
            }
        }
    }
}

// MARK: - Week (agenda)

struct WeekView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @State private var weekStart = Dates.weekStart(Dates.today())
    @State private var selected = Dates.today()

    var body: some View {
        Ticking { clock in
            let occ = store.occurrences(weekStart, Dates.add(weekStart, 6))
            let today = Dates.today()
            ZStack(alignment: .bottomTrailing) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 0) {
                            T(Dates.longMonths[Dates.parts(weekStart).1 - 1] + " \(Dates.parts(weekStart).0)", 13, H.muted)
                            T("\(Dates.parts(weekStart).2) – " + String(Dates.short(Dates.add(weekStart, 6)).dropFirst(4)), 24, bold: true)
                        }
                        Spacer()
                        Button { weekStart = Dates.add(weekStart, -7); selected = weekStart } label: { Image(systemName: "chevron.left").foregroundStyle(H.fg).frame(width: 36, height: 36) }
                        Button { weekStart = Dates.weekStart(today); selected = today } label: { T("Today", 12, H.muted) }
                        Button { weekStart = Dates.add(weekStart, 7); selected = weekStart } label: { Image(systemName: "chevron.right").foregroundStyle(H.fg).frame(width: 36, height: 36) }
                    }
                    HStack(spacing: 6) {
                        ForEach(0..<7, id: \.self) { i in
                            let d = Dates.add(weekStart, i)
                            let isSel = d == selected, isToday = d == today
                            let dots = occ.filter { $0.date == d }.prefix(4)
                            Button { selected = d } label: {
                                VStack(spacing: 2) {
                                    T(String(Dates.weekdays[i].prefix(1)), 11, isToday ? H.accent : H.muted, bold: true)
                                    T("\(Dates.parts(d).2)", 16, isToday ? H.accent : H.fg, bold: true)
                                    HStack(spacing: 2) { ForEach(Array(dots), id: \.id) { o in Circle().fill(Color(hex: o.color)).frame(width: 4, height: 4) } }.frame(height: 6)
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 8)
                                .background(isSel ? H.surface2 : .clear).clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(isSel ? H.faint : H.border, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    SectionLabel(text: Dates.long(selected))
                    let list = occ.filter { $0.date == selected }
                    if list.isEmpty { T("Nothing scheduled.", 12, H.faint) }
                    ScrollView { VStack(spacing: 4) { ForEach(list) { o in TimelineRow(o: o, clock: clock).onTapGesture { sheets.session = o } } } }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                Fab(icon: "plus") { sheets.event = EventDraft(date: selected) }
            }
            .background(H.bg)
        }
    }
}

struct Fab: View {
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 56, height: 56).background(H.accent).clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .padding(18)
    }
}

// MARK: - Notes

// Every note in one place: All, No course, or one course (with its lecturers
// and weekly times), grouped by the day each note belongs to.
struct NotesView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]
    @State var sel = "all"
    @State private var query = ""
    @State private var newDate: String? = Dates.today()

    var body: some View {
        let course = store.courses.first { $0.id == sel }
        let list = store.notes.filter { sel == "all" ? true : sel == "inbox" ? $0.course_id == nil : $0.course_id == sel }.sorted { $0.updated_at > $1.updated_at }
        let pinned = list.filter { $0.pinned == 1 }
        let dates = Array(Set(list.filter { $0.pinned == 0 }.compactMap(\.session_date))).sorted(by: >)
        let undated = list.filter { $0.pinned == 0 && $0.session_date == nil }
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    T("Notes", 26, bold: true)
                    Field(label: "Search all notes", text: $query)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            folder("All", nil, "all")
                            folder("No course", nil, "inbox")
                            ForEach(store.courses) { c in folder(c.code ?? c.name, Color(hex: c.color), c.id) }
                        }
                    }
                    if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        let words = query.lowercased().split(separator: " ").map(String.init)
                        let hits = store.notes.filter { n in let h = (n.title + "\n" + n.body).lowercased(); return words.allSatisfy { h.contains($0) } }
                        SectionLabel(text: "\(hits.count) result\(hits.count == 1 ? "" : "s")")
                        ForEach(hits) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                    } else {
                        if let c = course { header(c) }
                        Card {
                            T(course.map { "New note for \($0.code ?? $0.name)" } ?? "New note", 14, H.muted)
                            HStack(alignment: .bottom) {
                                DateField(label: "Date", value: $newDate)
                                Spacer()
                                HButton("Write", icon: "square.and.pencil", primary: true) {
                                    path.append(.note(store.addNote(course: course?.id, date: newDate ?? Dates.today(), event: nil).id))
                                }
                            }
                            .padding(.top, 8)
                        }
                        if !pinned.isEmpty {
                            SectionLabel(text: "Pinned", detail: "\(pinned.count)")
                            ForEach(pinned) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        ForEach(dates, id: \.self) { d in
                            let day = list.filter { $0.pinned == 0 && $0.session_date == d }
                            SectionLabel(text: (d == Dates.today() ? "Today · " : "") + Dates.long(d), detail: "\(day.count) note\(day.count == 1 ? "" : "s")")
                            ForEach(day) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        if !undated.isEmpty {
                            SectionLabel(text: "No date", detail: "\(undated.count)")
                            ForEach(undated) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        if list.isEmpty { T("No notes yet.", 13, H.faint) }
                    }
                    Spacer(minLength: 72)
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
            Fab(icon: "plus") { sheets.course = CourseDraft() }
        }
        .background(H.bg)
    }

    private func folder(_ label: String, _ swatch: Color?, _ key: String) -> some View {
        let on = sel == key
        return Button { sel = key } label: {
            HStack(spacing: 8) {
                if let swatch { RoundedRectangle(cornerRadius: 2).fill(swatch).frame(width: 10, height: 10) }
                T(label, 14, on ? H.fg : H.muted, bold: on)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(on ? H.surface2 : .clear).clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(on ? H.faint : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func header(_ c: Course) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 3).fill(Color(hex: c.color)).frame(width: 5, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                T(c.name, 22, bold: true)
                T([c.code, c.location].compactMap { $0 }.joined(separator: "  ·  "), 14, H.muted)
            }
            Spacer()
            Button { sheets.course = CourseDraft(course: c) } label: { Image(systemName: "pencil").foregroundStyle(H.muted) }
        }
        let teachers = (c.teacher ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !teachers.isEmpty {
            SectionLabel(text: "Lecturers")
            ForEach(teachers, id: \.self) { t in Label { T(t, 14) } icon: { Image(systemName: "person").foregroundStyle(H.muted) } }
        }
        SectionLabel(text: "Weekly times")
        ForEach(store.events.filter { $0.course_id == c.id }) { e in
            Card {
                HStack(spacing: 10) {
                    Chip(text: kindLabel(e.kind), tint: Color(hex: c.color))
                    T("\(e.start_time)–\(e.end_time)", 15, bold: true)
                    T(repeatText(e), 13, H.muted, lines: 1)
                }
            }
            .onTapGesture { sheets.event = EventDraft(event: e) }
        }
    }
}

func repeatText(_ e: Event) -> String {
    guard let r = e.repeat else { return "Once, " + Dates.short(e.start_date) }
    var s = r.freq == "daily" ? "Daily" : "Every " + ((r.days?.isEmpty ?? true) ? [Dates.iso(e.start_date)] : r.days!).map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
    if let u = r.until { s += " until " + Dates.short(u) }
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
                        T("Timers", 24, bold: true)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) { ForEach([1, 5, 10, 15, 25, 45, 50, 90], id: \.self) { m in HButton("\(m) min") { store.startTimer(seconds: m * 60, label: "") } } }
                        }
                        ForEach(store.timers) { t in TimerCard(t: t, clock: clock, big: true) }
                        T("Alarms", 24, bold: true).padding(.top, 8)
                        let alarms = store.alarms.map { ($0, Alarms.next($0, store.db.courses, store.db.events, clock)) }.sorted { ($0.1 ?? Int64.max) < ($1.1 ?? Int64.max) }
                        if alarms.isEmpty { T("No alarms yet. Tap the alarm button to add one, at a time or before a course.", 13, H.muted) }
                        ForEach(alarms, id: \.0.id) { item in
                            let a = item.0
                            let next = item.1
                            Card {
                                HStack(spacing: 12) {
                                    T(a.time ?? "-\(a.lead_minutes ?? 0)′", 28, bold: true).frame(width: 100, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 2) {
                                        T(a.label, 14, lines: 1)
                                        T(alarmSub(a) + (next.map { "  ·  next " + Dates.short(Dates.dayOf($0)) + " " + Dates.clock($0) } ?? ""), 11, H.muted, lines: 2)
                                    }
                                    Spacer()
                                    Toggle("", isOn: Binding(get: { a.enabled == 1 }, set: { store.setEnabled(a, $0) })).labelsHidden().tint(H.accent)
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
        if a.lead_course_id != nil || a.lead_event_id != nil { return "\(a.lead_minutes ?? 10) min before every session" }
        if let d = a.date { return "Once, " + Dates.short(d) }
        if a.days.isEmpty { return "Every day" }
        if a.days == [1, 2, 3, 4, 5] { return "Weekdays" }
        return a.days.map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
    }
}

// MARK: - Note editor

struct NoteView: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var title = ""
    @State private var text = ""
    @State private var loaded = false
    @State private var dirty = false
    @State private var confirmDelete = false

    var body: some View {
        let note = store.notes.first { $0.id == id }
        VStack(alignment: .leading, spacing: 8) {
            // Which course and day this note belongs to; changes save at once.
            Segmented(options: [("No course", String?.none)] + store.courses.map { ($0.code ?? $0.name, Optional($0.id)) },
                      value: Binding(get: { note?.course_id }, set: { v in if var n = note { save(); n = store.notes.first { $0.id == id } ?? n; n.course_id = v; store.save(n) } }))
            DateField(label: "Date", value: Binding(get: { note?.session_date }, set: { v in if var n = note { save(); n = store.notes.first { $0.id == id } ?? n; n.session_date = v; store.save(n) } }), clearable: true)
            TextField("", text: $title, prompt: Text("Title").foregroundStyle(H.faint))
                .font(H.mono(26, bold: true)).foregroundStyle(H.fg).tint(H.accent)
                .onChange(of: title) { _, _ in if loaded { dirty = true } }
            Rectangle().fill(H.border).frame(height: 1)
            TextEditor(text: $text)
                .font(H.mono(15)).foregroundStyle(H.fg).tint(H.accent).scrollContentBackground(.hidden)
                .onChange(of: text) { _, _ in if loaded { dirty = true } }
        }
        .padding(.horizontal, 20)
        .background(H.bg)
        .onAppear { if let note, !loaded { title = note.title; text = note.body; loaded = true } }
        .task(id: "\(title)\u{1}\(text)") { if dirty { try? await Task.sleep(nanoseconds: 700_000_000); save() } }
        .onDisappear { save() }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                T(dirty ? "Edited" : "Saved", 11, H.faint)
                Button { if var n = note { n.pinned = n.pinned == 1 ? 0 : 1; store.save(n) } } label: {
                    Image(systemName: note?.pinned == 1 ? "pin.fill" : "pin").foregroundStyle(note?.pinned == 1 ? H.gold : H.muted)
                }
                Button { confirmDelete = true } label: { Image(systemName: "trash").foregroundStyle(H.muted) }
            }
        }
        .confirmationDialog("Delete note?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { dirty = false; store.deleteNote(id); dismiss() }
        } message: { Text("\"\(title.isEmpty ? "Untitled" : title)\" will be removed from every device.") }
    }

    private func save() {
        guard dirty, var n = store.notes.first(where: { $0.id == id }) else { return }
        n.title = title
        n.body = text
        store.save(n)
        dirty = false
    }
}
