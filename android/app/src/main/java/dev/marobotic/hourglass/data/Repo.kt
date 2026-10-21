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
import dev.marobotic.hourglass.core.ReminderState
import dev.marobotic.hourglass.core.Reminders
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
import androidx.compose.ui.graphics.asImageBitmap
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
const val SCHEMA = "7"
private val SYNCED_PREFS = setOf("time_format", "week_start", "sound")
val BUILTIN_RINGTONES = listOf("classic", "klaxon", "siren", "digital", "rising", "bell") // bump when a table or column is added

class Repo(private val ctx: Context, autoConfigure: Boolean = true) {
    val store = Store(File(ctx.filesDir, "hourglass.json"))
    // The home clock (synced) is the app's time zone on every device.
    val zone: ZoneId get() = store.all("clocks").firstOrNull { it.optInt("home") == 1 }?.optString("zone")
        ?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _sync = MutableStateFlow(SyncState())
    val sync: StateFlow<SyncState> = _sync
    // Uploads going up and just done, for the upload panel (like Google Drive's).
    private val _uploads = MutableStateFlow<List<Upload>>(emptyList())
    val uploads: StateFlow<List<Upload>> = _uploads
    private val cancelled = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    private var pending: Job? = null
    private var syncEnabled = true
    // The Jukebox session once signed in; before that the build's
    // legacy key. Both sealed with the Keystore.
    private val token: String? get() = store.meta("session_sealed")?.let { Vault.open(it) }
        ?: store.meta("token_sealed")?.takeIf { store.meta("signed_out") == null }?.let { Vault.open(it) }
    val signedIn get() = store.meta("session_sealed") != null
    // Real installs open on the sign-in page until an account is signed in.
    val needsSignIn get() = syncEnabled && !signedIn
    val account: String? get() = store.meta("account")
    // Why the sign-in page is showing when the app signed itself out.
    @Volatile var sessionEnded: String? = null

    // --- preferences ---
    // Time format, week start and alarm sound are synced prefs rows (a change
    // on any device, or by the assistant, shows everywhere); before a row
    // exists, this phone's older setting.
    private fun synced(key: String): String? = store.get("prefs", key)?.str("value")
    val h24 get() = (synced("time_format") ?: store.meta("time_format")) == "24h"
    val firstDay get() = (synced("week_start") ?: store.meta("week_start"))?.toIntOrNull()?.takeIf { it in listOf(1, 6, 7) } ?: 6
    val sound get() = (synced("sound") ?: store.meta("sound")) != "false"
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
    fun setPref(key: String, value: String) {
        store.setMeta(key, value)
        if (key in SYNCED_PREFS) store.upsert("prefs", mapOf("value" to value), key)
    }

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
            // Builds no longer ship a token: a fresh install signs in.
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
    fun marks(): Map<String, String> = store.all("marks").associate { it.id to it.optString("status") }
    fun now(ms: Long = System.currentTimeMillis()): NowState = Now.resolve(store.all("courses"), events(), notes(), ms, zone, marks())
    fun occurrences(from: LocalDate, to: LocalDate): List<Occ> =
        Recurrence.expand(events(), store.all("courses").associateBy { it.id }, from, to, zone, marks())
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

    // Times are locked to the zone the app is in when the event is made.
    fun addEvent(courseId: String?, title: String, kind: String, date: String, start: String, end: String, location: String?, repeat: JSONObject?) =
        store.upsert("events", mapOf(
            "course_id" to courseId, "title" to title, "kind" to kind, "start_date" to date,
            "start_time" to start, "end_time" to end, "location" to location, "repeat" to repeat, "tz" to zone.id,
        ))

    // --- attendance (synced) ---

    // status null clears the mark.
    fun setMark(o: Occ, status: String?) {
        val id = dev.marobotic.hourglass.core.markId(o.courseId, o.eventId, o.session)
        if (status == null) store.remove("marks", id)
        else store.upsert("marks", mapOf("course_id" to o.courseId, "event_id" to if (o.courseId == null) o.eventId else null, "date" to o.session.toString(), "status" to status), id)
    }

    fun attendance(courseId: String): Map<String, Int> =
        store.all("marks").filter { it.str("course_id") == courseId }.groupingBy { it.optString("status") }.eachCount()

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

    // Older text of a note, newest first (the server keeps them).
    fun versions(noteId: String) = store.all("note_versions").filter { it.str("note_id") == noteId }.sortedByDescending { it.optLong("saved_at") }
    // Putting one back is an ordinary edit: the server keeps the replaced text as a version.
    fun restoreVersion(v: JSONObject) = updateNote(v.optString("note_id"), mapOf("title" to v.optString("title"), "body" to v.optString("body")))
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

    // --- reminders (core/node/service.js) ---
    // Overdue first, then by when they show; done ones last, newest first.
    fun reminders(now: Long = System.currentTimeMillis()): List<Pair<JSONObject, ReminderState>> {
        val z = zone
        val all = store.all("reminders").map { it to Reminders.state(it, now, z) }
        val (done, open) = all.partition { it.second.done }
        return open.sortedWith(compareBy({ !it.second.overdue }, { it.second.dueAt ?: Long.MAX_VALUE })) +
            done.sortedByDescending { it.first.optLong("done_at") }
    }

    // date null + days empty: today, or tomorrow once the time has passed.
    fun addReminder(label: String, time: String, date: String?, days: List<Int>): JSONObject {
        val now = System.currentTimeMillis()
        val d = if (days.isNotEmpty()) null else date ?: nextDateFor(time)
        return store.upsert("reminders", mapOf("label" to label.trim().ifBlank { "Reminder" }, "time" to time, "date" to d,
            "days" to JSONArray(days.sorted()), "done_at" to if (days.isNotEmpty()) now else null, "snooze_at" to null))
    }

    // The day a time means with no day given: today, or tomorrow once it has passed.
    fun nextDateFor(time: String): String {
        val now = System.currentTimeMillis()
        val today = Dates.local(now, zone).toLocalDate()
        return (if (Dates.epoch(today, time, zone) > now) today else today.plusDays(1)).toString()
    }

    // A new time is a new reminder: it shows again, a repeating one from now.
    fun editReminder(id: String, label: String, time: String, date: String?, days: List<Int>) {
        val now = System.currentTimeMillis()
        store.upsert("reminders", mapOf("label" to label.trim().ifBlank { "Reminder" }, "time" to time, "date" to if (days.isNotEmpty()) null else date,
            "days" to JSONArray(days.sorted()), "done_at" to if (days.isNotEmpty()) now else null, "snooze_at" to null), id)
    }

    fun reminderDone(id: String, done: Boolean = true) {
        val r = store.get("reminders", id) ?: return
        val now = System.currentTimeMillis()
        val repeats = r.ints("days").isNotEmpty()
        store.upsert("reminders", mapOf("done_at" to if (done || repeats) now else null, "snooze_at" to null), id)
    }

    fun snoozeReminder(id: String, minutes: Int = reminderSnooze) =
        store.upsert("reminders", mapOf("snooze_at" to System.currentTimeMillis() + minutes * 60_000L), id)

    fun removeReminder(id: String) = store.remove("reminders", id)

    // Reminders' own settings (synced): a tone or silent, which tone, snooze length.
    val reminderStyle: String get() = if (synced("reminder_style") == "silent") "silent" else "tone"
    val reminderTone: String get() = synced("reminder_tone")?.takeIf { it in Reminders.TONES } ?: "chime"
    val reminderSnooze: Int get() = synced("reminder_snooze")?.toIntOrNull()?.takeIf { it in 1..240 } ?: 10
    fun setReminderPref(key: String, value: String) = store.upsert("prefs", mapOf("value" to value), key)

    fun setAlarmEnabled(id: String, on: Boolean) = store.upsert("alarms", mapOf("enabled" to if (on) 1 else 0), id)
    fun removeAlarm(id: String) = store.remove("alarms", id)

    // Timers: running (a future start_at means scheduled), paused, idle (a
    // saved timer waiting to be started) or done. Every device rings at ends_at.
    fun timerLeft(t: JSONObject, now: Long = System.currentTimeMillis()): Long = when (t.optString("state")) {
        "running" -> maxOf(0L, (t.optLong("ends_at") - maxOf(now, t.optLong("start_at")) + 999) / 1000)
        "idle" -> t.optLong("duration_s")
        else -> t.optLong("remaining_s")
    }

    // id: a set id, so two devices snoozing the same ring make one timer.
    fun startTimer(seconds: Int, label: String, persistent: Boolean = false, startAt: Long? = null, id: String? = null): JSONObject {
        val start = startAt?.takeIf { it > System.currentTimeMillis() }
        return store.upsert("timers", mapOf(
            "label" to label.ifBlank { if (seconds % 60 == 0) "${seconds / 60} min timer" else "${seconds}s timer" },
            "duration_s" to seconds, "state" to "running", "start_at" to start,
            "ends_at" to (start ?: System.currentTimeMillis()) + seconds * 1000L, "remaining_s" to null, "persistent" to if (persistent) 1 else 0,
        ), id)
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

    // --- attendance ---

    // One course's sessions, from its first to the end of term (the last
    // "until", at most six months out): each day once, with its mark, upcoming
    // ones flagged. Same rule as the desktop's Attendance page.
    data class Session(val date: LocalDate, val eventId: String, val mark: String?, val future: Boolean, val occ: Occ)

    fun attendanceSessions(now: Long = System.currentTimeMillis()): List<Pair<JSONObject, List<Session>>> {
        val mine = events().filter { it.str("course_id") != null }
        if (mine.isEmpty()) return courses().map { it to emptyList() }
        val today = LocalDate.now(zone)
        val starts = mine.mapNotNull { runCatching { LocalDate.parse(it.optString("start_date")) }.getOrNull() }
        val ends = mine.mapNotNull { ev ->
            val until = ev.optJSONObject("repeat")?.optString("until")?.takeIf { it.isNotBlank() } ?: ev.optString("start_date")
            runCatching { LocalDate.parse(until) }.getOrNull()
        }
        val from = starts.minOrNull() ?: today
        val to = minOf(ends.maxOrNull() ?: today, today.plusDays(183)).let { if (it.isBefore(today)) today else it }
        val by = LinkedHashMap<String, LinkedHashMap<LocalDate, Session>>()
        for (o in occurrences(from, to)) {
            val cid = o.courseId ?: continue
            val days = by.getOrPut(cid) { LinkedHashMap() }
            if (!days.containsKey(o.session)) days[o.session] = Session(o.session, o.eventId, o.mark, o.startMs > now, o)
        }
        return courses().map { c -> c to (by[c.id]?.values?.sortedBy { it.date } ?: emptyList()) }
    }

    // unmarked -> attended -> absent -> off -> unmarked
    fun cycleMark(s: Session) = setMark(s.occ, when (s.mark) { null, "" -> "attended"; "attended" -> "absent"; "absent" -> "off"; else -> null })

    // --- drive ---

    data class DriveView(val folder: JSONObject?, val course: JSONObject?, val path: List<JSONObject>, val courses: List<Pair<JSONObject, Int>>, val folders: List<Pair<JSONObject, Int>>, val files: List<JSONObject>)

    fun folders() = store.all("folders")
    fun files() = store.all("files")

    // One folder's contents (null = the top) or one course's folder. The top
    // lists the courses, then the folders and files that are in none. Same
    // rule as the server's list_drive.
    fun drive(folderId: String?, courseId: String?): DriveView {
        val folders = folders()
        val known = courses().map { it.id }.toSet()
        val files = files().map { f -> if (f.str("course_id") != null && f.str("course_id") !in known) JSONObject(f.toString()).put("course_id", JSONObject.NULL) else f }
        val byName = compareBy<JSONObject> { it.optString("name").lowercase() }
        if (courseId != null) {
            val c = course(courseId)
            return DriveView(null, c, emptyList(), emptyList(), emptyList(), files.filter { it.str("course_id") == courseId }.sortedWith(byName))
        }
        val path = mutableListOf<JSONObject>()
        var f = folderId?.let { id -> folders.firstOrNull { it.id == id } }
        while (f != null) { path.add(0, f); f = f.str("parent_id")?.let { p -> folders.firstOrNull { it.id == p } } }
        val top = folderId == null
        return DriveView(
            folder = path.lastOrNull(), course = null, path = path,
            courses = if (top) courses().map { c -> c to files.count { it.str("course_id") == c.id } } else emptyList(),
            folders = folders.filter { it.str("parent_id") == folderId }.sortedWith(byName)
                .map { d -> d to (folders.count { it.str("parent_id") == d.id } + files.count { it.str("folder_id") == d.id }) },
            files = files.filter { it.str("course_id") == null && it.str("folder_id") == folderId }.sortedWith(byName),
        )
    }

    fun addFolder(name: String, parentId: String?) = store.upsert("folders", mapOf("name" to name.trim(), "parent_id" to parentId))
    fun renameDrive(table: String, id: String, name: String) = store.upsert(table, mapOf("name" to name.trim()), id)

    // A folder goes with everything in it.
    fun removeFolder(id: String) {
        for (sub in folders().filter { it.str("parent_id") == id }) removeFolder(sub.id)
        for (file in files().filter { it.str("folder_id") == id }) store.remove("files", file.id)
        store.remove("folders", id)
    }
    fun removeFile(id: String) { store.remove("files", id); driveCopy(id)?.parentFile?.deleteRecursively() }

    // Into a course's folder (or out of it with null), or into a folder.
    fun setFileCourse(id: String, courseId: String?) = store.upsert("files", if (courseId != null) mapOf("course_id" to courseId, "folder_id" to null) else mapOf("course_id" to null), id)
    fun setFileFolder(id: String, folderId: String?) = store.upsert("files", mapOf("folder_id" to folderId, "course_id" to null), id)

    // A folder into another (null = the top). Never into itself or one of its
    // own folders: false then, and nothing changes.
    fun moveFolder(id: String, parentId: String?): Boolean {
        val all = folders()
        var p = parentId
        while (p != null) {
            if (p == id) return false
            p = all.firstOrNull { it.id == p }?.str("parent_id")
        }
        store.upsert("folders", mapOf("parent_id" to parentId), id)
        return true
    }

    // Drive links ("anyone with the link can view"), kept on the server. Each
    // one: { token, url, access: view | download, file_id | folder_id, expires_at, active }.
    fun shares(done: (List<JSONObject>?, String?) -> Unit) = scope.launch {
        val r = runCatching {
            val a = org.json.JSONArray(http("GET", "${BuildConfig.SERVER}/api/shares", token ?: error("Sign in first"), null))
            (0 until a.length()).map { a.getJSONObject(it) }.filter { it.optBoolean("active") }
        }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    // Make a link, or change the access of the one there is (same link). days: 0 = never ends.
    fun share(fileId: String?, folderId: String?, access: String, days: Int, done: (JSONObject?, String?) -> Unit) = scope.launch {
        val r = runCatching {
            val b = JSONObject().put("access", access).put("expires_days", days)
            if (fileId != null) b.put("file_id", fileId) else b.put("folder_id", folderId)
            syncOnce() // a folder made on this phone must be on the server first
            JSONObject(http("POST", "${BuildConfig.SERVER}/api/shares", token ?: error("Sign in first"), b.toString()))
        }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    fun unshare(shareToken: String, done: (String?) -> Unit) = scope.launch {
        val err = runCatching { http("DELETE", "${BuildConfig.SERVER}/api/shares/$shareToken", token ?: error("Sign in first"), null) }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    // Where the assistant's attachments go: the Drive's "Assistant" folder (made by the server).
    fun assistantFolder(done: (String?, String?) -> Unit) = scope.launch {
        val r = runCatching { JSONObject(http("GET", "${BuildConfig.SERVER}/api/assistant/folder", token ?: error("Sign in first"), null)).getString("folder_id") }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    // The server's disk: total, free, what this account uses.
    fun driveUsage(done: (JSONObject?) -> Unit) = scope.launch {
        val r = runCatching { JSONObject(http("GET", "${BuildConfig.SERVER}/api/drive/usage", token ?: error("Sign in first"), null)) }.getOrNull()
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r) }
    }

    // The folder note attachments go to when the note has no course.
    private fun attachmentsFolder(): String {
        folders().firstOrNull { it.str("parent_id") == null && it.optString("name") == "Note attachments" }?.let { return it.id }
        val f = addFolder("Note attachments", null)
        syncOnce() // the server checks the folder exists before taking the upload
        return f.id
    }

    private fun setUpload(id: String, change: (Upload) -> Upload) {
        _uploads.value = _uploads.value.map { if (it.id == id) change(it) else it }
    }
    fun cancelUpload(id: String) { cancelled.add(id) }
    // Close the panel: the finished ones go.
    fun clearUploads() { _uploads.value = _uploads.value.filter { it.state == "sending" } }

    // Stream a file from the phone to the Drive. noteId: attached to that note
    // (its course's folder, or "Note attachments"). Returns the new row.
    fun upload(uri: android.net.Uri, folderId: String?, courseId: String?, noteId: String? = null, done: (JSONObject?, String?) -> Unit) = scope.launch {
        val upId = java.util.UUID.randomUUID().toString()
        val r = runCatching {
            val t = token ?: error("Sign in first")
            val cr = ctx.contentResolver
            var name = "file"
            var size = -1L
            cr.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                    c.getColumnIndex(android.provider.OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
                }
            }
            val mime = cr.getType(uri) ?: "application/octet-stream"
            // Too big for one upload (the server says how big, max_file): say so
            // before sending, not after a dropped connection.
            val maxFile = runCatching { JSONObject(http("GET", "${BuildConfig.SERVER}/api/drive/usage", t, null)).optLong("max_file") }.getOrDefault(0L)
            if (maxFile > 0 && size > maxFile) error("$name is over ${maxFile / 1_048_576} MB, the most one upload can be.")
            val folder = if (noteId != null && courseId == null) attachmentsFolder() else folderId
            val q = StringBuilder("name=").append(java.net.URLEncoder.encode(name, "UTF-8")).append("&mime=").append(java.net.URLEncoder.encode(mime, "UTF-8"))
            if (courseId != null) q.append("&course=").append(courseId) else if (folder != null) q.append("&folder=").append(folder)
            if (noteId != null) q.append("&note=").append(noteId)
            _uploads.value = listOf(Upload(upId, name, size)) + _uploads.value.filter { it.state == "sending" || System.currentTimeMillis() - it.at < 600_000 }
            val c = URL("${BuildConfig.SERVER}/api/files/upload?$q").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 8000
            c.readTimeout = 600_000
            c.setRequestProperty("Authorization", "Bearer $t")
            c.setRequestProperty("Content-Type", mime)
            if (size > 0) c.setFixedLengthStreamingMode(size) else c.setChunkedStreamingMode(64 * 1024)
            // Copied by hand to count what has gone, and how fast (over the last three seconds).
            (cr.openInputStream(uri) ?: error("Could not read that file")).use { i ->
                c.outputStream.use { o ->
                    val buf = ByteArray(64 * 1024)
                    val started = System.currentTimeMillis()
                    val samples = ArrayDeque<Pair<Long, Long>>().apply { add(started to 0L) }
                    var sent = 0L
                    var shown = 0L
                    while (true) {
                        if (upId in cancelled) { c.disconnect(); throw java.util.concurrent.CancellationException("Cancelled") }
                        val n = i.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                        sent += n
                        val now = System.currentTimeMillis()
                        samples.addLast(now to sent)
                        while (samples.size > 2 && now - samples.first().first > 3000) samples.removeFirst()
                        if (now - shown > 250) {
                            shown = now
                            val (t0, s0) = samples.first()
                            val speed = if (now > t0 && now - started > 1000) (sent - s0) * 1000 / (now - t0) else 0L
                            setUpload(upId) { it.copy(sent = sent, speed = speed) }
                        }
                    }
                    setUpload(upId) { it.copy(sent = sent, speed = 0) }
                }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) error(runCatching { JSONObject(text).optString("error") }.getOrNull()?.ifBlank { null } ?: "HTTP $code")
            val row = JSONObject(text)
            setUpload(upId) { it.copy(state = "done", sent = it.size.coerceAtLeast(it.sent), at = System.currentTimeMillis()) }
            syncOnce()
            row
        }
        val gone = cancelled.remove(upId)
        r.exceptionOrNull()?.let { e ->
            setUpload(upId) { it.copy(state = if (gone) "cancelled" else "failed", error = if (gone) "Cancelled" else e.message, speed = 0, at = System.currentTimeMillis()) }
        }
        // A cancelled upload is no problem to report: the panel says it.
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), if (gone) null else r.exceptionOrNull()?.message) }
    }

    // A Drive file's preview from the server (big: 480 px, for the gallery),
    // kept in the cache under the row's updated_at so an edit makes a new one.
    private val thumbs = android.util.LruCache<String, androidx.compose.ui.graphics.ImageBitmap>(120)
    fun thumb(f: JSONObject, big: Boolean): androidx.compose.ui.graphics.ImageBitmap? {
        val key = "${f.id}.${f.optLong("updated_at")}${if (big) ".big" else ""}"
        thumbs.get(key)?.let { return it }
        val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
        val file = File(dir, "$key.jpg")
        val bytes = if (file.exists()) file.readBytes() else runCatching {
            val c = URL("${BuildConfig.SERVER}/api/files/${f.id}/thumb${if (big) "?size=big" else ""}").openConnection() as HttpURLConnection
            c.setRequestProperty("Authorization", "Bearer ${token ?: return null}")
            c.connectTimeout = 8000
            c.readTimeout = 60_000
            if (c.responseCode != 200) return null
            val got = c.inputStream.use { it.readBytes() }
            // A server from before big previews sends the small one: shown, not kept.
            if (!big || c.getHeaderField("x-thumb-size") == "480") {
                dir.listFiles()?.filter { it.name.startsWith(f.id + ".") && it.name.endsWith(".big.jpg") == big }?.forEach { it.delete() }
                file.writeBytes(got)
            }
            got
        }.getOrNull() ?: return null
        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() ?: return null
        thumbs.put(key, bmp)
        return bmp
    }

    // A Drive file's bytes on the server, for a video to play while it streams.
    fun rawUrl(id: String) = "${BuildConfig.SERVER}/api/files/$id/raw"
    fun authHeaders(): Map<String, String> = token?.let { mapOf("Authorization" to "Bearer $it") } ?: emptyMap()

    // This phone's copy of a Drive file, under its real name so other apps
    // know what it is; null until downloaded.
    fun driveCopy(id: String): File? {
        val f = store.get("files", id) ?: return null
        return File(ctx.cacheDir, "drive/$id/${f.optString("name").replace('/', '_').ifBlank { "file" }}")
    }

    // Fetch a file's bytes once (kept until the cache is cleared or it changes size).
    fun download(id: String, done: (File?, String?) -> Unit) = scope.launch {
        val r = runCatching {
            val row = store.get("files", id) ?: error("That file is gone")
            val f = driveCopy(id)!!
            if (!(f.exists() && f.length() == row.optLong("size"))) {
                val c = URL("${BuildConfig.SERVER}/api/files/$id/raw").openConnection() as HttpURLConnection
                c.setRequestProperty("Authorization", "Bearer ${token ?: error("Sign in first")}")
                c.connectTimeout = 8000
                c.readTimeout = 120_000
                if (c.responseCode != 200) error("HTTP ${c.responseCode}")
                f.parentFile?.mkdirs()
                val tmp = File(f.parentFile, f.name + ".part")
                c.inputStream.use { i -> tmp.outputStream().use { i.copyTo(it, 64 * 1024) } }
                f.delete(); tmp.renameTo(f)
            }
            f
        }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    // "Download…": a copy written where the user chose (a Storage Access
    // Framework document), from this phone's copy when it is current, else
    // straight from the server. Not kept track of: it is the user's file now.
    fun saveTo(id: String, dest: android.net.Uri, done: (String?) -> Unit) = scope.launch {
        val err = runCatching {
            val row = store.get("files", id) ?: error("That file is gone")
            val out = ctx.contentResolver.openOutputStream(dest, "wt") ?: error("Could not write there")
            out.use { o ->
                val have = driveCopy(id)
                if (have != null && have.exists() && have.length() == row.optLong("size")) {
                    have.inputStream().use { it.copyTo(o, 64 * 1024) }
                } else {
                    val c = URL("${BuildConfig.SERVER}/api/files/$id/raw").openConnection() as HttpURLConnection
                    c.setRequestProperty("Authorization", "Bearer ${token ?: error("Sign in first")}")
                    c.connectTimeout = 8000
                    c.readTimeout = 120_000
                    if (c.responseCode != 200) error("HTTP ${c.responseCode}")
                    c.inputStream.use { it.copyTo(o, 64 * 1024) }
                }
            }
        }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    // --- account (Jukebox) ---

    // A new Jukebox account, made from here: signed in once created.
    fun register(email: String, password: String, done: (String?) -> Unit) = signIn(email, password, done, "/auth/register")

    fun signIn(email: String, password: String, done: (String?) -> Unit, path: String = "/auth/login") = scope.launch {
        val err = runCatching {
            val res = JSONObject(http("POST", "${BuildConfig.SERVER}$path", null, JSONObject().put("email", email).put("password", password).toString()))
            if (!res.has("session")) error("Account created. Sign in with it.")
            val who = res.optString("email").lowercase()
            val was = account
            if (was != null && was != who) store.clearAll()
            store.setMeta("session_sealed", Vault.seal(res.getString("session")))
            store.setMeta("token_sealed", null)
            store.setMeta("signed_out", null)
            store.setMeta("account", who)
            sessionEnded = null
            syncOnce()
        }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    // Forgot password: the server mails a reset link (the same answer for any email).
    fun forgotPassword(email: String, done: (String?) -> Unit) = scope.launch {
        val err = runCatching { http("POST", "${BuildConfig.SERVER}/auth/forgot", null, JSONObject().put("email", email).toString()) }.exceptionOrNull()?.message
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(err) }
    }

    // The account's personal AI key and links. make: replace the key (the old
    // link stops working).
    fun aiLinks(make: Boolean, done: (JSONObject?, String?) -> Unit) = scope.launch {
        val r = runCatching {
            val t = token ?: error("Sign in first")
            JSONObject(http(if (make) "POST" else "GET", "${BuildConfig.SERVER}/api/ai", t, if (make) "{}" else null))
        }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    // The Assistant tab: opencode on the server works on this account's data
    // (server/assistant.js). path: "" to read the chat, "/message", "/stop", "/new".
    fun assistant(method: String, path: String = "", body: JSONObject? = null, done: (JSONObject?, String?) -> Unit) = scope.launch {
        val r = runCatching {
            val t = token?.takeIf { signedIn } ?: error("Sign in to use the assistant.")
            val text = http(method, "${BuildConfig.SERVER}/api/assistant$path", t, body?.toString() ?: if (method == "POST") "{}" else null)
            JSONObject(text.ifBlank { "{}" })
        }
        kotlinx.coroutines.withContext(Dispatchers.Main) { done(r.getOrNull(), r.exceptionOrNull()?.message) }
    }

    fun signOut() = scope.launch {
        token?.takeIf { signedIn }?.let { t -> runCatching { http("POST", "${BuildConfig.SERVER}/auth/logout", t, "{}") } }
        store.setMeta("session_sealed", null)
        store.setMeta("token_sealed", null)
        store.setMeta("signed_out", "1")
        _sync.value = SyncState("signed_out")
    }

    // Signed out by the server. The account name and this phone's data stay,
    // so signing in again with the same account sends the unsynced changes.
    private fun endSession() {
        sessionEnded = "You were signed out, usually because the password was changed. Sign in again: nothing on this phone is lost."
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

    // For the background job: one sync on the caller's thread.
    fun syncBlocking() = syncOnce()

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
                    // Only what the server took: a table it doesn't know yet (an older server) stays queued.
                    val took = revs?.optJSONObject(t)?.takeIf { it.has(r.id) } ?: continue
                    store.setRev(t, r.id, took.getLong(r.id))
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

    // A read that timed out or lost its connection is tried once more on a fresh
    // one: a connection that switches between two routes strands the first.
    private fun http(method: String, url: String, token: String?, body: String?, raw: ByteArray? = null): String =
        try { http1(method, url, token, body, raw) } catch (e: Unreachable) {
            if (method != "GET") throw RuntimeException(e.message)
            Thread.sleep(800)
            try { http1(method, url, token, body, raw) } catch (e2: Unreachable) { throw RuntimeException(e2.message) }
        }

    private class Unreachable(message: String) : Exception(message)

    private fun http1(method: String, url: String, token: String?, body: String?, raw: ByteArray?): String {
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
        val code = try { c.responseCode } catch (e: java.net.SocketTimeoutException) {
            throw Unreachable("The Hourglass server took too long to answer. Try again.")
        } catch (e: java.io.IOException) {
            throw Unreachable("Can't reach the Hourglass server. Check your internet connection.")
        }
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        // The server says 401 only when the account server turned the session
        // down (a password change or reset ends every session), so it is gone
        // for good: show the sign-in page instead of failing quietly forever.
        if (code == 401 && token != null && signedIn && !url.contains("/auth/")) endSession()
        if (code !in 200..299) {
            val o = runCatching { JSONObject(text) }.getOrNull()
            val msg = o?.optString("error")?.ifBlank { null }
            throw RuntimeException(when {
                // "HTTP 401" is how syncOnce knows the session is gone.
                code == 401 && !url.contains("/auth/") -> "HTTP 401"
                code == 401 -> "Wrong email or password."
                code == 409 -> "That email already has an account. Sign in instead."
                code == 429 -> o?.optInt("retryIn")?.takeIf { it > 0 }?.let { "Too many attempts. Try again in $it seconds." } ?: "Too many attempts. Try again in a minute."
                else -> msg ?: "HTTP $code"
            })
        }
        return text
    }

    fun days(a: JSONObject) = a.ints("days")
}
