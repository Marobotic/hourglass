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
    // Five tabs (round 5, the same as Android): Now · Schedule · Notes · Drive · Time. The assistant and Settings sit
    // in the header; Attendance is a tab of Schedule; Reminders, Timers and the world clock are tabs of Time.
    static let tabs = [("Now", "clock"), ("Schedule", "calendar"), ("Notes", "doc.text"), ("Drive", "folder"), ("Time", "alarm")]
    @EnvironmentObject var store: Store
    @StateObject private var sheets = Sheets()
    @State private var path: [Route] = []
    @State private var tab = 0
    @State private var scheduleSub = 0
    @State private var timeSub = 0
    @State private var newMenu = false
    @StateObject private var update = UpdateCheck()

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                PageHeader(title: "Hourglass", logo: true) {
                    HeaderIcon(icon: "text.bubble") { path.append(.assistant) }
                    HeaderIcon(icon: "gearshape") { sheets.settings = true }
                }
                // A newer build is on marobotic.dev: SideStore installs it.
                if let v = update.version {
                    Button { update.open() } label: {
                        HStack(spacing: 8) {
                            T("Hourglass \(v) is ready. Update it in SideStore", 13, H.fg, lines: 2)
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.right").font(.system(size: 14, weight: .medium)).foregroundStyle(H.tealInk)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .background(H.teal.opacity(0.16))
                        .overlay(alignment: .leading) { H.teal.frame(width: 3) }
                    }
                    .buttonStyle(PressStyle())
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
                // The tab you go to rises in (from 8 pt below); the old one is gone at once (REDESIGN §4).
                .id(tab)
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 8)), removal: .identity))
                // The floating New button on Now and Schedule. Notes has its own Take a note, so no second one there.
                .overlay(alignment: .bottomTrailing) {
                    if tab == 0 || (tab == 1 && scheduleSub == 0) { NewButton { newMenu = true }.padding(16) }
                }
                TabBar(tab: Binding(get: { tab }, set: { v in withAnimation(HMotion.on(HMotion.screen)) { tab = v } }))
            }
            .task { await update.check() }
            // Our own header: iOS 26 wraps toolbar items in round glass bubbles, which clipped the name.
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .note(let id): NoteView(id: id)
                case .course(let id): NotesView(path: $path, sel: id, pushed: true)
                case .assistant: AssistantView()
                }
            }
            .background(H.bg)
        }
        // Above the tab bar (or the bottom of a page): the upload panel.
        .overlay(alignment: .bottom) { UploadPanel().padding(.bottom, path.isEmpty ? 72 : 4) }
        .overlay { BurstLayer() }
        .overlay { NewMenu(open: $newMenu, path: $path, tab: $tab, timeSub: $timeSub) }
        .environmentObject(sheets)
        .sheet(item: $sheets.event) { d in EventSheet(draft: d).environmentObject(store) }
        .sheet(item: $sheets.course) { d in CourseSheet(draft: d, path: $path).environmentObject(store) }
        .sheet(item: $sheets.session) { o in SessionSheet(occ: o, path: $path).environmentObject(store).environmentObject(sheets) }
        .sheet(isPresented: $sheets.alarm) { AlarmSheet().environmentObject(store) }
        .sheet(item: $sheets.reminder) { d in ReminderSheet(draft: d).environmentObject(store) }
        // Settings is a full page with Back, never a small sheet.
        .fullScreenCover(isPresented: $sheets.settings) { SettingsSheet().environmentObject(store) }
    }
}

// Square tab bar (the system one has a pill): five tabs, and a 2 x 24 accent bar on top of the current one that slides
// between tabs with the indicator spring.
struct TabBar: View {
    @Binding var tab: Int
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(H.border).frame(height: 1)
            GeometryReader { geo in
                let cell: CGFloat = geo.size.width / CGFloat(RootView.tabs.count)
                ZStack(alignment: .topLeading) {
                    HStack(spacing: 0) {
                        ForEach(Array(RootView.tabs.enumerated()), id: \.offset) { i, t in
                            TabCell(title: t.0, icon: t.1, on: tab == i) { if tab != i { tab = i } }
                        }
                    }
                    Rectangle().fill(H.accent).frame(width: 24, height: 2)
                        .shadow(color: H.accent.opacity(0.8), radius: 4)
                        .offset(x: (cell * CGFloat(tab) + (cell - 24) / 2).rounded())
                        .animation(HMotion.on(HMotion.indicator), value: tab)
                }
            }
            .frame(height: 64)
        }
        .background(H.surface.ignoresSafeArea(edges: .bottom))
    }
}

private struct TabCell: View {
    let title: String
    let icon: String
    let on: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: on ? icon + ".fill" : icon).font(.system(size: 20)).foregroundStyle(on ? H.fg : H.muted).frame(height: 24)
                Text(title).font(H.ui(12, on ? .bold : .medium)).foregroundStyle(on ? H.fg : H.muted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .animation(HMotion.on(HMotion.quick), value: on)
        }
        .buttonStyle(PressStyle())
    }
}

// A 52 square accent button with the primary gradient and its glow; a press squishes it.
struct NewButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "plus").font(.system(size: 22, weight: .medium)).foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(LinearGradient(colors: [H.accentHi, H.accent], startPoint: .top, endPoint: .bottom))
                .overlay(alignment: .top) { Color.white.opacity(0.14).frame(height: 1) }
                .shadow(color: H.accent.opacity(0.5), radius: 12, y: 6)
        }
        .buttonStyle(PressStyle())
    }
}

// The New menu (the desktop's New button): a square bottom sheet over a scrim.
struct NewMenu: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sheets: Sheets
    @Binding var open: Bool
    @Binding var path: [Route]
    @Binding var tab: Int
    @Binding var timeSub: Int
    var body: some View {
        ZStack(alignment: .bottom) {
            if open {
                Color.black.opacity(0.6).ignoresSafeArea().onTapGesture { open = false }.transition(.opacity)
                VStack(alignment: .leading, spacing: 0) {
                    Rectangle().fill(H.surface4).frame(width: 36, height: 4).frame(maxWidth: .infinity).padding(.top, 8).padding(.bottom, 12)
                    Text("NEW").font(H.ui(12, .bold)).tracking(1).foregroundStyle(H.faint).padding(.horizontal, 20).padding(.bottom, 4)
                    row("Note", "doc.text") { path.append(.note(store.addNote(course: nil, date: Dates.today(), event: nil).id)) }
                    row("Event", "calendar.badge.plus") { sheets.event = EventDraft() }
                    row("Course", "folder") { sheets.course = CourseDraft() }
                    row("Alarm", "alarm") { sheets.alarm = true }
                    row("Reminder", "bell") { sheets.reminder = ReminderDraft() }
                    row("Timer", "timer") { tab = 4; timeSub = 2 }
                }
                .padding(.bottom, 12)
                .background(H.surface2.ignoresSafeArea(edges: .bottom))
                .overlay(alignment: .top) { Color.white.opacity(0.06).frame(height: 1) }
                .transition(.move(edge: .bottom))
            }
        }
        .animation(HMotion.on(HMotion.sheet), value: open)
    }
    private func row(_ title: String, _ icon: String, _ run: @escaping () -> Void) -> some View {
        Button { open = false; run() } label: {
            HStack(spacing: 16) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(H.muted).frame(width: 24)
                T(title, 16, weight: .medium)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).frame(height: 52).contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
    }
}

// A ticking clock for live countdowns.
struct Ticking<Content: View>: View {
    @ViewBuilder var content: (Int64) -> Content
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in content(Int64(ctx.date.timeIntervalSince1970 * 1000)) }
    }
}

// The pages of a grouped tab: labels with a 2 pt red bar under the current one that slides between them, over a
// hairline (redesign5 phone screens).
struct SubTabs: View {
    let items: [String]
    @Binding var selected: Int
    var body: some View {
        GeometryReader { geo in
            let cell: CGFloat = geo.size.width / CGFloat(max(1, items.count))
            ZStack(alignment: .bottomLeading) {
                Rectangle().fill(H.border).frame(height: 1)
                HStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { i, label in
                        let on = i == selected
                        Button { selected = i } label: {
                            T(label, 14, on ? H.fg : H.muted, weight: on ? .bold : .medium, lines: 1)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .animation(HMotion.on(HMotion.quick), value: on)
                    }
                }
                Rectangle().fill(H.accent).frame(width: (cell * 0.6).rounded(), height: 2)
                    .shadow(color: H.accent.opacity(0.7), radius: 4)
                    .offset(x: (cell * CGFloat(selected) + cell * 0.2).rounded())
                    .animation(HMotion.on(HMotion.indicator), value: selected)
            }
        }
        .frame(height: 48)
        .padding(.horizontal, 16)
    }
}

// Our own headers hide the navigation bar, which also turns off iOS's edge swipe back. This turns it on again, so a
// swipe from the left edge leaves the note, the assistant or a course page (REDESIGN §3 Phones: Back).
extension UINavigationController: UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }
    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}
