package dev.marobotic.hourglass.data

import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.isDeleted
import dev.marobotic.hourglass.core.updatedAt
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

// Local replica: every table in memory, persisted atomically to one JSON file.
// Local changes are marked dirty until the server accepts them.
class Store(private val file: File) {
    companion object {
        val TABLES = listOf("courses", "events", "notes", "alarms", "clocks", "timers", "ringtones", "prefs")
        private val DEFAULTS = mapOf(
            "courses" to mapOf("name" to "", "code" to null, "color" to "#B14242", "location" to null, "teacher" to null, "archived" to 0),
            "events" to mapOf("course_id" to null, "title" to "", "kind" to "event", "location" to null, "start_date" to null, "start_time" to null, "end_time" to null, "repeat" to null, "exceptions" to JSONArray()),
            "notes" to mapOf("course_id" to null, "event_id" to null, "session_date" to null, "title" to "", "body" to "", "pinned" to 0),
            "alarms" to mapOf("label" to "", "time" to null, "days" to JSONArray(), "date" to null, "lead_event_id" to null, "lead_course_id" to null, "lead_minutes" to null, "enabled" to 1),
            "clocks" to mapOf("zone" to "", "label" to "", "position" to 0, "home" to 0),
            "timers" to mapOf("label" to "", "duration_s" to 0, "state" to "running", "ends_at" to null, "remaining_s" to null, "persistent" to 0, "start_at" to null),
            "ringtones" to mapOf("name" to "", "kind" to "upload", "artist" to null, "song_id" to null, "duration_s" to 0),
            "prefs" to mapOf("value" to null),
        )
    }

    private val tables = TABLES.associateWith { LinkedHashMap<String, JSONObject>() }
    private var meta = JSONObject()
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version
    var onLocalChange: (() -> Unit)? = null

    init {
        load()
    }

    @Synchronized
    private fun load() {
        if (!file.exists()) return
        runCatching {
            val root = JSONObject(file.readText())
            val t = root.optJSONObject("tables") ?: JSONObject()
            for (name in TABLES) {
                val arr = t.optJSONArray(name) ?: continue
                for (i in 0 until arr.length()) arr.getJSONObject(i).let { tables.getValue(name)[it.id] = it }
            }
            meta = root.optJSONObject("meta") ?: JSONObject()
        }
    }

    @Synchronized
    private fun save() {
        val t = JSONObject()
        for (name in TABLES) t.put(name, JSONArray(tables.getValue(name).values.toList()))
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(JSONObject().put("tables", t).put("meta", meta).toString())
        tmp.renameTo(file)
        _version.value++
    }

    @Synchronized fun meta(key: String): String? = if (meta.has(key) && !meta.isNull(key)) meta.optString(key) else null
    @Synchronized fun metaLong(key: String): Long = meta.optLong(key, 0)
    @Synchronized fun setMeta(key: String, value: Any?) { meta.put(key, value ?: JSONObject.NULL); save() }

    @Synchronized fun all(table: String): List<JSONObject> = tables.getValue(table).values.filter { !it.isDeleted }.map { JSONObject(it.toString()) }
    @Synchronized fun get(table: String, id: String?): JSONObject? = id?.let { tables.getValue(table)[it] }?.takeIf { !it.isDeleted }?.let { JSONObject(it.toString()) }

    // Create or patch. Returns the saved row.
    @Synchronized
    fun upsert(table: String, patch: Map<String, Any?>, id: String? = null): JSONObject {
        val existing = id?.let { tables.getValue(table)[it] }
        val row = existing?.let { JSONObject(it.toString()) } ?: JSONObject().apply {
            put("id", id ?: UUID.randomUUID().toString())
            for ((k, v) in DEFAULTS.getValue(table)) put(k, v ?: JSONObject.NULL)
        }
        for ((k, v) in patch) row.put(k, v ?: JSONObject.NULL)
        row.put("updated_at", maxOf(System.currentTimeMillis(), (existing?.updatedAt ?: 0) + 1))
        row.put("deleted", 0)
        row.put("dirty", 1)
        if (!row.has("rev")) row.put("rev", 0)
        tables.getValue(table)[row.id] = row
        save()
        onLocalChange?.invoke()
        return JSONObject(row.toString())
    }

    @Synchronized
    fun remove(table: String, id: String) {
        val existing = tables.getValue(table)[id] ?: return
        existing.put("deleted", 1).put("dirty", 1).put("updated_at", maxOf(System.currentTimeMillis(), existing.updatedAt + 1))
        save()
        onLocalChange?.invoke()
    }

    // --- sync ---

    @Synchronized
    fun dirty(): Map<String, List<JSONObject>> = TABLES.associateWith { t -> tables.getValue(t).values.filter { it.optInt("dirty") == 1 }.map { JSONObject(it.toString()) } }

    @Synchronized
    fun clearDirty(table: String, id: String, updatedAt: Long) {
        tables.getValue(table)[id]?.takeIf { it.updatedAt == updatedAt }?.put("dirty", 0)
    }

    // The server rev a pushed row got: the base for the next edit.
    @Synchronized
    fun setRev(table: String, id: String, rev: Long) {
        tables.getValue(table)[id]?.put("rev", rev)
    }

    // Row pulled from the server: last write wins.
    @Synchronized
    fun applyRemote(table: String, row: JSONObject) {
        val existing = tables.getValue(table)[row.id]
        if (existing != null && existing.updatedAt > row.updatedAt) return
        row.put("dirty", 0)
        tables.getValue(table)[row.id] = row
    }

    // Signing in as another account: drop every local row.
    @Synchronized
    fun clearAll() {
        tables.values.forEach { it.clear() }
        meta.put("cursor", 0)
        save()
    }

    @Synchronized fun flush() = save()
}
