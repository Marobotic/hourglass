import Foundation

// Swift port of core/*.js. Field names match the server's JSON exactly so
// rows round-trip through sync untouched. core/test is the spec.

struct Repeat: Codable, Hashable {
    var freq: String
    var days: [Int]?
    var interval: Int?
    var until: String?
}

struct Course: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString.lowercased()
    var name: String = ""
    var code: String?
    var color: String = "#B14242"
    var location: String?
    var teacher: String?
    var archived: Int = 0
    var updated_at: Int64 = 0
    var deleted: Int = 0
    var rev: Int64? = 0
    var dirty: Int? = 0
}

struct Event: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString.lowercased()
    var course_id: String?
    var title: String = ""
    var kind: String = "event"
    var location: String?
    var start_date: String = ""
    var start_time: String = "09:00"
    var end_time: String = "10:00"
    var `repeat`: Repeat?
    var exceptions: [String] = []
    var updated_at: Int64 = 0
    var deleted: Int = 0
    var rev: Int64? = 0
    var dirty: Int? = 0
}

struct Note: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString.lowercased()
    var course_id: String?
    var event_id: String?
    var session_date: String?
    var title: String = ""
    var body: String = ""
    var pinned: Int = 0
    var updated_at: Int64 = 0
    var deleted: Int = 0
    var rev: Int64? = 0
    var dirty: Int? = 0
}

struct Alarm: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString.lowercased()
    var label: String = ""
    var time: String?
    var days: [Int] = []
    var date: String?
    var lead_event_id: String?
    var lead_course_id: String?
    var lead_minutes: Int?
    var enabled: Int = 1
    var updated_at: Int64 = 0
    var deleted: Int = 0
    var rev: Int64? = 0
    var dirty: Int? = 0
}

struct HTimer: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString.lowercased()
    var label: String = ""
    var duration_s: Int = 0
    var state: String = "running"
    var ends_at: Int64?
    var remaining_s: Int?
    var updated_at: Int64 = 0
    var deleted: Int = 0
    var rev: Int64? = 0
    var dirty: Int? = 0
}

let PALETTE = ["#B14242", "#D66E36", "#F0BE66", "#4A8B8B", "#7E6BAF", "#5B8C4A", "#C2587E", "#8A8A8A"]
let KINDS = ["lecture", "lab", "tutorial", "exam", "event"]

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

// "YYYY-MM-DD" calendar dates (day maths in UTC, no DST drift) and local instants.
enum Dates {
    static let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    static let longDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    static var utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    static var local: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = .current; return c }

    static func parts(_ s: String) -> (Int, Int, Int) {
        let p = s.split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? (p[0], p[1], p[2]) : (1970, 1, 1)
    }
    static func date(_ s: String) -> Date {
        let (y, m, d) = parts(s)
        return utc.date(from: DateComponents(year: y, month: m, day: d))!
    }
    static func format(_ d: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04ld-%02ld-%02ld", c.year!, c.month!, c.day!)
    }
    static func add(_ s: String, _ n: Int) -> String { format(utc.date(byAdding: .day, value: n, to: date(s))!) }
    static func between(_ a: String, _ b: String) -> Int { utc.dateComponents([.day], from: date(a), to: date(b)).day! }
    static func iso(_ s: String) -> Int { (utc.component(.weekday, from: date(s)) + 5) % 7 + 1 }
    static func weekStart(_ s: String) -> String { add(s, 1 - iso(s)) }
    static func minutes(_ t: String) -> Int {
        let p = t.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? p[0] * 60 + p[1] : 0
    }
    static func isTime(_ t: String) -> Bool {
        let p = t.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 && (0..<24).contains(p[0]) && (0..<60).contains(p[1])
    }
    static func today() -> String {
        let c = local.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04ld-%02ld-%02ld", c.year!, c.month!, c.day!)
    }
    static func dayOf(_ ms: Int64) -> String {
        let c = local.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return String(format: "%04ld-%02ld-%02ld", c.year!, c.month!, c.day!)
    }
    // Instant of a wall-clock date and time in the device's zone.
    static func epoch(_ d: String, _ t: String) -> Int64 {
        let (y, m, day) = parts(d)
        let mins = minutes(t)
        let date = local.date(from: DateComponents(year: y, month: m, day: day, hour: mins / 60, minute: mins % 60))!
        return Int64(date.timeIntervalSince1970 * 1000)
    }
    static func clock(_ ms: Int64) -> String {
        let c = local.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: Double(ms) / 1000))
        return String(format: "%02ld:%02ld", c.hour!, c.minute!)
    }
    static func short(_ s: String) -> String {
        let (_, m, d) = parts(s)
        return "\(weekdays[iso(s) - 1]) \(d) \(months[m - 1])"
    }
    static func long(_ s: String) -> String {
        let (_, m, d) = parts(s)
        return "\(longDays[iso(s) - 1]), \(d) \(longMonths[m - 1])"
    }
    static func relative(_ min: Int64) -> String {
        if min < 1 { return "now" }
        if min < 60 { return "in \(min) min" }
        if min < 1440 { return "in \(min / 60) h" + (min % 60 > 0 ? " \(min % 60) min" : "") }
        let d = Int((Double(min) / 1440).rounded())
        return "in \(d) " + (d == 1 ? "day" : "days")
    }
    static func left(_ min: Int64) -> String {
        min < 60 ? "\(min) min left" : "\(min / 60) h" + (min % 60 > 0 ? " \(min % 60) min" : "") + " left"
    }
    static func countdown(_ sec: Int64) -> String {
        let s = max(0, sec)
        let h = s / 3600, m = s % 3600 / 60, r = s % 60
        return h > 0 ? String(format: "%lld:%02lld:%02lld", h, m, r) : String(format: "%lld:%02lld", m, r)
    }
}

struct Occ: Identifiable, Hashable {
    var id: String { event_id + date }
    let event_id: String
    let course_id: String?
    let title: String
    let kind: String
    let location: String?
    let color: String
    let code: String?
    let date: String
    let start_time: String
    let end_time: String
    let start_ms: Int64
    let end_ms: Int64

    func state(_ now: Int64) -> String { now < start_ms ? "upcoming" : now < end_ms ? "live" : "ended" }
    func progress(_ now: Int64) -> Double { min(1, max(0, Double(now - start_ms) / Double(end_ms - start_ms))) }
}

enum Recurrence {
    static func dates(_ ev: Event, _ from: String, _ to: String) -> [String] {
        let start = ev.start_date
        let skip = Set(ev.exceptions)
        guard let rep = ev.repeat else {
            return start >= from && start <= to && !skip.contains(start) ? [start] : []
        }
        let interval = max(1, rep.interval ?? 1)
        let until = rep.until.map { $0 < to ? $0 : to } ?? to
        var d = start > from ? start : from
        var out: [String] = []
        if rep.freq == "daily" {
            while d <= until {
                if Dates.between(start, d) % interval == 0 && !skip.contains(d) { out.append(d) }
                d = Dates.add(d, 1)
            }
        } else if rep.freq == "weekly" {
            let days = (rep.days?.isEmpty ?? true) ? [Dates.iso(start)] : rep.days!
            let anchor = Dates.weekStart(start)
            while d <= until {
                if days.contains(Dates.iso(d)) && !skip.contains(d) && (Dates.between(anchor, Dates.weekStart(d)) / 7) % interval == 0 { out.append(d) }
                d = Dates.add(d, 1)
            }
        }
        return out
    }

    static func expand(_ events: [Event], _ courses: [String: Course], _ from: String, _ to: String) -> [Occ] {
        var out: [Occ] = []
        for ev in events where ev.deleted == 0 {
            let c = ev.course_id.flatMap { courses[$0] }
            if let c, c.deleted == 1 || c.archived == 1 { continue }
            guard Dates.isTime(ev.start_time), Dates.isTime(ev.end_time), ev.start_date.count == 10 else { continue }
            let sm = Dates.minutes(ev.start_time)
            var em = Dates.minutes(ev.end_time)
            if em <= sm { em = sm + 60 }
            for d in dates(ev, from, to) {
                let s = Dates.epoch(d, ev.start_time)
                out.append(Occ(event_id: ev.id, course_id: ev.course_id, title: ev.title.isEmpty ? (c?.name ?? "Untitled") : ev.title,
                               kind: ev.kind, location: (ev.location?.isEmpty == false ? ev.location : c?.location), color: c?.color ?? "#4A8B8B",
                               code: c?.code, date: d, start_time: ev.start_time, end_time: ev.end_time, start_ms: s, end_ms: s + Int64(em - sm) * 60_000))
            }
        }
        return out.sorted { ($0.start_ms, $0.title) < ($1.start_ms, $1.title) }
    }
}

struct SessionNotes { var session: [Note] = []; var pinned: [Note] = []; var last: [Note] = []; var lastDate: String? = nil }

struct NowState {
    let now: Int64
    let today: String
    let active: Occ?
    let next: Occ?
    let focus: Occ?
    let todayList: [Occ]
    let notes: SessionNotes
}

enum Now {
    static let early: Int64 = 10 * 60_000
    static let late: Int64 = 15 * 60_000

    static func resolve(_ courses: [Course], _ events: [Event], _ notes: [Note], _ now: Int64) -> NowState {
        let today = Dates.dayOf(now)
        let cmap = Dictionary(uniqueKeysWithValues: courses.filter { $0.deleted == 0 }.map { ($0.id, $0) })
        let occ = Recurrence.expand(events, cmap, Dates.add(today, -1), Dates.add(today, 7))
        let active = occ.first(where: { now >= $0.start_ms && now < $0.end_ms }) ?? occ.first(where: { now >= $0.start_ms - early && now < $0.end_ms + late })
        let next = occ.first(where: { $0.start_ms > now && $0 != active })
        let focus = active ?? (next?.date == today ? next : nil)
        return NowState(now: now, today: today, active: active, next: next, focus: focus,
                        todayList: occ.filter { $0.date == today }, notes: focus.map { sessionNotes(notes, $0) } ?? SessionNotes())
    }

    static func sessionNotes(_ notes: [Note], _ o: Occ) -> SessionNotes {
        let mine = notes.filter { $0.deleted == 0 && $0.course_id != nil && $0.course_id == o.course_id }
        let session = mine.filter { $0.session_date == o.date && ($0.event_id == nil || $0.event_id == o.event_id) }.sorted { $0.updated_at > $1.updated_at }
        let pinned = mine.filter { $0.pinned == 1 && $0.session_date != o.date }.sorted { $0.updated_at > $1.updated_at }
        let earlier = mine.filter { ($0.session_date ?? "") != "" && $0.session_date! < o.date && $0.pinned == 0 }
        let lastDate = earlier.compactMap(\.session_date).max()
        let last = lastDate.map { d in earlier.filter { $0.session_date == d }.sorted { $0.updated_at > $1.updated_at } } ?? []
        return SessionNotes(session: session, pinned: pinned, last: last, lastDate: lastDate)
    }
}

enum Alarms {
    static func next(_ a: Alarm, _ courses: [Course], _ events: [Event], _ from: Int64) -> Int64? {
        if a.deleted == 1 || a.enabled == 0 { return nil }
        let today = Dates.dayOf(from)
        if a.lead_event_id != nil || a.lead_course_id != nil {
            let evs = events.filter { $0.deleted == 0 && (a.lead_event_id != nil ? $0.id == a.lead_event_id : $0.course_id == a.lead_course_id) }
            if evs.isEmpty { return nil }
            let lead = Int64(a.lead_minutes ?? 10) * 60_000
            let cmap = Dictionary(uniqueKeysWithValues: courses.filter { $0.deleted == 0 }.map { ($0.id, $0) })
            return Recurrence.expand(evs, cmap, today, Dates.add(today, 14)).map { $0.start_ms - lead }.first(where: { $0 > from })
        }
        guard let t = a.time else { return nil }
        if let d = a.date { let at = Dates.epoch(d, t); return at > from ? at : nil }
        for i in 0...7 {
            let d = Dates.add(today, i)
            if !a.days.isEmpty && !a.days.contains(Dates.iso(d)) { continue }
            let at = Dates.epoch(d, t)
            if at > from { return at }
        }
        return nil
    }
}
