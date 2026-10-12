import Foundation
import SwiftUI
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
#endif

// On iOS 26, alarms and timers ring through AlarmKit: full-screen, through
// silent mode, with the app closed, like the Clock app. Older iOS falls back
// to the notifications Notifications.reschedule schedules.
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

    @MainActor
    static func reschedule(_ store: Store) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard AlarmManager.shared.authorizationState == .authorized else { return }
            let now = nowMs()
            var fires: [(Int64, String)] = []
            for t in store.timers where t.state == "running" {
                if let at = t.ends_at, at > now { fires.append((at, t.label)) }
            }
            for a in store.alarms {
                var from = now
                for _ in 0..<7 {
                    guard let at = Alarms.next(a, store.db.courses, store.db.events, from), at < now + 8 * 86_400_000 else { break }
                    fires.append((at, a.label))
                    from = at
                }
            }
            let upcoming = fires.sorted { $0.0 < $1.0 }.prefix(30)
            Task {
                for old in (try? AlarmManager.shared.alarms) ?? [] { try? AlarmManager.shared.cancel(id: old.id) }
                for (at, label) in upcoming { await schedule(at: at, label: label) }
            }
        }
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
            Task { await schedule(at: at, label: "Test alarm", sound: tone) }
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
    private static func schedule(at ms: Int64, label: String, sound: String = Ringtones.file) async {
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: label),
            stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill")
        )
        let attributes = AlarmAttributes<Meta>(presentation: AlarmPresentation(alert: alert), tintColor: Color(red: 0.69, green: 0.26, blue: 0.26))
        let config = AlarmManager.AlarmConfiguration<Meta>.alarm(
            schedule: .fixed(Date(timeIntervalSince1970: Double(ms) / 1000)),
            attributes: attributes,
            sound: .named(sound)
        )
        _ = try? await AlarmManager.shared.schedule(id: UUID(), configuration: config)
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
