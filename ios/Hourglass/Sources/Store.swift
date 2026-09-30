import Foundation
import UserNotifications

struct DB: Codable {
    var courses: [Course] = []
    var events: [Event] = []
    var notes: [Note] = []
    var alarms: [Alarm] = []
    var clocks: [Clock] = []
    var timers: [HTimer] = []
    var ringtones: [Ringtone] = []
    var prefs: [Pref] = []

    init() {}
    // Tolerant: files and servers from before a table existed decode fine.
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        courses = try c.decodeIfPresent([Course].self, forKey: .courses) ?? []
        events = try c.decodeIfPresent([Event].self, forKey: .events) ?? []
        notes = try c.decodeIfPresent([Note].self, forKey: .notes) ?? []
        alarms = try c.decodeIfPresent([Alarm].self, forKey: .alarms) ?? []
        clocks = try c.decodeIfPresent([Clock].self, forKey: .clocks) ?? []
        timers = try c.decodeIfPresent([HTimer].self, forKey: .timers) ?? []
        ringtones = try c.decodeIfPresent([Ringtone].self, forKey: .ringtones) ?? []
        prefs = try c.decodeIfPresent([Pref].self, forKey: .prefs) ?? []
    }
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
    // The Omarchy Music session once signed in; before that the build's legacy key.
    private var token: String { Keychain.get("session") ?? (UserDefaults.standard.bool(forKey: "signed_out") ? "" : Keychain.get("sync-token") ?? "") }
    @Published var signedIn = Keychain.get("session") != nil
    var account: String? { UserDefaults.standard.string(forKey: "account") }
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
        // New table since the last run: pull everything once.
        if UserDefaults.standard.integer(forKey: "schema") != 4 {
            UserDefaults.standard.set(0, forKey: "cursor")
            UserDefaults.standard.set(4, forKey: "schema")
        }
        if let data = try? Data(contentsOf: file), let d = try? JSONDecoder().decode(DB.self, from: data) { db = d }
        applyZone()
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

    func applyZone() {
        Dates.zone = db.clocks.first { $0.deleted == 0 && $0.home == 1 }.flatMap { TimeZone(identifier: $0.zone) } ?? .current
        Ringtones.current = ringtone
    }

    // MARK: ringtones (synced; audio in Library/Sounds so alarms can use it)

    var ringtoneRows: [Ringtone] { db.ringtones.filter { $0.deleted == 0 }.sorted { $0.updated_at > $1.updated_at } }
    var ringtone: String {
        let v = db.prefs.first { $0.id == "ringtone" && $0.deleted == 0 }?.value ?? "classic"
        return Ringtones.all.contains(v) || ringtoneRows.contains(where: { $0.id == v }) ? v : "classic"
    }
    func setRingtone(_ id: String) {
        var p = db.prefs.first { $0.id == "ringtone" } ?? Pref(id: "ringtone")
        p.value = id; p.deleted = 0; p.updated_at = stamp(p.updated_at); p.dirty = 1
        if let i = db.prefs.firstIndex(where: { $0.id == p.id }) { db.prefs[i] = p } else { db.prefs.append(p) }
        changed()
    }
    func removeRingtone(_ r: Ringtone) {
        if ringtone == r.id { setRingtone("classic") }
        var r = r; r.deleted = 1; r.updated_at = stamp(r.updated_at); r.dirty = 1
        if let i = db.ringtones.firstIndex(where: { $0.id == r.id }) { db.ringtones[i] = r }
        changed()
    }

    private func fetchSounds(_ base: URL) async {
        let want = Set(ringtoneRows.map { Ringtones.fileName($0.id) })
        try? FileManager.default.createDirectory(at: Ringtones.dir, withIntermediateDirectories: true)
        for r in ringtoneRows where !FileManager.default.fileExists(atPath: Ringtones.url(r.id).path) {
            guard let got = try? await URLSession.shared.data(for: request(base.appendingPathComponent("api/ringtones/\(r.id)/audio"))),
                  (got.1 as? HTTPURLResponse)?.statusCode == 200 else { continue }
            try? got.0.write(to: Ringtones.url(r.id), options: .atomic)
        }
        for f in (try? FileManager.default.contentsOfDirectory(atPath: Ringtones.dir.path)) ?? [] where f.hasPrefix("hg_") && !want.contains(f) {
            try? FileManager.default.removeItem(at: Ringtones.dir.appendingPathComponent(f))
        }
    }

    // Upload an audio file; the server cuts the loudest 30 s and it syncs back.
    func uploadRingtone(_ data: Data, name: String) async throws {
        guard let base = URL(string: server) else { return }
        var comps = URLComponents(url: base.appendingPathComponent("api/ringtones/upload"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "select", value: "1"), URLQueryItem(name: "name", value: name)]
        var req = request(comps.url!)
        req.httpMethod = "POST"
        req.timeoutInterval = 120
        req.httpBody = data
        try check(try await URLSession.shared.data(for: req))
        await sync()
    }

    // MARK: account (Omarchy Music)

    func signIn(email: String, password: String) async throws {
        guard let base = URL(string: server) else { return }
        var req = URLRequest(url: base.appendingPathComponent("auth/login"), timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, res) = try await URLSession.shared.data(for: req)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (res as? HTTPURLResponse)?.statusCode == 200, let session = obj["session"] as? String else {
            throw NSError(domain: "hourglass", code: 401, userInfo: [NSLocalizedDescriptionKey: obj["error"] as? String ?? "Sign-in failed"])
        }
        let who = (obj["email"] as? String ?? email).lowercased()
        if let was = account, was != who {
            db = DB()
            cursor = 0
        }
        Keychain.set("session", session)
        Keychain.delete("sync-token")
        UserDefaults.standard.removeObject(forKey: "signed_out")
        UserDefaults.standard.set(who, forKey: "account")
        signedIn = true
        await sync()
    }

    func signOut() {
        let t = token
        if signedIn, let base = URL(string: server) {
            var req = URLRequest(url: base.appendingPathComponent("auth/logout"), timeoutInterval: 10)
            req.httpMethod = "POST"
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
            Task { _ = try? await URLSession.shared.data(for: req) }
        }
        Keychain.delete("session")
        Keychain.delete("sync-token")
        UserDefaults.standard.set(true, forKey: "signed_out")
        signedIn = false
        syncState = "signed_out"
    }

    func setHome(_ k: Clock) {
        for c in clocks {
            var c = c
            let want = c.id == k.id ? 1 : 0
            if (c.home ?? 0) != want { c.home = want; save(c) }
        }
    }

    // "Untitled 01", "Untitled 02", ... (same rule as the server).
    func nextUntitled() -> String {
        let taken = Set(notes.map(\.title))
        var i = 1
        while taken.contains(String(format: "Untitled %02ld", i)) { i += 1 }
        return String(format: "Untitled %02ld", i)
    }

    private func changed() {
        applyZone()
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
    func save(_ k: Clock) -> Clock {
        var k = k; k.updated_at = stamp(db.clocks.first { $0.id == k.id }?.updated_at ?? 0); k.dirty = 1
        if let i = db.clocks.firstIndex(where: { $0.id == k.id }) { db.clocks[i] = k } else { db.clocks.append(k) }
        changed(); return k
    }
    var clocks: [Clock] { db.clocks.filter { $0.deleted == 0 }.sorted { ($0.position, $0.updated_at) < ($1.position, $1.updated_at) } }
    func addClock(_ zone: String) {
        guard !clocks.contains(where: { $0.zone == zone }) else { return }
        save(Clock(zone: zone, label: zone.components(separatedBy: "/").last!.replacingOccurrences(of: "_", with: " "), position: (clocks.map(\.position).max() ?? -1) + 1))
    }
    func removeClock(_ k: Clock) { var k = k; k.deleted = 1; save(k) }

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
        return save(Note(course_id: course, event_id: ev, session_date: session, title: title ?? nextUntitled(), body: body, pinned: pinned ? 1 : 0))
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
    private struct PushResult: Decodable { let revs: [String: [String: Int64]]? }

    private func applyRevs(_ revs: [String: [String: Int64]]) {
        for (id, r) in revs["courses"] ?? [:] { if let i = db.courses.firstIndex(where: { $0.id == id }) { db.courses[i].rev = r } }
        for (id, r) in revs["events"] ?? [:] { if let i = db.events.firstIndex(where: { $0.id == id }) { db.events[i].rev = r } }
        for (id, r) in revs["notes"] ?? [:] { if let i = db.notes.firstIndex(where: { $0.id == id }) { db.notes[i].rev = r } }
        for (id, r) in revs["alarms"] ?? [:] { if let i = db.alarms.firstIndex(where: { $0.id == id }) { db.alarms[i].rev = r } }
        for (id, r) in revs["clocks"] ?? [:] { if let i = db.clocks.firstIndex(where: { $0.id == id }) { db.clocks[i].rev = r } }
        for (id, r) in revs["timers"] ?? [:] { if let i = db.timers.firstIndex(where: { $0.id == id }) { db.timers[i].rev = r } }
        for (id, r) in revs["ringtones"] ?? [:] { if let i = db.ringtones.firstIndex(where: { $0.id == id }) { db.ringtones[i].rev = r } }
        for (id, r) in revs["prefs"] ?? [:] { if let i = db.prefs.firstIndex(where: { $0.id == id }) { db.prefs[i].rev = r } }
    }

    func sync() async {
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { syncState = "signed_out"; return }
        do {
            var dirty = DB()
            dirty.courses = db.courses.filter { $0.dirty == 1 }
            dirty.events = db.events.filter { $0.dirty == 1 }
            dirty.notes = db.notes.filter { $0.dirty == 1 }
            dirty.alarms = db.alarms.filter { $0.dirty == 1 }
            dirty.clocks = db.clocks.filter { $0.dirty == 1 }
            dirty.timers = db.timers.filter { $0.dirty == 1 }
            dirty.ringtones = db.ringtones.filter { $0.dirty == 1 }
            dirty.prefs = db.prefs.filter { $0.dirty == 1 }
            let pushed = dirty
            if !(dirty.courses.isEmpty && dirty.events.isEmpty && dirty.notes.isEmpty && dirty.alarms.isEmpty && dirty.clocks.isEmpty && dirty.timers.isEmpty && dirty.ringtones.isEmpty && dirty.prefs.isEmpty) {
                var req = request(base.appendingPathComponent("api/sync"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONEncoder().encode(["changes": dirty])
                let (pd, pr) = try await URLSession.shared.data(for: req)
                try check((pd, pr))
                clean(pushed)
                // Record the rev each pushed row got: the base for the next edit.
                if let res = try? JSONDecoder().decode(PushResult.self, from: pd) { applyRevs(res.revs ?? [:]) }
            }
            var comps = URLComponents(url: base.appendingPathComponent("api/sync"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "since", value: String(cursor))]
            let (data, res) = try await URLSession.shared.data(for: request(comps.url!))
            try check((data, res))
            let pull = try JSONDecoder().decode(Pull.self, from: data)
            merge(pull.changes)
            applyZone()
            cursor = pull.rev
            if let d = try? JSONEncoder().encode(db) { try? d.write(to: file, options: .atomic) }
            if account == nil, let got = try? await URLSession.shared.data(for: request(base.appendingPathComponent("api/account"))),
               (got.1 as? HTTPURLResponse)?.statusCode == 200, let o = try? JSONSerialization.jsonObject(with: got.0) as? [String: Any], let e = o["email"] as? String {
                UserDefaults.standard.set(e.lowercased(), forKey: "account")
            }
            await fetchSounds(base)
            Notifications.reschedule(self)
            syncState = "synced"; syncError = nil; lastSync = nowMs()
        } catch is CancellationError {
        } catch {
            syncState = (error as NSError).code == 401 ? "signed_out" : "offline"; syncError = error.localizedDescription
        }
    }

    private func request(_ url: URL) -> URLRequest {
        var r = URLRequest(url: url, timeoutInterval: 15)
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return r
    }

    private func check(_ r: (Data, URLResponse)) throws {
        if let h = r.1 as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            let msg = ((try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any])?["error"] as? String
            throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: msg ?? "HTTP \(h.statusCode)"])
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
        c(&db.clocks, p.clocks, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.timers, p.timers, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.ringtones, p.ringtones, { $0.updated_at }, { $0.dirty = 0 })
        c(&db.prefs, p.prefs, { $0.updated_at }, { $0.dirty = 0 })
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
        m(&db.clocks, ch.clocks, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.timers, ch.timers, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.ringtones, ch.ringtones, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.prefs, ch.prefs, { $0.updated_at }, { $0.dirty = 0 })
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
            content.sound = UNNotificationSound(named: UNNotificationSoundName(Ringtones.file))
            content.interruptionLevel = .timeSensitive
            let date = Date(timeIntervalSince1970: Double(at) / 1000)
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }
        AlarmKitScheduler.reschedule(store)
    }
}
