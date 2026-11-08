import Foundation

// The assistant's live stream (GET /api/assistant/stream, Server-Sent Events,
// docs/ASSISTANT-API.md). The chat stays a plain dictionary like the snapshot
// from GET /api/assistant; each event edits that dictionary, so the screen
// draws the same data whether it came from polling or from the stream.

func assistantNumber(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }

enum AssistantLive {
    // Applies one event to the chat. Returns true when the screen should also
    // fetch the full snapshot (a message it does not know, a run that ended).
    static func apply(_ event: String, _ d: [String: Any], to chat: inout [String: Any]) -> Bool {
        switch event {
        case "ready", "state":
            for key in ["enabled", "engine", "model", "effort", "state", "busy", "queued"] {
                if let value = d[key], !(value is NSNull) { chat[key] = value }
            }
            return event == "state" && (d["busy"] as? Bool) == false
        case "message_start":
            return start(d, &chat)
        case "text":
            return text(d, &chat)
        case "tool_start", "tool_update", "tool_end":
            let id = d["message_id"] as? String ?? ""
            let known = edit(&chat, id) { (m: inout [String: Any]) in upsertTool(&m, d) }
            return !known
        case "usage":
            var usage: [String: Any] = d
            usage.removeValue(forKey: "message_id")
            chat["live_usage"] = usage
            let id = d["message_id"] as? String ?? ""
            _ = edit(&chat, id) { (m: inout [String: Any]) in m["usage"] = usage }
            return false
        case "steer":
            return true
        case "quota":
            if (d["state"] as? String) == "quota" { chat["quota"] = d } else { chat.removeValue(forKey: "quota") }
            return false
        case "message_end":
            let id = d["message_id"] as? String ?? ""
            _ = edit(&chat, id) { (m: inout [String: Any]) in
                for key in ["text", "error", "error_kind", "error_resets_at", "model", "usage"] {
                    if let value = d[key], !(value is NSNull) { m[key] = value }
                }
            }
            return true
        default:
            return false
        }
    }

    private static func start(_ d: [String: Any], _ chat: inout [String: Any]) -> Bool {
        let id = d["message_id"] as? String ?? ""
        var list: [[String: Any]] = chat["messages"] as? [[String: Any]] ?? []
        if !list.contains(where: { ($0["id"] as? String) == id }) {
            var stub: [String: Any] = ["id": id, "role": "assistant", "text": "", "tools": [[String: Any]](), "steps": [[String: Any]](), "cards": [[String: Any]](), "files": [[String: Any]]()]
            stub["time"] = d["at"] ?? 0
            if let model = d["model"], !(model is NSNull) { stub["model"] = model }
            list.append(stub)
            chat["messages"] = list
        }
        chat["busy"] = true
        chat["state"] = "busy"
        let userId = d["user_message_id"] as? String ?? ""
        let knowsUser = list.contains { ($0["id"] as? String) == userId }
        let queue = chat["queue"] as? [[String: Any]] ?? []
        return !knowsUser || !queue.isEmpty
    }

    private static func text(_ d: [String: Any], _ chat: inout [String: Any]) -> Bool {
        let id = d["message_id"] as? String ?? ""
        let known = edit(&chat, id) { (m: inout [String: Any]) in
            // `text` is everything so far (also when an engine rewrote its answer).
            if let all = d["text"] as? String { m["text"] = all }
            else if let delta = d["delta"] as? String { m["text"] = (m["text"] as? String ?? "") + delta }
        }
        return !known
    }

    // Changes one message in place; false when the chat has no message with this id.
    private static func edit(_ chat: inout [String: Any], _ id: String, _ change: (inout [String: Any]) -> Void) -> Bool {
        var list: [[String: Any]] = chat["messages"] as? [[String: Any]] ?? []
        guard let i = list.firstIndex(where: { ($0["id"] as? String) == id }) else { return false }
        change(&list[i])
        chat["messages"] = list
        return true
    }

    private static func upsertTool(_ m: inout [String: Any], _ d: [String: Any]) {
        var tools: [[String: Any]] = m["tools"] as? [[String: Any]] ?? []
        let callId = d["id"] as? String ?? ""
        var tool: [String: Any] = ["call_id": callId]
        for key in ["tool", "label", "status", "input", "output", "duration_ms", "diff"] {
            if let value = d[key], !(value is NSNull) { tool[key] = value }
        }
        if let i = tools.firstIndex(where: { ($0["call_id"] as? String) == callId }) {
            tools[i].merge(tool) { _, new in new }
        } else {
            tools.append(tool)
        }
        m["tools"] = tools
    }
}

// Keeps one stream open until the task is cancelled: reconnects with a growing
// wait (1 s, 2 s … 30 s) when it drops. `connected` is told when events start
// to arrive (true) and when the stream is gone (false).
func runAssistantStream(store: Store,
                        connected: @escaping @MainActor (Bool) -> Void,
                        event: @escaping @MainActor (String, [String: Any]) -> Void) async {
    var wait: UInt64 = 1
    while !Task.isCancelled {
        do {
            let bytes = try await store.assistantStream()
            var name = ""
            for try await line in bytes.lines {
                if line.hasPrefix("event:") {
                    name = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("data:") {
                    let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                    let object = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] ?? [:]
                    if name == "ready" { wait = 1; await connected(true) }
                    await event(name, object)
                    name = ""
                }
            }
        } catch {
            if Task.isCancelled { break }
        }
        await connected(false)
        if Task.isCancelled { break }
        try? await Task.sleep(nanoseconds: wait * 1_000_000_000)
        wait = min(wait * 2, 30)
    }
    await connected(false)
}
