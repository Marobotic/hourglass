import SwiftUI
import AVFoundation
import UserNotifications

// Reminders: "call mom at 6". Not alarms: at its time one shows a
// notification (Done, Snooze) with its own short tone, or none; then it waits
// as overdue until ticked, like a to-do. Settings has their own section.
struct RemindersView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @State private var showDone = false

    var body: some View {
        Ticking { clock in
            let all = store.reminders(clock)
            let open = all.filter { !$0.1.done }
            let done = Array(all.filter { $0.1.done }.prefix(20))
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if open.isEmpty { T("No reminders. Tap the bell to add one, or ask the assistant: \"remind me to call mom at 6\".", 13, H.muted) }
                        ForEach(open, id: \.0.id) { item in row(item.0, item.1, clock) }
                        if !done.isEmpty {
                            HStack {
                                SectionLabel(text: "Done", detail: "\(done.count)")
                                HButton(showDone ? "Hide" : "Show") { showDone.toggle() }
                            }
                            .padding(.top, 6)
                            if showDone { ForEach(done, id: \.0.id) { item in row(item.0, item.1, clock) } }
                        }
                        HStack {
                            T(store.reminderStyle == "silent" ? "Notification only · snooze \(store.reminderSnooze) min" : "Notification + \(store.reminderTone.capitalized) tone · snooze \(store.reminderSnooze) min", 12, H.faint)
                            Spacer()
                            HButton("Settings") { sheets.settings = true }
                        }
                        Spacer(minLength: 72)
                    }
                    .padding(.horizontal, 18).padding(.vertical, 12)
                }
                Fab(icon: "bell.badge") { sheets.reminder = ReminderDraft(reminder: nil) }
            }
            .background(H.bg)
        }
    }

    private func row(_ r: Reminder, _ s: ReminderState, _ clock: Int64) -> some View {
        Card(stripe: s.overdue ? H.accent : nil) {
            HStack(spacing: 12) {
                Button { store.reminderDone(r.id, !s.done) } label: {
                    Image(systemName: s.done ? "checkmark.circle.fill" : "circle").font(.system(size: 24)).foregroundStyle(s.done ? H.teal : H.muted)
                }
                VStack(alignment: .leading, spacing: 2) {
                    T(r.label, 15, bold: !s.done, lines: 2)
                    T(whenText(r, s, clock), 11, s.overdue ? H.accent : H.muted, lines: 1)
                }
                Spacer()
                if s.overdue { Button { store.snoozeReminder(r.id) } label: { Image(systemName: "zzz").foregroundStyle(H.muted) } }
                Button { store.removeReminder(r.id) } label: { Image(systemName: "trash").foregroundStyle(H.faint) }
            }
            .contentShape(Rectangle())
            .onTapGesture { sheets.reminder = ReminderDraft(reminder: r) }
        }
        .opacity(s.done ? 0.55 : 1)
    }

    private func whenText(_ r: Reminder, _ s: ReminderState, _ clock: Int64) -> String {
        let repeatText: String? = r.days.isEmpty ? nil : r.days.count == 7 ? "Every day" : r.days == [1, 2, 3, 4, 5] ? "Weekdays" : r.days == [6, 7] ? "Weekends" : r.days.map { Dates.weekdays[$0 - 1] }.joined(separator: ", ")
        if s.done { return "Done · " + Dates.t(r.time) }
        var parts: [String] = []
        if let at = s.dueAt ?? s.occurrence {
            let d = Dates.dayOf(at), today = Dates.dayOf(clock)
            let day = d == today ? "today" : d == Dates.add(today, 1) ? "tomorrow" : d == Dates.add(today, -1) ? "yesterday" : Dates.short(d)
            parts.append(Dates.clock(at) + " " + day)
        } else { parts.append(Dates.t(r.time)) }
        if let repeatText { parts.append(repeatText) }
        if (r.snooze_at ?? 0) > clock { parts.append("snoozed") } else if s.overdue { parts.append("overdue") }
        return parts.joined(separator: " · ")
    }
}

struct ReminderDraft: Identifiable { let id = UUID(); var reminder: Reminder? }

struct ReminderSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let draft: ReminderDraft
    @State private var label = ""
    @State private var time = "18:00"
    @State private var repeats = false
    @State private var days = [1, 2, 3, 4, 5]
    @State private var date: String?

    var body: some View {
        SheetFrame(title: draft.reminder == nil ? "New reminder" : "Reminder") {
            Field(label: "Remind me to", text: $label)
            TimeField(label: "Time", value: $time)
            Segmented(options: [("Once", false), ("Repeats", true)], value: $repeats)
            if repeats {
                DayToggles(days: $days)
                T("Shows on the highlighted days; tick it done each time.", 12, H.faint)
            } else {
                DateField(label: "Day", value: $date, clearable: true)
                T(date == nil ? "Today, or tomorrow if that time has passed." : "Shows once, then waits until you tick it done.", 12, H.faint)
            }
            HButton(draft.reminder == nil ? "Add reminder" : "Save", icon: "bell.badge", primary: true, enabled: !label.trimmingCharacters(in: .whitespaces).isEmpty && (!repeats || !days.isEmpty)) {
                store.setReminder(draft.reminder, label: label, time: time, date: repeats ? nil : date, days: repeats ? days : [])
                dismiss()
            }
            if let r = draft.reminder { HButton("Delete", danger: true) { store.removeReminder(r.id); dismiss() } }
        }
        .onAppear {
            if let r = draft.reminder {
                label = r.label; time = r.time; repeats = !r.days.isEmpty; days = r.days.isEmpty ? [1, 2, 3, 4, 5] : r.days; date = r.date
            } else {
                let h = Calendar.current.component(.hour, from: Date().addingTimeInterval(3600))
                time = String(format: "%02d:00", h)
            }
        }
    }
}

// Reminder settings, inside Settings: their own, not the alarms'.
struct ReminderSettings: View {
    @EnvironmentObject var store: Store
    @State private var player: AVAudioPlayerBox = AVAudioPlayerBox()

    var body: some View {
        SectionLabel(text: "Reminders")
        T("Not alarms: a notification with Done and Snooze when one is due. Same on all your devices.", 12, H.faint)
        T("ALERT", 11, H.muted)
        Segmented(options: [("With a tone", "tone"), ("Notification only", "silent")], value: Binding(get: { store.reminderStyle }, set: { store.setPref("reminder_style", $0) }))
        if store.reminderStyle == "tone" {
            T("TONE", 11, H.muted)
            Segmented(options: Reminders.tones.map { ($0.capitalized, $0) }, value: Binding(get: { store.reminderTone }, set: { store.setPref("reminder_tone", $0); player.play("remind_\($0)") }))
        }
        T("SNOOZE", 11, H.muted)
        Segmented(options: [("5 min", 5), ("10 min", 10), ("15 min", 15), ("30 min", 30), ("1 hour", 60)], value: Binding(get: { store.reminderSnooze }, set: { store.setPref("reminder_snooze", String($0)) }))
    }
}

// Hears a reminder tone once.
final class AVAudioPlayerBox {
    private var player: AVAudioPlayer?
    func play(_ name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "wav") else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        player = try? AVAudioPlayer(contentsOf: url)
        player?.play()
    }
}

// Done and Snooze on a reminder's notification, and banners while the app is open.
final class ReminderActions: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderActions()
    static let category = "REMINDER"

    static func register() {
        let done = UNNotificationAction(identifier: "DONE", title: "Done", options: [])
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "Snooze", options: [])
        UNUserNotificationCenter.current().setNotificationCategories([UNNotificationCategory(identifier: category, actions: [done, snooze], intentIdentifiers: [], options: [])])
        UNUserNotificationCenter.current().delegate = shared
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["reminder"] as? String else { return }
        let action = response.actionIdentifier
        guard action == "DONE" || action == "SNOOZE" else { return }
        await Task { @MainActor in
            if action == "DONE" { Store.shared.reminderDone(id) } else { Store.shared.snoozeReminder(id) }
            // Tell the other devices before iOS suspends the app again.
            await Store.shared.syncSoon()
        }.value
    }
}
