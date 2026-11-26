import SwiftUI

// The app's motion, in one place (the same feel as the desktop and Tasks):
// what has been on screen before, so cards pop in only the first time they
// show and glow gold when they change by themselves (a sync from another
// device, the assistant, an AI over MCP); and the little pixel burst for
// finishing things. .lively(key, sig) uses it per card. Used on the main
// thread only.
final class Motion: ObservableObject, @unchecked Sendable {
    static let shared = Motion()
    private var sigs: [String: String] = [:]
    private var glowUntil: [String: Date] = [:]
    private var localUntil = Date.distantPast
    private var cascade = 0
    private var cascadeAt = Date.distantPast

    // Every change this phone makes (Store stamps it): no glow for those.
    func touchLocal() { localUntil = Date().addingTimeInterval(4) }
    var isLocal: Bool { Date() < localUntil }
    func known(_ key: String) -> Bool { sigs[key] != nil }

    // "new" the first time a key shows, "changed" when its content differs from
    // last time, "glowing" for a card rebuilt while its key is still mid-glow.
    func track(_ key: String, _ sig: String) -> String {
        let old = sigs.updateValue(sig, forKey: key)
        if old == nil { return "new" }
        if old != sig {
            if !isLocal { glowUntil[key] = Date().addingTimeInterval(2.3) }
            return "changed"
        }
        return glowLeft(key) > 0 ? "glowing" : "same"
    }
    func glowLeft(_ key: String) -> Double { max(0, glowUntil[key]?.timeIntervalSinceNow ?? 0) }
    // Cards that show together cascade: each waits a little longer.
    func nextDelay() -> Double {
        if Date().timeIntervalSince(cascadeAt) > 0.09 { cascade = 0 }
        cascadeAt = Date()
        defer { cascade += 1 }
        return min(Double(cascade) * 0.045, 0.42)
    }

    // Pixel bursts, drawn over everything by BurstLayer.
    struct Burst: Identifiable { let id = UUID(); let at: CGPoint; let start = Date(); let seed = UInt64.random(in: 1...UInt64.max) }
    @Published var bursts: [Burst] = []
    func burst(at p: CGPoint) {
        bursts.append(Burst(at: p))
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            self.bursts.removeAll { Date().timeIntervalSince($0.start) > 0.95 }
        }
    }
    func burst(in frame: CGRect) { if frame != .zero { burst(at: CGPoint(x: frame.midX, y: frame.midY)) } }
}

// A card or row that pops in the first time its key shows and whose edge
// glows gold when the same key comes back with different content this phone
// didn't just change. sig: anything that changes with the content (updated_at).
private struct Lively: ViewModifier {
    let key: String
    let sig: String
    @State private var scale: CGFloat
    @State private var opacity: Double
    @State private var glow: Double = 0
    init(key: String, sig: String) {
        self.key = key
        self.sig = sig
        // Never seen: starts hidden and small, so it never flashes before popping in.
        let fresh = !key.isEmpty && !Motion.shared.known(key)
        _scale = State(initialValue: fresh && HMotion.allowed ? 0.985 : 1)
        _opacity = State(initialValue: fresh && HMotion.allowed ? 0 : 1)
    }
    func body(content: Content) -> some View {
        content
            .overlay { Rectangle().fill(H.gold.opacity(0.14 * glow)).allowsHitTesting(false) }
            .overlay { Rectangle().strokeBorder(H.gold.opacity(glow), lineWidth: 2).allowsHitTesting(false) }
            .scaleEffect(scale)
            .opacity(opacity)
            .onAppear(perform: check)
            .onChange(of: sig) { _, _ in check() }
    }
    private func check() {
        guard !key.isEmpty else { return } // a card without a key just shows
        let m = Motion.shared
        switch m.track(key, sig) {
        case "new":
            guard HMotion.allowed else { scale = 1; opacity = 1; return }
            scale = 0.985; opacity = 0
            let d = m.nextDelay()
            withAnimation(HMotion.sheet.delay(d)) { scale = 1; opacity = 1 }
        case "changed":
            guard !m.isLocal else { return }
            withAnimation(.easeOut(duration: 0.16)) { glow = 1 }
            withAnimation(.easeOut(duration: 1.5).delay(0.76)) { glow = 0 }
        case "glowing":
            let left = m.glowLeft(key)
            glow = min(1, left / 1.5)
            withAnimation(.linear(duration: left)) { glow = 0 }
        default: break
        }
    }
}

extension View {
    func lively(_ key: String, _ sig: String) -> some View { modifier(Lively(key: key, sig: sig)) }
    // Where this is on screen, for a burst from it.
    func burstAnchor(_ frame: Binding<CGRect>) -> some View {
        background(GeometryReader { g in
            Color.clear
                .onAppear { frame.wrappedValue = g.frame(in: .global) }
                .onChange(of: g.frame(in: .global)) { _, f in frame.wrappedValue = f }
        })
    }
}

// A switch that bursts when it's turned on (alarms).
struct BurstToggle: View {
    let on: Bool
    let set: (Bool) -> Void
    @State private var frame = CGRect.zero
    var body: some View {
        SquareToggle(on: on) { v in set(v); if v { Motion.shared.burst(in: frame) } }.burstAnchor($frame)
    }
}

// Over the whole app: sand-coloured pixels that fly up and fall, from each burst.
struct BurstLayer: View {
    @ObservedObject private var motion = Motion.shared
    var body: some View {
        TimelineView(.animation(paused: motion.bursts.isEmpty)) { tl in
            Canvas { ctx, _ in
                for b in motion.bursts { Self.draw(b, at: tl.date, in: &ctx) }
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }

    // One burst's 16 pixels at `now`; split out (with explicit types) so the compiler can type-check it.
    private static func draw(_ b: Motion.Burst, at now: Date, in ctx: inout GraphicsContext) {
        let t: Double = now.timeIntervalSince(b.start)
        guard t >= 0, t < 0.9 else { return }
        var r: UInt64 = b.seed
        func rnd() -> Double { r = r &* 6364136223846793005 &+ 1442695040888963407; return Double(r >> 11) / Double(UInt64(1) << 53) }
        let fade: Double = max(0, 1 - t / 0.9)
        for i in 0..<16 {
            let angle: Double = Double(i) / 16 * 2 * Double.pi + rnd() * 0.4
            let speed: Double = 120 + rnd() * 160
            let dx: Double = cos(angle) * speed * t
            let dy: Double = sin(angle) * speed * t - 160 * t + 520 * t * t
            let rect = CGRect(x: b.at.x + CGFloat(dx), y: b.at.y + CGFloat(dy), width: 3, height: 3)
            let color: Color = i % 3 == 0 ? H.accent : H.gold
            ctx.fill(Path(rect), with: .color(color.opacity(fade)))
        }
    }
}


// The one motion set (desktop/ui/css/tokens.css, round 5), the same curves as the desktop and Android. Things arrive
// with a fast-out curve; nothing bounces except the tab indicator. Off under Reduce Motion through `HMotion.allowed`.
enum HMotion {
    static var allowed: Bool { !UIAccessibility.isReduceMotionEnabled }
    static let ease = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.26)       // --ease, --t-tab
    static let screen = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.28)     // --t-screen: page switch
    static let quick = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.12)      // --quick: colour
    static let press = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.08)      // --t-press: scale .975
    static let sheet = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.22)      // --t-sheet: sheet, toast, toggle
    static let exit = Animation.timingCurve(0.4, 0, 1, 1, duration: 0.12)           // --t-exit, --ease-in
    static let indicator = Animation.timingCurve(0.34, 1.4, 0.64, 1, duration: 0.24) // nav / tab indicator spring
    static let meter = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.6)       // progress and meters
    static func on(_ a: Animation) -> Animation? { allowed ? a : nil }
}

// List rows on first show: rise 6 pt and fade in, 220 ms, 20 ms apart, at most the first 10 rows (REDESIGN §4).
private struct RiseIn: ViewModifier {
    let index: Int
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || !HMotion.allowed ? 1 : 0)
            .offset(y: shown || !HMotion.allowed ? 0 : 6)
            .onAppear {
                guard !shown else { return }
                withAnimation(HMotion.on(HMotion.sheet.delay(Double(min(index, 9)) * 0.02))) { shown = true }
            }
    }
}

// Live things breathe: the accent wash of a live card goes 0 → 9 % and back over 2.4 s.
struct Breathing: ViewModifier {
    var on: Bool
    @State private var phase = false
    func body(content: Content) -> some View {
        content
            .background(H.accent.opacity(on && HMotion.allowed ? (phase ? 0.09 : 0) : 0))
            .onAppear { if on && HMotion.allowed { withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { phase = true } } }
    }
}

extension View {
    func rise(_ index: Int) -> some View { modifier(RiseIn(index: index)) }
    func breathing(_ on: Bool) -> some View { modifier(Breathing(on: on)) }
}
