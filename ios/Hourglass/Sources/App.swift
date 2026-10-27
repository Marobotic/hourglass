import SwiftUI
import BackgroundTasks

@main
struct HourglassApp: App {
    @StateObject private var store = Store.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group { if store.signedIn { RootView() } else { LoginView() } }
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear { ReminderActions.register(); Notifications.requestPermission(); AlarmKitScheduler.requestPermission(); Notifications.reschedule(store) }
                .task { while !Task.isCancelled { await store.syncSoon(); try? await Task.sleep(nanoseconds: 30_000_000_000) } }
                // While an alarm rings with the app open, hold GET /api/ring/watch for instant stop,
                // and sync every 5 seconds as a fallback.
                .task {
                    while !Task.isCancelled {
                        if AlarmKitScheduler.ringing {
                            async let watch: () = AlarmKitScheduler.watchAlerting(store)
                            async let syncFallback: () = {
                                while AlarmKitScheduler.ringing && !Task.isCancelled {
                                    await store.syncSoon()
                                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                                }
                            }()
                            _ = await (watch, syncFallback)
                        }
                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                    }
                }
        }
        .onChange(of: phase) { _, p in
            if p == .active { Task { await store.syncSoon() } }
            if p == .background { BackgroundSync.schedule() }
        }
        .backgroundTask(.appRefresh(BackgroundSync.id)) {
            BackgroundSync.schedule()
            await store.syncSoon() // the sync reschedules alarms and notifications
        }
    }
}

// iOS wakes Hourglass in the background now and then (it decides how often;
// at most every 15 minutes is asked for) to sync, so an alarm set on another
// device is scheduled on this iPhone without opening the app here.
enum BackgroundSync {
    static let id = "dev.marobotic.hourglass.sync"

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: id)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

enum Route: Hashable { case note(String), course(String), assistant }

// Sheets any screen can open.
final class Sheets: ObservableObject {
    @Published var event: EventDraft?
    @Published var course: CourseDraft?
    @Published var session: Occ?
    @Published var alarm = false
    @Published var reminder: ReminderDraft?
    @Published var settings = false
}

struct EventDraft: Identifiable { let id = UUID(); var event: Event?; var date: String?; var course: String?; var weekly = false }
struct CourseDraft: Identifiable { let id = UUID(); var course: Course? }

struct RootView: View {
    // Five: more did not fit a phone. Related pages share a tab and a
    // switcher at its top.
    static let tabs = [("Now", "clock"), ("Schedule", "calendar"), ("Notes", "note.text"), ("Drive", "folder"), ("Time", "alarm")]
    @EnvironmentObject var store: Store
    @StateObject private var sheets = Sheets()
    @State private var path: [Route] = []
    @State private var tab = 0
    @State private var scheduleSub = 0
    @State private var timeSub = 0
    @StateObject private var update = UpdateCheck()

    var body: some View {
        NavigationStack(path: $path) {
            // Six tabs: a square bar of our own (the system one folds the
            // sixth into "More").
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    PixelLogo(cell: 2.6, alive: true)
                    T("Hourglass", 18, bold: true)
                    Spacer()
                    Button { path.append(.assistant) } label: {
                        Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 18)).foregroundStyle(H.muted).frame(width: 44, height: 44)
                    }
                    Button { sheets.settings = true } label: {
                        Image(systemName: "gearshape").font(.system(size: 19)).foregroundStyle(H.muted).frame(width: 44, height: 44)
                    }
                }
                .padding(.leading, 18).padding(.trailing, 8).padding(.top, 4)
                // A newer build is on marobotic.dev: SideStore installs it.
                if let v = update.version {
                    Button { update.open() } label: {
                        HStack(spacing: 0) {
                            T("Hourglass \(v) is ready. Update it in SideStore  →", 13)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(H.teal.opacity(0.18))
                    }
                    .buttonStyle(.plain)
                }
                // Wake check: rings again in 5 minutes unless "I'm up".
                Ticking { _ in
                    if let w = WakeCheck.pending, w.at > nowMs() {
                        HStack(spacing: 10) {
                            T("Wake check: \(w.label) rings again at \(Dates.clock(w.at))", 13, lines: 2)
                            Spacer(minLength: 0)
                            HButton("I'm up", primary: true) { WakeCheck.imUp() }
                        }
                        .padding(.horizontal, 18).padding(.vertical, 8)
                        .background(H.accent.opacity(0.18))
                    }
                }
                Group {
                    switch tab {
                    case 0: NowView(path: $path)
                    case 1:
                        VStack(spacing: 0) {
                            SubTabs(items: ["Week", "Attendance"], selected: $scheduleSub)
                            if scheduleSub == 0 { ScheduleView() } else { AttendanceView() }
                        }
                    case 2: NotesView(path: $path)
                    case 3: DriveView()
                    default:
                        VStack(spacing: 0) {
                            SubTabs(items: ["Alarms", "Reminders", "Timers", "Clock"], selected: $timeSub)
                            switch timeSub {
                            case 0: TimeView()
                            case 1: RemindersView()
                            case 2: TimersView()
                            default: ClockView()
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // The tab you go to rises in.
                .id(tab)
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 14)), removal: .opacity))
                .animation(.easeOut(duration: 0.3), value: tab)
                HStack(spacing: 0) {
                    ForEach(Array(RootView.tabs.enumerated()), id: \.offset) { i, t in
                        let on = tab == i
                        Button { tab = i } label: {
                            VStack(spacing: 4) {
                                Rectangle().fill(on ? H.accent : .clear).frame(width: 28, height: 2)
                                Image(systemName: t.1).font(.system(size: 18)).foregroundStyle(on ? H.fg : H.muted).frame(height: 22)
                                Text(t.0).font(H.mono(10, bold: on)).foregroundStyle(on ? H.fg : H.muted).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity).padding(.bottom, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(H.surface.ignoresSafeArea(edges: .bottom))
            }
            .task { await update.check() }
            // Our own header: iOS 26 wraps toolbar items in round glass
            // bubbles, which clipped the name.
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .note(let id): NoteView(id: id)
                case .course(let id): NotesView(path: $path, sel: id)
                case .assistant: AssistantView()
                }
            }
            .background(H.bg)
        }
        // Above the tab bar (or the bottom of a page): the upload panel.
        .overlay(alignment: .bottom) { UploadPanel().padding(.bottom, path.isEmpty ? 58 : 4) }
        .overlay { BurstLayer() }
        .environmentObject(sheets)
        .sheet(item: $sheets.event) { d in EventSheet(draft: d).environmentObject(store) }
        .sheet(item: $sheets.course) { d in CourseSheet(draft: d, path: $path).environmentObject(store) }
        .sheet(item: $sheets.session) { o in SessionSheet(occ: o, path: $path).environmentObject(store).environmentObject(sheets) }
        .sheet(isPresented: $sheets.alarm) { AlarmSheet().environmentObject(store) }
        .sheet(item: $sheets.reminder) { d in ReminderSheet(draft: d).environmentObject(store) }
        .sheet(isPresented: $sheets.settings) { SettingsSheet().environmentObject(store) }
    }
}

// A ticking clock for live countdowns.
struct Ticking<Content: View>: View {
    @ViewBuilder var content: (Int64) -> Content
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in content(Int64(ctx.date.timeIntervalSince1970 * 1000)) }
    }
}

// The pages of a grouped tab, as an underlined row like the tab bar's.
struct SubTabs: View {
    let items: [String]
    @Binding var selected: Int
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, label in
                let on = i == selected
                Button { selected = i } label: {
                    VStack(spacing: 8) {
                        T(label, 13, on ? H.fg : H.muted, bold: on, lines: 1)
                        Rectangle().fill(on ? H.accent : H.border).frame(height: 2)
                    }
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
    }
}
