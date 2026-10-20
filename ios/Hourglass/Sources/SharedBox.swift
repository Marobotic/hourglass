import Foundation
import Security

// What the share extension needs from the app: the server and the session.
// The Keychain stays the app's own; this copy lives in the app group the two
// share, so "Share to Hourglass" works without opening the app.
//
// The group is named after the app's bundle id ("group." + id), because a free
// Apple ID re-signs the app under a team-scoped id (dev.marobotic.hourglass.<team>)
// and the signer registers the group to match. The extension's id is the app's
// plus ".share", so both work it out the same way.
enum SharedBox {
    static var appBundleId: String {
        let id = Bundle.main.bundleIdentifier ?? "dev.marobotic.hourglass"
        return Bundle.main.bundleURL.pathExtension == "appex" ? String(id.prefix(upTo: id.lastIndex(of: ".") ?? id.endIndex)) : id
    }
    static var groupId: String { "group." + appBundleId }
    static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }

    static func save(server: String, session: String?) {
        guard let d = defaults else { return }
        d.set(server, forKey: "server")
        if let session, !session.isEmpty { d.set(session, forKey: "session") } else { d.removeObject(forKey: "session") }
    }

    // The app fills the group when it starts, so right after an install (or an update
    // that added the extension) it is empty until Hourglass is opened. Then the
    // extension reads what the app has: the server from the app's Info.plist and the
    // session from the app's Keychain item (both are signed with the team's
    // keychain-access-groups "<TEAM>.*", so the item is readable from here).
    static var server: String? { nonEmpty(defaults?.string(forKey: "server")) ?? appServer }
    static var session: String? { nonEmpty(defaults?.string(forKey: "session")) ?? keychainSession }

    private static func nonEmpty(_ s: String?) -> String? { s?.isEmpty == false ? s : nil }

    private static var appServer: String? {
        var url = Bundle.main.bundleURL
        if url.pathExtension == "appex" { url = url.deletingLastPathComponent().deletingLastPathComponent() }
        return nonEmpty(Bundle(url: url)?.object(forInfoDictionaryKey: "HourglassServer") as? String)
    }

    // Same item as the app's Keychain.get("session").
    private static var keychainSession: String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.marobotic.hourglass",
                                kSecAttrAccount as String: "session", kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return nonEmpty(String(data: d, encoding: .utf8))
    }
}
