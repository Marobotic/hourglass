import Foundation
import UIKit
import UserNotifications

struct DB: Codable {
    var courses: [Course] = []
    var events: [Event] = []
    var notes: [Note] = []
    var alarms: [Alarm] = []
    var clocks: [Clock] = []
    var timers: [HTimer] = []
    var reminders: [Reminder] = []
    var ringtones: [Ringtone] = []
    var prefs: [Pref] = []
    var note_versions: [NoteVersion] = []
    var marks: [Mark] = []
    var folders: [Folder] = []
    var files: [DriveFile] = []

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
        reminders = try c.decodeIfPresent([Reminder].self, forKey: .reminders) ?? []
        ringtones = try c.decodeIfPresent([Ringtone].self, forKey: .ringtones) ?? []
        prefs = try c.decodeIfPresent([Pref].self, forKey: .prefs) ?? []
        note_versions = try c.decodeIfPresent([NoteVersion].self, forKey: .note_versions) ?? []
        marks = try c.decodeIfPresent([Mark].self, forKey: .marks) ?? []
        folders = try c.decodeIfPresent([Folder].self, forKey: .folders) ?? []
        files = try c.decodeIfPresent([DriveFile].self, forKey: .files) ?? []
    }
}

struct Slot: Hashable { var day: Int; var start: String; var end: String; var kind: String = "lecture" }

// Local replica + domain operations (same semantics as core/node/service.js) + sync.
@MainActor
final class Store: ObservableObject {
    // One store for the app and the alarm buttons (which iOS runs in the background).
    static let shared = Store()

    @Published private(set) var db = DB()
    @Published var syncState = "local"
    @Published var syncError: String?
    @Published var lastSync: Int64 = 0

    // Built in at build time; not user-editable.
    let server: String = (Bundle.main.object(forInfoDictionaryKey: "HourglassServer") as? String) ?? ""
    // The Jukebox session once signed in; before that the build's legacy key.
    private var token: String { Keychain.get("session") ?? (UserDefaults.standard.bool(forKey: "signed_out") ? "" : Keychain.get("sync-token") ?? "") }
    @Published var signedIn = Keychain.get("session") != nil
    // Why the sign-in screen is showing when the app signed itself out.
    @Published var sessionEnded: String?
    // Uploads going up and just done, for the upload panel (like Google Drive's).
    @Published var uploads: [UploadItem] = []
    private var uploadTasks: [String: Task<(Data, URLResponse), Error>] = [:]
    var account: String? { UserDefaults.standard.string(forKey: "account") }
    private var cursor: Int64 { get { Int64(UserDefaults.standard.integer(forKey: "cursor")) } set { UserDefaults.standard.set(Int(newValue), forKey: "cursor") } }

    private let file: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("hourglass.json")
    }()
    private var syncTask: Task<Void, Never>?

    init() {
        // Builds no longer ship a token (a fresh install signs in). Older builds
        // kept one in UserDefaults: move it into the Keychain.
        if Keychain.get("sync-token") == nil, let legacy = UserDefaults.standard.string(forKey: "token"), !legacy.isEmpty {
            Keychain.set("sync-token", legacy)
        }
        UserDefaults.standard.removeObject(forKey: "token")
        UserDefaults.standard.removeObject(forKey: "server")
        // New table since the last run: pull everything once.
        if UserDefaults.standard.integer(forKey: "schema") != 7 {
            UserDefaults.standard.set(0, forKey: "cursor")
            UserDefaults.standard.set(7, forKey: "schema")
        }
        if let data = try? Data(contentsOf: file), let d = try? JSONDecoder().decode(DB.self, from: data) { db = d }
        // The share extension reads the server and session from the app group.
        SharedBox.save(server: server, session: Keychain.get("session"))
        ensureHomeClock()
        applyZone()
    }

    // MARK: reads

    var courses: [Course] { db.courses.filter { $0.deleted == 0 && $0.archived == 0 }.sorted { $0.name.lowercased() < $1.name.lowercased() } }
    var events: [Event] { db.events.filter { $0.deleted == 0 } }
    var notes: [Note] { db.notes.filter { $0.deleted == 0 } }
    var alarms: [Alarm] { db.alarms.filter { $0.deleted == 0 } }
    var timers: [HTimer] { db.timers.filter { $0.deleted == 0 && $0.state != "done" } }
    func course(_ id: String?) -> Course? { courses.first { $0.id == id } }
    var markMap: [String: String] { Dictionary(db.marks.filter { $0.deleted == 0 }.map { ($0.id, $0.status) }, uniquingKeysWith: { a, _ in a }) }
    func now(_ ms: Int64 = nowMs()) -> NowState { Now.resolve(db.courses, db.events, db.notes, ms, marks: markMap) }
    func occurrences(_ from: String, _ to: String) -> [Occ] {
        Recurrence.expand(db.events, Dictionary(uniqueKeysWithValues: db.courses.map { ($0.id, $0) }), from, to, marks: markMap)
    }
    // MARK: attendance

    struct Session: Identifiable, Hashable {
        var id: String { date }
        let date: String
        let mark: String?
        let future: Bool
        let occ: Occ
    }

    // Every course's sessions, from its first to the end of term (the last
    // "until", at most six months out): one per day with its mark, upcoming
    // flagged. Same rule as the desktop's Attendance page.
    func attendanceSessions(_ now: Int64 = nowMs()) -> [(Course, [Session])] {
        let mine = events.filter { $0.course_id != nil }
        guard !mine.isEmpty else { return courses.map { ($0, []) } }
        let today = Dates.today()
        let from = mine.map(\.start_date).filter { !$0.isEmpty }.min() ?? today
        let last = mine.map { $0.repeat?.until ?? $0.start_date }.max() ?? today
        var to = min(last, Dates.add(today, 183))
        if to < today { to = today }
        var by: [String: [String: Session]] = [:]
        for o in occurrences(from, to) {
            guard let cid = o.course_id else { continue }
            let day = o.session.isEmpty ? o.date : o.session
            if by[cid]?[day] == nil { by[cid, default: [:]][day] = Session(date: day, mark: o.mark, future: o.start_ms > now, occ: o) }
        }
        return courses.map { c in (c, (by[c.id] ?? [:]).values.sorted { $0.date < $1.date }) }
    }

    // unmarked -> attended -> absent -> off -> unmarked
    func cycleMark(_ s: Session) {
        let next: String? = s.mark == nil ? "attended" : s.mark == "attended" ? "absent" : s.mark == "absent" ? "off" : nil
        setMark(s.occ, next)
    }

    // MARK: drive

    var folders: [Folder] { db.folders.filter { $0.deleted == 0 } }
    var files: [DriveFile] { db.files.filter { $0.deleted == 0 } }
    func file(_ id: String) -> DriveFile? { files.first { $0.id == id } }

    struct DriveView {
        var folder: Folder?
        var course: Course?
        var path: [Folder] = []
        var courses: [(Course, Int)] = []
        var folders: [(Folder, Int)] = []
        var files: [DriveFile] = []
    }

    // One folder's contents (nil = the top) or one course's folder. The top
    // lists the courses, then the folders and files that are in none.
    func drive(_ folderId: String?, course courseId: String?) -> DriveView {
        let known = Set(courses.map(\.id))
        let fs = files.map { f -> DriveFile in var f = f; if let c = f.course_id, !known.contains(c) { f.course_id = nil }; return f }
        let byName: (String, String) -> Bool = { $0.lowercased() < $1.lowercased() }
        if let courseId {
            return DriveView(course: course(courseId), files: fs.filter { $0.course_id == courseId }.sorted { byName($0.name, $1.name) })
        }
        var path: [Folder] = []
        var f = folderId.flatMap { id in folders.first { $0.id == id } }
        while let cur = f { path.insert(cur, at: 0); f = cur.parent_id.flatMap { p in folders.first { $0.id == p } } }
        return DriveView(
            folder: path.last, course: nil, path: path,
            courses: folderId == nil ? courses.map { c in (c, fs.filter { $0.course_id == c.id }.count) } : [],
            folders: folders.filter { $0.parent_id == folderId }.sorted { byName($0.name, $1.name) }
                .map { d in (d, folders.filter { $0.parent_id == d.id }.count + fs.filter { $0.folder_id == d.id }.count) },
            files: fs.filter { $0.course_id == nil && $0.folder_id == folderId }.sorted { byName($0.name, $1.name) })
    }

    @discardableResult
    func save(_ f: Folder) -> Folder {
        var f = f; f.updated_at = stamp(db.folders.first { $0.id == f.id }?.updated_at ?? 0); f.dirty = 1; if f.deleted != 1 { f.deleted = 0 }
        if let i = db.folders.firstIndex(where: { $0.id == f.id }) { db.folders[i] = f } else { db.folders.append(f) }
        changed(); return f
    }
    @discardableResult
    func save(_ f: DriveFile) -> DriveFile {
        var f = f; f.updated_at = stamp(db.files.first { $0.id == f.id }?.updated_at ?? 0); f.dirty = 1; if f.deleted != 1 { f.deleted = 0 }
        if let i = db.files.firstIndex(where: { $0.id == f.id }) { db.files[i] = f } else { db.files.append(f) }
        changed(); return f
    }
    @discardableResult
    func addFolder(_ name: String, parent: String?) -> Folder { save(Folder(name: name.trimmingCharacters(in: .whitespaces), parent_id: parent)) }
    // A folder goes with everything in it.
    func removeFolder(_ id: String) {
        for sub in folders where sub.parent_id == id { removeFolder(sub.id) }
        for var f in files where f.folder_id == id { f.deleted = 1; save(f) }
        if var d = folders.first(where: { $0.id == id }) { d.deleted = 1; save(d) }
    }
    func removeFile(_ id: String) {
        if var f = file(id) { f.deleted = 1; save(f) }
        try? FileManager.default.removeItem(at: driveDir.appendingPathComponent(id))
    }
    func setFileCourse(_ id: String, _ course: String?) {
        guard var f = file(id) else { return }
        f.course_id = course
        if course != nil { f.folder_id = nil }
        save(f)
    }
    func setFileFolder(_ id: String, _ folder: String?) {
        guard var f = file(id) else { return }
        f.folder_id = folder; f.course_id = nil
        save(f)
    }

    // A folder into another (nil = the top). Never into itself or one of its
    // own folders: false then, and nothing changes.
    @discardableResult
    func moveFolder(_ id: String, into parent: String?) -> Bool {
        var p = parent
        while let cur = p {
            if cur == id { return false }
            p = folders.first { $0.id == cur }?.parent_id
        }
        guard var d = folders.first(where: { $0.id == id }) else { return false }
        d.parent_id = parent
        save(d)
        return true
    }

    // Drive links ("anyone with the link can view"), kept on the server. Each
    // one: token, url, access (view | download), file_id or folder_id, expires_at, active.
    func shares() async throws -> [[String: Any]] {
        guard let base = URL(string: server) else { return [] }
        let r = try await URLSession.shared.data(for: request(base.appendingPathComponent("api/shares")))
        try check(r)
        return ((try? JSONSerialization.jsonObject(with: r.0)) as? [[String: Any]] ?? []).filter { ($0["active"] as? Bool) == true }
    }

    // Make a link, or change the access of the one there is (same link). days: 0 = never ends.
    func share(file: String?, folder: String?, access: String, days: Int) async throws -> [String: Any] {
        guard let base = URL(string: server) else { return [:] }
        // A folder made on this phone must be on the server first.
        if db.folders.contains(where: { $0.dirty == 1 }) { await sync() }
        var req = request(base.appendingPathComponent("api/shares"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["access": access, "expires_days": days]
        if let file { body["file_id"] = file } else if let folder { body["folder_id"] = folder }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let r = try await URLSession.shared.data(for: req)
        try check(r)
        return (try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any] ?? [:]
    }

    func unshare(_ shareToken: String) async throws {
        guard let base = URL(string: server) else { return }
        var req = request(base.appendingPathComponent("api/shares/\(shareToken)"))
        req.httpMethod = "DELETE"
        try check(try await URLSession.shared.data(for: req))
    }

    // Where the assistant's attachments go: the Drive's "Assistant" folder (made by the server).
    func assistantFolder() async throws -> String {
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        let r = try await URLSession.shared.data(for: request(base.appendingPathComponent("api/assistant/folder")))
        try check(r)
        guard let id = ((try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any])?["folder_id"] as? String else {
            throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No Assistant folder"])
        }
        return id
    }

    private var driveDir: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("drive") }
    // This phone's copy, under the file's real name so other apps know what it is.
    func driveCopy(_ f: DriveFile) -> URL {
        driveDir.appendingPathComponent(f.id).appendingPathComponent(f.name.replacingOccurrences(of: "/", with: "_").isEmpty ? "file" : f.name.replacingOccurrences(of: "/", with: "_"))
    }

    // Fetch a file's bytes once (kept until it changes size).
    // --- Drive versions (kept on the server) ---------------------------------------

    func versions(_ f: DriveFile) async throws -> FileVersions {
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        let r = try await URLSession.shared.data(for: request(base.appendingPathComponent("api/files/\(f.id)/versions")))
        try check(r)
        return try JSONDecoder().decode(FileVersions.self, from: r.0)
    }
    func versionDiff(_ f: DriveFile, _ vid: String) async throws -> VersionDiff {
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        let r = try await URLSession.shared.data(for: request(base.appendingPathComponent("api/files/\(f.id)/versions/\(vid)/diff")))
        try check(r)
        return try JSONDecoder().decode(VersionDiff.self, from: r.0)
    }
    /// Put a version back: what is there now is kept as a version too.
    func restoreVersion(_ f: DriveFile, _ vid: String) async throws {
        guard let base = URL(string: server) else { return }
        var req = request(base.appendingPathComponent("api/files/\(f.id)/versions/\(vid)/restore"))
        req.httpMethod = "POST"
        req.timeoutInterval = 300
        let (d, r) = try await URLSession.shared.data(for: req)
        try check((d, r))
        var row = try JSONDecoder().decode(DriveFile.self, from: d)
        row.dirty = 0
        if let i = db.files.firstIndex(where: { $0.id == row.id }) { db.files[i] = row }
        await syncSoon()
    }
    /// An old version's bytes, as a file named like the original (for Quick Look and Share).
    func versionFile(_ f: DriveFile, _ vid: String) async throws -> URL {
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent("versions/\(vid)/\(f.name)")
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        var req = request(base.appendingPathComponent("api/files/\(f.id)/versions/\(vid)/raw"))
        req.timeoutInterval = 300
        let (tmp, res) = try await URLSession.shared.download(for: req)
        if let h = res as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: h.statusCode == 404 ? "That version is no longer kept." : "HTTP \(h.statusCode)"])
        }
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// A Drive video, playing while it streams from the server.
    func stream(_ f: DriveFile) -> URL? { URL(string: server)?.appendingPathComponent("api/files/\(f.id)/raw") }
    var authHeaders: [String: String] { ["Authorization": "Bearer \(token)"] }

    func download(_ f: DriveFile) async throws -> URL {
        let dest = driveCopy(f)
        if let size = (try? FileManager.default.attributesOfItem(atPath: dest.path))?[.size] as? Int64, size == f.size { return dest }
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        var req = request(base.appendingPathComponent("api/files/\(f.id)/raw"))
        req.timeoutInterval = 300
        let (tmp, res) = try await URLSession.shared.download(for: req)
        if let h = res as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(h.statusCode)"])
        }
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    // The server's disk: total, free, what this account uses.
    func driveUsage() async -> [String: Int64]? {
        guard let base = URL(string: server), !token.isEmpty else { return nil }
        guard let (d, r) = try? await URLSession.shared.data(for: request(base.appendingPathComponent("api/drive/usage"))),
              (r as? HTTPURLResponse)?.statusCode == 200,
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
        return o.compactMapValues { ($0 as? NSNumber)?.int64Value }
    }

    // The folder note attachments go to when the note has no course.
    private func attachmentsFolder() async -> String {
        if let f = folders.first(where: { $0.parent_id == nil && $0.name == "Note attachments" }) { return f.id }
        let f = addFolder("Note attachments", parent: nil)
        // The server checks the folder exists before taking the upload.
        await syncSoon()
        if db.folders.first(where: { $0.id == f.id })?.dirty == 1 { await sync() }
        return f.id
    }

    // Send a file from the phone to the Drive. note: attached to that note
    // (its course's folder, or "Note attachments"). Returns the new row.
    func upload(_ url: URL, name: String? = nil, folder: String?, course: String?, note: String? = nil) async throws -> DriveFile {
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        let fileName = name ?? url.lastPathComponent
        let mime = mimeOf(fileName)
        // Too big for one upload (the server says how big, max_file): say so
        // before sending, not after a dropped connection.
        let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0
        if let max = await driveUsage()?["max_file"], max > 0, size > max {
            throw NSError(domain: "hourglass", code: 413, userInfo: [NSLocalizedDescriptionKey: "\(fileName) is over \(max / 1_048_576) MB, the most one upload can be."])
        }
        let folderId = (note != nil && course == nil) ? await attachmentsFolder() : folder
        var comps = URLComponents(url: base.appendingPathComponent("api/files/upload"), resolvingAgainstBaseURL: false)!
        var q = [URLQueryItem(name: "name", value: fileName), URLQueryItem(name: "mime", value: mime)]
        if let course { q.append(URLQueryItem(name: "course", value: course)) } else if let folderId { q.append(URLQueryItem(name: "folder", value: folderId)) }
        if let note { q.append(URLQueryItem(name: "note", value: note)) }
        comps.queryItems = q
        var req = request(comps.url!)
        req.httpMethod = "POST"
        req.timeoutInterval = 900
        req.setValue(mime, forHTTPHeaderField: "Content-Type")
        // Shown in the upload panel while it goes: bytes sent, speed, cancel.
        let id = UUID().uuidString
        uploads.removeAll { $0.state != "sending" && Date().timeIntervalSince($0.at) > 600 }
        uploads.insert(UploadItem(id: id, name: fileName, size: size), at: 0)
        let progress = UploadProgress { [weak self] sent, speed in Task { @MainActor in self?.setUpload(id) { $0.sent = sent; $0.speed = speed } } }
        let task = Task { try await URLSession.shared.upload(for: req, fromFile: url, delegate: progress) }
        uploadTasks[id] = task
        defer { uploadTasks[id] = nil }
        let d: Data, r: URLResponse
        do {
            (d, r) = try await task.value
            try check((d, r))
        } catch {
            let gone = task.isCancelled
            setUpload(id) { $0.state = gone ? "cancelled" : "failed"; $0.error = gone ? "Cancelled" : error.localizedDescription; $0.speed = 0; $0.at = Date() }
            if gone { throw CancellationError() }
            throw error
        }
        setUpload(id) { $0.state = "done"; $0.sent = max($0.sent, $0.size); $0.speed = 0; $0.at = Date() }
        let row = try JSONDecoder().decode(DriveFile.self, from: d)
        var clean = row; clean.dirty = 0
        if let i = db.files.firstIndex(where: { $0.id == row.id }) { db.files[i] = clean } else { db.files.append(clean) }
        await syncSoon()
        return clean
    }

    private func setUpload(_ id: String, _ change: (inout UploadItem) -> Void) {
        guard let i = uploads.firstIndex(where: { $0.id == id }) else { return }
        change(&uploads[i])
    }
    func cancelUpload(_ id: String) { uploadTasks[id]?.cancel() }
    /// Close the panel: the finished ones go.
    func clearUploads() { uploads.removeAll { $0.state != "sending" } }

    // A Drive file's preview from the server (big: 480 px, for the gallery),
    // kept in Caches under the row's updated_at so an edit makes a new one.
    private var thumbCache = NSCache<NSString, UIImage>()
    func thumb(_ f: DriveFile, big: Bool) async -> UIImage? {
        let key = "\(f.id).\(f.updated_at)\(big ? ".big" : "")"
        if let img = thumbCache.object(forKey: key as NSString) { return img }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("thumbs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(key + ".jpg")
        var data = try? Data(contentsOf: file)
        if data == nil, let base = URL(string: server) {
            var comps = URLComponents(url: base.appendingPathComponent("api/files/\(f.id)/thumb"), resolvingAgainstBaseURL: false)!
            if big { comps.queryItems = [URLQueryItem(name: "size", value: "big")] }
            var req = request(comps.url!)
            req.timeoutInterval = 60
            guard let (d, r) = try? await URLSession.shared.data(for: req), let http = r as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            data = d
            // A server from before big previews sends the small one: shown, not kept.
            if !big || http.value(forHTTPHeaderField: "x-thumb-size") == "480" {
                for old in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where old.hasPrefix(f.id + ".") && old.hasSuffix(".big.jpg") == big {
                    try? FileManager.default.removeItem(at: dir.appendingPathComponent(old))
                }
                try? d.write(to: file)
            }
        }
        guard let data, let img = UIImage(data: data) else { return nil }
        thumbCache.setObject(img, forKey: key as NSString)
        return img
    }

    // Older text of a note, newest first.
    func versions(_ noteId: String) -> [NoteVersion] {
        db.note_versions.filter { $0.deleted == 0 && $0.note_id == noteId }.sorted { ($0.saved_at ?? 0) > ($1.saved_at ?? 0) }
    }
    // Putting one back is an ordinary edit; the server keeps the replaced text.
    func restore(_ v: NoteVersion) {
        guard var n = notes.first(where: { $0.id == v.note_id }) else { return }
        n.title = v.title; n.body = v.body
        save(n)
    }
    // Attended / absent / off for one day of a course; nil clears it.
    func setMark(_ o: Occ, _ status: String?) {
        let day = o.session.isEmpty ? o.date : o.session
        let id = markId(o.course_id, o.event_id, day)
        var m = db.marks.first { $0.id == id } ?? Mark(id: id, course_id: o.course_id, event_id: o.course_id == nil ? o.event_id : nil, date: day)
        if let status { m.status = status; m.deleted = 0 } else { m.deleted = 1 }
        m.updated_at = stamp(m.updated_at); m.dirty = 1
        if let i = db.marks.firstIndex(where: { $0.id == id }) { db.marks[i] = m } else { db.marks.append(m) }
        changed()
    }
    func attendance(_ course: String) -> [String: Int] {
        var out: [String: Int] = [:]
        for m in db.marks where m.deleted == 0 && m.course_id == course { out[m.status, default: 0] += 1 }
        return out
    }
    func courseNotes(_ course: String) -> [Note] { notes.filter { $0.course_id == course }.sorted { $0.updated_at > $1.updated_at } }

    // MARK: writes

    // Every change this phone makes is stamped here: those don't glow.
    private func stamp(_ old: Int64) -> Int64 { Motion.shared.touchLocal(); return max(nowMs(), old + 1) }

    func ensureHomeClock() {
        let active = db.clocks.filter { $0.deleted == 0 }
        if active.isEmpty {
            let z = TimeZone.current.identifier
            let label = z.components(separatedBy: "/").last?.replacingOccurrences(of: "_", with: " ") ?? z
            save(Clock(zone: z, label: label, position: 0, home: 1))
        } else if !active.contains(where: { $0.home == 1 }) {
            var first = active[0]
            first.home = 1
            save(first)
        }
    }

    func applyZone() {
        Dates.zone = db.clocks.first { $0.deleted == 0 && $0.home == 1 }.flatMap { TimeZone(identifier: $0.zone) } ?? .current
        Ringtones.current = ringtone
        // Time format, week start and alarm sound are synced prefs (a change on
        // any device, or by the assistant, shows here); the screens read them
        // from UserDefaults.
        let ud = UserDefaults.standard
        if let v = pref("time_format"), v == "12h" || v == "24h", ud.string(forKey: "time_format") != v { ud.set(v, forKey: "time_format") }
        if let v = pref("week_start").flatMap({ Int($0) }), [1, 6, 7].contains(v), ud.integer(forKey: "week_start") != v { ud.set(v, forKey: "week_start") }
        if let v = pref("sound"), v == "true" || v == "false", (ud.object(forKey: "sound") as? Bool) != (v == "true") { ud.set(v == "true", forKey: "sound") }
    }

    // MARK: ringtones (synced; audio in Library/Sounds so alarms can use it)

    var ringtoneRows: [Ringtone] { db.ringtones.filter { $0.deleted == 0 }.sorted { $0.updated_at > $1.updated_at } }
    var ringtone: String {
        let v = db.prefs.first { $0.id == "ringtone" && $0.deleted == 0 }?.value ?? "classic"
        return Ringtones.all.contains(v) || ringtoneRows.contains(where: { $0.id == v }) ? v : "classic"
    }
    // Synced preferences by key.
    func pref(_ key: String) -> String? { db.prefs.first { $0.id == key && $0.deleted == 0 }?.value }
    func setPref(_ key: String, _ value: String) {
        var p = db.prefs.first { $0.id == key } ?? Pref(id: key)
        p.value = value; p.deleted = 0; p.updated_at = stamp(p.updated_at); p.dirty = 1
        if let i = db.prefs.firstIndex(where: { $0.id == p.id }) { db.prefs[i] = p } else { db.prefs.append(p) }
        changed()
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
        await syncSoon()
    }

    // MARK: account (Jukebox)

    // A new Jukebox account, made from here; signed in once created.
    func register(email: String, password: String) async throws {
        try await signIn(email: email, password: password, path: "auth/register")
    }

    // Forgot password: the server mails a reset link (the same answer for any email).
    func forgotPassword(email: String) async throws {
        guard let base = URL(string: server) else { return }
        var req = URLRequest(url: base.appendingPathComponent("auth/forgot"), timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email])
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if code != 200 {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            throw NSError(domain: "hourglass", code: code, userInfo: [NSLocalizedDescriptionKey: Store.authMessage(code, obj, fallback: "Could not send the reset link")])
        }
    }

    // The server's terse sign-in errors, in words.
    static func authMessage(_ code: Int, _ obj: [String: Any], fallback: String) -> String {
        if code == 401 { return "Wrong email or password." }
        if code == 409 { return "That email already has an account. Sign in instead." }
        if code == 429 {
            if let s = obj["retryIn"] as? Int, s > 0 { return "Too many attempts. Try again in \(s) seconds." }
            return "Too many attempts. Try again in a minute."
        }
        return obj["error"] as? String ?? fallback
    }

    // The account's personal AI key and links. make: replace the key.
    func aiLinks(make: Bool) async throws -> [String: Any] {
        guard let base = URL(string: server) else { throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "No server"]) }
        var req = request(base.appendingPathComponent("api/ai"))
        if make { req.httpMethod = "POST"; req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.httpBody = Data("{}".utf8) }
        let r = try await URLSession.shared.data(for: req)
        try check(r)
        return (try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any] ?? [:]
    }

    // The Assistant tab: opencode on the server works on this account's data
    // (server/assistant.js). path: "" to read the chat, "/message", "/stop", "/new".
    func assistant(_ method: String, _ path: String = "", _ body: [String: Any]? = nil) async throws -> [String: Any] {
        guard signedIn, let base = URL(string: server) else {
            throw NSError(domain: "hourglass", code: 0, userInfo: [NSLocalizedDescriptionKey: "Sign in to use the assistant."])
        }
        // A query ("/models?base_url=…") stays a query, not part of the path.
        let parts = path.split(separator: "?", maxSplits: 1).map(String.init)
        var comps = URLComponents(url: base.appendingPathComponent("api/assistant" + (parts.first ?? "")), resolvingAgainstBaseURL: false)!
        if parts.count > 1 { comps.percentEncodedQuery = parts[1] }
        var req = request(comps.url!)
        req.httpMethod = method
        if method == "POST" {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body ?? [:])
        }
        let r = try await URLSession.shared.data(for: req)
        try check(r)
        return (try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any] ?? [:]
    }

    func signIn(email: String, password: String, path: String = "auth/login") async throws {
        guard let base = URL(string: server) else { return }
        var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["email": email, "password": password])
        let (data, res) = try await URLSession.shared.data(for: req)
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (res as? HTTPURLResponse)?.statusCode == 200, let session = obj["session"] as? String else {
            let code = (res as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "hourglass", code: 401, userInfo: [NSLocalizedDescriptionKey: Store.authMessage(code, obj, fallback: path == "auth/login" ? "Sign-in failed" : "Could not create the account")])
        }
        let who = (obj["email"] as? String ?? email).lowercased()
        if let was = account, was != who {
            db = DB()
            cursor = 0
        }
        Keychain.set("session", session)
        SharedBox.save(server: server, session: session)
        Keychain.delete("sync-token")
        UserDefaults.standard.removeObject(forKey: "signed_out")
        UserDefaults.standard.set(who, forKey: "account")
        signedIn = true
        sessionEnded = nil
        await syncSoon()
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
        SharedBox.save(server: server, session: nil)
        Keychain.delete("sync-token")
        UserDefaults.standard.set(true, forKey: "signed_out")
        signedIn = false
        syncState = "signed_out"
    }

    // Signed out by the server. The account name and this phone's data stay,
    // so signing in again with the same account sends the unsynced changes.
    private func endSession() {
        Keychain.delete("session")
        SharedBox.save(server: server, session: nil)
        Keychain.delete("sync-token")
        UserDefaults.standard.set(true, forKey: "signed_out")
        signedIn = false
        syncState = "signed_out"
        sessionEnded = "You were signed out, usually because the password was changed. Sign in again: nothing on this phone is lost."
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
        // Debounce only the wait: a push already on its way is never cancelled,
        // or its new rev is lost and the next save looks like an edit conflict.
        syncTask?.cancel()
        syncTask = Task {
            do { try await Task.sleep(nanoseconds: 1_500_000_000) } catch { return }
            await self.syncSoon()
        }
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
        let isFirst = clocks.isEmpty
        save(Clock(zone: zone, label: zone.components(separatedBy: "/").last!.replacingOccurrences(of: "_", with: " "), position: (clocks.map(\.position).max() ?? -1) + 1, home: isFirst ? 1 : 0))
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
        let day = o.session.isEmpty ? o.date : o.session
        if !e.exceptions.contains(day) { e.exceptions.append(day) }
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

    // Timers: running (a future start_at means scheduled), paused, idle (a
    // saved timer waiting to start) or done. Every device rings at ends_at.
    // MARK: reminders

    // Overdue first, then by when they show; done ones last, newest first.
    func reminders(_ now: Int64 = nowMs()) -> [(Reminder, ReminderState)] {
        let all = db.reminders.filter { $0.deleted == 0 }.map { ($0, Reminders.state($0, now)) }
        let open = all.filter { !$0.1.done }.sorted { a, b in a.1.overdue != b.1.overdue ? a.1.overdue : (a.1.dueAt ?? .max) < (b.1.dueAt ?? .max) }
        let done = all.filter { $0.1.done }.sorted { ($0.0.done_at ?? 0) > ($1.0.done_at ?? 0) }
        return open + done
    }
    @discardableResult
    func save(_ r: Reminder) -> Reminder {
        var r = r; r.updated_at = stamp(db.reminders.first { $0.id == r.id }?.updated_at ?? 0); r.dirty = 1
        if let i = db.reminders.firstIndex(where: { $0.id == r.id }) { db.reminders[i] = r } else { db.reminders.append(r) }
        changed()
        return r
    }
    // The day a time means with none given: today, or tomorrow once it has passed.
    func nextDate(for time: String) -> String {
        let today = Dates.today()
        return Dates.epoch(today, time) > nowMs() ? today : Dates.add(today, 1)
    }
    // A new or changed time is a new reminder: it shows again, a repeating one from now.
    func setReminder(_ existing: Reminder?, label: String, time: String, date: String?, days: [Int]) {
        var r = existing ?? Reminder()
        let text = label.trimmingCharacters(in: .whitespaces)
        r.label = text.isEmpty ? "Reminder" : text
        r.time = time
        r.days = days.sorted()
        r.date = days.isEmpty ? (date ?? nextDate(for: time)) : nil
        r.done_at = days.isEmpty ? nil : nowMs()
        r.snooze_at = nil
        save(r)
    }
    func reminderDone(_ id: String, _ done: Bool = true) {
        guard var r = db.reminders.first(where: { $0.id == id }) else { return }
        r.done_at = done || !r.days.isEmpty ? nowMs() : nil
        r.snooze_at = nil
        save(r)
    }
    func snoozeReminder(_ id: String, minutes: Int? = nil) {
        guard var r = db.reminders.first(where: { $0.id == id }) else { return }
        r.snooze_at = nowMs() + Int64(minutes ?? reminderSnooze) * 60_000
        save(r)
    }
    func removeReminder(_ id: String) {
        guard var r = db.reminders.first(where: { $0.id == id }) else { return }
        r.deleted = 1
        save(r)
    }
    // Their own settings (synced): a tone or silent, which tone, snooze length.
    var reminderStyle: String { pref("reminder_style") == "silent" ? "silent" : "tone" }
    var reminderTone: String { pref("reminder_tone").flatMap { Reminders.tones.contains($0) ? $0 : nil } ?? "chime" }
    var reminderSnooze: Int { pref("reminder_snooze").flatMap { Int($0) }.flatMap { (1...240).contains($0) ? $0 : nil } ?? 10 }

    func timerLeft(_ t: HTimer, _ now: Int64 = nowMs()) -> Int64 {
        switch t.state {
        case "running": return max(0, ((t.ends_at ?? 0) - max(now, t.start_at ?? 0) + 999) / 1000)
        case "idle": return Int64(t.duration_s)
        default: return Int64(t.remaining_s ?? 0)
        }
    }
    // id: a set id, so two devices snoozing the same ring make one timer.
    func startTimer(seconds: Int, label: String, persistent: Bool = false, startAt: Int64? = nil, id: String? = nil) {
        let start = startAt.flatMap { $0 > nowMs() ? $0 : nil }
        save(HTimer(id: id ?? UUID().uuidString.lowercased(), label: label.isEmpty ? (seconds % 60 == 0 ? "\(seconds / 60) min timer" : "\(seconds)s timer") : label,
                    duration_s: seconds, state: "running", ends_at: (start ?? nowMs()) + Int64(seconds) * 1000, persistent: persistent ? 1 : 0, start_at: start))
    }
    private func run(_ t: HTimer, _ secs: Int64) { var t = t; t.state = "running"; t.start_at = nil; t.remaining_s = nil; t.ends_at = nowMs() + secs * 1000; save(t) }
    func pause(_ t: HTimer) { var t = t; t.remaining_s = Int(timerLeft(t)); t.ends_at = nil; t.start_at = nil; t.state = "paused"; save(t) }
    func resume(_ t: HTimer) { run(t, Int64(t.remaining_s ?? 0)) }
    func restart(_ t: HTimer) { run(t, Int64(t.duration_s)) }
    func addMinute(_ t: HTimer) { var t = t; if t.state == "running" { t.ends_at = (t.ends_at ?? nowMs()) + 60_000 } else { t.remaining_s = (t.remaining_s ?? 0) + 60 }; save(t) }
    private func finished(_ t: HTimer) -> HTimer {
        var t = t
        if t.persistent == 1 { t.state = "idle"; t.ends_at = nil; t.remaining_s = nil; t.start_at = nil } else { t.state = "done" }
        return t
    }
    func reset(_ t: HTimer) { if t.persistent == 1 { save(finished(t)) } else { stop(t) } }
    func stop(_ t: HTimer) { var t = t; t.deleted = 1; save(t) }
    // Timers that rang while the app was closed.
    func sweepTimers() {
        for t in db.timers where t.deleted == 0 && t.state == "running" && (t.ends_at ?? .max) < nowMs() - 2000 { save(finished(t)) }
    }

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
        for (id, r) in revs["reminders"] ?? [:] { if let i = db.reminders.firstIndex(where: { $0.id == id }) { db.reminders[i].rev = r } }
        for (id, r) in revs["ringtones"] ?? [:] { if let i = db.ringtones.firstIndex(where: { $0.id == id }) { db.ringtones[i].rev = r } }
        for (id, r) in revs["prefs"] ?? [:] { if let i = db.prefs.firstIndex(where: { $0.id == id }) { db.prefs[i].rev = r } }
        for (id, r) in revs["marks"] ?? [:] { if let i = db.marks.firstIndex(where: { $0.id == id }) { db.marks[i].rev = r } }
        for (id, r) in revs["folders"] ?? [:] { if let i = db.folders.firstIndex(where: { $0.id == id }) { db.folders[i].rev = r } }
        for (id, r) in revs["files"] ?? [:] { if let i = db.files.firstIndex(where: { $0.id == id }) { db.files[i].rev = r } }
    }

    private var syncing = false
    private var again = false
    // One sync at a time, outside any cancellable task; edits made during it
    // run one more.
    func syncSoon() async {
        if syncing { again = true; return }
        syncing = true
        await Task.detached { @MainActor in await self.sync() }.value
        syncing = false
        if again { again = false; await syncSoon() }
    }

    func sync() async {
        sweepTimers()
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { syncState = "signed_out"; return }
        do {
            var dirty = DB()
            dirty.courses = db.courses.filter { $0.dirty == 1 }
            dirty.events = db.events.filter { $0.dirty == 1 }
            dirty.notes = db.notes.filter { $0.dirty == 1 }
            dirty.alarms = db.alarms.filter { $0.dirty == 1 }
            dirty.clocks = db.clocks.filter { $0.dirty == 1 }
            dirty.timers = db.timers.filter { $0.dirty == 1 }
            dirty.reminders = db.reminders.filter { $0.dirty == 1 }
            dirty.ringtones = db.ringtones.filter { $0.dirty == 1 }
            dirty.prefs = db.prefs.filter { $0.dirty == 1 }
            dirty.marks = db.marks.filter { $0.dirty == 1 }
            dirty.folders = db.folders.filter { $0.dirty == 1 }
            dirty.files = db.files.filter { $0.dirty == 1 }
            let pushed = dirty
            if !(dirty.courses.isEmpty && dirty.events.isEmpty && dirty.notes.isEmpty && dirty.alarms.isEmpty && dirty.clocks.isEmpty && dirty.timers.isEmpty && dirty.reminders.isEmpty && dirty.ringtones.isEmpty && dirty.prefs.isEmpty && dirty.marks.isEmpty && dirty.folders.isEmpty && dirty.files.isEmpty) {
                var req = request(base.appendingPathComponent("api/sync"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONEncoder().encode(["changes": dirty])
                let (pd, pr) = try await URLSession.shared.data(for: req)
                try check((pd, pr))
                // Record the rev each pushed row got: the base for the next edit.
                // Only rows the server took are clean: a table an older server
                // does not know yet stays queued.
                let revs = (try? JSONDecoder().decode(PushResult.self, from: pd))?.revs ?? [:]
                clean(pushed, revs)
                applyRevs(revs)
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

    // --- ring contract endpoints ---

    enum RingStateResponse {
        case stopped(RingSync.Stop)
        case active
        case unreachable
    }

    // 1. Fire-and-forget stop notification to the server on dismiss or snooze.
    func postRingStop(id: String, at: Int64, action: String) {
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { return }
        var req = request(base.appendingPathComponent("api/ring/stop"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "alarm_id": id,
            "at": at,
            "action": action,
            "device": RingSync.device
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        Task { _ = try? await URLSession.shared.data(for: req) }
    }

    // 2. Long-polls GET /api/ring/watch: waits up to 25s. Returns Stop if stopped, nil on timeout.
    func ringWatch(id: String, at: Int64) async throws -> RingSync.Stop? {
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { return nil }
        var comps = URLComponents(url: base.appendingPathComponent("api/ring/watch"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "alarm_id", value: id),
            URLQueryItem(name: "at", value: String(at))
        ]
        guard let url = comps.url else { return nil }
        var req = request(url)
        req.timeoutInterval = 32
        let (data, res) = try await URLSession.shared.data(for: req)
        try check((data, res))
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let stopped = obj["stopped"] as? [String: Any] else { return nil }
        return RingSync.Stop(
            at: (stopped["at"] as? NSNumber)?.int64Value ?? at,
            action: (stopped["action"] as? String) ?? "dismissed",
            device: (stopped["device"] as? String) ?? "another device",
            ts: (stopped["ts"] as? NSNumber)?.int64Value
        )
    }

    // 3. Checks GET /api/ring/state before scheduling a snooze (2s timeout).
    func ringState(id: String, at: Int64) async -> RingStateResponse {
        guard !server.isEmpty, !token.isEmpty, let base = URL(string: server) else { return .unreachable }
        var comps = URLComponents(url: base.appendingPathComponent("api/ring/state"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "alarm_id", value: id),
            URLQueryItem(name: "at", value: String(at))
        ]
        guard let url = comps.url else { return .unreachable }
        var req = request(url)
        req.timeoutInterval = 2
        do {
            let (data, res) = try await URLSession.shared.data(for: req)
            try check((data, res))
            guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .unreachable }
            if let stopped = obj["stopped"] as? [String: Any] {
                let s = RingSync.Stop(
                    at: (stopped["at"] as? NSNumber)?.int64Value ?? at,
                    action: (stopped["action"] as? String) ?? "dismissed",
                    device: (stopped["device"] as? String) ?? "another device",
                    ts: (stopped["ts"] as? NSNumber)?.int64Value
                )
                return .stopped(s)
            }
            return .active
        } catch {
            return .unreachable
        }
    }

    private func request(_ url: URL) -> URLRequest {
        var r = URLRequest(url: url, timeoutInterval: 15)
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        // Which phone a change came from (the Drive's version log shows it).
        r.setValue(UIDevice.current.name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "iPhone", forHTTPHeaderField: "x-hourglass-device")
        r.setValue(Dates.zone.identifier, forHTTPHeaderField: "x-timezone")
        return r
    }

    private func check(_ r: (Data, URLResponse)) throws {
        // The server says 401 only when the account server turned the session
        // down (a password change or reset ends every session), so it is gone
        // for good: show the sign-in screen instead of failing quietly forever.
        if (r.1 as? HTTPURLResponse)?.statusCode == 401, signedIn { endSession() }
        if let h = r.1 as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            let msg = ((try? JSONSerialization.jsonObject(with: r.0)) as? [String: Any])?["error"] as? String
            throw NSError(domain: "hourglass", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: msg ?? "HTTP \(h.statusCode)"])
        }
    }

    // Clear dirty flags only on rows unchanged since they were pushed.
    private func clean(_ p: DB, _ revs: [String: [String: Int64]]) {
        func c<T: Identifiable & Codable>(_ table: String, _ rows: inout [T], _ sent: [T], _ upd: (T) -> Int64, _ set: (inout T) -> Void) where T.ID == String {
            for s in sent where revs[table]?[s.id] != nil { if let i = rows.firstIndex(where: { $0.id == s.id }), upd(rows[i]) == upd(s) { set(&rows[i]) } }
        }
        c("courses", &db.courses, p.courses, { $0.updated_at }, { $0.dirty = 0 })
        c("events", &db.events, p.events, { $0.updated_at }, { $0.dirty = 0 })
        c("notes", &db.notes, p.notes, { $0.updated_at }, { $0.dirty = 0 })
        c("alarms", &db.alarms, p.alarms, { $0.updated_at }, { $0.dirty = 0 })
        c("clocks", &db.clocks, p.clocks, { $0.updated_at }, { $0.dirty = 0 })
        c("timers", &db.timers, p.timers, { $0.updated_at }, { $0.dirty = 0 })
        c("reminders", &db.reminders, p.reminders, { $0.updated_at }, { $0.dirty = 0 })
        c("ringtones", &db.ringtones, p.ringtones, { $0.updated_at }, { $0.dirty = 0 })
        c("prefs", &db.prefs, p.prefs, { $0.updated_at }, { $0.dirty = 0 })
        c("marks", &db.marks, p.marks, { $0.updated_at }, { $0.dirty = 0 })
        c("folders", &db.folders, p.folders, { $0.updated_at }, { $0.dirty = 0 })
        c("files", &db.files, p.files, { $0.updated_at }, { $0.dirty = 0 })
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
        m(&db.reminders, ch.reminders, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.ringtones, ch.ringtones, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.prefs, ch.prefs, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.note_versions, ch.note_versions, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.marks, ch.marks, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.folders, ch.folders, { $0.updated_at }, { $0.dirty = 0 })
        m(&db.files, ch.files, { $0.updated_at }, { $0.dirty = 0 })
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
                fires.append(("alarm-\(a.id)-\(k)", at, "Alarm", Alarms.displayLabel(a, store.db.courses, store.db.events)))
                from = at
            }
        }
        // Reminders: a notification with Done and Snooze, and their own short tone (or none).
        var reminderOf: [String: String] = [:]
        for r in store.db.reminders where r.deleted == 0 {
            for (k, at) in Reminders.upcoming(r, now).enumerated() where at < now + 8 * 86_400_000 {
                let id = "reminder-\(r.id)-\(k)"
                reminderOf[id] = r.id
                fires.append((id, at, r.label, "Reminder · " + Dates.clock(at)))
            }
        }
        let silent = store.reminderStyle == "silent"
        let tone = UNNotificationSound(named: UNNotificationSoundName("remind_\(store.reminderTone).wav"))
        for (id, at, title, body) in fires.sorted(by: { $0.1 < $1.1 }).prefix(60) {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            if let rid = reminderOf[id] {
                content.categoryIdentifier = ReminderActions.category
                content.userInfo = ["reminder": rid]
                content.sound = silent ? nil : tone
                content.interruptionLevel = .active
            } else {
                content.sound = UNNotificationSound(named: UNNotificationSoundName(Ringtones.file))
                content.interruptionLevel = .timeSensitive
            }
            let date = Date(timeIntervalSince1970: Double(at) / 1000)
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
        }
        AlarmKitScheduler.reschedule(store)
    }
}

// The server's table, so a picture is stored as one.
func mimeOf(_ name: String) -> String {
    let ext = (name as NSString).pathExtension.lowercased()
    let m: [String: String] = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "heic": "image/heic", "gif": "image/gif", "webp": "image/webp",
        "svg": "image/svg+xml", "bmp": "image/bmp", "pdf": "application/pdf", "txt": "text/plain", "md": "text/markdown", "mp3": "audio/mpeg",
        "m4a": "audio/mp4", "wav": "audio/wav", "mp4": "video/mp4", "mov": "video/quicktime", "zip": "application/zip", "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    return m[ext] ?? "application/octet-stream"
}

func fmtBytes(_ n: Int64) -> String {
    if n < 1024 { return "\(n) B" }
    if n < 1_048_576 { return String(format: "%.0f KB", Double(n) / 1024) }
    if n < 1_073_741_824 { return String(format: "%.1f MB", Double(n) / 1_048_576) }
    return String(format: "%.1f GB", Double(n) / 1_073_741_824)
}
