import SwiftUI

@main
struct HourglassApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear { Notifications.requestPermission(); AlarmKitScheduler.requestPermission(); Notifications.reschedule(store) }
                .task { while !Task.isCancelled { await store.sync(); try? await Task.sleep(nanoseconds: 30_000_000_000) } }
        }
        .onChange(of: phase) { _, p in if p == .active { Task { await store.sync() } } }
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
    @EnvironmentObject var store: Store
    @StateObject private var sheets = Sheets()
    @State private var path: [Route] = []
    @State private var tab = 0

    var body: some View {
        NavigationStack(path: $path) {
            TabView(selection: $tab) {
                NowView(path: $path).tabItem { Label("Now", systemImage: "clock") }.tag(0)
                ScheduleView().tabItem { Label("Schedule", systemImage: "calendar") }.tag(1)
                NotesView(path: $path).tabItem { Label("Notes", systemImage: "note.text") }.tag(2)
                TimeView().tabItem { Label("Alarms", systemImage: "alarm") }.tag(3)
                ClockView().tabItem { Label("Clock", systemImage: "globe") }.tag(4)
            }
            .tint(H.fg)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 10) { PixelLogo(cell: 2.6); T("Hourglass", 17, bold: true) }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        Rectangle().fill(store.syncState == "synced" ? H.teal : store.syncState == "offline" ? H.orange : H.faint).frame(width: 8, height: 8)
                        Button { sheets.settings = true } label: { Image(systemName: "gearshape").foregroundStyle(H.muted) }
                    }
                }
            }
            .toolbarBackground(H.bg, for: .navigationBar)
            .toolbarBackground(H.surface, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
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
