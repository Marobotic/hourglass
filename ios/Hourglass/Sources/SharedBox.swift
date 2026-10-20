import Foundation

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

    static var server: String? { defaults?.string(forKey: "server") }
    static var session: String? { defaults?.string(forKey: "session") }
}
