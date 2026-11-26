import SwiftUI
import PhotosUI
import QuickLook
import UniformTypeIdentifiers

// MARK: - Now

// Now (round 5, desktop/ui/pages/now.js laid out for a phone): the date and the big clock, today as one bar, the
// live (or next) class with its progress, the running timer and next alarm, the rest of today, the notes for this
// class and what is coming this week. An overview, not a dashboard.
struct NowView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]

    var body: some View {
        Ticking { clock in
            let today: String = Dates.dayOf(clock)
            // What is on and what starts in the next 12 hours; a session marked off is not happening.
            let window: [Block] = merge(store.occurrences(today, Dates.add(today, 1)).filter { $0.mark != "off" })
                .filter { $0.endMs > clock && ($0.first.date == today || $0.startMs - clock <= Now.ahead) }
            let current: Block? = window.first
            let later: [Block] = Array(window.dropFirst())
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    NowClock(clock: clock, today: today)
                    DayStrip(today: today, clock: clock)
                    NowHero(b: current, today: today, clock: clock, path: $path)
                    NowTiles(clock: clock, today: today)
                    if !later.isEmpty { RestOfToday(later: later, today: today, clock: clock) }
                    ClassNotes(block: current, today: today, clock: clock, path: $path)
                    ComingUp(today: today, clock: clock, path: $path)
                }
                .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 96)
            }
            .background(H.bg)
        }
    }
}

// The date in caps over the clock: hours and minutes big, the seconds small and faint, AM/PM in a box.
private struct NowClock: View {
    let clock: Int64
    let today: String
    var body: some View {
        let hm: String = Dates.hhmm(clock)
        let mins: Int = Dates.minutes(hm)
        let h: Int = mins / 60
        let big: String = Dates.h24 ? hm : String(format: "%ld:%02ld", (h + 11) % 12 + 1, mins % 60)
        let sec: Int = Int((clock / 1000) % 60)
        let (_, m, d) = Dates.parts(today)
        VStack(alignment: .leading, spacing: 4) {
            Text("\(Dates.longDays[Dates.iso(today) - 1]) \(d) \(Dates.longMonths[m - 1])".uppercased())
                .font(H.ui(13, .bold)).tracking(1.5).foregroundStyle(H.muted)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(big).font(H.ui(72, .bold)).tracking(-3).foregroundStyle(H.fg)
                    .contentTransition(.numericText()).animation(HMotion.on(HMotion.quick), value: big)
                Text(String(format: ":%02ld", sec)).font(H.ui(24, .bold)).foregroundStyle(H.faint)
                if !Dates.h24 {
                    Text(h < 12 ? "AM" : "PM").font(H.ui(14, .bold)).tracking(1).foregroundStyle(H.muted)
                        .padding(.horizontal, 8).frame(height: 24).overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
                        .padding(.leading, 8)
                }
            }
            .lineLimit(1).minimumScaleFactor(0.6)
        }
    }
}

// Today as one bar, 08:00 to 18:00 or wider: the sessions in their colours and a white line at now.
private struct DayStrip: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    let today: String
    let clock: Int64
    var body: some View {
        let list: [Occ] = store.occurrences(today, today).filter { $0.date == today && $0.mark != "off" }
        if !list.isEmpty {
            let startH: Int = min(8, list.map { Dates.minutes($0.start_time) / 60 }.min() ?? 8)
            let endH: Int = max(18, list.map { (Dates.minutes($0.end_time) + 59) / 60 }.max() ?? 18)
            let span: Double = Double((endH - startH) * 60)
            let total: Int = list.reduce(0) { $0 + Dates.minutes($1.end_time) - Dates.minutes($1.start_time) }
            let step: Int = endH - startH > 12 ? 4 : 2
            let nowMin: Double = Double(Dates.minutes(Dates.hhmm(clock)))
            VStack(alignment: .leading, spacing: 0) {
                SectionLabel(text: "Today", detail: "\(list.count) session\(list.count == 1 ? "" : "s") · \(total / 60) h" + (total % 60 > 0 ? " \(total % 60) m" : "") + " of class")
                GeometryReader { g in
                    let at: (Double) -> CGFloat = { m in (g.size.width * CGFloat((m - Double(startH * 60)) / span)).rounded() }
                    ZStack(alignment: .topLeading) {
                        Rectangle().fill(H.surface).overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
                        ForEach(list) { o in
                            let x0: CGFloat = at(Double(Dates.minutes(o.start_time)))
                            let x1: CGFloat = at(Double(Dates.minutes(o.end_time)))
                            Rectangle().fill(Color(hex: o.color).opacity(o.end_ms <= clock ? 0.35 : 0.7))
                                .overlay(alignment: .top) { Color.white.opacity(0.12).frame(height: 1) }
                                .frame(width: max(2, x1 - x0), height: 32)
                                .offset(x: x0, y: 8)
                                .onTapGesture { sheets.session = o }
                        }
                        if nowMin >= Double(startH * 60) && nowMin <= Double(endH * 60) {
                            Rectangle().fill(Color.white).frame(width: 2, height: 56)
                                .shadow(color: H.glowHot.opacity(0.8), radius: 5)
                                .offset(x: at(nowMin) - 1, y: -4)
                        }
                    }
                }
                .frame(height: 48)
                GeometryReader { g in
                    ZStack(alignment: .topLeading) {
                    ForEach(Array(stride(from: startH, through: endH, by: step)), id: \.self) { hr in
                        let x: CGFloat = g.size.width * CGFloat(Double((hr - startH) * 60) / span)
                        let label: String = Dates.h24 ? String(format: "%02d:00", hr) : "\((hr + 11) % 12 + 1) \(hr < 12 || hr == 24 ? "AM" : "PM")"
                        Text(label).font(H.ui(12, .medium)).foregroundStyle(H.faint).fixedSize()
                            .alignmentGuide(.leading) { d in hr == startH ? 0 : hr >= endH ? d.width : d.width / 2 }
                            .offset(x: x.rounded())
                    }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .frame(height: 16).padding(.top, 8)
            }
        }
    }
}

// The hero (REDESIGN §5 Now): the course edge, a breathing red wash while live, the LIVE tag and the kind, time left
// big on the right, the title, time · room · teacher, a ticked progress line with its ends, and the actions. Day off
// is one quiet card, never a big empty hero.
struct NowHero: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    let b: Block?
    let today: String
    let clock: Int64
    @Binding var path: [Route]
    @State private var markFrame = CGRect.zero

    var body: some View {
        if let b { card(b) } else { dayOff }
    }

    private var dayOff: some View {
        let none: Bool = store.courses.isEmpty
        let tomorrow: Block? = merge(store.occurrences(Dates.add(today, 1), Dates.add(today, 1)).filter { $0.mark != "off" }).first
        return Card(pad: 24) {
            T(none ? "Add your classes to get started" : "Nothing else today", 20, bold: true)
            T(none ? "Hourglass opens the right notes when a class starts." : tomorrow.map { "Next: \($0.first.title) · \(Dates.weekdays[Dates.iso($0.first.date) - 1]) \(Dates.t($0.start))" } ?? "Nothing in the next 12 hours.", 14, H.muted)
                .padding(.top, 8)
            if none {
                HStack(spacing: 8) {
                    HButton("Add a course", icon: "plus", primary: true) { sheets.course = CourseDraft() }
                    HButton("Add an event", icon: "calendar.badge.plus") { sheets.event = EventDraft() }
                }
                .padding(.top, 16)
            }
        }
    }

    private func card(_ b: Block) -> some View {
        let live: Bool = clock >= b.startMs && clock < b.endMs
        let color: Color = live ? H.accent : Color(hex: b.first.color)
        let meta: String = [Dates.range(b.start, b.end), b.first.location, b.first.teacher.map { String($0.split(separator: ",").first ?? "") }].compactMap { $0 }.joined(separator: " · ")
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                if live { Chip(text: "Live", style: .live) } else { Chip(text: "Next" + (b.first.date == today ? "" : " · " + Dates.short(b.first.date)), style: .line) }
                Chip(text: kindLabel(b.first.kind), style: .line)
                Spacer(minLength: 0)
                left(b, live)
            }
            Text(b.first.title).font(H.ui(28, .bold)).tracking(-0.5).foregroundStyle(H.fg).lineLimit(3).padding(.top, 16)
            T(meta, 14, H.soft).padding(.top, 8)
            if b.parts.count > 1 { T(b.parts.map { "\(kindLabel($0.kind)) \(Dates.t($0.start_time))" }.joined(separator: " · "), 12, H.faint).padding(.top, 4) }
            if live { HeroProgress(b: b, clock: clock).padding(.top, 24) }
            actions(b, live).padding(.top, 24)
        }
        .padding(.leading, 24).padding(.trailing, 20).padding(.vertical, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(live ? AnyShapeStyle(LinearGradient(colors: [H.accent.opacity(0.24), H.accent.opacity(0.07)], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(H.surface))
        .breathing(live)
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(alignment: .leading) { color.frame(width: 4).shadow(color: live ? H.accent.opacity(0.9) : .clear, radius: 9) }
        .overlay(Rectangle().strokeBorder(live ? H.accent.opacity(0.4) : H.border, lineWidth: 1))
    }

    @ViewBuilder private func left(_ b: Block, _ live: Bool) -> some View {
        if live {
            let m: Int64 = max(0, (b.endMs - clock + 59_999) / 60_000)
            let num: String = m < 60 ? "\(m)" : Dates.left(m).replacingOccurrences(of: " left", with: "")
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(num).font(H.ui(m < 60 ? 28 : 20, .bold)).tracking(-1).foregroundStyle(H.fg)
                    .contentTransition(.numericText()).animation(HMotion.on(HMotion.quick), value: num)
                T(m < 60 ? "min left" : "left", 13, H.accentInk, weight: .medium)
            }
            .lineLimit(1).fixedSize()
        } else {
            T("Starts " + Dates.relative((b.startMs - clock + 59_999) / 60_000), 14, H.muted, lines: 1)
        }
    }

    private func actions(_ b: Block, _ live: Bool) -> some View {
        let o: Occ = b.first
        let session: [Note] = Now.sessionNotes(store.notes, o).session
        return VStack(spacing: 8) {
            if o.course_id != nil {
                // This session's note when there is one, so a tap never makes a second.
                HButton(session.isEmpty ? "Start notes for this class" : "Notes for this class", icon: "doc.text", primary: true) {
                    if let n = session.first { path.append(.note(n.id)) }
                    else { path.append(.note(store.addNote(course: o.course_id, date: o.session.isEmpty ? o.date : o.session, event: o.event_id).id)) }
                }
                .frame(maxWidth: .infinity)
            }
            HStack(spacing: 8) {
                // Marked already: the mark, where the Mark attended button was.
                if let m = o.mark { Chip(text: m == "attended" ? "Attended" : m == "absent" ? "Absent" : "Off", tint: m == "attended" ? H.tealInk : m == "absent" ? H.accentInk : H.muted) }
                if o.course_id != nil && live && o.mark != "attended" {
                    HButton("Mark attended", icon: "person.crop.circle.badge.checkmark") {
                        Motion.shared.burst(in: markFrame)
                        store.setMark(o, "attended")
                    }
                    .burstAnchor($markFrame)
                    .frame(maxWidth: .infinity)
                }
                Spacer(minLength: 0)
                SessionMenu(b: b, path: $path)
            }
        }
    }
}

// The ⋯ beside the hero's actions: open the session, the course's notes, another note, no class today, skip.
private struct SessionMenu: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    let b: Block
    @Binding var path: [Route]
    @State private var confirmSkip = false
    var body: some View {
        let o: Occ = b.first
        Menu {
            Button { sheets.session = o } label: { Label("Open session", systemImage: "calendar") }
            if let cid = o.course_id {
                Button { path.append(.course(cid)) } label: { Label("Course notes", systemImage: "folder") }
                Button {
                    let day: String = o.session.isEmpty ? o.date : o.session
                    let n: Int = Now.sessionNotes(store.notes, o).session.count
                    path.append(.note(store.addNote(course: cid, date: day, event: o.event_id, title: Dates.short(day) + (n > 0 ? " (\(n + 1))" : "")).id))
                } label: { Label("Another note", systemImage: "plus") }
            }
            Divider()
            Button { store.setMark(o, "off") } label: { Label("No class today", systemImage: "bell.slash") }
            Button(role: .destructive) { confirmSkip = true } label: { Label("Skip this date", systemImage: "xmark") }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 16, weight: .medium)).foregroundStyle(H.fg)
                .frame(width: 44, height: 44).background(H.surface3)
                .overlay(alignment: .top) { H.hi.frame(height: 1) }
                .overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
        }
        .confirmationDialog("Skip \(Dates.short(o.date))?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Skip", role: .destructive) { store.skip(o) }
        } message: { Text("Only this session is removed. The rest of the series stays.") }
    }
}

// The live class's progress: a 4 pt track with quarter-hour ticks, a hot head with a glow, the ends and now under it.
private struct HeroProgress: View {
    let b: Block
    let clock: Int64
    var body: some View {
        let frac: CGFloat = CGFloat(min(1, max(0, Double(clock - b.startMs) / Double(max(1, b.endMs - b.startMs)))))
        let ticks: Int = min(16, max(1, Int((Double(b.endMs - b.startMs) / 900_000).rounded())))
        VStack(spacing: 8) {
            GeometryReader { g in
                let w: CGFloat = g.size.width
                ZStack(alignment: .leading) {
                    Rectangle().fill(H.surface4)
                    Rectangle().fill(LinearGradient(colors: [H.accent.opacity(0.7), H.accent], startPoint: .leading, endPoint: .trailing))
                        .frame(width: (w * frac).rounded())
                        .animation(HMotion.on(HMotion.meter), value: frac)
                    ForEach(1..<ticks, id: \.self) { i in
                        Rectangle().fill(H.bg.opacity(0.7)).frame(width: 1).offset(x: (w * CGFloat(i) / CGFloat(ticks)).rounded())
                    }
                    Rectangle().fill(Color.white).frame(width: 3, height: 16)
                        .shadow(color: H.glowHot.opacity(0.9), radius: 6)
                        .offset(x: (w * frac).rounded() - 1)
                        .animation(HMotion.on(HMotion.meter), value: frac)
                }
            }
            .frame(height: 4)
            HStack {
                T(Dates.t(b.start), 12, H.muted, lines: 1)
                Spacer(minLength: 4)
                HStack(spacing: 4) { T(Dates.clock(clock), 12, H.fg, bold: true, lines: 1); T("now", 12, H.muted, lines: 1) }
                Spacer(minLength: 4)
                T(Dates.t(b.end), 12, H.muted, lines: 1)
            }
        }
    }
}

// The running timer (its ring drains) and the next alarm, side by side as tiles.
private struct NowTiles: View {
    @EnvironmentObject var store: Store
    let clock: Int64
    let today: String
    var body: some View {
        let timer: HTimer? = store.timers.first { ($0.state == "running" && ($0.start_at ?? 0) <= clock) || $0.state == "paused" }
        let alarm: (Alarm, Int64)? = store.alarms.compactMap { a in Alarms.nextRing(a, store.db.courses, store.db.events, clock, stoppedAt: RingSync.stoppedAt(store, a.id)).map { (a, $0) } }.min { $0.1 < $1.1 }
        if timer != nil || alarm != nil {
            HStack(spacing: 8) {
                if let t = timer { timerTile(t) }
                if let al = alarm { alarmTile(al.0, al.1) }
            }
        }
    }

    private func timerTile(_ t: HTimer) -> some View {
        let left: Int64 = store.timerLeft(t, clock)
        let frac: CGFloat = CGFloat(Double(left) / Double(max(1, t.duration_s)))
        let paused: Bool = t.state == "paused"
        return HStack(spacing: 12) {
            Button { if paused { store.resume(t) } else { store.pause(t) } } label: {
                ZStack {
                    Circle().stroke(H.surface4, lineWidth: 3)
                    Circle().trim(from: 0, to: frac).stroke(H.accent, style: StrokeStyle(lineWidth: 3)).rotationEffect(.degrees(-90))
                        .shadow(color: H.accent.opacity(0.6), radius: 3)
                    Image(systemName: paused ? "play.fill" : "pause.fill").font(.system(size: 14)).foregroundStyle(H.accentInk)
                }
                .frame(width: 40, height: 40)
            }
            .buttonStyle(PressStyle())
            VStack(alignment: .leading, spacing: 4) {
                Text(Dates.countdown(left)).font(H.ui(20, .bold)).foregroundStyle(paused ? H.soft : H.fg).lineLimit(1)
                    .contentTransition(.numericText()).animation(HMotion.on(HMotion.quick), value: left)
                T((t.label.isEmpty ? "Timer" : t.label) + (paused ? " · paused" : ""), 13, H.muted, lines: 1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12).padding(.leading, 16).padding(.trailing, 12)
        .frame(maxWidth: .infinity)
        .background(H.surface)
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }

    private func alarmTile(_ a: Alarm, _ at: Int64) -> some View {
        let lead: Bool = a.lead_course_id != nil || a.lead_event_id != nil
        let day: String = Dates.dayOf(at)
        let word: String = day == today ? "today" : day == Dates.add(today, 1) ? "tomorrow" : Dates.weekdays[Dates.iso(day) - 1]
        return HStack(spacing: 12) {
            Image(systemName: "bell").font(.system(size: 16)).foregroundStyle(lead ? H.tealInk : H.gold)
                .frame(width: 40, height: 40).background(H.surface3).overlay(alignment: .top) { H.hi.frame(height: 1) }
            VStack(alignment: .leading, spacing: 4) {
                T(Dates.clock(at), 20, bold: true, lines: 1)
                T([Alarms.displayLabel(a, store.db.courses, store.db.events), word].joined(separator: " · "), 13, H.muted, lines: 1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12).padding(.leading, 16).padding(.trailing, 12)
        .frame(maxWidth: .infinity)
        .background(H.surface)
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
    }
}

// The rest of today as a timeline: time, a node in the course colour on a line, title and detail; the next counts down.
private struct RestOfToday: View {
    @EnvironmentObject var sheets: Sheets
    let later: [Block]
    let today: String
    let clock: Int64
    var body: some View {
        let all: Bool = later.allSatisfy { $0.first.date == today }
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: all ? "Rest of today" : "Coming up", detail: "\(later.count) more")
            VStack(spacing: 0) {
                ForEach(Array(later.enumerated()), id: \.element.id) { i, b in
                    TimelineItem(b: b, next: i == 0, first: i == 0, last: i == later.count - 1, clock: clock)
                        .contentShape(Rectangle())
                        .onTapGesture { sheets.session = b.first }
                        .rise(i)
                }
            }
        }
    }
}

private struct TimelineItem: View {
    let b: Block
    let next: Bool
    let first: Bool
    let last: Bool
    let clock: Int64
    var body: some View {
        let color: Color = Color(hex: b.first.color)
        let sub: String = [b.parts.map { kindLabel($0.kind) }.joined(separator: " + "), b.first.location, "until \(Dates.t(b.end))"].compactMap { $0 }.joined(separator: " · ")
        HStack(alignment: .top, spacing: 8) {
            T(Dates.t(b.start), 14, next ? H.fg : H.soft, bold: true, lines: 1)
                .padding(.top, 8)
                .frame(width: 72, alignment: .trailing)
            Rectangle().fill(color).frame(width: 10, height: 10)
                .shadow(color: next ? color.opacity(0.8) : .clear, radius: 6)
                .padding(.top, 13)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                T(b.first.title, 16, bold: true, lines: 1)
                T(sub, 13, H.muted, lines: 1)
                if next { T("Next · starts " + Dates.relative((b.startMs - clock + 59_999) / 60_000), 13, H.tealInk, weight: .semibold, lines: 1).padding(.top, 2) }
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // The line runs through every node, behind it: from the first node to the last, at the row’s full height.
        .background(alignment: .topLeading) {
            GeometryReader { g in
                let top: CGFloat = first ? 18 : 0
                let bottom: CGFloat = last ? 18 : g.size.height
                Rectangle().fill(H.border2).frame(width: 1, height: max(0, bottom - top)).offset(x: 89, y: top)
            }
        }
    }
}

// Notes dated today, then the class's: this session's, else the last one's, and its pinned notes (now.js classNotes).
private struct ClassNotes: View {
    @EnvironmentObject var store: Store
    let block: Block?
    let today: String
    let clock: Int64
    @Binding var path: [Route]
    var body: some View {
        let list: [Note] = notes()
        if !list.isEmpty {
            let c: Course? = store.course(block?.first.course_id)
            let own: Bool = c != nil && list.allSatisfy { $0.course_id == c?.id }
            let live: Bool = block.map { clock >= $0.startMs && clock < $0.endMs } ?? false
            let title: String = own ? (live ? "Notes for this class" : "Notes for \(block?.first.title ?? "")") : "Notes for today"
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: title, detail: "\(list.count)", link: c.map { _ in "All notes" }, action: courseAction(c))
                ForEach(Array(list.enumerated()), id: \.element.id) { i, n in
                    NoteCard(note: n, today: today, clock: clock, lines: 4, todoMax: 4) { path.append(.note(n.id)) }
                        .lively("note:\(n.id)", "\(n.updated_at)")
                        .rise(i)
                }
            }
        }
    }
    private func courseAction(_ c: Course?) -> (() -> Void)? {
        guard let id = c?.id else { return nil }
        return { path.append(.course(id)) }
    }
    private func notes() -> [Note] {
        var out: [Note] = store.notes.filter { $0.session_date == today }
        if let o = block?.first, let cid = o.course_id {
            let day: String = o.session.isEmpty ? o.date : o.session
            let mine: [Note] = store.notes.filter { $0.course_id == cid && ($0.session_date ?? "~") <= day && $0.session_date != nil }
            let last: String? = mine.compactMap(\.session_date).max()
            for n in mine where n.session_date == last && !out.contains(where: { $0.id == n.id }) { out.append(n) }
            for n in store.notes where n.course_id == cid && n.pinned == 1 && !out.contains(where: { $0.id == n.id }) { out.append(n) }
        }
        return Array(out.sorted { ($0.pinned, $0.updated_at) > ($1.pinned, $1.updated_at) }.prefix(6))
    }
}

// Coming up this week: exams and events off the timetable, and the inbox's open to-dos (now.js comingUp).
private struct ComingUp: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    let today: String
    let clock: Int64
    @Binding var path: [Route]
    var body: some View {
        let from: String = Dates.add(today, 1), to: String = Dates.add(today, 7)
        let events: [Occ] = Array(store.occurrences(from, to).filter { $0.mark != "off" && ($0.kind == "exam" || $0.course_id == nil) }.sorted { $0.start_ms < $1.start_ms }.prefix(3))
        let inbox: Note? = events.count < 3 ? store.notes.filter { $0.course_id == nil && NoteFormat.parse($0.body).contains { $0.kind == "todo" && !$0.checked } }.max { $0.updated_at < $1.updated_at } : nil
        if !events.isEmpty || inbox != nil {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Coming up", detail: "this week")
                ForEach(events) { o in
                    let days: Int = Dates.between(today, o.date)
                    UpTile(icon: o.kind == "exam" ? "flag" : "calendar", title: o.title, sub: [Dates.short(o.date), Dates.t(o.start_time), o.location].compactMap { $0 }.joined(separator: " · "), when: days == 1 ? "tomorrow" : "in \(days) days", gold: true)
                        .onTapGesture { sheets.session = o }
                }
                if let n = inbox {
                    let todos: [NoteLine] = NoteFormat.parse(n.body).filter { $0.kind == "todo" }
                    UpTile(icon: "checklist", title: "Inbox · " + (n.title.isEmpty ? "To-dos" : n.title), sub: "\(todos.filter { !$0.checked }.count) of \(todos.count) to-dos left", when: ago(n.updated_at, clock), gold: false)
                        .onTapGesture { path.append(.note(n.id)) }
                }
            }
        }
    }
}

private struct UpTile: View {
    let icon: String
    let title: String
    let sub: String
    let when: String
    let gold: Bool
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(H.muted).frame(width: 40, height: 40).background(H.surface3)
            VStack(alignment: .leading, spacing: 4) {
                T(title, 16, bold: true, lines: 1)
                T(sub, 13, H.muted, lines: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            T(when, 13, gold ? H.gold : H.muted, bold: true, lines: 1).fixedSize()
        }
        .padding(16)
        .background(H.surface)
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

// "5 min ago", "3 h ago", "yesterday", "Tue 3 Nov".
func ago(_ ms: Int64, _ now: Int64) -> String {
    let m: Int64 = max(0, (now - ms) / 60_000)
    if m < 1 { return "just now" }
    if m < 60 { return "\(m) min ago" }
    if m < 1440 { return "\(m / 60) h ago" }
    let d: String = Dates.dayOf(ms)
    if d == Dates.add(Dates.dayOf(now), -1) { return "yesterday" }
    return Dates.short(d)
}

// A note card (desktop parts.js noteCard): the course edge, title with a gold pin, a Noto Sans preview or its
// to-dos with the real 0.3.4 boxes, then course · when · done count.
struct NoteCard: View {
    @EnvironmentObject var store: Store
    let note: Note
    let today: String
    let clock: Int64
    var showCourse = true
    var lines = 2
    var todoMax = 3
    let open: () -> Void
    var body: some View {
        let c: Course? = store.course(note.course_id)
        let edge: Color = c.map { Color(hex: $0.color) } ?? H.border2
        let when: String = note.session_date == today ? "Today" : note.pinned == 1 ? "Pinned" : note.session_date.map(Dates.short) ?? ago(note.updated_at, clock)
        let todos: [NoteLine] = NoteFormat.parse(note.body).filter { $0.kind == "todo" }
        let done: Int = todos.filter(\.checked).count
        let text: String = NoteFormat.preview(note.body, max: 600)
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 8) {
                    T(note.title.isEmpty ? "Untitled" : note.title, 16, bold: true, lines: 2)
                    Spacer(minLength: 0)
                    if note.pinned == 1 { Image(systemName: "pin").font(.system(size: 14)).foregroundStyle(H.gold).padding(.top, 2) }
                }
                if !todos.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(todos.prefix(todoMax).enumerated()), id: \.offset) { _, t in
                            HStack(alignment: .top, spacing: 8) {
                                TodoBox(done: t.checked).padding(.top, 2)
                                Text(t.text.isEmpty ? " " : t.text).font(H.prose(14)).foregroundStyle(t.checked ? H.muted : H.fg)
                                    .strikethrough(t.checked, color: H.muted).lineLimit(1)
                            }
                            .padding(.leading, CGFloat(min(3, t.indent)) * 16)
                        }
                    }
                    .padding(.top, 8)
                } else if !text.isEmpty {
                    Text(text).font(H.prose(14)).foregroundStyle(H.soft).lineSpacing(4).lineLimit(lines).padding(.top, 8)
                }
                HStack(spacing: 8) {
                    if showCourse {
                        Rectangle().fill(edge).frame(width: 8, height: 8)
                        T(c?.name ?? "Inbox", 13, c.map { _ in edge.mix(H.fg, 0.55) } ?? H.muted, weight: .medium, lines: 1)
                        T("·", 13, H.faint)
                    }
                    T(when, 13, H.muted, weight: .medium, lines: 1).fixedSize()
                    if !todos.isEmpty { T("·", 13, H.faint); T("\(done)/\(todos.count) done", 13, H.muted, weight: .medium, lines: 1).fixedSize() }
                    if todos.count > todoMax { T("· \(todos.count - todoMax) more", 13, H.faint, lines: 1).fixedSize() }
                }
                .padding(.top, 12)
            }
            .padding(.vertical, 16).padding(.leading, 19).padding(.trailing, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(H.surface)
            .overlay(alignment: .top) { H.hi.frame(height: 1) }
            .overlay(alignment: .leading) { edge.frame(width: 3) }
            .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
    }
}

extension Color {
    // color-mix(in srgb, self p, other): the desktop's course-name ink is the course colour 45 % into fg.
    func mix(_ other: Color, _ otherShare: Double) -> Color {
        let a = UIColor(self), b = UIColor(other)
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0, r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        a.getRed(&r1, green: &g1, blue: &b1, alpha: &a1); b.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        let p = CGFloat(otherShare)
        return Color(red: Double(r1 * (1 - p) + r2 * p), green: Double(g1 * (1 - p) + g2 * p), blue: Double(b1 * (1 - p) + b2 * p))
    }
}

// MARK: - Schedule

// Week: the week as a list of days (desktop schedule.js agenda, its narrow layout), each day's merged blocks.
// Month: a grid; tap a day for its list. ‹ › move a week or a month, Today comes back.
struct ScheduleView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @AppStorage("schedule_mode") private var mode = "week"
    @State private var anchor = Dates.today()
    @State private var picked = Dates.today()
    @State private var first = true

    var body: some View {
        Ticking { clock in
            let month: Bool = mode == "month"
            let today: String = Dates.today()
            let ws: String = Dates.displayWeekStart(anchor)
            let firstOfMonth: String = String(anchor.prefix(8)) + "01"
            let gridStart: String = Dates.displayWeekStart(firstOfMonth)
            let (y, m, _) = Dates.parts(firstOfMonth)
            let lastDay: String = Dates.format(Dates.utc.date(from: DateComponents(year: y, month: m + 1, day: 0))!)
            let weeks: Int = (Dates.between(gridStart, lastDay) + 7) / 7
            let from: String = month ? gridStart : ws
            let to: String = month ? Dates.add(gridStart, weeks * 7 - 1) : Dates.add(ws, 6)
            let blocks: [Block] = merge(store.occurrences(from, to))
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    head(month, ws, y, m, blocks)
                    if !month {
                        ForEach(0..<7, id: \.self) { i in
                            let d: String = Dates.add(ws, i)
                            DaySection(day: d, today: today, blocks: blocks.filter { $0.first.date == d }, clock: clock)
                                .rise(first ? i : 0)
                        }
                    } else {
                        MonthGrid(gridStart: gridStart, weeks: weeks, monthPrefix: String(firstOfMonth.prefix(7)), today: today, blocks: blocks, picked: $picked)
                        DaySection(day: picked, today: today, blocks: blocks.filter { $0.first.date == picked }, clock: clock)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 96)
            }
            .background(H.bg)
            .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { first = false } }
        }
    }

    private func head(_ month: Bool, _ ws: String, _ y: Int, _ m: Int, _ blocks: [Block]) -> some View {
        let we: String = Dates.add(ws, 6)
        let (_, m1, d1) = Dates.parts(ws)
        let (_, m2, d2) = Dates.parts(we)
        let title: String = month ? "\(Dates.longMonths[m - 1]) \(y)" : (m1 == m2 ? "\(d1) – \(d2) \(Dates.longMonths[m2 - 1])" : "\(d1) \(Dates.months[m1 - 1]) – \(d2) \(Dates.months[m2 - 1])")
        let on: [Block] = blocks.filter { $0.first.mark != "off" }
        let mins: Int = on.reduce(0) { $0 + Int(($1.endMs - $1.startMs) / 60_000) }
        let ctx: String = "\(on.count) session\(on.count == 1 ? "" : "s")" + (mins > 0 ? " · \(mins / 60) h" + (mins % 60 > 0 ? " \(mins % 60) m" : "") + " of class" : "")
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    T(title, 24, bold: true, lines: 1).minimumScaleFactor(0.8)
                    Text(ctx.uppercased()).font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
                HButton("", icon: "chevron.left") { step(month, -1, y, m, ws) }
                HButton("", icon: "chevron.right") { step(month, 1, y, m, ws) }
            }
            HStack(spacing: 8) {
                Segmented(options: [("Week", "week"), ("Month", "month")], value: $mode).fixedSize()
                Spacer(minLength: 0)
                HButton("Today", icon: "clock", ghost: true) { anchor = Dates.today(); picked = Dates.today() }
            }
        }
    }

    private func step(_ month: Bool, _ n: Int, _ y: Int, _ m: Int, _ ws: String) {
        if month { anchor = Dates.format(Dates.utc.date(from: DateComponents(year: y, month: m + n, day: 1))!) }
        else { anchor = Dates.add(ws, 7 * n) }
    }
}

// One day: its label (today in red), the count, then the session cards; a free day says so.
private struct DaySection: View {
    @EnvironmentObject var sheets: Sheets
    let day: String
    let today: String
    let blocks: [Block]
    let clock: Int64
    var body: some View {
        let isToday: Bool = day == today
        let (_, m, d) = Dates.parts(day)
        let label: String = "\(Dates.weekdays[Dates.iso(day) - 1]) \(d) \(Dates.months[m - 1])".uppercased()
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if isToday { Text("TODAY ·").font(H.ui(13, .bold)).tracking(1).foregroundStyle(H.fg) }
                Text(label).font(H.ui(13, .bold)).tracking(1).foregroundStyle(isToday ? H.accentInk : H.muted)
                Spacer(minLength: 0)
                T(blocks.isEmpty ? "Free" : "\(blocks.count) session\(blocks.count == 1 ? "" : "s")", 12, H.faint, lines: 1)
            }
            .padding(.top, 8)
            ForEach(blocks) { b in
                BlockCard(b: b, clock: clock)
                    .onTapGesture { sheets.session = b.first }
            }
        }
    }
}

private struct MonthGrid: View {
    let gridStart: String
    let weeks: Int
    let monthPrefix: String
    let today: String
    let blocks: [Block]
    @Binding var picked: String
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(0..<7, id: \.self) { i in
                    Text(Dates.weekdays[Dates.iso(Dates.add(gridStart, i)) - 1].uppercased()).font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.faint).frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 8)
            ForEach(0..<weeks, id: \.self) { w in
                HStack(spacing: 0) {
                    ForEach(0..<7, id: \.self) { i in cell(Dates.add(gridStart, w * 7 + i)) }
                }
            }
        }
    }
    private func cell(_ d: String) -> some View {
        let list: [Block] = blocks.filter { $0.first.date == d }
        let inMonth: Bool = d.hasPrefix(monthPrefix)
        let isToday: Bool = d == today
        return VStack(alignment: .leading, spacing: 3) {
            T("\(Dates.parts(d).2)", 14, isToday ? H.accentInk : inMonth ? H.fg : H.faint, bold: isToday)
            ForEach(list.prefix(3)) { b in Rectangle().fill(Color(hex: b.first.color)).frame(height: 4) }
            Spacer(minLength: 0)
        }
        .padding(4)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
        .background(d == picked ? H.surface3 : H.surface)
        .overlay(Rectangle().strokeBorder(d == picked ? H.border2 : H.border, lineWidth: 0.5))
        .contentShape(Rectangle())
        .onTapGesture { picked = d }
    }
}

// MARK: - Notes

// Notes (desktop notes.js, laid out for a phone): the folders as a row of chips with counts (All, Inbox, Pinned and
// each course), "Take a note" (the one new-note button, red) with a to-do list button beside it, the list's own
// search, the class that is live now with today's notes, then every card, tinted by course.
struct NotesView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var path: [Route]
    @State var sel = "all"
    var pushed = false
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var searching = false
    @FocusState private var searchFocus: Bool
    init(path: Binding<[Route]>, sel: String = "all", pushed: Bool = false) {
        self._path = path; self._sel = State(initialValue: sel); self.pushed = pushed
    }

    var body: some View {
        // The live class band changes by the minute, not the second.
        TimelineView(.everyMinute) { tl in
            let clock: Int64 = Int64(tl.date.timeIntervalSince1970 * 1000)
            let today: String = Dates.today()
            let course: Course? = store.courses.first { $0.id == sel }
            let words: [String] = query.lowercased().split(separator: " ").map(String.init)
            let all: [Note] = store.notes
                .filter { sel == "all" ? true : sel == "inbox" ? $0.course_id == nil : sel == "pinned" ? $0.pinned == 1 : $0.course_id == sel }
                .filter { n in words.isEmpty || words.allSatisfy { (n.title + "\n" + NoteFormat.plainText(n.body)).lowercased().contains($0) } }
                .sorted { ($0.pinned, $0.updated_at) > ($1.pinned, $1.updated_at) }
            let live: Occ? = sel == "all" && words.isEmpty ? liveClass(clock) : nil
            let band: [Note] = live.map { o in all.filter { $0.course_id == o.course_id && $0.session_date == today } } ?? []
            let rest: [Note] = all.filter { n in !band.contains { $0.id == n.id } }
            VStack(spacing: 0) {
                if pushed { PageHeader(title: course?.name ?? "Notes", back: { dismiss() }) { EmptyView() } }
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 8) {
                            T(course?.name ?? (sel == "inbox" ? "Inbox" : sel == "pinned" ? "Pinned" : "Notes"), 24, bold: true, lines: 1)
                            Spacer(minLength: 0)
                            HButton("", icon: searching ? "xmark" : "magnifyingglass", ghost: true) {
                                searching.toggle()
                                if searching { searchFocus = true } else { query = "" }
                            }
                        }
                        if searching { searchField }
                        folders
                        if let c = course { courseLine(c) }
                        takeNote(course, live)
                        if !band.isEmpty, let o = live {
                            VStack(alignment: .leading, spacing: 8) {
                                SectionLabel(text: "\(o.title) · live now", detail: "\(band.count)", link: "Open the class", action: { sheets.session = o })
                                ForEach(Array(band.enumerated()), id: \.element.id) { i, n in card(n, today, clock).rise(i) }
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            if !rest.isEmpty && (!band.isEmpty || !words.isEmpty) {
                                SectionLabel(text: !words.isEmpty ? "Found" : "Recent", detail: "\(rest.count)")
                            }
                            ForEach(Array(rest.enumerated()), id: \.element.id) { i, n in card(n, today, clock).rise(i) }
                        }
                        if all.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                T(query.isEmpty ? "Nothing here yet" : "No notes match", 18, bold: true)
                                T(query.isEmpty ? "Notes you take will show up here." : "Try other words.", 14, H.muted)
                            }
                            .padding(.top, 24)
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 96)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(H.bg)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 16)).foregroundStyle(H.faint)
            TextField("", text: $query, prompt: Text("Search notes").foregroundStyle(H.faint))
                .font(H.ui(14)).foregroundStyle(H.fg).tint(H.accent).focused($searchFocus)
        }
        .padding(.horizontal, 12).frame(height: 44)
        .background(H.bg)
        .overlay(Rectangle().strokeBorder(searchFocus ? H.faint : H.border, lineWidth: 1))
        .transition(.opacity.combined(with: .offset(y: -6)))
    }

    // The folders: All, Inbox, Pinned, then each course with its colour square and count, then + Course.
    private var folders: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                folder("all", "All", nil, "doc.text", store.notes.count)
                folder("inbox", "Inbox", nil, "tray", store.notes.filter { $0.course_id == nil }.count)
                folder("pinned", "Pinned", nil, "pin", store.notes.filter { $0.pinned == 1 }.count)
                ForEach(store.courses) { c in folder(c.id, c.name, Color(hex: c.color), nil, store.notes.filter { $0.course_id == c.id }.count) }
                HButton("Course", icon: "plus", subtle: true, compact: true) { sheets.course = CourseDraft() }
            }
        }
    }

    private func folder(_ key: String, _ label: String, _ swatch: Color?, _ icon: String?, _ count: Int) -> some View {
        let on: Bool = sel == key
        return Button { withAnimation(HMotion.on(HMotion.quick)) { sel = key } } label: {
            HStack(spacing: 8) {
                if let swatch { Rectangle().fill(swatch).frame(width: 10, height: 10) }
                else if let icon { Image(systemName: icon).font(.system(size: 14)).foregroundStyle(on ? H.fg : H.muted) }
                T(label, 14, on ? H.fg : H.soft, weight: on ? .bold : .medium, lines: 1)
                T("\(count)", 13, H.faint, lines: 1)
            }
            .padding(.horizontal, 12).frame(height: 40)
            .background(on ? H.surface3 : H.surface)
            .overlay(alignment: .top) { if on { H.hi.frame(height: 1) } }
            .overlay(alignment: .bottom) { if on { H.accent.frame(height: 2) } }
            .overlay(Rectangle().strokeBorder(on ? H.border2 : H.border, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
    }

    private func courseLine(_ c: Course) -> some View {
        HStack(spacing: 12) {
            T([c.code, c.location, c.teacher.map { String($0.split(separator: ",").first ?? "") }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "), 13, H.muted, lines: 2)
            Spacer(minLength: 0)
            Button { sheets.course = CourseDraft(course: c) } label: { T("Edit course", 13, H.accentInk, weight: .medium) }.buttonStyle(.plain)
        }
    }

    // "Take a note" is the red primary button (as + New); the square one beside it starts a to-do list.
    private func takeNote(_ course: Course?, _ live: Occ?) -> some View {
        let cid: String? = course?.id ?? live?.course_id
        return HStack(spacing: 8) {
            HButton("Take a note", icon: "plus", primary: true) { path.append(.note(store.addNote(course: cid, date: Dates.today(), event: nil).id)) }
                .frame(maxWidth: .infinity)
            HButton("", icon: "checklist") { path.append(.note(store.addNote(course: cid, date: Dates.today(), event: nil, body: "- [ ] ").id)) }
        }
    }

    private func card(_ n: Note, _ today: String, _ clock: Int64) -> some View {
        NoteCard(note: n, today: today, clock: clock, showCourse: sel != n.course_id, lines: 6, todoMax: 4) { path.append(.note(n.id)) }
            .lively("note:\(n.id)", "\(n.updated_at)")
    }

    // The class on now, if it belongs to a course.
    private func liveClass(_ clock: Int64) -> Occ? {
        let today: String = Dates.dayOf(clock)
        return store.occurrences(today, today).first { $0.course_id != nil && $0.mark != "off" && clock >= $0.start_ms && clock < $0.end_ms }
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

// MARK: - Alarms

// Alarms (desktop alarms.js / redesign5 alarms-phone): the next ring big at the top, then every alarm as a card:
// the time, its name, what it repeats on, when it rings next (or that a ring is skipped), the days and Skip once,
// and the switch.
struct TimeView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets

    var body: some View {
        Ticking { clock in
            let alarms: [(Alarm, Int64?)] = store.alarms.map { ($0, Alarms.nextRing($0, store.db.courses, store.db.events, clock, stoppedAt: RingSync.stoppedAt(store, $0.id))) }
                .sorted { ($0.1 ?? Int64.max, $0.0.time ?? "") < ($1.1 ?? Int64.max, $1.0.time ?? "") }
            let upcoming: [(Alarm, Int64)] = alarms.compactMap { a in a.1.map { (a.0, $0) } }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let first = upcoming.first { NextRing(a: first.0, at: first.1, then: upcoming.dropFirst().first, clock: clock) }
                    HStack(spacing: 12) {
                        SectionLabel(text: "Alarms", detail: alarms.isEmpty ? nil : "\(alarms.count) · \(alarms.filter { $0.0.enabled == 1 }.count) on")
                        HButton("New", icon: "plus") { sheets.alarm = true }
                    }
                    if alarms.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            T("No alarms yet", 18, bold: true)
                            T("Add one at a time, or before a course.", 14, H.muted)
                        }
                    }
                    ForEach(Array(alarms.map { AlarmItem(a: $0.0, next: $0.1) }.enumerated()), id: \.element.id) { i, item in
                        AlarmCard(a: item.a, next: item.next, clock: clock).rise(i)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 96)
            }
            .background(H.bg)
        }
    }
}

private struct AlarmItem: Identifiable { let a: Alarm; let next: Int64?; var id: String { a.id } }

@MainActor private func alarmRepeat(_ a: Alarm, _ store: Store) -> String {
    if let cid = a.lead_course_id { return "Before every \(store.course(cid)?.name ?? "class") session" }
    if a.lead_event_id != nil { return "Before the event" }
    if let d = a.date { return "Once, " + Dates.short(d) }
    if a.days.isEmpty || a.days.count == 7 { return "Every day" }
    if a.days == [1, 2, 3, 4, 5] { return "Weekdays" }
    if a.days == [6, 7] { return "Weekends" }
    return a.days.map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
}

private func ringWords(_ at: Int64, _ clock: Int64) -> String {
    let today: String = Dates.dayOf(clock)
    let d: String = Dates.dayOf(at)
    let day: String = d == today ? "today" : d == Dates.add(today, 1) ? "tomorrow" : Dates.short(d)
    return day + " · " + Dates.relative((at - clock + 59_999) / 60_000)
}

private struct NextRing: View {
    @EnvironmentObject var store: Store
    let a: Alarm
    let at: Int64
    let then: (Alarm, Int64)?
    let clock: Int64
    var body: some View {
        let today: String = Dates.dayOf(clock)
        let d: String = Dates.dayOf(at)
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("NEXT RING").font(H.ui(13, .bold)).tracking(1.5).foregroundStyle(H.muted)
                Spacer(minLength: 0)
                T(Dates.relative((at - clock + 59_999) / 60_000), 14, H.muted, lines: 1)
            }
            Text(Dates.clock(at)).font(H.ui(56, .bold)).tracking(-2).foregroundStyle(H.fg).lineLimit(1).minimumScaleFactor(0.6).padding(.top, 12)
            T(Alarms.displayLabel(a, store.db.courses, store.db.events), 16, bold: true, lines: 1).padding(.top, 12)
            T([d == today ? "Today" : d == Dates.add(today, 1) ? "Tomorrow" : Dates.short(d), then.map { "then \(Alarms.displayLabel($0.0, store.db.courses, store.db.events)) \(Dates.clock($0.1)) \(Dates.weekdays[Dates.iso(Dates.dayOf($0.1)) - 1])" }].compactMap { $0 }.joined(separator: " · "), 13, H.muted, lines: 2)
                .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [H.surface2, H.surface], startPoint: .topTrailing, endPoint: .bottomLeading))
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 16, y: 10)
    }
}

private struct AlarmCard: View {
    @EnvironmentObject var store: Store
    let a: Alarm
    let next: Int64?
    let clock: Int64
    @State private var confirmDelete = false
    var body: some View {
        let on: Bool = a.enabled == 1
        let skipped: Int64? = RingSync.skippedAt(store, a.id)
        let lead: Bool = a.lead_course_id != nil || a.lead_event_id != nil
        let course: Course? = store.course(a.lead_course_id)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Text(a.time.map(Dates.t) ?? next.map(Dates.clock) ?? "—").font(H.ui(32, .bold)).tracking(-1).foregroundStyle(on ? H.fg : H.muted).lineLimit(1)
                Spacer(minLength: 8)
                BurstToggle(on: on) { store.setEnabled(a, $0) }
            }
            T(Alarms.displayLabel(a, store.db.courses, store.db.events), 16, bold: true, lines: 1).padding(.top, 8)
            T(alarmRepeat(a, store), 13, H.muted, lines: 1).padding(.top, 4)
            if let s = skipped {
                HStack(spacing: 6) {
                    Image(systemName: "forward.end").font(.system(size: 13)).foregroundStyle(H.gold)
                    T("Skipped once", 13, H.gold, weight: .semibold, lines: 1)
                    T("·", 13, H.faint)
                    Text(Dates.short(Dates.dayOf(s)) + " " + Dates.clock(s)).font(H.ui(13)).foregroundStyle(H.muted).strikethrough(true, color: H.muted).lineLimit(1)
                }
                .padding(.top, 8)
                if let n = next { T("Rings again \(Dates.short(Dates.dayOf(n))) \(Dates.clock(n))", 13, H.muted, lines: 1).padding(.top, 4) }
            } else if on, let n = next {
                T("Next ring " + ringWords(n, clock), 13, H.tealInk, weight: .semibold, lines: 1).padding(.top, 8)
            }
            // The days and the buttons on one row when they fit, else the buttons under the days.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { days(lead); Spacer(minLength: 0); buttons(on, skipped) }
                VStack(alignment: .leading, spacing: 8) { days(lead); HStack(spacing: 8) { Spacer(minLength: 0); buttons(on, skipped) } }
            }
            .padding(.top, 16)
        }
        .padding(.vertical, 16).padding(.trailing, 12).padding(.leading, lead ? 19 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(skipped != nil ? AnyShapeStyle(LinearGradient(colors: [H.gold.opacity(0.07), H.surface], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(H.surface))
        .overlay(alignment: .top) { H.hi.frame(height: 1) }
        .overlay(alignment: .leading) { if lead { Color(hex: course?.color ?? "#4A8B8B").frame(width: 3) } }
        .overlay(Rectangle().strokeBorder(skipped != nil ? H.gold.opacity(0.35) : H.border, lineWidth: 1))
        .opacity(on ? 1 : 0.6)
        .lively("alarm:\(a.id)", "\(a.updated_at)")
        .animation(HMotion.on(HMotion.sheet), value: skipped)
        .confirmationDialog("Delete alarm?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { store.removeAlarm(a) }
        } message: { Text("\"\(Alarms.displayLabel(a, store.db.courses, store.db.events))\" will be removed from every device.") }
    }

    @ViewBuilder private func days(_ lead: Bool) -> some View {
        if !lead && a.date == nil {
            HStack(spacing: 4) { ForEach(1...7, id: \.self) { d in DayBox(letter: String(Array("MTWTFSS")[d - 1]), on: a.days.isEmpty || a.days.contains(d)) } }
        }
    }

    @ViewBuilder private func buttons(_ on: Bool, _ skipped: Int64?) -> some View {
        HStack(spacing: 8) {
                if on {
                    if skipped != nil {
                        HButton("Undo skip", icon: "arrow.uturn.backward", ghost: true, compact: true) { RingSync.unskip(store, a.id) }
                    } else if let n = next {
                        HButton("Skip once", icon: "forward.end", ghost: true, compact: true) { RingSync.skip(store, a.id, n) }
                    }
                }
                Menu {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete alarm", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium)).foregroundStyle(H.muted).frame(width: 36, height: 36).contentShape(Rectangle())
                }
        }
    }
}

// MARK: - Timers

// Timers (desktop timers.js): one big number with Start / Stop, Pause, quick lengths, and timers scheduled for later.
// Tap the number to change the length. Every device rings when a timer ends.
struct TimersView: View {
    @EnvironmentObject var store: Store
    @AppStorage("timer_length") private var length = 25
    @State private var dialog: Bool? // false: length, true: for later
    @State private var mins = ""
    @State private var label = ""
    @State private var at = Date().addingTimeInterval(3600)
    @State private var startFrame = CGRect.zero
    private static let quick = [5, 10, 15, 25, 30, 45, 60]

    var body: some View {
        Ticking { clock in
            let current: HTimer? = store.timers.filter { ($0.state == "running" && ($0.start_at ?? 0) <= clock) || $0.state == "paused" }.min { ($0.ends_at ?? 0) < ($1.ends_at ?? 0) }
            let upcoming: [HTimer] = store.timers.filter { $0.state == "running" && ($0.start_at ?? 0) > clock }.sorted { ($0.start_at ?? 0) < ($1.start_at ?? 0) }
            let left: Int64 = current.map { store.timerLeft($0, clock) } ?? Int64(length * 60)
            let frac: CGFloat = current.map { CGFloat(Double(store.timerLeft($0, clock)) / Double(max(1, $0.duration_s))) } ?? 1
            ScrollView {
                VStack(spacing: 16) {
                    T(current.map { ($0.label.isEmpty ? "Timer" : $0.label) + ($0.state == "paused" ? " · paused" : "") } ?? "Tap the time to change it", 14, H.muted, lines: 1)
                        .padding(.top, 32)
                    Button { if current == nil { open(false) } } label: {
                        Text(Dates.countdown(left)).font(H.ui(72, .bold)).tracking(-3).foregroundStyle(current == nil ? H.soft : H.fg)
                            .lineLimit(1).minimumScaleFactor(0.5)
                            .contentTransition(.numericText()).animation(HMotion.on(HMotion.quick), value: left)
                    }
                    .buttonStyle(.plain)
                    .disabled(current != nil)
                    // What is left, as a line that drains.
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(H.surface4)
                            Rectangle().fill(current == nil ? H.surface4 : H.accent).frame(width: (g.size.width * min(1, max(0, frac))).rounded())
                                .shadow(color: current?.state == "running" ? H.accent.opacity(0.6) : .clear, radius: 4)
                                .animation(HMotion.on(HMotion.meter), value: frac)
                        }
                    }
                    .frame(height: 4).padding(.horizontal, 24)
                    HStack(spacing: 8) {
                        if let c = current {
                            HButton(c.state == "paused" ? "Resume" : "Pause", icon: c.state == "paused" ? "play.fill" : "pause.fill") {
                                if c.state == "paused" { store.resume(c) } else { store.pause(c) }
                            }
                        }
                        HButton(current == nil ? "Start timer" : "Stop timer", icon: current == nil ? "play.fill" : "stop.fill", primary: true) {
                            if let c = current { store.stop(c) } else { Motion.shared.burst(in: startFrame); store.startTimer(seconds: length * 60, label: "") }
                        }
                        .burstAnchor($startFrame)
                        HButton("", icon: "plus") { open(true) }
                    }
                    .padding(.top, 8)
                    if current == nil {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(Self.quick, id: \.self) { m in
                                    Button { length = m } label: {
                                        T("\(m) min", 14, m == length ? H.fg : H.soft, weight: m == length ? .bold : .medium)
                                            .padding(.horizontal, 12).frame(height: 36)
                                            .background(m == length ? H.surface3 : H.surface)
                                            .overlay(alignment: .bottom) { if m == length { H.accent.frame(height: 2) } }
                                            .overlay(Rectangle().strokeBorder(m == length ? H.border2 : H.border, lineWidth: 1))
                                    }
                                    .buttonStyle(PressStyle())
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    if !upcoming.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(text: "Later", detail: "\(upcoming.count)")
                            ForEach(upcoming) { t in
                                HStack(spacing: 12) {
                                    T(Dates.clock(t.start_at ?? 0), 16, bold: true, lines: 1).frame(width: 96, alignment: .leading)
                                    T((t.label.isEmpty ? "Timer" : t.label) + " · " + Dates.countdown(Int64(t.duration_s)), 13, H.muted, lines: 1)
                                    Spacer(minLength: 0)
                                    Button { store.stop(t) } label: { Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(H.faint).frame(width: 44, height: 44) }
                                }
                                .padding(.leading, 16).padding(.trailing, 4)
                                .background(H.surface)
                                .overlay(Rectangle().strokeBorder(H.border, lineWidth: 1))
                            }
                        }
                        .padding(.horizontal, 16).padding(.top, 16)
                    }
                }
                .padding(.bottom, 96)
            }
            .background(H.bg)
        }
        .onAppear { store.sweepTimers() }
        .sheet(isPresented: Binding(get: { dialog != nil }, set: { if !$0 { dialog = nil } })) {
            let later = dialog ?? false
            SheetFrame(title: later ? "Timer for later" : "Timer length") {
                Field(label: "Minutes", text: $mins).keyboardType(.numberPad)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(Self.quick, id: \.self) { m in HButton("\(m)", compact: true) { mins = String(m) } } }
                }
                if later {
                    HStack { FieldLabel(text: "Starts at"); Spacer(); DatePicker("", selection: $at, displayedComponents: .hourAndMinute).labelsHidden().colorScheme(.dark) }
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
    @State private var dateOpen = false

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
            Image(systemName: icon).font(.system(size: 17, weight: .regular)).foregroundStyle(on ? H.fg : H.muted)
                .frame(width: 44, height: 44)
                .background(on ? H.surface3 : Color.clear)
                .overlay(alignment: .bottom) { if on { H.accent.frame(height: 2) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
    }

    // The header (redesign5 note-phone): back, the course as a picker, the save state, pin and ⋯.
    private func header(_ note: Note?) -> some View {
        let course: Course? = store.course(note?.course_id)
        return VStack(spacing: 0) {
            HStack(spacing: 4) {
                Button { save(); dismiss() } label: {
                    Image(systemName: "arrow.left").font(.system(size: 18, weight: .medium)).foregroundStyle(H.fg).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                Menu {
                    Button { setCourse(nil) } label: { if note?.course_id == nil { Label("No course", systemImage: "checkmark") } else { Text("No course") } }
                    ForEach(store.courses) { c in
                        Button { setCourse(c.id) } label: { if note?.course_id == c.id { Label(c.name, systemImage: "checkmark") } else { Text(c.name) } }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Rectangle().fill(course.map { Color(hex: $0.color) } ?? H.faint).frame(width: 10, height: 10)
                        T(course?.name ?? "No course", 14, H.fg, bold: true, lines: 1)
                        Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(H.muted)
                    }
                    .padding(.horizontal, 12).frame(height: 36)
                    .background(H.surface3)
                    .overlay(alignment: .top) { H.hi.frame(height: 1) }
                    .overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
                }
                .layoutPriority(1)
                Spacer(minLength: 4)
                HStack(spacing: 4) {
                    if uploading == nil && !dirty { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(H.faint) }
                    T(uploading ?? (dirty ? "Editing" : "Saved"), 13, uploading != nil ? H.gold : H.faint, lines: 1)
                }
                .fixedSize()
                Button { if var n = note { n.pinned = n.pinned == 1 ? 0 : 1; store.save(n) } } label: {
                    Image(systemName: note?.pinned == 1 ? "pin.fill" : "pin").font(.system(size: 17)).foregroundStyle(note?.pinned == 1 ? H.gold : H.muted).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                Menu {
                    Button { dateOpen = true } label: { Label("Date: " + (note?.session_date.map(Dates.short) ?? "none"), systemImage: "calendar") }
                    let versions = store.versions(id)
                    Menu {
                        if versions.isEmpty { Text("No older versions yet") }
                        ForEach(versions) { v in
                            Button { save(); restoreChoice = v } label: {
                                Text(stamp(v.saved_at ?? 0) + (v.reason == "conflict" ? " · other device" : v.reason == "restore" ? " · before a restore" : ""))
                                Text(NoteFormat.preview(v.body, max: 60))
                            }
                        }
                    } label: { Label("Versions", systemImage: "clock.arrow.circlepath") }
                    Divider()
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete note", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium)).foregroundStyle(H.muted).frame(width: 44, height: 44).contentShape(Rectangle())
                }
            }
            .padding(.leading, 4).padding(.trailing, 4).frame(height: 56)
            Rectangle().fill(H.border).frame(height: 1)
        }
    }

    // Date · the session's kind and time · LIVE, in caps over the title.
    private func meta(_ note: Note?) -> some View {
        let day: String? = note?.session_date
        let occ: Occ? = day.flatMap { d in store.occurrences(d, d).first { $0.event_id == note?.event_id || (note?.event_id == nil && $0.course_id != nil && $0.course_id == note?.course_id) } }
        let now: Int64 = nowMs()
        let live: Bool = occ.map { now >= $0.start_ms && now < $0.end_ms } ?? false
        let parts: [String] = [day.map(Dates.short), occ.map { "\(kindLabel($0.kind)) \(Dates.t($0.start_time))" }, note.map { "edited " + ago($0.updated_at, now) }].compactMap { $0 }
        return HStack(spacing: 8) {
            Text(parts.joined(separator: " · ").uppercased()).font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.muted).lineLimit(1)
            if live { Text("· LIVE").font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.accentInk) }
        }
        .onTapGesture { dateOpen = true }
    }

    // "2 of 4 done" with a red line, when the note has to-dos.
    @ViewBuilder private func progress(_ note: Note?) -> some View {
        let todos: [NoteLine] = NoteFormat.parse(note?.body ?? "").filter { $0.kind == "todo" }
        if !todos.isEmpty {
            let done: Int = todos.filter(\.checked).count
            HStack(spacing: 12) {
                T("\(done) of \(todos.count) done", 13, H.muted, lines: 1).fixedSize()
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(H.surface4)
                        Rectangle().fill(H.accent).frame(width: (g.size.width * CGFloat(done) / CGFloat(todos.count)).rounded())
                            .animation(HMotion.on(HMotion.meter), value: done)
                    }
                }
                .frame(height: 4)
            }
        }
    }

    // The formatting bar at the bottom (above the keyboard): it works on the selection or on what is typed next.
    private var toolbar: some View {
        VStack(spacing: 0) {
            Rectangle().fill(H.border).frame(height: 1)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    tool("bold", rich.here.b) { rich.toggle("b") }
                    tool("italic", rich.here.i) { rich.toggle("i") }
                    tool("underline", rich.here.u) { rich.toggle("u") }
                    tool("strikethrough", rich.here.s) { rich.toggle("s") }
                    tool("textformat.size") { rich.setHeading(2) }
                    tool("list.bullet") { rich.setList("ul") }
                    tool("list.number") { rich.setList("ol") }
                    tool("checklist") { rich.setList("todo") }
                    PhotosPicker(selection: $photoItems, matching: .images) {
                        Image(systemName: "photo").font(.system(size: 17)).foregroundStyle(H.muted).frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    tool("paperclip") { importing = true }
                    Rectangle().fill(H.border).frame(width: 1, height: 24).padding(.horizontal, 6)
                    Menu {
                        ForEach(NoteFormat.fonts, id: \.self) { f in Button(f) { rich.setFont(f) } }
                    } label: {
                        HStack(spacing: 6) {
                            Text(rich.here.font ?? NoteFormat.fonts[0]).font(NoteFonts.swiftUI(rich.here.font ?? NoteFormat.fonts[0], size: 14)).foregroundStyle(H.fg).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(H.muted)
                        }
                        .padding(.horizontal, 10).frame(height: 36).overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
                    }
                    Menu {
                        ForEach(NoteFormat.sizes, id: \.self) { z in Button("\(z)") { rich.setSize(z) } }
                    } label: {
                        HStack(spacing: 6) {
                            Text("\(rich.here.size ?? NoteFormat.defaultSize)").font(H.ui(14)).foregroundStyle(H.fg)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(H.muted)
                        }
                        .padding(.horizontal, 10).frame(height: 36).overlay(Rectangle().strokeBorder(H.border2, lineWidth: 1))
                    }
                    .padding(.leading, 8)
                }
                .padding(.horizontal, 8)
            }
            .frame(height: 52)
        }
        .background(H.surface)
    }

    private func setCourse(_ v: String?) {
        guard var n = store.notes.first(where: { $0.id == id }) else { return }
        save()
        n = store.notes.first { $0.id == id } ?? n
        n.course_id = v
        store.save(n)
    }

    var body: some View {
        let note = store.notes.first { $0.id == id }
        VStack(alignment: .leading, spacing: 0) {
            header(note)
            VStack(alignment: .leading, spacing: 8) {
                meta(note)
                TextField("", text: $title, prompt: Text("Title").foregroundStyle(H.faint), axis: .vertical)
                    .font(H.ui(24, .bold)).foregroundStyle(H.fg).tint(H.accent).lineLimit(1...3)
                    .onChange(of: title) { _, _ in edited() }
                progress(note)
            }
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 8)
            RichNoteEditor(controller: rich)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            toolbar
        }
        .background(H.bg)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $dateOpen) {
            SheetFrame(title: "Note date", subtitle: "The class day this note belongs to.") {
                DateField(label: "Date", value: Binding(get: { store.notes.first { $0.id == id }?.session_date }, set: { v in if var n = store.notes.first(where: { $0.id == id }) { save(); n = store.notes.first { $0.id == id } ?? n; n.session_date = v; store.save(n) } }), clearable: true)
                HButton("Done", primary: true) { dateOpen = false }
            }
            .presentationDetents([.medium])
        }
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
                                        T(city(z), 14)
                                        T(z.components(separatedBy: "/")[0].replacingOccurrences(of: "_", with: " "), 12, H.faint)
                                        Spacer()
                                        T(time(now, TimeZone(identifier: z)!), 14, H.muted)
                                    }
                                    .padding(.horizontal, 14).padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(H.surface)
                        .overlay(Rectangle().strokeBorder(H.faint, lineWidth: 1))
                        .padding(.top, -6)
                    }
                    ForEach(store.clocks) { c in
                        if let z = TimeZone(identifier: c.zone) {
                            let isHome = c.id == store.homeClock?.id
                            let diff = (z.secondsFromGMT(for: now) - home.secondsFromGMT(for: now)) / 60
                            Card(stripe: isHome ? H.accent : nil) {
                                HStack {
                                    T(c.label, 16, bold: true)
                                    Spacer()
                                    if isHome { Chip(text: "App time", tint: H.accent) }
                                    else { Button { store.removeClock(c) } label: { Image(systemName: "xmark").foregroundStyle(H.faint).frame(width: 32, height: 32) } }
                                }
                                T(time(now, z), 32, bold: true)
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
