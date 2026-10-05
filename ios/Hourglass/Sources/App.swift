import SwiftUI

@main
struct HourglassApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group { if store.signedIn { RootView() } else { LoginView() } }
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear { Notifications.requestPermission(); AlarmKitScheduler.requestPermission(); Notifications.reschedule(store) }
                .task { while !Task.isCancelled { await store.syncSoon(); try? await Task.sleep(nanoseconds: 30_000_000_000) } }
        }
        .onChange(of: phase) { _, p in if p == .active { Task { await store.syncSoon() } } }
    }
}

enum Route: Hashable { case note(String), course(String) }

// Sheets any screen can open.
final class Sheets: ObservableObject {
    @Published var event: EventDraft?
    @Published var course: CourseDraft?
    @Published var session: Occ?
    @Published var alarm = false
    @Published var settings = false
}

struct EventDraft: Identifiable { let id = UUID(); var event: Event?; var date: String?; var course: String?; var weekly = false }
struct CourseDraft: Identifiable { let id = UUID(); var course: Course? }

struct RootView: View {
    static let tabs = [("Now", "clock"), ("Schedule", "calendar"), ("Notes", "note.text"), ("Alarms", "alarm"), ("Timers", "hourglass"), ("Clock", "globe"), ("Drive", "folder"), ("Attend", "checklist")]
    @EnvironmentObject var store: Store
    @StateObject private var sheets = Sheets()
    @State private var path: [Route] = []
    @State private var tab = 0

    var body: some View {
        NavigationStack(path: $path) {
            // Six tabs: a square bar of our own (the system one folds the
            // sixth into "More").
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    PixelLogo(cell: 2.6)
                    T("Hourglass", 18, bold: true)
                    Spacer()
                    Button { sheets.settings = true } label: {
                        Image(systemName: "gearshape").font(.system(size: 19)).foregroundStyle(H.muted).frame(width: 44, height: 44)
                    }
                }
                .padding(.leading, 18).padding(.trailing, 8).padding(.top, 4)
                Group {
                    switch tab {
                    case 0: NowView(path: $path)
                    case 1: ScheduleView()
                    case 2: NotesView(path: $path)
                    case 3: TimeView()
                    case 4: TimersView()
                    case 5: ClockView()
                    case 6: DriveView()
                    default: AttendanceView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            // Our own header: iOS 26 wraps toolbar items in round glass
            // bubbles, which clipped the name.
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .note(let id): NoteView(id: id)
                case .course(let id): NotesView(path: $path, sel: id)
                }
            }
            .background(H.bg)
        }
        .environmentObject(sheets)
        .sheet(item: $sheets.event) { d in EventSheet(draft: d).environmentObject(store) }
        .sheet(item: $sheets.course) { d in CourseSheet(draft: d, path: $path).environmentObject(store) }
        .sheet(item: $sheets.session) { o in SessionSheet(occ: o, path: $path).environmentObject(store).environmentObject(sheets) }
        .sheet(isPresented: $sheets.alarm) { AlarmSheet().environmentObject(store) }
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
