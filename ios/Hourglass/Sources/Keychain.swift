import Foundation
import Security

// The sync token lives in the iOS Keychain (encrypted, this device only).
enum Keychain {
    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.marobotic.hourglass", kSecAttrAccount as String: key]
    }

    static func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String) {
        SecItemDelete(query(key) as CFDictionary)
        var q = query(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    // The build ships the token XOR-scrambled (hex), not as text.
    static func unscramble(_ hex: String) -> String {
        let salt = Array("dev.marobotic.hourglass".utf8)
        var bytes: [UInt8] = []
        var i = hex.startIndex
        while i < hex.endIndex, let j = hex.index(i, offsetBy: 2, limitedBy: hex.endIndex), let b = UInt8(hex[i..<j], radix: 16) {
            bytes.append(b ^ salt[bytes.count % salt.count])
            i = j
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}
