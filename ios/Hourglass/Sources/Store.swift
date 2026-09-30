import Foundation
import UserNotifications

struct DB: Codable {
    var courses: [Course] = []
    var events: [Event] = []
    var notes: [Note] = []
    var alarms: [Alarm] = []
    var timers: [HTimer] = []
}

struct Slot: Hashable { var day: Int; var start: String; var end: String; var kind: String = "lecture" }

// Local replica + domain operations (same semantics as core/node/service.js) + sync.
@MainActor
final class Store: ObservableObject {
    @Published private(set) var db = DB()
    @Published var syncState = "local"
    @Published var syncError: String?
    @Published var lastSync: Int64 = 0

    // Built in at build time; not user-editable.
    let server: String = (Bundle.main.object(forInfoDictionaryKey: "HourglassServer") as? String) ?? ""
    private var token: String { Keychain.get("sync-token") ?? "" }
    private var cursor: Int64 { get { Int64(UserDefaults.standard.integer(forKey: "cursor")) } set { UserDefaults.standard.set(Int(newValue), forKey: "cursor") } }

    private let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("hourglass.json")
    }()
    private var syncTask: Task<Void, Never>?

    init() {
        // The token ships scrambled in Info.plist and is moved into the Keychain
        // on first launch; older builds kept it in UserDefaults.
        if Keychain.get("sync-token") == nil {
            let legacy = UserDefaults.standard.string(forKey: "token") ?? ""
            let shipped = Keychain.unscramble(Bundle.main.object(forInfoDictionaryKey: "HourglassTokenX") as? String ?? "")
            let t = legacy.isEmpty ? shipped : legacy
            if !t.isEmpty { Keychain.set("sync-token", t) }
        }
        UserDefaults.standard.removeObject(forKey: "token")
        UserDefaults.standard.removeObject(forKey: "server")
        if let data = try? Data(contentsOf: file), let d = try? JSONDecoder().decode(DB.self, from: data) { db = d }
    }

    // MARK: reads

    var courses: [Course] { db.courses.filter { $0.deleted == 0 && $0.archived == 0 }.sorted { $0.name.lowercased() < $1.name.lowercased() } }
    var events: [Event] { db.events.filter { $0.deleted == 0 } }
    var notes: [Note] { db.notes.filter { $0.deleted == 0 } }
    var alarms: [Alarm] { db.alarms.filter { $0.deleted == 0 } }
    var timers: [HTimer] { db.timers.filter { $0.deleted == 0 && $0.state != "done" } }
    func course(_ id: String?) -> Course? { courses.first { $0.id == id } }
    func now(_ ms: Int64 = nowMs()) -> NowState { Now.resolve(db.courses, db.events, db.notes, ms) }
    func occurrences(_ from: String, _ to: String) -> [Occ] {
        Recurrence.expand(db.events, Dictionary(uniqueKeysWithValues: db.courses.map { ($0.id, $0) }), from, to)
    }
    func courseNotes(_ course: String) -> [Note] { notes.filter { $0.course_id == course }.sorted { $0.updated_at > $1.updated_at } }

    // MARK: writes

    private func stamp(_ old: Int64) -> Int64 { max(nowMs(), old + 1) }

    private func changed() {
        if let data = try? JSONEncoder().encode(db) { try? data.write(to: file, options: .atomic) }
        Notifications.reschedule(self)
        syncTask?.cancel()
        syncTask = Task { try? await Task.sleep(nanoseconds: 1_500_000_000); await self.sync() }
    }

    @discardableResult
    func save(_ c: Course) -> Course {
        var c = c; c.updated_at = stamp(db.courses.first { $0.id == c.id }?.updated_at ?? 0); c.dirty = 1
        if let i = db.courses.firstIndex(where: { $0.id == c.id }) { db.courses[i] = c } else { db.courses.append(c) }
        changed(); return c
    }
    @discardableResult
    func save(_ e: Event) -> Event {
        var e = e; e.updated_at = stamp(db.events.first { $0.id == e.id }?.updated_at ?? 0); e.dirty = 1
        if let i = db.events.firstIndex(where: { $0.id == e.id }) { db.events[i] = e } else { db.events.append(e) }
        changed(); return e
    }
    @discardableResult
    func save(_ n: Note) -> Note {
        var n = n; n.updated_at = stamp(db.notes.first { $0.id == n.id }?.updated_at ?? 0); n.dirty = 1
        if let i = db.notes.firstIndex(where: { $0.id == n.id }) { db.notes[i] = n } else { db.notes.append(n) }
        changed(); return n
    }
    @discardableResult
    func save(_ a: Alarm) -> Alarm {
        var a = a; a.updated_at = stamp(db.alarms.first { $0.id == a.id }?.updated_at ?? 0); a.dirty = 1
        if let i = db.alarms.firstIndex(where: { $0.id == a.id }) { db.alarms[i] = a } else { db.alarms.append(a) }
        changed(); return a
    }
    @discardableResult
    func save(_ t: HTimer) -> HTimer {
        var t = t; t.updated_at = stamp(db.timers.first { $0.id == t.id }?.updated_at ?? 0); t.dirty = 1
        if let i = db.timers.firstIndex(where: { $0.id == t.id }) { db.timers[i] = t } else { db.timers.append(t) }
        changed(); return t
    }

    // MARK: operations

    func addCourse(name: String, code: String?, color: String, location: String?, teacher: String?, slots: [Slot], termEnd: String?) {
        let c = save(Course(name: name, code: code, color: color, location: location, teacher: teacher))
        for s in slots {
            var d = Dates.today()
            while Dates.iso(d) != s.day { d = Dates.add(d, 1) }
            save(Event(course_id: c.id, kind: s.kind, start_date: d, start_time: s.start, end_time: s.end, repeat: Repeat(freq: "weekly", days: [s.day], until: termEnd)))
        }
    }

    func removeCourse(_ c: Course) {
        for e in events where e.course_id == c.id { var e = e; e.deleted = 1; save(e) }
        var c = c; c.deleted = 1; save(c)
    }

    func skip(_ o: Occ) {
        guard var e = db.events.first(where: { $0.id == o.event_id }) else { return }
        if !e.exceptions.contains(o.date) { e.exceptions.append(o.date) }
        save(e)
    }

    func removeEvent(_ id: String) {
        guard var e = db.events.first(where: { $0.id == id }) else { return }
        e.deleted = 1; save(e)
    }

    // With a course and no date, the note joins today's session if the course meets today.
    @discardableResult
    func addNote(course: String?, date: String?, event: String?, title: String? = nil, body: String = "", pinned: Bool = false) -> Note {
        var session = date
        var ev = event
        if let course, date == nil, !pinned {
            let today = Dates.today()
            if let o = occurrences(today, today).first(where: { $0.course_id == course }) { session = today; ev = ev ?? o.event_id }
        }
        return save(Note(course_id: course, event_id: ev, session_date: session, title: title ?? session.map(Dates.short) ?? "Untitled", body: body, pinned: pinned ? 1 : 0))
    }

    func deleteNote(_ id: String) {
        guard var n = db.notes.first(where: { $0.id == id }) else { return }
        n.deleted = 1; save(n)
    }

    func startTimer(seconds: Int, label: String) {
        save(HTimer(label: label.isEmpty ? (seconds % 60 == 0 ? "\(seconds / 60) min timer" : "\(seconds)s timer") : label,
                    duration_s: seconds, state: "running", ends_at: nowMs() + Int64(seconds) * 1000))
    }
    func pause(_ t: HTimer) { var t = t; t.remaining_s = Int(max(0, ((t.ends_at ?? 0) - nowMs() + 999) / 1000)); t.ends_at = nil; t.state = "paused"; save(t) }
    func resume(_ t: HTimer) { var t = t; t.ends_at = nowMs() + Int64(t.remaining_s ?? 0) * 1000; t.remaining_s = nil; t.state = "running"; save(t) }
    func stop(_ t: HTimer) { var t = t; t.deleted = 1; save(t) }

    func addAlarm(label: String, time: String?, days: [Int], date: String?, leadCourse: String?, leadMinutes: Int?) {
        let lbl = label.isEmpty ? (leadCourse.flatMap { course($0)?.name }.map { "\($0) in \(leadMinutes ?? 10) min" } ?? "Alarm") : label
        save(Alarm(label: lbl, time: leadCourse == nil ? time : nil, days: days, date: date, lead_course_id: leadCourse, lead_minutes: leadMinutes))
    }
    func setEnabled(_ a: Alarm, _ on: Bool) { var a = a; a.enabled = on ? 1 : 0; save(a) }
    func removeAlarm(_ a: Alarm) { var a = a; a.deleted = 1; save(a) }

    // MARK: sync

    // Lecture reminders: one alarm per lecture, N minutes before (0 = off). Synced.
    var reminderMin: Int {
        let lectures = Set(events.filter { $0.kind == "lecture" }.map(\.id))
        return alarms.first { $0.lead_event_id.map(lectures.contains) == true && $0.enabled == 1 }?.lead_minutes ?? 0
    }

    func setLectureReminders(_ minutes: Int) {
        for ev in events where ev.kind == "lecture" {
            let c = course(ev.course_id)
            let room = (ev.location ?? c?.location ?? "").components(separatedBy: " · ")[0]
            let m = Dates.minutes(ev.start_time), h = m / 60
            let time = String(format: "%ld:%02ld %@", (h + 11) % 12 + 1, m % 60, h < 12 ? "AM" : "PM")
            let label = [c?.name ?? ev.title, "lecture \(time)", room].filter { !$0.isEmpty }.joined(separator: " · ")
            if var a = db.alarms.first(where: { $0.lead_event_id == ev.id && $0.deleted == 0 }) {
                a.enabled = minutes > 0 ? 1 : 0
                if minutes > 0 { a.lead_minutes = minutes; a.label = label }
                save(a)
            } else if minutes > 0 {
                save(Alarm(label: label, days: [], lead_event_id: ev.id, lead_minutes: minutes))
            }
        }
    }

    private struct Pull: Decodable { let rev: Int64; let changes: DB }

    func sync() async {
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { syncState = "local"; return }
        do {
            var dirty = DB()
            dirty.courses = db.courses.filter { $0.dirty == 1 }
            dirty.events = db.events.filter { $0.dirty == 1 }
            dirty.notes = db.notes.filter { $0.dirty == 1 }
            dirty.alarms = db.alarms.filter { $0.dirty == 1 }
            dirty.timers = db.timers.filter { $0.dirty == 1 }
            let pushed = dirty
            if !(dirty.courses.isEmpty && dirty.events.isEmpty && dirty.notes.isEmpty && dirty.alarms.isEmpty && dirty.timers.isEmpty) {
                var req = request(base.appendingPathComponent("api/sync"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONEncoder().encode(["changes": dirty])
                try await check(URLSession.shared.data(for: req))
                clean(pushed)
            }
            var comps = URLComponents(url: base.appendingPathComponent("api/sync"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "since", value: String(cursor))]
            let (data, res) = try await URLSession.shared.data(for: request(comps.url!))
            try check((data, res))
            let pull = try JSONDecoder().decode(Pull.self, from: data)
            merge(pull.changes)
            cursor = pull.rev
            if let d = try? JSONEncoder().encode(db) { try? d.write(to: file, options: .atomic) }
            Notifications.reschedule(self)
            syncState = "synced"; syncError = nil; lastSync = nowMs()
        } catch is CancellationError {
        } catch {
            syncState = "offline"; syncError = error.localizedDescription
        }
    }

    private func request(_ url: URL) -> URLRequest {
        var r = URLRequest(url: url, timeoutInterval: 15)
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return r
    }

    private func check(_ r: (Data, URLResponse)) throws {
        if let h = r.1 as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(h.statusCode)"])
        }
    }

    // Clear dirty flags only on rows unchanged since they were pushed.
    private func clean(_ p: DB) {
        func c<T: Identifiable & Codable>(_ rows: inout [T], _ sent: [T], _ upd: (T) -> Int64, _ set: (inout T) -> Void) where T.ID == String {
            for s in sent { if let i = rows.firstIndex(where: { $0.id == s.id }), upd(rows[i]) == upd(s) { set(&rows[i]) } }
        }
        c(&db.courses, p.courses, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.events, p.events, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.notes, p.notes, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.alarms, p.alarms, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.timers, p.timers, { $0.updated_at }, { $0.dirty = 0 })
    }

    // Last write wins on updated_at.
    private func merge(_ ch: DB) {
        func m<T: Identifiable & Codable>(_ rows: inout [T], _ incoming: [T], _ upd: (T) -> Int64, _ clear: (inout T) -> Void) where T.ID == String {
            for var r in incoming {
                clear(&r)
                if let i = rows.firstIndex(where: { $0.id == r.id }) { if upd(rows[i]) <= upd(r) { rows[i] = r } } else { rows.append(r) }
            }
        }
        m(&db.courses, ch.courses, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.events, ch.events, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.notes, ch.notes, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.alarms, ch.alarms, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.timers, ch.timers, { $0.updated_at }, { $0.dirty = 0 })
    }
}

// Alarms and timers ring as local notifications, scheduled ahead (iOS caps
// pending requests at 64). AlarmKit (iOS 26) is the upgrade path for real alarms.
enum Notifications {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    @MainActor
    static func reschedule(_ store: Store) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        let now = nowMs()
        var fires: [(String, Int64, String, String)] = [] // id, at, title, body
        for t in store.timers where t.state == "running" {
            if let at = t.ends_at, at > now { fires.append(("timer-\(t.id)", at, "Timer done", t.label)) }
        }
        let alarmKit = AlarmKitScheduler.active
        for a in store.alarms where !alarmKit {
            var from = now
            for k in 0..<10 {
                guard let at = Alarms.next(a, store.db.courses, store.db.events, from), at < now + 8 * 86_400_000 else { break }
                fires.append(("alarm-\(a.id)-\(k)", at, "Alarm", a.label))
                from = at
            }
        }
        for (id, at, title, body) in fires.sorted(by: { $0.1 < $1.1 }).prefix(60) {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = UserDefaults.standard.object(forKey: "sound") as? Bool == false ? nil : .default
            content.interruptionLevel = .timeSensitive
            let date = Date(timeIntervalSince1970: Double(at) / 1000)
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }
        AlarmKitScheduler.reschedule(store)
    }
}
