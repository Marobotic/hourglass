import Foundation
import SwiftUI
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
#endif

// On iOS 26, alarms and timers ring through AlarmKit: full-screen, through
// silent mode, with the app closed, like the Clock app. Older iOS falls back
// to the notifications Notifications.reschedule schedules.
// The ring screen has Stop and Snooze; both run Hourglass (RingStopIntent,
// RingSnoozeIntent), which logs the press and tells the other devices.
enum AlarmKitScheduler {
    static var active: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return AlarmManager.shared.authorizationState == .authorized }
        #endif
        return false
    }

    static func requestPermission() {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            Task { _ = try? await AlarmManager.shared.requestAuthorization() }
        }
        #endif
    }

    // Something is ringing on this iPhone right now.
    static var ringing: Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return ((try? AlarmManager.shared.alarms) ?? []).contains { $0.state == .alerting } }
        #endif
        return false
    }

    // What should ring on this iPhone in the next 8 days (30 at most).
    @MainActor
    static func upcoming(_ store: Store) -> [RingInfo] {
        let now = nowMs()
        var fires: [RingInfo] = []
        let wakeLabels = RingLog.wakeLabels
        for t in store.timers where t.state == "running" {
            if let at = t.ends_at, at > now {
                let wake = t.label.hasSuffix(RingLog.snoozed) && wakeLabels.contains(RingLog.base(t.label))
                fires.append(RingInfo(id: t.id, kind: "timer", at: at, label: t.label, wake: wake))
            }
        }
        for a in store.alarms {
            let wake = a.lead_event_id != nil || a.lead_course_id != nil || a.label.localizedCaseInsensitiveContains("wake")
            var from = now
            for _ in 0..<7 {
                guard let at = Alarms.next(a, store.db.courses, store.db.events, from), at < now + 8 * 86_400_000 else { break }
                fires.append(RingInfo(id: a.id, kind: "alarm", at: at, label: a.label, wake: wake))
                from = at
            }
        }
        // Already dismissed or snoozed on another device: not rung here.
        return Array(fires.filter { RingSync.stoppedElsewhere(store, $0.id, $0.at) == nil }.sorted { $0.at < $1.at }.prefix(30))
    }

    // Brings AlarmKit in line with the store, changing only what changed: an
    // alarm already scheduled keeps its id, and one that is ringing is never
    // cancelled by a sync (it used to be: everything was cancelled and redone).
    @MainActor
    static func reschedule(_ store: Store) {
        settle(store)
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard AlarmManager.shared.authorizationState == .authorized else { return }
            let want = upcoming(store)
            let wantIds = Set(want.map(\.uuid))
            let wake = WakeCheck.pending.map { RingInfo(id: "wake-check", kind: "alarm", at: $0.at, label: RingLog.wakePrefix + $0.label).uuid }
            let have = (try? AlarmManager.shared.alarms) ?? []
            let haveIds = Set(have.map(\.id))
            var pending = RingLog.pending
            for r in want { pending[r.uuid.uuidString] = r }
            RingLog.pending = pending
            Task {
                for old in have where !wantIds.contains(old.id) && old.id != wake {
                    if old.state == .alerting {
                        // Ringing now: stop it only if another device answered it.
                        if let r = RingLog.pending[old.id.uuidString], let s = await RingSync.stoppedElsewhere(store, r.id, r.at) {
                            try? AlarmManager.shared.stop(id: old.id)
                            await MainActor.run { RingLog.answered(r); RingLog.add(r.label, s.action == "snoozed" ? "snoozed" : "dismissed", "on \(s.device)") }
                        }
                        continue
                    }
                    try? AlarmManager.shared.cancel(id: old.id)
                }
                for r in want where !haveIds.contains(r.uuid) { await schedule(r) }
            }
        }
        #endif
    }

    // Past rings nobody answered on this iPhone: say how they ended.
    @MainActor
    private static func settle(_ store: Store) {
        let now = nowMs()
        var pending = RingLog.pending
        for (k, r) in pending where r.at < now - 2 * 60_000 {
            pending[k] = nil
            if let s = RingSync.stoppedElsewhere(store, r.id, r.at) {
                RingLog.add(r.label, s.action == "snoozed" ? "snoozed" : "dismissed", "on \(s.device)")
            } else if r.at > now - 2 * 86_400_000 {
                RingLog.add(r.label, "no answer", "rang at \(Dates.clock(r.at)) and nobody pressed Stop or Snooze on this iPhone")
            }
        }
        RingLog.pending = pending
    }

    @MainActor
    static func scheduleOne(_ r: RingInfo) async {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), AlarmManager.shared.authorizationState == .authorized { await schedule(r) }
        #endif
    }

    static func stop(_ id: UUID) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { try? AlarmManager.shared.stop(id: id) }
        #endif
    }

    static func cancel(_ id: UUID) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { try? AlarmManager.shared.cancel(id: id) }
        #endif
    }

    // Settings > Test alarm: a real alarm in 5 seconds through the same path as
    // any alarm (AlarmKit's full-screen ring, or the notification on older
    // iOS), with the ringtone even when the alarm sound is off.
    static func test() {
        let at = nowMs() + 5_000
        let tone = UserDefaults.standard.object(forKey: "sound") as? Bool == false ? Ringtones.toneFile : Ringtones.file
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), AlarmManager.shared.authorizationState == .authorized {
            Task { await schedule(RingInfo(id: "test", kind: "alarm", at: at, label: "Test alarm"), sound: tone) }
            return
        }
        #endif
        let content = UNMutableNotificationContent()
        content.title = "Test alarm"
        content.body = "This is how your alarms ring."
        content.sound = UNNotificationSound(named: UNNotificationSoundName(tone))
        content.interruptionLevel = .timeSensitive
        let req = UNNotificationRequest(identifier: "hourglass-test-\(at)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false))
        UNUserNotificationCenter.current().add(req)
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    struct Meta: AlarmMetadata {}

    @available(iOS 26.0, *)
    private static func schedule(_ r: RingInfo, sound: String = Ringtones.file) async {
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: r.label),
            stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill"),
            secondaryButton: AlarmButton(text: "Snooze 5 min", textColor: .white, systemImageName: "zzz"),
            secondaryButtonBehavior: .custom
        )
        let attributes = AlarmAttributes<Meta>(presentation: AlarmPresentation(alert: alert), tintColor: Color(red: 0.69, green: 0.26, blue: 0.26))
        let config = AlarmManager.AlarmConfiguration<Meta>.alarm(
            schedule: .fixed(Date(timeIntervalSince1970: Double(r.at) / 1000)),
            attributes: attributes,
            stopIntent: RingStopIntent(r),
            secondaryIntent: RingSnoozeIntent(r),
            sound: .named(sound)
        )
        do { _ = try await AlarmManager.shared.schedule(id: r.uuid, configuration: config) }
        catch { RingLog.add(r.label, "broke", "iOS would not schedule this alarm: \(error.localizedDescription)") }
    }
    #endif
}

// Ringtones ship in Resources/Sounds (ring_<name>.wav). Sound off uses a
// silent file, so the alarm still shows but makes no noise.
enum Ringtones {
    static let all = ["classic", "klaxon", "siren", "digital", "rising", "bell"]
    static var current = "classic" // set by Store from the synced pref
    static var dir: URL { FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Sounds") }
    static func fileName(_ id: String) -> String { "hg_\(id).wav" }
    static func url(_ id: String) -> URL { dir.appendingPathComponent(fileName(id)) }
    static var file: String {
        if UserDefaults.standard.object(forKey: "sound") as? Bool == false { return "ring_silent.wav" }
        return toneFile
    }
    // The chosen ringtone's file, whatever the sound setting.
    static var toneFile: String {
        if all.contains(current) { return "ring_\(current).wav" }
        return FileManager.default.fileExists(atPath: url(current).path) ? fileName(current) : "ring_classic.wav"
    }
    // Where a ringtone's audio is, for previews.
    static func playable(_ id: String) -> URL? {
        if all.contains(id) { return Bundle.main.url(forResource: "ring_\(id)", withExtension: "wav") }
        return FileManager.default.fileExists(atPath: url(id).path) ? url(id) : nil
    }
}

// What AlarmKit has, shown in Settings so it can be checked on the phone.
extension AlarmKitScheduler {
    @MainActor
    static func status() -> String {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            switch AlarmManager.shared.authorizationState {
            case .authorized:
                let n = ((try? AlarmManager.shared.alarms) ?? []).count
                return "Alarms allowed · \(n) scheduled on this iPhone"
            case .denied: return "Alarms are off for Hourglass: allow them in Settings > Hourglass"
            default: return "Alarms not allowed yet"
            }
        }
        #endif
        return "Using notifications (AlarmKit needs iOS 26)"
    }
}
