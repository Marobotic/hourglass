import SwiftUI
import UIKit

/// A newer Hourglass on marobotic.dev. The iPhone app is sideloaded and SideStore
/// installs its updates (from the source at marobotic.dev/apps/sidestore.json), so
/// this only says so and opens SideStore.
@MainActor
final class UpdateCheck: ObservableObject {
    @Published var version: String?
    @Published var notes = ""
    private var checkedAt = Date.distantPast
    static let feed = URL(string: "https://marobotic.dev/apps/hourglass/latest.json")!

    func check() async {
        guard Date().timeIntervalSince(checkedAt) > 6 * 3600 else { return }
        checkedAt = Date()
        var req = URLRequest(url: Self.feed)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 10
        guard let result = try? await URLSession.shared.data(for: req),
              let feed = (try? JSONSerialization.jsonObject(with: result.0)) as? [String: Any],
              let ios = feed["ios"] as? [String: Any] else { return }
        let latest = (ios["version"] as? String) ?? (feed["version"] as? String) ?? "0"
        let mine = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
        if Self.isNewer(latest, than: mine) {
            version = latest
            notes = (feed["notes"] as? String) ?? ""
        } else {
            version = nil
        }
    }

    /// "0.2.10" is newer than "0.2.9": compared number by number.
    static func isNewer(_ a: String, than b: String) -> Bool {
        let pa = a.split(separator: ".").map { Int($0) ?? 0 }
        let pb = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// SideStore when it is installed, otherwise the downloads page.
    func open() {
        UIApplication.shared.open(URL(string: "sidestore://")!, options: [:]) { opened in
            if !opened {
                UIApplication.shared.open(URL(string: "https://marobotic.dev/#hourglass")!, options: [:], completionHandler: nil)
            }
        }
    }
}
