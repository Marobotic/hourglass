import SwiftUI
import AVFoundation
import UniformTypeIdentifiers

struct SheetFrame<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        T(title, 20, bold: true)
                        if let subtitle { T(subtitle, 12, H.muted) }
                    }
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark").foregroundStyle(H.muted).frame(width: 36, height: 36) }
                }
                content()
            }
            .padding(20)
        }
        .background(H.surface)
        .presentationBackground(H.surface)
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Event

struct EventSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let draft: EventDraft
    @State private var courseId: String?
    @State private var kind = "event"
    @State private var title = ""
    @State private var date: String? = Dates.today()
    @State private var start = "09:00"
    @State private var end = "10:00"
    @State private var room = ""
    @State private var repeatMode = "none"
    @State private var days: [Int] = []
    @State private var until: String?
    @State private var forever = true   // false: the series ends on `until`
    @State private var confirmDelete = false
    @State private var loaded = false

    var valid: Bool {
        Dates.minutes(end) > Dates.minutes(start) && (!title.trimmingCharacters(in: .whitespaces).isEmpty || courseId != nil) && (repeatMode != "weekly" || !days.isEmpty)
            && (repeatMode == "none" || forever || (until ?? "") >= (date ?? Dates.today()))
    }
    var rule: Repeat? {
        repeatMode == "none" ? nil : Repeat(freq: repeatMode, days: repeatMode == "weekly" ? days : nil, until: forever ? nil : until)
    }

    var body: some View {
        SheetFrame(title: draft.event == nil ? "New event" : "Edit event", subtitle: draft.event?.repeat != nil ? "Changes apply to every session of this series." : nil) {
            T("COURSE", 11, H.muted)
            Segmented(options: [("None", String?.none)] + store.courses.map { ($0.name, Optional($0.id)) }, value: $courseId)
            T("KIND", 11, H.muted)
            Segmented(options: KINDS.map { (kindLabel($0), $0) }, value: $kind)
            Field(label: courseId != nil ? "Title (optional)" : "Title", text: $title)
            DateField(label: repeatMode == "none" ? "Date" : "First date", value: $date)
            HStack(spacing: 16) { TimeField(label: "Start", value: $start); TimeField(label: "End", value: $end) }
            Field(label: "Room (optional)", text: $room)
            T("REPEAT", 11, H.muted)
            Segmented(options: [("Once", "none"), ("Daily", "daily"), ("Weekly", "weekly"), ("Monthly", "monthly"), ("Yearly", "yearly")], value: $repeatMode)
            if repeatMode == "weekly" { DayToggles(days: $days) }
            if repeatMode != "none" {
                T("ENDS", 11, H.muted)
                Segmented(options: [("Never", true), ("On a date", false)], value: $forever)
                if !forever { DateField(label: "Last date", value: $until) }
                T(repeatText(Event(start_date: date ?? Dates.today(), repeat: rule)), 12, H.faint)
            }
            HStack {
                if let e = draft.event { HButton(e.repeat != nil ? "Delete series" : "Delete", danger: true) { confirmDelete = true } }
                Spacer()
                HButton(draft.event == nil ? "Add event" : "Save", primary: true, enabled: valid) { save() }
            }
        }
        .onAppear(perform: load)
        .confirmationDialog(draft.event?.repeat != nil ? "Delete every session?" : "Delete event?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let e = draft.event { store.removeEvent(e.id) }; dismiss() }
        } message: { Text(draft.event?.repeat != nil ? "This removes the whole series. To skip one date, open that session and choose Skip." : "This event will be removed from every device.") }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let e = draft.event {
            courseId = e.course_id; kind = e.kind; title = e.title; date = e.start_date; start = e.start_time; end = e.end_time
            room = e.location ?? ""; repeatMode = e.repeat?.freq ?? "none"; days = e.repeat?.days ?? [Dates.iso(e.start_date)]; until = e.repeat?.until; forever = e.repeat?.until == nil
        } else {
            courseId = draft.course
            kind = draft.course != nil ? "lecture" : "event"
            date = draft.date ?? Dates.today()
            repeatMode = draft.weekly ? "weekly" : "none"
            days = [Dates.iso(date!)]
        }
    }

    private func save() {
        let d = date ?? Dates.today()
        let rep = rule
        var e = draft.event ?? Event()
        e.course_id = courseId; e.kind = kind; e.title = title.trimmingCharacters(in: .whitespaces); e.start_date = d
        e.start_time = start; e.end_time = end; e.location = room.isEmpty ? nil : room; e.repeat = rep
        // Times are fixed in the event's zone; a new one (or an old one without
        // a zone) takes the app's.
        if e.tz == nil { e.tz = Dates.zone.identifier }
        store.save(e)
        dismiss()
    }
}

// MARK: - Course

struct CourseSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let draft: CourseDraft
    @Binding var path: [Route]
    @State private var name = ""
    @State private var code = ""
    @State private var room = ""
    @State private var teacher = ""
    @State private var color = PALETTE[0]
    @State private var slots: [Slot] = [Slot(day: 2, start: "09:00", end: "11:00")]
    @State private var termEnd: String?
    @State private var confirmDelete = false
    @State private var loaded = false

    var body: some View {
        SheetFrame(title: draft.course == nil ? "New course" : "Edit course", subtitle: draft.course == nil ? "Add its weekly times now; you can change them later." : nil) {
            Field(label: "Name", text: $name, placeholder: "e.g. Algorithms")
            HStack(spacing: 10) { Field(label: "Code", text: $code); Field(label: "Room", text: $room) }
            Field(label: "Lecturer", text: $teacher)
            T("COLOUR", 11, H.muted)
            HStack(spacing: 8) {
                ForEach(PALETTE, id: \.self) { p in
                    Rectangle().fill(Color(hex: p)).frame(width: 32, height: 32)
                        .overlay(Rectangle().stroke(p == color ? H.fg : .clear, lineWidth: 2))
                        .onTapGesture { color = p }
                }
            }
            if draft.course == nil {
                T("WEEKLY TIMES", 11, H.muted)
                ForEach(slots.indices, id: \.self) { i in
                    Card {
                        Segmented(options: Dates.weekdays.enumerated().map { ($0.element, $0.offset + 1) }, value: $slots[i].day)
                        HStack(spacing: 16) {
                            TimeField(label: "Start", value: $slots[i].start)
                            TimeField(label: "End", value: $slots[i].end)
                            Spacer()
                            Button { slots.remove(at: i) } label: { Image(systemName: "xmark").foregroundStyle(H.muted) }
                        }
                        .padding(.top, 8)
                        Segmented(options: KINDS.prefix(4).map { (kindLabel($0), $0) }, value: $slots[i].kind).padding(.top, 8)
                    }
                }
                HButton("Add a time", icon: "plus") { slots.append(Slot(day: 4, start: "14:00", end: "15:00", kind: "lab")) }
                DateField(label: "Term ends", value: $termEnd, clearable: true)
            }
            HStack {
                if draft.course != nil { HButton("Delete course", danger: true) { confirmDelete = true } }
                Spacer()
                HButton(draft.course == nil ? "Add course" : "Save", primary: true,
                        enabled: !name.trimmingCharacters(in: .whitespaces).isEmpty && slots.allSatisfy { Dates.minutes($0.end) > Dates.minutes($0.start) }) { save() }
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let c = draft.course {
                name = c.name; code = c.code ?? ""; room = c.location ?? ""; teacher = c.teacher ?? ""; color = c.color; slots = []
            } else {
                let used = Set(store.courses.map(\.color))
                color = PALETTE.first { !used.contains($0) } ?? PALETTE[0]
            }
        }
        .confirmationDialog("Delete \(draft.course?.name ?? "course")?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let c = draft.course { store.removeCourse(c) }
                dismiss()
                if !path.isEmpty { path.removeLast() }
            }
        } message: { Text("Its sessions are removed from the calendar. Notes are kept.") }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        func opt(_ s: String) -> String? { let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t }
        if var c = draft.course {
            c.name = n; c.code = opt(code); c.location = opt(room); c.teacher = opt(teacher); c.color = color
            store.save(c)
        } else {
            store.addCourse(name: n, code: opt(code), color: color, location: opt(room), teacher: opt(teacher), slots: slots, termEnd: termEnd)
        }
        dismiss()
    }
}

// MARK: - Session

struct SessionSheet: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Environment(\.dismiss) private var dismiss
    let occ: Occ
    @Binding var path: [Route]
    @State private var confirmSkip = false

    var body: some View {
        let notes = occ.course_id.map { cid in store.courseNotes(cid).filter { $0.session_date == occ.session } } ?? []
        let mark = store.markMap[markId(occ.course_id, occ.event_id, occ.session)]
        SheetFrame(title: occ.title, subtitle: "\(Dates.long(occ.date))  ·  \(Dates.range(occ.start_time, occ.end_time))" + (occ.location.map { "  ·  \($0)" } ?? "")) {
            HStack(spacing: 8) {
                Chip(text: kindLabel(occ.kind), tint: Color(hex: occ.color))
                if let c = occ.code { Chip(text: c, tint: H.muted) }
            }
            SectionLabel(text: "This day")
            Segmented(options: [("Attended", Optional("attended")), ("Absent", "absent"), ("Off", "off")], value: Binding(
                get: { mark }, set: { v in store.setMark(occ, v == mark ? nil : v) }))
            T(mark == "attended" ? "You were there. Tap again to clear." : mark == "absent" ? "Marked absent. Tap again to clear." : mark == "off" ? "No class this day: it is left out of Now." : "Mark it attended, absent, or off (no class that day).", 12, H.faint)
            if let cid = occ.course_id {
                let a = store.attendance(cid)
                if !a.isEmpty { T("This course: \(a["attended"] ?? 0) attended · \(a["absent"] ?? 0) absent · \(a["off"] ?? 0) off", 12, H.muted) }
            }
            if occ.course_id != nil {
                SectionLabel(text: "Notes for this session")
                if notes.isEmpty { T("None yet.", 12, H.faint) }
                ForEach(notes) { n in NoteRow(note: n).onTapGesture { dismiss(); path.append(.note(n.id)) } }
                HButton(notes.isEmpty ? "Start a note for this session" : "Add another note", icon: "square.and.pencil", primary: true) {
                    let n = store.addNote(course: occ.course_id, date: occ.session, event: occ.event_id, title: Dates.short(occ.session) + (notes.isEmpty ? "" : " (\(notes.count + 1))"))
                    dismiss()
                    path.append(.note(n.id))
                }
            }
            HStack {
                HButton("Skip this date", danger: true) { confirmSkip = true }
                Spacer()
                HButton("Edit event") {
                    if let e = store.events.first(where: { $0.id == occ.event_id }) {
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { sheets.event = EventDraft(event: e) }
                    }
                }
            }
        }
        .confirmationDialog("Skip \(Dates.short(occ.date))?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Skip", role: .destructive) { store.skip(occ); dismiss() }
        } message: { Text("Only this session is removed. The rest of the series stays.") }
    }
}

// MARK: - Alarm

struct AlarmSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var mode = "time"
    @State private var time = "07:30"
    @State private var days = [1, 2, 3, 4, 5]
    @State private var label = ""
    @State private var course: String?
    @State private var lead = "15"

    var body: some View {
        SheetFrame(title: "New alarm") {
            Segmented(options: store.courses.isEmpty ? [("At a time", "time")] : [("At a time", "time"), ("Before a course", "before")], value: $mode)
            if mode == "time" {
                TimeField(label: "Time", value: $time)
                DayToggles(days: $days)
                T(days.isEmpty ? "No days selected: rings once, at the next matching time." : "Repeats on the highlighted days.", 12, H.faint)
                Field(label: "Label", text: $label)
            } else {
                Field(label: "Minutes before", text: $lead)
                T("COURSE", 11, H.muted)
                Segmented(options: store.courses.map { ($0.name, Optional($0.id)) }, value: $course)
            }
            HButton("Add alarm", icon: "alarm", primary: true, enabled: mode == "time" || (course != nil && Int(lead) != nil)) {
                if mode == "time" {
                    var date: String? = nil
                    if days.isEmpty {
                        let today = Dates.today()
                        date = Dates.epoch(today, time) > nowMs() ? today : Dates.add(today, 1)
                    }
                    store.addAlarm(label: label, time: time, days: days, date: date, leadCourse: nil, leadMinutes: nil)
                } else {
                    store.addAlarm(label: "", time: nil, days: [], date: nil, leadCourse: course, leadMinutes: Int(lead))
                }
                dismiss()
            }
        }
        .onAppear { course = store.courses.first?.id }
    }
}

// MARK: - Settings

// Preferences for this phone. The sync server is built in; nothing to type.
// Signed out, this is the whole app: sign in or create an account. Same page
// as the Jukebox phone app's (one account for both), in Hourglass colours.
struct LoginView: View {
    @EnvironmentObject var store: Store
    @State private var creating = false
    @State private var forgot = false // "Forgot password?": email only, sends a reset link
    @State private var notice: String?
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var showPassword = false
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                PixelLogo(cell: 7)
                Spacer().frame(height: 16)
                text("Hourglass", 22, H.fg, bold: true)
                Spacer().frame(height: 6)
                text("Your schedule and notes, on every device", 14, H.muted)
                Spacer().frame(height: 28)

                if forgot {
                    text("Forgot your password? Enter your email and we'll send you a link to choose a new one.", 14, H.fg, align: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    modeSwitch
                }
                Spacer().frame(height: 22)

                field("Email", $email, secure: false, keyboard: .emailAddress, submitsForm: forgot)
                if !forgot {
                    Spacer().frame(height: 14)
                    field("Password", $password, secure: !showPassword, trailing: showPassword ? "Hide" : "Show",
                          onTrailing: { showPassword.toggle() }, submitsForm: !creating)
                    if creating {
                        Spacer().frame(height: 14)
                        field("Confirm password", $confirm, secure: !showPassword, submitsForm: true)
                    }
                    if !creating {
                        Spacer().frame(height: 10)
                        Button { setMode(creating: false, forgot: true) } label: {
                            text("Forgot password?", 13, H.muted).padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    Spacer().frame(height: 8)
                    text(creating ? "At least 8 characters." : "The same account as Jukebox. Your other devices use it too.",
                         12, H.muted, align: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let notice {
                    Spacer().frame(height: 14)
                    text(notice, 13, H.teal, align: .leading).frame(maxWidth: .infinity, alignment: .leading)
                }

                if let problem {
                    Spacer().frame(height: 14)
                    text(problem, 13, H.accent, align: .leading).frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer().frame(height: 22)
                Button(action: submit) {
                    HStack(spacing: 10) {
                        if busy { ProgressView().tint(.white) }
                        text(buttonTitle, 16, .white, bold: true)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(H.accent.opacity(busy ? 0.45 : 1), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .disabled(busy)

                Spacer().frame(height: 18)
                HStack(spacing: 0) {
                    text(forgot ? "Remembered it? " : creating ? "Already have an account? " : "New here? ", 14, H.muted)
                    Button { setMode(creating: !creating && !forgot, forgot: false) } label: {
                        text(forgot || creating ? "Sign in" : "Create an account", 14, H.accent, bold: true)
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 440)
            .padding(.horizontal, 24)
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity, minHeight: UIScreen.main.bounds.height * 0.85)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(H.bg.ignoresSafeArea())
        .onAppear {
            if email.isEmpty { email = store.account ?? "" }
            if notice == nil { notice = store.sessionEnded }
        }
    }

    private var buttonTitle: String {
        if forgot { return busy ? "Sending…" : "Send reset link" }
        return busy ? (creating ? "Creating account…" : "Signing in…") : (creating ? "Create account" : "Sign in")
    }

    private func setMode(creating: Bool, forgot: Bool) {
        self.creating = creating
        self.forgot = forgot
        problem = nil
        notice = nil
    }

    // Checked here first, so the common mistakes never make a round trip.
    private func submit() {
        if busy { return }
        let e = email.trimmingCharacters(in: .whitespaces)
        notice = nil
        if forgot {
            if e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
                problem = "Enter a valid email address."
                return
            }
            problem = nil
            busy = true
            Task {
                do {
                    try await store.forgotPassword(email: e)
                    notice = "If \(e) has an account, a reset link is on its way. Open it on any device; it works for one hour."
                } catch { problem = error.localizedDescription }
                busy = false
            }
            return
        }
        if e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            problem = "Enter a valid email address."
        } else if password.count < 8 {
            problem = "The password needs at least 8 characters."
        } else if creating && confirm != password {
            problem = "The passwords do not match."
        } else {
            problem = nil
            busy = true
            Task {
                do {
                    if creating { try await store.register(email: e, password: password) }
                    else { try await store.signIn(email: e, password: password) }
                } catch { problem = error.localizedDescription }
                busy = false
            }
        }
    }

    private func text(_ s: String, _ size: CGFloat, _ color: Color, bold: Bool = false, align: TextAlignment = .center) -> some View {
        Text(s).font(H.mono(size, bold: bold)).foregroundColor(color).multilineTextAlignment(align)
    }

    /** The two-way Sign in / Create account switch. */
    private var modeSwitch: some View {
        HStack(spacing: 0) {
            ForEach([(false, "Sign in"), (true, "Create account")], id: \.1) { value, label in
                let on = creating == value
                Button { setMode(creating: value, forgot: false) } label: {
                    text(label, 14, on ? H.fg : H.muted, bold: on)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(on ? H.surface2 : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .frame(height: 44)
        .background(H.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(H.border, lineWidth: 1))
    }

    private func field(_ label: String, _ value: Binding<String>, secure: Bool, keyboard: UIKeyboardType = .default,
                       trailing: String? = nil, onTrailing: @escaping () -> Void = {}, submitsForm: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            text(label, 13, H.fg).padding(.leading, 2)
            HStack(spacing: 10) {
                Group {
                    if secure { SecureField("", text: value) } else { TextField("", text: value).keyboardType(keyboard) }
                }
                .font(H.mono(16))
                .foregroundColor(H.fg)
                .tint(H.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .submitLabel(submitsForm ? .go : .next)
                .onSubmit { if submitsForm { submit() } }
                .onChange(of: value.wrappedValue) { problem = nil }
                if let trailing {
                    Button(action: onTrailing) { text(trailing, 13, H.muted) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(H.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(H.border, lineWidth: 1))
        }
    }
}

// A personal link that lets any AI with MCP (ChatGPT, Claude, Gemini CLI,
// Codex...) read and change this account's schedule, notes and alarms.
struct AiSection: View {
    @EnvironmentObject var store: Store
    @State private var link: String?
    @State private var busy = false
    @State private var problem: String?
    @State private var copied = false
    @State private var confirmNew = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Use with AI")
            T("Tell any AI \"use Hourglass to move my Tuesday lecture\". Add this link as a connector (MCP server) in ChatGPT, Claude, Gemini CLI or Codex. Anyone with the link can change your schedule, so keep it to yourself.", 12, H.muted)
            if let link {
                T(link.components(separatedBy: "/mcp/")[0] + "/mcp/" + String(link.components(separatedBy: "/mcp/").last?.prefix(8) ?? "") + "…", 13, lines: 1)
                HStack(spacing: 8) {
                    HButton(copied ? "Copied" : "Copy link", primary: true) { UIPasteboard.general.string = link; copied = true }
                    HButton("New link", enabled: !busy) { confirmNew = true }
                }
            } else {
                HButton(busy ? "Working…" : "Make my AI link", enabled: !busy) { load(true) }
            }
            if let problem { T(problem, 12, H.accent) }
        }
        .task { load(false) }
        .confirmationDialog("Make a new link?", isPresented: $confirmNew, titleVisibility: .visible) {
            Button("New link", role: .destructive) { load(true) }
        } message: { Text("The old link stops working; AIs using it need the new one.") }
    }

    private func load(_ make: Bool) {
        busy = true; problem = nil; copied = false
        Task {
            do { link = try await store.aiLinks(make: make)["mcp_url"] as? String } catch { problem = error.localizedDescription }
            busy = false
        }
    }
}

// Plays a ringtone once in Settings; tapping the same one again stops it.
@MainActor
final class TonePreview: ObservableObject {
    @Published var playing: String?
    private var player: AVAudioPlayer?
    func toggle(_ id: String) {
        let same = playing == id
        player?.stop(); player = nil; playing = nil
        guard !same, let url = Ringtones.playable(id) else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        player = try? AVAudioPlayer(contentsOf: url)
        player?.play()
        if player != nil { playing = id }
    }
    func stop() { player?.stop(); player = nil; playing = nil }
}

struct SettingsSheet: View {
    @EnvironmentObject var store: Store
    @AppStorage("time_format") private var timeFormat = "12h"
    @AppStorage("week_start") private var weekStart = 6
    @AppStorage("sound") private var sound = true
    @StateObject private var preview = TonePreview()
    @State private var importing = false
    @State private var uploading = false
    @State private var error: String?
    @State private var confirmDelete: Ringtone?
    @State private var confirmSignOut = false
    @State private var alarmStatus = ""

    var body: some View {
        SheetFrame(title: "Settings") {
            SectionLabel(text: "Account")
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    T(store.account ?? "", 15)
                    T(store.syncState == "synced" ? "Jukebox account · synced \(Dates.clock(store.lastSync))" : store.syncState == "offline" ? "Offline. Changes are kept on the phone and sent later." : "Jukebox account", 12, H.muted)
                    T("Hourglass \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")", 12, H.faint)
                }
                Spacer()
                HButton("Sign out") { confirmSignOut = true }
            }
            AiSection()

            SectionLabel(text: "Alarms")
            T("LECTURE REMINDERS", 11, H.muted)
            Segmented(options: [("Off", 0), ("10 min", 10), ("15 min", 15), ("30 min", 30), ("60 min", 60)],
                      value: Binding(get: { store.reminderMin }, set: { store.setLectureReminders($0) }))
            T(alarmStatus, 12, H.faint)
            HStack {
                T("RINGTONE", 11, H.muted)
                Spacer()
                HButton(uploading ? "Uploading…" : "Upload", enabled: !uploading) { importing = true }
            }
            VStack(spacing: 0) {
                ForEach(Ringtones.all, id: \.self) { id in toneRow(id: id, name: id.capitalized, sub: "Built in", row: nil) }
                ForEach(store.ringtoneRows) { r in
                    toneRow(id: r.id, name: r.name, sub: (r.kind == "song" ? "Song" + (r.artist.map { " · \($0)" } ?? "") : "Upload") + (Ringtones.playable(r.id) == nil ? " · downloading" : ""), row: r)
                }
            }
            if let error { T(error, 13, H.accent) }
            T("Add songs from Jukebox: open a song's menu and pick Set as alarm.", 12, H.faint)
            HStack { T("Alarm sound", 15); Spacer(); SquareToggle(on: sound) { sound = $0; Notifications.reschedule(store) } }

            SectionLabel(text: "Time")
            T("CLOCK", 11, H.muted)
            Segmented(options: [("12-hour", "12h"), ("24-hour", "24h")], value: $timeFormat)
            T("WEEK STARTS ON", 11, H.muted)
            Segmented(options: [("Saturday", 6), ("Sunday", 7), ("Monday", 1)], value: $weekStart)
            HStack {
                T(store.syncState == "offline" ? "Offline" : "Synced with marobotic.dev", 13, H.muted)
                Spacer()
                HButton("Sync now") { Task { await store.syncSoon() } }
            }
        }
        .task { alarmStatus = AlarmKitScheduler.status() }
        .onDisappear { preview.stop() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            let data = try? Data(contentsOf: url)
            if scoped { url.stopAccessingSecurityScopedResource() }
            guard let data else { error = "Could not read that file"; return }
            uploading = true; error = nil
            Task {
                do { try await store.uploadRingtone(data, name: url.deletingPathExtension().lastPathComponent) }
                catch { self.error = error.localizedDescription }
                uploading = false
            }
        }
        .confirmationDialog("Delete \(confirmDelete?.name ?? "")?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let r = confirmDelete { store.removeRingtone(r) }; confirmDelete = nil }
        } message: { Text("It is removed from every device.") }
        .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { store.signOut() }
        } message: { Text("This iPhone stops syncing until you sign in again.") }
    }

    private func toneRow(id: String, name: String, sub: String, row: Ringtone?) -> some View {
        let on = store.ringtone == id
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                Rectangle().fill(on ? H.accent : .clear).frame(width: 14, height: 14).overlay(Rectangle().stroke(on ? H.accent : H.faint, lineWidth: 1))
                VStack(alignment: .leading, spacing: 2) {
                    T(name, 15, bold: on, lines: 1)
                    T(sub, 12, H.muted, lines: 1)
                }
                Spacer()
                Button { preview.toggle(id) } label: { Image(systemName: preview.playing == id ? "stop.fill" : "play.fill").foregroundStyle(H.muted).frame(width: 36, height: 36) }
                if let row { Button { confirmDelete = row } label: { Image(systemName: "trash").foregroundStyle(H.muted).frame(width: 36, height: 36) } }
            }
            .padding(.vertical, 6).padding(.leading, 12)
            .background(on ? H.surface2 : .clear)
            .contentShape(Rectangle())
            .onTapGesture { store.setRingtone(id) }
            Rectangle().fill(H.border).frame(height: 1)
        }
    }
}
