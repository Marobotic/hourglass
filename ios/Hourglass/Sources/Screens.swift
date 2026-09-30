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
                    ForEach(merge(st.todayList)) { b in BlockCard(b: b, clock: clock).onTapGesture { sheets.session = b.first } }
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
                if state == "live" { Rectangle().fill(H.accent).frame(width: 8, height: 8) }
                Text(state == "live" ? "LIVE NOW" : state == "ended" ? "JUST ENDED" : "UP NEXT").font(H.mono(11, bold: true)).tracking(1.6)
                    .foregroundStyle(state == "live" ? H.accent : H.muted)
                Chip(text: kindLabel(f.kind), tint: color)
                Spacer()
                T(Dates.range(f.start_time, f.end_time), 14, H.muted)
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
                    Rectangle().fill(H.surface2)
                    Rectangle().fill(color).frame(width: g.size.width * (state == "live" ? f.progress(clock) : 0))
                }
            }
            .frame(height: 6).padding(.top, 12)
            T(state == "live" ? Dates.left((f.end_ms - clock + 59_999) / 60_000) : state == "ended" ? "Ended \(Dates.t(f.end_time)). Good time to tidy your notes." : "Starts " + Dates.relative((f.start_ms - clock + 59_999) / 60_000), 12, H.muted)
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
                    T("Next: \(nx.title), \(Dates.short(nx.date)) at \(Dates.t(nx.start_time)) (\(Dates.relative((nx.start_ms - clock) / 60_000)))", 13, H.muted)
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
struct NotesView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]
    @State var sel = "all"
    @State private var query = ""
    @State private var searching = false
    @State private var info = false

    // Notes first: one line of controls, folder chips, then the notes. Course
    // details fold away behind the info button; + writes a note dated today.
    var body: some View {
        let course = store.courses.first { $0.id == sel }
        let list = store.notes.filter { sel == "all" ? true : sel == "inbox" ? $0.course_id == nil : $0.course_id == sel }.sorted { $0.updated_at > $1.updated_at }
        let pinned = list.filter { $0.pinned == 1 }
        let dates = Array(Set(list.filter { $0.pinned == 0 }.compactMap(\.session_date))).sorted(by: >)
        let undated = list.filter { $0.pinned == 0 && $0.session_date == nil }
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    HStack {
                        T(course?.name ?? (sel == "inbox" ? "No course" : "Notes"), 20, bold: true, lines: 1)
                        Spacer()
                        if course != nil { Button { info.toggle() } label: { Image(systemName: "info.circle").foregroundStyle(info ? H.fg : H.muted).frame(width: 36, height: 36) } }
                        Button { searching.toggle(); if !searching { query = "" } } label: { Image(systemName: searching ? "xmark" : "magnifyingglass").foregroundStyle(H.muted).frame(width: 36, height: 36) }
                    }
                    if searching { Field(label: "Search all notes", text: $query) }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            folder("All", nil, "all")
                            ForEach(store.courses) { c in folder(c.code ?? c.name, Color(hex: c.color), c.id) }
                            folder("No course", nil, "inbox")
                            Button { sheets.course = CourseDraft() } label: { T("+ Course", 14, H.muted).padding(.horizontal, 12).padding(.vertical, 8).overlay(Rectangle().stroke(H.border, lineWidth: 1)) }.buttonStyle(.plain)
                        }
                    }
                    if let c = course, info { details(c) }
                    if searching && !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        let words = query.lowercased().split(separator: " ").map(String.init)
                        let hits = store.notes.filter { n in let h = (n.title + "\n" + n.body).lowercased(); return words.allSatisfy { h.contains($0) } }
                        SectionLabel(text: "\(hits.count) result\(hits.count == 1 ? "" : "s")")
                        ForEach(hits) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                    } else {
                        if !pinned.isEmpty {
                            SectionLabel(text: "Pinned")
                            ForEach(pinned) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        ForEach(dates, id: \.self) { d in
                            SectionLabel(text: (d == Dates.today() ? "Today · " : "") + Dates.short(d))
                            ForEach(list.filter { $0.pinned == 0 && $0.session_date == d }) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        if !undated.isEmpty {
                            SectionLabel(text: "No date")
                            ForEach(undated) { n in NoteRow(note: n).onTapGesture { path.append(.note(n.id)) } }
                        }
                        if list.isEmpty { T("No notes yet. Tap + to write one.", 14, H.faint).padding(.top, 12) }
                    }
                    Spacer(minLength: 80)
                }
                .padding(.horizontal, 16).padding(.vertical, 8)
            }
            Fab(icon: "square.and.pencil") { path.append(.note(store.addNote(course: course?.id, date: Dates.today(), event: nil).id)) }
        }
        .background(H.bg)
    }

    private func details(_ c: Course) -> some View {
        Card(stripe: Color(hex: c.color)) {
            HStack {
                T([c.code, c.location].compactMap { $0 }.joined(separator: "  ·  "), 14, bold: true)
                Spacer()
                Button { sheets.course = CourseDraft(course: c) } label: { Image(systemName: "pencil").foregroundStyle(H.muted) }
            }
            ForEach((c.teacher ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }, id: \.self) { t in T(t, 13, H.muted) }
            ForEach(store.events.filter { $0.course_id == c.id }) { e in
                T("\(kindLabel(e.kind))  \(Dates.range(e.start_time, e.end_time))  \(repeatText(e))", 13, lines: 1)
                    .padding(.vertical, 3).onTapGesture { sheets.event = EventDraft(event: e) }
            }
        }
    }

    private func folder(_ label: String, _ swatch: Color?, _ key: String) -> some View {
        let on = sel == key
        return Button { sel = key } label: {
            HStack(spacing: 8) {
                if let swatch { Rectangle().fill(swatch).frame(width: 10, height: 10) }
                T(label, 14, on ? H.fg : H.muted, bold: on)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(on ? H.surface2 : .clear).clipShape(Rectangle())
            .overlay(Rectangle().stroke(on ? H.faint : H.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
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
                        WorldClock(clock: clock)
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
                                    T(a.time.map(Dates.t) ?? next.map(Dates.clock) ?? "—", 24, bold: true).frame(width: 128, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 2) {
                                        T(a.label, 14, lines: 1)
                                        T(alarmSub(a) + (next.map { "  ·  next " + Dates.short(Dates.dayOf($0)) + " " + Dates.clock($0) } ?? ""), 11, H.muted, lines: 2)
                                    }
                                    Spacer()
                                    SquareToggle(on: a.enabled == 1) { store.setEnabled(a, $0) }
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

// Cities: time, day and difference from this phone's zone. Synced.
struct WorldClock: View {
    @EnvironmentObject var store: Store
    let clock: Int64
    @State private var adding = false
    @State private var query = ""

    var body: some View {
        let now = Date(timeIntervalSince1970: Double(clock) / 1000)
        let home = TimeZone.current
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                T("World clock", 24, bold: true)
                Spacer()
                Button { adding.toggle(); query = "" } label: { Image(systemName: adding ? "xmark" : "plus").foregroundStyle(H.muted).frame(width: 36, height: 36) }
            }
            if adding {
                Field(label: "City", text: $query, placeholder: "e.g. Tokyo")
                let q = query.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: " ", with: "_")
                if !q.isEmpty {
                    ForEach(TimeZone.knownTimeZoneIdentifiers.filter { $0.contains("/") && $0.lowercased().contains(q) }.prefix(8), id: \.self) { z in
                        Button { store.addClock(z); adding = false; query = "" } label: {
                            HStack {
                                T(z.components(separatedBy: "/").last!.replacingOccurrences(of: "_", with: " "), 15)
                                Spacer()
                                T(time(now, TimeZone(identifier: z)!), 15, H.muted)
                            }
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            ForEach(store.clocks) { c in
                if let z = TimeZone(identifier: c.zone) {
                    let isHome = z.identifier == home.identifier
                    let diff = (z.secondsFromGMT(for: now) - home.secondsFromGMT(for: now)) / 60
                    Card(stripe: isHome ? H.accent : nil) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                T(c.label, 15, bold: true)
                                T(day(now, z, home) + (isHome ? "  ·  this phone" : "  ·  " + diffText(diff)), 13, H.muted)
                            }
                            Spacer()
                            T(time(now, z), 28, bold: true)
                            if !isHome { Button { store.removeClock(c) } label: { Image(systemName: "xmark").foregroundStyle(H.faint).frame(width: 32, height: 32) } }
                        }
                    }
                }
            }
        }
    }

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
