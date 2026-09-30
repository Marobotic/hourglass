package dev.marobotic.hourglass.data

import android.content.Context
import dev.marobotic.hourglass.BuildConfig
import dev.marobotic.hourglass.alarm.Scheduler
import dev.marobotic.hourglass.core.Dates
import dev.marobotic.hourglass.core.Now
import dev.marobotic.hourglass.core.NowState
import dev.marobotic.hourglass.core.Occ
import dev.marobotic.hourglass.core.PALETTE
import dev.marobotic.hourglass.core.Recurrence
import dev.marobotic.hourglass.core.id
import dev.marobotic.hourglass.core.ints
import dev.marobotic.hourglass.core.str
import dev.marobotic.hourglass.core.strs
import dev.marobotic.hourglass.core.toJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId

data class Slot(val day: Int, val start: String, val end: String, val kind: String = "lecture")
data class SyncState(val state: String = "local", val error: String? = null, val lastOk: Long = 0)

// Everything the UI and alarm code touch: the store, the domain operations
// (same semantics as core/node/service.js) and the sync loop.
// autoConfigure: point a fresh install at the build-time server. Tests pass false
// so demo data never reaches the real account.
const val SCHEMA = "4"
val BUILTIN_RINGTONES = listOf("classic", "klaxon", "siren", "digital", "rising", "bell") // bump when a table or column is added

class Repo(private val ctx: Context, autoConfigure: Boolean = true) {
    val store = Store(File(ctx.filesDir, "hourglass.json"))
    // The home clock (synced) is the app's time zone on every device.
    val zone: ZoneId get() = store.all("clocks").firstOrNull { it.optInt("home") == 1 }?.optString("zone")
        ?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _sync = MutableStateFlow(SyncState())
    val sync: StateFlow<SyncState> = _sync
    private var pending: Job? = null
    private var syncEnabled = true
    // The Omarchy Music session once signed in; before that the build's
    // legacy key. Both sealed with the Keystore.
    private val token: String? get() = store.meta("session_sealed")?.let { Vault.open(it) }
        ?: store.meta("token_sealed")?.takeIf { store.meta("signed_out") == null }?.let { Vault.open(it) }
    val signedIn get() = store.meta("session_sealed") != null
    // Real installs open on the sign-in page until an account is signed in.
    val needsSignIn get() = syncEnabled && !signedIn
    val account: String? get() = store.meta("account")

    // --- device preferences (not synced) ---
    val h24 get() = store.meta("time_format") == "24h"
    val firstDay get() = store.meta("week_start")?.toIntOrNull() ?: 6
    val sound get() = store.meta("sound") != "false"
    val vibrate get() = store.meta("vibrate") != "false"
    // Synced: a built-in name or a ringtones row id.
    val ringtone: String get() {
        val v = store.get("prefs", "ringtone")?.str("value")
        return if (v in BUILTIN_RINGTONES || (v != null && store.get("ringtones", v) != null)) v!! else "classic"
    }
    // Read from the synced lecture alarms, so every device shows the same value.
    val reminderMin: Int get() {
        val lectures = events().filter { it.optString("kind") == "lecture" }.map { it.id }.toSet()
        return alarms().firstOrNull { it.str("lead_event_id") in lectures && it.optInt("enabled") == 1 }?.optInt("lead_minutes") ?: 0
    }
    fun setPref(key: String, value: String) = store.setMeta(key, value)

    // One alarm per lecture, N minutes before (0 = off). Synced, so every
    // device rings. Same rules as the server's set_lecture_reminders.
    fun setLectureReminders(minutes: Int) {
        val lectures = events().filter { it.optString("kind") == "lecture" }
        val existing = alarms().filter { a -> lectures.any { it.id == a.str("lead_event_id") } }
        for (ev in lectures) {
            val c = course(ev.str("course_id"))
            val room = (ev.str("location") ?: c?.str("location") ?: "").substringBefore(" · ")
            val start = ev.optString("start_time")
            val h = Dates.minutes(start) / 60
            val label = listOf(c?.optString("name") ?: ev.optString("title"), "lecture ${(h + 11) % 12 + 1}:${start.takeLast(2)} ${if (h < 12) "AM" else "PM"}", room).filter { it.isNotBlank() }.joinToString(" · ")
            val a = existing.firstOrNull { it.str("lead_event_id") == ev.id }
            if (a != null) store.upsert("alarms", if (minutes > 0) mapOf("enabled" to 1, "lead_minutes" to minutes, "label" to label) else mapOf("enabled" to 0), a.id)
            else if (minutes > 0) store.upsert("alarms", mapOf("label" to label, "lead_event_id" to ev.id, "lead_minutes" to minutes, "enabled" to 1, "days" to JSONArray()))
        }
        store.setMeta("lecture_reminder_min", minutes.toString())
    }

    init {
        if (autoConfigure) runCatching {
            // Older builds kept the token in plain text; seal it and drop the copy.
            store.meta("token")?.let { store.setMeta("token_sealed", Vault.seal(it)); store.setMeta("token", null) }
            if (store.meta("token_sealed") == null) {
                val t = Vault.unscramble(BuildConfig.TOKEN_X, BuildConfig.TOKEN_SALT)
                if (t.isNotEmpty()) store.setMeta("token_sealed", Vault.seal(t))
            }
            store.setMeta("server", null)
        }
        syncEnabled = autoConfigure
        // New tables since the last run: pull everything again once, or rows
        // the old build skipped would stay missing.
        if (store.meta("schema") != SCHEMA) { store.setMeta("cursor", 0); store.setMeta("schema", SCHEMA) }
        store.onLocalChange = {
            Scheduler.reschedule(ctx, this)
            pending?.cancel()
            pending = scope.launch { delay(1500); syncOnce() }
        }
    }

    // --- reads ---

    fun courses() = store.all("courses").filter { it.optInt("archived") == 0 }.sortedBy { it.optString("name").lowercase() }
    fun course(id: String?) = store.get("courses", id)
    fun events() = store.all("events")
    fun notes() = store.all("notes")
    fun alarms() = store.all("alarms")
    fun timers() = store.all("timers").filter { it.optString("state") != "done" }
    fun now(ms: Long = System.currentTimeMillis()): NowState = Now.resolve(store.all("courses"), events(), notes(), ms, zone)
    fun occurrences(from: LocalDate, to: LocalDate): List<Occ> =
        Recurrence.expand(events(), store.all("courses").associateBy { it.id }, from, to, zone)
    fun notesFor(courseId: String) = notes().filter { it.str("course_id") == courseId }.sortedByDescending { it.optLong("updated_at") }

    // --- courses ---

    fun addCourse(name: String, code: String?, color: String?, location: String?, teacher: String?, slots: List<Slot>, termEnd: String?): JSONObject {
        val used = courses().map { it.optString("color") }.toSet()
        val c = store.upsert("courses", mapOf(
            "name" to name, "code" to code, "location" to location, "teacher" to teacher,
            "color" to (color ?: PALETTE.firstOrNull { it !in used } ?: PALETTE[used.size % PALETTE.size]),
        ))
        val today = LocalDate.now(zone)
        for (s in slots) {
            var d = today
            while (Dates.iso(d) != s.day) d = d.plusDays(1)
            addEvent(c.id, "", s.kind, d.toString(), s.start, s.end, null, weekly(listOf(s.day), termEnd))
        }
        return c
    }

    fun updateCourse(id: String, fields: Map<String, Any?>) = store.upsert("courses", fields, id)

    fun removeCourse(id: String) {
        events().filter { it.str("course_id") == id }.forEach { store.remove("events", it.id) }
        store.remove("courses", id)
    }

    // --- events ---

    fun weekly(days: List<Int>, until: String?): JSONObject = JSONObject().put("freq", "weekly").put("days", days.toJson()).apply { if (!until.isNullOrBlank()) put("until", until) }

    fun addEvent(courseId: String?, title: String, kind: String, date: String, start: String, end: String, location: String?, repeat: JSONObject?) =
        store.upsert("events", mapOf(
            "course_id" to courseId, "title" to title, "kind" to kind, "start_date" to date,
            "start_time" to start, "end_time" to end, "location" to location, "repeat" to repeat,
        ))

    fun updateEvent(id: String, fields: Map<String, Any?>) = store.upsert("events", fields, id)

    fun skipOccurrence(eventId: String, date: LocalDate) {
        val ev = store.get("events", eventId) ?: return
        val ex = (ev.strs("exceptions") + date.toString()).distinct()
        store.upsert("events", mapOf("exceptions" to JSONArray(ex)), eventId)
    }

    fun removeEvent(id: String) = store.remove("events", id)

    // --- notes ---

    fun addNote(courseId: String?, date: LocalDate?, eventId: String?, title: String? = null, body: String = "", pinned: Boolean = false): JSONObject {
        var session = date
        var ev = eventId
        if (courseId != null && date == null && !pinned) {
            val today = LocalDate.now(zone)
            occurrences(today, today).firstOrNull { it.courseId == courseId }?.let { session = today; if (ev == null) ev = it.eventId }
        }
        return store.upsert("notes", mapOf(
            "course_id" to courseId, "event_id" to ev, "session_date" to session?.toString(),
            "title" to (title ?: nextUntitled()), "body" to body, "pinned" to if (pinned) 1 else 0,
        ))
    }

    // "Untitled 01", "Untitled 02", ... (same rule as the server).
    fun nextUntitled(): String {
        val taken = notes().map { it.optString("title") }.toSet()
        return generateSequence(1) { it + 1 }.map { "Untitled %02d".format(it) }.first { it !in taken }
    }

    fun updateNote(id: String, fields: Map<String, Any?>) = store.upsert("notes", fields, id)
    fun deleteNote(id: String) = store.remove("notes", id)

    // --- alarms & timers ---

    fun addAlarm(label: String, time: String?, days: List<Int>, date: String?, leadCourse: String?, leadMinutes: Int?) =
        store.upsert("alarms", mapOf(
            "label" to label.ifBlank { if (leadCourse != null) "${course(leadCourse)?.optString("name")} in $leadMinutes min" else "Alarm" },
            "time" to if (leadCourse != null) null else time, "days" to days.toJson(), "date" to date,
            "lead_course_id" to leadCourse, "lead_minutes" to leadMinutes, "enabled" to 1,
        ))

    // --- world clock (synced) ---
    fun clocks() = store.all("clocks").sortedWith(compareBy({ it.optInt("position") }, { it.optLong("updated_at") }))
    fun addClock(zone: String) {
        if (clocks().any { it.optString("zone") == zone }) return
        store.upsert("clocks", mapOf("zone" to zone, "label" to zone.substringAfterLast('/').replace('_', ' '), "position" to (clocks().maxOfOrNull { it.optInt("position") } ?: -1) + 1))
    }
    fun removeClock(id: String) = store.remove("clocks", id)
    fun setHomeClock(id: String) {
        for (c in clocks()) {
            val want = if (c.optString("id") == id) 1 else 0
            if (c.optInt("home") != want) store.upsert("clocks", mapOf("home" to want), c.optString("id"))
        }
    }

    fun setAlarmEnabled(id: String, on: Boolean) = store.upsert("alarms", mapOf("enabled" to if (on) 1 else 0), id)
    fun removeAlarm(id: String) = store.remove("alarms", id)

    // Timers: running (a future start_at means scheduled), paused, idle (a
    // saved timer waiting to be started) or done. Every device rings at ends_at.
    fun timerLeft(t: JSONObject, now: Long = System.currentTimeMillis()): Long = when (t.optString("state")) {
        "running" -> maxOf(0L, (t.optLong("ends_at") - maxOf(now, t.optLong("start_at")) + 999) / 1000)
        "idle" -> t.optLong("duration_s")
        else -> t.optLong("remaining_s")
    }

    fun startTimer(seconds: Int, label: String, persistent: Boolean = false, startAt: Long? = null): JSONObject {
        val start = startAt?.takeIf { it > System.currentTimeMillis() }
        return store.upsert("timers", mapOf(
            "label" to label.ifBlank { if (seconds % 60 == 0) "${seconds / 60} min timer" else "${seconds}s timer" },
            "duration_s" to seconds, "state" to "running", "start_at" to start,
            "ends_at" to (start ?: System.currentTimeMillis()) + seconds * 1000L, "remaining_s" to null, "persistent" to if (persistent) 1 else 0,
        ))
    }

    private fun runTimer(t: JSONObject, secs: Long) = store.upsert("timers", mapOf("state" to "running", "start_at" to null, "remaining_s" to null,
        "ends_at" to System.currentTimeMillis() + secs * 1000), t.id)
    fun pauseTimer(t: JSONObject) = store.upsert("timers", mapOf("state" to "paused", "ends_at" to null, "start_at" to null, "remaining_s" to timerLeft(t)), t.id)
    fun resumeTimer(t: JSONObject) = runTimer(t, t.optLong("remaining_s"))
    fun restartTimer(t: JSONObject) = runTimer(t, t.optLong("duration_s"))
    fun addMinute(t: JSONObject) = if (t.optString("state") == "running") store.upsert("timers", mapOf("ends_at" to t.optLong("ends_at") + 60_000), t.id)
        else store.upsert("timers", mapOf("remaining_s" to t.optLong("remaining_s") + 60), t.id)
    private fun finished(t: JSONObject): Map<String, Any?> = if (t.optInt("persistent") == 1) mapOf("state" to "idle", "ends_at" to null, "remaining_s" to null, "start_at" to null) else mapOf("state" to "done")
    fun resetTimer(t: JSONObject) { if (t.optInt("persistent") == 1) store.upsert("timers", finished(t), t.id) else store.remove("timers", t.id) }
    fun finishTimer(id: String) { store.get("timers", id)?.let { store.upsert("timers", finished(it), id) } }
    fun stopTimer(id: String) = store.remove("timers", id)

    // --- ringtones (synced; audio downloaded to files/sounds) ---

    fun ringtones() = store.all("ringtones").sortedByDescending { it.optLong("updated_at") }
    fun setRingtone(id: String) = store.upsert("prefs", mapOf("value" to id), "ringtone")
    fun removeRingtone(id: String) {
        if (ringtone == id) setRingtone("classic")
        store.remove("ringtones", id)
    }
    fun soundFile(id: String) = File(ctx.filesDir, "sounds/$id.wav")

    private fun fetchSounds(server: String, token: String) {
        val dir = File(ctx.filesDir, "sounds").apply { mkdirs() }
        val want = ringtones().map { it.id }.toSet()
        for (id in want) {
            val f = soundFile(id)
            if (f.exists()) continue
            runCatching {
                val c = URL("$server/api/ringtones/$id/audio").openConnection() as HttpURLConnection
                c.setRequestProperty("Authorization", "Bearer $token")
                c.connectTimeout = 8000
                c.readTimeout = 60000
                if (c.responseCode == 200) {
                    val tmp = File(dir, "$id.part")
                    c.inputStream.use { i -> tmp.outputStream().use { i.copyTo(it) } }
                    tmp.renameTo(f)
                }
            }
        }
        dir.listFiles()?.filter { it.nameWithoutExtension !in want }?.forEach { it.delete() }
    }

    // Upload an audio file; the server cuts the loudest 30 s and it syncs back.
    fun uploadRingtone(bytes: ByteArray, name: String, done: (String?) -> Unit) = scope.launch {
        val err = runCatching {
            val t = token ?: error("Sign in first")
            http("POST", "${BuildConfig.SERVER}/api/ringtones/upload?select=1&name=${java.net.URLEncoder.encode(name, "UTF-8")}", t, null, bytes)
            syncOnce()
        }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    // --- account (Omarchy Music) ---

    fun signIn(email: String, password: String, done: (String?) -> Unit) = scope.launch {
        val err = runCatching {
            val res = JSONObject(http("POST", "${BuildConfig.SERVER}/auth/login", null, JSONObject().put("email", email).put("password", password).toString()))
            val who = res.optString("email").lowercase()
            val was = account
            if (was != null && was != who) store.clearAll()
            store.setMeta("session_sealed", Vault.seal(res.getString("session")))
            store.setMeta("token_sealed", null)
            store.setMeta("signed_out", null)
            store.setMeta("account", who)
            syncOnce()
        }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    fun signOut() = scope.launch {
        token?.takeIf { signedIn }?.let { t -> runCatching { http("POST", "${BuildConfig.SERVER}/auth/logout", t, "{}") } }
        store.setMeta("session_sealed", null)
        store.setMeta("token_sealed", null)
        store.setMeta("signed_out", "1")
        _sync.value = SyncState("signed_out")
    }

    // --- sync ---

    fun startLoop() = scope.launch {
        while (true) {
            syncOnce()
            delay(30_000)
        }
    }

    fun syncNow() = scope.launch { syncOnce() }

    @Synchronized
    private fun syncOnce() {
        val server = BuildConfig.SERVER.takeIf { syncEnabled && it.isNotEmpty() } ?: run { _sync.value = SyncState("local"); return }
        val token = token ?: run { _sync.value = SyncState("signed_out"); return }
        try {
            val dirty = store.dirty()
            if (dirty.values.any { it.isNotEmpty() }) {
                val changes = JSONObject()
                for ((t, rows) in dirty) changes.put(t, JSONArray(rows.map { JSONObject(it.toString()).put("base_rev", it.optLong("rev")) }))
                val res = JSONObject(http("POST", "$server/api/sync", token, JSONObject().put("changes", changes).toString()))
                val revs = res.optJSONObject("revs")
                for ((t, rows) in dirty) for (r in rows) {
                    revs?.optJSONObject(t)?.let { if (it.has(r.id)) store.setRev(t, r.id, it.getLong(r.id)) }
                    store.clearDirty(t, r.id, r.optLong("updated_at"))
                }
            }
            val res = JSONObject(http("GET", "$server/api/sync?since=${store.metaLong("cursor")}", token, null))
            val changes = res.getJSONObject("changes")
            for (t in Store.TABLES) changes.optJSONArray(t)?.let { a -> for (i in 0 until a.length()) store.applyRemote(t, a.getJSONObject(i)) }
            store.setMeta("cursor", res.getLong("rev"))
            if (account == null) store.setMeta("account", JSONObject(http("GET", "$server/api/account", token, null)).optString("email").lowercase())
            fetchSounds(server, token)
            _sync.value = SyncState("synced", null, System.currentTimeMillis())
            Scheduler.reschedule(ctx, this)
        } catch (e: Exception) {
            _sync.value = SyncState(if (e.message == "HTTP 401") "signed_out" else "offline", e.message)
        }
    }

    private fun http(method: String, url: String, token: String?, body: String?, raw: ByteArray? = null): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 8000
        c.readTimeout = if (raw != null) 120000 else 15000
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        if (body != null || raw != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", if (raw != null) "application/octet-stream" else "application/json")
            c.outputStream.use { it.write(raw ?: body!!.toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) {
            val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()
            throw RuntimeException(if (code == 401 && url.endsWith("/auth/login")) msg ?: "Wrong email or password" else if (code == 401) "HTTP 401" else msg?.ifBlank { null } ?: "HTTP $code")
        }
        return text
    }

    fun days(a: JSONObject) = a.ints("days")
}
