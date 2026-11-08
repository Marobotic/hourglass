package dev.marobotic.hourglass.core

import org.json.JSONArray
import org.json.JSONObject

// The live side of the assistant (GET /api/assistant/stream, docs/ASSISTANT-API.md):
// Server-Sent Events in, the same conversation JSON as the snapshot out.
// Pure data, no Android, so the unit tests cover it.
object ChatStream {
    // Lines of an event stream in, whole events out. Comment lines (": ping") are skipped.
    class Sse {
        private var event = "message"
        private val data = StringBuilder()

        fun line(raw: String): Pair<String, JSONObject>? {
            if (raw.isEmpty()) {
                val body = data.toString()
                val name = event
                event = "message"; data.setLength(0)
                if (body.isEmpty()) return null
                return runCatching { name to JSONObject(body) }.getOrNull()
            }
            if (raw.startsWith(":")) return null
            val colon = raw.indexOf(':')
            val field = if (colon < 0) raw else raw.substring(0, colon)
            val value = if (colon < 0) "" else raw.substring(colon + 1).removePrefix(" ")
            when (field) {
                "event" -> event = value
                "data" -> { if (data.isNotEmpty()) data.append('\n'); data.append(value) }
            }
            return null
        }
    }

    fun objects(a: JSONArray?): List<JSONObject> = a?.let { (0 until it.length()).mapNotNull { i -> it.optJSONObject(i) } } ?: emptyList()

    fun message(chat: JSONObject, id: String): JSONObject? = objects(chat.optJSONArray("messages")).firstOrNull { it.optString("id") == id }

    // Applies one event to the conversation in place. True when the snapshot
    // has to be read again (a message the stream can't build by itself).
    fun apply(chat: JSONObject, event: String, d: JSONObject): Boolean {
        when (event) {
            "ready" -> {
                for (k in listOf("enabled", "engine", "model", "effort", "state", "busy", "queued")) if (d.has(k)) chat.put(k, d.get(k))
            }
            "state" -> {
                for (k in listOf("state", "busy", "queued")) if (d.has(k)) chat.put(k, d.get(k))
            }
            "message_start" -> {
                val id = d.optString("message_id")
                if (id.isBlank()) return true
                // A queued message that starts now leaves the queue; the reply is running.
                var reload = d.optBoolean("quick") || (chat.optJSONArray("queue")?.length() ?: 0) > 0
                val user = d.optString("user_message_id")
                if (user.isNotBlank() && message(chat, user) == null) reload = true
                if (message(chat, id) == null) {
                    val m = JSONObject().put("id", id).put("role", "assistant").put("time", d.optLong("at")).put("text", "")
                        .put("tools", JSONArray()).put("files", JSONArray()).put("cards", JSONArray()).put("pending_actions", JSONArray()).put("steps", JSONArray())
                        .put("model", d.opt("model") ?: JSONObject.NULL)
                    messages(chat).put(m)
                }
                chat.put("state", "busy").put("busy", true)
                if (d.has("model")) chat.put("model", d.get("model"))
                if (d.has("effort")) chat.put("effort", d.get("effort"))
                return reload
            }
            "text" -> {
                val m = message(chat, d.optString("message_id")) ?: return true
                m.put("text", d.optString("text", m.optString("text") + d.optString("delta")))
            }
            "tool_start", "tool_update", "tool_end" -> {
                val m = message(chat, d.optString("message_id")) ?: return true
                val tools = m.optJSONArray("tools") ?: JSONArray().also { m.put("tools", it) }
                val id = d.optString("id")
                val tool = objects(tools).firstOrNull { it.optString("call_id") == id } ?: JSONObject().put("call_id", id).also { tools.put(it) }
                for (k in listOf("tool", "label", "status", "input", "output", "duration_ms", "diff")) if (d.has(k)) tool.put(k, d.get(k))
            }
            "usage" -> {
                val m = message(chat, d.optString("message_id")) ?: return true
                val u = JSONObject()
                for (k in d.keys()) if (k != "message_id" && k != "model") u.put(k, d.get(k))
                m.put("usage", u)
                if (d.has("model")) m.put("model", d.get("model"))
            }
            "steer" -> return true
            "quota" -> chat.put("quota", if (d.optString("state") == "ok") JSONObject.NULL else d)
            "message_end" -> {
                val m = message(chat, d.optString("message_id")) ?: return true
                for (k in listOf("text", "error", "error_kind", "error_resets_at", "model", "usage")) if (d.has(k)) m.put(k, d.get(k))
                return true // the steps and cards only come with the snapshot
            }
        }
        return false
    }

    private fun messages(chat: JSONObject): JSONArray = chat.optJSONArray("messages") ?: JSONArray().also { chat.put("messages", it) }

    // The newest context reading: percent of the window, from the last message with usage.
    fun context(chat: JSONObject?): JSONObject? = objects(chat?.optJSONArray("messages")).lastOrNull { val u = it.optJSONObject("usage"); u != null && !u.isNull("context_percent") }?.optJSONObject("usage")

    // The limit in force, or null.
    fun quota(chat: JSONObject?): JSONObject? = chat?.optJSONObject("quota")?.takeIf { it.optString("state") != "ok" }

    // Bytes and times the way a quiet line says them.
    fun duration(ms: Long): String = when {
        ms < 1000 -> "$ms ms"
        ms < 60_000 -> "%.1f s".format(java.util.Locale.US, ms / 1000.0)
        else -> "${ms / 60_000}m ${(ms % 60_000) / 1000}s"
    }

    // Tool input/output are strings of JSON: indent them when they parse.
    // The indent is done here, not by JSONObject.toString(2), so it is the same
    // on Android and in the unit tests (whose org.json is a different build).
    fun pretty(s: String): String {
        val t = s.trim()
        val compact = runCatching {
            when {
                t.startsWith("{") -> JSONObject(t).toString()
                t.startsWith("[") -> JSONArray(t).toString()
                else -> return s
            }
        }.getOrElse { return s }
        return indent(compact)
    }

    private fun indent(json: String): String {
        val out = StringBuilder(json.length + 32)
        var depth = 0
        var inString = false
        var escaped = false
        var i = 0
        while (i < json.length) {
            val ch = json[i]
            if (inString) {
                out.append(ch)
                when {
                    escaped -> escaped = false
                    ch == '\\' -> escaped = true
                    ch == '"' -> inString = false
                }
                i++
                continue
            }
            // "{}" and "[]" stay on one line.
            val emptyPair = (ch == '{' || ch == '[') && i + 1 < json.length &&
                json[i + 1] == (if (ch == '{') '}' else ']')
            when {
                emptyPair -> { out.append(ch).append(json[i + 1]); i += 2; continue }
                ch == '"' -> { inString = true; out.append(ch) }
                ch == '{' || ch == '[' -> {
                    out.append(ch).append('\n'); depth++
                    repeat(depth) { out.append("  ") }
                }
                ch == '}' || ch == ']' -> {
                    depth = (depth - 1).coerceAtLeast(0)
                    if (out.isNotEmpty() && out.last() != '\n') out.append('\n')
                    repeat(depth) { out.append("  ") }
                    out.append(ch)
                }
                ch == ',' -> { out.append(ch).append('\n'); repeat(depth) { out.append("  ") } }
                ch == ':' -> out.append(": ")
                else -> out.append(ch)
            }
            i++
        }
        return out.toString()
    }
}
