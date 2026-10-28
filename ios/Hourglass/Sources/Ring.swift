import Foundation
import AppIntents
import CryptoKit
#if canImport(AlarmKit)
import AlarmKit
#endif

// One ring of one alarm or timer: what the Stop and Snooze buttons need.
// id: the alarm or timer row; at: the occurrence (ms), the same on every device.
struct RingInfo: Codable, Hashable {
    var id: String
    var kind: String // "alarm" | "timer"
    var at: Int64
    var label: String

    // The AlarmKit id: from the ring, so rescheduling keeps it.
    var uuid: UUID { nameUUID("ring:\(id):\(at)") }
    var json: String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8) ?? "") ?? "" }
    static func from(_ s: String) -> RingInfo? { s.data(using: .utf8).flatMap { try? JSONDecoder().decode(RingInfo.self, from: $0) } }
}

// A name-based UUID (version 3), the same as Java's UUID.nameUUIDFromBytes and
// the desktop's, so every device derives the same id from the same text.
func nameUUID(_ s: String) -> UUID {
    var b = Array(Insecure.MD5.hash(data: Data(s.utf8)))
    b[6] = (b[6] & 0x0f) | 0x30
    b[8] = (b[8] & 0x3f) | 0x80
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
}

// What every alarm did on this iPhone, so a missed alarm shows whether it rang
// and how it ended. Same lines as the phone's and desktop's history.
enum RingLog {
    static let snoozed = " (snoozed)"
    static func base(_ label: String) -> String {
        var l = label
        while l.hasSuffix(snoozed) { l.removeLast(snoozed.count) }
        return l
    }

    struct Entry: Codable, Identifiable {
        var at: Int64
        var label: String
        var event: String
        var detail: String
        var id: String { "\(at)\(event)\(label)" }
        var broke: Bool { event == "broke" || event == "no sound" }
    }

    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ring-log.jsonl")
    }

    static func add(_ label: String, _ event: String, _ detail: String = "") {
        let e = Entry(at: nowMs(), label: label, event: event, detail: detail)
        guard let line = try? String(data: JSONEncoder().encode(e), encoding: .utf8) else { return }
        let old = ((try? String(contentsOf: file, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
        try? ((old.suffix(299) + [line]).joined(separator: "\n") + "\n").write(to: file, atomically: true, encoding: .utf8)
    }

    static func read() -> [Entry] {
        ((try? String(contentsOf: file, encoding: .utf8)) ?? "").split(separator: "\n")
            .compactMap { try? JSONDecoder().decode(Entry.self, from: Data($0.utf8)) }.reversed()
    }

    // Rings scheduled on this iPhone and not yet answered here, by AlarmKit id.
    // Once they are past, the next run says how they ended.
    private static let pendingKey = "ring_pending"
    static var pending: [String: RingInfo] {
        get { (UserDefaults.standard.data(forKey: pendingKey)).flatMap { try? JSONDecoder().decode([String: RingInfo].self, from: $0) } ?? [:] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: pendingKey) }
    }
    static func answered(_ r: RingInfo) { var p = pending; p[r.uuid.uuidString] = nil; pending = p }
}

// Dismissed or snoozed on one device = stopped on all of them, through a synced
// pref row per alarm ("ring_stop:<alarm id>" = {at, action, device, ts}).
enum RingSync {
    static let device = "iPhone"
    private static func key(_ id: String) -> String { "ring_stop:\(id)" }

    struct Stop: Codable { var at: Int64; var action: String; var device: String; var ts: Int64? }

    @MainActor
    static func stoppedElsewhere(_ store: Store, _ id: String, _ at: Int64) -> Stop? {
        guard let v = store.pref(key(id)), let s = try? JSONDecoder().decode(Stop.self, from: Data(v.utf8)), s.at == at else { return nil }
        return s
    }

    @MainActor
    static func share(_ store: Store, _ r: RingInfo, _ action: String) {
        let s = Stop(at: r.at, action: action, device: device, ts: nowMs())
        store.setPref(key(r.id), String(data: (try? JSONEncoder().encode(s)) ?? Data(), encoding: .utf8) ?? "")
        store.postRingStop(id: r.id, at: r.at, action: action)
    }

    static func snoozeId(_ r: RingInfo) -> String { nameUUID("snooze:\(r.id):\(r.at)").uuidString.lowercased() }
}

// The ring screen's buttons. iOS runs them in Hourglass (opening it in the
// background if it is closed), so a press is logged and reaches other devices.
struct RingStopIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop alarm"
    static var openAppWhenRun = false
    @Parameter(title: "Ring") var ring: String
    init() {}
    init(_ r: RingInfo) { ring = r.json }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let r = RingInfo.from(ring) else { return .result() }
        let store = Store.shared
        RingLog.answered(r)
        RingLog.add(r.label, "dismissed", "Stop on the iPhone alarm, \(max(0, (nowMs() - r.at) / 1000))s after it started")
        AlarmKitScheduler.stop(r.uuid)
        // Dismissed once, gone: the dismissal is final for this occurrence.
        RingSync.share(store, r, "dismissed")
        await store.syncSoon()
        return .result()
    }
}

struct RingSnoozeIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Snooze alarm"
    static var openAppWhenRun = false
    @Parameter(title: "Ring") var ring: String
    init() {}
    init(_ r: RingInfo) { ring = r.json }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let r = RingInfo.from(ring) else { return .result() }
        let store = Store.shared
        RingLog.answered(r)
        AlarmKitScheduler.stop(r.uuid)
        // Check /api/ring/state before scheduling a snooze (2 s timeout)
        let state = await store.ringState(id: r.id, at: r.at)
        switch state {
        case .stopped(let s):
            // Dismissed anywhere: don't snooze, just stop
            RingLog.add(r.label, s.action == "snoozed" ? "snoozed" : "dismissed", "on \(s.device); snooze cancelled")
            return .result()
        case .active:
            RingLog.add(r.label, "snoozed", "Snooze on the iPhone alarm, \(max(0, (nowMs() - r.at) / 1000))s after it started; rings again in 5 min")
            RingSync.share(store, r, "snoozed")
            // One snooze timer per ring, whichever device snoozes.
            store.startTimer(seconds: 300, label: RingLog.base(r.label) + RingLog.snoozed, id: RingSync.snoozeId(r))
            await store.syncSoon()
        case .unreachable:
            // Server can't be reached: the usual snooze timer (one id per ring), which syncs once back online.
            RingLog.add(r.label, "snoozed", "offline, rings again in 5 min")
            RingSync.share(store, r, "snoozed")
            store.startTimer(seconds: 300, label: RingLog.base(r.label) + RingLog.snoozed, id: RingSync.snoozeId(r))
        }
        return .result()
    }
}
