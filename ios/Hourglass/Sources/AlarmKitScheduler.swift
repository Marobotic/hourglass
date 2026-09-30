import Foundation
import SwiftUI
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

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    struct Meta: AlarmMetadata {}

    @available(iOS 26.0, *)
    private static func schedule(at ms: Int64, label: String) async {
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: label),
            stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.fill")
        )
        let attributes = AlarmAttributes<Meta>(presentation: AlarmPresentation(alert: alert), tintColor: Color(red: 0.69, green: 0.26, blue: 0.26))
        let config = AlarmManager.AlarmConfiguration<Meta>.alarm(
            schedule: .fixed(Date(timeIntervalSince1970: Double(ms) / 1000)),
            attributes: attributes
        )
        _ = try? await AlarmManager.shared.schedule(id: UUID(), configuration: config)
    }
    #endif
}
